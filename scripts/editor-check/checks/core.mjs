// The editor core (WP-05): one store for what's selected and whether the
// page has unsaved changes (editor-state.js); ops.js as the one way to change
// the page's structure, each change one undo step and said in the live
// region; Undo putting the caret back (undo.js); the toast's Undo; hiding a
// section from readers; and editorControl(), which keeps a block's own
// controls (the hero's image field) from HAX.
//
// Fixtures are written into the copy's pages and put back at the end:
// today's course site with text in it (What you'll learn's list becomes
// outcomes as editing begins, since WP-07), and a lesson holding a test section
// of test items, oer-test-list and oer-test-item, which this check defines
// in the page (the real items are WP-07's), plus columns. One part saves the
// course site in the copy, to read it as readers do. Since WP-08 the tools'
// list becomes tools as editing begins (fields typed in are a tool's p), and
// the hero's image field opens from Change image on its picture.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

// the pages, by id (a save can give a page a new address)
const SITE_ID = "item-0330a29b-7735-4ac0-afd2-e3b2a88d49e3";
const LESSON_ID = "item-143f3783-959c-45c3-8758-dacef0f6861f";
// HAX puts the caret in a quiz's first paragraph as editing begins
const QUIZ = "/quizzes/camera-and-composition-quiz";
// a lecture with an editable-table, which rewrites its white space as it starts
const TABLE_LECTURE = "/lectures/bits-to-atoms-the-digital-physical-loop";

// a new course site's sections, empty (types/course-site.js): earlier
// checks save a tagline and blocks between sections into the copy
const STARTER_PAGE = `<oer-cs-hero><p></p></oer-cs-hero>
<oer-cs-facts></oer-cs-facts>
<oer-cs-learn><ul><li></li></ul></oer-cs-learn>
<oer-cs-semester></oer-cs-semester>
<oer-cs-make></oer-cs-make>
<oer-cs-people><p></p></oer-cs-people>
<oer-cs-tools><ul><li></li></ul></oer-cs-tools>
<oer-cs-faq><h3></h3><p></p></oer-cs-faq>
<oer-cs-closing></oer-cs-closing>
`;
// today's markup with text in it (as hax-layer.mjs has it)
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
// a section of items, and blocks in columns, on an ordinary page
const ITEMS_PAGE = `<p>Before the list.</p>
<oer-test-list><h2>Test list</h2><oer-test-item><h3>First</h3><p>One.</p></oer-test-item><oer-test-item><h3>Second</h3><p>Two.</p></oer-test-item></oer-test-list>
<p>After the list.</p>
<grid-plate layout="1-1"><p slot="col-1">Column one, first.</p><p slot="col-1">Column one, second.</p><p slot="col-2">Column two.</p></grid-plate>
`;

/* ---------- in the page ---------- */

// the test section and item: what WP-07's will be, as far as ops.js needs
// (a section whose items are HAX grids, with oerEditor policies)
function defineTestBlocks() {
  const gizmo = (title) => ({ title, description: "A test block for the editor checks.", icon: "icons:list", color: "blue", tags: ["Test"], meta: { author: "editor-check", hidden: true } });
  const props = (title, tag) => ({
    type: "grid",
    canScale: false,
    canEditSource: false,
    contentEditable: true,
    hideDefaultSettings: true,
    designSystem: false,
    gizmo: gizmo(title),
    settings: { configure: [], advanced: [] },
    demoSchema: [{ tag, properties: {}, content: "" }],
  });
  // (an empty field has a line's height, as the shared sheet gives fields
  // in WP-07, so the caret can go in it)
  const shadow = (el, css) => (el.attachShadow({ mode: "open" }).innerHTML = `<style>:host{display:block;${css}} ::slotted(*){min-block-size:1lh}</style><slot></slot>`);
  class TestList extends HTMLElement {
    static tag = "oer-test-list";
    static oerEditor = { kind: "section", label: "Test list", accepts: ["h2", "oer-test-item"], flow: "cards", fullBleed: false };
    static haxProperties = props("Test list", "oer-test-list");
    constructor() {
      super();
      shadow(this, "padding:1rem;border:1px solid #ccc");
    }
  }
  class TestItem extends HTMLElement {
    static tag = "oer-test-item";
    static oerEditor = { kind: "item", label: "Test item", fields: { h3: { name: "title", single: true, paste: "line" }, p: { name: "text" } } };
    static haxProperties = props("Test item", "oer-test-item");
    constructor() {
      super();
      shadow(this, "padding:0.5rem;margin:0.5rem 0;border:1px solid #ddd");
    }
  }
  for (const cls of [TestList, TestItem]) if (!customElements.get(cls.tag)) customElements.define(cls.tag, cls);
  // HAX registers blocks once its app store has loaded (blocks/register.js)
  const poll = setInterval(() => {
    const hax = globalThis.HaxStore?.requestAvailability?.();
    if (!hax?.appStoreLoaded) return;
    for (const cls of [TestList, TestItem]) if (!hax.elementList?.[cls.tag]) hax.setHaxProperties(cls.haxProperties, cls.tag);
    clearInterval(poll);
  }, 100);
}

// hax-body's HTML without what HAX changes while editing (as undo.js
// normalizes it: the harness's normalize() plus element-visible)
function snapshot() {
  const body = __ec.haxBody();
  return {
    shape: [...body.children].map((c) => c.localName).filter((t) => t !== "page-break").join(" "),
    html: __ec.normalize(body.innerHTML).replace(/\selement-visible(="[^"]*")?/g, ""),
  };
}

// the editor's state at a glance
function stateNow() {
  const s = globalThis.OerEditor.state;
  const describe = (el) => (el ? el.localName : null);
  return { editing: s.editing, tracking: s.tracking, dirty: s.dirty, mode: s.mode, level: s.level, unit: describe(s.unit), field: describe(s.field), active: describe(__ec.haxStore().activeNode), geometry: s.geometry };
}

// where the caret is, if it's in the content: its field, the section (or
// other block) it's in, the field's text and the offset in its text node
function caretNow() {
  const body = __ec.haxBody();
  const sel = body.getRootNode().getSelection();
  if (!sel.rangeCount || !body.contains(sel.anchorNode)) return null;
  const el = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
  const field = el.closest("p, li, h1, h2, h3, h4, h5, h6") || el;
  return { field: field.localName, in: [...body.children].find((c) => c.contains(el))?.localName ?? null, text: field.textContent, offset: sel.anchorOffset };
}

// the selection's anchor: its element, and the item and field around it
function anchor() {
  const body = __ec.haxBody();
  const sel = body.getRootNode().getSelection();
  const node = sel.anchorNode;
  const el = node?.nodeType === 1 ? node : node?.parentElement;
  const items = [...body.querySelectorAll("oer-test-item")];
  return { tag: el?.localName ?? null, field: el?.closest("h3, p")?.localName ?? null, item: el ? items.indexOf(el.closest("oer-test-item")) : -1, count: items.length, active: __ec.haxStore().activeNode?.localName ?? null };
}

export default async function core(ctx) {
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
  await page.evaluateOnNewDocument(defineTestBlocks);
  await page.evaluateOnNewDocument(`globalThis.__caretNow = ${caretNow.toString()}`);

  /* ---------- fixtures, in the copy only ---------- */

  const items = JSON.parse(readFileSync(path.join(ctx.siteDir, "site.json"), "utf8")).items;
  const address = (id) => `/${items.find((i) => i.id === id).slug}`;
  const SITE = address(SITE_ID);
  const LESSON = address(LESSON_ID);
  const pageFile = (id) => path.join(ctx.siteDir, "pages", id, "index.html");
  const originals = new Map();
  const write = (id, html) => {
    const file = pageFile(id);
    if (!originals.has(file)) originals.set(file, readFileSync(file, "utf8"));
    writeFileSync(file, html);
  };
  const putBack = (id) => {
    const file = pageFile(id);
    if (originals.has(file)) writeFileSync(file, originals.get(file));
  };
  write(SITE_ID, STARTER_PAGE);

  /* ---------- helpers ---------- */

  const handle = (fn, ...args) => page.evaluateHandle(fn, ...args);
  const snap = () => page.evaluate(snapshot);
  const state = () => page.evaluate(stateNow);
  const stack = () => page.evaluate(() => ({ position: __ec.haxBody().undoStack.undoStackPosition, canUndo: __ec.haxBody().undoStack.canUndo() }));
  // a fresh editing session on a page, once unsaved changes are followed
  const edit = async (pagePath) => {
    if (await ctx.editMode()) await ctx.exitEdit({ discard: true });
    await ctx.open(pagePath);
    await ctx.enterEdit();
    await ctx.waitFor(() => globalThis.OerEditor?.state.tracking, { what: "unsaved changes to be followed", timeout: 5000 });
  };
  const clickField = async (selector, index = 0) => {
    const el = await handle((s, i) => __ec.haxBody().querySelectorAll(s)[i] || null, selector, index);
    if (!el.asElement()) throw new Error(`No ${selector} [${index}] in hax-body`);
    await el.evaluate((f) => f.scrollIntoView({ block: "center" }));
    await ctx.frames();
    await ctx.clickAt(el);
    await ctx.sleep(300);
  };
  // run an op in the page on the first element matching selector
  const op = (name, selector, ...args) =>
    page.evaluate(
      async (name, selector, args) => {
        const el = __ec.haxBody().querySelector(selector);
        if (!el) throw new Error(`No ${selector}`);
        const result = await globalThis.OerEditor.ops[name](el, ...args);
        return result instanceof Element ? result.localName : result;
      },
      name,
      selector,
      args,
    );
  // the polite region's words, once they've been said
  const said = async (pattern, what) => {
    try {
      await ctx.waitFor((source) => new RegExp(source).test(__ec.liveRegions().map((r) => r.text).join(" | ")), { args: [pattern.source], what, timeout: 3000 });
    } catch {}
    return ctx.liveRegionText();
  };
  const toast = () =>
    page.evaluate(() => {
      const t = document.querySelector("oer-toast")?.shadowRoot;
      return [...(t?.querySelectorAll(".toast") || [])].map((el) => ({ text: el.querySelector(".text")?.textContent.trim(), action: el.querySelector("button.action")?.textContent.trim() || null }));
    });
  const dialog = () =>
    page.evaluate(() => {
      const d = __ec.openDialog();
      return d ? { title: d.querySelector("h2")?.textContent.trim(), buttons: [...d.querySelectorAll("button")].map((b) => b.textContent.trim()) } : null;
    });
  const answer = async (label) => {
    const button = await handle((label) => [...(__ec.openDialog()?.querySelectorAll("button") || [])].find((b) => b.textContent.trim() === label) || null, label);
    if (!button.asElement()) throw new Error(`The dialog has no ${label}`);
    await ctx.clickAt(button);
    await ctx.sleep(400);
  };

  try {
    /* ---------- unsaved changes ---------- */

    await part("unsaved changes", async () => {
      await edit(SITE);
      const entered = (await state()).dirty;
      // selecting things isn't a change
      for (const selector of ["oer-cs-hero > p", "oer-cs-people > p", "oer-cs-tool > p"]) await clickField(selector);
      await ctx.sleep(400);
      const clicked = (await state()).dirty;
      await clickField("oer-cs-hero > p");
      await ctx.type("x");
      await ctx.sleep(500);
      const typed = (await state()).dirty;
      await ctx.press("Mod+Z");
      await ctx.sleep(500);
      const undone = await state();
      const text = await page.evaluate(() => __ec.haxBody().querySelector("oer-cs-hero > p").textContent);
      check(
        "editorState.dirty is false on entering edit mode, true after typing one character, and false again after undoing it",
        entered === false && typed === true && undone.dirty === false && text === "",
        `entered ${entered}; after clicking three fields ${clicked}; typed ${typed}; undone ${undone.dirty} (tagline “${text}”)`,
      );
      check("Clicking fields isn't an unsaved change", clicked === false, `dirty ${clicked}`);
      // an Edit HTML round trip with no change (HAX adds white space between blocks)
      await page.evaluate(async () => {
        const body = __ec.haxBody();
        const html = await body.haxToContent();
        await body.importContent(html.replace(/></g, ">\n<"));
      });
      await ctx.sleep(600);
      const roundTrip = (await state()).dirty;
      check("Re-importing the same content with white space between blocks isn't an unsaved change", roundTrip === false, `dirty ${roundTrip}`);
    });

    // typed as soon as editing begins, before HAX has settled: still a change
    await part("typing at once", async () => {
      if (await ctx.editMode()) await ctx.exitEdit({ discard: true });
      await ctx.open(QUIZ);
      const button = await ctx.control("Edit content");
      if (button) await ctx.clickAt(button);
      else await page.evaluate(() => __ec.store().cmsSiteEditor.haxCmsSiteEditorUIElement._editButtonTap());
      // HAX has imported the page and has its own copy of it (a setTimeout(0)
      // after edit mode begins); the caret at the end of the first paragraph
      await ctx.waitFor(
        () => {
          const body = __ec.haxBody();
          return __ec.store()?.editMode && body?.editMode && !body._contentState?.getState("importing") && !!body.querySelector(":scope > p") && !!body.undoStackInitialValue?.includes("<p");
        },
        { polling: 5, what: "HAX's copy of the page", timeout: 15000 },
      );
      const early = await page.evaluate(() => {
        const body = __ec.haxBody();
        const p = body.querySelector(":scope > p");
        const range = document.createRange();
        range.selectNodeContents(p);
        range.collapse(false);
        body.focus({ preventScroll: true });
        const sel = body.getRootNode().getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        return { tracking: globalThis.OerEditor.state.tracking };
      });
      await ctx.type("Qz");
      await ctx.sleep(1500);
      const read = () => page.evaluate(() => ({ typed: __ec.haxBody().innerHTML.includes("Qz"), dirty: globalThis.OerEditor.state.dirty, tracking: globalThis.OerEditor.state.tracking }));
      const typed = await read();
      await ctx.press("Mod+Z");
      await ctx.sleep(800);
      const undone = await read();
      check(
        "Typing before unsaved changes are followed (HAX puts the caret in a quiz's first paragraph at once) is a change, and undoing it isn't",
        early.tracking === false && typed.typed && typed.dirty === true && !undone.typed && undone.dirty === false,
        `typed while followed: ${early.tracking}; typed ${json(typed)}; after Undo ${json(undone)}`,
      );
      await ctx.exitEdit({ discard: true });
    });

    await part("table page", async () => {
      await edit(TABLE_LECTURE);
      await ctx.sleep(1000);
      const entered = await page.evaluate(() => ({ canUndo: __ec.haxBody().undoStack.canUndo(), position: __ec.haxBody().undoStack.undoStackPosition, dirty: globalThis.OerEditor.state.dirty }));
      check("On a page with an editable-table, entering edit mode leaves nothing to undo and no unsaved changes", entered.canUndo === false && entered.dirty === false, json(entered));
      await ctx.exitEdit({ discard: true });
    });

    /* ---------- what's selected, and where ---------- */

    await part("state", async () => {
      await edit(SITE);
      await clickField("oer-cs-hero > p");
      const typing = await state();
      await page.evaluate(() => globalThis.OerEditor.ops.select(__ec.haxBody().querySelector("oer-cs-learn")));
      await ctx.sleep(200);
      const selected = await state();
      const caret = await page.evaluate(() => __ec.haxBody().getRootNode().getSelection().rangeCount);
      check(
        "Typing in a field is mode typing, level field; selecting a section is mode selected, level section, with no caret",
        typing.mode === "typing" && typing.level === "field" && typing.unit === "oer-cs-hero" && typing.field === "p" && selected.mode === "selected" && selected.level === "section" && selected.unit === "oer-cs-learn" && selected.active === "oer-cs-learn" && caret === 0,
        `typing ${json({ mode: typing.mode, level: typing.level, unit: typing.unit, field: typing.field })}; selected ${json({ mode: selected.mode, level: selected.level, unit: selected.unit, active: selected.active })}; ranges ${caret}`,
      );
      const g = selected.geometry;
      const inside = g?.visible && g.visible.top >= g.view.top && g.visible.bottom <= g.view.bottom && g.visible.left >= g.view.left && g.visible.right <= g.view.right;
      check("At 1440 the unit's rect is clipped to the content viewport below the bar, main scrolls, and the rail fits the gutter", inside && g.scroller === "main" && g.view.top >= 50 && g.dock === false && g.gutter >= 58, json(g));
      // the caret moved by the editor (not a click): HAX's active block follows it
      await page.evaluate(() => {
        const body = __ec.haxBody();
        const p = body.querySelector("oer-cs-people > p");
        body.focus();
        const range = document.createRange();
        range.selectNodeContents(p);
        range.collapse(true);
        const sel = body.getRootNode().getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      });
      await ctx.sleep(200);
      const followed = await state();
      check("When the caret goes into another field without a click, HAX's active block follows it", followed.active === "p" && followed.unit === "oer-cs-people" && followed.mode === "typing", json({ active: followed.active, unit: followed.unit, mode: followed.mode }));
      // after an Undo, HAX's active block is the one the step had, not the
      // first field, where the browser put the caret when its own went
      await ctx.type("abc");
      await ctx.sleep(600);
      await ctx.type("def");
      await ctx.press("Mod+Z");
      await ctx.sleep(600);
      const restored = await page.evaluate(() => {
        const a = __ec.haxStore().activeNode;
        return { tag: a?.localName, in: a?.parentElement?.localName, text: a?.textContent };
      });
      check("After an Undo, HAX's active block is the field the step put back, not the first field on the page", restored.in === "oer-cs-people" && restored.text === "abc", json(restored));
      // a click on a section's padding selects the section, though the
      // browser puts the caret in one of its fields
      await page.setViewport({ width: 768, height: 1024 });
      await ctx.frames();
      const padding = await page.evaluate(async () => {
        const learn = __ec.haxBody().querySelector("oer-cs-learn");
        learn.scrollIntoView({ block: "center" });
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const r = learn.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + 12) };
      });
      await ctx.clickAt(padding);
      await ctx.sleep(400);
      const clicked = await page.evaluate(() => ({ active: __ec.haxStore().activeNode?.localName, caret: globalThis.__caretNow()?.field ?? null, mode: OerEditor.state.mode, level: OerEditor.state.level, unit: OerEditor.state.unit?.localName }));
      check(
        "A click on a section's padding selects the section as a whole: no caret is left in its fields, and the store says selected",
        clicked.active === "oer-cs-learn" && clicked.caret === null && clicked.mode === "selected" && clicked.level === "section" && clicked.unit === "oer-cs-learn",
        json(clicked),
      );
      // Enter then edits it: the caret goes into its first field (its
      // heading, since the section model, WP-07)
      await ctx.press("Enter");
      await ctx.sleep(400);
      const entered = await page.evaluate(() => ({ caret: globalThis.__caretNow(), mode: OerEditor.state.mode, items: __ec.haxBody().querySelectorAll("oer-cs-learn oer-cs-outcome").length }));
      check(
        "Enter on a section selected as a whole puts the caret in its first field and adds nothing",
        entered.caret?.in === "oer-cs-learn" && entered.caret.field === "h2" && entered.mode === "typing" && entered.items === 1,
        json(entered),
      );
      await ctx.setViewport(390);
      await ctx.sleep(300);
      const phone = (await state()).geometry;
      check("At 390 the window scrolls and the selection's tools go in the dock", phone?.scroller === "window" && phone.dock === true, json(phone));
      // the rail clips to the same content view as the store: with the
      // selected section's top under the sticky bar, it stays below the bar
      await page.evaluate(() => {
        const learn = __ec.haxBody().querySelector("oer-cs-learn");
        globalThis.OerEditor.ops.select(learn, { focus: false });
        scrollTo(0, learn.getBoundingClientRect().top + scrollY + 40);
      });
      await ctx.sleep(500);
      const clipped = await page.evaluate(() => {
        const rail = document.querySelector("oer-block-rail");
        const box = rail?.hidden ? null : rail?.shadowRoot?.querySelector(".rail")?.getBoundingClientRect();
        return { view: globalThis.OerEditor.state.geometry?.view, unit: globalThis.OerEditor.state.geometry?.unit, rail: box ? Math.round(box.top) : null };
      });
      check(
        "At 390 the rail clips to the store's content view: with the section's top under the bar, the rail stays below the bar",
        clipped.unit?.top < clipped.view?.top && clipped.rail !== null && clipped.rail >= clipped.view.top,
        json(clipped),
      );
      await ctx.setViewport(1440);
      await ctx.exitEdit({ discard: true });
    });

    /* ---------- moving ---------- */

    await part("move", async () => {
      await edit(SITE);
      const before = (await snap()).shape;
      const position = await stack();
      // asked by the section itself, as a block asks
      await page.evaluate(() => __ec.haxBody().querySelector("oer-cs-tools").dispatchEvent(new CustomEvent("oer-edit-request", { bubbles: true, composed: true, detail: { action: "move", dir: -1 } })));
      const words = await said(/Tools moved to/, "the move to be said");
      const moved = (await snap()).shape;
      // (the starter's blocks are all sections)
      const order = before.split(" ");
      const n = order.indexOf("oer-cs-tools");
      const expected = [...order.slice(0, n - 1), "oer-cs-tools", order[n - 1], ...order.slice(n + 1)].join(" ");
      const sections = order.length;
      check(
        "ops.move on the Tools section moves it one place, and the polite region reads “Tools moved to N of M”",
        moved === expected && words.includes(`Tools moved to ${n} of ${sections}`),
        `${moved}; said “${words}”`,
      );
      const after = await stack();
      await ctx.press("Mod+Z");
      await ctx.sleep(500);
      const restored = (await snap()).shape;
      const undid = await said(/Undid: moved Tools up/, "the undo to be said");
      check("One Undo restores the order, and says what it undid", after.position === position.position + 1 && restored === before && undid.includes("Undid: moved Tools up"), `undo steps ${position.position}→${after.position}; ${restored}; said “${undid}”`);
      // pinned sections stay put, and say why
      const hero = await op("move", "oer-cs-hero", 1);
      const heroSaid = await said(/The hero stays at the top/, "the refusal to be said");
      const facts = await op("move", "oer-cs-facts", -1);
      const closing = await op("move", "oer-cs-closing", -1);
      const reasons = await page.evaluate(() => {
        const b = __ec.haxBody();
        const { whyNot } = globalThis.OerEditor.ops;
        return [whyNot("move", b.querySelector("oer-cs-hero"), { dir: -1 }), whyNot("move", b.querySelector("oer-cs-facts"), { dir: -1 }), whyNot("move", b.querySelector("oer-cs-closing"), { dir: 1 }), whyNot("duplicate", b.querySelector("oer-cs-tools"))];
      });
      const still = (await snap()).shape;
      check(
        "The hero and Ready to start don't move and nothing moves past them; each says why, as does Duplicate on a section",
        hero === false && facts === false && closing === false && still === before && heroSaid.includes("The hero stays at the top") && json(reasons) === json(["The hero stays at the top", "The hero stays at the top", "Ready to start stays at the end", "Only one per page"]),
        `${json(reasons)}; said “${heroSaid}”`,
      );
    });

    /* ---------- removing ---------- */

    await part("remove generated", async () => {
      await edit(SITE);
      const before = await snap();
      const gone = await op("remove", "oer-cs-make");
      await ctx.sleep(300);
      const after = await snap();
      const shown = await toast();
      const active = await page.evaluate(() => __ec.haxStore().activeNode?.localName);
      const words = await said(/removed/, "the removal to be said");
      check(
        "ops.remove on an empty generated section removes it at once, selects the section before, and shows a toast with Undo",
        gone === true && !after.shape.includes("oer-cs-make") && active === "oer-cs-semester" && shown.some((t) => t.text === "What you'll make removed" && t.action === "Undo") && /What you'll make removed\. Undo with/.test(words),
        `${after.shape}; active ${active}; toasts ${json(shown)}; said “${words}”`,
      );
      const undoButton = await handle(() => document.querySelector("oer-toast").shadowRoot.querySelector("button.action"));
      await ctx.clickAt(undoButton);
      await ctx.sleep(600);
      const restored = await snap();
      check("The toast's Undo restores identical normalized HTML", restored.html === before.html, restored.html === before.html ? restored.shape : `${restored.shape} | ${restored.html.slice(0, 160)}`);
    });

    await part("remove written", async () => {
      write(SITE_ID, TEXT_PAGE);
      await edit(SITE);
      const before = await snap();
      const asking = op("remove", "oer-cs-learn");
      await ctx.waitFor(() => !!__ec.openDialog(), { what: "the question before removing", timeout: 5000 });
      const asked = await dialog();
      check(
        "ops.remove on a written section with typed content asks first, counting what's in it, and offers “Hide it instead”",
        asked?.title === "Remove “What you'll learn” and its 2 outcomes?" && json(asked.buttons) === json(["Keep it", "Hide it instead", "Remove section"]),
        json(asked),
      );
      await answer("Hide it instead");
      await asking;
      const hidden = await page.evaluate(() => __ec.haxBody().querySelector("oer-cs-learn")?.hasAttribute("hidden-from-readers"));
      const words = await said(/hidden from readers/, "the hiding to be said");
      await ctx.press("Mod+Z");
      await ctx.sleep(500);
      const unhidden = await page.evaluate(() => __ec.haxBody().querySelector("oer-cs-learn")?.hasAttribute("hidden-from-readers"));
      check("Hide it instead hides the section from readers as one undo step", hidden === true && unhidden === false && words.includes("What you'll learn hidden from readers"), `hidden ${hidden}; after Undo ${unhidden}; said “${words}”`);
      // and Remove section removes it, which Undo puts back
      const removing = op("remove", "oer-cs-tools");
      await ctx.waitFor(() => !!__ec.openDialog(), { what: "the question before removing", timeout: 5000 });
      const tools = await dialog();
      await answer("Remove section");
      const gone = await removing;
      const after = await snap();
      await ctx.press("Mod+Z");
      await ctx.sleep(500);
      const back = await snap();
      check(
        "Remove section removes it, and one Undo puts it back",
        tools?.title === "Remove “Tools” and its 2 tools?" && gone === true && !after.shape.includes("oer-cs-tools") && back.html === before.html,
        `${tools?.title}; ${after.shape}; after Undo ${back.html === before.html ? "identical" : back.shape}`,
      );
      // Keep it leaves it be
      const keeping = op("remove", "oer-cs-people");
      await ctx.waitFor(() => !!__ec.openDialog(), { what: "the question before removing", timeout: 5000 });
      await answer("Keep it");
      const kept = await keeping;
      check("Keep it leaves the section and changes nothing", kept === false && (await snap()).html === before.html, `${kept}`);
      await ctx.exitEdit({ discard: true });
      write(SITE_ID, STARTER_PAGE);
    });

    /* ---------- the toast's Undo ---------- */

    await part("toast undo", async () => {
      write(SITE_ID, TEXT_PAGE);
      await edit(SITE);
      const removeSemester = () => page.evaluate(() => __ec.haxBody().querySelector("oer-cs-semester").dispatchEvent(new CustomEvent("oer-edit-request", { bubbles: true, composed: true, detail: { action: "remove" } })));
      const undoButton = () => handle(() => document.querySelector("oer-toast")?.shadowRoot.querySelector("button.action") || null);
      const where = () => page.evaluate(() => ({ focus: __ec.activeElement()?.localName, caret: globalThis.__caretNow(), semester: !!__ec.haxBody().querySelector("oer-cs-semester"), active: __ec.haxStore().activeNode?.localName }));
      // typing in the note, the semester removed (as a menu would), and the
      // toast's Undo clicked: back in the note
      await clickField("oer-cs-people > p");
      await ctx.press("End");
      await removeSemester();
      await ctx.sleep(600);
      await ctx.clickAt(await undoButton());
      await ctx.sleep(600);
      const clicked = await where();
      // and pressed with the keyboard
      await removeSemester();
      await ctx.sleep(600);
      await (await undoButton()).evaluate((b) => b.focus());
      await ctx.press("Enter");
      await ctx.sleep(600);
      const pressed = await where();
      const inNote = (w) => w.semester && w.focus === "hax-body" && w.caret?.in === "oer-cs-people" && w.caret.text === "A note from the instructor.";
      check("The toast's Undo puts the section back and focus back where it was: the caret in the note (clicked, and by the keyboard)", inNote(clicked) && inNote(pressed), `clicked ${json(clicked)}; pressed ${json(pressed)}`);
      // Tools selected as a whole when it went: Undo selects it again (a
      // generated section, selected, takes editing off the content, so focus
      // can go to it only once the selection frame has its name tag, WP-09)
      await page.evaluate(() => globalThis.OerEditor.ops.select(__ec.haxBody().querySelector("oer-cs-tools"), { focus: false }));
      await ctx.sleep(300);
      await page.evaluate(() => globalThis.OerEditor.ops.remove(__ec.haxBody().querySelector("oer-cs-tools"), { ask: false }));
      await ctx.sleep(600);
      await ctx.clickAt(await undoButton());
      await ctx.sleep(600);
      const unit = await page.evaluate(() => ({ focus: __ec.activeElement()?.localName, caret: globalThis.__caretNow(), tools: !!__ec.haxBody().querySelector("oer-cs-tools"), active: __ec.haxStore().activeNode?.localName, mode: globalThis.OerEditor.state.mode }));
      check("…and when the section itself was selected, Undo selects it again, with focus in the content and no caret", unit.tools && unit.active === "oer-cs-tools" && unit.focus === "hax-body" && unit.caret === null && unit.mode === "selected", json(unit));
      // a toast held by focus stays while the pointer comes and goes
      await page.evaluate(() => globalThis.OerEditor.ops.remove(__ec.haxBody().querySelector("oer-cs-facts")));
      await ctx.sleep(400);
      const box = await (await handle(() => document.querySelector("oer-toast").shadowRoot.querySelector(".toast"))).boundingBox();
      await page.mouse.move(box.x + 20, box.y + 10);
      await ctx.sleep(200);
      await (await undoButton()).evaluate((b) => b.focus());
      await page.mouse.move(5, 300);
      await ctx.sleep(9000);
      const held = { toasts: await toast(), focus: await ctx.deepActiveElement() };
      check("A toast with focus in it stays after the pointer leaves it, past its time", held.toasts.some((t) => t.text === "Facts removed") && held.focus?.name === "Undo", `${json(held.toasts)}; focus ${held.focus?.path}`);
      // leaving the editor puts the toasts offering Undo away
      await removeSemester();
      await ctx.sleep(400);
      const up = await toast();
      await page.evaluate(() => __ec.theme().shadowRoot.querySelector("main")?.scrollTo(0, 0));
      await ctx.sleep(300);
      await ctx.exitEdit({ discard: true });
      await ctx.sleep(300);
      const after = await toast();
      check("Leaving the editor puts away the toasts offering Undo", up.some((t) => t.action === "Undo") && !after.some((t) => t.action === "Undo"), `editing ${json(up)}; after ${json(after)}`);
      write(SITE_ID, STARTER_PAGE);
    });

    /* ---------- asking before removing, hiding ---------- */

    await part("asking", async () => {
      write(SITE_ID, STARTER_PAGE);
      await edit(SITE);
      // only the heading typed (an attribute, until WP-07), or only the
      // hero's image chosen: asked about all the same
      const asks = async (selector, name, value) => {
        await page.evaluate((selector, name, value) => globalThis.OerEditor.ops.setAttr(__ec.haxBody().querySelector(selector), name, value), selector, name, value);
        const removing = op("remove", selector);
        await ctx.waitFor(() => !!__ec.openDialog(), { what: "the question before removing", timeout: 3000 }).catch(() => {});
        const asked = await dialog();
        if (asked) await answer("Keep it");
        const kept = await removing;
        return { asked: asked?.title ?? null, kept: kept === false && (await page.evaluate((s) => !!__ec.haxBody().querySelector(s), selector)) };
      };
      const tools = await asks("oer-cs-tools", "heading", "In the shop");
      const hero = await asks("oer-cs-hero", "image", "/files/studio.jpg");
      check(
        "A written section is asked about before removing when what's written is in its attributes (its heading, the hero's image)",
        tools.asked === "Remove “Tools” and what's in it?" && tools.kept && hero.asked === "Remove “Hero” and what's in it?" && hero.kept,
        `${json(tools)}; ${json(hero)}`,
      );
      await ctx.exitEdit({ discard: true });
    });

    await part("hidden", async () => {
      write(SITE_ID, TEXT_PAGE);
      await edit(SITE);
      await op("hide", "oer-cs-faq");
      await ctx.sleep(300);
      await ctx.save();
      const saved = ctx.savedHtml(SITE_ID).match(/<oer-cs-faq[^>]*>/)?.[0] ?? null;
      const reader = await ctx.newPage();
      await reader.open(SITE, { signedOut: true });
      const seen = await reader.page.evaluate(() => {
        const faq = __ec.theme().querySelector("oer-cs-faq");
        const links = __ec.deep("oer-course-site")?.shadowRoot?.querySelector("nav.links");
        return { shown: !!faq?.checkVisibility(), height: faq?.getBoundingClientRect().height ?? null, links: [...(links?.querySelectorAll("button") || [])].map((b) => b.textContent.trim()) };
      });
      await reader.page.close();
      check(
        "A section hidden from readers is saved so, and readers don't see it or a link to it in the bar",
        /hidden-from-readers/.test(saved || "") && seen.shown === false && seen.height === 0 && !seen.links.includes("Questions") && seen.links.includes("What you'll learn"),
        `${saved}; reader ${json(seen)}`,
      );
      write(SITE_ID, STARTER_PAGE);
    });

    /* ---------- the editor's words ---------- */

    await part("wording", async () => {
      write(SITE_ID, TEXT_PAGE);
      await edit(SITE);
      // a refusal says what whyNot() says
      const reasons = await page.evaluate(() => {
        const b = __ec.haxBody();
        const { whyNot } = globalThis.OerEditor.ops;
        return { addItem: whyNot("add-item", b.querySelector("oer-cs-hero")), hide: whyNot("hide", b.querySelector("oer-cs-people")) };
      });
      await op("addItem", "oer-cs-hero");
      const addSaid = await said(new RegExp(reasons.addItem), "the refusal to be said");
      await op("hide", "oer-cs-people");
      await ctx.sleep(300);
      const again = await op("hide", "oer-cs-people");
      const hideSaid = await said(/Already hidden/, "the refusal to be said");
      check(
        "Doing what whyNot() refuses says the same reason (adding an item to the hero, hiding a hidden section)",
        reasons.addItem && addSaid.includes(reasons.addItem) && again === false && hideSaid.includes("Already hidden"),
        `whyNot ${json(reasons)}; said “${addSaid}”, then “${hideSaid}”`,
      );
      await ctx.press("Mod+Z");
      await ctx.sleep(500);
      // one written field: "its note", not "its 1 note"
      const removing = op("remove", "oer-cs-people");
      await ctx.waitFor(() => !!__ec.openDialog(), { what: "the question before removing", timeout: 3000 });
      const asked = await dialog();
      await answer("Keep it");
      await removing;
      // names in the middle of a sentence
      await op("remove", "oer-cs-semester");
      await ctx.sleep(300);
      await ctx.press("Mod+Z");
      const undidSemester = await said(/Undid: removed/, "the undo to be said");
      await ctx.exitEdit({ discard: true });
      await edit(LESSON);
      await page.evaluate(() => globalThis.OerEditor.ops.duplicate(__ec.haxBody().querySelector(":scope > p:last-of-type")));
      await ctx.sleep(400);
      await ctx.press("Mod+Z");
      const undidParagraph = await said(/Undid: duplicated/, "the undo to be said");
      check(
        "Names read as part of the sentence: “its note”, “Undid: removed the semester”, “Undid: duplicated paragraph”",
        asked?.title === "Remove “Who teaches it” and its note?" && undidSemester.includes("Undid: removed the semester") && undidParagraph.includes("Undid: duplicated paragraph"),
        `“${asked?.title}”; “${undidSemester}”; “${undidParagraph}”`,
      );
      // Enter on a paragraph selected as a whole edits it; HAX added an
      // empty paragraph above it
      const shape = () => page.evaluate(() => [...__ec.haxBody().children].map((c) => c.localName).join(" "));
      const blocks = await shape();
      await clickField(":scope > p");
      await page.evaluate(() => globalThis.OerEditor.ops.select(__ec.haxBody().querySelector(":scope > p")));
      await ctx.sleep(300);
      await ctx.press("Enter");
      await ctx.sleep(400);
      const entered = await page.evaluate(() => ({ caret: globalThis.__caretNow(), first: __ec.haxBody().querySelector(":scope > p").textContent.slice(0, 30), mode: globalThis.OerEditor.state.mode }));
      check(
        "Enter on a paragraph selected as a whole puts the caret in it and adds no paragraph",
        (await shape()) === blocks && entered.caret?.field === "p" && entered.caret.text.startsWith(entered.first) && entered.mode === "typing",
        `${blocks} → ${await shape()}; ${json(entered.caret && { field: entered.caret.field, offset: entered.caret.offset })}`,
      );
      await ctx.exitEdit({ discard: true });
      write(SITE_ID, STARTER_PAGE);
    });

    /* ---------- Undo puts the caret back ---------- */

    await part("undo caret", async () => {
      // typing taken back: the caret where the typing began, not at the
      // start of the paragraph
      await edit(LESSON);
      const first = () => page.evaluate(() => __ec.haxBody().querySelector(":scope > p").textContent);
      const before = await first();
      await clickField(":scope > p");
      await ctx.press("End");
      await ctx.type("abc");
      await ctx.sleep(700);
      await ctx.type("def");
      await ctx.press("Mod+Z");
      await ctx.sleep(600);
      const back = await page.evaluate(() => globalThis.__caretNow());
      await ctx.type("Z");
      await ctx.sleep(300);
      const text = await first();
      check(
        "After Undo the next key goes where the caret was (the end of what's left of the typing), not the start of the paragraph",
        text.includes("abcZ") && !text.startsWith("Z") && text.replace("abcZ", "") === before,
        `“…${text.slice(Math.max(0, text.indexOf("abc") - 20), text.indexOf("abc") + 8)}…”; caret after Undo ${json(back && { field: back.field, offset: back.offset })}`,
      );
      await ctx.exitEdit({ discard: true });
      // a move taken back: the caret stays in the field it was in, which
      // went back to its place
      write(SITE_ID, TEXT_PAGE);
      await edit(SITE);
      await clickField("oer-cs-tool > p");
      await ctx.press("End");
      await page.evaluate(() => globalThis.OerEditor.ops.move(__ec.haxBody().querySelector("oer-cs-tools"), -1));
      await ctx.sleep(400);
      await ctx.press("Mod+Z");
      await ctx.sleep(600);
      const moved = await page.evaluate(() => ({ caret: globalThis.__caretNow(), order: [...__ec.haxBody().children].map((c) => c.localName).filter((t) => t !== "page-break").join(" ") }));
      check(
        "After undoing a move, the caret is back in the moved section's field where it was",
        moved.caret?.in === "oer-cs-tools" && moved.caret.text === "Laser cutter" && moved.caret.offset === 12 && moved.order.indexOf("oer-cs-people") < moved.order.indexOf("oer-cs-tools"),
        `${json(moved.caret)}; ${moved.order}`,
      );
      // the same typing again after its Undo: a step of its own (HAX
      // compared it with the content it last snapshotted, which Undo doesn't
      // change, found them the same and recorded nothing)
      await clickField("oer-cs-people > p");
      await ctx.press("End");
      await ctx.type("x");
      await ctx.sleep(700);
      const once = await stack();
      await ctx.press("Mod+Z");
      await ctx.sleep(600);
      await ctx.type("x");
      await ctx.sleep(700);
      const twice = await stack();
      await ctx.press("Mod+Z");
      await ctx.sleep(600);
      const note = await page.evaluate(() => __ec.haxBody().querySelector("oer-cs-people > p").textContent);
      check(
        "Typing the same again after an Undo is a step of its own, which Undo takes back",
        twice.position === once.position && note === "A note from the instructor.",
        `undo position after typing ${once.position}, after typing it again ${twice.position}; the note after Undo “${note}”`,
      );
      await ctx.exitEdit({ discard: true });
      write(SITE_ID, STARTER_PAGE);
    });

    /* ---------- items ---------- */

    await part("items", async () => {
      write(LESSON_ID, ITEMS_PAGE);
      await edit(LESSON);
      const position = await stack();
      // add after the first item: the caret goes into the new one's title
      const added = await op("addItem", "oer-test-item");
      const at = await page.evaluate(anchor);
      await ctx.sleep(500);
      const later = await page.evaluate(anchor);
      const words = await said(/Test item added/, "the item to be said");
      check(
        "ops.addItem leaves the selection anchor inside the new item's h3, with HAX's active block on it",
        added === "oer-test-item" && at.count === 3 && at.item === 1 && at.field === "h3" && at.active === "h3" && later.item === 1 && later.field === "h3" && words.includes("Test item added, 2 of 3"),
        `${json(at)}; 500 ms later ${json(later)}; said “${words}”`,
      );
      await ctx.type("Added");
      await ctx.sleep(400);
      const title = await page.evaluate(() => __ec.haxBody().querySelectorAll("oer-test-item")[1].querySelector("h3").textContent);
      const steps = await stack();
      await ctx.press("Mod+Z");
      await ctx.press("Mod+Z");
      await ctx.sleep(500);
      const count = await page.evaluate(() => __ec.haxBody().querySelectorAll("oer-test-item").length);
      check("Typing fills the new title, and two Undos take back the typing and then the item", title === "Added" && steps.position === position.position + 2 && count === 2, `title “${title}”; steps ${position.position}→${steps.position}; items after two Undos ${count}`);
      // the first item of a section goes after its heading
      await op("addItem", "oer-test-list");
      const first = await page.evaluate(() => {
        const list = __ec.haxBody().querySelector("oer-test-list");
        return { order: [...list.children].map((c) => c.localName).join(" "), anchor: (() => { const s = list.getRootNode().getSelection(); const el = s.anchorNode?.nodeType === 1 ? s.anchorNode : s.anchorNode?.parentElement; return el?.closest("oer-test-item") === list.children[1] ? el.localName : null; })() };
      });
      check("Adding to the section puts the first item right after its heading, with the caret in its title", first.order === "h2 oer-test-item oer-test-item oer-test-item" && first.anchor === "h3", json(first));
      // duplicate, move and remove an item
      const copy = await page.evaluate(async () => {
        const second = __ec.haxBody().querySelectorAll("oer-test-item")[1];
        const result = await globalThis.OerEditor.ops.duplicate(second);
        const all = [...__ec.haxBody().querySelectorAll("oer-test-item")];
        return { copyAt: all.indexOf(result), active: all.indexOf(__ec.haxStore().activeNode), text: result?.querySelector("h3")?.textContent, count: all.length };
      });
      const dupSaid = await said(/duplicated/, "the copy to be said");
      check("ops.duplicate puts the copy after the item and selects it", copy.copyAt === 2 && copy.active === 2 && copy.text === "First" && copy.count === 4 && dupSaid.includes("Test item duplicated, 3 of 4"), `${json(copy)}; said “${dupSaid}”`);
      const moved = await page.evaluate(async () => {
        const all = () => [...__ec.haxBody().querySelectorAll("oer-test-item")];
        const third = all()[2];
        await globalThis.OerEditor.ops.move(third, -1);
        return { at: all().indexOf(third), heading: __ec.haxBody().querySelector("oer-test-list").firstElementChild.localName };
      });
      const moveSaid = await said(/moved to/, "the move to be said");
      const firstUp = await page.evaluate(() => globalThis.OerEditor.ops.whyNot("move", __ec.haxBody().querySelector("oer-test-item"), { dir: -1 }));
      check("An item moves among its section's items, never past the heading", moved.at === 1 && moved.heading === "h2" && moveSaid.includes("Test item moved to 2 of 4") && firstUp === "Already first", `${json(moved)}; first item up: “${firstUp}”; said “${moveSaid}”`);
      const removed = await page.evaluate(async () => {
        const all = () => [...__ec.haxBody().querySelectorAll("oer-test-item")];
        await globalThis.OerEditor.ops.remove(all()[2]);
        return { count: all().length, active: all().indexOf(__ec.haxStore().activeNode) };
      });
      const shown = await toast();
      check("ops.remove on an item removes it at once, selects the item before, and offers Undo", removed.count === 3 && removed.active === 1 && shown.some((t) => t.text === "Test item removed" && t.action === "Undo"), `${json(removed)}; toasts ${json(shown)}`);
      // a block between blocks starts with the caret in it
      const block = await page.evaluate(async () => {
        const body = __ec.haxBody();
        const list = body.querySelector("oer-test-list");
        const p = await globalThis.OerEditor.ops.insertBlock({ container: body, slotName: null, before: list.nextElementSibling, after: list, nested: false }, "p");
        const sel = body.getRootNode().getSelection();
        return { tag: p?.localName, after: p?.previousElementSibling === list, caret: !!p && p.contains(sel.anchorNode), empty: p?.textContent === "" };
      });
      check("ops.insertBlock adds an empty paragraph where asked, with the caret in it", block.tag === "p" && block.after && block.caret && block.empty, json(block));
      // the end of a column goes on to the next column
      const column = await page.evaluate(async () => {
        const grid = __ec.haxBody().querySelector("grid-plate");
        const second = grid.children[1];
        globalThis.OerEditor.ops.select(second, { focus: false });
        await globalThis.OerEditor.ops.move(second, 1);
        return { slot: second.getAttribute("slot"), first: grid.querySelector('[slot="col-2"]') === second, active: __ec.haxStore().activeNode === second };
      });
      const columnSaid = await said(/column/, "the move to be said");
      check("Move down on the last block of a column gives it the next column, at its top, and keeps it selected", column.slot === "col-2" && column.first && column.active && columnSaid.includes("moved to column 2 of 2"), `${json(column)}; said “${columnSaid}”`);
      await ctx.exitEdit({ discard: true });
      putBack(LESSON_ID);
    });

    /* ---------- a block's own controls ---------- */

    await part("editor control", async () => {
      await edit(SITE);
      const html = (await snap()).html;
      // (Change image opens it, until the editor's image popover answers that)
      await ctx.clickAt(await handle(() => __ec.haxBody().querySelector("oer-cs-hero").shadowRoot.querySelector(".change-image")));
      await ctx.sleep(300);
      const field = await handle(() => __ec.haxBody().querySelector("oer-cs-hero").shadowRoot.querySelector("oer-image-field"));
      const button = (label) => field.evaluateHandle((f, label) => [...f.shadowRoot.querySelectorAll("button")].find((b) => b.textContent.includes(label)) || null, label);
      const focusOn = () => ctx.deepActiveElement();
      // what of the field's events reaches hax-body (bubbling, as HAX listens)
      await page.evaluate((types) => {
        const heard = (globalThis.__heard = []);
        for (const type of types) __ec.haxBody().addEventListener(type, (e) => e.composedPath().some((n) => n.localName === "oer-image-field") && heard.push(type));
      }, ["pointerdown", "mousedown", "click", "dblclick", "focusin", "keydown", "keyup", "paste"]);
      // a click from another block (the tagline active)
      await clickField("oer-cs-hero > p");
      const byAddress = await button("Use an address");
      await byAddress.evaluate((b) => b.scrollIntoView({ block: "center" }));
      await ctx.frames();
      await ctx.clickAt(byAddress);
      await ctx.sleep(500);
      const clicked = await focusOn();
      // and a click with the hero itself selected
      await page.evaluate(() => globalThis.OerEditor.ops.select(__ec.haxBody().querySelector("oer-cs-hero"), { focus: false }));
      await ctx.sleep(200);
      await ctx.clickAt(byAddress);
      await ctx.sleep(500);
      const again = await focusOn();
      // Tab in from outside the field: from what comes before it in the
      // tab order (the hero's See the semester), to its first button
      const choose = await button("Choose from site");
      await choose.evaluate((b) => b.focus());
      await ctx.press("Shift+Tab");
      await ctx.sleep(300);
      const outside = await focusOn();
      await ctx.press("Tab");
      await ctx.sleep(500);
      const tabbed = await focusOn();
      const hero = await page.evaluate(() => __ec.haxBody().querySelector("oer-cs-hero").getAttribute("role"));
      const unchanged = (await snap()).html === html;
      const heard = await page.evaluate(() => globalThis.__heard);
      check(
        "A shadow button wrapped in editorControl still holds deep focus 500 ms after a click (from another block, and with its section selected) and after Tab from outside it",
        [clicked, again].every((f) => f?.tag === "button" && f.name === "Use an address") && !outside?.path.includes("oer-image-field") && tabbed?.tag === "button" && tabbed.name === "Choose from site" && tabbed.path.includes("oer-image-field") && hero === null && unchanged,
        `after click: ${clicked?.name} (${clicked?.path}); with the hero selected: ${again?.name}; Tab from ${outside?.name} (${outside?.path}) to ${tabbed?.name}; hero role ${hero}; hax-body ${unchanged ? "unchanged" : "changed"}`,
      );
      check("…and none of its pointer, click, focus or key events reaches hax-body", heard.length === 0, heard.join(", ") || "none");
      await ctx.exitEdit({ discard: true });
    });
  } finally {
    // the copy's pages as they were, for the checks after this one
    for (const [file, html] of originals) writeFileSync(file, html);
  }
  return results;
}
