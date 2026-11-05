# Accountability Machine v4: interface contracts

Draft 2 (revised after three critic reviews). Companion to `SPEC-v4.md`. This file is the single
source of truth for every interface the spec leaves open. Test writers write tests from the spec
plus this file. Implementers make those tests pass. The judge rules on disputes using only the
spec and this file.

## 0. How to read this document

- **Precedence:** `SPEC-v4.md` beats this file, and this file beats the existing code. Where this
  file restates the spec it cites the section, e.g. "(spec §3 F1.3)". If you find a contradiction,
  the spec wins: file a dispute and do not "fix" it silently.
- **[decision]** marks a choice made here because the spec is silent. Every one is listed in
  `BUILD-NOTES.md` §1. **[decision, Red]** marks a gap that the Red-phase test writers and
  reviewers raised and that was settled before the pre-lock tag; these are listed in
  `BUILD-NOTES.md` §1 under "Red-phase gap resolutions".
- **MUST / MAY.** "Tests may assert X" means a test can rely on X. "Implementation-defined" means
  tests MUST NOT assert it.
- **Exports.** Each module section lists its exports. Tests MUST NOT rely on anything that is not
  listed, and implementations MAY export more.
- **Spec section numbers** used below: §1 decisions, §2 architecture and storage, §3 F1 (bank,
  answers, scheduler, Practice UI), §4 F2 decks, §5 F3 OA, §6 F4 market, §7 F5 mocks, §8 F6
  dashboard, §9 F7 buddy, §10 F8 pipeline, §11 test-first protocol, §12 milestones, §13 done.

---

## A. Global conventions

### A1. Time

- Time is ms since the Unix epoch, as a JS number.
- Pure modules (`prep/*.js`) never read the clock. Every time-dependent function takes the time
  as an explicit argument named `now` (the current time) or `ts` (the timestamp to stamp an
  entry with). `Date.now()` may appear only as a default parameter value, e.g.
  `amDrillEntry(args, ts = Date.now(), bankTopics = null)`, and tests always pass the argument.
- `DAY = 86400000`, `MINUTE = 60000`, both exported by `prep/srs.js`.
- Intervals in the SRS are whole days. A due time is `now + interval * DAY`: plain ms arithmetic,
  not aligned to midnight (spec §3 F1.3).

### A2. "Today" and local days

- "Today" means the local calendar day of `now`: `amTodayKey(new Date(now))` from `shared.js`.
  It returns `"YYYY-MM-DD"` in the machine's local time zone.
- `localDayStart(ts, k = 0)` (exported by `prep/srs.js`) returns the ms of local midnight that
  starts the day `k` days after the local day of `ts`:
  `const d = new Date(ts); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + k).getTime();`
  This is DST-safe because it uses the local date constructor.
- Tests MUST build times with the local constructor, e.g. `new Date(2026, 10, 4, 15, 0, 0).getTime()`,
  the same as `tests/practice.test.js`. They MUST NOT hard-code epoch numbers for day-boundary
  cases.

### A3. Purity and mutation

- `prep/*.js` contains no `chrome.*`, no `document`, no `window`, no `fetch`, no `localStorage`,
  no `Date.now()` (except default parameters), no `Math.random()`, and no `eval` / `Function`.
- No exported function mutates its arguments. Functions that "update" something (`schedule`,
  `submitQuote`, `drillAdvance`, `appendCapped`, …) return a new object or array. Tests may
  deep-clone an input, call the function, and `deepEqual` the input with the clone.
- Every exported function is deterministic: equal inputs give deep-equal outputs.
- Array parameters accept `null` or `undefined` as `[]`, and object-map parameters (`cards`,
  `facts`) accept `null` or `undefined` as `{}`, unless a section says otherwise.
- **[decision, Red]** The no-mutation and determinism rules also cover the v4 change to
  `practice.js` (`amWeeklyReviewTrigger` with `prep`, §H8). The file-level bans in the first
  bullet apply to `prep/*.js` only.
- **[decision, Red]** In §H, where a result holds input objects (`nc150Progress().next`, the
  `mistakeTopics` entries, the `pickInterviewMaterial` items), identity is not contract: the
  result may hold the same objects or deep-equal copies, and tests compare them with `deepEqual`.
  (`PrepBank.allItems` is different: §E5 promises the same objects.)

### A4. Errors

There are two styles. Each function below says which one it uses.

| Style | Used for | Shape |
|---|---|---|
| **Result object** | Validating user or model input | `{ ok: false, error }`, `{ error }` or `{ correct: null, …, error }`, exactly as the function's section states. `error` is a non-empty string. |
| **Throw** | Programmer errors (unknown kind, bad grade, impossible arguments) | Throws an `Error` (or subclass). |

- Tests may assert that an error EXISTS (`typeof r.error === "string" && r.error.length > 0`, or
  `assert.throws(fn)`).
- Tests MUST NOT assert the full text of an error message. Where this file lists a **keyword**,
  tests may assert `assert.match(r.error, /keyword/i)`, and the implementation MUST include that
  keyword (case-insensitive).
- Thrown errors: tests may use `assert.throws(fn)` with no message matcher, except where a keyword
  is listed.

### A5. Modules, globals and load order

**Module pattern.** Every `prep/*.js` file has this shape, so it runs as a plain browser script and
as a Node module (the same idea as `practice.js`):

```js
// prep/srs.js
var PrepSrs = (function () {
  const B = typeof PrepBank !== "undefined" ? PrepBank : require("./bank.js");
  const amTodayKey = typeof globalThis.amTodayKey === "function"
    ? globalThis.amTodayKey : require("../shared.js").amTodayKey;
  // ... private helpers ...
  return { DAY, MINUTE, newCard, schedule /* , ... */ };
})();
if (typeof module !== "undefined") module.exports = PrepSrs;
```

- Each file declares exactly ONE top-level binding: its namespace object, declared with `var`
  (never `const` or `let`, which would throw on a duplicate declaration between classic scripts).
- In Node, tests do `const { schedule } = require("../prep/srs.js")`. `module.exports` is the
  namespace object, so every export listed below is a property of it.
- Dependencies are resolved at load time with `typeof X !== "undefined" ? X : require(...)`. In
  the browser the earlier script provides the global. In Node nothing is global, so `require` runs.
  A wrong browser load order fails loudly (`require is not defined`).
- `const` globals from `practice.js` (e.g. `AM_CHECKPOINTS`) are global lexical bindings, not
  `globalThis` properties. Test for them by identifier: `typeof AM_CHECKPOINTS !== "undefined"`.
- `shared.js` and `practice.js` keep their existing flat globals (`amTodayKey`, `AM_CHECKPOINTS`,
  `amPracticeEntry`, …).

**Global names [decision].** Namespace prefix `Prep`:

| File | Global | Requires |
|---|---|---|
| `prep/rng.js` | `PrepRng` | nothing |
| `prep/answer.js` | `PrepAnswer` | nothing |
| `prep/bank.js` | `PrepBank` | `answer.js` |
| `prep/srs.js` | `PrepSrs` | `bank.js`, `shared.js` |
| `prep/oa.js` | `PrepOA` | `rng.js`, `answer.js` |
| `prep/market.js` | `PrepMarket` | `rng.js` |
| `prep/readiness.js` | `PrepReadiness` | `bank.js`, `srs.js`, `practice.js`, `shared.js` |
| `prep-loader.js` (root, not pure) | `prepLoadBank` (one async function) | nothing (§E6) |
| `prep-ui.js` (root, not pure) | none: the whole file is wrapped in `(() => { … })();` | everything above |

- These names do not collide with anything in `sidepanel.js`, `practice.js`, `shared.js`,
  `log.js`, `content-*.js` or `background.js` (checked against v3.0.0).
- New top-level identifiers added to `sidepanel.js` MUST start with `prep` or `noAI`
  (for example `prepData`, `prepPromptParts`, `noAIPending`), and MUST NOT be `prepLoadBank`.
- `background.js` additions are plain functions prefixed `prep` (e.g. `prepOpenTab`).

**Browser load order.**

`prep.html` (after `<link rel="stylesheet">` for `prep.css` and `vendor/katex/katex.min.css`):

```
vendor/katex/katex.min.js
vendor/katex/contrib/auto-render.min.js
vendor/marked.min.js
vendor/purify.min.js
log.js
shared.js
practice.js
prep/rng.js
prep/answer.js
prep/bank.js
prep/srs.js
prep/oa.js
prep/market.js
prep/readiness.js
prep-loader.js
prep-ui.js
```

`sidepanel.html` (the existing order, with the prep files inserted before `sidepanel.js`):

```
vendor/marked.min.js, vendor/purify.min.js, log.js, shared.js, practice.js,
prep/answer.js, prep/bank.js, prep/srs.js, prep/readiness.js, prep-loader.js,
sidepanel.js
```

- MV3 extension pages forbid inline scripts, so every script is an external file.
- `prep.html` calls `amLogInit("prep")`, so its logs go to the ring buffer `amLogs_prep`
  **[decision]**.

### A6. Shared vocabulary

| Name | Value | Defined in |
|---|---|---|
| `AREAS` | `["probability","brainteaser","statistics","finance","cpp","systems"]` (schema order) | `PrepBank` |
| `PRACTICE_AREAS` | `["probability","brainteaser","statistics","finance"]` | `PrepBank` |
| `CARD_AREAS` | `["cpp","systems"]` | `PrepBank` |
| `AREA_ORDER` | `["probability","brainteaser","cpp","systems","statistics","finance"]` (round-robin order, spec §3 F1.3) | `PrepSrs` |
| `GRADES` | `["again","hard","good","easy"]` | `PrepSrs` |
| `AREA_KEYS` | `["coding","probability","cpp","systems","mental","oa","market","mocks"]` (readiness areas, spec §8) | `PrepReadiness` |
| `MOCK_MODES` | `["dsa","quantdev","cv","trader"]` | `PrepReadiness` |
| `KINDS` | `["arith","eighty","seq","ev"]` | `PrepOA` |
| `SCENARIOS` | `["dice","cards","coins"]` | `PrepMarket` |

- **"Bank" parameter.** In `prep/srs.js` and `prep/readiness.js`, a parameter named `bank` is the
  **array of item objects**: the merged list from `PrepBank.allItems(bankJson, [cppDeck, systemsDeck])`.
  Only `id`, `area`, `topics`, `difficulty`, `type`, `prompt`, `answer` and `source` are read.
  **Bank order** means the index in that array. `null` means no bank, and is treated as `[]`.
  - **[decision]** Every parameter named `bank` in §D and §H, and the `items` parameter of
    `PrepBank.topicSet`, `indexById` and `sourceCounts`, accepts EITHER an `Item[]` OR any object
    with an `items` array (a `bank.json` object, a deck, or the §E6 loader result), which is read as
    its `items`. Tests may pass either form.
- **Words for the three things called "bank":** `bankJson` is the parsed `bank.json` object (the
  first argument of `allItems`; `bankValidate(bank)` takes it, a deck, or `{ items }`, §E4);
  `items` / `bank` is the merged item array; `prepData` is the §E6 loader result held by the side
  panel. (`bankValidate` is not covered by the dual-form rule above: it needs an object with an
  `items` array.)
- **Separator.** Inline lists in prompt lines use `" · "` (space, U+00B7 middle dot, space), the
  same as `amTodayLine`.

---

## B. `prep/rng.js` (`PrepRng`)

Exports: `rngNext`, `mulberry32`, `randInt`, `pick`, `shuffle`.

### B1. Reference algorithm (exact)

```js
// One step of mulberry32. state: uint32. Returns the next value in [0, 1) and the next state.
function rngNext(state) {
  const a = (state + 0x6D2B79F5) >>> 0;
  let t = Math.imul(a ^ (a >>> 15), a | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return { value: ((t ^ (t >>> 14)) >>> 0) / 4294967296, state: a };
}

function mulberry32(seed) {
  let s = seed >>> 0;
  return function () { const r = rngNext(s); s = r.state; return r.value; };
}
```

- This produces exactly the same sequence as the well-known reference
  `function(a){return function(){var t=a+=0x6D2B79F5;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296}}`
  (checked for 200,000 draws).
- The seed is coerced with `>>> 0`, so any number works. Tests use integers in `[0, 2^32)`.
- **[decision, Red]** `rngNext(state)` returns an object with AT LEAST `value` and `state` (extra
  keys are implementation-defined). `state` is exactly the reference's `a`, i.e.
  `(state + 0x6D2B79F5) mod 2^32` as a uint32, and `value` is exactly the reference value.
- Reference values (tests may assert them exactly):
  - `mulberry32(1)` → `0.6270739405881613, 0.002735721180215478, 0.5274470399599522`
  - `mulberry32(42)` → `0.6011037519201636, 0.44829055899754167, 0.8524657934904099`
  - `mulberry32(0)` → `0.26642920868471265, 0.0003297457005828619, 0.2232720274478197`

### B2. Helpers (each uses exactly the number of draws stated)

| Function | Definition | Draws | Errors (throw) |
|---|---|---|---|
| `randInt(rng, lo, hi)` | `lo + Math.floor(rng() * (hi - lo + 1))`, inclusive of both ends | 1 | `lo`, `hi` not integers, or `lo > hi` |
| `pick(rng, arr)` | `arr[Math.floor(rng() * arr.length)]` | 1 | empty or non-array `arr` |
| `shuffle(rng, arr)` | Fisher–Yates on a copy: `for (let i = a.length - 1; i > 0; i--) { const j = randInt(rng, 0, i); [a[i], a[j]] = [a[j], a[i]]; }`, returns the copy | `max(0, n - 1)` | non-array |

- Reference: `randInt` on `mulberry32(42)` with `(1, 6)`, ten times, gives `4,3,6,5,2,4,2,4,6,3`.
- **[decision, Red]** Details of the table:
  - "Integer" means `Number.isInteger(x)`: numeric strings (`"1"`), `NaN`, `±Infinity`,
    `undefined` and non-integral numbers are not integers, so `randInt` throws on them. Every range
    with `hi − lo + 1 <= 2^32` MUST work with the formula as written (e.g. `[0, 2^32 − 1]`).
    Behaviour for bounds beyond `Number.MAX_SAFE_INTEGER` is implementation-defined.
  - Whether a call that throws has consumed a draw first is implementation-defined; tests MUST NOT
    assert the stream position after a throwing call.
  - `shuffle` makes a SHALLOW copy (`arr.slice()`): the result holds the input's own element
    references, in a new order. `pick` returns the element itself.
  - `null` and `undefined` follow §A3 (read as `[]`): `shuffle(rng, null)` returns `[]` with no
    draw, and `pick(rng, null)` throws (empty). Any other non-array (a string, a number, an
    array-like object, a `Set`) throws in both.

---

## C. `prep/answer.js` (`PrepAnswer`)

Exports: `MAX_INPUT_LENGTH` (= 200), `DEFAULT_TOL` (= `{ rel: 1e-3, abs: 1e-9 }`), `parseAnswer`,
`checkNumeric`, `checkMcq`, `formatPreview`. **[decision, Red]** Tests read only `DEFAULT_TOL.rel`
and `DEFAULT_TOL.abs`; whether the object is frozen or carries other keys is implementation-defined.

### C1. `parseAnswer(str)`

Returns `{ ok: true, value }`, where `value` is a finite JS number (`-0` is normalised to `0`), or
`{ ok: false, error }`. It is a hand-written tokenizer plus recursive-descent parser: no `eval`, no
`Function`, no `with` (spec §3 F1.2). Tests may read the source text of `prep/answer.js` and
assert that it matches neither `/\beval\s*\(/` nor `/\bFunction\s*\(/`. This includes comments,
so the implementation must not write `eval(` or `Function(` even there.

**Pre-processing, in this order:**

1. If `str` is not a string, return an error.
2. If `str.length > MAX_INPUT_LENGTH` (200 UTF-16 units, measured before anything is stripped),
   return an error. Keyword `long`. **[decision]**
3. Skip leading whitespace. If the next character is `=`, skip that one `=` (spec: a leading `=`
   is ignored). A second `=` is an invalid character.
4. If nothing but whitespace remains, return an error. Keyword `empty`.

**Tokens.** Whitespace (`/\s/`) separates tokens and is otherwise ignored, so `"2 pi"` equals
`"2pi"` **[decision]**, but `"2 3"` is two adjacent numbers, which is a syntax error.

| Token | Rule |
|---|---|
| NUMBER | `\d+(\.\d*)?` or `\.\d+`, then optionally an exponent `[eE][+-]?\d+`. The exponent is consumed ONLY if `e`/`E` is followed by an optional sign and at least one digit. Value is `Number(text)`. ASCII digits only. |
| CONST | `e`, `pi`, `π` (U+03C0). Values `Math.E`, `Math.PI`. |
| FUNC | `sqrt`, `ln`, `log` (natural log, same as `ln`), `exp`. Must be followed by `(`. |
| `C` | Uppercase `C`: the binomial, as `C(n,k)` or in the form NUMBER `C` NUMBER. |
| Operators | `+ - * / ^ ! % ( ) ,`. `**` (two adjacent asterisks) is the same token as `^`. |

- An identifier is a maximal run of ASCII letters (`[A-Za-z]+`); `π` is a one-character token.
  An identifier that is not exactly one of `e`, `pi`, `sqrt`, `ln`, `log`, `exp`, `C` is an
  error with keyword `unknown`. Identifiers are case-sensitive **[decision]**: `PI`, `Pi`, `E` and `c` are
  unknown. (`E` inside a NUMBER exponent, as in `2E3`, is part of the number.)
- Any other character (including `×`, `÷`, `−` U+2212, `=` after position 0, `;`, quotes) is an
  error **[decision]**: only ASCII operators are accepted.
- Tokenizing examples: `"1e-3"` → NUMBER 0.001. `"2e3"` → NUMBER 2000. `"2e"` → NUMBER 2, CONST e
  (implicit product, 2e). `"2e-1"` → NUMBER 0.2 (scientific notation wins). `"2exp(1)"` → NUMBER 2,
  FUNC exp. `"epi"` → unknown identifier. `"1.2.3"` → NUMBER 1.2, NUMBER 0.3, which is a syntax error.
- **[decision, Red]** Whitespace rules for multi-character tokens:
  - FUNC "must be followed by `(`" means the next TOKEN is `(`. Whitespace between them is allowed,
    so `"sqrt (16)"` = 4. `"sqrt 4"`, `"sqrt4"` and a bare `"sqrt"` are errors.
  - `**` is two asterisks with NOTHING between them: `"2 ** 3"` = 8, but `"2* *3"` is a syntax
    error (`*` followed by `*`).

**Implicit multiplication.** An implicit-multiplication operator IMUL is inserted between a NUMBER
token and an immediately following (whitespace allowed) CONST, FUNC, or `C` followed by `(`.
Nowhere else (spec: "only between a number and a constant or function"). So `"2pi"`, `"2 pi"`,
`"3sqrt(2)"`, `"2e^-1"` and `"2C(5,2)"` are valid. `"2(3)"`, `"(2)3"`, `"(1/2)pi"`, `"pi2"`,
`"pi pi"`, `"sqrt(2)sqrt(2)"` and `"2 3"` are errors.
**[decision, Red]** IMUL is inserted ONLY straight after a NUMBER token, so a postfix operator in
between blocks it: `"2!pi"` and `"2%pi"` are errors. The grammar then gives `"2sqrt(9)!"` =
2·(3!) = 12 and `"2^3pi"` = (2³)·π = 8π.

**The `nCk` form.** NUMBER `C` NUMBER (whitespace allowed: `"10 C 3"`) is a single primary meaning
`C(n,k)`. Both operands must be literal NUMBER tokens: `"(10)C3"` and `"10C(3)"` are errors.

**Grammar, lowest to highest precedence.** **[decision]**: implicit multiplication binds tighter
than `*` and `/` but looser than unary minus and `^`, as on most calculators. Unary minus is
looser than `^`, as the spec requires (`-2^2` = −4).

```
input    := expr EOF
expr     := term (("+" | "-") term)*                  level 1, left-assoc
term     := imul (("*" | "/") imul)*                   level 2, left-assoc
imul     := unary (IMUL unary)*                        level 3, left-assoc
unary    := ("-" | "+") unary | power                  level 4, prefix
power    := postfix ("^" unary)?                       level 5, right-assoc (the RHS is a unary)
postfix  := primary ("!" | "%")*                       level 6, repeatable, left to right
primary  := NUMBER | NUMBER "C" NUMBER | CONST
          | FUNC "(" expr ")" | "C" "(" expr "," expr ")" | "(" expr ")"
```

| Level | Operators | Associativity | Examples |
|---|---|---|---|
| 1 (lowest) | binary `+ -` | left | `5--3` = 8 |
| 2 | `* /` | left | `8/2/2` = 2 |
| 3 | implicit multiplication | left | `1/2pi` = 1/(2π); `2pi/3` = (2π)/3 |
| 4 | prefix `-`, `+` | right | `-2^2` = −4; `-3!` = −6; `--5` = 5 |
| 5 | `^` and `**` | right; RHS may start with a sign | `2^3^2` = 512; `e^-1` = 1/e; `2^-2^2` = 1/16; `2pi^2` = 2π² |
| 6 | postfix `!`, `%` | left, repeatable | `2^3!` = 64; `3!^2` = 36; `3!!` = 720; `50%` = 0.5 |
| 7 | primary | | `10C3/1024` = (10C3)/1024; **[decision, Red]** the `nCk` form is one primary, so `5C2!` = (5C2)! = 3628800 and `4C2^2` = (4C2)² = 36 |

**Semantics and domain errors** (all are `{ ok: false, error }`):

| Construct | Rule |
|---|---|
| `a / b` | `b === 0` gives an error, keyword `zero`. |
| `x!` | `x` must be an integer (`Number.isInteger`) with `0 <= x <= 170`, else an error, keyword `factorial`. `"171!"`, `"(-1)!"` and `"1.5!"` are errors. `"-1!"` is valid and equals −1. |
| `x%` | `x / 100`. |
| `a ^ b` | `Math.pow(a, b)`. A `NaN` or non-finite result is an error (`(-8)^(1/3)`, `0^-1`). |
| `sqrt(x)` | `x >= 0`, else an error. |
| `ln(x)`, `log(x)` | `x > 0`, else an error. |
| `exp(x)` | `Math.exp(x)`; a non-finite result is an error. |
| `C(n,k)`, `nCk` | `n` and `k` must be integers with `n >= 0` and `k >= 0`, else an error. If `k > n` the value is `0` **[decision]**. Otherwise, with `k' = min(k, n-k)`, `r = 1; for i = 1..k': r = r * (n - k' + i) / i`. The result is an exact integer for every `k` when `n <= 54`. For larger `n` it may be off by a few ulps or be non-integer (e.g. `C(55,26)` gives `3560597348629859.5`): tests MUST NOT assert exact `C` values for `n > 54`, and compare them with relative tolerance `1e-12`. A non-finite result is an error. |
| `,` | Only valid as the separator inside `C( , )`. Anywhere else (e.g. `"1,000"`, `"1,5"`) it is a syntax error: `,` is never a decimal point. |
| Any intermediate or final non-finite value | Error, keyword `finite`. Includes NUMBER literals such as `1e400`. |
| Mixed fractions | Not supported: `"1 1/2"` is NUMBER NUMBER, a syntax error. |

**[decision, Red]** Keywords and cost:

- "Non-finite" means `!Number.isFinite(v)`, so it covers `NaN` as well as `±Infinity`. Every error
  caused by a non-finite literal, intermediate or result (including the results of `^`, `exp` and
  `C`, e.g. `10^400`, `2^1024`, `exp(1000)`, `0^-1`, `(-8)^(1/3)`, `C(2000,1000)`) carries the
  keyword `finite`. Rows with their own operand check (`/` by zero, `!`, `sqrt`, `ln`/`log`, the
  `C` argument rules) apply that check first and use their own keyword (or none), so `"171!"` and
  `"1000!"` say `factorial`, not `finite`.
- The `C` loop MUST stop as soon as `r` is not finite (the result is then the `finite` error), so
  inputs such as `"C(1e15,5e14)"` finish in at most a few thousand steps. The result is the same as
  running the loop to the end.
- The pre-processing steps 1–4 run first, in that order, so their errors always win (`"x"`
  repeated 5000 times says `long`, `" ".repeat(201)` says `long`, not `empty`). After them, when
  an input has several problems of DIFFERENT kinds, which error is reported is
  implementation-defined (a tokenize-first and a lazy left-to-right design may differ). A listed
  keyword is guaranteed when the input has a single problem, or when every problem in it has that
  same keyword (e.g. `"import os"`: two unknown names). Tests MUST NOT assert a keyword for
  inputs with problems of different kinds after pre-processing.

**Required behaviour** (spec §3 F1.2, restated; tests MUST cover these): `"7/36"` and `"0.1944"`
match `7/36`, `"0.19"` does not. `"1/e"`, `"e^-1"` and `"exp(-1)"` are equal, and `"36.79%"`
matches `1/e`. `"C(10,3)/2^10"` and `"10C3/1024"` match `120/1024`. `"sqrt(2)/2"` matches `0.70711`.
`"5!"` = 120. `"171!"`, `"(-1)!"` and `"1.5!"` are errors. `"2pi"` ≈ 6.2832. `"2 3"` is an error.
`"import os"` and `"alert(1)"` are errors. `"1e-3"` = 0.001. `"-2^2"` = −4.

### C2. `checkNumeric(userStr, item)`

Reads `item.answer.value` (string) and `item.answer.tol` (optional). It does not look at `item.type`,
so OA question objects (§F) work the same way.

1. `exp = parseAnswer(item.answer.value)`. If that fails, return
   `{ correct: null, parsed: null, expected: null, error }`, keyword `item`. The UI treats
   `expected === null` as a broken item: it is never counted, and the UI offers Skip.
2. `u = parseAnswer(userStr)`. If that fails, return
   `{ correct: null, parsed: null, expected: exp.value, error: u.error }`. A parse error is never
   counted as wrong (spec §3 F1.2).
3. Otherwise return `{ correct, parsed: u.value, expected: exp.value }` with no `error` key, where:
   - `rel = (tol && tol.rel !== undefined) ? tol.rel : 1e-3`
   - `abs = (tol && tol.abs !== undefined) ? tol.abs : 1e-9`
   - `correct = Math.abs(u.value - exp.value) <= Math.max(abs, rel * Math.abs(exp.value))`

The item's `tol` overrides the default **per field** **[decision]**: `{ abs: 0.01 }` keeps
`rel = 1e-3`. `{ rel: 0, abs: 0 }` means an exact match. The inequality is `<=`. Tests MUST NOT put
a case within 1 ulp of the boundary, except with exactly representable values.

**[decision, Red]** `checkNumeric` converts nothing: both arguments go to `parseAnswer` as given. A
non-string `userStr` (`null`, `undefined`, the number `0.1944`) is therefore a parse error
(step 2: `correct: null`, `expected` kept), and a non-string or missing `item.answer.value` (e.g.
the number `0.5`) is a broken item (step 1, keyword `item`).

### C3. `checkMcq(index, item)`

- `expected = item.answer.correct`.
- If `index` is not an integer with `0 <= index < item.answer.choices.length`, return
  `{ correct: null, parsed: null, expected, error }`.
- Otherwise return `{ correct: index === expected, parsed: index, expected }` with no `error` key
  **[decision, Red]** (the same as §C2; tests may assert `r.error === undefined`).
- Numeric strings are not accepted: `checkMcq("2", item)` is an error.

### C4. `formatPreview(value)` **[decision]**

`String(Number(value.toPrecision(6)))`. For example `7/36` gives `"0.194444"`, `2π` gives
`"6.28319"`, `0.001` gives `"0.001"` and `120` gives `"120"`. The UI prefixes `"= "` (§J2).

---

## D. `prep/srs.js` (`PrepSrs`)

Exports: `DAY`, `MINUTE`, `AREA_ORDER`, `GRADES`, `MAX_INTERVAL` (= 365), `AGAIN_DELAY_MS`
(= 600000), `DEFAULT_SETTINGS`, `normalizeSettings`, `newCard`, `schedule`, `nextIntervals`,
`gradeLabels`, `targetSecs`, `autoGrade`, `answerOk`, `buildQueue`, `drillQueue`, `masteryOf`,
`replayCards`, `localDayStart`, `dueCount`.

### D1. Card state

`prepCards[itemId] = { ease, interval, due, reps, lapses, last, seen }` (spec §2 storage).

| Field | Meaning |
|---|---|
| `ease` | number, at least 1.3. Not rounded **[decision]**: tests compare it with a tolerance of `1e-9`. |
| `interval` | integer days, 0 to 365. It is 0 for a new card and after `again`. |
| `due` | ms when the card is next due, or `null` if never graded. |
| `reps`, `lapses` | integers |
| `last` | ms of the most recent grade, or `null` |
| `seen` | ms of the FIRST grade ever (when the item was introduced), or `null`. Set once and never changed. |

- `newCard()` returns `{ ease: 2.5, interval: 0, due: null, reps: 0, lapses: 0, last: null, seen: null }`.
- A card exists in `prepCards` only once its item has been graded at least once.
- An item is **new** if `cards[id]` is missing or has a non-finite `due`. **[decision, Red]** A
  `cards[id]` that is `null` or not an object counts as missing.

### D2. `schedule(card, grade, now)` → new card

`card` may be `null` or `undefined` (treated as `newCard()`). Missing fields default to their
`newCard()` values. `grade` must be one of `GRADES`, otherwise it throws `TypeError`. The input is
not mutated. With `c` = the defaulted card (spec §3 F1.3):

| Grade | ease | interval | reps | lapses | due |
|---|---|---|---|---|---|
| `again` | `max(1.3, c.ease - 0.2)` | `0` | `0` | `c.lapses + 1` | `now + 600000` (10 min) |
| `hard` | `max(1.3, c.ease - 0.15)` | `min(365, max(1, round(c.interval * 1.2)))` | `c.reps + 1` | same | `now + interval * DAY` |
| `good` | same | `min(365, g)` where `g = c.reps == 0 ? 1 : c.reps == 1 ? 6 : round(c.interval * c.ease)` | `c.reps + 1` | same | `now + interval * DAY` |
| `easy` | `c.ease + 0.15` | `min(365, round(g * 1.3))`, with `g` as for good, using the OLD ease | `c.reps + 1` | same | `now + interval * DAY` |

- On every grade, `last = now` and `seen = c.seen ?? now`.
- `round` is `Math.round`.
- **[decision, Red]** The result has exactly the seven §D1 fields; any other field on the input
  card is dropped. `grade` must be a string `===` one of `GRADES`: any other value (including
  non-strings such as `["good"]`, `3`, `null`) throws `TypeError`.
- Reference run from `newCard()`, one day apart: good → 1; good → 6; good → 15; easy → 49
  (ease 2.65); hard → 59 (ease 2.5); again → 0 (ease 2.3, reps 0, lapses 1); good → 1; good → 6.

### D3. Interval preview and button labels

- `nextIntervals(card)` returns `{ again: 0, hard, good, easy }`: the `interval` that
  `schedule(card, g, 0)` would give for each grade.
- `gradeLabels(card)` returns
  `{ again: "Again, 10m", hard: "Hard, <h>d", good: "Good, <g>d", easy: "Easy, <e>d" }`.
  The format is the capitalised grade, comma, space, then the number and `d`. Intervals are always
  shown in days, even beyond 30 **[decision]**.
- New card: `"Again, 10m"`, `"Hard, 1d"`, `"Good, 1d"`, `"Easy, 1d"`.
- Card `{ reps: 1, interval: 1, ease: 2.5 }`: `"Again, 10m"`, `"Hard, 1d"`, `"Good, 6d"`, `"Easy, 8d"`
  (this is the spec's "Good, 6d" example).

### D4. Auto-grading

- `targetSecs(item)` = `60 * item.difficulty * 1.5` (spec §3 F1.3).
- `autoGrade(correct, secs, item)`:
  - `correct === false` → `"again"`;
  - `correct === true` → `secs > targetSecs(item) ? "hard" : "good"` (equal to the target is good);
  - anything else (`null`, a parse error) → `null`, meaning no grade. **[decision, Red]** The
    comparisons are strict: truthy or falsy non-booleans (`1`, `"true"`, `0`, `undefined`) give `null`.
- `answerOk(entry)`, for a `prepHistory` entry: `entry.mode === "auto" ? entry.correct === true : entry.grade !== "again"`.
  This is the single definition of an "OK answer" used by accuracy figures, drills and summaries
  **[decision]**.

### D5. Settings

- `DEFAULT_SETTINGS` = `{ newPerDay: 15, reviewCap: 150, areas: [...AREAS] }` (spec §2).
- `normalizeSettings(s)` (the ranges are a **[decision]**):
  - `newPerDay`: an integer from 0 to 200, otherwise the default;
  - `reviewCap`: an integer from 0 to 1000, otherwise the default;
  - `areas`: if it is an array, keep the entries that are in `AREAS`, de-duplicated and in
    `AREAS` order (an empty array stays empty); if it is not an array, all of `AREAS`.
  - **[decision, Red]** `s` that is `null`, `undefined` or not an object is treated as `{}` (no
    `prepSettings` is stored on first run). Values are not converted: "an integer" means
    `Number.isInteger(value)` on the value as given, so `"20"`, `null` and `true` give the default.

### D6. `buildQueue(bank, cards, now, settings, opts = {})` → array of item ids

Spec §3 F1.3, made exact:

1. `S = normalizeSettings(settings)`. `areas = S.areas`.
2. **Candidates:** bank items whose `area` is in `areas`, de-duplicated by id (the first occurrence
   in bank order wins). If `opts.topics` is a non-empty array, keep only items that have at least
   one of those topics (OR semantics). Items with an unknown area are ignored.
   **[decision, Red]** De-duplication is applied to the WHOLE bank first (first occurrence wins,
   as `PrepBank.indexById`), and only then are the area and topic filters applied. A later copy
   of an id is dropped even if the first copy is filtered out. `opts.topics` that is not an array
   (or is empty) means no topic filter.
3. **Split:** a candidate is a **review** if `cards[id]` has a finite `due`, and it is due if
   `due <= now`. Not-yet-due reviews are excluded. A candidate with no card, or a card with a
   non-finite `due`, is **new**.
4. **Reviews:** sort the due reviews by `due` ascending, then by `id` ascending (plain `<` string
   comparison). Keep the first `S.reviewCap`. Then interleave them round-robin by area (D8).
   **[decision]**: the spec's "oldest due first" (step 1) and "interleave areas" (step 3) are
   reconciled as sort by due, cap, then interleave, so the cap keeps the oldest due reviews.
5. **New:** `seenToday` = the number of bank items with `area` in `areas` (the topic filter is NOT
   applied here) whose card has `seen` on the local day of `now`. **[decision]**: this scopes the
   daily budget per area set, so the Practice and Cards tabs each get their own `newPerDay`.
   **[decision, Red]** The bank items are de-duplicated as in step 2, and "on the local day of
   `now`" means `localDayStart(now) <= seen < localDayStart(now, 1)`, so a `seen` later today
   than `now` also counts.
   `newLimit = max(0, S.newPerDay - seenToday)`. Sort the new candidates within each area by
   `difficulty` ascending, then bank order ("source order" **[decision]**: the build writes items
   in source and page order). Interleave round-robin by area (D8), then keep the first `newLimit`.
   **[decision, Red]** "Bank order" is the array index and nothing else. The real build writes
   items in source and page order, but the fixture need not (its files are grouped by area), and
   tests MUST NOT derive order or pages from locators or `source.page`.
6. Return `reviews.concat(newOnes)` as ids.

- Cards whose id is not in `bank` are ignored. They are never queued and never count toward `seenToday`.
- The function is deterministic. No RNG is used.
- **[decision, Red]** `buildQueue` and `drillQueue` do not validate ids: they sort whatever id
  strings the bank holds with plain `<`, so mixed-case ids sort by UTF-16 code units.

### D7. `drillQueue(bank, cards, now, drill)` → array of item ids **[decision]**

Used for buddy drills (spec §9 F7, §H9) and Practice-from-source (`source=`, §J1). It has no
daily limits.
`drill = { area?, topics?, count }`.

1. **Candidates:** bank items (de-duplicated as in D6) with `area === drill.area` if `drill.area`
   is a string, otherwise any area, and matching `drill.topics` with OR semantics if that is
   non-empty.
2. Group A: due reviews, by `due` ascending, then `id`. Group B: new items, by `difficulty`
   ascending, then bank order. Group C: not-yet-due reviews, by `due` ascending, then `id`.
3. Return `A.concat(B, C).slice(0, drill.count)`. There is no round-robin.

**[decision, Red]** As in D6: the whole bank is de-duplicated first, then filtered. When
`drill.area` is not a string, the candidates are the items whose area is in `AREAS` (unknown areas
are excluded, as in D6). The topic filter applies only when `drill.topics` is a non-empty array.
`drill.count` is a non-negative integer (every caller passes one: `amDrillEntry` gives 1 to 50,
`source=` gives the number of that source's items); other values are implementation-defined.

### D8. Round-robin interleave

Split the sorted list into per-area sublists, keeping order. Then repeatedly take the next element
from each non-empty sublist in `AREA_ORDER` order until all are empty. For example
`[p1,p2,p3,c1,s1]` (probability, probability, probability, cpp, statistics) becomes
`[p1,c1,s1,p2,p3]`.

### D9. Other helpers

- `masteryOf(cards, itemIds)` = (number of ids with `cards[id] && cards[id].interval >= 21`) /
  `itemIds.length`. It returns `null` for an empty `itemIds` **[decision]** (spec §3 F1.3).
  **[decision, Red]** The formula is applied to `itemIds` as given (a repeated id counts each
  time); every caller passes distinct ids.
- `replayCards(history, uptoTs)` returns a cards object rebuilt from `prepHistory`. Take the
  entries with `ts <= uptoTs` and `grade` in `GRADES`, stable-sort them by `ts` ascending, and
  apply `cards[e.itemId] = schedule(cards[e.itemId], e.grade, e.ts)` in turn. Used by the Sunday
  review (§H8).
- `dueCount(bank, cards, beforeTs, areas = AREAS)` = the number of bank items (de-duplicated)
  with `area` in `areas` whose card has a finite `due < beforeTs`.
  - "Due today" = `dueCount(bank, cards, localDayStart(now, 1))`. This includes overdue cards.
  - "Due tomorrow" = `dueCount(bank, cards, localDayStart(now, 2), areas)` **[decision]**: everything
    due before the end of tomorrow, overdue and due-today cards included.
  - **[decision, Red]** Only `undefined` takes the default `AREAS`; `areas = null` follows §A3
    (read as `[]`, so the count is 0). Entries of `areas` are matched literally against
    `item.area` (no check against `AREAS`).

---

## E. `prep/bank.js` (`PrepBank`)

Exports: `AREAS`, `PRACTICE_AREAS`, `CARD_AREAS`, `TYPES`, `STATUSES`, `ORIGINS`, `METHODS`,
`KEY_RE`, `LOCATOR_RE`, `ID_RE`, `TOPIC_RE`, `sha256Hex`, `answerKey`, `hash8`, `makeId`, `parseId`,
`bankValidate`, `allItems`, `indexById`, `topicSet`, `answerText`, `sourceLabel`, `libraryHref`,
`sourceCounts`.

### E1. File shapes

| File | Shape |
|---|---|
| `bank.json` | `{ "version": 1, "generated": "<ISO 8601>", "items": [Item] }`. Practice items (areas probability, brainteaser, statistics, finance). |
| `decks/cpp.json`, `decks/systems.json` | `{ "version": 1, "deck": "<cpp or systems>", "generated": "<ISO>", "items": [Item] }`. Every item's area equals `deck`. |
| `lists/neetcode150.json` | Same shape as the resource library file (spec §0): `{ source, list: "neetcode150", count, problems: [{ order, problem, slug, url, difficulty, pattern, leetcode_id, ... }] }`. Extra fields are allowed. |
| `library/index.json` | `{ "version": 1, "categories": [{ "folder": "01-probability", "label": "Probability", "entries": [{ "file": "<path relative to library/>", "title": "<display title>", "key": "<sourceKey>"? }] }] }`. Categories appear in folder order, entries in index order. |

- `generated` is optional in the fixture. **[decision, Red]** Tests MUST NOT require it, and its
  value is free; when present it is an ISO 8601 string.
- Category folders and labels **[decision]**: `00-user-supplied` "User supplied", `01-probability`
  "Probability", `02-quant-interview` "Quant interview", `03-cpp` "C++", `04-systems-low-latency`
  "Systems & low latency", `05-coding-lists` "Coding lists".
- **[decision, Red]** A library entry's `file` is EXACTLY the `source.file` string of the items
  that cite it. The category `folder` only groups entries: it is a label, never implicitly
  prefixed to the path. (A file that really sits in a subfolder of `library/` carries that
  subfolder in both strings, e.g. `"00-user-supplied/my-notes.pdf"`; the fixture's files have no
  subfolder.) This is what makes `sourceCounts(items)[entry.file]`, `libraryHref` and `a.lib-open`
  (§J7) line up.
- **[decision, Red]** A category with no entries may be omitted. Which category an entry belongs
  to is free, except where §L3 fixes it. `lists/neetcode150.json` field values other than the ones
  §L3 fixes (`problem`, `difficulty`, `leetcode_id`, and the exact `source` text) are free; tests
  assert only that those keys are present.

### E2. Item schema (spec §3 F1.1, restated with exact rules)

```
{
  id:         "<sourceKey>-<locator>-<hash8>",
  source:     { key, title, file, page },
  area:       one of AREAS,
  topics:     [string, ...],            non-empty, each matching TOPIC_RE
  difficulty: integer 1..5,
  type:       "numeric" | "mcq" | "free",
  prompt:     non-empty markdown string ($...$ and $$...$$ maths),
  answer:     numeric: { value: "<expr>", tol?: { rel?, abs? } }
              mcq:     { choices: [string, ...], correct: index }
              free:    { value: "<markdown model answer>" },
  solution:   non-empty markdown string,
  origin:     "source" | "generated",
  check:      { status: "agreed"|"corrected"|"disputed"|"unverified",
                printed?: string, resolved?: string, method?: "blind"|"blind+sim", note?: string }
}
```

| Constant | Value |
|---|---|
| `KEY_RE` (source key) | `/^[a-z0-9]{2,24}$/`, no hyphens **[decision]** |
| `LOCATOR_RE` | `/^[a-z0-9]+(?:-[a-z0-9]+)*$/`, at most 40 characters **[decision]**, e.g. `p37-q2`, `sp3-q4b`, `s12-c1` |
| `ID_RE` | `/^([a-z0-9]{2,24})-([a-z0-9]+(?:-[a-z0-9]+)*)-([0-9a-f]{8})$/` (groups: key, locator, hash) |
| `TOPIC_RE` | `/^[a-z0-9]+(?:-[a-z0-9]+)*$/` (lowercase-kebab) |
| `TYPES` | `["numeric","mcq","free"]` |
| `STATUSES` | `["agreed","corrected","disputed","unverified"]` |
| `ORIGINS` | `["source","generated"]` |
| `METHODS` | `["blind","blind+sim"]` |

- `source.file` is a POSIX path relative to `library/`. It matches
  `/^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/` and has no `..` segment. It need not be a PDF
  (cppreference HTML or the Core Guidelines markdown are allowed).
- `source.page` is an integer of at least 1 (a slide number for decks; 1 for unpaginated files).
- `source.title` is the short display title used in labels (e.g. `"Green Book"`).
- **[decision, Red]** Locators:
  - The 40-character limit is a rule for the ids the build (and the fixture) writes. `LOCATOR_RE`
    and `ID_RE` do not encode it, `makeId` does not check it, and whether `bankValidate` also
    reports a longer locator (under field `id`) is implementation-defined. Tests may assert that
    fixture locators are at most 40 characters, never that `bankValidate` accepts or rejects a
    longer one.
  - The locator schemes (`p<page>-q<n>`, `s<slide>-c<n>`, …) are conventions only. Tests MUST NOT
    parse a page, a position or an order out of a locator.
- **[decision, Red]** `check.printed` and `check.resolved` are display strings: the printed and the
  re-solved answer as a reader would write them (the choice TEXT for mcq; a short summary for free
  items). The build stores, and the fixture follows: for a `corrected` item the stored answer is
  the resolved one (numeric `answer.value === check.resolved`, mcq
  `answer.choices[answer.correct] === check.resolved`); for a `disputed` item the stored answer
  is the printed one (spec §10: "keep the printed answer"), with the same equalities against
  `check.printed`. For free items neither string is compared with `answer.value`. These
  equalities are a build and fixture rule only: `bankValidate` does NOT check them (§E4).
- **[decision, Red]** `check.method` is optional on every status and carries no meaning on
  `unverified` items. Tests MUST NOT derive anything from `method` on unverified items. The
  spec §10 acceptance rules (600 / 300 items, no source over 40%, at most 5% disputed, every
  numeric item carries a `method`) apply to the real build report only, never to the fixture.

### E3. Ids and hashing

- `answerKey(item)`:
  - numeric and free items: `item.answer.value`;
  - mcq items: `JSON.stringify(item.answer.choices) + String(item.answer.correct)`, e.g.
    `["1/8","1/4","3/8","1/2"]2` **[decision]**: mcq has no `answer.value`.
- `hash8(item)` = the first 8 lowercase hex characters of `sha256Hex(item.prompt + answerKey(item))`.
  There is no separator, and the string is UTF-8 encoded (spec §3 F1.1).
- `makeId(sourceKey, locator, item)` = `` `${sourceKey}-${locator}-${hash8(item)}` ``.
- `parseId(id)` returns `{ key, locator, hash }` from `ID_RE`, or `null`.
- `sha256Hex(str)` is a **synchronous, pure-JS SHA-256** (FIPS 180-4) inside `prep/bank.js`, used
  in both Node and the browser **[decision]**. WebCrypto is async and so unusable here. It encodes
  `str` as UTF-8 with `TextEncoder` (global in Node 11+ and all browsers) and returns 64 lowercase
  hex characters. Tests compare it with `require("node:crypto").createHash("sha256").update(str, "utf8").digest("hex")`
  on ASCII, non-ASCII and multi-block (more than 64 bytes) strings. Vectors:
  - `""` → `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`
  - `"abc"` → `ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad`
  - `"π≈3.14"` → `48531632429093f5fe6701c9de463261f6012ae651ac18480bc091438737f90f`
- A corrected item's `answer.value` is the resolved value, so its hash, and therefore its id,
  covers the resolved answer. Ids are stable across rebuilds for unchanged content (spec §3 F1.1).
- **[decision, Red]** `answerKey`, `hash8` and `makeId` never validate. They compute the template
  and do not throw for any item whose `prompt` is a string and whose `answer` is an object with a
  string `answer.value` (numeric, free) or an array `answer.choices` and an integer
  `answer.correct` (mcq), whether or not the value parses or the index is in range. Validation is
  `bankValidate`'s job only. Behaviour on other input is implementation-defined.

### E4. `bankValidate(bank)` → `{ ok, errors }`

- `bank` is any object with an `items` array: `bank.json`, a deck, or a merged
  `{ items: allItems(...) }`. The build validates the merged set, so ids are unique across bank and decks.
- If `bank` is not an object or has no `items` array: `ok: false` with one error
  `{ id: null, field: "items", msg }`.
- Each error is exactly `{ id, field, msg }`.
  - `id` is the item's `id` if it is a non-empty string, otherwise `"#<index>"` (0-based index in
    `items`) **[decision]**.
  - `field` is the dotted path of the offending field, with no array indices: `id`, `source`,
    `source.key`, `source.title`, `source.file`, `source.page`, `area`, `topics`, `difficulty`,
    `type`, `prompt`, `answer`, `answer.value`, `answer.tol`, `answer.choices`, `answer.correct`,
    `solution`, `origin`, `check`, `check.status`, `check.method`, `check.printed`, `check.resolved`.
  - `msg` is free text.
- `ok === (errors.length === 0)`. Every problem is reported; validation does not stop at the
  first error.

Checks per item (spec §3 F1.1, plus the marked additions):

| Field | Error when |
|---|---|
| `id` | not a string matching `ID_RE`; key part ≠ `source.key`; hash part ≠ `hash8(item)` (msg keyword `hash`; skipped if `prompt` or the answer fields needed by `answerKey` are invalid); a duplicate of an earlier item (one error per later duplicate, msg keyword `duplicate`) |
| `source` | not an object |
| `source.key` | not matching `KEY_RE` |
| `source.title` | not a non-empty string |
| `source.file` | not matching the E2 path rule |
| `source.page` | not an integer of at least 1 |
| `area` | not in `AREAS` |
| `topics` | not a non-empty array, or any entry not matching `TOPIC_RE` |
| `difficulty` | not an integer from 1 to 5 |
| `type` | not in `TYPES` |
| `prompt` | not a string with non-whitespace content |
| `answer` | not an object |
| `answer.value` | numeric: not a string, or `parseAnswer` fails. free: not a non-empty string. |
| `answer.tol` | present and not an object whose present `rel` / `abs` are finite numbers of at least 0 |
| `answer.choices` | mcq: not an array of 2 to 8 non-empty strings |
| `answer.correct` | mcq: not an integer in `[0, choices.length)` |
| `solution` | not a non-empty string |
| `origin` | not in `ORIGINS` |
| `check` | not an object |
| `check.status` | not in `STATUSES` |
| `check.method` | present and not in `METHODS` |
| `check.printed`, `check.resolved` | **[decision]** when status is `corrected` or `disputed`: missing or empty. The disputed banner quotes both (spec §3 F1.4). |

- Unknown extra fields are allowed.
- `check.method` is not required by the validator. The spec's "every numeric item carries a
  `method`" is a build acceptance check (spec §10), done by the report step, not by `bankValidate`.

**[decision, Red]** Exact meaning of the table:

- **Words.** "An object" means a non-null, non-array object
  (`typeof x === "object" && x !== null && !Array.isArray(x)`), so `null` and arrays are "not an
  object". "Present" means `!== undefined`, so `tol: null`, `{ rel: null }` and `method: ""` are
  present (and invalid). "A non-empty string" means a string of length at least 1, with no
  trimming: `"   "` is valid for `source.title`, `solution`, a free `answer.value` and
  `check.printed` / `check.resolved`. Only `prompt` needs non-whitespace content. "Missing or
  empty" for `printed` / `resolved` means "not a non-empty string".
- **Result object.** Tests read only `ok` and `errors`; extra keys on the result are
  implementation-defined. Each ERROR is still exactly `{ id, field, msg }`.
- **Non-object entries.** An `items[i]` that is not an object (`null`, `42`, `"x"`, an array) gives
  one error `{ id: "#<i>", field: "items", msg }`, and no other check runs for that entry.
  `bankValidate` never throws.
- **Hash check.** The hash part is checked only when `id` matches `ID_RE` and the item has no error
  on `prompt`, `type`, `answer`, or the answer fields `answerKey` reads for its type
  (`answer.value` for numeric and free; `answer.choices` and `answer.correct` for mcq). So a
  whitespace-only prompt or an empty free `answer.value` skips it.
- **Key part.** "Key part ≠ `source.key`" is checked whenever `id` matches `ID_RE` and `source` is
  an object (also when `source.key` is itself invalid). When `source` is not an object only the
  `source` error is required.
- **Duplicates.** Every item whose `id` is a non-empty string takes part, compared exactly, whether
  or not it matches `ID_RE`.
- **`answer.tol`** is validated for every type, not only numeric.
- **Counts.** Tests may assert the exact number of `duplicate` id errors (one per later
  duplicate) and the single bank-level `items` error, because this section states both counts
  exactly. §N7 still forbids counting any other errors.
- `bankValidate` does not compare `check.printed` / `check.resolved` with the stored answer (§E2).

### E5. Helpers

| Function | Contract |
|---|---|
| `allItems(bankJson, decks = [])` | `[...bankJson.items, ...decks[0].items, ...]`. `bankJson` null → its part is `[]`; null decks are skipped. Returns a new array of the same item objects. |
| `indexById(items)` | Plain object `{ [id]: item }`. The first occurrence wins. `items` may be an array or an object with `items` (§A6), as for `topicSet` and `sourceCounts`. |
| `topicSet(items)` | Sorted (`<` order) array of the distinct topics. |
| `answerText(item)` | Display answer: numeric → `answer.value`; mcq → `answer.choices[answer.correct]`; free → `answer.value`. |
| `sourceLabel(item)` | `` `${item.source.title}, p. ${item.source.page}` ``, e.g. `"Green Book, p. 37"` (spec §3 F1.4). Always `p.`, also for slides **[decision]**. |
| `libraryHref(item, root = "bank/")` | `` `${root}library/${encodeURI(item.source.file)}#page=${item.source.page}` `` (spec §3 F1.4). `root` is the loaded bank root (§E6). |
| `sourceCounts(items)` | `{ [source.file]: number of items }`, for the Library tab's "items from this source". **[decision, Red]** Its keys are exactly the files cited by at least one item (it only sees items, so it cannot know uncited library files); the Library tab treats a missing key as 0 (§J7). |

### E6. Which bank the UI loads

`prep-loader.js` defines `async function prepLoadBank({ fixture } = {})`:

- `root = fixture ? "tests/fixtures/bank-mini/" : "bank/"`.
- It fetches `chrome.runtime.getURL(root + name)` for `bank.json`, `decks/cpp.json`,
  `decks/systems.json`, `lists/neetcode150.json` and `library/index.json`, each inside its own
  `try`/`catch`. A rejected `fetch` (a missing extension file REJECTS with `TypeError: Failed to
  fetch`; it does not resolve non-OK), a non-OK response or a JSON parse error makes that file
  `null`. `prepLoadBank` never rejects.
- If `bank.json` is `null`, it resolves `null` (bank missing).
- Otherwise it resolves
  `{ source: fixture ? "fixture" : "bank", root, bankJson, decks: { cpp, systems }, items, nc150, library }`,
  where `items = [bankJson, cpp, systems].flatMap(f => f && Array.isArray(f.items) ? f.items : [])`
  (the same result as `PrepBank.allItems`, computed inline so `prep-loader.js` requires nothing and
  works before `prep/bank.js` exists). A missing deck is `null` in `decks`.
- It does not validate (the build already did).
- **[decision, Red]** `prepLoadBank` needs `chrome.runtime.getURL` and `fetch` and has no
  `module.exports`, so it is not unit-tested. It, and the choice of root, are covered by e2e
  (v4-1 `data-bank-source`, v4-12 `a.lib-open`). The only unit-tested root logic is
  `libraryHref(item, root)`.

Who calls it:

- `prep.html`: `fixture = (new URLSearchParams(location.search).get("fixture") === "1")`.
  **[decision]**: `?fixture=1` ALWAYS loads the fixture, even if `bank/` exists, so e2e results do
  not depend on whether the developer has built the real bank. Without `?fixture=1`, if the bank
  is missing, the page shows the "Bank not built" screen (§J2) (spec §2).
- `sidepanel.html` **[decision]**: on init the side panel sets
  `prepData = await prepLoadBank({ fixture: <its own URL has ?fixture=1> })` before
  `maybeDailyCheckin`, inside its own `try`/`catch` (a failure leaves `prepData = null` and never
  aborts init). `prepData` is a top-level `let`, initially `null`. Production never passes the
  parameter. The e2e harness opens `sidepanel.html?fixture=1` for v4 panel scenarios. A `null`
  result means no bank: item-based scores are `null` and drill topics are not checked. Every panel
  call passes `prepData ? prepData.items : null` as `bank` and `prepData ? prepData.nc150 : null`
  as `nc150`.
  - **[decision, Red]** The panel exposes no DOM signal for `prepData` having settled, and
    `#planBanner` may render before it does, so a chat request sent at once may still see
    `prepData = null`. e2e tolerates that race instead of adding a marker: v4-16 sends up to three
    requests until the system prompt holds the full Prep line. (`maybeDailyCheckin`, and so the
    Sunday review of v4-17, always runs after the load, as above.)

---

## F. `prep/oa.js` (`PrepOA`)

Exports: `KINDS`, `TIME_LIMITS`, `QUESTION_COUNTS`, `EIGHTY_CATEGORIES`, `SEQ_FAMILIES`,
`SEQ_SHOWN` (= 7), `EV_TEMPLATES`, `PRIMES`, `defaultConfig`, `normalizeConfig`, `configError`,
`isDefaultConfig`, `sameConfig`, `generate`, `seqFit`, `seqNext`, `scoreRun`, `personalBest`,
`trend`, `zetamacEntry`, `formatClock`.

### F1. `generate(kind, seed, config)` → run

```
{ kind, seed: seed >>> 0, config: normalizeConfig(kind, config), timeLimitSecs, questions: [Question] }
```

- It throws if `kind` is not in `KINDS` or `configError(kind, config) !== null`.
- `rng = mulberry32(seed >>> 0)`, used only by this run.
- The same `(kind, seed, config)` gives deep-equal output (spec §5).
- Every Question has `{ i, prompt, answer: { value, tol? } }` plus the kind-specific fields below.
  `i` is the 0-based index. `prompt` is plain text (no markdown). `answer.value` is a string that
  `parseAnswer` accepts, so the UI and tests check answers with `PrepAnswer.checkNumeric(userStr, question)`.

| Kind | Count | `timeLimitSecs` | Answer tolerance | Config |
|---|---|---|---|---|
| `arith` | `4 * durationSecs` (480 by default) **[decision]** | `config.durationSecs` (120 by default) | `{ rel: 0, abs: 0 }` (exact) **[decision]** | editable (F2) |
| `eighty` | 80 | 480 | `{ rel: 0, abs: 1e-9 }` **[decision]** | `{ negativeMarking: false }` |
| `seq` | 15 | 600 | `{ rel: 0, abs: 0 }` **[decision]** | `{}` |
| `ev` | 20 | 300 | none (the `checkNumeric` default; spec §5) | `{}` |

`TIME_LIMITS` = `{ eighty: 480, seq: 600, ev: 300 }` and `QUESTION_COUNTS` = `{ eighty: 80, seq: 15, ev: 20 }`.

- **[decision, Red]** "none" for ev means the `answer` has no `tol` key, so `checkNumeric` applies
  `DEFAULT_TOL`. Tests check this by behaviour only (off by 0.05% is right, off by 0.2% is wrong,
  for `|v| > 1e-6`), never by inspecting `answer`.

### F2. `arith` (Zetamac clone, spec §5)

- `defaultConfig("arith")` =
  `{ ops: ["add","sub","mul","div"], addA: [2,100], addB: [2,100], mulA: [2,12], mulB: [2,100], durationSecs: 120 }`.
- `normalizeConfig("arith", c)` fills each missing key from the default. It turns `ops` into the
  distinct known ops in the canonical order `add, sub, mul, div`. Each range bound and
  `durationSecs` that is a string is passed through `Number()` **[decision]** (so UI input strings
  such as `["2","100"]` normalise to `[2,100]`, and a default game still counts as default).
  Present-but-invalid values (e.g. `[5, 2]`, `NaN`, `3.5`) are KEPT, so `configError` can report
  them. Keys always come out in the order above. It never throws.
  **[decision, Red]** Input handling, exactly: `c` that is `null`, `undefined` or not an object
  counts as `{}`. A key is missing only when its value is `undefined` (then the default is used).
  Any other value is present: `ops` that is an array is reduced to its distinct known ops in
  canonical order, and `ops` that is not an array (including `null`) becomes `[]` (so
  `configError` reports it). A range that is an array has each string bound passed through
  `Number()`; `durationSecs` that is a string is passed through `Number()`; every other present
  value (a non-array range, `null`, an object) is kept as is for `configError`. Unknown keys are
  dropped.
- `configError("arith", c)` evaluates `normalizeConfig("arith", c)` and returns a string or `null`.
  Errors (the limits are a **[decision]**):
  - `ops` is empty after normalisation;
  - a range is not `[lo, hi]` with integers `0 <= lo <= hi <= 10000`;
  - `div` is enabled and `mulA[0] < 1`;
  - `durationSecs` is not an integer from 10 to 600.
- **Exact generation**, so tests can reproduce it. **[decision, Red]** `config` below is the
  NORMALISED config (`run.config`), never the raw argument. For `i = 0 .. count-1`:
  1. `op = pick(rng, config.ops)` (1 draw).
  2. `add` or `sub`: `x = randInt(rng, addA[0], addA[1])`, then `y = randInt(rng, addB[0], addB[1])`.
     `mul` or `div`: `x = randInt(rng, mulA[0], mulA[1])`, then `y = randInt(rng, mulB[0], mulB[1])`.
  3. The question fields `{ op, left, right }` and the answer:

     | op | left | right | answer | symbol |
     |---|---|---|---|---|
     | add | `x` | `y` | `x + y` | `+` |
     | sub | `x + y` | `x` | `y` | `–` (U+2013, as on Zetamac) |
     | mul | `x` | `y` | `x * y` | `×` (U+00D7) |
     | div | `x * y` | `x` | `y` | `÷` (U+00F7) |

     `prompt` = `` `${left} ${symbol} ${right}` ``, and `answer.value` = `String(answer)`.
- So answers are integers and division is exact (spec §5 required test).
- Reference, seed 42 with the default config, first six:
  `6 × 86 = 516`, `3 × 54 = 162`, `150 – 63 = 87`, `115 – 26 = 89`, `5 × 21 = 105`, `9 × 62 = 558`.

### F3. `eighty` (Optiver 80-in-8, spec §5)

- 80 questions, exactly 10 from each of the 8 categories, in an order shuffled with the run's rng.
  The categories, ranges and the 10-per-category split are a **[decision]**.
  Each question has a `category` field and a `params` object holding exactly the parameters of
  its row below (e.g. `{ A, B }` for `add-dec`), so tests check ranges and answers from `params`
  without parsing prompts.
- Draw order within a run is implementation-defined. Only determinism, the ranges, `params` and
  the answer values are contract.
- **[decision, Red]** The shuffle is per question (for example `PrepRng.shuffle` of the whole
  80-question list), not of category blocks: tests may assert that a run is not grouped into
  blocks (more than 7 category changes) and that different seeds give different orders.
- **[decision, Red]** `EIGHTY_CATEGORIES` is an array of the 8 category id strings, in the order of
  the table below (like `SEQ_FAMILIES` and `EV_TEMPLATES`).
- `EIGHTY_CATEGORIES` and their exact definitions (all draws are integers from inclusive ranges,
  except `p`, which is picked from its set):

| `category` | `params` | `prompt` | Answer |
|---|---|---|---|
| `add-dec` | `{ A, B }`, `A, B ∈ [100, 9999]` | `` `${dec(A,2)} + ${dec(B,2)}` `` | `(A + B) / 100` |
| `sub-dec` | `{ A, B }`, `A, B ∈ [100, 9999]` | `` `${dec(A,2)} – ${dec(B,2)}` `` | `(A − B) / 100` (may be negative) |
| `mul-2x2` | `{ a, b }`, `a, b ∈ [11, 99]` | `` `${a} × ${b}` `` | `a · b` |
| `mul-3x2` | `{ a, b }`, `a ∈ [100, 999]`, `b ∈ [11, 99]` | `` `${a} × ${b}` `` | `a · b` |
| `mul-dec` | `{ A, b }`, `A ∈ [11, 99]`, `b ∈ [2, 19]` | `` `${dec(A,1)} × ${b}` `` | `A · b / 10` |
| `div` | `{ b, q }`, `b ∈ [2, 19]`, `q ∈ [2, 99]` | `` `${b*q} ÷ ${b}` `` | `q` |
| `pct` | `{ p, n }`, `p ∈ {5, 10, 12.5, 15, 20, 25, 30, 40, 50, 60, 75, 80}`, `n ∈ [10, 999]` | `` `${p}% of ${n}` `` | `p · n / 100` |
| `frac` | `{ k, d }`, `d ∈ {2, 4, 5, 8, 10, 16, 20, 25, 40}`, `k ∈ [1, d − 1]` | `` `${k}/${d} as a decimal` `` | `k / d` |

- `dec(N, k)` writes the integer `N` divided by `10^k` as a decimal string with trailing zeros
  removed (`dec(1250,2)` = `"12.5"`, `dec(1200,2)` = `"12"`).
- `answer.value` is the exact decimal string, computed with integer arithmetic. It has no exponent,
  no trailing zeros, and a leading `0.` when `|x| < 1`. Every answer is a terminating decimal with
  at most 4 decimal places. **[decision, Red]** Exactly, it matches
  `/^-?(0|[1-9]\d*)(\.\d{0,3}[1-9])?$/`, and zero is `"0"` (never `"-0"`).
- Tests may assert `|parseAnswer(q.answer.value).value − independent value| <= 1e-9`.
- Negative marking is a config flag, `{ negativeMarking: boolean }`, applied by `scoreRun` (F7).

### F4. `seq` (number sequences, spec §5)

- 15 questions. Each family appears at least once and at most twice per run. Draw order is
  implementation-defined. The family definitions, ranges, `SEQ_SHOWN = 7` and the fit rules are a
  **[decision]**; the family list itself is the spec's.
- Question fields: `{ family, params, shown, prompt, answer }`.
  - `params` deep-equals `seqFit(q.family, q.shown)` (the fit's parameter names, below);
  - `shown` is an array of `SEQ_SHOWN = 7` integers `t_0 … t_6`;
  - the answer is `t_7`;
  - `prompt` = `` shown.join(", ") + ", ?" ``;
  - all terms and the answer are integers with absolute value at most 100000.
- `PRIMES` = the first 120 primes, `[2, 3, 5, 7, …]`, with `P_0 = 2`.

`SEQ_FAMILIES` (ids, in this order), with generation ranges and the exact fit rules:

| id | Definition (k = 0, 1, …) | Generation ranges | `seqFit(id, t)` accepts iff (returns params, else `null`) | `seqNext(id, t)` |
|---|---|---|---|---|
| `arithmetic` | `t_k = a + k·d` | `a ∈ [−20, 50]`, `d ∈ [−15, 15] \ {0}` | `d = t1 − t0 ≠ 0` and every consecutive difference equals `d` → `{ a: t0, d }` | `t6 + d` |
| `geometric` | `t_k = a·r^k` | `a ∈ [1, 10]`, `r ∈ {−3, −2, 2, 3}` | `t0 ≠ 0`, `r = t1 / t0` is an integer with `abs(r) >= 2`, and `t_{k+1} = r·t_k` for all k → `{ a: t0, r }` | `r·t6` |
| `second-diff` | `t_k = a + b·k + c·k(k−1)/2` | `a ∈ [−10, 30]`, `b ∈ [−10, 10]`, `c ∈ [−5, 5] \ {0}` | with `D_k = t_{k+1} − t_k`: `c = D1 − D0 ≠ 0` and every `D_{k+1} − D_k = c` → `{ a: t0, b: D0, c }` | `t6 + D5 + c` |
| `fib-like` | `t_0 = a`, `t_1 = b`, `t_k = t_{k−1} + t_{k−2}` | `a, b ∈ [1, 12]` | `t_k = t_{k−1} + t_{k−2}` for k = 2..6 → `{ a: t0, b: t1 }` | `t6 + t5` |
| `interleaved` | `t_{2j} = a1 + j·d1`, `t_{2j+1} = a2 + j·d2` | `a1, a2 ∈ [1, 30]`, `d1, d2 ∈ [−9, 9] \ {0}` | evens `t0,t2,t4,t6` are arithmetic with `d1 = t2 − t0 ≠ 0`, and odds `t1,t3,t5` are arithmetic with `d2 = t3 − t1 ≠ 0` → `{ a1, d1, a2, d2 }` | `t5 + d2` |
| `powers` | `t_k = (k + s)^p + c` | `p ∈ {2, 3}`; `s ∈ [1, 6]` if `p = 2`, `s ∈ [1, 4]` if `p = 3`; `c ∈ [−10, 10]` | try `p = 2`: `s = (t1 − t0 − 1)/2` is an integer, `c = t0 − s²`, all terms match. Else try `p = 3`: `s = (t2 − 2·t1 + t0 − 6)/6` is an integer, `c = t0 − s³`, all terms match. → `{ p, s, c }` (any integer `s` is accepted in the fit) | `(7 + s)^p + c` |
| `primes` | `t_k = P_{k+s} + c` | `s ∈ {0, 1, 3, 4, 5}`, `c ∈ [−10, 10]` | the smallest `s ∈ [0, 100]` such that `t_k − P_{k+s}` is the same for every k → `{ s, c: t0 − P_s }` | `P_{7+s} + c` |
| `alt-ops` | `t_0 = x0`, `t_{k+1} = t_k + a` if k is even, `t_k · b` if k is odd | `x0 ∈ [1, 10]`, `a ∈ [1, 9]`, `b ∈ {2, 3}` | `a = t1 − t0 ≠ 0`, `t1 ≠ 0`, `b = t2 / t1` is an integer with `abs(b) >= 2`, and the rule holds for k = 0..5 → `{ x0: t0, a, b }` | `t6 + a` |

- `primes` excludes `s = 2`: `5, 7, 11, 13, 17, 19, 23` (+ c) also fits `interleaved` (both halves
  step by 6), which predicts `25 + c` instead of `29 + c`, so that draw would always be rejected.
  Tests MUST NOT expect a primes question with `s = 2`.

- `seqFit` and `seqNext` are specified for arrays of exactly 7 integers. `seqNext(id, t)` returns
  `null` iff `seqFit(id, t)` is `null`. An unknown `id` throws.
- **Uniqueness (spec §5 required test).** After drawing parameters, the generator computes `shown`
  and `answer`. It rejects and redraws parameters for the same family if:
  - any family `f` has `seqNext(f, shown) !== null && seqNext(f, shown) !== answer`; or
  - any value exceeds the magnitude limit.

  After 100 rejections it throws.

  **[decision, Red]** The rejection step is tested only through its observable property: the
  property below on generated runs (with the test's OWN fits, over many seeds), plus `seqFit` /
  `seqNext` on hand-made conflicting sequences (e.g. `[1,3,7,9,13,15,19]`, which fits both
  `primes` and `interleaved`). Within the ranges above conflicts are rare (they occur only between
  `interleaved` draws and `primes` with `s = 2`), draw order is implementation-defined, and there
  is no test hook, so the rejection loop and the 100-rejection throw are not directly testable.
- So for every generated question and every `f` in `SEQ_FAMILIES`: `seqNext(f, q.shown)` is
  `null` or equals the answer. Also, `seqNext(q.family, q.shown)` equals the answer, and
  `q.params` deep-equals `seqFit(q.family, q.shown)`. With the ranges above the fit recovers the
  drawn parameters exactly (for `primes`, the seven-term windows for `s ∈ {0, 1, 3, 4, 5}` have
  distinct gap patterns), so tests may also assert that `q.params` lie in the generation ranges.

### F5. `ev` (expected-value quickfire, spec §5)

- 20 questions: each of the 10 templates exactly twice, in an rng-shuffled order. Draw order is
  implementation-defined. The template list is a **[decision]**: it includes the spec's two
  examples, and every template is finitely enumerable so a test can brute-force it.
- Question fields: `{ template, params, prompt, answer }`. `answer.value = String(v)`, where `v` is
  the exact expectation computed by enumeration or dynamic programming inside the generator (never
  hard-coded and never a closed-form shortcut; spec §5).
- Tests may assert `|parseAnswer(q.answer.value).value − bruteForce(q.template, q.params)| <= 1e-9 * max(1, |bf|)`.
  The prompt text is implementation-defined: tests may only assert that it is a non-empty string.
- **[decision, Red]** `params` holds exactly the parameters of the template's row below (as for
  eighty, §F3). "Computed by enumeration or DP, never a closed form" is a code-review rule: a
  closed form gives the same values, so unit tests check only the values against brute force.

`EV_TEMPLATES` (ids in this order). All dice and coins are fair and independent. A `d{f}` takes
values `1..f` uniformly. Cards come from a standard 52-card deck, 4 of each rank `1..13` (A=1 … K=13).

| id | params | Exact quantity | Reference |
|---|---|---|---|
| `dice-max` | `k ∈ {2, 3}`, `f ∈ {4, 6, 8, 10, 12}` | `E[max(X_1..X_k)]`, `X_i ~ d{f}` | k=2, f=6: 161/36 = 4.47222… |
| `dice-min` | `k ∈ {2, 3}`, `f ∈ {4, 6, 8, 10, 12}` | `E[min(X_1..X_k)]` | k=2, f=6: 91/36 |
| `dice-absdiff` | `f ∈ {4, 6, 8, 10, 12, 20}` | `E[abs(X − Y)]`, `X, Y ~ d{f}` | f=6: 35/18 |
| `dice-reroll` | `f ∈ {4, 6, 8, 10, 12, 20}`, `r ∈ {1, 2, 3}` | Roll `d{f}`. After each roll you may stop and be paid the face, or reroll, with at most `r` rerolls; after the r-th reroll you must stop. Value under optimal play: `V_0 = (f+1)/2`, `V_j = (1/f)·Σ_{x=1..f} max(x, V_{j−1})`, answer `V_r`. | f=6: r=1 → 4.25, r=2 → 14/3, r=3 → 4.94444… |
| `dice-threshold` | `t ∈ [4, 11]`, `c ∈ [1, 5]` | Roll two d6, sum `S`. Payoff is `S` if `S >= t`, else `−c`. `E[payoff]`. | |
| `dice-distinct` | `k ∈ [2, 6]` | Roll a d6 `k` times. `E[number of distinct faces seen]`. | k=2: 11/6 |
| `coins-maxrun` | `n ∈ [3, 10]` | Flip `n` coins. `E[length of the longest run of consecutive heads]` (0 if there are no heads). | n=3: 1.375, n=4: 1.6875 |
| `coins-absdiff` | `n ∈ [2, 10]` | Flip `n` coins. `E[abs(heads − tails)]`. | n=2: 1, n=3: 1.5 |
| `cards-max` | `k ∈ {2, 3}` | Draw `k` cards without replacement. `E[highest rank]`. | |
| `cards-first-high` | `r ∈ [10, 13]` | Deal a shuffled deck one card at a time. `E[number of cards dealt up to and including the first card of rank >= r]`. | r=13: 10.6, r=10: 53/17 |

### F6. Config helpers

- `defaultConfig(kind)`: arith as in F2; `eighty` → `{ negativeMarking: false }`; `seq`, `ev` → `{}`.
- `normalizeConfig(kind, c)`: arith as in F2; eighty → `{ negativeMarking: c?.negativeMarking === true }`;
  seq and ev → `{}`.
- `configError(kind, c)`: arith as in F2; the other kinds → `null`.
- `sameConfig(kind, a, b)` =
  `JSON.stringify(normalizeConfig(kind, a)) === JSON.stringify(normalizeConfig(kind, b))`.
- `isDefaultConfig(kind, c)` = `sameConfig(kind, c, defaultConfig(kind))`. Only an arith run with
  `isDefaultConfig("arith", run.config)` writes the zetamac track (spec §2, §5).
- `formatClock(secs)` **[decision]** = `` `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` `` with
  `s = max(0, Math.ceil(secs))`, e.g. `formatClock(120)` = `"2:00"`, `formatClock(59.2)` = `"1:00"`.

### F7. Scoring and history

`scoreRun(kind, answers, config = defaultConfig(kind))`. The optional third argument **[decision]**
carries the negative-marking flag, which the spec's `scoreRun(kind, answers)` has no other way to receive:

- `answers` is an array of `{ correct: true | false | null, ... }`, one per question the user
  answered or skipped (an empty `Enter`), in order. Only `correct` is read. `null` (or a missing
  value) means skipped. The question on screen when time runs out is NOT recorded.
- **arith [decision]:** `answers` holds one `{ correct: true }` per auto-advanced question and
  nothing else (arith has no submit and no skip). So for arith `total = score = correct =
  answers.length` and `wrong = skipped = 0`.
- It returns `{ score, total, correct, wrong, skipped }`:
  - `correct` = the count of `true`; `wrong` = the count of `false`;
  - `total` = `answers.length` for `arith`, otherwise `QUESTION_COUNTS[kind]`;
  - `skipped` = `total − correct − wrong` (so questions never reached count as skipped);
  - `score` = `correct − (kind === "eighty" && normalizeConfig(kind, config).negativeMarking ? wrong : 0)`
    (it can be negative). For every other kind, `score` = `correct`.
  - **[decision, Red]** Tests compare only these five keys; extra keys on the result are
    implementation-defined.

Other helpers:

- `personalBest(runs, kind, config = defaultConfig(kind))` = the maximum `score` over ALL `oaRuns`
  entries with `r.kind === kind && sameConfig(kind, r.config, config)`, or `null` if there are none.
  **[decision]**: the spec's "over the last 10 runs" applies to `trend` only; a personal best is
  all-time.
- `trend(runs, kind, config = defaultConfig(kind))` = the `score`s of the last 10 such runs,
  stable-sorted by `ts` ascending, oldest to newest (length 0 to 10). Spec §5: "over the last 10 runs".
  **[decision, Red]** "Last 10" follows the §H3 rule: stable-sort ALL matching runs by `ts`
  ascending, then take the final 10 (not the last 10 in array order).
- `zetamacEntry(run)`, where `run` is an `oaRuns` entry, returns
  `{ ts: run.ts, track: "zetamac", amount: run.score, unit: "score", note: "in-app" }` when
  `run.kind === "arith"`, `isDefaultConfig("arith", run.config)` holds and `run.score` is an integer
  of at least 0. Otherwise it returns `null` (spec §2). A score of 0 is written, matching
  `content-zetamac.js`.
  **[decision, Red]** "Integer" means `Number.isInteger(run.score)`, so a numeric string such as
  `"37"` gives `null` (as `tests/v4-oa.test.js` asserts).
- `oaRuns` entry (spec §2): `{ ts, kind, seed, score, total, secs, config }`.
  - `secs` = the elapsed whole seconds, at most `timeLimitSecs`.
  - `config` = the normalised config.
  - Only finished runs are stored: time up, or the last question answered or skipped. Quitting
    discards the run **[decision]**.

---

## G. `prep/market.js` (`PrepMarket`)

Exports: `SCENARIOS`, `DEFAULT_MAX_POS` (= 10, spec §6), `DEFAULT_MAX_WIDTH` (= `{ dice: 4, cards: 8, coins: 3 }` **[decision]**),
`EV_EPS` (= 1e-9), `createGame`, `conditionalEV`, `validateQuote`, `submitQuote`, `settle`,
`runEntry`, `goodQuoterLine`.

All functions are pure. `submitQuote` returns a NEW state and never mutates its input.

### G1. `createGame(kind, seed, opts = {})` → state

`opts`: `{ n?, batch?, values?, bots?: "noise" | "informed" | "mixed" (default "mixed"), maxPos? (default 10), maxWidth? (default DEFAULT_MAX_WIDTH[kind]) }`.

**Exact RNG consumption.** `rng = mulberry32(seed >>> 0)`. A parameter given in `opts` consumes no draw.

| kind | Draws, in order |
|---|---|
| `dice` | `n = opts.n ?? randInt(rng, 3, 10)`; then `values = opts.values ?? n faces, each randInt(rng, 1, 6)` |
| `cards` | `n = opts.n ?? randInt(rng, 3, 8)` **[decision: K is 3..8]**; then, unless `opts.values` is given: `deck = [1,1,1,1,2,2,2,2,…,13,13,13,13]` (52 entries, ascending); for j < n: `idx = randInt(rng, 0, deck.length − 1)`, push `deck[idx]`, `deck.splice(idx, 1)` |
| `coins` | `batch = opts.batch ?? randInt(rng, 2, 5)`; `n = opts.n ?? batch * randInt(rng, 3, 8)` **[decision: ranges]**; then `values = opts.values ?? n flips, each (rng() < 0.5 ? 1 : 0)` (1 = heads) |

- **[decision, Red]** `state.seed` (and so the `runEntry` seed) is `seed >>> 0`, as in §F1.
- If `opts.values` is given, then `n = opts.values.length` and no `n` draw happens. Coins still
  draw `batch` unless `opts.batch` is given. If both `opts.n` and `opts.values` are given and
  disagree, it throws.
- Values are validated, and it throws if invalid: dice are integers 1–6; cards are integers 1–13
  with no rank more than 4 times; coins are 0 or 1.
- **[decision, Red]** Injected sizes need not lie in the drawn ranges: an `opts.n` that is an
  integer of at least 1 (at most 52 for cards), an `opts.batch` that is an integer of at least 1,
  and an `opts.values` of length at least 1 are all valid, and `batch` need not divide `n` (the
  last batch is partial). Anything else (`n` or `batch` not an integer, below 1, cards `n > 52`,
  `values` empty or not an array) throws.
- **[decision, Red]** `state.rng` is the §B1 `state` after the k creation draws: one
  `PrepRng.rngNext(state.rng)` gives `value` = draw k+1 of `mulberry32(seed >>> 0)`. It changes
  only in noise-bot rounds (one step each), never in informed-only rounds.
- An unknown `kind`, an unknown `bots`, `maxPos < 1` or `maxWidth <= 0` throws **[decision]**.
- After creation, the rng is consumed only by the noise bot, one draw per round (G3).
- Reference, seed 7, no opts:
  - dice: `n = 3`, faces `[1, 6, 5]`, V = 12; noise draws then give bot sells, bot buys, bot buys.
  - cards: `n = 3`, cards `[1, 13, 9]`.
  - coins: `batch = 2`, `n = 6`, flips `0,0,0,1,1,1`.

**State** (plain JSON, readable by tests):

```
{
  kind, seed, n, batch,            // batch: number for coins, null otherwise
  rounds,                          // dice, cards: n; coins: ceil(n / batch)
  maxWidth, maxPos, bots,
  outcomes: [...],                 // all n hidden values (dice faces, card ranks, coin flips)
  revealed: [...],                 // the public prefix of outcomes
  round: 0..rounds,                // index of the next round to play
  done: boolean,                   // round === rounds
  cash: 0, position: 0, maxAbsPos: 0,
  history: [ { round, fair, bid, ask, publicEV, informedEV, fills: [Fill] } ],
  rng: <uint32 mulberry32 state>   // advance it with PrepRng.rngNext
}
Fill = { round, bot: "noise" | "informed", userSide: "buy" | "sell", price, rejected: boolean, publicEV, positionAfter }
```

- `userSide` is the user's side. A bot buying means the user sells at the ask.
- `V = sum(outcomes)`.

### G2. Round structure (spec §6)

- The number of rounds is `rounds`. Round `i` reveals one unit for dice and cards (`outcomes[i]`).
  For coins it reveals the next `batch` flips; the last batch may be partial.
- Before the user quotes in round `i`, `revealed` holds the reveals of rounds `0 .. i−1`. Round 0
  has nothing revealed.
- The user submits `{ fair, bid, ask }`. The bots trade. Then round `i`'s reveal is appended to
  `revealed`. After the last round everything is revealed and `done` is true. Then `settle`.

### G3. `submitQuote(state, { fair, bid, ask })`

Returns `{ ok: true, state: newState, fills, reveal }` or `{ ok: false, error }`. On error the
state is unchanged. The steps:

1. `state.done` → error, keyword `over`.
2. `validateQuote(state, quote)` (also exported, returns `{ ok: true }` or `{ ok: false, error }`).
   **[decision]** Each of `fair`, `bid` and `ask` must be a finite number, or a string whose
   trimmed form is non-empty and parses with `Number()` to a finite value; otherwise error, keyword
   `number` (so `""`, `"  "`, `null`, `undefined` and `"abc"` are errors, because `Number("")` is 0).
   The quote must have `bid < ask` strictly (keyword `bid`), and `ask − bid <= state.maxWidth`
   (keyword `width`) (spec §6). The fair value need not lie between bid and ask. After
   validation the three values are used as `Number(x)`, so Fill prices and history are numbers.
   **[decision, Red]** The checks run in this order and the first failure is reported: the
   `number` check on all three fields, then `bid < ask`, then the width.
3. `publicEV = conditionalEV(state, revealed)` and
   `informedEV = conditionalEV(state, revealed.concat(thisRoundReveal))`.
4. Bots act in the FIXED order noise, then informed **[decision]**, filtered by `state.bots`
   (`"mixed"` = both, one of each per round; spec §6):
   - **noise:** one draw `u` (`rngNext` on `state.rng`). If `u < 0.5` the bot buys at the ask
     (user sells at `ask`), otherwise it sells at the bid (user buys at `bid`).
   - **informed:** no draw. If `informedEV > ask + EV_EPS` it buys at the ask (user sells). If
     `informedEV < bid − EV_EPS` it sells at the bid (user buys). Otherwise it passes, and no Fill
     is recorded. Exactly equal (within `EV_EPS` **[decision]**) means no trade (spec §6).
5. **Position limit, per fill** (spec §6): `newPos = position + (userSide === "buy" ? 1 : −1)`.
   If `abs(newPos) > maxPos`, the fill is recorded with `rejected: true` and changes nothing.
   Otherwise `position = newPos`, cash changes by `+price` (user sells) or `−price` (user buys),
   and `maxAbsPos = max(maxAbsPos, abs(position))`. The second bot in a round sees the position
   left by the first.
6. Append the round's record to `history`, append the reveal to `revealed`, `round += 1`, and set
   `done = (round === rounds)`.

- `fills` in the result are this round's Fills (rejected ones included). **[decision, Red]** They
  deep-equal `newState.history[i].fills` for that round `i`.
- `reveal` is the array of units revealed by this round.
- **[decision, Red]** A rejected Fill's `positionAfter` is the unchanged position (the fill changed
  nothing). Tests compare `positionAfter` on accepted fills; on rejected fills they check that
  `position`, `cash` and `maxAbsPos` did not change.

### G4. `conditionalEV(scenario, revealed)` (spec §6)

`scenario` is any object with `kind` and `n` (a state works). `revealed` is the flat array of the
first `m` units. For coins this means individual flips, not batches. It throws `RangeError` if `m > n`.

| kind | E[V given revealed] |
|---|---|
| dice | `S + (n − m) * 3.5` |
| coins | `S + (n − m) * 0.5` |
| cards | `S + (n − m) * ((364 − S) / (52 − m))`, without replacement; 364 = 4 · (1 + … + 13) |

`S = sum(revealed)`. Tests check this against brute-force enumeration of the unrevealed units for
small cases (spec §6 required test).

### G5. `settle(state)` → metrics

It throws if `!state.done`. Otherwise it returns:

```
{ V, pnl, cash, position, edge, adverse, trades, maxPos, fairErrors, meanFairError }
```

| Metric | Definition (non-rejected fills only) |
|---|---|
| `pnl` | `cash + position * V` (spec §6) |
| `edge` | `Σ (price − fill.publicEV) * s`, with `s = +1` when the user SELLS and `−1` when the user BUYS **[decision]**. The spec's "sign of the user's side" is read so that positive edge is good for the user, as the market readiness formula `0.5 + edge/2` (spec §8) requires. `publicEV` is the expected value from public information at the time of the trade (spec §6). |
| `adverse` | `−Σ (price − V) * s` over informed fills: the P&L lost to informed fills. Positive means a loss. **[decision]**: uses the realised V. |
| `trades` | the number of non-rejected fills |
| `maxPos` | `state.maxAbsPos`, the largest absolute position at any time |
| `fairErrors` | per round, `abs(fair − publicEV)` (spec §6) |
| `meanFairError` | the mean of `fairErrors` |

- `runEntry(state, ts)` → the `mmRuns` entry (spec §2):
  `{ ts, scenario: state.kind, seed: state.seed, pnl, edge, trades, maxPos, fairErrors }`, taken
  from `settle`. `fairErrors` is stored as the per-round array. **[decision, Red]** The entry has
  exactly these eight keys (the spec §2 `mmRuns` shape).
- **[decision, Red]** A metric that is a sum of signed terms (`edge`, `adverse`) may come out as
  `-0` when it is zero. The sign of a zero is not contract (§N6).
- `goodQuoterLine(state)` (requires `done`) =
  `` `Good quoter: centre each quote on E[V | revealed]: ${evs.join(" → ")}. Your mean fair error: ${meanFairError.toFixed(2)}.` ``,
  where `evs` are the rounds' `publicEV` values, each as `String(Number(v.toFixed(2)))`.
- **[decision, Red]** "(requires done)" means the same as for `settle`: `runEntry` and
  `goodQuoterLine` throw if `!state.done`.

**Worked example** (tests may use it as-is). `createGame("dice", 7)`: outcomes `[1,6,5]`, bots
mixed, maxWidth 4.

| Round | Quote (fair / bid / ask) | publicEV | Fills |
|---|---|---|---|
| 0 | 10.5 / 9.5 / 11.5 | 10.5 | noise: user buys at 9.5; informed (EV 8): user buys at 9.5 |
| 1 | 8 / 7 / 9 | 8 | noise: user sells at 9; informed (EV 10.5): user sells at 9 |
| 2 | 10 / 9 / 11 | 10.5 | noise: user sells at 11; informed (EV 12): user sells at 11 |

`settle` gives `V = 12`, `cash = 21`, `position = −2`, `pnl = −3`, `edge = 5`, `adverse = 1.5`,
`trades = 6`, `maxPos = 2`, `fairErrors = [0, 0, 0.5]`.

---

## H. `prep/readiness.js` (`PrepReadiness`)

Exports: `AREA_KEYS`, `MOCK_MODES`, `OA_TARGETS` (= `{ eighty: 60, seq: 12, ev: 16 }`), `EV_TOPIC`
(= `"expected-value"`), `HISTORY_CAP` (= 20000), `MISTAKES_CAP` (= 5000), `PRACTICE_LOG_CAP`
(= 2000), `REASONING_MARKER` (= `"[Check my reasoning]"`), `nc150Progress`, `areaScores`,
`areaScoresAt`, `under60`, `parseVerdictScore`, `mockVerdicts`, `mistakeTopics`, `weakestTopics`,
`pickInterviewMaterial`, `interviewMaterialBlock`, `prepSummaryLine`, `prepWeeklyLine`,
`amDrillEntry`, `drillLabel`, `drillBannerText`, `drillPromptLine`, `drillAdvance`, `drillFinish`,
`historyEntry`, `mistakeFor`, `appendCapped`, `practiceTrack`, `sessionPracticeEntries`,
`upsertSessionEntry`, `reasoningRequest`.

- **[decision, Red]** Every `bank` in this section is de-duplicated by id first (the first
  occurrence in bank order wins, as `PrepBank.indexById` and §D6). So mastery denominators (§H3)
  count distinct ids, history and mistakes map to the first item with their id, and the §H6 pool
  holds each id once.

### H1. History and mistakes

- `prepHistory` entry (spec §2): `{ ts, itemId, mode: "auto" | "self", correct, grade, secs, answer }`.

  | Field | Rule |
  |---|---|
  | `mode` | `"auto"` for numeric and mcq items, `"self"` for free items |
  | `correct` | a boolean for auto entries, `null` for self entries |
  | `grade` | one of `GRADES`. For auto entries it is `autoGrade(correct, secs, item)`. |
  | `secs` | integer seconds from `shownTs` (the item rendered) to `submitTs`, normalised as `Number.isFinite(Number(x)) ? Math.min(3600, Math.max(0, Math.round(Number(x)))) : 0` where `x = (submitTs − shownTs) / 1000`. `submitTs` is the submit (numeric), the choice click (mcq), or the GRADE-button click (free). The 3600 s clamp and the free-item end point are a **[decision]**. |
  | `answer` | numeric: the trimmed raw input string. mcq: the chosen index (a number). free: the working text, trimmed, at most 2000 characters (`""` if empty) **[decision: 2000]**. |

- A parse error never produces an entry.
- `historyEntry({ ts, itemId, mode, correct, grade, secs, answer })` returns exactly those 7 keys,
  with `secs` normalised as above (it receives the raw seconds) and string answers truncated to
  2000 characters. **[decision, Red]** `historyEntry` only truncates: a string answer becomes
  `answer.slice(0, 2000)` and is not trimmed, and a non-string answer (the mcq index) is kept as
  given. The trimming in the table above is the UI's job, done before it calls `historyEntry`.
- The UI calls `autoGrade(correct, secs, item)` with the NORMALISED secs (the value the entry
  stores).
- The `prepCards` write for an answer uses the same `ts` and `grade` as its history entry, so
  `replayCards(prepHistory, now)` reproduces the stored cards (until the history cap drops entries).
- `mistakeFor(entry)`: if `entry.grade === "again"`, returns `{ ts: entry.ts, itemId: entry.itemId, answer: entry.answer, note: "" }`;
  otherwise `null`. A wrong auto-checked answer always grades `again`, so this covers "every wrong
  auto-checked answer and every `again` grade" (spec §8).
- `appendCapped(list, entries, cap)` = `[...(list || []), ...entries].slice(-cap)`. The oldest
  entries are dropped. It is used with `HISTORY_CAP`, `MISTAKES_CAP` and `PRACTICE_LOG_CAP`
  (spec §2).

### H2. `nc150Progress(list, lcSolves)` (spec §8)

- Returns `{ solved, total, byPattern: { [pattern]: { solved, total } }, next }`.
- `total = list.problems.length`. A problem is solved iff some `lcSolves` entry has
  `slug === problem.slug` (exact match, at any time; `noAI` is ignored). `solved` counts the
  solved list problems.
- `byPattern` keys appear in order of first appearance in `list.problems`. **[decision, Red]** This
  holds for pattern names that are not integer-like; JS puts integer-like keys (`"1"`, `"42"`)
  first in ascending order, and tests use only non-numeric pattern names.
- `next` = the first unsolved problem object, as it appears in `list.problems` (array order
  **[decision]**), or `null` if all are solved.
- `list` null → `{ solved: 0, total: 0, byPattern: {}, next: null }`.

### H3. `areaScores(inputs)` (spec §8)

```
inputs = {
  bank:        Item[] | null,          // merged items
  cards:       prepCards | null,
  history:     prepHistory | null,
  lcSolves:    lcSolves | null,
  nc150:       neetcode150 list | null,
  practiceLog: practiceLog | null,
  oaRuns:      oaRuns | null,
  mmRuns:      mmRuns | null,
  facts:       state.memory.facts | null,
}
```

It returns `{ coding, probability, cpp, systems, mental, oa, market, mocks, overall }`. Each value
is an integer from 0 to 100, or `null`.

**[decision, Red]** Any of the nine fields above that is missing or `undefined` in `inputs` is
treated as `null` (for `areaScores`, `areaScoresAt` and `prepWeeklyLine`).

**Rules for every area:**

- `clamp(x)` = `min(1, max(0, x))` is applied to every component (spec §8).
- `score = Math.round(raw)`, where `raw` is the weighted sum of the clamped components.
- **Null rule [decision]:** an area is `null` ONLY when it has no underlying data at all (the
  "data present" column below). When the area has data but a component does not, that component
  counts as 0. (The spec says only that "missing data gives null".)
- "Last N" means: stable-sort the relevant entries by `ts` ascending and take the final N.
- History entries are mapped to areas through `bank` (by `itemId`). Entries whose item is not in
  `bank` are ignored everywhere.
- **[decision, Red]** A "share among the last N" is taken over the entries actually kept: with
  `L` = the last `min(N, count)` entries, the share is (matching entries in `L`) / `L.length`,
  or 0 when `L` is empty.
  So for `coding`, fewer than 30 solves are not padded to 30: 1 no-AI solve out of 4 gives 0.25.

| Area | Data present iff | Components (each clamped) | raw |
|---|---|---|---|
| `coding` | `lcSolves` is non-empty | `c1 = (nc150 ? nc150Progress(nc150, lcSolves).solved : 0) / 150`; `c2 = m === null ? 0 : min(1, 1200 / m)` with `m = amMedianMediumSecs(lcSolves)` (v3, the last 10 timed Mediums); `c3` = noAIShare = among the last 30 solves, the share with `noAI === true` (absent or `null` counts as not no-AI) | `50·c1 + 30·c2 + 20·c3` |
| `probability` | some history entry maps to area `probability` or `brainteaser` | `mastery = masteryOf(cards, ids of ALL bank items in those areas) ?? 0` (the denominator includes never-seen items **[decision]**); `acc`: let `E` = the history entries whose item area is `probability` or `brainteaser` AND `mode === "auto"`, stable-sorted by `ts`; take the last 50 of `E` (filter first, then take); `acc` = (count with `correct === true`) / (that count), or 0 if `E` is empty | `60·mastery + 40·acc` |
| `cpp` | some history entry maps to `cpp` | mastery over all cpp bank items; `acc`: the history entries whose item area is `cpp` (any mode), stable-sorted by `ts`, last 50; `acc` = the share with `answerOk` (the spec says "last 50 cpp answers", not only auto-checked) | `70·mastery + 30·acc` |
| `systems` | same, for `systems` | same, for `systems` | `70·mastery + 30·acc` |
| `mental` | `practiceLog` has an entry with `track === "zetamac"` | `min(1, mean(amount of the last 5 zetamac entries) / 60)`. **[decision]**: every zetamac entry counts, in-app and site games alike and of any duration (e.g. a 30 s site game) | `100·c` |
| `oa` | `oaRuns` has a run of kind `eighty`, `seq` or `ev` | for each kind k of eighty, seq, ev: `c_k = min(1, max(score of the last 5 runs of k, any config) / OA_TARGETS[k])`; a kind with no runs gives `c_k = 0` | `100 · (c_eighty + c_seq + c_ev) / 3` |
| `market` | the last 5 `mmRuns` (by ts) have total `trades > 0` | `x = Σ edge / Σ trades` over those games (pooled per-trade edge **[decision]**); `c = clamp(0.5 + x / 2)` | `100·c` |
| `mocks` | `mockVerdicts(facts)` has at least one mode with a score | for each mode with data: `mean(the last 3 scores by date)`; `c = clamp(mean of those mode means / 10)` | `100·c` |

- `overall` = the mean of the already-rounded integer area scores that are not `null`, then
  `Math.round`; `null` if all are `null` (spec §8).
- **[decision, Red]** The `market` data-present rule is applied literally: only the last 5 games
  count, so a traded game older than those 5 leaves `market` `null` when the last 5 have no
  trades (their per-trade edge is undefined, which is the spec's missing data). A 0-trade game
  inside the last 5 is pooled normally (it adds 0 edge and 0 trades).
- `areaScores` does not filter by time.

`areaScoresAt(inputs, cutoffTs)` = `areaScores` computed on inputs truncated to `cutoffTs`:

- `history`, `lcSolves`, `practiceLog`, `oaRuns` and `mmRuns` keep only entries with `ts <= cutoffTs`;
- `cards` is REPLACED by `replayCards(history, cutoffTs)` (§D9, so §D2's `Math.round` applies;
  **[decision, Red]** tests rely only on which side of the 21-day threshold an interval falls);
- `facts` keeps only verdict keys whose date is no later than `amTodayKey(new Date(cutoffTs))`;
  **[decision, Red]** exactly: verdict keys (the §H4 pattern) dated after that day are removed;
  other keys do not matter, because scores read only verdict keys;
- `bank` and `nc150` are unchanged.

`under60(scores)` = the `AREA_KEYS` (in order) whose score is a number below 60. `null` scores are
not listed.

### H4. Verdicts (spec §7)

- `parseVerdictScore(text)`:
  - Applies the spec regex globally: `/(\d+(\.\d+)?)\s*\/\s*10/g`.
  - Every match with `parseFloat(m[1]) <= 10` is kept. The result is the mean of the kept values,
    unrounded **[decision: several matches → the mean]**, or `null` if none are kept.
  - Non-string input → `null`.
  - Examples: `"Verdict: 6/10. Saved."` → 6; `"problem solving 7/10, communication 6/10, code 8/10"`
    → 7; `"7.5 / 10"` → 7.5; `"2027/10"` → `null`.
  - The regex has no look-ahead, so `"6/100"` matches 6. Tests MUST NOT assert behaviour on such
    inputs.
- `mockVerdicts(facts)` returns `{ [mode]: [{ day: "YYYY-MM-DD", score }] }` for every mode in
  `MOCK_MODES`.
  - It reads keys matching `/^interview_(dsa|quantdev|cv|trader)_(\d{8})$/`.
  - Values whose `parseVerdictScore` is `null` are skipped.
  - Each list is sorted by `day` ascending. A mode with no data gets `[]`.
  - **[decision, Red]** The result has exactly the four `MOCK_MODES` keys, and each entry is
    exactly `{ day, score }`. A matching key whose value is not a string is skipped (its
    `parseVerdictScore` is `null`).
- **Checkpoint** (spec §8): the dashboard shows
  `amNextCheckpoint(AM_CHECKPOINTS, new Date(now))` (from `practice.js`, reused as-is) and
  `under60(scores)`.

### H5. Mistakes

`mistakeTopics(mistakes, bank)` returns `[{ topic, count, lastTs, itemIds, entries }]`:

- Each mistake whose `itemId` is in `bank` adds itself to every topic of its item.
- `entries` are the original mistake objects for that topic, sorted by `ts` descending. The sort is
  stable: equal `ts` keep input order.
- `count = entries.length`.
- `lastTs` = the largest `ts`.
- `itemIds` = the distinct `itemId`s of `entries`, in that order.
- Sort: `count` descending, then `lastTs` descending, then `topic` ascending (`<`). Recurring
  topics come first (spec §8).
- Mistakes for unknown items are ignored.

`weakestTopics(mistakes, bank, now, n = 3)` returns a `string[]`:
`mistakeTopics(recent, bank).slice(0, n).map(t => t.topic)`, where `recent` = the mistakes with
`ts > now − 30·DAY` **[decision: 30-day window]**.

### H6. `pickInterviewMaterial(bank, cards, history, mode, n = 3)` (spec §7)

- **Pool:**
  - `quantdev`: bank items with area `cpp` or `systems`;
  - `trader`: bank items with area `probability` or `brainteaser`, OR whose `topics` include
    `EV_TOPIC` (`"expected-value"`, in any area) **[decision: the topic name]**;
  - `dsa`, `cv` and anything else: `[]`.
- **Per item:**
  - `carded` = `cards[id]` exists and has a finite `due` (the item has been graded at least once);
  - `interval` = the card's interval, or 0 if it has no card;
  - `lapses` = the card's lapses, or 0;
  - `wrong` = the number of `history` entries for the item with `answerOk(e) === false`.
  - **[decision, Red]** `interval` and `lapses` are read from `cards[id]` whenever it is an object,
    carded or not; a missing or non-finite value counts as 0 (so a `newCard()` gives 0 and 0).
- **Sort [decision]**, one comparator, keys in this order:
  1. carded items before uncarded ones (so the material is real weak spots, spec §7, and never the
     easiest unseen cards while seen ones exist);
  2. `interval` ascending (lowest mastery);
  3. `lapses` descending (most lapses);
  4. `wrong` descending;
  5. `difficulty` ascending;
  6. bank order.

  Uncarded items therefore only fill the list when fewer than `n` pool items are carded.
- Returns the first `n` item objects. It is deterministic.

`interviewMaterialBlock(items)`:

- `""` for an empty array.
- Otherwise, a header line followed by one line per item, joined with `"\n"`:

  ```
  ## Material: the user's weakest bank items — quiz these first, one at a time
  1. [cpp · move-semantics, value-categories] What does `std::move` actually do at run time? — reference answer: Nothing by itself: …
  ```

  The header line is exactly the first line above. The exact item line format is `` `${i + 1}. [${item.area} · ${item.topics.join(", ")}] ${oneLine(item.prompt, 300)} — reference answer: ${oneLine(PrepBank.answerText(item), 200)}` ``.
- `oneLine(s, N)` collapses every whitespace run to one space and trims. If the result is longer
  than N, it keeps the first N characters and appends `"…"`.
- **[decision, Red]** Tests and e2e compare material text only in its `oneLine` form. Every
  Appendix A prompt is single-line and at most 300 characters, so a named item's full prompt may
  be searched for verbatim; answers may exceed 200 characters (e.g. `FX_FREE_WEIGH`,
  `FX_SYS_FREE_FALSESHARING`), so an answer is only ever compared after `oneLine(…, 200)`, or
  through `interviewMaterialBlock`.
- The side panel appends `"\n\n" + block` to the interviewer prompt when the interview mode is
  `quantdev` or `trader` and the block is non-empty. The existing prompt stays first, so the v3
  e2e `startsWith` checks still hold.

### H7. `prepSummaryLine({ scores, dueToday, weakest })` (spec §9 F7)

```
Prep: overall ${f(scores.overall)} · prob ${f(scores.probability)} · cpp ${f(scores.cpp)} · sys ${f(scores.systems)} · due today ${dueToday} · weakest: ${weakest.length ? weakest.join(", ") : "none"}
```

- `f(null)` = `"n/a"` **[decision]**, otherwise the integer.
- An empty `weakest` prints `none` **[decision]**. **[decision, Red]** So does a `null` or
  `undefined` `weakest`.
- Example: `Prep: overall 41 · prob 62 · cpp n/a · sys 12 · due today 4 · weakest: conditional, bayes, dice`.
- The side panel computes the inputs as:
  - `scores = areaScores(...)`;
  - `dueToday = dueCount(bank, cards, localDayStart(now, 1))`;
  - `weakest = weakestTopics(mistakes, bank, now, 3)`.

  It appends the line to the `## Practice tracks` block of the system prompt, after the checkpoint
  line, followed by `drillPromptLine` if that is non-empty.
- **Freshness [decision].** `buildSystemPrompt` stays synchronous. In `sendMessage`, right after
  `getTabContext()`, the panel awaits ONE
  `chrome.storage.local.get(["prepCards","prepHistory","prepMistakes","prepDrill","oaRuns","mmRuns"])`
  (e.g. in a helper `prepPromptParts(now)`) and computes, with `now = Date.now()`, the Prep line,
  the drill line and (only while an interview is active in `quantdev` or `trader` mode) the
  material block (`interviewMaterialBlock(pickInterviewMaterial(bank, cards, history, mode, 3))`,
  §H6), and passes them as a second argument: `buildSystemPrompt(tabContext, prep)`. `maybeDailyCheckin` does the same read before
  `prepWeeklyLine` (§H8). `facts`, `lcSolves` and `practiceLog` come from the panel's existing v3
  caches, and `bank` / `nc150` from `prepData` (§E6). The panel does not cache prep keys, so the
  first request after prep.html writes (e.g. a finished drill) always sees the new values.

### H8. Sunday review additions: `prepWeeklyLine(inputs)` (spec §9 F7)

`inputs` = the `areaScores` inputs plus `now`. The week is the window `(now − 7·DAY, now]`, the same
as `amWeekTotals`. "Last Sunday" = `then = now − 7·DAY` (plain ms) **[decision]**.

```
Prep week: ${N} answered (prob ${a} · brain ${b} · stats ${c} · fin ${d} · cpp ${e} · sys ${g}), auto-checked accuracy ${P}. Score change since last Sunday: ${pieces}.
```

- The per-area counts are history entries in the window, mapped through `bank` (unknown items are
  ignored). `N` is their sum.
- `P` = `${Math.round(100 · share)}%` over the window's auto entries with `correct === true`, or
  `n/a` if there are none. **[decision, Red]** "The window's auto entries" are the same
  bank-mapped window entries as the counts, restricted to `mode === "auto"`: entries for items not
  in `bank` are ignored, and with no bank there are none (`n/a`).
- `pieces` covers `overall, coding, prob, cpp, sys, mental, oa, market, mocks` (the
  score keys overall, coding, probability, cpp, systems, mental, oa, market, mocks),
  joined by `" · "`. Each piece is `<label> <x>`, where `cur = areaScores(inputs)[key]` (stored
  cards, the same numbers as the Prep line and the Dashboard), `prev = areaScoresAt(inputs, then)[key]`
  (replayed cards), and:
  - `cur` null → `n/a`;
  - `prev` null and `cur` not null → `${cur} (new)`;
  - otherwise `${cur} (${sign}${delta})`, where `delta = cur − prev` and the sign is `+` if
    positive, nothing if 0, and ASCII `-` if negative.

  Example: `overall 41 (+5) · coding 30 (+2) · prob 55 (+10) · cpp n/a · sys 12 (new) · mental 70 (-3) · oa n/a · market n/a · mocks 60 (0)`.
- Because every card write uses its history entry's `ts` and grade (§H1), replayed cards equal the
  stored cards, so the delta is consistent (until the 20000-entry history cap drops old entries).
- **Integration with v3 [decision]:** `practice.js` `amWeeklyReviewTrigger` gains an optional input field
  `prep` (string). When it is non-empty, the text `${prep} ` is inserted immediately after the
  checkpoint sentence (after `${cp}. `), before "Grade the week". Without `prep`, the output is
  byte-for-byte what v3 produces, so the v3 tests are unchanged. `maybeDailyCheckin` passes
  `prep: prepWeeklyLine(...)`. **[decision, Red]** `prep` is used only when it is a non-empty
  string (`typeof prep === "string" && prep.length > 0`); any other value (absent, `undefined`,
  `null`, `""`, a non-string) is treated as absent and gives the v3 text. A whitespace-only string
  is non-empty and is inserted as given. Tests assert absent, `undefined` and `""`.
  **[decision, Red]** "As given" means verbatim (no trimming, and no `String.replace` pattern
  expansion, so `$&` or `$1` in `prep` stay as typed), and the insertion is positional (template
  concatenation right after `${cp}. `), not a text search, so a checkpoint label that contains
  "Grade the week" does not move it. This is the only v4 change to `practice.js`: `amDrillEntry`
  and the drill helpers live in `PrepReadiness` (§H9).

### H9. Buddy drills (spec §9 F7)

`amDrillEntry(args, ts = Date.now(), bankTopics = null)` returns an entry or `{ error }`, the same
pattern (and argument order) as `amPracticeEntry(args, ts)`. The spec writes `amDrillEntry(args)`;
the two optional extra arguments are a **[decision]**:

0. `args` that is `null` or not an object → error keyword `area`.
1. `area`: `String(args.area).trim().toLowerCase()` must be in `AREAS`, else error keyword `area`.
2. `count`: `Number(args.count)` must be an integer from 1 to 50, else error keyword `count`.
   Numeric strings such as `"10"` are accepted; `2.5` is rejected.
3. `topics`:
   - absent or `null` → `[]`;
   - otherwise it must be an array of strings, else error keyword `topic`;
   - each is trimmed and lowercased; each must match `TOPIC_RE`, else error keyword `topic`;
   - duplicates are dropped, order kept, at most 10 (more → error keyword `topic`) **[decision: 10]**;
     **[decision, Red]** the cap counts distinct topics, after trimming, lowercasing and dropping
     duplicates (11 entries with 10 distinct topics are accepted);
   - if `bankTopics` is an array (a bank is loaded), every topic must be in it, else error keyword
     `topic`, and the message lists the unknown topics; **[decision, Red]** besides the keyword, tests
     may assert only that each unknown topic, in its normalised form, appears in the message;
   - if `bankTopics` is not an array (no bank), topics are accepted unchecked and filtered later
     (spec §9 F7; "later" is defined below).
4. Returns `{ id: "drill-" + ts, ts, area, topics, count, status: "pending", done: 0, correct: 0, doneTs: null }`.
   **[decision, Red]** `count` is the number `Number(args.count)` checked in step 2 (so `"10"` is
   stored as `10`), and `area` and `topics` are the normalised values.

Other drill helpers:

| Function | Contract |
|---|---|
| `drillLabel(drill)` | `drill.topics.length ? drill.topics.join(", ") : drill.area` |
| `drillBannerText(drill)` | `` `Buddy drill: ${count} ${drillLabel(drill)} items` ``, e.g. `"Buddy drill: 10 conditional-probability items"` (spec §9) |
| `drillAdvance(drill, ok, ts)` | New drill with `done + 1`, and `correct + (ok ? 1 : 0)`. When `done` reaches `count`: `status: "done", doneTs: ts`. A drill that is already done is returned unchanged. |
| `drillFinish(drill, ts)` | New drill with `status: "done", doneTs: ts`, used when the drill queue runs out before `count`. A drill that is already done is returned unchanged. |
| `drillPromptLine(drill, now)` | `""` if there is no drill. Pending: `` `Buddy drill pending in Prep: ${count} ${label} items.` `` Done with `now − doneTs <= 48h`: `` `Buddy drill finished: ${done}/${count} ${label} items, ${correct} correct.` `` Older: `""`. This line is "the note the buddy sees" when the drill is finished **[decision]**. **[decision, Red]** A drill whose `status` is neither `"pending"` nor `"done"` gives `""`. |

- A drill session uses `drillQueue(bank, cards, now, q)` (§D7), where `q` is the stored drill with
  its topics filtered at drill start: prep.html drops the topics that are not in
  `topicSet(items)`, and if none remain, the drill runs area-only (`topics: []`). This filtering is
  the spec's "filtered later" **[decision]**. The stored `prepDrill.topics` are not changed, so the
  banner and the prompt line keep the original label. An empty queue finishes the drill
  immediately with `done: 0`.
- `ok` for a drill item is `answerOk(historyEntry)`.

### H10. Practice-log integration (spec §2)

- `practiceTrack(area)`:
  - `"probability"` for probability, brainteaser, statistics and finance;
  - `"cpp"` for cpp and systems;
  - otherwise `null`.
  - **[decision, Red]** The area is matched literally (no trimming or lowercasing), as in §D9, so
    `"CPP"` gives `null`.
- **One upserted entry per session per track [decision].** Every item session (Practice, Cards,
  `item=`, `source=`, drill) has a `startTs` (ms when it started) and an accumulator
  `{ probItems, cppSecs }`:
  - each answered item whose track is probability adds 1 to `probItems`;
  - each answered cpp or systems item adds `min(entry.secs, 600)` to `cppSecs`, where `entry.secs`
    is its history entry's secs (§H1). The per-item cap of 600 s is a **[decision]**. Time spent
    after an auto answer (reading the solution before Next) is not counted.
  - After EVERY history write, prep.html re-reads `practiceLog` and applies
    `upsertSessionEntry(log, e)` for each `e` of `sessionPracticeEntries(acc, startTs)`, then writes
    the log back. So each answered item is visible at once (spec: "adds 1 to probability"), and
    there is at most one entry per session per track (spec: "at most one entry per session").
  - **[decision, Red]** The accumulator is prep.html logic, not an export. Unit tests replay these
    rules in the test and check the exported `practiceTrack`, `sessionPracticeEntries` and
    `upsertSessionEntry`; the per-item `+1` and the upsert after every history write are covered by
    e2e v4-19, and the 600 s cap only by code review.
- `sessionPracticeEntries({ probItems, cppSecs }, ts)` returns, in this order:
  - `{ ts, track: "probability", amount: probItems, unit: "problems", note: "prep" }` if `probItems >= 1`;
  - `{ ts, track: "cpp", amount: Math.floor(cppSecs / 60), unit: "minutes", note: "prep cards" }`
    if that is at least 1.
- `upsertSessionEntry(practiceLog, entry)` returns a new array: if an element has the same `ts`,
  `track` and `note` as `entry`, it is replaced in place by `entry`; otherwise `entry` is appended.
  The result is then capped with `appendCapped`'s rule (`.slice(-PRACTICE_LOG_CAP)`). `practiceLog`
  `null` counts as `[]`.
- The zetamac entry comes from `PrepOA.zetamacEntry(run)` (§F7) and is appended once per finished
  default-config arith run.
- **Mocks are unchanged from v3:** the buddy logs a finished mock with `log_practice` (spec §2 "a
  finished mock interview still writes `mock`"). v4 adds no automatic `mock` write.
- Every writer re-reads `practiceLog` immediately before its read-modify-write and caps it at
  `PRACTICE_LOG_CAP` (2000), the same as v3.
- **[decision, Red]** Prep writes only the six v3 tracks, with their v3 units. Every prep entry
  with `amount >= 1` equals `amPracticeEntry({ track, amount, note }, ts)`. A zetamac score of 0
  is still written (§F7, matching `content-zetamac.js`) although `amPracticeEntry` rejects an
  amount of 0, so the `amPracticeEntry` check covers positive amounts only.

### H11. `reasoningRequest(item, working, answer, model)` → OpenRouter request body (spec §1 D2)

```js
{
  model: model || "anthropic/claude-haiku-5.5",
  stream: true,
  messages: [
    { role: "system", content: <REASONING_SYSTEM> },   // text is implementation-defined
    { role: "user", content:
        "[Check my reasoning]\nItem: " + item.id +
        "\n\n## Problem\n" + item.prompt +
        "\n\n## My working\n" + (working || "(none)") +
        "\n\n## My answer\n" + (answer || "(none)") +
        "\n\n## Reference answer\n" + PrepBank.answerText(item) +
        "\n\n## Reference solution\n" + item.solution }
  ]
}
```

- There is no `tools` key. **[decision, Red]** The body has exactly the three keys `model`,
  `stream` and `messages`, and `messages` holds exactly the two `{ role, content }` messages shown.
- The user message always starts with `REASONING_MARKER`, which the e2e mock matches **[decision]**.
- The system text MUST tell the model to critique without grading. Tests MUST NOT assert that text.

---

## I. Storage keys (`chrome.storage.local`)

| Key | Shape | Written by | Read by |
|---|---|---|---|
| `prepCards` | spec §2; §D1 | prep.html | prep.html, side panel |
| `prepHistory` | spec §2; §H1; capped at 20000 | prep.html | prep.html, side panel |
| `prepMistakes` | `[{ ts, itemId, answer, note }]`; capped at 5000; `note` trimmed and at most 500 characters **[decision: 500]** (a longer note is truncated, §J2) | prep.html (append; note edits) | prep.html, side panel |
| `oaRuns` | §F7 | prep.html | prep.html, side panel |
| `mmRuns` | §G5 `runEntry` | prep.html | prep.html, side panel |
| `prepSettings` | §D5, written normalised | prep.html | prep.html |
| `lcSolves[*].noAI` | `true`, `false`, or unknown. **Unknown is `null` or absent; the two are equivalent** (spec §2, §8 say `null`; the panel simply never writes the field when there is no answer). Tests MUST assert unknown as `s.noAI == null` (loose equality), never `=== null` or `=== undefined`. | side panel | prep.html, side panel |
| `prepDrill` **[decision: new key]** | the §H9 entry, or absent. One pending drill at a time; a new `assign_drill` replaces it. | side panel (create), prep.html (`drillAdvance` / `drillFinish`; only if `stored.id === session drill id`) | both |
| `amLogs_prep` **[decision: new key]** | the log ring buffer (600 entries), `log.js` format | prep.html | side panel 📜 viewer (`LOG_KEYS` gains it), e2e |
| `practiceLog` | v3 shape `[{ ts, track, amount, unit, note }]`; capped at 2000 | `content-zetamac.js`, side panel (`log_practice`, unchanged from v3), prep.html (probability and cpp session upserts §H10, in-app zetamac) | all |
| `state` | v3. prep.html reads `state.apiKey`, `state.model` and `state.memory.facts`; it never writes `state`. | side panel, background | prep.html (read-only) |

- All prep.html writers re-read the key immediately before a read-modify-write.
- prep.html reads every key it needs at load, re-reads them at every session start and every tab
  show, and re-renders `#drill-banner` (§J3) on a `chrome.storage.onChanged` event for `prepDrill`.
- The side panel reads prep keys on demand (§H7 "Freshness"); it does not cache them.

---

## J. DOM contract (e2e-visible)

Every selector below is a contract. Tests may assert attribute values and the text stated here.
Styling and other text are implementation-defined. "Visible" means Playwright `isVisible()`.
Hidden elements use the `hidden` attribute or `display: none`.

- **[decision, Red]** "Text = X" means the element's `textContent`, with every run of whitespace
  collapsed to one space and the ends trimmed, equals X exactly. "Text includes X" is a substring
  check on the same normalised text. Attribute values are compared exactly.

### J1. `prep.html` URL parameters [decision]

| Param | Effect |
|---|---|
| `fixture=1` | Load `tests/fixtures/bank-mini/` (§E6). |
| `tab=<id>` | The initial tab: one of `today` (default), `practice`, `cards`, `oa`, `market`, `dashboard`, `library`. |
| `item=<id>` | Open the Practice tab with a one-item session for that item, in any area. An unknown id shows `[data-role="empty"]`. |
| `mistake=<ts>` | Only together with `item=<id>`: the item view also shows the mistake-note editor (§J2) for the `prepMistakes` entry with that `(ts, itemId)`. |
| `source=<file>` | Open the Practice tab with a session of `drillQueue(items with source.file === file, cards, now, { count: that many })`. |
| `seed=<n>` | Seed for every OA run and market game on this page. It is used only if it matches `/^\d+$/` and is below `2^32`; any other value is ignored. Without a usable seed, seed = `Date.now() % 4294967296`. **[decision, Red]** "Every" includes a run started after Quit: with a usable `seed=`, a restarted run of the same kind shows the same `generate(kind, seed)` questions. |

- The page sets `document.body.dataset.ready = "1"` once the bank has loaded (or failed), the
  initial tab has rendered, and, if that tab auto-starts an item session, its first item (or
  `[data-role="empty"]`) has rendered. It sets `document.body.dataset.bankSource` to `"fixture"`,
  `"bank"` or `"none"`.
- Internal links that stay on prep.html (Library practice buttons, mistake clicks) keep `fixture=1`.

### J2. Layout and tabs

- Tab buttons: `button.tab[data-tab="<id>"]`. The active one has `aria-selected="true"`.
- Panels: `section#tab-<id>`. Only the active one is visible.
- **Bank missing** (no bank and no `fixture=1`): `#bank-missing` is visible, and its text includes
  `Bank not built` and `npm run bank:build`. The tab buttons are hidden.

**Item session view.** Each of `#tab-practice` and `#tab-cards` contains one `.session`, and every
part of it is addressed by `data-role`. Selectors below are written for Practice; use
`#tab-cards [data-role=…]` for Cards.

| Selector | Contract |
|---|---|
| `#tab-practice [data-role="item"]` | The current item. Attributes `data-item-id`, `data-item-type` (`numeric` / `mcq` / `free`), `data-area`, and `data-answered` (`"0"` / `"1"`). |
| `[data-role="prompt"]` | The prompt, rendered with markdown and KaTeX. |
| `a[data-role="source"]` | Text = `sourceLabel(item)`; the `href` attribute = `libraryHref(item, root)` (§E5). |
| `[data-role="disputed"]` | Visible iff `check.status === "disputed"`. Its text includes `check.printed` and `check.resolved` (spec §3 F1.4). |
| `input[data-role="answer-input"]` | Numeric items only. Typing updates the preview live. Enter submits. |
| `[data-role="preview"]` | `data-state`: `empty` (blank input), `ok` (text = `"= " + formatPreview(value)`, e.g. `= 0.194444`), or `error` (text = the parse error). |
| `button[data-role="submit"]` | Numeric items only; submits. |
| `button[data-role="choice"][data-index="<i>"]` | mcq items only. Text = `choices[i]`. A click submits that choice. |
| `textarea[data-role="free-input"]` | Free items only: the user's working. |
| `button[data-role="reveal"]` | Free items only: reveals the model answer and the solution. |
| `[data-role="result"]` | `data-state`: `""` (not answered), `correct`, `wrong`, `revealed` (free), or `error` (parse error: the item stays unanswered and no history is written). Text includes `Correct` / `Wrong`. |
| `[data-role="solution"]` | Visible after answering or revealing. Contains the rendered solution, plus the model answer for free items. |
| `[data-role="auto-grade"]` | Auto items, after answering. Text = `gradeLabels(prevCard)[grade]`, e.g. `Good, 1d` or `Again, 10m`. |
| `button[data-role="grade"][data-grade="<grade>"]`, one per grade in `GRADES` | Free items, after reveal only. Text = `gradeLabels(card)[grade]`, e.g. `Good, 6d`. A click writes the grade and advances. |
| `button[data-role="next"]` | Auto items, after answering: advances. |
| `button[data-role="check-reasoning"]` | Visible after answering or revealing. |
| `[data-role="reasoning"]` | The streamed critique. `data-state`: `idle`, `streaming`, `done`, or `error` (e.g. no API key: text includes `API key`). It never changes the grade (spec §3 F1.4). |
| `textarea[data-role="mistake-note"]` and `button[data-role="mistake-note-save"]` | Visible only when the page was opened with `item=<id>&mistake=<ts>` (§J1), i.e. from a Dashboard mistake. Save sets `note` (trimmed, at most 500 characters) on the `prepMistakes` entry matching that `(ts, itemId)`. |
| `button[data-role="end-session"]` | Visible while a session has items left. A click ends the session at once and shows the summary. |
| `[data-role="summary"]` | Shown when the session ends: advancing past the last item (Next for auto items, the grade click for free items) or `end-session`. `[data-role="item"]` is then hidden. Attributes: `data-answered` (history entries written in the session); `data-correct` (their `answerOk` count); `data-accuracy` = `Math.round(100 * correct / answered)`, or `""` if nothing was answered; `data-secs` = the sum of the session's history `secs`; `data-due-tomorrow` = `dueCount(items, cards, localDayStart(now, 2), session areas)` (overdue included **[decision]**, §D9). Contains `[data-role="summary-weakest"]`, whose text is the top 3 topics of `mistakeTopics(the session's new mistakes, items)` joined by `", "`, or `none`. |
| `[data-role="empty"]` | Visible when the queue is empty. |

**[decision, Red]** Details of the item view:

- **Initial states.** `[data-role="result"]` and, for numeric items, `[data-role="preview"]` are
  rendered with the item. Before the first answer the result's `data-state` is `""`, and before
  any input the preview's is `empty`. `[data-role="reasoning"]` may be absent until Check my
  reasoning is clicked; if it is present before the click, its state is `idle`. For all three a
  missing `data-state` attribute counts as the initial state, so tests accept either.
- **Session areas** (in `data-due-tomorrow`): a Practice auto session uses
  `settings.areas ∩ PRACTICE_AREAS` and a Cards session `settings.areas ∩ CARD_AREAS` (the areas
  of its queue). `item=`, `source=` and drill sessions use the distinct areas of the session's
  items. The `item=` scenarios that assert it (v4-2, v4-19) store only the answered item's card,
  so their expected count of 1 is the same under any reading.
- **Mistake note.** Save trims the text and then keeps its first 500 characters
  (`.slice(0, 500)`): a longer note is truncated, never rejected. e2e v4-20 asserts only the length.

**Writes per answer** (also observable in storage):

- An auto item writes a `prepHistory` entry, `prepCards[id] = schedule(prev, grade, ts)` (the
  same `ts`), and a mistake if the grade is `again`.
- A free item writes the history entry and the card on grade-button click.
- Every history write is followed by the practice-log upsert (§H10).
- Drill progress: §H9.

**Sessions [decision]:**

- **Practice tab:** the session starts automatically when the tab is shown and no session is
  active. It is `buildQueue(items, cards, now, { ...settings, areas: settings.areas ∩ PRACTICE_AREAS })`,
  unless `item=` or `source=` is given.
- **Cards tab:** `select#cards-topic` has options `""` (All topics) followed by `topicSet` of the
  cpp and systems items. `button#cards-start` starts
  `buildQueue(items, cards, now, { ...settings, areas: settings.areas ∩ CARD_AREAS }, { topics: value ? [value] : [] })`.
  The tab auto-starts with all topics the first time it is shown.
- **[decision, Red]** Settings saved on the Today tab apply to the next session started on the
  same page, auto-started ones included, because prep.html re-reads `prepSettings` at every
  session start (§I). The `select#cards-topic` options do not depend on `settings.areas`, and they
  are present whenever `#tab-cards` is visible. `button#cards-start` always starts a new session,
  replacing the current one. Starting any session hides the previous `[data-role="summary"]`.

**Keyboard** (spec §3 F1.4):

- `1`–`4` grade again / hard / good / easy, when grade buttons are visible and focus is not in an
  input or textarea.
- `Enter` submits a numeric answer. After an auto result, `Enter` is Next. In the free textarea,
  `Enter` is a newline.
- `Space` reveals a free item when focus is not in a text field.

### J3. Today tab

| Selector | Contract |
|---|---|
| `#today-due` | `data-count` = due-today count (§H7); text `Due today: N`. |
| `#drill-banner` | Visible iff `prepDrill.status === "pending"`. Text = `drillBannerText(drill)`. Re-rendered on every `prepDrill` storage change (§I). **[decision, Red]** `button#drill-start` may sit inside the banner, so tests check that the text INCLUDES `drillBannerText(drill)`. |
| `button#drill-start` | Starts the drill session in the Practice tab view. **[decision, Red]** It makes the Practice tab the active tab (`aria-selected`, `#tab-practice` visible) and runs the drill session there, replacing any active Practice session; no auto-started session runs instead. |
| `input#settings-new-per-day`, `input#settings-review-cap`, `input.settings-area[type=checkbox][value=<area>]`, `button#settings-save` | Save writes normalised `prepSettings`. |

### J4. OA tab

| Selector | Contract |
|---|---|
| `select#oa-kind` | Options `arith`, `eighty`, `seq`, `ev`. |
| `input#oa-neg-marking` (checkbox) | The eighty config. |
| `#oa-config` | The arith config inputs (implementation-defined ids). Defaults are the Zetamac defaults. |
| `button#oa-start` | Starts `generate(kind, seed, config)`. |
| `#oa-timer` | Text = `formatClock(secsLeft)`; `data-secs-left` = `String(secsLeft)` with `secsLeft = Math.max(0, Math.ceil(timeLimitSecs − elapsedSecs))`. |
| `#oa-question` | Text = `q.prompt`; `data-index` = `q.i`. |
| `input#oa-input` | Keeps focus during a run (it is refocused on blur) and is cleared on every advance. arith: auto-advances as soon as `checkNumeric(value, q).correct === true`; there is no submit key. **[decision, Red]** The check runs on every `input` event of the field, so typing and pasting both trigger it (e2e types key by key). eighty, seq, ev: `Enter` submits. An empty Enter is a skip. A parse error shows `#oa-feedback[data-state="error"]` and stays on the question. A wrong answer advances. |
| `button#oa-quit` | Discards the run. Nothing is written. |
| `#oa-results` | `data-score`, `data-total` (from `scoreRun`); visible at the end. |
| `#oa-best` | `data-best` = `personalBest` after saving, or `""`. |
| `#oa-trend` | `data-points` = `trend(...)` joined by `","`. |
| `ul#oa-missed` | Contains one `li.oa-missed` per `answers` entry (§F7) with `correct !== true` (answered wrong, or skipped with an empty Enter), in order. Questions never reached, and the question on screen at time-up, are not listed. Each `li` text includes the prompt and `q.answer.value`. |

- The timer uses `Date.now()` deltas and `setInterval` with a period of at most 250 ms
  **[decision]**, so Playwright's `page.clock` can drive it.
- At the end, the page appends to `oaRuns`, plus the `practiceLog` zetamac entry when
  `zetamacEntry` is not null.

### J5. Market tab

| Selector | Contract |
|---|---|
| `select#mm-scenario` | `dice`, `cards`, `coins`. |
| `button#mm-start` | `createGame(kind, seed)` (bots mixed, the default limits). |
| `#mm-round` | `data-round` (0-based next round), `data-rounds`. |
| `#mm-revealed` | `data-revealed` = `state.revealed` joined by `","`. |
| `input#mm-fair`, `input#mm-bid`, `input#mm-ask` | The quote. `Enter` in any of them submits. |
| `button#mm-submit` | Calls `submitQuote`. |
| `#mm-error` | Visible with the error text when a quote is rejected (e.g. includes `bid` or `width`). The state is unchanged. Hidden again after the next accepted quote. **[decision, Red]** Every rejection re-renders it with THAT rejection's `error`, also when it is already visible (so a width error after a bid error shows the width text). |
| `table#mm-rounds tr.mm-round-row` | One per completed round, with `data-round`. |
| `li.mm-fill` | One per Fill, in fill order. `data-bot`, `data-user-side`, `data-price` (= `String(price)`), `data-rejected` (`"true"` / `"false"`). |
| `#mm-settlement` | Visible after the last round. `data-v`, `data-pnl`, `data-edge`, `data-adverse`, `data-trades`, `data-max-pos`, all as `String(number)`. |
| `#mm-good-quoter` | Text = `goodQuoterLine(state)`. |

At settlement the page appends `runEntry(state, now)` to `mmRuns`.

### J6. Dashboard tab

| Selector | Contract |
|---|---|
| `.area-score[data-area="<AREA_KEY>"]` | `data-score` = an integer or `""`. A child `.value` reads the integer, or `no data` when `null` (spec §8). |
| `#overall-score` | `data-score`, same rule. |
| `.nc-pattern[data-pattern="<pattern>"]` | `data-solved`, `data-total` (from `nc150Progress`). |
| `a#nc150-next` | `href` = `next.url`; text = `next.problem`. Hidden if `next` is null. |
| `.mistake-topic[data-topic]` | In `mistakeTopics` order; `data-count`. Contains `.mistake-entry[data-item-id][data-ts]`, **[decision, Red]** one for every element of that topic's `entries` (all of them, none capped; their order is not contract, so e2e compares the set of `itemId@ts`). A click navigates to `prep.html?tab=practice&item=<id>&mistake=<ts>` (keeping `fixture=1`), which opens the item with the note editor (§J1, §J2). |
| `#checkpoint` | Text `Next checkpoint: ${due} (${daysLeft} days left) — ${label}`, or `Next checkpoint: none`. |
| `#under60` | Text `Under 60: ${list.join(", ")}`, or `Under 60: none`. |
| `.mock-mode[data-mode]` | `data-scores` = that mode's verdict scores, oldest to newest, joined by `","`. **[decision, Red]** A mode with no verdicts is either not rendered or rendered with `data-scores=""`. |

### J7. Library tab

| Selector | Contract |
|---|---|
| `.lib-category[data-folder]` | In index order. |
| `.lib-entry[data-file]` | Contains `a.lib-open` (`href` = `` `${root}library/${encodeURI(file)}` ``, opens in Chrome's PDF viewer), `.lib-count` (text = `sourceCounts(items)[file] ?? 0`), and `button.lib-practice`. |
| `button.lib-practice` | Navigates to `prep.html?tab=practice&source=<encodeURIComponent(file)>`, keeping `fixture=1`. |

### J8. Side panel (`sidepanel.html` / `sidepanel.js`)

| Element | Contract |
|---|---|
| `button#prepBtn` | 📚, in `.header-right`, title `Open Prep`. A click sends `{ type: "AM_OPEN_PREP" }` to the background, which opens or focuses the tab (§J10). |
| `#noaiPrompt` | Hidden by default. **[decision]**: shown only when an `lcSolves` storage change ADDS a solve record (a `(slug, ts)` that was not in `oldValue`; an absent `oldValue` counts as `[]`) whose `noAI` is unknown (`== null`); the newest added record wins. `data-slug` = its slug. Contains `#noaiText` (text `Solved without AI?`), `button#noaiYes` (`Yes`) and `button#noaiNo` (`No`). A click re-reads `lcSolves`, sets `noAI: true` / `false` on the record matching `(slug, ts)`, writes it back, logs `amLog("noai", "set", { slug, noAI })`, and hides the prompt. With no answer the field stays unknown (absent, which is equivalent to `null`, §I; spec §8). The streak logic ignores `noAI`. |
| System prompt | gains the `prepSummaryLine` (+ `drillPromptLine`) as in §H7, and the interview material as in §H6, all read fresh per request (§H7 "Freshness"). |
| Sunday review trigger | gains `prep` (§H8). |
| Interview start/end | unchanged from v3 (no automatic `mock` write, §H10). |
| `LOG_KEYS` | gains `"amLogs_prep"`. |

**Tool `assign_drill`**, added to `TOOLS` (exact schema; the description text is implementation-defined):
**[decision, Red]** "Description text" covers the function's `description` (a non-empty string)
and any optional `description` on a property; everything else is exact, and e2e v4-15 compares
it with the `description` keys removed.

```js
{ type: "function", function: {
    name: "assign_drill",
    description: "...",
    parameters: {
      type: "object",
      properties: {
        area:   { type: "string", enum: ["probability","brainteaser","statistics","finance","cpp","systems"] },
        topics: { type: "array", items: { type: "string" } },
        count:  { type: "integer", minimum: 1, maximum: 50 }
      },
      required: ["area", "count"] } } }
```

`execTool("assign_drill", args)`:

- Calls `PrepReadiness.amDrillEntry(args, Date.now(), prepData ? PrepBank.topicSet(prepData.items) : null)`.
- On error it returns `"error: " + error`.
- Otherwise it writes `prepDrill`, logs `amLog("drill", "assigned", {...})`, and returns
  `` `assigned drill: ${count} ${drillLabel(entry)} items` ``.

### J9. Distraction overlay (`content-distraction.js`)

- A new button `<button class="go prep">Take me to Prep</button>`, placed after the existing
  Zetamac button. The existing `.go:not(.zetamac)` lookup must still find the LeetCode button
  first, or be changed to `.go.leetcode`. **[decision, Red]** "After" means document order: the
  `.go.prep` button follows the Zetamac `.go` button in the DOM. Layout is free.
- A click logs `amLog("distraction", "go-to-prep", { host })` and calls
  `chrome.runtime.sendMessage({ type: "AM_OPEN_PREP" })`. Content scripts cannot use `chrome.tabs`.
- e2e selector: `#am-distraction-overlay .go.prep`.

### J10. Background (`background.js`)

- `onMessage` gains `msg.type === "AM_OPEN_PREP"` **[decision]**: one open-or-focus code path
  for both the side panel and the overlay:
  1. `const url = chrome.runtime.getURL("prep.html")`.
  2. Query all tabs and find one whose `tab.url.startsWith(url)`.
  3. If found: `chrome.tabs.update(id, { active: true })` and
     `chrome.windows.update(tab.windowId, { focused: true })`. Otherwise:
     `chrome.tabs.create({ url })`. The message carries no query, so the opened page never has
     `?fixture=1` (§K2 explains what v4-14 asserts). **[decision, Red]** `tabs.create` gets no
     `windowId`, so Chrome opens the tab in the last-focused window (in e2e, the window that
     holds the panel tab).
  4. `sendResponse({ ok: true, tabId, created })` (return `true` for the async response), and log
     `amLog("prep", "open", { created })`.
- The existing `AM_LOG` branch is unchanged.

### J11. "Check my reasoning" request (prep.html)

- Reads `chrome.storage.local.get("state")` for `apiKey` and `model`. With no key it sets
  `[data-role="reasoning"][data-state="error"]` and makes no request.
- Otherwise it POSTs `https://openrouter.ai/api/v1/chat/completions` with the side panel's headers
  (`Authorization: Bearer <key>`, `Content-Type`, `HTTP-Referer`, `X-Title`) and the body
  `reasoningRequest(item, working, answer, state.model)`.
- It parses the SSE `choices[0].delta.content` the same way as `chatCompletion`, with a 45 s idle
  abort.
- `working` is the free-input text for free items, `""` otherwise. `answer` is the raw numeric
  input or the chosen choice text.

---

## K. e2e contract

### K1. Wiring

- `e2e/v4.js` exports one function: `module.exports = async function runV4(h) { ... }`.
- `e2e/run.js` (locked from `v4-red` on, like `e2e/v4.js`; §M4) calls it after scenario 11 and
  before the debug sweep (scenario 12), inside a `try`/`catch`:
  `try { await require("./v4.js")(helpers); } catch (e) { results.push({ name: "v4 module load", ok: false, ms: 0, error: e.message }); }`.
  A crash in v4 therefore records one failed scenario and the run continues to the sweep and the
  results table.
- `e2e/v4.js` MUST NOT require `prep/*` (or anything else that does not exist at Red) at module
  top level. Each scenario requires what it needs inside its own function, so a missing module
  fails only that scenario.
- **[decision]** `AM_E2E_ONLY=v4` skips scenarios 1–11, but still launches, runs v4 and runs the
  debug sweep. `AM_E2E_ONLY=v3` skips v4.
- v4 scenarios begin with `h.clearReplies()` and `await h.clearStorage()`, and must not depend on
  v3 scenario state.
- **run.js changes** (made by the Red-phase e2e writer, except the version change):
  - `openPanel({ fixedTime, query = "" })` loads `sidepanel.html${query}`.
  - `allLogs()` reads `amLogs_prep` too.
  - The sweep's console filter treats the page label `"prep"` like `"panel"`.
  - `scriptedReply` gains `extraReplies` (below). Its order becomes: (1) if the last message has
    role `tool`, the v3 tool-result reply (so a tool call is answered once and the tool loop
    ends); (2) `extraReplies`, in registration order, first matching `pred` wins; (3) the v3 rules.
  - The v4 call and its `try`/`catch` (above), and `AM_E2E_ONLY`.
  - s11 asserts `perms.version === "4.0.0"`. M0 makes this change in the same commit as the
    manifest bump.

The helper object `h` that run.js passes contains exactly these names:

| Name | What it is |
|---|---|
| `context`, `EXT`, `util`, `ROOT`, `OUT` | as in run.js |
| `scenario(name, fn)`, `assert(cond, msg)`, `Skip` | as in run.js. Name v4 scenarios `"v4-<n> <title>"`. |
| `storage(keys)`, `setStorage(obj)`, `clearStorage()`, `seedState(patch)` | as in run.js |
| `openPanel({ fixedTime, query })` | as above |
| `openPrep(query = "?fixture=1", { fixedTime, install } = {})` | New page with diagnostics label `"prep"`. If `install` (an epoch ms) is set, calls `page.clock.install({ time: install })` before `goto`; if `fixedTime` is set, `page.clock.setFixedTime(fixedTime)`. Then goes to `chrome-extension://${EXT}/prep.html${query}` and waits for `document.body.dataset.ready === "1"`. Returns the page. |
| `waitForLog(pred, ms, what)`, `allLogs()` | as in run.js (with `amLogs_prep` included) |
| `waitForRequest(pred, ms, what)`, `requests`, `lastUser(body)` | as in run.js |
| `chat(panel, text)`, `shot(page, name)` | as in run.js |
| `textReply(text)`, `toolReply(name, args)` | as in run.js |
| `addReply(pred, reply)` | Registers `{ pred, reply }` in `extraReplies` and returns a function that unregisters it. `pred(body)` → boolean. `reply` is an SSE string or `(body) => SSE string`. Consulted in the order given in the run.js changes above (after the tool-result rule, before the v3 rules). |
| `clearReplies()` | Empties `extraReplies`. Every v4 scenario calls it first. |
| `attachDiagnostics(page, label)` | as in run.js |
| `P`, `amTodayKey` | `practice.js` and `shared.js`, as required in run.js |

### K2. Rules for v4 scenarios

- Always use `?fixture=1` for both prep.html and the panel. Never depend on `bank/` existing.
  The one exception is v4-14: 📚 and the overlay open plain `prep.html` (§J10), so v4-14 asserts
  only the number of prep.html tabs and which tab is active/focused, never that page's content.
  **[decision, Red]** "Focused" is observed as the prep tab's `active` flag from
  `chrome.tabs.query` (a per-window flag): `panel.bringToFront()` makes the panel tab, in the same
  window (§J10), active, then the second 📚 click must make the prep tab active again.
  `windows.focused` is not asserted (headless windows do not report focus reliably).
- To know answers, compute them in Node with the same modules, required inside the scenario
  (§K1), e.g. `require("../prep/oa.js").generate("ev", 123)` with `prep.html?fixture=1&seed=123`,
  or `createGame("dice", 7)` for the market.
- **Clock:** use `openPrep(q, { install: T })` and then `page.clock.fastForward(ms)` /
  `page.clock.runFor(ms)` for OA timers. Use `fixedTime` only for date-dependent rendering (e.g. the
  Sunday review panel, as in v3 s9). Never mix the two on one page.
  **[decision, Red]** Date-dependent rendering includes the Dashboard checkpoint (v4-11) and the
  panel's Prep line, whose `due today` count depends on the day (v4-16). v4-16 also sets
  `state.lastCheckin` to that day, so no daily check-in fires.
- Mock OpenRouter only through `addReply`. "Check my reasoning" is matched by
  `lastUser(b).startsWith("[Check my reasoning]")`.
- Every scenario must leave no uncaught page errors (the s12 sweep fails otherwise).

### K3. Required e2e coverage

These scenarios are the minimum. Ids reference §L4.

| # | Milestone | Scenario |
|---|---|---|
| v4-1 | M0 | `prep.html?fixture=1` reaches ready with `data-bank-source="fixture"` and all 7 tabs. Without `fixture`: if `data-bank-source="none"`, `#bank-missing` is visible. |
| v4-2 | M3 | Numeric `FX_NUM_7_36` via `?item=`: preview `= 0.194444` for `7/36`; `0.19` → wrong with a mistake entry and `Again, 10m`; on a fresh load `0.1944` → correct, with a history entry `{ mode: "auto", correct: true }` and a card with `interval: 1`. A parse error (`2 3`) gives `result[data-state=error]` and no history. |
| v4-3 | M3 | mcq `FX_MCQ_COINS`: clicking `data-index="2"` → correct. |
| v4-4 | M3 | Free `FX_FREE_WEIGH`: reveal, labels `Again, 10m / Hard, 1d / Good, 1d / Easy, 1d`; Good writes `{ mode: "self", correct: null, grade: "good" }`. With a seeded card `{ reps: 1, interval: 1, ease: 2.5, due: past }` the Good label is `Good, 6d`. |
| v4-5 | M3 | Disputed `FX_NUM_DISPUTED`: the banner is visible and includes `1/3` and `1/2`. Non-disputed items show no banner. |
| v4-6 | M3 | Check my reasoning with a mocked stream → `data-state="done"` and the text shown; the grade is unchanged. |
| v4-7 | M3 | Cards tab: topic filter `move-semantics` → the first item has that topic. |
| v4-8 | M4 | OA arith with `seed`: answer every question read from `#oa-question` until 120 s are fast-forwarded → `oaRuns` entry with the default config, and a `practiceLog` zetamac entry with note `in-app`. |
| v4-9 | M4 | OA ev with `seed`: answers from Node-side `generate`, some deliberately wrong, some skipped with an empty Enter → `#oa-results[data-score]` equals the number typed correctly; `#oa-missed li.oa-missed` lists exactly the wrong and skipped ones; `#oa-best[data-best]` and `#oa-trend[data-points]` match `personalBest` / `trend` computed in Node from the stored `oaRuns`. |
| v4-10 | M5 | Market dice with `seed=7`, scripted quotes from the §G5 worked example → 6 `li.mm-fill` with the worked example's sides and prices; settlement `data-pnl="-3"`, `data-edge="5"`; `#mm-good-quoter` text equals `goodQuoterLine` computed in Node on the same game; an `mmRuns` entry. Rejected quotes (bid ≥ ask, width 10) show `#mm-error` and leave the round unchanged. |
| v4-11 | M6 | Dashboard with seeded storage: `no data` for null areas, the expected integers for seeded ones, nc150 pattern bars and the next link, mistake grouping order, `#checkpoint`, `#under60`. |
| v4-12 | M6 | Library: entries, counts (including a 0 count), and practice-from-source opens a session of that source's items. |
| v4-13 | M6 | Side panel no-AI prompt: add a solve via `setStorage` while the panel is open → the prompt is shown; Yes → `noAI: true` on that record. |
| v4-14 | M7 | 📚 opens prep.html once; a second click focuses the same tab (only one prep.html page exists). The overlay `.go.prep` opens prep.html. |
| v4-15 | M7 | `assign_drill` via a mocked tool call → `prepDrill` stored → the prep Today banner reads `Buddy drill: 2 conditional items` → doing the drill sets `status: "done"` → the next panel request's system prompt contains `Buddy drill finished: 2/2 conditional items`. **[decision, Red]** It also checks the §J8 schema and return text: the `assign_drill` entry of the captured request's `tools` equals the §J8 schema (`description` keys removed; the function's must be a non-empty string), and the tool-result message is `assigned drill: 2 conditional items`. |
| v4-16 | M7 | The system prompt contains a line matching the regex `PREP_LINE_RE` given below this table. A quantdev interview prompt contains `## Material:` and the prompt of a cpp/systems fixture item. |
| v4-17 | M7 | Sunday review (fixed Sunday clock, seeded `prepHistory`): the trigger contains `Prep week:` and `Score change since last Sunday:`. |
| v4-18 | M3 | Keyboard: on a numeric item, `Enter` in the input submits; on a free item, `Space` (focus outside text fields) reveals, then `3` grades `good` (a history entry with `grade: "good"`). |
| v4-19 | M3 | After a one-item `?item=` session on a probability-area item, `practiceLog` contains exactly one new entry, `{ track: "probability", amount: 1, unit: "problems", note: "prep" }`. |
| v4-20 | M6 | Dashboard mistake: with a seeded `prepMistakes` entry, clicking its `.mistake-entry` opens the item with `textarea[data-role="mistake-note"]`; typing a note and Save sets `note` on the entry with that `(ts, itemId)`. |


`PREP_LINE_RE` (v4-16), as JS source:

```js
/^Prep: overall (\d+|n\/a) · prob (\d+|n\/a) · cpp (\d+|n\/a) · sys (\d+|n\/a) · due today \d+ · weakest: .+$/m
```

---

## L. Fixture bank `tests/fixtures/bank-mini/`

### L1. Files (no PDFs; spec §2, §11)

```
tests/fixtures/bank-mini/README.md                  states the content is synthetic, written for tests
tests/fixtures/bank-mini/bank.json                  practice items (probability, brainteaser, statistics, finance)
tests/fixtures/bank-mini/decks/cpp.json             cpp items
tests/fixtures/bank-mini/decks/systems.json         systems items
tests/fixtures/bank-mini/lists/neetcode150.json     synthetic list, same shape as the real one
tests/fixtures/bank-mini/library/index.json         references files that do NOT exist (no PDFs committed)
```

- **[decision, Red]** These six files must exist; other files under `bank-mini/` are allowed. No
  `*.pdf` (any case) may exist anywhere under `tests/`, and no library entry's `file` may exist
  under `bank-mini/library/`.

### L2. Items: 37 to 44 in total (aim for 40; the per-area minimums below sum to 37)

| Area | Count | Where |
|---|---|---|
| probability | 10 to 12 | bank.json |
| brainteaser | 5 to 7 | bank.json |
| statistics | 4 or 5 | bank.json |
| finance | 4 or 5 | bank.json |
| cpp | 7 to 9 | decks/cpp.json |
| systems | 7 to 9 | decks/systems.json |

**Coverage rules** (checked by `tests/static.test.js`, §N8):

1. Every `(area, type)` pair has at least 1 item.
2. Every `(area, check.status)` pair has at least 1 item.
3. Every `(type, check.status)` pair has at least 1 item.
4. At least 3 probability items have topic `conditional`.
5. At least 2 items have topic `expected-value`, at least one of them outside the probability area.
6. At least 2 cpp items have topic `move-semantics`.
7. Every difficulty from 1 to 5 appears at least once.
8. At least one numeric item has `answer.tol`.
9. At least one item has `origin: "source"`.

**Content and validity rules:**

- `bankValidate({ items: allItems(bank, [cpp, systems]) })` returns `{ ok: true, errors: [] }`.
- Every id is computed with `makeId`.
- All text is original and synthetic, with no copyrighted text. Source keys are `fixture`,
  `fixturecpp`, `fixturesys`, and optionally `fixturestats` / `fixturefin`. Files are
  `fixture-*.pdf`.
- **[decision, Red]**
  - "Files are `fixture-*.pdf`" applies to the file NAME (the last path segment of
    `source.file`): `/^fixture-.+\.pdf$/`.
  - "Aim for 40" is soft: any total from 37 to 44 is valid. The order of items within a file is
    free (§D6: tests rely on ids, never on positions or locators).
  - The spec §10 acceptance thresholds (item totals, no source over 40%, at most 5% disputed,
    every numeric item has a `method`) do NOT apply to the fixture (§E2). The coverage rules above
    force several disputed items, and one source may hold most practice items.
  - The fixture follows the §E2 printed / resolved rule for corrected and disputed items.

### L3. Synthetic list and library

**`lists/neetcode150.json`:**

```
{ "source": "synthetic fixture (not the real list)", "list": "neetcode150", "count": 12,
  "problems": [ 12 entries with order 1..12; patterns "Arrays & Hashing" (4), "Two Pointers" (3),
  "Stack" (3), "Binary Search" (2), in that order ] }
```

Use these slugs in this order:

```
contains-duplicate, valid-anagram, two-sum, group-anagrams,
valid-palindrome, two-sum-ii-input-array-is-sorted, 3sum,
valid-parentheses, min-stack, evaluate-reverse-polish-notation,
binary-search, search-a-2d-matrix
```

`url` = `https://leetcode.com/problems/<slug>/`. `problem`, `difficulty` and `leetcode_id` are free
text or values. (Slugs and titles are facts, not copyrighted text.) **[decision, Red]** Tests
assert only that these three keys are present. The `source` text above is the fixture's value,
but tests assert only that `source` is a non-empty string matching `/synthetic/i`.

**`library/index.json`:** categories `00-user-supplied` (entry `fixture-notes.pdf`), `03-cpp`
(`fixture-cpp.pdf`) and `04-systems-low-latency` (`fixture-systems.pdf`), plus every other file
any fixture item cites, plus one entry `fixture-empty.pdf` that no item cites (count 0).
**[decision, Red]** Entry `file` strings equal the items' `source.file` exactly, with no folder
prefix (§E1). Only the three placements above are fixed: the category of every other entry
(e.g. `fixture-stats.pdf`, `fixture-finance.pdf`, `fixture-empty.pdf`) is free, and categories
with no entries (e.g. `05-coding-lists`) may be left out. Every category used is one of the six
§E1 folders with its §E1 label, in ascending folder order. Exactly one entry has `file` equal to
`"fixture-empty.pdf"`, and no item cites it. Tests assert exactly these rules.

### L4. Named items (fixed content, fixed ids)

The 10 items in **Appendix A** MUST appear byte-for-byte as given there: the same field values; key
order and whitespace are free. **[decision, Red]** "Byte-for-byte" also means no extra fields: a
named item deep-equals its Appendix A block (the §E4 "unknown fields are allowed" rule is for the
validator, not for these ten). Each appears exactly once, in its Appendix A file. Their ids were computed with the §E3 rule. Fixture tests and e2e
scenarios refer to them by these names and ids:

| Name | Id | Area / type / status | Used by |
|---|---|---|---|
| `FX_NUM_7_36` | `fixture-p3-q1-8c8ddb31` | probability / numeric / agreed | v4-2 |
| `FX_NUM_INV_E` | `fixture-p4-q2-dd175c13` | probability / numeric / corrected (answer `1/e`) | `36.79%` checks |
| `FX_MCQ_COINS` | `fixture-p5-q1-0a74e9b8` | probability / mcq / unverified | v4-3 |
| `FX_FREE_WEIGH` | `fixture-p7-q1-b7e30cef` | brainteaser / free / agreed | v4-4 |
| `FX_NUM_DISPUTED` | `fixture-p8-q1-353ff247` | probability / numeric / disputed (printed 1/3, resolved 1/2; topic `conditional`) | v4-5 |
| `FX_NUM_EV` | `fixture-p9-q1-e9f1f9c4` | probability / numeric / agreed (topic `expected-value`) | trader material |
| `FX_CPP_FREE_MOVE` | `fixturecpp-s2-c1-724197d7` | cpp / free / agreed (topic `move-semantics`) | v4-7, quantdev material |
| `FX_CPP_NUM_SIZEOF` | `fixturecpp-s5-c1-6d654661` | cpp / numeric / agreed (answer 12) | |
| `FX_SYS_MCQ_LINE` | `fixturesys-s4-c1-31442a11` | systems / mcq / agreed | |
| `FX_SYS_FREE_FALSESHARING` | `fixturesys-s6-c1-b483ecba` | systems / free / unverified | |

- The other roughly 30 items are free-form, within the L2 rules.
- **How e2e answers an item whose identity it does not control** (queues, drills, sources):
  1. read `data-item-id` from `[data-role="item"]`;
  2. look the item up in the fixture JSON files, read directly with `fs`;
  3. answer it: numeric → type `answer.value`; mcq → click `[data-role="choice"][data-index="<answer.correct>"]`;
     free → reveal, then press a grade.

  E2e tests MUST NOT assume a queue order beyond what §D6 and §D7 define.

---

## M. Tooling contract (M0)

### M1. Phase order and process rules [decision]

1. **Red.** Test writers write `tests/v4-*.test.js`, `tests/static.test.js` (§N8),
   `tests/tooling.test.js` (from this §M; it stays red until M0 and is green from M0 on), the
   fixture bank, `e2e/v4.js`, and the run.js changes of §K1. Then `npm test`: every v4 test and
   `tooling.test.js` fail; the v3 tests and `static.test.js` pass.
2. Commit `v4: red tests (pre-lock)`, tag `v4-red-pre`.
3. **Hold-out.** The hold-out writer writes into `HOLDOUT_DIR` (§M5), then runs
   `AM_REPO=<repo> node --test <its files>` and confirms every file loads (no syntax errors) and
   fails only on missing modules or assertions. No hook exists yet, so this is allowed; after M0,
   rule H1 (§M6) hides the directory from every agent.
4. **M0 (tooling).** M0 is the ONLY milestone allowed to edit `package.json` `scripts`, and it sets
   them to exactly the §M2 table. It also sets the `package.json` and manifest versions to 4.0.0
   and the run.js s11 version assertion. Done when `npm run check` and `tests/tooling.test.js`
   pass and every v4 test is still red (spec §12).
5. **Hook canary**, before the lock, while the hook script and settings can still be fixed: a
   subagent started the same way as the implementers tries to Read `<HOLDOUT_DIR>/canary.txt`
   (the hook runs before the tool, so the file need not exist). Rule H1 is active from M0, so the
   attempt MUST be denied. If it is not, the hook is not loaded for subagents: stop and fix the
   setup (BUILD-NOTES §3) before locking.
6. **Lock:** `npm run lock:write` (it refuses unless the §M4 pre-lock conditions hold, so M0 cannot
   quietly change tests), commit `v4: red tests`, tag `v4-red`. From here on `tooling.test.js`
   enforces the §M2 table, and every lockable file (§M4) is final except through disputes.
7. M1…M8. M3 also writes the §H1 and §H10 helpers of `prep/readiness.js`, which the Practice tab
   needs; M6 completes that module.

**Process rules:**

- Implementers never commit. The orchestrator commits only after a green gatekeeper run
  (`npm run check`, `npm test`). The judge commits only `v4: amend test (dispute <ids>)`. So HEAD
  is always a verified state, which `lock:verify` and `lock:restore` rely on (§M4).
- Agents work only in the main checkout. Paths in other worktrees are not protected by the hook.
- The gatekeeper's revert path is `npm run lock:restore` (§M4), which replaces the spec's
  `git checkout v4-red -- <file>`.

### M2. `package.json` scripts (exact)

| Script | Command | Behaviour |
|---|---|---|
| `test` | `node --test tests/*.test.js` | Unchanged glob. It picks up the v3, `v4-*`, `static` and `tooling` tests. |
| `check` | `node scripts/check.js` | (1) `node --check` on every `*.js` in the root, `prep/`, `scripts/`, `e2e/`, `tests/` (top level) and `bank-build/` (recursive, excluding `.cache/` and `sim/items/`); (2) `JSON.parse` of `manifest.json` and `package.json`; (3) the `check:no-bank` logic; (4) the `lock:verify` logic. Stops at the first failure with exit 1; prints `check-ok` on success (v3 printed `syntax-ok`) **[decision]**. |
| `check:no-bank` | `node scripts/check-no-bank.js` | M3 below. |
| `lock:write` | `node scripts/lock.js write` | M4 below. Extra args after `--`. |
| `lock:verify` | `node scripts/lock.js verify` | M4. |
| `lock:restore` | `node scripts/lock.js restore` | M4. |
| `test:holdout` | `node scripts/test-holdout.js` | M5. |
| `test:coverage` | `node --test --experimental-test-coverage '--test-coverage-include=prep/*.js' --test-coverage-lines=90 tests/*.test.js` | Fails if line coverage of `prep/*.js` is below 90% (spec §11). Checked on Node 24. |
| `bank:build` | `node bank-build/build.js` | M7. |
| `e2e` | `node e2e/run.js` | Unchanged. |

Scripts in `scripts/` export pure functions and run their CLI only when `require.main === module`,
so `tests/tooling.test.js` can test them.

### M3. `check:no-bank` (spec §2)

- `noBankViolations(files)` (exported). `files` = `[{ path, size }]`, where `path` is POSIX and
  relative to the repo and `size` is bytes or `null`.
- It returns `[{ path, rule }]`, one entry per violated rule, where `rule` is one of:
  - `"bank"`: the path starts with `bank/`;
  - `"pdf"`: `/\.pdf$/i`, anywhere;
  - `"cache"`: under `bank-build/.cache/` or `bank-build/sim/items/`;
  - `"size"`: `size > 1048576` and the path is not under `vendor/` or `tests/fixtures/`.
- Order: paths in input order; for one path, rules in the order `bank`, `pdf`, `cache`, `size`.
  So `bank/x.pdf` gives two entries, `bank` then `pdf`. No violations → `[]`.
- **[decision, Red]** The prefixes (`bank/`, `bank-build/.cache/`, `bank-build/sim/items/`,
  `vendor/`, `tests/fixtures/`) are case-sensitive prefixes of the POSIX path as `git ls-files`
  prints it; only the `pdf` rule ignores case. So `vendor-old/x` is not under `vendor/`. Tests use
  lower-case prefixes only.
- The CLI feeds it `git ls-files -z`, with sizes from `fs.statSync` (`null` if the file is missing
  from the working tree). It exits 1 and lists the violations, or prints `no-bank-ok`.

### M4. Lock (`scripts/lock.js`; spec §11)

**`tests/LOCK.json`:**

```json
{
  "version": 1,
  "algorithm": "sha256",
  "created": "<ISO 8601>",
  "files": {
    "e2e/v4.js": { "sha256": "<hex>" },
    "tests/v4-srs.test.js": { "sha256": "<hex>", "disputes": ["D3"] }
  }
}
```

- Keys are POSIX paths relative to the repo, sorted.
- `disputes` appears only on amended files, and dispute ids are appended over time.

**Lockable files [decision: extends spec §11]**, from `lockableFiles(root)` (exported), which
returns their POSIX paths relative to `root`, sorted (`<` order):

- every regular file under `tests/`, recursively (fixtures included), except `tests/LOCK.json` and
  any `.DS_Store` (spec §11);
- `e2e/v4.js` (spec §11);
- every regular file under `scripts/`, recursively, except `.DS_Store`; `e2e/run.js`; and
  `package.json`. These are the lock, hook, check and hold-out scripts, the e2e harness, and the
  npm scripts. They enforce the lock, so they must not change after it; all of them are final once
  M0 is done.

The **lockable roots** are `tests`, `scripts`, `e2e/v4.js`, `e2e/run.js` and `package.json`.
Hashes are sha256 of the raw bytes. The root defaults to the repo root; the env var `AM_LOCK_ROOT`
overrides it, for tooling tests in temp dirs.

**[decision, Red]** Everything is relative to the lock root (`AM_LOCK_ROOT`, else the repo root);
the process cwd and the script's `__dirname` play no other part:

- `TEST-DISPUTES.md` is the working-tree file `<lock root>/TEST-DISPUTES.md`; a missing file means
  there are no disputes. The staging dir is `<lock root>/.test-staging/`.
- Every git command runs with cwd = the lock root. "Inside a git work tree" means
  `git rev-parse --is-inside-work-tree` run there prints `true`; the lock root is then expected to
  be the work tree's top level. (Tests set cwd and `AM_LOCK_ROOT` to the same temp dir, with
  `GIT_CEILING_DIRECTORIES` set to its parent.)
- Notices (no git work tree) have implementation-defined text; tests assert only that some
  output is printed besides the fixed lines below.

**Other exports:**

- `hashFile(path)` → 64 lowercase hex characters;
- `compareLock(lock, current)` → `{ missing, changed, extra }`, where `lock` is the parsed
  LOCK.json (its `files` map is read) and `current` is `{ [path]: sha256 }`. `missing` = keys only
  in `lock`, `changed` = keys in both with different hashes, `extra` = keys only in `current`.
  Each is a sorted (`<` order) array of paths;
- `parseDisputes(markdown)` → `[{ id, ruling, files }]`, in document order. Each `## D<n>: …`
  heading starts an entry, `id` = `"D<n>"`. `ruling` = the `Ruling:` value, trimmed and lowercased,
  or `"pending"` if the line is missing. `files` = the `File:` value split on `,`, each part
  trimmed, empty parts dropped (`[]` if the line is missing).

**`TEST-DISPUTES.md` entry format** (parsed by `parseDisputes`; ids are `D<n>`):

```
## D3: <short title>
- Test: <test name>
- File: tests/v4-srs.test.js[, other/file]
- Spec: §3 F1.3
- Why: ...
- Proposed fix: ...
- Ruling: pending | uphold | amend
- Judge note: ...
```

The `File:` line lists paths separated by commas. A missing `Ruling:` line counts as `pending`.
Keys are case-insensitive.

**Commands:**

- **`lock:write`** (no args):
  - Refuses (exit 1) if `tests/LOCK.json` already exists.
  - Inside a git work tree, refuses (exit 1) unless ALL of these hold:
    - tag `v4-red-pre` exists;
    - `git diff --name-only v4-red-pre -- tests e2e/v4.js` (working tree against the tag, so
      committed and uncommitted changes alike) is empty;
    - `git ls-files --others --exclude-standard -- tests e2e/v4.js` (untracked files) is empty.
  - Outside a git work tree (tooling tests on a temp dir via `AM_LOCK_ROOT`), it prints a notice
    and skips those checks.
  - Otherwise writes LOCK.json for all lockable files.
  - It never commits. The orchestrator commits `v4: red tests` and tags `v4-red`.
- **`lock:write -- --dispute <id[,id]>`** (the judge path):
  - The judge cannot edit `tests/**` because of the hook, so it writes each amended file to
    `.test-staging/<id>/<relpath>` (e.g. `.test-staging/D3/tests/v4-srs.test.js`).
  - For each id, the script requires that LOCK.json exists, that `TEST-DISPUTES.md` has that id
    with `Ruling: amend`, that at least one staged file exists, and that every staged file is in
    the dispute's `File:` list and is lockable.
  - It then copies the staged files into place, recomputes their hashes, appends the id to their
    `disputes`, writes LOCK.json, and deletes `.test-staging/<id>/`.
  - Any failed check → exit 1 and nothing changes.
  - **[decision, Red]** CLI form: `node scripts/lock.js write --dispute <ids>`, where `--dispute`
    and the id list (`D3` or `D6,D7`, no spaces) are two separate argv items; this is what
    `npm run lock:write -- --dispute D3` passes. Whether `--dispute=<ids>` also works is
    implementation-defined.
  - **[decision, Red]** A dispute changes locked files but never adds one: every staged file must
    already be a key of LOCK.json, else exit 1 and nothing changes (a new key would fail
    `lock:verify` (d) for good).
  - **[decision, Red]** Only the staged files are copied and rehashed. Every other LOCK entry is
    written back unchanged, so an out-of-band edit to another lockable file is never laundered
    into LOCK.json and still fails `lock:verify`. The checks above are the required refusals; an
    implementation MAY also refuse (exit 1, nothing changes) while a non-staged lockable file
    differs from its LOCK hash.
  - The judge then commits exactly the amended files plus `tests/LOCK.json`, with the subject
    `v4: amend test (dispute <ids>)`, where `<ids>` is the same comma-separated list (e.g. `D3` or
    `D3,D4`).
- **`lock:verify`:**
  1. No `tests/LOCK.json` → print `lock:verify: no tests/LOCK.json yet (pre-lock), skipping` and exit 0.
  2. Compare hashes: `compareLock(LOCK, hashes of lockableFiles(root))`. Any missing, changed or
     extra file → exit 1, listing them. "Extra" covers new tracked, untracked and ignored files
     under `tests/` and `scripts/`.
  3. **Git checks [decision]** (how "changed through the dispute log", spec §11, is checked),
     inside a git work tree only (outside one, print a notice and skip). Any failure → exit 1 with
     the reason:
     - (a) tag `v4-red` exists and the commit it points to has the subject `v4: red tests`;
     - (b) `git status --porcelain --untracked-files=all -- <lockable roots>` is empty: no
       uncommitted change to any lockable file;
     - (c) every commit listed by `git log --format=%H%x09%s v4-red..HEAD -- <lockable roots>` has a
       subject matching `/^v4: amend test \(dispute (D\d+(?:,D\d+)*)\)$/`; each of its ids has
       `Ruling: amend` in `TEST-DISPUTES.md`; and every path it touched under the lockable roots
       (`git diff-tree --no-commit-id --name-only -r <sha> -- <lockable roots>`), other than
       `tests/LOCK.json`, is in the union of those disputes' `File:` lists;
     - (d) LOCK.json has the same set of keys as `git show v4-red:tests/LOCK.json`, and every key
       not touched by a commit in (c) has the same sha256 as there.
     - **[decision, Red]** A revert does not repair a non-amend commit: (c) lists every commit
       since `v4-red`, so the stray commit and the commit that reverts it both fail. This is
       intended, because HEAD is always a verified state (§M1); the recovery path is in
       BUILD-NOTES §3.
  4. Print `amended: <path> (<ids>)` for each LOCK entry that has `disputes`, then
     `lock:verify: <N> files OK`.

  **[decision, Red]** Output rules. The step 1 message, the `amended:` lines and the OK line are
  status lines, not error messages (§N2 is about errors), so their formats are contract:
  - tests may assert the keyword `pre-lock` in the step 1 message;
  - one `amended: <path> (<ids>)` line per LOCK entry with a non-empty `disputes`, where `<ids>`
    lists those disputes in order. The separator (`,` or `, `) is implementation-defined, so tests
    match a one-id line whole (`amended: tests/a.test.js (D3)`) and check only the order of several
    ids;
  - `N` is the number of entries in LOCK.json `files`; tests match `/\b<N> files OK\b/i`.
  The `amended:` lines and the OK line go to stdout, the `amended:` lines first. The no-git notice
  may go to either stream and may share a line with them. Failure reasons go to either stream.
  Tests read stdout and stderr together and assert neither the stream nor the order.
- **`lock:restore`** (no arguments) **[decision]**, the gatekeeper revert path. It replaces the
  spec's `git checkout v4-red -- <file>`, which the hook blocks, which would undo legitimate amends,
  and which cannot remove an added file:
  - Outside a git work tree → exit 1.
  - Runs `git checkout HEAD -- <lockable roots>` from node (so no hook rule applies), restoring
    every modified or deleted tracked lockable file, `tests/LOCK.json` included.
    **[decision, Red]** Only the roots that exist at HEAD are passed (e.g. as listed by
    `git ls-tree --name-only HEAD -- <lockable roots>`), so a root that HEAD does not track cannot
    make the whole checkout fail on an unmatched pathspec. Tests always track every root.
  - Deletes every file under `tests/` and `scripts/` that is not tracked at HEAD
    (`git ls-files --others -- tests scripts`, ignored files included), except `.DS_Store`.
  - Then runs the `lock:verify` logic and exits with its code.
  - This is correct because HEAD is always a verified state (§M1 process rules).

### M5. `test:holdout`

- `HOLDOUT_DIR` defaults to `$HOME/Documents/Quant Prep/holdout-tests` **[decision]**. If it does
  not exist, exit 1.
- The script runs `node --test --test-reporter=./scripts/holdout-reporter.js <every *.test.js under HOLDOUT_DIR, recursively, sorted>`
  with `cwd` = the repo root and env `AM_REPO=<absolute repo root>`.
- Hold-out tests require modules by absolute path, e.g.
  `require(require("path").join(process.env.AM_REPO, "prep/answer.js"))`. The fixture bank is at
  `path.join(process.env.AM_REPO, "tests/fixtures/bank-mini")`.
- **[decision]** The reporter prints only `ok <test name>` / `not ok <test name>` lines and the
  totals. Assertion details, values and source are hidden from implementers. There is no verbose
  mode.
- **[decision, Red]** Output format, exactly:
  - one line per test, `ok <test name>` or `not ok <test name>` (whitespace around it allowed);
  - at least one totals line that does not start with `ok` / `not ok` and gives the counts as
    digits. Its format (e.g. `tests 4, pass 3, fail 1`) is implementation-defined;
  - whether suites (`describe`) and file-level entries (e.g. a file that fails to load) get their
    own line is implementation-defined;
  - the lines may go to stdout or stderr; tests read both;
  - the reporter writes nothing else, on either stream: no assertion message, actual or expected
    value, thrown error text, stack or source text, and none of the tests' own stdout / stderr
    output.
- **[decision, Red]** `$HOME` / `~` means `os.homedir()` (which is `$HOME` on POSIX when it is set).
  Tests set `HOME` to a temp dir to check the default.
- **[decision, Red]** The child gets the script's own environment plus `AM_REPO`. The script
  neither reads nor removes `NODE_TEST*` variables (spec §11 forbids detecting a test
  environment). It is meant to be run from a shell: started from inside a `node --test` process,
  the inherited `NODE_TEST_CONTEXT` makes the nested `node --test` ignore the custom reporter, so
  the tooling tests remove every `NODE_TEST*` variable from the child's environment instead.
- The exit code is node's.
- **Hold-out disputes [decision].** No agent can read a hold-out file after M0 (rule H1), so the
  judge cannot rule on one. An implementer who believes a hold-out test contradicts the spec or
  this file appends a dispute to `TEST-DISPUTES.md` in the usual format, with `File: holdout` and
  `Test:` set to the name the reporter printed, and moves on. The USER rules on it; on `amend` the
  user edits the hold-out file outside Claude Code. Hold-out files are not lockable, so this needs
  no lock change.

### M6. Claude Code hook

**Files:**

- `.claude/settings.json` is local and gitignored (`.claude/` is already in `.gitignore`).
- The hook script, `scripts/guard-locked.js`, is committed.

```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "Edit|Write|MultiEdit|NotebookEdit|Bash|Read|Grep|Glob",
        "hooks": [ { "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/scripts/guard-locked.js\"" } ] }
    ]
  }
}
```

**CLI behaviour:**

- Reads the hook JSON from stdin (`{ tool_name, tool_input, ... }`).
- Deny: print the reason to stderr and exit 2 (this blocks the tool).
- Allow: exit 0 with no output.
- Unparseable stdin → deny (fail closed) **[decision]**.
- The repo root comes from `AM_GUARD_ROOT`, then `CLAUDE_PROJECT_DIR`, then `path.resolve(__dirname, "..")`.
- The hold-out dir comes from `HOLDOUT_DIR`, else `~/Documents/Quant Prep/holdout-tests`.
- `locked` = `tests/LOCK.json` exists under the root.

**`guardDecision(input, { root, holdout, locked, home })`** (exported, pure) returns
`{ deny: false }` or `{ deny: true, reason }`.

- **Paths:**
  - `tool_input.file_path` (Read, Edit, Write, MultiEdit);
  - `tool_input.notebook_path` (NotebookEdit);
  - `tool_input.path` (Grep, Glob; default root);
  - `tool_input.pattern` / `glob` (Grep, Glob; scanned as text).

  Each is resolved against the root, with `~` expanded to `home`.
  **[decision, Red]** `guardDecision` is pure: no file system access (no `realpath`, no symlink
  resolution, no existence check). "Resolved" means `path.posix.resolve(root, p)` after a leading
  `~` (alone, or followed by `/`) is replaced by `home`; no other `~` form is expanded.
  "Inside a directory D" means equal to D or below it, by whole path segments: `<root>/tests` and
  `<root>/tests/a.js` are inside `<root>/tests/`, and `<root>/tests-old/a.js` is not. The same
  holds for the hold-out dir. The CLI passes `home = os.homedir()`, and its default hold-out dir is
  `path.join(os.homedir(), "Documents", "Quant Prep", "holdout-tests")`.
- **Case [decision]:** every path comparison and every regex below is case-insensitive, on every
  platform. macOS APFS is case-insensitive by default, so `Tests/x` is `tests/x` there; a false
  positive on a case-sensitive file system is harmless. **[decision, Red]** That includes the
  two allowlist regexes, which carry the `i` flag below (Draft 2 left it off). Tests use only
  lower-case npm commands.

**Rules, in order:**

| # | When | Rule |
|---|---|---|
| H1 | always (spec §11: hold-out never visible) | Read, Edit, Write, MultiEdit or NotebookEdit on a path inside `holdout` → deny. Grep or Glob whose path is inside `holdout`, or whose pattern or glob contains `holdout-tests` → deny. **[decision, Red]** Grep or Glob whose path is an ANCESTOR of `holdout` (e.g. `~/Documents/Quant Prep`, `~`, `..` or `/`) → deny too, because it would search the hold-out dir. **[decision]**: H1 and H2 apply as soon as the hook is installed (M0), not only once `tests/LOCK.json` exists, and denying Read, Grep and Glob extends spec §11, which names only edits, so that "implementers never see it" is enforced. |
| H2 | always | Bash whose command contains `holdout-tests`, `Quant Prep/holdout` or the absolute holdout path → deny, unless the whole command matches `HOLDOUT_ALLOW_RE` (code block below). |
| A | locked | Bash commands matching `NPM_ALLOW_RE` (code block below) are never denied by rule L2. |
| L1 | locked | Edit, Write, MultiEdit or NotebookEdit on a path inside `<root>/tests/`, `<root>/scripts/` or `<root>/.claude/`, or equal to `<root>/e2e/v4.js`, `<root>/e2e/run.js` or `<root>/package.json` → deny. This is spec §11's list plus the §M4 lockable set and the hook's own settings directory **[decision]**. |
| L2 | locked | Bash that may write to a locked path, as defined below the table → deny (spec §11). |

The two allowlist regexes, as JS source (anchored to the whole command; commands chained with
`&&`, `;` or `|` never match them and go through the normal rules):

```js
const HOLDOUT_ALLOW_RE = /^\s*(HOLDOUT_DIR=("[^"]*"|'[^']*'|\S+)\s+)?npm run test:holdout\s*$/i;
const NPM_ALLOW_RE = /^\s*(HOLDOUT_DIR=("[^"]*"|'[^']*'|\S+)\s+)?npm (test|run (check|check:no-bank|lock:verify|lock:write( -- --dispute [A-Za-z0-9,]+)?|lock:restore|test:coverage|test:holdout|e2e|bank:build( -- [\w -]+)?))\s*$/i;
```

- **Mentions a locked path:** the command matches `MENTION_RE`, or contains `<root>/` followed by
  one of `tests`, `scripts`, `.claude`, `e2e/v4.js`, `e2e/run.js`, `package.json`.
- **L2 denies** when the command, after removing every `\d*>&\d+`, `&>\s*/dev/null` and
  `\d*>\s*/dev/null`, mentions a locked path AND either still contains `>` or matches
  `WRITE_VERB_RE` (spec §11 lists `>` as a write verb).
  - So `npm test > /tmp/o 2>&1` is allowed (it mentions no locked path), and
    `node --test tests/ > /tmp/o` is denied.
  - Any remaining `>` counts, including `=>` or `->` inside a quoted argument. Use the Read and
    Grep tools for such searches.
  - The verb list extends the spec's examples (`>`, `tee`, `sed -i`, `mv`, `cp`, `rm`,
    `git checkout`) with other writers, inline and stdin scripts (`node -e`, `python3 -c`,
    `node -`, heredocs) and editors **[decision]**.

```js
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
```

- Examples the tooling tests must cover. Denied: `cd tests && echo x > a.test.js`,
  `(cd tests && cat /tmp/new > v4-srs.test.js)`, `cd e2e && cat /tmp/x > v4.js`,
  `python3 - <<'EOF' … open('tests/x','w') … EOF`, `node --input-type=commonjs -e "…writeFileSync('tests/a.js','')"`,
  `ex -sc wq tests/a.js`, `echo x > Tests/v4-x.test.js`, `sed -i '' 's/x/y/' scripts/lock.js`,
  `git checkout v4-red -- tests/v4-srs.test.js`. Allowed: `npm test > /tmp/o 2>&1`,
  `npm run lock:restore`, `node --test tests/v4-srs.test.js 2>&1 | tail -20`,
  `grep -rn seqFit tests/`, `git show v4-red:tests/LOCK.json`, `node scripts/lock.js verify`,
  `git add tests/LOCK.json tests/v4-srs.test.js && git commit -m 'v4: amend test (dispute D3)'`.
- Read, Grep and Glob of `tests/**` are allowed. Implementers may read the tests.
- **[decision, Red]** Known limit, not tested either way: H1 and H2 match text, so a Bash command
  that reaches the hold-out dir through shell globs or variables without spelling any H2 string
  (e.g. `cat ~/Documents/Quant*/hold*/*`), or a Glob whose pattern is an absolute path with
  wildcards in its directory part, is not caught. BUILD-NOTES §3 records this trade-off.
- The judge and gatekeeper bypass only through `lock:write --dispute` and `lock:restore`, which
  write with node `fs` inside an allowlisted npm command.

### M7. `bank:build` (spec §10; not unit-tested)

**CLI:** `node bank-build/build.js [step] [source]`, with steps `ocr`, `extract`, `resolve`, `sim`,
`decks`, `assemble`, `report`, or `all` (the default, in that order).

**Dependencies:** Node built-ins, the Python 3 standard library and CLI tools (`ocrmypdf`,
`pdftotext`, …) only. `package.json` is locked after M0 (§M4), so the pipeline cannot add npm
dependencies.

**Cache layout** (all gitignored):

| Path | Contents |
|---|---|
| `.cache/greenbook-ocr.pdf` | the OCR'd Green Book |
| `.cache/extract/<key>.json` | an array of items with `check.status: "unverified"`, written by extraction agents |
| `.cache/resolve/<key>.json` | `{ [id]: { status, printed?, resolved?, method, note? } }`, from solver and judge agents |
| `.cache/sim/<id>.json` | `{ id, ok, method, estimate, se?, expected }`, where `method` is `"enum"` or `"mc"` |
| `.cache/decks/<deck>.json` | deck cards |

**Committed:**

- `bank-build/sources.json`: `[{ key, title, folder, file, manifestSlug, area, priority }]`, with no
  copyrighted text.
- The pipeline scripts.

The generated `bank-build/sim/items/*.py` are gitignored.

**`assemble`:**

- Writes the E1 files.
- Writes items in source priority order, then page order (this is the "source order" of §D6).
- Runs `bankValidate` on the merged set and exits 1 on any error.

**`report`** writes `bank/REPORT.md`, including the §10 acceptance checks (counts, source share,
disputed percentage, `method` on every numeric item).

### M8. `.gitignore` additions

`bank/`, `bank-build/.cache/`, `bank-build/sim/items/`, `.test-staging/`. (`.claude/`,
`node_modules/` and `e2e/out/` are already present.)

**[decision, Red]** Each entry is its own line. A leading `/` and the trailing `/` are optional
(`/bank/`, `bank/` and `bank` all count), surrounding whitespace is ignored, and so are comment
lines.

### M9. Manifest (spec §2)

- `"version": "4.0.0"`. The `package.json` `version` is also `4.0.0`.
- Add `"unlimitedStorage"` to `permissions`.
- No other permission or host changes. **[decision, Red]** The permission and host keys are
  `permissions`, `host_permissions`, `optional_permissions`, `optional_host_permissions` and
  `content_scripts[].matches`. The tooling tests check that `permissions` is the v3 set plus
  `unlimitedStorage` with no duplicates, that `host_permissions` is the v3 set, and that the two
  optional keys are absent or empty. `content_scripts` is left to code review.
- `prep.html` needs no manifest key: it is an extension page served at
  `chrome-extension://<id>/prep.html` and same-origin with `bank/library/*` **[decision]**.

### M10. Tooling self-tests

`tests/tooling.test.js`, NOT prefixed `v4-` because it must pass at lock time (after M0). It is
written in the Red phase from this §M, before tag `v4-red-pre`; it is red until M0 and green from
M0 on (§M1). It covers:

- the script names and exact commands in M2 (after the lock this is what keeps `package.json`
  `scripts` fixed);
- the manifest and the `package.json` version (M9);
- the `.gitignore` entries (M8);
- `noBankViolations`, including its output order;
- `lockableFiles`, `hashFile`, `compareLock`, `parseDisputes`, and the `lock.js` CLI against a
  temp dir via `AM_LOCK_ROOT` (no git present → notices, git checks skipped);
- **[decision, Red]** the `lock.js` git checks (`lock:write`'s pre-lock conditions, `lock:verify`
  (a)–(d), the judge path and `lock:restore`) in throwaway `git init` repos inside temp dirs, with
  `GIT_CEILING_DIRECTORIES` set to the temp dir's parent, an empty `GIT_CONFIG_GLOBAL` and
  `GIT_CONFIG_NOSYSTEM=1`, so no git command touches the real repo or the user's git config;
- **[decision, Red]** the `test:holdout` CLI against temp `HOLDOUT_DIR` / `HOME` dirs;
- `guardDecision` for every rule H1–L2, including the allowlists, the `2>&1` exemption, case
  insensitivity and the §M6 example commands, and the hook CLI (exit codes, stdin, root and
  `locked` detection). The CLI's default hold-out test only asks for a decision about the real
  `os.homedir()` path string; nothing reads it.

**[decision, Red]** Not run by the tooling tests: the `check:no-bank` CLI and `scripts/check.js`,
whose output depends on the repo's current files. They are covered by M0's done criterion
(`npm run check` passes), the exact `package.json` commands and the `require.main` guard test.

---

## N. Test-writer guidance

1. **Test the contract, not the implementation.** Use only exports listed here, the DOM selectors
   in §J, and the storage shapes in §I. Never reach into private helpers, closure state or the
   order of internal calls.
2. **No exact error strings.** Assert that the error exists, plus the listed keyword at most (§A4).
3. **Deterministic clocks.** Pass `now` / `ts` explicitly. Build dates with
   `new Date(y, m, d, h, …)`. Never call `Date.now()` in an assertion's expected value.
4. **Independent oracles.**
   - EV templates (§F5): write your own enumeration or DP in the test file, from the template
     definitions, for 20 seeds or more.
   - `conditionalEV` (§G4): enumerate the unrevealed units by brute force (for cards, all ordered
     draws of the remaining units from the remaining deck) for small `n − m` (3 or less).
   - Sequences: write your OWN fit/next for all 8 families from the §F4 table. Assert that the
     module's `seqFit` / `seqNext` agree with yours on every generated `q.shown` and on hand-made
     sequences, including ones that fit no family. Check the uniqueness property with YOUR fits,
     so a `seqFit` that wrongly returns `null` cannot pass it vacuously.
   - Do not import a module's own helper to compute the expected value of that same helper.
5. **RNG reproduction is only allowed where this file fixes the draws:** `mulberry32` (B1), the
   helpers (B2), `arith` generation (F2), and market creation plus noise draws (G1, G3). For
   eighty, seq and ev, assert determinism, ranges and properties, never exact sequences.
6. **Floating point.** Compare with tolerance (`1e-9` relative, unless stated otherwise). Exact
   equality only for integers, values that are exact in binary (dice and coin EVs, the worked
   market example), and strings.
   - **Rounding boundaries.** Area-score tests (§H3) MUST NOT use inputs whose raw value lies within
     `1e-9` of `x.5`: the float order of operations (e.g. `30 * min(1, 1200 / m)` vs `36000 / m`)
     is not contract.
   - **Unknown `noAI`:** assert `s.noAI == null` (loose equality), never `=== null` or
     `=== undefined` (§I).
   - **[decision, Red] Signed zero.** `-0` and `+0` are the same result. A value that a literal
     implementation can return as `-0` (a negated or empty sum, such as `adverse` with no informed
     fills) is compared with `===` or a tolerance, never with `assert.equal` / `deepEqual` from
     `node:assert/strict` (which use `Object.is`).
7. **Error counts.** For `bankValidate`, assert `ok`, `errors.length === 0` for valid input, and
   `errors.some(e => e.id === … && e.field === …)` for invalid input. Never assert the number of
   errors for an invalid item. **[decision, Red]** Two exceptions, because §E4 states the count
   exactly: the number of `duplicate` id errors (one per later duplicate), and the single
   `{ id: null, field: "items" }` error for a bank that is not an object with an `items` array.
8. **Red phase.** EVERY test in `tests/v4-*.test.js` must fail at Red, on assertions or missing
   modules, with no syntax errors (spec §11). v3 tests stay green. Requiring a missing module at
   the top of the file is fine (the whole file fails red). **[decision]** A check that already
   holds at Red does not go in a `v4-*` file: it goes in `tests/static.test.js`, which is not
   v4-prefixed, passes at Red, needs no prep module, and is locked like every file under `tests/`.
   Such checks are: the fixture's file layout, JSON shape, the §L2 counts and coverage rules,
   that the §L4 named items are present with their Appendix A content, and that no PDF exists
   under `tests/`; and the v3 regression that `amWeeklyReviewTrigger` without `prep` is
   byte-identical to v3 (§H8).
   **[decision, Red]** "JSON shape" covers the §E1 file shapes, the §E2 per-item schema, id
   uniqueness and the §L2 content rules (fixture source keys, `fixture-*.pdf` file names). The
   static per-item check restates only rules that `bankValidate` (§E4) already implies, so it can
   never reject a fixture that `bankValidate` accepts; checks that need `parseAnswer`, `makeId`
   or `hash8` stay in `v4-fixture`.
9. **Suggested files:** `tests/v4-rng.test.js`, `v4-answer`, `v4-srs`, `v4-bank`, `v4-oa`,
   `v4-market`, `v4-readiness`, `v4-practice` (the `amWeeklyReviewTrigger` `prep` field, WITH a
   `prep` value), `v4-fixture` (only checks that call `PrepBank`: the fixture passes
   `bankValidate`, and every id, including the §L4 ids, equals `makeId` of its content),
   `static.test.js` (item 8) and `tooling.test.js` (§M10).
   **[decision, Red]** A `v4-fixture` test may also contain an assertion that holds at Red (e.g.
   an independent `node:crypto` hash of an id, or the library listing every cited file), as long
   as the SAME test also exercises a `PrepBank` export, so the test stays red at Red. Overlap with
   `static.test.js` is allowed when both files expect the same thing.
   **[decision, Red]** The same holds in every `v4-*` file: a test may include an assertion that
   already holds at Red (e.g. the v3 `amNextCheckpoint` half of the spec §8 checkpoint test, or the
   v3 text for `prep: ""` in `v4-practice`) when the SAME test also needs a v4 export or v4
   behaviour, so the test as a whole stays red.
   **[decision, Red]** Two behaviour-based checks every `prep/*` test file may use:
   - **Module shape (§A5):** run the file as a classic script in a fresh
     `vm.createContext({...})` with no `require` and no `module`, after running its §A5
     dependencies in the same context (and with `TextEncoder` supplied for `bank.js`, §E3). Assert
     that the only new key of the context is the namespace name, then run the file a second time
     in the same context and assert it does not throw (this rules out top-level `const`, `let` and
     `class`). Tests may then call the namespace inside the realm.
   - **Purity (§A3):** replace `Math.random` and `Date.now` with functions that throw, call the
     exports with every argument passed explicitly (so no `Date.now()` default parameter runs),
     and restore both in a `finally`.
10. **Required spec behaviours** (spec §3 F1.2, §5, §6) MUST each have at least one test that
    names the bullet in its title.
11. **Hold-out writers** (spec §11): same contracts, different cases. Require modules by absolute
    path via `AM_REPO` (§M5). Do not reuse the visible tests' literal inputs. Test NAMES are
    printed to implementers (§M5), so a name states the behaviour under test and never contains
    the literal inputs or expected values. Before M0, run the files once as §M1 step 3 says.
12. **e2e writers:** follow §K. Assert only §J selectors and attributes. Compute expected answers
    with the Node modules plus seeds.

---

## Appendix A. Named fixture items (exact content)

Each block is one item. `bank.json` holds the probability and brainteaser ones,
`decks/cpp.json` holds `FX_CPP_*`, and `decks/systems.json` holds `FX_SYS_*`.

#### FX_NUM_7_36 = `fixture-p3-q1-8c8ddb31`

```json
{
  "id": "fixture-p3-q1-8c8ddb31",
  "source": {"key":"fixture","title":"Fixture Notes","file":"fixture-notes.pdf","page":3},
  "area": "probability",
  "topics": ["dice","order-statistics"],
  "difficulty": 2,
  "type": "numeric",
  "prompt": "Two fair six-sided dice are rolled. What is the probability that the larger of the two values is exactly $4$?",
  "answer": {"value":"7/36"},
  "solution": "$P(\\max \\le 4) - P(\\max \\le 3) = \\frac{16}{36} - \\frac{9}{36} = \\frac{7}{36}$.",
  "origin": "generated",
  "check": {"status":"agreed","method":"blind+sim"}
}
```

#### FX_NUM_INV_E = `fixture-p4-q2-dd175c13`

```json
{
  "id": "fixture-p4-q2-dd175c13",
  "source": {"key":"fixture","title":"Fixture Notes","file":"fixture-notes.pdf","page":4},
  "area": "probability",
  "topics": ["derangements","limits"],
  "difficulty": 3,
  "type": "numeric",
  "prompt": "A deck of $n$ distinct cards is shuffled uniformly at random. As $n \\to \\infty$, what is the limiting probability that no card is in its original position?",
  "answer": {"value":"1/e"},
  "solution": "By inclusion-exclusion the probability is $\\sum_{k=0}^{n} (-1)^k / k!$, which tends to $e^{-1}$.",
  "origin": "generated",
  "check": {"status":"corrected","printed":"1/2","resolved":"1/e","method":"blind","note":"The printed value is the n = 2 case."}
}
```

#### FX_MCQ_COINS = `fixture-p5-q1-0a74e9b8`

```json
{
  "id": "fixture-p5-q1-0a74e9b8",
  "source": {"key":"fixture","title":"Fixture Notes","file":"fixture-notes.pdf","page":5},
  "area": "probability",
  "topics": ["binomial","coins"],
  "difficulty": 1,
  "type": "mcq",
  "prompt": "A fair coin is flipped three times. What is the probability of exactly two heads?",
  "answer": {"choices":["1/8","1/4","3/8","1/2"],"correct":2},
  "solution": "$\\binom{3}{2} / 2^3 = 3/8$.",
  "origin": "generated",
  "check": {"status":"unverified"}
}
```

#### FX_FREE_WEIGH = `fixture-p7-q1-b7e30cef`

```json
{
  "id": "fixture-p7-q1-b7e30cef",
  "source": {"key":"fixture","title":"Fixture Notes","file":"fixture-notes.pdf","page":7},
  "area": "brainteaser",
  "topics": ["weighing","information"],
  "difficulty": 2,
  "type": "free",
  "prompt": "Nine coins look identical, but one is slightly heavier. Using a two-pan balance, what is the minimum number of weighings that guarantees finding the heavy coin? Explain your strategy.",
  "answer": {"value":"Two. Split the coins into three groups of three and weigh two groups against each other: the heavier pan, or the unweighed group if they balance, holds the heavy coin. Then weigh two coins from that group the same way."},
  "solution": "Each weighing has three outcomes, so $k$ weighings distinguish at most $3^k$ cases. Since $3^2 = 9$, two weighings suffice and one does not.",
  "origin": "generated",
  "check": {"status":"agreed","method":"blind"}
}
```

#### FX_NUM_DISPUTED = `fixture-p8-q1-353ff247`

```json
{
  "id": "fixture-p8-q1-353ff247",
  "source": {"key":"fixture","title":"Fixture Notes","file":"fixture-notes.pdf","page":8},
  "area": "probability",
  "topics": ["conditional","bayes"],
  "difficulty": 2,
  "type": "numeric",
  "prompt": "A family has two children, and you learn that at least one of them is a boy. Assuming each child is independently a boy or a girl with probability $1/2$, what is the probability that both are boys?",
  "answer": {"value":"1/3"},
  "solution": "Of the equally likely cases BB, BG, GB, GG, the condition leaves BB, BG, GB, so the answer is $1/3$.",
  "origin": "generated",
  "check": {"status":"disputed","printed":"1/3","resolved":"1/2","method":"blind","note":"The re-solver read the condition as 'a specific child is a boy'."}
}
```

#### FX_NUM_EV = `fixture-p9-q1-e9f1f9c4`

```json
{
  "id": "fixture-p9-q1-e9f1f9c4",
  "source": {"key":"fixture","title":"Fixture Notes","file":"fixture-notes.pdf","page":9},
  "area": "probability",
  "topics": ["expected-value","dice"],
  "difficulty": 2,
  "type": "numeric",
  "prompt": "Two fair six-sided dice are rolled. What is the expected value of the larger of the two values?",
  "answer": {"value":"161/36"},
  "solution": "$E[\\max] = \\sum_{k=1}^{6} k \\cdot \\frac{2k-1}{36} = \\frac{161}{36}$.",
  "origin": "generated",
  "check": {"status":"agreed","method":"blind+sim"}
}
```

#### FX_CPP_FREE_MOVE = `fixturecpp-s2-c1-724197d7`

```json
{
  "id": "fixturecpp-s2-c1-724197d7",
  "source": {"key":"fixturecpp","title":"Fixture C++ Notes","file":"fixture-cpp.pdf","page":2},
  "area": "cpp",
  "topics": ["move-semantics","value-categories"],
  "difficulty": 2,
  "type": "free",
  "prompt": "What does `std::move` actually do at run time?",
  "answer": {"value":"Nothing by itself: it is an unconditional cast to an rvalue reference (`static_cast<T&&>`). A move only happens if the result is then bound to a move constructor or move assignment operator."},
  "solution": "`std::move` is a cast. Ownership transfer is done by the overload it selects, not by `std::move`.",
  "origin": "generated",
  "check": {"status":"agreed","method":"blind"}
}
```

#### FX_CPP_NUM_SIZEOF = `fixturecpp-s5-c1-6d654661`

```json
{
  "id": "fixturecpp-s5-c1-6d654661",
  "source": {"key":"fixturecpp","title":"Fixture C++ Notes","file":"fixture-cpp.pdf","page":5},
  "area": "cpp",
  "topics": ["class-layout","padding"],
  "difficulty": 2,
  "type": "numeric",
  "prompt": "On x86-64 with the usual alignment rules, what is `sizeof(S)` for `struct S { char a; int b; char c; };`?",
  "answer": {"value":"12"},
  "solution": "`a` at offset 0, 3 bytes padding, `b` at 4, `c` at 8, then 3 bytes tail padding to a multiple of 4: 12.",
  "origin": "generated",
  "check": {"status":"agreed","method":"blind+sim"}
}
```

#### FX_SYS_MCQ_LINE = `fixturesys-s4-c1-31442a11`

```json
{
  "id": "fixturesys-s4-c1-31442a11",
  "source": {"key":"fixturesys","title":"Fixture Systems Notes","file":"fixture-systems.pdf","page":4},
  "area": "systems",
  "topics": ["cache-hierarchy"],
  "difficulty": 1,
  "type": "mcq",
  "prompt": "What is the cache line size on current mainstream x86-64 CPUs?",
  "answer": {"choices":["16 bytes","32 bytes","64 bytes","128 bytes"],"correct":2},
  "solution": "64 bytes on current Intel and AMD x86-64 cores.",
  "origin": "generated",
  "check": {"status":"agreed","method":"blind"}
}
```

#### FX_SYS_FREE_FALSESHARING = `fixturesys-s6-c1-b483ecba`

```json
{
  "id": "fixturesys-s6-c1-b483ecba",
  "source": {"key":"fixturesys","title":"Fixture Systems Notes","file":"fixture-systems.pdf","page":6},
  "area": "systems",
  "topics": ["false-sharing","cache-hierarchy"],
  "difficulty": 2,
  "type": "free",
  "prompt": "What is false sharing, and how do you avoid it?",
  "answer": {"value":"Two threads write to different variables that sit on the same cache line, so the line bounces between cores under the coherence protocol. Avoid it by padding or aligning per-thread data to the cache line size, for example with `alignas(64)`."},
  "solution": "Coherence works per cache line, not per variable, so independent writes to one line serialise.",
  "origin": "generated",
  "check": {"status":"unverified"}
}
```

## Appendix B. Reference values (for test writers)

| Thing | Value |
|---|---|
| `mulberry32(42)` first 3 | `0.6011037519201636, 0.44829055899754167, 0.8524657934904099` |
| `randInt(mulberry32(42), 1, 6)` ×10 | `4,3,6,5,2,4,2,4,6,3` |
| `generate("arith", 42)` first 6 prompts | `6 × 86`, `3 × 54`, `150 – 63`, `115 – 26`, `5 × 21`, `9 × 62` |
| `createGame("dice", 7)` | `n = 3`, outcomes `[1, 6, 5]`; noise: bot sells, buys, buys |
| `createGame("cards", 7)` | `n = 3`, outcomes `[1, 13, 9]` |
| `createGame("coins", 7)` | `batch = 2`, `n = 6`, flips `[0,0,0,1,1,1]`, 3 rounds |
| SRS run from new: good, good, good, easy, hard, again, good, good | intervals `1, 6, 15, 49, 59, 0, 1, 6`; ease after easy 2.65, after hard 2.5, after again 2.3 |
| `E[max of 2 d6]` | 161/36 = 4.472222… |
| d6 with r rerolls | r=1: 4.25, r=2: 14/3, r=3: 4.944… |
| `E[abs(X − Y)]`, two d6 | 35/18 |
| `cards-first-high`, r = 13 | 10.6 (53/5) |
| `coins-absdiff`, n = 10 | 2.4609375 |
