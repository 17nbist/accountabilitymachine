// Edit this to keep the buddy's baseline picture current. Live stats, detected solves,
// plan, and facts are layered on top of it automatically.
const PROFILE = `The user is Naman (LeetCode username: adonno55): final-year CS & AI student at
Loughborough (graduating June 2027), working at Fleet AI, a fast-scaling AI startup. Strong maths
background (A* Further Maths) and good architectural understanding — but his production work and
projects were heavily AI-assisted, so unassisted, from-scratch coding fluency is the weakness,
and it is exactly what online assessments and whiteboards test.
Goal: a top-tier new-grad software engineering offer for 2027. Applications and OAs open around
September 2026.
Non-negotiable rules to hold him to, every session:
1. Zero AI assistance while solving — no Copilot, no chat, no autocomplete. Your hints are
   Socratic only: name the pattern, ask a guiding question, or give a small counterexample /
   failing input for HIM to trace by hand. Never reveal the answer in ANY form — no code, no
   pseudocode, no algorithm, no recurrence or formula, no base cases, no function structure,
   no exact bug fixes ("change X to Y"). If he demands the answer, refuse once and offer to
   trace a small case together instead. If he still insists, give it — but immediately call
   remember to mark that solve as ASSISTED (key like assisted_solve_<slug>) so it never counts
   as a clean solve, and tell him it's been marked.
2. After each solve, he explains the approach and its time/space complexity back to you.
3. Missed or struggled problems get re-solved from scratch when they appear in the re-solve queue.`;

const DEFAULT_PLAN = `Phase 1 (current): LeetCode's official DSA crash course — finish every module honestly.
Phase 2 (next): NeetCode 150 in Python, ~15 problems/week, clearing the re-solve queue before new problems.
Phase 2 rule: one timed mock interview per week from week 3 onward.
Hard deadline: OA-ready by mid-September 2026, when new-grad applications open.`;

const PERSONALITIES = {
  coach: `You are a supportive but strictly output-oriented accountability coach.
Encourage, but always steer back to today's target. Celebrate completed problems specifically.`,
  drill: `You are a blunt, no-fluff tech recruiter who has seen a thousand strong CVs rejected
for weak DSA performance. No pep talks, no generic advice. Hold the user to their number.
If they're making excuses, say so.`,
};

const INTERVIEWER_PROMPT = `You are now running a MOCK TECHNICAL INTERVIEW — drop the coach persona.
You are a senior engineer at a top tech company conducting a timed DSA screen. Rules:
- If no problem is chosen yet, pick ONE (prefer the top item in the re-solve queue; else call
  pick_problem with difficulty/tags fitting the user's current plan phase) and state it clearly
  with constraints. Offer open_problem so they can code it. Then STOP and make them talk.
- Force the interview loop: (1) they restate the problem and clarify, (2) they explain their
  APPROACH and its time/space complexity BEFORE writing any code, (3) only then do they code it on
  LeetCode. Do not let them skip to code. Probe edge cases and complexity like a real interviewer.
- Give NO solutions and NO code. Nudge with questions only. Stay terse and professional.
- When the user ends the interview, output a short verdict: what went well, what was weak, and a
  score out of 10 for problem-solving, communication, and code — then call remember to store the
  score under a key like interview_YYYYMMDD.`;

const TOOLS = [
  {
    type: "function",
    function: {
      name: "remember",
      description: "Store or update a persistent fact about the user. Use immediately whenever they reveal something durable: weak topics, schedule constraints, deadlines, progress milestones, preferences. Don't ask permission.",
      parameters: {
        type: "object",
        properties: {
          key: { type: "string", description: "short snake_case identifier, e.g. weak_topic_dp" },
          value: { type: "string" },
        },
        required: ["key", "value"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "forget",
      description: "Delete a stored fact that is wrong or obsolete.",
      parameters: {
        type: "object",
        properties: { key: { type: "string" } },
        required: ["key"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_plan",
      description: "Rewrite the training plan that lives in your own context. Full replacement — include everything that should persist. Use when a phase completes or the schedule genuinely changes.",
      parameters: {
        type: "object",
        properties: { plan: { type: "string" } },
        required: ["plan"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "edit_self_notes",
      description: "Rewrite your own private coaching notes (strategy, what motivates this user, what to push on next). Full replacement.",
      parameters: {
        type: "object",
        properties: { notes: { type: "string" } },
        required: ["notes"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "pick_problem",
      description: "Fetch a random UNSOLVED LeetCode problem via LeetCode's own random-question API, optionally filtered by difficulty and topic tags. Use when the user wants a new problem AND the re-solve queue is clear — choose filters from the plan phase, their weak topics, and what they've solved before. NEVER pick a topic the user hasn't covered in their plan yet (check the plan and stored facts — e.g. no dynamic-programming before they've learned DP). If mid-problem they reveal the topic is unlearned, offer to swap it, or explicitly reframe it as a teaching session that does NOT count toward solves or streak.",
      parameters: {
        type: "object",
        properties: {
          difficulty: { type: "string", enum: ["Easy", "Medium", "Hard"] },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "LeetCode topic slugs, e.g. binary-search-tree, graph, dynamic-programming, two-pointers",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "open_problem",
      description: "Open a LeetCode problem in a new browser tab by slug. Use after pick_problem, or when the user agrees to start a specific problem (including re-solve queue items).",
      parameters: {
        type: "object",
        properties: {
          slug: { type: "string", description: "problem slug, e.g. insert-into-a-binary-search-tree" },
        },
        required: ["slug"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_attempt",
      description: "Read the user's live LeetCode attempt (their code, judged verdict, failing test cases) straight from their open problem tab. Call this yourself whenever they ask about their code, logic, a bug, or a verdict and no 'current LeetCode attempt' block is in your context — never ask them to paste code or press 📥 without trying this first.",
      parameters: { type: "object", properties: {} },
    },
  },
];

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const LC_GRAPHQL_URL = "https://leetcode.com/graphql";
const DEFAULT_MODEL = "z-ai/glm-5.2";
const MAX_STORED_MESSAGES = 60;
const CONTEXT_MESSAGES = 12;
const MAX_TOOL_ROUNDS = 5;
const STATS_STALE_MS = 60 * 60 * 1000;
const RESOLVE_DUE_MS = 3 * 24 * 60 * 60 * 1000;
const RESOLVE_MIN_GAP_MS = 2 * 24 * 60 * 60 * 1000;
const CONTEXT_TTL_MS = 30 * 60 * 1000; // harvested attempt older than this is stale
const STREAM_IDLE_MS = 45 * 1000; // abort a model stream this long without data
const RENDER_THROTTLE_MS = 70; // repaint streaming bubbles at most this often — every
// paint re-parses the whole message (marked + DOMPurify + innerHTML), so per-token
// painting goes O(n²) and makes long replies increasingly janky

const LC_QUERY = `query profile($username: String!) {
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

const els = {};
["apiKey", "model", "lcUsername", "personality", "dailyGoal", "doneBtn", "planBanner",
 "streakBadge", "streakGrid", "chatWindow", "userInput", "sendBtn", "syncBtn",
 "memoryView", "clearMemoryBtn", "logsSection", "logView", "refreshLogsBtn",
 "copyLogsBtn", "clearLogsBtn", "nudgeEnabled", "nudgeHour", "interviewBtn",
 "interviewBanner", "pullBtn"]
  .forEach(id => els[id] = document.getElementById(id));

let state = {
  apiKey: "",
  model: DEFAULT_MODEL,
  lcUsername: "",
  personality: "coach",
  dailyGoal: "",
  startDate: null,
  history: {},
  chat: [],
  memory: { facts: {}, plan: DEFAULT_PLAN, selfNotes: "" },
};
let lcStats = null;
let lcSolves = [];
let inFlight = false;
let lastRenderedDay = null;
let interviewActive = false;
let interviewStart = null;
let interviewTimer = null;
let problemContext = null; // harvested LeetCode attempt (Phase E layer 1)
let harvestBlocked = false; // true when on a problem tab but the content script didn't answer

function daysSinceStart() {
  const [y, m, d] = state.startDate.split("-").map(Number);
  const start = new Date(y, m - 1, d);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((today - start) / 86400000) + 1;
}

function currentStreak() {
  return amStreakFrom(state.history);
}

function ago(ms) {
  const mins = Math.round((Date.now() - ms) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.innerText = String(value);
  return div.innerHTML;
}

async function save() {
  state._rev = crypto.randomUUID();
  // Denormalized fields the service worker (nudge) and distraction overlay read
  // without recomputing — they only have raw state, not these helpers.
  state._streak = currentStreak();
  state._dueTitles = reSolveQueue().slice(0, 3).map(d => d.title);
  await chrome.storage.local.set({ state });
}

function renderMarkdown(text) {
  try {
    const html = marked.parse(text, { breaks: true });
    return DOMPurify.sanitize(html);
  } catch (e) {
    return null;
  }
}

// ---------- Solve log (fed by content-lc.js) ----------

function todaysSolves() {
  const today = amTodayKey();
  return lcSolves.filter(s => amTodayKey(new Date(s.ts)) === today);
}

function goalTarget() {
  return amGoalTarget(state.dailyGoal);
}

function reSolveQueue() {
  const bySlug = {};
  for (const s of lcSolves) {
    (bySlug[s.slug] ||= { title: s.title, times: [] }).times.push(s.ts);
  }
  const due = [];
  const now = Date.now();
  for (const [slug, info] of Object.entries(bySlug)) {
    info.times.sort((a, b) => a - b);
    const first = info.times[0];
    const reviewed = info.times.some(t => t >= first + RESOLVE_MIN_GAP_MS);
    if (!reviewed && now >= first + RESOLVE_DUE_MS) {
      due.push({ slug, title: info.title, first });
    }
  }
  return due.sort((a, b) => a.first - b.first);
}

async function autoMarkIfTargetMet() {
  const target = goalTarget();
  if (!target) return;
  if (state.history[amTodayKey()]) return;
  if (todaysSolves().length >= target) {
    state.history[amTodayKey()] = true;
    await save();
    renderStreak();
    note(`🎯 ${target}/${target} detected — day auto-marked done.`);
    amLog("autoMark", "target-met", {
      target,
      detected: todaysSolves().length,
      solves: todaysSolves().map(s => s.title),
    });
  }
}

// LeetCode's own record of recent accepted submissions is ground truth the local solve
// log can miss (panel never opened that day, solves from another device/browser). Mark
// any day whose distinct-problem count met the current target. Marks only, never
// unmarks — a truncated list can under-count a day (harmless false negative) but never
// over-count, and it must not undo a day the user marked by hand.
async function backfillFromRecent(recent, trigger) {
  const target = goalTarget();
  if (!target || !recent?.length) return;
  const byDay = {};
  for (const s of recent) {
    if (!s?.ts) continue;
    const day = amTodayKey(new Date(s.ts));
    (byDay[day] ||= new Set()).add(s.slug || s.title);
  }
  const marked = [];
  for (const [day, slugs] of Object.entries(byDay)) {
    if (!state.history[day] && slugs.size >= target) {
      state.history[day] = true;
      marked.push(day);
    }
  }
  if (!marked.length) return;
  marked.sort();
  await save();
  renderStreak();
  note(`📆 Backfilled from LeetCode history: ${marked.join(", ")} met the ${target}/day target.`);
  amLog("backfill", "marked", { trigger, days: marked, target });
}

// ---------- LeetCode stats ----------

async function syncLcStats(manual) {
  const username = state.lcUsername || lcStats?.username;
  if (!username) {
    if (manual) note("Set your LeetCode username in ⚙️ Settings (or visit your profile page once).", "error-msg");
    amLog("statsSync", "skip-no-username", { manual: !!manual });
    return;
  }
  amLog("statsSync", "start", { username, manual: !!manual });
  els.syncBtn.disabled = true;
  const t0 = Date.now();
  try {
    const res = await fetch(LC_GRAPHQL_URL, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: LC_QUERY, variables: { username } }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { data } = await res.json();
    if (!data || !data.matchedUser) throw new Error(`no LeetCode user "${username}"`);

    const solved = {};
    for (const row of data.matchedUser.submitStatsGlobal.acSubmissionNum) {
      solved[row.difficulty] = row.count;
    }
    lcStats = {
      username: data.matchedUser.username,
      ranking: data.matchedUser.profile?.ranking ?? null,
      solved,
      recent: (data.recentAcSubmissionList || []).map(s => ({
        title: s.title,
        slug: s.titleSlug,
        ts: Number(s.timestamp) * 1000,
      })),
      fetchedAt: Date.now(),
    };
    await chrome.storage.local.set({ lcStats });
    renderBanner();
    await backfillFromRecent(lcStats.recent, "sync");
    amLog("statsSync", "success", { username, solved, ms: Date.now() - t0 });
    if (manual) {
      note(`Synced: ${solved.All ?? 0} solved (${solved.Easy ?? 0}E / ${solved.Medium ?? 0}M / ${solved.Hard ?? 0}H).`);
    }
  } catch (error) {
    amLog("statsSync", "failed", { manual: !!manual, error: String(error.message).slice(0, 300), ms: Date.now() - t0 });
    if (manual) note(`LeetCode sync failed: ${error.message}`, "error-msg");
  } finally {
    els.syncBtn.disabled = false;
  }
}

// LeetCode's own "Pick One" endpoint. status NOT_STARTED excludes everything the
// signed-in account has touched (same cookied session as syncLcStats). categorySlug
// "algorithms" keeps DB/shell problems out of a DSA grind. Premium-only picks are
// re-rolled a few times rather than surfaced.
const LC_RANDOM_QUERY = `query randomQuestion($categorySlug: String, $filters: QuestionListFilterInput) {
  randomQuestion(categorySlug: $categorySlug, filters: $filters) {
    title
    titleSlug
    difficulty
    isPaidOnly
  }
}`;

async function pickRandomProblem(filters) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(LC_GRAPHQL_URL, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: LC_RANDOM_QUERY,
        variables: { categorySlug: "algorithms", filters },
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { data, errors } = await res.json();
    if (errors?.length) throw new Error(String(errors[0].message || "GraphQL error").slice(0, 200));
    const q = data?.randomQuestion;
    if (!q) {
      amLog("tools", "pick-problem-empty", { filters });
      return null;
    }
    if (!q.isPaidOnly) {
      amLog("tools", "pick-problem", { filters, picked: q.titleSlug, difficulty: q.difficulty, attempt });
      return q;
    }
  }
  amLog("tools", "pick-problem-all-premium", { filters });
  return null;
}

function lcStatsSummary() {
  if (!lcStats) return "Not synced yet — tell the user to hit 🔄 or visit their LeetCode profile.";
  const s = lcStats.solved || {};
  const recent = (lcStats.recent || []).slice(0, 5)
    .map(r => `${r.title} (${ago(r.ts)})`).join(", ") || "none";
  return `${s.All ?? 0} solved total — ${s.Easy ?? 0} Easy / ${s.Medium ?? 0} Medium / ${s.Hard ?? 0} Hard.` +
    (lcStats.ranking ? ` Rank ${Number(lcStats.ranking).toLocaleString()}.` : "") +
    ` Synced ${ago(lcStats.fetchedAt)}. Recent accepted: ${recent}.`;
}

// ---------- Rendering ----------

function renderBanner() {
  const e = escapeHtml;
  const stats = lcStats
    ? `<strong>${e(lcStats.solved?.All ?? 0)} solved</strong> (${e(lcStats.solved?.Easy ?? 0)}E / ${e(lcStats.solved?.Medium ?? 0)}M / ${e(lcStats.solved?.Hard ?? 0)}H) · synced ${e(ago(lcStats.fetchedAt))}`
    : `no stats yet — hit 🔄 or visit your LeetCode profile`;
  const target = goalTarget();
  const todayLine = `Today: ${e(todaysSolves().length)}${target ? `/${e(target)}` : ""} detected`;
  const due = reSolveQueue();
  const dueLine = due.length
    ? ` · re-solves due: ${e(due.slice(0, 2).map(d => d.title).join(", "))}${due.length > 2 ? ` +${e(due.length - 2)}` : ""}`
    : "";
  const planLine = e((state.memory.plan || "").split("\n")[0]);
  els.planBanner.innerHTML =
    `<strong>Day ${e(daysSinceStart())}</strong> · ${stats}<br>${todayLine}${dueLine}<br>${planLine}`;
}

// Distinct problems per day, merging the local solve log with LeetCode's recent-AC
// list (covers solves from other devices). IDs are normalized to bare alphanumerics
// so a slug ("pascals-triangle") and a pre-2.6.0 stored title ("Pascal's Triangle")
// collapse to one key — slugifying titles missed LeetCode's punctuation rules and
// double-counted the same problem.
function distinctSolvesByDay() {
  const byDay = {};
  const add = (ts, id) => {
    const norm = String(id || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!ts || !norm) return;
    const day = amTodayKey(new Date(ts));
    (byDay[day] ||= new Set()).add(norm);
  };
  for (const s of lcSolves) add(s.ts, s.slug);
  for (const s of lcStats?.recent || []) add(s.ts, s.slug || s.title);
  return byDay;
}

function renderStreak() {
  els.streakBadge.textContent = `🔥 ${currentStreak()}`;
  els.streakGrid.innerHTML = "";
  const today = amTodayKey();
  const counts = distinctSolvesByDay();
  const target = goalTarget();
  for (let i = 27; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = amTodayKey(d);
    const cell = document.createElement("div");
    cell.className = "cell";
    const n = counts[key]?.size || 0;
    if (state.history[key]) {
      cell.classList.add("done");
      // Heat levels for overachieving: 2x/3x the goal brighten the green, 4x+ goes gold.
      const mult = target ? Math.floor(n / target) : 0;
      if (mult >= 2) cell.classList.add(`x${Math.min(mult, 4)}`);
    }
    if (key === today) cell.classList.add("today");
    cell.title = n
      ? `${key} · ${n} solved${target ? ` (${Math.floor(n / target)}× goal)` : ""}`
      : key;
    els.streakGrid.appendChild(cell);
  }
  lastRenderedDay = today;
}

function renderMemory() {
  els.memoryView.textContent = JSON.stringify(state.memory, null, 2);
}

function setBubbleText(p, text, className) {
  const md = className === "ai-msg" ? renderMarkdown(text) : null;
  if (md !== null) p.innerHTML = md;
  else p.innerText = text;
}

function appendMessage(text, className) {
  const p = document.createElement("p");
  p.className = className;
  setBubbleText(p, text, className);
  els.chatWindow.appendChild(p);
  els.chatWindow.scrollTop = els.chatWindow.scrollHeight;
  return p;
}

// Collapsible reasoning shown above the answer bubble. Native <details>: collapsed by
// default, click the summary to expand.
function appendThinking() {
  const d = document.createElement("details");
  d.className = "thinking-block";
  const summary = document.createElement("summary");
  const body = document.createElement("div");
  body.className = "thinking-body";
  d.append(summary, body);
  els.chatWindow.appendChild(d);
  return d;
}

function setThinkingText(d, text, streaming) {
  d.querySelector("summary").textContent = streaming ? "💭 Thinking…" : "💭 Thoughts";
  d.querySelector(".thinking-body").innerText = text;
}

function note(text, kind = "tool-msg") {
  appendMessage(text, kind);
  state.chat.push({ role: "note", kind, content: text });
  state.chat = state.chat.slice(-MAX_STORED_MESSAGES);
}

function renderChat() {
  els.chatWindow.innerHTML = "";
  if (state.chat.length === 0) {
    appendMessage("Locked in. What's today's target?", "ai-msg");
    return;
  }
  for (const msg of state.chat) {
    if (msg.hidden) continue;
    if (msg.role === "assistant" && msg.reasoning) setThinkingText(appendThinking(), msg.reasoning, false);
    const cls = msg.role === "user" ? "user-msg"
      : msg.role === "assistant" ? "ai-msg"
      : (msg.kind || "tool-msg");
    appendMessage(msg.content, cls);
  }
}

// ---------- Chat + tools ----------

// Silently pull the active LeetCode problem's code + failing tests before each message,
// so the buddy always has the user's real attempt without them clicking 📥. If the active
// tab is a problem page but harvest fails (content script not injected on an old tab),
// drop any stale context for a different problem rather than reasoning about the wrong code.
// Drop a harvested attempt once it's old enough to mislead — the tab it came from may
// be long closed, and "their current code" from 2 hours ago sends the model down the
// wrong path. The 📥 manual pull always refreshes it.
function expireStaleContext() {
  if (problemContext && Date.now() - problemContext.ts > CONTEXT_TTL_MS) {
    amLog("hijack", "context-expired", {
      slug: problemContext.slug,
      ageMin: Math.round((Date.now() - problemContext.ts) / 60000),
    });
    problemContext = null;
  }
}

function lcSlugOf(url) {
  const m = String(url || "").match(/^https:\/\/leetcode\.com\/problems\/([^/?#]+)/);
  return m ? m[1] : null;
}

// The active tab if it's a problem page, else the most recently used problem tab in
// ANY window — the user often chats from the panel while some other tab or window has
// focus, and active-tab-only harvesting left the buddy blind to a perfectly readable
// attempt sitting one tab over.
async function findProblemTab() {
  try {
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (active && lcSlugOf(active.url)) return active;
    const tabs = await chrome.tabs.query({ url: "https://leetcode.com/problems/*" });
    tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
    return tabs[0] || null;
  } catch (e) { return null; /* tab query can fail; non-fatal */ }
}

async function autoHarvestActiveTab() {
  harvestBlocked = false;
  expireStaleContext();
  const tab = await findProblemTab();
  if (!tab) return;
  try {
    const ctx = await chrome.tabs.sendMessage(tab.id, { type: "AM_HARVEST" });
    if (ctx && !ctx.error) {
      problemContext = ctx;
      amLog("hijack", "auto-harvest", { slug: ctx.slug, codeSource: ctx.codeSource, verdict: ctx.verdict });
      return;
    }
  } catch (e) {
    // Classic "reloaded the extension but not the page" — the content script on this
    // tab is orphaned. Flag it so the buddy knows it's blind instead of guessing.
    harvestBlocked = true;
    amLog("hijack", "auto-harvest-failed", { url: tab.url, error: String(e.message).slice(0, 150) });
  }
  // Live re-read failed. Keep an earlier pull for the SAME problem (slug match — exact
  // URLs drift on every SPA hop between /description/, /submissions/…, query params);
  // dropping it here is what blinded the buddy seconds after a successful 📥. Only
  // drop context that belongs to a different problem than the tab in front of them.
  if (problemContext && lcSlugOf(problemContext.url) !== lcSlugOf(tab.url)) problemContext = null;
}

async function getTabContext() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) return "";
    const url = new URL(tab.url);
    if (url.hostname.endsWith("leetcode.com")) {
      return `The user currently has this LeetCode page open: "${tab.title}".
If it's a problem page, give Socratic hints only — name the pattern and a guiding question.
Never reveal the solution in any form (code, pseudocode, recurrence, structure, exact fixes);
rule #1's assisted-solve protocol applies if they insist.`;
    }
    if (/youtube\.com|reddit\.com|twitter\.com|x\.com|instagram\.com|twitch\.tv/.test(url.hostname)) {
      return `The user is currently on ${url.hostname}. If their target isn't done yet, call it out.`;
    }
  } catch (e) { /* tab access can fail on chrome:// pages; context is optional */ }
  return "";
}

function buildSystemPrompt(tabContext) {
  const facts = Object.entries(state.memory.facts)
    .map(([k, v]) => `- ${k}: ${v}`).join("\n") || "(none yet)";
  const solvedToday = todaysSolves();
  const target = goalTarget();
  const due = reSolveQueue();
  const todayLine =
    `Detected solves today: ${solvedToday.length}${target ? ` of target ${target}` : ""}` +
    (solvedToday.length ? ` — ${solvedToday.map(s => s.title).join(", ")}` : "") + ".";
  const dueBlock = due.length
    ? `## Re-solve queue (spaced repetition — hold him to these BEFORE new problems)\n` +
      due.slice(0, 8).map(d => `- ${d.title} (first solved ${ago(d.first)})`).join("\n")
    : "";
  const interviewBlock = interviewActive
    ? `${INTERVIEWER_PROMPT}\n\nInterview elapsed: ${Math.round((Date.now() - interviewStart) / 60000)} min.`
    : "";
  return [
    interviewActive ? interviewBlock : (PERSONALITIES[state.personality] || PERSONALITIES.coach),
    PROFILE,
    `## Live LeetCode stats (auto-synced)\n${lcStatsSummary()}`,
    `## Training plan (yours to maintain — rewrite with update_plan when it changes)\n${state.memory.plan}`,
    `## Stored facts about the user (managed via remember/forget)\n${facts}`,
    state.memory.selfNotes
      ? `## Your private coaching notes (managed via edit_self_notes)\n${state.memory.selfNotes}`
      : "",
    `## Today\nTarget: "${state.dailyGoal || "not set — get one out of them"}". ${todayLine} ` +
      `Streak: ${currentStreak()} day(s). Marked done today: ${!!state.history[amTodayKey()]}. ` +
      `Solves are auto-detected from LeetCode Accepted verdicts — trust the detected count over self-reports.`,
    dueBlock,
    problemContextBlock(),
    harvestBlocked && !problemContext
      ? `## Attempt read FAILED\nThe user is on a LeetCode problem but the extension could not ` +
        `read their code/verdict (the page likely needs a reload after an extension update). ` +
        `You are BLIND to their current code and test results. Do NOT state or guess their verdict, ` +
        `do NOT say "Accepted" or "passed", and do NOT congratulate. Tell them to reload the LeetCode ` +
        `tab (then it works automatically) or paste the failing case.`
      : harvestBlocked
      ? `## Live re-read failed\nThe attempt block above is the last successful read and is still ` +
        `valid — treat it as their current work. Do NOT claim you can't see their code. If they say ` +
        `they've changed it since, ask them to reload the LeetCode tab so you can re-read.`
      : "",
    tabContext,
    `## Behaviour\nUse your tools proactively — when the user reveals anything durable, call remember ` +
      `right away without asking. When they ask for a problem to solve: re-solve queue items come ` +
      `FIRST (use open_problem with the slug); once the queue is clear, call pick_problem with ` +
      `difficulty and topic tags chosen from the plan phase, their weak topics, and recent solves — ` +
      `never invent a problem from memory. After picking, offer open_problem. ` +
      `After any tool calls, always finish with a normal chat reply. ` +
      `Keep replies under 4 sentences unless the user asks for depth. ` +
      `When a "current LeetCode attempt" block is present above, you CAN see their code and failing ` +
      `test cases — reference them directly; never claim you can't see their code. If it's absent and ` +
      `they ask about their code, call read_attempt yourself — only if that errors should you tell ` +
      `them to reload the problem tab or hit 📥. Never ask them to paste code.`,
  ].filter(Boolean).join("\n\n");
}

async function execTool(name, args) {
  switch (name) {
    case "remember":
      if (typeof args.key !== "string" || !args.key || typeof args.value !== "string") {
        return "error: remember requires string key and value";
      }
      state.memory.facts[args.key] = args.value;
      await save();
      renderMemory();
      return `remembered ${args.key}: ${args.value}`;
    case "forget":
      if (typeof args.key !== "string" || !(args.key in state.memory.facts)) {
        return `error: no stored fact "${args.key}"`;
      }
      delete state.memory.facts[args.key];
      await save();
      renderMemory();
      return `forgot ${args.key}`;
    case "update_plan":
      if (typeof args.plan !== "string" || !args.plan.trim()) {
        return "error: update_plan requires non-empty plan text";
      }
      state.memory.plan = args.plan;
      await save();
      renderMemory();
      renderBanner();
      return "plan updated";
    case "edit_self_notes":
      if (typeof args.notes !== "string") {
        return "error: edit_self_notes requires notes text";
      }
      state.memory.selfNotes = args.notes;
      await save();
      renderMemory();
      return "coaching notes updated";
    case "pick_problem": {
      const filters = { status: "NOT_STARTED" };
      if (["Easy", "Medium", "Hard"].includes(args.difficulty)) {
        filters.difficulty = args.difficulty.toUpperCase();
      }
      if (Array.isArray(args.tags)) {
        const tags = args.tags.filter(t => typeof t === "string" && /^[a-z0-9-]+$/.test(t)).slice(0, 5);
        if (tags.length) filters.tags = tags;
      }
      try {
        const q = await pickRandomProblem(filters);
        if (!q) return "error: LeetCode returned no free unsolved problem for those filters — retry with broader filters";
        return `picked: "${q.title}" [${q.difficulty}] — slug: ${q.titleSlug} — https://leetcode.com/problems/${q.titleSlug}/`;
      } catch (e) {
        return `error: pick_problem failed: ${String(e.message).slice(0, 150)}`;
      }
    }
    case "open_problem": {
      if (typeof args.slug !== "string" || !/^[a-z0-9-]+$/.test(args.slug)) {
        return "error: open_problem requires a lowercase-slug string like two-sum";
      }
      const url = `https://leetcode.com/problems/${args.slug}/`;
      try {
        await chrome.tabs.create({ url, active: true });
        return `opened ${url}`;
      } catch (e) {
        return `error: could not open tab: ${String(e.message).slice(0, 150)}`;
      }
    }
    case "read_attempt": {
      await autoHarvestActiveTab();
      if (problemContext) return problemContextBlock();
      if (harvestBlocked) {
        return "error: found their LeetCode problem tab but couldn't read it — the tab was loaded " +
          "before the last extension update. Tell them to reload the LeetCode tab, then call " +
          "read_attempt again.";
      }
      return "error: no open LeetCode problem tab found in any window — ask them to open the " +
        "problem they're working on.";
    }
    default:
      return `unknown tool: ${name}`;
  }
}

// Streams a completion from OpenRouter. Calls onDelta(contentSoFar, reasoningSoFar) as
// tokens arrive. Returns the assembled message { content, reasoning, tool_calls, usage }
// — tool_call fragments are accumulated by index across chunks, matching the OpenAI
// streaming delta format. An idle watchdog aborts a stream that stops producing data:
// without it a stalled connection left inFlight stuck and the chat dead until the
// panel was reopened.
async function chatCompletion(messages, onDelta) {
  const controller = new AbortController();
  let stalled = false;
  let idleTimer = null;
  const resetIdle = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { stalled = true; controller.abort(); }, STREAM_IDLE_MS);
  };

  try {
    resetIdle();
    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Authorization": `Bearer ${state.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/namanbist/accountabilitymachine",
        "X-Title": "Accountability Machine",
      },
      body: JSON.stringify({
        model: state.model || DEFAULT_MODEL,
        messages,
        tools: TOOLS,
        stream: true,
        reasoning: { enabled: true },
        usage: { include: true },
        // Route to the fastest healthy provider and skip fp4-quantized endpoints —
        // default price-first routing lands on overloaded bargain providers (token
        // crawl) and 4-bit weights measurably hurt reasoning quality. "unknown"
        // keeps reputable providers (Fireworks, Together) that don't declare quant.
        provider: {
          sort: "throughput",
          quantizations: ["fp8", "fp16", "bf16", "unknown"],
        },
      }),
    });
    if (!response.ok) {
      const errBody = await response.text();
      amLog("chat", "http-error", { status: response.status, body: errBody.slice(0, 200) });
      throw new Error(`HTTP ${response.status}: ${errBody.slice(0, 200)}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
    let reasoning = "";
    let usage = null;
    const toolCalls = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      resetIdle();
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") continue;
        let json;
        try { json = JSON.parse(payload); } catch (e) { continue; }
        if (json.error) throw new Error(json.error.message || JSON.stringify(json.error).slice(0, 200));
        if (json.usage) usage = json.usage; // final chunk carries token counts
        const delta = json.choices?.[0]?.delta;
        if (!delta) continue;
        const r = delta.reasoning ?? delta.reasoning_content; // OpenRouter-normalized, with raw-provider fallback
        if (r) {
          reasoning += r;
          if (onDelta) onDelta(content, reasoning);
        }
        if (delta.content) {
          content += delta.content;
          if (onDelta) onDelta(content, reasoning);
        }
        for (const tc of delta.tool_calls || []) {
          const i = tc.index ?? 0;
          toolCalls[i] ||= { id: "", type: "function", function: { name: "", arguments: "" } };
          if (tc.id) toolCalls[i].id = tc.id;
          if (tc.function?.name) toolCalls[i].function.name = tc.function.name;
          if (tc.function?.arguments) toolCalls[i].function.arguments += tc.function.arguments;
        }
      }
    }

    const msg = { role: "assistant", content };
    if (reasoning) msg.reasoning = reasoning;
    if (toolCalls.length) msg.tool_calls = toolCalls.filter(Boolean);
    if (usage) msg.usage = usage;
    return msg;
  } catch (error) {
    if (stalled) {
      amLog("chat", "stream-stalled", { idleMs: STREAM_IDLE_MS });
      throw new Error(`model stream stalled (${STREAM_IDLE_MS / 1000}s without data)`);
    }
    throw error;
  } finally {
    clearTimeout(idleTimer);
  }
}

function contextMessages() {
  return state.chat
    .filter(m => m.role === "user" || m.role === "assistant")
    .slice(-CONTEXT_MESSAGES)
    .map(m => ({ role: m.role, content: m.content }));
}

// Runs one turn. If `trigger` is given (proactive check-in / interview control), it's a
// synthetic user turn: shown to the model but flagged so it isn't echoed as a user bubble.
// Returns true when a reply landed, false when the turn was dropped or failed — callers
// like the daily check-in use this to decide whether to retry later.
async function sendMessage(trigger) {
  if (inFlight) return false;
  const synthetic = typeof trigger === "string";
  const userText = synthetic ? trigger : els.userInput.value.trim();
  if (!userText) return false;
  if (!state.apiKey) {
    appendMessage("No API key set — open ⚙️ Settings and paste your OpenRouter key.", "error-msg");
    return false;
  }

  inFlight = true;
  const userEntry = { role: "user", content: userText };
  if (synthetic) userEntry.hidden = true;
  else {
    els.userInput.value = "";
    autoGrowInput();
    appendMessage(userText, "user-msg");
  }
  state.chat.push(userEntry);
  els.sendBtn.disabled = true;
  const t0 = Date.now();
  amLog("chat", "send-start", { chars: userText.length, synthetic, interview: interviewActive });

  try {
    await autoHarvestActiveTab();
    const tabContext = await getTabContext();
    const msgs = [
      { role: "system", content: buildSystemPrompt(tabContext) },
      ...contextMessages(),
    ];
    amLog("chat", "request", {
      model: state.model || DEFAULT_MODEL,
      msgCount: msgs.length,
      hasProblemCtx: !!problemContext,
      harvestBlocked,
    });

    let finalText = null;
    let turnUsage = null;
    let finalBubble = null;
    let thinkingEl = null; // one block per turn, reasoning accumulates across tool rounds
    let turnReasoning = "";
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      let liveBubble = null;
      const priorReasoning = turnReasoning ? turnReasoning + "\n\n" : "";
      // Deltas arrive per token; paint at most every RENDER_THROTTLE_MS with the
      // latest accumulated text instead of once per delta.
      let pendingText = "";
      let pendingReasoning = "";
      let paintTimer = null;
      const paint = () => {
        paintTimer = null;
        if (pendingReasoning) {
          if (!thinkingEl) thinkingEl = appendThinking();
          setThinkingText(thinkingEl, priorReasoning + pendingReasoning, true);
        }
        if (!pendingText) return;
        if (!liveBubble) liveBubble = appendMessage(pendingText, "ai-msg");
        else setBubbleText(liveBubble, pendingText, "ai-msg");
        els.chatWindow.scrollTop = els.chatWindow.scrollHeight;
      };
      let msg;
      try {
        msg = await chatCompletion(msgs, (text, reasoning) => {
          pendingText = text;
          pendingReasoning = reasoning;
          if (!paintTimer) paintTimer = setTimeout(paint, RENDER_THROTTLE_MS);
        });
      } finally {
        clearTimeout(paintTimer);
        paint(); // flush whatever the last scheduled paint would have shown
      }
      if (!msg) throw new Error("Empty response from model");
      if (msg.reasoning) turnReasoning = priorReasoning + msg.reasoning;
      if (msg.usage) turnUsage = msg.usage;

      if (msg.tool_calls && msg.tool_calls.length > 0) {
        if (liveBubble) liveBubble.remove(); // discard tool-round preamble bubble
        msgs.push(msg);
        for (const tc of msg.tool_calls) {
          let args = null;
          try { args = JSON.parse(tc.function.arguments || "{}"); } catch (e) { /* handled below */ }
          const result = args === null
            ? "error: tool arguments were not valid JSON"
            : await execTool(tc.function.name, args);
          amLog("chat", "tool-call", {
            round,
            tool: tc.function.name,
            argChars: (tc.function.arguments || "").length,
            result: result.slice(0, 120),
          });
          // read_attempt returns the whole harvested attempt (code included) for the
          // model — surface only a one-line receipt in the chat, not the code dump.
          note(`🧠 ${tc.function.name === "read_attempt" && !result.startsWith("error")
            ? `Read attempt: "${problemContext?.title}" — verdict: ${problemContext?.verdict || "none yet"}.`
            : result}`);
          msgs.push({ role: "tool", tool_call_id: tc.id, content: result });
        }
        continue;
      }
      finalText = msg.content || "";
      finalBubble = liveBubble;
      break;
    }
    if (!finalText) {
      finalText = "(memory updated — hit a tool-round limit, say that again?)";
      if (finalBubble) setBubbleText(finalBubble, finalText, "ai-msg");
      else appendMessage(finalText, "ai-msg");
    }
    if (thinkingEl) setThinkingText(thinkingEl, turnReasoning, false);

    const assistantEntry = { role: "assistant", content: finalText };
    if (turnReasoning) assistantEntry.reasoning = turnReasoning;
    state.chat.push(assistantEntry);
    state.chat = state.chat.slice(-MAX_STORED_MESSAGES);
    await save();
    amLog("chat", "send-done", {
      replyChars: finalText.length,
      reasoningChars: turnReasoning.length,
      ms: Date.now() - t0,
      usage: turnUsage
        ? { prompt: turnUsage.prompt_tokens ?? null, completion: turnUsage.completion_tokens ?? null }
        : null,
    });
    return true;
  } catch (error) {
    amLog("chat", "send-failed", { error: String(error.message).slice(0, 300), ms: Date.now() - t0 });
    const i = state.chat.lastIndexOf(userEntry);
    if (i !== -1) state.chat.splice(i, 1);
    if (!synthetic) {
      els.userInput.value = userText;
      autoGrowInput();
    }
    note(`Couldn't reach your buddy: ${error.message}`, "error-msg");
    await save();
    return false;
  } finally {
    inFlight = false;
    els.sendBtn.disabled = false;
    els.userInput.focus();
  }
}

async function toggleToday() {
  const key = amTodayKey();
  if (state.history[key]) {
    delete state.history[key];
  } else {
    state.history[key] = true;
  }
  await save();
  renderStreak();
  amLog("streak", "toggled", { day: key, done: !!state.history[key], streak: currentStreak() });
}

// ---------- Mock interview ----------

function renderInterviewBanner() {
  if (!interviewActive) {
    els.interviewBanner.classList.remove("active");
    els.interviewBanner.textContent = "";
    return;
  }
  const min = Math.floor((Date.now() - interviewStart) / 60000);
  const sec = Math.floor(((Date.now() - interviewStart) % 60000) / 1000);
  els.interviewBanner.classList.add("active");
  els.interviewBanner.textContent =
    `🎤 Mock interview live · ${min}:${String(sec).padStart(2, "0")} · explain your approach + complexity before coding. Hit ⏹ to end.`;
}

async function toggleInterview() {
  if (inFlight) return;
  if (!interviewActive) {
    if (!state.apiKey) {
      appendMessage("Set your OpenRouter key first.", "error-msg");
      return;
    }
    interviewActive = true;
    interviewStart = Date.now();
    els.interviewBtn.textContent = "⏹";
    els.interviewBtn.classList.add("active");
    interviewTimer = setInterval(renderInterviewBanner, 1000);
    renderInterviewBanner();
    amLog("interview", "start");
    await sendMessage("Begin the mock interview. Pick my problem and start.");
  } else {
    amLog("interview", "end", { minutes: Math.round((Date.now() - interviewStart) / 60000) });
    await sendMessage("End the interview now. Give me my verdict and scores out of 10, and save the score.");
    interviewActive = false;
    clearInterval(interviewTimer);
    els.interviewBtn.textContent = "🎤";
    els.interviewBtn.classList.remove("active");
    renderInterviewBanner();
  }
}

// ---------- Pull LeetCode attempt into context (Phase E layer 1) ----------

async function pullAttempt() {
  els.pullBtn.disabled = true;
  try {
    const tab = await findProblemTab();
    if (!tab) {
      note("Open a LeetCode problem tab first, then hit 📥.", "error-msg");
      amLog("hijack", "pull-wrong-tab", { url: null });
      return;
    }
    const ctx = await chrome.tabs.sendMessage(tab.id, { type: "AM_HARVEST" });
    if (!ctx || ctx.error) {
      note(`Couldn't read the attempt: ${ctx?.error || "no response"}.`, "error-msg");
      amLog("hijack", "pull-failed", { error: ctx?.error || "no-response" });
      return;
    }
    problemContext = ctx;
    const bits = [
      ctx.code ? `code (${ctx.code.length} chars, ${ctx.codeSource})` : "no code found",
      ctx.verdict ? `verdict: ${ctx.verdict}` : "no verdict",
    ];
    note(`📥 Pulled "${ctx.title}" — ${bits.join(", ")}. The buddy can see it now.`);
    amLog("hijack", "pull-ok", { slug: ctx.slug, codeSource: ctx.codeSource, verdict: ctx.verdict });
  } catch (e) {
    note(`Pull failed: ${e.message}. Reload the LeetCode tab so the content script is live.`, "error-msg");
    amLog("hijack", "pull-exception", { error: String(e.message).slice(0, 200) });
  } finally {
    els.pullBtn.disabled = false;
  }
}

function problemContextBlock() {
  expireStaleContext();
  const c = problemContext;
  if (!c) return "";
  const age = Math.round((Date.now() - c.ts) / 60000);
  const heading = c.viewingSubmission
    ? `## A PAST submission the user is viewing (pulled ${age}m ago — this is an old submission's code from their history, NOT necessarily their live editor)`
    : `## The user's current LeetCode attempt (pulled ${age}m ago — this is their real work)`;
  return `${heading}\n` +
    `Problem: ${c.title}${c.difficulty ? ` [${c.difficulty}]` : ""} (${c.url})\n` +
    `Judged verdict: ${c.verdict || "unknown"}\n` +
    (c.description ? `Prompt: ${c.description}\n` : "") +
    (c.code ? `\n${c.viewingSubmission ? "That submission's" : "Their current"} code (source: ${c.codeSource}):\n\`\`\`\n${c.code}\n\`\`\`\n` : "\n(no code captured)\n") +
    (c.testResult ? `\nJudged result detail (trust this over any sample "Accepted"):\n${c.testResult}\n` : "") +
    `\nUse this to give targeted Socratic hints about THEIR code and THEIR failing case. ` +
    `For bugs: ask them to trace the failing input line by line, or point at the symptom's ` +
    `LOCATION at most ("look at your loop bounds") — never the fix itself, never corrected ` +
    `code. No solutions in any form; rule #1's assisted-solve protocol applies if they ` +
    `insist. CRITICAL: the verdict above is the real judged ` +
    `result. Do NOT congratulate them or claim the problem is solved unless the verdict is "Accepted" ` +
    `— a passing sample/custom test is not a solve. Never declare their daily target or streak done ` +
    `from a test result; only auto-detected solves count for that.`;
}

// ---------- Proactive daily check-in ----------

async function maybeDailyCheckin() {
  if (!state.apiKey) return;
  if (state.lastCheckin === amTodayKey()) return;
  amLog("checkin", "fired", { day: amTodayKey() });
  const ok = await sendMessage(
    "[Automatic daily check-in — greet me for the day. Reference my streak, whether yesterday " +
    "was done, and anything due in the re-solve queue, then get me to commit to today's target. " +
    "Be brief.]"
  );
  // Only mark the day checked-in when the greeting actually landed — marking it up
  // front meant one failed API call silently killed the check-in for the whole day.
  if (ok) {
    state.lastCheckin = amTodayKey();
    await save();
    amLog("checkin", "success", { day: state.lastCheckin });
  } else {
    amLog("checkin", "send-failed-will-retry", { day: amTodayKey() });
  }
}

// ---------- Logs viewer ----------

const LOG_KEYS = ["amLogs_panel", "amLogs_content", "amLogs_bg"];

async function loadAllLogs() {
  const got = await chrome.storage.local.get(LOG_KEYS);
  return LOG_KEYS.flatMap(k => got[k] || []).sort((a, b) => a.t - b.t);
}

function fmtLogEntry(e) {
  const d = new Date(e.t);
  const time = [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map(n => String(n).padStart(2, "0")).join(":");
  return `${time} [${e.ctx}] ${e.component}:${e.event}` +
    (e.data ? ` ${JSON.stringify(e.data)}` : "");
}

async function renderLogs() {
  const logs = await loadAllLogs();
  els.logView.textContent = logs.slice(-200).map(fmtLogEntry).join("\n") || "(no logs yet)";
  els.logView.scrollTop = els.logView.scrollHeight;
}

// ---------- Init ----------

document.addEventListener("DOMContentLoaded", async () => {
  amLogInit("panel");
  const stored = await chrome.storage.local.get(["state", "lcStats", "lcSolves", "lcProblemContext"]);
  if (stored.state) {
    state = { ...state, ...stored.state };
    state.memory = { facts: {}, plan: DEFAULT_PLAN, selfNotes: "", ...stored.state.memory };
  }
  if (stored.lcStats) lcStats = stored.lcStats;
  if (stored.lcSolves) lcSolves = stored.lcSolves;
  if (stored.lcProblemContext) problemContext = stored.lcProblemContext;
  if (!state.startDate) {
    state.startDate = amTodayKey();
    await save();
  }
  if (!state.lcUsername && lcStats?.username) {
    state.lcUsername = lcStats.username;
    await save();
  }
  amLog("init", "state-loaded", {
    hasApiKey: !!state.apiKey,
    model: state.model,
    lcUsername: state.lcUsername,
    chatLen: state.chat.length,
    facts: Object.keys(state.memory.facts).length,
    solvesLogged: lcSolves.length,
    statsAgeMin: lcStats ? Math.round((Date.now() - lcStats.fetchedAt) / 60000) : null,
    streak: currentStreak(),
  });

  els.apiKey.value = state.apiKey;
  els.model.value = state.model;
  els.lcUsername.value = state.lcUsername;
  els.personality.value = state.personality;
  els.dailyGoal.value = state.dailyGoal;
  els.nudgeEnabled.checked = state.nudgeEnabled !== false;
  els.nudgeHour.value = Number.isInteger(state.nudgeHour) ? state.nudgeHour : 21;

  renderBanner();
  renderStreak();
  renderMemory();
  renderChat();
  // Backfill from stored stats first so the streak (and the check-in greeting that
  // reads it) reflects panel-closed days; a fresh sync below backfills again.
  await backfillFromRecent(lcStats?.recent, "init");
  await autoMarkIfTargetMet();
  await maybeDailyCheckin();

  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== "local") return;
    // Never log amLogs_* changes here — logging a log write would loop forever.
    const relevant = ["lcStats", "lcSolves", "state", "lcProblemContext"].filter(k => k in changes);
    if (relevant.length) amLog("storage", "changed", { keys: relevant });
    if (changes.lcStats) {
      lcStats = changes.lcStats.newValue;
      if (lcStats?.username && !state.lcUsername) {
        state.lcUsername = lcStats.username;
        els.lcUsername.value = lcStats.username;
        await save();
      }
      renderBanner();
      await backfillFromRecent(lcStats?.recent, "stats-change");
    }
    if (changes.lcSolves) {
      lcSolves = changes.lcSolves.newValue || [];
      renderBanner();
      await autoMarkIfTargetMet();
    }
    if (changes.lcProblemContext) {
      problemContext = changes.lcProblemContext.newValue || null;
    }
    if (changes.state && changes.state.newValue &&
        changes.state.newValue._rev !== state._rev) {
      state = { ...state, ...changes.state.newValue };
      state.memory = { facts: {}, plan: DEFAULT_PLAN, selfNotes: "", ...state.memory };
      renderBanner();
      renderStreak();
      renderMemory();
    }
  });

  // Keep "today" honest if the panel stays open across midnight.
  setInterval(() => {
    if (amTodayKey() !== lastRenderedDay) {
      amLog("init", "midnight-rerender", { newDay: amTodayKey() });
      renderStreak();
      renderBanner();
    }
  }, 60 * 1000);

  if ((state.lcUsername || lcStats?.username) &&
      (!lcStats || Date.now() - lcStats.fetchedAt > STATS_STALE_MS)) {
    syncLcStats(false);
  }

  for (const id of ["apiKey", "model", "lcUsername", "personality", "dailyGoal"]) {
    els[id].addEventListener("change", async (e) => {
      state[id] = e.target.value;
      await save();
      amLog("settings", "changed", {
        field: id,
        value: id === "apiKey" ? `(len ${e.target.value.length})` : e.target.value,
      });
      if (id === "dailyGoal") {
        renderBanner();
        await autoMarkIfTargetMet();
      }
    });
  }

  els.syncBtn.addEventListener("click", () => syncLcStats(true));
  els.clearMemoryBtn.addEventListener("click", async () => {
    state.memory = { facts: {}, plan: DEFAULT_PLAN, selfNotes: "" };
    await save();
    renderMemory();
    renderBanner();
    amLog("memory", "reset");
  });
  els.logsSection.addEventListener("toggle", () => {
    if (els.logsSection.open) renderLogs();
  });
  els.refreshLogsBtn.addEventListener("click", renderLogs);
  els.copyLogsBtn.addEventListener("click", async () => {
    try {
      const logs = await loadAllLogs();
      await navigator.clipboard.writeText(JSON.stringify(logs, null, 2));
      note(`Copied ${logs.length} log entries to clipboard.`);
    } catch (e) {
      note(`Copy failed: ${e.message}`, "error-msg");
    }
  });
  els.clearLogsBtn.addEventListener("click", async () => {
    await chrome.storage.local.remove(LOG_KEYS);
    renderLogs();
  });

  els.nudgeEnabled.addEventListener("change", async (e) => {
    state.nudgeEnabled = e.target.checked;
    await save();
    amLog("settings", "nudge-enabled", { enabled: e.target.checked });
  });
  els.nudgeHour.addEventListener("change", async (e) => {
    const h = parseInt(e.target.value, 10);
    if (Number.isInteger(h) && h >= 0 && h <= 23) {
      state.nudgeHour = h;
      await save();
      amLog("settings", "nudge-hour", { hour: h });
    }
  });

  els.interviewBtn.addEventListener("click", toggleInterview);
  els.pullBtn.addEventListener("click", pullAttempt);
  els.doneBtn.addEventListener("click", toggleToday);
  els.sendBtn.addEventListener("click", () => sendMessage());
  els.userInput.addEventListener("keydown", (e) => {
    // Plain Enter sends; Shift+Enter falls through to the textarea's native newline.
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      sendMessage();
    }
  });
  els.userInput.addEventListener("input", autoGrowInput);
});

// Grow the chat textarea with its content, capped by the CSS max-height.
function autoGrowInput() {
  els.userInput.style.height = "auto";
  els.userInput.style.height = `${Math.min(els.userInput.scrollHeight, 96)}px`;
}
