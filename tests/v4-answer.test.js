// v4 prep/answer.js: the safe answer parser, numeric and multiple-choice checking, and the
// live preview. Contract: V4-CONTRACTS.md §C (spec §3 F1.2). Run with `npm test`.
// Expected values come from Math, BigInt or hand-written literals, never from the module.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const A = require("../prep/answer.js");

const PI = Math.PI;
const E = Math.E;
const show = (s) => JSON.stringify(s);

// |actual - expected| <= rel * |expected| (a tiny floor so expected = 0 still works).
function near(actual, expected, rel = 1e-9, label = "") {
  assert.equal(typeof actual, "number", `${label}: value must be a number`);
  const tol = Math.max(rel * Math.abs(expected), 1e-15);
  assert.ok(Math.abs(actual - expected) <= tol, `${label}: got ${actual}, want ${expected}`);
}

// A successful parse: { ok: true, value } with a finite number. Returns the value.
function val(str) {
  const r = A.parseAnswer(str);
  assert.equal(r.ok, true, `parseAnswer(${show(str)}) should succeed, got ${show(r)}`);
  assert.equal(typeof r.value, "number", show(str));
  assert.ok(Number.isFinite(r.value), `${show(str)} must give a finite value`);
  return r.value;
}
const okNear = (str, expected, rel = 1e-12) => near(val(str), expected, rel, show(str));
const okExact = (str, expected) => assert.equal(val(str), expected, show(str));

// A failed parse: { ok: false, error } with a non-empty message, optionally holding a keyword.
function bad(str, keyword) {
  const r = A.parseAnswer(str);
  assert.equal(r.ok, false, `parseAnswer(${show(str)}) should fail, got ${show(r)}`);
  assert.equal(typeof r.error, "string", `${show(str)}: error must be a string`);
  assert.ok(r.error.length > 0, `${show(str)}: error must not be empty`);
  if (keyword) assert.match(r.error, keyword, `error for ${show(str)}`);
  return r;
}

// Synthetic numeric item: only answer.value and answer.tol are read (§C2).
const num = (value, tol) => ({ type: "numeric", answer: tol === undefined ? { value } : { value, tol } });

// A graded (successfully parsed) checkNumeric result: boolean correct, no error key.
function graded(userStr, item) {
  const r = A.checkNumeric(userStr, item);
  assert.equal(typeof r.correct, "boolean", `checkNumeric(${show(userStr)}) should grade, got ${show(r)}`);
  assert.equal("error" in r, false, `checkNumeric(${show(userStr)}) must have no error key on success`);
  return r;
}
const isRight = (userStr, item) => assert.equal(graded(userStr, item).correct, true, `${show(userStr)} vs ${show(item.answer)}`);
const isWrong = (userStr, item) => assert.equal(graded(userStr, item).correct, false, `${show(userStr)} vs ${show(item.answer)}`);

// An ungraded checkNumeric result (parse error in the user string).
function ungraded(userStr, item) {
  const r = A.checkNumeric(userStr, item);
  assert.equal(r.correct, null, `checkNumeric(${show(userStr)}) must not be graded, got ${show(r)}`);
  assert.equal(r.parsed, null, show(userStr));
  assert.equal(typeof r.error, "string", show(userStr));
  assert.ok(r.error.length > 0, show(userStr));
  return r;
}

// Exact binomial coefficient (independent oracle).
function binomBig(n, k) {
  if (k > n) return 0n;
  let r = 1n;
  for (let i = 1n; i <= BigInt(k); i++) r = (r * (BigInt(n) - BigInt(k) + i)) / i;
  return r;
}

// ---------- 0. exports and safety ----------

test("exports MAX_INPUT_LENGTH = 200, DEFAULT_TOL = { rel: 1e-3, abs: 1e-9 } and the four functions", () => {
  assert.equal(A.MAX_INPUT_LENGTH, 200);
  assert.deepEqual({ rel: A.DEFAULT_TOL.rel, abs: A.DEFAULT_TOL.abs }, { rel: 1e-3, abs: 1e-9 });
  for (const f of ["parseAnswer", "checkNumeric", "checkMcq", "formatPreview"]) {
    assert.equal(typeof A[f], "function", f);
  }
});

test("safe evaluator: prep/answer.js source never contains eval( or Function( (spec §3 F1.2)", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "prep", "answer.js"), "utf8");
  assert.doesNotMatch(src, /\beval\s*\(/);
  assert.doesNotMatch(src, /\bFunction\s*\(/);
});

test("prep/answer.js loads as a plain browser script: defines the PrepAnswer global and needs no require", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "prep", "answer.js"), "utf8");
  const ctx = vm.createContext({});
  vm.runInContext(src, ctx, { filename: "prep/answer.js" });
  const G = vm.runInContext("typeof PrepAnswer !== 'undefined' ? PrepAnswer : null", ctx);
  assert.ok(G, "PrepAnswer global must exist");
  assert.equal(typeof G.parseAnswer, "function");
  const r = G.parseAnswer("2pi");
  assert.equal(r.ok, true);
  near(r.value, 2 * PI, 1e-12, "2pi in browser context");
});

// ---------- 1. spec §3 F1.2 required behaviour ----------

test('F1.2 required: "7/36" and "0.1944" both match 7/36, but "0.19" does not', () => {
  const item = num("7/36");
  okNear("7/36", 7 / 36);
  for (const s of ["7/36", "0.1944"]) {
    const r = graded(s, item);
    assert.equal(r.correct, true, s);
    near(r.expected, 7 / 36, 1e-12, "expected");
  }
  near(graded("0.1944", item).parsed, 0.1944, 1e-12, "parsed");
  const r = graded("0.19", item);
  assert.equal(r.correct, false);
  near(r.parsed, 0.19, 1e-12, "parsed");
  near(r.expected, 7 / 36, 1e-12, "expected");
});

test('F1.2 required: "1/e", "e^-1" and "exp(-1)" are equal', () => {
  const forms = ["1/e", "e^-1", "exp(-1)"];
  const vals = forms.map(val);
  for (let i = 0; i < forms.length; i++) near(vals[i], Math.exp(-1), 1e-12, forms[i]);
  for (let i = 0; i < forms.length; i++) {
    for (let j = 0; j < forms.length; j++) near(vals[i], vals[j], 1e-12, `${forms[i]} vs ${forms[j]}`);
  }
  // each form is accepted as an answer to an item stored in any other form
  for (const user of forms) for (const stored of forms) isRight(user, num(stored));
});

test('F1.2 required: "36.79%" matches 1/e', () => {
  okNear("36.79%", 0.3679);
  isRight("36.79%", num("1/e"));
  isRight("36.79%", num("exp(-1)"));
  isWrong("36.7%", num("1/e")); // 0.367 is off by ~8.8e-4, beyond rel 1e-3 of 0.3679
});

test('F1.2 required: "C(10,3)/2^10" and "10C3/1024" both match 120/1024', () => {
  okExact("C(10,3)", 120);
  okExact("10C3", 120);
  okExact("2^10", 1024);
  okExact("C(10,3)/2^10", 120 / 1024); // 0.1171875 is exact in binary
  okExact("10C3/1024", 120 / 1024);
  const item = num("120/1024");
  isRight("C(10,3)/2^10", item);
  isRight("10C3/1024", item);
});

test('F1.2 required: "sqrt(2)/2" matches 0.70711', () => {
  okNear("sqrt(2)/2", Math.SQRT1_2);
  isRight("sqrt(2)/2", num("0.70711"));
  isRight("0.70711", num("sqrt(2)/2"));
});

test('F1.2 required: "5!" gives 120', () => {
  okExact("5!", 120);
  isRight("5!", num("120"));
});

test('F1.2 required: "171!", "(-1)!" and "1.5!" give errors (keyword factorial)', () => {
  for (const s of ["171!", "(-1)!", "1.5!"]) {
    bad(s, /factorial/i);
    ungraded(s, num("120"));
  }
});

test('F1.2 required: "2pi" gives 6.2832', () => {
  const v = val("2pi");
  near(v, 2 * PI, 1e-12, "2pi");
  assert.equal(Math.round(v * 1e4) / 1e4, 6.2832);
  isRight("2pi", num("6.2832"));
});

test('F1.2 required: "2 3" gives an error', () => {
  bad("2 3");
  ungraded("2 3", num("6"));
  ungraded("2 3", num("23"));
});

test('F1.2 required: "import os" and "alert(1)" give errors', () => {
  for (const s of ["import os", "alert(1)"]) {
    bad(s);
    ungraded(s, num("1"));
  }
});

test('F1.2 required: "1e-3" gives 0.001', () => {
  okNear("1e-3", 0.001);
  isRight("1e-3", num("0.001"));
  isRight("0.001", num("1e-3"));
});

test('F1.2 required: "-2^2" gives -4 (unary minus is looser than ^)', () => {
  okExact("-2^2", -4);
  okExact("(-2)^2", 4);
  okExact("-2**2", -4);
  isRight("-2^2", num("-4"));
});

// ---------- 2. parseAnswer: result shape and pre-processing (§C1) ----------

test("parseAnswer returns { ok: true, value } with a finite number, deterministically", () => {
  const r = A.parseAnswer("7/36");
  assert.equal(r.ok, true);
  near(r.value, 7 / 36, 1e-12, "7/36");
  assert.deepEqual(A.parseAnswer("7/36"), r);
  assert.deepEqual(A.parseAnswer("2 3"), A.parseAnswer("2 3"));
});

test("parseAnswer normalises -0 to 0", () => {
  for (const s of ["-0", "0*-1", "-(0)", "0/-5", "-0%", "-0!*0"]) {
    assert.ok(Object.is(val(s), 0), `${show(s)} must give +0`);
  }
});

test("parseAnswer rejects non-string input with an error result, without throwing", () => {
  for (const x of [7, 0.5, 0, null, undefined, {}, ["1"], true, NaN]) {
    let r;
    assert.doesNotThrow(() => { r = A.parseAnswer(x); }, String(x));
    assert.equal(r.ok, false, `${String(x)} must be rejected`);
    assert.equal(typeof r.error, "string");
    assert.ok(r.error.length > 0);
  }
});

test("parseAnswer: input longer than MAX_INPUT_LENGTH (200) is an error with keyword long, measured before stripping", () => {
  okExact(" ".repeat(199) + "7", 7); // 200 units: allowed
  okExact("1+".repeat(99) + "10", 109); // 200 units: allowed
  okExact("=" + " ".repeat(198) + "7", 7); // 200 units: allowed
  bad(" ".repeat(200) + "7", /long/i); // 201
  bad("1+".repeat(100) + "1", /long/i); // 201
  bad(" ".repeat(199) + "=7", /long/i); // 201: whitespace and = count before they are stripped
  bad(" ".repeat(201), /long/i); // the length check comes before the empty check
  bad("x".repeat(5000), /long/i); // and before tokenizing
});

test("parseAnswer: empty or whitespace-only input, also after a leading =, is an error with keyword empty", () => {
  for (const s of ["", " ", "   ", "\t\n", "=", " = ", "  =  ", "=\n"]) bad(s, /empty/i);
});

test("parseAnswer: one leading = (after optional whitespace) is ignored; any other = is an error", () => {
  okNear("=7/36", 7 / 36);
  okExact("= 5", 5);
  okExact("   =5", 5);
  okExact("=\t-3", -3);
  okNear("=2pi", 2 * PI);
  for (const s of ["==5", "= =5", "5=", "2=2", "=5=", "5 = 5", "x=1"]) bad(s);
});

test("parseAnswer: whitespace separates tokens and is otherwise ignored (2 pi equals 2pi)", () => {
  okNear("2 pi", 2 * PI);
  okNear("2   pi", 2 * PI);
  okNear(" 7 / 36 ", 7 / 36);
  okNear("\t7/36\n", 7 / 36);
  okExact("10 C 3", 120);
  okExact("2 ** 3", 8);
  okExact("3 !", 6);
  okExact("50 %", 0.5);
  okExact("- 5", -5);
  okExact("sqrt (16)", 4);
  okExact("C( 10 , 3 )", 120);
  // whitespace never joins or splits a number
  for (const s of ["1 000", "1 .5", "2 2", "1. 5"]) bad(s);
});

// ---------- 3. numbers (§C1 tokens) ----------

test("NUMBER tokens: decimals, leading or trailing dot, scientific notation, ASCII digits only", () => {
  okExact("7", 7);
  okExact("007", 7);
  okExact("2.50", 2.5);
  okExact(".5", 0.5);
  okExact("5.", 5);
  okExact("1E3", 1000);
  okExact("1e+3", 1000);
  okExact("1e0", 1);
  okExact("2.5e-1", 0.25);
  okExact(".5e1", 5);
  okNear("1.5e-6", 1.5e-6);
  for (const s of [".", "..5", ".e1", "1.2.3", "２", "٣", "0x10", "0b101", "0o7", "1_000"]) bad(s);
});

test("scientific notation is consumed only when e/E is followed by an optional sign and a digit", () => {
  okExact("2e3", 2000);
  okExact("2E3", 2000);
  okNear("2e-1", 0.2);
  okNear("2e", 2 * E); // NUMBER 2, CONST e
  okNear("1e", E);
  okNear("2e^-1", 2 / E);
  okNear("2e^3", 2 * Math.pow(E, 3));
  okNear("2e-pi", 2 * E - PI); // "e-" not followed by a digit: 2e minus pi
  okNear("2e+pi", 2 * E + PI);
  okNear("2exp(1)", 2 * E);
  bad("2E", /unknown/i); // uppercase E is not the constant
  bad("epi", /unknown/i);
  bad("e3"); // CONST followed by NUMBER: no implicit product
});

test("comma is never a decimal point or thousands separator, only the C( , ) separator", () => {
  okExact("C(10,3)", 120);
  for (const s of ["1,000", "1,5", "0,5", "(1,2)", "sqrt(4,2)", ",1", "1,", "C(10,,3)", "C(10 3)", "C(10,3,1)", "C(10;3)"]) bad(s);
});

test("mixed fractions are not supported: 1 1/2 is an error", () => {
  bad("1 1/2");
  bad("2 3/4");
  okExact("1+1/2", 1.5);
});

// ---------- 4. operators and precedence (§C1 grammar) ----------

test("precedence table: + - lowest, then * /, then implicit product, then unary sign, then ^, then postfix ! %", () => {
  const table = [
    // contract examples, level by level
    ["5--3", 8], ["8/2/2", 2], ["1/2pi", 1 / (2 * PI)], ["2pi/3", (2 * PI) / 3],
    ["-2^2", -4], ["-3!", -6], ["--5", 5],
    ["2^3^2", 512], ["e^-1", Math.exp(-1)], ["2^-2^2", 1 / 16], ["2pi^2", 2 * PI * PI],
    ["2^3!", 64], ["3!^2", 36], ["3!!", 720], ["50%", 0.5],
    ["10C3/1024", 120 / 1024],
    // more mixes
    ["2+3*4", 14], ["2*3+4", 10], ["2+3^2", 11], ["2*3^2", 18], ["-3^2+1", -8],
    ["2+3!", 8], ["2*50%", 1], ["2^10%", Math.pow(2, 0.1)], ["(2+3)*4", 20], ["9^1/2", 4.5],
  ];
  for (const [s, want] of table) okNear(s, want);
});

test("binary + - and * / are left-associative", () => {
  okExact("10-4-3", 3);
  okExact("1-2+3", 2);
  okExact("8/2/2", 2);
  okExact("100/10/5", 2);
  okExact("6/2*3", 9);
  okExact("2/4*8", 4);
});

test("^ is right-associative and its right-hand side is a unary (may start with a sign)", () => {
  okExact("2^3^2", 512);
  okExact("(2^3)^2", 64);
  okExact("2^2^3", 256);
  okExact("2^-1", 0.5);
  okExact("2^+3", 8);
  okExact("2^--1", 2);
  okExact("2^-2^2", 1 / 16);
  okExact("4^-1/2", 0.125); // (4^-1)/2: the exponent does not swallow the division
  okExact("2^3*2", 16);
});

test("** is the same operator as ^, but only as two adjacent asterisks", () => {
  okExact("2**10", 1024);
  okExact("2**3**2", 512);
  okExact("-2**2", -4);
  okExact("2**-1", 0.5);
  okExact("2^3**2", 512);
  for (const s of ["2* *3", "2***3", "**2", "2**"]) bad(s);
});

test("unary minus and plus are prefix, repeatable, and looser than ^ and postfix", () => {
  const table = [
    ["-5", -5], ["+5", 5], ["--5", 5], ["-+5", -5], ["+-5", -5], ["---5", -5],
    ["2--3", 5], ["2*-3", -6], ["2/-4", -0.5], ["-(2+3)", -5], ["-(-2)", 2],
    ["-pi^2", -(PI * PI)], ["-2^-2", -0.25], ["(-2)^3", -8], ["-3!", -6], ["-1!", -1], ["-50%", -0.5],
  ];
  for (const [s, want] of table) okNear(s, want);
});

test("postfix % divides by 100, is repeatable, binds tighter than ^, and is not modulo", () => {
  okExact("50%", 0.5);
  okExact("100%", 1);
  okNear("36.79%", 0.3679);
  okNear("5%%", 0.0005);
  okNear("(1/2)%", 0.005);
  okExact("200%*3", 6);
  okExact("50%^2", 0.25);
  okNear("3!%", 0.06); // left to right: (3!)%
  okExact("300%!", 6); // left to right: (300%)! = 3!
  for (const s of ["7%3", "%", "%5", "5%2%"]) bad(s);
});

test("postfix ! is the factorial of an integer from 0 to 170, repeatable left to right", () => {
  okExact("0!", 1);
  okExact("1!", 1);
  okExact("5!", 120);
  okExact("10!", 3628800);
  okExact("2.0!", 2);
  okExact("(2+1)!", 6);
  okExact("3!!", 720);
  okExact("C(4,2)!", 720);
  let f170 = 1n;
  for (let i = 2n; i <= 170n; i++) f170 *= i;
  okNear("170!", Number(f170), 1e-12);
  okNear("20!", Number(2432902008176640000n), 1e-12);
});

test("factorial of a non-integer, a negative or anything above 170 is an error with keyword factorial", () => {
  for (const s of ["171!", "(-1)!", "1.5!", "pi!", "e!", "50%!", "(1/2)!", "1000!", "(0-3)!"]) bad(s, /factorial/i);
  okExact("-1!", -1); // -(1!), not (-1)!
});

test("parentheses group; unbalanced or empty parentheses are errors", () => {
  okExact("(2+3)*4", 20);
  okExact("((2))", 2);
  okExact("(((1/2)))", 0.5);
  for (const s of ["(2", "2)", "()", ")(", "(2+3", "((2)", "2+()", "(2))"]) bad(s);
});

test("dangling or doubled binary operators are syntax errors", () => {
  for (const s of ["2+", "*2", "/2", "2*", "2*/3", "2//3", "2^^3", "+", "-", "!", "^2", "2^", "!5", "2 + * 3"]) bad(s);
});

// ---------- 5. implicit multiplication (§C1) ----------

test("implicit multiplication between a number and a following constant, function or C(", () => {
  okNear("2pi", 2 * PI);
  okNear("2 pi", 2 * PI);
  okNear("2π", 2 * PI);
  okNear("2 π", 2 * PI);
  okNear("0.5pi", PI / 2);
  okNear(".5pi", PI / 2);
  okNear("3sqrt(2)", 3 * Math.SQRT2);
  okExact("3sqrt(4)", 6);
  okNear("2e^-1", 2 / E);
  okNear("2exp(1)", 2 * E);
  okNear("2ln(e)", 2);
  okNear("4log(e)", 4);
  okExact("2C(5,2)", 20);
  okExact("2 C(5,2)", 20);
});

test("implicit multiplication is allowed nowhere else", () => {
  for (const s of [
    "2(3)", "2 (3)", "(2)3", "(2)(3)", "(1/2)pi", "(2)pi", "pi2", "π2", "pi pi", "ππ", "e pi",
    "pi(2)", "e(1)", "pi sqrt(2)", "sqrt(2)sqrt(2)", "sqrt(4)2", "sqrt(4)pi", "C(5,2)2",
    "2!pi", "2%pi", "2 3",
  ]) bad(s);
});

test("implicit multiplication binds tighter than * and / but looser than ^ and postfix", () => {
  okNear("1/2pi", 1 / (2 * PI));
  okNear("6/2pi", 3 / PI);
  okNear("2pi/3", (2 * PI) / 3);
  okNear("2pi*3", 6 * PI);
  okNear("2pi^2", 2 * PI * PI);
  okNear("2pi^-1", 2 / PI);
  okNear("2^3pi", 8 * PI); // (2^3) * pi
  okNear("-2pi", -2 * PI);
  okExact("2sqrt(9)!", 12); // 2 * (3!)
  okExact("2C(3,1)!", 12); // 2 * (C(3,1)!)
});

// ---------- 6. constants and functions (§C1) ----------

test("constants e, pi and π are Math.E and Math.PI", () => {
  okNear("e", E);
  okNear("pi", PI);
  okNear("π", PI);
  okNear("π/2", PI / 2);
  okNear("e^2", E * E);
  okNear("e*pi", E * PI);
});

test("functions sqrt, ln, log (natural log, not base 10) and exp take a full expression in parentheses", () => {
  okExact("sqrt(16)", 4);
  okExact("sqrt(0)", 0);
  okExact("sqrt(9+16)", 5);
  okExact("sqrt(sqrt(16))", 2);
  okNear("sqrt(2)^2", 2);
  okNear("ln(e)", 1);
  okExact("ln(1)", 0);
  okNear("ln(exp(3))", 3);
  okNear("log(e^2)", 2);
  okNear("log(10)", Math.LN10);
  okNear("log(100)", Math.log(100));
  assert.ok(Math.abs(val("log(10)") - 1) > 0.5, "log must be the natural log, not log10");
  okNear("ln(10)", Math.LN10);
  okExact("exp(0)", 1);
  okNear("exp(1)", E);
  okNear("exp(-1)", Math.exp(-1));
  okNear("exp(ln(5))", 5);
});

test("a function name must be followed by a parenthesised argument", () => {
  for (const s of ["sqrt 4", "sqrt", "sqrt()", "exp", "ln2", "sqrt4", "sqrt(4", "sqrt)4(", "log", "ln()"]) bad(s);
});

test("function domain errors: sqrt of a negative, ln or log of zero or a negative, exp overflow", () => {
  for (const s of ["sqrt(-1)", "sqrt(-0.0001)", "ln(0)", "ln(-1)", "log(0)", "log(-e)", "exp(1000)"]) bad(s);
});

test("identifiers are case-sensitive, and any other name is an error with keyword unknown", () => {
  for (const s of [
    "PI", "Pi", "E", "c", "x", "foo", "Sqrt(4)", "SQRT(4)", "LN(2)", "Exp(1)", "sin(1)", "abs(-1)",
    "Infinity", "-Infinity", "NaN", "constructor", "toString", "valueOf", "hasOwnProperty", "prototype",
    "2pie", "epi", "ee", "10c3", "c(10,3)", "2x", "alert(1)", "import os",
  ]) bad(s, /unknown/i);
});

// ---------- 7. binomial C(n,k) and nCk (§C1) ----------

test("C(n,k) and nCk are exact integers for every 0 <= k <= n <= 54 (checked against BigInt)", () => {
  for (let n = 0; n <= 54; n++) {
    for (let k = 0; k <= n; k++) {
      const want = Number(binomBig(n, k));
      assert.equal(val(`C(${n},${k})`), want, `C(${n},${k})`);
      assert.equal(val(`${n}C${k}`), want, `${n}C${k}`);
    }
  }
});

test("nCk form: two literal NUMBER tokens around C, whitespace allowed", () => {
  okExact("10C3", 120);
  okExact("10 C 3", 120);
  okExact("10C 3", 120);
  okExact("10 C3", 120);
  okExact("5C0", 1);
  okExact("5C5", 1);
  okExact("0C0", 1);
  okExact("52C5", 2598960);
  okExact("10C3*2", 240);
  okExact("-10C3", -120);
  okExact("10C3/1024", 120 / 1024);
  for (const s of ["(10)C3", "10C(3)", "10C", "C3", "10Cpi", "10C-3", "2.5C1", "10C3.5"]) bad(s);
});

test("the nCk form is one primary: postfix ! and %, and ^ on either side, apply to the whole of it", () => {
  okExact("5C2!", 3628800); // (5C2)! = 10!, not 5C(2!)
  okNear("10C3%", 1.2); // (10C3)%
  okExact("4C2^2", 36); // (4C2)^2, not 4C(2^2)
  okExact("2^4C2", 64); // 2^(4C2)
  okExact("-4C2", -6);
  okExact("3*4C2", 18);
});

test("C(n,k) with k > n is 0; negative or non-integer arguments are errors", () => {
  okExact("C(3,5)", 0);
  okExact("3C5", 0);
  okExact("C(0,1)", 0);
  okExact("C(0,0)", 1);
  okExact("C(5,0)", 1);
  okExact("C(2+3,1+1)", 10);
  okExact("C(10, 3)", 120);
  for (const s of ["C(-1,0)", "C(5,-1)", "C(5,2.5)", "C(5.5,2)", "C(pi,1)", "C(10,1/2)", "C(10)", "C(10,3", "C(,3)", "C()", "C", "C 10 3"]) bad(s);
});

test("C(n,k) for n > 54 is within relative 1e-12 of the exact value; an overflowing result is an error", () => {
  for (const [n, k] of [[55, 26], [60, 30], [100, 50], [150, 75], [170, 85]]) {
    okNear(`C(${n},${k})`, Number(binomBig(n, k)), 1e-12);
  }
  bad("C(2000,1000)");
});

// ---------- 8. division by zero and non-finite values (§C1) ----------

test("division by zero is an error with keyword zero", () => {
  for (const s of ["1/0", "0/0", "1/(3-3)", "5/(2-2)*3", "7/0.0", "1/-0", "2/(1-1)+1"]) bad(s, /zero/i);
  okExact("0/5", 0);
});

test("any non-finite literal, intermediate or final value is an error with keyword finite", () => {
  for (const s of [
    "1e400", "-1e400", "1e400*0", "1/1e400", // a literal: the final value 0 must not hide it
    "exp(-exp(1000))", "10^400", "2^1024", "1e308*10", "1e308+1e308", "exp(1000)", "170!*1e10",
  ]) bad(s, /finite/i);
});

test("^ with a NaN or non-finite result is an error; 0^0 is 1", () => {
  for (const s of ["(-8)^(1/3)", "0^-1", "(-1)^0.5", "(-2)^0.5"]) bad(s);
  okExact("0^0", 1);
  okExact("2^0", 1);
  okExact("(-1)^2", 1);
  okExact("(-2)^3", -8);
});

// ---------- 9. anything else is an error (spec §3 F1.2) ----------

test("code-like input and non-ASCII operators are errors, never evaluated", () => {
  const inputs = [
    "6×7", "6÷3", "5−3", "2·3", "√2", "∞", "½", // × ÷ − · √ ∞ ½
    "1;2", "'1'", "\"1\"", "`1`", "[1]", "{1}", "{}", "1&2", "1|2", "1&&2", "1||2", "1<2", "1>2", "1==1",
    "x=>1", "$1", "#1", "@1", "\\1", "a.b", "Math.PI", "process.exit(1)", "require('fs')", "this",
    "window", "globalThis", "new Function()", "eval(1)", "__proto__", "with(Math)PI", "1?2:3",
  ];
  for (const s of inputs) {
    bad(s);
    ungraded(s, num("42"));
  }
});

// ---------- 10. checkNumeric (§C2) ----------

test("checkNumeric returns { correct, parsed, expected } with no error key when both sides parse", () => {
  const right = A.checkNumeric("0.1944", num("7/36"));
  assert.equal(right.correct, true);
  near(right.parsed, 0.1944, 1e-12, "parsed");
  near(right.expected, 7 / 36, 1e-12, "expected");
  assert.equal("error" in right, false);
  const wrong = A.checkNumeric("0.19", num("7/36"));
  assert.equal(wrong.correct, false);
  near(wrong.parsed, 0.19, 1e-12, "parsed");
  near(wrong.expected, 7 / 36, 1e-12, "expected");
  assert.equal("error" in wrong, false);
  const r = A.checkNumeric("2pi", num("6.2832"));
  near(r.parsed, 2 * PI, 1e-12, "parsed is the user's value");
  near(r.expected, 6.2832, 1e-12, "expected is the item's value");
});

test("checkNumeric default tolerance is rel 1e-3 or abs 1e-9, whichever is looser", () => {
  // rel is looser for large answers: tolerance 1 around 1000
  isRight("1000.5", num("1000"));
  isRight("999.5", num("1000"));
  isWrong("1001.5", num("1000"));
  isWrong("998.5", num("1000"));
  // abs is looser near zero: tolerance 1e-9
  isRight("1e-10", num("0"));
  isRight("-5e-10", num("0"));
  isWrong("1e-8", num("0"));
  isRight("1.005e-7", num("1e-7")); // off by 5e-10: beyond rel (1e-10) but within abs
  isWrong("1.05e-7", num("1e-7"));
  // the relative scale uses |expected|
  isRight("-1000.5", num("-1000"));
  isWrong("1000", num("-1000"));
  isRight("0.1945", num("7/36"));
  isWrong("0.1947", num("7/36"));
});

test("checkNumeric: the item tol overrides the default per field ({ abs } keeps rel 1e-3, { rel } keeps abs 1e-9)", () => {
  isRight("1000.5", num("1000", { abs: 0.01 })); // rel 1e-3 still applies
  isWrong("1002", num("1000", { abs: 0.01 }));
  isWrong("0.505", num("0.5")); // default rejects
  isRight("0.505", num("0.5", { abs: 0.01 }));
  isWrong("0.52", num("0.5", { abs: 0.01 }));
  isWrong("104", num("100")); // default rejects
  isRight("104", num("100", { rel: 0.05 }));
  isWrong("106", num("100", { rel: 0.05 }));
  isRight("1e-10", num("0", { rel: 0.05 })); // abs 1e-9 still applies
  isWrong("1e-6", num("0", { rel: 0.05 }));
  isRight("0.4", num("0", { rel: 0.05, abs: 0.5 }));
  isWrong("0.6", num("0", { rel: 0.05, abs: 0.5 }));
  // an empty tol object means the defaults
  isRight("1000.5", num("1000", {}));
  isWrong("0.505", num("0.5", {}));
});

test("checkNumeric: tol { rel: 0, abs: 0 } is an exact match", () => {
  const exact = { rel: 0, abs: 0 };
  isRight("12", num("12", exact));
  isRight("24/2", num("12", exact));
  isWrong("12.0000001", num("12", exact));
  isWrong("12.000000000001", num("12", exact));
  isRight("7/36", num("7/36", exact));
  isRight("14/72", num("7/36", exact)); // the same correctly rounded quotient
  isWrong("0.1944", num("7/36", exact));
  isWrong("0.19444444444", num("7/36", exact));
  isRight("10C3/1024", num("120/1024", exact));
  isRight("0.1171875", num("120/1024", exact));
});

test("checkNumeric: the tolerance inequality is inclusive (<=)", () => {
  // all values below are exact in binary
  isRight("8.5", num("8", { rel: 0, abs: 0.5 }));
  isRight("7.5", num("8", { rel: 0, abs: 0.5 }));
  isWrong("8.75", num("8", { rel: 0, abs: 0.5 }));
  isRight("5", num("4", { rel: 0.25, abs: 0 }));
  isRight("3", num("4", { rel: 0.25, abs: 0 }));
  isWrong("5.25", num("4", { rel: 0.25, abs: 0 }));
});

test("checkNumeric: a parse error is never counted as wrong (correct null, expected kept, error returned)", () => {
  const item = num("7/36");
  const inputs = ["", "   ", "2 3", "1/0", "import os", "alert(1)", "171!", "1,5", "0.19.", "seven", "x".repeat(201), "=", "1e400", "0.19%%%("];
  for (const s of inputs) {
    const r = ungraded(s, item);
    assert.notEqual(r.correct, false, show(s));
    near(r.expected, 7 / 36, 1e-12, `expected kept for ${show(s)}`);
  }
  // the parse error of the user's string is passed through
  assert.match(A.checkNumeric("", item).error, /empty/i);
  assert.match(A.checkNumeric("1/0", item).error, /zero/i);
  assert.match(A.checkNumeric("x".repeat(201), item).error, /long/i);
  assert.match(A.checkNumeric("171!", item).error, /factorial/i);
  assert.match(A.checkNumeric("foo", item).error, /unknown/i);
  // a missing user answer is a parse error too, not a wrong answer
  for (const x of [null, undefined]) {
    const r = A.checkNumeric(x, item);
    assert.equal(r.correct, null, String(x));
    assert.equal(r.parsed, null);
    near(r.expected, 7 / 36, 1e-12, "expected");
    assert.ok(typeof r.error === "string" && r.error.length > 0);
  }
  // a number instead of a string: §C2 [decision, Red] converts nothing, so it is a parse error
  // (ungraded, expected kept), never counted as right or wrong
  const n = A.checkNumeric(0.1944, item);
  assert.equal(n.correct, null);
  assert.equal(n.parsed, null);
  near(n.expected, 7 / 36, 1e-12, "expected");
  assert.ok(typeof n.error === "string" && n.error.length > 0);
});

test("checkNumeric: an item whose answer does not parse is a broken item (expected null, keyword item)", () => {
  for (const value of ["1/0", "seven", "", "2 3", "C(5,-1)", "1e400", "171!", "1,5", "=="]) {
    for (const user of ["0.5", "", "nonsense"]) {
      const r = A.checkNumeric(user, num(value));
      assert.equal(r.correct, null, `${show(value)} / ${show(user)}`);
      assert.equal(r.parsed, null);
      assert.equal(r.expected, null);
      assert.equal(typeof r.error, "string");
      assert.match(r.error, /item/i);
    }
  }
  // a numeric item with no value at all, or a non-string value, is broken too (§C2 [decision, Red]:
  // no conversion)
  for (const answer of [{}, { value: 0.5 }]) {
    const r = A.checkNumeric("0.5", { type: "numeric", answer });
    assert.equal(r.correct, null, JSON.stringify(answer));
    assert.equal(r.expected, null, JSON.stringify(answer));
    assert.match(r.error, /item/i);
  }
});

test("checkNumeric ignores item.type, so OA question objects work the same way", () => {
  isRight("12", { type: "mcq", answer: { value: "12" } });
  const oa = { prompt: "6 x 2", answer: { value: "12", tol: { rel: 0, abs: 0 } } };
  isRight("12", oa);
  isWrong("13", oa);
  isRight("2pi", { answer: { value: "6.2832" } });
});

test("checkNumeric accepts any equivalent form the grammar allows", () => {
  const item = num("7/36");
  for (const s of ["=7/36", " 7 / 36 ", "14/72", "0.19444", "C(8,2)/144", "7/6^2", "19.444%", "7/36*1"]) isRight(s, item);
});

test("checkNumeric does not mutate the item and is deterministic", () => {
  const item = { id: "synthetic-q1", type: "numeric", answer: { value: "7/36", tol: { abs: 0.01 } }, topics: ["dice"] };
  const before = structuredClone(item);
  const first = A.checkNumeric("0.2", item);
  A.checkNumeric("0.5", item);
  A.checkNumeric("2 3", item);
  A.checkNumeric("0.2", num("1/0"));
  assert.deepEqual(item, before);
  assert.deepEqual(A.checkNumeric("0.2", item), first);
});

// ---------- 11. checkMcq (§C3) ----------

const MCQ4 = { type: "mcq", answer: { choices: ["one", "two", "three", "four"], correct: 2 } };

test("checkMcq: a valid index returns { correct, parsed: index, expected }", () => {
  const r = A.checkMcq(2, MCQ4);
  assert.equal(r.correct, true);
  assert.equal(r.parsed, 2);
  assert.equal(r.expected, 2);
  assert.equal(r.error, undefined);
  for (const i of [0, 1, 3]) {
    const w = A.checkMcq(i, MCQ4);
    assert.equal(w.correct, false, String(i));
    assert.equal(w.parsed, i);
    assert.equal(w.expected, 2);
    assert.equal(w.error, undefined);
  }
  const two = { type: "mcq", answer: { choices: ["yes", "no"], correct: 0 } };
  assert.equal(A.checkMcq(0, two).correct, true);
  assert.equal(A.checkMcq(1, two).correct, false);
  const eight = { type: "mcq", answer: { choices: ["a", "b", "c", "d", "e", "f", "g", "h"], correct: 7 } };
  assert.equal(A.checkMcq(7, eight).correct, true);
  assert.equal(A.checkMcq(6, eight).correct, false);
});

test("checkMcq: a non-integer or out-of-range index (numeric strings included) is an error, never counted", () => {
  for (const i of [-1, 4, 5, 1.5, "2", "0", NaN, Infinity, -Infinity, null, undefined, true, [2], {}]) {
    const r = A.checkMcq(i, MCQ4);
    assert.equal(r.correct, null, show(i));
    assert.equal(r.parsed, null, show(i));
    assert.equal(r.expected, 2, show(i));
    assert.ok(typeof r.error === "string" && r.error.length > 0, show(i));
  }
  const two = { type: "mcq", answer: { choices: ["yes", "no"], correct: 1 } };
  const r = A.checkMcq(2, two);
  assert.equal(r.correct, null);
  assert.equal(r.expected, 1);
  assert.ok(typeof r.error === "string" && r.error.length > 0);
});

test("checkMcq does not mutate the item and is deterministic", () => {
  const before = structuredClone(MCQ4);
  const first = A.checkMcq(1, MCQ4);
  A.checkMcq(2, MCQ4);
  A.checkMcq(9, MCQ4);
  assert.deepEqual(MCQ4, before);
  assert.deepEqual(A.checkMcq(1, MCQ4), first);
});

// ---------- 12. formatPreview (§C4) ----------

test("formatPreview shows 6 significant digits and drops trailing zeros (contract examples)", () => {
  assert.equal(A.formatPreview(7 / 36), "0.194444");
  assert.equal(A.formatPreview(2 * PI), "6.28319");
  assert.equal(A.formatPreview(0.001), "0.001");
  assert.equal(A.formatPreview(120), "120");
});

test("formatPreview on negatives, large and tiny values, and float noise", () => {
  const cases = [
    [1 / 3, "0.333333"], [2 / 3, "0.666667"], [-1 / 3, "-0.333333"], [0, "0"], [-2.5, "-2.5"],
    [0.5, "0.5"], [E, "2.71828"], [0.1 + 0.2, "0.3"], [161 / 36, "4.47222"], [Math.SQRT1_2, "0.707107"],
    [123456789, "123457000"], [1000000, "1000000"], [1e21, "1e+21"], [1e-7, "1e-7"],
  ];
  for (const [v, want] of cases) assert.equal(A.formatPreview(v), want, String(v));
});

test("formatPreview composes with parseAnswer for the live preview", () => {
  assert.equal(A.formatPreview(val("2pi")), "6.28319");
  assert.equal(A.formatPreview(val("7/36")), "0.194444");
  assert.equal(A.formatPreview(val("1e-3")), "0.001");
  assert.equal(A.formatPreview(val("5!")), "120");
  assert.equal(A.formatPreview(val("1/e")), "0.367879");
});
