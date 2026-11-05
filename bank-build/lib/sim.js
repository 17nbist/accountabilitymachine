// The simulation check (spec §10 step 3): bank-build/sim/items/<key>-<chunk>.py are the scripts the
// M2 sim agents wrote. Each prints one JSON object { "<locator>": { method: "enum"|"mc",
// estimate: number, se: number|null } } on stdout. They run with `python3 -I` (stdlib only).
//
// An item's simulation agrees when (and only when):
//   enum: the estimate equals the answer exactly (relative 1e-9, absolute floor 1e-12);
//   mc:   the estimate is within 3 standard errors of the answer (exactly, without a positive se).
// The item's answer.tol plays no part: it is the marking tolerance for a typed answer, not
// evidence that the answer is right, so an estimate outside these bounds is a conflict.
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const PrepAnswer = require("../../prep/answer.js");
const { PATHS, naturalCompare } = require("./util.js");

const TIMEOUT_MS = 120 * 1000;
const EXACT_REL = 1e-9;
const EXACT_ABS = 1e-12;
const MC_SIGMAS = 3;

// { ok, kind, why, z? } for one sim entry against the bank item it checks. kind is "agree",
// "disagree" (a real conflict between the simulation and the answer) or "error" (no comparison
// was possible: no item, an answer that does not parse, no estimate, an unknown method).
function compare(entry, item) {
  const r = compareRaw(entry, item);
  return { ...r, kind: r.ok ? "agree" : r.kind || "disagree" };
}

function compareRaw(entry, item) {
  if (!item) return { ok: false, kind: "error", why: "no such item in the bank" };
  if (item.type !== "numeric") return { ok: false, kind: "error", why: `item is ${item.type}, not numeric` };
  const exp = PrepAnswer.parseAnswer(item.answer && item.answer.value);
  if (!exp.ok) return { ok: false, kind: "error", why: `the bank answer does not parse (${exp.error})` };
  const est = entry && entry.estimate;
  if (typeof est !== "number" || !Number.isFinite(est)) return { ok: false, kind: "error", why: entry && entry.note ? entry.note : "no finite estimate" };
  const d = Math.abs(est - exp.value);
  const exact = d <= Math.max(EXACT_ABS, EXACT_REL * Math.abs(exp.value));
  const method = entry.method;
  if (method === "enum") {
    if (exact) return { ok: true, why: "exact" };
    return { ok: false, why: `enumeration gives ${est}, the answer is ${exp.value}` };
  }
  if (method === "mc") {
    const se = entry.se;
    if (typeof se === "number" && Number.isFinite(se) && se > 0) {
      const z = d / se;
      if (z <= MC_SIGMAS) return { ok: true, why: `z = ${z.toFixed(2)}`, z };
      return { ok: false, why: `Monte Carlo gives ${est} ± ${se}, the answer is ${exp.value} (z = ${z.toFixed(1)})`, z };
    }
    // No usable standard error: only an exact match counts.
    if (exact) return { ok: true, why: "exact (no standard error)" };
    return { ok: false, why: `Monte Carlo gives ${est} with no standard error, the answer is ${exp.value}` };
  }
  return { ok: false, kind: "error", why: `unknown sim method ${JSON.stringify(method)}` };
}

// The scripts on disk: [{ name, file, key, chunk }] in natural order. The key has no hyphen (KEY_RE),
// so the chunk is everything after the first one.
function listScripts(dir = PATHS.simItems) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter(n => n.endsWith(".py") && !n.startsWith("."))
    .sort(naturalCompare)
    .map(name => {
      const base = name.replace(/\.py$/, "");
      const i = base.indexOf("-");
      return { name, file: path.join(dir, name), key: i > 0 ? base.slice(0, i) : base, chunk: i > 0 ? base.slice(i + 1) : "" };
    });
}

// Python's json.dumps writes NaN / Infinity, which JSON.parse rejects: read them as null (a
// failed estimate).
function parseJsonLenient(text) {
  try {
    return JSON.parse(text);
  } catch {
    return JSON.parse(text.replace(/-?\bInfinity\b|\bNaN\b/g, "null"));
  }
}

// The script's JSON object: the whole stdout, or else the last line-initial "{" from which the
// rest of stdout parses (scripts may log before the final dump).
function parseOutput(stdout) {
  const text = stdout.trim();
  const starts = [];
  if (text.startsWith("{")) starts.push(0);
  const re = /\n\{/g;
  let m;
  while ((m = re.exec(text))) starts.push(m.index + 1);
  for (const s of starts) {
    try {
      const v = parseJsonLenient(text.slice(s));
      if (typeof v === "object" && v !== null && !Array.isArray(v)) return { ok: true, value: v };
    } catch {
      // try the next start
    }
  }
  return { ok: false, error: text ? "stdout holds no JSON object" : "no output" };
}

function runScript(script, timeoutMs = TIMEOUT_MS) {
  return new Promise(resolve => {
    const t0 = Date.now();
    const child = spawn("python3", ["-I", script.file], {
      cwd: path.dirname(script.file),
      stdio: ["ignore", "pipe", "pipe"],
    });
    const out = [];
    const err = [];
    let timedOut = false;
    child.stdout.on("data", b => out.push(b));
    child.stderr.on("data", b => err.push(b));
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    const finish = (code, signal, spawnError) => {
      clearTimeout(timer);
      resolve({
        code, signal, timedOut, spawnError,
        ms: Date.now() - t0,
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
      });
    };
    child.on("error", e => finish(null, null, e.message));
    child.on("close", (code, signal) => finish(code, signal, null));
  });
}

// Runs fn over list with at most `jobs` in flight; results keep the list order.
async function pool(list, jobs, fn) {
  const results = new Array(list.length);
  let next = 0;
  async function worker() {
    while (next < list.length) {
      const i = next++;
      results[i] = await fn(list[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(jobs, list.length) }, worker));
  return results;
}

function defaultJobs() {
  const env = Number(process.env.BANK_SIM_JOBS);
  if (Number.isInteger(env) && env > 0) return env;
  return Math.max(1, Math.min(8, Math.floor(os.cpus().length / 2)));
}

module.exports = { TIMEOUT_MS, MC_SIGMAS, compare, listScripts, parseOutput, runScript, pool, defaultJobs };
