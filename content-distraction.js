// Runs on distraction sites (YouTube/Reddit/X/Instagram/Twitch). If today's LeetCode
// target isn't done, drops a dismissible full-screen overlay. Rendered in a shadow root
// so the host page's CSS can't fight it. Dismissal cools down per-host for 60 minutes.
// No fixed study hours — armed all day, only shows while the day is unmet.

const COOLDOWN_MS = 60 * 60 * 1000;
const host = location.hostname.replace(/^www\./, "");
let overlayEl = null;
let lastSkipReason = null;

// Returns { info } when the overlay should show, else { skip: <reason> } so the
// decision is auditable — "why didn't the overlay show" used to be undiagnosable.
async function shouldShow() {
  const { state, lcSolves, amDistractionCooldown } =
    await chrome.storage.local.get(["state", "lcSolves", "amDistractionCooldown"]);
  const key = amTodayKey();
  if (state?.history?.[key]) return { skip: "day-done" };
  const cd = amDistractionCooldown?.[host];
  if (cd && Date.now() < cd) return { skip: "cooldown" };

  const today = (lcSolves || []).filter(s => amTodayKey(new Date(s.ts)) === key);
  return {
    info: {
      streak: state?._streak ?? 0,
      goal: state?.dailyGoal || "",
      solvedToday: today.length,
      target: amGoalTarget(state?.dailyGoal),
      due: state?._dueTitles || [],
    },
  };
}

function buildOverlay(info) {
  const wrap = document.createElement("div");
  wrap.id = "am-distraction-overlay";
  const shadow = wrap.attachShadow({ mode: "open" });

  const targetLine = info.target
    ? `${info.solvedToday}/${info.target} solved today`
    : (info.goal ? `Target: ${info.goal}` : "No target set — set one and get moving.");
  const dueLine = info.due.length
    ? `<div class="due">Re-solves due: ${info.due.slice(0, 3).map(escapeHtml).join(", ")}</div>`
    : "";

  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      .backdrop {
        position: fixed; inset: 0; z-index: 2147483647;
        background: rgba(10, 12, 18, 0.96);
        display: flex; align-items: center; justify-content: center;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        color: #e2e5ec;
      }
      .card { max-width: 460px; text-align: center; padding: 32px; }
      .streak { font-size: 44px; font-weight: 700; margin-bottom: 8px; }
      h1 { font-size: 24px; margin: 0 0 12px; }
      p { color: #aab6d9; line-height: 1.5; margin: 6px 0; }
      .target { font-size: 18px; color: #e2e5ec; margin: 14px 0; font-weight: 600; }
      .due { font-size: 13px; color: #f0a3ad; margin-top: 10px; }
      .actions { margin-top: 24px; display: flex; gap: 10px; justify-content: center; }
      button {
        padding: 11px 18px; border-radius: 8px; border: none;
        font-size: 14px; font-weight: 600; cursor: pointer;
      }
      .go { background: #4c6ef5; color: #fff; }
      .go:hover { background: #5c7cff; }
      .snooze { background: #1c2030; color: #8b93a7; border: 1px solid #2b3145; }
      .snooze:hover { background: #262b3d; }
      .host { font-size: 12px; color: #5a627a; margin-top: 18px; }
    </style>
    <div class="backdrop">
      <div class="card">
        <div class="streak">🔥 ${info.streak}</div>
        <h1>Not yet. The offer won't grind itself.</h1>
        <p>You opened <strong>${escapeHtml(host)}</strong> before today's target was done.</p>
        <div class="target">${escapeHtml(targetLine)}</div>
        ${dueLine}
        <div class="actions">
          <button class="go">Take me to LeetCode</button>
          <button class="snooze">1 hour of weakness</button>
        </div>
        <div class="host">Accountability Machine · dismiss cools down for 1h on this site</div>
      </div>
    </div>
  `;

  shadow.querySelector(".go").addEventListener("click", () => {
    amLog("distraction", "go-to-leetcode", { host });
    window.location.href = "https://leetcode.com/problemset/";
  });
  shadow.querySelector(".snooze").addEventListener("click", async () => {
    const { amDistractionCooldown } = await chrome.storage.local.get("amDistractionCooldown");
    const cd = amDistractionCooldown || {};
    cd[host] = Date.now() + COOLDOWN_MS;
    await chrome.storage.local.set({ amDistractionCooldown: cd });
    amLog("distraction", "snoozed", { host, until: cd[host] });
    removeOverlay();
  });

  return wrap;
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = String(value);
  return div.innerHTML;
}

function removeOverlay() {
  if (overlayEl) { overlayEl.remove(); overlayEl = null; }
}

// An extension reload orphans this script in already-open tabs: chrome.* calls start
// throwing "Extension context invalidated" and the 30s timer would spam that error
// until the tab closes. Detect the dead context and shut down instead.
function orphaned() {
  return !chrome.runtime?.id;
}

function disarm() {
  clearInterval(evalTimer);
  removeOverlay();
}

async function evaluate() {
  if (orphaned()) { disarm(); return; }
  let verdict;
  try {
    verdict = await shouldShow();
  } catch (e) {
    if (orphaned()) { disarm(); return; }
    throw e;
  }
  const { info, skip } = verdict;
  if (skip !== lastSkipReason) {
    lastSkipReason = skip ?? null;
    if (skip) amLog("distraction", "skipped", { host, reason: skip });
  }
  if (info && !overlayEl) {
    overlayEl = buildOverlay(info);
    document.documentElement.appendChild(overlayEl);
    amLog("distraction", "shown", { host, streak: info.streak, target: info.target });
  } else if (!info && overlayEl) {
    removeOverlay();
    amLog("distraction", "auto-dismissed", { host });
  }
}

amLogInit("content");
amLog("distraction", "armed", { host });
evaluate();

// Re-evaluate if the day gets marked done / solves land / cooldown changes while open.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.state || changes.lcSolves || changes.amDistractionCooldown)) {
    evaluate();
  }
});

// SPA sites (YouTube) don't reload on navigation; re-check periodically.
const evalTimer = setInterval(evaluate, 30 * 1000);
