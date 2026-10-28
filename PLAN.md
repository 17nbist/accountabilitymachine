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

## Later / maybe
- [ ] Auto-detect the problem *opened* (not just solved) to pre-warm interviewer context
- [ ] Weekly summary email/notification (solves, streak, queue debt) — Sunday retrospective
- [ ] "Defend your CV" mode — same interviewer machinery, pointed at ReviewBot/dcheck instead of DSA
- [ ] Export solve log as CSV for spreadsheet nerds
- [ ] chrome.storage.sync for multi-machine continuity (currently local-only by design)
