// v4 market-making game: prep/market.js (PrepMarket), V4-CONTRACTS.md §G (spec §6).
// Oracles are written here from the contract text: our own mulberry32 (the §B1 reference
// one-liner), our own scenario generator (§G1 draw table), our own E[V] by brute-force
// enumeration and by linearity, and our own round simulator (§G3) and settlement (§G5).
// Noise-bot draws are reproduced only because §G1 and §G3 fix them exactly (§N5).
// Run with `npm test` (Node's built-in runner).
const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("../prep/market.js");

const TS = new Date(2026, 10, 4, 15, 0, 0).getTime(); // Wed 4 Nov 2026 15:00 local
const GOLDEN = 0x6D2B79F5;

// ---------- independent oracles ----------

// The well-known mulberry32 reference, verbatim from §B1.
function refMulberry32(a) {
  return function () {
    var t = a += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function refDraws(seed, k) {
  const r = refMulberry32(seed >>> 0);
  const out = [];
  for (let i = 0; i < k; i++) out.push(r());
  return out;
}
// The value rngNext(state).value would give: one draw of a stream whose state is `state`.
function refNextFromState(state) { return refMulberry32(state)(); }

const FULL_DECK = (() => {
  const d = [];
  for (let v = 1; v <= 13; v++) for (let c = 0; c < 4; c++) d.push(v);
  return d;
})();
const sum = (xs) => xs.reduce((a, b) => a + b, 0);

// Our own §G1 generator. Returns the scenario plus the draw stream positioned after creation.
function refCreate(kind, seed, opts = {}) {
  const r = refMulberry32(seed >>> 0);
  let used = 0;
  const u = () => { used++; return r(); };
  const ri = (lo, hi) => lo + Math.floor(u() * (hi - lo + 1));
  let n;
  let batch = null;
  let outcomes;
  if (kind === "dice") {
    n = opts.values ? opts.values.length : (opts.n != null ? opts.n : ri(3, 10));
    outcomes = opts.values ? opts.values.slice() : Array.from({ length: n }, () => ri(1, 6));
  } else if (kind === "cards") {
    n = opts.values ? opts.values.length : (opts.n != null ? opts.n : ri(3, 8));
    if (opts.values) outcomes = opts.values.slice();
    else {
      const deck = FULL_DECK.slice();
      outcomes = [];
      for (let j = 0; j < n; j++) {
        const idx = ri(0, deck.length - 1);
        outcomes.push(deck[idx]);
        deck.splice(idx, 1);
      }
    }
  } else if (kind === "coins") {
    batch = opts.batch != null ? opts.batch : ri(2, 5);
    n = opts.values ? opts.values.length : (opts.n != null ? opts.n : batch * ri(3, 8));
    outcomes = opts.values ? opts.values.slice() : Array.from({ length: n }, () => (u() < 0.5 ? 1 : 0));
  } else throw new Error("oracle: unknown kind");
  const rounds = kind === "coins" ? Math.ceil(n / batch) : n;
  return { kind, n, batch, rounds, outcomes, used, next: u };
}

// E[V | revealed] by linearity, computed a different way from the contract formula: the
// per-unit mean of the remaining units is taken from the remaining multiset itself.
function refEV(kind, n, revealed) {
  const m = revealed.length;
  const S = sum(revealed);
  if (kind === "dice") return S + (n - m) * (21 / 6);
  if (kind === "coins") return S + (n - m) / 2;
  const rest = FULL_DECK.slice();
  for (const c of revealed) rest.splice(rest.indexOf(c), 1);
  return S + (n - m) * (sum(rest) / rest.length);
}

// E[V | revealed] by brute-force enumeration of every completion of the unrevealed units.
function bruteEV(kind, n, revealed) {
  const k = n - revealed.length;
  const S = sum(revealed);
  let total = 0;
  let count = 0;
  if (kind === "dice" || kind === "coins") {
    const faces = kind === "dice" ? [1, 2, 3, 4, 5, 6] : [0, 1];
    const rec = (left, acc) => {
      if (left === 0) { total += S + acc; count++; return; }
      for (const f of faces) rec(left - 1, acc + f);
    };
    rec(k, 0);
  } else {
    // All ordered draws of k cards from the remaining 52 - m physical cards.
    const rest = FULL_DECK.slice();
    for (const c of revealed) rest.splice(rest.indexOf(c), 1);
    const used = new Array(rest.length).fill(false);
    const rec = (left, acc) => {
      if (left === 0) { total += S + acc; count++; return; }
      for (let i = 0; i < rest.length; i++) {
        if (used[i]) continue;
        used[i] = true;
        rec(left - 1, acc + rest[i]);
        used[i] = false;
      }
    };
    rec(k, 0);
  }
  return total / count;
}

// Our own §G3 + §G5 simulator. `quotes` is an array of numeric { fair, bid, ask }, or a function
// (round, publicEV, maxWidth) -> quote. Returns the quotes used, per-round records and metrics.
function refPlay(kind, seed, opts, quotes) {
  const g = refCreate(kind, seed, opts);
  const bots = opts.bots || "mixed";
  const maxPos = opts.maxPos != null ? opts.maxPos : 10;
  const maxWidth = opts.maxWidth != null ? opts.maxWidth : { dice: 4, cards: 8, coins: 3 }[kind];
  const V = sum(g.outcomes);
  let revealed = [];
  let cash = 0;
  let position = 0;
  let maxAbs = 0;
  const used = [];
  const rounds = [];
  for (let i = 0; i < g.rounds; i++) {
    const reveal = kind === "coins"
      ? g.outcomes.slice(i * g.batch, Math.min(g.n, (i + 1) * g.batch))
      : [g.outcomes[i]];
    const publicEV = refEV(kind, g.n, revealed);
    const informedEV = refEV(kind, g.n, revealed.concat(reveal));
    const q = typeof quotes === "function" ? quotes(i, publicEV, maxWidth) : quotes[i];
    used.push(q);
    const fills = [];
    const trade = (bot, userSide, price) => {
      const np = position + (userSide === "buy" ? 1 : -1);
      if (Math.abs(np) > maxPos) {
        fills.push({ round: i, bot, userSide, price, rejected: true, publicEV, positionAfter: position });
        return;
      }
      position = np;
      cash += userSide === "sell" ? price : -price;
      maxAbs = Math.max(maxAbs, Math.abs(position));
      fills.push({ round: i, bot, userSide, price, rejected: false, publicEV, positionAfter: position });
    };
    if (bots === "noise" || bots === "mixed") {
      const draw = g.next();
      if (draw < 0.5) trade("noise", "sell", q.ask);
      else trade("noise", "buy", q.bid);
    }
    if (bots === "informed" || bots === "mixed") {
      if (informedEV > q.ask + 1e-9) trade("informed", "sell", q.ask);
      else if (informedEV < q.bid - 1e-9) trade("informed", "buy", q.bid);
    }
    rounds.push({ reveal, publicEV, informedEV, fills });
    revealed = revealed.concat(reveal);
  }
  let edge = 0;
  let adverse = 0;
  let trades = 0;
  for (const r of rounds) {
    for (const f of r.fills) {
      if (f.rejected) continue;
      const s = f.userSide === "sell" ? 1 : -1;
      trades++;
      edge += (f.price - f.publicEV) * s;
      if (f.bot === "informed") adverse -= (f.price - V) * s;
    }
  }
  const fairErrors = rounds.map((r, i) => Math.abs(used[i].fair - r.publicEV));
  return {
    g, quotes: used, rounds, V, cash, position, maxAbs,
    metrics: {
      V, pnl: cash + position * V, cash, position, edge, adverse, trades, maxPos: maxAbs,
      fairErrors, meanFairError: sum(fairErrors) / fairErrors.length,
    },
  };
}

// ---------- assertion helpers ----------

function close(actual, expected, msg = "") {
  assert.equal(typeof actual, "number", `${msg}: expected a number, got ${typeof actual}`);
  const tol = 1e-9 * Math.max(1, Math.abs(expected));
  assert.ok(Math.abs(actual - expected) <= tol, `${msg}: ${actual} is not within ${tol} of ${expected}`);
}

// Compare a module Fill with an expected one. positionAfter is only compared on accepted fills.
function checkFill(actual, exp, msg = "") {
  assert.equal(actual.round, exp.round, `${msg} round`);
  assert.equal(actual.bot, exp.bot, `${msg} bot`);
  assert.equal(actual.userSide, exp.userSide, `${msg} userSide`);
  assert.equal(actual.price, exp.price, `${msg} price`);
  assert.equal(typeof actual.price, "number", `${msg} price is a number`);
  assert.equal(actual.rejected, exp.rejected, `${msg} rejected`);
  close(actual.publicEV, exp.publicEV, `${msg} publicEV`);
  if (!exp.rejected) assert.equal(actual.positionAfter, exp.positionAfter, `${msg} positionAfter`);
}

function checkFills(actual, expected, msg = "") {
  assert.ok(Array.isArray(actual), `${msg}: fills is an array`);
  assert.equal(actual.length, expected.length, `${msg}: fill count`);
  expected.forEach((e, i) => checkFill(actual[i], e, `${msg} fill ${i}`));
}

function checkMetrics(actual, exp, msg = "") {
  assert.equal(actual.V, exp.V, `${msg} V`);
  close(actual.pnl, exp.pnl, `${msg} pnl`);
  close(actual.cash, exp.cash, `${msg} cash`);
  assert.equal(actual.position, exp.position, `${msg} position`);
  close(actual.edge, exp.edge, `${msg} edge`);
  close(actual.adverse, exp.adverse, `${msg} adverse`);
  assert.equal(actual.trades, exp.trades, `${msg} trades`);
  assert.equal(actual.maxPos, exp.maxPos, `${msg} maxPos`);
  assert.ok(Array.isArray(actual.fairErrors), `${msg} fairErrors is an array`);
  assert.equal(actual.fairErrors.length, exp.fairErrors.length, `${msg} fairErrors length`);
  exp.fairErrors.forEach((e, i) => close(actual.fairErrors[i], e, `${msg} fairErrors[${i}]`));
  close(actual.meanFairError, exp.meanFairError, `${msg} meanFairError`);
}

// Play a whole game through the module. Returns the final state and each round's result.
function play(state, quotes) {
  const results = [];
  let s = state;
  for (const q of quotes) {
    const r = M.submitQuote(s, q);
    assert.equal(r.ok, true, `quote ${JSON.stringify(q)} in round ${s.round} should be accepted: ${r.error}`);
    results.push(r);
    s = r.state;
  }
  return { state: s, results };
}

const clone = (x) => JSON.parse(JSON.stringify(x));
const Q = (fair, bid, ask) => ({ fair, bid, ask });

// The §G5 worked example, dice seed 7.
const WORKED_QUOTES = [Q(10.5, 9.5, 11.5), Q(8, 7, 9), Q(10, 9, 11)];

// ---------- 1. exports and constants ----------

test("PrepMarket exports the §G constants and functions", () => {
  assert.deepEqual(M.SCENARIOS, ["dice", "cards", "coins"]);
  assert.equal(M.DEFAULT_MAX_POS, 10);
  assert.deepEqual(M.DEFAULT_MAX_WIDTH, { dice: 4, cards: 8, coins: 3 });
  assert.equal(M.EV_EPS, 1e-9);
  for (const f of ["createGame", "conditionalEV", "validateQuote", "submitQuote", "settle", "runEntry", "goodQuoterLine"]) {
    assert.equal(typeof M[f], "function", f);
  }
});

// ---------- 2. conditionalEV (spec §6 required test) ----------

test("required: conditionalEV matches brute-force enumeration for small cases (dice)", () => {
  const r = refMulberry32(1001);
  let cases = 0;
  for (let n = 1; n <= 7; n++) {
    for (let m = Math.max(0, n - 3); m <= n; m++) {
      for (let rep = 0; rep < 3; rep++) {
        const revealed = Array.from({ length: m }, () => 1 + Math.floor(r() * 6));
        close(M.conditionalEV({ kind: "dice", n }, revealed), bruteEV("dice", n, revealed),
          `dice n=${n} revealed=${revealed}`);
        cases++;
      }
    }
  }
  assert.ok(cases >= 20);
});

test("required: conditionalEV matches brute-force enumeration for small cases (coins, flat flips)", () => {
  const r = refMulberry32(2002);
  for (let n = 1; n <= 12; n++) {
    for (let m = Math.max(0, n - 3); m <= n; m++) {
      for (let rep = 0; rep < 3; rep++) {
        const revealed = Array.from({ length: m }, () => (r() < 0.5 ? 1 : 0));
        close(M.conditionalEV({ kind: "coins", n }, revealed), bruteEV("coins", n, revealed),
          `coins n=${n} revealed=${revealed}`);
      }
    }
  }
  // Coins `revealed` is individual flips, even when not aligned to a batch.
  const s = M.createGame("coins", 3, { values: [1, 0, 1, 1, 0, 1, 1], batch: 3 });
  close(M.conditionalEV(s, [1, 0]), bruteEV("coins", 7, [1, 0]), "coins state, partial batch");
});

test("required: conditionalEV matches brute-force enumeration for small cases (cards, without replacement)", () => {
  const r = refMulberry32(3003);
  const prefixes = [];
  for (let n = 1; n <= 7; n++) {
    for (let m = Math.max(0, n - 3); m <= n; m++) {
      const deck = FULL_DECK.slice();
      const revealed = [];
      for (let j = 0; j < m; j++) {
        const idx = Math.floor(r() * deck.length);
        revealed.push(deck[idx]);
        deck.splice(idx, 1);
      }
      prefixes.push({ n, revealed });
    }
  }
  // Skewed prefixes where without-replacement matters a lot.
  prefixes.push({ n: 6, revealed: [13, 13, 13, 13] });
  prefixes.push({ n: 8, revealed: [1, 1, 1, 1, 2, 2] });
  prefixes.push({ n: 3, revealed: [] });
  for (const { n, revealed } of prefixes) {
    close(M.conditionalEV({ kind: "cards", n }, revealed), bruteEV("cards", n, revealed),
      `cards n=${n} revealed=${revealed}`);
  }
});

test("conditionalEV accepts a game state as the scenario and ignores its hidden outcomes", () => {
  const dice = M.createGame("dice", 7); // outcomes [1, 6, 5]
  assert.equal(M.conditionalEV(dice, []), 10.5);
  assert.equal(M.conditionalEV(dice, [1]), 8);
  assert.equal(M.conditionalEV(dice, [1, 6]), 10.5);
  assert.equal(M.conditionalEV(dice, [1, 6, 5]), 12);
  const cards = M.createGame("cards", 7); // outcomes [1, 13, 9]
  close(M.conditionalEV(cards, []), 21, "cards nothing revealed");
  close(M.conditionalEV(cards, [1]), bruteEV("cards", 3, [1]), "cards one revealed");
  assert.equal(M.conditionalEV(cards, [1, 13, 9]), 23);
});

test("conditionalEV with everything revealed is the revealed sum, and more than n units is a RangeError", () => {
  assert.equal(M.conditionalEV({ kind: "dice", n: 4 }, [2, 3, 4, 6]), 15);
  assert.equal(M.conditionalEV({ kind: "coins", n: 3 }, [1, 0, 1]), 2);
  assert.equal(M.conditionalEV({ kind: "cards", n: 2 }, [12, 5]), 17);
  assert.throws(() => M.conditionalEV({ kind: "dice", n: 2 }, [1, 2, 3]), RangeError);
  assert.throws(() => M.conditionalEV({ kind: "coins", n: 1 }, [1, 0]), RangeError);
  assert.throws(() => M.conditionalEV({ kind: "cards", n: 3 }, [1, 2, 3, 4]), RangeError);
});

// ---------- 3. createGame: draws, state and validation (§G1) ----------

test("createGame reference values for seed 7 (§G1, Appendix B)", () => {
  const d = M.createGame("dice", 7);
  assert.equal(d.n, 3);
  assert.deepEqual(d.outcomes, [1, 6, 5]);
  assert.equal(d.rounds, 3);
  assert.equal(d.batch, null);
  const c = M.createGame("cards", 7);
  assert.equal(c.n, 3);
  assert.deepEqual(c.outcomes, [1, 13, 9]);
  assert.equal(c.rounds, 3);
  assert.equal(c.batch, null);
  const k = M.createGame("coins", 7);
  assert.equal(k.batch, 2);
  assert.equal(k.n, 6);
  assert.deepEqual(k.outcomes, [0, 0, 0, 1, 1, 1]);
  assert.equal(k.rounds, 3);
});

test("createGame initial state has the §G1 shape and defaults, and is plain JSON", () => {
  for (const kind of ["dice", "cards", "coins"]) {
    const s = M.createGame(kind, 7);
    assert.equal(s.kind, kind);
    assert.equal(s.seed, 7);
    assert.equal(s.bots, "mixed");
    assert.equal(s.maxPos, 10);
    assert.equal(s.maxWidth, { dice: 4, cards: 8, coins: 3 }[kind]);
    assert.deepEqual(s.revealed, []);
    assert.equal(s.round, 0);
    assert.equal(s.done, false);
    assert.equal(s.cash, 0);
    assert.equal(s.position, 0);
    assert.equal(s.maxAbsPos, 0);
    assert.deepEqual(s.history, []);
    assert.equal(s.outcomes.length, s.n);
    assert.ok(Number.isInteger(s.rng) && s.rng >= 0 && s.rng < 2 ** 32, "rng is a uint32");
    assert.deepEqual(clone(s), s, "state survives a JSON round trip");
  }
  const o = M.createGame("cards", 7, { bots: "informed", maxPos: 3, maxWidth: 2.5 });
  assert.equal(o.bots, "informed");
  assert.equal(o.maxPos, 3);
  assert.equal(o.maxWidth, 2.5);
  assert.deepEqual(o.outcomes, [1, 13, 9], "bots, maxPos and maxWidth consume no draw");
});

test("createGame reproduces the §G1 draw table for many seeds (dice, cards, coins)", () => {
  for (let seed = 0; seed < 60; seed++) {
    for (const kind of ["dice", "cards", "coins"]) {
      const exp = refCreate(kind, seed);
      const s = M.createGame(kind, seed);
      assert.equal(s.n, exp.n, `${kind} seed ${seed} n`);
      assert.equal(s.batch, exp.batch, `${kind} seed ${seed} batch`);
      assert.equal(s.rounds, exp.rounds, `${kind} seed ${seed} rounds`);
      assert.deepEqual(s.outcomes, exp.outcomes, `${kind} seed ${seed} outcomes`);
    }
  }
  // The seed is coerced with >>> 0.
  assert.deepEqual(M.createGame("dice", 2 ** 32 + 7).outcomes, [1, 6, 5]);
});

test("createGame draws stay inside the §G1 ranges", () => {
  for (let seed = 100; seed < 300; seed++) {
    const d = M.createGame("dice", seed);
    assert.ok(d.n >= 3 && d.n <= 10, `dice n ${d.n}`);
    assert.ok(d.outcomes.every((v) => Number.isInteger(v) && v >= 1 && v <= 6));
    const c = M.createGame("cards", seed);
    assert.ok(c.n >= 3 && c.n <= 8, `cards n ${c.n}`);
    const counts = {};
    for (const v of c.outcomes) {
      assert.ok(Number.isInteger(v) && v >= 1 && v <= 13);
      counts[v] = (counts[v] || 0) + 1;
      assert.ok(counts[v] <= 4, "no rank more than 4 times");
    }
    const k = M.createGame("coins", seed);
    assert.ok(k.batch >= 2 && k.batch <= 5, `coins batch ${k.batch}`);
    assert.equal(k.n % k.batch, 0);
    assert.ok(k.n / k.batch >= 3 && k.n / k.batch <= 8, `coins n ${k.n}`);
    assert.equal(k.rounds, Math.ceil(k.n / k.batch));
    assert.ok(k.outcomes.every((v) => v === 0 || v === 1));
  }
});

test("createGame: a parameter given in opts consumes no draw", () => {
  // dice n given: the faces are the first n draws.
  const d = M.createGame("dice", 7, { n: 5 });
  assert.equal(d.n, 5);
  assert.deepEqual(d.outcomes, refDraws(7, 5).map((u) => 1 + Math.floor(u * 6)));
  // cards n given.
  assert.deepEqual(M.createGame("cards", 11, { n: 4 }).outcomes, refCreate("cards", 11, { n: 4 }).outcomes);
  // coins batch given: n = batch * randInt(3, 8) uses the first draw.
  const kb = M.createGame("coins", 7, { batch: 4 });
  const expB = refCreate("coins", 7, { batch: 4 });
  assert.equal(kb.batch, 4);
  assert.equal(kb.n, expB.n);
  assert.deepEqual(kb.outcomes, expB.outcomes);
  // coins n given: batch is still drawn.
  const kn = M.createGame("coins", 9, { n: 7 });
  const expN = refCreate("coins", 9, { n: 7 });
  assert.equal(kn.batch, expN.batch);
  assert.equal(kn.n, 7);
  assert.equal(kn.rounds, Math.ceil(7 / expN.batch));
  assert.deepEqual(kn.outcomes, expN.outcomes);
});

test("createGame with opts.values injects the hidden values (n = values.length, coins still draw batch)", () => {
  const d = M.createGame("dice", 5, { values: [2, 2, 3, 6] });
  assert.equal(d.n, 4);
  assert.equal(d.rounds, 4);
  assert.deepEqual(d.outcomes, [2, 2, 3, 6]);
  const c = M.createGame("cards", 5, { values: [1, 1, 1, 1, 13] });
  assert.equal(c.n, 5);
  assert.deepEqual(c.outcomes, [1, 1, 1, 1, 13]);
  const k = M.createGame("coins", 7, { values: [1, 0, 1, 1, 0] });
  assert.equal(k.batch, 2, "seed 7's first draw gives batch 2");
  assert.equal(k.n, 5);
  assert.equal(k.rounds, 3);
  assert.deepEqual(k.outcomes, [1, 0, 1, 1, 0]);
  const kb = M.createGame("coins", 7, { values: [1, 0, 1, 1, 0, 1, 1], batch: 3 });
  assert.equal(kb.batch, 3);
  assert.equal(kb.rounds, 3);
  // Matching n and values are fine.
  assert.deepEqual(M.createGame("dice", 5, { n: 3, values: [4, 5, 6] }).outcomes, [4, 5, 6]);
});

test("state.rng is the mulberry32 state after the creation draws (§G1)", () => {
  // Creation draws: dice seed 7 uses 1 + 3, cards seed 7 uses 1 + 3, coins seed 7 uses 2 + 6.
  for (const kind of ["dice", "cards", "coins"]) {
    for (const seed of [7, 8, 1234]) {
      const exp = refCreate(kind, seed);
      const s = M.createGame(kind, seed);
      assert.equal(refNextFromState(s.rng), refDraws(seed, exp.used + 1)[exp.used],
        `${kind} seed ${seed}: the next draw follows the ${exp.used} creation draws`);
    }
  }
  // Injected values: no draws at all for dice and cards; only batch for coins.
  assert.equal(refNextFromState(M.createGame("dice", 21, { values: [3, 3, 3] }).rng), refDraws(21, 1)[0]);
  assert.equal(refNextFromState(M.createGame("cards", 21, { values: [3, 3, 3] }).rng), refDraws(21, 1)[0]);
  assert.equal(refNextFromState(M.createGame("coins", 21, { values: [1, 1, 0] }).rng), refDraws(21, 2)[1]);
  assert.equal(refNextFromState(M.createGame("coins", 21, { values: [1, 1, 0], batch: 2 }).rng), refDraws(21, 1)[0]);
});

test("createGame throws on invalid injected values", () => {
  assert.throws(() => M.createGame("dice", 1, { values: [0, 3, 4] }));
  assert.throws(() => M.createGame("dice", 1, { values: [7, 3, 4] }));
  assert.throws(() => M.createGame("dice", 1, { values: [2.5, 3, 4] }));
  assert.throws(() => M.createGame("cards", 1, { values: [14, 3, 4] }));
  assert.throws(() => M.createGame("cards", 1, { values: [0, 3, 4] }));
  assert.throws(() => M.createGame("cards", 1, { values: [5, 5, 5, 5, 5] })); // a rank 5 times
  assert.throws(() => M.createGame("coins", 1, { values: [0, 1, 2] }));
  assert.throws(() => M.createGame("coins", 1, { values: [0, 0.5, 1] }));
  assert.throws(() => M.createGame("dice", 1, { n: 4, values: [1, 2, 3] })); // n and values disagree
  // Four of a rank is allowed.
  assert.doesNotThrow(() => M.createGame("cards", 1, { values: [5, 5, 5, 5] }));
});

test("createGame throws on unknown kind, unknown bots, maxPos < 1 or maxWidth <= 0", () => {
  assert.throws(() => M.createGame("roulette", 1));
  assert.throws(() => M.createGame("dice", 1, { bots: "smart" }));
  assert.throws(() => M.createGame("dice", 1, { maxPos: 0 }));
  assert.throws(() => M.createGame("coins", 1, { maxWidth: 0 }));
  assert.throws(() => M.createGame("cards", 1, { maxWidth: -2 }));
  assert.doesNotThrow(() => M.createGame("dice", 1, { maxPos: 1, maxWidth: 0.5 }));
  for (const bots of ["noise", "informed", "mixed"]) assert.equal(M.createGame("dice", 1, { bots }).bots, bots);
});

// ---------- 4. quote validation (spec §6 required test, §G3) ----------

test("required: a quote with bid ≥ ask, or width over the maximum, is rejected with an error", () => {
  const s = M.createGame("dice", 7);
  const before = clone(s);
  for (const q of [Q(10.5, 10.5, 10.5), Q(10.5, 11, 10)]) {
    const r = M.submitQuote(s, q);
    assert.equal(r.ok, false, `bid ${q.bid} ask ${q.ask}`);
    assert.ok(typeof r.error === "string" && r.error.length > 0);
    assert.match(r.error, /bid/i);
    const v = M.validateQuote(s, q);
    assert.equal(v.ok, false);
    assert.match(v.error, /bid/i);
  }
  // Width over each kind's default maximum (dice 4, cards 8, coins 3).
  for (const [kind, bid, ask] of [["dice", 8, 12.5], ["cards", 15, 23.5], ["coins", 1, 4.25]]) {
    const g = M.createGame(kind, 7);
    const r = M.submitQuote(g, Q(bid + 1, bid, ask));
    assert.equal(r.ok, false, `${kind} width ${ask - bid}`);
    assert.match(r.error, /width/i);
    assert.match(M.validateQuote(g, Q(bid + 1, bid, ask)).error, /width/i);
  }
  assert.deepEqual(s, before, "a rejected quote leaves the state unchanged");
  // The untouched state still plays round 0.
  const ok = M.submitQuote(s, WORKED_QUOTES[0]);
  assert.equal(ok.ok, true);
  assert.equal(ok.state.round, 1);
});

test("quote width exactly maxWidth is accepted; a custom maxWidth is enforced", () => {
  assert.equal(M.submitQuote(M.createGame("dice", 7), Q(11.5, 9.5, 13.5)).ok, true);
  assert.equal(M.submitQuote(M.createGame("cards", 7), Q(21, 17, 25)).ok, true);
  assert.equal(M.submitQuote(M.createGame("coins", 7), Q(3, 1.5, 4.5)).ok, true);
  assert.equal(M.validateQuote(M.createGame("dice", 7), Q(10, 9, 13)).ok, true);
  const narrow = M.createGame("dice", 7, { maxWidth: 1 });
  assert.equal(M.submitQuote(narrow, Q(10.5, 10, 11)).ok, true);
  const wide = M.submitQuote(narrow, Q(10.5, 10, 11.5));
  assert.equal(wide.ok, false);
  assert.match(wide.error, /width/i);
});

test("quote values must be finite numbers or non-empty numeric strings (keyword number)", () => {
  const s = M.createGame("dice", 7);
  const before = clone(s);
  const bad = [NaN, Infinity, -Infinity, "", "   ", null, undefined, "abc", "12abc"];
  for (const field of ["fair", "bid", "ask"]) {
    for (const b of bad) {
      const q = { fair: 10.5, bid: 9.5, ask: 11.5, [field]: b };
      const r = M.submitQuote(s, q);
      assert.equal(r.ok, false, `${field} = ${String(b)}`);
      assert.match(r.error, /number/i, `${field} = ${String(b)}`);
      const v = M.validateQuote(s, q);
      assert.equal(v.ok, false);
      assert.match(v.error, /number/i);
    }
  }
  const missing = M.submitQuote(s, { bid: 9.5, ask: 11.5 });
  assert.equal(missing.ok, false);
  assert.match(missing.error, /number/i);
  assert.deepEqual(s, before);
});

test("numeric strings are accepted and stored as numbers; fair need not lie inside the quote", () => {
  const s = M.createGame("dice", 7, { bots: "noise" });
  const r = M.submitQuote(s, { fair: "10.5", bid: " 9.5 ", ask: "11.5" });
  assert.equal(r.ok, true);
  const h = r.state.history[0];
  assert.equal(h.fair, 10.5);
  assert.equal(h.bid, 9.5);
  assert.equal(h.ask, 11.5);
  assert.equal(r.fills[0].price, 9.5, "seed 7 noise sells at the bid in round 0");
  assert.equal(typeof r.fills[0].price, "number");
  assert.equal(r.state.cash, -9.5);
  const far = M.submitQuote(M.createGame("dice", 7), Q(100, 9.5, 11.5));
  assert.equal(far.ok, true);
});

test("submitQuote on a finished game is an error (keyword over)", () => {
  const { state } = play(M.createGame("dice", 7), WORKED_QUOTES);
  assert.equal(state.done, true);
  const before = clone(state);
  const r = M.submitQuote(state, Q(12, 11, 13));
  assert.equal(r.ok, false);
  assert.match(r.error, /over/i);
  // §G3 step 1 comes before validation: an invalid quote on a finished game still says "over".
  const bad = M.submitQuote(state, Q(12, 13, 11));
  assert.equal(bad.ok, false);
  assert.match(bad.error, /over/i);
  assert.deepEqual(state, before);
});

// ---------- 5. scripted games and settlement (spec §6 required test, §G5) ----------

test("required: P&L settlement for a scripted game (§G5 worked example, dice seed 7)", () => {
  const { state, results } = play(M.createGame("dice", 7), WORKED_QUOTES);
  const exp = [
    { publicEV: 10.5, informedEV: 8, reveal: [1], fills: [
      { round: 0, bot: "noise", userSide: "buy", price: 9.5, rejected: false, publicEV: 10.5, positionAfter: 1 },
      { round: 0, bot: "informed", userSide: "buy", price: 9.5, rejected: false, publicEV: 10.5, positionAfter: 2 }] },
    { publicEV: 8, informedEV: 10.5, reveal: [6], fills: [
      { round: 1, bot: "noise", userSide: "sell", price: 9, rejected: false, publicEV: 8, positionAfter: 1 },
      { round: 1, bot: "informed", userSide: "sell", price: 9, rejected: false, publicEV: 8, positionAfter: 0 }] },
    { publicEV: 10.5, informedEV: 12, reveal: [5], fills: [
      { round: 2, bot: "noise", userSide: "sell", price: 11, rejected: false, publicEV: 10.5, positionAfter: -1 },
      { round: 2, bot: "informed", userSide: "sell", price: 11, rejected: false, publicEV: 10.5, positionAfter: -2 }] },
  ];
  exp.forEach((e, i) => {
    const r = results[i];
    assert.deepEqual(r.reveal, e.reveal, `round ${i} reveal`);
    checkFills(r.fills, e.fills, `round ${i}`);
    const h = r.state.history[i];
    assert.equal(h.round, i);
    assert.equal(h.fair, WORKED_QUOTES[i].fair);
    assert.equal(h.bid, WORKED_QUOTES[i].bid);
    assert.equal(h.ask, WORKED_QUOTES[i].ask);
    assert.equal(h.publicEV, e.publicEV);
    assert.equal(h.informedEV, e.informedEV);
    checkFills(h.fills, e.fills, `history ${i}`);
  });
  assert.equal(state.done, true);
  assert.equal(state.round, 3);
  assert.deepEqual(state.revealed, [1, 6, 5]);
  assert.equal(state.cash, 21);
  assert.equal(state.position, -2);
  assert.equal(state.maxAbsPos, 2);
  const m = M.settle(state);
  assert.equal(m.V, 12);
  assert.equal(m.cash, 21);
  assert.equal(m.position, -2);
  assert.equal(m.pnl, -3);
  assert.equal(m.edge, 5);
  assert.equal(m.adverse, 1.5);
  assert.equal(m.trades, 6);
  assert.equal(m.maxPos, 2);
  assert.deepEqual(m.fairErrors, [0, 0, 0.5]);
  close(m.meanFairError, 0.5 / 3, "meanFairError");
});

test("required: P&L settlement for a scripted game (injected coins, partial last batch, a rejected fill)", () => {
  // Hidden flips 1,0 | 1,1 | 0 (V = 3), batch 2, informed bot only, maxPos 1.
  // r0: publicEV 2.5, informed 2.5 > ask 2.25 -> user sells 2.25 (position -1).
  // r1: publicEV 2.5, informed 3.5 > ask 3 -> user would sell, position -2 breaches maxPos: rejected.
  // r2: publicEV 3.5, informed 3 < bid 3.125 -> user buys 3.125 (position 0).
  const quotes = [Q(2.5, 1.5, 2.25), Q(3, 2.5, 3), Q(3.5, 3.125, 4)];
  const s0 = M.createGame("coins", 123, { values: [1, 0, 1, 1, 0], batch: 2, maxPos: 1, bots: "informed" });
  assert.equal(s0.rounds, 3);
  const { state, results } = play(s0, quotes);
  assert.deepEqual(results.map((r) => r.reveal), [[1, 0], [1, 1], [0]]);
  assert.deepEqual(state.history.map((h) => h.publicEV), [2.5, 2.5, 3.5]);
  assert.deepEqual(state.history.map((h) => h.informedEV), [2.5, 3.5, 3]);
  checkFills(results[0].fills, [{ round: 0, bot: "informed", userSide: "sell", price: 2.25, rejected: false, publicEV: 2.5, positionAfter: -1 }], "r0");
  checkFills(results[1].fills, [{ round: 1, bot: "informed", userSide: "sell", price: 3, rejected: true, publicEV: 2.5 }], "r1");
  checkFills(results[2].fills, [{ round: 2, bot: "informed", userSide: "buy", price: 3.125, rejected: false, publicEV: 3.5, positionAfter: 0 }], "r2");
  assert.equal(results[1].state.position, -1, "the rejected fill changes nothing");
  assert.equal(results[1].state.cash, 2.25);
  assert.deepEqual(state.revealed, [1, 0, 1, 1, 0]);
  const m = M.settle(state);
  checkMetrics(m, {
    V: 3, pnl: -0.875, cash: -0.875, position: 0, edge: 0.125, adverse: 0.875, trades: 2, maxPos: 1,
    fairErrors: [0, 0.5, 0], meanFairError: 0.5 / 3,
  }, "coins game");
});

test("required: P&L settlement for a scripted game (injected cards, tolerance on non-binary EVs)", () => {
  // Hidden cards 13, 2, 7 (V = 22), informed bot only. EVs come from our brute-force oracle.
  const quotes = [Q(21, 20, 22), Q(26, 25, 27), Q(22, 21, 23)];
  const { state, results } = play(M.createGame("cards", 5, { values: [13, 2, 7], bots: "informed" }), quotes);
  const pub = [bruteEV("cards", 3, []), bruteEV("cards", 3, [13]), bruteEV("cards", 3, [13, 2])];
  const inf = [pub[1], pub[2], 22];
  state.history.forEach((h, i) => {
    close(h.publicEV, pub[i], `round ${i} publicEV`);
    close(h.informedEV, inf[i], `round ${i} informedEV`);
  });
  checkFills(results[0].fills, [{ round: 0, bot: "informed", userSide: "sell", price: 22, rejected: false, publicEV: pub[0], positionAfter: -1 }], "r0");
  checkFills(results[1].fills, [{ round: 1, bot: "informed", userSide: "buy", price: 25, rejected: false, publicEV: pub[1], positionAfter: 0 }], "r1");
  checkFills(results[2].fills, [], "r2: informed EV 22 inside 21..23, no trade");
  const fairErrors = [Math.abs(21 - pub[0]), Math.abs(26 - pub[1]), Math.abs(22 - pub[2])];
  checkMetrics(M.settle(state), {
    V: 22, pnl: -3, cash: -3, position: 0,
    edge: (22 - pub[0]) * 1 + (25 - pub[1]) * -1,
    adverse: -((22 - 22) * 1 + (25 - 22) * -1),
    trades: 2, maxPos: 1, fairErrors, meanFairError: sum(fairErrors) / 3,
  }, "cards game");
});

test("settle: edge sign convention is +1 when the user sells and -1 when the user buys", () => {
  // Hidden dice 6, 1, 2 (V = 9), informed bot only.
  // r0: publicEV 10.5, informed 13 > ask 12 -> user SELLS at 12: edge +1.5 (sold above E).
  // r1: publicEV 13, informed 10.5 < bid 13.5 -> user BUYS at 13.5: edge -0.5 (bought above E).
  // r2: publicEV 10.5, informed 9 inside 8..10 -> no trade.
  const quotes = [Q(11, 11, 12), Q(13, 13.5, 14), Q(9, 8, 10)];
  const { state, results } = play(M.createGame("dice", 4, { values: [6, 1, 2], bots: "informed" }), quotes);
  assert.equal(results[0].fills[0].userSide, "sell");
  assert.equal(results[1].fills[0].userSide, "buy");
  assert.equal(results[2].fills.length, 0);
  const m = M.settle(state);
  assert.equal(m.edge, 1, "+1.5 - 0.5; the opposite sign convention would give -1");
  assert.equal(m.adverse, 1.5, "informed fills lost 1.5 against V = 9: -((12-9)*1 + (13.5-9)*-1)");
  assert.equal(m.pnl, -1.5);
  assert.equal(m.cash, -1.5);
  assert.equal(m.position, 0);
  assert.equal(m.trades, 2);
  assert.equal(m.maxPos, 1);
  assert.deepEqual(m.fairErrors, [0.5, 0, 1.5]);
  close(m.meanFairError, 2 / 3, "meanFairError");
});

test("settle: adverse counts informed fills only, against the realised V", () => {
  // Noise-only game: no informed fills, so adverse is 0 whatever the P&L.
  const quotes = WORKED_QUOTES;
  const noise = play(M.createGame("dice", 7, { bots: "noise" }), quotes).state;
  const m = M.settle(noise);
  // `===`, not assert.equal (Object.is): the literal §G5 formula -Σ over no fills gives -0.
  assert.ok(m.adverse === 0, `adverse with no informed fills is 0, got ${m.adverse}`);
  // Seed 7 noise: user buys 9.5, sells 9, sells 11.
  assert.equal(m.cash, -9.5 + 9 + 11);
  assert.equal(m.position, -1);
  assert.equal(m.pnl, 10.5 - 12);
  assert.equal(m.trades, 3);
  assert.equal(m.edge, (9.5 - 10.5) * -1 + (9 - 8) + (11 - 10.5));
  assert.equal(m.maxPos, 1);
});

test("settle throws until the game is done", () => {
  const s = M.createGame("dice", 7);
  assert.throws(() => M.settle(s));
  const one = M.submitQuote(s, WORKED_QUOTES[0]).state;
  assert.equal(one.done, false);
  assert.throws(() => M.settle(one));
});

// ---------- 6. fills and position limits (spec §6 required test, §G3 step 5) ----------

test("required: fills and position limits (the second bot sees the position the first left)", () => {
  // Worked-example quotes, maxPos 1. Seed 7 noise: bot sells, buys, buys.
  const { state, results } = play(M.createGame("dice", 7, { maxPos: 1 }), WORKED_QUOTES);
  checkFills(results[0].fills, [
    { round: 0, bot: "noise", userSide: "buy", price: 9.5, rejected: false, publicEV: 10.5, positionAfter: 1 },
    { round: 0, bot: "informed", userSide: "buy", price: 9.5, rejected: true, publicEV: 10.5 }], "r0");
  assert.equal(results[0].state.position, 1);
  assert.equal(results[0].state.cash, -9.5);
  assert.equal(results[0].state.maxAbsPos, 1);
  checkFills(results[1].fills, [
    { round: 1, bot: "noise", userSide: "sell", price: 9, rejected: false, publicEV: 8, positionAfter: 0 },
    { round: 1, bot: "informed", userSide: "sell", price: 9, rejected: false, publicEV: 8, positionAfter: -1 }], "r1");
  checkFills(results[2].fills, [
    { round: 2, bot: "noise", userSide: "sell", price: 11, rejected: true, publicEV: 10.5 },
    { round: 2, bot: "informed", userSide: "sell", price: 11, rejected: true, publicEV: 10.5 }], "r2");
  assert.equal(state.position, -1);
  assert.equal(state.cash, 8.5);
  assert.equal(state.maxAbsPos, 1);
  const m = M.settle(state);
  assert.equal(m.trades, 3, "rejected fills are not trades");
  assert.equal(m.pnl, 8.5 - 12);
  assert.equal(m.edge, 3, "rejected fills add no edge");
  assert.equal(m.adverse, 3, "only the accepted informed fill counts: -((9 - 12) * 1)");
  assert.equal(m.maxPos, 1);
});

test("required: fills and position limits (default maxPos 10: reaching ±10 is allowed, beyond is rejected)", () => {
  // Ten hidden sixes (or ones), mixed bots, quotes centred on public E[V] with half-width 1: the
  // informed bot's E[V] is 2.5 above the ask (below the bid), so it buys (sells) every round and
  // the user is pushed short (long) to the limit. The seeds are ones where the limit binds.
  const cases = [
    { face: 6, seed: 15, side: "sell", limit: -10 },
    { face: 1, seed: 5, side: "buy", limit: 10 },
  ];
  for (const { face, seed, side, limit } of cases) {
    const values = Array(10).fill(face);
    const quoteFor = (i, pe) => Q(pe, pe - 1, pe + 1);
    const exp = refPlay("dice", seed, { values }, quoteFor);
    let s = M.createGame("dice", seed, { values });
    assert.equal(s.maxPos, 10);
    const all = [];
    for (let i = 0; i < s.rounds; i++) {
      const r = M.submitQuote(s, exp.quotes[i]);
      assert.equal(r.ok, true);
      checkFills(r.fills, exp.rounds[i].fills, `face ${face} round ${i}`);
      all.push(...r.fills);
      s = r.state;
    }
    const rejected = all.filter((f) => f.rejected);
    assert.ok(rejected.length >= 1, `face ${face}: the limit binds at least once for this seed`);
    for (const f of all.filter((x) => !x.rejected)) assert.ok(Math.abs(f.positionAfter) <= 10);
    assert.ok(all.some((f) => !f.rejected && f.positionAfter === limit), `face ${face}: position ${limit} is reached`);
    for (const f of rejected) assert.equal(f.userSide, side, `face ${face}: only a further ${side} at ${limit} is rejected`);
    assert.equal(s.maxAbsPos, 10);
    assert.equal(s.position, exp.position);
    checkMetrics(M.settle(s), exp.metrics, `face ${face} maxPos 10 game`);
  }
});

test("required: fills and position limits (long side, custom maxPos: buys stop at +maxPos)", () => {
  // Hidden dice 1,1,1,1,1 (V = 5), informed bot only, maxPos 3. Quotes are centred on the public
  // E[V] (17.5, 15, 12.5, 10, 7.5) with half-width 1. The informed E[V] is 2.5 lower, below the
  // bid, so the bot sells every round and the user buys at the bid: +1, +2, +3, then rejected twice.
  const pe = [17.5, 15, 12.5, 10, 7.5];
  const quotes = pe.map((e) => Q(e, e - 1, e + 1));
  const { state, results } = play(M.createGame("dice", 3, { values: [1, 1, 1, 1, 1], bots: "informed", maxPos: 3 }), quotes);
  const want = [
    { price: 16.5, rejected: false, positionAfter: 1 },
    { price: 14, rejected: false, positionAfter: 2 },
    { price: 11.5, rejected: false, positionAfter: 3 },
    { price: 9, rejected: true },
    { price: 6.5, rejected: true },
  ];
  want.forEach((w, i) => {
    const exp = [{ round: i, bot: "informed", userSide: "buy", publicEV: pe[i], ...w }];
    checkFills(results[i].fills, exp, `round ${i}`);
    checkFills(state.history[i].fills, exp, `history ${i} keeps rejected fills too`);
  });
  assert.equal(results[3].state.position, 3);
  assert.equal(results[3].state.cash, -42, "the rejected buy at 9 does not touch cash");
  assert.equal(state.position, 3);
  assert.equal(state.maxAbsPos, 3);
  const m = M.settle(state);
  assert.equal(m.V, 5);
  assert.equal(m.cash, -42);
  assert.equal(m.pnl, -27);
  assert.equal(m.trades, 3);
  assert.equal(m.maxPos, 3);
  assert.equal(m.edge, 3, "each buy was 1 below the public E[V]");
  assert.equal(m.adverse, 27, "every accepted fill was informed, so adverse = -pnl");
  assert.equal(m.fairErrors.length, 5);
  assert.ok(m.fairErrors.every((e) => e === 0), "every fair equalled the public E[V]");
  assert.ok(m.meanFairError === 0);
});

test("a rejected fill changes neither cash, position nor maxAbsPos", () => {
  const s0 = M.createGame("dice", 9, { values: [6, 6, 6], bots: "informed", maxPos: 1 });
  const r0 = M.submitQuote(s0, Q(10.5, 10, 11)); // informed 13 > 11: user sells (position -1)
  assert.equal(r0.state.position, -1);
  const r1 = M.submitQuote(r0.state, Q(13, 13, 14)); // informed 15.5 > 14: would go to -2
  assert.equal(r1.fills.length, 1);
  assert.equal(r1.fills[0].rejected, true);
  assert.equal(r1.state.position, -1);
  assert.equal(r1.state.cash, 11);
  assert.equal(r1.state.maxAbsPos, 1);
  const r2 = M.submitQuote(r1.state, Q(15.5, 19, 20)); // informed 18 < 19: user buys (position 0)
  assert.equal(r2.fills[0].rejected, false);
  assert.equal(r2.state.position, 0);
  assert.equal(r2.state.cash, 11 - 19);
  assert.equal(r2.state.maxAbsPos, 1);
});

// ---------- 7. informed bot at the boundary (spec §6 required test) ----------

test("required: informed-bot logic at boundary prices (exactly equal to E means no trade)", () => {
  // Dice 1, 6, 5: in round 0 the informed bot's E[V] is 1 + 2 * 3.5 = 8.
  const fresh = () => M.createGame("dice", 7, { values: [1, 6, 5], bots: "informed" });
  const fillsFor = (q) => {
    const r = M.submitQuote(fresh(), q);
    assert.equal(r.ok, true);
    assert.equal(r.state.history[0].informedEV, 8);
    return r.fills;
  };
  assert.deepEqual(fillsFor(Q(8, 7, 8)), [], "ask exactly E: no trade, no Fill recorded");
  assert.deepEqual(fillsFor(Q(8, 8, 9)), [], "bid exactly E: no trade");
  assert.deepEqual(fillsFor(Q(8, 8 - 1e-12, 8)), [], "bid and ask within EV_EPS of E: no trade");
  assert.deepEqual(fillsFor(Q(8, 7, 8 - 1e-12)), [], "ask within EV_EPS below E: no trade");
  assert.deepEqual(fillsFor(Q(8, 8 + 1e-12, 9)), [], "bid within EV_EPS above E: no trade");
  const buy = fillsFor(Q(8, 7, 7.75));
  checkFills(buy, [{ round: 0, bot: "informed", userSide: "sell", price: 7.75, rejected: false, publicEV: 10.5, positionAfter: -1 }], "E above ask");
  const sell = fillsFor(Q(8, 8.25, 9));
  checkFills(sell, [{ round: 0, bot: "informed", userSide: "buy", price: 8.25, rejected: false, publicEV: 10.5, positionAfter: 1 }], "E below bid");
  checkFills(fillsFor(Q(8, 7, 8 - 1e-7)), [{ round: 0, bot: "informed", userSide: "sell", price: 8 - 1e-7, rejected: false, publicEV: 10.5, positionAfter: -1 }], "ask just beyond EV_EPS");
  checkFills(fillsFor(Q(8, 8 + 1e-7, 9)), [{ round: 0, bot: "informed", userSide: "buy", price: 8 + 1e-7, rejected: false, publicEV: 10.5, positionAfter: 1 }], "bid just beyond EV_EPS");
});

test("required: informed-bot logic at boundary prices (cards E[V] that is not exact in binary)", () => {
  // Cards 13, 2, 7: the informed E[V] in round 0 is 13 + 2 * 351/51 (our oracle's float).
  const E = bruteEV("cards", 3, [13]);
  const fresh = () => M.createGame("cards", 5, { values: [13, 2, 7], bots: "informed" });
  const fillsFor = (q) => {
    const r = M.submitQuote(fresh(), q);
    assert.equal(r.ok, true);
    return r.fills;
  };
  assert.deepEqual(fillsFor(Q(E, E - 1, E)), [], "ask equal to E (up to float noise)");
  assert.deepEqual(fillsFor(Q(E, E, E + 1)), [], "bid equal to E (up to float noise)");
  assert.equal(fillsFor(Q(E, E - 1, E - 1e-6))[0].userSide, "sell");
  assert.equal(fillsFor(Q(E, E + 1e-6, E + 1))[0].userSide, "buy");
});

test("informed bot in a mixed game: noise still trades when the informed bot passes", () => {
  // Seed 7 dice: round-0 noise sells at the bid; informed E[V] 8 equals the ask, so it passes.
  const r = M.submitQuote(M.createGame("dice", 7), Q(7.5, 7, 8));
  assert.equal(r.ok, true);
  checkFills(r.fills, [{ round: 0, bot: "noise", userSide: "buy", price: 7, rejected: false, publicEV: 10.5, positionAfter: 1 }], "mixed r0");
});

// ---------- 8. noise bot and the seeded RNG (§G1, §G3) ----------

test("noise bot: one seeded draw per round, u < 0.5 means the bot buys at the ask (seed 7 reference)", () => {
  // §G1: seed 7 dice noise draws give bot sells, bot buys, bot buys.
  const { results } = play(M.createGame("dice", 7, { bots: "noise" }), WORKED_QUOTES);
  assert.deepEqual(results.map((r) => r.fills.map((f) => [f.bot, f.userSide, f.price])),
    [[["noise", "buy", 9.5]], [["noise", "sell", 9]], [["noise", "sell", 11]]]);
});

test("noise bot draws continue the creation stream for many seeds and kinds", () => {
  for (let seed = 0; seed < 40; seed++) {
    for (const kind of ["dice", "cards", "coins"]) {
      const exp = refCreate(kind, seed);
      const draws = refDraws(seed, exp.used + exp.rounds).slice(exp.used);
      let s = M.createGame(kind, seed, { bots: "noise" });
      for (let i = 0; i < exp.rounds; i++) {
        const pe = refEV(kind, exp.n, s.revealed);
        const c = Math.round(pe * 2) / 2;
        const r = M.submitQuote(s, Q(c, c - 1, c + 1));
        assert.equal(r.ok, true);
        assert.equal(r.fills.length, 1);
        const wantSide = draws[i] < 0.5 ? "sell" : "buy";
        assert.equal(r.fills[0].userSide, wantSide, `${kind} seed ${seed} round ${i}`);
        assert.equal(r.fills[0].price, wantSide === "sell" ? c + 1 : c - 1);
        s = r.state;
      }
    }
  }
});

test("the rng advances one step per noise round and not at all for the informed bot", () => {
  const seed = 31;
  const exp = refCreate("dice", seed);
  const draws = refDraws(seed, exp.used + exp.rounds + 1);
  let s = M.createGame("dice", seed, { bots: "noise" });
  for (let i = 0; i < exp.rounds; i++) {
    const pe = refEV("dice", exp.n, s.revealed);
    s = M.submitQuote(s, Q(pe, pe - 1, pe + 1)).state;
    assert.equal(refNextFromState(s.rng), draws[exp.used + i + 1], `after noise round ${i}`);
  }
  let t = M.createGame("dice", seed, { bots: "informed" });
  const rng0 = t.rng;
  for (let i = 0; i < exp.rounds; i++) {
    const pe = refEV("dice", exp.n, t.revealed);
    t = M.submitQuote(t, Q(pe, pe - 1, pe + 1)).state;
    assert.equal(t.rng, rng0, `informed round ${i} consumed no draw`);
  }
});

// ---------- 9. round structure (§G2) ----------

test("round structure: revealed is the public prefix, one unit per round (dice, cards) or one batch (coins)", () => {
  // Coins: 7 flips in batches of 3 -> reveals of 3, 3, then a partial 1.
  const values = [1, 0, 1, 1, 0, 1, 1];
  let s = M.createGame("coins", 2, { values, batch: 3, bots: "informed" });
  assert.equal(s.rounds, 3);
  const wantReveal = [[1, 0, 1], [1, 0, 1], [1]];
  const wantPublic = [3.5, 4, 4.5];
  const wantInformed = [4, 4.5, 5];
  for (let i = 0; i < 3; i++) {
    assert.deepEqual(s.revealed, values.slice(0, i * 3), `revealed before round ${i}`);
    assert.equal(s.round, i);
    assert.equal(s.done, false);
    const r = M.submitQuote(s, Q(wantPublic[i], 0, 0.5)); // far below E: informed buys every round
    assert.deepEqual(r.reveal, wantReveal[i]);
    assert.equal(r.state.history[i].publicEV, wantPublic[i]);
    assert.equal(r.state.history[i].informedEV, wantInformed[i]);
    s = r.state;
  }
  assert.equal(s.done, true);
  assert.equal(s.round, 3);
  assert.deepEqual(s.revealed, values);
  // Dice and cards reveal outcomes[i] in round i.
  for (const kind of ["dice", "cards"]) {
    let g = M.createGame(kind, 42);
    const outcomes = g.outcomes.slice();
    assert.equal(g.rounds, g.n);
    for (let i = 0; i < g.rounds; i++) {
      assert.deepEqual(g.revealed, outcomes.slice(0, i));
      const pe = refEV(kind, g.n, g.revealed);
      const r = M.submitQuote(g, Q(pe, pe - 1, pe + 1));
      assert.deepEqual(r.reveal, [outcomes[i]]);
      g = r.state;
    }
    assert.equal(g.done, true);
    assert.deepEqual(g.revealed, outcomes);
  }
});

test("submitQuote result fills equal the round's history fills, and state stays plain JSON", () => {
  const { state, results } = play(M.createGame("cards", 7), [Q(21, 19, 23), Q(15, 14, 18), Q(28, 25, 31)]);
  results.forEach((r, i) => {
    assert.deepEqual(r.fills, state.history[i].fills, `round ${i}`);
    assert.equal(state.history[i].round, i);
  });
  assert.deepEqual(clone(state), state);
});

// ---------- 10. purity and determinism ----------

test("submitQuote, validateQuote, settle and helpers never mutate their inputs", () => {
  const opts = { values: [3, 4, 5], bots: "mixed" };
  const optsCopy = clone(opts);
  const s = M.createGame("dice", 7, opts);
  assert.deepEqual(opts, optsCopy, "createGame leaves opts alone");
  const sCopy = clone(s);
  const q = Q(10.5, 9.5, 11.5);
  const qCopy = clone(q);
  M.validateQuote(s, q);
  const r = M.submitQuote(s, q);
  assert.equal(r.ok, true);
  assert.deepEqual(s, sCopy, "submitQuote returns a new state");
  assert.deepEqual(q, qCopy);
  assert.notEqual(r.state, s);
  const again = M.submitQuote(s, q);
  assert.deepEqual(again, r, "the old state can be replayed with the same result");
  const revealed = [2, 3];
  M.conditionalEV(s, revealed);
  assert.deepEqual(revealed, [2, 3]);
  const { state } = play(s, [q, Q(10, 9, 11), Q(12, 11, 13)]);
  const doneCopy = clone(state);
  M.settle(state);
  M.runEntry(state, TS);
  M.goodQuoterLine(state);
  assert.deepEqual(state, doneCopy);
});

test("required: determinism by seed (same seed and quotes give identical games and metrics)", () => {
  for (const kind of ["dice", "cards", "coins"]) {
    for (const seed of [1, 7, 42, 99, 2 ** 31 + 5]) {
      const a = M.createGame(kind, seed);
      const b = M.createGame(kind, seed);
      assert.deepEqual(a, b, `${kind} seed ${seed} createGame`);
      const quotes = [];
      for (let i = 0; i < a.rounds; i++) quotes.push(Q(10 + i, 9 + i, 10.5 + i));
      const pa = play(a, quotes);
      const pb = play(b, quotes);
      assert.deepEqual(pa.state, pb.state, `${kind} seed ${seed} final state`);
      assert.deepEqual(pa.results.map((r) => r.fills), pb.results.map((r) => r.fills));
      assert.deepEqual(M.settle(pa.state), M.settle(pb.state));
    }
  }
  // Different seeds give different games.
  const seen = new Set();
  for (let seed = 1; seed <= 10; seed++) seen.add(JSON.stringify(M.createGame("dice", seed).outcomes));
  assert.ok(seen.size >= 5, "ten seeds give several different dice games");
});

test("random scripted games across seeds, kinds and bot mixes match an independent §G3/§G5 simulation", () => {
  const BOTS = ["mixed", "noise", "informed"];
  const LIMITS = [1, 2, 10];
  let games = 0;
  let rejectedSeen = 0;
  for (let seed = 1; seed <= 24; seed++) {
    for (const [ki, kind] of ["dice", "cards", "coins"].entries()) {
      const opts = { bots: BOTS[seed % 3], maxPos: LIMITS[(seed + ki) % 3] };
      const qr = refMulberry32(seed * 7919 + ki * 104729 + 12345);
      const quoteFor = (i, pe, maxWidth) => {
        const base = Math.round(pe * 4) / 4;
        const w = 0.25 * (1 + Math.floor(qr() * (maxWidth / 0.5)));
        const centre = base + 0.5 * (Math.floor(qr() * 9) - 4);
        const fair = base + 0.25 * (Math.floor(qr() * 5) - 2);
        return Q(fair, centre - w, centre + w);
      };
      const exp = refPlay(kind, seed, opts, quoteFor);
      let s = M.createGame(kind, seed, opts);
      assert.deepEqual(s.outcomes, exp.g.outcomes, `${kind} seed ${seed} outcomes`);
      for (let i = 0; i < exp.g.rounds; i++) {
        const tag = `${kind} seed ${seed} ${opts.bots} maxPos ${opts.maxPos} round ${i}`;
        const r = M.submitQuote(s, exp.quotes[i]);
        assert.equal(r.ok, true, `${tag}: ${r.error}`);
        assert.deepEqual(r.reveal, exp.rounds[i].reveal, `${tag} reveal`);
        checkFills(r.fills, exp.rounds[i].fills, tag);
        close(r.state.history[i].publicEV, exp.rounds[i].publicEV, `${tag} publicEV`);
        close(r.state.history[i].informedEV, exp.rounds[i].informedEV, `${tag} informedEV`);
        rejectedSeen += r.fills.filter((f) => f.rejected).length;
        s = r.state;
      }
      assert.equal(s.done, true);
      close(s.cash, exp.cash, `${kind} seed ${seed} cash`);
      assert.equal(s.position, exp.position);
      assert.equal(s.maxAbsPos, exp.maxAbs);
      checkMetrics(M.settle(s), exp.metrics, `${kind} seed ${seed}`);
      games++;
    }
  }
  assert.equal(games, 72);
  assert.ok(rejectedSeen > 0, "the sweep exercises position-limit rejections");
});

// ---------- 11. runEntry and goodQuoterLine (§G5) ----------

test("runEntry gives the mmRuns entry for a settled game, stamped with the ts passed in", () => {
  const { state } = play(M.createGame("dice", 7), WORKED_QUOTES);
  assert.deepEqual(M.runEntry(state, TS), {
    ts: TS, scenario: "dice", seed: 7, pnl: -3, edge: 5, trades: 6, maxPos: 2, fairErrors: [0, 0, 0.5],
  });
  const later = new Date(2026, 10, 5, 9, 30, 0).getTime();
  assert.equal(M.runEntry(state, later).ts, later);
});

test("goodQuoterLine names each round's public E[V] and the mean fair error", () => {
  const worked = play(M.createGame("dice", 7), WORKED_QUOTES).state;
  assert.equal(M.goodQuoterLine(worked),
    "Good quoter: centre each quote on E[V | revealed]: 10.5 → 8 → 10.5. Your mean fair error: 0.17.");
  const coins = play(M.createGame("coins", 123, { values: [1, 0, 1, 1, 0], batch: 2, maxPos: 1, bots: "informed" }),
    [Q(2.5, 1.5, 2.25), Q(3, 2.5, 3), Q(3.5, 3.125, 4)]).state;
  assert.equal(M.goodQuoterLine(coins),
    "Good quoter: centre each quote on E[V | revealed]: 2.5 → 2.5 → 3.5. Your mean fair error: 0.17.");
  // Cards: E[V] values are rounded to 2 decimals with trailing zeros dropped.
  const cards = play(M.createGame("cards", 5, { values: [13, 2, 7], bots: "informed" }),
    [Q(21, 20, 22), Q(26, 25, 27), Q(22, 21, 23)]).state;
  assert.equal(M.goodQuoterLine(cards),
    "Good quoter: centre each quote on E[V | revealed]: 21 → 26.76 → 21.98. Your mean fair error: 0.26.");
});
