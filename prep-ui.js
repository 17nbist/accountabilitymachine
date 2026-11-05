// prep.html controller (V4-CONTRACTS §A5, §E6, §I, §J1-§J7, §J11). Not pure: it owns
// the DOM, reads the URL, fetches the bank and reads and writes chrome.storage.local. The whole
// file is one IIFE so it adds no globals.
//
// M0: the shell (tab chrome, fixture= and tab=, the bank-missing screen, the body data-ready /
// data-bank-source flags). M3: the Today settings, and the item sessions of the Practice and
// Cards tabs (markdown + KaTeX, the numeric / mcq / free flows, auto and self grading, the
// writes per answer, Check my reasoning, keyboard shortcuts, the session summary) with the
// item=, source= and mistake= parameters. M4: the OA tab (the four timed simulators, their
// results, oaRuns and the in-app zetamac entry) with the seed= parameter. M5: the Market tab (the
// seeded market-making game, its round table, fills and settlement, and the mmRuns write). M6: the
// Dashboard (area scores and their trend, NeetCode 150, the mistakes journal, checkpoint, under
// 60, mock verdicts) and the Library (library/index.json, item counts, practice from a source).
// Each tab's content is rendered by RENDER[<tab id>].
// Every prep/*.js module is optional here (checked with typeof): a tab whose modules did not
// load says so instead of rendering, and the page still reaches ready.
(() => {
  "use strict";

  const TAB_IDS = ["today", "practice", "cards", "oa", "market", "dashboard", "library"]; // §J1
  const DEFAULT_TAB = "today";

  // Globals from the §A5 load order; null until their milestone lands.
  const mods = {
    PrepRng: typeof PrepRng !== "undefined" ? PrepRng : null,
    PrepAnswer: typeof PrepAnswer !== "undefined" ? PrepAnswer : null,
    PrepBank: typeof PrepBank !== "undefined" ? PrepBank : null,
    PrepSrs: typeof PrepSrs !== "undefined" ? PrepSrs : null,
    PrepOA: typeof PrepOA !== "undefined" ? PrepOA : null,
    PrepMarket: typeof PrepMarket !== "undefined" ? PrepMarket : null,
    PrepReadiness: typeof PrepReadiness !== "undefined" ? PrepReadiness : null,
  };
  const A = mods.PrepAnswer;
  const B = mods.PrepBank;
  const S = mods.PrepSrs;
  const R = mods.PrepReadiness;
  const SESSION_MODS = ["PrepAnswer", "PrepBank", "PrepSrs", "PrepReadiness"];

  // ---------- URL parameters (§J1) ----------

  const params = new URLSearchParams(location.search);
  const fixture = params.get("fixture") === "1"; // §E6: always the fixture, even if bank/ exists
  const URL_ITEM = params.get("item"); // one-item Practice session
  const URL_SOURCE = params.get("source"); // Practice session of one library file's items
  // mistake=<ts> only counts together with item=: it adds the note editor for (ts, item).
  const URL_MISTAKE_TS = (() => {
    const m = params.get("mistake");
    return URL_ITEM !== null && m !== null && /^\d+$/.test(m) && Number.isSafeInteger(Number(m)) ? Number(m) : null;
  })();
  // seed=: every OA run and market game on this page (M4, M5) uses it when it is a decimal
  // below 2^32; any other value is ignored and the seed comes from the clock.
  const URL_SEED = (() => {
    const s = params.get("seed");
    return s !== null && /^\d+$/.test(s) && Number(s) < 4294967296 ? Number(s) : null;
  })();
  function pageSeed() {
    return URL_SEED !== null ? URL_SEED : Date.now() % 4294967296;
  }

  let data = null; // the §E6 loader result, or null when no bank loaded
  let byId = {}; // item id -> item (first occurrence), set once the bank has loaded
  let activeTab = null;
  const items = () => (data ? data.items : []);

  // ---------- small helpers ----------

  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const isObj = x => typeof x === "object" && x !== null && !Array.isArray(x);
  const asList = x => (Array.isArray(x) ? x : []);
  const store = chrome.storage.local;

  // h("button", { class, text, "data-role": "x", onclick }, ...children). An attribute whose
  // value is undefined, null or false is left out; "" is kept (data-state="" is a state).
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k === "hidden") el.hidden = true;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : String(v));
    }
    el.append(...present(kids));
    return el;
  }

  // Children to add: nested arrays flattened, null / undefined / false skipped (append and
  // replaceChildren would print them as text).
  const present = kids => kids.flat().filter(k => k !== null && k !== undefined && k !== false);
  function fill(el, ...kids) {
    el.replaceChildren(...present(kids));
  }

  function setState(el, state, text) {
    el.dataset.state = state;
    if (text !== undefined) el.textContent = text;
  }

  // m:ss, or h:mm:ss past an hour.
  function fmtDuration(secs) {
    const s = Math.max(0, Math.round(secs));
    const hh = Math.floor(s / 3600);
    const mm = Math.floor((s % 3600) / 60);
    const ss = String(s % 60).padStart(2, "0");
    return hh ? `${hh}:${String(mm).padStart(2, "0")}:${ss}` : `${mm}:${ss}`;
  }

  const AREA_LABEL = {
    probability: "Probability", brainteaser: "Brainteasers", statistics: "Statistics",
    finance: "Finance", cpp: "C++", systems: "Systems",
  };

  function cardOf(cards, id) {
    return isObj(cards) && own(cards, id) && isObj(cards[id]) ? cards[id] : null;
  }

  // ---------- storage writes ----------

  // Every prep.html write goes through one promise chain, so the read-modify-writes of one
  // answer (history, card, mistake, practice log) never interleave with the next answer's.
  // Each step re-reads its keys right before writing (§I). A failed write is logged and the
  // chain carries on.
  let writeChain = Promise.resolve();
  function queueWrite(label, fn) {
    const p = writeChain.then(fn).catch(e => {
      amLog("storage", "write-failed", { label, error: String((e && e.message) || e).slice(0, 200) });
    });
    writeChain = p;
    return p;
  }

  // ---------- markdown + KaTeX (spec §3 F1.4) ----------

  // marked would eat the backslashes and underscores of TeX, so maths spans are cut out first
  // and replaced by placeholders (private-use characters that markdown leaves alone). The rest
  // goes through marked + DOMPurify, then each placeholder becomes KaTeX output. Code spans and
  // fences are copied through untouched, so `$` inside code is not maths. Inline maths follows
  // the usual TeX-in-markdown rule: the opening `$` is followed by a non-space, the closing `$`
  // is preceded by a non-space and not followed by a digit ("$5 and $10" stays text).
  const PH_OPEN = "";
  const PH_CLOSE = "";
  const PH_SPLIT = /(\d+)/;

  function inlineMathEnd(md, start) {
    if (start >= md.length || /\s/.test(md[start])) return -1;
    for (let k = start; k < md.length; k++) {
      const c = md[k];
      if (c === "\\") { k++; continue; }
      if (c === "\n" && md[k + 1] === "\n") return -1;
      if (c === "$") return /\s/.test(md[k - 1]) || /[0-9]/.test(md[k + 1] || "") ? -1 : k;
    }
    return -1;
  }

  function cutMath(md) {
    const math = [];
    let out = "";
    let i = 0;
    const put = (tex, display) => {
      out += PH_OPEN + math.length + PH_CLOSE;
      math.push({ tex, display });
    };
    while (i < md.length) {
      const c = md[i];
      if (c === "\\" && i + 1 < md.length) {
        out += c + md[i + 1];
        i += 2;
      } else if (c === "`") {
        let j = i;
        while (md[j] === "`") j++;
        const end = md.indexOf(md.slice(i, j), j);
        const stop = end < 0 ? j : end + (j - i);
        out += md.slice(i, stop);
        i = stop;
      } else if (c === "$" && md[i + 1] === "$" && md.indexOf("$$", i + 2) > i + 2) {
        const end = md.indexOf("$$", i + 2);
        put(md.slice(i + 2, end), true);
        i = end + 2;
      } else if (c === "$" && md[i + 1] !== "$" && inlineMathEnd(md, i + 1) > 0) {
        const end = inlineMathEnd(md, i + 1);
        put(md.slice(i + 1, end), false);
        i = end + 1;
      } else {
        out += c;
        i++;
      }
    }
    return { md: out, math };
  }

  function renderTex(el, m) {
    if (typeof katex !== "undefined") {
      try {
        katex.render(m.tex, el, { displayMode: m.display, throwOnError: false });
        return;
      } catch (e) { /* fall through to the raw TeX */ }
    }
    el.textContent = m.display ? `$$${m.tex}$$` : `$${m.tex}$`;
  }

  function fillMath(root, math) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) if (PH_SPLIT.test(walker.currentNode.nodeValue)) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const frag = document.createDocumentFragment();
      node.nodeValue.split(PH_SPLIT).forEach((part, k) => {
        if (k % 2 === 0) {
          if (part) frag.append(part);
          return;
        }
        const m = math[Number(part)];
        const span = h("span", { class: m.display ? "math math-display" : "math" });
        renderTex(span, m);
        frag.append(span);
      });
      node.replaceWith(frag);
    }
  }

  // Renders markdown with $...$ / $$...$$ maths into `el`. Without marked or DOMPurify the text
  // is shown as is (maths still rendered).
  function renderRich(el, md) {
    const { md: cut, math } = cutMath(typeof md === "string" ? md : "");
    let html = null;
    if (typeof marked !== "undefined" && typeof DOMPurify !== "undefined") {
      try {
        html = DOMPurify.sanitize(marked.parse(cut, { async: false, gfm: true }));
      } catch (e) {
        html = null;
      }
    }
    if (html === null) el.textContent = cut;
    else el.innerHTML = html;
    if (math.length) fillMath(el, math);
    for (const a of el.querySelectorAll("a[href]")) {
      a.target = "_blank";
      a.rel = "noopener noreferrer";
    }
  }

  function rich(cls, md, props = {}) {
    const el = h("div", { class: `rich ${cls}`, ...props });
    renderRich(el, md);
    return el;
  }

  // ---------- Check my reasoning (§J11) ----------

  const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
  const STREAM_IDLE_MS = 45000;

  // POSTs `body` and streams it: onText(contentSoFar) per delta, resolves the full content.
  // The SSE parsing and the idle watchdog follow the side panel's chatCompletion.
  async function streamChat(apiKey, body, controller, onText) {
    let idleTimer = null;
    let stalled = false;
    const resetIdle = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => { stalled = true; controller.abort(); }, STREAM_IDLE_MS);
    };
    let content = "";
    const onLine = line => {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) return;
      const payload = trimmed.slice(5).trim();
      if (payload === "[DONE]") return;
      let json;
      try { json = JSON.parse(payload); } catch (e) { return; }
      if (json.error) throw new Error(json.error.message || JSON.stringify(json.error).slice(0, 200));
      const delta = json.choices?.[0]?.delta;
      if (delta && typeof delta.content === "string" && delta.content) {
        content += delta.content;
        onText(content);
      }
    };
    try {
      resetIdle();
      const response = await fetch(OPENROUTER_URL, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://github.com/namanbist/accountabilitymachine",
          "X-Title": "Accountability Machine",
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        resetIdle();
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();
        lines.forEach(onLine);
      }
      onLine(buffer + decoder.decode());
      return content;
    } catch (e) {
      if (stalled) throw new Error(`the model stream stalled (${STREAM_IDLE_MS / 1000} s without data)`);
      throw e;
    } finally {
      clearTimeout(idleTimer);
    }
  }

  function setReasoning(cur, state, text) {
    cur.reasoning.dataset.state = state;
    if (text !== undefined) cur.reasoningBody.textContent = text;
  }

  // Never touches the grade or storage (spec §3 F1.4): it only reads `state` and streams the
  // critique into [data-role=reasoning].
  async function checkReasoning(v) {
    const cur = v.cur;
    if (!cur || !(cur.done || cur.revealed) || cur.busy) return;
    cur.busy = true;
    cur.checkBtn.disabled = true;
    cur.reasoning.hidden = false;
    try {
      const { state } = await store.get("state");
      if (v.cur !== cur) return;
      const st = isObj(state) ? state : {};
      const apiKey = typeof st.apiKey === "string" ? st.apiKey.trim() : "";
      if (!apiKey) {
        setReasoning(cur, "error", "No OpenRouter API key yet: add your API key in the side panel's settings, then try again.");
        amLog("reasoning", "no-key", { itemId: cur.item.id });
        return;
      }
      const item = cur.item;
      const working = item.type === "free" ? cur.textarea.value.trim() : "";
      const answer = item.type === "numeric" ? cur.raw : item.type === "mcq" ? item.answer.choices[cur.choice] : "";
      const body = R.reasoningRequest(item, working, answer, st.model);
      setReasoning(cur, "streaming", "");
      amLog("reasoning", "start", { itemId: item.id, model: body.model });
      cur.ctl = new AbortController();
      try {
        const text = await streamChat(apiKey, body, cur.ctl, partial => renderRich(cur.reasoningBody, partial));
        if (cur.aborted) return;
        renderRich(cur.reasoningBody, text || "(The model sent no text.)");
        setReasoning(cur, "done");
        amLog("reasoning", "done", { itemId: item.id, chars: text.length });
      } catch (e) {
        if (cur.aborted) return;
        const msg = String((e && e.message) || e);
        setReasoning(cur, "error", `Check my reasoning failed: ${msg}`);
        amLog("reasoning", "failed", { itemId: item.id, error: msg.slice(0, 200) });
      } finally {
        cur.ctl = null;
      }
    } finally {
      cur.busy = false;
      cur.checkBtn.disabled = false;
    }
  }

  // Called whenever the item on screen changes: a critique still streaming is dropped.
  function abortReasoning(v) {
    const cur = v.cur;
    if (cur && cur.ctl) {
      cur.aborted = true;
      cur.ctl.abort();
    }
  }

  // ---------- item sessions (§J2) ----------

  // One view per tab (#tab-practice, #tab-cards), each holding one `.session`.
  function makeView(scope) {
    const v = { scope, sess: null, cur: null, token: 0, starting: null, defaultSpec: null };
    v.title = h("span", { class: "session-title" });
    v.progress = h("span", { class: "session-progress muted" });
    v.endBtn = h("button", {
      type: "button", class: "btn btn-quiet", "data-role": "end-session", hidden: true,
      text: "End session", onclick: () => endSession(v),
    });
    v.itemEl = h("article", { class: "item", "data-role": "item", hidden: true });
    v.emptyEl = h("div", { class: "session-empty", "data-role": "empty", hidden: true });
    v.summaryEl = h("section", { class: "summary", "data-role": "summary", hidden: true });
    v.root = h("div", { class: "session" },
      h("div", { class: "session-bar" }, v.title, v.progress, h("span", { class: "spacer" }), v.endBtn),
      v.itemEl, v.emptyEl, v.summaryEl);
    return v;
  }

  const practiceView = makeView("practice");
  const cardsView = makeView("cards");

  // A session is active from its start until its summary (or its empty screen) is shown.
  const isActive = v => !!v.starting || !!(v.sess && !v.sess.ended);

  // Session specs: build({ cards, settings, now }) -> { ids, areas, emptyText }. `areas` are the
  // session areas of the summary's due-tomorrow count (§J2).
  function practiceSpec() {
    return {
      kind: "practice",
      title: "Practice",
      build: ({ cards, settings, now }) => {
        const areas = settings.areas.filter(a => B.PRACTICE_AREAS.includes(a));
        return {
          ids: S.buildQueue(items(), cards, now, { ...settings, areas }),
          areas,
          emptyText: areas.length
            ? "Nothing to practise right now: no reviews are due and today's new items are done. Come back later, or raise New items per day on the Today tab."
            : "No practice area is ticked in the Today tab's settings.",
        };
      },
    };
  }

  function cardsSpec(topic) {
    return {
      kind: "cards",
      title: topic ? `Cards · ${topic}` : "Cards",
      build: ({ cards, settings, now }) => {
        const areas = settings.areas.filter(a => B.CARD_AREAS.includes(a));
        return {
          ids: S.buildQueue(items(), cards, now, { ...settings, areas }, { topics: topic ? [topic] : [] }),
          areas,
          emptyText: areas.length
            ? `No cards are due${topic ? ` for ${topic}` : ""}, and today's new cards are done.`
            : "Neither C++ nor Systems is ticked in the Today tab's settings.",
        };
      },
    };
  }

  function itemSpec(id, noteTs) {
    return {
      kind: "item",
      title: "Single item",
      itemId: id,
      noteTs,
      build: () => {
        const it = own(byId, id) ? byId[id] : null;
        return it
          ? { ids: [id], areas: [it.area] }
          : { ids: [], areas: [], emptyText: `No item with id "${id}" in this bank. A rebuild may have reworded or removed it.` };
      },
    };
  }

  function libraryTitle(file) {
    const cats = data && data.library && Array.isArray(data.library.categories) ? data.library.categories : [];
    for (const c of cats) {
      for (const e of asList(c && c.entries)) if (e && e.file === file && typeof e.title === "string") return e.title;
    }
    return file;
  }

  function sourceSpec(file) {
    return {
      kind: "source",
      title: `Source: ${libraryTitle(file)}`,
      build: ({ cards, now }) => {
        const src = items().filter(it => it && it.source && it.source.file === file);
        const ids = S.drillQueue(src, cards, now, { count: src.length });
        const local = B.indexById(src);
        return { ids, areas: [...new Set(ids.map(id => local[id].area))], emptyText: `No bank item cites ${file}.` };
      },
    };
  }

  // Re-reads the keys a session needs (§I), builds its queue and shows its first item. A later
  // start replaces an earlier one still reading storage.
  function startSession(v, spec) {
    const p = doStart(v, spec);
    v.starting = p;
    const clear = () => { if (v.starting === p) v.starting = null; };
    p.then(clear, clear);
    return p;
  }

  async function doStart(v, spec) {
    const token = ++v.token;
    const st = await store.get(["prepCards", "prepSettings", "prepMistakes"]);
    if (token !== v.token) return;
    const now = Date.now();
    const cards = isObj(st.prepCards) ? st.prepCards : {};
    const settings = S.normalizeSettings(st.prepSettings);
    const built = spec.build({ cards, settings, now });
    abortReasoning(v);
    let note = null;
    if (spec.noteTs !== null && spec.noteTs !== undefined) {
      const m = asList(st.prepMistakes).find(x => isObj(x) && x.ts === spec.noteTs && x.itemId === spec.itemId);
      note = { ts: spec.noteTs, itemId: spec.itemId, entry: m || null };
    }
    const sess = {
      kind: spec.kind, ids: built.ids, areas: built.areas, pos: 0, startTs: now,
      acc: { probItems: 0, cppSecs: 0 }, entries: [], mistakes: [], cards, ended: false, note,
    };
    v.sess = sess;
    v.cur = null;
    v.title.textContent = spec.title;
    v.summaryEl.hidden = true;
    v.summaryEl.replaceChildren();
    amLog("session", "start", { scope: v.scope, kind: sess.kind, items: sess.ids.length });
    if (!sess.ids.length) {
      sess.ended = true;
      v.itemEl.hidden = true;
      v.itemEl.replaceChildren();
      v.endBtn.hidden = true;
      v.progress.textContent = "";
      v.emptyEl.textContent = built.emptyText;
      v.emptyEl.hidden = false;
      return;
    }
    v.emptyEl.hidden = true;
    v.endBtn.hidden = false;
    showItem(v);
  }

  // ---------- one item ----------

  function brokenNumeric(item) {
    return item.type === "numeric" && !(item.answer && A.parseAnswer(item.answer.value).ok);
  }

  function showItem(v) {
    const sess = v.sess;
    const item = byId[sess.ids[sess.pos]];
    abortReasoning(v);
    const cur = { item, shownTs: Date.now(), done: false, revealed: false, raw: "", choice: null, ctl: null, busy: false, aborted: false };
    v.cur = cur;
    const last = sess.pos + 1 === sess.ids.length;
    v.progress.textContent = `${sess.pos + 1} of ${sess.ids.length}`;

    const el = v.itemEl;
    el.dataset.itemId = item.id;
    el.dataset.itemType = item.type;
    el.dataset.area = item.area;
    el.dataset.answered = "0";

    const check = isObj(item.check) ? item.check : {};
    const meta = h("div", { class: "item-meta" },
      h("span", { class: "chip chip-area", text: AREA_LABEL[item.area] || item.area }),
      asList(item.topics).map(t => h("span", { class: "chip", text: t })),
      h("span", { class: "muted", text: `difficulty ${item.difficulty}/5` }),
      h("a", {
        class: "source", "data-role": "source", href: B.libraryHref(item, data.root),
        target: "_blank", rel: "noopener", title: "Open the source in the library", text: B.sourceLabel(item),
      }));
    const disputed = check.status === "disputed";
    const banner = h("div", {
      class: "banner banner-warn", "data-role": "disputed", role: "note", hidden: !disputed,
      text: disputed
        ? `Disputed answer: the source prints ${check.printed}, but a blind re-solve got ${check.resolved}. ` +
          `This item is marked against the printed answer, so read the solution critically.` +
          (check.note ? ` (${check.note})` : "")
        : "",
    });

    cur.result = h("div", { class: "result", "data-role": "result", "data-state": "", role: "status", "aria-live": "polite" });
    cur.autoGrade = h("span", { class: "grade-chip", "data-role": "auto-grade" });
    cur.autoLine = h("div", { class: "auto-line", hidden: true }, "Next review: ", cur.autoGrade);
    cur.solution = h("div", { class: "solution", "data-role": "solution", hidden: true });
    cur.gradeRow = h("div", { class: "grade-row", hidden: true },
      S.GRADES.map((g, k) => h("button", {
        type: "button", class: `btn grade grade-${g}`, "data-role": "grade", "data-grade": g,
        title: `Key ${k + 1}`, onclick: () => gradeFree(v, g),
      })));
    cur.nextBtn = h("button", {
      type: "button", class: "btn btn-primary", "data-role": "next", hidden: true,
      title: "Enter", text: last ? "Finish" : "Next", onclick: () => next(v),
    });
    cur.checkBtn = h("button", {
      type: "button", class: "btn", "data-role": "check-reasoning", hidden: true,
      text: "Check my reasoning", onclick: () => checkReasoning(v),
    });
    const broken = brokenNumeric(item);
    const skipBtn = broken
      ? h("button", { type: "button", class: "btn", "data-role": "skip", text: "Skip", onclick: () => advance(v) })
      : null;
    cur.reasoningBody = h("div", { class: "rich reasoning-body" });
    cur.reasoning = h("div", { class: "reasoning", "data-role": "reasoning", "data-state": "idle", hidden: true },
      h("div", { class: "reasoning-head", text: "Critique from the model (it never changes your grade)" }),
      cur.reasoningBody);

    fill(el,
      meta,
      banner,
      broken ? h("div", { class: "banner banner-warn", text: "This item's stored answer does not parse, so it cannot be marked. Skip it." }) : null,
      rich("prompt", item.prompt, { "data-role": "prompt" }),
      answerBox(v, cur),
      cur.result,
      cur.autoLine,
      cur.solution,
      cur.gradeRow,
      h("div", { class: "actions" }, cur.nextBtn, skipBtn, cur.checkBtn),
      cur.reasoning,
      noteEditor(v, cur));
    el.hidden = false;
    if (cur.input) cur.input.focus({ preventScroll: true });
  }

  function answerBox(v, cur) {
    const item = cur.item;
    if (item.type === "numeric") {
      cur.input = h("input", {
        type: "text", class: "answer-input", "data-role": "answer-input", autocomplete: "off",
        spellcheck: "false", "aria-label": "Your answer", placeholder: "e.g. 7/36, 0.1944, C(10,3)/2^10, 1/e",
        oninput: () => updatePreview(cur),
      });
      cur.preview = h("div", { class: "preview", "data-role": "preview", "data-state": "empty", "aria-live": "polite" });
      cur.submitBtn = h("button", {
        type: "button", class: "btn btn-primary", "data-role": "submit", title: "Enter",
        text: "Submit", onclick: () => submitNumeric(v),
      });
      return h("div", { class: "answer-box" }, h("div", { class: "answer-row" }, cur.input, cur.submitBtn), cur.preview);
    }
    if (item.type === "mcq") {
      cur.choices = asList(item.answer && item.answer.choices).map((c, i) => h("button", {
        type: "button", class: "choice", "data-role": "choice", "data-index": i, onclick: () => submitMcq(v, i),
      }, String(c)));
      return h("div", { class: "answer-box choices" }, cur.choices);
    }
    cur.textarea = h("textarea", {
      class: "free-input", "data-role": "free-input", rows: 5, "aria-label": "Your working",
      placeholder: "Your working (optional). Space reveals the answer when the cursor is not in this box.",
    });
    cur.revealBtn = h("button", {
      type: "button", class: "btn btn-primary", "data-role": "reveal", title: "Space",
      text: "Reveal", onclick: () => reveal(v),
    });
    return h("div", { class: "answer-box" }, cur.textarea, h("div", { class: "row" }, cur.revealBtn));
  }

  // The live preview of a numeric answer: empty, "= <value>", or the parse error.
  function updatePreview(cur) {
    const raw = cur.input.value;
    if (!raw.trim()) return setState(cur.preview, "empty", "");
    const r = A.parseAnswer(raw);
    if (r.ok) setState(cur.preview, "ok", `= ${A.formatPreview(r.value)}`);
    else setState(cur.preview, "error", r.error);
  }

  // The stored answer as shown: a numeric expression gets its value too ("7/36 = 0.194444").
  function shownAnswer(item) {
    const text = String(B.answerText(item));
    if (item.type !== "numeric") return text;
    const p = A.parseAnswer(text);
    const approx = p.ok ? A.formatPreview(p.value) : "";
    return approx && approx !== text.trim() ? `${text} = ${approx}` : text;
  }

  function showSolution(cur) {
    const item = cur.item;
    const check = isObj(item.check) ? item.check : {};
    const parts = [];
    if (item.type === "free") {
      parts.push(h("h3", { text: "Model answer" }), rich("model-answer", item.answer.value));
    } else {
      parts.push(h("h3", { text: "Answer" }), h("p", { class: "answer-value", text: shownAnswer(item) }));
    }
    parts.push(h("h3", { text: "Solution" }), rich("solution-body", item.solution));
    if (check.status === "corrected") {
      parts.push(h("p", { class: "muted small", text: `Corrected: the source printed ${check.printed}; this item uses the re-solved ${check.resolved}.` }));
    }
    cur.solution.replaceChildren(...parts);
    cur.solution.hidden = false;
  }

  function submitNumeric(v) {
    const cur = v.cur;
    if (!cur || cur.done || v.sess.ended || cur.item.type !== "numeric") return;
    const raw = cur.input.value;
    const r = A.checkNumeric(raw, cur.item);
    if (r.expected === null) {
      setState(cur.result, "error", "This item's stored answer does not parse, so it cannot be marked. Skip it.");
      return;
    }
    if (r.correct === null) {
      // A parse error is never counted: the item stays open and nothing is written (§C2).
      setState(cur.result, "error", `${r.error.replace(/\.$/, "")}. Nothing was recorded: fix the answer and submit again.`);
      return;
    }
    cur.raw = raw;
    const want = shownAnswer(cur.item);
    recordAuto(v, r.correct, raw.trim(),
      r.correct ? `Correct: ${A.formatPreview(r.parsed)} matches ${want}.` : `Wrong: you gave ${A.formatPreview(r.parsed)}; the answer is ${want}.`);
  }

  function submitMcq(v, i) {
    const cur = v.cur;
    if (!cur || cur.done || v.sess.ended) return;
    const r = A.checkMcq(i, cur.item);
    if (r.correct === null) return setState(cur.result, "error", r.error);
    cur.choice = i;
    cur.choices.forEach((b, k) => {
      b.disabled = true;
      b.classList.toggle("is-picked", k === i);
      b.classList.toggle("is-correct", k === r.expected);
    });
    recordAuto(v, r.correct, i,
      r.correct ? "Correct." : `Wrong: the answer is ${B.answerText(cur.item)}.`);
  }

  // A numeric or mcq answer: grade it (§D4, with the normalised secs, §H1), show the result,
  // the next interval and the solution, then write it.
  function recordAuto(v, correct, answer, resultText) {
    const cur = v.cur;
    const item = cur.item;
    const ts = Date.now();
    cur.done = true;
    const base = R.historyEntry({ ts, itemId: item.id, mode: "auto", correct, grade: null, secs: (ts - cur.shownTs) / 1000, answer });
    const entry = { ...base, grade: S.autoGrade(correct, base.secs, item) };
    const prev = cardOf(v.sess.cards, item.id);
    if (cur.input) {
      cur.input.readOnly = true;
      cur.submitBtn.disabled = true;
    }
    v.itemEl.dataset.answered = "1";
    setState(cur.result, correct ? "correct" : "wrong", resultText);
    cur.autoGrade.textContent = S.gradeLabels(prev)[entry.grade];
    cur.autoLine.hidden = false;
    showSolution(cur);
    cur.nextBtn.hidden = false;
    cur.checkBtn.hidden = false;
    cur.nextBtn.focus({ preventScroll: true });
    commit(v, entry);
  }

  function reveal(v) {
    const cur = v.cur;
    if (!cur || cur.item.type !== "free" || cur.revealed || v.sess.ended) return;
    cur.revealed = true;
    cur.textarea.readOnly = true;
    cur.revealBtn.hidden = true;
    setState(cur.result, "revealed", "Revealed: compare your working with the model answer, then grade yourself (keys 1 to 4).");
    showSolution(cur);
    const labels = S.gradeLabels(cardOf(v.sess.cards, cur.item.id));
    for (const b of cur.gradeRow.children) b.textContent = labels[b.dataset.grade];
    cur.gradeRow.hidden = false;
    cur.checkBtn.hidden = false;
  }

  // A free item: the grade click is the submit time and the answer is the trimmed working.
  function gradeFree(v, grade) {
    const cur = v.cur;
    if (!cur || !cur.revealed || cur.done || v.sess.ended) return;
    const ts = Date.now();
    cur.done = true;
    const entry = R.historyEntry({
      ts, itemId: cur.item.id, mode: "self", correct: null, grade,
      secs: (ts - cur.shownTs) / 1000, answer: cur.textarea.value.trim(),
    });
    v.itemEl.dataset.answered = "1";
    commit(v, entry);
    advance(v);
  }

  // The writes of one answer (§J2, §H1, §H10): the history entry, the card scheduled with the
  // same ts and grade, a mistake for an `again`, then the session's practice-log upsert.
  function commit(v, entry) {
    const sess = v.sess;
    const item = byId[entry.itemId];
    const mistake = R.mistakeFor(entry);
    sess.entries.push(entry);
    if (mistake) sess.mistakes.push(mistake);
    sess.cards = { ...sess.cards, [item.id]: S.schedule(cardOf(sess.cards, item.id), entry.grade, entry.ts) };
    const track = R.practiceTrack(item.area);
    if (track === "probability") sess.acc.probItems += 1;
    else if (track === "cpp") sess.acc.cppSecs += Math.min(entry.secs, 600); // §H10 per-item cap
    const practice = R.sessionPracticeEntries(sess.acc, sess.startTs);
    return queueWrite("answer", async () => {
      const st = await store.get(["prepHistory", "prepCards", "prepMistakes"]);
      const cards = isObj(st.prepCards) ? st.prepCards : {};
      const patch = {
        prepHistory: R.appendCapped(asList(st.prepHistory), [entry], R.HISTORY_CAP),
        prepCards: { ...cards, [item.id]: S.schedule(cardOf(cards, item.id), entry.grade, entry.ts) },
      };
      if (mistake) patch.prepMistakes = R.appendCapped(asList(st.prepMistakes), [mistake], R.MISTAKES_CAP);
      await store.set(patch);
      if (practice.length) {
        const { practiceLog } = await store.get("practiceLog");
        let log = asList(practiceLog);
        for (const e of practice) log = R.upsertSessionEntry(log, e);
        await store.set({ practiceLog: log });
      }
      amLog("answer", "saved", { itemId: item.id, mode: entry.mode, grade: entry.grade, secs: entry.secs, mistake: !!mistake });
    });
  }

  function next(v) {
    const cur = v.cur;
    if (!cur || !cur.done || cur.item.type === "free") return;
    advance(v);
  }

  function advance(v) {
    const sess = v.sess;
    if (!sess || sess.ended) return;
    if (sess.pos + 1 < sess.ids.length) {
      sess.pos += 1;
      showItem(v);
    } else {
      endSession(v);
    }
  }

  // Ends the session (after its last item, or End session) and shows the summary once this
  // session's writes have landed, so the due-tomorrow count sees its cards.
  async function endSession(v) {
    const sess = v.sess;
    if (!sess || sess.ended) return;
    sess.ended = true;
    abortReasoning(v);
    v.cur = null;
    v.itemEl.hidden = true;
    v.itemEl.replaceChildren();
    v.endBtn.hidden = true;
    v.progress.textContent = "";
    await writeChain;
    const { prepCards } = await store.get("prepCards");
    if (v.sess !== sess) return; // a new session started meanwhile
    const now = Date.now();
    const answered = sess.entries.length;
    const correct = sess.entries.filter(e => S.answerOk(e)).length;
    const accuracy = answered ? String(Math.round((100 * correct) / answered)) : "";
    const secs = sess.entries.reduce((n, e) => n + e.secs, 0);
    const dueTomorrow = S.dueCount(items(), isObj(prepCards) ? prepCards : {}, S.localDayStart(now, 2), sess.areas);
    const weakest = R.mistakeTopics(sess.mistakes, items()).slice(0, 3).map(t => t.topic);
    const el = v.summaryEl;
    el.dataset.answered = String(answered);
    el.dataset.correct = String(correct);
    el.dataset.accuracy = accuracy;
    el.dataset.secs = String(secs);
    el.dataset.dueTomorrow = String(dueTomorrow);
    const stat = (label, value) => h("div", { class: "stat" }, h("dt", { text: label }), h("dd", { text: value }));
    fill(el,
      h("h2", { text: "Session summary" }),
      h("dl", { class: "summary-grid" },
        stat("Answered", String(answered)),
        stat("Accuracy", answered ? `${accuracy}%` : "–"),
        stat("Time", fmtDuration(secs)),
        stat("Due tomorrow", String(dueTomorrow))),
      h("p", { class: "summary-weakest-line" }, "Weakest topics: ",
        h("span", { "data-role": "summary-weakest", text: weakest.length ? weakest.join(", ") : "none" })),
      v.defaultSpec
        ? h("div", { class: "row" }, h("button", {
          type: "button", class: "btn btn-primary", text: "Start a new session",
          onclick: () => startSession(v, v.defaultSpec()),
        }))
        : null);
    el.hidden = false;
    amLog("session", "end", { scope: v.scope, kind: sess.kind, answered, correct, secs, dueTomorrow });
  }

  // ---------- mistake note (§J2, §I) ----------

  function noteEditor(v, cur) {
    const note = v.sess.note;
    if (!note || note.itemId !== cur.item.id) return null;
    cur.noteText = h("textarea", {
      class: "note-input", "data-role": "mistake-note", rows: 3, "aria-label": "Mistake note",
      placeholder: "What went wrong, and what to remember next time",
    });
    cur.noteText.value = note.entry && typeof note.entry.note === "string" ? note.entry.note : "";
    cur.noteStatus = h("span", { class: "muted", role: "status" });
    const when = new Date(note.ts).toLocaleString();
    return h("div", { class: "note-editor" },
      h("h3", { text: "Mistake note" }),
      h("p", { class: "muted small", text: note.entry ? `From ${when}, when you answered ${JSON.stringify(note.entry.answer)}.` : `From ${when}.` }),
      cur.noteText,
      h("div", { class: "row" },
        h("button", { type: "button", class: "btn", "data-role": "mistake-note-save", text: "Save note", onclick: () => saveNote(v, cur) }),
        cur.noteStatus));
  }

  // Sets `note` (trimmed, first 500 characters) on the prepMistakes entries with this
  // (ts, itemId); every other entry is left as it is.
  function saveNote(v, cur) {
    const { ts, itemId } = v.sess.note;
    const text = cur.noteText.value.trim().slice(0, 500);
    return queueWrite("mistake-note", async () => {
      const { prepMistakes } = await store.get("prepMistakes");
      let hits = 0;
      const list = asList(prepMistakes).map(m => {
        if (!isObj(m) || m.ts !== ts || m.itemId !== itemId) return m;
        hits += 1;
        return { ...m, note: text };
      });
      if (hits) await store.set({ prepMistakes: list });
      cur.noteText.value = text;
      cur.noteStatus.textContent = hits ? "Saved." : "This mistake is no longer in the journal.";
      amLog("mistake", "note-saved", { itemId, ts, chars: text.length, found: hits > 0 });
    });
  }

  // ---------- keyboard (spec §3 F1.4, §J2) ----------

  // 1-4 grade (grade buttons shown, focus not in a text field). Enter submits a numeric answer,
  // and after an auto result it is Next. Space reveals a free item (focus not in a text field).
  // Keys on a focused button or link are left to the browser, so a key never acts twice.
  function onKey(e) {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.isComposing) return;
    const v = activeTab === "practice" ? practiceView : activeTab === "cards" ? cardsView : null;
    const cur = v && v.cur;
    if (!cur || !v.sess || v.sess.ended) return;
    const t = e.target;
    const tag = t && t.tagName;
    const inText = tag === "TEXTAREA" || tag === "SELECT" || (t && t.isContentEditable) ||
      (tag === "INPUT" && !["checkbox", "radio", "button", "submit"].includes(t.type));
    const onControl = tag === "BUTTON" || tag === "A";
    if (e.key === "Enter") {
      if (e.repeat) return;
      if (t === cur.input) {
        e.preventDefault();
        if (cur.done) next(v);
        else submitNumeric(v);
      } else if (!inText && !onControl && cur.done && cur.item.type !== "free") {
        e.preventDefault();
        next(v);
      }
    } else if (e.key === " ") {
      if (!inText && !onControl && cur.item.type === "free" && !cur.revealed) {
        e.preventDefault();
        reveal(v);
      }
    } else if (/^[1-4]$/.test(e.key)) {
      if (e.repeat || inText || cur.gradeRow.hidden) return;
      e.preventDefault();
      gradeFree(v, S.GRADES[Number(e.key) - 1]);
    }
  }

  // ---------- tabs ----------

  const $ = sel => document.querySelector(sel);
  const tabButton = id => $(`button.tab[data-tab="${id}"]`);
  const panel = id => document.getElementById(`tab-${id}`);

  function missingFor(names) {
    return names.filter(n => !mods[n]);
  }
  function renderMissing(panelEl, names) {
    panelEl.replaceChildren(h("p", { class: "panel-error", text: `This tab needs ${names.join(", ")}, which did not load.` }));
  }

  // Tab renderers, awaited each time a tab is shown.
  const RENDER = {};

  // Today: the due count and the settings (§J3). The drill banner arrives with M7.
  let today = null;
  RENDER.today = async panelEl => {
    const miss = missingFor(["PrepBank", "PrepSrs"]);
    if (miss.length) return renderMissing(panelEl, miss);
    if (!today) today = buildToday(panelEl);
    const st = await store.get(["prepCards", "prepSettings"]);
    const due = S.dueCount(items(), isObj(st.prepCards) ? st.prepCards : {}, S.localDayStart(Date.now(), 1));
    today.due.dataset.count = String(due);
    today.due.textContent = `Due today: ${due}`;
    fillSettings(S.normalizeSettings(st.prepSettings));
  };

  function buildToday(panelEl) {
    const t = {};
    t.due = h("p", { id: "today-due", class: "today-due" });
    t.newPerDay = h("input", { id: "settings-new-per-day", type: "number", min: 0, max: 200, step: 1, inputmode: "numeric" });
    t.reviewCap = h("input", { id: "settings-review-cap", type: "number", min: 0, max: 1000, step: 1, inputmode: "numeric" });
    t.areaBoxes = B.AREAS.map(a => h("input", { type: "checkbox", class: "settings-area", value: a, id: `settings-area-${a}` }));
    t.status = h("p", { class: "muted small", role: "status" });
    panelEl.replaceChildren(
      h("section", { class: "card" },
        h("h2", { text: "Today" }),
        t.due,
        h("div", { class: "row" },
          h("button", { type: "button", class: "btn btn-primary", text: "Practise", onclick: () => showTab("practice") }),
          h("button", { type: "button", class: "btn", text: "Review cards", onclick: () => showTab("cards") }))),
      h("section", { class: "card settings" },
        h("h2", { text: "Settings" }),
        h("div", { class: "settings-grid" },
          h("label", { for: "settings-new-per-day", text: "New items per day (0 to 200)" }), t.newPerDay,
          h("label", { for: "settings-review-cap", text: "Review cap per session (0 to 1000)" }), t.reviewCap),
        h("fieldset", { class: "area-boxes" },
          h("legend", { text: "Areas" }),
          t.areaBoxes.map(box => h("label", { class: "check" }, box, ` ${AREA_LABEL[box.value]}`))),
        h("div", { class: "row" },
          h("button", { type: "button", id: "settings-save", class: "btn btn-primary", text: "Save settings", onclick: saveSettings }),
          t.status)));
    return t;
  }

  function fillSettings(s) {
    today.newPerDay.value = String(s.newPerDay);
    today.reviewCap.value = String(s.reviewCap);
    for (const box of today.areaBoxes) box.checked = s.areas.includes(box.value);
  }

  // Writes normalised prepSettings (§D5). A value normalisation replaced is reported.
  async function saveSettings() {
    const num = el => (el.value.trim() === "" ? undefined : Number(el.value));
    const raw = { newPerDay: num(today.newPerDay), reviewCap: num(today.reviewCap) };
    const settings = S.normalizeSettings({ ...raw, areas: today.areaBoxes.filter(b => b.checked).map(b => b.value) });
    await queueWrite("settings", () => store.set({ prepSettings: settings }));
    fillSettings(settings);
    const kept = [];
    if (raw.newPerDay !== settings.newPerDay) kept.push(`new items per day stays ${settings.newPerDay}`);
    if (raw.reviewCap !== settings.reviewCap) kept.push(`review cap stays ${settings.reviewCap}`);
    today.status.textContent = kept.length
      ? `Saved, but ${kept.join(" and ")} (whole numbers in range only).`
      : "Saved. New sessions use these settings.";
    amLog("settings", "saved", settings);
  }

  // Practice: auto-starts a session whenever the tab is shown and none is active (§J2); the
  // first show runs the item= or source= session instead when the URL asks for one.
  let pendingPractice = null;
  let practiceMounted = false;
  RENDER.practice = async panelEl => {
    const miss = missingFor(SESSION_MODS);
    if (miss.length) return renderMissing(panelEl, miss);
    if (!practiceMounted) {
      practiceMounted = true;
      practiceView.defaultSpec = practiceSpec;
      panelEl.replaceChildren(practiceView.root);
    }
    if (pendingPractice) {
      const spec = pendingPractice;
      pendingPractice = null;
      await startSession(practiceView, spec);
    } else if (!isActive(practiceView)) {
      await startSession(practiceView, practiceSpec());
    }
  };

  // Cards: a topic select ("" = all topics, then topicSet of the cpp and systems items) and a
  // start button; the tab auto-starts with all topics the first time it is shown (§J2).
  let cardsMounted = false;
  RENDER.cards = async panelEl => {
    const miss = missingFor(SESSION_MODS);
    if (miss.length) return renderMissing(panelEl, miss);
    if (cardsMounted) return;
    cardsMounted = true;
    const topics = B.topicSet(items().filter(it => it && B.CARD_AREAS.includes(it.area)));
    const select = h("select", { id: "cards-topic", "aria-label": "Topic" },
      h("option", { value: "", text: "All topics" }),
      topics.map(t => h("option", { value: t, text: t })));
    cardsView.defaultSpec = () => cardsSpec(select.value);
    panelEl.replaceChildren(
      h("div", { class: "toolbar" },
        h("label", { for: "cards-topic", text: "Topic" }),
        select,
        h("button", { type: "button", id: "cards-start", class: "btn btn-primary", text: "Start", onclick: () => startSession(cardsView, cardsSpec(select.value)) })),
      cardsView.root);
    await startSession(cardsView, cardsSpec(""));
  };

  // ---------- OA tab (spec §5 F3, §F, §I, §J4) ----------

  // Three views in the tab: the setup card (kind, config, Start), the run card (timer, question,
  // input, Quit) and the results card (score, best, trend, missed). A run is generated whole at
  // Start from generate(kind, pageSeed(), config); the clock is Date.now() deltas polled by a
  // setInterval, so Playwright's page.clock drives it (§J4, §K2). Only finished runs are saved:
  // time up, or the last question answered or skipped (§F7). Quit discards the run.
  const O = mods.PrepOA;
  const OA_MODS = ["PrepOA", "PrepAnswer", "PrepReadiness"];
  const OA_TICK_MS = 200; // §J4: at most 250 ms
  const OA_RANGES = ["addA", "addB", "mulA", "mulB"];
  const OA_OPS = [["add", "Addition"], ["sub", "Subtraction"], ["mul", "Multiplication"], ["div", "Division"]];
  const OA_KIND = {
    arith: {
      label: "Arithmetic (Zetamac)",
      blurb: "Zetamac clone: + – × ÷ against the clock. A correct answer moves on by itself; there is no Enter key and no skip.",
      hint: "Type the answer: it moves on as soon as it is right.",
    },
    eighty: {
      label: "80 in 8 (Optiver-style)",
      blurb: "80 mixed questions in 8 minutes: decimals, fractions, percentages, 2 and 3 digit products. Answers are exact.",
      hint: "Enter submits. Enter on an empty box skips. A wrong answer moves on.",
    },
    seq: {
      label: "Number sequences",
      blurb: "15 sequences in 10 minutes: give the next term.",
      hint: "Enter submits. Enter on an empty box skips. A wrong answer moves on.",
    },
    ev: {
      label: "Expected value quickfire",
      blurb: "20 dice, coin and card expectations in 5 minutes. Fractions such as 161/36 are fine; within 0.1% counts as right.",
      hint: "Enter submits (fractions are fine). Enter on an empty box skips. A wrong answer moves on.",
    },
  };

  let oa = null; // the tab's elements, the stored runs and the current run; built on first show

  RENDER.oa = async panelEl => {
    const miss = missingFor(OA_MODS);
    if (miss.length) return renderMissing(panelEl, miss);
    if (!oa) oa = buildOA(panelEl);
    const { oaRuns } = await store.get("oaRuns"); // re-read at every tab show (§I)
    oa.runs = asList(oaRuns);
    renderOASetup();
    if (oa.run) oa.input.focus({ preventScroll: true });
  };

  function buildOA(panelEl) {
    const u = { runs: [], run: null, saving: false };

    // Setup.
    u.kind = h("select", { id: "oa-kind", "aria-label": "Simulator" },
      O.KINDS.map(k => h("option", { value: k, text: OA_KIND[k].label })));
    u.kind.addEventListener("change", renderOASetup);
    u.blurb = h("p", { class: "muted oa-blurb" });
    u.config = buildArithConfig(u);
    u.negMarking = h("input", { type: "checkbox", id: "oa-neg-marking" });
    u.negMarking.addEventListener("change", renderOASetup);
    u.eightyConfig = h("div", { class: "oa-eighty-config" },
      h("label", { class: "check", for: "oa-neg-marking" }, u.negMarking, " Negative marking: −1 for each wrong answer (skips cost nothing)"));
    u.cfgError = h("p", { class: "oa-config-error", role: "alert", hidden: true });
    u.startBtn = h("button", { type: "button", id: "oa-start", class: "btn btn-primary", text: "Start", onclick: () => startOARun() });
    u.history = h("span", { class: "muted small" });
    u.setup = h("section", { class: "card oa-setup" },
      h("h2", { text: "OA simulators" }),
      h("div", { class: "toolbar" }, h("label", { for: "oa-kind", text: "Simulator" }), u.kind),
      u.blurb,
      u.config,
      u.eightyConfig,
      u.cfgError,
      h("div", { class: "row" }, u.startBtn, u.history));

    // Run.
    u.runKind = h("span", { class: "session-title" });
    u.progress = h("span", { class: "muted oa-progress" });
    u.timer = h("div", { id: "oa-timer", class: "oa-timer", role: "timer", "aria-label": "Time left" });
    u.quitBtn = h("button", { type: "button", id: "oa-quit", class: "btn btn-quiet", text: "Quit", title: "Discard this run", onclick: quitOARun });
    u.question = h("div", { id: "oa-question", class: "oa-question", "aria-live": "polite" });
    u.input = h("input", {
      id: "oa-input", type: "text", class: "oa-input", autocomplete: "off", spellcheck: "false",
      "aria-label": "Your answer",
    });
    u.input.addEventListener("input", onOAInput);
    u.input.addEventListener("keydown", onOAKeydown);
    u.input.addEventListener("blur", onOABlur);
    u.feedback = h("div", { id: "oa-feedback", class: "oa-feedback", "data-state": "", role: "status", "aria-live": "polite" });
    u.hint = h("p", { class: "muted small oa-hint" });
    u.runEl = h("section", { class: "card oa-run", hidden: true },
      h("div", { class: "session-bar" }, u.runKind, u.progress, h("span", { class: "spacer" }), u.quitBtn),
      u.timer, u.question, u.input, u.feedback, u.hint);

    // Results.
    u.resTitle = h("h2");
    u.resScore = h("p", { class: "oa-score" });
    u.resStats = h("dl", { class: "summary-grid" });
    u.resNote = h("p", { class: "muted small" });
    u.best = h("span", { id: "oa-best", class: "oa-best", "data-best": "" });
    u.bestNote = h("span", { class: "oa-new-best" });
    u.trend = h("span", { id: "oa-trend", class: "oa-trend", "data-points": "" });
    u.missedHead = h("h3", { class: "oa-missed-head", text: "Missed questions" });
    u.missed = h("ul", { id: "oa-missed", class: "oa-missed-list" });
    u.missedNone = h("p", { class: "muted small" });
    u.results = h("section", { id: "oa-results", class: "card oa-results", hidden: true },
      u.resTitle, u.resScore, u.resStats, u.resNote,
      h("p", { class: "oa-best-line" }, "Personal best: ", u.best, u.bestNote),
      h("div", { class: "oa-trend-line" }, h("span", { class: "muted", text: "Trend (last 10 runs): " }), u.trend),
      u.missedHead, u.missed, u.missedNone,
      h("div", { class: "row" },
        h("button", { type: "button", class: "btn btn-primary", text: "Run again", onclick: () => startOARun() })));

    panelEl.replaceChildren(u.setup, u.runEl, u.results);
    return u;
  }

  // #oa-config: the arith ops and ranges, filled with Zetamac's defaults (§F2, §J4). A blank
  // field reads as NaN, so configError reports it instead of Number("") turning it into 0.
  function buildArithConfig(u) {
    u.opBoxes = OA_OPS.map(([op]) => h("input", { type: "checkbox", class: "oa-op", value: op, id: `oa-op-${op}` }));
    const bound = (key, k) => h("input", {
      type: "number", class: "oa-bound", id: `oa-${key}-${k ? "hi" : "lo"}`, min: 0, max: 10000, step: 1,
      inputmode: "numeric", "aria-label": `${key} ${k ? "upper" : "lower"} bound`,
    });
    u.ranges = Object.fromEntries(OA_RANGES.map(key => [key, [bound(key, 0), bound(key, 1)]]));
    u.duration = h("input", { type: "number", class: "oa-bound", id: "oa-duration", min: 10, max: 600, step: 1, inputmode: "numeric" });
    u.defaultNote = h("span", { class: "muted small" });
    const range = key => h("span", { class: "oa-range" }, "(", u.ranges[key][0], " to ", u.ranges[key][1], ")");
    const el = h("div", { id: "oa-config", class: "oa-config" },
      h("div", { class: "oa-ops" }, u.opBoxes.map((b, k) => h("label", { class: "check", for: b.id }, b, ` ${OA_OPS[k][1]}`))),
      h("div", { class: "oa-config-grid" },
        h("span", { text: "Addition" }), h("span", {}, range("addA"), " + ", range("addB")),
        h("span", { text: "Multiplication" }), h("span", {}, range("mulA"), " × ", range("mulB")),
        h("label", { for: "oa-duration", text: "Duration (seconds)" }), h("span", {}, u.duration)),
      h("p", { class: "muted small", text: "Subtraction and division are addition and multiplication run backwards, as on Zetamac." }),
      h("div", { class: "row" },
        h("button", { type: "button", class: "btn btn-quiet", text: "Zetamac defaults", onclick: () => { fillArithConfig(u, O.defaultConfig("arith")); renderOASetup(); } }),
        u.defaultNote));
    el.addEventListener("input", renderOASetup);
    el.addEventListener("change", renderOASetup);
    el.addEventListener("keydown", e => {
      if (e.key === "Enter" && e.target.tagName === "INPUT" && !e.repeat) {
        e.preventDefault();
        startOARun();
      }
    });
    fillArithConfig(u, O.defaultConfig("arith"));
    return el;
  }

  function fillArithConfig(u, c) {
    for (const box of u.opBoxes) box.checked = c.ops.includes(box.value);
    for (const key of OA_RANGES) u.ranges[key].forEach((inp, k) => { inp.value = String(c[key][k]); });
    u.duration.value = String(c.durationSecs);
  }

  function readArithConfig() {
    const num = inp => (inp.value.trim() === "" ? NaN : inp.value.trim());
    const c = { ops: oa.opBoxes.filter(b => b.checked).map(b => b.value) };
    for (const key of OA_RANGES) c[key] = oa.ranges[key].map(num);
    c.durationSecs = num(oa.duration);
    return c;
  }

  function oaConfigFor(kind) {
    if (kind === "arith") return readArithConfig();
    if (kind === "eighty") return { negativeMarking: oa.negMarking.checked };
    return {};
  }

  // The setup card for the selected kind: its config inputs, the config error (Start is disabled
  // while there is one), and the best of the stored runs with the same kind and config.
  function renderOASetup() {
    const kind = oa.kind.value;
    const config = oaConfigFor(kind);
    const err = O.configError(kind, config);
    oa.blurb.textContent = OA_KIND[kind].blurb;
    oa.config.hidden = kind !== "arith";
    oa.eightyConfig.hidden = kind !== "eighty";
    oa.cfgError.hidden = !err;
    oa.cfgError.textContent = err || "";
    oa.startBtn.disabled = !!err || !!oa.run || oa.saving;
    if (kind === "arith") {
      oa.defaultNote.textContent = err ? ""
        : O.isDefaultConfig("arith", config)
          ? "Zetamac's default game: the score goes into the practice log as a zetamac entry."
          : "Custom game: only the default game is logged to the practice log.";
    }
    if (err) {
      oa.history.textContent = "";
      return;
    }
    const best = O.personalBest(oa.runs, kind, config);
    const n = oa.runs.filter(r => isObj(r) && r.kind === kind && Number.isFinite(r.score) && O.sameConfig(kind, r.config, config)).length;
    oa.history.textContent = n
      ? `Best ${best} over ${n} saved run${n === 1 ? "" : "s"} with these settings.`
      : "No saved runs with these settings yet.";
  }

  function setOATimer(secsLeft) {
    oa.timer.dataset.secsLeft = String(secsLeft);
    oa.timer.textContent = O.formatClock(secsLeft);
    oa.timer.classList.toggle("is-low", secsLeft <= 10);
  }

  const oaElapsed = run => (Date.now() - run.startTs) / 1000;
  const oaTimeUp = run => oaElapsed(run) >= run.gen.timeLimitSecs;

  function startOARun() {
    if (!oa || oa.run || oa.saving) return;
    const kind = oa.kind.value;
    const config = oaConfigFor(kind);
    const err = O.configError(kind, config);
    if (err) return renderOASetup();
    const seed = pageSeed(); // §J1: the URL seed for every run on the page, else the clock
    let gen;
    try {
      gen = O.generate(kind, seed, config);
    } catch (e) {
      // Only a generator that gave up (seq after 100 rejections) gets here: report, do not start.
      const msg = String((e && e.message) || e);
      oa.cfgError.textContent = `Could not generate this run: ${msg}`;
      oa.cfgError.hidden = false;
      amLog("oa", "generate-failed", { kind, seed, error: msg.slice(0, 200) });
      return;
    }
    const run = { gen, kind, seed: gen.seed, config: gen.config, startTs: Date.now(), pos: 0, answers: [], timer: null, finished: false };
    oa.run = run;
    oa.setup.hidden = true;
    oa.results.hidden = true;
    oa.runKind.textContent = `${OA_KIND[kind].label} · seed ${run.seed}`;
    oa.hint.textContent = OA_KIND[kind].hint;
    oa.runEl.hidden = false;
    setOATimer(gen.timeLimitSecs);
    showOAQuestion(run);
    run.timer = setInterval(() => oaTick(run), OA_TICK_MS);
    oa.input.focus({ preventScroll: true });
    amLog("oa", "start", { kind, seed: run.seed, config: run.config, questions: gen.questions.length, secs: gen.timeLimitSecs });
  }

  function oaTick(run) {
    if (oa.run !== run || run.finished) return;
    setOATimer(Math.max(0, Math.ceil(run.gen.timeLimitSecs - oaElapsed(run))));
    if (oaTimeUp(run)) finishOARun(run);
  }

  function showOAQuestion(run) {
    const q = run.gen.questions[run.pos];
    oa.question.textContent = q.prompt;
    oa.question.dataset.index = String(q.i);
    oa.input.value = "";
    setState(oa.feedback, "", "");
    oa.progress.textContent = run.kind === "arith"
      ? `Score ${run.answers.length}`
      : `Question ${run.pos + 1} of ${run.gen.questions.length}`;
  }

  // Records the question on screen and moves on; after the last question the run is finished.
  function recordOA(run, correct, given) {
    const q = run.gen.questions[run.pos];
    run.answers.push({ i: q.i, correct, given });
    if (run.pos + 1 >= run.gen.questions.length) return finishOARun(run);
    run.pos += 1;
    showOAQuestion(run);
  }

  // arith: every input event (typing or pasting) checks the box and moves on when it is right.
  function onOAInput() {
    const run = oa.run;
    if (!run || run.finished) return;
    if (run.kind !== "arith") {
      if (oa.feedback.dataset.state === "error") setState(oa.feedback, "", "");
      return;
    }
    // An answer that lands after time is up (before the next tick noticed) is not counted.
    if (oaTimeUp(run)) return finishOARun(run);
    if (A.checkNumeric(oa.input.value, run.gen.questions[run.pos]).correct === true) {
      recordOA(run, true, oa.input.value.trim());
    }
  }

  // eighty, seq, ev: Enter submits; an empty Enter skips; a parse error stays on the question.
  // arith has no submit key, so Enter does nothing there.
  function onOAKeydown(e) {
    const run = oa.run;
    if (!run || run.finished || e.key !== "Enter" || e.isComposing) return;
    e.preventDefault();
    if (e.repeat || run.kind === "arith") return; // a held Enter must not skip a run of questions
    if (oaTimeUp(run)) return finishOARun(run);
    const raw = oa.input.value;
    if (!raw.trim()) return recordOA(run, null, "");
    const r = A.checkNumeric(raw, run.gen.questions[run.pos]);
    if (r.expected === null) {
      setState(oa.feedback, "error", "This question's answer does not parse, so it cannot be marked. Press Enter on an empty box to skip it.");
      return;
    }
    if (r.correct === null) {
      setState(oa.feedback, "error", `${String(r.error).replace(/\.$/, "")}. Fix it and press Enter again, or clear the box and press Enter to skip.`);
      return;
    }
    recordOA(run, r.correct, raw.trim());
  }

  // The input keeps focus during a run (§J4): a blur refocuses it once the focus change is done,
  // unless the run ended or another tab is now shown.
  function onOABlur() {
    const run = oa.run;
    if (!run || run.finished) return;
    setTimeout(() => {
      if (oa.run === run && !run.finished && activeTab === "oa" && document.activeElement !== oa.input) {
        oa.input.focus({ preventScroll: true });
      }
    }, 0);
  }

  function quitOARun() {
    const run = oa.run;
    if (!run || run.finished) return;
    run.finished = true;
    clearInterval(run.timer);
    oa.run = null;
    oa.runEl.hidden = true;
    oa.setup.hidden = false;
    renderOASetup();
    amLog("oa", "quit", { kind: run.kind, seed: run.seed, answered: run.answers.length, secs: Math.floor(oaElapsed(run)) });
  }

  // Time up or the last question done: stop the clock, save the run (§F7, §J4), then show the
  // results once the best and trend can be read back from storage.
  async function finishOARun(run) {
    if (oa.run !== run || run.finished) return;
    run.finished = true;
    clearInterval(run.timer);
    const ts = Date.now();
    const limit = run.gen.timeLimitSecs;
    const elapsed = (ts - run.startTs) / 1000;
    const timeUp = elapsed >= limit;
    setOATimer(Math.max(0, Math.ceil(limit - elapsed)));
    const sc = O.scoreRun(run.kind, run.answers, run.config);
    const entry = {
      ts, kind: run.kind, seed: run.seed, score: sc.score, total: sc.total,
      secs: Math.min(limit, Math.floor(elapsed)), config: run.config,
    };
    oa.run = null;
    oa.saving = true;
    oa.runEl.hidden = true;
    amLog("oa", "finish", { kind: run.kind, seed: run.seed, score: sc.score, total: sc.total, secs: entry.secs, timeUp });
    let saved = null;
    try {
      saved = await saveOARun(entry);
    } finally {
      oa.saving = false;
    }
    if (saved) oa.runs = saved.after;
    renderOAResults(run, sc, entry, saved, timeUp);
    oa.setup.hidden = false;
    renderOASetup();
    oa.results.hidden = false;
  }

  // Appends the oaRuns entry and, for a default arith game, the in-app zetamac practice entry
  // (§F7, §H10), each re-read right before it is written (§I). Resolves { before, after } (the
  // stored runs around the append), or null when the oaRuns write failed.
  async function saveOARun(entry) {
    let saved = null;
    await queueWrite("oa-run", async () => {
      const { oaRuns } = await store.get("oaRuns");
      const before = asList(oaRuns);
      await store.set({ oaRuns: [...before, entry] });
      const after = await store.get("oaRuns");
      saved = { before, after: asList(after.oaRuns) };
      const z = O.zetamacEntry(entry);
      if (z) {
        const { practiceLog } = await store.get("practiceLog");
        await store.set({ practiceLog: R.appendCapped(asList(practiceLog), [z], R.PRACTICE_LOG_CAP) });
      }
      amLog("oa", "saved", { kind: entry.kind, score: entry.score, total: entry.total, zetamac: !!z });
    });
    return saved;
  }

  function renderOAResults(run, sc, entry, saved, timeUp) {
    const { kind, config, gen } = run;
    const el = oa.results;
    el.dataset.score = String(sc.score);
    el.dataset.total = String(sc.total);
    oa.resTitle.textContent = `Results · ${OA_KIND[kind].label}`;
    const stat = (label, value) => h("div", { class: "stat" }, h("dt", { text: label }), h("dd", { text: value }));
    const time = `${fmtDuration(entry.secs)} of ${fmtDuration(gen.timeLimitSecs)}`;
    const negative = kind === "eighty" && config.negativeMarking;
    if (kind === "arith") {
      oa.resScore.textContent = `${sc.score} correct`;
      fill(oa.resStats, stat("Score", String(sc.score)), stat("Time", time), stat("Seed", String(run.seed)));
    } else {
      oa.resScore.textContent = `${sc.score} / ${sc.total}`;
      fill(oa.resStats,
        stat("Correct", String(sc.correct)),
        stat("Wrong", String(sc.wrong)),
        stat("Skipped or not reached", String(sc.skipped)),
        stat("Time", time));
    }
    const notes = [timeUp ? "Time up." : "All questions done."];
    if (negative) notes.push("Negative marking: score = correct − wrong.");
    if (kind === "arith") {
      notes.push(O.zetamacEntry(entry) ? "Logged to the practice log as an in-app zetamac score."
        : "Custom settings: not logged to the practice log.");
    }
    if (!saved) notes.push("This run could not be saved, so it is not in your best or trend.");
    oa.resNote.textContent = notes.join(" ");

    const best = saved ? O.personalBest(saved.after, kind, config) : null;
    const prevBest = saved ? O.personalBest(saved.before, kind, config) : null;
    oa.best.dataset.best = best === null ? "" : String(best);
    oa.best.textContent = best === null ? "–" : String(best);
    oa.bestNote.textContent = saved && (prevBest === null || sc.score > prevBest) ? " · new personal best" : "";
    const points = saved ? O.trend(saved.after, kind, config) : [];
    oa.trend.dataset.points = points.join(",");
    fill(oa.trend, sparkline(points), h("span", { class: "oa-trend-text", text: points.length ? points.join(", ") : "–" }));

    const missed = run.answers.filter(a => a.correct !== true);
    fill(oa.missed, missed.map(a => {
      const q = gen.questions[a.i];
      return h("li", { class: "oa-missed", "data-index": q.i },
        h("span", { class: "oa-missed-q", text: q.prompt }),
        h("span", { class: "oa-missed-a", text: ` → ${q.answer.value}` }),
        h("span", { class: "muted", text: a.correct === false ? ` (you: ${a.given})` : " (skipped)" }));
    }));
    oa.missedHead.hidden = kind === "arith";
    const unreached = kind === "arith" ? 0 : sc.total - run.answers.length;
    oa.missedNone.textContent = kind === "arith" ? ""
      : `${missed.length ? "" : "Nothing answered wrong or skipped. "}${unreached ? `${unreached} question${unreached === 1 ? "" : "s"} not reached.` : ""}`.trim();
    oa.missedNone.hidden = !oa.missedNone.textContent;
  }

  // The trend as a small SVG line, oldest to newest (spec §5 "trend sparkline"). `range` = [lo, hi]
  // fixes the vertical scale (the Dashboard's 0-100 scores); without it the points set it.
  function sparkline(points, range) {
    const NS = "http://www.w3.org/2000/svg";
    const W = 160;
    const H = 32;
    const P = 3;
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", "oa-spark");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("width", String(W));
    svg.setAttribute("height", String(H));
    svg.setAttribute("aria-hidden", "true");
    if (!points.length) return svg;
    const lo = range ? range[0] : Math.min(...points);
    const hi = range ? range[1] : Math.max(...points);
    const x = k => (points.length === 1 ? W / 2 : P + (k * (W - 2 * P)) / (points.length - 1));
    const y = v => (hi === lo ? H / 2 : H - P - ((v - lo) * (H - 2 * P)) / (hi - lo));
    const line = document.createElementNS(NS, "polyline");
    line.setAttribute("points", points.map((v, k) => `${x(k).toFixed(1)},${y(v).toFixed(1)}`).join(" "));
    const dot = document.createElementNS(NS, "circle");
    dot.setAttribute("cx", x(points.length - 1).toFixed(1));
    dot.setAttribute("cy", y(points[points.length - 1]).toFixed(1));
    dot.setAttribute("r", "2.5");
    svg.append(line, dot);
    return svg;
  }

  // ---------- Market tab (spec §6 F4, §G, §I, §J5) ----------

  // Three cards in the tab: setup (scenario, Start, the saved-games line), settlement (shown once
  // the last round is played) and the game (round, revealed units, position and cash, the quote
  // form, #mm-error, the fill messages and the round table). A game is
  // createGame(kind, pageSeed()) with mixed bots and the default limits (§J1, §J5); every accepted
  // quote is one submitQuote round, and the page keeps only the returned state. The game lives in
  // memory: only a settled game is saved (runEntry appended to mmRuns, §I), so a reload or a new
  // Start discards an unfinished one.
  const M = mods.PrepMarket;
  const MM_MODS = ["PrepMarket"];
  const MM_KIND = {
    dice: {
      label: "Dice",
      blurb: "V is the sum of 3 to 10 dice. One die is revealed after each round.",
      describe: s => `${s.n} dice: V is the sum of their faces (${s.n} to ${6 * s.n}). One die is revealed after each round.`,
    },
    cards: {
      label: "Cards",
      blurb: "V is the sum of 3 to 8 cards dealt from one 52-card deck (A = 1, J = 11, Q = 12, K = 13). One card is revealed after each round.",
      describe: s => `${s.n} cards dealt from one 52-card deck: V is the sum of their ranks (A = 1, J = 11, Q = 12, K = 13). One card is revealed after each round.`,
    },
    coins: {
      label: "Coins",
      blurb: "V is the number of heads in a run of fair coin flips. A batch of 2 to 5 flips is revealed after each round.",
      describe: s => `${s.n} fair coin flips: V is the number of heads (0 to ${s.n}). ${s.batch} flips are revealed after each round.`,
    },
  };
  const MM_SETTLE_KEYS = ["v", "pnl", "edge", "adverse", "trades", "maxPos"]; // dataset names (§J5)
  const CARD_RANK = { 1: "A", 11: "J", 12: "Q", 13: "K" };

  let mm = null; // the tab's elements, the stored runs and the current game; built on first show

  RENDER.market = async panelEl => {
    const miss = missingFor(MM_MODS);
    if (miss.length) return renderMissing(panelEl, miss);
    if (!mm) mm = buildMarket(panelEl);
    const { mmRuns } = await store.get("mmRuns"); // re-read at every tab show (§I)
    mm.runs = asList(mmRuns);
    renderMMSetup();
  };

  // Numbers for display, with a real minus sign: `dp` decimals at most, or else 12 significant
  // digits, which hides float tails such as 20.999999999999996 in sums of decimal prices.
  function mmNum(x, dp) {
    const s = String(Number(dp === undefined ? x.toPrecision(12) : x.toFixed(dp)));
    return s.startsWith("-") ? `−${s.slice(1)}` : s;
  }
  const mmSigned = (x, dp) => (x > 0 ? `+${mmNum(x, dp)}` : mmNum(x, dp));

  // A die face, a card rank (A, 2 … 10, J, Q, K) or a coin flip (H / T).
  function mmUnit(kind, v) {
    if (kind === "coins") return v === 1 ? "H" : "T";
    if (kind === "cards") return CARD_RANK[v] || String(v);
    return String(v);
  }
  const mmChip = (kind, v) => h("span", { class: `mm-unit mm-unit-${kind}`, title: kind === "dice" ? null : String(v), text: mmUnit(kind, v) });

  // The units round i revealed: one die or card, or the i-th batch of flips (the last may be short).
  function mmRoundUnits(state, i) {
    const size = state.kind === "coins" ? state.batch : 1;
    return state.revealed.slice(i * size, (i + 1) * size);
  }

  function buildMarket(panelEl) {
    const u = { runs: [], game: null };

    // Setup.
    u.kind = h("select", { id: "mm-scenario", "aria-label": "Scenario" },
      M.SCENARIOS.map(k => h("option", { value: k, text: MM_KIND[k].label })));
    u.kind.addEventListener("change", renderMMSetup);
    u.blurb = h("p", { class: "muted mm-blurb" });
    u.rules = h("p", { class: "muted small mm-rules" });
    u.startBtn = h("button", { type: "button", id: "mm-start", class: "btn btn-primary", text: "Start game", onclick: () => startMMGame() });
    u.history = h("span", { class: "muted small" });
    u.setup = h("section", { class: "card mm-setup" },
      h("h2", { text: "Market making" }),
      h("div", { class: "toolbar" }, h("label", { for: "mm-scenario", text: "Scenario" }), u.kind),
      u.blurb,
      u.rules,
      h("div", { class: "row" }, u.startBtn, u.history));

    // Settlement.
    u.settleV = h("p", { class: "mm-v" });
    u.settleStats = h("dl", { class: "summary-grid" });
    u.settlePnl = h("p", { class: "mm-pnl-line" });
    u.goodQuoter = h("p", { id: "mm-good-quoter", class: "mm-good-quoter" });
    u.saveNote = h("p", { class: "muted small", role: "status" });
    u.againBtn = h("button", { type: "button", class: "btn btn-primary", text: "Play again", onclick: playMMAgain });
    u.settlement = h("section", { id: "mm-settlement", class: "card mm-settlement", hidden: true },
      h("h2", { text: "Settlement" }),
      u.settleV, u.settleStats, u.settlePnl, u.goodQuoter,
      h("ul", { class: "muted small mm-explain" },
        h("li", { text: "Edge: for each trade, your price against E[V] at that moment, signed so that positive is good for you (you sold above it or bought below it)." }),
        h("li", { text: "Adverse: what the informed bot's trades cost you against the true V. Positive is a loss." }),
        h("li", { text: "Fair error: how far each round's fair value was from E[V | revealed]." })),
      u.saveNote,
      h("div", { class: "row" }, u.againBtn));

    // Game.
    u.title = h("span", { class: "session-title" });
    u.round = h("span", { id: "mm-round", class: "mm-round" });
    u.desc = h("p", { class: "mm-desc" });
    u.revealed = h("div", { id: "mm-revealed", class: "mm-revealed", "aria-live": "polite" });
    u.book = h("p", { class: "mm-book" });
    // input#mm-<key> as u[key], inside its label.
    const field = (key, label) => {
      const inp = h("input", {
        id: `mm-${key}`, type: "text", class: "mm-input", inputmode: "decimal", autocomplete: "off", spellcheck: "false",
      });
      inp.addEventListener("keydown", onMMKeydown);
      inp.addEventListener("input", renderMMWidth);
      u[key] = inp;
      return h("label", { class: "mm-field", for: inp.id }, h("span", { class: "mm-field-label", text: label }), inp);
    };
    u.submitBtn = h("button", { type: "button", id: "mm-submit", class: "btn btn-primary", text: "Quote", onclick: submitMMQuote });
    u.width = h("p", { class: "muted small mm-width" });
    u.error = h("p", { id: "mm-error", class: "mm-error", role: "alert", hidden: true });
    u.notice = h("p", { class: "mm-notice", role: "status", hidden: true });
    u.form = h("div", { class: "mm-form" },
      h("div", { class: "mm-quote" }, field("fair", "Fair value"), field("bid", "Bid"), field("ask", "Ask"), u.submitBtn),
      u.width);
    u.fills = h("ul", { id: "mm-fills", class: "mm-fills" });
    u.fillsNone = h("p", { class: "muted small", text: "No trades yet. The bots trade as soon as you quote." });
    u.rows = h("tbody");
    u.table = h("table", { id: "mm-rounds", class: "mm-table" },
      h("thead", {}, h("tr", {},
        ["Round", "Fair", "Bid / ask", "E[V] then", "Fair error", "Trades", "Revealed", "Position", "Cash"]
          .map(t => h("th", { scope: "col", text: t })))),
      u.rows);
    u.tableNone = h("p", { class: "muted small", text: "Played rounds appear here." });
    u.gameEl = h("section", { class: "card mm-game", hidden: true },
      h("div", { class: "session-bar" }, u.title, h("span", { class: "spacer" }), u.round),
      u.desc, u.revealed, u.book, u.form, u.error, u.notice,
      h("h3", { class: "mm-head", text: "Trades" }), u.fills, u.fillsNone,
      h("h3", { class: "mm-head", text: "Rounds" }), h("div", { class: "mm-table-wrap" }, u.table), u.tableNone);

    panelEl.replaceChildren(u.setup, u.settlement, u.gameEl);
    return u;
  }

  // The setup card for the selected scenario: its blurb and limits, and the stored games of that
  // scenario. Start reads "New game" while a game is unfinished, since it discards that game.
  function renderMMSetup() {
    const kind = mm.kind.value;
    const playing = !!(mm.game && !mm.game.state.done);
    mm.blurb.textContent = MM_KIND[kind].blurb;
    mm.rules.textContent = `Each round you quote a fair value and a market: a bid below the ask, at most ${M.DEFAULT_MAX_WIDTH[kind]} wide. ` +
      "A noise bot (a coin flip) and an informed bot (it knows this round's reveal and trades only when E[V] then lies outside your quote) " +
      `each trade one unit against it. Position limit ±${M.DEFAULT_MAX_POS}: a trade past it is rejected. At the end your position settles at V.`;
    mm.startBtn.textContent = playing ? "New game" : "Start game";
    mm.startBtn.title = playing ? "Discard the game in progress (only finished games are saved) and start another" : "";
    const label = MM_KIND[kind].label;
    const runs = mm.runs.filter(r => isObj(r) && r.scenario === kind && Number.isFinite(r.pnl) && Number.isFinite(r.edge));
    const last = runs[runs.length - 1];
    mm.history.textContent = last
      ? `${runs.length} saved ${label} game${runs.length === 1 ? "" : "s"} · last P&L ${mmNum(last.pnl)}, edge ${mmSigned(last.edge, 2)}`
      : `No saved ${label} games yet.`;
  }

  function startMMGame() {
    if (!mm) return;
    const prev = mm.game;
    if (prev && !prev.state.done) amLog("mm", "abandon", { kind: prev.state.kind, seed: prev.state.seed, round: prev.state.round });
    const kind = mm.kind.value;
    const state = M.createGame(kind, pageSeed()); // §J1: the URL seed for every game, else the clock
    mm.game = { state };
    mm.title.textContent = `${MM_KIND[kind].label} · seed ${state.seed}`;
    mm.desc.textContent = MM_KIND[kind].describe(state);
    for (const inp of [mm.fair, mm.bid, mm.ask]) inp.value = "";
    hideMMError();
    mm.notice.hidden = true;
    mm.settlement.hidden = true;
    for (const k of MM_SETTLE_KEYS) delete mm.settlement.dataset[k];
    mm.goodQuoter.textContent = "";
    mm.form.hidden = false;
    mm.gameEl.hidden = false;
    renderMMGame(mm.game);
    renderMMSetup();
    mm.fair.focus({ preventScroll: true });
    amLog("mm", "start", { kind, seed: state.seed, n: state.n, rounds: state.rounds });
  }

  function playMMAgain() {
    if (mm.game) mm.kind.value = mm.game.state.kind;
    startMMGame();
  }

  // Enter in any of the three inputs submits; a held Enter submits once.
  function onMMKeydown(e) {
    if (e.key !== "Enter" || e.isComposing) return;
    e.preventDefault();
    if (!e.repeat) submitMMQuote();
  }

  function showMMError(text) {
    mm.error.textContent = text;
    mm.error.hidden = false;
  }
  function hideMMError() {
    mm.error.textContent = "";
    mm.error.hidden = true;
  }

  // The quote as typed goes to submitQuote, which validates it (§G3). A rejected quote shows its
  // error and changes nothing; an accepted one plays the round and, after the last, settles.
  function submitMMQuote() {
    const g = mm && mm.game;
    if (!g) return;
    const r = M.submitQuote(g.state, { fair: mm.fair.value, bid: mm.bid.value, ask: mm.ask.value });
    if (!r.ok) {
      showMMError(r.error);
      amLog("mm", "quote-rejected", { round: g.state.round, error: String(r.error).slice(0, 200) });
      return;
    }
    g.state = r.state;
    hideMMError();
    const rejected = r.fills.filter(f => f.rejected).length;
    mm.notice.textContent = rejected
      ? `Position limit ±${g.state.maxPos}: ${rejected === 1 ? "one trade was" : `${rejected} trades were`} rejected this round.`
      : "";
    mm.notice.hidden = !rejected;
    for (const inp of [mm.fair, mm.bid, mm.ask]) inp.value = "";
    amLog("mm", "round", { round: g.state.round - 1, fills: r.fills.length, rejected, position: g.state.position });
    renderMMGame(g);
    if (g.state.done) settleMMGame(g);
    else mm.fair.focus({ preventScroll: true });
  }

  // The live width of the typed bid and ask, against the scenario's maximum.
  function renderMMWidth() {
    const g = mm.game;
    if (!g) return;
    const num = inp => (inp.value.trim() === "" ? NaN : Number(inp.value));
    const bid = num(mm.bid);
    const ask = num(mm.ask);
    const max = g.state.maxWidth;
    mm.width.textContent = Number.isFinite(bid) && Number.isFinite(ask) && bid < ask
      ? `Width ${mmNum(ask - bid)} of at most ${mmNum(max)} · mid ${mmNum((bid + ask) / 2)}`
      : `Width at most ${mmNum(max)}.`;
  }

  function renderMMGame(g) {
    const s = g.state;
    mm.round.dataset.round = String(s.round);
    mm.round.dataset.rounds = String(s.rounds);
    mm.round.textContent = s.done ? `All ${s.rounds} rounds played` : `Round ${s.round + 1} of ${s.rounds}`;

    const m = s.revealed.length;
    const total = s.revealed.reduce((a, b) => a + b, 0);
    mm.revealed.dataset.revealed = s.revealed.join(",");
    const sumText = s.kind === "coins" ? `${total} head${total === 1 ? "" : "s"} in ${m}` : `sum ${total}`;
    fill(mm.revealed,
      h("span", { class: "mm-revealed-label", text: "Revealed" }),
      m ? s.revealed.map(v => mmChip(s.kind, v)) : h("span", { class: "muted", text: "nothing yet" }),
      h("span", { class: "muted small", text: m ? ` ${sumText} · ${s.n - m} still hidden` : ` · ${s.n} hidden` }));

    mm.book.textContent = `Position ${mmSigned(s.position)} · Cash ${mmNum(s.cash)} · Largest |position| ${s.maxAbsPos} (limit ${s.maxPos})`;
    mm.form.hidden = s.done;
    renderMMWidth();

    // Fill messages, in fill order, with the informed bot's passes between them.
    const informed = s.bots === "informed" || s.bots === "mixed";
    const lines = [];
    for (const rec of s.history) {
      for (const f of rec.fills) lines.push(mmFillLine(f, s));
      if (informed && !rec.fills.some(f => f.bot === "informed")) {
        lines.push(h("li", { class: "mm-pass" },
          h("span", { class: "mm-fill-round", text: `R${rec.round + 1}` }),
          h("span", { text: "Informed bot passed: its estimate was inside your quote." })));
      }
    }
    fill(mm.fills, lines);
    mm.fillsNone.hidden = s.history.length > 0;

    // One row per played round, with the position and cash after it.
    let pos = 0;
    let cash = 0;
    fill(mm.rows, s.history.map(rec => {
      for (const f of rec.fills) {
        if (f.rejected) continue;
        pos += f.userSide === "buy" ? 1 : -1;
        cash += f.userSide === "sell" ? f.price : -f.price;
      }
      const trades = rec.fills.map(f => (f.rejected ? `rejected: ${f.userSide} ${mmNum(f.price)}`
        : `${f.userSide === "buy" ? "bought" : "sold"} ${mmNum(f.price)}`));
      return h("tr", { class: "mm-round-row", "data-round": rec.round },
        h("td", { text: String(rec.round + 1) }),
        h("td", { text: mmNum(rec.fair) }),
        h("td", { text: `${mmNum(rec.bid)} / ${mmNum(rec.ask)}` }),
        h("td", { text: mmNum(rec.publicEV, 2) }),
        h("td", { text: mmNum(Math.abs(rec.fair - rec.publicEV), 2) }),
        h("td", { text: trades.length ? trades.join(", ") : "none" }),
        h("td", {}, h("span", { class: "mm-row-units" }, mmRoundUnits(s, rec.round).map(v => mmChip(s.kind, v)))),
        h("td", { text: mmSigned(pos) }),
        h("td", { text: mmNum(cash) }));
    }));
    mm.table.hidden = s.history.length === 0;
    mm.tableNone.hidden = s.history.length > 0;
  }

  function mmFillLine(f, s) {
    const who = f.bot === "noise" ? "Noise bot" : "Informed bot";
    const botDid = f.userSide === "sell" ? "bought" : "sold";
    const price = mmNum(f.price);
    const text = f.rejected
      ? `${who} wanted to ${f.userSide === "sell" ? "buy" : "sell"} at ${price}: rejected, it would take you past ±${s.maxPos}.`
      : `${who} ${botDid} at ${price}: you ${f.userSide === "sell" ? "sold" : "bought"} one, position ${mmSigned(f.positionAfter)}.`;
    return h("li", {
      class: `mm-fill mm-fill-${f.userSide}${f.rejected ? " is-rejected" : ""}`,
      "data-bot": f.bot, "data-user-side": f.userSide, "data-price": String(f.price), "data-rejected": String(f.rejected),
    }, h("span", { class: "mm-fill-round", text: `R${f.round + 1}` }), h("span", { text }));
  }

  // After the last round: the settlement card (§G5 metrics, §J5 attributes, the good-quoter line),
  // then runEntry(state, now) appended to a fresh read of mmRuns on the page's write chain (§I).
  function settleMMGame(g) {
    const s = g.state;
    const m = M.settle(s);
    const el = mm.settlement;
    el.dataset.v = String(m.V);
    el.dataset.pnl = String(m.pnl);
    el.dataset.edge = String(m.edge);
    el.dataset.adverse = String(m.adverse);
    el.dataset.trades = String(m.trades);
    el.dataset.maxPos = String(m.maxPos);
    mm.settleV.textContent = s.kind === "coins"
      ? `V = ${m.V}: ${m.V} head${m.V === 1 ? "" : "s"} in ${s.n} flips.`
      : `V = ${m.V}: ${s.outcomes.map(v => mmUnit(s.kind, v)).join(" + ")}${s.kind === "cards" ? ` (${s.outcomes.join(" + ")})` : ""}.`;
    const stat = (label, value) => h("div", { class: "stat" }, h("dt", { text: label }), h("dd", { text: value }));
    fill(mm.settleStats,
      stat("P&L", mmSigned(m.pnl)),
      stat("Edge", mmSigned(m.edge, 2)),
      stat("Adverse", mmNum(m.adverse, 2)),
      stat("Trades", String(m.trades)),
      stat("Largest |position|", String(m.maxPos)),
      stat("Mean fair error", m.meanFairError.toFixed(2)));
    mm.settlePnl.textContent = `P&L = cash ${mmNum(m.cash)} + position ${mmSigned(m.position)} × V ${m.V} = ${mmNum(m.pnl)}.`;
    mm.goodQuoter.textContent = M.goodQuoterLine(s);
    mm.saveNote.textContent = "Saving…";
    el.hidden = false;
    renderMMSetup();
    mm.againBtn.focus({ preventScroll: true });
    amLog("mm", "settle", { kind: s.kind, seed: s.seed, pnl: m.pnl, edge: m.edge, trades: m.trades, maxPos: m.maxPos });

    const entry = M.runEntry(s, Date.now());
    let saved = false;
    queueWrite("mm-run", async () => {
      const { mmRuns } = await store.get("mmRuns");
      const after = [...asList(mmRuns), entry];
      await store.set({ mmRuns: after });
      mm.runs = after;
      saved = true;
      amLog("mm", "saved", { kind: entry.scenario, pnl: entry.pnl, edge: entry.edge });
    }).then(() => {
      if (mm.game === g) mm.saveNote.textContent = saved ? "Saved to your market history." : "This game could not be saved.";
      renderMMSetup();
    });
  }

  // ---------- links that stay on prep.html (§J1) ----------

  // `prep.html?k=v&...` with each value encodeURIComponent'd, plus fixture=1 when this page has it,
  // so a Library or Dashboard link opens the same bank.
  function prepHref(pairs) {
    const q = pairs.map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`);
    if (fixture) q.push("fixture=1");
    return `prep.html?${q.join("&")}`;
  }

  // One line of plain text, at most n characters.
  function excerpt(s, n) {
    const t = String(s == null ? "" : s).replace(/\s+/g, " ").trim();
    return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
  }

  // A thin horizontal bar for a share in [0, 1]; the number it shows is always printed next to it.
  function meter(frac, title) {
    const bar = h("span", { class: "meter-fill" });
    bar.style.width = `${Math.round(Math.min(1, Math.max(0, frac)) * 1000) / 10}%`;
    return h("span", { class: "meter", title, "aria-hidden": "true" }, bar);
  }

  const shortDay = ts => new Date(ts).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

  // ---------- Dashboard tab (spec §8 F6, §H2-§H5, §J6) ----------

  // Rebuilt from a fresh read of storage every time the tab is shown (§I), and again after a
  // change to one of those keys while the tab is shown. A render overtaken by a later one is
  // dropped. Every number comes from PrepReadiness; this code only lays it out.
  const DASH_KEYS = ["prepCards", "prepHistory", "prepMistakes", "lcSolves", "practiceLog", "oaRuns", "mmRuns", "state"];
  const AREA_NAME = {
    coding: "Coding", probability: "Probability", cpp: "C++", systems: "Systems",
    mental: "Mental maths", oa: "OA", market: "Market making", mocks: "Mocks",
  };
  const AREA_HINT = {
    coding: "NeetCode 150 solved, median timed Medium, no-AI share of the last 30 solves",
    probability: "Mastery of the probability and brainteaser items, accuracy of the last 50 auto-checked answers",
    cpp: "Mastery of the C++ cards, accuracy of the last 50 C++ answers",
    systems: "Mastery of the systems cards, accuracy of the last 50 systems answers",
    mental: "Mean of the last 5 Zetamac scores against 60",
    oa: "Best of the last 5 runs of 80 in 8, sequences and EV against their targets",
    market: "Edge per trade over the last 5 market games",
    mocks: "Mean of the last 3 verdicts per mock mode, out of 10",
  };
  const MOCK_LABEL = { dsa: "DSA", quantdev: "Quant dev", cv: "Defend CV", trader: "Trader" };
  const TREND_WEEKS = 8; // weekly points of the overall trend, the last one being now
  const isScore = x => typeof x === "number" && Number.isFinite(x);

  let dashToken = 0;
  RENDER.dashboard = async panelEl => {
    const miss = missingFor(["PrepBank", "PrepSrs", "PrepReadiness"]);
    if (miss.length) return renderMissing(panelEl, miss);
    const token = ++dashToken;
    const st = await store.get(DASH_KEYS);
    if (token !== dashToken) return;
    let view;
    try {
      view = buildDashboard(st, Date.now());
    } catch (e) {
      const error = String((e && e.message) || e).slice(0, 200);
      amLog("dashboard", "render-failed", { error });
      view = h("p", { class: "panel-error", text: `The dashboard could not be computed from the stored data: ${error}` });
    }
    panelEl.replaceChildren(view);
  };

  // The areaScores inputs (§H3) from one storage read: a value of the wrong type reads as missing.
  function dashInputs(st) {
    const list = x => (Array.isArray(x) ? x : null);
    const mem = isObj(st.state) && isObj(st.state.memory) ? st.state.memory : null;
    return {
      bank: items(),
      cards: isObj(st.prepCards) ? st.prepCards : null,
      history: list(st.prepHistory),
      lcSolves: list(st.lcSolves),
      nc150: data && isObj(data.nc150) ? data.nc150 : null,
      practiceLog: list(st.practiceLog),
      oaRuns: list(st.oaRuns),
      mmRuns: list(st.mmRuns),
      facts: mem && isObj(mem.facts) ? mem.facts : null,
    };
  }

  function buildDashboard(st, now) {
    const inputs = dashInputs(st);
    const scores = R.areaScores(inputs);
    // The trend: the same scores at weekly cut-offs (§H3 areaScoresAt, cards replayed from the
    // history), oldest first; the last point is now, with the stored cards, like the Prep line.
    const weekly = [];
    for (let k = TREND_WEEKS - 1; k >= 1; k--) weekly.push(R.areaScoresAt(inputs, now - k * 7 * S.DAY));
    weekly.push(scores);
    const weekAgo = weekly[weekly.length - 2];
    const wrap = h("div", { class: "dash" },
      dashOverview(scores, weekly, now),
      dashAreas(scores, weekAgo),
      dashNc150(inputs),
      dashMistakes(asList(st.prepMistakes)),
      dashMocks(inputs.facts));
    amLog("dashboard", "render", { overall: scores.overall, under60: R.under60(scores).length });
    return wrap;
  }

  // The change of one score over the last 7 days, worded like the Sunday review (§H8).
  function deltaText(cur, prev) {
    if (!isScore(cur)) return "";
    if (!isScore(prev)) return "new this week";
    const d = cur - prev;
    return d === 0 ? "no change in 7 days" : `${d > 0 ? "+" : "−"}${Math.abs(d)} in 7 days`;
  }
  function deltaEl(cur, prev) {
    const text = deltaText(cur, prev);
    const d = isScore(cur) && isScore(prev) ? cur - prev : 0;
    return h("span", { class: `delta${d > 0 ? " is-up" : d < 0 ? " is-down" : ""}`, text, hidden: !text });
  }

  function scoreValue(score) {
    return h("span", { class: `value${isScore(score) ? "" : " is-empty"}`, text: isScore(score) ? String(score) : "no data" });
  }

  // Overall (§H3), its trend, the next checkpoint and the areas under 60 (spec §8, §H4).
  function dashOverview(scores, weekly, now) {
    const overall = scores.overall;
    const series = weekly.map(s => s.overall);
    const firstData = series.findIndex(isScore);
    const points = firstData < 0 ? [] : series.slice(firstData).map(v => (isScore(v) ? v : 0));
    const cp = typeof amNextCheckpoint === "function" && typeof AM_CHECKPOINTS !== "undefined"
      ? amNextCheckpoint(AM_CHECKPOINTS, new Date(now)) : null;
    const low = R.under60(scores);
    return h("section", { class: "card dash-overview" },
      h("div", { class: "dash-headline" },
        h("div", { id: "overall-score", class: "overall-score", "data-score": isScore(overall) ? String(overall) : "" },
          h("span", { class: "overall-label", text: "Overall readiness" }),
          scoreValue(overall),
          deltaEl(overall, weekly[weekly.length - 2].overall)),
        h("div", { class: "dash-trend" },
          h("span", { class: "muted small", text: `Overall, weekly over the last ${TREND_WEEKS} weeks` }),
          points.length > 1
            ? h("span", { class: "oa-trend" }, sparkline(points, [0, 100]), h("span", { class: "small", text: points.join(", ") }))
            : h("span", { class: "muted small", text: points.length ? "One week of data so far." : "No data yet." }))),
      h("p", { class: "dash-note muted small", text: "The mean of the area scores that have data. Each area runs from 0 to 100; an area with no data at all shows no data and is left out." }),
      h("p", { id: "checkpoint", class: "dash-line", text: cp ? `Next checkpoint: ${cp.due} (${cp.daysLeft} days left) — ${cp.label}` : "Next checkpoint: none" }),
      h("p", { id: "under60", class: "dash-line", text: `Under 60: ${low.length ? low.join(", ") : "none"}` }));
  }

  function dashAreas(scores, weekAgo) {
    return h("section", { class: "card" },
      h("h2", { text: "Area scores" }),
      h("div", { class: "area-grid" }, R.AREA_KEYS.map(k => {
        const v = scores[k];
        const low = isScore(v) && v < 60;
        return h("div", { class: `area-score${low ? " is-low" : ""}${isScore(v) ? "" : " is-empty"}`, "data-area": k, "data-score": isScore(v) ? String(v) : "" },
          h("div", { class: "area-head" },
            h("span", { class: "area-name", text: AREA_NAME[k] || k }),
            scoreValue(v),
            low ? h("span", { class: "chip chip-low", text: "under 60" }) : null),
          meter(isScore(v) ? v / 100 : 0, isScore(v) ? `${AREA_NAME[k] || k}: ${v} of 100` : "No data"),
          deltaEl(v, weekAgo[k]),
          h("p", { class: "area-hint muted small", text: AREA_HINT[k] || "" }));
      })));
  }

  // nc150Progress (§H2): one bar per pattern, in list order, and the first unsolved problem.
  function dashNc150(inputs) {
    const list = inputs.nc150;
    const p = R.nc150Progress(list, inputs.lcSolves);
    const next = isObj(p.next) ? p.next : null;
    const link = h("a", {
      id: "nc150-next", href: next && typeof next.url === "string" ? next.url : null,
      target: "_blank", rel: "noopener", text: next ? String(next.problem == null ? next.slug : next.problem) : "",
    });
    const nextLine = h("p", { class: "nc-next", hidden: !next },
      "Next: ", link,
      next && next.difficulty ? h("span", { class: "muted", text: ` · ${next.difficulty}` }) : null,
      next && next.pattern != null ? h("span", { class: "muted", text: ` · ${next.pattern}` }) : null);
    if (!next) link.hidden = true;
    const summary = !list
      ? "No NeetCode 150 list in this bank (lists/neetcode150.json)."
      : p.total && p.solved === p.total
        ? `All ${p.total} solved.`
        : `${p.solved} of ${p.total} solved, matched to your LeetCode solves by slug.`;
    return h("section", { class: "card" },
      h("h2", { text: "NeetCode 150" }),
      h("p", { class: "muted", text: summary }),
      nextLine,
      h("div", { class: "nc-patterns" }, Object.entries(p.byPattern).map(([pattern, g]) =>
        h("div", { class: "nc-pattern", "data-pattern": pattern, "data-solved": String(g.solved), "data-total": String(g.total) },
          h("span", { class: "nc-name", text: pattern }),
          meter(g.total ? g.solved / g.total : 0, `${pattern}: ${g.solved} of ${g.total}`),
          h("span", { class: "nc-count", text: `${g.solved}/${g.total}` })))));
  }

  // What the user answered, as shown in the journal: the chosen choice for an mcq index.
  function mistakeAnswer(item, ans) {
    const choices = item.type === "mcq" && item.answer && Array.isArray(item.answer.choices) ? item.answer.choices : null;
    if (choices && Number.isInteger(ans) && ans >= 0 && ans < choices.length) return excerpt(choices[ans], 60);
    if (typeof ans === "string") return ans.trim() ? excerpt(ans, 60) : "(blank)";
    return ans == null ? "(blank)" : excerpt(String(ans), 60);
  }

  // mistakeTopics (§H5): recurring topics first. Every entry of a topic is a link that reopens its
  // item with the note editor (§J1 item= + mistake=, §J2).
  function dashMistakes(mistakes) {
    const groups = R.mistakeTopics(mistakes, items());
    const known = mistakes.filter(m => isObj(m) && typeof m.itemId === "string" && own(byId, m.itemId));
    const unknown = mistakes.filter(isObj).length - known.length;
    const itemCount = new Set(known.map(m => m.itemId)).size;
    // Each item's prompt is rendered (markdown + KaTeX) once and cloned for its other entries;
    // links inside it become plain text, since the whole entry is a link.
    const prompts = new Map();
    const promptOf = item => {
      if (!prompts.has(item.id)) {
        const el = rich("mistake-prompt", item.prompt);
        for (const a of el.querySelectorAll("a")) a.replaceWith(...a.childNodes);
        prompts.set(item.id, el);
      }
      return prompts.get(item.id).cloneNode(true);
    };
    const intro = known.length
      ? `${known.length} mistake${known.length === 1 ? "" : "s"} on ${itemCount} item${itemCount === 1 ? "" : "s"}, grouped by topic with recurring topics first. A mistake counts under each topic of its item. Click one to open the item and add a note.`
      : "No mistakes yet. Every wrong auto-checked answer and every Again grade lands here.";
    return h("section", { class: "card" },
      h("h2", { text: "Mistakes journal" }),
      h("p", { class: "muted", text: intro }),
      unknown ? h("p", { class: "muted small", text: `${unknown} more ${unknown === 1 ? "is" : "are"} for items no longer in this bank.` }) : null,
      h("div", { class: "mistake-topics" }, groups.map(g =>
        h("section", { class: "mistake-topic", "data-topic": g.topic, "data-count": String(g.count) },
          h("h3", { class: "mistake-topic-head" },
            h("span", { class: "mistake-topic-name", text: g.topic }),
            h("span", { class: "chip", text: `${g.count} mistake${g.count === 1 ? "" : "s"}` }),
            h("span", { class: "muted small", text: `${g.itemIds.length} item${g.itemIds.length === 1 ? "" : "s"} · last ${isScore(g.lastTs) ? shortDay(g.lastTs) : "?"}` })),
          h("ul", { class: "mistake-list" }, g.entries.map(m => {
            const item = byId[m.itemId];
            const note = typeof m.note === "string" ? m.note.trim() : "";
            return h("li", null,
              h("a", {
                class: "mistake-entry", "data-item-id": m.itemId, "data-ts": String(m.ts),
                href: prepHref([["tab", "practice"], ["item", m.itemId], ["mistake", m.ts]]),
                title: `${B.sourceLabel(item)} · open the item and its note`,
              },
                h("span", { class: "mistake-when muted", text: isScore(m.ts) ? shortDay(m.ts) : "?" }),
                promptOf(item),
                h("span", { class: "mistake-answer muted", text: `you: ${mistakeAnswer(item, m.answer)}` }),
                note ? h("span", { class: "mistake-note", text: `Note: ${excerpt(note, 140)}` }) : null));
          }))))));
  }

  // mockVerdicts (§H4): the parsed verdict scores per mode, oldest to newest.
  function dashMocks(facts) {
    const verdicts = R.mockVerdicts(facts);
    const any = R.MOCK_MODES.some(m => verdicts[m].length);
    return h("section", { class: "card" },
      h("h2", { text: "Mock interviews" }),
      h("p", { class: "muted", text: any
        ? "Verdict scores the buddy saved at the end of each mock (N/10 read from the verdict), oldest to newest."
        : "No verdicts yet. Finish a mock interview in the side panel and the buddy saves its verdict." }),
      h("div", { class: "mock-modes" }, R.MOCK_MODES.map(m => {
        const list = verdicts[m];
        const last3 = list.slice(-3).map(v => v.score);
        const mean = last3.length ? last3.reduce((a, b) => a + b, 0) / last3.length : null;
        return h("div", { class: "mock-mode", "data-mode": m, "data-scores": list.map(v => v.score).join(",") },
          h("div", { class: "mock-head" },
            h("span", { class: "mock-name", text: MOCK_LABEL[m] || m }),
            h("span", { class: "muted small", text: mean === null ? "no verdicts" : `last ${last3.length}: ${Math.round(mean * 10) / 10} / 10` })),
          list.length
            ? h("ul", { class: "mock-scores" }, list.map(v => h("li", { class: "chip", title: v.day, text: `${v.score} · ${v.day}` })))
            : null);
      })));
  }

  // While the Dashboard is shown, a change to a key it reads re-renders it (debounced). For
  // `state`, only a change to the saved facts (the mock verdicts) counts.
  let dashTimer = null;
  function factsOf(state) {
    return isObj(state) && isObj(state.memory) ? JSON.stringify(state.memory.facts || null) : "null";
  }
  function onDashStorage(changes, area) {
    if (area !== "local" || activeTab !== "dashboard") return;
    const hit = Object.keys(changes).some(k => DASH_KEYS.includes(k) &&
      (k !== "state" || factsOf(changes.state.oldValue) !== factsOf(changes.state.newValue)));
    if (!hit) return;
    clearTimeout(dashTimer);
    dashTimer = setTimeout(() => {
      if (activeTab === "dashboard") RENDER.dashboard(panel("dashboard"));
    }, 300);
  }

  // ---------- Library tab (spec §8 F6, §E1, §E5, §J7) ----------

  // library/index.json grouped by category folder, in index order. Each entry opens its PDF in
  // Chrome's viewer, shows how many bank items cite it (sourceCounts; a file no item cites shows
  // 0) and starts a Practice session of those items (§J1 source=). Built once: it reads no storage.
  let libMounted = false;
  RENDER.library = async panelEl => {
    const miss = missingFor(["PrepBank"]);
    if (miss.length) return renderMissing(panelEl, miss);
    if (libMounted) return;
    libMounted = true;
    panelEl.replaceChildren(buildLibrary());
  };

  // §J7: the entry's file under the loaded bank root, with no page fragment.
  const libFileHref = file => `${data.root}library/${encodeURI(file)}`;

  function buildLibrary() {
    const lib = data && data.library;
    const cats = isObj(lib) && Array.isArray(lib.categories) ? lib.categories.filter(isObj) : null;
    if (!cats) {
      amLog("library", "missing", { root: data && data.root });
      return h("section", { class: "card" },
        h("h2", { text: "Library" }),
        h("p", { text: "This bank has no library index (library/index.json). Run npm run bank:build to copy the PDFs and index them." }));
    }
    const counts = B.sourceCounts(items());
    const countOf = file => (own(counts, file) && isScore(counts[file]) ? counts[file] : 0);
    const rows = [];
    const sections = cats.map(c => {
      const entries = asList(c.entries).filter(e => isObj(e) && typeof e.file === "string" && e.file);
      const catRows = entries.map(e => {
        const n = countOf(e.file);
        const title = typeof e.title === "string" && e.title.trim() ? e.title.trim() : e.file;
        const li = h("li", { class: "lib-entry", "data-file": e.file },
          h("div", { class: "lib-main" },
            h("a", { class: "lib-open", href: libFileHref(e.file), target: "_blank", rel: "noopener", title: "Open the PDF in Chrome's viewer", text: title }),
            title !== e.file ? h("span", { class: "lib-file muted small", text: e.file }) : null),
          h("span", { class: `lib-items${n ? "" : " muted"}` },
            h("span", { class: "lib-count", text: String(n) }), n === 1 ? " item" : " items"),
          h("button", {
            type: "button", class: `btn lib-practice${n ? "" : " btn-quiet"}`, text: "Practise",
            title: n ? `A session of the ${n} item${n === 1 ? "" : "s"} from this source` : "No bank item cites this file yet",
            onclick: () => {
              amLog("library", "practice", { file: e.file, items: n });
              location.href = prepHref([["tab", "practice"], ["source", e.file]]);
            },
          }));
        const row = { li, n, text: `${title}\n${e.file}`.toLowerCase() };
        rows.push(row);
        return row;
      });
      const label = typeof c.label === "string" && c.label ? c.label : String(c.folder == null ? "" : c.folder);
      const head = h("h3", { class: "lib-category-head" },
        h("span", { text: label }),
        h("span", { class: "muted small", text: `${entries.length} file${entries.length === 1 ? "" : "s"}` }));
      const empty = h("p", { class: "muted small", text: entries.length ? "No file matches the filter." : "No files.", hidden: !!entries.length });
      const sec = h("section", { class: "lib-category", "data-folder": typeof c.folder === "string" ? c.folder : "" },
        head, h("ul", { class: "lib-entries" }, catRows.map(r => r.li)), empty);
      return { sec, catRows, empty };
    });

    const cited = rows.filter(r => r.n > 0).length;
    const filter = h("input", { id: "lib-filter", type: "search", placeholder: "Filter by title or file", "aria-label": "Filter the library" });
    const citedOnly = h("input", { id: "lib-cited", type: "checkbox" });
    const status = h("span", { class: "muted small", role: "status" });
    const apply = () => {
      const q = filter.value.trim().toLowerCase();
      let shown = 0;
      for (const s of sections) {
        let here = 0;
        for (const r of s.catRows) {
          const on = (!q || r.text.includes(q)) && (!citedOnly.checked || r.n > 0);
          r.li.hidden = !on;
          if (on) here += 1;
        }
        shown += here;
        if (s.catRows.length) s.empty.hidden = here > 0;
      }
      status.textContent = shown === rows.length ? "" : `Showing ${shown} of ${rows.length}.`;
    };
    filter.addEventListener("input", apply);
    citedOnly.addEventListener("change", apply);
    amLog("library", "render", { categories: sections.length, files: rows.length, cited });
    return h("div", { class: "library" },
      h("section", { class: "card" },
        h("h2", { text: "Library" }),
        h("p", { class: "muted", text: `${rows.length} file${rows.length === 1 ? "" : "s"} in ${sections.length} categor${sections.length === 1 ? "y" : "ies"}; bank items cite ${cited} of them. A title opens the PDF in Chrome's viewer; Practise runs a session of every item from that source.` }),
        h("div", { class: "toolbar lib-toolbar" },
          filter,
          h("label", { class: "check" }, citedOnly, " Only sources with items"),
          status)),
      sections.map(s => s.sec));
  }

  async function showTab(id) {
    if (!TAB_IDS.includes(id)) id = DEFAULT_TAB;
    activeTab = id;
    for (const t of TAB_IDS) {
      const on = t === id;
      tabButton(t).setAttribute("aria-selected", on ? "true" : "false");
      tabButton(t).tabIndex = on ? 0 : -1;
      panel(t).hidden = !on;
    }
    if (RENDER[id]) await RENDER[id](panel(id), data);
  }

  // item= and source= open the Practice tab whatever tab= says (§J1).
  function initialTab() {
    if (URL_ITEM !== null || URL_SOURCE !== null) return "practice";
    const t = params.get("tab");
    return TAB_IDS.includes(t) ? t : DEFAULT_TAB;
  }

  function wireTabs() {
    for (const t of TAB_IDS) {
      tabButton(t).addEventListener("click", () => {
        if (t !== activeTab) showTab(t);
      });
    }
    // Arrow keys move between tabs (WAI-ARIA tabs pattern).
    $("#tabs").addEventListener("keydown", e => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const i = TAB_IDS.indexOf(activeTab);
      const next = TAB_IDS[(i + (e.key === "ArrowRight" ? 1 : TAB_IDS.length - 1)) % TAB_IDS.length];
      e.preventDefault();
      showTab(next);
      tabButton(next).focus();
    });
    document.addEventListener("keydown", onKey);
  }

  function showBankMissing() {
    $("#tabs").hidden = true;
    for (const t of TAB_IDS) panel(t).hidden = true;
    $("#bank-missing").hidden = false;
  }

  // ---------- bank ----------

  // prepLoadBank (prep-loader.js, §E6) never rejects. If that script failed to load, the page
  // still reaches ready and shows the bank-missing screen; init logs the missing name.
  async function loadBank() {
    return typeof prepLoadBank === "function" ? prepLoadBank({ fixture }) : null;
  }

  // ---------- init ----------

  async function init() {
    amLogInit("prep");
    const missing = Object.keys(mods).filter(k => !mods[k]);
    if (typeof prepLoadBank !== "function") missing.push("prepLoadBank");
    amLog("prep", "modules", { missing });

    data = await loadBank();
    document.body.dataset.bankSource = data ? data.source : "none";
    amLog("bank", data ? "loaded" : "missing", data ? { source: data.source, items: data.items.length } : { fixture });

    if (data) {
      if (B) byId = B.indexById(data.items);
      if (URL_ITEM !== null) pendingPractice = itemSpec(URL_ITEM, URL_MISTAKE_TS);
      else if (URL_SOURCE !== null) pendingPractice = sourceSpec(URL_SOURCE);
      amLog("prep", "params", { item: URL_ITEM, source: URL_SOURCE, mistake: URL_MISTAKE_TS, seed: URL_SEED });
      wireTabs();
      chrome.storage.onChanged.addListener(onDashStorage);
      $("#tabs").hidden = false;
      await showTab(initialTab());
    } else {
      showBankMissing();
    }
    document.body.dataset.ready = "1";
  }

  init();
})();
