// Unsaved edits after a reload, page by page (WP-11, spec §3.3;
// docs/editor-spikes/lifecycle.md S6 and changes 6 and 19): a reload while
// "Saving…" keeps what was typed just before Save; each page keeps its own
// copy of unsaved edits, whatever is done on another; Not now keeps a copy
// through a save of other changes; Restore keeps the page's details as
// they're saved now (its title, whether it's published); and Style saved
// after a rename in Page details keeps the new title.
//
// Save requests are held by the check (request interception). The course
// site's page is written into the copy before each part; it, the lesson,
// the hub and site.json are put back at the end. Parts save the course site
// and the hub (in the copy).
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

export default async function lifecycleRecovery(ctx) {
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

  const siteJson = path.join(ctx.siteDir, "site.json");
  const manifest = () => JSON.parse(readFileSync(siteJson, "utf8"));
  const itemOf = (id) => manifest().items.find((i) => i.id === id);
  const items = manifest().items;
  const slugOf = (id) => `/${items.find((i) => i.id === id).slug}`;
  const SITE = slugOf(SITE_ID);
  const HUB = slugOf(HUB_ID);
  const LESSON = slugOf(LESSON_ID);
  const fileOf = (id) => path.join(ctx.siteDir, "pages", id, "index.html");
  const file = fileOf(SITE_ID);
  const originals = { [siteJson]: readFileSync(siteJson, "utf8"), [file]: readFileSync(file, "utf8"), [fileOf(HUB_ID)]: readFileSync(fileOf(HUB_ID), "utf8"), [fileOf(LESSON_ID)]: readFileSync(fileOf(LESSON_ID), "utf8") };
  const putBack = (...paths) => paths.forEach((p) => writeFileSync(p, originals[p]));

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
  // edit mode on the page shown, with its changes followed
  const enter = async () => {
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
  // text typed at the end of the page's first paragraph (the lesson, the hub's intro)
  const typeInFirst = async (selector, text) => {
    const p = await handle((s) => __ec.haxBody().querySelector(s), selector);
    await p.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await ctx.frames();
    await ctx.clickAt(p);
    await page.evaluate((s) => {
      const el = __ec.haxBody().querySelector(s);
      const last = el.lastChild;
      const sel = __ec.haxBody().getRootNode().getSelection?.() || getSelection();
      if (last) sel.collapse(last, last.nodeType === 3 ? last.length : last.childNodes.length);
      else sel.collapse(el, 0);
    }, selector);
    await ctx.type(text);
    await ctx.sleep(400);
  };
  const tagline = () => page.evaluate(() => (__ec.haxBody()?.editMode ? __ec.haxBody() : __ec.theme()).querySelector("oer-cs-hero > p")?.textContent ?? null);
  const savedTagline = () => readFileSync(file, "utf8").match(/<oer-cs-hero[^>]*>\s*<p[^>]*>(.*?)<\/p>/)?.[1] ?? null;
  // a page's copy of unsaved edits (recovery.js), and dropping them all
  const copy = (id = SITE_ID) => page.evaluate((id) => JSON.parse(sessionStorage.getItem("oer-pending-edits") || "{}")[id] ?? null, id);
  const dropCopies = () => page.evaluate(() => ["haxcms-pending-edit", "oer-pending-edits"].forEach((k) => sessionStorage.removeItem(k)));
  const chip = () => page.evaluate(() => [...(__ec.deep("oer-course-site")?.shadowRoot?.querySelectorAll("button") || [])].map((b) => b.textContent.replace(/\s+/g, " ").trim()).find((t) => /^Unsaved edits from/.test(t)) ?? null);
  // the save requests, held or let through by the check (request interception)
  const intercept = async (decide) => {
    const onRequest = (req) => {
      if (req.isInterceptResolutionHandled()) return;
      if (req.method() === "PATCH" && /\/x\/api\/v1\/content\//.test(req.url())) decide(req);
      else req.continue();
    };
    await page.setRequestInterception(true);
    page.on("request", onRequest);
    return async () => {
      page.off("request", onRequest);
      await page.setRequestInterception(false);
    };
  };
  // the course site, back as it was (an earlier part may have saved it)
  const reset = () => {
    putBack(siteJson, fileOf(HUB_ID), fileOf(LESSON_ID));
    writeFileSync(file, PAGE);
  };

  try {
    /* ---------- a reload while saving ---------- */

    await part("reload while saving", async () => {
      reset();
      await dropCopies().catch(() => {});
      await edit();
      const stop = await intercept(() => {});
      try {
        const p = await handle(() => __ec.haxBody().querySelector("oer-cs-hero > p"));
        await ctx.clickAt(p);
        await ctx.press("Mod+A");
        await ctx.type("Typed, saved at once, then reloaded");
        await ctx.press("Mod+Shift+KeyS");
        await ctx.sleep(1200);
        const during = await status();
        await page.reload({ waitUntil: "load" });
      } finally {
        await stop();
      }
      await ctx.open(SITE);
      const kept = await copy();
      check("A reload while ‘Saving…’ keeps what was typed just before Save", !!kept?.content?.includes("Typed, saved at once, then reloaded") && savedTagline() === OLD, (kept?.content || "none").slice(0, 80));
      await ctx.clickAt(await ctx.control("Edit content"));
      await ctx.waitFor(() => !!__ec.openDialog(), { what: "the restore question", timeout: 10000 });
      await ctx.clickAt(await ctx.control("Restore"));
      await ctx.sleep(800);
      check("…and Restore brings it back", (await tagline()) === "Typed, saved at once, then reloaded", await tagline());
      await ctx.exitEdit({ discard: true });
    });

    /* ---------- each page its own copy of unsaved edits ---------- */

    await part("copies per page", async () => {
      reset();
      await dropCopies().catch(() => {});
      await edit();
      await typeTagline("Course site edits kept across pages");
      await ctx.sleep(2600);
      await page.reload({ waitUntil: "load" });
      await ctx.open(SITE);
      const before = await chip();
      // another page: edits copied and discarded, then editing with no changes
      await ctx.open(LESSON);
      await enter();
      const asked = await dialog();
      await typeInFirst("p", " Lesson edits, discarded.");
      await ctx.sleep(2600);
      const lessonCopy = !!(await copy(LESSON_ID))?.content?.includes("Lesson edits, discarded.");
      await ctx.exitEdit({ discard: true });
      await enter();
      await ctx.clickAt(await ctx.control("Exit"));
      await ctx.waitForReading();
      await ctx.open(SITE);
      const after = { before, asked: asked?.title ?? null, lessonCopy, lessonAfter: await copy(LESSON_ID), chip: await chip(), copy: (await copy())?.content?.includes("Course site edits kept across pages") ?? false };
      check(
        "Editing another page (its own edits copied, then discarded; then Exit with no changes) keeps the course site's copy, and its bar still offers it",
        /^Unsaved edits from/.test(before || "") && !after.asked && after.lessonCopy && !after.lessonAfter && /^Unsaved edits from/.test(after.chip || "") && after.copy,
        json(after),
      );
      await ctx.clickAt(await ctx.control("Edit content"));
      await ctx.waitFor(() => !!__ec.openDialog(), { what: "the restore question", timeout: 10000 });
      await ctx.clickAt(await ctx.control("Restore"));
      await ctx.sleep(800);
      check("…so Restore brings the course site's edits back", (await tagline()) === "Course site edits kept across pages", await tagline());
      await ctx.exitEdit({ discard: true });
    });

    /* ---------- Not now, then other changes saved ---------- */

    await part("not now then save", async () => {
      reset();
      await dropCopies().catch(() => {});
      await edit();
      await typeTagline("Typed, then kept for later");
      await ctx.sleep(2600);
      await page.reload({ waitUntil: "load" });
      await ctx.open(SITE);
      await ctx.clickAt(await ctx.control("Edit content"));
      await ctx.waitFor(() => !!__ec.openDialog(), { what: "the restore question", timeout: 10000 });
      await ctx.clickAt(await ctx.control("Not now"));
      await ctx.sleep(400);
      await typeInFirst("oer-cs-people p", " A small fix.");
      await ctx.press("Mod+Shift+KeyS");
      await ctx.waitForReading({ timeout: 30000 });
      await ctx.sleep(800);
      const after = { saved: readFileSync(file, "utf8").includes("A small fix."), copy: (await copy())?.content?.includes("Typed, then kept for later") ?? false, chip: await chip() };
      await ctx.clickAt(await ctx.control("Edit content"));
      await ctx.waitFor(() => !!__ec.openDialog(), { what: "the restore question", timeout: 10000 }).catch(() => {});
      const asked = await page.evaluate(() => __ec.openDialog()?.textContent.replace(/\s+/g, " ").trim() ?? "");
      if (asked) await ctx.clickAt(await ctx.control("Restore"));
      await ctx.sleep(800);
      const end = { ...after, asked: /saved since/.test(asked), restored: await tagline() };
      check(
        "Not now, then other changes saved: the copy is kept, the bar still offers it, and next time it's offered saying the page has been saved since",
        end.saved && end.copy && /^Unsaved edits from/.test(end.chip || "") && end.asked && end.restored === "Typed, then kept for later",
        json(end),
      );
      await ctx.exitEdit({ discard: true });
      await dropCopies();
    });

    /* ---------- Style saved after a rename in Page details ---------- */

    await part("style after details", async () => {
      reset();
      await dropCopies().catch(() => {});
      const RENAMED = "DART 413 renamed in Page details";
      await edit();
      await typeTagline("Typed before Style and Page details");
      await ctx.clickAt(await bar('[data-id="style"]'));
      await ctx.waitFor(() => document.querySelector("oer-site-style")?.open, { what: "Style", timeout: 5000 });
      await ctx.clickAt(await bar('[data-id="details"]'));
      await ctx.waitFor(() => document.querySelector("oer-page-details")?.open, { what: "Page details", timeout: 5000 });
      await page.evaluate(async (title) => {
        const d = document.querySelector("oer-page-details");
        d._title = title;
        await d._save();
      }, RENAMED);
      await ctx.waitFor(() => !document.querySelector("oer-page-details")?.open, { what: "Page details to close", timeout: 15000 });
      await ctx.sleep(1500);
      const renamed = itemOf(SITE_ID).title;
      const before = itemOf(SITE_ID).metadata?.oerSiteStyle?.scheme || "studio";
      const swatch = await handle(() => [...document.querySelector("oer-site-style").shadowRoot.querySelectorAll('.swatches [role="radio"]')].find((r) => r.getAttribute("aria-checked") !== "true"));
      const scheme = await swatch.evaluate((r) => r.dataset.id);
      await ctx.clickAt(swatch);
      await ctx.clickAt(await handle(() => [...document.querySelector("oer-site-style").shadowRoot.querySelectorAll("footer button")].find((b) => b.textContent.trim() === "Save style")));
      await ctx.waitFor(() => !document.querySelector("oer-site-style")?.open, { what: "Style to close", timeout: 20000 });
      await ctx.sleep(1500);
      const styled = { title: itemOf(SITE_ID).title, scheme: itemOf(SITE_ID).metadata?.oerSiteStyle?.scheme };
      await ctx.press("Mod+Shift+KeyS");
      await ctx.waitForReading({ timeout: 30000 });
      await ctx.sleep(800);
      const end = { renamed, before, chose: scheme, styled, saved: itemOf(SITE_ID).title, text: savedTagline() };
      check(
        "Style saved after a rename in Page details (both opened while editing) keeps the new title, and so does the page's Save",
        end.renamed === RENAMED && end.styled.title === RENAMED && end.styled.scheme === scheme && scheme !== before && end.saved === RENAMED && end.text === "Typed before Style and Page details",
        json(end),
      );
    });

    /* ---------- a copy made to the page as it was saved before ---------- */

    await part("saved since", async () => {
      reset();
      await dropCopies().catch(() => {});
      await edit();
      await typeTagline("Typed before the page was saved again");
      await ctx.sleep(2600);
      // the page saved since (as a save that got no answer still can be)
      writeFileSync(file, PAGE.replace(OLD, "Saved since the copy was made"));
      await page.reload({ waitUntil: "load" });
      await ctx.open(SITE);
      const before = { chip: await chip(), shown: await tagline() };
      await ctx.clickAt(await ctx.control("Edit content"));
      await ctx.waitFor(() => !!__ec.openDialog(), { what: "the restore question", timeout: 10000 });
      const asked = await page.evaluate(() => __ec.openDialog().textContent.replace(/\s+/g, " ").trim());
      await ctx.clickAt(await ctx.control("Restore"));
      await ctx.sleep(800);
      const after = { ...before, asked: /saved since/.test(asked), restored: await tagline() };
      check(
        "A copy of edits to the page as it was saved before is still offered, saying the page has been saved since, and Restore brings the edits back",
        /^Unsaved edits from/.test(before.chip || "") && before.shown === "Saved since the copy was made" && after.asked && after.restored === "Typed before the page was saved again",
        json(after),
      );
      await ctx.exitEdit({ discard: true });
    });

    /* ---------- Restore keeps the page's details as saved now ---------- */

    await part("restore and page details", async () => {
      reset();
      await dropCopies().catch(() => {});
      const RENAMED = "DART 413: Digital Fabrication Studio (renamed)";
      await edit();
      await typeTagline("Typed before the rename");
      await ctx.clickAt(await bar('[data-id="details"]'));
      await ctx.waitFor(() => document.querySelector("oer-page-details")?.open, { what: "Page details", timeout: 5000 });
      await page.evaluate(async (title) => {
        const d = document.querySelector("oer-page-details");
        d._title = title;
        await d._save();
      }, RENAMED);
      await ctx.waitFor(() => !document.querySelector("oer-page-details")?.open, { what: "Page details to close", timeout: 15000 });
      await ctx.sleep(1500);
      const renamed = itemOf(SITE_ID).title;
      await typeTagline("Typed after the rename");
      await ctx.sleep(2600);
      await page.reload({ waitUntil: "load" });
      await ctx.open(SITE);
      await ctx.clickAt(await ctx.control("Edit content"));
      await ctx.waitFor(() => !!__ec.openDialog(), { what: "the restore question", timeout: 10000 });
      await ctx.clickAt(await ctx.control("Restore"));
      await ctx.sleep(800);
      const restored = await tagline();
      await ctx.press("Mod+Shift+KeyS");
      await ctx.waitForReading({ timeout: 30000 });
      await ctx.sleep(800);
      const title = { renamed, restored, saved: itemOf(SITE_ID).title, text: savedTagline() };
      check("Restore after a rename in Page details, then Save, keeps the new title", title.renamed === RENAMED && title.restored === "Typed after the rename" && title.saved === RENAMED && title.text === "Typed after the rename", json(title));

      // the hub: typed, reloaded, unpublished from its page menu, then restored and saved
      putBack(siteJson);
      await ctx.open(HUB);
      await enter();
      await typeInFirst("oer-courses-intro p", "Hub intro typed before a reload");
      await ctx.sleep(2600);
      await page.reload({ waitUntil: "load" });
      await ctx.open(HUB);
      await ctx.clickAt(await ctx.control("Page options"));
      await ctx.sleep(300);
      await ctx.clickAt(await ctx.control("Unpublish"));
      for (let i = 0; i < 100 && itemOf(HUB_ID).metadata?.published !== false; i++) await ctx.sleep(100);
      await ctx.sleep(1500);
      const unpublished = itemOf(HUB_ID).metadata?.published;
      await ctx.clickAt(await ctx.control("Edit content"));
      await ctx.waitFor(() => !!__ec.openDialog(), { what: "the restore question", timeout: 10000 });
      await ctx.clickAt(await ctx.control("Restore"));
      await ctx.sleep(800);
      await ctx.press("Mod+Shift+KeyS");
      await ctx.waitForReading({ timeout: 30000 });
      await ctx.sleep(800);
      const hub = { unpublished, saved: itemOf(HUB_ID).metadata?.published, text: readFileSync(fileOf(HUB_ID), "utf8").includes("Hub intro typed before a reload") };
      check("Restore after the page was unpublished, then Save, leaves it unpublished", hub.unpublished === false && hub.saved === false && hub.text, json(hub));
    });
  } finally {
    await page.setRequestInterception(false).catch(() => {});
    putBack(siteJson, file, fileOf(HUB_ID), fileOf(LESSON_ID));
    await dropCopies().catch(() => {});
  }
  return results;
}
