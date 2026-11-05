// v4 prep/oa.js (PrepOA): the seeded OA simulators (V4-CONTRACTS §F, spec §5). Four kinds: the
// Zetamac clone (arith), the Optiver-style 80-in-8 (eighty), number sequences (seq) and the
// expected-value quickfire (ev), plus their config helpers, scoring, personal best, trend and the
// in-app zetamac practice entry. Plain browser script and Node module (§A5): one `var` global, no
// DOM, no clock, no Math.random. Each run draws from its own mulberry32 stream, so a kind, a seed
// and a config fix the whole run.

var PrepOA = (function () {
  const R = typeof PrepRng !== "undefined" ? PrepRng : require("./rng.js");

  const KINDS = Object.freeze(["arith", "eighty", "seq", "ev"]);
  const TIME_LIMITS = Object.freeze({ eighty: 480, seq: 600, ev: 300 });
  const QUESTION_COUNTS = Object.freeze({ eighty: 80, seq: 15, ev: 20 });
  const EIGHTY_CATEGORIES = Object.freeze(
    ["add-dec", "sub-dec", "mul-2x2", "mul-3x2", "mul-dec", "div", "pct", "frac"]);
  const SEQ_FAMILIES = Object.freeze(["arithmetic", "geometric", "second-diff", "fib-like",
    "interleaved", "powers", "primes", "alt-ops"]);
  const SEQ_SHOWN = 7;
  const EV_TEMPLATES = Object.freeze(["dice-max", "dice-min", "dice-absdiff", "dice-reroll",
    "dice-threshold", "dice-distinct", "coins-maxrun", "coins-absdiff", "cards-max",
    "cards-first-high"]);

  // The first 120 primes, P_0 = 2 (§F4), by trial division against the primes found so far.
  const PRIMES = Object.freeze((function () {
    const ps = [];
    for (let n = 2; ps.length < 120; n++) {
      let prime = true;
      for (const p of ps) {
        if (p * p > n) break;
        if (n % p === 0) { prime = false; break; }
      }
      if (prime) ps.push(n);
    }
    return ps;
  })());

  // ---------- small helpers ----------

  const show = (v) => (typeof v === "string" ? JSON.stringify(v) : typeof v);
  const isObject = (x) => x !== null && typeof x === "object";
  const zero = (x) => (x === 0 ? 0 : x); // -0 -> 0
  const exactTol = () => ({ rel: 0, abs: 0 });

  // Every kind-taking export: an unknown kind is a programmer error (§A4).
  function assertKind(kind, fn) {
    if (!KINDS.includes(kind)) throw new Error(`${fn}: unknown OA kind ${show(kind)}`);
  }

  // §A3: null and undefined read as []; any other non-array is a programmer error.
  function asList(xs, fn) {
    if (xs == null) return [];
    if (!Array.isArray(xs)) throw new TypeError(`${fn}: expected an array`);
    return xs;
  }

  // ---------- config (§F2, §F6) ----------

  const ARITH_OPS = Object.freeze(["add", "sub", "mul", "div"]);
  const ARITH_RANGES = Object.freeze(["addA", "addB", "mulA", "mulB"]);
  const RANGE_LABELS = {
    addA: "The first addition range", addB: "The second addition range",
    mulA: "The first multiplication range", mulB: "The second multiplication range",
  };
  const RANGE_MAX = 10000;
  const DURATION_MIN = 10;
  const DURATION_MAX = 600;
  const ARITH_PER_SEC = 4; // arith pre-generates 4 questions per second of play (§F1)

  // Zetamac's defaults (spec §5). A fresh object on every call, so callers may keep it.
  function arithDefault() {
    return { ops: ARITH_OPS.slice(), addA: [2, 100], addB: [2, 100], mulA: [2, 12],
      mulB: [2, 100], durationSecs: 120 };
  }

  function defaultConfig(kind) {
    assertKind(kind, "defaultConfig");
    if (kind === "arith") return arithDefault();
    if (kind === "eighty") return { negativeMarking: false };
    return {};
  }

  // UI inputs arrive as strings; anything else is kept for configError to judge.
  const numeric = (v) => (typeof v === "string" ? Number(v) : v);

  // §F2: a key is missing only when it is undefined; present-but-invalid values are kept. Keys
  // always come out in the order of the default, and unknown keys are dropped.
  function normalizeArith(raw) {
    const c = isObject(raw) ? raw : {};
    const d = arithDefault();
    const out = {};
    if (c.ops === undefined) out.ops = d.ops;
    else out.ops = Array.isArray(c.ops) ? ARITH_OPS.filter((op) => c.ops.includes(op)) : [];
    for (const key of ARITH_RANGES) {
      const r = c[key];
      out[key] = r === undefined ? d[key] : Array.isArray(r) ? Array.from(r, numeric) : r;
    }
    out.durationSecs = c.durationSecs === undefined ? d.durationSecs : numeric(c.durationSecs);
    return out;
  }

  function normalizeConfig(kind, c) {
    assertKind(kind, "normalizeConfig");
    if (kind === "arith") return normalizeArith(c);
    if (kind === "eighty") return { negativeMarking: isObject(c) && c.negativeMarking === true };
    return {};
  }

  const isRange = (r) => Array.isArray(r) && r.length === 2
    && Number.isInteger(r[0]) && Number.isInteger(r[1])
    && r[0] >= 0 && r[0] <= r[1] && r[1] <= RANGE_MAX;

  // The first problem found, in the order ops, ranges (key order), division, duration.
  function arithError(c) {
    if (c.ops.length === 0) return "Choose at least one operation.";
    for (const key of ARITH_RANGES) {
      if (!isRange(c[key])) {
        return `${RANGE_LABELS[key]} must be two whole numbers from 0 to ${RANGE_MAX}, low first.`;
      }
    }
    if (c.ops.includes("div") && c.mulA[0] < 1) {
      return "Division needs the first multiplication range to start at 1 (it gives the divisor).";
    }
    const secs = c.durationSecs;
    if (!Number.isInteger(secs) || secs < DURATION_MIN || secs > DURATION_MAX) {
      return `The duration must be whole seconds from ${DURATION_MIN} to ${DURATION_MAX}.`;
    }
    return null;
  }

  function configError(kind, c) {
    assertKind(kind, "configError");
    return kind === "arith" ? arithError(normalizeArith(c)) : null;
  }

  const configKey = (kind, c) => JSON.stringify(normalizeConfig(kind, c));

  function sameConfig(kind, a, b) {
    return configKey(kind, a) === configKey(kind, b);
  }

  function isDefaultConfig(kind, c) {
    return sameConfig(kind, c, defaultConfig(kind));
  }

  // m:ss with the seconds rounded up and clamped at zero (§F6).
  function formatClock(secs) {
    const up = Math.ceil(secs);
    const s = Number.isFinite(up) && up > 0 ? up : 0;
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }

  // ---------- arith (§F2) ----------

  // sub and div are the inverses of add and mul (spec §5), so every answer is a whole number and
  // every division is exact. make(x, y) gives [left, right, answer].
  const ARITH = {
    add: { symbol: "+", make: (x, y) => [x, y, x + y] },
    sub: { symbol: "–", make: (x, y) => [x + y, x, y] },
    mul: { symbol: "×", make: (x, y) => [x, y, x * y] },
    div: { symbol: "÷", make: (x, y) => [x * y, x, y] },
  };

  // The exact draw order of §F2: op, then x, then y, for every question.
  function arithQuestions(rng, cfg) {
    const out = [];
    for (let n = 0; n < ARITH_PER_SEC * cfg.durationSecs; n++) {
      const op = R.pick(rng, cfg.ops);
      const additive = op === "add" || op === "sub";
      const ra = additive ? cfg.addA : cfg.mulA;
      const rb = additive ? cfg.addB : cfg.mulB;
      const x = R.randInt(rng, ra[0], ra[1]);
      const y = R.randInt(rng, rb[0], rb[1]);
      const [left, right, answer] = ARITH[op].make(x, y);
      out.push({ op, left, right, prompt: `${left} ${ARITH[op].symbol} ${right}`,
        answer: { value: String(answer), tol: exactTol() } });
    }
    return out;
  }

  // ---------- eighty (§F3) ----------

  const PCT_VALUES = Object.freeze([5, 10, 12.5, 15, 20, 25, 30, 40, 50, 60, 75, 80]);
  const FRAC_DENOMINATORS = Object.freeze([2, 4, 5, 8, 10, 16, 20, 25, 40]);
  const EIGHTY_PER_CATEGORY = QUESTION_COUNTS.eighty / EIGHTY_CATEGORIES.length; // 10

  // dec(N, k): the integer N divided by 10^k as an exact decimal string, trailing zeros dropped
  // (dec(1250, 2) = "12.5"). Integer division and remainder only, so no float rounding.
  function dec(N, k) {
    const scale = 10 ** k;
    const abs = Math.abs(N);
    const frac = k === 0 ? "" : String(abs % scale).padStart(k, "0").replace(/0+$/, "");
    return (N < 0 ? "-" : "") + Math.floor(abs / scale) + (frac ? "." + frac : "");
  }

  // k/d as an exact decimal, for a d whose prime factors are only 2 and 5: k/d = k·(10^m/d)/10^m
  // for the smallest m with d | 10^m.
  function fractionDecimal(k, d) {
    for (let m = 0; m <= 15; m++) {
      if (10 ** m % d === 0) return dec(k * (10 ** m / d), m);
    }
    throw new RangeError(`fractionDecimal: ${k}/${d} has no short terminating decimal`);
  }

  // One draw per category: params (exactly the §F3 row's parameters), prompt and exact answer.
  const EIGHTY = {
    "add-dec": (rng) => {
      const A = R.randInt(rng, 100, 9999);
      const B = R.randInt(rng, 100, 9999);
      return { params: { A, B }, prompt: `${dec(A, 2)} + ${dec(B, 2)}`, value: dec(A + B, 2) };
    },
    "sub-dec": (rng) => {
      const A = R.randInt(rng, 100, 9999);
      const B = R.randInt(rng, 100, 9999);
      return { params: { A, B }, prompt: `${dec(A, 2)} – ${dec(B, 2)}`, value: dec(A - B, 2) };
    },
    "mul-2x2": (rng) => {
      const a = R.randInt(rng, 11, 99);
      const b = R.randInt(rng, 11, 99);
      return { params: { a, b }, prompt: `${a} × ${b}`, value: String(a * b) };
    },
    "mul-3x2": (rng) => {
      const a = R.randInt(rng, 100, 999);
      const b = R.randInt(rng, 11, 99);
      return { params: { a, b }, prompt: `${a} × ${b}`, value: String(a * b) };
    },
    "mul-dec": (rng) => {
      const A = R.randInt(rng, 11, 99);
      const b = R.randInt(rng, 2, 19);
      return { params: { A, b }, prompt: `${dec(A, 1)} × ${b}`, value: dec(A * b, 1) };
    },
    div: (rng) => {
      const b = R.randInt(rng, 2, 19);
      const q = R.randInt(rng, 2, 99);
      return { params: { b, q }, prompt: `${b * q} ÷ ${b}`, value: String(q) };
    },
    pct: (rng) => {
      const p = R.pick(rng, PCT_VALUES);
      const n = R.randInt(rng, 10, 999);
      // p is a whole number of tenths (12.5 = 125/10), so p·n/100 = tenths·n/1000 exactly
      return { params: { p, n }, prompt: `${p}% of ${n}`, value: dec(Math.round(p * 10) * n, 3) };
    },
    frac: (rng) => {
      const d = R.pick(rng, FRAC_DENOMINATORS);
      const k = R.randInt(rng, 1, d - 1);
      return { params: { k, d }, prompt: `${k}/${d} as a decimal`, value: fractionDecimal(k, d) };
    },
  };

  // 10 questions per category, then one shuffle of the whole list (not of category blocks).
  function eightyQuestions(rng) {
    const list = [];
    for (const category of EIGHTY_CATEGORIES) {
      for (let n = 0; n < EIGHTY_PER_CATEGORY; n++) {
        const { params, prompt, value } = EIGHTY[category](rng);
        list.push({ category, params, prompt, answer: { value, tol: { rel: 0, abs: 1e-9 } } });
      }
    }
    return R.shuffle(rng, list);
  }

  // ---------- seq (§F4) ----------

  const SEQ_LIMIT = 100000; // every term and answer is at most this in absolute value
  const SEQ_MAX_REJECTIONS = 100;
  const PRIMES_MAX_S = 100; // the primes fit searches s in [0, 100]

  // Uniform on [-m, m] without 0, in one draw.
  function nonZero(rng, m) {
    const v = R.randInt(rng, -m, m - 1);
    return v >= 0 ? v + 1 : v;
  }

  const diffs = (t) => t.slice(1).map((v, k) => v - t[k]);
  const terms = (n, f) => Array.from({ length: n }, (_, k) => f(k));

  // Recurrence t_{k+1} = step(t_k, k) from t_0 = start, n terms.
  function unroll(start, n, step) {
    const t = [start];
    while (t.length < n) t.push(step(t[t.length - 1], t.length - 1));
    return t;
  }

  // Per family: draw(rng) gives the parameters, named as fit returns them; seqTerms(p, n) gives
  // the first n terms from the definition; fit(t) is the §F4 fit rule (params or null) for 7
  // integers; next(t, p) is the predicted t_7 given the fit p.
  const SEQ = {
    arithmetic: {
      draw: (rng) => ({ a: R.randInt(rng, -20, 50), d: nonZero(rng, 15) }),
      seqTerms: (p, n) => terms(n, (k) => p.a + k * p.d),
      fit: (t) => {
        const D = diffs(t);
        const d = D[0];
        return d !== 0 && D.every((x) => x === d) ? { a: t[0], d } : null;
      },
      next: (t, p) => t[6] + p.d,
    },
    geometric: {
      draw: (rng) => ({ a: R.randInt(rng, 1, 10), r: R.pick(rng, [-3, -2, 2, 3]) }),
      seqTerms: (p, n) => terms(n, (k) => p.a * p.r ** k),
      fit: (t) => {
        if (t[0] === 0 || t[1] % t[0] !== 0) return null;
        const r = t[1] / t[0];
        if (Math.abs(r) < 2) return null;
        for (let k = 0; k < 6; k++) if (t[k + 1] !== r * t[k]) return null;
        return { a: t[0], r };
      },
      next: (t, p) => p.r * t[6],
    },
    "second-diff": {
      draw: (rng) => ({ a: R.randInt(rng, -10, 30), b: R.randInt(rng, -10, 10),
        c: nonZero(rng, 5) }),
      seqTerms: (p, n) => terms(n, (k) => p.a + p.b * k + (p.c * k * (k - 1)) / 2),
      fit: (t) => {
        const D = diffs(t);
        const c = D[1] - D[0];
        if (c === 0) return null;
        for (let k = 0; k < 5; k++) if (D[k + 1] - D[k] !== c) return null;
        return { a: t[0], b: D[0], c };
      },
      next: (t, p) => t[6] + (t[6] - t[5]) + p.c,
    },
    "fib-like": {
      draw: (rng) => ({ a: R.randInt(rng, 1, 12), b: R.randInt(rng, 1, 12) }),
      seqTerms: (p, n) => {
        const t = [p.a, p.b];
        while (t.length < n) t.push(t[t.length - 1] + t[t.length - 2]);
        return t.slice(0, n);
      },
      fit: (t) => {
        for (let k = 2; k < 7; k++) if (t[k] !== t[k - 1] + t[k - 2]) return null;
        return { a: t[0], b: t[1] };
      },
      next: (t) => t[6] + t[5],
    },
    interleaved: {
      draw: (rng) => ({ a1: R.randInt(rng, 1, 30), d1: nonZero(rng, 9),
        a2: R.randInt(rng, 1, 30), d2: nonZero(rng, 9) }),
      seqTerms: (p, n) => terms(n, (k) => (k % 2 === 0
        ? p.a1 + (k / 2) * p.d1 : p.a2 + ((k - 1) / 2) * p.d2)),
      fit: (t) => {
        const d1 = t[2] - t[0];
        const d2 = t[3] - t[1];
        if (d1 === 0 || d2 === 0) return null;
        if (t[4] - t[2] !== d1 || t[6] - t[4] !== d1 || t[5] - t[3] !== d2) return null;
        return { a1: t[0], d1, a2: t[1], d2 };
      },
      next: (t, p) => t[5] + p.d2,
    },
    powers: {
      draw: (rng) => {
        const p = R.pick(rng, [2, 3]);
        const s = R.randInt(rng, 1, p === 2 ? 6 : 4);
        return { p, s, c: R.randInt(rng, -10, 10) };
      },
      seqTerms: (q, n) => terms(n, (k) => (k + q.s) ** q.p + q.c),
      // (s+1)^2 - s^2 = 2s + 1, and the second difference of (k+s)^3 at k = 0 is 6s + 6.
      fit: (t) => {
        for (const [p, num, den] of [[2, t[1] - t[0] - 1, 2], [3, t[2] - 2 * t[1] + t[0] - 6, 6]]) {
          if (num % den !== 0) continue;
          const s = num / den;
          const c = t[0] - s ** p;
          if (t.every((v, k) => v === (k + s) ** p + c)) return { p, s, c };
        }
        return null;
      },
      next: (t, q) => (SEQ_SHOWN + q.s) ** q.p + q.c,
    },
    primes: {
      // s = 2 is left out: 5, 7, 11, 13, 17, 19, 23 (+ c) also fits interleaved (§F4).
      draw: (rng) => ({ s: R.pick(rng, [0, 1, 3, 4, 5]), c: R.randInt(rng, -10, 10) }),
      seqTerms: (p, n) => terms(n, (k) => PRIMES[k + p.s] + p.c),
      fit: (t) => {
        for (let s = 0; s <= PRIMES_MAX_S; s++) {
          const c = t[0] - PRIMES[s];
          let same = true;
          for (let k = 1; k < 7 && same; k++) same = t[k] - PRIMES[k + s] === c;
          if (same) return { s, c };
        }
        return null;
      },
      next: (t, p) => PRIMES[SEQ_SHOWN + p.s] + p.c,
    },
    "alt-ops": {
      draw: (rng) => ({ x0: R.randInt(rng, 1, 10), a: R.randInt(rng, 1, 9),
        b: R.pick(rng, [2, 3]) }),
      seqTerms: (p, n) => unroll(p.x0, n, (v, k) => (k % 2 === 0 ? v + p.a : v * p.b)),
      fit: (t) => {
        const a = t[1] - t[0];
        if (a === 0 || t[1] === 0 || t[2] % t[1] !== 0) return null;
        const b = t[2] / t[1];
        if (Math.abs(b) < 2) return null;
        for (let k = 0; k < 6; k++) {
          if (t[k + 1] !== (k % 2 === 0 ? t[k] + a : t[k] * b)) return null;
        }
        return { x0: t[0], a, b };
      },
      next: (t, p) => t[6] + p.a,
    },
  };

  function familyOf(id, fn) {
    if (!SEQ_FAMILIES.includes(id)) throw new Error(`${fn}: unknown sequence family ${show(id)}`);
    return SEQ[id];
  }

  const isShown = (t) => Array.isArray(t) && t.length === SEQ_SHOWN
    && t.every((v) => Number.isInteger(v));

  // The fit's parameters, or null. Specified for arrays of exactly 7 integers (anything else is
  // null); an unknown family id throws.
  function seqFit(id, t) {
    const fam = familyOf(id, "seqFit");
    if (!isShown(t)) return null;
    const p = fam.fit(t);
    if (p === null) return null;
    const out = {};
    for (const key of Object.keys(p)) out[key] = zero(p[key]);
    return out;
  }

  // The family's next term, null exactly when seqFit is null.
  function seqNext(id, t) {
    const p = seqFit(id, t);
    return p === null ? null : zero(SEQ[id].next(t, p));
  }

  const sameParams = (a, b) => a !== null && Object.keys(a).length === Object.keys(b).length
    && Object.keys(a).every((key) => a[key] === b[key]);

  // A draw is kept only if: every term is an integer within SEQ_LIMIT; the family's own fit
  // gives back the drawn parameters (so q.params lie in the generation ranges); no family fits
  // the shown terms and predicts another answer (the uniqueness rule, spec §5); and the shown
  // terms do not repeat an earlier question of the run.
  function seqQuestion(rng, family, earlier) {
    const fam = SEQ[family];
    for (let rejections = 0; rejections < SEQ_MAX_REJECTIONS; rejections++) {
      const drawn = fam.draw(rng);
      const t = fam.seqTerms(drawn, SEQ_SHOWN + 1).map(zero);
      if (!t.every((v) => Number.isInteger(v) && Math.abs(v) <= SEQ_LIMIT)) continue;
      const shown = t.slice(0, SEQ_SHOWN);
      const answer = t[SEQ_SHOWN];
      const params = seqFit(family, shown);
      if (!sameParams(params, drawn)) continue;
      const unique = SEQ_FAMILIES.every((f) => {
        const next = seqNext(f, shown);
        return next === null || next === answer;
      });
      if (!unique) continue;
      const prompt = `${shown.join(", ")}, ?`;
      if (earlier.some((q) => q.prompt === prompt)) continue;
      return { family, params, shown, prompt, answer: { value: String(answer), tol: exactTol() } };
    }
    throw new Error(`seq: no acceptable ${family} sequence after ${SEQ_MAX_REJECTIONS} rejections`);
  }

  // Every family once, plus a second question for (15 - 8) distinct families, in shuffled order.
  function seqQuestions(rng) {
    const extra = QUESTION_COUNTS.seq - SEQ_FAMILIES.length;
    const repeats = R.shuffle(rng, SEQ_FAMILIES).slice(0, extra);
    const order = R.shuffle(rng, SEQ_FAMILIES.concat(repeats));
    const out = [];
    for (const family of order) out.push(seqQuestion(rng, family, out));
    return out;
  }

  // ---------- ev (§F5) ----------
  // Every answer is computed here by enumerating the outcomes or by dynamic programming, from the
  // template's definition (spec §5): no stored answers and no closed forms.

  const EV_PER_TEMPLATE = QUESTION_COUNTS.ev / EV_TEMPLATES.length; // 2
  // A standard deck as its ranks: 4 of each rank 1..13 (A = 1 ... K = 13).
  const DECK = Object.freeze(Array.from({ length: 52 }, (_, i) => Math.floor(i / 4) + 1));
  const faces = (f) => Array.from({ length: f }, (_, i) => i + 1);
  const HEADS = 1;
  const TAILS = 0;

  // Every combination of the axes' values, keys in axis order.
  function grid(axes) {
    return Object.entries(axes).reduce(
      (acc, [key, values]) => acc.flatMap((p) => values.map((v) => ({ ...p, [key]: v }))), [{}]);
  }
  const span = (lo, hi) => Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);

  // The mean of fn over all values.length^k equally likely ordered outcomes (dice rolls, coin
  // flips), by enumeration. One division at the end, so integer payoffs give a correctly rounded
  // mean.
  function meanOverOutcomes(values, k, fn) {
    let sum = 0;
    let count = 0;
    const seq = [];
    (function extend() {
      if (seq.length === k) { sum += fn(seq); count++; return; }
      for (const v of values) { seq.push(v); extend(); seq.pop(); }
    })();
    return sum / count;
  }

  // The mean of fn over every k-card hand from the deck (all equally likely), by enumeration.
  function meanOverHands(k, fn) {
    let sum = 0;
    let count = 0;
    const hand = [];
    (function choose(from) {
      if (hand.length === k) { sum += fn(hand); count++; return; }
      for (let i = from; i < DECK.length; i++) { hand.push(DECK[i]); choose(i + 1); hand.pop(); }
    })(0);
    return sum / count;
  }

  // Optimal stopping by DP: v_0 is the mean face (no rerolls left, the roll is kept), and with
  // j rerolls left you keep x when x beats v_{j-1}: v_j = mean of max(x, v_{j-1}). Kept exact as
  // num / den with den = f^(j+1) (integers far below 2^53), so the one division at the end gives
  // the correctly rounded value.
  function rerollValue(f, r) {
    const xs = faces(f);
    let num = xs.reduce((s, x) => s + x, 0);
    let den = f;
    for (let j = 1; j <= r; j++) {
      const keepWorth = num; // v_{j-1} · den
      num = xs.reduce((s, x) => s + Math.max(x * den, keepWorth), 0);
      den *= f;
    }
    return num / den;
  }

  // DP over the number of distinct faces seen: ways[j] counts the roll sequences so far with
  // exactly j distinct faces. A roll repeats one of the j faces or shows one of the other f - j.
  function distinctValue(f, rolls) {
    let ways = [1];
    for (let n = 0; n < rolls; n++) {
      const next = new Array(ways.length + 1).fill(0);
      ways.forEach((w, j) => { next[j] += w * j; next[j + 1] += w * (f - j); });
      ways = next;
    }
    let all = 0;
    let weighted = 0;
    ways.forEach((w, j) => { all += w; weighted += w * j; });
    return weighted / all;
  }

  // Pascal's triangle up to 52, by DP (every entry is an exact integer below 2^53).
  const PASCAL = (function () {
    const rows = [[1]];
    for (let n = 1; n <= DECK.length; n++) {
      const up = rows[n - 1];
      rows.push(Array.from({ length: n + 1 },
        (_, k) => (k === 0 || k === n ? 1 : up[k - 1] + up[k])));
    }
    return rows;
  })();
  const choose = (n, k) => (k < 0 || k > n ? 0 : PASCAL[n][k]);

  // Enumerate the position j of the first high card (rank >= r). In a shuffled deal the `high`
  // high cards hold a uniformly random set of positions, and the first of them is at j in
  // choose(52 - j, high - 1) of the choose(52, high) sets. Exact counts, one division.
  function firstHighValue(r) {
    const n = DECK.length;
    const high = DECK.filter((rank) => rank >= r).length;
    let weighted = 0;
    for (let j = 1; j <= n - high + 1; j++) weighted += j * choose(n - j, high - 1);
    return weighted / choose(n, high);
  }

  function longestHeadsRun(flips) {
    let best = 0;
    let run = 0;
    for (const c of flips) {
      run = c === HEADS ? run + 1 : 0;
      if (run > best) best = run;
    }
    return best;
  }

  const RANK_NAMES = { 1: "A", 11: "J", 12: "Q", 13: "K" };
  const rankName = (r) => RANK_NAMES[r] || String(r);
  function ranksFrom(r) {
    const names = span(r, 13).map(rankName);
    const last = names.pop();
    return names.length === 0 ? last : `${names.join(", ")} or ${last}`;
  }
  const DECK_NOTE = "a standard 52-card deck (A = 1, J = 11, Q = 12, K = 13)";

  // Per template: the finite parameter space (each params object holds exactly the §F5 row's
  // parameters), the exact value and a plain-text prompt.
  const EV = {
    "dice-max": {
      space: grid({ k: [2, 3], f: [4, 6, 8, 10, 12] }),
      value: (p) => meanOverOutcomes(faces(p.f), p.k, (xs) => Math.max(...xs)),
      prompt: (p) => `Roll ${p.k} fair ${p.f}-sided dice. `
        + "What is the expected value of the highest roll?",
    },
    "dice-min": {
      space: grid({ k: [2, 3], f: [4, 6, 8, 10, 12] }),
      value: (p) => meanOverOutcomes(faces(p.f), p.k, (xs) => Math.min(...xs)),
      prompt: (p) => `Roll ${p.k} fair ${p.f}-sided dice. `
        + "What is the expected value of the lowest roll?",
    },
    "dice-absdiff": {
      space: grid({ f: [4, 6, 8, 10, 12, 20] }),
      value: (p) => meanOverOutcomes(faces(p.f), 2, ([x, y]) => Math.abs(x - y)),
      prompt: (p) => `Roll two fair ${p.f}-sided dice. `
        + "What is the expected absolute difference between them?",
    },
    "dice-reroll": {
      space: grid({ f: [4, 6, 8, 10, 12, 20], r: [1, 2, 3] }),
      value: (p) => rerollValue(p.f, p.r),
      prompt: (p) => `Roll a fair ${p.f}-sided die. After each roll you may stop and be paid `
        + `the face, or reroll, with at most ${p.r} reroll${p.r === 1 ? "" : "s"}. `
        + "What is the expected payout under optimal play?",
    },
    "dice-threshold": {
      space: grid({ t: span(4, 11), c: span(1, 5) }),
      value: (p) => meanOverOutcomes(faces(6), 2, ([x, y]) => (x + y >= p.t ? x + y : -p.c)),
      prompt: (p) => `Roll two fair 6-sided dice. If the sum is ${p.t} or more you are paid `
        + `the sum; otherwise you pay ${p.c}. What is your expected payoff?`,
    },
    "dice-distinct": {
      space: grid({ k: span(2, 6) }),
      value: (p) => distinctValue(6, p.k),
      prompt: (p) => `Roll a fair 6-sided die ${p.k} times. `
        + "What is the expected number of distinct faces seen?",
    },
    "coins-maxrun": {
      space: grid({ n: span(3, 10) }),
      value: (p) => meanOverOutcomes([HEADS, TAILS], p.n, longestHeadsRun),
      prompt: (p) => `Flip ${p.n} fair coins in a row. What is the expected length of the longest `
        + "run of consecutive heads (0 if there are no heads)?",
    },
    "coins-absdiff": {
      space: grid({ n: span(2, 10) }),
      value: (p) => meanOverOutcomes([HEADS, TAILS], p.n, (flips) => {
        const heads = flips.filter((c) => c === HEADS).length;
        return Math.abs(heads - (flips.length - heads));
      }),
      prompt: (p) => `Flip ${p.n} fair coins. What is the expected absolute difference between `
        + "the number of heads and the number of tails?",
    },
    "cards-max": {
      space: grid({ k: [2, 3] }),
      value: (p) => meanOverHands(p.k, (hand) => Math.max(...hand)),
      prompt: (p) => `Draw ${p.k} cards without replacement from ${DECK_NOTE}. `
        + "What is the expected highest rank?",
    },
    "cards-first-high": {
      space: grid({ r: span(10, 13) }),
      value: (p) => firstHighValue(p.r),
      prompt: (p) => `Deal ${DECK_NOTE}, shuffled, one card at a time. What is the expected number `
        + `of cards dealt up to and including the first ${ranksFrom(p.r)}?`,
    },
  };

  // Two different parameter sets per template (a shuffled copy of its space, first two), then
  // one shuffle of all 20 questions.
  function evQuestions(rng) {
    const drawn = [];
    for (const template of EV_TEMPLATES) {
      for (const params of R.shuffle(rng, EV[template].space).slice(0, EV_PER_TEMPLATE)) {
        drawn.push({ template, params });
      }
    }
    return R.shuffle(rng, drawn).map(({ template, params }) => ({
      template,
      params: { ...params },
      prompt: EV[template].prompt(params),
      // no tol: checkNumeric's default tolerance applies (§F1)
      answer: { value: String(EV[template].value(params)) },
    }));
  }

  // ---------- generate (§F1) ----------

  const GENERATORS = {
    arith: arithQuestions, eighty: eightyQuestions, seq: seqQuestions, ev: evQuestions,
  };

  function generate(kind, seed, config) {
    assertKind(kind, "generate");
    const error = configError(kind, config);
    if (error !== null) throw new Error(`generate: invalid ${kind} config: ${error}`);
    const cfg = normalizeConfig(kind, config);
    const s = seed >>> 0;
    const rng = R.mulberry32(s);
    const questions = GENERATORS[kind](rng, cfg).map((q, i) => ({ i, ...q }));
    const timeLimitSecs = kind === "arith" ? cfg.durationSecs : TIME_LIMITS[kind];
    return { kind, seed: s, config: cfg, timeLimitSecs, questions };
  }

  // ---------- scoring and history (§F7) ----------

  const TREND_LENGTH = 10;

  // `config` (optional) defaults to defaultConfig(kind): normalizeConfig reads undefined that way.
  // Only `correct` is read; anything other than true or false (null, missing, a non-object
  // entry) is a skip.
  function scoreRun(kind, answers, config) {
    assertKind(kind, "scoreRun");
    const list = asList(answers, "scoreRun");
    let correct = 0;
    let wrong = 0;
    for (const a of list) {
      const c = isObject(a) ? a.correct : undefined;
      if (c === true) correct++;
      else if (c === false) wrong++;
    }
    const total = kind === "arith" ? list.length : QUESTION_COUNTS[kind];
    const penalty = kind === "eighty" && normalizeConfig(kind, config).negativeMarking ? wrong : 0;
    return { score: correct - penalty, total, correct, wrong, skipped: total - correct - wrong };
  }

  // The oaRuns entries of this kind and config (after normalisation) that carry a numeric score.
  function matchingRuns(runs, kind, config, fn) {
    assertKind(kind, fn);
    const key = configKey(kind, config);
    return asList(runs, fn).filter((r) => isObject(r) && r.kind === kind
      && Number.isFinite(r.score) && configKey(kind, r.config) === key);
  }

  // All-time best (the "last 10" of spec §5 applies to trend only), or null.
  function personalBest(runs, kind, config) {
    const scores = matchingRuns(runs, kind, config, "personalBest").map((r) => r.score);
    return scores.length === 0 ? null : scores.reduce((m, x) => (x > m ? x : m));
  }

  // Stable sort of all matching runs by ts (a non-finite ts sorts first), then the last 10
  // scores, oldest to newest.
  function trend(runs, kind, config) {
    const tsOf = (r) => (Number.isFinite(r.ts) ? r.ts : -Infinity);
    return matchingRuns(runs, kind, config, "trend")
      .map((r, idx) => ({ r, idx }))
      .sort((x, y) => (tsOf(x.r) < tsOf(y.r) ? -1 : tsOf(x.r) > tsOf(y.r) ? 1 : x.idx - y.idx))
      .slice(-TREND_LENGTH)
      .map((x) => x.r.score);
  }

  // The practiceLog entry an in-app Zetamac game writes (spec §2), or null: only an arith run
  // with the default config and a whole, non-negative score writes the zetamac track.
  function zetamacEntry(run) {
    if (!isObject(run) || run.kind !== "arith") return null;
    if (!Number.isInteger(run.score) || run.score < 0) return null;
    if (!isDefaultConfig("arith", run.config)) return null;
    return { ts: run.ts, track: "zetamac", amount: run.score, unit: "score", note: "in-app" };
  }

  return {
    KINDS, TIME_LIMITS, QUESTION_COUNTS, EIGHTY_CATEGORIES, SEQ_FAMILIES, SEQ_SHOWN,
    EV_TEMPLATES, PRIMES, defaultConfig, normalizeConfig, configError, isDefaultConfig,
    sameConfig, generate, seqFit, seqNext, scoreRun, personalBest, trend, zetamacEntry,
    formatClock,
  };
})();
if (typeof module !== "undefined") module.exports = PrepOA;
