// bank:build (V4-CONTRACTS.md §M7; spec §10): the local content pipeline. It reads the resource
// library (~/Documents/Quant Prep/resources), the M2 agent cache in bank-build/.cache/ and writes
// the gitignored bank/. Agents do the extraction and solving work; these scripts only handle
// files, caching, merging, validation and reports.
//
//   node bank-build/build.js [step] [source]
//   steps, in order: ocr extract resolve sim decks assemble report; `all` (the default) runs them
//
// Node built-ins, python3 (stdlib, `-I`) and CLI tools only: package.json is locked after M0.
// Nothing derived from the books is in this file or bank-build/lib/: item text lives only in the
// gitignored cache and bank/.
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const PrepBank = require("../prep/bank.js");
const { PATHS, DECKS, readJson, writeFileAtomic, writeJson, rel, table, shorten, countBy, isObj } = require("./lib/util.js");
const { loadCache } = require("./lib/cache.js");
const { merge, validate, groupErrors } = require("./lib/merge.js");
const simLib = require("./lib/sim.js");
const { OCR_KEY, libraryPlan, writeLibrary, missingCited } = require("./lib/library.js");
const { acceptance, renderReport } = require("./lib/report.js");

const SOURCES_PATH = path.join(__dirname, "sources.json");
const OCR_PDF = path.join(PATHS.cache, "greenbook-ocr.pdf");
const OCR_TXT = path.join(PATHS.cache, "greenbook-ocr.txt");
const OCR_LOG = path.join(PATHS.cache, "greenbook-ocr.log");
const OCR_MIN_BYTES = 100 * 1024; // spec §10.1: "more than 100 KB of text"
const SIM_RUN = path.join(PATHS.cache, "sim-run.json");
const NC150 = "05-coding-lists/neetcode/neetcode150.json";

const STEPS = [
  { name: "ocr", what: "OCR the Green Book scan into .cache/greenbook-ocr.pdf (ocrmypdf) if missing, check it yields > 100 KB of text" },
  { name: "extract", what: "report the extraction agents' chunks in .cache/extract/ (counts, skipped, malformed files)" },
  { name: "resolve", what: "report the blind re-solve and adjudication chunks in .cache/resolve/ (statuses, missing chunks)" },
  { name: "sim", what: "re-run bank-build/sim/items/*.py (python3 -I), compare with the bank answers, rewrite .cache/sim/" },
  { name: "decks", what: "report the C++ and systems card chunks in .cache/decks/" },
  { name: "assemble", what: "merge the cache, copy the library into bank/library/, write bank/*.json, run bankValidate" },
  { name: "report", what: "write bank/REPORT.md with counts and the spec §10 acceptance checks" },
];
const STEP_NAMES = STEPS.map((s) => s.name);

function loadSources(file = SOURCES_PATH) {
  const list = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(list)) throw new Error(`${file}: expected an array of sources`);
  return list.slice().sort((a, b) => a.priority - b.priority);
}

function usage(sources) {
  const lines = [
    "usage: node bank-build/build.js [step] [source]   (npm run bank:build -- <step> [source])",
    "",
    "steps (`all`, the default, runs them in this order):",
    ...STEPS.map((s) => `  ${s.name.padEnd(9)} ${s.what}`),
    "",
    "sources (bank-build/sources.json, in priority order):",
    ...sources.map((s) => `  ${s.key.padEnd(10)} ${s.title} (${s.area})`),
    `decks: ${DECKS.join(", ")}`,
    "assemble and report always cover the whole bank.",
  ];
  return lines.join("\n");
}

// Returns { help } or { steps, source } or { error }.
function parseArgs(argv, sources) {
  if (argv.some((a) => a === "--help" || a === "-h" || a === "help")) return { help: true };
  if (argv.length > 2) return { error: "too many arguments" };
  const [step = "all", source = null] = argv;
  if (step !== "all" && !STEP_NAMES.includes(step)) return { error: `unknown step ${JSON.stringify(step)}` };
  if (source !== null) {
    const known = step === "decks" ? DECKS : sources.map((s) => s.key);
    if (!known.includes(source)) return { error: `unknown ${step === "decks" ? "deck" : "source"} ${JSON.stringify(source)} for ${step}` };
  }
  return { steps: step === "all" ? STEP_NAMES : [step], source };
}

const out = (s = "") => process.stdout.write(s + "\n");
const errOut = (s) => process.stderr.write(s + "\n");

function printProblems(problems, filter = () => true) {
  const list = problems.filter(filter);
  for (const p of list) out(`  ${p.severity === "malformed" ? "MALFORMED" : "warning"}: ${rel(p.file)}: ${p.msg}`);
  return list;
}

function underDir(dir) {
  const d = dir.endsWith(path.sep) ? dir : dir + path.sep;
  return (p) => p.file === dir || p.file.startsWith(d);
}

// ---------- ocr ----------

function hasCommand(cmd) {
  return spawnSync("sh", ["-c", `command -v ${cmd}`], { encoding: "utf8" }).status === 0;
}

function stepOcr(ctx) {
  if (ctx.source && ctx.source !== OCR_KEY) {
    out(`ocr: nothing to OCR for ${ctx.source} (only ${OCR_KEY} is a scan)`);
    return 0;
  }
  const src = ctx.sources.find((s) => s.key === OCR_KEY);
  if (!src) {
    errOut(`ocr: no source "${OCR_KEY}" in sources.json`);
    return 1;
  }
  if (!fs.existsSync(OCR_PDF)) {
    const scan = path.join(PATHS.resources, src.file);
    if (!fs.existsSync(scan)) {
      errOut(`ocr: the scan ${scan} does not exist`);
      return 1;
    }
    if (!hasCommand("ocrmypdf")) {
      out("ocr: ocrmypdf is missing, running brew install ocrmypdf");
      const b = spawnSync("brew", ["install", "ocrmypdf"], { stdio: "inherit" });
      if (b.status !== 0 || !hasCommand("ocrmypdf")) {
        errOut("ocr: brew install ocrmypdf failed");
        return 1;
      }
    }
    fs.mkdirSync(PATHS.cache, { recursive: true });
    const tmp = path.join(PATHS.cache, "greenbook-ocr.tmp.pdf");
    out(`ocr: ocrmypdf ${rel(scan)} -> ${rel(OCR_PDF)} (log ${rel(OCR_LOG)})`);
    const jobs = String(Math.max(1, os.cpus().length - 2));
    const r = spawnSync("ocrmypdf", ["--jobs", jobs, scan, tmp], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    fs.writeFileSync(OCR_LOG, `${r.stdout || ""}${r.stderr || ""}`);
    if (r.status !== 0 || !fs.existsSync(tmp)) {
      errOut(`ocr: ocrmypdf failed (exit ${r.status}); see ${rel(OCR_LOG)}`);
      return 1;
    }
    fs.renameSync(tmp, OCR_PDF);
  }
  const t = spawnSync("pdftotext", [OCR_PDF, "-"], { maxBuffer: 256 * 1024 * 1024 });
  if (t.status !== 0) {
    errOut(`ocr: pdftotext ${rel(OCR_PDF)} failed (exit ${t.status}): ${String(t.stderr || t.error || "").trim()}`);
    return 1;
  }
  writeFileAtomic(OCR_TXT, t.stdout);
  const ok = t.stdout.length > OCR_MIN_BYTES;
  out(`ocr: ${rel(OCR_PDF)} yields ${t.stdout.length} bytes of text (needs > ${OCR_MIN_BYTES}): ${ok ? "PASS" : "FAIL"}`);
  return ok ? 0 : 1;
}

// ---------- extract / resolve / decks (agent steps: report only) ----------

function selected(ctx) {
  return ctx.cache().practice.filter((s) => !ctx.source || s.key === ctx.source);
}

function stepExtract(ctx) {
  const cache = ctx.cache();
  const rows = [];
  for (const s of selected(ctx)) {
    let items = 0;
    let skipped = 0;
    let bad = 0;
    const locs = new Set();
    const dupes = [];
    for (const c of s.chunks) {
      if (!c.extract) {
        bad++;
        continue;
      }
      items += c.extract.items.length;
      skipped += c.extract.skipped.length;
      for (const it of c.extract.items) {
        if (typeof it.locator !== "string" || !PrepBank.LOCATOR_RE.test(it.locator)) dupes.push(`${c.chunk}: bad locator ${JSON.stringify(it.locator)}`);
        else if (locs.has(it.locator)) dupes.push(`${c.chunk}: duplicate locator ${it.locator}`);
        locs.add(it.locator);
      }
    }
    rows.push([s.key, s.chunks.length, items, skipped, bad, s.chunks.length ? "" : "NO CHUNKS"]);
    for (const d of dupes) out(`  ${s.key}: ${d}`);
  }
  out(table(["source", "chunks", "items", "skipped", "malformed", ""], rows));
  const probs = printProblems(cache.problems, (p) => underDir(path.join(PATHS.cache, "extract", ctx.source || ""))(p));
  return probs.some((p) => p.severity === "malformed") ? 1 : 0;
}

function stepResolve(ctx) {
  const cache = ctx.cache();
  const rows = [];
  for (const s of selected(ctx)) {
    let present = 0;
    const missing = [];
    let entries = 0;
    let unresolved = 0;
    let orphans = 0;
    const st = new Map();
    let drops = 0;
    for (const c of s.chunks) {
      if (!c.resolve) {
        if (!fs.existsSync(c.resolvePath)) missing.push(c.chunk);
        continue;
      }
      present++;
      const ri = c.resolve.items;
      entries += Object.keys(ri).length;
      for (const r of Object.values(ri)) {
        if (r.drop) drops++;
        else st.set(r.status, (st.get(r.status) || 0) + 1);
      }
      if (c.extract) {
        const exLocs = new Set(c.extract.items.map((it) => it.locator));
        unresolved += [...exLocs].filter((l) => !(l in ri)).length;
        orphans += Object.keys(ri).filter((l) => !exLocs.has(l)).length;
      }
    }
    rows.push([s.key, present, missing.length, entries, st.get("agreed") || 0, st.get("corrected") || 0, st.get("disputed") || 0, drops, unresolved, orphans]);
    if (missing.length) out(`  ${s.key}: no resolve chunk for ${missing.join(", ")}`);
  }
  out(table(["source", "chunks", "missing", "entries", "agreed", "corrected", "disputed", "dropped", "unresolved", "orphans"], rows));
  const probs = printProblems(cache.problems, underDir(path.join(PATHS.cache, "resolve", ctx.source || "")));
  return probs.some((p) => p.severity === "malformed") ? 1 : 0;
}

function stepDecks(ctx) {
  const cache = ctx.cache();
  const rows = [];
  for (const d of cache.decks) {
    if (ctx.source && d.deck !== ctx.source) continue;
    const items = d.chunks.flatMap((c) => c.data.items);
    const st = countBy(items, (it) => (isObj(it.check) ? it.check.status : undefined));
    const me = countBy(items, (it) => (isObj(it.check) ? it.check.method : undefined));
    const ty = countBy(items, (it) => it.type);
    rows.push([d.deck, d.chunks.length, items.length, d.chunks.reduce((n, c) => n + c.data.skipped.length, 0),
      st.get("agreed") || 0, st.get("corrected") || 0, items.length - (st.get("agreed") || 0) - (st.get("corrected") || 0),
      me.get("blind") || 0, me.get("blind+sim") || 0, ty.get("free") || 0, ty.get("mcq") || 0, ty.get("numeric") || 0]);
  }
  out(table(["deck", "chunks", "cards", "skipped", "agreed", "corrected", "other", "blind", "blind+sim", "free", "mcq", "numeric"], rows));
  const probs = printProblems(cache.problems, underDir(path.join(PATHS.cache, "decks", ctx.source || "")));
  return probs.some((p) => p.severity === "malformed") ? 1 : 0;
}

// ---------- sim ----------

async function stepSim(ctx) {
  const cache = ctx.cache();
  if (cache.malformed.length) {
    printProblems(cache.malformed);
    errOut("sim: the cache has malformed files, so the bank answers are unknown: fix them first");
    return 1;
  }
  const m = merge(cache, ctx.sources);
  const byTag = new Map(m.records.filter((r) => r.kind === "practice").map((r) => [`${r.key}/${r.locator}`, r]));
  const droppedTags = new Set(m.dropped.map((d) => `${d.key}/${d.locator}`));
  const known = new Set(ctx.sources.map((s) => s.key));
  const prevByChunk = new Map(cache.practice.flatMap((s) => s.chunks.map((c) => [`${s.key}/${c.chunk}`, c])));

  let scripts = simLib.listScripts();
  for (const s of scripts.filter((x) => !known.has(x.key))) out(`  warning: ${rel(s.file)}: no source "${s.key}" in sources.json: not run`);
  scripts = scripts.filter((s) => known.has(s.key) && (!ctx.source || s.key === ctx.source));
  const scriptChunks = new Set(scripts.map((s) => `${s.key}/${s.chunk}`));
  for (const [k, c] of prevByChunk) {
    if ((!ctx.source || c.key === ctx.source) && c.sim && !scriptChunks.has(k)) {
      out(`  warning: ${rel(c.simPath)} has no script ${c.key}-${c.chunk}.py: its results cannot be re-run`);
    }
  }

  const jobs = simLib.defaultJobs();
  out(`sim: ${scripts.length} scripts, ${jobs} at a time, ${simLib.TIMEOUT_MS / 1000} s timeout each`);
  let done = 0;
  const results = await simLib.pool(scripts, jobs, async (s) => {
    const r = await simLib.runScript(s);
    done++;
    let parsed = null;
    let error = null;
    if (r.spawnError) error = `cannot run python3: ${r.spawnError}`;
    else if (r.timedOut) error = `timed out after ${simLib.TIMEOUT_MS / 1000} s`;
    else if (r.code !== 0) error = `exit ${r.code}${r.signal ? ` (${r.signal})` : ""}: ${shorten(r.stderr.trim().split("\n").slice(-1)[0] || "", 160)}`;
    else {
      const p = simLib.parseOutput(r.stdout);
      if (p.ok) parsed = p.value;
      else error = p.error;
    }
    out(`  [${String(done).padStart(2)}/${scripts.length}] ${s.name.padEnd(36)} ${(r.ms / 1000).toFixed(1).padStart(6)} s  ${error ? `FAILED: ${error}` : `${Object.keys(parsed).length} results`}`);
    return { s, r, parsed, error };
  });

  const run = { generated: new Date().toISOString(), scripts: [] };
  const conflicts = [];
  const failures = [];
  const orphans = [];
  for (const { s, r, parsed, error } of results) {
    const file = path.join(PATHS.cache, "sim", s.key, `${s.chunk}.json`);
    const entries = {};
    let okCount = 0;
    let badCount = 0;
    if (error) {
      // Every result this chunk had becomes a failure: an old estimate must not count as a pass.
      const prev = prevByChunk.get(`${s.key}/${s.chunk}`);
      for (const [loc, pe] of Object.entries((prev && prev.sim) || {})) {
        const rec = byTag.get(`${s.key}/${loc}`);
        entries[loc] = { ok: false, method: pe.method, estimate: null, se: null, expected: rec && rec.item.type === "numeric" ? rec.item.answer.value : null, note: `script failed: ${error}` };
        badCount++;
        failures.push({ id: rec ? rec.item.id : `${s.key}/${loc}`, why: `script failed: ${error}` });
      }
      if (!badCount) failures.push({ id: s.name, why: `script failed: ${error}` });
    } else {
      for (const [loc, res] of Object.entries(parsed)) {
        const tag = `${s.key}/${loc}`;
        const rec = byTag.get(tag);
        const e = isObj(res) ? res : {};
        const item = rec ? rec.item : null;
        const c = simLib.compare(e, item);
        const entry = {
          ok: c.ok,
          method: e.method,
          estimate: typeof e.estimate === "number" ? e.estimate : null,
          se: typeof e.se === "number" ? e.se : null,
          expected: item && item.type === "numeric" ? item.answer.value : null,
        };
        if (!c.ok) entry.note = droppedTags.has(tag) ? "item dropped at assembly" : c.why;
        entries[loc] = entry;
        if (!rec || item.type !== "numeric") {
          orphans.push({ tag, why: droppedTags.has(tag) ? "item dropped at assembly" : c.why });
          continue;
        }
        if (c.ok) okCount++;
        else {
          badCount++;
          (c.kind === "disagree" ? conflicts : failures).push({ id: item.id, why: c.why });
        }
      }
    }
    writeJson(file, entries);
    run.scripts.push({ script: s.name, key: s.key, chunk: s.chunk, status: error ? "failed" : "ok", ms: r.ms, exitCode: r.code, error: error || undefined, locators: Object.keys(entries).length, ok: okCount, bad: badCount });
  }
  // Keep the other sources' rows when only one source was re-run.
  if (ctx.source) {
    const prev = readJson(SIM_RUN);
    if (prev.ok && isObj(prev.value) && Array.isArray(prev.value.scripts)) {
      run.scripts = [...prev.value.scripts.filter((x) => x.key !== ctx.source), ...run.scripts];
    }
  }
  writeJson(SIM_RUN, run);
  ctx.invalidate();

  const tot = run.scripts.filter((x) => !ctx.source || x.key === ctx.source);
  out(`sim: ${tot.reduce((n, x) => n + x.ok, 0)} agree, ${conflicts.length} conflicts, ${failures.length} failures, ${orphans.length} results with no numeric item; ${tot.filter((x) => x.status !== "ok").length} scripts failed`);
  for (const c of conflicts) out(`  CONFLICT ${c.id}: ${c.why}`);
  for (const f of failures) out(`  FAILURE  ${f.id}: ${f.why}`);
  for (const o of orphans) out(`  orphan   ${o.tag}: ${o.why}`);
  return conflicts.length || failures.length ? 1 : 0;
}

// ---------- assemble ----------

function readNc150() {
  const file = path.join(PATHS.resources, NC150);
  const r = readJson(file);
  if (!r.ok) return { error: `${file}: ${r.error}` };
  const v = r.value;
  if (!isObj(v) || v.list !== "neetcode150" || typeof v.source !== "string" || !Array.isArray(v.problems)) {
    return { error: `${file}: expected { source, list: "neetcode150", count, problems: [...] }` };
  }
  const bad = v.problems.findIndex((p) => !isObj(p) || !("problem" in p) || !("difficulty" in p) || !("leetcode_id" in p) || !("slug" in p));
  if (bad >= 0) return { error: `${file}: problems[${bad}] lacks problem / slug / difficulty / leetcode_id` };
  if (v.count !== v.problems.length) return { error: `${file}: count ${v.count} but ${v.problems.length} problems` };
  return { value: v };
}

// Everything assemble and report need, computed without writing.
function computeState(ctx) {
  if (ctx.state) return ctx.state;
  const cache = ctx.cache();
  const merged = merge(cache, ctx.sources);
  const allItems = [...merged.practice, ...DECKS.flatMap((d) => merged.decks[d])];
  const validation = validate(merged);
  const buildErrors = [...merged.buildErrors];
  const library = libraryPlan(allItems, ctx.sources);
  for (const p of library.problems) buildErrors.push({ id: "library", key: "library", field: "source.file", kind: "library", msg: p });
  const planned = new Set(library.plan.map((e) => e.file));
  for (const it of allItems) {
    const f = it.source && it.source.file;
    if (typeof f === "string" && !planned.has(f)) buildErrors.push({ id: it.id, key: it.source.key, field: "source.file", kind: "cited file not in the library", msg: `${f} is not in the library plan` });
  }
  const nc = readNc150();
  if (nc.error) buildErrors.push({ id: "lists", key: "lists", field: "neetcode150", kind: "neetcode list", msg: nc.error });
  const simRun = readJson(SIM_RUN);
  ctx.state = {
    generated: new Date().toISOString(),
    sources: ctx.sources, cache, merged, allItems, validation, buildErrors, library, nc150: nc.value || null,
    simRun: simRun.ok && isObj(simRun.value) && Array.isArray(simRun.value.scripts) ? simRun.value : null,
  };
  return ctx.state;
}

// source.file of every item must be a file in bank/library/ (checked once per state).
function checkLibraryOnDisk(state) {
  if (state.diskChecked) return;
  state.diskChecked = true;
  for (const [file, id] of missingCited(state.allItems)) {
    state.buildErrors.push({ id, key: String(id).split("-")[0], field: "source.file", kind: "cited file missing from bank/library", msg: `bank/library/${file} is not a file` });
  }
}

function bankText(header, items) {
  const head = JSON.stringify(header);
  return `${head.slice(0, -1)},"items":[\n${items.map((it) => JSON.stringify(it)).join(",\n")}\n]}\n`;
}

function printErrors(title, errors) {
  out(`${title}: ${errors.length}`);
  for (const e of errors) out(`  ${e.id}  ${e.field}  ${e.msg}`);
  if (errors.length) {
    out(`${title}, grouped by (source, field, kind):`);
    out(table(["source", "field", "kind", "count", "examples"], groupErrors(errors).map((g) => [g.key, g.field, g.kind, g.count, g.examples.join(" ")])));
  }
}

function stepAssemble(ctx) {
  if (ctx.source) out(`assemble: the source filter (${ctx.source}) does not apply; assembling the whole bank`);
  const cache = ctx.cache();
  if (cache.malformed.length) {
    printProblems(cache.malformed);
    errOut("assemble: the cache has malformed files: nothing written");
    return 1;
  }
  const state = computeState(ctx);
  const { merged } = state;

  // The library and the list first: they do not depend on the items being valid.
  if (state.library.plan.length) {
    state.libraryWrite = writeLibrary(state.library.plan);
    out(`assemble: bank/library/: ${state.libraryWrite.total} files (copied ${state.libraryWrite.copied}, up to date ${state.libraryWrite.kept}, removed ${state.libraryWrite.removed}), index.json`);
  }
  checkLibraryOnDisk(state);
  if (state.nc150) {
    writeJson(path.join(PATHS.bank, "lists", "neetcode150.json"), state.nc150);
    out(`assemble: bank/lists/neetcode150.json: ${state.nc150.problems.length} problems`);
  }

  const files = [
    [path.join(PATHS.bank, "bank.json"), { version: 1, generated: state.generated }, merged.practice],
    ...DECKS.map((d) => [path.join(PATHS.bank, "decks", `${d}.json`), { version: 1, deck: d, generated: state.generated }, merged.decks[d]]),
  ];
  const ok = state.validation.length === 0 && state.buildErrors.length === 0;
  if (ok) {
    for (const [file, header, items] of files) writeFileAtomic(file, bankText(header, items));
    out(`assemble: wrote bank/bank.json (${merged.practice.length} items), ${DECKS.map((d) => `bank/decks/${d}.json (${merged.decks[d].length})`).join(", ")}`);
  } else {
    // Never leave an older bank next to a newer library and report: the UI shows "Bank not built".
    for (const [file] of files) fs.rmSync(file, { force: true });
    out("assemble: bank/bank.json and bank/decks/*.json NOT written (and any older copies removed): fix the errors below in the cache");
  }
  state.written = ok;

  const st = countBy(state.allItems, (it) => it.check && it.check.status);
  out(`assemble: ${merged.practice.length} practice items, ${DECKS.map((d) => `${merged.decks[d].length} ${d}`).join(", ")} cards; ` +
    `${[...st.entries()].map(([k, n]) => `${k} ${n}`).join(", ")}; dropped ${merged.dropped.length}, unverified practice ${merged.unresolved.length}`);
  for (const w of merged.warnings) out(`  warning: ${w}`);
  printErrors("bankValidate errors", state.validation);
  printErrors("build check errors", state.buildErrors);
  return ok ? 0 : 1;
}

// ---------- report ----------

function stepReport(ctx) {
  const state = computeState(ctx);
  checkLibraryOnDisk(state); // a no-op when assemble already checked it in this run
  const file = path.join(PATHS.bank, "REPORT.md");
  writeFileAtomic(file, renderReport(state));
  const acc = acceptance(state);
  out(`report: wrote ${rel(file)}`);
  out(table(["acceptance (spec §10)", "result", "value"], [...acc.checks, ...acc.extra].map((c) => [c.name, c.pass ? "PASS" : "FAIL", c.value])));
  return acc.pass ? 0 : 1;
}

// ---------- main ----------

const RUN = { ocr: stepOcr, extract: stepExtract, resolve: stepResolve, sim: stepSim, decks: stepDecks, assemble: stepAssemble, report: stepReport };

async function main(argv = process.argv.slice(2)) {
  let sources;
  try {
    sources = loadSources();
  } catch (e) {
    errOut(`bank:build: cannot read bank-build/sources.json (${e.message})`);
    return 1;
  }
  const args = parseArgs(argv, sources);
  if (args.help) {
    out(usage(sources));
    return 0;
  }
  if (args.error) {
    errOut(`bank:build: ${args.error}\n\n${usage(sources)}`);
    return 1;
  }
  let cached = null;
  const ctx = {
    sources,
    source: args.source,
    cache: () => (cached = cached || loadCache(sources)),
    invalidate: () => {
      cached = null;
      ctx.state = null;
    },
    state: null,
  };
  const results = [];
  for (const step of args.steps) {
    out(`\n== bank:build ${step}${args.source ? " " + args.source : ""}`);
    let code;
    try {
      code = await RUN[step](ctx);
    } catch (e) {
      errOut(`bank:build ${step}: ${e && e.stack ? e.stack : e}`);
      code = 1;
    }
    results.push([step, code]);
  }
  if (results.length > 1) out(`\nbank:build: ${results.map(([s, c]) => `${s} ${c === 0 ? "ok" : "FAILED"}`).join(", ")}`);
  return results.some(([, c]) => c !== 0) ? 1 : 0;
}

module.exports = { STEPS, STEP_NAMES, DECKS, loadSources, parseArgs, bankText };

if (require.main === module) main().then((code) => { process.exitCode = code; });
