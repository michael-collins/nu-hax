// Check that a Canvas course survives a round trip: import its export into
// a copy of the site held in memory (nothing is saved), export the course
// sequence it makes back to Canvas for the same term, read that package
// and compare it with the original, module by module and item by item:
// titles, order, indents, points, due and availability dates (to the
// minute: 11:59:59 pm and 11:59 pm are the same deadline), grade groups,
// rubrics, submission types. What the import leaves out on purpose
// (instructor-only modules, surveys, external tools) is listed apart from
// real differences.
//   node scripts/canvas-roundtrip.mjs <export.imscc> [--verbose]
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { readCanvasPackage } from "../learning-materials/custom/src/lms/canvas-reader.js";
import { planImport } from "../learning-materials/custom/src/lms/canvas-import-plan.js";
import { applyImport } from "../learning-materials/custom/src/lms/canvas-import-apply.js";
import { toOffering } from "../learning-materials/custom/src/lms/sequence-model.js";
import { buildCanvasPackage } from "../learning-materials/custom/src/lms/canvas-package.js";
import { zipBytes } from "../learning-materials/custom/src/lms/zip.js";

const SITE_DIR = process.env.SITE_DIR || new URL("../learning-materials/", import.meta.url).pathname;
const file = process.argv[2];
const VERBOSE = process.argv.includes("--verbose");
if (!file) {
  console.error("usage: node scripts/canvas-roundtrip.mjs <export.imscc> [--verbose]");
  process.exit(1);
}

/* ---------- import into a site held in memory ---------- */
const site = JSON.parse(readFileSync(path.join(SITE_DIR, "site.json"), "utf8")).items;
const contents = new Map(); // new pages' HTML
const slugify = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const io = {
  items: () => site,
  save: async (list) => {
    for (const it of list) {
      const { new: isNew, modified, contents: html, ...rest } = it;
      if (html !== undefined) contents.set(it.id, html);
      const at = site.findIndex((x) => x.id === it.id);
      if (isNew && at < 0) site.push({ ...rest, slug: [site.find((p) => p.id === rest.parent)?.slug, slugify(rest.title)].filter(Boolean).join("/") });
      else if (at >= 0) site[at] = { ...site[at], ...rest };
    }
  },
  describe: async (id, description) => {
    const p = site.find((x) => x.id === id);
    if (p) p.description = description;
  },
  upload: async (name) => `files/${name}`,
};
const original = await readCanvasPackage(readFileSync(file));
const plan = planImport(original, site);
// the files the imported items use come over (in memory only), so they make
// the trip too
plan.files = plan.files.map((f) => ({ ...f, import: f.usedBy.length > 0 }));
const result = await applyImport(plan, original, { io });

/* ---------- export it back, for the same term ---------- */
const htmlOf = async (i) => {
  if (contents.has(i.id)) return contents.get(i.id);
  const f = i.location && path.join(SITE_DIR, i.location);
  return f && existsSync(f) ? readFileSync(f, "utf8") : "";
};
const offering = toOffering(result.sequence, site, { start: plan.course.start, timeZone: plan.course.timeZone, term: "Round trip", defaults: { dueRule: "day", dueDay: "Sun", dueTime: "23:59" }, siteUrl: "https://example.org/" });
// an "uploaded" file is read back from the original export
const fileOf = async (url) => {
  const name = decodeURIComponent(String(url).split("/").pop());
  const f = plan.files.find((x) => x.name === name);
  return f ? original.zip.bytes(`web_resources/${f.path}`) : null;
};
const built = await buildCanvasPackage({ offering, items: site, htmlOf, fileOf });
const back = await readCanvasPackage(zipBytes(built.files));

/* ---------- compare ---------- */
const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
const minutes = (utc) => (utc ? Math.floor(new Date(`${utc.replace(/Z$/, "")}Z`).getTime() / 60000) : null);
const groupName = (course, id) => course.groups.find((g) => g.id === id)?.title || "";
const rubricShape = (course, id) => {
  const r = course.rubrics.get(id);
  return r ? r.criteria.map((c) => `${norm(c.name)}:${c.points}`).join("|") : "";
};
const settingsOf = (course, it) => {
  const a = it.kind === "assignment" ? course.assignments.get(it.ref) : it.kind === "discussion" ? course.discussions.get(it.ref)?.assignment : null;
  if (!a) return null;
  return {
    points: a.points ?? 0,
    due: minutes(a.dueAt),
    unlock: minutes(a.unlockAt),
    lock: minutes(a.lockAt),
    group: norm(groupName(course, a.group)),
    rubric: rubricShape(course, a.rubric),
    submission: [...a.submission].sort().join(","),
  };
};
const skippedOnPurpose = new Map(); // module item id → reason
for (const m of plan.modules) for (const e of m.items) if (m.skip || e.action === "skip") skippedOnPurpose.set(e.id, m.skip ? m.reason : e.reasons[0]);

const report = { matched: 0, intended: [], differences: [] };
const backModules = new Map(back.modules.map((m) => [norm(m.title), m]));
for (const om of original.modules) {
  const bm = backModules.get(norm(om.title));
  const kept = om.items.filter((it) => !skippedOnPurpose.has(it.id));
  for (const it of om.items.filter((x) => skippedOnPurpose.has(x.id))) report.intended.push(`${om.title} › ${it.title}: left out (${skippedOnPurpose.get(it.id)})`);
  if (!bm) {
    if (kept.length) report.differences.push(`${om.title}: the module is missing`);
    continue;
  }
  // items in order: kind, title, indent
  const bi = bm.items;
  kept.forEach((it, n) => {
    const b = bi.find((x, k) => norm(x.title) === norm(it.title) && k >= n - 3) || bi[n];
    if (!b || norm(b.title) !== norm(it.title)) return report.differences.push(`${om.title} › ${it.title}: missing${b ? ` (found “${b.title}” there)` : ""}`);
    const issues = [];
    if (b.kind !== it.kind) issues.push(`was a ${it.kind}, now a ${b.kind}`);
    if (bi.indexOf(b) !== n) issues.push(`moved from place ${n + 1} to ${bi.indexOf(b) + 1}`);
    if ((b.indent || 0) !== (it.indent || 0)) issues.push(`indent ${it.indent} → ${b.indent}`);
    if (it.kind === "link" && it.url !== b.url) issues.push(`address ${it.url} → ${b.url}`);
    const os = settingsOf(original, it);
    const bs = settingsOf(back, b);
    if (os && bs) {
      for (const k of ["points", "due", "unlock", "lock", "group", "rubric", "submission"]) {
        if (String(os[k] ?? "") !== String(bs[k] ?? "")) issues.push(`${k} ${os[k] ?? "none"} → ${bs[k] ?? "none"}`);
      }
    } else if (os || bs) issues.push(os ? "lost its grading" : "gained grading");
    if (issues.length) report.differences.push(`${om.title} › ${it.title}: ${issues.join("; ")}`);
    else report.matched++;
  });
  for (const b of bi.filter((x) => !kept.some((it) => norm(it.title) === norm(x.title)))) report.differences.push(`${om.title} › ${b.title}: added`);
}
for (const bm of back.modules.filter((m) => !original.modules.some((om) => norm(om.title) === norm(m.title)))) report.differences.push(`${bm.title}: module added`);
// grade groups
const groupsOf = (c) => c.groups.filter((g) => [...c.assignments.values(), ...[...c.discussions.values()].map((d) => d.assignment).filter(Boolean)].some((a) => a.group === g.id)).map((g) => `${norm(g.title)} ${g.weight}%`).sort();
const og = groupsOf(original);
const bg = groupsOf(back);
for (const g of og.filter((x) => !bg.includes(x))) report.differences.push(`grade group ${g}: missing or changed`);
for (const g of bg.filter((x) => !og.includes(x))) report.differences.push(`grade group ${g}: added`);

const total = report.matched + report.differences.length;
console.log(`${original.title}\n  ${report.matched} of ${total} kept items came back the same; ${report.intended.length} left out on purpose; ${report.differences.length} difference${report.differences.length === 1 ? "" : "s"}`);
for (const d of report.differences) console.log(`  ✗ ${d}`);
if (VERBOSE) for (const d of report.intended) console.log(`  · ${d}`);
if (built.report.warnings.length && VERBOSE) for (const w of built.report.warnings) console.log(`  ! ${w}`);
process.exitCode = report.differences.length ? 1 : 0;
