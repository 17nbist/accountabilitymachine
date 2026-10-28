// Runs on every leetcode.com page. LeetCode is a Next.js SPA, so full-page loads are
// rare — a 1s URL watcher catches soft navigations that would never re-inject this script.
// Two jobs:
//   1. Profile pages (/u/<name>): sync solved-count stats via LeetCode's own GraphQL
//      (same-origin, cookied — the robust path). Never adopts stats from someone
//      else's profile once a username is known.
//   2. Problem pages (/problems/<slug>): watch for LeetCode's own e2e marker
//      [data-e2e-locator="submission-result"] flipping to "Accepted" and log the solve.

const PROFILE_RE = /^\/u\/([^/]+)/;
const PROBLEM_RE = /^\/problems\/([^/]+)/;
const MAX_LOGGED_SOLVES = 500;
// How long after a submit click an "Accepted" verdict counts as a fresh solve.
const SUBMIT_ARM_MS = 90 * 1000;

let lastPath = null;
let lastSyncedProfile = null;
let lastAcceptedKey = null;
let lastIgnoredKey = null;
let armedUntil = 0; // epoch ms; nonzero after the user actually clicks Submit

// Who is actually signed in — the visited profile's URL can be anyone's, and adopting
// a stranger's stats/username on first visit poisoned the whole state.
async function loggedInUsername() {
  try {
    const res = await fetch("/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "query { userStatus { username isSignedIn } }" }),
    });
    if (!res.ok) return null;
    const { data } = await res.json();
    return data?.userStatus?.isSignedIn ? data.userStatus.username : null;
  } catch (e) {
    return null;
  }
}

async function syncProfile(username) {
  const { state } = await chrome.storage.local.get("state");
  const own = state?.lcUsername;
  if (own && own.toLowerCase() !== username.toLowerCase()) {
    amLog("profileSync", "skip-foreign-profile", { viewing: username, own });
    return;
  }
  if (!own) {
    const me = await loggedInUsername();
    if (!me || me.toLowerCase() !== username.toLowerCase()) {
      amLog("profileSync", "skip-not-own", { viewing: username, loggedIn: me });
      return;
    }
  }
  amLog("profileSync", "start", { username });

  const query = `query profile($username: String!) {
    matchedUser(username: $username) {
      username
      profile { ranking }
      submitStatsGlobal { acSubmissionNum { difficulty count } }
    }
    recentAcSubmissionList(username: $username, limit: 20) {
      title
      titleSlug
      timestamp
    }
  }`;

  try {
    const res = await fetch("/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables: { username } }),
    });
    if (!res.ok) {
      amLog("profileSync", "http-error", { status: res.status });
      return;
    }
    const { data } = await res.json();
    if (!data || !data.matchedUser) {
      amLog("profileSync", "no-matched-user", { username });
      return;
    }

    const solved = {};
    for (const row of data.matchedUser.submitStatsGlobal.acSubmissionNum) {
      solved[row.difficulty] = row.count;
    }

    await chrome.storage.local.set({
      lcStats: {
        username: data.matchedUser.username,
        ranking: data.matchedUser.profile?.ranking ?? null,
        solved,
        recent: (data.recentAcSubmissionList || []).map((s) => ({
          title: s.title,
          slug: s.titleSlug,
          ts: Number(s.timestamp) * 1000,
        })),
        fetchedAt: Date.now(),
      },
    });
    amLog("profileSync", "success", { username, solved });
  } catch (e) {
    amLog("profileSync", "exception", { error: String(e).slice(0, 300) });
  }
}

async function recordSolve(slug, title) {
  const key = `${slug}|${amTodayKey()}`;
  if (lastAcceptedKey === key) return;
  // An "Accepted" verdict with no recent submit means the user is just VIEWING an old
  // accepted submission from their history — recording it would fake today's progress
  // (and could auto-mark the day done). Only a verdict inside the post-submit window
  // counts. Don't set lastAcceptedKey here: a real re-submit right after browsing
  // history must still be recordable.
  if (Date.now() > armedUntil) {
    if (lastIgnoredKey !== key) {
      lastIgnoredKey = key;
      amLog("accepted", "ignored-unarmed", {
        slug,
        msSinceArm: armedUntil ? Date.now() - armedUntil : null,
      });
    }
    return;
  }
  lastAcceptedKey = key;
  armedUntil = 0;
  amLog("accepted", "detected", { slug, title });

  const { lcSolves } = await chrome.storage.local.get("lcSolves");
  const solves = lcSolves || [];
  const already = solves.some(
    (s) => s.slug === slug && amTodayKey(new Date(s.ts)) === amTodayKey()
  );
  if (already) {
    amLog("accepted", "already-logged-today", { slug });
    return;
  }

  solves.push({ slug, title, ts: Date.now() });
  await chrome.storage.local.set({ lcSolves: solves.slice(-MAX_LOGGED_SOLVES) });
  amLog("accepted", "recorded", { slug, title, totalLogged: solves.length });
  storeHarvest(); // capture the accepted solution + result for the buddy
}

// ---------- Phase E layer 1: harvest the context LeetCode's own AI sees ----------

function looksLikeCode(v) {
  return typeof v === "string" && v.length > 15 && /\n/.test(v) &&
    /\b(def|class|function|return|for|while|int|void|public|const|let|var|import|struct)\b/.test(v);
}

function findCodeInObject(obj, depth = 0) {
  if (depth > 4 || obj == null) return null;
  if (typeof obj === "string") return looksLikeCode(obj) ? obj : null;
  if (typeof obj !== "object") return null;
  let best = null;
  for (const val of Array.isArray(obj) ? obj : Object.values(obj)) {
    const found = findCodeInObject(val, depth + 1);
    if (found && (!best || found.length > best.length)) best = found;
  }
  return best;
}

// Ask the MAIN-world script (inpage-monaco.js) for Monaco's full model value. This is
// the only reliable full-code source: localStorage has no code, and the Monaco DOM only
// renders visible lines. Resolves to null on timeout so callers fall back gracefully.
function readMonacoModel(timeoutMs = 600) {
  return new Promise((resolve) => {
    const id = `am-${Date.now()}-${Math.random()}`;
    let done = false;
    function onMsg(e) {
      if (e.source !== window || !e.data || e.data.type !== "AM_CODE" || e.data.id !== id) return;
      done = true;
      window.removeEventListener("message", onMsg);
      resolve({ code: e.data.code || null, editors: e.data.editors ?? null, answered: true });
    }
    window.addEventListener("message", onMsg);
    window.postMessage({ type: "AM_GET_CODE", id }, "*");
    setTimeout(() => {
      // No answer = the MAIN-world script isn't on this page at all.
      if (!done) { window.removeEventListener("message", onMsg); resolve({ code: null, editors: null, answered: false }); }
    }, timeoutMs);
  });
}

// Prefer Monaco's full model (via MAIN world); then a defensive localStorage scan
// (currently empty of code but harmless + logs a miss for diagnostics); then the
// visible-only Monaco DOM as a last resort.
async function harvestCode(slug) {
  const t0 = Date.now();
  const model = await readMonacoModel();
  // Logged every time: the full-model path failing silently is exactly how truncated
  // visible-only code reached the AI unnoticed. answered=false → MAIN script missing.
  amLog("hijack", "model-read", {
    ok: !!(model.code && model.code.trim()),
    answered: model.answered,
    editors: model.editors,
    chars: model.code ? model.code.length : 0,
    ms: Date.now() - t0,
  });
  if (model.code && model.code.trim()) return { code: model.code, source: "monaco-model(full)" };
  try {
    const entries = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      const v = localStorage.getItem(k);
      if (v) entries.push([k, v]);
    }
    const slugKeys = entries.filter(([k]) => k.toLowerCase().includes(slug));
    const pool = slugKeys.length ? slugKeys : entries;
    const candidates = [];
    for (const [k, v] of pool) {
      if (looksLikeCode(v)) candidates.push({ code: v, source: `localStorage:${k}` });
      else {
        try {
          const found = findCodeInObject(JSON.parse(v));
          if (found) candidates.push({ code: found, source: `localStorage:${k}(json)` });
        } catch (e) { /* not JSON */ }
      }
    }
    if (candidates.length) {
      candidates.sort((a, b) => b.code.length - a.code.length);
      return candidates[0];
    }
    // Diagnostic: localStorage held no code we recognized. Log KEY NAMES only (never
    // values) so we can learn LeetCode's actual code-cache key format and fix the
    // primary path instead of leaning on the visible-only Monaco fallback.
    amLog("hijack", "localstorage-miss", {
      totalKeys: entries.length,
      slugKeys: slugKeys.map(([k]) => k).slice(0, 10),
      sampleKeys: entries.map(([k]) => k).slice(0, 30),
    });
  } catch (e) {
    amLog("hijack", "localstorage-error", { error: String(e).slice(0, 200) });
  }
  const vl = document.querySelector(".view-lines");
  if (vl) {
    const code = [...vl.querySelectorAll(".view-line")].map(l => l.innerText).join("\n");
    if (code.trim()) return { code, source: "monaco-dom(visible-only)" };
  }
  return null;
}

// A problem page can show TWO verdicts: the bottom "Test Result" panel (only the sample
// cases — often "Accepted" even when the submission failed) and the judged submission
// detail panel ("Wrong Answer 35/36", with Input/Output/Expected). We must prefer the
// judged FAILING verdict, else we'd tell the user they passed when they didn't.
const VERDICTS = ["Wrong Answer", "Time Limit Exceeded", "Runtime Error",
  "Memory Limit Exceeded", "Output Limit Exceeded", "Compile Error", "Accepted"];

function harvestTestResult() {
  const sel = '[data-e2e-locator="console-result"],[data-e2e-locator="submission-result"],' +
    '[class*="font-semibold"],[class*="font-medium"]';
  const results = [];
  document.querySelectorAll(sel).forEach((el) => {
    const verdict = (el.textContent || "").trim();
    if (!VERDICTS.includes(verdict)) return;
    let box = el;
    for (let i = 0; i < 10 && box.parentElement && box !== document.body; i++) {
      box = box.parentElement;
      if (/Expected|Output/.test(box.innerText || "")) break;
    }
    const text = (box.innerText || "").trim();
    results.push({ verdict, text, hasDetail: /Expected/.test(text), len: text.length });
  });
  if (!results.length) return null;
  results.sort((a, b) => {
    const af = a.verdict !== "Accepted", bf = b.verdict !== "Accepted";
    if (af !== bf) return (bf ? 1 : 0) - (af ? 1 : 0); // failing verdict first
    if (a.hasDetail !== b.hasDetail) return (b.hasDetail ? 1 : 0) - (a.hasDetail ? 1 : 0);
    return b.len - a.len;
  });
  const best = results[0];
  return { verdict: best.verdict, text: best.text.slice(0, 2000) };
}

async function harvestProblemContext() {
  const m = location.pathname.match(PROBLEM_RE);
  if (!m) return { error: "not on a problem page" };
  const slug = m[1];
  const titleEl = document.querySelector(".text-title-large a") ||
    document.querySelector(".text-title-large");
  const diffEl = document.querySelector('[class*="text-difficulty-"]');
  const descEl = document.querySelector('[data-track-load="description_content"]');
  const codeHit = await harvestCode(slug);
  const result = harvestTestResult();

  const ctx = {
    slug,
    title: (titleEl?.textContent || document.title.replace(/\s*-\s*LeetCode.*$/, "")).trim(),
    difficulty: diffEl ? diffEl.textContent.trim() : null,
    description: descEl ? descEl.innerText.trim().slice(0, 3000) : null,
    code: codeHit ? codeHit.code.slice(0, 6000) : null,
    codeSource: codeHit ? codeHit.source : "not-found",
    verdict: result ? result.verdict : null,
    testResult: result ? result.text : null,
    // On /submissions/<id>/ the editor shows a PAST submission's code, not the live
    // editor — flag it so the buddy doesn't call an old attempt "your current code".
    viewingSubmission: /\/submissions\/\d+/.test(location.pathname),
    url: location.href,
    ts: Date.now(),
  };
  amLog("hijack", "harvest", {
    slug,
    hasDesc: !!ctx.description,
    codeSource: ctx.codeSource,
    codeLen: ctx.code ? ctx.code.length : 0,
    verdict: ctx.verdict,
  });
  return ctx;
}

async function storeHarvest() {
  const ctx = await harvestProblemContext();
  if (!ctx.error) await chrome.storage.local.set({ lcProblemContext: ctx });
  return ctx;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "AM_HARVEST") {
    storeHarvest().then(sendResponse);
    return true; // async response
  }
});

// Arm solve detection only on a real submission — cover both the Submit button and
// the Cmd/Ctrl+Enter shortcut. Capture phase, so page handlers can't swallow it.
document.addEventListener("click", (e) => {
  if (e.target instanceof Element &&
      e.target.closest('[data-e2e-locator="console-submit-button"]')) {
    armedUntil = Date.now() + SUBMIT_ARM_MS;
    amLog("accepted", "armed", { via: "click" });
  }
}, true);
document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && PROBLEM_RE.test(location.pathname)) {
    armedUntil = Date.now() + SUBMIT_ARM_MS;
    amLog("accepted", "armed", { via: "shortcut" });
  }
}, true);

function checkForAccepted() {
  const m = location.pathname.match(PROBLEM_RE);
  if (!m) return;
  const el = document.querySelector('[data-e2e-locator="submission-result"]');
  if (el && el.textContent.trim() === "Accepted") {
    const title =
      (document.title || "").replace(/\s*-\s*LeetCode.*$/, "").trim() || m[1];
    recordSolve(m[1], title);
  }
}

function onPathChange(path) {
  amLog("nav", "path-change", { path });
  const prof = path.match(PROFILE_RE);
  if (prof) {
    const username = decodeURIComponent(prof[1]);
    if (username !== lastSyncedProfile) {
      lastSyncedProfile = username;
      syncProfile(username);
    }
  } else {
    lastSyncedProfile = null;
  }
}

amLogInit("content");

// An extension reload orphans this script in already-open tabs: chrome.* calls start
// throwing "Extension context invalidated". Detect the dead context and shut down
// (observer + nav timer) instead of erroring on every DOM mutation until tab reload.
let navTimer = null;
function disarmOrphan() {
  observer.disconnect();
  clearInterval(navTimer);
}

const observer = new MutationObserver(() => {
  if (!chrome.runtime?.id) { disarmOrphan(); return; }
  checkForAccepted();
});
observer.observe(document.body, { childList: true, subtree: true });
amLog("init", "observer-attached", { path: location.pathname });

navTimer = setInterval(() => {
  if (!chrome.runtime?.id) { disarmOrphan(); return; }
  if (location.pathname !== lastPath) {
    lastPath = location.pathname;
    onPathChange(lastPath);
  }
}, 1000);

lastPath = location.pathname;
onPathChange(lastPath);
checkForAccepted();
