// v4 prep/rng.js (PrepRng): the seeded PRNG every generator in prep/ draws from
// (V4-CONTRACTS §B). Plain browser script and Node module (§A5): one `var` global, no
// dependencies, no DOM, no clock, no Math.random. Each helper takes the rng explicitly and
// uses exactly the number of draws §B2 states, so a seed fixes a whole run (spec §5).

var PrepRng = (function () {
  const TWO32 = 4294967296;

  // One step of mulberry32 (§B1). state: uint32. Returns the next value in [0, 1) and the next
  // state, which is (state + 0x6D2B79F5) mod 2^32.
  function rngNext(state) {
    const a = (state + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return { value: ((t ^ (t >>> 14)) >>> 0) / TWO32, state: a };
  }

  // A stateful generator: each call returns the next draw in [0, 1). The seed is coerced with
  // >>> 0, so any number works.
  function mulberry32(seed) {
    let s = seed >>> 0;
    return function () {
      const r = rngNext(s);
      s = r.state;
      return r.value;
    };
  }

  // §A3: null and undefined read as []; any other non-array is a programmer error.
  function asArray(arr, fn) {
    if (arr == null) return [];
    if (!Array.isArray(arr)) throw new TypeError(`${fn}: arr must be an array`);
    return arr;
  }

  // Uniform integer in [lo, hi], both ends included. One draw.
  function randInt(rng, lo, hi) {
    if (!Number.isInteger(lo) || !Number.isInteger(hi)) {
      throw new TypeError("randInt: lo and hi must be integers");
    }
    if (lo > hi) throw new RangeError("randInt: lo must not exceed hi");
    return lo + Math.floor(rng() * (hi - lo + 1));
  }

  // One element of a non-empty array (the element itself, not a copy). One draw.
  function pick(rng, arr) {
    const a = asArray(arr, "pick");
    if (a.length === 0) throw new RangeError("pick: arr is empty");
    return a[Math.floor(rng() * a.length)];
  }

  // Fisher-Yates on a shallow copy; the input is left alone. max(0, n - 1) draws.
  function shuffle(rng, arr) {
    const a = asArray(arr, "shuffle").slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = randInt(rng, 0, i);
      const tmp = a[i];
      a[i] = a[j];
      a[j] = tmp;
    }
    return a;
  }

  return { rngNext, mulberry32, randInt, pick, shuffle };
})();
if (typeof module !== "undefined") module.exports = PrepRng;
