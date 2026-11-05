// test:holdout (V4-CONTRACTS.md §M5; spec §11 phase 6): runs the hold-out suite, which lives
// outside the repo, against this checkout. Output goes through scripts/holdout-reporter.js, which
// prints only test names with ok / not ok and the totals, so implementers never see the hold-out
// cases themselves. The exit code is node's.
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "..");
const REPORTER = "./scripts/holdout-reporter.js"; // relative to the child's cwd, the repo root

function defaultHoldoutDir(home = os.homedir()) {
  return path.join(home, "Documents", "Quant Prep", "holdout-tests");
}

// HOLDOUT_DIR (a leading ~ is os.homedir(), a relative path is relative to the cwd), else the
// default.
function holdoutDir(env = process.env) {
  const v = env.HOLDOUT_DIR;
  if (!v) return defaultHoldoutDir();
  const home = os.homedir();
  return path.resolve(v === "~" || v.startsWith("~/") ? home + v.slice(1) : v);
}

// Every *.test.js below dir, recursively, as absolute paths sorted by code unit. Directory
// symlinks are not followed (no cycles); file symlinks count when they point at a file.
function findTestFiles(dir) {
  const out = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".test.js")) {
        let isFile = e.isFile();
        if (!isFile && e.isSymbolicLink()) {
          try {
            isFile = fs.statSync(p).isFile();
          } catch {
            isFile = false;
          }
        }
        if (isFile) out.push(p);
      }
    }
  })(dir);
  return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function main(env = process.env) {
  const dir = holdoutDir(env);
  let st = null;
  try {
    st = fs.statSync(dir);
  } catch {
    st = null;
  }
  if (!st || !st.isDirectory()) {
    process.stderr.write(`test:holdout: the hold-out dir ${dir} does not exist (set HOLDOUT_DIR)\n`);
    return 1;
  }
  const files = findTestFiles(dir);
  if (files.length === 0) {
    // `node --test` with no files would fall back to discovering the repo's own tests.
    process.stderr.write(`test:holdout: no *.test.js files under ${dir}\n`);
    return 1;
  }
  const r = spawnSync(process.execPath, ["--test", `--test-reporter=${REPORTER}`, ...files], {
    cwd: REPO_ROOT,
    env: { ...env, AM_REPO: REPO_ROOT },
    stdio: "inherit",
  });
  if (r.error) {
    process.stderr.write(`test:holdout: could not start node (${r.error.message})\n`);
    return 1;
  }
  return typeof r.status === "number" ? r.status : 1;
}

module.exports = { defaultHoldoutDir, holdoutDir, findTestFiles, main };

if (require.main === module) process.exitCode = main();
