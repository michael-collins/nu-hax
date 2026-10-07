// Courses as pages: a Course content type (OER Schema oer:Course), a
// Courses section under the Curriculum heading, and a page per course code
// the site uses. A course page lists the course's materials by itself: its
// collection shows every page whose Courses field holds the code.
//   node --env-file=.env.local scripts/create-course-pages.mjs [--dry-run]
//
// Also: every type's Courses field becomes a pick from the course codes
// (Course pages' codes and the codes pages use), Quizzes and Resources get a
// Courses field, and "Dart 303" is merged into "DART 303".
// Titles, credits and prerequisites are from the Penn State bulletin
// (bulletins.psu.edu, checked 2026-10-07); the page links to the bulletin
// rather than copying its description. Safe to run again: existing course
// pages (matched by code) are left alone.
import { readFileSync } from "node:fs";
import path from "node:path";
import { connect } from "./lib/hax-api.mjs";

const SITE_DIR = process.env.SITE_DIR || new URL("../learning-materials/", import.meta.url).pathname;
const SITE = process.env.HAX_SITE || "learning-materials";
const DRY = process.argv.includes("--dry-run");
const bulletin = (code) => `https://bulletins.psu.edu/search/?P=${encodeURIComponent(code)}`;
const DMD = { program: "Digital Multimedia Design (B.Des.)", delivery: "Online" };

const COURSES = [
  { code: "DMD 100", title: "Digital Multimedia Design Foundations", credits: "3", ...DMD, book: "DMD 100: Digital Multimedia Design Foundations" },
  {
    code: "DMD 300",
    title: "Digital Multimedia Design Studio",
    credits: "3",
    ...DMD,
    requires: ["DMD 100"],
    note: "Enforced prerequisite at enrollment: DART 100 and DMD 100 and 9 credits from the following list: ART 211Y, COMM 215, COMM 230W, DART 202, IST 140, IST 250.",
    book: "DMD 300: Digital Multimedia Design Studio",
  },
  {
    code: "DMD 400",
    title: "Digital Multimedia Design Capstone",
    credits: "3 (maximum of 6)",
    ...DMD,
    requires: ["DMD 100", "DMD 300"],
    note: "Enforced prerequisite: DMD 100 and DMD 300.",
    book: "DMD 400: Digital Multimedia Design Capstone",
  },
  { code: "DART 203", title: "3D Digital Art & Design Fundamentals", credits: "3" },
  {
    code: "DART 303",
    title: "3D Studio",
    credits: "4 (maximum of 8)",
    note: "Enforced prerequisite: DART 202, and enrollment in the ARTBA_BA, ARBFA_BFA, AED_BS, DIGMD_BDES, IDS_BDES, PHOTO_BDES or ARTAB_BA degree program.",
  },
  {
    code: "DART 413",
    title: "Digital Fabrication Studio",
    credits: "4",
    requires: ["DART 203"],
    note: "Enforced prerequisite: DART 203 or DART 213 or ART 230 or ART 280 or ART 110 or ART 111.",
    book: "DART 413: Digital Fabrication Studio",
    // its materials are unpublished until D10 (public vs. LMS) is decided
    published: false,
    description: (() => {
      try {
        return JSON.parse(readFileSync(new URL("../../digi-fab-course/data/project.json", import.meta.url), "utf8")).description;
      } catch {
        return "";
      }
    })(),
  },
];
const MERGE = { "Dart 303": "DART 303" };

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const attr = (s) => esc(s).replace(/"/g, "&quot;");

const read = () => JSON.parse(readFileSync(path.join(SITE_DIR, "site.json"), "utf8")).items;
let items = read();
const live = (i) => !i.metadata?.oerSnapshotOf && !i.metadata?.oerRef?.page;
const sys = items.find((i) => i.metadata?.pageType === "oer:system");
const defs = sys.metadata.oerContentTypes;
const lesson = defs.types.find((t) => t.id === "oer:lesson");
const coursesField = { ...lesson.fields.find((f) => f.name === "courses"), suggest: true, suggestFrom: "oer:course:code" };
const license = lesson.fields.find((f) => f.name === "license");

/* ---------- content types ---------- */

let types = defs.types.map((t) => {
  let fields = t.fields.map((f) => (f.name === "courses" ? { ...f, suggest: true, suggestFrom: "oer:course:code" } : f));
  if (["oer:quiz", "oer:resource"].includes(t.id) && !fields.some((f) => f.name === "courses")) fields = [...fields, coursesField];
  return { ...t, fields };
});
if (!types.some((t) => t.id === "oer:course")) {
  const pathwayAt = types.findIndex((t) => t.id === "oer:pathway");
  types.splice(pathwayAt, 0, {
    id: "oer:course",
    label: "Course",
    icon: "oer:graduation-cap",
    description: "A course in the catalog: its code, bulletin entry and prerequisites, and every page taught in it.",
    schemaType: "oer:Course",
    nav: false,
    children: [],
    fields: [
      { name: "code", label: "Course code", kind: "text", required: true, header: true, help: "As in the bulletin, e.g. DART 413. Pages whose Courses field holds this code are listed on the course page." },
      { name: "credits", label: "Credits", kind: "text", header: true },
      { name: "bulletin", label: "Bulletin", kind: "url", header: true, help: "The course's entry in the university bulletin. Link to it rather than copying its description." },
      { name: "program", label: "Program", kind: "text", suggest: true },
      { name: "delivery", label: "Delivery", kind: "select", header: true, options: ["In person", "Online", "Hybrid"].map((v) => ({ value: v, label: v })) },
      { name: "termsOffered", label: "Terms offered", kind: "list" },
      { name: "coursePrerequisites", label: "Prerequisites", kind: "relation", header: true, types: ["oer:course"], help: "Course pages on this site. Put the bulletin's full wording in Prerequisite details." },
      { name: "prerequisiteNote", label: "Prerequisite details", kind: "longtext", header: true },
      { name: "instructors", label: "Instructors", kind: "people" },
      { name: "pathways", label: "Pathways", kind: "relation", header: true, types: ["oer:pathway"] },
      { name: "books", label: "Books", kind: "relation", header: true, types: ["oer:book"] },
      {
        name: "studentWork",
        label: "Student work",
        kind: "files",
        header: true,
        help: "Links to student work hosted elsewhere (an exhibition site, a portfolio). Share work only with each student's written permission, credited as they choose.",
      },
      ...(license ? [license] : []),
    ],
  });
}
const out = [];
if (JSON.stringify(types) !== JSON.stringify(defs.types)) out.push({ ...sys, metadata: { ...sys.metadata, oerContentTypes: { ...defs, types } }, modified: true });

/* ---------- "Dart 303" → "DART 303" ---------- */

let merged = 0;
for (const i of items) {
  const c = i.metadata?.oerFields?.courses;
  // archived versions stay as released
  if (!Array.isArray(c) || !c.some((x) => MERGE[x]) || i.metadata?.oerSnapshotOf) continue;
  const next = [...new Set(c.map((x) => MERGE[x] || x))];
  out.push({ ...i, metadata: { ...i.metadata, oerFields: { ...i.metadata.oerFields, courses: next } }, modified: true });
  merged++;
}

/* ---------- the Courses section, under Curriculum ---------- */

const top = items.filter((i) => !i.parent).sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
let section = top.find((i) => i.title === "Courses");
const create = [];
if (!section) {
  section = {
    id: "new-courses-section",
    title: "Courses",
    parent: null,
    order: 0,
    indent: 0,
    location: "",
    description: "",
    metadata: { pageType: "oer:section", icon: "oer:graduation-cap", published: true },
    contents:
      '<p>The courses these materials are taught in. Each course page links to its bulletin entry and lists every lesson, reading, exercise and project taught in it.</p>\n<oer-collection types="oer:course" scope="site" view="table" sort="title" per-page="20" controls="full"></oer-collection>',
    new: true,
  };
  create.push(section);
  // first under the Curriculum heading
  const at = top.findIndex((i) => i.title === "Curriculum") + 1;
  const ordered = [...top.slice(0, at), section, ...top.slice(at)];
  ordered.forEach((i, n) => {
    if (i === section) section.order = n;
    else if (i.order !== n) out.push({ ...i, order: n, modified: true });
  });
}

/* ---------- course pages ---------- */

const existing = new Map(items.filter((i) => i.metadata?.pageType === "oer:course" && live(i)).map((i) => [String(i.metadata?.oerFields?.code || "").toUpperCase(), i]));
const coursesOf = (i) => (i.metadata?.oerFields?.courses || []).map((x) => String(MERGE[x] || x).toUpperCase());
let order = 0;
for (const c of COURSES) {
  if (existing.has(c.code.toUpperCase())) continue;
  const pathways = items.filter((i) => live(i) && i.metadata?.pageType === "oer:pathway" && coursesOf(i).includes(c.code.toUpperCase()));
  const book = c.book && items.find((i) => live(i) && i.metadata?.pageType === "oer:book" && i.title === c.book);
  const intro = c.description
    ? `<oer-draft note="Course description from the ${attr(c.code)} course plan. Revise it, then Publish to show it to readers.">\n<p>${esc(c.description)}</p>\n</oer-draft>`
    : "";
  create.push({
    id: `new-course-${c.code.replace(/\W+/g, "-")}`,
    title: `${c.code}: ${c.title}`,
    parent: section.id,
    order: order++,
    indent: 1,
    location: "",
    description: "",
    metadata: {
      pageType: "oer:course",
      published: c.published !== false,
      oerCourse: c.code,
      oerFields: {
        code: c.code,
        credits: c.credits,
        bulletin: bulletin(c.code),
        ...(c.program ? { program: c.program } : {}),
        ...(c.delivery ? { delivery: c.delivery } : {}),
        ...(c.note ? { prerequisiteNote: c.note } : {}),
        ...(pathways.length ? { pathways: pathways.map((p) => ({ page: p.id, version: "" })) } : {}),
        ...(book ? { books: [{ page: book.id, version: "" }] } : {}),
        license: "CC BY 4.0",
      },
    },
    contents: `${intro ? `${intro}\n` : ""}<h2>Taught in this course</h2>\n<oer-collection scope="site" view="table" sort="title" per-page="50" controls="full" group="type"></oer-collection>`,
    new: true,
    _requires: c.requires || [],
    _description: `${c.title}, ${c.credits} credits.`,
  });
}

console.log(`${create.filter((x) => x.metadata.pageType === "oer:course").length} course pages to create${section.new ? " (and the Courses section)" : ""}; ${merged} pages' course codes merged${out.some((x) => x === out[0] && x.metadata?.pageType === "oer:system") ? "; Course type added, Courses fields pick from course codes" : ""}`);
for (const c of create) if (c.metadata.pageType === "oer:course") console.log(`  + ${c.title}  ${c.metadata.oerFields.pathways ? `(${c.metadata.oerFields.pathways.length} pathways)` : ""}${c.metadata.oerFields.books ? " (book)" : ""}${c.metadata.published ? "" : " [unpublished]"}`);
if (DRY) process.exit(0);

const api = await connect();
const save = async (list) => {
  if (!list.length) return;
  const res = await api.call("PATCH", "/x/api/v1/site/outline", { headers: api.headers, body: { site: { name: SITE }, items: list.map(({ _requires, _description, ...i }) => i) } });
  if (!res.ok) throw new Error(`outline save failed (${res.status}): ${JSON.stringify(res.json).slice(0, 300)}`);
  items = read();
};
await save([...out, ...create]);

// prerequisites between the new course pages, and descriptions
const byCode = new Map(items.filter((i) => i.metadata?.pageType === "oer:course" && live(i)).map((i) => [i.metadata.oerFields.code.toUpperCase(), i]));
const links = [];
for (const c of create.filter((x) => x._requires?.length)) {
  const page = byCode.get(c.metadata.oerFields.code.toUpperCase());
  const req = c._requires.map((code) => byCode.get(code.toUpperCase())).filter(Boolean);
  if (page && req.length) links.push({ ...page, metadata: { ...page.metadata, oerFields: { ...page.metadata.oerFields, coursePrerequisites: req.map((r) => ({ page: r.id, version: "" })) } }, modified: true });
}
await save(links);
for (const c of create) {
  const page = c.metadata.pageType === "oer:course" ? byCode.get(c.metadata.oerFields.code.toUpperCase()) : items.find((i) => !i.parent && i.title === "Courses");
  const description = c._description || "Each course, its bulletin entry and what's taught in it.";
  if (page && !page.description) await api.updateItem(page.id, "setDescription", { description });
}
console.log(`saved; ${links.length} prerequisite links`);
