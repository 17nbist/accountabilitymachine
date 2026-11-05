// v4 prep/bank.js (PrepBank): the item schema, ids, the bank validator and the small helpers
// the UI and the other prep modules use to read a bank (V4-CONTRACTS §E, spec §3 F1.1, F1.4).
// Plain browser script and Node module (§A5): one `var` global, depends on prep/answer.js
// (numeric answers must parse), no DOM, no clock, no Math.random.
//
// Ids are "<sourceKey>-<locator>-<hash8>", where hash8 is the first 8 hex digits of
// SHA-256(prompt + answerKey) over UTF-8 (§E3). The SHA-256 here is synchronous pure JS, so the
// same code runs in Node, in the build and in the extension (WebCrypto is async).

var PrepBank = (function () {
  const A = typeof PrepAnswer !== "undefined" ? PrepAnswer : require("./answer.js");

  // ---------- schema constants (§A6, §E2) ----------

  const AREAS = Object.freeze(["probability", "brainteaser", "statistics", "finance", "cpp", "systems"]);
  const PRACTICE_AREAS = Object.freeze(["probability", "brainteaser", "statistics", "finance"]);
  const CARD_AREAS = Object.freeze(["cpp", "systems"]);
  const TYPES = Object.freeze(["numeric", "mcq", "free"]);
  const STATUSES = Object.freeze(["agreed", "corrected", "disputed", "unverified"]);
  const ORIGINS = Object.freeze(["source", "generated"]);
  const METHODS = Object.freeze(["blind", "blind+sim"]);

  const KEY_RE = /^[a-z0-9]{2,24}$/;
  const LOCATOR_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  const ID_RE = /^([a-z0-9]{2,24})-([a-z0-9]+(?:-[a-z0-9]+)*)-([0-9a-f]{8})$/;
  const TOPIC_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  // source.file: a POSIX path relative to library/; ".." segments are rejected separately.
  const FILE_RE = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;
  // check.printed / check.resolved are required for these statuses (§E4).
  const NEEDS_PRINTED = ["corrected", "disputed"];

  // ---------- SHA-256 (FIPS 180-4), synchronous (§E3) ----------

  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const H0 = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];

  const rotr = (x, n) => (x >>> n) | (x << (32 - n));

  // 64 lowercase hex characters of SHA-256 over the UTF-8 bytes of str.
  function sha256Hex(str) {
    const bytes = new TextEncoder().encode(str);
    const n = bytes.length;
    // Padding: one 0x80 byte, zeros, then the bit length as a 64-bit big-endian integer, to a
    // multiple of 64 bytes.
    const total = Math.ceil((n + 9) / 64) * 64;
    const msg = new Uint8Array(total);
    msg.set(bytes);
    msg[n] = 0x80;
    const view = new DataView(msg.buffer);
    const bits = n * 8; // exact: strings are far below 2^53 bits
    view.setUint32(total - 8, Math.floor(bits / 0x100000000));
    view.setUint32(total - 4, bits >>> 0);

    const h = H0.slice();
    const w = new Uint32Array(64);
    for (let off = 0; off < total; off += 64) {
      for (let t = 0; t < 16; t++) w[t] = view.getUint32(off + 4 * t);
      for (let t = 16; t < 64; t++) {
        const x = w[t - 15];
        const y = w[t - 2];
        const s0 = rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3);
        const s1 = rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10);
        w[t] = w[t - 16] + s0 + w[t - 7] + s1; // stored mod 2^32
      }
      let [a, b, c, d, e, f, g, hh] = h;
      for (let t = 0; t < 64; t++) {
        const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        const ch = (e & f) ^ (~e & g);
        const t1 = (hh + S1 + ch + K[t] + w[t]) | 0;
        const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (S0 + maj) | 0;
        hh = g;
        g = f;
        f = e;
        e = (d + t1) | 0;
        d = c;
        c = b;
        b = a;
        a = (t1 + t2) | 0;
      }
      h[0] = (h[0] + a) | 0;
      h[1] = (h[1] + b) | 0;
      h[2] = (h[2] + c) | 0;
      h[3] = (h[3] + d) | 0;
      h[4] = (h[4] + e) | 0;
      h[5] = (h[5] + f) | 0;
      h[6] = (h[6] + g) | 0;
      h[7] = (h[7] + hh) | 0;
    }
    return h.map(v => (v >>> 0).toString(16).padStart(8, "0")).join("");
  }

  // ---------- ids (§E3) ----------
  // These compute the template and never validate: validation is bankValidate's job.

  // numeric and free: answer.value; mcq: JSON.stringify(choices) + String(correct).
  function answerKey(item) {
    const a = item.answer;
    return item.type === "mcq" ? JSON.stringify(a.choices) + String(a.correct) : a.value;
  }

  // First 8 hex digits of sha256(prompt + answerKey), no separator.
  function hash8(item) {
    return sha256Hex(item.prompt + answerKey(item)).slice(0, 8);
  }

  function makeId(sourceKey, locator, item) {
    return `${sourceKey}-${locator}-${hash8(item)}`;
  }

  function parseId(id) {
    const m = typeof id === "string" ? ID_RE.exec(id) : null;
    return m ? { key: m[1], locator: m[2], hash: m[3] } : null;
  }

  // ---------- validator (§E4) ----------

  // "An object" is a non-null, non-array object; "a non-empty string" is not trimmed (§E4).
  const isObj = x => typeof x === "object" && x !== null && !Array.isArray(x);
  const isStr = x => typeof x === "string" && x.length > 0;

  // Index loops, not every(): every() skips the holes of a sparse array.
  function allOf(arr, pred) {
    for (let i = 0; i < arr.length; i++) if (!pred(arr[i])) return false;
    return true;
  }

  const isTopic = t => typeof t === "string" && TOPIC_RE.test(t);
  const isFile = f => typeof f === "string" && FILE_RE.test(f) && !f.split("/").includes("..");
  const isTolPart = v => v === undefined || (Number.isFinite(v) && v >= 0);

  // The fields whose validity the hash check needs: answerKey reads prompt, type and the
  // answer fields of the item's type (§E4 "Hash check").
  const HASH_INPUTS = ["prompt", "type", "answer", "answer.value", "answer.choices", "answer.correct"];

  function parseError(value) {
    // bankValidate never throws (§E4), so a parser fault is reported on the item instead.
    try {
      const r = A.parseAnswer(value);
      return r.ok ? null : r.error;
    } catch (e) {
      return `the parser failed on it (${e && e.message ? e.message : String(e)})`;
    }
  }

  function checkAnswer(item, err) {
    const a = item.answer;
    if (!isObj(a)) {
      err("answer", "answer must be an object");
      return;
    }
    if (item.type === "numeric") {
      if (typeof a.value !== "string") {
        err("answer.value", "a numeric answer.value must be a string expression");
      } else {
        const why = parseError(a.value);
        if (why !== null) err("answer.value", `numeric answer.value ${JSON.stringify(a.value)} does not parse: ${why}`);
      }
    } else if (item.type === "free") {
      if (!isStr(a.value)) err("answer.value", "a free answer.value must be a non-empty markdown string");
    } else if (item.type === "mcq") {
      const ch = a.choices;
      if (!Array.isArray(ch) || ch.length < 2 || ch.length > 8 || !allOf(ch, isStr)) {
        err("answer.choices", "mcq answer.choices must be an array of 2 to 8 non-empty strings");
      }
      // The upper bound is only known when choices is an array; otherwise the choices error
      // above already covers the item, and correct is checked as a non-negative integer.
      const max = Array.isArray(ch) ? ch.length : Infinity;
      if (!Number.isInteger(a.correct) || a.correct < 0 || a.correct >= max) {
        err("answer.correct", Array.isArray(ch)
          ? `mcq answer.correct must be an integer from 0 to ${ch.length - 1}`
          : "mcq answer.correct must be a non-negative integer");
      }
    }
    // An unknown type has no answer shape to check; the type error covers it.
    if (a.tol !== undefined && !(isObj(a.tol) && isTolPart(a.tol.rel) && isTolPart(a.tol.abs))) {
      err("answer.tol", "answer.tol must be an object whose rel / abs are finite numbers of at least 0");
    }
  }

  function checkSource(src, err) {
    if (!isObj(src)) {
      err("source", "source must be an object { key, title, file, page }");
      return;
    }
    if (typeof src.key !== "string" || !KEY_RE.test(src.key)) {
      err("source.key", "source.key must be 2 to 24 lowercase letters or digits, with no hyphens");
    }
    if (!isStr(src.title)) err("source.title", "source.title must be a non-empty string");
    if (!isFile(src.file)) {
      err("source.file", "source.file must be a relative POSIX path under library/ (letters, digits, . _ -), with no .. segment");
    }
    if (!Number.isInteger(src.page) || src.page < 1) err("source.page", "source.page must be an integer of at least 1");
  }

  function checkCheck(check, err) {
    if (!isObj(check)) {
      err("check", "check must be an object { status, ... }");
      return;
    }
    if (!STATUSES.includes(check.status)) err("check.status", `check.status must be one of ${STATUSES.join(", ")}`);
    if (check.method !== undefined && !METHODS.includes(check.method)) {
      err("check.method", `check.method, when present, must be one of ${METHODS.join(", ")}`);
    }
    if (NEEDS_PRINTED.includes(check.status)) {
      if (!isStr(check.printed)) err("check.printed", `a ${check.status} item needs check.printed (the printed answer)`);
      if (!isStr(check.resolved)) err("check.resolved", `a ${check.status} item needs check.resolved (the re-solved answer)`);
    }
  }

  // Appends every error of items[i] to errors. `seen` holds the ids of earlier items.
  function checkItem(item, i, seen, errors) {
    if (!isObj(item)) {
      errors.push({ id: `#${i}`, field: "items", msg: `items[${i}] is not an object` });
      return;
    }
    const id = isStr(item.id) ? item.id : `#${i}`;
    const bad = new Set();
    const err = (field, msg) => {
      bad.add(field);
      errors.push({ id, field, msg });
    };

    const parts = parseId(item.id);
    if (!parts) err("id", "id must look like <sourceKey>-<locator>-<8 lowercase hex digits>");
    if (isStr(item.id)) {
      if (seen.has(item.id)) err("id", `duplicate id: an earlier item already uses ${item.id}`);
      else seen.add(item.id);
    }

    checkSource(item.source, err);
    if (!AREAS.includes(item.area)) err("area", `area must be one of ${AREAS.join(", ")}`);
    if (!Array.isArray(item.topics) || item.topics.length === 0 || !allOf(item.topics, isTopic)) {
      err("topics", "topics must be a non-empty array of lowercase-kebab strings");
    }
    if (!Number.isInteger(item.difficulty) || item.difficulty < 1 || item.difficulty > 5) {
      err("difficulty", "difficulty must be an integer from 1 to 5");
    }
    if (!TYPES.includes(item.type)) err("type", `type must be one of ${TYPES.join(", ")}`);
    if (typeof item.prompt !== "string" || !/\S/.test(item.prompt)) {
      err("prompt", "prompt must be a string with non-whitespace content");
    }
    checkAnswer(item, err);
    if (!isStr(item.solution)) err("solution", "solution must be a non-empty markdown string");
    if (!ORIGINS.includes(item.origin)) err("origin", `origin must be one of ${ORIGINS.join(", ")}`);
    checkCheck(item.check, err);

    if (parts) {
      if (isObj(item.source) && parts.key !== item.source.key) {
        err("id", `the id's key part "${parts.key}" differs from source.key`);
      }
      if (!HASH_INPUTS.some(f => bad.has(f))) {
        const want = hash8(item);
        if (parts.hash !== want) {
          err("id", `hash mismatch: the content hashes to ${want}, the id says ${parts.hash} (rebuild the id with makeId)`);
        }
      }
    }
  }

  // bank: any object with an items array (bank.json, a deck, or { items: allItems(...) }).
  // Returns { ok, errors: [{ id, field, msg }] } and reports every problem. Never throws.
  function bankValidate(bank) {
    if (!isObj(bank) || !Array.isArray(bank.items)) {
      return { ok: false, errors: [{ id: null, field: "items", msg: "the bank must be an object with an items array" }] };
    }
    const errors = [];
    const seen = new Set();
    for (let i = 0; i < bank.items.length; i++) checkItem(bank.items[i], i, seen, errors);
    return { ok: errors.length === 0, errors };
  }

  // ---------- helpers (§E5) ----------

  // §A6: an Item[] or any object with an items array. Anything else (null, undefined, a loaded
  // file without an items array) reads as [], the same as PrepSrs does for a `bank`.
  function asItems(items) {
    if (Array.isArray(items)) return items;
    if (items !== null && typeof items === "object" && Array.isArray(items.items)) return items.items;
    return [];
  }

  // [...bankJson.items, ...decks[0].items, ...]: a new array of the same item objects. A null
  // bankJson or deck (or one without an items array) contributes nothing.
  function allItems(bankJson, decks = []) {
    if (decks != null && !Array.isArray(decks)) throw new TypeError("allItems: decks must be an array");
    const out = [];
    for (const f of [bankJson, ...(decks || [])]) {
      if (f && Array.isArray(f.items)) for (const it of f.items) out.push(it);
    }
    return out;
  }

  // { [id]: item }, first occurrence wins. Object.fromEntries defines own properties, so an id
  // such as "__proto__" cannot reach the prototype.
  function indexById(items) {
    const byId = new Map();
    for (const it of asItems(items)) {
      if (it && isStr(it.id) && !byId.has(it.id)) byId.set(it.id, it);
    }
    return Object.fromEntries(byId);
  }

  // The distinct topics, sorted with `<` (UTF-16 code unit order).
  function topicSet(items) {
    const topics = new Set();
    for (const it of asItems(items)) {
      if (it && Array.isArray(it.topics)) for (const t of it.topics) if (typeof t === "string") topics.add(t);
    }
    return [...topics].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }

  // The answer as shown to the user: the expression, the model answer, or the correct choice.
  function answerText(item) {
    const a = item.answer;
    return item.type === "mcq" ? a.choices[a.correct] : a.value;
  }

  // "Green Book, p. 37": always "p.", slides included (spec §3 F1.4).
  function sourceLabel(item) {
    return `${item.source.title}, p. ${item.source.page}`;
  }

  // root is the loaded bank root from prepLoadBank (§E6).
  function libraryHref(item, root = "bank/") {
    return `${root}library/${encodeURI(item.source.file)}#page=${item.source.page}`;
  }

  // { [source.file]: number of items }. Only cited files appear; the Library tab reads a
  // missing key as 0.
  function sourceCounts(items) {
    const counts = new Map();
    for (const it of asItems(items)) {
      const file = it && it.source ? it.source.file : undefined;
      if (typeof file === "string") counts.set(file, (counts.get(file) || 0) + 1);
    }
    return Object.fromEntries(counts);
  }

  return {
    AREAS, PRACTICE_AREAS, CARD_AREAS, TYPES, STATUSES, ORIGINS, METHODS,
    KEY_RE, LOCATOR_RE, ID_RE, TOPIC_RE,
    sha256Hex, answerKey, hash8, makeId, parseId, bankValidate,
    allItems, indexById, topicSet, answerText, sourceLabel, libraryHref, sourceCounts,
  };
})();
if (typeof module !== "undefined") module.exports = PrepBank;
