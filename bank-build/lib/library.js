// bank/library/ (spec §10 step 5, V4-CONTRACTS §E1): every PDF of the six library folders, plus any
// other file a bank item cites (e.g. the Core Guidelines markdown), copied to the same relative
// path, and index.json describing them. The OCR'd Green Book replaces the scan at the scan's path,
// so an entry's `file` is exactly the `source.file` its items cite (§E1).
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { PATHS, CATEGORIES, naturalCompare, readJson, writeJson, isObj } = require("./util.js");

const FOLDERS = new Set(CATEGORIES.map(c => c.folder));
const OCR_KEY = "greenbook";

function walkFiles(root, relDir, out) {
  let entries;
  try {
    entries = fs.readdirSync(path.join(root, relDir), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const r = relDir ? `${relDir}/${e.name}` : e.name;
    if (e.isDirectory()) walkFiles(root, r, out);
    else if (e.isFile()) out.push(r);
  }
  return out;
}

// One "*" inside a path segment, as in sources.json `file`.
function globRe(glob) {
  const esc = glob.split("*").map(s => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*");
  return new RegExp(`^${esc}$`);
}

// file -> { title, single } from manifest.json local_paths (files, or folders ending in "/").
function manifestTitles(resRoot) {
  const r = readJson(path.join(resRoot, "manifest.json"));
  const exact = new Map();
  const dirs = [];
  if (!r.ok || !isObj(r.value) || !Array.isArray(r.value.categories)) return { exact, dirs, error: r.ok ? "unexpected shape" : r.error };
  const prefix = `${String(r.value.root || resRoot).replace(/\/+$/, "")}/`;
  for (const cat of r.value.categories) {
    for (const e of (cat && Array.isArray(cat.entries) ? cat.entries : [])) {
      const paths = Array.isArray(e.local_paths) ? e.local_paths : [];
      const single = paths.length === 1 && !paths[0].endsWith("/");
      for (const p of paths) {
        const rp = p.startsWith(prefix) ? p.slice(prefix.length) : p;
        if (rp.endsWith("/")) dirs.push({ dir: rp, title: e.title });
        else if (!exact.has(rp)) exact.set(rp, { title: e.title, single });
      }
    }
  }
  return { exact, dirs };
}

const stem = f => path.basename(f).replace(/\.[^.]+$/, "");

// Title rule (BUILD-NOTES §1): the manifest.json entry that lists the file (its title, plus the file
// name when the entry covers several files); else the sources.json source whose `file` matches;
// else the most common source.title of the items citing it; else the file name.
function titleFor(file, mf, sources, citedTitles) {
  const ex = mf.exact.get(file);
  if (ex) return ex.single ? ex.title : `${ex.title}: ${stem(file)}`;
  const dir = mf.dirs.find(d => file.startsWith(d.dir));
  if (dir) return `${dir.title}: ${stem(file)}`;
  for (const s of sources) {
    if (typeof s.file !== "string") continue;
    if (s.file === file) return s.title;
    if (s.file.includes("*") && globRe(s.file).test(file)) return `${s.title}: ${stem(file)}`;
  }
  const t = citedTitles.get(file);
  if (t) return [...t.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0];
  return stem(file);
}

// The plan: [{ file, src, title, key?, folder }] plus problems. Reads the library and the cache,
// writes nothing.
function libraryPlan(items, sources, { resRoot = PATHS.resources, cacheDir = PATHS.cache } = {}) {
  const problems = [];
  const files = new Set();
  for (const top of fs.existsSync(resRoot) ? fs.readdirSync(resRoot) : []) {
    if (!FOLDERS.has(top)) continue;
    for (const f of walkFiles(resRoot, top, [])) if (/\.pdf$/i.test(f)) files.add(f);
  }
  if (!fs.existsSync(resRoot)) problems.push(`the resource library ${resRoot} does not exist`);

  const citedKeys = new Map();
  const citedTitles = new Map();
  for (const it of items) {
    const f = it && it.source && it.source.file;
    if (typeof f !== "string") continue;
    files.add(f);
    const k = it.source.key;
    if (!citedKeys.has(f)) citedKeys.set(f, new Map());
    citedKeys.get(f).set(k, (citedKeys.get(f).get(k) || 0) + 1);
    if (!citedTitles.has(f)) citedTitles.set(f, new Map());
    const t = it.source.title;
    if (typeof t === "string" && t) citedTitles.get(f).set(t, (citedTitles.get(f).get(t) || 0) + 1);
  }

  const ocrSrc = sources.find(s => s.key === OCR_KEY);
  const ocrFile = ocrSrc ? ocrSrc.file : null;
  const mf = manifestTitles(resRoot);
  if (mf.error) problems.push(`manifest.json: ${mf.error} (titles fall back to sources.json and file names)`);

  const plan = [];
  for (const file of [...files].sort(naturalCompare)) {
    const folder = file.split("/")[0];
    if (!FOLDERS.has(folder)) {
      problems.push(`${file}: cited, but outside the six library folders of §E1`);
      continue;
    }
    if (file.split("/").includes("..")) {
      problems.push(`${file}: has a .. segment`);
      continue;
    }
    const src = file === ocrFile ? path.join(cacheDir, "greenbook-ocr.pdf") : path.join(resRoot, file);
    if (!fs.existsSync(src)) {
      problems.push(`${file}: source file ${src} does not exist${file === ocrFile ? " (run the ocr step)" : ""}`);
      continue;
    }
    const entry = { file, src, folder, title: titleFor(file, mf, sources, citedTitles) };
    const keys = citedKeys.get(file);
    if (keys) {
      // The key with the most items citing the file (ties: plain < order).
      entry.key = [...keys.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0];
      if (keys.size > 1) entry.otherKeys = [...keys.keys()].filter(k => k !== entry.key).sort();
    }
    plan.push(entry);
  }
  return { plan, problems };
}

function indexJson(plan) {
  return {
    version: 1,
    categories: CATEGORIES
      .map(c => ({
        folder: c.folder,
        label: c.label,
        entries: plan.filter(e => e.folder === c.folder).map(e => (e.key ? { file: e.file, title: e.title, key: e.key } : { file: e.file, title: e.title })),
      }))
      .filter(c => c.entries.length > 0),
  };
}

// Copies the plan into libDir (APFS clone when possible), skips up-to-date copies, removes files the
// plan no longer has, and writes index.json. Returns counts.
function writeLibrary(plan, libDir = path.join(PATHS.bank, "library")) {
  fs.mkdirSync(libDir, { recursive: true });
  let copied = 0;
  let kept = 0;
  const want = new Set(plan.map(e => e.file));
  want.add("index.json");
  for (const e of plan) {
    const dest = path.join(libDir, e.file);
    const s = fs.statSync(e.src);
    let d = null;
    try {
      d = fs.statSync(dest);
    } catch {
      // not there yet
    }
    if (d && d.isFile() && d.size === s.size && d.mtimeMs >= s.mtimeMs) {
      kept++;
      continue;
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(e.src, dest, fs.constants.COPYFILE_FICLONE);
    copied++;
  }
  let removed = 0;
  for (const f of walkFiles(libDir, "", [])) {
    if (!want.has(f)) {
      fs.unlinkSync(path.join(libDir, f));
      removed++;
    }
  }
  pruneEmptyDirs(libDir, true);
  writeJson(path.join(libDir, "index.json"), indexJson(plan));
  return { copied, kept, removed, total: plan.length };
}

function pruneEmptyDirs(dir, isRoot) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) pruneEmptyDirs(path.join(dir, e.name), false);
  }
  if (!isRoot && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
}

// The cited files that are not regular files under libDir.
function missingCited(items, libDir = path.join(PATHS.bank, "library")) {
  const missing = new Map();
  for (const it of items) {
    const f = it && it.source && it.source.file;
    if (typeof f !== "string" || missing.has(f)) continue;
    let ok = false;
    try {
      ok = fs.statSync(path.join(libDir, f)).isFile();
    } catch {
      ok = false;
    }
    if (!ok) missing.set(f, it.id);
  }
  return missing;
}

module.exports = { OCR_KEY, libraryPlan, indexJson, writeLibrary, missingCited, globRe };
