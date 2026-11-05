// v4 fixture bank (V4-CONTRACTS §L, §E3-§E5, Appendix A): the committed synthetic bank under
// tests/fixtures/bank-mini/ must be consistent with PrepBank. Only checks that call PrepBank live
// here (§N9). File layout, JSON shape, the §L2 counts and coverage rules, and the byte-for-byte
// Appendix A content are checked in tests/static.test.js, which needs no prep module (§N8).
// Run with `npm test` (Node's built-in runner).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const B = require("../prep/bank.js");

const FIXTURE_DIR = path.join(__dirname, "fixtures", "bank-mini");

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, rel), "utf8"));
}

// Fresh objects on every call, so no test can see another test's (or the module's) mutations.
function loadFixture() {
  const bank = readJson("bank.json");
  const cpp = readJson("decks/cpp.json");
  const systems = readJson("decks/systems.json");
  const library = readJson("library/index.json");
  const items = [...bank.items, ...cpp.items, ...systems.items];
  return { bank, cpp, systems, library, items };
}

function showErrors(r) {
  const errs = r && Array.isArray(r.errors) ? r.errors : [];
  return `bankValidate reported ${errs.length} error(s): ${JSON.stringify(errs.slice(0, 8))}`;
}

// ---------- independent oracles (§N4: never PrepBank's own helpers) ----------

// §E2 ID_RE, written out here: key (no hyphens), locator (kebab), 8 lowercase hex.
const ID_PARTS = /^([a-z0-9]{2,24})-([a-z0-9]+(?:-[a-z0-9]+)*)-([0-9a-f]{8})$/;

function splitId(id) {
  const m = typeof id === "string" ? ID_PARTS.exec(id) : null;
  return m ? { key: m[1], locator: m[2], hash: m[3] } : null;
}

// §E3: numeric and free hash answer.value; mcq hashes JSON.stringify(choices) + String(correct).
function oracleAnswerKey(item) {
  return item.type === "mcq"
    ? JSON.stringify(item.answer.choices) + String(item.answer.correct)
    : item.answer.value;
}

// §E3: first 8 hex of SHA-256 over the UTF-8 bytes of prompt + answerKey, no separator.
function oracleHash8(item) {
  return crypto.createHash("sha256")
    .update(item.prompt + oracleAnswerKey(item), "utf8")
    .digest("hex")
    .slice(0, 8);
}

// ---------- §L4 named items ----------

// Appendix A, exact content (synthetic, written for these tests).
const APPENDIX_A = {
  FX_NUM_7_36: {
    id: "fixture-p3-q1-8c8ddb31",
    source: {"key":"fixture","title":"Fixture Notes","file":"fixture-notes.pdf","page":3},
    area: "probability",
    topics: ["dice","order-statistics"],
    difficulty: 2,
    type: "numeric",
    prompt: "Two fair six-sided dice are rolled. What is the probability that the larger of the two values is exactly $4$?",
    answer: {"value":"7/36"},
    solution: "$P(\\max \\le 4) - P(\\max \\le 3) = \\frac{16}{36} - \\frac{9}{36} = \\frac{7}{36}$.",
    origin: "generated",
    check: {"status":"agreed","method":"blind+sim"},
  },
  FX_NUM_INV_E: {
    id: "fixture-p4-q2-dd175c13",
    source: {"key":"fixture","title":"Fixture Notes","file":"fixture-notes.pdf","page":4},
    area: "probability",
    topics: ["derangements","limits"],
    difficulty: 3,
    type: "numeric",
    prompt: "A deck of $n$ distinct cards is shuffled uniformly at random. As $n \\to \\infty$, what is the limiting probability that no card is in its original position?",
    answer: {"value":"1/e"},
    solution: "By inclusion-exclusion the probability is $\\sum_{k=0}^{n} (-1)^k / k!$, which tends to $e^{-1}$.",
    origin: "generated",
    check: {"status":"corrected","printed":"1/2","resolved":"1/e","method":"blind","note":"The printed value is the n = 2 case."},
  },
  FX_MCQ_COINS: {
    id: "fixture-p5-q1-0a74e9b8",
    source: {"key":"fixture","title":"Fixture Notes","file":"fixture-notes.pdf","page":5},
    area: "probability",
    topics: ["binomial","coins"],
    difficulty: 1,
    type: "mcq",
    prompt: "A fair coin is flipped three times. What is the probability of exactly two heads?",
    answer: {"choices":["1/8","1/4","3/8","1/2"],"correct":2},
    solution: "$\\binom{3}{2} / 2^3 = 3/8$.",
    origin: "generated",
    check: {"status":"unverified"},
  },
  FX_FREE_WEIGH: {
    id: "fixture-p7-q1-b7e30cef",
    source: {"key":"fixture","title":"Fixture Notes","file":"fixture-notes.pdf","page":7},
    area: "brainteaser",
    topics: ["weighing","information"],
    difficulty: 2,
    type: "free",
    prompt: "Nine coins look identical, but one is slightly heavier. Using a two-pan balance, what is the minimum number of weighings that guarantees finding the heavy coin? Explain your strategy.",
    answer: {"value":"Two. Split the coins into three groups of three and weigh two groups against each other: the heavier pan, or the unweighed group if they balance, holds the heavy coin. Then weigh two coins from that group the same way."},
    solution: "Each weighing has three outcomes, so $k$ weighings distinguish at most $3^k$ cases. Since $3^2 = 9$, two weighings suffice and one does not.",
    origin: "generated",
    check: {"status":"agreed","method":"blind"},
  },
  FX_NUM_DISPUTED: {
    id: "fixture-p8-q1-353ff247",
    source: {"key":"fixture","title":"Fixture Notes","file":"fixture-notes.pdf","page":8},
    area: "probability",
    topics: ["conditional","bayes"],
    difficulty: 2,
    type: "numeric",
    prompt: "A family has two children, and you learn that at least one of them is a boy. Assuming each child is independently a boy or a girl with probability $1/2$, what is the probability that both are boys?",
    answer: {"value":"1/3"},
    solution: "Of the equally likely cases BB, BG, GB, GG, the condition leaves BB, BG, GB, so the answer is $1/3$.",
    origin: "generated",
    check: {"status":"disputed","printed":"1/3","resolved":"1/2","method":"blind","note":"The re-solver read the condition as 'a specific child is a boy'."},
  },
  FX_NUM_EV: {
    id: "fixture-p9-q1-e9f1f9c4",
    source: {"key":"fixture","title":"Fixture Notes","file":"fixture-notes.pdf","page":9},
    area: "probability",
    topics: ["expected-value","dice"],
    difficulty: 2,
    type: "numeric",
    prompt: "Two fair six-sided dice are rolled. What is the expected value of the larger of the two values?",
    answer: {"value":"161/36"},
    solution: "$E[\\max] = \\sum_{k=1}^{6} k \\cdot \\frac{2k-1}{36} = \\frac{161}{36}$.",
    origin: "generated",
    check: {"status":"agreed","method":"blind+sim"},
  },
  FX_CPP_FREE_MOVE: {
    id: "fixturecpp-s2-c1-724197d7",
    source: {"key":"fixturecpp","title":"Fixture C++ Notes","file":"fixture-cpp.pdf","page":2},
    area: "cpp",
    topics: ["move-semantics","value-categories"],
    difficulty: 2,
    type: "free",
    prompt: "What does `std::move` actually do at run time?",
    answer: {"value":"Nothing by itself: it is an unconditional cast to an rvalue reference (`static_cast<T&&>`). A move only happens if the result is then bound to a move constructor or move assignment operator."},
    solution: "`std::move` is a cast. Ownership transfer is done by the overload it selects, not by `std::move`.",
    origin: "generated",
    check: {"status":"agreed","method":"blind"},
  },
  FX_CPP_NUM_SIZEOF: {
    id: "fixturecpp-s5-c1-6d654661",
    source: {"key":"fixturecpp","title":"Fixture C++ Notes","file":"fixture-cpp.pdf","page":5},
    area: "cpp",
    topics: ["class-layout","padding"],
    difficulty: 2,
    type: "numeric",
    prompt: "On x86-64 with the usual alignment rules, what is `sizeof(S)` for `struct S { char a; int b; char c; };`?",
    answer: {"value":"12"},
    solution: "`a` at offset 0, 3 bytes padding, `b` at 4, `c` at 8, then 3 bytes tail padding to a multiple of 4: 12.",
    origin: "generated",
    check: {"status":"agreed","method":"blind+sim"},
  },
  FX_SYS_MCQ_LINE: {
    id: "fixturesys-s4-c1-31442a11",
    source: {"key":"fixturesys","title":"Fixture Systems Notes","file":"fixture-systems.pdf","page":4},
    area: "systems",
    topics: ["cache-hierarchy"],
    difficulty: 1,
    type: "mcq",
    prompt: "What is the cache line size on current mainstream x86-64 CPUs?",
    answer: {"choices":["16 bytes","32 bytes","64 bytes","128 bytes"],"correct":2},
    solution: "64 bytes on current Intel and AMD x86-64 cores.",
    origin: "generated",
    check: {"status":"agreed","method":"blind"},
  },
  FX_SYS_FREE_FALSESHARING: {
    id: "fixturesys-s6-c1-b483ecba",
    source: {"key":"fixturesys","title":"Fixture Systems Notes","file":"fixture-systems.pdf","page":6},
    area: "systems",
    topics: ["false-sharing","cache-hierarchy"],
    difficulty: 2,
    type: "free",
    prompt: "What is false sharing, and how do you avoid it?",
    answer: {"value":"Two threads write to different variables that sit on the same cache line, so the line bounces between cores under the coherence protocol. Avoid it by padding or aligning per-thread data to the cache line size, for example with `alignas(64)`."},
    solution: "Coherence works per cache line, not per variable, so independent writes to one line serialise.",
    origin: "generated",
    check: {"status":"unverified"},
  },
};

// §L4 table: fixed id, the key and locator it was built from, the file that holds it (Appendix A
// preamble), and the listed area / type / status.
const NAMED = [
  { name: "FX_NUM_7_36", id: "fixture-p3-q1-8c8ddb31", key: "fixture", locator: "p3-q1",
    file: "bank", area: "probability", type: "numeric", status: "agreed" },
  { name: "FX_NUM_INV_E", id: "fixture-p4-q2-dd175c13", key: "fixture", locator: "p4-q2",
    file: "bank", area: "probability", type: "numeric", status: "corrected" },
  { name: "FX_MCQ_COINS", id: "fixture-p5-q1-0a74e9b8", key: "fixture", locator: "p5-q1",
    file: "bank", area: "probability", type: "mcq", status: "unverified" },
  { name: "FX_FREE_WEIGH", id: "fixture-p7-q1-b7e30cef", key: "fixture", locator: "p7-q1",
    file: "bank", area: "brainteaser", type: "free", status: "agreed" },
  { name: "FX_NUM_DISPUTED", id: "fixture-p8-q1-353ff247", key: "fixture", locator: "p8-q1",
    file: "bank", area: "probability", type: "numeric", status: "disputed" },
  { name: "FX_NUM_EV", id: "fixture-p9-q1-e9f1f9c4", key: "fixture", locator: "p9-q1",
    file: "bank", area: "probability", type: "numeric", status: "agreed" },
  { name: "FX_CPP_FREE_MOVE", id: "fixturecpp-s2-c1-724197d7", key: "fixturecpp", locator: "s2-c1",
    file: "cpp", area: "cpp", type: "free", status: "agreed" },
  { name: "FX_CPP_NUM_SIZEOF", id: "fixturecpp-s5-c1-6d654661", key: "fixturecpp", locator: "s5-c1",
    file: "cpp", area: "cpp", type: "numeric", status: "agreed" },
  { name: "FX_SYS_MCQ_LINE", id: "fixturesys-s4-c1-31442a11", key: "fixturesys", locator: "s4-c1",
    file: "systems", area: "systems", type: "mcq", status: "agreed" },
  { name: "FX_SYS_FREE_FALSESHARING", id: "fixturesys-s6-c1-b483ecba", key: "fixturesys",
    locator: "s6-c1", file: "systems", area: "systems", type: "free", status: "unverified" },
];

// ---------- 1. the whole fixture passes bankValidate ----------

test("§L2 whole fixture passes bankValidate: allItems(bank, [cpp, systems]) gives ok and 0 errors", () => {
  const { bank, cpp, systems } = loadFixture();
  const merged = B.allItems(bank, [cpp, systems]);
  assert.equal(merged.length, bank.items.length + cpp.items.length + systems.items.length);
  assert.ok(merged.length >= 37, `the fixture must hold 37 to 44 items (§L2), found ${merged.length}`);
  const r = B.bankValidate({ items: merged });
  assert.equal(r.ok, true, showErrors(r));
  assert.deepEqual(r.errors, [], showErrors(r));
});

test("§L2 whole fixture passes bankValidate: the loader's inline merge of all three files is valid too", () => {
  // §E6 builds items inline with flatMap; validating that array must not depend on allItems.
  const { bank, cpp, systems } = loadFixture();
  const items = [bank, cpp, systems].flatMap((f) => (f && Array.isArray(f.items) ? f.items : []));
  const r = B.bankValidate({ items });
  assert.equal(r.ok, true, showErrors(r));
  assert.deepEqual(r.errors, [], showErrors(r));
});

test("§E4 bank.json, decks/cpp.json and decks/systems.json each pass bankValidate on their own", () => {
  const { bank, cpp, systems } = loadFixture();
  const files = { "bank.json": bank, "decks/cpp.json": cpp, "decks/systems.json": systems };
  for (const [name, file] of Object.entries(files)) {
    assert.ok(Array.isArray(file.items) && file.items.length > 0, `${name} has no items`);
    const r = B.bankValidate(file);
    assert.equal(r.ok, true, `${name}: ${showErrors(r)}`);
    assert.deepEqual(r.errors, [], `${name}: ${showErrors(r)}`);
  }
});

test("§A3 bankValidate on the fixture mutates nothing and is deterministic", () => {
  const { items } = loadFixture();
  const input = { items };
  const snapshot = structuredClone(input);
  const first = B.bankValidate(input);
  assert.deepEqual(input, snapshot);
  const second = B.bankValidate(structuredClone(snapshot));
  assert.deepEqual(second, first);
  assert.equal(first.ok, true, showErrors(first));
});

// ---------- 2. every id is makeId of its content ----------

test("§L2 every fixture id equals makeId(source.key, locator, item) of its own content", () => {
  const { items } = loadFixture();
  assert.ok(items.length > 0);
  for (const item of items) {
    const parts = splitId(item.id);
    assert.ok(parts, `${JSON.stringify(item.id)} is not <key>-<locator>-<hash8>`);
    assert.equal(parts.key, item.source.key, `${item.id}: key part must equal source.key`);
    assert.equal(parts.hash, oracleHash8(item), `${item.id}: hash part is not sha256(prompt + answerKey)`);
    assert.equal(B.makeId(item.source.key, parts.locator, item), item.id);
  }
});

test("§E3 answerKey, hash8 and sha256Hex agree with an independent SHA-256 on every fixture item", () => {
  const { items } = loadFixture();
  for (const item of items) {
    const key = oracleAnswerKey(item);
    assert.equal(B.answerKey(item), key, `${item.id}: answerKey`);
    const full = crypto.createHash("sha256").update(item.prompt + key, "utf8").digest("hex");
    assert.equal(B.sha256Hex(item.prompt + key), full, `${item.id}: sha256Hex`);
    assert.equal(B.hash8(item), full.slice(0, 8), `${item.id}: hash8`);
  }
});

test("§E3 parseId splits every fixture id into its key, locator and hash, and ID_RE matches it", () => {
  const { items } = loadFixture();
  for (const item of items) {
    const want = splitId(item.id);
    assert.ok(want, `${JSON.stringify(item.id)} is not a valid id`);
    assert.match(item.id, B.ID_RE);
    const got = B.parseId(item.id);
    assert.ok(got, `parseId(${item.id}) returned ${got}`);
    assert.equal(got.key, want.key);
    assert.equal(got.locator, want.locator);
    assert.equal(got.hash, want.hash);
  }
});

test("§E4 fixture ids are unique across bank.json and both decks", () => {
  const { items } = loadFixture();
  const ids = items.map((it) => it.id);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  assert.deepEqual(dupes, []);
  assert.equal(Object.keys(B.indexById(items)).length, items.length);
});

test("§E3 fixture ids are stable: key order and fields outside prompt and answer do not change makeId", () => {
  const { items } = loadFixture();
  for (const item of items) {
    const { locator } = splitId(item.id);
    const other = Object.fromEntries(Object.entries(structuredClone(item)).reverse());
    other.answer = Object.fromEntries(Object.entries(other.answer).reverse());
    delete other.id;
    other.solution = `${other.solution} (edited)`;
    other.topics = ["edited-topic"];
    other.origin = other.origin === "source" ? "generated" : "source";
    other.check = { status: "unverified" };
    other.source = { ...other.source, title: "Another title", page: other.source.page + 1 };
    assert.equal(B.makeId(item.source.key, locator, other), item.id, `${item.id}: id changed`);
  }
});

test("§E3 rewording a fixture item's prompt or changing its answer gives it a new id", () => {
  const { items } = loadFixture();
  for (const item of items) {
    const { key, locator } = splitId(item.id);
    const reworded = { ...item, prompt: `${item.prompt} ` };
    // The changed answer stays well formed (a numeric "<expr>+1" still parses), so this does not
    // depend on whether makeId tolerates an invalid answer.
    const answer = item.type === "mcq"
      ? { ...item.answer, correct: (item.answer.correct + 1) % item.answer.choices.length }
      : item.type === "numeric"
        ? { ...item.answer, value: `${item.answer.value}+1` }
        : { ...item.answer, value: `${item.answer.value} (edited)` };
    const reanswered = { ...item, answer };
    for (const changed of [reworded, reanswered]) {
      const id = B.makeId(key, locator, changed);
      assert.equal(id, `${key}-${locator}-${oracleHash8(changed)}`);
      assert.notEqual(id, item.id, `${item.id}: changed content kept the old id`);
    }
  }
});

// ---------- 3. the §L4 named ids ----------

test("§L4 named ids: makeId of the Appendix A content gives each fixed id", () => {
  assert.equal(NAMED.length, 10);
  for (const n of NAMED) {
    const item = structuredClone(APPENDIX_A[n.name]);
    assert.equal(item.id, n.id, `${n.name}: table and Appendix A disagree`);
    assert.equal(oracleHash8(item), n.id.slice(-8), `${n.name}: embedded copy differs from Appendix A`);
    assert.equal(B.hash8(item), n.id.slice(-8), n.name);
    assert.equal(B.makeId(n.key, n.locator, item), n.id, n.name);
  }
});

test("§L4 named ids: the ten Appendix A items pass bankValidate", () => {
  const r = B.bankValidate({ items: structuredClone(Object.values(APPENDIX_A)) });
  assert.equal(r.ok, true, showErrors(r));
  assert.deepEqual(r.errors, [], showErrors(r));
});

test("§L4 named ids: each named item is in its file under its fixed id, which makeId reproduces", () => {
  const fixture = loadFixture();
  for (const n of NAMED) {
    const item = B.indexById(fixture[n.file])[n.id];
    assert.ok(item, `${n.name} (${n.id}) is missing from ${n.file}`);
    assert.equal(item.id, n.id);
    assert.equal(item.area, n.area, `${n.name}: area`);
    assert.equal(item.type, n.type, `${n.name}: type`);
    assert.equal(item.check.status, n.status, `${n.name}: check.status`);
    assert.equal(B.makeId(n.key, n.locator, item), n.id, `${n.name}: content does not hash to its id`);
    assert.equal(B.makeId(n.key, n.locator, item), B.makeId(n.key, n.locator, APPENDIX_A[n.name]));
  }
});

test("§L4 named ids: indexById over the merged fixture finds all ten", () => {
  const { bank, cpp, systems } = loadFixture();
  const byId = B.indexById(B.allItems(bank, [cpp, systems]));
  for (const n of NAMED) {
    assert.ok(byId[n.id], `${n.name} (${n.id}) not found`);
    assert.equal(byId[n.id].id, n.id);
  }
});

test("§E3 FX_NUM_INV_E: a corrected item's id covers the resolved answer, not the printed one", () => {
  const { items } = loadFixture();
  const item = B.indexById(items)["fixture-p4-q2-dd175c13"];
  assert.ok(item, "FX_NUM_INV_E missing");
  assert.equal(item.check.status, "corrected");
  assert.equal(item.answer.value, item.check.resolved);
  assert.equal(B.makeId("fixture", "p4-q2", item), "fixture-p4-q2-dd175c13");
  const asPrinted = { ...item, answer: { ...item.answer, value: item.check.printed } };
  const printedId = B.makeId("fixture", "p4-q2", asPrinted);
  assert.equal(printedId, `fixture-p4-q2-${oracleHash8(asPrinted)}`);
  assert.notEqual(printedId, item.id);
});

// ---------- 4. library counts ----------

test("§L3 sourceCounts over the fixture counts every cited library file and gives fixture-empty.pdf 0", () => {
  const { items, library } = loadFixture();
  const want = {};
  for (const it of items) want[it.source.file] = (want[it.source.file] || 0) + 1;
  for (const counts of [B.sourceCounts(items), B.sourceCounts({ items })]) {
    for (const [file, n] of Object.entries(want)) assert.equal(counts[file], n, file);
    for (const [file, n] of Object.entries(counts)) {
      if (!Object.hasOwn(want, file)) assert.equal(n, 0, `${file} is cited by no item`);
    }
    assert.equal(counts["fixture-empty.pdf"] || 0, 0);
  }
  const libraryFiles = new Set(library.categories.flatMap((c) => c.entries.map((e) => e.file)));
  assert.ok(libraryFiles.has("fixture-empty.pdf"), "library/index.json lacks fixture-empty.pdf");
  for (const file of Object.keys(B.sourceCounts(items))) {
    assert.ok(libraryFiles.has(file), `${file} is cited but not listed in library/index.json`);
  }
});
