// Link pages to a course: adds the course page to each page's Courses field
// (and, with --with-parts, to its sub-pages: a tutorial series' parts).
// Adds the link only; never removes one. Pages are named by address.
//   node --env-file=.env.local scripts/link-to-course.mjs --course "DART 303" [--with-parts] [--dry-run] <address>…
// HAX_BASE and SITE_DIR point it at another copy. Safe to run again.
import { readFileSync } from "node:fs";
import path from "node:path";
import { connect } from "./lib/hax-api.mjs";

const SITE_DIR = process.env.SITE_DIR || new URL("../learning-materials/", import.meta.url).pathname;
const SITE = process.env.HAX_SITE || "learning-materials";
const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const PARTS = args.includes("--with-parts");
const code = args.includes("--course") ? args[args.indexOf("--course") + 1] : "";
const slugs = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--course");
if (!code || !slugs.length) {
  console.error('Usage: link-to-course.mjs --course "DART 303" [--with-parts] [--dry-run] <address>…');
  process.exit(1);
}

const items = JSON.parse(readFileSync(path.join(SITE_DIR, "site.json"), "utf8")).items;
const live = (i) => !i.metadata?.oerSnapshotOf;
const course = items.find((i) => live(i) && i.metadata?.pageType === "oer:course" && i.metadata?.oerFields?.code === code);
if (!course) throw new Error(`No course page with code ${code}`);
const missing = slugs.filter((s) => !items.some((i) => live(i) && i.slug === s));
if (missing.length) throw new Error(`Pages not found: ${missing.join(", ")}`);

// the pages, and with --with-parts everything under them (not their versions)
const pages = [];
const add = (p) => {
  if (pages.includes(p)) return;
  pages.push(p);
  if (PARTS) for (const c of items.filter((i) => i.parent === p.id && live(i))) add(c);
};
for (const s of slugs) add(items.find((i) => live(i) && i.slug === s));

const out = [];
for (const p of pages) {
  const courses = Array.isArray(p.metadata?.oerFields?.courses) ? p.metadata.oerFields.courses : [];
  if (courses.some((v) => v?.page === course.id)) continue;
  console.log(`${p.title} (${p.slug})`);
  out.push({
    ...p,
    contents: readFileSync(path.join(SITE_DIR, p.location), "utf8"),
    metadata: { ...p.metadata, overridePathauto: true, oerFields: { ...(p.metadata?.oerFields || {}), courses: [...courses, { page: course.id, version: "" }] } },
    modified: true,
  });
}
console.log(`${out.length} page(s) linked to ${code}${DRY ? " (dry run)" : ""}`);
if (DRY || !out.length) process.exit(0);
const api = await connect();
const res = await api.call("PATCH", "/x/api/v1/site/outline", { headers: api.headers, body: { site: { name: SITE }, items: out } });
if (!res.ok) throw new Error(`outline save failed (${res.status}): ${JSON.stringify(res.json).slice(0, 300)}`);
console.log("saved");
