// What the WP-08 review found in the course-site sections, each checked
// on the copy (the rest of WP-08's acceptance is sections.mjs): Page
// details opened from a callout gives focus back as it closes, and saving
// it while editing keeps what was typed (HAX's imports held, the page's
// details current when the page saves); lists written with paragraphs in
// their rows become one-line items; Tab goes through the content and the
// controls the sections draw, and in an answer's list puts an item under
// the one before; the hero's image field by keyboard; questions (a lone
// heading, one without words, stray blocks made questions); the hub (a
// tagline's line break, no course site on); and, without a browser, the
// conversions, the API client's tokenless sign-in and the migration's
// guards.
//
// Fixtures are written into the copy's pages and put back at the end, and
// pages' details changed here (through Page details or the API) are put
// back too. Parts save the course site.
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync } from "node:fs";
import { execFile } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { JSDOM } from "jsdom";
import { connect } from "../../lib/hax-api.mjs";
import { SITE_ID, HUB_ID, SCRIPT, FULL_PAGE } from "./sections.mjs";

export default async function sectionsReview(ctx) {
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
  const refIds = (v) => (Array.isArray(v) ? v : v ? [v] : []).map((r) => (typeof r === "string" ? r : r?.page)).filter(Boolean);
  const course = byId.get(refIds(byId.get(SITE_ID).metadata.oerFields.course)[0]);

  // pages whose details a part changed (through Page details or the API),
  // put back as they were in the copy
  const touched = new Set();
  const restore = async () => {
    if (!touched.size) return;
    const conn = await connect({ base: `http://localhost:${ctx.port}`, password: "", tokenless: true });
    const back = items.filter((i) => touched.has(i.id)).map((i) => ({ ...i, modified: true }));
    const res = await conn.call("PATCH", "/x/api/v1/site/outline", { headers: conn.headers, body: { site: { name: "learning-materials" }, items: back } });
    if (!res.ok) throw new Error(`Couldn't put back ${back.length} page(s)' details (${res.status})`);
    touched.clear();
  };

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
  // a button in a section's shadow DOM, by its words
  // (reading: the theme's copy of the page, not hax-body's)
  const sectionButton = (tag, words, { reading = false } = {}) =>
    handle(
      (tag, words, reading) => [...((!reading && __ec.haxBody()?.querySelector(tag)) || __ec.theme().querySelector(tag)).shadowRoot.querySelectorAll("button")].find((b) => b.textContent.replace(/\s+/g, " ").trim() === words) || null,
      tag,
      words,
      reading,
    );
  const runScript = (args) =>
    new Promise((resolve) => {
      // the copy's server, which hands out its own token: no password
      const env = { ...process.env, HAX_BASE: `http://localhost:${ctx.port}`, SITE_DIR: `${ctx.siteDir}/`, HAX_TOKENLESS: "1" };
      delete env.HAX_PASSWORD;
      execFile(process.execPath, [SCRIPT, ...args], { env, timeout: 120000 }, (error, stdout, stderr) => resolve({ code: error ? (error.code ?? 1) : 0, out: `${stdout}${stderr}`.trim() }));
    });

  try {
    /* ---------- Page details from a callout: focus back, and what was typed kept ---------- */

    await part("focus back", async () => {
      // the course has no instructors: Who teaches it offers Add instructors
      write(SITE_ID, FULL_PAGE);
      await ctx.open(SITE);
      const opener = async (words) => {
        await ctx.clickAt(await sectionButton("oer-cs-people", words, { reading: !(await ctx.editMode()) }));
        await ctx.waitFor(() => document.querySelector("oer-page-details")?.open, { what: "Page details", timeout: 5000 });
        await ctx.sleep(300);
      };
      await opener("Add instructors");
      await ctx.press("Escape");
      await ctx.sleep(300);
      const reading = await ctx.deepActiveElement();
      await ctx.enterEdit();
      await opener("Add instructors");
      await ctx.clickAt(await handle(() => [...document.querySelector("oer-page-details").shadowRoot.querySelectorAll("button")].find((b) => b.textContent.trim() === "Cancel")));
      await ctx.sleep(300);
      const editing = await ctx.deepActiveElement();
      check(
        "Page details opened from a callout gives focus back to its button as it closes, reading (Esc) and editing (Cancel)",
        reading?.name === "Add instructors" && reading.path.endsWith("oer-cs-people › button") && editing?.name === "Add instructors" && editing.path.endsWith("oer-cs-people › button"),
        json({ reading, editing }),
      );
      await ctx.exitEdit({ discard: true });
    });

    await part("mid-edit details", async () => {
      await edit(SITE, SITE_ID, FULL_PAGE);
      touched.add(course.id).add(SITE_ID);
      await clickField(await handle(() => __ec.haxBody().querySelector("oer-cs-hero > p")));
      await ctx.press("End");
      await ctx.type(" TYPED-BEFORE");
      await ctx.sleep(400);
      await page.evaluate(() => {
        for (const el of __ec.haxBody().children) el.__reviewMark = true;
        globalThis.__steps = __ec.haxBody().undoStack.commands.length;
      });
      const outlineSaved = () =>
        ctx.waitFor(() => !document.querySelector("oer-page-details")?.open && __ec.store().manifest !== globalThis.__manifest, { what: "Page details saved and the manifest reloaded", timeout: 20000 });
      await ctx.clickAt(await sectionButton("oer-cs-people", "Add instructors"));
      await ctx.waitFor(() => document.querySelector("oer-page-details")?.open, { what: "Page details", timeout: 5000 });
      await ctx.sleep(300);
      await ctx.type("Ada Lovelace");
      await page.evaluate(() => (globalThis.__manifest = __ec.store().manifest));
      await ctx.clickAt(await handle(() => [...document.querySelector("oer-page-details").shadowRoot.querySelectorAll("button")].find((b) => b.textContent.trim() === "Save details")));
      await outlineSaved();
      // (HAX reloads the page after the save, a few seconds)
      await ctx.sleep(4000);
      const after = await page.evaluate(() => {
        const b = __ec.haxBody();
        return {
          editing: !!__ec.store().editMode,
          tagline: b.querySelector("oer-cs-hero > p")?.textContent,
          same: [...b.children].every((el) => el.__reviewMark),
          dirty: OerEditor.state.dirty,
          steps: b.undoStack.commands.length - globalThis.__steps,
          people: b.querySelector("oer-cs-people").shadowRoot.textContent.includes("Ada Lovelace"),
          unit: OerEditor.state.unit?.localName ?? null,
          focus: __ec.describe(__ec.activeElement()),
        };
      });
      check(
        "Saving Page details from a callout while editing keeps what was typed: still editing, the same elements, unsaved changes, no undo step",
        after.editing && after.tagline?.endsWith(" TYPED-BEFORE") && after.same && after.dirty && after.steps === 0,
        json(after),
      );
      check("…the section shows what was saved (the instructor), and focus is on the section, its callout gone", after.people && after.unit === "oer-cs-people" && after.focus?.tag === "hax-body", json({ people: after.people, unit: after.unit, focus: after.focus }));
      // the course site's description changed in Page details mid-edit, then the page saved
      const described = `Described mid-edit ${Date.now()}`;
      await page.evaluate(
        async (id, text) => {
          const d = document.querySelector("oer-page-details");
          d.show(id, { section: "general" });
          await d.updateComplete;
          d._desc = text;
          globalThis.__manifest = __ec.store().manifest;
          await d._save();
        },
        SITE_ID,
        described,
      );
      await outlineSaved();
      await ctx.sleep(4000);
      const typedStill = await page.evaluate(() => __ec.haxBody().querySelector("oer-cs-hero > p")?.textContent);
      await ctx.save();
      const site = siteJson().find((i) => i.id === SITE_ID);
      const courseNow = siteJson().find((i) => i.id === course.id);
      const saved = ctx.savedHtml(SITE_ID);
      check(
        "…and a page save after that keeps the description saved mid-edit, the instructor and what was typed",
        typedStill?.endsWith(" TYPED-BEFORE") && site.description === described && json(courseNow.metadata.oerFields.instructors || []).includes("Ada Lovelace") && saved.includes("make it real. TYPED-BEFORE</p>"),
        json({ typedStill, description: site.description, instructors: courseNow.metadata.oerFields.instructors, saved: saved.slice(0, 120) }),
      );
      await restore();
    });

    /* ---------- lists written before items, with paragraphs in their rows ---------- */

    await part("legacy rows", async () => {
      const LEGACY = `<oer-cs-hero><p>Make it real.</p></oer-cs-hero>
<oer-cs-learn><ul><li><p><b>Cut</b>: plan parts</p></li></ul></oer-cs-learn>
<oer-cs-tools><ul><li><p>Epilog laser cutter</p></li><li><p>Fusion 360</p></li></ul><oer-cs-tool><p>CNC</p><p>router</p></oer-cs-tool></oer-cs-tools>
<oer-cs-closing></oer-cs-closing>
`;
      write(SITE_ID, LEGACY);
      const dry = await runScript([]);
      check(
        "The migration makes a row holding a paragraph one line of its item (no paragraph in a paragraph or a heading)",
        dry.out.includes("<oer-cs-tool><p>Epilog laser cutter</p></oer-cs-tool><oer-cs-tool><p>Fusion 360</p></oer-cs-tool>") && dry.out.includes("<oer-cs-outcome><h3>Cut</h3><p>Plan parts</p></oer-cs-outcome>") && !/<(p|h3)><p>/.test(dry.out),
        dry.out.split("\n").filter((l) => /oer-cs-(tools|learn)/.test(l)).join(" | "),
      );
      await edit(SITE, null, null);
      const editing = await page.evaluate(() => ({
        tools: __ec.normalize(__ec.haxBody().querySelector("oer-cs-tools").innerHTML),
        learn: __ec.normalize(__ec.haxBody().querySelector("oer-cs-learn").innerHTML),
        dirty: OerEditor.state.dirty,
      }));
      check(
        "…and so does editing: each tool one paragraph (a second one joined to it), an outcome its title and sentence, with no change as editing begins",
        editing.tools === "<h2></h2><oer-cs-tool><p>Epilog laser cutter</p></oer-cs-tool><oer-cs-tool><p>Fusion 360</p></oer-cs-tool><oer-cs-tool><p>CNC router</p></oer-cs-tool>" && editing.learn === "<h2></h2><oer-cs-outcome><h3>Cut</h3><p>Plan parts</p></oer-cs-outcome>" && !editing.dirty,
        json(editing),
      );
      await clickField(await handle(() => __ec.haxBody().querySelector("oer-cs-hero > p")));
      await ctx.press("End");
      await ctx.type("!");
      await ctx.sleep(300);
      await ctx.save();
      await ctx.open(SITE, { signedOut: true });
      const chips = await page.evaluate(() => [...__ec.theme().querySelector("oer-cs-tools").querySelectorAll("oer-cs-tool")].map((t) => ({ text: t.textContent.trim(), height: Math.round(t.getBoundingClientRect().height) })));
      check("…and readers of the saved page see every tool's words", json(chips.map((c) => c.text)) === json(["Epilog laser cutter", "Fusion 360", "CNC router"]) && chips.every((c) => c.height > 20), json(chips));
      // a tool with a second paragraph (from Edit HTML), never upgraded: readers see both
      write(SITE_ID, `<oer-cs-hero><p>Make it real.</p></oer-cs-hero>\n<oer-cs-tools><oer-cs-tool><p>CNC</p><p>router</p></oer-cs-tool></oer-cs-tools>\n`);
      await ctx.open(SITE, { signedOut: true });
      const shown = await page.evaluate(() => [...__ec.theme().querySelector("oer-cs-tool").children].map((p) => __ec.visible(p)));
      check("A tool holding a second paragraph shows readers both", json(shown) === json([true, true]), json(shown));
    });

    /* ---------- Tab through the content, its controls and an answer's list ---------- */

    await part("tab", async () => {
      await edit(SITE, SITE_ID, FULL_PAGE);
      await clickField(await handle(() => __ec.haxBody().querySelector("oer-cs-hero > p")));
      // where Tab left the caret (its field) or focus (a control in the content, or out of it)
      const where = () =>
        page.evaluate(() => {
          const a = __ec.activeElement();
          if (a?.localName === "hax-body") {
            const sel = a.getRootNode().getSelection();
            const n = sel.anchorNode;
            const el = n?.nodeType === 1 ? n : n?.parentElement;
            const f = el?.closest("h1, h2, h3, p, li");
            return f ? `${f.closest("oer-cs-outcome, oer-cs-tool, oer-cs-question")?.localName || f.parentElement.localName} ${f.localName}: ${f.firstChild?.textContent.trim().slice(0, 40) ?? ""}` : "hax-body";
          }
          let inContent = false;
          for (let n = a; n && !inContent; n = n.getRootNode().host) inContent = !!n.closest?.("hax-body");
          return `${inContent ? "control" : "out"}: ${a ? __ec.name(a) || a.localName : "nothing"}`;
        });
      const walk = [await where()];
      for (let i = 0; i < 45 && !walk.at(-1).startsWith("out:"); i++) {
        await ctx.press("Tab");
        await ctx.sleep(60);
        walk.push(await where());
      }
      const at = (s) => walk.findIndex((w) => w === s);
      const controls = ["control: Change image", "control: Add an outcome", "control: Add instructors", "control: Add a tool", "control: Add a question"].map(at);
      check("Tab from field to field reaches each control the sections draw, in order (Change image, Add an outcome, Add instructors, Add a tool, Add a question), then leaves the content", controls.every((n, i) => n > 0 && (!i || n > controls[i - 1])) && walk.at(-1).startsWith("out:"), walk.join(" → "));
      const li = at("oer-cs-question li: Bring closed shoes.");
      const faq = await page.evaluate(() => __ec.normalize(__ec.haxBody().querySelector("oer-cs-faq").innerHTML));
      check("…passing the first item of an answer's list (which has none to go under) on to the next question", li > 0 && walk[li + 1] === "oer-cs-question h3: Is it online?" && !/<ul>\s*<ul>/.test(faq), `${walk.slice(li - 1, li + 3).join(" → ")}; ${faq.slice(0, 200)}`);
      // back from a control to a field, and on from a control into a field
      await page.evaluate(() => [...__ec.haxBody().querySelector("oer-cs-tools").shadowRoot.querySelectorAll("button")].find((b) => b.textContent.includes("Add a tool")).focus());
      await ctx.press("Shift+Tab");
      await ctx.sleep(100);
      const back = await where();
      await page.evaluate(() => __ec.haxBody().querySelector("oer-cs-hero").shadowRoot.querySelector(".change-image").focus());
      await ctx.press("Tab");
      await ctx.sleep(100);
      const on = await where();
      check("Shift+Tab from Add a tool puts the caret in the last tool, and Tab from Change image in the next section's heading", back === "oer-cs-tool p: Fusion 360" && on === "oer-cs-learn h2: What you'll be able to do", json({ back, on }));

      // an answer's second item goes under the first, and back out
      await edit(SITE, SITE_ID, FULL_PAGE.replace("<ul><li>Bring closed shoes.</li></ul>", "<ul><li>Bring closed shoes.</li><li>Tie back long hair.</li></ul>"));
      await clickField(await handle(() => __ec.haxBody().querySelectorAll("oer-cs-question li")[1]));
      await ctx.press("Tab");
      await ctx.sleep(200);
      const listOf = () => page.evaluate(() => __ec.normalize(__ec.haxBody().querySelector("oer-cs-question ul").outerHTML));
      const nested = { html: await listOf(), at: await where() };
      await ctx.press("Shift+Tab");
      await ctx.sleep(200);
      const out = { html: await listOf(), at: await where() };
      await ctx.press("Shift+Tab");
      await ctx.sleep(200);
      const before = await where();
      check(
        "Tab in an answer's second list item puts it under the first, Shift+Tab takes it back out, and Shift+Tab again goes to the item before",
        nested.html === "<ul><li>Bring closed shoes.<ul><li>Tie back long hair.</li></ul></li></ul>" && nested.at === "oer-cs-question li: Tie back long hair." && out.html === "<ul><li>Bring closed shoes.</li><li>Tie back long hair.</li></ul>" && out.at === "oer-cs-question li: Tie back long hair." && before === "oer-cs-question li: Bring closed shoes.",
        json({ nested, out, before }),
      );
      await ctx.exitEdit({ discard: true });
    });

    /* ---------- the hero's image field, by keyboard ---------- */

    await part("image field", async () => {
      await edit(SITE, SITE_ID, FULL_PAGE);
      await ctx.clickAt(await sectionButton("oer-cs-hero", "Change image"));
      await ctx.sleep(300);
      const opened = await ctx.deepActiveElement();
      await ctx.press("Escape");
      await ctx.sleep(300);
      const closed = await page.evaluate(() => ({ open: !!__ec.haxBody().querySelector("oer-cs-hero").shadowRoot.querySelector("oer-image-field"), focus: __ec.describe(__ec.activeElement()) }));
      check("Change image opens the image field with focus in it, and Esc closes it with focus back on Change image", opened?.path.includes("oer-image-field") && !closed.open && closed.focus?.name === "Change image", json({ opened, closed }));
      await ctx.press("Enter");
      await ctx.sleep(300);
      await ctx.clickAt(await handle(() => [...__ec.haxBody().querySelector("oer-cs-hero").shadowRoot.querySelector("oer-image-field").shadowRoot.querySelectorAll("button")].find((b) => b.textContent.trim() === "Use an address")));
      await ctx.sleep(200);
      await ctx.clickAt(await handle(() => __ec.haxBody().querySelector("oer-cs-hero").shadowRoot.querySelector("oer-image-field").shadowRoot.querySelector('input[aria-label="Hero image address"]')));
      await ctx.type("files/1500.jpg");
      await ctx.press("Enter");
      await ctx.sleep(400);
      const set = await page.evaluate(() => ({ image: __ec.haxBody().querySelector("oer-cs-hero").getAttribute("image"), focus: __ec.describe(__ec.activeElement()), label: __ec.activeElement()?.closest?.("label")?.querySelector(".alt-label")?.textContent }));
      check("An address typed and Enter: the hero has it, and focus goes on to its description", set.image === "files/1500.jpg" && set.focus?.tag === "input" && set.label === "Description (alt text)", json(set));
      await ctx.exitEdit({ discard: true });
    });

    /* ---------- the questions: a lone heading, a question without words, stray blocks ---------- */

    await part("questions", async () => {
      write(SITE_ID, `<oer-cs-hero><p>Make it real.</p></oer-cs-hero>\n<oer-cs-faq><h2>Got questions?</h2></oer-cs-faq>\n<oer-cs-closing></oer-cs-closing>\n`);
      await ctx.open(SITE, { signedOut: true });
      const lone = await page.evaluate(() => {
        const faq = __ec.theme().querySelector("oer-cs-faq");
        return { rows: faq.shadowRoot.querySelectorAll("details, summary").length + faq.querySelectorAll("oer-cs-question").length, text: faq.shadowRoot.textContent.replace(/\s+/g, " ").trim() };
      });
      await edit(SITE, null, null);
      const loneEditing = await page.evaluate(() => __ec.normalize(__ec.haxBody().querySelector("oer-cs-faq").innerHTML));
      check(
        "Questions whose heading asks something, with no questions saved: the heading stays its heading (no question row for readers, and no question made of it while editing)",
        lone.rows === 0 && loneEditing === "<h2>Got questions?</h2>",
        json({ lone, loneEditing }),
      );
      await ctx.exitEdit({ discard: true });
      write(SITE_ID, `<oer-cs-hero><p>Make it real.</p></oer-cs-hero>\n<oer-cs-faq><oer-cs-question><h3></h3><p>The studio has computers.</p></oer-cs-question><oer-cs-question><h3>Is it online?</h3><p>No.</p></oer-cs-question></oer-cs-faq>\n`);
      await ctx.open(SITE, { signedOut: true });
      const rows = await page.evaluate(() => __ec.theme().querySelector("oer-cs-faq").shadowRoot.querySelector('slot[name="items"]').assignedElements().map((q) => q.textContent.trim()));
      const named = await ctx.axe({ context: { include: [["oer-cs-faq"]] } });
      check("A question without its words isn't shown to readers (no accordion row without a name)", json(rows) === json(["Is it online?No."]) && !named.rules?.some((r) => r.id === "summary-name"), `${json(rows)}; ${named.rules?.map((r) => r.id).join(", ") || "no axe violations"}`);
      // a question and its answer left in the section, made questions
      await edit(SITE, SITE_ID, FULL_PAGE);
      await page.evaluate(() => __ec.haxBody().querySelector("oer-cs-faq").insertAdjacentHTML("beforeend", "<h3>Can I work remotely?</h3><p>Yes, after week 4.</p>"));
      await ctx.sleep(300);
      await ctx.clickAt(await sectionButton("oer-cs-faq", "Make them questions"));
      await ctx.waitFor(() => __ec.haxBody().querySelectorAll("oer-cs-question").length === 3, { what: "the stray blocks made questions", timeout: 5000 });
      await ctx.sleep(300);
      const made = await page.evaluate(() => [...__ec.haxBody().querySelectorAll("oer-cs-question")].map((q) => __ec.normalize(q.innerHTML)));
      check("Make them questions makes a question and its answer one question", made[2] === "<h3>Can I work remotely?</h3><p>Yes, after week 4.</p>", json(made));
      await ctx.exitEdit({ discard: true });
    });

    /* ---------- the hub: a tagline's line break, and no course site on ---------- */

    await part("hub review", async () => {
      write(SITE_ID, FULL_PAGE.replace("<p>Design it on screen, then make it real.</p>", "<p>Design it on screen, then make it real.<br>Second line.</p>"));
      await ctx.open(HUB, { signedOut: true });
      const card = await ctx.waitFor(
        (slug) => {
          const c = [...(__ec.theme().querySelector("oer-courses-catalog")?.shadowRoot?.querySelectorAll(".card") || [])].find((c) => c.querySelector(`a[href="${slug}"]`));
          return c && c.textContent.includes("Second line") ? c.textContent.replace(/\s+/g, " ").trim() : null;
        },
        { args: [SITE.slice(1)], what: "the course site's card with its tagline", timeout: 10000 },
      );
      check("The hub's card reads a tagline's line break as a space", card.includes("make it real. Second line."), card);
      // every course site off
      const on = siteJson().filter((i) => i.metadata?.pageType === "oer:course-site" && !i.metadata?.oerSnapshotOf && i.metadata?.published !== false);
      for (const s of on) touched.add(s.id);
      const conn = await connect({ base: `http://localhost:${ctx.port}`, password: "", tokenless: true });
      const res = await conn.call("PATCH", "/x/api/v1/site/outline", { headers: conn.headers, body: { site: { name: "learning-materials" }, items: on.map((s) => ({ ...s, metadata: { ...s.metadata, published: false }, modified: true })) } });
      if (!res.ok) throw new Error(`Couldn't turn the course sites off (${res.status})`);
      await edit(HUB, null, null);
      const off = await page.evaluate(() => {
        const s = __ec.haxBody().querySelector("oer-courses-catalog").shadowRoot;
        return { source: s.querySelectorAll(".source").length, buttons: [...s.querySelectorAll(".source button")].map((b) => b.textContent.trim()), todo: s.querySelectorAll(".todo").length, text: s.querySelector(".source-text")?.textContent };
      });
      await page.evaluate(() => (globalThis.open = (url) => (globalThis.__opened = url)));
      if (off.buttons.length === 1) await ctx.clickAt(await sectionButton("oer-courses-catalog", off.buttons[0]));
      const opened = await page.evaluate(() => globalThis.__opened || null);
      const target = on.length === 1 ? siteJson().find((i) => i.id === refIds(on[0].metadata.oerFields.course)[0]) : siteJson().find((i) => !i.parent && i.title === "Courses");
      check(
        "With no course site on, the hub's catalog says so in one callout with one button (and no second note), which opens where a site is turned on",
        off.source === 1 && off.buttons.length === 1 && off.todo === 0 && !!opened && !!target && opened.endsWith(`/${target.slug}`),
        json({ ...off, opened, target: target?.slug }),
      );
      await ctx.exitEdit({ discard: true });
      await restore();
    });

    /* ---------- the conversions, the API client and the migration's guards (no browser) ---------- */

    await part("scripts", async () => {
      const normalize = await import(pathToFileURL(path.join(ctx.siteDir, "custom/src/blocks/course-site/cs-normalize.js")).href);
      const dom = new JSDOM("");
      globalThis.NodeFilter ??= dom.window.NodeFilter;
      const run = (tag, html) => {
        const el = dom.window.document.createElement(tag);
        el.innerHTML = html;
        normalize.ITEMS_FROM[tag](el);
        return el.innerHTML;
      };
      const cases = {
        lone: run("oer-cs-faq", "<h2>Got questions?</h2>"),
        answered: run("oer-cs-faq", "<h2>Do I need a laptop?</h2><p>No.</p>"),
        gap: run("oer-cs-faq", "<h2>Questions</h2><h3>Do I need a laptop?</h3><p>No.</p><h3></h3><p>The studio has computers.</p>"),
        starter: run("oer-cs-faq", "<h3></h3><p></p>"),
      };
      check(
        "Upgrading questions: a lone h2 asking something stays the heading; an h2 with its answer is a question; an empty heading after a question is read past; the starter's empty question stays",
        cases.lone === "<h2>Got questions?</h2>" &&
          cases.answered === "<oer-cs-question><h3>Do I need a laptop?</h3><p>No.</p></oer-cs-question>" &&
          cases.gap === "<h2>Questions</h2><oer-cs-question><h3>Do I need a laptop?</h3><p>No.</p><p>The studio has computers.</p></oer-cs-question>" &&
          cases.starter === "<oer-cs-question><h3></h3><p></p></oer-cs-question>",
        json(cases),
      );
      // no password: refused for the dev server's address, before any request
      const refused = await connect({ base: "http://localhost", password: "", tokenless: true }).then(
        () => "connected",
        (e) => e.message,
      );
      const plain = await connect({ base: `http://localhost:${ctx.port}`, password: "" }).then(
        () => "connected",
        (e) => e.message,
      );
      check("connect() with no password takes a server's own token only when asked (HAX_TOKENLESS) and never for the dev server's address", refused === "Set HAX_PASSWORD (see .env.local)" && plain === "Set HAX_PASSWORD (see .env.local)", json({ refused, plain }));
      // the migration: SITE_DIR without HAX_BASE (a dry run, so nothing could be saved)
      const lonely = await new Promise((resolve) => {
        const env = { ...process.env, SITE_DIR: `${ctx.siteDir}/`, HAX_TOKENLESS: "1" };
        delete env.HAX_BASE;
        delete env.HAX_PASSWORD;
        execFile(process.execPath, [SCRIPT], { env, timeout: 60000 }, (error, stdout, stderr) => resolve({ code: error ? (error.code ?? 1) : 0, out: `${stdout}${stderr}` }));
      });
      // and --apply with SITE_DIR another copy than the server's
      const stale = path.join(ctx.workDir, `stale-${ctx.port}`);
      rmSync(stale, { recursive: true, force: true });
      mkdirSync(path.join(stale, "pages", SITE_ID), { recursive: true });
      mkdirSync(path.join(stale, "custom/src/blocks/course-site"), { recursive: true });
      cpSync(path.join(ctx.siteDir, "custom/src/blocks/course-site/cs-normalize.js"), path.join(stale, "custom/src/blocks/course-site/cs-normalize.js"));
      const json0 = JSON.parse(readFileSync(path.join(ctx.siteDir, "site.json"), "utf8"));
      json0.items.find((i) => i.id === SITE_ID).metadata.updated = 1;
      writeFileSync(path.join(stale, "site.json"), JSON.stringify(json0));
      writeFileSync(path.join(stale, "pages", SITE_ID, "index.html"), "<oer-cs-tools><ul><li>Laser cutter</li></ul></oer-cs-tools>\n");
      const served = readFileSync(fileOf(SITE_ID), "utf8");
      const other = await new Promise((resolve) => {
        const env = { ...process.env, SITE_DIR: `${stale}/`, HAX_BASE: `http://localhost:${ctx.port}`, HAX_TOKENLESS: "1" };
        delete env.HAX_PASSWORD;
        execFile(process.execPath, [SCRIPT, "--apply"], { env, timeout: 60000 }, (error, stdout, stderr) => resolve({ code: error ? (error.code ?? 1) : 0, out: `${stdout}${stderr}` }));
      });
      rmSync(stale, { recursive: true, force: true });
      check(
        "The migration won't run with SITE_DIR and not HAX_BASE, and --apply saves nothing when the server isn't serving SITE_DIR's pages",
        lonely.code !== 0 && lonely.out.includes("Set both HAX_BASE and SITE_DIR") && other.code !== 0 && other.out.includes("isn't serving SITE_DIR's pages") && readFileSync(fileOf(SITE_ID), "utf8") === served,
        `${lonely.out.split("\n").find((l) => /^Error:/.test(l)) || lonely.out.slice(0, 120)} | ${other.out.split("\n").find((l) => /^Error:/.test(l)) || other.out.slice(-160)}`,
      );
    });
  } finally {
    // the copy as it was, for the checks after this one
    if (await ctx.editMode().catch(() => false)) await ctx.exitEdit({ discard: true }).catch(() => {});
    write(SITE_ID, original[SITE_ID]);
    write(HUB_ID, original[HUB_ID]);
    await restore().catch((e) => ctx.log(e.message));
  }
  return results;
}
