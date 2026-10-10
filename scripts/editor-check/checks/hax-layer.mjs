// The HAX layer (WP-04): the pinned runtime fixes and the policy they read.
// Backspace and Delete never take a section apart, nor does a selection
// across sections; selecting isn't an undo step and ⌘Z is HAX's undo; keys
// and pastes outside the content (or in a section's own controls) don't
// edit it; sections aren't text boxes and don't take dropped or pasted
// files and pictures, while dragged text and drags that are refused leave
// nothing behind; and a fix whose HAX method has changed switches itself
// off with one warning naming its file. Ordinary pages still join and
// delete paragraphs as before.
//
// Fixtures are written into the copy's pages (today's markup with text in
// it, and a lesson of plain paragraphs) and put back at the end. Nothing is
// saved. hax-layer-pages.mjs has the same layer on ordinary pages.
//
// Since the section model (WP-07), What you'll learn's list becomes
// outcomes as editing begins, and every section has an h2 of its own: the
// parts that typed in its list type in its outcomes, and a section is
// selected by a click on its own padding. Since WP-08 the tools' list
// becomes tools and the questions question items as well: the parts that
// typed in a tool or a question type in those items (a written section's
// first field is its heading), two rows of one list are an answer's list,
// a paste of two paragraphs in a tool makes the second a tool of its own
// (spec §5.4), and the hero's own control is its Change image button.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

// the pages, by id: a save gives a page whose title ends in "?" a new
// address (stopgaps saves the lesson "What is design?")
const SITE_ID = "item-0330a29b-7735-4ac0-afd2-e3b2a88d49e3";
const HUB_ID = "item-417a2d47-2196-42b8-acae-bb0202f18fae";
const LESSON_ID = "item-143f3783-959c-45c3-8758-dacef0f6861f";

// the markup of before the section model, with text in it (written
// sections hold ul/li and p, which become items as editing begins), and a
// paragraph between Tools and the questions
const TEXT_PAGE = `<oer-cs-hero><p>Hero tagline text here</p></oer-cs-hero>
<oer-cs-facts></oer-cs-facts>
<oer-cs-learn><ul><li>Cut with confidence: plan and cut parts.</li><li>Print what you model: slice meshes.</li></ul></oer-cs-learn>
<oer-cs-semester></oer-cs-semester>
<oer-cs-people><p>A note from the instructor.</p></oer-cs-people>
<oer-cs-tools><ul><li>Laser cutter</li><li>Fusion 360</li></ul></oer-cs-tools>
<p>A paragraph between sections.</p>
<oer-cs-faq><h3>Do I need experience?</h3><p>No. Week 1 starts with safety.</p><ul><li>Closed shoes</li><li>Safety glasses</li></ul></oer-cs-faq>
<oer-cs-closing></oer-cs-closing>
`;
const LESSON_PAGE = `<p>First paragraph of the lesson.</p>
<p>Second paragraph here.</p>
<h2>A heading</h2>
<p>Third paragraph after the heading.</p>
<p>Fourth paragraph to finish.</p>
`;
// each written section and its first field ("site" or "hub")
const WRITTEN = [
  ["site", "oer-cs-hero", "oer-cs-hero > p"],
  ["site", "oer-cs-learn", "oer-cs-learn > h2"],
  ["site", "oer-cs-people", "oer-cs-people > p"],
  ["site", "oer-cs-tools", "oer-cs-tools > h2"],
  ["site", "oer-cs-faq", "oer-cs-faq > h2"],
  ["hub", "oer-courses-intro", "oer-courses-intro > p"],
];

/* ---------- in the page ---------- */

// hax-body's HTML without what HAX changes while editing (as undo.js
// normalizes it: the harness's normalize() plus element-visible)
function snapshot(selector) {
  const body = __ec.haxBody();
  const clean = (html) => __ec.normalize(html).replace(/\selement-visible(="[^"]*")?/g, "");
  const el = selector ? body.querySelector(selector) : null;
  return {
    blocks: body.children.length,
    shape: [...body.children].map((c) => c.localName).join(" "),
    html: clean(body.innerHTML),
    part: selector ? (el ? clean(el.outerHTML) : "(gone)") : null,
  };
}

// put the selection from [selector, index, offset] to another (or collapse
// it there); offset "end" is the end of the element's text
function place({ from, to }) {
  const body = __ec.haxBody();
  const point = ([selector, index = 0, offset = 0]) => {
    const el = body.querySelectorAll(selector)[index];
    const text = [...el.childNodes].find((n) => n.nodeType === 3);
    if (!text) return [el, offset === "end" ? el.childNodes.length : 0];
    return [text, offset === "end" ? text.length : offset];
  };
  const [a, ao] = point(from);
  const [b, bo] = to ? point(to) : [a, ao];
  const sel = body.getRootNode().getSelection();
  sel.setBaseAndExtent(a, ao, b, bo);
  return sel.toString();
}

function pasteInto({ text, html }) {
  const dt = new DataTransfer();
  dt.setData("text/plain", text);
  if (html) dt.setData("text/html", html);
  const target = __ec.activeElement() || __ec.haxBody();
  target.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true, composed: true }));
}

// paste a picture (an image file on the clipboard, as a screenshot copied)
// at the caret in the element selector names; HAX's upload, which a paste it
// takes starts, is stopped and counted
function pastePicture(selector) {
  const body = __ec.haxBody();
  const el = body.querySelector(selector);
  const unit = el.parentElement === body ? el : el.parentElement;
  const kids = unit.children.length;
  const pictures = body.querySelectorAll("img").length;
  let uploads = 0;
  const stop = (e) => {
    uploads++;
    e.stopImmediatePropagation();
    e.detail?.placeHolderElement?.remove();
  };
  addEventListener("place-holder-file-drop", stop, true);
  const dt = new DataTransfer();
  dt.items.add(new File(["image"], "screenshot.png", { type: "image/png" }));
  (__ec.activeElement() || el).dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true, composed: true }));
  removeEventListener("place-holder-file-drop", stop, true);
  return { uploads, added: unit.children.length - kids + (body.querySelectorAll("img").length - pictures) };
}

// which pinned fixes are on, by the methods they wrap
function fixesOn() {
  const proto = (tag) => customElements.get(tag)?.prototype;
  const body = proto("hax-body");
  const fix = (fn) => fn?.__oerFix ?? null;
  return {
    "hax-body _onKeyDown": fix(body?._onKeyDown),
    "hax-body _onKeyUp": fix(body?._onKeyUp),
    "hax-body _activeNodeChanged": fix(body?._activeNodeChanged),
    "hax-body positionContextMenus": fix(body?.positionContextMenus),
    "hax-body _haxContextOperation": fix(body?._haxContextOperation),
    "hax-body dropEvent": fix(body?.dropEvent),
    "hax-body undoManagerStackLogic": fix(body?.undoManagerStackLogic),
    "hax-text-editor-toolbar setTarget": fix(proto("hax-text-editor-toolbar")?.setTarget),
    "hax-tray _setupForm": fix(proto("hax-tray")?._setupForm),
    "rich-text-editor-emoji-picker _pickerChange": fix(proto("rich-text-editor-emoji-picker")?._pickerChange),
    "rich-text-editor-symbol-picker _pickerChange": fix(proto("rich-text-editor-symbol-picker")?._pickerChange),
    "hax-store _onPaste": fix(__ec.haxStore()?._onPaste),
    "haxcms-site-editor-ui _cancelButtonTap": fix(proto("haxcms-site-editor-ui")?._cancelButtonTap),
  };
}

// what the guard refused since the last call
function refusals() {
  const list = (globalThis.__refused ||= []);
  if (!globalThis.__listening) {
    globalThis.__listening = true;
    addEventListener("oer-edit-refused", (e) => __refused.push(`${e.detail.inputType}: ${e.detail.reason}`), true);
  }
  return list.splice(0);
}

export default async function haxLayer(ctx) {
  const { page } = ctx;
  const results = [];
  const check = (name, pass, detail = "") => results.push({ name, pass: !!pass, detail });
  const json = (v) => JSON.stringify(v);
  page.on("dialog", (d) => d.accept().catch(() => {}));
  // every fix's warning, from the first page on
  const warnings = [];
  page.on("console", (m) => /^warn/.test(m.type()) && m.text().startsWith("Editor fix off") && warnings.push(m.text()));
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

  // each page's address now, and its file
  const items = JSON.parse(readFileSync(path.join(ctx.siteDir, "site.json"), "utf8")).items;
  const ids = new Map();
  const address = (id) => {
    const item = items.find((i) => i.id === id);
    if (!item) throw new Error(`No page ${id} in the copy's site.json`);
    ids.set(`/${item.slug}`, id);
    return `/${item.slug}`;
  };
  const SITE = address(SITE_ID);
  const HUB = address(HUB_ID);
  const LESSON = address(LESSON_ID);
  const pageFile = (pagePath) => path.join(ctx.siteDir, "pages", ids.get(pagePath), "index.html");
  const originals = new Map();
  const write = (slug, html) => {
    const file = pageFile(slug);
    if (!originals.has(file)) originals.set(file, readFileSync(file, "utf8"));
    writeFileSync(file, html);
  };
  const starter = (slug) => {
    const file = pageFile(slug);
    if (originals.has(file)) writeFileSync(file, originals.get(file));
  };

  /* ---------- helpers ---------- */

  const handle = (fn, ...args) => page.evaluateHandle(fn, ...args);
  const field = (selector, index = 0) => handle((s, i) => __ec.haxBody().querySelectorAll(s)[i] || null, selector, index);
  const snap = (selector) => page.evaluate(snapshot, selector ?? null);
  const stack = () =>
    page.evaluate(() => {
      const b = __ec.haxBody();
      return { position: b.undoStack.undoStackPosition, steps: b.undoStack.commands.length, canUndo: b.undoStack.canUndo() };
    });
  // a fresh editing session on a page (fixture written first, if any)
  const edit = async (pagePath, fixture) => {
    if (await ctx.editMode()) await ctx.exitEdit({ discard: true });
    if (fixture) write(pagePath, fixture);
    await ctx.open(pagePath);
    await ctx.enterEdit();
    await page.evaluate(refusals);
  };
  // click a field (by selector and index), wait for HAX, then place the selection
  const clickField = async (selector, index = 0) => {
    const el = await field(selector, index);
    if (!el.asElement()) throw new Error(`No ${selector} [${index}] in hax-body`);
    // clear of the editing bar, which stays at the top
    await el.evaluate((f) => f.scrollIntoView({ block: "center" }));
    await ctx.frames();
    await ctx.clickAt(el);
    await ctx.sleep(300);
  };
  // select a section as a whole, by a click on its own padding, above what's in it
  const selectSection = async (tag) => {
    const spot = await page.evaluate(async (tag) => {
      const s = __ec.haxBody().querySelector(tag);
      // (its top in view: a tall section's heading in the middle)
      (s.querySelector(":scope > h1, :scope > h2") || s).scrollIntoView({ block: "center" });
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const r = s.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + 12) };
    }, tag);
    await ctx.clickAt(spot);
    await ctx.waitFor((tag) => __ec.haxStore().activeNode?.localName === tag, { args: [tag], what: `${tag} to be selected`, timeout: 5000 });
    await ctx.sleep(150);
  };
  const refusedNow = () => page.evaluate(refusals);

  try {
    /* ---------- Backspace at the start of every written section ---------- */

    await part("written sections", async () => {
      for (const [label, fixture] of [
        ["empty", null],
        ["with text", TEXT_PAGE],
      ]) {
        const outcomes = [];
        for (const [which, tag, selector] of WRITTEN) {
          const pagePath = which === "hub" ? HUB : SITE;
          if (pagePath === HUB && fixture) continue;
          if (!(await ctx.editMode()) || (await page.evaluate(() => location.pathname)) !== pagePath) await edit(pagePath, pagePath === SITE ? fixture || null : null);
          await clickField(selector);
          await page.evaluate(place, { from: [selector, 0, 0] });
          const before = await snap(tag);
          await ctx.press("Backspace");
          await ctx.press("Backspace");
          await ctx.sleep(400);
          const after = await snap(tag);
          const kept = after.blocks === before.blocks && after.html === before.html;
          outcomes.push({ tag, kept, detail: kept ? `${after.blocks} blocks` : `${before.blocks}→${after.blocks} blocks; ${after.part.slice(0, 80)}`, refused: (await refusedNow()).join(", ") });
          // a section that changed would change the next one's start
          if (!kept) await edit(pagePath, pagePath === SITE ? fixture || null : null);
        }
        check(
          `Backspace at the start of every written section's first field leaves hax-body's blocks unchanged (${label})`,
          outcomes.every((o) => o.kept),
          outcomes.map((o) => `${o.tag}: ${o.kept ? "kept" : o.detail}${o.refused ? ` (${o.refused})` : ""}`).join("; "),
        );
      }
      if (await ctx.editMode()) await ctx.exitEdit({ discard: true });
      starter(SITE);
    });

    /* ---------- selections across sections, and other edges ---------- */

    await part("across sections", async () => {
      await edit(SITE, TEXT_PAGE);
      // a person's Shift-click: HAX's mousedown re-selects the block clicked,
      // so it may not reach across at all; the selection is then made as a
      // Shift-click would have made it
      const charAt = (selector, offset) =>
        page.evaluate(
          (s, o) => {
            const el = __ec.haxBody().querySelector(s);
            const r = document.createRange();
            r.setStart(el.firstChild, o);
            r.setEnd(el.firstChild, o + 1);
            const box = r.getBoundingClientRect();
            return { x: box.left + 1, y: box.top + box.height / 2 };
          },
          selector,
          offset,
        );
      const crossing = { from: ["oer-cs-hero > p", 0, 5], to: ["oer-cs-learn h3", 0, 4] };
      const both = async () => ({ hero: (await snap("oer-cs-hero")).part, learn: (await snap("oer-cs-learn")).part, all: await snap() });
      for (const [what, act] of [
        ["Delete", () => ctx.press("Delete")],
        ["typing a letter", () => ctx.type("x")],
      ]) {
        await clickField("oer-cs-hero > p");
        await page.mouse.click(...Object.values(await charAt("oer-cs-hero > p", 5)));
        await ctx.sleep(300);
        await page.keyboard.down("Shift");
        await page.mouse.click(...Object.values(await charAt("oer-cs-learn h3", 4)));
        await page.keyboard.up("Shift");
        await ctx.sleep(300);
        const clicked = await page.evaluate(() => {
          const body = __ec.haxBody();
          const sel = body.getRootNode().getSelection();
          const section = (n) => (n?.nodeType === 1 ? n : n?.parentElement)?.closest("oer-cs-hero, oer-cs-learn")?.localName ?? null;
          return { text: sel.toString(), from: section(sel.anchorNode), to: section(sel.focusNode) };
        });
        const across = clicked.from === "oer-cs-hero" && clicked.to === "oer-cs-learn";
        const selected = across ? clicked.text : await page.evaluate(place, crossing);
        const before = await both();
        await act();
        await ctx.sleep(500);
        const after = await both();
        check(
          `A Shift-click selection across two sections followed by ${what} leaves both sections' normalized HTML unchanged`,
          after.hero === before.hero && after.learn === before.learn && after.all.html === before.all.html,
          `${across ? "selected" : `the Shift-click selected “${clicked.text}” in ${clicked.from} to ${clicked.to} (HAX re-selects the block clicked), so selected`} “${selected.replace(/\s+/g, " ")}”; then ${after.all.html === before.all.html ? "unchanged" : `${after.hero} ${after.learn}`}; ${(await refusedNow()).join(", ") || "nothing refused"}`,
        );
        if (after.all.html !== before.all.html) await edit(SITE, TEXT_PAGE);
      }

      // the rest of the spike's cases, each from a fresh selection
      const cases = [
        ["Enter over a selection across two sections", "oer-cs-hero > p", crossing, () => ctx.press("Enter")],
        [
          "Cut of a selection across two sections",
          "oer-cs-hero > p",
          crossing,
          async () => {
            await page.keyboard.down("Meta");
            await page.keyboard.press("x", { commands: ["cut"] });
            await page.keyboard.up("Meta");
          },
        ],
        ["Backspace over everything from the first text to the last", "oer-cs-people > p", { from: ["oer-cs-hero > p", 0, 0], to: ["oer-cs-question li", 1, "end"] }, () => ctx.press("Backspace")],
        [
          "Composing (an input method) over a selection across two sections",
          "oer-cs-hero > p",
          crossing,
          async () => {
            const cdp = await page.createCDPSession();
            await cdp.send("Input.imeSetComposition", { text: "か", selectionStart: 1, selectionEnd: 1 });
            await cdp.send("Input.imeSetComposition", { text: "かな", selectionStart: 2, selectionEnd: 2 });
            await cdp.send("Input.insertText", { text: "仮名" });
            await cdp.detach();
          },
          // the text goes in at the caret, every block kept
          (before, after) => after.blocks === before.blocks && after.shape === before.shape && after.html.includes("仮名"),
        ],
        [
          "Pasting two paragraphs with the caret in a tool",
          "oer-cs-tool > p",
          { from: ["oer-cs-tool > p", 1, 3] },
          () => page.evaluate(pasteInto, { text: "First pasted\n\nSecond pasted", html: "<p>First pasted</p><p>Second pasted</p>" }),
          // plain text, the first line in the tool and the second a tool after it
          (before, after) => after.shape === before.shape && after.html.includes("<oer-cs-tool><p>FusFirst pastedion 360</p></oer-cs-tool><oer-cs-tool><p>Second pasted</p></oer-cs-tool>"),
        ],
        ["Backspace at the start of a question", "oer-cs-question > h3", { from: ["oer-cs-question > h3", 0, 0] }, () => ctx.press("Backspace")],
        ["Backspace at the start of an answer", "oer-cs-question > p", { from: ["oer-cs-question > p", 0, 0] }, () => ctx.press("Backspace")],
        ["Backspace at the start of the paragraph between sections", ":scope > p", { from: [":scope > p", 0, 0] }, () => ctx.press("Backspace")],
        ["Delete at the end of the last tool", "oer-cs-tool > p", { from: ["oer-cs-tool > p", 1, "end"] }, () => ctx.press("Delete")],
        [
          "Shift+Down from Tools into the next block, then Backspace",
          "oer-cs-tool > p",
          { from: ["oer-cs-tool > p", 1, 3] },
          async () => {
            await page.keyboard.down("Shift");
            await page.keyboard.press("ArrowDown");
            await page.keyboard.press("ArrowDown");
            await page.keyboard.up("Shift");
            await ctx.press("Backspace");
          },
        ],
      ];
      const rows = [];
      for (const [name, selector, at, act, keeps] of cases) {
        await clickField(selector);
        await page.evaluate(place, at);
        const before = await snap();
        await act();
        await ctx.sleep(500);
        const after = await snap();
        const pass = keeps ? keeps(before, after) : after.html === before.html;
        rows.push(`${name}: ${pass ? "kept" : `changed (${before.blocks}→${after.blocks}: ${after.shape})`}${(await refusedNow()).length ? "" : ", nothing refused"}`);
        if (!pass) rows[rows.length - 1] += ` ${after.html.slice(0, 120)}`;
        results.push({ name: `${name} keeps every section`, pass, detail: rows[rows.length - 1] });
        if (after.html !== before.html) await edit(SITE, TEXT_PAGE);
      }

      // inside one section, deleting across two rows of a list still works
      // (an answer's: the tools and outcomes are items, which a deletion
      // doesn't join)
      await clickField("oer-cs-question li");
      await page.evaluate(place, { from: ["oer-cs-question li", 0, 5], to: ["oer-cs-question li", 1, 7] });
      const before = await snap("oer-cs-faq");
      await ctx.press("Delete");
      await ctx.sleep(500);
      const after = await snap("oer-cs-faq");
      check("Deleting across two rows of one section's list still works", after.blocks === before.blocks && after.part !== before.part && /<li>Closeglasses<\/li>/.test(after.part), after.part);
      await ctx.exitEdit({ discard: true });
    });

    /* ---------- the beforeinput guard on its own ---------- */

    // the events the browser would send, with their target ranges, straight
    // to hax-body: whether the guard cancels them (the keydown backup and
    // HAX's own handling never see these)
    const input = (inputType, [from, fromIndex, fromOffset], [to, toIndex, toOffset] = [from, fromIndex, fromOffset]) =>
      page.evaluate(
        (inputType, a, b) => {
          const body = __ec.haxBody();
          const point = ([selector, index, offset]) => {
            const el = selector === "body" ? body : body.querySelectorAll(selector)[index];
            const text = [...el.childNodes].find((n) => n.nodeType === 3);
            if (selector === "body" || !text) return [el, offset === "end" ? el.childNodes.length : offset];
            return [text, offset === "end" ? text.length : offset];
          };
          const [sc, so] = point(a);
          const [ec, eo] = point(b);
          const range = new StaticRange({ startContainer: sc, startOffset: so, endContainer: ec, endOffset: eo });
          const e = new InputEvent("beforeinput", { inputType, data: /^insertText/.test(inputType) ? "x" : null, targetRanges: [range], bubbles: true, cancelable: true, composed: true });
          body.dispatchEvent(e);
          return e.defaultPrevented;
        },
        inputType,
        [from, fromIndex, fromOffset],
        [to, toIndex, toOffset],
      );

    await part("beforeinput", async () => {
      await edit(SITE, TEXT_PAGE);
      await clickField("oer-cs-hero > p");
      const refusedCases = {
        "a deletion with nothing to delete at the start of the tagline": await input("deleteContentBackward", ["oer-cs-hero > p", 0, 0]),
        "a deletion from the last tool into the paragraph after it": await input("deleteContentForward", ["oer-cs-tool > p", 1, "end"], [":scope > p", 0, 0]),
        "a deletion from the paragraph before the questions into the first one": await input("deleteContentBackward", [":scope > p", 0, "end"], ["oer-cs-question > h3", 0, 0]),
        "a drag from Tools into the paragraph after it": await input("deleteByDrag", ["oer-cs-tool > p", 1, 3], [":scope > p", 0, 5]),
        "a drop into the semester, outside any field": await input("insertFromDrop", ["oer-cs-semester", 0, 0]),
        "an answer joined into its question": await input("deleteContentBackward", ["oer-cs-question > h3", 0, "end"], ["oer-cs-question > p", 0, 0]),
        "an outcome joined into the one before": await input("deleteContentBackward", ["oer-cs-outcome > p", 0, "end"], ["oer-cs-outcome > h3", 1, 0]),
        "a deletion of whole blocks": await input("deleteContentBackward", ["body", 0, 2], ["body", 0, 4]),
      };
      const allowedCases = {
        "a letter deleted in the tagline": !(await input("deleteContentBackward", ["oer-cs-hero > p", 0, 3], ["oer-cs-hero > p", 0, 4])),
        "two rows of one list joined": !(await input("deleteContentBackward", ["oer-cs-question li", 0, "end"], ["oer-cs-question li", 1, 0])),
        "typing in the tagline": !(await input("insertText", ["oer-cs-hero > p", 0, 4])),
      };
      const html = (await snap()).html;
      await ctx.exitEdit({ discard: true });
      await edit(LESSON, LESSON_PAGE);
      await clickField(":scope > p", 1);
      allowedCases["two paragraphs of a lesson joined"] = !(await input("deleteContentBackward", [":scope > p", 0, "end"], [":scope > p", 1, 0]));
      allowedCases["a selection across a lesson's paragraphs deleted"] = !(await input("deleteContentForward", [":scope > p", 0, 5], [":scope > p", 2, 4]));
      await ctx.exitEdit({ discard: true });
      starter(LESSON);
      const list = (cases) =>
        Object.entries(cases)
          .map(([name, ok]) => `${name}: ${ok ? "yes" : "NO"}`)
          .join("; ");
      check("The beforeinput guard alone cancels deletions, drags and drops across a boundary", Object.values(refusedCases).every(Boolean), list(refusedCases));
      check("…and lets edits inside a field, a list or an ordinary page through", Object.values(allowedCases).every(Boolean) && !html.includes("(gone)"), list(allowedCases));
    });

    /* ---------- an ordinary page still joins and deletes paragraphs ---------- */

    await part("ordinary page", async () => {
      await edit(LESSON, LESSON_PAGE);
      // (Chrome joins with a no-break space)
      const paragraphs = () => page.evaluate(() => [...__ec.haxBody().querySelectorAll(":scope > p, :scope > h2")].map((p) => p.textContent.replace(/\s+/g, " ")));
      await clickField(":scope > p", 1);
      await page.evaluate(place, { from: [":scope > p", 1, 0] });
      await ctx.press("Backspace");
      await ctx.sleep(400);
      const joined = await paragraphs();
      check("On a lesson, Backspace at the start of a paragraph still joins it to the one before", joined[0] === "First paragraph of the lesson.Second paragraph here.", json(joined));
      await clickField(":scope > p", 1);
      await page.evaluate(place, { from: [":scope > p", 1, 5], to: [":scope > p", 2, 6] });
      await ctx.press("Delete");
      await ctx.sleep(400);
      const deleted = await paragraphs();
      check("…and a selection across two paragraphs still deletes", deleted.includes("Third paragraph to finish."), json(deleted));
      await ctx.exitEdit({ discard: true });
      starter(LESSON);
    });

    /* ---------- undo ---------- */

    await part("undo", async () => {
      await edit(SITE, TEXT_PAGE);
      const entered = await stack();
      const start = await snap();
      for (const s of ["oer-cs-hero > p", "oer-cs-learn h3", "oer-cs-people > p", "oer-cs-tool > p", "oer-cs-question > h3"]) {
        await clickField(s);
        // past HAX's 300 ms wait before it takes a snapshot
        await ctx.sleep(450);
      }
      const clicked = await stack();
      await ctx.clickAt(await ctx.control("Undo"));
      await ctx.sleep(600);
      const undone = await snap();
      check(
        "Clicking five different blocks and then Undo changes nothing",
        !entered.canUndo && !clicked.canUndo && undone.html === start.html,
        `steps: ${entered.steps} on entering, ${clicked.steps} after five clicks (canUndo ${clicked.canUndo}); the HTML after Undo is ${undone.html === start.html ? "unchanged" : "changed"}`,
      );

      // ⌘Z undoes typing through HAX's undo stack
      const typed = () => page.evaluate(() => __ec.haxBody().querySelector("oer-cs-people > p").textContent);
      await clickField("oer-cs-people > p");
      await page.evaluate(place, { from: ["oer-cs-people > p", 0, "end"] });
      await ctx.type("abc");
      await ctx.sleep(600);
      const afterTyping = { ...(await stack()), text: await typed() };
      await ctx.press("Meta+z");
      await ctx.sleep(500);
      const afterUndo = { ...(await stack()), text: await typed() };
      check(
        "Typing ‘abc’ then Meta+Z removes ‘abc’ through HAX's undo stack",
        afterTyping.text.endsWith("abc") && !afterUndo.text.includes("abc") && afterUndo.position === afterTyping.position - 1,
        `position ${afterTyping.position}→${afterUndo.position}; “${afterUndo.text}”`,
      );
      await ctx.press("Meta+Shift+z");
      await ctx.sleep(500);
      const redone = { ...(await stack()), text: await typed() };
      check("…Meta+Shift+Z redoes it", redone.text.endsWith("abc") && redone.position === afterTyping.position, `position ${afterUndo.position}→${redone.position}; “${redone.text}”`);
      // clicking after an undo doesn't cost the redo
      await ctx.press("Meta+z");
      await ctx.sleep(500);
      await clickField("oer-cs-hero > p");
      await ctx.sleep(450);
      await clickField("oer-cs-question > h3");
      await ctx.sleep(450);
      const canRedo = await page.evaluate(() => __ec.haxBody().undoStack.canRedo());
      await ctx.press("Meta+Shift+z");
      await ctx.sleep(500);
      check("…and selecting blocks after an Undo keeps the Redo", canRedo && (await typed()).endsWith("abc"), `canRedo ${canRedo}; “${await typed()}”`);

      // typed and undone at once, before HAX's 300 ms wait has recorded it
      await clickField("oer-cs-people > p");
      await page.evaluate(place, { from: ["oer-cs-people > p", 0, "end"] });
      const quick = await stack();
      await ctx.type("def");
      await ctx.press("Meta+z");
      await ctx.sleep(500);
      const quickUndo = { ...(await stack()), text: await typed() };
      check(
        "Meta+Z straight after typing takes back the typing, not the step before",
        !quickUndo.text.includes("def") && quickUndo.text.endsWith("abc") && quickUndo.position === quick.position,
        `“${quickUndo.text}”, position ${quick.position}→${quickUndo.position}`,
      );

      // the browser's own Undo command (the Edit menu)
      await ctx.type("ghi");
      await ctx.sleep(600);
      const beforeMenu = await stack();
      await page.keyboard.press("Shift", { commands: ["undo"] });
      await ctx.sleep(500);
      const menu = { ...(await stack()), text: await typed() };
      check(
        "The browser's own Undo command goes to HAX's undo",
        !menu.text.includes("ghi") && menu.position === beforeMenu.position - 1 && menu.steps === beforeMenu.steps,
        `position ${beforeMenu.position}→${menu.position}, ${menu.steps} steps; “${menu.text}”`,
      );

      // Ctrl+Z (HAX's own key) with focus on the editor's Undo button
      await ctx.type("jkl");
      await ctx.sleep(600);
      const button = await ctx.control("Undo");
      await button.evaluate((b) => b.focus());
      await ctx.press("Control+z");
      await ctx.sleep(500);
      check("Ctrl+Z with focus on the editor's Undo button undoes", !(await typed()).includes("jkl"), `“${await typed()}”`);

      // a form field keeps its own undo: Mod+Z in Page details leaves the page
      await clickField("oer-cs-people > p");
      await page.evaluate(place, { from: ["oer-cs-people > p", 0, "end"] });
      await ctx.type("mno");
      await ctx.sleep(600);
      const withField = await stack();
      const input = await handle(async () => {
        const details = document.querySelector("oer-page-details") || document.body.appendChild(document.createElement("oer-page-details"));
        details.show(__ec.store().activeItem.id);
        await new Promise((r) => setTimeout(r, 600));
        return [...details.shadowRoot.querySelectorAll("input[type=text], input:not([type])")].find((i) => i.checkVisibility()) || null;
      });
      if (!input.asElement()) throw new Error("Page details shows no text field");
      await ctx.clickAt(input);
      await ctx.press("Meta+z");
      await ctx.sleep(400);
      const inField = await stack();
      check(
        "Meta+Z in a Page details field leaves the page's undo alone",
        inField.position === withField.position && (await typed()).endsWith("mno"),
        `position ${withField.position}→${inField.position}; focus on ${(await ctx.deepActiveElement())?.path}`,
      );

      // a paste into Page details while a section is active adds nothing
      await ctx.press("Escape");
      await ctx.sleep(400);
      await selectSection("oer-cs-learn");
      const beforePaste = await snap();
      const input2 = await handle(async () => {
        const details = document.querySelector("oer-page-details");
        details.show(__ec.store().activeItem.id);
        await new Promise((r) => setTimeout(r, 600));
        return [...details.shadowRoot.querySelectorAll("input[type=text], input:not([type])")].find((i) => i.checkVisibility()) || null;
      });
      await ctx.clickAt(input2);
      const active = await page.evaluate(() => __ec.haxStore().activeNode?.localName);
      await page.evaluate(pasteInto, { text: "Pasted into Page details" });
      await ctx.sleep(500);
      const afterPaste = await snap();
      check(
        "A paste into a Page details field while a section is active adds no element to hax-body",
        afterPaste.blocks === beforePaste.blocks && afterPaste.html === beforePaste.html,
        `active block ${active}; ${beforePaste.blocks}→${afterPaste.blocks} blocks, HTML ${afterPaste.html === beforePaste.html ? "unchanged" : "changed"}`,
      );
      await ctx.press("Escape");
      await ctx.sleep(400);
      await ctx.exitEdit({ discard: true });
    });

    /* ---------- keys outside the content ---------- */

    await part("keys outside", async () => {
      await edit(SITE, TEXT_PAGE);
      await clickField("oer-cs-hero > p");
      await page.evaluate(place, { from: ["oer-cs-hero > p", 0, 4] });
      await ctx.sleep(400);
      const before = await ctx.haxBodyHtml();
      await ctx.press("Alt+F10");
      await ctx.sleep(100);
      const onRail = await ctx.deepActiveElement();
      await ctx.press("Enter");
      await ctx.sleep(400);
      const after = await ctx.haxBodyHtml();
      check(
        "Enter pressed with focus on a rail button leaves hax-body's innerHTML unchanged",
        onRail?.path === "oer-block-rail › button" && after === before,
        `focus on ${onRail?.path} (${onRail?.name}); innerHTML ${after === before ? "unchanged" : "changed"}`,
      );
      await ctx.press("Escape");
      await ctx.press("Escape");
      // ↑↑ with focus on a button of the editor: HAX added a paragraph above the hero
      await clickField("oer-cs-hero > p");
      const blocks = (await snap()).shape;
      const undoButton = await ctx.control("Undo");
      await undoButton.evaluate((b) => b.focus());
      await ctx.press("ArrowUp");
      await ctx.press("ArrowUp");
      await ctx.sleep(500);
      const shape = (await snap()).shape;
      check("↑ twice with focus on the editor's own button adds no paragraph", shape === blocks, shape);
      // …nor on a section's own control, in its shadow DOM, which hax-body
      // hears too: the hero's Change image, with the tagline active
      await clickField("oer-cs-hero > p");
      const own = await handle(() => __ec.haxBody().querySelector("oer-cs-hero").shadowRoot.querySelector(".change-image"));
      if (!own.asElement()) throw new Error("The hero shows no Change image button");
      const active = await page.evaluate(() => __ec.haxStore().activeNode?.localName);
      await own.evaluate((b) => b.focus());
      await ctx.press("ArrowUp");
      await ctx.press("ArrowUp");
      await ctx.sleep(500);
      const ownShape = (await snap()).shape;
      check("…nor with focus on a section's own control (the hero's Change image) while its tagline is active", active === "p" && ownShape === blocks, `active block ${active}; ${ownShape}`);
      await ctx.exitEdit({ discard: true });
    });

    /* ---------- sections aren't text boxes ---------- */

    await part("roles", async () => {
      await edit(SITE, TEXT_PAGE);
      await selectSection("oer-cs-learn");
      const section = await page.evaluate(() => __ec.haxBody().querySelector("oer-cs-learn").getAttribute("role"));
      await clickField("oer-cs-hero > p");
      const field = await page.evaluate(() => ({ active: __ec.haxStore().activeNode?.localName, role: __ec.haxBody().querySelector("oer-cs-hero > p").getAttribute("role") }));
      // a control in the hero's own shadow DOM: HAX's stale focus listener
      // made the hero the text toolbar's target again
      await selectSection("oer-cs-hero");
      const control = await handle(() => __ec.haxBody().querySelector("oer-cs-hero").shadowRoot.querySelector(".change-image"));
      if (control.asElement()) {
        await control.evaluate((b) => b.scrollIntoView({ block: "center" }));
        await control.evaluate((b) => b.focus());
        await ctx.sleep(300);
      }
      const hero = await page.evaluate(() => __ec.haxBody().querySelector("oer-cs-hero").getAttribute("role"));
      await ctx.exitEdit({ discard: true });
      await edit(LESSON, LESSON_PAGE);
      await clickField(":scope > p", 0);
      const lesson = await page.evaluate(() => __ec.haxBody().querySelector(":scope > p").getAttribute("role"));
      check(
        "An active section host has no role attribute; an active paragraph has role=textbox",
        section === null && hero === null && field.role === "textbox" && lesson === "textbox",
        `learn ${section}; hero after focusing its own control ${hero}; tagline (${field.active}) ${field.role}; a lesson's paragraph ${lesson}`,
      );
      await ctx.exitEdit({ discard: true });
      starter(LESSON);
    });

    /* ---------- drops ---------- */

    // drop a file on an element of hax-body, as a person dropping a photo; HAX's
    // own upload (which a drop it takes starts) is stopped and counted
    const drop = (selector) =>
      page.evaluate((selector) => {
        const body = __ec.haxBody();
        const target = body.querySelector(selector);
        const kids = target.children.length;
        const blocks = body.children.length;
        let uploads = 0;
        const stop = (e) => {
          uploads++;
          e.stopImmediatePropagation();
          e.detail?.placeHolderElement?.remove();
        };
        addEventListener("place-holder-file-drop", stop, true);
        const dt = new DataTransfer();
        dt.items.add(new File(["image"], "photo.png", { type: "image/png" }));
        target.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true, composed: true }));
        removeEventListener("place-holder-file-drop", stop, true);
        return { kids: `${kids}→${target.children.length}`, blocks: `${blocks}→${body.children.length}`, uploads, added: target.children.length - kids };
      }, selector);

    await part("drops", async () => {
      await edit(SITE, TEXT_PAGE);
      await selectSection("oer-cs-semester");
      const semester = await drop("oer-cs-semester");
      check("Dropping a file onto oer-cs-semester adds no child to it", semester.added === 0 && semester.uploads === 0, json(semester));
      await clickField("oer-cs-learn h3");
      const kids = () => page.evaluate(() => __ec.haxBody().querySelector("oer-cs-learn").children.length);
      const held = await kids();
      const learn = await drop("oer-cs-learn h3");
      const inside = await kids();
      check("…nor onto a section's text", learn.uploads === 0 && learn.added === 0 && inside === held, `${json(learn)}; learn holds ${held}→${inside} children`);
      await clickField(":scope > p");
      const between = await drop(":scope > p");
      check("…while a file dropped onto a paragraph between sections still goes to HAX", between.uploads === 1, json(between));
      await ctx.exitEdit({ discard: true });

      // a picture pasted with the caret in a section's text, as a drop there
      await edit(SITE, TEXT_PAGE);
      const pasted = {};
      for (const [name, selector] of [
        ["the hero's tagline", "oer-cs-hero > p"],
        ["the people note", "oer-cs-people > p"],
        ["the paragraph between sections", ":scope > p"],
      ]) {
        await clickField(selector);
        await page.evaluate(place, { from: [selector, 0, "end"] });
        pasted[name] = await page.evaluate(pastePicture, selector);
      }
      const refusedPaste = await refusedNow();
      check(
        "A picture pasted into a section's text (the hero, the people note) isn't added to it, and HAX starts no upload",
        ["the hero's tagline", "the people note"].every((n) => pasted[n].added === 0 && pasted[n].uploads === 0) && refusedPaste.filter((r) => /picture/.test(r)).length === 2,
        `${json(pasted)}; ${refusedPaste.join(", ")}`,
      );
      check("…while one pasted into a paragraph between sections still goes to HAX", pasted["the paragraph between sections"].uploads === 1, json(pasted["the paragraph between sections"]));
      await ctx.exitEdit({ discard: true });

      // dragged text within one field: the drop isn't the sections' to
      // refuse, and goes on past the section (HAX's own window listeners,
      // user-scaffold's and simple-file-upload's, then cancel every drop)
      await edit(SITE, TEXT_PAGE);
      await clickField("oer-cs-hero > p");
      const textDrop = await page.evaluate(() => {
        const p = __ec.haxBody().querySelector("oer-cs-hero > p");
        const dt = new DataTransfer();
        dt.setData("text/plain", "tagline");
        let passed = false;
        const seen = () => (passed = true);
        document.addEventListener("drop", seen);
        p.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true, composed: true }));
        document.removeEventListener("drop", seen);
        return passed;
      });
      const textRefused = await refusedNow();
      check(
        "Text dragged within the hero's tagline isn't refused as a drop into a section",
        textDrop && !textRefused.length,
        `the drop ${textDrop ? "went on past the section" : "stopped at the section"}; ${textRefused.join(", ") || "nothing refused"}`,
      );

      // a file dragged in from outside and refused: nothing of the drag stays
      await selectSection("oer-cs-semester");
      const steps = await stack();
      const dragged = await page.evaluate(async () => {
        const body = __ec.haxBody();
        const target = body.querySelector("oer-cs-semester");
        const dt = new DataTransfer();
        dt.items.add(new File(["image"], "photo.png", { type: "image/png" }));
        const fire = (type) => target.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true, composed: true }));
        fire("dragenter");
        fire("dragover");
        const during = !!body.querySelector("fake-hax-body-end");
        fire("drop");
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        return { during, endCap: !!body.querySelector("fake-hax-body-end"), mover: body.hasAttribute("hax-mover"), marked: body.querySelectorAll(".hax-hovered, .hax-drop-above, .hax-drop-below").length };
      });
      await ctx.sleep(500);
      const afterDrag = await stack();
      check(
        "A file dragged in from outside and dropped onto the semester leaves no drop marks, end cap or undo step",
        dragged.during && !dragged.endCap && !dragged.mover && !dragged.marked && afterDrag.steps === steps.steps,
        `${json(dragged)}; undo steps ${steps.steps}→${afterDrag.steps}`,
      );
      // HAX's hidden context menus' box, over the active block
      await clickField("oer-cs-hero > p");
      const style = await page.evaluate(() => getComputedStyle(__ec.haxBody().shadowRoot.querySelector("#topcontextmenu")).pointerEvents);
      check("HAX's hidden context-menu box over the active block takes no clicks", style === "none", `pointer-events: ${style}`);
      // every fix, while editing (the paste fix waits for HAX's store)
      const on = await page.evaluate(fixesOn);
      check(
        "Every fix matches HAX 26.8.1 and is on",
        !warnings.length && Object.values(on).every(Boolean),
        warnings.join(" | ") ||
          Object.entries(on)
            .map(([where, fix]) => `${where}: ${fix || "OFF"}`)
            .join("; "),
      );
      // pinning a fix that's on again (with the pinning functions of the
      // copy's editor/hax-fixes.js, as a second caller would) leaves it on,
      // as it is, and warns of nothing
      const again = await page.evaluate(async () => {
        const source = await (await fetch("/custom/src/editor/hax-fixes.js")).text();
        const pinning = source.slice(source.indexOf("/* ---------- pinning"), source.indexOf("/* ---------- editing starts")).replaceAll("export function", "function");
        const { pinned } = new Function(`${pinning}\nreturn { pinned };`)();
        const proto = customElements.get("hax-body").prototype;
        const before = proto._onKeyUp;
        const on = pinned({ fix: "keys outside the content (_onKeyUp)", owner: "hax-body", target: proto, method: "_onKeyUp", marker: "timesClicked" }, (original) => original);
        return { on, unchanged: proto._onKeyUp === before };
      });
      await ctx.sleep(100);
      check("Pinning a fix that's on a second time keeps it on, unchanged, with no warning", again.on && again.unchanged && !warnings.length, `${json(again)}; ${warnings.join(" | ") || "no warning"}`);
      await ctx.exitEdit({ discard: true });
    });

    /* ---------- pinning ---------- */

    await part("fingerprints", async () => {
      // another tab, served a hax-body.js whose _onKeyUp has changed (the name
      // it uses renamed throughout, so HAX still works)
      const other = await ctx.newPage();
      const tab = other.page;
      const changed = [];
      tab.on("console", (m) => /^warn/.test(m.type()) && m.text().startsWith("Editor fix off") && changed.push(m.text()));
      await tab.setRequestInterception(true);
      tab.on("request", async (req) => {
        if (req.isInterceptResolutionHandled()) return;
        if (!/\/@haxtheweb\/hax-body\/hax-body\.js(\?|$)/.test(req.url())) return req.continue();
        const source = await (await fetch(req.url())).text();
        req.respond({ status: 200, contentType: "application/javascript", body: source.replaceAll("timesClicked", "timesPressed") });
      });
      await other.open(SITE);
      await other.enterEdit();
      await other.sleep(500);
      const fixes = await tab.evaluate(fixesOn);
      const off = Object.keys(fixes).filter((where) => !fixes[where]);
      check(
        "Forcing one fingerprint mismatch disables exactly that patch, with exactly one console warning",
        changed.length === 1 && /_onKeyUp/.test(changed[0]) && json(off) === json(["hax-body _onKeyUp"]),
        `${changed.length} warning(s): ${changed.join(" | ")}; off: ${off.join(", ") || "none"}`,
      );
      await other.exitEdit({ discard: true });
      await tab.close();

      // another, served a hax-body.js whose undoManagerStackLogic has changed
      // (__dragMoving, its marker, renamed throughout) and a hax-store.js whose window
      // paste listener is another method: each fix off, with its warning
      // naming the file it's in
      const third = await ctx.newPage();
      const tab3 = third.page;
      const changed3 = [];
      tab3.on("console", (m) => /^warn/.test(m.type()) && m.text().startsWith("Editor fix off") && changed3.push(m.text()));
      await tab3.setRequestInterception(true);
      tab3.on("request", async (req) => {
        if (req.isInterceptResolutionHandled()) return;
        const url = req.url();
        const body = /\/@haxtheweb\/hax-body\/hax-body\.js(\?|$)/.test(url) ? (s) => s.replaceAll("__dragMoving", "__dragInMotion") : /\/@haxtheweb\/hax-body\/lib\/hax-store\.js(\?|$)/.test(url) ? (s) => s.replace('paste:"_onPaste"', 'paste:"_onPasteNow"').replace("async _onPaste(e){", "_onPasteNow(e){return this._onPaste(e)}async _onPaste(e){") : null;
        if (!body) return req.continue();
        req.respond({ status: 200, contentType: "application/javascript", body: body(await (await fetch(url)).text()) });
      });
      await third.open(SITE);
      await third.enterEdit();
      await third.sleep(500);
      const fixes3 = await tab3.evaluate(fixesOn);
      const off3 = Object.keys(fixes3).filter((where) => !fixes3[where]);
      const undoWarning = changed3.find((w) => /undoManagerStackLogic/.test(w)) || "";
      const pasteWarning = changed3.find((w) => /paste listener/.test(w)) || "";
      check(
        "A changed undoManagerStackLogic and a changed window paste listener each switch their fix off with one warning, naming the file to check",
        changed3.length === 2 && /editor\/undo\.js/.test(undoWarning) && /editor\/hax-fixes\.js/.test(pasteWarning) && json(off3) === json(["hax-body undoManagerStackLogic", "hax-store _onPaste"]),
        `${changed3.length} warning(s): ${changed3.join(" | ")}; off: ${off3.join(", ") || "none"}`,
      );
      await third.exitEdit({ discard: true });
      await tab3.close();
    });
  } finally {
    // the copy's pages as they were, for the checks after this one
    for (const [file, html] of originals) writeFileSync(file, html);
  }
  return results;
}
