// Block settings (WP-13): short settings in plain words on every page,
// curated as HAX builds the form (editor/block-settings.js, hax-fixes.js
// curateSettingsForms), in a dialog that traps and returns focus and
// previews the block at its width on the page (editor/oer-settings-dialog.js).
//
// - Text (a paragraph, a heading, a list) has no Block settings button.
// - An image's form is exactly Description, Caption, Size and Position
//   (alt, caption, data-width, data-float-position), with no DDD style
//   groups, Advanced, Developer, Schema or Lock; what's changed there
//   reaches the image and the preview.
// - Columns (grid-plate) say "Keep columns side by side on phones", and
//   the preview of two columns shows them side by side at 1440.
// - Tab and Shift+Tab never leave the dialog and its form; Esc closes it
//   and focus goes back to Block settings; the page behind is inert while
//   it's open; with the command palette open, Esc closes only the palette.
//   The page's Edit HTML source gets focus back the same way. axe finds
//   nothing serious or critical in the dialog, in light and dark mode.
// - For screen readers the fields are in the dialog (it owns HAX's panel),
//   with no stray "collapse" tooltip; Position offers no Centre (nothing
//   draws it); at phone width the form fills its pane.
// - A video's form opens on a field you can see, and Tab reaches every
//   button in it (Upload.., Add item), never its upload's hidden file
//   input; its words are in sentence case, and so is the title HAX's own
//   blocks get ("True / false question settings").
// - Locking a block with the rail's Lock takes its Block settings button
//   away, and unlocking brings it back.
// - In HTML source, Tab reaches the code editor (a frame), where Tab
//   indents, and Esc there leaves it for Update HTML (unless the editor's
//   suggestions are open: Esc closes only them), so code typed there is
//   put on the page by keyboard; Update HTML closes the dialog. Closing
//   with changes not applied asks first: Keep editing goes back to the
//   code, Discard changes leaves the page as it was, and Update HTML
//   puts them on it.
// - A self check's settings leave its question and answer (its slots,
//   typed on the page) alone: a change to its title keeps them as they
//   were, every paragraph. A link in a paragraph has no Block settings.
// - HAXStore.elementList is deep-equal before and after the forms of ten
//   different blocks have been set up and the dialog opened on them.
// - After dark mode is switched on and the page reloaded (DDD registers
//   its groups again), the image's form is still the same four fields.
//
// The lesson /lessons/what-is-design is written into the copy with the
// blocks the check needs before it opens, and put back at the end.
// Nothing is saved.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

// /lessons/what-is-design, by id: a save can give it a new address
const LESSON_ID = "item-143f3783-959c-45c3-8758-dacef0f6861f";
const PAGE = `<p>An opening paragraph for the settings check.</p>
<h2>A heading</h2>
<media-image source="files/design-and-truth-book@2x.jpg" alt="A book on a table" caption="The book"></media-image>
<grid-plate layout="1-1"><p slot="col-1">The left column.</p><p slot="col-2">The right column.</p></grid-plate>
<ul><li>One</li><li>Two</li></ul>
<blockquote>A quote.</blockquote>
<video-player source="files/no-such-video.mp4" media-title="A video"></video-player>
<self-check title="Check yourself"><p slot="question">What is design?</p><p>An answer.</p><p>A second paragraph of the answer.</p></self-check>
<oer-callout type="info" title="Note"><p>Callout text.</p></oer-callout>
<hr>
<p><img src="files/design-and-truth-book@2x.jpg" alt="Photo of a book"></p>
<true-false-question question="Is design a plan?" answer></true-false-question>
<p>A closing paragraph, with <a href="https://example.com/">a link</a>.</p>
`;
const IMAGE_FIELDS = ["Description=alt", "Caption=caption", "Size=data-width", "Position=data-float-position"];

// in the page: the dialog's state at a glance
function dialogState() {
  const dlg = document.querySelector("oer-settings-dialog");
  const tray = __ec.haxStore()?.haxTray;
  const form = tray?.shadowRoot?.querySelector("#settingsform");
  const visible = (el) => __ec.visible(el);
  const fields = __ec.all("simple-fields-field", tray?.shadowRoot || document).filter(visible);
  return {
    mode: dlg?.mode ?? null,
    title: dlg?.shadowRoot?.querySelector("h2")?.textContent.trim() ?? null,
    fields: fields.map((f) => `${f.label}=${String(f.name || f.id).replace(/^settings\.\w+\./, "")}`),
    // the form's groups that show: HAX's Configure / Advanced / Developer, and DDD's
    groups: __ec.all("a11y-collapse", tray?.shadowRoot || document).filter(visible).map((c) => c.id || c.heading),
    // every label, legend and group heading that shows, through shadow roots
    words: __ec
      .all("[part='label'], [part='fieldset-legend'], legend, a11y-collapse", tray?.shadowRoot || document)
      .filter(visible)
      .map((el) => (el.localName === "a11y-collapse" ? el.heading || "" : el.textContent).replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .join(" | "),
    hasForm: !!form,
  };
}

// in the page: the active element, and whether it's in the dialog or its form
function focusIn() {
  const el = __ec.activeElement();
  const dlg = document.querySelector("oer-settings-dialog");
  const tray = __ec.haxStore()?.haxTray;
  const r = el?.getBoundingClientRect();
  return {
    where: __ec.describe(el)?.path ?? null,
    name: el ? __ec.name(el).slice(0, 40) : null,
    inside: !!el && ((dlg && __ec.within(el, dlg)) || (tray && __ec.within(el, tray))),
    size: r ? `${Math.round(r.width)}x${Math.round(r.height)}` : null,
    seen: !!r && r.width > 4 && r.height > 4 && el.getAttribute("aria-hidden") !== "true",
  };
}

export default async function settings(ctx) {
  const { page } = ctx;
  const results = [];
  const check = (name, pass, detail = "") => results.push({ name, pass: !!pass, detail });
  // (leaving a page mid-edit asks the browser's question)
  page.on("dialog", (d) => d.accept().catch(() => {}));
  const json = (v) => JSON.stringify(v);
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
  const LESSON = `/${items.find((i) => i.id === LESSON_ID).slug}`;
  const file = path.join(ctx.siteDir, "pages", LESSON_ID, "index.html");
  const original = readFileSync(file, "utf8");

  const state = () => page.evaluate(dialogState);
  const where = () => page.evaluate(focusIn);
  const activeTag = () => page.evaluate(() => __ec.haxStore().activeNode?.localName ?? null);
  // a block selected by a click on it (scrolled to the middle first)
  const clickBlock = async (selector) => {
    const el = await page.evaluateHandle((s) => __ec.haxBody().querySelector(s), selector);
    await el.evaluate((e) => e.scrollIntoView({ block: "center" }));
    await ctx.frames();
    await ctx.clickAt(el, { covered: true });
    await ctx.sleep(500);
  };
  // a block selected as a whole, as the frame's breadcrumb does for columns
  // (HAX's active block alone follows the caret back into a field: editor-state.js)
  const activate = async (selector) => {
    await page.evaluate((s) => {
      const el = __ec.haxBody().querySelector(s);
      el.scrollIntoView({ block: "center" });
      globalThis.OerEditor.ops.select(el);
    }, selector);
    await ctx.sleep(700);
  };
  const settingsButton = () => ctx.control("Block settings");
  // the settings dialog asked to open from code, for the active block
  const openFromCode = () =>
    page.evaluate(() => {
      // (made as settingsDialog() makes it, if nothing has opened it yet)
      let dlg = document.querySelector("oer-settings-dialog");
      if (!dlg) {
        dlg = document.createElement("oer-settings-dialog");
        const stage = document.createElement("div");
        stage.slot = "preview";
        dlg.append(stage);
        document.body.append(dlg);
      }
      return { open: dlg.open("settings"), mode: dlg.mode ?? null };
    });
  const openSettings = async () => {
    const button = await settingsButton();
    if (!button) throw new Error(`No Block settings button for the ${await activeTag()}`);
    await ctx.clickAt(button);
    await ctx.waitFor(() => document.querySelector("oer-settings-dialog")?.mode === "settings", { what: "the settings dialog" });
    // (it focuses its first field once the form has drawn)
    await ctx.sleep(600);
  };
  // a command in one of the rail's menus (cat: the menu's name), by clicks
  const railItem = async (cat, label) => {
    const button = await page.evaluateHandle((cat) => document.querySelector("oer-block-rail")?.shadowRoot.querySelector(`.rail button[aria-label="${cat}"]`) || null, cat);
    if (!button.asElement()) throw new Error(`The rail has no ${cat} menu`);
    await ctx.clickAt(button);
    await ctx.sleep(200);
    const item = await page.evaluateHandle(
      (source, flags) => [...document.querySelector("oer-block-rail").shadowRoot.querySelectorAll(".menu [role^=menuitem]")].find((b) => new RegExp(source, flags).test(b.querySelector(".text")?.textContent.trim() || "")) || null,
      label.source,
      label.flags,
    );
    if (!item.asElement()) throw new Error(`The rail's ${cat} menu has no ${label}`);
    await ctx.clickAt(item);
    await ctx.sleep(400);
  };
  // the HTML source dialog, and whether the code editor's suggestions show
  const sourceState = () =>
    page.evaluate(() => {
      const frame = __ec.all("iframe", __ec.haxStore().haxTray.shadowRoot)[0];
      return { mode: document.querySelector("oer-settings-dialog")?.mode ?? null, suggestions: !!frame?.contentWindow?.document.querySelector(".suggest-widget.visible") };
    });
  // the question asked before closing with changes not applied, if it's open
  const question = () =>
    page.evaluate(() => {
      const dialog = document.querySelector("oer-confirm")?.shadowRoot.querySelector("dialog");
      if (!dialog?.open) return null;
      return { title: dialog.querySelector("h2")?.textContent.trim(), actions: [...dialog.querySelectorAll("footer button")].map((b) => b.textContent.trim()) };
    });
  const answer = async (label) => {
    const button = await page.evaluateHandle((label) => [...(document.querySelector("oer-confirm")?.shadowRoot.querySelectorAll("footer button") || [])].find((b) => b.textContent.trim() === label) || null, label);
    if (!button.asElement()) throw new Error(`The question has no ${label}`);
    await ctx.clickAt(button);
    await ctx.sleep(600);
  };
  const bodyHas = (text) => page.evaluate((text) => __ec.haxBody().innerHTML.includes(text), text);
  // a line typed at the end of the code, with focus in the code editor
  const typeCode = async (line) => {
    await ctx.press("Mod+End");
    await ctx.press("Enter");
    await page.keyboard.type(line);
    await ctx.sleep(300);
  };
  const openSource = async () => {
    const button = await ctx.control("Edit HTML source");
    if (!button) throw new Error("No Edit HTML source button");
    await ctx.clickAt(button);
    await ctx.waitFor(() => document.querySelector("oer-settings-dialog")?.mode === "source", { what: "the HTML source dialog" });
    // (the code editor loads in its frame)
    await ctx.sleep(1200);
  };
  const begin = async () => {
    await ctx.setViewport(1440);
    await ctx.open(LESSON);
    await ctx.enterEdit();
    await ctx.sleep(500);
  };

  writeFileSync(file, PAGE);
  try {
    await part("text", async () => {
      await begin();
      for (const [selector, what] of [
        ["hax-body > p", "A paragraph"],
        ["hax-body > h2", "A heading"],
        ["hax-body > ul > li", "A list"],
      ]) {
        await clickBlock(selector);
        const button = await settingsButton();
        check(`${what} shows no Block settings button`, !button, `active: ${await activeTag()}; button ${button ? "shown" : "not shown"}`);
      }
      // nor does the dialog open for it when asked from code
      const opened = await openFromCode();
      check("…and the settings dialog doesn't open for it", opened.open === false && !opened.mode, json(opened));
      await ctx.exitEdit({ discard: true });
    });

    await part("image", async () => {
      await begin();
      await clickBlock("media-image");
      await openSettings();
      const s = await state();
      check("An image's form shows exactly description, caption, size and position", json(s.fields) === json(IMAGE_FIELDS), json(s.fields));
      check(
        "…with no Developer, Schema, Style Guide or Lock, and no DDD style groups",
        !/Developer|Schema|Style Guide|Lock|Design treatment|Box appearance|Colors|Spacing/i.test(s.words) && !s.groups.some((g) => /advanced|developer|ddd/.test(g)),
        `groups ${json(s.groups)}; words “${s.words.slice(0, 160)}”`,
      );
      check("The dialog is called Image settings", s.title === "Image settings", s.title);
      const first = await where();
      check("It opens with focus on its first field, Description", first.inside && /Description/.test(first.name), json(first));
      const inert = await page.evaluate(() => ({
        page: !!document.querySelector("haxcms-site-builder")?.inert,
        frame: !!document.querySelector("oer-block-frame")?.inert,
        tray: !!__ec.haxStore().haxTray.inert,
        palette: !!document.querySelector("super-daemon")?.inert,
      }));
      check("While it's open the page and the editor's chrome are inert, not the form or the palette", inert.page && inert.frame && !inert.tray && !inert.palette, json(inert));
      const axe = await ctx.axe({ context: { include: [["oer-settings-dialog"], ["hax-tray"]] } });
      const bad = [...axe.byImpact.critical, ...axe.byImpact.serious];
      check("axe finds nothing serious or critical in the dialog and its form", !bad.length, bad.map((r) => `${r.id} (${r.impact}) ×${r.nodes}`).join("; ") || `${axe.violations} lesser`);
      // for screen readers: the fields inside the dialog (HAX's panel is
      // elsewhere in the document), and no tooltip of Configure's
      const tree = await page.accessibility.snapshot({ interestingOnly: true });
      const nodes = (n) => [n, ...(n?.children || []).flatMap(nodes)];
      const dialog = nodes(tree).find((n) => n.role === "dialog");
      const inDialog = dialog ? nodes(dialog).filter((n) => /textbox|combobox/.test(n.role)).map((n) => n.name) : [];
      check("For screen readers the fields are in the dialog, called Image settings", dialog?.name === "Image settings" && json(inDialog) === json(["Description", "Caption", "Size", "Position"]), `dialog ${json(dialog?.name ?? null)} holding ${json(inDialog)}`);
      const tooltips = nodes(tree).filter((n) => n.role === "tooltip").map((n) => n.name);
      check("…with no stray tooltip (Configure's “collapse”) before them", !tooltips.length, json(tooltips));
      const positions = await page.evaluate(() => [...(__ec.all("simple-fields-field", __ec.haxStore().haxTray.shadowRoot).find((f) => /data-float-position/.test(f.name))?.shadowRoot.querySelectorAll("option") || [])].map((o) => o.textContent.trim()));
      check("Position offers Default, Left and Right (no Centre: nothing draws it)", json(positions) === json(["Default", "Left", "Right"]), json(positions));

      // what's changed in the form reaches the image and the preview: a
      // caption typed, and Size (DDD's data-width, a field block-settings.js defines)
      await ctx.press("Tab");
      await ctx.press("End");
      await ctx.type(" cover");
      const select = await page.evaluateHandle(() => __ec.all("simple-fields-field", __ec.haxStore().haxTray.shadowRoot).find((f) => /data-width/.test(f.name))?.shadowRoot.querySelector("select") || null);
      if (!select.asElement()) throw new Error("No Size field");
      await select.select("50");
      await ctx.sleep(900);
      const changed = await page.evaluate(() => {
        const image = __ec.haxBody().querySelector("media-image");
        const copy = document.querySelector("oer-settings-dialog [slot=preview] media-image");
        return { caption: image.getAttribute("caption"), size: image.getAttribute("data-width"), preview: copy && [copy.getAttribute("caption"), copy.getAttribute("data-width")] };
      });
      check(
        "A caption typed and Size → Half reach the image (data-width 50), and the preview follows",
        changed.caption === "The book cover" && changed.size === "50" && json(changed.preview) === json(["The book cover", "50"]),
        json(changed),
      );
      await ctx.press("Escape");
      await ctx.sleep(400);
      const back = await where();
      check("Esc closes it and focus goes back to Block settings", !(await state()).mode && /Block settings/.test(back.name), json(back));
      const released = await page.evaluate(() => [...document.body.children].filter((el) => el.inert).map((el) => el.localName));
      check("…and nothing stays inert but HAX's hidden editor bar", released.every((t) => t === "haxcms-site-editor-ui"), json(released));
      await ctx.exitEdit({ discard: true });
    });

    await part("focus", async () => {
      await begin();
      await clickBlock("media-image");
      await openSettings();
      const forward = [];
      for (let i = 0; i < IMAGE_FIELDS.length + 3; i++) {
        await ctx.press("Tab");
        await ctx.sleep(60);
        forward.push(await where());
      }
      check("Tab never leaves the dialog and its form", forward.every((f) => f.inside), json(forward.map((f) => f.name || f.where)));
      check("…and goes round them: the fields, then Close, then the fields again", forward.some((f) => f.name === "Close") && new Set(forward.map((f) => f.name)).size >= IMAGE_FIELDS.length, json(forward.map((f) => f.name)));
      const backward = [];
      for (let i = 0; i < IMAGE_FIELDS.length + 3; i++) {
        await ctx.press("Shift+Tab");
        await ctx.sleep(60);
        backward.push(await where());
      }
      check("Shift+Tab never leaves them either", backward.every((f) => f.inside), json(backward.map((f) => f.name || f.where)));
      // a click on the page behind closes it too, and gives focus back
      await ctx.clickAt({ x: 30, y: 450 });
      await ctx.sleep(400);
      const after = await where();
      check("A click outside closes it and focus goes back to Block settings", !(await state()).mode && /Block settings/.test(after.name), json(after));
      await ctx.exitEdit({ discard: true });
    });

    await part("palette", async () => {
      await begin();
      await clickBlock("media-image");
      await openSettings();
      // the command palette over the dialog (as a field's media search opens it)
      await page.evaluate(() => {
        const daemon = globalThis.SuperDaemonManager.requestAvailability();
        daemon.runProgram("", "*");
        daemon.mini = false;
        daemon.wand = false;
        daemon.open();
      });
      await ctx.waitFor(() => globalThis.SuperDaemonManager.requestAvailability().opened, { what: "the command palette" });
      await ctx.sleep(500);
      await ctx.press("Escape");
      await ctx.sleep(600);
      const once = await page.evaluate(() => ({ palette: !!globalThis.SuperDaemonManager.requestAvailability().opened, dialog: document.querySelector("oer-settings-dialog")?.mode ?? null }));
      const focus = await where();
      check("With the command palette open, Esc closes only the palette", !once.palette && once.dialog === "settings", `${json(once)}; focus ${json(focus)}`);
      check("…and focus is back in the dialog", focus.inside, json(focus));
      await ctx.press("Escape");
      await ctx.sleep(400);
      const twice = await where();
      check("A second Esc closes the dialog, focus back on Block settings", !(await state()).mode && /Block settings/.test(twice.name), json(twice));
      await ctx.exitEdit({ discard: true });
    });

    await part("columns", async () => {
      await begin();
      await activate("grid-plate");
      await openSettings();
      const s = await state();
      check("A grid-plate's form shows ‘Keep columns side by side on phones’", s.fields.some((f) => f.startsWith("Keep columns side by side on phones=")), json(s.fields));
      const preview = await page.evaluate(() => {
        const stage = document.querySelector("oer-settings-dialog [slot=preview]");
        const grid = stage?.querySelector("grid-plate");
        const cols = [...(grid?.shadowRoot?.querySelectorAll("#col1, #col2") || [])].map((c) => {
          const r = c.getBoundingClientRect();
          return { top: Math.round(r.top), left: Math.round(r.left), width: Math.round(r.width) };
        });
        return { cols, container: getComputedStyle(stage).containerType, width: stage.style.width, page: Math.round(__ec.haxBody().querySelector("grid-plate").getBoundingClientRect().width) };
      });
      const [a, b] = preview.cols;
      check(
        "The preview of two columns shows them side by side at 1440",
        a && b && a.width > 0 && b.width > 0 && Math.abs(a.top - b.top) <= 2 && b.left >= a.left + a.width - 2,
        json(preview),
      );
      check("…in a container (inline-size) as wide as the block on the page", preview.container === "inline-size" && preview.width === `${preview.page}px`, json(preview));
      await ctx.screenshot("columns-settings");
      await ctx.press("Escape");
      await ctx.sleep(300);
      await ctx.exitEdit({ discard: true });
    });

    await part("video", async () => {
      await begin();
      await activate("video-player");
      await openSettings();
      const first = await where();
      check("A video's settings open on a field you can see, not its upload's hidden file input", first.inside && first.seen && !!first.name, json(first));
      // round the form to Close: every stop seen and named
      const stops = [];
      for (let i = 0; i < 24; i++) {
        await ctx.press("Tab");
        await ctx.sleep(60);
        const f = await where();
        stops.push(f);
        if (f.name === "Close") break;
      }
      const names = stops.map((f) => f.name);
      check(
        "Tab reaches every button in its form (Select media.., Upload.., Add item), and only what's seen and named",
        ["Select media..", "Upload..", "Add item"].every((n) => names.includes(n)) && stops.every((f) => f.inside && f.seen && f.name),
        json(stops.map((f) => (f.seen && f.name ? f.name : `${f.where} ${f.size}`))),
      );
      const words = await page.evaluate(() => __ec.all("simple-toolbar-button", __ec.haxStore().haxTray.shadowRoot).filter((b) => __ec.visible(b)).map((b) => b.label));
      check("…its words in sentence case (Expand all, Add item)", words.includes("Expand all") && words.includes("Add item") && !words.some((w) => /\b(All|Item)\b/.test(w)), json(words));
      const axe = await ctx.axe({ context: { include: [["oer-settings-dialog"], ["hax-tray"]] } });
      const bad = [...axe.byImpact.critical, ...axe.byImpact.serious];
      check("axe finds nothing serious or critical in a video's settings", !bad.length, bad.map((r) => `${r.id} (${r.impact}) ×${r.nodes}`).join("; ") || `${axe.violations} lesser`);
      await ctx.press("Escape");
      await ctx.sleep(300);
      // a block of HAX's own: its title in sentence case
      await activate("true-false-question");
      await openSettings();
      const { title } = await state();
      check("A HAX block's settings are titled in sentence case (True / false question settings)", title === "True / false question settings", title);
      await ctx.press("Escape");
      await ctx.sleep(300);
      await ctx.exitEdit({ discard: true });
    });

    await part("lock", async () => {
      await begin();
      await clickBlock("media-image");
      const image = () => page.evaluate(() => __ec.haxBody().querySelector("media-image").hasAttribute("data-hax-lock"));
      const before = !!(await settingsButton());
      await railItem("Block", /^lock/i);
      const locked = await image();
      const during = !!(await settingsButton());
      await railItem("Block", /^unlock/i);
      const unlocked = !(await image());
      const after = !!(await settingsButton());
      check("Locking a block (the rail's Lock) takes its Block settings button away, and unlocking brings it back", before && locked && !during && unlocked && after, json({ before, locked, during, unlocked, after }));
      await ctx.exitEdit({ discard: true });
    });

    await part("phone", async () => {
      await ctx.setViewport(390);
      await ctx.open(LESSON);
      await ctx.enterEdit();
      await ctx.sleep(500);
      await clickBlock("media-image");
      await openSettings();
      const m = await page.evaluate(() => {
        const tray = __ec.haxStore().haxTray;
        const box = (el) => {
          const r = el?.getBoundingClientRect();
          return r ? { left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) } : null;
        };
        const description = __ec.all("simple-fields-field", tray.shadowRoot).find((f) => /\.alt$/.test(f.name));
        return { tray: box(tray), detail: box(tray.shadowRoot.querySelector("#tray-detail")), input: box(description?.shadowRoot.querySelector("input")) };
      });
      check("At phone width the form fills its pane: its fields run to within 3rem of the right edge", !!m.input && m.detail.width >= m.tray.width - 1 && m.input.right >= m.tray.right - 48, json(m));
      await ctx.screenshot("image-settings-390");
      await ctx.press("Escape");
      await ctx.sleep(300);
      await ctx.exitEdit({ discard: true });
    });

    await part("block list", async () => {
      await begin();
      // the whole list, written out: functions and elements by name, a
      // reference back to an object it's inside of as a cycle. Left out:
      // each entry's `element`, where HAX notes the last block of that kind
      // a click selected (hax-body.js positionContextMenus 2941, on any
      // page, with or without a form; nothing reads it)
      const snapshot = () =>
        page.evaluate(() => {
          const write = (v, inside) => {
            if (typeof v === "function") return `fn:${v.name}`;
            if (v === undefined) return "undefined";
            if (!v || typeof v !== "object") return JSON.stringify(v);
            if (v instanceof Node) return `<${v.nodeName}>`;
            if (inside.includes(v) || inside.length > 12) return "[…]";
            inside.push(v);
            const keys = Object.keys(v).filter((k) => !(inside.length === 2 && k === "element"));
            const out = Array.isArray(v) ? `[${v.map((x) => write(x, inside)).join(",")}]` : `{${keys.map((k) => `${JSON.stringify(k)}:${write(v[k], inside)}`).join(",")}}`;
            inside.pop();
            return out;
          };
          return write(__ec.haxStore().elementList, []);
        });
      const before = await snapshot();
      const blocks = ["hax-body > p", "hax-body > h2", "media-image", "grid-plate", "hax-body > ul", "blockquote", "video-player", "self-check", "oer-callout", "hr", "hax-body > p > img"];
      const formed = [];
      for (const selector of blocks) {
        await activate(selector);
        const tag = await activeTag();
        const button = await settingsButton();
        if (button) {
          await openSettings();
          formed.push(`${tag}: ${(await state()).fields.length} fields`);
          await ctx.press("Escape");
          await ctx.sleep(300);
        } else formed.push(`${tag}: none`);
      }
      const after = await snapshot();
      const tags = new Set(formed.map((f) => f.split(":")[0]));
      check("HAXStore.elementList is deep-equal before and after ten different blocks' forms", before === after && tags.size >= 10, `${tags.size} blocks (${formed.join("; ")}); ${before === after ? "equal" : `differs (${before.length} → ${after.length} characters)`}`);
      await ctx.exitEdit({ discard: true });
    });

    await part("edit html", async () => {
      await begin();
      const button = await ctx.control("Edit HTML source");
      if (!button) throw new Error("No Edit HTML source button");
      await ctx.clickAt(button);
      await ctx.waitFor(() => document.querySelector("oer-settings-dialog")?.mode === "source", { what: "the HTML source dialog" });
      await ctx.sleep(500);
      await ctx.press("Escape");
      await ctx.sleep(400);
      const back = await where();
      check("Edit HTML source gets focus back when its dialog closes with Esc", !(await state()).mode && /Edit HTML source/.test(back.name), json(back));

      // the code editor, a frame: Tab from the toolbar reaches it, where
      // Tab indents and Esc leaves it for Update HTML
      await openSource();
      await ctx.press("Tab");
      await ctx.sleep(200);
      const tabbed = await where();
      check("In HTML source, Tab from its toolbar reaches the code editor", tabbed.inside && /› iframe$/.test(tabbed.where) && tabbed.name === "Code editor", json(tabbed));
      await ctx.press("Escape");
      await ctx.sleep(400);
      const left = await where();
      check("…and Esc there leaves it for Update HTML, the dialog still open", (await sourceState()).mode === "source" && left.name === "Update HTML", json(left));
      await ctx.press("Escape");
      await ctx.sleep(400);
      const closed = await where();
      check("…where Esc closes it (nothing changed), focus back on Edit HTML source", !(await sourceState()).mode && !(await question()) && /Edit HTML source/.test(closed.name), json(closed));
      // Shift+Tab goes round from Close to it too; there, with the
      // editor's suggestions open, Esc closes only them
      await openSource();
      await ctx.press("Shift+Tab");
      await ctx.sleep(100);
      await ctx.press("Shift+Tab");
      await ctx.sleep(200);
      const round = await where();
      check("Shift+Tab goes round from Close to the code editor", /› iframe$/.test(round.where), json(round));
      await page.keyboard.down("Control");
      await page.keyboard.press("Space");
      await page.keyboard.up("Control");
      await ctx.sleep(800);
      const suggesting = await sourceState();
      await ctx.press("Escape");
      await ctx.sleep(400);
      const once = await sourceState();
      const stayed = await where();
      check("With the code editor's suggestions open, Esc closes only them", suggesting.suggestions && !once.suggestions && once.mode === "source" && /› iframe$/.test(stayed.where), json({ suggesting, once, focus: stayed.where }));
      await ctx.press("Escape");
      await ctx.sleep(400);
      const twice = await where();
      check("…and a second Esc leaves the editor for Update HTML", (await sourceState()).mode === "source" && twice.name === "Update HTML", json(twice));
      await ctx.press("Escape");
      await ctx.sleep(400);

      // code typed there goes on the page by keyboard: Esc, then Enter on Update HTML
      await openSource();
      await ctx.press("Tab");
      await ctx.sleep(200);
      await typeCode("<p>Typed in source.</p>");
      await ctx.press("Escape");
      await ctx.sleep(400);
      const toUpdate = await where();
      await ctx.press("Enter");
      await ctx.sleep(1200);
      const applied = await where();
      check(
        "Code typed in HTML source goes on the page by keyboard (Esc, Enter on Update HTML), which closes the dialog, focus back on Edit HTML source",
        toUpdate.name === "Update HTML" && (await bodyHas("Typed in source.")) && !(await sourceState()).mode && /Edit HTML source/.test(applied.name),
        json({ esc: toUpdate.name, after: applied.name, mode: (await sourceState()).mode }),
      );

      // closing with changes not applied asks first
      await openSource();
      await ctx.press("Tab");
      await ctx.sleep(200);
      await typeCode("<p>Not applied yet.</p>");
      await ctx.press("Escape");
      await ctx.sleep(300);
      await ctx.press("Escape");
      await ctx.sleep(600);
      const asked = await question();
      const onKeep = await where();
      check(
        "Closing HTML source with changes not applied asks first: Keep editing, Discard changes or Update HTML",
        asked?.title === "Discard your HTML changes?" && json(asked.actions) === json(["Keep editing", "Discard changes", "Update HTML"]) && (await sourceState()).mode === "source",
        json(asked),
      );
      check("…with focus on Keep editing", onKeep.name === "Keep editing", json(onKeep));
      await ctx.press("Escape");
      await ctx.sleep(600);
      const kept = await where();
      const keptCode = await page.evaluate(() => __ec.haxStore().haxTray.shadowRoot.querySelector("#view-source").shadowRoot.querySelector("#textarea").value.includes("Not applied yet."));
      check("Esc there keeps editing: the dialog stays open, focus back in the code, the change still in it", !(await question()) && (await sourceState()).mode === "source" && /› iframe$/.test(kept.where) && keptCode, json({ focus: kept.where, keptCode }));
      await ctx.press("Escape");
      await ctx.sleep(300);
      await ctx.press("Escape");
      await ctx.sleep(600);
      await answer("Discard changes");
      const discarded = await where();
      check("Discard changes closes it and leaves the page as it was, focus back on Edit HTML source", !(await sourceState()).mode && !(await bodyHas("Not applied yet.")) && /Edit HTML source/.test(discarded.name), json(discarded));
      // Close (a click) with changes, then Update HTML in the question
      await openSource();
      await ctx.press("Tab");
      await ctx.sleep(200);
      await typeCode("<p>Applied on closing.</p>");
      const close = await page.evaluateHandle(() => document.querySelector("oer-settings-dialog").shadowRoot.querySelector(".close"));
      await ctx.clickAt(close);
      await ctx.sleep(600);
      const askedAgain = !!(await question());
      await answer("Update HTML");
      await ctx.sleep(600);
      const updated = await where();
      check("Close with changes asks too, and its Update HTML puts them on the page, focus back on Edit HTML source", askedAgain && (await bodyHas("Applied on closing.")) && !(await sourceState()).mode && /Edit HTML source/.test(updated.name), json({ askedAgain, focus: updated.name }));
      await ctx.exitEdit({ discard: true });
    });

    await part("self check", async () => {
      await begin();
      await activate("self-check");
      // (into view again: the page was still settling the first time)
      await page.evaluate(() => __ec.haxBody().querySelector("self-check").scrollIntoView({ block: "center" }));
      await ctx.sleep(400);
      await openSettings();
      const s = await state();
      check("A self check's form leaves out its question and answer (typed on the page)", s.fields.length > 0 && !s.fields.some((f) => /^(Question|Answer)=/.test(f)), json(s.fields));
      const content = () => page.evaluate(async () => (await __ec.haxStore().nodeToContent(__ec.haxBody().querySelector("self-check"))).replace(/\s+/g, " "));
      const before = await content();
      // its first field, Title
      await ctx.press("End");
      await ctx.type(" Explain.");
      await ctx.sleep(1200);
      const after = await content();
      const slots = (html) => html.replace(/^<self-check[^>]*>/, "").replace(/<\/self-check>\s*$/, "").trim();
      check(
        "A change to its title keeps its question and every paragraph of its answer as they were",
        /title="Check yourself Explain\."/.test(after) && slots(after) === slots(before) && slots(after).includes('<p slot="question">What is design?</p><p>An answer.</p><p>A second paragraph of the answer.</p>'),
        slots(after),
      );
      await ctx.press("Escape");
      await ctx.sleep(300);
      await ctx.exitEdit({ discard: true });
    });

    await part("link", async () => {
      await begin();
      await clickBlock("hax-body > p > a");
      const tag = await activeTag();
      const button = await settingsButton();
      const opened = await openFromCode();
      check("A link in a paragraph has no Block settings (the text toolbar has it), nor does the dialog open for it", tag === "a" && !button && opened.open === false && !opened.mode, json({ active: tag, button: !!button, opened }));
      await ctx.exitEdit({ discard: true });
    });

    await part("dark mode", async () => {
      await begin();
      await ctx.exitEdit({ discard: true });
      const toggle = await ctx.control("Dark mode");
      if (!toggle) throw new Error("No Dark mode switch");
      await ctx.clickAt(toggle);
      await ctx.sleep(500);
      await begin();
      const dark = await page.evaluate(() => document.body.classList.contains("dark-mode"));
      await clickBlock("media-image");
      await openSettings();
      const s = await state();
      check("After switching to dark mode and reloading, the image's form is still the same four fields", dark && json(s.fields) === json(IMAGE_FIELDS), `dark ${dark}; ${json(s.fields)}`);
      const axe = await ctx.axe({ context: { include: [["oer-settings-dialog"], ["hax-tray"]] } });
      const bad = [...axe.byImpact.critical, ...axe.byImpact.serious];
      check("…and axe finds nothing serious or critical in it in dark mode", !bad.length, bad.map((r) => `${r.id} (${r.impact}) ×${r.nodes}`).join("; ") || `${axe.violations} lesser`);
      await ctx.screenshot("image-settings-dark");
      await ctx.press("Escape");
      await ctx.sleep(300);
      await ctx.exitEdit({ discard: true });
    });
  } finally {
    writeFileSync(file, original);
  }
  return results;
}
