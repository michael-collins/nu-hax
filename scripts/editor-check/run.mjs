// Runs the editor checks in Chrome against a scratch copy of the site.
//   node scripts/editor-check/run.mjs                       every check in checks/
//   node scripts/editor-check/run.mjs --only smoke,stopgaps  just these
//   --port 3102          serve the copy on another port (default 3101; never 3000)
//   --source head        copy the last commit instead of the working tree
//   --keep               keep the site copy afterwards, to look at what was saved
//   --update-baseline    let the smoke check rewrite the axe baseline
// Each checks/<name>.mjs exports a default async function(ctx) that returns
// [{name, pass, detail}] (see README.md). The JSON report and screenshots go
// to WORK_DIR/reports/<port>-<time>/. Exits 1 when anything fails. The
// server is always stopped, on errors and Ctrl+C too.
import puppeteer from "puppeteer-core";
import { readdirSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { startScratch, WORK_DIR, DEFAULT_PORT } from "./lib/scratch.mjs";
import { editor } from "./lib/editor.mjs";
import { runAxe } from "./lib/axe.mjs";

const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CHECKS_DIR = new URL("./checks/", import.meta.url).pathname;
// a check that hangs fails instead of holding the run (and its server) open
const CHECK_TIMEOUT = 5 * 60 * 1000;

const args = process.argv.slice(2);
const VALUED = ["--only", "--port", "--source"];
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
  console.error(`${problem}\nUsage: node scripts/editor-check/run.mjs [--only name[,name]] [--port N] [--source worktree|head] [--keep] [--update-baseline]`);
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

async function runCheck(name) {
  const dir = path.join(reportDir, name);
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
    workDir: WORK_DIR,
    options: { updateBaseline },
    axe: (options) => runAxe(ed.page, options),
    // another tab in the same browser context, with its own helpers
    newPage: open,
    log: (...parts) => console.log(`  ${name}:`, ...parts),
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
    results = [{ name: "runs without errors", pass: false, detail: [e.message, ...where].join(" ← ") }];
    await ed.screenshot("error").catch(() => {});
  } finally {
    await context.close().catch(() => {});
  }
  return { check: name, ms: Date.now() - start, results: results.map((r) => ({ name: r.name, pass: !!r.pass, detail: r.detail ?? "" })), pageErrors };
}

function printTable(report) {
  const rows = report.checks.flatMap((c) => c.results.map((r) => [r.pass ? "PASS" : "FAIL", c.check, r.name, String(r.detail).replace(/\s+/g, " ")]));
  const widths = [4, Math.max(5, ...rows.map((r) => r[1].length)), Math.max(6, ...rows.map((r) => r[2].length))];
  const line = (cells) => cells.map((c, i) => (i < 3 ? c.padEnd(widths[i]) : c.length > 110 ? `${c.slice(0, 107)}…` : c)).join("  ");
  console.log(`\n${line(["", "Check", "Result", "Detail"])}`);
  for (const row of rows) console.log(line(row));
  const failed = rows.filter((r) => r[0] === "FAIL").length;
  console.log(`\n${rows.length - failed} passed, ${failed} failed. Report: ${path.join(reportDir, "report.json")}`);
  return failed;
}

let failed = 1;
try {
  mkdirSync(reportDir, { recursive: true });
  scratch = await startScratch({ port, source, keep });
  // puppeteer's own signal handlers would exit before the server is stopped
  browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false });
  const report = { started: new Date().toISOString(), port, source, base: scratch.base, chrome: await browser.version(), checks: [] };
  for (const name of names) {
    if (interrupted) break;
    console.log(`Running ${name}…`);
    report.checks.push(await runCheck(name));
  }
  report.finished = new Date().toISOString();
  writeFileSync(path.join(reportDir, "report.json"), JSON.stringify(report, null, 2));
  failed = printTable(report);
  if (keep) console.log(`The site copy is kept at ${scratch.dir}`);
} catch (e) {
  console.error(`The run stopped: ${e.message}`);
  failed = 1;
} finally {
  await cleanup().catch((e) => console.error(`Couldn't stop cleanly: ${e.message}`));
}
process.exit(failed ? 1 : 0);
