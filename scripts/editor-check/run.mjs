// Runs the editor checks in Chrome (and Firefox and WebKit, if asked)
// against a scratch copy of the site.
//   node scripts/editor-check/run.mjs                       every check in checks/
//   node scripts/editor-check/run.mjs --only smoke,stopgaps  just these
//   --engines chrome,firefox,webkit   run each check in each (default chrome)
//   --port 3102          serve the copy on another port (default 3101; never 3000)
//   --source head        copy the last commit instead of the working tree
//   --keep               keep the site copy afterwards, to look at what was saved
//   --update-baseline    let the smoke check rewrite the axe baseline
// Each checks/<name>.mjs exports a default async function(ctx) that returns
// [{name, pass, detail}] (see README.md). The JSON report and screenshots go
// to WORK_DIR/reports/<port>-<time>/, screenshots in a folder per engine.
// Exits 1 when anything fails. The server is always stopped, on errors and
// Ctrl+C too.
import { readdirSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { startScratch, WORK_DIR, DEFAULT_PORT } from "./lib/scratch.mjs";
import { editor } from "./lib/editor.mjs";
import { runAxe } from "./lib/axe.mjs";
import { ENGINES, SUPPORTS, launch } from "./lib/engines.mjs";

const CHECKS_DIR = new URL("./checks/", import.meta.url).pathname;
// a check that hangs fails instead of holding the run (and its server) open
const CHECK_TIMEOUT = 5 * 60 * 1000;

const args = process.argv.slice(2);
const VALUED = ["--only", "--engines", "--port", "--source"];
const FLAGS = ["--keep", "--update-baseline"];
for (let i = 0; i < args.length; i++) {
  if (VALUED.includes(args[i])) i++;
  else if (!FLAGS.includes(args[i])) usage(`Unknown option: ${args[i]}`);
}
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const port = Number(opt("--port", DEFAULT_PORT));
const source = opt("--source", "worktree");
const keep = args.includes("--keep");
const updateBaseline = args.includes("--update-baseline");

function usage(problem) {
  console.error(`${problem}\nUsage: node scripts/editor-check/run.mjs [--only name[,name]] [--engines chrome,firefox,webkit] [--port N] [--source worktree|head] [--keep] [--update-baseline]`);
  process.exit(2);
}

const available = readdirSync(CHECKS_DIR)
  .filter((f) => f.endsWith(".mjs"))
  .map((f) => f.slice(0, -4))
  .sort();
const only = opt("--only", "");
const names = only ? only.split(",").map((n) => n.trim()).filter(Boolean) : available;
const unknown = names.filter((n) => !available.includes(n));
if (unknown.length) usage(`No such check: ${unknown.join(", ")} (there are: ${available.join(", ")})`);
if (!["worktree", "head"].includes(source)) usage(`--source must be worktree or head`);
const engines = [...new Set(opt("--engines", "chrome").split(",").map((e) => e.trim()).filter(Boolean))];
const strange = engines.filter((e) => !ENGINES.includes(e));
if (strange.length || !engines.length) usage(`No such engine: ${strange.join(", ") || "(none)"} (there are: ${ENGINES.join(", ")})`);

const stamp = new Date().toISOString().replace(/\.\d+Z$/, "").replace(/[-:]/g, "").replace("T", "-");
const reportDir = path.join(WORK_DIR, "reports", `${port}-${stamp}`);

let scratch = null;
let browser = null;
let cleaning = null;
let interrupted = false;
function cleanup() {
  cleaning ??= (async () => {
    await browser?.close().catch(() => {});
    await scratch?.stop();
  })();
  return cleaning;
}
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, async () => {
    interrupted = true;
    console.error(`\n${signal}: stopping the server on port ${port}…`);
    await cleanup().catch((e) => console.error(e.message));
    process.exit(130);
  });
}

const withTimeout = (promise, ms, what) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`${what} took longer than ${ms / 1000} s`)), ms).unref())]);

async function runCheck(name, engine) {
  const dir = path.join(reportDir, engine, name);
  mkdirSync(dir, { recursive: true });
  const context = await browser.createBrowserContext();
  const pageErrors = [];
  const open = async () => {
    const page = await context.newPage();
    // quick loading screen and transitions; a check can turn motion back on
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
    page.on("pageerror", (e) => pageErrors.push(e.message.split("\n")[0]));
    return editor(page, { base: scratch.base, siteDir: scratch.dir, reportDir: dir });
  };
  const ed = await open();
  await ed.setViewport(1440);
  const ctx = {
    ...ed,
    ed,
    browser,
    context,
    port,
    source,
    // which browser this is, and what it can do (lib/engines.mjs)
    engine,
    supports: SUPPORTS[engine],
    // a result that can't be had in this engine, shown as SKIP (why can be a skip error's message)
    skip: (resultName, why = "") => ({ name: resultName, pass: true, skipped: true, detail: /^skipped in /.test(why) ? why : `skipped in ${engine}${why ? `: ${why}` : ""}` }),
    workDir: WORK_DIR,
    options: { updateBaseline },
    axe: (options) => runAxe(ed.page, options),
    // another tab in the same browser context, with its own helpers
    newPage: open,
    log: (...parts) => console.log(`  ${name} (${engine}):`, ...parts),
  };
  const start = Date.now();
  let results;
  try {
    const { default: check } = await import(path.join(CHECKS_DIR, `${name}.mjs`));
    results = await withTimeout(check(ctx), CHECK_TIMEOUT, `The ${name} check`);
    if (!Array.isArray(results) || !results.length) results = [{ name: "returns results", pass: false, detail: "The check returned no results" }];
  } catch (e) {
    // the message, and where in the check or its helpers it was thrown
    const where = (e.stack || "").split("\n").filter((l) => l.includes("/editor-check/")).slice(0, 2).map((l) => l.trim().replace(/^at /, ""));
    // something only Chrome can do (lib/engines.mjs) skips the rest of the check
    results = [{ name: "runs without errors", pass: !!e.skipped, skipped: !!e.skipped, detail: [e.message, ...where].join(" ← ") }];
    if (!e.skipped) await ed.screenshot("error").catch(() => {});
  } finally {
    await context.close().catch(() => {});
  }
  results = results.map((r) => ({ name: r.name, pass: !!r.pass || !!r.skipped, skipped: !!r.skipped, detail: r.detail ?? "" }));
  return { check: name, engine, ms: Date.now() - start, results, pageErrors };
}

function printTable(report) {
  const status = (r) => (r.skipped ? "SKIP" : r.pass ? "PASS" : "FAIL");
  const rows = report.checks.flatMap((c) => c.results.map((r) => [status(r), c.engine, c.check, r.name, String(r.detail).replace(/\s+/g, " ")]));
  const widths = [4, 7, Math.max(5, ...rows.map((r) => r[2].length)), Math.max(6, ...rows.map((r) => r[3].length))];
  const line = (cells) => cells.map((c, i) => (i < 4 ? c.padEnd(widths[i]) : c.length > 110 ? `${c.slice(0, 107)}…` : c)).join("  ");
  console.log(`\n${line(["", "Engine", "Check", "Result", "Detail"])}`);
  for (const row of rows) console.log(line(row));
  const count = (s) => rows.filter((r) => r[0] === s).length;
  const failed = count("FAIL");
  const skipped = count("SKIP") ? `, ${count("SKIP")} skipped` : "";
  console.log(`\n${count("PASS")} passed, ${failed} failed${skipped}. Report: ${path.join(reportDir, "report.json")}`);
  return failed;
}

/** A browser of the engine, or a failed result saying why it didn't start. */
async function startBrowser(engine) {
  try {
    return await launch(engine);
  } catch (e) {
    return { failed: { check: "(browser)", engine, ms: 0, results: [{ name: "starts", pass: false, skipped: false, detail: e.message }], pageErrors: [] } };
  }
}

let failed = 1;
try {
  mkdirSync(reportDir, { recursive: true });
  const report = { started: new Date().toISOString(), port, source, base: `http://localhost:${port}`, engines, browsers: {}, checks: [] };
  // one engine at a time, every check in each. Each engine gets a fresh
  // copy: checks save to it, and expect the site as it was copied
  let kept = null;
  for (const engine of engines) {
    if (interrupted) break;
    const started = await startBrowser(engine);
    if (started.failed) {
      console.error(`${engine} didn't start: ${started.failed.results[0].detail}`);
      report.checks.push(started.failed);
      continue;
    }
    browser = started;
    report.browsers[engine] = await browser.version();
    scratch = await startScratch({ port, source, keep });
    kept = { dir: scratch.dir, engine };
    for (const name of names) {
      if (interrupted) break;
      console.log(`Running ${name} in ${engine}…`);
      report.checks.push(await runCheck(name, engine));
    }
    await browser?.close().catch(() => {});
    browser = null;
    await scratch.stop();
    scratch = null;
  }
  report.finished = new Date().toISOString();
  writeFileSync(path.join(reportDir, "report.json"), JSON.stringify(report, null, 2));
  failed = printTable(report);
  if (keep && kept) console.log(`The site copy${engines.length > 1 ? ` (${kept.engine}'s)` : ""} is kept at ${kept.dir}`);
} catch (e) {
  console.error(`The run stopped: ${e.message}`);
  failed = 1;
} finally {
  await cleanup().catch((e) => console.error(`Couldn't stop cleanly: ${e.message}`));
}
process.exit(failed ? 1 : 0);
