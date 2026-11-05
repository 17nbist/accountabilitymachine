// Tooling self-tests (V4-CONTRACTS.md §M10): the package.json scripts (§M2), versions and
// permissions (§M9), .gitignore (§M8), check:no-bank (§M3), the lock (§M4), the hold-out
// runner (§M5) and the Claude Code hook (§M6). NOT v4-prefixed: red until M0, green from M0 on.
//
// Every scripts/ module is required lazily inside each test, so before M0 each test fails on
// its own (missing module or assertion). CLIs only ever run against temp dirs (AM_LOCK_ROOT,
// HOLDOUT_DIR, HOME, AM_GUARD_ROOT): nothing here reads the real hold-out directory or touches
// the real tests/LOCK.json. The hook is only ever asked for a decision about a path string.
// The §M4 git checks run in throwaway `git init` repos inside temp dirs, with the user's git
// config shut out; nothing runs git against the real repo.
//
// Oracles: sha256 comes from node:crypto, and every expected list is written out by hand in
// `<` (code unit) order. No module helper is used to compute its own expected value.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

const REPO = path.resolve(__dirname, "..");
const scriptPath = (name) => path.join(REPO, "scripts", name);
const lockJs = () => require("../scripts/lock.js");
const noBankJs = () => require("../scripts/check-no-bank.js");
const guardJs = () => require("../scripts/guard-locked.js");

const MB = 1048576;
const sha = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));

// ---------- temp dirs and child processes ----------

const TMP_DIRS = [];
function tmpDir(prefix = "am-tooling-") {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  TMP_DIRS.push(d);
  return d;
}
test.after(() => {
  for (const d of TMP_DIRS) fs.rmSync(d, { recursive: true, force: true });
});

function writeTree(root, files) {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, ...rel.split("/"));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
}

// rel path -> sha256 of every regular file under root (dot files and dot dirs included).
function snapshot(root) {
  const out = {};
  (function walk(dir, rel) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(dir, e.name), r);
      else if (e.isFile()) out[r] = sha(fs.readFileSync(path.join(dir, e.name)));
    }
  })(root, "");
  return out;
}

// The environment for a child: inherited, minus anything that would point a script at the real
// repo, the real hold-out dir, a git repo, or the parent test runner; plus `extra`.
function childEnv(extra = {}) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/^NODE_TEST/.test(k)) continue;
    if (/^GIT_(DIR|WORK_TREE|INDEX_FILE|CEILING_DIRECTORIES|COMMON_DIR)$/.test(k)) continue;
    if (["AM_LOCK_ROOT", "AM_GUARD_ROOT", "CLAUDE_PROJECT_DIR", "HOLDOUT_DIR", "AM_REPO"].includes(k)) continue;
    env[k] = v;
  }
  return Object.assign(env, extra);
}

function runScript(name, args = [], { cwd = REPO, env = {}, input = "" } = {}) {
  // A missing script also exits non-zero, so require it to exist first.
  assert.ok(fs.existsSync(scriptPath(name)), `scripts/${name} exists`);
  const r = spawnSync(process.execPath, [scriptPath(name), ...args], {
    cwd, env: childEnv(env), input, encoding: "utf8", timeout: 120000,
  });
  const stdout = r.stdout || "";
  const stderr = r.stderr || "";
  return { status: r.status, stdout, stderr, out: stdout + "\n" + stderr, error: r.error };
}

// ---------- 1. package.json scripts (§M2) ----------

test("§M2 package.json scripts are exactly the M2 table (names and commands)", () => {
  const pkg = readJson(path.join(REPO, "package.json"));
  assert.deepEqual(pkg.scripts, {
    test: "node --test tests/*.test.js",
    check: "node scripts/check.js",
    "check:no-bank": "node scripts/check-no-bank.js",
    "lock:write": "node scripts/lock.js write",
    "lock:verify": "node scripts/lock.js verify",
    "lock:restore": "node scripts/lock.js restore",
    "test:holdout": "node scripts/test-holdout.js",
    "test:coverage":
      "node --test --experimental-test-coverage '--test-coverage-include=prep/*.js' --test-coverage-lines=90 tests/*.test.js",
    "bank:build": "node bank-build/build.js",
    e2e: "node e2e/run.js",
  });
});

test("§M2 requiring a scripts/ module never runs its CLI (require.main guard)", () => {
  const empty = tmpDir();
  const files = ["check.js", "check-no-bank.js", "lock.js", "test-holdout.js", "guard-locked.js"].map(scriptPath);
  for (const f of files) assert.ok(fs.existsSync(f), `${path.relative(REPO, f)} exists`);
  const code = `for (const f of ${JSON.stringify(files)}) require(f); process.stdout.write("loaded-ok");`;
  const r = spawnSync(process.execPath, ["-e", code], {
    cwd: empty,
    env: childEnv({
      AM_LOCK_ROOT: empty, AM_GUARD_ROOT: empty, HOLDOUT_DIR: path.join(empty, "no-such-dir"),
      GIT_CEILING_DIRECTORIES: path.dirname(empty),
    }),
    input: "", encoding: "utf8", timeout: 60000,
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, "loaded-ok");
});

test("§M2/§M3/§M4/§M6 scripts export the listed pure functions", () => {
  const L = lockJs();
  for (const f of ["lockableFiles", "hashFile", "compareLock", "parseDisputes"]) {
    assert.equal(typeof L[f], "function", `lock.js exports ${f}`);
  }
  assert.equal(typeof noBankJs().noBankViolations, "function");
  assert.equal(typeof guardJs().guardDecision, "function");
});

// ---------- 2. manifest and versions (§M9) ----------

test("§M9 manifest.json and package.json are both version 4.0.0", () => {
  assert.equal(readJson(path.join(REPO, "manifest.json")).version, "4.0.0");
  assert.equal(readJson(path.join(REPO, "package.json")).version, "4.0.0");
});

test("§M9 manifest adds unlimitedStorage and makes no other permission or host change", () => {
  const m = readJson(path.join(REPO, "manifest.json"));
  assert.deepEqual([...m.permissions].sort(),
    ["alarms", "notifications", "sidePanel", "storage", "tabs", "unlimitedStorage"]);
  assert.equal(new Set(m.permissions).size, m.permissions.length, "no duplicate permissions");
  assert.deepEqual([...m.host_permissions].sort(),
    ["https://arithmetic.zetamac.com/*", "https://leetcode.com/*", "https://openrouter.ai/*"]);
  assert.deepEqual(m.optional_permissions ?? [], []);
  assert.deepEqual(m.optional_host_permissions ?? [], []);
});

// ---------- 3. .gitignore (§M8) ----------

test("§M8 .gitignore lists bank/, bank-build/.cache/, bank-build/sim/items/, .test-staging/ and keeps the v3 entries", () => {
  const norm = (s) => s.trim().replace(/^\//, "").replace(/\/$/, "");
  const lines = fs.readFileSync(path.join(REPO, ".gitignore"), "utf8")
    .split(/\r?\n/).map(norm).filter((l) => l && !l.startsWith("#"));
  const want = ["bank/", "bank-build/.cache/", "bank-build/sim/items/", ".test-staging/",
    ".claude/", "node_modules/", "e2e/out/"];
  const missing = want.filter((e) => !lines.includes(norm(e)));
  assert.deepEqual(missing, []);
});

// ---------- 4. check:no-bank (§M3) ----------

const violations = (files) => noBankJs().noBankViolations(files).map((v) => [v.path, v.rule]);

test("§M3 noBankViolations: one entry per rule, rules ordered bank, pdf, cache, size, paths in input order", () => {
  const input = [
    { path: "prep/srs.js", size: 1200 },
    { path: "docs/zeta-notes.PDF", size: null },
    { path: "bank/x.pdf", size: 10 },
    { path: "bank/bank.json", size: 3 * MB },
    { path: "bank-build/.cache/greenbook-ocr.pdf", size: 5 * MB },
    { path: "bank-build/sim/items/fx1.py", size: 100 },
    { path: "bank/library/stats/b.Pdf", size: 2 * MB },
    { path: "docs/alpha-notes.pdf", size: 5 },
    { path: "README.md", size: 6000 },
  ];
  assert.deepEqual(violations(input), [
    ["docs/zeta-notes.PDF", "pdf"],
    ["bank/x.pdf", "bank"], ["bank/x.pdf", "pdf"],
    ["bank/bank.json", "bank"], ["bank/bank.json", "size"],
    ["bank-build/.cache/greenbook-ocr.pdf", "pdf"], ["bank-build/.cache/greenbook-ocr.pdf", "cache"],
    ["bank-build/.cache/greenbook-ocr.pdf", "size"],
    ["bank-build/sim/items/fx1.py", "cache"],
    ["bank/library/stats/b.Pdf", "bank"], ["bank/library/stats/b.Pdf", "pdf"], ["bank/library/stats/b.Pdf", "size"],
    ["docs/alpha-notes.pdf", "pdf"],
  ]);
});

test("§M3 noBankViolations: size is > 1048576 bytes outside vendor/ and tests/fixtures/; null size never violates", () => {
  const input = [
    { path: "e2e/out/at-limit.png", size: MB },
    { path: "e2e/out/over-limit.png", size: MB + 1 },
    { path: "vendor/katex/fonts/KaTeX_Main.woff2", size: 9 * MB },
    { path: "tests/fixtures/bank-mini/bank.json", size: 2 * MB },
    { path: "tests/big.test.js", size: 2 * MB },
    { path: "vendor-old/huge.bin", size: 2 * MB },
    { path: "tests/fixtures-old/huge.bin", size: 2 * MB },
    { path: "lib/vendor/huge.bin", size: 2 * MB },
    { path: "deleted-from-worktree.bin", size: null },
    { path: "vendor/manual.pdf", size: 10 },
    { path: "tests/fixtures/huge.pdf", size: 2 * MB },
  ];
  assert.deepEqual(violations(input), [
    ["e2e/out/over-limit.png", "size"],
    ["tests/big.test.js", "size"],
    ["vendor-old/huge.bin", "size"],
    ["tests/fixtures-old/huge.bin", "size"],
    ["lib/vendor/huge.bin", "size"],
    ["vendor/manual.pdf", "pdf"],
    ["tests/fixtures/huge.pdf", "pdf"],
  ]);
});

test("§M3 noBankViolations: clean paths give [] (bank only at the start, pdf only as the extension)", () => {
  assert.deepEqual(violations([]), []);
  assert.deepEqual(violations([
    { path: "bank-build/build.js", size: 4000 },
    { path: "bank-build/sources.json", size: 900 },
    { path: "bank-build/sim/run.py", size: 900 },
    { path: "bank-build/cache/notes.txt", size: 10 },
    { path: "src/bank/x.json", size: 10 },
    { path: "banknotes/x.txt", size: 10 },
    { path: "report.pdf.txt", size: 10 },
    { path: "tests/fixtures/bank-mini/library/README.md", size: 10 },
  ]), []);
});

// ---------- 5. lock.js pure exports (§M4) ----------

// One tree used by the lockableFiles test and the CLI tests. Lockable: every regular file under
// tests/ (except tests/LOCK.json and .DS_Store) and scripts/ (except .DS_Store), plus e2e/v4.js,
// e2e/run.js and package.json.
const LOCK_TREE = {
  "tests/a.test.js": "// synthetic test a\n",
  "tests/b.test.js": "// synthetic test b\n",
  "tests/bin.dat": Buffer.from([0x00, 0xff, 0x0d, 0x0a, 0x80, 0x7f]),
  "tests/fixtures/README.md": "synthetic fixture readme\n",
  "tests/fixtures/bank-mini/bank.json": '{"version":1,"items":[]}\n',
  "tests/fixtures/bank-mini/decks/cpp.json": '{"deck":"cpp","items":[]}\n',
  "tests/fixtures/sub/LOCK.json": "{}\n",
  "tests/.DS_Store": "finder junk",
  "tests/fixtures/.DS_Store": "finder junk",
  "scripts/lock.js": "// synthetic lock script\n",
  "scripts/lib/util.js": "// synthetic helper\n",
  "scripts/.DS_Store": "finder junk",
  "e2e/v4.js": "// synthetic v4 e2e\n",
  "e2e/run.js": "// synthetic e2e runner\n",
  "e2e/blank.html": "<!doctype html>\n",
  "e2e/out/shot.png": "not really a png",
  "package.json": '{"name":"synthetic"}\n',
  "package-lock.json": "{}\n",
  "manifest.json": "{}\n",
  "prep/srs.js": "// synthetic prep module\n",
  "README.md": "synthetic readme\n",
};
const LOCKABLE = [
  "e2e/run.js",
  "e2e/v4.js",
  "package.json",
  "scripts/lib/util.js",
  "scripts/lock.js",
  "tests/a.test.js",
  "tests/b.test.js",
  "tests/bin.dat",
  "tests/fixtures/README.md",
  "tests/fixtures/bank-mini/bank.json",
  "tests/fixtures/bank-mini/decks/cpp.json",
  "tests/fixtures/sub/LOCK.json",
];

test("§M4 lockableFiles: tests/** (minus tests/LOCK.json, .DS_Store), scripts/**, e2e/v4.js, e2e/run.js, package.json, sorted by <", () => {
  const root = tmpDir();
  writeTree(root, { ...LOCK_TREE, "tests/LOCK.json": "{}\n" });
  assert.deepEqual(lockJs().lockableFiles(root), LOCKABLE);
});

test("§M4 lockableFiles: only lockable files that exist are listed", () => {
  const root = tmpDir();
  writeTree(root, {
    "tests/x.test.js": "x", "tests/LOCK.json": "{}", "package.json": "{}", "prep/a.js": "a", "e2e/blank.html": "b",
  });
  assert.deepEqual(lockJs().lockableFiles(root), ["package.json", "tests/x.test.js"]);
});

test("§M4 hashFile: sha256 of the raw bytes as 64 lowercase hex characters", () => {
  const dir = tmpDir();
  const bin = Buffer.from([0x00, 0xff, 0x0d, 0x0a, 0xc3, 0x28, 0x80]);
  writeTree(dir, { "abc.txt": "abc", "empty.txt": "", "bin.dat": bin });
  const { hashFile } = lockJs();
  assert.equal(hashFile(path.join(dir, "abc.txt")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(hashFile(path.join(dir, "empty.txt")), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  const h = hashFile(path.join(dir, "bin.dat"));
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(h, sha(bin));
});

test("§M4 compareLock: missing, changed and extra, each sorted by <", () => {
  const h = (c) => c.repeat(64);
  const lock = {
    version: 1, algorithm: "sha256", created: "2026-11-05T10:00:00.000Z",
    files: {
      "tests/z.test.js": { sha256: h("1") },
      "tests/b.test.js": { sha256: h("2"), disputes: ["D3"] },
      "e2e/v4.js": { sha256: h("3") },
      "tests/M.test.js": { sha256: h("4") },
      "package.json": { sha256: h("5") },
      "tests/d.test.js": { sha256: h("6"), disputes: ["D1", "D2"] },
    },
  };
  const current = {
    "tests/b.test.js": h("f"),
    "scripts/new.js": h("7"),
    "package.json": h("5"),
    "tests/Q.test.js": h("8"),
    "e2e/v4.js": h("e"),
    "tests/d.test.js": h("6"),
    "e2e/run.js": h("9"),
  };
  const r = lockJs().compareLock(lock, current);
  assert.deepEqual({ missing: r.missing, changed: r.changed, extra: r.extra }, {
    missing: ["tests/M.test.js", "tests/z.test.js"],
    changed: ["e2e/v4.js", "tests/b.test.js"],
    extra: ["e2e/run.js", "scripts/new.js", "tests/Q.test.js"],
  });
});

test("§M4 compareLock: identical maps and empty maps give three empty arrays", () => {
  const { compareLock } = lockJs();
  const pick = (r) => ({ missing: r.missing, changed: r.changed, extra: r.extra });
  const empty = { missing: [], changed: [], extra: [] };
  const lock = { version: 1, algorithm: "sha256", created: "2026-11-05T10:00:00.000Z",
    files: { "tests/a.test.js": { sha256: "a".repeat(64) }, "package.json": { sha256: "b".repeat(64), disputes: ["D9"] } } };
  assert.deepEqual(pick(compareLock(lock, { "package.json": "b".repeat(64), "tests/a.test.js": "a".repeat(64) })), empty);
  assert.deepEqual(pick(compareLock({ version: 1, files: {} }, {})), empty);
  assert.deepEqual(pick(compareLock({ version: 1, files: {} }, { "tests/y.js": "c".repeat(64), "tests/x.js": "d".repeat(64) })),
    { missing: [], changed: [], extra: ["tests/x.js", "tests/y.js"] });
});

const pickDisputes = (list) => list.map((d) => ({ id: d.id, ruling: d.ruling, files: d.files }));

test("§M4 parseDisputes: entries in document order; ruling trimmed and lowercased; File split on commas", () => {
  const md = [
    "# Test disputes",
    "",
    "Synthetic log for the tooling tests.",
    "",
    "## D3: synthetic interval complaint",
    "- Test: synthetic test three",
    "- File: tests/v4-srs.test.js",
    "- Spec: §3 F1.3",
    "- Why: synthetic reason",
    "- Proposed fix: synthetic fix",
    "- Ruling:   Amend   ",
    "- Judge note: synthetic note",
    "",
    "## D1: synthetic missing ruling",
    "- Test: synthetic test one",
    "- File: tests/v4-oa.test.js, e2e/v4.js ,, tests/fixtures/bank-mini/bank.json,",
    "- Spec: §5",
    "- Why: synthetic reason",
    "",
    "## D12: synthetic no file line",
    "- Test: synthetic test twelve",
    "- Ruling: UPHOLD",
    "",
    "## D4: synthetic hold-out dispute",
    "- Test: synthetic printed name",
    "- File: holdout",
    "- Ruling: pending",
    "",
  ].join("\n");
  assert.deepEqual(pickDisputes(lockJs().parseDisputes(md)), [
    { id: "D3", ruling: "amend", files: ["tests/v4-srs.test.js"] },
    { id: "D1", ruling: "pending", files: ["tests/v4-oa.test.js", "e2e/v4.js", "tests/fixtures/bank-mini/bank.json"] },
    { id: "D12", ruling: "uphold", files: [] },
    { id: "D4", ruling: "pending", files: ["holdout"] },
  ]);
});

test("§M4 parseDisputes: keys are case-insensitive; no entries gives []", () => {
  const { parseDisputes } = lockJs();
  assert.deepEqual(parseDisputes(""), []);
  assert.deepEqual(parseDisputes("# Test disputes\n\nNothing filed yet.\n"), []);
  const md = [
    "## D7: synthetic lower-case keys",
    "- test: synthetic",
    "- file: tests/a.test.js,tests/b.test.js",
    "- ruling: AMEND",
    "",
    "## D8: synthetic upper-case keys",
    "- FILE: scripts/lock.js",
    "- RULING: Uphold",
  ].join("\n");
  assert.deepEqual(pickDisputes(parseDisputes(md)), [
    { id: "D7", ruling: "amend", files: ["tests/a.test.js", "tests/b.test.js"] },
    { id: "D8", ruling: "uphold", files: ["scripts/lock.js"] },
  ]);
});

// ---------- 6. lock.js CLI in a temp dir via AM_LOCK_ROOT (§M4) ----------

// Outside any git work tree: GIT_CEILING_DIRECTORIES stops git from finding a repo above root.
const lockOpts = (root) => ({ cwd: root, env: { AM_LOCK_ROOT: root, GIT_CEILING_DIRECTORIES: path.dirname(root) } });
const lockCli = (root, ...args) => runScript("lock.js", args, lockOpts(root));
const lockPath = (root) => path.join(root, "tests", "LOCK.json");

function freshTree(extra = {}) {
  const root = tmpDir();
  writeTree(root, { ...LOCK_TREE, ...extra });
  return root;
}
function lockedTree(extra = {}) {
  const root = freshTree(extra);
  const r = lockCli(root, "write");
  assert.equal(r.status, 0, `setup lock:write failed:\n${r.out}`);
  return { root, before: readJson(lockPath(root)), beforeBytes: fs.readFileSync(lockPath(root)) };
}
// Output other than the parts whose format the contract fixes (a notice may share their line).
const noticeText = (out) => out
  .replace(/^.*amended:.*$/gim, "")
  .replace(/(lock:verify:\s*)?\d+ files OK/gi, "")
  .replace(/lock:verify:\s*$/gim, "");
const filesOkRe = (n) => new RegExp(`\\b${n} files OK\\b`, "i");

test("§M4 lock:write outside git: prints a notice, skips the git checks and writes LOCK.json for every lockable file", () => {
  const root = freshTree();
  const r = lockCli(root, "write");
  assert.equal(r.status, 0, r.out);
  assert.ok(r.out.trim().length > 0, "a notice is printed when there is no git work tree");
  const lock = readJson(lockPath(root));
  assert.equal(lock.version, 1);
  assert.equal(lock.algorithm, "sha256");
  assert.equal(typeof lock.created, "string");
  assert.match(lock.created, /^\d{4}-\d{2}-\d{2}/);
  assert.ok(!Number.isNaN(Date.parse(lock.created)), "created is ISO 8601");
  assert.deepEqual(Object.keys(lock.files), LOCKABLE, "keys are the lockable files, sorted");
  for (const rel of LOCKABLE) {
    const e = lock.files[rel];
    assert.equal(e.sha256, sha(fs.readFileSync(path.join(root, rel))), rel);
    assert.ok(!("disputes" in e), `${rel} has no disputes yet`);
  }
});

test("§M4 lock:write refuses (exit 1) when tests/LOCK.json already exists, and changes nothing", () => {
  const { root } = lockedTree();
  const snap = snapshot(root);
  fs.writeFileSync(path.join(root, "tests", "a.test.js"), "// edited after the lock\n");
  const snap2 = snapshot(root);
  assert.notDeepEqual(snap2, snap);
  const r = lockCli(root, "write");
  assert.equal(r.status, 1, r.out);
  assert.deepEqual(snapshot(root), snap2);
});

test("§M4 lock:verify with no tests/LOCK.json skips (pre-lock) and exits 0", () => {
  const root = freshTree();
  const r = lockCli(root, "verify");
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /pre-lock/i);
  assert.ok(!fs.existsSync(lockPath(root)), "verify never writes LOCK.json");
});

test("§M4 lock:verify outside git: hashes match → notice, '<N> files OK', exit 0; ignores .DS_Store and non-lockable files", () => {
  const { root, beforeBytes } = lockedTree();
  const r = lockCli(root, "verify");
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, filesOkRe(LOCKABLE.length));
  assert.ok(noticeText(r.out).trim().length > 0, "a notice is printed when there is no git work tree");
  assert.doesNotMatch(r.out, /amended:/i, "no amended lines before any dispute");
  writeTree(root, {
    "tests/fixtures/bank-mini/.DS_Store": "finder junk",
    "e2e/other.html": "<p>not lockable</p>",
    "prep/new.js": "// not lockable",
    "e2e/out/new.png": "x",
  });
  const r2 = lockCli(root, "verify");
  assert.equal(r2.status, 0, r2.out);
  assert.match(r2.out, filesOkRe(LOCKABLE.length));
  assert.deepEqual(fs.readFileSync(lockPath(root)), beforeBytes, "verify never rewrites LOCK.json");
});

test("§M4 lock:verify exits 1 and lists changed, missing and extra lockable files", () => {
  const cases = [
    { what: "changed", mutate: (root) => fs.writeFileSync(path.join(root, "tests", "a.test.js"), "// tampered\n"), lists: ["tests/a.test.js"] },
    { what: "changed binary", mutate: (root) => fs.writeFileSync(path.join(root, "tests", "bin.dat"), Buffer.from([0x00, 0xff, 0x0a, 0x0d])), lists: ["tests/bin.dat"] },
    { what: "missing", mutate: (root) => fs.rmSync(path.join(root, "tests", "fixtures", "README.md")), lists: ["tests/fixtures/README.md"] },
    { what: "changed package.json", mutate: (root) => fs.writeFileSync(path.join(root, "package.json"), '{"name":"tampered"}\n'), lists: ["package.json"] },
    { what: "missing e2e/v4.js", mutate: (root) => fs.rmSync(path.join(root, "e2e", "v4.js")), lists: ["e2e/v4.js"] },
    {
      what: "extra under tests/ and scripts/",
      mutate: (root) => writeTree(root, { "tests/fixtures/new.json": "{}", "scripts/new-helper.js": "//" }),
      lists: ["tests/fixtures/new.json", "scripts/new-helper.js"],
    },
  ];
  for (const c of cases) {
    const { root, beforeBytes } = lockedTree();
    c.mutate(root);
    const r = lockCli(root, "verify");
    assert.equal(r.status, 1, `${c.what}: ${r.out}`);
    for (const p of c.lists) assert.ok(r.out.includes(p), `${c.what}: output lists ${p}\n${r.out}`);
    assert.deepEqual(fs.readFileSync(lockPath(root)), beforeBytes, `${c.what}: LOCK.json untouched`);
  }
});

test("§M4 lock:restore outside a git work tree exits 1 and changes nothing", () => {
  // A clean locked tree: verify alone would pass, so exit 1 must come from the git refusal.
  const clean = lockedTree().root;
  const cleanSnap = snapshot(clean);
  const r1 = lockCli(clean, "restore");
  assert.equal(r1.status, 1, r1.out);
  assert.deepEqual(snapshot(clean), cleanSnap);

  const { root } = lockedTree();
  writeTree(root, { "tests/untracked.test.js": "// extra", "tests/a.test.js": "// modified\n" });
  const snap = snapshot(root);
  const r = lockCli(root, "restore");
  assert.equal(r.status, 1, r.out);
  assert.deepEqual(snapshot(root), snap);
});

// ----- dispute path: lock:write -- --dispute <id[,id]> -----

function disputeEntry(id, { files, ruling } = {}) {
  const lines = [`## ${id}: synthetic dispute ${id}`, "- Test: synthetic test name"];
  if (files) lines.push(`- File: ${files.join(", ")}`);
  lines.push("- Spec: §M4", "- Why: synthetic reason", "- Proposed fix: synthetic fix");
  if (ruling) lines.push(`- Ruling: ${ruling}`);
  lines.push("- Judge note: synthetic note", "");
  return lines.join("\n");
}
function writeDisputes(root, entries) {
  fs.writeFileSync(path.join(root, "TEST-DISPUTES.md"),
    "# Test disputes\n\n" + entries.map(([id, o]) => disputeEntry(id, o)).join("\n"));
}
function stage(root, id, rel, content) {
  writeTree(root, { [`.test-staging/${id}/${rel}`]: content });
}

const NEW_A = Buffer.from("// amended test a\r\nconst x = 'é';\n", "utf8");

test("§M4 lock:write --dispute: copies the staged file, rehashes it, records the id and deletes the staging dir", () => {
  const { root, before } = lockedTree();
  writeDisputes(root, [
    ["D2", { files: ["tests/b.test.js"], ruling: "uphold" }],
    ["D3", { files: ["tests/a.test.js", "tests/fixtures/bank-mini/bank.json"], ruling: "amend" }],
    ["D30", { files: ["tests/b.test.js"], ruling: "pending" }],
  ]);
  stage(root, "D3", "tests/a.test.js", NEW_A);
  const r = lockCli(root, "write", "--dispute", "D3");
  assert.equal(r.status, 0, r.out);

  assert.deepEqual(fs.readFileSync(path.join(root, "tests", "a.test.js")), NEW_A, "staged bytes copied into place");
  assert.equal(fs.readFileSync(path.join(root, "tests", "fixtures", "bank-mini", "bank.json"), "utf8"),
    LOCK_TREE["tests/fixtures/bank-mini/bank.json"], "a listed but unstaged file is untouched");
  assert.ok(!fs.existsSync(path.join(root, ".test-staging", "D3")), ".test-staging/D3/ deleted");

  const after = readJson(lockPath(root));
  assert.equal(after.version, 1);
  assert.equal(after.algorithm, "sha256");
  assert.deepEqual(Object.keys(after.files), LOCKABLE, "same keys, still sorted");
  assert.equal(after.files["tests/a.test.js"].sha256, sha(NEW_A));
  assert.deepEqual(after.files["tests/a.test.js"].disputes, ["D3"]);
  for (const rel of LOCKABLE.filter((p) => p !== "tests/a.test.js")) {
    assert.deepEqual(after.files[rel], before.files[rel], `${rel} entry unchanged`);
  }

  const v = lockCli(root, "verify");
  assert.equal(v.status, 0, v.out);
  assert.match(v.out, /^.*amended: tests\/a\.test\.js \(D3\)\s*$/m);
  assert.doesNotMatch(v.out, /amended: (?!tests\/a\.test\.js)/, "only the amended file gets an amended line");
  assert.match(v.out, filesOkRe(LOCKABLE.length));
});

test("§M4 lock:write --dispute: a second amend appends its id to the file's disputes", () => {
  const { root } = lockedTree();
  writeDisputes(root, [["D3", { files: ["tests/a.test.js"], ruling: "amend" }]]);
  stage(root, "D3", "tests/a.test.js", NEW_A);
  assert.equal(lockCli(root, "write", "--dispute", "D3").status, 0);

  const NEW_A2 = "// amended again\n";
  writeDisputes(root, [
    ["D3", { files: ["tests/a.test.js"], ruling: "amend" }],
    ["D5", { files: ["tests/a.test.js"], ruling: "amend" }],
  ]);
  stage(root, "D5", "tests/a.test.js", NEW_A2);
  const r = lockCli(root, "write", "--dispute", "D5");
  assert.equal(r.status, 0, r.out);
  assert.equal(fs.readFileSync(path.join(root, "tests", "a.test.js"), "utf8"), NEW_A2);
  const e = readJson(lockPath(root)).files["tests/a.test.js"];
  assert.equal(e.sha256, sha(Buffer.from(NEW_A2)));
  assert.deepEqual(e.disputes, ["D3", "D5"]);

  const v = lockCli(root, "verify");
  assert.equal(v.status, 0, v.out);
  const m = /amended: tests\/a\.test\.js \(([^)]*)\)/.exec(v.out);
  assert.ok(m, v.out);
  assert.match(m[1], /D3.*D5/);
});

test("§M4 lock:write --dispute D6,D7: several ids in one run, each file tagged with its own id", () => {
  const { root, before } = lockedTree();
  writeDisputes(root, [
    ["D6", { files: ["tests/fixtures/bank-mini/bank.json"], ruling: "amend" }],
    ["D7", { files: ["e2e/v4.js", "scripts/lib/util.js"], ruling: "amend" }],
  ]);
  const newBank = '{"version":1,"items":[{"id":"synthetic"}]}\n';
  stage(root, "D6", "tests/fixtures/bank-mini/bank.json", newBank);
  stage(root, "D7", "e2e/v4.js", "// amended v4\n");
  stage(root, "D7", "scripts/lib/util.js", "// amended helper\n");
  const r = lockCli(root, "write", "--dispute", "D6,D7");
  assert.equal(r.status, 0, r.out);
  const after = readJson(lockPath(root));
  assert.deepEqual(after.files["tests/fixtures/bank-mini/bank.json"],
    { ...before.files["tests/fixtures/bank-mini/bank.json"], sha256: sha(Buffer.from(newBank)), disputes: ["D6"] });
  assert.equal(after.files["e2e/v4.js"].sha256, sha(Buffer.from("// amended v4\n")));
  assert.deepEqual(after.files["e2e/v4.js"].disputes, ["D7"]);
  assert.equal(after.files["scripts/lib/util.js"].sha256, sha(Buffer.from("// amended helper\n")));
  assert.deepEqual(after.files["scripts/lib/util.js"].disputes, ["D7"]);
  assert.deepEqual(after.files["tests/a.test.js"], before.files["tests/a.test.js"]);
  assert.ok(!fs.existsSync(path.join(root, ".test-staging", "D6")));
  assert.ok(!fs.existsSync(path.join(root, ".test-staging", "D7")));
  const v = lockCli(root, "verify");
  assert.equal(v.status, 0, v.out);
  for (const [rel, id] of [["e2e/v4.js", "D7"], ["scripts/lib/util.js", "D7"], ["tests/fixtures/bank-mini/bank.json", "D6"]]) {
    const re = new RegExp(`^.*amended: ${rel.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")} \\(${id}\\)\\s*$`, "m");
    assert.match(v.out, re, `an amended line for ${rel}`);
  }
  assert.equal((v.out.match(/amended:/g) || []).length, 3, "one amended line per amended file");
});

test("§M4 lock:write --dispute rehashes only the staged files, so an out-of-band edit still fails verify", () => {
  const { root, before } = lockedTree();
  fs.writeFileSync(path.join(root, "tests", "b.test.js"), "// edited outside the dispute path\n");
  writeDisputes(root, [["D3", { files: ["tests/a.test.js"], ruling: "amend" }]]);
  stage(root, "D3", "tests/a.test.js", NEW_A);
  const snap = snapshot(root);
  const r = lockCli(root, "write", "--dispute", "D3");
  // The contract's checks all pass, so exit 0 is expected; an implementation that also refuses
  // while another lockable file has drifted is tolerated, provided it then changes nothing.
  assert.ok(r.status === 0 || r.status === 1, r.out);
  if (r.status === 1) assert.deepEqual(snapshot(root), snap, "a refusal changes nothing");
  assert.deepEqual(readJson(lockPath(root)).files["tests/b.test.js"], before.files["tests/b.test.js"],
    "the out-of-band edit is never laundered into LOCK.json");
  const v = lockCli(root, "verify");
  assert.equal(v.status, 1, v.out);
  assert.ok(v.out.includes("tests/b.test.js"), v.out);
});

test("§M4 lock:write --dispute refusals: any failed check exits 1 and changes nothing", () => {
  const amendA = ["D3", { files: ["tests/a.test.js"], ruling: "amend" }];
  const cases = [
    { why: "no tests/LOCK.json yet", locked: false, disputes: [amendA], staged: [["D3", "tests/a.test.js"]], ids: "D3" },
    { why: "no TEST-DISPUTES.md", disputes: null, staged: [["D3", "tests/a.test.js"]], ids: "D3" },
    {
      why: "id not in TEST-DISPUTES.md (D30 is not D3)",
      disputes: [["D30", { files: ["tests/a.test.js"], ruling: "amend" }], ["D4", { files: ["tests/a.test.js"], ruling: "amend" }]],
      staged: [["D3", "tests/a.test.js"]], ids: "D3",
    },
    { why: "ruling uphold", disputes: [["D3", { files: ["tests/a.test.js"], ruling: "uphold" }]], staged: [["D3", "tests/a.test.js"]], ids: "D3" },
    { why: "ruling pending", disputes: [["D3", { files: ["tests/a.test.js"], ruling: "pending" }]], staged: [["D3", "tests/a.test.js"]], ids: "D3" },
    { why: "no Ruling line", disputes: [["D3", { files: ["tests/a.test.js"] }]], staged: [["D3", "tests/a.test.js"]], ids: "D3" },
    { why: "no staging dir", disputes: [amendA], staged: [], ids: "D3" },
    { why: "staging dir with no files", disputes: [amendA], staged: [], emptyStagingDir: "D3", ids: "D3" },
    {
      why: "a staged file not in the File: list",
      disputes: [amendA], staged: [["D3", "tests/a.test.js"], ["D3", "tests/b.test.js"]], ids: "D3",
    },
    {
      why: "a staged file that is not lockable",
      disputes: [["D3", { files: ["prep/srs.js"], ruling: "amend" }]], staged: [["D3", "prep/srs.js"]], ids: "D3",
    },
    {
      why: "a staged lockable file that is not yet in LOCK.json (a dispute cannot add a file)",
      disputes: [["D3", { files: ["tests/new.test.js"], ruling: "amend" }]], staged: [["D3", "tests/new.test.js"]], ids: "D3",
    },
    {
      why: "staged tests/LOCK.json (not lockable)",
      disputes: [["D3", { files: ["tests/LOCK.json"], ruling: "amend" }]], staged: [["D3", "tests/LOCK.json"]], ids: "D3",
    },
    {
      why: "second id ruled uphold",
      disputes: [amendA, ["D4", { files: ["tests/b.test.js"], ruling: "uphold" }]],
      staged: [["D3", "tests/a.test.js"], ["D4", "tests/b.test.js"]], ids: "D3,D4",
    },
    {
      why: "second id has no staged file",
      disputes: [amendA, ["D4", { files: ["tests/b.test.js"], ruling: "amend" }]],
      staged: [["D3", "tests/a.test.js"]], ids: "D3,D4",
    },
  ];
  for (const c of cases) {
    const root = c.locked === false ? freshTree() : lockedTree().root;
    if (c.disputes) writeDisputes(root, c.disputes);
    for (const [id, rel] of c.staged) stage(root, id, rel, `// staged by ${id}\n`);
    if (c.emptyStagingDir) fs.mkdirSync(path.join(root, ".test-staging", c.emptyStagingDir, "tests"), { recursive: true });
    const snap = snapshot(root);
    const r = lockCli(root, "write", "--dispute", c.ids);
    assert.equal(r.status, 1, `${c.why}: expected exit 1\n${r.out}`);
    assert.deepEqual(snapshot(root), snap, `${c.why}: nothing changes`);
    if (c.emptyStagingDir) assert.ok(fs.existsSync(path.join(root, ".test-staging", c.emptyStagingDir)), c.why);
  }
});

// ----- inside a git work tree: a throwaway repo in a temp dir (§M4 git checks) -----
//
// Each repo is created with `git init` inside its own temp dir. GIT_CEILING_DIRECTORIES stops git
// at that dir, and an empty GIT_CONFIG_GLOBAL plus GIT_CONFIG_NOSYSTEM keep the user's git config
// (signing, hooks) out of it. The CLI gets the same env, so its git commands see only this repo.

let EMPTY_GITCONFIG = null;
function gitEnv(root) {
  if (!EMPTY_GITCONFIG) {
    EMPTY_GITCONFIG = path.join(tmpDir("am-gitcfg-"), "empty.gitconfig");
    fs.writeFileSync(EMPTY_GITCONFIG, "");
  }
  return {
    AM_LOCK_ROOT: root, GIT_CEILING_DIRECTORIES: path.dirname(root),
    GIT_CONFIG_GLOBAL: EMPTY_GITCONFIG, GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "Tooling Test", GIT_AUTHOR_EMAIL: "tooling@example.invalid",
    GIT_COMMITTER_NAME: "Tooling Test", GIT_COMMITTER_EMAIL: "tooling@example.invalid",
  };
}
function git(root, ...args) {
  const r = spawnSync("git", args, { cwd: root, env: childEnv(gitEnv(root)), encoding: "utf8", timeout: 60000 });
  assert.equal(r.status, 0, `setup: git ${args.join(" ")} failed:\n${r.stderr}`);
  return r.stdout;
}
const gitLockCli = (root, ...args) => runScript("lock.js", args, { cwd: root, env: gitEnv(root) });
// Like snapshot(), without .git/ (git may refresh its index while only reading).
const treeSnap = (root) => Object.fromEntries(Object.entries(snapshot(root)).filter(([k]) => !k.startsWith(".git/")));
const GIT_TREE = { ".gitignore": ".DS_Store\n.test-staging/\ne2e/out/\n*.log\n" };

// A repo holding LOCK_TREE, committed as the red tests and tagged v4-red-pre.
function preLockRepo({ tag = true } = {}) {
  const root = freshTree(GIT_TREE);
  git(root, "init", "-q");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "v4: red tests (pre-lock)");
  if (tag) git(root, "tag", "v4-red-pre");
  return root;
}
// preLockRepo, then lock:write, commit `v4: red tests` (or `subject`) and tag v4-red.
function lockedRepo({ subject = "v4: red tests" } = {}) {
  const root = preLockRepo();
  const r = gitLockCli(root, "write");
  assert.equal(r.status, 0, `setup lock:write in git failed:\n${r.out}`);
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", subject);
  git(root, "tag", "v4-red");
  return root;
}
// Rewrites one LOCK entry's hash by hand (what a forged or hand-made amend would do).
function setLockHash(root, rel) {
  const lock = readJson(lockPath(root));
  lock.files[rel] = { ...lock.files[rel], sha256: sha(fs.readFileSync(path.join(root, rel))) };
  fs.writeFileSync(lockPath(root), JSON.stringify(lock, null, 2) + "\n");
}

test("§M4 lock:write inside git refuses unless tag v4-red-pre exists and tests/ and e2e/v4.js have no diff against it and no untracked files", () => {
  const cases = [
    { why: "no tag v4-red-pre", tag: false, mutate: () => {} },
    { why: "uncommitted edit under tests/", mutate: (root) => fs.writeFileSync(path.join(root, "tests", "a.test.js"), "// edited\n") },
    { why: "uncommitted deletion under tests/", mutate: (root) => fs.rmSync(path.join(root, "tests", "b.test.js")) },
    {
      why: "edit committed after the tag",
      mutate: (root) => {
        fs.writeFileSync(path.join(root, "tests", "fixtures", "README.md"), "changed and committed\n");
        git(root, "commit", "-q", "-am", "sneaky change");
      },
    },
    { why: "uncommitted edit to e2e/v4.js", mutate: (root) => fs.writeFileSync(path.join(root, "e2e", "v4.js"), "// edited v4\n") },
    { why: "untracked file under tests/", mutate: (root) => writeTree(root, { "tests/fixtures/bank-mini/new.json": "{}\n" }) },
  ];
  for (const c of cases) {
    const root = preLockRepo({ tag: c.tag !== false });
    c.mutate(root);
    const snap = treeSnap(root);
    const r = gitLockCli(root, "write");
    assert.equal(r.status, 1, `${c.why}: expected exit 1\n${r.out}`);
    assert.ok(!fs.existsSync(lockPath(root)), `${c.why}: no LOCK.json written`);
    assert.deepEqual(treeSnap(root), snap, `${c.why}: nothing changes`);
  }
});

test("§M4 lock:write inside git: with the tag and clean tests/, e2e/v4.js it writes LOCK.json; changes elsewhere (M0's scripts/, package.json) do not block it", () => {
  const root = preLockRepo();
  // M0's own work after the tag: committed and uncommitted, tracked and untracked, outside tests/ and e2e/v4.js.
  fs.writeFileSync(path.join(root, "package.json"), '{"name":"synthetic","version":"4.0.0"}\n');
  git(root, "commit", "-q", "-am", "M0: tooling");
  writeTree(root, {
    "scripts/lock.js": "// M0 lock script, uncommitted\n",
    "scripts/check.js": "// M0 check script, untracked\n",
    "prep/new.js": "// untracked, not lockable\n",
    "tests/fixtures/bank-mini/.DS_Store": "ignored finder junk",
  });
  const r = gitLockCli(root, "write");
  assert.equal(r.status, 0, r.out);
  const lock = readJson(lockPath(root));
  const want = [...LOCKABLE, "scripts/check.js"].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  assert.deepEqual(Object.keys(lock.files), want);
  for (const rel of want) assert.equal(lock.files[rel].sha256, sha(fs.readFileSync(path.join(root, rel))), rel);
});

test("§M4 lock:verify inside git: OK after the v4-red commit and tag; fails on a missing or wrong tag, a staged change, or commits that are not dispute amends", () => {
  // Clean: hashes match, tag v4-red is the `v4: red tests` commit, nothing since.
  const good = lockedRepo();
  const ok = gitLockCli(good, "verify");
  assert.equal(ok.status, 0, ok.out);
  assert.match(ok.out, filesOkRe(LOCKABLE.length));

  const failures = [];
  const expectFail = (why, root) => {
    const snap = treeSnap(root);
    const r = gitLockCli(root, "verify");
    if (r.status !== 1) failures.push(`${why}: want exit 1, got ${r.status}\n${r.out}`);
    try { assert.deepEqual(treeSnap(root), snap); } catch { failures.push(`${why}: verify changed files`); }
  };

  // (a) the tag must exist and point at a commit with the subject `v4: red tests`.
  const noTag = lockedRepo();
  git(noTag, "tag", "-d", "v4-red");
  expectFail("(a) no tag v4-red", noTag);
  expectFail("(a) tag on a commit with another subject", lockedRepo({ subject: "v4: red tests, take two" }));

  // (b) a staged change whose working-tree bytes still match LOCK.json: only git status sees it.
  const staged = lockedRepo();
  const aPath = path.join(staged, "tests", "a.test.js");
  const aBytes = fs.readFileSync(aPath);
  fs.writeFileSync(aPath, "// staged then reverted in the working tree\n");
  git(staged, "add", "tests/a.test.js");
  fs.writeFileSync(aPath, aBytes);
  expectFail("(b) staged change to a lockable file", staged);

  // (c) a commit since v4-red that touches a lockable file without an amend subject, even though
  // LOCK.json was updated to match (so the hash comparison alone passes).
  const forged = lockedRepo();
  fs.writeFileSync(path.join(forged, "tests", "b.test.js"), "// rewritten\n");
  setLockHash(forged, "tests/b.test.js");
  git(forged, "commit", "-q", "-am", "tidy tests");
  expectFail("(c) non-amend commit", forged);

  // (c) also lists a non-amend commit that a later commit reverted: hashes and (d) both pass.
  const reverted = lockedRepo();
  const bPath = path.join(reverted, "tests", "b.test.js");
  const bBytes = fs.readFileSync(bPath);
  fs.writeFileSync(bPath, "// temporary rewrite\n");
  git(reverted, "commit", "-q", "-am", "temporary test tweak");
  fs.writeFileSync(bPath, bBytes);
  git(reverted, "commit", "-q", "-am", "undo the tweak");
  expectFail("(c) non-amend commits since v4-red, even when reverted", reverted);

  // (c) an amend subject whose dispute is not ruled amend.
  const upheld = lockedRepo();
  writeDisputes(upheld, [["D4", { files: ["tests/b.test.js"], ruling: "uphold" }]]);
  fs.writeFileSync(path.join(upheld, "tests", "b.test.js"), "// rewritten\n");
  setLockHash(upheld, "tests/b.test.js");
  git(upheld, "add", "tests/b.test.js", "tests/LOCK.json");
  git(upheld, "commit", "-q", "-m", "v4: amend test (dispute D4)");
  expectFail("(c) amend commit for a dispute ruled uphold", upheld);

  // (c) an amend commit that touches a lockable file outside its dispute's File: list.
  const outside = lockedRepo();
  writeDisputes(outside, [["D3", { files: ["tests/a.test.js"], ruling: "amend" }]]);
  fs.writeFileSync(path.join(outside, "tests", "a.test.js"), "// amended a\n");
  fs.writeFileSync(path.join(outside, "tests", "b.test.js"), "// not in the File: list\n");
  setLockHash(outside, "tests/a.test.js");
  setLockHash(outside, "tests/b.test.js");
  git(outside, "add", "tests/a.test.js", "tests/b.test.js", "tests/LOCK.json");
  git(outside, "commit", "-q", "-m", "v4: amend test (dispute D3)");
  expectFail("(c) amend commit touching a file outside its dispute", outside);

  // (d) LOCK.json must keep the key set of v4-red:tests/LOCK.json, even through an amend commit.
  const dropped = lockedRepo();
  writeDisputes(dropped, [["D3", { files: ["tests/b.test.js"], ruling: "amend" }]]);
  fs.rmSync(path.join(dropped, "tests", "b.test.js"));
  const lock = readJson(lockPath(dropped));
  delete lock.files["tests/b.test.js"];
  fs.writeFileSync(lockPath(dropped), JSON.stringify(lock, null, 2) + "\n");
  git(dropped, "add", "-A", "tests");
  git(dropped, "commit", "-q", "-m", "v4: amend test (dispute D3)");
  expectFail("(d) LOCK.json key set differs from v4-red", dropped);

  assert.deepEqual(failures, []);
});

test("§M4 lock:verify inside git: the judge path (lock:write --dispute, then the amend commit) verifies and prints the amended line", () => {
  const root = lockedRepo();
  writeDisputes(root, [
    ["D3", { files: ["tests/a.test.js", "tests/fixtures/bank-mini/bank.json"], ruling: "amend" }],
    ["D4", { files: ["tests/b.test.js"], ruling: "uphold" }],
  ]);
  git(root, "add", "TEST-DISPUTES.md");
  git(root, "commit", "-q", "-m", "log disputes D3, D4");
  stage(root, "D3", "tests/a.test.js", NEW_A);
  const w = gitLockCli(root, "write", "--dispute", "D3");
  assert.equal(w.status, 0, w.out);
  git(root, "add", "tests/a.test.js", "tests/LOCK.json");
  git(root, "commit", "-q", "-m", "v4: amend test (dispute D3)");
  const v = gitLockCli(root, "verify");
  assert.equal(v.status, 0, v.out);
  assert.match(v.out, /^.*amended: tests\/a\.test\.js \(D3\)\s*$/m);
  assert.match(v.out, filesOkRe(LOCKABLE.length));
});

test("§M4 lock:restore inside git: restores tracked lockable files from HEAD, deletes untracked and ignored files under tests/ and scripts/ (not .DS_Store), then verifies", () => {
  const root = lockedRepo();
  const clean = treeSnap(root);
  fs.writeFileSync(path.join(root, "tests", "a.test.js"), "// tampered\n");
  fs.rmSync(path.join(root, "tests", "b.test.js"));
  fs.writeFileSync(path.join(root, "e2e", "v4.js"), "// tampered v4\n");
  fs.writeFileSync(path.join(root, "package.json"), '{"name":"tampered"}\n');
  fs.writeFileSync(path.join(root, "scripts", "lock.js"), "// tampered lock\n");
  fs.writeFileSync(lockPath(root), '{"version":1,"files":{}}\n');
  writeTree(root, {
    "tests/new.test.js": "// untracked\n",
    "tests/fixtures/new/deep.json": "{}\n",
    "tests/run.log": "ignored by *.log\n",
    "scripts/new-helper.js": "// untracked\n",
    "tests/fixtures/bank-mini/.DS_Store": "finder junk",
    "prep/new.js": "// outside the lockable roots\n",
  });
  const r = gitLockCli(root, "restore");
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, filesOkRe(LOCKABLE.length), "restore ends with the lock:verify logic");
  assert.deepEqual(treeSnap(root), {
    ...clean,
    "tests/fixtures/bank-mini/.DS_Store": sha("finder junk"),
    "prep/new.js": sha("// outside the lockable roots\n"),
  });
});

// ---------- 7. test:holdout (§M5), without the real hold-out dir ----------

const holdoutTestSource = (lines) => [
  'const test = require("node:test");',
  'const assert = require("node:assert/strict");',
  'const fs = require("node:fs");',
  'const path = require("node:path");',
  ...lines,
  "",
].join("\n");

test("§M5 test:holdout exits 1 when HOLDOUT_DIR does not exist", () => {
  const home = tmpDir();
  const r = runScript("test-holdout.js", [], { env: { HOLDOUT_DIR: path.join(home, "no such holdout dir"), HOME: home } });
  assert.equal(r.status, 1, r.out);
});

test("§M5 test:holdout defaults HOLDOUT_DIR to ~/Documents/Quant Prep/holdout-tests", () => {
  const home = tmpDir();
  const r1 = runScript("test-holdout.js", [], { env: { HOME: home } });
  assert.equal(r1.status, 1, `missing default dir → exit 1\n${r1.out}`);

  const dir = path.join(home, "Documents", "Quant Prep", "holdout-tests");
  const marker = path.join(home, "default-dir-ran.txt");
  writeTree(dir, {
    "smoke.test.js": holdoutTestSource([
      `test("default dir smoke", () => { fs.writeFileSync(${JSON.stringify(marker)}, "ran"); });`,
    ]),
  });
  const r2 = runScript("test-holdout.js", [], { env: { HOME: home } });
  assert.equal(r2.status, 0, r2.out);
  assert.ok(fs.existsSync(marker), "the test under the default dir ran");
  assert.match(r2.out, /^\s*ok default dir smoke\s*$/m);
});

test("§M5 test:holdout runs every *.test.js under HOLDOUT_DIR recursively, cwd = repo root, AM_REPO = absolute repo root", () => {
  const base = tmpDir("am holdout ");
  const dir = path.join(base, "hold out dir");
  const marks = path.join(base, "marks");
  fs.mkdirSync(marks);
  const mark = (name) => `fs.writeFileSync(path.join(${JSON.stringify(marks)}, ${JSON.stringify(name)}), JSON.stringify({ repo: process.env.AM_REPO, cwd: process.cwd() }));`;
  writeTree(dir, {
    "top.test.js": holdoutTestSource([
      `test("holdout runner sees the repo", () => {`,
      `  ${mark("top.json")}`,
      `  assert.ok(fs.existsSync(path.join(process.env.AM_REPO, "scripts", "test-holdout.js")));`,
      `});`,
    ]),
    "nested/deeper/inner.test.js": holdoutTestSource([
      `test("holdout runner recurses", () => { ${mark("inner.json")} });`,
    ]),
    "nested/helper.js": `require("node:fs").writeFileSync(${JSON.stringify(path.join(marks, "helper.json"))}, "{}");\n`,
    "nested/other.spec.js": `require("node:fs").writeFileSync(${JSON.stringify(path.join(marks, "spec.json"))}, "{}");\n`,
  });
  const r = runScript("test-holdout.js", [], { cwd: base, env: { HOLDOUT_DIR: dir } });
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /^\s*ok holdout runner sees the repo\s*$/m);
  assert.match(r.out, /^\s*ok holdout runner recurses\s*$/m);
  const repoReal = fs.realpathSync(REPO);
  for (const f of ["top.json", "inner.json"]) {
    const p = path.join(marks, f);
    assert.ok(fs.existsSync(p), `${f} written`);
    const seen = readJson(p);
    assert.equal(typeof seen.repo, "string");
    assert.ok(path.isAbsolute(seen.repo), "AM_REPO is absolute");
    assert.equal(fs.realpathSync(seen.repo), repoReal, "AM_REPO is the repo root");
    assert.equal(fs.realpathSync(seen.cwd), repoReal, "cwd is the repo root");
  }
  assert.ok(!fs.existsSync(path.join(marks, "helper.json")), "non-test .js files are not run");
  assert.ok(!fs.existsSync(path.join(marks, "spec.json")), "only *.test.js files are run");
});

test("§M5 test:holdout prints only ok / not ok names and totals, hides assertion details, values and source, exit code is node's", () => {
  const dir = tmpDir("am holdout ");
  writeTree(dir, {
    "mixed.test.js": holdoutTestSource([
      "// zq-source-comment-3319",
      'test("holdout visible pass one", () => {});',
      'test("holdout visible fail two", () => { assert.equal("zq-actual-7731", "zq-expected-9917", "zq-message-5521"); });',
      'test("holdout visible fail three", () => { const zqLocal4410 = 1; throw new Error("zq-thrown-4410"); });',
      'test("holdout visible pass four", () => { assert.deepEqual({ a: 1 }, { a: 1 }); });',
    ]),
  });
  const r = runScript("test-holdout.js", [], { env: { HOLDOUT_DIR: dir } });
  assert.equal(r.status, 1, `a failing hold-out test → node's exit code 1\n${r.out}`);
  assert.match(r.out, /^\s*ok holdout visible pass one\s*$/m);
  assert.match(r.out, /^\s*not ok holdout visible fail two\s*$/m);
  assert.match(r.out, /^\s*not ok holdout visible fail three\s*$/m);
  assert.match(r.out, /^\s*ok holdout visible pass four\s*$/m);
  for (const secret of ["zq-source-comment", "zq-actual", "zq-expected", "zq-message", "zq-thrown", "zqLocal4410", "assert.equal("]) {
    assert.ok(!r.out.includes(secret), `output must not reveal ${secret}\n${r.out}`);
  }
  const other = r.out.split(/\r?\n/).filter((l) => l.trim() && !/^\s*(not )?ok /.test(l));
  assert.ok(other.some((l) => /\d/.test(l)), `a totals line is printed\n${r.out}`);

  const passing = tmpDir("am holdout ");
  writeTree(passing, { "p.test.js": holdoutTestSource(['test("holdout all pass", () => {});']) });
  const r2 = runScript("test-holdout.js", [], { env: { HOLDOUT_DIR: passing } });
  assert.equal(r2.status, 0, r2.out);
});

// ---------- 8. the hook: guardDecision (§M6) ----------

const HOME = "/Users/tester";
const ROOT = "/Users/tester/am";
const HOLDOUT = "/Users/tester/Documents/Quant Prep/holdout-tests";
const bash = (command) => ({ tool_name: "Bash", tool_input: { command } });
const tool = (tool_name, tool_input) => ({ tool_name, tool_input });
const EDIT_TOOLS = ["Edit", "Write", "MultiEdit"];
const editsOf = (p) => [...EDIT_TOOLS.map((t) => tool(t, { file_path: p })), tool("NotebookEdit", { notebook_path: p })];

// cases: [input, locked, "deny" | "allow"]; reports every mismatch at once.
function expectDecisions(cases, ctx = {}) {
  const { guardDecision } = guardJs();
  const wrong = [];
  for (const [input, locked, want] of cases) {
    const clone = structuredClone(input);
    const r = guardDecision(input, { root: ROOT, holdout: HOLDOUT, home: HOME, locked, ...ctx });
    const got = r && r.deny === true ? "deny" : r && r.deny === false ? "allow" : `bad result ${JSON.stringify(r)}`;
    if (got !== want) wrong.push(`want ${want}, got ${got}: ${JSON.stringify(input)} locked=${locked}`);
    if (got === "deny" && !(typeof r.reason === "string" && r.reason.length > 0)) wrong.push(`deny without a reason: ${JSON.stringify(input)}`);
    try { assert.deepEqual(input, clone); } catch { wrong.push(`input mutated: ${JSON.stringify(clone)}`); }
  }
  assert.deepEqual(wrong, []);
}
const both = (inputs, want) => inputs.flatMap((i) => [[i, false, want], [i, true, want]]);
const whenLocked = (inputs, want) => inputs.map((i) => [i, true, want]);
const whenUnlocked = (inputs, want) => inputs.map((i) => [i, false, want]);

test("§M6 guard H1: Read, Edit, Write, MultiEdit, NotebookEdit inside the hold-out dir are denied, locked or not", () => {
  const inside = [
    `${HOLDOUT}/v4-srs.holdout.test.js`,
    `${HOLDOUT}/sub/deep.test.js`,
    "~/Documents/Quant Prep/holdout-tests/a.test.js",
    "../Documents/Quant Prep/holdout-tests/a.test.js",
    `${ROOT}/../Documents/Quant Prep/holdout-tests/a.test.js`,
    "/users/TESTER/documents/quant prep/HOLDOUT-TESTS/a.test.js",
  ];
  expectDecisions(both(inside.flatMap((p) => [tool("Read", { file_path: p }), ...editsOf(p)]), "deny"));
});

test("§M6 guard H1: the hold-out dir comes from ctx.holdout, whatever its name", () => {
  const ctx = { holdout: "/data/ho-secret" };
  expectDecisions([
    ...both([tool("Read", { file_path: "/data/ho-secret/a.test.js" }), ...editsOf("/DATA/HO-SECRET/b.test.js"),
      tool("Grep", { pattern: "seqFit", path: "/data/ho-secret/sub" })], "deny"),
    ...both([tool("Read", { file_path: "/data/other/a.test.js" }), tool("Grep", { pattern: "seqFit", path: "/data/other" })], "allow"),
  ], ctx);
});

test("§M6 guard H1: Grep/Glob with a path inside the hold-out dir, or a pattern/glob containing holdout-tests, are denied", () => {
  expectDecisions(both([
    tool("Grep", { pattern: "seqFit", path: HOLDOUT }),
    tool("Grep", { pattern: "seqFit", path: `${HOLDOUT}/sub` }),
    tool("Grep", { pattern: "x", path: "~/Documents/Quant Prep/holdout-tests" }),
    tool("Grep", { pattern: "x", path: "/USERS/tester/Documents/QUANT PREP/holdout-tests/sub" }),
    tool("Glob", { pattern: "**/*.js", path: HOLDOUT }),
    tool("Glob", { pattern: "~/Documents/Quant Prep/holdout-tests/**/*.js" }),
    tool("Glob", { pattern: "**/Holdout-Tests/**" }),
    tool("Grep", { pattern: "holdout-tests", path: ROOT }),
    tool("Grep", { pattern: "x", glob: "**/holdout-tests/*.js" }),
  ], "deny"));
});

test("§M6 guard H1: Grep/Glob whose path is an ancestor of the hold-out dir are denied (they would search it)", () => {
  expectDecisions(both([
    tool("Grep", { pattern: "seqFit", path: "/Users/tester/Documents/Quant Prep" }),
    tool("Grep", { pattern: "seqFit", path: "/users/TESTER/documents/quant prep/" }),
    tool("Grep", { pattern: "seqFit", path: "~/Documents" }),
    tool("Grep", { pattern: "seqFit", path: ".." }),
    tool("Grep", { pattern: "seqFit", path: "/" }),
    tool("Glob", { pattern: "**/*.test.js", path: "~" }),
    tool("Glob", { pattern: "**/*.test.js", path: "/Users/tester" }),
  ], "deny"));
  expectDecisions(both([tool("Grep", { pattern: "seqFit", path: "/data" })], "deny"), { holdout: "/data/ho-secret" });
});

test("§M6 guard H1: reading, grepping and globbing tests/** and other repo files is allowed, locked or not", () => {
  expectDecisions(both([
    tool("Read", { file_path: `${ROOT}/tests/v4-srs.test.js` }),
    tool("Read", { file_path: "tests/LOCK.json" }),
    tool("Read", { file_path: `${ROOT}/scripts/guard-locked.js` }),
    tool("Read", { file_path: "/Users/tester/Documents/Quant Prep/notes.md" }),
    tool("Grep", { pattern: "seqFit", path: `${ROOT}/tests` }),
    tool("Grep", { pattern: "TODO" }),
    tool("Glob", { pattern: "tests/**/*.test.js" }),
    tool("Glob", { pattern: "**/*.js", path: ROOT }),
  ], "allow"));
});

test("§M6 guard H2: Bash mentioning holdout-tests, Quant Prep/holdout or the hold-out path is denied, locked or not", () => {
  expectDecisions(both([
    bash("cat ~/Documents/Quant\\ Prep/holdout-tests/a.test.js"),
    bash('ls "/Users/tester/Documents/Quant Prep/holdout"'),
    bash("ls '/users/tester/documents/QUANT PREP/Holdout'"),
    bash(`grep -r seqFit '${HOLDOUT}'`),
    bash("find / -path '*HOLDOUT-TESTS*'"),
    bash("cp -r ~/Documents/Quant\\ Prep/holdout-tests /tmp/x"),
  ], "deny"));
  expectDecisions(both([bash("cat /data/ho-secret/a.test.js"), bash("tar czf /tmp/x.tgz /DATA/HO-SECRET")], "deny"),
    { holdout: "/data/ho-secret" });
});

test("§M6 guard H2: HOLDOUT_ALLOW_RE lets a bare `npm run test:holdout` through; chained or other commands are denied", () => {
  expectDecisions([
    ...both([
      bash("npm run test:holdout"),
      bash("  npm run test:holdout  "),
      bash(`HOLDOUT_DIR="${HOLDOUT}" npm run test:holdout`),
      bash(`HOLDOUT_DIR='${HOLDOUT}' npm run test:holdout`),
      bash("HOLDOUT_DIR=/tmp/holdout-tests npm run test:holdout"),
    ], "allow"),
    ...both([
      bash("npm run test:holdout && cat ~/Documents/Quant\\ Prep/holdout-tests/a.test.js"),
      bash("HOLDOUT_DIR=/tmp/holdout-tests npm run test:holdout; cat /tmp/holdout-tests/a.test.js"),
      bash("HOLDOUT_DIR=/tmp/holdout-tests npm run test:holdout | tee /tmp/o"),
      bash("HOLDOUT_DIR=/tmp/holdout-tests npm test"),
      bash(`HOLDOUT_DIR="${HOLDOUT}" npm run check`),
    ], "deny"),
  ]);
});

test("§M6 guard A: whole commands matching NPM_ALLOW_RE are never denied by L2; chained npm commands are", () => {
  expectDecisions([
    ...whenLocked([
      bash("npm test"), bash("npm run check"), bash("npm run check:no-bank"), bash("npm run lock:verify"),
      bash("npm run lock:write"), bash("npm run lock:write -- --dispute D3"), bash("npm run lock:write -- --dispute D3,D4"),
      bash("npm run lock:restore"), bash("npm run test:coverage"), bash("npm run test:holdout"), bash("npm run e2e"),
      bash("npm run bank:build"), bash("npm run bank:build -- extract greenbook"), bash("HOLDOUT_DIR=/tmp/ho npm test"),
      // each of these would be denied by L2 if it were not allowlisted
      bash("HOLDOUT_DIR='/tmp/x > tests/y' npm test"),
      bash("HOLDOUT_DIR=/tmp/scripts/cp npm run check"),
      bash("npm run bank:build -- rm tests"),
    ], "allow"),
    ...whenLocked([
      bash("HOLDOUT_DIR='/tmp/x > tests/y' npm test && true"),
      bash("HOLDOUT_DIR=/tmp/scripts/cp npm run check | cat"),
      bash("npm run bank:build -- rm tests && true"),
      bash("npm test && rm -rf tests"),
      bash("npm test; echo x > tests/a.test.js"),
      bash("npm run check | tee scripts/out.txt"),
      bash("npm run lock:restore && git checkout v4-red -- tests"),
    ], "deny"),
  ]);
});

const LOCKED_EDIT_PATHS = [
  `${ROOT}/tests/v4-srs.test.js`,
  `${ROOT}/tests/LOCK.json`,
  `${ROOT}/tests/fixtures/bank-mini/bank.json`,
  "tests/v4-new.test.js",
  "prep/../tests/a.test.js",
  "~/am/scripts/lock.js",
  `${ROOT}/scripts/guard-locked.js`,
  `${ROOT}/.claude/settings.json`,
  `${ROOT}/.claude/settings.local.json`,
  `${ROOT}/e2e/v4.js`,
  `${ROOT}/e2e/run.js`,
  `${ROOT}/package.json`,
  "/users/tester/AM/Tests/V4-SRS.test.js",
  `${ROOT}/E2E/V4.JS`,
  `${ROOT}/Package.json`,
  `${ROOT}/SCRIPTS/lock.js`,
];

test("§M6 guard L1: when locked, edits inside tests/, scripts/, .claude/ or to e2e/v4.js, e2e/run.js, package.json are denied", () => {
  expectDecisions(whenLocked(LOCKED_EDIT_PATHS.flatMap(editsOf), "deny"));
});

test("§M6 guard L1: before the lock (locked=false) the same edits are allowed", () => {
  expectDecisions(whenUnlocked(LOCKED_EDIT_PATHS.flatMap(editsOf), "allow"));
});

test("§M6 guard L1: when locked, edits elsewhere (including .test-staging/, other package.json files and same-prefix siblings like tests-old/) are allowed", () => {
  expectDecisions(whenLocked([
    `${ROOT}/tests-old/a.test.js`, `${ROOT}/scripts-old/lock.js`, `${ROOT}/e2e/v4.js.bak`,
    `${ROOT}/prep/srs.js`, `${ROOT}/prep.html`, `${ROOT}/prep-ui.js`, `${ROOT}/manifest.json`, `${ROOT}/sidepanel.js`,
    `${ROOT}/package-lock.json`, `${ROOT}/e2e/blank.html`, `${ROOT}/e2e/out/v4-1.png`, `${ROOT}/TEST-DISPUTES.md`,
    `${ROOT}/BUILD-NOTES.md`, `${ROOT}/.test-staging/D3/tests/v4-srs.test.js`, `${ROOT}/bank-build/build.js`,
    `${ROOT}/bank/bank.json`, `${ROOT}/node_modules/x/package.json`, "~/.claude/projects/x/memory.md", "prep/oa.js",
  ].flatMap(editsOf), "allow"));
});

const M6_DENIED = [
  "cd tests && echo x > a.test.js",
  "(cd tests && cat /tmp/new > v4-srs.test.js)",
  "cd e2e && cat /tmp/x > v4.js",
  "python3 - <<'EOF'\nopen('tests/x', 'w').write('')\nEOF",
  "node --input-type=commonjs -e \"require('fs').writeFileSync('tests/a.js','')\"",
  "ex -sc wq tests/a.js",
  "echo x > Tests/v4-x.test.js",
  "sed -i '' 's/x/y/' scripts/lock.js",
  "git checkout v4-red -- tests/v4-srs.test.js",
];
const M6_ALLOWED = [
  "npm test > /tmp/o 2>&1",
  "npm run lock:restore",
  "node --test tests/v4-srs.test.js 2>&1 | tail -20",
  "grep -rn seqFit tests/",
  "git show v4-red:tests/LOCK.json",
  "node scripts/lock.js verify",
  "git add tests/LOCK.json tests/v4-srs.test.js && git commit -m 'v4: amend test (dispute D3)'",
];

test("§M6 guard L2: every denied example command in §M6 is denied when locked", () => {
  expectDecisions(whenLocked(M6_DENIED.map(bash), "deny"));
});

test("§M6 guard L2: every allowed example command in §M6 is allowed when locked", () => {
  expectDecisions(whenLocked(M6_ALLOWED.map(bash), "allow"));
});

test("§M6 guard L2: before the lock (locked=false) the denied examples are allowed", () => {
  expectDecisions(whenUnlocked(M6_DENIED.map(bash), "allow"));
});

test("§M6 guard L2: the 2>&1 exemption (\\d*>&\\d+, &>/dev/null, >/dev/null are removed; any other > counts)", () => {
  expectDecisions([
    ...whenLocked([
      "node --test tests/ 2>&1",
      "node --test tests/v4-srs.test.js 2>&1 | tail -20",
      "node --test tests/ > /dev/null",
      "node --test tests/ >/dev/null 2>&1",
      "node --test tests/ 2>/dev/null",
      "node --test tests/ &>/dev/null",
      "node --test tests/ &> /dev/null",
      "node --test tests/ 1>&2",
      "npm test > /tmp/o 2>&1",
    ].map(bash), "allow"),
    ...whenLocked([
      "node --test tests/ > /tmp/o",
      "node --test tests/ 2>&1 > /tmp/o",
      "node --test tests/ >> /tmp/o",
      "node --test tests/ 2> /tmp/err",
      "cat tests/a.test.js > /tmp/copy.js",
      "grep -rn '=>' tests/",
      "grep -n -- '->' scripts/lock.js",
    ].map(bash), "deny"),
  ]);
});

test("§M6 guard L2: write verbs, inline/stdin scripts, heredocs and editors on a locked path are denied", () => {
  expectDecisions(whenLocked([
    "tee tests/a.test.js < /tmp/x",
    "cat /tmp/x | tee scripts/lock.js",
    "cp /tmp/x tests/a.test.js",
    "mv scripts/lock.js /tmp/lock.js",
    "rm -rf tests",
    "rm package.json",
    "touch e2e/v4.js",
    "ln -sf /tmp/x tests/a.test.js",
    "chmod 000 scripts/guard-locked.js",
    "truncate -s 0 tests/a.test.js",
    "rsync -a /tmp/t/ tests/",
    "unlink e2e/run.js",
    "patch tests/a.test.js /tmp/p.diff",
    "dd if=/tmp/x of=tests/a.test.js",
    "install -m 644 /tmp/x scripts/x.js",
    "rmdir tests/fixtures/empty",
    "git restore tests/a.test.js",
    "git stash push -- tests",
    "git clean -fdx tests",
    "git reset HEAD -- tests/a.test.js",
    "git apply --include='tests/*' /tmp/p.diff",
    "git mv tests/a.test.js tests/b.test.js",
    "git checkout HEAD -- scripts/lock.js",
    "sed --in-place 's/a/b/' tests/a.test.js",
    "perl -pi -e 's/a/b/' tests/a.test.js",
    "node -e \"require('fs').rmSync('tests', { recursive: true })\"",
    "node -p \"require('fs').writeFileSync('scripts/x.js', '')\"",
    "python3 -c \"open('tests/a.test.js', 'w')\"",
    "python -c \"import os; os.remove('tests/a.test.js')\"",
    "node - <<'EOF'\nrequire('fs').writeFileSync('tests/a.js', '')\nEOF",
    "vim tests/a.test.js",
    "vi scripts/lock.js",
    "nano package.json",
    "echo '{}' > .claude/settings.json",
  ].map(bash), "deny"));
});

test("§M6 guard L2: an absolute <root>/ path counts as a mention even where MENTION_RE does not match", () => {
  expectDecisions(whenLocked([
    bash(`rm -rf ${ROOT}/tests*`),
    bash("rm -rf /USERS/TESTER/AM/scripts*"),
    bash(`cp /tmp/x ${ROOT}/package.json`),
  ], "deny"));
  expectDecisions(whenLocked([bash("rm -rf /work/proj/tests*")], "deny"), { root: "/work/proj" });
});

test("§M6 guard L2: when locked, read-only commands on locked paths and writes elsewhere are allowed", () => {
  expectDecisions(whenLocked([
    "cat tests/v4-srs.test.js",
    "ls scripts/",
    "head -50 e2e/run.js",
    "wc -l tests/*.test.js",
    "git diff -- tests",
    "git log --oneline -- tests scripts",
    "git status --porcelain -- tests scripts",
    "node --test tests/v4-srs.test.js",
    "diff tests/a.test.js /tmp/a.test.js",
    "cat package.json",
    "node e2e/run.js",
    "echo x > /tmp/o",
    "cp prep/srs.js /tmp/srs.js",
    "rm -rf /tmp/am-scratch",
    "sed -i '' 's/a/b/' prep/srs.js",
    "node -e \"console.log(1)\"",
    "mkdir -p prep",
  ].map(bash), "allow"));
});

test("§M6 guard: paths and regexes are case-insensitive on every platform", () => {
  expectDecisions([
    ...whenLocked([
      bash("echo x > Tests/v4-x.test.js"),
      bash("CP /tmp/x SCRIPTS/lock.js"),
      bash("echo x > PACKAGE.JSON"),
      bash("Rm -f E2E/V4.JS"),
      bash("echo '{}' > .CLAUDE/settings.json"),
      bash("git checkout V4-RED -- TESTS/v4-srs.test.js"),
      ...editsOf("/USERS/Tester/Am/TESTS/v4-srs.test.js"),
      ...editsOf(`${ROOT}/.Claude/settings.json`),
    ], "deny"),
    ...both([
      tool("Read", { file_path: "/USERS/TESTER/DOCUMENTS/QUANT PREP/HOLDOUT-TESTS/x.test.js" }),
      tool("Glob", { pattern: "**/HOLDOUT-TESTS/**" }),
      bash("cat ~/Documents/quant prep/HOLDOUT/x"),
    ], "deny"),
  ]);
});

// ---------- 9. the hook CLI (§M6) ----------

function guardCli(input, env) {
  return runScript("guard-locked.js", [], {
    cwd: os.tmpdir(), env, input: typeof input === "string" ? input : JSON.stringify(input),
  });
}

test("§M6 guard CLI: unparseable stdin is denied (fail closed) with exit 2 and a reason on stderr", () => {
  const root = tmpDir();
  const env = { AM_GUARD_ROOT: root, HOLDOUT_DIR: path.join(root, "ho") };
  for (const input of ["", "not json", '{"tool_name": "Read"']) {
    const r = guardCli(input, env);
    assert.equal(r.status, 2, `input ${JSON.stringify(input)}: ${r.out}`);
    assert.ok(r.stderr.trim().length > 0, "reason on stderr");
  }
});

test("§M6 guard CLI: allow is exit 0 with no output; deny is exit 2 with the reason on stderr", () => {
  const root = tmpDir();
  const ho = tmpDir();
  const env = { AM_GUARD_ROOT: root, HOLDOUT_DIR: ho };
  const ok = guardCli(tool("Read", { file_path: path.join(root, "prep", "srs.js") }), env);
  assert.equal(ok.status, 0, ok.out);
  assert.equal(ok.stdout, "");
  assert.equal(ok.stderr, "");
  const no = guardCli(tool("Read", { file_path: path.join(ho, "a.test.js") }), env);
  assert.equal(no.status, 2, no.out);
  assert.ok(no.stderr.trim().length > 0);
});

test("§M6 guard CLI: without HOLDOUT_DIR the hold-out dir is ~/Documents/Quant Prep/holdout-tests", () => {
  const root = tmpDir();
  // Only a decision about a path string: nothing reads this file.
  const canary = path.join(os.homedir(), "Documents", "Quant Prep", "holdout-tests", "canary.txt");
  const r = guardCli(tool("Read", { file_path: canary }), { AM_GUARD_ROOT: root });
  assert.equal(r.status, 2, r.out);
  assert.ok(r.stderr.trim().length > 0);
});

test("§M6 guard CLI: root from AM_GUARD_ROOT, then CLAUDE_PROJECT_DIR; locked = tests/LOCK.json exists under the root", () => {
  const lockedRoot = tmpDir();
  writeTree(lockedRoot, { "tests/LOCK.json": "{}\n", "tests/a.test.js": "//\n" });
  const openRoot = tmpDir();
  writeTree(openRoot, { "tests/a.test.js": "//\n" });
  const ho = tmpDir();
  const edit = (p) => tool("Edit", { file_path: p, old_string: "a", new_string: "b" });
  const cases = [
    [{ AM_GUARD_ROOT: lockedRoot }, edit(path.join(lockedRoot, "tests", "a.test.js")), 2],
    [{ AM_GUARD_ROOT: lockedRoot }, edit("tests/a.test.js"), 2],
    [{ AM_GUARD_ROOT: lockedRoot }, edit(path.join(lockedRoot, "prep", "x.js")), 0],
    [{ AM_GUARD_ROOT: lockedRoot }, bash("echo x > tests/a.test.js"), 2],
    [{ AM_GUARD_ROOT: openRoot }, edit(path.join(openRoot, "tests", "a.test.js")), 0],
    [{ AM_GUARD_ROOT: openRoot }, bash("echo x > tests/a.test.js"), 0],
    [{ AM_GUARD_ROOT: lockedRoot, CLAUDE_PROJECT_DIR: openRoot }, edit("tests/a.test.js"), 2],
    [{ AM_GUARD_ROOT: openRoot, CLAUDE_PROJECT_DIR: lockedRoot }, edit("tests/a.test.js"), 0],
    [{ CLAUDE_PROJECT_DIR: lockedRoot }, edit("tests/a.test.js"), 2],
    [{ CLAUDE_PROJECT_DIR: openRoot }, edit("tests/a.test.js"), 0],
  ];
  const wrong = [];
  for (const [env, input, want] of cases) {
    const r = guardCli(input, { ...env, HOLDOUT_DIR: ho });
    if (r.status !== want) wrong.push(`want exit ${want}, got ${r.status}: ${JSON.stringify(env)} ${JSON.stringify(input)}`);
  }
  // Neither variable: the root is the repo containing scripts/ (path.resolve(__dirname, "..")).
  const probe = guardCli(tool("Write", { file_path: path.join(REPO, "tests", "zz-guard-probe.test.js"), content: "" }), { HOLDOUT_DIR: ho });
  const want = fs.existsSync(path.join(REPO, "tests", "LOCK.json")) ? 2 : 0;
  if (probe.status !== want) wrong.push(`default root: want exit ${want}, got ${probe.status}`);
  assert.deepEqual(wrong, []);
});
