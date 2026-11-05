// v4 buddy-side readiness helpers (V4-CONTRACTS.md §H6-§H11): interview material, the Prep
// summary line, the Sunday prep line, buddy drills, practice-log integration and the
// "Check my reasoning" request body. Every item below is synthetic, written for these tests.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const P = require("../practice.js");
const R = require("../prep/readiness.js");
const OA = require("../prep/oa.js");

const DAY = 86400000;
const HOUR = 3600000;
const T = new Date(2026, 10, 4, 15, 0, 0).getTime(); // Wed 4 Nov 2026 15:00 local
const SUNDAY = new Date(2026, 10, 8, 18, 0, 0).getTime(); // Sun 8 Nov 2026 18:00 local
const THEN = SUNDAY - 7 * DAY; // "last Sunday" (§H8: plain ms)

// PREP_LINE_RE, copied from V4-CONTRACTS.md §K3.
const PREP_LINE_RE = /^Prep: overall (\d+|n\/a) · prob (\d+|n\/a) · cpp (\d+|n\/a) · sys (\d+|n\/a) · due today \d+ · weakest: .+$/m;

// ---------- synthetic data helpers ----------

function item(id, area, topics, o = {}) {
  const type = o.type || "numeric";
  const answer = o.answer || (type === "mcq" ? { choices: ["alpha", "beta", "gamma"], correct: 1 }
    : type === "free" ? { value: `Model answer for ${id}.` } : { value: "1/2" });
  return {
    id,
    source: { key: "synth", title: "Synthetic Notes", file: "synthetic-notes.pdf", page: o.page || 1 },
    area,
    topics,
    difficulty: o.difficulty || 2,
    type,
    prompt: o.prompt || `Synthetic question ${id}?`,
    answer,
    solution: o.solution || `Synthetic worked solution for ${id}.`,
    origin: "generated",
    check: { status: "agreed", method: "blind" },
  };
}

// A graded card (finite due). Only interval, lapses and due matter to §H6.
function card(interval, lapses = 0, due = T + Math.max(1, interval) * DAY) {
  return { ease: 2.5, interval, due, reps: interval > 0 ? 2 : 0, lapses, last: T - DAY, seen: T - 20 * DAY };
}

function hist(ts, itemId, mode, correct, grade, secs = 30, answer = "") {
  return { ts, itemId, mode, correct, grade, secs, answer };
}

const ids = list => list.map(x => x.id);
const clone = x => JSON.parse(JSON.stringify(x));

// ---------- 1. interview material (§H6, spec §7) ----------

const POOL_BANK = [
  item("pool-p1", "probability", ["conditional"]),
  item("pool-b1", "brainteaser", ["weighing"], { type: "free" }),
  item("pool-s1", "statistics", ["regression"]),
  item("pool-s2", "statistics", ["regression", "expected-value"]),
  item("pool-f1", "finance", ["expected-value"]),
  item("pool-f2", "finance", ["options"], { type: "mcq" }),
  item("pool-c1", "cpp", ["move-semantics"], { type: "free" }),
  item("pool-c2", "cpp", ["templates"]),
  item("pool-y1", "systems", ["cache-hierarchy"], { type: "mcq" }),
];

test("spec §7: quantdev material uses cpp and systems items only", () => {
  const got = R.pickInterviewMaterial(POOL_BANK, {}, [], "quantdev", 50);
  // nothing is carded and every key ties, so the order is bank order
  assert.deepEqual(ids(got), ["pool-c1", "pool-c2", "pool-y1"]);
});

test("spec §7: trader material uses probability, brainteaser and expected-value items (any area)", () => {
  assert.equal(R.EV_TOPIC, "expected-value");
  const got = R.pickInterviewMaterial(POOL_BANK, {}, [], "trader", 50);
  assert.deepEqual(ids(got), ["pool-p1", "pool-b1", "pool-s2", "pool-f1"]);
  // "in any area": a deck item tagged expected-value joins the trader pool too
  const cppEv = item("pool-cev", "cpp", ["expected-value", "templates"]);
  assert.deepEqual(ids(R.pickInterviewMaterial([...POOL_BANK, cppEv], {}, [], "trader", 50)),
    ["pool-p1", "pool-b1", "pool-s2", "pool-f1", "pool-cev"]);
});

test("pickInterviewMaterial: dsa, cv and unknown modes get no material", () => {
  const cards = { "pool-c1": card(1, 3), "pool-p1": card(1, 2) };
  const history = [hist(T - DAY, "pool-p1", "auto", false, "again")];
  assert.deepEqual([...R.MOCK_MODES], ["dsa", "quantdev", "cv", "trader"]);
  for (const mode of ["dsa", "cv", "quant", "", undefined]) {
    assert.deepEqual(R.pickInterviewMaterial(POOL_BANK, cards, history, mode, 3), [], `mode ${mode}`);
  }
});

test("pickInterviewMaterial: n defaults to 3 and returns the bank's item objects", () => {
  const bank = [
    item("dn-c1", "cpp", ["raii"]), item("dn-c2", "cpp", ["raii"]),
    item("dn-y1", "systems", ["numa"]), item("dn-y2", "systems", ["numa"]),
  ];
  const got = R.pickInterviewMaterial(bank, {}, [], "quantdev");
  assert.equal(got.length, 3);
  assert.deepEqual(got, bank.slice(0, 3));
});

test("spec §7 real weak spots: carded items come before uncarded ones, which only fill the list", () => {
  const bank = [
    item("cf-u1", "cpp", ["raii"], { difficulty: 1 }),          // no card
    item("cf-k1", "cpp", ["raii"], { difficulty: 5 }),          // carded, interval 200
    item("cf-u2", "systems", ["numa"], { difficulty: 1 }),      // card exists but due is null: not carded
    item("cf-k2", "systems", ["numa"], { difficulty: 4 }),      // carded, interval 100
    item("cf-u3", "cpp", ["raii"], { difficulty: 3 }),          // no card
    item("cf-u4", "cpp", ["raii"], { difficulty: 2 }),          // no card
  ];
  const cards = {
    "cf-k1": card(200),
    "cf-k2": card(100),
    "cf-u2": { ease: 2.5, interval: 0, due: null, reps: 0, lapses: 0, last: null, seen: null },
  };
  assert.deepEqual(ids(R.pickInterviewMaterial(bank, cards, [], "quantdev", 2)), ["cf-k2", "cf-k1"]);
  assert.deepEqual(ids(R.pickInterviewMaterial(bank, cards, [], "quantdev", 3)), ["cf-k2", "cf-k1", "cf-u1"]);
  assert.deepEqual(ids(R.pickInterviewMaterial(bank, cards, [], "quantdev", 6)),
    ["cf-k2", "cf-k1", "cf-u1", "cf-u2", "cf-u4", "cf-u3"]);
});

test("spec §7 lowest mastery: carded items sort by interval ascending first", () => {
  // every later key (lapses, wrong, difficulty, bank order) points the other way
  const bank = [
    item("iv-15", "cpp", ["raii"], { difficulty: 1 }),
    item("iv-01", "systems", ["numa"], { difficulty: 5 }),
    item("iv-06", "cpp", ["raii"], { difficulty: 3 }),
  ];
  const cards = { "iv-15": card(15, 4), "iv-01": card(1, 0), "iv-06": card(6, 1) };
  const history = [
    hist(T - 3 * DAY, "iv-15", "auto", false, "again"),
    hist(T - 2 * DAY, "iv-15", "auto", false, "again"),
  ];
  assert.deepEqual(ids(R.pickInterviewMaterial(bank, cards, history, "quantdev", 3)), ["iv-01", "iv-06", "iv-15"]);
});

test("spec §7 most lapses: equal intervals sort by lapses descending", () => {
  const bank = [
    item("lp-0", "cpp", ["raii"], { difficulty: 1 }),
    item("lp-2", "systems", ["numa"], { difficulty: 5 }),
    item("lp-1", "cpp", ["raii"], { difficulty: 3 }),
  ];
  const cards = { "lp-0": card(1, 0), "lp-2": card(1, 2), "lp-1": card(1, 1) };
  const history = [ // lp-0 has the most wrong answers, which must not outrank lapses
    hist(T - 3 * DAY, "lp-0", "auto", false, "again"),
    hist(T - 2 * DAY, "lp-0", "auto", false, "again"),
    hist(T - 1 * DAY, "lp-0", "auto", false, "again"),
  ];
  assert.deepEqual(ids(R.pickInterviewMaterial(bank, cards, history, "quantdev", 3)), ["lp-2", "lp-1", "lp-0"]);
});

test("pickInterviewMaterial: then by wrong answers descending (auto incorrect, or self-graded again)", () => {
  const bank = [
    item("wr-0", "cpp", ["raii"], { difficulty: 1, type: "free" }),
    item("wr-1", "cpp", ["raii"], { difficulty: 2 }),
    item("wr-2", "systems", ["numa"], { difficulty: 3, type: "free" }),
    item("wr-3", "systems", ["numa"], { difficulty: 4 }),
  ];
  const cards = { "wr-0": card(1, 1), "wr-1": card(1, 1), "wr-2": card(1, 1), "wr-3": card(1, 1) };
  const t = i => T - (30 - i) * HOUR;
  const history = [
    // wr-0: three OK self grades, 0 wrong
    hist(t(0), "wr-0", "self", null, "good"), hist(t(1), "wr-0", "self", null, "hard"),
    hist(t(2), "wr-0", "self", null, "easy"),
    // wr-1: one wrong among five entries (more entries, fewer wrong)
    hist(t(3), "wr-1", "auto", false, "again"), hist(t(4), "wr-1", "auto", true, "good"),
    hist(t(5), "wr-1", "auto", true, "good"), hist(t(6), "wr-1", "auto", true, "hard"),
    hist(t(7), "wr-1", "auto", true, "good"),
    // wr-2: two self-graded again, plus one OK
    hist(t(8), "wr-2", "self", null, "again"), hist(t(9), "wr-2", "self", null, "again"),
    hist(t(10), "wr-2", "self", null, "good"),
    // wr-3: three wrong auto answers
    hist(t(11), "wr-3", "auto", false, "again"), hist(t(12), "wr-3", "auto", false, "again"),
    hist(t(13), "wr-3", "auto", false, "again"),
    // entries for items outside the pool or the bank are irrelevant
    hist(t(14), "pool-p1", "auto", false, "again"), hist(t(15), "ghost-item", "auto", false, "again"),
  ];
  assert.deepEqual(ids(R.pickInterviewMaterial(bank, cards, history, "quantdev", 4)),
    ["wr-3", "wr-2", "wr-1", "wr-0"]);
});

test("pickInterviewMaterial: remaining ties break by difficulty ascending, then bank order", () => {
  const bank = [
    item("df-3a", "cpp", ["raii"], { difficulty: 3 }),
    item("df-1", "systems", ["numa"], { difficulty: 1 }),
    item("df-3b", "cpp", ["raii"], { difficulty: 3 }),
    item("df-2", "systems", ["numa"], { difficulty: 2 }),
  ];
  const cards = { "df-3a": card(6), "df-1": card(6), "df-3b": card(6), "df-2": card(6) };
  assert.deepEqual(ids(R.pickInterviewMaterial(bank, cards, [], "quantdev", 4)), ["df-1", "df-2", "df-3a", "df-3b"]);
});

test("pickInterviewMaterial: trader picks the weakest carded item across its pool", () => {
  const bank = POOL_BANK;
  const cards = {
    "pool-p1": card(6, 0),
    "pool-b1": card(15, 0),
    "pool-f1": card(1, 2),   // EV finance item: lowest interval
    "pool-c1": card(0, 5),   // cpp: not in the trader pool
    "pool-s1": card(0, 5),   // statistics without expected-value: not in the pool
  };
  assert.deepEqual(ids(R.pickInterviewMaterial(bank, cards, [], "trader", 3)), ["pool-f1", "pool-p1", "pool-b1"]);
});

test("spec §7: pickInterviewMaterial is pure and deterministic (also accepts { items } and null inputs)", () => {
  const bank = POOL_BANK;
  const cards = { "pool-c1": card(6, 1), "pool-y1": card(1, 0), "pool-c2": card(6, 0) };
  const history = [hist(T - DAY, "pool-c2", "auto", false, "again")];
  const before = clone({ bank, cards, history });
  const a = R.pickInterviewMaterial(bank, cards, history, "quantdev", 3);
  const b = R.pickInterviewMaterial(bank, cards, history, "quantdev", 3);
  assert.deepEqual(a, b);
  assert.deepEqual(ids(a), ["pool-y1", "pool-c1", "pool-c2"]);
  assert.deepEqual({ bank, cards, history }, before, "inputs are not mutated");
  assert.deepEqual(R.pickInterviewMaterial({ items: bank }, cards, history, "quantdev", 3), a);
  assert.deepEqual(ids(R.pickInterviewMaterial(bank, null, null, "quantdev", 3)), ["pool-c1", "pool-c2", "pool-y1"]);
  assert.deepEqual(R.pickInterviewMaterial(null, cards, history, "quantdev", 3), []);
});

// ---------- 2. material block (§H6) ----------

const HEADER = "## Material: the user's weakest bank items — quiz these first, one at a time";

test("interviewMaterialBlock: empty list gives an empty string", () => {
  assert.equal(R.interviewMaterialBlock([]), "");
});

test("interviewMaterialBlock: header line plus one numbered line per item, whitespace collapsed", () => {
  const items = [
    item("mb-c1", "cpp", ["move-semantics", "value-categories"], {
      type: "free",
      prompt: "  When does a class\n\nlose its implicitly\tgenerated   move constructor?  ",
      answer: { value: "When it declares\n a destructor,\tcopy operation or move assignment.\n" },
    }),
    item("mb-y1", "systems", ["cache-hierarchy"], {
      type: "mcq",
      prompt: "Which cache level is usually the smallest?",
      answer: { choices: ["L3", "L2", "L1", "main memory"], correct: 2 },
    }),
    item("mb-p1", "probability", ["dice", "conditional"], {
      prompt: "Roll a fair die twice. Given the first roll is even, what is $P(\\text{sum} = 7)$?",
      answer: { value: "1/6" },
    }),
  ];
  const expected = [
    HEADER,
    "1. [cpp · move-semantics, value-categories] When does a class lose its implicitly generated move constructor? — reference answer: When it declares a destructor, copy operation or move assignment.",
    "2. [systems · cache-hierarchy] Which cache level is usually the smallest? — reference answer: L1",
    "3. [probability · dice, conditional] Roll a fair die twice. Given the first roll is even, what is $P(\\text{sum} = 7)$? — reference answer: 1/6",
  ].join("\n");
  assert.equal(R.interviewMaterialBlock(items), expected);
});

test("interviewMaterialBlock: prompts cut at 300 and answers at 200 characters with an ellipsis", () => {
  const p300 = "Q" + "x".repeat(298) + "?";                       // exactly 300: kept whole
  const p301 = "a".repeat(150) + "\n\n   " + "b".repeat(151);     // 302 after collapsing
  const a200 = "y".repeat(200);                                   // exactly 200: kept whole
  const a201 = "z".repeat(100) + " \t " + "w".repeat(101);        // 202 after collapsing
  const items = [
    item("cut-1", "cpp", ["raii"], { type: "free", prompt: p300, answer: { value: a201 } }),
    item("cut-2", "systems", ["numa"], { type: "free", prompt: p301, answer: { value: a200 } }),
  ];
  const lines = R.interviewMaterialBlock(items).split("\n");
  assert.equal(lines.length, 3);
  assert.equal(lines[0], HEADER);
  assert.equal(lines[1], `1. [cpp · raii] ${p300} — reference answer: ${"z".repeat(100)} ${"w".repeat(99)}…`);
  assert.equal(lines[2], `2. [systems · numa] ${"a".repeat(150)} ${"b".repeat(149)}… — reference answer: ${a200}`);
});

test("interviewMaterialBlock of the quantdev pick quizzes the weakest items first", () => {
  const bank = [
    item("qb-c1", "cpp", ["templates"], { prompt: "What is SFINAE used for?", type: "free", answer: { value: "Overload pruning." } }),
    item("qb-y1", "systems", ["branch-prediction"], { prompt: "Why is a sorted array faster to scan with a branch?", type: "free", answer: { value: "Predictable branches." } }),
  ];
  const cards = { "qb-c1": card(15), "qb-y1": card(1, 1) };
  const block = R.interviewMaterialBlock(R.pickInterviewMaterial(bank, cards, [], "quantdev", 3));
  assert.equal(block, [
    HEADER,
    "1. [systems · branch-prediction] Why is a sorted array faster to scan with a branch? — reference answer: Predictable branches.",
    "2. [cpp · templates] What is SFINAE used for? — reference answer: Overload pruning.",
  ].join("\n"));
});

// ---------- 2b. material on the committed fixture bank (spec §7; the unit-level side of e2e v4-16) ----------

// The merged fixture items in bank order (bank.json, then the cpp deck, then the systems deck).
function fixtureItems() {
  const dir = path.join(__dirname, "fixtures", "bank-mini");
  const read = f => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  return [...read("bank.json").items, ...read("decks/cpp.json").items, ...read("decks/systems.json").items];
}

// Independent oracle for items that tie on carded / interval / lapses / wrong: difficulty, then bank order.
const byDifficultyThenBank = list => list.map((it, i) => ({ it, i }))
  .sort((a, b) => a.it.difficulty - b.it.difficulty || a.i - b.i).map(x => x.it);

test("spec §7 on the fixture bank: quantdev draws on the cpp and systems decks, trader on probability, brainteaser and expected-value items", () => {
  const bank = fixtureItems();
  const quant = byDifficultyThenBank(bank.filter(it => it.area === "cpp" || it.area === "systems"));
  const trader = byDifficultyThenBank(bank.filter(it =>
    it.area === "probability" || it.area === "brainteaser" || it.topics.includes("expected-value")));
  assert.ok(trader.some(it => it.topics.includes("expected-value") && it.area !== "probability"),
    "the fixture has an expected-value item outside probability (§L2 rule 5)");
  assert.deepEqual(ids(R.pickInterviewMaterial(bank, {}, [], "quantdev", bank.length)), ids(quant));
  assert.deepEqual(ids(R.pickInterviewMaterial(bank, {}, [], "trader", bank.length)), ids(trader));
  assert.deepEqual(ids(R.pickInterviewMaterial({ items: bank }, null, null, "quantdev")), ids(quant.slice(0, 3)));
});

test("spec §7 material block on the fixture bank: graded weak cards first, then the easiest unseen card fills the list", () => {
  const bank = fixtureItems();
  const MOVE = "fixturecpp-s2-c1-724197d7";          // FX_CPP_FREE_MOVE
  const FALSE_SHARING = "fixturesys-s6-c1-b483ecba"; // FX_SYS_FREE_FALSESHARING
  const cards = { [MOVE]: card(1, 2), [FALSE_SHARING]: card(3, 0) };
  const picked = R.pickInterviewMaterial(bank, cards, [], "quantdev", 3);
  const filler = byDifficultyThenBank(bank.filter(it =>
    (it.area === "cpp" || it.area === "systems") && !(it.id in cards)))[0];
  assert.deepEqual(ids(picked), [MOVE, FALSE_SHARING, filler.id]);
  // the line format of §H6, with an oracle written here (not the module's own helpers)
  const flat = (s, n) => { const t = s.replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n) + "…" : t; };
  const ref = it => (it.type === "mcq" ? it.answer.choices[it.answer.correct] : it.answer.value);
  const line = (it, i) => `${i + 1}. [${it.area} · ${it.topics.join(", ")}] ${flat(it.prompt, 300)} — reference answer: ${flat(ref(it), 200)}`;
  const block = R.interviewMaterialBlock(picked);
  assert.equal(block, [HEADER, ...picked.map(line)].join("\n"));
  assert.ok(block.split("\n")[1].includes("What does `std::move` actually do at run time?"),
    "the quantdev material quotes the cpp fixture item's prompt (v4-16)");
});

// ---------- 3. Prep summary line (§H7, spec §9) ----------

test("spec §9 system prompt gains one Prep line: prepSummaryLine exact format", () => {
  const line = R.prepSummaryLine({
    scores: { overall: 41, coding: 30, probability: 62, cpp: null, systems: 12, mental: 70, oa: null, market: null, mocks: 55 },
    dueToday: 4,
    weakest: ["conditional", "bayes", "dice"],
  });
  assert.equal(line, "Prep: overall 41 · prob 62 · cpp n/a · sys 12 · due today 4 · weakest: conditional, bayes, dice");
  assert.match(line, PREP_LINE_RE);
});

test("prepSummaryLine: null scores print n/a and no weakest topics print none", () => {
  const line = R.prepSummaryLine({
    scores: { overall: null, coding: null, probability: null, cpp: null, systems: null, mental: null, oa: null, market: null, mocks: null },
    dueToday: 0,
    weakest: [],
  });
  assert.equal(line, "Prep: overall n/a · prob n/a · cpp n/a · sys n/a · due today 0 · weakest: none");
  assert.match(line, PREP_LINE_RE);
});

test("prepSummaryLine: zero scores print 0 (not n/a), one weakest topic, a single line", () => {
  const line = R.prepSummaryLine({
    scores: { overall: 0, coding: null, probability: 0, cpp: 100, systems: 0, mental: null, oa: null, market: null, mocks: null },
    dueToday: 17,
    weakest: ["order-statistics"],
  });
  assert.equal(line, "Prep: overall 0 · prob 0 · cpp 100 · sys 0 · due today 17 · weakest: order-statistics");
  assert.equal(line.includes("\n"), false);
  assert.match(line, PREP_LINE_RE);
});

// ---------- 4. Sunday review prep line (§H8, spec §9) ----------

const WK = {
  P1: item("wk-p1", "probability", ["dice"]),
  B1: item("wk-b1", "brainteaser", ["weighing"], { type: "free" }),
  S1: item("wk-s1", "statistics", ["regression"]),
  F1: item("wk-f1", "finance", ["options"], { type: "mcq" }),
  C1: item("wk-c1", "cpp", ["raii"], { type: "free" }),
  Y1: item("wk-y1", "systems", ["cache-hierarchy"], { type: "mcq" }),
};
const WK_BANK = [WK.P1, WK.B1, WK.S1, WK.F1, WK.C1, WK.Y1];

function nullInputs(over = {}) {
  return {
    bank: null, cards: null, history: null, lcSolves: null, nc150: null,
    practiceLog: null, oaRuns: null, mmRuns: null, facts: null, now: SUNDAY, ...over,
  };
}

test("spec §9 Sunday review: week totals from prepHistory and each score's change since last Sunday", () => {
  const history = [
    // before last Sunday
    hist(THEN - 3 * DAY, "wk-c1", "self", null, "good"),
    hist(THEN - 2 * DAY, "wk-c1", "self", null, "good"),
    hist(THEN - 2 * DAY + HOUR, "wk-p1", "auto", false, "again"),
    hist(THEN - 1 * DAY, "wk-c1", "self", null, "good"),
    // this week
    hist(THEN + 1 * DAY, "wk-c1", "self", null, "good"),
    hist(THEN + 2 * DAY, "wk-p1", "auto", true, "good"),
    hist(THEN + 2 * DAY + HOUR, "wk-b1", "self", null, "good"),
    hist(THEN + 3 * DAY, "wk-y1", "auto", true, "good"),
    hist(THEN + 3 * DAY + HOUR, "wk-s1", "auto", false, "again"),
    hist(THEN + 4 * DAY, "wk-f1", "auto", true, "good"),
    hist(THEN + 4 * DAY + HOUR, "wk-f1", "auto", true, "good"),
    hist(THEN + 5 * DAY, "ghost-item", "self", null, "good"), // not in the bank: ignored
  ];
  // the stored cards that grading the history above produces (SM-2 by hand, §D2)
  const cards = {
    "wk-c1": { ease: 2.5, interval: 38, due: THEN + 39 * DAY, reps: 4, lapses: 0, last: THEN + DAY, seen: THEN - 3 * DAY },
    "wk-p1": { ease: 2.3, interval: 1, due: THEN + 3 * DAY, reps: 1, lapses: 1, last: THEN + 2 * DAY, seen: THEN - 2 * DAY + HOUR },
    "wk-b1": { ease: 2.5, interval: 1, due: THEN + 3 * DAY + HOUR, reps: 1, lapses: 0, last: THEN + 2 * DAY + HOUR, seen: THEN + 2 * DAY + HOUR },
    "wk-y1": { ease: 2.5, interval: 1, due: THEN + 4 * DAY, reps: 1, lapses: 0, last: THEN + 3 * DAY, seen: THEN + 3 * DAY },
    "wk-s1": { ease: 2.3, interval: 0, due: THEN + 3 * DAY + HOUR + 600000, reps: 0, lapses: 1, last: THEN + 3 * DAY + HOUR, seen: THEN + 3 * DAY + HOUR },
    "wk-f1": { ease: 2.5, interval: 6, due: THEN + 10 * DAY + HOUR, reps: 2, lapses: 0, last: THEN + 4 * DAY + HOUR, seen: THEN + 4 * DAY },
  };
  const inputs = nullInputs({
    bank: WK_BANK,
    cards,
    history,
    lcSolves: [ // coding 28 on both sides: 30·(1200/2000) + 20·(1/2)
      { slug: "group-anagrams", title: "Group Anagrams", ts: THEN - 6 * DAY, difficulty: "Medium", secs: 1500, noAI: true },
      { slug: "top-k-frequent-elements", title: "Top K Frequent Elements", ts: THEN - 4 * DAY, difficulty: "Medium", secs: 2500 },
    ],
    practiceLog: [ // mental: mean(30, 40) = 35 → 58 last Sunday; mean(30, 40, 42) → 62 now
      { ts: THEN - 3 * DAY, track: "zetamac", amount: 30, unit: "score", note: "" },
      { ts: THEN - 1 * DAY, track: "zetamac", amount: 40, unit: "score", note: "" },
      { ts: THEN + 1 * DAY, track: "probability", amount: 3, unit: "problems", note: "prep" },
      { ts: THEN + 2 * DAY, track: "zetamac", amount: 42, unit: "score", note: "in-app" },
    ],
    mmRuns: [ // market: pooled edge/trade 4/4 → 100 last Sunday; 0/8 → 50 now
      { ts: THEN - DAY, scenario: "dice", seed: 1, pnl: 3, edge: 4, trades: 4, maxPos: 2, fairErrors: [0, 0, 0] },
      { ts: THEN + DAY, scenario: "dice", seed: 2, pnl: -3, edge: -4, trades: 4, maxPos: 3, fairErrors: [1, 0, 0] },
    ],
    facts: { // mocks: dsa 6 → 60 last Sunday; mean(dsa 6, trader 8) → 70 now
      interview_dsa_20261025: "Verdict: 6/10. Saved.",
      interview_trader_20261106: "Verdict: 8/10.",
      goal: "two problems a day",
    },
  });
  const before = clone(inputs);
  const line = R.prepWeeklyLine(inputs);
  assert.equal(line,
    "Prep week: 7 answered (prob 1 · brain 1 · stats 1 · fin 2 · cpp 1 · sys 1), auto-checked accuracy 80%. " +
    "Score change since last Sunday: overall 51 (+5) · coding 28 (0) · prob 20 (+20) · cpp 100 (+70) · " +
    "sys 30 (new) · mental 62 (+4) · oa n/a · market 50 (-50) · mocks 70 (+10).");
  assert.deepEqual(inputs, before, "inputs are not mutated");
  assert.equal(R.prepWeeklyLine(inputs), line, "deterministic");
});

test("prepWeeklyLine: the current side uses stored cards, last Sunday's side uses replayed cards", () => {
  // Three goods before last Sunday replay to interval 15 (mastery 0). The stored card says
  // interval 30 (mastery 1), e.g. after the history cap dropped older grades.
  const inputs = nullInputs({
    bank: [WK.C1],
    history: [
      hist(THEN - 3 * DAY, "wk-c1", "self", null, "good"),
      hist(THEN - 2 * DAY, "wk-c1", "self", null, "good"),
      hist(THEN - 1 * DAY, "wk-c1", "self", null, "good"),
    ],
    cards: { "wk-c1": { ease: 2.5, interval: 30, due: SUNDAY + 20 * DAY, reps: 5, lapses: 0, last: THEN - DAY, seen: THEN - 40 * DAY } },
  });
  assert.equal(R.prepWeeklyLine(inputs),
    "Prep week: 0 answered (prob 0 · brain 0 · stats 0 · fin 0 · cpp 0 · sys 0), auto-checked accuracy n/a. " +
    "Score change since last Sunday: overall 100 (+70) · coding n/a · prob n/a · cpp 100 (+70) · sys n/a · " +
    "mental n/a · oa n/a · market n/a · mocks n/a.");
});

test("prepWeeklyLine: the week is (now − 7 days, now]; an entry at exactly last Sunday counts only for the old score", () => {
  const inputs = nullInputs({
    bank: [WK.P1],
    history: [
      hist(THEN, "wk-p1", "auto", true, "good"),
      hist(SUNDAY, "wk-p1", "auto", false, "again"),
    ],
    cards: { "wk-p1": { ease: 2.3, interval: 0, due: SUNDAY + 600000, reps: 0, lapses: 1, last: SUNDAY, seen: THEN } },
  });
  assert.equal(R.prepWeeklyLine(inputs),
    "Prep week: 1 answered (prob 1 · brain 0 · stats 0 · fin 0 · cpp 0 · sys 0), auto-checked accuracy 0%. " +
    "Score change since last Sunday: overall 20 (-20) · coding n/a · prob 20 (-20) · cpp n/a · sys n/a · " +
    "mental n/a · oa n/a · market n/a · mocks n/a.");
});

test("prepWeeklyLine: accuracy is over auto-checked entries only, rounded to a whole percent", () => {
  const h = i => THEN + DAY + i * HOUR;
  const base = {
    bank: WK_BANK,
    history: [
      hist(h(0), "wk-p1", "auto", true, "good"),
      hist(h(1), "wk-s1", "auto", false, "again"),
      hist(h(2), "wk-f1", "auto", true, "good"),
      hist(h(3), "wk-b1", "self", null, "again"),
      hist(h(4), "wk-c1", "self", null, "good"),
    ],
  };
  const line = R.prepWeeklyLine(nullInputs(base));
  assert.ok(line.startsWith("Prep week: 5 answered (prob 1 · brain 1 · stats 1 · fin 1 · cpp 1 · sys 0), auto-checked accuracy 67%. Score change since last Sunday: "), line);
  const selfOnly = R.prepWeeklyLine(nullInputs({ bank: WK_BANK, history: base.history.slice(3) }));
  assert.ok(selfOnly.startsWith("Prep week: 2 answered (prob 0 · brain 1 · stats 0 · fin 0 · cpp 1 · sys 0), auto-checked accuracy n/a. "), selfOnly);
});

test("prepWeeklyLine: no data at all gives zero totals and n/a everywhere", () => {
  assert.equal(R.prepWeeklyLine(nullInputs()),
    "Prep week: 0 answered (prob 0 · brain 0 · stats 0 · fin 0 · cpp 0 · sys 0), auto-checked accuracy n/a. " +
    "Score change since last Sunday: overall n/a · coding n/a · prob n/a · cpp n/a · sys n/a · " +
    "mental n/a · oa n/a · market n/a · mocks n/a.");
});

// ---------- 5. buddy drills (§H9, §J8, spec §9) ----------

const BANK_TOPICS = ["bayes", "conditional", "conditional-probability", "dice", "move-semantics"];

test("spec §9 assign_drill stores a pending drill: amDrillEntry stored shape", () => {
  const args = { area: "probability", topics: ["conditional-probability"], count: 10 };
  const before = clone(args);
  const e = R.amDrillEntry(args, T, BANK_TOPICS);
  assert.deepEqual(e, {
    id: "drill-" + T, ts: T, area: "probability", topics: ["conditional-probability"], count: 10,
    status: "pending", done: 0, correct: 0, doneTs: null,
  });
  assert.deepEqual(args, before, "args are not mutated");
  assert.equal(R.drillBannerText(e), "Buddy drill: 10 conditional-probability items");
});

test("amDrillEntry normalises the area and accepts numeric-string counts", () => {
  const e = R.amDrillEntry({ area: "  CPP ", count: "10" }, T, BANK_TOPICS);
  assert.equal(e.error, undefined);
  assert.equal(e.area, "cpp");
  assert.strictEqual(e.count, 10);
  assert.deepEqual(e.topics, []);
  assert.deepEqual(R.amDrillEntry({ area: "systems", count: 3, topics: null }, T, BANK_TOPICS).topics, []);
  assert.deepEqual(R.amDrillEntry({ area: "systems", count: 3, topics: [] }, T, BANK_TOPICS).topics, []);
});

test("spec §9: area must be a known area (keyword area)", () => {
  for (const args of [
    { area: "geometry", count: 5 }, { area: "", count: 5 }, { count: 5 }, { area: "probabilities", count: 5 },
    null, undefined, "probability", 7,
  ]) {
    const r = R.amDrillEntry(args, T, BANK_TOPICS);
    assert.equal(typeof r.error, "string", JSON.stringify(args));
    assert.ok(r.error.length > 0);
    assert.match(r.error, /area/i);
  }
});

test("spec §9: count must be an integer from 1 to 50 (keyword count)", () => {
  for (const count of [1, 50, "1", "50", 25]) {
    const r = R.amDrillEntry({ area: "finance", count }, T, null);
    assert.equal(r.error, undefined, `count ${count}`);
    assert.strictEqual(r.count, Number(count));
  }
  for (const count of [0, 51, -3, 2.5, "2.5", "lots", undefined, null, NaN, Infinity, ""]) {
    const r = R.amDrillEntry({ area: "finance", count }, T, null);
    assert.equal(typeof r.error, "string", `count ${String(count)}`);
    assert.match(r.error, /count/i);
  }
});

test("spec §9: topics must exist in the bank (keyword topic, unknown topics listed)", () => {
  const r = R.amDrillEntry({ area: "probability", topics: ["dice", "martingales", "kelly-criterion"], count: 5 }, T, BANK_TOPICS);
  assert.equal(typeof r.error, "string");
  assert.match(r.error, /topic/i);
  assert.ok(r.error.includes("martingales") && r.error.includes("kelly-criterion"), r.error);
  // known topics are checked after trimming and lowercasing
  const ok = R.amDrillEntry({ area: "probability", topics: [" Bayes ", "DICE"], count: 5 }, T, BANK_TOPICS);
  assert.deepEqual(ok.topics, ["bayes", "dice"]);
  // a loaded bank with no such topics rejects any topic
  assert.match(R.amDrillEntry({ area: "cpp", topics: ["raii"], count: 2 }, T, []).error, /topic/i);
});

test("spec §9: with no bank loaded, topics are accepted unchecked (filtered later)", () => {
  for (const bankTopics of [null, undefined]) {
    const e = R.amDrillEntry({ area: "cpp", topics: ["Lock-Free", "memory-order"], count: 4 }, T, bankTopics);
    assert.equal(e.error, undefined);
    assert.deepEqual(e.topics, ["lock-free", "memory-order"]);
    assert.equal(e.status, "pending");
    // the stored topics are kept as given (normalised), so the banner shows them (§H9)
    assert.equal(R.drillBannerText(e), "Buddy drill: 4 lock-free, memory-order items");
  }
  // the two-argument call is the no-bank case too
  assert.deepEqual(R.amDrillEntry({ area: "cpp", topics: ["anything-goes"], count: 4 }, T).topics, ["anything-goes"]);
});

test("amDrillEntry topics: array of kebab-case strings, deduplicated in order, at most 10", () => {
  const bad = [
    "conditional", [5], ["two words"], ["snake_case"], ["-leading"], ["trailing-"], [""], [null], { 0: "dice" },
  ];
  for (const topics of bad) {
    const r = R.amDrillEntry({ area: "probability", topics, count: 3 }, T, null);
    assert.equal(typeof r.error, "string", JSON.stringify(topics));
    assert.match(r.error, /topic/i);
  }
  const dedup = R.amDrillEntry({ area: "probability", topics: ["dice", "bayes", "DICE", " bayes"], count: 3 }, T, BANK_TOPICS);
  assert.deepEqual(dedup.topics, ["dice", "bayes"]);
  const ten = Array.from({ length: 10 }, (_, i) => `topic-${i}`);
  assert.deepEqual(R.amDrillEntry({ area: "statistics", topics: ten, count: 3 }, T, null).topics, ten);
  const eleven = Array.from({ length: 11 }, (_, i) => `topic-${i}`);
  assert.match(R.amDrillEntry({ area: "statistics", topics: eleven, count: 3 }, T, null).error, /topic/i);
});

test("assign_drill schema (§J8) bounds agree with amDrillEntry", () => {
  const schemaAreas = ["probability", "brainteaser", "statistics", "finance", "cpp", "systems"];
  for (const area of schemaAreas) {
    for (const count of [1, 50]) {
      const e = R.amDrillEntry({ area, count }, T, BANK_TOPICS);
      assert.equal(e.error, undefined, `${area} ${count}`);
      assert.equal(e.area, area);
    }
    assert.match(R.amDrillEntry({ area, count: 0 }, T, BANK_TOPICS).error, /count/i);
    assert.match(R.amDrillEntry({ area, count: 51 }, T, BANK_TOPICS).error, /count/i);
  }
});

test("drill labels: topics joined by comma, or the area when there are none", () => {
  const multi = R.amDrillEntry({ area: "probability", topics: ["bayes", "conditional"], count: 6 }, T, BANK_TOPICS);
  assert.equal(R.drillLabel(multi), "bayes, conditional");
  assert.equal(R.drillBannerText(multi), "Buddy drill: 6 bayes, conditional items");
  const areaOnly = R.amDrillEntry({ area: "systems", count: 5 }, T, BANK_TOPICS);
  assert.equal(R.drillLabel(areaOnly), "systems");
  assert.equal(R.drillBannerText(areaOnly), "Buddy drill: 5 systems items");
});

test("spec §9 finishing a drill writes a note the buddy sees: drillAdvance, drillPromptLine", () => {
  const d0 = R.amDrillEntry({ area: "probability", topics: ["conditional"], count: 2 }, T, BANK_TOPICS);
  assert.equal(R.drillPromptLine(d0, T + HOUR), "Buddy drill pending in Prep: 2 conditional items.");
  const snap = clone(d0);
  const d1 = R.drillAdvance(d0, true, T + 2 * HOUR);
  assert.deepEqual(d0, snap, "drillAdvance does not mutate");
  assert.deepEqual(d1, { ...d0, done: 1, correct: 1 });
  assert.equal(R.drillPromptLine(d1, T + 3 * HOUR), "Buddy drill pending in Prep: 2 conditional items.");
  const doneTs = T + 4 * HOUR;
  const d2 = R.drillAdvance(d1, false, doneTs);
  assert.deepEqual(d2, { ...d0, done: 2, correct: 1, status: "done", doneTs });
  assert.deepEqual(R.drillAdvance(d2, true, doneTs + HOUR), d2, "a done drill is unchanged");
  assert.deepEqual(R.drillFinish(d2, doneTs + HOUR), d2, "a done drill is unchanged");
  assert.equal(R.drillPromptLine(d2, doneTs + HOUR), "Buddy drill finished: 2/2 conditional items, 1 correct.");
  assert.equal(R.drillPromptLine(d2, doneTs + 48 * HOUR), "Buddy drill finished: 2/2 conditional items, 1 correct.");
  assert.equal(R.drillPromptLine(d2, doneTs + 48 * HOUR + 1), "");
});

test("drillFinish ends a drill early when the queue runs out; no drill gives no prompt line", () => {
  const d0 = R.amDrillEntry({ area: "cpp", count: 3 }, T, null);
  const d1 = R.drillAdvance(d0, true, T + HOUR);
  const fin = R.drillFinish(d1, T + 2 * HOUR);
  assert.deepEqual(fin, { ...d0, done: 1, correct: 1, status: "done", doneTs: T + 2 * HOUR });
  assert.equal(R.drillPromptLine(fin, T + 3 * HOUR), "Buddy drill finished: 1/3 cpp items, 1 correct.");
  const empty = R.drillFinish(d0, T + HOUR);
  assert.equal(R.drillPromptLine(empty, T + 2 * HOUR), "Buddy drill finished: 0/3 cpp items, 0 correct.");
  assert.equal(R.drillPromptLine(null, T), "");
  assert.equal(R.drillPromptLine(undefined, T), "");
  // a pending drill is reported however old it is
  assert.equal(R.drillPromptLine(d0, T + 30 * DAY), "Buddy drill pending in Prep: 3 cpp items.");
});

// ---------- 6. practice-log integration (§H10, spec §2) ----------

test("practiceTrack maps the four practice areas to probability and the two deck areas to cpp", () => {
  for (const a of ["probability", "brainteaser", "statistics", "finance"]) assert.equal(R.practiceTrack(a), "probability", a);
  for (const a of ["cpp", "systems"]) assert.equal(R.practiceTrack(a), "cpp", a);
  for (const a of ["geometry", "", "zetamac", "leetcode", null, undefined]) assert.equal(R.practiceTrack(a), null, String(a));
});

test("sessionPracticeEntries: probability problems and whole cpp minutes, probability first", () => {
  assert.deepEqual(R.sessionPracticeEntries({ probItems: 0, cppSecs: 0 }, T), []);
  assert.deepEqual(R.sessionPracticeEntries({ probItems: 3, cppSecs: 0 }, T),
    [{ ts: T, track: "probability", amount: 3, unit: "problems", note: "prep" }]);
  assert.deepEqual(R.sessionPracticeEntries({ probItems: 0, cppSecs: 59 }, T), []);
  assert.deepEqual(R.sessionPracticeEntries({ probItems: 0, cppSecs: 60 }, T),
    [{ ts: T, track: "cpp", amount: 1, unit: "minutes", note: "prep cards" }]);
  assert.deepEqual(R.sessionPracticeEntries({ probItems: 2, cppSecs: 179 }, T), [
    { ts: T, track: "probability", amount: 2, unit: "problems", note: "prep" },
    { ts: T, track: "cpp", amount: 2, unit: "minutes", note: "prep cards" },
  ]);
});

test("spec §2: each answered probability, brainteaser, statistics or finance item adds 1 to probability", () => {
  const start = T;
  const others = [
    { ts: T - DAY, track: "zetamac", amount: 41, unit: "score", note: "" },
    // same ts and track as the session entry, but a different note: never replaced
    { ts: T, track: "probability", amount: 2, unit: "problems", note: "Green Book ch.1" },
  ];
  let log = clone(others);
  let probItems = 0;
  ["probability", "brainteaser", "statistics", "finance", "probability"].forEach((area, i) => {
    if (R.practiceTrack(area) === "probability") probItems += 1;
    for (const e of R.sessionPracticeEntries({ probItems, cppSecs: 0 }, start)) log = R.upsertSessionEntry(log, e);
    const mine = log.filter(e => e.note === "prep");
    assert.equal(mine.length, 1, "at most one entry per session");
    assert.deepEqual(mine[0], { ts: start, track: "probability", amount: i + 1, unit: "problems", note: "prep" });
  });
  assert.equal(log.length, 3);
  assert.deepEqual(log.slice(0, 2), others);
});

test("spec §2: C++ and systems time adds whole minutes to cpp, batched into one entry per session", () => {
  const start = T + HOUR;
  let log = [];
  let cppSecs = 0;
  const seen = [];
  for (const [area, secs] of [["cpp", 50], ["systems", 700], ["cpp", 30], ["systems", 10]]) {
    assert.equal(R.practiceTrack(area), "cpp");
    cppSecs += Math.min(secs, 600); // the per-item 600 s cap of §H10
    for (const e of R.sessionPracticeEntries({ probItems: 0, cppSecs }, start)) log = R.upsertSessionEntry(log, e);
    seen.push(log.map(e => e.amount));
  }
  // 50 s → nothing yet; 650 s → 10 min; 680 s → 11 min; 690 s → 11 min
  assert.deepEqual(seen, [[], [10], [11], [11]]);
  assert.deepEqual(log, [{ ts: start, track: "cpp", amount: 11, unit: "minutes", note: "prep cards" }]);
  // a second session gets its own entry
  const start2 = T + 5 * HOUR;
  for (const e of R.sessionPracticeEntries({ probItems: 1, cppSecs: 120 }, start2)) log = R.upsertSessionEntry(log, e);
  assert.deepEqual(log, [
    { ts: start, track: "cpp", amount: 11, unit: "minutes", note: "prep cards" },
    { ts: start2, track: "probability", amount: 1, unit: "problems", note: "prep" },
    { ts: start2, track: "cpp", amount: 2, unit: "minutes", note: "prep cards" },
  ]);
});

test("upsertSessionEntry replaces in place on equal ts, track and note, appends otherwise, never mutates", () => {
  const a = { ts: T - DAY, track: "cpp", amount: 30, unit: "minutes", note: "Effective Modern C++ notes" };
  const old = { ts: T, track: "cpp", amount: 3, unit: "minutes", note: "prep cards" };
  const b = { ts: T + HOUR, track: "zetamac", amount: 44, unit: "score", note: "" };
  const log = [a, old, b];
  const snap = clone(log);
  const upd = { ts: T, track: "cpp", amount: 4, unit: "minutes", note: "prep cards" };
  assert.deepEqual(R.upsertSessionEntry(log, upd), [a, upd, b]);
  assert.deepEqual(log, snap, "input not mutated");
  const otherTs = { ...upd, ts: T + 1 };
  assert.deepEqual(R.upsertSessionEntry(log, otherTs), [a, old, b, otherTs]);
  const otherTrack = { ts: T, track: "probability", amount: 1, unit: "problems", note: "prep cards" };
  assert.deepEqual(R.upsertSessionEntry(log, otherTrack), [a, old, b, otherTrack]);
  assert.deepEqual(R.upsertSessionEntry(null, upd), [upd]);
});

test("upsertSessionEntry keeps the practice log capped at PRACTICE_LOG_CAP (2000)", () => {
  assert.equal(R.PRACTICE_LOG_CAP, 2000);
  const full = Array.from({ length: 2000 }, (_, i) => ({ ts: T - (2000 - i) * 60000, track: "cpp", amount: 1, unit: "minutes", note: "x" }));
  const fresh = { ts: T, track: "probability", amount: 1, unit: "problems", note: "prep" };
  const appended = R.upsertSessionEntry(full, fresh);
  assert.equal(appended.length, 2000);
  assert.deepEqual(appended[0], full[1], "the oldest entry is dropped");
  assert.deepEqual(appended[1999], fresh);
  const replacement = { ...full[1500], amount: 9 };
  const replaced = R.upsertSessionEntry(full, replacement);
  assert.equal(replaced.length, 2000);
  assert.deepEqual(replaced[0], full[0], "a replacement drops nothing");
  assert.deepEqual(replaced[1500], replacement);
});

const ARITH_DEFAULT = { ops: ["add", "sub", "mul", "div"], addA: [2, 100], addB: [2, 100], mulA: [2, 12], mulB: [2, 100], durationSecs: 120 };
const arithRun = (over = {}) => ({ ts: T, kind: "arith", seed: 42, score: 37, total: 37, secs: 120, config: clone(ARITH_DEFAULT), ...over });

test("spec §2: the in-app game with the Zetamac default config writes a zetamac entry with note in-app", () => {
  assert.deepEqual(OA.zetamacEntry(arithRun()), { ts: T, track: "zetamac", amount: 37, unit: "score", note: "in-app" });
  assert.deepEqual(OA.zetamacEntry(arithRun({ score: 0, total: 0 })), { ts: T, track: "zetamac", amount: 0, unit: "score", note: "in-app" });
  // UI strings and a different op order normalise to the default config
  const stringy = { ops: ["div", "mul", "sub", "add"], addA: ["2", "100"], addB: ["2", "100"], mulA: ["2", "12"], mulB: ["2", "100"], durationSecs: "120" };
  assert.deepEqual(OA.zetamacEntry(arithRun({ config: stringy })), { ts: T, track: "zetamac", amount: 37, unit: "score", note: "in-app" });
});

test("zetamacEntry: non-default configs, other kinds and bad scores write nothing", () => {
  const nonDefault = [
    { ...ARITH_DEFAULT, durationSecs: 60 },
    { ...ARITH_DEFAULT, ops: ["add", "sub"] },
    { ...ARITH_DEFAULT, mulA: [2, 20] },
    { ...ARITH_DEFAULT, addB: [2, 1000] },
  ];
  for (const config of nonDefault) assert.equal(OA.zetamacEntry(arithRun({ config })), null, JSON.stringify(config));
  assert.equal(OA.zetamacEntry({ ts: T, kind: "eighty", seed: 1, score: 50, total: 80, secs: 480, config: { negativeMarking: false } }), null);
  assert.equal(OA.zetamacEntry({ ts: T, kind: "ev", seed: 1, score: 12, total: 20, secs: 300, config: {} }), null);
  for (const score of [-1, 2.5, NaN]) assert.equal(OA.zetamacEntry(arithRun({ score })), null, String(score));
});

test("spec §2: prep writes only the existing six tracks, as entries amPracticeEntry accepts", () => {
  assert.deepEqual(Object.keys(P.AM_TRACKS).sort(), ["cpp", "leetcode", "mock", "probability", "project", "zetamac"]);
  const areas = ["probability", "brainteaser", "statistics", "finance", "cpp", "systems"];
  for (const a of areas) assert.ok(["probability", "cpp"].includes(R.practiceTrack(a)), a);
  const entries = [
    ...R.sessionPracticeEntries({ probItems: 7, cppSecs: 1500 }, T),
    OA.zetamacEntry(arithRun({ score: 48 })),
  ];
  assert.equal(entries.length, 3);
  for (const e of entries) {
    assert.ok(e && e.track in P.AM_TRACKS, JSON.stringify(e));
    assert.equal(e.unit, P.AM_TRACKS[e.track].unit);
    assert.deepEqual(P.amPracticeEntry({ track: e.track, amount: e.amount, note: e.note }, e.ts), e);
  }
});

// ---------- 7. "Check my reasoning" request (§H11, spec §1 D2) ----------

test("spec §1 D2: Check my reasoning sends the working, the item and its solution to the configured model", () => {
  assert.equal(R.REASONING_MARKER, "[Check my reasoning]");
  const it = item("rr-p1", "probability", ["dice", "order-statistics"], {
    prompt: "Two fair dice are rolled. What is $P(\\max = 5)$?",
    answer: { value: "9/36" },
    solution: "$P(\\max \\le 5) - P(\\max \\le 4) = 25/36 - 16/36$.",
  });
  const snap = clone(it);
  const body = R.reasoningRequest(it, "max at most 5 minus max at most 4", "1/4", "openai/gpt-test");
  assert.deepEqual(it, snap, "item not mutated");
  assert.equal(body.model, "openai/gpt-test");
  assert.equal(body.stream, true);
  assert.equal("tools" in body, false);
  assert.equal(body.messages.length, 2);
  assert.equal(body.messages[0].role, "system");
  assert.equal(typeof body.messages[0].content, "string");
  assert.ok(body.messages[0].content.trim().length > 0);
  assert.deepEqual(body.messages[1], {
    role: "user",
    content: "[Check my reasoning]\nItem: rr-p1\n\n## Problem\nTwo fair dice are rolled. What is $P(\\max = 5)$?" +
      "\n\n## My working\nmax at most 5 minus max at most 4\n\n## My answer\n1/4" +
      "\n\n## Reference answer\n9/36\n\n## Reference solution\n$P(\\max \\le 5) - P(\\max \\le 4) = 25/36 - 16/36$.",
  });
  assert.deepEqual(R.reasoningRequest(it, "max at most 5 minus max at most 4", "1/4", "openai/gpt-test"), body, "deterministic");
});

test("reasoningRequest: default model, (none) placeholders, mcq and free reference answers", () => {
  const mcq = item("rr-y1", "systems", ["cache-hierarchy"], {
    type: "mcq",
    prompt: "Which level is closest to the core?",
    answer: { choices: ["L3", "L1", "L2"], correct: 1 },
    solution: "L1 sits next to the core.",
  });
  for (const model of [undefined, null, ""]) {
    const body = R.reasoningRequest(mcq, "", "L2", model);
    assert.equal(body.model, "anthropic/claude-haiku-5.5");
    const user = body.messages[body.messages.length - 1];
    assert.equal(user.role, "user");
    assert.ok(user.content.startsWith("[Check my reasoning]"), "the e2e mock matches lastUser(b).startsWith(marker)");
    assert.equal(user.content,
      "[Check my reasoning]\nItem: rr-y1\n\n## Problem\nWhich level is closest to the core?\n\n## My working\n(none)" +
      "\n\n## My answer\nL2\n\n## Reference answer\nL1\n\n## Reference solution\nL1 sits next to the core.");
  }
  const free = item("rr-b1", "brainteaser", ["weighing"], {
    type: "free",
    prompt: "How many weighings find one light coin among 27?",
    answer: { value: "Three: split into thirds each time." },
    solution: "Each weighing has three outcomes and 3^3 = 27.",
  });
  const fb = R.reasoningRequest(free, "Split 9/9/9, then 3/3/3, then 1/1/1.", "", "x/y");
  assert.equal(fb.messages[1].content,
    "[Check my reasoning]\nItem: rr-b1\n\n## Problem\nHow many weighings find one light coin among 27?" +
    "\n\n## My working\nSplit 9/9/9, then 3/3/3, then 1/1/1.\n\n## My answer\n(none)" +
    "\n\n## Reference answer\nThree: split into thirds each time.\n\n## Reference solution\nEach weighing has three outcomes and 3^3 = 27.");
  assert.ok(fb.messages[1].content.includes("(none)"));
  assert.equal(R.reasoningRequest(free, null, undefined, "x/y").messages[1].content.includes("## My working\n(none)\n\n## My answer\n(none)"), true);
});
