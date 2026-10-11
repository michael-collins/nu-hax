// The editing bar itself (WP-11, spec §3.1, §7.1, §7.3): its items move
// into ⋯ More as the window narrows (Preview first, Undo and Redo last,
// Exit and Save never) and it reads [✕ Exit] name ● [⋯] [Save] on a phone,
// without ever making the page scroll sideways; words beside the icons
// unless a viewer chooses icons only (remembered); one roving toolbar led
// by Skip to selected section; Undo off with its reason until there's
// something to undo; "⚠ N to check" with a way to fix each; the keyboard
// shortcuts on Mod+/; the Sections button's event for the Sections sheet;
// an ordinary page's bar; OER Courses entering in place. And the reading
// bar of a course site: its author buttons keep their names at phone width
// (Page details and Style move into the page menu), Edit content says why
// on a locked page, and its links take the sections' headings.
//
// The course site's page is written into the copy before each part and
// put back at the end. The lock part locks and unlocks the course site in
// the copy. Nothing else is saved.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const SITE_ID = "item-0330a29b-7735-4ac0-afd2-e3b2a88d49e3";
const HUB_ID = "item-417a2d47-2196-42b8-acae-bb0202f18fae";
const LESSON_ID = "item-143f3783-959c-45c3-8758-dacef0f6861f";

const PAGE = `<oer-cs-hero><p>Design it on screen, then make it real.</p></oer-cs-hero>
<oer-cs-facts></oer-cs-facts>
<oer-cs-learn><h2>What you'll be able to do</h2><oer-cs-outcome><h3>Cut with confidence</h3><p>Plan, cut and finish parts.</p></oer-cs-outcome><oer-cs-outcome><h3>Print what you model</h3><p>Slice meshes for FDM.</p></oer-cs-outcome></oer-cs-learn>
<oer-cs-semester><h2>Fifteen weeks, three projects</h2></oer-cs-semester>
<oer-cs-people><h2>Who teaches it</h2><p>A note from the instructor.</p></oer-cs-people>
<oer-cs-tools><h2>In the shop</h2><oer-cs-tool><p>Epilog laser cutter</p></oer-cs-tool></oer-cs-tools>
<oer-cs-faq><h2>Questions</h2><oer-cs-question><h3>Is it online?</h3><p>No, in the studio.</p></oer-cs-question></oer-cs-faq>
<oer-cs-closing></oer-cs-closing>
`;
// what readers would miss: the hero's picture without a description, an
// outcome without its title, and Tools with nothing in it
const CHECK_PAGE = `<oer-cs-hero image="files/studio.jpg"><p>Design it on screen.</p></oer-cs-hero>
<oer-cs-facts></oer-cs-facts>
<oer-cs-learn><h2>What you'll be able to do</h2><oer-cs-outcome><h3>Cut with confidence</h3><p>Plan, cut and finish parts.</p></oer-cs-outcome><oer-cs-outcome><h3></h3><p>Slice meshes for FDM.</p></oer-cs-outcome></oer-cs-learn>
<oer-cs-people><h2>Who teaches it</h2><p>A note from the instructor.</p></oer-cs-people>
<oer-cs-tools><h2>In the shop</h2><oer-cs-tool><p></p></oer-cs-tool></oer-cs-tools>
<oer-cs-closing></oer-cs-closing>
`;

/* ---------- in the page ---------- */

// the editing bar as it is: its items on show, its layout, what overflows
function barNow() {
  const bar = __ec.theme().shadowRoot.querySelector("oer-edit-bar");
  const root = bar.shadowRoot;
  const row = root.querySelector(".row");
  // in the order they show, left to right: items by their data-id, and the
  // page's name and the status's dot
  const shown = [...row.querySelectorAll("[data-id], .name, .dot")]
    .filter((el) => el.checkVisibility() && !el.classList.contains("sr") && el.getBoundingClientRect().width > 0)
    .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left)
    .map((el) => el.dataset.id || el.className);
  const box = (el) => {
    const r = el?.getBoundingClientRect();
    return r ? { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom) } : null;
  };
  const doc = document.documentElement;
  // what of the bar runs past the window's right edge
  const past = [...root.querySelectorAll("header *")].filter((el) => !el.closest("[popover], dialog") && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().right > innerWidth + 0.5).map((el) => el.className || el.localName);
  return {
    shown,
    past,
    phone: bar._phone,
    row: [row.scrollWidth, row.clientWidth],
    doc: [doc.scrollWidth, doc.clientWidth],
    save: box(root.querySelector('[data-id="save"]')),
    exit: box(root.querySelector('[data-id="exit"]')),
    width: innerWidth,
    height: Math.round(root.querySelector("header").getBoundingClientRect().height),
    label: root.querySelector("header").getAttribute("aria-label"),
  };
}

export default async function editBar(ctx) {
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

  const items = JSON.parse(readFileSync(path.join(ctx.siteDir, "site.json"), "utf8")).items;
  const itemOf = (id) => items.find((i) => i.id === id);
  const SITE = `/${itemOf(SITE_ID).slug}`;
  const HUB = `/${itemOf(HUB_ID).slug}`;
  const LESSON = `/${itemOf(LESSON_ID).slug}`;
  const file = path.join(ctx.siteDir, "pages", SITE_ID, "index.html");
  const original = readFileSync(file, "utf8");

  const handle = (fn, ...args) => page.evaluateHandle(fn, ...args);
  const inBar = (selector) => handle((s) => __ec.theme().shadowRoot.querySelector("oer-edit-bar")?.shadowRoot?.querySelector(s) || null, selector);
  const now = () => page.evaluate(barNow);
  const size = async (width, height = 900) => {
    await page.setViewport({ width, height });
    await ctx.frames();
    await ctx.sleep(350);
  };
  const edit = async (url = SITE, html = PAGE) => {
    if (await ctx.editMode()) await ctx.exitEdit({ discard: true });
    writeFileSync(file, html);
    await ctx.open(url);
    await ctx.enterEdit();
    await ctx.waitFor(() => globalThis.OerEditor?.state.tracking, { what: "unsaved changes to be followed", timeout: 5000 });
    await ctx.sleep(500);
  };
  const deep = () => ctx.deepActiveElement();

  try {
    /* ---------- room ---------- */

    await part("widths", async () => {
      await edit();
      const seen = {};
      for (const width of [1440, 1280, 1100, 1024, 900, 800, 768, 700, 600, 390, 320]) {
        await size(width);
        const bar = await now();
        seen[width] = bar;
        const inside = (b) => b && b.left >= 0 && b.right <= width && b.top >= 0;
        // (the page's own width while editing below 390 is the selection
        // chrome's, WP-09: its gutter)
        check(
          `At ${width} the editing bar fits: Exit and Save on screen, nothing past the window${width >= 390 ? ", no sideways scroll" : ""}`,
          bar.row[0] <= bar.row[1] && !bar.past.length && (width < 390 || bar.doc[0] <= bar.doc[1]) && inside(bar.save) && inside(bar.exit),
          `${bar.shown.join(" ")}; row ${bar.row.join("/")}; page ${bar.doc.join("/")}${bar.past.length ? `; past the edge: ${bar.past.join(", ")}` : ""}`,
        );
      }
      const all = ["sections", "undo", "redo", "style", "details", "preview", "more", "status", "save", "exit"];
      check("At 1440 everything is in one row, with words", all.every((id) => seen[1440].shown.includes(id)) && seen[1440].height === 57, `${seen[1440].shown.join(" ")}; ${seen[1440].height}px high`);
      // Preview goes first, Undo and Redo last
      const went = (id) => Object.keys(seen).map(Number).sort((a, b) => b - a).find((w) => !seen[w].shown.includes(id)) ?? 0;
      check("As it narrows Preview moves into ⋯ first, and Undo and Redo last", went("preview") > went("details") - 1 && went("preview") >= went("undo") && went("undo") <= went("sections") && went("preview") > 768, json({ preview: went("preview"), details: went("details"), sections: went("sections"), undo: went("undo") }));
      const phone = seen[390];
      check("At 390 it reads [✕ Exit] name ● [⋯] [Save]", phone.phone && json(phone.shown) === json(["exit", "name", "dot", "more", "save"]), json(phone.shown));
      await size(1440);
      await ctx.exitEdit({ discard: true });
    });

    /* ---------- words, or icons only ---------- */

    await part("labels", async () => {
      await edit();
      const labels = () =>
        page.evaluate(() => {
          const root = __ec.theme().shadowRoot.querySelector("oer-edit-bar").shadowRoot;
          return [...root.querySelectorAll(".row [data-id]")].filter((b) => b.localName === "button" && b.checkVisibility()).map((b) => `${b.dataset.id}:${b.querySelector(".t") ? "words" : "icon"}:${__ec.name(b)}`);
        });
      const words = await labels();
      check("Labels show beside the icons by default", words.filter((l) => /^(sections|undo|style|details|preview):/.test(l)).every((l) => l.includes(":words:")), json(words));
      const more = await inBar('[data-id="more"]');
      await ctx.clickAt(more);
      await ctx.sleep(300);
      const toggle = await inBar('.menu [role="menuitemcheckbox"]');
      const was = await toggle.evaluate((b) => [__ec.name(b), b.getAttribute("aria-checked")]);
      await ctx.clickAt(toggle);
      await ctx.sleep(400);
      const icons = await labels();
      const stored = await page.evaluate(() => localStorage.getItem("oer-editor-labels"));
      check(
        "⋯ More → Show labels turns them off: icons only, each named",
        was[0] === "Show labels" && was[1] === "true" && icons.filter((l) => /^(sections|undo|style|details|preview):/.test(l)).every((l) => /:icon:\w/.test(l)) && stored === "false",
        `${json(was)} → ${json(icons)}; stored ${stored}`,
      );
      await ctx.exitEdit({ discard: true });
      await ctx.open(SITE);
      await ctx.enterEdit();
      const kept = await labels();
      check("…and it stays that way for this viewer", kept.filter((l) => /^undo:/.test(l)).every((l) => l.includes(":icon:")), json(kept));
      await page.evaluate(() => localStorage.removeItem("oer-editor-labels"));
      await ctx.exitEdit({ discard: true });
    });

    /* ---------- keys ---------- */

    await part("toolbar keys", async () => {
      await edit();
      const stops = await page.evaluate(() => [...__ec.theme().shadowRoot.querySelector("oer-edit-bar").shadowRoot.querySelectorAll(".row button, .row a[href]")].filter((b) => b.checkVisibility() && b.tabIndex === 0).map((b) => b.dataset.id));
      check("The toolbar is one tab stop", stops.length === 1, json(stops));
      await (await inBar('[data-id="sections"]')).evaluate((b) => b.focus());
      await ctx.press("ArrowRight");
      const right = (await deep())?.name;
      await ctx.press("End");
      const end = (await deep())?.name;
      await ctx.press("Home");
      const home = await page.evaluate(() => __ec.activeElement()?.dataset.id ?? null);
      check("Arrow keys, Home and End move along the toolbar", right === "Undo" && end === "Save" && home === "brand", json({ right, end, home }));
      // Skip to selected section, first in the bar
      const skip = await inBar("a.skip");
      await skip.evaluate((a) => a.focus());
      const shown = await skip.evaluate((a) => a.getBoundingClientRect().top >= 0);
      await ctx.press("Enter");
      await ctx.sleep(400);
      const after = await page.evaluate(() => {
        const active = __ec.activeElement();
        const unit = OerEditor.state.unit;
        const sel = __ec.haxBody().getRootNode().getSelection();
        return { focus: __ec.describe(active)?.path, unit: unit?.localName ?? null, caretIn: !!(sel?.rangeCount && unit?.contains(sel.anchorNode)), frame: __ec.within(active, document.querySelector("oer-block-frame")) };
      });
      check("Skip to selected section shows when focused and takes focus to the selection (its name tag, or its first field)", shown && after.unit === "oer-cs-hero" && (after.frame || (/hax-body$/.test(after.focus) && after.caretIn)), json(after));
      // the keyboard shortcuts
      await ctx.press("Mod+Slash");
      await ctx.sleep(300);
      const keys = await page.evaluate(() => {
        const d = __ec.theme().shadowRoot.querySelector("oer-edit-bar").shadowRoot.querySelector("dialog.keys");
        return { open: d.open, title: d.querySelector("h2").textContent, rows: d.querySelectorAll("dt").length };
      });
      await ctx.press("Escape");
      await ctx.sleep(300);
      const closed = await page.evaluate(() => !__ec.theme().shadowRoot.querySelector("oer-edit-bar").shadowRoot.querySelector("dialog.keys").open);
      check("Mod+/ shows the keyboard shortcuts, and Esc closes them", keys.open && keys.title === "Keyboard shortcuts" && keys.rows > 10 && closed, json({ ...keys, closed }));
      // Sections: for the Sections sheet
      await page.evaluate(() => {
        globalThis.__sections = null;
        globalThis.addEventListener("oer-sections-toggle", (e) => (globalThis.__sections = { opener: e.detail?.opener?.dataset?.id ?? null, cancelable: e.cancelable }), { once: true });
      });
      await ctx.clickAt(await inBar('[data-id="sections"]'));
      const heard = await page.evaluate(() => globalThis.__sections);
      check("Sections sends oer-sections-toggle with its button as the opener, for the Sections sheet", heard?.opener === "sections" && heard.cancelable, json(heard));
      await ctx.exitEdit({ discard: true });
    });

    /* ---------- Undo off until there's something to undo ---------- */

    await part("undo", async () => {
      await edit();
      const state = () => page.evaluate(() => {
        const b = __ec.theme().shadowRoot.querySelector("oer-edit-bar").shadowRoot.querySelector('[data-id="undo"]');
        return { off: b.getAttribute("aria-disabled"), title: b.title };
      });
      const start = await state();
      const p = await handle(() => __ec.haxBody().querySelector("oer-cs-people > p"));
      await ctx.clickAt(p);
      await ctx.press("End");
      await ctx.type(" More");
      await ctx.sleep(600);
      const typed = await state();
      await ctx.clickAt(await ctx.control("Undo"));
      await ctx.sleep(700);
      const text = await page.evaluate(() => __ec.haxBody().querySelector("oer-cs-people > p").textContent);
      check("Undo is off, saying why, until there's something to undo; then it undoes", start.off === "true" && /Nothing to undo yet/.test(start.title) && typed.off === "false" && text === "A note from the instructor.", json({ start, typed, text }));
      await ctx.exitEdit({ discard: true });
    });

    /* ---------- to check ---------- */

    await part("to check", async () => {
      await edit(SITE, CHECK_PAGE);
      await ctx.sleep(600);
      const chip = await inBar('[data-id="checks"]');
      if (!chip.asElement()) throw new Error("No ‘to check’ chip");
      const words = await chip.evaluate((b) => b.textContent.replace(/\s+/g, " ").trim());
      await ctx.clickAt(chip);
      await ctx.sleep(300);
      const list = await page.evaluate(() => {
        const pop = __ec.theme().shadowRoot.querySelector("oer-edit-bar").shadowRoot.querySelector(".checks");
        return { open: pop.matches(":popover-open"), items: [...pop.querySelectorAll("li")].map((li) => li.textContent.replace(/\s+/g, " ").trim()), focus: __ec.describe(__ec.activeElement())?.name };
      });
      check(
        "‘To check’ lists the hero's picture without a description, the empty Tools and the outcome without a title, each with a fix",
        /^3 to check$/.test(words) && list.open && list.items.some((t) => /hero's picture has no description\s*Add a description/.test(t)) && list.items.some((t) => /Tools is empty, so readers won't see it\s*Go to it/.test(t)) && list.items.some((t) => /An outcome has no title\s*Go to it/.test(t)),
        json({ words, ...list }),
      );
      const fix = await handle(() => [...__ec.theme().shadowRoot.querySelector("oer-edit-bar").shadowRoot.querySelectorAll(".checks li")].find((li) => /outcome has no title/.test(li.textContent))?.querySelector("button"));
      await ctx.clickAt(fix);
      await ctx.sleep(500);
      const went = await page.evaluate(() => {
        const sel = __ec.haxBody().getRootNode().getSelection();
        const second = __ec.haxBody().querySelectorAll("oer-cs-outcome")[1];
        return { caret: !!(sel?.rangeCount && second.querySelector("h3").contains(sel.anchorNode)), closed: !__ec.theme().shadowRoot.querySelector("oer-edit-bar").shadowRoot.querySelector(".checks").matches(":popover-open") };
      });
      check("Its Go to it puts the caret in that outcome's title", went.caret && went.closed, json(went));
      // the hero's image popover already open (WP-14): Add a description opens it again, with focus in its description
      await ctx.clickAt(await handle(() => __ec.haxBody().querySelector("oer-cs-hero").shadowRoot.querySelector(".change-image")));
      await ctx.sleep(300);
      await ctx.clickAt(await inBar('[data-id="checks"]'));
      await ctx.sleep(300);
      await ctx.clickAt(await handle(() => [...__ec.theme().shadowRoot.querySelector("oer-edit-bar").shadowRoot.querySelectorAll(".checks li")].find((li) => /picture has no description/.test(li.textContent))?.querySelector("button")));
      await ctx.sleep(500);
      const described = await page.evaluate(() => {
        const pop = document.querySelector("oer-image-popover");
        const alt = pop?.shadowRoot?.querySelector("oer-image-field")?.shadowRoot?.querySelector(".alt input");
        return { open: !!pop?.matches(":popover-open"), focus: !!alt && __ec.activeElement() === alt, at: __ec.describe(__ec.activeElement())?.path };
      });
      check("With the hero's image popover already open, Add a description opens it with focus in the description", described.open && described.focus, json(described));
      await ctx.press("Escape");
      await ctx.exitEdit({ discard: true });
    });

    /* ---------- accessibility ---------- */

    await part("axe", async () => {
      await edit();
      const quiet = await ctx.axe({ context: { include: [["custom-oer-docs-theme", "oer-edit-bar"]] } });
      await ctx.clickAt(await inBar('[data-id="more"]'));
      await ctx.sleep(300);
      const open = await ctx.axe({ context: { include: [["custom-oer-docs-theme", "oer-edit-bar"]] } });
      await ctx.press("Escape");
      const bad = (r) => r.rules.filter((v) => ["serious", "critical"].includes(v.impact)).map((v) => `${v.id} (${v.nodes}): ${json(v.targets)}`);
      check("axe reports no serious or critical violations in the editing bar, with ⋯ More open or not", !bad(quiet).length && !bad(open).length, json({ closed: bad(quiet), open: bad(open) }));
      await ctx.exitEdit({ discard: true });
    });

    /* ---------- quiet while the selection moves; Style beside the bar ---------- */

    await part("style beside", async () => {
      await size(1440);
      await edit();
      // the bar draws again for what it shows, not for each frame the selection moves
      const drawn = await page.evaluate(async () => {
        const bar = __ec.theme().shadowRoot.querySelector("oer-edit-bar");
        let n = 0;
        const own = bar.updated;
        bar.updated = function (...args) {
          n++;
          return own.apply(this, args);
        };
        const main = __ec.theme().shadowRoot.querySelector("main");
        for (let i = 0; i < 40; i++) {
          main.scrollTop += 8;
          await new Promise((r) => requestAnimationFrame(r));
        }
        delete bar.updated;
        main.scrollTop = 0;
        return { n, unit: OerEditor.state.unit?.localName ?? null };
      });
      check("While the selected section moves (scrolling), the bar doesn't draw again", drawn.unit && drawn.n <= 1, json(drawn));

      await ctx.clickAt(await inBar('[data-id="style"]'));
      await ctx.waitFor(() => document.querySelector("oer-site-style")?.open, { what: "Style", timeout: 5000 });
      await ctx.sleep(400);
      const beside = await page.evaluate(() => {
        const sheet = document.querySelector("oer-site-style").shadowRoot.querySelector(".sheet").getBoundingClientRect();
        const root = __ec.theme().shadowRoot.querySelector("oer-edit-bar").shadowRoot;
        const header = root.querySelector("header").getBoundingClientRect();
        const save = root.querySelector('[data-id="save"]').getBoundingClientRect();
        const x = save.left + save.width / 2;
        const y = save.top + save.height / 2;
        let hit = document.elementFromPoint(x, y);
        for (let inner = hit?.shadowRoot?.elementFromPoint(x, y); inner && inner !== hit; inner = hit.shadowRoot?.elementFromPoint(x, y)) hit = inner;
        return { sheetTop: Math.round(sheet.top), barBottom: Math.round(header.bottom), atSave: hit?.closest?.("[data-id]")?.dataset.id ?? hit?.localName ?? null };
      });
      check("Style opens beside the page below the editing bar, so Save stays in reach", beside.sheetTop >= beside.barBottom && beside.atSave === "save", json(beside));
      // focus in the sheet; the save's request is refused, so editing goes on
      await page.evaluate(() => document.querySelector("oer-site-style").shadowRoot.querySelector(".sheet button")?.focus());
      let sent = false;
      const onRequest = (req) => {
        if (req.isInterceptResolutionHandled()) return;
        if (req.method() === "PATCH" && /\/x\/api\/v1\/content\//.test(req.url())) {
          sent = true;
          req.respond({ status: 500, contentType: "application/json", body: "{}" });
        } else req.continue();
      };
      await page.setRequestInterception(true);
      page.on("request", onRequest);
      try {
        await ctx.press("Mod+Shift+KeyS");
        await ctx.waitFor(() => /Couldn't save/.test(__ec.theme().shadowRoot.querySelector("oer-edit-bar").shadowRoot.querySelector("[role=status]")?.textContent || ""), { what: "the refused save", timeout: 25000 });
      } finally {
        page.off("request", onRequest);
        await page.setRequestInterception(false);
      }
      check("…and Mod+Shift+S saves with focus in the sheet", sent, "");
      await ctx.press("Escape");
      await ctx.sleep(300);
      await ctx.exitEdit({ discard: true });
    });

    /* ---------- other pages ---------- */

    await part("lesson", async () => {
      await ctx.open(LESSON);
      await ctx.enterEdit();
      await ctx.sleep(1200);
      const bar = await now();
      const said = await ctx.liveRegionText();
      const title = itemOf(LESSON_ID).title;
      check(
        "An ordinary page's bar has Undo, Redo, Edit HTML, Command search, the status, Exit and Save, and no Sections, Style or Preview",
        ["undo", "redo", "html", "search", "status", "exit", "save"].every((id) => bar.shown.includes(id)) && !["sections", "style", "details", "preview"].some((id) => bar.shown.includes(id)),
        bar.shown.join(" "),
      );
      check("…named for the page, and said as editing begins", bar.label === `Editing ${title}` && said.includes(`Editing ${title}`), `${bar.label}; “${said}”`);
      const skip = await page.evaluate(() => __ec.theme().shadowRoot.querySelector("oer-edit-bar").shadowRoot.querySelector(".skip").textContent.trim());
      check("…its skip link reads Skip to the content (it has no sections)", skip === "Skip to the content", skip);
      await ctx.clickAt(await ctx.control("Exit"));
      await ctx.sleep(600);
      check("…and Exit with no changes leaves at once", !(await ctx.editMode()) && !(await page.evaluate(() => !!__ec.openDialog())), "");
    });

    await part("hub", async () => {
      await ctx.open(HUB);
      const reading = await page.evaluate(() => Math.round(__ec.theme().querySelector("oer-courses-intro").getBoundingClientRect().top));
      await ctx.enterEdit();
      await ctx.waitFor(() => globalThis.OerEditor?.state.tracking && globalThis.OerEditor.state.unit, { what: "a section selected", timeout: 6000 });
      const editing = await page.evaluate(() => ({ top: Math.round(__ec.haxBody().querySelector("oer-courses-intro").getBoundingClientRect().top), unit: OerEditor.state.unit?.localName }));
      const bar = await now();
      check("OER Courses: entering edit mode keeps the intro in place and selects it; its bar is the microsite's", Math.abs(editing.top - reading) <= 2 && editing.unit === "oer-courses-intro" && bar.label === "Editing OER Courses" && bar.shown.includes("sections"), json({ reading, editing, label: bar.label }));
      await ctx.exitEdit({ discard: true });
    });

    /* ---------- the course site's reading bar ---------- */

    await part("reading bar", async () => {
      writeFileSync(file, PAGE);
      const authorButtons = () =>
        page.evaluate(() => {
          const bar = __ec.deep("oer-course-site").shadowRoot.querySelector("header.bar");
          // (the page menu is the theme's, in the bar's page-menu slot)
          const menu = bar.querySelector('slot[name="page-menu"]')?.assignedElements().flatMap((el) => [...el.querySelectorAll("[aria-haspopup]")]) || [];
          return [...bar.querySelectorAll("button"), ...menu].filter((b) => b.checkVisibility() && !b.closest("nav")).map((b) => __ec.name(b));
        });
      const menuItems = async () => {
        await ctx.clickAt(await ctx.control("Page options"));
        await ctx.sleep(300);
        const list = await page.evaluate(() => [...__ec.theme().shadowRoot.querySelectorAll('.menu [role="menuitem"]')].filter((b) => b.checkVisibility()).map((b) => b.textContent.replace(/\s+/g, " ").trim()));
        await ctx.press("Escape");
        return list;
      };
      await ctx.open(SITE);
      const wide = await authorButtons();
      const wideMenu = await menuItems();
      const links = await page.evaluate(() => [...__ec.deep("oer-course-site").shadowRoot.querySelectorAll("nav.links button")].map((b) => b.textContent.trim()));
      check("At 1440 the bar has Edit content, Page details, Style and the page menu", ["Edit content", "Page details", "Style", "Page options"].every((n) => wide.includes(n)) && !wideMenu.includes("Style"), `${json(wide)}; menu ${json(wideMenu)}`);
      check("The bar's links take the sections' headings", links.includes("What you'll be able to do") && links.includes("Fifteen weeks, three projects"), json(links));
      for (const width of [390, 320]) {
        await size(width, 844);
        const narrow = await authorButtons();
        const menu = await menuItems();
        const fits = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
        check(`At ${width} Edit content keeps its name, Page details and Style are in the page menu, and nothing scrolls sideways`, narrow.includes("Edit content") && narrow.includes("Page options") && !narrow.includes("Page details") && menu.includes("Style") && menu.includes("Page details") && fits, `${json(narrow)}; menu ${json(menu)}`);
      }
      await size(1440);
    });

    await part("locked", async () => {
      writeFileSync(file, PAGE);
      await ctx.open(SITE);
      const lock = async (words) => {
        await ctx.clickAt(await ctx.control("Page options"));
        await ctx.sleep(300);
        await ctx.clickAt(await ctx.control(words));
        await ctx.waitFor((on) => !!__ec.store().activeItem?.metadata?.locked === on, { what: `the page ${words === "Lock page" ? "locked" : "unlocked"}`, timeout: 10000, args: [words === "Lock page"] });
        await ctx.sleep(600);
      };
      await lock("Lock page");
      try {
        const button = await handle(() => __ec.deep("oer-course-site").shadowRoot.querySelector("[data-edit-content]"));
        const state = await button.evaluate((b) => ({ off: b.getAttribute("aria-disabled"), title: b.title }));
        await ctx.clickAt(button);
        await ctx.sleep(600);
        const said = await ctx.liveRegionText();
        check("On a locked page Edit content is off, says why, and doesn't open the editor", state.off === "true" && /locked/.test(state.title) && /locked/i.test(said) && !(await ctx.editMode()), json({ ...state, said }));
      } finally {
        await lock("Unlock page");
      }
    });
  } finally {
    writeFileSync(file, original);
  }
  return results;
}
