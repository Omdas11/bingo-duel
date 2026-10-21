// DOM helpers + renderers. Static skeleton lives in index.html.
import { COLS, colLetter, ballLabel } from "./bingo.js";

export function $(id) {
  return document.getElementById(id);
}

export function showScreen(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.add("hidden"));
  $(id).classList.remove("hidden");
  window.scrollTo(0, 0);
}

let toastTimer = null;
export function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), 2600);
}

const BALL_COLORS = {
  B: "#4aa3ff",
  I: "#ff5a5a",
  N: "#ffd34a",
  G: "#4ade80",
  O: "#c084fc",
};

export function ballColor(n) {
  return BALL_COLORS[colLetter(n)] || "#cfc8ee";
}

export function setCurrentBall(n) {
  const el = $("ball-current");
  if (!n) {
    el.innerHTML = '<span class="bl">-</span><span class="bn">?</span>';
    el.style.background = "#f4f1ff";
    return;
  }
  el.style.background = ballColor(n);
  el.innerHTML = `<span class="bl">${colLetter(n)}</span><span class="bn">${n}</span>`;
}

export function renderHistory(seq, drawIndex) {
  const el = $("draw-history");
  const drawn = seq.slice(0, drawIndex).slice(-14).reverse();
  el.innerHTML = drawn
    .map(
      (n) =>
        `<div class="ball small" style="background:${ballColor(n)}" title="${ballLabel(n)}">${n}</div>`
    )
    .join("");
  $("draw-count").textContent = `${drawIndex} / 75 drawn`;
}

// Render the 5x5 board. winCells = Set of "r,c" to highlight.
export function renderBoard(boardEl, headEl, board, marks, drawnSet, opts = {}) {
  headEl.innerHTML = COLS.map((c) => `<div>${c}</div>`).join("");
  boardEl.innerHTML = "";
  const winCells = opts.winCells || new Set();
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      const d = document.createElement("div");
      d.className = "cell";
      d.dataset.r = r;
      d.dataset.c = c;
      const v = board[r][c];
      if (r === 2 && c === 2) {
        d.classList.add("free");
        d.textContent = "FREE";
      } else {
        d.textContent = v;
        if (drawnSet && drawnSet.has(v)) d.classList.add("drawn");
      }
      if (marks[r][c]) d.classList.add("marked");
      if (winCells.has(r + "," + c)) d.classList.add("win");
      if (opts.interactive) {
        d.addEventListener("click", () => opts.onDaub(r, c));
      } else {
        if (opts.dim !== false) d.classList.add("dim");
        d.style.cursor = "default";
      }
      boardEl.appendChild(d);
    }
  }
}

export function renderLobbyPlayers(room, myUid) {
  const el = $("lobby-players");
  const row = (name, isYou) =>
    `<div class="player-row"><span>${escapeHtml(name)}</span>${isYou ? '<span class="you">YOU</span>' : ""}</div>`;
  let html = row(room.host.name, room.host.uid === myUid);
  html += room.guest
    ? row(room.guest.name, room.guest.uid === myUid)
    : `<div class="player-row empty"><span>Waiting for opponent...</span></div>`;
  el.innerHTML = html;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
}

export function renderStats(stats) {
  const s = stats || { games: 0, wins: 0, losses: 0, streak: 0, bestStreak: 0 };
  $("st-games").textContent = s.games;
  $("st-wins").textContent = s.wins;
  $("st-losses").textContent = s.losses;
  $("st-winrate").textContent =
    s.games > 0 ? Math.round((100 * s.wins) / s.games) + "%" : "-";
  $("st-streak").textContent = s.streak;
  $("st-best").textContent = s.bestStreak;
}
