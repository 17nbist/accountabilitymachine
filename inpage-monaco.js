// Runs in the PAGE's JS world (world: MAIN), so it can touch LeetCode's own `monaco`
// global — which the isolated content script cannot. localStorage doesn't hold the
// editor code (confirmed: 23 keys, none code — it's in IndexedDB), and the Monaco DOM
// only renders visible lines, so reading the model is the only reliable way to capture
// the complete solution. Replies to the isolated world via postMessage.
//
// Model choice: prefer the model of a VISIBLE editor — "largest model" alone could
// grab an editorial snippet or playground buffer instead of the user's solution.
(function () {
  window.addEventListener("message", (e) => {
    if (e.source !== window || !e.data || e.data.type !== "AM_GET_CODE") return;
    let code = null;
    let editors = null;
    try {
      const ed = window.monaco && window.monaco.editor;
      if (ed) {
        if (typeof ed.getEditors === "function") {
          const all = ed.getEditors();
          editors = all.length;
          let best = "";
          for (const inst of all) {
            try {
              const node = inst.getDomNode && inst.getDomNode();
              const visible = node && node.isConnected &&
                node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0;
              if (!visible) continue;
              const v = inst.getModel && inst.getModel() ? inst.getModel().getValue() : "";
              if (v && v.length > best.length) best = v;
            } catch (err) { /* editor may be mid-teardown */ }
          }
          if (best) code = best;
        }
        // Fallback: largest model overall (old behavior) — covers detached editors
        // and Monaco builds without getEditors().
        if (!code && typeof ed.getModels === "function") {
          const models = ed.getModels();
          if (editors === null) editors = models.length;
          let best = "";
          for (const m of models) {
            try {
              const v = m.getValue();
              if (v && v.length > best.length) best = v;
            } catch (err) { /* model may be disposed */ }
          }
          if (best) code = best;
        }
      }
    } catch (err) { /* monaco not present on this page */ }
    window.postMessage({ type: "AM_CODE", id: e.data.id, code, editors }, "*");
  });
})();
