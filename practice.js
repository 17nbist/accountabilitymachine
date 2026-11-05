// v3 practice tracks: pure helpers shared by the side panel and the content scripts
// (plain script, loaded after shared.js). Nothing here touches chrome.* or the DOM, so
// the whole file is unit-tested in Node via the module.exports hook at the bottom.
//
// Storage shape (chrome.storage.local.practiceLog):
//   [{ ts, track, amount, unit, note }]
// `leetcode` is never written here — it stays auto-detected in lcSolves and is merged
// in at read time so the buddy can't be told "I did 3 today" when it saw 1.

// amTodayKey is a global from shared.js in the extension; in Node tests it's required.
var amTodayKey = typeof amTodayKey === "function" ? amTodayKey : require("./shared.js").amTodayKey;

const AM_TRACKS = {
  leetcode: { unit: "solves", label: "LC", auto: true },
  zetamac: { unit: "score", label: "Zetamac", auto: true, best: true },
  probability: { unit: "problems", label: "Prob" },
  cpp: { unit: "minutes", label: "C++" },
  project: { unit: "minutes", label: "Project" },
  mock: { unit: "count", label: "Mock" },
};
const AM_TRACK_ORDER = ["leetcode", "zetamac", "probability", "cpp", "project", "mock"];
const AM_PRACTICE_MAX_AMOUNT = 10000;
const AM_PRACTICE_NOTE_MAX = 200;
const AM_SOLVE_CAP_MS = 3 * 60 * 60 * 1000; // an open-overnight tab is not a 9h solve
const AM_MEDIAN_WINDOW = 10;

// Dated checkpoints the Sunday review grades against (also listed in DEFAULT_PLAN).
const AM_CHECKPOINTS = [
  { due: "2027-02-28", label: "~100 problems solved, typical Medium in ~20 min (NeetCode 150, Zetamac daily, Green Book ch. 1-3)" },
  { due: "2027-04-30", label: "Order book project with benchmarks on GitHub; C++ fundamentals solid; some Hards done" },
  { due: "2027-06-30", label: "Zetamac 50+, 5+ referral contacts, weekly mocks and timed OAs running" },
  { due: "2027-09-30", label: "Maintenance mode during Barclays: 1 h weekdays + weekend blocks, applied in week one of each opening" },
];

// The pre-v3 default plan, verbatim — used once to decide whether a stored plan is
// still untouched (safe to replace) or has been edited by the buddy (leave it).
const AM_V2_DEFAULT_PLAN = `Phase 1 (current): LeetCode's official DSA crash course — finish every module honestly.
Phase 2 (next): NeetCode 150 in Python, ~15 problems/week, clearing the re-solve queue before new problems.
Phase 2 rule: one timed mock interview per week from week 3 onward.
Hard deadline: OA-ready by mid-September 2026, when new-grad applications open.`;

function amIsV2DefaultPlan(plan) {
  return typeof plan === "string" && plan.trim() === AM_V2_DEFAULT_PLAN.trim();
}

// First checkpoint whose due date is today or later, with whole days left.
function amNextCheckpoint(checkpoints, now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  for (const c of checkpoints || []) {
    const [y, m, d] = c.due.split("-").map(Number);
    const due = new Date(y, m - 1, d);
    if (due >= today) {
      return { ...c, daysLeft: Math.round((due - today) / 86400000) };
    }
  }
  return null;
}

// ---------- practice log ----------

// Validate a self-report (from the log_practice tool) into a storable entry, or
// { error } with a message the model can act on.
function amPracticeEntry(args, ts = Date.now()) {
  const a = args || {};
  const track = typeof a.track === "string" ? a.track.trim().toLowerCase() : "";
  const spec = AM_TRACKS[track];
  if (!spec) return { error: `unknown track "${a.track}" — use one of ${Object.keys(AM_TRACKS).join(", ")}` };
  if (track === "leetcode") return { error: "leetcode is auto-detected from Accepted verdicts — never logged by hand" };
  const amount = Number(a.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > AM_PRACTICE_MAX_AMOUNT) {
    return { error: `amount must be a number between 1 and ${AM_PRACTICE_MAX_AMOUNT} (${spec.unit})` };
  }
  const note = typeof a.note === "string" ? a.note.trim().slice(0, AM_PRACTICE_NOTE_MAX) : "";
  return { ts, track, amount, unit: spec.unit, note };
}

function amEmptyTotals() {
  const t = {};
  for (const k of AM_TRACK_ORDER) t[k] = 0;
  return t;
}

function amAccumulate(totals, entry) {
  const spec = AM_TRACKS[entry.track];
  if (!spec) return;
  if (spec.best) totals[entry.track] = Math.max(totals[entry.track], entry.amount);
  else totals[entry.track] += entry.amount;
}

// Per-track totals for one day. Zetamac is best-of-day (a score, not a quantity);
// everything else sums. LeetCode comes from the auto-detected solve log.
function amTodayTotals(practiceLog, lcSolves, dayKey) {
  const totals = amEmptyTotals();
  for (const e of practiceLog || []) {
    if (amTodayKey(new Date(e.ts)) === dayKey) amAccumulate(totals, e);
  }
  totals.leetcode = (lcSolves || []).filter(s => amTodayKey(new Date(s.ts)) === dayKey).length;
  return totals;
}

function amTrackPiece(track, value) {
  const spec = AM_TRACKS[track];
  const suffix = spec.unit === "minutes" ? "m" : "";
  return `${spec.label} ${value}${suffix}`;
}

// "Today: LC 1/2 · Zetamac 47 · Prob 0 · C++ 0m · Project 25m · Mock 0"
function amTodayLine(totals, target) {
  const pieces = AM_TRACK_ORDER.map(k =>
    k === "leetcode" && target ? `LC ${totals.leetcode}/${target}` : amTrackPiece(k, totals[k]));
  return `Today: ${pieces.join(" · ")}`;
}

// ---------- zetamac ----------

function amParseZetamacScore(text) {
  const m = String(text || "").match(/Score:\s*(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

function amParseZetamacDuration(text) {
  const m = String(text || "").match(/Seconds left:\s*(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

// Last 7 scores oldest→newest, best ever, total games.
function amZetamacStats(practiceLog) {
  const games = (practiceLog || []).filter(e => e.track === "zetamac").sort((a, b) => a.ts - b.ts);
  if (!games.length) return { last: [], best: null, count: 0 };
  return {
    last: games.slice(-7).map(g => g.amount),
    best: Math.max(...games.map(g => g.amount)),
    count: games.length,
  };
}

// ---------------- solve timing ----------

function amSolveSecs(firstSeenTs, acceptTs, capMs = AM_SOLVE_CAP_MS) {
  if (!Number.isFinite(firstSeenTs) || !Number.isFinite(acceptTs)) return null;
  const ms = acceptTs - firstSeenTs;
  if (ms <= 0 || ms > capMs) return null;
  return Math.round(ms / 1000);
}

// Median seconds over the most recent `window` Medium solves that carry a timing.
function amMedianMediumSecs(lcSolves, window = AM_MEDIAN_WINDOW) {
  const timed = (lcSolves || [])
    .filter(s => s.difficulty === "Medium" && Number.isFinite(s.secs))
    .sort((a, b) => a.ts - b.ts)
    .slice(-window)
    .map(s => s.secs)
    .sort((a, b) => a - b);
  if (!timed.length) return null;
  const mid = timed.length >> 1;
  return timed.length % 2 ? timed[mid] : (timed[mid - 1] + timed[mid]) / 2;
}

function amSolveTimeLine(medianSecs, n) {
  if (medianSecs === null || medianSecs === undefined) return "Median Medium solve time: no timed Medium solves yet.";
  return `Median Medium solve time (last ${n} timed): ${Math.round(medianSecs / 60)} min.`;
}

// ---------- interview modes ----------

const AM_INTERVIEW_COMMON = `Give NO solutions and NO code. Nudge with questions only. Stay terse and professional.
When the user ends the interview, output a short verdict: what went well, what was weak, and
scores out of 10 — then call remember to store the verdict under the key interview_MODE_YYYYMMDD
(today's date, e.g. interview_MODE_20270115).`;

const AM_INTERVIEW_MODES = {
  dsa: {
    label: "DSA",
    emoji: "🎤",
    prompt: `You are now running a MOCK TECHNICAL INTERVIEW — drop the coach persona.
You are a senior engineer at a top tech company conducting a timed DSA screen. Rules:
- If no problem is chosen yet, pick ONE (prefer the top item in the re-solve queue; else call
  pick_problem with difficulty/tags fitting the user's current plan phase) and state it clearly
  with constraints. Offer open_problem so they can code it. Then STOP and make them talk.
- Force the interview loop: (1) they restate the problem and clarify, (2) they explain their
  APPROACH and its time/space complexity BEFORE writing any code, (3) only then do they code it on
  LeetCode. Do not let them skip to code. Probe edge cases and complexity like a real interviewer.
- Score problem-solving, communication, and code.
${AM_INTERVIEW_COMMON.replace(/MODE/g, "dsa")}`,
  },
  quantdev: {
    label: "Quant dev",
    emoji: "⚙️",
    prompt: `You are now running a MOCK QUANT DEVELOPER INTERVIEW — drop the coach persona.
You are a senior C++ engineer at a mid-tier trading firm (Optiver / IMC / G-Research level) running
a verbal screen. No editor is needed — everything is spoken. Rules:
- Rotate through three areas, one question at a time, waiting for the answer each time:
  (1) C++: memory and ownership, RAII, move semantics, copy elision, STL containers and their
  complexity, undefined behaviour, templates basics. (2) Systems: CPU caches and cache lines, false
  sharing, branch prediction, concurrency primitives, lock-free basics, what makes code low-latency.
  (3) ONE light probability or expected-value question (dice, coins, simple conditional probability).
- Push for precision: ask "why", ask for the complexity, ask what breaks under load.
- Score C++ depth, systems intuition, and probability clarity.
${AM_INTERVIEW_COMMON.replace(/MODE/g, "quantdev")}`,
  },
  cv: {
    label: "Defend CV",
    emoji: "📄",
    prompt: `You are now running a "DEFEND YOUR CV" INTERVIEW — drop the coach persona.
You are a sceptical hiring manager who has read the user's CV and suspects the projects were
AI-assisted. Deep-dive one project at a time, in this order unless they steer: dcheck, the Deel
write-back integration, ReviewBot, and the startup prototype at Fleet AI. Rules:
- For each: what problem it solved, the architecture, the hardest trade-off, a concrete failure
  mode they hit, what they would change now, and what they personally wrote versus generated.
- Interrupt vague answers. Ask for specifics: numbers, names of components, the actual bug.
- Score ownership (could they rebuild it alone?), technical depth, and honesty.
${AM_INTERVIEW_COMMON.replace(/MODE/g, "cv")}`,
  },
  trader: {
    label: "Trader",
    emoji: "📈",
    prompt: `You are now running a MOCK TRADER SCREEN — drop the coach persona.
You are an interviewer at a prop trading firm running rapid-fire mental maths and expected value,
answered out loud and fast. Rules:
- Fire ONE question at a time: two-digit multiplication, percentages, fractions to decimals, then
  expected value and simple bets (dice, cards, coin sequences, "would you take this bet and at what
  price"). Keep a brisk pace — ask for the answer within ~15 seconds and note when they are slow.
- Make them state confidence and reasoning in one line, then move on. Track hits and misses.
- Score speed, accuracy, and expected-value reasoning.
${AM_INTERVIEW_COMMON.replace(/MODE/g, "trader")}`,
  },
};

function amInterviewKey(mode, d = new Date()) {
  const ymd = amTodayKey(d).replace(/-/g, "");
  return `interview_${mode}_${ymd}`;
}

// ---------- sunday review ----------

// Per-track totals over the trailing 7 days (now-7d, now].
function amWeekTotals(practiceLog, lcSolves, nowTs = Date.now()) {
  const since = nowTs - 7 * 86400000;
  const inWindow = e => e.ts > since && e.ts <= nowTs;
  const totals = amEmptyTotals();
  for (const e of practiceLog || []) if (inWindow(e)) amAccumulate(totals, e);
  totals.leetcode = (lcSolves || []).filter(inWindow).length;
  return totals;
}

// v4: `prep` (the prepWeeklyLine) is inserted verbatim right after the checkpoint sentence,
// only when it is a non-empty string; anything else gives the v3 text byte for byte.
function amWeeklyReviewTrigger({ week, streak, zetamac, medianMediumSecs, resolveDebt, checkpoint, solvedTotal, prep }) {
  const totals = AM_TRACK_ORDER.map(k => amTrackPiece(k, week[k])).join(" · ");
  const z = zetamac && zetamac.count
    ? `Zetamac last games: ${zetamac.last.join(" → ")} (best ${zetamac.best}, ${zetamac.count} games logged)`
    : "Zetamac: no Zetamac games logged yet";
  const solve = medianMediumSecs !== null && medianMediumSecs !== undefined
    ? `Median Medium solve time: ${Math.round(medianMediumSecs / 60)} min`
    : "Median Medium solve time: no timed Medium solves yet";
  const cp = checkpoint
    ? `Next checkpoint: ${checkpoint.due} (${checkpoint.daysLeft} days left) — ${checkpoint.label}`
    : "Next checkpoint: no dated checkpoint left in the plan";
  const total = Number.isFinite(solvedTotal) ? `LeetCode total: ${solvedTotal} solved. ` : "";
  const prepText = typeof prep === "string" && prep.length > 0 ? `${prep} ` : "";
  return `[Automatic Sunday weekly review — run it now. Week totals: ${totals}. Streak: ${streak} day(s). ` +
    `${total}${z}. ${solve}. Re-solve debt: ${resolveDebt} due. ${cp}. ${prepText}` +
    `Grade the week against the next checkpoint honestly (on track / behind / ahead, and why), name ` +
    `the one thing to change next week, and call update_plan if the plan itself needs adjusting. ` +
    `Then get me to commit to today's target. Keep it under 8 sentences.]`;
}

if (typeof module !== "undefined") {
  module.exports = {
    AM_TRACKS, AM_TRACK_ORDER, AM_CHECKPOINTS, AM_V2_DEFAULT_PLAN, AM_INTERVIEW_MODES,
    AM_SOLVE_CAP_MS, AM_MEDIAN_WINDOW,
    amIsV2DefaultPlan, amNextCheckpoint, amPracticeEntry, amTodayTotals, amTodayLine,
    amParseZetamacScore, amParseZetamacDuration, amZetamacStats, amSolveSecs,
    amMedianMediumSecs, amSolveTimeLine, amInterviewKey, amWeekTotals, amWeeklyReviewTrigger,
  };
}
