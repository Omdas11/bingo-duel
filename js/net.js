// Realtime room protocol over Cloud Firestore (single live DB on this project).
// See DESIGN.md for the data model. No game server: both clients derive the
// same draw order and cards deterministically from the room code.

import {
  doc,
  setDoc,
  getDoc,
  updateDoc,
  deleteField,
  addDoc,
  collection,
  query,
  orderBy,
  onSnapshot,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";
import { genBoard, genDrawSeq, claimIsValid } from "./bingo.js";

export const DRAW_MS = 4500;
const DRAWER_TIMEOUT_MS = 12000;
const HEARTBEAT_MS = 8000;

const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function makeCode() {
  let s = "";
  const arr = new Uint32Array(4);
  crypto.getRandomValues(arr);
  for (let i = 0; i < 4; i++) s += CODE_CHARS[arr[i] % CODE_CHARS.length];
  return s;
}

export function roomDoc(store, code) {
  return doc(store, "bingo_rooms", code.toUpperCase());
}

function claimsCol(store, code) {
  return collection(store, "bingo_rooms", code.toUpperCase(), "claims");
}

export function slotOf(room, uid) {
  if (room.host && room.host.uid === uid) return 0;
  if (room.guest && room.guest.uid === uid) return 1;
  return -1;
}

export function myCard(room, uid) {
  const slot = slotOf(room, uid);
  return genBoard(roomCodeOf(room) + ":board:" + slot);
}

export function roomCodeOf(room) {
  return room._code;
}

export async function createRoom(store, user) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = makeCode();
    const d = roomDoc(store, code);
    const existing = await getDoc(d);
    if (existing.exists()) continue;
    await setDoc(d, {
      host: { uid: user.uid, name: user.displayName || "Player" },
      guest: null,
      status: "lobby",
      createdAt: serverTimestamp(),
      drawIndex: 0,
      lastDrawAt: null,
      drawerUid: user.uid,
      winnerUid: null,
      winLines: null,
      forfeit: false,
      progress: {},
      presence: {},
      statsDone: {},
    });
    return code;
  }
  throw new Error("Could not allocate a room code.");
}

export async function joinRoom(store, user, rawCode) {
  const code = rawCode.trim().toUpperCase();
  if (!/^[A-Z0-9]{4}$/.test(code)) return { ok: false, error: "Room codes are 4 letters." };
  let result = { ok: false, error: "Room not found." };
  await runTransaction(store, async (tx) => {
    const d = roomDoc(store, code);
    const snap = await tx.get(d);
    if (!snap.exists()) return;
    const room = snap.data();
    if (room.host && room.host.uid === user.uid) {
      result = { ok: true, code };
      return;
    }
    if (room.status !== "lobby") {
      result = { ok: false, error: "That game already started." };
      return;
    }
    if (room.guest && room.guest.uid !== user.uid) {
      result = { ok: false, error: "Room is full." };
      return;
    }
    tx.update(d, { guest: { uid: user.uid, name: user.displayName || "Player" } });
    result = { ok: true, code };
  });
  return result;
}

// Host leaves an empty lobby -> delete room. Guest leaves -> free the slot.
// Anyone leaving mid-game forfeits: the other player wins.
export async function leaveRoom(store, code, uid) {
  const d = roomDoc(store, code.toUpperCase());
  await runTransaction(store, async (tx) => {
    const snap = await tx.get(d);
    if (!snap.exists()) return;
    const room = snap.data();
    if (room.status === "lobby") {
      if (room.host && room.host.uid === uid) tx.delete(d);
      else if (room.guest && room.guest.uid === uid) tx.update(d, { guest: null });
      return;
    }
    if (room.status === "playing") {
      const other = room.host && room.host.uid === uid ? room.guest : room.host;
      tx.update(d, {
        status: "done",
        winnerUid: other ? other.uid : null,
        winLines: [],
        forfeit: true,
      });
    }
  });
}

export async function startGame(store, code) {
  await updateDoc(roomDoc(store, code), {
    status: "playing",
    drawIndex: 0,
    lastDrawAt: serverTimestamp(),
    startedAt: serverTimestamp(),
  });
}

// Called on an interval by the drawer client only.
export async function tickDraw(store, code, roomCache) {
  const room = roomCache.current;
  if (!room || room.status !== "playing" || room.winnerUid) return;
  if (room.drawIndex >= 75) return;
  const d = roomDoc(store, code);
  await runTransaction(store, async (tx) => {
    const snap = await tx.get(d);
    if (!snap.exists()) return;
    const r = snap.data();
    if (r.status !== "playing" || r.winnerUid || r.drawIndex >= 75) return;
    tx.update(d, { drawIndex: r.drawIndex + 1, lastDrawAt: serverTimestamp() });
  });
}

export async function claimBingo(store, code, uid, lines) {
  await addDoc(claimsCol(store, code), {
    uid,
    at: serverTimestamp(),
    lines,
  });
}

// Validate claims against fresh room state; first valid claim closes the game.
// Runs on any client whenever the claims subcollection changes.
export async function settleClaims(store, code) {
  const d = roomDoc(store, code);
  await runTransaction(store, async (tx) => {
    const snap = await tx.get(d);
    if (!snap.exists()) return;
    const room = snap.data();
    if (room.status !== "playing" || room.winnerUid) return;
    const csnap = await tx.get(query(claimsCol(store, code), orderBy("at", "asc")));
    const seq = genDrawSeq(code.toUpperCase());
    const drawn = new Set(seq.slice(0, room.drawIndex || 0));
    let winner = null;
    for (const cdoc of csnap.docs) {
      const c = cdoc.data();
      if (!c.at || typeof c.at.toMillis !== "function") continue; // not yet stamped
      const slot = slotOf(room, c.uid);
      if (slot < 0) continue;
      const board = genBoard(code.toUpperCase() + ":board:" + slot);
      if (claimIsValid(board, c.lines, drawn)) {
        winner = c;
        break;
      }
    }
    if (winner) {
      tx.update(d, {
        winnerUid: winner.uid,
        winLines: winner.lines,
        status: "done",
      });
    }
  });
}

// Presence heartbeat: onDisconnect doesn't exist in Firestore, so each client
// stamps presence.{uid} every HEARTBEAT_MS. Stale = gone.
export function startHeartbeat(store, code, uid) {
  const d = roomDoc(store, code);
  const beat = () =>
    updateDoc(d, { [`presence.${uid}`]: serverTimestamp() }).catch(() => {});
  beat();
  const timer = setInterval(beat, HEARTBEAT_MS);
  const onUnload = () =>
    updateDoc(d, { [`presence.${uid}`]: deleteField() }).catch(() => {});
  window.addEventListener("beforeunload", onUnload);
  return () => {
    clearInterval(timer);
    window.removeEventListener("beforeunload", onUnload);
    updateDoc(d, { [`presence.${uid}`]: deleteField() }).catch(() => {});
  };
}

export function setProgress(store, code, uid, markedCount) {
  updateDoc(roomDoc(store, code), { [`progress.${uid}`]: markedCount }).catch(
    () => {}
  );
}

// If the drawer stopped ticking (no draw for DRAWER_TIMEOUT_MS), the other
// player takes over drawing via transaction.
export async function maybePromoteDrawer(store, code, myUid, room) {
  if (!room || room.status !== "playing" || room.winnerUid) return;
  if (room.drawerUid === myUid) return;
  const last = room.lastDrawAt;
  const stale =
    !last || typeof last.toMillis !== "function"
      ? true
      : Date.now() - last.toMillis() > DRAWER_TIMEOUT_MS;
  if (!stale) return;
  const d = roomDoc(store, code);
  await runTransaction(store, async (tx) => {
    const snap = await tx.get(d);
    if (!snap.exists()) return;
    const r = snap.data();
    if (r.drawerUid !== room.drawerUid || r.status !== "playing" || r.winnerUid) return;
    const l = r.lastDrawAt;
    const stillStale =
      !l || typeof l.toMillis !== "function"
        ? true
        : Date.now() - l.toMillis() > DRAWER_TIMEOUT_MS;
    if (stillStale) tx.update(d, { drawerUid: myUid });
  }).catch(() => {});
}

export function listenRoom(store, code, onRoom, onClaims) {
  const d = roomDoc(store, code);
  const offRoom = onSnapshot(
    d,
    (snap) => {
      if (!snap.exists()) {
        onRoom(null);
        return;
      }
      const room = snap.data();
      room._code = code.toUpperCase();
      onRoom(room);
    },
    () => {}
  );
  const offClaims = onSnapshot(
    query(claimsCol(store, code), orderBy("at", "asc")),
    () => onClaims(),
    () => {}
  );
  return () => {
    offRoom();
    offClaims();
  };
}

// Update my own stats exactly once per room, atomically with the statsDone guard.
export async function recordStats(store, code, uid, name, isWinner) {
  const d = roomDoc(store, code);
  const sdoc = doc(store, "bingo_stats", uid);
  let out = null;
  await runTransaction(store, async (tx) => {
    const rsnap = await tx.get(d);
    if (!rsnap.exists()) return;
    const done = rsnap.data().statsDone || {};
    if (done[uid]) return; // already recorded
    const ssnap = await tx.get(sdoc);
    const s = ssnap.exists()
      ? ssnap.data()
      : { wins: 0, losses: 0, draws: 0, streak: 0, bestStreak: 0, games: 0 };
    s.games += 1;
    if (isWinner) {
      s.wins += 1;
      s.streak += 1;
      s.bestStreak = Math.max(s.bestStreak, s.streak);
    } else {
      s.losses += 1;
      s.streak = 0;
    }
    s.name = name;
    s.updatedAt = serverTimestamp();
    tx.set(sdoc, s);
    tx.update(d, { [`statsDone.${uid}`]: true });
    out = s;
  });
  return out;
}

export async function loadStats(store, uid) {
  const snap = await getDoc(doc(store, "bingo_stats", uid));
  return snap.exists() ? snap.data() : null;
}
