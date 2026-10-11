// The Sections sheet (WP-12, spec §4.9, §7.1–7.3): the editing bar's
// Sections opens a non-modal sheet over the page's left side (modal on a
// phone) that leaves <main> as wide as it was; an APG tree with one
// level-1 row per section, each named with its state ("Books, hidden from
// readers"); ↑ ↓ Home End and type-ahead move, → ← open and close a
// section's items, Enter goes to the section on the page (focus on its
// name tag), Space selects it and keeps focus in the sheet, Alt+Shift+↓
// moves the section (focus stays on its row), Delete removes one, Shift+F10
// shows its actions; Not on this page with Add back, and Add section…,
// asking the inserter (oer-insert-request); Esc closes it with focus back
// on Sections; open is remembered for the next editing; axe finds nothing
// serious in it.
//
// The course site's page is written into the copy before it opens and put
// back at the end. Nothing is saved.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const SITE_ID = "item-0330a29b-7735-4ac0-afd2-e3b2a88d49e3";

// What you'll make is left out (for Not on this page); Books is hidden
const PAGE = `<oer-cs-hero><p>Design it on screen, then make it real.</p></oer-cs-hero>
<oer-cs-facts></oer-cs-facts>
<oer-cs-learn><h2>What you'll be able to do</h2><oer-cs-outcome><h3>Cut with confidence</h3><p>Plan, cut and finish parts.</p></oer-cs-outcome><oer-cs-outcome><h3>Print what you model</h3><p>Slice meshes for FDM.</p></oer-cs-outcome></oer-cs-learn>
<oer-cs-semester></oer-cs-semester>
<oer-cs-books hidden-from-readers></oer-cs-books>
<oer-cs-people><h2>Who teaches it</h2><p>A note from the instructor.</p></oer-cs-people>
<oer-cs-tools><h2>In the shop</h2><oer-cs-tool><p>Epilog laser cutter</p></oer-cs-tool></oer-cs-tools>
<oer-cs-faq><h2>Questions</h2><oer-cs-question><h3>Is it online?</h3><p>No, in the studio.</p></oer-cs-question></oer-cs-faq>
<oer-cs-closing></oer-cs-closing>
`;

/* ---------- in the page ---------- */

// the sheet as it is: its rows, where focus is, the selection
function sheetNow() {
  const host = document.querySelector("oer-site-outline");
  const root = host?.shadowRoot;
  const tree = root?.querySelector('[role="tree"]');
  const rows = tree ? [...tree.querySelectorAll('[role="treeitem"]')] : [];
  const f = __ec.activeElement();
  const sections = [...__ec.haxBody().children].filter((el) => OerEditor.state.body && el.localName.startsWith("oer-cs-"));
  const sheet = root?.querySelector(".sheet");
  const dialog = root?.querySelector("dialog");
  return {
    open: !!host?.open && !!sheet?.checkVisibility(),
    modal: !!dialog?.matches(":modal"),
    rows: rows.map((r) => ({
      name: r.getAttribute("aria-label"),
      level: r.getAttribute("aria-level"),
      pos: r.getAttribute("aria-posinset"),
      size: r.getAttribute("aria-setsize"),
      expanded: r.getAttribute("aria-expanded"),
      selected: r.getAttribute("aria-selected"),
      tab: r.getAttribute("tabindex"),
    })),
    focusRow: f?.getAttribute?.("role") === "treeitem" && root?.contains(f) ? f.getAttribute("aria-label") : null,
    focus: __ec.describe(f)?.path ?? null,
    onTag: !!f?.classList?.contains("tag") && /oer-block-(frame|rail)/.test(__ec.describe(f).path),
    unit: OerEditor.state.unit?.localName ?? null,
    order: sections.map((s) => s.localName),
    missing: root ? [...root.querySelectorAll(".missing li .name")].map((n) => n.textContent.trim()) : [],
    sheetBox: sheet ? (({ left, right, top, bottom }) => ({ left, right, top, bottom }))(sheet.getBoundingClientRect()) : null,
  };
}

export default async function outline(ctx) {
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

  const now = () => page.evaluate(sheetNow);
  const inBar = (sel) => page.evaluateHandle((sel) => __ec.theme().shadowRoot.querySelector("oer-edit-bar").shadowRoot.querySelector(sel), sel);
  const mainWidth = () => page.evaluate(() => Math.round(__ec.theme().shadowRoot.querySelector("main").getBoundingClientRect().width * 10) / 10);
  const key = async (k, wait = 250) => {
    await ctx.press(k);
    await ctx.sleep(wait);
  };
  // the next oer-insert-request the page sends
  const listenInsert = () =>
    page.evaluate(() => {
      globalThis.__insert = null;
      globalThis.addEventListener("oer-insert-request", (e) => (globalThis.__insert = { kind: e.detail?.kind, tag: e.detail?.tag ?? null, near: e.detail?.near?.localName ?? null }), { once: true });
    });
  const heardInsert = () => page.evaluate(() => globalThis.__insert);
  // (open already when it was left open: remembered)
  const openFromBar = async () => {
    if (await page.evaluate(() => !!document.querySelector("oer-site-outline")?.open)) {
      await page.evaluate(() => document.querySelector("oer-site-outline").focusTree());
      return;
    }
    await ctx.clickAt(await inBar('[data-id="sections"]'));
    await ctx.sleep(400);
  };
  const focusRow = async (label) => {
    await page.evaluate((label) => {
      const row = [...document.querySelector("oer-site-outline").shadowRoot.querySelectorAll('[role="treeitem"]')].find((r) => r.getAttribute("aria-label").startsWith(label));
      row.focus();
    }, label);
    await ctx.sleep(150);
  };

  writeFileSync(file, PAGE);
  try {
    await part("open", async () => {
      await ctx.open(SITE);
      await ctx.enterEdit();
      await ctx.sleep(600);
      const before = await mainWidth();
      await openFromBar();
      const s = await now();
      const after = await mainWidth();
      const expanded = await (await inBar('[data-id="sections"]')).evaluate((b) => b.getAttribute("aria-expanded"));
      check("Sections opens the sheet, with focus on a row in its tree, and says it's open (aria-expanded)", s.open && !s.modal && !!s.focusRow && expanded === "true", json({ open: s.open, focusRow: s.focusRow, expanded }));
      check("Opening the sheet leaves main's width unchanged", before > 0 && before === after, json({ before, after, sheet: s.sheetBox }));
      const level1 = s.rows.filter((r) => r.level === "1");
      check(
        "The sheet has role tree with one level-1 treeitem per section (with its place in the set)",
        level1.length === s.order.length && level1.every((r, i) => r.pos === String(i + 1) && r.size === String(s.order.length)),
        json({ rows: level1.map((r) => r.name), sections: s.order }),
      );
      const books = level1.find((r) => r.name.startsWith("Books"));
      check("A hidden section's row name includes 'hidden from readers'", /hidden from readers/.test(books?.name || ""), books?.name);
      const learn = level1.find((r) => r.name.startsWith("What you'll learn"));
      const facts = level1.find((r) => r.name.startsWith("Facts"));
      check("Rows say what's in them and where it comes from (\"What you'll learn, 2 outcomes\", \"Facts, from the course page\")", /2 outcomes/.test(learn?.name || "") && learn?.expanded === "false" && /from the course page/.test(facts?.name || ""), json([learn, facts]));
      check("One row takes Tab (roving tabindex)", s.rows.filter((r) => r.tab === "0").length === 1, json(s.rows.map((r) => r.tab)));
      check("Not on this page lists the standard section the page lacks", json(s.missing) === json(["What you'll make"]), json(s.missing));

      const axe = await ctx.axe({ context: { include: [["oer-site-outline"]] } });
      const bad = axe.rules.filter((v) => ["serious", "critical"].includes(v.impact));
      check("axe reports no serious or critical violations in the sheet", bad.length === 0, json(bad.map((v) => `${v.id} (${v.nodes}): ${json(v.targets)}`)));

      // Add back and Add section… ask the inserter
      await listenInsert();
      await ctx.clickAt(await page.evaluateHandle(() => document.querySelector("oer-site-outline").shadowRoot.querySelector(".missing button")));
      const back = await heardInsert();
      check("Add back asks the inserter for that section (oer-insert-request { kind: section, tag })", back?.kind === "section" && back.tag === "oer-cs-make", json(back));
      await listenInsert();
      await ctx.clickAt(await page.evaluateHandle(() => document.querySelector("oer-site-outline").shadowRoot.querySelector(".btn.add")));
      const add = await heardInsert();
      check("Add section… asks the inserter for its section list near the selection", add?.kind === "section" && !add.tag && !!add.near, json(add));
      // (Esc from a button in the sheet closes it too)
      await page.evaluate(() => document.querySelector("oer-site-outline").shadowRoot.querySelector(".btn.add").focus());
      await key("Escape", 300);
      check("Esc from any control in the sheet closes it", !(await now()).open, "");
      // (left editing, the next part's reload would leave a copy of the edits to offer back)
      await ctx.exitEdit({ discard: true });
    });

    await part("keys", async () => {
      await ctx.open(SITE);
      await ctx.enterEdit();
      await ctx.sleep(600);
      await openFromBar();
      await focusRow("Hero");
      // ArrowDown then Enter
      await key("ArrowDown");
      let s = await now();
      const down = s.focusRow;
      await key("Enter", 500);
      s = await now();
      check("ArrowDown then Enter selects that section on the page and puts deep focus on its name tag", /^Facts/.test(down || "") && s.unit === "oer-cs-facts" && s.onTag && s.open, json({ down, unit: s.unit, focus: s.focus }));
      const facts = s.rows.find((r) => r.name.startsWith("Facts"));
      check("The selected section's row is aria-selected", facts?.selected === "true" && s.rows.filter((r) => r.selected === "true").length === 1, json(facts));

      // Ctrl+Shift+` from the name tag goes back to the sheet, on its row
      await key("Control+Shift+Backquote", 300);
      s = await now();
      check("Ctrl+Shift+` from the selection goes back to the sheet, on the selected section's row", /^Facts/.test(s.focusRow || ""), json(s.focus));

      // Space selects, focus stays
      await focusRow("Tools");
      await key(" ", 400);
      s = await now();
      check("Space selects the section on the page and keeps focus on its row", s.unit === "oer-cs-tools" && /^Tools/.test(s.focusRow || ""), json({ unit: s.unit, focus: s.focusRow }));

      // Alt+Shift+ArrowDown moves the section; focus stays on its row
      await focusRow("What you'll learn");
      const was = (await now()).order;
      await key("Alt+Shift+ArrowDown", 700);
      s = await now();
      const at = (o) => o.indexOf("oer-cs-learn");
      check("Alt+Shift+ArrowDown on a row moves the section in the DOM and focus stays on that row", at(s.order) === at(was) + 1 && /^What you'll learn/.test(s.focusRow || ""), json({ was, now: s.order, focus: s.focusRow }));
      const rowsOrder = s.rows.filter((r) => r.level === "1").map((r) => r.name.split(",")[0]);
      check("…and the sheet follows the page", rowsOrder.indexOf("What you'll learn") === at(s.order), json(rowsOrder));
      await key("Alt+Shift+ArrowUp", 700);

      // → opens the items, → again to the first, ← back
      await focusRow("What you'll learn");
      await key("ArrowRight");
      s = await now();
      const open = s.rows.find((r) => r.name.startsWith("What you'll learn"));
      const kids = s.rows.filter((r) => r.level === "2");
      await key("ArrowRight");
      const first = (await now()).focusRow;
      await key("ArrowLeft");
      const backTo = (await now()).focusRow;
      check(
        "→ opens a section's items (level 2, named by their titles), → goes to the first, ← back to the section",
        open?.expanded === "true" && kids.length === 2 && kids[0].name === "Cut with confidence" && kids[0].size === "2" && first === "Cut with confidence" && /^What you'll learn/.test(backTo || ""),
        json({ open, kids, first, backTo }),
      );

      // Home, End, type-ahead
      await key("End");
      const end = (await now()).focusRow;
      await key("Home");
      const home = (await now()).focusRow;
      await key("q");
      const typed = (await now()).focusRow;
      check("Home, End and type-ahead move between rows", /^Hero/.test(home || "") && /^Ready to start/.test(end || "") && /^Questions/.test(typed || ""), json({ home, end, typed }));

      // Shift+F10: the row's actions, Esc back to the row
      await focusRow("Tools");
      await key("Shift+F10", 400);
      const menu = await page.evaluate(() => {
        const m = document.querySelector("oer-site-outline").shadowRoot.querySelector(".menu");
        return m ? { items: [...m.querySelectorAll('[role="menuitem"]')].map((b) => b.textContent.replace(/\s+/g, " ").trim()), focus: __ec.activeElement()?.getAttribute("role") } : null;
      });
      check("Shift+F10 shows the row's actions (the rail's verbs), focus in the menu", !!menu && menu.focus === "menuitem" && ["Move up", "Move down", "Hide from readers", "Remove section"].every((l) => menu.items.some((i) => i.startsWith(l))), json(menu));
      await key("Escape");
      s = await now();
      check("Esc in the actions goes back to the row, the sheet still open", s.open && /^Tools/.test(s.focusRow || ""), json(s.focusRow));

      // Delete: a generated section goes at once, focus stays in the sheet
      await focusRow("The semester");
      await key("Delete", 900);
      s = await now();
      check("Delete on a row removes the section (through ops.js) and focus stays in the sheet", !s.order.includes("oer-cs-semester") && !!s.focusRow && !s.rows.some((r) => r.name.startsWith("The semester")), json({ order: s.order, focus: s.focusRow }));
      await key("Mod+Z", 900);

      // Esc closes, focus back on Sections
      await focusRow("Hero");
      await key("Escape", 400);
      s = await now();
      const back = await page.evaluate(() => {
        const f = __ec.activeElement();
        return { id: f?.dataset?.id ?? null, expanded: f?.getAttribute("aria-expanded") ?? null };
      });
      check("Esc closes the sheet and returns focus to Sections", !s.open && back.id === "sections" && back.expanded === "false", json(back));
      await ctx.exitEdit({ discard: true });
    });

    await part("remembered", async () => {
      await ctx.open(SITE);
      await ctx.enterEdit();
      await ctx.sleep(600);
      await openFromBar();
      await ctx.exitEdit({ discard: true });
      await ctx.sleep(500);
      await ctx.enterEdit();
      await ctx.waitFor(() => document.querySelector("oer-site-outline")?.open, { what: "the sheet to open again" }).catch(() => {});
      await ctx.sleep(400);
      let s = await now();
      check("Left open, the sheet opens again as editing begins, without taking focus", s.open && !s.focusRow, json({ open: s.open, focus: s.focus }));
      await page.evaluate(() => document.querySelector("oer-site-outline").focusTree());
      await key("Escape", 300);
      await ctx.exitEdit({ discard: true });
      await ctx.sleep(500);
      await ctx.enterEdit();
      await ctx.sleep(1500);
      s = await now();
      check("Closed, it stays closed the next time", !s.open, json(s.open));
    });

    await part("phone", async () => {
      await ctx.setViewport(390);
      await ctx.open(SITE);
      await ctx.enterEdit();
      await ctx.sleep(600);
      const before = await mainWidth();
      // (on a phone Sections is under ⋯ More: the bar's own event)
      await page.evaluate(() => globalThis.dispatchEvent(new CustomEvent("oer-sections-toggle", { cancelable: true, detail: { opener: null } })));
      await ctx.sleep(500);
      let s = await now();
      const after = await mainWidth();
      check("On a phone the sheet is modal, with focus in its tree, and the page keeps its width", s.open && s.modal && !!s.focusRow && before === after, json({ open: s.open, modal: s.modal, focus: s.focusRow, before, after }));
      const fits = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
      check("…and the page doesn't scroll sideways", fits && s.sheetBox.right <= 390, json(s.sheetBox));
      await focusRow("Tools");
      await key("Enter", 600);
      s = await now();
      check("Enter on a phone closes the sheet and puts focus on the section's name tag", !s.open && s.unit === "oer-cs-tools" && s.onTag, json({ open: s.open, unit: s.unit, focus: s.focus }));
      await ctx.setViewport(1440);
    });
  } finally {
    writeFileSync(file, original);
    await ctx.setViewport(1440).catch(() => {});
  }
  return results;
}
