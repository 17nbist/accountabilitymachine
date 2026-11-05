// v4 static checks (V4-CONTRACTS §N8): assertions that already hold at Red, so they live here and
// not in a tests/v4-*.test.js file. They cover the fixture bank's file layout and JSON shape, the
// §L2 counts and coverage rules, the §L4 named items (Appendix A content), the "no PDF under
// tests/" rule, and the v3 regression of amWeeklyReviewTrigger without `prep` (§H8).
// This file needs no prep/ module: every constant below is restated from the contract so the
// checks stay independent of PrepBank. Run with `npm test`.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const P = require("../practice.js");

const FX_DIR = path.join(__dirname, "fixtures", "bank-mini");

// ---------- contract constants (restated from §A6 and §E2, not imported) ----------

const AREAS = ["probability", "brainteaser", "statistics", "finance", "cpp", "systems"];
const PRACTICE_AREAS = ["probability", "brainteaser", "statistics", "finance"];
const TYPES = ["numeric", "mcq", "free"];
const STATUSES = ["agreed", "corrected", "disputed", "unverified"];
const ORIGINS = ["source", "generated"];
const METHODS = ["blind", "blind+sim"];
const KEY_RE = /^[a-z0-9]{2,24}$/;
const ID_RE = /^([a-z0-9]{2,24})-([a-z0-9]+(?:-[a-z0-9]+)*)-([0-9a-f]{8})$/;
const TOPIC_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FILE_RE = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;
const FIXTURE_KEYS = ["fixture", "fixturecpp", "fixturesys", "fixturestats", "fixturefin"];
const FOLDER_LABELS = {
  "00-user-supplied": "User supplied",
  "01-probability": "Probability",
  "02-quant-interview": "Quant interview",
  "03-cpp": "C++",
  "04-systems-low-latency": "Systems & low latency",
  "05-coding-lists": "Coding lists",
};
const AREA_COUNTS = { // §L2: [min, max] per area
  probability: [10, 12], brainteaser: [5, 7], statistics: [4, 5],
  finance: [4, 5], cpp: [7, 9], systems: [7, 9],
};

// ---------- fixture readers ----------

const FILES = {
  readme: "README.md",
  bank: "bank.json",
  cpp: "decks/cpp.json",
  systems: "decks/systems.json",
  nc150: "lists/neetcode150.json",
  library: "library/index.json",
};

const jsonCache = new Map();
function readJson(rel) {
  if (!jsonCache.has(rel)) jsonCache.set(rel, JSON.parse(fs.readFileSync(path.join(FX_DIR, rel), "utf8")));
  return jsonCache.get(rel);
}
const bankJson = () => readJson(FILES.bank);
const cppDeck = () => readJson(FILES.cpp);
const systemsDeck = () => readJson(FILES.systems);
function itemFiles() {
  return [[FILES.bank, bankJson()], [FILES.cpp, cppDeck()], [FILES.systems, systemsDeck()]];
}
function fixtureItems() {
  return [...bankJson().items, ...cppDeck().items, ...systemsDeck().items];
}
const isObj = v => v !== null && typeof v === "object" && !Array.isArray(v);
const isNonEmptyStr = v => typeof v === "string" && v.length > 0;
const hasText = v => typeof v === "string" && v.trim().length > 0;
const count = (items, pred) => items.filter(pred).length;
const hasTopic = (it, t) => Array.isArray(it.topics) && it.topics.includes(t);

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

// ---------- 1. file layout (§L1) ----------

test("fixture layout: the six §L1 files exist under tests/fixtures/bank-mini/", () => {
  for (const rel of Object.values(FILES)) {
    const p = path.join(FX_DIR, rel);
    assert.ok(fs.existsSync(p) && fs.statSync(p).isFile(), `missing fixture file ${rel}`);
  }
});

test("fixture README states that the content is synthetic", () => {
  const txt = fs.readFileSync(path.join(FX_DIR, FILES.readme), "utf8");
  assert.match(txt, /synthetic/i);
});

test("no PDF exists anywhere under tests/", () => {
  const pdfs = walk(__dirname).filter(p => /\.pdf$/i.test(p)).map(p => path.relative(__dirname, p));
  assert.deepEqual(pdfs, []);
});

test("library/index.json references files that do not exist in the fixture", () => {
  const lib = readJson(FILES.library);
  const present = [];
  for (const c of lib.categories) {
    for (const e of c.entries) {
      if (fs.existsSync(path.join(FX_DIR, "library", e.file))) present.push(e.file);
    }
  }
  assert.deepEqual(present, []);
});

// ---------- 2. JSON shape (§E1, §E2, §L3) ----------

test("bank.json shape: version 1, an items array of practice-area items, optional ISO generated", () => {
  const b = bankJson();
  assert.ok(isObj(b));
  assert.equal(b.version, 1);
  assert.ok(Array.isArray(b.items) && b.items.length > 0);
  if (b.generated !== undefined) {
    assert.equal(typeof b.generated, "string");
    assert.match(b.generated, /^\d{4}-\d{2}-\d{2}/);
    assert.ok(!Number.isNaN(Date.parse(b.generated)), "generated must be an ISO 8601 date");
  }
  for (const it of b.items) {
    assert.ok(PRACTICE_AREAS.includes(it.area), `${it.id}: bank.json holds only practice areas, got ${it.area}`);
  }
});

test("deck shape: decks/cpp.json and decks/systems.json are version 1 decks whose items all have area = deck", () => {
  for (const [rel, deckName, deck] of [[FILES.cpp, "cpp", cppDeck()], [FILES.systems, "systems", systemsDeck()]]) {
    assert.ok(isObj(deck), rel);
    assert.equal(deck.version, 1, rel);
    assert.equal(deck.deck, deckName, rel);
    assert.ok(Array.isArray(deck.items) && deck.items.length > 0, rel);
    if (deck.generated !== undefined) {
      assert.equal(typeof deck.generated, "string", rel);
      assert.ok(!Number.isNaN(Date.parse(deck.generated)), `${rel}: generated must be an ISO 8601 date`);
    }
    for (const it of deck.items) assert.equal(it.area, deckName, `${rel}: ${it.id}`);
  }
});

test("every fixture item matches the §E2 item schema", () => {
  const bad = [];
  for (const [rel, f] of itemFiles()) {
    f.items.forEach((it, i) => {
      const who = `${rel}#${i} (${it && it.id})`;
      const no = field => bad.push(`${who}: ${field}`);
      if (!isObj(it)) { no("item"); return; }
      const src = it.source;
      const m = typeof it.id === "string" ? ID_RE.exec(it.id) : null;
      if (!m) no("id");
      if (!isObj(src)) no("source");
      else {
        if (!(typeof src.key === "string" && KEY_RE.test(src.key))) no("source.key");
        else if (m && m[1] !== src.key) no("id (key part must equal source.key)");
        if (!isNonEmptyStr(src.title)) no("source.title");
        if (!(typeof src.file === "string" && FILE_RE.test(src.file) && !src.file.split("/").includes(".."))) no("source.file");
        if (!(Number.isInteger(src.page) && src.page >= 1)) no("source.page");
      }
      if (!AREAS.includes(it.area)) no("area");
      if (!(Array.isArray(it.topics) && it.topics.length > 0 && it.topics.every(t => typeof t === "string" && TOPIC_RE.test(t)))) no("topics");
      if (!(Number.isInteger(it.difficulty) && it.difficulty >= 1 && it.difficulty <= 5)) no("difficulty");
      if (!TYPES.includes(it.type)) no("type");
      if (!hasText(it.prompt)) no("prompt");
      const a = it.answer;
      if (!isObj(a)) no("answer");
      else if (it.type === "numeric") {
        if (!hasText(a.value)) no("answer.value");
        if (a.tol !== undefined) {
          const okPart = v => v === undefined || (typeof v === "number" && Number.isFinite(v) && v >= 0);
          if (!(isObj(a.tol) && okPart(a.tol.rel) && okPart(a.tol.abs))) no("answer.tol");
        }
      } else if (it.type === "mcq") {
        const ch = a.choices;
        if (!(Array.isArray(ch) && ch.length >= 2 && ch.length <= 8 && ch.every(isNonEmptyStr))) no("answer.choices");
        else if (!(Number.isInteger(a.correct) && a.correct >= 0 && a.correct < ch.length)) no("answer.correct");
      } else if (it.type === "free") {
        if (!isNonEmptyStr(a.value)) no("answer.value");
      }
      if (!isNonEmptyStr(it.solution)) no("solution");
      if (!ORIGINS.includes(it.origin)) no("origin");
      const c = it.check;
      if (!isObj(c)) no("check");
      else {
        if (!STATUSES.includes(c.status)) no("check.status");
        if (c.method !== undefined && !METHODS.includes(c.method)) no("check.method");
        if (c.status === "corrected" || c.status === "disputed") {
          if (!isNonEmptyStr(c.printed)) no("check.printed");
          if (!isNonEmptyStr(c.resolved)) no("check.resolved");
        }
      }
    });
  }
  assert.deepEqual(bad, []);
});

test("fixture ids are unique across bank.json and both decks", () => {
  const seen = new Set();
  const dups = [];
  for (const it of fixtureItems()) {
    if (seen.has(it.id)) dups.push(it.id);
    seen.add(it.id);
  }
  assert.deepEqual(dups, []);
});

test("lists/neetcode150.json is the 12-problem synthetic list with the §L3 order, slugs, patterns and urls", () => {
  const l = readJson(FILES.nc150);
  const slugs = [
    "contains-duplicate", "valid-anagram", "two-sum", "group-anagrams",
    "valid-palindrome", "two-sum-ii-input-array-is-sorted", "3sum",
    "valid-parentheses", "min-stack", "evaluate-reverse-polish-notation",
    "binary-search", "search-a-2d-matrix",
  ];
  const patterns = [
    ...Array(4).fill("Arrays & Hashing"), ...Array(3).fill("Two Pointers"),
    ...Array(3).fill("Stack"), ...Array(2).fill("Binary Search"),
  ];
  assert.ok(isObj(l));
  assert.ok(hasText(l.source));
  assert.match(l.source, /synthetic/i);
  assert.equal(l.list, "neetcode150");
  assert.equal(l.count, 12);
  assert.ok(Array.isArray(l.problems));
  assert.equal(l.problems.length, 12);
  assert.deepEqual(l.problems.map(p => p.order), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.deepEqual(l.problems.map(p => p.slug), slugs);
  assert.deepEqual(l.problems.map(p => p.pattern), patterns);
  assert.deepEqual(l.problems.map(p => p.url), slugs.map(s => `https://leetcode.com/problems/${s}/`));
  for (const p of l.problems) {
    for (const k of ["problem", "difficulty", "leetcode_id"]) assert.ok(k in p, `${p.slug}: missing ${k}`);
  }
});

test("library/index.json shape: version 1, known folders with their labels in folder order, entries with file and title", () => {
  const lib = readJson(FILES.library);
  assert.ok(isObj(lib));
  assert.equal(lib.version, 1);
  assert.ok(Array.isArray(lib.categories) && lib.categories.length > 0);
  const folders = lib.categories.map(c => c.folder);
  for (let i = 1; i < folders.length; i++) assert.ok(folders[i - 1] < folders[i], `categories out of folder order: ${folders}`);
  for (const c of lib.categories) {
    assert.ok(Object.hasOwn(FOLDER_LABELS, c.folder), `unknown category folder ${c.folder}`);
    assert.equal(c.label, FOLDER_LABELS[c.folder]);
    assert.ok(Array.isArray(c.entries), c.folder);
    for (const e of c.entries) {
      assert.ok(isNonEmptyStr(e.file), `${c.folder}: entry file`);
      assert.ok(isNonEmptyStr(e.title), `${c.folder}: entry title for ${e.file}`);
      if (e.key !== undefined) assert.equal(typeof e.key, "string", `${c.folder}: entry key for ${e.file}`);
    }
  }
});

test("library/index.json lists the three named sources, every cited file, and an uncited fixture-empty.pdf", () => {
  const lib = readJson(FILES.library);
  const filesIn = folder => {
    const c = lib.categories.find(x => x.folder === folder);
    return c ? c.entries.map(e => e.file) : [];
  };
  assert.ok(filesIn("00-user-supplied").includes("fixture-notes.pdf"));
  assert.ok(filesIn("03-cpp").includes("fixture-cpp.pdf"));
  assert.ok(filesIn("04-systems-low-latency").includes("fixture-systems.pdf"));
  const listed = new Set(lib.categories.flatMap(c => c.entries.map(e => e.file)));
  const cited = new Set(fixtureItems().map(it => it.source.file));
  assert.deepEqual([...cited].filter(f => !listed.has(f)), [], "every cited file has a library entry");
  // §E1 / §L3 [decision, Red]: entry files carry no folder prefix, so the entry is exactly "fixture-empty.pdf".
  const entries = lib.categories.flatMap(c => c.entries.map(e => e.file));
  const empty = entries.filter(f => f === "fixture-empty.pdf");
  assert.equal(empty.length, 1, "exactly one fixture-empty.pdf entry");
  assert.ok(!cited.has(empty[0]), "no item cites fixture-empty.pdf");
});

// ---------- 3. §L2 counts and source rules ----------

test("§L2 counts: 37 to 44 items in total", () => {
  const n = fixtureItems().length;
  assert.ok(n >= 37 && n <= 44, `total items ${n}`);
});

test("§L2 counts: each area's item count is within its range", () => {
  const items = fixtureItems();
  for (const [area, [lo, hi]] of Object.entries(AREA_COUNTS)) {
    const n = count(items, it => it.area === area);
    assert.ok(n >= lo && n <= hi, `${area}: ${n} items, want ${lo} to ${hi}`);
  }
});

test("§L2 sources: keys are fixture keys and cited files are fixture-*.pdf", () => {
  const items = fixtureItems();
  const keys = new Set(items.map(it => it.source.key));
  for (const k of keys) assert.ok(FIXTURE_KEYS.includes(k), `unexpected source key ${k}`);
  for (const k of ["fixture", "fixturecpp", "fixturesys"]) assert.ok(keys.has(k), `source key ${k} unused`);
  for (const it of items) {
    const base = it.source.file.split("/").pop();
    assert.match(base, /^fixture-.+\.pdf$/, `${it.id}: ${it.source.file}`);
  }
});

// ---------- 4. §L2 coverage rules ----------

function missingPairs(items, xs, ys, fx, fy) {
  const have = new Set(items.map(it => `${fx(it)}|${fy(it)}`));
  const miss = [];
  for (const x of xs) for (const y of ys) if (!have.has(`${x}|${y}`)) miss.push(`${x}/${y}`);
  return miss;
}

test("coverage rule 1: every (area, type) pair has at least 1 item", () => {
  assert.deepEqual(missingPairs(fixtureItems(), AREAS, TYPES, it => it.area, it => it.type), []);
});

test("coverage rule 2: every (area, check.status) pair has at least 1 item", () => {
  assert.deepEqual(missingPairs(fixtureItems(), AREAS, STATUSES, it => it.area, it => it.check.status), []);
});

test("coverage rule 3: every (type, check.status) pair has at least 1 item", () => {
  assert.deepEqual(missingPairs(fixtureItems(), TYPES, STATUSES, it => it.type, it => it.check.status), []);
});

test("coverage rule 4: at least 3 probability items have topic conditional", () => {
  const n = count(fixtureItems(), it => it.area === "probability" && hasTopic(it, "conditional"));
  assert.ok(n >= 3, `${n} conditional probability items`);
});

test("coverage rule 5: at least 2 items have topic expected-value, at least one outside probability", () => {
  const ev = fixtureItems().filter(it => hasTopic(it, "expected-value"));
  assert.ok(ev.length >= 2, `${ev.length} expected-value items`);
  assert.ok(ev.some(it => it.area !== "probability"), "no expected-value item outside probability");
});

test("coverage rule 6: at least 2 cpp items have topic move-semantics", () => {
  const n = count(fixtureItems(), it => it.area === "cpp" && hasTopic(it, "move-semantics"));
  assert.ok(n >= 2, `${n} move-semantics cpp items`);
});

test("coverage rule 7: every difficulty from 1 to 5 appears at least once", () => {
  const ds = new Set(fixtureItems().map(it => it.difficulty));
  assert.deepEqual([1, 2, 3, 4, 5].filter(d => !ds.has(d)), []);
});

test("coverage rule 8: at least one numeric item has answer.tol", () => {
  assert.ok(fixtureItems().some(it => it.type === "numeric" && isObj(it.answer) && isObj(it.answer.tol)));
});

test("coverage rule 9: at least one item has origin source", () => {
  assert.ok(fixtureItems().some(it => it.origin === "source"));
});

// ---------- 5. §L4 named items (Appendix A content, exact) ----------

const NAMED = {
  FX_NUM_7_36: {
    id: "fixture-p3-q1-8c8ddb31",
    source: { key: "fixture", title: "Fixture Notes", file: "fixture-notes.pdf", page: 3 },
    area: "probability",
    topics: ["dice", "order-statistics"],
    difficulty: 2,
    type: "numeric",
    prompt: "Two fair six-sided dice are rolled. What is the probability that the larger of the two values is exactly $4$?",
    answer: { value: "7/36" },
    solution: "$P(\\max \\le 4) - P(\\max \\le 3) = \\frac{16}{36} - \\frac{9}{36} = \\frac{7}{36}$.",
    origin: "generated",
    check: { status: "agreed", method: "blind+sim" },
  },
  FX_NUM_INV_E: {
    id: "fixture-p4-q2-dd175c13",
    source: { key: "fixture", title: "Fixture Notes", file: "fixture-notes.pdf", page: 4 },
    area: "probability",
    topics: ["derangements", "limits"],
    difficulty: 3,
    type: "numeric",
    prompt: "A deck of $n$ distinct cards is shuffled uniformly at random. As $n \\to \\infty$, what is the limiting probability that no card is in its original position?",
    answer: { value: "1/e" },
    solution: "By inclusion-exclusion the probability is $\\sum_{k=0}^{n} (-1)^k / k!$, which tends to $e^{-1}$.",
    origin: "generated",
    check: { status: "corrected", printed: "1/2", resolved: "1/e", method: "blind", note: "The printed value is the n = 2 case." },
  },
  FX_MCQ_COINS: {
    id: "fixture-p5-q1-0a74e9b8",
    source: { key: "fixture", title: "Fixture Notes", file: "fixture-notes.pdf", page: 5 },
    area: "probability",
    topics: ["binomial", "coins"],
    difficulty: 1,
    type: "mcq",
    prompt: "A fair coin is flipped three times. What is the probability of exactly two heads?",
    answer: { choices: ["1/8", "1/4", "3/8", "1/2"], correct: 2 },
    solution: "$\\binom{3}{2} / 2^3 = 3/8$.",
    origin: "generated",
    check: { status: "unverified" },
  },
  FX_FREE_WEIGH: {
    id: "fixture-p7-q1-b7e30cef",
    source: { key: "fixture", title: "Fixture Notes", file: "fixture-notes.pdf", page: 7 },
    area: "brainteaser",
    topics: ["weighing", "information"],
    difficulty: 2,
    type: "free",
    prompt: "Nine coins look identical, but one is slightly heavier. Using a two-pan balance, what is the minimum number of weighings that guarantees finding the heavy coin? Explain your strategy.",
    answer: { value: "Two. Split the coins into three groups of three and weigh two groups against each other: the heavier pan, or the unweighed group if they balance, holds the heavy coin. Then weigh two coins from that group the same way." },
    solution: "Each weighing has three outcomes, so $k$ weighings distinguish at most $3^k$ cases. Since $3^2 = 9$, two weighings suffice and one does not.",
    origin: "generated",
    check: { status: "agreed", method: "blind" },
  },
  FX_NUM_DISPUTED: {
    id: "fixture-p8-q1-353ff247",
    source: { key: "fixture", title: "Fixture Notes", file: "fixture-notes.pdf", page: 8 },
    area: "probability",
    topics: ["conditional", "bayes"],
    difficulty: 2,
    type: "numeric",
    prompt: "A family has two children, and you learn that at least one of them is a boy. Assuming each child is independently a boy or a girl with probability $1/2$, what is the probability that both are boys?",
    answer: { value: "1/3" },
    solution: "Of the equally likely cases BB, BG, GB, GG, the condition leaves BB, BG, GB, so the answer is $1/3$.",
    origin: "generated",
    check: { status: "disputed", printed: "1/3", resolved: "1/2", method: "blind", note: "The re-solver read the condition as 'a specific child is a boy'." },
  },
  FX_NUM_EV: {
    id: "fixture-p9-q1-e9f1f9c4",
    source: { key: "fixture", title: "Fixture Notes", file: "fixture-notes.pdf", page: 9 },
    area: "probability",
    topics: ["expected-value", "dice"],
    difficulty: 2,
    type: "numeric",
    prompt: "Two fair six-sided dice are rolled. What is the expected value of the larger of the two values?",
    answer: { value: "161/36" },
    solution: "$E[\\max] = \\sum_{k=1}^{6} k \\cdot \\frac{2k-1}{36} = \\frac{161}{36}$.",
    origin: "generated",
    check: { status: "agreed", method: "blind+sim" },
  },
  FX_CPP_FREE_MOVE: {
    id: "fixturecpp-s2-c1-724197d7",
    source: { key: "fixturecpp", title: "Fixture C++ Notes", file: "fixture-cpp.pdf", page: 2 },
    area: "cpp",
    topics: ["move-semantics", "value-categories"],
    difficulty: 2,
    type: "free",
    prompt: "What does `std::move` actually do at run time?",
    answer: { value: "Nothing by itself: it is an unconditional cast to an rvalue reference (`static_cast<T&&>`). A move only happens if the result is then bound to a move constructor or move assignment operator." },
    solution: "`std::move` is a cast. Ownership transfer is done by the overload it selects, not by `std::move`.",
    origin: "generated",
    check: { status: "agreed", method: "blind" },
  },
  FX_CPP_NUM_SIZEOF: {
    id: "fixturecpp-s5-c1-6d654661",
    source: { key: "fixturecpp", title: "Fixture C++ Notes", file: "fixture-cpp.pdf", page: 5 },
    area: "cpp",
    topics: ["class-layout", "padding"],
    difficulty: 2,
    type: "numeric",
    prompt: "On x86-64 with the usual alignment rules, what is `sizeof(S)` for `struct S { char a; int b; char c; };`?",
    answer: { value: "12" },
    solution: "`a` at offset 0, 3 bytes padding, `b` at 4, `c` at 8, then 3 bytes tail padding to a multiple of 4: 12.",
    origin: "generated",
    check: { status: "agreed", method: "blind+sim" },
  },
  FX_SYS_MCQ_LINE: {
    id: "fixturesys-s4-c1-31442a11",
    source: { key: "fixturesys", title: "Fixture Systems Notes", file: "fixture-systems.pdf", page: 4 },
    area: "systems",
    topics: ["cache-hierarchy"],
    difficulty: 1,
    type: "mcq",
    prompt: "What is the cache line size on current mainstream x86-64 CPUs?",
    answer: { choices: ["16 bytes", "32 bytes", "64 bytes", "128 bytes"], correct: 2 },
    solution: "64 bytes on current Intel and AMD x86-64 cores.",
    origin: "generated",
    check: { status: "agreed", method: "blind" },
  },
  FX_SYS_FREE_FALSESHARING: {
    id: "fixturesys-s6-c1-b483ecba",
    source: { key: "fixturesys", title: "Fixture Systems Notes", file: "fixture-systems.pdf", page: 6 },
    area: "systems",
    topics: ["false-sharing", "cache-hierarchy"],
    difficulty: 2,
    type: "free",
    prompt: "What is false sharing, and how do you avoid it?",
    answer: { value: "Two threads write to different variables that sit on the same cache line, so the line bounces between cores under the coherence protocol. Avoid it by padding or aligning per-thread data to the cache line size, for example with `alignas(64)`." },
    solution: "Coherence works per cache line, not per variable, so independent writes to one line serialise.",
    origin: "generated",
    check: { status: "unverified" },
  },
};

// Appendix A: probability and brainteaser items live in bank.json, FX_CPP_* in decks/cpp.json,
// FX_SYS_* in decks/systems.json.
const namedFile = name =>
  name.startsWith("FX_CPP_") ? FILES.cpp : name.startsWith("FX_SYS_") ? FILES.systems : FILES.bank;

for (const [name, want] of Object.entries(NAMED)) {
  test(`§L4 named item ${name} is in ${namedFile(name)} with its exact Appendix A content`, () => {
    const hits = readJson(namedFile(name)).items.filter(it => it && it.id === want.id);
    assert.equal(hits.length, 1, `${want.id} must appear exactly once in ${namedFile(name)}`);
    assert.deepEqual(hits[0], want); // key order is free: deepStrictEqual ignores it
  });
}

// ---------- 6. §H8 v3 regression: amWeeklyReviewTrigger without prep ----------
// Expected strings are the literal v3.0.0 output (practice.js at commit 7a2fcb8).

const V3_FULL_IN = {
  week: { leetcode: 9, zetamac: 51, probability: 6, cpp: 0, project: 0, mock: 1 },
  streak: 12,
  zetamac: { last: [40, 44, 51], best: 51, count: 3 },
  medianMediumSecs: 23 * 60,
  resolveDebt: 3,
  checkpoint: { due: "2027-02-28", label: "~100 solved, typical medium in ~20 min", daysLeft: 116 },
  solvedTotal: 142,
};
const V3_FULL_OUT =
  "[Automatic Sunday weekly review — run it now. Week totals: LC 9 · Zetamac 51 · Prob 6 · C++ 0m · " +
  "Project 0m · Mock 1. Streak: 12 day(s). LeetCode total: 142 solved. Zetamac last games: 40 → 44 → 51 " +
  "(best 51, 3 games logged). Median Medium solve time: 23 min. Re-solve debt: 3 due. Next checkpoint: " +
  "2027-02-28 (116 days left) — ~100 solved, typical medium in ~20 min. Grade the week against the next " +
  "checkpoint honestly (on track / behind / ahead, and why), name the one thing to change next week, and " +
  "call update_plan if the plan itself needs adjusting. Then get me to commit to today's target. Keep it " +
  "under 8 sentences.]";

const V3_EMPTY_IN = {
  week: { leetcode: 0, zetamac: 0, probability: 0, cpp: 0, project: 0, mock: 0 },
  streak: 0, zetamac: { last: [], best: null, count: 0 }, medianMediumSecs: null,
  resolveDebt: 0, checkpoint: null, solvedTotal: null,
};
const V3_EMPTY_OUT =
  "[Automatic Sunday weekly review — run it now. Week totals: LC 0 · Zetamac 0 · Prob 0 · C++ 0m · " +
  "Project 0m · Mock 0. Streak: 0 day(s). Zetamac: no Zetamac games logged yet. Median Medium solve time: " +
  "no timed Medium solves yet. Re-solve debt: 0 due. Next checkpoint: no dated checkpoint left in the plan. " +
  "Grade the week against the next checkpoint honestly (on track / behind / ahead, and why), name the one " +
  "thing to change next week, and call update_plan if the plan itself needs adjusting. Then get me to " +
  "commit to today's target. Keep it under 8 sentences.]";

const V3_MIXED_IN = {
  week: { leetcode: 3, zetamac: 38, probability: 11, cpp: 95, project: 40, mock: 0 },
  streak: 1,
  zetamac: { last: [38], best: 45, count: 7 },
  medianMediumSecs: 1290,
  resolveDebt: 0,
  checkpoint: null,
  solvedTotal: 0,
};
const V3_MIXED_OUT =
  "[Automatic Sunday weekly review — run it now. Week totals: LC 3 · Zetamac 38 · Prob 11 · C++ 95m · " +
  "Project 40m · Mock 0. Streak: 1 day(s). LeetCode total: 0 solved. Zetamac last games: 38 (best 45, " +
  "7 games logged). Median Medium solve time: 22 min. Re-solve debt: 0 due. Next checkpoint: no dated " +
  "checkpoint left in the plan. Grade the week against the next checkpoint honestly (on track / behind / " +
  "ahead, and why), name the one thing to change next week, and call update_plan if the plan itself " +
  "needs adjusting. Then get me to commit to today's target. Keep it under 8 sentences.]";

test("§H8 v3 regression: amWeeklyReviewTrigger without prep is byte-identical to v3 (full week)", () => {
  assert.equal(P.amWeeklyReviewTrigger(V3_FULL_IN), V3_FULL_OUT);
});

test("§H8 v3 regression: amWeeklyReviewTrigger without prep is byte-identical to v3 (empty data)", () => {
  assert.equal(P.amWeeklyReviewTrigger(V3_EMPTY_IN), V3_EMPTY_OUT);
});

test("§H8 v3 regression: amWeeklyReviewTrigger without prep is byte-identical to v3 (zero totals, no checkpoint)", () => {
  assert.equal(P.amWeeklyReviewTrigger(V3_MIXED_IN), V3_MIXED_OUT);
});

test("§H8 v3 regression: prep undefined or an empty string also gives the v3 text", () => {
  for (const [input, out] of [[V3_FULL_IN, V3_FULL_OUT], [V3_EMPTY_IN, V3_EMPTY_OUT], [V3_MIXED_IN, V3_MIXED_OUT]]) {
    assert.equal(P.amWeeklyReviewTrigger({ ...input, prep: undefined }), out);
    assert.equal(P.amWeeklyReviewTrigger({ ...input, prep: "" }), out);
  }
});
