// 75-ball bingo engine: card generation, draw sequence, win detection.
// Cards are 5x5 arrays of numbers; center [2][2] is FREE (value 0).
// Marks are 5x5 boolean arrays (center starts true).

import { rngFrom, shuffle } from "./rng.js";

export const COLS = ["B", "I", "N", "G", "O"];
export const RANGES = [
  [1, 15],
  [16, 30],
  [31, 45],
  [46, 60],
  [61, 75],
];

export function genBoard(seedStr) {
  const rng = rngFrom(seedStr);
  const board = [];
  for (let r = 0; r < 5; r++) {
    board.push([0, 0, 0, 0, 0]);
  }
  for (let c = 0; c < 5; c++) {
    const [lo, hi] = RANGES[c];
    const pool = [];
    for (let n = lo; n <= hi; n++) pool.push(n);
    const picked = shuffle(pool, rng).slice(0, 5);
    for (let r = 0; r < 5; r++) board[r][c] = picked[r];
  }
  board[2][2] = 0; // FREE
  return board;
}

export function freshMarks() {
  const m = [];
  for (let r = 0; r < 5; r++) m.push([false, false, false, false, false]);
  m[2][2] = true; // FREE is pre-marked
  return m;
}

// Full shared draw order for a room, derived from the room code.
export function genDrawSeq(roomCode) {
  const rng = rngFrom(roomCode + ":draw");
  const seq = [];
  for (let n = 1; n <= 75; n++) seq.push(n);
  return shuffle(seq, rng);
}

// Returns array of winning lines: {t:"row"|"col"|"diag", i} (diag i: 0 = \, 1 = /)
export function checkWins(marks) {
  const lines = [];
  for (let r = 0; r < 5; r++) {
    if (marks[r].every(Boolean)) lines.push({ t: "row", i: r });
  }
  for (let c = 0; c < 5; c++) {
    let all = true;
    for (let r = 0; r < 5; r++) if (!marks[r][c]) all = false;
    if (all) lines.push({ t: "col", i: c });
  }
  let d1 = true,
    d2 = true;
  for (let k = 0; k < 5; k++) {
    if (!marks[k][k]) d1 = false;
    if (!marks[k][4 - k]) d2 = false;
  }
  if (d1) lines.push({ t: "diag", i: 0 });
  if (d2) lines.push({ t: "diag", i: 1 });
  return lines;
}

export function colLetter(n) {
  if (n < 1 || n > 75) return "?";
  return COLS[Math.floor((n - 1) / 15)];
}

export function ballLabel(n) {
  return colLetter(n) + n;
}

// Verify a claim: every cell of every claimed line must hold a drawn number
// (or be FREE) on the claimer's own card.
export function claimIsValid(board, lines, drawnSet) {
  if (!lines || lines.length === 0) return false;
  for (const line of lines) {
    const cells = lineCells(line);
    for (const [r, c] of cells) {
      if (r === 2 && c === 2) continue; // FREE
      if (!drawnSet.has(board[r][c])) return false;
    }
  }
  return true;
}

export function lineCells(line) {
  const cells = [];
  if (line.t === "row") for (let c = 0; c < 5; c++) cells.push([line.i, c]);
  else if (line.t === "col") for (let r = 0; r < 5; r++) cells.push([r, line.i]);
  else if (line.t === "diag" && line.i === 0) for (let k = 0; k < 5; k++) cells.push([k, k]);
  else for (let k = 0; k < 5; k++) cells.push([k, 4 - k]);
  return cells;
}

if (typeof process !== "undefined" && process.argv[1] && process.argv[1].endsWith("bingo.js")) {
  const b1 = genBoard("ABCD:board:0");
  const b2 = genBoard("ABCD:board:0");
  const b3 = genBoard("ABCD:board:1");
  console.log("board deterministic:", JSON.stringify(b1) === JSON.stringify(b2));
  console.log("boards differ per slot:", JSON.stringify(b1) !== JSON.stringify(b3));
  // column ranges respected?
  let ok = true;
  for (let c = 0; c < 5; c++)
    for (let r = 0; r < 5; r++) {
      if (r === 2 && c === 2) continue;
      const [lo, hi] = RANGES[c];
      if (b1[r][c] < lo || b1[r][c] > hi) ok = false;
    }
  console.log("column ranges ok:", ok, "| free center:", b1[2][2] === 0);
  const s1 = genDrawSeq("ABCD"),
    s2 = genDrawSeq("ABCD");
  console.log("draw seq deterministic:", s1.join(",") === s2.join(","));
  console.log("draw seq is 1..75 perm:", s1.length === 75 && new Set(s1).size === 75);
  // win detection
  const m = freshMarks();
  for (let c = 0; c < 5; c++) m[0][c] = true;
  const w = checkWins(m);
  console.log("row win detected:", w.length === 1 && w[0].t === "row" && w[0].i === 0);
  const m2 = freshMarks();
  console.log("fresh card has no win:", checkWins(m2).length === 0);
  // claim validation: mark row 0 fully, pretend first 5 draws cover it
  const drawn = new Set();
  for (let c = 0; c < 5; c++) drawn.add(b1[0][c]);
  console.log(
    "valid claim passes:",
    claimIsValid(b1, [{ t: "row", i: 0 }], drawn)
  );
  console.log(
    "bogus claim fails:",
    !claimIsValid(b1, [{ t: "row", i: 1 }], drawn)
  );
}
