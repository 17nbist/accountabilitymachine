# v4 build notes

This file is kept up to date through the v4 build. Section numbers like "§C1" refer to
`V4-CONTRACTS.md`, and "spec §n" refers to `SPEC-v4.md`.

## 1. Decisions where the spec was silent

Each bullet matches a **[decision]** mark in `V4-CONTRACTS.md`.

**Conventions and modules**

- Each `prep/*.js` file declares exactly one global namespace, declared with `var`: `PrepRng`,
  `PrepAnswer`, `PrepBank`, `PrepSrs`, `PrepOA`, `PrepMarket`, `PrepReadiness`. Dependencies are
  resolved with `typeof X !== "undefined" ? X : require()`. `prep-ui.js` is wrapped in an IIFE.
  New side-panel identifiers are prefixed `prep` or `noAI`. (§A5)
- prep.html logs under the context `"prep"`, to the new ring buffer `amLogs_prep`. (§A5, §I)
- A `bank` parameter in srs and readiness means the merged array of items, and "source order"
  means the index in that array. Every such parameter (and `topicSet`, `indexById`,
  `sourceCounts`) also accepts an object with an `items` array, so passing `bank.json` or the
  loader result works too. (§A6, §D6)

**Answer parser**

- Input is capped at 200 characters. (§C1)
- `"2 pi"` equals `"2pi"`, because whitespace is ignored between tokens. `"2 3"` is still an
  error. (§C1)
- Identifiers are case-sensitive: `PI` and `c` are unknown names. (§C1)
- Only ASCII operators are accepted; `×`, `÷` and `−` are errors. (§C1)
- Implicit multiplication binds tighter than `*` and `/` but looser than unary minus and `^`:
  `1/2pi` = 1/(2π), and `2pi^2` = 2π². (§C1)
- `C(n,k)` with `k > n` is 0. Non-integer or negative arguments are errors. (§C1)
- `item.tol` overrides the default tolerance per field, so `{ abs }` alone keeps `rel = 1e-3`. (§C2)
- The live preview shows 6 significant digits: `String(Number(v.toPrecision(6)))`. (§C4)

**Scheduler**

- Ease is not rounded; tests compare it with a tolerance of 1e-9. (§D1)
- Button labels always show days (`Easy, 120d`), and `again` shows `10m`. (§D3)
- "OK answer" means: an auto item is correct, or a self-graded item is not `again`. This one
  definition is used by accuracy figures, drills and summaries. (§D4)
- `normalizeSettings` accepts `newPerDay` 0–200 and `reviewCap` 0–1000, otherwise the default. (§D5)
- Due reviews are sorted oldest due first, capped at `reviewCap`, and only then interleaved by
  area. This reconciles the spec's step 1 ("oldest due first") with step 3 ("interleave"). (§D6)
- "Seen today" counts only bank items in the queue's area set, so Practice and Cards each get their
  own `newPerDay`. (§D6)
- New items are tie-broken by bank order. The build writes items in source and page order. (§D6)
- `drillQueue` serves buddy drills and Practice-from-source. It has no daily limits and takes due
  items first, then new, then not-yet-due. (§D7)
- `masteryOf` of an empty id list is `null`. (§D9)
- "Due tomorrow" counts everything due before the end of tomorrow, overdue and due-today cards
  included. (§D9, §J2)

**Bank**

- Library category folders and labels are fixed. (§E1)
- Source keys match `[a-z0-9]{2,24}` with no hyphens. Locators are kebab-case, at most 40
  characters. (§E2)
- The mcq hash key is `JSON.stringify(choices) + correct`. (§E3)
- SHA-256 is a synchronous pure-JS implementation in `bank.js`, so it works the same in Node and
  the browser. (§E3)
- Validator errors for an item without an id use the id `"#<index>"`. (§E4)
- The validator requires `check.printed` and `check.resolved` for corrected and disputed items. (§E4)
- `sourceLabel` always uses `p.`, also for slide decks. (§E5)
- `?fixture=1` always loads the fixture bank, even when `bank/` exists. (§E6)
- The side panel loads the bank itself into `prepData` through `prepLoadBank`, inside a
  `try`/`catch`, and honours `?fixture=1` on its own URL (e2e only). (§E6)

**OA simulators**

- Arith pre-generates `4 × durationSecs` questions. (§F1)
- Answer tolerances: arith and seq are exact (`{ rel: 0, abs: 0 }`), eighty is `{ rel: 0, abs: 1e-9 }`,
  ev uses the `checkNumeric` default. (§F1)
- `normalizeConfig` turns numeric strings in the arith config into numbers, so a default game
  started from the UI still counts as default. (§F2)
- Arith config limits: ranges within 0–10000, `durationSecs` from 10 to 600. (§F2)
- Eighty has 8 named categories with exact ranges and a `params` object, 10 questions each, in
  shuffled order. (§F3)
- Seq shows 7 terms. Each family has an exact definition, ranges and a fit/next rule,
  `q.params` equals `seqFit(q.family, q.shown)`, and conflicting fits are rejected. Primes never
  uses `s = 2`, which always collides with `interleaved`. (§F4)
- EV has 10 finitely enumerable templates, each appearing twice per run. (§F5)
- `formatClock` shows `m:ss`, rounding the seconds up. (§F6)
- `scoreRun` takes an optional third argument, `config`, to carry negative marking. (§F7)
- Arith `answers` hold only the auto-advanced (correct) questions, so `total = score`. The
  question on screen at time-up is never recorded, for any kind. (§F7)
- `personalBest` is all-time over matching runs; only `trend` is limited to the last 10 runs. (§F7)
- Quitting an OA run discards it; only finished runs are stored. (§F7)

**Market game**

- Default max widths are dice 4, cards 8 and coins 3. (§G)
- Cards K is drawn from 3 to 8. Coins draw `batch` from 2 to 5 and `n = batch × (3 to 8)`. (§G1)
- `createGame` throws on `maxPos < 1` or `maxWidth <= 0`. (§G1)
- A quote value must be a finite number or a non-empty numeric string; `""` is rejected even
  though `Number("")` is 0. (§G3)
- Bots act in a fixed order: noise, then informed. (§G3)
- The informed bot treats prices within `EV_EPS` = 1e-9 of its estimate as equal, so it does not
  trade. (§G3)
- Edge sign: `s = +1` when the user sells and `−1` when the user buys, so positive edge is good for
  the user, as the market readiness formula `0.5 + edge/2` (spec §8) needs. (§G5)
- `adverse` is measured against the realised V. (§G5)

**Readiness, verdicts and drills**

- History `secs` are rounded and clamped to 0–3600. For free items the clock runs from the item
  being shown to the grade click. (§H1)
- Free-response working is stored trimmed, at most 2000 characters. (§H1)
- `nc150Progress.next` uses array order. (§H2)
- Area null rule: an area is `null` only when it has no data at all. A component without data
  counts as 0. (§H3)
- Mastery divides by all bank items in the area, never-seen items included. (§H3)
- The mental score counts every zetamac entry, in-app and site games of any duration. (§H3)
- The market score uses pooled per-trade edge over the last 5 games. (§H3)
- `parseVerdictScore` returns the mean of all matches that are 10 or less. (§H4)
- Weakest topics use mistakes from the last 30 days. (§H5)
- The trader interview pool includes the topic `expected-value`. Material puts carded items
  first, then sorts by interval ascending, lapses descending, wrong count descending, difficulty
  ascending, then bank order; uncarded items only fill the list. (§H6)
- A null score prints as `n/a` in the prompt line, and an empty weakest list prints `none`. (§H7)
- The side panel reads the prep keys from storage once per request (and once before the Sunday
  review) instead of caching them, so the prompt always reflects prep.html's latest writes. (§H7)
- "Last Sunday" means `now − 7·DAY`. The current side uses `areaScores` (stored cards), the
  previous side uses `areaScoresAt` (replayed cards). (§H8)
- `amWeeklyReviewTrigger` gains an optional `prep` string. Without it, the v3 output is
  byte-identical. (§H8)
- `amDrillEntry(args, ts, bankTopics)` adds two optional arguments, in the same order as
  `amPracticeEntry(args, ts)`. (§H9)
- A drill takes at most 10 topics. (§H9)
- With no bank loaded, drill topics are accepted unchecked; at drill start prep.html drops unknown
  topics and, if none remain, runs the drill area-only. The label keeps the original topics. (§H9)
- The note the buddy sees for a finished drill is `drillPromptLine` in the system prompt, shown
  for 48 h. (§H9)
- Each session keeps at most one `practiceLog` entry per track: the entry (stamped with the
  session start) is upserted after every answered item, so each item counts at once. (§H10)
- Each item's cpp time is capped at 600 s. (§H10)
- The "Check my reasoning" request carries the marker `[Check my reasoning]`. (§H11)

**Storage, UI and wiring**

- Mistake notes are trimmed and capped at 500 characters. (§I)
- New storage key `prepDrill`: one pending drill at a time, replaced by a new assignment. (§I)
- prep.html URL parameters (`tab`, `item`, `mistake`, `source`, `seed`) are fixed. `seed` is used
  only if it is a decimal below 2^32; otherwise, or when absent, the seed is
  `Date.now() % 2^32`. (§J1)
- Session rules: Practice auto-starts on the practice areas, and Cards has a single topic
  select. (§J2)
- The OA timer ticks at least every 250 ms. (§J4)
- The no-AI prompt appears only on an `lcSolves` change that adds a solve. It never writes
  `null`; unknown is `null` or absent, and the two are equivalent. (§J8, §I)
- One `AM_OPEN_PREP` background message opens or focuses the Prep tab, for both 📚 and the
  overlay. It never adds a query. (§J10)
- `AM_E2E_ONLY=v3` / `v4` runs only one half of the e2e suite (plus the sweep). (§K1)

**Tooling and tests**

- Phase order: Red (including `tests/tooling.test.js`), tag `v4-red-pre`, Hold-out (with a
  load check), M0, hook canary, Lock (`v4-red`), then M1 onwards. M0 is the only milestone that
  may edit `package.json` scripts. Implementers never commit; the orchestrator commits only after
  a green gatekeeper run; the judge commits only amend commits. Agents work only in the main
  checkout. (§M1)
- `npm run check` prints `check-ok` (v3 printed `syntax-ok`). (§M2)
- The lock covers `scripts/**`, `e2e/run.js` and `package.json` as well as the spec's `tests/**`
  and `e2e/v4.js`, because those files enforce the lock. (§M4)
- `lock:verify` checks "changed only through the dispute log" through git: no uncommitted change
  to a lockable file, every commit since `v4-red` touching one is an amend commit for a dispute
  ruled `amend` and touches only that dispute's files, and every other LOCK hash equals the one
  at `v4-red`. (§M4)
- `lock:restore` (no arguments) replaces the spec's `git checkout v4-red -- <file>` as the
  gatekeeper's revert path: it restores every lockable file from HEAD and deletes added files.
  The hook would block the git command, and it would undo legitimate amends. (§M4)
- `HOLDOUT_DIR` defaults to `~/Documents/Quant Prep/holdout-tests`. The hold-out reporter prints
  test names and ok/not-ok only, with no verbose mode. (§M5)
- Hold-out disputes are ruled by the user, not the judge, because no agent can read hold-out
  files after M0. (§M5)
- The hook fails closed on unparseable input. (§M6)
- Hook path and pattern matching is case-insensitive on every platform. (§M6)
- The hook's hold-out rules apply from M0 on, not only after the lock, and also deny Read, Grep
  and Glob on the hold-out directory (spec §11 names only edits). (§M6)
- The hook's edit rule (L1) also covers `scripts/`, `e2e/run.js`, `package.json` and the
  project's `.claude/` directory. (§M6)
- The hook's Bash rule (L2) denies any command that mentions a locked path and contains `>` or a
  write verb; the verb list extends the spec's examples with inline and stdin scripts, heredocs
  and editors. (§M6)
- `prep.html` needs no manifest key. (§M9)
- Assertions that already hold at Red (fixture shape and coverage, no PDFs, the v3 regression of
  `amWeeklyReviewTrigger`) live in `tests/static.test.js`, so every `v4-*` test is red at Red. (§N8)

**Red-phase gap resolutions** (marked **[decision, Red]** in `V4-CONTRACTS.md`; raised by the test
writers and reviewers, settled before the pre-lock tag)

- RNG: `rngNext` returns at least `{ value, state }`, with `state` exactly the reference `a`. (§B1)
- RNG: "integer" means `Number.isInteger`; every range with `hi − lo + 1 <= 2^32` works; whether a
  throwing call consumed a draw is implementation-defined; `shuffle` copies the array shallowly;
  `shuffle(rng, null)` is `[]` and `pick(rng, null)` throws (§A3), other non-arrays throw. (§B2)
- Parser: whitespace may separate a function name from `(` (`sqrt (16)` = 4); `**` needs the two
  asterisks adjacent (`2* *3` is an error). (§C1)
- Parser: implicit multiplication only straight after a NUMBER token, so `2!pi` and `2%pi` are
  errors; `5C2!` = (5C2)! and `4C2^2` = (4C2)². (§C1)
- Parser: every non-finite value, `NaN` included, gives keyword `finite` (also for `^`, `exp` and
  `C` results); operand checks with their own keyword come first. The `C` loop stops once the
  product is not finite. With problems of different kinds, which error is reported is
  implementation-defined. (§C1)
- `checkNumeric` converts nothing: a non-string user answer is a parse error and a non-string item
  value is a broken item. A successful `checkMcq` has no `error` key. Only `DEFAULT_TOL.rel` and
  `.abs` are contract. (§C, §C2, §C3)
- Scheduler: a `null` or non-object card entry counts as missing; `schedule` returns exactly the
  seven card fields and accepts only grade strings; `autoGrade` compares strictly. (§D1, §D2, §D4)
- `normalizeSettings` treats a missing or non-object argument as `{}` and converts no values. (§D5)
- Queues de-duplicate the whole bank first, then filter; "seen today" is
  `localDayStart(now) <= seen < localDayStart(now, 1)` over de-duplicated items; bank order is the
  array index only; ids are not validated and sort by plain `<`. (§D6)
- `drillQueue`: with no string area, unknown areas are excluded; topics filter only as a non-empty
  array; `count` is a non-negative integer. (§D7)
- `masteryOf` uses `itemIds` as given; `dueCount` defaults areas only for `undefined` (`null` reads
  as `[]`) and matches areas literally. (§D9)
- Bank files: tests never require `generated`; a library entry's `file` is exactly the cited
  `source.file` and the category folder is only a grouping label; empty categories may be left
  out; `neetcode150.json` free values are only checked for presence. (§E1)
- Locators: the 40-character cap is a build and fixture rule, not encoded in the regexes, and
  whether `bankValidate` reports it is implementation-defined; locator schemes are conventions and
  are never parsed. (§E2)
- `check.printed` / `check.resolved` are display strings; corrected items store the resolved
  answer and disputed items the printed one (a build and fixture rule that `bankValidate` does not
  check). `check.method` is optional and meaningless on unverified items, and the spec §10
  acceptance rules apply to the real build only. (§E2, §L2)
- `answerKey`, `hash8` and `makeId` never validate or throw on well-formed fields. (§E3)
- `bankValidate`: "object" excludes `null` and arrays; "present" is `!== undefined`; "non-empty"
  does not trim; extra result keys are allowed; a non-object entry gives one `items` error under
  `#<index>`; the hash is checked only when `id`, `prompt`, `type`, `answer` and the answer fields
  `answerKey` reads have no error; the key-part check needs `source` to be an object; duplicates
  cover every non-empty string id; `answer.tol` is checked for every type; duplicate and
  bank-level error counts may be asserted. (§E4, §N7)
- `sourceCounts` has keys only for cited files; the Library tab shows a missing key as 0. (§E5)
- `prepLoadBank` is covered by e2e only. (§E6)
- OA: ev answers carry no `tol`; generation reads the normalised config; `normalizeConfig` input
  handling is fixed (only `undefined` is missing, non-array `ops` becomes `[]`, unknown keys are
  dropped). (§F1, §F2)
- OA eighty: questions are shuffled one by one; `EIGHTY_CATEGORIES` is the 8 id strings in table
  order; answer strings match `/^-?(0|[1-9]\d*)(\.\d{0,3}[1-9])?$/`. (§F3)
- OA seq: the rejection step is tested only through its property and hand-made conflicting
  sequences. OA ev: `params` hold exactly the template's parameters, and "no closed form" is a
  code-review rule. (§F4, §F5)
- OA scoring: extra `scoreRun` keys are allowed; `trend` sorts all matching runs by `ts` and then
  takes the last 10. (§F7)
- Market: `state.seed` is `seed >>> 0`; a rejected fill's `positionAfter` is the unchanged
  position; `runEntry` and `goodQuoterLine` throw before the game is done. (§G1, §G3, §G5)
- Market: injected `n`, `batch` and `values` may lie outside the drawn ranges (integers of at
  least 1, cards at most 52, a partial last batch); anything else throws. `state.rng` is the §B1
  state after the creation draws. Quote checks run number, then bid, then width. Result `fills`
  deep-equal the round's history fills. `runEntry` has exactly the spec §2 keys. (§G1, §G3, §G5)
- Market: the sign of a zero metric is not contract; tests compare possible `-0` values with
  `===` or a tolerance. (§G5, §N6)
- Readiness: a "share among the last N" is over the entries kept, so fewer than 30 solves are not
  padded to 30. (§H3)
- Readiness: every §H `bank` is de-duplicated by id first (first wins), so mastery counts distinct
  ids. `historyEntry` truncates but does not trim (the UI trims). `byPattern` order holds for
  non-integer-like names. `next`, mistake entries and material items may be copies. (§A3, §H, §H1,
  §H2)
- Readiness: a missing `inputs` field is `null`; the market data rule looks at the last 5 games
  only; `areaScoresAt` drops only later-dated verdict keys and replays with §D2 rounding;
  `mockVerdicts` has exactly the four mode keys and `{ day, score }` entries. (§H3, §H4)
- Buddy: `prepWeeklyLine` accuracy uses the same bank-mapped window entries as the counts.
  `amDrillEntry` stores `Number(count)`, caps 10 distinct topics after de-duplication, and names
  each unknown topic in its error. (§H8, §H9)
- Buddy: interview material reads `interval` and `lapses` from any card (non-finite counts as 0);
  a `null` `weakest` prints `none`; an unknown drill status gives `""`; `practiceTrack` matches
  literally; `zetamacEntry` needs `Number.isInteger(score)`; the reasoning body has exactly
  `model`, `stream` and `messages`. (§F7, §H6, §H7, §H9, §H10, §H11)
- Buddy: prep entries with amount 1 or more equal `amPracticeEntry` output, and a zetamac 0 is
  still written. The session accumulator is prep-ui logic, covered by e2e v4-19 and code review.
  e2e v4-15 also checks the `assign_drill` schema (description texts are free) and the tool
  result. (§H10, §J8, §K3)
- Interview material is compared only in its `oneLine` form; named prompts fit in 300 characters,
  answers may be cut at 200. (§H6)
- `amWeeklyReviewTrigger` uses `prep` only when it is a non-empty string. (§H8)
- practice.js: `prep` is inserted verbatim (no trim, no `$` pattern expansion) and positionally
  after `${cp}. `; §A3's no-mutation and determinism rules cover it; it is the only v4 change
  to `practice.js` (`amDrillEntry` lives in `PrepReadiness`). (§A3, §H8)
- Fixture: only the six §L1 files are required; file names (last path segment) are
  `fixture-*.pdf`; 37 to 44 items in any order; only three library placements are fixed and
  exactly one `fixture-empty.pdf` entry exists; named items carry no extra fields. (§L1–§L4)
- Tooling: the §M3 prefixes are case-sensitive; only the `pdf` rule ignores case. (§M3)
- Tooling: the lock works relative to the lock root (`TEST-DISPUTES.md`, `.test-staging/`, the git
  cwd and work-tree detection). Notice texts are free. (§M4)
- Tooling: `--dispute` takes the ids as a separate argv item, rehashes only the staged files, may
  also refuse while another lockable file has drifted, and refuses a staged file that is not yet
  in LOCK.json. (§M4)
- Tooling: the `lock:verify` status lines are contract (`pre-lock`, `amended:` lines with ids in
  order, `<N> files OK` with N = LOCK entries, on stdout); the id separator, the notice's stream
  and the order across streams are free. A revert does not repair a non-amend commit (§3).
  `lock:restore` passes only the roots tracked at HEAD. (§M4)
- Tooling: the hold-out reporter prints ok / not ok lines plus a totals line with digits, on
  either stream; suite lines are free. `~` is `os.homedir()`. `test:holdout` leaves `NODE_TEST*`
  alone; the tests strip those variables from the child's environment. (§M5)
- Tooling: `guardDecision` is pure (no fs, no realpath); "inside" includes the dir itself and goes
  by whole segments (`tests-old/` is outside); Grep and Glob on an ancestor of the hold-out dir
  are denied; both allowlist regexes carry `i`. (§M6)
- Tooling: a `.gitignore` entry may have a leading `/` and drop its trailing `/`. The §M9
  permission keys are the four permission keys plus `content_scripts[].matches`. §M10 lists the
  in-git, `test:holdout` and hook CLI tests; the `check:no-bank` and `check.js` CLIs are not run.
  (§M8–§M10)
- e2e: "Text =" compares whitespace-collapsed, trimmed `textContent`; `#drill-banner` is checked
  with "includes". (§J, §J3)
- e2e: result and preview are rendered with the item and reasoning may appear later; a missing
  `data-state` reads as the initial state. `item=`, `source=` and drill sessions use their items'
  areas for `data-due-tomorrow`. A note over 500 characters is truncated. (§I, §J2)
- e2e: saved settings apply to the next session on the page; Cards topic options ignore
  `settings.areas` and exist whenever Cards is shown; a new session replaces the old one and hides
  its summary; `drill-start` makes Practice the active tab and replaces its session. (§J2, §J3)
- e2e: `seed=` also seeds a run restarted after Quit; the arith check runs on every `input` event;
  each rejected quote re-renders `#mm-error`; the Dashboard renders every mistake entry, and a mock
  mode without verdicts may be absent or empty. (§J1, §J4–§J6)
- e2e: the overlay's Prep button follows the Zetamac button in DOM order; prep.html opens in the
  last-focused window and v4-14 checks the tab's `active` flag; `fixedTime` also covers the panel's
  Prep line (v4-16); the panel's `prepData` race is tolerated by retrying, not signalled. (§E6,
  §J9, §J10, §K2)
- Test method: "JSON shape" in §N8 includes the §E2 item schema; a `v4-fixture` test may include a
  static assertion if it also calls `PrepBank`; module shape and purity are checked by behaviour
  (a `vm` load, and throwing `Math.random` / `Date.now`). (§N8, §N9)
- Test method: a test in any `v4-*` file may include an assertion that holds at Red when the same
  test also needs v4 (e.g. the v3 checkpoint half of the spec §8 checkpoint test). (§N9)

**M0: prep.html shell** (implementer choices, not marked in `V4-CONTRACTS.md`)

- **KaTeX 0.19.1** (npm `katex@0.19.1`, MIT; fetched with `npm pack`, not a `package.json`
  dependency) is vendored in `vendor/katex/`: `katex.min.js`, `katex.min.css`,
  `contrib/auto-render.min.js`, `LICENSE`, and all 60 files of `fonts/` (woff2, woff and ttf, as
  the stock CSS references them). No file was edited. To upgrade, replace the folder from
  `npm pack katex@<version>`. Neither file uses `eval` or `new Function`, so it runs under the
  MV3 CSP. (spec §2, §A5)
- **Interim bank loader until M1.** `prep-ui.js` calls the global `prepLoadBank` when one is
  defined (§E6 puts it in `prep-loader.js`). Otherwise it uses its own interim loader, which
  fetches only `<root>bank.json` (root as in §E6) and returns the §E6 shape with
  `decks: { cpp: null, systems: null }`, `nc150: null`, `library: null` and
  `items = bankJson.items`. The interim loader is deleted once `prep-loader.js` exists. (§E6, §J1)
- **Every §A5 script tag ships at M0**, including `prep/*.js` and `prep-loader.js`, which do not
  exist yet. `prep-ui.js` reads each namespace with `typeof`, so a missing file only 404s. At
  init it logs `prep:modules` with the names that are missing. (§A5)
- **A fixture that fails to load** under `?fixture=1` gives `data-bank-source="none"` and the
  bank-missing screen as well. §J2 defines that screen only for "no bank and no `fixture=1`".
  (§J1, §J2)
- An unknown or missing `tab=` value opens `today`. (§J1)
- **Bank missing:** every panel is hidden as well as the tab buttons, and `data-ready` is still
  set to `"1"`. The tab bar and all panels start `hidden` in the HTML, so nothing appears before
  init decides what to show. (§J1, §J2)
- **A shown panel has `min-height: 240px`.** Without it, an empty panel has a zero-height box,
  which Playwright's `isVisible()` reports as hidden. (§J2)
- **Tabs follow the WAI-ARIA tabs pattern:** `role` tablist, tab and tabpanel, a roving
  `tabindex`, and Left/Right arrows to move between tabs. Changing tab does not rewrite the URL.
  Clicking the tab that is already active does nothing. (§J2)
- **Tab renderers.** `prep-ui.js` has a `RENDER` map, `RENDER[<id>](panelEl, data)`, which is
  awaited every time a tab is shown. `data-ready` waits for the initial tab's renderer, which is
  the §J1 ready rule. The map is empty at M0, and each tab's milestone fills in its entry.
- **No catch-all around init or the renderers.** A renderer error becomes an unhandled rejection
  (log.js logs `global:unhandled-rejection`, which fails the e2e sweep) and the page never
  reaches ready. It never reports ready silently. The only `catch` is in the fetch, as §E6
  requires.

**M0: tooling** (implementer choices, not marked in `V4-CONTRACTS.md`)

- **`npm run check` syntax scope.** "(top level)" is read as applying to `tests/` only. The root
  and `tests/` are scanned top level; `prep/`, `scripts/` and `e2e/` recursively (never `e2e/out/`,
  dot dirs or `node_modules/`); `bank-build/` recursively without `.cache/` and `sim/items/`. A
  directory that does not exist yet is skipped. Each step prints one status line before
  `check-ok`. (§M2)
- **`check:no-bank` outside a git work tree** prints a notice and passes, because nothing can be
  tracked there. Inside one, a failing `git ls-files` fails the check. (§M3)
- **The lock root must be the work tree's top level.** If the lock root is inside a git work tree
  but is not its top level, `lock:write`, `lock:verify` and `lock:restore` refuse (exit 1) instead
  of checking the enclosing repo. (§M4)
- **Lock git calls are config-proof.** Every git call in `lock.js` turns off colour, path quoting
  and `log.showSignature`, and parses NUL-separated (`-z`) output. Diffs use `--no-renames`, and
  `diff-tree` uses `--root`. Read-only calls set `GIT_OPTIONAL_LOCKS=0`, so `lock:verify` never
  writes inside `.git/`. (§M4)
- **Lock git calls are also tamper-proof (M0 tooling review).** Every git call sets
  `GIT_NO_REPLACE_OBJECTS=1`, `core.fsmonitor=false` and `core.hooksPath=/dev/null`. Each of the
  three was reproduced as a bypass in a throwaway clone. A `git replace` of the `v4-red` LOCK.json
  blob made check (d) read a forged lock. A configured fsmonitor can tell `git status` that a file
  is unchanged. A `post-checkout` hook that deleted `tests/LOCK.json` turned `lock:restore` into
  "pre-lock, skipping", exit 0. (§M4)
- **Byte checks back up `git diff` and `git status` (M0 tooling review).** `git diff` and `git status`
  compare through the index. So `update-index --assume-unchanged` or `--skip-worktree`, or a clean
  filter, hides an edit from them. All three let `lock:write` lock an edited test in a throwaway
  clone, and assume-unchanged also hid an uncommitted edit to an amended file from
  `lock:verify` (b).
  - `lock:write`'s pre-lock check now also compares the raw bytes of every file under `tests/`
    and `e2e/v4.js` at `v4-red-pre` with the working tree (`git hash-object --no-filters`).
  - `lock:verify` (b) does the same for the lockable roots against `HEAD` when `git status` is
    clean.
  - Both checks are the contract's own conditions ("working tree against the tag", "no
    uncommitted change"), so nothing new is refused in a normal tree.
  - Both assume that git does not convert files on checkout (`core.autocrlf`, `eol` attributes).
    This repo uses neither. (§M4)
- **`parseDisputes` details.** An entry ends at the next heading of any level. The first `Ruling:`
  and `File:` line of an entry count. Line keys may be list items (`-`, `*` or `+`). Entries are
  exactly `{ id, ruling, files }`, the §M4 shape, so a `deepEqual` on the result holds. An empty
  `Ruling:` value is `""`, which is not `amend`. (§M4)
- **`lock:write --dispute` details.**
  - Extra refusals (exit 1, nothing changes): an id with more than one entry in
    `TEST-DISPUTES.md`, a file staged under two ids in one run, a staging entry that is not a regular
    file (a symlink, say), and a repeated id in the list.
  - A Finder `.DS_Store` inside a staging dir is ignored.
  - A non-staged lockable file that has drifted from its LOCK hash does not cause a refusal. It
    gets a warning, and `lock:verify` still fails on it.
  - An id already in a file's `disputes` is not added twice.
  - Staged bytes are written into the existing file, which keeps its mode. `.test-staging/` is
    removed once it is empty.
  - `--dispute=<ids>` works too. (§M4)
- **`lock:verify` output.** Failure reasons and the no-git notice go to stderr. The `amended:`
  lines and the OK line go to stdout. Several ids are joined with `", "`. A hash mismatch stops
  before the git checks. In check (c), an id with zero entries or several entries in
  `TEST-DISPUTES.md` fails. An unreadable `tests/LOCK.json` fails. (§M4)
- **`lock:restore` unstages first.** It runs `git reset -q HEAD -- <lockable roots>` before
  `git checkout HEAD -- <roots at HEAD>`. Without this, a file that was added to the index but never
  committed would survive, because `git ls-files --others` lists only files outside the index.
  Untracked entries under `tests/` and `scripts/` are removed recursively (a nested repo, for
  example), except `.DS_Store`. Directories left empty are pruned, but never `tests/` or
  `scripts/` themselves. Restore refuses when there is no HEAD commit. (§M4)
- **`LOCK.json` layout.** It is written as 2-space JSON with a trailing newline, keys `version`,
  `algorithm`, `created`, `files`, and `files` sorted by `<`. (§M4)
- **`test:holdout` details.**
  - A leading `~` in `HOLDOUT_DIR` is `os.homedir()`, and a relative value is relative to the cwd.
  - A path that exists but is not a directory exits 1.
  - A directory with no `*.test.js` exits 1. Otherwise `node --test` would get no files and
    would discover the repo's own tests instead.
  - File symlinks count. Directory symlinks are not followed. (§M5)
- **Hold-out reporter format.**
  - Nested tests are indented two spaces per level, and suites get their own line.
  - A file that fails to load gets a `not ok <absolute path>` line.
  - Newlines in a name become spaces.
  - The totals line is `tests N, pass P, fail F, skipped S, todo T`, with suites not counted.
    (§M5)
- **Hook details.**
  - H2's "contains" is checked on the raw command and also on a copy with backslash escapes and
    quote marks removed. So `ls ~/Documents/Quant\ Prep/holdout*` counts as naming
    `Quant Prep/holdout`.
  - H2's strings also include the `~/…` spelling of the hold-out path when it is under home.
  - A JSON payload that is not an object (an array, `null` or a string) is denied, like
    unparseable stdin.
  - The hook's `HOLDOUT_DIR` may start with `~`.
  - Deny reasons name the rule (H1, H2, L1, L2) and the allowed route.
  - **"Case-insensitive" means Unicode case folding, as on APFS (M0 tooling review).** APFS folds
    names, so on this Mac `teſts/a.test.js` (long s), `teﬆs/…` (st ligature) and
    `…/holdout-teſts/canary.txt` open the real files. PATH lookup folds too, so
    `ſed -i '' … ſcripts/lock.js` runs sed and edits `scripts/lock.js`; both were reproduced in
    scratch.
    - Plain `toLowerCase` and the `i` regex flag miss these spellings, so each one passed H1, L1
      and L2.
    - Every path and command is now compared after `normalize("NFC").toUpperCase().toLowerCase()`.
    - MENTION_RE and WRITE_VERB_RE run on the raw command and on its folded copy. For ASCII the
      result is unchanged.
    - The allowlist regexes still run on the raw command only. (§M6)
- **`bank-build/sources.json`.**
  - Built from the M2 survey with the key map `greenbook`, `stat110`, `bh`, `janestreet`,
    `mit1805`, `mit6041`, `conroy`, `winkler`, `mit18s096`. The MIT titles (`MIT 18.05`,
    `MIT 6.041`, `MIT 18.S096`) follow the extraction cache.
  - `priority` follows the spec §10 order (1 to 9).
  - `folder` is the library category (the first segment of `file`).
  - `file` is relative to the resource root. It is the PDF itself, or, for a source spread over
    many PDFs, a `*` glob inside one segment that matches its files (Stat 110 SP and HW, the 18.05
    and 6.041 `pdfs/` folders, the 18.S096 `problem-sets/`).
  - `manifestSlug` is the file name without `.pdf` for a one-file source, or the course folder
    name for a multi-file one. The OCR'd Green Book goes to `bank/library/<file>` under the
    manifest's name.
  - `area` is the area with the most estimated items in the survey. It is only the source's
    label, because every item carries its own area. (§M7)
- **`bank:build` skeleton (until the M2 pipeline lands).** Every step prints
  `bank:build <step>: not implemented yet` and the run exits 1, because nothing was built.
  `--help`, `-h` and `help` exit 0. An unknown step or source exits 1 with the usage text. The
  `decks` step takes `cpp` or `systems` as its second argument. (§M7)

## 2. Violations

(none yet)

## 3. Known trade-offs

**Hook and lock**

- **The hook may not take effect at once.** Claude Code reads `.claude/settings.json` hooks when a
  session starts. A hook added mid-session may need a session restart, or a review in `/hooks`,
  before it applies. The §M1 canary step checks it before the lock. *Observed during this build:* a
  throwaway probe hook written to `.claude/settings.json` mid-session took effect at once, both
  for the main session and for a workflow subagent (its Read of the probe file was denied), so no
  restart was needed. The probe was removed before M0. The real canary still runs after M0.
- **Subagents may not load project hooks.** In an Agent SDK workflow, subagents run project hooks
  only if the SDK loads project settings (`settingSources` includes `"project"`). The canary
  (§M1 step 5) must be run by a subagent started the same way as the implementers. If its Read of
  a file in the hold-out directory is not denied, stop and fix the setup before locking. The
  canary checks the hook's wiring; the rules themselves are covered by `tests/tooling.test.js`.
- **The hook cannot tell agents apart.** All subagents share one Claude Code process, so the hook
  cannot tell the judge from an implementer. An implementer could write `Ruling: amend` into
  `TEST-DISPUTES.md`, stage a file under `.test-staging/`, run `lock:write --dispute` and commit.
  - Mitigation: the gatekeeper checks that every ruling was written by a judge step.
  - Mitigation: `lock:verify` prints an `amended: <path> (<ids>)` line for every amended file.
  - Mitigation: the cheese audit reviews `git log` for amend commits.
- **The hook is pattern-based, not a sandbox.** A determined agent can still write a locked file,
  for example through a script file that is then run. `lock:verify` (hashes, a clean working
  tree for lockable files, and the git history since `v4-red`) catches the result, and it is now
  itself locked. An agent that also forges commits (a fake amend commit with a fabricated ruling)
  is caught only by the gatekeeper's ruling check and the cheese audit.
- **The Bash rule has false positives.** Any `>` (including `=>` inside a quoted pattern) in a
  command that mentions a locked path is denied, and `.claude/` or `package.json` mentioned
  elsewhere (e.g. `~/.claude/…`, `node_modules/x/package.json`) counts as a mention. Agents use
  the Read and Grep tools for such searches.
- **The hold-out rules match text.** H1 and H2 deny paths inside the hold-out dir, Grep and Glob
  on it or an ancestor of it, and Bash commands that spell its name or path. A Bash command that
  reaches it through shell globs or variables (e.g. `cat ~/Documents/Quant*/hold*/*`), or a Glob
  whose absolute pattern has wildcards in its directory part, is not caught. The hold-out then
  relies on the implementer prompts and the cheese audit. (§M6)
- **A stray commit cannot be reverted.** `lock:verify` (c) lists every commit since `v4-red` that
  touches a lockable root, so a revert commit fails as well. Recovery: the orchestrator (or the
  user) moves the branch back to the last commit that verifies and re-applies any non-lockable
  work on top. `v4-red` is never moved. If the bad commit was already pushed, this rewrites
  public history, so push only verified commits. (§M4)
- **Worktrees are not protected.** The hook only knows the main checkout's paths, so agents must
  work there (§M1).
- **Locked tooling can only change through a dispute.** A real bug in `scripts/`, `e2e/run.js`
  or `package.json` found after the lock is fixed the same way as a test: a dispute whose `File:`
  lists the file, a judge ruling of `amend`, and `lock:write --dispute`.
- **M0 runs before the lock.** Before the lock the hook cannot protect tests. The `v4-red-pre`
  tag and the initial `lock:write` checks (no diff and no untracked files under `tests/` or
  `e2e/v4.js`) are the guard.
- **Hold-out output is minimal, deliberately.** The reporter shows test names only, so
  implementers fixing hold-out failures get little signal. Details would leak the hold-out cases.
- **Hold-out tests cannot be repaired by agents.** After M0 no agent can read them. The hold-out
  writer's load check before M0 is the only automated check, and a hold-out test that
  contradicts the spec goes to the user (§M5).

**Build process (orchestration)**

- **M2 content extraction started during Red.** To save wall-clock time, the agent work that
  extracts, solves and simulates items into the gitignored `bank-build/.cache/` started while the
  Red tests were being written. That work never reads or writes tests. Validation and assembly by
  `bank-build/build.js` run only after M1 (`bankValidate`, `parseAnswer`) is green, as spec §12 says.
- **The M2 cache is per chunk, not per source.** Each extraction agent handles one chunk of a source,
  so it writes `.cache/extract/<key>/<chunk>.json`, `.cache/resolve/<key>/<chunk>.json`
  (keyed by locator, because ids are computed at assembly) and `.cache/sim/<key>/<chunk>.json`
  instead of the single files per key and per id in §M7. `build.js` merges the chunk files.
  `bank-build/sim/items/` (the generated simulation scripts) was added to `.gitignore` during Red,
  when the first scripts appeared. `.test-staging/` follows in M0 (§M8).
- **Red gap consolidation ran twice.** Writers and reviewers reported 216 contract gaps. The first
  consolidator got a truncated list (gaps 0-113), so a second pass resolved the other 102 (market
  tail, readiness, readiness-buddy, practice, tooling, e2e) and the Red gate was re-run.
- **Red-phase reference implementations stay outside the repo.** Red reviewers wrote blind reference
  implementations in scratch (`/private/tmp/claude-501/v4-red/`) to check the tests. They are
  never copied into the repo or shown to implementers. After the hold-out phase has used them to
  check the hold-out tests, they are archived inside the hold-out folder (which rule H1 hides) and
  deleted from scratch.
- **Hold-out suite.** 120 unit tests in 5 files (rng+answer 28, srs+bank 32, oa 19, market 11,
  readiness 30; about 25% of the 452 repo unit tests), written by separate writers and checked by
  independent reviewers against several blind scratch references (each test passes on a reference
  that follows the contract; all fail red against the repo). The hold-out has no e2e or tooling
  part: e2e needs the repo's Playwright harness, and the tooling is fixed by the contract text.
  sha256 at lock time, so the user can check that no agent changed them (names only; the content
  stays outside the repo):
  - `ho-market.test.js` af33b77663f34f8aae71466ed1b1339638d7404c383e4a1245178affc73c3c82
  - `ho-oa.test.js` ee4ea8f3c94cccfee635b1cff98c168881bfa9a3802a81faa7af6b5eddfa631a
  - `ho-readiness.test.js` c7831f49f6a29db9802e74251e73d99647544c47e1960ab3117a14b23de834e6
  - `ho-rng-answer.test.js` 5b53710ef5859941f17fb216448a6ac282bf2f36729f8c35e73861ee931bcbbb
  - `ho-srs-bank.test.js` 27caa1071224047aa5a7ec90ff241bb30c8cf0d942d67c47c15e71c5b4bd3edf
- **Scratch references archived.** The Red and hold-out reviewers' reference implementations
  (and the contract-phase reference scripts) were moved into
  `holdout-tests/_archive/*.tgz` (hidden by rule H1; not `*.test.js`, so `test:holdout` ignores
  them) and deleted from `/private/tmp`.
- **The hook fails closed.** The settings command is the §M6 one followed by `|| exit 2`, so a crash
  of `guard-locked.js` (node exit 1, which Claude Code treats as "allow") denies the tool instead.
  This is the only deviation from the §M6 settings JSON.
- **Gatekeeper lock checks.** Deleting `tests/LOCK.json` would turn the hook's L rules off and make
  `lock:verify` report "pre-lock". So every milestone gatekeeper also checks that
  `tests/LOCK.json` exists, that `git rev-parse v4-red` still equals the sha recorded at lock
  time, and that `git status` is clean for every lockable root.

**Concurrent storage writes**

- **`practiceLog` is now written from three contexts:** the side panel, the Zetamac tab and
  prep.html. All of them re-read before writing, and prep.html now writes after every answered
  item (the session upsert). A collision still needs two writes in the same instant, which is the
  same trade-off v3 accepted for two writers.
- **`lcSolves` has two writers.** The no-AI answer is written by the side panel, which races with
  `content-lc.js` appending a new solve. The window is the time between the panel's re-read and
  its write, so it is small.
- **`prepDrill` has two writers.** The panel assigns and prep.html updates progress. prep.html only
  writes if the stored drill id still matches its session.

**Accepted gaps**

- **The side panel loads the whole bank and reads prep data per request.** It fetches `bank.json`
  and the decks on open, a few MB, and reads `prepHistory` (up to 20000 entries) and the other prep
  keys before every request. This adds some latency. In exchange there is one loader, no derived
  index in storage, and no stale cache.
- **Missing bank files log console errors.** Fetching `bank/bank.json` when it is missing rejects
  and logs `net::ERR_FILE_NOT_FOUND`. The loader catches it, and the e2e debug sweep already
  ignores `net::ERR`.
- **📚 and the overlay open prep.html without `?fixture=1`.** So e2e v4-14 checks only the tab
  count and focus, not the page content.
- **A correction changes the item id.** Ids hash the stored answer, so when an item is corrected
  between builds its SRS state resets, as for a reworded item (spec §3 F1.1).
- **Fixture coding scores are small.** The coding score divides by 150 literally (spec §8), so
  the 12-problem fixture list can contribute at most 4 points.
- **Mocks are logged only when the buddy calls `log_practice`,** exactly as in v3 (spec §2 "still
  writes `mock`"). A mock the buddy forgets to log is not counted.
- **The Sunday delta can drift after the history cap.** Replayed cards equal stored cards only
  while `prepHistory` holds every grade; past 20000 entries the oldest grades are dropped.
- **`C(n,k)` is exact only up to n = 54.** Larger values may be off by a few ulps. Answers are
  checked with a tolerance, so this does not affect marking.
- **The verdict regex has a quirk.** The spec's regex reads `"6/100"` as 6. It is kept verbatim
  rather than adding a look-ahead.
- **Ease is not rounded.** Floats drift slightly after many grades. The effect is cosmetic, and
  tests use a tolerance.
- **Maths needs protecting from markdown.** `marked` can mangle `\` and `_` inside `$...$`, so
  prep-ui must protect maths spans before markdown rendering. This is implementation detail, not
  contract.
- **OA timers rely on `Date.now()`** deltas plus `setInterval`, so Playwright's `page.clock` can
  drive them. Wall-clock jumps (sleep or wake) can end a run early. That is acceptable.
- **prep.html 404s scripts until their milestones land.** From M0 it carries the full §A5 tag
  list, so until M1, M4, M5 and M6 add their files, each load requests up to 8 missing scripts
  and logs `net::ERR_FILE_NOT_FOUND` for each (the e2e sweep ignores `net::ERR`). In exchange,
  later milestones only add files and never touch the tags.
- **KaTeX fonts in all three formats.** Chrome only fetches the woff2 files (about 0.3 MB). The
  woff and ttf files (about 0.9 MB) stay so the stock `katex.min.css` works unedited.
  `check:no-bank` exempts `vendor/`.

**M0 tooling**

- **The allowlist regexes have a hole.** Both regexes accept an unquoted `HOLDOUT_DIR=\S+` value
  and a double-quoted one, and the shell still interprets `;`, `$(…)` and backticks inside those.
  So `HOLDOUT_DIR=x;cat${IFS}<hold-out file>;true npm run test:holdout` matches
  `HOLDOUT_ALLOW_RE`, and `HOLDOUT_DIR="$(…)" npm test` matches `NPM_ALLOW_RE`. Both are allowed.
  `guard-locked.js` keeps the §M6 regexes verbatim, as the contract requires. Only the implementer
  prompts and the cheese audit cover this. A contract amendment would close it, for example
  `[^\s;&|<>()$\x60]+` for the unquoted value and no `$(` or backtick inside double quotes. (§M6)
- **The hook does not resolve symlinks.** `guardDecision` is pure, and the CLI passes the root as
  given. An edit through a symlinked path that leads into `tests/` (e.g. `/tmp/link/x`, where
  `/tmp/link` points to the repo's `tests/`) passes L1. `lock:verify` catches the result. (§M6)
- **`lock:restore` before M0 is committed would delete M0's own scripts.** §M4 deletes every file
  under `scripts/` that HEAD does not track. Until the orchestrator commits M0, that means the
  whole new `scripts/` directory. Run it only on a committed, verified HEAD, as §M1 says. (§M4)
- **`check:no-bank` passes outside git.** In a copy without `.git/` nothing is tracked, so there is
  nothing to check. The rule protects what git would commit. (§M3)

**M0 tooling review: residual risks the contract allows** (found by probing the hook CLI with
126 payloads and the lock with real git in throwaway clones; the implementation keeps the §M6
regexes and the §M4 steps as written)

- **Deleting `tests/LOCK.json` switches everything off.** This is the biggest gap.
  - The hook's `locked` is "LOCK.json exists", and `lock:verify` step 1 exits 0 ("pre-lock")
    without it.
  - Any unmatched delete therefore unlocks tests/ and makes `npm run check` pass:
    `find . -name LOCK.json -delete`, `git reset --hard v4-red-pre`, a script run by path, or code
    in `prep/*.js` run by `npm test`.
  - Until the contract changes, the gatekeeper must also check that `tests/LOCK.json` exists and
    that `git status --porcelain -- tests scripts` is empty.
  - Possible amendment: once tag `v4-red` exists, a missing LOCK.json fails verify, and the hook
    counts the tag (a file check of `.git/refs/tags/v4-red` or `packed-refs`) as locked. (§M4, §M6)
- **The hook fails open if its script breaks.** Claude Code blocks only on exit 2. If
  `scripts/guard-locked.js` is deleted or broken through any gap below, node exits 1 and every
  tool runs. Possible amendment: end the settings command with `|| exit 2`. (§M6)
- **L2 mention gaps.** MENTION_RE needs `/`, whitespace, a quote or the end after
  `tests`, `scripts` or `.claude`. These commands are allowed:
  - `cd tests;echo x > a.test.js` and `cd tests&&echo x>a.test.js`;
  - variables such as `T=tests; echo x > $T/a`;
  - split quotes such as `te""sts/` and globs such as `test?/` or `t*s/`;
  - in the main session, a `cd tests` in one Bash call followed by `echo x > a.test.js` in the
    next, because `cd` persists there.
- **L2 verb gaps.** WRITE_VERB_RE misses:
  - `git -C . checkout …` (the verb must follow `git` directly), `git switch`, `read-tree -u`,
    `checkout-index` and `update-ref`;
  - `find … -delete`, `ditto`, `tar -x -C tests`, `unzip`, `curl -o`, `ruby -e`, `nvim`, `code`,
    `rm -rf *` and `eval "$(… | base64 -d)"`;
  - `npm pkg set scripts.x=…`, `npm install` and `npm version`, which all write `package.json`;
  - `git apply` or `patch` when only the patch file names the paths, and scripts run by path
    (`node /tmp/w.js tests/a`).
- **Path aliases.** The hook is pure, so these spellings are not resolved and pass L1 and H1:
  - macOS firmlinks: `/System/Volumes/Data/Users/…`, and `/Volumes/Macintosh HD/…` (a symlink to
    `/`). For example, Read of
    `/System/Volumes/Data/Users/nbist/Documents/Quant Prep/holdout-tests/canary.txt` is allowed.
  - Symlinks made without naming a locked path, such as `ln -s "$PWD" /tmp/r` and then Write
    `/tmp/r/tests/x`.
  - Relative Grep or Glob paths when the session cwd is not the root (the hook resolves them
    against the root). (§M6)
- **Writers outside the matcher.**
  - `~/.claude/settings.json` (user level, not `<root>/.claude/`) can be written with Write, for
    example to set `disableAllHooks`.
  - MCP tools that read local files, and tools other than Bash that run shell commands, are not
    in the matcher.
  - `.git/` is open: hooks, config, refs. `git tag -f v4-red` can move the lock tag, and check
    (a) only reads its subject. The orchestrator should record `git rev-parse v4-red` when it
    locks and compare it at every gate. lock.js now ignores replace refs, fsmonitor and repo
    hooks.
- **The hold-out can leak without being named.**
  - `NODE_OPTIONS='--require /tmp/x.js' npm run test:holdout` is allowed by the hook. So is code
    in `prep/*.js`, which the hold-out tests load. Either can read the test file from inside the
    test process (`process.argv`, `require.main`) and copy it out.
  - `NODE_OPTIONS=--test-isolation=none` prints the tests' own console output.
  - §M5 passes the environment through, so `test-holdout.js` does not strip `NODE_OPTIONS`.
  - The allowlists' `HOLDOUT_DIR=` value gap (above) is the same kind of leak.
- **Code under test runs with full file access.** `npm test` runs implementation modules and
  `npm run e2e` runs `node_modules/playwright`. Either can rewrite tests, delete LOCK.json or
  monkeypatch `node:assert`. A static scan of `prep/*.js` for `require` calls other than the §A5
  ones, plus code review, are the only guards.
- **Ignored files under `tests/` pass the pre-lock check.** §M4 uses `--exclude-standard`, so a
  file ignored through `.git/info/exclude` gets locked. It is not committed, so a fresh clone
  fails verify. Such a file only adds tests, so it cannot weaken one.
