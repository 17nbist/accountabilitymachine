// check:no-bank (V4-CONTRACTS.md §M3; spec §2): nothing from the local bank build, no PDF and no
// file over 1 MB (outside vendor/ and tests/fixtures/) may be tracked by git. The bank and the
// library hold copyrighted text, and the repo is public.
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "..");
const MAX_BYTES = 1048576;

// files: [{ path, size }] with POSIX paths relative to the repo and size in bytes or null.
// Returns [{ path, rule }], paths in input order and, per path, rules in the order bank, pdf,
// cache, size. Prefixes are case-sensitive (as `git ls-files` prints them); only pdf ignores case.
function noBankViolations(files) {
  const out = [];
  for (const f of files || []) {
    const p = String(f && f.path);
    const size = f ? f.size : null;
    if (p.startsWith("bank/")) out.push({ path: p, rule: "bank" });
    if (/\.pdf$/i.test(p)) out.push({ path: p, rule: "pdf" });
    if (p.startsWith("bank-build/.cache/") || p.startsWith("bank-build/sim/items/")) out.push({ path: p, rule: "cache" });
    if (typeof size === "number" && size > MAX_BYTES && !p.startsWith("vendor/") && !p.startsWith("tests/fixtures/")) {
      out.push({ path: p, rule: "size" });
    }
  }
  return out;
}

const RULE_TEXT = {
  bank: "bank/ is local build output (gitignored)",
  pdf: "PDFs are never committed",
  cache: "bank-build cache and generated sim scripts are local only",
  size: "over 1 MB outside vendor/ and tests/fixtures/",
};

// { files } from `git ls-files -z` at root, { notInGit: true } when root is not a git work tree,
// or { error }.
function trackedFiles(root) {
  const inside = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: root, encoding: "utf8" });
  if (inside.error || inside.status !== 0 || inside.stdout.trim() !== "true") return { notInGit: true };
  const r = spawnSync("git", ["ls-files", "-z"], {
    cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
  });
  if (r.error || r.status !== 0) return { error: `git ls-files failed: ${(r.stderr || "").trim() || (r.error && r.error.message)}` };
  const files = r.stdout.split("\0").filter(Boolean).map((p) => {
    let size = null;
    try {
      size = fs.statSync(path.join(root, ...p.split("/"))).size;
    } catch {
      size = null; // tracked but missing from the working tree
    }
    return { path: p, size };
  });
  return { files };
}

function run(root = REPO_ROOT, io = { out: console.log, err: console.error }) {
  const t = trackedFiles(root);
  if (t.notInGit) {
    io.out(`check:no-bank: notice: ${root} is not a git work tree, so nothing is tracked; no-bank-ok`);
    return 0;
  }
  if (t.error) {
    io.err(`check:no-bank: ${t.error}`);
    return 1;
  }
  const v = noBankViolations(t.files);
  if (v.length) {
    io.err(`check:no-bank: ${v.length} violation(s) in git ls-files:`);
    for (const { path: p, rule } of v) io.err(`  ${rule}: ${p} (${RULE_TEXT[rule]})`);
    return 1;
  }
  io.out("no-bank-ok");
  return 0;
}

module.exports = { noBankViolations, trackedFiles, run };

if (require.main === module) process.exitCode = run();
