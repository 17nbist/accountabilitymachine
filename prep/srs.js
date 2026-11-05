// v4 prep/srs.js (PrepSrs): the SM-2 scheduler, auto-grading, grade-button labels, the session
// and drill queues, and the mastery / replay / due-count helpers (V4-CONTRACTS §D, spec §3 F1.3).
// Plain browser script and Node module (§A5): one `var` global, no DOM, no clock, no RNG. Every
// time-dependent function takes the time as an argument, and no function mutates its inputs.
//
// Card shape (storage key prepCards, spec §2):
//   { ease, interval, due, reps, lapses, last, seen }
// A card exists only once its item has been graded; an item with no card (or a card with a
// non-finite `due`) is "new".

var PrepSrs = (function () {
  const B = typeof PrepBank !== "undefined" ? PrepBank : require("./bank.js");

  const DAY = 86400000;
  const MINUTE = 60000;
  const MAX_INTERVAL = 365;
  const AGAIN_DELAY_MS = 10 * MINUTE;
  const AREAS = Object.freeze(B.AREAS.slice());
  // Round-robin order for the session queue (spec §3 F1.3 step 3).
  const AREA_ORDER = Object.freeze(["probability", "brainteaser", "cpp", "systems", "statistics", "finance"]);
  const GRADES = Object.freeze(["again", "hard", "good", "easy"]);
  const DEFAULT_SETTINGS = Object.freeze({ newPerDay: 15, reviewCap: 150, areas: AREAS });
  const MASTERY_DAYS = 21;
  const SETTING_RANGES = { newPerDay: [0, 200], reviewCap: [0, 1000] };

  const own = Object.prototype.hasOwnProperty;

  // ---------- small shared helpers ----------

  function isObject(x) {
    return typeof x === "object" && x !== null && !Array.isArray(x);
  }

  // §A6: a `bank` is an Item[] or any object with an `items` array; null means no bank.
  function bankItems(bank) {
    if (Array.isArray(bank)) return bank;
    if (bank && Array.isArray(bank.items)) return bank.items;
    return [];
  }

  // The bank de-duplicated by id, first occurrence wins (as PrepBank.indexById), each entry
  // tagged with its bank index (the "bank order" tie-break). Entries that are not objects with
  // a string id cannot be queued, so they are skipped.
  function uniqueItems(bank) {
    const seen = new Set();
    const out = [];
    bankItems(bank).forEach((it, idx) => {
      if (!isObject(it) || typeof it.id !== "string" || seen.has(it.id)) return;
      seen.add(it.id);
      out.push({ it, idx });
    });
    return out;
  }

  // cards[id] as an own property only, so ids such as "constructor" never read Object.prototype.
  // A card that is null or not an object counts as missing (§D1).
  function cardOf(cards, id) {
    if (!cards || typeof cards !== "object" || !own.call(cards, id)) return null;
    const c = cards[id];
    return isObject(c) ? c : null;
  }

  function dueOf(card) {
    return card && Number.isFinite(card.due) ? card.due : null;
  }

  // OR topic filter; `topics` that is not a non-empty array means no filter.
  function topicFilter(topics) {
    if (!Array.isArray(topics) || topics.length === 0) return () => true;
    return (it) => Array.isArray(it.topics) && it.topics.some((t) => topics.includes(t));
  }

  function idCmp(a, b) {
    return a < b ? -1 : a > b ? 1 : 0;
  }

  function byDueThenId(a, b) {
    return a.due - b.due || idCmp(a.id, b.id);
  }

  // Difficulty ascending (a missing difficulty sorts last), then bank order.
  function byDifficultyThenBank(a, b) {
    const da = Number.isFinite(a.difficulty) ? a.difficulty : Infinity;
    const db = Number.isFinite(b.difficulty) ? b.difficulty : Infinity;
    return (da < db ? -1 : da > db ? 1 : 0) || a.idx - b.idx;
  }

  // Candidate rows for the queues: { id, area, difficulty, idx, due } with due null for new items.
  function row(entry, cards) {
    const { it, idx } = entry;
    return { id: it.id, area: it.area, difficulty: it.difficulty, idx, due: dueOf(cardOf(cards, it.id)) };
  }

  // §D8: per-area sublists in AREA_ORDER, then one element from each non-empty sublist per round.
  // An area outside AREA_ORDER (none today) would follow in first-seen order instead of vanishing.
  function roundRobin(list) {
    const groups = new Map(AREA_ORDER.map((a) => [a, []]));
    for (const x of list) {
      if (!groups.has(x.area)) groups.set(x.area, []);
      groups.get(x.area).push(x);
    }
    const subs = [...groups.values()].filter((g) => g.length);
    const out = [];
    for (let i = 0; out.length < list.length; i++) {
      for (const g of subs) if (i < g.length) out.push(g[i]);
    }
    return out;
  }

  // ---------- §A2 local days ----------

  // Local midnight that starts the day k days after the local day of ts (DST-safe).
  function localDayStart(ts, k = 0) {
    const d = new Date(ts);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + k).getTime();
  }

  // ---------- §D1 / §D2 cards and scheduling ----------

  function newCard() {
    return { ease: 2.5, interval: 0, due: null, reps: 0, lapses: 0, last: null, seen: null };
  }

  // The card with every missing numeric field at its newCard() value. A stored field that is not
  // a finite number (a corrupted record) is treated as missing too.
  function defaulted(card) {
    const base = newCard();
    const c = isObject(card) ? card : {};
    const num = (k) => (Number.isFinite(c[k]) ? c[k] : base[k]);
    return {
      ease: num("ease"), interval: num("interval"), reps: num("reps"), lapses: num("lapses"),
      seen: c.seen === undefined ? base.seen : c.seen,
    };
  }

  function checkGrade(grade) {
    if (typeof grade !== "string" || !GRADES.includes(grade)) {
      throw new TypeError(`schedule: grade must be one of ${GRADES.join(", ")}, got ${String(grade)}`);
    }
  }

  // The interval `good` gives before the cap; easy multiplies this by 1.3.
  function goodRaw(c) {
    return c.reps === 0 ? 1 : c.reps === 1 ? 6 : Math.round(c.interval * c.ease);
  }

  // { ease, interval } for one grade (§D2 table). `again` sets interval 0 and is due in 10 min.
  function next(c, grade) {
    switch (grade) {
      case "again":
        return { ease: Math.max(1.3, c.ease - 0.2), interval: 0 };
      case "hard":
        return {
          ease: Math.max(1.3, c.ease - 0.15),
          interval: Math.min(MAX_INTERVAL, Math.max(1, Math.round(c.interval * 1.2))),
        };
      case "good":
        return { ease: c.ease, interval: Math.min(MAX_INTERVAL, goodRaw(c)) };
      default: // easy: the good interval with the OLD ease, times 1.3, then ease + 0.15
        return { ease: c.ease + 0.15, interval: Math.min(MAX_INTERVAL, Math.round(goodRaw(c) * 1.3)) };
    }
  }

  // Grade a card at time `now` and return the new card (exactly the seven §D1 fields).
  function schedule(card, grade, now) {
    checkGrade(grade);
    if (!Number.isFinite(now)) throw new TypeError(`schedule: now must be a finite time in ms, got ${String(now)}`);
    const c = defaulted(card);
    const { ease, interval } = next(c, grade);
    const again = grade === "again";
    return {
      ease,
      interval,
      due: again ? now + AGAIN_DELAY_MS : now + interval * DAY,
      reps: again ? 0 : c.reps + 1,
      lapses: again ? c.lapses + 1 : c.lapses,
      last: now,
      seen: c.seen ?? now,
    };
  }

  // ---------- §D3 previews ----------

  function nextIntervals(card) {
    const out = {};
    for (const g of GRADES) out[g] = schedule(card, g, 0).interval;
    return out;
  }

  function gradeLabels(card) {
    const ni = nextIntervals(card);
    const label = (g) => g[0].toUpperCase() + g.slice(1);
    const out = {};
    for (const g of GRADES) {
      out[g] = g === "again" ? `${label(g)}, ${AGAIN_DELAY_MS / MINUTE}m` : `${label(g)}, ${ni[g]}d`;
    }
    return out;
  }

  // ---------- §D4 auto-grading ----------

  function targetSecs(item) {
    return 60 * item.difficulty * 1.5;
  }

  // false -> again; true -> good, or hard when slower than the target; anything else -> no grade.
  function autoGrade(correct, secs, item) {
    if (correct === false) return "again";
    if (correct === true) return secs > targetSecs(item) ? "hard" : "good";
    return null;
  }

  // The single definition of an "OK answer" for a prepHistory entry.
  function answerOk(entry) {
    if (!isObject(entry)) return false;
    return entry.mode === "auto" ? entry.correct === true : entry.grade !== "again";
  }

  // ---------- §D5 settings ----------

  function normalizeSettings(s) {
    const o = isObject(s) ? s : {};
    const out = {};
    for (const k of Object.keys(SETTING_RANGES)) {
      const [lo, hi] = SETTING_RANGES[k];
      const v = o[k];
      // `+ 0` turns -0 into 0.
      out[k] = Number.isInteger(v) && v >= lo && v <= hi ? v + 0 : DEFAULT_SETTINGS[k];
    }
    out.areas = Array.isArray(o.areas) ? AREAS.filter((a) => o.areas.includes(a)) : AREAS.slice();
    return out;
  }

  // ---------- §D6 session queue ----------

  function buildQueue(bank, cards, now, settings, opts = {}) {
    const S = normalizeSettings(settings);
    const areas = new Set(S.areas);
    const wantTopic = topicFilter(opts && opts.topics);
    const inAreas = uniqueItems(bank).filter((e) => areas.has(e.it.area));

    // The new-item budget counts items introduced on the local day of now, topic filter ignored.
    const lo = localDayStart(now);
    const hi = localDayStart(now, 1);
    let seenToday = 0;
    for (const e of inAreas) {
      const c = cardOf(cards, e.it.id);
      if (c && typeof c.seen === "number" && c.seen >= lo && c.seen < hi) seenToday++;
    }

    const cand = inAreas.filter((e) => wantTopic(e.it)).map((e) => row(e, cards));
    const reviews = cand.filter((x) => x.due !== null && x.due <= now).sort(byDueThenId).slice(0, S.reviewCap);
    const fresh = cand.filter((x) => x.due === null).sort(byDifficultyThenBank);
    const newLimit = Math.max(0, S.newPerDay - seenToday);
    return roundRobin(reviews).concat(roundRobin(fresh).slice(0, newLimit)).map((x) => x.id);
  }

  // ---------- §D7 drill queue ----------

  // Due reviews, then new items, then not-yet-due reviews; no daily limits and no interleave.
  // A count that is not a non-negative number gives an empty drill.
  function drillQueue(bank, cards, now, drill) {
    const d = isObject(drill) ? drill : {};
    const inArea = typeof d.area === "string" ? (it) => it.area === d.area : (it) => AREAS.includes(it.area);
    const wantTopic = topicFilter(d.topics);
    const cand = uniqueItems(bank).filter((e) => inArea(e.it) && wantTopic(e.it)).map((e) => row(e, cards));
    const dueNow = cand.filter((x) => x.due !== null && x.due <= now).sort(byDueThenId);
    const fresh = cand.filter((x) => x.due === null).sort(byDifficultyThenBank);
    const later = cand.filter((x) => x.due !== null && x.due > now).sort(byDueThenId);
    const count = typeof d.count === "number" && d.count >= 0 ? Math.floor(d.count) : 0;
    return dueNow.concat(fresh, later).slice(0, count).map((x) => x.id);
  }

  // ---------- §D9 other helpers ----------

  // Fraction of the given ids whose card has interval >= 21; null for no ids.
  function masteryOf(cards, itemIds) {
    const ids = Array.isArray(itemIds) ? itemIds : [];
    if (ids.length === 0) return null;
    let mastered = 0;
    for (const id of ids) {
      const c = cardOf(cards, id);
      if (c && c.interval >= MASTERY_DAYS) mastered++;
    }
    return mastered / ids.length;
  }

  // Rebuild prepCards from prepHistory: graded entries with ts <= uptoTs, in ts order (ties keep
  // history order), each applied with schedule(). A Map keeps ids such as "__proto__" ordinary.
  function replayCards(history, uptoTs) {
    const list = (Array.isArray(history) ? history : [])
      .map((e, i) => ({ e, i }))
      .filter(({ e }) => isObject(e) && Number.isFinite(e.ts) && e.ts <= uptoTs && GRADES.includes(e.grade))
      .sort((a, b) => a.e.ts - b.e.ts || a.i - b.i);
    const cards = new Map();
    for (const { e } of list) {
      const id = String(e.itemId);
      cards.set(id, schedule(cards.get(id), e.grade, e.ts));
    }
    return Object.fromEntries(cards);
  }

  // Bank items (de-duplicated) with area in `areas` whose card has a finite due < beforeTs.
  // Only undefined takes the default; null reads as [] (§A3). Areas are matched literally.
  function dueCount(bank, cards, beforeTs, areas = AREAS) {
    const want = new Set(Array.isArray(areas) ? areas : []);
    let n = 0;
    for (const { it } of uniqueItems(bank)) {
      if (!want.has(it.area)) continue;
      const due = dueOf(cardOf(cards, it.id));
      if (due !== null && due < beforeTs) n++;
    }
    return n;
  }

  return {
    DAY, MINUTE, AREA_ORDER, GRADES, MAX_INTERVAL, AGAIN_DELAY_MS, DEFAULT_SETTINGS,
    normalizeSettings, newCard, schedule, nextIntervals, gradeLabels, targetSecs, autoGrade,
    answerOk, buildQueue, drillQueue, masteryOf, replayCards, localDayStart, dueCount,
  };
})();
if (typeof module !== "undefined") module.exports = PrepSrs;
