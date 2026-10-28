# Accountability Machine

Chrome side-panel AI companion for the LeetCode grind, powered by OpenRouter
(default model: `z-ai/glm-5.2`). It tracks a daily streak, syncs your real LeetCode
stats, sees the problem you have open (hints only, never solutions), notices when
you're on YouTube instead — and maintains **its own memory of you** via tool calls.

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

Everything lives in `chrome.storage.local` — inspect or wipe it via the 🧠 Memory
section in the panel.

## The plan (seeded, AI-maintained from there)

1. **Phase 1 (current):** LeetCode's official DSA crash course — every module, honestly.
2. **Phase 2:** NeetCode 150 in Python, ~15 problems/week, re-solving misses 2–3 days later.
3. One timed mock interview per week from Phase 2 week 3.
4. Hard deadline: OA-ready by mid-September 2026 (new-grad applications open).

House rules the buddy enforces: no AI while solving, explain every solution back with
its complexity, re-solve struggles from scratch days later.

## Ideas for later (only after the streak is real)

- Detect an Accepted submission on leetcode.com and auto-mark the day done
- HabitLab-style intervention overlay on distraction sites during study hours
- Daily `chrome.alarms` nudge if the target isn't done by 8pm
