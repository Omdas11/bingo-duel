// Deterministic RNG: xfnv1a hash -> mulberry32. Both players derive identical
// game state from the room code without trusting each other.

export function xfnv1a(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function rngFrom(str) {
  return mulberry32(xfnv1a(str));
}

// Fisher-Yates using the provided rng. Returns a new array.
export function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// node/self-test hook: allow `node js/rng.js --selftest`
if (typeof process !== "undefined" && process.argv[1] && process.argv[1].endsWith("rng.js")) {
  const r1 = rngFrom("TEST:draw");
  const r2 = rngFrom("TEST:draw");
  const s1 = shuffle([1, 2, 3, 4, 5], r1).join(",");
  const s2 = shuffle([1, 2, 3, 4, 5], r2).join(",");
  console.log("deterministic:", s1 === s2, s1);
}
