// Shared helpers for the bank:build pipeline (V4-CONTRACTS §M7). Node built-ins only.
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const REPO = path.resolve(__dirname, "..", "..");
const BUILD = path.join(REPO, "bank-build");
const PATHS = {
  repo: REPO,
  build: BUILD,
  cache: path.join(BUILD, ".cache"),
  simItems: path.join(BUILD, "sim", "items"),
  bank: path.join(REPO, "bank"),
  // The resource library (spec §0). BANK_RESOURCES overrides it, e.g. for a copy elsewhere.
  resources: process.env.BANK_RESOURCES || path.join(os.homedir(), "Documents", "Quant Prep", "resources"),
};

const DECKS = ["cpp", "systems"];

// §E1 library categories, in folder order.
const CATEGORIES = [
  { folder: "00-user-supplied", label: "User supplied" },
  { folder: "01-probability", label: "Probability" },
  { folder: "02-quant-interview", label: "Quant interview" },
  { folder: "03-cpp", label: "C++" },
  { folder: "04-systems-low-latency", label: "Systems & low latency" },
  { folder: "05-coding-lists", label: "Coding lists" },
];

// Natural order: digit runs compare as numbers ("sp-2" < "sp-10"), the rest by code unit.
function naturalCompare(a, b) {
  const re = /(\d+|\D+)/g;
  const pa = String(a).match(re) || [];
  const pb = String(b).match(re) || [];
  for (let i = 0; i < Math.min(pa.length, pb.length); i++) {
    const x = pa[i];
    const y = pb[i];
    if (x === y) continue;
    const dx = /^\d/.test(x);
    const dy = /^\d/.test(y);
    if (dx && dy) {
      const d = Number(x) - Number(y);
      if (d !== 0) return d;
      return x.length - y.length; // "01" after "1"
    }
    return x < y ? -1 : 1;
  }
  return pa.length - pb.length;
}

// { ok: true, value } or { ok: false, error } for a JSON file.
function readJson(file) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (e) {
    return { ok: false, missing: e.code === "ENOENT", error: e.message };
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e) {
    return { ok: false, error: `invalid JSON: ${e.message}` };
  }
}

function writeFileAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

function writeJson(file, value) {
  writeFileAtomic(file, JSON.stringify(value, null, 1) + "\n");
}

// The *.json files of a directory in natural order ([] when it does not exist).
function jsonFiles(dir) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names.filter(n => n.endsWith(".json") && !n.startsWith(".")).sort(naturalCompare);
}

function subdirs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(d => d.isDirectory() && !d.name.startsWith("."))
      .map(d => d.name)
      .sort(naturalCompare);
  } catch {
    return [];
  }
}

const isObj = x => typeof x === "object" && x !== null && !Array.isArray(x);
const clone = x => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
const rel = p => path.relative(REPO, p) || ".";

function countBy(list, fn) {
  const m = new Map();
  for (const x of list) {
    const k = fn(x);
    m.set(k, (m.get(k) || 0) + 1);
  }
  return m;
}

// Plain-text table for terminal output.
function table(header, rows) {
  const all = [header, ...rows].map(r => r.map(c => String(c)));
  const w = header.map((_, i) => Math.max(...all.map(r => (r[i] || "").length)));
  // Columns whose values are all numbers are right-aligned, the rest left-aligned.
  const num = header.map((_, i) => rows.length > 0 && all.slice(1).every(r => /^-?\d+(\.\d+)?%?$/.test(r[i] || "")));
  const line = r => r.map((c, i) => (num[i] ? c.padStart(w[i]) : c.padEnd(w[i]))).join("  ").trimEnd();
  return [line(all[0]), ...all.slice(1).map(line)].join("\n");
}

function shorten(s, n = 120) {
  const t = String(s).replace(/\s+/g, " ");
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}

module.exports = {
  PATHS, DECKS, CATEGORIES,
  naturalCompare, readJson, writeFileAtomic, writeJson, jsonFiles, subdirs,
  isObj, clone, rel, countBy, table, shorten,
};
