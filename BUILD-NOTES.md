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
  `decks` step takes `cpp` or `systems` as its second argument. (§M7) The argument handling is
  unchanged in M2; the steps themselves are described under "M2: bank:build pipeline" below.

**M1: prep/rng.js** (implementer choices, not marked in `V4-CONTRACTS.md`)

- Error types: `randInt` throws `TypeError` for a non-integer bound and `RangeError` for
  `lo > hi`; `pick` throws `RangeError` for an empty array; `pick` and `shuffle` throw `TypeError`
  for a non-array other than `null` / `undefined`. Each check runs before any draw, so a throwing
  call consumes nothing (the contract leaves this implementation-defined). (§A4, §B2)
- The `rng` argument is not type-checked: it is called as a function, so a non-function throws
  the engine's own `TypeError` on the first draw. (§B2)

**M1: prep/answer.js** (implementer choices, not marked in `V4-CONTRACTS.md`)

- Tokenize first, then parse and evaluate in one pass. So tokenizer errors (an unknown name, a
  character that is not allowed, a non-finite literal such as `1e400`) win over syntax and domain
  errors in the same input. The contract leaves the order for mixed problems open. (§C1)
- The IMUL rule is applied as written, to every NUMBER token. That includes the second number of
  an `nCk`: `"10C3pi"` = 120π, and `"10C(3,1)"` = 10·C(3,1) = 30 (`"10C(3)"` is still an error,
  because C(3) has no comma). (§C1)
- A literal that underflows (`"1e-400"`) is 0, and 0 is finite, so it is accepted. A divisor that
  underflows to 0 (`"1/(1e-300*1e-300)"`) is the `zero` error, because the rule is `b === 0`.
  (§C1)
- Only the parser's own error type becomes `{ ok: false, error }`. Any other exception is a bug,
  so it is re-thrown, not hidden. Error texts name the problem and repeat the value where that
  helps (`got 171`, `(-8)^0.333333 is not a finite real number`). (§A4, §C1)
- A non-string `parseAnswer` argument gives the error "The answer must be text" (no keyword). (§C1)
- A missing `item` or `item.answer` never throws. `checkNumeric` treats it as a broken item
  (`expected: null`, keyword `item`). `checkMcq` returns `expected: null` when `answer.correct`
  is missing, and an error when `answer.choices` is not an array. (§C2, §C3)
- `formatPreview` returns `""` for a non-number or non-finite value. `parseAnswer` never produces
  one. (§C4)

**M1: prep/srs.js** (implementer choices, not marked in `V4-CONTRACTS.md`)

- `schedule` checks the grade first (`TypeError`), then throws a `TypeError` for a `now` that is
  not a finite number, so a card with a `NaN` due is never stored. `nextIntervals` passes 0.
  (§A4, §D2)
- "Missing" card fields: a numeric field (`ease`, `interval`, `reps`, `lapses`) that is not a
  finite number (missing, `null`, a string, `NaN`) takes its `newCard()` value. `seen` follows
  `c.seen ?? now` exactly as written. A card that is not an object is `newCard()`. (§D2)
- Bank entries that are not objects, or whose `id` is not a string, are skipped by `buildQueue`,
  `drillQueue` and `dueCount`, since they cannot be queued or keyed by id. De-duplication compares
  exact id strings, first occurrence wins. (§D6, §D7, §D9)
- Cards are read as own properties only, so an id such as `constructor` never reads
  `Object.prototype`. `replayCards` builds in a `Map`, keyed by `String(itemId)` (object-key
  semantics), and returns `Object.fromEntries`, so `__proto__` stays an ordinary key. (§D6, §D9)
- A non-finite or missing `difficulty` sorts after every real difficulty, then bank order.
  (§D6, §D7)
- `buildQueue` reads `opts = null` as `{}`. `drillQueue` reads a non-object `drill` as `{}`; a
  `count` that is not a non-negative number gives `[]`, a fractional count is floored, and
  `Infinity` means no limit. (§D7)
- `replayCards` skips entries that are not objects or whose `ts` is not a finite number. `uptoTs`
  has no default, so an undefined `uptoTs` keeps nothing. (§D9)
- `masteryOf` reads a non-array `itemIds` as `[]` (so `null`). `dueCount` reads a non-array
  `areas` other than `undefined` as `[]`. A `bank` that is neither an array nor an object with an
  `items` array is `[]`. `answerOk` of a non-object entry is `false`. (§A3, §D4, §D9)
- `AREA_ORDER`, `GRADES`, `DEFAULT_SETTINGS` and `DEFAULT_SETTINGS.areas` are frozen.
  `normalizeSettings` always returns a fresh object and a fresh `areas` array, and turns `-0`
  into `0`. `drillQueue` and `dueCount` read `AREAS` from `PrepBank`. (§A6, §D5)
- The round-robin puts any area outside `AREA_ORDER` after the six known ones rather than dropping
  it. This cannot happen with today's `AREAS`. (§D8)
- `prep/srs.js` requires only `bank.js`. `localDayStart` covers every local-day need, so it does
  not read `amTodayKey`; in the browser `shared.js` still loads first (§A5 order). (§A5)

**M1: prep/bank.js, prep-loader.js** (implementer choices, not marked in `V4-CONTRACTS.md`)

- `bankValidate` runs the type-specific answer checks (`answer.value`, `answer.choices`,
  `answer.correct`) only for a known `type`. An unknown type gets the `type` error, and its
  `answer` is checked only for being an object and for `answer.tol`. The hash check is then
  skipped, as §E4 says. (§E4)
- mcq `answer.correct` is checked against `choices.length` whenever `choices` is an array, even
  an invalid one. When `choices` is not an array (so the upper bound is unknown) it only has to
  be an integer of at least 0, and the `answer.choices` error carries the item. (§E4)
- `bankValidate` does not report locators longer than 40 characters, which §E2 leaves
  implementation-defined. It checks nothing on `check.printed` / `check.resolved` for `agreed`
  and `unverified` items, and nothing on `check.note`. (§E2, §E4)
- If `PrepAnswer.parseAnswer` itself throws (a parser bug, not a parse error), `bankValidate`
  reports an `answer.value` error with the exception text, because `bankValidate` never throws.
  (§E4)
- Error order per item: the id format and duplicate errors, then the fields in schema order, then
  the key-part and hash errors. Only the hash-mismatch message contains the word "hash", and
  only the duplicate message contains "duplicate", so keyword matches cannot hit another id
  error. (§A4, §E4)
- The exported area, type, status, origin and method arrays are frozen. The regexes have no `g`
  or `y` flag, so `test` and `exec` keep no state. (§E2)
- `sha256Hex` makes a new `TextEncoder` per call, so the module has no state. A lone surrogate
  encodes as U+FFFD, the same as `node:crypto` with `"utf8"`. (§E3)
- `indexById`, `topicSet` and `sourceCounts` read anything that is not an array or an object with
  an `items` array as `[]`, as `PrepSrs` does for a `bank`. Entries that are not objects, or lack
  the field read (a non-empty string `id`, a `topics` array, a string `source.file`), are
  skipped; `topicSet` keeps only string topics. `indexById` and `sourceCounts` build a `Map` and
  return `Object.fromEntries`, so an id or file such as `__proto__` is an ordinary own key.
  (§A6, §E5)
- `allItems` throws a `TypeError` when `decks` is neither an array nor `null` / `undefined` (a
  call-site bug, such as passing one deck without brackets). A `bankJson` or deck without an
  `items` array adds nothing. Holes in an `items` array come through as `undefined`, as with
  spread. (§A4, §E5)
- `prepLoadBank` fetches `bank.json` first and the other four files in parallel only when it
  loaded, so a checkout without `bank/` logs one file-not-found error instead of five. Any
  argument, including `null`, is accepted (`fixture` is `!!(opts && opts.fixture)`), so it never
  rejects. A `bank.json` whose JSON is `null` counts as missing. (§E6)
- The M0 interim loader is gone from `prep-ui.js`. If `prep-loader.js` failed to load, the page
  treats the bank as missing (bank-missing screen, still `data-ready="1"`), and `prep:modules`
  lists `prepLoadBank`. (§E6, §J1)

**M3: prep/market.js** (implementer choices, not marked in `V4-CONTRACTS.md`)

- The width check allows for float noise. A quote is too wide only when
  `ask − bid > maxWidth + EV_EPS`, so a decimal quote whose float difference lands a few ulps over
  the maximum (e.g. `10.1 / 14.1` on dice) counts as exactly `maxWidth`. `bid < ask` stays
  strict. (§G3)
- `conditionalEV` throws on impossible input, not only on `m > n`: a `scenario` that is not an
  object, an unknown `kind`, an `n` that is not an integer of at least 0 (cards: at most 52), a
  `revealed` that is not an array (`null` / `undefined` read as `[]`), or a revealed unit that is
  not a die face 1–6, a card rank 1–13 (at most 4 of a rank) or a coin flip 0 / 1. With
  everything revealed it returns the revealed sum, so a full 52-card deck never divides 0 by 0.
  (§A4, §G4)
- `createGame`: "given" means not `null` / `undefined` (the `??` of the §G1 table) for `n`,
  `batch`, `values`, `bots`, `maxPos` and `maxWidth`. `maxPos` and `maxWidth` must be finite
  numbers (a string, `NaN` or `Infinity` throws, as the state must survive JSON). A non-integer
  `maxPos` is allowed and acts as its floor. `opts.batch` is ignored for dice and cards (their
  `batch` is `null`). `opts` of `null` reads as `{}`; any other non-object `opts` throws. (§G1)
- `-0` is stored as `0` wherever it could enter the state (an injected coin flip, a quote value
  such as `"-0"`), so the state always survives a JSON round trip. (§G1, §G3)
- `submitQuote` returns a state that shares no array or object with its input (`outcomes`,
  `revealed` and `history` are copied). The result's `fills` are copies of the new history fills,
  so changing one never changes the other, and `reveal` is a fresh array. A rejected quote
  consumes no draw. (§A3, §G3)
- Error texts: the finished-game error says "over"; the quote errors are "The <field> must be a
  number.", "The bid must be below the ask." and "The quote width … is above the maximum of …".
  No message contains another check's keyword, except that a number error names its field. (§A4,
  §G3)
- `validateQuote`, `submitQuote`, `settle`, `runEntry` and `goodQuoterLine` throw a `TypeError`
  for a `state` that is not an object with a known `kind`. `runEntry` also throws a `TypeError`
  when `ts` is not a finite number: it has no `Date.now()` default. (§A1, §A4, §G5)
- `settle` subtracts each informed term from 0, so `adverse` with no informed fills is `+0`.
  (§G5, §N6)

**M3: prep/oa.js** (implementer choices, not marked in `V4-CONTRACTS.md`)

- An unknown kind throws in every export that takes a kind (`defaultConfig`, `normalizeConfig`,
  `configError`, `isDefaultConfig`, `sameConfig`, `generate`, `scoreRun`, `personalBest`,
  `trend`). (§A4, §F6)
- `configError` returns the first problem it finds, checking ops, then the ranges (`addA`,
  `addB`, `mulA`, `mulB`), then division, then duration. Each message is a sentence the OA tab
  can show as it is. (§F2)
- The exported constants are frozen. `defaultConfig`, `normalizeConfig` and `generate` return
  fresh objects every time, and each question has its own `answer.tol` object. (§A3)
- Seq: a shuffle picks 7 families to get a second question, then all 15 are shuffled. On top of
  the two §F4 rejection rules, a draw is also rejected (a) when its own family's fit does not
  return the drawn parameters, which cannot happen inside the ranges but guarantees `q.params`
  lie in them, or (b) when its shown terms repeat an earlier question in the run. Every
  rejection counts toward the 100. (§F4)
- `seqFit` / `seqNext` return `null` for anything that is not an array of exactly 7 integers. An
  unknown id is checked first and throws. `-0` in a fit or a next term comes out as `0`. (§F4)
- EV: the two questions of a template use different parameters, namely the first two entries of
  a shuffled copy of that template's finite parameter grid. Prompts are plain English and give
  the ranks as A = 1 … K = 13. (§F5)
- EV values are exact integer counts with one division at the end, so `answer.value` is the
  correctly rounded value of the exact rational (`"10.6"`, not `"10.599999999999994"`). The
  dice-reroll DP is kept as `num / f^(j+1)`. cards-first-high enumerates the position of the
  first high card, counted over the `C(52, high)` sets of positions the high cards can occupy
  (Pascal's triangle by DP). (§F5)
- `scoreRun`: an entry that is not an object counts as skipped. A non-array `answers` other than
  `null` / `undefined` throws a `TypeError`. `config` has no default parameter, because
  `normalizeConfig` already reads `undefined` as the default. (§A3, §F7)
- `personalBest` / `trend` count only object entries whose `score` is a finite number, so a
  string score never matches. `trend` sorts a non-finite `ts` first, and equal `ts` values keep
  their array order. A non-array `runs` other than `null` / `undefined` throws. (§F7)
- `formatClock` shows a non-finite input (`NaN`, `±Infinity`) as `"0:00"`. (§F6)

**M2: bank:build pipeline** (`bank-build/build.js`, `bank-build/lib/*.js`; implementer choices,
not marked in `V4-CONTRACTS.md`)

- **Steps.** `ocr` runs `ocrmypdf --jobs <cpus-2>` on the scan only when
  `.cache/greenbook-ocr.pdf` is missing (after `brew install ocrmypdf` if the command is missing),
  then always checks that `pdftotext` yields more than 100 KiB (102,400 bytes) and rewrites
  `.cache/greenbook-ocr.txt`. `extract`, `resolve` and `decks` are agent steps, so they only print
  per source (or deck): chunks, item counts, skipped, statuses, missing resolve chunks, unresolved
  and orphan locators. They exit 1 on a malformed cache file: invalid JSON, or the wrong top-level
  shape (`items` not an array / object, an item that is not an object, an unknown resolve status
  or audit verdict). Other oddities (chunkId or sourceKey differing from the path, a chunk with no
  extract chunk) are warnings. `all` runs every step even after one fails and exits 1 if any did.
  The `[source]` argument filters `ocr`, `extract`, `resolve`, `sim` and `decks`; `assemble` and
  `report` always cover the whole bank and say so. (§M7)
- **Cache layout.** The per-chunk cache (§3 "The M2 cache is per chunk") is read as is. `sim` also
  writes `.cache/sim-run.json` (per script: status, time, exit code, error, counts) for the report.
  A sim entry that fails gets `ok: false` and a `note`. (§M7)
- **`sim`.** It re-runs every `bank-build/sim/items/<key>-<chunk>.py` with `python3 -I` (cwd the
  script's folder, 120 s timeout, `min(8, cpus/2)` at a time, `BANK_SIM_JOBS` overrides). The key
  is the name up to the first hyphen (keys have none). Output is the whole stdout as JSON, else
  the last line-initial `{` from which the rest parses; `NaN` / `Infinity` read as `null`. Each
  result is compared with the item's answer after merging (resolve, audit): `enum` must match
  exactly (relative 1e-9, absolute floor 1e-12), `mc` must be within 3 standard errors; an item
  with an explicit `answer.tol` also passes when `checkNumeric` accepts the estimate (an
  inherently approximate answer cannot match an exact enumeration). `mc` without a positive `se`
  counts only as an exact match. A script that crashes, times out or prints no JSON turns every
  result its chunk had into `ok: false`, so an old estimate never counts as a pass. The step exits
  1 on any conflict (the sim disagrees) or failure (no comparison possible, e.g. an answer that
  does not parse). Results for missing or non-numeric items are reported as orphans.
  (spec §10.3)
- **Merge (`assemble`).** Per extract item: a resolve entry with `drop: true`, a key in
  `.cache/dedup.json` `drop`, or an audit verdict `drop` removes it. `check.status` is the resolve
  status, or `unverified` when the item has no resolve entry. A `corrected` entry replaces
  `answer` / `solution` when it carries them; a replacement on an `agreed` / `disputed` entry is
  ignored with a warning. `check.printed` (corrected and disputed) is the resolve `printed`, else
  the extractor's `check.printed`, else the extracted answer text (`answerText`); for corrected
  items `check.resolved` is the resolve `resolved`, else the stored answer's text. A disputed
  item keeps the extracted answer and takes `resolved` from the resolve entry only. Agreed items
  carry only `status`, `method` and `note`. An audit `corrected` / `disputed` verdict is applied
  after the resolve entry the same way (a disputed verdict restores the extracted answer and
  solution unless it gives its own `answer`); `ok` changes nothing. `check.method` is
  `"blind+sim"` when the item's sim result (re-compared against the final answer) agrees, else
  `"blind"`, and absent on unverified items, so the acceptance check counts them. `check.note`
  comes from the resolve entry or the verdict. Cards keep the card checker's `check` (status,
  printed, resolved, method, note); dedup and audit apply to them too, keyed
  `<card source.key>/<locator>`. Ids are `makeId(<cache folder key>, locator, item)` for practice
  items and `makeId(source.key, locator, item)` for cards. Output items carry only the §E2 fields
  (no `locator`). (§E2, §E3, spec §10.3)
- **Order.** `bank.json`: sources by `sources.json` priority, then the source's PDF (in order of
  first appearance in its chunk files, chunk files in natural order), then `source.page`, then
  file order. For a one-file source that is exactly priority, page, file order; a multi-file
  source (Stat 110, the MIT folders) keeps each PDF's pages together instead of interleaving page 1
  of every PDF. Decks: chunk files in natural order, then file order. (§D6, §M7)
- **Build checks beyond `bankValidate`.** Each fails the build like a validator error: a locator
  that does not match `LOCATOR_RE`, is longer than 40 characters, or repeats within one source key
  (dedup and audit keys would be ambiguous); `source.key` differing from the cache folder; a
  practice item with a card area, or a card whose area is not its deck; the §E2 stored-answer rule
  (a corrected numeric / mcq item must store `check.resolved` as `answer.value` / the correct
  choice text, a disputed one `check.printed`); a cited file missing from the library plan or
  from `bank/library/` after copying; a malformed NeetCode list. Validation runs on the merged set
  and on each output file; each distinct error is printed once with id, field and message, then
  grouped by (source, field, kind). (§E2, §E4)
- **Failed builds write no bank.** On any validator or build-check error, `assemble` still copies
  the library and writes `lists/neetcode150.json` and `library/index.json`, but it does not write
  `bank.json` or the decks and removes older copies, so the UI never loads a stale or invalid bank
  next to a newer library and report ("Bank not built", spec §2). `report` recomputes the merge
  itself, so it works after a failed `assemble`. (spec §10.5)
- **File format.** `bank.json` and the decks are `{ version: 1, generated, items }` (decks also
  `deck`) with one item per line, so a diff or grep shows whole items. `generated` is the build
  time. `lists/neetcode150.json` is the library file unchanged, after checking `list`, `source`,
  `count === problems.length` and the `problem` / `slug` / `difficulty` / `leetcode_id` keys.
  (§E1)
- **Library.** `bank/library/` holds every PDF under the six §E1 folders of the resource library
  plus every other file an item cites (the Core Guidelines markdown), at the same relative path,
  so an entry's `file` is exactly its items' `source.file`. Copies use `COPYFILE_FICLONE` (an APFS
  clone, no extra disk space), an existing copy with the same size and a newer mtime is kept, and
  files no longer in the plan are removed. The OCR'd Green Book replaces the scan at the scan's
  path. Spec §10.5 says "renamed to the manifest slugs": `manifest.json` has no slug field, and
  `sources.json` `manifestSlug` is the file name without `.pdf` (or the course folder), so the
  §E1 rule (`file` equals `source.file`) means no file is renamed. (§E1, spec §10.5)
- **Library index.** Categories are the §E1 folders and labels, by the file's first path segment,
  in folder order; entries in natural path order. Title: the `manifest.json` entry whose
  `local_paths` lists the file or its folder (with `: <file name>` appended when the entry covers
  several files), else the `sources.json` title (with the file name for a glob source), else the
  most common `source.title` of the items citing it, else the file name. `key`: the source key with
  the most items citing the file (ties: plain `<` order); a file cited by several card keys (the
  agents gave some books more than one key) is listed with the others in the report. (§E1)
- **`report`.** Acceptance: 0 validator errors; at least 600 practice items; at least 300 cards;
  no practice source key over 40%; disputed items at most 5% of all items (practice and cards);
  every numeric item (practice and cards) carries `check.method`. A separate row covers the build
  checks above. `report` exits 1 when any row fails. (spec §10.6)

**M3: prep/readiness.js (§H1, §H5, §H10, §H11 helpers)** (implementer choices, not marked in
`V4-CONTRACTS.md`; M6 adds the rest of the module)

- **`mistakeTopics` (§H5) ships in M3.** The session summary's `summary-weakest` is defined as the
  top 3 topics of `mistakeTopics` (§J2), so M3 needs it. It lives in the module (the contract's
  single definition) rather than as a copy in `prep-ui.js`. `weakestTopics` and the other §H2-§H4,
  §H6-§H9 exports are still M6 work. (§H5, §J2)
- `mistakeTopics` counts a mistake once per distinct topic of its item (a topic listed twice on
  one item does not double it), and skips entries that are not objects or whose `itemId` is not a
  string. (§H5)
- `historyEntry` reads a non-object argument as `{}`; `upsertSessionEntry` replaces only the
  FIRST element with the same `ts`, `track` and `note`. (§H1, §H10)
- The "Check my reasoning" system text asks for a short critique (what is right, the first real
  mistake, the fixing step), forbids a grade, score or correct/incorrect verdict, and invites the
  model to say so if the reference answer looks wrong. (§H11)

**M3: prep.html Practice, Cards and Today settings** (`prep-ui.js`, `prep.html`, `prep.css`;
implementer choices, not marked in `V4-CONTRACTS.md`)

- **Sessions.** The queue is fixed at session start. A session is "active" from its start until
  its summary (or empty screen) shows, so the Practice tab auto-starts a new session when it is
  shown again after one ended; the summary also has a "Start a new session" button. Cards
  auto-starts only on its first show (§J2). An empty queue shows `[data-role=empty]` with the
  reason (nothing due, no area ticked, unknown `item=` id) and no summary. (§J2)
- **URL.** `item=` and `source=` open the Practice tab whatever `tab=` says, and `item=` wins if
  both are given. `mistake=` must be a decimal safe integer and counts only with `item=`. With no
  `prepMistakes` entry for that `(ts, itemId)` the note editor still shows (empty), and Save writes
  nothing and says the mistake is no longer in the journal. Every match of `(ts, itemId)` is
  updated. `seed=` is parsed once into `pageSeed()` for the OA and market tabs (M4, M5). (§J1)
- **Grade labels and cards.** Labels (auto-grade and the free grade buttons) come from the card
  read at session start, updated in memory after each answer. Each answer's write re-reads
  `prepHistory`, `prepCards` and `prepMistakes`, sets all three in ONE `storage.set` (the card is
  `schedule(stored card, grade, ts)`), then re-reads and upserts `practiceLog`. All prep.html
  writes run through one promise chain. The summary waits for the session's writes before it
  counts due-tomorrow. (§H1, §H10, §I, §J2)
- **Free items.** The working box becomes read-only at Reveal, so the stored working is what was
  written before seeing the answer. `data-answered` stays `"0"` until the grade click (the moment
  history is written). Ending a session on a revealed but ungraded item writes nothing for it. (§J2)
- **Broken items.** A numeric item whose stored answer does not parse shows a warning and a Skip
  button (`data-role="skip"`, an extra role); a submit shows `result[data-state=error]` and nothing
  is written. (§C2)
- **Results.** The result text says `Correct: <your value> matches <answer> = <value>` or `Wrong:
  you gave …; the answer is …` (mcq: the correct choice). A parse error's text is the parser's
  message plus "Nothing was recorded". The solution box shows the answer (with its value for an
  expression), the solution, and for corrected items a "the source printed X" line; the corrected
  note is shown only after answering, so it never gives the answer away. (§J2)
- **Markdown and maths.** Maths spans (`$$…$$`, and `$…$` whose opening `$` is followed by a
  non-space and whose closing `$` is preceded by a non-space and not followed by a digit) are cut
  out before `marked`, kept as private-use placeholders through DOMPurify, then rendered with
  `katex.render` (`throwOnError: false`). Code spans and fences are left alone. Links open in a new
  tab. mcq choices, the disputed banner and the answer line are plain text, so their text equals the
  stored strings. (spec §3 F1.4, §J2)
- **Keyboard.** Keys pressed on a focused button or link are left to the browser, so no key acts
  twice. After an auto answer focus moves to Next (Enter or Space there advances natively); the
  Enter that submits is `preventDefault`-ed so it cannot also click the newly focused Next. A
  numeric item focuses its input when shown; a free item focuses nothing, so Space reveals at
  once. Held keys (`repeat`) do not grade or advance. (§J2)
- **Check my reasoning.** `working` is the free text trimmed (whitespace only counts as none);
  `answer` is the numeric input exactly as submitted, the chosen choice text, or `""` for free
  items. The button is disabled while a request runs and can be run again after `done` or
  `error`. Only `delta.content` is shown (reasoning deltas are ignored). A stream still running
  when the item changes or the session ends is aborted and its result dropped. The no-key text
  reads "No OpenRouter API key yet …". Log events: `reasoning:start|done|failed|no-key`. (§J11)
- **Today.** The tab shows `#today-due` (all areas) and the settings form. A blank number field
  saves the default; a value `normalizeSettings` replaces is reported next to Save. The drill
  banner and `#drill-start` arrive with M7 (they need §H9). (§J3)

**M2: dedup pass (`.cache/dedup.json`)** (spec §10 is silent on what counts as a duplicate)

- **What counts.** Two practice items are duplicates when someone who has solved one has solved
  the other: the same setup, the same asked quantity and the same answer. Rewording, renamed
  variables, a relabelled story (coupons for die faces, balls for coins, one rank of card for
  another, hours for minutes) and a suggested method (a Bayes table, an outcome list) do not make
  items different. Different numbers do (100 floors against 102, 13/15/17 against 20/18/16, a
  general `n` against a fixed 100), as do sibling sub-parts of one exercise that share a stem, and
  two derivations of the same formula by different methods. Those near-duplicates stay in the bank.
- **Which one is kept.** The item from the higher-priority source (`sources.json` `priority`);
  within one source, the earlier item in `bank.json` order. The dropped item is keyed
  `<key>/<locator>` with the reason `duplicate of <kept id>`.
- **How candidates were found.** Every pair of practice items (scratch scripts, not committed):
  word 3-gram shingle Jaccard on normalised prompts (LaTeX commands, punctuation and numbers
  stripped) at least 0.5, or at least 0.3 with the same numeric answer value; then, because the
  agents paraphrased prompts and that pass found no cross-source pair at all, TF-IDF cosine on
  stemmed content words and number tokens, answer agreement (same non-trivial numeric value or
  answer text), each item's best match in its known-overlap source in the 0.3 to 0.5 cosine band,
  and an answer-plus-solution bigram pass. Every candidate pair was read and judged by hand.
- **Result (first pass, 1510 items).** 742 candidates from the shingle pass (all within one
  source, one real duplicate) plus about 2,500 pairs from the paraphrase passes; 28 confirmed
  drops, leaving 1482 practice items: Green Book kept against Winkler 5, Stat 110 5, MIT 18.05 3,
  MIT 6.041 2, Conroy 2, Jane Street 1, Blitzstein & Hwang 1, and within itself 1; Stat 110 kept
  against MIT 6.041 1, Conroy 1, Blitzstein & Hwang 1, and within itself 2; Blitzstein & Hwang kept
  against MIT 6.041 1; MIT 18.05 kept against MIT 6.041 1, and within itself 1. Only one Stat 110
  and Blitzstein & Hwang pair is a true duplicate: the two sources mostly use different exercises,
  or different parts of the same one.

**M4: prep.html OA tab** (`prep-ui.js`, `prep.css`; implementer choices, not marked in
`V4-CONTRACTS.md`)

- **Layout.** Three cards. Setup: `select#oa-kind` (arith first, so it is the default),
  `#oa-config` (shown only for arith), `#oa-neg-marking` (shown only for eighty), Start, and a
  line with the best and count of the stored runs that have this kind and config. Run: kind and
  seed, progress, `#oa-timer`, `#oa-question`, `#oa-input`, `#oa-feedback` and Quit. Results:
  `#oa-results`. Between runs the setup and the last results stay on screen. Start hides the
  results, and Run again starts the same kind and settings with a fresh `pageSeed()`. (§J1, §J4)
- **Arith config.** Checkboxes for the four ops, number inputs for the four ranges and the
  duration, filled with Zetamac's defaults, plus a "Zetamac defaults" reset button. A blank field
  is read as `NaN`, so `configError` reports it (`Number("")` would quietly make it 0). While
  `configError` returns an error, Start is disabled and the error text is shown as it is. Enter in
  a config input starts the run. The config is kept only for the life of the page (no new storage
  key), so a reload brings back the defaults. A line says whether the game counts as the default
  (zetamac) game. (§F2, §I, §J4)
- **During a run.** eighty, seq and ev give no right/wrong feedback per answer, as in a real OA;
  the results list the misses. A parse error keeps the typed text and shows the parser's message;
  the next edit clears it. A held Enter (`repeat`) is ignored, so it cannot skip several questions
  at once, and arith ignores Enter. An answer that arrives after time is up but before the next
  tick ends the run instead of counting, so the question on screen at time-up is never recorded.
  The refocus on blur runs in a 0 ms timeout (after the focus change), and only while the OA tab
  is shown. (§F7, §J4)
- **Leaving the tab does not pause a run.** The clock is wall-clock time. If time runs out while
  another tab is shown, the run finishes and is saved as usual, and coming back refocuses the
  input. Closing or reloading the page discards a running run, the same as Quit. (§F7, §J4)
- **The saved entry.** `ts` is the finish time (the time-up tick or the last answer), and
  `secs = min(timeLimitSecs, floor(elapsed))`. The page appends the run, re-reads `oaRuns`, then
  (default arith only) appends `zetamacEntry(run)` to a fresh read of `practiceLog`, capped at
  `PRACTICE_LOG_CAP`, all on the page's one write chain. `#oa-results` is shown only after the
  write, so `#oa-best` and `#oa-trend` already come from storage when it becomes visible. If the
  `oaRuns` write fails, the results still show, with `data-best=""` and an empty trend, and say the
  run was not saved. (§F7, §H10, §I, §J4)
- **Results.** A score line, then correct / wrong / "skipped or not reached" / time (arith shows
  score, time and seed), then notes on time up, negative marking, and whether an arith game went to
  the practice log. "New personal best" shows when the score beats the best stored before this run,
  or when it is the first run with these settings. The trend is a small SVG sparkline next to the
  numbers. Each `li.oa-missed` shows the prompt, `→ answer.value`, and "(you: X)" or "(skipped)".
  The number of questions not reached goes on a line under the list. arith has no missed list.
  (§J4, spec §5)
- **Logs.** `oa:start`, `oa:quit`, `oa:finish`, `oa:saved` and `oa:generate-failed`, and none per
  question, so a fast arith game does not flood `amLogs_prep`. (§A5, §I)

**M5: prep.html Market tab** (`prep-ui.js`, `prep.css`; implementer choices, not marked in
`V4-CONTRACTS.md`)

- **Layout.** Three cards. Setup: `select#mm-scenario`, a blurb and the rules (max width, the two
  bots, the ±10 limit), `#mm-start`, and a line with the count and last P&L and edge of the stored
  `mmRuns` games of that scenario. Settlement (`#mm-settlement`, shown after the last round, above
  the game so it is seen without scrolling). Game: scenario and seed, `#mm-round`, the scenario
  with its public `n` (and coin `batch`), `#mm-revealed`, position, cash and largest |position|,
  the quote form, `#mm-error`, the fill messages and `table#mm-rounds`. (§J5, spec §6 UI)
- **One game at a time, in memory only.** A game is `createGame(kind, pageSeed())` with no opts.
  `#mm-start` always starts a new game; while one is unfinished it reads "New game" and discards
  that game (logged as `mm:abandon`, nothing written). A reload discards it too: §I has no key for
  an unfinished game. Leaving the tab and coming back keeps the game. "Play again" on the
  settlement restarts the same scenario (with a URL `seed=`, the same game). (§I, §J1, §J5)
- **Quote inputs.** Plain text inputs (`inputmode="decimal"`); their raw strings go to
  `submitQuote`, so `validateQuote` alone decides what is a number. A rejected quote keeps the typed
  values and shows the error; an accepted one clears the three inputs and focuses the fair value,
  so each round's fair is typed fresh. Enter in any input submits once (a held Enter does not
  repeat). A live line under the form shows the typed width and mid against the maximum; it never
  blocks a submit. `#mm-error` is hidden only by an accepted quote or a new game, not by editing.
  (§G3, §J5)
- **Position-limit rejections are fills, not quote errors.** The quote is accepted and the round
  advances (§G3 step 5), so they are not shown in `#mm-error`, which an accepted quote hides (§J5).
  They show as `li.mm-fill[data-rejected="true"]` (struck through, "rejected, it would take you past
  ±10") plus a one-round notice under the form saying how many trades were rejected.
- **Fill messages.** One `li.mm-fill` per Fill of every round, in fill order, each with the round,
  the bot, what it did, the price and the position after it. When the informed bot passes, an
  `li.mm-pass` (not `.mm-fill`) says so, since a pass records no Fill. (§G3, §J5)
- **Round table.** Per played round: fair, bid / ask, E[V] at quote time (`publicEV`, 2
  decimals), fair error, the trades, the units the round revealed, and the position and cash after
  the round (summed from the accepted fills). Past E[V] values are shown during the game, as
  feedback on each fair value. (spec §6 UI)
- **Settlement.** `data-*` attributes are `String(number)` of the `settle` metrics. The card shows
  V with its units, P&L, edge, adverse, trades, largest |position| and mean fair error, the line
  `P&L = cash + position × V`, `#mm-good-quoter` (exactly `goodQuoterLine`), one line each on what
  edge, adverse and fair error mean, and the save status. Display numbers use a real minus sign
  and at most 12 significant digits (EVs and fair errors 2 decimals); the attributes are exact.
  (§G5, §J5)
- **The saved entry.** `runEntry(state, Date.now())` at settlement, appended to a fresh read of
  `mmRuns` on the page's one write chain. The settlement shows at once and its status line changes
  from "Saving…" to saved (or not saved) when the write finishes. (§I, §J5)
- **Logs.** `mm:start`, `mm:round` (one per accepted quote, at most 10 a game), `mm:quote-rejected`,
  `mm:settle`, `mm:saved` and `mm:abandon`. (§A5, §I)

**M6: prep/readiness.js (§H2-§H4, §H6-§H9)** (implementer choices, not marked in
`V4-CONTRACTS.md`)

- **Bad records.** List elements that are not objects are dropped from every list (`history`,
  `lcSolves`, `practiceLog`, `oaRuns`, `mmRuns`, mistakes, list problems, material items). A score
  field that is not a finite number (zetamac `amount`, oaRuns `score`, mmRuns `edge` / `trades`)
  counts as 0, and its entry still takes its slot in the "last N" window. A non-finite `ts` sorts
  as the oldest. Bank items without a string id are skipped when the bank is de-duplicated. (§H,
  §H3)
- **`nc150Progress`** matches string slugs only, and skips problems that are not objects, so
  `total` counts the problem records. (§H2)
- **Bad times throw** (§A4 programmer errors): `areaScoresAt` throws `TypeError` when `cutoffTs`
  is not a number or is NaN, and `prepWeeklyLine` when `inputs.now` is not finite. `Infinity` is
  allowed as a cutoff: it keeps every entry and verdict (cards are still replayed); `-Infinity`
  drops them all. (§H3, §H8)
- **Material.** A missing or non-finite `difficulty` sorts last, as in the §D6 queues; `n` is
  applied as `slice(0, n)`. In `interviewMaterialBlock` a missing prompt or answer prints as empty
  text. (§H6)
- **`prepSummaryLine`.** A `dueToday` that is not a finite number prints `0`, a score that is not
  a finite number prints `n/a`, and a `weakest` that is not an array prints `none`. (§H7)
- **`prepWeeklyLine`.** A window entry whose bank item has an area outside the six is not counted
  (`N` is the sum of the six counts), and the accuracy uses the same entries. (§H8)
- **`amDrillEntry`.** Checks run in the order area, count, topics (format, then the 10-topic cap,
  then bank membership), and each error names its keyword. `count` is `Number(args.count)` as the
  contract says, so `" 7 "` reads as 7 and `true` as 1. (§H9)
- **Drill helpers.** `drillAdvance` and `drillFinish` throw `TypeError` for a drill that is not an
  object, and return a done drill as the same object. `drillAdvance` finishes the drill when
  `done >= count`, and a missing `done` or `correct` counts as 0. `drillPromptLine` shows a finished
  drill while `now − doneTs <= 48h` (a `doneTs` later than `now` included), and gives `""` with no
  `doneTs`. (§H9)
- **`weakestTopics`** uses only the contract's lower bound `ts > now − 30·DAY`, so a mistake
  stamped after `now` still counts. (§H5)
- **Dependencies.** `amMedianMediumSecs` (practice.js) and `amTodayKey` (shared.js) are resolved
  at load time through `globalThis`, falling back to `require`, as §A5 shows. (§A5, §H3)

**M6: side panel no-AI prompt** (`sidepanel.js`, `sidepanel.html`; implementer choices, not
marked in `V4-CONTRACTS.md`)

- **"Newest" means the largest `ts`.** Among the records a change adds whose `noAI` is unknown,
  the prompt asks about the one with the largest `ts`; on a tie, the later one in the array. An
  added record whose `noAI` is already known never prompts, even if it is the newest. (§J8)
- **One question at a time.** A later change that adds an unknown solve replaces the prompt, and
  the earlier solve stays unknown. A change that adds nothing keeps the prompt, unless its record
  now has a known `noAI` (answered in another open panel) or is gone from `lcSolves`; then the
  prompt hides. (§J8)
- **The answer.** A click hides the prompt first (so a double click cannot write twice, and a
  solve added during the write keeps its own prompt), re-reads `lcSolves`, and replaces only the
  record whose `(slug, ts)` matches with a copy that has `noAI` set. If that record is gone, nothing
  is written and `noai:missing` is logged. Logs: `noai:prompt`, `noai:set`, `noai:missing`,
  `noai:set-failed`. (§I, §J8)
- **Listener timing.** The prompt's `storage.onChanged` listener is registered first thing in the
  panel's init, before its awaits, so a solve recorded while the panel is still loading prompts
  too. The v3 listener is unchanged. (§J8)
- **Look.** The prompt sits under the interview banner and reuses the `.plan-banner` and
  `.log-actions` styles, so `styles.css` is unchanged. It shows the problem title (or the slug)
  before `#noaiText`. (§J8)

**M7: opening Prep** (`background.js` `prepOpenTab`, `content-distraction.js`; implementer
choices, not marked in `V4-CONTRACTS.md`)

- **One request at a time.** `AM_OPEN_PREP` requests go through one promise chain in the
  background, so a double click (or the panel and the overlay at once) cannot both query before
  the first `tabs.create` lands: the first opens the tab, the rest focus it. (§J10)
- **What counts as the Prep tab.** A tab whose `url` OR `pendingUrl` starts with
  `chrome.runtime.getURL("prep.html")`, because a tab that is still loading reports its target only
  in `pendingUrl`. So a `prep.html?fixture=1` tab opened by hand is reused too. With several, the
  first in `chrome.tabs.query({})` order is focused. (§J10)
- **Failure.** If a tabs or windows call throws, the background logs `prep:open-failed` and answers
  `{ ok: false, error }`; `prep:open` is logged only after a successful open or focus. The overlay
  logs `distraction:open-prep-failed` when the message fails or the answer is not `ok`. (§J9,
  §J10)
- **Overlay button.** The LeetCode button gets the class `leetcode` and its lookup becomes
  `.go.leetcode`, as §J9 allows. `.go.prep` has its own colour. An orphaned content script (after
  an extension reload) disarms on click instead of messaging a dead context, as `evaluate` does.
  (§J9)

**M6: prep.html Dashboard and Library** (`prep-ui.js`, `prep.css`; implementer choices, not
marked in `V4-CONTRACTS.md`)

- **Freshness.** The Dashboard re-reads its keys (`prepCards`, `prepHistory`, `prepMistakes`,
  `lcSolves`, `practiceLog`, `oaRuns`, `mmRuns`, `state`) every time it is shown (§I). While it is
  the active tab, a `storage.onChanged` event for one of those keys re-renders it after 300 ms
  (debounced); for `state`, only a change to `memory.facts` counts. A render overtaken by a later
  one is dropped. A value of the wrong type (e.g. a non-array `prepHistory`) is passed to
  `areaScores` as missing. (§H3, §I)
- **Trend.** Each area shows its change over 7 days, `areaScores` now against
  `areaScoresAt(inputs, now − 7·DAY)`, worded as `+n` / `−n` / `no change in 7 days`, or
  `new this week` when the earlier score is `null` (the §H8 rule). Overall also gets a sparkline
  of the weekly overall scores over the last 8 weeks (cut-offs `now − k·7·DAY`, k = 7…1, then now)
  on a fixed 0–100 scale, starting at the first week with data, with the values printed beside it.
  (§H3, §H8)
- **Area tiles.** `.value` holds only the integer or `no data`; the label, a 0–100 bar, the trend
  and a one-line description of the formula sit outside it. A score under 60 also gets an
  `under 60` chip, so it is never shown by colour alone. `#overall-score` has a `.value` child too.
  (§J6)
- **NeetCode 150.** The line `Next: <a#nc150-next> · difficulty · pattern` hides with the link when
  `next` is `null` (all solved, or no list). The link opens LeetCode in a new tab; its text is
  `next.problem` (the slug if `problem` is missing). With no list the card says so. (§H2, §J6)
- **Mistakes journal.** Every entry of every topic is rendered (none capped), each an `<a>` that
  navigates the same tab to `prep.html?tab=practice&item=<id>&mistake=<ts>` (values through
  `encodeURIComponent`, `fixture=1` appended last). An entry shows the local date, the item's
  prompt (markdown + KaTeX, rendered once per item and cloned, clamped to two lines, links inside
  it unwrapped), what the user answered (an mcq index shows its choice text) and the note, if any.
  Mistakes for items not in the bank are not listed; a line counts them. (§H5, §J1, §J6)
- **Mocks.** All four modes are rendered; a mode with no verdicts has `data-scores=""` and says
  `no verdicts`. Each mode shows its scores with their days and the mean of the last 3 (1
  decimal). (§H4, §J6)
- **Library links.** `a.lib-open` is `${root}library/${encodeURI(file)}` with no `#page=`
  fragment, as §J7 states (`libraryHref` needs an item's page, so it stays on the Practice source
  line). It opens in a new tab. An entry's text is its `title` (the file name when there is none),
  with the file name below it. Entries without a string `file` are skipped; a category with no
  entries is still listed, with "No files.". (§E5, §J7)
- **Practise at count 0.** `button.lib-practice` stays enabled for a file no item cites (only
  styled quieter), because §J7 says it navigates; it opens the Practice tab's empty screen, which
  names the file. (§J1, §J7)
- **Library filter.** A text filter (title or file, case-insensitive) and an "Only sources with
  items" checkbox hide entries with the `hidden` attribute; every `.lib-entry` stays in the DOM.
  The Library is built once per page load (it reads no storage keys). (§J7)
- **Render errors.** If computing the Dashboard throws, the tab shows the error and logs
  `dashboard:render-failed`, so the page still reaches `data-ready`. Other logs:
  `dashboard:render`, `library:render`, `library:missing` (no `library/index.json`) and
  `library:practice`. (§A5, §J1)

**M7: prep.html buddy drills** (`prep-ui.js`, `prep.css`; implementer choices, not marked in
`V4-CONTRACTS.md`)

- **Banner.** `#drill-banner` holds exactly `drillBannerText(drill)`. `button#drill-start` and a
  progress line (`n of N done so far`, shown once `done > 0`) sit beside it in one card at the top
  of Today, and the card and the banner are both hidden unless `prepDrill.status === "pending"`.
  The Today render and the `storage.onChanged` listener both render it, and a change that lands
  while a Today read is in flight wins over that read. (§I, §J3)
- **Start.** `#drill-start` re-reads `prepDrill` and, if it is still pending, shows the Practice
  tab with the drill session, which replaces any Practice session (also one still starting). A
  drill that is no longer pending only refreshes the banner (`drill:start-skipped`). (§J3)
- **Queue.** `drillQueue(items, cards, now, { ...stored drill, topics: kept })`, where `kept` is
  the stored topics that are in `topicSet(items)` of the whole bank. The count is the stored
  `count` even when an earlier session already advanced the drill, so a resumed drill shows a fresh
  queue of `count` items. Once the drill is done, the rest of that session is ordinary practice and
  writes nothing to `prepDrill`. Dropped topics are named in the session title and logged
  (`drill:topics-dropped`). (§D7, §H9)
- **Progress.** After each answer's history write (in the same write step, after the practice-log
  upsert) the page re-reads `prepDrill` and writes `drillAdvance(stored, answerOk(entry), entry.ts)`,
  only while the stored drill has the session's id and is pending. (§H9, §I)
- **Finish.** Advancing past the last item with the drill still pending writes
  `drillFinish(stored, Date.now())` ("the queue ran out before count", including skipped broken
  items). An empty queue finishes it at session start. **End session leaves the drill pending**,
  because §H9 uses `drillFinish` only for a queue that runs out; the user can start it again from
  Today. (§H9)
- **Summary.** A drill session's summary adds one line: `drillPromptLine` (the line the buddy
  reads) when the drill is done, how far it got when it is still pending, or a note that a newer
  drill replaced it. Logs: `drill:start`, `drill:progress`, `drill:done` (with `how`:
  `progress`, `finish-early` or `finish-empty`). (§H9)

**M7: side panel Prep integration** (`sidepanel.js`, `sidepanel.html`; implementer choices, not
marked in `V4-CONTRACTS.md`)

- **The bank load is awaited, not raced.** Init starts `prepLoadBank` first thing (in parallel
  with the v3 init) and keeps its promise in `prepLoading`; the check-in, every request's prompt
  parts and `assign_drill` await it before reading `prepData`. So the first request after opening
  the panel already sees the bank, and the race §E6 tolerates does not happen. The load never
  rejects, so the wait is bounded by reading a few extension files. Logs: `prep:bank-loaded`,
  `prep:bank-missing`, `prep:bank-load-failed`. (§E6, §H7)
- **The Prep line is always in the prompt.** With no bank it still prints (item areas `n/a`,
  `due today 0`, `weakest: none`; coding, mental, oa, market and mocks still score from their own
  data), so the buddy always sees the same line shape. Storage values of the wrong type count as
  missing, as on the Dashboard. If computing the prep parts throws, the request goes out without
  them and `prep:prompt-failed` is logged; a failed Sunday line falls back to the v3 trigger text
  (`prep:weekly-failed`). (§H7, §H8)
- **Material placement.** The `## Material:` block follows the interviewer prompt's
  "Interview elapsed … Verdict key" line, so the v3 interviewer text stays first and intact. It is
  computed per request (§H7), so the interview's end request carries it too, and an item answered
  in Prep during the interview can change it. (§H6)
- **`assign_drill` errors.** A rejected entry returns `error: <amDrillEntry error>` and logs
  `drill:rejected`; a storage write failure returns an `error:` result and logs
  `drill:store-failed`. The chat shows the tool result in the usual 🧠 receipt. The log
  `drill:assigned` carries `id`, `area`, `topics`, `count` and whether the topics were checked
  against a bank. The tool and `topics` descriptions tell the model to use bank topics and that a
  new drill replaces the pending one. (§J8)
- **📚.** It is the first button in `.header-right` and is wired at the very start of init, so it
  works before init finishes. Its look (the same as 📥 and 🔄) comes from a small `<style>` block in
  `sidepanel.html`, so `styles.css` is unchanged. If the background does not answer `ok`, the chat
  shows an error note and `prep:open-request-failed` is logged. (§J8, §J10)
- **Behaviour text.** The system prompt's Behaviour section gains one sentence: quant prep lives
  in Prep (📚), its answers log themselves, and `assign_drill` sets targeted prep. (§9 F7)

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

**M2: bank:build pipeline**

- **`all` re-runs every simulation.** The 60 scripts take about 1 to 2 minutes in parallel on this
  Mac (the slowest about 55 s alone), so a full `npm run bank:build` costs that every time. In
  exchange no cached estimate is trusted without a re-run, and the estimates are seeded, so a
  re-run reproduces them exactly (the first re-run matched all 676 agent results bit for bit).
- **The library lists every PDF.** About 700 PDFs (all six folders, uncited ones included) are
  copied and indexed, so the Library tab is long. Clones cost no disk space on APFS; on another
  file system the first build copies about 450 MB (later builds skip up-to-date copies).
- **Multi-file titles are generic.** A file from a manifest entry that covers many files is titled
  `<entry title>: <file name>`, even when a card gives that file a nicer short title.
- **One key per library entry.** A file that several card keys cite (e.g. one book under three
  keys) gets the key with the most items. The Library tab counts items by `file`, so its count is
  still complete; only the `key` field names one of them.
- **A failed rebuild removes the old bank.** After a cache edit that breaks validation, the
  extension shows "Bank not built" until the cache is fixed, rather than loading the previous
  bank next to a library and report that no longer match it.
- **The §E2 stored-answer check also catches status misuse.** A card checker that marked a card
  `corrected` but changed only its solution ("answer unchanged") fails the build, because a
  corrected numeric or mcq card must store `check.resolved` as its answer. The cache data is the
  place to fix that (status `agreed` with a note, or a `resolved` equal to the answer), not the
  build.
- **Dedup is a reviewed judgment, not a rule the build applies.** `dedup.json` lists hand-checked
  drops; nothing recomputes it. A re-extracted chunk that renames a locator makes the old key
  match nothing (the build warns "matches no item") and lets the duplicate back in, and new
  chunks get no dedup until the pass is run again. Same-puzzle items with different numbers are
  kept on purpose, so a learner can still meet a familiar puzzle twice with new parameters.
- **M2 bank result (local build).** 1510 extracted practice items; a dedup pass removed 28
  cross-source duplicates (kept the higher-priority source), leaving 1482 practice items and
  432 cards (cpp 269, systems 163). 0 validator errors, 0 disputed, 102 corrected (13 practice,
  88 cards from the card checker, 1 from the audit), largest source 20.9%, every numeric item
  carries a method (707 blind+sim, 9 blind). Seven build-check and validator errors found at the
  first assemble were fixed in the cache data, never in the validator.
- **M2 QA audit (extra to spec §10).** A stratified sample of 174 items (about 10 per practice
  source plus cpp and systems cards) was re-solved by two blind solvers per batch and adjudicated
  against the source page. 1 item was corrected; no source crossed the 10% escalation threshold.
  11 of the 58 blind-solver calls returned no answer (API errors), so those batches were
  adjudicated against one blind solution instead of two.

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
- **The loader waits for `bank.json` before it fetches the rest.** That adds one local file
  read to every load of prep.html and the side panel (milliseconds for extension files). In
  exchange, the usual no-bank checkout logs one file-not-found error instead of five.
- **The pure-JS SHA-256 is slower than native code.** It hashes each item once per
  `bankValidate` (a few KB each, about 1000 items in the real bank), which stays well under a
  second. It is never on the per-answer path.

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

**M3: prep/market.js**

- **Every round copies the whole state.** `submitQuote` copies `outcomes` and every history
  record, so a game costs O(rounds²) small copies. At the drawn ranges a game has at most 10
  rounds (dice 10, cards 8, coins 8), so this is negligible. In exchange, an old state
  can never be changed through a newer one and can be replayed.
- **The width tolerance accepts a quote up to 1e-9 wider than `maxWidth`.** No user types prices
  that fine, and without it some decimal quotes at exactly the maximum width would be rejected.

**M3: prep/oa.js**

- **EV answers are recomputed on every `generate`, with no cache.** The largest enumeration is
  cards-max with `k = 3`, which walks 22,100 hands, so an ev run costs a few milliseconds. In
  exchange the module holds no state, and each value comes straight from its template's
  definition.
- **Every seq draw runs all 8 fits.** The primes fit scans up to 101 offsets. A run still takes
  well under a millisecond: the locked 20,000-seed sweep takes about 1 s, including the test's
  own oracle.

**M3: prep.html Practice and Cards**

- **An `again` item is not shown again in the same session.** The queue is fixed when the session
  starts (§D6 has no in-session relearning step), so a lapsed item returns in the next session once
  its 10 minutes are up. In exchange the session length and the summary are predictable.
- **Coming back to Practice after a finished session replaces its summary.** §J2 auto-starts a
  session whenever the tab is shown and none is active, and a finished session is not active. The
  summary is gone once you leave and return; Cards (which auto-starts only once) keeps it.
- **Labels can drift from storage if another tab grades the same item.** Grade labels use the card
  read at session start; the write itself re-reads the stored card, so storage stays right, but a
  second prep.html tab grading the same item mid-session can make a shown label stale.
- **Maths detection is heuristic.** `$…$` follows the usual markdown-maths rule, so prose such as
  `costs $5 and $10` stays text, but an unusual span (a `$` directly before a digit to close) is
  shown as plain text. Bank prompts use `$…$` consistently, and KaTeX errors render in place
  (`throwOnError: false`) instead of breaking the item.

**M4: prep.html OA tab**

- **`oaRuns` has no cap.** §I gives none, and `personalBest` is all-time over every stored run, so
  a cap would change it. An entry is about 150 bytes (an arith entry a little more, because of its
  config), so thousands of runs take a few hundred KB under `unlimitedStorage`.
- **The arith box accepts expressions.** §J4 checks arith answers with `checkNumeric`, which parses
  expressions, so typing `6*86` for `6 × 86` also moves on. Accepting digits only would be
  stricter, but it would no longer be `checkNumeric`. Typing the expression is slower than typing
  the number, so it gives no advantage.
- **The arith config is not remembered.** Keeping it would need a new storage key, which §I does
  not list. So a custom game has to be set up again after a reload. The default game, which is
  the one the zetamac track logs, needs no setup.

**M5: prep.html Market tab**

- **`mmRuns` has no cap.** §I gives none, as for `oaRuns`. An entry is about 150 bytes, so
  thousands of games take a few hundred KB under `unlimitedStorage`.
- **An unfinished game is lost on reload.** Keeping it would need a storage key that §I does not
  list. A game is at most 10 rounds, so little is lost, and only settled games count anyway.
- **Past E[V] values are shown during the game.** They make the next E[V] easier to work out
  (the user can update the last one by the reveal), but they give feedback on every fair value
  while the reveal is fresh, which is the point of the drill. The live E[V] is never shown before
  the user quotes.

**M6: prep/readiness.js**

- **Scores are recomputed from scratch on every call, with no cache.** `areaScores` walks each
  list once and sorts its windows. `prepWeeklyLine` calls it twice and replays the whole history
  once (at most 20000 entries, a few milliseconds). In exchange the module holds no state, and the
  side panel always scores what is in storage at that moment (§H7 "Freshness").
- **A corrupted score field reads as 0 rather than dropping its entry.** This keeps each "last N"
  window literal (a bad record still takes its slot), at the cost that one corrupted game or run
  pulls its area down until newer entries push it out of the window. The app's own writers
  never store such fields.

**M6: side panel no-AI prompt**

- **The question lives only in the open panel.** It is not stored, so closing the panel, or a
  newer solve replacing the prompt, leaves that solve unknown for good (spec §8: no answer leaves
  `null`). A solve recorded while no panel is open never prompts. There is no way to answer
  later, which keeps the prompt to a single storage-change rule. Unknown counts as not no-AI in
  the coding score, so a missed question can only lower it.
- **Every open panel prompts.** With panels open in two windows, both ask. The first answer hides
  the other prompt through the storage change, so the record is written once in the usual case;
  two clicks in the same instant would both write, and the last one wins.

**M6: prep.html Dashboard and Library**

- **The trend replays the history seven times per render.** Each weekly point is an
  `areaScoresAt`, which replays `prepHistory` into cards. At the 20000-entry cap that is some tens
  of milliseconds per render (and per debounced storage change while the tab is shown). In
  exchange the trend needs no stored snapshots and agrees with the Sunday review's deltas.
- **A long mistakes journal is a long page.** §J6 renders every entry of every topic, and a
  mistake appears under each topic of its item, so 5000 mistakes on items with three topics are
  15000 rows. Rows are plain DOM and each prompt is rendered once per item and cloned, so this
  stays usable, but there is no paging or collapsing.
- **The Library is built once per page.** A `bank:build` while prep.html is open shows up after a
  reload, like every other bank change.
- **Library PDFs open with no page.** §J7 links each file without `#page=`, so the viewer opens
  at page 1. The page-accurate link is the source line of each Practice item (`libraryHref`).

**M7: opening Prep**

- **The distraction tab keeps its overlay after "Take me to Prep".** Unlike the LeetCode and
  Zetamac buttons, which navigate the tab away, Prep opens (or focuses) a separate extension tab,
  so the distraction site stays behind the overlay until the day is done or the user snoozes. The
  user lands in Prep either way, and nothing about the distraction site is unblocked.
- **A hand-opened `prep.html?fixture=1` tab is reused.** The match is a URL prefix, as §J10 says,
  so 📚 can focus a fixture tab instead of opening the real bank. Only a developer opens that URL.

**M7: prep.html buddy drills**

- **A resumed drill does not continue where it stopped.** A drill left pending by End session (or
  a closed tab) keeps its `done` and `correct`, but starting it again builds a fresh `drillQueue`
  of `count` items, so the drill completes partway through that session and the remaining items
  count only as practice. Slicing the queue to `count - done` would end sooner but would no longer
  be the §H9 queue of the stored drill.
- **End session does not close the drill.** The drill stays pending (and on the Today banner and
  in the buddy's prompt) until it is finished from Today or replaced by a new `assign_drill`.

**M7: side panel Prep integration**

- **The first request waits for the bank.** Requests await the init bank load, so the first
  message after opening the panel can wait for the bank fetch (a few MB of extension files, tens
  of milliseconds). Not waiting would send that request without item scores, topic checks or
  material.
- **The bank is loaded once per panel.** Each open panel holds its own copy in memory, and a
  `bank:build` while the panel is open shows up only after the panel is reopened (the prep keys,
  in contrast, are read fresh on every request).
- **Interview material can change mid-interview.** It is recomputed on every request (§H7), so
  an item answered in Prep during a mock can drop out of the list. The interviewer always quizzes
  the current weakest items, at the cost of a list that is not fixed for the whole mock.
