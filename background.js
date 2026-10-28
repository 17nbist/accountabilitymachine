importScripts("log.js", "shared.js");
amLogInit("bg");
amLog("sw", "startup");

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
  .then(() => amLog("sw", "panel-behavior-set"))
  .catch((e) => amLog("sw", "panel-behavior-failed", { error: String(e) }));

const NUDGE_ALARM = "am-daily-nudge";
const DEFAULT_NUDGE_HOUR = 21;

// Next occurrence of `hour:00` local time, as an epoch ms.
function nextNudgeTime(hour) {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, 0, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next.getTime();
}

// One-shot alarm, rescheduled after each firing. A fixed periodInMinutes:1440 keeps a
// UTC cadence, so after a DST change the "9pm" nudge silently became 8pm/10pm forever;
// recomputing from local time each day tracks the clock. Calls are serialized through
// a promise chain — on install the top-level run and onInstalled used to race the
// alarms.get guard and both created the alarm.
let nudgeChain = Promise.resolve();
function scheduleNudge(force) {
  nudgeChain = nudgeChain
    .then(() => scheduleNudgeNow(force))
    .catch((e) => amLog("nudge", "schedule-failed", { error: String(e).slice(0, 200) }));
  return nudgeChain;
}

// The service worker is ephemeral and re-runs the top-level schedule on every wake;
// skip re-creating an already-scheduled alarm (force=true when the user changes the
// setting, on install, and after a firing) to avoid resetting the timer.
async function scheduleNudgeNow(force) {
  const { state } = await chrome.storage.local.get("state");
  const hour = Number.isInteger(state?.nudgeHour) ? state.nudgeHour : DEFAULT_NUDGE_HOUR;
  if (state?.nudgeEnabled === false) {
    await chrome.alarms.clear(NUDGE_ALARM);
    amLog("nudge", "disabled");
    return;
  }
  if (!force) {
    const existing = await chrome.alarms.get(NUDGE_ALARM);
    if (existing) return;
  }
  const when = nextNudgeTime(hour);
  await chrome.alarms.create(NUDGE_ALARM, { when });
  amLog("nudge", "scheduled", { hour, when });
}

// ---------- Panel-independent day marking ----------

// The side panel auto-marks the day done when the solve target is met, but only while
// it's open — solves land in lcSolves from the content script regardless, so a day of
// panel-closed grinding used to stay unmarked and break the streak. Mirror the check
// here. Skip when the panel is open: it owns the `state` write then, and a concurrent
// read-modify-write from two contexts could clobber a chat save.
async function sidePanelIsOpen() {
  try {
    const ctxs = await chrome.runtime.getContexts({ contextTypes: ["SIDE_PANEL"] });
    return ctxs.length > 0;
  } catch (e) {
    return false; // getContexts missing (pre-116): mark from here, accept the tiny race
  }
}

async function bgAutoMarkIfTargetMet(trigger) {
  if (await sidePanelIsOpen()) return;
  const { state, lcSolves } = await chrome.storage.local.get(["state", "lcSolves"]);
  if (!state) return;
  const target = amGoalTarget(state.dailyGoal);
  if (!target) return;
  const key = amTodayKey();
  if (state.history?.[key]) return;
  const today = (lcSolves || []).filter((s) => amTodayKey(new Date(s.ts)) === key);
  if (today.length < target) return;
  state.history = { ...(state.history || {}), [key]: true };
  state._streak = amStreakFrom(state.history);
  state._rev = crypto.randomUUID(); // panel only merges external state when _rev moves
  await chrome.storage.local.set({ state });
  amLog("autoMark", "bg-target-met", { trigger, target, detected: today.length });
}

async function fireNudgeIfUnmet() {
  await bgAutoMarkIfTargetMet("nudge"); // never nudge over a target that's already met
  const { state, lcSolves } = await chrome.storage.local.get(["state", "lcSolves"]);
  const key = amTodayKey();
  if (state?.history?.[key]) {
    amLog("nudge", "skip-day-done", { day: key });
    return;
  }
  const today = (lcSolves || []).filter(s => amTodayKey(new Date(s.ts)) === key);
  const target = amGoalTarget(state?.dailyGoal);
  const targetStr = target ? ` (${today.length}/${target} solved)` : "";
  const streak = state?._streak ?? 0;

  chrome.notifications.create(`am-nudge-${Date.now()}`, {
    type: "basic",
    iconUrl: "icon128.png",
    title: "🔥 Streak on the line",
    message: `Today isn't done yet${targetStr}. ${streak > 0 ? `Don't break your ${streak}-day streak — ` : ""}open your buddy and grind.`,
    priority: 2,
  }, (id) => {
    if (chrome.runtime.lastError) {
      amLog("nudge", "notify-error", { error: chrome.runtime.lastError.message });
    } else {
      amLog("nudge", "fired", { id, unmet: true, target, today: today.length });
    }
  });
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== NUDGE_ALARM) return;
  amLog("nudge", "alarm-fired", { scheduledTime: alarm.scheduledTime });
  await fireNudgeIfUnmet();
  await scheduleNudge(true); // one-shot: book tomorrow's from fresh local time
});

chrome.notifications.onClicked.addListener((id) => {
  if (!id.startsWith("am-nudge")) return;
  amLog("nudge", "clicked", { id });
  chrome.notifications.clear(id);
  chrome.windows.getCurrent((win) => {
    if (win && win.id != null) {
      chrome.sidePanel.open({ windowId: win.id }).catch((e) =>
        amLog("nudge", "open-panel-failed", { error: String(e) }));
    }
  });
});

// Reschedule when the nudge hour/enabled setting changes; mark the day when a new
// solve crosses the target (this event also wakes the service worker, so panel-closed
// solves are handled the moment they happen).
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.lcSolves) bgAutoMarkIfTargetMet("solve");
  if (!changes.state) return;
  const a = changes.state.oldValue || {};
  const b = changes.state.newValue || {};
  if (a.nudgeHour !== b.nudgeHour || a.nudgeEnabled !== b.nudgeEnabled) {
    scheduleNudge(true);
  }
});

// Content scripts relay their log entries here so a single writer owns the
// amLogs_content key — concurrent tabs doing read-modify-write clobbered each other.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "AM_LOG" && msg.entry) {
    amLogStore("amLogs_content", msg.entry);
    sendResponse(true); // ack, or the sender's callback sees a port-closed error and double-writes
  }
});

// force=true on install: migrates the pre-2.3.0 periodic alarm to the one-shot shape.
chrome.runtime.onInstalled.addListener(() => { amLog("sw", "installed"); scheduleNudge(true); });
chrome.runtime.onStartup.addListener(() => amLog("sw", "browser-startup"));
scheduleNudge();
bgAutoMarkIfTargetMet("sw-wake"); // catch anything missed while the worker was dead
