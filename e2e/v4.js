// v4 end-to-end scenarios (V4-CONTRACTS §K). e2e/run.js calls this module after scenario 11
// and before the debug sweep, inside a try/catch:
//
//   module.exports = async function runV4(h) { ... }
//
// Rules followed here (§K1, §K2, §N12):
//   - Nothing under prep/ is required at module top level. Each scenario requires the modules it
//     needs inside its own function, so at Red (no prep/ yet) every scenario fails on its own and
//     the run continues to the sweep.
//   - prep.html and the side panel are opened with ?fixture=1. The only exceptions are v4-1's
//     "no bank" check and v4-14, which opens plain prep.html through 📚 and the overlay and so
//     only counts tabs and checks focus.
//   - Expected answers come from the fixture JSON (read with fs, §L4) or from the Node modules plus
//     the page's seed. Only §J selectors/attributes and §I storage shapes are asserted.
//   - OA timers use openPrep(q, { install }) + page.clock.fastForward; fixedTime is used only for
//     date-dependent rendering (dashboard checkpoint, Prep line, Sunday review).
//   - Every scenario starts with h.clearReplies() and h.clearStorage().
// The fixture bank is synthetic (tests/fixtures/bank-mini/README.md); nothing here quotes a book.

"use strict";
const fs = require("fs");
const path = require("path");
const nodeAssert = require("assert");

// ---------- contract constants (restated, not imported) ----------

const DAY = 86400000;
const MINUTE = 60000;

// §L4 named fixture items.
const FX = {
  NUM_7_36: "fixture-p3-q1-8c8ddb31",
  NUM_INV_E: "fixture-p4-q2-dd175c13",
  MCQ_COINS: "fixture-p5-q1-0a74e9b8",
  FREE_WEIGH: "fixture-p7-q1-b7e30cef",
  NUM_DISPUTED: "fixture-p8-q1-353ff247",
  NUM_EV: "fixture-p9-q1-e9f1f9c4",
  CPP_FREE_MOVE: "fixturecpp-s2-c1-724197d7",
  CPP_NUM_SIZEOF: "fixturecpp-s5-c1-6d654661",
  SYS_MCQ_LINE: "fixturesys-s4-c1-31442a11",
  SYS_FREE_FALSESHARING: "fixturesys-s6-c1-b483ecba",
};

const TAB_IDS = ["today", "practice", "cards", "oa", "market", "dashboard", "library"]; // §J1
const AREAS = ["probability", "brainteaser", "statistics", "finance", "cpp", "systems"]; // §A6
const PRACTICE_AREAS = ["probability", "brainteaser", "statistics", "finance"];
const CARD_AREAS = ["cpp", "systems"];
const AREA_KEYS = ["coding", "probability", "cpp", "systems", "mental", "oa", "market", "mocks"];
const MOCK_MODES = ["dsa", "quantdev", "cv", "trader"];
const DEFAULT_ARITH = { ops: ["add", "sub", "mul", "div"], addA: [2, 100], addB: [2, 100], mulA: [2, 12], mulB: [2, 100], durationSecs: 120 }; // §F2
const FIXTURE_ROOT = "tests/fixtures/bank-mini/"; // §E6
const MATERIAL_HEADER = "## Material: the user's weakest bank items — quiz these first, one at a time"; // §H6
const REASONING_MARKER = "[Check my reasoning]"; // §H11
// §K3, as given (v4-16).
const PREP_LINE_RE = /^Prep: overall (\d+|n\/a) · prob (\d+|n\/a) · cpp (\d+|n\/a) · sys (\d+|n\/a) · due today \d+ · weakest: .+$/m;

// ---------- small helpers ----------

function ok(cond, msg) {
  if (!cond) throw new Error(msg);
}
function same(actual, expected, msg) {
  try {
    nodeAssert.deepStrictEqual(actual, expected);
  } catch (e) {
    throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}
function near(a, b, tol = 1e-9) {
  return typeof a === "number" && Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const norm = s => String(s == null ? "" : s).replace(/\s+/g, " ").trim();
const pick = (obj, keys) => Object.fromEntries(keys.map(k => [k, obj ? obj[k] : undefined]));
// m:ss, written here from §F6 so the timer text is checked independently of PrepOA.formatClock.
const clockText = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

// Polls with Node timers, so it is not affected by a page's fake clock.
async function until(fn, what, ms = 15000, every = 100) {
  const t0 = Date.now();
  let lastErr = null;
  while (Date.now() - t0 < ms) {
    try {
      const v = await fn();
      if (v) return v;
      lastErr = null;
    } catch (e) {
      lastErr = e;
    }
    await sleep(every);
  }
  const why = lastErr ? ` (last error: ${String(lastErr.message || lastErr).split("\n")[0]})` : "";
  throw new Error(`timed out after ${ms} ms waiting for ${what}${why}`);
}

const isVis = (page, sel) => page.locator(sel).first().isVisible();
// §J2 result data-state "" (not answered); an absent attribute is read the same way.
const blankState = v => v === "" || v === null;

// Snapshot of the first element matching `sel`: its text, attributes and (for links) resolved href.
function el(page, sel) {
  return page.evaluate(s => {
    const e = document.querySelector(s);
    if (!e) return null;
    const attrs = {};
    for (const a of e.attributes) attrs[a.name] = a.value;
    return { text: e.textContent, attrs, href: typeof e.href === "string" ? e.href : null };
  }, sel);
}
async function attrOf(page, sel, name) {
  const e = await el(page, sel);
  if (!e) return undefined;
  return name in e.attrs ? e.attrs[name] : null;
}
async function textOf(page, sel) {
  const e = await el(page, sel);
  return e ? norm(e.text) : null;
}
function waitVisible(page, sel, what = sel, ms) {
  return until(() => isVis(page, sel), `${what} to be visible`, ms);
}
function waitHidden(page, sel, what = sel, ms) {
  return until(async () => !(await isVis(page, sel)), `${what} to be hidden`, ms);
}
function waitAttr(page, sel, name, want, ms) {
  const test = typeof want === "function" ? want : v => v === want;
  const label = typeof want === "function" ? "the expected value" : `"${want}"`;
  return until(async () => {
    const e = await el(page, sel);
    return e && test(name in e.attrs ? e.attrs[name] : null) ? e : null;
  }, `${sel} [${name}] to be ${label}`, ms);
}
function waitStorage(h, keys, pred, what, ms) {
  return until(async () => {
    const s = await h.storage(keys);
    return pred(s) ? s : null;
  }, what, ms);
}
function waitNewRequest(h, from, pred, what, ms) {
  return until(() => h.requests.slice(from).find(pred), what, ms);
}
function waitSendIdle(panel) {
  return panel.waitForFunction(() => !document.getElementById("sendBtn").disabled, null, { timeout: 15000 });
}
// One chat turn: send, wait for its request, wait until the panel is idle again (tool loop done).
async function chatTurn(h, panel, text) {
  const from = h.requests.length;
  await h.chat(panel, text);
  const req = await waitNewRequest(h, from, b => h.lastUser(b).includes(text), `the request for "${text}"`);
  await waitSendIdle(panel);
  return req;
}

// Starts and ends one mock interview from the panel; returns the start request's system prompt.
async function runInterview(h, panel, mode, startRe) {
  await panel.selectOption("#interviewMode", mode);
  let from = h.requests.length;
  await panel.click("#interviewBtn");
  const start = await waitNewRequest(h, from, b => startRe.test(h.lastUser(b)), `the ${mode} interview start request`);
  await waitSendIdle(panel);
  from = h.requests.length;
  await panel.click("#interviewBtn");
  await waitNewRequest(h, from, b => /End the interview now/.test(h.lastUser(b)), `the ${mode} interview end request`);
  await panel.waitForFunction(() => !document.getElementById("interviewMode").disabled && !document.getElementById("sendBtn").disabled, null, { timeout: 15000 });
  return start.messages[0].content;
}

async function prepPage(h, query, opts) {
  const page = await h.openPrep(query, opts);
  page.setDefaultTimeout(15000);
  return page;
}
async function panelPage(h, opts) {
  const page = await h.openPanel(opts);
  page.setDefaultTimeout(15000);
  return page;
}

// ---------- fixture (read directly with fs, §L4) ----------

function loadFixture(h) {
  const dir = path.join(h.ROOT, "tests", "fixtures", "bank-mini");
  const read = rel => JSON.parse(fs.readFileSync(path.join(dir, rel), "utf8"));
  const bankJson = read("bank.json");
  const cpp = read("decks/cpp.json");
  const systems = read("decks/systems.json");
  const items = [...bankJson.items, ...cpp.items, ...systems.items];
  const byId = {};
  for (const it of items) if (!byId[it.id]) byId[it.id] = it;
  return { items, byId, nc150: read("lists/neetcode150.json"), library: read("library/index.json") };
}
function fxItem(fx, id) {
  const it = fx.byId[id];
  ok(it, `item ${id} is not in the fixture bank`);
  return it;
}

// ---------- prep.html: tabs and item sessions (§J2) ----------

async function waitActiveTab(page, id) {
  return until(async () => {
    const sel = await page.evaluate(ids => ids.map(t => {
      const b = document.querySelector(`button.tab[data-tab="${t}"]`);
      return b ? b.getAttribute("aria-selected") : "missing";
    }), TAB_IDS);
    for (let i = 0; i < TAB_IDS.length; i++) {
      const t = TAB_IDS[i];
      if ((t === id) !== (sel[i] === "true")) return false;
      if ((t === id) !== (await isVis(page, `section#tab-${t}`))) return false;
    }
    return true;
  }, `tab "${id}" to be the only selected and visible tab`);
}

const within = scope => s => `${scope} ${s}`;

// Waits for a visible, unanswered item in `scope` and returns its data-item-id.
function currentItem(page, scope) {
  const S = within(scope);
  return until(async () => {
    if (!(await isVis(page, S('[data-role="item"]')))) return null;
    const e = await el(page, S('[data-role="item"]'));
    return e && e.attrs["data-item-id"] && e.attrs["data-answered"] === "0" ? e.attrs["data-item-id"] : null;
  }, `an unanswered item in ${scope}`);
}

// §L4 step 3: numeric → type answer.value; mcq → click the correct choice; free → reveal.
async function answerCorrectly(page, scope, item) {
  const S = within(scope);
  if (item.type === "numeric") {
    await page.fill(S('input[data-role="answer-input"]'), item.answer.value);
    await page.click(S('button[data-role="submit"]'));
  } else if (item.type === "mcq") {
    await page.click(S(`button[data-role="choice"][data-index="${item.answer.correct}"]`));
  } else {
    await page.click(S('button[data-role="reveal"]'));
    await waitVisible(page, S('button[data-role="grade"][data-grade="good"]'));
    return;
  }
  await waitAttr(page, S('[data-role="result"]'), "data-state", v => v === "correct" || v === "wrong");
}

// Free items advance on the grade click (Good), auto items on Next. Returns "item" or "summary".
async function advance(page, scope, item) {
  const S = within(scope);
  if (item.type === "free") await page.click(S('button[data-role="grade"][data-grade="good"]'));
  else await page.click(S('button[data-role="next"]'));
  return until(async () => {
    if (await isVis(page, S('[data-role="summary"]'))) return "summary";
    if (!(await isVis(page, S('[data-role="item"]')))) return null;
    const e = await el(page, S('[data-role="item"]'));
    return e && e.attrs["data-item-id"] && e.attrs["data-item-id"] !== item.id && e.attrs["data-answered"] === "0" ? "item" : null;
  }, `the next item or the session summary in ${scope}`);
}

// Answers every item of the running session correctly; returns the ids in the order shown.
async function playSession(page, scope, fx, max = 60) {
  const ids = [];
  for (let n = 0; n < max; n++) {
    const id = await currentItem(page, scope);
    const item = fxItem(fx, id);
    ids.push(id);
    await answerCorrectly(page, scope, item);
    if ((await advance(page, scope, item)) === "summary") return ids;
  }
  throw new Error(`the session in ${scope} did not end after ${max} items`);
}

function checkCard(card, want, msg) {
  ok(card && typeof card === "object", `${msg}: no card stored`);
  for (const k of ["interval", "due", "reps", "lapses", "last", "seen"]) {
    ok(card[k] === want[k], `${msg}: card.${k} = ${JSON.stringify(card[k])}, expected ${JSON.stringify(want[k])}`);
  }
  ok(near(card.ease, want.ease), `${msg}: card.ease = ${card.ease}, expected ${want.ease}`);
}

// ---------- scenarios ----------

async function v4_1(h) {
  h.clearReplies();
  await h.clearStorage();
  const page = await prepPage(h, "?fixture=1");
  const body = await page.evaluate(() => ({ ready: document.body.dataset.ready, source: document.body.dataset.bankSource }));
  ok(body.ready === "1", `data-ready = ${body.ready}`);
  ok(body.source === "fixture", `?fixture=1 must load the fixture bank, data-bank-source = ${body.source}`);
  for (const id of TAB_IDS) {
    ok(await page.locator(`button.tab[data-tab="${id}"]`).count() === 1, `exactly one tab button for "${id}"`);
    ok(await page.locator(`section#tab-${id}`).count() === 1, `exactly one section#tab-${id}`);
    ok(await isVis(page, `button.tab[data-tab="${id}"]`), `tab button "${id}" is visible`);
  }
  ok(!(await isVis(page, "#bank-missing")), "#bank-missing must be hidden when the fixture bank loaded");
  await waitActiveTab(page, "today"); // the default tab (§J1)
  for (const id of [...TAB_IDS.slice(1), "today"]) {
    await page.click(`button.tab[data-tab="${id}"]`);
    await waitActiveTab(page, id);
  }
  await page.close();

  const market = await prepPage(h, "?fixture=1&tab=market");
  await waitActiveTab(market, "market");
  await market.close();

  // Without ?fixture=1 the page loads bank/ (if the developer built it) or shows the missing screen.
  const plain = await prepPage(h, "");
  const src = await plain.evaluate(() => document.body.dataset.bankSource);
  ok(src === "none" || src === "bank", `without ?fixture=1 data-bank-source must be "bank" or "none", got ${src}`);
  if (src === "none") {
    await waitVisible(plain, "#bank-missing");
    const t = await textOf(plain, "#bank-missing");
    ok(t.includes("Bank not built") && t.includes("npm run bank:build"), `#bank-missing text: ${t}`);
    for (const id of TAB_IDS) ok(!(await isVis(plain, `button.tab[data-tab="${id}"]`)), `tab button "${id}" must be hidden when the bank is missing`);
  } else {
    ok(!(await isVis(plain, "#bank-missing")), "#bank-missing must be hidden when bank/ is built");
  }
  await plain.close();
}

async function v4_2(h) {
  h.clearReplies();
  await h.clearStorage();
  const fx = loadFixture(h);
  const id = FX.NUM_7_36;
  fxItem(fx, id);
  const S = within("#tab-practice");
  let page = await prepPage(h, `?fixture=1&item=${id}`);
  await waitActiveTab(page, "practice");
  await currentItem(page, "#tab-practice");
  const it = await el(page, S('[data-role="item"]'));
  same(pick(it.attrs, ["data-item-id", "data-item-type", "data-area", "data-answered"]),
    { "data-item-id": id, "data-item-type": "numeric", "data-area": "probability", "data-answered": "0" }, "item attributes");
  const src = await el(page, S('a[data-role="source"]'));
  ok(src, "a[data-role=source] exists");
  ok(norm(src.text) === "Fixture Notes, p. 3", `source label: ${norm(src.text)}`);
  const wantHref = `chrome-extension://${h.EXT}/${FIXTURE_ROOT}library/fixture-notes.pdf#page=3`;
  ok(src.href === wantHref, `source href ${src.href}, expected ${wantHref}`);
  ok(!(await isVis(page, S('[data-role="disputed"]'))), "an agreed item shows no disputed banner");
  ok(blankState(await attrOf(page, S('[data-role="result"]'), "data-state")), "result data-state is empty before answering");
  const pv0 = await attrOf(page, S('[data-role="preview"]'), "data-state");
  ok(pv0 === "empty" || pv0 === null, `preview data-state for the blank input before typing: ${pv0}`); // "empty" is asserted strictly below

  // Live preview: ok, empty, error.
  const input = S('input[data-role="answer-input"]');
  await page.fill(input, "7/36");
  const pv = await waitAttr(page, S('[data-role="preview"]'), "data-state", "ok");
  ok(norm(pv.text) === "= 0.194444", `preview text for 7/36: "${norm(pv.text)}"`);
  await page.fill(input, "");
  await waitAttr(page, S('[data-role="preview"]'), "data-state", "empty");
  await page.fill(input, "2 3");
  const pe = await waitAttr(page, S('[data-role="preview"]'), "data-state", "error");
  ok(norm(pe.text).length > 0, "a parse error preview shows the error text");

  // A parse error is never counted: result[data-state=error], the item stays unanswered, no history.
  await page.click(S('button[data-role="submit"]'));
  await waitAttr(page, S('[data-role="result"]'), "data-state", "error");
  ok((await attrOf(page, S('[data-role="item"]'), "data-answered")) === "0", "a parse error leaves the item unanswered");
  await sleep(700);
  let st = await h.storage(["prepHistory", "prepCards", "prepMistakes"]);
  ok(!(st.prepHistory || []).length, `a parse error must not write history: ${JSON.stringify(st.prepHistory)}`);
  ok(!(st.prepCards && st.prepCards[id]), "a parse error must not write a card");

  // Wrong answer: again, mistake, Again, 10m.
  await page.fill(input, "0.19");
  await page.click(S('button[data-role="submit"]'));
  const res = await waitAttr(page, S('[data-role="result"]'), "data-state", "wrong");
  ok(norm(res.text).includes("Wrong"), `result text: ${norm(res.text)}`);
  ok((await textOf(page, S('[data-role="auto-grade"]'))) === "Again, 10m", `auto-grade: ${await textOf(page, S('[data-role="auto-grade"]'))}`);
  ok((await attrOf(page, S('[data-role="item"]'), "data-answered")) === "1", "item data-answered = 1 after answering");
  await waitVisible(page, S('[data-role="solution"]'));
  await waitVisible(page, S('button[data-role="check-reasoning"]'));
  await waitVisible(page, S('button[data-role="next"]'));
  st = await waitStorage(h, ["prepHistory", "prepCards", "prepMistakes"],
    s => (s.prepHistory || []).length === 1 && (s.prepMistakes || []).length === 1 && s.prepCards && s.prepCards[id],
    "one history entry, one mistake and a card after the wrong answer");
  const e = st.prepHistory[0];
  same(pick(e, ["itemId", "mode", "correct", "grade", "answer"]), { itemId: id, mode: "auto", correct: false, grade: "again", answer: "0.19" }, "history entry for the wrong answer");
  ok(typeof e.ts === "number" && Number.isInteger(e.secs) && e.secs >= 0 && e.secs <= 3600, `history ts/secs: ${JSON.stringify(e)}`);
  same(st.prepMistakes[0], { ts: e.ts, itemId: id, answer: "0.19", note: "" }, "mistake entry");
  checkCard(st.prepCards[id], { ease: 2.3, interval: 0, due: e.ts + 10 * MINUTE, reps: 0, lapses: 1, last: e.ts, seen: e.ts }, "card after again");

  // Next ends the one-item session: summary.
  await page.click(S('button[data-role="next"]'));
  const sum = await until(async () => (await isVis(page, S('[data-role="summary"]'))) && el(page, S('[data-role="summary"]')), "the session summary");
  ok(!(await isVis(page, S('[data-role="item"]'))), "the item is hidden once the summary shows");
  same(pick(sum.attrs, ["data-answered", "data-correct", "data-accuracy", "data-secs", "data-due-tomorrow"]),
    { "data-answered": "1", "data-correct": "0", "data-accuracy": "0", "data-secs": String(e.secs), "data-due-tomorrow": "1" }, "summary attributes");
  ok((await textOf(page, S('[data-role="summary-weakest"]'))) === "dice, order-statistics", `summary weakest: ${await textOf(page, S('[data-role="summary-weakest"]'))}`);
  await page.close();

  // Fresh load: correct answer → good, interval 1, no mistake.
  await h.clearStorage();
  page = await prepPage(h, `?fixture=1&item=${id}`);
  await currentItem(page, "#tab-practice");
  await page.fill(input, "0.1944");
  await page.click(S('button[data-role="submit"]'));
  const res2 = await waitAttr(page, S('[data-role="result"]'), "data-state", "correct");
  ok(norm(res2.text).includes("Correct"), `result text: ${norm(res2.text)}`);
  ok((await textOf(page, S('[data-role="auto-grade"]'))) === "Good, 1d", `auto-grade: ${await textOf(page, S('[data-role="auto-grade"]'))}`);
  st = await waitStorage(h, ["prepHistory", "prepCards", "prepMistakes"],
    s => (s.prepHistory || []).length === 1 && s.prepCards && s.prepCards[id], "history and card after the correct answer");
  const e2 = st.prepHistory[0];
  same(pick(e2, ["itemId", "mode", "correct", "grade", "answer"]), { itemId: id, mode: "auto", correct: true, grade: "good", answer: "0.1944" }, "history entry for the correct answer");
  checkCard(st.prepCards[id], { ease: 2.5, interval: 1, due: e2.ts + DAY, reps: 1, lapses: 0, last: e2.ts, seen: e2.ts }, "card after good");
  ok(!(st.prepMistakes || []).length, "a correct answer writes no mistake");
  await page.close();

  // An unknown id shows [data-role=empty].
  page = await prepPage(h, "?fixture=1&item=fixture-p99-q9-00000000");
  await waitVisible(page, S('[data-role="empty"]'), "[data-role=empty] for an unknown item id");
  await page.close();
}

async function v4_3(h) {
  h.clearReplies();
  await h.clearStorage();
  const fx = loadFixture(h);
  const id = FX.MCQ_COINS;
  const item = fxItem(fx, id);
  const S = within("#tab-practice");
  let page = await prepPage(h, `?fixture=1&item=${id}`);
  await currentItem(page, "#tab-practice");
  ok((await attrOf(page, S('[data-role="item"]'), "data-item-type")) === "mcq", "data-item-type = mcq");
  ok(!(await isVis(page, S('input[data-role="answer-input"]'))), "mcq items have no numeric input");
  const choices = await page.$$eval(`#tab-practice button[data-role="choice"]`, bs => bs.map(b => [b.getAttribute("data-index"), b.textContent]));
  same(choices.map(([i, t]) => [i, t.replace(/\s+/g, " ").trim()]), item.answer.choices.map((c, i) => [String(i), c]), "choice buttons");
  await page.click(S('button[data-role="choice"][data-index="2"]'));
  const res = await waitAttr(page, S('[data-role="result"]'), "data-state", "correct");
  ok(norm(res.text).includes("Correct"), `result text: ${norm(res.text)}`);
  ok((await textOf(page, S('[data-role="auto-grade"]'))) === "Good, 1d", "auto-grade Good, 1d");
  let st = await waitStorage(h, ["prepHistory", "prepCards"], s => (s.prepHistory || []).length === 1 && s.prepCards && s.prepCards[id], "history after the mcq answer");
  same(pick(st.prepHistory[0], ["itemId", "mode", "correct", "grade", "answer"]), { itemId: id, mode: "auto", correct: true, grade: "good", answer: 2 }, "mcq history entry (answer is the chosen index)");
  ok(st.prepCards[id].interval === 1, "card interval 1");
  await page.close();

  await h.clearStorage();
  page = await prepPage(h, `?fixture=1&item=${id}`);
  await currentItem(page, "#tab-practice");
  await page.click(S('button[data-role="choice"][data-index="0"]'));
  await waitAttr(page, S('[data-role="result"]'), "data-state", "wrong");
  st = await waitStorage(h, ["prepHistory", "prepMistakes"], s => (s.prepHistory || []).length === 1 && (s.prepMistakes || []).length === 1, "history and mistake after a wrong choice");
  same(pick(st.prepHistory[0], ["mode", "correct", "grade", "answer"]), { mode: "auto", correct: false, grade: "again", answer: 0 }, "wrong mcq history entry");
  same(st.prepMistakes[0], { ts: st.prepHistory[0].ts, itemId: id, answer: 0, note: "" }, "wrong mcq mistake entry");
  await page.close();
}

async function v4_4(h) {
  h.clearReplies();
  await h.clearStorage();
  const fx = loadFixture(h);
  const id = FX.FREE_WEIGH;
  fxItem(fx, id);
  const S = within("#tab-practice");
  let page = await prepPage(h, `?fixture=1&item=${id}`);
  await currentItem(page, "#tab-practice");
  same(pick((await el(page, S('[data-role="item"]'))).attrs, ["data-item-type", "data-area"]), { "data-item-type": "free", "data-area": "brainteaser" }, "free item attributes");
  ok(await isVis(page, S('textarea[data-role="free-input"]')), "free items show the working textarea");
  ok(await isVis(page, S('button[data-role="reveal"]')), "free items show Reveal");
  ok(!(await isVis(page, S('button[data-role="grade"][data-grade="good"]'))), "grade buttons are hidden before the reveal");
  ok(!(await isVis(page, S('[data-role="solution"]'))), "the solution is hidden before the reveal");

  await page.fill(S('textarea[data-role="free-input"]'), "  Three groups of three, then weigh two coins.  ");
  await page.click(S('button[data-role="reveal"]'));
  await waitAttr(page, S('[data-role="result"]'), "data-state", "revealed");
  await waitVisible(page, S('[data-role="solution"]'));
  const sol = await textOf(page, S('[data-role="solution"]'));
  ok(sol.includes("Split the coins into three groups of three"), "the solution area includes the model answer");
  ok(sol.includes("Each weighing has three outcomes"), "the solution area includes the solution");
  await waitVisible(page, S('button[data-role="check-reasoning"]'));
  const labels = {};
  for (const g of ["again", "hard", "good", "easy"]) labels[g] = await textOf(page, S(`button[data-role="grade"][data-grade="${g}"]`));
  same(labels, { again: "Again, 10m", hard: "Hard, 1d", good: "Good, 1d", easy: "Easy, 1d" }, "grade labels for a new card");
  ok(!((await h.storage("prepHistory")).prepHistory || []).length, "revealing writes no history");

  await page.click(S('button[data-role="grade"][data-grade="good"]'));
  let st = await waitStorage(h, ["prepHistory", "prepCards", "prepMistakes"], s => (s.prepHistory || []).length === 1 && s.prepCards && s.prepCards[id], "history after grading Good");
  const e = st.prepHistory[0];
  same(pick(e, ["itemId", "mode", "correct", "grade", "answer"]),
    { itemId: id, mode: "self", correct: null, grade: "good", answer: "Three groups of three, then weigh two coins." }, "self-graded history entry");
  ok(Number.isInteger(e.secs) && e.secs >= 0, `secs ${e.secs}`);
  checkCard(st.prepCards[id], { ease: 2.5, interval: 1, due: e.ts + DAY, reps: 1, lapses: 0, last: e.ts, seen: e.ts }, "card after self-graded good");
  ok(!(st.prepMistakes || []).length, "Good writes no mistake");
  const sum = await until(async () => (await isVis(page, S('[data-role="summary"]'))) && el(page, S('[data-role="summary"]')), "the summary after the grade click");
  same(pick(sum.attrs, ["data-answered", "data-correct", "data-accuracy", "data-secs"]),
    { "data-answered": "1", "data-correct": "1", "data-accuracy": "100", "data-secs": String(e.secs) }, "summary after one self-graded item");
  ok((await textOf(page, S('[data-role="summary-weakest"]'))) === "none", "no mistakes → weakest none");
  await page.close();

  // A seeded card { reps 1, interval 1, ease 2.5, due in the past } → Good, 6d (spec §3 F1.4 example).
  await h.clearStorage();
  const t = Date.now();
  await h.setStorage({ prepCards: { [id]: { ease: 2.5, interval: 1, due: t - DAY, reps: 1, lapses: 0, last: t - DAY, seen: t - 2 * DAY } } });
  page = await prepPage(h, `?fixture=1&item=${id}`);
  await currentItem(page, "#tab-practice");
  await page.click(S('button[data-role="reveal"]'));
  await waitVisible(page, S('button[data-role="grade"][data-grade="good"]'));
  const labels2 = {};
  for (const g of ["again", "hard", "good", "easy"]) labels2[g] = await textOf(page, S(`button[data-role="grade"][data-grade="${g}"]`));
  same(labels2, { again: "Again, 10m", hard: "Hard, 1d", good: "Good, 6d", easy: "Easy, 8d" }, "grade labels for { reps 1, interval 1, ease 2.5 }");
  await page.click(S('button[data-role="grade"][data-grade="good"]'));
  st = await waitStorage(h, ["prepHistory", "prepCards"], s => (s.prepHistory || []).length === 1 && s.prepCards && s.prepCards[id] && s.prepCards[id].reps === 2, "the card after Good on a seeded card");
  ok(st.prepCards[id].interval === 6, `interval after Good: ${st.prepCards[id].interval}`);
  ok(st.prepHistory[0].grade === "good", "history grade good");
  await page.close();
}

async function v4_5(h) {
  h.clearReplies();
  await h.clearStorage();
  const fx = loadFixture(h);
  const S = within("#tab-practice");
  fxItem(fx, FX.NUM_DISPUTED);
  let page = await prepPage(h, `?fixture=1&item=${FX.NUM_DISPUTED}`);
  await currentItem(page, "#tab-practice");
  await waitVisible(page, S('[data-role="disputed"]'), "the disputed banner");
  const t = await textOf(page, S('[data-role="disputed"]'));
  ok(t.includes("1/3") && t.includes("1/2"), `the disputed banner quotes printed 1/3 and resolved 1/2: ${t}`);
  await page.close();
  for (const id of [FX.NUM_7_36, FX.NUM_INV_E, FX.MCQ_COINS]) {
    page = await prepPage(h, `?fixture=1&item=${id}`);
    await currentItem(page, "#tab-practice");
    ok(!(await isVis(page, S('[data-role="disputed"]'))), `${id} is not disputed and must show no banner`);
    await page.close();
  }
}

async function v4_6(h) {
  h.clearReplies();
  await h.clearStorage();
  h.requests.length = 0;
  const R = require("../prep/readiness.js");
  const fx = loadFixture(h);
  const id = FX.NUM_7_36;
  const item = fxItem(fx, id);
  const S = within("#tab-practice");
  const MODEL = "e2e/reasoning-model"; // not the default, so the request shows state.model is used (§J11)
  const CRITIQUE = "Mock critique: the bound on the larger die is right, but recount the cases where it equals four.";
  h.addReply(b => h.lastUser(b).startsWith(REASONING_MARKER), h.textReply(CRITIQUE));
  await h.seedState({ apiKey: "sk-or-e2e", model: MODEL });

  let page = await prepPage(h, `?fixture=1&item=${id}`);
  await currentItem(page, "#tab-practice");
  await page.fill(S('input[data-role="answer-input"]'), "0.19");
  await page.click(S('button[data-role="submit"]'));
  await waitAttr(page, S('[data-role="result"]'), "data-state", "wrong");
  const before = await waitStorage(h, ["prepHistory", "prepCards", "prepMistakes"],
    s => (s.prepHistory || []).length === 1 && (s.prepMistakes || []).length === 1 && s.prepCards && s.prepCards[id], "the wrong answer's writes");
  // Before the click the critique area is idle: not rendered yet, or data-state idle or absent (§J2).
  const idle = await attrOf(page, S('[data-role="reasoning"]'), "data-state");
  ok(idle === undefined || idle === null || idle === "idle", `reasoning data-state before the click: ${idle}`);
  ok(!h.requests.some(b => h.lastUser(b).startsWith(REASONING_MARKER)), "no reasoning request before the click");
  await page.click(S('button[data-role="check-reasoning"]'));
  const done = await waitAttr(page, S('[data-role="reasoning"]'), "data-state", "done");
  ok(norm(done.text).includes(CRITIQUE), `the streamed critique is shown: ${norm(done.text)}`);

  const req = await waitNewRequest(h, 0, b => h.lastUser(b).startsWith(REASONING_MARKER), "the Check my reasoning request");
  const want = R.reasoningRequest(item, "", "0.19", MODEL);
  ok(req.model === MODEL && req.model === want.model && req.stream === true, `request model/stream: ${req.model} ${req.stream}`);
  ok(String(req.messages[req.messages.length - 1].content).startsWith(`${REASONING_MARKER}\nItem: ${id}\n`), "the user message starts with the marker and the item id (§H11)");
  ok(!("tools" in req), "the reasoning request has no tools");
  same(req.messages, want.messages, "reasoning request messages = reasoningRequest(item, working, answer, model)");

  // The grade never changes.
  ok((await attrOf(page, S('[data-role="result"]'), "data-state")) === "wrong", "result still wrong");
  ok((await textOf(page, S('[data-role="auto-grade"]'))) === "Again, 10m", "auto-grade unchanged");
  await sleep(500);
  const after = await h.storage(["prepHistory", "prepCards", "prepMistakes"]);
  same(after, before, "Check my reasoning must not change history, cards or mistakes");
  await page.close();

  // No API key: data-state error mentioning the key, and no request.
  await h.clearStorage();
  const from = h.requests.length;
  page = await prepPage(h, `?fixture=1&item=${id}`);
  await currentItem(page, "#tab-practice");
  await page.fill(S('input[data-role="answer-input"]'), "0.1944");
  await page.click(S('button[data-role="submit"]'));
  await waitAttr(page, S('[data-role="result"]'), "data-state", "correct");
  await page.click(S('button[data-role="check-reasoning"]'));
  const err = await waitAttr(page, S('[data-role="reasoning"]'), "data-state", "error");
  ok(norm(err.text).includes("API key"), `no-key error text: ${norm(err.text)}`);
  await sleep(500);
  ok(!h.requests.slice(from).some(b => h.lastUser(b).startsWith(REASONING_MARKER)), "no request is made without an API key");
  await page.close();
}

async function v4_7(h) {
  h.clearReplies();
  await h.clearStorage();
  const Srs = require("../prep/srs.js");
  const fx = loadFixture(h);
  const T = new Date(2026, 10, 5, 12, 0, 0).getTime(); // no cards are stored, so `now` does not change the queues

  // Cards topic options: "" then topicSet of the cpp and systems items (computed here from the
  // fixture), checked with the Cards tab shown and default settings.
  const wantTopics = [...new Set(fx.items.filter(i => CARD_AREAS.includes(i.area)).flatMap(i => i.topics))].sort();
  const cardsPage = await prepPage(h, "?fixture=1&tab=cards");
  await waitActiveTab(cardsPage, "cards");
  await until(async () => (await cardsPage.$$eval("select#cards-topic option", os => os.length)) > 1, "select#cards-topic options");
  const opts = await cardsPage.$$eval("select#cards-topic option", os => os.map(o => o.value));
  same(opts, ["", ...wantTopics], "select#cards-topic options");
  await cardsPage.close();

  const page = await prepPage(h, "?fixture=1");
  await waitActiveTab(page, "today");

  // Today settings: save writes normalised prepSettings.
  for (const a of AREAS) ok(await page.locator(`input.settings-area[type=checkbox][value="${a}"]`).count() === 1, `settings checkbox for ${a}`);
  await page.fill("input#settings-new-per-day", "5");
  await page.fill("input#settings-review-cap", "40");
  await page.uncheck('input.settings-area[type=checkbox][value="systems"]');
  await page.uncheck('input.settings-area[type=checkbox][value="finance"]');
  await page.click("button#settings-save");
  const settings = { newPerDay: 5, reviewCap: 40, areas: ["probability", "brainteaser", "statistics", "cpp"] };
  await waitStorage(h, "prepSettings", s => {
    try { nodeAssert.deepStrictEqual(s.prepSettings, settings); return true; } catch (e) { return false; }
  }, `prepSettings = ${JSON.stringify(settings)}`);

  // Practice auto-starts on settings.areas ∩ PRACTICE_AREAS.
  await page.click('button.tab[data-tab="practice"]');
  await waitActiveTab(page, "practice");
  const pFirst = await currentItem(page, "#tab-practice");
  const pQueue = Srs.buildQueue(fx.items, {}, T, { ...settings, areas: settings.areas.filter(a => PRACTICE_AREAS.includes(a)) });
  ok(pFirst === pQueue[0], `Practice first item ${pFirst}, expected ${pQueue[0]}`);

  // Cards auto-starts on settings.areas ∩ CARD_AREAS (= cpp only here).
  await page.click('button.tab[data-tab="cards"]');
  await waitActiveTab(page, "cards");
  const cFirst = await currentItem(page, "#tab-cards");
  const cQueue = Srs.buildQueue(fx.items, {}, T, { ...settings, areas: ["cpp"] });
  ok(cFirst === cQueue[0], `Cards first item ${cFirst}, expected ${cQueue[0]}`);
  ok(fxItem(fx, cFirst).area === "cpp", "systems is unticked, so the Cards session is cpp only");

  // End the auto-started session at once → empty summary, and the item is hidden.
  const C = within("#tab-cards");
  await waitVisible(page, C('button[data-role="end-session"]'));
  await page.click(C('button[data-role="end-session"]'));
  const sum = await until(async () => (await isVis(page, C('[data-role="summary"]'))) && el(page, C('[data-role="summary"]')), "the Cards summary after end-session");
  ok(!(await isVis(page, C('[data-role="item"]'))), "the item is hidden after end-session");
  same(pick(sum.attrs, ["data-answered", "data-correct", "data-accuracy", "data-secs", "data-due-tomorrow"]),
    { "data-answered": "0", "data-correct": "0", "data-accuracy": "", "data-secs": "0", "data-due-tomorrow": "0" }, "summary of a session with nothing answered");
  ok((await textOf(page, C('[data-role="summary-weakest"]'))) === "none", "weakest none");

  // Topic filter move-semantics. The previous session has ended (its item is hidden), so the next
  // visible unanswered item belongs to the filtered session.
  const fQueue = Srs.buildQueue(fx.items, {}, T, { ...settings, areas: ["cpp"] }, { topics: ["move-semantics"] });
  ok(fQueue.length > 0, "the fixture has cpp move-semantics items (§L2 rule 6)");
  await page.selectOption("select#cards-topic", "move-semantics");
  await page.click("button#cards-start");
  const fFirst = await currentItem(page, "#tab-cards");
  ok(fFirst === fQueue[0], `the filtered Cards session starts with ${fFirst}, expected ${fQueue[0]}`);
  ok(fxItem(fx, fFirst).topics.includes("move-semantics"), `the first filtered item ${fFirst} has topic move-semantics`);
  ok((await attrOf(page, C('[data-role="item"]'), "data-area")) === "cpp", "data-area = cpp");
  await page.close();
}

async function waitQuestion(page, i) {
  const q = await waitAttr(page, "#oa-question", "data-index", String(i));
  return norm(q.text);
}

async function v4_8(h) {
  h.clearReplies();
  await h.clearStorage();
  const OA = require("../prep/oa.js");
  const SEED = 42;
  const K = 12; // questions answered before time runs out
  const T0 = new Date(2026, 10, 5, 9, 0, 0).getTime();
  const run = OA.generate("arith", SEED);
  const page = await prepPage(h, `?fixture=1&tab=oa&seed=${SEED}`, { install: T0 });
  await waitActiveTab(page, "oa");
  const kinds = await page.$$eval("select#oa-kind option", os => os.map(o => o.value));
  same([...kinds].sort(), ["arith", "eighty", "ev", "seq"], "select#oa-kind options");
  ok(await page.locator("#oa-config").count() === 1, "#oa-config holds the arith config");
  await page.selectOption("select#oa-kind", "arith");
  await page.click("button#oa-start");

  const t0 = await until(async () => {
    const t = await el(page, "#oa-timer");
    return t && /^\d+$/.test(t.attrs["data-secs-left"] || "") ? t : null;
  }, "#oa-timer data-secs-left");
  const left0 = Number(t0.attrs["data-secs-left"]);
  ok(left0 >= 110 && left0 <= 120, `timer at start: ${left0}`);

  for (let i = 0; i < K; i++) {
    const text = await waitQuestion(page, i);
    if (i === 0) ok(text === "6 × 86", `seed 42 starts with "6 × 86" (§F2), page shows "${text}"`);
    ok(text === run.questions[i].prompt, `question ${i}: page "${text}", generate("arith", 42) "${run.questions[i].prompt}"`);
    // Typed key by key (input and key events both fire); it auto-advances, there is no submit key.
    // No proper prefix of a non-negative integer answer equals the answer, so only the last key advances.
    await page.locator("#oa-input").pressSequentially(run.questions[i].answer.value);
    if (i % 4 === 3) await page.clock.fastForward(2000);
  }
  await waitQuestion(page, K);
  ok((await page.inputValue("#oa-input")) === "", "#oa-input is cleared on every advance");
  await page.evaluate(() => document.getElementById("oa-input").blur());
  await until(() => page.evaluate(() => !!document.activeElement && document.activeElement.id === "oa-input"), "#oa-input to be refocused after blur", 5000);

  await page.clock.fastForward(30000);
  const mid = await until(async () => {
    const t = await page.evaluate(() => { const e = document.getElementById("oa-timer"); return { text: e.textContent, left: e.dataset.secsLeft }; });
    return Number(t.left) <= 90 ? t : null;
  }, "the timer to show at most 90 s left after fast-forwarding");
  const left = Number(mid.left);
  ok(Number.isInteger(left) && left >= 50 && left <= 90, `timer after ~40 s: ${mid.left}`);
  ok(norm(mid.text) === clockText(left), `timer text "${norm(mid.text)}" vs data-secs-left ${left}`);

  await page.clock.fastForward(120000); // past the 120 s limit
  await waitVisible(page, "#oa-results", "#oa-results at time-up");
  const results = await el(page, "#oa-results");
  same(pick(results.attrs, ["data-score", "data-total"]), { "data-score": String(K), "data-total": String(K) }, "arith results (score = total = auto-advanced answers)");
  const tEnd = await el(page, "#oa-timer");
  ok(tEnd.attrs["data-secs-left"] === "0" && norm(tEnd.text) === "0:00", `timer at the end: ${tEnd.attrs["data-secs-left"]} "${norm(tEnd.text)}"`);
  ok(await page.locator("ul#oa-missed li.oa-missed").count() === 0, "arith lists no missed questions");

  const st = await waitStorage(h, ["oaRuns", "practiceLog"], s => (s.oaRuns || []).length === 1 && (s.practiceLog || []).some(e => e.track === "zetamac"), "the oaRuns entry and the zetamac practice entry");
  const r = st.oaRuns[0];
  same(pick(r, ["kind", "seed", "score", "total", "secs"]), { kind: "arith", seed: SEED, score: K, total: K, secs: 120 }, "oaRuns entry");
  ok(typeof r.ts === "number", "oaRuns ts");
  same(r.config, DEFAULT_ARITH, "the stored config is the normalised Zetamac default");
  same(st.practiceLog.filter(e => e.track === "zetamac"), [{ ts: r.ts, track: "zetamac", amount: K, unit: "score", note: "in-app" }], "one in-app zetamac entry");
  ok((await attrOf(page, "#oa-best", "data-best")) === String(K), `#oa-best data-best: ${await attrOf(page, "#oa-best", "data-best")}`);
  ok((await attrOf(page, "#oa-trend", "data-points")) === String(K), `#oa-trend data-points: ${await attrOf(page, "#oa-trend", "data-points")}`);
  await page.close();
}

async function v4_9(h) {
  h.clearReplies();
  await h.clearStorage();
  const OA = require("../prep/oa.js");
  const A = require("../prep/answer.js");
  const SEED = 123;
  const T0 = new Date(2026, 10, 5, 9, 0, 0).getTime();
  const prior = [
    { ts: T0 - 3 * DAY, kind: "ev", seed: 1, score: 5, total: 20, secs: 300, config: {} },
    { ts: T0 - 2 * DAY, kind: "ev", seed: 2, score: 19, total: 20, secs: 280, config: {} },
    { ts: T0 - 1 * DAY, kind: "eighty", seed: 3, score: 70, total: 80, secs: 480, config: { negativeMarking: false } },
  ];
  await h.setStorage({ oaRuns: prior });
  const run = OA.generate("ev", SEED);
  ok(run.questions.length === 20, "ev runs have 20 questions");
  const plan = run.questions.map((q, i) => (i % 5 === 1 ? "wrong" : i % 5 === 3 ? "skip" : "right"));
  const nRight = plan.filter(p => p === "right").length;

  const page = await prepPage(h, `?fixture=1&tab=oa&seed=${SEED}`, { install: T0 });
  await page.selectOption("select#oa-kind", "ev");

  // Quit discards the run: nothing is written.
  await page.click("button#oa-start");
  ok((await waitQuestion(page, 0)) === norm(run.questions[0].prompt), "first ev question matches generate(\"ev\", 123)");
  await page.fill("#oa-input", run.questions[0].answer.value);
  await page.press("#oa-input", "Enter");
  await waitQuestion(page, 1);
  await page.click("button#oa-quit");
  await sleep(700);
  same((await h.storage("oaRuns")).oaRuns, prior, "quitting writes nothing to oaRuns");

  // The real run, with the same page seed.
  await page.selectOption("select#oa-kind", "ev");
  await page.click("button#oa-start");
  for (let i = 0; i < run.questions.length; i++) {
    const q = run.questions[i];
    const text = await waitQuestion(page, i);
    ok(text === norm(q.prompt), `question ${i}: page "${text}", generate "${q.prompt}"`);
    if (i === 2) {
      await page.fill("#oa-input", "2 3");
      await page.press("#oa-input", "Enter");
      await waitAttr(page, "#oa-feedback", "data-state", "error");
      ok((await attrOf(page, "#oa-question", "data-index")) === "2", "a parse error stays on the question");
    }
    const value = A.parseAnswer(q.answer.value).value;
    const typed = plan[i] === "right" ? q.answer.value : plan[i] === "wrong" ? String(value + 7) : "";
    await page.fill("#oa-input", typed);
    await page.press("#oa-input", "Enter");
  }
  await waitVisible(page, "#oa-results", "#oa-results after the last question");
  const results = await el(page, "#oa-results");
  same(pick(results.attrs, ["data-score", "data-total"]), { "data-score": String(nRight), "data-total": "20" }, "ev results");

  const missedWant = run.questions.filter((q, i) => plan[i] !== "right");
  const missed = (await page.$$eval("ul#oa-missed li.oa-missed", ls => ls.map(l => l.textContent))).map(norm);
  ok(missed.length === missedWant.length, `#oa-missed lists ${missed.length} questions, expected ${missedWant.length} (wrong + skipped)`);
  missedWant.forEach((q, k) => {
    ok(missed[k].includes(norm(q.prompt)) && missed[k].includes(q.answer.value), `missed #${k} "${missed[k]}" must include "${q.prompt}" and ${q.answer.value}`);
  });

  const st = await waitStorage(h, ["oaRuns", "practiceLog"], s => (s.oaRuns || []).length === prior.length + 1, "the finished ev run in oaRuns");
  const mine = st.oaRuns.filter(r => r.kind === "ev" && r.seed === SEED);
  ok(mine.length === 1, `exactly one stored ev run with seed ${SEED}`);
  same(pick(mine[0], ["kind", "seed", "score", "total", "config"]), { kind: "ev", seed: SEED, score: nRight, total: 20, config: {} }, "oaRuns entry");
  ok(typeof mine[0].ts === "number" && Number.isInteger(mine[0].secs) && mine[0].secs >= 0 && mine[0].secs <= 300, `ts/secs ${mine[0].ts} ${mine[0].secs}`);
  const best = OA.personalBest(st.oaRuns, "ev");
  const trend = OA.trend(st.oaRuns, "ev");
  ok(best === 19, `personalBest over the stored runs is the seeded 19, got ${best}`);
  same(trend, [5, 19, nRight], "trend over the stored ev runs, oldest first");
  ok((await attrOf(page, "#oa-best", "data-best")) === String(best), `#oa-best data-best ${await attrOf(page, "#oa-best", "data-best")}, expected ${best}`);
  ok((await attrOf(page, "#oa-trend", "data-points")) === trend.join(","), `#oa-trend data-points ${await attrOf(page, "#oa-trend", "data-points")}, expected ${trend.join(",")}`);
  ok(!(st.practiceLog || []).some(e => e.track === "zetamac"), "an ev run writes no zetamac entry");
  await page.close();
}

async function v4_10(h) {
  h.clearReplies();
  await h.clearStorage();
  const M = require("../prep/market.js");
  const SEED = 7;
  // §G5 worked example: createGame("dice", 7), outcomes [1, 6, 5], mixed bots, maxWidth 4.
  const QUOTES = [
    { fair: 10.5, bid: 9.5, ask: 11.5 },
    { fair: 8, bid: 7, ask: 9 },
    { fair: 10, bid: 9, ask: 11 },
  ];
  const WORKED_FILLS = [
    ["noise", "buy", "9.5"], ["informed", "buy", "9.5"],
    ["noise", "sell", "9"], ["informed", "sell", "9"],
    ["noise", "sell", "11"], ["informed", "sell", "11"],
  ];
  let game = M.createGame("dice", SEED);
  const nodeFills = [];
  for (const q of QUOTES) {
    const r = M.submitQuote(game, q);
    ok(r.ok, `node replay of the worked example: ${r.error}`);
    nodeFills.push(...r.fills);
    game = r.state;
  }
  const metrics = M.settle(game);

  const page = await prepPage(h, `?fixture=1&tab=market&seed=${SEED}`);
  await waitActiveTab(page, "market");
  await page.selectOption("select#mm-scenario", "dice");
  await page.click("button#mm-start");
  await waitAttr(page, "#mm-round", "data-round", "0");
  ok((await attrOf(page, "#mm-round", "data-rounds")) === "3", "dice seed 7 has 3 rounds");
  ok((await attrOf(page, "#mm-revealed", "data-revealed")) === "", "nothing revealed before round 0");

  const quote = async (q, how = "click") => {
    await page.fill("input#mm-fair", String(q.fair));
    await page.fill("input#mm-bid", String(q.bid));
    await page.fill("input#mm-ask", String(q.ask));
    if (how === "enter") await page.press("input#mm-ask", "Enter");
    else await page.click("button#mm-submit");
  };
  const unchanged = async what => {
    ok((await attrOf(page, "#mm-round", "data-round")) === "0", `${what}: the round is unchanged`);
    ok(await page.locator("table#mm-rounds tr.mm-round-row").count() === 0, `${what}: no round row`);
    ok(await page.locator("li.mm-fill").count() === 0, `${what}: no fills`);
    ok((await attrOf(page, "#mm-revealed", "data-revealed")) === "", `${what}: nothing revealed`);
  };

  await quote({ fair: 10, bid: 11, ask: 10 });
  await waitVisible(page, "#mm-error", "#mm-error for bid >= ask");
  ok(/bid/i.test(await textOf(page, "#mm-error")), `bid >= ask error text: ${await textOf(page, "#mm-error")}`);
  await unchanged("bid > ask");
  await quote({ fair: 10, bid: 10, ask: 10 });
  await sleep(300);
  await waitVisible(page, "#mm-error", "#mm-error for bid = ask");
  ok(/bid/i.test(await textOf(page, "#mm-error")), `bid = ask error text: ${await textOf(page, "#mm-error")}`);
  await unchanged("bid = ask");
  await quote({ fair: 10, bid: 5, ask: 15 });
  await until(async () => (await isVis(page, "#mm-error")) && /width/i.test(await textOf(page, "#mm-error")), "#mm-error for width 10");
  await unchanged("width 10");

  await quote(QUOTES[0]);
  await waitAttr(page, "#mm-round", "data-round", "1");
  await waitHidden(page, "#mm-error", "#mm-error after an accepted quote");
  ok((await attrOf(page, "#mm-revealed", "data-revealed")) === "1", "round 0 reveals the first die");
  await quote(QUOTES[1], "enter");
  await waitAttr(page, "#mm-round", "data-round", "2");
  ok((await attrOf(page, "#mm-revealed", "data-revealed")) === "1,6", "round 1 reveals the second die");
  await quote(QUOTES[2]);
  await waitVisible(page, "#mm-settlement", "#mm-settlement after the last round");
  ok((await attrOf(page, "#mm-revealed", "data-revealed")) === "1,6,5", "everything revealed at the end");

  const fills = await page.$$eval("li.mm-fill", ls => ls.map(l => [l.getAttribute("data-bot"), l.getAttribute("data-user-side"), l.getAttribute("data-price"), l.getAttribute("data-rejected")]));
  same(fills, WORKED_FILLS.map(f => [...f, "false"]), "li.mm-fill = the worked example");
  same(fills, nodeFills.map(f => [f.bot, f.userSide, String(f.price), String(f.rejected)]), "li.mm-fill = the Node replay");
  const rows = await page.$$eval("table#mm-rounds tr.mm-round-row", rs => rs.map(r => r.getAttribute("data-round")));
  same(rows, ["0", "1", "2"], "one round row per round");
  const sett = await el(page, "#mm-settlement");
  const SETT_KEYS = ["data-v", "data-pnl", "data-edge", "data-adverse", "data-trades", "data-max-pos"];
  same(pick(sett.attrs, SETT_KEYS), { "data-v": "12", "data-pnl": "-3", "data-edge": "5", "data-adverse": "1.5", "data-trades": "6", "data-max-pos": "2" }, "settlement (worked example)");
  same(pick(sett.attrs, SETT_KEYS), {
    "data-v": String(metrics.V), "data-pnl": String(metrics.pnl), "data-edge": String(metrics.edge),
    "data-adverse": String(metrics.adverse), "data-trades": String(metrics.trades), "data-max-pos": String(metrics.maxPos),
  }, "settlement = settle() of the Node replay");
  ok((await textOf(page, "#mm-good-quoter")) === M.goodQuoterLine(game), `#mm-good-quoter: "${await textOf(page, "#mm-good-quoter")}" vs "${M.goodQuoterLine(game)}"`);

  const st = await waitStorage(h, "mmRuns", s => (s.mmRuns || []).length === 1, "the mmRuns entry");
  const run = st.mmRuns[0];
  same(pick(run, ["scenario", "seed", "pnl", "edge", "trades", "maxPos", "fairErrors"]), { scenario: "dice", seed: SEED, pnl: -3, edge: 5, trades: 6, maxPos: 2, fairErrors: [0, 0, 0.5] }, "mmRuns entry (worked example)");
  same(run, M.runEntry(game, run.ts), "mmRuns entry = runEntry(state, ts)");
  await page.close();
}

async function v4_11(h) {
  h.clearReplies();
  await h.clearStorage();
  const R = require("../prep/readiness.js");
  const fx = loadFixture(h);
  const T = new Date(2026, 10, 5, 12, 0, 0).getTime(); // Thu 5 Nov 2026 12:00 local (fixed for the checkpoint)
  for (const id of [FX.NUM_7_36, FX.MCQ_COINS, FX.NUM_DISPUTED, FX.NUM_EV, FX.FREE_WEIGH]) fxItem(fx, id);

  const lcSolves = [
    { slug: "contains-duplicate", title: "Contains Duplicate", difficulty: "Easy", ts: T - 10 * DAY, secs: 400, noAI: true },
    { slug: "valid-anagram", title: "Valid Anagram", difficulty: "Easy", ts: T - 9 * DAY, secs: 300, noAI: false },
    { slug: "two-sum", title: "Two Sum", difficulty: "Easy", ts: T - 8 * DAY, secs: 200 },
    { slug: "valid-parentheses", title: "Valid Parentheses", difficulty: "Medium", ts: T - 7 * DAY, secs: 900, noAI: true },
    { slug: "fixture-add-two", title: "Add Two Numbers", difficulty: "Medium", ts: T - 6 * DAY, secs: 1500, noAI: null },
  ];
  const practiceLog = [
    { ts: T - 4 * DAY, track: "probability", amount: 4, unit: "problems", note: "Green Book ch.2" },
    { ts: T - 3 * DAY, track: "zetamac", amount: 30, unit: "score", note: "120s" },
    { ts: T - 2 * DAY, track: "zetamac", amount: 40, unit: "score", note: "120s" },
    { ts: T - 1 * DAY, track: "zetamac", amount: 50, unit: "score", note: "in-app" },
  ];
  const card = (interval, due, reps, lapses) => ({ ease: 2.5, interval, due, reps, lapses, last: T - 5 * DAY, seen: T - 40 * DAY });
  const prepCards = {
    [FX.NUM_7_36]: card(30, T + 20 * DAY, 4, 0),
    [FX.MCQ_COINS]: card(3, T + DAY, 2, 0),
    [FX.NUM_DISPUTED]: card(0, T - 3 * DAY + 10 * MINUTE, 0, 1),
    [FX.NUM_EV]: card(1, T - DAY, 1, 0),
    [FX.FREE_WEIGH]: card(1, T, 1, 0),
  };
  const hist = (d, itemId, mode, correct, grade, answer) => ({ ts: T - d * DAY, itemId, mode, correct, grade, secs: 60, answer });
  const prepHistory = [
    hist(5, FX.NUM_7_36, "auto", true, "good", "7/36"),
    hist(4, FX.MCQ_COINS, "auto", true, "good", 2),
    hist(3, FX.NUM_DISPUTED, "auto", false, "again", "1/2"),
    hist(2, FX.NUM_EV, "auto", true, "good", "161/36"),
    hist(1, FX.FREE_WEIGH, "self", null, "good", "three groups"),
  ];
  const prepMistakes = [
    { ts: T - 6 * DAY, itemId: FX.NUM_DISPUTED, answer: "0.5", note: "" },
    { ts: T - 3 * DAY, itemId: FX.NUM_DISPUTED, answer: "1/2", note: "" },
    { ts: T - 2 * DAY, itemId: FX.NUM_7_36, answer: "0.2", note: "" },
    { ts: T - 1 * DAY, itemId: FX.NUM_EV, answer: "4", note: "" },
    { ts: T - 1 * DAY + 1000, itemId: "fixture-p99-q9-00000000", answer: "1", note: "" }, // unknown item: ignored
  ];
  const facts = { weak_topic_dp: "DP", interview_quantdev_20261101: "Verdict: 6/10. Saved.", interview_trader_20261103: "Score 7/10 overall" };
  await h.setStorage({ lcSolves, practiceLog, prepCards, prepHistory, prepMistakes });
  await h.seedState({ memory: { facts } });

  const scores = R.areaScores({ bank: fx.items, cards: prepCards, history: prepHistory, lcSolves, nc150: fx.nc150, practiceLog, oaRuns: [], mmRuns: [], facts });
  // Hand checks of the seeds (§H3): oa, market, cpp and systems have no data at all.
  const nPB = fx.items.filter(i => i.area === "probability" || i.area === "brainteaser").length;
  same(pick(scores, AREA_KEYS), {
    coding: 39, // 50·4/150 + 30·min(1, 1200/1200) + 20·2/5
    probability: Math.round(60 * (1 / nPB) + 40 * (3 / 4)),
    cpp: null, systems: null,
    mental: 67, // 100 · mean(30, 40, 50) / 60
    oa: null, market: null,
    mocks: 65, // 10 · mean(6, 7)
  }, "areaScores of the seeds");
  const handAreas = [39, Math.round(60 * (1 / nPB) + 40 * (3 / 4)), 67, 65];
  ok(scores.overall === Math.round(handAreas.reduce((a, b) => a + b, 0) / handAreas.length), `overall ${scores.overall} = the rounded mean of the non-null areas`);

  const page = await prepPage(h, "?fixture=1&tab=dashboard", { fixedTime: T });
  await waitActiveTab(page, "dashboard");
  await until(async () => (await page.locator(".area-score[data-area]").count()) >= AREA_KEYS.length, "the area scores");
  await waitAttr(page, "#overall-score", "data-score", String(scores.overall));
  const dash = await page.evaluate(() => {
    const all = s => Array.from(document.querySelectorAll(s));
    const one = s => document.querySelector(s);
    return {
      areas: all(".area-score[data-area]").map(e => ({ area: e.getAttribute("data-area"), score: e.getAttribute("data-score"), value: e.querySelector(".value") ? e.querySelector(".value").textContent : null })),
      overall: one("#overall-score") ? one("#overall-score").getAttribute("data-score") : null,
      patterns: all(".nc-pattern[data-pattern]").map(e => [e.getAttribute("data-pattern"), e.getAttribute("data-solved"), e.getAttribute("data-total")]),
      next: one("a#nc150-next") ? { href: one("a#nc150-next").getAttribute("href"), text: one("a#nc150-next").textContent } : null,
      topics: all(".mistake-topic[data-topic]").map(t => ({
        topic: t.getAttribute("data-topic"), count: t.getAttribute("data-count"),
        entries: Array.from(t.querySelectorAll(".mistake-entry[data-item-id][data-ts]")).map(m => `${m.getAttribute("data-item-id")}@${m.getAttribute("data-ts")}`),
      })),
      checkpoint: one("#checkpoint") ? one("#checkpoint").textContent : null,
      under60: one("#under60") ? one("#under60").textContent : null,
      mocks: all(".mock-mode[data-mode]").map(e => [e.getAttribute("data-mode"), e.getAttribute("data-scores")]),
    };
  });

  for (const k of AREA_KEYS) {
    const a = dash.areas.find(x => x.area === k);
    ok(a, `.area-score[data-area="${k}"] exists`);
    const want = scores[k];
    ok(a.score === (want === null ? "" : String(want)), `${k} data-score "${a.score}", expected ${want === null ? '""' : want}`);
    ok(norm(a.value) === (want === null ? "no data" : String(want)), `${k} .value "${norm(a.value)}", expected ${want === null ? "no data" : want}`);
  }
  ok(dash.overall === String(scores.overall), `#overall-score data-score ${dash.overall}, expected ${scores.overall}`);

  // nc150 bars and the next link (solved iff a solve has the slug; computed here from the fixture list).
  const solved = new Set(lcSolves.map(s => s.slug));
  const byPattern = {};
  for (const p of fx.nc150.problems) {
    byPattern[p.pattern] = byPattern[p.pattern] || { solved: 0, total: 0 };
    byPattern[p.pattern].total++;
    if (solved.has(p.slug)) byPattern[p.pattern].solved++;
  }
  same(Object.fromEntries(dash.patterns.map(([p, s, t]) => [p, { solved: Number(s), total: Number(t) }])), byPattern, ".nc-pattern bars");
  same(byPattern["Arrays & Hashing"], { solved: 3, total: 4 }, "Arrays & Hashing in the fixture list");
  const nextP = fx.nc150.problems.find(p => !solved.has(p.slug));
  ok(nextP.slug === "group-anagrams", "the first unsolved fixture problem is group-anagrams");
  ok(dash.next && dash.next.href === nextP.url && norm(dash.next.text) === norm(nextP.problem), `a#nc150-next: ${JSON.stringify(dash.next)}`);
  ok(await isVis(page, "a#nc150-next"), "a#nc150-next is visible while a problem is unsolved");

  // Mistakes grouped by topic, recurring first.
  const groups = R.mistakeTopics(prepMistakes, fx.items);
  same(groups.map(g => g.topic), ["dice", "bayes", "conditional", "expected-value", "order-statistics"], "mistakeTopics order of the seeds");
  same(dash.topics.map(t => [t.topic, t.count]), groups.map(g => [g.topic, String(g.count)]), ".mistake-topic order and data-count");
  for (const g of groups) {
    const shown = dash.topics.find(t => t.topic === g.topic);
    same([...shown.entries].sort(), g.entries.map(m => `${m.itemId}@${m.ts}`).sort(), `.mistake-entry elements under ${g.topic}`);
  }

  const cp = h.P.amNextCheckpoint(h.P.AM_CHECKPOINTS, new Date(T));
  ok(cp, "a checkpoint is ahead of 5 Nov 2026");
  ok(norm(dash.checkpoint) === norm(`Next checkpoint: ${cp.due} (${cp.daysLeft} days left) — ${cp.label}`), `#checkpoint: ${norm(dash.checkpoint)}`);
  const u60 = R.under60(scores);
  same(u60, ["coding", "probability"], "areas under 60 for the seeds");
  ok(norm(dash.under60) === `Under 60: ${u60.join(", ")}`, `#under60: ${norm(dash.under60)}`);

  const verdicts = R.mockVerdicts(facts);
  for (const m of MOCK_MODES) {
    const shown = dash.mocks.find(([mode]) => mode === m);
    const want = verdicts[m].map(v => v.score).join(",");
    if (want) ok(shown && shown[1] === want, `.mock-mode[data-mode="${m}"] data-scores ${shown && shown[1]}, expected ${want}`);
    else ok(!shown || shown[1] === "", `.mock-mode[data-mode="${m}"] has no scores`);
  }
  same(["quantdev", "trader"].map(m => dash.mocks.find(([mode]) => mode === m)?.[1]), ["6", "7"], "mock scores per mode");
  await page.close();
}

async function v4_12(h) {
  h.clearReplies();
  await h.clearStorage();
  const Srs = require("../prep/srs.js");
  const fx = loadFixture(h);
  const T = new Date(2026, 10, 5, 12, 0, 0).getTime(); // no cards are stored, so `now` does not change the queue
  const count = file => fx.items.filter(i => i.source.file === file).length;
  const wantEntries = fx.library.categories.flatMap(c => c.entries.map(e => ({ folder: c.folder, file: e.file })));

  const page = await prepPage(h, "?fixture=1&tab=library");
  await waitActiveTab(page, "library");
  await until(async () => (await page.locator(".lib-entry[data-file]").count()) >= wantEntries.length, "the library entries");
  const folders = await page.$$eval(".lib-category[data-folder]", cs => cs.map(c => c.getAttribute("data-folder")));
  same(folders, fx.library.categories.map(c => c.folder), ".lib-category order = index order");
  const shown = await page.$$eval(".lib-entry[data-file]", es => es.map(e => {
    const cat = e.closest(".lib-category[data-folder]");
    const a = e.querySelector("a.lib-open");
    const c = e.querySelector(".lib-count");
    return { folder: cat ? cat.getAttribute("data-folder") : null, file: e.getAttribute("data-file"), href: a ? a.href : null, count: c ? c.textContent : null, practice: !!e.querySelector("button.lib-practice") };
  }));
  same(shown.map(s => ({ folder: s.folder, file: s.file })), wantEntries, ".lib-entry files, in index order and under their category");
  for (const s of shown) {
    const href = `chrome-extension://${h.EXT}/${FIXTURE_ROOT}library/${encodeURI(s.file)}`;
    ok(s.href === href, `a.lib-open for ${s.file}: ${s.href}, expected ${href}`);
    ok(norm(s.count) === String(count(s.file)), `.lib-count for ${s.file}: "${norm(s.count)}", expected ${count(s.file)}`);
    ok(s.practice, `button.lib-practice for ${s.file}`);
  }
  const empty = shown.find(s => s.file === "fixture-empty.pdf");
  ok(empty && norm(empty.count) === "0", "fixture-empty.pdf is listed with count 0 (§L3)");

  // Practice from the smallest non-empty source: the session is exactly drillQueue of that source's items.
  const target = wantEntries.filter(e => count(e.file) > 0).sort((a, b) => count(a.file) - count(b.file))[0];
  const srcItems = fx.items.filter(i => i.source.file === target.file);
  const expected = Srs.drillQueue(srcItems, {}, T, { count: srcItems.length });
  ok(expected.length === srcItems.length, "drillQueue takes every item of the source");
  await Promise.all([
    page.waitForURL(u => /[?&]source=/.test(String(u)), { timeout: 15000 }),
    page.click(`.lib-entry[data-file="${target.file}"] button.lib-practice`),
  ]);
  await page.waitForFunction(() => !!document.body && document.body.dataset.ready === "1", null, { timeout: 15000 });
  const url = new URL(page.url());
  ok(url.pathname.endsWith("/prep.html"), `stays on prep.html: ${page.url()}`);
  same([url.searchParams.get("tab"), url.searchParams.get("source"), url.searchParams.get("fixture")], ["practice", target.file, "1"], "practice-from-source URL keeps fixture=1");
  await waitActiveTab(page, "practice");
  const ids = await playSession(page, "#tab-practice", fx);
  same(ids, expected, `the session from ${target.file}`);
  const sum = await el(page, '#tab-practice [data-role="summary"]');
  ok(sum.attrs["data-answered"] === String(srcItems.length), `summary data-answered ${sum.attrs["data-answered"]}`);
  const st = await waitStorage(h, "prepHistory", s => (s.prepHistory || []).length === srcItems.length, "one history entry per source item");
  ok(st.prepHistory.every(e => fx.byId[e.itemId] && fx.byId[e.itemId].source.file === target.file), "every answered item is from the source");
  await page.close();
}

async function v4_13(h) {
  h.clearReplies();
  await h.clearStorage();
  await h.seedState({ apiKey: "", lastCheckin: h.amTodayKey() });
  const t = Date.now();
  const old = { slug: "two-sum", title: "Two Sum", difficulty: "Easy", ts: t - 3 * DAY, secs: 300 };
  const known = { slug: "valid-anagram", title: "Valid Anagram", difficulty: "Easy", ts: t - 2 * DAY, secs: 200, noAI: false };
  const fresh = { slug: "contains-duplicate", title: "Contains Duplicate", difficulty: "Easy", ts: t, secs: 240 };
  const fresh2 = { slug: "group-anagrams", title: "Group Anagrams", difficulty: "Medium", ts: t + 1000, secs: 900 };
  await h.setStorage({ lcSolves: [old] });
  const panel = await panelPage(h, { query: "?fixture=1" });
  ok(await panel.locator("#noaiPrompt").count() === 1, "#noaiPrompt exists");
  ok(!(await isVis(panel, "#noaiPrompt")), "#noaiPrompt is hidden by default");

  // An added record that already has an answer does not prompt.
  await h.setStorage({ lcSolves: [old, known] });
  await sleep(1500);
  ok(!(await isVis(panel, "#noaiPrompt")), "no prompt for an added solve whose noAI is already known");

  // A newly added solve with unknown noAI shows the prompt; Yes sets noAI: true on that record.
  await h.setStorage({ lcSolves: [old, known, fresh] });
  await waitVisible(panel, "#noaiPrompt", "the no-AI prompt");
  ok((await attrOf(panel, "#noaiPrompt", "data-slug")) === fresh.slug, `data-slug ${await attrOf(panel, "#noaiPrompt", "data-slug")}`);
  ok((await textOf(panel, "#noaiText")) === "Solved without AI?", `#noaiText: ${await textOf(panel, "#noaiText")}`);
  ok((await textOf(panel, "button#noaiYes")) === "Yes" && (await textOf(panel, "button#noaiNo")) === "No", "Yes / No buttons");
  await panel.click("button#noaiYes");
  let st = await waitStorage(h, "lcSolves", s => (s.lcSolves || []).some(x => x.slug === fresh.slug && x.ts === fresh.ts && x.noAI === true), "noAI: true on the new solve");
  const byKey = list => Object.fromEntries(list.map(x => [`${x.slug}@${x.ts}`, x]));
  let k = byKey(st.lcSolves);
  ok(k[`${old.slug}@${old.ts}`] && k[`${old.slug}@${old.ts}`].noAI == null, "the older record stays unknown");
  ok(k[`${known.slug}@${known.ts}`] && k[`${known.slug}@${known.ts}`].noAI === false, "the known record keeps noAI: false");
  ok(st.lcSolves.length === 3, `no record added or dropped: ${st.lcSolves.length}`);
  await waitHidden(panel, "#noaiPrompt", "the prompt after Yes");
  await h.waitForLog(e => e.component === "noai" && e.event === "set" && e.data && e.data.slug === fresh.slug && e.data.noAI === true, 10000, "noai:set log (Yes)");

  // No sets noAI: false.
  await h.setStorage({ lcSolves: [...st.lcSolves, fresh2] });
  await until(async () => (await isVis(panel, "#noaiPrompt")) && (await attrOf(panel, "#noaiPrompt", "data-slug")) === fresh2.slug, "the prompt for the second new solve");
  await panel.click("button#noaiNo");
  st = await waitStorage(h, "lcSolves", s => (s.lcSolves || []).some(x => x.slug === fresh2.slug && x.ts === fresh2.ts && x.noAI === false), "noAI: false on the second new solve");
  k = byKey(st.lcSolves);
  ok(k[`${fresh.slug}@${fresh.ts}`].noAI === true, "the first answer is kept");
  await waitHidden(panel, "#noaiPrompt", "the prompt after No");
  await h.waitForLog(e => e.component === "noai" && e.event === "set" && e.data && e.data.slug === fresh2.slug && e.data.noAI === false, 10000, "noai:set log (No)");
  await panel.close();
}

async function v4_14(h) {
  h.clearReplies();
  await h.clearStorage();
  await h.seedState({ apiKey: "", lastCheckin: h.amTodayKey(), dailyGoal: "2 problems", history: {} });
  const PREP_URL = `chrome-extension://${h.EXT}/prep.html`;
  const prepTabs = () => h.util.evaluate(url => chrome.tabs.query({}).then(ts =>
    ts.filter(t => String(t.pendingUrl || t.url || "").startsWith(url)).map(t => ({ id: t.id, active: t.active }))), PREP_URL);
  const prepPages = () => h.context.pages().filter(p => !p.isClosed() && p.url().startsWith(PREP_URL));
  // Pages the extension opens during the clicks get the "prep" diagnostics label.
  const onPage = p => h.attachDiagnostics(p, "prep");

  const panel = await panelPage(h, { query: "?fixture=1" });
  const btn = panel.locator(".header-right button#prepBtn");
  ok(await btn.count() === 1, "button#prepBtn in .header-right");
  ok((await btn.getAttribute("title")) === "Open Prep", `title: ${await btn.getAttribute("title")}`);
  ok(norm(await btn.textContent()).includes("📚"), "📚 button");
  ok((await prepTabs()).length === 0, "no prep.html tab before the click");

  h.context.on("page", onPage);
  try {
    await btn.click();
    await until(async () => (await prepTabs()).length === 1 && prepPages().length === 1, "one prep.html tab after 📚");
  } finally {
    h.context.off("page", onPage);
  }
  await sleep(1000);
  let tabs = await prepTabs();
  ok(tabs.length === 1 && prepPages().length === 1, `📚 opens prep.html exactly once (${tabs.length} tabs)`);
  const firstId = tabs[0].id;
  await h.waitForLog(e => e.component === "prep" && e.event === "open" && e.data && e.data.created === true, 10000, "prep:open log with created: true");

  // Second click focuses the same tab.
  await panel.bringToFront();
  await until(async () => { const t = await prepTabs(); return t.length === 1 && t[0].active === false; }, "the panel tab to be active again");
  await btn.click();
  await until(async () => { const t = await prepTabs(); return t.length === 1 && t[0].id === firstId && t[0].active === true; }, "the same prep.html tab to be focused");
  await sleep(1000);
  tabs = await prepTabs();
  ok(tabs.length === 1 && tabs[0].id === firstId && prepPages().length === 1, `a second 📚 click must not open another tab (${tabs.length} tabs)`);
  await h.waitForLog(e => e.component === "prep" && e.event === "open" && e.data && e.data.created === false, 10000, "prep:open log with created: false");

  // The overlay's "Take me to Prep" opens prep.html.
  for (const p of prepPages()) await p.close();
  await until(async () => (await prepTabs()).length === 0, "the prep.html tab to close");
  await panel.close();
  const yt = await h.context.newPage();
  h.attachDiagnostics(yt, "youtube");
  await yt.goto("https://www.youtube.com/", { waitUntil: "domcontentloaded" });
  await yt.locator("#am-distraction-overlay").waitFor({ state: "attached", timeout: 10000 });
  const goPrep = yt.locator("#am-distraction-overlay .go.prep");
  await until(async () => (await goPrep.count()) === 1, "#am-distraction-overlay .go.prep", 10000);
  ok(norm(await goPrep.textContent()) === "Take me to Prep", `overlay button text: ${norm(await goPrep.textContent())}`);
  const labels = (await yt.locator("#am-distraction-overlay .go").allTextContents()).map(norm);
  const zi = labels.findIndex(s => /Zetamac/.test(s));
  const pi = labels.indexOf("Take me to Prep");
  ok(zi >= 0 && pi > zi, `the Prep button comes after the Zetamac button: ${JSON.stringify(labels)}`);
  h.context.on("page", onPage);
  try {
    await goPrep.click();
    await until(async () => (await prepTabs()).length === 1, "prep.html opened from the overlay");
  } finally {
    h.context.off("page", onPage);
  }
  await h.waitForLog(e => e.component === "distraction" && e.event === "go-to-prep" && e.data && e.data.host === "youtube.com", 10000, "distraction:go-to-prep log");
  await until(async () => (await h.allLogs()).filter(e => e.component === "prep" && e.event === "open" && e.data && e.data.created === true).length >= 2, "a second prep:open log with created: true");
  await yt.close();
}

async function v4_15(h) {
  h.clearReplies();
  await h.clearStorage();
  h.requests.length = 0;
  const Srs = require("../prep/srs.js");
  const fx = loadFixture(h);
  const t = Date.now();
  const prepCards = { [FX.SYS_MCQ_LINE]: { ease: 2.5, interval: 1, due: t - 2 * DAY, reps: 1, lapses: 0, last: t - 3 * DAY, seen: t - 3 * DAY } };
  await h.setStorage({ prepCards });
  await h.seedState({ apiKey: "sk-or-e2e", lastCheckin: h.amTodayKey() });
  const ASK = "assign me a conditional drill";
  h.addReply(b => h.lastUser(b).includes(ASK), h.toolReply("assign_drill", { area: "probability", topics: ["conditional"], count: 2 }));

  const panel = await panelPage(h, { query: "?fixture=1" });
  const from = h.requests.length;
  const askReq = await chatTurn(h, panel, `${ASK}, two items please`);
  // §J8 schema, exact except for description texts (§K3 v4-15).
  const drillTool = (askReq.tools || []).find(t => t && t.function && t.function.name === "assign_drill");
  ok(drillTool, "the request's tools include assign_drill");
  ok(typeof drillTool.function.description === "string" && drillTool.function.description.length > 0, "assign_drill has a description");
  const noDesc = x => Array.isArray(x) ? x.map(noDesc)
    : x && typeof x === "object" ? Object.fromEntries(Object.entries(x).filter(([k]) => k !== "description").map(([k, v]) => [k, noDesc(v)]))
    : x;
  same(noDesc(drillTool), {
    type: "function",
    function: {
      name: "assign_drill",
      parameters: {
        type: "object",
        properties: {
          area: { type: "string", enum: ["probability", "brainteaser", "statistics", "finance", "cpp", "systems"] },
          topics: { type: "array", items: { type: "string" } },
          count: { type: "integer", minimum: 1, maximum: 50 },
        },
        required: ["area", "count"],
      },
    },
  }, "assign_drill schema (§J8)");
  const st = await waitStorage(h, "prepDrill", s => s.prepDrill && s.prepDrill.status === "pending", "a pending prepDrill");
  const d = st.prepDrill;
  same(pick(d, ["area", "topics", "count", "status", "done", "correct", "doneTs"]),
    { area: "probability", topics: ["conditional"], count: 2, status: "pending", done: 0, correct: 0, doneTs: null }, "stored drill");
  ok(typeof d.ts === "number" && d.id === `drill-${d.ts}`, `drill id/ts: ${d.id} ${d.ts}`);
  const toolRound = await waitNewRequest(h, from, b => (b.messages || []).some(m => m.role === "tool"), "the tool-result request");
  const toolMsg = toolRound.messages.find(m => m.role === "tool");
  ok(toolMsg.content === "assigned drill: 2 conditional items", `tool result: ${toolMsg.content}`);
  await h.waitForLog(e => e.component === "drill" && e.event === "assigned", 10000, "drill:assigned log");
  const pendingReq = await chatTurn(h, panel, "what is pending in prep?");
  ok(pendingReq.messages[0].content.includes("Buddy drill pending in Prep: 2 conditional items."), "the next system prompt mentions the pending drill");

  // prep.html Today: due count, banner, drill start.
  const prep = await prepPage(h, "?fixture=1");
  await waitActiveTab(prep, "today");
  const due = await el(prep, "#today-due");
  ok(due && due.attrs["data-count"] === "1" && norm(due.text) === "Due today: 1", `#today-due: ${JSON.stringify(due && [due.attrs["data-count"], norm(due.text)])}`);
  await waitVisible(prep, "#drill-banner", "the drill banner");
  ok((await textOf(prep, "#drill-banner")).includes("Buddy drill: 2 conditional items"), `#drill-banner: ${await textOf(prep, "#drill-banner")}`);
  await prep.click("button#drill-start");
  // The only stored card is a systems card, so the drill queue does not depend on `now`.
  const expected = Srs.drillQueue(fx.items, prepCards, t, { area: "probability", topics: ["conditional"], count: 2 });
  ok(expected.length === 2, "the fixture has at least 2 conditional probability items (§L2 rule 4)");
  const ids = await playSession(prep, "#tab-practice", fx);
  same(ids, expected, "the drill session");
  for (const id of ids) ok(fx.byId[id].area === "probability" && fx.byId[id].topics.includes("conditional"), `${id} is a conditional probability item`);
  const st2 = await waitStorage(h, "prepDrill", s => s.prepDrill && s.prepDrill.status === "done", "the drill to be done");
  same(pick(st2.prepDrill, ["id", "status", "done", "correct", "count"]), { id: d.id, status: "done", done: 2, correct: 2, count: 2 }, "finished drill");
  ok(typeof st2.prepDrill.doneTs === "number", "doneTs is set");
  await prep.click('button.tab[data-tab="today"]');
  await waitActiveTab(prep, "today");
  await waitHidden(prep, "#drill-banner", "the drill banner once the drill is done");
  await prep.close();

  // The buddy sees the finished drill in the next request's system prompt.
  const doneReq = await chatTurn(h, panel, "did I finish the drill?");
  ok(doneReq.messages[0].content.includes("Buddy drill finished: 2/2 conditional items"), "system prompt contains 'Buddy drill finished: 2/2 conditional items'");
  ok(doneReq.messages[0].content.includes("Buddy drill finished: 2/2 conditional items, 2 correct."), "the finished line reports 2 correct");
  await panel.close();
}

async function v4_16(h) {
  h.clearReplies();
  await h.clearStorage();
  h.requests.length = 0;
  const R = require("../prep/readiness.js");
  const Srs = require("../prep/srs.js");
  const fx = loadFixture(h);
  for (const id of [FX.CPP_NUM_SIZEOF, FX.CPP_FREE_MOVE, FX.SYS_MCQ_LINE]) fxItem(fx, id);
  const T = new Date(2026, 10, 5, 12, 0, 0).getTime(); // fixed: "due today" is date-dependent
  const prepCards = {
    [FX.CPP_NUM_SIZEOF]: { ease: 2.5, interval: 1, due: T - 2 * DAY, reps: 1, lapses: 0, last: T - 3 * DAY, seen: T - 9 * DAY },
    [FX.CPP_FREE_MOVE]: { ease: 2.2, interval: 2, due: T + DAY, reps: 2, lapses: 2, last: T - DAY, seen: T - 10 * DAY },
    [FX.SYS_MCQ_LINE]: { ease: 2.5, interval: 10, due: T + 5 * DAY, reps: 3, lapses: 0, last: T - DAY, seen: T - 20 * DAY },
  };
  const prepHistory = [
    { ts: T - 3 * DAY, itemId: FX.CPP_NUM_SIZEOF, mode: "auto", correct: true, grade: "good", secs: 40, answer: "12" },
    { ts: T - 2.5 * DAY, itemId: FX.CPP_NUM_SIZEOF, mode: "auto", correct: true, grade: "good", secs: 35, answer: "12" },
    { ts: T - 2 * DAY, itemId: FX.CPP_FREE_MOVE, mode: "self", correct: null, grade: "again", secs: 50, answer: "" },
    { ts: T - 1 * DAY, itemId: FX.SYS_MCQ_LINE, mode: "auto", correct: true, grade: "good", secs: 10, answer: 2 },
  ];
  const prepMistakes = [{ ts: T - 2 * DAY, itemId: FX.CPP_FREE_MOVE, answer: "", note: "" }];
  await h.setStorage({ prepCards, prepHistory, prepMistakes });
  await h.seedState({ apiKey: "sk-or-e2e", lastCheckin: h.amTodayKey(new Date(T)) });

  const scores = R.areaScores({ bank: fx.items, cards: prepCards, history: prepHistory, lcSolves: [], nc150: fx.nc150, practiceLog: [], oaRuns: [], mmRuns: [], facts: {} });
  const line = R.prepSummaryLine({ scores, dueToday: Srs.dueCount(fx.items, prepCards, Srs.localDayStart(T, 1)), weakest: R.weakestTopics(prepMistakes, fx.items, T, 3) });
  ok(line === "Prep: overall 25 · prob n/a · cpp 20 · sys 30 · due today 1 · weakest: move-semantics, value-categories", `prepSummaryLine of the seeds: ${line}`);

  const panel = await panelPage(h, { fixedTime: T, query: "?fixture=1" });
  // prepData loads asynchronously during panel init (§E6) with no DOM signal, so a request sent
  // right after the banner renders may predate it: allow up to three requests for the full line.
  let sys = "";
  for (let k = 1; k <= 3; k++) {
    sys = (await chatTurn(h, panel, `quick status check please (${k})`)).messages[0].content;
    if (sys.includes(line)) break;
    await sleep(1000);
  }
  ok(PREP_LINE_RE.test(sys), "the system prompt has a line matching PREP_LINE_RE");
  ok(sys.includes(line), `the system prompt contains "${line}"`);
  const pt = sys.indexOf("## Practice tracks");
  const cpAt = sys.indexOf("Next checkpoint:", pt);
  ok(pt >= 0 && cpAt > pt && sys.indexOf(line, cpAt) > cpAt, "the Prep line sits in ## Practice tracks, after the checkpoint line");

  const interview = (mode, startRe) => runInterview(h, panel, mode, startRe);
  const qd = await interview("quantdev", /Begin the Quant dev interview/);
  ok(qd.startsWith("You are now running a MOCK QUANT DEVELOPER INTERVIEW"), "the quantdev prompt still leads the system prompt");
  const qdBlock = R.interviewMaterialBlock(R.pickInterviewMaterial(fx.items, prepCards, prepHistory, "quantdev", 3));
  ok(qdBlock.startsWith(MATERIAL_HEADER), "quantdev material block header");
  ok(qd.includes("## Material:") && qd.includes(qdBlock), "the quantdev prompt contains the material block");
  ok(qd.includes(fx.byId[FX.CPP_FREE_MOVE].prompt), "the quantdev material quotes a cpp fixture item's prompt");

  const tr = await interview("trader", /Begin the Trader interview/);
  const trBlock = R.interviewMaterialBlock(R.pickInterviewMaterial(fx.items, prepCards, prepHistory, "trader", 3));
  ok(trBlock.startsWith(MATERIAL_HEADER), "trader material block header");
  ok(tr.includes(trBlock), "the trader prompt contains the trader material block");

  const dsa = await interview("dsa", /Begin the mock interview/);
  ok(!dsa.includes(MATERIAL_HEADER), "the dsa prompt has no material block");
  await panel.close();
}

async function v4_17(h) {
  h.clearReplies();
  await h.clearStorage();
  h.requests.length = 0;
  const R = require("../prep/readiness.js");
  const Srs = require("../prep/srs.js");
  const fx = loadFixture(h);
  const T = new Date(2026, 10, 8, 10, 0, 0).getTime(); // Sunday 8 Nov 2026 10:00 local
  const prepHistory = [
    { ts: new Date(2026, 9, 30, 10, 0, 0).getTime(), itemId: FX.NUM_7_36, mode: "auto", correct: true, grade: "good", secs: 60, answer: "7/36" }, // before the week
    { ts: new Date(2026, 10, 5, 10, 0, 0).getTime(), itemId: FX.NUM_7_36, mode: "auto", correct: true, grade: "good", secs: 50, answer: "0.1944" },
    { ts: new Date(2026, 10, 6, 10, 0, 0).getTime(), itemId: FX.NUM_DISPUTED, mode: "auto", correct: false, grade: "again", secs: 70, answer: "1/2" },
    { ts: new Date(2026, 10, 7, 10, 0, 0).getTime(), itemId: FX.FREE_WEIGH, mode: "self", correct: null, grade: "good", secs: 90, answer: "three groups" },
  ];
  const prepCards = Srs.replayCards(prepHistory, T); // stored cards = replayed cards (§H8)
  await h.setStorage({ prepHistory, prepCards, prepMistakes: [{ ts: prepHistory[2].ts, itemId: FX.NUM_DISPUTED, answer: "1/2", note: "" }] });
  await h.seedState({ apiKey: "sk-or-e2e", lastCheckin: null });

  const panel = await panelPage(h, { fixedTime: T, query: "?fixture=1" });
  const weekly = await waitNewRequest(h, 0, b => /Automatic Sunday weekly review/.test(h.lastUser(b)), "the Sunday weekly review trigger");
  const t = h.lastUser(weekly);
  ok(t.includes("Prep week:"), `the trigger has "Prep week:": ${t}`);
  ok(t.includes("Score change since last Sunday:"), `the trigger has "Score change since last Sunday:": ${t}`);
  ok(t.includes("Prep week: 3 answered (prob 2 · brain 1 · stats 0 · fin 0 · cpp 0 · sys 0), auto-checked accuracy 50%."), `week totals of the seeds: ${t}`);
  ok(t.includes("Score change since last Sunday: overall 27 (-13) · coding n/a · prob 27 (-13) · cpp n/a · sys n/a · mental n/a · oa n/a · market n/a · mocks n/a."), `score changes of the seeds: ${t}`);
  const line = R.prepWeeklyLine({ bank: fx.items, cards: prepCards, history: prepHistory, lcSolves: [], nc150: fx.nc150, practiceLog: [], oaRuns: [], mmRuns: [], facts: {}, now: T });
  const cp = h.P.amNextCheckpoint(h.P.AM_CHECKPOINTS, new Date(T));
  const cpSentence = `Next checkpoint: ${cp.due} (${cp.daysLeft} days left) — ${cp.label}`;
  ok(t.includes(`${cpSentence}. ${line} Grade the week`), "prepWeeklyLine sits right after the checkpoint sentence, before 'Grade the week'");
  await panel.waitForFunction(() => document.getElementById("chatWindow").textContent.includes("Weekly review done"), null, { timeout: 15000 });
  await panel.close();
}

async function v4_18(h) {
  h.clearReplies();
  await h.clearStorage();
  const fx = loadFixture(h);
  fxItem(fx, FX.CPP_NUM_SIZEOF);
  fxItem(fx, FX.SYS_FREE_FALSESHARING);
  const S = within("#tab-practice");

  // Numeric: Enter in the input submits; after the result, Enter is Next.
  let page = await prepPage(h, `?fixture=1&item=${FX.CPP_NUM_SIZEOF}`);
  await currentItem(page, "#tab-practice");
  const input = page.locator(S('input[data-role="answer-input"]'));
  await input.fill("12");
  await input.press("Enter");
  await waitAttr(page, S('[data-role="result"]'), "data-state", "correct");
  let st = await waitStorage(h, "prepHistory", s => (s.prepHistory || []).length === 1, "the history entry after Enter");
  same(pick(st.prepHistory[0], ["itemId", "mode", "correct", "grade", "answer"]), { itemId: FX.CPP_NUM_SIZEOF, mode: "auto", correct: true, grade: "good", answer: "12" }, "history after Enter");
  await page.keyboard.press("Enter");
  await waitVisible(page, S('[data-role="summary"]'), "the summary after Enter on an auto result");
  await page.close();

  // Free: Enter in the textarea is a newline; 3 before the reveal does nothing; Space reveals; 3 grades good.
  await h.clearStorage();
  page = await prepPage(h, `?fixture=1&item=${FX.SYS_FREE_FALSESHARING}`);
  await currentItem(page, "#tab-practice");
  const ta = page.locator(S('textarea[data-role="free-input"]'));
  await ta.click();
  await page.keyboard.type("lines");
  await page.keyboard.press("Enter");
  await page.keyboard.type("bounce");
  ok((await ta.inputValue()) === "lines\nbounce", `Enter in the free textarea is a newline: ${JSON.stringify(await ta.inputValue())}`);
  ok(blankState(await attrOf(page, S('[data-role="result"]'), "data-state")), "typing in the textarea does not reveal");
  await page.evaluate(() => { const a = document.activeElement; if (a && a !== document.body && typeof a.blur === "function") a.blur(); });
  await page.keyboard.press("3");
  await sleep(500);
  ok(!((await h.storage("prepHistory")).prepHistory || []).length, "3 does nothing while the grade buttons are hidden");
  await page.keyboard.press("Space");
  await waitAttr(page, S('[data-role="result"]'), "data-state", "revealed");
  await waitVisible(page, S('button[data-role="grade"][data-grade="good"]'));
  await page.keyboard.press("3");
  st = await waitStorage(h, "prepHistory", s => (s.prepHistory || []).length === 1, "the history entry after pressing 3");
  same(pick(st.prepHistory[0], ["itemId", "mode", "correct", "grade", "answer"]),
    { itemId: FX.SYS_FREE_FALSESHARING, mode: "self", correct: null, grade: "good", answer: "lines\nbounce" }, "history after 3 (good)");
  await page.close();
}

async function v4_19(h) {
  h.clearReplies();
  await h.clearStorage();
  const fx = loadFixture(h);
  const id = FX.MCQ_COINS;
  ok(fxItem(fx, id).area === "probability", "FX_MCQ_COINS is a probability item");
  const S = within("#tab-practice");
  const prior = { ts: Date.now() - DAY, track: "probability", amount: 4, unit: "problems", note: "Green Book ch.2" };
  await h.setStorage({ practiceLog: [prior] });
  const page = await prepPage(h, `?fixture=1&item=${id}`);
  await currentItem(page, "#tab-practice");
  await page.click(S('button[data-role="choice"][data-index="2"]'));
  await waitAttr(page, S('[data-role="result"]'), "data-state", "correct");
  let st = await waitStorage(h, ["practiceLog", "prepHistory"], s => (s.practiceLog || []).length === 2 && (s.prepHistory || []).length === 1, "the session practiceLog entry");
  same(st.practiceLog[0], prior, "the existing practiceLog entry is untouched");
  const e = st.practiceLog[1];
  same(pick(e, ["track", "amount", "unit", "note"]), { track: "probability", amount: 1, unit: "problems", note: "prep" }, "the new practiceLog entry");
  ok(typeof e.ts === "number" && e.ts <= st.prepHistory[0].ts, `the entry is stamped with the session start (${e.ts} <= ${st.prepHistory[0].ts})`);

  await page.click(S('button[data-role="next"]'));
  const sum = await until(async () => (await isVis(page, S('[data-role="summary"]'))) && el(page, S('[data-role="summary"]')), "the summary");
  same(pick(sum.attrs, ["data-answered", "data-correct", "data-accuracy", "data-secs", "data-due-tomorrow"]),
    { "data-answered": "1", "data-correct": "1", "data-accuracy": "100", "data-secs": String(st.prepHistory[0].secs), "data-due-tomorrow": "1" }, "summary of the one-item session");
  ok((await textOf(page, S('[data-role="summary-weakest"]'))) === "none", "weakest none");
  await sleep(700);
  st = await h.storage("practiceLog");
  ok(st.practiceLog.length === 2 && st.practiceLog.filter(x => x.note === "prep").length === 1, `exactly one new practiceLog entry: ${JSON.stringify(st.practiceLog)}`);
  await page.close();
}

async function v4_20(h) {
  h.clearReplies();
  await h.clearStorage();
  const fx = loadFixture(h);
  const id = FX.NUM_7_36;
  fxItem(fx, id);
  const S = within("#tab-practice");
  const t = Date.now();
  const m1 = { ts: t - 2 * DAY, itemId: id, answer: "0.19", note: "" };
  const m2 = { ts: t - DAY, itemId: id, answer: "0.2", note: "" };
  const m3 = { ts: t - 3 * DAY, itemId: FX.NUM_EV, answer: "4", note: "old note" };
  await h.setStorage({ prepMistakes: [m3, m1, m2] });

  let page = await prepPage(h, "?fixture=1&tab=dashboard");
  await waitActiveTab(page, "dashboard");
  const entry = page.locator(`.mistake-topic .mistake-entry[data-item-id="${id}"][data-ts="${m1.ts}"]`).first();
  await until(async () => (await entry.count()) > 0, "the seeded mistake entry on the Dashboard");
  await Promise.all([
    page.waitForURL(u => /[?&]mistake=/.test(String(u)), { timeout: 15000 }),
    entry.click(),
  ]);
  await page.waitForFunction(() => !!document.body && document.body.dataset.ready === "1", null, { timeout: 15000 });
  const url = new URL(page.url());
  same(["tab", "item", "mistake", "fixture"].map(k => url.searchParams.get(k)), ["practice", id, String(m1.ts), "1"], "the mistake link keeps fixture=1");
  await waitActiveTab(page, "practice");
  ok((await currentItem(page, "#tab-practice")) === id, "the mistake opens its item");
  await waitVisible(page, S('textarea[data-role="mistake-note"]'), "the mistake-note editor");
  await waitVisible(page, S('button[data-role="mistake-note-save"]'), "the mistake-note save button");

  await page.fill(S('textarea[data-role="mistake-note"]'), "  confused the max with the sum  ");
  await page.click(S('button[data-role="mistake-note-save"]'));
  let st = await waitStorage(h, "prepMistakes", s => (s.prepMistakes || []).some(m => m.ts === m1.ts && m.itemId === id && m.note === "confused the max with the sum"), "the trimmed note on (ts, itemId)");
  const byTs = list => Object.fromEntries(list.map(m => [m.ts, m]));
  let k = byTs(st.prepMistakes);
  ok(st.prepMistakes.length === 3, "no mistake added or dropped");
  same(k[m2.ts], m2, "the other mistake of the same item is unchanged");
  same(k[m3.ts], m3, "the mistake of another item is unchanged");
  same(pick(k[m1.ts], ["ts", "itemId", "answer"]), pick(m1, ["ts", "itemId", "answer"]), "only the note changes");

  // Notes are at most 500 characters.
  await page.fill(S('textarea[data-role="mistake-note"]'), "x".repeat(600));
  await page.click(S('button[data-role="mistake-note-save"]'));
  await sleep(1000);
  st = await h.storage("prepMistakes");
  k = byTs(st.prepMistakes);
  ok(typeof k[m1.ts].note === "string" && k[m1.ts].note.length <= 500, `a saved note has at most 500 characters (${k[m1.ts].note.length})`);
  same(k[m2.ts], m2, "the other mistake is still unchanged");
  await page.close();

  // Without mistake=, the item view has no note editor.
  page = await prepPage(h, `?fixture=1&item=${id}`);
  await currentItem(page, "#tab-practice");
  ok(!(await isVis(page, S('textarea[data-role="mistake-note"]'))), "no note editor without mistake=");
  await page.close();
}

// ---------- entry point ----------

module.exports = async function runV4(h) {
  await h.scenario("v4-1 prep.html?fixture=1 reaches ready with the fixture bank and all 7 tabs; no bank shows #bank-missing", () => v4_1(h));
  await h.scenario("v4-2 numeric item: live preview, parse error writes nothing, wrong → mistake + Again 10m, correct → history + interval 1", () => v4_2(h));
  await h.scenario("v4-3 mcq item: choice buttons are auto-checked (index 2 correct, a wrong choice is a mistake)", () => v4_3(h));
  await h.scenario("v4-4 free item: reveal, grade labels from the card (new and Good 6d), Good writes a self-graded entry", () => v4_4(h));
  await h.scenario("v4-5 disputed item shows printed 1/3 and resolved 1/2; other items show no banner", () => v4_5(h));
  await h.scenario("v4-6 Check my reasoning streams a mocked critique and never changes the grade; no API key is an error", () => v4_6(h));
  await h.scenario("v4-7 Cards tab topic filter move-semantics, settings save, Practice/Cards auto-start queues, end-session", () => v4_7(h));
  await h.scenario("v4-8 OA arith with seed: answers auto-advance until 120 s pass, oaRuns default config + in-app zetamac entry", () => v4_8(h));
  await h.scenario("v4-9 OA ev with seed: score, missed review, personal best and trend; quit discards; parse error stays", () => v4_9(h));
  await h.scenario("v4-10 market dice seed 7: worked-example fills and settlement, good-quoter line, mmRuns; bad quotes rejected", () => v4_10(h));
  await h.scenario("v4-11 dashboard: area scores and no data, nc150 bars + next link, mistake topics, checkpoint, under 60, mocks", () => v4_11(h));
  await h.scenario("v4-12 library: categories, entries, counts (incl. 0) and a practice-from-source session", () => v4_12(h));
  await h.scenario("v4-13 side panel no-AI prompt on a newly added solve; Yes / No set noAI on that record", () => v4_13(h));
  await h.scenario("v4-14 📚 opens prep.html once and then focuses it; the overlay's Take me to Prep opens it", () => v4_14(h));
  await h.scenario("v4-15 assign_drill tool → pending drill banner → doing the drill → finished line in the buddy prompt", () => v4_15(h));
  await h.scenario("v4-16 system prompt Prep line matches PREP_LINE_RE; quantdev/trader interviews carry the material block", () => v4_16(h));
  await h.scenario("v4-17 Sunday review trigger gains Prep week and Score change since last Sunday", () => v4_17(h));
  await h.scenario("v4-18 keyboard: Enter submits and advances, Space reveals, 3 grades good", () => v4_18(h));
  await h.scenario("v4-19 a one-item probability session writes exactly one practiceLog entry (probability, 1, prep)", () => v4_19(h));
  await h.scenario("v4-20 dashboard mistake opens the item with the note editor; Save sets the note on that (ts, itemId)", () => v4_20(h));
};
