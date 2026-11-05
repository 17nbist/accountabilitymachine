# Accountability Machine

Chrome side-panel AI companion for interview prep, powered by OpenRouter
(default model: `anthropic/claude-haiku-5.5`, editable in Settings). It tracks a daily
LeetCode streak and solve times, captures Zetamac scores, logs probability / C++ /
project / mock practice, runs four kinds of mock interview, sees the problem you have
open (hints only, never solutions), notices when you're on YouTube instead — and
maintains **its own memory of you** via tool calls. v4 adds **Prep** (📚), a full-page
quant-prep trainer: a probability and brainteaser bank on spaced repetition, C++ and systems
cards, OA simulators, a market-making game and a readiness dashboard.

## Development

The extension has no build step and no runtime dependencies. The Prep bank is built separately
(see [Building the bank](#building-the-bank-local-only)).

| Command | What it does |
|---------|--------------|
| `npm test` | Unit tests (Node's built-in runner): the v3 logic in `practice.js` / `shared.js`, the v4 pure modules in `prep/`, the fixture bank and the tooling |
| `npm run test:holdout` | Runs the hidden hold-out suite from `~/Documents/Quant Prep/holdout-tests` (outside the repo; `HOLDOUT_DIR` overrides). Prints only `ok` / `not ok` test names and the totals |
| `npm run e2e` | Real Chromium with the extension loaded (Playwright, dev dependency), driven end to end |
| `npm run test:coverage` | `npm test` with coverage; fails below 90% line coverage of `prep/*.js` (Node 24) |
| `npm run check` | Syntax-checks every script, parses the manifest and `package.json`, then runs `check:no-bank` and `lock:verify`; prints `check-ok` |

The e2e run covers a real 30-second Zetamac game, the LeetCode content script on a fixture
served under the real origin, the chat tool loop against a mocked OpenRouter stream, interview
modes, Sunday review, the overlay, every Prep tab on the synthetic fixture bank
(`prep.html?fixture=1`), and a sweep of the extension's own logs. Set `AM_HEADED=1` to watch
it. Screenshots and log dumps land in `e2e/out/`.

The tests were written before the v4 code and are locked. `tests/LOCK.json` and tag `v4-red`
pin `tests/`, `scripts/`, `e2e/v4.js`, `e2e/run.js` and `package.json`. `lock:verify` fails on
any change that did not go through a ruling in `TEST-DISPUTES.md` (process in `SPEC-v4.md` §11).

## Setup

1. Get an API key at [openrouter.ai/keys](https://openrouter.ai/settings/keys) and add
   a few dollars of credit.
2. Open `chrome://extensions`, enable **Developer mode** (top right), click
   **Load unpacked**, and select this folder.
3. Click the extension icon to open the side panel, expand ⚙️ Settings, paste your key.
   Model and LeetCode username are pre-wired but editable.
4. For Prep, [build the bank](#building-the-bank-local-only). Until you do, Prep shows "Bank
   not built".

## LeetCode stats sync (three ways, all automatic-ish)

- **Visit your profile** (`leetcode.com/u/adonno55`) — the content script pulls solved
  counts, rank, and your last 10 accepted submissions via LeetCode's own GraphQL API.
  Works on SPA soft-navigations too (a URL watcher, since LeetCode rarely full-reloads),
  and ignores other people's profiles.
- **Hit 🔄 in the panel header** — syncs on demand from anywhere.
- **Stale-check on open** — if stats are over an hour old when the panel opens, it
  re-syncs itself.

Stats land in the banner (Day N · solved counts) and in the AI's context, so it knows
exactly where you are without being told.

## Auto-detected solves, targets, and the re-solve queue

On any LeetCode problem page, the content script watches for LeetCode's own
`data-e2e-locator="submission-result"` marker flipping to **Accepted** and logs the
solve (deduped per problem per day). From that log:

- **Auto-progress** — put a number in your daily target (e.g. "2 mediums") and the day
  ✅-marks itself when the detected count hits it. The buddy trusts detected solves
  over self-reports.
- **Re-solve queue** — every first solve schedules a from-scratch redo 3 days later;
  it clears when you re-solve the problem at least 2 days after the first time. Due
  items show in the banner and the buddy holds you to them before new problems.

## Self-editing memory

The AI has these tools and calls them on its own. Each call shows as a 🧠 note in the chat:

| Tool | What it does |
|------|--------------|
| `remember` / `forget` | Store/remove persistent facts about you (weak topics, schedule, milestones) |
| `update_plan` | Rewrite the training plan section of its own system prompt |
| `edit_self_notes` | Rewrite its private coaching-strategy notes |
| `log_practice` | Log a self-reported session on the probability / cpp / project / mock tracks |
| `assign_drill` | Set a Prep drill (1-50 items from one area, optionally narrowed to topics); the result is reported back |

Everything lives in `chrome.storage.local` — inspect or wipe it via the 🧠 Memory
section in the panel.

## Practice tracks (v3)

One generic log, `practiceLog`, with six fixed tracks: `leetcode` (auto, from Accepted
verdicts), `zetamac` (auto, see below), `probability` (problems), `cpp` (minutes),
`project` (minutes), `mock` (count). The banner and the buddy's context carry a one-line
"Today: LC 1/2 · Zetamac 47 · Prob 0 · C++ 0m · Project 0m · Mock 0" summary. Only the
LeetCode target gates the streak; the other tracks are visible pressure.

- **Zetamac** — a content script on `arithmetic.zetamac.com` records the final score when
  a game ends (the input is disabled at zero seconds; the score is read from the end
  banner). The buddy sees the last 7 scores and the best. Use the "Take me to Zetamac"
  button on the distraction overlay.
- **Solve times** — each solve stores seconds from first opening the problem in that tab to
  the Accepted verdict (capped at 3 h) plus its difficulty. The buddy sees the median Medium
  time over the last 10, so "Medium in ~20 min" is measurable.
- **Mock interviews** — the selector beside 🎤 picks DSA, Quant dev (C++ / systems / a light
  probability question, verbal), Defend CV (dcheck, Deel write-back, ReviewBot, the startup
  prototype) or Trader (mental maths and expected value, rapid fire). Verdicts are stored
  under `interview_<mode>_YYYYMMDD`.
- **Sunday review** — on Sundays the first check-in becomes a weekly review: totals per
  track, streak, Zetamac trend, median solve time, re-solve debt and the next dated
  checkpoint; the buddy calls `update_plan` if the plan needs adjusting.

## Prep (v4)

Click **📚** in the side panel header to open Prep in a full tab. If Prep is already open,
it focuses that tab. The distraction overlay has a "Take me to Prep" button too. Prep shares
`chrome.storage.local` with the side panel. It has seven tabs:

- **Today** — new items per day, review cap and which areas to practise, plus the buddy's
  drill when it has assigned one.
- **Practice** — probability, brainteaser, statistics and finance items, one at a time, on an
  SM-2 spaced-repetition schedule. Maths renders with KaTeX, and the source line links to the
  PDF page. Numeric answers (with a live preview of the parsed value) and multiple-choice are
  auto-checked. Free-response items are revealed, then you self-grade Again / Hard / Good / Easy.
  Keys: 1-4 grade, Enter submits, Space reveals. Disputed items show a warning banner.
  "Check my reasoning" streams a critique from your configured model but never changes the
  grade. A summary ends each session.
- **Cards** — C++ and systems concept decks on the same scheduler, with topic filters.
- **OA** — four seeded, timed simulators: `arith` (Zetamac clone), `eighty` (Optiver-style,
  80 questions in 8 minutes), `seq` (next term in a sequence) and `ev` (expected-value
  quickfire). Each run ends with your score, best, trend and the questions you missed.
- **Market** — a market-making game. Each round you guess fair value and quote a two-sided
  market on a hidden dice, cards or coins total while noise and informed bots trade against
  you. At settlement you see P&L, edge, adverse selection and fair-value errors.
- **Dashboard** — readiness scores (0-100) for coding, probability, C++, systems, mental maths,
  OA, market and mocks. It also shows NeetCode 150 progress per pattern, the mistakes journal
  grouped by topic, the next checkpoint and which areas are under 60, and mock verdict scores.
- **Library** — the local PDFs, grouped by resource folder. Each one opens in Chrome's viewer,
  shows how many bank items cite it, and has a Practise button for those items.

Prep feeds the side panel too:

- The buddy's prompt gets a `Prep: overall NN · prob NN · cpp NN · sys NN · due today N ·
  weakest: …` line.
- After each detected Accepted solve, the panel asks "Solved without AI? Yes / No". The answer
  feeds the coding score, and the streak ignores it.
- Quant dev and Trader mocks quiz your three weakest bank items.
- The Sunday review adds the week's prep totals and how each area score has changed since
  last Sunday.
- Prep answers count toward the existing tracks: practice items add to `probability`, time on
  cards adds `cpp` minutes, and a default-config `arith` run logs `zetamac` with the note "in-app".

## Building the bank (local only)

Prep reads its content from `bank/`, which you build on your own machine:

```
npm run bank:build                          # every step: ocr extract resolve sim decks assemble report
npm run bank:build -- sim                   # one step
npm run bank:build -- extract greenbook     # one step, one source
npm run bank:build -- --help                # steps and source keys
```

It needs:

- the resource library at `~/Documents/Quant Prep/resources/` (`BANK_RESOURCES` overrides);
- `ocrmypdf`, to OCR the image-only Green Book scan (the build runs `brew install ocrmypdf` if it
  is missing), and `pdftotext` (`brew install poppler`);
- `python3` (standard library only) for the Monte Carlo / enumeration answer checks.

The scripts do not extract anything themselves. Extraction, the blind re-solves and the cards
are written by Claude Code subagents into `bank-build/.cache/`. The build handles OCR, re-runs
the simulations, merges, validates (any `bankValidate` error fails it), copies the library PDFs
(the OCR'd Green Book included) into `bank/library/`, and writes `bank/bank.json`, `bank/decks/`, `bank/lists/neetcode150.json`
and `bank/REPORT.md` (counts, acceptance checks, every corrected or disputed item). Reload Prep
when it finishes. To try the UI without a bank, open
`chrome-extension://<extension id>/prep.html?fixture=1`, which always loads the synthetic fixture
bank.

> **`bank/` is local only.** It holds copyrighted material: copies of the library PDFs and items
> taken from the books. It is gitignored along with `bank-build/.cache/` and
> `bank-build/sim/items/`, and must never be committed or pushed. `npm run check` (via
> `check:no-bank`) fails if git tracks anything under `bank/`, any PDF, or any file over 1 MB
> outside `vendor/` and `tests/fixtures/`. The repo holds only code, tests and the synthetic
> fixture bank in `tests/fixtures/bank-mini/`.

## The plan (seeded, AI-maintained from there)

Dated checkpoints to the July 2027 application window (2028 new-grad SWE at Databricks /
Stripe tier, quant dev at Optiver / IMC / G-Research / Maven / Qube, trader OAs as a bonus):

1. **Now → Feb 2027:** NeetCode 150 in Python, Zetamac daily, Green Book ch. 1-3.
   Checkpoint 28 Feb: ~100 solved, typical Medium in ~20 min.
2. **Feb → Apr 2027:** some Hards, C++ fundamentals, order book project.
   Checkpoint 30 Apr: order book with benchmarks on GitHub.
3. **May → Jun 2027:** weekly mocks, timed OAs. Checkpoint 30 Jun: Zetamac 50+, 5+ referral contacts.
4. **Jul → Sep 2027 (Barclays internship):** maintenance mode, 1 h weekdays + weekend blocks,
   apply in week one of each opening.

Existing installs keep the plan the buddy has been editing; "Reset plan to v3 default" in
the 🧠 Memory section swaps in the above.

House rules the buddy enforces: no AI while solving, explain every solution back with
its complexity, re-solve struggles from scratch days later.
