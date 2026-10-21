// Bingo Duel — app wiring: auth -> menu -> lobby -> game -> result.
import { initFirebase } from "./firebase-init.js";
import { configIsPlaceholder } from "./config.js";
import {
  watchUser,
  signInGoogle,
  signUpEmail,
  signInEmail,
  signOutUser,
  friendlyAuthError,
} from "./auth.js";
import {
  genBoard,
  freshMarks,
  genDrawSeq,
  checkWins,
  lineCells,
  ballLabel,
} from "./bingo.js";
import {
  DRAW_MS,
  createRoom,
  joinRoom,
  leaveRoom,
  startGame,
  tickDraw,
  claimBingo,
  settleClaims,
  listenRoom,
  startHeartbeat,
  setProgress,
  maybePromoteDrawer,
  recordStats,
  loadStats,
} from "./net.js";
import {
  $,
  showScreen,
  toast,
  setCurrentBall,
  renderHistory,
  renderBoard,
  renderLobbyPlayers,
  renderStats,
  escapeHtml,
} from "./ui.js";

const S = {
  fb: null,
  user: null,
  code: null,
  room: null,
  unsub: null,
  stopHeartbeat: null,
  drawTimer: null,
  claimed: false,
  statsRecorded: false,
  seq: [],
  board: null,
  marks: null,
  drawnSet: new Set(),
  lastDrawIndex: -1,
  marksDirty: false,
  firstPaint: true,
  emailMode: "signin",
};

function drawnSetFrom(room) {
  return new Set(S.seq.slice(0, room.drawIndex || 0));
}

function markedCount() {
  let n = 0;
  for (let r = 0; r < 5; r++)
    for (let c = 0; c < 5; c++) if (S.marks[r][c]) n++;
  return n - 1; // exclude FREE
}

function opponentOf(room, uid) {
  if (!room) return null;
  if (room.host && room.host.uid === uid) return room.guest;
  if (room.guest && room.guest.uid === uid) return room.host;
  return null;
}

// ---------- screens ----------

function enterMenu() {
  cleanupRoom();
  $("profile-name").textContent = S.user.displayName || "Player";
  $("profile-avatar").textContent = (S.user.displayName || "P")[0].toUpperCase();
  showScreen("screen-menu");
  loadStats(S.fb.store, S.user.uid)
    .then(renderStats)
    .catch(() => renderStats(null));
}

function enterLobby(code) {
  S.code = code;
  S.claimed = false;
  S.statsRecorded = false;
  S.stopHeartbeat = startHeartbeat(S.fb.store, code, S.user.uid);
  if (S.unsub) S.unsub();
  S.unsub = listenRoom(
    S.fb.store,
    code,
    onRoom,
    () => settleClaims(S.fb.store, S.code).catch(() => {})
  );
  showScreen("screen-lobby");
  $("lobby-code").textContent = code;
}

function onRoom(room) {
  if (!room) {
    toast("Room closed.");
    enterMenu();
    return;
  }
  S.room = room;
  if (room.status === "lobby") {
    if ($("screen-lobby").classList.contains("hidden")) {
      showScreen("screen-lobby");
      $("lobby-code").textContent = S.code;
    }
    renderLobbyPlayers(room, S.user.uid);
    const isHost = room.host.uid === S.user.uid;
    const canStart = isHost && !!room.guest;
    $("btn-start").classList.toggle("hidden", !isHost);
    $("btn-start").disabled = !canStart;
    $("btn-start").textContent = canStart ? "Start game" : "Waiting for opponent...";
    $("lobby-status").textContent = isHost
      ? "Share the code. Press start when your opponent joins."
      : "Waiting for host to start...";
  } else if (room.status === "playing") {
    if ($("screen-game").classList.contains("hidden")) enterGame();
    else updateGame();
    ensureDrawerTimer();
    maybePromoteDrawer(S.fb.store, S.code, S.user.uid, room).catch(() => {});
  } else if (room.status === "done") {
    if ($("screen-result").classList.contains("hidden")) enterResult();
  }
}

function enterGame() {
  S.seq = genDrawSeq(S.code);
  const slot = S.room.host.uid === S.user.uid ? 0 : 1;
  S.board = genBoard(S.code + ":board:" + slot);
  S.marks = freshMarks();
  S.drawnSet = drawnSetFrom(S.room);
  S.lastDrawIndex = -1;
  S.marksDirty = false;
  S.firstPaint = true;
  showScreen("screen-game");
  updateGame();
  const opp = opponentOf(S.room, S.user.uid);
  $("opp-name").textContent = opp ? opp.name : "Opponent";
}

function updateGame() {
  const room = S.room;
  const idx = room.drawIndex || 0;
  const drawChanged = idx !== S.lastDrawIndex;
  S.lastDrawIndex = idx;
  S.drawnSet = drawnSetFrom(room);
  // Draw panel changes only when a new number drops.
  if (drawChanged || S.firstPaint) {
    setCurrentBall(idx > 0 ? S.seq[idx - 1] : null);
    renderHistory(S.seq, idx);
  }
  // Board re-renders only on new draws or own daubs — opponent progress
  // heartbeats must not rebuild the board under the player's finger.
  if (drawChanged || S.marksDirty || S.firstPaint) {
    S.marksDirty = false;
    renderBoard($("board"), $("board-head"), S.board, S.marks, S.drawnSet, {
      interactive: true,
      onDaub,
      winCells: new Set(),
    });
  }
  const opp = opponentOf(room, S.user.uid);
  const oppMarks = opp && room.progress ? room.progress[opp.uid] || 0 : 0;
  $("opp-marks").textContent = oppMarks + " / 24";
  $("opp-fill").style.width = Math.min(100, (oppMarks / 24) * 100) + "%";
  S.firstPaint = false;
}

function onDaub(r, c) {
  if (!S.room || S.room.status !== "playing" || S.room.winnerUid) return;
  if (r === 2 && c === 2) return; // FREE
  const v = S.board[r][c];
  if (S.marks[r][c]) {
    S.marks[r][c] = false; // allow un-daub on mis-tap
  } else {
    if (!S.drawnSet.has(v)) {
      toast(ballLabel(v) + " hasn't been drawn yet.");
      return;
    }
    S.marks[r][c] = true;
  }
  S.marksDirty = true;
  setProgress(S.fb.store, S.code, S.user.uid, markedCount());
  updateGame();
  if (!S.claimed) {
    const wins = checkWins(S.marks);
    if (wins.length > 0) {
      S.claimed = true;
      claimBingo(S.fb.store, S.code, S.user.uid, wins).catch(() => {});
      toast("BINGO! Checking...");
    }
  }
}

function ensureDrawerTimer() {
  const shouldDraw =
    S.room &&
    S.room.status === "playing" &&
    !S.room.winnerUid &&
    S.room.drawerUid === S.user.uid;
  if (shouldDraw && !S.drawTimer) {
    S.drawTimer = setInterval(() => {
      tickDraw(S.fb.store, S.code, { current: S.room }).catch(() => {});
    }, DRAW_MS);
  } else if (!shouldDraw && S.drawTimer) {
    clearInterval(S.drawTimer);
    S.drawTimer = null;
  }
}

async function enterResult() {
  ensureDrawerTimer(); // stops the timer
  showScreen("screen-result");
  const room = S.room;
  const iWon = room.winnerUid === S.user.uid;
  const winnerName = iWon
    ? "You"
    : escapeHtml(opponentOf(room, S.user.uid)?.name || "Opponent");
  const title = $("result-title");
  title.textContent = iWon ? "You win!" : winnerName + " wins";
  title.className = iWon ? "win" : "lose";
  $("result-emoji").textContent = iWon ? "\uD83C\uDFC6" : "\uD83D\uDE14";
  const lineDesc =
    room.winLines && room.winLines.length
      ? "Winning line" +
        (room.winLines.length > 1 ? "s" : "") +
        ": " +
        room.winLines
          .map((l) =>
            l.t === "row"
              ? "row " + (l.i + 1)
              : l.t === "col"
                ? "column " + (l.i + 1)
                : "diagonal"
          )
          .join(", ")
      : "";
  $("result-sub").textContent =
    (room.forfeit ? "Opponent forfeited. " : "") + lineDesc;

  // show my final card, highlight my winning cells if I won
  const winCells = new Set();
  if (iWon && room.winLines) {
    for (const l of room.winLines)
      for (const [r, c] of lineCells(l)) winCells.add(r + "," + c);
  }
  if (!S.seq.length) S.seq = genDrawSeq(S.code);
  if (!S.board) {
    const slot = room.host.uid === S.user.uid ? 0 : 1;
    S.board = genBoard(S.code + ":board:" + slot);
    S.marks = freshMarks();
  }
  const drawn = drawnSetFrom(room);
  renderBoard($("result-board"), $("result-head"), S.board, S.marks, drawn, {
    interactive: false,
    dim: false,
    winCells,
  });

  if (!S.statsRecorded) {
    S.statsRecorded = true;
    try {
      const s = await recordStats(
        S.fb.store,
        S.code,
        S.user.uid,
        S.user.displayName || "Player",
        iWon
      );
      if (s) {
        $("result-stats").textContent =
          `Wins ${s.wins} · Losses ${s.losses} · ` +
          `Win rate ${s.games ? Math.round((100 * s.wins) / s.games) : 0}% · ` +
          `Streak ${s.streak}`;
      }
    } catch (e) {
      $("result-stats").textContent = "Stats couldn't be saved (offline?).";
    }
  }
}

function cleanupRoom() {
  if (S.drawTimer) {
    clearInterval(S.drawTimer);
    S.drawTimer = null;
  }
  if (S.stopHeartbeat) {
    S.stopHeartbeat();
    S.stopHeartbeat = null;
  }
  if (S.unsub) {
    S.unsub();
    S.unsub = null;
  }
  S.room = null;
  S.code = null;
}

// ---------- boot ----------

function setAuthError(msg) {
  const el = $("auth-error");
  el.textContent = msg;
  el.classList.toggle("hidden", !msg);
}

function wireAuth() {
  const tabIn = $("tab-signin");
  const tabUp = $("tab-signup");
  const setMode = (mode) => {
    S.emailMode = mode;
    tabIn.classList.toggle("active", mode === "signin");
    tabUp.classList.toggle("active", mode === "signup");
    $("email-name-row").classList.toggle("hidden", mode === "signin");
    $("btn-email").textContent = mode === "signin" ? "Sign in" : "Create account";
    setAuthError("");
  };
  tabIn.addEventListener("click", () => setMode("signin"));
  tabUp.addEventListener("click", () => setMode("signup"));

  $("btn-google").addEventListener("click", async () => {
    setAuthError("");
    try {
      await signInGoogle(S.fb.auth);
    } catch (e) {
      setAuthError(friendlyAuthError(e));
    }
  });

  $("btn-email").addEventListener("click", async () => {
    setAuthError("");
    const email = $("email-address").value.trim();
    const password = $("email-password").value;
    const name = $("email-name").value.trim();
    if (!email || !password) {
      setAuthError("Enter your email and password.");
      return;
    }
    try {
      if (S.emailMode === "signin") await signInEmail(S.fb.auth, email, password);
      else await signUpEmail(S.fb.auth, name, email, password);
    } catch (e) {
      setAuthError(friendlyAuthError(e));
    }
  });
}

function wireMenu() {
  $("btn-signout").addEventListener("click", () => signOutUser(S.fb.auth));

  $("btn-create").addEventListener("click", async () => {
    try {
      const code = await createRoom(S.fb.store, S.user);
      enterLobby(code);
    } catch (e) {
      toast("Couldn't create room. Check connection.");
    }
  });

  $("btn-join").addEventListener("click", async () => {
    const code = $("join-code").value.trim().toUpperCase();
    if (!code) return;
    try {
      const res = await joinRoom(S.fb.store, S.user, code);
      if (res.ok) enterLobby(res.code);
      else toast(res.error);
    } catch (e) {
      toast("Couldn't join room. Check connection.");
    }
  });
}

function wireLobby() {
  $("btn-copy").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(S.code);
      toast("Code copied.");
    } catch (e) {
      toast("Code: " + S.code);
    }
  });
  $("btn-start").addEventListener("click", async () => {
    try {
      await startGame(S.fb.store, S.code);
    } catch (e) {
      toast("Couldn't start. Try again.");
    }
  });
  $("btn-leave-lobby").addEventListener("click", async () => {
    const code = S.code;
    cleanupRoom();
    try {
      await leaveRoom(S.fb.store, code, S.user.uid);
    } catch (e) {}
    enterMenu();
  });
}

function wireGame() {
  $("btn-leave-game").addEventListener("click", async () => {
    if (!confirm("Forfeit this game?")) return;
    const code = S.code;
    cleanupRoom();
    try {
      await leaveRoom(S.fb.store, code, S.user.uid);
    } catch (e) {}
    enterMenu();
  });
  $("btn-again").addEventListener("click", () => enterMenu());
}

function boot() {
  if (configIsPlaceholder()) {
    showScreen("screen-auth");
    const note = $("auth-note");
    note.textContent =
      "Backend not configured yet — the Firebase keys are still placeholders.";
    note.classList.remove("hidden");
    $("btn-google").disabled = true;
    $("btn-email").disabled = true;
    return;
  }
  try {
    S.fb = initFirebase();
  } catch (e) {
    showScreen("screen-auth");
    setAuthError("Couldn't reach the game backend. Check your connection.");
    return;
  }
  wireAuth();
  wireMenu();
  wireLobby();
  wireGame();
  watchUser(S.fb.auth, (user) => {
    S.user = user;
    $("btn-signout").classList.toggle("hidden", !user);
    if (user) enterMenu();
    else {
      cleanupRoom();
      showScreen("screen-auth");
    }
  });
}

boot();
