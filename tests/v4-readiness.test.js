// v4 readiness (spec §8 F6, §7 verdicts; contracts §H1-§H5, §D9): capped history and mistakes
// appends, NeetCode 150 progress, every area-score formula, verdict parsing, the mistakes journal
// and the checkpoint / under-60 pair. Run with `npm test` (Node's built-in runner).
//
// Every expected value is worked out by hand from the formula quoted next to it, never with the
// module's own helpers. Raw area scores are kept well away from x.5 (contracts §N6). All items,
// slugs and verdict texts are synthetic, written for these tests.
const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../prep/readiness.js");
const P = require("../practice.js");

const DAY = 86400000;
const HOUR = 3600000;
const MINUTE = 60000;
const now = new Date(2026, 10, 4, 15, 0, 0); // Wed 4 Nov 2026 15:00 local
const T = now.getTime();
const SCORE_KEYS = ["coding", "probability", "cpp", "systems", "mental", "oa", "market", "mocks", "overall"];

// ---------- synthetic builders ----------

const id = (key, n) => `${key}-p${n}-q1-${(0xa0000000 + n).toString(16)}`;
function item(itemId, area, topics = ["synthetic-topic"]) {
  return {
    id: itemId, area, topics, difficulty: 2, type: "numeric",
    prompt: `Synthetic prompt for ${itemId}.`, answer: { value: "1" },
    source: { key: itemId.split("-")[0], title: "Synthetic", file: "synthetic.pdf", page: 1 },
  };
}
const card = (interval) => ({
  ease: 2.5, interval, due: T + interval * DAY, reps: 3, lapses: 0, last: T - DAY, seen: T - 40 * DAY,
});
const auto = (ts, itemId, correct) =>
  ({ ts, itemId, mode: "auto", correct, grade: correct ? "good" : "again", secs: 30, answer: correct ? "1" : "2" });
const self = (ts, itemId, grade) =>
  ({ ts, itemId, mode: "self", correct: null, grade, secs: 90, answer: "my working" });
const solve = (slug, ts, extra = {}) => ({ slug, title: slug, ts, ...extra });
const zm = (ts, amount, note = "") => ({ ts, track: "zetamac", amount, unit: "score", note });
const OA_TOTAL = { eighty: 80, seq: 15, ev: 20 };
const oaRun = (ts, kind, score, config = {}) =>
  ({ ts, kind, seed: 11, score, total: OA_TOTAL[kind] ?? score, secs: 300, config });
const mm = (ts, edge, trades) =>
  ({ ts, scenario: "dice", seed: 7, pnl: 0, edge, trades, maxPos: 1, fairErrors: [0] });
const nc = (order, slug, pattern) => ({
  order, problem: `Synthetic problem ${order}`, slug, url: `https://leetcode.com/problems/${slug}/`,
  difficulty: "Medium", pattern, leetcode_id: 9000 + order,
});
const ncList = (problems) => ({ source: "synthetic test list", list: "neetcode150", count: problems.length, problems });
const inputs = (over = {}) => ({
  bank: null, cards: null, history: null, lcSolves: null, nc150: null,
  practiceLog: null, oaRuns: null, mmRuns: null, facts: null, ...over,
});
const clone = (x) => JSON.parse(JSON.stringify(x));

// Every area value is null or an integer 0..100; then check the listed expectations.
function expectScores(actual, expected) {
  for (const k of SCORE_KEYS) {
    assert.ok(k in actual, `areaScores must return ${k}`);
    const v = actual[k];
    assert.ok(v === null || (Number.isInteger(v) && v >= 0 && v <= 100), `${k} must be null or an integer 0..100, got ${v}`);
  }
  for (const [k, v] of Object.entries(expected)) assert.equal(actual[k], v, k);
}
const allNullBut = (over) => Object.fromEntries(SCORE_KEYS.map(k => [k, k in over ? over[k] : null]));

// ---------- scenarios (one per area; ids never overlap, so they can be merged) ----------

// coding: c1 = 6/150 = 0.04 → 2; c2: timed Mediums [1000,1400,1600,2000] → median 1500 →
// 1200/1500 = 0.8 → 24; c3: 10 of the 30 solves have noAI === true → 1/3 → 6.667.
// raw 32.667 → 33.
function codingScenario() {
  const problems = [];
  for (let i = 1; i <= 20; i++) {
    problems.push(nc(i, `tst-nc-${String(i).padStart(2, "0")}`, i <= 8 ? "Arrays & Hashing" : i <= 14 ? "Two Pointers" : "Stack"));
  }
  const solves = [];
  for (let i = 1; i <= 6; i++) solves.push(solve(`tst-nc-0${i}`, T - (40 - i) * HOUR, { difficulty: "Easy" }));
  [1000, 1400, 1600, 2000].forEach((secs, i) => solves.push(solve(`tst-med-${i}`, T - (30 - i) * HOUR, { difficulty: "Medium", secs })));
  for (let i = 0; i < 20; i++) solves.push(solve(`tst-fill-${i}`, T - (20 - i) * HOUR, { difficulty: "Easy" }));
  solves.forEach((s, i) => { if (i % 3 === 0) s.noAI = true; else if (i % 3 === 1) s.noAI = false; }); // i%3===2: absent
  return { nc150: ncList(problems), lcSolves: solves, expected: 33 };
}

// probability: mastery over ALL 5 probability+brainteaser items: pa1 (21) and pb1 (30) are >= 21,
// pa2 (20) is not, pa4 never seen, ps1 is statistics → 2/5 = 0.4 → 24.
// acc over auto answers in those areas: pa1 ✓, pa2 ✓, pa3 ✗, pb1 ✓ → 3/4 → 30 (the self entry,
// the statistics entry and the unknown item are ignored). raw 54 → 54.
function probabilityScenario() {
  const pa = [1, 2, 3, 4].map(n => id("rprob", n));
  const pb1 = id("rbrain", 1);
  const ps1 = id("rstat", 1);
  const bank = [
    item(pa[0], "probability", ["conditional"]), item(pa[1], "probability", ["bayes"]),
    item(pa[2], "probability", ["conditional", "dice"]), item(pa[3], "probability", ["combinatorics"]),
    item(pb1, "brainteaser", ["weighing"]), item(ps1, "statistics", ["variance"]),
  ];
  const cards = { [pa[0]]: card(21), [pa[1]]: card(20), [pb1]: card(30), [ps1]: card(100) };
  const history = [
    auto(T - 9 * HOUR, pa[0], true), auto(T - 8 * HOUR, pa[1], true), auto(T - 7 * HOUR, pa[2], false),
    auto(T - 6 * HOUR, pb1, true), self(T - 5 * HOUR, pb1, "again"), auto(T - 4 * HOUR, ps1, false),
    auto(T - 3 * HOUR, "rnone-p1-q1-00000000", false),
  ];
  return { bank, cards, history, expected: 54 };
}

// cpp: mastery 2/4 (25 and 21 are >= 21; 5 is not; one item never seen) → 35;
// acc = answerOk share over ALL cpp answers: good ✓, hard ✓, again ✗, auto ✓, auto ✗ → 3/5 → 18.
// raw 53 → 53.
function cppScenario() {
  const k = [1, 2, 3, 4].map(n => id("rcpp", n));
  const bank = k.map(x => item(x, "cpp", ["move-semantics"]));
  const cards = { [k[0]]: card(25), [k[1]]: card(21), [k[2]]: card(5) };
  const history = [
    self(T - 20 * HOUR, k[0], "good"), self(T - 19 * HOUR, k[1], "hard"), self(T - 18 * HOUR, k[2], "again"),
    auto(T - 17 * HOUR, k[3], true), auto(T - 16 * HOUR, k[3], false),
  ];
  return { bank, cards, history, expected: 53 };
}

// systems: mastery 1/5 → 14; acc: good ✓, again ✗, auto ✓, auto ✗ → 2/4 → 15. raw 29 → 29.
function systemsScenario() {
  const y = [1, 2, 3, 4, 5].map(n => id("rsys", n));
  const bank = y.map(x => item(x, "systems", ["cache-lines"]));
  const cards = { [y[0]]: card(40), [y[1]]: card(3) };
  const history = [
    self(T - 15 * HOUR, y[0], "good"), self(T - 14 * HOUR, y[1], "again"),
    auto(T - 13 * HOUR, y[2], true), auto(T - 12 * HOUR, y[3], false),
  ];
  return { bank, cards, history, expected: 29 };
}

// mental: last 5 zetamac entries by ts are 30,33,36,39,42 → mean 36 → 36/60 = 0.6 → 60.
// (All 7: mean 360/7 → 86, so the window matters.) Non-zetamac tracks are ignored.
function mentalScenario() {
  const practiceLog = [
    zm(T - 1 * DAY, 42, "120s"),
    { ts: T - 1 * DAY + HOUR, track: "probability", amount: 100, unit: "problems", note: "" },
    zm(T - 7 * DAY, 90, "120s"),
    zm(T - 3 * DAY, 36, "in-app"),
    zm(T - 5 * DAY, 30, "30s"),
    { ts: T, track: "cpp", amount: 45, unit: "minutes", note: "" },
    zm(T - 6 * DAY, 90, "120s"),
    zm(T - 2 * DAY, 39, "in-app"),
    zm(T - 4 * DAY, 33, "120s"),
  ];
  return { practiceLog, expected: 60 };
}

// oa: eighty: last 5 eighty runs are 30,45,48,42,40 (the older 70 drops out) → best 48 → 48/60 = 0.8;
// seq: 9/12 = 0.75; ev: no runs → 0. raw 100·(0.8 + 0.75 + 0)/3 = 51.667 → 52.
// The arith runs are newest and must not crowd the per-kind window.
function oaScenario() {
  const oaRuns = [
    oaRun(T - 10 * DAY, "eighty", 70),
    oaRun(T - 9 * DAY, "eighty", 30),
    oaRun(T - 8 * DAY, "eighty", 45),
    oaRun(T - 7 * DAY, "eighty", 48, { negativeMarking: true }),
    oaRun(T - 6 * DAY, "eighty", 42),
    oaRun(T - 5 * DAY, "eighty", 40),
    oaRun(T - 4 * DAY, "seq", 9),
  ];
  for (let i = 0; i < 6; i++) oaRuns.push(oaRun(T - (3 * DAY) + i * HOUR, "arith", 120, { ops: "default" }));
  return { oaRuns: oaRuns.reverse(), expected: 52 };
}

// market: last 5 games by ts: Σedge = 2 − 1 + 0 + 1.5 + 1.5 = 4, Σtrades = 4 + 2 + 0 + 1 + 3 = 10 →
// x = 0.4 → c = 0.5 + 0.2 = 0.7 → 70. The older game (edge 100) is outside the window.
function marketScenario() {
  const mmRuns = [
    mm(T - 2 * DAY, 1.5, 1),
    mm(T - 6 * DAY, 100, 1),
    mm(T - 4 * DAY, -1, 2),
    mm(T - 1 * DAY, 1.5, 3),
    mm(T - 5 * DAY, 2, 4),
    mm(T - 3 * DAY, 0, 0),
  ];
  return { mmRuns, expected: 70 };
}

// mocks: dsa by date 2,6,7,8 → last 3 → mean 7; trader 9; cv has no parseable score (no data).
// mean of mode means (7 + 9)/2 = 8 → 80. Keys are inserted out of date order.
function mocksScenario() {
  const facts = {
    interview_dsa_20261029: "Verdict: solid. 8/10 overall.",
    goal: "solve 3/10 of the list this week",
    interview_dsa_20261008: "Weak start, 2/10.",
    interview_trader_20261020: "Trader mock: 9/10, quick on EV.",
    interview_dsa_20261022: "problem solving 7/10, communication 7/10",
    interview_cv_20261021: "no score recorded this time",
    interview_dsa_20261015: "Verdict: 6/10.",
  };
  return { facts, expected: 80 };
}

function fullInputs() {
  const c = codingScenario(), p = probabilityScenario(), k = cppScenario(), s = systemsScenario();
  return inputs({
    bank: [...p.bank, ...k.bank, ...s.bank],
    cards: { ...p.cards, ...k.cards, ...s.cards },
    history: [...p.history, ...k.history, ...s.history],
    lcSolves: c.lcSolves, nc150: c.nc150,
    practiceLog: mentalScenario().practiceLog, oaRuns: oaScenario().oaRuns,
    mmRuns: marketScenario().mmRuns, facts: mocksScenario().facts,
  });
}

// ---------- 1. constants ----------

test("readiness constants: AREA_KEYS, MOCK_MODES, OA_TARGETS and the storage caps", () => {
  assert.deepEqual(R.AREA_KEYS, ["coding", "probability", "cpp", "systems", "mental", "oa", "market", "mocks"]);
  assert.deepEqual(R.MOCK_MODES, ["dsa", "quantdev", "cv", "trader"]);
  assert.deepEqual({ ...R.OA_TARGETS }, { eighty: 60, seq: 12, ev: 16 });
  assert.equal(R.HISTORY_CAP, 20000);
  assert.equal(R.MISTAKES_CAP, 5000);
  assert.equal(R.PRACTICE_LOG_CAP, 2000);
});

// ---------- 2. history and mistakes (§H1, spec §2) ----------

test("spec §2 prepHistory capped at 20000, oldest dropped: appendCapped with HISTORY_CAP", () => {
  const list = Array.from({ length: 19999 }, (_, i) => ({ ts: i, itemId: `h${i}` }));
  const before = clone(list);
  const fresh = [{ ts: 20000, itemId: "new-a" }, { ts: 20001, itemId: "new-b" }, { ts: 20002, itemId: "new-c" }];
  const out = R.appendCapped(list, fresh, R.HISTORY_CAP);
  assert.equal(out.length, 20000);
  assert.deepEqual(out[0], { ts: 2, itemId: "h2" }); // h0 and h1 dropped
  assert.deepEqual(out.slice(-3), fresh);
  assert.deepEqual(list, before, "the stored list is not mutated");
  assert.notEqual(out, list);
});

test("spec §2 prepMistakes capped at 5000, oldest dropped: appendCapped with MISTAKES_CAP", () => {
  const list = Array.from({ length: 5000 }, (_, i) => ({ ts: i, itemId: `m${i}`, answer: "x", note: "" }));
  const out = R.appendCapped(list, [{ ts: 9999, itemId: "m-new", answer: "y", note: "" }], R.MISTAKES_CAP);
  assert.equal(out.length, 5000);
  assert.equal(out[0].itemId, "m1");
  assert.equal(out[4999].itemId, "m-new");
});

test("appendCapped keeps everything under the cap, treats a null list as [], and keeps the newest when entries alone exceed it", () => {
  const a = { ts: 1 }, b = { ts: 2 }, c = { ts: 3 };
  assert.deepEqual(R.appendCapped([a], [b, c], 5), [a, b, c]);
  assert.deepEqual(R.appendCapped(null, [a], 5), [a]);
  assert.deepEqual(R.appendCapped(undefined, [a, b], 5), [a, b]);
  assert.deepEqual(R.appendCapped([a, b], [], 5), [a, b]);
  const many = Array.from({ length: 7 }, (_, i) => ({ ts: i }));
  assert.deepEqual(R.appendCapped([], many, 5), many.slice(2));
});

test("historyEntry returns exactly the 7 history keys with secs rounded and clamped to 0..3600", () => {
  const e = R.historyEntry({ ts: T, itemId: "rprob-p1-q1-a0000001", mode: "auto", correct: true, grade: "good", secs: 12.6, answer: "0.25", extra: "dropped" });
  assert.deepEqual(e, { ts: T, itemId: "rprob-p1-q1-a0000001", mode: "auto", correct: true, grade: "good", secs: 13, answer: "0.25" });
  const secsOf = (secs) => R.historyEntry({ ts: T, itemId: "x", mode: "auto", correct: false, grade: "again", secs, answer: "1" }).secs;
  assert.equal(secsOf(7.4), 7);
  assert.equal(secsOf(-4), 0);
  assert.equal(secsOf(7200), 3600);
  assert.equal(secsOf(3600.4), 3600);
  assert.equal(secsOf(NaN), 0);
  assert.equal(secsOf(Infinity), 0);
  assert.equal(secsOf("abc"), 0);
  assert.equal(secsOf(undefined), 0);
  assert.equal(secsOf("42.2"), 42);
});

test("historyEntry keeps an mcq index as a number, a self entry's null correct, and truncates string answers to 2000 chars", () => {
  const mcq = R.historyEntry({ ts: T, itemId: "x", mode: "auto", correct: false, grade: "again", secs: 5, answer: 2 });
  assert.equal(mcq.answer, 2);
  const free = R.historyEntry({ ts: T, itemId: "y", mode: "self", correct: null, grade: "hard", secs: 100, answer: "w".repeat(2500) });
  assert.equal(free.correct, null);
  assert.equal(free.mode, "self");
  assert.equal(free.answer, "w".repeat(2000));
  const empty = R.historyEntry({ ts: T, itemId: "y", mode: "self", correct: null, grade: "good", secs: 1, answer: "" });
  assert.equal(empty.answer, "");
});

test("spec §8 every wrong auto-checked answer and every again grade adds a mistake (mistakeFor)", () => {
  const wrong = { ts: T, itemId: "rprob-p1-q1-a0000001", mode: "auto", correct: false, grade: "again", secs: 20, answer: "0.3" };
  assert.deepEqual(R.mistakeFor(wrong), { ts: T, itemId: "rprob-p1-q1-a0000001", answer: "0.3", note: "" });
  const selfAgain = { ts: T + 1, itemId: "rcpp-p1-q1-a0000001", mode: "self", correct: null, grade: "again", secs: 50, answer: "forgot the rule" };
  assert.deepEqual(R.mistakeFor(selfAgain), { ts: T + 1, itemId: "rcpp-p1-q1-a0000001", answer: "forgot the rule", note: "" });
  for (const grade of ["hard", "good", "easy"]) {
    assert.equal(R.mistakeFor({ ts: T, itemId: "z", mode: "self", correct: null, grade, secs: 5, answer: "" }), null, grade);
  }
  assert.equal(R.mistakeFor({ ts: T, itemId: "z", mode: "auto", correct: true, grade: "hard", secs: 500, answer: "1" }), null);
});

// ---------- 3. NeetCode 150 (§H2, spec §8) ----------

test("spec §8 nc150Progress matches the list to lcSolves by exact slug: solved, total, byPattern", () => {
  const list = ncList([
    nc(1, "tst-dup-check", "Arrays & Hashing"),
    nc(2, "tst-anagram", "Arrays & Hashing"),
    nc(3, "tst-palindrome", "Two Pointers"),
    nc(4, "tst-pair-sum", "Arrays & Hashing"),
    nc(5, "tst-brackets", "Stack"),
    nc(6, "tst-triplets", "Two Pointers"),
  ]);
  const solves = [
    solve("tst-dup-check", T - 2 * DAY, { noAI: false }),
    solve("tst-palindrome", T - 3 * DAY),
    solve("tst-palindrome", T - 1 * DAY, { noAI: true }), // a re-solve counts once
    solve("Tst-Anagram", T - DAY), // not an exact slug match
    solve("tst-unlisted", T - DAY),
    solve("tst-triplets", T - 400 * DAY, { noAI: null }), // any time counts
  ];
  const before = clone({ list, solves });
  const r = R.nc150Progress(list, solves);
  assert.equal(r.solved, 3);
  assert.equal(r.total, 6);
  assert.deepEqual(r.byPattern, {
    "Arrays & Hashing": { solved: 1, total: 3 },
    "Two Pointers": { solved: 2, total: 2 },
    "Stack": { solved: 0, total: 1 },
  });
  assert.deepEqual(Object.keys(r.byPattern), ["Arrays & Hashing", "Two Pointers", "Stack"], "patterns in order of first appearance");
  assert.deepEqual(r.next, list.problems[1]);
  assert.deepEqual({ list, solves }, before, "inputs are not mutated");
});

test("spec §8 nc150Progress next is the first unsolved problem in list order, null when all are solved", () => {
  const list = ncList([
    nc(2, "tst-b", "Stack"), // array order wins over the order field
    nc(1, "tst-a", "Stack"),
    nc(3, "tst-c", "Binary Search"),
  ]);
  assert.deepEqual(R.nc150Progress(list, []).next, list.problems[0]);
  assert.deepEqual(R.nc150Progress(list, [solve("tst-b", T)]).next, list.problems[1]);
  assert.deepEqual(R.nc150Progress(list, [solve("tst-b", T), solve("tst-a", T)]).next, list.problems[2]);
  const all = R.nc150Progress(list, [solve("tst-c", T), solve("tst-a", T), solve("tst-b", T)]);
  assert.equal(all.next, null);
  assert.equal(all.solved, 3);
  assert.equal(all.total, 3);
  assert.deepEqual(all.byPattern, { "Stack": { solved: 2, total: 2 }, "Binary Search": { solved: 1, total: 1 } });
});

test("nc150Progress with no list or no solves", () => {
  assert.deepEqual(R.nc150Progress(null, [solve("tst-a", T)]), { solved: 0, total: 0, byPattern: {}, next: null });
  const list = ncList([nc(1, "tst-a", "Stack"), nc(2, "tst-b", "Heap")]);
  const r = R.nc150Progress(list, null);
  assert.equal(r.solved, 0);
  assert.equal(r.total, 2);
  assert.deepEqual(r.byPattern, { "Stack": { solved: 0, total: 1 }, "Heap": { solved: 0, total: 1 } });
  assert.deepEqual(r.next, list.problems[0]);
});

// ---------- 4. area scores (§H3, spec §8) ----------

test("spec §8 missing data gives null, not 0: every area and overall are null with no inputs", () => {
  expectScores(R.areaScores(inputs()), allNullBut({}));
});

test("spec §8 missing data gives null: data that does not belong to an area leaves it null", () => {
  const c = cppScenario();
  const stat = id("rstat", 7);
  const s = R.areaScores(inputs({
    bank: [...c.bank, item(stat, "statistics")],
    // cards say "mastered" but no history maps to probability, systems or cpp
    cards: { ...c.cards },
    history: [auto(T - HOUR, stat, true), auto(T - HOUR, "rnone-p9-q1-00000000", true)],
    lcSolves: [], // empty: coding has no data even with a list
    nc150: codingScenario().nc150,
    practiceLog: [{ ts: T, track: "probability", amount: 5, unit: "problems", note: "" }],
    oaRuns: [oaRun(T, "arith", 55)],
    mmRuns: [mm(T - 6 * DAY, 3, 5), ...[1, 2, 3, 4, 5].map(d => mm(T - d * DAY, 0, 0))], // last 5 have no trades
    facts: { interview_dsa_20261020: "no score given", note: "aim for 9/10" },
  }));
  expectScores(s, allNullBut({}));
});

test("spec §8 coding: 50 × nc150Solved/150 divides by 150 literally, not by the list length", () => {
  const problems = Array.from({ length: 12 }, (_, i) => nc(i + 1, `tst-l-${i}`, i < 6 ? "Arrays & Hashing" : "Stack"));
  const solves = problems.map((p, i) => solve(p.slug, T - (20 - i) * HOUR, { difficulty: "Easy" }));
  solves.push(solve("tst-unlisted", T - HOUR, { difficulty: "Easy" }));
  // c1 = 12/150 = 0.08 → 4; no timed Mediums → c2 = 0; noAI unknown everywhere → c3 = 0
  expectScores(R.areaScores(inputs({ lcSolves: solves, nc150: ncList(problems) })), allNullBut({ coding: 4, overall: 4 }));
  // without a list c1 = 0, and the area still has data → 0, not null
  expectScores(R.areaScores(inputs({ lcSolves: solves })), allNullBut({ coding: 0, overall: 0 }));
});

test("spec §8 clamp every component to [0, 1]: coding nc150Solved/150 above 1 is clamped", () => {
  const problems = Array.from({ length: 160 }, (_, i) => nc(i + 1, `tst-big-${i}`, "Arrays & Hashing"));
  const solves = problems.map((p, i) => solve(p.slug, T - (200 - i) * HOUR));
  // c1 = min(1, 160/150) = 1 → 50
  expectScores(R.areaScores(inputs({ lcSolves: solves, nc150: ncList(problems) })), allNullBut({ coding: 50, overall: 50 }));
});

test("spec §8 coding: 30 × min(1, 1200 / medianMediumSecs) over the last 10 timed Mediums", () => {
  const score = (lcSolves) => R.areaScores(inputs({ lcSolves })).coding;
  // odd count, plus a fast Hard and an untimed Medium that do not count: median 2400 → 0.5 → 15
  assert.equal(score([
    solve("tst-m1", T - 5 * HOUR, { difficulty: "Medium", secs: 900 }),
    solve("tst-m2", T - 4 * HOUR, { difficulty: "Medium", secs: 3000 }),
    solve("tst-h1", T - 3 * HOUR, { difficulty: "Hard", secs: 60 }),
    solve("tst-m3", T - 2 * HOUR, { difficulty: "Medium", secs: 2400 }),
    solve("tst-m4", T - 1 * HOUR, { difficulty: "Medium" }),
  ]), 15);
  // even count: median (1400 + 1600)/2 = 1500 → 0.8 → 24
  assert.equal(score([1000, 1400, 1600, 2000].map((secs, i) => solve(`tst-e${i}`, T - (5 - i) * HOUR, { difficulty: "Medium", secs }))), 24);
  // faster than 20 min: min(1, 1200/600) = 1 → 30
  assert.equal(score([solve("tst-fast", T, { difficulty: "Medium", secs: 600 })]), 30);
  // window: 11 old slow Mediums (4000 s) then the 10 newest at 1200 s → median 1200 → 30
  // (all 21 would give median 4000 → 9). Input is newest first.
  const win = [];
  for (let i = 0; i < 11; i++) win.push(solve(`tst-old-${i}`, T - (40 - i) * HOUR, { difficulty: "Medium", secs: 4000 }));
  for (let i = 0; i < 10; i++) win.push(solve(`tst-new-${i}`, T - (20 - i) * HOUR, { difficulty: "Medium", secs: 1200 }));
  assert.equal(score(win.reverse()), 30);
});

test("spec §8 noAIShare is the share of the last 30 solves with noAI === true; unknown counts as not no-AI", () => {
  const solves = [];
  // 10 old solves, all noAI true, fall outside the window
  for (let i = 0; i < 10; i++) solves.push(solve(`tst-o${i}`, T - (100 - i) * HOUR, { noAI: true }));
  // the 30 newest, by ts: 12 true, then 6 false, 6 null, 6 with no field
  for (let i = 0; i < 30; i++) {
    const extra = i < 12 ? { noAI: true } : i < 18 ? { noAI: false } : i < 24 ? { noAI: null } : {};
    solves.push(solve(`tst-n${i}`, T - (50 - i) * HOUR, extra));
  }
  // c3 = 12/30 = 0.4 → 20 × 0.4 = 8 (all 40: 22/40 → 11; ignoring unknowns: 12/18 → 13).
  // Input is newest first, so the last 30 must be taken by ts.
  expectScores(R.areaScores(inputs({ lcSolves: solves.reverse() })), allNullBut({ coding: 8, overall: 8 }));
  // fewer than 30 solves: the share is over the solves there are: 1 of 4 → 0.25 → 5
  const few = [solve("a", T - 4 * HOUR, { noAI: true }), solve("b", T - 3 * HOUR, { noAI: false }),
    solve("c", T - 2 * HOUR, { noAI: null }), solve("d", T - HOUR)];
  assert.equal(R.areaScores(inputs({ lcSolves: few })).coding, 5);
});

test("spec §8 coding: 50 × nc150Solved/150 + 30 × min(1, 1200/median) + 20 × noAIShare, rounded", () => {
  const c = codingScenario();
  expectScores(R.areaScores(inputs({ lcSolves: c.lcSolves, nc150: c.nc150 })), allNullBut({ coding: c.expected, overall: c.expected }));
});

test("spec §8 probability: 60 × mastery(probability+brainteaser items) + 40 × accuracy(auto-checked answers)", () => {
  const p = probabilityScenario();
  expectScores(R.areaScores(inputs({ bank: p.bank, cards: p.cards, history: p.history })), allNullBut({ probability: p.expected, overall: p.expected }));
});

test("spec §8 probability accuracy uses the last 50 auto-checked answers in those areas (filter, then take)", () => {
  const pw1 = id("rwin", 1), pw2 = id("rwin", 2);
  const bank = [item(pw1, "probability"), item(pw2, "brainteaser")];
  const history = [];
  let t = T - 500 * MINUTE;
  for (let i = 0; i < 10; i++) history.push(auto(t++, pw1, false)); // outside the last 50
  for (let i = 0; i < 10; i++) history.push(auto(t++, pw2, false));
  for (let i = 0; i < 10; i++) history.push(auto(t++, pw1, true));
  for (let i = 0; i < 30; i++) history.push(auto(t++, pw2, true));
  for (let i = 0; i < 20; i++) history.push(self(t++, pw2, "good")); // newest, but self-graded
  // last 50 auto: 40 correct of 50 → 0.8 → 32; no cards → mastery 0.
  // (all 60 auto: 40/60 → 27; last 50 entries then filter: 30/30 → 40)
  const shuffled = [...history.slice(40), ...history.slice(0, 40).reverse()];
  expectScores(R.areaScores(inputs({ bank, history: shuffled })), allNullBut({ probability: 32, overall: 32 }));
});

test("spec §8 probability with self-graded answers only: accuracy counts as 0 and mastery still counts", () => {
  const a = id("rself", 1), b = id("rself", 2), c = id("rself", 3);
  const bank = [item(a, "probability"), item(b, "probability"), item(c, "brainteaser")];
  // mastery 1/3 → 20; no auto answers → acc 0
  const s = R.areaScores(inputs({ bank, cards: { [a]: card(22) }, history: [self(T - HOUR, c, "good")] }));
  expectScores(s, allNullBut({ probability: 20, overall: 20 }));
});

test("spec §8 cpp: 70 × mastery(cpp cards) + 30 × accuracy(last 50 cpp answers, any mode)", () => {
  const k = cppScenario();
  expectScores(R.areaScores(inputs({ bank: k.bank, cards: k.cards, history: k.history })), allNullBut({ cpp: k.expected, overall: k.expected }));
});

test("spec §8 cpp accuracy window is the last 50 cpp answers by ts", () => {
  const k1 = id("rcwin", 1), s1 = id("rswin", 1);
  const bank = [item(k1, "cpp"), item(s1, "systems")];
  const history = [];
  let t = T - 500 * MINUTE;
  for (let i = 0; i < 5; i++) history.push(self(t++, k1, "good")); // outside the last 50
  for (let i = 0; i < 20; i++) history.push(self(t++, k1, "hard"));
  for (let i = 0; i < 30; i++) history.push(self(t++, k1, "again"));
  for (let i = 0; i < 12; i++) history.push(self(t++, s1, "good")); // newest, systems
  // cpp: last 50 cpp answers → 20 OK of 50 → 0.4 → 12 (all 55: 25/55 → 14).
  // systems: mastery 0, acc 12/12 → 30.
  const s = R.areaScores(inputs({ bank, history: history.reverse() }));
  expectScores(s, allNullBut({ cpp: 12, systems: 30, overall: 21 }));
});

test("spec §8 systems: 70 × mastery(systems cards) + 30 × accuracy(last 50 systems answers)", () => {
  const y = systemsScenario();
  expectScores(R.areaScores(inputs({ bank: y.bank, cards: y.cards, history: y.history })), allNullBut({ systems: y.expected, overall: y.expected }));
  // cpp history alone leaves systems null even with systems cards stored
  const k = cppScenario();
  const s = R.areaScores(inputs({ bank: [...y.bank, ...k.bank], cards: { ...y.cards, ...k.cards }, history: k.history }));
  expectScores(s, allNullBut({ cpp: k.expected, overall: k.expected }));
});

test("spec §8 mental: 100 × min(1, mean(last 5 zetamac scores)/60), any zetamac entry counts", () => {
  const m = mentalScenario();
  expectScores(R.areaScores(inputs({ practiceLog: m.practiceLog })), allNullBut({ mental: m.expected, overall: m.expected }));
});

test("spec §8 mental clamps to 100 and a zero score is 0, not null", () => {
  const high = [70, 80, 75, 75, 75].map((a, i) => zm(T - (5 - i) * HOUR, a)); // mean 75 → min(1, 1.25) → 100
  assert.equal(R.areaScores(inputs({ practiceLog: high })).mental, 100);
  const zero = [zm(T - HOUR, 0, "120s")];
  expectScores(R.areaScores(inputs({ practiceLog: zero })), allNullBut({ mental: 0, overall: 0 }));
});

test("mental: last 5 is a stable sort by ts, so equal timestamps keep their input order", () => {
  // all at the same ts: the final 5 in input order are the 30s → mean 30 → 50
  const log = [90, 30, 30, 30, 30, 30].map(a => zm(T - HOUR, a));
  assert.equal(R.areaScores(inputs({ practiceLog: log })).mental, 50);
});

test("spec §8 oa: 100 × mean over eighty/seq/ev of min(1, best of last 5 / target)", () => {
  const o = oaScenario();
  expectScores(R.areaScores(inputs({ oaRuns: o.oaRuns })), allNullBut({ oa: o.expected, overall: o.expected }));
});

test("spec §8 oa targets are 60/80 for eighty, 12/15 for seq and 16/20 for ev", () => {
  const oa = (runs) => R.areaScores(inputs({ oaRuns: runs })).oa;
  assert.equal(oa([oaRun(T, "eighty", 45)]), 25); // 45/60 = 0.75 → 25 (a target of 80 would give 19)
  assert.equal(oa([oaRun(T, "seq", 9)]), 25); // 9/12 = 0.75 → 25 (15 would give 20)
  assert.equal(oa([oaRun(T, "ev", 8)]), 17); // 8/16 = 0.5 → 16.67 (20 would give 13)
  assert.equal(oa([oaRun(T - 3 * HOUR, "eighty", 45), oaRun(T - 2 * HOUR, "seq", 9), oaRun(T - HOUR, "ev", 8)]), 67); // 2.0/3
});

test("spec §8 oa clamps each kind to [0, 1]: above target is 1, a negative-marked score is 0", () => {
  const oa = (runs) => R.areaScores(inputs({ oaRuns: runs })).oa;
  assert.equal(oa([oaRun(T - 3 * HOUR, "eighty", 75), oaRun(T - 2 * HOUR, "seq", 15), oaRun(T - HOUR, "ev", 20)]), 100);
  const neg = [oaRun(T - 2 * HOUR, "eighty", -3, { negativeMarking: true }), oaRun(T - HOUR, "eighty", -1, { negativeMarking: true })];
  expectScores(R.areaScores(inputs({ oaRuns: neg })), allNullBut({ oa: 0, overall: 0 }));
});

test("spec §8 market: 100 × clamp(0.5 + edge per trade over the last 5 games / 2), pooled", () => {
  const m = marketScenario();
  expectScores(R.areaScores(inputs({ mmRuns: m.mmRuns })), allNullBut({ market: m.expected, overall: m.expected }));
});

test("spec §8 market clamps to [0, 100]", () => {
  const market = (runs) => R.areaScores(inputs({ mmRuns: runs })).market;
  assert.equal(market([mm(T, 6, 3)]), 100); // x = 2 → 1.5 → 1
  assert.equal(market([mm(T, -9, 3)]), 0); // x = −3 → −1 → 0, and 0 is not null
  assert.equal(market([]), null);
});

test("spec §8 mocks: 10 × mean(last 3 verdict scores per mode, averaged over modes with data)", () => {
  const m = mocksScenario();
  expectScores(R.areaScores(inputs({ facts: m.facts })), allNullBut({ mocks: m.expected, overall: m.expected }));
  // several scores in one verdict → their mean: (7 + 6 + 8)/3 = 7 → 70
  assert.equal(R.areaScores(inputs({ facts: { interview_quantdev_20261101: "problem solving 7/10, communication 6/10, code 8/10" } })).mocks, 70);
  assert.equal(R.areaScores(inputs({ facts: { interview_cv_20261101: "7.5 / 10" } })).mocks, 75);
});

test("spec §8 mocks: a 0/10 verdict is 0, not null", () => {
  expectScores(R.areaScores(inputs({ facts: { interview_trader_20261102: "Verdict: 0/10." } })), allNullBut({ mocks: 0, overall: 0 }));
});

test("spec §8 overall is the mean of the non-null (already rounded) scores", () => {
  // mental: 5 entries summing 61 → mean 12.2 → 12.2/60 → 20.333 → 20
  // market: x = −3.92/10 = −0.392 → 0.304 → 30.4 → 30
  // mocks: 4.14 → 41.4 → 41
  // overall = round((20 + 30 + 41)/3) = round(30.33) = 30 (the mean of the raw values, 30.71, would round to 31)
  const s = R.areaScores(inputs({
    practiceLog: [12, 12, 12, 12, 13].map((a, i) => zm(T - (6 - i) * HOUR, a)),
    mmRuns: [mm(T - HOUR, -3.92, 10)],
    facts: { interview_dsa_20261103: "Overall 4.14/10" },
  }));
  expectScores(s, allNullBut({ mental: 20, market: 30, mocks: 41, overall: 30 }));
});

test("areaScores: all eight areas together, overall over all of them", () => {
  const s = R.areaScores(fullInputs());
  // (33 + 54 + 53 + 29 + 60 + 52 + 70 + 80)/8 = 431/8 = 53.875 → 54
  expectScores(s, { coding: 33, probability: 54, cpp: 53, systems: 29, mental: 60, oa: 52, market: 70, mocks: 80, overall: 54 });
});

test("areaScores is deterministic, does not mutate its inputs and accepts the bank as { items }", () => {
  const inp = fullInputs();
  const before = clone(inp);
  const a = R.areaScores(inp);
  assert.deepEqual(inp, before);
  assert.deepEqual(R.areaScores(inp), a);
  assert.deepEqual(R.areaScores({ ...inp, bank: { items: inp.bank } }), a);
});

test("areaScoresAt truncates entries to the cutoff (inclusive) and replays cards from history", () => {
  const cutoff = new Date(2026, 10, 10, 12, 0, 0).getTime(); // Tue 10 Nov 2026 12:00 local
  const at = (d, h = 9) => new Date(2026, 10, d, h, 0, 0).getTime();
  const k1 = id("rat", 1), k2 = id("rat", 2);
  const history = [
    // k1: four goods before the cutoff → replayed intervals 1, 6, 15, 38 → mastered (>= 21)
    self(at(1), k1, "good"), self(at(2), k1, "good"), self(at(3), k1, "good"), self(at(4), k1, "good"),
    // k2: three goods before the cutoff → 15, not mastered; the fourth comes after it
    self(at(5), k2, "good"), self(at(6), k2, "good"), self(at(7), k2, "good"),
    self(at(11), k2, "good"), self(at(12), k1, "again"),
  ];
  const inp = inputs({
    bank: [item(k1, "cpp"), item(k2, "cpp")],
    cards: { [k1]: card(100), [k2]: card(100) }, // stored "now" cards: both mastered
    history,
    lcSolves: [solve("tst-at", cutoff, { noAI: true }), solve("tst-after", cutoff + 1, { noAI: false })],
    practiceLog: [zm(at(9), 30), zm(at(11), 60)],
    oaRuns: [oaRun(at(9), "eighty", 30), oaRun(at(11), "eighty", 60)],
    mmRuns: [mm(at(9), 1.2, 2), mm(at(11), -10, 2)],
    facts: {
      interview_dsa_20261110: "8/10", // the cutoff's own day is kept
      interview_dsa_20261111: "2/10", // the next day is dropped
      interview_trader_20261109: "6/10",
    },
  });
  const before = clone(inp);
  // At the cutoff: coding c3 = 1/1 → 20; cpp mastery 1/2 → 35 + acc 7/7 → 30 = 65; mental 30/60 → 50;
  // oa 30/60 = 0.5 → 16.67 → 17; market x = 0.6 → 0.8 → 80; mocks (8 + 6)/2 → 70.
  // overall (20 + 65 + 50 + 17 + 80 + 70)/6 = 50.33 → 50
  expectScores(R.areaScoresAt(inp, cutoff),
    { coding: 20, probability: null, cpp: 65, systems: null, mental: 50, oa: 17, market: 80, mocks: 70, overall: 50 });
  // Now (no cutoff, stored cards): coding 1/2 → 10; cpp 70 + 30 × 8/9 → 96.67 → 97; mental 45/60 → 75;
  // oa 60/60 → 33; market x = −8.8/4 → clamp 0; mocks dsa (8 + 2)/2 = 5, trader 6 → 55.
  // overall (10 + 97 + 75 + 33 + 0 + 55)/6 = 45
  expectScores(R.areaScores(inp),
    { coding: 10, probability: null, cpp: 97, systems: null, mental: 75, oa: 33, market: 0, mocks: 55, overall: 45 });
  assert.deepEqual(inp, before, "inputs are not mutated");
});

test("areaScoresAt keeps entries stamped exactly at the cutoff in every list, keeps nc150, and replaces (not merges) the stored cards", () => {
  const cutoff = new Date(2026, 10, 10, 12, 0, 0).getTime(); // Tue 10 Nov 2026 12:00 local
  const at = (d, h = 9) => new Date(2026, 10, d, h, 0, 0).getTime();
  const k1 = id("rcut", 1), k2 = id("rcut", 2), k3 = id("rcut", 3), k4 = id("rcut", 4);
  const history = [
    // k1: four goods well before the cutoff → replayed intervals 1, 6, 15, then round(15 × 2.5) → mastered
    self(at(1), k1, "good"), self(at(2), k1, "good"), self(at(3), k1, "good"), self(at(4), k1, "good"),
    // k2: three goods (15, not mastered) and the fourth exactly AT the cutoff → mastered at the cutoff
    self(at(5), k2, "good"), self(at(6), k2, "good"), self(at(7), k2, "good"), self(cutoff, k2, "good"),
    // k4: one again before the cutoff → replayed interval 0, and accuracy below 1
    self(at(8), k4, "again"),
    // k3: graded only after the cutoff, so it has no replayed card at the cutoff
    self(cutoff + HOUR, k3, "again"),
  ];
  const inp = inputs({
    bank: [item(k1, "cpp"), item(k2, "cpp"), item(k3, "cpp"), item(k4, "cpp")],
    cards: { [k1]: card(100), [k2]: card(100), [k3]: card(100), [k4]: card(100) }, // stored "now" cards: all mastered
    history,
    nc150: ncList(Array.from({ length: 12 }, (_, n) => nc(n + 1, `tst-cut-${n + 1}`, n < 6 ? "Stack" : "Heap"))),
    // noAI is unknown everywhere (c3 = 0), so only c1 and c2 move. tst-cut-6 is the one timed Medium,
    // stamped exactly at the cutoff; tst-cut-7..12 come after it.
    lcSolves: Array.from({ length: 12 }, (_, n) => n < 5
      ? solve(`tst-cut-${n + 1}`, cutoff - (5 - n) * HOUR)
      : n === 5
        ? solve("tst-cut-6", cutoff, { difficulty: "Medium", secs: 1500 })
        : solve(`tst-cut-${n + 1}`, cutoff + (n - 5) * HOUR)),
    practiceLog: [zm(cutoff - DAY, 24), zm(cutoff, 48), zm(cutoff + 1, 60)],
    oaRuns: [oaRun(cutoff, "seq", 9), oaRun(cutoff + 1, "seq", 12)],
    mmRuns: [mm(cutoff, 1, 5), mm(cutoff + 1, -5, 5)],
  });
  const before = clone(inp);
  // At the cutoff:
  //   coding: c1 = 6/150 → 2; c2: the at-cutoff Medium, 1200/1500 = 0.8 → 24; c3 = 0. raw 26
  //     (cutoff exclusive → 5/150 and no Medium → 2; nc150 dropped → 24; solves not truncated → 28)
  //   cpp: replayed mastery 2/4 (k1, k2; k4 is at 0 and k3 has no card yet) → 35; acc 8/9 → 26.667.
  //     raw 61.667 → 62 (stored cards merged in → 79; the at-cutoff grade dropped from the replay → 44,
  //     or from the accuracy window → 61)
  //   mental: mean(24, 48) = 36 → 60; oa: seq 9/12 → 25; market: x = 1/5 → 0.6 → 60
  //   overall (26 + 62 + 60 + 25 + 60)/5 = 46.6 → 47
  expectScores(R.areaScoresAt(inp, cutoff),
    { coding: 26, probability: null, cpp: 62, systems: null, mental: 60, oa: 25, market: 60, mocks: null, overall: 47 });
  // Now (stored cards, everything kept):
  //   coding: 12/150 → 4; 24; c3 = 0. raw 28
  //   cpp: stored mastery 4/4 → 70; acc 8/10 → 24. raw 94
  //   mental: mean 44 → 73.333 → 73; oa: 12/12 → 33.333 → 33; market: x = −4/10 → 0.3 → 30
  //   overall (28 + 94 + 73 + 33 + 30)/5 = 51.6 → 52
  expectScores(R.areaScores(inp),
    { coding: 28, probability: null, cpp: 94, systems: null, mental: 73, oa: 33, market: 30, mocks: null, overall: 52 });
  assert.deepEqual(inp, before, "inputs are not mutated");
});

// ---------- 5. checkpoint + under 60 (§H3, §H4, spec §8) ----------

test("under60 lists the AREA_KEYS whose score is a number below 60, in AREA_KEYS order", () => {
  const scores = { overall: 20, mocks: null, market: 59, oa: 100, mental: 0, systems: null, cpp: 59, probability: 60, coding: 4 };
  assert.deepEqual(R.under60(scores), ["coding", "cpp", "mental", "market"]);
  assert.deepEqual(R.under60(allNullBut({})), []);
  assert.deepEqual(R.under60({ coding: 60, probability: 99, cpp: 100, systems: 61, mental: 80, oa: 60, market: 70, mocks: 75, overall: 10 }), []);
});

test("spec §8 checkpoints: the dashboard shows the next AM_CHECKPOINTS entry with days left and which area scores are under 60", () => {
  // own oracle for the next checkpoint: first due date on or after today's local date
  const todayStr = "2026-11-04";
  const expectCp = P.AM_CHECKPOINTS.find(c => c.due >= todayStr);
  const [y, m, d] = expectCp.due.split("-").map(Number);
  const expectDays = Math.round((new Date(y, m - 1, d) - new Date(2026, 10, 4)) / DAY);
  const cp = P.amNextCheckpoint(P.AM_CHECKPOINTS, new Date(T));
  assert.equal(cp.due, expectCp.due);
  assert.equal(cp.daysLeft, expectDays);
  // scores from the dashboard inputs: mental 60 (not under), oa 52, market 70, the rest no data
  const s = R.areaScores(inputs({ practiceLog: mentalScenario().practiceLog, oaRuns: oaScenario().oaRuns, mmRuns: marketScenario().mmRuns }));
  assert.deepEqual(R.under60(s), ["oa"]);
  assert.deepEqual(R.under60(R.areaScores(fullInputs())), ["coding", "probability", "cpp", "systems", "oa"]);
});

// ---------- 6. verdicts (§H4, spec §7) ----------

test("spec §7 parseVerdictScore reads /(\\d+(\\.\\d+)?)\\s*\\/\\s*10/ from a verdict", () => {
  assert.equal(R.parseVerdictScore("Verdict: 6/10. Saved."), 6);
  assert.equal(R.parseVerdictScore("7.5 / 10"), 7.5);
  assert.equal(R.parseVerdictScore("Score 8 /10"), 8);
  assert.equal(R.parseVerdictScore("Score 8/ 10"), 8);
  assert.equal(R.parseVerdictScore("Score 8 \t/\t 10"), 8);
  assert.equal(R.parseVerdictScore("10/10, flawless"), 10);
  assert.equal(R.parseVerdictScore("0/10"), 0);
});

test("parseVerdictScore: several matches give their unrounded mean", () => {
  assert.equal(R.parseVerdictScore("problem solving 7/10, communication 6/10, code 8/10"), 7);
  assert.equal(R.parseVerdictScore("design 6.5/10 and testing 7/10"), 6.75);
  const v = R.parseVerdictScore("7/10, 8/10, 8/10");
  assert.ok(Math.abs(v - 23 / 3) <= 1e-9 * (23 / 3), `expected 23/3, got ${v}`);
});

test("parseVerdictScore keeps only matches of 10 or less, null when none are kept", () => {
  assert.equal(R.parseVerdictScore("2027/10"), null);
  assert.equal(R.parseVerdictScore("11/10 effort"), null);
  assert.equal(R.parseVerdictScore("effort 12/10, result 8/10"), 8);
  assert.equal(R.parseVerdictScore("great work, no number"), null);
  assert.equal(R.parseVerdictScore("8 out of 10"), null);
  assert.equal(R.parseVerdictScore(""), null);
});

test("parseVerdictScore returns null for non-string input", () => {
  for (const v of [null, undefined, 7, { text: "7/10" }, ["7/10"], true]) {
    assert.equal(R.parseVerdictScore(v), null, String(v));
  }
});

test("spec §7 mockVerdicts gives the score per mode over time from interview_<mode>_YYYYMMDD facts", () => {
  const facts = {
    interview_dsa_20270115: "Verdict: 5/10.",
    interview_trader_20270120: "7.5 / 10",
    interview_dsa_20270108: "problem solving 6/10, communication 8/10",
    interview_quantdev_20270101: "no score this time",
    interview_cv_20261231: "Overall 9/10",
    interview_dsa_2027011: "8/10", // 7 digits
    interview_sysdesign_20270115: "8/10", // unknown mode
    interview_DSA_20270116: "8/10", // case differs
    interview_dsa_20270117_retry: "8/10", // suffix
    goal: "solve 3/10 problems a day",
    interview_dsa_20270122: 9, // not a string → no score
  };
  const before = clone(facts);
  assert.deepEqual(R.mockVerdicts(facts), {
    dsa: [{ day: "2027-01-08", score: 7 }, { day: "2027-01-15", score: 5 }],
    quantdev: [],
    cv: [{ day: "2026-12-31", score: 9 }],
    trader: [{ day: "2027-01-20", score: 7.5 }],
  });
  assert.deepEqual(facts, before);
});

test("mockVerdicts with no facts gives an empty list for every mode", () => {
  const empty = { dsa: [], quantdev: [], cv: [], trader: [] };
  assert.deepEqual(R.mockVerdicts(null), empty);
  assert.deepEqual(R.mockVerdicts({}), empty);
  assert.deepEqual(R.mockVerdicts({ plan_note: "4/10 confidence" }), empty);
});

// ---------- 7. mistakes journal (§H5, spec §8) ----------

function mistakesFixture() {
  const i = (n) => id("rmis", n);
  const bank = [
    item(i(1), "probability", ["conditional", "bayes"]),
    item(i(2), "probability", ["conditional"]),
    item(i(3), "probability", ["dice"]),
    item(i(4), "brainteaser", ["bayes", "dice"]),
    item(i(5), "cpp", ["combinatorics"]),
    item(i(6), "systems", ["geometry"]),
  ];
  const m = (ts, n, answer) => ({ ts, itemId: n === 0 ? "rnone-p1-q1-00000000" : i(n), answer, note: "" });
  const mistakes = [
    m(T + 100, 1, "0.4"),
    m(T + 300, 3, "7"),
    m(T + 200, 2, "1/3"),
    m(T + 300, 4, "two"),
    m(T + 50, 0, "?"), // unknown item: ignored
    m(T + 150, 1, "0.6"),
    m(T + 400, 5, "6"),
    m(T + 400, 6, "pi"),
  ];
  return { i, bank, mistakes };
}

test("spec §8 mistakeTopics groups mistakes by topic with recurring topics first", () => {
  const { i, bank, mistakes } = mistakesFixture();
  const before = clone(mistakes);
  const r = R.mistakeTopics(mistakes, bank);
  // count desc, then lastTs desc, then topic ascending
  assert.deepEqual(r.map(t => t.topic), ["bayes", "conditional", "dice", "combinatorics", "geometry"]);
  const by = Object.fromEntries(r.map(t => [t.topic, t]));
  assert.equal(by.bayes.count, 3);
  assert.equal(by.bayes.lastTs, T + 300);
  assert.deepEqual(by.bayes.itemIds, [i(4), i(1)]);
  assert.deepEqual(by.bayes.entries, [mistakes[3], mistakes[5], mistakes[0]]);
  assert.equal(by.conditional.count, 3);
  assert.equal(by.conditional.lastTs, T + 200);
  assert.deepEqual(by.conditional.itemIds, [i(2), i(1)]);
  assert.deepEqual(by.conditional.entries, [mistakes[2], mistakes[5], mistakes[0]]);
  // equal ts keep input order
  assert.deepEqual(by.dice.entries, [mistakes[1], mistakes[3]]);
  assert.deepEqual(by.dice.itemIds, [i(3), i(4)]);
  assert.equal(by.dice.count, 2);
  assert.equal(by.combinatorics.count, 1);
  assert.equal(by.combinatorics.lastTs, T + 400);
  assert.deepEqual(by.combinatorics.itemIds, [i(5)]);
  assert.deepEqual(by.combinatorics.entries, [mistakes[6]]);
  assert.deepEqual(mistakes, before, "mistakes are not mutated");
});

test("mistakeTopics ignores mistakes for unknown items and accepts the bank as { items }", () => {
  const { bank, mistakes } = mistakesFixture();
  assert.deepEqual(R.mistakeTopics(mistakes, { items: bank }), R.mistakeTopics(mistakes, bank));
  assert.deepEqual(R.mistakeTopics([{ ts: T, itemId: "rnone-p1-q1-00000000", answer: "", note: "" }], bank), []);
  assert.deepEqual(R.mistakeTopics(null, bank), []);
  assert.deepEqual(R.mistakeTopics(mistakes, null), []);
});

test("weakestTopics takes the top topics of the mistakes from the last 30 days", () => {
  const i = (n) => id("rweak", n);
  const topics = ["dice", "geometry", "bayes", "conditional", "combinatorics", "variance"];
  const bank = topics.map((t, n) => item(i(n), "probability", [t]));
  const m = (ts, n) => ({ ts, itemId: i(n), answer: "", note: "" });
  const mistakes = [
    ...[1, 2, 3, 4, 5].map(k => m(T - 31 * DAY - k, 0)), // dice: too old
    ...[0, 1, 2, 3].map(() => m(T - 30 * DAY, 1)), // geometry: exactly 30 days ago, excluded
    m(T - 29 * DAY, 2), // bayes
    m(T - 2 * DAY, 3), m(T - 2 * DAY - HOUR, 3), // conditional ×2
    m(T - 1 * DAY, 4), // combinatorics
    m(T - 3 * HOUR, 5), // variance
  ];
  assert.deepEqual(R.weakestTopics(mistakes, bank, T), ["conditional", "variance", "combinatorics"]);
  assert.deepEqual(R.weakestTopics(mistakes, bank, T, 1), ["conditional"]);
  assert.deepEqual(R.weakestTopics(mistakes, bank, T, 10), ["conditional", "variance", "combinatorics", "bayes"]);
  assert.deepEqual(R.weakestTopics([], bank, T), []);
});
