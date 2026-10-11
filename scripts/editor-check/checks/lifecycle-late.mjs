// Saves answered late while the author works on another page (WP-11, spec
// §3.3; docs/editor-spikes/lifecycle.md S5 and change 3): a save that timed
// out and is answered while another page is being edited leaves that page,
// its address and its entry in site.json alone; Save never sends hax-body
// to a page that isn't the one on screen; and a late answer can't write
// over a newer save of its own page, even when another page was saved in
// between.
//
// Save requests are held by the check (request interception). The course
// site's page is written into the copy before each part; it, the lesson,
// the hub and site.json are put back at the end. Parts save the course site
// and the lesson (in the copy).
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

export default async function lifecycleLate(ctx) {
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
  const LESSON = slugOf(LESSON_ID);
  const fileOf = (id) => path.join(ctx.siteDir, "pages", id, "index.html");
  const file = fileOf(SITE_ID);
  const originals = { [siteJson]: readFileSync(siteJson, "utf8"), [file]: readFileSync(file, "utf8"), [fileOf(HUB_ID)]: readFileSync(fileOf(HUB_ID), "utf8"), [fileOf(LESSON_ID)]: readFileSync(fileOf(LESSON_ID), "utf8") };
  const putBack = (...paths) => paths.forEach((p) => writeFileSync(p, originals[p]));

  const handle = (fn, ...args) => page.evaluateHandle(fn, ...args);
  const bar = (selector) => handle((s) => __ec.theme().shadowRoot.querySelector("oer-edit-bar")?.shadowRoot?.querySelector(s) || null, selector);
  const status = () => page.evaluate(() => __ec.theme().shadowRoot.querySelector("oer-edit-bar")?.shadowRoot?.querySelector("[role=status]")?.textContent.trim() ?? null);
  const edit = async (url = SITE) => {
    if (await ctx.editMode()) await ctx.exitEdit({ discard: true });
    writeFileSync(file, PAGE);
    await ctx.open(url);
    await ctx.enterEdit();
    await ctx.waitFor(() => globalThis.OerEditor?.state.tracking, { what: "unsaved changes to be followed", timeout: 5000 });
    await ctx.sleep(300);
  };
  // another page of the site, as a link in the app goes there
  const goInApp = async (to, id) => {
    await page.evaluate((to) => {
      history.pushState(null, "", to);
      dispatchEvent(new PopStateEvent("popstate"));
    }, to);
    await ctx.waitFor((id) => __ec.store().activeItem?.id === id && __ec.theme()?.querySelector("page-break, p"), { what: `${to} in the app`, timeout: 15000, args: [id] });
    await ctx.settle();
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
  const savedTagline = () => readFileSync(file, "utf8").match(/<oer-cs-hero[^>]*>\s*<p[^>]*>(.*?)<\/p>/)?.[1] ?? null;
  // dropping every page's copy of unsaved edits (recovery.js)
  const dropCopies = () => page.evaluate(() => ["haxcms-pending-edit", "oer-pending-edits"].forEach((k) => sessionStorage.removeItem(k)));
  const couldntSave = () => ctx.waitFor(() => /Couldn't save/.test(__ec.theme().shadowRoot.querySelector("oer-edit-bar")?.shadowRoot?.querySelector("[role=status]")?.textContent || ""), { what: "Couldn't save", timeout: 30000 });
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
    /* ---------- a late answer while another page is being edited ---------- */

    await part("late answer elsewhere", async () => {
      reset();
      await dropCopies().catch(() => {});
      await edit();
      await typeTagline("Course site text from the save that hung");
      let held = null;
      const stop = await intercept((req) => {
        if (!held) held = req;
        else req.continue();
      });
      try {
        await ctx.clickAt(await ctx.control("Save"));
        await couldntSave();
        await ctx.exitEdit({ discard: true });
        await goInApp(LESSON, LESSON_ID);
        await enter();
        await typeInFirst("p", " LESSON EDIT.");
        await held.continue();
        await ctx.sleep(4000);
        const after = await page.evaluate((LESSON) => {
          const body = __ec.haxBody();
          const pb = body?.querySelector("page-break");
          return {
            at: location.pathname.replace(/\/$/, ""),
            lesson: location.pathname.replace(/\/$/, "") === LESSON,
            active: __ec.store().activeItem?.title,
            editing: !!body?.editMode,
            typed: !!body?.textContent.includes("LESSON EDIT"),
            pageBreak: pb?.getAttribute("title") ?? null,
            sections: !!__ec.theme().shadowRoot.querySelector("oer-edit-bar")?.shadowRoot?.querySelector('[data-id="sections"]'),
          };
        }, LESSON);
        await ctx.screenshot("late-elsewhere");
        check(
          "A save that timed out, answered while another page is edited: that page stays, at its address, with what was typed",
          after.lesson && after.active === "What is design?" && after.editing && after.typed && after.pageBreak === "What is design?" && !after.sections,
          json(after),
        );
        await ctx.press("Mod+Shift+KeyS");
        await ctx.waitForReading({ timeout: 30000 });
        await ctx.sleep(800);
        const lesson = itemOf(LESSON_ID);
        const atSite = manifest().items.filter((i) => i.slug === SITE.slice(1)).length;
        const saved = { slug: lesson.slug, title: lesson.title, pageType: lesson.metadata?.pageType, atSite, typed: readFileSync(fileOf(LESSON_ID), "utf8").includes("LESSON EDIT") };
        // (HAXcms makes the lesson's address again from its title as it saves: "what-is-design-")
        check(
          "…and saving it keeps its own entry in site.json (address, title, type) and its text",
          saved.slug.startsWith(LESSON.slice(1)) && saved.title === "What is design?" && saved.pageType === "oer:lesson" && atSite === 1 && saved.typed,
          json(saved),
        );
      } finally {
        await stop();
      }
    });

    await part("another page held", async () => {
      reset();
      await ctx.open(LESSON);
      await enter();
      await typeInFirst("p", " Typed in the lesson.");
      // hax-body holding another page than the one on screen (HAXcms saves it to the page its page-break names)
      await page.evaluate((id) => __ec.haxBody().querySelector("page-break").setAttribute("item-id", id), SITE_ID);
      let sent = 0;
      const onRequest = (req) => req.method() === "PATCH" && /\/x\/api\/v1\/content\//.test(req.url()) && sent++;
      page.on("request", onRequest);
      try {
        await ctx.press("Mod+Shift+KeyS");
        await ctx.sleep(1500);
      } finally {
        page.off("request", onRequest);
      }
      const held = { sent, editing: await ctx.editMode(), status: await status() };
      check("Save refuses to send a page that isn't the one on screen, and says so", !held.sent && held.editing && /^Couldn't save: The page shown isn't the one being edited/.test(held.status || ""), json(held));
      await page.evaluate((id) => __ec.haxBody().querySelector("page-break").setAttribute("item-id", id), LESSON_ID);
      await ctx.exitEdit({ discard: true });
    });

    await part("late answer after another page saved", async () => {
      reset();
      await dropCopies().catch(() => {});
      await edit();
      await typeTagline("First attempt");
      let first = null;
      const stop = await intercept((req) => {
        if (!first) first = req;
        else req.continue();
      });
      try {
        await ctx.clickAt(await ctx.control("Save"));
        await couldntSave();
        await typeTagline("Second attempt, the newer text");
        await ctx.clickAt(await bar('[data-id="retry"]'));
        await ctx.waitFor(() => !__ec.store().editMode, { what: "the reading view after Try again", timeout: 30000 });
        await ctx.sleep(500);
        const landed = savedTagline();
        // another page saved in between
        await goInApp(LESSON, LESSON_ID);
        await enter();
        await typeInFirst("p", " Lesson saved in between.");
        await ctx.press("Mod+Shift+KeyS");
        await ctx.waitForReading({ timeout: 30000 });
        await ctx.sleep(500);
        // the first try reaches the server now
        await first.continue();
        await ctx.sleep(9000);
        const end = { landed, saved: savedTagline(), lesson: readFileSync(fileOf(LESSON_ID), "utf8").includes("Lesson saved in between."), at: await page.evaluate(() => location.pathname.replace(/\/$/, "")) };
        check(
          "A try answered after Try again saved, with another page saved in between, leaves the newer text saved",
          end.landed === "Second attempt, the newer text" && end.saved === end.landed && end.lesson && end.at.startsWith(LESSON),
          json(end),
        );
      } finally {
        await stop();
      }
    });

  } finally {
    await page.setRequestInterception(false).catch(() => {});
    putBack(siteJson, file, fileOf(HUB_ID), fileOf(LESSON_ID));
    await dropCopies().catch(() => {});
  }
  return results;
}
