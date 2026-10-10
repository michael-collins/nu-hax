// Hotfix (Safari and Firefox): editing on the live site in every engine.
// The theme reads and places the caret inside shadow roots the same way in
// Chrome, Firefox and WebKit (typing boxes, the course site's edge guard,
// the block list, the rail, citations, the small text editor); HAX finds
// the caret in WebKit too, so arrow keys and Backspace keep it in the
// content and never make the theme's host the active block; Cancel right
// after Edit content leaves at once; ⌘Z and ⌘⇧Z are HAX's undo and redo,
// and leave the caret in the text; the leave dialog gives focus back to
// the button that opened it, and Duplicate from the rail by keyboard puts
// the caret in the copy; the content's input guards keep the page-break
// and the course site's sections (Select All, a selection across
// sections, Cut, Enter twice then Backspace, Safari's Ctrl+D) and join
// paragraphs themselves (Safari's engine copied the theme into the page);
// the placeholder art's grid isn't drawn inverted; and a paste lands once,
// where it was pasted, without freezing the page.
//
// Run with --engines chrome,firefox,webkit. Nothing here saves, and it
// doesn't count on the copy being unsaved (stopgaps, run before it, saves
// the tagline and the lesson, which then gets a new address).
import { readFileSync } from "node:fs";
import path from "node:path";

const SITE = "/up/dart-413";
const HUB = "/oer-courses";
// /lessons/what-is-design, by its id: saving gives a page whose title
// ends in "?" a new address
const LESSON_ID = "item-143f3783-959c-45c3-8758-dacef0f6861f";

export default async function hotfix(ctx) {
  const { page } = ctx;
  const items = JSON.parse(readFileSync(path.join(ctx.siteDir, "site.json"), "utf8")).items;
  const LESSON = `/${items.find((i) => i.id === LESSON_ID)?.slug ?? "lessons/what-is-design"}`;
  const results = [];
  const check = (name, pass, detail = "") => results.push({ name, pass: !!pass, detail });
  const json = (v) => JSON.stringify(v);
  // HAX asks before leaving a page it's editing
  page.on("dialog", (d) => d.accept().catch(() => {}));
  // set once the page stops answering (a paste that never ends): the parts after it aren't run
  let frozen = false;
  const part = async (name, fn) => {
    if (frozen) return check(`${name}: runs`, false, "not run: the page had stopped answering");
    const start = Date.now();
    try {
      await fn();
    } catch (e) {
      if (e.skipped) results.push(ctx.skip(`${name}: runs`, e.message));
      else check(`${name}: runs without errors`, false, e.message.split("\n")[0]);
      // (a page that stopped answering takes neither)
      if (!frozen) {
        await ctx.screenshot(`error-${name}`).catch(() => {});
        // a question left open mustn't cover the next part
        if (await page.evaluate(() => !!__ec.openDialog()).catch(() => false)) await ctx.exitEdit({ discard: true }).catch(() => {});
      }
    }
    ctx.log(`${name} took ${((Date.now() - start) / 1000).toFixed(1)} s`);
  };

  /* ---------- helpers ---------- */

  const handle = (fn, ...args) => page.evaluateHandle(fn, ...args);
  const field = (selector) => handle((s) => __ec.haxBody().querySelector(s), selector);
  const blocks = () => page.evaluate(() => [...__ec.haxBody().children].map((c) => c.localName).join(" "));
  const caretIn = (el) =>
    el.evaluate((f) => {
      const sel = __ec.selectionNodes(f);
      return !!sel.anchorNode && f.contains(sel.anchorNode);
    });
  const caretAtStart = (el) => el.evaluate((p) => __ec.select(p, 0));
  const caretAtEnd = (el) => el.evaluate((p) => __ec.select(p, p.childNodes.length));
  // where HAX is: its active block, whether hax-body and the theme's host are editable, and the caret as HAX reads it
  const haxState = () =>
    page.evaluate(() => {
      const hs = __ec.haxStore();
      const body = __ec.haxBody();
      const active = hs.activeNode;
      const sel = hs.getSelection();
      const builder = document.querySelector("haxcms-site-builder");
      return {
        active: active ? (body.contains(active) ? active.localName : `outside: ${active.localName}`) : null,
        bodyEditable: body.getAttribute("contenteditable"),
        builderEditable: builder?.getAttribute("contenteditable") ?? null,
        haxCaret: sel?.anchorNode ? (body.contains(sel.anchorNode) ? "in the content" : `at ${sel.anchorNode.nodeName}`) : "none",
      };
    });
  // the caret in the content before Backspace: Playwright's WebKit goes back a page when it isn't
  const caretInContent = () => page.evaluate(() => !!__ec.selectionNodes(__ec.haxBody()).anchorNode && __ec.haxBody().contains(__ec.selectionNodes(__ec.haxBody()).anchorNode));
  const backspace = async (times = 1) => {
    for (let i = 0; i < times; i++) {
      if (ctx.engine === "webkit" && !(await caretInContent())) throw new Error("The caret left the content before Backspace (WebKit would go back a page)");
      await ctx.press("Backspace");
    }
  };
  // a click in a typing box's own padding, below its empty field
  const clickBox = async (tag) => {
    const area = await handle((tag) => __ec.haxBody().querySelector(tag).shadowRoot.querySelector(".typing-area"), tag);
    await area.evaluate((a) => a.scrollIntoView({ block: "center" }));
    await ctx.frames();
    const point = await area.evaluate((a) => {
      const r = a.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.bottom - 4) };
    });
    await ctx.clickAt(point);
    await ctx.sleep(250);
  };
  const railMenuItem = (label) =>
    handle((label) => [...document.querySelector("oer-block-rail").shadowRoot.querySelectorAll(".menu [role^=menuitem]")].find((b) => b.querySelector(".text")?.textContent.trim() === label) || null, label);
  const runRail = async (label) => {
    const button = await handle(() => document.querySelector("oer-block-rail").shadowRoot.querySelector('.rail button[aria-label="Block"]'));
    await ctx.clickAt(button);
    await ctx.sleep(150);
    const item = await railMenuItem(label);
    if (!item.asElement()) throw new Error(`The rail's Block menu has no ${label}`);
    await ctx.clickAt(item);
  };
  const selectSection = async (tag) => {
    const spot = await handle((tag) => {
      const s = __ec.haxBody().querySelector(tag);
      return s.shadowRoot.querySelector(".typing-hint, h2, h1, .wrap") || s;
    }, tag);
    await ctx.clickAt(spot, { covered: true });
    await ctx.waitFor((tag) => __ec.haxStore().activeNode?.localName === tag, { args: [tag], what: `${tag} to be selected`, timeout: 5000 });
    await ctx.sleep(150);
  };
  const longParagraph = () => handle(() => [...__ec.haxBody().querySelectorAll(":scope > p")].find((p) => p.textContent.trim().length > 20));
  // Select All as each engine has it: Firefox and WebKit run ⌘A themselves;
  // headless Chrome's selectAll does nothing, so its selection is set over
  // the whole of hax-body (Chrome then starts it after the page-break, as
  // WebKit's ⌘A does; Firefox's takes the page-break in)
  const selectAll = async () => {
    if (ctx.engine === "chrome") await page.evaluate(() => __ec.select(__ec.haxBody(), 0, __ec.haxBody(), __ec.haxBody().childNodes.length));
    else await ctx.press("Mod+A");
    await ctx.sleep(100);
    return page.evaluate(() => __ec.selection().text.length);
  };
  // the share of an element's pixels drawn in its plain background colour
  // (taken by drawing it once more without its background image); the
  // screenshots are decoded by the page itself, on a canvas
  const plainShare = async (el) => {
    await el.evaluate((e) => e.scrollIntoView({ block: "center" }));
    await ctx.frames();
    const shot = async () => Buffer.from(await el.screenshot()).toString("base64");
    const drawn = await shot();
    const saved = await el.evaluate((e) => {
      const before = e.style.backgroundImage;
      e.style.backgroundImage = "none";
      return before;
    });
    await ctx.frames();
    const plain = await shot();
    await el.evaluate((e, before) => (e.style.backgroundImage = before), saved);
    return page.evaluate(
      async (drawn, plain) => {
        const pixels = async (b64) => {
          const img = new Image();
          img.src = `data:image/png;base64,${b64}`;
          await img.decode();
          const canvas = document.createElement("canvas");
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const c = canvas.getContext("2d");
          c.drawImage(img, 0, 0);
          return { data: c.getImageData(0, 0, canvas.width, canvas.height).data, size: `${canvas.width}×${canvas.height}` };
        };
        const a = await pixels(drawn);
        const b = await pixels(plain);
        // the plain colour: the commonest pixel of the plain drawing
        const counts = new Map();
        for (let i = 0; i < b.data.length; i += 4) {
          const key = `${b.data[i]},${b.data[i + 1]},${b.data[i + 2]}`;
          counts.set(key, (counts.get(key) || 0) + 1);
        }
        const bg = [...counts.entries()].sort((x, y) => y[1] - x[1])[0][0].split(",").map(Number);
        let same = 0;
        for (let i = 0; i < a.data.length; i += 4) {
          if (Math.abs(a.data[i] - bg[0]) <= 3 && Math.abs(a.data[i + 1] - bg[1]) <= 3 && Math.abs(a.data[i + 2] - bg[2]) <= 3) same++;
        }
        return { share: Math.round((same / (a.data.length / 4)) * 100), size: a.size, plain: `rgb(${bg.join(",")})` };
      },
      drawn,
      plain,
    );
  };
  // the blocks and the start of each one's text
  const shape = () =>
    page.evaluate(() =>
      [...__ec.haxBody().children]
        .map((c) => {
          const t = c.textContent.replace(/\s+/g, " ").trim();
          return `${c.localName}${t ? `(${t.slice(0, 16)})` : ""}`;
        })
        .join(" | "),
    );
  // text straight in hax-body (HAX's haxToContent throws on it), and whether HAX can save
  const loose = () => page.evaluate(() => [...__ec.haxBody().childNodes].filter((n) => n.nodeType === 3 && n.data.trim()).length);
  const saves = () => page.evaluate(async () => __ec.haxBody().haxToContent().then(() => "HAX can save", (e) => `haxToContent throws ${e.message}`));
  const bodies = () => page.evaluate(() => __ec.all("hax-body").length);
  const textOf = (selector) => page.evaluate((s) => __ec.haxBody().querySelector(s)?.textContent.replace(/\s+/g, " ").trim() ?? "(gone)", selector);
  const htmlOf = (selector) => page.evaluate((s) => __ec.normalize(__ec.haxBody().querySelector(s)?.outerHTML ?? "(gone)"), selector);
  // a click on a paragraph's first line (HAX's invisible block menu sits over
  // the bottom of the paragraph above the active block)
  const clickIn = async (el) => {
    await el.evaluate((p) => p.scrollIntoView({ block: "center" }));
    await ctx.frames();
    await ctx.clickAt(await el.evaluate((p) => ({ x: p.getBoundingClientRect().left + 30, y: p.getBoundingClientRect().top + 10 })), { covered: true });
    await ctx.sleep(150);
  };
  // the caret n characters into an element's text (after any white space it starts with)
  const caretAtText = (el, n) =>
    el.evaluate((p, n) => {
      const walker = globalThis.document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
      let left = n + (p.textContent.length - p.textContent.trimStart().length);
      for (let t = walker.nextNode(); t; t = walker.nextNode()) {
        if (left <= t.length) return __ec.select(t, left);
        left -= t.length;
      }
    }, n);
  // whether the page still answers (a paste that never ends holds it)
  const answers = () => Promise.race([page.evaluate(() => true).catch(() => false), ctx.sleep(8000).then(() => false)]);
  /**
   * Paste as each engine can: Firefox a real ⌘C (from a copy outside the
   * editor: HTML from a div, plain text from a textarea) and ⌘V; the others
   * a paste event carrying the data. place() puts the caret or selection
   * (in Firefox after copying, which moves the selection). Resolves to
   * whether the paste event was cancelled at once (null for a real paste);
   * throws when the page stops answering, and the parts after aren't run.
   */
  const pasteData = async ({ html = "", text = "" }, place) => {
    if (ctx.engine === "firefox") {
      await page.evaluate(
        (html, text) => {
          const el = document.body.appendChild(document.createElement(html ? "div" : "textarea"));
          el.id = "hotfix-clip";
          if (html) {
            el.innerHTML = html;
            document.getSelection().selectAllChildren(el);
          } else {
            el.value = text;
            el.focus();
            el.select();
          }
        },
        html,
        text,
      );
      await ctx.press("Meta+c");
      await page.evaluate(() => document.getElementById("hotfix-clip").remove());
      await place();
      const done = await Promise.race([ctx.press("Meta+v").then(() => true), ctx.sleep(8000).then(() => false)]);
      frozen ||= !done;
      if (frozen) throw new Error("The page stopped answering at the paste (8 s)");
      return null;
    }
    await place();
    const pasted = page.evaluate(
      (html, text) => {
        const dt = new DataTransfer();
        if (text) dt.setData("text/plain", text);
        if (html) dt.setData("text/html", html);
        const e = new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true, composed: true });
        (__ec.activeElement() || __ec.haxBody()).dispatchEvent(e);
        return e.defaultPrevented;
      },
      html,
      text,
    );
    const done = await Promise.race([pasted, ctx.sleep(8000).then(() => "no answer")]);
    frozen ||= done === "no answer";
    if (frozen) throw new Error("The page stopped answering at the paste (8 s)");
    return done;
  };
  const TWO = "<p>First pasted</p><p>Second pasted</p>";
  const count = (s) => page.evaluate((s) => __ec.haxBody().textContent.split(s).length - 1, s);
  // a rail menu item reached with the keyboard: Alt+F10, Enter (Block), then down to it
  const railByKeys = async (label) => {
    await ctx.press("Alt+F10");
    await ctx.press("Enter");
    await ctx.sleep(200);
    const current = () => page.evaluate(() => document.querySelector("oer-block-rail").shadowRoot.activeElement?.querySelector(".text")?.textContent.trim());
    for (let i = 0; i < 12 && (await current()) !== label; i++) await ctx.press("ArrowDown");
    if ((await current()) !== label) throw new Error(`The rail's Block menu has no ${label}`);
    await ctx.press("Enter");
  };
  // a block from the block list below the active one, chosen by its name
  const insertBlock = async (name) => {
    await runRail("Insert block below…");
    await ctx.waitFor(() => !!document.querySelector("oer-block-inserter").shadowRoot.querySelector(".panel input"), { what: "the block list" });
    await ctx.type(name);
    await ctx.sleep(200);
    const option = await handle((name) => [...document.querySelector("oer-block-inserter").shadowRoot.querySelectorAll("[role=option]")].find((o) => o.textContent.trim().startsWith(name)) || null, name);
    if (!option.asElement()) throw new Error(`The block list has no ${name}`);
    await ctx.clickAt(option);
    await ctx.sleep(500);
  };

  // Edit content, then Cancel as soon as it's there: leaves at once, or asks
  const cancelAtOnce = async () => {
    // (a lesson has Edit content in its page menu: the stock toggle instead, as enterEdit does)
    const edit = await ctx.control("Edit content");
    if (edit) await ctx.clickAt(edit);
    else await page.evaluate(() => __ec.store().cmsSiteEditor.haxCmsSiteEditorUIElement._editButtonTap());
    await ctx.waitFor(() => !!__ec.store().editMode && !!__ec.control("Cancel"), { what: "the editor's Cancel", timeout: 10000 });
    const t0 = Date.now();
    await ctx.clickAt(await ctx.control("Cancel"));
    const outcome = await ctx.waitFor(() => (!__ec.store().editMode ? "left" : __ec.openDialog() ? "asked" : null), { what: "Cancel to leave or ask", timeout: 10000 });
    const ms = Date.now() - t0;
    if (outcome === "asked") await ctx.exitEdit({ discard: true });
    else await ctx.waitForReading();
    return { outcome, ms };
  };

  /* ---------- the course site ---------- */

  await part("site art", async () => {
    await ctx.open(SITE);
    const art = await handle(() => __ec.theme().querySelector("oer-cs-hero")?.shadowRoot?.querySelector(".art-fallback") || null);
    if (!art.asElement()) return results.push(ctx.skip("The hero's placeholder art is drawn as lines on its background", "this hero has a picture"));
    const m = await plainShare(art);
    check("The hero's placeholder art is drawn as lines on its background, not inverted", m.share >= 70, `${m.share}% of ${m.size} in its background ${m.plain}`);
  });

  await part("site cancel at once", async () => {
    const r = await cancelAtOnce();
    check(`${SITE}: Cancel straight after Edit content leaves at once`, r.outcome === "left", `${r.outcome} after ${r.ms} ms`);
  });

  await part("site typing", async () => {
    await ctx.enterEdit();
    const copy = await ctx.waitFor(() => (__ec.store().cmsSiteEditor.haxCmsSiteEditorUIElement._originalContent || "").length, { what: "HAX's unchanged copy of the page", timeout: 5000 }).catch(() => 0);
    check("HAX's unchanged copy holds the page once it has arrived", copy > 100, `${copy} characters`);
    const tagline = await field("oer-cs-hero > p");
    const start = await tagline.evaluate((p) => p.textContent);
    await clickBox("oer-cs-hero");
    const inside = await caretIn(tagline);
    await ctx.type("Hello");
    await ctx.sleep(250);
    const text = await tagline.evaluate((p) => p.textContent);
    check("Clicking the hero's typing box puts the caret in the tagline, and typing goes in", inside && text === `${start}Hello`, `caret ${inside ? "inside" : `at ${json((await ctx.selection()).anchor)}`}; “${text}”`);
  });

  await part("site arrows", async () => {
    const tagline = await field("oer-cs-hero > p");
    await ctx.clickAt(tagline);
    await caretAtEnd(tagline);
    await ctx.press("ArrowLeft");
    await ctx.press("ArrowLeft");
    await ctx.sleep(300);
    await ctx.type("Z");
    await ctx.sleep(300);
    const text = await tagline.evaluate((p) => (p.isConnected ? p.textContent : "(replaced)"));
    const state = await haxState();
    check("Arrow keys in the tagline keep the caret there and the typed text (no saved page brought back)", text.endsWith("HelZlo"), `“${text}”; ${json(state)}`);
    check("…and HAX's active block stays in the content, the theme's host not editable", state.active && !state.active.startsWith("outside") && state.bodyEditable && !state.builderEditable, json(state));
  });

  await part("site edges", async () => {
    const before = await blocks();
    const note = await field("oer-cs-people > p");
    await clickBox("oer-cs-people");
    const inside = await caretIn(note);
    await backspace(4);
    await ctx.sleep(400);
    const after = await blocks();
    const state = await haxState();
    check(
      "Backspace four times in the empty instructor's note removes no section, and HAX's active block stays in the content",
      inside && after === before && !String(state.active).startsWith("outside") && !state.builderEditable,
      `caret ${inside ? "inside" : "outside"}; ${after === before ? `${before.split(" ").length} blocks kept` : `${before} → ${after}`}; ${json(state)}`,
    );
    // an empty outcome row, as stopgaps has it
    await ctx.clickAt(await field("oer-cs-learn li"));
    await backspace(3);
    await ctx.sleep(300);
    const learn = await page.evaluate(() => __ec.normalize(__ec.haxBody().querySelector("oer-cs-learn")?.outerHTML ?? "(gone)"));
    check("Backspace in the empty outcome row keeps the Learn section and its list", (await blocks()) === before && /<ul>\s*<li>/.test(learn), learn.slice(0, 80));
  });

  await part("site select all", async () => {
    const before = await blocks();
    await ctx.clickAt(await field("oer-cs-hero > p"));
    const selected = await selectAll();
    await backspace(1).catch(() => ctx.press("Backspace"));
    await ctx.sleep(400);
    const after = await blocks();
    check("Select All then Backspace on the course site deletes nothing", after === before, `${selected} characters selected; ${after === before ? `${before.split(" ").length} blocks kept` : `${before} → ${after}`}`);
    // from the tagline into the Learn section: Backspace, then typing over it
    const tagline = await page.evaluate(() => __ec.haxBody().querySelector("oer-cs-hero > p")?.textContent);
    const across = async () => {
      await ctx.clickAt(await field("oer-cs-hero > p"));
      await page.evaluate(() => {
        const p = __ec.haxBody().querySelector("oer-cs-hero > p");
        const li = __ec.haxBody().querySelector("oer-cs-learn li");
        __ec.select(p.firstChild || p, 1, li, 0);
      });
      await ctx.sleep(100);
    };
    await across();
    await ctx.press("Backspace");
    await ctx.sleep(300);
    await across();
    await ctx.type("x");
    await ctx.sleep(300);
    const crossed = { blocks: await blocks(), tagline: await page.evaluate(() => __ec.haxBody().querySelector("oer-cs-hero > p")?.textContent) };
    check("A selection from the hero into the Learn section: Backspace or typing over it deletes nothing", crossed.blocks === before && crossed.tagline === tagline, `${crossed.blocks === before ? "blocks kept" : crossed.blocks}; tagline “${crossed.tagline}”`);
    // and Cut, which no key guard sees (headless Chrome runs its cut command only sometimes)
    await page.evaluate(() => {
      globalThis.__hotfixCuts = 0;
      __ec.haxBody().addEventListener("beforeinput", (e) => e.inputType === "deleteByCut" && globalThis.__hotfixCuts++, true);
    });
    await across();
    if (ctx.engine === "chrome") await page.keyboard.press("x", { commands: ["cut"] });
    else await ctx.press("Mod+X");
    await ctx.sleep(300);
    const cut = { cuts: await page.evaluate(() => globalThis.__hotfixCuts), blocks: await blocks(), tagline: await page.evaluate(() => __ec.haxBody().querySelector("oer-cs-hero > p")?.textContent) };
    if (!cut.cuts && ctx.engine === "chrome") results.push(ctx.skip("…and cutting it (⌘X) deletes nothing either", "headless Chrome didn't run its cut command"));
    else check("…and cutting it (⌘X) deletes nothing either", cut.blocks === before && cut.tagline === tagline, `${cut.cuts} cut; ${cut.blocks === before ? "blocks kept" : cut.blocks}; tagline “${cut.tagline}”`);
  });

  await part("site undo", async () => {
    const tagline = await field("oer-cs-hero > p");
    await ctx.clickAt(tagline);
    await caretAtEnd(tagline);
    const start = await textOf("oer-cs-hero > p");
    await ctx.type(" Und");
    // HAX records an undo step 300 ms after the last change
    await ctx.sleep(700);
    await ctx.press("Mod+Z");
    await ctx.sleep(500);
    await ctx.type("X");
    await ctx.sleep(300);
    const r = { text: await textOf("oer-cs-hero > p"), loose: await loose(), saves: await saves() };
    check("⌘Z in the hero's tagline: the caret stays in it, so typing goes on there and HAX can still save", r.text === `${start}X` && !r.loose && r.saves === "HAX can save", `“${r.text}”; ${r.loose} loose texts; ${r.saves}`);
  });

  await part("site sections", async () => {
    const before = await blocks();
    // two empty paragraphs, then Backspace: Safari's engine deleted past the section from the second
    await clickBox("oer-cs-people");
    await ctx.type("Text");
    await ctx.press("Enter");
    await ctx.press("Enter");
    await ctx.sleep(200);
    await backspace(3);
    await ctx.sleep(300);
    const people = await htmlOf("oer-cs-people");
    check("Enter twice in the instructor's note, then Backspace three times: back to its own text, no section lost", (await blocks()) === before && people === "<oer-cs-people><p>Tex</p></oer-cs-people>", `${(await blocks()) === before ? "blocks kept" : await blocks()}; ${people}`);
    // Delete in the empty question: Safari's engine and Firefox deleted the section
    await clickBox("oer-cs-faq");
    await ctx.press("Delete");
    await ctx.press("Delete");
    await ctx.sleep(300);
    const faq = await htmlOf("oer-cs-faq");
    check("Delete twice in the empty Questions box keeps the section and its question", (await blocks()) === before && /^<oer-cs-faq><h3>/.test(faq), `${(await blocks()) === before ? "blocks kept" : await blocks()}; ${faq}`);
    // the Mac's deletions in Safari: Ctrl+H, Ctrl+D, Ctrl+K at a section's edges
    if (ctx.engine === "webkit") {
      const note = await field("oer-cs-people > p");
      await ctx.clickAt(note);
      await caretAtEnd(note);
      for (const key of ["Control+d", "Control+d", "Control+k"]) await ctx.press(key);
      await caretAtStart(note);
      for (const key of ["Control+h", "Control+h"]) await ctx.press(key);
      await ctx.sleep(300);
      check("Ctrl+D, Ctrl+K and Ctrl+H at the edges of the instructor's note delete nothing past it", (await blocks()) === before && (await htmlOf("oer-cs-people")) === people, `${(await blocks()) === before ? "blocks kept" : await blocks()}; ${await htmlOf("oer-cs-people")}`);
    } else results.push(ctx.skip("Ctrl+D, Ctrl+K and Ctrl+H at the edges of the instructor's note delete nothing past it", "only Safari's engine deletes with those keys"));
    // a copied list pasted into the middle of an outcome: Firefox's paste kept the copy's wrapper and its id
    const row = await field("oer-cs-learn li");
    await ctx.clickAt(row);
    await caretAtStart(row);
    await ctx.type("onetwo");
    await pasteData({ html: "<ul><li>Item A</li><li>Item B</li></ul>", text: "Item A\nItem B" }, async () => {
      await ctx.clickAt(await field("oer-cs-learn li"));
      await caretAtText(await field("oer-cs-learn li"), 3);
    });
    await ctx.sleep(800);
    const learn = await htmlOf("oer-cs-learn");
    check("A copied list pasted into an outcome goes in once, without the copy's wrapper or id", !/<div|id="hotfix-clip"/.test(learn) && (await count("Item A")) === 1, learn.slice(0, 160));
    // Remove block on the note's only paragraph, from the keyboard: somewhere to type is left
    const note = await field("oer-cs-people > p");
    await ctx.clickAt(note);
    await caretAtEnd(note);
    await railByKeys("Remove block");
    await ctx.sleep(400);
    await ctx.type("S4");
    await ctx.sleep(300);
    const removed = { html: await htmlOf("oer-cs-people"), focus: (await ctx.deepActiveElement())?.path };
    check("Remove block on the note's only paragraph leaves an empty one, and typing goes into it", removed.html === "<oer-cs-people><p>S4</p></oer-cs-people>" && /hax-body$/.test(removed.focus || ""), json(removed));
  });

  await part("site heading", async () => {
    const heading = await handle(() => __ec.haxBody().querySelector("oer-cs-tools").shadowRoot.querySelector(".edit-heading"));
    await heading.evaluate((h) => h.scrollIntoView({ block: "center" }));
    await ctx.frames();
    const start = await heading.evaluate((h) => h.textContent);
    await ctx.clickAt(await heading.evaluate((h) => {
      const r = h.getBoundingClientRect();
      return { x: r.right - 3, y: r.top + r.height / 2 };
    }));
    await ctx.sleep(400);
    await ctx.type(" X", { delay: 40 });
    await ctx.press("Enter");
    await ctx.sleep(300);
    const kept = await page.evaluate(() => __ec.haxBody().querySelector("oer-cs-tools").getAttribute("heading"));
    check("Typing in a section's heading just clicked adds to its end", kept === `${start} X`, `“${start}” → heading="${kept}"`);
  });

  await part("site rail", async () => {
    const tagline = await field("oer-cs-hero > p");
    await tagline.evaluate((p) => p.scrollIntoView({ block: "center" }));
    await ctx.frames();
    await ctx.clickAt(tagline);
    await caretAtEnd(tagline);
    await ctx.press("Alt+F10");
    await ctx.sleep(100);
    await ctx.press("Escape");
    await ctx.sleep(200);
    const back = await page.evaluate(() => {
      const p = __ec.haxBody().querySelector("oer-cs-hero > p");
      const sel = __ec.selectionNodes(p);
      return { focus: __ec.describe(__ec.activeElement())?.path, caret: !!sel.anchorNode && p.contains(sel.anchorNode) };
    });
    check("Alt+F10 then Esc on the rail puts the caret back in the tagline", /hax-body$/.test(back.focus || "") && back.caret, json(back));
    // a paragraph from the block list holds the caret
    await selectSection("oer-cs-facts");
    await runRail("Insert block below…");
    await ctx.waitFor(() => !!document.querySelector("oer-block-inserter").shadowRoot.querySelector(".panel input"), { what: "the block list" });
    await ctx.type("Paragraph");
    await ctx.sleep(150);
    const option = await handle(() => [...document.querySelector("oer-block-inserter").shadowRoot.querySelectorAll("[role=option]")].find((o) => o.textContent.trim() === "Paragraph") || null);
    if (!option.asElement()) throw new Error("The block list has no Paragraph");
    await ctx.clickAt(option);
    await ctx.sleep(500);
    const p = await handle(() => {
      const next = __ec.haxBody().querySelector("oer-cs-facts").nextElementSibling;
      return next?.localName === "p" ? next : null;
    });
    const caret = !!p.asElement() && (await caretIn(p));
    if (p.asElement()) await ctx.type("Typed straight away");
    await ctx.sleep(250);
    const typed = p.asElement() ? await p.evaluate((el) => el.textContent) : null;
    check("A paragraph from the block list holds the caret, and typing goes into it", caret && typed === "Typed straight away", `caret ${caret ? "inside" : "elsewhere"}; “${typed}”`);
  });

  await part("site leave dialog", async () => {
    // the mouse, as an author clicks it (WebKit doesn't focus a clicked button)
    await ctx.clickAt(await ctx.control("Cancel"));
    await ctx.waitFor(() => !!__ec.openDialog(), { what: "the leave dialog", timeout: 5000 });
    await ctx.clickAt(await ctx.control("Keep editing"));
    await ctx.sleep(300);
    const kept = await page.evaluate(() => ({ editing: !!__ec.store().editMode, dialog: !!__ec.openDialog(), focus: __ec.describe(__ec.activeElement())?.name }));
    check("Cancel clicked, then Keep editing: focus goes back to Cancel", kept.editing && !kept.dialog && kept.focus === "Cancel", json(kept));
    // HAX's shortcut, pressed in the text: back to the text, the caret where it was
    const tagline = await field("oer-cs-hero > p");
    await ctx.clickAt(tagline);
    await tagline.evaluate((p) => __ec.select(p.firstChild, 2));
    await ctx.press("Control+Shift+Slash");
    await ctx.waitFor(() => !!__ec.openDialog(), { what: "the leave dialog from the shortcut", timeout: 5000 });
    await ctx.press("Escape");
    await ctx.sleep(300);
    const back = await page.evaluate(() => {
      const p = __ec.haxBody().querySelector("oer-cs-hero > p");
      const sel = __ec.selectionNodes(p);
      return { dialog: !!__ec.openDialog(), focus: __ec.describe(__ec.activeElement())?.path, caret: !!sel.anchorNode && p.contains(sel.anchorNode), offset: sel.anchorOffset };
    });
    check("The leave shortcut from the text, then Esc: back in the text with the caret where it was", !back.dialog && /hax-body$/.test(back.focus || "") && back.caret && back.offset === 2, json(back));
    await ctx.exitEdit({ discard: true });
  });

  /* ---------- the hub ---------- */

  await part("hub", async () => {
    await ctx.open(HUB);
    const art = await handle(() => [...(__ec.theme().querySelector("oer-courses-catalog")?.shadowRoot?.querySelectorAll(".art") || [])].find((a) => !a.querySelector("img")) || null);
    if (!art.asElement()) results.push(ctx.skip("The hub's placeholder art is drawn as lines on its background", "every card has a picture"));
    else {
      const m = await plainShare(art);
      check("The hub's placeholder art is drawn as lines on its background, not inverted", m.share >= 70, `${m.share}% of ${m.size} in its background ${m.plain}`);
    }
    const r = await cancelAtOnce();
    check(`${HUB}: Cancel straight after Edit content leaves at once`, r.outcome === "left", `${r.outcome} after ${r.ms} ms`);
    // ArrowDown from the empty intro (Firefox put the caret before the page-break), then typing
    await ctx.enterEdit();
    await clickBox("oer-courses-intro");
    await ctx.press("ArrowDown");
    await ctx.sleep(300);
    await ctx.type("Hello");
    await ctx.sleep(300);
    const typed = { first: (await blocks()).split(" ")[0], loose: await loose(), saves: await saves(), intro: await htmlOf("oer-courses-intro") };
    check("ArrowDown from the hub's empty intro, then typing: nothing lands outside a block or before the page-break, and HAX can save", typed.first === "page-break" && !typed.loose && typed.saves === "HAX can save", json(typed));
    await ctx.exitEdit({ discard: true });
    // ArrowUp from there, then Cancel (Firefox wrote the page-break's attributes in another order)
    await ctx.enterEdit();
    await clickBox("oer-courses-intro");
    await ctx.press("ArrowUp");
    await ctx.sleep(300);
    await ctx.clickAt(await ctx.control("Cancel"));
    const outcome = await ctx.waitFor(() => (!__ec.store().editMode ? "left" : __ec.openDialog() ? "asked" : null), { what: "Cancel to leave or ask", timeout: 10000 });
    if (outcome === "asked") await ctx.exitEdit({ discard: true });
    else await ctx.waitForReading();
    check("ArrowUp from the hub's empty intro, then Cancel: leaves at once, nothing having changed", outcome === "left", outcome);
  });

  /* ---------- a lesson ---------- */

  await part("lesson cancel at once", async () => {
    await ctx.open(LESSON);
    const r = await cancelAtOnce();
    check("A lesson: Cancel straight after Edit content leaves at once", r.outcome === "left", `${r.outcome} after ${r.ms} ms`);
    await ctx.enterEdit();
    const para = await longParagraph();
    await ctx.clickAt(para);
    await caretAtEnd(para);
    await ctx.type(" Changed");
    await ctx.sleep(300);
    await ctx.clickAt(await ctx.control("Cancel"));
    const outcome = await ctx.waitFor(() => (!__ec.store().editMode ? "left" : __ec.openDialog() ? "asked" : null), { what: "Cancel to leave or ask", timeout: 10000 });
    check("…and with a change, Cancel asks", outcome === "asked", outcome);
    if (outcome === "asked") await ctx.clickAt(await ctx.control("Keep editing"));
    await ctx.sleep(200);
  });

  await part("lesson arrows", async () => {
    const para = await longParagraph();
    await ctx.clickAt(para);
    await caretAtEnd(para);
    await ctx.type(" QQQ");
    await ctx.press("ArrowLeft");
    await ctx.press("ArrowLeft");
    await ctx.sleep(300);
    await ctx.type("Z");
    await ctx.sleep(300);
    const text = await para.evaluate((p) => (p.isConnected ? p.textContent.trim().slice(-12) : "(replaced)"));
    const state = await haxState();
    check("Arrow keys in a lesson's paragraph keep the caret there and the typed text", text.endsWith(" Changed QZQQ") || text.endsWith("QZQQ"), `…${text}; ${json(state)}`);
    check("…HAX reads the caret in the content, and its active block is the paragraph", state.haxCaret === "in the content" && state.active === "p" && !state.builderEditable, json(state));
    const own = await page.evaluate(() => {
      const hs = __ec.haxStore();
      const root = __ec.haxBody().getRootNode();
      return hs.getSelection() === (root.getSelection?.() || document.getSelection());
    });
    if (ctx.engine === "webkit") check("…in WebKit through a stand-in for the selection", !own, own ? "HAX's own selection" : "a stand-in");
    else check("…in Chrome and Firefox through HAX's own selection, unchanged", own, own ? "HAX's own" : "a stand-in");
  });

  await part("lesson undo", async () => {
    // by its place: HAX's undo puts back a copy of the whole content
    const index = await (await longParagraph()).evaluate((p) => [...p.parentElement.children].indexOf(p));
    const paraNow = () => handle((i) => __ec.haxBody().children[i], index);
    const text = () => page.evaluate((i) => __ec.haxBody().children[i].textContent, index);
    const typeAtEnd = async (words) => {
      const para = await paraNow();
      await ctx.clickAt(para);
      await caretAtEnd(para);
      const before = await text();
      await ctx.type(words);
      // HAX records an undo step 300 ms after the last change
      await ctx.sleep(700);
      return before;
    };
    const start = await typeAtEnd(" One");
    await ctx.press("Mod+Z");
    await ctx.sleep(500);
    const undone = await text();
    await ctx.press("Mod+Shift+Z");
    await ctx.sleep(500);
    const redone = await text();
    check("⌘Z (Ctrl+Z off a Mac) undoes the typing, through HAX", undone === start, `…${undone.slice(-24)}`);
    check("…and ⌘⇧Z redoes it", redone === `${start} One`, `…${redone.slice(-24)}`);
    // one history: HAX's own Undo after ⌘Z doesn't bring the text back
    await ctx.press("Mod+Z");
    await ctx.sleep(500);
    await ctx.clickAt(await ctx.control("Undo"));
    await ctx.sleep(500);
    const after = await text();
    check("…and the toolbar's Undo after ⌘Z doesn't bring the undone text back", !after.endsWith(" One"), `…${after.slice(-24)}`);
    // focus on the toolbar's Undo button
    await typeAtEnd(" Two");
    await (await ctx.control("Undo")).focus();
    await ctx.press("Mod+Z");
    await ctx.sleep(500);
    check("⌘Z with focus on the toolbar's Undo button undoes", !(await text()).endsWith(" Two"), `…${(await text()).slice(-24)}`);
    // the browser's own Undo (its Edit menu) as HAX's
    await typeAtEnd(" Three");
    const routed = await page.evaluate(() => {
      const e = new InputEvent("beforeinput", { inputType: "historyUndo", bubbles: true, cancelable: true, composed: true });
      __ec.haxBody().dispatchEvent(e);
      return e.defaultPrevented;
    });
    await ctx.sleep(500);
    check("The browser's own Undo (historyUndo) runs HAX's undo instead", routed && !(await text()).endsWith(" Three"), `prevented ${routed}; …${(await text()).slice(-24)}`);
    // a field with an undo of its own keeps it: the block list's search.
    // Neither HAX's undo nor the browser's reaches the content from there
    // (WebKit's, one undo stack for the page as in Safari, tried to).
    await ctx.clickAt(await paraNow());
    await runRail("Insert block below…");
    await ctx.waitFor(() => !!document.querySelector("oer-block-inserter").shadowRoot.querySelector(".panel input"), { what: "the block list" });
    await ctx.type("abc");
    await page.evaluate(() => {
      const body = __ec.haxBody();
      globalThis.__hotfixUndos = 0;
      for (const name of ["undo", "redo"]) {
        const own = body[name];
        body[name] = function (...args) {
          globalThis.__hotfixUndos++;
          return own.apply(this, args);
        };
      }
    });
    const focus = (await ctx.deepActiveElement())?.path;
    const html = await ctx.normalizedHtml();
    await ctx.press("Mod+Z");
    await ctx.sleep(400);
    const same = (await ctx.normalizedHtml()) === html;
    const undos = await page.evaluate(() => {
      const body = __ec.haxBody();
      delete body.undo;
      delete body.redo;
      return globalThis.__hotfixUndos;
    });
    await ctx.press("Escape");
    check("⌘Z in the block list's search box leaves the page alone", undos === 0 && same, `focus on ${focus}; HAX's undo ran ${undos} times; the page ${same ? "unchanged" : "changed"}`);
  });

  await part("lesson duplicate", async () => {
    const para = await longParagraph();
    await ctx.clickAt(para);
    await ctx.sleep(250);
    const index = await para.evaluate((p) => [...p.parentElement.children].indexOf(p));
    await ctx.press("Alt+F10");
    await ctx.press("Enter");
    await ctx.sleep(200);
    const current = () => page.evaluate(() => document.querySelector("oer-block-rail").shadowRoot.activeElement?.querySelector(".text")?.textContent.trim());
    for (let i = 0; i < 10 && (await current()) !== "Duplicate"; i++) await ctx.press("ArrowDown");
    await ctx.press("Enter");
    await ctx.sleep(400);
    await ctx.type("Z");
    await ctx.sleep(300);
    const where = await page.evaluate((i) => {
      const kids = [...__ec.haxBody().children];
      return { original: kids[i]?.textContent.startsWith("Z"), copy: kids[i + 1]?.textContent.startsWith("Z"), active: kids.indexOf(__ec.haxStore().activeNode) - i };
    }, index);
    check("Duplicate from the rail by keyboard: typing goes into the copy", where.copy && !where.original && where.active === 1, json(where));
    await ctx.press("Backspace");
  });

  await part("lesson citation", async () => {
    const para = await longParagraph();
    await ctx.clickAt(para);
    await caretAtEnd(para);
    await page.evaluate(() => {
      const dialog = document.querySelector("oer-cite-dialog") || document.body.appendChild(document.createElement("oer-cite-dialog"));
      dialog.pick = async () => ({ html: "A source for the check." });
      return document.querySelector("oer-block-rail")._cite();
    });
    await ctx.sleep(300);
    await ctx.type("Q");
    await ctx.sleep(300);
    const end = await para.evaluate((p) => __ec.normalize(p.innerHTML).slice(-60));
    // (Chrome and WebKit keep the caret in the superscript even when it's put after it)
    check("Citing leaves the caret after the citation: typing goes after it, not into its number", /<\/sup>Q$/.test(end), `…${end}`);
  });

  await part("lesson paste", async () => {
    // the caret in the first paragraph after the page-break, after "In "
    const first = () => handle(() => __ec.haxBody().querySelector(":scope > page-break + p"));
    const count = (s) => page.evaluate((s) => __ec.haxBody().innerHTML.split(s).length - 1, s);
    const shape = () => page.evaluate(() => [...__ec.haxBody().children].map((c) => `${c.localName}${c.textContent.trim() ? `(${c.textContent.trim().slice(0, 12)})` : ""}`).join(" "));
    await page.evaluate(() => globalThis.addEventListener("paste", (e) => (globalThis.__hotfixPasted = e.clipboardData?.getData("text/html")), true));
    // (clicked on its first line: HAX's invisible block menu sits over the
    // bottom of a paragraph above the active block)
    const place = async () => {
      const p = await first();
      await p.evaluate((p) => p.scrollIntoView({ block: "center" }));
      await ctx.frames();
      await ctx.clickAt(await p.evaluate((p) => ({ x: p.getBoundingClientRect().left + 30, y: p.getBoundingClientRect().top + 10 })));
      await p.evaluate((p) => __ec.select(p.firstChild, 3));
    };
    // its two halves as the shape below shows them
    const [start, rest] = await first().then((p) => p.evaluate((p) => [p.firstChild.textContent.slice(0, 3).trim(), p.textContent.slice(3).trim().slice(0, 8)]));
    const literal = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    await place();
    let cancelled = null;
    if (ctx.engine === "firefox") {
      // a real ⌘C and ⌘V (Firefox gives a synthetic paste's data to no one;
      // its headless clipboard isn't the system's)
      await page.evaluate(() => {
        const div = document.body.appendChild(document.createElement("div"));
        div.id = "hotfix-clip";
        div.innerHTML = "<p>First pasted</p><p>Second pasted</p>";
        const [a, b] = div.querySelectorAll("p");
        document.getSelection().setBaseAndExtent(a.firstChild, 0, b.firstChild, b.firstChild.length);
      });
      await ctx.press("Meta+c");
      await page.evaluate(() => document.getElementById("hotfix-clip").remove());
      await place();
      await ctx.press("Meta+v");
    } else {
      // a synthetic paste: the browser's own would follow unless it's cancelled at once
      cancelled = await page.evaluate(() => {
        const dt = new DataTransfer();
        dt.setData("text/plain", "First pasted\n\nSecond pasted");
        dt.setData("text/html", "<p>First pasted</p><p>Second pasted</p>");
        const e = new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true, composed: true });
        (__ec.activeElement() || __ec.haxBody()).dispatchEvent(e);
        return e.defaultPrevented;
      });
    }
    await ctx.sleep(800);
    const after = await shape();
    const once = (await count("First pasted")) === 1 && (await count("Second pasted")) === 1;
    const between = new RegExp(`^page-break p\\(${literal(start)}\\) p\\(First pasted\\) p\\(Second paste\\) p\\(${literal(rest)}`).test(after);
    check(
      "Pasting two paragraphs in the middle of the first one: they go in once, between its halves, and nothing is lost",
      once && between && cancelled !== false,
      `${cancelled === null ? "a real paste" : `cancelled at once ${cancelled}`}; ${after.slice(0, 130)}`,
    );
    // HTML HAX leaves to the browser (a table) still goes in
    if (ctx.engine === "firefox") {
      await page.evaluate(() => {
        const div = document.body.appendChild(document.createElement("div"));
        div.id = "hotfix-clip";
        div.innerHTML = "<table><tbody><tr><td>Cell pasted</td></tr></tbody></table>";
        const td = div.querySelector("td");
        document.getSelection().setBaseAndExtent(div, 0, div, 1);
        return td.textContent;
      });
      await ctx.press("Meta+c");
      await page.evaluate(() => document.getElementById("hotfix-clip").remove());
      await place();
      await ctx.press("Meta+v");
    } else {
      await place();
      await page.evaluate(() => {
        const dt = new DataTransfer();
        dt.setData("text/plain", "Cell pasted");
        dt.setData("text/html", "<table><tbody><tr><td>Cell pasted</td></tr></tbody></table>");
        (__ec.activeElement() || __ec.haxBody()).dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true, composed: true }));
      });
    }
    await ctx.sleep(800);
    const pasted = await page.evaluate(() => globalThis.__hotfixPasted || "");
    check("…and HTML that HAX leaves to the browser (a table) still goes in, once", (await count("Cell pasted")) === 1, `${await count("Cell pasted")} times; ${(await shape()).slice(0, 130)}; pasted ${pasted.slice(0, 120)}`);
  });

  await part("lesson undo caret", async () => {
    // a fresh start, so that ⌘Z has nothing of the parts before to undo
    await ctx.exitEdit({ discard: true });
    await ctx.open(LESSON);
    await ctx.enterEdit();
    // by its place: HAX's undo puts back a copy of the whole content
    const index = await (await longParagraph()).evaluate((p) => [...p.parentElement.children].indexOf(p));
    const para = () => handle((i) => __ec.haxBody().children[i], index);
    const text = () => page.evaluate((i) => __ec.haxBody().children[i].textContent, index);
    await clickIn(await para());
    await caretAtText(await para(), 20);
    const start = await text();
    await ctx.press("Mod+Z");
    await ctx.sleep(500);
    await ctx.type("X");
    // its own undo step (HAX records one 300 ms after the last change)
    await ctx.sleep(700);
    const first = { text: await text(), loose: await loose(), saves: await saves() };
    const at = 20 + (start.length - start.trimStart().length);
    check("⌘Z with nothing to undo leaves the caret where it was: typing goes on there, and HAX can still save", first.text === `${start.slice(0, at)}X${start.slice(at)}` && !first.loose && first.saves === "HAX can save", `…${first.text.slice(at - 10, at + 10)}…; ${first.loose} loose texts; ${first.saves}`);
    await ctx.sleep(400);
    await caretAtEnd(await para());
    const before = await text();
    await ctx.type(" more");
    await ctx.sleep(700);
    await ctx.press("Mod+Z");
    await ctx.sleep(500);
    await ctx.type("Y");
    await ctx.sleep(300);
    const second = { text: await text(), loose: await loose(), saves: await saves() };
    // (the X typed before can go with it: HAX's undo steps differ by engine and timing)
    check(
      "⌘Z after typing: the caret is where the undone words were, so typing goes on there, and HAX can still save",
      second.text.endsWith(`${before.slice(-12)}Y`) && !second.text.includes(" more") && !second.loose && second.saves === "HAX can save",
      `…${second.text.slice(-24)}; ${second.loose} loose texts; ${second.saves}`,
    );
  });

  await part("lesson enter", async () => {
    const para = await longParagraph();
    await clickIn(para);
    await caretAtEnd(para);
    await ctx.press("Enter");
    await ctx.type("NEXT", { delay: 0 });
    await ctx.sleep(400);
    const next = await para.evaluate((p) => p.nextElementSibling?.textContent);
    check("Enter, then letters typed straight away: they stay in order in the new paragraph", next === "NEXT", `“${next}”`);
  });

  await part("lesson block list", async () => {
    // a list, a quote and columns from the block list take typing straight away
    for (const [name, where] of [
      ["Bulleted list", "ul > li"],
      ["Block quote", "block-quote"],
      ["Column layout", "grid-plate > p"],
    ]) {
      await clickIn(await longParagraph());
      await insertBlock(name);
      await ctx.type("Typed");
      await ctx.sleep(300);
      const r = await page.evaluate((where) => {
        const found = [...__ec.haxBody().querySelectorAll(where)].find((el) => el.textContent.includes("Typed"));
        return { found: !!found, loose: [...__ec.haxBody().childNodes].filter((n) => n.nodeType === 3 && n.data.trim()).length };
      }, where);
      check(`${name} from the block list: typing straight away goes into it`, r.found && !r.loose, `${r.found ? `in its ${where}` : "not in it"}; ${r.loose} loose texts`);
    }
  });

  await part("lesson joins", async () => {
    // Safari's engine joined two differently styled paragraphs by copying the
    // theme's own elements into the page; HAX then reloaded the saved page
    const first = await longParagraph();
    const index = await first.evaluate((p) => [...p.parentElement.children].indexOf(p));
    await page.evaluate((i) => {
      const p = globalThis.document.createElement("p");
      p.innerHTML = "Some <em>stressed</em> words";
      __ec.haxBody().children[i].after(p);
    }, index);
    await ctx.sleep(300);
    const n = (await blocks()).split(" ").length;
    const second = await handle((i) => __ec.haxBody().children[i + 1], index);
    await clickIn(second);
    await caretAtStart(second);
    await backspace();
    await ctx.sleep(400);
    const joined = { text: await page.evaluate((i) => __ec.normalize(__ec.haxBody().children[i].innerHTML).slice(-60), index), blocks: (await blocks()).split(" ").length, bodies: await bodies(), state: await haxState() };
    check("Backspace at the start of a paragraph with emphasis joins it to the one before, nothing else", joined.bodies === 1 && joined.blocks === n - 1 && /Some <em>stressed<\/em> words$/.test(joined.text) && joined.state.haxCaret === "in the content", `${joined.bodies} hax-body; ${n} → ${joined.blocks} blocks; …${joined.text}; ${json(joined.state)}`);
    // Delete at the end of the lesson's lead paragraph, as on the lesson about animation
    await page.evaluate((i) => {
      const p = globalThis.document.createElement("p");
      p.className = "lead";
      p.textContent = "A lead line.";
      __ec.haxBody().children[i].before(p);
    }, index);
    await ctx.sleep(300);
    const next = await page.evaluate((i) => __ec.haxBody().children[i + 1].textContent.trim().slice(0, 12), index);
    const lead = await handle((i) => __ec.haxBody().children[i], index);
    await clickIn(lead);
    await caretAtEnd(lead);
    await ctx.press("Delete");
    await ctx.sleep(400);
    const merged = { text: await page.evaluate((i) => __ec.haxBody().children[i].textContent.trim().slice(0, 30), index), blocks: (await blocks()).split(" ").length, bodies: await bodies() };
    check("Delete at the end of a lead paragraph joins the next one to it, nothing else", merged.bodies === 1 && merged.blocks === n - 1 && merged.text.startsWith(`A lead line.${next}`), `${merged.bodies} hax-body; ${n} → ${merged.blocks} blocks; “${merged.text}…”`);
    await ctx.exitEdit({ discard: true });
  });

  await part("lesson pastes", async () => {
    await ctx.open(LESSON);
    await ctx.enterEdit();
    // the lesson's first long paragraph, by its place (stopgaps, before
    // this, adds a short one), and the blocks around it
    const index = await (await longParagraph()).evaluate((p) => [...p.parentElement.children].indexOf(p));
    const target = () => handle((i) => __ec.haxBody().children[i], index);
    const shapes = async () => (await shape()).split(" | ");
    const was = await shapes();
    const words = (i) => page.evaluate((i) => __ec.haxBody().children[i]?.textContent.replace(/\s+/g, " ").trim() ?? "", i);
    const whole = await words(index);
    // a triple click selects the paragraph; pasted paragraphs take its place
    const triple = async () => {
      const p = await target();
      await clickIn(p);
      const pt = await p.evaluate((p) => ({ x: p.getBoundingClientRect().left + 60, y: p.getBoundingClientRect().top + 10 }));
      await page.mouse.click(pt.x, pt.y, { count: 3 });
      await ctx.sleep(300);
    };
    let how = await pasteData({ html: TWO, text: "First pasted\n\nSecond pasted" }, triple);
    await ctx.sleep(800);
    let after = await shapes();
    const replaced = [...was.slice(0, index), "p(First pasted)", "p(Second pasted)", ...was.slice(index + 1)];
    check(
      "A paragraph selected with a triple click, then two pasted: they take its place, in order, and the page-break stays",
      json(after) === json(replaced) && (await count("First pasted")) === 1,
      `${how === null ? "a real paste" : `cancelled at once ${how}`}; ${after.join(" ").slice(0, 140)}`,
    );
    await ctx.exitEdit({ discard: true });
    await ctx.open(LESSON);
    await ctx.enterEdit();
    // Markdown pasted as plain text into the middle of a paragraph (20 characters in)
    const md = "## Pasted heading\n\n- first item\n- second item\n\nA **bold** line.";
    const middle = async () => {
      const p = await target();
      await clickIn(p);
      await caretAtText(p, 20);
    };
    how = await pasteData({ text: md }, middle);
    await ctx.sleep(800);
    after = await shapes();
    const between = json(after.slice(0, index)) === json(was.slice(0, index)) && json(after.slice(index + 1, index + 4)) === json(["h2(Pasted heading)", "ul(first item secon)", "p(A bold line.)"]) && json(after.slice(index + 5)) === json(was.slice(index + 1));
    // the paragraph's two halves, with nothing lost
    const halves = `${await words(index)}${await words(index + 4)}`;
    check(
      "Markdown pasted into the middle of a paragraph goes in between its halves, in order",
      between && halves.replace(/\s+/g, "") === whole.replace(/\s+/g, "") && (await count("Pasted heading")) === 1,
      `${how === null ? "a real paste" : `cancelled at once ${how}`}; ${after.join(" ").slice(0, 160)}`,
    );
    await ctx.exitEdit({ discard: true });
    await ctx.open(LESSON);
    await ctx.enterEdit();
    // plain text of two lines, and an address, pasted once
    how = await pasteData({ text: "Line one\nLine two" }, middle);
    await ctx.sleep(600);
    const lines = await count("Line one");
    how = [how, await pasteData({ text: "https://example.com/page" }, middle)];
    await ctx.sleep(600);
    const urls = await count("example.com/page");
    check("Plain text of two lines, or a web address, pasted into a paragraph goes in once", lines === 1 && urls === 1, `${lines} and ${urls} times; ${how.every((h) => h === null) ? "real pastes" : `cancelled at once ${how.join(", ")}`}`);
    // Select All, then a paste: the page answers and keeps its page-break
    const before = await shape();
    how = await pasteData({ html: TWO, text: "First pasted\n\nSecond pasted" }, async () => {
      await clickIn(await longParagraph());
      await selectAll();
    });
    await ctx.sleep(800);
    const ok = await answers();
    frozen ||= !ok;
    after = ok ? await shape() : "(no answer)";
    check(
      "Select All, then pasting two paragraphs: the page goes on answering, and the page-break stays",
      ok && after.startsWith("page-break") && (after === before || /^page-break \| p\(First pasted\) \| p\(Second pasted\)$/.test(after)),
      `${after === before ? "nothing pasted over a selection that reaches the page-break" : after.slice(0, 120)}`,
    );
  });

  await part("lesson select all", async () => {
    // a fresh start: the paste over Select All may have replaced the page
    await ctx.exitEdit({ discard: true });
    await ctx.open(LESSON);
    await ctx.enterEdit();
    const before = await blocks();
    await ctx.clickAt(await longParagraph(), { covered: true });
    const selected = await selectAll();
    const reaches = await page.evaluate(() => {
      const s = __ec.selectionNodes(__ec.haxBody());
      if (!s.anchorNode) return false;
      const r = globalThis.document.createRange();
      r.setStart(s.anchorNode, s.anchorOffset);
      r.setEnd(s.focusNode, s.focusOffset);
      if (r.collapsed) r.setStart(s.focusNode, s.focusOffset);
      return r.intersectsNode(__ec.haxBody().querySelector(":scope > page-break"));
    });
    await backspace(1).catch(() => ctx.press("Backspace"));
    await ctx.sleep(400);
    const after = await page.evaluate(() => ({ blocks: [...__ec.haxBody().children].map((c) => c.localName).join(" "), pageBreak: !!__ec.haxBody().querySelector(":scope > page-break") }));
    // a selection that reaches the page-break deletes nothing; one that starts after it deletes the rest
    const pass = reaches ? after.blocks === before : after.pageBreak && after.blocks.split(" ").length > 1;
    check(
      "Select All then Backspace in a lesson: nothing goes when the selection takes in the page-break, and the page-break stays",
      pass,
      `${selected} characters selected, ${reaches ? "page-break included" : "from after the page-break"}; ${before.split(" ").length} → ${after.blocks.split(" ").length} blocks, page-break ${after.pageBreak ? "kept" : "gone"}`,
    );
    await ctx.exitEdit({ discard: true });
  });

  await part("newer Firefox", async () => {
    // Firefox 142 and later have getComposedRanges, as Safari's engine does,
    // but keep the nodes inside shadow roots in the document's selection:
    // HAX's own selection stays (a getComposedRanges added here, as theirs)
    if (ctx.engine !== "firefox") return results.push(ctx.skip("Firefox with getComposedRanges (142 and later): HAX keeps its own selection and live range", "Firefox only"));
    const other = await ctx.newPage();
    await other.page.evaluateOnNewDocument(() => {
      if (!Selection.prototype.getComposedRanges) Selection.prototype.getComposedRanges = function () {
        return this.rangeCount ? [new StaticRange(this.getRangeAt(0))] : [];
      };
    });
    await other.setViewport(1440);
    await other.open(LESSON);
    await other.enterEdit();
    const para = await other.page.evaluateHandle(() => [...__ec.haxBody().querySelectorAll(":scope > p")].find((p) => p.textContent.trim().length > 20));
    await other.clickAt(await para.evaluate((p) => ({ x: p.getBoundingClientRect().left + 30, y: p.getBoundingClientRect().top + 10 })), { covered: true });
    await para.evaluate((p) => __ec.select(p.firstChild, 5));
    const own = await other.page.evaluate(() => {
      const hs = __ec.haxStore();
      const sel = document.getSelection();
      return { composed: typeof sel.getComposedRanges, selection: hs.getSelection() === sel, live: hs.getRange() === sel.getRangeAt(0) };
    });
    check("Firefox with getComposedRanges (142 and later): HAX keeps its own selection and live range", own.composed === "function" && own.selection && own.live, json(own));
    await other.exitEdit({ discard: true }).catch(() => {});
    await other.page.close();
  });

  await part("text editor", async () => {
    // the small rich text editor (course sequences, page headers), outside HAX
    const editor = await handle(() => {
      const el = document.body.appendChild(document.createElement("oer-text-editor"));
      el.label = "Check";
      el.value = "<p>Hello world</p>";
      el.style.cssText = "position:fixed;top:120px;left:40px;width:420px;z-index:99999;";
      return el;
    });
    await page.evaluate(() => document.querySelector("oer-text-editor").updateComplete);
    await ctx.frames();
    const area = await editor.evaluateHandle((el) => el.shadowRoot.querySelector(".area"));
    if (!area.asElement()) throw new Error("oer-text-editor has no .area");
    await ctx.clickAt(area);
    await area.evaluate((a) => {
      const t = a.querySelector("p").firstChild;
      __ec.select(t, 6, t, 11);
    });
    // its Link button (on a page being read, ⌘K is the site's search)
    await ctx.clickAt(await editor.evaluateHandle((el) => el.shadowRoot.querySelector('button[title="Link (⌘K)"]')));
    await ctx.sleep(300);
    await ctx.type("https://example.com");
    await ctx.press("Enter");
    await ctx.sleep(400);
    const htmlNow = await area.evaluate((a) => a.innerHTML);
    check("The small text editor links the selected words", /<a href="https:\/\/example\.com\/?">world<\/a>/.test(htmlNow), htmlNow);
    await editor.evaluate((el) => el.remove());
  });

  return results;
}
