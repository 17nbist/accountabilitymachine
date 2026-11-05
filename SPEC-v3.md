# Accountability Machine v3: multi-track interview prep

Goal: keep the same extension, and widen it from "LeetCode streak" to the full prep plan for the
July 2027 application window (big-tech SWE, quant dev, quant trader online tests).
Rule for this version: reuse what exists (streak, auto-detect, re-solve queue, overlay, nudge,
interviewer, memory tools). No new backend, no new site integrations beyond one.

## What already covers the plan (no work needed)

| Need | Already shipped |
|---|---|
| Daily LeetCode habit | Daily goal, auto-detected Accepted solves, auto-✅, streak + 28-day grid |
| Spaced repetition | Re-solve queue (+3 days) |
| Distraction control | Overlay on YouTube/Reddit/X/Instagram/Twitch, 21:00 deadline nudge |
| Mock interviews | 🎤 interviewer mode with /10 verdict stored via `remember` |
| Coaching on the real attempt | Attempt harvest (code, failing tests, problem) + `read_attempt` |
| Adapting the plan | `update_plan`, `remember`, `edit_self_notes` |

## Changes

### 1. Refresh PROFILE and DEFAULT_PLAN (text only, `sidepanel.js`)
PROFILE is stale (says graduating June 2027, deadline Sept 2026). Replace with:
- Year 3 of a 4-year MSci CS & AI at Loughborough; leaving after Year 3 for an MSc (UCL/Imperial, 2027-28).
- Incoming Barclays Pre-Trade Markets Technology intern, summer 2027. Works at Fleet AI.
- Targets: 2028 new-grad offers at high-pay tech (Databricks/Stripe tier) and quant dev at
  mid/upper-mid trading firms (Optiver, IMC, G-Research, Maven, Qube); trader OAs as a bonus.
- Keep the three non-negotiable rules as they are.

New DEFAULT_PLAN, with dated checkpoints the buddy grades against:
- Now to Feb 2027: NeetCode 150 (Python), Zetamac daily, Green Book ch. 1-3.
  Checkpoint Feb: ~100 solved, typical medium in ~20 min.
- Feb to Apr 2027: some hards, C++ fundamentals, order book project.
  Checkpoint Apr: order book with benchmarks on GitHub.
- May to Jun 2027: weekly mocks, timed OAs. Checkpoint Jun: Zetamac 50+, 5+ referral contacts.
- Jul to Sep 2027 (during Barclays): maintenance mode, 1 h weekdays + weekend blocks,
  apply in week one of each opening.
Note: existing installs keep their stored plan, so ship a one-time "reset plan to v3 default" button
or let the buddy call `update_plan` on first v3 check-in.

### 2. Practice tracks (the main change)
One generic log instead of a feature per skill:
- Storage: `practiceLog: [{ ts, track, amount, unit, note }]` in `chrome.storage.local`.
- Tracks (fixed list, no config UI): `leetcode` (auto, existing `lcSolves`), `zetamac` (auto, see 3),
  `probability` (problems), `cpp` (minutes), `project` (minutes), `mock` (count).
- New AI tool `log_practice({ track, amount, note })`: the buddy logs self-reports from chat
  ("did 4 Green Book problems"). Same pattern as `remember`; show a 🧠 note when it fires.
- Banner + system prompt get a one-line "Today: LC 1/2 · Zetamac 47 · Prob 0 · C++ 0" summary.
- Day-done rule stays as it is (LeetCode target). Other tracks are visible pressure, not streak
  gates. Change that later only if the streak becomes too easy.

### 3. Zetamac auto-capture (only new site)
- Content script on `https://arithmetic.zetamac.com/*`: when a game ends, read the final score
  from the page and write a `zetamac` entry to `practiceLog`. Verify the end-of-game DOM on the
  live page first, and log selector hits and misses with the existing logger (component `zetamac`).
- Manifest: add the match + host permission. Add Zetamac to the overlay's "Take me to…" options.
- System prompt gets the last 7 scores and the best score, so the buddy can push 50 → 60.

### 4. Solve time on LeetCode (cheap, uses existing hooks)
- In `content-lc.js` `onPathChange`, record `firstSeen[slug]` for the day; in `recordSolve`,
  store `secs = acceptTs - firstSeen`. Cap it at 3 h so an open-overnight tab doesn't count.
- Prompt gets "median medium time, last 10" so the Feb checkpoint (~20 min) is measurable.

### 5. More interviewer modes (prompt constants only)
Turn the 🎤 button into a small selector over prompt variants; the same machinery and verdict
storage (`interview_<mode>_YYYYMMDD`):
- `dsa` (existing).
- `quantdev`: C++ (memory, move semantics, STL), systems (caches, concurrency, latency), one light
  probability or expected-value question. Verbal, no editor needed.
- `cv` ("Defend your CV", already on the Later list): deep-dive on dcheck, the Deel write-back,
  ReviewBot and the startup prototype; trade-offs, failure modes, what you'd change.
- `trader` (optional): mental-maths and expected-value rapid fire, timed out loud.

### 6. Sunday review (extends the existing daily check-in)
- In `maybeDailyCheckin`, on Sundays send a weekly-review trigger instead: week totals per track,
  streak, Zetamac trend, median solve time, re-solve debt, and progress against the next dated
  checkpoint. The buddy then calls `update_plan` if the plan needs adjusting.

## Out of scope (deliberately)
- Codeforces or contest integration (not doing competitions).
- An application or deadline tracker (that lives elsewhere).
- Calendar sync, multi-device sync, CSV export, and the Phase E endpoint hijack.
- Any new question bank: probability and C++ questions come from the model plus the Green Book.

## Build order
1 (text) → 2 (log + tool) → 3 (Zetamac) → 5 (modes) → 4 (timing) → 6 (Sunday review).
1-2 alone make the extension useful for the full plan; 3-6 are each small and independent.
