// The test lock (V4-CONTRACTS.md §M4; spec §11). Commands:
//   node scripts/lock.js write                     write tests/LOCK.json (refuses once it exists)
//   node scripts/lock.js write --dispute D3[,D4]   the judge path: apply .test-staging/<id>/ files
//   node scripts/lock.js verify                    hashes + git history checks (a)-(d)
//   node scripts/lock.js restore                   the gatekeeper's revert path (from HEAD)
//
// Everything is relative to the lock root: AM_LOCK_ROOT if set (tooling tests in temp dirs),
// else the repo root. The process cwd and __dirname play no other part. The exported helpers are
// pure apart from reading files; the CLI only runs under `require.main === module` (§M2).
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "..");
const LOCK_REL = "tests/LOCK.json";
const DISPUTES_REL = "TEST-DISPUTES.md";
const STAGING_REL = ".test-staging";
// The lockable roots, as passed to git. The three single files are lockable on their own.
const LOCKABLE_ROOTS = ["tests", "scripts", "e2e/v4.js", "e2e/run.js", "package.json"];
const LOCKABLE_FILES = ["e2e/v4.js", "e2e/run.js", "package.json"];
const PRE_LOCK_TAG = "v4-red-pre";
const LOCK_TAG = "v4-red";
const LOCK_SUBJECT = "v4: red tests";
const AMEND_SUBJECT_RE = /^v4: amend test \(dispute (D\d+(?:,D\d+)*)\)$/;
const DISPUTE_ID_RE = /^D\d+$/;

const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const absPath = (root, rel) => path.join(root, ...rel.split("/"));
const isDsStore = (rel) => rel.split("/").pop() === ".DS_Store";

function lockRoot(env = process.env) {
  return env.AM_LOCK_ROOT ? path.resolve(env.AM_LOCK_ROOT) : REPO_ROOT;
}

function lstatOrNull(p) {
  try {
    return fs.lstatSync(p);
  } catch {
    return null;
  }
}

// Every regular file below absDir, as POSIX paths prefixed with relDir. Symlinks are neither
// followed nor listed ("regular file", §M4).
function walkFiles(absDir, relDir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(absDir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const rel = relDir ? `${relDir}/${e.name}` : e.name;
    if (e.isDirectory()) walkFiles(path.join(absDir, e.name), rel, out);
    else if (e.isFile()) out.push(rel);
  }
  return out;
}

// Whether a POSIX path relative to the lock root belongs to the lockable set (§M4), whether or
// not the file exists.
function isLockablePath(rel) {
  if (typeof rel !== "string") return false;
  const parts = rel.split("/");
  if (parts.some((p) => p === "" || p === "." || p === "..")) return false;
  if (isDsStore(rel) || rel === LOCK_REL) return false;
  if ((parts[0] === "tests" || parts[0] === "scripts") && parts.length > 1) return true;
  return LOCKABLE_FILES.includes(rel);
}

function lockableFiles(root) {
  const found = [];
  for (const dir of ["tests", "scripts"]) walkFiles(path.join(root, dir), dir, found);
  for (const rel of LOCKABLE_FILES) {
    const st = lstatOrNull(absPath(root, rel));
    if (st && st.isFile()) found.push(rel);
  }
  return found.filter(isLockablePath).sort(byCodeUnit);
}

function hashFile(p) {
  return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}

function compareLock(lock, current) {
  const files = (lock && lock.files) || {};
  const cur = current || {};
  const missing = [];
  const changed = [];
  const extra = [];
  for (const k of Object.keys(files)) {
    if (!hasOwn(cur, k)) missing.push(k);
    else if (!files[k] || files[k].sha256 !== cur[k]) changed.push(k);
  }
  for (const k of Object.keys(cur)) if (!hasOwn(files, k)) extra.push(k);
  return { missing: missing.sort(byCodeUnit), changed: changed.sort(byCodeUnit), extra: extra.sort(byCodeUnit) };
}

// `## D<n>: …` starts an entry; any other heading ends it. Line keys are case-insensitive and
// may be written as list items ("- Ruling: amend"). The first Ruling / File line of an entry wins.
function parseDisputes(markdown) {
  const out = [];
  let cur = null;
  for (const line of String(markdown || "").split(/\r?\n/)) {
    const head = /^##\s+(D\d+)\s*:/.exec(line);
    if (head) {
      cur = { id: head[1], ruling: "pending", files: [], _ruling: false, _files: false };
      out.push(cur);
      continue;
    }
    if (/^#{1,6}\s/.test(line)) {
      cur = null;
      continue;
    }
    if (!cur) continue;
    const kv = /^\s*(?:[-*+]\s+)?([A-Za-z][A-Za-z ]*?)\s*:(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1].toLowerCase();
    if (key === "ruling" && !cur._ruling) {
      cur._ruling = true;
      cur.ruling = kv[2].trim().toLowerCase();
    } else if (key === "file" && !cur._files) {
      cur._files = true;
      cur.files = kv[2].split(",").map((s) => s.trim()).filter(Boolean);
    }
  }
  return out.map(({ id, ruling, files }) => ({ id, ruling, files }));
}

// ---------- git ----------

// Read-only commands skip git's optional index refresh, so verify never writes inside .git/.
// Every call ignores replace refs (GIT_NO_REPLACE_OBJECTS, else `git replace` could make
// `git show v4-red:tests/LOCK.json` or a checkout return other bytes), a configured fsmonitor
// (which can tell git status a file is unchanged) and repo hooks (a post-checkout hook could undo
// lock:restore, for example by deleting tests/LOCK.json).
const GIT_CONFIG_ARGS = [
  "-c", "color.ui=false", "-c", "core.quotepath=false", "-c", "log.showSignature=false",
  "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null",
];
function git(root, args, { write = false, input } = {}) {
  const env = { ...process.env, GIT_NO_REPLACE_OBJECTS: "1", ...(write ? {} : { GIT_OPTIONAL_LOCKS: "0" }) };
  const r = spawnSync("git", [...GIT_CONFIG_ARGS, ...args], {
    cwd: root, env, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, input,
  });
  const ok = !r.error && r.status === 0;
  const err = ((r.stderr || "") + (r.error ? r.error.message : "")).trim();
  return { ok, stdout: r.stdout || "", err };
}

const nulList = (s) => s.split("\0").filter(Boolean);

function samePath(a, b) {
  const real = (p) => {
    try {
      return fs.realpathSync.native(p);
    } catch {
      return path.resolve(p);
    }
  };
  return real(a) === real(b);
}

// { inside: false } outside a git work tree (or without git). Inside one, the lock root must be
// the work tree's top level (§M4), else { inside: true, error }: running the history checks
// against some enclosing repo would check the wrong thing.
function gitState(root) {
  const r = git(root, ["rev-parse", "--is-inside-work-tree"]);
  if (!r.ok || r.stdout.trim() !== "true") return { inside: false };
  const top = git(root, ["rev-parse", "--show-toplevel"]);
  if (!top.ok) return { inside: true, error: `cannot find the git work tree's top level (${top.err})` };
  if (!samePath(top.stdout.trim(), root)) {
    return { inside: true, error: `the lock root ${root} is inside a git work tree but is not its top level (${top.stdout.trim()})` };
  }
  return { inside: true };
}

function tagCommit(root, tag) {
  const r = git(root, ["rev-parse", "-q", "--verify", `refs/tags/${tag}^{commit}`]);
  return r.ok ? r.stdout.trim() : null;
}

// The files of `rev` under `pathspecs` whose working-tree copy is missing, of another type or has
// other bytes, sorted. `git diff` and `git status` compare through the index, so
// `update-index --assume-unchanged` / `--skip-worktree` or a clean filter can hide an edit from
// them; this compares raw bytes (`hash-object --no-filters`) with the blobs of `rev`. Files that
// `rev` lacks are not its business (git's untracked listings and the LOCK hashes cover them).
function worktreeMismatches(root, rev, pathspecs) {
  const ls = git(root, ["ls-tree", "-r", "-z", "--full-tree", rev, "--", ...pathspecs]);
  if (!ls.ok) return { error: `git ls-tree ${rev} failed: ${ls.err}` };
  const bad = [];
  const regular = [];
  for (const line of nulList(ls.stdout)) {
    const tab = line.indexOf("\t");
    const [mode, type, oid] = line.slice(0, tab).split(" ");
    const rel = line.slice(tab + 1);
    if (type !== "blob") continue; // a submodule
    const st = lstatOrNull(absPath(root, rel));
    if (mode === "120000") {
      const blob = git(root, ["cat-file", "blob", oid]);
      if (!st || !st.isSymbolicLink() || !blob.ok || fs.readlinkSync(absPath(root, rel)) !== blob.stdout) bad.push(rel);
    } else if (!st || !st.isFile()) {
      bad.push(rel);
    } else {
      regular.push({ rel, oid });
    }
  }
  if (regular.length) {
    const h = git(root, ["hash-object", "--no-filters", "--stdin-paths"], { input: regular.map((e) => e.rel).join("\n") + "\n" });
    if (!h.ok) return { error: `git hash-object failed: ${h.err}` };
    const oids = h.stdout.split("\n").filter(Boolean);
    regular.forEach((e, i) => {
      if (oids[i] !== e.oid) bad.push(e.rel);
    });
  }
  return { paths: bad.sort(byCodeUnit) };
}

// ---------- output ----------

const stdio = {
  out: (line) => process.stdout.write(line + "\n"),
  err: (line) => process.stderr.write(line + "\n"),
};

function readLock(root) {
  const p = absPath(root, LOCK_REL);
  let lock;
  try {
    lock = JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    return { error: `tests/LOCK.json cannot be read as JSON (${e.message})` };
  }
  if (!lock || typeof lock !== "object" || !lock.files || typeof lock.files !== "object" || Array.isArray(lock.files)) {
    return { error: "tests/LOCK.json has no `files` map" };
  }
  return { lock };
}

function serializeLock(lock) {
  const files = {};
  for (const k of Object.keys(lock.files).sort(byCodeUnit)) files[k] = lock.files[k];
  return JSON.stringify({ ...lock, files }, null, 2) + "\n";
}

function readDisputes(root) {
  const p = absPath(root, DISPUTES_REL);
  return fs.existsSync(p) ? parseDisputes(fs.readFileSync(p, "utf8")) : null;
}

// ---------- lock:write ----------

function parseWriteArgs(argv) {
  let ids = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    let value;
    if (a === "--dispute") {
      if (i + 1 >= argv.length) return { error: "--dispute needs the dispute ids, e.g. --dispute D3 or --dispute D6,D7" };
      value = argv[++i];
    } else if (a.startsWith("--dispute=")) {
      value = a.slice("--dispute=".length);
    } else {
      return { error: `unknown argument ${JSON.stringify(a)}` };
    }
    if (ids) return { error: "--dispute was given twice" };
    const list = value.split(",");
    if (list.some((id) => !DISPUTE_ID_RE.test(id))) {
      return { error: `bad dispute id list ${JSON.stringify(value)} (want D<n> or D<n>,D<m>, no spaces)` };
    }
    if (new Set(list).size !== list.length) return { error: `a dispute id is repeated in ${JSON.stringify(value)}` };
    ids = list;
  }
  return { ids };
}

// The §M4 pre-lock conditions, inside a git work tree. Returns the reasons to refuse.
function preLockProblems(root) {
  if (!tagCommit(root, PRE_LOCK_TAG)) return [`tag ${PRE_LOCK_TAG} does not exist`];
  const problems = [];
  const diff = git(root, ["diff", "--name-only", "-z", "--no-renames", `refs/tags/${PRE_LOCK_TAG}`, "--", "tests", "e2e/v4.js"]);
  const diffed = diff.ok ? nulList(diff.stdout) : [];
  if (!diff.ok) problems.push(`git diff against ${PRE_LOCK_TAG} failed: ${diff.err}`);
  else if (diffed.length) {
    problems.push(`tests/ or e2e/v4.js differ from ${PRE_LOCK_TAG}: ${diffed.join(", ")}`);
  }
  // The same condition, on raw bytes, for edits that index flags or filters hide from git diff.
  const bytes = worktreeMismatches(root, `refs/tags/${PRE_LOCK_TAG}`, ["tests", "e2e/v4.js"]);
  const hidden = bytes.paths ? bytes.paths.filter((p) => !diffed.includes(p)) : [];
  if (bytes.error) problems.push(bytes.error);
  else if (hidden.length) {
    problems.push(`these files' bytes differ from ${PRE_LOCK_TAG} although git diff shows nothing: ${hidden.join(", ")}`);
  }
  const untracked = git(root, ["ls-files", "-z", "--others", "--exclude-standard", "--", "tests", "e2e/v4.js"]);
  if (!untracked.ok) problems.push(`git ls-files failed: ${untracked.err}`);
  else if (nulList(untracked.stdout).length) {
    problems.push(`untracked files under tests/ or e2e/v4.js: ${nulList(untracked.stdout).join(", ")}`);
  }
  return problems;
}

function writeInitial(root, io) {
  if (fs.existsSync(absPath(root, LOCK_REL))) {
    io.err("lock:write: refused: tests/LOCK.json already exists. A locked file changes only through a dispute ruled amend: lock:write -- --dispute <ids>.");
    return 1;
  }
  const g = gitState(root);
  if (g.error) {
    io.err(`lock:write: refused: ${g.error}`);
    return 1;
  }
  if (g.inside) {
    const problems = preLockProblems(root);
    if (problems.length) {
      for (const p of problems) io.err(`lock:write: refused: ${p}`);
      return 1;
    }
  } else {
    io.err(`lock:write: notice: ${root} is not a git work tree, so the pre-lock git checks (tag ${PRE_LOCK_TAG}, no diff, no untracked files) are skipped.`);
  }
  const files = {};
  for (const rel of lockableFiles(root)) files[rel] = { sha256: hashFile(absPath(root, rel)) };
  const lock = { version: 1, algorithm: "sha256", created: new Date().toISOString(), files };
  fs.writeFileSync(absPath(root, LOCK_REL), serializeLock(lock));
  io.out(`lock:write: wrote tests/LOCK.json with ${Object.keys(files).length} entries. Commit it as "${LOCK_SUBJECT}" and tag ${LOCK_TAG}.`);
  return 0;
}

// Regular files under a staging dir (relative POSIX paths), plus anything that is neither a
// regular file nor a directory (symlinks and the like), which the caller refuses.
function listStaged(dir) {
  const files = [];
  const odd = [];
  (function walk(abs, rel) {
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(abs, e.name), r);
      else if (e.isFile()) files.push(r);
      else odd.push(r);
    }
  })(dir, "");
  return { files: files.filter((r) => !isDsStore(r)).sort(byCodeUnit), odd };
}

function writeDisputed(root, ids, io) {
  const refuse = (problems) => {
    for (const p of problems) io.err(`lock:write --dispute: refused: ${p}`);
    io.err("lock:write --dispute: nothing was changed.");
    return 1;
  };
  if (!fs.existsSync(absPath(root, LOCK_REL))) return refuse(["tests/LOCK.json does not exist yet; a dispute amends an existing lock"]);
  const { lock, error } = readLock(root);
  if (error) return refuse([error]);
  const disputes = readDisputes(root);
  if (!disputes) return refuse([`${DISPUTES_REL} does not exist, so no dispute is ruled amend`]);

  const problems = [];
  const staged = new Map(); // rel -> { id, src }
  for (const id of ids) {
    const entries = disputes.filter((d) => d.id === id);
    if (entries.length === 0) {
      problems.push(`${id} is not in ${DISPUTES_REL}`);
      continue;
    }
    if (entries.length > 1) {
      problems.push(`${id} has more than one entry in ${DISPUTES_REL}`);
      continue;
    }
    const d = entries[0];
    if (d.ruling !== "amend") problems.push(`${id} is ruled ${JSON.stringify(d.ruling)}, not "amend"`);
    const dir = absPath(root, `${STAGING_REL}/${id}`);
    const st = lstatOrNull(dir);
    if (!st || !st.isDirectory()) {
      problems.push(`there is no staging dir ${STAGING_REL}/${id}/`);
      continue;
    }
    const { files, odd } = listStaged(dir);
    for (const r of odd) problems.push(`${STAGING_REL}/${id}/${r} is not a regular file`);
    if (files.length === 0) problems.push(`${STAGING_REL}/${id}/ holds no staged file`);
    for (const rel of files) {
      if (!d.files.includes(rel)) problems.push(`${rel} (staged for ${id}) is not in ${id}'s File: list`);
      if (!isLockablePath(rel)) problems.push(`${rel} (staged for ${id}) is not a lockable file`);
      else if (!hasOwn(lock.files, rel)) problems.push(`${rel} (staged for ${id}) is not in tests/LOCK.json, and a dispute cannot add a file`);
      if (staged.has(rel)) problems.push(`${rel} is staged by both ${staged.get(rel).id} and ${id}`);
      else staged.set(rel, { id, src: absPath(dir, rel) });
    }
  }
  if (problems.length) return refuse(problems);

  // Only the staged files are copied and rehashed; every other entry is written back unchanged,
  // so an out-of-band edit is never laundered into the lock (lock:verify still reports it).
  for (const rel of Object.keys(lock.files).sort(byCodeUnit)) {
    if (staged.has(rel)) continue;
    const p = absPath(root, rel);
    const st = lstatOrNull(p);
    const drifted = !st || !st.isFile() || !lock.files[rel] || hashFile(p) !== lock.files[rel].sha256;
    if (drifted) io.err(`lock:write --dispute: warning: ${rel} differs from its LOCK hash; it is left as is and lock:verify will report it.`);
  }
  for (const [rel, { id, src }] of [...staged].sort((a, b) => byCodeUnit(a[0], b[0]))) {
    const dest = absPath(root, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, fs.readFileSync(src));
    const prev = lock.files[rel] || {};
    const list = Array.isArray(prev.disputes) ? prev.disputes.slice() : [];
    if (!list.includes(id)) list.push(id);
    lock.files[rel] = { ...prev, sha256: hashFile(dest), disputes: list };
    io.out(`lock:write --dispute: ${rel} copied from ${STAGING_REL}/${id}/ and rehashed (${list.join(", ")})`);
  }
  fs.writeFileSync(absPath(root, LOCK_REL), serializeLock(lock));
  for (const id of ids) fs.rmSync(absPath(root, `${STAGING_REL}/${id}`), { recursive: true, force: true });
  try {
    fs.rmdirSync(absPath(root, STAGING_REL)); // only succeeds when no other dispute is staged
  } catch {
    // other staging dirs remain
  }
  io.out(`lock:write --dispute: tests/LOCK.json updated. Commit exactly the amended files and tests/LOCK.json as "v4: amend test (dispute ${ids.join(",")})".`);
  return 0;
}

function write(root, argv = [], io = stdio) {
  const parsed = parseWriteArgs(argv);
  if (parsed.error) {
    io.err(`lock:write: ${parsed.error}`);
    return 1;
  }
  return parsed.ids ? writeDisputed(root, parsed.ids, io) : writeInitial(root, io);
}

// ---------- lock:verify ----------

// Checks (a)-(d) of §M4 step 3. Returns the reasons for failure.
function gitHistoryProblems(root, lock) {
  const reasons = [];
  const tagSha = tagCommit(root, LOCK_TAG);
  let tagOk = false;
  if (!tagSha) {
    reasons.push(`(a) tag ${LOCK_TAG} does not exist`);
  } else {
    const s = git(root, ["log", "-1", "--format=%s", tagSha]);
    const subject = s.stdout.replace(/\r?\n$/, "");
    if (!s.ok) reasons.push(`(a) cannot read the commit of tag ${LOCK_TAG}: ${s.err}`);
    else if (subject !== LOCK_SUBJECT) reasons.push(`(a) tag ${LOCK_TAG} points at a commit with subject ${JSON.stringify(subject)}, not ${JSON.stringify(LOCK_SUBJECT)}`);
    else tagOk = true;
  }

  const status = git(root, ["status", "--porcelain", "--untracked-files=all", "--", ...LOCKABLE_ROOTS]);
  if (!status.ok) reasons.push(`(b) git status failed: ${status.err}`);
  else if (status.stdout.trim()) {
    reasons.push(`(b) uncommitted changes to lockable files:\n${status.stdout.replace(/\s+$/, "").replace(/^/gm, "      ")}`);
  } else {
    // git status reads through the index; check the bytes too, so index flags cannot hide an edit.
    const bytes = worktreeMismatches(root, "HEAD", LOCKABLE_ROOTS);
    if (bytes.error) reasons.push(`(b) ${bytes.error}`);
    else if (bytes.paths.length) reasons.push(`(b) lockable files differ from HEAD although git status shows nothing: ${bytes.paths.join(", ")}`);
  }
  if (!tagOk) return reasons;

  // (c) every commit since v4-red that touches a lockable root is a dispute amend commit.
  const disputes = readDisputes(root) || [];
  const log = git(root, ["log", "--format=%H%x09%s", `refs/tags/${LOCK_TAG}..HEAD`, "--", ...LOCKABLE_ROOTS]);
  const touched = new Set();
  if (!log.ok) {
    reasons.push(`(c) git log failed: ${log.err}`);
  } else {
    for (const line of log.stdout.split("\n").filter(Boolean)) {
      const tab = line.indexOf("\t");
      const sha = line.slice(0, tab);
      const subject = line.slice(tab + 1);
      const tree = git(root, ["diff-tree", "--no-commit-id", "--name-only", "-r", "-z", "--no-renames", "--root", sha, "--", ...LOCKABLE_ROOTS]);
      if (!tree.ok) {
        reasons.push(`(c) git diff-tree ${sha.slice(0, 10)} failed: ${tree.err}`);
        continue;
      }
      const paths = nulList(tree.stdout).filter((p) => p !== LOCK_REL);
      for (const p of paths) touched.add(p);
      const label = `commit ${sha.slice(0, 10)} ${JSON.stringify(subject)}`;
      const m = AMEND_SUBJECT_RE.exec(subject);
      if (!m) {
        reasons.push(`(c) ${label} touches lockable files but is not a "v4: amend test (dispute D<n>)" commit`);
        continue;
      }
      const allowed = new Set();
      for (const id of m[1].split(",")) {
        const entries = disputes.filter((d) => d.id === id);
        if (entries.length !== 1) reasons.push(`(c) ${label}: ${id} has ${entries.length} entries in ${DISPUTES_REL}, want exactly 1`);
        else if (entries[0].ruling !== "amend") reasons.push(`(c) ${label}: ${id} is ruled ${JSON.stringify(entries[0].ruling)}, not "amend"`);
        else for (const f of entries[0].files) allowed.add(f);
      }
      const outside = paths.filter((p) => !allowed.has(p));
      if (outside.length) reasons.push(`(c) ${label} touches files outside its disputes' File: lists: ${outside.join(", ")}`);
    }
  }

  // (d) same keys as at v4-red, and every key no listed commit touched keeps its v4-red hash.
  const shown = git(root, ["show", `refs/tags/${LOCK_TAG}:${LOCK_REL}`]);
  let base = null;
  if (!shown.ok) reasons.push(`(d) cannot read ${LOCK_REL} at ${LOCK_TAG}: ${shown.err}`);
  else {
    try {
      base = JSON.parse(shown.stdout);
    } catch (e) {
      reasons.push(`(d) ${LOCK_REL} at ${LOCK_TAG} is not JSON (${e.message})`);
    }
  }
  if (base) {
    const baseFiles = (base && base.files) || {};
    const added = Object.keys(lock.files).filter((k) => !hasOwn(baseFiles, k)).sort(byCodeUnit);
    const removed = Object.keys(baseFiles).filter((k) => !hasOwn(lock.files, k)).sort(byCodeUnit);
    if (added.length) reasons.push(`(d) keys in tests/LOCK.json that ${LOCK_TAG} does not have: ${added.join(", ")}`);
    if (removed.length) reasons.push(`(d) keys of ${LOCK_TAG}'s LOCK.json missing from tests/LOCK.json: ${removed.join(", ")}`);
    for (const k of Object.keys(lock.files).sort(byCodeUnit)) {
      if (!hasOwn(baseFiles, k) || touched.has(k)) continue;
      const now = lock.files[k] && lock.files[k].sha256;
      const then = baseFiles[k] && baseFiles[k].sha256;
      if (now !== then) reasons.push(`(d) ${k} has a different hash from ${LOCK_TAG}, but no amend commit touched it`);
    }
  }
  return reasons;
}

function verify(root, io = stdio) {
  if (!fs.existsSync(absPath(root, LOCK_REL))) {
    io.out("lock:verify: no tests/LOCK.json yet (pre-lock), skipping");
    return 0;
  }
  const { lock, error } = readLock(root);
  if (error) {
    io.err(`lock:verify: FAILED: ${error}`);
    return 1;
  }
  const current = {};
  for (const rel of lockableFiles(root)) current[rel] = hashFile(absPath(root, rel));
  const { missing, changed, extra } = compareLock(lock, current);
  if (missing.length || changed.length || extra.length) {
    io.err("lock:verify: FAILED: lockable files differ from tests/LOCK.json");
    for (const p of changed) io.err(`  changed: ${p}`);
    for (const p of missing) io.err(`  missing: ${p}`);
    for (const p of extra) io.err(`  extra: ${p}`);
    io.err("  The gatekeeper's revert path is npm run lock:restore.");
    return 1;
  }
  const g = gitState(root);
  if (g.error) {
    io.err(`lock:verify: FAILED: ${g.error}`);
    return 1;
  }
  if (g.inside) {
    const reasons = gitHistoryProblems(root, lock);
    if (reasons.length) {
      io.err("lock:verify: FAILED: the lock's git history checks failed");
      for (const r of reasons) io.err(`  ${r}`);
      return 1;
    }
  } else {
    io.err(`lock:verify: notice: ${root} is not a git work tree, so the git history checks (a)-(d) are skipped.`);
  }
  for (const rel of Object.keys(lock.files).sort(byCodeUnit)) {
    const d = lock.files[rel] && lock.files[rel].disputes;
    if (Array.isArray(d) && d.length) io.out(`amended: ${rel} (${d.join(", ")})`);
  }
  io.out(`lock:verify: ${Object.keys(lock.files).length} files OK`);
  return 0;
}

// ---------- lock:restore ----------

// Removes the now-empty directories between a deleted file and its top-level root.
function pruneEmptyDirs(root, rel) {
  const parts = rel.split("/");
  for (let n = parts.length - 1; n > 1; n--) {
    try {
      fs.rmdirSync(absPath(root, parts.slice(0, n).join("/")));
    } catch {
      return;
    }
  }
}

function restore(root, io = stdio) {
  const g = gitState(root);
  if (!g.inside) {
    io.err(`lock:restore: refused: ${root} is not a git work tree, so there is no HEAD to restore from. Nothing was changed.`);
    return 1;
  }
  if (g.error) {
    io.err(`lock:restore: refused: ${g.error}. Nothing was changed.`);
    return 1;
  }
  if (!git(root, ["rev-parse", "-q", "--verify", "HEAD^{commit}"]).ok) {
    io.err("lock:restore: refused: there is no HEAD commit. Nothing was changed.");
    return 1;
  }
  const tree = git(root, ["ls-tree", "-z", "--name-only", "HEAD", "--", ...LOCKABLE_ROOTS]);
  if (!tree.ok) {
    io.err(`lock:restore: git ls-tree failed: ${tree.err}`);
    return 1;
  }
  const atHead = nulList(tree.stdout).filter((p) => LOCKABLE_ROOTS.includes(p));
  // Unstage first, so files added to the index but not committed count as untracked below.
  const reset = git(root, ["reset", "-q", "HEAD", "--", ...LOCKABLE_ROOTS], { write: true });
  if (!reset.ok) {
    io.err(`lock:restore: git reset failed: ${reset.err}`);
    return 1;
  }
  if (atHead.length) {
    const co = git(root, ["checkout", "HEAD", "--", ...atHead], { write: true });
    if (!co.ok) {
      io.err(`lock:restore: git checkout failed: ${co.err}`);
      return 1;
    }
  }
  io.out(`lock:restore: restored ${atHead.join(", ") || "nothing"} from HEAD`);
  const others = git(root, ["ls-files", "-z", "--others", "--", "tests", "scripts"]);
  if (!others.ok) {
    io.err(`lock:restore: git ls-files failed: ${others.err}`);
    return 1;
  }
  for (const rel of nulList(others.stdout).sort(byCodeUnit)) {
    const clean = rel.replace(/\/+$/, "");
    if (isDsStore(clean)) continue;
    fs.rmSync(absPath(root, clean), { recursive: true, force: true });
    pruneEmptyDirs(root, clean);
    io.out(`lock:restore: deleted untracked ${clean}`);
  }
  return verify(root, io);
}

// ---------- CLI ----------

function main(argv = process.argv.slice(2), env = process.env, io = stdio) {
  const root = lockRoot(env);
  const [cmd, ...rest] = argv;
  if (cmd === "write") return write(root, rest, io);
  if ((cmd === "verify" || cmd === "restore") && rest.length === 0) {
    return cmd === "verify" ? verify(root, io) : restore(root, io);
  }
  io.err("usage: node scripts/lock.js write [--dispute D<n>[,D<m>...]] | verify | restore");
  return 1;
}

module.exports = {
  LOCKABLE_ROOTS, AMEND_SUBJECT_RE,
  lockRoot, lockableFiles, isLockablePath, hashFile, compareLock, parseDisputes,
  write, verify, restore, main,
};

if (require.main === module) process.exitCode = main();
