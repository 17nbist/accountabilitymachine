// Runs on arithmetic.zetamac.com. The only job: when a game ends, write its final score
// to practiceLog as a `zetamac` entry so the buddy can push 50 → 60.
//
// Verified against the live game script (/dist/app.js?v=2, Nov 2026): at zero seconds it
// sets `.answer` disabled, POSTs the problem log to /log, and only on that reply hides
// `.banner .start` and shows `.banner .end`, whose `p.correct` reads "Score: N". Both
// `.correct` nodes are updated on every correct answer, so the score is final the moment
// the input is disabled — we trigger on that (works even if the /log POST fails) and use
// the `.end` reveal as a second chance. "Try again" is a full reload, so one game == one
// script instance; `logged` dedupes the two triggers within it.

const ZETAMAC_MAX_ENTRIES = 2000;
let logged = false;
let duration = null;
let observer = null;

function gameRoot() {
  return document.getElementById("game");
}

function isVisible(el) {
  return !!el && el.offsetParent !== null;
}

function readDuration() {
  const el = document.querySelector("#game .left");
  const d = amParseZetamacDuration(el?.textContent);
  if (d !== null) duration = d;
  return d;
}

async function capture(reason) {
  if (logged) return;
  const endEl = document.querySelector("#game .end .correct");
  const spanEl = document.querySelector("#game span.correct");
  const source = endEl ? ".end .correct" : spanEl ? "span.correct" : null;
  const text = (endEl || spanEl)?.textContent || "";
  const score = amParseZetamacScore(text);
  if (score === null) {
    amLog("zetamac", "score-miss", { reason, source, text: text.slice(0, 40) });
    return;
  }
  logged = true;
  const entry = { ts: Date.now(), track: "zetamac", amount: score, unit: "score", note: duration ? `${duration}s` : "" };
  try {
    const { practiceLog } = await chrome.storage.local.get("practiceLog");
    await chrome.storage.local.set({ practiceLog: [...(practiceLog || []), entry].slice(-ZETAMAC_MAX_ENTRIES) });
    amLog("zetamac", "recorded", { score, duration, reason, source });
  } catch (e) {
    logged = false; // let the next trigger retry
    amLog("zetamac", "store-failed", { error: String(e).slice(0, 200) });
  }
}

// The input is disabled the instant the clock hits zero, before the /log round-trip
// that reveals `.end` — so it's the primary signal. The `.end` reveal is only consulted
// when the input can't be found at all (selector drift), never while a live input exists,
// because `.end` is present-but-hidden from page load and would read "Score: 0".
function gameOver() {
  const answer = document.querySelector("#game .answer");
  if (answer) return answer.disabled ? "answer-disabled" : null;
  return isVisible(document.querySelector("#game .end")) ? "end-visible" : null;
}

function check() {
  if (!chrome.runtime?.id) { observer?.disconnect(); return; } // orphaned by an extension reload
  if (duration === null) readDuration(); // countdown text may land after document_idle
  const reason = gameOver();
  if (reason) capture(reason);
}

amLogInit("content");
const root = gameRoot();
if (!root) {
  amLog("zetamac", "no-game", { path: location.pathname });
} else {
  readDuration();
  amLog("zetamac", "armed", {
    path: location.pathname,
    duration,
    selectors: {
      answer: !!root.querySelector(".answer"),
      end: !!root.querySelector(".end"),
      endCorrect: !!root.querySelector(".end .correct"),
      left: !!root.querySelector(".left"),
    },
  });
  // The game sets the `disabled` attribute and jQuery toggles inline `style` on reveal —
  // both are attribute mutations under #game.
  observer = new MutationObserver(check);
  observer.observe(root, { attributes: true, attributeFilter: ["disabled", "style"], subtree: true, childList: true });
  check(); // a finished game already on screen (e.g. script injected late)
}
