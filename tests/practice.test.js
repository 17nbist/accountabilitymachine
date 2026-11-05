// v3 pure logic: practice tracks, Zetamac parsing, solve timing, interview modes,
// checkpoints and the Sunday review. Run with `npm test` (Node's built-in runner).
const test = require("node:test");
const assert = require("node:assert/strict");
const { amTodayKey } = require("../shared.js");
const P = require("../practice.js");

const DAY = 86400000;
const now = new Date(2026, 10, 4, 15, 0, 0); // Wed 4 Nov 2026 15:00 local
const T = now.getTime();

// ---------- 1. checkpoints + plan migration ----------

test("AM_CHECKPOINTS are dated, ordered and cover the whole plan", () => {
  assert.ok(Array.isArray(P.AM_CHECKPOINTS) && P.AM_CHECKPOINTS.length >= 4);
  let prev = "";
  for (const c of P.AM_CHECKPOINTS) {
    assert.match(c.due, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(c.due > prev, "checkpoints must be chronological");
    assert.ok(c.label.length > 10);
    prev = c.due;
  }
});

test("amNextCheckpoint returns the first checkpoint not yet due, with days left", () => {
  const cps = [
    { due: "2027-02-28", label: "~100 solved, medium in ~20 min" },
    { due: "2027-04-30", label: "order book with benchmarks on GitHub" },
  ];
  const next = P.amNextCheckpoint(cps, new Date(2026, 10, 4));
  assert.equal(next.label, cps[0].label);
  assert.equal(next.daysLeft, 116);
  const later = P.amNextCheckpoint(cps, new Date(2027, 2, 15));
  assert.equal(later.label, cps[1].label);
  assert.equal(P.amNextCheckpoint(cps, new Date(2027, 5, 1)), null);
});

test("amIsV2DefaultPlan only matches the untouched pre-v3 default plan", () => {
  assert.equal(P.amIsV2DefaultPlan(P.AM_V2_DEFAULT_PLAN), true);
  assert.equal(P.amIsV2DefaultPlan(P.AM_V2_DEFAULT_PLAN + "\nPhase 3: extra line"), false);
  assert.equal(P.amIsV2DefaultPlan(""), false);
  assert.equal(P.amIsV2DefaultPlan(undefined), false);
});

// ---------- 2. practice log ----------

test("AM_TRACKS is the fixed six-track list with units", () => {
  assert.deepEqual(Object.keys(P.AM_TRACKS).sort(),
    ["cpp", "leetcode", "mock", "probability", "project", "zetamac"]);
  assert.equal(P.AM_TRACKS.zetamac.unit, "score");
  assert.equal(P.AM_TRACKS.cpp.unit, "minutes");
  assert.equal(P.AM_TRACKS.probability.unit, "problems");
  assert.equal(P.AM_TRACKS.mock.unit, "count");
});

test("amPracticeEntry validates and normalises a self-report", () => {
  const e = P.amPracticeEntry({ track: "probability", amount: "4", note: "Green Book ch.2" }, T);
  assert.deepEqual(e, { ts: T, track: "probability", amount: 4, unit: "problems", note: "Green Book ch.2" });
  const e2 = P.amPracticeEntry({ track: "cpp", amount: 45 }, T);
  assert.equal(e2.unit, "minutes");
  assert.equal(e2.note, "");
});

test("amPracticeEntry rejects bad tracks, amounts and the auto-only leetcode track", () => {
  assert.match(P.amPracticeEntry({ track: "codeforces", amount: 1 }, T).error, /track/);
  assert.match(P.amPracticeEntry({ track: "cpp", amount: -5 }, T).error, /amount/);
  assert.match(P.amPracticeEntry({ track: "cpp", amount: "lots" }, T).error, /amount/);
  assert.match(P.amPracticeEntry({ track: "cpp", amount: 0 }, T).error, /amount/);
  assert.match(P.amPracticeEntry({ track: "cpp", amount: 100000 }, T).error, /amount/);
  assert.match(P.amPracticeEntry({ track: "leetcode", amount: 1 }, T).error, /auto-detected/);
});

test("amPracticeEntry truncates long notes", () => {
  const e = P.amPracticeEntry({ track: "project", amount: 30, note: "x".repeat(500) }, T);
  assert.equal(e.note.length, 200);
});

test("amTodayTotals sums per track for today only, best-of-day for zetamac, LC from solves", () => {
  const todayKey = amTodayKey(now);
  const log = [
    { ts: T - 3600000, track: "probability", amount: 3, unit: "problems", note: "" },
    { ts: T - 1800000, track: "probability", amount: 2, unit: "problems", note: "" },
    { ts: T - 2 * DAY, track: "probability", amount: 9, unit: "problems", note: "" }, // not today
    { ts: T - 5000, track: "zetamac", amount: 41, unit: "score", note: "120s" },
    { ts: T - 4000, track: "zetamac", amount: 47, unit: "score", note: "120s" },
    { ts: T - 3000, track: "zetamac", amount: 39, unit: "score", note: "120s" },
    { ts: T - 2000, track: "cpp", amount: 30, unit: "minutes", note: "" },
  ];
  const lcSolves = [
    { slug: "two-sum", title: "Two Sum", ts: T - 60000 },
    { slug: "old", title: "Old", ts: T - 3 * DAY },
  ];
  const t = P.amTodayTotals(log, lcSolves, todayKey);
  assert.deepEqual(t, { leetcode: 1, zetamac: 47, probability: 5, cpp: 30, project: 0, mock: 0 });
});

test("amTodayLine renders the compact summary", () => {
  const line = P.amTodayLine({ leetcode: 1, zetamac: 47, probability: 0, cpp: 0, project: 25, mock: 0 }, 2);
  assert.equal(line, "Today: LC 1/2 · Zetamac 47 · Prob 0 · C++ 0m · Project 25m · Mock 0");
  const noTarget = P.amTodayLine({ leetcode: 0, zetamac: 0, probability: 0, cpp: 0, project: 0, mock: 0 }, null);
  assert.equal(noTarget, "Today: LC 0 · Zetamac 0 · Prob 0 · C++ 0m · Project 0m · Mock 0");
});

// ---------- 3. zetamac ----------

test("amParseZetamacScore reads the end-of-game text", () => {
  assert.equal(P.amParseZetamacScore("Score: 47"), 47);
  assert.equal(P.amParseZetamacScore("  Score:  0 "), 0);
  assert.equal(P.amParseZetamacScore("Score: 112"), 112);
  assert.equal(P.amParseZetamacScore("Seconds left: 12"), null);
  assert.equal(P.amParseZetamacScore(""), null);
  assert.equal(P.amParseZetamacScore(null), null);
});

test("amParseZetamacDuration reads the initial countdown", () => {
  assert.equal(P.amParseZetamacDuration("Seconds left: 120"), 120);
  assert.equal(P.amParseZetamacDuration("Seconds left:"), null);
});

test("amZetamacStats gives last 7 scores (oldest→newest) and best ever", () => {
  const log = [];
  for (let i = 0; i < 10; i++) log.push({ ts: T - (10 - i) * DAY, track: "zetamac", amount: 30 + i, unit: "score", note: "120s" });
  log.push({ ts: T - 5 * DAY, track: "cpp", amount: 20, unit: "minutes", note: "" });
  const s = P.amZetamacStats(log);
  assert.deepEqual(s.last, [33, 34, 35, 36, 37, 38, 39]);
  assert.equal(s.best, 39);
  assert.equal(s.count, 10);
  assert.deepEqual(P.amZetamacStats([]), { last: [], best: null, count: 0 });
});

// ---------- 4. solve timing ----------

test("amSolveSecs returns elapsed seconds, null when unknown or beyond the 3h cap", () => {
  assert.equal(P.amSolveSecs(T - 20 * 60000, T), 1200);
  assert.equal(P.amSolveSecs(undefined, T), null);
  assert.equal(P.amSolveSecs(T - 4 * 3600000, T), null); // tab left open overnight
  assert.equal(P.amSolveSecs(T + 5000, T), null); // clock skew
});

test("amMedianMediumSecs is the median of the last 10 timed Medium solves", () => {
  const solves = [];
  // 12 mediums: 10..21 min; only the last 10 (12..21) count → median of 16,17 = 16.5 min
  for (let i = 0; i < 12; i++) {
    solves.push({ slug: `m${i}`, title: `M${i}`, ts: T - (12 - i) * DAY, difficulty: "Medium", secs: (10 + i) * 60 });
  }
  solves.push({ slug: "e1", title: "E1", ts: T, difficulty: "Easy", secs: 60 });
  solves.push({ slug: "m-untimed", title: "MU", ts: T, difficulty: "Medium" });
  assert.equal(P.amMedianMediumSecs(solves), 16.5 * 60);
  assert.equal(P.amMedianMediumSecs([]), null);
  assert.equal(P.amMedianMediumSecs([{ slug: "e", ts: T, difficulty: "Easy", secs: 30 }]), null);
});

test("amSolveTimeLine formats for the prompt", () => {
  assert.equal(P.amSolveTimeLine(16.5 * 60, 10), "Median Medium solve time (last 10 timed): 17 min.");
  assert.equal(P.amSolveTimeLine(null, 0), "Median Medium solve time: no timed Medium solves yet.");
});

// ---------- 5. interview modes ----------

test("AM_INTERVIEW_MODES has the four modes and each prompt names its verdict key", () => {
  assert.deepEqual(Object.keys(P.AM_INTERVIEW_MODES), ["dsa", "quantdev", "cv", "trader"]);
  for (const [id, m] of Object.entries(P.AM_INTERVIEW_MODES)) {
    assert.ok(m.label && m.prompt, `${id} needs label + prompt`);
    assert.ok(m.prompt.includes(`interview_${id}_YYYYMMDD`), `${id} prompt must name its verdict key`);
    assert.match(m.prompt, /out of 10/);
  }
  assert.match(P.AM_INTERVIEW_MODES.quantdev.prompt, /move semantics/);
  assert.match(P.AM_INTERVIEW_MODES.cv.prompt, /dcheck/);
  assert.match(P.AM_INTERVIEW_MODES.trader.prompt, /expected value/i);
});

test("amInterviewKey builds interview_<mode>_YYYYMMDD", () => {
  assert.equal(P.amInterviewKey("quantdev", new Date(2026, 10, 4)), "interview_quantdev_20261104");
  assert.equal(P.amInterviewKey("dsa", new Date(2027, 0, 9)), "interview_dsa_20270109");
});

// ---------- 6. sunday review ----------

test("amWeekTotals sums the last 7 days per track (zetamac = best), LC from solves", () => {
  const log = [
    { ts: T - 1 * DAY, track: "probability", amount: 4, unit: "problems", note: "" },
    { ts: T - 6 * DAY, track: "probability", amount: 2, unit: "problems", note: "" },
    { ts: T - 8 * DAY, track: "probability", amount: 50, unit: "problems", note: "" }, // outside window
    { ts: T - 2 * DAY, track: "zetamac", amount: 44, unit: "score", note: "" },
    { ts: T - 3 * DAY, track: "zetamac", amount: 51, unit: "score", note: "" },
    { ts: T - 1 * DAY, track: "mock", amount: 1, unit: "count", note: "" },
  ];
  const lcSolves = [
    { slug: "a", ts: T - 1 * DAY }, { slug: "b", ts: T - 2 * DAY }, { slug: "c", ts: T - 9 * DAY },
  ];
  assert.deepEqual(P.amWeekTotals(log, lcSolves, T),
    { leetcode: 2, zetamac: 51, probability: 6, cpp: 0, project: 0, mock: 1 });
});

test("amWeeklyReviewTrigger mentions every input the buddy must grade", () => {
  const txt = P.amWeeklyReviewTrigger({
    week: { leetcode: 9, zetamac: 51, probability: 6, cpp: 0, project: 0, mock: 1 },
    streak: 12,
    zetamac: { last: [40, 44, 51], best: 51, count: 3 },
    medianMediumSecs: 23 * 60,
    resolveDebt: 3,
    checkpoint: { due: "2027-02-28", label: "~100 solved, typical medium in ~20 min", daysLeft: 116 },
    solvedTotal: 142,
  });
  assert.match(txt, /weekly review/i);
  assert.match(txt, /LC 9/);
  assert.match(txt, /Zetamac.*40 → 44 → 51/);
  assert.match(txt, /best 51/);
  assert.match(txt, /C\+\+ 0m/);
  assert.match(txt, /Streak: 12/);
  assert.match(txt, /23 min/);
  assert.match(txt, /re-solve debt: 3/i);
  assert.match(txt, /2027-02-28/);
  assert.match(txt, /116 days/);
  assert.match(txt, /142 solved/);
  assert.match(txt, /update_plan/);
});

test("amWeeklyReviewTrigger copes with empty data", () => {
  const txt = P.amWeeklyReviewTrigger({
    week: { leetcode: 0, zetamac: 0, probability: 0, cpp: 0, project: 0, mock: 0 },
    streak: 0, zetamac: { last: [], best: null, count: 0 }, medianMediumSecs: null,
    resolveDebt: 0, checkpoint: null, solvedTotal: null,
  });
  assert.match(txt, /no Zetamac games/i);
  assert.match(txt, /no timed Medium/i);
  assert.match(txt, /no dated checkpoint/i);
});
