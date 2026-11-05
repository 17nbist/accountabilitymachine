// Reads the M2 agent cache (BUILD-NOTES §3 "The M2 cache is per chunk"):
//   .cache/extract/<key>/<chunk>.json  { chunkId, sourceKey, items: [item + locator], skipped: [{ ref, reason }] }
//   .cache/resolve/<key>/<chunk>.json  { chunkId, items: { <locator>: { status, method, printed?, resolved?, note?, blind,
//                                         answer?, solution?, drop?, dropReason? } } }
//   .cache/sim/<key>/<chunk>.json      { <locator>: { ok, method, estimate, se, expected, note? } }
//   .cache/decks/<deck>/<chunk>.json   { chunkId, area, items: [card + locator], skipped }
//   .cache/dedup.json                  { drop: { "<key>/<locator>": reason } }            (optional)
//   .cache/audit/verdicts.json         { "<key>/<locator>": { verdict, resolved?, answer?, solution?, note } } (optional)
// Nothing here changes a file. Problems are collected, never thrown: `malformed` ones stop the
// build (exit 1), `warning` ones are reported.
"use strict";

const path = require("node:path");
const { PATHS, DECKS, readJson, jsonFiles, subdirs, isObj } = require("./util.js");

const STATUSES = ["agreed", "corrected", "disputed"];
const VERDICTS = ["ok", "corrected", "disputed", "drop"];

function loadCache(sources, cacheDir = PATHS.cache) {
  const problems = [];
  const bad = (file, msg) => problems.push({ severity: "malformed", file, msg });
  const warn = (file, msg) => problems.push({ severity: "warning", file, msg });

  const known = new Set(sources.map(s => s.key));
  for (const step of ["extract", "resolve", "sim"]) {
    for (const d of subdirs(path.join(cacheDir, step))) {
      if (!known.has(d)) warn(path.join(cacheDir, step, d), `no source "${d}" in sources.json: ignored`);
    }
  }

  const practice = sources.map(src => {
    const key = src.key;
    const exDir = path.join(cacheDir, "extract", key);
    const rsDir = path.join(cacheDir, "resolve", key);
    const smDir = path.join(cacheDir, "sim", key);
    const exNames = jsonFiles(exDir);
    const chunks = exNames.map(name => {
      const chunk = name.replace(/\.json$/, "");
      const c = {
        key, chunk,
        extractPath: path.join(exDir, name), extract: null,
        resolvePath: path.join(rsDir, name), resolve: null,
        simPath: path.join(smDir, name), sim: null,
      };

      const ex = readJson(c.extractPath);
      if (!ex.ok) bad(c.extractPath, ex.error);
      else if (!isObj(ex.value) || !Array.isArray(ex.value.items)) bad(c.extractPath, "expected { chunkId, sourceKey, items: [...], skipped: [...] }");
      else {
        const v = ex.value;
        if (v.chunkId !== chunk) warn(c.extractPath, `chunkId ${JSON.stringify(v.chunkId)} differs from the file name`);
        if (v.sourceKey !== key) warn(c.extractPath, `sourceKey ${JSON.stringify(v.sourceKey)} differs from the folder "${key}"`);
        if (v.skipped !== undefined && !Array.isArray(v.skipped)) warn(c.extractPath, "skipped is not an array: ignored");
        const nonObj = v.items.findIndex(it => !isObj(it));
        if (nonObj >= 0) bad(c.extractPath, `items[${nonObj}] is not an object`);
        else c.extract = { ...v, skipped: Array.isArray(v.skipped) ? v.skipped : [] };
      }

      const rs = readJson(c.resolvePath);
      if (rs.ok) {
        if (!isObj(rs.value) || !isObj(rs.value.items)) bad(c.resolvePath, "expected { chunkId, items: { <locator>: {...} } }");
        else {
          if (rs.value.chunkId !== chunk) warn(c.resolvePath, `chunkId ${JSON.stringify(rs.value.chunkId)} differs from the file name`);
          let ok = true;
          for (const [loc, r] of Object.entries(rs.value.items)) {
            if (!isObj(r)) {
              bad(c.resolvePath, `items[${JSON.stringify(loc)}] is not an object`);
              ok = false;
            } else if (!r.drop && !STATUSES.includes(r.status)) {
              bad(c.resolvePath, `items[${JSON.stringify(loc)}].status ${JSON.stringify(r.status)} is not one of ${STATUSES.join(", ")}`);
              ok = false;
            }
          }
          if (ok) c.resolve = rs.value;
        }
      } else if (!rs.missing) bad(c.resolvePath, rs.error);

      const sm = readJson(c.simPath);
      if (sm.ok) {
        if (!isObj(sm.value) || Object.values(sm.value).some(e => !isObj(e))) bad(c.simPath, "expected { <locator>: { ok, method, estimate, se, expected } }");
        else c.sim = sm.value;
      } else if (!sm.missing) bad(c.simPath, sm.error);
      return c;
    });

    const exSet = new Set(exNames);
    for (const name of jsonFiles(rsDir)) if (!exSet.has(name)) warn(path.join(rsDir, name), "resolve chunk with no extract chunk: ignored");
    for (const name of jsonFiles(smDir)) if (!exSet.has(name)) warn(path.join(smDir, name), "sim chunk with no extract chunk: ignored");
    return { key, src, chunks };
  });

  const decks = DECKS.map(deck => {
    const dir = path.join(cacheDir, "decks", deck);
    const chunks = [];
    for (const name of jsonFiles(dir)) {
      const chunk = name.replace(/\.json$/, "");
      const file = path.join(dir, name);
      const r = readJson(file);
      if (!r.ok) {
        bad(file, r.error);
        continue;
      }
      const v = r.value;
      if (!isObj(v) || !Array.isArray(v.items)) {
        bad(file, "expected { chunkId, area, items: [...], skipped: [...] }");
        continue;
      }
      const nonObj = v.items.findIndex(it => !isObj(it));
      if (nonObj >= 0) {
        bad(file, `items[${nonObj}] is not an object`);
        continue;
      }
      if (v.chunkId !== chunk) warn(file, `chunkId ${JSON.stringify(v.chunkId)} differs from the file name`);
      if (v.area !== deck) warn(file, `area ${JSON.stringify(v.area)} differs from the deck "${deck}"`);
      if (v.skipped !== undefined && !Array.isArray(v.skipped)) warn(file, "skipped is not an array: ignored");
      chunks.push({ deck, chunk, path: file, data: { ...v, skipped: Array.isArray(v.skipped) ? v.skipped : [] } });
    }
    return { deck, dir, chunks };
  });

  const dedupPath = path.join(cacheDir, "dedup.json");
  let dedup = {};
  const dd = readJson(dedupPath);
  if (dd.ok) {
    if (!isObj(dd.value) || !isObj(dd.value.drop)) bad(dedupPath, 'expected { "drop": { "<key>/<locator>": "<reason>" } }');
    else dedup = dd.value.drop;
  } else if (!dd.missing) bad(dedupPath, dd.error);

  const auditPath = path.join(cacheDir, "audit", "verdicts.json");
  let audit = null;
  const au = readJson(auditPath);
  if (au.ok) {
    if (!isObj(au.value)) bad(auditPath, 'expected { "<key>/<locator>": { "verdict": ..., ... } }');
    else {
      audit = {};
      for (const [k, v] of Object.entries(au.value)) {
        if (!isObj(v) || !VERDICTS.includes(v.verdict)) bad(auditPath, `${JSON.stringify(k)}: verdict must be one of ${VERDICTS.join(", ")}`);
        else audit[k] = v;
      }
    }
  } else if (!au.missing) bad(auditPath, au.error);

  return {
    practice, decks,
    dedup, dedupPath, dedupExists: dd.ok,
    audit, auditPath,
    problems,
    malformed: problems.filter(p => p.severity === "malformed"),
  };
}

module.exports = { loadCache, STATUSES, VERDICTS };
