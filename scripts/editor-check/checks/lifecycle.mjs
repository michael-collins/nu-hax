// The page level of editing (WP-11, spec §3 and §7.2): the site bar
// becomes the editing bar at the same height, so nothing moves, and the
// section at the top of the screen is selected and said; at phone width
// Save stays on screen; Save holds the edited page until HAX has reloaded
// the saved one, so the old page never shows, and lands on it with focus
// on Edit content; a failed save keeps editing with every edit; Exit asks
// Keep editing, Discard changes or Save and exit; a link out of the page
// asks too; unsaved edits come back after a reload; Preview shows the
// reader's page and Esc comes back to the same selection; a Style preview
// stays on its own site; and the hub's reading bar has the page menu.
//
// The course site's page is written into the copy before each part and
// put back at the end. Parts save the course site (in the copy).
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const SITE_ID = "item-0330a29b-7735-4ac0-afd2-e3b2a88d49e3";
const HUB_ID = "item-417a2d47-2196-42b8-acae-bb0202f18fae";
const LESSON_ID = "item-143f3783-959c-45c3-8758-dacef0f6861f";
const OLD = "Old tagline from before the save";

const PAGE = `<oer-cs-hero><p>${OLD}</p></oer-cs-hero>
<oer-cs-facts></oer-cs-facts>
<oer-cs-learn><h2>What you'll be able to do</h2><oer-cs-outcome><h3>Cut with confidence</h3><p>Plan, cut and finish parts.</p></oer-cs-outcome><oer-cs-outcome><h3>Print what you model</h3><p>Slice meshes for FDM.</p></oer-cs-outcome></oer-cs-learn>
<oer-cs-semester><h2>Fifteen weeks, three projects</h2></oer-cs-semester>
<oer-cs-make></oer-cs-make>
<oer-cs-books></oer-cs-books>
<oer-cs-people><h2>Who teaches it</h2><p>A note from the instructor.</p></oer-cs-people>
<oer-cs-tools><h2>In the shop</h2><oer-cs-tool><p>Epilog Fusion Pro laser cutter</p></oer-cs-tool><oer-cs-tool><p>Fusion 360</p></oer-cs-tool></oer-cs-tools>
<oer-cs-faq><h2>Questions</h2><oer-cs-question><h3>Do I need experience with machines?</h3><p>No. Week 1 starts with safety.</p></oer-cs-question><oer-cs-question><h3>Is it online?</h3><p>No, in the studio.</p></oer-cs-question></oer-cs-faq>
<oer-cs-closing></oer-cs-closing>
`;

/* ---------- in the page ---------- */

// whether some text shows anywhere on screen (through shadow roots)
function showing(words) {
  return __ec.all("*").some((el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.data.includes(words)) && el.checkVisibility() && el.getBoundingClientRect().height > 0);
}

export default async function lifecycle(ctx) {
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
  const slugOf = (id) => `/${items.find((i) => i.id === id).slug}`;
  const SITE = slugOf(SITE_ID);
  const HUB = slugOf(HUB_ID);
  const LESSON = slugOf(LESSON_ID);
  const file = path.join(ctx.siteDir, "pages", SITE_ID, "index.html");
  const original = readFileSync(file, "utf8");

  const handle = (fn, ...args) => page.evaluateHandle(fn, ...args);
  const bar = (selector) => handle((s) => __ec.theme().shadowRoot.querySelector("oer-edit-bar")?.shadowRoot?.querySelector(s) || null, selector);
  const status = () => page.evaluate(() => __ec.theme().shadowRoot.querySelector("oer-edit-bar")?.shadowRoot?.querySelector("[role=status]")?.textContent.trim() ?? null);
  const dialog = () =>
    page.evaluate(() => {
      const d = __ec.openDialog();
      return d ? { title: d.querySelector("h2")?.textContent.trim(), buttons: [...d.querySelectorAll("button")].map((b) => b.textContent.trim()) } : null;
    });
  const edit = async (url = SITE) => {
    if (await ctx.editMode()) await ctx.exitEdit({ discard: true });
    writeFileSync(file, PAGE);
    await ctx.open(url);
    await ctx.enterEdit();
    await ctx.waitFor(() => globalThis.OerEditor?.state.tracking, { what: "unsaved changes to be followed", timeout: 5000 });
    await ctx.sleep(300);
  };
  // the tagline's text, typed over
  const typeTagline = async (text) => {
    const p = await handle(() => __ec.haxBody().querySelector("oer-cs-hero > p"));
    await p.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await ctx.frames();
    await ctx.clickAt(p);
    await ctx.press("Mod+A");
    await ctx.type(text);
    await ctx.sleep(400);
  };
  const tagline = () => page.evaluate(() => (__ec.haxBody()?.editMode ? __ec.haxBody() : __ec.theme()).querySelector("oer-cs-hero > p")?.textContent ?? null);
  const savedTagline = () => readFileSync(file, "utf8").match(/<oer-cs-hero[^>]*>\s*<p[^>]*>(.*?)<\/p>/)?.[1] ?? null;

  try {
    /* ---------- entering edit mode: nothing moves ---------- */

    await part("entry at the top", async () => {
      writeFileSync(file, PAGE);
      await ctx.open(SITE);
      const reading = await page.evaluate(() => Math.round(__ec.theme().querySelector("oer-cs-hero").getBoundingClientRect().top * 10) / 10);
      await ctx.enterEdit();
      await ctx.waitFor(() => globalThis.OerEditor?.state.tracking && globalThis.OerEditor.state.unit, { what: "a section selected", timeout: 6000 });
      await ctx.sleep(300);
      const editing = await page.evaluate(() => ({
        top: Math.round(__ec.haxBody().querySelector("oer-cs-hero").getBoundingClientRect().top * 10) / 10,
        unit: OerEditor.state.unit?.localName ?? null,
        mode: OerEditor.state.mode,
        note: !!__ec.theme().shadowRoot.querySelector(".cs-editing"),
        focus: __ec.describe(__ec.activeElement())?.tag ?? null,
      }));
      const said = await ctx.liveRegionText();
      check("At scroll 0, entering edit mode keeps the hero's top within 2px", Math.abs(editing.top - reading) <= 2, `reading ${reading}, editing ${editing.top}${editing.note ? "; the editing note is there" : ""}`);
      check("…selects the hero as a whole, with focus off <body>", editing.unit === "oer-cs-hero" && editing.mode === "selected" && editing.focus !== "body", json(editing));
      check("…and the live region says ‘Editing DART 413’, the sections and what's selected", /Editing DART 413 course site, \d+ sections\. Hero selected/.test(said), said);
      await ctx.exitEdit({ discard: true });
    });

    await part("entry scrolled", async () => {
      writeFileSync(file, PAGE);
      await ctx.open(SITE);
      // Tools at the top of the screen, under the bar
      const reading = await page.evaluate(async () => {
        const main = __ec.theme().shadowRoot.querySelector("main");
        const barBottom = __ec.deep("oer-course-site").shadowRoot.querySelector("header.bar").getBoundingClientRect().bottom;
        const tools = __ec.theme().querySelector("oer-cs-tools");
        main.scrollTop += tools.getBoundingClientRect().top - barBottom;
        await new Promise((r) => setTimeout(r, 300));
        return Math.round(tools.getBoundingClientRect().top * 10) / 10;
      });
      await ctx.enterEdit();
      await ctx.waitFor(() => globalThis.OerEditor?.state.tracking && globalThis.OerEditor.state.unit, { what: "a section selected", timeout: 6000 });
      await ctx.sleep(300);
      const editing = await page.evaluate(() => ({ top: Math.round(__ec.haxBody().querySelector("oer-cs-tools").getBoundingClientRect().top * 10) / 10, unit: OerEditor.state.unit?.localName ?? null }));
      check("Scrolled so Tools is at the top, entering edit mode selects Tools with its top within 8px of where it was", editing.unit === "oer-cs-tools" && Math.abs(editing.top - reading) <= 8, `reading ${reading}, editing ${json(editing)}`);
      await ctx.exitEdit({ discard: true });
    });

    /* ---------- a phone ---------- */

    await part("phone", async () => {
      await ctx.setViewport(390);
      await edit();
      const fit = await page.evaluate(() => {
        const save = __ec.theme().shadowRoot.querySelector("oer-edit-bar").shadowRoot.querySelector('[data-id="save"]');
        const r = save.getBoundingClientRect();
        const doc = document.documentElement;
        return { save: [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)], width: innerWidth, height: innerHeight, scroll: [doc.scrollWidth, doc.clientWidth] };
      });
      check(
        "At 390 the Save button lies fully inside the viewport and the page has no horizontal scroll",
        fit.save[0] >= 0 && fit.save[1] >= 0 && fit.save[2] <= fit.width && fit.save[3] <= fit.height && fit.scroll[0] <= fit.scroll[1],
        json(fit),
      );
      await ctx.exitEdit({ discard: true });
      await ctx.setViewport(1440);
    });

    /* ---------- saving ---------- */

    await part("save", async () => {
      await edit();
      await typeTagline("New tagline typed just now");
      // every 50 ms and every frame: is the old tagline, or a blank reading view, on screen?
      await page.evaluate((OLD, showing) => {
        const seen = new Function("words", `return (${showing})(words)`);
        globalThis.__samples = [];
        const sample = () => {
          const editing = !!__ec.store().editMode;
          globalThis.__samples.push({ old: seen(OLD), now: seen("New tagline typed just now"), editing });
        };
        globalThis.__sampling = setInterval(sample, 50);
        const frame = () => globalThis.__sampling && (sample(), requestAnimationFrame(frame));
        requestAnimationFrame(frame);
      }, OLD, showing.toString());
      await ctx.clickAt(await ctx.control("Save"));
      await ctx.sleep(300);
      const during = { status: await status(), inert: await page.evaluate(() => __ec.haxBody().inert), editing: await ctx.editMode() };
      await ctx.waitFor(() => !__ec.store().editMode, { what: "the reading view", timeout: 30000 });
      await ctx.sleep(1200);
      const samples = await page.evaluate(() => {
        clearInterval(globalThis.__sampling);
        globalThis.__sampling = 0;
        const s = globalThis.__samples;
        return { count: s.length, old: s.filter((x) => x.old).length, blank: s.filter((x) => !x.editing && !x.now).length };
      });
      const focus = await ctx.deepActiveElement();
      check("While saving the edited page stays on screen, inert, with ‘Saving…’", during.editing && during.inert && during.status === "Saving…", json(during));
      check("After Save no sample shows the old tagline (or a blank page) before the reading view appears", samples.count > 20 && !samples.old && !samples.blank, json(samples));
      check("…the saved file has the new tagline", savedTagline() === "New tagline typed just now", `saved: ${savedTagline()}`);
      check("…and deep focus is on Edit content", focus?.name === "Edit content", json(focus));
    });

    await part("save fails", async () => {
      await edit();
      await typeTagline("Typed before a failed save");
      const refuse = (req) => {
        if (req.isInterceptResolutionHandled()) return;
        if (req.method() === "PATCH" && /\/x\/api\/v1\/content\//.test(req.url())) req.respond({ status: 500, contentType: "application/json", body: "{}" });
        else req.continue();
      };
      await page.setRequestInterception(true);
      page.on("request", refuse);
      try {
        await ctx.clickAt(await ctx.control("Save"));
        await ctx.waitFor(() => /Couldn't save/.test(__ec.theme().shadowRoot.querySelector("oer-edit-bar")?.shadowRoot?.querySelector("[role=status]")?.textContent || ""), { what: "Couldn't save", timeout: 25000 });
      } finally {
        page.off("request", refuse);
        await page.setRequestInterception(false);
      }
      const after = { editing: await ctx.editMode(), status: await status(), text: await tagline(), inert: await page.evaluate(() => __ec.haxBody().inert), dirty: await page.evaluate(() => OerEditor.state.dirty) };
      check("With the save answering 500, edit mode stays on, the status says ‘Couldn't save’ and the typed text is still there", after.editing && /Couldn't save/.test(after.status) && after.text === "Typed before a failed save" && !after.inert && after.dirty, json(after));
      const retry = await bar('[data-id="retry"]');
      check("…and offers Try again", !!retry.asElement(), "");
      if (retry.asElement()) {
        await ctx.clickAt(retry);
        await ctx.waitFor(() => !__ec.store().editMode, { what: "the reading view after Try again", timeout: 30000 });
        check("Try again saves it", savedTagline() === "Typed before a failed save", `saved: ${savedTagline()}`);
      }
    });

    await part("save by keys", async () => {
      await edit();
      await typeTagline("Saved with the keys");
      await ctx.press("Mod+Shift+KeyS");
      await ctx.sleep(400);
      const holding = (await ctx.editMode()) && (await status()) === "Saving…";
      await ctx.waitFor(() => !__ec.store().editMode, { what: "the reading view", timeout: 30000 });
      check("Mod+Shift+S saves the same way (held, then the reading view)", holding && savedTagline() === "Saved with the keys", `held ${holding}; saved: ${savedTagline()}`);
    });

    /* ---------- leaving ---------- */

    await part("exit", async () => {
      await edit();
      await typeTagline("Typed then left");
      await ctx.clickAt(await ctx.control("Exit"));
      await ctx.waitFor(() => !!__ec.openDialog(), { what: "the leave dialog", timeout: 5000 });
      const asked = await dialog();
      check("Exit with changes asks, with Keep editing, Discard changes and Save and exit", json(asked?.buttons) === json(["Keep editing", "Discard changes", "Save and exit"]), json(asked));
      await ctx.clickAt(await ctx.control("Keep editing"));
      await ctx.sleep(300);
      const kept = { editing: await ctx.editMode(), focus: (await ctx.deepActiveElement())?.name, text: await tagline() };
      check("Keep editing stays, with the changes, and focus back on Exit", kept.editing && kept.focus === "Exit" && kept.text === "Typed then left", json(kept));
      await ctx.clickAt(await ctx.control("Exit"));
      await ctx.waitFor(() => !!__ec.openDialog(), { what: "the leave dialog", timeout: 5000 });
      await ctx.clickAt(await ctx.control("Discard changes"));
      await ctx.waitForReading();
      const shown = await page.evaluate((OLD) => ({ old: __ec.theme().querySelector("oer-cs-hero > p")?.textContent, focus: __ec.describe(__ec.activeElement())?.name }), OLD);
      check("Discard changes shows the old content in the reading view", shown.old === OLD && savedTagline() === OLD, json(shown));
      check("…with focus on Edit content", shown.focus === "Edit content", json(shown));
    });

    await part("leave guard", async () => {
      await edit();
      await typeTagline("Typed then a link");
      const url = page.url();
      const brand = await bar("a.brand");
      if (!brand.asElement()) throw new Error("The editing bar has no brand link");
      await ctx.clickAt(brand);
      await ctx.waitFor(() => !!__ec.openDialog(), { what: "the leave dialog", timeout: 5000 });
      const asked = await dialog();
      check("The bar's brand link with unsaved changes asks first", asked?.title === "Leave without saving?" && json(asked.buttons) === json(["Keep editing", "Leave without saving", "Save and go"]), json(asked));
      await ctx.clickAt(await ctx.control("Keep editing"));
      await ctx.sleep(500);
      check("…and Keep editing stays in the editor, on the page", (await ctx.editMode()) && page.url() === url && (await tagline()) === "Typed then a link", page.url());
      await ctx.clickAt(brand);
      await ctx.waitFor(() => !!__ec.openDialog(), { what: "the leave dialog", timeout: 5000 });
      await ctx.clickAt(await ctx.control("Leave without saving"));
      await ctx.waitFor((hub) => !__ec.store().editMode && location.pathname.replace(/\/$/, "") === hub, { what: "OER Courses", timeout: 15000, args: [HUB] });
      check("Leave without saving goes there, saving nothing", savedTagline() === OLD, `at ${new URL(page.url()).pathname}; saved: ${savedTagline()}`);
    });

    /* ---------- unsaved edits after a reload ---------- */

    await part("recovery", async () => {
      await edit();
      await typeTagline("Typed before a reload");
      // (the copy is kept 2 s after the last change)
      await ctx.sleep(2600);
      await page.reload({ waitUntil: "load" });
      await ctx.open(SITE);
      const chip = await page.evaluate(() => [...(__ec.deep("oer-course-site")?.shadowRoot?.querySelectorAll("button") || [])].map((b) => b.textContent.replace(/\s+/g, " ").trim()).find((t) => /^Unsaved edits from/.test(t)) ?? null);
      check("After a reload the course site's bar says there are unsaved edits", /^Unsaved edits from \d{1,2}:\d{2} (am|pm) · Edit content to restore$/.test(chip || ""), chip);
      const toasts = await page.evaluate(() => __ec.deep("oer-toast")?.shadowRoot?.textContent.replace(/\s+/g, " ").trim() ?? "");
      check("…and HAX's own ‘Recovered unsaved edits’ toast isn't shown", !/Recovered unsaved edits/.test(toasts), toasts.slice(0, 120));
      await ctx.clickAt(await ctx.control("Edit content"));
      await ctx.waitFor(() => !!__ec.openDialog(), { what: "the restore question", timeout: 10000 });
      const asked = await dialog();
      check("Edit content offers them back: Restore unsaved edits from …?", /^Restore unsaved edits from \d{1,2}:\d{2} (am|pm)\?$/.test(asked?.title || "") && asked.buttons.includes("Restore") && asked.buttons.includes("Discard them"), json(asked));
      await ctx.clickAt(await ctx.control("Restore"));
      await ctx.sleep(800);
      await ctx.waitFor(() => OerEditor.state.dirty, { what: "unsaved changes", timeout: 5000 }).catch(() => {});
      const restored = { text: await tagline(), status: await status() };
      check("Restore brings the text back and the status reads ‘Unsaved changes’", restored.text === "Typed before a reload" && restored.status === "Unsaved changes", json(restored));
      await ctx.exitEdit({ discard: true });
      const left = await page.evaluate((id) => JSON.stringify(JSON.parse(sessionStorage.getItem("oer-pending-edits") || "{}")[id] ?? null), SITE_ID).then((v) => (v === "null" ? null : v));
      check("Discarding the changes drops the copy", !left, left ? left.slice(0, 80) : "none");
    });

    /* ---------- Preview ---------- */

    await part("preview", async () => {
      await edit();
      const question = await handle(() => __ec.haxBody().querySelectorAll("oer-cs-question > h3")[1]);
      await question.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await ctx.frames();
      await ctx.clickAt(question);
      await ctx.sleep(400);
      const before = await page.evaluate(() => ({ mode: OerEditor.state.mode }));
      const beforeUnit = await page.evaluate(() => [...__ec.haxBody().querySelectorAll("oer-cs-question")].indexOf(OerEditor.state.unit));
      await ctx.clickAt(await bar('[data-id="preview"]'));
      await ctx.sleep(600);
      const shown = await page.evaluate(() => {
        const body = __ec.haxBody();
        const overlays = ["oer-block-frame", "oer-block-rail", "oer-block-inserter"].map((t) => document.querySelector(t)).filter(Boolean);
        return {
          inert: body.inert,
          marked: body.hasAttribute("data-oer-preview"),
          open: [...body.querySelectorAll("oer-cs-question")].map((q) => !!q.shadowRoot.querySelector("details")?.open),
          overlays: overlays.map((el) => `${el.localName}:${el.checkVisibility() ? "shown" : "hidden"}`),
          placeholders: [...body.querySelectorAll("oer-cs-learn, oer-cs-faq")].some((s) => [...s.shadowRoot.querySelectorAll(".ph")].some((p) => p.checkVisibility())),
        };
      });
      check(
        "In Preview hax-body is inert, the FAQ's questions are closed, and the frame and rail are hidden",
        shown.inert && shown.marked && shown.open.length === 2 && shown.open.every((o) => !o) && shown.overlays.length >= 2 && shown.overlays.every((o) => o.endsWith("hidden")),
        json(shown),
      );
      await ctx.press("Escape");
      await ctx.sleep(500);
      const back = await page.evaluate(() => ({ inert: __ec.haxBody().inert, index: [...__ec.haxBody().querySelectorAll("oer-cs-question")].indexOf(OerEditor.state.unit), mode: OerEditor.state.mode, preview: OerEditor.state.preview }));
      check("Esc goes back to editing with the same unit selected", !back.inert && !back.preview && back.index === beforeUnit && beforeUnit === 1 && back.mode === before.mode, json({ before: { index: beforeUnit, mode: before.mode }, back }));
      await ctx.exitEdit({ discard: true });
    });

    /* ---------- Style on its own site; the hub's page menu ---------- */

    await part("style", async () => {
      writeFileSync(file, PAGE);
      await ctx.open(HUB);
      const hubOwn = await page.evaluate(() => __ec.theme().shadowRoot.querySelector("main").getAttribute("style") || "");
      await ctx.open(SITE);
      const siteOwn = await page.evaluate(() => __ec.theme().shadowRoot.querySelector("main").getAttribute("style") || "");
      const styleButton = await handle(() => [...__ec.deep("oer-course-site").shadowRoot.querySelectorAll("header.bar button")].find((b) => b.textContent.trim() === "Style"));
      await ctx.clickAt(styleButton);
      await ctx.sleep(300);
      // another scheme than the site's own
      const swatch = await handle(() => [...document.querySelector("oer-site-style").shadowRoot.querySelectorAll('.swatches [role="radio"]')].find((r) => r.getAttribute("aria-checked") !== "true"));
      await ctx.clickAt(swatch);
      await ctx.sleep(300);
      const previewed = await page.evaluate(() => __ec.theme().shadowRoot.querySelector("main").getAttribute("style") || "");
      check("A Style choice previews on its course site", previewed !== siteOwn, `${siteOwn.slice(0, 60)} → ${previewed.slice(0, 60)}`);
      // the arrow keys move the choice
      const checked = () => page.evaluate(() => [...document.querySelector("oer-site-style").shadowRoot.querySelectorAll('.swatches [role="radio"]')].findIndex((r) => r.getAttribute("aria-checked") === "true"));
      const from = await checked();
      await ctx.press("ArrowRight");
      await ctx.sleep(200);
      const to = await checked();
      check("…the swatches are a radio group the arrow keys move through", from >= 0 && to === from + 1, `checked ${from} → ${to}`);
      // the brand: to OER Courses, the sheet still open with the choice
      await ctx.clickAt(await handle(() => __ec.deep("oer-course-site").shadowRoot.querySelector("a.brand")));
      await ctx.waitFor((hub) => location.pathname.replace(/\/$/, "") === hub && __ec.store().activeItem?.metadata?.pageType === "oer:course-hub", { what: "OER Courses", timeout: 10000, args: [HUB] });
      await ctx.sleep(800);
      const onHub = await page.evaluate(() => __ec.theme().shadowRoot.querySelector("main").getAttribute("style") || "");
      check("A Style preview on one course site leaves another site's main style unchanged", onHub === hubOwn, `hub's own “${hubOwn.slice(0, 60)}”, with the preview open “${onHub.slice(0, 60)}”`);
      await page.evaluate(() => document.querySelector("oer-site-style")?._cancel());
      // the hub's reading bar: the page menu, with Publish
      const menuButton = await handle(() => __ec.deep("oer-course-site").shadowRoot.querySelector("header.bar slot[name=page-menu]")?.assignedElements()[0]?.querySelector('[aria-haspopup="menu"]') || null);
      if (!menuButton.asElement()) throw new Error("The hub's bar has no page menu");
      await ctx.clickAt(menuButton);
      await ctx.sleep(300);
      const menu = await page.evaluate(() => [...__ec.theme().shadowRoot.querySelectorAll('.menu [role="menuitem"]')].filter((b) => b.checkVisibility()).map((b) => b.textContent.replace(/\s+/g, " ").trim()));
      check("The hub's reading bar has a page menu containing Publish", menu.some((m) => /^(Publish|Unpublish)$/.test(m)) && menu.some((m) => /^Edit content/.test(m)), json(menu));
      await ctx.press("Escape");
      await ctx.sleep(200);
      check("…and Esc closes it with focus back on its button", (await ctx.deepActiveElement())?.name === "Page options", json(await ctx.deepActiveElement()));
    });

    await part("page details focus", async () => {
      await ctx.open(LESSON);
      await ctx.clickAt(await ctx.control("Page options"));
      await ctx.sleep(300);
      await ctx.clickAt(await ctx.control("Page details"));
      await ctx.waitFor(() => document.querySelector("oer-page-details")?.open, { what: "Page details", timeout: 5000 });
      await ctx.press("Escape");
      await ctx.sleep(400);
      const focus = await ctx.deepActiveElement();
      check("Page details opened from the page menu gives focus back to the menu's button as it closes", focus?.name === "Page options", json(focus));
    });
  } finally {
    writeFileSync(file, original);
  }
  return results;
}
