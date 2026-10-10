// Smoke: the course site and the hub open for a signed-in author, who can
// enter edit mode and leave it again without anything being saved. axe runs
// on the reading and editing views of both. The first run (or a run with
// --update-baseline) writes those counts to scripts/editor-check/axe-baseline.json (kept in git), the
// baseline later checks compare against; other runs compare with it.
import path from "node:path";
import { writeFileSync } from "node:fs";
import { countsOf, readBaseline, newViolations, AXE_VERSION, WCAG_AA } from "../lib/axe.mjs";

const PAGES = ["/up/dart-413", "/oer-courses"];

export default async function smoke(ctx) {
  const results = [];
  const check = (name, pass, detail = "") => results.push({ name, pass: !!pass, detail });
  const axe = {};
  await ctx.setViewport(1440);

  for (const pagePath of PAGES) {
    const shot = pagePath.replace(/^\//, "").replace(/\//g, "-");
    const saved = ctx.savedHtml(pagePath);

    await ctx.open(pagePath);
    const reading = await ctx.page.evaluate(() => ({
      signedIn: !!__ec.store().isLoggedIn,
      frame: !!__ec.theme().shadowRoot.querySelector("oer-course-site"),
      blocks: __ec.theme().children.length,
    }));
    check(
      `${pagePath}: opens for a signed-in author`,
      reading.signedIn && reading.frame && reading.blocks > 0,
      `${reading.blocks} blocks, ${reading.frame ? "in" : "without"} the course-site frame${reading.signedIn ? "" : ", signed out"}`,
    );
    await ctx.screenshot(`${shot}-reading`);
    const readingAxe = await ctx.axe();

    await ctx.enterEdit();
    const editing = await ctx.page.evaluate(() => ({ editMode: !!__ec.store().editMode, blocks: __ec.haxBody()?.children.length ?? 0 }));
    check(`${pagePath}: enters edit mode`, editing.editMode && editing.blocks > 0, `${editing.blocks} blocks in hax-body`);
    await ctx.screenshot(`${shot}-editing`);
    const editingAxe = await ctx.axe();

    await ctx.exitEdit();
    const after = await ctx.page.evaluate(() => ({ editMode: !!__ec.store().editMode, frame: !!__ec.theme().shadowRoot.querySelector("oer-course-site") }));
    check(`${pagePath}: leaves edit mode`, !after.editMode && after.frame, after.frame ? "back in the reading view" : "the course-site frame didn't come back");
    check(`${pagePath}: leaving without saving changes nothing on disk`, ctx.savedHtml(pagePath) === saved);

    axe[pagePath] = { reading: readingAxe, editing: editingAxe };
  }

  const counts = Object.fromEntries(Object.entries(axe).map(([p, views]) => [p, { reading: countsOf(views.reading), editing: countsOf(views.editing) }]));
  writeFileSync(path.join(ctx.reportDir, "axe.json"), JSON.stringify(axe, null, 2));
  const summary = (c) => `${c.violations} rules, ${c.nodes} nodes (critical ${c.counts.critical}, serious ${c.counts.serious}, moderate ${c.counts.moderate}, minor ${c.counts.minor})`;
  const file = new URL("../axe-baseline.json", import.meta.url).pathname;
  const baseline = readBaseline(file);

  if (!baseline || ctx.options.updateBaseline) {
    writeFileSync(
      file,
      JSON.stringify({ written: new Date().toISOString(), source: ctx.source, axe: AXE_VERSION, tags: WCAG_AA, width: 1440, pages: counts }, null, 2),
    );
    for (const [p, views] of Object.entries(counts)) {
      for (const [view, c] of Object.entries(views)) check(`${p} ${view}: axe baseline recorded`, true, summary(c));
    }
  } else {
    for (const [p, views] of Object.entries(axe)) {
      for (const [view, result] of Object.entries(views)) {
        const worse = newViolations(result, baseline.pages?.[p]?.[view]);
        check(`${p} ${view}: no new axe violations`, !worse.length, worse.length ? worse.join("; ") : summary(counts[p][view]));
      }
    }
  }
  return results;
}
