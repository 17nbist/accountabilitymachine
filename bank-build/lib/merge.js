// assemble's merge (spec §10 step 5, V4-CONTRACTS §E2-§E4, §M7): extract + resolve (+ the
// adjudicator's corrected answer / solution) + sim per practice item, the checked cards per deck,
// minus resolve drops, dedup drops and audit drops; audit verdicts override the resolve status.
// Pure apart from reading nothing: it works on the loaded cache (lib/cache.js).
"use strict";

const PrepBank = require("../../prep/bank.js");
const { compare } = require("./sim.js");
const { DECKS, clone, isObj } = require("./util.js");

const MAX_LOCATOR = 40; // §E2: a rule for the ids the build writes
const isStr = x => typeof x === "string" && x.length > 0;

function answerTextOf(type, answer) {
  try {
    const t = PrepBank.answerText({ type, answer });
    return typeof t === "string" ? t : undefined;
  } catch {
    return undefined;
  }
}

function safeId(key, locator, item) {
  try {
    return PrepBank.makeId(key, locator, item);
  } catch {
    return `${key}-${locator}-nohash`; // fails ID_RE, so bankValidate reports it
  }
}

// §E2 build rule: a corrected item stores the resolved answer, a disputed one the printed answer
// (numeric answer.value, mcq choice text). bankValidate does not check this (§E4), so the build does.
function e2Problems(item) {
  const c = item.check;
  if (!isObj(c) || (c.status !== "corrected" && c.status !== "disputed")) return [];
  const field = c.status === "corrected" ? "resolved" : "printed";
  const want = c[field];
  if (typeof want !== "string") return []; // bankValidate reports the missing string
  let stored;
  const a = item.answer;
  if (item.type === "numeric") stored = isObj(a) ? a.value : undefined;
  else if (item.type === "mcq") stored = isObj(a) && Array.isArray(a.choices) ? a.choices[a.correct] : undefined;
  else return [];
  if (stored === want) return [];
  return [{
    field: `check.${field}`,
    kind: `${c.status} ${item.type}: stored answer != check.${field}`,
    msg: `a ${c.status} ${item.type} item must store check.${field} as its answer (§E2): stored ${JSON.stringify(stored)}, check.${field} ${JSON.stringify(want)}`,
  }];
}

function makeCheck({ status, printed, resolved, method, note }) {
  const check = { status };
  if (status === "corrected" || status === "disputed") {
    if (printed !== undefined) check.printed = printed;
    if (resolved !== undefined) check.resolved = resolved;
  }
  if (method !== undefined) check.method = method;
  if (note !== undefined && note !== "") check.note = note;
  return check;
}

function itemFields(src) {
  return {
    source: clone(src.source),
    area: src.area,
    topics: clone(src.topics),
    difficulty: src.difficulty,
    type: src.type,
    prompt: src.prompt,
    answer: clone(src.answer),
    solution: src.solution,
    origin: src.origin,
  };
}

// Applies an audit verdict ("corrected" / "disputed") the way an adjudicator's resolution works.
// st = { status, printed, resolved, note }, base = the item fields (changed in place),
// original = { answer, solution } as extracted (the printed answer), printedAnswer = its text.
function applyVerdict(v, st, base, original, printedAnswer) {
  if (v.verdict === "corrected") {
    if (v.answer !== undefined) base.answer = clone(v.answer);
    if (v.solution !== undefined) base.solution = v.solution;
    st.printed = printedAnswer;
    st.resolved = v.resolved !== undefined ? v.resolved : answerTextOf(base.type, base.answer);
    st.status = "corrected";
  } else if (v.verdict === "disputed") {
    // Keep the printed answer (spec §10), unless the auditor states the answer to keep.
    base.answer = clone(v.answer !== undefined ? v.answer : original.answer);
    base.solution = v.solution !== undefined ? v.solution : original.solution;
    st.printed = printedAnswer;
    st.resolved = v.resolved !== undefined ? v.resolved : (st.status === "corrected" ? st.resolved : undefined);
    st.status = "disputed";
  }
  if (v.verdict === "corrected" || v.verdict === "disputed") {
    if (v.note !== undefined) st.note = v.note;
  }
}

function merge(cache, sources) {
  const buildErrors = [];
  const warnings = [];
  const dropped = [];
  const unresolved = [];
  const skipped = [];
  const simOrphans = [];
  const records = [];
  const seenTag = new Map(); // "<key>/<locator>" -> where
  const auditUsed = new Set();
  const dedupUsed = new Set();
  const dedup = cache.dedup || {};
  const audit = cache.audit || {};
  const prio = new Map(sources.map(s => [s.key, s.priority]));

  const err = (id, key, field, kind, msg) => buildErrors.push({ id, key, field, kind, msg });

  function checkLocator(key, loc, where) {
    const tag = `${key}/${loc}`;
    if (typeof loc !== "string" || !PrepBank.LOCATOR_RE.test(loc)) {
      err(`${key}-${loc}`, key, "id", "locator does not match LOCATOR_RE", `${where}: locator ${JSON.stringify(loc)} does not match LOCATOR_RE`);
    } else if (loc.length > MAX_LOCATOR) {
      err(`${key}-${loc}`, key, "id", `locator longer than ${MAX_LOCATOR}`, `${where}: locator ${JSON.stringify(loc)} has ${loc.length} characters (at most ${MAX_LOCATOR}, §E2)`);
    }
    if (seenTag.has(tag)) {
      err(`${key}-${loc}`, key, "id", "duplicate locator within a source", `${where}: locator ${JSON.stringify(loc)} is also used in ${seenTag.get(tag)} (locators must be unique per source key)`);
    } else seenTag.set(tag, where);
    return tag;
  }

  function dropBy(tag, rec) {
    if (dedup[tag] !== undefined) {
      dedupUsed.add(tag);
      dropped.push({ ...rec, by: "dedup", reason: String(dedup[tag]) });
      return true;
    }
    const v = audit[tag];
    if (v && v.verdict === "drop") {
      auditUsed.add(tag);
      dropped.push({ ...rec, by: "audit", reason: v.note !== undefined ? String(v.note) : "audit verdict drop" });
      return true;
    }
    return false;
  }

  // ---------- practice ----------
  const simIndex = new Map();
  for (const s of cache.practice) {
    for (const c of s.chunks) {
      if (!c.sim) continue;
      for (const [loc, entry] of Object.entries(c.sim)) {
        const tag = `${s.key}/${loc}`;
        if (simIndex.has(tag)) warnings.push(`${c.simPath}: ${tag} is also simulated in ${simIndex.get(tag).chunk}: ignored`);
        else simIndex.set(tag, { entry, chunk: c.chunk, path: c.simPath, used: false });
      }
    }
  }

  let seq = 0;
  for (const s of cache.practice) {
    const key = s.key;
    const fileRank = new Map();
    for (const c of s.chunks) {
      if (!c.extract) continue;
      for (const sk of c.extract.skipped) skipped.push({ kind: "practice", key, chunk: c.chunk, ref: sk && sk.ref, reason: sk && sk.reason });
      const rsItems = c.resolve ? c.resolve.items : null;
      const exLocs = new Set();
      for (const ex of c.extract.items) {
        const loc = ex.locator;
        exLocs.add(loc);
        const where = `extract/${key}/${c.chunk}.json`;
        const tag = checkLocator(key, loc, where);
        const rec = { kind: "practice", key, chunk: c.chunk, locator: loc };
        const r = rsItems ? rsItems[loc] : undefined;
        if (r && r.drop) {
          dropped.push({ ...rec, by: "resolve", reason: r.dropReason !== undefined ? String(r.dropReason) : "dropped by the adjudicator" });
          continue;
        }
        if (dropBy(tag, rec)) continue;

        const base = itemFields(ex);
        const original = { answer: clone(ex.answer), solution: ex.solution };
        const exPrinted = isObj(ex.check) && isStr(ex.check.printed) ? ex.check.printed : undefined;
        const printedAnswer = r && r.printed !== undefined ? r.printed
          : exPrinted !== undefined ? exPrinted : answerTextOf(ex.type, ex.answer);
        const st = { status: "unverified", printed: undefined, resolved: undefined, note: undefined };
        if (r) {
          st.status = r.status;
          st.note = r.note;
          if (r.status === "corrected") {
            if (r.answer !== undefined) base.answer = clone(r.answer);
            if (r.solution !== undefined) base.solution = r.solution;
            st.printed = printedAnswer;
            st.resolved = r.resolved !== undefined ? r.resolved : answerTextOf(base.type, base.answer);
          } else {
            if (r.answer !== undefined || r.solution !== undefined) {
              warnings.push(`resolve/${key}/${c.chunk}.json: ${loc} is ${r.status} but carries a replacement answer or solution: ignored (only "corrected" replaces them)`);
            }
            if (r.status === "disputed") {
              st.printed = printedAnswer;
              st.resolved = r.resolved;
            }
          }
        } else {
          unresolved.push({ ...rec, reason: c.resolve ? "no entry in the resolve chunk" : "no resolve chunk" });
        }
        const v = audit[tag];
        if (v && v.verdict !== "drop") {
          auditUsed.add(tag);
          applyVerdict(v, st, base, original, printedAnswer);
        }

        let sim = null;
        const se = simIndex.get(tag);
        if (se) {
          se.used = true;
          if (base.type === "numeric") sim = { chunk: se.chunk, entry: se.entry, ...compare(se.entry, base) };
          else simOrphans.push({ ...rec, why: `item is ${base.type}, not numeric` });
        }
        const method = st.status === "unverified" ? undefined : (sim && sim.ok ? "blind+sim" : "blind");
        const item = { id: null, ...base, check: makeCheck({ ...st, method }) };
        item.id = safeId(key, loc, item);

        if (isObj(ex.source) && ex.source.key !== key) {
          err(item.id, key, "source.key", "source.key differs from the cache folder", `source.key ${JSON.stringify(ex.source.key)} is in the cache folder of "${key}"`);
        }
        if (!PrepBank.PRACTICE_AREAS.includes(item.area)) {
          err(item.id, key, "area", "card area in bank.json", `area ${JSON.stringify(item.area)} is not a practice area (bank.json holds ${PrepBank.PRACTICE_AREAS.join(", ")})`);
        }
        for (const p of e2Problems(item)) err(item.id, key, p.field, p.kind, p.msg);

        const file = item.source && item.source.file;
        if (!fileRank.has(file)) fileRank.set(file, fileRank.size);
        const page = item.source && Number.isInteger(item.source.page) ? item.source.page : Infinity;
        records.push({ ...rec, item, sim, resolve: r || null, verdict: v || null,
          order: [prio.has(key) ? prio.get(key) : Infinity, fileRank.get(file), page, seq++] });
      }
      if (rsItems) {
        for (const loc of Object.keys(rsItems)) {
          if (!exLocs.has(loc)) warnings.push(`resolve/${key}/${c.chunk}.json: ${loc} has no extract item: ignored`);
        }
      }
    }
  }
  for (const [tag, se] of simIndex) {
    if (se.used) continue;
    const [key, ...rest] = tag.split("/");
    const loc = rest.join("/");
    const wasDropped = dropped.some(d => d.key === key && d.locator === loc);
    if (!wasDropped) simOrphans.push({ kind: "practice", key, chunk: se.chunk, locator: loc, why: "no extract item with this locator" });
  }

  const cmp = (a, b) => {
    for (let i = 0; i < a.order.length; i++) if (a.order[i] !== b.order[i]) return a.order[i] < b.order[i] ? -1 : 1;
    return 0;
  };
  const practiceRecords = records.slice().sort(cmp);

  // ---------- cards (deck chunk order, then file order) ----------
  const deckRecords = {};
  for (const d of cache.decks) {
    deckRecords[d.deck] = [];
    for (const c of d.chunks) {
      for (const sk of c.data.skipped) skipped.push({ kind: "card", key: d.deck, chunk: c.chunk, ref: sk && sk.ref, reason: sk && sk.reason });
      for (const it of c.data.items) {
        const key = isObj(it.source) && typeof it.source.key === "string" ? it.source.key : String(isObj(it.source) ? it.source.key : undefined);
        const loc = it.locator;
        const where = `decks/${d.deck}/${c.chunk}.json`;
        const tag = checkLocator(key, loc, where);
        const rec = { kind: "card", deck: d.deck, key, chunk: c.chunk, locator: loc };
        if (dropBy(tag, rec)) continue;

        const base = itemFields(it);
        const original = { answer: clone(it.answer), solution: it.solution };
        const ck = isObj(it.check) ? it.check : {};
        const st = { status: ck.status, printed: ck.printed, resolved: ck.resolved, note: ck.note };
        const v = audit[tag];
        if (v && v.verdict !== "drop") {
          auditUsed.add(tag);
          // A card has no printed source answer: the card's own answer before the audit stands in.
          const printedAnswer = st.status === "corrected" && st.printed !== undefined ? st.printed : answerTextOf(it.type, it.answer);
          applyVerdict(v, st, base, original, printedAnswer);
        }
        const item = { id: null, ...base, check: makeCheck({ ...st, method: ck.method }) };
        if (!isObj(it.check)) item.check = it.check; // let bankValidate report it as is
        item.id = safeId(key, loc, item);
        if (item.area !== d.deck) {
          err(item.id, key, "area", "card area differs from its deck", `area ${JSON.stringify(item.area)} in decks/${d.deck}.json (every item's area equals the deck, §E1)`);
        }
        for (const p of e2Problems(item)) err(item.id, key, p.field, p.kind, p.msg);
        deckRecords[d.deck].push({ ...rec, item, sim: null, resolve: null, verdict: v || null });
      }
    }
  }

  for (const tag of Object.keys(dedup)) if (!dedupUsed.has(tag)) warnings.push(`dedup.json: ${tag} matches no item`);
  for (const tag of Object.keys(audit)) if (!auditUsed.has(tag)) warnings.push(`audit/verdicts.json: ${tag} matches no item`);

  const decks = {};
  for (const deck of DECKS) decks[deck] = (deckRecords[deck] || []).map(r => r.item);
  return {
    practice: practiceRecords.map(r => r.item),
    decks,
    records: [...practiceRecords, ...DECKS.flatMap(d => deckRecords[d] || [])],
    dropped, unresolved, skipped, simOrphans, buildErrors, warnings,
  };
}

// bankValidate on the merged set (ids unique across bank and decks, §E4) and on each file; every
// distinct error once, tagged with the file and source key.
function validate(m) {
  const files = [["bank.json", m.practice], ...DECKS.map(d => [`decks/${d}.json`, m.decks[d]])];
  const out = [];
  const seen = new Set();
  const add = (file, errors) => {
    for (const e of errors) {
      const k = `${e.id}\u0000${e.field}\u0000${e.msg}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const p = PrepBank.parseId(e.id);
      out.push({ ...e, file, key: p ? p.key : String(e.id).split("-")[0] });
    }
  };
  add("merged", PrepBank.bankValidate({ items: files.flatMap(f => f[1]) }).errors);
  for (const [file, items] of files) add(file, PrepBank.bankValidate({ items }).errors);
  return out;
}

// A short, stable label for an error message: quoted values and numbers are blanked.
function errorKind(e) {
  if (e.kind) return e.kind;
  const msg = String(e.msg);
  if (e.field === "id") {
    if (/hash mismatch/.test(msg)) return "hash mismatch";
    if (/duplicate/.test(msg)) return "duplicate id";
    if (/key part/.test(msg)) return "key part != source.key";
    return "bad id format";
  }
  const m = /does not parse: (.*)$/.exec(msg);
  const text = m ? `does not parse: ${m[1]}` : msg;
  return text.replace(/"(?:[^"\\]|\\.)*"/g, '"…"').replace(/\d+(\.\d+)?/g, "N").slice(0, 80);
}

// [{ key, field, kind, count, examples: [id, id, id] }], largest groups first.
function groupErrors(errors) {
  const groups = new Map();
  for (const e of errors) {
    const kind = errorKind(e);
    const k = `${e.key}\u0000${e.field}\u0000${kind}`;
    if (!groups.has(k)) groups.set(k, { key: e.key, field: e.field, kind, count: 0, examples: [] });
    const g = groups.get(k);
    g.count++;
    if (g.examples.length < 3 && !g.examples.includes(e.id)) g.examples.push(e.id);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

module.exports = { merge, validate, groupErrors, errorKind, e2Problems, MAX_LOCATOR };
