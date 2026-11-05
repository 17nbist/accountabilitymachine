// bank:build (V4-CONTRACTS.md §M7; spec §10): the local content pipeline. It reads the resource
// library (~/Documents/Quant Prep/resources), caches each step's output in bank-build/.cache/
// and writes the gitignored bank/. Agents do the extraction and solving work; these scripts only
// handle files, caching, merging, validation and reports.
//
//   node bank-build/build.js [step] [source]
//   steps, in order: ocr extract resolve sim decks assemble report; `all` (the default) runs them
//
// This is the M0 skeleton: it knows the steps and the sources (bank-build/sources.json) and
// validates its arguments, but no step is implemented yet. The pipeline is built after M1, once
// bankValidate and parseAnswer exist. Node built-ins only: package.json is locked after M0.
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const SOURCES_PATH = path.join(__dirname, "sources.json");
const DECKS = ["cpp", "systems"];
const STEPS = [
  { name: "ocr", what: "OCR the Green Book scan into .cache/greenbook-ocr.pdf (ocrmypdf), check it yields > 100 KB of text" },
  { name: "extract", what: "merge the extraction agents' items per source from .cache/extract/ (check.status unverified)" },
  { name: "resolve", what: "merge the blind re-solve and judge rulings from .cache/resolve/ (agreed, corrected, disputed)" },
  { name: "sim", what: "run the Monte Carlo / enumeration checks (bank-build/sim/, python3 -I) into .cache/sim/" },
  { name: "decks", what: "merge the C++ and systems concept cards from .cache/decks/" },
  { name: "assemble", what: "copy the cited PDFs into bank/library/, write bank/bank.json, bank/decks/*.json, bank/lists/neetcode150.json and bank/library/index.json, then run bankValidate" },
  { name: "report", what: "write bank/REPORT.md with counts and the spec §10 acceptance checks" },
];
const STEP_NAMES = STEPS.map((s) => s.name);

function loadSources(file = SOURCES_PATH) {
  const list = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(list)) throw new Error(`${file}: expected an array of sources`);
  return list.slice().sort((a, b) => a.priority - b.priority);
}

function usage(sources) {
  const lines = [
    "usage: node bank-build/build.js [step] [source]   (npm run bank:build -- <step> [source])",
    "",
    "steps (`all`, the default, runs them in this order):",
    ...STEPS.map((s) => `  ${s.name.padEnd(9)} ${s.what}`),
    "",
    "sources (bank-build/sources.json, in priority order):",
    ...sources.map((s) => `  ${s.key.padEnd(10)} ${s.title} (${s.area})`),
    `decks: ${DECKS.join(", ")}`,
  ];
  return lines.join("\n");
}

// Returns { help } or { steps, source } or { error }.
function parseArgs(argv, sources) {
  if (argv.some((a) => a === "--help" || a === "-h" || a === "help")) return { help: true };
  if (argv.length > 2) return { error: "too many arguments" };
  const [step = "all", source = null] = argv;
  if (step !== "all" && !STEP_NAMES.includes(step)) return { error: `unknown step ${JSON.stringify(step)}` };
  if (source !== null) {
    const known = step === "decks" ? DECKS : sources.map((s) => s.key);
    if (!known.includes(source)) return { error: `unknown ${step === "decks" ? "deck" : "source"} ${JSON.stringify(source)} for ${step}` };
  }
  return { steps: step === "all" ? STEP_NAMES : [step], source };
}

function main(argv = process.argv.slice(2)) {
  let sources;
  try {
    sources = loadSources();
  } catch (e) {
    process.stderr.write(`bank:build: cannot read bank-build/sources.json (${e.message})\n`);
    return 1;
  }
  const args = parseArgs(argv, sources);
  if (args.help) {
    process.stdout.write(usage(sources) + "\n");
    return 0;
  }
  if (args.error) {
    process.stderr.write(`bank:build: ${args.error}\n\n${usage(sources)}\n`);
    return 1;
  }
  for (const step of args.steps) {
    process.stdout.write(`bank:build ${step}${args.source ? " " + args.source : ""}: not implemented yet\n`);
  }
  // Nothing was built, so this is not a success.
  return 1;
}

module.exports = { STEPS, STEP_NAMES, DECKS, loadSources, parseArgs };

if (require.main === module) process.exitCode = main();
