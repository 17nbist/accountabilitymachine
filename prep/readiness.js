// v4 prep/readiness.js (PrepReadiness): readiness scores, NeetCode 150 progress, interview
// verdicts and material, the mistakes journal, the side-panel Prep / Sunday lines, buddy drills,
// the prepHistory / prepMistakes entry builders, the practice-log session upserts and the
// "Check my reasoning" request body (V4-CONTRACTS §H, spec §2, §3 F1.4, §7, §8, §9).
// Plain browser script and Node module (§A5): one `var` global, no DOM, no clock (Date.now() only
// as amDrillEntry's default `ts`), no RNG, and no function mutates its inputs.
//
// Every `bank` here is an Item[] or an object with an `items` array, de-duplicated by id first
// (the first occurrence in bank order wins, as PrepBank.indexById), per the §H preamble.

var PrepReadiness = (function () {
  const B = typeof PrepBank !== "undefined" ? PrepBank : require("./bank.js");
  const S = typeof PrepSrs !== "undefined" ? PrepSrs : require("./srs.js");
  const amMedianMediumSecs = typeof globalThis.amMedianMediumSecs === "function"
    ? globalThis.amMedianMediumSecs : require("../practice.js").amMedianMediumSecs;
  const amTodayKey = typeof globalThis.amTodayKey === "function"
    ? globalThis.amTodayKey : require("../shared.js").amTodayKey;

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

  const DAY = S.DAY;
  const HOUR = 3600000;
  const MAX_SECS = 3600; // §H1 clamp
  const MAX_ANSWER_CHARS = 2000; // §H1: free working is stored at most 2000 characters
  const MAX_DRILL_TOPICS = 10; // §H9
  const DRILL_NOTE_MS = 48 * HOUR; // §H9: a finished drill is reported for 48 h
  const WEAKEST_WINDOW_MS = 30 * DAY; // §H5
  const NC150_TOTAL = 150; // §H3: coding divides by 150 literally, not by the list length
  const VERDICT_KEY_RE = /^interview_(dsa|quantdev|cv|trader)_(\d{8})$/; // §H4

  const own = Object.prototype.hasOwnProperty;

  // ---------- small shared helpers ----------

  function isObject(x) {
    return typeof x === "object" && x !== null && !Array.isArray(x);
  }

  // A list parameter: null, undefined or a non-array read as [] (§A3); non-object elements are
  // dropped, since no §H list holds anything else.
  function objects(list) {
    return Array.isArray(list) ? list.filter(isObject) : [];
  }

  // A stored number, or 0 when it is not finite (a corrupted record), so a bad field never turns
  // a score into NaN.
  function num(x) {
    return Number.isFinite(x) ? x : 0;
  }

  const clamp = (x) => Math.min(1, Math.max(0, x));
  const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const strCmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

  // Entries by ts ascending; Array.prototype.sort is stable, so equal ts keep input order. A
  // non-finite ts sorts as the oldest.
  const tsKey = (e) => (Number.isFinite(e.ts) ? e.ts : -Infinity);
  function byTs(list) {
    return list.slice().sort((a, b) => strCmp(tsKey(a), tsKey(b)));
  }

  // "Last N" (§H3): stable-sort by ts and take the final N.
  function lastN(list, n) {
    return byTs(list).slice(-n);
  }

  // The share of `list` matching `pred`, or 0 for an empty list (§H3 "share among the last N").
  function share(list, pred) {
    return list.length ? list.filter(pred).length / list.length : 0;
  }

  // The bank de-duplicated by id (first wins) in bank order, plus an id -> item lookup. A Map
  // keeps ids such as "constructor" or "__proto__" ordinary.
  function uniqueBank(bank) {
    const byId = new Map();
    for (const it of objects(Array.isArray(bank) ? bank : bank && bank.items)) {
      if (typeof it.id === "string" && !byId.has(it.id)) byId.set(it.id, it);
    }
    return { items: [...byId.values()], lookup: (id) => byId.get(id) || null };
  }

  // cards[id] when it is an own object property, else null (§D1: null / non-object is missing).
  function cardOf(cards, id) {
    if (!cards || typeof cards !== "object" || !own.call(cards, id)) return null;
    return isObject(cards[id]) ? cards[id] : null;
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

  // ---------- §H2 NeetCode 150 ----------

  // A list problem is solved iff some solve has exactly its slug (any time, noAI ignored).
  // Problems that are not objects are skipped, so total counts the real problem records.
  function nc150Progress(list, lcSolves) {
    const problems = objects(isObject(list) ? list.problems : null);
    const solvedSlugs = new Set(objects(lcSolves).map((s) => s.slug).filter((s) => typeof s === "string"));
    const byPattern = new Map();
    let solved = 0;
    let next = null;
    for (const p of problems) {
      const done = typeof p.slug === "string" && solvedSlugs.has(p.slug);
      if (!byPattern.has(p.pattern)) byPattern.set(p.pattern, { solved: 0, total: 0 });
      const g = byPattern.get(p.pattern);
      g.total++;
      if (done) {
        g.solved++;
        solved++;
      } else if (next === null) {
        next = p;
      }
    }
    return { solved, total: problems.length, byPattern: Object.fromEntries(byPattern), next };
  }

  // ---------- §H4 verdicts ----------

  // The mean of every "N/10" (N <= 10) in the text, unrounded; null when none is kept.
  function parseVerdictScore(text) {
    if (typeof text !== "string") return null;
    const kept = [];
    for (const m of text.matchAll(/(\d+(\.\d+)?)\s*\/\s*10/g)) {
      const v = parseFloat(m[1]);
      if (v <= 10) kept.push(v);
    }
    return kept.length ? mean(kept) : null;
  }

  // "interview_dsa_20270115" -> { mode: "dsa", day: "2027-01-15" }, or null for any other key.
  function verdictKey(key) {
    const m = VERDICT_KEY_RE.exec(key);
    if (!m) return null;
    const d = m[2];
    return { mode: m[1], day: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` };
  }

  // { dsa, quantdev, cv, trader }: each the parseable verdicts as { day, score }, by day.
  function mockVerdicts(facts) {
    const out = {};
    for (const mode of MOCK_MODES) out[mode] = [];
    if (!isObject(facts)) return out;
    for (const key of Object.keys(facts)) {
      const v = verdictKey(key);
      if (!v) continue;
      const score = parseVerdictScore(facts[key]);
      if (score !== null) out[v.mode].push({ day: v.day, score });
    }
    for (const mode of MOCK_MODES) out[mode].sort((a, b) => strCmp(a.day, b.day));
    return out;
  }

  // ---------- §H3 area scores ----------

  const FIELDS = ["bank", "cards", "history", "lcSolves", "nc150", "practiceLog", "oaRuns", "mmRuns", "facts"];

  // The nine inputs, each missing or undefined one read as null (§H3).
  function readInputs(inputs) {
    const o = isObject(inputs) ? inputs : {};
    const out = {};
    for (const k of FIELDS) out[k] = o[k] === undefined ? null : o[k];
    return out;
  }

  // An area score from [weight, component] pairs: each component clamped to [0, 1], the weighted
  // sum rounded (§H3). The callers return null first when the area has no data.
  function weighted(parts) {
    return Math.round(parts.reduce((s, [w, c]) => s + w * clamp(c), 0));
  }

  function codingScore(lcSolves, nc150) {
    const solves = objects(lcSolves);
    if (!solves.length) return null;
    const c1 = nc150 ? nc150Progress(nc150, solves).solved / NC150_TOTAL : 0;
    const m = amMedianMediumSecs(solves);
    const c2 = m === null ? 0 : Math.min(1, 1200 / m);
    const c3 = share(lastN(solves, 30), (s) => s.noAI === true);
    return weighted([[50, c1], [30, c2], [20, c3]]);
  }

  // Mastery over every bank item in `areas` (never-seen ones included), or 0 for none.
  function masteryIn(items, cards, areas) {
    const ids = items.filter((it) => areas.includes(it.area)).map((it) => it.id);
    const m = S.masteryOf(cards, ids);
    return m === null ? 0 : m;
  }

  // mapped: [{ e, item }] for the history entries whose item is in the bank.
  function probabilityScore(items, cards, mapped) {
    const areas = ["probability", "brainteaser"];
    const mine = mapped.filter((x) => areas.includes(x.item.area)).map((x) => x.e);
    if (!mine.length) return null;
    const autoE = mine.filter((e) => e.mode === "auto");
    const acc = share(lastN(autoE, 50), (e) => e.correct === true);
    return weighted([[60, masteryIn(items, cards, areas)], [40, acc]]);
  }

  // cpp and systems: 70 x mastery + 30 x the answerOk share of the last 50 answers, any mode.
  function deckScore(items, cards, mapped, area) {
    const mine = mapped.filter((x) => x.item.area === area).map((x) => x.e);
    if (!mine.length) return null;
    const acc = share(lastN(mine, 50), S.answerOk);
    return weighted([[70, masteryIn(items, cards, [area])], [30, acc]]);
  }

  function mentalScore(practiceLog) {
    const games = objects(practiceLog).filter((e) => e.track === "zetamac");
    if (!games.length) return null;
    return weighted([[100, Math.min(1, mean(lastN(games, 5).map((e) => num(e.amount))) / 60)]]);
  }

  function oaScore(oaRuns) {
    const runs = objects(oaRuns);
    const kinds = Object.keys(OA_TARGETS);
    if (!runs.some((r) => kinds.includes(r.kind))) return null;
    let sum = 0;
    for (const k of kinds) {
      const recent = lastN(runs.filter((r) => r.kind === k), 5);
      if (recent.length) sum += clamp(Math.min(1, Math.max(...recent.map((r) => num(r.score))) / OA_TARGETS[k]));
    }
    return weighted([[100, sum / kinds.length]]);
  }

  // Pooled per-trade edge over the last 5 games; null when those games have no trades.
  function marketScore(mmRuns) {
    const games = lastN(objects(mmRuns), 5);
    const trades = games.reduce((s, g) => s + num(g.trades), 0);
    if (!(trades > 0)) return null;
    const x = games.reduce((s, g) => s + num(g.edge), 0) / trades;
    return weighted([[100, 0.5 + x / 2]]);
  }

  function mocksScore(facts) {
    const v = mockVerdicts(facts);
    const modeMeans = MOCK_MODES.filter((m) => v[m].length).map((m) => mean(v[m].slice(-3).map((x) => x.score)));
    if (!modeMeans.length) return null;
    return weighted([[100, mean(modeMeans) / 10]]);
  }

  // { coding, probability, cpp, systems, mental, oa, market, mocks, overall }: integers 0..100,
  // or null for an area with no data (overall: null when every area is null).
  function areaScores(inputs) {
    const inp = readInputs(inputs);
    const { items, lookup } = uniqueBank(inp.bank);
    const mapped = [];
    for (const e of objects(inp.history)) {
      const item = lookup(e.itemId);
      if (item) mapped.push({ e, item });
    }
    const out = {
      coding: codingScore(inp.lcSolves, inp.nc150),
      probability: probabilityScore(items, inp.cards, mapped),
      cpp: deckScore(items, inp.cards, mapped, "cpp"),
      systems: deckScore(items, inp.cards, mapped, "systems"),
      mental: mentalScore(inp.practiceLog),
      oa: oaScore(inp.oaRuns),
      market: marketScore(inp.mmRuns),
      mocks: mocksScore(inp.facts),
    };
    const present = AREA_KEYS.map((k) => out[k]).filter((v) => v !== null);
    out.overall = present.length ? Math.round(mean(present)) : null;
    return out;
  }

  // areaScores on the inputs as they stood at cutoffTs (inclusive): dated lists truncated, cards
  // replayed from history, later-dated verdict keys removed; bank and nc150 unchanged.
  // cutoffTs must be a number (Infinity keeps everything); anything else throws.
  function areaScoresAt(inputs, cutoffTs) {
    if (typeof cutoffTs !== "number" || Number.isNaN(cutoffTs)) {
      throw new TypeError(`areaScoresAt: cutoffTs must be a time in ms, got ${String(cutoffTs)}`);
    }
    const inp = readInputs(inputs);
    const upTo = (list) => (Array.isArray(list) ? list.filter((e) => isObject(e) && e.ts <= cutoffTs) : list);
    return areaScores({
      ...inp,
      history: upTo(inp.history),
      lcSolves: upTo(inp.lcSolves),
      practiceLog: upTo(inp.practiceLog),
      oaRuns: upTo(inp.oaRuns),
      mmRuns: upTo(inp.mmRuns),
      cards: S.replayCards(objects(inp.history), cutoffTs),
      facts: factsUpTo(inp.facts, cutoffTs),
    });
  }

  // A copy of facts without the verdict keys dated after the local day of cutoffTs. An infinite
  // cutoff has no local day: Infinity keeps every verdict and -Infinity drops them all.
  function factsUpTo(facts, cutoffTs) {
    if (!isObject(facts)) return facts;
    const lastDay = Number.isFinite(cutoffTs) ? amTodayKey(new Date(cutoffTs)) : null;
    const keep = (key) => {
      const v = verdictKey(key);
      if (!v) return true;
      return lastDay === null ? cutoffTs > 0 : v.day <= lastDay;
    };
    return Object.fromEntries(Object.keys(facts).filter(keep).map((k) => [k, facts[k]]));
  }

  // The AREA_KEYS whose score is a number below 60, in order.
  function under60(scores) {
    const s = isObject(scores) ? scores : {};
    return AREA_KEYS.filter((k) => typeof s[k] === "number" && s[k] < 60);
  }

  // ---------- §H5 mistakes journal ----------

  // [{ topic, count, lastTs, itemIds, entries }]: each mistake whose item is in the bank joins
  // every topic of that item (the first bank item with its id). Entries newest first (stable),
  // topics by count desc, then lastTs desc, then topic.
  function mistakeTopics(mistakes, bank) {
    const { lookup } = uniqueBank(bank);
    const groups = new Map();
    for (const m of objects(mistakes)) {
      const it = lookup(m.itemId);
      if (!it) continue;
      for (const topic of new Set(Array.isArray(it.topics) ? it.topics : [])) {
        if (!groups.has(topic)) groups.set(topic, []);
        groups.get(topic).push(m);
      }
    }
    const out = [];
    for (const [topic, list] of groups) {
      // ts descending; the sort is stable, so equal ts keep input order (a non-finite ts last).
      const entries = list.slice().sort((a, b) => strCmp(tsKey(b), tsKey(a)));
      const itemIds = [...new Set(entries.map((m) => m.itemId))];
      out.push({ topic, count: entries.length, lastTs: entries[0].ts, itemIds, entries });
    }
    const last = (t) => tsKey({ ts: t.lastTs });
    return out.sort((a, b) => b.count - a.count || strCmp(last(b), last(a)) || strCmp(a.topic, b.topic));
  }

  // The top n topics of the mistakes made in the 30 days before now (exclusive of the boundary).
  function weakestTopics(mistakes, bank, now, n = 3) {
    const recent = objects(mistakes).filter((m) => m.ts > now - WEAKEST_WINDOW_MS);
    return mistakeTopics(recent, bank).slice(0, n).map((t) => t.topic);
  }

  // ---------- §H6 interview material (spec §7) ----------

  function inMaterialPool(mode, it) {
    if (mode === "quantdev") return it.area === "cpp" || it.area === "systems";
    if (mode === "trader") {
      return it.area === "probability" || it.area === "brainteaser" ||
        (Array.isArray(it.topics) && it.topics.includes(EV_TOPIC));
    }
    return false;
  }

  // The n weakest pool items: carded first, then interval asc, lapses desc, wrong answers desc,
  // difficulty asc (a missing difficulty sorts last), then bank order.
  function pickInterviewMaterial(bank, cards, history, mode, n = 3) {
    const pool = uniqueBank(bank).items.filter((it) => inMaterialPool(mode, it));
    if (!pool.length) return [];
    const wrong = new Map();
    for (const e of objects(history)) {
      if (typeof e.itemId === "string" && !S.answerOk(e)) wrong.set(e.itemId, (wrong.get(e.itemId) || 0) + 1);
    }
    const rows = pool.map((it, idx) => {
      const c = cardOf(cards, it.id);
      return {
        it, idx,
        carded: !!c && Number.isFinite(c.due),
        interval: c ? num(c.interval) : 0,
        lapses: c ? num(c.lapses) : 0,
        wrong: wrong.get(it.id) || 0,
        difficulty: Number.isFinite(it.difficulty) ? it.difficulty : Infinity,
      };
    });
    rows.sort((a, b) =>
      (b.carded - a.carded) ||
      strCmp(a.interval, b.interval) ||
      strCmp(b.lapses, a.lapses) ||
      (b.wrong - a.wrong) ||
      strCmp(a.difficulty, b.difficulty) ||
      (a.idx - b.idx));
    return rows.slice(0, n).map((r) => r.it);
  }

  // Whitespace runs collapsed to one space and trimmed; cut to n characters plus "…".
  function oneLine(s, n) {
    const t = String(s == null ? "" : s).replace(/\s+/g, " ").trim();
    return t.length > n ? t.slice(0, n) + "…" : t;
  }

  const MATERIAL_HEADER = "## Material: the user's weakest bank items — quiz these first, one at a time";

  function interviewMaterialBlock(items) {
    const list = objects(items);
    if (!list.length) return "";
    const lines = list.map((it, i) => {
      const topics = Array.isArray(it.topics) ? it.topics.join(", ") : "";
      return `${i + 1}. [${it.area} · ${topics}] ${oneLine(it.prompt, 300)} — reference answer: ${oneLine(B.answerText(it), 200)}`;
    });
    return [MATERIAL_HEADER, ...lines].join("\n");
  }

  // ---------- §H7 / §H8 side-panel lines (spec §9) ----------

  const fmtScore = (v) => (Number.isFinite(v) ? String(v) : "n/a");

  function prepSummaryLine(args) {
    const a = isObject(args) ? args : {};
    const s = isObject(a.scores) ? a.scores : {};
    const due = Number.isFinite(a.dueToday) ? a.dueToday : 0;
    const weakest = Array.isArray(a.weakest) && a.weakest.length ? a.weakest.join(", ") : "none";
    return `Prep: overall ${fmtScore(s.overall)} · prob ${fmtScore(s.probability)} · cpp ${fmtScore(s.cpp)} · ` +
      `sys ${fmtScore(s.systems)} · due today ${due} · weakest: ${weakest}`;
  }

  // [label, area] for the week's counts, and [label, score key] for the score changes.
  const WEEK_AREAS = [["prob", "probability"], ["brain", "brainteaser"], ["stats", "statistics"],
    ["fin", "finance"], ["cpp", "cpp"], ["sys", "systems"]];
  const CHANGE_KEYS = [["overall", "overall"], ["coding", "coding"], ["prob", "probability"], ["cpp", "cpp"],
    ["sys", "systems"], ["mental", "mental"], ["oa", "oa"], ["market", "market"], ["mocks", "mocks"]];

  function changePiece(cur, prev) {
    if (cur === null) return "n/a";
    if (prev === null) return `${cur} (new)`;
    const d = cur - prev;
    return `${cur} (${d > 0 ? "+" : ""}${d})`;
  }

  // The Sunday review's prep sentence: the week (now − 7 days, now] of bank-mapped history, and
  // each score now (stored cards) against last Sunday, now − 7 days (replayed cards).
  function prepWeeklyLine(inputs) {
    const o = isObject(inputs) ? inputs : {};
    const now = o.now;
    if (!Number.isFinite(now)) throw new TypeError(`prepWeeklyLine: now must be a time in ms, got ${String(now)}`);
    const then = now - 7 * DAY;
    const { lookup } = uniqueBank(o.bank);
    const counts = new Map(WEEK_AREAS.map(([, area]) => [area, 0]));
    let total = 0;
    let autoN = 0;
    let autoOk = 0;
    for (const e of objects(o.history)) {
      const it = e.ts > then && e.ts <= now ? lookup(e.itemId) : null;
      if (!it || !counts.has(it.area)) continue;
      counts.set(it.area, counts.get(it.area) + 1);
      total++;
      if (e.mode === "auto") {
        autoN++;
        if (e.correct === true) autoOk++;
      }
    }
    const acc = autoN ? `${Math.round((100 * autoOk) / autoN)}%` : "n/a";
    const cur = areaScores(o);
    const prev = areaScoresAt(o, then);
    const week = WEEK_AREAS.map(([label, area]) => `${label} ${counts.get(area)}`).join(" · ");
    const pieces = CHANGE_KEYS.map(([label, key]) => `${label} ${changePiece(cur[key], prev[key])}`).join(" · ");
    return `Prep week: ${total} answered (${week}), auto-checked accuracy ${acc}. ` +
      `Score change since last Sunday: ${pieces}.`;
  }

  // ---------- §H9 buddy drills (spec §9 F7) ----------

  // A pending drill from assign_drill's args, or { error } (keywords area, count, topic).
  // bankTopics: the loaded bank's topicSet, or null / not an array when no bank is loaded, in
  // which case topics are accepted unchecked and prep.html filters them at drill start.
  function amDrillEntry(args, ts = Date.now(), bankTopics = null) {
    if (!isObject(args)) return { error: `area is required: pass { area, count, topics? }` };
    const area = String(args.area).trim().toLowerCase();
    if (!B.AREAS.includes(area)) {
      return { error: `area must be one of ${B.AREAS.join(", ")} (got "${String(args.area)}")` };
    }
    const count = Number(args.count);
    if (!Number.isInteger(count) || count < 1 || count > 50) {
      return { error: `count must be a whole number from 1 to 50 (got ${String(args.count)})` };
    }
    let topics = [];
    if (args.topics !== undefined && args.topics !== null) {
      if (!Array.isArray(args.topics) || !args.topics.every((t) => typeof t === "string")) {
        return { error: "topics must be an array of topic names" };
      }
      const norm = args.topics.map((t) => t.trim().toLowerCase());
      const bad = norm.filter((t) => !B.TOPIC_RE.test(t));
      if (bad.length) {
        return { error: `each topic must be lowercase kebab-case (bad topic: ${bad.map((t) => JSON.stringify(t)).join(", ")})` };
      }
      topics = [...new Set(norm)];
      if (topics.length > MAX_DRILL_TOPICS) {
        return { error: `at most ${MAX_DRILL_TOPICS} topics per drill (got ${topics.length} distinct topics)` };
      }
      if (Array.isArray(bankTopics)) {
        const unknown = topics.filter((t) => !bankTopics.includes(t));
        if (unknown.length) return { error: `unknown topic(s), not in the bank: ${unknown.join(", ")}` };
      }
    }
    return { id: "drill-" + ts, ts, area, topics, count, status: "pending", done: 0, correct: 0, doneTs: null };
  }

  function drillLabel(drill) {
    return Array.isArray(drill.topics) && drill.topics.length ? drill.topics.join(", ") : drill.area;
  }

  function drillBannerText(drill) {
    return `Buddy drill: ${drill.count} ${drillLabel(drill)} items`;
  }

  function checkDrill(drill, fn) {
    if (!isObject(drill)) throw new TypeError(`${fn}: drill must be a drill entry, got ${String(drill)}`);
  }

  // One more answered drill item; the drill is done when done reaches count.
  function drillAdvance(drill, ok, ts) {
    checkDrill(drill, "drillAdvance");
    if (drill.status === "done") return drill;
    const done = num(drill.done) + 1;
    const next = { ...drill, done, correct: num(drill.correct) + (ok ? 1 : 0) };
    return done >= drill.count ? { ...next, status: "done", doneTs: ts } : next;
  }

  // Ends a drill early (its queue ran out before count).
  function drillFinish(drill, ts) {
    checkDrill(drill, "drillFinish");
    return drill.status === "done" ? drill : { ...drill, status: "done", doneTs: ts };
  }

  // The system prompt's drill line: pending (any age), finished within 48 h, otherwise "".
  function drillPromptLine(drill, now) {
    if (!isObject(drill)) return "";
    const label = drillLabel(drill);
    if (drill.status === "pending") return `Buddy drill pending in Prep: ${drill.count} ${label} items.`;
    if (drill.status === "done" && now - drill.doneTs <= DRILL_NOTE_MS) {
      return `Buddy drill finished: ${drill.done}/${drill.count} ${label} items, ${drill.correct} correct.`;
    }
    return "";
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
    nc150Progress, areaScores, areaScoresAt, under60, parseVerdictScore, mockVerdicts,
    mistakeTopics, weakestTopics, pickInterviewMaterial, interviewMaterialBlock,
    prepSummaryLine, prepWeeklyLine,
    amDrillEntry, drillLabel, drillBannerText, drillPromptLine, drillAdvance, drillFinish,
    historyEntry, mistakeFor, appendCapped,
    practiceTrack, sessionPracticeEntries, upsertSessionEntry, reasoningRequest,
  };
})();
if (typeof module !== "undefined") module.exports = PrepReadiness;
