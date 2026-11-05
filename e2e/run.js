// End-to-end harness: launches a real Chromium with the unpacked extension loaded and
// drives it through the v3 surface. No test framework — plain scenarios with assertions,
// a pass/fail table, and a debug sweep over the extension's own ring-buffer logs.
//
//   npm run e2e               headless
//   AM_HEADED=1 npm run e2e   watch it
//
// What is real vs. stubbed:
//   - Zetamac: the real site, a real 30-second game played by the harness.
//   - LeetCode: the real origin (so the real content script injects) with a fixture page
//     served by route interception — a signed-in submission can't be automated without
//     credentials, so the Accepted verdict is injected into the DOM the way LeetCode's
//     own marker appears. A live two-sum page is also opened to check first-seen timing.
//   - OpenRouter: mocked SSE streams (tool-call + text), scripted per message, so the
//     tool loop is exercised deterministically without an API key.
//   - YouTube: real origin, stub body — the overlay logic doesn't depend on the page.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { chromium } = require("playwright");
const P = require("../practice.js");
const { amTodayKey } = require("../shared.js");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(__dirname, "out");
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const consoleIssues = []; // { page, type, text }
const pageErrors = [];
const requests = []; // every mocked OpenRouter request body, in order

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
function ymd(d = new Date()) {
  return amTodayKey(d).replace(/-/g, "");
}
class Skip extends Error {}
async function scenario(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - t0 });
    console.log(`✔ ${name} (${Date.now() - t0} ms)`);
  } catch (e) {
    if (e instanceof Skip) {
      results.push({ name, ok: true, skipped: true, ms: Date.now() - t0, error: e.message });
      console.log(`⊘ ${name} — skipped: ${e.message}`);
    } else {
      results.push({ name, ok: false, ms: Date.now() - t0, error: e.message });
      console.log(`✖ ${name}\n    ${e.message}`);
    }
  } finally {
    // A failed scenario must not leak its tabs into the next one (a leaked panel merges
    // storage writes and double-writes the log ring buffer).
    for (const pg of context.pages()) if (pg !== util && !pg.isClosed()) await pg.close().catch(() => {});
  }
}

// ---------- mocked OpenRouter ----------

function sse(events) {
  return events.map(e => `data: ${JSON.stringify(e)}\n\n`).join("") + "data: [DONE]\n\n";
}
function chunk(delta, extra = {}) {
  return { id: "mock", object: "chat.completion.chunk", choices: [{ index: 0, delta, ...extra }] };
}
function textReply(text) {
  const parts = text.match(/.{1,9}/g) || [""];
  return sse([
    chunk({ role: "assistant", content: "" }),
    chunk({ reasoning: "mock thinking " }),
    chunk({ reasoning: "continues." }),
    ...parts.map(p => chunk({ content: p })),
    chunk({}, { finish_reason: "stop" }),
    { id: "mock", choices: [], usage: { prompt_tokens: 100, completion_tokens: 20 } },
  ]);
}
function toolReply(name, args) {
  const a = JSON.stringify(args);
  const half = Math.ceil(a.length / 2);
  return sse([
    chunk({ role: "assistant", content: "" }),
    chunk({ tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name, arguments: a.slice(0, half) } }] }),
    chunk({ tool_calls: [{ index: 0, function: { arguments: a.slice(half) } }] }),
    chunk({}, { finish_reason: "tool_calls" }),
    { id: "mock", choices: [], usage: { prompt_tokens: 100, completion_tokens: 10 } },
  ]);
}
function scriptedReply(body) {
  const msgs = body.messages || [];
  const last = msgs[msgs.length - 1] || {};
  const text = String(last.content || "");
  if (last.role === "tool") return textReply(`Tool result received: ${text.slice(0, 80)}`);
  if (/did 4 green book/i.test(text)) return toolReply("log_practice", { track: "probability", amount: 4, note: "Green Book ch.2" });
  if (/log leetcode by hand/i.test(text)) return toolReply("log_practice", { track: "leetcode", amount: 1 });
  if (/Sunday weekly review/.test(text)) return textReply("Weekly review done: behind on probability, Zetamac trending up.");
  if (/Begin the .* interview/.test(text) || /Begin the mock interview/.test(text)) return textReply("First question: explain RAII.");
  if (/End the interview now/.test(text)) return textReply("Verdict: 6/10. Saved.");
  return textReply("Locked in. Mock reply.");
}

// ---------- fixtures ----------

const LC_FIXTURE = (slug, title, difficulty) => `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>${title} - LeetCode</title></head><body>
<div class="flex"><div class="text-title-large"><a href="/problems/${slug}/">${title}</a></div>
<div class="text-difficulty-${difficulty.toLowerCase()} rounded">${difficulty}</div></div>
<div data-track-load="description_content"><p>Given an array of integers nums and an integer target, return indices of the two numbers such that they add up to target.</p></div>
<div class="view-lines"><div class="view-line">class Solution:</div><div class="view-line">    def twoSum(self, nums, target):</div><div class="view-line">        return []</div></div>
<div id="results"></div>
</body></html>`;

const YT_FIXTURE = `<!DOCTYPE html><html><head><title>YouTube (stub)</title></head><body><h1>YouTube stub</h1></body></html>`;

// ---------- helpers ----------

let context, EXT, util;

function attachDiagnostics(page, label) {
  page.on("console", msg => {
    const type = msg.type();
    if (type === "error" || type === "warning") consoleIssues.push({ page: label, type, text: msg.text().slice(0, 300) });
  });
  page.on("pageerror", err => pageErrors.push({ page: label, error: String(err).slice(0, 300), stack: String(err.stack || "").slice(0, 600) }));
}

const storage = (keys = null) => util.evaluate(k => chrome.storage.local.get(k), keys);
const setStorage = obj => util.evaluate(o => chrome.storage.local.set(o), obj);
const clearStorage = () => util.evaluate(() => chrome.storage.local.clear());

async function seedState(patch) {
  const { state } = await storage("state");
  const next = { ...(state || {}), ...patch, _rev: `seed-${Date.now()}` };
  if (patch.memory) next.memory = { ...(state?.memory || {}), ...patch.memory };
  await setStorage({ state: next });
  return next;
}

async function allLogs() {
  const got = await storage(["amLogs_panel", "amLogs_content", "amLogs_bg"]);
  return ["amLogs_panel", "amLogs_content", "amLogs_bg"].flatMap(k => got[k] || []).sort((a, b) => a.t - b.t);
}
async function waitForLog(pred, timeoutMs = 15000, what = "log entry") {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const hit = (await allLogs()).find(pred);
    if (hit) return hit;
    await util.waitForTimeout(250);
  }
  throw new Error(`timed out waiting for ${what}`);
}

async function openPanel({ fixedTime } = {}) {
  const page = await context.newPage();
  attachDiagnostics(page, "panel");
  if (fixedTime) await page.clock.setFixedTime(fixedTime);
  await page.goto(`chrome-extension://${EXT}/sidepanel.html`);
  await page.waitForSelector("#planBanner");
  await page.waitForFunction(() => document.getElementById("planBanner").textContent.includes("Today:"));
  return page;
}

async function waitForRequest(pred, timeoutMs = 15000, what = "OpenRouter request") {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const hit = requests.find(pred);
    if (hit) return hit;
    await util.waitForTimeout(100);
  }
  throw new Error(`timed out waiting for ${what}`);
}

function lastUser(body) {
  const u = (body.messages || []).filter(m => m.role === "user");
  return u.length ? String(u[u.length - 1].content) : "";
}

async function chat(panel, text) {
  await panel.fill("#userInput", text);
  await panel.press("#userInput", "Enter");
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
}

// ---------- launch ----------

async function launch() {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "am-e2e-"));
  const opts = {
    headless: !process.env.AM_HEADED,
    args: [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`],
    viewport: { width: 420, height: 980 },
  };
  if (process.env.AM_EXECUTABLE) opts.executablePath = process.env.AM_EXECUTABLE;
  else opts.channel = "chromium"; // bundled Chromium: supports --load-extension, also headless
  context = await chromium.launchPersistentContext(userDataDir, opts);
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent("serviceworker", { timeout: 15000 });
  EXT = sw.url().split("/")[2];
  sw.on("console", msg => {
    if (msg.type() === "error") consoleIssues.push({ page: "service-worker", type: "error", text: msg.text().slice(0, 300) });
  });

  await context.route("https://openrouter.ai/api/v1/chat/completions", async route => {
    const body = route.request().postDataJSON();
    requests.push(body);
    await route.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: scriptedReply(body) });
  });
  await context.route(/^https:\/\/leetcode\.com\/problems\/(fixture-[a-z-]+)\/?.*$/, route => {
    const slug = route.request().url().match(/\/problems\/([^/?#]+)/)[1];
    const title = slug === "fixture-add-two" ? "Add Two Numbers" : "Fixture Problem";
    route.fulfill({ status: 200, contentType: "text/html", body: LC_FIXTURE(slug, title, slug === "fixture-add-two" ? "Medium" : "Easy") });
  });
  await context.route("https://leetcode.com/graphql", route => {
    if (route.request().method() !== "POST") return route.continue();
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { userStatus: { username: null, isSignedIn: false } } }) });
  });
  await context.route(/^https:\/\/(www\.)?youtube\.com\/.*/, route => route.fulfill({ status: 200, contentType: "text/html", body: YT_FIXTURE }));

  util = await context.newPage();
  attachDiagnostics(util, "util");
  await util.goto(`chrome-extension://${EXT}/e2e/blank.html`);
  console.log(`extension ${EXT} loaded, chromium ${context.browser()?.version?.() || "(persistent)"}`);
}

// ---------- scenarios ----------

const todayKey = amTodayKey();

async function s1_freshInstall() {
  const panel = await openPanel();
  const banner = await panel.textContent("#planBanner");
  assert(banner.includes("Today: LC 0 · Zetamac 0 · Prob 0 · C++ 0m · Project 0m · Mock 0"), `banner: ${banner}`);
  assert(banner.includes("Now → Feb 2027"), `plan line missing: ${banner}`);
  assert(await panel.inputValue("#model") === "anthropic/claude-haiku-5.5", "model default");
  const opts = await panel.$$eval("#interviewMode option", o => o.map(x => x.value));
  assert(opts.join() === "dsa,quantdev,cv,trader", `modes ${opts}`);
  const { state } = await storage("state");
  assert(state.v3MigratedAt > 0, "v3MigratedAt set");
  assert(state.memory.plan.includes("Checkpoint 28 Feb 2027"), "v3 plan seeded");
  const mig = await waitForLog(e => e.component === "init" && e.event === "v3-migrated", 5000, "v3-migrated log");
  assert(mig.data.changed.length === 0, `fresh install should migrate nothing: ${JSON.stringify(mig.data)}`);
  assert((await panel.textContent("#memoryView")).includes("Zetamac daily"), "memory view shows plan");
  await shot(panel, "01-fresh-panel");
  await panel.close();
}

async function s2_migrateUntouchedV2() {
  await clearStorage();
  await setStorage({ state: {
    apiKey: "", model: "z-ai/glm-5.2", lcUsername: "adonno55", personality: "drill", dailyGoal: "2 problems",
    startDate: "2026-07-05", history: {}, chat: [], memory: { facts: { weak_topic_dp: "DP" }, plan: P.AM_V2_DEFAULT_PLAN, selfNotes: "" },
  } });
  const panel = await openPanel();
  const { state } = await storage("state");
  assert(state.model === "anthropic/claude-haiku-5.5", `model migrated, got ${state.model}`);
  assert(state.memory.plan.includes("Checkpoint 28 Feb 2027"), "plan migrated");
  assert(state.memory.facts.weak_topic_dp === "DP", "facts preserved");
  assert(state.personality === "drill" && state.dailyGoal === "2 problems", "other settings preserved");
  const mig = await waitForLog(e => e.component === "init" && e.event === "v3-migrated" && e.data.changed.length === 2, 5000, "v3-migrated(plan,model)");
  assert(mig.data.changed.join() === "plan,model", JSON.stringify(mig.data));
  assert((await panel.textContent("#planBanner")).includes("LC 0/2"), "banner shows target");
  await panel.close();
}

async function s3_migratePreservesEdits() {
  await clearStorage();
  await setStorage({ state: {
    apiKey: "", model: "z-ai/glm-5.3", dailyGoal: "", history: {}, chat: [],
    memory: { facts: {}, plan: "My buddy-edited plan: Phase 2 done, now graphs.", selfNotes: "" },
  } });
  const panel = await openPanel();
  let { state } = await storage("state");
  assert(state.model === "z-ai/glm-5.3", "custom model kept");
  assert(state.memory.plan.startsWith("My buddy-edited plan"), "edited plan kept");
  await panel.click("details.settings summary:has-text('Memory')");
  await panel.click("#resetPlanBtn");
  await panel.waitForFunction(() => document.getElementById("memoryView").textContent.includes("Checkpoint 28 Feb 2027"));
  ({ state } = await storage("state"));
  assert(state.memory.plan.includes("Jul → Sep 2027"), "reset button installs v3 plan");
  assert((await panel.textContent("#chatWindow")).includes("Plan reset to the v3 default"), "reset note shown");
  await panel.close();
}

let zetamacScore = null;
async function s4_zetamacLiveGame() {
  await clearStorage();
  const z = await context.newPage();
  attachDiagnostics(z, "zetamac");
  await z.goto("https://arithmetic.zetamac.com/", { waitUntil: "domcontentloaded" });
  await z.selectOption('select[name="duration"]', "30");
  await Promise.all([z.waitForURL(/\/game\?key=/), z.click('input[type="submit"]')]);
  await z.waitForFunction(() => (document.querySelector("#game .problem")?.textContent || "").trim().length > 0);
  const armed = await waitForLog(e => e.component === "zetamac" && e.event === "armed", 10000, "zetamac armed");
  assert(armed.data.selectors.answer && armed.data.selectors.endCorrect && armed.data.selectors.left, `selectors: ${JSON.stringify(armed.data.selectors)}`);

  const answer = z.locator("#game .answer");
  let last = "", solved = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < 45000) {
    if (await answer.isDisabled()) break;
    const text = ((await z.textContent("#game .problem")) || "").trim();
    if (text === last) { await z.waitForTimeout(40); continue; }
    const m = text.match(/^(\d+)\s*([+–×÷])\s*(\d+)$/);
    assert(m, `unparsed problem "${text}"`);
    const a = +m[1], b = +m[3];
    const v = m[2] === "+" ? a + b : m[2] === "–" ? a - b : m[2] === "×" ? a * b : a / b;
    last = text;
    await answer.fill(String(v));
    solved++;
    await z.waitForTimeout(150);
  }
  assert(await answer.isDisabled(), "game did not end within 45 s");
  await z.waitForSelector("#game .banner .end", { state: "visible", timeout: 20000 });
  const endText = await z.textContent("#game .end .correct");
  zetamacScore = P.amParseZetamacScore(endText);
  console.log(`    played a real 30 s game: answered ${solved}, page says "${endText.trim()}"`);
  assert(zetamacScore !== null && zetamacScore > 0, `score parse: ${endText}`);
  await shot(z, "02-zetamac-end");

  const rec = await waitForLog(e => e.component === "zetamac" && e.event === "recorded", 10000, "zetamac recorded");
  assert(rec.data.score === zetamacScore, `logged ${rec.data.score} vs page ${zetamacScore}`);
  assert(rec.data.duration === 30, `duration ${rec.data.duration}`);
  assert(rec.data.reason === "answer-disabled", `trigger reason ${rec.data.reason}`);
  const { practiceLog } = await storage("practiceLog");
  const entries = (practiceLog || []).filter(e => e.track === "zetamac");
  assert(entries.length === 1, `expected exactly one zetamac entry, got ${entries.length}`);
  assert(entries[0].amount === zetamacScore && entries[0].unit === "score" && entries[0].note === "30s", JSON.stringify(entries[0]));
  const misses = (await allLogs()).filter(e => e.component === "zetamac" && e.event === "score-miss");
  assert(misses.length === 0, `score-miss logged: ${JSON.stringify(misses.map(m => m.data))}`);

  // Same game page, 15 s later: no duplicate on a later mutation.
  await z.waitForTimeout(1500);
  const again = (await storage("practiceLog")).practiceLog.filter(e => e.track === "zetamac");
  assert(again.length === 1, "no duplicate entry after end-banner reveal");
  await z.close();

  const panel = await openPanel();
  const banner = await panel.textContent("#planBanner");
  assert(banner.includes(`Zetamac ${zetamacScore}`), `banner should show Zetamac ${zetamacScore}: ${banner}`);
  await panel.close();
}

async function s5_leetcodeFixtureSolve() {
  const lc = await context.newPage();
  attachDiagnostics(lc, "leetcode-fixture");
  await lc.goto("https://leetcode.com/problems/fixture-add-two/", { waitUntil: "domcontentloaded" });
  const seen = await waitForLog(e => e.component === "timing" && e.event === "first-seen" && e.data.slug === "fixture-add-two", 15000, "first-seen");
  assert(seen, "first-seen logged");

  // Viewing an old Accepted verdict without a submit must be ignored.
  await lc.evaluate(() => {
    const d = document.createElement("div");
    d.setAttribute("data-e2e-locator", "submission-result");
    d.id = "am-verdict";
    d.textContent = "Accepted";
    document.getElementById("results").appendChild(d);
  });
  await waitForLog(e => e.component === "accepted" && e.event === "ignored-unarmed" && e.data.slug === "fixture-add-two", 10000, "ignored-unarmed");
  let { lcSolves } = await storage("lcSolves");
  assert(!(lcSolves || []).some(s => s.slug === "fixture-add-two"), "unarmed verdict must not record");
  await lc.evaluate(() => document.getElementById("am-verdict").remove());

  // Real flow: submit click arms, verdict within the window records with timing.
  await lc.waitForTimeout(2200);
  await lc.evaluate(() => {
    const b = document.createElement("button");
    b.setAttribute("data-e2e-locator", "console-submit-button");
    b.id = "am-submit";
    b.textContent = "Submit";
    document.body.appendChild(b);
  });
  await lc.click("#am-submit");
  await waitForLog(e => e.component === "accepted" && e.event === "armed", 5000, "armed");
  await lc.evaluate(() => {
    const d = document.createElement("div");
    d.setAttribute("data-e2e-locator", "submission-result");
    d.textContent = "Accepted";
    document.getElementById("results").appendChild(d);
  });
  const rec = await waitForLog(e => e.component === "accepted" && e.event === "recorded" && e.data.slug === "fixture-add-two", 10000, "recorded");
  ({ lcSolves } = await storage("lcSolves"));
  const s = lcSolves.find(x => x.slug === "fixture-add-two");
  assert(s, "solve stored");
  assert(Number.isInteger(s.secs) && s.secs >= 2 && s.secs <= 60, `secs ${s.secs} (log ${JSON.stringify(rec.data)})`);
  assert(s.difficulty === "Medium", `difficulty ${s.difficulty}`);
  assert(s.title === "Add Two Numbers", `title ${s.title}`);
  const ctx = (await storage("lcProblemContext")).lcProblemContext;
  assert(ctx && ctx.slug === "fixture-add-two" && ctx.verdict === "Accepted", "accepted solve auto-harvested context");
  assert(ctx.code && ctx.code.includes("twoSum"), `harvested code: ${ctx.codeSource}`);
  await lc.close();

  const panel = await openPanel();
  const banner = await panel.textContent("#planBanner");
  assert(banner.includes("LC 1"), `banner LC count: ${banner}`);
  await panel.close();
}

async function s6_leetcodeLivePage() {
  const lc = await context.newPage();
  attachDiagnostics(lc, "leetcode-live");
  const res = await lc.goto("https://leetcode.com/problems/two-sum/", { waitUntil: "domcontentloaded", timeout: 45000 });
  if (res && res.status() === 403) throw new Skip("leetcode.com answers 403 to headless Chromium (Cloudflare); the fixture scenario covers the content script");
  assert(res && res.status() === 200, `live page status ${res && res.status()}`);
  await waitForLog(e => e.component === "timing" && e.event === "first-seen" && e.data.slug === "two-sum", 20000, "first-seen on live page");
  await waitForLog(e => e.component === "init" && e.event === "observer-attached" && /two-sum/.test(e.data.path), 20000, "observer on live page");
  const hasDiff = await lc.evaluate(() => !!document.querySelector('[class*="text-difficulty-"]'));
  const hasMarker = await lc.evaluate(() => !!document.querySelector('[data-e2e-locator="console-submit-button"]'));
  console.log(`    live two-sum: difficulty element ${hasDiff ? "found" : "MISSING"}, submit button ${hasMarker ? "found" : "missing (login wall?)"}`);
  await shot(lc, "03-leetcode-live");
  await lc.close();
}

async function s7_chatToolLoop() {
  requests.length = 0;
  await seedState({ apiKey: "sk-or-e2e", lastCheckin: todayKey, dailyGoal: "2 problems" });
  const panel = await openPanel();
  await chat(panel, "did 4 green book problems this morning");
  await panel.waitForFunction(() => document.getElementById("chatWindow").textContent.includes("logged 4 problems on probability — Green Book ch.2"), null, { timeout: 15000 });
  await panel.waitForFunction(() => document.getElementById("chatWindow").textContent.includes("Tool result received: logged 4 problems"), null, { timeout: 15000 });

  const first = requests[0];
  assert(first.model === "anthropic/claude-haiku-5.5", `request model ${first.model}`);
  assert(first.stream === true && first.reasoning?.enabled === true, "stream + reasoning flags");
  const toolNames = first.tools.map(t => t.function.name);
  assert(toolNames.includes("log_practice") && toolNames.includes("read_attempt"), `tools ${toolNames}`);
  const sys = first.messages[0].content;
  assert(first.messages[0].role === "system", "system first");
  for (const needle of ["Barclays", "## Practice tracks", "Today: LC 1/2", `Zetamac last 1: ${zetamacScore} (best ${zetamacScore}, 1 games)`,
    "Median Medium solve time (last 1 timed)", "Next checkpoint: 2027-02-28", "call log_practice immediately", "## Training plan"]) {
    assert(sys.includes(needle), `system prompt missing "${needle}"`);
  }
  assert(!sys.includes("graduating June 2027"), "old profile text gone");
  const second = requests[1];
  const toolMsg = second.messages.find(m => m.role === "tool");
  assert(toolMsg && toolMsg.tool_call_id === "call_1" && toolMsg.content.startsWith("logged 4 problems on probability"), `tool message: ${JSON.stringify(toolMsg)}`);
  const asst = second.messages.find(m => m.role === "assistant" && m.tool_calls);
  assert(asst && asst.tool_calls[0].function.arguments === JSON.stringify({ track: "probability", amount: 4, note: "Green Book ch.2" }), "fragmented tool args reassembled");

  const { practiceLog } = await storage("practiceLog");
  const prob = practiceLog.filter(e => e.track === "probability");
  assert(prob.length === 1 && prob[0].amount === 4 && prob[0].unit === "problems" && prob[0].note === "Green Book ch.2", JSON.stringify(prob));
  assert((await panel.textContent("#planBanner")).includes("Prob 4"), "banner updated after tool");
  assert((await panel.textContent("#memoryView")).length > 10, "memory view intact");
  const thinking = await panel.$$eval(".thinking-block", els => els.map(e => e.textContent));
  assert(thinking.length >= 1 && thinking[0].includes("mock thinking continues."), `reasoning rendered: ${JSON.stringify(thinking)}`);

  // Validation path: the model tries to log leetcode by hand.
  const before = practiceLog.length;
  await chat(panel, "please log leetcode by hand, 1 solve");
  await panel.waitForFunction(() => document.getElementById("chatWindow").textContent.includes("error: leetcode is auto-detected"), null, { timeout: 15000 });
  const after = (await storage("practiceLog")).practiceLog.length;
  assert(after === before, "rejected tool call must not write");
  const done = (await allLogs()).filter(e => e.component === "chat" && e.event === "send-done");
  assert(done.length >= 2 && done[done.length - 1].data.usage.prompt === 100, `send-done usage: ${JSON.stringify(done[done.length - 1]?.data)}`);
  await shot(panel, "04-chat-tool-loop");
  await panel.close();
}

async function s8_interviewModes() {
  requests.length = 0;
  await seedState({ apiKey: "sk-or-e2e", lastCheckin: todayKey, chat: [] });
  const panel = await openPanel();
  await panel.selectOption("#interviewMode", "quantdev");
  await panel.click("#interviewBtn");
  const start = await waitForRequest(b => /Begin the Quant dev interview/.test(lastUser(b)), 10000, "quantdev start request");
  const sys = start.messages[0].content;
  assert(sys.startsWith("You are now running a MOCK QUANT DEVELOPER INTERVIEW"), "quantdev prompt leads the system prompt");
  assert(sys.includes(`Verdict key for today: interview_quantdev_${ymd()}`), "verdict key in prompt");
  assert(sys.includes("move semantics") && sys.includes("interview_quantdev_YYYYMMDD"), "quantdev prompt body");
  await panel.waitForFunction(() => document.getElementById("interviewBanner").textContent.includes("Quant dev interview live"));
  assert(await panel.isDisabled("#interviewMode"), "mode select locked during interview");
  assert((await panel.textContent("#interviewBtn")) === "⏹", "button flips to stop");
  await panel.waitForFunction(() => document.getElementById("chatWindow").textContent.includes("First question: explain RAII."));
  await shot(panel, "05-interview-quantdev");
  await panel.click("#interviewBtn");
  const end = await waitForRequest(b => /End the interview now/.test(lastUser(b)), 10000, "end request");
  assert(lastUser(end).includes(`remember under the key interview_quantdev_${ymd()}`), `end trigger: ${lastUser(end)}`);
  await panel.waitForFunction(() => !document.getElementById("interviewMode").disabled);
  assert(!(await panel.textContent("#interviewBanner")).includes("live"), "banner cleared");
  const userBubbles = await panel.$$eval(".user-msg", els => els.length);
  assert(userBubbles === 0, `synthetic triggers must not render as user bubbles (${userBubbles})`);

  // DSA keeps the original start line and prompt.
  await panel.selectOption("#interviewMode", "dsa");
  await panel.click("#interviewBtn");
  const dsa = await waitForRequest(b => /Begin the mock interview\. Pick my problem/.test(lastUser(b)), 10000, "dsa start");
  assert(dsa.messages[0].content.startsWith("You are now running a MOCK TECHNICAL INTERVIEW"), "dsa prompt");
  await panel.click("#interviewBtn");
  await waitForRequest(b => /interview_dsa_/.test(lastUser(b)), 10000, "dsa end");
  await panel.close();
}

async function s9_checkins() {
  requests.length = 0;
  await seedState({ apiKey: "sk-or-e2e", lastCheckin: null });
  // Sunday 8 Nov 2026 10:00 local.
  let panel = await openPanel({ fixedTime: new Date(2026, 10, 8, 10, 0, 0) });
  const weekly = await waitForRequest(b => /Automatic Sunday weekly review/.test(lastUser(b)), 15000, "weekly trigger");
  const t = lastUser(weekly);
  for (const needle of [`Week totals: LC 1 · Zetamac ${zetamacScore} · Prob 4`, `Zetamac last games: ${zetamacScore} (best ${zetamacScore}, 1 games logged)`,
    "Re-solve debt: 1 due", "Next checkpoint: 2027-02-28 (112 days left)", "update_plan"]) { // the fixture solve is 4 days old on this clock → due
    assert(t.includes(needle), `weekly trigger missing "${needle}" in: ${t}`);
  }
  await panel.waitForFunction(() => document.getElementById("chatWindow").textContent.includes("Weekly review done"));
  let { state } = await storage("state");
  assert(state.lastCheckin === "2026-11-08", `lastCheckin ${state.lastCheckin}`);
  assert(await panel.$$eval(".user-msg", e => e.length) === 0, "hidden trigger");
  await shot(panel, "06-sunday-review");
  await panel.close();

  // Monday: plain daily check-in.
  requests.length = 0;
  await seedState({ lastCheckin: null });
  panel = await openPanel({ fixedTime: new Date(2026, 10, 9, 9, 0, 0) });
  const daily = await waitForRequest(b => /Automatic daily check-in/.test(lastUser(b)), 15000, "daily trigger");
  assert(!/weekly review/.test(lastUser(daily)), "weekday is not weekly");
  ({ state } = await storage("state"));
  assert(state.lastCheckin === "2026-11-09", `lastCheckin ${state.lastCheckin}`);
  await panel.close();

  // Failed check-in must not mark the day.
  requests.length = 0;
  await seedState({ lastCheckin: null });
  await context.route("https://openrouter.ai/api/v1/chat/completions", route => route.fulfill({ status: 500, body: "boom" }), { times: 1 });
  panel = await openPanel({ fixedTime: new Date(2026, 10, 10, 9, 0, 0) });
  await panel.waitForFunction(() => document.getElementById("chatWindow").textContent.includes("Couldn't reach your buddy"), null, { timeout: 15000 });
  ({ state } = await storage("state"));
  assert(state.lastCheckin === null || state.lastCheckin === undefined, `failed check-in must not set lastCheckin (got ${state.lastCheckin})`);
  await panel.close();
}

async function s10_distractionOverlay() {
  await seedState({ dailyGoal: "2 problems", history: {} });
  const yt = await context.newPage();
  attachDiagnostics(yt, "youtube");
  await yt.goto("https://www.youtube.com/", { waitUntil: "domcontentloaded" });
  const overlay = yt.locator("#am-distraction-overlay");
  await overlay.waitFor({ state: "attached", timeout: 10000 }); // host div has no box; its shadow backdrop is what's visible
  const text = await yt.locator("#am-distraction-overlay .card").textContent();
  assert(text.includes("1/2 solved today"), `overlay target line: ${text}`);
  assert(await yt.locator("#am-distraction-overlay .go.zetamac").count() === 1, "zetamac button present");
  await shot(yt, "07-overlay");
  await Promise.all([yt.waitForURL(/arithmetic\.zetamac\.com/), yt.locator("#am-distraction-overlay .go.zetamac").click()]);
  await waitForLog(e => e.component === "distraction" && e.event === "go-to-zetamac", 5000, "go-to-zetamac log");
  await yt.close();

  // Day done → no overlay.
  await seedState({ history: { [todayKey]: true } });
  const yt2 = await context.newPage();
  await yt2.goto("https://www.youtube.com/", { waitUntil: "domcontentloaded" });
  await yt2.waitForTimeout(1500);
  assert(await yt2.locator("#am-distraction-overlay").count() === 0, "no overlay once the day is done");
  await yt2.close();
}

async function s11_backgroundWorker() {
  const alarm = await util.evaluate(() => chrome.alarms.get("am-daily-nudge"));
  assert(alarm && alarm.scheduledTime > Date.now(), "nudge alarm scheduled");
  const when = new Date(alarm.scheduledTime);
  assert(when.getHours() === 21 && when.getMinutes() === 0, `nudge at 21:00 local, got ${when}`);
  // (bg startup logs were wiped by the clearStorage() calls above; the live alarm is the proof.)
  const perms = await util.evaluate(() => chrome.runtime.getManifest());
  assert(perms.version === "3.0.0" && perms.host_permissions.includes("https://arithmetic.zetamac.com/*"), "manifest v3 + zetamac host permission");
  assert(perms.content_scripts.some(c => c.matches[0].includes("zetamac") && c.js.includes("practice.js")), "zetamac content script registered");
}

async function s12_debugSweep() {
  const logs = await allLogs();
  fs.writeFileSync(path.join(OUT, "am-logs.json"), JSON.stringify(logs, null, 2));
  fs.writeFileSync(path.join(OUT, "console.json"), JSON.stringify({ consoleIssues, pageErrors }, null, 2));
  fs.writeFileSync(path.join(OUT, "openrouter-requests.json"), JSON.stringify(requests, null, 2));
  const bad = logs.filter(e =>
    e.component === "global" ||
    (e.component === "chat" && e.event === "send-failed" && !/HTTP 500/.test(e.data?.error || "")) ||
    (e.component === "zetamac" && (e.event === "score-miss" || e.event === "store-failed")) ||
    (e.component === "nudge" && e.event === "schedule-failed") ||
    e.event === "http-error" && !/500/.test(JSON.stringify(e.data)));
  const counts = {};
  for (const e of logs) counts[`${e.ctx}/${e.component}:${e.event}`] = (counts[`${e.ctx}/${e.component}:${e.event}`] || 0) + 1;
  console.log("    log event counts:", JSON.stringify(counts));
  // Third-party pages (LeetCode's Cloudflare wall, YouTube) log their own console noise;
  // only extension pages and anything mentioning the extension count.
  const errs = pageErrors.concat(consoleIssues.filter(c => c.type === "error" &&
    (["panel", "util", "service-worker"].includes(c.page) || /chrome-extension:|\[AM /.test(c.text)) &&
    !/net::ERR|favicon|HTTP 500|500 \(/.test(c.text)));
  if (errs.length) console.log("    page/console errors:", JSON.stringify(errs, null, 1));
  assert(bad.length === 0, `unexpected log events: ${JSON.stringify(bad.map(b => ({ c: b.component, e: b.event, d: b.data })), null, 1)}`);
  assert(pageErrors.length === 0, `uncaught page errors: ${JSON.stringify(pageErrors)}`);
  assert(errs.length === 0, `console errors: ${JSON.stringify(errs)}`);
}

// ---------- main ----------

(async () => {
  await launch();
  await scenario("1 fresh install: v3 defaults, no migration", s1_freshInstall);
  await scenario("2 v2 install with untouched defaults migrates plan + model", s2_migrateUntouchedV2);
  await scenario("3 edited plan / custom model survive; reset button works", s3_migratePreservesEdits);
  await scenario("4 Zetamac: real 30 s game captured once with the right score", s4_zetamacLiveGame);
  await scenario("5 LeetCode (fixture on real origin): unarmed ignored, armed solve timed + harvested", s5_leetcodeFixtureSolve);
  await scenario("6 LeetCode live two-sum page: content script attaches and times", s6_leetcodeLivePage);
  await scenario("7 chat tool loop: log_practice via fragmented SSE tool call + validation", s7_chatToolLoop);
  await scenario("8 interview modes: quantdev + dsa prompts, verdict keys, UI lock", s8_interviewModes);
  await scenario("9 check-ins: Sunday weekly review, Monday daily, failed call not marked", s9_checkins);
  await scenario("10 distraction overlay: Zetamac button, hidden when day done", s10_distractionOverlay);
  await scenario("11 background worker: nudge alarm + manifest", s11_backgroundWorker);
  await scenario("12 debug sweep: no uncaught errors, no unexpected log events", s12_debugSweep);
  await context.close();
  const failed = results.filter(r => !r.ok);
  const skipped = results.filter(r => r.skipped);
  console.log(`\n${results.length - failed.length - skipped.length}/${results.length} scenarios passed, ${skipped.length} skipped`);
  fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 2));
  process.exit(failed.length ? 1 : 0);
})().catch(e => {
  console.error("harness crashed:", e);
  process.exit(2);
});
