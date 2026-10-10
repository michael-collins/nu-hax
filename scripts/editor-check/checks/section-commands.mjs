// Block commands inside a course site's sections (what the phase B review
// found): the rail's Move up and down, Duplicate and Remove, with the caret
// in an outcome's title or a section selected, act on the outcome or the
// section through the editor (ops.js), never on the field alone (HAX's own
// commands made an outcome with two titles, one with none, and a title
// after its sentence; a section duplicated or removed without asking);
// what can't be done says why. The frame's ↑ / ↓ do the same, and its grip
// doesn't drag a field out of its item. Sections, items and their fields
// have no Block settings (an outcome's opened an empty dialog). After an
// Undo back to how the page began, a click in a field makes it the active
// block (HAX's starting copy has no editable state, and the frame and rail
// stayed on the block before). HAX's hidden block toolbar takes no room, so
// a phone's page doesn't scroll sideways for it.
//
// The course site's page is written into the copy before it opens and put
// back at the end. Nothing is saved.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

// the course site's page, by id (a save can give a page a new address)
const SITE_ID = "item-0330a29b-7735-4ac0-afd2-e3b2a88d49e3";

const PAGE = `<oer-cs-hero><p>Design it on screen, then make it real.</p></oer-cs-hero>
<oer-cs-facts></oer-cs-facts>
<oer-cs-learn><h2>What you'll be able to do</h2><oer-cs-outcome><h3>Cut with confidence</h3><p>Plan, cut and finish parts.</p></oer-cs-outcome><oer-cs-outcome><h3>Print what you model</h3><p>Slice meshes for FDM.</p></oer-cs-outcome></oer-cs-learn>
<oer-cs-semester></oer-cs-semester>
<oer-cs-tools><h2>Tools you'll use</h2><oer-cs-tool><p>Epilog laser cutter</p></oer-cs-tool></oer-cs-tools>
<oer-cs-closing></oer-cs-closing>
`;

// the outcomes as they stand: each one's fields, by tag and text
function outcomes() {
  return [...__ec.haxBody().querySelectorAll("oer-cs-outcome")].map((o) => [...o.children].map((c) => `${c.localName}:${c.textContent.trim()}`).join(" | "));
}

export default async function sectionCommands(ctx) {
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
  const SITE = `/${items.find((i) => i.id === SITE_ID).slug}`;
  const file = path.join(ctx.siteDir, "pages", SITE_ID, "index.html");
  const original = readFileSync(file, "utf8");

  const handle = (fn, ...args) => page.evaluateHandle(fn, ...args);
  const list = () => page.evaluate(outcomes);
  // the rail's Block menu, opened: its items as "label" or "label (off: why)"
  const openBlock = async () => {
    const button = await handle(() => document.querySelector("oer-block-rail").shadowRoot.querySelector('.rail button[aria-label="Block"]'));
    if (!button.asElement()) throw new Error("The rail has no Block button");
    // (a click on it closes it when it's open)
    if (!(await page.evaluate(() => !!document.querySelector("oer-block-rail").shadowRoot.querySelector(".menu")))) await ctx.clickAt(button);
    await ctx.sleep(200);
    return page.evaluate(() =>
      [...document.querySelector("oer-block-rail").shadowRoot.querySelectorAll(".menu [role^=menuitem]")].map((b) => {
        const label = b.querySelector(".text")?.textContent.trim();
        return b.getAttribute("aria-disabled") === "true" ? `${label} (off: ${b.querySelector(".end")?.textContent.trim() || ""})` : label;
      }),
    );
  };
  const runBlock = async (label) => {
    await openBlock();
    const item = await handle((label) => [...document.querySelector("oer-block-rail").shadowRoot.querySelectorAll(".menu [role^=menuitem]")].find((b) => b.querySelector(".text")?.textContent.trim() === label) || null, label);
    if (!item.asElement()) throw new Error(`The rail's Block menu has no ${label}`);
    await ctx.clickAt(item);
    await ctx.sleep(700);
  };
  const title = (i) => handle((i) => __ec.haxBody().querySelectorAll("oer-cs-outcome")[i]?.querySelector("h3") || null, i);
  const clickTitle = async (i) => {
    const el = await title(i);
    await el.evaluate((f) => f.scrollIntoView({ block: "center" }));
    await ctx.frames();
    await ctx.clickAt(el);
    await ctx.sleep(300);
  };
  const undo = async () => {
    await ctx.press("Mod+Z");
    await ctx.sleep(700);
  };
  const frameButtons = () => page.evaluate(() => [...document.querySelector("oer-block-frame").shadowRoot.querySelectorAll(".label button")].map((b) => b.getAttribute("aria-label") || b.textContent.trim()));
  // a click on a section's own padding, above what's in it: the section selected
  const selectSection = async (tag) => {
    const spot = await page.evaluate(async (tag) => {
      const s = __ec.haxBody().querySelector(tag);
      (s.querySelector(":scope > h2") || s).scrollIntoView({ block: "center" });
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const r = s.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + 12) };
    }, tag);
    await ctx.clickAt(spot);
    await ctx.sleep(400);
  };

  writeFileSync(file, PAGE);
  try {
    await part("outcome title", async () => {
      await ctx.open(SITE);
      await ctx.enterEdit();
      const start = await list();
      await clickTitle(0);
      const menu = await openBlock();
      await page.keyboard.press("Escape");
      check("With the caret in an outcome's title, the rail's Block menu removes the outcome", menu.includes("Remove outcome") && !menu.includes("Remove block"), menu.join(", "));
      check("…and has no Block settings in the frame's label", !(await frameButtons()).some((b) => /settings/i.test(b)), json(await frameButtons()));

      await clickTitle(0);
      await runBlock("Duplicate");
      const duplicated = await list();
      check(
        "Duplicate there duplicates the outcome, each with one title",
        duplicated.length === start.length + 1 && duplicated[0] === duplicated[1] && duplicated.every((o) => o.split(" | ").filter((f) => f.startsWith("h3:")).length === 1),
        json(duplicated),
      );
      await undo();
      check("…and one Undo takes the copy back", json(await list()) === json(start), json(await list()));

      await clickTitle(0);
      await runBlock("Move down");
      const moved = await list();
      check("Move down there moves the outcome after the next, title first", json(moved) === json([start[1], start[0]]), json(moved));
      await undo();

      // (Undo has gone back to how the page began, which HAX took before it
      // made the blocks editable)
      await clickTitle(1);
      const active = await page.evaluate(() => __ec.haxStore().activeNode?.textContent ?? null);
      check("After Undo back to how the page began, a click in an outcome's title makes it the active block", active === "Print what you model", `active: “${active}”`);
      await runBlock("Remove outcome");
      const removed = await list();
      const said = await ctx.liveRegionText();
      check("Remove outcome removes it whole, and says so with Undo", json(removed) === json([start[0]]) && /removed/i.test(said), `${json(removed)}; said “${said}”`);
      await undo();
      check("…and one Undo puts it back", json(await list()) === json(start), json(await list()));

      // the frame's grip, by keyboard: the outcome moves, its fields stay together
      await clickTitle(1);
      const grip = await handle(() => document.querySelector("oer-block-frame").shadowRoot.querySelector(".grip"));
      await grip.evaluate((g) => g.focus());
      await ctx.press("ArrowUp");
      await ctx.sleep(700);
      const gripped = await list();
      check("The frame's grip moves the outcome, not its title, with ↑", json(gripped) === json([start[1], start[0]]), json(gripped));
      await undo();
      await ctx.exitEdit({ discard: true });
    });

    await part("sections", async () => {
      await ctx.open(SITE);
      await ctx.enterEdit();
      // the tagline: the hero doesn't move, and its paragraphs are its own
      const tagline = await handle(() => __ec.haxBody().querySelector("oer-cs-hero > p"));
      await ctx.clickAt(tagline);
      await ctx.sleep(300);
      const hero = await openBlock();
      await page.keyboard.press("Escape");
      check("In the tagline, Move up is off and says the hero stays at the top", hero.some((m) => /^Move up \(off: The hero stays at the top/.test(m)), hero.join(", "));
      check("…while Duplicate and Remove block are the paragraph's own", hero.includes("Duplicate") && hero.includes("Remove block"), hero.join(", "));

      await selectSection("oer-cs-tools");
      const tools = await openBlock();
      await page.keyboard.press("Escape");
      check("A selected section's Duplicate is off, one per page, and Remove says section", tools.some((m) => /^Duplicate \(off: Only one per page/.test(m)) && tools.includes("Remove section"), tools.join(", "));
      check("A selected section's label has no Block settings", !(await frameButtons()).some((b) => /settings/i.test(b)), json(await frameButtons()));
      const order = await page.evaluate(() => [...__ec.haxBody().children].map((c) => c.localName));
      await runBlock("Move up");
      const after = await page.evaluate(() => [...__ec.haxBody().children].map((c) => c.localName));
      check("Move up there moves the section, one step", after.indexOf("oer-cs-tools") === order.indexOf("oer-cs-tools") - 1, after.join(" "));
      await undo();
      // Remove section asks first, as the section has a tool in it
      await selectSection("oer-cs-tools");
      await runBlock("Remove section");
      const asked = await page.evaluate(() => !!__ec.openDialog());
      check("Remove section asks first when something's written in it", asked, `dialog ${asked ? "open" : "not open"}`);
      if (asked) await ctx.clickAt(await ctx.control("Keep it"));
      await ctx.exitEdit({ discard: true });
    });

    await part("phone", async () => {
      await ctx.setViewport(390);
      await ctx.open(SITE);
      await ctx.enterEdit();
      await clickTitle(0);
      await ctx.sleep(400);
      const plate = await page.evaluate(() => {
        const el = __ec.haxBody().shadowRoot.querySelector("hax-plate-context");
        const r = el.getBoundingClientRect();
        const main = __ec.theme().shadowRoot.querySelector("main");
        return { right: Math.round(r.right), width: Math.round(r.width), mainScroll: main.scrollWidth, mainClient: main.clientWidth };
      });
      check("At 390, HAX's hidden block toolbar takes no room and main doesn't scroll sideways", plate.width === 0 && plate.mainScroll <= plate.mainClient, json(plate));
      await ctx.exitEdit({ discard: true });
      await ctx.setViewport(1440);
    });
  } finally {
    writeFileSync(file, original);
  }
  return results;
}
