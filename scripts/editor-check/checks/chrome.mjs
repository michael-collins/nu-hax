// The selection chrome (WP-09 of docs/editor-redesign/work-packages.md):
// the frame's ring, handle and label with its name tag, the keys of the
// Selected state, the rail at a fixed place with its categories by level
// and each unit's own commands, and the dock on narrow screens. Also the
// items phase B left for WP-09: Escape up a level, Hide and Show from a
// visible control (generated sections too), a generated section's source
// as a command and a chip, the spec's names and breadcrumbs, no Edit HTML,
// Lock or empty Text menu inside sections, the frame and rail on the
// editor's state (no loops of their own, no __oerDragging), the focus ring
// on the field being typed in, region keys, and phone editing without a
// gutter. And the WP-09 review's findings: a name tag given focus is in
// view and uncovered (arrows, Ctrl+`, Undo and Redo from it, a second
// click), the label's own buttons and Block ▾ reach Block settings and a
// block's own button by keyboard, the handle's and the dock's moves follow
// a move, the Style sheet, the block list and the toast paint above the
// chrome, the rail stays off the bar and clear of the handle, Ctrl+` back
// to the content goes to the unit selected, and Escape out of the block
// list comes back to the name tag. And the second review's: Format ▾ (and
// an answer's Text ▾) stay on the rail when the keyboard goes to it from a
// section's or an item's field, Escape cancels a drag for the rest of the
// press, a block's ring at phone width stays off its text, Block settings
// gives focus back to what opened it (on the rubric: a paragraph has no
// settings since WP-13), and the dock's crumb has its ›.
//
// The course site's page is written into the copy before it opens and put
// back at the end. Nothing is saved.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

// eighteen parts, about five minutes in all
export const timeout = 8 * 60 * 1000;

// the course site's page, by id (a save can give a page a new address)
const SITE_ID = "item-0330a29b-7735-4ac0-afd2-e3b2a88d49e3";
// a lesson (/lessons/what-is-design), and an exercise with a rubric block
// (/exercises/animating-a-bouncing-ball): by id too, as other checks save them
const LESSON_ID = "item-143f3783-959c-45c3-8758-dacef0f6861f";
const EXERCISE_ID = "item-21d4a4b1-6588-4417-a049-a7a1a9d69626";

const NOTE = "A note between sections, long enough to read as a paragraph of its own.";
const PAGE = `<oer-cs-hero><p>Design it on screen, then make it real.</p></oer-cs-hero>
<oer-cs-facts></oer-cs-facts>
<oer-cs-learn><h2>What you'll be able to do</h2><oer-cs-outcome><h3>Cut with confidence</h3><p>Plan, cut and finish parts on the laser cutter.</p></oer-cs-outcome><oer-cs-outcome><h3>Print what you model</h3><p>Slice meshes for FDM.</p></oer-cs-outcome><oer-cs-outcome><h3>Route in three axes</h3><p>Set up CAM for the router.</p></oer-cs-outcome></oer-cs-learn>
<oer-cs-semester></oer-cs-semester>
<p>${NOTE}</p>
<oer-cs-books></oer-cs-books>
<oer-cs-tools><h2>Tools you'll use</h2><oer-cs-tool><p>Epilog laser cutter</p></oer-cs-tool></oer-cs-tools>
<oer-cs-faq><h2>Questions</h2><oer-cs-question><h3>Do I need experience?</h3><p>No. Week 1 starts with safety.</p></oer-cs-question></oer-cs-faq>
<oer-cs-closing></oer-cs-closing>
`;

/* ---------- in the page ---------- */

// what the chrome shows now: the label's words, the name tag, the rail's
// categories, where things are
function chromeNow() {
  const box = (el) => {
    if (!el || !__ec.visible(el)) return null;
    const r = el.getBoundingClientRect();
    return { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom), width: Math.round(r.width), height: Math.round(r.height) };
  };
  const frame = document.querySelector("oer-block-frame")?.shadowRoot;
  const rail = document.querySelector("oer-block-rail")?.shadowRoot;
  const railHost = document.querySelector("oer-block-rail");
  const label = frame?.querySelector(".label");
  const words = (el) => (el ? [...el.querySelectorAll("button, span.sep, span.chip")].filter((n) => !n.closest(".chip") || n.classList.contains("chip")).map((n) => n.textContent.replace(/\s+/g, " ").trim()).filter(Boolean).join(" ") : "");
  const focus = __ec.activeElement();
  return {
    label: words(label),
    labelBox: box(label),
    ring: box(frame?.querySelector(".ring")),
    fieldRing: box(frame?.querySelector(".field-ring")),
    handle: box(frame?.querySelector(".handle")),
    rail: box(rail?.querySelector(".rail")),
    dock: railHost?.hasAttribute("dock") ? box(rail?.querySelector(".dock")) : null,
    dockLabel: words(rail?.querySelector(".dock-label")),
    cats: [...(rail?.querySelectorAll(".rail button[data-cat]") || [])].map((b) => b.getAttribute("aria-label")),
    onTag: !!focus?.classList?.contains("tag") && (focus.getRootNode() === frame || focus.getRootNode() === rail),
    focus: __ec.describe(focus)?.path ?? null,
    focusName: focus ? __ec.name(focus) : null,
    active: __ec.haxStore().activeNode?.localName ?? null,
    mode: globalThis.OerEditor.state.mode,
    unit: globalThis.OerEditor.state.unit?.localName ?? null,
    view: globalThis.OerEditor.state.geometry?.view ?? null,
  };
}

export default async function chrome(ctx) {
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

  // a page's address now, by id
  const address = (id) => `/${JSON.parse(readFileSync(path.join(ctx.siteDir, "site.json"), "utf8")).items.find((i) => i.id === id).slug}`;
  const SITE = address(SITE_ID);
  const file = path.join(ctx.siteDir, "pages", SITE_ID, "index.html");
  const original = readFileSync(file, "utf8");

  const handle = (fn, ...args) => page.evaluateHandle(fn, ...args);
  const now = () => page.evaluate(chromeNow);
  const order = () => page.evaluate(() => [...__ec.haxBody().children].map((c) => c.localName).filter((t) => t !== "page-break"));
  const field = (selector) => handle((s) => __ec.haxBody().querySelector(s), selector);
  const clickField = async (selector) => {
    const el = await field(selector);
    await el.evaluate((f) => f.scrollIntoView({ block: "center" }));
    await ctx.frames();
    await ctx.clickAt(el);
    await ctx.sleep(300);
  };
  // a click on a section's own padding, above what's in it
  const clickPadding = async (tag) => {
    const spot = await page.evaluate(async (tag) => {
      const s = __ec.haxBody().querySelector(tag);
      (s.querySelector(":scope > h1, :scope > h2") || s).scrollIntoView({ block: "center" });
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const r = s.getBoundingClientRect();
      // (a quarter across: the seams' + Add pills sit in the middle of its edges)
      return { x: Math.round(r.left + r.width / 4), y: Math.round(r.top + 12) };
    }, tag);
    await ctx.clickAt(spot, { covered: true });
    await ctx.sleep(400);
  };
  // the rail's menu for a category (its accessible name), opened by a click:
  // its items as "Label" or "Label (off: reason)"
  const railMenu = async (cat) => {
    const button = await handle((cat) => document.querySelector("oer-block-rail").shadowRoot.querySelector(`.rail button[aria-label="${cat}"]`), cat);
    if (!button.asElement()) throw new Error(`The rail has no ${cat} button (it has ${json((await now()).cats)})`);
    if (!(await page.evaluate(() => !!document.querySelector("oer-block-rail").shadowRoot.querySelector(".menu")))) await ctx.clickAt(button);
    await ctx.sleep(300);
    return page.evaluate(() =>
      [...document.querySelector("oer-block-rail").shadowRoot.querySelectorAll(".menu [role^=menuitem]")].map((b) => {
        const label = b.querySelector(".text")?.textContent.trim();
        return b.getAttribute("aria-disabled") === "true" ? `${label} (off: ${b.querySelector(".end")?.textContent.trim() || ""})` : label;
      }).filter((label) => label !== "Show labels"),
    );
  };
  const runRail = async (cat, label) => {
    await railMenu(cat);
    const item = await handle(
      (label) => [...document.querySelector("oer-block-rail").shadowRoot.querySelectorAll(".menu [role^=menuitem]")].find((b) => b.querySelector(".text")?.textContent.trim() === label) || null,
      label,
    );
    if (!item.asElement()) throw new Error(`The rail's ${cat} menu has no ${label}`);
    await ctx.clickAt(item);
    await ctx.sleep(600);
  };
  const closeMenus = async () => {
    await page.evaluate(() => document.querySelector("oer-block-rail")._close());
    await ctx.sleep(100);
  };
  const said = () => ctx.liveRegionText();
  // the name tag with focus: where it is against the content view, and
  // whether a click at its centre would reach it
  const tagSeen = () =>
    page.evaluate(() => {
      const f = __ec.activeElement();
      const state = globalThis.OerEditor.state;
      const view = state.geometry?.view;
      const r = f?.getBoundingClientRect();
      const u = state.unit?.getBoundingClientRect();
      const hit = r ? __ec.elementAt(r.left + r.width / 2, r.top + r.height / 2) : null;
      return {
        onTag: !!f?.classList?.contains("tag"),
        inView: !!(r && view && r.top >= view.top - 1 && r.bottom <= view.bottom + 1),
        hit: !!hit && hit === f,
        tag: r ? [Math.round(r.top), Math.round(r.bottom)] : null,
        unit: u ? [Math.round(u.top), Math.round(u.bottom)] : null,
        view: view ? [view.top, view.bottom] : null,
        active: __ec.haxStore().activeNode?.localName ?? null,
        selected: state.unit?.localName ?? null,
        mode: state.mode,
        focus: __ec.describe(f)?.path ?? null,
      };
    });
  // Ctrl+` until focus is on the selection's name tag (the Sections sheet,
  // where there is one, comes before it)
  const toSelection = async () => {
    for (let i = 0; i < 4; i++) {
      await ctx.press("Control+Backquote");
      await ctx.sleep(300);
      if ((await tagSeen()).onTag) return;
    }
  };
  const inInserter = async () => /oer-block-inserter/.test((await ctx.deepActiveElement())?.path || "");

  writeFileSync(file, PAGE);
  try {
    /* ---------- the name tag, the label and the Selected state's keys ---------- */

    await part("selected", async () => {
      await ctx.open(SITE);
      await ctx.enterEdit();
      // typing in the second outcome's title: its field has the focus ring
      await clickField("oer-cs-outcome:nth-of-type(2) > h3");
      const typing = await now();
      const title = await page.evaluate(() => {
        const r = __ec.haxBody().querySelectorAll("oer-cs-outcome")[1].querySelector("h3").getBoundingClientRect();
        return { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom) };
      });
      const around = (ring, r) => ring && Math.abs(ring.left - r.left) <= 4 && Math.abs(ring.top - r.top) <= 4 && Math.abs(ring.right - r.right) <= 4 && Math.abs(ring.bottom - r.bottom) <= 4;
      check("Typing in an outcome's title: the ring is around the outcome and the title has the focus ring", typing.mode === "typing" && typing.unit === "oer-cs-outcome" && around(typing.fieldRing, title), json({ ring: typing.ring, fieldRing: typing.fieldRing, title, mode: typing.mode }));
      await ctx.screenshot("typing-outcome-1440");
      // Escape: the outcome, selected as a whole, with focus on its name tag
      await ctx.press("Escape");
      await ctx.sleep(400);
      const esc1 = await now();
      check(
        "Esc from a field puts deep focus on the frame's name tag, and for the second outcome the label reads “What you'll learn › Outcome 2 of 3”",
        esc1.onTag && esc1.label === "What you'll learn › Outcome 2 of 3" && esc1.mode === "selected" && esc1.active === "oer-cs-outcome",
        json({ label: esc1.label, focus: esc1.focus, name: esc1.focusName, mode: esc1.mode }),
      );
      check("…and the name tag's accessible name says where it is", /^Outcome 2 of 3 in What you'll learn/.test(esc1.focusName || ""), esc1.focusName);
      // Escape again: up a level, to the section
      await ctx.press("Escape");
      await ctx.sleep(400);
      const esc2 = await now();
      check(
        "Esc on an outcome's name tag goes up to its section, focus on the section's name tag",
        esc2.onTag && esc2.active === "oer-cs-learn" && esc2.label === "What you'll learn" && /^What you'll learn, section 3 of \d+, 3 outcomes/.test(esc2.focusName || ""),
        json({ label: esc2.label, active: esc2.active, name: esc2.focusName }),
      );
      await ctx.screenshot("section-selected-1440");
      // and at the top, it says how to reach the editing bar
      await ctx.press("Escape");
      await ctx.sleep(300);
      check("Esc on a section's name tag says how to reach the editing bar", /Control-backtick/.test(await said()), await said());
      // ArrowDown: the next section
      await ctx.press("ArrowDown");
      await ctx.sleep(400);
      const down = await now();
      check("In the Selected state, ArrowDown selects the next section, focus staying on the name tag", down.onTag && down.active === "oer-cs-semester" && /The semester/.test(down.label), json({ active: down.active, label: down.label, said: await said() }));
      // Alt+Shift+ArrowUp: it moves up a place
      const before = await order();
      await ctx.press("Alt+Shift+ArrowUp");
      await ctx.sleep(800);
      const moved = await order();
      const after = await now();
      check(
        "Alt+Shift+ArrowUp moves the selected section up a place, focus still on its name tag",
        moved.indexOf("oer-cs-semester") === before.indexOf("oer-cs-semester") - 1 && after.onTag && after.active === "oer-cs-semester",
        `${moved.join(" ")}; said “${await said()}”`,
      );
      await ctx.press("Mod+Z");
      await ctx.sleep(700);
      check("…and one Undo puts it back", json(await order()) === json(before), (await order()).join(" "));
      // Enter: into the first field
      await page.evaluate(() => globalThis.OerEditor.ops.select(__ec.haxBody().querySelector("oer-cs-tools")));
      await ctx.sleep(400);
      await ctx.press("Enter");
      await ctx.sleep(400);
      const entered = await page.evaluate(() => {
        const h2 = __ec.haxBody().querySelector("oer-cs-tools > h2");
        const sel = h2.getRootNode().getSelection?.() || getSelection();
        return { mode: globalThis.OerEditor.state.mode, inHeading: !!sel.anchorNode && h2.contains(sel.anchorNode), focus: __ec.describe(__ec.activeElement())?.tag };
      });
      check("Enter on a section's name tag puts the caret in its first field", entered.mode === "typing" && entered.inHeading && entered.focus === "hax-body", json(entered));
      // Delete on an empty (generated) section: removed at once, with Undo
      await page.evaluate(() => globalThis.OerEditor.ops.select(__ec.haxBody().querySelector("oer-cs-books")));
      await ctx.sleep(400);
      const tagFirst = (await now()).onTag;
      await ctx.press("Delete");
      await ctx.sleep(700);
      const gone = await page.evaluate(() => ({
        books: !!__ec.haxBody().querySelector("oer-cs-books"),
        toast: [...(document.querySelector("oer-toast")?.shadowRoot?.querySelectorAll(".toast") || [])].map((t) => t.textContent.replace(/\s+/g, " ").trim()).join(" | "),
      }));
      const next = await now();
      check(
        "Delete on an empty section's name tag removes it, with a toast offering Undo, and the next unit is selected",
        tagFirst && !gone.books && /removed/i.test(gone.toast) && /Undo/.test(gone.toast) && next.onTag,
        json({ gone, active: next.active, onTag: next.onTag }),
      );
      await ctx.press("Mod+Z");
      await ctx.sleep(700);
      check("…and Undo brings it back", await page.evaluate(() => !!__ec.haxBody().querySelector("oer-cs-books")), (await order()).join(" "));
      // Home and End
      await page.evaluate(() => globalThis.OerEditor.ops.select(__ec.haxBody().querySelector("oer-cs-tools")));
      await ctx.sleep(300);
      await ctx.press("End");
      await ctx.sleep(300);
      const end = (await now()).active;
      await ctx.press("Home");
      await ctx.sleep(300);
      const home = (await now()).active;
      check("End and Home on a name tag select the last and first units", end === "oer-cs-closing" && home === "oer-cs-hero", `${end}, ${home}`);
      // in an outcome: ← → go between the cards
      await clickField("oer-cs-outcome:nth-of-type(1) > h3");
      await ctx.press("Escape");
      await ctx.sleep(300);
      await ctx.press("ArrowRight");
      await ctx.sleep(300);
      const right = await now();
      check("On an outcome's name tag, → selects the next outcome", right.onTag && right.label === "What you'll learn › Outcome 2 of 3", right.label);
      // Mod+Shift+D: a copy, selected, focus on its name tag; a section says why not
      const count = () => page.evaluate(() => __ec.haxBody().querySelectorAll("oer-cs-outcome").length);
      const outcomes = await count();
      await ctx.press("Mod+Shift+KeyD");
      await ctx.sleep(800);
      const copy = await now();
      check(
        "Mod+Shift+D on an outcome's name tag duplicates it, the copy selected with focus on its name tag",
        (await count()) === outcomes + 1 && copy.onTag && copy.label === "What you'll learn › Outcome 3 of 4",
        `${outcomes} → ${await count()} outcomes; ${copy.label}; said “${await said()}”`,
      );
      await ctx.press("Mod+Z");
      await ctx.sleep(700);
      await ctx.press("Escape");
      await ctx.sleep(300);
      await ctx.press("Mod+Shift+KeyD");
      await ctx.sleep(400);
      check("…and on a section's name tag it says why not, changing nothing", (await count()) === outcomes && /Only one per page/.test(await said()) && (await page.evaluate(() => __ec.haxBody().querySelectorAll("oer-cs-learn").length)) === 1, await said());
      // a click on a section's padding gives its name tag focus
      await clickPadding("oer-cs-faq");
      const clicked = await now();
      check("A click on a section's padding selects it with focus on its name tag", clicked.onTag && clicked.active === "oer-cs-faq", json({ active: clicked.active, focus: clicked.focus }));
      // Shift+F10: its actions, with focus in them; Escape back to the name tag
      await ctx.press("Shift+F10");
      await ctx.sleep(400);
      const menu = await page.evaluate(() => ({
        open: !!document.querySelector("oer-block-rail").shadowRoot.querySelector(".menu"),
        label: document.querySelector("oer-block-rail").shadowRoot.querySelector(".menu")?.getAttribute("aria-label"),
        focus: __ec.describe(__ec.activeElement())?.path,
      }));
      await ctx.press("Escape");
      await ctx.sleep(300);
      const backOn = await now();
      check("Shift+F10 on a name tag opens the unit's menu with focus in it, and Esc goes back to the name tag", menu.open && menu.label === "Section" && /oer-block-rail › button/.test(menu.focus || "") && backOn.onTag, json({ menu, back: backOn.focus }));
      // Alt+F10 from the name tag, and Esc back
      await ctx.press("Alt+F10");
      await ctx.sleep(200);
      const onRail = await ctx.deepActiveElement();
      await ctx.press("Escape");
      await ctx.sleep(300);
      check("Alt+F10 from a name tag goes to the rail, and Esc back to the name tag", /oer-block-rail › button/.test(onRail?.path || "") && (await now()).onTag, `${onRail?.path}; then ${(await now()).focus}`);
      await ctx.exitEdit({ discard: true });
    });

    /* ---------- the rail ---------- */

    await part("rail", async () => {
      await ctx.open(SITE);
      await ctx.enterEdit();
      const left = {};
      await clickPadding("oer-cs-learn");
      left.section = (await now()).rail?.left;
      const cats = { section: (await now()).cats };
      await clickField("oer-cs-outcome:nth-of-type(2) > h3");
      left.outcome = (await now()).rail?.left;
      cats.title = (await now()).cats;
      await page.evaluate(() => globalThis.OerEditor.ops.select(__ec.haxBody().querySelector("oer-cs-outcome")));
      await ctx.sleep(300);
      cats.outcome = (await now()).cats;
      const note = await handle((note) => [...__ec.haxBody().children].find((el) => el.localName === "p" && el.textContent.includes(note)), NOTE);
      await note.evaluate((p) => p.scrollIntoView({ block: "center" }));
      await ctx.clickAt(note);
      await ctx.sleep(300);
      left.paragraph = (await now()).rail?.left;
      cats.paragraph = (await now()).cats;
      const lefts = Object.values(left);
      check("At 1440 the rail's left edge is the same within 1px for a section, an outcome and a paragraph between sections", lefts.every((l) => typeof l === "number" && Math.abs(l - lefts[0]) <= 1), json(left));
      check(
        "The rail's categories follow the level: Section; Section, Outcome, Format while typing in a title; Section, Outcome selected; Block and text for a paragraph",
        json(cats.section) === json(["Section"]) && json(cats.title) === json(["Section", "Outcome", "Format"]) && json(cats.outcome) === json(["Section", "Outcome"]) && cats.paragraph[0] === "Block",
        json(cats),
      );
      const labelled = await page.evaluate(() => [...document.querySelector("oer-block-rail").shadowRoot.querySelectorAll(".rail button[data-cat]")].map((b) => b.textContent.trim()));
      check("At 1440 the rail shows labels beside its icons by default", labelled.length && labelled.every((t) => t.length > 0), json(labelled));

      // Section ▾ on a selected section: the verbs, Hide from readers from its own commands
      await clickPadding("oer-cs-tools");
      const tools = await railMenu("Section");
      await closeMenus();
      check(
        "The rail's Section menu lists the verbs in order, with Hide from readers (the section's own command)",
        json(tools.map((t) => t.replace(/ \(off: .*\)$/, ""))) === json(["Move up", "Move down", "Add above…", "Add below…", "Duplicate", "Hide from readers", "Remove section", "Add a tool", "Edit HTML…"]),
        tools.join(", "),
      );
      await clickField("oer-cs-hero > p");
      const hero = await railMenu("Section");
      await closeMenus();
      check("Move up on the hero is off, with the reason “The hero stays at the top”", hero.includes("Move up (off: The hero stays at the top)"), hero.join(", "));
      // typing in a title: no Edit HTML or Lock, and no Text menu
      await clickField("oer-cs-outcome:nth-of-type(2) > h3");
      const outcome = await railMenu("Outcome");
      await closeMenus();
      const section = await railMenu("Section");
      await closeMenus();
      check(
        "In an outcome's title the rail offers the outcome's own verbs (earlier and later, as cards) and its own Change icon… (WP-14), and no Edit HTML, Lock or Text",
        json(outcome) === json(["Move earlier", "Move later", "Add an outcome before", "Add an outcome after", "Duplicate", "Remove outcome", "Change icon…"]) && !(await now()).cats.includes("Text") && ![...outcome, ...section].some((m) => /lock|^Edit HTML$/i.test(m)),
        `${outcome.join(", ")} | ${section.join(", ")}`,
      );
      // in a question's answer: Text holds a paragraph and lists only
      await clickField("oer-cs-question > p");
      const answer = await railMenu("Text");
      await closeMenus();
      check("In a question's answer, Text ▾ offers a paragraph and lists only", json(answer.map((t) => t.replace(/ \(off: .*\)$/, ""))) === json(["Paragraph", "Bulleted list", "Numbered list", "Indent", "Outdent"]), answer.join(", "));

      // a generated section: where its content comes from, first, and as a chip
      await clickPadding("oer-cs-facts");
      const facts = await railMenu("Section");
      await closeMenus();
      const factsLabel = (await now()).label;
      check("A generated section's first command opens where its content comes from (Facts: Edit course details…)", facts[0] === "Edit course details…" && facts.includes("Hide from readers"), facts.join(", "));
      check("…and its label has a “From the course page” chip", /From the course page/.test(factsLabel), factsLabel);
      await clickPadding("oer-cs-semester");
      const semester = await railMenu("Section");
      await closeMenus();
      check("The semester's first command is the course plan's (Choose a course plan… or Open the course plan…)", /^(Choose a course plan…|Open the course plan…)$/.test(semester[0]), semester.join(", "));
      // the chip opens it: Page details at the course's details
      await clickPadding("oer-cs-facts");
      const chip = await handle(() => [...document.querySelector("oer-block-frame").shadowRoot.querySelectorAll(".label .chip")].find((c) => c.localName === "button") || null);
      if (chip.asElement()) await ctx.clickAt(chip);
      const opened = await ctx.waitFor(() => !!document.querySelector("oer-page-details")?.open, { what: "Page details", timeout: 5000 }).then(() => true, () => false);
      if (opened) {
        await ctx.press("Escape");
        await ctx.sleep(400);
      }
      check("The chip opens where the content comes from (Page details)", opened, opened ? "opened" : "no Page details");

      // Hide and Show from the rail, a generated section included
      await clickPadding("oer-cs-books");
      await runRail("Section", "Hide from readers");
      const hidden = await page.evaluate(() => ({ attr: __ec.haxBody().querySelector("oer-cs-books").hasAttribute("hidden-from-readers"), strip: !!__ec.haxBody().querySelector("oer-cs-books").shadowRoot.querySelector(".strip") }));
      const hiddenLabel = (await now()).label;
      check("Section ▾ → Hide from readers hides a generated section (Books): the strip, and a Hidden chip on its label", hidden.attr && hidden.strip && /Hidden/.test(hiddenLabel), json({ ...hidden, label: hiddenLabel }));
      await runRail("Section", "Show to readers");
      check("…and Show to readers shows it again", !(await page.evaluate(() => __ec.haxBody().querySelector("oer-cs-books").hasAttribute("hidden-from-readers"))), "");

      // the labels setting: icons only, remembered for the viewer
      await clickPadding("oer-cs-tools");
      await runRail("Section", "Show labels");
      const iconsOnly = await page.evaluate(() => [...document.querySelector("oer-block-rail").shadowRoot.querySelectorAll(".rail button[data-cat]")].map((b) => b.textContent.trim()));
      const kept = await page.evaluate(() => localStorage.getItem("oer-rail-labels"));
      await runRail("Section", "Show labels");
      check("Show labels off leaves icons only, remembered for the viewer", iconsOnly.every((t) => !t) && kept === "off", json({ iconsOnly, kept }));
      await ctx.exitEdit({ discard: true });
    });

    // the keyboard on the rail from a section's or an item's field: the
    // text menus stay, and work on the text
    await part("rail keys", async () => {
      await ctx.open(SITE);
      await ctx.enterEdit();
      const kept = {};
      const viaKeys = async (selector) => {
        await clickField(selector);
        const typing = (await now()).cats;
        await ctx.press("Alt+F10");
        await ctx.sleep(400);
        const there = await now();
        await ctx.press("Escape");
        await ctx.sleep(300);
        return { typing, keys: there.cats, focus: there.focus };
      };
      kept.sentence = await viaKeys("oer-cs-outcome:nth-of-type(2) > p");
      kept.heading = await viaKeys("oer-cs-tools > h2");
      kept.answer = await viaKeys("oer-cs-question > p");
      const same = (k) => json(k.typing) === json(k.keys) && /oer-block-rail/.test(k.focus || "");
      check(
        "Alt+F10 from a section's or an item's field keeps the rail's text menus: Format in an outcome's sentence and a section's heading, Format and Text in an answer",
        same(kept.sentence) && kept.sentence.keys.includes("Format") && same(kept.heading) && kept.heading.keys.includes("Format") && same(kept.answer) && kept.answer.keys.includes("Format") && kept.answer.keys.includes("Text"),
        json(kept),
      );
      // a word selected in outcome 2's sentence, struck through by keys alone
      const word = await page.evaluate(() => {
        const p = __ec.haxBody().querySelectorAll("oer-cs-outcome")[1].querySelector("p");
        p.scrollIntoView({ block: "center" });
        const t = p.firstChild;
        const range = document.createRange();
        range.setStart(t, t.data.indexOf("meshes"));
        range.setEnd(t, t.data.indexOf("meshes") + 6);
        const r = range.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      });
      await ctx.frames();
      await ctx.clickAt(word, { clickCount: 2 });
      await ctx.sleep(400);
      const picked = await ctx.selectionText();
      await ctx.press("Alt+F10");
      await ctx.sleep(300);
      const reach = async (name, limit) => {
        for (let i = 0; i < limit && (await ctx.deepActiveElement())?.name !== name; i++) {
          await ctx.press("ArrowDown");
          await ctx.sleep(100);
        }
        return (await ctx.deepActiveElement())?.name === name;
      };
      const onFormat = await reach("Format", 4);
      await ctx.press("Enter");
      await ctx.sleep(400);
      const onItem = await reach("Strikethrough", 12);
      await ctx.press("Enter");
      await ctx.sleep(600);
      const struck = await page.evaluate(() => __ec.haxBody().querySelectorAll("oer-cs-outcome")[1].querySelector("p").innerHTML);
      const back = { focus: (await ctx.deepActiveElement())?.path, selection: await ctx.selectionText() };
      check(
        "By keys alone, Format ▾ → Strikethrough strikes through the word selected in an outcome's sentence, and focus goes back to the text with the word still selected",
        picked.trim() === "meshes" && onFormat && onItem && /<(strike|s)>meshes<\/(strike|s)>/.test(struck) && /hax-body$/.test(back.focus || "") && back.selection.trim() === "meshes",
        json({ picked, onFormat, onItem, struck, back }),
      );
      await ctx.exitEdit({ discard: true });
    });

    /* ---------- clipping, and what paints above ---------- */

    await part("clip", async () => {
      await ctx.open(SITE);
      await ctx.enterEdit();
      await clickPadding("oer-cs-learn");
      // the section's top scrolled up under the bar
      await page.evaluate(() => {
        const learn = __ec.haxBody().querySelector("oer-cs-learn");
        const main = __ec.theme().shadowRoot.querySelector("main");
        const view = globalThis.OerEditor.state.geometry.view;
        main.scrollTop += learn.getBoundingClientRect().top - view.top + 120;
      });
      await ctx.sleep(400);
      const scrolled = await page.evaluate(() => {
        const learn = __ec.haxBody().querySelector("oer-cs-learn").getBoundingClientRect();
        const bar = __ec.theme().shadowRoot.querySelector("oer-edit-bar, header.topbar").getBoundingClientRect();
        const label = document.querySelector("oer-block-frame").shadowRoot.querySelector(".label").getBoundingClientRect();
        const frame = document.querySelector("oer-block-frame");
        return { section: Math.round(learn.top), bar: Math.round(bar.bottom), label: Math.round(label.top), clip: getComputedStyle(frame).clipPath };
      });
      check("With the selected section's top scrolled under the editing bar, the label's top is at or below the bar's bottom", scrolled.section < scrolled.bar && scrolled.label >= scrolled.bar, json(scrolled));
      await ctx.screenshot("label-under-bar-1440");
      // the block list opened over the selected section paints above the frame
      await page.evaluate(() => {
        const learn = __ec.haxBody().querySelector("oer-cs-learn");
        learn.scrollIntoView({ block: "start" });
      });
      await ctx.sleep(300);
      await page.evaluate(() => document.querySelector("oer-block-inserter").openFor(__ec.haxBody().querySelector("oer-cs-learn"), "above"));
      await ctx.sleep(500);
      const top = await page.evaluate(() => {
        const inserter = document.querySelector("oer-block-inserter");
        const panel = inserter.shadowRoot.querySelector(".panel");
        const ring = document.querySelector("oer-block-frame").shadowRoot.querySelector(".ring").getBoundingClientRect();
        const p = panel?.getBoundingClientRect();
        if (!p) return { panel: null };
        const x = Math.round(p.left + p.width / 2);
        const y = Math.round(p.top + Math.min(p.height / 2, 60));
        const hit = __ec.elementAt(x, y);
        return { panel: true, overRing: x >= ring.left && x <= ring.right && y >= ring.top && y <= ring.bottom, hit: __ec.describe(hit)?.path, inserter: __ec.within(hit, inserter) };
      });
      await page.evaluate(() => document.querySelector("oer-block-inserter").close());
      check("The inserter's block list, opened over the selected section, paints above the frame", top.panel && top.overRing && top.inserter, json(top));
      await ctx.exitEdit({ discard: true });
    });

    /* ---------- regions ---------- */

    await part("regions", async () => {
      await ctx.open(SITE);
      await ctx.enterEdit();
      await clickField("oer-cs-tools > h2");
      await ctx.press("End");
      await ctx.type("Shop");
      const where = () => page.evaluate(() => {
        const h2 = __ec.haxBody().querySelector("oer-cs-tools > h2");
        const sel = h2.getRootNode().getSelection?.() || getSelection();
        return { focus: __ec.describe(__ec.activeElement())?.path, caretIn: !!sel.anchorNode && h2.contains(sel.anchorNode), tag: __ec.activeElement()?.classList?.contains("tag") };
      });
      await ctx.press("Control+Backquote");
      await ctx.sleep(300);
      const bar = await where();
      await ctx.press("Control+Backquote");
      await ctx.sleep(300);
      const selection = await where();
      await ctx.press("Control+Backquote");
      await ctx.sleep(300);
      const content = await where();
      await ctx.press("Control+Shift+Backquote");
      await ctx.sleep(300);
      const back = await where();
      check(
        "Ctrl+` goes from the content to the editing bar, the selection's name tag, and back to the caret in the content; Ctrl+Shift+` goes back",
        /custom-oer-docs-theme/.test(bar.focus || "") && selection.tag && /hax-body$/.test(content.focus || "") && content.caretIn && back.tag,
        json({ bar: bar.focus, selection: selection.focus, content, back: back.focus }),
      );
      await ctx.exitEdit({ discard: true });
    });

    /* ---------- dragging ---------- */

    await part("drag", async () => {
      await ctx.open(SITE);
      await ctx.enterEdit();
      await clickPadding("oer-cs-tools");
      const before = await order();
      const at = await page.evaluate(() => {
        const grip = document.querySelector("oer-block-frame").shadowRoot.querySelector(".grip").getBoundingClientRect();
        return [grip.left + grip.width / 2, grip.top + grip.height / 2];
      });
      // dragged far up: past the hero's top it can't go
      const main = await page.evaluate(() => {
        const m = __ec.theme().shadowRoot.querySelector("main");
        return m.getBoundingClientRect().top;
      });
      await page.mouse.move(...at);
      await page.mouse.down();
      for (let i = 1; i <= 12; i++) await page.mouse.move(at[0], at[1] - ((at[1] - main - 4) * i) / 12);
      // auto-scroll to the top, under the pointer at the content's top edge
      await ctx.sleep(1500);
      await page.mouse.up();
      await ctx.sleep(600);
      const after = await order();
      check("A section dragged to the top of the page stays below the hero", after[0] === "oer-cs-hero" && after.indexOf("oer-cs-tools") < before.indexOf("oer-cs-tools") && after.includes("oer-cs-tools"), after.join(" "));
      await ctx.exitEdit({ discard: true });

      // Escape mid-drag cancels it for the rest of the press: moving on with
      // the button down doesn't start it again, and letting go drops nothing
      await ctx.open(SITE);
      await ctx.enterEdit();
      await clickPadding("oer-cs-tools");
      const start = await order();
      const grip = await page.evaluate(() => {
        const r = document.querySelector("oer-block-frame").shadowRoot.querySelector(".grip").getBoundingClientRect();
        return [r.left + r.width / 2, r.top + r.height / 2];
      });
      const gap = await page.evaluate((note) => {
        const r = [...__ec.haxBody().children].find((el) => el.localName === "p" && el.textContent.includes(note)).getBoundingClientRect();
        return [r.left + 40, r.top - 4];
      }, NOTE);
      const dragging = () => page.evaluate(() => globalThis.OerEditor.state.dragging);
      await page.mouse.move(...grip);
      await page.mouse.down();
      for (let i = 1; i <= 8; i++) await page.mouse.move(grip[0] + ((gap[0] - grip[0]) * i) / 8, grip[1] + ((gap[1] - grip[1]) * i) / 8);
      await ctx.sleep(300);
      const steps = { dragging: await dragging() };
      await ctx.press("Escape");
      await ctx.sleep(200);
      steps.cancelled = !(await dragging());
      await page.mouse.move(gap[0] + 3, gap[1] + 3);
      await page.mouse.move(gap[0] + 6, gap[1] + 6);
      await ctx.sleep(200);
      steps.movedOn = await dragging();
      await page.mouse.up();
      await ctx.sleep(600);
      steps.order = (await order()).join(" ");
      check(
        "Escape mid-drag cancels it: moving on with the button down doesn't start it again, and letting go moves nothing",
        steps.dragging && steps.cancelled && !steps.movedOn && steps.order === start.join(" "),
        json(steps),
      );
      // the browser taking the pointer away (pointercancel) ends the press
      // too: a later hover over the grip starts nothing
      const cancel = await page.evaluate(async () => {
        const grip = document.querySelector("oer-block-frame").shadowRoot.querySelector(".grip");
        const r = grip.getBoundingClientRect();
        const at = (type, dx, dy, buttons) => grip.dispatchEvent(new PointerEvent(type, { bubbles: true, composed: true, pointerId: 7, button: 0, buttons, clientX: r.left + 8 + dx, clientY: r.top + 8 + dy }));
        const dragging = () => globalThis.OerEditor.state.dragging;
        const frame = () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
        at("pointerdown", 0, 0, 1);
        at("pointermove", 0, 30, 1);
        await frame();
        const started = dragging();
        at("pointercancel", 0, 30, 0);
        await frame();
        const ended = !dragging();
        at("pointermove", 0, 60, 0);
        await frame();
        return { started, ended, hover: dragging() };
      });
      check("A pointercancel ends the drag and the press: moving over the grip afterwards starts nothing", cancel.started && cancel.ended && !cancel.hover, json(cancel));
      await ctx.exitEdit({ discard: true });
    });

    /* ---------- the frame and rail follow the editor's state ---------- */

    await part("source", async () => {
      const src = (name) => readFileSync(path.join(ctx.siteDir, "custom/src/editor", name), "utf8");
      const frame = src("oer-block-frame.js");
      const rail = src("oer-block-rail.js");
      const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      const loops = [frame, rail].filter((s) => /requestAnimationFrame\(this\.__tick\)/.test(code(s)));
      const flags = ["oer-block-frame.js", "oer-block-rail.js", "oer-block-inserter.js"].filter((n) => /__oerDragging/.test(code(src(n))));
      const lists = [frame, rail].filter((s) => /\bisSection\b|SECTION_TAGS|sectionOf\(/.test(code(s)));
      check("The frame and rail follow the editor's state: no animation loops of their own, no __oerDragging, no isSection or SECTION_TAGS", !loops.length && !flags.length && !lists.length, json({ loops: loops.length, flags, lists: lists.length }));
    });

    /* ---------- focus that can be seen and used (the WP-09 review) ---------- */

    await part("in view", async () => {
      await ctx.open(SITE);
      await ctx.enterEdit();
      await clickPadding("oer-cs-learn");
      // the next section with only its top 2px in view
      await page.evaluate(() => {
        const next = __ec.haxBody().querySelector("oer-cs-semester");
        const main = __ec.theme().shadowRoot.querySelector("main");
        main.scrollTop += next.getBoundingClientRect().top - (globalThis.OerEditor.state.geometry.view.bottom - 2);
      });
      await ctx.sleep(300);
      await ctx.press("ArrowDown");
      await ctx.sleep(400);
      const down = await tagSeen();
      check("ArrowDown to a section with 2px of it in view brings it into view: its name tag has focus inside the content view, uncovered", down.onTag && down.active === "oer-cs-semester" && down.inView && down.hit, json(down));
      await ctx.screenshot("arrow-down-into-view-1440");
      // Ctrl+` to the selection from far below it
      await clickField("oer-cs-hero > p");
      await page.evaluate(() => {
        const main = __ec.theme().shadowRoot.querySelector("main");
        main.scrollTop = main.scrollHeight;
      });
      await ctx.sleep(300);
      await toSelection();
      const region = await tagSeen();
      check("Ctrl+` to the selection from far below it brings the hero into view, its name tag focused and uncovered", region.onTag && region.selected === "oer-cs-hero" && region.inView && region.hit, json(region));
      await ctx.exitEdit({ discard: true });
    });

    await part("undo focus", async () => {
      await ctx.open(SITE);
      await ctx.enterEdit();
      await clickField("oer-cs-tool > p");
      await ctx.press("Escape");
      await ctx.sleep(300);
      await ctx.press("Escape");
      await ctx.sleep(400);
      const start = await order();
      const selected = await tagSeen();
      await ctx.press("Alt+Shift+ArrowUp");
      await ctx.sleep(800);
      await ctx.press("Mod+Z");
      await ctx.sleep(800);
      const undone = await tagSeen();
      check(
        "Undo of a move made from a name tag puts it back with the section still selected and focus on its name tag",
        selected.onTag && selected.active === "oer-cs-tools" && json(await order()) === json(start) && undone.onTag && undone.active === "oer-cs-tools" && undone.mode === "selected",
        json(undone),
      );
      await ctx.press("ArrowDown");
      await ctx.sleep(400);
      const next = await tagSeen();
      check("…and its keys still work: ArrowDown selects the next section", next.onTag && next.active === "oer-cs-faq", json(next));
      await ctx.press("Mod+Shift+KeyZ");
      await ctx.sleep(800);
      const redone = await tagSeen();
      const moved = await order();
      check("Redo of the move selects the moved section, focus on its name tag", moved.indexOf("oer-cs-tools") === start.indexOf("oer-cs-tools") - 1 && redone.onTag && redone.active === "oer-cs-tools", json({ redone, order: moved.join(" ") }));
      await page.evaluate(() => globalThis.OerEditor.ops.select(__ec.haxBody().querySelector("oer-cs-books")));
      await ctx.sleep(400);
      await ctx.press("Delete");
      await ctx.sleep(700);
      await ctx.press("Mod+Z");
      await ctx.sleep(800);
      const back = await tagSeen();
      check("Undo of a removal made from a name tag selects what came back, in view, focus on its name tag", back.onTag && back.active === "oer-cs-books" && back.mode === "selected" && back.inView && back.hit, json(back));
      await ctx.exitEdit({ discard: true });
    });

    await part("label keys", async () => {
      await ctx.open(SITE);
      await ctx.enterEdit();
      const note = await handle((note) => [...__ec.haxBody().children].find((el) => el.localName === "p" && el.textContent.includes(note)), NOTE);
      await note.evaluate((p) => p.scrollIntoView({ block: "center" }));
      await ctx.clickAt(note);
      await ctx.sleep(300);
      await ctx.press("Escape");
      await ctx.sleep(400);
      const tag = await tagSeen();
      await ctx.press("Tab");
      await ctx.sleep(200);
      const tabbed = await ctx.deepActiveElement();
      // (the layout button is Columns since WP-10)
      check("Tab from a block's name tag reaches the label's own buttons (Block settings, Columns)", tag.onTag && tag.active === "p" && /oer-block-frame/.test(tabbed?.path || "") && /^(Block settings|Columns)$/.test(tabbed?.name || ""), json({ tag: tag.focus, tabbed }));
      // a paragraph has no Block settings since WP-13 (text keeps no
      // settings): not on its label, nor among its name tag's actions
      const labelHas = await page.evaluate(() => !!document.querySelector("oer-block-frame").shadowRoot.querySelector('.label button[aria-label="Block settings"]'));
      await ctx.press("Shift+Tab");
      await ctx.sleep(150);
      await ctx.press("Shift+F10");
      await ctx.sleep(500);
      const noteActions = await page.evaluate(() => [...document.querySelector("oer-block-rail").shadowRoot.querySelectorAll(".menu [role^=menuitem] .text")].map((t) => t.textContent.trim()));
      await ctx.press("Escape");
      await ctx.sleep(300);
      check("A paragraph has no Block settings, on its label or among its name tag's actions", !labelHas && noteActions.length > 0 && !noteActions.includes("Block settings…"), json({ labelHas, noteActions }));
      await ctx.exitEdit({ discard: true });
      // a block with its own button (the rubric's Edit rubric) and settings
      await ctx.open(address(EXERCISE_ID));
      await ctx.enterEdit();
      const rubric = await handle(() => __ec.haxBody().querySelector("oer-rubric"));
      await rubric.evaluate((r) => r.scrollIntoView({ block: "center" }));
      await page.evaluate(() => globalThis.OerEditor.ops.select(__ec.haxBody().querySelector("oer-rubric")));
      await ctx.sleep(500);
      const onRubric = await tagSeen();
      const reached = [];
      for (let i = 0; i < 4; i++) {
        await ctx.press("Tab");
        await ctx.sleep(150);
        const f = await ctx.deepActiveElement();
        if (!/oer-block-frame/.test(f?.path || "")) break;
        reached.push(f.name);
      }
      check("Tab from the rubric's name tag reaches Block settings, Columns and Edit rubric", onRubric.onTag && ["Block settings", "Columns", "Edit rubric"].every((n) => reached.some((r) => r?.includes(n))), json({ tag: onRubric.focus, reached }));
      await page.evaluate(() => globalThis.OerEditor.ops.select(__ec.haxBody().querySelector("oer-rubric")));
      await ctx.sleep(400);
      await ctx.press("Shift+F10");
      await ctx.sleep(500);
      const actions = await page.evaluate(() => [...document.querySelector("oer-block-rail").shadowRoot.querySelectorAll(".menu [role^=menuitem] .text")].map((t) => t.textContent.trim()));
      await ctx.press("Escape");
      await ctx.sleep(300);
      check("Shift+F10 on the rubric's name tag offers Block settings… and Edit rubric among its actions", actions.includes("Block settings…") && actions.includes("Edit rubric"), actions.join(", "));
      // Block settings gives focus back to what opened it as it closes: the
      // label's button, the name tag (Shift+F10)
      const settingsBack = async (open) => {
        await open();
        await ctx.sleep(600);
        const opened = await page.evaluate(() => document.querySelector("oer-settings-dialog")?.mode === "settings");
        await ctx.press("Escape");
        await ctx.sleep(500);
        const f = await ctx.deepActiveElement();
        const onTag = await page.evaluate(() => !!__ec.activeElement()?.classList?.contains("tag"));
        return { opened, back: f?.path, name: f?.name?.slice(0, 40), onTag };
      };
      const reach = async (name, limit) => {
        for (let i = 0; i < limit && (await ctx.deepActiveElement())?.name !== name; i++) {
          await ctx.press("ArrowDown");
          await ctx.sleep(80);
        }
      };
      const back = {};
      await page.evaluate(() => globalThis.OerEditor.ops.select(__ec.haxBody().querySelector("oer-rubric")));
      await ctx.sleep(400);
      back.button = await settingsBack(async () => {
        for (let i = 0; i < 4 && (await ctx.deepActiveElement())?.name !== "Block settings"; i++) await ctx.press("Tab");
        if ((await ctx.deepActiveElement())?.name === "Block settings") await ctx.press("Enter");
      });
      await page.evaluate(() => globalThis.OerEditor.ops.select(__ec.haxBody().querySelector("oer-rubric")));
      await ctx.sleep(400);
      back.tag = await settingsBack(async () => {
        await ctx.press("Shift+F10");
        await ctx.sleep(500);
        await reach("Block settings…", 25);
        if ((await ctx.deepActiveElement())?.name === "Block settings…") await ctx.press("Enter");
      });
      check(
        "Block settings gives focus back to what opened it: the label's button, the name tag (Shift+F10)",
        back.button.opened && /oer-block-frame/.test(back.button.back || "") && back.button.name === "Block settings" && back.tag.opened && /oer-block-frame/.test(back.tag.back || "") && back.tag.onTag,
        json(back),
      );
      await ctx.exitEdit({ discard: true });
    });

    await part("handle steps", async () => {
      const steps = (where) =>
        page.evaluate((where) => {
          const root = where === "dock" ? document.querySelector("oer-block-rail").shadowRoot : document.querySelector("oer-block-frame").shadowRoot;
          const scope = where === "dock" ? ".dock .rail" : ".handle";
          const one = (label) => {
            const b = root.querySelector(`${scope} .step[aria-label="${label}"]`);
            return b ? { off: b.getAttribute("aria-disabled") === "true", title: b.title } : null;
          };
          const p = __ec.haxStore().activeNode;
          return { up: one("Move up"), down: one("Move down"), index: [...p.parentElement.children].indexOf(p) };
        }, where);
      const press = async (where, label) => {
        const b = await handle(
          (where, label) => {
            const root = where === "dock" ? document.querySelector("oer-block-rail").shadowRoot : document.querySelector("oer-block-frame").shadowRoot;
            return root.querySelector(`${where === "dock" ? ".dock .rail" : ".handle"} .step[aria-label="${label}"]`);
          },
          where,
          label,
        );
        await ctx.clickAt(b);
        await ctx.sleep(700);
      };
      for (const [width, where] of [
        [1440, "handle"],
        [390, "dock"],
      ]) {
        await ctx.setViewport(width);
        await ctx.open(address(LESSON_ID));
        await ctx.enterEdit();
        const first = await handle(() => [...__ec.haxBody().children].find((c) => c.localName === "p"));
        await first.evaluate((p) => p.scrollIntoView({ block: "center" }));
        await ctx.clickAt(first);
        await ctx.sleep(300);
        await ctx.press("Escape");
        await ctx.sleep(400);
        const before = await steps(where);
        await press(where, "Move down");
        const moved = await steps(where);
        await press(where, "Move up");
        const back = await steps(where);
        check(
          `At ${width}, after a block moves down from first, the ${where === "dock" ? "dock's" : "handle's"} Move up is on again and moves it back`,
          before.up?.off && /Already first/.test(before.up.title) && moved.index === before.index + 1 && moved.up && !moved.up.off && back.index === before.index,
          json({ before, moved, back }),
        );
        await ctx.exitEdit({ discard: true });
      }
      await ctx.setViewport(1440);
    });

    await part("layers", async () => {
      const showStyle = () =>
        page.evaluate(() => (document.querySelector("oer-site-style") || document.body.appendChild(document.createElement("oer-site-style"))).show(__ec.store().activeItem));
      // points over the Style sheet that something else would take
      const styleCovered = () =>
        page.evaluate(() => {
          const host = document.querySelector("oer-site-style");
          const r = host.shadowRoot.querySelector(".sheet").getBoundingClientRect();
          const misses = [];
          for (let y = r.top + 4; y < r.bottom - 4; y += 20) {
            for (let x = r.left + 4; x < r.right - 4; x += 20) {
              const hit = __ec.elementAt(x, y);
              if (!__ec.within(hit, host)) misses.push(`${Math.round(x)},${Math.round(y)} ${__ec.describe(hit)?.path}`);
            }
          }
          const at = (label) => {
            const b = [...host.shadowRoot.querySelectorAll("footer button")].find((x) => x.textContent.trim() === label);
            const br = b?.getBoundingClientRect();
            return br ? __ec.within(__ec.elementAt(br.left + br.width / 2, br.top + br.height / 2), b) : null;
          };
          return { misses: misses.slice(0, 4), count: misses.length, cancel: at("Cancel"), save: at("Save style") };
        });
      await ctx.open(SITE);
      await ctx.enterEdit();
      await clickPadding("oer-cs-learn");
      await showStyle();
      await ctx.sleep(500);
      const wide = await styleCovered();
      await ctx.screenshot("style-over-chrome-1440");
      await ctx.press("Escape");
      await ctx.sleep(300);
      check("At 1440 the Style sheet paints above the selection's frame and rail", wide.count === 0 && wide.cancel && wide.save, json(wide));
      // the block list paints above the rail
      await clickPadding("oer-cs-facts");
      await runRail("Section", "Add below…");
      const list = await page.evaluate(() => {
        const ins = document.querySelector("oer-block-inserter");
        const panel = ins.shadowRoot.querySelector(".panel");
        const railHost = document.querySelector("oer-block-rail");
        const rail = railHost.shadowRoot.querySelector(".rail");
        if (!panel) return { panel: false };
        if (!rail || !__ec.visible(rail)) return { panel: true, rail: false };
        const p = panel.getBoundingClientRect();
        const r = rail.getBoundingClientRect();
        const box = { left: Math.max(p.left, r.left), top: Math.max(p.top, r.top), right: Math.min(p.right, r.right), bottom: Math.min(p.bottom, r.bottom) };
        if (box.right <= box.left || box.bottom <= box.top) return { panel: true, overlap: false };
        const hit = __ec.elementAt((box.left + box.right) / 2, (box.top + box.bottom) / 2);
        return { panel: true, overlap: true, inserter: __ec.within(hit, ins), hit: __ec.describe(hit)?.path };
      });
      await page.evaluate(() => document.querySelector("oer-block-inserter").close());
      check("The block list opened from the rail paints above the rail", list.panel && (list.rail === false || list.overlap === false || list.inserter), json(list));
      await ctx.exitEdit({ discard: true });
      // phones: the Style sheet's buttons above the dock, the toast above it too
      await ctx.setViewport(390);
      await ctx.open(SITE);
      await ctx.enterEdit();
      await clickField("oer-cs-hero > p");
      await ctx.press("Escape");
      await ctx.sleep(400);
      await showStyle();
      await ctx.sleep(500);
      const phone = await styleCovered();
      await ctx.screenshot("style-over-dock-390");
      await ctx.press("Escape");
      await ctx.sleep(300);
      check("At 390 the Style sheet's Cancel and Save style are above the dock", phone.cancel && phone.save, json(phone));
      await page.evaluate(() => globalThis.OerEditor.ops.select(__ec.haxBody().querySelector("oer-cs-books")));
      await ctx.sleep(400);
      await ctx.press("Delete");
      await ctx.sleep(700);
      const toast = await page.evaluate(() => {
        const t = document.querySelector("oer-toast")?.shadowRoot?.querySelector(".toast")?.getBoundingClientRect();
        const dock = document.querySelector("oer-block-rail").shadowRoot.querySelector(".dock")?.getBoundingClientRect();
        const f = __ec.activeElement();
        const r = f?.getBoundingClientRect();
        const hit = r ? __ec.elementAt(r.left + r.width / 2, r.top + r.height / 2) : null;
        return { toast: t && [Math.round(t.top), Math.round(t.bottom)], dock: dock && [Math.round(dock.top), Math.round(dock.bottom)], onTag: !!f?.classList?.contains("tag"), tagHit: !!hit && hit === f };
      });
      await ctx.screenshot("toast-over-dock-390");
      check("At 390 the Undo toast sits above the dock, leaving the focused name tag uncovered", toast.toast && toast.dock && toast.toast[1] <= toast.dock[0] && toast.onTag && toast.tagHit, json(toast));
      await ctx.exitEdit({ discard: true });
      await ctx.setViewport(1440);
    });

    await part("rail clip", async () => {
      await ctx.open(SITE);
      await ctx.enterEdit();
      await clickPadding("oer-cs-learn");
      for (const left of [30, 10]) {
        await page.evaluate((left) => {
          const learn = __ec.haxBody().querySelector("oer-cs-learn");
          const main = __ec.theme().shadowRoot.querySelector("main");
          main.scrollTop += learn.getBoundingClientRect().bottom - globalThis.OerEditor.state.geometry.view.top - left;
        }, left);
        await ctx.sleep(300);
        const r = await page.evaluate(() => {
          const host = document.querySelector("oer-block-rail");
          const rail = host.shadowRoot.querySelector(".rail");
          const view = globalThis.OerEditor.state.geometry.view;
          if (!rail || !__ec.visible(rail)) return { shown: false };
          const box = rail.getBoundingClientRect();
          const onBar = [];
          for (let y = Math.max(1, box.top + 2); y < view.top; y += 4) if (__ec.within(__ec.elementAt(box.left + 12, y), host)) onBar.push(Math.round(y));
          return { shown: true, top: Math.round(box.top), viewTop: view.top, onBar };
        });
        check(`With ${left}px of the selected section left below the bar, the rail doesn't paint over the bar`, !r.shown || !r.onBar.length, json(r));
      }
      await ctx.exitEdit({ discard: true });
      // beside columns wider than the reading column, the rail keeps clear of the handle
      writeFileSync(file, PAGE.replace(`<p>${NOTE}</p>`, `<p>${NOTE}</p>\n<grid-plate layout="1-1" width="wide"><p slot="col-1">Left column, a sentence or two.</p><p slot="col-2">Right column, a sentence or two.</p></grid-plate>`));
      try {
        await ctx.open(SITE);
        await ctx.enterEdit();
        await clickField('grid-plate > p[slot="col-1"]');
        const r = await page.evaluate(() => {
          const box = (el) => {
            const b = el?.getBoundingClientRect();
            return b && __ec.visible(el) ? { left: Math.round(b.left), top: Math.round(b.top), right: Math.round(b.right), bottom: Math.round(b.bottom) } : null;
          };
          return { rail: box(document.querySelector("oer-block-rail").shadowRoot.querySelector(".rail")), handle: box(document.querySelector("oer-block-frame").shadowRoot.querySelector(".handle")) };
        });
        const apart = r.rail && r.handle && (r.rail.right <= r.handle.left || r.rail.bottom <= r.handle.top || r.rail.top >= r.handle.bottom);
        check("Beside wide columns the rail keeps clear of the frame's handle", apart, json(r));
        await ctx.screenshot("rail-wide-columns-1440");
        await ctx.exitEdit({ discard: true });
      } finally {
        writeFileSync(file, PAGE);
      }
    });

    await part("click again", async () => {
      await ctx.open(SITE);
      await ctx.enterEdit();
      await clickPadding("oer-cs-tools");
      await clickPadding("oer-cs-tools");
      const twice = await tagSeen();
      await ctx.press("ArrowDown");
      await ctx.sleep(400);
      const after = await tagSeen();
      check("A second click on a selected section's padding keeps focus on its name tag, whose keys still work", twice.onTag && twice.active === "oer-cs-tools" && after.onTag && after.active === "oer-cs-faq", json({ twice, after }));
      await clickPadding("oer-cs-facts");
      await clickPadding("oer-cs-facts");
      const facts = await tagSeen();
      await ctx.press("Delete");
      await ctx.sleep(700);
      const gone = await page.evaluate(() => !__ec.haxBody().querySelector("oer-cs-facts"));
      check("…a generated section's too (Facts), so Delete then removes it", facts.onTag && facts.active === "oer-cs-facts" && gone, json({ facts, gone }));
      await ctx.exitEdit({ discard: true });
    });

    await part("kept caret", async () => {
      await ctx.open(SITE);
      await ctx.enterEdit();
      await clickField("oer-cs-hero > p");
      await ctx.press("End");
      await ctx.type("ab");
      await ctx.press("Control+Backquote");
      await ctx.sleep(300);
      await clickPadding("oer-cs-tools");
      await ctx.press("Control+Backquote");
      await ctx.sleep(400);
      await ctx.type("Z");
      await ctx.sleep(300);
      const text = await page.evaluate(() => ({ hero: __ec.haxBody().querySelector("oer-cs-hero > p").textContent, tools: __ec.haxBody().querySelector("oer-cs-tools > h2").textContent }));
      check("Ctrl+` back to the content after selecting another unit goes into that unit, not to the caret kept from before", !text.hero.includes("Z") && text.tools.includes("Z"), json(text));
      await ctx.exitEdit({ discard: true });
    });

    await part("block list", async () => {
      await ctx.open(SITE);
      await ctx.enterEdit();
      await clickPadding("oer-cs-tools");
      await ctx.press("Shift+F10");
      await ctx.sleep(400);
      for (let i = 0; i < 8 && (await ctx.deepActiveElement())?.name !== "Add below…"; i++) {
        await ctx.press("ArrowDown");
        await ctx.sleep(100);
      }
      await ctx.press("Enter");
      await ctx.sleep(500);
      const opened = await inInserter();
      await ctx.press("Escape");
      await ctx.sleep(400);
      const back = await tagSeen();
      check("Escape out of the block list opened from a name tag's actions (Add below…) goes back to the name tag", opened && back.onTag && back.active === "oer-cs-tools", json({ opened, back: back.focus }));
      await ctx.press("Mod+Enter");
      await ctx.sleep(500);
      const opened2 = await inInserter();
      await ctx.press("Escape");
      await ctx.sleep(400);
      const back2 = await tagSeen();
      check("…and from Mod+Enter on the name tag", opened2 && back2.onTag && back2.active === "oer-cs-tools", json({ opened: opened2, back: back2.focus }));
      // the grip is for the pointer: its name doesn't promise keys it can't take
      const grip = await page.evaluate(() => {
        const g = document.querySelector("oer-block-frame").shadowRoot.querySelector(".grip");
        return { name: g?.getAttribute("aria-label"), title: g?.title, tabindex: g?.getAttribute("tabindex") };
      });
      check("The handle's grip doesn't say it takes arrow keys it can never get", grip.name && !/press the arrow keys/i.test(`${grip.name} ${grip.title}`), json(grip));
      await ctx.exitEdit({ discard: true });
    });

    /* ---------- axe ---------- */

    await part("axe", async () => {
      await ctx.open(SITE);
      await ctx.enterEdit();
      await clickField("oer-cs-outcome:nth-of-type(2) > h3");
      await ctx.press("Escape");
      await ctx.sleep(400);
      await railMenu("Outcome");
      const result = await ctx.axe({ context: { include: [["oer-block-frame"], ["oer-block-rail"]] } });
      const bad = [...result.byImpact.critical, ...result.byImpact.serious];
      check("axe reports no serious or critical violations in the frame and rail (an outcome selected, its menu open)", !bad.length, bad.map((r) => `${r.id}: ${json(r.targets)}`).join("; ") || `${result.violations} minor or moderate`);
      await closeMenus();
      await ctx.exitEdit({ discard: true });
    });

    /* ---------- phones: the dock ---------- */

    await part("phone", async () => {
      await ctx.setViewport(390);
      await ctx.open(SITE);
      await ctx.enterEdit();
      await clickField("oer-cs-outcome:nth-of-type(2) > h3");
      await ctx.press("Escape");
      await ctx.sleep(500);
      const m = await page.evaluate(() => {
        const main = __ec.theme().shadowRoot.querySelector("main");
        const learn = __ec.haxBody().querySelector("oer-cs-learn").getBoundingClientRect();
        const rail = document.querySelector("oer-block-rail");
        const dock = rail.hasAttribute("dock") ? rail.shadowRoot.querySelector(".dock").getBoundingClientRect() : null;
        return {
          dock: dock && { top: Math.round(dock.top), bottom: Math.round(dock.bottom), left: Math.round(dock.left), right: Math.round(dock.right) },
          height: innerHeight,
          width: innerWidth,
          section: { left: Math.round(learn.left), width: Math.round(learn.width) },
          main: { scroll: main.scrollWidth, client: main.clientWidth },
          doc: { scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth },
          // what runs past the window's right edge, but the editing bar
          // (the theme's editor header, which the editing bar of WP-11
          // replaces) and HAX's hidden stock bar
          over: (() => {
            const found = [];
            const bar = __ec.theme().shadowRoot.querySelector("header.topbar");
            const walk = (root) => {
              for (const el of root.querySelectorAll("*")) {
                if (el.closest("haxcms-site-editor-ui") || bar?.contains(el)) continue;
                const r = el.getBoundingClientRect();
                if (r.width > 0 && r.right > innerWidth + 0.5) found.push(`${__ec.describe(el).path} ${Math.round(r.right)}`);
                if (el.shadowRoot) walk(el.shadowRoot);
              }
            };
            walk(document);
            return found.slice(0, 5);
          })(),
          frameHandle: __ec.visible(document.querySelector("oer-block-frame").shadowRoot.querySelector(".handle")),
        };
      });
      const tools = await now();
      check(
        "At 390 the dock sits at the bottom with the label and the tools, and no rail or handle occupies a left gutter (sections start at 0, full width)",
        m.dock && Math.abs(m.dock.bottom - m.height) <= 1 && m.dock.left === 0 && m.dock.right === m.width && !m.frameHandle && m.section.left === 0 && m.section.width === m.width && tools.dockLabel.startsWith("What you'll learn › Outcome 2 of 3") && tools.onTag,
        json({ ...m, dockLabel: tools.dockLabel, onTag: tools.onTag, cats: tools.cats }),
      );
      check(
        "At 390 the page has no horizontal scroll while editing (main none, and nothing past the window's edge but the editing bar, WP-11's)",
        m.main.scroll <= m.main.client && !m.over.length,
        json({ main: m.main, doc: m.doc, over: m.over }),
      );
      await ctx.screenshot("dock-390");
      // the crumb's › shows between the crumb and the name tag
      const crumb = await page.evaluate(() =>
        [...document.querySelector("oer-block-rail").shadowRoot.querySelector(".dock-label").children].slice(0, 3).map((c) => {
          const r = c.getBoundingClientRect();
          return { cls: c.className, text: c.textContent.trim(), left: Math.round(r.left), right: Math.round(r.right), height: Math.round(r.height) };
        }),
      );
      const [cr, sep, tg] = crumb;
      check(
        "The dock's label shows the › between the crumb and the name tag, clear of both",
        cr?.cls === "crumb" && sep?.text === "›" && sep.height >= 10 && sep.left >= cr.right && tg?.cls === "tag" && tg.left >= sep.right,
        json(crumb),
      );
      // the ring stays below the bar as the page scrolls under it
      await page.evaluate(() => {
        const learn = __ec.haxBody().querySelector("oer-cs-learn");
        scrollTo(0, learn.getBoundingClientRect().top + scrollY - 20);
      });
      await ctx.sleep(400);
      const clip = await page.evaluate(() => {
        const frame = document.querySelector("oer-block-frame");
        const bar = __ec.theme().shadowRoot.querySelector("oer-edit-bar, header.topbar").getBoundingClientRect();
        const view = globalThis.OerEditor.state.geometry.view;
        return { clip: getComputedStyle(frame).clipPath, barBottom: Math.round(bar.bottom), viewTop: view.top, viewBottom: view.bottom, ring: Math.round(frame.shadowRoot.querySelector(".ring").getBoundingClientRect().top) };
      });
      const clipTop = Number((clip.clip.match(/inset\(([\d.]+)px/) || [])[1]);
      check("At 390 the frame is clipped to the content view, below the bar and above the dock", clipTop >= clip.barBottom && clip.viewBottom <= m.dock.top + 1, json(clip));
      // the dock's tools work: Section ▾ opens upward
      const menu = await railMenu("Section");
      const menuBox = await page.evaluate(() => {
        const r = document.querySelector("oer-block-rail").shadowRoot.querySelector(".menu").getBoundingClientRect();
        return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) };
      });
      await closeMenus();
      check("…and its Section menu opens above it, inside the window", menu.length > 3 && menuBox.bottom <= m.dock.top && menuBox.top >= 0 && menuBox.left >= 0 && menuBox.right <= m.width, json(menuBox));
      // the dock's tools follow the level: none of the text's on the
      // outcome's name tag, and Format kept as Alt+F10 leaves its sentence
      await clickField("oer-cs-outcome:nth-of-type(2) > p");
      const docked = { typing: (await now()).cats };
      await ctx.press("Alt+F10");
      await ctx.sleep(400);
      const there = await now();
      docked.keys = there.cats;
      docked.focus = there.focus;
      await ctx.press("Escape");
      await ctx.sleep(300);
      await ctx.press("Escape");
      await ctx.sleep(400);
      const tagged = await now();
      docked.tag = tagged.cats;
      docked.onTag = tagged.onTag;
      check(
        "At 390 the dock keeps Format as Alt+F10 leaves an outcome's sentence, and shows Section and Outcome only on its name tag",
        tools.cats.join() === "Section,Outcome" && docked.typing.includes("Format") && json(docked.keys) === json(docked.typing) && /oer-block-rail/.test(docked.focus || "") && docked.onTag && docked.tag.join() === "Section,Outcome",
        json({ ...docked, first: tools.cats }),
      );
      await ctx.exitEdit({ discard: true });

      // a paragraph's ring at 390 is outside its text (docked, there's no
      // handle to make room for), typing and selected
      await ctx.open(address(LESSON_ID));
      await ctx.enterEdit();
      const para = await handle(() => [...__ec.haxBody().children].find((el) => el.localName === "p" && el.textContent.trim().length > 40));
      await para.evaluate((p) => p.scrollIntoView({ block: "center" }));
      await ctx.sleep(200);
      await ctx.clickAt(para);
      await ctx.sleep(400);
      const ringed = () =>
        page.evaluate(() => {
          const unit = globalThis.OerEditor.state.unit;
          const ring = document.querySelector("oer-block-frame").shadowRoot.querySelector(".ring").getBoundingClientRect();
          const range = document.createRange();
          range.selectNodeContents(unit);
          const text = range.getBoundingClientRect();
          // the ring's 2px line and its 1px halos stay off the text
          const clear = ring.left + 3 <= text.left && ring.right - 3 >= text.right && ring.top + 3 <= text.top && ring.bottom - 3 >= text.bottom;
          return { mode: globalThis.OerEditor.state.mode, unit: unit?.localName, clear, ring: [ring.left, ring.top, ring.right, ring.bottom].map(Math.round), text: [text.left, text.top, text.right, text.bottom].map(Math.round) };
        });
      const typed = await ringed();
      await ctx.press("Escape");
      await ctx.sleep(400);
      const chosen = await ringed();
      check(
        "At 390 a paragraph's ring is drawn outside its text, typing and selected",
        typed.mode === "typing" && typed.unit === "p" && typed.clear && chosen.mode === "selected" && chosen.unit === "p" && chosen.clear,
        json({ typed, chosen }),
      );
      await ctx.screenshot("paragraph-ring-390");
      await ctx.exitEdit({ discard: true });
      await ctx.setViewport(1440);
    });
  } finally {
    writeFileSync(file, original);
  }
  return results;
}
