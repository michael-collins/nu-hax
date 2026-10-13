// Give pages back the course Decap gave them in its single `course:` field,
// which the Decap import skipped (it read only the `courses:` list), so
// DART 303's exercises and lectures and some of DART 203's exercises had no
// course here (docs/decap-migration-audit.md). Adds the link; never removes
// one. Versions (snapshots) are left as they were saved.
//   node --env-file=.env.local scripts/restore-course-links.mjs [--dry-run]
// HAX_BASE and SITE_DIR point it at another copy of the site. Safe to run again.
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { connect } from "./lib/hax-api.mjs";

const SITE_DIR = process.env.SITE_DIR || new URL("../learning-materials/", import.meta.url).pathname;
const SITE = process.env.HAX_SITE || "learning-materials";
const DECAP = process.env.DECAP_DIR || path.join(process.env.HOME, "Documents/repos/open-curriculum/oerschema/learning-materials-decapcms");
const DRY = process.argv.includes("--dry-run");

const items = JSON.parse(readFileSync(path.join(SITE_DIR, "site.json"), "utf8")).items;
const live = items.filter((i) => !i.metadata?.oerSnapshotOf);
const sys = items.find((i) => i.metadata?.pageType === "oer:system");
const hasCourses = new Set(sys.metadata.oerContentTypes.types.filter((t) => t.fields.some((f) => f.name === "courses")).map((t) => t.id));
const byCode = new Map();
for (const c of live.filter((i) => i.metadata?.pageType === "oer:course")) {
  const code = String(c.metadata.oerFields?.code || "").trim().toUpperCase();
  byCode.set(code, [...(byCode.get(code) || []), c]);
}

const out = [];
const problems = [];
for (const item of live) {
  const src = item.metadata?.oerSource;
  if (!src) continue;
  const file = [path.join(DECAP, "content", src, "index.md"), path.join(DECAP, "content", `${src}.md`)].find(existsSync);
  if (!file) continue;
  const code = matter(readFileSync(file, "utf8")).data.course;
  if (!code) continue;
  const courses = byCode.get(String(code).trim().toUpperCase()) || [];
  if (courses.length !== 1) {
    problems.push(`${item.title}: ${courses.length ? `${courses.length} course pages` : "no course page"} for ${code}`);
    continue;
  }
  if (!hasCourses.has(item.metadata.pageType)) {
    problems.push(`${item.title}: its type (${item.metadata.pageType}) has no Courses field`);
    continue;
  }
  const f = item.metadata.oerFields || {};
  const have = Array.isArray(f.courses) ? f.courses : [];
  if (have.some((l) => l?.page === courses[0].id)) continue;
  out.push({ ...item, metadata: { ...item.metadata, oerFields: { ...f, courses: [...have, { page: courses[0].id, version: "" }] } }, modified: true });
  console.log(`${code}  ${item.title} (${item.slug})`);
}
console.log(`${out.length} pages get their course back`);
if (problems.length) console.log(`skipped:\n  ${problems.join("\n  ")}`);
if (DRY || !out.length) process.exit(0);

const api = await connect();
const res = await api.call("PATCH", "/x/api/v1/site/outline", { headers: api.headers, body: { site: { name: SITE }, items: out } });
if (!res.ok) throw new Error(`outline save failed (${res.status}): ${JSON.stringify(res.json).slice(0, 300)}`);
console.log("saved");
