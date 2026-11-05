// npm run check (V4-CONTRACTS.md §M2): the four steps in order, stopping at the first failure
// with exit 1, and `check-ok` on success (v3 printed `syntax-ok`).
//   1. node --check on every *.js in the root, prep/, scripts/, e2e/, tests/ and bank-build/
//   2. JSON.parse of manifest.json and package.json
//   3. the check:no-bank logic (scripts/check-no-bank.js)
//   4. the lock:verify logic (scripts/lock.js; before tests/LOCK.json exists it skips, pre-lock)
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const noBank = require("./check-no-bank.js");
const lock = require("./lock.js");

const REPO_ROOT = path.resolve(__dirname, "..");

// Directories scanned for *.js. `deep` recurses; `skip` lists subdirectories (relative to the
// scanned dir) that are generated or local output. Dot dirs and node_modules are never entered.
const SYNTAX_DIRS = [
  { dir: "", deep: false },
  { dir: "prep", deep: true },
  { dir: "scripts", deep: true },
  { dir: "e2e", deep: true, skip: ["out"] },
  { dir: "tests", deep: false },
  { dir: "bank-build", deep: true, skip: [".cache", "sim/items"] },
];

function jsFiles(root) {
  const out = [];
  for (const { dir, deep, skip = [] } of SYNTAX_DIRS) {
    (function walk(rel) {
      const abs = path.join(root, dir, rel);
      let entries;
      try {
        entries = fs.readdirSync(abs, { withFileTypes: true });
      } catch {
        return; // a dir that does not exist yet (e.g. prep/ before M1)
      }
      for (const e of entries) {
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) {
          if (deep && !e.name.startsWith(".") && e.name !== "node_modules" && !skip.includes(r)) walk(r);
        } else if (e.isFile() && e.name.endsWith(".js")) {
          out.push(dir ? `${dir}/${r}` : r);
        }
      }
    })("");
  }
  return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function checkSyntax(root, io) {
  const files = jsFiles(root);
  for (const rel of files) {
    const r = spawnSync(process.execPath, ["--check", path.join(root, ...rel.split("/"))], { encoding: "utf8" });
    if (r.error || r.status !== 0) {
      io.err(`check: syntax error in ${rel}`);
      io.err(((r.stderr || "") + (r.error ? r.error.message : "")).trim());
      return 1;
    }
  }
  io.out(`check: syntax ok (${files.length} files)`);
  return 0;
}

function checkJson(root, io) {
  for (const rel of ["manifest.json", "package.json"]) {
    try {
      JSON.parse(fs.readFileSync(path.join(root, rel), "utf8"));
    } catch (e) {
      io.err(`check: ${rel} is not valid JSON (${e.message})`);
      return 1;
    }
  }
  io.out("check: manifest.json and package.json parse");
  return 0;
}

function main(io = { out: console.log, err: console.error }) {
  const steps = [
    () => checkSyntax(REPO_ROOT, io),
    () => checkJson(REPO_ROOT, io),
    () => noBank.run(REPO_ROOT, io),
    () => lock.verify(lock.lockRoot(), io),
  ];
  for (const step of steps) {
    if (step() !== 0) return 1;
  }
  io.out("check-ok");
  return 0;
}

module.exports = { jsFiles, main };

if (require.main === module) process.exitCode = main();
