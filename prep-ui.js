// prep.html controller (V4-CONTRACTS §A5, §E6, §I, §J1, §J2, §J3, §J11). Not pure: it owns the
// DOM, reads the URL, fetches the bank and reads and writes chrome.storage.local. The whole file
// is one IIFE so it adds no globals.
//
// M0: the shell (tab chrome, fixture= and tab=, the bank-missing screen, the body data-ready /
// data-bank-source flags). M3: the Today settings, and the item sessions of the Practice and
// Cards tabs (markdown + KaTeX, the numeric / mcq / free flows, auto and self grading, the
// writes per answer, Check my reasoning, keyboard shortcuts, the session summary) with the
// item=, source= and mistake= parameters. Each tab's content is rendered by RENDER[<tab id>];
// OA (M4), Market (M5), Dashboard and Library (M6) fill in theirs later. Every prep/*.js module
// is optional here (checked with typeof): a tab whose modules did not load says so instead of
// rendering, and the page still reaches ready.
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

  // Tab renderers, awaited each time a tab is shown. OA (M4), Market (M5), Dashboard and
  // Library (M6) are still empty.
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
      $("#tabs").hidden = false;
      await showTab(initialTab());
    } else {
      showBankMissing();
    }
    document.body.dataset.ready = "1";
  }

  init();
})();
