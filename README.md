# Accountability Machine

Chrome side-panel AI companion for interview prep, powered by OpenRouter
(default model: `anthropic/claude-haiku-5.5`, editable in Settings). It tracks a daily
LeetCode streak and solve times, captures Zetamac scores, logs probability / C++ /
project / mock practice, runs four kinds of mock interview, sees the problem you have
open (hints only, never solutions), notices when you're on YouTube instead — and
maintains **its own memory of you** via tool calls.

## Development

No build step and no dependencies. `npm test` runs the unit tests for the pure logic in
`practice.js` and `shared.js` (Node's built-in runner); `npm run check` syntax-checks
every script and the manifest. `npm run e2e` launches a real Chromium with the extension
loaded (Playwright, dev dependency) and drives it end to end: a real 30-second Zetamac game,
the LeetCode content script on a fixture served under the real origin, the chat tool loop
against a mocked OpenRouter stream, interview modes, Sunday review, overlay, and a sweep of
the extension's own logs. Set `AM_HEADED=1` to watch it; screenshots and log dumps land in
`e2e/out/`.

## Setup

1. Get an API key at [openrouter.ai/keys](https://openrouter.ai/settings/keys) and add
   a few dollars of credit.
2. Open `chrome://extensions`, enable **Developer mode** (top right), click
   **Load unpacked**, and select this folder.
3. Click the extension icon to open the side panel, expand ⚙️ Settings, paste your key.
   Model and LeetCode username are pre-wired but editable.

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

The AI has four tools it calls on its own, visible as 🧠 notes in the chat:

| Tool | What it does |
|------|--------------|
| `remember` / `forget` | Store/remove persistent facts about you (weak topics, schedule, milestones) |
| `update_plan` | Rewrite the training plan section of its own system prompt |
| `edit_self_notes` | Rewrite its private coaching-strategy notes |
| `log_practice` | Log a self-reported session on the probability / cpp / project / mock tracks |

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
