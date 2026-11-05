// v4 practice.js change: the Sunday review trigger gains an optional `prep` string
// (V4-CONTRACTS.md §H8, spec §9 F7 "Sunday review"). When `prep` is non-empty, the text
// `${prep} ` goes immediately after the checkpoint sentence (after `${cp}. `) and before
// "Grade the week". The v3 regression WITHOUT `prep` lives in tests/static.test.js; every
// test here passes a non-empty `prep`, so each one is red until v4 lands.
//
// Oracle: the expected v3 triggers below are written out by hand from the v3 template,
// and the expected v4 text is built from them with plain string slicing in this file.
// Nothing here uses the module to compute its own expected value.
const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../practice.js");

// ---------- fixed inputs and their hand-written v3 triggers ----------

const FULL = {
  week: { leetcode: 7, zetamac: 48, probability: 5, cpp: 40, project: 15, mock: 1 },
  streak: 9,
  zetamac: { last: [41, 45, 48], best: 52, count: 11 },
  medianMediumSecs: 19 * 60,
  resolveDebt: 2,
  checkpoint: { due: "2027-02-28", label: "synthetic checkpoint for the prep tests", daysLeft: 115 },
  solvedTotal: 88,
};
const FULL_CP = "Next checkpoint: 2027-02-28 (115 days left) — synthetic checkpoint for the prep tests";
const FULL_V3 =
  "[Automatic Sunday weekly review — run it now. " +
  "Week totals: LC 7 · Zetamac 48 · Prob 5 · C++ 40m · Project 15m · Mock 1. " +
  "Streak: 9 day(s). " +
  "LeetCode total: 88 solved. " +
  "Zetamac last games: 41 → 45 → 48 (best 52, 11 games logged). " +
  "Median Medium solve time: 19 min. " +
  "Re-solve debt: 2 due. " +
  FULL_CP + ". " +
  "Grade the week against the next checkpoint honestly (on track / behind / ahead, and why), " +
  "name the one thing to change next week, and call update_plan if the plan itself needs " +
  "adjusting. Then get me to commit to today's target. Keep it under 8 sentences.]";

const EMPTY = {
  week: { leetcode: 0, zetamac: 0, probability: 0, cpp: 0, project: 0, mock: 0 },
  streak: 0,
  zetamac: { last: [], best: null, count: 0 },
  medianMediumSecs: null,
  resolveDebt: 0,
  checkpoint: null,
  solvedTotal: null,
};
const EMPTY_CP = "Next checkpoint: no dated checkpoint left in the plan";
const EMPTY_V3 =
  "[Automatic Sunday weekly review — run it now. " +
  "Week totals: LC 0 · Zetamac 0 · Prob 0 · C++ 0m · Project 0m · Mock 0. " +
  "Streak: 0 day(s). " +
  "Zetamac: no Zetamac games logged yet. " +
  "Median Medium solve time: no timed Medium solves yet. " +
  "Re-solve debt: 0 due. " +
  EMPTY_CP + ". " +
  "Grade the week against the next checkpoint honestly (on track / behind / ahead, and why), " +
  "name the one thing to change next week, and call update_plan if the plan itself needs " +
  "adjusting. Then get me to commit to today's target. Keep it under 8 sentences.]";

// Synthetic line in the §H8 prepWeeklyLine shape (invented numbers).
const PREP_LINE =
  "Prep week: 14 answered (prob 6 · brain 2 · stats 1 · fin 0 · cpp 3 · sys 2), " +
  "auto-checked accuracy 64%. Score change since last Sunday: overall 41 (+5) · coding 30 (+2) · " +
  "prob 55 (+10) · cpp n/a · sys 12 (new) · mental 70 (-3) · oa n/a · market n/a · mocks 60 (0).";

// Independent oracle: insert `${prep} ` right after the first `${cp}. ` (plain slicing, so
// no String.replace pattern expansion can leak into the expected value).
function expectedWithPrep(v3, cp, prep) {
  const marker = cp + ". ";
  const at = v3.indexOf(marker);
  assert.ok(at >= 0, "test oracle: checkpoint sentence must be in the hand-written v3 text");
  const cut = at + marker.length;
  return v3.slice(0, cut) + prep + " " + v3.slice(cut);
}

function trigger(input, prep) {
  return P.amWeeklyReviewTrigger({ ...input, prep });
}

// ---------- 1. placement and format ----------

test("Sunday review: the trigger includes the prep line right after the checkpoint sentence, before 'Grade the week'", () => {
  const txt = trigger(FULL, PREP_LINE);
  assert.ok(txt.includes(`${FULL_CP}. ${PREP_LINE} Grade the week`),
    "expected `${cp}. ${prep} Grade the week` in the trigger");
  assert.equal(txt, expectedWithPrep(FULL_V3, FULL_CP, PREP_LINE));
});

test("Sunday review: with no dated checkpoint left, the prep line follows the no-checkpoint sentence", () => {
  const txt = trigger(EMPTY, PREP_LINE);
  assert.ok(txt.includes(`${EMPTY_CP}. ${PREP_LINE} Grade the week`));
  assert.equal(txt, expectedWithPrep(EMPTY_V3, EMPTY_CP, PREP_LINE));
});

test("Sunday review: the prep line is anchored to the end of the checkpoint sentence, even when the checkpoint label mentions grading the week", () => {
  // The label is the only free text before the insertion point; a label that itself contains
  // "Grade the week" must not pull the prep text inside the checkpoint sentence.
  const label = "Grade the week early, then rest (synthetic label)";
  const input = { ...FULL, checkpoint: { ...FULL.checkpoint, label } };
  const cp = `Next checkpoint: 2027-02-28 (115 days left) — ${label}`;
  const v3 = FULL_V3.split(FULL_CP).join(cp); // hand-written v3 text with the new label
  const txt = trigger(input, PREP_LINE);
  assert.ok(txt.includes(`${cp}. ${PREP_LINE} Grade the week against`));
  assert.equal(txt, expectedWithPrep(v3, cp, PREP_LINE));
});

test("Sunday review: the trigger carries the week's prep totals and the score change since last Sunday", () => {
  const txt = trigger(FULL, PREP_LINE);
  assert.match(txt, /Prep week: 14 answered/);
  assert.match(txt, /auto-checked accuracy 64%/);
  assert.match(txt, /Score change since last Sunday: overall 41 \(\+5\)/);
  assert.match(txt, /mental 70 \(-3\)/);
});

test("Sunday review with prep: the prep text sits after every v3 status piece and before the grading instruction", () => {
  const txt = trigger(FULL, PREP_LINE);
  const at = txt.indexOf(PREP_LINE);
  assert.ok(at > 0, "prep text must be present");
  for (const piece of ["Week totals:", "Streak: 9", "LeetCode total: 88", "Zetamac last games:",
    "Median Medium solve time: 19 min", "Re-solve debt: 2", FULL_CP]) {
    const p = txt.indexOf(piece);
    assert.ok(p >= 0 && p < at, `${piece} must come before the prep text`);
  }
  assert.ok(txt.indexOf("Grade the week") > at + PREP_LINE.length, "prep must come before 'Grade the week'");
  assert.ok(txt.startsWith("[Automatic Sunday weekly review"));
  assert.ok(txt.endsWith("Keep it under 8 sentences.]"));
});

test("Sunday review with prep: the insertion adds exactly the prep text plus one space, once", () => {
  for (const prep of ["x", PREP_LINE, "Prep week: 0 answered (prob 0 · brain 0 · stats 0 · fin 0 · cpp 0 · sys 0), auto-checked accuracy n/a."]) {
    const txt = trigger(FULL, prep);
    assert.equal(txt.length, FULL_V3.length + prep.length + 1, `length with prep ${JSON.stringify(prep)}`);
    assert.equal(txt.split(prep + " Grade the week").length, 2, "prep inserted exactly once");
  }
});

test("Sunday review with prep: the prep text is inserted verbatim, with no replacement-pattern expansion", () => {
  const prep = "Prep week: odd chars $& $1 $$ $` $' (+0) · 100% → kept as typed.";
  const txt = trigger(FULL, prep);
  assert.equal(txt, expectedWithPrep(FULL_V3, FULL_CP, prep));
});

// ---------- 2. only a non-empty prep changes the output ----------

test("Sunday review: only a non-empty prep changes the trigger, an empty prep string adds nothing", () => {
  assert.equal(trigger(FULL, "Prep week: 1 answered."),
    expectedWithPrep(FULL_V3, FULL_CP, "Prep week: 1 answered."));
  assert.equal(trigger(FULL, ""), FULL_V3);
  assert.equal(trigger(EMPTY, ""), EMPTY_V3);
});

test("Sunday review with prep: different prep lines give different triggers sharing the v3 text around them", () => {
  const a = trigger(FULL, "Prep week: 2 answered.");
  const b = trigger(FULL, "Prep week: 9 answered.");
  assert.notEqual(a, b);
  assert.equal(a, expectedWithPrep(FULL_V3, FULL_CP, "Prep week: 2 answered."));
  assert.equal(b, expectedWithPrep(FULL_V3, FULL_CP, "Prep week: 9 answered."));
});

// ---------- 3. purity ----------

test("Sunday review with prep: the trigger does not mutate its input and is deterministic", () => {
  const input = { ...structuredClone(FULL), prep: PREP_LINE };
  const clone = structuredClone(input);
  const first = P.amWeeklyReviewTrigger(input);
  const second = P.amWeeklyReviewTrigger(input);
  assert.deepEqual(input, clone);
  assert.equal(first, second);
  assert.ok(first.includes(PREP_LINE), "prep text must be present");
});
