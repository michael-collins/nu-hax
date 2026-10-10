// Spike A (WP-01 in docs/editor-redesign/work-packages.md): measures, in
// Chrome, the structural primitives the editor redesign rests on.
//   S1  items as nested HAX grids (haxInsert, duplicate, delete), and keys
//       stopped before hax-body's window handlers
//   S2  manual slot assignment with HAX, and the slot="heading" fallback
//   S7  controls in shadow DOM inside contentEditable grid hosts
// It copies the site (the last commit by default), adds spike-blocks.js and
// a page of spike sections (page.html) to the copy only, builds and serves
// it, and prints a JSON table of {check, variant, engine, pass, detail}.
// A failing check is a result (a no-go), not a failure of the run: it exits
// 0 when every check was measured, and 1 when one couldn't be.
//
//   node scripts/editor-check/spikes/structure/run.mjs [--port 3104] [--source head|worktree]
//        [--only s1,keys,s2,s7,sel] [--keep] [--evidence docs/editor-spikes/structure]
// --evidence copies results.json and the screenshots to that folder.
import puppeteer from "puppeteer-core";
import { copyFileSync, readFileSync, writeFileSync, appendFileSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { startScratch, WORK_DIR } from "../../lib/scratch.mjs";
import { editor } from "../../lib/editor.mjs";
import { runAxe } from "../../lib/axe.mjs";

const HERE = new URL("./", import.meta.url).pathname;
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
// the scratch page the spike sections go on: a short article, in the copy only
const SLUG = "articles/end-of-lesson-discussion";
const PAGE = `/${SLUG}`;
const VARIANTS = {
  manual: { section: "oer-spike-learn", item: "oer-spike-outcome" },
  fallback: { section: "oer-spike-learn-fb", item: "oer-spike-outcome-fb" },
};
const GROUPS = ["s1", "keys", "s2", "s7", "sel"];

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const port = Number(opt("--port", 3104));
const source = opt("--source", "head");
const keep = args.includes("--keep");
const only = opt("--only", GROUPS.join(",")).split(",");
const evidence = opt("--evidence", null);

const stamp = new Date().toISOString().replace(/\.\d+Z$/, "").replace(/[-:]/g, "").replace("T", "-");
const reportDir = path.join(WORK_DIR, "reports", `structure-${port}-${stamp}`);
mkdirSync(reportDir, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rows = [];
const record = (check, variant, pass, detail) => rows.push({ check, variant, engine: "chrome", pass: !!pass, measured: true, detail });

/** The copy gets the spike blocks (imported from custom.js) and the spike page. */
function prepare(site) {
  copyFileSync(path.join(HERE, "spike-blocks.js"), path.join(site, "custom/src/spike-blocks.js"));
  appendFileSync(path.join(site, "custom/src/custom.js"), '\nimport "./spike-blocks.js";\n');
  const items = JSON.parse(readFileSync(path.join(site, "site.json"), "utf8")).items;
  const id = items.find((i) => i.slug === SLUG)?.id;
  if (!id) throw new Error(`No ${SLUG} page in the copy to put the spike sections on`);
  writeFileSync(path.join(site, "pages", id, "index.html"), readFileSync(path.join(HERE, "page.html"), "utf8"));
}

/* ---------- in the page ---------- */

// Installed in every page as globalThis.__spike (next to the harness's __ec).
function spikeHelpers() {
  const FIELD = /^(h1|h2|h3|p|li)$/;
  const sp = {
    body: () => globalThis.__ec?.haxBody(),
    /** The n-th spike section with this tag: in hax-body while editing, the theme's reader copy otherwise. */
    section(tag, n = 0) {
      const editing = !!globalThis.__ec?.store()?.editMode;
      const root = editing ? sp.body() : globalThis.__ec?.theme();
      return root?.querySelectorAll(tag)[n] || null;
    },
    rendered: (el) => !!el && el.isConnected && el.getClientRects().length > 0 && el.checkVisibility(),
    /** Where an element is, from hax-body (or the theme): "oer-spike-learn > oer-spike-outcome[2] > h3". */
    path(el) {
      if (!el) return null;
      const parts = [];
      for (let n = el; n && n.localName !== "hax-body" && n.localName !== "custom-oer-docs-theme"; n = n.parentElement) {
        const same = n.parentElement ? [...n.parentElement.children].filter((c) => c.localName === n.localName) : [n];
        parts.unshift(same.length > 1 ? `${n.localName}[${same.indexOf(n) + 1}]` : n.localName);
      }
      return parts.join(" > ") || el.localName;
    },
    field(node) {
      for (let n = node?.nodeType === 1 ? node : node?.parentElement; n; n = n.parentElement) {
        if (FIELD.test(n.localName)) return n;
        if (n.localName === "hax-body") return null;
      }
      return null;
    },
    selectionObject() {
      const root = sp.body()?.getRootNode() ?? document;
      return root.getSelection?.() ?? document.getSelection();
    },
    /** The caret as hax-body's shadow root reports it (Chrome's ShadowRoot.getSelection). */
    caret() {
      const sel = sp.selectionObject();
      if (!sel?.rangeCount) return null;
      const f = sp.field(sel.anchorNode);
      const el = sel.anchorNode?.nodeType === 1 ? sel.anchorNode : sel.anchorNode?.parentElement;
      return { field: f ? sp.path(f) : null, node: sp.path(el), offset: sel.anchorOffset, collapsed: sel.isCollapsed };
    },
    /** Put the caret at the start or end of an element's text (in the element itself when it's empty). */
    placeCaret(el, at = "end") {
      const sel = sp.selectionObject();
      const range = document.createRange();
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const texts = [];
      while (walker.nextNode()) texts.push(walker.currentNode);
      if (!texts.length) range.setStart(el, 0);
      else if (at === "start") range.setStart(texts[0], 0);
      else range.setStart(texts.at(-1), texts.at(-1).length);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      return sp.caret();
    },
    activeNode() {
      const n = globalThis.__ec?.haxStore()?.activeNode;
      return n ? sp.path(n) : null;
    },
    attrs(el) {
      return el ? { ray: el.hasAttribute("data-hax-ray"), editable: el.getAttribute("contenteditable"), role: el.getAttribute("role") } : null;
    },
    /** How a section's children are slotted and drawn. */
    health(host) {
      const kids = [...host.children];
      const items = kids.filter((c) => /^oer-spike-outcome/.test(c.localName));
      const heading = kids.find((c) => c.localName === "h2");
      const slotOf = (n) => (n.assignedSlot ? n.assignedSlot.name || "(default)" : null);
      const list = host.shadowRoot.querySelector("[role=list]");
      const lr = list?.getBoundingClientRect();
      const inList = (n) => {
        const r = n.getBoundingClientRect();
        return !!lr && r.height > 0 && r.top >= lr.top - 1 && r.bottom <= lr.bottom + 1 && r.left >= lr.left - 1 && r.right <= lr.right + 1;
      };
      return {
        manual: host.shadowRoot.slotAssignment === "manual",
        children: kids.map((c) => `${c.localName}${c.textContent.trim() ? `("${c.textContent.trim().slice(0, 18)}")` : ""}→${slotOf(c) ?? "unassigned"}${sp.rendered(c) ? "" : " (not drawn)"}`),
        items: items.length,
        renderedItems: items.filter(sp.rendered).length,
        itemsInList: items.filter((n) => sp.rendered(n) && inList(n)).length,
        heading: heading ? { slot: slotOf(heading), rendered: sp.rendered(heading), aboveList: !!lr && heading.getBoundingClientRect().bottom <= lr.top + 1, inList: inList(heading) } : null,
        fieldsDrawn: items.every((it) => [...it.children].every(sp.rendered)),
        others: kids.filter((c) => c !== heading && !items.includes(c)).map((c) => ({ tag: c.localName, slot: slotOf(c), rendered: sp.rendered(c), inList: inList(c) })),
        // the order items are drawn in, left to right and top to bottom
        drawnOrder: items
          .filter(sp.rendered)
          .map((n) => ({ n, r: n.getBoundingClientRect() }))
          .sort((a, b) => a.r.top - b.r.top || a.r.left - b.r.left)
          .map(({ n }) => items.indexOf(n) + 1),
      };
    },
    /** Wait until HAX has finished inserting, plus two frames (600 ms at most); returns the time taken. */
    async settled(body = sp.body()) {
      const t0 = performance.now();
      const frame = () => new Promise((r) => requestAnimationFrame(r));
      while (body._contentState?.getState?.("inserting") && performance.now() - t0 < 600) await frame();
      await frame();
      await frame();
      return Math.round(performance.now() - t0);
    },
    /** Record, for ms, the active node, HAX's inserting flag and editing attributes as they change. */
    watch(ms) {
      const body = sp.body();
      const t0 = performance.now();
      const events = [];
      const at = () => Math.round(performance.now() - t0);
      const mo = new MutationObserver((list) => {
        for (const m of list) {
          if (m.type === "attributes" && ["contenteditable", "data-hax-ray", "role"].includes(m.attributeName) && /^(h2|h3|p)$/.test(m.target.localName)) {
            events.push({ t: at(), el: sp.path(m.target), attr: m.attributeName, value: m.target.getAttribute(m.attributeName) });
          }
        }
      });
      mo.observe(body, { subtree: true, attributes: true });
      let active;
      let inserting;
      const poll = () => {
        const a = sp.activeNode();
        if (a !== active) events.push({ t: at(), active: (active = a) });
        const ins = !!body._contentState?.getState?.("inserting");
        if (ins !== inserting) events.push({ t: at(), inserting: (inserting = ins) });
        if (performance.now() - t0 < ms) requestAnimationFrame(poll);
        else mo.disconnect();
      };
      poll();
      sp.events = events;
    },
    /** Where the caret is, sampled every 50 ms for ms. */
    async sampleCaret(ms = 1000) {
      const out = [];
      for (let t = 0; t <= ms; t += 50) {
        out.push(sp.caret()?.field ?? null);
        await new Promise((r) => setTimeout(r, 50));
      }
      return out;
    },
    log: () => globalThis.__spikeLog || [],
    clearLog() {
      globalThis.__spikeLog = [];
    },
    /** The chain of shadow hosts down to an element, as an axe context. */
    axeContext(el) {
      const chain = [];
      for (let n = el; n; n = n.getRootNode().host || null) chain.unshift(n.localName);
      return { include: [chain] };
    },
  };
  globalThis.__spike = sp;
}

// Logs when hax-body's window key handlers run, so listener order can be
// read from __spikeLog. Wrapped on the prototype before the first edit
// session binds them.
function wrapHaxKeys() {
  customElements.whenDefined("hax-body").then(() => {
    const proto = customElements.get("hax-body").prototype;
    for (const [name, type] of [
      ["_onKeyDown", "keydown"],
      ["_onKeyUp", "keyup"],
    ]) {
      const original = proto[name];
      proto[name] = function (e) {
        (globalThis.__spikeLog ??= []).push({ t: Math.round(performance.now()), listener: "hax", type, key: e.key });
        return original.call(this, e);
      };
    }
  });
}

/* ---------- running ---------- */

let scratch = null;
let browser = null;

/** A fresh browser context with the spike page open (and in edit mode unless reading). */
async function fresh({ signedOut = false, edit = !signedOut } = {}) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  page.on("pageerror", (e) => console.log(`  page error: ${e.message.split("\n")[0]}`));
  await page.evaluateOnNewDocument(spikeHelpers);
  await page.evaluateOnNewDocument(wrapHaxKeys);
  const ed = editor(page, { base: scratch.base, siteDir: scratch.dir, reportDir });
  await ed.setViewport(1440);
  await ed.open(PAGE, { signedOut });
  if (edit) await ed.enterEdit();
  return { ed, page, close: () => context.close().catch(() => {}) };
}

/** A handle on a spike element, found in the page by a function of __spike. */
const handle = async (page, fn, ...a) => {
  const h = await page.evaluateHandle(fn, ...a);
  const el = h.asElement();
  if (!el) throw new Error(`Nothing found by ${fn.toString().slice(0, 80)}`);
  return el;
};
const sectionEl = (page, tag, n = 0) => handle(page, (tag, n) => __spike.section(tag, n), tag, n);
const fieldEl = (page, tag, n, sel) => handle(page, (tag, n, sel) => __spike.section(tag, n)?.querySelector(sel), tag, n, sel);

/** Click an element in the middle of the screen (clear of the sticky bar), as a person scrolls to it first. */
async function clickCentred(ed, el, options) {
  await el.evaluate((e) => e.scrollIntoView({ block: "center" }));
  await ed.frames();
  await ed.clickAt(el, options);
}

/** Click a field, then put the caret at its start or end. */
async function caretIn(ed, el, at = "end") {
  await clickCentred(ed, el);
  await sleep(150);
  return el.evaluate((e, at) => __spike.placeCaret(e, at), at);
}

/**
 * The accessibility tree under an element, from Chrome's own tree (DevTools
 * protocol). The element is an expression run in the page, since handles
 * belong to puppeteer's own session.
 */
async function axTree(page, expression) {
  const client = await page.createCDPSession();
  try {
    await client.send("Accessibility.enable");
    const { result } = await client.send("Runtime.evaluate", { expression });
    const { node } = await client.send("DOM.describeNode", { objectId: result.objectId });
    const { nodes } = await client.send("Accessibility.getFullAXTree");
    const byId = new Map(nodes.map((n) => [n.nodeId, n]));
    const build = (n) => ({
      role: n.role?.value,
      name: n.name?.value || "",
      level: n.properties?.find((p) => p.name === "level")?.value?.value,
      ignored: !!n.ignored,
      children: (n.childIds || []).map((id) => byId.get(id)).filter(Boolean).map(build),
    });
    const root = nodes.find((n) => n.backendDOMNodeId === node.backendNodeId);
    return root ? build(root) : null;
  } finally {
    await client.detach();
  }
}

/** What the tree says: headings (and whether they're in a list), lists and their items, and all the text. */
function axSummary(tree) {
  const headings = [];
  const lists = [];
  const text = [];
  const walk = (n, inList, list) => {
    if (!n.ignored) {
      if (n.role === "heading") headings.push({ level: n.level, name: n.name, inList });
      if (n.role === "StaticText" || n.role === "text") text.push(n.name);
      if (n.role === "list") {
        list = { items: 0, itemHeadings: 0, others: [] };
        lists.push(list);
        inList = true;
      } else if (list && n.role === "listitem") {
        list.items++;
        if (JSON.stringify(n).includes('"role":"heading"')) list.itemHeadings++;
        list = null;
      } else if (list && !["generic", "none", "StaticText", "InlineTextBox", "LineBreak"].includes(n.role)) {
        // something other than an item directly in the list
        list.others.push(n.role);
        list = null;
      }
    }
    for (const c of n.children) walk(c, inList, list);
  };
  if (tree) walk(tree, false, null);
  return { headings, lists, text: text.join(" ").replace(/\s+/g, " ").trim() };
}

/* ---------- S2: manual slots, and the slot="heading" fallback ---------- */

/** Whether a section draws every item in its list, in DOM order, with the heading above the list. */
function healthy(h) {
  return (
    h.renderedItems === h.items &&
    h.itemsInList === h.items &&
    h.fieldsDrawn &&
    !!h.heading?.rendered &&
    h.heading.aboveList &&
    !h.heading.inList &&
    h.drawnOrder.every((v, i) => v === i + 1)
  );
}
const brief = (h) => `${h.renderedItems}/${h.items} items drawn, ${h.itemsInList} in the list, heading ${h.heading ? `${h.heading.slot ?? "unassigned"}${h.heading.aboveList ? ", above the list" : ""}${h.heading.inList ? ", IN the list" : ""}` : "missing"}, order ${h.drawnOrder.join(",")}`;

async function s2Render() {
  for (const signedOut of [true, false]) {
    const view = signedOut ? "reading" : "editing";
    const { ed, page, close } = await fresh({ signedOut });
    try {
      for (const [variant, v] of Object.entries(VARIANTS)) {
        const section = await sectionEl(page, v.section);
        await section.evaluate((e) => e.scrollIntoView({ block: "start" }));
        await ed.settle();
        await ed.screenshot(`s2-${variant}-${view}`);
        const h = await section.evaluate((e) => __spike.health(e));
        record("S2 renders the reader layout", `${variant}, ${view}`, healthy(h), `${brief(h)}. Children: ${h.children.join("; ")}`);
        const ax = axSummary(await axTree(page, `__spike.section(${JSON.stringify(v.section)})`));
        const h2 = ax.headings.find((x) => x.level === 2);
        const list = ax.lists[0];
        const placeholders = /Outcome title|What students will be able to do/.test(ax.text);
        record(
          "S2 accessibility tree: heading outside the list, N listitems",
          `${variant}, ${view}`,
          !!h2 && !h2.inList && list?.items === h.items && list.itemHeadings === h.items && !list.others.length && !placeholders,
          `h2 "${h2?.name ?? "none"}"${h2?.inList ? " inside the list" : " outside the list"}; ${ax.lists.length} list(s), ${list?.items ?? 0} listitems (${list?.itemHeadings ?? 0} with an h3)${list?.others.length ? `, also ${list.others.join(", ")} in the list` : ""}; placeholder text ${placeholders ? "IN" : "not in"} the tree`,
        );
        const axe = await runAxe(page, { context: await section.evaluate((e) => __spike.axeContext(e)) });
        record("S2 axe on the section (WCAG 2.2 AA)", `${variant}, ${view}`, axe.violations === 0, axe.violations ? axe.rules.map((r) => `${r.id} (${r.impact}, ${r.nodes})`).join("; ") : "no violations");
      }
    } finally {
      await close();
    }
  }
}

/**
 * Undo (on) or restore (off) the blocks' user-select: none on what they
 * draw in shadow DOM, in a section and its items, to measure caret movement
 * as the spec drew it (shadow controls between fields).
 */
const selectableChrome = (page, tag, on) =>
  page.evaluate(
    (tag, on) => {
      const s = __spike.section(tag);
      for (const host of [s, ...s.children]) {
        if (!host.shadowRoot) continue;
        host.__selectable ??= new CSSStyleSheet();
        host.__selectable.replaceSync(".editing, .editing * { user-select: auto; }");
        const others = host.shadowRoot.adoptedStyleSheets.filter((x) => x !== host.__selectable);
        host.shadowRoot.adoptedStyleSheets = on ? [...others, host.__selectable] : others;
      }
    },
    tag,
    on,
  );

/** Arrow keys across slotted fields, and clicking into empty fields. */
async function s2Caret() {
  const { ed, page, close } = await fresh();
  try {
    for (const [variant, v] of Object.entries(VARIANTS)) {
      const f = (sel, n = 0) => fieldEl(page, v.section, n, sel);
      const items = `:scope > ${v.item}`;
      const sec = v.section;
      const it = (n, field) => `${sec} > ${v.item}[${n}] > ${field}`;
      const after = await handle(page, (tag) => __spike.section(tag).nextElementSibling, sec);
      const afterPath = await after.evaluate((e) => __spike.path(e));
      // as the spec drew it first, then with the blocks' user-select: none
      for (const selectable of [true, false]) {
        await selectableChrome(page, sec, selectable);
        const label = `${variant}, ${selectable ? "shadow chrome selectable (as drawn in the spec)" : "shadow chrome user-select: none"}`;
        const steps = [];
        const step = async (name, el, at, key, expect) => {
          await el.evaluate((e, at) => __spike.placeCaret(e, at), at);
          await ed.press(key);
          await sleep(80);
          const got = (await page.evaluate(() => __spike.caret()))?.field ?? null;
          steps.push({ name, got, expect, ok: expect ? got === expect : !!got });
        };
        const heading = await f(":scope > h2");
        await caretIn(ed, heading, "end");
        await step("h2 end → right", heading, "end", "ArrowRight", it(1, "h3"));
        await step("item 1 title end → right", await f(`${items}:nth-of-type(1) > h3`), "end", "ArrowRight", it(1, "p"));
        await step("item 1 text end → right", await f(`${items}:nth-of-type(1) > p`), "end", "ArrowRight", it(2, "h3"));
        await step("item 2 text end → right (into the empty title)", await f(`${items}:nth-of-type(2) > p`), "end", "ArrowRight", it(3, "h3"));
        await step("empty item 3 text → right (out of the section)", await f(`${items}:nth-of-type(3) > p`), "end", "ArrowRight", afterPath);
        await step("item 2 title start → left", await f(`${items}:nth-of-type(2) > h3`), "start", "ArrowLeft", it(1, "p"));
        await step("next block's start → left (into the empty item 3 text)", after, "start", "ArrowLeft", it(3, "p"));
        await step("h2 end → down", heading, "end", "ArrowDown", it(1, "h3"));
        await step("item 1 text end → down (cards side by side)", await f(`${items}:nth-of-type(1) > p`), "end", "ArrowDown", null);
        await step("item 2 title start → up", await f(`${items}:nth-of-type(2) > h3`), "start", "ArrowUp", null);
        // every ArrowRight from the heading to the next block: does the caret visit every field, in order?
        await heading.evaluate((e) => __spike.placeCaret(e, "end"));
        const visited = [];
        let last = null;
        let same = 0;
        for (let i = 0; i < 260; i++) {
          await page.keyboard.press("ArrowRight");
          const c = await page.evaluate(() => __spike.caret());
          const at = c?.field ?? c?.node ?? "nothing";
          if (at !== visited.at(-1)) visited.push(at);
          const key = `${c?.node}@${c?.offset}`;
          same = key === last ? same + 1 : 0;
          last = key;
          if (same >= 4) {
            visited.push(`STUCK (${key})`);
            break;
          }
          if (!at.startsWith(sec)) break;
        }
        const order = [it(1, "h3"), it(1, "p"), it(2, "h3"), it(2, "p"), it(3, "h3"), it(3, "p"), afterPath];
        const walked = JSON.stringify(visited) === JSON.stringify(order);
        const wrong = steps.filter((x) => !x.ok);
        record(
          "S2 arrow keys move the caret across slotted fields",
          label,
          !wrong.length && walked,
          `ArrowRight from the heading ${walked ? "visits every field in order and leaves the section" : `goes ${visited.map((x) => x.replace(`${sec} > `, "")).join(" → ")}`}. ` +
            steps.map((x) => `${x.name}: ${x.got?.replace(`${sec} > `, "") ?? "nowhere"}${x.ok ? "" : ` (expected ${x.expect?.replace(`${sec} > `, "") ?? "a field"})`}`).join("; "),
        );
      }

      // the third item's title and text are empty: click where the placeholder is drawn, and type
      const typed = [];
      for (const [field, text] of [
        ["h3", "Typed title"],
        ["p", "Typed sentence"],
      ]) {
        const el = await f(`${items}:nth-of-type(3) > ${field}`);
        await clickCentred(ed, el);
        await sleep(150);
        const caret = await page.evaluate(() => __spike.caret());
        await ed.type(text);
        await sleep(150);
        const after = await el.evaluate((e) => ({ text: e.textContent, active: __spike.activeNode(), placeholder: e.parentElement.shadowRoot.querySelector(e.localName === "h3" ? ".ph-title" : ".ph-text").hidden }));
        typed.push({ field, caretField: caret?.field, text: after.text, ok: after.text === text && caret?.field === it(3, field), placeholderHidden: after.placeholder, active: after.active });
      }
      record(
        "S2 a click on an empty field puts the caret in it",
        variant,
        typed.every((t) => t.ok && t.placeholderHidden),
        typed.map((t) => `empty ${t.field}: caret in ${t.caretField ?? "nothing"}, typed text "${t.text}", placeholder ${t.placeholderHidden ? "hidden" : "STILL SHOWN"}, active node ${t.active}`).join("; "),
      );
    }
    // an empty heading, in the empty note section (manual slots)
    const h2 = await fieldEl(page, "oer-spike-note", 1, ":scope > h2");
    await clickCentred(ed, h2);
    await sleep(150);
    const caret = await page.evaluate(() => __spike.caret());
    await ed.type("Typed heading");
    await sleep(150);
    const text = await h2.evaluate((e) => e.textContent);
    record("S2 a click on an empty heading puts the caret in it", "manual (note section)", text === "Typed heading", `caret in ${caret?.field ?? "nothing"}, typed text "${text}"`);
    await ed.screenshot("s2-typed-empty-fields");
  } finally {
    await close();
  }
}

/** Undo and redo replace hax-body's HTML: do the sections draw their items again? */
async function s2Undo() {
  for (const [variant, v] of Object.entries(VARIANTS)) {
    const { ed, page, close } = await fresh();
    try {
      const section = await sectionEl(page, v.section);
      const health = () => section.evaluate((e) => (e.isConnected ? __spike.health(e) : null));
      const current = () => page.evaluate((tag) => __spike.health(__spike.section(tag)), v.section);
      const title = await fieldEl(page, v.section, 0, `:scope > ${v.item} > h3`);
      await caretIn(ed, title, "end");
      await ed.type(" now");
      await sleep(700);
      const added = await page.evaluate(async (tag, itemTag) => {
        const s = __spike.section(tag);
        const body = __spike.body();
        body.haxInsert(itemTag, "<h3>Added item</h3><p>Its sentence.</p>", {}, s.querySelectorAll(`:scope > ${itemTag}`)[1]);
        await __spike.settled(body);
        await new Promise((r) => setTimeout(r, 700));
        return body.undoStack?.commands?.length ?? null;
      }, v.section, v.item);
      const states = [{ step: "after typing and adding an item", h: await current() }];
      const act = async (label, fn) => {
        await page.evaluate(fn);
        await sleep(500);
        states.push({ step: label, h: await current(), sameElement: !!(await health()) });
      };
      await act("undo 1", () => __spike.body().undo());
      await act("undo 2", () => __spike.body().undo());
      await act("redo 1", () => __spike.body().redo());
      await act("redo 2", () => __spike.body().redo());
      const ok = states.every((s) => healthy(s.h));
      record(
        "S2 slots are re-assigned after undo and redo",
        variant,
        ok,
        `${added} undo steps. ` + states.map((s) => `${s.step}: ${brief(s.h)}${s.sameElement === false ? " (section re-created)" : ""}`).join("; "),
      );
    } finally {
      await close();
    }
  }
}

/** Edit HTML of the whole page (haxToContent, then importContent), new content imported, and stray paragraphs. */
async function s2Html() {
  const { ed, page, close } = await fresh();
  try {
    const before = await page.evaluate(async (variants) => {
      const html = await __spike.body().haxToContent();
      return { html, health: Object.fromEntries(Object.entries(variants).map(([k, v]) => [k, __spike.health(__spike.section(v.section))])) };
    }, VARIANTS);
    writeFileSync(path.join(reportDir, "s2-saved.html"), before.html);
    for (const [variant, v] of Object.entries(VARIANTS)) {
      const m = before.html.match(new RegExp(`<${v.section}[\\s\\S]*?</${v.section}>`));
      const saved = m?.[0] ?? "";
      const slotAttrs = (saved.match(/\sslot="[^"]*"/g) || []).length;
      const junk = /data-hax-|contenteditable|role=/.test(saved);
      record(
        "S2 saved HTML is clean",
        variant,
        !junk && (variant === "manual" ? slotAttrs === 0 : slotAttrs === 1),
        `${slotAttrs} slot attribute(s)${variant === "fallback" ? " (the heading's, expected)" : ""}; ${junk ? "HAX attributes LEFT IN" : "no data-hax-, contenteditable or role"}; ${saved.length} characters`,
      );
    }
    // Edit HTML of the whole page does this: the page's HTML, imported again
    const roundTrip = await page.evaluate(async (html, variants) => {
      const body = __spike.body();
      const ready = new Promise((r) => body.addEventListener("hax-body-content-ready", r, { once: true }));
      body.importContent(html);
      await ready;
      await new Promise((r) => setTimeout(r, 400));
      const again = await body.haxToContent();
      // HAX adds a line break between nested blocks on every pass; only that may differ
      const tags = (h) => h.replace(/>\s+</g, "><").trim();
      return { same: tags(again) === tags(html), grew: again.length - html.length, health: Object.fromEntries(Object.entries(variants).map(([k, v]) => [k, __spike.health(__spike.section(v.section))])) };
    }, before.html, VARIANTS);
    for (const [variant] of Object.entries(VARIANTS)) {
      const h = roundTrip.health[variant];
      record(
        "S2 slots after an Edit HTML round trip",
        variant,
        healthy(h) && roundTrip.same,
        `${brief(h)}; the HTML ${roundTrip.same ? "is unchanged" : "CHANGED"} after importing it back, apart from whitespace between tags (${roundTrip.grew} characters more: HAX adds a line break between nested blocks on each pass)`,
      );
    }

    // new content, as Edit HTML with changes or a restored version brings it: a fourth item and a loose paragraph
    const html2 = Object.values(VARIANTS).reduce(
      (html, v) =>
        html.replace(
          `</${v.section}>`,
          `<p>A loose paragraph.</p><${v.item}><h3>Imported item</h3><p>From importContent.</p></${v.item}></${v.section}>`,
        ),
      before.html,
    );
    const imported = await page.evaluate(async (html, variants) => {
      const body = __spike.body();
      const ready = new Promise((r) => body.addEventListener("hax-body-content-ready", r, { once: true }));
      body.importContent(html);
      await ready;
      await new Promise((r) => setTimeout(r, 400));
      return Object.fromEntries(Object.entries(variants).map(([k, v]) => [k, __spike.health(__spike.section(v.section))]));
    }, html2, VARIANTS);
    for (const [variant] of Object.entries(VARIANTS)) {
      const h = imported[variant];
      const loose = h.others.find((o) => o.tag === "p");
      record("S2 slots after importContent of new content", variant, healthy(h) && h.items === 4, brief(h));
      record(
        "S2 a paragraph a section doesn't take shows in the stray slot",
        `${variant}, imported`,
        variant === "manual" ? loose?.slot === "stray" && loose.rendered && !loose.inList : loose?.rendered && !loose.inList,
        loose ? `slot ${loose.slot ?? "none"}, ${loose.rendered ? "drawn" : "not drawn"}${loose.inList ? " INSIDE the list" : ""}` : "no loose paragraph found",
      );
    }
    await (await sectionEl(page, VARIANTS.fallback.section)).evaluate((e) => e.scrollIntoView({ block: "start" }));
    await ed.settle();
    await ed.screenshot("s2-stray-fallback-editing");
    await (await sectionEl(page, VARIANTS.manual.section)).evaluate((e) => e.scrollIntoView({ block: "start" }));
    await ed.settle();
    await ed.screenshot("s2-stray-manual-editing");

    // a paragraph typed or pasted straight into a section (no import): live DOM
    const live = await page.evaluate(async (variants) => {
      const out = {};
      for (const [k, v] of Object.entries(variants)) {
        const s = __spike.section(v.section);
        const p = document.createElement("p");
        p.textContent = "Typed between items.";
        s.insertBefore(p, s.querySelectorAll(`:scope > ${v.item}`)[1]);
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        out[k] = { slot: p.assignedSlot ? p.assignedSlot.name || "(default)" : null, rendered: __spike.rendered(p), health: __spike.health(s) };
      }
      return out;
    }, VARIANTS);
    for (const [variant, r] of Object.entries(live)) {
      const loose = r.health.others.find((o) => o.tag === "p" && o.slot !== "stray") || r.health.others.find((o) => o.tag === "p");
      record(
        "S2 a paragraph a section doesn't take shows in the stray slot",
        `${variant}, added live`,
        variant === "manual" ? r.slot === "stray" && r.rendered : r.rendered && !loose?.inList,
        `slot ${r.slot ?? "none"}, ${r.rendered ? "drawn" : "not drawn"}; the section: ${brief(r.health)}`,
      );
    }

    // the source view of one section (the plate's "Modify HTML source")
    try {
      const view = await page.evaluate(async (tag) => {
        const body = __spike.body();
        const hs = __ec.haxStore();
        const s = __spike.section(tag);
        hs.activeNode = s;
        await new Promise((r) => setTimeout(r, 300));
        const op = (eventName) => body._haxContextOperation({ detail: { eventName }, composedPath: () => [] });
        await op("hax-source-view-toggle");
        const editorEl = await new Promise((resolve, reject) => {
          const t0 = performance.now();
          const tick = () => {
            const ce = s.parentElement?.localName === "code-editor" ? s.parentElement : null;
            if (ce && ce.value) resolve(ce);
            else if (performance.now() - t0 > 15000) reject(new Error(`no code editor with a value after 15 s (wrapped: ${!!ce})`));
            else setTimeout(tick, 100);
          };
          tick();
        });
        const value = editorEl.value;
        await op("hax-source-view-toggle");
        await new Promise((r) => setTimeout(r, 600));
        const replaced = __spike.section(tag);
        return { replaced: replaced !== s, value: value.slice(0, 200), health: __spike.health(replaced) };
      }, VARIANTS.manual.section);
      record("S2 slots after the section's own Edit HTML (source view)", "manual", healthy(view.health), `section ${view.replaced ? "replaced by a new element" : "kept"}; ${brief(view.health)}`);
    } catch (e) {
      record("S2 slots after the section's own Edit HTML (source view)", "manual", false, `Couldn't open the source view: ${e.message}`);
    }
  } finally {
    await close();
  }
}

/** Why assignment must follow every change: children nobody assigned aren't drawn, and moves keep the old order. */
async function s2Vanish() {
  const { close, page } = await fresh();
  try {
    const r = await page.evaluate(async (tag, itemTag) => {
      const s = __spike.section(tag);
      const frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      s.__observer.disconnect();
      const p = document.createElement("p");
      p.textContent = "Never assigned.";
      s.append(p);
      const items = s.querySelectorAll(`:scope > ${itemTag}`);
      s.insertBefore(items[1], items[0]);
      await frames();
      const stale = { pDrawn: __spike.rendered(p), order: __spike.health(s).drawnOrder };
      s.assignSlots();
      await frames();
      const fixed = { pDrawn: __spike.rendered(p), pSlot: p.assignedSlot?.name ?? null, order: __spike.health(s).drawnOrder };
      s.__observer.observe(s, { childList: true, subtree: true, characterData: true });
      return { stale, fixed };
    }, VARIANTS.manual.section, VARIANTS.manual.item);
    record(
      "S2 assignment has to follow every change (no observer)",
      "manual",
      !r.stale.pDrawn && r.fixed.pDrawn,
      `with nothing re-assigning: an added paragraph ${r.stale.pDrawn ? "is drawn" : "isn't drawn"}, and after swapping items 1 and 2 the cards are drawn in order ${r.stale.order.join(",")} (DOM order now 1,2 = old 2,1); after assignSlots(): paragraph in "${r.fixed.pSlot}", order ${r.fixed.order.join(",")}`,
    );
  } finally {
    await close();
  }
}

/* ---------- S1: items as nested HAX grids ---------- */

const firstAt = (events, el, attr) => events.find((e) => e.el === el && e.attr === attr && e.value !== null)?.t ?? null;

async function s1Ops() {
  for (const [variant, v] of Object.entries(VARIANTS)) {
    for (const rehydrate of [false, true]) {
      const { ed, page, close } = await fresh();
      try {
        const sec = v.section;
        await caretIn(ed, await fieldEl(page, sec, 0, `:scope > ${v.item}:nth-of-type(2) > h3`), "end");
        const r = await page.evaluate(
          async (tag, itemTag, rehydrate) => {
            const sp = __spike;
            const body = sp.body();
            const s = sp.section(tag);
            const anchor = s.querySelectorAll(`:scope > ${itemTag}`)[1];
            const addAbove = body.__addAbove;
            // haxInsert puts the new block before the one passed when this hidden flag is set
            body.__addAbove = false;
            sp.watch(1500);
            const t0 = performance.now();
            const item = body.haxInsert(itemTag, "<h3></h3><p></p>", {}, anchor);
            const placed = { parentIsSection: item.parentNode === s, afterAnchor: item.previousElementSibling === anchor };
            const now = { h3: sp.attrs(item.querySelector("h3")), p: sp.attrs(item.querySelector("p")) };
            const settledMs = await sp.settled(body);
            const atSettled = { active: sp.activeNode(), h3: sp.attrs(item.querySelector("h3")), p: sp.attrs(item.querySelector("p")) };
            if (rehydrate) await body.__rehydrateLayoutDescendants(item, true);
            const h3 = item.querySelector("h3");
            sp.placeCaret(h3, "start");
            body.__focusLogic(h3, false);
            const caret = await sp.sampleCaret(1000);
            await new Promise((r) => setTimeout(r, 600));
            return { addAbove, placed, now, settledMs, atSettled, afterCaret: { active: sp.activeNode(), h3: sp.attrs(h3) }, caret, events: sp.events, path: sp.path(item), took: Math.round(performance.now() - t0) };
          },
          sec,
          v.item,
          rehydrate,
        );
        await ed.type("Added");
        await sleep(200);
        const typed = await page.evaluate((p) => {
          const s = __spike.section(p.split(" > ")[0]);
          const item = [...s.children].find((c) => __spike.path(c) === p);
          return { title: item?.querySelector("h3")?.textContent ?? null, health: __spike.health(s) };
        }, r.path);
        writeFileSync(path.join(reportDir, `s1-insert-${variant}${rehydrate ? "-rehydrate" : ""}.json`), JSON.stringify(r, null, 2));
        const h3Path = `${r.path} > h3`;
        const actives = r.events.filter((e) => "active" in e).map((e) => `${e.t} ms ${e.active}`);
        const survived = r.caret.every((c) => c === h3Path);
        record(
          "S1 haxInsert of an item, caret placed after settled()",
          `${variant}${rehydrate ? ", with __rehydrateLayoutDescendants" : ", without"}`,
          r.placed.parentIsSection && r.placed.afterAnchor && survived && typed.title === "Added" && healthy(typed.health),
          [
            `body.__addAbove was ${r.addAbove} before (set to false); inserted ${r.placed.afterAnchor ? "right after the item passed" : "ELSEWHERE"}`,
            `fields at insert: h3 ray ${r.now.h3.ray}, contenteditable ${r.now.h3.editable}`,
            `h3 data-hax-ray at ${firstAt(r.events, h3Path, "data-hax-ray") ?? "never"} ms, contenteditable at ${firstAt(r.events, h3Path, "contenteditable") ?? "never"} ms`,
            `settled after ${r.settledMs} ms (active then ${r.atSettled.active})`,
            `active node: ${actives.join(" → ")}`,
            `after the caret: active ${r.afterCaret.active}, h3 contenteditable ${r.afterCaret.h3.editable}`,
            `caret ${survived ? "stayed in the new title for 1 s" : `MOVED: ${[...new Set(r.caret)].join(" | ")}`}`,
            `typing gave "${typed.title}"`,
            brief(typed.health),
          ].join("; "),
        );
        if (rehydrate) continue;

        // duplicate the first item, then delete the second
        await caretIn(ed, await fieldEl(page, sec, 0, `:scope > ${v.item}:nth-of-type(1) > h3`), "end");
        const d = await page.evaluate(
          async (tag, itemTag) => {
            const sp = __spike;
            const body = sp.body();
            const s = sp.section(tag);
            const first = s.querySelector(`:scope > ${itemTag}`);
            sp.watch(1200);
            await body.haxDuplicateNode(first);
            const clone = first.nextElementSibling;
            const settledMs = await sp.settled(body);
            const atSettled = { active: sp.activeNode(), h3: sp.attrs(clone.querySelector("h3")) };
            await new Promise((r) => setTimeout(r, 400));
            const h3 = clone.querySelector("h3");
            sp.placeCaret(h3, "end");
            body.__focusLogic(h3, false);
            const caret = await sp.sampleCaret(600);
            // HAX gives headings it sees inserted an id="header-…"
            const ids = (h) => h.replace(/\sid="header-[^"]*"/g, "").replace(/>\s+</g, "><");
            const norm = (el) => __ec.normalize(el.outerHTML);
            return {
              sameContent: ids(norm(clone)) === ids(norm(first)),
              headingId: h3.id || null,
              original: norm(first),
              copy: norm(clone),
              path: sp.path(clone),
              settledMs,
              atSettled,
              after: { active: sp.activeNode(), h3: sp.attrs(h3) },
              caret,
              events: sp.events,
              health: sp.health(s),
            };
          },
          sec,
          v.item,
        );
        const dPath = `${d.path} > h3`;
        record(
          "S1 haxDuplicateNode of an item",
          variant,
          d.sameContent && d.atSettled.active === d.path && d.caret.every((c) => c === dPath) && healthy(d.health),
          `copy ${d.sameContent ? "matches the original" : `DIFFERS FROM the original (${d.original} vs ${d.copy})`}, apart from whitespace between tags${d.headingId ? ` and the id HAX gave its heading (${d.headingId})` : ""}; active after: ${d.atSettled.active}; copy's h3 data-hax-ray at ${firstAt(d.events, dPath, "data-hax-ray") ?? "never"} ms, contenteditable at ${firstAt(d.events, dPath, "contenteditable") ?? "never"} ms; caret in the copy's title ${d.caret.every((c) => c === dPath) ? "stayed" : "MOVED"}; ${brief(d.health)}`,
        );
        const del = await page.evaluate(
          async (tag, itemTag) => {
            const sp = __spike;
            const body = sp.body();
            const s = sp.section(tag);
            const second = s.querySelectorAll(`:scope > ${itemTag}`)[1];
            const before = s.querySelectorAll(`:scope > ${itemTag}`).length;
            const previous = sp.path(second.previousElementSibling);
            body.haxDeleteNode(second);
            await sp.settled(body);
            await new Promise((r) => setTimeout(r, 300));
            return { before, previous, active: sp.activeNode(), health: sp.health(s) };
          },
          sec,
          v.item,
        );
        record(
          "S1 haxDeleteNode of an item",
          variant,
          del.health.items === del.before - 1 && del.active === del.previous && healthy(del.health),
          `${del.before} → ${del.health.items} items; active after: ${del.active} (the previous sibling was ${del.previous}); ${brief(del.health)}`,
        );

        // passing the field instead of the item nests the new item inside it
        const nested = await page.evaluate(
          async (tag, itemTag) => {
            const sp = __spike;
            const body = sp.body();
            const s = sp.section(tag);
            const title = s.querySelector(`:scope > ${itemTag} > h3`);
            const item = body.haxInsert(itemTag, "<h3></h3><p></p>", {}, title);
            await sp.settled(body);
            return { parent: sp.path(item.parentElement) };
          },
          sec,
          v.item,
        );
        record("S1 haxInsert passed the field instead of the item", variant, true, `the new item went inside ${nested.parent} (so ops.js must pass the item, as the spec says)`);
      } finally {
        await close();
      }
    }
  }
}

/* ---------- S1 keys: stopped before hax-body's window handlers ---------- */

async function s1Keys() {
  const MODES = ["off", "host", "body", "window", "body-all"];
  const sec = VARIANTS.manual.section;
  const item = VARIANTS.manual.item;
  const results = {};
  for (const mode of MODES) {
    const { ed, page, close } = await fresh();
    try {
      await page.evaluate((mode) => {
        globalThis.__spikeKeys.mode = mode;
        __spike.clearLog();
      }, mode);
      const r = {};
      const snap = () =>
        page.evaluate((tag) => {
          const body = __spike.body();
          return { blocks: body.children.length, section: __ec.normalize(__spike.section(tag).innerHTML), body: __ec.normalize(body.innerHTML) };
        }, sec);

      // which listeners see a key, in what order, with the caret in an item's title
      await caretIn(ed, await fieldEl(page, sec, 0, `:scope > ${item} > h3`), "end");
      await page.evaluate(() => __spike.clearLog());
      await ed.press("ArrowLeft");
      await sleep(100);
      r.order = (await page.evaluate(() => __spike.log())).filter((e) => e.listener).map((e) => `${e.type} ${e.listener}${e.phase ? ` (phase ${e.phase}, target ${e.target})` : ""}`);
      r.target = await page.evaluate(() => __ec.describe(__ec.activeElement())?.path);

      // Enter at the end of a title
      let before = await snap();
      await caretIn(ed, await fieldEl(page, sec, 0, `:scope > ${item} > h3`), "end");
      await ed.press("Enter");
      await sleep(400);
      let after = await snap();
      r.enter = { changed: after.section !== before.section, detail: after.section.length - before.section.length };

      // "/" in an empty title
      await caretIn(ed, await fieldEl(page, sec, 0, `:scope > ${item}:nth-of-type(3) > h3`), "end");
      await ed.type("/");
      await sleep(400);
      r.slash = await page.evaluate((tag, item) => ({ palette: !!globalThis.SuperDaemonManager?.requestAvailability?.()?.opened, text: __spike.section(tag).querySelectorAll(`:scope > ${item}`)[2]?.querySelector("h3")?.textContent }), sec, item);
      await ed.closePalette();
      await sleep(200);

      // "- " at the start of an empty outcome sentence (a P: HAX's Markdown
      // triggers), typed at full speed, then "1. " in another empty paragraph
      before = await snap();
      await caretIn(ed, await fieldEl(page, sec, 0, `:scope > ${item}:nth-of-type(3) > p`), "end");
      await ed.type("- ", { delay: 0 });
      await sleep(400);
      after = await snap();
      r.markdown = await page.evaluate((tag, item) => {
        const it = __spike.section(tag).querySelectorAll(`:scope > ${item}`)[2];
        return { children: [...it.children].map((c) => c.localName).join(","), text: it.textContent };
      }, sec, item);
      r.markdown.list = /<ul|<ol/.test(after.section) && !/<ul|<ol/.test(before.section);
      const note = () => page.evaluate(() => __ec.normalize(__spike.section("oer-spike-note", 1).innerHTML));
      const noteBefore = await note();
      await caretIn(ed, await fieldEl(page, "oer-spike-note", 1, ":scope > p"), "end");
      await ed.type("1. ", { delay: 0 });
      await sleep(400);
      r.markdown.ordered = /<ol/.test(await note()) && !/<ol/.test(noteBefore);

      // two quick ArrowUps at the start of the first section's heading (just after the page-break)
      before = await snap();
      await caretIn(ed, await fieldEl(page, sec, 0, ":scope > h2"), "start");
      await ed.press("ArrowUp");
      await ed.press("ArrowUp");
      await sleep(500);
      after = await snap();
      r.arrowUp = { added: after.blocks - before.blocks };

      // two quick ArrowDowns in the last section's heading
      before = await snap();
      await caretIn(ed, await fieldEl(page, "oer-spike-learn-ce0", 0, ":scope > h2"), "end");
      await ed.press("ArrowDown");
      await ed.press("ArrowDown");
      await sleep(500);
      after = await snap();
      r.arrowDown = { added: after.blocks - before.blocks };
      r.handled = (await page.evaluate(() => __spike.log())).filter((e) => e.handled).length;
      results[mode] = r;
    } finally {
      await close();
    }
  }
  writeFileSync(path.join(reportDir, "s1-keys.json"), JSON.stringify(results, null, 2));
  const off = results.off;
  record(
    "S1 keys: which listeners a key reaches, in order",
    "caret in an item title",
    true,
    `${off.order.join(" → ")}; focus is on ${off.target}`,
  );
  const hostSaw = off.order.some((o) => o.includes("host"));
  record("S1 keys: a keydown listener on the section host runs before hax-body's window handler", "host", hostSaw, hostSaw ? "it does" : `the section host never hears it: the key's target is the editing host (hax-body), which contains the section`);
  record(
    "S1 keys: HAX's own behaviour with nothing stopped (baseline)",
    "off",
    true,
    `Enter in a title ${off.enter.changed ? "changed the section" : "changed nothing"}; "/" in an empty title ${off.slash.palette ? "opened the command palette" : "didn't open the palette"} (title "${off.slash.text}"); "- " in an empty sentence ${off.markdown.list ? "made a list" : `stayed text (${off.markdown.children})`}; "1. " in an empty paragraph ${off.markdown.ordered ? "made a numbered list" : "stayed text"}; double ArrowUp added ${off.arrowUp.added} block(s); double ArrowDown added ${off.arrowDown.added} block(s)`,
  );
  for (const mode of ["host", "body", "window", "body-all"]) {
    const r = results[mode];
    const stopped = !r.enter.changed && !r.slash.palette && r.slash.text === "/" && !r.markdown.list && !r.markdown.ordered && r.arrowUp.added === 0 && r.arrowDown.added === 0;
    record(
      "S1 keys: stopping propagation suppresses Enter, '/', Markdown and the double-arrow insert",
      {
        host: "on the section host, the keys that finish a shortcut",
        body: "capture on hax-body, the keys that finish a shortcut",
        window: "capture on window, the keys that finish a shortcut",
        "body-all": "capture on hax-body, every typed key",
      }[mode],
      stopped,
      `Enter ${r.enter.changed ? "CHANGED the section" : "changed nothing"}; "/" ${r.slash.palette ? "OPENED the palette" : "typed as text"} ("${r.slash.text}"); "- " typed at full speed ${r.markdown.list ? "MADE A LIST" : "stayed text"}; "1. " ${r.markdown.ordered ? "MADE A NUMBERED LIST" : "stayed text"}; double ArrowUp added ${r.arrowUp.added}, double ArrowDown added ${r.arrowDown.added}; ${r.handled} keys handled`,
    );
  }
}

/* ---------- S7: shadow controls in contentEditable grid hosts ---------- */

async function s7() {
  const { ed, page, close } = await fresh();
  try {
    const bodyHtml = () => page.evaluate(() => __ec.normalize(__spike.body().innerHTML));
    const focusSamples = (el) =>
      el.evaluate(async (e) => {
        const out = [];
        for (const t of [0, 50, 100, 200, 400, 700]) {
          await new Promise((r) => setTimeout(r, t - (out.at(-1)?.t ?? 0)));
          out.push({ t, on: __ec.activeElement() === e });
        }
        return out;
      });
    const kept = (samples) => samples.every((x) => x.on);
    const lost = (samples) => (kept(samples) ? "kept" : `LOST at ${samples.find((x) => !x.on).t} ms`);
    const controlEl = (tag, cls) => handle(page, (tag, cls) => __spike.section(tag)?.shadowRoot.querySelector(cls), tag, cls);
    // an ordinary paragraph away from the section, so another block is active (HAX's hidden
    // context menu sits over the block above the active one: see the next check)
    const elsewhere = async (tag) => {
      const p = await handle(page, (tag) => [...__spike.body().querySelectorAll(":scope > p")].find((p) => p.previousElementSibling !== __spike.section(tag)), tag);
      await caretIn(ed, p, "end");
    };
    // the section itself selected, as clicking its padding beside the heading does
    const selectSection = async (tag) => {
      const at = await page.evaluate((tag) => {
        const s = __spike.section(tag);
        const h = s.querySelector(":scope > h2");
        h.scrollIntoView({ block: "center" });
        const r = s.getBoundingClientRect();
        const hr = h.getBoundingClientRect();
        return { x: r.left + 6, y: hr.top + hr.height / 2 };
      }, tag);
      await sleep(100);
      await ed.clickAt(at);
      await sleep(300);
      return page.evaluate(() => __spike.activeNode());
    };

    // HAX's own (hidden) context menu container over the content
    {
      const above = await handle(page, () => __spike.section("oer-spike-learn").nextElementSibling);
      await caretIn(ed, above, "end");
      await sleep(300);
      const hit = async () => {
        const input = await controlEl("oer-spike-learn", ".full-input");
        await input.evaluate((e) => e.scrollIntoView({ block: "center" }));
        await sleep(100);
        const at = await ed.centre(input, { covered: true });
        return page.evaluate((x, y) => {
          const el = __ec.elementAt(x, y);
          return el ? `${el.localName}${el.id ? `#${el.id}` : ""} in ${el.getRootNode().host?.localName ?? "document"}` : "nothing";
        }, at.x, at.y);
      };
      const before = await hit();
      await page.evaluate(() => {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync("#topcontextmenu { pointer-events: none !important; }");
        const root = __spike.body().shadowRoot;
        root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
      });
      const after = await hit();
      record(
        "S7 clicks on content just above the active block reach it",
        "HAX's #topcontextmenu",
        !/topcontextmenu/.test(before),
        `with an ordinary paragraph active, a click on the field at the bottom of the section above it lands on ${before}; with #topcontextmenu { pointer-events: none } in hax-body's shadow root it lands on ${after}`,
      );
    }

    for (const [tag, ce] of [
      ["oer-spike-learn", "contentEditable: true"],
      ["oer-spike-learn-ce0", "contentEditable: false"],
    ]) {
      for (const kind of ["plain", "spec", "spec+focus", "spec+click", "full"]) {
        const input = await controlEl(tag, `.${kind.replace("+", "-")}-input`);
        const button = await controlEl(tag, `.${kind.replace("+", "-")}-button`);
        const r = {};
        // from another block: click the field, type into it, paste
        await elsewhere(tag);
        let html0 = await bodyHtml();
        await clickCentred(ed, input);
        r.clickInput = await focusSamples(input);
        r.activeAfterClick = await page.evaluate(() => __spike.activeNode());
        await ed.type("abc");
        await ed.press("Backspace");
        await ed.press("Enter");
        await sleep(300);
        r.value = await input.evaluate((e) => e.value);
        await input.evaluate((e) => {
          const data = new DataTransfer();
          data.setData("text/plain", "pasted");
          e.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, composed: true, cancelable: true }));
        });
        await sleep(400);
        r.bodyUnchanged = (await bodyHtml()) === html0;
        // Tab from the field to its button, then Enter and Space on it
        await input.evaluate((e) => e.focus());
        await ed.press("Tab");
        r.tabToButton = await focusSamples(button);
        html0 = await bodyHtml();
        const clicks0 = (await page.evaluate((tag) => __spike.section(tag).__clicks, tag))[kind] || 0;
        await ed.press("Enter");
        await ed.press("Space");
        await sleep(300);
        r.keysOnButton = { clicks: ((await page.evaluate((tag) => __spike.section(tag).__clicks, tag))[kind] || 0) - clicks0, bodyUnchanged: (await bodyHtml()) === html0 };
        // click the button
        await elsewhere(tag);
        await clickCentred(ed, button);
        r.clickButton = await focusSamples(button);
        // focus arriving by keyboard, as Tab from outside brings it
        await elsewhere(tag);
        await input.evaluate((e) => e.focus());
        r.focusInput = await focusSamples(input);
        // with the section already selected
        r.selected = await selectSection(tag);
        await clickCentred(ed, input);
        r.clickSelected = await focusSamples(input);
        // a double-click selects a word in the field
        await input.evaluate((e) => (e.value = "two words"));
        await elsewhere(tag);
        await clickCentred(ed, input, { clickCount: 1 });
        await ed.clickAt(input, { clickCount: 2 });
        r.dblclick = await focusSamples(input);
        r.dblclickSelection = await input.evaluate((e) => e.value.slice(e.selectionStart, e.selectionEnd));

        const pass =
          kept(r.clickInput) && kept(r.tabToButton) && kept(r.clickButton) && kept(r.focusInput) && kept(r.clickSelected) && kept(r.dblclick) && r.value === "ab" && r.bodyUnchanged && r.keysOnButton.bodyUnchanged;
        record(
          "S7 a shadow field and button keep focus, and typing stays in them",
          `${ce}, ${{ plain: "no guard", spec: "the spec's guard (6 events)", "spec+focus": "the spec's guard + focus", "spec+click": "the spec's guard + click, dblclick", full: "full guard (+ click, dblclick, focus)" }[kind]}`,
          pass,
          [
            `click the field from another block: ${lost(r.clickInput)} (active then ${r.activeAfterClick})`,
            `typed "abc", Backspace, Enter: "${r.value}"`,
            `content ${r.bodyUnchanged ? "unchanged" : "CHANGED"} by typing and a paste`,
            `Tab to the button: ${lost(r.tabToButton)}`,
            `Enter and Space on it: ${r.keysOnButton.clicks} click(s), content ${r.keysOnButton.bodyUnchanged ? "unchanged" : "CHANGED"}`,
            `click the button: ${lost(r.clickButton)}`,
            `focus() on the field: ${lost(r.focusInput)}`,
            `click the field with the section selected (${r.selected}): ${lost(r.clickSelected)}`,
            `double-click a word in it: ${lost(r.dblclick)}, selection "${r.dblclickSelection}"`,
          ].join("; "),
        );
      }
    }
    // the item's own control (its icon tile), with the full guard
    await elsewhere("oer-spike-learn");
    const tile = await handle(page, () => __spike.section("oer-spike-learn").querySelector("oer-spike-outcome").shadowRoot.querySelector(".tile"));
    await page.evaluate(() => __spike.clearLog());
    await clickCentred(ed, tile);
    const tileFocus = await focusSamples(tile);
    const clicked = (await page.evaluate(() => __spike.log())).some((e) => e.clicked === "icon");
    record("S7 an item's shadow button (icon tile) keeps focus and works", "contentEditable: true, full guard", kept(tileFocus) && clicked, `focus ${lost(tileFocus)} for 700 ms; its click handler ${clicked ? "ran" : "DIDN'T run"}`);
    await (await sectionEl(page, "oer-spike-learn")).evaluate((e) => e.scrollIntoView({ block: "start" }));
    await ed.settle();
    await ed.screenshot("s7-controls");
  } finally {
    await close();
  }
}

/* ---------- selection reading in Chrome ---------- */

async function sel() {
  const { ed, page, close } = await fresh();
  try {
    const title = await fieldEl(page, VARIANTS.manual.section, 0, `:scope > ${VARIANTS.manual.item} > h3`);
    await caretIn(ed, title, "end");
    await ed.press("ArrowLeft");
    await ed.press("ArrowLeft");
    const r = await page.evaluate(() => {
      const describe = (n) => (n ? (n.nodeType === 3 ? `text in ${__spike.path(n.parentElement)}` : n.localName) : null);
      const body = __spike.body();
      const root = body.getRootNode();
      const shadow = root.getSelection?.();
      const doc = document.getSelection();
      const roots = [];
      for (let n = body; n; n = n.getRootNode().host || null) if (n.getRootNode() instanceof ShadowRoot) roots.push(n.getRootNode());
      let composed = null;
      try {
        const [range] = doc.getComposedRanges({ shadowRoots: roots });
        composed = range ? { node: describe(range.startContainer), offset: range.startOffset } : null;
      } catch (e) {
        composed = { error: e.message };
      }
      let composedNoRoots = null;
      try {
        const [range] = doc.getComposedRanges();
        composedNoRoots = range ? { node: describe(range.startContainer), offset: range.startOffset } : null;
      } catch (e) {
        composedNoRoots = { error: e.message };
      }
      return {
        shadowRootGetSelection: shadow ? { node: describe(shadow.anchorNode), offset: shadow.anchorOffset } : "not available",
        documentGetSelection: { node: describe(doc.anchorNode), offset: doc.anchorOffset },
        getComposedRanges: composed,
        getComposedRangesWithoutRoots: composedNoRoots,
        roots: roots.map((r) => r.host.localName),
      };
    });
    const real = (x) => typeof x?.node === "string" && x.node.startsWith("text in");
    record(
      "Selection reading in Chrome",
      "caret 2 characters before the end of a title",
      real(r.shadowRootGetSelection) && real(r.getComposedRanges),
      `ShadowRoot.getSelection(): ${JSON.stringify(r.shadowRootGetSelection)}; document.getSelection(): ${JSON.stringify(r.documentGetSelection)}; getComposedRanges({shadowRoots: ${r.roots.join(", ")}}): ${JSON.stringify(r.getComposedRanges)}; getComposedRanges() without roots: ${JSON.stringify(r.getComposedRangesWithoutRoots)}`,
    );
  } finally {
    await close();
  }
}

/* ---------- main ---------- */

const RUN = { s1: [s1Ops], keys: [s1Keys], s2: [s2Render, s2Caret, s2Undo, s2Html, s2Vanish], s7: [s7], sel: [sel] };
// stop the server by its port on Ctrl+C too (puppeteer's own handlers are off)
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, async () => {
    console.error(`\n${signal}: stopping the server on port ${port}…`);
    await browser?.close().catch(() => {});
    await scratch?.stop().catch(() => {});
    process.exit(130);
  });
}
let unmeasured = 0;
let chrome = null;
try {
  scratch = await startScratch({ port, source, keep, prepare });
  browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false });
  chrome = await browser.version();
  for (const group of only) {
    for (const fn of RUN[group] || []) {
      console.log(`Measuring ${fn.name}…`);
      const before = rows.length;
      try {
        await fn();
      } catch (e) {
        const where = (e.stack || "").split("\n").find((l) => l.includes("/structure/run.mjs"))?.trim();
        rows.push({ check: fn.name, variant: "", engine: "chrome", pass: false, measured: false, detail: `Couldn't measure: ${e.message}${where ? ` (${where})` : ""}` });
      }
      if (rows.length === before) rows.push({ check: fn.name, variant: "", engine: "chrome", pass: false, measured: false, detail: "Recorded nothing" });
    }
  }
} catch (e) {
  console.error(`The run stopped: ${e.message}`);
  unmeasured++;
} finally {
  await browser?.close().catch(() => {});
  await scratch?.stop();
}

unmeasured += rows.filter((r) => !r.measured).length;
const report = { started: stamp, port, source, chrome, rows };
writeFileSync(path.join(reportDir, "results.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(rows.map(({ check, variant, engine, pass, measured }) => ({ check, variant, engine, pass, ...(measured ? {} : { measured }) })), null, 1));
for (const r of rows) console.log(`${r.pass ? "PASS" : r.measured ? "FAIL" : "ERR "}  ${r.check} [${r.variant}]\n      ${r.detail}`);
console.log(`\n${rows.filter((r) => r.pass).length} passed, ${rows.filter((r) => r.measured && !r.pass).length} failed (no-go results), ${unmeasured} not measured. Report: ${reportDir}`);
if (evidence) {
  mkdirSync(evidence, { recursive: true });
  for (const f of readdirSync(reportDir)) copyFileSync(path.join(reportDir, f), path.join(evidence, f));
  console.log(`Copied the evidence to ${evidence}`);
}
process.exit(unmeasured ? 1 : 0);
