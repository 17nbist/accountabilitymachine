// v4 prep/bank.js (PrepBank): schema constants, sha256 / hash8 / ids, the bank validator and
// the loader helpers. Contract: V4-CONTRACTS.md §E (all) and §C1 (numeric answer.value must
// parse); spec §3 F1.1 and F1.4.
//
// Oracles: hashes and ids are computed in this file with node:crypto from the §E3 text
// (sha256 of prompt + answer key, UTF-8, no separator), never with PrepBank's own helpers.
// Validator assertions follow §N7: `ok` and `errors.length === 0` for valid input, and
// `errors.some(e => e.id === … && e.field === …)` for invalid input. Error messages are only
// matched against the keywords §E4 lists (`hash`, `duplicate`).
//
// Every item below is synthetic, written for these tests. The fixture bank's own checks live
// in tests/v4-fixture.test.js.
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const B = require("../prep/bank.js");

// ---------- independent oracles (§E3) ----------

const sha = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");
const keyOf = (it) =>
  it.type === "mcq" ? JSON.stringify(it.answer.choices) + String(it.answer.correct) : it.answer.value;
const h8 = (it) => sha(it.prompt + keyOf(it)).slice(0, 8);
const idFor = (key, loc, it) => `${key}-${loc}-${h8(it)}`;
const clone = (x) => structuredClone(x);
const plain = (o) => ({ ...o }); // compare object maps without caring about their prototype

// ---------- synthetic items ----------

function withId(item, loc) {
  item.id = idFor(item.source.key, loc, item);
  return item;
}

function numItem() {
  return withId({
    source: { key: "mynotes", title: "My Notes", file: "00-user-supplied/my-notes.pdf", page: 12 },
    area: "probability",
    topics: ["dice", "divisibility"],
    difficulty: 2,
    type: "numeric",
    prompt: "A fair six-sided die is rolled once. What is the probability that the result is a multiple of $3$?",
    answer: { value: "1/3" },
    solution: "Two of the six faces, $3$ and $6$, qualify, so the probability is $2/6 = 1/3$.",
    origin: "generated",
    check: { status: "agreed", method: "blind+sim" },
  }, "p12-q1");
}

function mcqItem() {
  return withId({
    source: { key: "mynotes", title: "My Notes", file: "00-user-supplied/my-notes.pdf", page: 13 },
    area: "statistics",
    topics: ["median", "summary-statistics"],
    difficulty: 1,
    type: "mcq",
    prompt: "What is the median of the data set $\\{1, 2, 9\\}$?",
    answer: { choices: ["1", "2", "4", "9"], correct: 1 },
    solution: "Sorted, the middle value is $2$. (The mean is $4$.)",
    origin: "generated",
    check: { status: "unverified" },
  }, "p13-q2");
}

function freeItem() {
  return withId({
    source: { key: "puzzles", title: "Puzzle Sheet", file: "02-quant-interview/puzzle-sheet.pdf", page: 2 },
    area: "brainteaser",
    topics: ["parity"],
    difficulty: 2,
    type: "free",
    prompt: "Show that the sum of any two odd integers is even.",
    answer: { value: "Write them as $2a+1$ and $2b+1$. Their sum is $2(a+b+1)$, a multiple of $2$." },
    solution: "Each odd number is one more than an even number, so the two extra ones add to $2$.",
    origin: "source",
    check: { status: "agreed", method: "blind" },
  }, "sp3-q4b");
}

function cppItem() {
  return withId({
    source: { key: "cppnotes", title: "C++ Notes", file: "03-cpp/cpp-notes.pdf", page: 4 },
    area: "cpp",
    topics: ["noexcept", "exceptions"],
    difficulty: 3,
    type: "free",
    prompt: "What does marking a function `noexcept` promise, and what happens if an exception escapes it anyway?",
    answer: { value: "It promises that no exception leaves the function. If one does, `std::terminate` is called instead of unwinding into the caller." },
    solution: "The exception reaches the `noexcept` boundary at run time and the program terminates.",
    origin: "generated",
    check: { status: "agreed", method: "blind" },
  }, "s4-c1");
}

function sysItem() {
  return withId({
    source: { key: "sysslides", title: "Systems Slides", file: "04-systems-low-latency/sys-slides.pdf", page: 1 },
    area: "systems",
    topics: ["memory", "paging"],
    difficulty: 1,
    type: "numeric",
    prompt: "How many bytes are in a $4$ KiB page?",
    answer: { value: "4*1024", tol: { abs: 0 } },
    solution: "One KiB is $1024$ bytes, so $4 \\times 1024 = 4096$.",
    origin: "generated",
    check: { status: "unverified" },
  }, "s1-c3");
}

function finItem() {
  return withId({
    source: { key: "finnotes", title: "Finance Notes", file: "02-quant-interview/fin-notes.pdf", page: 7 },
    area: "finance",
    topics: ["returns"],
    difficulty: 4,
    type: "numeric",
    prompt: "An asset bought for $100$ is sold one year later for $105$, with no other cash flows. What is the simple one-year return?",
    answer: { value: "5%", tol: { rel: 1e-6 } },
    solution: "$(105 - 100) / 100 = 0.05$.",
    origin: "source",
    check: { status: "corrected", printed: "0.5%", resolved: "5%", method: "blind", note: "The printed value drops a factor of ten." },
  }, "p7-q1");
}

function disputedItem() {
  return withId({
    source: { key: "statnotes", title: "Stats Notes", file: "01-probability/stat-notes.pdf", page: 20 },
    area: "statistics",
    topics: ["variance", "sample-statistics"],
    difficulty: 5,
    type: "numeric",
    prompt: "The sample $2, 4, 6, 8$ is drawn. What is its sample variance with the $n - 1$ divisor?",
    answer: { value: "20/3" },
    solution: "The mean is $5$ and the squared deviations sum to $20$, so the variance is $20/3$.",
    origin: "generated",
    check: { status: "disputed", printed: "20/3", resolved: "5", method: "blind+sim", note: "The re-solver used the n divisor." },
  }, "p20-q1");
}

const validItems = () => [numItem(), mcqItem(), freeItem(), cppItem(), sysItem(), finItem(), disputedItem()];

// The item's own id if it is a non-empty string, else "#<index>" (§E4).
const errId = (item, index) => (typeof item.id === "string" && item.id.length > 0 ? item.id : `#${index}`);

function hasError(r, id, field, kw) {
  return r.errors.some((e) => e.id === id && e.field === field && (!kw || kw.test(e.msg)));
}

// Validate a one-item bank and require an error on `field` for that item.
function expectFieldError(item, field, what) {
  const r = B.bankValidate({ items: [item] });
  assert.equal(r.ok, false, `${what}: expected ok false`);
  assert.ok(hasError(r, errId(item, 0), field),
    `${what}: expected an error on ${field}; got ${JSON.stringify(r.errors)}`);
}

// A clean result: ok true and an empty errors array. Only { ok, errors } are asserted, so a
// result object that carries extra keys still passes (§E4 does not forbid them).
function assertClean(r, what) {
  assert.deepEqual(r.errors, [], `${what}: expected no errors`);
  assert.equal(r.ok, true, what);
}

function expectValid(items, what) {
  assertClean(B.bankValidate({ items }), what);
}

const FIELDS = [
  "items", "id", "source", "source.key", "source.title", "source.file", "source.page", "area",
  "topics", "difficulty", "type", "prompt", "answer", "answer.value", "answer.tol",
  "answer.choices", "answer.correct", "solution", "origin", "check", "check.status",
  "check.method", "check.printed", "check.resolved",
];

// ---------- 1. schema constants (§E2, §A6) ----------

test("AREAS, PRACTICE_AREAS and CARD_AREAS are the fixed area lists in schema order", () => {
  assert.deepEqual(B.AREAS, ["probability", "brainteaser", "statistics", "finance", "cpp", "systems"]);
  assert.deepEqual(B.PRACTICE_AREAS, ["probability", "brainteaser", "statistics", "finance"]);
  assert.deepEqual(B.CARD_AREAS, ["cpp", "systems"]);
});

test("TYPES, STATUSES, ORIGINS and METHODS are the fixed enum lists", () => {
  assert.deepEqual(B.TYPES, ["numeric", "mcq", "free"]);
  assert.deepEqual(B.STATUSES, ["agreed", "corrected", "disputed", "unverified"]);
  assert.deepEqual(B.ORIGINS, ["source", "generated"]);
  assert.deepEqual(B.METHODS, ["blind", "blind+sim"]);
});

test("KEY_RE accepts 2 to 24 lowercase letters and digits, with no hyphens", () => {
  assert.ok(B.KEY_RE instanceof RegExp);
  for (const ok of ["ab", "greenbook", "fixture", "fixturecpp", "a1b2", "x".repeat(24)]) {
    assert.equal(B.KEY_RE.test(ok), true, ok);
  }
  for (const bad of ["", "a", "x".repeat(25), "green-book", "GreenBook", "green_book", "my notes", "café"]) {
    assert.equal(B.KEY_RE.test(bad), false, bad);
  }
});

test("LOCATOR_RE and TOPIC_RE accept lowercase-kebab only", () => {
  assert.ok(B.LOCATOR_RE instanceof RegExp);
  assert.ok(B.TOPIC_RE instanceof RegExp);
  for (const ok of ["p37-q2", "sp3-q4b", "s12-c1", "p1", "ch2-ex10-b"]) {
    assert.equal(B.LOCATOR_RE.test(ok), true, ok);
  }
  for (const ok of ["conditional", "order-statistics", "move-semantics", "2d", "x"]) {
    assert.equal(B.TOPIC_RE.test(ok), true, ok);
  }
  for (const bad of ["", "-p1", "p1-", "p1--q2", "P1", "p1_q2", "p1 q2", "p1.q2"]) {
    assert.equal(B.LOCATOR_RE.test(bad), false, `locator ${bad}`);
  }
  for (const bad of ["", "Bayes", "two words", "snake_case", "-x", "x-", "a--b", "x/y"]) {
    assert.equal(B.TOPIC_RE.test(bad), false, `topic ${bad}`);
  }
});

test("ID_RE splits an id into key, locator and an 8-hex-digit hash", () => {
  assert.ok(B.ID_RE instanceof RegExp);
  const m = B.ID_RE.exec("fixture-p3-q1-8c8ddb31");
  assert.ok(m);
  assert.equal(m[1], "fixture");
  assert.equal(m[2], "p3-q1");
  assert.equal(m[3], "8c8ddb31");
  const m2 = B.ID_RE.exec("abc-def-12345678-9abcdef0");
  assert.ok(m2);
  assert.deepEqual([m2[1], m2[2], m2[3]], ["abc", "def-12345678", "9abcdef0"]);
  for (const bad of [
    "", "fixture-8c8ddb31", "Fixture-p3-q1-8c8ddb31", "fixture-p3-q1-8C8DDB31", "fixture-p3-q1-8c8ddb3",
    "fixture-p3-q1-8c8ddb311", "fixture--p3-8c8ddb31", "a-p1-8c8ddb31", "fixture-p3-q1-8c8ddb3g",
    "fixture_p3_q1_8c8ddb31", "fixture-p3-q1-8c8ddb31 ",
  ]) {
    assert.equal(B.ID_RE.test(bad), false, bad);
  }
});

test("prep/bank.js loads as a classic browser script after prep/answer.js and uses the PrepAnswer global (§A5)", () => {
  const read = (f) => fs.readFileSync(path.join(__dirname, "..", "prep", f), "utf8");
  // A browser-like realm: no require, no module, no chrome / document / fetch. TextEncoder is a
  // browser global that §E3 relies on, so it is provided.
  const ctx = vm.createContext({ TextEncoder });
  vm.runInContext(read("answer.js"), ctx, { filename: "prep/answer.js" });
  const before = Object.keys(ctx);
  vm.runInContext(read("bank.js"), ctx, { filename: "prep/bank.js" });
  assert.deepEqual(Object.keys(ctx).filter((k) => !before.includes(k)), ["PrepBank"],
    "prep/bank.js declares exactly one top-level binding");
  // A second classic load in the same realm must not hit a duplicate lexical declaration.
  assert.doesNotThrow(() => vm.runInContext(read("bank.js"), ctx, { filename: "prep/bank.js (again)" }));
  const run = (expr) => vm.runInContext(expr, ctx);
  // Inputs are built inside the realm (JSON.parse there), and only primitives are compared.
  const inRealm = (v) => `JSON.parse(${JSON.stringify(JSON.stringify(v))})`;
  assert.equal(run('PrepBank.sha256Hex("abc")'), sha("abc"));
  const good = numItem();
  assert.equal(run(`PrepBank.hash8(${inRealm(good)})`), h8(good));
  assert.equal(run(`PrepBank.bankValidate(${inRealm({ items: [good, mcqItem(), freeItem()] })}).ok`), true);
  // numeric answer.value is checked with PrepAnswer.parseAnswer in the browser too
  const bad = numItem(); bad.answer = { value: "2 3" }; withId(bad, "p12-q2");
  const r = run(`(() => { const r = PrepBank.bankValidate(${inRealm({ items: [bad] })});
    return JSON.stringify({ ok: r.ok, hit: r.errors.some((e) => e.id === ${JSON.stringify(bad.id)} && e.field === "answer.value") }); })()`);
  assert.deepEqual(JSON.parse(r), { ok: false, hit: true });
});

// ---------- 2. sha256Hex, answerKey, hash8, makeId, parseId (§E3) ----------

test("sha256Hex matches the published vectors", () => {
  assert.equal(B.sha256Hex(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  assert.equal(B.sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(B.sha256Hex("π≈3.14"), "48531632429093f5fe6701c9de463261f6012ae651ac18480bc091438737f90f");
});

test("sha256Hex is synchronous and agrees with node:crypto on ASCII strings of every padding length", () => {
  const alpha = "abcdefghijklmnopqrstuvwxyz0123456789 ABCDEFGHIJKLMNOPQRSTUVWXYZ.,;:!?";
  for (let n = 0; n <= 130; n++) {
    const s = alpha.repeat(2).slice(0, n);
    const got = B.sha256Hex(s);
    assert.equal(typeof got, "string", "must return the hex string directly, not a Promise");
    assert.equal(got, sha(s), `length ${n}`);
  }
});

test("sha256Hex encodes non-ASCII text as UTF-8, matching node:crypto", () => {
  const cases = [
    "é", "€", "π", "½", "𝔼[X]", "🎲", "café au lait",
    "Prob ≈ ½ · E[X] = 3.5 🎲",
    "é".repeat(27) + "a", // 55 bytes
    "é".repeat(28),       // 56 bytes
    "é".repeat(32),       // 64 bytes
    "€".repeat(22),       // 66 bytes
    "😀".repeat(40),      // 160 bytes, surrogate pairs
    "tab\tnewline\nnul\u0000end",
    "$\\frac{1}{2}$ and $$\\sum_{k=0}^{n} k$$",
  ];
  for (const s of cases) assert.equal(B.sha256Hex(s), sha(s), JSON.stringify(s));
});

test("sha256Hex handles long multi-block strings", () => {
  const long1 = "The quick synthetic item text. ".repeat(40); // ~1.2 KB
  const long2 = "x".repeat(10000) + "π".repeat(500);
  assert.equal(B.sha256Hex(long1), sha(long1));
  assert.equal(B.sha256Hex(long2), sha(long2));
});

test("answerKey is answer.value for numeric and free items", () => {
  const n = numItem();
  assert.equal(B.answerKey(n), "1/3");
  const s = sysItem(); // has a tol, which is not part of the key
  assert.equal(B.answerKey(s), "4*1024");
  const f = freeItem();
  assert.equal(B.answerKey(f), f.answer.value);
});

test("answerKey of an mcq item is JSON.stringify(choices) followed by the correct index", () => {
  const m = mcqItem();
  m.answer = { choices: ["1/8", "1/4", "3/8", "1/2"], correct: 2 };
  assert.equal(B.answerKey(m), '["1/8","1/4","3/8","1/2"]2');
  const q = mcqItem();
  q.answer = { choices: ['say "hi"', "a\\b", "π ≈ 3.14"], correct: 0 };
  assert.equal(B.answerKey(q), '["say \\"hi\\"","a\\\\b","π ≈ 3.14"]0');
  assert.equal(B.answerKey(mcqItem()), '["1","2","4","9"]1');
});

test("F1.1 hash8 is the first 8 hex digits of sha256(prompt + answer key) for numeric, mcq and free items", () => {
  const items = validItems();
  const extra = numItem();
  extra.prompt = "Écrivez $P(A \\mid B)$ — ≈ ½ ";
  extra.answer = { value: "  1 / 2 " };
  items.push(extra);
  const mcqUni = mcqItem();
  mcqUni.answer = { choices: ["½", "⅓", "¼"], correct: 2 };
  items.push(mcqUni);
  for (const it of items) {
    const got = B.hash8(it);
    assert.match(got, /^[0-9a-f]{8}$/);
    assert.equal(got, sha(it.prompt + keyOf(it)).slice(0, 8), `${it.type} item ${it.prompt.slice(0, 30)}`);
  }
  // spot-check the mcq key format directly against node:crypto
  const coins = mcqItem();
  coins.answer = { choices: ["1/8", "1/4", "3/8", "1/2"], correct: 2 };
  assert.equal(B.hash8(coins), sha(coins.prompt + '["1/8","1/4","3/8","1/2"]2').slice(0, 8));
});

test("hash8 puts no separator between the prompt and the answer key", () => {
  const a = numItem();
  a.prompt = "What is ab";
  a.answer = { value: "c1" };
  const b = numItem();
  b.prompt = "What is a";
  b.answer = { value: "bc1" };
  assert.equal(B.hash8(a), B.hash8(b));
  assert.equal(B.hash8(a), sha("What is abc1").slice(0, 8));
});

test("makeId joins the given source key, locator and hash8 with hyphens", () => {
  for (const it of validItems()) {
    const loc = "p99-q9";
    assert.equal(B.makeId(it.source.key, loc, it), `${it.source.key}-${loc}-${h8(it)}`);
  }
  const n = numItem(); // the key and locator come from the arguments, not from the item
  assert.equal(B.makeId("othernotes", "ch2-ex10-b", n), `othernotes-ch2-ex10-b-${h8(n)}`);
});

test("parseId returns { key, locator, hash } for a valid id and null otherwise", () => {
  const p = B.parseId("fixture-p3-q1-8c8ddb31");
  assert.equal(p.key, "fixture");
  assert.equal(p.locator, "p3-q1");
  assert.equal(p.hash, "8c8ddb31");
  const n = numItem();
  const q = B.parseId(n.id);
  assert.equal(q.key, "mynotes");
  assert.equal(q.locator, "p12-q1");
  assert.equal(q.hash, h8(n));
  const r = B.parseId("abc-def-12345678-9abcdef0");
  assert.equal(r.key, "abc");
  assert.equal(r.locator, "def-12345678");
  assert.equal(r.hash, "9abcdef0");
  for (const bad of ["", "nonsense", "fixture-8c8ddb31", "Fixture-p3-q1-8c8ddb31", "fixture-p3-q1-8C8DDB31", "fixture-p3-q1-8c8ddb3"]) {
    assert.equal(B.parseId(bad), null, bad);
  }
});

test("F1.1 ids are stable across rebuilds for unchanged content", () => {
  const a = numItem();
  const b = numItem(); // a separate object built from the same content
  assert.notEqual(a, b);
  assert.equal(B.hash8(a), B.hash8(b));
  assert.equal(B.makeId("mynotes", "p12-q1", a), B.makeId("mynotes", "p12-q1", b));
  assert.equal(B.makeId("mynotes", "p12-q1", a), a.id);
  // Only prompt + answer key are hashed: metadata edits keep the id.
  const edits = [
    (it) => { it.solution = "A rewritten solution."; },
    (it) => { it.topics = ["dice"]; },
    (it) => { it.difficulty = 4; },
    (it) => { it.area = "brainteaser"; },
    (it) => { it.source.page = 13; it.source.title = "My Notes (2nd ed.)"; it.source.file = "01-probability/my-notes.pdf"; },
    (it) => { it.origin = "source"; },
    (it) => { it.check = { status: "unverified" }; },
    (it) => { it.answer.tol = { rel: 1e-2 }; },
    (it) => { it.extra = { reviewer: "synthetic" }; },
  ];
  for (const edit of edits) {
    const c = numItem();
    edit(c);
    assert.equal(B.makeId("mynotes", "p12-q1", c), a.id, String(edit));
    expectValid([c], `old id still valid after ${edit}`);
  }
  const m1 = mcqItem();
  const m2 = clone(m1);
  m2.solution = "Different words, same question.";
  assert.equal(B.makeId("mynotes", "p13-q2", m2), m1.id);
});

test("F1.1 a reworded item gets a new id, and its old id fails validation on hash", () => {
  const rewrites = [
    [numItem, (it) => { it.prompt = it.prompt.replace("rolled once", "rolled one time"); }],
    [numItem, (it) => { it.prompt = it.prompt + " "; }],
    [numItem, (it) => { it.answer.value = "2/6"; }], // same number, different text
    [freeItem, (it) => { it.answer.value = it.answer.value.replace("multiple", "multiplier"); }],
    [mcqItem, (it) => { it.answer.correct = 2; }],
    [mcqItem, (it) => { it.answer.choices = ["2", "1", "4", "9"]; it.answer.correct = 0; }],
    [mcqItem, (it) => { it.answer.choices[3] = "nine"; }],
  ];
  for (const [make, rewrite] of rewrites) {
    const old = make();
    const c = make();
    rewrite(c);
    const loc = B.parseId(old.id).locator;
    const fresh = B.makeId(old.source.key, loc, c);
    assert.notEqual(fresh, old.id, String(rewrite));
    assert.equal(fresh, idFor(old.source.key, loc, c), String(rewrite));
    // keeping the stale id is a hash mismatch
    c.id = old.id;
    const r = B.bankValidate({ items: [c] });
    assert.equal(r.ok, false, String(rewrite));
    assert.ok(hasError(r, old.id, "id", /hash/i), `${rewrite}: ${JSON.stringify(r.errors)}`);
    // the rebuilt id is valid
    c.id = fresh;
    expectValid([c], String(rewrite));
  }
});

test("a corrected item's id hashes the resolved answer, not the printed one", () => {
  const fin = finItem();
  expectValid([fin], "id over the resolved answer");
  assert.equal(fin.id, `finnotes-p7-q1-${sha(fin.prompt + "5%").slice(0, 8)}`);
  const stale = finItem();
  stale.id = `finnotes-p7-q1-${sha(stale.prompt + stale.check.printed).slice(0, 8)}`;
  assert.notEqual(stale.id, fin.id);
  const r = B.bankValidate({ items: [stale] });
  assert.equal(r.ok, false);
  assert.ok(hasError(r, stale.id, "id", /hash/i));
});

// ---------- 3. bankValidate: shape of the result (§E4) ----------

test("bankValidate accepts a valid bank covering every area, type, status and origin", () => {
  const items = validItems();
  const r = B.bankValidate({ items });
  assertClean(r, "valid bank");
  const areas = new Set(items.map((i) => i.area));
  const types = new Set(items.map((i) => i.type));
  const statuses = new Set(items.map((i) => i.check.status));
  assert.equal(areas.size, 6);
  assert.equal(types.size, 3);
  assert.equal(statuses.size, 4);
});

test("bankValidate takes a bank.json object, a deck, a merged set or an empty item list", () => {
  const [n, m, f, c, s] = validItems();
  const bankJson = { version: 1, generated: "2026-11-04T15:00:00.000Z", items: [n, m, f] };
  const cpp = { version: 1, deck: "cpp", generated: "2026-11-04T15:00:00.000Z", items: [c] };
  const systems = { version: 1, deck: "systems", items: [s] };
  assertClean(B.bankValidate(bankJson), "bank.json");
  assertClean(B.bankValidate(cpp), "cpp deck");
  assertClean(B.bankValidate(systems), "systems deck");
  assertClean(B.bankValidate({ items: [n, m, f, c, s] }), "merged set");
  assertClean(B.bankValidate({ items: [] }), "empty items");
});

test("bankValidate rejects input that is not an object with an items array with one items error", () => {
  for (const bad of [null, undefined, 42, "items", true, [], {}, { items: "x" }, { items: {} }, { items: null }, { version: 1 }]) {
    const r = B.bankValidate(bad);
    assert.equal(r.ok, false, JSON.stringify(bad));
    assert.ok(Array.isArray(r.errors));
    assert.equal(r.errors.length, 1, JSON.stringify(bad));
    assert.deepEqual(Object.keys(r.errors[0]).sort(), ["field", "id", "msg"]);
    assert.equal(r.errors[0].id, null);
    assert.equal(r.errors[0].field, "items");
    assert.equal(typeof r.errors[0].msg, "string");
  }
});

test("bankValidate needs an object with an items array: a bare item array is not accepted (§A6)", () => {
  // The dual-form rule (Item[] or { items }) covers topicSet / indexById / sourceCounts only.
  const r = B.bankValidate([numItem(), mcqItem()]);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.id === null && e.field === "items"), JSON.stringify(r.errors));
});

test("each validator error is exactly { id, field, msg }, with a dotted field path and no array indices", () => {
  const items = [];
  const a = numItem(); a.topics = ["ok", "Not Kebab"]; a.difficulty = 9; items.push(a);
  const b = mcqItem(); b.answer.choices = ["1", ""]; b.answer.correct = 5; withId(b, "p13-q2"); items.push(b);
  const c = freeItem(); c.source.page = 0; c.check.method = "guess"; items.push(c);
  const d = finItem(); delete d.check.printed; d.answer.tol = { rel: -1 }; items.push(d);
  const e = numItem(); delete e.id; e.area = "maths"; items.push(e);
  const r = B.bankValidate({ items });
  assert.equal(r.ok, false);
  assert.ok(r.errors.length > 0);
  for (const err of r.errors) {
    assert.deepEqual(Object.keys(err).sort(), ["field", "id", "msg"], JSON.stringify(err));
    assert.equal(typeof err.id, "string");
    assert.equal(typeof err.msg, "string");
    assert.ok(FIELDS.includes(err.field), `unexpected field ${err.field}`);
    assert.doesNotMatch(err.field, /\[|\]|\.\d/);
  }
  assert.ok(hasError(r, a.id, "topics"));
  assert.ok(hasError(r, b.id, "answer.choices"));
  assert.ok(hasError(r, b.id, "answer.correct"));
  assert.ok(hasError(r, c.id, "source.page"));
  assert.ok(hasError(r, d.id, "answer.tol"));
});

test("ok is true exactly when errors is empty", () => {
  const inputs = [
    { items: validItems() },
    { items: [] },
    { items: [Object.assign(numItem(), { difficulty: 0 })] },
    { items: [Object.assign(mcqItem(), { area: "maths" }), freeItem()] },
    null,
  ];
  for (const inp of inputs) {
    const r = B.bankValidate(inp);
    assert.equal(typeof r.ok, "boolean");
    assert.ok(Array.isArray(r.errors));
    assert.equal(r.ok, r.errors.length === 0);
  }
});

test("an item without a usable id is reported as #<index>", () => {
  const items = validItems();
  const noId = numItem(); delete noId.id;
  const emptyId = mcqItem(); emptyId.id = "";
  const numId = freeItem(); numId.id = 42; numId.difficulty = 7;
  items.push(noId, emptyId, numId); // indices 7, 8, 9
  const r = B.bankValidate({ items });
  assert.equal(r.ok, false);
  assert.ok(hasError(r, "#7", "id"));
  assert.ok(hasError(r, "#8", "id"));
  assert.ok(hasError(r, "#9", "id"));
  assert.ok(hasError(r, "#9", "difficulty"), "every error of an id-less item uses #<index>");
  // a non-empty but malformed id is used as is
  const bad = numItem(); bad.id = "Bad Id";
  const r2 = B.bankValidate({ items: [bad] });
  assert.ok(hasError(r2, "Bad Id", "id"));
});

test("every problem is reported: validation does not stop at the first error", () => {
  const a = numItem();
  a.area = "maths"; a.difficulty = 0; a.origin = "book"; a.check.status = "verified"; a.solution = "";
  const good = mcqItem();
  const b = freeItem();
  b.topics = [];
  b.source.title = "";
  const r = B.bankValidate({ items: [a, good, b] });
  assert.equal(r.ok, false);
  for (const f of ["area", "difficulty", "origin", "check.status", "solution"]) {
    assert.ok(hasError(r, a.id, f), `missing ${f}`);
  }
  assert.ok(hasError(r, b.id, "topics"));
  assert.ok(hasError(r, b.id, "source.title"));
  assert.ok(!r.errors.some((e) => e.id === good.id), "a valid item gets no errors");
});

test("entries of items that are not objects are reported by index, without throwing", () => {
  const good = numItem();
  const r = B.bankValidate({ items: [good, null, 42, "item"] });
  assert.equal(r.ok, false);
  for (const id of ["#1", "#2", "#3"]) assert.ok(r.errors.some((e) => e.id === id), id);
  assert.ok(!r.errors.some((e) => e.id === good.id));
});

test("bankValidate does not mutate its input and is deterministic", () => {
  const items = validItems();
  items[1].answer.correct = 9;
  items[2].topics = ["Bad Topic"];
  delete items[3].id;
  const bank = { version: 1, items };
  const before = clone(bank);
  const r1 = B.bankValidate(bank);
  assert.deepEqual(bank, before);
  const r2 = B.bankValidate(clone(before));
  assert.deepEqual(r1, r2);
});

test("unknown extra fields are allowed", () => {
  const n = numItem();
  n.notes = "free text";
  n.source.edition = 2;
  n.answer.unit = "probability";
  n.check.reviewer = "synthetic";
  n.check.note = "a note";
  const m = mcqItem();
  m.tags = ["x"];
  expectValid([n, m], "extra fields");
  assertClean(B.bankValidate({ version: 1, deck: "cpp", generated: "x", extra: 1, items: [cppItem()] }), "extra top-level fields");
});

// ---------- 4. bankValidate: per-field checks (spec F1.1, §E4) ----------

test("F1.1 validator checks every required field", () => {
  const cases = [
    [numItem, "id", (it) => delete it.id],
    [numItem, "source", (it) => delete it.source],
    [numItem, "source.key", (it) => delete it.source.key],
    [numItem, "source.title", (it) => delete it.source.title],
    [numItem, "source.file", (it) => delete it.source.file],
    [numItem, "source.page", (it) => delete it.source.page],
    [numItem, "area", (it) => delete it.area],
    [numItem, "topics", (it) => delete it.topics],
    [numItem, "difficulty", (it) => delete it.difficulty],
    [numItem, "type", (it) => delete it.type],
    [numItem, "prompt", (it) => delete it.prompt],
    [numItem, "answer", (it) => delete it.answer],
    [numItem, "answer.value", (it) => delete it.answer.value],
    [freeItem, "answer.value", (it) => delete it.answer.value],
    [mcqItem, "answer.choices", (it) => delete it.answer.choices],
    [mcqItem, "answer.correct", (it) => delete it.answer.correct],
    [numItem, "solution", (it) => delete it.solution],
    [freeItem, "solution", (it) => delete it.solution],
    [numItem, "origin", (it) => delete it.origin],
    [numItem, "check", (it) => delete it.check],
    [numItem, "check.status", (it) => delete it.check.status],
  ];
  for (const [make, field, drop] of cases) {
    const it = make();
    drop(it);
    expectFieldError(it, field, `missing ${field} (${it.type})`);
  }
  // check.method is optional (it is a build acceptance check, not a validator check)
  const noMethod = numItem();
  delete noMethod.check.method;
  expectValid([noMethod], "no check.method");
});

test("F1.1 validator checks the allowed enum values", () => {
  for (const bad of ["maths", "Probability", "", "quant", 3]) {
    const it = numItem(); it.area = bad;
    expectFieldError(it, "area", `area ${bad}`);
  }
  for (const bad of ["essay", "Numeric", "", "mcq "]) {
    const it = numItem(); it.type = bad;
    expectFieldError(it, "type", `type ${bad}`);
  }
  for (const bad of ["book", "Generated", ""]) {
    const it = numItem(); it.origin = bad;
    expectFieldError(it, "origin", `origin ${bad}`);
  }
  for (const bad of ["verified", "Agreed", "", "ok"]) {
    const it = numItem(); it.check.status = bad;
    expectFieldError(it, "check.status", `status ${bad}`);
  }
  for (const bad of ["sim", "blind+llm", "Blind", ""]) {
    const it = numItem(); it.check.method = bad;
    expectFieldError(it, "check.method", `method ${bad}`);
  }
  // every allowed value passes
  const ok = [];
  for (const area of ["probability", "brainteaser", "statistics", "finance", "cpp", "systems"]) {
    const it = numItem(); it.area = area; withId(it, `a-${area}`); ok.push(it);
  }
  for (const origin of ["source", "generated"]) {
    const it = mcqItem(); it.origin = origin; withId(it, `o-${origin}`); ok.push(it);
  }
  for (const method of ["blind", "blind+sim"]) {
    const it = freeItem(); it.check.method = method; withId(it, `m-${method.replace("+", "-")}`); ok.push(it);
  }
  for (const status of ["agreed", "unverified"]) {
    const it = numItem(); it.check = { status }; withId(it, `s-${status}`); ok.push(it);
  }
  for (const status of ["corrected", "disputed"]) {
    const it = numItem(); it.check = { status, printed: "1/2", resolved: "1/3", method: "blind" }; withId(it, `s-${status}`); ok.push(it);
  }
  ok.push(numItem(), mcqItem(), freeItem()); // one of each TYPE
  expectValid(ok, "every enum value");
});

test("F1.1 validator checks unique ids", () => {
  const x = numItem();
  const y = mcqItem();
  // one later duplicate
  const r1 = B.bankValidate({ items: [x, y, clone(x)] });
  assert.equal(r1.ok, false);
  assert.ok(hasError(r1, x.id, "id", /duplicate/i), JSON.stringify(r1.errors));
  assert.ok(!r1.errors.some((e) => e.id === y.id));
  // one error per later duplicate
  const r2 = B.bankValidate({ items: [x, clone(x), clone(x)] });
  assert.equal(r2.errors.filter((e) => e.id === x.id && e.field === "id" && /duplicate/i.test(e.msg)).length, 2);
  // across bank.json and a deck, via the merged set
  const c = cppItem();
  const bankJson = { version: 1, items: [x, y] };
  const deck = { version: 1, deck: "cpp", items: [c, clone(y)] };
  const r3 = B.bankValidate({ items: B.allItems(bankJson, [deck]) });
  assert.equal(r3.ok, false);
  assert.ok(hasError(r3, y.id, "id", /duplicate/i));
  // equal content under different locators is not a duplicate
  const p = numItem();
  const q = numItem(); withId(q, "p12-q1b");
  assert.notEqual(p.id, q.id);
  expectValid([p, q], "same content, different locators");
});

test("F1.1 validator checks that the hash8 matches the content", () => {
  const good = numItem();
  const real = B.parseId(good.id).hash;
  const wrong = real === "00000000" ? "11111111" : "00000000";
  // a wrong hash part
  const it = numItem(); it.id = `mynotes-p12-q1-${wrong}`;
  const r = B.bankValidate({ items: [it] });
  assert.equal(r.ok, false);
  assert.ok(hasError(r, it.id, "id", /hash/i), JSON.stringify(r.errors));
  // the hash is checked for mcq and free items too
  const m = mcqItem(); m.id = `mynotes-p13-q2-${h8(m) === "abcdef12" ? "12abcdef" : "abcdef12"}`;
  const f = freeItem(); f.answer.value = "Changed after the id was made.";
  const r2 = B.bankValidate({ items: [m, f] });
  assert.ok(hasError(r2, m.id, "id", /hash/i));
  assert.ok(hasError(r2, f.id, "id", /hash/i));
  // the hash is still checked when unrelated fields are invalid
  const u = numItem(); u.id = `mynotes-p12-q1-${wrong}`; u.area = "maths";
  const r3 = B.bankValidate({ items: [u] });
  assert.ok(hasError(r3, u.id, "area"));
  assert.ok(hasError(r3, u.id, "id", /hash/i));
  // the key part must equal source.key
  const k = numItem(); k.id = idFor("othernotes", "p12-q1", k);
  expectFieldError(k, "id", "key part differs from source.key");
  // ids that do not match ID_RE
  for (const bad of [
    "mynotes_p12_q1_" + real, "MyNotes-p12-q1-" + real, "mynotes-p12-q1-" + real.toUpperCase(),
    "mynotes-" + real, "mynotes-p12-q1-" + real.slice(0, 7), "mynotes-P12-" + real, "mynotes p12 " + real,
  ]) {
    const b = numItem(); b.id = bad;
    expectFieldError(b, "id", `id ${bad}`);
  }
});

test("the hash check is skipped when the prompt or the answer fields it needs are invalid", () => {
  // `skip` cases: the prompt or the needed answer field is missing or of the wrong JS type, so
  // the hash is skipped under any reading of §E4. The other two cases (a whitespace-only prompt,
  // an empty free answer) are strings that fail their own check. §E4 most naturally skips the
  // hash there too, but "invalid" could also be read as "answerKey cannot be computed", so
  // for them only the field error and "does not throw" are asserted.
  const cases = [
    [numItem, "prompt", true, (it) => { delete it.prompt; }],
    [numItem, "prompt", true, (it) => { it.prompt = 42; }],
    [numItem, "prompt", false, (it) => { it.prompt = "  \n\t "; }],
    [numItem, "answer", true, (it) => { it.answer = null; }],
    [numItem, "answer", true, (it) => { delete it.answer; }],
    [numItem, "answer.value", true, (it) => { it.answer.value = 7; }],
    [freeItem, "answer.value", true, (it) => { delete it.answer.value; }],
    [freeItem, "answer.value", false, (it) => { it.answer.value = ""; }],
    [mcqItem, "answer.choices", true, (it) => { it.answer.choices = "1,2,4,9"; }],
  ];
  for (const [make, field, skip, breakIt] of cases) {
    const it = make(); // its id was valid for the content before the break
    breakIt(it);
    let r;
    assert.doesNotThrow(() => { r = B.bankValidate({ items: [it] }); }, String(breakIt));
    assert.equal(r.ok, false);
    assert.ok(hasError(r, it.id, field), `${breakIt}: ${JSON.stringify(r.errors)}`);
    if (skip) {
      assert.ok(!r.errors.some((e) => e.id === it.id && e.field === "id"), `${breakIt}: no id error expected, got ${JSON.stringify(r.errors)}`);
    }
  }
});

test("F1.1 validator checks that numeric answer.value parses (F1.2)", () => {
  const good = [
    "7/36", "0.1944", "1/e", "e^-1", "exp(-1)", "36.79%", "C(10,3)/2^10", "10C3/1024", "sqrt(2)/2",
    "5!", "2pi", "2 pi", "1e-3", "-2^2", "=3/4", " 1 / 8 ", "π/4", "ln(2)", "log(10)", "2**10", "0",
    "1+".repeat(99) + "10", // exactly 200 characters
  ];
  const items = good.map((value, i) => {
    const it = numItem(); it.answer = { value }; return withId(it, `g${i}`);
  });
  expectValid(items, "parseable numeric answers");

  const bad = [
    "2 3", "171!", "(-1)!", "1.5!", "import os", "alert(1)", "1,000", "1 1/2", "1/0", "2×3", "3−1",
    "PI", "", "   ", "==1", "sqrt(-1)", "ln(0)", "1e400", "2(3)", "pi2", "1+".repeat(100) + "1",
  ];
  const badItems = bad.map((value, i) => {
    const it = numItem(); it.answer = { value }; return withId(it, `b${i}`);
  });
  const r = B.bankValidate({ items: badItems });
  assert.equal(r.ok, false);
  badItems.forEach((it) => {
    assert.ok(hasError(r, it.id, "answer.value"), `value ${JSON.stringify(it.answer.value)} should not parse`);
  });
  // only answer.value is wrong with these items
  assert.ok(r.errors.every((e) => e.field === "answer.value"), JSON.stringify(r.errors.filter((e) => e.field !== "answer.value")));

  // not a string
  for (const v of [7, null, ["1/3"]]) {
    const it = numItem(); it.answer.value = v;
    expectFieldError(it, "answer.value", `value ${JSON.stringify(v)}`);
  }
  // a numeric item with an mcq-shaped answer has no answer.value
  const shaped = numItem(); shaped.answer = { choices: ["1/3", "1/2"], correct: 0 }; withId(shaped, "p12-q1");
  expectFieldError(shaped, "answer.value", "numeric with choices");
  // free answers are markdown and are not parsed
  expectValid([freeItem(), cppItem()], "free answers are prose");
});

test("F1.1 validator checks mcq correct is in range, with 2 to 8 choices", () => {
  const mk = (choices, correct, loc) => {
    const it = mcqItem(); it.answer = { choices, correct }; return withId(it, loc);
  };
  const eight = ["1", "2", "3", "4", "5", "6", "7", "8"];
  expectValid([
    mk(["yes", "no"], 0, "two-a"), mk(["yes", "no"], 1, "two-b"),
    mk(eight, 0, "eight-a"), mk(eight, 7, "eight-b"),
  ], "2 and 8 choices, first and last index");

  for (const [choices, what] of [
    [["only"], "one choice"],
    [[...eight, "9"], "nine choices"],
    [[], "no choices"],
    [["1", ""], "an empty choice"],
    [["1", 2], "a non-string choice"],
    ["1,2", "a string"],
    [{ 0: "a", 1: "b" }, "an object"],
  ]) {
    const it = mk(choices, 0, "c1");
    expectFieldError(it, "answer.choices", what);
  }
  for (const [correct, what] of [
    [-1, "negative"], [4, "equal to choices.length"], [9, "past the end"], [1.5, "not an integer"],
    ["1", "a string"], [null, "null"], [undefined, "missing"],
  ]) {
    const it = mcqItem(); it.answer.correct = correct; withId(it, "k1");
    expectFieldError(it, "answer.correct", `correct ${what}`);
  }
  // an mcq item with a numeric-shaped answer has neither choices nor correct
  const shaped = mcqItem(); shaped.answer = { value: "2" };
  const r = B.bankValidate({ items: [shaped] });
  assert.ok(hasError(r, shaped.id, "answer.choices"));
  assert.ok(hasError(r, shaped.id, "answer.correct"));
});

test("F1.1 validator checks difficulty is an integer from 1 to 5", () => {
  const ok = [1, 2, 3, 4, 5].map((d) => { const it = numItem(); it.difficulty = d; return withId(it, `d${d}`); });
  expectValid(ok, "difficulty 1..5");
  for (const d of [0, 6, -1, 2.5, "3", null, NaN, Infinity, true]) {
    const it = numItem(); it.difficulty = d;
    expectFieldError(it, "difficulty", `difficulty ${String(d)}`);
  }
});

test("F1.1 validator checks source.page is at least 1", () => {
  const ok = [1, 2, 999].map((p) => { const it = numItem(); it.source.page = p; return withId(it, `pg${p}`); });
  expectValid(ok, "pages 1, 2, 999");
  for (const p of [0, -3, 1.5, "2", null, NaN]) {
    const it = numItem(); it.source.page = p;
    expectFieldError(it, "source.page", `page ${String(p)}`);
  }
});

test("F1.1 validator checks topics is not empty, and each topic is lowercase-kebab", () => {
  const ok = [["a"], ["2d-geometry", "x"], ["order-statistics", "dice", "conditional"]].map((t, i) => {
    const it = numItem(); it.topics = t; return withId(it, `t${i}`);
  });
  expectValid(ok, "kebab topics");
  for (const t of [[], "dice", ["Dice"], ["dice", "two words"], ["snake_case"], ["-lead"], ["trail-"], ["double--dash"], [""], [3], null]) {
    const it = numItem(); it.topics = t;
    expectFieldError(it, "topics", `topics ${JSON.stringify(t)}`);
  }
});

test("source must be an object with a valid key, a title, a safe relative file and a page", () => {
  for (const s of ["My Notes, p. 12", 12]) {
    const it = numItem(); it.source = s;
    expectFieldError(it, "source", `source ${JSON.stringify(s)}`);
  }
  // source.key
  for (const key of ["a", "my-notes", "MyNotes", "x".repeat(25), "", 42]) {
    const it = numItem(); it.source.key = key;
    if (typeof key === "string" && /^[a-z0-9-]+$/.test(key)) it.id = idFor(key, "p12-q1", it);
    expectFieldError(it, "source.key", `key ${JSON.stringify(key)}`);
  }
  const keysOk = ["ab", "x".repeat(24), "notes2026"].map((key, i) => {
    const it = numItem(); it.source.key = key; it.id = idFor(key, `k${i}`, it); return it;
  });
  expectValid(keysOk, "valid keys");
  // source.title
  for (const title of ["", 5, undefined]) {
    const it = numItem(); it.source.title = title;
    expectFieldError(it, "source.title", `title ${JSON.stringify(title)}`);
  }
  // source.file: POSIX path relative to library/, no ".." segment
  for (const file of [
    "../outside.pdf", "a/../b.pdf", "..", "/abs/notes.pdf", "notes.pdf/", "dir//notes.pdf",
    "my notes.pdf", "dir\\notes.pdf", "", 7, "notes?.pdf",
  ]) {
    const it = numItem(); it.source.file = file;
    expectFieldError(it, "source.file", `file ${JSON.stringify(file)}`);
  }
  const filesOk = [
    "notes.pdf", "00-user-supplied/my_notes-v2.pdf", "cppreference/en/cpp/utility/move.html",
    "core-guidelines/CppCoreGuidelines.md", "04-systems-low-latency/Slides.2026.PDF",
  ].map((file, i) => { const it = numItem(); it.source.file = file; return withId(it, `f${i}`); });
  expectValid(filesOk, "valid library paths");
});

test("prompt must have non-whitespace content, and free answers and solutions must be non-empty strings", () => {
  for (const p of ["", "   \n\t", 99]) {
    const it = numItem(); it.prompt = p;
    expectFieldError(it, "prompt", `prompt ${JSON.stringify(p)}`);
  }
  for (const v of ["", 42]) {
    const it = freeItem(); it.answer.value = v;
    expectFieldError(it, "answer.value", `free value ${JSON.stringify(v)}`);
  }
  for (const s of ["", 3, null]) {
    const it = numItem(); it.solution = s;
    expectFieldError(it, "solution", `solution ${JSON.stringify(s)}`);
  }
  for (const a of ["1/3", 5]) {
    const it = numItem(); it.answer = a;
    expectFieldError(it, "answer", `answer ${JSON.stringify(a)}`);
  }
});

test("answer.tol, when present, must be an object of finite non-negative rel / abs", () => {
  const ok = [{ rel: 0 }, { abs: 0 }, { rel: 1e-2 }, { abs: 0.5, rel: 0 }, { rel: 1e-6, abs: 1e-9 }].map((tol, i) => {
    const it = numItem(); it.answer.tol = tol; return withId(it, `tol${i}`);
  });
  expectValid(ok, "valid tolerances");
  for (const tol of ["loose", 0.01, { rel: -0.1 }, { abs: -1 }, { rel: NaN }, { rel: Infinity }, { abs: "0.1" }, { rel: 0.01, abs: -1e-9 }]) {
    const it = numItem(); it.answer.tol = tol;
    expectFieldError(it, "answer.tol", `tol ${String(JSON.stringify(tol))} ${String(tol && tol.rel)}`);
  }
});

test("check must be an object; corrected and disputed items need printed and resolved", () => {
  for (const c of ["agreed", 1]) {
    const it = numItem(); it.check = c;
    expectFieldError(it, "check", `check ${JSON.stringify(c)}`);
  }
  for (const status of ["corrected", "disputed"]) {
    const noPrinted = numItem(); noPrinted.check = { status, resolved: "1/3", method: "blind" };
    expectFieldError(noPrinted, "check.printed", `${status} without printed`);
    const emptyResolved = numItem(); emptyResolved.check = { status, printed: "1/2", resolved: "" };
    expectFieldError(emptyResolved, "check.resolved", `${status} with empty resolved`);
    const neither = numItem(); neither.check = { status };
    const r = B.bankValidate({ items: [neither] });
    assert.ok(hasError(r, neither.id, "check.printed"), status);
    assert.ok(hasError(r, neither.id, "check.resolved"), status);
  }
  // agreed and unverified items need neither; extra printed / resolved / note are fine
  const a = numItem(); a.check = { status: "agreed" };
  const u = mcqItem(); u.check = { status: "unverified", note: "not checked yet" };
  const a2 = freeItem(); a2.check = { status: "agreed", method: "blind", printed: "same", resolved: "same" };
  expectValid([a, u, a2, finItem(), disputedItem()], "printed / resolved only required when corrected or disputed");
});

// ---------- 5. helpers (§E5) ----------

test("allItems concatenates bank.json items then each deck's items, as a new array of the same objects", () => {
  const [n, m, f, c, s, fin] = validItems();
  const bankJson = { version: 1, items: [n, m, f] };
  const cpp = { version: 1, deck: "cpp", items: [c] };
  const systems = { version: 1, deck: "systems", items: [s, fin] };
  const before = clone([bankJson, cpp, systems]);
  const all = B.allItems(bankJson, [cpp, systems]);
  assert.equal(all.length, 6);
  [n, m, f, c, s, fin].forEach((it, i) => assert.equal(all[i], it, `index ${i} is the same object`));
  assert.notEqual(all, bankJson.items);
  all.push("extra");
  assert.deepEqual([bankJson, cpp, systems], before, "inputs are not mutated");

  const onlyBank = B.allItems(bankJson);
  assert.deepEqual(onlyBank, [n, m, f]);
  assert.notEqual(onlyBank, bankJson.items);
  assert.deepEqual(B.allItems(bankJson, []), [n, m, f]);
  assert.deepEqual(B.allItems(bankJson, null), [n, m, f]);
  assert.deepEqual(B.allItems(null, [cpp]), [c]);
  assert.deepEqual(B.allItems(null, [cpp, systems]), [c, s, fin]);
  assert.deepEqual(B.allItems(bankJson, [null, systems]), [n, m, f, s, fin]);
  assert.deepEqual(B.allItems(bankJson, [cpp, null]), [n, m, f, c]);
  assert.deepEqual(B.allItems(null, []), []);
  assert.deepEqual(B.allItems(null), []);
});

test("indexById maps id to item, keeps the first occurrence and takes an array or { items }", () => {
  const n = numItem();
  const m = mcqItem();
  const n2 = numItem(); n2.solution = "a later copy with the same id";
  const idx = B.indexById([n, m, n2]);
  assert.deepEqual(Object.keys(idx).sort(), [m.id, n.id].sort());
  assert.equal(idx[n.id], n, "first occurrence wins");
  assert.equal(idx[m.id], m);
  const idx2 = B.indexById({ version: 1, items: [n, m, n2] });
  assert.equal(idx2[n.id], n);
  assert.equal(idx2[m.id], m);
  assert.deepEqual(Object.keys(B.indexById([])), []);
  assert.deepEqual(Object.keys(B.indexById(null)), []);
  assert.deepEqual(Object.keys(B.indexById({ items: [] })), []);
});

test("topicSet is the sorted list of distinct topics, from an array or { items }", () => {
  const a = numItem(); a.topics = ["zeta", "alpha", "order-statistics"];
  const b = mcqItem(); b.topics = ["alpha", "9lives", "order"];
  const c = freeItem(); c.topics = ["10x", "zeta"];
  const expected = ["10x", "9lives", "alpha", "order", "order-statistics", "zeta"];
  const before = clone([a, b, c]);
  assert.deepEqual(B.topicSet([a, b, c]), expected);
  assert.deepEqual(B.topicSet({ items: [c, b, a] }), expected);
  assert.deepEqual([a, b, c], before);
  assert.deepEqual(B.topicSet([]), []);
  assert.deepEqual(B.topicSet(null), []);
});

test("answerText shows the display answer for each item type", () => {
  assert.equal(B.answerText(numItem()), "1/3");
  assert.equal(B.answerText(sysItem()), "4*1024");
  assert.equal(B.answerText(mcqItem()), "2");
  const m = mcqItem(); m.answer = { choices: ["1/8", "1/4", "3/8", "1/2"], correct: 2 };
  assert.equal(B.answerText(m), "3/8");
  const f = freeItem();
  assert.equal(B.answerText(f), "Write them as $2a+1$ and $2b+1$. Their sum is $2(a+b+1)$, a multiple of $2$.");
});

test("F1.4 sourceLabel reads '<title>, p. <page>', also for slide decks", () => {
  const g = numItem(); g.source.title = "Green Book"; g.source.page = 37;
  assert.equal(B.sourceLabel(g), "Green Book, p. 37");
  assert.equal(B.sourceLabel(numItem()), "My Notes, p. 12");
  assert.equal(B.sourceLabel(sysItem()), "Systems Slides, p. 1");
  assert.equal(B.sourceLabel(cppItem()), "C++ Notes, p. 4");
});

test("F1.4 libraryHref links to <root>library/<file>#page=<page>, default root bank/", () => {
  assert.equal(B.libraryHref(numItem()), "bank/library/00-user-supplied/my-notes.pdf#page=12");
  assert.equal(B.libraryHref(sysItem()), "bank/library/04-systems-low-latency/sys-slides.pdf#page=1");
  assert.equal(B.libraryHref(numItem(), "bank/"), "bank/library/00-user-supplied/my-notes.pdf#page=12");
  assert.equal(B.libraryHref(cppItem(), "tests/fixtures/bank-mini/"),
    "tests/fixtures/bank-mini/library/03-cpp/cpp-notes.pdf#page=4");
  // the file part is URI-encoded
  const sp = numItem(); sp.source.file = "user notes/My File.pdf"; sp.source.page = 3;
  assert.equal(B.libraryHref(sp), "bank/library/user%20notes/My%20File.pdf#page=3");
  const acc = numItem(); acc.source.file = "café.pdf"; acc.source.page = 2;
  assert.equal(B.libraryHref(acc, "tests/fixtures/bank-mini/"), "tests/fixtures/bank-mini/library/caf%C3%A9.pdf#page=2");
});

test("sourceCounts counts items per source.file, from an array or { items }", () => {
  const items = validItems();
  const expected = {
    "00-user-supplied/my-notes.pdf": 2,
    "02-quant-interview/puzzle-sheet.pdf": 1,
    "03-cpp/cpp-notes.pdf": 1,
    "04-systems-low-latency/sys-slides.pdf": 1,
    "02-quant-interview/fin-notes.pdf": 1,
    "01-probability/stat-notes.pdf": 1,
  };
  assert.deepEqual(plain(B.sourceCounts(items)), expected);
  assert.deepEqual(plain(B.sourceCounts({ version: 1, items })), expected);
  const extra = numItem(); extra.source.page = 40;
  assert.equal(B.sourceCounts([...items, extra])["00-user-supplied/my-notes.pdf"], 3);
  assert.deepEqual(plain(B.sourceCounts([])), {});
  assert.deepEqual(plain(B.sourceCounts(null)), {});
});

test("the item helpers do not mutate their inputs", () => {
  const items = validItems();
  const before = clone(items);
  for (const it of items) {
    B.answerKey(it); B.hash8(it); B.makeId(it.source.key, "p1", it); B.answerText(it);
    B.sourceLabel(it); B.libraryHref(it); B.libraryHref(it, "tests/fixtures/bank-mini/");
  }
  B.indexById(items); B.topicSet(items); B.sourceCounts(items); B.allItems({ items }, [{ items }]);
  assert.deepEqual(items, before);
});
