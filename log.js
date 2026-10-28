// Shared logger for all extension contexts (side panel, content script, service worker).
// Every event goes to the console prefixed [AM <ctx>] AND into a per-context ring buffer
// in chrome.storage.local, so a real-world run can be inspected later from the panel's
// 📜 Logs section. Panel/bg writes are serialized through a promise chain; content
// scripts RELAY entries to the service worker instead of writing directly, because
// several tabs share the amLogs_content key and concurrent read-modify-write from
// different tabs clobbered each other's entries.
const AM_LOG_CAP = 600;
let amLogCtx = "unknown";
let amLogChain = Promise.resolve();

function amLogInit(ctx) {
  amLogCtx = ctx;
  let version = null;
  try { version = chrome.runtime.getManifest().version; } catch (e) { /* non-extension context */ }
  amLog("logger", "init", {
    href: typeof location !== "undefined" ? location.href : null,
    version,
  });
}

// Serialized append of one entry to a ring-buffer key. Also the entry point the
// service worker uses for entries relayed from content scripts.
function amLogStore(key, entry) {
  amLogChain = amLogChain.then(async () => {
    try {
      const got = await chrome.storage.local.get(key);
      const logs = got[key] || [];
      logs.push(entry);
      await chrome.storage.local.set({ [key]: logs.slice(-AM_LOG_CAP) });
    } catch (e) { /* logging must never break the extension */ }
  });
}

function amLog(component, event, data) {
  const entry = { t: Date.now(), ctx: amLogCtx, component, event, data: data ?? null };
  try {
    console.debug(`[AM ${amLogCtx}] ${component}:${event}`, data ?? "");
  } catch (e) { /* console can be unavailable in odd contexts */ }
  if (amLogCtx === "content") {
    try {
      chrome.runtime.sendMessage({ type: "AM_LOG", entry }, () => {
        // No worker answered (asleep+failed, or mid-update): write directly as before.
        if (chrome.runtime.lastError) amLogStore(`amLogs_${amLogCtx}`, entry);
      });
      return;
    } catch (e) { /* orphaned content script — fall through to direct write */ }
  }
  amLogStore(`amLogs_${amLogCtx}`, entry);
}

try {
  addEventListener("error", (e) =>
    amLog("global", "uncaught-error", {
      message: String(e.message || e.error).slice(0, 300),
      stack: e.error?.stack ? String(e.error.stack).slice(0, 500) : null,
    }));
  addEventListener("unhandledrejection", (e) =>
    amLog("global", "unhandled-rejection", {
      reason: String(e.reason).slice(0, 300),
      stack: e.reason?.stack ? String(e.reason.stack).slice(0, 500) : null,
    }));
} catch (e) { /* listener registration is best-effort */ }
