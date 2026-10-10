// Spike B (WP-02): tries the deletion guard, undo, saving and recovery
// prototypes (prototypes.js) on a scratch copy of the site, next to what
// stock HAX does, and prints pass/fail per check, in Chrome and, if asked,
// Firefox and WebKit (lib/engines.mjs).
//   node scripts/editor-check/spikes/lifecycle/run.mjs --port 3105 --source head
//   --engines chrome,firefox,webkit   run every check in each (default chrome), on a fresh copy each
//   --only s3,s4,s5,s6   just these checks
//   --keep               keep the site copy afterwards
// Pass/fail rows are claims about the prototypes; "measured" rows record
// what stock HAX does, for docs/editor-spikes/lifecycle.md; SKIP rows are
// claims the engine can't be driven to (IME outside Chrome). The report
// goes to WORK_DIR/reports/<port>-lifecycle-<time>/. Exits 1 when a claim
// fails. Nothing here touches the real site: fixtures are written into the copy.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { startScratch, WORK_DIR, DEFAULT_PORT } from "../../lib/scratch.mjs";
import { editor } from "../../lib/editor.mjs";
import { ENGINES, SUPPORTS, launch } from "../../lib/engines.mjs";

const PROTOTYPES = readFileSync(new URL("./prototypes.js", import.meta.url), "utf8");
const CHECK_TIMEOUT = 10 * 60 * 1000;

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const port = Number(opt("--port", DEFAULT_PORT));
const source = opt("--source", "worktree");
const keep = args.includes("--keep");
const CHECKS = { s3: deletionGuard, s4: undo, s5: saving, s6: outlineSavesAndRecovery };
const names = opt("--only", Object.keys(CHECKS).join(",")).split(",").map((n) => n.trim()).filter(Boolean);
const unknown = names.filter((n) => !CHECKS[n]);
if (unknown.length) {
  console.error(`No such check: ${unknown.join(", ")} (there are: ${Object.keys(CHECKS).join(", ")})`);
  process.exit(2);
}
const engines = [...new Set(opt("--engines", "chrome").split(",").map((e) => e.trim()).filter(Boolean))];
const strange = engines.filter((e) => !ENGINES.includes(e));
if (strange.length || !engines.length) {
  console.error(`No such engine: ${strange.join(", ") || "(none)"} (there are: ${ENGINES.join(", ")})`);
  process.exit(2);
}

const stamp = new Date().toISOString().replace(/\.\d+Z$/, "").replace(/[-:]/g, "").replace("T", "-");
const reportDir = path.join(WORK_DIR, "reports", `${port}-lifecycle-${stamp}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- fixtures (written into the copy only) ---------- */

const SITE_SLUG = "up/dart-413";
const HUB_SLUG = "oer-courses";
// today's markup with text in it: written sections hold ul/li and p, and a
// paragraph sits between sections
const TEXT_PAGE = `<oer-cs-hero><p>Hero tagline text here</p></oer-cs-hero>
<oer-cs-facts></oer-cs-facts>
<oer-cs-learn><ul><li>Cut with confidence: plan and cut parts.</li><li>Print what you model: slice meshes.</li></ul></oer-cs-learn>
<oer-cs-semester></oer-cs-semester>
<oer-cs-people><p>A note from the instructor.</p></oer-cs-people>
<oer-cs-tools><ul><li>Laser cutter</li><li>Fusion 360</li></ul></oer-cs-tools>
<p>A paragraph between sections.</p>
<oer-cs-faq><h3>Do I need experience?</h3><p>No. Week 1 starts with safety.</p></oer-cs-faq>
<oer-cs-closing></oer-cs-closing>
`;
const OLD = "Old tagline from before the save";
const NEW = "New tagline typed just now";
const SAVE_PAGE = `<oer-cs-hero><p>${OLD}</p></oer-cs-hero>
<oer-cs-facts></oer-cs-facts>
<oer-cs-learn><ul><li>Cut with confidence: plan and cut parts.</li></ul></oer-cs-learn>
<oer-cs-people><p>A note from the instructor.</p></oer-cs-people>
<oer-cs-faq><h3>Do I need experience?</h3><p>No. Week 1 starts with safety.</p></oer-cs-faq>
<oer-cs-closing></oer-cs-closing>
`;

function pageFile(siteDir, slug) {
  const item = JSON.parse(readFileSync(path.join(siteDir, "site.json"), "utf8")).items.find((i) => i.slug === slug);
  return path.join(siteDir, "pages", item.id, "index.html");
}
const siteItem = (siteDir, slug) => JSON.parse(readFileSync(path.join(siteDir, "site.json"), "utf8")).items.find((i) => i.slug === slug);

/* ---------- in the page ---------- */

// select from one text offset to another in hax-body: [selector, index, offset or "end"]
function place({ from, to }) {
  const body = __ec.haxBody();
  const point = ([selector, index = 0, offset = 0]) => {
    const el = selector === ":scope > p" ? body.querySelectorAll(":scope > p")[index] : body.querySelectorAll(selector)[index];
    const text = [...el.childNodes].find((n) => n.nodeType === 3);
    if (!text) return [el, 0];
    return [text, offset === "end" ? text.length : offset];
  };
  const [a, ao] = point(from);
  const [b, bo] = to ? point(to) : [a, ao];
  // through the document's selection in WebKit, which has no ShadowRoot.getSelection()
  __ec.select(a, ao, b, bo);
  return __ec.selectionNodes(body).text;
}

function snapshot() {
  const body = __ec.haxBody();
  if (!body) return null;
  return {
    blocks: body.children.length,
    html: __lc.normalize(body.innerHTML),
    shape: [...body.children].map((c) => c.localName).join(" "),
  };
}

function pasteHtml({ text, html }) {
  const dt = new DataTransfer();
  dt.setData("text/plain", text);
  if (html) dt.setData("text/html", html);
  const target = __ec.activeElement() || __ec.haxBody();
  target.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true, composed: true }));
}

// two paragraphs outside the editor, selected for a real ⌘C (Firefox gives
// a synthetic ClipboardEvent's data to no one: getData() reads "")
function selectParagraphsToCopy() {
  const div = document.body.appendChild(document.createElement("div"));
  div.id = "lc-clip";
  div.innerHTML = "<p>First pasted</p><p>Second pasted</p>";
  const [a, b] = div.querySelectorAll("p");
  document.getSelection().setBaseAndExtent(a.firstChild, 0, b.firstChild, b.firstChild.length);
}

/**
 * The site's WP-03 stopgap (cs-shared.js keepEdges) cancels Backspace and
 * Delete at a section's edges on keydown, before any beforeinput. Off, what
 * S3 sees is HAX and the browser (stock) or the guard; on, the stopgap.
 */
function stopgapEdges(on) {
  for (const el of __ec.haxBody().children) {
    for (let p = Object.getPrototypeOf(el); p && p !== HTMLElement.prototype; p = Object.getPrototypeOf(p)) {
      if (!Object.prototype.hasOwnProperty.call(p, "keepEdges")) continue;
      p.__lcKeepEdges ??= p.keepEdges;
      p.keepEdges = on ? p.__lcKeepEdges : function () {};
      return true;
    }
  }
  return false;
}

// a drag can't be driven headless: the guard's answer to the event a drag
// across two sections would send, with the dragged text selected
function syntheticDragDelete() {
  const body = __ec.haxBody();
  const a = body.querySelectorAll("oer-cs-tools li")[1].firstChild;
  const b = body.querySelector(":scope > p").firstChild;
  __ec.select(a, 3, b, 5);
  const s = __ec.selectionNodes(body);
  const top = (n) => [...body.children].find((c) => c.contains(n));
  const range = new StaticRange({ startContainer: a, startOffset: 3, endContainer: b, endOffset: 5 });
  const e = new InputEvent("beforeinput", { inputType: "deleteByDrag", targetRanges: [range], bubbles: true, cancelable: true, composed: true });
  body.dispatchEvent(e);
  return {
    refused: e.defaultPrevented,
    // what the guard judged it by: "target ranges" when it carried them (read
    // after dispatch, getTargetRanges() is empty in every engine)
    judged: __lc.inputs.at(-1)?.judged,
    // WebKit keeps a selection set from script inside the block it starts in
    selected: __lc.inputs.at(-1)?.ranges[0] ?? "nothing",
    crossing: !!s.anchorNode && top(s.anchorNode) !== top(s.focusNode),
  };
}

// no IME can be driven outside Chrome: what an input method sends first
// (compositionstart, while the selection is still there), then its text,
// which the engine's insertText gives as an insertText beforeinput
function syntheticCompositionStart() {
  const target = __ec.activeElement() || __ec.haxBody();
  target.dispatchEvent(new CompositionEvent("compositionstart", { data: "", bubbles: true, composed: true }));
}

/**
 * Sample what's visible every 50 ms and every frame until stop() (or ms):
 * whether the old or the new tagline is on screen, and which view.
 */
function startSampler({ oldText, newText, ms = 30000 }) {
  const visible = (text) => {
    let found = false;
    const walk = (root) => {
      const tw = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
      for (let n = tw.currentNode; n && !found; n = tw.nextNode()) {
        if (n.nodeType === 3) {
          if (!n.data.includes(text)) continue;
          const el = n.parentElement;
          const r = el?.getBoundingClientRect();
          if (r && r.width > 0 && r.height > 0 && el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) found = true;
        } else if (n.shadowRoot) walk(n.shadowRoot);
      }
    };
    walk(__ec.theme());
    return found;
  };
  const store = __ec.store();
  const samples = [];
  const t0 = performance.now();
  const sample = (kind) =>
    samples.push({
      t: Math.round(performance.now() - t0),
      kind,
      editing: !!store.editMode,
      reading: !!__ec.theme().shadowRoot.querySelector("oer-course-site"),
      old: visible(oldText),
      new: visible(newText),
    });
  const timer = setInterval(() => sample("50 ms"), 50);
  let raf = requestAnimationFrame(function frame() {
    sample("frame");
    raf = requestAnimationFrame(frame);
  });
  let done;
  globalThis.__samples = new Promise((r) => (done = r));
  const stop = () => {
    clearInterval(timer);
    cancelAnimationFrame(raf);
    done(samples);
  };
  globalThis.__stopSampler = stop;
  setTimeout(stop, ms);
}

/** Runs of the same state, for the report: "0–1830 ms editing new (61)". */
function runsOf(samples) {
  const runs = [];
  for (const s of samples) {
    const key = `${s.reading ? "reading" : s.editing ? "editing" : "neither"} ${s.old && s.new ? "old+new" : s.old ? "OLD" : s.new ? "new" : "BLANK"}`;
    const last = runs[runs.length - 1];
    if (last?.key === key) {
      last.to = s.t;
      last.n++;
    } else runs.push({ key, from: s.t, to: s.t, n: 1 });
  }
  return runs.map((r) => `${r.from}–${r.to} ms ${r.key} (${r.n})`).join("; ");
}

/* ---------- the runner ---------- */

let scratch = null;
let browser = null;
async function cleanup() {
  await browser?.close().catch(() => {});
  await scratch?.stop().catch((e) => console.error(e.message));
}
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, async () => {
    console.error(`\n${signal}: stopping the server on port ${port}…`);
    await cleanup();
    process.exit(130);
  });
}

/**
 * A page with the prototypes installed (config switches parts off for a
 * stock measurement), the editor helpers, and HAX's "leave the editor?"
 * prompt answered, so pages can be reopened mid-edit.
 */
async function setup(context, dir, config = {}) {
  const page = await context.newPage();
  await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  page.on("dialog", (d) => d.accept().catch(() => {}));
  await page.evaluateOnNewDocument((c) => (globalThis.__lcConfig = c), config);
  await page.evaluateOnNewDocument(PROTOTYPES);
  const ed = editor(page, { base: scratch.base, siteDir: scratch.dir, reportDir: dir });
  await ed.setViewport(1440);
  return ed;
}

const withTimeout = (promise, ms, what) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`${what} took longer than ${ms / 1000} s`)), ms).unref())]);

async function runCheck(name, engine) {
  const dir = path.join(reportDir, engine, name);
  mkdirSync(dir, { recursive: true });
  const context = await browser.createBrowserContext();
  const results = [];
  const ctx = {
    siteDir: scratch.dir,
    dir,
    engine,
    supports: SUPPORTS[engine],
    newPage: (config) => setup(context, dir, config),
    claim: (n, pass, detail = "") => results.push({ name: n, pass: !!pass, detail }),
    measured: (n, detail) => results.push({ name: n, measured: true, detail }),
    // a claim this engine can't be driven to, shown as SKIP
    skip: (n, why) => results.push({ name: n, pass: true, skipped: true, detail: `skipped in ${engine}: ${why}` }),
    log: (...parts) => console.log(`  ${name} (${engine}):`, ...parts),
  };
  const start = Date.now();
  try {
    await withTimeout(CHECKS[name](ctx), CHECK_TIMEOUT, `The ${name} check`);
  } catch (e) {
    const where = (e.stack || "").split("\n").filter((l) => l.includes("/lifecycle/")).slice(0, 2).map((l) => l.trim());
    // something only Chrome can do (lib/engines.mjs) skips the rest of the check
    results.push({ name: "runs without errors", pass: !!e.skipped, skipped: !!e.skipped, detail: [e.message, ...where].join(" ← ") });
  } finally {
    await context.close().catch(() => {});
  }
  return { check: name, engine, ms: Date.now() - start, results };
}

function printTable(report) {
  const rows = report.checks.flatMap((c) => c.results.map((r) => ({ ...r, check: c.check, engine: c.engine })));
  const claims = rows.filter((r) => !r.measured);
  const width = Math.max(...claims.map((r) => r.name.length), 10);
  const cut = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
  const status = (r) => (r.skipped ? "SKIP" : r.pass ? "PASS" : "FAIL");
  console.log(`\n      Engine   Check  ${"Claim".padEnd(width)}  Detail`);
  for (const r of claims) console.log(`${status(r)}  ${r.engine.padEnd(7)}  ${r.check.padEnd(5)}  ${r.name.padEnd(width)}  ${cut(String(r.detail).replace(/\s+/g, " "), 140)}`);
  const measured = rows.filter((r) => r.measured);
  if (measured.length) {
    console.log("\nMeasured (stock HAX 26.8.1, for comparison):");
    for (const r of measured) console.log(`  ${r.engine.padEnd(7)}  ${r.check}  ${r.name}: ${cut(String(r.detail).replace(/\s+/g, " "), 220)}`);
  }
  const failed = claims.filter((r) => !r.pass).length;
  const skipped = claims.filter((r) => r.skipped).length;
  console.log(`\n${claims.length - failed - skipped} passed, ${failed} failed${skipped ? `, ${skipped} skipped` : ""}. Report: ${path.join(reportDir, "report.json")}`);
  return failed;
}

let failed = 1;
try {
  mkdirSync(reportDir, { recursive: true });
  const report = { started: new Date().toISOString(), port, source, engines, browsers: {}, checks: [] };
  // one engine at a time, each on a fresh copy: the checks write fixtures
  // into it and save to it
  for (const engine of engines) {
    browser = await launch(engine);
    report.browsers[engine] = await browser.version();
    scratch = await startScratch({ port, source, keep });
    for (const name of names) {
      console.log(`Running ${name} in ${engine}…`);
      report.checks.push(await runCheck(name, engine));
    }
    await browser.close().catch(() => {});
    browser = null;
    if (keep) console.log(`The site copy (${engine}'s) is kept at ${scratch.dir}`);
    await scratch.stop();
    scratch = null;
  }
  report.finished = new Date().toISOString();
  writeFileSync(path.join(reportDir, "report.json"), JSON.stringify(report, null, 2));
  failed = printTable(report);
} catch (e) {
  console.error(`The run stopped: ${e.message}`);
} finally {
  await cleanup();
}
process.exit(failed ? 1 : 0);

/* ---------- S3: the deletion guard ---------- */

/**
 * Each case runs twice on the same page: with the guard off (stock HAX and
 * Chrome) and on. The claim is about the guarded run; the stock outcome and
 * every beforeinput (type, target ranges, refusal) go in the detail.
 */
async function deletionGuard(ctx) {
  const dart = pageFile(ctx.siteDir, SITE_SLUG);
  const starter = readFileSync(dart, "utf8");
  const ed = await ctx.newPage({ recovery: false });
  const { page } = ed;
  const crossing = { from: ["oer-cs-hero p", 0, 5], to: ["oer-cs-learn li", 0, 4] };
  const selectedAll = [];
  const shiftDown = [];
  const cases = [
    { name: "Backspace at the start of the tagline changes nothing", edge: true, click: "oer-cs-hero p", at: { from: ["oer-cs-hero p", 0, 0] }, act: () => ed.press("Backspace") },
    { name: "Backspace at the start of a question keeps it in its section", edge: true, click: "oer-cs-faq h3", at: { from: ["oer-cs-faq h3", 0, 0] }, act: () => ed.press("Backspace") },
    { name: "Backspace at the start of an answer keeps it out of the question", click: "oer-cs-faq p", at: { from: ["oer-cs-faq p", 0, 0] }, act: () => ed.press("Backspace") },
    { name: "Backspace at the start of a paragraph between sections keeps it out of Tools", click: ":scope > p", at: { from: [":scope > p", 0, 0] }, act: () => ed.press("Backspace") },
    { name: "Delete at the end of the last tool keeps the paragraph after it", edge: true, click: "oer-cs-tools li", at: { from: ["oer-cs-tools li", 1, "end"] }, act: () => ed.press("Delete") },
    {
      name: "Shift+Down from Tools into the next block, then Backspace, changes nothing",
      click: "oer-cs-tools li",
      at: { from: ["oer-cs-tools li", 1, 3] },
      act: async () => {
        await page.keyboard.down("Shift");
        await page.keyboard.press("ArrowDown");
        await page.keyboard.press("ArrowDown");
        await page.keyboard.up("Shift");
        // Backspace outside the content isn't the guard's business, and
        // Playwright's WebKit goes back a page on it
        const where = await page.evaluate(() => {
          const s = __ec.selectionNodes(__ec.haxBody());
          const at = (n, o) => `${n?.nodeType === 3 ? n.parentElement?.localName : n?.localName}@${o}`;
          return { inside: __ec.within(__ec.activeElement(), __ec.haxBody()), focus: __ec.activeElement()?.localName, range: `${at(s.anchorNode, s.anchorOffset)} → ${at(s.focusNode, s.focusOffset)}` };
        });
        shiftDown.push(where.inside ? `selected ${where.range}` : `left the content (focus on ${where.focus}, selection ${where.range}), so Backspace wasn't pressed`);
        if (where.inside) await ed.press("Backspace");
      },
      note: () => `Shift+Down ${shiftDown.splice(0).join(" and ")} (stock, guarded)`,
    },
    { name: "A selection across two sections, then Delete, changes nothing", click: "oer-cs-hero p", at: crossing, act: () => ed.press("Delete") },
    { name: "A selection across two sections, then typing, changes nothing", click: "oer-cs-hero p", at: crossing, act: () => ed.type("x") },
    { name: "A selection across two sections, then Enter, changes nothing", click: "oer-cs-hero p", at: crossing, act: () => ed.press("Enter") },
    {
      name: "A selection across two sections, then Cut, changes nothing",
      click: "oer-cs-hero p",
      at: crossing,
      act: async () => {
        await page.keyboard.down("Meta");
        await page.keyboard.press("x", { commands: ["cut"] });
        await page.keyboard.up("Meta");
      },
    },
    {
      // as select all would, short of the page-break (Chrome's selectAll
      // command comes out empty headless, and selectAllChildren(hax-body)
      // starts in the page-break, where Backspace does nothing at all)
      name: "Selecting from the first text to the last, then Backspace, keeps the page",
      click: "oer-cs-people p",
      at: { from: ["oer-cs-hero p", 0, 0], to: ["oer-cs-faq p", 0, "end"] },
      act: () => ed.press("Backspace"),
    },
    ctx.supports.ime
      ? {
          name: "Composing (IME) over a selection across two sections keeps both",
          click: "oer-cs-hero p",
          at: crossing,
          act: async () => {
            const cdp = await page.createCDPSession();
            await cdp.send("Input.imeSetComposition", { text: "か", selectionStart: 1, selectionEnd: 1 });
            await cdp.send("Input.imeSetComposition", { text: "かな", selectionStart: 2, selectionEnd: 2 });
            await cdp.send("Input.insertText", { text: "仮名" });
            await cdp.detach();
          },
          keeps: (after) => after.html.includes("仮名"),
        }
      : {
          // the guard's half of it: compositionstart collapses the selection
          // before the text arrives (insertText would be refused, and lose it)
          name: "A compositionstart over a selection across two sections collapses it, and the text goes in (synthetic event)",
          click: "oer-cs-hero p",
          at: crossing,
          act: async () => {
            await page.evaluate(syntheticCompositionStart);
            await page.keyboard.sendCharacter("仮名");
          },
          keeps: (after) => after.html.includes("仮名"),
        },
    {
      name: "Pasting two paragraphs with the caret in a tool keeps the hero",
      click: "oer-cs-tools li",
      at: { from: ["oer-cs-tools li", 1, 3] },
      act: async () => {
        if (ctx.engine !== "firefox") return page.evaluate(pasteHtml, { text: "First pasted\n\nSecond pasted", html: "<p>First pasted</p><p>Second pasted</p>" });
        // a real ⌘C and ⌘V (Firefox's headless clipboard is its own, not the system's)
        await page.evaluate(selectParagraphsToCopy);
        await ed.press("Meta+c");
        await page.evaluate(() => document.getElementById("lc-clip").remove());
        await ed.clickAt("oer-cs-tools li");
        await page.evaluate(place, { from: ["oer-cs-tools li", 1, 3] });
        await ed.press("Meta+v");
      },
      keeps: (after) => after.html.includes("First pasted"),
      note: () => (ctx.engine === "firefox" ? "a real ⌘C of two paragraphs outside the editor, then ⌘V" : "a synthetic paste event with two HTML paragraphs"),
    },
    {
      name: "Deleting across two items of one list still works",
      click: "oer-cs-learn li",
      at: { from: ["oer-cs-learn li", 0, 5], to: ["oer-cs-learn li", 1, 4] },
      act: () => ed.press("Delete"),
      allowed: true,
    },
    // the collapsed-deletion rule mustn't catch ordinary deleting: each
    // engine has to give a deletion inside text a range that isn't collapsed
    { name: "Backspace inside a word still deletes a character", click: "oer-cs-hero p", at: { from: ["oer-cs-hero p", 0, 6] }, act: () => ed.press("Backspace"), allowed: true },
    { name: "Delete inside a word still deletes a character", click: "oer-cs-people p", at: { from: ["oer-cs-people p", 0, 4] }, act: () => ed.press("Delete"), allowed: true },
    { name: "Option+Backspace inside a sentence still deletes a word", click: "oer-cs-people p", at: { from: ["oer-cs-people p", 0, 10] }, act: () => ed.press("Alt+Backspace"), allowed: true },
    {
      // ⌘A: headless Chrome runs it as its selectAll editing command (which
      // has come out empty), Firefox and WebKit run the shortcut themselves
      name: "Select All, then Backspace, keeps the page",
      click: "oer-cs-people p",
      at: { from: ["oer-cs-people p", 0, 3] },
      act: async () => {
        if (ctx.supports.editingCommands) {
          await page.keyboard.down("Meta");
          await page.keyboard.press("a", { commands: ["selectAll"] });
          await page.keyboard.up("Meta");
        } else await ed.press("Meta+a");
        selectedAll.push(await page.evaluate(() => __ec.selectionNodes(__ec.haxBody()).text.length));
        await ed.press("Backspace");
      },
      keeps: () => true,
      unreachable: () => (selectedAll.every((n) => n === 0) ? "⌘A selected nothing (Chrome's selectAll command comes out empty headless): check in a real window" : ""),
      note: () => `⌘A selected ${selectedAll.join(" and ")} characters (stock, guarded)`,
    },
    { name: "Backspace in an empty outcome keeps its list", edge: true, fixture: starter, click: "oer-cs-learn", at: { from: ["oer-cs-learn li", 0, 0] }, act: () => ed.press("Backspace") },
    { name: "Backspace in the hub's empty intro keeps the page", edge: true, path: `/${HUB_SLUG}`, click: "oer-courses-intro", at: { from: ["oer-courses-intro p", 0, 0] }, act: () => ed.press("Backspace") },
  ];

  let opened = null;
  for (const c of cases) {
    const where = c.path || `/${SITE_SLUG}`;
    const fixture = c.path ? null : c.fixture || TEXT_PAGE;
    if (opened !== `${where}|${fixture}`) {
      if (fixture) writeFileSync(dart, fixture);
      await ed.open(where);
      opened = `${where}|${fixture}`;
    }
    const outcome = {};
    let unreachable = "";
    let lost = "";
    // at a section's edge, the site's stopgap on its own too
    for (const mode of c.edge ? ["stopgap", "stock", "guard"] : ["stock", "guard"]) {
      await page.evaluate((on) => (__lc.config.guard = on), mode === "guard");
      await ed.enterEdit();
      await page.evaluate(stopgapEdges, mode === "stopgap");
      if (c.click === ":scope > p") await ed.clickAt(await page.evaluateHandle(() => __ec.haxBody().querySelector(":scope > p")));
      else await ed.clickAt(c.click);
      await sleep(400);
      const before = await page.evaluate(snapshot);
      if (!before) {
        lost = `hax-body was gone after clicking ${c.click} (${mode}): ${JSON.stringify(await ed.state())}`;
        break;
      }
      await page.evaluate(() => (__lc.inputs.length = 0));
      if (c.at) await page.evaluate(place, c.at);
      // WebKit puts no caret where there's no box (an empty paragraph), and
      // Playwright's WebKit goes back a page on a Backspace outside the content
      const placed = await page.evaluate(() => {
        const body = __ec.haxBody();
        const node = __ec.selectionNodes(body).anchorNode;
        return !!node && body.contains(node);
      });
      if (!placed) {
        unreachable = `the caret can't be put at ${JSON.stringify(c.at?.from)} (it has no box here), so there's nothing to delete from`;
        await ed.exitEdit({ discard: true });
        break;
      }
      await page.evaluate(() => (globalThis.__lcSamePage = true));
      await c.act();
      await sleep(600);
      if (!(await page.evaluate(() => globalThis.__lcSamePage === true).catch(() => false))) {
        unreachable = "the key went back a page (Playwright's WebKit does that when the caret isn't in editable content), so the caret wasn't really there";
        await ed.open(where);
        break;
      }
      const after = await page.evaluate(snapshot);
      if (!after) {
        lost = `hax-body was gone afterwards (${mode}): ${JSON.stringify(await ed.state())}`;
        break;
      }
      const inputs = await page.evaluate(() => __lc.inputs.slice());
      outcome[mode] = { before, after, inputs, changed: before.html !== after.html };
      await ed.exitEdit({ discard: true });
    }
    if (lost) {
      ctx.claim(c.name, false, lost);
      await ed.open(where);
      continue;
    }
    unreachable ||= c.unreachable?.() ?? "";
    if (unreachable) {
      ctx.skip(c.name, unreachable);
      continue;
    }
    const { stock, guard } = outcome;
    const said = (o) =>
      o.inputs
        .map((i) => `${i.inputType}${i.ranges.length ? ` [${i.ranges.join(", ")}]` : ""}${i.judged && i.judged !== "target ranges" ? ` (no target ranges: ${i.judged})` : ""}${i.refused ? ` ${i.prevented || /^(paste|composition)/.test(i.inputType) && o === guard ? "refused" : "the guard would refuse"}: ${i.refused}` : ""}`)
        .join("; ") || "no beforeinput";
    const effect = (o) => (o.changed ? `changed (${o.before.blocks}→${o.after.blocks} blocks: ${o.after.shape})` : "unchanged");
    let pass;
    if (c.allowed) pass = guard.changed && guard.after.blocks === guard.before.blocks && !guard.inputs.some((i) => i.refused);
    else if (c.keeps) pass = guard.after.blocks === guard.before.blocks && guard.after.shape === guard.before.shape && c.keeps(guard.after);
    else pass = !guard.changed;
    ctx.claim(c.name, pass, `guarded: ${effect(guard)}, ${said(guard)} | stock: ${effect(stock)}, ${said(stock)}${c.note ? ` | ${c.note()}` : ""}`);
    if (outcome.stopgap) ctx.measured(`The WP-03 stopgap alone: ${c.name.replace(/ (changes nothing|keeps .*)$/, "")}`, `${effect(outcome.stopgap)}, ${said(outcome.stopgap)}`);
  }

  // a drag across sections, by the event it would send
  writeFileSync(dart, TEXT_PAGE);
  await ed.open(`/${SITE_SLUG}`);
  await page.evaluate(() => (__lc.config.guard = true));
  await ed.enterEdit();
  const drag = await page.evaluate(syntheticDragDelete);
  const dragClaim = "A drag that would delete across two sections is refused (synthetic event)";
  if (drag.judged !== "target ranges" && !drag.crossing) {
    ctx.skip(dragClaim, `the synthetic event can't describe it: its target ranges are dropped (WebKit's InputEvent constructor doesn't take them) and the selection set for it stayed in one block (${drag.selected}); check a real drag by hand`);
  } else {
    ctx.claim(dragClaim, drag.refused, `deleteByDrag from Tools into the paragraph after it, judged by its ${drag.judged}; a real drag can't be driven headless: check by hand`);
  }

  // Shift-click: HAX's _mouseDown activates the clicked block, which
  // collapses the selection, so it can't reach across sections
  const charAt = ([selector, index, offset]) => {
    const el = __ec.haxBody().querySelectorAll(selector)[index];
    const r = document.createRange();
    r.setStart(el.firstChild, offset);
    r.setEnd(el.firstChild, offset + 1);
    const box = r.getBoundingClientRect();
    return { x: box.left + 1, y: box.top + box.height / 2 };
  };
  await page.evaluate(() => __ec.haxBody().querySelector("oer-cs-people p").scrollIntoView({ block: "start" }));
  await sleep(300);
  const a = await page.evaluate(charAt, ["oer-cs-people p", 0, 5]);
  await page.mouse.click(a.x, a.y);
  await sleep(400);
  const b = await page.evaluate(charAt, ["oer-cs-tools li", 0, 4]);
  await page.keyboard.down("Shift");
  await page.mouse.click(b.x, b.y);
  await page.keyboard.up("Shift");
  await sleep(400);
  const sel = await ed.selection();
  ctx.measured("Shift-click across sections", sel.collapsed ? `doesn't extend the selection (it stays collapsed in ${sel.anchor?.tag}): HAX's _mouseDown re-activates the clicked block` : `selected "${sel.text.slice(0, 40)}"`);
  await ed.exitEdit({ discard: true });

  // arrow keys: hax-body's handler for them reads the caret through
  // HAXStore.getRange(), which the prototypes fix for WebKit (haxRange)
  const arrowed = {};
  for (const fixed of [false, true]) {
    await page.evaluate((on) => (__lc.config.haxRange = on), fixed);
    await ed.enterEdit();
    const steps = [];
    let kept = true;
    for (const [label, click, key, at] of [
      ["ArrowDown in a list", "oer-cs-learn li", "ArrowDown"],
      ["ArrowRight in a paragraph", "oer-cs-people p", "ArrowRight"],
      ["ArrowDown out of Tools", "oer-cs-tools li", "ArrowDown", { from: ["oer-cs-tools li", 1, 3] }],
    ]) {
      await ed.clickAt(click);
      await sleep(300);
      if (at) await page.evaluate(place, at);
      await page.keyboard.press(key);
      // HAX's handler runs in a setTimeout
      await sleep(300);
      const w = await page.evaluate(() => {
        const body = __ec.haxBody();
        const s = __ec.selectionNodes(body);
        const n = s.focusNode?.nodeType === 3 ? s.focusNode.parentElement : s.focusNode;
        return { inside: __ec.within(__ec.activeElement(), body) && !!n && body.contains(n), at: `${n?.localName}@${s.focusOffset}`, active: __ec.haxStore().activeNode?.localName, editable: body.getAttribute("contenteditable") };
      });
      kept &&= w.inside;
      steps.push(`${label}: ${w.inside ? `caret in ${w.at}` : `left the content (caret in ${w.at}; HAX's active node ${w.active}; hax-body contenteditable ${w.editable})`}`);
    }
    arrowed[fixed ? "fixed" : "stock"] = { kept, steps: steps.join(", ") };
    await ed.exitEdit({ discard: true });
  }
  ctx.claim("Arrow keys keep the caret in the content", arrowed.fixed.kept, `${arrowed.fixed.steps} | stock HAXStore.getRange(): ${arrowed.stock.steps}`);
  writeFileSync(dart, starter);
}

/* ---------- S4: undo and unsaved changes ---------- */

async function undo(ctx) {
  const dart = pageFile(ctx.siteDir, SITE_SLUG);
  const starter = readFileSync(dart, "utf8");
  writeFileSync(dart, TEXT_PAGE);
  const ed = await ctx.newPage({ recovery: false });
  const { page } = ed;
  const stack = () =>
    page.evaluate(() => {
      const b = __ec.haxBody();
      return { position: b.undoStack.undoStackPosition, steps: b.undoStack.commands.length, canUndo: b.undoStack.canUndo(), dirty: __lc.state.dirty, typed: b.querySelector("oer-cs-people p")?.textContent.includes("instructor.abc") };
    });
  const clickFive = async () => {
    for (const s of ["oer-cs-hero p", "oer-cs-learn li", "oer-cs-people p", "oer-cs-tools li", "oer-cs-faq h3"]) {
      await ed.clickAt(s);
      // past the undo manager's 300 ms debounce
      await sleep(450);
    }
  };
  const typeAbc = async () => {
    await ed.clickAt("oer-cs-people p");
    await page.evaluate(place, { from: ["oer-cs-people p", 0, "end"] });
    await ed.type("abc");
    await sleep(600);
  };
  const menuUndo = async () => {
    if (ctx.supports.editingCommands) {
      // the Edit menu's Undo: the browser's undo command, with no Z keydown
      await page.keyboard.press("Shift", { commands: ["undo"] });
    } else {
      // Firefox and WebKit run ⌘Z's undo command themselves, the one the
      // Edit menu sends: with the keydown routing off, ⌘Z reaches it
      await page.evaluate(() => (__lc.config.undoKeydown = false));
      await ed.press("Meta+z");
      await page.evaluate(() => (__lc.config.undoKeydown = true));
    }
    await sleep(600);
  };
  await ed.open(`/${SITE_SLUG}`);

  // stock: the undo wrapper and the keys off
  await page.evaluate(() => Object.assign(__lc.config, { undo: false, undoKeys: false }));
  await ed.enterEdit();
  await sleep(800);
  const s0 = await stack();
  await clickFive();
  const s1 = await stack();
  await typeAbc();
  const s2 = await stack();
  // what the browser's undo command sends (hax-body is the same element in both runs)
  await page.evaluate(() => {
    globalThis.__history = [];
    __ec.haxBody().addEventListener("beforeinput", (e) => /^history/.test(e.inputType) && __history.push(`${e.inputType}, cancelable ${e.cancelable}, prevented ${e.defaultPrevented}`));
  });
  await ed.press("Meta+z");
  await sleep(600);
  const s3 = await stack();
  const keyHistory = await page.evaluate(() => __history.splice(0));
  ctx.measured("Undo steps", `entering ${s0.steps}, five clicks ${s1.steps - s0.steps} more, typing ${s2.steps - s1.steps} more`);
  ctx.measured(
    "Meta+Z",
    s3.typed
      ? `does nothing (HAX only listens for Ctrl+Z)${keyHistory.length ? `; ${keyHistory.join("; ")}` : ""}`
      : `ran the browser's own undo (${keyHistory.join("; ") || "no beforeinput"}): it removed the typing natively, and HAX recorded ${s3.steps - s2.steps} new step(s) for it`,
  );
  if (ctx.supports.editingCommands) {
    await menuUndo();
    const s4 = await stack();
    const history = await page.evaluate(() => __history);
    ctx.measured("The browser's Undo command", `${history.join("; ") || "no beforeinput"}; it ${s4.typed ? "left the typing" : "removed the typing natively"} and HAX recorded ${s4.steps - s3.steps} new step(s) for it`);
  } else ctx.measured("The browser's Undo command", "the same command as ⌘Z here, which the browser runs itself: see Meta+Z");
  await ed.exitEdit({ discard: true });

  // the prototypes
  await page.evaluate(() => Object.assign(__lc.config, { undo: true, undoKeys: true }));
  await ed.enterEdit();
  await sleep(800);
  const p0 = await stack();
  ctx.claim("Entering edit mode adds no undo step", p0.steps === 0 && !p0.canUndo, `${p0.steps} steps (stock ${s0.steps})`);
  await clickFive();
  const p1 = await stack();
  ctx.claim("Clicking five blocks adds no undo step", p1.steps === 0 && !p1.canUndo, `${p1.steps} steps, ${await page.evaluate(() => __lc.undoSkipped)} snapshots skipped as unchanged (stock ${s1.steps - s0.steps} steps)`);
  const dirtyAfterClicks = p1.dirty;
  await typeAbc();
  const p2 = await stack();
  ctx.claim("Typing adds one undo step", p2.typed && p2.steps === 1 && p2.position === 0, `${p2.steps} step, position ${p2.position}`);
  await ed.press("Meta+z");
  await sleep(600);
  const p3 = await stack();
  ctx.claim("Meta+Z undoes the typing through HAX's undo", !p3.typed && p3.position === p2.position - 1, `position ${p2.position}→${p3.position}; ${await page.evaluate(() => __lc.undoRouted.join(", "))}`);
  await ed.press("Meta+Shift+z");
  await sleep(600);
  const p4 = await stack();
  ctx.claim("Meta+Shift+Z redoes it", p4.typed && p4.position === p2.position, `position ${p3.position}→${p4.position}`);
  await page.evaluate(() => (globalThis.__history = []));
  await menuUndo();
  const p5 = await stack();
  ctx.claim(
    "The browser's own Undo command goes to HAX's undo",
    !p5.typed && p5.position === p4.position - 1 && p5.steps === p4.steps,
    `${(await page.evaluate(() => __history)).join("; ")}; position ${p4.position}→${p5.position}, ${p5.steps} steps`,
  );
  ctx.claim(
    "Unsaved changes follows the content, not the undo position",
    !p0.dirty && !dirtyAfterClicks && p2.dirty && !p3.dirty && p4.dirty && !p5.dirty,
    `entering ${p0.dirty}, clicks ${dirtyAfterClicks}, typing ${p2.dirty}, undo ${p3.dirty}, redo ${p4.dirty}, undo ${p5.dirty}`,
  );
  await ed.exitEdit({ discard: true });
  writeFileSync(dart, starter);
}

/* ---------- S5: saving without leaving edit mode ---------- */

async function saving(ctx) {
  const dart = pageFile(ctx.siteDir, SITE_SLUG);
  const starter = readFileSync(dart, "utf8");
  const orderBefore = siteItem(ctx.siteDir, SITE_SLUG).order;
  const typeNewTagline = async (ed) => {
    await ed.clickAt("oer-cs-hero p");
    await ed.page.evaluate(place, { from: ["oer-cs-hero p", 0, 0], to: ["oer-cs-hero p", 0, "end"] });
    await ed.type(NEW);
    await sleep(500);
  };
  const tagline = (ed) => ed.page.evaluate(() => __ec.haxBody().querySelector("oer-cs-hero p")?.textContent ?? null);

  // stock: the theme's Save (HAX's toggle leaves edit mode, then saves)
  {
    writeFileSync(dart, SAVE_PAGE);
    const ed = await ctx.newPage({ recovery: false });
    await ed.open(`/${SITE_SLUG}`);
    await ed.enterEdit();
    await typeNewTagline(ed);
    await ed.page.evaluate(startSampler, { oldText: OLD, newText: NEW, ms: 10000 });
    await ed.clickAt(await ed.control(/^save$/i));
    const samples = await ed.page.evaluate(() => globalThis.__samples);
    const old = samples.filter((s) => s.old && !s.new);
    ctx.measured("Stock Save", `the old tagline showed in ${old.length} of ${samples.length} samples, ${old.length ? `${old[0].t}–${old[old.length - 1].t} ms after Save` : ""}: ${runsOf(samples)}`);
    await ed.page.close();
  }

  // the prototype: save, hold the edited page, land on the reading view
  {
    writeFileSync(dart, SAVE_PAGE);
    const ed = await ctx.newPage({ recovery: false });
    const { page } = ed;
    await ed.open(`/${SITE_SLUG}`);
    await ed.enterEdit();
    await typeNewTagline(ed);
    // the theme's __beforeSave wraps hax-body's haxToContent for the save
    // (to keep the page's stored order): note when it does
    await page.evaluate(() => {
      const body = __ec.haxBody();
      globalThis.__themeHook = 0;
      let current;
      Object.defineProperty(body, "haxToContent", {
        configurable: true,
        get: () => current ?? Object.getPrototypeOf(body).haxToContent,
        set(v) {
          if (/stored\.order|order=/.test(String(v))) globalThis.__themeHook++;
          current = v;
        },
      });
    });
    await page.evaluate(startSampler, { oldText: OLD, newText: NEW, ms: 30000 });
    const started = Date.now();
    const result = await page.evaluate(() => __lc.savePage());
    // a second of the reading view, and at least 5 s in all
    await sleep(Math.max(1000, 5500 - (Date.now() - started)));
    await page.evaluate(() => __stopSampler());
    const samples = await page.evaluate(() => globalThis.__samples);
    const every50 = samples.filter((s) => s.kind === "50 ms");
    const stale = samples.filter((s) => s.old);
    const blank = samples.filter((s) => !s.old && !s.new);
    const window = samples.length ? samples[samples.length - 1].t : 0;
    ctx.claim(
      "Save never shows the old tagline",
      result.ok && !stale.length && window >= 5000,
      `${every50.length} samples every 50 ms and ${samples.length - every50.length} every frame over ${window} ms, ${stale.length} with the old tagline: ${runsOf(samples)}`,
    );
    ctx.claim("Save never shows a blank page", !blank.length, `${blank.length} samples with neither tagline`);
    const landed = await page.evaluate(() => ({ editing: __ec.store().editMode, reading: !!__ec.theme().shadowRoot.querySelector("oer-course-site") }));
    ctx.claim("Save lands on the reading view of the saved page", result.ok && !landed.editing && landed.reading && samples[samples.length - 1].new, `timings (ms after Save): ${JSON.stringify(result.timings)}`);
    const hero = /<oer-cs-hero>.*?<\/oer-cs-hero>/s.exec(readFileSync(dart, "utf8"))?.[0] ?? "no hero";
    ctx.claim("The saved file has the new tagline", hero.includes(NEW), hero);
    const hook = await page.evaluate(() => globalThis.__themeHook);
    const orderAfter = siteItem(ctx.siteDir, SITE_SLUG).order;
    ctx.claim("The theme's save hook still runs first", hook >= 1 && orderAfter === orderBefore, `__beforeSave wrapped haxToContent ${hook}×; the page's stored order ${orderBefore}→${orderAfter}`);
    await page.close();
  }

  // the same without the sampler, for how long "Saving…" lasts
  {
    writeFileSync(dart, SAVE_PAGE);
    const ed = await ctx.newPage({ recovery: false });
    await ed.open(`/${SITE_SLUG}`);
    await ed.enterEdit();
    await typeNewTagline(ed);
    const result = await ed.page.evaluate(() => __lc.savePage());
    ctx.measured("Saving… lasts", `${result.timings.reading} ms from Save to the reading view (HAX answered at ${result.timings.response} ms, reloaded by ${result.timings.refreshed} ms; it tried ${result.timings.importsHeld || 0} imports into the editor meanwhile)`);
    await ed.page.close();
  }

  // failures: an error, then no answer
  for (const failure of ["500", "no answer"]) {
    writeFileSync(dart, SAVE_PAGE);
    const ed = await ctx.newPage({ recovery: false });
    const { page } = ed;
    const held = [];
    let failing = true;
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      if (req.isInterceptResolutionHandled()) return;
      if (failing && req.method() === "PATCH" && /\/x\/api\/v1\/content\//.test(req.url())) {
        if (failure === "500") return req.respond({ status: 500, contentType: "application/json", body: JSON.stringify({ status: 500, message: "Simulated failure" }) });
        held.push(req);
        return;
      }
      req.continue();
    });
    await ed.open(`/${SITE_SLUG}`);
    await ed.enterEdit();
    await typeNewTagline(ed);
    const t = Date.now();
    const result = await page.evaluate(() => __lc.savePage());
    const after = await page.evaluate(() => ({ editing: __ec.store().editMode, inert: __ec.haxBody().inert, status: __lc.state.status, focus: __ec.describe(__ec.activeElement())?.tag }));
    const kept = (await tagline(ed)) === NEW;
    if (failure === "500") {
      ctx.claim("A save answered with 500 keeps editing with every edit", !result.ok && after.editing && !after.inert && kept && /^Couldn't save: 500/.test(after.status), `${after.status} (after ${Date.now() - t} ms); focus on ${after.focus}`);
      failing = false;
      const again = await page.evaluate(() => __lc.savePage());
      ctx.claim("Try again saves once the server answers", again.ok && readFileSync(dart, "utf8").includes(NEW), `reading view after ${again.timings?.reading} ms`);
    } else {
      ctx.claim(
        "No answer in 20 s keeps editing with every edit and the caret",
        !result.ok && result.timedOut && after.editing && !after.inert && kept && after.focus === "hax-body" && Date.now() - t >= 20000,
        `${after.status} (after ${Date.now() - t} ms); focus on ${after.focus}`,
      );
      // more typing, then the late answer arrives
      await ed.type(" and more");
      await sleep(500);
      failing = false;
      held.forEach((req) => req.continue());
      await ed.waitFor(() => /^(Saved|Unsaved)/.test(__lc.state.status), { timeout: 20000, what: "the late answer" });
      await sleep(4000);
      const late = await page.evaluate(() => ({ status: __lc.state.status, editing: __ec.store().editMode, text: __ec.haxBody().querySelector("oer-cs-hero p")?.textContent }));
      ctx.claim(
        "A late answer keeps what was typed after the timeout",
        late.editing && late.text === `${NEW} and more` && late.status === "Unsaved changes" && readFileSync(dart, "utf8").includes(NEW),
        `${late.status}; the editor has "${late.text}"; the file has the tagline from the first save`,
      );
    }
    await page.close();
  }

  // measured: HAX's own "save and keep editing" (keepEditMode)
  {
    writeFileSync(dart, SAVE_PAGE);
    const ed = await ctx.newPage({ recovery: false, undo: false, guard: false });
    const { page } = ed;
    await ed.open(`/${SITE_SLUG}`);
    await ed.enterEdit();
    await ed.clickAt("oer-cs-people p");
    await page.evaluate(place, { from: ["oer-cs-people p", 0, 2] });
    await ed.type("x");
    await typeNewTagline(ed);
    const before = await page.evaluate(() => {
      const b = __ec.haxBody();
      b.children[1].__lcMark = true;
      return { steps: b.undoStack.commands.length, focus: __ec.describe(__ec.activeElement())?.tag, active: __ec.haxStore().activeNode?.localName };
    });
    await page.evaluate(startSampler, { oldText: OLD, newText: NEW, ms: 9000 });
    await page.evaluate(() => globalThis.dispatchEvent(new CustomEvent("haxcms-save-node", { bubbles: true, composed: true, detail: { ...JSON.parse(JSON.stringify(__ec.store().activeItem)), keepEditMode: true } })));
    const samples = await page.evaluate(() => globalThis.__samples);
    const after = await page.evaluate(() => {
      const b = __ec.haxBody();
      return { steps: b.undoStack.commands.length, sameNodes: b.children[1]?.__lcMark === true, focus: __ec.describe(__ec.activeElement())?.tag, active: __ec.haxStore().activeNode?.localName, editing: __ec.store().editMode };
    });
    ctx.measured(
      "HAX's keepEditMode save",
      `old tagline in ${samples.filter((s) => s.old).length} samples, the reading view in ${samples.filter((s) => s.reading).length}, blank in ${samples.filter((s) => !s.old && !s.new).length}; the editor was re-imported (${after.sameNodes ? "no" : "yes"}); undo steps ${before.steps}→${after.steps}; focus ${before.focus}→${after.focus}, selected ${before.active}→${after.active}: ${runsOf(samples)}`,
    );
    await page.close();
  }
  writeFileSync(dart, starter);
}

/* ---------- S6: Style and Page details saves mid-edit, and recovery ---------- */

async function outlineSavesAndRecovery(ctx) {
  const dart = pageFile(ctx.siteDir, SITE_SLUG);
  const starter = readFileSync(dart, "utf8");
  const MARK = " TYPED BEFORE THE OUTLINE SAVE";
  const typeMarker = async (ed) => {
    await ed.clickAt("oer-cs-hero p");
    await ed.page.evaluate(place, { from: ["oer-cs-hero p", 0, "end"] });
    await ed.type(MARK);
    await sleep(600);
    await ed.page.evaluate(() => {
      const b = __ec.haxBody();
      for (const el of b.children) el.__lcMark = true;
      // count the imports that reach hax-body, and who made them
      globalThis.__imports = 0;
      globalThis.__importers = new Set();
      const importContent = b.importContent;
      b.importContent = function (...a) {
        __imports++;
        __importers.add(/_bodyChanged/.test(new Error().stack) ? "the site editor's _bodyChanged" : "another caller");
        return importContent.apply(this, a);
      };
    });
    return ed.page.evaluate(() => __ec.haxBody().undoStack.commands.length);
  };
  // an outline save the way the Style sheet and Page details make it
  const outlineSave = (ed, kind, hold) =>
    ed.page.evaluate(
      async (kind, hold) => {
        const store = __ec.store();
        const items = store.manifest.items;
        const site = JSON.parse(JSON.stringify(items.find((i) => i.slug === "up/dart-413")));
        const course = JSON.parse(JSON.stringify(items.find((i) => i.id === site.metadata.oerFields.course[0].page)));
        const release = hold ? __lc.holdImportsNow() : () => 0;
        const before = store.manifest;
        if (kind === "style") {
          const sheet = document.querySelector("oer-site-style") || document.body.appendChild(document.createElement("oer-site-style"));
          sheet.show(site);
          sheet._set({ scheme: site.metadata.oerSiteStyle?.scheme === "studio" ? "graphite" : "studio" });
          await sheet._save();
        } else {
          const details = document.querySelector("oer-page-details") || document.body.appendChild(document.createElement("oer-page-details"));
          details.show(kind === "course field" ? course.id : site.id, { section: kind === "description" ? "general" : "details" });
          await new Promise((r) => setTimeout(r, 300));
          if (kind === "course field") details._values = { ...details._values, credits: details._values.credits === "3" ? "4" : "3" };
          if (kind === "enroll link") details._values = { ...details._values, enrollUrl: `https://example.edu/enroll/${Date.now()}` };
          if (kind === "description") details._desc = `Described mid-edit at ${Date.now()}`;
          await details._save();
        }
        // HAX reloads the manifest and the page 300 ms after its answer
        const t = performance.now();
        while (store.manifest === before && performance.now() - t < 15000) await new Promise((r) => setTimeout(r, 100));
        await new Promise((r) => setTimeout(r, 2500));
        const held = release();
        const b = __ec.haxBody();
        return {
          typed: b.querySelector("oer-cs-hero p")?.textContent.includes(" TYPED BEFORE THE OUTLINE SAVE"),
          sameNodes: [...b.children].every((el) => el.__lcMark),
          steps: b.undoStack.commands.length,
          imports: globalThis.__imports,
          importers: [...globalThis.__importers].join(", "),
          held,
          description: kind === "description" ? store.activeItem.description : null,
        };
      },
      kind,
      hold,
    );
  const ed = await ctx.newPage({});
  const savedOf = () => {
    const site = siteItem(ctx.siteDir, SITE_SLUG);
    const course = JSON.parse(readFileSync(path.join(ctx.siteDir, "site.json"), "utf8")).items.find((i) => i.id === site.metadata.oerFields.course[0].page);
    return { style: site.metadata.oerSiteStyle?.scheme, enroll: site.metadata.oerFields?.enrollUrl, credits: course.metadata.oerFields.credits, description: site.description };
  };

  // stock: nothing held
  for (const kind of ["style", "course field"]) {
    writeFileSync(dart, SAVE_PAGE);
    await ed.open(`/${SITE_SLUG}`);
    await ed.enterEdit();
    const steps = await typeMarker(ed);
    const out = await outlineSave(ed, kind, false);
    ctx.measured(`A ${kind === "style" ? "Style" : "Page details (course credits)"} save mid-edit, stock`, `HAX re-imported the page into the editor ${out.imports}× (${out.importers}, on json-outline-schema-active-body-changed); typed text ${out.typed ? "kept" : "lost"}; undo steps ${steps}→${out.steps}`);
    await ed.exitEdit({ discard: true });
  }

  // the prototype: imports held while the outline saves and HAX reloads
  for (const kind of ["style", "course field", "enroll link"]) {
    writeFileSync(dart, SAVE_PAGE);
    await ed.open(`/${SITE_SLUG}`);
    await ed.enterEdit();
    const savedBefore = savedOf();
    const steps = await typeMarker(ed);
    const out = await outlineSave(ed, kind, true);
    const savedAfter = savedOf();
    const field = { style: "style", "course field": "credits", "enroll link": "enroll" }[kind];
    ctx.claim(
      `Typed text survives a ${{ style: "Style save", "course field": "Page details save of the course", "enroll link": "Page details save of the course site" }[kind]}`,
      out.typed && out.sameNodes && out.steps === steps && savedAfter[field] !== savedBefore[field],
      `${out.held} imports held, ${out.imports} let through; same elements: ${out.sameNodes}; undo steps ${steps}→${out.steps}; saved ${field}: ${savedBefore[field]}→${savedAfter[field]}`,
    );
    await ed.exitEdit({ discard: true });
  }

  // a page save after Page details changed the description mid-edit:
  // first as HAX serializes it, then with the page-break's details fresh
  for (const fresh of [false, true]) {
    writeFileSync(dart, SAVE_PAGE);
    await ed.open(`/${SITE_SLUG}`);
    await ed.page.evaluate((on) => (__lc.config.freshDetails = on), fresh);
    await ed.enterEdit();
    await typeMarker(ed);
    const began = await ed.page.evaluate(() => __ec.store().activeItem.description);
    const out = await outlineSave(ed, "description", true);
    const result = await ed.page.evaluate(() => __lc.savePage());
    const saved = savedOf();
    if (fresh) {
      ctx.claim(
        "A page save after a mid-edit Page details save keeps the new details",
        result.ok && saved.description === out.description && readFileSync(dart, "utf8").includes(MARK.trim()),
        `site.json description "${saved.description}" (set mid-edit: "${out.description}")`,
      );
    } else {
      ctx.measured("A page save after a mid-edit Page details save, as HAX serializes it", `site.json description went back to "${saved.description}" (set mid-edit: "${out.description}", before: "${began}"): the saved page-break still had the details from when editing began`);
    }
  }

  // recovery: HAX's sessionStorage copy, restored by us, once
  {
    writeFileSync(dart, SAVE_PAGE);
    const page = ed.page;
    await page.evaluateOnNewDocument(() => {
      globalThis.__toasts = [];
      addEventListener("haxcms-toast-show", (e) => __toasts.push(e.detail?.text), true);
      globalThis.__offers = [];
      addEventListener("lc-restore-offered", (e) => __offers.push(e.detail), true);
    });
    await ed.open(`/${SITE_SLUG}`);
    await ed.enterEdit();
    await ed.clickAt("oer-cs-hero p");
    await page.evaluate(place, { from: ["oer-cs-hero p", 0, "end"] });
    await ed.type(" RECOVER ME");
    await sleep(2800);
    const copy = await page.evaluate(() => JSON.parse(sessionStorage.getItem("haxcms-pending-edit") || "null"));
    ctx.claim("Unsaved edits are copied for recovery within 2 s", copy?.content?.includes("RECOVER ME"), copy ? `sessionStorage haxcms-pending-edit for ${copy.itemId}` : "no copy");
    await ed.open(`/${SITE_SLUG}`);
    const reloaded = await page.evaluate(() => ({ copy: !!sessionStorage.getItem("haxcms-pending-edit"), hax: __ec.store().cmsSiteEditor.instance.__pendingRestore, ours: !!__lc.recovered, toasts: __toasts }));
    await ed.enterEdit();
    await sleep(1200);
    const entered = await page.evaluate(() => ({ text: __ec.haxBody().querySelector("oer-cs-hero p")?.textContent, offers: __offers.length, dirty: __lc.state.dirty }));
    ctx.claim(
      "After a reload HAX doesn't restore them by itself",
      reloaded.copy && reloaded.hax === null && reloaded.ours && !entered.text.includes("RECOVER ME"),
      `HAX's __pendingRestore reads ${reloaded.hax}; our copy held: ${reloaded.ours}; HAX said "${reloaded.toasts[0] || ""}"`,
    );
    ctx.claim("Entering edit mode offers the copy", entered.offers === 1 && !entered.dirty, `${entered.offers} offer; No changes until it's restored`);
    await page.evaluate(() => __lc.restore());
    await sleep(1500);
    const restored = await page.evaluate(() => ({ text: __ec.haxBody().querySelector("oer-cs-hero p")?.textContent, status: __lc.state.status, steps: __ec.haxBody().undoStack.commands.length }));
    ctx.claim("Restore brings them back as one undo step, reading Unsaved changes", restored.text.includes("RECOVER ME") && restored.status === "Unsaved changes" && restored.steps === 1, `${restored.status}; ${restored.steps} undo step`);
    const result = await page.evaluate(() => __lc.savePage());
    ctx.claim(
      "Saving clears the copy",
      result.ok && !(await page.evaluate(() => sessionStorage.getItem("haxcms-pending-edit"))) && readFileSync(dart, "utf8").includes("RECOVER ME"),
      "the saved file has the restored text",
    );
  }

  // measured: HAX's own restore
  {
    writeFileSync(dart, SAVE_PAGE);
    const stock = await ctx.newPage({ recovery: false });
    await stock.open(`/${SITE_SLUG}`);
    await stock.enterEdit();
    await stock.clickAt("oer-cs-hero p");
    await stock.page.evaluate(place, { from: ["oer-cs-hero p", 0, "end"] });
    await stock.type(" RECOVER ME");
    await sleep(600);
    // HAX writes its copy only when a session ends; ask it to
    await stock.page.evaluate(() => __ec.store().cmsSiteEditor.instance._snapshotPendingEditForLogout());
    await stock.open(`/${SITE_SLUG}`);
    await stock.enterEdit();
    await sleep(1200);
    const out = await stock.page.evaluate(() => ({ text: __ec.haxBody().querySelector("oer-cs-hero p")?.textContent, dirty: __lc.state.dirty, steps: __ec.haxBody().undoStack.commands.length }));
    ctx.measured("HAX's own restore", `applied without asking: ${out.text.includes("RECOVER ME")}; a baseline taken after it reads ${out.dirty ? "Unsaved changes" : "No changes"}; ${out.steps} undo steps`);
    await stock.page.close();
  }
  writeFileSync(dart, starter);
}
