// v4 prep/rng.js (PrepRng): the seeded mulberry32 PRNG and its helpers, V4-CONTRACTS §B
// (plus the module rules of §A3 and §A5). Run with `npm test` (Node's built-in runner).
//
// Oracles are written here from the contract text, never taken from the module: a classic
// one-liner-style mulberry32, a BigInt state step, and plain Fisher-Yates. §N5 allows exact
// RNG reproduction for B1 and B2. Every value mulberry32 returns is k / 2^32, which is exact in
// binary, so exact equality is fine (§N6).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const R = require("../prep/rng.js");

const RNG_FILE = path.join(__dirname, "..", "prep", "rng.js");
const EXPORTS = ["rngNext", "mulberry32", "randInt", "pick", "shuffle"];
const TWO32 = 4294967296;
const MAX_DRAW = (TWO32 - 1) / TWO32; // the largest value a mulberry32 draw can take
const SEEDS = [0, 1, 2, 7, 42, 1000, 123456789, 0x6d2b79f5, 2147483648, 0xdeadbeef, TWO32 - 1];

// ---------- independent oracles ----------

// mulberry32 in the style of the widely published one-liner, with an int32 accumulator.
function refGen(seed) {
  let a = seed | 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / TWO32;
  };
}

function refDraws(seed, count) {
  const g = refGen(seed);
  const out = [];
  for (let i = 0; i < count; i++) out.push(g());
  return out;
}

// The next generator state, computed with BigInt rather than uint32 tricks.
function refNextState(s) {
  return Number((BigInt(s) + 0x6d2b79f5n) % 4294967296n);
}

function refRandInt(g, lo, hi) {
  return lo + Math.floor(g() * (hi - lo + 1));
}

function refShuffle(g, arr) {
  const out = arr.slice();
  for (let i = out.length - 1; i >= 1; i--) {
    const j = Math.floor(g() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

// Wraps an rng and counts how many draws are taken from it.
function counting(g) {
  const f = () => { f.calls++; return g(); };
  f.calls = 0;
  return f;
}

// A fake rng that always returns v.
const constant = (v) => () => v;

function range(lo, hi) {
  const out = [];
  for (let k = lo; k <= hi; k++) out.push(k);
  return out;
}

// ---------- 0. exports and module shape (§B, §A5, §A3) ----------

test("PrepRng exports rngNext, mulberry32, randInt, pick and shuffle as functions", () => {
  for (const k of EXPORTS) assert.equal(typeof R[k], "function", k);
});

test("prep/rng.js loads as a classic browser script that needs nothing and defines only the PrepRng global (§A5)", () => {
  const src = fs.readFileSync(RNG_FILE, "utf8");
  const ctx = vm.createContext({}); // no require, no module, no other prep script
  vm.runInContext(src, ctx, { filename: "prep/rng.js" });
  assert.deepEqual(Object.keys(ctx), ["PrepRng"], "exactly one top-level var binding");
  // A second classic script in the same realm must not hit a duplicate lexical declaration,
  // so the file has no top-level const, let or class.
  assert.doesNotThrow(() => vm.runInContext(src, ctx, { filename: "prep/rng.js (again)" }));
  const G = vm.runInContext("PrepRng", ctx);
  for (const k of EXPORTS) assert.equal(typeof G[k], "function", k);
  const g = G.mulberry32(42);
  assert.equal(g(), 0.6011037519201636);
  assert.equal(G.randInt(G.mulberry32(42), 1, 6), 4);
});

test("rng helpers draw only from the rng they are given, never Math.random or the clock (§A3)", () => {
  const realRandom = Math.random;
  const realNow = Date.now;
  Math.random = () => { throw new Error("Math.random must not be used"); };
  Date.now = () => { throw new Error("Date.now must not be used"); };
  let got;
  try {
    const rng = R.mulberry32(42);
    got = [rng(), R.rngNext(42).value, R.randInt(rng, 1, 6), R.pick(rng, ["a", "b", "c"]),
      R.shuffle(rng, [1, 2, 3, 4])];
  } finally {
    Math.random = realRandom;
    Date.now = realNow;
  }
  const g = refGen(42);
  const exp = [g(), refGen(42)(), refRandInt(g, 1, 6)];
  exp.push(["a", "b", "c"][Math.floor(g() * 3)]);
  exp.push(refShuffle(g, [1, 2, 3, 4]));
  assert.deepEqual(got, exp);
});

// ---------- 1. mulberry32 (§B1) ----------

test("the test oracle reproduces the §B1 published reference values (oracle self-check)", () => {
  // Guards the oracle used below, then checks the module against the same literals.
  assert.deepEqual(refDraws(1, 3), [0.6270739405881613, 0.002735721180215478, 0.5274470399599522]);
  assert.deepEqual(refDraws(42, 3), [0.6011037519201636, 0.44829055899754167, 0.8524657934904099]);
  assert.deepEqual(refDraws(0, 3), [0.26642920868471265, 0.0003297457005828619, 0.2232720274478197]);
  const g = R.mulberry32(42);
  assert.deepEqual([g(), g(), g()], refDraws(42, 3));
});

test("mulberry32 reproduces the §B1 reference values for seeds 1, 42 and 0 exactly", () => {
  const take3 = (seed) => { const g = R.mulberry32(seed); return [g(), g(), g()]; };
  assert.deepEqual(take3(1), [0.6270739405881613, 0.002735721180215478, 0.5274470399599522]);
  assert.deepEqual(take3(42), [0.6011037519201636, 0.44829055899754167, 0.8524657934904099]);
  assert.deepEqual(take3(0), [0.26642920868471265, 0.0003297457005828619, 0.2232720274478197]);
});

test("mulberry32 matches an independent reference implementation for many seeds over 2000 draws", () => {
  for (const seed of SEEDS) {
    const g = R.mulberry32(seed);
    const exp = refDraws(seed, 2000);
    for (let i = 0; i < exp.length; i++) {
      const v = g();
      if (v !== exp[i]) assert.fail(`seed ${seed}, draw ${i}: got ${v}, expected ${exp[i]}`);
    }
  }
});

test("mulberry32 draws are numbers in [0, 1) and are whole multiples of 2^-32", () => {
  let lo = Infinity;
  let hi = -Infinity;
  for (const seed of SEEDS) {
    const g = R.mulberry32(seed);
    for (let i = 0; i < 5000; i++) {
      const v = g();
      assert.equal(typeof v, "number");
      if (!(v >= 0 && v < 1)) assert.fail(`seed ${seed}, draw ${i}: ${v} is outside [0, 1)`);
      if (!Number.isInteger(v * TWO32)) assert.fail(`seed ${seed}, draw ${i}: ${v} is not k / 2^32`);
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
  }
  // 55,000 draws spread over the whole interval, not a narrow band of it.
  assert.ok(lo < 0.001, `smallest draw ${lo}`);
  assert.ok(hi > 0.999, `largest draw ${hi}`);
});

test("spec §5: everything is seeded and deterministic, so the same seed gives the same sequence", () => {
  for (const seed of SEEDS) {
    const a = R.mulberry32(seed);
    const b = R.mulberry32(seed);
    for (let i = 0; i < 200; i++) assert.equal(a(), b());
  }
  // Different seeds give different streams.
  const firsts = new Set(SEEDS.map((s) => R.mulberry32(s)()));
  assert.equal(firsts.size, SEEDS.length);
});

test("each mulberry32 generator keeps its own state: interleaved generators do not interfere", () => {
  const a = R.mulberry32(99);
  const b = R.mulberry32(99);
  const c = R.mulberry32(5);
  const exp99 = refDraws(99, 20);
  const exp5 = refDraws(5, 20);
  const gotA = [];
  for (let i = 0; i < 10; i++) gotA.push(a());
  const gotC = [c(), c(), c()];
  const gotB = [];
  for (let i = 0; i < 20; i++) gotB.push(b());
  for (let i = 0; i < 10; i++) gotA.push(a());
  for (let i = 0; i < 17; i++) gotC.push(c());
  assert.deepEqual(gotA, exp99);
  assert.deepEqual(gotB, exp99);
  assert.deepEqual(gotC, exp5);
});

// ---------- 2. rngNext (§B1) ----------

test("rngNext returns the next value and the next uint32 state of the exact §B1 step", () => {
  for (const s of SEEDS) {
    const r = R.rngNext(s);
    assert.equal(r.value, refGen(s)(), `value from state ${s}`);
    assert.equal(r.state, refNextState(s), `state from state ${s}`);
    assert.ok(Number.isInteger(r.state) && r.state >= 0 && r.state < TWO32);
  }
  // The state wraps modulo 2^32.
  assert.equal(R.rngNext(TWO32 - 1).state, 0x6d2b79f4);
  assert.equal(R.rngNext(0).state, 0x6d2b79f5);
});

test("chaining rngNext from a seed reproduces the mulberry32 stream draw for draw", () => {
  for (const seed of [0, 7, 42, 0xdeadbeef, TWO32 - 1]) {
    const exp = refDraws(seed, 500);
    let s = seed;
    let expState = seed;
    for (let i = 0; i < exp.length; i++) {
      const r = R.rngNext(s);
      expState = refNextState(expState);
      if (r.value !== exp[i]) assert.fail(`seed ${seed}, step ${i}: value ${r.value}, expected ${exp[i]}`);
      if (r.state !== expState) assert.fail(`seed ${seed}, step ${i}: state ${r.state}, expected ${expState}`);
      s = r.state;
    }
  }
});

test("rngNext is pure: the same state always gives the same value and state", () => {
  for (const s of [3, 42, 2147483648]) {
    const a = R.rngNext(s);
    const b = R.rngNext(s);
    assert.equal(a.value, b.value);
    assert.equal(a.state, b.state);
  }
});

// ---------- 3. randInt (§B2) ----------

test("randInt reproduces the §B2 reference: mulberry32(42), 1..6, ten times", () => {
  const rng = R.mulberry32(42);
  const got = [];
  for (let i = 0; i < 10; i++) got.push(R.randInt(rng, 1, 6));
  assert.deepEqual(got, [4, 3, 6, 5, 2, 4, 2, 4, 6, 3]);
});

test("randInt is lo + floor(draw * (hi - lo + 1)) on a shared stream, for many ranges", () => {
  const ranges = [[1, 6], [0, 0], [-10, 10], [0, 51], [3, 8], [2, 5], [-7, -3], [0, 1], [100, 1000],
    [0, 2147483648], [0, TWO32 - 1]];
  for (const seed of [1, 42, 777, 0xdeadbeef]) {
    const rng = R.mulberry32(seed);
    const g = refGen(seed);
    for (let round = 0; round < 50; round++) {
      for (const [lo, hi] of ranges) assert.equal(R.randInt(rng, lo, hi), refRandInt(g, lo, hi), `${lo}..${hi}`);
    }
  }
});

test("randInt is inclusive of both bounds: the smallest draw gives lo and the largest gives hi", () => {
  assert.equal(R.randInt(constant(0), 1, 6), 1);
  assert.equal(R.randInt(constant(MAX_DRAW), 1, 6), 6);
  assert.equal(R.randInt(constant(0), -4, 9), -4);
  assert.equal(R.randInt(constant(MAX_DRAW), -4, 9), 9);
  assert.equal(R.randInt(constant(0.5), 1, 6), 4); // 1 + floor(3)
  assert.equal(R.randInt(constant(0.25), 1, 6), 2); // 1 + floor(1.5)
  assert.equal(R.randInt(constant(0.75), 0, 3), 3); // floor(3)
  assert.equal(R.randInt(constant(0.7), -5, -1), -2); // -5 + floor(3.5)
  assert.equal(R.randInt(constant(MAX_DRAW), 0, TWO32 - 1), TWO32 - 1);
});

test("randInt covers every value of its range, never leaves it, and is roughly uniform", () => {
  for (const [lo, hi, seed] of [[1, 6, 2024], [-3, 3, 9], [0, 12, 31337]]) {
    const rng = R.mulberry32(seed);
    const counts = new Map();
    const n = 1000 * (hi - lo + 1);
    for (let i = 0; i < n; i++) {
      const v = R.randInt(rng, lo, hi);
      if (!Number.isInteger(v) || v < lo || v > hi) assert.fail(`${v} is outside ${lo}..${hi}`);
      counts.set(v, (counts.get(v) || 0) + 1);
    }
    assert.deepEqual([...counts.keys()].sort((x, y) => x - y), range(lo, hi));
    // 1000 expected per value; the standard deviation is about 31, so 850..1150 is very loose.
    for (const [v, c] of counts) assert.ok(c > 850 && c < 1150, `value ${v} drawn ${c} times`);
  }
});

test("randInt uses exactly one draw per call, including when lo equals hi", () => {
  const rng = counting(R.mulberry32(5));
  R.randInt(rng, 1, 6);
  assert.equal(rng.calls, 1);
  R.randInt(rng, 4, 4);
  assert.equal(rng.calls, 2);
  for (let i = 0; i < 100; i++) R.randInt(rng, -50, 50);
  assert.equal(rng.calls, 102);
  // lo === hi still returns lo, and still consumes the draw from the stream.
  const a = R.mulberry32(8);
  assert.equal(R.randInt(a, 7, 7), 7);
  assert.equal(a(), refDraws(8, 2)[1]);
});

test("randInt throws when lo or hi is not an integer, or when lo > hi", () => {
  const rng = R.mulberry32(1);
  assert.throws(() => R.randInt(rng, 1.5, 6));
  assert.throws(() => R.randInt(rng, 1, 6.5));
  assert.throws(() => R.randInt(rng, 0.1, 0.9));
  assert.throws(() => R.randInt(rng, NaN, 6));
  assert.throws(() => R.randInt(rng, 1, NaN));
  assert.throws(() => R.randInt(rng, "1", 6));
  assert.throws(() => R.randInt(rng, 1, "6"));
  assert.throws(() => R.randInt(rng, undefined, 6));
  assert.throws(() => R.randInt(rng, 1));
  assert.throws(() => R.randInt(rng, 6, 1));
  assert.throws(() => R.randInt(rng, 0, -1));
  // Neighbouring valid calls do not throw.
  assert.doesNotThrow(() => R.randInt(rng, 6, 6));
  assert.doesNotThrow(() => R.randInt(rng, -1, 0));
});

// ---------- 4. pick (§B2) ----------

test("pick is arr[floor(draw * arr.length)] on a shared stream, for several arrays", () => {
  const arrays = [["a", "b", "c"], [10], ["x", "y"], range(1, 13), ["add", "sub", "mul", "div"], range(0, 51)];
  for (const seed of [3, 42, 65535, 0xdeadbeef]) {
    const rng = R.mulberry32(seed);
    const g = refGen(seed);
    for (let round = 0; round < 50; round++) {
      for (const arr of arrays) assert.equal(R.pick(rng, arr), arr[Math.floor(g() * arr.length)]);
    }
  }
});

test("pick maps the smallest draw to the first element and the largest to the last", () => {
  const arr = ["a", "b", "c", "d"];
  assert.equal(R.pick(constant(0), arr), "a");
  assert.equal(R.pick(constant(MAX_DRAW), arr), "d");
  assert.equal(R.pick(constant(0.5), arr), "c");
  assert.equal(R.pick(constant(0.2499), arr), "a");
  assert.equal(R.pick(constant(0.25), arr), "b");
  assert.equal(R.pick(constant(0.9), ["only"]), "only");
});

test("pick returns the element itself, can reach every element, and does not mutate the array", () => {
  const objs = [{ k: 1 }, { k: 2 }, { k: 3 }, { k: 4 }, { k: 5 }];
  const before = structuredClone(objs);
  const rng = R.mulberry32(17);
  const seen = new Set();
  for (let i = 0; i < 500; i++) {
    const p = R.pick(rng, objs);
    assert.ok(objs.includes(p), "pick must return an element of the array, not a copy");
    seen.add(p);
  }
  assert.equal(seen.size, objs.length);
  assert.deepEqual(objs, before);
});

test("pick uses exactly one draw per call", () => {
  const rng = counting(R.mulberry32(11));
  R.pick(rng, ["a", "b", "c"]);
  assert.equal(rng.calls, 1);
  R.pick(rng, ["solo"]);
  assert.equal(rng.calls, 2);
  for (let i = 0; i < 100; i++) R.pick(rng, range(1, 52));
  assert.equal(rng.calls, 102);
});

test("pick throws on an empty or non-array arr", () => {
  const rng = R.mulberry32(1);
  assert.throws(() => R.pick(rng, []));
  assert.throws(() => R.pick(rng, null)); // throws whether null is rejected or read as []
  assert.throws(() => R.pick(rng, undefined));
  assert.throws(() => R.pick(rng, "abc"));
  assert.throws(() => R.pick(rng, { 0: "a", 1: "b", length: 2 }));
  assert.throws(() => R.pick(rng, 5));
});

// ---------- 5. shuffle (§B2) ----------

test("shuffle matches Fisher-Yates with randInt(rng, 0, i) for many seeds and sizes", () => {
  for (const seed of [0, 1, 42, 2026, 0xdeadbeef, TWO32 - 1]) {
    for (const n of [2, 3, 5, 8, 10, 52, 80]) {
      const arr = range(1, n);
      assert.deepEqual(R.shuffle(R.mulberry32(seed), arr), refShuffle(refGen(seed), arr), `seed ${seed}, n ${n}`);
    }
  }
});

test("shuffle with hand-computed draws: always-smallest rotates left, always-largest keeps the order", () => {
  // Draw 0 makes j = 0 every step: [a,b,c,d] -> [d,b,c,a] -> [c,b,d,a] -> [b,c,d,a].
  assert.deepEqual(R.shuffle(constant(0), ["a", "b", "c", "d"]), ["b", "c", "d", "a"]);
  // The largest draw makes j = i every step, so nothing moves.
  assert.deepEqual(R.shuffle(constant(MAX_DRAW), ["a", "b", "c", "d"]), ["a", "b", "c", "d"]);
  // Draw 0.5: i=2 -> j=1, i=1 -> j=1: [p,q,r] -> [p,r,q] -> [p,r,q].
  assert.deepEqual(R.shuffle(constant(0.5), ["p", "q", "r"]), ["p", "r", "q"]);
});

test("shuffle uses exactly max(0, n - 1) draws", () => {
  for (const n of [0, 1, 2, 3, 10, 52]) {
    const rng = counting(R.mulberry32(123));
    R.shuffle(rng, range(1, n));
    assert.equal(rng.calls, Math.max(0, n - 1), `n = ${n}`);
  }
});

test("shuffle returns a new array that is a permutation of the input, and leaves the input alone", () => {
  const input = ["q", "w", "e", "r", "t", "y", "q", "w"]; // duplicates allowed
  const before = input.slice();
  const out = R.shuffle(R.mulberry32(4), input);
  assert.ok(Array.isArray(out));
  assert.notEqual(out, input);
  assert.deepEqual(input, before);
  assert.deepEqual(out.slice().sort(), before.slice().sort());
  // Empty and single-element inputs give fresh arrays too.
  const empty = [];
  const outEmpty = R.shuffle(R.mulberry32(4), empty);
  assert.deepEqual(outEmpty, []);
  assert.notEqual(outEmpty, empty);
  const one = [{ id: 1 }];
  const outOne = R.shuffle(R.mulberry32(4), one);
  assert.deepEqual(outOne, [{ id: 1 }]);
  assert.notEqual(outOne, one);
});

test("shuffle permutes the input's own elements (a copy of the array, not of its items) and leaves them unchanged (§A3)", () => {
  // §B2: Fisher-Yates swaps a[i] and a[j] on a copy of the array, so the output holds the very
  // same element objects, in the Fisher-Yates order.
  for (const seed of [3, 42, 0xdeadbeef]) {
    const input = range(1, 9).map((k) => ({ k, tags: [k, -k] }));
    const before = structuredClone(input);
    const refs = input.slice();
    const out = R.shuffle(R.mulberry32(seed), input);
    const exp = refShuffle(refGen(seed), refs);
    assert.equal(out.length, exp.length);
    for (let i = 0; i < exp.length; i++) {
      assert.ok(out[i] === exp[i], `seed ${seed}, position ${i}: not the same element object as the Fisher-Yates oracle`);
    }
    assert.deepEqual(input, before);
    assert.ok(input.every((o, i) => o === refs[i]), "the input array still holds its elements in their original order");
  }
});

test("shuffle reaches every permutation of three items, roughly uniformly", () => {
  const counts = new Map();
  for (let seed = 0; seed < 6000; seed++) {
    const key = R.shuffle(R.mulberry32(seed), ["a", "b", "c"]).join("");
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  assert.deepEqual([...counts.keys()].sort(), ["abc", "acb", "bac", "bca", "cab", "cba"]);
  // 1000 expected each; the standard deviation is about 29.
  for (const [k, c] of counts) assert.ok(c > 850 && c < 1150, `${k} seen ${c} times`);
});

test("shuffle is deterministic: equal inputs and seeds give deep-equal outputs", () => {
  const arr = range(1, 20);
  for (const seed of [5, 6, 7]) {
    assert.deepEqual(R.shuffle(R.mulberry32(seed), arr), R.shuffle(R.mulberry32(seed), arr));
  }
  assert.notDeepEqual(R.shuffle(R.mulberry32(5), arr), R.shuffle(R.mulberry32(6), arr));
});

test("shuffle throws on a non-array", () => {
  const rng = R.mulberry32(1);
  assert.throws(() => R.shuffle(rng, "abc"));
  assert.throws(() => R.shuffle(rng, 42));
  assert.throws(() => R.shuffle(rng, { 0: "a", length: 1 }));
  assert.throws(() => R.shuffle(rng, new Set([1, 2])));
});

// ---------- 6. draw accounting across helpers (§B2) ----------

test("mixed helper calls on one rng consume the stream exactly as the stated draw counts imply", () => {
  for (const seed of [42, 2718, 0xcafebabe]) {
    const rng = R.mulberry32(seed);
    const g = refGen(seed);
    const deck = range(1, 13);
    for (let round = 0; round < 30; round++) {
      assert.equal(R.pick(rng, ["add", "sub", "mul", "div"]), ["add", "sub", "mul", "div"][Math.floor(g() * 4)]);
      assert.equal(R.randInt(rng, 2, 100), refRandInt(g, 2, 100));
      assert.deepEqual(R.shuffle(rng, deck), refShuffle(g, deck));
      assert.deepEqual(R.shuffle(rng, ["solo"]), ["solo"]); // no draw
      assert.deepEqual(R.shuffle(rng, []), []); // no draw
      assert.equal(R.randInt(rng, 9, 9), 9);
      g(); // the lo === hi call above still took one draw
      assert.equal(rng(), g());
    }
  }
});
