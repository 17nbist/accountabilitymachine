// node --test reporter for the hold-out suite (V4-CONTRACTS.md §M5). It prints one
// `ok <name>` / `not ok <name>` line per test (indented by nesting) and a totals line, and
// nothing else: no assertion message, value, error text, stack, source, diagnostic, and none of
// the tests' own stdout or stderr. There is deliberately no verbose mode.
"use strict";

module.exports = async function* holdoutReporter(source) {
  const n = { tests: 0, pass: 0, fail: 0, skipped: 0, todo: 0 };
  for await (const event of source) {
    if (event.type !== "test:pass" && event.type !== "test:fail") continue;
    const d = event.data || {};
    const passed = event.type === "test:pass";
    const name = String(d.name == null ? "" : d.name).replace(/[\r\n]+/g, " ");
    const indent = "  ".repeat(Math.max(0, Number(d.nesting) || 0));
    yield `${indent}${passed ? "ok" : "not ok"} ${name}\n`;
    if (d.details && d.details.type === "suite") continue;
    n.tests++;
    if (d.skip) n.skipped++;
    else if (d.todo) n.todo++;
    else if (passed) n.pass++;
    else n.fail++;
  }
  yield `tests ${n.tests}, pass ${n.pass}, fail ${n.fail}, skipped ${n.skipped}, todo ${n.todo}\n`;
};
