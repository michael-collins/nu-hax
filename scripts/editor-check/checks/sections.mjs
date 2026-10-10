// Every course-site and hub section on the section and item model (WP-08):
// what readers see of each (and no author callout among it); the tools and
// the questions as items, typed with the keys What you'll learn has; the
// generated sections' callouts, which say where their content comes from
// and open it (Page details at that field); a click on a generated value
// selects its section; the hero's Change image; the hub's catalog reading
// the hero after a save, with cards that aren't links while editing; the
// migration script on the copy's own pages (a diff, --apply, and nothing
// the second time); and a new course site made with the new starter.
//
// Fixtures are written into the copy's pages and put back at the end. Parts
// save the course site, run the migration and make a course site in the
// copy (the made one is deleted again).
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFile } from "node:child_process";
import path from "node:path";
import { readBaseline, newViolations } from "../lib/axe.mjs";
import { SITE as SOURCE } from "../lib/scratch.mjs";
import { connect } from "../../lib/hax-api.mjs";

export const SITE_ID = "item-0330a29b-7735-4ac0-afd2-e3b2a88d49e3";
export const HUB_ID = "item-417a2d47-2196-42b8-acae-bb0202f18fae";
export const SCRIPT = new URL("../../course-site-structure.mjs", import.meta.url).pathname;
// a course without a course plan, for a site of its own
const PLANLESS_CODE = "DMD 300";
// mirrors COURSE_SITE_STARTER in custom/src/types/course-site.js
const STARTER = [
  "<oer-cs-hero><p></p></oer-cs-hero>",
  "<oer-cs-facts></oer-cs-facts>",
  "<oer-cs-learn><oer-cs-outcome><h3></h3><p></p></oer-cs-outcome></oer-cs-learn>",
  "<oer-cs-semester></oer-cs-semester>",
  "<oer-cs-make></oer-cs-make>",
  "<oer-cs-books></oer-cs-books>",
  "<oer-cs-people><p></p></oer-cs-people>",
  "<oer-cs-tools><oer-cs-tool><p></p></oer-cs-tool></oer-cs-tools>",
  "<oer-cs-faq><oer-cs-question><h3></h3><p></p></oer-cs-question></oer-cs-faq>",
  "<oer-cs-closing></oer-cs-closing>",
].join("\n");

// every section, with what's written in it
export const FULL_PAGE = `<oer-cs-hero><p>Design it on screen, then make it real.</p></oer-cs-hero>
<oer-cs-facts></oer-cs-facts>
<oer-cs-learn><h2>What you'll be able to do</h2><oer-cs-outcome><h3>Cut with confidence</h3><p>Plan, cut and finish parts.</p></oer-cs-outcome><oer-cs-outcome><h3>Print what you model</h3><p>Slice meshes for FDM.</p></oer-cs-outcome></oer-cs-learn>
<oer-cs-semester><h2>Fifteen weeks, three projects</h2></oer-cs-semester>
<oer-cs-make></oer-cs-make>
<oer-cs-books></oer-cs-books>
<oer-cs-people><h2>Who teaches it</h2><p>A note from the instructor.</p></oer-cs-people>
<oer-cs-tools><h2>In the shop</h2><oer-cs-tool><p>Epilog Fusion Pro laser cutter</p></oer-cs-tool><oer-cs-tool><p><a href="https://www.autodesk.com/fusion">Fusion 360</a></p></oer-cs-tool></oer-cs-tools>
<oer-cs-faq><h2>Questions</h2><oer-cs-question><h3>Do I need experience with machines?</h3><p>No. Week 1 starts with safety.</p><ul><li>Bring closed shoes.</li></ul></oer-cs-question><oer-cs-question><h3>Is it online?</h3><p>No, in the studio.</p></oer-cs-question></oer-cs-faq>
<oer-cs-closing></oer-cs-closing>
`;
const HUB_PAGE = `<oer-courses-intro><p>Courses you can take, by degree.</p></oer-courses-intro>
<oer-courses-catalog></oer-courses-catalog>
`;

/* ---------- in the page ---------- */

// what a block shows, as text: its shadow DOM and what's slotted in it,
// drawn things only (not a closed question's answer), a space between
// blocks
function shownText(el) {
  const out = [];
  const visit = (node) => {
    if (node.nodeType === 3) {
      out.push(node.data);
      return;
    }
    if (node.nodeType !== 1 || ["style", "script", "svg", "template"].includes(node.localName)) return;
    const { display } = getComputedStyle(node);
    // (slots and wrappers drawn as their contents have no box of their own)
    if (display !== "contents" && !node.checkVisibility({ checkVisibilityCSS: true })) return;
    const block = !/^(inline|contents)$/.test(display);
    if (block) out.push(" ");
    if (node.localName === "slot") {
      const assigned = node.assignedNodes();
      for (const n of assigned.length ? assigned : node.childNodes) visit(n);
    } else if (node.localName === "details" && !node.open) {
      // a closed details shows its summary only
      const summary = [...node.children].find((c) => c.localName === "summary");
      if (summary) visit(summary);
    } else for (const n of node.shadowRoot ? node.shadowRoot.childNodes : node.childNodes) visit(n);
    if (block) out.push(" ");
  };
  visit(el);
  return out.join("").replace(/\s+/g, " ").trim();
}

export default async function sections(ctx) {
  const { page } = ctx;
  const results = [];
  const check = (name, pass, detail = "") => results.push({ name, pass: !!pass, detail });
  const json = (v) => JSON.stringify(v);
  page.on("dialog", (d) => d.accept().catch(() => {}));
  const part = async (name, fn) => {
    const start = Date.now();
    try {
      await fn();
    } catch (e) {
      check(`${name}: runs without errors`, false, e.message.split("\n")[0]);
      await ctx.screenshot(`error-${name}`).catch(() => {});
    }
    ctx.log(`${name} took ${((Date.now() - start) / 1000).toFixed(1)} s`);
  };

  /* ---------- fixtures, in the copy only ---------- */

  const siteJson = () => JSON.parse(readFileSync(path.join(ctx.siteDir, "site.json"), "utf8")).items;
  const items = siteJson();
  const byId = new Map(items.map((i) => [i.id, i]));
  const SITE = `/${byId.get(SITE_ID).slug}`;
  const HUB = `/${byId.get(HUB_ID).slug}`;
  const fileOf = (id) => path.join(ctx.siteDir, "pages", id, "index.html");
  const original = { [SITE_ID]: readFileSync(fileOf(SITE_ID), "utf8"), [HUB_ID]: readFileSync(fileOf(HUB_ID), "utf8") };
  const write = (id, html) => writeFileSync(fileOf(id), html);
  let made = null;

  // what the generated sections draw from: the course and its plan
  const refIds = (v) => (Array.isArray(v) ? v : v ? [v] : []).map((r) => (typeof r === "string" ? r : r?.page)).filter(Boolean);
  const course = byId.get(refIds(byId.get(SITE_ID).metadata.oerFields.course)[0]);
  const cf = course.metadata.oerFields;
  const plan = items.find((i) => i.metadata?.pageType === "oer:sequence" && !i.metadata?.oerSnapshotOf && refIds(i.metadata?.oerFields?.courses).includes(course.id));
  const weeks = plan.metadata.oerSequence.modules;
  const projects = weeks.flatMap((m) => (m.items || []).map((it) => ({ week: m.week, page: byId.get(it.page) }))).filter((p) => p.page?.metadata?.pageType === "oer:project");
  const code = cf.code;
  const title = course.title.replace(new RegExp(`^${code}\\s*[:–—-]\\s*`), "");

  /* ---------- helpers ---------- */

  const handle = (fn, ...args) => page.evaluateHandle(fn, ...args);
  const edit = async (url, id, html) => {
    if (await ctx.editMode()) await ctx.exitEdit({ discard: true });
    if (id) write(id, html);
    await ctx.open(url);
    await ctx.enterEdit();
    await ctx.waitFor(() => globalThis.OerEditor?.state.tracking, { what: "unsaved changes to be followed", timeout: 5000 });
  };
  const clickField = async (el) => {
    if (!el.asElement()) throw new Error("No such field in hax-body");
    await el.evaluate((f) => f.scrollIntoView({ block: "center" }));
    await ctx.frames();
    await ctx.clickAt(el);
    await ctx.sleep(300);
  };
  // where the caret is: its field, the item it's in (by index among its kind) and how many there are
  const caret = () =>
    page.evaluate(() => {
      const body = __ec.haxBody();
      const sel = body.getRootNode().getSelection();
      if (!sel.rangeCount || !body.contains(sel.anchorNode)) return null;
      const el = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
      const item = el.closest("oer-cs-outcome, oer-cs-tool, oer-cs-question");
      const all = item ? [...body.querySelectorAll(item.localName)] : [];
      return { field: el.closest("h1, h2, h3, p, li")?.localName ?? null, item: item?.localName ?? null, index: all.indexOf(item), count: all.length, text: el.closest("h1, h2, h3, p, li")?.textContent ?? null };
    });
  // a button in a section's shadow DOM, by its words
  const sectionButton = (tag, words) =>
    handle((tag, words) => [...(__ec.haxBody()?.querySelector(tag) || __ec.theme().querySelector(tag)).shadowRoot.querySelectorAll("button")].find((b) => b.textContent.replace(/\s+/g, " ").trim() === words) || null, tag, words);
  const nextEvent = (type) =>
    page.evaluate((type) => {
      globalThis.__heard = null;
      globalThis.addEventListener(type, (e) => (globalThis.__heard = { ...e.detail, unit: e.detail?.unit?.localName ?? null, from: e.composedPath()[0]?.localName }), { once: true, capture: true });
    }, type);
  const heard = () => page.evaluate(() => globalThis.__heard);
  // Page details, if open: whose, its open section, and the field focus is
  // in (by its label: a label for f-<name>, or a group's f-<name>-l)
  const details = () =>
    page.evaluate(() => {
      const dlg = document.querySelector("oer-page-details");
      if (!dlg?.open) return null;
      const el = dlg.shadowRoot.activeElement;
      let field = null;
      for (let n = el; n && !field; n = n.parentElement) {
        const label = [...n.children].find((c) => /^f-.+-l$/.test(c.id) || (c.localName === "label" && /^f-/.test(c.htmlFor)));
        if (label) field = (label.id || label.htmlFor).replace(/^f-/, "").replace(/-l$/, "");
      }
      return { title: dlg.shadowRoot.querySelector(".sub")?.textContent.trim(), tab: dlg.shadowRoot.querySelector('[role="tab"][aria-selected="true"]')?.id, field, focus: el?.localName ?? null };
    });
  const closeDetails = async () => {
    if (await details()) await ctx.press("Escape");
    await ctx.sleep(200);
  };
  const runScript = (args) =>
    new Promise((resolve) => {
      // the copy's server, which hands out its own token: no password
      const env = { ...process.env, HAX_BASE: `http://localhost:${ctx.port}`, SITE_DIR: `${ctx.siteDir}/`, HAX_TOKENLESS: "1" };
      delete env.HAX_PASSWORD;
      execFile(process.execPath, [SCRIPT, ...args], { env, timeout: 120000 }, (error, stdout, stderr) => resolve({ code: error ? (error.code ?? 1) : 0, out: `${stdout}${stderr}`.trim() }));
    });
  const baseline = readBaseline(new URL("../axe-baseline.json", import.meta.url).pathname);

  try {
    /* ---------- readers ---------- */

    await part("reading", async () => {
      write(SITE_ID, FULL_PAGE);
      await ctx.open(SITE, { signedOut: true });
      const shown = {};
      for (const el of await page.$$("custom-oer-docs-theme > *")) {
        const tag = await el.evaluate((s) => s.localName);
        if (tag.startsWith("oer-cs-")) shown[tag] = await el.evaluate(shownText);
      }
      const expected = {
        "oer-cs-hero": [`${code} · ${cf.institution} · ${cf.campus}`, `${title} Design it on screen, then make it real. Enroll See the semester`],
        "oer-cs-facts": [`${cf.credits} credits`, `${weeks.length} weeks`, `${projects.length} projects`, "Before you take it:"],
        "oer-cs-learn": ["What you'll be able to do Cut with confidence Plan, cut and finish parts. Print what you model Slice meshes for FDM."],
        "oer-cs-semester": ["Fifteen weeks, three projects", `${weeks.length} weeks, building to ${projects.length} projects.`, "Week 1", weeks[0].title.replace(/^week\s*\d+\s*[:–—-]\s*/i, "")],
        "oer-cs-make": ["What you'll make", `Week ${projects[0].week}`, projects[0].page.title],
        "oer-cs-books": [""],
        "oer-cs-people": ["Who teaches it A note from the instructor."],
        "oer-cs-tools": ["In the shop Epilog Fusion Pro laser cutter Fusion 360"],
        "oer-cs-faq": ["Questions Do I need experience with machines? Is it online?"],
        "oer-cs-closing": ["Ready to start?", `${course.title}.`, "Enroll"],
      };
      // whole text where it's all written here, else these in order
      const matches = (text, want) => (want.length === 1 ? text === want[0] : want.every((w, i) => text.indexOf(w, i ? text.indexOf(want[i - 1]) : 0) >= 0));
      const wrong = Object.entries(expected).filter(([tag, want]) => !matches(shown[tag] ?? "(missing)", want));
      check(
        "Signed out, every section's text is the fixture's (and what it draws from the course and its plan)",
        !wrong.length && Object.keys(shown).length === 10,
        wrong.length ? wrong.map(([tag]) => `${tag}: “${shown[tag]}”`).join("; ") : `${Object.keys(shown).length} sections`,
      );
      const authorOnly = await page.evaluate(() =>
        [...__ec.theme().children]
          .filter((s) => s.shadowRoot)
          .flatMap((s) => [...s.shadowRoot.querySelectorAll(".source, .todo, .stray, .strip, .ph, .add-card, .add-chip, .add-row, .change-image, oer-image-field")].filter((el) => el.checkVisibility()).map((el) => `${s.localName} .${el.className}`)),
      );
      check("…and no author callout, placeholder or editing control among it", !authorOnly.length, authorOnly.join(", ") || "none");
      // the tools and the questions are lists of their items to assistive technology
      const tree = await page.evaluate(() => {
        const roles = (tag) => {
          const s = __ec.theme().querySelector(tag);
          const list = s.shadowRoot.querySelector('[role="list"]');
          const slot = list?.querySelector('slot[name="items"]');
          return { list: !!list, items: (slot?.assignedElements() || []).map((el) => el._internals?.role ?? null) };
        };
        const faq = __ec.theme().querySelector("oer-cs-faq");
        return {
          tools: roles("oer-cs-tools"),
          faq: roles("oer-cs-faq"),
          questions: [...faq.querySelectorAll("oer-cs-question")].map((q) => q.shadowRoot.querySelector("details")?.open ?? null),
        };
      });
      check(
        "The tools and the questions are lists of their items (listitems), and questions are closed for readers",
        tree.tools.list && json(tree.tools.items) === json(["listitem", "listitem"]) && tree.faq.list && json(tree.faq.items) === json(["listitem", "listitem"]) && json(tree.questions) === json([false, false]),
        json(tree),
      );
      // tools are chips, side by side, each as wide as its words
      const chips = await page.evaluate(() => {
        const tools = __ec.theme().querySelector("oer-cs-tools");
        const boxes = [...tools.querySelectorAll("oer-cs-tool")].map((t) => t.getBoundingClientRect());
        return { tops: boxes.map((b) => Math.round(b.top)), widths: boxes.map((b) => Math.round(b.width)), section: Math.round(tools.getBoundingClientRect().width) };
      });
      check("Tools are chips on one line, each as wide as its words", chips.tops.length === 2 && chips.tops[0] === chips.tops[1] && chips.widths.every((w) => w > 40 && w < chips.section / 3), json(chips));
      // a question opens to its answer
      const question = await page.$("custom-oer-docs-theme oer-cs-question");
      await question.evaluate(async (q) => {
        q.shadowRoot.querySelector("summary").click();
        await new Promise((r) => requestAnimationFrame(r));
      });
      const opened = await question.evaluate(shownText);
      check("…and opens to its answer, a list in it kept", opened === "Do I need experience with machines? No. Week 1 starts with safety. Bring closed shoes.", `“${opened}”`);
      const result = await ctx.axe({ context: { include: [["custom-oer-docs-theme"]] } });
      const serious = result.byImpact.serious.length + result.byImpact.critical.length;
      check("…with no serious or critical axe violations", !serious, result.rules?.map((r) => `${r.id} (${r.impact})`).join(", ") || "none");
    });

    /* ---------- generated sections while editing ---------- */

    await part("generated", async () => {
      await edit(SITE, SITE_ID, FULL_PAGE);
      // a fact (generated, in its shadow DOM) clicked: the facts become HAX's active block
      const fact = await handle(() => __ec.haxBody().querySelector("oer-cs-facts").shadowRoot.querySelector(".fact dd"));
      await clickField(fact);
      const facts = await page.evaluate(() => ({ active: __ec.haxStore().activeNode?.localName, unit: OerEditor.state.unit?.localName }));
      check("Clicking a fact makes the facts section the active node", facts.active === "oer-cs-facts", json(facts));
      // a week's link: the semester, and no navigation
      const before = await page.evaluate(() => location.pathname);
      const week = await handle(() => __ec.haxBody().querySelector("oer-cs-semester").shadowRoot.querySelector(".week-items a"));
      await clickField(week);
      const semester = await page.evaluate(() => ({ active: __ec.haxStore().activeNode?.localName, path: location.pathname, editing: !!__ec.store().editMode }));
      check("…and clicking a week's link selects the semester, without leaving the page", semester.active === "oer-cs-semester" && semester.path === before && semester.editing, json(semester));
      // only a generated section's heading takes typing
      const heading = await handle(() => __ec.haxBody().querySelector("oer-cs-semester > h2"));
      await clickField(heading);
      await ctx.press("End");
      await ctx.type(" ahead");
      await ctx.sleep(200);
      const typed = await page.evaluate(() => __ec.normalize(__ec.haxBody().querySelector("oer-cs-semester").innerHTML));
      check("A generated section's heading takes typing, and it holds nothing else", typed === "<h2>Fifteen weeks, three projects ahead</h2>", typed);
      // the hero's Change image: asked of the editor; the image field opens while nothing answers
      await nextEvent("oer-edit-request");
      await ctx.clickAt(await sectionButton("oer-cs-hero", "Change image"));
      await ctx.sleep(300);
      const asked = await heard();
      const field = await page.evaluate(() => {
        const f = __ec.haxBody().querySelector("oer-cs-hero").shadowRoot.querySelector("oer-image-field");
        return { open: !!f && __ec.visible(f), focus: __ec.describe(__ec.activeElement())?.path };
      });
      check("The hero's Change image button fires oer-edit-request with action ‘image’", asked?.action === "image" && asked.unit === "oer-cs-hero", json(asked));
      check("…and, with no popover to answer it yet, opens the image field under the picture", field.open, json(field));
      const label = await page.evaluate(() => {
        const s = __ec.haxBody().querySelector("oer-cs-hero").shadowRoot;
        const art = s.querySelector(".art").getBoundingClientRect();
        const b = s.querySelector(".change-image").getBoundingClientRect();
        return { inside: b.left >= art.left && b.right <= art.right && b.top >= art.top && b.bottom <= art.bottom, width: Math.round(b.width), height: Math.round(b.height) };
      });
      check("…which sits on the picture, at least 32px tall", label.inside && label.height >= 32, json(label));
    });

    /* ---------- tools and questions, typed as items ---------- */

    await part("items", async () => {
      await edit(SITE, SITE_ID, FULL_PAGE);
      // a tool: Enter at its end makes the next, typing fills it, Backspace in it empty takes it back
      await clickField(await handle(() => __ec.haxBody().querySelectorAll("oer-cs-tool > p")[1]));
      await ctx.press("End");
      await ctx.press("Enter");
      await ctx.waitFor(() => __ec.haxBody().querySelectorAll("oer-cs-tool").length === 3, { what: "a new tool", timeout: 5000 });
      await ctx.sleep(300);
      const added = await caret();
      await ctx.type("CNC router");
      await ctx.sleep(200);
      const tools = await page.evaluate(() => [...__ec.haxBody().querySelectorAll("oer-cs-tool")].map((t) => t.textContent));
      check(
        "Enter at the end of a tool makes the next tool with the caret in it, and typing fills it",
        added?.item === "oer-cs-tool" && added.index === 2 && added.field === "p" && json(tools) === json(["Epilog Fusion Pro laser cutter", "Fusion 360", "CNC router"]),
        `${json(added)}; ${json(tools)}`,
      );
      const chips = await page.evaluate(() => {
        const s = __ec.haxBody().querySelector("oer-cs-tools");
        const slot = s.shadowRoot.querySelector('slot[name="items"]');
        const add = [...s.shadowRoot.querySelectorAll("button")].find((b) => b.textContent.includes("Add a tool"));
        return { drawn: slot.assignedElements().filter((el) => el.getBoundingClientRect().height > 0).length, add: add?.textContent.trim() };
      });
      check("…drawn as chips while editing, with a chip to add a tool", chips.drawn === 3 && chips.add === "Add a tool", json(chips));
      for (const _ of "CNC router") await ctx.press("Backspace");
      await ctx.press("Backspace");
      await ctx.waitFor(() => __ec.haxBody().querySelectorAll("oer-cs-tool").length === 2, { what: "the empty tool to go", timeout: 5000 });
      await ctx.sleep(300);
      const back = await caret();
      check("Backspace in an empty tool removes it, the caret at the end of the one before", back?.item === "oer-cs-tool" && back.index === 1 && back.text === "Fusion 360", json(back));
      // several lines pasted into a tool: a tool each
      await page.evaluate(() => {
        const dt = new DataTransfer();
        dt.setData("text/plain", "\nWelder\nBandsaw");
        __ec.activeElement().dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true, composed: true }));
      });
      await ctx.waitFor(() => __ec.haxBody().querySelectorAll("oer-cs-tool").length === 3, { what: "the pasted tools", timeout: 5000 });
      await ctx.sleep(300);
      const pasted = await page.evaluate(() => [...__ec.haxBody().querySelectorAll("oer-cs-tool")].map((t) => t.textContent));
      check("Lines pasted at the end of a tool: the first joins it, each other a tool after it", json(pasted) === json(["Epilog Fusion Pro laser cutter", "Fusion 360Welder", "Bandsaw"]), json(pasted));

      // a question: Enter in its title goes to its answer; Enter on an empty last paragraph makes the next question
      await clickField(await handle(() => __ec.haxBody().querySelectorAll("oer-cs-question > h3")[1]));
      await ctx.press("End");
      await ctx.press("Enter");
      await ctx.sleep(200);
      const toAnswer = await caret();
      check("Enter in a question goes to its answer", toAnswer?.item === "oer-cs-question" && toAnswer.index === 1 && toAnswer.field === "p", json(toAnswer));
      await ctx.press("End");
      await ctx.press("Enter");
      await ctx.sleep(300);
      const second = await page.evaluate(() => __ec.normalize(__ec.haxBody().querySelectorAll("oer-cs-question")[1].innerHTML));
      await ctx.press("Enter");
      await ctx.waitFor(() => __ec.haxBody().querySelectorAll("oer-cs-question").length === 3, { what: "a new question", timeout: 5000 });
      await ctx.sleep(300);
      const next = await caret();
      await ctx.type("Can I use my own laptop?");
      await ctx.sleep(200);
      const faq = await page.evaluate(() => [...__ec.haxBody().querySelectorAll("oer-cs-question")].map((q) => __ec.normalize(q.innerHTML)));
      check(
        "…Enter at an answer's end starts a paragraph of it, and Enter on that empty paragraph makes the next question with the caret in it",
        /<p>No, in the studio\.<\/p><p>(<br>)?<\/p>$/.test(second) && next?.item === "oer-cs-question" && next.index === 2 && next.field === "h3" && faq[1] === "<h3>Is it online?</h3><p>No, in the studio.</p>" && faq[2].startsWith("<h3>Can I use my own laptop?</h3>"),
        `${second}; ${json(next)}; ${json(faq)}`,
      );
      const open = await page.evaluate(() => [...__ec.haxBody().querySelectorAll("oer-cs-question")].map((q) => !q.shadowRoot.querySelector("details") && __ec.visible(q.querySelector("p"))));
      check("…and every answer is open while editing", open.every(Boolean), json(open));
      // a question's title is one line: ‘- ’ and ‘/’ typed as text
      await ctx.type(" - yes/no");
      await ctx.sleep(300);
      const plain = await page.evaluate(() => ({ title: __ec.haxBody().querySelectorAll("oer-cs-question")[2].querySelector("h3").textContent, palette: !!globalThis.SuperDaemonManager?.requestAvailability?.()?.opened }));
      check("Typing ‘ - ’ and ‘/’ in a question types them", plain.title === "Can I use my own laptop? - yes/no" && !plain.palette, json(plain));
      // an empty section of items shows its shape and one button
      const empty = await page.evaluate(async () => {
        const tools = __ec.haxBody().querySelector("oer-cs-tools");
        const faq = __ec.haxBody().querySelector("oer-cs-faq");
        for (const s of [tools, faq]) for (const item of [...s.querySelectorAll("oer-cs-tool, oer-cs-question")]) item.remove();
        await new Promise((r) => setTimeout(r, 200));
        const words = (s) => [...s.shadowRoot.querySelectorAll("button")].filter((b) => __ec.visible(b)).map((b) => b.textContent.replace(/\s+/g, " ").trim());
        return { tools: words(tools), ghosts: tools.shadowRoot.querySelectorAll(".ghost-chip").length, faq: words(faq) };
      });
      check("With no items, the tools offer Add a tool beside a faint chip, and the questions Add a question", json(empty.tools) === json(["Add a tool"]) && empty.ghosts === 1 && json(empty.faq) === json(["Add a question"]), json(empty));
    });

    /* ---------- callouts on a course site without a plan ---------- */

    await part("new site", async () => {
      const planless = siteJson().find((i) => i.metadata?.pageType === "oer:course" && !i.metadata?.oerSnapshotOf && i.metadata?.oerFields?.code === PLANLESS_CODE);
      if (!planless) throw new Error(`No course ${PLANLESS_CODE} in the copy`);
      if (siteJson().some((i) => i.metadata?.pageType === "oer:course-site" && refIds(i.metadata?.oerFields?.course).includes(planless.id))) throw new Error(`${PLANLESS_CODE} already has a course site`);
      // its Course site card's switch, as an author turns it on (setCourseSite)
      await ctx.open(`/${planless.slug}`);
      const toggle = await handle(() => __ec.all('button[role="switch"]').find((b) => __ec.name(b) === "Course site") || null);
      if (!toggle.asElement()) throw new Error("The course page has no Course site switch");
      await ctx.clickAt(toggle);
      made = await ctx.waitFor(
        (id) => {
          const site = (__ec.store().manifest?.items || []).find((i) => i.metadata?.pageType === "oer:course-site" && JSON.stringify(i.metadata?.oerFields?.course || "").includes(id));
          return site ? { id: site.id, slug: site.slug } : null;
        },
        { args: [planless.id], what: "the new course site", timeout: 20000 },
      );
      const location = siteJson().find((i) => i.id === made.id)?.location;
      const file = location ? path.join(ctx.siteDir, location) : "";
      const saved = file && existsSync(file) ? readFileSync(file, "utf8").trim() : "(no file)";
      check("A new course site made with setCourseSite has the new starter markup", saved === STARTER, saved.slice(0, 200));

      await ctx.open(`/${made.slug}`);
      await ctx.enterEdit();
      // the semester comes from a plan this course hasn't got: its callout's button opens Page details at the Course plan field
      const callout = await page.evaluate(() => {
        const s = __ec.haxBody().querySelector("oer-cs-semester").shadowRoot.querySelector(".source");
        return s ? { text: s.textContent.replace(/\s+/g, " ").trim(), role: s.getAttribute("role"), info: !!s.querySelector("svg") } : null;
      });
      check(
        "The semester without a plan shows a callout saying where it comes from, with one button",
        callout?.text === "The semester comes from a course plan. Choose a course plan" && callout.role === "note" && callout.info,
        json(callout),
      );
      await nextEvent("cs-edit-source");
      await ctx.clickAt(await sectionButton("oer-cs-semester", "Choose a course plan"));
      await ctx.waitFor(() => document.querySelector("oer-page-details")?.open, { what: "Page details", timeout: 5000 });
      await ctx.sleep(300);
      const plan = { event: await heard(), dialog: await details() };
      check("…whose button fires cs-edit-source with kind ‘plan’", plan.event?.kind === "plan" && plan.event.field === "sequence" && plan.event.from === "oer-cs-semester", json(plan.event));
      check(
        "…and the theme opens the course site's Page details at that field (focus in Course plan)",
        plan.dialog?.title === planless.title && plan.dialog.tab === "tab-details" && plan.dialog.field === "sequence",
        json(plan.dialog),
      );
      await closeDetails();
      // the instructors come from the course page: Page details of the course, at Instructors
      await nextEvent("cs-edit-source");
      await ctx.clickAt(await sectionButton("oer-cs-people", "Add instructors"));
      await ctx.waitFor(() => document.querySelector("oer-page-details")?.open, { what: "Page details", timeout: 5000 });
      await ctx.sleep(300);
      const people = { event: await heard(), dialog: await details() };
      check(
        "Who teaches it without instructors offers Add instructors, which opens the course page's Page details at Instructors",
        people.event?.kind === "course" && people.dialog?.title === planless.title && people.dialog.field === "instructors" && people.dialog.focus === "input",
        json(people),
      );
      await closeDetails();
      // each generated section with nothing to show says where it comes from (its
      // books it has, not yet on: those are listed); written ones show a field instead
      const sources = await page.evaluate(() =>
        Object.fromEntries(
          [...__ec.haxBody().children]
            .filter((s) => s.shadowRoot)
            .map((s) => [s.localName, [...s.shadowRoot.querySelectorAll(".source button")].map((b) => b.textContent.trim())]),
        ),
      );
      const want = { "oer-cs-hero": [], "oer-cs-facts": [], "oer-cs-learn": [], "oer-cs-semester": ["Choose a course plan"], "oer-cs-make": ["Choose a course plan"], "oer-cs-books": refIds(planless.metadata.oerFields.books).length ? [] : ["Add books"], "oer-cs-people": ["Add instructors"], "oer-cs-tools": [], "oer-cs-faq": [] };
      check(
        "With nothing to show, the semester and what you'll make each offer one way to the source, and written sections none",
        Object.entries(want).every(([tag, buttons]) => json(sources[tag]) === json(buttons)),
        json(sources),
      );
      const dashed = await page.evaluate(() =>
        [...__ec.haxBody().children]
          .filter((s) => s.shadowRoot)
          .flatMap((s) => [...s.shadowRoot.querySelectorAll("*"), ...[...s.querySelectorAll("*")].flatMap((c) => (c.shadowRoot ? [...c.shadowRoot.querySelectorAll("*")] : []))].filter((el) => getComputedStyle(el).borderTopStyle === "dashed").map((el) => `${s.localName} ${el.localName}.${el.className}`)),
      );
      check("…and no section draws a dashed box", !dashed.length, dashed.join(", ") || "none");
      if (baseline) {
        const result = await ctx.axe();
        const worse = newViolations(result, baseline.pages?.[SITE]?.editing);
        check("A new course site, editing: no new axe violations against the course site's baseline", !worse.length, worse.length ? worse.join("; ") : `${result.violations} rules, ${result.nodes} nodes`);
      }
      await ctx.exitEdit({ discard: true });
      // readers of a new site see none of it
      await ctx.open(`/${made.slug}`, { signedOut: true });
      const readers = await page.evaluate(() => [...__ec.theme().children].filter((s) => s.shadowRoot?.querySelector(".source, .todo")).map((s) => s.localName));
      check("Readers of the new site see no callout", !readers.length, json(readers));
    });

    /* ---------- the hub ---------- */

    await part("hub", async () => {
      write(HUB_ID, HUB_PAGE);
      await ctx.open(HUB, { signedOut: true });
      const reading = await page.evaluate(() => __ec.theme().querySelector("oer-courses-catalog")?.shadowRoot?.querySelectorAll(".card a[href]").length ?? 0);
      await edit(HUB, null, null);
      const editing = await page.evaluate(() => {
        const catalog = __ec.haxBody().querySelector("oer-courses-catalog");
        return { cards: catalog.shadowRoot.querySelectorAll(".card").length, links: catalog.shadowRoot.querySelectorAll(".card a[href]").length };
      });
      check("Catalog cards have no a[href] while editing and do for readers", reading > 0 && editing.cards === reading && editing.links === 0, json({ reading, ...editing }));
      // the intro's h1 is typed in place, and Enter goes on to its text
      const h1 = await handle(() => __ec.haxBody().querySelector("oer-courses-intro > h1"));
      await clickField(h1);
      await ctx.type("Courses for you");
      await ctx.press("Enter");
      await ctx.sleep(200);
      const at = await caret();
      const intro = await page.evaluate(() => __ec.normalize(__ec.haxBody().querySelector("oer-courses-intro").innerHTML));
      check("The hub's intro heading (an h1) is typed in place, and Enter goes on to its text", intro === "<h1>Courses for you</h1><p>Courses you can take, by degree.</p>" && at?.field === "p", `${intro}; ${json(at)}`);
      await ctx.exitEdit({ discard: true });
    });

    /* ---------- the hero, saved, in the catalog (this saves the course site) ---------- */

    await part("save", async () => {
      await edit(SITE, SITE_ID, FULL_PAGE);
      const tagline = await handle(() => __ec.haxBody().querySelector("oer-cs-hero > p"));
      await clickField(tagline);
      await ctx.press("Mod+A");
      await ctx.type("Laser, print and route: make it real.");
      await page.evaluate(() => OerEditor.ops.setAttr(__ec.haxBody().querySelector("oer-cs-hero"), "image", "files/1500.jpg"));
      await page.evaluate(() => OerEditor.ops.setAttr(__ec.haxBody().querySelector("oer-cs-hero"), "alt", "The studio's laser cutter"));
      await ctx.sleep(300);
      await ctx.save();
      const saved = ctx.savedHtml(SITE_ID);
      const problems = [/\sslot=/.test(saved) && "slot", /\sdata-hax-/.test(saved) && "data-hax-", /\scontenteditable/.test(saved) && "contenteditable", /<h2[^>]*>\s*<\/h2>/.test(saved) && "an empty h2"].filter(Boolean);
      check(
        "The saved page holds the hero's image, alt and tagline, the tools and questions as items, and nothing editing adds",
        !problems.length &&
          /<oer-cs-hero[^>]*\simage="files\/1500\.jpg"/.test(saved) &&
          /alt="The studio's laser cutter"/.test(saved) &&
          saved.includes("<p>Laser, print and route: make it real.</p>") &&
          (saved.match(/<oer-cs-tool>/g) || []).length === 2 &&
          (saved.match(/<oer-cs-question>/g) || []).length === 2,
        problems.join(", ") || saved.replace(/\s+/g, " ").slice(0, 240),
      );
      await ctx.open(HUB, { signedOut: true });
      const card = await ctx.waitFor(
        (slug) => {
          const catalog = __ec.theme().querySelector("oer-courses-catalog");
          const card = [...(catalog?.shadowRoot?.querySelectorAll(".card") || [])].find((c) => c.querySelector(`a[href="${slug}"]`));
          const img = card?.querySelector("img");
          return img && card.textContent.includes("make it real") ? { src: img.getAttribute("src"), alt: img.alt, text: card.textContent.replace(/\s+/g, " ").trim() } : null;
        },
        { args: [SITE.slice(1)], what: "the course site's card with its hero", timeout: 10000 },
      );
      check("After a save, /oer-courses still shows the course site's hero image and tagline", card.src === "files/1500.jpg" && card.alt === "The studio's laser cutter" && card.text.includes("Laser, print and route: make it real."), json(card));
    });

    /* ---------- the migration, on the copy's own pages ---------- */

    await part("migration", async () => {
      // the pages as they are in the site (the copy's were changed above)
      for (const id of [SITE_ID, HUB_ID]) write(id, readFileSync(path.join(SOURCE, "pages", id, "index.html"), "utf8"));
      const dry = await runScript([]);
      ctx.log(dry.out);
      const unchanged = [SITE_ID, HUB_ID].every((id) => readFileSync(fileOf(id), "utf8") === readFileSync(path.join(SOURCE, "pages", id, "index.html"), "utf8"));
      check(
        "node scripts/course-site-structure.mjs prints a diff for the course site and a line for the hub, and changes nothing",
        dry.code === 0 && dry.out.includes(`${SITE}: `) && /^ {4}- <oer-cs-learn>/m.test(dry.out) && /^ {4}\+ <oer-cs-learn><oer-cs-outcome>/m.test(dry.out) && dry.out.includes(`${HUB}: `) && /a dry run/.test(dry.out) && unchanged,
        dry.out.split("\n").slice(0, 14).join(" | "),
      );
      const apply = await runScript(["--apply"]);
      const after = readFileSync(fileOf(SITE_ID), "utf8");
      check(
        "--apply converts them: the lists and the questions are items",
        apply.code === 0 && /saved$/.test(apply.out) && after.includes("<oer-cs-learn><oer-cs-outcome><h3></h3><p></p></oer-cs-outcome></oer-cs-learn>") && after.includes("<oer-cs-tools><oer-cs-tool><p></p></oer-cs-tool></oer-cs-tools>") && after.includes("<oer-cs-faq><oer-cs-question><h3></h3><p></p></oer-cs-question></oer-cs-faq>") && !/<li>/.test(after),
        `${apply.out.split("\n").slice(-2).join(" | ")}; ${after.replace(/\s+/g, " ").slice(0, 300)}`,
      );
      const again = await runScript(["--apply"]);
      check("…and a second --apply changes nothing", again.code === 0 && / 0 to save/.test(again.out) && readFileSync(fileOf(SITE_ID), "utf8") === after, again.out.split("\n").slice(-3).join(" | "));
      // and the converted page reads and edits as the section model
      await ctx.open(SITE, { signedOut: true });
      const reads = await page.evaluate(() => [...__ec.theme().children].filter((s) => /^oer-cs-/.test(s.localName)).map((s) => s.localName).join(" "));
      await edit(SITE, null, null);
      const upgraded = await page.evaluate(() => ({ dirty: OerEditor.state.dirty, canUndo: __ec.haxBody().undoStack.canUndo(), items: __ec.haxBody().querySelectorAll("oer-cs-outcome, oer-cs-tool, oer-cs-question").length }));
      check("…and the converted course site reads, and edits with no change as editing begins", reads.split(" ").length >= 9 && upgraded.items === 3 && !upgraded.dirty && !upgraded.canUndo, `${reads}; ${json(upgraded)}`);
      await ctx.exitEdit({ discard: true });
    });
  } finally {
    // the copy as it was, for the checks after this one
    if (await ctx.editMode().catch(() => false)) await ctx.exitEdit({ discard: true }).catch(() => {});
    write(SITE_ID, original[SITE_ID]);
    write(HUB_ID, original[HUB_ID]);
    // and without the course site made here (the copy's server hands out its own token)
    if (made) {
      const api = await connect({ base: `http://localhost:${ctx.port}`, password: "", tokenless: true }).catch((e) => e);
      const item = siteJson().find((i) => i.id === made.id);
      const res = api instanceof Error ? { ok: false, status: api.message } : await api.call("PATCH", "/x/api/v1/site/outline", { headers: api.headers, body: { site: { name: "learning-materials" }, items: [{ ...item, delete: true }] } });
      if (!res.ok) ctx.log(`Couldn't delete the course site made here (${res.status})`);
    }
  }
  return results;
}
