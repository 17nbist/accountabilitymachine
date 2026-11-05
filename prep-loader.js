// v4 bank loader (V4-CONTRACTS §E6), shared by prep.html and the side panel. Not pure: it reads
// extension files with fetch. It requires nothing (it runs before or without prep/bank.js) and
// declares one global, prepLoadBank. It never rejects: a file that is missing, not OK or not
// JSON is null, and a missing bank.json means "no bank" (null).
//
// fixture: true loads the synthetic test bank under tests/fixtures/bank-mini/ instead of bank/.
async function prepLoadBank(opts = {}) {
  const fixture = !!(opts && opts.fixture);
  const root = fixture ? "tests/fixtures/bank-mini/" : "bank/";

  // A missing extension file makes fetch REJECT (TypeError: Failed to fetch); a non-OK
  // response or a JSON parse error is treated the same way.
  async function load(name) {
    try {
      const res = await fetch(chrome.runtime.getURL(root + name));
      return res.ok ? await res.json() : null;
    } catch (e) {
      return null;
    }
  }

  // bank.json first: without it there is no bank, and the other four requests would only add
  // file-not-found errors to the console (the usual state of a checkout that never built bank/).
  const bankJson = await load("bank.json");
  if (bankJson === null) return null;
  const [cpp, systems, nc150, library] = await Promise.all([
    load("decks/cpp.json"),
    load("decks/systems.json"),
    load("lists/neetcode150.json"),
    load("library/index.json"),
  ]);

  // The same merge as PrepBank.allItems, inline so this file needs no other script. No
  // validation here: the build (or the fixture's tests) already did it.
  const items = [bankJson, cpp, systems].flatMap(f => (f && Array.isArray(f.items) ? f.items : []));
  return {
    source: fixture ? "fixture" : "bank",
    root,
    bankJson,
    decks: { cpp, systems },
    items,
    nc150,
    library,
  };
}
