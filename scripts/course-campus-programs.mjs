// Courses get a Campus and Degree programs (the user's request, 2026-10-09):
// the same course code can be taught at more than one campus as separate,
// different course pages, and a course can be in more than one degree.
// - the course type: Campus (University Park, World Campus) after University;
//   Degree programs (multiple) in place of the single Program text field
// - the courses: World Campus, except DART 413 at University Park; DMD
//   courses in Digital Multimedia Design, DART courses in Digital Arts and
//   Media Design (their old Program value is kept)
// - course sites move to /<campus>/<code> (/up/dart-413)
//   node --env-file=.env.local scripts/course-campus-programs.mjs [--dry-run]
// HAX_BASE and SITE_DIR point it at another copy (a scratch server). Safe to run again.
import { readFileSync } from "node:fs";
import path from "node:path";
import { connect } from "./lib/hax-api.mjs";

const SITE_DIR = process.env.SITE_DIR || new URL("../learning-materials/", import.meta.url).pathname;
const SITE = process.env.HAX_SITE || "learning-materials";
const DRY = process.argv.includes("--dry-run");

const DMD = "Digital Multimedia Design (B.Des.)";
const DART = "Digital Arts and Media Design (B.Des.)";
const CAMPUS_FIELD = {
  name: "campus",
  label: "Campus",
  kind: "select",
  header: true,
  filter: true,
  options: [
    { value: "University Park", label: "University Park" },
    { value: "World Campus", label: "World Campus" },
  ],
  help: "Where this version of the course is taught. A course taught at two campuses is two course pages, one for each.",
};
const PROGRAMS_FIELD = {
  name: "programs",
  label: "Degree programs",
  kind: "select",
  multiple: true,
  header: true,
  filter: true,
  options: [
    { value: DMD, label: DMD },
    { value: DART, label: DART },
  ],
  help: "The degrees this course counts toward.",
};
const CODE_HELP = "As in the bulletin, e.g. DART 413. The same code can exist at more than one campus, as separate course pages.";
// mirrors CAMPUS_CODES in custom/src/types/course-site.js
const CAMPUS_CODES = { "University Park": "up", "World Campus": "wc" };

const items = JSON.parse(readFileSync(path.join(SITE_DIR, "site.json"), "utf8")).items;
const out = [];

// the course type
const sys = items.find((i) => i.metadata?.pageType === "oer:system");
const raw = sys.metadata.oerContentTypes;
const types = typeof raw === "string" ? JSON.parse(raw) : structuredClone(raw);
const course = types.types.find((t) => t.id === "oer:course");
const before = JSON.stringify(course.fields);
const code = course.fields.find((f) => f.name === "code");
if (code) code.help = CODE_HELP;
if (!course.fields.some((f) => f.name === "campus")) {
  const at = course.fields.findIndex((f) => f.name === "institution");
  course.fields.splice(at + 1, 0, CAMPUS_FIELD);
}
const oldProgram = course.fields.findIndex((f) => f.name === "program");
if (!course.fields.some((f) => f.name === "programs")) {
  if (oldProgram >= 0) course.fields.splice(oldProgram, 1, PROGRAMS_FIELD);
  else course.fields.splice(course.fields.findIndex((f) => f.name === "campus") + 1, 0, PROGRAMS_FIELD);
} else if (oldProgram >= 0) course.fields.splice(oldProgram, 1);
if (JSON.stringify(course.fields) !== before) {
  out.push({ ...sys, metadata: { ...sys.metadata, oerContentTypes: typeof raw === "string" ? JSON.stringify(types) : types }, modified: true });
  console.log("course type: Campus and Degree programs fields");
}

// the courses
const courses = items.filter((i) => i.metadata?.pageType === "oer:course" && !i.metadata?.oerSnapshotOf);
for (const c of courses) {
  const f = c.metadata.oerFields || {};
  const cc = String(f.code || c.title).toUpperCase();
  const campus = f.campus || (cc.startsWith("DART 413") ? "University Park" : "World Campus");
  const programs = Array.isArray(f.programs) && f.programs.length ? f.programs : [f.program === DMD || cc.startsWith("DMD") ? DMD : cc.startsWith("DART") ? DART : f.program].filter(Boolean);
  // HAX merges oerFields key by key: "" clears the old field
  const next = { ...f, campus, programs, program: "" };
  if (f.campus === campus && JSON.stringify(f.programs) === JSON.stringify(programs) && !f.program) continue;
  out.push({ ...c, metadata: { ...c.metadata, oerFields: next }, modified: true });
  console.log(`${f.code}: ${campus}; ${programs.join(", ")}`);
}

// course sites: /<campus>/<code>
for (const s of items.filter((i) => i.metadata?.pageType === "oer:course-site" && !i.metadata?.oerSnapshotOf)) {
  const ref = [].concat(s.metadata?.oerFields?.course || [])[0];
  const c = courses.find((x) => x.id === (typeof ref === "string" ? ref : ref?.page));
  if (!c) continue;
  const f = out.find((o) => o.id === c.id)?.metadata.oerFields || c.metadata.oerFields || {};
  const slugCode = String(f.code || c.title).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const campus = CAMPUS_CODES[f.campus] || "";
  const slug = campus ? `${campus}/${slugCode}` : slugCode;
  if (s.slug === slug) continue;
  out.push({ ...s, slug, metadata: { ...s.metadata, overridePathauto: true }, modified: true });
  console.log(`course site: /${s.slug} -> /${slug}`);
}

console.log(`${out.length} item(s) to save${DRY ? " (dry run)" : ""}`);
if (DRY || !out.length) process.exit(0);
const api = await connect();
const res = await api.call("PATCH", "/x/api/v1/site/outline", { headers: api.headers, body: { site: { name: SITE }, items: out } });
if (!res.ok) throw new Error(`outline save failed (${res.status}): ${JSON.stringify(res.json).slice(0, 300)}`);
console.log("saved");
