// Stopgaps (WP-03): the fixes made on the current editing model before
// any restructuring. Typing works in every empty section, Backspace and
// Delete stay inside it, Undo keeps a heading typed in place, keys in the
// editor's toolbar don't edit the content (its shortcuts still work, and
// focus comes back to the text), sections offer no settings or columns, a
// source view left open doesn't switch commands off, new blocks and
// columns start empty, links don't leave the page mid-edit, Exit asks in
// plain words, double- and triple-click select a word and a paragraph,
// images between sections keep their size, and ordinary pages still edit
// and save.
//
// The parts share a few editing sessions (opening a page and entering edit
// mode is most of the time), and each records its own failure, so one
// failing part doesn't hide the others. The sessions that save come last,
// since they change the copy.
//
// The section model (WP-07) replaced what some parts tested on the old
// one, so they test the same thing on the new: the typing boxes are gone
// (a click on an empty field itself puts the caret in it), headings are
// typed in the section's own h2 (not a heading attribute in its shadow
// DOM), What you'll learn holds outcomes (not a list), and a section is
// selected by a click on its own padding. Since WP-08 the tools and the
// questions are items too (a tool's p, a question's h3 and answer), and the
// hero's image field opens from Change image on its picture.
import path from "node:path";
import { readBaseline, newViolations } from "../lib/axe.mjs";

const SITE = "/up/dart-413";
const HUB = "/oer-courses";
const LESSON = "/lessons/what-is-design";
// what HAX adds while editing, which a saved page mustn't keep
const EDITOR_ATTRS = /\s(data-hax-[\w-]*|contenteditable|role)=/;

export default async function stopgaps(ctx) {
  const { page } = ctx;
  const results = [];
  const check = (name, pass, detail = "") => results.push({ name, pass: !!pass, detail });
  const json = (v) => JSON.stringify(v);
  // HAX asks before leaving a page it's editing; a part that stopped
  // halfway mustn't hold the next one at that question
  page.on("dialog", (d) => d.accept().catch(() => {}));
  // a part that throws fails on its own, with where it stopped
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

  /* ---------- helpers ---------- */

  // an element in the page (inside hax-body, a section, the editor chrome), as a handle
  const handle = (fn, ...args) => page.evaluateHandle(fn, ...args);
  const field = (selector) => handle((s) => __ec.haxBody().querySelector(s), selector);
  const sectionTags = () => page.evaluate(() => [...__ec.haxBody().children].map((c) => c.localName).filter((t) => t !== "page-break"));
  const outer = (selector) => page.evaluate((s) => __ec.normalize(__ec.haxBody().querySelector(s)?.outerHTML ?? "(gone)"), selector);
  // whether the caret (or the selection's start) is inside el
  const caretIn = (el) =>
    el.evaluate((f) => {
      const sel = f.getRootNode().getSelection?.() || getSelection();
      return !!sel.anchorNode && f.contains(sel.anchorNode);
    });
  // the rail: its menu's items as "Label" or "Label (off: reason)"
  const railMenu = () =>
    page.evaluate(() =>
      [...document.querySelector("oer-block-rail").shadowRoot.querySelectorAll(".menu [role^=menuitem]")].map((b) => {
        const label = b.querySelector(".text")?.textContent.trim();
        return b.getAttribute("aria-disabled") === "true" ? `${label} (off: ${b.querySelector(".end")?.textContent.trim() || "no reason"})` : label;
      }),
    );
  const openRail = async (label = "Block") => {
    const button = await handle((label) => document.querySelector("oer-block-rail").shadowRoot.querySelector(`.rail button[aria-label="${label}"]`), label);
    if (!button.asElement()) throw new Error(`The rail has no ${label} button`);
    await ctx.clickAt(button);
    await ctx.sleep(150);
    return railMenu();
  };
  const railItem = (label) =>
    handle((label) => [...document.querySelector("oer-block-rail").shadowRoot.querySelectorAll(".menu [role^=menuitem]")].find((b) => b.querySelector(".text")?.textContent.trim() === label) || null, label);
  const runRail = async (label) => {
    await openRail("Block");
    const item = await railItem(label);
    if (!item.asElement()) throw new Error(`The rail's Block menu has no ${label}`);
    await ctx.clickAt(item);
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
  // the block list below the selected block: search, and pick by name
  const insertBelow = async (query, title) => {
    await runRail("Insert block below…");
    await ctx.waitFor(() => !!document.querySelector("oer-block-inserter").shadowRoot.querySelector(".panel input"), { what: "the block list" });
    await ctx.type(query);
    await ctx.sleep(150);
    const option = await handle(
      (title) => [...document.querySelector("oer-block-inserter").shadowRoot.querySelectorAll("[role=option]")].find((o) => o.textContent.trim() === title) || null,
      title,
    );
    if (!option.asElement()) throw new Error(`The block list has no "${title}" for "${query}"`);
    await ctx.clickAt(option);
    await ctx.sleep(500);
  };
  // the course-site bar's visible buttons, by their accessible names
  const barNames = async () => {
    const list = await page.evaluateHandle(() => [...(__ec.deep("oer-course-site")?.shadowRoot?.querySelectorAll("header.bar button") || [])].filter((b) => b.checkVisibility()));
    const names = [];
    for (const b of (await list.getProperties()).values()) names.push((await page.accessibility.snapshot({ root: b.asElement(), interestingOnly: false }))?.name || "");
    return names;
  };
  const baseline = readBaseline(new URL("../axe-baseline.json", import.meta.url).pathname);
  const compareAxe = async (pagePath, view) => {
    if (!baseline) return check(`${pagePath} ${view}: no new axe violations`, false, "No WP-00 baseline yet: run the smoke check first");
    const result = await ctx.axe();
    const worse = newViolations(result, baseline.pages?.[pagePath]?.[view]);
    check(`${pagePath} ${view}: no new axe violations`, !worse.length, worse.length ? worse.join("; ") : `${result.violations} rules, ${result.nodes} nodes`);
  };
  // the middle of a paragraph's nth word (from 0), and the word
  const wordAt = (el, n) =>
    el.evaluate((p, n) => {
      const text = [...p.childNodes].find((t) => t.nodeType === 3 && t.textContent.trim().split(/\s+/).length > n);
      const m = [...text.textContent.matchAll(/\S+/g)][n];
      const r = document.createRange();
      r.setStart(text, m.index + 1);
      r.setEnd(text, m.index + 2);
      const b = r.getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2, word: m[0] };
    }, n);
  // a click on an empty field, where the section shows what goes there,
  // puts the caret in the field; typing fills it
  const typeInField = async (tag, selector, label) => {
    const el = await field(`${tag} > ${selector}`);
    if (!el.asElement()) throw new Error(`No ${tag} > ${selector}`);
    await el.evaluate((f) => f.scrollIntoView({ block: "center" }));
    await ctx.frames();
    const height = await el.evaluate((f) => f.getBoundingClientRect().height);
    await ctx.clickAt(el);
    await ctx.sleep(250);
    const inside = await caretIn(el);
    await ctx.type("Hello");
    await ctx.sleep(250);
    const text = await el.evaluate((f) => f.textContent);
    check(`${label}: clicking its empty field puts the caret in its ${selector}`, inside, `${selector} ${Math.round(height)}px tall; caret ${inside ? "inside" : `at ${json((await ctx.selection()).anchor)}`}`);
    check(`${label}: typing fills it`, text === "Hello", `“${text}”`);
  };

  /* ---------- session 1: the course site, read on a phone, then edited ---------- */

  await part("bar names", async () => {
    await ctx.setViewport(390);
    await ctx.open(SITE);
    const names = await barNames();
    check(`${SITE} at 390: every button in the course-site bar has a name`, names.length > 0 && names.every(Boolean), json(names));
    await ctx.setViewport(1440);
  });

  await part("axe", async () => {
    await ctx.open(SITE);
    await compareAxe(SITE, "reading");
    await ctx.enterEdit();
    await compareAxe(SITE, "editing");
  });

  await part("exit at once", async () => {
    await ctx.enterEdit();
    await ctx.clickAt(await ctx.control("Cancel"));
    await ctx.sleep(500);
    const quiet = await page.evaluate(() => ({ editing: !!__ec.store().editMode, dialog: !!__ec.openDialog() }));
    check("Exit with no changes leaves at once", !quiet.editing && !quiet.dialog, json(quiet));
    await ctx.enterEdit();
  });

  await part("typing", async () => {
    await typeInField("oer-cs-hero", "p", "Hero tagline");
    await typeInField("oer-cs-people", "p", "Instructor's note");
    await typeInField("oer-cs-faq oer-cs-question", "h3", "First question");
  });

  await part("edges", async () => {
    const before = await sectionTags();
    // the empty outcome: Backspace used to take the whole section; now the
    // empty outcome goes (as an empty item does), and its section and
    // heading stay
    await ctx.clickAt(await field("oer-cs-learn oer-cs-outcome > h3"));
    for (let i = 0; i < 3; i++) await ctx.press("Backspace");
    await ctx.sleep(300);
    const learn = await outer("oer-cs-learn");
    check("Backspace in an empty section keeps the section and its heading", json(await sectionTags()) === json(before) && /^<oer-cs-learn[^>]*><h2><\/h2>/.test(learn), learn.slice(0, 90));
    // the start of the tagline, and the end of the last answer
    const hero = await outer("oer-cs-hero");
    await ctx.clickAt(await field("oer-cs-hero > p"));
    await ctx.press("Home");
    await ctx.press("Backspace");
    await ctx.press("Backspace");
    await ctx.clickAt(await field("oer-cs-faq oer-cs-question:last-of-type > p:last-of-type"));
    await ctx.type("Yes");
    const faq = await outer("oer-cs-faq");
    await ctx.press("End");
    await ctx.press("Delete");
    await ctx.press("Delete");
    await ctx.sleep(300);
    const after = { sections: await sectionTags(), hero: await outer("oer-cs-hero"), faq: await outer("oer-cs-faq") };
    check(
      "Backspace at a section's start and Delete at its end change nothing",
      json(after.sections) === json(before) && after.hero === hero && after.faq === faq,
      `hero ${after.hero}; questions …${after.faq.slice(-50)}`,
    );
    // between written sections: the start of the first question, after the
    // tools, and the end of the instructor's note, before them
    await ctx.clickAt(await field("oer-cs-tools oer-cs-tool > p"));
    await ctx.type("Laser cutter");
    await ctx.sleep(300);
    const around = async () => ({ sections: await sectionTags(), people: await outer("oer-cs-people"), tools: await outer("oer-cs-tools"), faq: await outer("oer-cs-faq") });
    const typed = await around();
    await ctx.clickAt(await field("oer-cs-faq oer-cs-question > h3"));
    await ctx.press("Home");
    await ctx.press("Backspace");
    await ctx.clickAt(await field("oer-cs-people > p"));
    await ctx.press("End");
    await ctx.press("Delete");
    await ctx.press("Delete");
    await ctx.sleep(300);
    const kept = await around();
    check(
      "…nor between two written sections (Backspace at a question's start, Delete at the note's end)",
      json(kept) === json(typed),
      json(kept) === json(typed) ? `${kept.tools} ${kept.faq.slice(0, 40)}…` : `${kept.sections.join(" ")}; ${kept.tools}; ${kept.faq.slice(0, 50)}`,
    );
  });

  await part("rail keys", async () => {
    await ctx.clickAt(await field("oer-cs-hero > p"));
    await ctx.press("End");
    await ctx.type(" Design it on screen");
    await ctx.sleep(300);
    const before = await outer("oer-cs-hero");
    await ctx.press("Alt+F10");
    await ctx.sleep(100);
    const onRail = await ctx.deepActiveElement();
    await ctx.press("Enter");
    await ctx.sleep(300);
    const menu = await railMenu();
    const focus = await ctx.deepActiveElement();
    const after = await outer("oer-cs-hero");
    check("Alt+F10 then Enter on the rail opens its menu", onRail?.path === "oer-block-rail › button" && menu.length > 0, `focus on ${onRail?.name}, then ${focus?.name}; ${menu.length} items`);
    check("…and leaves the hero's HTML unchanged", after === before, after === before ? before : `${before} → ${after}`);
    // Esc closes the menu, and Esc again goes back to the text
    await ctx.press("Escape");
    await ctx.press("Escape");
    await ctx.sleep(200);
    const back = await page.evaluate(() => {
      const p = __ec.haxBody().querySelector("oer-cs-hero > p");
      const sel = p.getRootNode().getSelection?.() || getSelection();
      return { focus: __ec.describe(__ec.activeElement())?.path, caret: !!sel.anchorNode && p.contains(sel.anchorNode) };
    });
    check("…and Esc twice goes back to the hero's text", /hax-body$/.test(back.focus || "") && back.caret, json(back));
  });

  await part("sections", async () => {
    await selectSection("oer-cs-learn");
    const label = await page.evaluate(() =>
      [...document.querySelector("oer-block-frame").shadowRoot.querySelectorAll(".label button")].map((b) => b.getAttribute("aria-label") || b.textContent.trim()),
    );
    check("A selected section's label has no Block settings or Layout button", !label.some((l) => /settings|layout/i.test(l)), `buttons: ${json(label)}`);
    const menu = await openRail("Block");
    check("…and its rail menu has no Add or Remove column", !menu.some((m) => /column/i.test(m)), menu.join(", "));
    await ctx.press("Escape");
    const problems = await page.evaluate(() => {
      const list = __ec.haxStore().elementList;
      const written = ["oer-cs-hero", "oer-cs-learn", "oer-cs-people", "oer-cs-tools", "oer-cs-faq", "oer-courses-intro"];
      const generated = ["oer-cs-facts", "oer-cs-semester", "oer-cs-make", "oer-cs-books", "oer-cs-closing", "oer-courses-catalog"];
      return [...written, ...generated]
        .map((t) => {
          const p = list[t];
          const found = [
            !p && "not registered",
            p && p.hideDefaultSettings !== true && "default settings",
            p && p.designSystem !== false && "design system settings",
            /data-(margin|padding|text-align)/.test(JSON.stringify(p?.settings || {})) && "spacing fields",
            written.includes(t) && p && p.contentEditable !== true && "not contentEditable",
          ].filter(Boolean);
          return found.length ? `${t}: ${found.join(", ")}` : "";
        })
        .filter(Boolean);
    });
    check("Sections have no spacing, design or developer settings, and written ones stay editable", !problems.length, problems.join("; ") || "all 12 sections");
  });

  await part("image field", async () => {
    // (Change image opens it, until the editor's image popover answers that)
    await ctx.clickAt(await handle(() => __ec.haxBody().querySelector("oer-cs-hero").shadowRoot.querySelector(".change-image")));
    await ctx.sleep(300);
    const imageField = await handle(() => __ec.haxBody().querySelector("oer-cs-hero").shadowRoot.querySelector("oer-image-field"));
    const byAddress = await imageField.evaluateHandle((f) => [...f.shadowRoot.querySelectorAll("button")].find((b) => b.textContent.includes("Use an address")));
    await byAddress.evaluate((b) => b.scrollIntoView({ block: "center" }));
    await ctx.frames();
    await ctx.clickAt(byAddress);
    await ctx.sleep(300);
    const input = await imageField.evaluateHandle((f) => f.shadowRoot.querySelector('input[type="text"]'));
    await input.evaluate((i) => i.scrollIntoView({ block: "center" }));
    await ctx.frames();
    await ctx.clickAt(input);
    await ctx.type("files/studio.jpg");
    await ctx.sleep(300);
    const focus = await ctx.deepActiveElement();
    await ctx.press("Enter");
    await ctx.sleep(400);
    const image = await page.evaluate(() => __ec.haxBody().querySelector("oer-cs-hero").getAttribute("image"));
    check("Typing an address in the hero's image field keeps focus there and sets the image", focus?.tag === "input" && image === "files/studio.jpg", `focus on ${focus?.path} (${focus?.name}); image="${image}"`);
  });

  await part("exit", async () => {
    const saved = ctx.savedHtml(SITE);
    await ctx.clickAt(await ctx.control("Cancel"));
    await ctx.waitFor(() => !!__ec.openDialog(), { what: "the leave dialog", timeout: 5000 });
    const dialog = await page.evaluate(() => {
      const d = __ec.openDialog();
      return { title: d.querySelector("h2")?.textContent.trim(), text: d.querySelector("p")?.textContent.trim(), buttons: [...d.querySelectorAll("button")].map((b) => b.textContent.trim()), focus: __ec.describe(__ec.activeElement())?.name };
    });
    check("Exit with changes opens a dialog whose buttons read Keep editing and Discard changes", json(dialog.buttons) === json(["Keep editing", "Discard changes"]), `${dialog.title} ${dialog.text} ${json(dialog.buttons)}, focus on ${dialog.focus}`);
    await ctx.clickAt(await ctx.control("Keep editing"));
    await ctx.sleep(300);
    const kept = await page.evaluate(() => ({ editing: !!__ec.store().editMode, dialog: !!__ec.openDialog(), text: __ec.haxBody().querySelector("oer-cs-hero > p")?.textContent, focus: __ec.describe(__ec.activeElement())?.name }));
    check("Keep editing stays in the editor with the changes, focus back on Cancel", kept.editing && !kept.dialog && kept.text === "Hello Design it on screen" && kept.focus === "Cancel", json(kept));
    // HAX's own shortcut for leaving (Ctrl+Shift+/) asks the same question,
    // pressed on the rail (which keeps other keys from the content)
    await ctx.clickAt(await field("oer-cs-hero > p"));
    await ctx.press("Alt+F10");
    await ctx.press("Control+Shift+Slash");
    await ctx.waitFor(() => !!__ec.openDialog(), { what: "the leave dialog from the shortcut", timeout: 5000 });
    const asked = await page.evaluate(() => __ec.openDialog().getRootNode().host?.localName ?? __ec.openDialog().localName);
    check("HAX's own Exit shortcut asks the same question, also from the rail", asked === "oer-confirm", `the dialog is in ${asked}`);
    await ctx.clickAt(await ctx.control("Discard changes"));
    await ctx.waitForReading();
    const tagline = await page.evaluate(() => __ec.theme().querySelector("oer-cs-hero")?.textContent.trim());
    check("Discard changes leaves without saving", ctx.savedHtml(SITE) === saved && !(await ctx.editMode()) && !tagline, `the saved page is ${ctx.savedHtml(SITE) === saved ? "unchanged" : "changed"}; the reading view's tagline “${tagline}”`);
  });

  /* ---------- session 2: the course site: Undo, Edit HTML, new blocks ---------- */

  await part("undo", async () => {
    await ctx.open(SITE);
    await ctx.enterEdit();
    // the section's own heading, empty (it shows the default under it)
    const heading = await field("oer-cs-tools > h2");
    await ctx.clickAt(heading);
    await ctx.sleep(300);
    await ctx.type("In the shop");
    // HAX records an undo step 300 ms after the last change
    await ctx.sleep(700);
    const typed = await page.evaluate(() => __ec.haxBody().querySelector("oer-cs-tools > h2").textContent);
    const order = await sectionTags();
    await selectSection("oer-cs-tools");
    await runRail("Move up");
    await ctx.sleep(700);
    const moved = await sectionTags();
    await ctx.clickAt(await ctx.control("Undo"));
    await ctx.sleep(700);
    const undone = await sectionTags();
    const tools = await page.evaluate(() => {
      const el = __ec.haxBody().querySelector("oer-cs-tools");
      const slot = el.shadowRoot.querySelector('slot[name="heading"]');
      return { text: el.querySelector(":scope > h2")?.textContent, shown: slot?.assignedElements()[0]?.textContent.trim() ?? null };
    });
    check("The tools heading typed in place is kept in its h2", typed === "In the shop", `<h2>${typed}</h2>`);
    check("Move up moves the tools section", moved.indexOf("oer-cs-tools") === order.indexOf("oer-cs-tools") - 1, moved.join(" "));
    check("One Undo restores the order and keeps the typed heading", json(undone) === json(order) && tools.text === "In the shop" && tools.shown === "In the shop", `${undone.join(" ")}; <h2>${tools.text}</h2>, shown “${tools.shown}”`);
    // the hero's image is an attribute too, so Undo keeps it
    await page.evaluate(() => {
      const hero = __ec.haxBody().querySelector("oer-cs-hero");
      hero.image = "/files/studio.jpg";
      hero.alt = "Students at the laser cutter";
    });
    await ctx.sleep(700);
    await ctx.clickAt(await field("oer-cs-hero > p"));
    await ctx.type("Make it real");
    await ctx.sleep(700);
    await ctx.clickAt(await ctx.control("Undo"));
    await ctx.sleep(700);
    const hero = await page.evaluate(() => {
      const el = __ec.haxBody().querySelector("oer-cs-hero");
      return { image: el.getAttribute("image"), alt: el.getAttribute("alt"), text: el.textContent.trim() };
    });
    check("Undo after changing the hero image keeps the image and its description", hero.image === "/files/studio.jpg" && hero.alt === "Students at the laser cutter" && !hero.text, json(hero));
  });

  await part("triple-click in a section", async () => {
    // Chrome's own paragraph selection here held no text, and typing added
    // a coloured <font> before the old words
    const tagline = await field("oer-cs-hero > p");
    await ctx.clickAt(tagline);
    await ctx.type("Tagline words here");
    await ctx.sleep(300);
    await ctx.clickAt(await wordAt(tagline, 1), { clickCount: 3 });
    await ctx.sleep(300);
    const selected = (await ctx.selectionText()).trim();
    await ctx.type("Make it real");
    await ctx.sleep(300);
    const hero = await page.evaluate(() => __ec.normalize(__ec.haxBody().querySelector("oer-cs-hero").innerHTML).trim());
    check("Triple-clicking the hero's tagline selects it, and typing replaces it", selected === "Tagline words here" && hero === "<p>Make it real</p>", `selected “${selected}”; then ${hero}`);
  });

  await part("heading tab", async () => {
    // Tab soon after clicking a heading: the heading used to take focus
    // back; now it goes on to the next field
    const heading = await field("oer-cs-tools > h2");
    await heading.evaluate((h) => h.scrollIntoView({ block: "center" }));
    await ctx.frames();
    await ctx.clickAt(await heading.evaluate((h) => {
      const range = document.createRange();
      range.selectNodeContents(h);
      const r = range.getBoundingClientRect();
      return { x: r.right - 2, y: r.top + r.height / 2 };
    }));
    await ctx.sleep(300);
    await ctx.type(" here", { delay: 60 });
    await ctx.press("Tab");
    await ctx.sleep(400);
    const on = await caretIn(await field("oer-cs-tools oer-cs-tool > p"));
    const kept = await page.evaluate(() => __ec.haxBody().querySelector("oer-cs-tools > h2").textContent);
    check("Tab from a heading just clicked moves on to the next field, and keeps the heading", on && kept === "In the shop here", `caret ${on ? "in the first tool" : `at ${json((await ctx.selection()).anchor)}`}; <h2>${kept}</h2>`);
  });

  await part("insert from a section", async () => {
    await ctx.clickAt(await field("oer-cs-hero > p"));
    await ctx.sleep(250);
    await runRail("Insert block below…");
    await ctx.sleep(300);
    const list = await page.evaluate(() => {
      const inserter = document.querySelector("oer-block-inserter");
      const slot = inserter._open?.slot;
      return { open: !!inserter.shadowRoot.querySelector(".panel input"), after: slot?.after?.localName ?? null, focus: __ec.describe(__ec.activeElement())?.path };
    });
    check("Insert block below… from text in the hero opens the block list below the hero", list.open && list.after === "oer-cs-hero", json(list));
    await ctx.press("Escape");
  });

  await part("content links", async () => {
    // a link drawn by a section (a week's page in the semester)
    const link = await handle(() => __ec.haxBody().querySelector("oer-cs-semester").shadowRoot.querySelector("a[href]"));
    if (!link.asElement()) throw new Error("The semester shows no links");
    await link.evaluate((a) => a.scrollIntoView({ block: "center" }));
    await ctx.frames();
    const href = await link.evaluate((a) => a.href);
    await ctx.clickAt(link);
    await ctx.sleep(800);
    const stayed = await page.evaluate(() => ({ path: location.pathname, editing: !!__ec.store().editMode }));
    check("Clicking a link in the content while editing stays on the page, still editing", stayed.path === SITE && stayed.editing, json(stayed));
    // Mod+click opens it in a new tab instead
    const opened = ctx.context.waitForTarget((t) => t.url() === href, { timeout: 5000 }).catch(() => null);
    await page.keyboard.down(process.platform === "darwin" ? "Meta" : "Control");
    await ctx.clickAt(link);
    await page.keyboard.up(process.platform === "darwin" ? "Meta" : "Control");
    const tab = await opened;
    check("…and Mod+click opens it in a new tab", !!tab && (await page.evaluate(() => location.pathname)) === SITE, tab ? tab.url() : `no tab opened for ${href}`);
    await (await tab?.page())?.close();
  });

  await part("source view", async () => {
    await selectSection("oer-cs-learn");
    await runRail("Edit HTML");
    await ctx.waitFor(() => __ec.haxBody().hasAttribute("viewsourcetoggle"), { what: "the source view", timeout: 5000 });
    await ctx.sleep(400);
    // (clear of the editing bar, which stays at the top)
    const tagline = await field("oer-cs-hero > p");
    await tagline.evaluate((p) => p.scrollIntoView({ block: "center" }));
    await ctx.frames();
    await ctx.clickAt(tagline);
    await ctx.type("A paragraph");
    await ctx.sleep(400);
    const stuck = await page.evaluate(() => __ec.haxBody().hasAttribute("viewsourcetoggle"));
    const learn = await page.evaluate(() => !!__ec.haxBody().querySelector("oer-cs-learn > oer-cs-outcome"));
    check("After Edit HTML on a section and selecting a paragraph, the source view has ended", !stuck && learn, `viewsourcetoggle ${stuck ? "still on" : "off"}; the section's outcome ${learn ? "kept" : "lost"}`);
    const menu = await openRail("Block");
    const count = () => page.evaluate(() => __ec.haxBody().querySelectorAll("oer-cs-hero > p").length);
    const before = await count();
    const duplicate = await railItem("Duplicate");
    const enabled = !!duplicate.asElement() && (await duplicate.evaluate((b) => b.getAttribute("aria-disabled") !== "true"));
    if (enabled) await ctx.clickAt(duplicate);
    await ctx.sleep(500);
    const after = await count();
    check("…the rail's Duplicate is enabled and duplicates the paragraph", enabled && after === before + 1, `${menu.find((m) => m.startsWith("Duplicate"))}; ${before} → ${after} paragraphs`);
  });

  await part("starters", async () => {
    await selectSection("oer-cs-facts");
    await insertBelow("Paragraph", "Paragraph");
    const p = await handle(() => {
      const next = __ec.haxBody().querySelector("oer-cs-facts").nextElementSibling;
      return next?.localName === "p" ? next : null;
    });
    const added = !!p.asElement();
    const empty = added && (await p.evaluate((el) => el.textContent === "" && !el.children.length));
    const caret = added && (await caretIn(p));
    check("Inserting a Paragraph adds an empty p holding the caret", added && empty && caret, added ? `empty ${empty}, caret ${caret ? "inside" : `at ${json((await ctx.selection()).anchor)}`}` : "no p after the facts");
    if (added) {
      await ctx.type("Typed straight away");
      await ctx.sleep(250);
      check("…and typing goes into it", (await p.evaluate((el) => el.textContent)) === "Typed straight away", await outer("oer-cs-facts + p"));
    }
    for (const title of ["Basic Image", "Enhanced Image", "Column layout"]) await insertBelow(title, title);
    const html = await ctx.haxBodyHtml();
    const borrowed = html.match(/https?:\/\/(cdn2\.thecatapi\.com|dummyimage\.com)[^"' ]*/g) || [];
    check("Inserting an image adds no thecatapi.com (or other borrowed) picture anywhere in hax-body", !borrowed.length, borrowed.join(", ") || "no outside image addresses");
    const image = await page.evaluate(() => {
      const r = __ec.haxBody().querySelector(":scope > img")?.getBoundingClientRect();
      return r ? `${Math.round(r.width)}×${Math.round(r.height)}` : null;
    });
    check("…and the new image has a box to select", image && !image.startsWith("0"), image ?? "no img");
    const columns = await page.evaluate(() => {
      const grid = [...__ec.haxBody().querySelectorAll("grid-plate")].pop();
      return grid ? __ec.normalize(grid.innerHTML) : null;
    });
    check("Inserting columns adds empty paragraphs, not demo text", columns !== null && !/content to replace/.test(columns) && /<p slot="col-1"><\/p>/.test(columns), columns ?? "no grid-plate");
    await ctx.exitEdit({ discard: true });
  });

  /* ---------- session 3: OER Courses ---------- */

  await part("hub", async () => {
    await ctx.setViewport(390);
    await ctx.open(HUB);
    const names = await barNames();
    check(`${HUB} at 390: every button in the course-site bar has a name`, names.length > 0 && names.every(Boolean), json(names));
    await ctx.setViewport(1440);
    await ctx.settle();
    await compareAxe(HUB, "reading");
    const reading = await page.evaluate(() => __ec.theme().querySelector("oer-courses-catalog")?.shadowRoot?.querySelectorAll(".card a[href]").length ?? 0);
    await ctx.enterEdit();
    await compareAxe(HUB, "editing");
    await typeInField("oer-courses-intro", "p", "Hub intro");
    const card = await handle(() => __ec.haxBody().querySelector("oer-courses-catalog")?.shadowRoot?.querySelector(".card") || null);
    if (!card.asElement()) throw new Error("The hub's catalog shows no course cards");
    const links = await card.evaluate((c) => c.querySelectorAll("a[href]").length);
    await ctx.clickAt(card, { covered: true });
    await ctx.sleep(1200);
    const after = await page.evaluate(() => ({ path: location.pathname, editing: !!__ec.store().editMode, intro: __ec.haxBody()?.querySelector("oer-courses-intro > p")?.textContent }));
    check("Clicking a hub catalog card while editing leaves the URL unchanged and edit mode on", after.path === HUB && after.editing && after.intro === "Hello", `${json(after)}; ${links} links in the card`);
    check("…while readers' cards link to the course sites", reading > 0, `${reading} card links for readers`);
    await ctx.exitEdit({ discard: true });
  });

  /* ---------- session 4: a lesson: double-click, columns, saving (this saves the copy) ---------- */

  await part("double-click", async () => {
    await ctx.open(LESSON);
    await ctx.enterEdit();
    const para = await handle(() => [...__ec.haxBody().querySelectorAll(":scope > p")].find((p) => p.textContent.trim().split(/\s+/).length > 3));
    await para.evaluate((p) => p.scrollIntoView({ block: "center" }));
    await ctx.frames();
    // the middle of the paragraph's second word
    const word = await wordAt(para, 1);
    // a click first, as a person makes the paragraph the one being edited
    await ctx.clickAt(word);
    await ctx.sleep(400);
    await ctx.clickAt(word, { clickCount: 2 });
    await ctx.sleep(400);
    const selected = (await ctx.selectionText()).trim();
    check("Double-clicking a word in a paragraph leaves that word selected", selected === word.word.replace(/[.,;:!?]+$/, ""), `“${selected}” for “${word.word}”`);
  });

  await part("triple-click", async () => {
    // Chrome's paragraph selection ran on to the start of the next block,
    // and typing over it pulled that block (here a photo) in
    const blocks = () => page.evaluate(() => [...__ec.haxBody().children].map((c) => c.localName).join(" "));
    const before = await blocks();
    const para = await handle(() => [...__ec.haxBody().querySelectorAll(":scope > p")].find((p) => p.textContent.trim().split(/\s+/).length > 3));
    await ctx.clickAt(await wordAt(para, 1), { clickCount: 3 });
    await ctx.sleep(300);
    await ctx.type("Replaced");
    await ctx.sleep(300);
    const after = { blocks: await blocks(), para: await para.evaluate((p) => __ec.normalize(p.outerHTML)) };
    check("Triple-clicking a paragraph and typing replaces just that paragraph", after.blocks === before && after.para === "<p>Replaced</p>", after.blocks === before ? after.para : `${before} → ${after.blocks}`);
  });

  await part("columns", async () => {
    const para = await handle(() => [...__ec.haxBody().querySelectorAll(":scope > p")].find((p) => p.textContent.trim().length > 20));
    await ctx.clickAt(para);
    await ctx.sleep(250);
    const menu = await openRail("Block");
    check("A paragraph outside sections offers Add column but not Remove column", menu.includes("Add column") && !menu.includes("Remove column"), menu.join(", "));
    // not for a locked block, as HAX's own columns commands
    await ctx.clickAt(await railItem("Lock content"));
    await ctx.sleep(400);
    const locked = await openRail("Block");
    check("…and offers it switched off while the block is locked", locked.includes("Add column (off: Unlock it first)"), locked.filter((m) => /column|lock/i.test(m)).join(", "));
    await ctx.clickAt(await railItem("Unlock content"));
    await ctx.sleep(400);
    await openRail("Block");
    await ctx.clickAt(await railItem("Add column"));
    await ctx.sleep(700);
    const state = () => para.evaluate((p) => ({ parent: p.parentElement.localName, layout: p.parentElement.layout ?? null, slot: p.getAttribute("slot"), selected: globalThis.HaxStore.requestAvailability().activeNode === p }));
    const wrapped = await state();
    check("Add column puts it in two equal columns, still selected", wrapped.parent === "grid-plate" && wrapped.layout === "1-1" && wrapped.slot === "col-1" && wrapped.selected, json(wrapped));
    // the new column has a paragraph to type in
    const second = await handle(() => __ec.haxBody().querySelector('grid-plate > p[slot="col-2"]'));
    if (second.asElement()) {
      await ctx.clickAt(second);
      await ctx.sleep(250);
      await ctx.type("Second column");
      await ctx.sleep(250);
    }
    const col2 = second.asElement() ? await second.evaluate((p) => __ec.normalize(p.outerHTML)) : "no paragraph in column 2";
    check("…and the new column has a paragraph to type in", col2 === '<p slot="col-2">Second column</p>', col2);
    await ctx.clickAt(para);
    await ctx.sleep(250);
    const inGrid = await openRail("Block");
    check("…where Remove column is offered", inGrid.includes("Remove column"), inGrid.join(", "));
    await ctx.clickAt(await railItem("Remove column"));
    await ctx.sleep(500);
    const back = await state();
    const next = await para.evaluate((p) => __ec.normalize(p.nextElementSibling?.outerHTML ?? ""));
    check("Remove column on two columns takes both columns' paragraphs back out, the first still selected", back.parent === "hax-body" && !back.slot && back.selected && next === "<p>Second column</p>", `${json(back)}; then ${next}`);
  });

  await part("rail by keyboard", async () => {
    // a command chosen with the keyboard leaves focus in the text, not on the page
    const para = await handle(() => [...__ec.haxBody().querySelectorAll(":scope > p")].find((p) => p.textContent.trim().length > 20));
    await ctx.clickAt(para);
    await ctx.sleep(250);
    const count = () => page.evaluate(() => __ec.haxBody().querySelectorAll(":scope > p").length);
    const before = await count();
    await ctx.press("Alt+F10");
    await ctx.press("Enter");
    await ctx.sleep(200);
    const current = () => page.evaluate(() => document.querySelector("oer-block-rail").shadowRoot.activeElement?.querySelector(".text")?.textContent.trim());
    for (let i = 0; i < 10 && (await current()) !== "Duplicate"; i++) await ctx.press("ArrowDown");
    await ctx.press("Enter");
    await ctx.sleep(400);
    const after = await page.evaluate(() => {
      const active = __ec.haxStore().activeNode;
      const sel = active?.getRootNode().getSelection?.() || getSelection();
      return { focus: __ec.describe(__ec.activeElement())?.path, caret: !!sel.anchorNode && !!active?.contains(sel.anchorNode) };
    });
    check("Duplicate chosen from the rail by keyboard duplicates, and focus goes back to the text", (await count()) === before + 1 && /hax-body$/.test(after.focus || "") && after.caret, `${before} → ${await count()} paragraphs; ${json(after)}`);
  });

  await part("undo from the toolbar", async () => {
    // Ctrl+Z (HAX's undo key) with focus on the editor's own buttons
    const text = () => page.evaluate(() => [...__ec.haxBody().querySelectorAll(":scope > p")].find((p) => p.textContent.trim().length > 20).textContent);
    const para = await handle(() => [...__ec.haxBody().querySelectorAll(":scope > p")].find((p) => p.textContent.trim().length > 20));
    await ctx.clickAt(para);
    await para.evaluate((p) => {
      const range = document.createRange();
      range.selectNodeContents(p);
      range.collapse(false);
      const sel = p.getRootNode().getSelection?.() || getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    });
    const start = await text();
    // two undo steps (HAX records one 300 ms after the last change)
    await ctx.type(" One");
    await ctx.sleep(700);
    await ctx.type(" two");
    await ctx.sleep(700);
    const button = await ctx.control("Undo");
    await ctx.clickAt(button);
    await ctx.sleep(500);
    await button.evaluate((b) => b.focus());
    await ctx.press("Control+z");
    await ctx.sleep(500);
    const focus = await ctx.deepActiveElement();
    check("Ctrl+Z with focus on the Undo button undoes the step before", (await text()) === start, `focus on ${focus?.name}; …${(await text()).slice(-20)}`);
  });

  await part("lesson", async () => {
    // by id: saving gives a page whose title ends in "?" a new address (HAX's own doing)
    const id = await page.evaluate(() => __ec.store().activeItem.id);
    const para = await handle(() => [...__ec.haxBody().querySelectorAll(":scope > p")].find((p) => p.textContent.trim().length > 20));
    await ctx.clickAt(para);
    // the end of the paragraph (End goes to the end of its line)
    await para.evaluate((p) => {
      const range = document.createRange();
      range.selectNodeContents(p);
      range.collapse(false);
      const sel = p.getRootNode().getSelection?.() || getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    });
    await ctx.type(" Edited by the check.");
    await ctx.press("Enter");
    // HAX puts the caret in the new paragraph a moment after making it:
    // typed sooner, its first letter ends up last (as before these fixes)
    await ctx.waitFor(
      () => {
        const sel = __ec.haxBody().getRootNode().getSelection();
        const block = sel.anchorNode?.nodeType === 1 ? sel.anchorNode : sel.anchorNode?.parentElement;
        return block?.localName === "p" && !block.textContent.trim() && !!block.previousElementSibling?.textContent.endsWith("Edited by the check.");
      },
      { what: "the caret in the new paragraph", timeout: 5000 },
    );
    await ctx.sleep(150);
    await ctx.type("A paragraph of its own.");
    await ctx.sleep(300);
    const status = await ctx.save();
    const saved = ctx.savedHtml(id);
    // (the stock save can show the page as it was for a few seconds more,
    // which editor-redesign WP-11 ends: what's checked here is that it's saved)
    const shown = await ctx.waitFor(() => __ec.theme().textContent.includes("A paragraph of its own.") && __ec.theme().textContent, { what: "the new paragraph in the reading view", timeout: 10000 }).catch(() => page.evaluate(() => __ec.theme().textContent));
    check(
      "A lesson still edits and saves: typed text, and Enter for a new paragraph",
      status === 200 && saved.includes("Edited by the check.") && /<p[^>]*>A paragraph of its own\.<\/p>/.test(saved) && shown.includes("A paragraph of its own."),
      `HTTP ${status}; saved: …${saved.replace(/\s+/g, " ").match(/.{0,30}Edited by the check\..{0,60}/)?.[0] ?? "without the typed text"}…; the reading view ${shown.includes("A paragraph of its own.") ? "shows" : "lacks"} the new paragraph`,
    );
    check("…and its saved HTML has no editor attributes", !EDITOR_ATTRS.test(saved), saved.match(EDITOR_ATTRS)?.[0] || "none");
  });

  /* ---------- session 5: a paragraph between sections, for readers (this saves the copy) ---------- */

  await part("between sections", async () => {
    await ctx.open(SITE);
    await ctx.enterEdit();
    await selectSection("oer-cs-facts");
    await insertBelow("Paragraph", "Paragraph");
    await ctx.type("A note between sections.");
    // below it, an image given a picture, and one left without
    await insertBelow("Basic Image", "Basic Image");
    await page.evaluate(() => {
      const img = __ec.haxBody().querySelector("oer-cs-facts + p + img");
      Object.entries({ src: "files/rec2Od2fcMVgDSQyg_image_diamond_image.png", width: "200", height: "159", alt: "A diamond" }).forEach(([k, v]) => img.setAttribute(k, v));
    });
    await insertBelow("Basic Image", "Basic Image");
    // (back up the page, clear of the course site's bar)
    const tagline = await field("oer-cs-hero > p");
    await tagline.evaluate((p) => p.scrollIntoView({ block: "center" }));
    await ctx.frames();
    await ctx.clickAt(tagline);
    await ctx.type("Design it on screen, then make it real.");
    await ctx.sleep(300);
    await ctx.save();
    const saved = ctx.savedHtml(SITE);
    check(
      "The course site saves the paragraph and the tagline",
      /<\/oer-cs-facts>\s*<p[^>]*>A note between sections\.<\/p>/.test(saved) && saved.includes("Design it on screen, then make it real."),
      saved.replace(/\s+/g, " ").match(/<\/oer-cs-facts>.{0,80}/)?.[0] ?? "no facts section",
    );
    check("The saved HTML contains no data-hax-, contenteditable or role attributes", !EDITOR_ATTRS.test(saved), saved.match(EDITOR_ATTRS)?.[0] || "none");
    await ctx.open(SITE, { signedOut: true });
    const geometry = await page.evaluate(() => {
      const p = [...__ec.theme().children].find((el) => el.localName === "p" && el.textContent.includes("A note between sections"));
      const main = __ec.deep("oer-course-site")?.shadowRoot?.querySelector("main");
      if (!p || !main) return null;
      const r = p.getBoundingClientRect();
      const m = main.getBoundingClientRect();
      const round = (n) => Math.round(n * 10) / 10;
      return {
        left: round(r.left - (m.left + main.clientLeft)),
        right: round(m.left + main.clientLeft + main.clientWidth - r.right),
        width: round(r.width),
        rem: parseFloat(getComputedStyle(document.documentElement).fontSize),
        align: getComputedStyle(p).textAlign,
      };
    });
    check(
      "For readers at 1440, a paragraph between sections is centred and 48rem wide",
      geometry && Math.abs(geometry.left - geometry.right) <= 2 && Math.abs(geometry.width - 48 * geometry.rem) <= 1,
      json(geometry),
    );
    const image = await page.evaluate(() => {
      const [img, empty] = [...__ec.theme().children].filter((el) => el.localName === "img");
      const p = [...__ec.theme().children].find((el) => el.localName === "p" && el.textContent.includes("A note between sections"));
      if (!img || !p) return null;
      const r = img.getBoundingClientRect();
      return { size: `${Math.round(r.width)}×${Math.round(r.height)}`, left: Math.round(r.left - p.getBoundingClientRect().left), empty: empty ? getComputedStyle(empty).display : "not saved" };
    });
    check("…an image there keeps its own size at the paragraph's left edge, and one without a picture isn't shown", image?.size === "200×159" && Math.abs(image.left) <= 1 && image.empty === "none", json(image));
    const axe = await ctx.axe();
    const worse = baseline ? newViolations(axe, baseline.pages?.[SITE]?.reading) : ["no baseline"];
    check(`${SITE} reading, with those blocks: no new axe violations`, !worse.length, worse.length ? worse.join("; ") : `${axe.violations} rules, ${axe.nodes} nodes`);
  });

  return results;
}
