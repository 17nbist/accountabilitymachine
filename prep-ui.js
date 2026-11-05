// prep.html controller (V4-CONTRACTS §A5, §E6, §J1, §J2). Not pure: it owns the DOM, reads
// the URL and fetches the bank. The whole file is one IIFE so it adds no globals.
//
// Milestone M0 is the shell: tab chrome, URL parameters fixture= and tab=, the bank-missing
// screen, and the body data-ready / data-bank-source flags. Each tab's content is rendered by
// RENDER[<tab id>], filled in by later milestones. Every prep/*.js module is optional here
// (checked with typeof), so a module that is missing or failed to load cannot stop the page
// reaching ready.
(() => {
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

  const params = new URLSearchParams(location.search);
  const fixture = params.get("fixture") === "1"; // §E6: always the fixture, even if bank/ exists

  let data = null; // the §E6 loader result, or null when no bank loaded
  let activeTab = null;

  // ---------- bank ----------

  async function fetchJson(url) {
    // §E6: a missing extension file rejects, a non-OK response or bad JSON is also "no file".
    try {
      const res = await fetch(url);
      return res.ok ? await res.json() : null;
    } catch (e) {
      return null;
    }
  }

  // M0 stand-in for prepLoadBank (§E6, prep-loader.js). It reads bank.json only and returns the
  // same shape with the other files null. Once prepLoadBank exists it is used instead.
  async function interimLoadBank({ fixture: fx } = {}) {
    const root = fx ? "tests/fixtures/bank-mini/" : "bank/";
    const bankJson = await fetchJson(chrome.runtime.getURL(root + "bank.json"));
    if (!bankJson) return null;
    return {
      source: fx ? "fixture" : "bank",
      root,
      bankJson,
      decks: { cpp: null, systems: null },
      items: Array.isArray(bankJson.items) ? bankJson.items : [],
      nc150: null,
      library: null,
    };
  }

  function loadBank() {
    return typeof prepLoadBank === "function" ? prepLoadBank({ fixture }) : interimLoadBank({ fixture });
  }

  // ---------- tabs ----------

  const $ = sel => document.querySelector(sel);
  const tabButton = id => $(`button.tab[data-tab="${id}"]`);
  const panel = id => document.getElementById(`tab-${id}`);

  // Tab renderers, called each time a tab is shown; may be async. Empty until each tab's
  // milestone (Today/Practice/Cards M3, OA M4, Market M5, Dashboard/Library M6).
  const RENDER = {};

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

  function initialTab() {
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
  }

  function showBankMissing() {
    $("#tabs").hidden = true;
    for (const t of TAB_IDS) panel(t).hidden = true;
    $("#bank-missing").hidden = false;
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
