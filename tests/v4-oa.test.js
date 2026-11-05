// v4 OA simulators (prep/oa.js, contract §F): seeded generators for arith, eighty, seq and ev,
// config helpers, scoring, personal best, trend and the in-app zetamac entry.
// Every expected value comes from an oracle written in this file (contract §N4): the arith
// reproduction uses a local mulberry32 (contract §B1, §N5), the sequence families have their own
// fit/next, and every EV template has its own brute force. Run with `npm test`.
const test = require("node:test");
const assert = require("node:assert/strict");
const OA = require("../prep/oa.js");
const { parseAnswer, checkNumeric } = require("../prep/answer.js");

const MINUTE = 60000;
const T0 = new Date(2026, 10, 4, 15, 0, 0).getTime(); // Wed 4 Nov 2026 15:00 local

const KIND_IDS = ["arith", "eighty", "seq", "ev"];
const ARITH_DEFAULT = {
  ops: ["add", "sub", "mul", "div"],
  addA: [2, 100], addB: [2, 100], mulA: [2, 12], mulB: [2, 100],
  durationSecs: 120,
};
const ARITH_KEYS = ["ops", "addA", "addB", "mulA", "mulB", "durationSecs"];
const EIGHTY_IDS = ["add-dec", "sub-dec", "mul-2x2", "mul-3x2", "mul-dec", "div", "pct", "frac"];
const FAMILIES = ["arithmetic", "geometric", "second-diff", "fib-like", "interleaved", "powers", "primes", "alt-ops"];
const TEMPLATES = ["dice-max", "dice-min", "dice-absdiff", "dice-reroll", "dice-threshold",
  "dice-distinct", "coins-maxrun", "coins-absdiff", "cards-max", "cards-first-high"];

const clone = (x) => JSON.parse(JSON.stringify(x));
const inR = (x, lo, hi) => Number.isInteger(x) && x >= lo && x <= hi;
const nz = (x) => (x === 0 ? 0 : x); // -0 -> 0, so deepEqual never trips on the sign of zero
const nzObj = (o) => (o === null || o === undefined ? o
  : Object.fromEntries(Object.entries(o).map(([k, v]) => [k, nz(v)])));
const countBy = (xs, f) => xs.reduce((m, x) => { const k = f(x); m[k] = (m[k] || 0) + 1; return m; }, {});
const range = (lo, hi) => Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
const parsedValue = (q) => {
  const r = parseAnswer(q.answer.value);
  assert.equal(r.ok, true, `answer.value ${JSON.stringify(q.answer.value)} must parse`);
  return r.value;
};

// ---------- oracle: mulberry32 + helpers, exactly as contract §B1/§B2 ----------

function refRng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const refRandInt = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
const refPick = (rng, arr) => arr[Math.floor(rng() * arr.length)];

const ARITH_SYM = { add: "+", sub: "–", mul: "×", div: "÷" };

// Contract §F2 exact generation, written independently. `cfg` must already be normalised.
function refArith(seed, cfg) {
  const rng = refRng(seed);
  const out = [];
  for (let i = 0; i < 4 * cfg.durationSecs; i++) {
    const op = refPick(rng, cfg.ops);
    const [ra, rb] = op === "add" || op === "sub" ? [cfg.addA, cfg.addB] : [cfg.mulA, cfg.mulB];
    const x = refRandInt(rng, ra[0], ra[1]);
    const y = refRandInt(rng, rb[0], rb[1]);
    let left, right, ans;
    if (op === "add") [left, right, ans] = [x, y, x + y];
    else if (op === "sub") [left, right, ans] = [x + y, x, y];
    else if (op === "mul") [left, right, ans] = [x, y, x * y];
    else [left, right, ans] = [x * y, x, y];
    out.push({ op, left, right, ans, prompt: `${left} ${ARITH_SYM[op]} ${right}` });
  }
  return out;
}

// ---------- oracle: primes and the eight sequence families (contract §F4) ----------

const P = (() => {
  const ps = [];
  for (let n = 2; ps.length < 120; n++) {
    let prime = true;
    for (let d = 2; d * d <= n; d++) if (n % d === 0) { prime = false; break; }
    if (prime) ps.push(n);
  }
  return ps;
})();

function diffsOf(t) {
  const d = [];
  for (let k = 0; k + 1 < t.length; k++) d.push(t[k + 1] - t[k]);
  return d;
}

function myFit(id, t) {
  switch (id) {
    case "arithmetic": {
      const d = t[1] - t[0];
      if (d === 0 || !diffsOf(t).every((x) => x === d)) return null;
      return { a: t[0], d };
    }
    case "geometric": {
      if (t[0] === 0) return null;
      const r = t[1] / t[0];
      if (!Number.isInteger(r) || Math.abs(r) < 2) return null;
      for (let k = 0; k < 6; k++) if (t[k + 1] !== r * t[k]) return null;
      return { a: t[0], r };
    }
    case "second-diff": {
      const D = diffsOf(t);
      const c = D[1] - D[0];
      if (c === 0) return null;
      for (let k = 0; k < 5; k++) if (D[k + 1] - D[k] !== c) return null;
      return { a: t[0], b: D[0], c };
    }
    case "fib-like": {
      for (let k = 2; k < 7; k++) if (t[k] !== t[k - 1] + t[k - 2]) return null;
      return { a: t[0], b: t[1] };
    }
    case "interleaved": {
      const d1 = t[2] - t[0];
      const d2 = t[3] - t[1];
      if (d1 === 0 || d2 === 0) return null;
      if (t[4] - t[2] !== d1 || t[6] - t[4] !== d1 || t[5] - t[3] !== d2) return null;
      return { a1: t[0], d1, a2: t[1], d2 };
    }
    case "powers": {
      for (const p of [2, 3]) {
        const s = p === 2 ? (t[1] - t[0] - 1) / 2 : (t[2] - 2 * t[1] + t[0] - 6) / 6;
        if (!Number.isInteger(s)) continue;
        const c = t[0] - s ** p;
        if (t.every((v, k) => v === (k + s) ** p + c)) return { p, s: nz(s), c: nz(c) };
      }
      return null;
    }
    case "primes": {
      for (let s = 0; s <= 100; s++) {
        const c = t[0] - P[s];
        if (t.every((v, k) => v - P[k + s] === c)) return { s, c: nz(c) };
      }
      return null;
    }
    case "alt-ops": {
      const a = t[1] - t[0];
      if (a === 0 || t[1] === 0) return null;
      const b = t[2] / t[1];
      if (!Number.isInteger(b) || Math.abs(b) < 2) return null;
      for (let k = 0; k < 6; k++) if (t[k + 1] !== (k % 2 === 0 ? t[k] + a : t[k] * b)) return null;
      return { x0: t[0], a, b };
    }
    default:
      throw new Error("oracle: unknown family " + id);
  }
}

function myNext(id, t) {
  const p = myFit(id, t);
  if (p === null) return null;
  switch (id) {
    case "arithmetic": return t[6] + p.d;
    case "geometric": return p.r * t[6];
    case "second-diff": return t[6] + (t[6] - t[5]) + p.c;
    case "fib-like": return t[6] + t[5];
    case "interleaved": return t[5] + p.d2;
    case "powers": return nz((7 + p.s) ** p.p + p.c);
    case "primes": return P[7 + p.s] + p.c;
    case "alt-ops": return t[6] + p.a;
  }
  return null;
}

// Generation ranges from the §F4 table (the fit recovers the drawn parameters exactly).
const SEQ_RANGES = {
  arithmetic: (p) => inR(p.a, -20, 50) && inR(p.d, -15, 15) && p.d !== 0,
  geometric: (p) => inR(p.a, 1, 10) && [-3, -2, 2, 3].includes(p.r),
  "second-diff": (p) => inR(p.a, -10, 30) && inR(p.b, -10, 10) && inR(p.c, -5, 5) && p.c !== 0,
  "fib-like": (p) => inR(p.a, 1, 12) && inR(p.b, 1, 12),
  interleaved: (p) => inR(p.a1, 1, 30) && inR(p.a2, 1, 30)
    && inR(p.d1, -9, 9) && p.d1 !== 0 && inR(p.d2, -9, 9) && p.d2 !== 0,
  powers: (p) => ((p.p === 2 && inR(p.s, 1, 6)) || (p.p === 3 && inR(p.s, 1, 4))) && inR(p.c, -10, 10),
  primes: (p) => [0, 1, 3, 4, 5].includes(p.s) && inR(p.c, -10, 10),
  "alt-ops": (p) => inR(p.x0, 1, 10) && inR(p.a, 1, 9) && [2, 3].includes(p.b),
};

// Hand-made sequences with hand-computed fits. A family not listed must NOT fit.
const HAND = [
  { t: [7, 4, 1, -2, -5, -8, -11], fits: {
    arithmetic: [{ a: 7, d: -3 }, -14],
    interleaved: [{ a1: 7, d1: -6, a2: 4, d2: -6 }, -14] } },
  { t: [3, -6, 12, -24, 48, -96, 192], fits: { geometric: [{ a: 3, r: -2 }, -384] } },
  { t: [1, 2, 4, 8, 16, 32, 64], fits: { geometric: [{ a: 1, r: 2 }, 128] } },
  { t: [2, 5, 12, 23, 38, 57, 80], fits: { "second-diff": [{ a: 2, b: 3, c: 4 }, 107] } },
  { t: [4, 11, 20, 31, 44, 59, 76], fits: {
    "second-diff": [{ a: 4, b: 7, c: 2 }, 95],
    powers: [{ p: 2, s: 3, c: -5 }, 95] } },
  { t: [9, 28, 65, 126, 217, 344, 513], fits: { powers: [{ p: 3, s: 2, c: 1 }, 730] } },
  { t: [2, 5, 7, 12, 19, 31, 50], fits: { "fib-like": [{ a: 2, b: 5 }, 81] } },
  { t: [10, 3, 6, 8, 2, 13, -2], fits: { interleaved: [{ a1: 10, d1: -4, a2: 3, d2: 5 }, 18] } },
  { t: [3, 7, 9, 13, 15, 19, 25], fits: { primes: [{ s: 3, c: -4 }, 27] } },
  { t: [2, 3, 5, 7, 11, 13, 17], fits: { primes: [{ s: 0, c: 0 }, 19] } },
  { t: [78, 84, 88, 94, 102, 106, 108], fits: { primes: [{ s: 20, c: 5 }, 112] } },
  { t: [552, 562, 568, 574, 576, 582, 592], fits: { primes: [{ s: 100, c: 5 }, 598] } }, // s = 100 is the last searched
  // primes with s = 2 collides with interleaved (both halves step by 6): two fits, two answers
  { t: [5, 7, 11, 13, 17, 19, 23], fits: {
    primes: [{ s: 2, c: 0 }, 29],
    interleaved: [{ a1: 5, d1: 6, a2: 7, d2: 6 }, 25] } },
  // an interleaved draw that also fits primes (s = 2, c = -4): the generator must reject it
  { t: [1, 3, 7, 9, 13, 15, 19], fits: {
    interleaved: [{ a1: 1, d1: 6, a2: 3, d2: 6 }, 21],
    primes: [{ s: 2, c: -4 }, 25] } },
  { t: [4, 7, 14, 17, 34, 37, 74], fits: { "alt-ops": [{ x0: 4, a: 3, b: 2 }, 77] } },
  { t: [10, 6, -12, -16, 32, 28, -56], fits: { "alt-ops": [{ x0: 10, a: -4, b: -2 }, -60] } },
  // sequences that fit no family
  { t: [1, 2, 4, 7, 12, 20, 33], fits: {} },
  { t: [5, 5, 5, 5, 5, 5, 5], fits: {} },
  { t: [3, 1, 4, 1, 5, 9, 2], fits: {} },
  { t: [2, 4, 6, 8, 10, 12, 15], fits: {} },
  { t: [1, 3, 9, 27, 81, 243, 728], fits: {} },
  { t: [562, 568, 574, 576, 582, 592, 598], fits: {} }, // P_101..P_107 + 5: s = 101 is outside [0, 100]
];

// ---------- oracle: brute force for every EV template (contract §F5) ----------

function meanOverTuples(f, k, fn) {
  const xs = new Array(k).fill(1);
  let sum = 0;
  let count = 0;
  for (;;) {
    sum += fn(xs);
    count++;
    let j = 0;
    while (j < k && xs[j] === f) { xs[j] = 1; j++; }
    if (j === k) break;
    xs[j]++;
  }
  return sum / count;
}

function meanOverCoins(n, fn) {
  let sum = 0;
  for (let mask = 0; mask < 2 ** n; mask++) {
    const bits = [];
    for (let i = 0; i < n; i++) bits.push((mask >> i) & 1);
    sum += fn(bits);
  }
  return sum / 2 ** n;
}

// Optimal stopping by exhaustive search over stopping rules: with j rerolls left you keep the
// roll iff it is >= tau_j (tau_j = f + 1 means always reroll). Every threshold vector is tried.
function bestRerollValue(f, r) {
  let best = -Infinity;
  const combos = (f + 1) ** r;
  for (let code = 0; code < combos; code++) {
    let c = code;
    let v = 0;
    for (let x = 1; x <= f; x++) v += x;
    v /= f; // no rerolls left: the roll is kept
    for (let j = 1; j <= r; j++) {
      const tau = 1 + (c % (f + 1));
      c = Math.floor(c / (f + 1));
      let s = 0;
      for (let x = 1; x <= f; x++) s += x >= tau ? x : v;
      v = s / f;
    }
    if (v > best) best = v;
  }
  return best;
}

function cardsMaxValue(k) {
  const rank = (i) => (i % 13) + 1; // 52 cards, 4 of each rank 1..13
  let sum = 0;
  let count = 0;
  const walk = (start, chosen) => {
    if (chosen.length === k) { sum += Math.max(...chosen.map(rank)); count++; return; }
    for (let i = start; i < 52; i++) walk(i + 1, chosen.concat(i));
  };
  walk(0, []);
  return sum / count;
}

// Deal one card at a time: P(first high card at position j) = P(j-1 lows first) * P(high next).
function cardsFirstHighValue(r) {
  const high = 4 * (14 - r);
  const low = 52 - high;
  let pAllLowSoFar = 1;
  let e = 0;
  for (let j = 1; j <= low + 1; j++) {
    const left = 52 - (j - 1);
    e += j * pAllLowSoFar * (high / left);
    pAllLowSoFar *= (low - (j - 1)) / left;
  }
  return e;
}

const bfCache = new Map();
function bruteForce(template, p) {
  const key = template + JSON.stringify(p);
  if (bfCache.has(key)) return bfCache.get(key);
  let v;
  switch (template) {
    case "dice-max": v = meanOverTuples(p.f, p.k, (xs) => Math.max(...xs)); break;
    case "dice-min": v = meanOverTuples(p.f, p.k, (xs) => Math.min(...xs)); break;
    case "dice-absdiff": v = meanOverTuples(p.f, 2, ([x, y]) => Math.abs(x - y)); break;
    case "dice-reroll": v = bestRerollValue(p.f, p.r); break;
    case "dice-threshold": v = meanOverTuples(6, 2, ([x, y]) => (x + y >= p.t ? x + y : -p.c)); break;
    case "dice-distinct": v = meanOverTuples(6, p.k, (xs) => new Set(xs).size); break;
    case "coins-maxrun": v = meanOverCoins(p.n, (bits) => {
      let best = 0, run = 0;
      for (const b of bits) { run = b ? run + 1 : 0; best = Math.max(best, run); }
      return best;
    }); break;
    case "coins-absdiff": v = meanOverCoins(p.n, (bits) => {
      const h = bits.reduce((a, b) => a + b, 0);
      return Math.abs(h - (bits.length - h));
    }); break;
    case "cards-max": v = cardsMaxValue(p.k); break;
    case "cards-first-high": v = cardsFirstHighValue(p.r); break;
    default: throw new Error("oracle: unknown template " + template);
  }
  bfCache.set(key, v);
  return v;
}

const EV_RANGES = {
  "dice-max": (p) => [2, 3].includes(p.k) && [4, 6, 8, 10, 12].includes(p.f),
  "dice-min": (p) => [2, 3].includes(p.k) && [4, 6, 8, 10, 12].includes(p.f),
  "dice-absdiff": (p) => [4, 6, 8, 10, 12, 20].includes(p.f),
  "dice-reroll": (p) => [4, 6, 8, 10, 12, 20].includes(p.f) && [1, 2, 3].includes(p.r),
  "dice-threshold": (p) => inR(p.t, 4, 11) && inR(p.c, 1, 5),
  "dice-distinct": (p) => inR(p.k, 2, 6),
  "coins-maxrun": (p) => inR(p.n, 3, 10),
  "coins-absdiff": (p) => inR(p.n, 2, 10),
  "cards-max": (p) => [2, 3].includes(p.k),
  "cards-first-high": (p) => inR(p.r, 10, 13),
};

const closeTo = (actual, expected, msg) =>
  assert.ok(Math.abs(actual - expected) <= 1e-9 * Math.max(1, Math.abs(expected)),
    `${msg}: got ${actual}, expected ${expected}`);

// ---------- oracle: eighty categories (contract §F3) ----------

// dec(N, k): the integer N divided by 10^k, as a plain decimal with trailing zeros removed.
function myDec(N, k) {
  const s = String(Math.abs(N)).padStart(k + 1, "0");
  const int = s.slice(0, s.length - k);
  const frac = s.slice(s.length - k).replace(/0+$/, "");
  return (N < 0 ? "-" : "") + int + (frac ? "." + frac : "");
}

const PCT_SET = [5, 10, 12.5, 15, 20, 25, 30, 40, 50, 60, 75, 80];
const FRAC_DENOMS = [2, 4, 5, 8, 10, 16, 20, 25, 40];

// For each category: exact param keys, range check, expected prompt, expected value.
const EIGHTY_SPEC = {
  "add-dec": { keys: ["A", "B"], ok: (p) => inR(p.A, 100, 9999) && inR(p.B, 100, 9999),
    prompt: (p) => `${myDec(p.A, 2)} + ${myDec(p.B, 2)}`, value: (p) => (p.A + p.B) / 100 },
  "sub-dec": { keys: ["A", "B"], ok: (p) => inR(p.A, 100, 9999) && inR(p.B, 100, 9999),
    prompt: (p) => `${myDec(p.A, 2)} – ${myDec(p.B, 2)}`, value: (p) => (p.A - p.B) / 100 },
  "mul-2x2": { keys: ["a", "b"], ok: (p) => inR(p.a, 11, 99) && inR(p.b, 11, 99),
    prompt: (p) => `${p.a} × ${p.b}`, value: (p) => p.a * p.b },
  "mul-3x2": { keys: ["a", "b"], ok: (p) => inR(p.a, 100, 999) && inR(p.b, 11, 99),
    prompt: (p) => `${p.a} × ${p.b}`, value: (p) => p.a * p.b },
  "mul-dec": { keys: ["A", "b"], ok: (p) => inR(p.A, 11, 99) && inR(p.b, 2, 19),
    prompt: (p) => `${myDec(p.A, 1)} × ${p.b}`, value: (p) => (p.A * p.b) / 10 },
  div: { keys: ["b", "q"], ok: (p) => inR(p.b, 2, 19) && inR(p.q, 2, 99),
    prompt: (p) => `${p.b * p.q} ÷ ${p.b}`, value: (p) => p.q },
  pct: { keys: ["n", "p"], ok: (p) => PCT_SET.includes(p.p) && inR(p.n, 10, 999),
    prompt: (p) => `${p.p}% of ${p.n}`, value: (p) => (Math.round(p.p * 10) * p.n) / 1000 },
  frac: { keys: ["d", "k"], ok: (p) => FRAC_DENOMS.includes(p.d) && inR(p.k, 1, p.d - 1),
    prompt: (p) => `${p.k}/${p.d} as a decimal`, value: (p) => p.k / p.d },
};

// A terminating decimal: no exponent, no leading zeros, no trailing zeros, at most 4 places,
// a leading "0." when |x| < 1, an ASCII minus sign.
const CANON_DECIMAL = /^-?(0|[1-9]\d*)(\.\d{0,3}[1-9])?$/;

// ======================================================================================
// 1. Exports and constants
// ======================================================================================

test("KINDS, TIME_LIMITS, QUESTION_COUNTS and SEQ_SHOWN have the contract values", () => {
  assert.deepEqual(OA.KINDS, KIND_IDS);
  assert.deepEqual(OA.TIME_LIMITS, { eighty: 480, seq: 600, ev: 300 });
  assert.deepEqual(OA.QUESTION_COUNTS, { eighty: 80, seq: 15, ev: 20 });
  assert.equal(OA.SEQ_SHOWN, 7);
});

test("SEQ_FAMILIES and EV_TEMPLATES list the ids in contract order", () => {
  assert.deepEqual(OA.SEQ_FAMILIES, FAMILIES);
  assert.deepEqual(OA.EV_TEMPLATES, TEMPLATES);
});

test("EIGHTY_CATEGORIES names exactly the eight eighty categories", () => {
  assert.ok(Array.isArray(OA.EIGHTY_CATEGORIES));
  assert.equal(OA.EIGHTY_CATEGORIES.length, 8);
  const ids = OA.EIGHTY_CATEGORIES.map((c) =>
    (typeof c === "string" ? c : c && (c.id ?? c.category ?? c.name)));
  assert.deepEqual([...ids].sort(), [...EIGHTY_IDS].sort());
});

test("PRIMES is the first 120 primes starting at P_0 = 2", () => {
  assert.equal(OA.PRIMES.length, 120);
  assert.deepEqual([...OA.PRIMES], P);
  assert.equal(OA.PRIMES[0], 2);
});

// ======================================================================================
// 2. Config helpers (§F2, §F6)
// ======================================================================================

test("defaultConfig: arith matches the Zetamac defaults (add 2-100 + 2-100, mul 2-12 x 2-100, 120 s)", () => {
  assert.deepEqual(OA.defaultConfig("arith"), ARITH_DEFAULT);
  assert.deepEqual(OA.defaultConfig("eighty"), { negativeMarking: false });
  assert.deepEqual(OA.defaultConfig("seq"), {});
  assert.deepEqual(OA.defaultConfig("ev"), {});
});

test("normalizeConfig arith fills missing keys from the default, in canonical key order", () => {
  assert.deepEqual(OA.normalizeConfig("arith", {}), ARITH_DEFAULT);
  assert.deepEqual(OA.normalizeConfig("arith", undefined), ARITH_DEFAULT);
  const partial = OA.normalizeConfig("arith", { durationSecs: 60, mulB: [5, 9], ops: ["mul"] });
  assert.deepEqual(partial, { ...ARITH_DEFAULT, ops: ["mul"], mulB: [5, 9], durationSecs: 60 });
  assert.deepEqual(Object.keys(partial), ARITH_KEYS);
  assert.deepEqual(Object.keys(OA.normalizeConfig("arith", {})), ARITH_KEYS);
});

test("normalizeConfig arith keeps the distinct known ops in canonical order add, sub, mul, div", () => {
  assert.deepEqual(OA.normalizeConfig("arith", { ops: ["div", "add", "add", "pow"] }).ops, ["add", "div"]);
  assert.deepEqual(OA.normalizeConfig("arith", { ops: ["div", "mul", "sub", "add"] }).ops, ARITH_DEFAULT.ops);
  assert.deepEqual(OA.normalizeConfig("arith", { ops: ["mod", "pow"] }).ops, []);
  assert.deepEqual(OA.normalizeConfig("arith", { ops: [] }).ops, []);
});

test("normalizeConfig arith turns numeric strings into numbers so a UI default game stays default", () => {
  const fromUi = {
    ops: ["add", "sub", "mul", "div"],
    addA: ["2", "100"], addB: ["2", "100"], mulA: ["2", "12"], mulB: ["2", "100"],
    durationSecs: "120",
  };
  assert.deepEqual(OA.normalizeConfig("arith", fromUi), ARITH_DEFAULT);
  assert.equal(OA.isDefaultConfig("arith", fromUi), true);
  assert.equal(OA.normalizeConfig("arith", { durationSecs: "45" }).durationSecs, 45);
});

test("normalizeConfig arith keeps present-but-invalid values and never throws", () => {
  assert.deepEqual(OA.normalizeConfig("arith", { addA: [5, 2] }).addA, [5, 2]);
  assert.equal(OA.normalizeConfig("arith", { durationSecs: 3.5 }).durationSecs, 3.5);
  assert.ok(Number.isNaN(OA.normalizeConfig("arith", { durationSecs: NaN }).durationSecs));
  const bad = OA.normalizeConfig("arith", { mulA: ["5", "x"] }).mulA;
  assert.equal(bad[0], 5);
  assert.ok(Number.isNaN(bad[1]));
  for (const c of [null, undefined, {}, { ops: "nonsense" }, { addA: "2-100" }, { durationSecs: {} }]) {
    assert.doesNotThrow(() => OA.normalizeConfig("arith", c));
  }
});

test("normalizeConfig eighty keeps only negativeMarking === true; seq and ev normalise to {}", () => {
  assert.deepEqual(OA.normalizeConfig("eighty", { negativeMarking: true }), { negativeMarking: true });
  assert.deepEqual(OA.normalizeConfig("eighty", { negativeMarking: "true" }), { negativeMarking: false });
  assert.deepEqual(OA.normalizeConfig("eighty", { negativeMarking: 1 }), { negativeMarking: false });
  assert.deepEqual(OA.normalizeConfig("eighty", {}), { negativeMarking: false });
  assert.deepEqual(OA.normalizeConfig("eighty", undefined), { negativeMarking: false });
  assert.deepEqual(OA.normalizeConfig("seq", { anything: 1 }), {});
  assert.deepEqual(OA.normalizeConfig("ev", { negativeMarking: true }), {});
});

test("normalizeConfig and configError do not mutate their argument", () => {
  const c = { ops: ["div", "add", "add"], addA: ["3", "50"], durationSecs: "90" };
  const before = clone(c);
  OA.normalizeConfig("arith", c);
  OA.configError("arith", c);
  OA.isDefaultConfig("arith", c);
  OA.sameConfig("arith", c, ARITH_DEFAULT);
  assert.deepEqual(c, before);
});

test("configError arith accepts the default, valid custom configs and the boundary values", () => {
  const valid = [
    undefined, {}, ARITH_DEFAULT,
    { ops: ["add", "sub", "mul"], mulA: [0, 12] }, // mulA may start at 0 when div is off
    { mulA: [1, 1] },
    { addA: [0, 0], addB: [10000, 10000] },
    { durationSecs: 10 }, { durationSecs: 600 }, { durationSecs: "60" },
    { ops: ["div"], mulA: [1, 50], mulB: [0, 500] },
  ];
  for (const c of valid) assert.equal(OA.configError("arith", c), null, JSON.stringify(c));
});

test("configError arith reports empty ops, bad ranges, div with mulA below 1 and bad durations", () => {
  const invalid = [
    { ops: [] }, { ops: ["pow"] },
    { addA: [5, 2] }, { addB: [-1, 10] }, { mulB: [0, 10001] }, { mulA: [1.5, 12] }, { addA: [2] },
    { mulB: [2, NaN] }, { addA: ["x", "10"] },
    { mulA: [0, 12] }, // div is on by default
    { ops: ["div"], mulA: [0, 5] },
    { durationSecs: 9 }, { durationSecs: 601 }, { durationSecs: 30.5 }, { durationSecs: NaN },
    { durationSecs: "abc" },
  ];
  for (const c of invalid) {
    const e = OA.configError("arith", c);
    assert.equal(typeof e, "string", JSON.stringify(c));
    assert.ok(e.length > 0, JSON.stringify(c));
  }
});

test("configError is null for eighty, seq and ev whatever the config", () => {
  assert.equal(OA.configError("eighty", { negativeMarking: true }), null);
  assert.equal(OA.configError("eighty", { negativeMarking: "maybe" }), null);
  assert.equal(OA.configError("eighty", undefined), null);
  assert.equal(OA.configError("seq", { durationSecs: 1 }), null);
  assert.equal(OA.configError("ev", {}), null);
});

test("isDefaultConfig: only the Zetamac default arith config counts as default", () => {
  assert.equal(OA.isDefaultConfig("arith", ARITH_DEFAULT), true);
  assert.equal(OA.isDefaultConfig("arith", {}), true);
  assert.equal(OA.isDefaultConfig("arith", { ops: ["div", "mul", "add", "sub", "add"] }), true);
  assert.equal(OA.isDefaultConfig("arith", {
    durationSecs: 120, mulB: [2, 100], mulA: [2, 12], addB: [2, 100], addA: [2, 100], ops: ARITH_DEFAULT.ops,
  }), true); // key order of the input does not matter
  assert.equal(OA.isDefaultConfig("arith", { durationSecs: 60 }), false);
  assert.equal(OA.isDefaultConfig("arith", { ops: ["add", "sub", "mul"] }), false);
  assert.equal(OA.isDefaultConfig("arith", { mulA: [2, 13] }), false);
  assert.equal(OA.isDefaultConfig("arith", { addB: [1, 100] }), false);
  assert.equal(OA.isDefaultConfig("eighty", {}), true);
  assert.equal(OA.isDefaultConfig("eighty", { negativeMarking: true }), false);
  assert.equal(OA.isDefaultConfig("seq", { whatever: 1 }), true);
});

test("sameConfig compares normalised configs", () => {
  assert.equal(OA.sameConfig("arith", { addA: ["2", "100"] }, {}), true);
  assert.equal(OA.sameConfig("arith", { ops: ["mul", "add"] }, { ops: ["add", "mul", "mul"] }), true);
  assert.equal(OA.sameConfig("arith", { ops: ["mul"] }, { ops: ["add"] }), false);
  assert.equal(OA.sameConfig("arith", { durationSecs: 60 }, { durationSecs: "60" }), true);
  assert.equal(OA.sameConfig("arith", { durationSecs: 60 }, { durationSecs: 90 }), false);
  assert.equal(OA.sameConfig("eighty", {}, { negativeMarking: false }), true);
  assert.equal(OA.sameConfig("eighty", { negativeMarking: true }, { negativeMarking: false }), false);
  assert.equal(OA.sameConfig("ev", { a: 1 }, { b: 2 }), true);
});

test("formatClock shows m:ss with the seconds rounded up and clamped at zero", () => {
  assert.equal(OA.formatClock(120), "2:00");
  assert.equal(OA.formatClock(59.2), "1:00");
  assert.equal(OA.formatClock(61), "1:01");
  assert.equal(OA.formatClock(9.0001), "0:10");
  assert.equal(OA.formatClock(0.3), "0:01");
  assert.equal(OA.formatClock(0), "0:00");
  assert.equal(OA.formatClock(-7), "0:00");
  assert.equal(OA.formatClock(600), "10:00");
  assert.equal(OA.formatClock(3599), "59:59");
});

// ======================================================================================
// 3. generate: common shape and determinism (§F1)
// ======================================================================================

test("required (spec §5): every generator is deterministic for a given seed", () => {
  const configs = {
    arith: [undefined, { ops: ["mul", "div"], mulA: [3, 30], durationSecs: 30 }],
    eighty: [undefined, { negativeMarking: true }],
    seq: [undefined],
    ev: [undefined],
  };
  for (const kind of KIND_IDS) {
    for (const seed of [0, 1, 42, 987654321, 4294967295]) {
      for (const cfg of configs[kind]) {
        const a = OA.generate(kind, seed, cfg === undefined ? undefined : clone(cfg));
        // other calls in between must not influence a later call (no hidden shared state)
        OA.generate(kind, seed + 1, cfg === undefined ? undefined : clone(cfg));
        OA.generate(KIND_IDS[(KIND_IDS.indexOf(kind) + 1) % 4], seed);
        const b = OA.generate(kind, seed, cfg === undefined ? undefined : clone(cfg));
        assert.deepEqual(a, b, `${kind} seed ${seed}`);
      }
    }
  }
});

test("generate: different seeds give different runs for every kind", () => {
  for (const kind of KIND_IDS) {
    const seen = new Set([1, 2, 3, 4, 5].map((s) => JSON.stringify(OA.generate(kind, s).questions)));
    assert.ok(seen.size >= 2, kind);
  }
});

test("generate returns { kind, seed >>> 0, normalised config, timeLimitSecs, questions }", () => {
  const arith = OA.generate("arith", 42);
  assert.equal(arith.kind, "arith");
  assert.equal(arith.seed, 42);
  assert.deepEqual(arith.config, ARITH_DEFAULT);
  assert.equal(arith.timeLimitSecs, 120);
  const eighty = OA.generate("eighty", 7, { negativeMarking: true });
  assert.deepEqual(eighty.config, { negativeMarking: true });
  assert.equal(eighty.timeLimitSecs, 480);
  assert.deepEqual(OA.generate("eighty", 7, { negativeMarking: "yes" }).config, { negativeMarking: false });
  const seq = OA.generate("seq", 7, { junk: 1 });
  assert.deepEqual(seq.config, {});
  assert.equal(seq.timeLimitSecs, 600);
  const ev = OA.generate("ev", 7);
  assert.deepEqual(ev.config, {});
  assert.equal(ev.timeLimitSecs, 300);
  assert.equal(OA.generate("ev", -1).seed, 4294967295);
});

test("generate coerces the seed with >>> 0 (seed and seed + 2^32 give the same run)", () => {
  for (const kind of KIND_IDS) {
    const a = OA.generate(kind, 7);
    const b = OA.generate(kind, 7 + 2 ** 32);
    assert.equal(b.seed, 7);
    assert.deepEqual(a, b, kind);
  }
});

test("generate throws on an unknown kind or an invalid arith config", () => {
  assert.throws(() => OA.generate("chess", 1));
  assert.throws(() => OA.generate("arith", 1, { addA: [5, 2] }));
  assert.throws(() => OA.generate("arith", 1, { ops: [] }));
  assert.throws(() => OA.generate("arith", 1, { durationSecs: 5 }));
  assert.throws(() => OA.generate("arith", 1, { mulA: [0, 12] }));
  assert.doesNotThrow(() => OA.generate("eighty", 1, { negativeMarking: "maybe" }));
});

test("generate does not mutate the config it is given", () => {
  const c = { ops: ["div", "add"], addA: ["5", "60"], mulA: [2, 9], durationSecs: "20" };
  const before = clone(c);
  OA.generate("arith", 3, c);
  assert.deepEqual(c, before);
  const e = { negativeMarking: true };
  OA.generate("eighty", 3, e);
  assert.deepEqual(e, { negativeMarking: true });
});

test("every question has i, a plain-text prompt and an answer.value that parseAnswer accepts", () => {
  for (const kind of KIND_IDS) {
    for (const seed of [11, 12]) {
      const run = OA.generate(kind, seed);
      run.questions.forEach((q, i) => {
        assert.equal(q.i, i, `${kind} question index`);
        assert.equal(typeof q.prompt, "string");
        assert.ok(q.prompt.trim().length > 0, `${kind} prompt is non-empty`);
        assert.equal(typeof q.answer.value, "string");
        assert.equal(parseAnswer(q.answer.value).ok, true, `${kind} ${q.answer.value}`);
        assert.equal(checkNumeric(q.answer.value, q).correct, true, `${kind} own answer is correct`);
      });
    }
  }
});

test("answer tolerances: arith and seq exact, eighty abs 1e-9, ev uses the checkNumeric default", () => {
  for (const q of OA.generate("arith", 5).questions) assert.deepEqual(q.answer.tol, { rel: 0, abs: 0 });
  for (const q of OA.generate("seq", 5).questions) assert.deepEqual(q.answer.tol, { rel: 0, abs: 0 });
  for (const q of OA.generate("eighty", 5).questions) assert.deepEqual(q.answer.tol, { rel: 0, abs: 1e-9 });
  // ev: no tolerance of its own, so checkNumeric's default (rel 1e-3) applies
  for (const seed of [5, 6]) {
    for (const q of OA.generate("ev", seed).questions) {
      const v = parsedValue(q);
      if (Math.abs(v) < 1e-6) continue;
      assert.equal(checkNumeric(String(v * (1 + 5e-4)), q).correct, true, `${q.template} within 0.05%`);
      assert.equal(checkNumeric(String(v * (1 + 2e-3)), q).correct, false, `${q.template} off by 0.2%`);
    }
  }
});

// ======================================================================================
// 4. arith (Zetamac clone, §F2)
// ======================================================================================

test("arith default run: 120 s and 4 x 120 = 480 questions", () => {
  const run = OA.generate("arith", 9);
  assert.equal(run.timeLimitSecs, 120);
  assert.equal(run.questions.length, 480);
  const short = OA.generate("arith", 9, { durationSecs: 30 });
  assert.equal(short.timeLimitSecs, 30);
  assert.equal(short.questions.length, 120);
  const fromStrings = OA.generate("arith", 9, { durationSecs: "60" });
  assert.equal(fromStrings.timeLimitSecs, 60);
  assert.equal(fromStrings.questions.length, 240);
});

test("arith seed 42 with the default config starts with the contract reference questions", () => {
  const qs = OA.generate("arith", 42).questions.slice(0, 6);
  assert.deepEqual(qs.map((q) => `${q.prompt} = ${q.answer.value}`), [
    "6 × 86 = 516", "3 × 54 = 162", "150 – 63 = 87",
    "115 – 26 = 89", "5 × 21 = 105", "9 × 62 = 558",
  ]);
});

test("arith generation reproduces exactly from mulberry32 (op, left, right, prompt, answer)", () => {
  const cases = [
    [42, ARITH_DEFAULT, undefined],
    [1, ARITH_DEFAULT, undefined],
    [0, ARITH_DEFAULT, {}],
    [4294967295, ARITH_DEFAULT, ARITH_DEFAULT],
    [2024, { ops: ["sub", "div"], addA: [10, 20], addB: [1, 5], mulA: [3, 3], mulB: [0, 7], durationSecs: 10 },
      { ops: ["div", "sub"], addA: [10, 20], addB: [1, 5], mulA: [3, 3], mulB: [0, 7], durationSecs: 10 }],
    [77, { ...ARITH_DEFAULT, ops: ["add", "mul"], addA: [50, 5000], mulB: [100, 999], durationSecs: 15 },
      { ops: ["mul", "add"], addA: ["50", "5000"], mulB: [100, 999], durationSecs: "15" }],
  ];
  for (const [seed, normalised, given] of cases) {
    const run = OA.generate("arith", seed, given);
    const ref = refArith(seed, normalised);
    assert.deepEqual(run.config, normalised, `seed ${seed}: the run carries the normalised config`);
    assert.equal(run.timeLimitSecs, normalised.durationSecs);
    assert.equal(run.questions.length, ref.length);
    run.questions.forEach((q, i) => {
      const r = ref[i];
      assert.deepEqual({ op: q.op, left: q.left, right: q.right, prompt: q.prompt, value: q.answer.value },
        { op: r.op, left: r.left, right: r.right, prompt: r.prompt, value: String(r.ans) },
        `seed ${seed} question ${i}`);
    });
  }
});

test("arith uses only the configured ops, all four by default, with the configured ranges", () => {
  const run = OA.generate("arith", 31);
  assert.deepEqual(Object.keys(countBy(run.questions, (q) => q.op)).sort(), ["add", "div", "mul", "sub"]);
  for (const seed of [31, 32, 33]) {
    for (const q of OA.generate("arith", seed).questions) {
      const ans = parsedValue(q);
      if (q.op === "add") {
        assert.ok(inR(q.left, 2, 100) && inR(q.right, 2, 100));
        assert.equal(ans, q.left + q.right);
      } else if (q.op === "sub") {
        assert.ok(inR(q.right, 2, 100) && inR(ans, 2, 100), "sub is the inverse of addition");
        assert.equal(q.left, q.right + ans);
      } else if (q.op === "mul") {
        assert.ok(inR(q.left, 2, 12) && inR(q.right, 2, 100));
        assert.equal(ans, q.left * q.right);
      } else {
        assert.equal(q.op, "div");
        assert.ok(inR(q.right, 2, 12) && inR(ans, 2, 100), "div is the inverse of multiplication");
        assert.equal(q.left, q.right * ans);
      }
    }
  }
  const onlyMul = OA.generate("arith", 8, { ops: ["mul"], mulA: [20, 25], mulB: [300, 310], durationSecs: 20 });
  for (const q of onlyMul.questions) {
    assert.equal(q.op, "mul");
    assert.ok(inR(q.left, 20, 25) && inR(q.right, 300, 310));
  }
  const onlySub = OA.generate("arith", 8, { ops: ["sub"], addA: [7, 9], addB: [1000, 1001], durationSecs: 20 });
  for (const q of onlySub.questions) {
    assert.equal(q.op, "sub");
    assert.ok(inR(q.right, 7, 9) && inR(parsedValue(q), 1000, 1001));
  }
});

test("required (spec §5): arith answers are integers and division questions are exact", () => {
  const runs = [
    OA.generate("arith", 100), OA.generate("arith", 101), OA.generate("arith", 102),
    OA.generate("arith", 103, { ops: ["div"], mulA: [1, 50], mulB: [0, 500], durationSecs: 30 }),
  ];
  let divs = 0;
  for (const run of runs) {
    for (const q of run.questions) {
      assert.match(q.answer.value, /^\d+$/, "answer is a plain integer string");
      const ans = parsedValue(q);
      assert.ok(Number.isInteger(ans));
      assert.equal(checkNumeric(String(ans), q).correct, true);
      assert.equal(checkNumeric(String(ans + 1), q).correct, false);
      if (q.op === "div") {
        divs++;
        assert.ok(q.right >= 1, "never divides by zero");
        assert.equal(q.left % q.right, 0, `${q.prompt} is exact`);
        assert.equal(q.left / q.right, ans);
        assert.equal(q.prompt, `${q.left} ÷ ${q.right}`);
      }
    }
  }
  assert.ok(divs > 200);
});

test("arith prompts use the Zetamac symbols + – × ÷", () => {
  for (const q of OA.generate("arith", 64).questions) {
    assert.equal(q.prompt, `${q.left} ${ARITH_SYM[q.op]} ${q.right}`);
  }
});

// ======================================================================================
// 5. eighty (Optiver 80-in-8, §F3)
// ======================================================================================

test("eighty: 80 questions in 480 s, exactly 10 per category", () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const run = OA.generate("eighty", seed);
    assert.equal(run.timeLimitSecs, 480);
    assert.equal(run.questions.length, 80);
    const counts = countBy(run.questions, (q) => q.category);
    assert.deepEqual(Object.keys(counts).sort(), [...EIGHTY_IDS].sort());
    for (const id of EIGHTY_IDS) assert.equal(counts[id], 10, `${id} seed ${seed}`);
  }
});

test("eighty: params hold exactly the category's parameters, within the contract ranges", () => {
  for (const seed of [6, 7, 8, 9, 10, 11]) {
    for (const q of OA.generate("eighty", seed).questions) {
      const spec = EIGHTY_SPEC[q.category];
      assert.ok(spec, `known category ${q.category}`);
      assert.deepEqual(Object.keys(q.params).sort(), spec.keys, q.category);
      assert.ok(spec.ok(q.params), `${q.category} ${JSON.stringify(q.params)} in range`);
    }
  }
});

test("eighty: prompts follow the category templates and answers are exact canonical decimals", () => {
  for (const seed of [12, 13, 14, 15, 16]) {
    for (const q of OA.generate("eighty", seed).questions) {
      const spec = EIGHTY_SPEC[q.category];
      assert.equal(q.prompt, spec.prompt(q.params), q.category);
      const expected = spec.value(q.params);
      assert.match(q.answer.value, CANON_DECIMAL, `${q.category} ${q.answer.value}`);
      assert.notEqual(q.answer.value, "-0");
      assert.ok(Math.abs(parsedValue(q) - expected) <= 1e-9, `${q.prompt} = ${expected}`);
      assert.equal(checkNumeric(String(expected), q).correct, true);
      assert.equal(checkNumeric(String(expected + 0.01), q).correct, false);
    }
  }
});

test("eighty: mixed arithmetic covers decimals, signed differences, fractions and percentages", () => {
  const qs = [20, 21, 22, 23, 24, 25].flatMap((s) => OA.generate("eighty", s).questions);
  for (const q of qs.filter((x) => x.category === "sub-dec")) {
    const exp = (q.params.A - q.params.B) / 100; // may be negative
    assert.ok(Math.abs(parsedValue(q) - exp) <= 1e-9, q.prompt);
    if (exp < 0) assert.ok(q.answer.value.startsWith("-"), q.answer.value);
  }
  for (const q of qs.filter((x) => x.category === "frac")) {
    assert.ok(parsedValue(q) > 0 && parsedValue(q) < 1);
    assert.ok(q.answer.value.startsWith("0."), q.answer.value);
  }
  for (const q of qs.filter((x) => x.category === "pct" && x.params.p === 12.5)) {
    assert.ok(q.prompt.startsWith("12.5% of "), q.prompt);
  }
});

test("eighty: question order is shuffled with the run's rng (not grouped by category)", () => {
  const orders = new Set();
  for (const seed of [30, 31, 32]) {
    const cats = OA.generate("eighty", seed).questions.map((q) => q.category);
    let changes = 0;
    for (let i = 1; i < cats.length; i++) if (cats[i] !== cats[i - 1]) changes++;
    assert.ok(changes > 7, `seed ${seed}: categories are interleaved`);
    orders.add(cats.join(","));
  }
  assert.ok(orders.size >= 2, "the order depends on the seed");
});

test("eighty: negative marking is a config flag carried on the run", () => {
  assert.deepEqual(OA.generate("eighty", 40).config, { negativeMarking: false });
  assert.deepEqual(OA.generate("eighty", 40, { negativeMarking: true }).config, { negativeMarking: true });
  assert.equal(OA.generate("eighty", 40, { negativeMarking: true }).questions.length, 80);
});

// ======================================================================================
// 6. seq (§F4)
// ======================================================================================

const SEQ_SEEDS = [0, 42, 4294967295, 123456789, ...range(1, 60)];
const seqRunCache = new Map();
const seqRun = (seed) => {
  if (!seqRunCache.has(seed)) seqRunCache.set(seed, OA.generate("seq", seed));
  return seqRunCache.get(seed);
};

test("seq: 15 questions in 600 s, each family at least once and at most twice", () => {
  for (const seed of SEQ_SEEDS.slice(0, 20)) {
    const run = seqRun(seed);
    assert.equal(run.timeLimitSecs, 600);
    assert.equal(run.questions.length, 15);
    const counts = countBy(run.questions, (q) => q.family);
    for (const f of FAMILIES) {
      assert.ok(counts[f] >= 1 && counts[f] <= 2, `seed ${seed}: ${f} appears ${counts[f]} times`);
    }
    assert.deepEqual(Object.keys(counts).sort(), [...FAMILIES].sort());
  }
});

test("seq: shown has 7 integers, the prompt lists them, the answer is t_7, all within 100000", () => {
  for (const seed of SEQ_SEEDS) {
    for (const q of seqRun(seed).questions) {
      assert.ok(Array.isArray(q.shown) && q.shown.length === 7);
      for (const v of q.shown) assert.ok(Number.isInteger(v) && Math.abs(v) <= 100000, `term ${v}`);
      assert.equal(q.prompt, q.shown.join(", ") + ", ?");
      const ans = parsedValue(q);
      assert.ok(Number.isInteger(ans) && Math.abs(ans) <= 100000, `answer ${ans}`);
      assert.equal(ans, myNext(q.family, q.shown), `${q.family} ${q.prompt}`);
      assert.equal(checkNumeric(String(ans), q).correct, true);
      assert.equal(checkNumeric(String(ans + 1), q).correct, false);
    }
  }
});

test("seq: params equal the family fit and lie in the generation ranges (primes never uses s = 2)", () => {
  for (const seed of SEQ_SEEDS) {
    for (const q of seqRun(seed).questions) {
      assert.deepEqual(nzObj(q.params), myFit(q.family, q.shown), `${q.family} ${q.prompt}`);
      assert.deepEqual(q.params, OA.seqFit(q.family, q.shown));
      assert.ok(SEQ_RANGES[q.family](q.params), `${q.family} ${JSON.stringify(q.params)} in range`);
      if (q.family === "primes") assert.notEqual(q.params.s, 2);
    }
  }
});

test("required (spec §5): every seq family's next term is unique (no two families fit and disagree)", () => {
  let checked = 0;
  for (const seed of SEQ_SEEDS) {
    for (const q of seqRun(seed).questions) {
      const ans = parsedValue(q);
      assert.equal(myNext(q.family, q.shown), ans, "the question's own family fits (not vacuous)");
      for (const f of FAMILIES) {
        const mine = myNext(f, q.shown);
        assert.ok(mine === null || mine === ans,
          `seed ${seed}: ${f} predicts ${mine} but the answer is ${ans} for ${q.prompt}`);
        checked++;
      }
    }
  }
  assert.ok(checked >= SEQ_SEEDS.length * 15 * 8);
});

// Within the §F4 ranges a cross-family conflict is rare: about 1 interleaved draw in 10,000
// (d1 = d2 = 6 with a2 = a1 + 2) also fits primes with s = 2 and predicts a different next term.
// Draw order is implementation-defined, so no fixed seed is known to hit one. A wide sweep makes
// it very likely that the generator meets such a draw, which it must reject.
test("required (spec §5): seq next-term uniqueness also holds on a wide seed sweep (rejection of conflicting draws)", () => {
  const N = 20000;
  let questions = 0;
  for (let seed = 100000; seed < 100000 + N; seed++) {
    for (const q of OA.generate("seq", seed).questions) {
      questions++;
      const ans = parseAnswer(q.answer.value).value;
      for (const f of FAMILIES) {
        const mine = myNext(f, q.shown);
        if (mine !== null && mine !== ans) {
          assert.fail(`seed ${seed}: ${f} predicts ${mine} but the answer is ${ans} for ${q.prompt}`);
        }
      }
    }
  }
  assert.equal(questions, N * 15);
});

test("seqFit / seqNext agree with an independent fit for all 8 families on every generated sequence", () => {
  for (const seed of SEQ_SEEDS) {
    for (const q of seqRun(seed).questions) {
      for (const f of FAMILIES) {
        const fit = OA.seqFit(f, q.shown);
        const next = OA.seqNext(f, q.shown);
        assert.deepEqual(nzObj(fit), myFit(f, q.shown), `seqFit ${f} on ${q.prompt}`);
        assert.equal(nz(next), myNext(f, q.shown), `seqNext ${f} on ${q.prompt}`);
      }
    }
  }
});

test("seqFit / seqNext on hand-made sequences, including ones that fit no family", () => {
  for (const { t, fits } of HAND) {
    const before = [...t];
    for (const f of FAMILIES) {
      const want = fits[f] || [null, null];
      // the oracle itself agrees with the hand-computed expectation
      assert.deepEqual(myFit(f, t), want[0], `oracle fit ${f} ${t}`);
      assert.equal(myNext(f, t), want[1], `oracle next ${f} ${t}`);
      assert.deepEqual(nzObj(OA.seqFit(f, t)), want[0], `seqFit ${f} ${t}`);
      assert.equal(nz(OA.seqNext(f, t)), want[1], `seqNext ${f} ${t}`);
    }
    assert.deepEqual(t, before, "inputs are not mutated");
  }
});

test("seqNext is null exactly when seqFit is null; an unknown family id throws", () => {
  const seqs = HAND.map((h) => h.t).concat(seqRun(3).questions.map((q) => q.shown));
  for (const t of seqs) {
    for (const f of FAMILIES) {
      assert.equal(OA.seqFit(f, t) === null, OA.seqNext(f, t) === null, `${f} ${t}`);
    }
  }
  assert.throws(() => OA.seqFit("triangular", [1, 3, 6, 10, 15, 21, 28]));
  assert.throws(() => OA.seqNext("triangular", [1, 3, 6, 10, 15, 21, 28]));
});

test("seq: question order and content depend on the seed", () => {
  const a = seqRun(1).questions.map((q) => q.prompt).join("|");
  const b = seqRun(2).questions.map((q) => q.prompt).join("|");
  assert.notEqual(a, b);
});

// ======================================================================================
// 7. ev (§F5)
// ======================================================================================

const EV_SEEDS = [0, 4294967295, ...range(1, 25)];

test("ev: 20 questions in 300 s, each of the 10 templates exactly twice", () => {
  const orders = new Set();
  for (const seed of EV_SEEDS.slice(0, 10)) {
    const run = OA.generate("ev", seed);
    assert.equal(run.timeLimitSecs, 300);
    assert.equal(run.questions.length, 20);
    const counts = countBy(run.questions, (q) => q.template);
    assert.deepEqual(Object.keys(counts).sort(), [...TEMPLATES].sort());
    for (const id of TEMPLATES) assert.equal(counts[id], 2, `${id} seed ${seed}`);
    orders.add(run.questions.map((q) => q.template).join(","));
  }
  assert.ok(orders.size >= 2, "the template order is shuffled with the run's rng");
});

test("ev: params lie in the template ranges and prompts are non-empty strings", () => {
  for (const seed of EV_SEEDS) {
    for (const q of OA.generate("ev", seed).questions) {
      assert.ok(EV_RANGES[q.template], `known template ${q.template}`);
      assert.ok(q.params && EV_RANGES[q.template](q.params), `${q.template} ${JSON.stringify(q.params)}`);
      assert.equal(typeof q.prompt, "string");
      assert.ok(q.prompt.trim().length > 0);
    }
  }
});

test("required (spec §5): every ev answer matches an independent brute-force enumeration for 20+ seeds per template", () => {
  // the oracle first reproduces the contract's reference values
  closeTo(bruteForce("dice-max", { k: 2, f: 6 }), 161 / 36, "oracle dice-max");
  closeTo(bruteForce("dice-min", { k: 2, f: 6 }), 91 / 36, "oracle dice-min");
  closeTo(bruteForce("dice-absdiff", { f: 6 }), 35 / 18, "oracle dice-absdiff");
  closeTo(bruteForce("dice-reroll", { f: 6, r: 1 }), 4.25, "oracle dice-reroll r=1");
  closeTo(bruteForce("dice-reroll", { f: 6, r: 2 }), 14 / 3, "oracle dice-reroll r=2");
  closeTo(bruteForce("dice-reroll", { f: 6, r: 3 }), 89 / 18, "oracle dice-reroll r=3");
  closeTo(bruteForce("dice-distinct", { k: 2 }), 11 / 6, "oracle dice-distinct");
  closeTo(bruteForce("coins-maxrun", { n: 3 }), 1.375, "oracle coins-maxrun n=3");
  closeTo(bruteForce("coins-maxrun", { n: 4 }), 1.6875, "oracle coins-maxrun n=4");
  closeTo(bruteForce("coins-absdiff", { n: 2 }), 1, "oracle coins-absdiff n=2");
  closeTo(bruteForce("coins-absdiff", { n: 3 }), 1.5, "oracle coins-absdiff n=3");
  closeTo(bruteForce("cards-first-high", { r: 13 }), 10.6, "oracle cards-first-high r=13");
  closeTo(bruteForce("cards-first-high", { r: 10 }), 53 / 17, "oracle cards-first-high r=10");
  for (const r of [10, 11, 12, 13]) { // 1 + (low cards) / (high cards + 1), a second derivation
    const high = 4 * (14 - r);
    closeTo(bruteForce("cards-first-high", { r }), 1 + (52 - high) / (high + 1), `oracle first-high r=${r}`);
  }

  const seedsPerTemplate = Object.fromEntries(TEMPLATES.map((t) => [t, new Set()]));
  for (const seed of EV_SEEDS) {
    for (const q of OA.generate("ev", seed).questions) {
      const bf = bruteForce(q.template, q.params);
      closeTo(parsedValue(q), bf, `seed ${seed} ${q.template} ${JSON.stringify(q.params)}`);
      // answers are checked with checkNumeric
      assert.equal(checkNumeric(String(bf), q).correct, true, `${q.template} brute force accepted`);
      const wrong = bf + 0.05 * Math.max(1, Math.abs(bf)); // 50x the default tolerance
      assert.equal(checkNumeric(String(wrong), q).correct, false, `${q.template} wrong value rejected`);
      seedsPerTemplate[q.template].add(seed);
    }
  }
  for (const t of TEMPLATES) assert.ok(seedsPerTemplate[t].size >= 20, `${t} checked on 20+ seeds`);
});

test("ev: answers are checked by checkNumeric (parse errors are never counted as wrong)", () => {
  const q = OA.generate("ev", 17).questions[0];
  const r = checkNumeric("not a number", q);
  assert.equal(r.correct, null);
  assert.ok(typeof r.error === "string" && r.error.length > 0);
  const v = parsedValue(q);
  assert.equal(checkNumeric(String(v), q).correct, true);
});

// ======================================================================================
// 8. scoreRun (§F7)
// ======================================================================================

const score5 = (r) => ({ score: r.score, total: r.total, correct: r.correct, wrong: r.wrong, skipped: r.skipped });
// 5 correct, 3 wrong, 3 skipped (null, missing, undefined), with extra fields that must be ignored
const MIXED = [
  { correct: true, answer: "12", secs: 3 }, { correct: false, answer: "7" }, { correct: true },
  { correct: null, answer: "" }, { correct: true }, {}, { correct: false }, { correct: true },
  { correct: undefined }, { correct: false, answer: "0.5" }, { correct: true },
];

test("scoreRun arith: one correct entry per auto-advanced question, so score = total = correct", () => {
  const answers = Array.from({ length: 37 }, () => ({ correct: true }));
  assert.deepEqual(score5(OA.scoreRun("arith", answers)), { score: 37, total: 37, correct: 37, wrong: 0, skipped: 0 });
  assert.deepEqual(score5(OA.scoreRun("arith", [])), { score: 0, total: 0, correct: 0, wrong: 0, skipped: 0 });
  assert.deepEqual(score5(OA.scoreRun("arith", answers, ARITH_DEFAULT)),
    { score: 37, total: 37, correct: 37, wrong: 0, skipped: 0 });
});

test("scoreRun eighty: score is the number correct; unreached questions count as skipped", () => {
  assert.deepEqual(score5(OA.scoreRun("eighty", MIXED)), { score: 5, total: 80, correct: 5, wrong: 3, skipped: 72 });
  assert.deepEqual(score5(OA.scoreRun("eighty", MIXED, { negativeMarking: false })),
    { score: 5, total: 80, correct: 5, wrong: 3, skipped: 72 });
  assert.deepEqual(score5(OA.scoreRun("eighty", [])), { score: 0, total: 80, correct: 0, wrong: 0, skipped: 80 });
});

test("scoreRun eighty: optional negative marking takes 1 per wrong answer and can go below zero", () => {
  assert.deepEqual(score5(OA.scoreRun("eighty", MIXED, { negativeMarking: true })),
    { score: 2, total: 80, correct: 5, wrong: 3, skipped: 72 });
  const bad = [{ correct: false }, { correct: true }, { correct: false }, { correct: false }, { correct: false }];
  assert.equal(OA.scoreRun("eighty", bad, { negativeMarking: true }).score, -3);
  assert.equal(OA.scoreRun("eighty", bad).score, 1);
  // the flag is normalised: only the boolean true turns it on
  assert.equal(OA.scoreRun("eighty", MIXED, { negativeMarking: "true" }).score, 5);
});

test("scoreRun seq and ev: totals 15 and 20, negative marking never applies", () => {
  assert.deepEqual(score5(OA.scoreRun("seq", MIXED)), { score: 5, total: 15, correct: 5, wrong: 3, skipped: 7 });
  assert.deepEqual(score5(OA.scoreRun("seq", MIXED, { negativeMarking: true })),
    { score: 5, total: 15, correct: 5, wrong: 3, skipped: 7 });
  assert.deepEqual(score5(OA.scoreRun("ev", MIXED)), { score: 5, total: 20, correct: 5, wrong: 3, skipped: 12 });
  assert.deepEqual(score5(OA.scoreRun("ev", MIXED, { negativeMarking: true })),
    { score: 5, total: 20, correct: 5, wrong: 3, skipped: 12 });
});

test("scoreRun treats null or undefined answers as no answers (contract §A3)", () => {
  assert.deepEqual(score5(OA.scoreRun("eighty", null)), { score: 0, total: 80, correct: 0, wrong: 0, skipped: 80 });
  assert.deepEqual(score5(OA.scoreRun("seq", undefined)), { score: 0, total: 15, correct: 0, wrong: 0, skipped: 15 });
  assert.deepEqual(score5(OA.scoreRun("arith", null)), { score: 0, total: 0, correct: 0, wrong: 0, skipped: 0 });
});

test("scoreRun does not mutate the answers", () => {
  const answers = clone(MIXED);
  const before = clone(answers);
  OA.scoreRun("eighty", answers, { negativeMarking: true });
  assert.deepEqual(answers, before);
});

// ======================================================================================
// 9. personalBest and trend (§F7)
// ======================================================================================

const ARITH_60 = { ...ARITH_DEFAULT, durationSecs: 60 };
const oaRun = (minute, kind, score, config) =>
  ({ ts: T0 + minute * MINUTE, kind, seed: 1000 + minute, score, total: kind === "eighty" ? 80 : score, secs: 60, config });

test("personalBest is the all-time best score over runs of the same kind and config", () => {
  const runs = [oaRun(0, "arith", 99, ARITH_DEFAULT)]; // oldest run is the best
  for (let i = 1; i <= 12; i++) runs.push(oaRun(i, "arith", 40 + i, ARITH_DEFAULT));
  runs.push(oaRun(20, "arith", 150, ARITH_60));
  runs.push(oaRun(21, "eighty", 61, { negativeMarking: false }));
  runs.push(oaRun(22, "eighty", 70, { negativeMarking: true }));
  runs.push(oaRun(23, "seq", 12, {}));
  const before = clone(runs);
  assert.equal(OA.personalBest(runs, "arith"), 99);
  assert.equal(OA.personalBest(runs, "arith", ARITH_DEFAULT), 99);
  assert.equal(OA.personalBest(runs, "arith", ARITH_60), 150);
  assert.equal(OA.personalBest(runs, "arith", { durationSecs: "60" }), 150);
  assert.equal(OA.personalBest(runs, "eighty"), 61);
  assert.equal(OA.personalBest(runs, "eighty", { negativeMarking: true }), 70);
  assert.equal(OA.personalBest(runs, "seq"), 12);
  assert.equal(OA.personalBest(runs, "ev"), null);
  assert.equal(OA.personalBest(runs, "arith", { ...ARITH_DEFAULT, ops: ["add"] }), null);
  assert.deepEqual(runs, before);
});

test("personalBest matches configs after normalisation, handles negative bests and empty input", () => {
  const runs = [
    oaRun(1, "arith", 30, { ops: ["div", "mul", "sub", "add"], addA: ["2", "100"] }), // same as default
    oaRun(2, "arith", 25, ARITH_DEFAULT),
    oaRun(3, "eighty", -4, { negativeMarking: true }),
    oaRun(4, "eighty", -2, { negativeMarking: true }),
    oaRun(5, "eighty", -7, { negativeMarking: true }),
  ];
  assert.equal(OA.personalBest(runs, "arith"), 30);
  assert.equal(OA.personalBest(runs, "eighty", { negativeMarking: true }), -2);
  assert.equal(OA.personalBest(runs, "eighty"), null);
  assert.equal(OA.personalBest([], "arith"), null);
  assert.equal(OA.personalBest(null, "arith"), null);
  assert.equal(OA.personalBest(undefined, "seq"), null);
});

test("trend gives the scores of the last 10 matching runs, oldest to newest", () => {
  const runs = [];
  for (let i = 0; i < 13; i++) {
    runs.push(oaRun(10 * i, "arith", 20 + i, ARITH_DEFAULT));
    runs.push(oaRun(10 * i + 1, "arith", 500 + i, ARITH_60)); // other config
    runs.push(oaRun(10 * i + 2, "ev", 3, {})); // other kind
  }
  const before = clone(runs);
  assert.deepEqual(OA.trend(runs, "arith"), [23, 24, 25, 26, 27, 28, 29, 30, 31, 32]);
  assert.deepEqual(OA.trend(runs, "arith", ARITH_60), [503, 504, 505, 506, 507, 508, 509, 510, 511, 512]);
  assert.deepEqual(OA.trend(runs, "ev"), [3, 3, 3, 3, 3, 3, 3, 3, 3, 3]);
  assert.deepEqual(OA.trend(runs, "seq"), []);
  assert.deepEqual(runs, before);
});

test("trend sorts by ts (stable for equal ts) and returns every run when there are fewer than 10", () => {
  const runs = [
    oaRun(3, "seq", 30, {}),
    oaRun(1, "seq", 10, {}),
    oaRun(2, "seq", 20, {}),
    oaRun(1, "seq", 11, {}), // same ts as the 10: keeps array order
    oaRun(0, "eighty", 9, { negativeMarking: true }),
  ];
  assert.deepEqual(OA.trend(runs, "seq"), [10, 11, 20, 30]);
  assert.deepEqual(OA.trend(runs, "eighty", { negativeMarking: true }), [9]);
  assert.deepEqual(OA.trend(runs, "eighty"), []);
  assert.deepEqual(OA.trend([], "arith"), []);
  assert.deepEqual(OA.trend(null, "arith"), []);
});

// ======================================================================================
// 10. zetamacEntry (§F7, spec §2)
// ======================================================================================

test("zetamacEntry: an arith run with the default config writes an in-app zetamac practice entry", () => {
  const run = { ts: T0, kind: "arith", seed: 5, score: 37, total: 37, secs: 120, config: ARITH_DEFAULT };
  const before = clone(run);
  assert.deepEqual(OA.zetamacEntry(run), { ts: T0, track: "zetamac", amount: 37, unit: "score", note: "in-app" });
  assert.deepEqual(run, before);
  assert.deepEqual(OA.zetamacEntry({ ...run, score: 0, total: 0 }),
    { ts: T0, track: "zetamac", amount: 0, unit: "score", note: "in-app" });
  const uiStrings = { ...ARITH_DEFAULT, addA: ["2", "100"], durationSecs: "120" };
  assert.deepEqual(OA.zetamacEntry({ ...run, ts: T0 + MINUTE, config: uiStrings }),
    { ts: T0 + MINUTE, track: "zetamac", amount: 37, unit: "score", note: "in-app" });
});

test("zetamacEntry: only the default config writes the zetamac track", () => {
  const run = { ts: T0, kind: "arith", seed: 5, score: 37, total: 37, secs: 60, config: ARITH_60 };
  assert.equal(OA.zetamacEntry(run), null);
  assert.equal(OA.zetamacEntry({ ...run, config: { ...ARITH_DEFAULT, ops: ["add", "sub"] } }), null);
  assert.equal(OA.zetamacEntry({ ...run, kind: "eighty", config: { negativeMarking: false } }), null);
  assert.equal(OA.zetamacEntry({ ...run, kind: "seq", config: {} }), null);
});

test("zetamacEntry: the score must be an integer of at least 0", () => {
  const run = { ts: T0, kind: "arith", seed: 5, score: 37, total: 37, secs: 120, config: ARITH_DEFAULT };
  assert.equal(OA.zetamacEntry({ ...run, score: -1 }), null);
  assert.equal(OA.zetamacEntry({ ...run, score: 2.5 }), null);
  assert.equal(OA.zetamacEntry({ ...run, score: NaN }), null);
  assert.equal(OA.zetamacEntry({ ...run, score: "37" }), null);
});
