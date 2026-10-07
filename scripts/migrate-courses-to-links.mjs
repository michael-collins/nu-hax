// Courses as links: every type's Courses field links to Course pages
// instead of holding course codes, so the same code at two universities
// stays two courses, and a page can be in any number of courses.
//   node --env-file=.env.local scripts/migrate-courses-to-links.mjs [--dry-run]
//
// - Courses fields become relations to oer:course pages (filterable)
// - each page's codes become links to the course page with that code
//   (archived versions too: it's how the value is stored, not what it says)
// - the Course type gets University and University website; the existing
//   course pages are Penn State's
// - the Courses index groups courses by university
// - the old "Digital fabrication" pathway (a one-line placeholder from the
//   Decap site) is retired in favour of "Digital Fabrication Studio", which
//   takes its prerequisite (CGI Foundations)
// Safe to run again.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { connect } from "./lib/hax-api.mjs";

const SITE_DIR = process.env.SITE_DIR || new URL("../learning-materials/", import.meta.url).pathname;
const SITE = process.env.HAX_SITE || "learning-materials";
const DRY = process.argv.includes("--dry-run");
const UNIVERSITY = { name: "Penn State University", url: "https://www.psu.edu/" };

const items = JSON.parse(readFileSync(path.join(SITE_DIR, "site.json"), "utf8")).items;
const sys = items.find((i) => i.metadata?.pageType === "oer:system");
const defs = sys.metadata.oerContentTypes;
const out = new Map();
const change = (item, patch) => out.set(item.id, { ...(out.get(item.id) || item), ...patch, modified: true });

/* ---------- types ---------- */

const COURSES_FIELD = {
  name: "courses",
  label: "Courses",
  kind: "relation",
  types: ["oer:course"],
  filter: true,
  help: "The courses this page is taught in, at any university. A page can be in several courses.",
};
const types = defs.types.map((t) => {
  let fields = t.fields.map((f) => (f.name === "courses" ? { ...COURSES_FIELD, ...(f.header ? { header: true } : {}) } : f));
  if (t.id === "oer:course") {
    if (!fields.some((f) => f.name === "institution")) {
      const at = fields.findIndex((f) => f.name === "credits") + 1;
      fields.splice(
        at,
        0,
        { name: "institution", label: "University", kind: "text", header: true, suggest: true, filter: true, help: "The university that offers the course." },
        { name: "institutionUrl", label: "University website", kind: "url" },
      );
    }
  }
  return { ...t, fields };
});
if (JSON.stringify(types) !== JSON.stringify(defs.types)) change(sys, { metadata: { ...sys.metadata, oerContentTypes: { ...defs, types } } });

/* ---------- course pages: their university ---------- */

const courses = items.filter((i) => i.metadata?.pageType === "oer:course" && !i.metadata?.oerSnapshotOf);
for (const c of courses) {
  const f = c.metadata.oerFields || {};
  if (!f.institution) change(c, { metadata: { ...c.metadata, oerFields: { ...f, institution: UNIVERSITY.name, institutionUrl: UNIVERSITY.url } } });
}

/* ---------- every page's courses: codes → links ---------- */

const byCode = new Map(courses.map((c) => [String(c.metadata.oerFields.code).trim().toUpperCase(), c]));
const unknown = new Map();
let converted = 0;
for (const i of items) {
  const v = i.metadata?.oerFields?.courses;
  if (!Array.isArray(v) || !v.some((x) => typeof x === "string")) continue;
  const links = [];
  for (const x of v) {
    if (x && typeof x === "object" && x.page) {
      links.push(x);
      continue;
    }
    const course = byCode.get(String(x).trim().toUpperCase());
    if (course) links.push({ page: course.id, version: "" });
    else unknown.set(String(x), (unknown.get(String(x)) || 0) + 1);
  }
  const deduped = [...new Map(links.map((l) => [l.page, l])).values()];
  const cur = out.get(i.id) || i;
  change(i, { metadata: { ...cur.metadata, oerFields: { ...cur.metadata.oerFields, courses: deduped } } });
  converted++;
}

/* ---------- retire the old "Digital fabrication" pathway ---------- */

const old = items.find((i) => i.title === "Digital fabrication" && i.metadata?.pageType === "oer:pathway" && !i.metadata?.oerSnapshotOf);
const replacement = items.find((i) => i.metadata?.oerPlan === "DART 413:pathway");
const retired = [];
if (old && replacement) {
  for (const i of items.filter((x) => x.id === old.id || x.parent === old.id || x.metadata?.oerSnapshotOf === old.id)) {
    out.set(i.id, { ...i, delete: true });
    retired.push(i.title);
  }
  const prereqs = old.metadata?.oerFields?.prerequisites || [];
  const cur = out.get(replacement.id) || replacement;
  const have = cur.metadata?.oerFields?.prerequisites || [];
  const merged = [...have, ...prereqs.filter((p) => !have.some((h) => h.page === p.page))];
  if (merged.length !== have.length) change(replacement, { metadata: { ...cur.metadata, oerFields: { ...cur.metadata.oerFields, prerequisites: merged } } });
}

/* ---------- the Courses index: grouped by university ---------- */

const section = items.find((i) => !i.parent && i.title === "Courses");
const sectionFile = section?.location && path.join(SITE_DIR, section.location);
let sectionHtml = null;
if (sectionFile && existsSync(sectionFile)) {
  const html = readFileSync(sectionFile, "utf8");
  const next = html.replace(/<oer-collection types="oer:course"([^>]*?)(?: group="[^"]*")?>/, '<oer-collection types="oer:course"$1 group="institution">');
  if (next !== html) sectionHtml = next;
}

console.log(`types: Courses fields → links${types.find((t) => t.id === "oer:course") ? "; Course gets University" : ""}`);
console.log(`${converted} pages' courses → links; ${courses.filter((c) => !c.metadata.oerFields?.institution).length} course pages get ${UNIVERSITY.name}`);
if (unknown.size) console.log(`no course page for: ${[...unknown].map(([k, n]) => `${k} (${n})`).join(", ")} — those entries are dropped`);
console.log(retired.length ? `retired: ${retired.join(", ")}; "${replacement.title}" takes its prerequisite` : "nothing to retire");
console.log(sectionHtml ? "Courses index: grouped by university" : "Courses index: already grouped");
if (DRY) process.exit(0);

if (sectionHtml) writeFileSync(sectionFile, sectionHtml);
const api = await connect();
const res = await api.call("PATCH", "/x/api/v1/site/outline", { headers: api.headers, body: { site: { name: SITE }, items: [...out.values()] } });
if (!res.ok) throw new Error(`outline save failed (${res.status}): ${JSON.stringify(res.json).slice(0, 300)}`);
console.log(`saved ${out.size} items`);
