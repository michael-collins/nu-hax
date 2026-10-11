// Popovers (WP-14): links, images and outcome icons chosen in small
// popovers where the author is working, each change one undo step
// (editor/oer-link-popover.js, editor/oer-image-popover.js,
// ui/oer-image-field.js, ui/oer-icon-picker.js, editor/ops.js).
//
// - Linking the selected word "Double" in "Double diamond" (selected with
//   the space after it) with Mod+K makes an a holding exactly "Double",
//   with the space after it outside, no empty b and no target; the
//   selection is put back for it although focus was in the popover; one
//   Undo takes the link away. Format → Link… in the rail opens the same
//   form; Remove link there unlinks as one step; Esc puts the selection
//   back as it was.
// - Link to a page: typing a word lists the site's pages with it in their
//   titles (no page's title holds "semester", so "laser" finds the DART
//   413 pages), and Enter links the first with its site-relative address.
// - A click on a link in the content doesn't leave the page: it shows the
//   bubble (Open in new tab, Edit link, Remove link); Esc puts it away.
// - On an image block, the frame's Change image… → Use an address → Done
//   sets media-image's source and alt; one Undo puts back the previous
//   source; the rail's Block ▾ has Change image… too. A figure's img takes
//   its src and alt. A new image block's popover asks for a description.
// - The hero's Change image opens the popover (no field in the hero), with
//   Upload a button the keyboard reaches; Choose from site opens with focus
//   in its search and Esc closes only it, back on Choose from site; Esc
//   closes the popover, focus back on Change image.
// - Change icon on an outcome (its tile, a button) offers 13 choices;
//   choosing one sets the icon attribute and one Undo removes it; focus
//   goes back to the tile. The rail's Outcome ▾ has Change icon….
//
// The lesson /lessons/what-is-design and the course site are written into
// the copy before they're opened, and put back at the end. Nothing is
// saved.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const SITE_ID = "item-0330a29b-7735-4ac0-afd2-e3b2a88d49e3";
const LESSON_ID = "item-143f3783-959c-45c3-8758-dacef0f6861f";

const LESSON_PAGE = `<p>Double diamond is a design process.</p>
<p>Read the <a href="https://example.com/guide">design guide</a> first.</p>
<media-image source="files/design-and-truth-book@2x.jpg" alt="A book on a table"></media-image>
<figure><img src="files/design-and-truth-book@2x.jpg" alt="Photo of a book"><figcaption>A book</figcaption></figure>
<p>A closing paragraph.</p>
`;
const SITE_PAGE = `<oer-cs-hero><p>Design it on screen, then make it real.</p></oer-cs-hero>
<oer-cs-facts></oer-cs-facts>
<oer-cs-learn><h2>What you'll be able to do</h2><oer-cs-outcome><h3>Cut with confidence</h3><p>Plan, cut and finish parts.</p></oer-cs-outcome><oer-cs-outcome><h3>Print what you model</h3><p>Slice meshes for FDM.</p></oer-cs-outcome></oer-cs-learn>
<oer-cs-closing></oer-cs-closing>
`;

export default async function popovers(ctx) {
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
  const files = {};
  for (const id of [SITE_ID, LESSON_ID]) {
    const file = path.join(ctx.siteDir, "pages", id, "index.html");
    files[id] = { file, original: readFileSync(file, "utf8") };
  }

  const handle = (fn, ...args) => page.evaluateHandle(fn, ...args);
  const html = () => page.evaluate(() => __ec.normalize(__ec.haxBody().innerHTML));
  // the first paragraph, as it would be saved
  const firstP = () => page.evaluate(() => __ec.normalize(__ec.haxBody().querySelector(":scope > p").outerHTML));
  const focusClass = () => page.evaluate(() => __ec.activeElement()?.className ?? "");
  const edit = async (id, content) => {
    if (await ctx.editMode()) await ctx.exitEdit({ discard: true });
    writeFileSync(files[id].file, content);
    await ctx.setViewport(1440);
    await ctx.open(slugOf(id));
    await ctx.enterEdit();
    await ctx.waitFor(() => globalThis.OerEditor?.state.tracking, { what: "unsaved changes to be followed", timeout: 5000 });
    await ctx.sleep(500);
  };
  // a popover's state: open, and what has focus in it
  const popover = (tag) =>
    page.evaluate((tag) => {
      const pop = document.querySelector(tag);
      const focus = __ec.activeElement();
      return { open: !!pop?.matches(":popover-open"), focusIn: !!pop && __ec.describe(focus)?.path?.includes(tag), focus: __ec.describe(focus) };
    }, tag);
  // select from start to end (offsets) in the text of a paragraph, as a person would by dragging
  const selectText = (selector, start, end) =>
    page.evaluate(
      (s, start, end) => {
        const p = __ec.haxBody().querySelector(s);
        const text = p.firstChild;
        __ec.haxBody().focus();
        p.getRootNode().getSelection().setBaseAndExtent(text, start, text, end);
      },
      selector,
      start,
      end,
    );
  const undo = async () => {
    await ctx.press("Mod+Z");
    await ctx.sleep(700);
  };

  try {
    /* ---------- a link on the selected word ---------- */

    await part("link", async () => {
      await edit(LESSON_ID, LESSON_PAGE);
      await ctx.clickAt(await handle(() => __ec.haxBody().querySelector(":scope > p")));
      await ctx.sleep(300);
      // "Double " (the space after it too, as a double-click selects on Windows)
      await selectText(":scope > p", 0, 7);
      const before = await html();
      await ctx.press("Mod+K");
      await ctx.sleep(400);
      const opened = { ...(await popover("oer-link-popover")), className: await focusClass() };
      check("Mod+K with text selected opens the link popover, with focus in its address", opened.open && opened.focusIn && opened.className === "href", json(opened));
      await ctx.type("https://example.com/double");
      await ctx.press("Enter");
      await ctx.sleep(800);
      const after = await html();
      const first = await firstP();
      check(
        "Linking “Double” in “Double diamond” makes an a holding exactly “Double”, the space after it kept outside, with no empty b and no target",
        first === '<p><a href="https://example.com/double">Double</a> diamond is a design process.</p>' && !/<b><\/b>|<b\s*\/>/.test(after),
        first,
      );
      const caret = await page.evaluate(() => {
        const sel = __ec.haxBody().getRootNode().getSelection();
        const a = __ec.haxBody().querySelector(":scope > p a");
        const between = document.createRange();
        if (a) {
          between.setStartAfter(a);
          between.setEnd(sel.anchorNode, sel.anchorOffset);
        }
        // (after the space that follows it: Chrome puts a caret at the link's edge inside it)
        return { collapsed: sel.isCollapsed, after: !!a && !a.contains(sel.anchorNode) && /^\s?$/.test(between.toString()), popover: document.querySelector("oer-link-popover").matches(":popover-open"), at: [sel.anchorNode?.nodeName, sel.anchorNode?.textContent?.slice(0, 20), sel.anchorOffset], focus: __ec.describe(__ec.activeElement())?.tag };
      });
      check("…the popover closes and the caret is after the link (outside it)", caret.collapsed && caret.after && !caret.popover, json(caret));
      await undo();
      const undone = await html();
      check("One Undo takes the link away", undone === before, await firstP());

      // Esc: the selection back as it was
      await selectText(":scope > p", 0, 6);
      await ctx.press("Mod+K");
      await ctx.sleep(400);
      await ctx.press("Escape");
      await ctx.sleep(300);
      const back = await page.evaluate(() => ({ text: __ec.haxBody().getRootNode().getSelection().toString(), open: document.querySelector("oer-link-popover").matches(":popover-open"), focus: __ec.describe(__ec.activeElement())?.tag }));
      check("Esc closes it, with the selection back as it was and nothing changed", back.text === "Double" && !back.open && back.focus === "hax-body" && (await html()) === before, json(back));

      // the rail's Format → Link…, and Remove link
      await selectText(":scope > p", 7, 14);
      await ctx.clickAt(await handle(() => document.querySelector("oer-block-rail").shadowRoot.querySelector('[data-cat="format"]')));
      await ctx.sleep(300);
      const menu = await page.evaluate(() => [...document.querySelector("oer-block-rail").shadowRoot.querySelectorAll('[role="menuitem"]')].map((m) => __ec.name(m)));
      await ctx.clickAt(await ctx.control(/^Link…/));
      await ctx.sleep(400);
      const fromRail = await popover("oer-link-popover");
      await ctx.type("example.com");
      await ctx.press("Enter");
      await ctx.sleep(800);
      const railed = await firstP();
      check(
        "Format → Link… in the rail opens the same popover, and an address typed without https:// gets it",
        menu.some((m) => /^Link…/.test(m)) && fromRail.open && railed.includes('Double <a href="https://example.com">diamond</a> is'),
        json({ menu: menu.filter((m) => /link/i.test(m)), railed }),
      );
      const linked = await html();
      await page.evaluate(() => {
        const a = __ec.haxBody().querySelector(":scope > p a");
        __ec.haxBody().focus();
        a.getRootNode().getSelection().setBaseAndExtent(a.firstChild, 2, a.firstChild, 2);
      });
      await ctx.clickAt(await handle(() => document.querySelector("oer-block-rail").shadowRoot.querySelector('[data-cat="format"]')));
      await ctx.sleep(300);
      await ctx.clickAt(await ctx.control(/^Remove link/));
      await ctx.sleep(800);
      const unlinked = await firstP();
      await undo();
      const relinked = await html();
      check("Remove link with the caret in a link unlinks it, as one undo step", unlinked === "<p>Double diamond is a design process.</p>" && relinked === linked, json({ unlinked, relinked: await firstP() }));
      await ctx.exitEdit({ discard: true });
    });

    /* ---------- a link to a page ---------- */

    await part("page link", async () => {
      await edit(LESSON_ID, LESSON_PAGE);
      await ctx.clickAt(await handle(() => __ec.haxBody().querySelector(":scope > p")));
      await selectText(":scope > p", 0, 6);
      await ctx.press("Mod+K");
      await ctx.sleep(400);
      await ctx.clickAt(await ctx.control("Link to a page"));
      await ctx.sleep(200);
      await ctx.type("laser");
      await ctx.sleep(300);
      const listed = await page.evaluate(() => {
        const root = document.querySelector("oer-link-popover").shadowRoot;
        return { options: [...root.querySelectorAll('[role="option"]')].map((o) => o.querySelector(".title").textContent), focus: __ec.describe(__ec.activeElement())?.className };
      });
      const expected = items.find((i) => i.title === listed.options[0])?.slug;
      await ctx.press("Enter");
      await ctx.sleep(800);
      const first = await firstP();
      check(
        "Typing “laser” under Link to a page lists the site's pages with it in their titles, and Enter links the first with its site-relative address",
        listed.options.length > 0 && listed.options.every((t) => /laser/i.test(t)) && !!expected && !expected.startsWith("/") && first.startsWith(`<p><a href="${expected}">Double</a> diamond`),
        json({ ...listed, first }),
      );
      await ctx.exitEdit({ discard: true });
    });

    /* ---------- the bubble ---------- */

    await part("bubble", async () => {
      await edit(LESSON_ID, LESSON_PAGE);
      const url = page.url();
      await ctx.clickAt(await handle(() => __ec.haxBody().querySelector("a")));
      await ctx.sleep(500);
      const bubble = await page.evaluate(() => {
        const pop = document.querySelector("oer-link-popover");
        return { open: pop.matches(":popover-open"), mode: pop.mode, buttons: [...pop.shadowRoot.querySelectorAll("button")].map((b) => __ec.name(b)), url: location.href };
      });
      check(
        "A click on a link in the content stays on the page and shows Open in new tab, Edit link and Remove link",
        bubble.open && bubble.mode === "bubble" && bubble.url === url && json(bubble.buttons) === json(["Open in new tab", "Edit link", "Remove link"]),
        json(bubble),
      );
      await ctx.press("Escape");
      await ctx.sleep(300);
      const gone = await page.evaluate(() => !document.querySelector("oer-link-popover").matches(":popover-open"));
      // Edit link: the form for that link
      await ctx.clickAt(await handle(() => __ec.haxBody().querySelector("a")));
      await ctx.sleep(400);
      await ctx.clickAt(await ctx.control("Edit link"));
      await ctx.sleep(400);
      const form = await page.evaluate(() => {
        const root = document.querySelector("oer-link-popover").shadowRoot;
        return { href: root.querySelector("input.href")?.value, text: root.querySelector("input.text")?.value, button: __ec.name(root.querySelector('button[type="submit"]')) };
      });
      check("Esc puts the bubble away; its Edit link opens the form for that link", gone && form.href === "https://example.com/guide" && form.text === "design guide" && form.button === "Update link", json({ gone, ...form }));
      await ctx.press("Escape");
      await ctx.exitEdit({ discard: true });
    });

    /* ---------- an image block ---------- */

    await part("image", async () => {
      await edit(LESSON_ID, LESSON_PAGE);
      const media = await handle(() => __ec.haxBody().querySelector("media-image"));
      await media.evaluate((m) => m.scrollIntoView({ block: "center" }));
      await ctx.clickAt(media);
      await ctx.sleep(500);
      const before = await html();
      const action = await handle(() => [...document.querySelector("oer-block-frame").shadowRoot.querySelectorAll(".label button")].find((b) => /Change image/.test(b.textContent)) || null);
      if (!action.asElement()) throw new Error("The frame's label has no Change image…");
      await ctx.clickAt(action);
      await ctx.sleep(400);
      const opened = await popover("oer-image-popover");
      await ctx.clickAt(await ctx.control("Use an address"));
      await ctx.sleep(200);
      const address = await popover("oer-image-popover");
      await ctx.type("files/another-picture.jpg");
      await ctx.press("Enter");
      await ctx.sleep(300);
      const described = await popover("oer-image-popover");
      // (Cmd+A doesn't select in a headless Chrome on a Mac)
      await page.evaluate(() => __ec.activeElement()?.select?.());
      await ctx.type("Another picture");
      await ctx.clickAt(await ctx.control("Done"));
      await ctx.sleep(800);
      const set = await page.evaluate(() => {
        const m = __ec.haxBody().querySelector("media-image");
        return { source: m.getAttribute("source"), alt: m.getAttribute("alt"), open: document.querySelector("oer-image-popover").matches(":popover-open"), focus: __ec.describe(__ec.activeElement())?.name };
      });
      check(
        "On an image block, the frame's Change image… → Use an address → Done sets media-image's source and alt, focus back on Change image…",
        opened.open && opened.focusIn && address.focus?.tag === "input" && described.focus?.tag === "input" && set.source === "files/another-picture.jpg" && set.alt === "Another picture" && !set.open && /Change image/.test(set.focus || ""),
        json({ opened: opened.focus?.name, address: address.focus, described: described.focus?.className, set }),
      );
      await undo();
      const undone = await page.evaluate(() => ({ source: __ec.haxBody().querySelector("media-image").getAttribute("source"), alt: __ec.haxBody().querySelector("media-image").getAttribute("alt") }));
      check("One Undo puts back the previous source and alt", undone.source === "files/design-and-truth-book@2x.jpg" && undone.alt === "A book on a table" && (await html()) === before, json(undone));

      // the rail's Block ▾, and a figure's img
      const figure = await handle(() => __ec.haxBody().querySelector("figure"));
      await figure.evaluate((f) => f.scrollIntoView({ block: "center" }));
      await ctx.clickAt(await handle(() => __ec.haxBody().querySelector("figure img")));
      await ctx.sleep(500);
      const active = await page.evaluate(() => __ec.haxStore().activeNode?.localName);
      await ctx.clickAt(await handle(() => document.querySelector("oer-block-rail").shadowRoot.querySelector('[data-cat="block"]')));
      await ctx.sleep(300);
      const inRail = await ctx.control("Change image…");
      if (inRail) await ctx.clickAt(inRail);
      await ctx.sleep(400);
      const fromRail = await popover("oer-image-popover");
      await page.evaluate(() => {
        const field = document.querySelector("oer-image-popover").shadowRoot.querySelector("oer-image-field");
        field.shadowRoot.querySelector(".alt input").value = "A book, open";
        field.shadowRoot.querySelector(".alt input").dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      });
      await ctx.clickAt(await ctx.control("Done"));
      await ctx.sleep(800);
      const img = await page.evaluate(() => __ec.haxBody().querySelector("figure img").getAttribute("alt"));
      check("The rail's Block ▾ has Change image… for a figure, which sets its img's alt", ["figure", "img"].includes(active) && !!inRail && fromRail.open && img === "A book, open", json({ active, rail: !!inRail, open: fromRail.open, img }));

      // a new image block (as WP-10 inserts one) asks for its description
      await page.evaluate(() => {
        const m = document.createElement("media-image");
        __ec.haxBody().querySelector(":scope > p:last-of-type").before(m);
        m.dispatchEvent(new CustomEvent("oer-edit-request", { bubbles: true, composed: true, detail: { action: "image", unit: m } }));
      });
      await ctx.sleep(500);
      const fresh = await page.evaluate(() => document.querySelector("oer-image-popover").shadowRoot.querySelector("h2")?.textContent);
      await ctx.clickAt(await ctx.control("Use an address"));
      await ctx.type("files/new-picture.jpg");
      await ctx.press("Enter");
      await ctx.sleep(200);
      await ctx.clickAt(await ctx.control("Done"));
      await ctx.sleep(400);
      const asked = await page.evaluate(() => {
        const pop = document.querySelector("oer-image-popover");
        return { open: pop.matches(":popover-open"), ask: pop.shadowRoot.querySelector(".ask")?.textContent, focus: __ec.describe(__ec.activeElement())?.path, source: __ec.haxBody().querySelector("media-image:not([source='files/design-and-truth-book@2x.jpg'])")?.getAttribute("source") ?? null };
      });
      check(
        "A new image block's popover asks for its description: Done without one keeps it open with focus in the description",
        fresh === "Add an image" && asked.open && /Describe the picture/.test(asked.ask || "") && /oer-image-field/.test(asked.focus || "") && !asked.source,
        json({ fresh, ...asked }),
      );
      await ctx.press("Escape");
      await ctx.exitEdit({ discard: true });
    });

    /* ---------- the hero's Change image ---------- */

    await part("hero", async () => {
      await edit(SITE_ID, SITE_PAGE);
      const button = await handle(() => __ec.haxBody().querySelector("oer-cs-hero").shadowRoot.querySelector(".change-image"));
      await button.evaluate((b) => b.scrollIntoView({ block: "center" }));
      await ctx.clickAt(button);
      await ctx.sleep(400);
      const opened = await popover("oer-image-popover");
      const inHero = await page.evaluate(() => !!__ec.haxBody().querySelector("oer-cs-hero").shadowRoot.querySelector("oer-image-field"));
      // Upload is a button the keyboard reaches
      const upload = await page.evaluate(() => {
        const f = document.querySelector("oer-image-popover").shadowRoot.querySelector("oer-image-field");
        const b = [...f.shadowRoot.querySelectorAll("button")].find((x) => /Upload/.test(x.textContent));
        return { tag: b?.localName, focused: __ec.activeElement() === b };
      });
      check("The hero's Change image opens the image popover (no field in the hero), with focus on Upload, a button", opened.open && !inHero && upload.tag === "button" && upload.focused, json({ opened, inHero, upload }));
      // Choose from site: focus in its search; Esc closes only it
      await ctx.clickAt(await ctx.control("Choose from site"));
      await ctx.sleep(600);
      const chooser = await page.evaluate(() => ({ focus: __ec.activeElement()?.getAttribute("aria-label") }));
      await ctx.press("Escape");
      await ctx.sleep(300);
      const closedChooser = await page.evaluate(() => {
        const pop = document.querySelector("oer-image-popover");
        return { open: pop.matches(":popover-open"), chooser: !!pop.shadowRoot.querySelector("oer-image-field").shadowRoot.querySelector(".chooser"), focus: __ec.name(__ec.activeElement()) };
      });
      check(
        "Choose from site opens with focus in its search; Esc closes only it, focus back on Choose from site",
        chooser.focus === "Search the site's images" && closedChooser.open && !closedChooser.chooser && closedChooser.focus === "Choose from site",
        json({ chooser, closedChooser }),
      );
      await ctx.press("Escape");
      await ctx.sleep(300);
      const closed = await page.evaluate(() => ({ open: document.querySelector("oer-image-popover").matches(":popover-open"), focus: __ec.describe(__ec.activeElement()) }));
      await ctx.sleep(500);
      const stays = await page.evaluate(() => __ec.describe(__ec.activeElement())?.name);
      check("Esc closes the hero's image popover and focus goes back to Change image (and stays)", !closed.open && /Change image/.test(closed.focus?.name || "") && /Change image/.test(stays || ""), json({ closed, stays }));
      await ctx.exitEdit({ discard: true });
    });

    /* ---------- an outcome's icon ---------- */

    await part("icon", async () => {
      await edit(SITE_ID, SITE_PAGE);
      const tile = await handle(() => __ec.haxBody().querySelector("oer-cs-outcome").shadowRoot.querySelector("button.tile"));
      if (!tile.asElement()) throw new Error("The outcome's icon is no button");
      const name = await tile.evaluate((b) => b.getAttribute("aria-label"));
      await tile.evaluate((b) => b.scrollIntoView({ block: "center" }));
      await ctx.clickAt(tile);
      await ctx.sleep(400);
      const offered = await page.evaluate(() => {
        const picker = document.querySelector("oer-icon-picker");
        return { open: picker.open, choices: [...picker.shadowRoot.querySelectorAll(".choices button")].map((b) => b.textContent.trim()), focus: __ec.name(__ec.activeElement()) };
      });
      check("Change icon on an outcome (“Change icon: Automatic”) offers 13 choices, Automatic first, with focus on the current one", name === "Change icon: Automatic" && offered.open && offered.choices.length === 13 && offered.choices[0] === "Automatic" && offered.focus === "Automatic", json({ name, ...offered }));
      await ctx.clickAt(await ctx.control("Lightbulb"));
      await ctx.sleep(700);
      const chosen = await page.evaluate(() => {
        const o = __ec.haxBody().querySelector("oer-cs-outcome");
        return { icon: o.getAttribute("icon"), label: o.shadowRoot.querySelector("button.tile").getAttribute("aria-label"), focus: __ec.name(__ec.activeElement()) };
      });
      check("Choosing Lightbulb sets the icon attribute, and focus goes back to the tile", chosen.icon === "lightbulb" && chosen.label === "Change icon: Lightbulb" && chosen.focus === "Change icon: Lightbulb", json(chosen));
      await page.evaluate(() => __ec.haxBody().querySelector("oer-cs-outcome h3").click());
      await undo();
      const undone = await page.evaluate(() => __ec.haxBody().querySelector("oer-cs-outcome").getAttribute("icon"));
      check("One Undo removes it", undone === null, String(undone));
      // the rail's Outcome ▾
      await ctx.clickAt(await handle(() => __ec.haxBody().querySelector("oer-cs-outcome h3")));
      await ctx.sleep(400);
      await ctx.clickAt(await handle(() => document.querySelector("oer-block-rail").shadowRoot.querySelector('[data-cat="item"]')));
      await ctx.sleep(300);
      const command = await ctx.control("Change icon…");
      if (command) await ctx.clickAt(command);
      await ctx.sleep(400);
      const fromRail = await page.evaluate(() => document.querySelector("oer-icon-picker").open);
      check("The rail's Outcome ▾ has Change icon…, which opens the same choices", !!command && fromRail, json({ command: !!command, fromRail }));
      await ctx.press("Escape");
      await ctx.exitEdit({ discard: true });
    });
  } finally {
    for (const { file, original } of Object.values(files)) writeFileSync(file, original);
  }
  return results;
}
