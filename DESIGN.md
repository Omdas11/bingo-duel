# Bingo Duel — design

1v1 75-ball bingo. Web app, static (Vercel), Firebase backend on the existing
project `studio-5006354319-33e06` (shared with missile.io).

## Rules (phase 1)
- 75-ball, 5x5 card, columns B(1-15) I(16-30) N(31-45) G(46-60) O(61-75).
- Center cell is FREE (auto-marked).
- Numbers drawn every 4.5s from a shared shuffled sequence. Both players see
  the same draws at the same time.
- Tap a cell to daub it — only allowed if that number has been drawn.
- First player to complete any 5-in-a-row (row, column, or diagonal) wins.
  Claim is automatic the moment the client detects it.
- Each player gets a DIFFERENT card, but both cards come from the same number
  pool, so neither side has a structural advantage.

## Fairness without a server
There is no game server; both clients derive the same game state from the room
code deterministically:
- `drawSeq` = shuffle(1..75) seeded with `hash(roomCode + ":draw")`.
- Player card = `genBoard(hash(roomCode + ":board:" + slot))`, slot 0 = host,
  slot 1 = guest. Neither client can rig the other's card.
- Claims are timestamped by the RTDB server (`ServerValue.TIMESTAMP`).
  First valid claim wins; validity is recomputed by the opponent's client
  (every claimed line must be fully within the drawn set on the claimer's own
  card). Invalid claims are ignored.

## Data model (Cloud Firestore)
`bingo_rooms/{code}` document:
```
host: {uid, name}
guest: {uid, name} | null
status: "lobby" | "playing" | "done"
createdAt, startedAt: timestamps
drawIndex: number              # how many of drawSeq have been drawn
lastDrawAt: timestamp          # heartbeat of the draw timer (drawer failover)
drawerUid: string              # who advances drawIndex (host, or guest if host stalls)
winnerUid: string | null
winLines: [{t:"row"|"col"|"diag", i}] | null
forfeit: boolean
progress: { uid: markedCount }  # for the "opponent is at N marks" tension UI
presence: { uid: timestamp }    # heartbeat every 8s (no onDisconnect in Firestore)
statsDone: { uid: true }        # guards double-counting stats
```
`bingo_rooms/{code}/claims/{autoId}`: `{uid, at, lines}` — BINGO claims,
ordered by server timestamp; first valid claim wins (validated inside a
transaction by recomputing the claimer's card from the room code).

Drawer failover: if `lastDrawAt` is older than 12s, the other player takes
over `drawerUid` in a transaction — no presence service needed.

## Stats (Firestore)
`bingo_stats/{uid}`: `{ name, wins, losses, draws, streak, bestStreak, games, updatedAt }`.
Updated once per finished game by each client for its own uid, guarded by
`statsDone`. Shown on the menu profile card.

## Auth
Firebase Auth: Google (popup-first) + Email/Password (sign in / sign up tabs).
Email/Password provider must be enabled in the Firebase console (one toggle).

## Screens
auth -> menu (profile + stats, create / join) -> lobby (room code, players) ->
game (draw ticker, board, opponent progress) -> result (win/lose, stats, rematch)

## Later phases (not now)
- Full-house / multi-line modes, best-of-3.
- Rematch without leaving, friend list, public leaderboard.
- Tighter RTDB rules (per-room membership checks).
