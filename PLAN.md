# Accountability Machine — Feature Plan

Goal: get Naman OA-ready by mid-September 2026 (new-grad applications open).
The extension is the enforcement tool, not the portfolio piece.

## Shipped

### v1.0–1.1 — Core
- [x] MV3 side panel: chat buddy on OpenRouter (default `z-ai/glm-5.2`), personality toggle (coach/drill)
- [x] Self-editing AI memory via tool calls: `remember` / `forget` / `update_plan` / `edit_self_notes`,
      inspectable + resettable in the 🧠 Memory panel
- [x] Daily goal, ✅ day marking, streak badge + 28-day grid
- [x] LeetCode stats sync 3 ways: profile-visit content script, 🔄 button, stale-check on panel open
      (all via LeetCode's own GraphQL — same endpoint their frontend uses)
- [x] Tab awareness: Socratic hints on problem pages, callouts on distraction sites (chat-only)

### v1.2 — Bug audit + detection core
- [x] All 16 findings from the adversarial bug-agent audit fixed (timezone day counter, foreign-profile
      adoption, SPA soft-nav, double-send, IME Enter, multi-window clobber, hidden API errors, etc.)
- [x] Auto-detect Accepted submissions via LeetCode's `data-e2e-locator="submission-result"` marker,
      deduped per problem per day
- [x] Re-solve queue: first solve schedules a from-scratch redo due +3 days, cleared by a re-solve ≥2 days
      later; surfaced in banner + AI context
- [x] Auto-✅: numeric target in the daily goal self-marks the day when detected solves reach it

### v1.3 — Observability
- [x] Ring-buffer logger in every context (panel / content / service worker), 600 entries each,
      console + storage; 📜 Logs viewer with merge, Copy JSON, Clear
- [x] Full instrumentation: navigations, sync decisions, detections + dedupe verdicts, chat lifecycle
      with latency, tool calls, auto-marks, settings changes (API key never logged), uncaught errors

## v2.0 — SHIPPED

### Phase C — pressure systems
- [x] **Deadline nudge** — `chrome.alarms` daily at a configurable hour (default 21:00, toggle +
      hour in Settings). If the day isn't ✅ by then, a system notification fires with detected-vs-target
      counts; clicking it opens the side panel. Service worker reschedules when the setting changes.
- [x] **Distraction overlay** — content script on YouTube/Reddit/X/Instagram/Twitch. If today isn't
      done, a dismissible full-screen overlay (shadow DOM) shows streak, target progress, and due
      re-solves, with "Take me to LeetCode" and a per-site 60-min dismiss cooldown. Auto-dismisses if
      the day gets marked done while open.

### Phase D — buddy upgrades
- [x] **Proactive daily check-in** — first panel-open each day, buddy speaks first (hidden synthetic
      trigger, once per day via `state.lastCheckin`).
- [x] **Streaming replies** — OpenRouter SSE; tokens render live, tool-call fragments accumulated by
      index across chunks (unit-tested against split data lines + fragmented args).
- [x] **Markdown rendering** — vendored `marked` + `DOMPurify` in `vendor/`; AI bubbles render
      code/lists/bold, user bubbles stay plain text.
- [x] **Mock interviewer mode** — 🎤/⏹ button; interviewer persona takes over the system prompt, picks
      from the re-solve queue or plan phase, forces approach + complexity before code, ends with a /10
      verdict persisted via `remember`. Live elapsed-time banner.
- [x] Icons generated (`icon16/48/128.png`), full logging on every new path.

Known trade-offs accepted in v2.0: tool-round preamble text isn't persisted to history (cosmetic);
overlay cooldown is per-site, not global; interviewer trusts detected solves but can't see your editor.

## Phase E — hijack LeetCode's built-in AI context (build LAST, v2.1)

LeetCode ships an in-editor AI ("Ask Leet" button + `ai-agent` tab + an **Agent** mode toggle,
all confirmed in the page DOM). That assistant has privileged, tool-backed context: your current
editor code, which test cases failed and their actual vs expected output, and the full problem.
Goal: get that same rich context into OUR buddy so it coaches on your real attempt, not a guess.

Two layers, most-robust first:

1. **Context harvest (the reliable win).** — SHIPPED v2.1. Content script scrapes the same context
   LeetCode's AI reads, straight from the page — no private API needed:
   - [x] Editor code: defensive `localStorage` scan (prefer slug keys, accept raw or JSON-nested code,
         longest wins) with a Monaco `.view-lines` DOM fallback; logs which source hit.
   - [x] Failed tests: walk up from `console-result`/`submission-result` to the result block, grab its
         text (verdict + input + your-output + expected).
   - [x] Problem: title (`.text-title-large a`), difficulty (`[class*=text-difficulty-]`), prompt
         (`[data-track-load="description_content"]`).
   - [x] Stored as `lcProblemContext`, injected into the system prompt; 📥 button pulls on demand,
         and an accepted solve auto-harvests. Fully logged under component `hijack`.

2. **Endpoint hijack (stretch, needs a capture).** Reuse LeetCode's *own* AI backend by replaying its
   authenticated request from the content script (same-origin, carries the session cookie). CANNOT be
   built from a static snapshot — the endpoint/payload/tool schema only appear in live network traffic.
   Requires a HAR capture of one "Ask Leet" interaction (DevTools → Network → export HAR). Until then
   this stays a documented stub. If the request shape drifts or is CSRF/nonce-gated, layer 1 still works.

Both layers are fully error-logged via the v1.3 logger (`ctx: content`, component `hijack`): every
harvest attempt, which selectors/localStorage keys hit or missed, and any replay failure. Silent
scrape failure is the main risk — the logs must make it obvious when LeetCode changes its DOM.

## v3.0 — SHIPPED (multi-track interview prep, Nov 2026)

Target moved to the July 2027 application window (2028 new-grad SWE + quant dev + trader
OAs). Everything reuses the existing machinery; the only new site integration is Zetamac.

- [x] PROFILE / DEFAULT_PLAN refreshed (Year 3 MSci, Barclays summer 2027, dated checkpoints to
      Sep 2027). One-time migration swaps plan + model only if they are still the untouched v2
      defaults; "Reset plan to v3 default" button covers edited plans.
- [x] Default model → `anthropic/claude-haiku-5.5` (above GLM-5.3 on the Artificial Analysis
      index at ~1/10 of GLM-5.2's routed price; `z-ai/glm-5.3` is the same-price in-family option).
- [x] Practice tracks: `practiceLog` + six fixed tracks + `log_practice` tool; "Today: …" line in
      banner and prompt. LeetCode target still the only streak gate.
- [x] Zetamac auto-capture (`content-zetamac.js`): triggers on the input being disabled at zero
      seconds, reads "Score: N" from the end banner, logs hits/misses under component `zetamac`.
      Overlay gets "Take me to Zetamac". Prompt gets last 7 scores + best.
- [x] Solve times: `firstSeen[slug]` → `secs` (3 h cap) + difficulty on each solve; prompt gets the
      median Medium time over the last 10.
- [x] Interviewer modes: DSA / Quant dev / Defend CV / Trader selector beside 🎤, prompts in
      `practice.js`, verdicts under `interview_<mode>_YYYYMMDD`.
- [x] Sunday review: weekly trigger replaces the daily check-in on Sundays, graded against the
      next dated checkpoint; buddy may call `update_plan`.
- [x] Test harness: `npm test` (Node built-in runner, zero deps) over the pure logic in
      `practice.js`; `npm run check` syntax-checks everything.

Known trade-offs: `practiceLog` is read-modify-write from two contexts (panel tool + Zetamac tab);
both re-read before appending, so a collision needs a chat tool call in the same instant a game
ends. `e2e/run.js` (`npm run e2e`) exercises everything in a real Chromium, including a real Zetamac game;
leetcode.com itself answers 403 to headless Chromium, so the LeetCode content script is tested on a
fixture served under the real origin. The log ring buffer is per-context and read-modify-write, so
two panels open at once (two windows) can drop each other's log entries — cosmetic, logs only.

## v4.0 — quant prep (Nov 2026)

Covers the quant-dev and trader side of the July 2027 window: probability and brainteasers, C++
and systems, mental maths, OA tests, market making. Spec in `SPEC-v4.md`, interfaces in
`V4-CONTRACTS.md`, decisions / violations / trade-offs in `BUILD-NOTES.md`, test disputes in
`TEST-DISPUTES.md`.

- [x] **Prep page** — `prep.html` + `prep.css` + `prep-ui.js`, a full-page tab opened (or focused)
      by 📚 in the side panel header or "Take me to Prep" on the overlay. Seven tabs:
  - **Today:** new items per day, review cap and areas, plus the buddy's drill banner.
  - **Practice:** bank items on SM-2, KaTeX maths, source links to the PDF page. Numeric and mcq
    answers are auto-checked; free response is self-graded Again/Hard/Good/Easy. Disputed items
    get a banner, and "Check my reasoning" streams a critique from the configured model.
  - **Cards:** C++ and systems decks on the same scheduler, with topic filters.
  - **OA:** seeded timed simulators: `arith` (Zetamac clone), `eighty` (80 in 8 min), `seq`
    (next term) and `ev` (expected-value quickfire).
  - **Market:** a seeded market-making game (dice / cards / coins) against noise and informed bots.
  - **Dashboard:** readiness scores 0-100 for 8 areas, NeetCode 150 by pattern, mistakes journal,
    next checkpoint, mock verdicts.
  - **Library:** the local PDFs.
- [x] **Pure modules** in `prep/`. There is no `chrome.*`, DOM, clock or `Math.random`, each file has
      one `var Prep*` global plus `module.exports` (the `practice.js` pattern), and all are
      Node-tested. The modules: `rng` (mulberry32), `answer` (expression parser + tolerance checks),
      `bank` (schema, validator, content-hash ids), `srs` (SM-2 + round-robin queue), `oa`,
      `market`, `readiness` (area scores, NC150, mistakes, the prompt line, interview material,
      drills). `prep-loader.js` loads the bank for both pages.
- [x] **Content pipeline** — `bank-build/` → gitignored `bank/` (`npm run bank:build`). It OCRs the
      Green Book scan. Claude Code subagents extract items per source, a blind agent re-solves
      each one, a third adjudicates any disagreement, and Monte Carlo / enumeration scripts
      (`python3 -I`) check numeric answers. Agents write the C++ / systems cards and a blind checker
      reviews them. The build then assembles everything, fails on any `bankValidate` error, and
      writes `bank/REPORT.md`. Local build: 1482 practice items, 432 cards, 0 disputed, largest
      source 20.9%.
- [x] **Buddy integration** — a `Prep: overall NN · prob NN · …` line in the system prompt and an
      `assign_drill` tool. Each Accepted solve gets a "Solved without AI?" prompt
      (`lcSolves[*].noAI`). Quantdev / trader mocks quiz the 3 weakest bank items, and the Sunday
      review adds the week's prep totals and area-score changes. Prep writes to the existing six
      `practiceLog` tracks and adds no new ones. The streak gate is unchanged.
- [x] **Storage** — new keys `prepCards`, `prepHistory`, `prepMistakes`, `oaRuns`, `mmRuns`,
      `prepSettings`, `prepDrill`, `amLogs_prep`, plus the `unlimitedStorage` permission; version 4.0.0.
- [x] **Test-first protocol (spec §11):**
  - **Red:** writers who saw only the spec and contracts wrote failing tests
    (`tests/v4-*.test.js`, `e2e/v4.js` against `prep.html?fixture=1`) and the synthetic fixture
    bank `tests/fixtures/bank-mini/`.
  - **Hold-out:** a second, hidden suite lives outside the repo.
  - **Lock:** `tests/`, `scripts/`, `e2e/v4.js`, `e2e/run.js` and `package.json` are locked by
    sha256 in `tests/LOCK.json` (tag `v4-red`). A Claude Code hook denies edits to them, and
    `lock:verify` runs in `npm run check`.
  - **Disputes:** an implementer who thinks a test is wrong files it in `TEST-DISPUTES.md`, and a
    judge who has never seen the implementation rules on it.
- [x] Milestones M0 tooling · M1 rng/answer/srs/bank · M2 content pipeline · M3 Practice + Cards ·
      M4 OA · M5 Market · M6 readiness, Dashboard, Library, no-AI prompt · M7 buddy + interviewer
      material. M8 covers the hold-out run, the cheese audit, the 90% coverage gate and these docs.

Where things live: UI in `prep.html` / `prep.css` / `prep-ui.js`, logic in `prep/*.js`, the
pipeline in `bank-build/` (sources in `sources.json`, steps in `build.js`, helpers in `lib/`), KaTeX
in `vendor/katex/`, and tooling (lock, hook guard, no-bank check, hold-out runner) in `scripts/`.
`bank/` and `bank-build/.cache/` are local only and never committed.

Known trade-offs (full list in `BUILD-NOTES.md` §3):
- A fresh clone has no bank. The agent cache and the PDFs both come from copyrighted books, so
  neither is in git, and a new machine needs the resource library plus that cache.
- A failed rebuild removes the old bank, so Prep says "Bank not built" until the cache is fixed.
- Item ids hash the content, so an item corrected between builds loses its SRS state.
- The lock hook matches patterns and is not a sandbox. `lock:verify` and the git history checks
  catch whatever it misses.

## Later / maybe
- [ ] Auto-detect the problem *opened* (not just solved) to pre-warm interviewer context
- [ ] Make non-LeetCode tracks gate the streak if the LeetCode-only gate gets too easy
- [ ] Export solve log as CSV for spreadsheet nerds
- [ ] chrome.storage.sync for multi-machine continuity (currently local-only by design)
