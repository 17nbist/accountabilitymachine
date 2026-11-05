// v4 prep/srs.js (PrepSrs): the SM-2 scheduler, auto-grading, interval labels, the session and
// drill queues, and the mastery / replay / due-count helpers. V4-CONTRACTS §D (spec §3 F1.3),
// plus the purity rules of §A3. Run with `npm test` (Node's built-in runner).
//
// Every expected value is written out by hand or computed by the small oracles in this file
// (written from the contract text), never by the module's own helpers. Ease is compared with a
// 1e-9 tolerance (§D1); intervals, reps, lapses and times are integers and compared exactly.
// Random cases skip raw values within 1e-6 of x.5, so float order of operations never matters.
const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../prep/srs.js");

const DAY = 86400000;
const MINUTE = 60000;
const HOUR = 3600000;
const now = new Date(2026, 10, 4, 15, 0, 0); // Wed 4 Nov 2026 15:00 local
const T = now.getTime();
const TODAY0 = new Date(2026, 10, 4).getTime(); // local midnight that starts today
const TOMORROW0 = new Date(2026, 10, 5).getTime();
const DAY_AFTER0 = new Date(2026, 10, 6).getTime();

const AREAS = ["probability", "brainteaser", "statistics", "finance", "cpp", "systems"];
const AREA_ORDER = ["probability", "brainteaser", "cpp", "systems", "statistics", "finance"];
const GRADES = ["again", "hard", "good", "easy"];
const CARD_KEYS = ["due", "ease", "interval", "lapses", "last", "reps", "seen"];
const DEFAULTS = { newPerDay: 15, reviewCap: 150, areas: AREAS };

const EXPORTS = [
  "DAY", "MINUTE", "AREA_ORDER", "GRADES", "MAX_INTERVAL", "AGAIN_DELAY_MS", "DEFAULT_SETTINGS",
  "normalizeSettings", "newCard", "schedule", "nextIntervals", "gradeLabels", "targetSecs",
  "autoGrade", "answerOk", "buildQueue", "drillQueue", "masteryOf", "replayCards",
  "localDayStart", "dueCount",
];
const FUNCTIONS = EXPORTS.filter((k) => /^[a-z]/.test(k));

// ---------- helpers ----------

function near(actual, expected, msg) {
  assert.ok(typeof actual === "number" && Math.abs(actual - expected) <= 1e-9 * Math.max(1, Math.abs(expected)),
    `${msg || "value"}: expected ${expected}, got ${actual}`);
}

// Integers and times exactly, ease with the §D1 tolerance.
function assertCard(actual, expected, msg = "card") {
  assert.ok(actual && typeof actual === "object", `${msg}: not an object`);
  for (const k of ["interval", "due", "reps", "lapses", "last", "seen"]) {
    assert.equal(actual[k], expected[k], `${msg}: ${k}`);
  }
  near(actual.ease, expected.ease, `${msg}: ease`);
}

function item(id, area, difficulty = 1, topics = ["misc"]) {
  return {
    id, area, topics, difficulty, type: "numeric",
    prompt: `Synthetic prompt for ${id}.`,
    answer: { value: "1" },
    source: { key: "synth", title: "Synthetic Notes", file: "synth.pdf", page: 1 },
  };
}

// A graded card due at `due`, introduced long before today unless `over` says otherwise.
function card(due, over = {}) {
  return { ease: 2.5, interval: 3, due, reps: 2, lapses: 0, last: T - 10 * DAY, seen: T - 20 * DAY, ...over };
}

function clone(x) {
  return x === undefined ? undefined : JSON.parse(JSON.stringify(x));
}

// Seeded generator for random cases (an LCG, deliberately not PrepRng).
function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const ri = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
const pickOf = (r, arr) => arr[Math.floor(r() * arr.length)];

// ---------- independent oracles (written from §D, not from the module) ----------

function nearHalf(x) {
  return Math.abs(x - Math.floor(x) - 0.5) < 1e-6;
}

// §D2 for a complete card. Returns null when a raw value this grade rounds sits on a rounding
// boundary (interval * 1.2 for an integer interval never does).
function refSchedule(c, grade, t) {
  const usesProduct = c.reps >= 2 && (grade === "good" || grade === "easy");
  if (usesProduct && nearHalf(c.interval * c.ease)) return null;
  const g = c.reps === 0 ? 1 : c.reps === 1 ? 6 : Math.round(c.interval * c.ease);
  if (grade === "easy" && nearHalf(g * 1.3)) return null;
  const out = { ease: c.ease, interval: 0, due: 0, reps: c.reps + 1, lapses: c.lapses, last: t, seen: c.seen == null ? t : c.seen };
  if (grade === "again") {
    out.ease = Math.max(1.3, c.ease - 0.2);
    out.reps = 0;
    out.lapses = c.lapses + 1;
    out.due = t + 600000;
    return out;
  }
  if (grade === "hard") {
    out.ease = Math.max(1.3, c.ease - 0.15);
    out.interval = Math.min(365, Math.max(1, Math.round(c.interval * 1.2)));
  } else if (grade === "good") {
    out.interval = Math.min(365, g);
  } else {
    out.interval = Math.min(365, Math.round(g * 1.3));
    out.ease = c.ease + 0.15;
  }
  out.due = t + out.interval * DAY;
  return out;
}

function refDayStart(ts, k = 0) {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + k).getTime();
}

function byDueThenId(a, b) {
  return a.due - b.due || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function byDifficultyThenBank(a, b) {
  return a.difficulty - b.difficulty || a.idx - b.idx;
}

// §D8: per-area sublists in AREA_ORDER, one from each per round.
function refRobin(list) {
  const subs = AREA_ORDER.map((a) => list.filter((x) => x.area === a));
  const rounds = Math.max(0, ...subs.map((s) => s.length));
  const out = [];
  for (let i = 0; i < rounds; i++) for (const s of subs) if (i < s.length) out.push(s[i]);
  return out;
}

function hasTopic(it, topics) {
  return !(Array.isArray(topics) && topics.length) || it.topics.some((x) => topics.includes(x));
}

// §D6 for banks with unique ids and valid settings.
function refQueue(bank, cards, t, settings, topics) {
  const areas = new Set(settings.areas);
  const cand = [];
  let seenToday = 0;
  const lo = refDayStart(t), hi = refDayStart(t, 1);
  bank.forEach((it, idx) => {
    if (!areas.has(it.area)) return;
    const c = cards[it.id];
    if (c && typeof c.seen === "number" && c.seen >= lo && c.seen < hi) seenToday++;
    if (!hasTopic(it, topics)) return;
    cand.push({ id: it.id, area: it.area, difficulty: it.difficulty, idx, due: c && Number.isFinite(c.due) ? c.due : null });
  });
  const reviews = cand.filter((x) => x.due !== null && x.due <= t).sort(byDueThenId).slice(0, settings.reviewCap);
  const fresh = cand.filter((x) => x.due === null).sort(byDifficultyThenBank);
  const limit = Math.max(0, settings.newPerDay - seenToday);
  return refRobin(reviews).concat(refRobin(fresh).slice(0, limit)).map((x) => x.id);
}

// §D7 for banks with unique ids and known areas.
function refDrill(bank, cards, t, drill) {
  const cand = [];
  bank.forEach((it, idx) => {
    if (typeof drill.area === "string" && it.area !== drill.area) return;
    if (!hasTopic(it, drill.topics)) return;
    const c = cards[it.id];
    cand.push({ id: it.id, area: it.area, difficulty: it.difficulty, idx, due: c && Number.isFinite(c.due) ? c.due : null });
  });
  const a = cand.filter((x) => x.due !== null && x.due <= t).sort(byDueThenId);
  const b = cand.filter((x) => x.due === null).sort(byDifficultyThenBank);
  const c = cand.filter((x) => x.due !== null && x.due > t).sort(byDueThenId);
  return a.concat(b, c).slice(0, drill.count).map((x) => x.id);
}

// Random bank + cards around `now`: due times on a 6-hour grid (so ties and due === now occur),
// seen times either earlier today or on an earlier day, plus cards for ids not in the bank.
function randomSession(r, { knownAreasOnly = false } = {}) {
  const n = ri(r, 0, 36);
  const areaPool = knownAreasOnly ? AREAS : [...AREAS, ...AREAS, "chess"];
  const topicPool = ["alpha", "beta", "gamma", "delta"];
  const letters = "abcdefghij";
  const bank = [];
  const cards = {};
  for (let i = 0; i < n; i++) {
    const id = `${pickOf(r, letters)}${pickOf(r, letters)}-${i}`;
    const topics = topicPool.filter(() => r() < 0.4);
    if (!topics.length) topics.push(pickOf(r, topicPool));
    bank.push(item(id, pickOf(r, areaPool), ri(r, 1, 5), topics));
    const roll = r();
    if (roll < 0.55) {
      const due = T + ri(r, -12, 12) * 6 * HOUR;
      const seen = r() < 0.3 ? TODAY0 + ri(r, 0, 14) * HOUR : T - ri(r, 1, 30) * DAY;
      cards[id] = { ease: 2.5, interval: ri(r, 0, 40), due, reps: ri(r, 0, 5), lapses: ri(r, 0, 3), last: seen, seen };
    } else if (roll < 0.62) {
      cards[id] = { ease: 2.5, interval: 0, due: null, reps: 0, lapses: 0, last: null, seen: null };
    }
  }
  for (let j = 0; j < 3; j++) {
    if (r() < 0.5) cards[`ghost-${j}`] = { ease: 2.5, interval: 1, due: T - j * HOUR, reps: 1, lapses: 0, last: TODAY0 + HOUR, seen: TODAY0 + HOUR };
  }
  return { bank, cards };
}

// ---------- 1. exports and constants ----------

test("prep/srs.js exports every §D name", () => {
  for (const k of EXPORTS) assert.ok(k in S, `missing export ${k}`);
  for (const k of FUNCTIONS) assert.equal(typeof S[k], "function", `${k} is not a function`);
});

test("§D constants: DAY, MINUTE, MAX_INTERVAL 365, AGAIN_DELAY_MS 10 minutes, GRADES, AREA_ORDER", () => {
  assert.equal(S.DAY, 86400000);
  assert.equal(S.MINUTE, 60000);
  assert.equal(S.MAX_INTERVAL, 365);
  assert.equal(S.AGAIN_DELAY_MS, 600000);
  assert.deepEqual([...S.GRADES], GRADES);
  assert.deepEqual([...S.AREA_ORDER], AREA_ORDER);
});

test("DEFAULT_SETTINGS is 15 new per day, 150 reviews and every area in schema order (spec §2)", () => {
  assert.deepEqual(S.DEFAULT_SETTINGS, DEFAULTS);
});

// ---------- 2. newCard and schedule ----------

test("spec F1.3 'New card': newCard() is ease 2.5, interval 0, reps 0, lapses 0 and never graded", () => {
  assert.deepEqual(S.newCard(), { ease: 2.5, interval: 0, due: null, reps: 0, lapses: 0, last: null, seen: null });
});

test("spec F1.3 'Grade again': reps 0, lapses+1, ease max(1.3, ease-0.2), interval 0, due in 10 minutes", () => {
  const mature = { ease: 2.5, interval: 15, due: T - DAY, reps: 3, lapses: 1, last: T - 16 * DAY, seen: T - 40 * DAY };
  assertCard(S.schedule(mature, "again", T),
    { ease: 2.3, interval: 0, due: T + 10 * MINUTE, reps: 0, lapses: 2, last: T, seen: T - 40 * DAY }, "mature again");
  assertCard(S.schedule(S.newCard(), "again", T),
    { ease: 2.3, interval: 0, due: T + 600000, reps: 0, lapses: 1, last: T, seen: T }, "new again");
  const big = { ease: 2.8, interval: 365, due: T, reps: 12, lapses: 0, last: T - 365 * DAY, seen: T - 900 * DAY };
  assertCard(S.schedule(big, "again", T),
    { ease: 2.6, interval: 0, due: T + 600000, reps: 0, lapses: 1, last: T, seen: T - 900 * DAY }, "365-day again");
});

test("spec F1.3 ease floor: again and hard never take ease below 1.3; good keeps it, easy raises it", () => {
  const base = { interval: 10, due: T - DAY, reps: 3, lapses: 0, last: T - 10 * DAY, seen: T - 30 * DAY };
  near(S.schedule({ ...base, ease: 1.4 }, "again", T).ease, 1.3, "1.4 again");
  near(S.schedule({ ...base, ease: 1.3 }, "again", T).ease, 1.3, "1.3 again");
  near(S.schedule({ ...base, ease: 1.35 }, "hard", T).ease, 1.3, "1.35 hard");
  near(S.schedule({ ...base, ease: 1.3 }, "hard", T).ease, 1.3, "1.3 hard");
  near(S.schedule({ ...base, ease: 1.5 }, "hard", T).ease, 1.35, "1.5 hard");
  near(S.schedule({ ...base, ease: 1.3 }, "good", T).ease, 1.3, "1.3 good");
  near(S.schedule({ ...base, ease: 1.3 }, "easy", T).ease, 1.45, "1.3 easy");
  // Repeated lapses walk the ease down by 0.2 and then stay at the floor.
  const expected = [2.3, 2.1, 1.9, 1.7, 1.5, 1.3, 1.3, 1.3];
  let c = S.newCard();
  expected.forEach((e, i) => {
    c = S.schedule(c, "again", T + i * HOUR);
    near(c.ease, e, `lapse ${i + 1}`);
    assert.equal(c.lapses, i + 1);
  });
});

test("schedule does not round ease (§D1): it keeps full precision, compared with a 1e-9 tolerance", () => {
  const c = { ease: 2.0123, interval: 10, due: T - DAY, reps: 3, lapses: 0, last: T - 10 * DAY, seen: T - 40 * DAY };
  near(S.schedule(c, "again", T).ease, 1.8123, "again");
  near(S.schedule(c, "hard", T).ease, 1.8623, "hard");
  near(S.schedule(c, "good", T).ease, 2.0123, "good");
  near(S.schedule(c, "easy", T).ease, 2.1623, "easy");
  // Intervals: hard round(12) = 12, good round(20.123) = 20, easy round(20 * 1.3) = 26.
  assert.equal(S.schedule(c, "hard", T).interval, 12);
  assert.equal(S.schedule(c, "good", T).interval, 20);
  assert.equal(S.schedule(c, "easy", T).interval, 26);
});

test("spec F1.3 'Grade hard': interval max(1, round(interval*1.2)) days, reps+1, ease max(1.3, ease-0.15)", () => {
  const cases = [[0, 1], [1, 1], [2, 2], [3, 4], [4, 5], [9, 11], [10, 12], [100, 120], [300, 360]];
  for (const [interval, want] of cases) {
    const c = { ease: 2.5, interval, due: T - DAY, reps: 4, lapses: 2, last: T - interval * DAY, seen: T - 500 * DAY };
    assertCard(S.schedule(c, "hard", T),
      { ease: 2.35, interval: want, due: T + want * DAY, reps: 5, lapses: 2, last: T, seen: T - 500 * DAY }, `hard from ${interval}`);
  }
  assertCard(S.schedule(S.newCard(), "hard", T),
    { ease: 2.35, interval: 1, due: T + DAY, reps: 1, lapses: 0, last: T, seen: T }, "new hard");
});

test("spec F1.3 'Grade good': interval 1 when reps==0, 6 when reps==1, otherwise round(interval*ease); ease unchanged", () => {
  const cases = [
    // [reps, interval, ease, expected interval]
    [0, 0, 2.5, 1],
    [0, 10, 2.1, 1], // reps 0 wins over a leftover interval
    [1, 1, 2.5, 6],
    [1, 4, 1.3, 6],
    [2, 6, 2.5, 15],
    [3, 15, 2.5, 38], // 37.5 is exact in binary, and Math.round(37.5) = 38
    [2, 6, 1.3, 8],
    [2, 7, 1.3, 9],
    [5, 10, 2, 20],
    [4, 33, 2.25, 74],
  ];
  for (const [reps, interval, ease, want] of cases) {
    const c = { ease, interval, due: T - HOUR, reps, lapses: 1, last: T - 9 * DAY, seen: T - 99 * DAY };
    assertCard(S.schedule(c, "good", T),
      { ease, interval: want, due: T + want * DAY, reps: reps + 1, lapses: 1, last: T, seen: T - 99 * DAY },
      `good from reps ${reps}, interval ${interval}, ease ${ease}`);
  }
});

test("spec F1.3 'Grade easy': the good interval times 1.3 and rounded, using the OLD ease, then ease+0.15", () => {
  const cases = [
    // [reps, interval, ease, expected interval, expected ease]
    [0, 0, 2.5, 1, 2.65],
    [1, 1, 2.5, 8, 2.65],
    [2, 6, 2, 16, 2.15],
    [2, 10, 2, 26, 2.15], // with the new ease 2.15 it would be 29
    [3, 12, 2.5, 39, 2.65],
    [2, 10, 1.3, 17, 1.45],
    [4, 20, 3, 78, 3.15],
  ];
  for (const [reps, interval, ease, want, wantEase] of cases) {
    const c = { ease, interval, due: T - HOUR, reps, lapses: 3, last: T - 9 * DAY, seen: T - 99 * DAY };
    assertCard(S.schedule(c, "easy", T),
      { ease: wantEase, interval: want, due: T + want * DAY, reps: reps + 1, lapses: 3, last: T, seen: T - 99 * DAY },
      `easy from reps ${reps}, interval ${interval}, ease ${ease}`);
  }
});

test("spec F1.3 'Maximum interval: 365 days' caps hard, good and easy", () => {
  const c = (reps, interval, ease = 2.5) => ({ ease, interval, due: T, reps, lapses: 0, last: T - DAY, seen: T - 999 * DAY });
  const capped = [
    [c(3, 200), "good"], // 500
    [c(3, 150), "easy"], // g 375, then 487.5
    [c(3, 290, 1.3), "easy"], // g 377
    [c(2, 330), "hard"], // 396
    [c(9, 365), "hard"],
    [c(9, 365), "good"],
    [c(9, 365, 1.3), "easy"],
  ];
  for (const [card0, grade] of capped) {
    const out = S.schedule(card0, grade, T);
    assert.equal(out.interval, 365, `${grade} from ${card0.interval}`);
    assert.equal(out.due, T + 365 * DAY, `${grade} from ${card0.interval}: due`);
  }
  assert.equal(S.schedule(c(3, 140), "good", T).interval, 350);
  assert.equal(S.schedule(c(3, 280, 1.3), "good", T).interval, 364);
  assert.equal(S.schedule(c(3, 300), "hard", T).interval, 360);
  assert.equal(S.schedule(c(3, 100, 2.5), "easy", T).interval, 325);
});

test("schedule sets last to now on every grade and seen only on the first grade", () => {
  const t1 = new Date(2026, 10, 1, 8, 30).getTime();
  const t2 = new Date(2026, 10, 2, 21, 15).getTime();
  const t3 = new Date(2026, 10, 9, 7, 0).getTime();
  const a = S.schedule(null, "good", t1);
  assert.equal(a.seen, t1);
  assert.equal(a.last, t1);
  const b = S.schedule(a, "again", t2);
  assert.equal(b.seen, t1);
  assert.equal(b.last, t2);
  const c = S.schedule(b, "easy", t3);
  assert.equal(c.seen, t1);
  assert.equal(c.last, t3);
  for (const g of GRADES) {
    const out = S.schedule(card(T - DAY, { seen: t1, last: t2 }), g, T);
    assert.equal(out.seen, t1, `${g} keeps seen`);
    assert.equal(out.last, T, `${g} sets last`);
  }
});

test("schedule reproduces the §D2 / Appendix B reference run from a new card", () => {
  const grades = ["good", "good", "good", "easy", "hard", "again", "good", "good"];
  const intervals = [1, 6, 15, 49, 59, 0, 1, 6];
  const eases = [2.5, 2.5, 2.5, 2.65, 2.5, 2.3, 2.3, 2.3];
  const reps = [1, 2, 3, 4, 5, 0, 1, 2];
  const lapses = [0, 0, 0, 0, 0, 1, 1, 1];
  let c = S.newCard();
  grades.forEach((g, i) => {
    const t = T + i * DAY;
    c = S.schedule(c, g, t);
    assertCard(c, {
      ease: eases[i], interval: intervals[i], reps: reps[i], lapses: lapses[i],
      due: g === "again" ? t + 600000 : t + intervals[i] * DAY, last: t, seen: T,
    }, `step ${i + 1} (${g})`);
  });
});

test("schedule treats null, undefined and missing fields as their newCard() values", () => {
  const fresh = { ease: 2.5, interval: 1, due: T + DAY, reps: 1, lapses: 0, last: T, seen: T };
  assertCard(S.schedule(null, "good", T), fresh, "null");
  assertCard(S.schedule(undefined, "good", T), fresh, "undefined");
  assertCard(S.schedule({}, "good", T), fresh, "{}");
  assertCard(S.schedule({ reps: 1, interval: 1 }, "good", T),
    { ease: 2.5, interval: 6, due: T + 6 * DAY, reps: 2, lapses: 0, last: T, seen: T }, "reps 1 only");
  assertCard(S.schedule({ reps: 2, interval: 10 }, "good", T),
    { ease: 2.5, interval: 25, due: T + 25 * DAY, reps: 3, lapses: 0, last: T, seen: T }, "default ease");
  assertCard(S.schedule({ lapses: 2 }, "again", T),
    { ease: 2.3, interval: 0, due: T + 600000, reps: 0, lapses: 3, last: T, seen: T }, "lapses only");
});

test("schedule returns a new card with exactly the §D1 fields and does not mutate its input (§A3)", () => {
  for (const g of GRADES) {
    const input = card(T - DAY, { interval: 9, reps: 3, ease: 2.2 });
    const before = clone(input);
    const out = S.schedule(input, g, T);
    assert.deepEqual(input, before, `${g} mutated its input`);
    assert.notEqual(out, input);
    assert.deepEqual(Object.keys(out).sort(), CARD_KEYS, `${g} card keys`);
    assert.deepEqual(Object.keys(S.schedule(null, g, T)).sort(), CARD_KEYS, `${g} from null: keys`);
  }
  const nc = S.newCard();
  const ncBefore = clone(nc);
  S.schedule(nc, "good", T);
  assert.deepEqual(nc, ncBefore);
});

test("schedule throws a TypeError for a grade that is not one of GRADES", () => {
  // Positive control: every valid grade is accepted (on a new card and on null), so the TypeError
  // below comes from grade validation, not from a missing export.
  for (const g of GRADES) {
    assert.doesNotThrow(() => S.schedule(S.newCard(), g, T), `grade ${g}`);
    assert.doesNotThrow(() => S.schedule(null, g, T), `grade ${g} on null`);
  }
  for (const bad of ["medium", "Good", "AGAIN", "", undefined, null, 3]) {
    assert.throws(() => S.schedule(S.newCard(), bad, T), TypeError, `grade ${String(bad)}`);
    assert.throws(() => S.schedule(null, bad, T), TypeError, `grade ${String(bad)} on null`);
  }
});

test("schedule matches an independent §D2 oracle on 400 random cards and grades", () => {
  const r = lcg(20261104);
  const eases = [1.3, 1.5, 1.75, 2, 2.25, 2.5, 2.8, 3.05];
  let checked = 0;
  for (let i = 0; i < 400; i++) {
    const c = {
      ease: pickOf(r, eases), interval: ri(r, 0, 365), due: T - ri(r, 0, 9) * HOUR,
      reps: ri(r, 0, 8), lapses: ri(r, 0, 5), last: T - ri(r, 1, 50) * DAY,
      seen: r() < 0.2 ? null : T - ri(r, 51, 400) * DAY,
    };
    const g = pickOf(r, GRADES);
    const t = T + ri(r, 0, 1000) * MINUTE;
    const want = refSchedule(c, g, t);
    if (!want) continue;
    assertCard(S.schedule(c, g, t), want, `case ${i}: ${g} on ${JSON.stringify(c)}`);
    checked++;
  }
  assert.ok(checked >= 300, `only ${checked} cases checked`);
});

// ---------- 3. interval preview and labels ----------

test("nextIntervals previews the interval each grade would give, again always 0", () => {
  assert.deepEqual(S.nextIntervals(S.newCard()), { again: 0, hard: 1, good: 1, easy: 1 });
  assert.deepEqual(S.nextIntervals(null), { again: 0, hard: 1, good: 1, easy: 1 });
  assert.deepEqual(S.nextIntervals({ reps: 1, interval: 1, ease: 2.5 }), { again: 0, hard: 1, good: 6, easy: 8 });
  assert.deepEqual(S.nextIntervals({ reps: 3, interval: 12, ease: 2.5 }), { again: 0, hard: 14, good: 30, easy: 39 });
  assert.deepEqual(S.nextIntervals({ reps: 4, interval: 300, ease: 2.5 }), { again: 0, hard: 360, good: 365, easy: 365 });
  assert.deepEqual(S.nextIntervals({ reps: 2, interval: 10, ease: 2 }), { again: 0, hard: 12, good: 20, easy: 26 });
  const input = card(T, { reps: 3, interval: 12 });
  const before = clone(input);
  S.nextIntervals(input);
  assert.deepEqual(input, before, "nextIntervals mutated its input");
});

test("nextIntervals agrees with schedule and with the §D2 oracle on random cards", () => {
  const r = lcg(777);
  const eases = [1.3, 1.6, 2, 2.3, 2.5, 2.75];
  let checked = 0;
  for (let i = 0; i < 200; i++) {
    const c = { ease: pickOf(r, eases), interval: ri(r, 0, 365), due: T, reps: ri(r, 0, 7), lapses: ri(r, 0, 3), last: T - DAY, seen: T - 9 * DAY };
    const ni = S.nextIntervals(c);
    for (const g of GRADES) assert.equal(ni[g], S.schedule(c, g, 0).interval, `case ${i} ${g} vs schedule`);
    const want = Object.fromEntries(GRADES.map((g) => [g, refSchedule(c, g, 0)]));
    if (GRADES.some((g) => !want[g])) continue;
    assert.deepEqual(ni, Object.fromEntries(GRADES.map((g) => [g, want[g].interval])), `case ${i}`);
    checked++;
  }
  assert.ok(checked >= 150, `only ${checked} cases checked`);
});

test("spec F1.4 grade buttons show their next intervals: gradeLabels gives 'Good, 6d'-style labels", () => {
  assert.deepEqual(S.gradeLabels(S.newCard()),
    { again: "Again, 10m", hard: "Hard, 1d", good: "Good, 1d", easy: "Easy, 1d" });
  assert.deepEqual(S.gradeLabels({ reps: 1, interval: 1, ease: 2.5 }),
    { again: "Again, 10m", hard: "Hard, 1d", good: "Good, 6d", easy: "Easy, 8d" });
  // Always days, even beyond 30.
  assert.deepEqual(S.gradeLabels({ reps: 4, interval: 100, ease: 2.5 }),
    { again: "Again, 10m", hard: "Hard, 120d", good: "Good, 250d", easy: "Easy, 325d" });
  assert.deepEqual(S.gradeLabels({ reps: 4, interval: 300, ease: 2.5 }),
    { again: "Again, 10m", hard: "Hard, 360d", good: "Good, 365d", easy: "Easy, 365d" });
  assert.deepEqual(S.gradeLabels(card(T, { reps: 0, interval: 0, lapses: 4, ease: 1.3 })),
    { again: "Again, 10m", hard: "Hard, 1d", good: "Good, 1d", easy: "Easy, 1d" });
});

test("gradeLabels matches the §D2 oracle intervals on random cards", () => {
  const r = lcg(4242);
  const eases = [1.3, 1.9, 2.2, 2.5, 2.9];
  let checked = 0;
  for (let i = 0; i < 150; i++) {
    const c = { ease: pickOf(r, eases), interval: ri(r, 0, 365), due: T, reps: ri(r, 0, 6), lapses: 0, last: T - DAY, seen: T - 5 * DAY };
    const w = Object.fromEntries(GRADES.map((g) => [g, refSchedule(c, g, 0)]));
    if (GRADES.some((g) => !w[g])) continue;
    assert.deepEqual(S.gradeLabels(c), {
      again: "Again, 10m",
      hard: `Hard, ${w.hard.interval}d`,
      good: `Good, ${w.good.interval}d`,
      easy: `Easy, ${w.easy.interval}d`,
    }, `case ${i}`);
    checked++;
  }
  assert.ok(checked >= 100, `only ${checked} cases checked`);
});

// ---------- 4. auto-grading ----------

test("spec F1.3 'targetSecs = 60 * difficulty * 1.5'", () => {
  const want = { 1: 90, 2: 180, 3: 270, 4: 360, 5: 450 };
  for (const d of [1, 2, 3, 4, 5]) near(S.targetSecs(item(`d${d}`, "probability", d)), want[d], `difficulty ${d}`);
});

test("spec F1.3 auto-checked items: a wrong answer counts as again", () => {
  for (const d of [1, 3, 5]) {
    const it = item(`w${d}`, "probability", d);
    for (const secs of [0, 5, 60 * d * 1.5, 10000]) assert.equal(S.autoGrade(false, secs, it), "again", `d${d} ${secs}s`);
  }
});

test("spec F1.3 auto-checked items: a correct answer counts as good, or as hard if secs > targetSecs", () => {
  const d1 = item("d1", "probability", 1);
  const d2 = item("d2", "cpp", 2);
  const d5 = item("d5", "statistics", 5);
  assert.equal(S.autoGrade(true, 0, d2), "good");
  assert.equal(S.autoGrade(true, 179, d2), "good");
  assert.equal(S.autoGrade(true, 180, d2), "good", "equal to the target is good");
  assert.equal(S.autoGrade(true, 180.5, d2), "hard");
  assert.equal(S.autoGrade(true, 181, d2), "hard");
  assert.equal(S.autoGrade(true, 90, d1), "good");
  assert.equal(S.autoGrade(true, 91, d1), "hard");
  assert.equal(S.autoGrade(true, 450, d5), "good");
  assert.equal(S.autoGrade(true, 451, d5), "hard");
  assert.equal(S.autoGrade(true, 3600, d5), "hard");
});

test("autoGrade gives no grade (null) when correctness is unknown, e.g. a parse error", () => {
  const it = item("u", "probability", 2);
  assert.equal(S.autoGrade(null, 10, it), null);
  assert.equal(S.autoGrade(undefined, 10, it), null);
  assert.equal(S.autoGrade(null, 1000, it), null);
});

test("answerOk: an auto entry is OK when correct, a self-graded entry when its grade is not again", () => {
  const base = { ts: T, itemId: "x", secs: 30, answer: "" };
  assert.equal(S.answerOk({ ...base, mode: "auto", correct: true, grade: "good" }), true);
  assert.equal(S.answerOk({ ...base, mode: "auto", correct: true, grade: "hard" }), true, "slow but correct");
  assert.equal(S.answerOk({ ...base, mode: "auto", correct: false, grade: "again" }), false);
  for (const g of ["hard", "good", "easy"]) {
    assert.equal(S.answerOk({ ...base, mode: "self", correct: null, grade: g }), true, `self ${g}`);
  }
  assert.equal(S.answerOk({ ...base, mode: "self", correct: null, grade: "again" }), false);
});

test("answerOk follows §D4 exactly: auto entries by correct === true only, self entries by grade only", () => {
  const base = { ts: T, itemId: "x", secs: 30, answer: "" };
  assert.equal(S.answerOk({ ...base, mode: "auto", correct: null, grade: null }), false, "auto with unknown correctness");
  assert.equal(S.answerOk({ ...base, mode: "auto", correct: false, grade: "good" }), false, "auto: the grade is not consulted");
  assert.equal(S.answerOk({ ...base, mode: "auto", correct: true, grade: "again" }), true, "auto: the grade is not consulted");
  assert.equal(S.answerOk({ ...base, mode: "self", correct: false, grade: "good" }), true, "self: correct is not consulted");
  assert.equal(S.answerOk({ ...base, mode: "self", correct: true, grade: "again" }), false, "self: correct is not consulted");
});

// ---------- 5. settings ----------

test("normalizeSettings fills every missing setting with DEFAULT_SETTINGS", () => {
  assert.deepEqual(S.normalizeSettings(undefined), DEFAULTS);
  assert.deepEqual(S.normalizeSettings({}), DEFAULTS);
  assert.deepEqual(S.normalizeSettings({ newPerDay: 4 }), { ...DEFAULTS, newPerDay: 4 });
  assert.deepEqual(S.normalizeSettings({ reviewCap: 20 }), { ...DEFAULTS, reviewCap: 20 });
});

test("normalizeSettings keeps newPerDay 0-200 and reviewCap 0-1000 integers, otherwise the default", () => {
  for (const v of [0, 1, 15, 37, 200]) assert.equal(S.normalizeSettings({ newPerDay: v }).newPerDay, v, `newPerDay ${v}`);
  for (const v of [-1, 201, 1e6, 7.5, NaN, Infinity, "lots"]) {
    assert.equal(S.normalizeSettings({ newPerDay: v }).newPerDay, 15, `newPerDay ${String(v)}`);
  }
  for (const v of [0, 1, 150, 999, 1000]) assert.equal(S.normalizeSettings({ reviewCap: v }).reviewCap, v, `reviewCap ${v}`);
  for (const v of [-5, 1001, 2.5, NaN, -Infinity, "many"]) {
    assert.equal(S.normalizeSettings({ reviewCap: v }).reviewCap, 150, `reviewCap ${String(v)}`);
  }
});

test("normalizeSettings keeps known areas only, de-duplicated and in schema order", () => {
  assert.deepEqual(S.normalizeSettings({ areas: ["cpp", "probability", "cpp", "bogus"] }).areas, ["probability", "cpp"]);
  assert.deepEqual(S.normalizeSettings({ areas: ["systems", "finance"] }).areas, ["finance", "systems"]);
  assert.deepEqual(S.normalizeSettings({ areas: [...AREA_ORDER].reverse() }).areas, AREAS);
  assert.deepEqual(S.normalizeSettings({ areas: ["Probability", "chess", 3, null] }).areas, []);
  assert.deepEqual(S.normalizeSettings({ areas: [] }).areas, [], "an empty array stays empty");
  assert.deepEqual(S.normalizeSettings({ areas: "cpp" }).areas, AREAS, "not an array: every area");
  assert.deepEqual(S.normalizeSettings({ areas: null }).areas, AREAS);
  assert.deepEqual(S.normalizeSettings({ newPerDay: 3, reviewCap: 9, areas: ["statistics"] }),
    { newPerDay: 3, reviewCap: 9, areas: ["statistics"] });
});

test("normalizeSettings does not mutate its input", () => {
  const s = { newPerDay: 999, reviewCap: -1, areas: ["cpp", "cpp", "nope", "probability"] };
  const before = clone(s);
  S.normalizeSettings(s);
  assert.deepEqual(s, before);
});

// ---------- 6. buildQueue ----------

test("buildQueue of an empty or missing bank is empty", () => {
  assert.deepEqual(S.buildQueue([], {}, T, DEFAULTS), []);
  assert.deepEqual(S.buildQueue(null, null, T, DEFAULTS), []);
  assert.deepEqual(S.buildQueue(undefined, undefined, T), []);
  assert.deepEqual(S.buildQueue([], { ghost: card(T - DAY) }, T, DEFAULTS), []);
});

test("spec F1.3 buildQueue step 1: all due reviews (due <= now) come first, oldest due first; not-yet-due ones are left out", () => {
  const bank = [
    item("n1", "probability", 1), item("r3", "probability", 1), item("r2", "probability", 1),
    item("n2", "probability", 1), item("r1", "probability", 1), item("r4", "probability", 1),
  ];
  const cards = {
    r1: card(T - 3 * DAY), r2: card(T), r3: card(T + 1), r4: card(T - HOUR),
  };
  assert.deepEqual(S.buildQueue(bank, cards, T, DEFAULTS), ["r1", "r4", "r2", "n1", "n2"]);
  // A review that is due later today is still left out.
  assert.deepEqual(S.buildQueue(bank, { r1: card(T + 2 * HOUR) }, T, DEFAULTS), ["n1", "r3", "r2", "n2", "r4"]);
});

test("buildQueue breaks equal due times by id with plain < string comparison", () => {
  const bank = [item("src-p9-q1", "probability"), item("Src-p5-q1", "probability"), item("src-p10-q1", "probability")];
  const due = T - DAY;
  const cards = { "src-p9-q1": card(due), "Src-p5-q1": card(due), "src-p10-q1": card(due) };
  assert.deepEqual(S.buildQueue(bank, cards, T, DEFAULTS), ["Src-p5-q1", "src-p10-q1", "src-p9-q1"]);
  const drill = S.drillQueue(bank, cards, T, { count: 10 });
  assert.deepEqual(drill, ["Src-p5-q1", "src-p10-q1", "src-p9-q1"], "drillQueue uses the same tie-break");
});

test("spec F1.3 buildQueue: due reviews are capped at reviewCap, keeping the oldest due, before the area interleave", () => {
  const bank = [
    item("s1", "statistics"), item("p3", "probability"), item("c1", "cpp"),
    item("p2", "probability"), item("p1", "probability"), item("new", "probability"),
  ];
  const cards = {
    p1: card(T - 5 * DAY), p2: card(T - 4 * DAY), c1: card(T - 3 * DAY), p3: card(T - 2 * DAY), s1: card(T - DAY),
  };
  const set = (reviewCap) => ({ newPerDay: 15, reviewCap, areas: AREAS });
  // Oldest three are p1, p2, c1; interleaved they become p1, c1, p2.
  assert.deepEqual(S.buildQueue(bank, cards, T, set(3)), ["p1", "c1", "p2", "new"]);
  assert.deepEqual(S.buildQueue(bank, cards, T, set(1)), ["p1", "new"]);
  assert.deepEqual(S.buildQueue(bank, cards, T, set(0)), ["new"], "reviewCap 0 queues no reviews");
  assert.deepEqual(S.buildQueue(bank, cards, T, set(150)), ["p1", "c1", "s1", "p2", "p3", "new"]);
});

test("spec F1.3 buildQueue step 3: due reviews interleave round-robin by area: probability, brainteaser, cpp, systems, statistics, finance", () => {
  // One review per area, due in the reverse of the round-robin order.
  const reversed = [...AREA_ORDER].reverse();
  const bank = reversed.map((a) => item(`rev-${a}`, a));
  const cards = {};
  reversed.forEach((a, i) => { cards[`rev-${a}`] = card(T - (10 - i) * DAY); });
  assert.deepEqual(S.buildQueue(bank, cards, T, DEFAULTS), AREA_ORDER.map((a) => `rev-${a}`));
  // The §D8 example: [p1, p2, p3, c1, s1] becomes [p1, c1, s1, p2, p3].
  const bank2 = [item("s1", "statistics"), item("c1", "cpp"), item("p3", "probability"), item("p2", "probability"), item("p1", "probability")];
  const cards2 = { p1: card(T - 5 * DAY), p2: card(T - 4 * DAY), p3: card(T - 3 * DAY), c1: card(T - 2 * DAY), s1: card(T - DAY) };
  assert.deepEqual(S.buildQueue(bank2, cards2, T, DEFAULTS), ["p1", "c1", "s1", "p2", "p3"]);
});

test("spec F1.3 buildQueue step 4: inside an area new items go in difficulty order, then source (bank) order", () => {
  const bank = [
    item("a-d3", "probability", 3), item("b-d1", "probability", 1), item("c-d2", "probability", 2),
    item("d-d1", "probability", 1), item("e-d5", "probability", 5), item("f-d2", "probability", 2),
  ];
  assert.deepEqual(S.buildQueue(bank, {}, T, DEFAULTS), ["b-d1", "d-d1", "c-d2", "f-d2", "a-d3", "e-d5"]);
  // Bank order, not id order, breaks difficulty ties.
  const bank2 = [item("zz", "cpp", 2), item("mm", "cpp", 2), item("aa", "cpp", 2)];
  assert.deepEqual(S.buildQueue(bank2, {}, T, DEFAULTS), ["zz", "mm", "aa"]);
});

test("spec F1.3 buildQueue step 3 for new items: interleave areas round-robin, then apply the newPerDay limit", () => {
  const bank = [
    item("st1", "statistics", 1), item("p1", "probability", 3), item("p2", "probability", 1),
    item("c1", "cpp", 2), item("b1", "brainteaser", 5), item("p3", "probability", 1),
    item("c2", "cpp", 1), item("f1", "finance", 2), item("sy1", "systems", 4),
  ];
  const all = ["p2", "b1", "c2", "sy1", "st1", "f1", "p3", "c1", "p1"];
  assert.deepEqual(S.buildQueue(bank, {}, T, DEFAULTS), all);
  assert.deepEqual(S.buildQueue(bank, {}, T, { ...DEFAULTS, newPerDay: 4 }), all.slice(0, 4));
  assert.deepEqual(S.buildQueue(bank, {}, T, { ...DEFAULTS, newPerDay: 7 }), all.slice(0, 7));
  // Limit after interleaving: with two areas the cut keeps both areas.
  const bank2 = [item("p1", "probability", 1), item("p2", "probability", 1), item("p3", "probability", 1), item("c1", "cpp", 1), item("c2", "cpp", 1)];
  assert.deepEqual(S.buildQueue(bank2, {}, T, { ...DEFAULTS, newPerDay: 4 }), ["p1", "c1", "p2", "c2"]);
});

test("spec F1.3 buildQueue step 2: new items are limited to newPerDay minus the items already introduced (seen) today", () => {
  const bank = [
    item("today-midnight", "probability"), item("today-early", "probability"), item("today-due", "probability"),
    item("yesterday", "probability"), item("n1", "probability", 1), item("n2", "probability", 2),
    item("n3", "probability", 3), item("n4", "probability", 4),
  ];
  const cards = {
    // introduced today, due tomorrow: not queued, but they use up the budget
    "today-midnight": card(TOMORROW0 + HOUR, { seen: TODAY0, last: TODAY0 }),
    "today-early": card(T + DAY, { seen: T - 6 * HOUR, last: T - 6 * HOUR }),
    // introduced today, failed, due again 10 minutes later: queued as a review AND counted
    "today-due": card(T - 50 * MINUTE, { seen: T - HOUR, last: T - HOUR, interval: 0, reps: 0 }),
    // introduced one millisecond before today started: does not count
    yesterday: card(T + 3 * DAY, { seen: TODAY0 - 1, last: TODAY0 - 1 }),
  };
  const q = (newPerDay) => S.buildQueue(bank, cards, T, { ...DEFAULTS, newPerDay });
  assert.deepEqual(q(5), ["today-due", "n1", "n2"]);
  assert.deepEqual(q(4), ["today-due", "n1"]);
  assert.deepEqual(q(3), ["today-due"]);
  assert.deepEqual(q(15), ["today-due", "n1", "n2", "n3", "n4"]);
  // Tomorrow (same cards, a day later) nothing counts as seen today any more.
  const tomorrow = new Date(2026, 10, 5, 15, 0, 0).getTime();
  const qt = S.buildQueue(bank, cards, tomorrow, { ...DEFAULTS, newPerDay: 2 });
  assert.deepEqual(qt.slice(-2), ["n1", "n2"]);
});

test("buildQueue: the new-item budget never goes negative when more items were seen today than newPerDay", () => {
  const bank = [
    item("s1", "cpp"), item("s2", "cpp"), item("s3", "cpp"), item("n1", "cpp", 1), item("n2", "cpp", 2),
    item("n3", "cpp", 3), item("n4", "cpp", 4), item("r1", "cpp"),
  ];
  const cards = {
    s1: card(T + DAY, { seen: T - HOUR }), s2: card(T + DAY, { seen: T - 2 * HOUR }), s3: card(T + DAY, { seen: T - 3 * HOUR }),
    r1: card(T - DAY),
  };
  assert.deepEqual(S.buildQueue(bank, cards, T, { ...DEFAULTS, newPerDay: 1 }), ["r1"]);
  assert.deepEqual(S.buildQueue(bank, cards, T, { ...DEFAULTS, newPerDay: 3 }), ["r1"]);
  assert.deepEqual(S.buildQueue(bank, cards, T, { ...DEFAULTS, newPerDay: 4 }), ["r1", "n1"]);
});

test("buildQueue: newPerDay 0 queues no new items, reviews still come", () => {
  const bank = [item("n1", "probability"), item("r1", "finance")];
  assert.deepEqual(S.buildQueue(bank, { r1: card(T - DAY) }, T, { ...DEFAULTS, newPerDay: 0 }), ["r1"]);
  assert.deepEqual(S.buildQueue(bank, {}, T, { ...DEFAULTS, newPerDay: 0 }), []);
});

test("buildQueue: seen today counts only items in settings.areas and ignores the topic filter", () => {
  const bank = [
    item("seen-cpp", "cpp", 1, ["templates"]), item("seen-prob", "probability", 1, ["bayes"]),
    item("seen-dice", "probability", 1, ["dice"]),
    item("n-dice-1", "probability", 1, ["dice"]), item("n-dice-2", "probability", 2, ["dice", "ev"]),
    item("n-dice-3", "probability", 3, ["dice"]), item("n-bayes", "probability", 1, ["bayes"]),
  ];
  const seenCard = card(T + DAY, { seen: T - 2 * HOUR });
  const cards = { "seen-cpp": seenCard, "seen-prob": seenCard, "seen-dice": seenCard };
  const probOnly = { newPerDay: 4, reviewCap: 150, areas: ["probability"] };
  // seen-prob and seen-dice count (seen-prob even though the topic filter excludes it); seen-cpp does not.
  assert.deepEqual(S.buildQueue(bank, cards, T, probOnly, { topics: ["dice"] }), ["n-dice-1", "n-dice-2"]);
  assert.deepEqual(S.buildQueue(bank, cards, T, probOnly), ["n-dice-1", "n-bayes"]);
  // With cpp in the area set, seen-cpp counts as well.
  const both = { ...probOnly, areas: ["probability", "cpp"] };
  assert.deepEqual(S.buildQueue(bank, cards, T, both, { topics: ["dice"] }), ["n-dice-1"]);
});

test("buildQueue: 'seen today' is the local calendar day of now (§A2), not the UTC day, the last 24 hours or a later day", () => {
  // Just after local midnight in summer time: in most time zones (Europe/London included) the UTC
  // day differs from the local day here, and a rolling 24-hour window reaches back into yesterday.
  const early = new Date(2026, 6, 15, 0, 30).getTime(); // Wed 15 Jul 2026 00:30 local
  const later = new Date(2026, 6, 25, 12, 0).getTime(); // every graded card is due well after now
  const at = (d, h, m) => new Date(2026, 6, d, h, m).getTime();
  const bank = [
    item("today-0010", "probability"), item("yesterday-2300", "probability"), item("yesterday-0100", "probability"),
    item("next-day", "probability"),
    item("n1", "probability", 1), item("n2", "probability", 2), item("n3", "probability", 3), item("n4", "probability", 4),
  ];
  const cards = {
    "today-0010": card(later, { seen: at(15, 0, 10), last: at(15, 0, 10) }),
    "yesterday-2300": card(later, { seen: at(14, 23, 0), last: at(14, 23, 0) }),
    "yesterday-0100": card(later, { seen: at(14, 1, 0), last: at(14, 1, 0) }),
    "next-day": card(later, { seen: at(16, 9, 0), last: at(16, 9, 0) }),
  };
  // Only today-0010 was introduced on the local day of now.
  assert.deepEqual(S.buildQueue(bank, cards, early, { ...DEFAULTS, newPerDay: 3 }), ["n1", "n2"]);
  assert.deepEqual(S.buildQueue(bank, cards, early, { ...DEFAULTS, newPerDay: 1 }), []);
  assert.deepEqual(S.buildQueue(bank, cards, early, { ...DEFAULTS, newPerDay: 5 }), ["n1", "n2", "n3", "n4"]);
});

test("spec F1.3 buildQueue: settings.areas filters the areas for reviews and new items", () => {
  const bank = [
    item("p-rev", "probability"), item("c-rev", "cpp"), item("y-rev", "systems"),
    item("p-new", "probability"), item("c-new", "cpp", 2), item("y-new", "systems", 1), item("f-new", "finance"),
  ];
  const cards = { "p-rev": card(T - 3 * DAY), "c-rev": card(T - 2 * DAY), "y-rev": card(T - DAY) };
  const q = (areas) => S.buildQueue(bank, cards, T, { newPerDay: 15, reviewCap: 150, areas });
  assert.deepEqual(q(["cpp", "systems"]), ["c-rev", "y-rev", "c-new", "y-new"]);
  assert.deepEqual(q(["finance"]), ["f-new"]);
  assert.deepEqual(q(["probability", "brainteaser", "statistics", "finance"]), ["p-rev", "p-new", "f-new"]);
  assert.deepEqual(q([]), [], "no areas, no items");
  assert.deepEqual(q(["systems", "nonsense"]), ["y-rev", "y-new"], "unknown areas in settings are dropped");
});

test("spec F1.3 buildQueue: the optional topic filter keeps items with at least one of the topics (buddy drills, F7)", () => {
  const bank = [
    item("dice-rev", "probability", 1, ["dice", "order-statistics"]), item("bayes-rev", "probability", 1, ["bayes"]),
    item("dice-new", "probability", 2, ["dice"]), item("bayes-new", "brainteaser", 1, ["conditional", "bayes"]),
    item("other-new", "probability", 1, ["coins"]),
  ];
  const cards = { "dice-rev": card(T - 2 * DAY), "bayes-rev": card(T - DAY) };
  const q = (opts) => S.buildQueue(bank, cards, T, DEFAULTS, opts);
  assert.deepEqual(q({ topics: ["dice"] }), ["dice-rev", "dice-new"]);
  assert.deepEqual(q({ topics: ["bayes"] }), ["bayes-rev", "bayes-new"]);
  assert.deepEqual(q({ topics: ["dice", "bayes"] }), ["dice-rev", "bayes-rev", "dice-new", "bayes-new"], "OR semantics");
  assert.deepEqual(q({ topics: ["no-such-topic"] }), []);
  const unfiltered = ["dice-rev", "bayes-rev", "other-new", "bayes-new", "dice-new"];
  assert.deepEqual(q({ topics: [] }), unfiltered, "an empty topic list does not filter");
  assert.deepEqual(q({}), unfiltered);
  assert.deepEqual(S.buildQueue(bank, cards, T, DEFAULTS), unfiltered, "opts is optional");
});

test("buildQueue ignores items with an unknown area", () => {
  const odd = { ...item("odd", "probability"), area: undefined };
  const bank = [item("chess-1", "chess"), item("p1", "probability", 2), odd, item("chess-2", "Probability"), item("p2", "probability", 1)];
  const cards = { "chess-1": card(T - DAY), "chess-2": card(T - DAY), odd: card(T - DAY) };
  assert.deepEqual(S.buildQueue(bank, cards, T, DEFAULTS), ["p2", "p1"]);
  assert.deepEqual(S.buildQueue(bank, cards, T, { ...DEFAULTS, areas: "everything" }), ["p2", "p1"]);
});

test("buildQueue ignores cards whose id is not in the bank: never queued, never counted as seen today", () => {
  const bank = [item("n1", "probability", 1), item("n2", "probability", 2), item("r1", "probability")];
  const cards = {
    r1: card(T - DAY),
    "gone-1": card(T - 5 * DAY, { seen: T - HOUR }),
    "gone-2": card(T - 6 * DAY, { seen: T - 2 * HOUR }),
  };
  assert.deepEqual(S.buildQueue(bank, cards, T, { ...DEFAULTS, newPerDay: 2 }), ["r1", "n1", "n2"]);
});

test("buildQueue treats a card with a non-finite due as a new item", () => {
  const bank = [item("a", "probability", 3), item("b", "probability", 1), item("c", "probability", 2), item("r", "probability")];
  const cards = {
    a: { ...S.newCard() },
    b: card(null, { seen: null, last: null }),
    c: card(NaN, { seen: null, last: null }),
    r: card(T - DAY),
  };
  assert.deepEqual(S.buildQueue(bank, cards, T, DEFAULTS), ["r", "b", "c", "a"]);
});

test("buildQueue de-duplicates the bank by id; the first occurrence wins", () => {
  const bank = [
    item("x", "probability", 2), item("dup", "probability", 3), item("y", "probability", 2),
    item("dup", "probability", 1), item("z", "probability", 4),
  ];
  assert.deepEqual(S.buildQueue(bank, {}, T, DEFAULTS), ["x", "y", "dup", "z"]);
  const cards = { dup: card(T - DAY) };
  assert.deepEqual(S.buildQueue(bank, cards, T, DEFAULTS), ["dup", "x", "y", "z"], "a due duplicate is queued once");
});

test("buildQueue with no or invalid settings uses DEFAULT_SETTINGS: 150 reviews and 15 new items", () => {
  const bank = [];
  const cards = {};
  for (let i = 0; i < 160; i++) {
    const id = `rev-${String(i).padStart(3, "0")}`;
    bank.push(item(id, "probability"));
    cards[id] = card(T - (200 - i) * HOUR);
  }
  for (let i = 0; i < 20; i++) bank.push(item(`new-${String(i).padStart(2, "0")}`, "probability", 1));
  const want = bank.slice(0, 150).map((x) => x.id).concat(bank.slice(160, 175).map((x) => x.id));
  assert.deepEqual(S.buildQueue(bank, cards, T), want);
  assert.deepEqual(S.buildQueue(bank, cards, T, {}), want);
  assert.deepEqual(S.buildQueue(bank, cards, T, { newPerDay: -3, reviewCap: "lots", areas: 7 }), want);
});

test("spec F1.3 buildQueue is deterministic for equal inputs and does not mutate them", () => {
  const bank = [
    item("p1", "probability", 2, ["dice"]), item("c1", "cpp", 1, ["raii"]), item("b1", "brainteaser", 3, ["weighing"]),
    item("p2", "probability", 1, ["dice"]), item("y1", "systems", 2, ["numa"]), item("f1", "finance", 1, ["bonds"]),
  ];
  const cards = { p1: card(T - DAY), y1: card(T - 2 * DAY), b1: card(T + DAY, { seen: T - HOUR }) };
  // Same cards, inserted in the opposite key order.
  const cardsReordered = {};
  for (const k of Object.keys(cards).reverse()) cardsReordered[k] = clone(cards[k]);
  const settings = { newPerDay: 3, reviewCap: 10, areas: ["cpp", "probability", "systems", "finance", "brainteaser"] };
  const before = clone({ bank, cards, settings });
  const a = S.buildQueue(bank, cards, T, settings);
  const b = S.buildQueue(clone(bank), cardsReordered, T, clone(settings));
  assert.deepEqual(a, b);
  // b1 was introduced today (budget 3 - 1 = 2); probability comes before systems in the interleave.
  assert.deepEqual(a, ["p1", "y1", "p2", "c1"]);
  assert.deepEqual({ bank, cards, settings }, before, "inputs were mutated");
  const opts = { topics: ["dice", "numa"] };
  S.buildQueue(bank, cards, T, settings, opts);
  assert.deepEqual(opts, { topics: ["dice", "numa"] });
});

test("buildQueue accepts a bank object with an items array (§A6)", () => {
  const items = [item("p1", "probability", 2), item("c1", "cpp", 1), item("r1", "statistics")];
  const cards = { r1: card(T - DAY) };
  const want = ["r1", "p1", "c1"];
  assert.deepEqual(S.buildQueue(items, cards, T, DEFAULTS), want);
  assert.deepEqual(S.buildQueue({ items }, cards, T, DEFAULTS), want);
  assert.deepEqual(S.buildQueue({ version: 1, items }, cards, T, DEFAULTS), want);
});

test("buildQueue matches an independent §D6 oracle on 300 random sessions", () => {
  const r = lcg(31337);
  const topicPool = ["alpha", "beta", "gamma", "delta", "omega"];
  for (let i = 0; i < 300; i++) {
    const { bank, cards } = randomSession(r);
    const areas = r() < 0.3 ? [...AREAS] : AREAS.filter(() => r() < 0.5);
    if (r() < 0.2) areas.push(pickOf(r, AREAS)); // a duplicate entry
    const settings = { newPerDay: ri(r, 0, 12), reviewCap: ri(r, 0, 12), areas };
    const roll = r();
    const topics = roll < 0.5 ? undefined : roll < 0.6 ? [] : topicPool.filter(() => r() < 0.3);
    const opts = topics === undefined ? {} : { topics };
    const want = refQueue(bank, cards, T, settings, topics);
    const got = S.buildQueue(bank, cards, T, settings, opts);
    assert.deepEqual(got, want, `session ${i}: ${JSON.stringify({ settings, topics })}`);
    assert.deepEqual(S.buildQueue(bank, cards, T, settings, opts), got, `session ${i}: not deterministic`);
  }
});

// ---------- 7. drillQueue ----------

test("drillQueue puts due reviews first, then new items, then not-yet-due reviews", () => {
  const bank = [
    item("p-new-d2", "probability", 2), item("p-rev-old", "probability"), item("c-rev", "cpp"),
    item("p-new-d1", "probability", 1), item("p-future", "probability"), item("p-future-soon", "probability"),
    item("p-rev-now", "probability"),
  ];
  const cards = {
    "p-rev-old": card(T - 2 * DAY), "c-rev": card(T - 3 * DAY), "p-future": card(T + 2 * DAY),
    "p-future-soon": card(T + 1), "p-rev-now": card(T),
  };
  const want = ["p-rev-old", "p-rev-now", "p-new-d1", "p-new-d2", "p-future-soon", "p-future"];
  assert.deepEqual(S.drillQueue(bank, cards, T, { area: "probability", count: 10 }), want);
  assert.deepEqual(S.drillQueue(bank, cards, T, { area: "probability", count: 3 }), want.slice(0, 3));
  assert.deepEqual(S.drillQueue(bank, cards, T, { area: "probability", count: 0 }), []);
});

test("drillQueue does not interleave areas: due order and difficulty order run across areas", () => {
  const bank = [
    item("p-rev-1", "probability"), item("p-rev-2", "probability"), item("c-rev", "cpp"),
    item("p-new", "probability", 1), item("p-new-2", "probability", 1), item("f-new", "finance", 1), item("s-new", "statistics", 2),
  ];
  const cards = { "p-rev-1": card(T - 5 * DAY), "p-rev-2": card(T - 4 * DAY), "c-rev": card(T - DAY) };
  assert.deepEqual(S.drillQueue(bank, cards, T, { count: 20 }),
    ["p-rev-1", "p-rev-2", "c-rev", "p-new", "p-new-2", "f-new", "s-new"]);
  assert.deepEqual(S.drillQueue(bank, cards, T, { area: null, topics: [], count: 20 }),
    ["p-rev-1", "p-rev-2", "c-rev", "p-new", "p-new-2", "f-new", "s-new"], "a non-string area means every area");
});

test("drillQueue filters by drill.area and by drill.topics with OR semantics", () => {
  const bank = [
    item("d1", "probability", 1, ["conditional-probability"]), item("d2", "probability", 2, ["bayes", "conditional-probability"]),
    item("d3", "probability", 1, ["dice"]), item("d4", "brainteaser", 1, ["conditional-probability"]),
    item("d5", "cpp", 1, ["raii"]),
  ];
  const cards = { d2: card(T - DAY) };
  assert.deepEqual(S.drillQueue(bank, cards, T, { area: "probability", topics: ["conditional-probability"], count: 10 }), ["d2", "d1"]);
  assert.deepEqual(S.drillQueue(bank, cards, T, { area: "probability", topics: ["dice", "bayes"], count: 10 }), ["d2", "d3"]);
  assert.deepEqual(S.drillQueue(bank, cards, T, { topics: ["conditional-probability"], count: 10 }), ["d2", "d1", "d4"]);
  assert.deepEqual(S.drillQueue(bank, cards, T, { area: "probability", topics: [], count: 10 }), ["d2", "d1", "d3"]);
  assert.deepEqual(S.drillQueue(bank, cards, T, { area: "cpp", count: 10 }), ["d5"]);
  assert.deepEqual(S.drillQueue(bank, cards, T, { area: "systems", count: 10 }), []);
});

test("drillQueue has no daily limits: items seen today and newPerDay do not shrink it", () => {
  const bank = [];
  const cards = {};
  for (let i = 0; i < 30; i++) {
    const id = `drill-${String(i).padStart(2, "0")}`;
    bank.push(item(id, "statistics", 1 + (i % 5)));
    if (i < 20) cards[id] = card(T + DAY + i * MINUTE, { seen: T - HOUR });
  }
  const out = S.drillQueue(bank, cards, T, { area: "statistics", count: 30 });
  assert.equal(out.length, 30);
  assert.deepEqual(out.slice(0, 10), [
    "drill-20", "drill-25", "drill-21", "drill-26", "drill-22", "drill-27", "drill-23", "drill-28", "drill-24", "drill-29",
  ], "new items by difficulty, then bank order");
  assert.deepEqual(out.slice(10), bank.slice(0, 20).map((x) => x.id), "not-yet-due reviews by due time");
});

test("drillQueue de-duplicates the bank, ignores unknown cards and accepts a bank object (§A6)", () => {
  const items = [item("a", "probability", 2), item("b", "probability", 1), item("a", "probability", 1), item("c", "probability", 3)];
  const cards = { ghost: card(T - DAY), c: card(T - HOUR) };
  const want = ["c", "b", "a"];
  assert.deepEqual(S.drillQueue(items, cards, T, { area: "probability", count: 10 }), want);
  assert.deepEqual(S.drillQueue({ items }, cards, T, { area: "probability", count: 10 }), want);
  assert.deepEqual(S.drillQueue(null, cards, T, { count: 5 }), []);
  assert.deepEqual(S.drillQueue(items, null, T, { area: "probability", count: 10 }), ["b", "a", "c"]);
});

test("drillQueue is deterministic, does not mutate its inputs, and matches an independent §D7 oracle", () => {
  const r = lcg(99001);
  for (let i = 0; i < 250; i++) {
    const { bank, cards } = randomSession(r, { knownAreasOnly: true });
    const drill = { count: ri(r, 0, 40) };
    if (r() < 0.7) drill.area = pickOf(r, AREAS);
    if (r() < 0.6) drill.topics = ["alpha", "beta", "gamma", "delta", "omega"].filter(() => r() < 0.35);
    const before = clone({ bank, cards, drill });
    const got = S.drillQueue(bank, cards, T, drill);
    assert.deepEqual(got, refDrill(bank, cards, T, drill), `drill ${i}: ${JSON.stringify(drill)}`);
    assert.deepEqual(S.drillQueue(bank, cards, T, drill), got, `drill ${i}: not deterministic`);
    assert.deepEqual({ bank, cards, drill }, before, `drill ${i}: inputs were mutated`);
  }
});

// ---------- 8. masteryOf ----------

test("spec F1.3 masteryOf gives the fraction of items with interval >= 21", () => {
  const cards = {
    a: card(T, { interval: 21 }), b: card(T, { interval: 20 }), c: card(T, { interval: 365 }), d: card(T, { interval: 0 }),
  };
  assert.equal(S.masteryOf(cards, ["a", "b", "c", "never-seen"]), 0.5);
  assert.equal(S.masteryOf(cards, ["a", "c"]), 1);
  assert.equal(S.masteryOf(cards, ["b", "d"]), 0);
  near(S.masteryOf(cards, ["a", "b", "d"]), 1 / 3, "one of three");
  assert.equal(S.masteryOf(null, ["a", "b"]), 0, "no cards: nothing mastered");
  assert.equal(S.masteryOf({}, ["x"]), 0);
});

test("masteryOf of an empty id list is null", () => {
  assert.equal(S.masteryOf({ a: card(T, { interval: 30 }) }, []), null);
  assert.equal(S.masteryOf({}, []), null);
});

// ---------- 9. replayCards ----------

const t0 = new Date(2026, 10, 1, 9, 0).getTime();
const t1 = new Date(2026, 10, 2, 9, 0).getTime();
const t2 = new Date(2026, 10, 3, 9, 0).getTime();
const t3 = new Date(2026, 10, 4, 10, 0).getTime();
function entry(ts, itemId, grade, mode = "self") {
  return { ts, itemId, mode, correct: mode === "auto" ? grade !== "again" : null, grade, secs: 40, answer: mode === "auto" ? "1/2" : "" };
}

test("replayCards rebuilds cards from history in ts order, up to and including uptoTs", () => {
  const history = [
    entry(t2, "A", "good", "auto"),
    entry(t3, "B", "good"),
    entry(t0, "A", "good", "auto"),
    entry(t3 + HOUR, "C", "hard"),
    entry(t1, "B", "again"),
    entry(t1, "A", "good", "auto"),
    entry(t3 + HOUR + 1, "C", "again"), // after uptoTs
    entry(t3 + 2 * HOUR, "D", "good"), // after uptoTs
  ];
  const before = clone(history);
  const out = S.replayCards(history, t3 + HOUR);
  assert.deepEqual(history, before, "history was mutated");
  assert.deepEqual(Object.keys(out).sort(), ["A", "B", "C"]);
  assertCard(out.A, { ease: 2.5, interval: 15, due: t2 + 15 * DAY, reps: 3, lapses: 0, last: t2, seen: t0 }, "A");
  assertCard(out.B, { ease: 2.3, interval: 1, due: t3 + DAY, reps: 1, lapses: 1, last: t3, seen: t1 }, "B");
  assertCard(out.C, { ease: 2.35, interval: 1, due: t3 + HOUR + DAY, reps: 1, lapses: 0, last: t3 + HOUR, seen: t3 + HOUR }, "C");
});

test("replayCards skips entries whose grade is not one of GRADES", () => {
  const history = [
    entry(t0, "A", "good"), { ...entry(t1, "A", null), grade: null }, entry(t2, "A", "skip"),
    { ...entry(t1, "Z", "good"), grade: undefined },
  ];
  const out = S.replayCards(history, T);
  assert.deepEqual(Object.keys(out), ["A"]);
  assertCard(out.A, { ease: 2.5, interval: 1, due: t0 + DAY, reps: 1, lapses: 0, last: t0, seen: t0 }, "A");
});

test("replayCards keeps the history order for entries with equal ts (stable sort)", () => {
  const failThenPass = S.replayCards([entry(t1, "A", "again"), entry(t1, "A", "good")], t3);
  assertCard(failThenPass.A, { ease: 2.3, interval: 1, due: t1 + DAY, reps: 1, lapses: 1, last: t1, seen: t1 }, "again, good");
  const passThenFail = S.replayCards([entry(t1, "A", "good"), entry(t1, "A", "again")], t3);
  assertCard(passThenFail.A, { ease: 2.3, interval: 0, due: t1 + 600000, reps: 0, lapses: 1, last: t1, seen: t1 }, "good, again");
});

test("replayCards of an empty history, or one entirely after uptoTs, is {}", () => {
  assert.deepEqual(S.replayCards([], T), {});
  assert.deepEqual(S.replayCards(null, T), {});
  assert.deepEqual(S.replayCards(undefined, T), {});
  assert.deepEqual(S.replayCards([entry(T + 1, "A", "good")], T), {});
});

test("replayCards reproduces the cards that grading each history entry in turn stores (§H1)", () => {
  const r = lcg(5150);
  const ids = ["q1", "q2", "q3", "q4"];
  const history = [];
  let ts = new Date(2026, 9, 1, 8, 0).getTime();
  for (let i = 0; i < 60; i++) {
    ts += ri(r, 1, 40) * HOUR;
    history.push(entry(ts, pickOf(r, ids), pickOf(r, GRADES)));
  }
  let cards = {};
  for (const e of history) cards = { ...cards, [e.itemId]: S.schedule(cards[e.itemId], e.grade, e.ts) };
  const out = S.replayCards(history, ts);
  assert.deepEqual(Object.keys(out).sort(), Object.keys(cards).sort());
  for (const id of Object.keys(cards)) assertCard(out[id], cards[id], id);
});

// ---------- 10. localDayStart and dueCount ----------

test("localDayStart returns the local midnight k days after the local day of ts", () => {
  assert.equal(S.localDayStart(T), TODAY0);
  assert.equal(S.localDayStart(T, 0), TODAY0);
  assert.equal(S.localDayStart(T, 1), TOMORROW0);
  assert.equal(S.localDayStart(T, 2), DAY_AFTER0);
  assert.equal(S.localDayStart(T, -1), new Date(2026, 10, 3).getTime());
  assert.equal(S.localDayStart(TODAY0), TODAY0, "midnight is the start of its own day");
  assert.equal(S.localDayStart(TODAY0 - 1), new Date(2026, 10, 3).getTime());
  assert.equal(S.localDayStart(new Date(2026, 10, 30, 23, 59, 59, 999).getTime(), 1), new Date(2026, 11, 1).getTime());
  assert.equal(S.localDayStart(new Date(2026, 11, 31, 18, 0).getTime(), 1), new Date(2027, 0, 1).getTime());
  assert.equal(S.localDayStart(new Date(2028, 1, 28, 12, 0).getTime(), 1), new Date(2028, 1, 29).getTime(), "leap day");
});

test("localDayStart is DST-safe: every day of 2026 starts at the local-constructor midnight", () => {
  for (let i = 0; i < 365; i++) {
    for (const h of [0, 12, 23]) {
      const ts = new Date(2026, 0, 1 + i, h, 30).getTime();
      assert.equal(S.localDayStart(ts), new Date(2026, 0, 1 + i).getTime(), `day ${i} ${h}:30, k=0`);
      assert.equal(S.localDayStart(ts, 1), new Date(2026, 0, 2 + i).getTime(), `day ${i} ${h}:30, k=1`);
      assert.equal(S.localDayStart(ts, -1), new Date(2026, 0, i).getTime(), `day ${i} ${h}:30, k=-1`);
    }
  }
});

const dueBank = [
  item("overdue", "probability"), item("early-today", "probability"), item("late-today", "cpp"),
  item("tomorrow-midnight", "probability"), item("tomorrow", "systems"), item("day-after", "probability"),
  item("no-card", "probability"), item("null-due", "probability"), item("chess-due", "chess"),
];
const dueCards = {
  overdue: card(T - 3 * DAY),
  "early-today": card(new Date(2026, 10, 4, 8, 0).getTime()),
  "late-today": card(new Date(2026, 10, 4, 23, 0).getTime()),
  "tomorrow-midnight": card(TOMORROW0),
  tomorrow: card(new Date(2026, 10, 5, 10, 0).getTime()),
  "day-after": card(DAY_AFTER0),
  "null-due": card(null),
  "chess-due": card(T - DAY),
  ghost: card(T - DAY),
};

test("dueCount counts bank items whose card has a finite due strictly before beforeTs", () => {
  assert.equal(S.dueCount(dueBank, dueCards, TOMORROW0), 3);
  assert.equal(S.dueCount(dueBank, dueCards, TOMORROW0 + 1), 4);
  assert.equal(S.dueCount(dueBank, dueCards, DAY_AFTER0), 5);
  assert.equal(S.dueCount(dueBank, dueCards, DAY_AFTER0 + 1), 6);
  assert.equal(S.dueCount(dueBank, dueCards, T - 3 * DAY), 0);
  assert.equal(S.dueCount([], dueCards, DAY_AFTER0), 0);
  assert.equal(S.dueCount(null, null, DAY_AFTER0), 0);
  assert.equal(S.dueCount(dueBank, null, DAY_AFTER0), 0);
});

test("dueCount: 'due today' includes overdue cards, 'due tomorrow' everything before the end of tomorrow (§D9)", () => {
  assert.equal(S.dueCount(dueBank, dueCards, S.localDayStart(T, 1)), 3);
  assert.equal(S.dueCount(dueBank, dueCards, S.localDayStart(T, 2), AREAS), 5);
  assert.equal(S.dueCount(dueBank, dueCards, S.localDayStart(T, 2), ["probability"]), 3);
});

test("dueCount filters by areas (default every area), de-duplicates and ignores unknown cards and areas", () => {
  assert.equal(S.dueCount(dueBank, dueCards, DAY_AFTER0, ["cpp", "systems"]), 2);
  assert.equal(S.dueCount(dueBank, dueCards, DAY_AFTER0, ["finance"]), 0);
  assert.equal(S.dueCount(dueBank, dueCards, DAY_AFTER0, []), 0);
  const dup = [...dueBank, item("overdue", "probability"), item("late-today", "cpp")];
  assert.equal(S.dueCount(dup, dueCards, TOMORROW0), 3, "duplicates count once");
  assert.equal(S.dueCount({ items: dueBank }, dueCards, TOMORROW0), 3, "bank object form (§A6)");
});
