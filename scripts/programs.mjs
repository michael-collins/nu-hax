// Programs (the user's request, 2026-10-09): an Institution heading at the
// end of the navigation with a Programs section, and the degree programs as
// pages of a new Program type (custom/src/types/program.js PROGRAM_DEF),
// each listing the courses that count toward it. Courses' Degree programs
// field becomes links to those pages, instead of a choice of names.
//   node --env-file=.env.local scripts/programs.mjs [--dry-run]
// HAX_BASE and SITE_DIR point it at another copy (a scratch server). Safe to run again.
import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { connect } from "./lib/hax-api.mjs";

const SITE_DIR = process.env.SITE_DIR || new URL("../learning-materials/", import.meta.url).pathname;
const SITE = process.env.HAX_SITE || "learning-materials";
const DRY = process.argv.includes("--dry-run");
const PROGRAM = "oer:program";
const CAMPUSES = [
  { value: "University Park", label: "University Park" },
  { value: "World Campus", label: "World Campus" },
];
// mirrors PROGRAM_DEF in custom/src/types/program.js
const DEF = {
  id: PROGRAM,
  label: "Program",
  icon: "oer:school",
  description: "A degree or certificate: where it's offered, its bulletin entry, and the courses that count toward it.",
  schemaType: "EducationalOccupationalProgram",
  children: [],
  nav: false,
  template: '<p></p>\n<h2>Courses</h2>\n<oer-collection types="oer:course" scope="linked" view="table" sort="title" controls="none"></oer-collection>',
  fields: [
    { name: "shortName", label: "Short name", kind: "text", header: true, help: "What people call it, e.g. DMD." },
    { name: "degree", label: "Degree", kind: "text", header: true, help: "The credential, e.g. Bachelor of Design (B.Des.)." },
    { name: "institution", label: "Institution", kind: "text", header: true },
    { name: "campuses", label: "Campuses", kind: "select", multiple: true, header: true, filter: true, options: CAMPUSES, help: "Where it's offered." },
    { name: "programUrl", label: "Program website", kind: "url", header: true },
    { name: "bulletin", label: "Bulletin entry", kind: "url", header: true },
  ],
};
const PROGRAMS_FIELD = { name: "programs", label: "Degree programs", kind: "relation", types: [PROGRAM], header: true, filter: true, help: "The programs this course counts toward." };
const SECTION_TEXT =
  '<p>The degree programs these materials are taught in. Each program page lists the courses that count toward it.</p>\n<oer-collection types="oer:program" scope="site" view="table" sort="order" controls="none"></oer-collection>';
// the programs courses named (their old Degree programs choices), as pages
const PAGES = [
  { slug: "programs/dmd", title: "Digital Multimedia Design (B.Des.)", shortName: "DMD" },
  { slug: "programs/dart", title: "Digital Arts and Media Design (B.Des.)", shortName: "DART" },
];
const MICROSITES = ["oer:course-site", "oer:course-hub", "oer:book-site"];

const read = () => JSON.parse(readFileSync(path.join(SITE_DIR, "site.json"), "utf8")).items;
const live = (i) => !i.metadata?.oerSnapshotOf;
let api = null;
async function save(items, what) {
  console.log(`${what}: ${items.length} item(s)${DRY ? " (dry run)" : ""}`);
  if (DRY || !items.length) return;
  api ||= await connect();
  const res = await api.call("PATCH", "/x/api/v1/site/outline", { headers: api.headers, body: { site: { name: SITE }, items } });
  if (!res.ok) throw new Error(`outline save failed (${res.status}): ${JSON.stringify(res.json).slice(0, 300)}`);
}

// 1. the type, and courses' Degree programs as links to it
let items = read();
const out = [];
const sys = items.find((i) => i.metadata?.pageType === "oer:system");
const raw = sys.metadata.oerContentTypes;
const types = typeof raw === "string" ? JSON.parse(raw) : structuredClone(raw);
const before = JSON.stringify(types);
if (!types.types.some((t) => t.id === PROGRAM)) {
  const at = types.types.findIndex((t) => t.id === "oer:course");
  types.types.splice(at >= 0 ? at : types.types.length, 0, DEF);
  console.log("content types: Program");
}
const course = types.types.find((t) => t.id === "oer:course");
const field = course?.fields?.find((f) => f.name === "programs");
if (field && field.kind !== "relation") {
  course.fields[course.fields.indexOf(field)] = PROGRAMS_FIELD;
  console.log("course type: Degree programs links to program pages");
}
if (JSON.stringify(types) !== before) out.push({ ...sys, metadata: { ...sys.metadata, oerContentTypes: typeof raw === "string" ? JSON.stringify(types) : types }, modified: true });

// 2. Institution and Programs at the end of the navigation, and the program pages
const top = items.filter((i) => !i.parent && live(i));
let section = top.find((i) => i.title === "Programs");
const last = Math.max(0, ...top.filter((i) => !MICROSITES.includes(i.metadata?.pageType)).map((i) => Number(i.order) || 0));
if (!top.some((i) => i.title === "Institution" && i.metadata?.pageType === "oer:heading")) {
  out.push({
    id: `item-${randomUUID()}`, title: "Institution", parent: null, indent: 0, order: last + 1, slug: "institution", location: "", description: "",
    metadata: { pageType: "oer:heading", hideInMenu: true, published: true, overridePathauto: true, icon: "icons:account-balance" },
    contents: "<p></p>", new: true,
  });
  console.log("navigation: Institution heading");
}
const sectionId = section?.id || `item-${randomUUID()}`;
if (!section) {
  out.push({
    id: sectionId, title: "Programs", parent: null, indent: 0, order: last + 2, slug: "programs", location: "", description: "",
    metadata: { pageType: "oer:section", published: true, overridePathauto: true },
    contents: SECTION_TEXT, new: true,
  });
  console.log("navigation: Programs section");
}
const courses = items.filter((i) => i.metadata?.pageType === "oer:course" && live(i));
PAGES.forEach((p, n) => {
  if (items.some((i) => i.slug === p.slug && live(i))) return;
  // where it's offered: where its courses are taught, to start with
  const taught = courses.filter((c) => (c.metadata?.oerFields?.programs || []).includes(p.title));
  const campuses = CAMPUSES.map((c) => c.value).filter((c) => taught.some((t) => t.metadata?.oerFields?.campus === c));
  const institution = taught.map((t) => t.metadata?.oerFields?.institution).find(Boolean) || "";
  out.push({
    id: `item-${randomUUID()}`, title: p.title, parent: sectionId, indent: 1, order: n, slug: p.slug, location: "", description: "",
    metadata: {
      pageType: PROGRAM, published: true, overridePathauto: true,
      oerFields: { shortName: p.shortName, degree: "Bachelor of Design (B.Des.)", institution, campuses, programUrl: "", bulletin: "" },
    },
    contents: DEF.template, new: true,
  });
  console.log(`program: /${p.slug} (${campuses.join(", ") || "no campus"}; ${taught.length} courses)`);
});
await save(out, "types and pages");

// 3. courses link to their programs (new pages get their ids when saved)
items = DRY ? items : read();
const pageFor = new Map(PAGES.map((p) => [p.title, items.find((i) => i.slug === p.slug && live(i))?.id]));
const relinked = [];
for (const c of courses) {
  const now = items.find((i) => i.id === c.id) || c;
  const value = now.metadata?.oerFields?.programs || [];
  if (!value.some((v) => typeof v === "string")) continue;
  const links = value.map((v) => (typeof v === "string" ? (pageFor.get(v) ? { page: pageFor.get(v), version: "" } : null) : v)).filter(Boolean);
  const lost = value.filter((v) => typeof v === "string" && !pageFor.get(v));
  if (lost.length && !DRY) throw new Error(`${now.title}: no program page for ${lost.join(", ")}`);
  relinked.push({ ...now, metadata: { ...now.metadata, oerFields: { ...now.metadata.oerFields, programs: links } }, modified: true });
  console.log(`${now.metadata.oerFields.code}: ${value.filter((v) => typeof v === "string").join(", ")}`);
}
await save(relinked, "courses");

// 4. the section's description (outline saves drop it on new pages)
if (!DRY) {
  const programs = read().find((i) => i.id === sectionId || (!i.parent && i.title === "Programs"));
  if (programs && !programs.description) {
    api ||= await connect();
    await api.updateItem(programs.id, "setDescription", { description: "Each degree program and the courses that count toward it." });
    console.log("Programs: description");
  }
}
console.log("done");
