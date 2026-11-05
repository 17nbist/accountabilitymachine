// Claude Code PreToolUse hook (V4-CONTRACTS.md §M6; spec §11). Wired up in the local, gitignored
// .claude/settings.json for Edit|Write|MultiEdit|NotebookEdit|Bash|Read|Grep|Glob.
//
// CLI: reads the hook JSON on stdin. Allow = exit 0 with no output. Deny = the reason on stderr
// and exit 2, which blocks the tool. Unparseable stdin is denied (fail closed).
//
// guardDecision is pure: it works on path strings only (no realpath, no existence checks), and
// every comparison is case-insensitive, with Unicode case folding as on APFS. It is
// pattern-based, not a sandbox: lock:verify catches whatever slips past it (BUILD-NOTES §3).
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Verbatim from §M6 (both allowlists carry `i`, [decision, Red]).
const HOLDOUT_ALLOW_RE = /^\s*(HOLDOUT_DIR=("[^"]*"|'[^']*'|\S+)\s+)?npm run test:holdout\s*$/i;
const NPM_ALLOW_RE = /^\s*(HOLDOUT_DIR=("[^"]*"|'[^']*'|\S+)\s+)?npm (test|run (check|check:no-bank|lock:verify|lock:write( -- --dispute [A-Za-z0-9,]+)?|lock:restore|test:coverage|test:holdout|e2e|bank:build( -- [\w -]+)?))\s*$/i;
const MENTION_RE = /(^|[^\w.-])(tests|scripts|\.claude)(\/|\s|$|["'])|(^|[^\w.-])(v4|run)\.js\b|(^|[^\w.-])package\.json\b/i;
const WRITE_VERB_RE = new RegExp([
  String.raw`\btee\b`,
  String.raw`\bsed\b[^|;&]*\s-[a-zA-Z]*i`, String.raw`--in-place`,
  String.raw`\bperl\b[^|;&]*\s-[a-zA-Z]*i`,
  String.raw`\b(mv|cp|rm|rmdir|ln|touch|truncate|dd|install|rsync|chmod|unlink|patch)\b`,
  String.raw`\bgit\s+(checkout|restore|reset|stash|clean|mv|rm|apply|am|cherry-pick|revert|merge|rebase|pull)\b`,
  String.raw`\bnode\b[^|;&]*\s(-e|--eval|-p|--print)\b`,
  String.raw`\bpython3?\b[^|;&]*\s-c\b`,
  String.raw`\b(node|python3?|perl|ruby|bash|sh|zsh)\b[^|;&]*(\s-(\s|$)|<<)`,
  String.raw`\b(ex|vi|vim|nano)\b`,
].join("|"), "i");

// Strings whose presence in a Bash command means it reaches the hold-out dir (H2).
const HOLDOUT_WORDS = ["holdout-tests", "quant prep/holdout"];
// Below <root>/: L1 denies edits inside these dirs or to these files; L2 counts them as mentions.
const LOCKED_DIRS = ["tests", "scripts", ".claude"];
const LOCKED_FILES = ["e2e/v4.js", "e2e/run.js", "package.json"];
// Redirections that cannot write a file (§M6), removed before L2 looks for `>`.
const HARMLESS_REDIRECTS = [/\d*>&\d+/g, /&>\s*\/dev\/null/gi, /\d*>\s*\/dev\/null/gi];

const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const SEARCH_TOOLS = new Set(["Grep", "Glob"]);

const isText = (v) => typeof v === "string" && v.length > 0;

// Case-insensitive the way macOS APFS is (§M6 "Case"): APFS compares names after Unicode case
// folding and normalisation, so `teſts` (long s) and `teﬆs` (st ligature) open `tests`, and a
// command spelled `ſed -i` finds sed on PATH. toLowerCase alone misses those; upper-casing first
// folds them (ſ → S → s, ﬆ → ST → st). For ASCII this is plain toLowerCase.
const fold = (s) => String(s).normalize("NFC").toUpperCase().toLowerCase();

// A leading `~` (alone, or followed by `/`) becomes home; then resolve against base.
function resolveFrom(base, p, home) {
  let s = String(p);
  if (isText(home) && (s === "~" || s.startsWith("~/"))) s = home + s.slice(1);
  return path.posix.resolve(base, s);
}

// Equal to dir or below it, by whole path segments. Both are resolved and folded (see fold).
function isInside(p, dir) {
  if (dir === "/") return p.startsWith("/");
  return p === dir || p.startsWith(dir + "/");
}

// The command as the shell would spell its words: backslash escapes and quote marks removed.
// H2 checks both forms, so `Quant\ Prep/holdout` and `'Quant Prep'/holdout` count as mentions.
function unquoted(cmd) {
  return cmd.replace(/\\(.)/gs, "$1").replace(/["']/g, "");
}

function guardDecision(input, ctx = {}) {
  const home = isText(ctx.home) ? ctx.home : "";
  const root = path.posix.resolve(isText(ctx.root) ? ctx.root : "/");
  const lower = fold;
  const resolveLower = (p) => lower(resolveFrom(root, p, home));
  const rootL = lower(root);
  const holdoutL = resolveLower(isText(ctx.holdout) ? ctx.holdout : path.posix.join(home || "/", "Documents", "Quant Prep", "holdout-tests"));
  const homeL = lower(home);
  const allow = { deny: false };
  const deny = (reason) => ({ deny: true, reason });

  const tool = input && typeof input === "object" ? input.tool_name : undefined;
  const ti = input && typeof input === "object" && input.tool_input && typeof input.tool_input === "object" ? input.tool_input : {};
  const editPaths = [ti.file_path, ti.notebook_path].filter(isText);
  const command = typeof ti.command === "string" ? ti.command : "";

  // H1 (always): no tool may read, edit or search the hold-out dir.
  if (tool === "Read" || EDIT_TOOLS.has(tool)) {
    for (const p of editPaths) {
      if (isInside(resolveLower(p), holdoutL)) {
        return deny(`guard-locked H1: ${p} is inside the hold-out dir. Implementers never see hold-out tests (spec §11); a hold-out failure is fixed in the implementation, from the names test:holdout prints.`);
      }
    }
  }
  if (SEARCH_TOOLS.has(tool)) {
    const where = resolveLower(isText(ti.path) ? ti.path : root);
    if (isInside(where, holdoutL) || isInside(holdoutL, where)) {
      return deny(`guard-locked H1: ${tool} on ${ti.path || root} would search the hold-out dir. Search a narrower path (the repo, for example).`);
    }
    for (const t of [ti.pattern, ti.glob]) {
      if (isText(t) && lower(t).includes("holdout-tests")) {
        return deny(`guard-locked H1: ${tool} pattern ${JSON.stringify(t)} names the hold-out dir.`);
      }
    }
  }

  // H2 (always): Bash that names the hold-out dir, except a bare `npm run test:holdout`.
  if (tool === "Bash") {
    const forms = [lower(command), lower(unquoted(command))];
    const needles = [...HOLDOUT_WORDS, holdoutL];
    if (homeL && isInside(holdoutL, homeL) && holdoutL !== homeL) needles.push("~" + holdoutL.slice(homeL.length));
    const named = forms.some((f) => needles.some((n) => f.includes(n)));
    if (named && !HOLDOUT_ALLOW_RE.test(command)) {
      return deny("guard-locked H2: this command names the hold-out dir. The only allowed use is a bare `npm run test:holdout` (optionally with HOLDOUT_DIR=...), not chained with anything.");
    }
  }

  if (!ctx.locked) return allow;

  // L1 (locked): no edit tool may touch the locked files or the hook's own settings.
  if (EDIT_TOOLS.has(tool)) {
    for (const p of editPaths) {
      const r = resolveLower(p);
      const hit = LOCKED_DIRS.some((d) => isInside(r, `${rootL}/${d}`.replace(/^\/\//, "/")))
        || LOCKED_FILES.some((f) => r === `${rootL}/${f}`.replace(/^\/\//, "/"));
      if (hit) {
        return deny(`guard-locked L1: ${p} is locked (tests/LOCK.json exists). If a test is wrong, append a dispute to TEST-DISPUTES.md (§M4 format) and carry on with other work.`);
      }
    }
  }

  // A + L2 (locked): Bash that may write a locked path.
  if (tool === "Bash") {
    if (NPM_ALLOW_RE.test(command)) return allow;
    let cleaned = command;
    for (const re of HARMLESS_REDIRECTS) cleaned = cleaned.replace(re, "");
    const cl = lower(cleaned);
    const prefix = rootL === "/" ? "/" : rootL + "/";
    // The regexes run on the command and on its folded copy (see fold), so a folded spelling of
    // a locked path or a write verb still counts. For ASCII both give the same answer.
    const either = (re) => re.test(cleaned) || re.test(cl);
    const mentions = either(MENTION_RE) || [...LOCKED_DIRS, ...LOCKED_FILES].some((s) => cl.includes(prefix + s));
    if (mentions && (cleaned.includes(">") || either(WRITE_VERB_RE))) {
      return deny("guard-locked L2: this command mentions a locked path (tests/, scripts/, .claude/, e2e/v4.js, e2e/run.js or package.json) and may write (a `>` redirection or a write verb). Read and search with the Read and Grep tools; send test output to /tmp; file a dispute if a test is wrong.");
    }
  }
  return allow;
}

function expandHome(p, home) {
  return p === "~" || p.startsWith("~/") ? home + p.slice(1) : p;
}

function main(env = process.env) {
  const home = os.homedir();
  const root = path.resolve(env.AM_GUARD_ROOT || env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, ".."));
  const holdout = env.HOLDOUT_DIR
    ? path.resolve(expandHome(env.HOLDOUT_DIR, home))
    : path.join(home, "Documents", "Quant Prep", "holdout-tests");
  let input;
  try {
    input = JSON.parse(fs.readFileSync(0, "utf8"));
  } catch {
    input = undefined;
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    process.stderr.write("guard-locked: denied: the hook input on stdin is not a JSON object (the hook fails closed).\n");
    return 2;
  }
  const locked = fs.existsSync(path.join(root, "tests", "LOCK.json"));
  const r = guardDecision(input, { root, holdout, locked, home });
  if (r.deny) {
    process.stderr.write(r.reason + "\n");
    return 2;
  }
  return 0;
}

module.exports = { HOLDOUT_ALLOW_RE, NPM_ALLOW_RE, MENTION_RE, WRITE_VERB_RE, guardDecision, main };

if (require.main === module) process.exitCode = main();
