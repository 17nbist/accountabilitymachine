// bank/REPORT.md (spec §10 step 6, §M7 `report`): counts, every corrected and disputed item,
// skipped items, drops, the audit and sim summaries, the validator output and the §10 acceptance
// checks. bank/ is gitignored, so the report may quote item answers; nothing here is committed.
"use strict";

const PrepBank = require("../../prep/bank.js");
const { DECKS, countBy, rel } = require("./util.js");
const { groupErrors, errorKind } = require("./merge.js");

const MIN_PRACTICE = 600;
const MIN_CARDS = 300;
const MAX_SOURCE_SHARE = 0.4;
const MAX_DISPUTED = 0.05;

const cell = v => String(v === undefined || v === null ? "" : v).replace(/\r?\n/g, " ").replace(/\|/g, "\\|");
const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(1)}%` : "n/a");

function mdTable(header, rows) {
  if (!rows.length) return "_(none)_\n";
  return [
    `| ${header.map(cell).join(" | ")} |`,
    `|${header.map(() => "---").join("|")}|`,
    ...rows.map(r => `| ${r.map(cell).join(" | ")} |`),
  ].join("\n") + "\n";
}

// The spec §10 acceptance checks plus the build's own checks. Pure: used by the report and by the
// terminal summary.
function acceptance(state) {
  const practice = state.merged.practice;
  const cards = DECKS.flatMap(d => state.merged.decks[d]);
  const all = [...practice, ...cards];
  const bySource = countBy(practice, it => it.source && it.source.key);
  const top = [...bySource.entries()].sort((a, b) => b[1] - a[1])[0] || [null, 0];
  const disputed = all.filter(it => it.check && it.check.status === "disputed").length;
  const numeric = all.filter(it => it.type === "numeric");
  const noMethod = numeric.filter(it => !(it.check && PrepBank.METHODS.includes(it.check.method)));
  const checks = [
    { name: "bankValidate reports 0 errors", pass: state.validation.length === 0, value: `${state.validation.length} errors` },
    { name: `at least ${MIN_PRACTICE} practice items`, pass: practice.length >= MIN_PRACTICE, value: `${practice.length}` },
    { name: `at least ${MIN_CARDS} cards (cpp + systems)`, pass: cards.length >= MIN_CARDS, value: `${cards.length} (${DECKS.map(d => `${d} ${state.merged.decks[d].length}`).join(", ")})` },
    { name: `no source over ${MAX_SOURCE_SHARE * 100}% of practice items`, pass: practice.length > 0 && top[1] / practice.length <= MAX_SOURCE_SHARE, value: `largest: ${top[0]} ${top[1]} (${pct(top[1], practice.length)})` },
    { name: `at most ${MAX_DISPUTED * 100}% of items disputed`, pass: all.length > 0 && disputed / all.length <= MAX_DISPUTED, value: `${disputed} of ${all.length} (${pct(disputed, all.length)})` },
    { name: "every numeric item carries check.method", pass: noMethod.length === 0, value: `${numeric.length - noMethod.length} of ${numeric.length}` },
  ];
  const extra = [
    { name: "build checks (cache shape, locators, §E2 stored answers, library files, NeetCode list)", pass: state.buildErrors.length === 0 && state.cache.malformed.length === 0, value: `${state.buildErrors.length + state.cache.malformed.length} errors` },
  ];
  return { checks, extra, noMethod, pass: checks.every(c => c.pass) && extra.every(c => c.pass) };
}

function simSummary(state) {
  const numericRecs = state.merged.records.filter(r => r.item.type === "numeric" && r.kind === "practice");
  const withSim = numericRecs.filter(r => r.sim);
  const ok = withSim.filter(r => r.sim.ok);
  const bad = withSim.filter(r => !r.sim.ok);
  const conflicts = bad.filter(r => r.sim.kind === "disagree");
  const run = state.simRun;
  const failedScripts = run ? run.scripts.filter(s => s.status !== "ok") : [];
  return { numericRecs, withSim, ok, bad, conflicts, failures: bad.length - conflicts.length, run, failedScripts };
}

function renderReport(state) {
  const { merged, validation, buildErrors, cache } = state;
  const practice = merged.practice;
  const cards = DECKS.flatMap(d => merged.decks[d]);
  const all = [...practice, ...cards];
  const acc = acceptance(state);
  const sim = simSummary(state);
  const L = [];
  const h = (lvl, t) => L.push(`${"#".repeat(lvl)} ${t}\n`);
  const p = t => L.push(`${t}\n`);

  h(1, "Bank build report");
  p(`Generated ${state.generated} by \`node bank-build/build.js\`. Local only: bank/ is gitignored.`);
  p(`Practice items: **${practice.length}** (bank.json). Cards: **${cards.length}** (${DECKS.map(d => `${d} ${merged.decks[d].length}`).join(", ")}). ` +
    `bank.json and decks written: **${state.written === undefined ? "not in this run" : state.written ? "yes" : "no (build errors)"}**.`);

  h(2, "Acceptance (spec §10)");
  L.push(mdTable(["Check", "Result", "Value"], acc.checks.map(c => [c.name, c.pass ? "PASS" : "FAIL", c.value])));
  L.push(mdTable(["Build check (not part of §10)", "Result", "Value"], acc.extra.map(c => [c.name, c.pass ? "PASS" : "FAIL", c.value])));

  h(2, "Counts");
  const statuses = PrepBank.STATUSES;
  const keyRows = [];
  for (const s of state.sources) {
    const its = practice.filter(it => it.source.key === s.key);
    const st = countBy(its, it => it.check.status);
    keyRows.push([s.key, s.title, its.length, pct(its.length, practice.length), ...statuses.map(x => st.get(x) || 0)]);
  }
  h(3, "Practice items per source");
  L.push(mdTable(["Source", "Title", "Items", "Share", ...statuses], keyRows));
  h(3, "Cards per deck and source key");
  const cardRows = [];
  for (const d of DECKS) {
    const byKey = countBy(merged.decks[d], it => it.source.key);
    for (const [k, n] of [...byKey.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))) {
      const st = countBy(merged.decks[d].filter(it => it.source.key === k), it => it.check.status);
      cardRows.push([d, k, n, ...statuses.map(x => st.get(x) || 0)]);
    }
  }
  L.push(mdTable(["Deck", "Source key", "Cards", ...statuses], cardRows));
  h(3, "Per area, type and status");
  const areaRows = PrepBank.AREAS.map(a => {
    const its = all.filter(it => it.area === a);
    const ty = countBy(its, it => it.type);
    const st = countBy(its, it => it.check.status);
    return [a, its.length, ...PrepBank.TYPES.map(t => ty.get(t) || 0), ...statuses.map(x => st.get(x) || 0)];
  });
  L.push(mdTable(["Area", "Items", ...PrepBank.TYPES, ...statuses], areaRows));
  const methods = countBy(all, it => `${it.type} / ${it.check.method || "(none)"}`);
  L.push(mdTable(["Type / check.method", "Items"], [...methods.entries()].sort()));

  h(2, "Corrected and disputed items");
  for (const status of ["corrected", "disputed"]) {
    const recs = merged.records.filter(r => r.item.check && r.item.check.status === status);
    h(3, `${status} (${recs.length})`);
    L.push(mdTable(["Id", "Printed", "Resolved", "By", "Note"], recs.map(r => [
      r.item.id, r.item.check.printed, r.item.check.resolved,
      r.verdict && (r.verdict.verdict === status) ? "audit" : r.kind === "card" ? "card check" : "adjudicator",
      r.item.check.note,
    ])));
  }

  h(2, "Unverified practice items");
  L.push(mdTable(["Source", "Chunk", "Locator", "Why"], merged.unresolved.map(u => [u.key, u.chunk, u.locator, u.reason])));

  h(2, "Skipped during extraction and card writing");
  p(`${merged.skipped.length} entries from the \`skipped\` lists of the extract and deck chunks.`);
  L.push(mdTable(["Kind", "Source / deck", "Chunk", "Ref", "Reason"], merged.skipped.map(s => [s.kind, s.key, s.chunk, s.ref, s.reason])));

  h(2, "Dropped at assembly");
  const dropsBy = countBy(merged.dropped, d => d.by);
  p(`Resolve drops ${dropsBy.get("resolve") || 0}, dedup drops ${dropsBy.get("dedup") || 0} (${cache.dedupExists ? rel(cache.dedupPath) : "no dedup.json yet"}), audit drops ${dropsBy.get("audit") || 0}.`);
  L.push(mdTable(["By", "Source", "Chunk", "Locator", "Reason"], merged.dropped.map(d => [d.by, d.key, d.chunk, d.locator, d.reason])));

  h(2, "Audit");
  if (!cache.audit) p(`No audit verdicts yet (${rel(cache.auditPath)} does not exist).`);
  else {
    const v = countBy(Object.values(cache.audit), x => x.verdict);
    p(`${Object.keys(cache.audit).length} verdicts: ${["ok", "corrected", "disputed", "drop"].map(k => `${k} ${v.get(k) || 0}`).join(", ")}.`);
    L.push(mdTable(["Item", "Verdict", "Resolved", "Note"], Object.entries(cache.audit).filter(([, x]) => x.verdict !== "ok").map(([k, x]) => [k, x.verdict, x.resolved, x.note])));
  }

  h(2, "Simulation");
  p(`Numeric practice items: ${sim.numericRecs.length}. With a simulation: ${sim.withSim.length} (agree ${sim.ok.length}, conflict ${sim.conflicts.length}, failure ${sim.failures}). ` +
    `Not simulated (infeasible or no script): ${sim.numericRecs.length - sim.withSim.length}.`);
  if (sim.run) {
    p(`Last sim run ${sim.run.generated}: ${sim.run.scripts.length} scripts, ${sim.failedScripts.length} failed.`);
    L.push(mdTable(["Script", "Status", "Seconds", "Locators", "Agree", "Disagree", "Error"], sim.run.scripts.map(s => [s.script, s.status, (s.ms / 1000).toFixed(1), s.locators, s.ok, s.bad, s.error])));
  } else p("The sim step has not been run by build.js yet: the sim cache holds the M2 agents' results.");
  h(3, "Conflicts and failures");
  p("A conflict is a simulation that disagrees with the bank answer; a failure is a check that could not be made (script error, no estimate, an answer that does not parse). Either way the item keeps `check.method: \"blind\"`.");
  L.push(mdTable(["Id", "Kind", "Method", "Estimate", "SE", "Answer", "Why"], sim.bad.map(r => [r.item.id, r.sim.kind === "disagree" ? "conflict" : "failure", r.sim.entry.method, r.sim.entry.estimate, r.sim.entry.se, r.item.answer.value, r.sim.why])));
  h(3, "Sim results with no numeric item");
  L.push(mdTable(["Source", "Chunk", "Locator", "Why"], merged.simOrphans.map(o => [o.key, o.chunk, o.locator, o.why])));

  h(2, "Validator output");
  p(`bankValidate on the merged set and on each file: ${validation.length} errors.`);
  L.push(mdTable(["Source", "Field", "Kind", "Count", "Examples"], groupErrors(validation).map(g => [g.key, g.field, g.kind, g.count, g.examples.join(", ")])));
  L.push(mdTable(["Id", "Field", "Message"], validation.map(e => [e.id, e.field, e.msg])));

  h(2, "Build checks");
  L.push(mdTable(["Source", "Field", "Kind", "Count", "Examples"], groupErrors(buildErrors).map(g => [g.key, g.field, g.kind, g.count, g.examples.join(", ")])));
  L.push(mdTable(["Id", "Field", "Message"], buildErrors.map(e => [e.id, e.field, e.msg])));
  h(3, "Cache problems");
  L.push(mdTable(["Severity", "File", "Problem"], cache.problems.map(x => [x.severity, rel(x.file), x.msg])));
  h(3, "Warnings");
  L.push(mdTable(["Warning"], merged.warnings.map(w => [w])));

  h(2, "Library");
  if (state.library) {
    const multi = state.library.plan.filter(e => e.otherKeys);
    p(`${state.library.plan.length} files in bank/library/ (${state.library.plan.filter(e => e.key).length} cited by items).` +
      (state.libraryWrite ? ` This run copied ${state.libraryWrite.copied}, kept ${state.libraryWrite.kept}, removed ${state.libraryWrite.removed}.` : ""));
    if (multi.length) L.push(mdTable(["File", "Index key", "Also cited by"], multi.map(e => [e.file, e.key, e.otherKeys.join(", ")])));
  }
  return L.join("\n");
}

module.exports = { acceptance, renderReport, simSummary, errorKind };
