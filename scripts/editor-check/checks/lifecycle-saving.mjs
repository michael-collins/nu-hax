// Saving at its edges (WP-11, spec §3.3; docs/editor-spikes/lifecycle.md
// S5 and changes 3 and 18): while the page saves nothing can change it (a
// change then would be dropped by the save); a save that timed out lets go
// of HAX's imports; its answer after Try again has saved can't leave the
// older text saved or shown; its answer arriving before Try again fails
// keeps editing with what was typed since, saying why; and when HAX's
// reload after a save is slower than 20 s, "Saving…" stays up for 20 s, so
// the old page never shows, and editing ends on the page as saved; so it
// does when the reload fails.
//
// Save requests are held or answered by the check (request interception).
// The course site's page is written into the copy before each part and put
// back at the end. Parts save the course site (in the copy).
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const SITE_ID = "item-0330a29b-7735-4ac0-afd2-e3b2a88d49e3";
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

export default async function lifecycleSaving(ctx) {
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
  // the save requests, held or answered by the check (request interception)
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

  try {
    /* ---------- while saving ---------- */

    await part("busy while saving", async () => {
      await dropCopies().catch(() => {});
      await edit();
      await typeTagline("Saved while busy");
      const order = () => page.evaluate(() => [...(__ec.haxBody()?.editMode ? __ec.haxBody() : __ec.theme()).children].map((el) => el.localName).filter((t) => /^oer-cs-(people|tools)$/.test(t)).join(" "));
      const before = await order();
      await ctx.clickAt(await ctx.control("Save"));
      await ctx.sleep(150);
      const during = await page.evaluate(async () => {
        const root = __ec.theme().shadowRoot.querySelector("oer-edit-bar").shadowRoot;
        const off = (id) => root.querySelector(`[data-id="${id}"]`)?.getAttribute("aria-disabled") ?? "none";
        const moved = await OerEditor.ops.move(__ec.haxBody().querySelector("oer-cs-tools"), -1);
        return { saving: OerEditor.state.saving, moved, undo: off("undo"), style: off("style"), details: off("details"), sections: off("sections") };
      });
      await ctx.press("Mod+KeyZ");
      await ctx.sleep(100);
      const text = await tagline();
      await ctx.waitFor(() => !__ec.store().editMode, { what: "the reading view", timeout: 30000 });
      await ctx.sleep(800);
      const after = { order: await order(), saved: savedTagline(), file: readFileSync(file, "utf8").indexOf("<oer-cs-people") < readFileSync(file, "utf8").indexOf("<oer-cs-tools") };
      check(
        "While the page saves, a change is refused and the bar's Undo, Style, Page details and Sections are off",
        during.saving && during.moved === false && ["undo", "style", "details", "sections"].every((id) => during[id] === "true"),
        json(during),
      );
      check("…Undo's keys change nothing on screen, and the page saved and shown is the one sent", text === "Saved while busy" && after.order === before && after.file && after.saved === "Saved while busy", json({ text, before, ...after }));
    });

    /* ---------- answers after the time ran out ---------- */

    await part("late answer after try again", async () => {
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
        await ctx.waitFor(() => /Couldn't save/.test(__ec.theme().shadowRoot.querySelector("oer-edit-bar")?.shadowRoot?.querySelector("[role=status]")?.textContent || ""), { what: "Couldn't save", timeout: 30000 });
        const timedOut = { status: await status(), held: await page.evaluate(() => Object.prototype.hasOwnProperty.call(__ec.haxBody(), "importContent")), editing: await ctx.editMode() };
        check("No answer in 20 s: editing goes on, HAX's imports aren't held any more, and the status says so", timedOut.editing && /No answer from the server/.test(timedOut.status) && !timedOut.held, json(timedOut));
        await typeTagline("Second attempt, the newer text");
        await ctx.clickAt(await bar('[data-id="retry"]'));
        await ctx.waitFor(() => !__ec.store().editMode, { what: "the reading view after Try again", timeout: 30000 });
        await ctx.sleep(500);
        const landed = savedTagline();
        // the first try reaches the server now, after the second
        await first.continue();
        await ctx.sleep(9000);
        const end = { landed, saved: savedTagline(), shown: await tagline(), editing: await ctx.editMode() };
        check("A try answered after Try again has saved leaves the newer text saved and shown", end.landed === "Second attempt, the newer text" && end.saved === end.landed && end.shown === end.landed && !end.editing, json(end));
      } finally {
        await stop();
      }
    });

    await part("late answer then a failure", async () => {
      await dropCopies().catch(() => {});
      await edit();
      await typeTagline("First text");
      const held = [];
      const stop = await intercept((req) => held.push(req));
      try {
        await ctx.clickAt(await ctx.control("Save"));
        await ctx.waitFor(() => /Couldn't save/.test(__ec.theme().shadowRoot.querySelector("oer-edit-bar")?.shadowRoot?.querySelector("[role=status]")?.textContent || ""), { what: "Couldn't save", timeout: 30000 });
        const p = await handle(() => __ec.haxBody().querySelector("oer-cs-hero > p"));
        await ctx.clickAt(p);
        await ctx.press("End");
        await ctx.type(" and more");
        await ctx.sleep(400);
        await ctx.clickAt(await bar('[data-id="retry"]'));
        for (let i = 0; i < 200 && held.length < 2; i++) await ctx.sleep(50);
        // the first try is answered (saved), then the second fails
        await held[0].continue();
        await ctx.sleep(3000);
        await held[1]?.respond({ status: 500, contentType: "application/json", body: "{}" });
        await ctx.sleep(1500);
        await ctx.waitFor(() => !OerEditor.state.saving, { what: "the second try's answer", timeout: 25000 });
        await ctx.sleep(2600);
        const end = { editing: await ctx.editMode(), text: await tagline(), status: await status(), dirty: await page.evaluate(() => OerEditor.state.dirty), saved: savedTagline(), copy: (await copy())?.content?.includes("First text and more") ?? false };
        check(
          "The first try answered late, then Try again failing: editing goes on with what was typed since, the status says why, and a copy is kept",
          end.editing && end.text === "First text and more" && /Couldn't save: 500/.test(end.status) && end.dirty && end.saved === "First text" && end.copy,
          json(end),
        );
      } finally {
        await stop();
      }
      await ctx.exitEdit({ discard: true });
      await dropCopies();
    });

    /* ---------- the caret, when a clicked button takes no focus ---------- */

    await part("caret kept", async () => {
      await dropCopies().catch(() => {});
      await edit();
      await typeTagline("Caret kept after a failed save");
      const placeCaret = (offset) =>
        page.evaluate((offset) => {
          const text = __ec.haxBody().querySelector("oer-cs-hero > p").firstChild;
          (__ec.haxBody().getRootNode().getSelection?.() || getSelection()).collapse(text, offset);
        }, offset);
      const caretAt = () =>
        page.evaluate(() => {
          let el = document.activeElement;
          while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
          const sel = __ec.haxBody().getRootNode().getSelection?.() || getSelection();
          return { focus: el?.localName ?? null, in: sel.anchorNode?.parentElement?.localName ?? null, offset: sel.anchorOffset, where: __ec.describe(el)?.path ?? null, name: el && el !== document.body ? __ec.name(el).slice(0, 40) : null };
        });
      // as in Safari and Firefox on macOS: a clicked button takes no focus, and focus leaves the content for <body>
      const noFocus = (on) =>
        page.evaluate((on) => {
          globalThis.__noFocus ??= (e) => {
            e.preventDefault();
            let el = document.activeElement;
            while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
            el?.blur();
          };
          (on ? addEventListener : removeEventListener)("mousedown", globalThis.__noFocus, true);
        }, on);
      await placeCaret(5);
      await noFocus(true);
      const stop = await intercept((req) => req.respond({ status: 500, contentType: "application/json", body: "{}" }));
      try {
        await ctx.clickAt(await bar('[data-id="save"]'));
        await ctx.waitFor(() => /Couldn't save/.test(__ec.theme().shadowRoot.querySelector("oer-edit-bar").shadowRoot.querySelector("[role=status]")?.textContent || ""), { what: "the save to fail", timeout: 25000 });
        await ctx.sleep(300);
      } finally {
        await stop();
        await noFocus(false);
      }
      const saved = await caretAt();
      check("After a failed save the caret is back where it was, though the clicked Save took no focus (as in Safari)", saved.focus === "hax-body" && saved.in === "p" && saved.offset === 5, json(saved));
      await placeCaret(9);
      await noFocus(true);
      try {
        await ctx.clickAt(await bar('[data-id="preview"]'));
        await ctx.sleep(400);
      } finally {
        await noFocus(false);
      }
      await ctx.press("Escape");
      await ctx.sleep(400);
      const back = await caretAt();
      check("…and after Preview, Esc puts it back too", back.focus === "hax-body" && back.in === "p" && back.offset === 9, json(back));
      await ctx.exitEdit({ discard: true });
    });

    /* ---------- a slow reload ---------- */

    await part("slow reload", async () => {
      await dropCopies().catch(() => {});
      await edit();
      await typeTagline("New text, the reload is slow");
      // HAX's reload after the save (the page, the site, its API) answers 26 s late
      let saved = false;
      const onRequest = (req) => {
        if (req.isInterceptResolutionHandled()) return;
        if (req.method() === "PATCH" && /\/x\/api\/v1\/content\//.test(req.url())) {
          req.continue();
          saved = true;
        } else if (saved && req.method() === "GET" && /(site\.json|\/pages\/|\/x\/api\/v1\/(content|site))/.test(req.url())) setTimeout(() => req.continue().catch(() => {}), 26000);
        else req.continue();
      };
      await page.setRequestInterception(true);
      page.on("request", onRequest);
      try {
        await page.evaluate((OLD) => {
          const seen = (words) => [__ec.theme(), __ec.haxBody()].some((root) => root?.querySelector("oer-cs-hero > p")?.checkVisibility() && root.querySelector("oer-cs-hero > p").textContent.includes(words));
          globalThis.__samples = [];
          globalThis.__sampling = setInterval(() => globalThis.__samples.push({ old: seen(OLD), now: seen("New text, the reload is slow"), editing: !!__ec.store().editMode }), 250);
        }, OLD);
        await ctx.clickAt(await ctx.control("Save"));
        await ctx.waitFor(() => !__ec.store().editMode, { what: "the reading view", timeout: 40000 });
        await ctx.sleep(1500);
      } finally {
        page.off("request", onRequest);
        await page.setRequestInterception(false);
      }
      const shown = await tagline();
      const samples = await page.evaluate(() => {
        clearInterval(globalThis.__sampling);
        const s = globalThis.__samples;
        const firstReading = s.findIndex((x) => !x.editing);
        return { count: s.length, held: (firstReading * 250) / 1000, old: s.filter((x) => x.old && x.editing).length };
      });
      // (the owner's cap: the held save ends 20 s after the answer, HAX
      // still loading or not, e.g. a load that failed left it loading)
      check("When HAX's reload after a save takes over 20 s, ‘Saving…’ stays up for 20 s, never showing the old tagline, then editing ends", samples.held >= 19 && samples.held <= 24 && !samples.old && savedTagline() === "New text, the reload is slow", json(samples));
      check("…on the page as saved, not the one from before", shown === "New text, the reload is slow", json(shown));
    });

    await part("failed reload", async () => {
      await dropCopies().catch(() => {});
      await edit();
      await typeTagline("New text, the reload fails");
      // HAX's reload after the save (the page and the site) is answered with an error
      let saved = false;
      const onRequest = (req) => {
        if (req.isInterceptResolutionHandled()) return;
        if (req.method() === "PATCH" && /\/x\/api\/v1\/content\//.test(req.url())) {
          req.continue();
          saved = true;
        } else if (saved && req.method() === "GET" && /(site\.json|\/pages\/)/.test(req.url())) req.respond({ status: 500, contentType: "text/plain", body: "" });
        else req.continue();
      };
      await page.setRequestInterception(true);
      page.on("request", onRequest);
      let end = null;
      try {
        await ctx.clickAt(await ctx.control("Save"));
        await ctx.waitFor(() => !__ec.store().editMode, { what: "the reading view", timeout: 30000 });
        await ctx.sleep(1000);
        end = { shown: await tagline(), missing: await page.evaluate(() => /could not be located/.test(__ec.theme().textContent)), saved: savedTagline() };
      } finally {
        page.off("request", onRequest);
        await page.setRequestInterception(false);
      }
      check("When HAX's reload after a save fails, editing ends on the page as saved, not ‘could not be located’", end.shown === "New text, the reload fails" && !end.missing && end.saved === end.shown, json(end));
    });
  } finally {
    writeFileSync(file, original);
    await dropCopies().catch(() => {});
  }
  return results;
}
