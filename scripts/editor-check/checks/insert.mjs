// Inserting (WP-10 of docs/editor-redesign/work-packages.md): full-width
// seams with a + Add pill (none above the hero or below Ready to start), the
// flyout's groups (Not on this page with Add back, On this page, Blocks,
// All blocks…) filtered by page type and container, blocks that start
// empty, the refusals in slots.js and layouts.js, the Columns menu (keys,
// Width: Section) and Move down into the next column. And the events the
// Sections sheet (WP-12) and the image popover (WP-14) use:
// oer-insert-request and oer-edit-request { action: "image" }.
//
// The course site's page is written into the copy before it opens and put
// back at the end; one part saves it there (Width: Section, as readers see
// it), only in the copy.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

// the course site's page and a lesson, by id (a save can give a page a new address)
const SITE_ID = "item-0330a29b-7735-4ac0-afd2-e3b2a88d49e3";
const LESSON_ID = "item-143f3783-959c-45c3-8758-dacef0f6861f";

const NOTE = "A note between sections, long enough to read as a paragraph of its own.";
const LEFT = "Left column, a sentence or two.";
// no What you'll make; a paragraph and columns between sections
const PAGE = `<oer-cs-hero><p>Design it on screen, then make it real.</p></oer-cs-hero>
<oer-cs-facts></oer-cs-facts>
<oer-cs-learn><h2>What you'll be able to do</h2><oer-cs-outcome><h3>Cut with confidence</h3><p>Plan, cut and finish parts.</p></oer-cs-outcome><oer-cs-outcome><h3>Print what you model</h3><p>Slice meshes for FDM.</p></oer-cs-outcome></oer-cs-learn>
<oer-cs-semester></oer-cs-semester>
<p>${NOTE}</p>
<grid-plate layout="1-1"><p slot="col-1">${LEFT}</p><p slot="col-2">Right column, a sentence or two.</p></grid-plate>
<oer-cs-books></oer-cs-books>
<oer-cs-people><p></p></oer-cs-people>
<oer-cs-tools><h2>Tools you'll use</h2><oer-cs-tool><p>Epilog laser cutter</p></oer-cs-tool></oer-cs-tools>
<oer-cs-faq><h2>Questions</h2><oer-cs-question><h3>Do I need experience?</h3><p>No. Week 1 starts with safety.</p></oer-cs-question></oer-cs-faq>
<oer-cs-closing></oer-cs-closing>
`;

/* ---------- in the page ---------- */

// the flyout as drawn: its groups, each option's tag, name and state
function flyoutNow() {
  const root = document.querySelector("oer-block-inserter").shadowRoot;
  const panel = root.querySelector(".panel");
  if (!panel) return null;
  return {
    groups: [...panel.querySelectorAll(".group")].map((g) => ({
      label: g.querySelector(".heading")?.textContent.trim() || "",
      options: [...g.querySelectorAll("[role=option]")].map((o) => ({ tag: o.dataset.tag, name: o.querySelector(".name").textContent.trim(), off: o.getAttribute("aria-disabled") === "true" })),
    })),
    slot: { after: document.querySelector("oer-block-inserter")._open?.slot.after?.localName ?? null, kind: document.querySelector("oer-block-inserter")._open?.slot.kind },
  };
}

// the seams drawn now: { top, width, why, after, before }
function seamsNow() {
  const ins = document.querySelector("oer-block-inserter");
  return [...ins.shadowRoot.querySelectorAll(".slot")].map((el) => {
    const m = ins._seams[Number(el.dataset.i)];
    const r = el.getBoundingClientRect();
    return { top: Math.round(r.top), width: Math.round(r.width), why: m?.why, after: m?.slot.after?.localName ?? null, before: m?.slot.before?.localName ?? null, tab: el.querySelector(".plus").getAttribute("tabindex") };
  });
}

export default async function insert(ctx) {
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

  const address = (id) => `/${JSON.parse(readFileSync(path.join(ctx.siteDir, "site.json"), "utf8")).items.find((i) => i.id === id).slug}`;
  const file = path.join(ctx.siteDir, "pages", SITE_ID, "index.html");
  const original = readFileSync(file, "utf8");
  const SITE = address(SITE_ID);
  const LESSON = address(LESSON_ID);

  const order = () => page.evaluate(() => [...__ec.haxBody().children].map((c) => c.localName).filter((t) => t !== "page-break"));
  const flyout = () => page.evaluate(flyoutNow);
  const seams = () => page.evaluate(seamsNow);
  const focusPath = async () => (await ctx.deepActiveElement())?.path || "";
  const focusName = async () => (await ctx.deepActiveElement())?.name || "";
  const closeFlyout = () => page.evaluate(() => document.querySelector("oer-block-inserter").close());
  // scroll a unit to the middle of the view and move the pointer to dy from its top
  const hoverAt = async (selector, dy, { bottom = false } = {}) => {
    const y = await page.evaluate(
      async (selector, bottom) => {
        const el = __ec.haxBody().querySelector(selector);
        el.scrollIntoView({ block: bottom ? "center" : "start" });
        if (!bottom) __ec.theme().shadowRoot.querySelector("main").scrollTop -= 120;
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const r = el.getBoundingClientRect();
        return bottom ? r.bottom : r.top;
      },
      selector,
      bottom,
    );
    await page.mouse.move(700, Math.round(y + dy));
    await ctx.sleep(150);
    return Math.round(y);
  };
  // click an option of the open flyout by its tag (or name)
  const choose = async (what) => {
    const option = await page.evaluateHandle(
      (what) => [...document.querySelector("oer-block-inserter").shadowRoot.querySelectorAll("[role=option]")].find((o) => o.dataset.tag === what || o.querySelector(".name").textContent.trim() === what) || null,
      what,
    );
    if (!option.asElement()) throw new Error(`The flyout has no ${what}: ${json(await flyout())}`);
    const r = await option.evaluate((o) => {
      const b = o.getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width, vh: innerHeight };
    });
    if (!r.w || r.y < 0 || r.y > r.vh) throw new Error(`${what} in the flyout can't be clicked: ${json(r)}`);
    await page.mouse.click(r.x, r.y);
    await ctx.sleep(600);
  };
  // the flyout below a top-level unit, opened from its seam's pill
  const openBelow = async (selector) => {
    const y = await hoverAt(`${selector} + *`, -10);
    // (between paragraphs the seam is in the middle of the gap)
    const pill = await page.evaluateHandle((y) => [...document.querySelector("oer-block-inserter").shadowRoot.querySelectorAll(".slot")].find((s) => Math.abs(s.getBoundingClientRect().top - y) <= 16)?.querySelector(".plus") || null, y);
    if (!pill.asElement()) throw new Error(`No seam at ${y}: ${json(await seams())}`);
    await pill.asElement().click();
    await ctx.waitFor(() => !!document.querySelector("oer-block-inserter").shadowRoot.querySelector(".panel input"), { what: "the flyout" });
  };
  const select = (selector) => page.evaluate((s) => globalThis.OerEditor.ops.select(__ec.haxBody().querySelector(s)), selector);
  const caretIn = (selector) =>
    page.evaluate((s) => {
      const el = __ec.haxBody().querySelector(s);
      const sel = el?.getRootNode().getSelection?.();
      return !!el && !!sel?.rangeCount && el.contains(sel.getRangeAt(0).startContainer);
    }, selector);

  writeFileSync(file, PAGE);
  try {
    /* ---------- seams ---------- */

    await part("seams", async () => {
      await ctx.open(SITE);
      await ctx.enterEdit();
      // nothing selected, so no seams of the selection's
      await page.evaluate(() => (__ec.haxStore().activeNode = null));
      const top = await hoverAt("oer-cs-learn", -10);
      const shown = await seams();
      const main = await page.evaluate(() => __ec.theme().shadowRoot.querySelector("main").clientWidth);
      const seam = shown.find((s) => s.why === "near");
      check("Hovering 10px above a section boundary shows a seam as wide as main's client width", seam && Math.abs(seam.top - top) <= 1 && seam.width === main, json({ boundary: top, main, shown }));
      // above the hero and below Ready to start: none
      const nearHero = (await hoverAt("oer-cs-hero", -10).then(seams)).concat(await hoverAt("oer-cs-hero", 6).then(seams));
      const nearEnd = (await hoverAt("oer-cs-closing", 10, { bottom: true }).then(seams)).concat(await hoverAt("oer-cs-closing", -6, { bottom: true }).then(seams));
      const end = await page.evaluate(() => !!document.querySelector("oer-block-inserter").shadowRoot.querySelector(".end"));
      check(
        "No seam above the hero or below Ready to start (nor an Add block row after it)",
        !nearHero.some((s) => s.before === "oer-cs-hero") && !nearEnd.some((s) => s.after === "oer-cs-closing") && !end,
        json({ nearHero, nearEnd, end }),
      );
      // the selected section's two seams, which the keyboard reaches
      await page.mouse.move(5, 5);
      await hoverAt("oer-cs-learn", 0);
      await page.mouse.move(5, 5);
      await select("oer-cs-learn");
      await ctx.sleep(300);
      const sel = (await seams()).filter((s) => s.why === "selected");
      check("The selected section has seams above and below it, which take focus", sel.length === 2 && sel.every((s) => s.tab === "0") && sel.some((s) => s.before === "oer-cs-learn") && sel.some((s) => s.after === "oer-cs-learn"), json(sel));
      // a pill with focus opens the flyout with Enter; Escape gives focus back to it
      await page.evaluate(() => [...document.querySelector("oer-block-inserter").shadowRoot.querySelectorAll(".slot.selected .plus")].pop().focus());
      await ctx.press("Enter");
      await ctx.sleep(300);
      const opened = !!(await flyout());
      await ctx.press("Escape");
      await ctx.sleep(300);
      const back = await focusPath();
      check("Enter on a seam's pill opens the flyout, and Escape gives focus back to the pill", opened && /oer-block-inserter › button/.test(back) && !(await flyout()), json({ opened, back }));
      // the flyout paints above the frame and the rail
      await openBelow("oer-cs-learn");
      const top2 = await page.evaluate(() => {
        const r = document.querySelector("oer-block-inserter").shadowRoot.querySelector(".panel").getBoundingClientRect();
        const hit = __ec.elementAt(r.left + 20, r.top + 20);
        return __ec.within(hit, document.querySelector("oer-block-inserter"));
      });
      check("The flyout paints above the page and the selection chrome", top2);
      const axe = await ctx.axe({ context: { include: [["oer-block-inserter"]] } });
      const bad = axe.rules.filter((v) => ["serious", "critical"].includes(v.impact));
      check("axe finds no serious or critical violations in the seams and the flyout", !bad.length, json(bad.map((v) => `${v.id}: ${v.nodes} ${json(v.targets)}`)));
      await closeFlyout();
      await ctx.exitEdit({ discard: true });
    });

    /* ---------- the flyout on a course site: sections first ---------- */

    await part("add back", async () => {
      await ctx.open(SITE);
      await ctx.enterEdit();
      await openBelow("oer-cs-learn");
      const f = await flyout();
      const labels = f.groups.map((g) => g.label);
      const missing = f.groups.find((g) => g.label === "Not on this page")?.options.map((o) => o.tag) || [];
      const here = f.groups.find((g) => g.label === "On this page")?.options || [];
      check(
        "On a course site the flyout lists sections first: Not on this page (What you'll make), On this page (off), Blocks, All blocks…",
        labels.slice(0, 3).join() === "Not on this page,On this page,Blocks" && missing.includes("oer-cs-make") && here.length >= 9 && here.every((o) => o.off) && f.groups.at(-1).options[0]?.name === "All blocks…",
        json({ labels, missing, here: here.length }),
      );
      await choose("oer-cs-make");
      const after = await order();
      check("Add back puts What you'll make right after The semester", after[after.indexOf("oer-cs-semester") + 1] === "oer-cs-make", json(after));
      await ctx.press("Mod+Z");
      await ctx.sleep(600);
      const undone = await order();
      check("One Undo takes the added section away again", !undone.includes("oer-cs-make"), json(undone));
      // Go to it selects a section that's there
      await openBelow("oer-cs-learn");
      await choose("oer-cs-tools");
      const went = await page.evaluate(() => ({ unit: globalThis.OerEditor.state.unit?.localName, mode: globalThis.OerEditor.state.mode }));
      check("Go to it selects the section", went.unit === "oer-cs-tools" && went.mode === "selected", json(went));
      await ctx.exitEdit({ discard: true });
    });

    /* ---------- the Sections sheet's requests (WP-12) ---------- */

    await part("insert request", async () => {
      await ctx.open(SITE);
      await ctx.enterEdit();
      const handled = await page.evaluate(() => !globalThis.dispatchEvent(new CustomEvent("oer-insert-request", { cancelable: true, detail: { kind: "section", tag: "oer-cs-make" } })));
      await ctx.sleep(800);
      const after = await order();
      check("oer-insert-request { kind: section, tag } adds the section back in its standard place", handled && after[after.indexOf("oer-cs-semester") + 1] === "oer-cs-make", json(after));
      await ctx.press("Mod+Z");
      await ctx.sleep(600);
      // "+ Add section…": the flyout below near, sections only; Escape back to the opener
      const opener = await page.evaluateHandle(() => __ec.control(/^Sections/));
      await page.evaluate((opener) => {
        opener.focus();
        globalThis.dispatchEvent(new CustomEvent("oer-insert-request", { cancelable: true, detail: { kind: "section", near: __ec.haxBody().querySelector("oer-cs-learn"), opener } }));
      }, opener);
      await ctx.waitFor(() => !!document.querySelector("oer-block-inserter").shadowRoot.querySelector(".panel input"), { what: "the flyout" });
      const f = await flyout();
      await ctx.press("Escape");
      await ctx.sleep(300);
      const back = await focusName();
      check(
        "oer-insert-request { kind: section, near } opens the flyout below it with the sections only, and Escape gives focus back to the opener",
        f.slot.after === "oer-cs-learn" && f.groups.every((g) => g.label !== "Blocks") && f.groups.some((g) => g.label === "Not on this page") && /^Sections/.test(back),
        json({ slot: f.slot, groups: f.groups.map((g) => g.label), back }),
      );
      await ctx.exitEdit({ discard: true });
    });

    /* ---------- a lesson: no sections, curated blocks ---------- */

    await part("lesson", async () => {
      await ctx.open(LESSON);
      await ctx.enterEdit();
      await openBelow("p");
      const f = await flyout();
      const tags = f.groups.flatMap((g) => g.options.map((o) => o.tag)).filter(Boolean);
      const blocks = f.groups.find((g) => g.label === "Blocks")?.options || [];
      const sectionsListed = (list) => list.filter((t) => /^oer-(cs|courses)-/.test(t));
      // typing searches every block, and All blocks… lists them by category
      await ctx.type("course");
      await ctx.sleep(200);
      const searched = (await flyout()).groups.flatMap((g) => g.options.map((o) => o.tag)).filter(Boolean);
      await page.evaluate(() => {
        const ins = document.querySelector("oer-block-inserter");
        ins._query = "";
        ins._all = true;
      });
      await ctx.sleep(200);
      const all = (await flyout()).groups.flatMap((g) => g.options.map((o) => o.tag)).filter(Boolean);
      check(
        "On a lesson page the flyout lists no course-site or hub sections (searching, or in All blocks… either)",
        !sectionsListed(tags).length && !sectionsListed(searched).length && !sectionsListed(all).length && !f.groups.some((g) => /on this page/i.test(g.label)) && all.length > 30,
        json({ groups: f.groups.map((g) => g.label), listed: sectionsListed([...tags, ...searched, ...all]), all: all.length }),
      );
      const blockTags = blocks.map((o) => o.tag);
      check(
        "The Blocks group has at most 16 entries, no duplicate tags, and Heading 2, 3 and 4 by name",
        blocks.length && blocks.length <= 16 && new Set(blockTags).size === blockTags.length && ["Heading 2", "Heading 3", "Heading 4"].every((n) => blocks.some((o) => o.name === n)),
        json(blocks.map((o) => `${o.tag}:${o.name}`)),
      );
      await closeFlyout();
      // a paragraph starts empty with the caret in it, in the middle of the view; one undo step
      const before = await page.evaluate(() => __ec.haxBody().children.length);
      await openBelow("p");
      await choose("p");
      const added = await page.evaluate(() => {
        const sel = __ec.haxBody().getRootNode().getSelection();
        const node = sel.rangeCount ? sel.getRangeAt(0).startContainer : null;
        const p = node && (node.nodeType === 1 ? node : node.parentElement).closest("p");
        const r = p?.getBoundingClientRect();
        const v = globalThis.OerEditor.state.geometry.view;
        return { empty: !!p && !p.textContent.trim(), mid: r ? Math.round(r.top + r.height / 2 - (v.top + v.bottom) / 2) : null, count: __ec.haxBody().children.length };
      });
      await ctx.press("Mod+Z");
      await ctx.sleep(600);
      const undone = await page.evaluate(() => __ec.haxBody().children.length);
      check("A new paragraph starts empty with the caret in it, scrolled to the middle, and one Undo takes it away", added.empty && Math.abs(added.mid) < 60 && added.count === before + 1 && undone === before, json({ ...added, before, undone }));
      // an image asks for its picture (the image popover's event)
      await page.evaluate(() => {
        globalThis.__imageAsked = null;
        globalThis.addEventListener("oer-edit-request", (e) => e.detail?.action === "image" && (globalThis.__imageAsked = e.detail.unit?.localName), { once: false });
      });
      await openBelow("p");
      await choose("img");
      const asked = await page.evaluate(() => ({ asked: globalThis.__imageAsked, src: __ec.haxBody().querySelector("img:not([src])") ? "none" : "set" }));
      check("A new image has no picture and sends oer-edit-request { action: image, unit } for the image popover", asked.asked === "img" && asked.src === "none", json(asked));
      await ctx.exitEdit({ discard: true });
    });

    /* ---------- refusals ---------- */

    await part("refusals", async () => {
      await ctx.open(SITE);
      await ctx.enterEdit();
      const r = await page.evaluate(async () => {
        const body = __ec.haxBody();
        const hax = __ec.haxStore();
        const before = body.innerHTML;
        const a = await globalThis.OerEditor.wrapInColumns(hax, body.querySelector("oer-cs-learn"), "1-1");
        const b = await globalThis.OerEditor.wrapInColumns(hax, body.querySelector("oer-cs-hero > p"), "1-1");
        const c = await globalThis.OerEditor.wrapInColumns(hax, body.querySelector("oer-cs-outcome"), "1-1");
        return { a, b, c, same: body.innerHTML === before };
      });
      check("wrapInColumns on a section, a section's paragraph or an item leaves the DOM unchanged", r.a === null && r.b === null && r.c === null && r.same, json(r));
      // a section's menus offer no Columns…, nor does its label
      await select("oer-cs-learn");
      await ctx.sleep(300);
      const sectionCols = await page.evaluate(() => !!document.querySelector("oer-block-frame").shadowRoot.querySelector('.label button[aria-label="Columns"]'));
      // an item's flyout: its own item only
      const opened = await page.evaluate(() => document.querySelector("oer-block-inserter").openFor(__ec.haxBody().querySelectorAll("oer-cs-outcome")[1], "below"));
      await ctx.sleep(300);
      const f = await flyout();
      const options = f?.groups.flatMap((g) => g.options.map((o) => o.tag)) || [];
      check("Inside What you'll learn the flyout offers only an outcome, and a section has no Columns button", opened && options.join() === "oer-cs-outcome" && !sectionCols, json({ options, sectionCols }));
      await choose("oer-cs-outcome");
      const outcomes = await page.evaluate(() => [...__ec.haxBody().querySelectorAll("oer-cs-outcome")].map((o) => o.querySelector("h3")?.textContent || ""));
      check("Choosing it adds an empty outcome after the second", outcomes.length === 3 && outcomes[2] === "", json(outcomes));
      // inserting a section in a column is refused
      const refused = await page.evaluate(async () => {
        const grid = __ec.haxBody().querySelector("grid-plate");
        const added = await globalThis.OerEditor.ops.insertBlock({ container: grid, slotName: "col-1", kind: "column", nested: true, after: grid.firstElementChild, before: null }, "oer-cs-make", {});
        return { added, make: !!__ec.haxBody().querySelector("oer-cs-make") };
      });
      check("A section isn't inserted in a column", refused.added === false && !refused.make, json(refused));
      await ctx.exitEdit({ discard: true });
    });

    /* ---------- the Columns menu ---------- */

    await part("columns menu", async () => {
      await ctx.open(SITE);
      await ctx.enterEdit();
      const note = await page.evaluateHandle((note) => [...__ec.haxBody().children].find((el) => el.localName === "p" && el.textContent.includes(note)), NOTE);
      await note.evaluate((n) => n.scrollIntoView({ block: "center" }));
      await ctx.clickAt(note);
      await ctx.sleep(400);
      // Block ▾ has Columns…, not HAX's Add and Remove column
      const block = await page.evaluateHandle(() => document.querySelector("oer-block-rail").shadowRoot.querySelector('.rail button[aria-label="Block"]'));
      await ctx.clickAt(block);
      await ctx.sleep(300);
      const items = await page.evaluate(() => [...document.querySelector("oer-block-rail").shadowRoot.querySelectorAll(".menu [role^=menuitem] .text")].map((t) => t.textContent.trim()));
      await ctx.press("Escape");
      check("Block ▾ offers Columns… in place of Add column and Remove column", items.includes("Columns…") && !items.some((t) => /(Add|Remove) column/.test(t)), json(items));
      // the frame's Columns button opens the menu, focus in it
      await ctx.clickAt(note);
      await ctx.sleep(300);
      const opener = await page.evaluateHandle(() => document.querySelector("oer-block-frame").shadowRoot.querySelector('.label button[aria-label="Columns"]'));
      if (!opener.asElement()) throw new Error("The frame's label has no Columns button");
      await ctx.clickAt(opener);
      await ctx.sleep(300);
      const first = await focusName();
      await ctx.press("ArrowRight");
      const second = await focusName();
      await ctx.press("ArrowDown");
      const below = await focusName();
      await ctx.press("ArrowUp");
      const up = await focusName();
      await ctx.press("Enter");
      await ctx.sleep(600);
      const wrapped = await page.evaluate((note) => {
        const p = [...__ec.haxBody().querySelectorAll("p")].find((el) => el.textContent.includes(note));
        return { parent: p.parentElement.localName, layout: p.parentElement.layout, slot: p.getAttribute("slot"), selected: __ec.haxStore().activeNode === p, menu: !document.querySelector("oer-columns-menu")?.hidden };
      }, NOTE);
      check(
        "In the Columns menu arrow keys move between presets and Enter applies one: the block goes in column 1 and stays selected",
        first === "Two columns, 1 : 1" && second === "Two columns, 2 : 1" && below !== second && up === second && wrapped.parent === "grid-plate" && wrapped.layout === "2-1" && wrapped.slot === "col-1" && wrapped.selected && !wrapped.menu,
        json({ first, second, below, up, wrapped }),
      );
      const reopen = await page.evaluateHandle(() => document.querySelector("oer-block-frame").shadowRoot.querySelector('.label button[aria-label="Columns"]'));
      await ctx.clickAt(reopen);
      await ctx.sleep(300);
      const inMenu = /oer-columns-menu/.test(await focusPath());
      await ctx.press("Escape");
      await ctx.sleep(200);
      const back = await ctx.deepActiveElement();
      check("Escape closes the Columns menu and gives focus back to its opener", inMenu && /oer-block-frame/.test(back?.path) && back?.name === "Columns", json({ inMenu, back }));
      await ctx.press("Mod+Z");
      await ctx.sleep(600);
      const undone = await page.evaluate((note) => [...__ec.haxBody().children].some((el) => el.localName === "p" && el.textContent.includes(note)), NOTE);
      check("One Undo takes the paragraph out of the columns again", undone);
      await ctx.exitEdit({ discard: true });
    });

    /* ---------- Move down into the next column ---------- */

    await part("next column", async () => {
      await ctx.open(SITE);
      await ctx.enterEdit();
      const left = await page.evaluateHandle((left) => [...__ec.haxBody().querySelectorAll("grid-plate > p")].find((p) => p.textContent.includes(left)), LEFT);
      await left.evaluate((n) => n.scrollIntoView({ block: "center" }));
      await ctx.clickAt(left);
      await ctx.sleep(300);
      await ctx.press("Escape");
      await ctx.sleep(300);
      await ctx.press("Alt+Shift+ArrowDown");
      await ctx.sleep(600);
      const r = await left.evaluate((p) => ({ slot: p.getAttribute("slot"), selected: __ec.haxStore().activeNode === p, unit: globalThis.OerEditor.state.unit === p, mode: globalThis.OerEditor.state.mode }));
      check("Move down on the last block of column 1 gives it slot col-2 and keeps it selected", r.slot === "col-2" && r.selected && r.unit, json(r));
      await ctx.exitEdit({ discard: true });
    });

    /* ---------- Width: Section, as readers see it ---------- */

    await part("width", async () => {
      await ctx.open(SITE);
      await ctx.enterEdit();
      const left = await page.evaluateHandle((left) => [...__ec.haxBody().querySelectorAll("grid-plate > p")].find((p) => p.textContent.includes(left)), LEFT);
      await left.evaluate((n) => n.scrollIntoView({ block: "center" }));
      await ctx.clickAt(left);
      await ctx.sleep(300);
      await ctx.clickAt(await page.evaluateHandle(() => document.querySelector("oer-block-frame").shadowRoot.querySelector('.label button[aria-label="Columns"]')));
      await ctx.sleep(300);
      const section = await page.evaluateHandle(() => document.querySelector("oer-columns-menu").shadowRoot.querySelector('[aria-label="Width: Section"]'));
      if (!section.asElement()) throw new Error("The Columns menu has no Width: Section");
      await ctx.clickAt(section);
      await ctx.sleep(400);
      const wide = await page.evaluate(() => __ec.haxBody().querySelector("grid-plate").getAttribute("width"));
      await ctx.save();
      await ctx.open(SITE, { signedOut: true });
      const reader = await page.evaluate(() => {
        const grid = __ec.deep("grid-plate");
        const main = __ec.theme().shadowRoot.querySelector("main");
        return { width: grid ? Math.round(grid.getBoundingClientRect().width) : null, rem: parseFloat(getComputedStyle(document.documentElement).fontSize), main: main.clientWidth };
      });
      const expected = Math.min(72 * reader.rem, reader.main - 3 * reader.rem);
      check("Width: Section sets width=wide on the columns, and readers see them 72rem wide", wide === "wide" && Math.abs(reader.width - expected) <= 1, json({ wide, reader, expected }));
    });

    /* ---------- no loop of its own ---------- */

    await part("source", async () => {
      const src = readFileSync(path.join(ctx.siteDir, "custom/src/editor/oer-block-inserter.js"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      const problems = [/requestAnimationFrame\(this\.__tick\)/, /__oerDragging/, /\bisSection\b|SECTION_TAGS/].filter((re) => re.test(src)).map(String);
      check("The inserter follows the editor's state: no animation loop, no __oerDragging, no isSection or SECTION_TAGS", !problems.length, json(problems));
    });
  } finally {
    writeFileSync(file, original);
  }
  return results;
}
