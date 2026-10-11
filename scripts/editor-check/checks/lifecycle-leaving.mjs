// Leaving the page being edited, and unsaved edits after a reload, at
// their edges (WP-11, spec §3.2, §3.3, §7.2): the browser's Back and
// Forward ask as a link out of the page does, and with nothing changed end
// editing before the page changes; Save and go saves and goes; HTML typed
// in Edit HTML and not applied counts as a change on Exit and on a reload,
// and is saved with the page; an image's address typed and not yet on the
// page counts too; the bar's keys do nothing under the restore question; Not
// now keeps the edits for next time, whatever this session does; edits
// made just before a reload are kept too; in Preview, Esc is for what's
// open over the page, and Save and Save and exit work; entering edit mode
// on an ordinary page puts the caret in its first block.
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

export default async function lifecycleLeaving(ctx) {
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
  // the course site's copy of unsaved edits a reload leaves (recovery.js:
  // one per page), and dropping them all
  const copy = (id = SITE_ID) => page.evaluate((id) => JSON.parse(sessionStorage.getItem("oer-pending-edits") || "{}")[id] ?? null, id);
  const dropCopies = () => page.evaluate(() => ["haxcms-pending-edit", "oer-pending-edits"].forEach((k) => sessionStorage.removeItem(k)));
  const path_ = () => page.evaluate(() => location.pathname.replace(/\/$/, ""));
  // Edit HTML from ⋯ More, with its code loaded; then HTML typed at its
  // end, with the keyboard (in the code editor's frame)
  const openSource = async () => {
    await ctx.clickAt(await bar('[data-id="more"]'));
    await ctx.sleep(300);
    await ctx.clickAt(await ctx.control("Edit HTML"));
    await ctx.waitFor(() => (HaxStore.requestAvailability().haxTray.shadowRoot.querySelector("#view-source")?.shadowRoot?.querySelector("#textarea")?.value || "").includes("oer-cs-hero"), { what: "Edit HTML's code", timeout: 15000 });
    await ctx.sleep(300);
  };
  const typeSource = async (html) => {
    const code = await handle(() => HaxStore.requestAvailability().haxTray.shadowRoot.querySelector("#view-source").shadowRoot.querySelector("#textarea"));
    await ctx.sleep(1500);
    await ctx.clickAt(code, { covered: true });
    await ctx.press("Mod+End");
    await ctx.press("Enter");
    await ctx.type(html);
    await ctx.sleep(800);
  };
  const sourceOpen = () => page.evaluate(() => document.querySelector("oer-settings-dialog")?.mode ?? null);
  // whether closing or reloading the tab would get the browser's question (the editor's beforeunload)
  const wouldAsk = () =>
    page.evaluate(() => {
      const e = new Event("beforeunload", { cancelable: true });
      dispatchEvent(e);
      return e.defaultPrevented;
    });

  try {
    /* ---------- leaving: Back and Forward, Save and go ---------- */

    await part("back and forward", async () => {
      writeFileSync(file, PAGE);
      await dropCopies().catch(() => {});
      await ctx.open(HUB);
      // to the course site in the same document, as the hub's catalog goes there (hax-router.js)
      const toSite = async () => {
        await page.evaluate((to) => {
          history.pushState(null, "", to);
          dispatchEvent(new PopStateEvent("popstate"));
        }, SITE);
        await ctx.waitFor((slug) => __ec.store().activeItem?.slug === slug && !!__ec.theme().querySelector("oer-cs-hero"), { what: "the course site", timeout: 15000, args: [SITE.slice(1)] });
        await ctx.settle();
      };
      await toSite();
      await ctx.enterEdit();
      await ctx.waitFor(() => globalThis.OerEditor?.state.tracking, { what: "unsaved changes to be followed", timeout: 5000 });
      await typeTagline("Typed then Back");
      await page.evaluate(() => history.back());
      await ctx.waitFor(() => !!__ec.openDialog(), { what: "the leave dialog", timeout: 5000 }).catch(() => {});
      const asked = await dialog();
      const held = { at: await path_(), editing: await ctx.editMode(), item: await page.evaluate(() => __ec.store().activeItem?.slug) };
      check(
        "The browser's Back with unsaved changes asks first, and the page stays, at its address",
        asked?.title === "Leave without saving?" && json(asked.buttons) === json(["Keep editing", "Leave without saving", "Save and go"]) && held.at === SITE && held.editing && `/${held.item}` === SITE,
        json({ asked, ...held }),
      );
      if (asked) await ctx.clickAt(await ctx.control("Keep editing"));
      await ctx.sleep(600);
      const kept = { at: await path_(), editing: await ctx.editMode(), text: await tagline(), status: await status(), label: await page.evaluate(() => __ec.theme().shadowRoot.querySelector("oer-edit-bar")?.shadowRoot?.querySelector("header")?.getAttribute("aria-label")) };
      check("…Keep editing stays on the course site with the changes", kept.at === SITE && kept.editing && kept.text === "Typed then Back" && kept.status === "Unsaved changes" && kept.label === "Editing DART 413 course site", json(kept));
      await page.evaluate(() => history.back());
      await ctx.waitFor(() => !!__ec.openDialog(), { what: "the leave dialog", timeout: 5000 });
      await ctx.clickAt(await ctx.control("Leave without saving"));
      await ctx.waitFor((hub) => !__ec.store().editMode && location.pathname.replace(/\/$/, "") === hub && __ec.store().activeItem?.metadata?.pageType === "oer:course-hub", { what: "OER Courses", timeout: 15000, args: [HUB] });
      await ctx.settle();
      const left = { at: await path_(), saved: savedTagline(), copy: (await copy())?.itemId ?? null, hub: await page.evaluate(() => !!__ec.theme().querySelector("oer-courses-catalog")) };
      check("…and Leave without saving goes back to OER Courses, reading, saving nothing", left.at === HUB && left.saved === OLD && !left.copy && left.hub, json(left));
      // Forward to the course site, then Back with nothing changed
      await page.evaluate(() => history.forward());
      await ctx.waitFor((slug) => __ec.store().activeItem?.slug === slug, { what: "the course site again", timeout: 15000, args: [SITE.slice(1)] });
      await ctx.settle();
      await ctx.enterEdit();
      await ctx.waitFor(() => globalThis.OerEditor?.state.tracking, { what: "unsaved changes to be followed", timeout: 5000 });
      await page.evaluate(() => history.back());
      await ctx.waitFor((hub) => !__ec.store().editMode && location.pathname.replace(/\/$/, "") === hub && __ec.store().activeItem?.metadata?.pageType === "oer:course-hub", { what: "OER Courses", timeout: 15000, args: [HUB] }).catch(() => {});
      const clean = { at: await path_(), editing: await ctx.editMode(), asked: await dialog() };
      check("With nothing changed, Back ends editing and goes back, asking nothing", clean.at === HUB && !clean.editing && !clean.asked, json(clean));
    });

    await part("save and go", async () => {
      await dropCopies().catch(() => {});
      await edit();
      await typeTagline("Saved on the way out");
      await ctx.clickAt(await bar("a.brand"));
      await ctx.waitFor(() => !!__ec.openDialog(), { what: "the leave dialog", timeout: 5000 });
      await ctx.clickAt(await ctx.control("Save and go"));
      await ctx.waitFor((hub) => !__ec.store().editMode && location.pathname.replace(/\/$/, "") === hub, { what: "OER Courses", timeout: 30000, args: [HUB] }).catch(() => {});
      const went = { at: await path_(), editing: await ctx.editMode(), saved: savedTagline() };
      check("Save and go saves the page, then goes to the link's page", went.at === HUB && !went.editing && went.saved === "Saved on the way out", json(went));
    });

    /* ---------- Edit HTML not applied yet ---------- */

    await part("edit html", async () => {
      await edit();
      await openSource();
      await typeSource("<p>Typed in Edit HTML");
      // (focus out of the code editor, on the dialog's title)
      await ctx.clickAt(await handle(() => document.querySelector("oer-settings-dialog").shadowRoot.querySelector("h2")));
      await ctx.press("Mod+Shift+Slash");
      await ctx.waitFor(() => !!__ec.openDialog(), { what: "the leave dialog", timeout: 5000 }).catch(() => {});
      const asked = await dialog();
      check("Exit by its keys with HTML typed in Edit HTML and not applied asks first", asked?.title === "Leave without saving?" && (await ctx.editMode()), json(asked));
      if (asked) await ctx.clickAt(await ctx.control("Keep editing"));
      await ctx.sleep(400);
      const reload = { asks: await wouldAsk(), dirty: await page.evaluate(() => OerEditor.state.dirty) };
      check("…and so does closing or reloading the tab (the browser's question)", reload.asks && !reload.dirty, json(reload));
      await ctx.press("Mod+Shift+KeyS");
      await ctx.waitFor(() => !__ec.store().editMode, { what: "the reading view", timeout: 30000 }).catch(() => {});
      await ctx.sleep(800);
      const saved = { editing: await ctx.editMode(), file: readFileSync(file, "utf8").includes("Typed in Edit HTML"), dialog: await sourceOpen() };
      check("Save by its keys with HTML typed in Edit HTML saves that HTML, and the dialog closes", !saved.editing && saved.file && !saved.dialog, json(saved));
    });

    /* ---------- an image's address, typed and not yet on the page ---------- */

    await part("image address", async () => {
      await edit();
      await (await handle(() => __ec.haxBody().querySelector("oer-cs-hero"))).evaluate((el) => el.scrollIntoView({ block: "center" }));
      await ctx.clickAt(await handle(() => __ec.haxBody().querySelector("oer-cs-hero").shadowRoot.querySelector(".change-image")));
      await ctx.sleep(300);
      await ctx.clickAt(await ctx.control("Use an address"));
      await ctx.sleep(300);
      // (in the image popover, since WP-14)
      await ctx.clickAt(await handle(() => document.querySelector("oer-image-popover").shadowRoot.querySelector("oer-image-field").shadowRoot.querySelector('input[type="text"]')));
      await ctx.type("files/typed-address.jpg");
      await ctx.sleep(400);
      const typed = { status: await status(), asks: await wouldAsk() };
      await ctx.press("Mod+Shift+Slash");
      await ctx.waitFor(() => !!__ec.openDialog(), { what: "the leave dialog", timeout: 5000 }).catch(() => {});
      const asked = await dialog();
      check(
        "An image address typed and not yet on the page counts: reloading the tab asks, and so does Exit by its keys",
        typed.asks && asked?.title === "Leave without saving?" && (await ctx.editMode()),
        json({ ...typed, asked }),
      );
      if (asked) await ctx.clickAt(await ctx.control("Discard changes"));
      await ctx.waitForReading();
    });

    /* ---------- recovery: under the question, Not now, the last 2 s ---------- */

    await part("recovery edges", async () => {
      await dropCopies().catch(() => {});
      await edit();
      await typeTagline("Typed before a reload, kept");
      await ctx.sleep(2600);
      await page.reload({ waitUntil: "load" });
      await ctx.open(SITE);
      await ctx.clickAt(await ctx.control("Edit content"));
      await ctx.waitFor(() => !!__ec.openDialog(), { what: "the restore question", timeout: 10000 });
      await ctx.press("Mod+Shift+Slash");
      await ctx.sleep(600);
      await ctx.press("Mod+Shift+KeyS");
      await ctx.sleep(1500);
      const under = { asked: (await dialog())?.title ?? null, editing: await ctx.editMode(), copy: (await copy())?.content?.includes("Typed before a reload, kept") ?? false };
      check("Exit's and Save's keys do nothing under the restore question, and the copy stays", /^Restore unsaved edits/.test(under.asked || "") && under.editing && under.copy, json(under));
      await ctx.clickAt(await ctx.control("Not now"));
      await ctx.sleep(300);
      // a click on a heading (no typing), then Exit with nothing changed
      const heading = await handle(() => __ec.haxBody().querySelector("oer-cs-people > h2"));
      await heading.evaluate((el) => el.scrollIntoView({ block: "center" }));
      // (the inserter's seams follow the scroll a frame later)
      await ctx.frames();
      await ctx.clickAt(heading);
      await ctx.sleep(2600);
      const afterClick = (await copy())?.content?.includes("Typed before a reload, kept") ?? false;
      await ctx.clickAt(await ctx.control("Exit"));
      await ctx.waitForReading();
      const chip = await page.evaluate(() => [...(__ec.deep("oer-course-site")?.shadowRoot?.querySelectorAll("button") || [])].some((b) => /^Unsaved edits from/.test(b.textContent.replace(/\s+/g, " ").trim())));
      const afterExit = (await copy())?.content?.includes("Typed before a reload, kept") ?? false;
      check("Not now keeps the edits: a click and Exit with nothing changed leave the copy, and the bar still offers it", afterClick && afterExit && chip, json({ afterClick, afterExit, chip }));
      // Not now again, then a change of this session's own
      await ctx.clickAt(await ctx.control("Edit content"));
      await ctx.waitFor(() => !!__ec.openDialog(), { what: "the restore question", timeout: 10000 });
      await ctx.clickAt(await ctx.control("Not now"));
      await ctx.sleep(300);
      const note = await handle(() => __ec.haxBody().querySelector("oer-cs-people > p"));
      await note.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await ctx.clickAt(note);
      await ctx.press("End");
      await ctx.type(" Hi.");
      await ctx.sleep(2600);
      const replaced = await copy();
      check("…and a change made after Not now doesn't replace them", replaced?.content?.includes("Typed before a reload, kept") && !replaced.content.includes(" Hi."), (replaced?.content || "none").slice(0, 80));
      await ctx.exitEdit({ discard: true });
      await ctx.clickAt(await ctx.control("Edit content"));
      await ctx.waitFor(() => !!__ec.openDialog(), { what: "the restore question", timeout: 10000 });
      await ctx.clickAt(await ctx.control("Restore"));
      await ctx.sleep(800);
      check("…so Restore still brings them back", (await tagline()) === "Typed before a reload, kept", await tagline());
      await ctx.exitEdit({ discard: true });
      // typing, then a reload at once
      await edit();
      const p = await handle(() => __ec.haxBody().querySelector("oer-cs-hero > p"));
      await ctx.clickAt(p);
      await ctx.press("Mod+A");
      await ctx.type("Typed just before a reload");
      await ctx.sleep(200);
      await page.reload({ waitUntil: "load" });
      await ctx.open(SITE);
      const last = await copy();
      check("Edits made just before a reload (under 2 s) are kept too", !!last?.content?.includes("Typed just before a reload"), (last?.content || "none").slice(0, 80));
      await dropCopies();
    });

    /* ---------- Preview: Exit, Save, Esc ---------- */

    await part("preview edges", async () => {
      await dropCopies().catch(() => {});
      await edit();
      await typeTagline("Saved from Preview");
      await ctx.clickAt(await bar('[data-id="preview"]'));
      await ctx.sleep(400);
      await ctx.clickAt(await bar('[data-id="details"]'));
      await ctx.waitFor(() => document.querySelector("oer-page-details")?.open, { what: "Page details", timeout: 5000 });
      await ctx.press("Escape");
      await ctx.sleep(400);
      const esc = await page.evaluate(() => ({ details: !!document.querySelector("oer-page-details")?.open, preview: OerEditor.state.preview }));
      check("In Preview, Esc in Page details closes Page details and stays in Preview", !esc.details && esc.preview, json(esc));
      await ctx.clickAt(await ctx.control("Exit"));
      await ctx.waitFor(() => !!__ec.openDialog(), { what: "the leave dialog", timeout: 5000 });
      await ctx.press("Escape");
      await ctx.sleep(400);
      const esc2 = { asked: await dialog(), preview: await page.evaluate(() => OerEditor.state.preview) };
      check("…Esc in Exit's question closes the question and stays in Preview", !esc2.asked && esc2.preview, json(esc2));
      await ctx.clickAt(await ctx.control("Exit"));
      await ctx.waitFor(() => !!__ec.openDialog(), { what: "the leave dialog", timeout: 5000 });
      await ctx.clickAt(await ctx.control("Save and exit"));
      await ctx.waitFor(() => !__ec.store().editMode, { what: "the reading view", timeout: 30000 }).catch(() => {});
      const saved = { editing: await ctx.editMode(), saved: savedTagline() };
      check("…and Save and exit from Preview saves", !saved.editing && saved.saved === "Saved from Preview", json(saved));
      await edit();
      await typeTagline("Saved by keys from Preview");
      await ctx.clickAt(await bar('[data-id="preview"]'));
      await ctx.sleep(400);
      await ctx.press("Mod+Shift+KeyS");
      await ctx.waitFor(() => !__ec.store().editMode, { what: "the reading view", timeout: 30000 }).catch(() => {});
      check("Save's keys in Preview save", savedTagline() === "Saved by keys from Preview" && !(await ctx.editMode()), `saved: ${savedTagline()}`);
    });

    /* ---------- an ordinary page's entry ---------- */

    await part("lesson entry", async () => {
      await ctx.open(LESSON);
      // by the keyboard, from the page menu, whose Edit content goes as editing begins
      await (await ctx.control("Page options")).focus();
      await ctx.press("Enter");
      await ctx.waitFor(() => /^Edit content/.test(__ec.describe(__ec.activeElement())?.name || ""), { what: "the page menu's Edit content", timeout: 5000 });
      await ctx.press("Enter");
      await ctx.waitFor(() => __ec.store().editMode && globalThis.OerEditor?.state.tracking, { what: "edit mode", timeout: 15000 });
      await ctx.sleep(800);
      const entry = await page.evaluate(() => ({ focus: __ec.describe(__ec.activeElement())?.tag ?? null, mode: OerEditor.state.mode }));
      const said = await ctx.liveRegionText();
      check("Entering edit mode on an ordinary page puts the caret in its first block on screen", entry.focus === "hax-body" && entry.mode === "typing", json(entry));
      check("…and what's said has no doubled punctuation", said.includes("Editing ") && !/[.?!]\./.test(said), said);
      await ctx.exitEdit({ discard: true });
    });

  } finally {
    writeFileSync(file, original);
    await dropCopies().catch(() => {});
  }
  return results;
}
