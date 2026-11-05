# Accountability Machine v4: Quant Prep (test-first build spec)

This spec is self-contained. Paste it into a fresh Claude Code session opened in
`~/accountabilitymachine` and build it with a multi-agent workflow ("ultracode"). Every
decision below has already been made with the user. Do not re-ask them. Where this spec
is silent, pick the simplest option that matches the existing code, and note it in
`BUILD-NOTES.md`.

## 0. Context

- **The user:** Naman, Year 3 of a 4-year MSci CS & AI at Loughborough.
  - Incoming Barclays Pre-Trade Markets Technology intern, summer 2027.
  - Targets 2028 new-grad offers: quant developer at mid/upper-mid trading firms (Optiver,
    IMC, G-Research, Maven, Qube, Flow), high-pay tech SWE, and trader online tests (OAs) as a bonus.
  - The application window opens in July 2027.
- **The repo:** a Chrome MV3 extension, v3.0.0. It has these parts:
  - **Side panel** (`sidepanel.html/js`): the chat buddy on OpenRouter, with tool-calling memory.
  - **LeetCode tracking:** streak, auto-detected Accepted solves, re-solve queue, solve timing.
  - **Practice tracks** (`practice.js`, `practiceLog`): six fixed tracks.
  - **Zetamac auto-capture.**
  - **Interviewer modes:** dsa, quantdev, cv, trader.
  - **Sunday review and distraction overlay.**
  - **Tests:** a Node built-in test runner (`npm test`), a syntax check (`npm run check`),
    and a Playwright e2e harness (`npm run e2e`).
  Read `PLAN.md`, `README.md`, `practice.js`, `tests/practice.test.js` and `e2e/run.js` first.
  Pure logic lives in plain scripts with a `module.exports` hook at the bottom, so the same
  file runs in the extension and in Node. Follow that pattern.
- **The resource library:** `~/Documents/Quant Prep/resources/` (596 MB). It is listed in
  `MANIFEST.md` and `manifest.json` in that folder:
  - `00-user-supplied/`:
    - Zhou, *A Practical Guide to Quantitative Finance Interviews* (the Green Book): first
      edition, 2008, a 213-page image-only scan with no text layer.
    - Wasserman, *All of Statistics*.
  - `01-probability/`:
    - `stat110/`: Strategic Practice and Homework 1-11 with solutions, plus selected
      solutions to the Blitzstein & Hwang starred exercises.
    - Also `mit-1805/`, `mit-6041/`, `mit-6042/`, `mit-18600/`, `grinstead-snell/` and `extras/`.
  - `02-quant-interview/`:
    - `jane-street/`: Probability and Markets guide, ML guide.
    - `mit-18s096/`: lectures and problem sets.
    - Also `conroy-dice-problems/` and `winkler-mathematical-puzzles/`.
  - `03-cpp/`:
    - `cppreference/` (offline) and `core-guidelines/`.
    - `cppcon-back-to-basics/` (18 decks) and `cppcon-low-latency/` (6 decks).
    - Also `iso-standard/`, `stroustrup/` and `performance/`.
  - `04-systems-low-latency/`: `drepper/`, `ostep/`, `mckenney-perfbook/`, `agner-fog/`,
    `cmu-15213-s26-slides/`, `lmax-disruptor/`, `intel/`, `beej/`, and the Memory Consistency
    Primer (2nd ed.).
  - `05-coding-lists/neetcode/`: `neetcode150.json`, `blind75.json` and `neetcode-all.json`.
    - Shape: `{source, list, count, problems: [{order, problem, slug, url, difficulty, pattern, leetcode_id}]}`.
    - Also `grind75/`.
  - `06-system-design/`: System Design Primer README. Not used in v4.

## 1. Decisions (fixed)

| # | Decision |
|---|---|
| D1 | **Location.** A new full-page extension page, `prep.html`, opened from a 📚 button in the side panel header and from a "Take me to Prep" option on the distraction overlay. It shares `chrome.storage.local` with the side panel. |
| D2 | **Marking.** Numeric and closed-form answers are auto-checked. Multiple-choice is auto-checked. Free-response items show the solution, and the user self-grades Again/Hard/Good/Easy. An optional "Check my reasoning" button sends the user's working, the item and its solution to the configured OpenRouter model. |
| D3 | **Scope.** Four core pieces: probability and brainteaser bank, C++ and systems concept cards, mental maths, mock interviews. Three extras: OA simulators, market-making game, readiness dashboard (which includes the NeetCode 150 tracker, the no-AI flag, the mistakes journal and the library reader). |
| D4 | **Copyright.** The repo is PUBLIC. The real bank and every copied library PDF are built locally into a gitignored `bank/` folder that the unpacked extension loads. Code, tests and a small synthetic fixture bank are committed. Nothing derived from copyrighted books is ever committed or pushed. |
| D5 | **TDD.** Tests are written first and must fail. They are then locked by checksum. Implementers may not edit locked tests (section 9). |
| D6 | **Disputes.** If an implementer believes a locked test is wrong, it files the dispute in `TEST-DISPUTES.md` and moves on. An independent judge agent, which has never seen the implementation, compares the test with this spec. It amends that single test only if the test contradicts the spec, and logs the change for the user. |
| D7 | **Answer verification.** Blind re-solve: an independent agent solves every bank item without seeing the printed answer. Numeric answers are also checked with a small calculation or simulation script where possible. Mismatches are flagged in the app and listed in `bank/REPORT.md`. |
| D8 | **Out of scope:** code judge (the user does coding on LeetCode), C++ sprint plan, system-design deck, firm-specific interview intel, hosting or syncing the bank, Codeforces. |

## 2. Architecture

```
prep.html + prep.css + prep-ui.js     full-page UI (tabs: Today, Practice, Cards, OA, Market, Dashboard, Library)
prep/answer.js        answer parser + checker            (pure, Node-tested)
prep/srs.js           SM-2 scheduler + queue builder      (pure, Node-tested)
prep/bank.js          bank schema, validator, ids, loader helpers (pure, Node-tested)
prep/oa.js            seeded generators + scoring for OA simulators (pure, Node-tested)
prep/market.js        market-making game engine           (pure, Node-tested)
prep/readiness.js     readiness scores, NeetCode linkage, mistakes, summaries (pure, Node-tested)
prep/rng.js           seeded PRNG (mulberry32) + helpers  (pure, Node-tested)
bank-build/           local content pipeline (Node and/or Python); reads ~/Documents/Quant Prep/resources
bank/                 GITIGNORED build output: bank.json, decks/*.json, library/**.pdf, REPORT.md
tests/fixtures/bank-mini/   committed synthetic bank (about 40 items written for tests, no copyrighted text)
vendor/katex/         vendored KaTeX (pinned version, offline) for maths rendering
```

- **The same module pattern as `practice.js`:** no `chrome.*` and no DOM in `prep/*.js`, and
  `module.exports` at the bottom. The UI and the side panel load them as plain scripts.
- **Loading the bank.** `prep-ui.js` loads it with
  `fetch(chrome.runtime.getURL("bank/bank.json"))`. If the bank is missing, it shows a
  "Bank not built: run `npm run bank:build`" screen and falls back to the fixture bank only
  when the URL has `?fixture=1`. The e2e tests use that fallback.
- **Manifest changes:**
  - add `"unlimitedStorage"`;
  - add `prep.html` as an extension page;
  - `bank/library/*` must be reachable from `prep.html` (same-origin extension URLs; no
    `web_accessible_resources` needed for extension pages);
  - bump the version to `4.0.0`.
- `.gitignore` gains `bank/` and `bank-build/.cache/`. A `npm run check:no-bank` script fails
  if `git ls-files` lists anything under `bank/`, any PDF, or any file over 1 MB outside
  `vendor/` and `tests/fixtures/`. Add it to `npm run check`.

### Storage (chrome.storage.local)

| Key | Shape |
|---|---|
| `prepCards` | `{ [itemId]: { ease, interval, due, reps, lapses, last, seen } }` (SRS state only) |
| `prepHistory` | `[{ ts, itemId, mode: "auto"\|"self", correct\|null, grade, secs, answer }]`, capped at 20000, oldest dropped |
| `prepMistakes` | `[{ ts, itemId, answer, note }]`, capped at 5000 |
| `oaRuns` | `[{ ts, kind, seed, score, total, secs, config }]` |
| `mmRuns` | `[{ ts, scenario, seed, pnl, edge, trades, maxPos, fairErrors }]` |
| `prepSettings` | `{ newPerDay: 15, reviewCap: 150, areas: [...] }` |
| `lcSolves[*].noAI` | new optional field on existing solve records: `true`, `false` or `null` |

- **Logging to the existing practice log.** Prep activity writes to the six existing
  `practiceLog` tracks. Do not add tracks; the v3 tests assert exactly six.
  - Each answered item in the probability, brainteaser, statistics or finance areas adds
    1 to `probability`.
  - Time spent in the C++ and systems decks adds whole minutes to `cpp`. Batch these into
    at most one entry per session.
  - The in-app mental maths game with the Zetamac default config writes a `zetamac` entry
    with the note `"in-app"`.
  - A finished mock interview still writes `mock`.
- **All v3 behaviour and all existing tests stay unchanged and green.**

## 3. Feature F1: bank and spaced repetition

### F1.1 Item schema (`prep/bank.js`)

```
{
  id: "<sourceKey>-<locator>-<hash8>",     // hash8 = first 8 hex of sha256(prompt + answer.value)
  source: { key, title, file, page },     // file is relative to bank/library/, page is 1-based
  area: "probability"|"brainteaser"|"statistics"|"finance"|"cpp"|"systems",
  topics: [string],                       // e.g. ["conditional", "bayes"], lowercase-kebab
  difficulty: 1..5,
  type: "numeric"|"mcq"|"free",
  prompt: markdown with $...$ / $$...$$ maths,
  answer: numeric: { value: "<expr>", tol?: { rel?, abs? } }
          mcq:     { choices: [string], correct: index }
          free:    { value: markdown }    // model answer shown on reveal
  solution: markdown,
  origin: "source"|"generated",
  check: { status: "agreed"|"corrected"|"disputed"|"unverified",
           printed?: string, resolved?: string, method?: "blind"|"blind+sim", note?: string }
}
```

- **Validator.** `bankValidate(bank)` returns `{ ok, errors: [{ id, field, msg }] }`. It checks:
  - every required field and the allowed enum values;
  - unique ids;
  - that the hash8 matches the content;
  - that numeric `answer.value` parses (F1.2);
  - mcq `correct` is in range, with 2 to 8 choices;
  - `difficulty` is an integer from 1 to 5;
  - `source.page` is at least 1;
  - `topics` is not empty.
- **Ids must be stable** across rebuilds for unchanged content. A reworded item gets a new
  id, and its old SRS state is ignored, the same as in the SPL bank.

### F1.2 Answer parsing and checking (`prep/answer.js`)

- `parseAnswer(str)` takes a string and returns `{ ok, value: number }` or `{ ok: false, error }`.
  It is a safe evaluator: no `eval` and no `Function`.
  - **Allowed:**
    - numbers, including decimals and scientific notation;
    - `+ - * /`, `^` and `**`, unary minus, parentheses;
    - implicit multiplication only between a number and a constant or function (`2pi`, `3sqrt(2)`);
    - `%` suffix, meaning divide by 100;
    - constants `e`, `pi` and `π`;
    - functions `sqrt`, `ln`, `log` (natural log), `exp`;
    - factorial `n!` for non-negative integers up to 170;
    - `C(n,k)` and `nCk` for integers;
    - mixed fractions are not supported.
  - Whitespace and a leading `=` are ignored, and `,` is not a decimal point.
  - Anything else gives an error with a message.
- `checkNumeric(userStr, item)` returns `{ correct, parsed, expected, error? }`.
  - Default tolerance is `rel 1e-3` or `abs 1e-9`, whichever is looser. The item's `tol`
    overrides it.
  - A parse error is never counted as wrong. It returns `error` so the UI can ask again.
- `checkMcq(index, item)` works the same way for multiple-choice.
- **Required behaviour** (the test writer must cover at least these):
  - `"7/36"` and `"0.1944"` both match `7/36`, but `"0.19"` does not.
  - `"1/e"`, `"e^-1"` and `"exp(-1)"` are equal, and `"36.79%"` matches `1/e`.
  - `"C(10,3)/2^10"` matches `120/1024`, and so does `"10C3/1024"`.
  - `"sqrt(2)/2"` matches `0.70711`.
  - `"5!"` gives 120; `"171!"`, `"(-1)!"` and `"1.5!"` give errors.
  - `"2pi"` gives 6.2832; `"2 3"` gives an error.
  - `"import os"` and `"alert(1)"` give errors.
  - `"1e-3"` gives 0.001.
  - `"-2^2"` gives -4, following the usual maths convention.

### F1.3 Scheduler (`prep/srs.js`)

SM-2 variant with exact numbers. Times are in ms and days are 86400000 ms.

- **New card:** `ease 2.5, interval 0, reps 0, lapses 0`.
- **Grade `again`:** `reps 0, lapses+1, ease max(1.3, ease-0.2), interval 0`, due in 10 minutes.
- **Grade `hard`:** `ease max(1.3, ease-0.15)`, interval `max(1, round(interval*1.2))` days,
  `reps+1`.
- **Grade `good`:** if `reps==0`, interval 1; if `reps==1`, interval 6; otherwise
  `round(interval*ease)`. Ease is unchanged and `reps+1`.
- **Grade `easy`:** as for `good` but the interval is then multiplied by 1.3 and rounded, then
  `ease+0.15`, and `reps+1`.
- **Maximum interval:** 365 days.
- **Auto-checked items:**
  - a wrong answer counts as `again`;
  - a correct answer counts as `good`, or as `hard` if `secs > targetSecs(item)`;
  - `targetSecs = 60 * difficulty * 1.5`.
- **`buildQueue(bank, cards, now, settings)`** returns the session's item ids:
  1. all due reviews (`due <= now`) first, oldest due first, capped at `reviewCap`;
  2. then up to `newPerDay` minus the items already introduced today (`seen` today);
  3. within each group, interleave areas round-robin in this order: probability,
     brainteaser, cpp, systems, statistics, finance;
  4. inside an area, new items go in difficulty order, then by `source` order.
  - It is deterministic for equal inputs.
  - `settings.areas` filters the areas, and an optional topic filter supports buddy drills (F7).
- **`masteryOf(cards, itemIds)`** gives the fraction of items with `interval >= 21`.

### F1.4 UI: the Practice tab

- **One item at a time.** Maths is rendered with KaTeX. The source line reads
  "Green Book, p. 37" and links to `bank/library/<file>#page=<page>`.
- **Input by item type:**
  - numeric items have an input with a live preview of the parsed value;
  - multiple-choice items have buttons;
  - free-response items have a textarea and a Reveal button.
- **After answering:** show the result, the solution, and, for self-graded items, the four
  grade buttons with their next intervals (for example "Good, 6d").
  - Keyboard: 1 to 4 to grade, Enter to submit, Space to reveal.
- **Disputed items** (`check.status: "disputed"`) show a warning banner quoting the
  printed answer and the re-solved answer.
- **"Check my reasoning"** (D2) streams the model's critique into a panel. It never changes
  the grade automatically.
- **Session summary at the end:** answered, accuracy, time, weakest topics, and how many
  are due tomorrow.

## 4. Feature F2: concept card decks

- **Decks:** `bank/decks/cpp.json` and `bank/decks/systems.json`. Cards are items with
  `area: "cpp"` or `"systems"`, usually of type `free` (question, then model answer), with
  some `mcq` and `numeric`. An example numeric card is "sizeof this struct on x86-64 with
  this layout".
- **C++ topics** (target about 250 cards): value categories, move semantics, rule of 0/3/5,
  RAII, smart pointers and their costs, `vector` growth and iterator invalidation, `std::map`
  vs `unordered_map` internals, templates and CRTP, `constexpr`, virtual dispatch costs and
  alternatives, exceptions and `noexcept`, undefined behaviour, lambdas, casts, the memory
  model and atomics, lock-free SPSC queues, class layout and padding, `static`/`inline`/`const`,
  and C++20/23 features (concepts, ranges, `span`, `<=>`, coroutines basics).
- **Systems topics** (target about 150 cards): cache hierarchy and lines, false sharing,
  TLB and pages, branch prediction, NUMA, memory ordering on x86 (TSO) vs ARM, MESI,
  syscalls and context switches, scheduling, kernel bypass basics, the networking stack,
  TCP vs UDP for market data, latency numbers, the LMAX Disruptor, and measuring
  performance.
- **Sources:** the `03-cpp/` and `04-systems-low-latency/` folders. Each card cites its
  source file and page or slide. Cards are written by agents in their own words. No long
  verbatim quotes: at most 1 or 2 sentences.
- **UI:** the Cards tab uses the same SRS (F1.3), with topic filters.

## 5. Feature F3: mental maths and OA simulators (`prep/oa.js`)

- **Everything is seeded and deterministic.** `prep/rng.js` provides `mulberry32(seed)`,
  `randInt(rng, lo, hi)` (inclusive) and `pick(rng, arr)`. A generator called twice with the
  same seed and config gives the same questions.
- **The four simulators:**

| Kind | Rules |
|---|---|
| `arith` | Zetamac clone. Default config matches Zetamac's defaults: addition (2-100) + (2-100), subtraction as the inverse of addition, multiplication (2-12) × (2-100), division as the inverse of multiplication. 120 s. Auto-advances on a correct answer, with no submit key. Score is the number correct. Config is editable. Only the default config writes the `zetamac` practice track. |
| `eighty` | Optiver-style: 80 questions in 8 minutes. Mixed arithmetic including decimals, fractions, percentages and multiplying 2-3 digit numbers. Free entry, so the user can skip. Score is the number correct. Optional negative marking of -1 per wrong answer. |
| `seq` | Number sequences: give the next term. Generator families: arithmetic, geometric, second differences, Fibonacci-like, interleaved two sequences, squares/cubes ± k, primes ± k, alternating operations. 15 questions, 10 minutes. |
| `ev` | Expected-value quickfire: dice, coins and cards (for example "E[max of two d6]", "EV of rolling a d6 and taking the value or rerolling once, optimally"). The exact answer is computed by enumeration or dynamic programming in the generator, never hard-coded. 20 questions, 5 minutes. Answers are checked by `checkNumeric`. |

- **Required tests:**
  - every generator is deterministic for a given seed;
  - every `seq` family's next term is unique: the generator rejects sequences where two
    families fit the shown terms but disagree on the next term;
  - every `ev` answer matches an independent brute-force enumeration in the test, for
    20 seeds per question template;
  - `arith` answers are integers and division questions are exact.
- **Scoring helpers:** `scoreRun(kind, answers)`, plus `personalBest` and `trend` over the last 10 runs.
- **UI:** the OA tab has a big timer, an input that keeps keyboard focus, a results screen
  with score, best and trend sparkline, and a review of missed questions.

## 6. Feature F4: market-making game (`prep/market.js`)

- **Scenarios** are seeded. Each has a hidden true value V and a reveal schedule:
  - `dice`: V is the sum of N d6 (N from 3 to 10); one die is revealed per round.
  - `cards`: V is the sum of K cards drawn from a 52-card deck (A=1 ... K=13); one card is
    revealed per round.
  - `coins`: V is the number of heads in N flips; flips are revealed in batches.
- **Rounds:**
  1. The user enters a fair-value guess and a two-sided quote (bid < ask, width at most
     `maxWidth`).
  2. Bots then trade one unit each against the quote.
  3. After the final round, the position settles at V.
- **Bots:**
  - `noise`: buys at the ask or sells at the bid with probability 0.5 each, from the seeded RNG.
  - `informed`: knows the next reveal. It buys if its conditional E[V] is above the ask,
    sells if it is below the bid, and otherwise passes.
  - `mixed`: one of each per round.
- **Rules:**
  - position limit ±`maxPos` (default 10); trades that would breach it are rejected;
  - cash and position accounting;
  - `pnl = cash + position × V` at settlement.
- **Metrics:**
  - `fairErrors`: |fair guess − E[V given the information revealed so far]| for each round;
  - `edge`: the sum over trades of (trade price − E[V | info at that time]) × the sign of
    the user's side;
  - `adverse`: P&L lost to informed fills;
  - final P&L.
- **Pure function:** `conditionalEV(scenario, revealed)` is exact, using
  linearity: revealed sum + remaining count × per-unit mean, with draws without replacement
  for cards.
- **Required tests:**
  - `conditionalEV` matches brute-force enumeration for small cases;
  - fills and position limits;
  - P&L settlement for a scripted game;
  - informed-bot logic at boundary prices (exactly equal to E means no trade);
  - determinism by seed;
  - a quote with bid ≥ ask, or width over the maximum, is rejected with an error.
- **UI:** the Market tab shows a round-by-round table, the revealed info, the quote inputs
  and fill messages, a settlement screen with a metrics breakdown, and a short post-game
  "what a good quoter would have done" line using `conditionalEV`.

## 7. Feature F5: mock interviews (extend the existing interviewer)

- **Prompts draw on the bank.** The existing `quantdev` and `trader` interviewer prompts
  gain a "material" block: the 3 weakest bank items in their areas (lowest mastery, most
  lapses), so the interviewer quizzes real weak spots. `quantdev` uses cpp and systems
  items; `trader` uses probability, brainteaser and EV items.
  `prep/readiness.js` exports `pickInterviewMaterial(bank, cards, history, mode, n)`. It is
  pure and deterministic, and is tested.
- **Verdicts.** Interview verdicts are already stored as `interview_<mode>_YYYYMMDD`
  memories. The dashboard parses `/(\d+(\.\d+)?)\s*\/\s*10/` from them to show the score per
  mode over time. `parseVerdictScore` is tested.

## 8. Feature F6: readiness dashboard (`prep/readiness.js` + Dashboard tab)

- **Area scores** run from 0 to 100, with exact formulas. Clamp every component to [0, 1]
  and round the final score.

| Area | Score |
|---|---|
| coding | `50 × nc150Solved/150 + 30 × min(1, 1200 / medianMediumSecs) + 20 × noAIShare` |
| probability | `60 × mastery(probability+brainteaser items) + 40 × accuracy(last 50 auto-checked answers in those areas)` |
| cpp | `70 × mastery(cpp cards) + 30 × accuracy(last 50 cpp answers)` |
| systems | `70 × mastery(systems cards) + 30 × accuracy(last 50 systems answers)` |
| mental | `100 × min(1, mean(last 5 zetamac scores)/60)` |
| oa | `100 × mean over kinds eighty/seq/ev of min(1, best of last 5 / target)`, with targets 60/80, 12/15 and 16/20 |
| market | `100 × clamp(0.5 + mean(edge per trade over last 5 games)/2)` |
| mocks | `10 × mean(last 3 verdict scores per mode, averaged over modes with data)` |

  - Missing data gives `null` (shown as "no data"), not 0.
  - `overall` is the mean of the non-null scores.
  - `noAIShare` is the share of the last 30 solves with `noAI === true`. Unknown counts as
    not no-AI.
- **NeetCode 150:**
  - Load `bank/lists/neetcode150.json`, copied by the build from the resource library.
  - Match the list to `lcSolves` by slug: `nc150Progress(list, lcSolves)` returns
    `{ solved, total, byPattern: { [pattern]: { solved, total } }, next }`, where `next` is
    the first unsolved problem in list order.
  - The dashboard shows a progress bar for each pattern. `next` links to LeetCode.
- **No-AI flag:**
  - When the side panel detects an Accepted solve, it shows a small inline prompt: "Solved
    without AI? Yes / No". The answer sets `noAI` on that solve record and is logged.
  - No answer within the session leaves `null`.
  - The streak logic ignores `noAI`.
- **Mistakes journal:**
  - Every wrong auto-checked answer and every `again` grade adds a `prepMistakes` entry.
  - The Dashboard lists the mistakes grouped by topic, with recurring topics first
    (`mistakeTopics(mistakes, bank)`, which is tested). Clicking one opens the item and lets
    the user add a note.
- **Checkpoints:**
  - Reuse `AM_CHECKPOINTS`.
  - The dashboard shows the next checkpoint, days left, and which area scores are under 60.
- **Library tab:**
  - A browsable list of `bank/library/` grouped by the resource library's category folders,
    built by the build into `bank/library/index.json`.
  - Each entry opens the PDF in Chrome's viewer.
  - It shows the "items from this source" count and a Practice-from-this-source button.

## 9. Feature F7: buddy and side-panel integration

- **Navigation:** a 📚 button in the side panel header opens or focuses the `prep.html` tab.
  The overlay gets a "Take me to Prep" option.
- **System prompt:** it gains one line,
  `Prep: overall NN · prob NN · cpp NN · sys NN · due today N · weakest: topicA, topicB, topicC`.
  The line comes from `prepSummaryLine(...)` in `prep/readiness.js`, which is tested.
- **New tool `assign_drill({ area, topics?, count })`.** It stores a pending drill, which
  `prep.html` shows as "Buddy drill: 10 conditional-probability items" at the top of Today.
  Finishing it writes a note back that the buddy sees.
  - Validated by a pure `amDrillEntry(args)` that returns either an entry or `{ error }`,
    the same pattern as `amPracticeEntry`.
  - `count` must be from 1 to 50, `area` must be a known area, and `topics` must exist in
    the bank. With no bank loaded, `topics` is accepted and filtered later.
- **Sunday review:** the trigger also includes the week's prep totals and the change in each
  area score since the last Sunday, computed from `prepHistory`.
- **Unchanged:** the streak gate (the LeetCode target) and every v3 behaviour.

## 10. Feature F8: content pipeline (`bank-build/`, local only)

Run with `npm run bank:build`. Each step caches its output in `bank-build/.cache/` and can be
re-run by name, e.g. `npm run bank:build -- extract greenbook`. Agents running the pipeline do
the extraction and solving work themselves, as Claude Code subagents. The pipeline scripts only
handle files, caching, merging, validation and reports.

1. **OCR.** `brew install ocrmypdf` if it is missing, then OCR the Green Book scan into
   `bank-build/.cache/greenbook-ocr.pdf`. Check that text extraction yields more than 100 KB
   of text.
2. **Extract** problems, answers and solutions per source into the F1.1 schema, with
   `check.status: "unverified"`. Priority order and rough targets:
   - Green Book chapters 2-6 (brainteasers, calculus and linear algebra, probability,
     stochastic processes, finance; about 200 items);
   - Stat 110 Strategic Practice 1-11 (about 150);
   - the Blitzstein & Hwang selected solutions (about 150);
   - Jane Street Probability and Markets (all exercises);
   - MIT 18.05 problem sets and exams with solutions (about 150);
   - MIT 6.041 recitations, tutorials and quizzes (about 150);
   - Conroy dice problems;
   - Winkler (brainteasers with solutions only);
   - MIT 18.S096 problem sets (finance area).
   
   Skip anything that needs a figure to understand, unless it can be described in text.
   Turn each item into numeric, mcq or free form. Prefer numeric when the answer is a number.
3. **Blind re-solve (D7).** A separate agent sees only the prompt and solves it. Then:
   - Agreement gives `agreed`.
   - Disagreement goes to a third agent, which sees both answers and the printed solution
     and decides:
     - `corrected`, if the printed answer is wrong: store `printed`, set `answer` to the
       resolved value, and add a note;
     - `disputed`, if it remains unclear: keep the printed answer and flag the item.
   - For numeric items, wherever feasible, a Monte Carlo or enumeration script in
     `bank-build/sim/` (Python, `python3 -I`) must agree within 3 standard errors, or match
     exactly. Then set `method: "blind+sim"`.
4. **Concept decks (F2).** Write the cards from the C++ and systems sources. A blind checker
   agent reviews every card for correctness and flags or fixes errors.
5. **Assemble:**
   - copy the cited PDFs into `bank/library/` (OCR'd Green Book included, renamed to the
     manifest slugs);
   - write `bank/bank.json`, `bank/decks/*.json`, `bank/lists/neetcode150.json` and
     `bank/library/index.json`;
   - run `bankValidate`; the build fails on any error.
6. **Report:** write `bank/REPORT.md` with counts per source, area and status, every
   `corrected` and `disputed` item (printed vs resolved), items skipped and why, and
   validator output.

**Acceptance:**
- `bankValidate` reports 0 errors;
- at least 600 practice items and at least 300 cards;
- no source over 40% of practice items;
- at most 5% of items `disputed`;
- every numeric item carries a `method`.

## 11. Test-first protocol (anti-cheese)

### Phases

1. **Red.** Test-writer agents read ONLY this spec and the existing public code. They write:
   - unit tests in `tests/v4-*.test.js` for every pure function named in this spec,
     covering every "required behaviour" bullet;
   - e2e scenarios added to `e2e/run.js` (as a new `e2e/v4.js` module that `run.js` calls)
     against `prep.html?fixture=1`;
   - the fixture bank `tests/fixtures/bank-mini/` (about 40 synthetic items covering every
     type, area and check status). It must contain no copyrighted text.
   
   Then they run `npm test`. Every v4 test must FAIL on assertions or missing exports (a
   `require` of a missing module counts as red), with no syntax errors in the test files,
   and every v3 test must still pass.
2. **Hold-out.** A separate test-writer writes a second, smaller set of tests (about 25% of the
   volume, different cases for the same contracts) into
   `~/Documents/Quant Prep/holdout-tests/`, outside the repo. Implementers never see it.
3. **Lock.**
   - `npm run lock:write` stores the sha256 of every file under `tests/`, `e2e/v4.js`
     and `tests/fixtures/` in `tests/LOCK.json`.
   - Commit as `v4: red tests` and tag `v4-red`.
   - `npm run lock:verify` checks the hashes AND that `git diff --name-only v4-red -- tests e2e/v4.js`
     is empty except for files changed through the dispute log. It is part of `npm run check`.
4. **Green.** Implementer agents build the features one milestone at a time (section 12).
   After each milestone a gatekeeper agent runs `npm run check`, `npm test` and
   `npm run lock:verify`.
   - If an implementer touched a locked file, the gatekeeper reverts that change with
     `git checkout v4-red -- <file>`, records a violation in `BUILD-NOTES.md`, and re-runs
     the milestone.
5. **Disputes (D6).**
   - **The implementer** appends to `TEST-DISPUTES.md`: test name, file, the spec section, why
     the test is wrong, and the proposed fix. It then continues with other work.
   - **The judge agent** gets only the spec, the disputed test and the dispute text, never
     the implementation. It rules `uphold` or `amend`.
   - **On `amend`,** the judge edits only that test. It then refreshes `LOCK.json` through
     `npm run lock:write -- --dispute <id>`, which records the dispute id next to the new
     hash, and commits as `v4: amend test (dispute <id>)`.
   - **Every ruling is logged** in `TEST-DISPUTES.md` for the user.
6. **Final.** Then:
   - run the hold-out suite with `HOLDOUT_DIR=... npm run test:holdout`, which runs the
     hold-out tests against the implementation;
   - run `npm run e2e`;
   - run a cheese audit (below).
   
   Hold-out failures are fixed in the implementation, never in the tests.

### Enforcement and rules for implementers

- **Claude Code hook** in `.claude/settings.json`, which is local and gitignored: a `PreToolUse`
  hook denies Edit, Write, MultiEdit and NotebookEdit on `tests/**`, `e2e/v4.js` and
  `~/Documents/Quant Prep/holdout-tests/**` whenever `tests/LOCK.json` exists. It also denies
  Bash commands that mention those paths together with a write verb (`>`, `tee`, `sed -i`,
  `mv`, `cp`, `rm`, `git checkout`). Only the judge and the gatekeeper steps may bypass it,
  through the scripts above.
- **Forbidden in implementation code:**
  - `test.skip`, `.todo` or `only` anywhere;
  - changing `package.json` test globs or scripts;
  - detecting a test environment (`process.env.NODE_TEST*`, `typeof describe`, checking the
    call stack);
  - special-casing fixture ids, seeds or literal test values;
  - catching an exception just to return the expected value;
  - weakening the validator.
- **The cheese audit** (final phase) runs three independent reviewer agents, each prompted
  to find any of the above plus "logic that would fail on inputs not in the tests". Any
  finding confirmed by 2 of the 3 is fixed and re-tested.
- **Coverage:** `node --test --experimental-test-coverage` must report at least 90% line
  coverage for `prep/*.js`.

## 12. Build order (milestones)

| M | Work | Done when |
|---|---|---|
| M0 | Tooling: lock scripts, hook, `check:no-bank`, KaTeX vendored, `unlimitedStorage`, version 4.0.0, `prep.html` shell loading the fixture bank, `.gitignore`. | `npm run check` passes and the red suite is red. |
| M1 | `prep/rng.js`, `prep/answer.js`, `prep/srs.js`, `prep/bank.js`. | Their v4 unit tests pass. |
| M2 | Content pipeline F8. It runs in parallel with M3 to M7 and only needs M1's `bankValidate` and `parseAnswer`. | Section 10 acceptance is met. |
| M3 | Practice and Cards tabs (F1.4, F2 UI). | e2e: answer numeric, mcq and free items, grade, see the interval, and see the disputed banner, all on the fixture bank. |
| M4 | `prep/oa.js` and the OA tab (F3). | Unit and e2e tests pass. |
| M5 | `prep/market.js` and the Market tab (F4). | Unit and e2e tests pass. |
| M6 | `prep/readiness.js`, Dashboard and Library tabs, the no-AI prompt, mistakes (F6). | Unit and e2e tests pass. |
| M7 | Buddy integration and interviewer material (F5, F7). | Unit tests and the mocked-OpenRouter e2e (the existing pattern in `e2e/run.js`) pass. |
| M8 | Hold-out, cheese audit, coverage, then docs: update `PLAN.md` (v4 section), `README.md` (Prep tab, `npm run bank:build`), and the local-only note for `bank/`. | Section 13 is fully met. |

## 13. Definition of done

- These all pass, and `lock:verify` shows no unexplained changes:
  - `npm run check` (syntax, manifest, `check:no-bank`, `lock:verify`);
  - `npm test` (v3 and v4);
  - `npm run test:holdout`;
  - `npm run e2e`.
- `bank/` builds locally and meets the section 10 acceptance criteria. `bank/REPORT.md` exists.
- `git ls-files` contains nothing from `bank/`, no PDFs, and no copyrighted text. The fixture
  bank is synthetic.
- `TEST-DISPUTES.md` lists every dispute with its ruling. `BUILD-NOTES.md` lists the
  decisions made where the spec was silent, any violations, and the known trade-offs.
- **Manual smoke test by the user:**
  1. Load the unpacked extension.
  2. Click 📚 in the side panel to open Prep.
  3. Do 10 Practice items, one OA run and one market game.
  4. Check that the Dashboard updates and the buddy's prompt line reflects it.
