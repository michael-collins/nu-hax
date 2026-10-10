// Geometry (WP-06): editing matches reading. One stylesheet for what
// authors write, in both views (blocks/course-site/cs-content.js): the
// page's type, alignment, links, code, tables and a course site's body
// face, and the widths between its sections. Course sites are full width
// while editing with no gutter where the margin holds the editor's rail
// (from 1280px), sections at 100% of the page instead of 100cqw, no
// justified text or 20px type in the editor on any page, and one selection
// ring. The rail, the frame's handle and the selected block's text never
// cover one another; the + on a full-width seam isn't under the rail; Add
// block follows the last section; a dragged section never lands in
// columns; and the course site's bar never makes the page scroll sideways.
//
// Widths are measured in a Chrome of the check's own that draws scrollbars,
// as people see the page: the harness's headless Chrome hides them, and
// that hid the 100cqw overflow (a scrollbar narrows main, not 100cqw).
//
// Fixtures are written into the copy's page files before the pages open
// (a paragraph with a link, a code block and a wide column layout between
// the course site's facts and its outcomes, a question in its questions,
// and at the end of a lesson columns, code, a table and a centred
// paragraph), and put back afterwards; the Style check sets a
// typeface pairing in the copy's site.json and puts it back. Nothing is
// saved through the editor.
import puppeteer from "puppeteer-core";
import path from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { editor } from "../lib/editor.mjs";

const SITE = "/up/dart-413";
const HUB = "/oer-courses";
// /lessons/what-is-design, by id: a save gives a page whose title ends in
// "?" a new address (HAX's own doing), and other checks save it
const LESSON_ID = "item-143f3783-959c-45c3-8758-dacef0f6861f";
const NOTE = "Written between two sections";
const SITE_FIXTURE = `<p>${NOTE}, with <a href="/oer-courses">a link</a> to follow.</p>
<pre><code>G1 X10 Y10 F1200</code></pre>
<grid-plate layout="1-1" width="wide"><p slot="col-1">The first of two columns, as wide as the sections.</p><p slot="col-2">The second column.</p></grid-plate>`;
// a question, so the bar links to the questions too: in place of the empty
// one of a page from before the section model (WP-08), or after it
const QUESTION = "<oer-cs-faq><oer-cs-question><h3>Do I need experience?</h3><p>No. Week 1 starts with safety.</p></oer-cs-question></oer-cs-faq>";
const SITE_TEXT = [
  ["<oer-cs-faq><h3></h3><p></p></oer-cs-faq>", QUESTION],
  ["<oer-cs-faq><oer-cs-question><h3></h3><p></p></oer-cs-question></oer-cs-faq>", QUESTION],
];
const LESSON_FIXTURE = `<grid-plate layout="1-1"><p slot="col-1">A paragraph in a column, long enough to run onto a second line, where justified text would stretch the spaces between its words.</p><p slot="col-2">The second column.</p></grid-plate>
<h2>Running a model</h2>
<h3>From the terminal</h3>
<p>Run <code>ollama pull llama3</code> once, then start it.</p>
<pre><code>ollama run llama3</code></pre>
<table><thead><tr><th>Model</th><th>Size</th><th>Good for</th></tr></thead><tbody><tr><td><code>llama3</code></td><td>4.7 GB</td><td>Writing and summaries, on a laptop with 16 GB of memory or more</td></tr><tr><td><code>mistral</code></td><td>4.1 GB</td><td>Quick answers</td></tr></tbody></table>
<p data-text-align="center">A paragraph its author centred.</p>`;
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

export default async function geometry(ctx) {
  const results = [];
  const check = (name, pass, detail = "") => results.push({ name, pass: !!pass, detail });
  const json = (v) => JSON.stringify(v);
  const near = (a, b, within) => typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= within;
  // a part that throws fails on its own, with where it stopped
  const part = async (name, fn, ed = ctx) => {
    try {
      await fn();
    } catch (e) {
      check(`${name}: runs without errors`, false, e.message.split("\n")[0]);
      await ed.screenshot(`error-${name}`).catch(() => {});
    }
  };

  /* ---------- fixtures, in the copy only ---------- */

  if (!path.resolve(ctx.siteDir).startsWith(path.resolve(ctx.workDir))) throw new Error(`Not a scratch copy: ${ctx.siteDir}`);
  const items = JSON.parse(readFileSync(path.join(ctx.siteDir, "site.json"), "utf8")).items;
  const pageFile = (address) => {
    const item = items.find((i) => i.slug === address.replace(/^\/+/, ""));
    if (!item) throw new Error(`No page at ${address} in the copy`);
    return path.join(ctx.siteDir, "pages", item.id, "index.html");
  };
  const lesson = items.find((i) => i.id === LESSON_ID);
  if (!lesson) throw new Error(`No lesson ${LESSON_ID} in the copy`);
  const LESSON = `/${lesson.slug}`;
  // a page with its fixture, until put back
  const withFixture = (address, edit) => {
    const file = pageFile(address);
    const original = readFileSync(file, "utf8");
    writeFileSync(file, edit(original));
    return () => writeFileSync(file, original);
  };

  // the page's blocks as drawn now, reading (the theme's own) or editing (hax-body's)
  const layout = (page) =>
    page.evaluate((note) => {
      const editing = !!__ec.store().editMode;
      const root = editing ? __ec.haxBody() : __ec.theme();
      const main = __ec.theme().shadowRoot.querySelector("main");
      const box = (el) => {
        const r = el.getBoundingClientRect();
        return { left: Math.round(r.left * 10) / 10, width: Math.round(r.width * 10) / 10 };
      };
      const note_ = [...root.children].find((el) => el.localName === "p" && el.textContent.includes(note));
      const link = note_?.querySelector("a");
      const ls = link && getComputedStyle(link);
      return {
        editing,
        main: { clientWidth: main.clientWidth, scrollWidth: main.scrollWidth, left: main.getBoundingClientRect().left + main.clientLeft },
        page: { clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth },
        rem: parseFloat(getComputedStyle(document.documentElement).fontSize),
        sections: [...root.children].filter((el) => /^oer-(cs|courses)-/.test(el.localName)).map((el) => ({ tag: el.localName, ...box(el) })),
        note: note_ ? box(note_) : null,
        wide: root.querySelector(":scope > grid-plate[width=wide]") ? box(root.querySelector(":scope > grid-plate[width=wide]")) : null,
        pre: root.querySelector(":scope > pre") ? box(root.querySelector(":scope > pre")) : null,
        link: ls ? { color: ls.color, weight: ls.fontWeight, background: ls.backgroundColor, underline: ls.textDecorationLine } : null,
      };
    }, NOTE);

  /* ---------- the course site, in a Chrome with scrollbars ---------- */

  const putBack = withFixture(SITE, (html) => {
    if (!html.includes("</oer-cs-facts>")) throw new Error(`${SITE} has no facts section to put the fixture after`);
    for (const [empty, filled] of SITE_TEXT) html = html.replace(empty, filled);
    return html.replace("</oer-cs-facts>", `</oer-cs-facts>\n${SITE_FIXTURE}`);
  });
  const browser = await puppeteer.launch({
    executablePath: ctx.browser.process()?.spawnfile || CHROME,
    headless: "new",
    // puppeteer hides scrollbars in headless Chrome by default
    ignoreDefaultArgs: ["--hide-scrollbars"],
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
  });
  const errors = [];
  try {
    const page = await browser.newPage();
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
    page.on("pageerror", (e) => errors.push(e.message.split("\n")[0]));
    page.on("dialog", (d) => d.accept().catch(() => {}));
    const ed = editor(page, { base: ctx.base, siteDir: ctx.siteDir, reportDir: ctx.reportDir });

    await part(
      "reading widths",
      async () => {
        for (const address of [SITE, HUB]) {
          for (const width of [1440, 390]) {
            await ed.setViewport(width);
            await ed.open(address, { signedOut: true });
            const g = await layout(page);
            const off = g.sections.filter((s) => !near(s.width, g.main.clientWidth, 0.5));
            check(
              `${address} reading at ${width}: no sideways scroll, and every section is as wide as main`,
              g.main.scrollWidth === g.main.clientWidth && g.page.scrollWidth === g.page.clientWidth && g.sections.length && !off.length,
              `main ${g.main.clientWidth} wide, scrolls ${g.main.scrollWidth}; the page ${g.page.clientWidth}, scrolls ${g.page.scrollWidth}; ${g.sections.length} sections${off.length ? `, ${off.map((s) => `${s.tag} ${s.width}`).join(", ")}` : ` ${g.sections[0]?.width} wide`}`,
            );
          }
        }
        await ed.screenshot("reading-390");
        await ed.setViewport(1440);
      },
      ed,
    );

    await part(
      "reading and editing",
      async () => {
        await ed.open(SITE);
        await page.evaluate(() => {
          globalThis.__idle = [];
          addEventListener("oer-reader-copy-idle", (e) => __idle.push(e.detail.idle));
        });
        const reading = await layout(page);
        await ed.enterEdit();
        const editing = await layout(page);
        await ed.screenshot("editing-1440");
        const moved = reading.sections
          .map((r, i) => ({ r, e: editing.sections[i] }))
          .filter(({ r, e }) => !e || e.tag !== r.tag || !near(r.left, e.left, 2) || !near(r.width, e.width, 2))
          .map(({ r, e }) => `${r.tag} ${r.left}+${r.width} → ${e ? `${e.tag} ${e.left}+${e.width}` : "missing"}`);
        check(
          `${SITE}: every section's left edge and width are the same reading and editing`,
          reading.sections.length && editing.sections.length === reading.sections.length && !moved.length,
          moved.length ? moved.join("; ") : `${reading.sections.length} sections at ${reading.sections[0].left}, ${reading.sections[0].width} wide`,
        );
        check(
          "A paragraph between sections has the same place and width reading and editing, 48rem at 1440",
          reading.note && editing.note && near(reading.note.left, editing.note.left, 2) && near(reading.note.width, editing.note.width, 2) && near(reading.note.width, 48 * reading.rem, 1),
          `reading ${json(reading.note)}, editing ${json(editing.note)}, 48rem = ${48 * reading.rem}px`,
        );
        check(
          "Columns set to the sections' width are 72rem wide, reading and editing",
          reading.wide && editing.wide && near(reading.wide.width, 72 * reading.rem, 1) && near(reading.wide.left, editing.wide.left, 2) && near(reading.wide.width, editing.wide.width, 2),
          `reading ${json(reading.wide)}, editing ${json(editing.wide)}`,
        );
        check(
          "A code block between sections has the reading width, centred, reading and editing",
          reading.pre && editing.pre && near(reading.pre.left, editing.pre.left, 2) && near(reading.pre.width, editing.pre.width, 2) && near(reading.pre.left, reading.note?.left, 2),
          `reading ${json(reading.pre)}, editing ${json(editing.pre)}`,
        );
        check("A link written between sections looks the same reading and editing", reading.link && json(reading.link) === json(editing.link), `reading ${json(reading.link)}, editing ${json(editing.link)}`);
        check("While editing there's no sideways scroll at 1440", editing.main.scrollWidth === editing.main.clientWidth && editing.page.scrollWidth === editing.page.clientWidth, json({ main: editing.main, page: editing.page }));
        const marks = await page.evaluate(() => ({ microsite: __ec.haxBody().hasAttribute("data-oer-microsite"), idle: __ec.theme().hasAttribute("reader-copy-idle"), events: __idle }));
        check("While editing a course site, hax-body is marked as a microsite and the theme's own copy of the page as idle", marks.microsite && marks.idle && json(marks.events) === "[true]", json(marks));

        // one ring: blocks selected inside a section and inside columns, and a block hovered
        const outline = (el) =>
          el.evaluate((el) => {
            const s = getComputedStyle(el);
            return s.outlineStyle === "none" || parseFloat(s.outlineWidth) === 0 ? "none" : `${s.outlineWidth} ${s.outlineStyle}`;
          });
        const ringShown = () => page.evaluate(() => __ec.visible(document.querySelector("oer-block-frame")?.shadowRoot?.querySelector(".ring")));
        const selected = {};
        for (const [where, selector] of [
          ["in a section", "oer-cs-hero > p"],
          ["in columns", "grid-plate[width=wide] > p[slot=col-1]"],
        ]) {
          const block = await ed.deep(selector);
          await ed.clickAt(block);
          await ed.waitFor((s) => __ec.haxStore().activeNode?.matches?.(s), { args: [selector], what: `the paragraph ${where} to be selected`, timeout: 5000 });
          await ed.sleep(200);
          selected[where] = { outline: await outline(block), frame: await ringShown() };
        }
        const note = await page.evaluateHandle((note) => [...__ec.haxBody().children].find((el) => el.localName === "p" && el.textContent.includes(note)), NOTE);
        await note.hover();
        await ed.sleep(200);
        const hovered = (await note.evaluate((n) => n.matches(":hover"))) ? await outline(note) : "not hovered";
        check(
          "One ring: blocks selected in a section or in columns, and a block hovered, have no outline of HAX's; the frame is drawn",
          Object.values(selected).every((s) => s.outline === "none" && s.frame) && hovered === "none",
          json({ selected, hovered }),
        );

        // a section, selected (a click on its own padding): its frame and the
        // rail sit on the page, the rail beside the handle
        const spot = await page.evaluate(async () => {
          const learn = __ec.haxBody().querySelector("oer-cs-learn");
          learn.scrollIntoView({ block: "center" });
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          const r = learn.getBoundingClientRect();
          return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + 12) };
        });
        await ed.clickAt(spot);
        await ed.waitFor(() => __ec.haxStore().activeNode?.localName === "oer-cs-learn", { what: "the section to be selected", timeout: 5000 });
        await ed.sleep(200);
        const chrome = await page.evaluate(() => {
          const main = __ec.theme().shadowRoot.querySelector("main");
          const left = main.getBoundingClientRect().left + main.clientLeft;
          const box = (el) => {
            if (!el || !__ec.visible(el)) return null;
            const r = el.getBoundingClientRect();
            return { left: Math.round(r.left), right: Math.round(r.right) };
          };
          const frame = document.querySelector("oer-block-frame").shadowRoot;
          return { content: [Math.round(left), Math.round(left + main.clientWidth)], ring: box(frame.querySelector(".ring")), handle: box(frame.querySelector(".handle")), label: box(frame.querySelector(".label")), rail: box(document.querySelector("oer-block-rail").shadowRoot.querySelector(".rail")) };
        });
        const inside = (b) => b && b.left >= chrome.content[0] && b.right <= chrome.content[1];
        check(
          "A selected section's frame, label and rail are on the page, the rail beside the handle",
          ["ring", "handle", "label", "rail"].every((k) => inside(chrome[k])) && chrome.rail.left >= chrome.handle.right,
          json(chrome),
        );
        await ed.screenshot("editing-section-selected");

        await ed.exitEdit({ discard: true });
        const after = await page.evaluate(() => ({ idle: __ec.theme().hasAttribute("reader-copy-idle"), events: __idle }));
        check("…and after editing, the theme's copy isn't idle", !after.idle && json(after.events) === "[true,false]", json(after));
      },
      ed,
    );

    await part(
      "the hub",
      async () => {
        await ed.open(HUB);
        const reading = await layout(page);
        await ed.enterEdit();
        const editing = await layout(page);
        const moved = reading.sections.filter((r, i) => !editing.sections[i] || !near(r.left, editing.sections[i].left, 2) || !near(r.width, editing.sections[i].width, 2));
        check(
          `${HUB}: every section's left edge and width are the same reading and editing`,
          reading.sections.length && editing.sections.length === reading.sections.length && !moved.length,
          `reading ${json(reading.sections)}, editing ${json(editing.sections)}`,
        );
        await ed.exitEdit({ discard: true });
      },
      ed,
    );
    // The rail, the frame's handle and the selected block's text, from wide
    // windows (no gutter) down to phones: none covers another. A section's
    // text is its .wrap, inside its padding.
    await part(
      "rail and handle",
      async () => {
        const seen = [];
        const covers = [];
        for (const [width, height] of [[1440, 900], [1280, 900], [1100, 900], [1024, 768], [768, 1024], [390, 844]]) {
          await page.setViewport({ width, height });
          await ed.open(SITE);
          await ed.enterEdit();
          for (const what of ["the hero's tagline", "the paragraph between sections", "What you'll learn"]) {
            const target = await page.evaluateHandle(
              (what, note) => {
                const body = __ec.haxBody();
                if (what === "the hero's tagline") return body.querySelector("oer-cs-hero > p");
                if (what === "the paragraph between sections") return [...body.children].find((el) => el.localName === "p" && el.textContent.includes(note));
                return body.querySelector("oer-cs-learn");
              },
              what,
              NOTE,
            );
            try {
              // (a section by a click on its own padding)
              const spot =
                what === "What you'll learn"
                  ? await target.evaluate(async (s) => {
                      s.scrollIntoView({ block: "center" });
                      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
                      const r = s.getBoundingClientRect();
                      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + 12) };
                    })
                  : target;
              await ed.clickAt(spot, { covered: true });
              await ed.waitFor((t) => !!__ec.haxStore().activeNode && __ec.within(t, __ec.haxStore().activeNode), { args: [target], what: `${what} to be selected`, timeout: 5000 });
            } catch (e) {
              covers.push(`${width}, ${what}: ${e.message.split("\n")[0]}`);
              continue;
            }
            await ed.sleep(200);
            const m = await page.evaluate(() => {
              const node = __ec.haxStore().activeNode;
              const box = (el, inner) => {
                if (!el || !__ec.visible(el)) return null;
                const r = el.getBoundingClientRect();
                const s = inner ? getComputedStyle(el) : null;
                return { l: Math.round(r.left + (s ? parseFloat(s.paddingLeft) : 0)), r: Math.round(r.right - (s ? parseFloat(s.paddingRight) : 0)), t: Math.round(r.top), b: Math.round(r.bottom) };
              };
              const wrap = node.shadowRoot?.querySelector(".wrap");
              return {
                tag: node.localName,
                text: wrap ? box(wrap, true) : box(node),
                handle: box(document.querySelector("oer-block-frame").shadowRoot.querySelector(".handle")),
                rail: box(document.querySelector("oer-block-rail").shadowRoot.querySelector(".rail")),
              };
            });
            const hit = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
            const parts = ["text", "handle", "rail"];
            const missing = parts.filter((k) => !m[k]);
            const over = [["rail", "handle"], ["rail", "text"], ["handle", "text"]].filter(([a, b]) => m[a] && m[b] && hit(m[a], m[b])).map(([a, b]) => `the ${a} over the ${b}`);
            seen.push(`${width} ${m.tag}: text ${m.text?.l}, handle ${m.handle?.l}–${m.handle?.r}, rail ${m.rail?.l}–${m.rail?.r}`);
            if (missing.length || over.length) covers.push(`${width}, ${what}: ${[...over, ...missing.map((k) => `no ${k}`)].join(", ")}`);
          }
          if (width === 1024) await ed.screenshot("selected-1024");
          await ed.exitEdit({ discard: true });
        }
        check(
          "The rail, the frame's handle and the selected block's text don't cover one another, at 1440 down to 390 (a block in a section, one between sections, a section)",
          seen.length === 18 && !covers.length,
          covers.length ? covers.join("; ") : seen.filter((_, i) => i % 3 !== 2).slice(0, 6).join("; "),
        );
      },
      ed,
    );
    await ed.setViewport(1440);

    // the + on a seam as wide as the page, beside the selected block's rail
    await part(
      "seam",
      async () => {
        await ed.open(SITE);
        await ed.enterEdit();
        const note = await page.evaluateHandle((note) => [...__ec.haxBody().children].find((el) => el.localName === "p" && el.textContent.includes(note)), NOTE);
        await ed.clickAt(note);
        await ed.waitFor((n) => __ec.haxStore().activeNode === n, { args: [note], what: "the paragraph to be selected", timeout: 5000 });
        await ed.sleep(200);
        const y = await note.evaluate((n) => (n.getBoundingClientRect().bottom + n.nextElementSibling.getBoundingClientRect().top) / 2);
        await page.mouse.move(700, y);
        await ed.waitFor(() => !!document.querySelector("oer-block-inserter").shadowRoot.querySelector(".slot .plus"), { what: "the seam's +", timeout: 3000 });
        const plus = await page.evaluate(() => {
          const ins = document.querySelector("oer-block-inserter");
          const r = ins.shadowRoot.querySelector(".slot .plus").getBoundingClientRect();
          const rail = document.querySelector("oer-block-rail").shadowRoot.querySelector(".rail").getBoundingClientRect();
          const x = r.left + r.width / 2;
          const y = r.top + r.height / 2;
          return { x, y, left: Math.round(r.left), rail: [Math.round(rail.left), Math.round(rail.right), Math.round(rail.top), Math.round(rail.bottom)], wide: ins.shadowRoot.querySelector(".slot").classList.contains("inside"), top: __ec.within(__ec.elementAt(x, y), ins) };
        });
        await page.mouse.click(plus.x, plus.y);
        const opened = await ed
          .waitFor(() => __ec.visible(document.querySelector("oer-block-inserter").shadowRoot.querySelector(".panel")), { what: "the block list", timeout: 3000 })
          .then(() => true, () => false);
        await page.evaluate(() => document.querySelector("oer-block-inserter").close());
        check(
          "On a seam as wide as the page, the + isn't under the rail, and clicking it opens the block list",
          plus.wide && plus.top && opened,
          `${json({ plus: plus.left, rail: plus.rail, wide: plus.wide, onTop: plus.top })}; the block list ${opened ? "opened" : "didn't open"}`,
        );
        await ed.exitEdit({ discard: true });
      },
      ed,
    );

    // Add block, after the last section
    await part(
      "add block",
      async () => {
        const rows = {};
        for (const address of [SITE, HUB]) {
          await ed.open(address);
          await ed.enterEdit();
          await page.evaluate(() => {
            const main = __ec.theme().shadowRoot.querySelector("main");
            main.scrollTop = main.scrollHeight;
          });
          await ed.sleep(300);
          rows[address] = await page.evaluate(() => {
            const end = document.querySelector("oer-block-inserter").shadowRoot.querySelector(".end");
            const last = [...__ec.haxBody().children].filter((el) => el.getClientRects().length).pop();
            return { end: end && __ec.visible(end) ? Math.round(end.getBoundingClientRect().top) : null, last: `${last.localName} ${Math.round(last.getBoundingClientRect().bottom)}` };
          });
          await ed.exitEdit({ discard: true });
        }
        check(`While editing ${SITE} and ${HUB}, Add block follows the last section`, Object.values(rows).every((r) => r.end !== null), json(rows));
      },
      ed,
    );

    // a section dragged by its grip onto columns stays on the page
    await part(
      "drag",
      async () => {
        await ed.open(SITE);
        await ed.enterEdit();
        // (a click on the section's own padding)
        const wrap = await page.evaluate(async () => {
          const learn = __ec.haxBody().querySelector("oer-cs-learn");
          learn.scrollIntoView({ block: "center" });
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          const r = learn.getBoundingClientRect();
          return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + 12) };
        });
        await ed.clickAt(wrap);
        await ed.waitFor(() => __ec.haxStore().activeNode?.localName === "oer-cs-learn", { what: "the section to be selected", timeout: 5000 });
        await ed.sleep(200);
        const at = await page.evaluate(() => {
          const grip = document.querySelector("oer-block-frame").shadowRoot.querySelector(".grip").getBoundingClientRect();
          const col = __ec.haxBody().querySelector(":scope > grid-plate[width=wide] > [slot=col-1]").getBoundingClientRect();
          return { from: [grip.left + grip.width / 2, grip.top + grip.height / 2], to: [col.left + 20, col.bottom + 4] };
        });
        await page.mouse.move(...at.from);
        await page.mouse.down();
        for (let i = 1; i <= 10; i++) await page.mouse.move(at.from[0] + ((at.to[0] - at.from[0]) * i) / 10, at.from[1] + ((at.to[1] - at.from[1]) * i) / 10);
        await ed.sleep(200);
        await page.mouse.up();
        await ed.sleep(300);
        const where = await page.evaluate(() => {
          const s = __ec.haxBody().querySelector("oer-cs-learn");
          return { parent: s.parentElement.localName, slot: s.getAttribute("slot") };
        });
        check("A section dragged by its grip onto columns stays on the page, not in a column", where.parent === "hax-body" && !where.slot, json(where));
        await ed.exitEdit({ discard: true });
      },
      ed,
    );

    // Style's IBM Plex Sans pairing sets the body face too
    await part(
      "body face",
      async () => {
        const file = path.join(ctx.siteDir, "site.json");
        const original = readFileSync(file, "utf8");
        const data = JSON.parse(original);
        const item = data.items.find((i) => i.slug === SITE.slice(1));
        item.metadata = { ...item.metadata, oerSiteStyle: { ...(item.metadata?.oerSiteStyle || {}), fonts: "plex" } };
        writeFileSync(file, JSON.stringify(data, null, 2));
        try {
          const faces = () =>
            page.evaluate((note) => {
              const root = __ec.store().editMode ? __ec.haxBody() : __ec.theme();
              const face = (el) => (el ? getComputedStyle(el).fontFamily.split(",")[0].replace(/"/g, "") : null);
              return { between: face([...root.children].find((el) => el.localName === "p" && el.textContent.includes(note))), column: face(root.querySelector(":scope > grid-plate > p")) };
            }, NOTE);
          await ed.open(SITE);
          const reading = await faces();
          await ed.enterEdit();
          const editing = await faces();
          await ed.exitEdit({ discard: true });
          check(
            "With Style's IBM Plex Sans pairing, text between sections and in columns is in IBM Plex Sans reading and editing",
            json(reading) === json(editing) && reading.between === "IBM Plex Sans" && reading.column === "IBM Plex Sans",
            `reading ${json(reading)}, editing ${json(editing)}`,
          );
        } finally {
          writeFileSync(file, original);
        }
      },
      ed,
    );

    // an author's reading view: the course site's bar fits the page
    await part(
      "bar",
      async () => {
        const widths = {};
        for (const [width, height] of [[1153, 800], [1024, 768], [901, 800], [320, 568]]) {
          await page.setViewport({ width, height });
          await ed.open(SITE);
          widths[width] = await page.evaluate(() => {
            const main = __ec.theme().shadowRoot.querySelector("main");
            const links = __ec.deep("oer-course-site").shadowRoot.querySelectorAll(".links button");
            const nav = __ec.deep("oer-course-site").shadowRoot.querySelector(".links").getBoundingClientRect();
            const shown = [...links].filter((b) => {
              const r = b.getBoundingClientRect();
              return r.width && r.top >= nav.top && r.bottom <= nav.bottom + 0.5 && r.right <= nav.right + 0.5;
            }).length;
            return { main: [main.clientWidth, main.scrollWidth], page: [document.documentElement.clientWidth, document.documentElement.scrollWidth], links: `${shown} of ${links.length}` };
          });
        }
        await ed.setViewport(1440);
        const wide = Object.entries(widths).filter(([, w]) => w.main[1] > w.main[0] || w.page[1] > w.page[0]);
        check(
          "Signed in, the course site's bar doesn't make the reading view scroll sideways (1153, 1024, 901 and 320 wide)",
          !wide.length,
          Object.entries(widths).map(([w, v]) => `${w}: main ${v.main.join("/")}, links ${v.links}`).join("; "),
        );
      },
      ed,
    );

    check("The course site and the hub, in the second Chrome: no page errors", !errors.length, errors.join("; ") || "none");
  } finally {
    await browser.close().catch(() => {});
    putBack();
  }

  /* ---------- a lesson: the type, read and edited ---------- */

  const type = () =>
    ctx.page.evaluate(() => {
      const editing = !!__ec.store().editMode;
      const root = editing ? __ec.haxBody() : __ec.theme();
      const p = [...root.querySelectorAll(":scope > p")].find((p) => p.textContent.trim().length > 80);
      const column = root.querySelector(":scope > grid-plate > p");
      const s = getComputedStyle(p);
      // how code, tables and headings are drawn (not where: an ordinary
      // page keeps the editor's gutter)
      const look = (el, props) => {
        if (!el) return null;
        const cs = getComputedStyle(el);
        return [...props.map((k) => cs[k]), `${Math.round(el.getBoundingClientRect().height)}px high`].join(" ");
      };
      return {
        editing,
        paragraph: { size: s.fontSize, leading: s.lineHeight, font: s.fontFamily.split(",")[0], align: s.textAlign, height: Math.round(p.getBoundingClientRect().height) },
        column: getComputedStyle(column).textAlign,
        centred: getComputedStyle(root.querySelector(":scope > p[data-text-align=center]")).textAlign,
        body: editing ? { size: getComputedStyle(root).fontSize, align: getComputedStyle(root).textAlign } : null,
        looks: {
          code: look(root.querySelector(":scope > p > code"), ["display", "fontFamily", "fontSize", "lineHeight", "paddingLeft", "borderTopWidth", "backgroundColor"]),
          pre: look(root.querySelector(":scope > pre"), ["display", "fontFamily", "fontSize", "marginTop", "paddingLeft", "borderTopWidth", "backgroundColor"]),
          table: look(root.querySelector(":scope > table"), ["display", "fontSize", "borderTopWidth", "borderTopLeftRadius"]),
          th: look(root.querySelector(":scope > table th"), ["fontWeight", "fontSize", "textAlign", "paddingLeft", "backgroundColor"]),
          td: look(root.querySelector(":scope > table td"), ["textAlign", "verticalAlign", "paddingLeft", "borderTopWidth", "borderBottomWidth"]),
          h2: look(root.querySelector(":scope > h2"), ["fontSize", "fontFamily", "letterSpacing", "lineHeight"]),
          h3: look(root.querySelector(":scope > h3"), ["fontSize", "fontFamily", "letterSpacing", "lineHeight"]),
        },
      };
    });
  const putLessonBack = withFixture(LESSON, (html) => `${html.trimEnd()}\n${LESSON_FIXTURE}\n`);
  try {
    await part("lesson", async () => {
      await ctx.open(LESSON);
      const reading = await type();
      await ctx.enterEdit();
      const editing = await type();
      const same = ["size", "leading", "font", "height"].every((k) => reading.paragraph[k] === editing.paragraph[k]);
      check(`${LESSON}: a paragraph's type is the same reading and editing (no reflow)`, same, `reading ${json(reading.paragraph)}, editing ${json(editing.paragraph)}`);
      check("…and while editing, text in columns and the page itself aren't justified", editing.column === "start" && editing.body.align === "start" && reading.column === "start", `columns ${editing.column} (reading ${reading.column}); hax-body ${json(editing.body)}`);
      check("…and a paragraph its author centred is centred reading and editing", reading.centred === "center" && editing.centred === "center", `reading ${reading.centred}, editing ${editing.centred}`);
      const unlike = Object.keys(reading.looks).filter((k) => !reading.looks[k] || reading.looks[k] !== editing.looks[k]);
      check(
        "…and code, a code block, a table and headings look the same reading and editing",
        !unlike.length,
        unlike.length ? unlike.map((k) => `${k}: ${reading.looks[k]} → ${editing.looks[k]}`).join("; ") : `table ${reading.looks.table}`,
      );
      const sheets = await ctx.page.evaluate(() => {
        const hax = __ec.haxBody().getRootNode().host;
        return hax.shadowRoot.adoptedStyleSheets.filter((s) => s.hax).map((s) => [...s.cssRules].some((r) => r.cssText.includes("data-oer-microsite")));
      });
      check("h-a-x has the site's content sheet (hax === true) among its adopted sheets", sheets.includes(true), `${sheets.length} hax sheets, ${sheets.filter(Boolean).length} of them the site's`);
      const mark = await ctx.page.evaluate(() => __ec.haxBody().hasAttribute("data-oer-microsite"));
      check("…and hax-body isn't marked as a microsite on a lesson", !mark, `data-oer-microsite ${mark ? "set" : "not set"}`);
      await ctx.exitEdit({ discard: true });
    });
  } finally {
    putLessonBack();
  }
  return results;
}
