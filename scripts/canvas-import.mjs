// Import a Canvas course export (.imscc) into the site from the command
// line: the same reading, analysis and import as the site's "Import from
// Canvas" wizard (learning-materials/custom/src/lms/), with the plan's
// suggestions as they are (no review).
//   node --env-file=.env.local scripts/canvas-import.mjs <export.imscc>            the plan, as a summary
//   node --env-file=.env.local scripts/canvas-import.mjs <export.imscc> --json p   the plan, as JSON
//   node --env-file=.env.local scripts/canvas-import.mjs <export.imscc> --apply    import it as drafts
// --files a.docx,b.pdf  bring these files too (none come over otherwise:
// course files can include student work). HAX_BASE and SITE_DIR point it at
// another copy of the site (a scratch server, say).
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { connect } from "./lib/hax-api.mjs";
import { readCanvasPackage } from "../learning-materials/custom/src/lms/canvas-reader.js";
import { planImport, planCounts } from "../learning-materials/custom/src/lms/canvas-import-plan.js";
import { applyImport } from "../learning-materials/custom/src/lms/canvas-import-apply.js";

const SITE_DIR = process.env.SITE_DIR || new URL("../learning-materials/", import.meta.url).pathname;
const SITE = process.env.HAX_SITE || "learning-materials";
const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : "");
const file = args.find((a, i) => !a.startsWith("--") && !["--json", "--files"].includes(args[i - 1]));
if (!file) {
  console.error("usage: node --env-file=.env.local scripts/canvas-import.mjs <export.imscc> [--json plan.json] [--apply] [--files a,b]");
  process.exit(1);
}
const items = () => JSON.parse(readFileSync(path.join(SITE_DIR, "site.json"), "utf8")).items;

const course = await readCanvasPackage(readFileSync(file));
const plan = planImport(course, items());
const wanted = new Set(opt("--files").split(",").map((s) => s.trim()).filter(Boolean));
plan.files = plan.files.map((f) => ({ ...f, import: wanted.has(f.path) || wanted.has(f.name) }));

const c = planCounts(plan);
console.log(`${plan.course.title}\n  ${plan.course.weeks} weeks from ${plan.course.start || "?"} (${plan.course.timeZone}); course page: ${plan.coursePage?.title || "none"}`);
console.log(`  ${c.link} linked to the site's pages, ${c.create} new draft pages, ${c.urls} links, ${c.skip} skipped; ${c.rubricsNew} new rubrics, ${c.rubricsReused} reused; ${c.files} files`);
for (const m of plan.modules) {
  console.log(`  Week ${m.week}: ${m.title}${m.skip ? ` (skipped: ${m.reason})` : ""}`);
  if (m.skip) continue;
  for (const e of m.items) console.log(`    ${e.action.padEnd(6)} ${e.title}${e.match ? ` → ${e.match.title}` : e.action === "create" ? ` (${e.type})` : ""}`);
}
for (const p of plan.problems) console.log(`  ! ${p.text}`);
if (opt("--json")) {
  writeFileSync(opt("--json"), JSON.stringify({ ...plan, modules: plan.modules.map((m) => ({ ...m, items: m.items.map(({ rawHtml, ...e }) => e) })), unplaced: plan.unplaced.map(({ rawHtml, ...e }) => e) }, null, 2));
  console.log(`plan written to ${opt("--json")}`);
}
if (!args.includes("--apply")) process.exit(0);

const api = await connect();
const io = {
  items,
  save: async (list) => {
    const res = await api.call("PATCH", "/x/api/v1/site/outline", { headers: api.headers, body: { site: { name: SITE }, items: list } });
    if (!res.ok) throw new Error(`outline save failed (${res.status}): ${JSON.stringify(res.json).slice(0, 300)}`);
  },
  describe: (id, description) => api.updateItem(id, "setDescription", { description }),
  upload: async (name, bytes) => {
    const form = new FormData();
    form.append("file-upload", new Blob([bytes]), name);
    const base = process.env.HAX_BASE || "http://localhost:3000";
    const res = await fetch(`${base}/x/api/v1/files`, { method: "POST", headers: { Authorization: api.headers.Authorization, "X-HAXCMS-Site-Token": api.headers["X-HAXCMS-Site-Token"] }, body: form });
    const json = await res.json().catch(() => null);
    const saved = json?.data?.file || json?.file || {};
    return saved.url || saved.fullUrl || saved.path || "";
  },
};
const result = await applyImport(plan, course, { io, onStep: (t) => console.log(`  … ${t}`) });
console.log(`imported: ${result.pages.length} draft pages, ${result.rubrics} rubrics, ${result.files} files; sequence ${result.sequence?.slug || "?"} (batch ${result.batch})`);
