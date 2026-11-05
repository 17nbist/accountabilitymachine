// v4 prep/market.js (PrepMarket): the market-making game engine (V4-CONTRACTS §G, spec §6).
// A seeded scenario hides a true value V (the sum of dice faces, card ranks or coin flips). Each
// round the user quotes a fair value and a two-sided market, a noise bot and an informed bot
// trade one unit each against it under a position limit, and one unit (or one coin batch) is
// revealed. Settlement marks the position at V and scores the quotes against E[V | revealed].
// Plain browser script and Node module (§A5): one `var` global, depends only on PrepRng, no DOM,
// no clock, no Math.random. Every function is pure: the RNG state lives in the game state, and a
// round returns a new state that shares nothing mutable with the old one.
//
// State (plain JSON, §G1):
//   { kind, seed, n, batch, rounds, maxWidth, maxPos, bots, outcomes, revealed, round, done,
//     cash, position, maxAbsPos, history: [{ round, fair, bid, ask, publicEV, informedEV, fills }],
//     rng }
// Fill = { round, bot, userSide, price, rejected, publicEV, positionAfter }; userSide is the
// user's side, so a bot buying at the ask is a user "sell".

var PrepMarket = (function () {
  const R = typeof PrepRng !== "undefined" ? PrepRng : require("./rng.js");

  const SCENARIOS = Object.freeze(["dice", "cards", "coins"]);
  const BOTS = Object.freeze(["noise", "informed", "mixed"]);
  const DEFAULT_MAX_POS = 10;
  const DEFAULT_MAX_WIDTH = Object.freeze({ dice: 4, cards: 8, coins: 3 });
  // Prices within EV_EPS of the informed bot's estimate count as equal (no trade), and a quote
  // width within EV_EPS above maxWidth counts as maxWidth (decimal inputs such as 0.7 / 3.7 give
  // a float difference a few ulps over 3).
  const EV_EPS = 1e-9;

  const DECK_SIZE = 52;
  const RANK_COPIES = 4;
  const DECK_SUM = 364; // 4 · (1 + 2 + … + 13)
  const UNIT_MEAN = { dice: 3.5, coins: 0.5 }; // cards: the mean of the cards still in the deck
  const UNIT_MAX = { dice: 6, cards: 13 };
  const UNIT_NAME = { dice: "die face", cards: "card rank", coins: "coin flip" };
  const QUOTE_FIELDS = [["fair", "fair value"], ["bid", "bid"], ["ask", "ask"]];

  // ---------- small helpers ----------

  const sum = (xs) => xs.reduce((a, b) => a + b, 0);
  const isFiniteNumber = (x) => typeof x === "number" && Number.isFinite(x);
  const isKind = (k) => SCENARIOS.includes(k);
  // Short, readable numbers for messages (no float tails such as 4.500000000000001).
  const show = (x) => String(Number(x.toPrecision(12)));

  function checkState(state, fn) {
    if (!state || typeof state !== "object" || !isKind(state.kind)) {
      throw new TypeError(`${fn}: state must be a game state from createGame`);
    }
  }

  // One unit is a die face 1-6, a card rank 1-13 or a coin flip 0 / 1 (1 = heads).
  function unitOk(kind, v) {
    if (kind === "coins") return v === 0 || v === 1;
    return Number.isInteger(v) && v >= 1 && v <= UNIT_MAX[kind];
  }

  // Throws unless every entry is a possible unit of `kind` and, for cards, no rank appears more
  // than 4 times (the units come from one 52-card deck).
  function checkUnits(kind, units, fn) {
    const counts = new Map();
    for (const v of units) {
      if (!unitOk(kind, v)) throw new RangeError(`${fn}: ${String(v)} is not a valid ${UNIT_NAME[kind]}`);
      if (kind !== "cards") continue;
      counts.set(v, (counts.get(v) || 0) + 1);
      if (counts.get(v) > RANK_COPIES) throw new RangeError(`${fn}: rank ${v} appears more than ${RANK_COPIES} times`);
    }
  }

  // An injected or drawn size: an integer of at least 1 (and at most `max`).
  function checkSize(x, what, max = Infinity) {
    if (!Number.isInteger(x) || x < 1 || x > max) {
      const range = max === Infinity ? "of at least 1" : `from 1 to ${max}`;
      throw new RangeError(`createGame: ${what} must be an integer ${range}, got ${String(x)}`);
    }
    return x;
  }

  // ---------- createGame (§G1) ----------

  // Draws, in order, from mulberry32(seed >>> 0); a parameter given in opts consumes no draw:
  //   dice:  n = randInt(3, 10), then n faces randInt(1, 6)
  //   cards: n = randInt(3, 8), then n cards dealt from the ascending 52-card deck by
  //          idx = randInt(0, deck.length - 1) without replacement
  //   coins: batch = randInt(2, 5), n = batch * randInt(3, 8), then n flips (rng() < 0.5 -> 1)
  // opts.values injects the hidden units (so n = values.length; coins still draw batch).
  function createGame(kind, seed, opts = {}) {
    if (!isKind(kind)) throw new Error(`createGame: unknown kind ${String(kind)} (use ${SCENARIOS.join(", ")})`);
    const o = opts == null ? {} : opts;
    if (typeof o !== "object") throw new TypeError("createGame: opts must be an object");
    const bots = o.bots ?? "mixed";
    if (!BOTS.includes(bots)) throw new Error(`createGame: unknown bots ${String(bots)} (use ${BOTS.join(", ")})`);
    const maxPos = o.maxPos ?? DEFAULT_MAX_POS;
    if (!isFiniteNumber(maxPos) || maxPos < 1) throw new RangeError(`createGame: maxPos must be a number of at least 1, got ${String(maxPos)}`);
    const maxWidth = o.maxWidth ?? DEFAULT_MAX_WIDTH[kind];
    if (!isFiniteNumber(maxWidth) || maxWidth <= 0) throw new RangeError(`createGame: maxWidth must be a number above 0, got ${String(maxWidth)}`);

    let values = null;
    if (o.values != null) {
      if (!Array.isArray(o.values) || o.values.length === 0) throw new RangeError("createGame: values must be a non-empty array");
      values = Array.from(o.values);
      checkUnits(kind, values, "createGame");
      values = values.map((v) => v + 0); // -0 is stored as 0, so the state survives JSON
      if (o.n != null && o.n !== values.length) {
        throw new RangeError(`createGame: n (${String(o.n)}) and values.length (${values.length}) disagree`);
      }
    }

    const seed32 = seed >>> 0;
    let rngState = seed32;
    const rng = () => {
      const r = R.rngNext(rngState);
      rngState = r.state;
      return r.value;
    };

    let batch = null;
    if (kind === "coins") batch = checkSize(o.batch ?? R.randInt(rng, 2, 5), "batch");
    let n;
    if (values) n = values.length;
    else if (o.n != null) n = o.n;
    else if (kind === "dice") n = R.randInt(rng, 3, 10);
    else if (kind === "cards") n = R.randInt(rng, 3, 8);
    else n = batch * R.randInt(rng, 3, 8);
    checkSize(n, "n", kind === "cards" ? DECK_SIZE : Infinity);

    let outcomes = values;
    if (!outcomes && kind === "dice") {
      outcomes = Array.from({ length: n }, () => R.randInt(rng, 1, 6));
    } else if (!outcomes && kind === "cards") {
      const deck = [];
      for (let rank = 1; rank <= UNIT_MAX.cards; rank++) for (let c = 0; c < RANK_COPIES; c++) deck.push(rank);
      outcomes = [];
      for (let j = 0; j < n; j++) {
        const idx = R.randInt(rng, 0, deck.length - 1);
        outcomes.push(deck[idx]);
        deck.splice(idx, 1);
      }
    } else if (!outcomes) {
      outcomes = Array.from({ length: n }, () => (rng() < 0.5 ? 1 : 0));
    }

    return {
      kind,
      seed: seed32,
      n,
      batch,
      rounds: kind === "coins" ? Math.ceil(n / batch) : n,
      maxWidth,
      maxPos,
      bots,
      outcomes,
      revealed: [],
      round: 0,
      done: false,
      cash: 0,
      position: 0,
      maxAbsPos: 0,
      history: [],
      rng: rngState,
    };
  }

  // ---------- conditionalEV (§G4) ----------

  // E[V | the first m units are `revealed`], exact by linearity: the revealed sum plus the
  // unrevealed count times the mean of one unrevealed unit. For cards that mean is the average
  // of the 52 − m cards left in the deck (draws without replacement). Coins take individual
  // flips here, not batches. A state works as the scenario: only `kind` and `n` are read.
  function conditionalEV(scenario, revealed) {
    if (!scenario || typeof scenario !== "object") throw new TypeError("conditionalEV: scenario must be an object with kind and n");
    const { kind, n } = scenario;
    if (!isKind(kind)) throw new Error(`conditionalEV: unknown kind ${String(kind)}`);
    if (!Number.isInteger(n) || n < 0 || (kind === "cards" && n > DECK_SIZE)) {
      throw new RangeError(`conditionalEV: n must be an integer from 0${kind === "cards" ? " to 52" : ""}, got ${String(n)}`);
    }
    const units = revealed == null ? [] : revealed;
    if (!Array.isArray(units)) throw new TypeError("conditionalEV: revealed must be an array");
    const m = units.length;
    if (m > n) throw new RangeError(`conditionalEV: ${m} units revealed but the scenario has only ${n}`);
    checkUnits(kind, units, "conditionalEV");
    const S = sum(units);
    if (m === n) return S; // nothing left (also avoids 0 / 0 for a full deck)
    const mean = kind === "cards" ? (DECK_SUM - S) / (DECK_SIZE - m) : UNIT_MEAN[kind];
    return S + (n - m) * mean;
  }

  // ---------- quotes (§G3) ----------

  // A finite number, or a string whose trimmed form is non-empty and is a finite Number().
  // Returns the number (-0 as 0), or null when the value is not usable.
  function quoteValue(x) {
    let v = null;
    if (typeof x === "number") v = x;
    else if (typeof x === "string" && x.trim() !== "") v = Number(x);
    return v !== null && Number.isFinite(v) ? v + 0 : null;
  }

  // The checks run in the §G3 order and the first failure is reported: every field is a number
  // (keyword "number"), then bid < ask (keyword "bid"), then ask − bid <= maxWidth ("width").
  // No message contains another check's keyword ("over", "number", "bid", "width"), except that
  // a number error names its field (so a bad bid also says "bid").
  function parseQuote(state, quote) {
    const q = quote == null ? {} : quote;
    const out = {};
    for (const [field, label] of QUOTE_FIELDS) {
      const v = quoteValue(q[field]);
      if (v === null) return { ok: false, error: `The ${label} must be a number.` };
      out[field] = v;
    }
    if (!(out.bid < out.ask)) return { ok: false, error: "The bid must be below the ask." };
    const width = out.ask - out.bid;
    if (width > state.maxWidth + EV_EPS) {
      return { ok: false, error: `The quote width ${show(width)} is above the maximum of ${show(state.maxWidth)}.` };
    }
    return { ok: true, quote: out };
  }

  function validateQuote(state, quote) {
    checkState(state, "validateQuote");
    const r = parseQuote(state, quote);
    return r.ok ? { ok: true } : r;
  }

  // The units revealed at the end of round i: outcomes[i] for dice and cards, the i-th batch of
  // flips for coins (the last batch may be partial).
  function roundReveal(state, i) {
    const size = state.kind === "coins" ? state.batch : 1;
    return state.outcomes.slice(i * size, (i + 1) * size);
  }

  const copyFill = (f) => ({ ...f });
  const copyRecord = (h) => ({ ...h, fills: h.fills.map(copyFill) });

  // One round: validate, let the bots trade (noise, then informed), apply the position limit per
  // fill, then reveal. On error the input state is untouched and no draw is consumed.
  function submitQuote(state, quote) {
    checkState(state, "submitQuote");
    if (state.done) return { ok: false, error: "The game is over: no more quotes." };
    const parsed = parseQuote(state, quote);
    if (!parsed.ok) return parsed;
    const { fair, bid, ask } = parsed.quote;

    const i = state.round;
    const reveal = roundReveal(state, i);
    const publicEV = conditionalEV(state, state.revealed);
    const informedEV = conditionalEV(state, state.revealed.concat(reveal));

    let { cash, position, maxAbsPos, rng } = state;
    const fills = [];
    // A fill that would take |position| past maxPos is recorded as rejected and changes nothing.
    const trade = (bot, userSide) => {
      const price = userSide === "sell" ? ask : bid;
      const next = position + (userSide === "buy" ? 1 : -1);
      const rejected = Math.abs(next) > state.maxPos;
      if (!rejected) {
        position = next;
        cash += userSide === "sell" ? price : -price;
        maxAbsPos = Math.max(maxAbsPos, Math.abs(position));
      }
      fills.push({ round: i, bot, userSide, price, rejected, publicEV, positionAfter: position });
    };

    if (state.bots === "noise" || state.bots === "mixed") {
      // One draw: u < 0.5 means the bot buys at the ask (the user sells), else it sells at the bid.
      const draw = R.rngNext(rng);
      rng = draw.state;
      trade("noise", draw.value < 0.5 ? "sell" : "buy");
    }
    if (state.bots === "informed" || state.bots === "mixed") {
      // It knows this round's reveal. Within EV_EPS of a price means equal: no trade, no Fill.
      if (informedEV > ask + EV_EPS) trade("informed", "sell");
      else if (informedEV < bid - EV_EPS) trade("informed", "buy");
    }

    const round = i + 1;
    const record = { round: i, fair, bid, ask, publicEV, informedEV, fills };
    const next = {
      ...state,
      outcomes: state.outcomes.slice(),
      revealed: state.revealed.concat(reveal),
      round,
      done: round === state.rounds,
      cash,
      position,
      maxAbsPos,
      history: state.history.map(copyRecord).concat([record]),
      rng,
    };
    return { ok: true, state: next, fills: fills.map(copyFill), reveal };
  }

  // ---------- settlement (§G5) ----------

  // Metrics over the accepted fills. s = +1 when the user sells and −1 when the user buys, so a
  // positive edge (sold above, or bought below, the public E[V] at the time) is good for the
  // user. adverse is the P&L lost to informed fills, measured against the realised V.
  function settle(state) {
    checkState(state, "settle");
    if (!state.done) throw new Error("settle: the game has rounds left to play");
    const V = sum(state.outcomes);
    let edge = 0;
    let adverse = 0;
    let trades = 0;
    for (const h of state.history) {
      for (const f of h.fills) {
        if (f.rejected) continue;
        const s = f.userSide === "sell" ? 1 : -1;
        trades++;
        edge += (f.price - f.publicEV) * s;
        if (f.bot === "informed") adverse -= (f.price - V) * s;
      }
    }
    const fairErrors = state.history.map((h) => Math.abs(h.fair - h.publicEV));
    const meanFairError = fairErrors.length ? sum(fairErrors) / fairErrors.length : 0;
    return {
      V,
      pnl: state.cash + state.position * V,
      cash: state.cash,
      position: state.position,
      edge,
      adverse,
      trades,
      maxPos: state.maxAbsPos,
      fairErrors,
      meanFairError,
    };
  }

  // The mmRuns entry for a finished game (spec §2 shape, exactly these eight keys).
  function runEntry(state, ts) {
    const m = settle(state);
    if (!isFiniteNumber(ts)) throw new TypeError(`runEntry: ts must be a finite time in ms, got ${String(ts)}`);
    return {
      ts,
      scenario: state.kind,
      seed: state.seed,
      pnl: m.pnl,
      edge: m.edge,
      trades: m.trades,
      maxPos: m.maxPos,
      fairErrors: m.fairErrors,
    };
  }

  // The post-game "what a good quoter would have done" line (spec §6 UI).
  function goodQuoterLine(state) {
    const { meanFairError } = settle(state);
    const evs = state.history.map((h) => String(Number(h.publicEV.toFixed(2))));
    return `Good quoter: centre each quote on E[V | revealed]: ${evs.join(" → ")}. Your mean fair error: ${meanFairError.toFixed(2)}.`;
  }

  return {
    SCENARIOS,
    DEFAULT_MAX_POS,
    DEFAULT_MAX_WIDTH,
    EV_EPS,
    createGame,
    conditionalEV,
    validateQuote,
    submitQuote,
    settle,
    runEntry,
    goodQuoterLine,
  };
})();
if (typeof module !== "undefined") module.exports = PrepMarket;
