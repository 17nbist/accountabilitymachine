// v4 prep/readiness.js (PrepReadiness): readiness constants, the prepHistory / prepMistakes
// entry builders, the mistakes journal grouping, the practice-log session upserts and the
// "Check my reasoning" request body (V4-CONTRACTS §H, spec §2, §3 F1.4, §8).
// Plain browser script and Node module (§A5): one `var` global, no DOM, no clock, no RNG, and
// no function mutates its inputs.
//
// M3 holds the helpers prep.html's item sessions need: §H1 (history and mistakes), §H5
// mistakeTopics (the session summary's weakest topics), §H10 (practice log) and §H11. The
// scores, NeetCode progress, verdicts, interview material, summary lines and drills (§H2-§H4,
// §H6-§H9) arrive in M6.

var PrepReadiness = (function () {
  const B = typeof PrepBank !== "undefined" ? PrepBank : require("./bank.js");

  // ---------- constants (§A6, §H) ----------

  const AREA_KEYS = Object.freeze(["coding", "probability", "cpp", "systems", "mental", "oa", "market", "mocks"]);
  const MOCK_MODES = Object.freeze(["dsa", "quantdev", "cv", "trader"]);
  const OA_TARGETS = Object.freeze({ eighty: 60, seq: 12, ev: 16 });
  const EV_TOPIC = "expected-value";
  const HISTORY_CAP = 20000;
  const MISTAKES_CAP = 5000;
  const PRACTICE_LOG_CAP = 2000;
  const REASONING_MARKER = "[Check my reasoning]";
  const DEFAULT_MODEL = "anthropic/claude-haiku-5.5"; // the side panel's default (§H11)

  const MAX_SECS = 3600; // §H1 clamp
  const MAX_ANSWER_CHARS = 2000; // §H1: free working is stored at most 2000 characters

  const own = Object.prototype.hasOwnProperty;

  function isObject(x) {
    return typeof x === "object" && x !== null && !Array.isArray(x);
  }

  // ---------- §H1 history and mistakes ----------

  // Raw seconds to the stored integer: rounded, clamped to 0..3600, and 0 for anything that is
  // not a finite number once converted ("42.2" counts as 42.2).
  function normSecs(x) {
    const n = Number(x);
    return Number.isFinite(n) ? Math.min(MAX_SECS, Math.max(0, Math.round(n))) : 0;
  }

  // Exactly the seven prepHistory keys. It receives the raw seconds and normalises them, and it
  // only truncates a string answer (trimming is the UI's job); an mcq index is kept as given.
  function historyEntry(args) {
    const a = isObject(args) ? args : {};
    return {
      ts: a.ts,
      itemId: a.itemId,
      mode: a.mode,
      correct: a.correct,
      grade: a.grade,
      secs: normSecs(a.secs),
      answer: typeof a.answer === "string" ? a.answer.slice(0, MAX_ANSWER_CHARS) : a.answer,
    };
  }

  // Every `again` grade is a mistake; a wrong auto-checked answer always grades `again`.
  function mistakeFor(entry) {
    if (!isObject(entry) || entry.grade !== "again") return null;
    return { ts: entry.ts, itemId: entry.itemId, answer: entry.answer, note: "" };
  }

  // Appends and keeps the newest `cap` entries (the oldest are dropped).
  function appendCapped(list, entries, cap) {
    return [...(list || []), ...(entries || [])].slice(-cap);
  }

  // ---------- §H5 mistakes journal ----------

  const topicCmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

  // [{ topic, count, lastTs, itemIds, entries }]: each mistake whose item is in the bank joins
  // every topic of that item (the first bank item with its id). Entries newest first (stable),
  // topics by count desc, then lastTs desc, then topic.
  function mistakeTopics(mistakes, bank) {
    const byId = B.indexById(bank);
    const groups = new Map();
    for (const m of Array.isArray(mistakes) ? mistakes : []) {
      if (!isObject(m) || typeof m.itemId !== "string" || !own.call(byId, m.itemId)) continue;
      const topics = Array.isArray(byId[m.itemId].topics) ? byId[m.itemId].topics : [];
      for (const topic of new Set(topics)) {
        if (!groups.has(topic)) groups.set(topic, []);
        groups.get(topic).push(m);
      }
    }
    const out = [];
    for (const [topic, list] of groups) {
      const entries = list.slice().sort((a, b) => b.ts - a.ts);
      const itemIds = [...new Set(entries.map((m) => m.itemId))];
      const lastTs = entries.reduce((mx, m) => (m.ts > mx ? m.ts : mx), entries[0].ts);
      out.push({ topic, count: entries.length, lastTs, itemIds, entries });
    }
    return out.sort((a, b) => b.count - a.count || b.lastTs - a.lastTs || topicCmp(a.topic, b.topic));
  }

  // ---------- §H10 practice-log integration ----------

  // The v3 track an answered item counts toward: the four practice areas count problems on
  // `probability`, the two deck areas count minutes on `cpp`. Matched literally.
  function practiceTrack(area) {
    if (B.PRACTICE_AREAS.includes(area)) return "probability";
    if (B.CARD_AREAS.includes(area)) return "cpp";
    return null;
  }

  // A session accumulator to its practiceLog entries, stamped with the session start `ts`.
  function sessionPracticeEntries(acc, ts) {
    const a = isObject(acc) ? acc : {};
    const out = [];
    if (a.probItems >= 1) out.push({ ts, track: "probability", amount: a.probItems, unit: "problems", note: "prep" });
    const minutes = Math.floor(a.cppSecs / 60);
    if (minutes >= 1) out.push({ ts, track: "cpp", amount: minutes, unit: "minutes", note: "prep cards" });
    return out;
  }

  // Replaces (in place) the first entry with the same ts, track and note, or appends; then caps
  // the log at PRACTICE_LOG_CAP like appendCapped. Returns a new array.
  function upsertSessionEntry(practiceLog, entry) {
    const log = Array.isArray(practiceLog) ? practiceLog : [];
    const same = (e) => isObject(e) && e.ts === entry.ts && e.track === entry.track && e.note === entry.note;
    const i = log.findIndex(same);
    const out = i >= 0 ? log.map((e, j) => (j === i ? entry : e)) : [...log, entry];
    return out.slice(-PRACTICE_LOG_CAP);
  }

  // ---------- §H11 "Check my reasoning" ----------

  const REASONING_SYSTEM = [
    "You review a student's reasoning on one quant-interview practice problem.",
    "You get the problem, the student's working and answer, and a reference answer and solution.",
    "Critique the reasoning: say what is right, point to the first real mistake or gap, and",
    "show the step that fixes it. Be brief and concrete, and use $...$ for maths.",
    "Do not grade the attempt and do not give a score or a verdict such as correct or",
    "incorrect: the app has already marked it, and the student grades themselves.",
    "If the reference answer looks wrong, say so and explain why.",
  ].join(" ");

  // The OpenRouter body: exactly model, stream and messages (system, then one user message
  // that starts with REASONING_MARKER). No tools.
  function reasoningRequest(item, working, answer, model) {
    const user =
      `${REASONING_MARKER}\nItem: ${item.id}` +
      `\n\n## Problem\n${item.prompt}` +
      `\n\n## My working\n${working || "(none)"}` +
      `\n\n## My answer\n${answer || "(none)"}` +
      `\n\n## Reference answer\n${B.answerText(item)}` +
      `\n\n## Reference solution\n${item.solution}`;
    return {
      model: model || DEFAULT_MODEL,
      stream: true,
      messages: [
        { role: "system", content: REASONING_SYSTEM },
        { role: "user", content: user },
      ],
    };
  }

  return {
    AREA_KEYS, MOCK_MODES, OA_TARGETS, EV_TOPIC, HISTORY_CAP, MISTAKES_CAP, PRACTICE_LOG_CAP,
    REASONING_MARKER,
    historyEntry, mistakeFor, appendCapped, mistakeTopics,
    practiceTrack, sessionPracticeEntries, upsertSessionEntry, reasoningRequest,
  };
})();
if (typeof module !== "undefined") module.exports = PrepReadiness;
