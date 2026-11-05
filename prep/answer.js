// v4 prep/answer.js (PrepAnswer): the safe answer parser behind every numeric check
// (V4-CONTRACTS §C, spec §3 F1.2). A hand-written tokenizer plus a recursive-descent parser:
// the input is never handed to the JS engine to run (no eval, no Function constructor, no
// `with`). Plain browser script and Node module (§A5): one `var` global, no dependencies, no
// DOM, no clock, no Math.random.
//
// Grammar (§C1), lowest to highest precedence:
//   input   := expr EOF
//   expr    := term (("+" | "-") term)*            left-assoc
//   term    := imul (("*" | "/") imul)*            left-assoc
//   imul    := unary (IMUL unary)*                 implicit product, left-assoc
//   unary   := ("-" | "+") unary | power           prefix
//   power   := postfix ("^" unary)?                right-assoc ("**" is "^")
//   postfix := primary ("!" | "%")*                left to right
//   primary := NUMBER | NUMBER "C" NUMBER | CONST
//            | FUNC "(" expr ")" | "C" "(" expr "," expr ")" | "(" expr ")"
// IMUL is a token inserted only straight after a NUMBER that is followed by a CONST, a FUNC,
// or a `C` followed by "(".

var PrepAnswer = (function () {
  const MAX_INPUT_LENGTH = 200;
  const DEFAULT_TOL = Object.freeze({ rel: 1e-3, abs: 1e-9 });
  const MAX_FACTORIAL = 170;

  // Token types.
  const NUM = "number";
  const CONST = "constant";
  const FUNC = "function";
  const BINOM = "C";
  const OP = "operator";
  const IMUL = "implicit";
  const END = "end";

  // Thrown inside the parser for any user-facing problem; parseAnswer turns it into
  // { ok: false, error }. Anything else that throws is a bug and is not swallowed.
  class AnswerError extends Error {}
  function fail(message) {
    throw new AnswerError(message);
  }

  // ASCII only: look-alike digits such as "٣" or "２" are not digits here.
  // Callers pass one character from charAt, which gives "" past the end (never a digit).
  const isDigit = (ch) => ch >= "0" && ch <= "9";
  const isLetter = (ch) => (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z");
  const isSpace = (ch) => /\s/.test(ch);
  const isOp = (t, op) => t !== undefined && t.type === OP && t.op === op;
  const show = (v) => formatPreview(v);

  // A non-finite literal, intermediate or result is always the `finite` error (§C1).
  function finite(v, what) {
    if (Number.isFinite(v)) return v;
    return fail(Number.isNaN(v)
      ? `${what} is not a finite real number`
      : `${what} is not finite (too large or infinite)`);
  }

  // ---------- tokenizer ----------

  // NUMBER: \d+(\.\d*)? or \.\d+, then an exponent [eE][+-]?\d+ only when a digit follows the
  // e/E and its optional sign (so "2e" is 2·e and "2e-pi" is 2e − π). Returns the end index.
  function scanNumber(s, i) {
    let j = i;
    while (isDigit(s.charAt(j))) j++;
    if (s.charAt(j) === ".") {
      j++;
      while (isDigit(s.charAt(j))) j++;
    }
    const c = s.charAt(j);
    if (c === "e" || c === "E") {
      let k = j + 1;
      if (s.charAt(k) === "+" || s.charAt(k) === "-") k++;
      if (isDigit(s.charAt(k))) {
        while (isDigit(s.charAt(k))) k++;
        j = k;
      }
    }
    return j;
  }

  // The only names there are. A switch, not an object lookup, so "constructor" or "toString"
  // can never reach Object.prototype.
  function word(name) {
    switch (name) {
      case "e": return { type: CONST, value: Math.E };
      case "pi": return { type: CONST, value: Math.PI };
      case "sqrt":
      case "ln":
      case "log":
      case "exp": return { type: FUNC, name };
      case "C": return { type: BINOM };
      default: return null;
    }
  }

  function tokenize(s, start) {
    const tokens = [];
    let i = start;
    while (i < s.length) {
      const ch = s.charAt(i);
      if (isSpace(ch)) {
        i++;
      } else if (isDigit(ch) || (ch === "." && isDigit(s.charAt(i + 1)))) {
        const j = scanNumber(s, i);
        const text = s.slice(i, j);
        const value = finite(Number(text), `The number ${text}`);
        tokens.push({ type: NUM, value, text });
        i = j;
      } else if (isLetter(ch)) {
        let j = i;
        while (isLetter(s.charAt(j))) j++;
        const text = s.slice(i, j);
        const tok = word(text);
        if (!tok) fail(`Unknown name "${text}": only e, pi, sqrt, ln, log, exp and C(n,k) are allowed`);
        tok.text = text;
        tokens.push(tok);
        i = j;
      } else if (ch === "π") {
        tokens.push({ type: CONST, value: Math.PI, text: ch });
        i++;
      } else if (ch === "*" && s.charAt(i + 1) === "*") {
        tokens.push({ type: OP, op: "^", text: "**" });
        i += 2;
      } else if ("+-*/^!%(),".indexOf(ch) >= 0) {
        tokens.push({ type: OP, op: ch, text: ch });
        i++;
      } else {
        fail(`Unexpected character "${String.fromCodePoint(s.codePointAt(i))}": use digits, `
          + "+ - * / ^ ! % ( ) and the names e, pi, sqrt, ln, log, exp, C");
      }
    }
    return withImplicitProducts(tokens);
  }

  // Insert IMUL between a NUMBER and a directly following CONST, FUNC, or `C` + "(" (§C1). A
  // NUMBER `C` NUMBER run is the nCk form and gets none.
  function withImplicitProducts(tokens) {
    const out = [];
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      const next = tokens[i + 1];
      out.push(t);
      if (t.type === NUM && next !== undefined
          && (next.type === CONST || next.type === FUNC || (next.type === BINOM && isOp(tokens[i + 2], "(")))) {
        out.push({ type: IMUL, text: "" });
      }
    }
    out.push({ type: END, text: "" });
    return out;
  }

  // ---------- semantics ----------

  function factorial(x) {
    if (!Number.isInteger(x) || x < 0 || x > MAX_FACTORIAL) {
      fail(`Factorial needs a whole number from 0 to ${MAX_FACTORIAL} (got ${show(x)})`);
    }
    let r = 1;
    for (let i = 2; i <= x; i++) r *= i;
    return r;
  }

  // C(n,k) with the multiplicative formula of §C1. k > n is 0. The loop stops at the first
  // non-finite partial product: each factor is at least 2 (k' <= n − k'), so even a huge k'
  // overflows within about a thousand steps, and once infinite it would stay infinite.
  function binomial(n, k) {
    if (!Number.isInteger(n) || !Number.isInteger(k) || n < 0 || k < 0) {
      fail(`C(n,k) needs whole numbers n >= 0 and k >= 0 (got C(${show(n)},${show(k)}))`);
    }
    if (k > n) return 0;
    const kk = Math.min(k, n - k);
    let r = 1;
    for (let i = 1; i <= kk; i++) {
      r = r * (n - kk + i) / i;
      finite(r, `C(${show(n)},${show(k)})`);
    }
    return r;
  }

  function applyFunc(name, x) {
    switch (name) {
      case "sqrt":
        if (!(x >= 0)) fail(`sqrt needs a number >= 0 (got ${show(x)})`);
        return Math.sqrt(x);
      case "ln":
      case "log":
        if (!(x > 0)) fail(`${name} needs a number > 0 (got ${show(x)})`);
        return Math.log(x);
      default: // exp
        return finite(Math.exp(x), `exp(${show(x)})`);
    }
  }

  function unexpected(t) {
    switch (t.type) {
      case END: return "Incomplete expression: something is missing at the end";
      case NUM: return `Unexpected number ${t.text}: put an operator such as * between two numbers `
        + "(mixed fractions like 1 1/2 are not supported)";
      case CONST:
      case FUNC: return `Unexpected "${t.text}": implicit multiplication only works straight after `
        + "a number, so write * here";
      case BINOM: return 'Unexpected "C": write C(n,k), or nCk with two plain numbers such as 10C3';
      default:
        if (t.op === ",") return 'Unexpected ",": a comma only separates the two numbers in C(n,k); it is never a decimal point';
        if (t.op === "(") return 'Unexpected "(": write * before a bracket';
        return `Unexpected "${t.text}"`;
    }
  }

  // ---------- parser (evaluates as it goes) ----------

  function parseTokens(tokens) {
    let p = 0;

    function expect(op, message) {
      if (!isOp(tokens[p], op)) fail(message);
      p++;
    }

    function expr() {
      let v = term();
      for (;;) {
        if (isOp(tokens[p], "+")) {
          p++;
          v = finite(v + term(), "The sum");
        } else if (isOp(tokens[p], "-")) {
          p++;
          v = finite(v - term(), "The difference");
        } else {
          return v;
        }
      }
    }

    function term() {
      let v = imul();
      for (;;) {
        if (isOp(tokens[p], "*")) {
          p++;
          v = finite(v * imul(), "The product");
        } else if (isOp(tokens[p], "/")) {
          p++;
          const d = imul();
          if (d === 0) fail("Division by zero");
          v = finite(v / d, "The quotient");
        } else {
          return v;
        }
      }
    }

    function imul() {
      let v = unary();
      while (tokens[p].type === IMUL) {
        p++;
        v = finite(v * unary(), "The product");
      }
      return v;
    }

    function unary() {
      if (isOp(tokens[p], "-")) {
        p++;
        return -unary();
      }
      if (isOp(tokens[p], "+")) {
        p++;
        return unary();
      }
      return power();
    }

    function power() {
      const base = postfix();
      if (!isOp(tokens[p], "^")) return base;
      p++;
      const exponent = unary();
      const shown = base < 0 ? `(${show(base)})` : show(base);
      return finite(Math.pow(base, exponent), `${shown}^${show(exponent)}`);
    }

    function postfix() {
      let v = primary();
      for (;;) {
        if (isOp(tokens[p], "!")) {
          p++;
          v = factorial(v);
        } else if (isOp(tokens[p], "%")) {
          p++;
          v = v / 100;
        } else {
          return v;
        }
      }
    }

    function primary() {
      const t = tokens[p];
      if (t.type === NUM) {
        p++;
        // nCk: both operands are literal NUMBER tokens (§C1).
        if (tokens[p].type === BINOM && tokens[p + 1].type === NUM) {
          const k = tokens[p + 1].value;
          p += 2;
          return binomial(t.value, k);
        }
        return t.value;
      }
      if (t.type === CONST) {
        p++;
        return t.value;
      }
      if (t.type === FUNC) {
        p++;
        expect("(", `${t.name} must be followed by a bracket, as in ${t.name}(2)`);
        const x = expr();
        expect(")", `Missing ) after ${t.name}(`);
        return applyFunc(t.name, x);
      }
      if (t.type === BINOM) {
        p++;
        expect("(", "C must be written C(n,k), or nCk with two plain numbers such as 10C3");
        const n = expr();
        expect(",", "C(n,k) needs two numbers separated by a comma");
        const k = expr();
        expect(")", "Missing ) after C(n,k");
        return binomial(n, k);
      }
      if (isOp(t, "(")) {
        p++;
        const v = expr();
        expect(")", "Missing )");
        return v;
      }
      return fail(unexpected(t));
    }

    const value = expr();
    if (tokens[p].type !== END) fail(unexpected(tokens[p]));
    return value;
  }

  // ---------- exports ----------

  // { ok: true, value } with a finite value (-0 becomes 0), or { ok: false, error } (§C1).
  function parseAnswer(str) {
    if (typeof str !== "string") return { ok: false, error: "The answer must be text" };
    if (str.length > MAX_INPUT_LENGTH) {
      return { ok: false, error: `Answer is too long (more than ${MAX_INPUT_LENGTH} characters)` };
    }
    let i = 0;
    while (i < str.length && isSpace(str.charAt(i))) i++;
    if (str.charAt(i) === "=") i++;
    if (!/\S/.test(str.slice(i))) {
      return { ok: false, error: "Empty answer: type a number or an expression" };
    }
    try {
      const v = parseTokens(tokenize(str, i));
      return { ok: true, value: v === 0 ? 0 : v };
    } catch (e) {
      if (e instanceof AnswerError) return { ok: false, error: e.message };
      throw e;
    }
  }

  // §C2. A broken item (its stored answer does not parse) gives expected: null; a user parse
  // error is never graded (correct: null) and keeps expected.
  function checkNumeric(userStr, item) {
    const answer = item !== null && item !== undefined ? item.answer : undefined;
    const exp = parseAnswer(answer !== null && answer !== undefined ? answer.value : undefined);
    if (!exp.ok) {
      return { correct: null, parsed: null, expected: null, error: `Broken item: its stored answer does not parse (${exp.error})` };
    }
    const u = parseAnswer(userStr);
    if (!u.ok) return { correct: null, parsed: null, expected: exp.value, error: u.error };
    const tol = answer.tol;
    const rel = tol && tol.rel !== undefined ? tol.rel : DEFAULT_TOL.rel;
    const abs = tol && tol.abs !== undefined ? tol.abs : DEFAULT_TOL.abs;
    const correct = Math.abs(u.value - exp.value) <= Math.max(abs, rel * Math.abs(exp.value));
    return { correct, parsed: u.value, expected: exp.value };
  }

  // §C3. Only an integer index inside the choices is graded; numeric strings are errors.
  function checkMcq(index, item) {
    const answer = item !== null && item !== undefined && item.answer ? item.answer : {};
    const expected = answer.correct !== undefined ? answer.correct : null;
    const count = Array.isArray(answer.choices) ? answer.choices.length : 0;
    if (!Number.isInteger(index) || index < 0 || index >= count) {
      const error = count === 0 ? "Broken item: it has no choices" : `Pick one of the ${count} choices`;
      return { correct: null, parsed: null, expected, error };
    }
    return { correct: index === expected, parsed: index, expected };
  }

  // §C4: six significant digits, trailing zeros dropped. "" for anything that is not a finite
  // number (parseAnswer never produces one).
  function formatPreview(value) {
    if (typeof value !== "number" || !Number.isFinite(value)) return "";
    return String(Number(value.toPrecision(6)));
  }

  return { MAX_INPUT_LENGTH, DEFAULT_TOL, parseAnswer, checkNumeric, checkMcq, formatPreview };
})();
if (typeof module !== "undefined") module.exports = PrepAnswer;
