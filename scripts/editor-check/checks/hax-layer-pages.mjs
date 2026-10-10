// The HAX layer (WP-04) on ordinary pages, beside hax-layer.mjs (which has
// it on the course site). Blocks that change their own markup (columns,
// quiz questions, a self-check) make no undo step when editing starts or
// when they're selected; Undo and Redo step through typing on their pages,
// and a quiz keeps its answers; a field edited in Block settings is still
// one step. Blocks pasted into the middle of a paragraph keep the text
// before the caret and their order, on a lesson and in a section's text.
// A callout in a column keeps its text when Backspace is pressed at its
// start.
//
// Fixtures are written into the copy's lesson and course site and put back
// at the end; the quiz is the copy's own page. Nothing is saved.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

// the pages, by id: a save gives a page whose title ends in "?" a new
// address (stopgaps saves the lesson "What is design?")
const SITE_ID = "item-0330a29b-7735-4ac0-afd2-e3b2a88d49e3";
const LESSON_ID = "item-143f3783-959c-45c3-8758-dacef0f6861f";
const QUIZ_ID = "item-52e05a27-2c5e-4c3a-8f99-baffbb07d613";

// a lesson with columns: grid-plate adds ready="" once it has drawn
const COLUMNS_PAGE = `<p>One paragraph.</p>
<grid-plate layout="1-1"><p slot="col-1">Left.</p><p slot="col-2">Right.</p></grid-plate>
<p>Last paragraph.</p>
`;
const LESSON_PAGE = `<p>First paragraph of the lesson.</p>
<p>Second paragraph here.</p>
<h2>A heading</h2>
<p>Third paragraph after the heading.</p>
`;
const CALLOUT_PAGE = `<grid-plate layout="1-1"><p slot="col-1">Intro</p><oer-callout slot="col-1" type="tip" title="A tip"><p>Tip text</p></oer-callout><p slot="col-2">Right.</p></grid-plate>
<p>After the columns.</p>
`;
const HERO_PAGE = `<oer-cs-hero><p>Hero tagline text here</p></oer-cs-hero>
<oer-cs-facts></oer-cs-facts>
<oer-cs-people><p>A note from the instructor.</p></oer-cs-people>
<oer-cs-closing></oer-cs-closing>
`;

/* ---------- in the page ---------- */

// hax-body's blocks, and its HTML without what HAX changes while editing
// or never saves (a block's own state, such as self-check's image-loaded,
// left out by its haxProperties' saveOptions.unsetAttributes)
function snapshot() {
  const body = __ec.haxBody();
  const t = document.createElement("template");
  t.innerHTML = __ec.normalize(body.innerHTML).replace(/\selement-visible(="[^"]*")?/g, "");
  for (const el of t.content.querySelectorAll("*")) {
    for (const name of __ec.haxStore().elementList?.[el.localName]?.saveOptions?.unsetAttributes ?? []) el.removeAttribute(name);
  }
  return {
    blocks: [...body.children].map((c) => `${c.localName}: ${c.textContent.replace(/\s+/g, " ").trim().slice(0, 40)}`),
    html: t.innerHTML,
  };
}

// collapse the selection in the nth match of selector, at offset in its
// first text ("end" for its end)
function caret([selector, index = 0, offset = 0]) {
  const el = __ec.haxBody().querySelectorAll(selector)[index];
  const text = [...el.childNodes].find((n) => n.nodeType === 3);
  el.getRootNode().getSelection().collapse(text, offset === "end" ? text.length : offset);
}

// what each question holds: its answers, which live in a property
function answers() {
  return [...__ec.haxBody().querySelectorAll("multiple-choice, true-false-question")].map((q) => `${q.localName} ${q.answers?.length ?? 0}`).join(", ");
}

export default async function haxLayerPages(ctx) {
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

  const items = JSON.parse(readFileSync(path.join(ctx.siteDir, "site.json"), "utf8")).items;
  const ids = new Map();
  const address = (id) => {
    const item = items.find((i) => i.id === id);
    if (!item) throw new Error(`No page ${id} in the copy's site.json`);
    ids.set(`/${item.slug}`, id);
    return `/${item.slug}`;
  };
  const SITE = address(SITE_ID);
  const LESSON = address(LESSON_ID);
  const QUIZ = address(QUIZ_ID);
  const originals = new Map();
  const write = (pagePath, html) => {
    const file = path.join(ctx.siteDir, "pages", ids.get(pagePath), "index.html");
    if (!originals.has(file)) originals.set(file, readFileSync(file, "utf8"));
    writeFileSync(file, html);
  };

  /* ---------- helpers ---------- */

  const snap = () => page.evaluate(snapshot);
  const stack = () =>
    page.evaluate(() => {
      const s = __ec.haxBody().undoStack;
      return { position: s.undoStackPosition, steps: s.commands.length, canUndo: s.canUndo(), canRedo: s.canRedo() };
    });
  const text = (selector, index = 0) => page.evaluate((s, i) => __ec.haxBody().querySelectorAll(s)[i]?.textContent ?? "(gone)", selector, index);
  // a fresh editing session on a page (fixture written first, if any)
  const edit = async (pagePath, fixture) => {
    if (await ctx.editMode()) await ctx.exitEdit({ discard: true });
    if (fixture) write(pagePath, fixture);
    await ctx.open(pagePath);
    await ctx.enterEdit();
  };
  // click a block or field, by selector and index, as a person does
  const clickField = async (selector, index = 0, { corner = false } = {}) => {
    const el = await page.evaluateHandle((s, i) => __ec.haxBody().querySelectorAll(s)[i] || null, selector, index);
    if (!el.asElement()) throw new Error(`No ${selector} [${index}] in hax-body`);
    await el.evaluate((e) => e.scrollIntoView({ block: "center" }));
    await ctx.frames();
    if (corner) {
      // a block's own top-left corner, clear of the controls it draws
      const box = await el.boundingBox();
      await page.mouse.click(box.x + 8, box.y + 8);
    } else {
      await ctx.clickAt(el, { covered: true });
    }
    await ctx.sleep(300);
  };
  // type at the end of a field, then wait out HAX's 300 ms before a snapshot
  const typeAtEnd = async (selector, words) => {
    await clickField(selector);
    await page.evaluate(caret, [selector, 0, "end"]);
    await ctx.type(words);
    await ctx.sleep(700);
  };
  const keys = async (chord) => {
    await ctx.press(chord);
    await ctx.sleep(800);
  };
  // put data on the clipboard, as copying it elsewhere would, and paste it
  // with ⌘V at the caret
  const paste = async (data) => {
    await page.evaluate((data) => {
      const once = (e) => {
        for (const [type, value] of Object.entries(data)) e.clipboardData.setData(type, value);
        e.preventDefault();
        removeEventListener("copy", once, true);
      };
      addEventListener("copy", once, true);
    }, data);
    for (const [key, command] of [
      ["c", "copy"],
      ["v", "paste"],
    ]) {
      await page.keyboard.down("Meta");
      await page.keyboard.press(key, { commands: [command] });
      await page.keyboard.up("Meta");
    }
    await ctx.sleep(600);
  };
  const TWO = { "text/html": "<p>Alpha pasted</p><p>Beta pasted</p>", "text/plain": "Alpha pasted\n\nBeta pasted" };

  try {
    /* ---------- blocks that change their own markup ---------- */

    await part("columns", async () => {
      await edit(LESSON, COLUMNS_PAGE);
      // grid-plate draws, and adds ready="", after HAX's starting copy
      await ctx.sleep(1500);
      const entered = await stack();
      await typeAtEnd(":scope > p", " AAA");
      await keys("Meta+z");
      await keys("Meta+z");
      const undone = { ...(await stack()), text: await text(":scope > p") };
      await keys("Meta+Shift+z");
      const redone = { ...(await stack()), text: await text(":scope > p") };
      check(
        "On a lesson with columns, entering edit mode is no undo step, and typing, Undo twice and Redo brings the typing back",
        !entered.canUndo && undone.text === "One paragraph." && undone.position === -1 && undone.canRedo && redone.text === "One paragraph. AAA" && !redone.canRedo,
        `steps on entering ${entered.steps}; after Undo twice “${undone.text}” at ${undone.position} (redo ${undone.canRedo}); after Redo “${redone.text}” at ${redone.position}`,
      );
      await ctx.exitEdit({ discard: true });
    });

    await part("quiz", async () => {
      await edit(QUIZ);
      await ctx.sleep(1500);
      const entered = await stack();
      const start = await snap();
      const startAnswers = await page.evaluate(answers);
      for (const selector of [":scope > p", "multiple-choice", "true-false-question", "self-check", ":scope > p"]) {
        await clickField(selector, 0, { corner: true });
        await ctx.sleep(400);
      }
      const clicked = await stack();
      const after = await snap();
      const selfCheck = await page.evaluate(() => [...__ec.haxBody().querySelector("self-check").children].map((c) => c.localName).join(", "));
      check(
        "On a quiz page, entering edit mode and selecting the intro, a question, a true-or-false, a self-check and the intro again is no undo step and changes nothing",
        !entered.canUndo && !clicked.canUndo && after.html === start.html && selfCheck === "p, p",
        `steps: ${entered.steps} on entering, ${clicked.steps} after the clicks; HTML ${after.html === start.html ? "unchanged" : "changed"}; the self-check holds ${selfCheck}`,
      );

      // two typings, back and forth
      await typeAtEnd(":scope > p", " AAA");
      await typeAtEnd(":scope > p", " BBB");
      const ends = [];
      for (const chord of ["Meta+z", "Meta+z", "Meta+Shift+z", "Meta+Shift+z"]) {
        await keys(chord);
        ends.push((await text(":scope > p")).replace(/^.*recorded\./, "…"));
      }
      check("…⌘Z twice takes back both typings, one each, and ⌘⇧Z twice brings both back", json(ends) === json(["… AAA", "…", "… AAA", "… AAA BBB"]), json(ends));
      await keys("Meta+z");
      await keys("Meta+z");
      const undoneAnswers = await page.evaluate(answers);
      await keys("Meta+Shift+z");
      await typeAtEnd(":scope > p", " CCC");
      await keys("Meta+z");
      await keys("Meta+Shift+z");
      const redoneAnswers = await page.evaluate(answers);
      check(
        "…and the questions keep their answers through Undo and Redo",
        startAnswers === "multiple-choice 4, true-false-question 2" && undoneAnswers === startAnswers && redoneAnswers === startAnswers,
        `at the start ${startAnswers}; undone to the start ${undoneAnswers}; after more typing, Undo and Redo ${redoneAnswers}`,
      );

      // a field edited in Block settings still changes the block, as one step
      await clickField("multiple-choice", 0, { corner: true });
      const settings = await ctx.control("Block settings");
      if (!settings) throw new Error("The question shows no Block settings button");
      await ctx.clickAt(settings);
      await ctx.sleep(800);
      const field = await page.evaluateHandle(() => {
        const form = __ec.haxStore().haxTray.shadowRoot.querySelector("#settingsform");
        return __ec.all("input[type=text], input:not([type]), textarea", form).find((i) => __ec.visible(i) && /^Which 1995/.test(i.value)) || null;
      });
      if (!field.asElement()) throw new Error("Block settings shows no field holding the question");
      const before = await stack();
      await ctx.clickAt(field, { covered: true });
      await ctx.press("End");
      await ctx.type(" (pick one)");
      await ctx.sleep(1000);
      const question = await page.evaluate(() => __ec.haxBody().querySelector("multiple-choice").getAttribute("question"));
      const edited = await stack();
      check(
        "Editing the question in Block settings still changes it, as one undo step",
        question?.endsWith("(pick one)") && edited.steps === before.steps + 1,
        `question “${question}”; steps ${before.steps}→${edited.steps}`,
      );
      await ctx.press("Escape");
      await ctx.sleep(300);
      await ctx.exitEdit({ discard: true });
    });

    /* ---------- blocks pasted into a paragraph ---------- */

    await part("pastes", async () => {
      const cases = [
        ["Two paragraphs pasted in the middle of a lesson's paragraph", LESSON, LESSON_PAGE, [":scope > p", 1, 6], TWO, ["Second", "Alpha pasted", "Beta pasted", "paragraph here."]],
        ["…at its start", LESSON, LESSON_PAGE, [":scope > p", 1, 0], TWO, ["Alpha pasted", "Beta pasted", "Second paragraph here."]],
        ["One paragraph pasted in the middle", LESSON, LESSON_PAGE, [":scope > p", 1, 6], { "text/html": "<p>Alpha pasted</p>", "text/plain": "Alpha pasted" }, ["Second", "Alpha pasted", "paragraph here."]],
      ];
      for (const [name, pagePath, fixture, at, data, expected] of cases) {
        await edit(pagePath, fixture);
        await clickField(at[0], at[1]);
        await page.evaluate(caret, at);
        await paste(data);
        const { blocks } = await snap();
        const texts = blocks.map((b) => b.replace(/^\w+: /, ""));
        // the pasted blocks and the halves, in order, between the lesson's
        // first paragraph and its heading
        const between = texts.slice(texts.indexOf("First paragraph of the lesson.") + 1, texts.indexOf("A heading"));
        const nested = await page.evaluate(() => !!__ec.haxBody().querySelector("p p"));
        check(`${name} keeps the text around the caret, in order`, json(between) === json(expected) && !nested, `${json(between)}${nested ? "; a paragraph inside a paragraph" : ""}`);
      }

      // in a section's text: the hero's tagline
      await edit(SITE, HERO_PAGE);
      await clickField("oer-cs-hero > p");
      await page.evaluate(caret, ["oer-cs-hero > p", 0, 4]);
      const before = (await snap()).blocks.map((b) => b.split(":")[0]);
      await paste({ "text/html": "<p>First pasted</p><p>Second pasted</p>", "text/plain": "First pasted\n\nSecond pasted" });
      const hero = await page.evaluate(() => [...__ec.haxBody().querySelector("oer-cs-hero").children].map((c) => `${c.localName}: ${c.textContent.trim()}`));
      const after = (await snap()).blocks.map((b) => b.split(":")[0]);
      check(
        "Two paragraphs pasted in the middle of the hero's tagline stay in the hero, in order, with all of its text",
        json(hero) === json(["p: Hero", "p: First pasted", "p: Second pasted", "p: tagline text here"]) && json(after) === json(before),
        `${json(hero)}; blocks ${after.join(" ")}`,
      );
      await ctx.exitEdit({ discard: true });
    });

    /* ---------- a block in a column ---------- */

    await part("callout in a column", async () => {
      await edit(LESSON, CALLOUT_PAGE);
      await clickField("oer-callout > p");
      await page.evaluate(caret, ["oer-callout > p", 0, 0]);
      await ctx.press("Backspace");
      await ctx.press("Backspace");
      await ctx.sleep(400);
      const kept = await page.evaluate(() => {
        const body = __ec.haxBody();
        return { callout: body.querySelector("oer-callout")?.textContent.trim() ?? "(gone)", intro: body.querySelector("grid-plate > p[slot='col-1']")?.textContent.trim() };
      });
      // the beforeinput the browser would send, joining the callout's text
      // to the paragraph before it in the column
      const guarded = await page.evaluate(() => {
        const body = __ec.haxBody();
        const intro = body.querySelector("grid-plate > p[slot='col-1']")?.firstChild;
        const tip = body.querySelector("oer-callout > p")?.firstChild;
        if (!intro || !tip) return false;
        const range = new StaticRange({ startContainer: intro, startOffset: intro.length, endContainer: tip, endOffset: 0 });
        const e = new InputEvent("beforeinput", { inputType: "deleteContentBackward", targetRanges: [range], bubbles: true, cancelable: true, composed: true });
        body.dispatchEvent(e);
        return e.defaultPrevented;
      });
      check(
        "Backspace at the start of a callout's text in a column keeps the callout and its text, as it does outside columns",
        kept.callout === "Tip text" && kept.intro === "Intro" && guarded,
        `callout “${kept.callout}”, the column's paragraph “${kept.intro}”; a joining deletion ${guarded ? "refused" : "allowed"}`,
      );
      await ctx.exitEdit({ discard: true });
    });
  } finally {
    // the copy's pages as they were, for the checks after this one
    for (const [file, html] of originals) writeFileSync(file, html);
  }
  return results;
}
