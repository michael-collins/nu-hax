// The section and item model (WP-07), proven on What you'll learn: the
// reader's layout in both modes, with light-DOM headings and outcome items
// slotted in by hand; a list of listitems for assistive technology;
// placeholders that aren't text; the keys and pastes of an outcome's
// fields; saving leaves out what's empty; old markup upgraded as editing
// begins (and still read as before by readers); hiding a section from
// readers; and blocks the section doesn't take shown as such while editing.
//
// And what the WP-07 review found: a double click on a word in a field not
// yet being edited selects it (it deleted it); Undo and Redo of an outcome
// added or removed go back to where the author was; keys typed straight
// after Enter go to the new outcome; automatic icons follow the outcomes'
// order and no icon is a button that does nothing; Enter in the heading of
// a section without items does nothing, quietly; Tab from the last field
// leaves the content; Ctrl is not ⌘ on a Mac; markup that's odd for the
// section model (lists in the hero and the note, a heading after the
// outcomes, an outcome without a title, questions written as h2s, nested
// rows) reads and edits as readers see it (questions as question items
// since WP-08); a section's own Edit HTML shows
// no editing attributes; Show to readers keeps focus; placeholders are
// GrayText in forced colours.
//
// Fixtures are written into the copy's pages and put back at the end. One
// part saves the course site in the copy.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { readBaseline, newViolations } from "../lib/axe.mjs";

// the course site's page, by id (a save can give a page a new address)
const SITE_ID = "item-0330a29b-7735-4ac0-afd2-e3b2a88d49e3";

const OUTCOMES = [
  ["Cut with confidence", "Plan, cut and finish parts on the laser cutter."],
  ["Print what you model", "Slice meshes for FDM."],
  ["Route in three axes", "Set up CAM toolpaths and run the CNC router."],
];
const outcome = ([title, text] = ["", ""]) => `<oer-cs-outcome><h3>${title}</h3><p>${text}</p></oer-cs-outcome>`;
const around = (learn, more = "") => `<oer-cs-hero><p>Design it on screen, then make it real.</p></oer-cs-hero>
<oer-cs-facts></oer-cs-facts>
${learn}
<oer-cs-semester></oer-cs-semester>
<oer-cs-books${more}></oer-cs-books>
<oer-cs-people><p>A note from the instructor.</p></oer-cs-people>
<oer-cs-closing></oer-cs-closing>
`;
// three outcomes, as readers see them
const READ_PAGE = around(`<oer-cs-learn><h2>What you'll be able to do</h2>${OUTCOMES.map(outcome).join("")}</oer-cs-learn>`);
// the second outcome empty, for typing
const EDIT_PAGE = around(`<oer-cs-learn><h2>What you'll be able to do</h2>${outcome(OUTCOMES[0])}${outcome()}${outcome(OUTCOMES[2])}</oer-cs-learn>`);
// written before the section model: the heading an attribute, the outcomes a
// list (one row with a sub-list, as Tab made in a list)
const LEGACY_PAGE = around(
  `<oer-cs-learn heading="Skills you'll gain"><ul><li><b>Cut with confidence</b>: plan, cut and finish parts.</li><li>Print what you model: slice meshes for <a href="https://example.com/fdm">FDM</a>.</li><li>Route parts<ul><li>Hold-downs</li></ul></li></ul></oer-cs-learn>`,
);
// the books hidden from readers, and a paragraph What you'll learn doesn't take
const HIDDEN_PAGE = around(`<oer-cs-learn><h2>What you'll be able to do</h2>${outcome(OUTCOMES[0])}<p>Loose words</p></oer-cs-learn>`, " hidden-from-readers");
// markup that's odd for the section model: a list as the tagline and in the
// note, a heading after the outcomes and an outcome without a title,
// questions written as h2s under a heading attribute (before the section
// had a heading of its own), one answered with a quote
const ODD_PAGE = `<oer-cs-hero><ul><li>Bring closed shoes</li></ul></oer-cs-hero>
<oer-cs-facts></oer-cs-facts>
<oer-cs-learn>${outcome(OUTCOMES[0])}<h2>Skills</h2><oer-cs-outcome><p>Only a sentence</p></oer-cs-outcome></oer-cs-learn>
<oer-cs-semester></oer-cs-semester>
<oer-cs-people><p>A note from the instructor.</p><ul><li>Office hours on Fridays</li></ul></oer-cs-people>
<oer-cs-faq heading="Common questions"><h2>Do I need experience?</h2><p>No.</p><h2>What do I bring?</h2><blockquote>Closed shoes.</blockquote></oer-cs-faq>
<oer-cs-closing></oer-cs-closing>
`;

/* ---------- in the page ---------- */

// where the caret is: its field, the outcome it's in (by index) and the
// number of outcomes, the field's text and whether the caret is at its end
function caretNow() {
  const body = __ec.haxBody();
  const sel = body.getRootNode().getSelection();
  if (!sel.rangeCount || !body.contains(sel.anchorNode)) return null;
  const node = sel.anchorNode;
  const el = node.nodeType === 1 ? node : node.parentElement;
  const field = el.closest("h2, h3, p, li");
  const items = [...body.querySelectorAll("oer-cs-outcome")];
  const rest = document.createRange();
  rest.selectNodeContents(field);
  rest.setStart(sel.anchorNode, sel.anchorOffset);
  return { field: field?.localName ?? null, item: items.indexOf(el.closest("oer-cs-outcome")), count: items.length, text: field?.textContent ?? null, atEnd: !rest.toString().trim(), collapsed: sel.isCollapsed };
}

// What you'll learn as drawn: its outcomes in the list's slot, those with a
// box, and their titles, in the content (editing) or the theme's copy
function drawn() {
  const body = __ec.haxBody();
  const learn = (body?.editMode && body.querySelector("oer-cs-learn")) || __ec.theme().querySelector("oer-cs-learn");
  const slot = learn?.shadowRoot?.querySelector('slot[name="items"]');
  const cards = slot ? slot.assignedElements() : [];
  return {
    dom: learn?.querySelectorAll("oer-cs-outcome").length ?? 0,
    slotted: cards.length,
    boxes: cards.filter((c) => c.getBoundingClientRect().height > 0).length,
    titles: cards.map((c) => c.querySelector("h3")?.textContent ?? ""),
  };
}

// an a11y tree with only what structures it (headings, lists, list items)
// and the text in it: other nodes give way to their children (puppeteer's
// interestingOnly drops lists, which have no name)
function outline(node) {
  if (!node) return [];
  const kids = (node.children || []).flatMap(outline);
  if (["heading", "list", "listitem"].includes(node.role)) return [{ role: node.role, name: node.name || "", level: node.level, children: kids.filter((k) => k.role !== "text") }];
  if (node.role === "StaticText") return [{ role: "text", name: node.name }];
  return kids;
}

// an outline as lines, "  role name (level)"
function lines(nodes, depth = 0, out = []) {
  for (const node of nodes) {
    out.push(`${"  ".repeat(depth)}${node.role}${node.name ? ` “${node.name}”` : ""}${node.level ? ` (${node.level})` : ""}`);
    lines(node.children || [], depth + 1, out);
  }
  return out;
}

export default async function model(ctx) {
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

  const items = JSON.parse(readFileSync(path.join(ctx.siteDir, "site.json"), "utf8")).items;
  const SITE = `/${items.find((i) => i.id === SITE_ID).slug}`;
  const file = path.join(ctx.siteDir, "pages", SITE_ID, "index.html");
  const original = readFileSync(file, "utf8");
  const write = (html) => writeFileSync(file, html);

  /* ---------- helpers ---------- */

  const handle = (fn, ...args) => page.evaluateHandle(fn, ...args);
  const caret = () => page.evaluate(caretNow);
  const cards = () => page.evaluate(drawn);
  const outcomeField = (index, tag) => handle((i, t) => __ec.haxBody().querySelectorAll("oer-cs-outcome")[i]?.querySelector(t) || null, index, tag);
  const edit = async (html) => {
    if (await ctx.editMode()) await ctx.exitEdit({ discard: true });
    write(html);
    await ctx.open(SITE);
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
  const a11y = async (selector, signedOut) => {
    const el = await handle((s, out) => (out ? __ec.theme() : __ec.haxBody() || __ec.theme()).querySelector(s), selector, signedOut);
    return outline(await page.accessibility.snapshot({ root: el.asElement(), interestingOnly: false }));
  };
  // the caret at the start of a field
  const caretAtStart = (el) =>
    el.evaluate((f) => {
      const sel = f.getRootNode().getSelection();
      sel.collapse(f.firstChild || f, 0);
    });
  // a click on a field, and the caret to its end
  const clickToEnd = async (el) => {
    await clickField(el);
    await ctx.press("End");
  };
  const count = () => page.evaluate(() => __ec.haxBody().querySelectorAll("oer-cs-outcome").length);
  const outcomesAre = (n) => ctx.waitFor((n) => __ec.haxBody().querySelectorAll("oer-cs-outcome").length === n, { args: [n], what: `${n} outcomes`, timeout: 5000 });
  // the middle of a word in a field, on screen
  const wordIn = (el, word) =>
    el.evaluate((f, word) => {
      f.scrollIntoView({ block: "center" });
      const text = [...f.childNodes].find((n) => n.nodeType === 3 && n.data.includes(word));
      const r = document.createRange();
      r.setStart(text, text.data.indexOf(word) + 1);
      r.setEnd(text, text.data.indexOf(word) + 2);
      const b = r.getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    }, word);
  // the rail's Block menu, and one of its items
  const runRail = async (label) => {
    const button = await handle(() => document.querySelector("oer-block-rail").shadowRoot.querySelector('.rail button[aria-label="Block"]'));
    if (!button.asElement()) throw new Error("The rail has no Block button");
    await ctx.clickAt(button);
    await ctx.sleep(150);
    const item = await handle((label) => [...document.querySelector("oer-block-rail").shadowRoot.querySelectorAll(".menu [role^=menuitem]")].find((b) => b.querySelector(".text")?.textContent.trim() === label) || null, label);
    if (!item.asElement()) throw new Error(`The rail's Block menu has no ${label}`);
    await ctx.clickAt(item);
  };
  // select a section as a whole, by a click on its own padding, above what's in it
  const selectSection = async (tag) => {
    const spot = await page.evaluate(async (tag) => {
      const s = __ec.haxBody().querySelector(tag);
      (s.querySelector(":scope > h1, :scope > h2") || s).scrollIntoView({ block: "center" });
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const r = s.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + 12) };
    }, tag);
    await ctx.clickAt(spot);
    await ctx.waitFor((tag) => __ec.haxStore().activeNode?.localName === tag, { args: [tag], what: `${tag} to be selected`, timeout: 5000 });
    await ctx.sleep(150);
  };
  const baseline = readBaseline(new URL("../axe-baseline.json", import.meta.url).pathname);

  try {
    /* ---------- readers ---------- */

    await part("reading", async () => {
      write(READ_PAGE);
      await ctx.open(SITE, { signedOut: true });
      const shown = await cards();
      check(
        "Reading three outcomes shows three cards whose h3 text matches",
        shown.dom === 3 && shown.boxes === 3 && json(shown.titles) === json(OUTCOMES.map(([t]) => t)),
        json(shown),
      );
      const tree = await a11y("oer-cs-learn", true);
      const [heading, list, ...rest] = tree.filter((n) => n.role !== "text");
      const titled = (list?.children || []).map((li) => li.role === "listitem" && li.children.find((c) => c.role === "heading" && c.level === 3)?.name);
      check(
        "…and the accessibility tree has the level-2 heading outside a list of three listitems, each with its title",
        heading?.role === "heading" && heading.level === 2 && heading.name === "What you'll be able to do" && list?.role === "list" && !rest.length && json(titled) === json(OUTCOMES.map(([t]) => t)),
        lines(tree).join(" / ").slice(0, 400),
      );
      const result = await ctx.axe({ context: { include: [["oer-cs-learn"]] } });
      check("…with no axe violations in the section", result.violations === 0, result.rules?.map((r) => `${r.id} (${r.impact})`).join(", ") || "none");

      // what was written before outcomes still reads as cards
      write(LEGACY_PAGE);
      await ctx.open(SITE, { signedOut: true });
      const legacy = await page.evaluate(() => {
        const learn = __ec.theme().querySelector("oer-cs-learn");
        const root = learn.shadowRoot;
        return { heading: root.querySelector("h2")?.textContent.trim(), cards: [...root.querySelectorAll(".cards > li.card h3")].map((h) => h.textContent.trim()) };
      });
      check(
        "A section written before outcomes (a heading attribute and a list) still reads as before: its heading and a card a row, a sub-list's rows after theirs",
        legacy.heading === "Skills you'll gain" && json(legacy.cards) === json(["Cut with confidence", "Print what you model", "Route parts", "Hold-downs"]),
        json(legacy),
      );
    });

    /* ---------- the same layout, editing ---------- */

    await part("layout", async () => {
      write(READ_PAGE);
      await ctx.open(SITE);
      const where = () =>
        page.evaluate(() => {
          const body = __ec.haxBody();
          const learn = (body?.editMode && body.querySelector("oer-cs-learn")) || __ec.theme().querySelector("oer-cs-learn");
          const s = learn.getBoundingClientRect();
          const box = (el) => {
            const r = el.getBoundingClientRect();
            return { x: Math.round(r.left - s.left), y: Math.round(r.top - s.top), w: Math.round(r.width) };
          };
          const heading = learn.querySelector("h2");
          return { heading: box(heading), cards: [...learn.querySelectorAll("oer-cs-outcome")].map(box), headingSize: getComputedStyle(heading).fontSize, titleSize: getComputedStyle(learn.querySelector("oer-cs-outcome > h3")).fontSize };
        });
      const reading = await where();
      await ctx.enterEdit();
      await ctx.waitFor(() => globalThis.OerEditor?.state.tracking, { what: "unsaved changes to be followed", timeout: 5000 });
      const editing = await where();
      const near = (a, b) => Math.abs(a.x - b.x) <= 2 && Math.abs(a.y - b.y) <= 2 && Math.abs(a.w - b.w) <= 2;
      check(
        "Editing draws the reader's layout: the heading and each card at the same place and size within 2px, in the same type",
        near(reading.heading, editing.heading) && reading.cards.length === 3 && reading.cards.every((c, i) => near(c, editing.cards[i])) && reading.headingSize === editing.headingSize && reading.titleSize === editing.titleSize,
        `reading ${json(reading)}; editing ${json(editing)}`,
      );
      const dashed = await page.evaluate(() =>
        [...__ec.haxBody().children]
          .filter((s) => s.shadowRoot)
          .flatMap((s) => [...s.shadowRoot.querySelectorAll("*"), ...[...s.querySelectorAll("*")].flatMap((c) => (c.shadowRoot ? [...c.shadowRoot.querySelectorAll("*")] : []))].filter((el) => getComputedStyle(el).borderTopStyle === "dashed" || getComputedStyle(el).outlineStyle === "dashed").map((el) => `${s.localName} ${el.localName}.${el.className}`)),
      );
      check("…and no section draws a dashed box", !dashed.length, dashed.join(", ") || "none");
      const add = await page.evaluate(() => {
        const b = [...__ec.haxBody().querySelector("oer-cs-learn").shadowRoot.querySelectorAll("button")].find((x) => x.textContent.includes("Add an outcome"));
        return b ? { text: b.textContent.trim(), w: Math.round(b.getBoundingClientRect().width) } : null;
      });
      check("…with a card to add an outcome after the last", add?.text === "Add an outcome" && add.w > 100, json(add));
    });

    /* ---------- typing ---------- */

    await part("typing", async () => {
      await edit(EDIT_PAGE);
      await clickField(await outcomeField(1, "h3"));
      const clicked = await caret();
      await ctx.type("Print what you model");
      await ctx.sleep(200);
      const title = await page.evaluate(() => __ec.haxBody().querySelectorAll("oer-cs-outcome")[1].querySelector("h3").textContent);
      check("Clicking an empty outcome title puts the caret in its h3", clicked?.field === "h3" && clicked.item === 1, json(clicked));
      check("…and typing fills it", title === "Print what you model", `“${title}”`);
      await ctx.press("Enter");
      await ctx.sleep(200);
      const toSentence = await caret();
      check("Enter in the title moves the caret to its sentence (p)", toSentence?.field === "p" && toSentence.item === 1 && toSentence.count === 3, json(toSentence));
      await ctx.type("Slice meshes for FDM.");
      await ctx.press("Enter");
      await ctx.waitFor(() => __ec.haxBody().querySelectorAll("oer-cs-outcome").length === 4, { what: "a new outcome", timeout: 5000 });
      await ctx.sleep(300);
      const added = await caret();
      const order = await page.evaluate(() => [...__ec.haxBody().querySelectorAll("oer-cs-outcome")].map((o) => o.querySelector("h3")?.textContent ?? "(no title)"));
      check(
        "Enter at the end of the sentence makes a new outcome after it, with the caret in its h3",
        added?.field === "h3" && added.item === 2 && added.count === 4 && json(order) === json(["Cut with confidence", "Print what you model", "", "Route in three axes"]),
        `${json(added)}; ${json(order)}; said “${await ctx.liveRegionText()}”`,
      );
      // Shift+Enter in a sentence is a line break, and none in a title
      await ctx.type("Laser");
      await ctx.press("Shift+Enter");
      await ctx.sleep(100);
      const titleBreak = await page.evaluate(() => __ec.haxBody().querySelectorAll("oer-cs-outcome")[2].querySelector("h3").innerHTML);
      check("Shift+Enter adds no line break to a title", titleBreak === "Laser", titleBreak);
      // Mod+A selects the field's text, and no more
      await ctx.press("Mod+A");
      await ctx.sleep(100);
      const all = await ctx.selectionText();
      check("Mod+A in a title selects that field's text only", all === "Laser", `“${all}”`);
      // Tab to the next field (the sentence), and on into the next outcome
      await ctx.press("End");
      await ctx.press("Tab");
      await ctx.press("Tab");
      await ctx.sleep(150);
      const tabbed = await caret();
      check("Tab goes from field to field, on into the next outcome", tabbed?.field === "h3" && tabbed.item === 3, json(tabbed));
      // Esc selects the outcome as a whole: no caret
      await ctx.press("Escape");
      await ctx.sleep(300);
      const selected = await page.evaluate(() => ({ active: __ec.haxStore().activeNode?.localName, index: [...__ec.haxBody().querySelectorAll("oer-cs-outcome")].indexOf(__ec.haxStore().activeNode), mode: OerEditor.state.mode }));
      const noCaret = await caret();
      check("Esc in a field selects its outcome as a whole, with no caret", selected.active === "oer-cs-outcome" && selected.index === 3 && selected.mode === "selected" && !noCaret, `${json(selected)}; caret ${json(noCaret)}`);
      // in the heading: Enter goes to the first outcome's title, Mod+Enter adds an outcome first
      await clickField(await handle(() => __ec.haxBody().querySelector("oer-cs-learn > h2")));
      await ctx.press("End");
      await ctx.press("Enter");
      await ctx.sleep(150);
      const fromHeading = await caret();
      await clickField(await handle(() => __ec.haxBody().querySelector("oer-cs-learn > h2")));
      await ctx.press("Mod+Enter");
      await ctx.waitFor(() => __ec.haxBody().querySelectorAll("oer-cs-outcome").length === 5, { what: "a first outcome", timeout: 5000 });
      await ctx.sleep(300);
      const first = await caret();
      check(
        "In the heading, Enter goes to the first outcome's title and Mod+Enter adds an outcome first",
        fromHeading?.field === "h3" && fromHeading.item === 0 && first?.field === "h3" && first.item === 0 && first.count === 5,
        `${json(fromHeading)}; ${json(first)}`,
      );
      const heading = await page.evaluate(() => __ec.haxBody().querySelector("oer-cs-learn > h2").textContent);
      check("…and the heading is untouched", heading === "What you'll be able to do", `“${heading}”`);
    });

    /* ---------- Backspace in an empty title ---------- */

    await part("backspace", async () => {
      await edit(EDIT_PAGE);
      const before = await cards();
      await clickField(await outcomeField(1, "h3"));
      await ctx.press("Backspace");
      await ctx.waitFor(() => __ec.haxBody().querySelectorAll("oer-cs-outcome").length === 2, { what: "the empty outcome to go", timeout: 5000 });
      await ctx.sleep(300);
      const after = await caret();
      const toast = await page.evaluate(() => [...(document.querySelector("oer-toast")?.shadowRoot?.querySelectorAll(".toast .text") || [])].map((t) => t.textContent.trim()));
      check(
        "Backspace in the empty title of outcome 2 removes it and puts the caret at the end of outcome 1's p",
        before.dom === 3 && after?.field === "p" && after.item === 0 && after.atEnd && after.count === 2 && after.text === OUTCOMES[0][1],
        `${json(after)}; toasts ${json(toast)}`,
      );
      check("…with a toast to undo it", toast.includes("Outcome removed"), json(toast));
      await ctx.press("Mod+Z");
      await ctx.sleep(600);
      const back = await cards();
      const returned = await caret();
      check("One Undo brings it back, and the cards drawn are the outcomes in the DOM", back.dom === 3 && back.slotted === 3 && back.boxes === 3, json(back));
      check("…with the caret back in its title, where it was", returned?.field === "h3" && returned.item === 1 && returned.text === "", json(returned));
      // Backspace at the start of a title with text goes to the end of the
      // field before (the heading for the first), and at a sentence's
      // start to its title's end; never deletes the heading
      const sentence = await outcomeField(2, "p");
      await clickField(sentence);
      await caretAtStart(sentence);
      await ctx.press("Backspace");
      await ctx.sleep(150);
      const toTitle = await caret();
      await caretAtStart(await outcomeField(2, "h3"));
      await ctx.press("Backspace");
      await ctx.sleep(150);
      const toBefore = await caret();
      const blocks = await page.evaluate(() => __ec.normalize(__ec.haxBody().querySelector("oer-cs-learn").outerHTML));
      const heading = await handle(() => __ec.haxBody().querySelector("oer-cs-learn > h2"));
      await clickField(heading);
      await caretAtStart(heading);
      await ctx.press("Backspace");
      await ctx.press("Backspace");
      await ctx.sleep(300);
      const kept = await page.evaluate(() => __ec.normalize(__ec.haxBody().querySelector("oer-cs-learn").outerHTML));
      check(
        "Backspace at a sentence's start goes to its title's end, at a title's start to the field before; at the heading's start it deletes nothing",
        toTitle?.field === "h3" && toTitle.item === 2 && toTitle.atEnd && toBefore?.field === "p" && toBefore.item === 1 && toBefore.atEnd && kept === blocks,
        `${json(toTitle)}; ${json(toBefore)}; ${kept === blocks ? "heading kept" : kept.slice(0, 120)}`,
      );
    });

    /* ---------- double and triple clicks in fields not yet being edited ---------- */

    await part("double-click", async () => {
      await edit(READ_PAGE);
      // (no click first, and a person's pace between the clicks)
      const title = await outcomeField(1, "h3");
      const word = await wordIn(title, "Print");
      await ctx.frames();
      await page.mouse.click(word.x, word.y, { count: 2, delay: 40 });
      await ctx.sleep(500);
      const twice = { selected: await ctx.selectionText(), title: await title.evaluate((h) => h.textContent), dirty: await page.evaluate(() => OerEditor.state.dirty) };
      check("Double-clicking a word in an outcome's title not yet being edited selects it, and keeps it", twice.selected === "Print" && twice.title === "Print what you model" && !twice.dirty, json(twice));
      const third = await outcomeField(2, "h3");
      const at = await wordIn(third, "three");
      await ctx.frames();
      await page.mouse.click(at.x, at.y, { count: 3, delay: 40 });
      await ctx.sleep(500);
      const thrice = { selected: (await ctx.selectionText()).trim(), title: await third.evaluate((h) => h.textContent), dirty: await page.evaluate(() => OerEditor.state.dirty) };
      check("…and triple-clicking another selects its title, and keeps it", thrice.selected === OUTCOMES[2][0] && thrice.title === OUTCOMES[2][0] && !thrice.dirty, json(thrice));
    });

    /* ---------- Undo and Redo of outcomes added and removed ---------- */

    await part("undo places", async () => {
      await edit(READ_PAGE);
      // Enter at the end of the first sentence adds an outcome; Undo goes back
      // there, Redo to the new title
      await clickToEnd(await outcomeField(0, "p"));
      await ctx.press("Enter");
      await outcomesAre(4);
      await ctx.sleep(300);
      await ctx.press("Mod+Z");
      await outcomesAre(3);
      await ctx.sleep(400);
      const undone = await caret();
      check(
        "Undo of an outcome added with Enter puts the caret back at the end of the sentence Enter was pressed in",
        undone?.field === "p" && undone.item === 0 && undone.atEnd && undone.text === OUTCOMES[0][1],
        json(undone),
      );
      await ctx.press("Mod+Shift+Z");
      await outcomesAre(4);
      await ctx.sleep(400);
      const redone = await caret();
      check("…and Redo puts it in the new outcome's title", redone?.field === "h3" && redone.item === 1 && redone.text === "", json(redone));
      await ctx.press("Mod+Z");
      await outcomesAre(3);
      await ctx.sleep(400);
      // the Add an outcome card: Undo selects the section, Redo goes to the new title
      const add = await handle(() => [...__ec.haxBody().querySelector("oer-cs-learn").shadowRoot.querySelectorAll("button")].find((b) => b.textContent.includes("Add an outcome")));
      await ctx.clickAt(add);
      await outcomesAre(4);
      await ctx.sleep(300);
      await ctx.press("Mod+Z");
      await outcomesAre(3);
      await ctx.sleep(400);
      const card = { caret: await caret(), ...(await page.evaluate(() => ({ unit: OerEditor.state.unit?.localName, mode: OerEditor.state.mode }))) };
      check("Undo of an outcome added with the Add an outcome card selects What you'll learn, with no caret", card.unit === "oer-cs-learn" && card.mode === "selected" && !card.caret, json(card));
      await ctx.press("Mod+Shift+Z");
      await outcomesAre(4);
      await ctx.sleep(400);
      const again = await caret();
      await ctx.type("B");
      await ctx.sleep(200);
      const typed = await page.evaluate(() => ({ last: __ec.haxBody().querySelectorAll("oer-cs-outcome")[3].querySelector("h3").textContent, tagline: __ec.haxBody().querySelector("oer-cs-hero > p").textContent }));
      check("…and Redo puts the caret in its title, where typing goes", again?.field === "h3" && again.item === 3 && typed.last === "B" && !typed.tagline.startsWith("B"), `${json(again)}; ${json(typed)}`);
    });

    /* ---------- keys: typing on after Enter, icons, headings without items, Tab, Ctrl on a Mac ---------- */

    await part("keys", async () => {
      await edit(READ_PAGE);
      // letters typed straight after Enter at the end of a sentence go to the new title
      await clickToEnd(await outcomeField(2, "p"));
      await ctx.press("Enter");
      await ctx.type("Weld steel", { delay: 0 });
      await outcomesAre(4);
      await ctx.sleep(500);
      const fast = await page.evaluate(() => [...__ec.haxBody().querySelectorAll("oer-cs-outcome")].slice(2).map((o) => __ec.normalize(o.innerHTML)));
      check(
        "Letters typed straight after Enter at the end of a sentence go to the new outcome's title",
        json(fast) === json([`<h3>${OUTCOMES[2][0]}</h3><p>${OUTCOMES[2][1]}</p>`, "<h3>Weld steel</h3><p></p>"]),
        json(fast),
      );
      // automatic icons follow the order: a new first outcome takes the first icon, and the others move on
      const tiles = () => page.evaluate(() => [...__ec.haxBody().querySelectorAll("oer-cs-outcome")].map((o) => o.shadowRoot.querySelector(".tile")?.innerHTML.replace(/<!--[^>]*-->/g, "") ?? ""));
      const before = await tiles();
      await clickToEnd(await handle(() => __ec.haxBody().querySelector("oer-cs-learn > h2")));
      await ctx.press("Mod+Enter");
      await outcomesAre(5);
      await ctx.sleep(400);
      const after = await tiles();
      check(
        "A new first outcome takes the first automatic icon, and each after it the next, as readers will see them",
        after.length === 5 && json(after.slice(0, 4)) === json(before) && new Set(after).size === 5,
        `${new Set(before).size} icons before, ${new Set(after).size} after; first four ${json(after.slice(0, 4)) === json(before) ? "in order" : "out of order"}`,
      );
      const buttons = await page.evaluate(() => [...__ec.haxBody().querySelectorAll("oer-cs-outcome")].flatMap((o) => [...o.shadowRoot.querySelectorAll("button, [tabindex]")].map((b) => b.getAttribute("aria-label") || b.textContent.trim())));
      check("…and an outcome's icon is no control while it can't be changed", !buttons.length, json(buttons));
      // the semester holds no items: Enter and Mod+Enter in its heading do nothing, and say nothing
      const semester = await handle(() => __ec.haxBody().querySelector("oer-cs-semester > h2"));
      await clickField(semester);
      await ctx.type("Fifteen weeks");
      await ctx.press("Enter");
      await ctx.press("Mod+Enter");
      await ctx.sleep(400);
      const quiet = { caret: await caret(), html: await semester.evaluate((h) => __ec.normalize(h.parentElement.innerHTML)), said: await ctx.liveRegionText(), outcomes: await count() };
      check(
        "Enter and Mod+Enter in the heading of a section without items add nothing and say nothing",
        quiet.caret?.field === "h2" && quiet.caret.atEnd && quiet.html === "<h2>Fifteen weeks</h2>" && quiet.outcomes === 5 && !/no items|nothing can be added/i.test(quiet.said),
        json(quiet),
      );
      // Tab from the last field on the page goes on past the content (here
      // to a button after it, put there for this), and nowhere inside it
      await page.evaluate(() => {
        const after = document.createElement("button");
        after.id = "after-the-content";
        after.textContent = "After the content";
        __ec.haxBody().getRootNode().host.after(after);
      });
      await clickField(await handle(() => __ec.haxBody().querySelector("oer-cs-closing > h2")));
      await ctx.press("Tab");
      await ctx.sleep(200);
      const out = await ctx.deepActiveElement();
      await page.evaluate(() => __ec.deep("#after-the-content")?.remove());
      check("Tab from the last field on the page goes on past the content", out?.id === "after-the-content", json(out));
      // on a Mac, Ctrl+A is the line's start (not Mod+A): it doesn't select the field
      if (process.platform === "darwin") {
        await clickToEnd(await outcomeField(1, "h3"));
        await ctx.press("Control+A");
        await ctx.sleep(150);
        const selection = await ctx.selection();
        check("On a Mac, Control+A in a title doesn't select the field (Mod is ⌘)", selection.collapsed && !selection.text, json(selection));
      }
    });

    /* ---------- HAX's shortcuts don't run in plain fields ---------- */

    await part("shortcuts", async () => {
      await edit(EDIT_PAGE);
      await clickField(await outcomeField(1, "h3"));
      await ctx.type("Half/whole");
      await ctx.sleep(400);
      const slash = await page.evaluate(() => ({ title: __ec.haxBody().querySelectorAll("oer-cs-outcome")[1].querySelector("h3").textContent, palette: !!globalThis.SuperDaemonManager?.requestAvailability?.()?.opened }));
      check("Typing ‘/’ in a title types it and opens no command palette", slash.title === "Half/whole" && !slash.palette, json(slash));
      await clickField(await outcomeField(1, "p"));
      await ctx.type("- a list?", { delay: 0 });
      await ctx.sleep(400);
      const dash = await page.evaluate(() => {
        const o = __ec.haxBody().querySelectorAll("oer-cs-outcome")[1];
        return { html: __ec.normalize(o.innerHTML), lists: __ec.haxBody().querySelector("oer-cs-learn").querySelectorAll("ul, ol").length };
      });
      check("Typing ‘- ’ at the start of an outcome sentence makes no list", dash.lists === 0 && dash.html.includes("<p>- a list?</p>"), json(dash));
      // ↑ twice in the heading of the first section after the hero adds nothing above it
      const shape = () => page.evaluate(() => [...__ec.haxBody().children].map((c) => c.localName).join(" "));
      const blocks = await shape();
      await clickField(await handle(() => __ec.haxBody().querySelector("oer-cs-learn > h2")));
      await ctx.press("ArrowUp");
      await ctx.press("ArrowUp");
      await ctx.sleep(500);
      check("↑ twice in a section's heading adds no paragraph", (await shape()) === blocks, await shape());
    });

    /* ---------- pasting lines ---------- */

    await part("paste", async () => {
      await edit(EDIT_PAGE);
      await clickField(await outcomeField(1, "h3"));
      const position = await page.evaluate(() => __ec.haxBody().undoStack.undoStackPosition);
      await page.evaluate(() => {
        const dt = new DataTransfer();
        dt.setData("text/plain", "Sketch by hand\nModel in Fusion 360\nPrint a prototype\n");
        __ec.activeElement().dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true, composed: true }));
      });
      await ctx.waitFor(() => __ec.haxBody().querySelectorAll("oer-cs-outcome").length === 5, { what: "the pasted outcomes", timeout: 5000 });
      await ctx.sleep(400);
      const pasted = await page.evaluate(() => [...__ec.haxBody().querySelectorAll("oer-cs-outcome")].map((o) => o.querySelector("h3").textContent));
      const at = await caret();
      const steps = await page.evaluate(() => __ec.haxBody().undoStack.undoStackPosition);
      check(
        "Pasting three lines of plain text into an empty title makes three outcomes",
        json(pasted) === json(["Cut with confidence", "Sketch by hand", "Model in Fusion 360", "Print a prototype", "Route in three axes"]),
        json(pasted),
      );
      check("…as one undo step, with the caret at the end of the last one's title", steps === position + 1 && at?.field === "h3" && at.item === 3 && at.atEnd, `undo position ${position}→${steps}; ${json(at)}`);
      // one line pasted into a title stays one line of plain text
      await ctx.type(" ");
      await page.evaluate(() => {
        const dt = new DataTransfer();
        dt.setData("text/plain", "and test");
        dt.setData("text/html", "<p><b>and test</b></p>");
        __ec.activeElement().dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true, composed: true }));
      });
      await ctx.sleep(300);
      const line = await page.evaluate(() => __ec.normalize(__ec.haxBody().querySelectorAll("oer-cs-outcome")[3].innerHTML));
      check("…and one line pasted into a title goes in as plain text", line.startsWith("<h3>Print a prototype and test</h3>") && (await cards()).dom === 5, line);
    });

    /* ---------- legacy markup ---------- */

    await part("legacy", async () => {
      await edit(LEGACY_PAGE);
      await ctx.sleep(800);
      const state = await page.evaluate(() => {
        const learn = __ec.haxBody().querySelector("oer-cs-learn");
        return {
          heading: learn.getAttribute("heading"),
          html: __ec.normalize(learn.innerHTML),
          dirty: OerEditor.state.dirty,
          canUndo: __ec.haxBody().undoStack.canUndo(),
        };
      });
      check(
        "A legacy section (heading attribute, ul/li) is upgraded on entering edit mode: its heading an h2, an outcome a row (a sub-list's rows after theirs, not in their titles), links kept",
        state.heading === null &&
          state.html ===
            '<h2>Skills you\'ll gain</h2><oer-cs-outcome><h3>Cut with confidence</h3><p>Plan, cut and finish parts.</p></oer-cs-outcome><oer-cs-outcome><h3>Print what you model</h3><p>Slice meshes for <a href="https://example.com/fdm">FDM</a>.</p></oer-cs-outcome><oer-cs-outcome><h3>Route parts</h3><p></p></oer-cs-outcome><oer-cs-outcome><h3>Hold-downs</h3><p></p></oer-cs-outcome>',
        state.html,
      );
      check("…while editorState.dirty stays false and canUndo stays false", state.dirty === false && state.canUndo === false, json({ dirty: state.dirty, canUndo: state.canUndo }));
      // leaving without saving keeps the old markup, which readers still read
      await ctx.exitEdit();
      const kept = ctx.savedHtml(SITE_ID).includes('<oer-cs-learn heading="Skills you\'ll gain"><ul>');
      check("…and leaving without saving leaves the old markup on disk", kept && !(await ctx.editMode()), kept ? "unchanged" : ctx.savedHtml(SITE_ID).slice(0, 200));
    });

    /* ---------- markup that's odd for the section model ---------- */

    await part("odd markup", async () => {
      write(ODD_PAGE);
      await ctx.open(SITE, { signedOut: true });
      // what each section shows readers: its slotted blocks' text, or (the questions) its accordion
      const shown = () =>
        page.evaluate(() => {
          const body = __ec.haxBody();
          const root = (body?.editMode && body) || __ec.theme();
          const slotted = (tag, name) => [...(root.querySelector(tag).shadowRoot.querySelector(`slot[name="${name}"]`)?.assignedElements() || [])].map((el) => `${el.localName}: ${el.textContent.trim()}`);
          const faq = root.querySelector("oer-cs-faq").shadowRoot;
          return {
            hero: [...slotted("oer-cs-hero", "text-first"), ...slotted("oer-cs-hero", "text")],
            heroBox: Math.round(root.querySelector("oer-cs-hero > ul").getBoundingClientRect().height),
            note: [...slotted("oer-cs-people", "text-first"), ...slotted("oer-cs-people", "text")],
            learnHeading: slotted("oer-cs-learn", "heading"),
            outcomes: slotted("oer-cs-learn", "items").length,
            questions: [...faq.querySelectorAll("summary")].map((s) => s.textContent.trim()),
            faqHeading: faq.querySelector("h2")?.textContent.trim(),
            answers: [...faq.querySelectorAll(".answer")].map((a) => a.textContent.trim()),
          };
        });
      const reading = await shown();
      check(
        "Readers see a list typed as the tagline and in the instructor's note",
        json(reading.hero) === json(["ul: Bring closed shoes"]) && reading.heroBox > 0 && json(reading.note) === json(["p: A note from the instructor.", "ul: Office hours on Fridays"]),
        json(reading),
      );
      check("…a heading typed after the outcomes as the section's heading, with both outcomes", json(reading.learnHeading) === json(["h2: Skills"]) && reading.outcomes === 2, json(reading));
      check(
        "…and questions written as h2s as questions, under the heading in its attribute, a quote among the answers",
        json(reading.questions) === json(["Do I need experience?", "What do I bring?"]) && reading.faqHeading === "Common questions" && json(reading.answers) === json(["No.", "Closed shoes."]),
        json(reading),
      );
      await edit(ODD_PAGE);
      await ctx.sleep(500);
      const editing = await page.evaluate(() => {
        const body = __ec.haxBody();
        const tags = (tag) => [...body.querySelector(tag).children].map((c) => c.localName);
        const strays = [...body.children].flatMap((s) => (s.sortChildren ? s.sortChildren().stray.map((el) => `${s.localName} > ${el.localName}`) : []));
        return {
          learn: tags("oer-cs-learn"),
          heading: body.querySelector("oer-cs-learn > h2").textContent,
          faqHeading: body.querySelector("oer-cs-faq > h2").textContent,
          untitled: tags("oer-cs-learn > oer-cs-outcome:last-of-type"),
          faq: tags("oer-cs-faq"),
          questions: [...body.querySelectorAll("oer-cs-faq > oer-cs-question")].map((q) => __ec.normalize(q.innerHTML)),
          strays,
          dirty: OerEditor.state.dirty,
          canUndo: body.undoStack.canUndo(),
        };
      });
      // (since WP-08 the questions become question items, each its h3 and its answer)
      check(
        "While editing, the heading moves first (no second, empty one), an outcome without a title gets one to type into, and questions written as h2s become questions under their heading, from its attribute",
        json(editing.learn) === json(["h2", "oer-cs-outcome", "oer-cs-outcome"]) &&
          editing.heading === "Skills" &&
          json(editing.untitled) === json(["h3", "p"]) &&
          json(editing.faq) === json(["h2", "oer-cs-question", "oer-cs-question"]) &&
          json(editing.questions) === json(["<h3>Do I need experience?</h3><p>No.</p>", "<h3>What do I bring?</h3><blockquote>Closed shoes.</blockquote>"]) &&
          editing.faqHeading === "Common questions",
        json(editing),
      );
      check("…none of it shown as something readers won't see, and none of it a change", !editing.strays.length && !editing.dirty && !editing.canUndo, json(editing));
      const same = await shown();
      check("…and editing shows the same lists and outcomes", json(same.hero) === json(reading.hero) && json(same.note) === json(reading.note) && same.outcomes === 2, json(same));
      // the outcome that had no title: a click on where it goes, and typing
      const untitled = await handle(() => __ec.haxBody().querySelector("oer-cs-learn > oer-cs-outcome:last-of-type > h3"));
      await clickField(untitled);
      await ctx.type("Sand and finish");
      await ctx.sleep(200);
      const titled = await untitled.evaluate((h) => h.textContent);
      check("Clicking an outcome's missing title puts the caret there, and typing fills it", titled === "Sand and finish", `“${titled}”`);

      // the section's own Edit HTML: no editing attributes in it, and its fields still take typing after
      await selectSection("oer-cs-learn");
      await runRail("Edit HTML");
      await ctx.waitFor(() => !!__ec.haxBody().querySelector("code-editor"), { what: "the source view", timeout: 5000 });
      await ctx.sleep(600);
      const source = await page.evaluate(() => {
        const editor = __ec.haxBody().querySelector("code-editor");
        return editor.shadowRoot?.querySelector("#codeeditor")?.value || [...editor.children].map((c) => c.outerHTML).join("");
      });
      check("A section's own Edit HTML shows no editing attributes", /<h2[^>]*>Skills<\/h2>/.test(source) && !/data-hax-|contenteditable|role="textbox"/.test(source), source.slice(0, 160));
      await clickField(await handle(() => __ec.haxBody().querySelector("oer-cs-hero > ul > li")));
      await ctx.sleep(300);
      const sentence = await outcomeField(0, "p");
      await clickToEnd(sentence);
      await ctx.type(" Then sand.");
      await ctx.sleep(200);
      const after = await page.evaluate(() => ({ text: __ec.haxBody().querySelector("oer-cs-outcome > p").textContent, source: !!__ec.haxBody().querySelector("code-editor") }));
      check("…and once it's closed, the section's fields take typing", !after.source && after.text === `${OUTCOMES[0][1]} Then sand.`, json(after));
    });

    /* ---------- hidden from readers, and blocks a section doesn't take ---------- */

    await part("hidden", async () => {
      write(HIDDEN_PAGE);
      await ctx.open(SITE, { signedOut: true });
      const reader = await page.evaluate(() => {
        const books = __ec.theme().querySelector("oer-cs-books");
        const learn = __ec.theme().querySelector("oer-cs-learn");
        return { height: books.getBoundingClientRect().height, loose: learn.shadowRoot.textContent.includes("Loose words") || [...learn.shadowRoot.querySelectorAll("slot")].some((s) => s.assignedElements().some((el) => el.textContent.includes("Loose"))) };
      });
      check("A section with hidden-from-readers has zero height for signed-out readers", reader.height === 0, json(reader));
      check("…and a paragraph What you'll learn doesn't take isn't shown to them", !reader.loose, json(reader));
      await edit(HIDDEN_PAGE);
      const strip = () =>
        page.evaluate(() => {
          const books = __ec.haxBody().querySelector("oer-cs-books");
          const root = books.shadowRoot;
          const button = [...root.querySelectorAll("button")].find((b) => b.textContent.trim() === "Show to readers");
          // (its words in their own boxes)
          const words = [...(root.querySelector(".strip")?.querySelectorAll("b, span:not(:has(*)), button") || [])].map((el) => el.textContent.trim());
          return { text: words.join(" "), button: !!button, height: Math.round(books.getBoundingClientRect().height) };
        });
      const folded = await strip();
      check(
        "While editing it's a strip saying so, with Show to readers",
        folded.text === "Books · Hidden from readers Show to readers" && folded.button && folded.height >= 40 && folded.height <= 64,
        json(folded),
      );
      // selected, it opens
      const books = await handle(() => __ec.haxBody().querySelector("oer-cs-books").shadowRoot.querySelector(".strip-label"));
      await ctx.clickAt(books, { covered: true });
      await ctx.waitFor(() => __ec.haxStore().activeNode?.localName === "oer-cs-books", { what: "the books to be selected", timeout: 5000 });
      await ctx.sleep(300);
      const open = await strip();
      check("…which opens to the whole section while it's selected", open.button && open.height > folded.height + 60, `${folded.height}px → ${open.height}px`);
      const menu = await page.evaluate(async () => {
        const books = __ec.haxBody().querySelector("oer-cs-books");
        const plate = { ceButtons: [] };
        await __ec.haxStore().runHook(books, "inlineContextMenu", [plate]);
        return plate.ceButtons.map((b) => b.label);
      });
      check("…and its HAX menu offers Show to readers", json(menu) === json(["Show to readers"]), json(menu));
      // Show to readers from the keyboard, as one undo step; focus stays with the section
      const show = await handle(() => [...__ec.haxBody().querySelector("oer-cs-books").shadowRoot.querySelectorAll("button")].find((b) => b.textContent.trim() === "Show to readers"));
      await show.evaluate((b) => b.focus());
      await ctx.press("Enter");
      await ctx.sleep(500);
      const shown = await page.evaluate(() => __ec.haxBody().querySelector("oer-cs-books").hasAttribute("hidden-from-readers"));
      const kept = await page.evaluate(() => ({ focus: __ec.describe(__ec.activeElement())?.path, selected: __ec.haxStore().activeNode?.localName, mode: OerEditor.state.mode }));
      check("Show to readers from the keyboard keeps focus with the section, selected", /hax-body$/.test(kept.focus || "") && kept.selected === "oer-cs-books" && kept.mode === "selected", json(kept));
      await ctx.press("Mod+Z");
      await ctx.sleep(500);
      const undone = await page.evaluate(() => __ec.haxBody().querySelector("oer-cs-books").hasAttribute("hidden-from-readers"));
      check("Show to readers takes the attribute off, and Undo puts it back", shown === false && undone === true, json({ shown, undone }));
      const learnMenu = await page.evaluate(async () => {
        const plate = { ceButtons: [] };
        await __ec.haxStore().runHook(__ec.haxBody().querySelector("oer-cs-learn"), "inlineContextMenu", [plate]);
        return plate.ceButtons.map((b) => b.label);
      });
      check("What you'll learn's HAX menu offers Add an outcome and Hide from readers", json(learnMenu) === json(["Add an outcome", "Hide from readers"]), json(learnMenu));

      // the paragraph it doesn't take: shown to authors, with ways to fix it
      const stray = await page.evaluate(() => {
        const learn = __ec.haxBody().querySelector("oer-cs-learn");
        const slot = learn.shadowRoot.querySelector('slot[name="stray"]');
        const note = learn.shadowRoot.querySelector(".stray-note");
        return { slotted: slot?.assignedElements().map((el) => el.textContent) ?? [], note: [...(note?.children || [])].map((el) => el.textContent.trim()).filter(Boolean).join(" ") };
      });
      check(
        "While editing, a paragraph What you'll learn doesn't take is shown with “Readers won't see this paragraph”",
        json(stray.slotted) === json(["Loose words"]) && stray.note === "Readers won't see this paragraph. Make it an outcome · Move it below the section",
        json(stray),
      );
      const make = await handle(() => [...__ec.haxBody().querySelector("oer-cs-learn").shadowRoot.querySelectorAll(".stray-note button")].find((b) => b.textContent.startsWith("Make it")));
      await ctx.clickAt(make);
      await ctx.waitFor(() => __ec.haxBody().querySelectorAll("oer-cs-outcome").length === 2, { what: "the paragraph to become an outcome", timeout: 5000 });
      await ctx.sleep(300);
      const made = await page.evaluate(() => ({ html: __ec.normalize(__ec.haxBody().querySelector("oer-cs-learn").innerHTML), hidden: __ec.haxBody().querySelector("oer-cs-learn").shadowRoot.querySelector(".stray-wrap")?.hidden }));
      check("…and Make it an outcome makes it one", made.html.endsWith("<oer-cs-outcome><h3>Loose words</h3><p></p></oer-cs-outcome>") && made.hidden === true, made.html.slice(-120));

      // placeholders aren't text to assistive technology
      await page.evaluate(() => globalThis.OerEditor.ops.addItem(__ec.haxBody().querySelector("oer-cs-outcome:last-of-type")));
      await ctx.sleep(500);
      const flat = lines(await a11y("oer-cs-learn")).join(" / ");
      const drawnPlaceholders = await page.evaluate(() => [...__ec.haxBody().querySelectorAll("oer-cs-outcome")].flatMap((o) => [...o.shadowRoot.querySelectorAll(".ph")].filter((p) => p.checkVisibility()).map((p) => p.textContent)));
      check(
        "Placeholder text is drawn for an empty outcome but absent from the accessibility tree",
        drawnPlaceholders.includes("Outcome title") && !flat.includes("Outcome title") && !flat.includes("What students will be able to do"),
        `drawn ${json(drawnPlaceholders)}; tree ${flat.slice(0, 300)}`,
      );
      // in forced colours, placeholders are GrayText, unlike what's typed
      // (through a session of its own, as lib/axe.mjs does: detaching it puts
      // the page's own emulation back)
      const session = await page.createCDPSession();
      await session.send("Emulation.setEmulatedMedia", { features: [{ name: "forced-colors", value: "active" }] });
      const forced = await page.evaluate(() => {
        const outcome = [...__ec.haxBody().querySelectorAll("oer-cs-outcome")].at(-1);
        const ph = [...outcome.shadowRoot.querySelectorAll(".ph")].find((p) => p.checkVisibility());
        const gray = document.createElement("span");
        gray.style.color = "GrayText";
        document.body.append(gray);
        const out = { placeholder: getComputedStyle(ph).color, grayText: getComputedStyle(gray).color, typed: getComputedStyle(__ec.haxBody().querySelector("oer-cs-outcome > h3")).color };
        gray.remove();
        return out;
      });
      await session.detach();
      check("In forced colours an empty field's placeholder is GrayText, unlike typed text", forced.placeholder === forced.grayText && forced.typed !== forced.grayText, json(forced));
      if (baseline) {
        const result = await ctx.axe();
        const worse = newViolations(result, baseline.pages?.[SITE]?.editing);
        check(`${SITE} editing these sections: no new axe violations`, !worse.length, worse.length ? worse.join("; ") : `${result.violations} rules, ${result.nodes} nodes`);
      }
    });

    /* ---------- saving (this saves the copy) ---------- */

    await part("save", async () => {
      await edit(EDIT_PAGE);
      // an empty outcome and empty headings (the ones sections make to type into) on the page
      await clickField(await outcomeField(0, "p"));
      await ctx.press("End");
      await ctx.type(" Then sand.");
      await ctx.sleep(300);
      const status = await ctx.save();
      const saved = ctx.savedHtml(SITE_ID);
      const problems = [
        /\sslot=/.test(saved) && "a slot attribute",
        /\sdata-hax-/.test(saved) && "data-hax- attributes",
        /\scontenteditable/.test(saved) && "contenteditable",
        /<oer-cs-outcome[^>]*>\s*<h3[^>]*>\s*(<br\s*\/?>)?\s*<\/h3>\s*<p[^>]*>\s*(<br\s*\/?>)?\s*<\/p>\s*<\/oer-cs-outcome>/.test(saved) && "an empty outcome",
        /<h2[^>]*>\s*(<br\s*\/?>)?\s*<\/h2>/.test(saved) && "an empty h2",
      ].filter(Boolean);
      const outcomes = (saved.match(/<oer-cs-outcome/g) || []).length;
      check(
        "The saved HTML has no slot, data-hax- or contenteditable attributes, no empty outcome and no empty h2",
        status === 200 && !problems.length && outcomes === 2 && saved.includes("Plan, cut and finish parts on the laser cutter. Then sand.") && saved.includes("<h2>What you'll be able to do</h2>"),
        problems.join(", ") || `HTTP ${status}; ${outcomes} outcomes; ${saved.replace(/\s+/g, " ").match(/<oer-cs-learn.{0,160}/)?.[0]}`,
      );
      const reading = await cards();
      check("…and the reading view shows the two outcomes", reading.boxes === 2, json(reading));
    });
  } finally {
    // the copy's page as it was, for the checks after this one
    if (await ctx.editMode().catch(() => false)) await ctx.exitEdit({ discard: true }).catch(() => {});
    write(original);
  }
  return results;
}
