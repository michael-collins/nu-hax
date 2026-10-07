// Scaffold a course on the site from its planning repo (the course-prep
// system in ../digi-fab-course: data/*.json), and keep the two linked:
//   node --env-file=.env.local scripts/sync-course-plan.mjs [--plan ../digi-fab-course] [--dry-run]
//
// Every page it makes carries metadata.oerPlan ("DART 413:M01" — the course
// code and the planning record), so running it again finds the same pages:
// it adds what's missing and refreshes what the plan owns (objectives,
// courses, a lesson's materials and readings, a quiz's coverage), and never
// overwrites page text, titles or descriptions once a page exists.
//
// What becomes what:
//   modules M01…        → Lessons (objectives; "In this lesson" and Readings links)
//   materials L…        → Lectures; Tutorials (tutorials and demos); Articles
//                         (handouts, worksheets, rubric, template). The
//                         syllabus and shop-safety handout stay in the LMS.
//   assignments A…      → Exercises; Projects (the final project's proposal
//                         becomes its first Activity)
//   readings B… (selected only) → Resources
//   QUIZZES below       → one self-check quiz per process, drafted for review
//   the course          → a Pathway (units of weeks) and a Book (a chapter a week)
// Text carried over from the plan sits in an oer-draft block: readers never
// see it; an author revises it and chooses Publish on the block. Pages start
// unpublished and marked "In development".
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";
import { connect } from "./lib/hax-api.mjs";

const args = process.argv.slice(2);
const PLAN = path.resolve(args.includes("--plan") ? args[args.indexOf("--plan") + 1] : new URL("../../digi-fab-course/", import.meta.url).pathname);
const DRY = args.includes("--dry-run");
const SITE_DIR = process.env.SITE_DIR || new URL("../learning-materials/", import.meta.url).pathname;
const SITE = process.env.HAX_SITE || "learning-materials";
const AUTHORS = [{ name: "Michael Collins", url: "" }];

/* ---------- the plan ---------- */

const load = (name) => {
  const v = JSON.parse(readFileSync(path.join(PLAN, "data", `${name}.json`), "utf8"));
  return (Array.isArray(v) ? v : v.items || Object.values(v)).filter((x) => x && !x.archived);
};
if (!existsSync(path.join(PLAN, "data", "project.json"))) throw new Error(`no planning repo at ${PLAN}`);
const project = JSON.parse(readFileSync(path.join(PLAN, "data", "project.json"), "utf8"));
const CODE = project.code; // "DART 413"
const modules = load("modules").sort((a, b) => a.week - b.week);
const materials = load("materials");
const assignments = load("assignments");
const readings = load("readings").filter((r) => ["selected", "assigned"].includes(r.status));
const themes = load("themes");

// LMS-only (the syllabus with its policies; the shop's own safety and access rules)
const LMS_ONLY = new Set(["L01", "L03"]);
const MATERIAL_TYPE = { lecture: "oer:lecture", slides: "oer:lecture", tutorial: "oer:tutorial", demo: "oer:tutorial", video: "oer:tutorial" };
const materialType = (m) => MATERIAL_TYPE[m.kind] || "oer:article";
const assignmentType = (a) => (a.kind === "project" ? "oer:project" : "oer:exercise");
// the final project's proposal is a step of the final project
const ACTIVITY_OF = { A09: "A10" };

// units: weeks grouped by process
const UNITS = [
  { title: "Foundations", weeks: [1] },
  { title: "Laser and sheet", weeks: [2, 3, 4, 5] },
  { title: "Additive and parametric", weeks: [6, 7, 8] },
  { title: "Subtractive", weeks: [9, 10] },
  { title: "Hybrid processes and the final project", weeks: [11, 12, 13, 14, 15] },
];

// self-check quizzes, one per process: suggested questions for review
const QUIZZES = {
  M02: {
    title: "Laser cutting quiz",
    about: "laser cutting",
    mc: [
      ["What is kerf?", "The width of material the laser removes along a cut", ["The depth of an engraved area", "A gap left between parts on purpose", "The speed setting for vector cuts"]],
      ["Why is PVC (vinyl) on every laser cutter's list of forbidden materials?", "Cutting it releases chlorine gas, which harms people and corrodes the machine", ["It is too hard for the laser to cut", "It can't be engraved", "It warps the bed"]],
    ],
    tf: ["A press-fit slot should be drawn exactly as wide as the material is thick.", false],
    sc: ["Your file cuts some lines and engraves others. How does the laser know which is which?", "From the drawing's conventions: hairline strokes in the cut colour are cut, other stroke colours are scored, and filled shapes or images are engraved. The studio's handout gives its exact colours and line weight."],
  },
  M06: {
    title: "3D printing quiz",
    about: "3D printing",
    mc: [
      ["A printed bracket snaps cleanly along a layer line. What is the best design fix?", "Reorient the print so the load runs along the layers, not across them", ["Print it faster", "Use a smaller nozzle", "Turn supports off"]],
      ["Why does a slicer need a watertight (manifold) mesh?", "It needs a closed surface to tell inside from outside when it computes each layer", ["Open meshes print too fast", "Watertight meshes never need supports", "STL files can't store open meshes"]],
    ],
    tf: ["In FDM printing, overhangs steeper than about 45 degrees from vertical usually need support.", true],
    sc: ["Two printed parts should slide together. Why can't you model them at exactly the same size?", "Printed parts come out slightly larger or smaller than the model, and layer lines add roughness, so a fit needs clearance. Find the right gap for your printer and material with a small test print before printing the real parts."],
  },
  M09: {
    title: "CNC routing quiz",
    about: "CNC routing",
    mc: [
      ["In 2.5D milling, what can't a straight end mill cut, whatever the toolpath?", "An inside corner sharper than the bit's radius", ["A pocket deeper than half the stock", "A curved outline", "Lettering"]],
      ["What are tabs for in a profile cut?", "They hold the part to the stock so it can't shift or fly loose as the cut finishes", ["They mark where the cut starts", "They cool the bit", "They stop tear-out on the top face"]],
    ],
    tf: ["Feeds and speeds only change how long a job takes, not the quality or safety of the cut.", false],
    sc: ["Before you start a CNC job, what do you check about zero?", "That X and Y zero are where the CAM setup expects them (a corner or the centre of the stock), and that Z zero is set to the surface the CAM used (the top of the stock or the spoilboard). A mismatch cuts air, or cuts into the spoilboard."],
  },
};

/* ---------- helpers ---------- */

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const attr = (s) => esc(s).replace(/"/g, "&quot;");
// planning ids (L02, A01, F27, Q04, R006…) mean nothing on the site
const unplan = (s) =>
  String(s || "")
    .replace(/\s*\((?:[A-Z]\d{2,3}[,;/\s–-]*|unknown[^)]*?|see [^)]*?)+\)/g, "")
    .replace(/\s*\b[LAFBMPRTQDW]\d{2,3}\b/g, "")
    .replace(/\s+([,.;:])/g, "$1")
    .trim();
const list = (items) => (items?.length ? `<ul>${items.map((x) => `<li>${esc(unplan(x))}</li>`).join("")}</ul>` : "");
const draft = (note, html) => `<oer-draft note="${attr(note)}">\n${html}\n</oer-draft>\n`;
const key = (id) => `${CODE}:${id}`;
const firstSentence = (s) => (String(s || "").match(/^.*?[.!?](?=\s|$)/) || [String(s || "")])[0].trim();

function lessonTitle(m) {
  return m.title;
}
function cleanTitle(m) {
  return m.title.replace(/^(Lecture|Tutorial|Handout):\s*/, "");
}

// parse a citation for container and publisher (editor/parse-reference.js)
globalThis.document = new JSDOM("").window.document;
const { parseReference } = await import("../learning-materials/custom/src/editor/parse-reference.js");
function citationParts(citation) {
  const li = globalThis.document.createElement("li");
  li.textContent = citation || "";
  return parseReference(li);
}
const people = (s) =>
  String(s || "")
    .split(/\s*(?:;|,?\s+and\s+|&)\s*/)
    .map((n) => n.trim())
    .filter(Boolean)
    .map((name) => ({ name, url: "" }));

/* ---------- the site ---------- */

const read = () => JSON.parse(readFileSync(path.join(SITE_DIR, "site.json"), "utf8")).items;
let items = read();
const byPlan = () => new Map(items.filter((i) => i.metadata?.oerPlan && !i.metadata?.oerSnapshotOf).map((i) => [i.metadata.oerPlan, i]));
const section = (title) => {
  const s = items.find((i) => !i.parent && i.title === title);
  if (!s) throw new Error(`no "${title}" section`);
  return s;
};
const lastOrder = (parentId) => Math.max(-1, ...items.filter((i) => i.parent === parentId).map((i) => Number(i.order) || 0));

const sys = items.find((i) => i.metadata?.pageType === "oer:system");
const defs = sys.metadata.oerContentTypes;
const typeDef = (id) => defs.types.find((t) => t.id === id);

/* ---------- 0. a Readings field on lessons ---------- */

const typeChanges = [];
if (!typeDef("oer:lesson").fields.some((f) => f.name === "readings")) {
  const types = defs.types.map((t) =>
    t.id === "oer:lesson"
      ? {
          ...t,
          fields: t.fields.flatMap((f) =>
            f.name === "components" ? [f, { name: "readings", label: "Readings", kind: "relation", header: true, types: ["oer:resource"], help: "What to read for this lesson, from Resources." }] : [f],
          ),
        }
      : t,
  );
  typeChanges.push({ ...sys, metadata: { ...sys.metadata, oerContentTypes: { ...defs, types } }, modified: true });
}

/* ---------- 1. library pages ---------- */

const plan = []; // { key, title, description, parentKey | parentId, metadata, contents }
const fields = (typeId, extra = {}) => {
  const names = new Set(typeDef(typeId).fields.map((f) => f.name));
  const base = { courses: [CODE], license: "CC BY 4.0", authors: AUTHORS, placeholder: true, ...extra };
  return Object.fromEntries(Object.entries(base).filter(([k]) => names.has(k)));
};
const page = (p) => plan.push({ published: false, ...p });

const mdToHtml = async (api, md) => {
  if (DRY || !String(md || "").trim()) return `<p>${esc(md)}</p>`;
  const r = await api.call("POST", "/system/api/v1/actions/md-to-html", { headers: api.userHeaders, body: { md } });
  if (!r.ok) throw new Error(`md-to-html failed (${r.status})`);
  return r.json.data.contents;
};
const api = DRY ? null : await connect();

// readings → Resources
for (const r of readings) {
  const parts = citationParts(r.citation);
  page({
    key: key(r.id),
    title: r.title,
    description: unplan(r.why),
    parentId: section("Resources").id,
    pageType: "oer:resource",
    oerFields: {
      ...(r.url ? { url: r.url } : {}),
      kind: "reading",
      courses: [CODE],
      authors: people(r.authors),
      ...(r.year ? { date: String(r.year) } : {}),
      ...(parts.container ? { container: parts.container } : {}),
      ...(parts.publisher ? { publisher: parts.publisher } : {}),
    },
    contents: `<p>${esc(r.citation)}</p>\n${r.pages ? `<p>Pages: ${esc(r.pages)}</p>\n` : ""}`,
  });
}

// materials → Lectures, Tutorials, Articles
const SECTION_OF = { "oer:lecture": "Lectures", "oer:tutorial": "Tutorials", "oer:article": "Articles" };
for (const m of materials.filter((x) => !LMS_ONLY.has(x.id))) {
  const t = materialType(m);
  const outline = String(m.outline || "").trim();
  page({
    key: key(m.id),
    title: cleanTitle(m),
    description: "",
    parentId: section(SECTION_OF[t]).id,
    pageType: t,
    oerFields: fields(t),
    contents: outline ? draft(`Outline from the ${CODE} course plan. Revise it, then Publish to show it to readers.`, await mdToHtml(api, outline)) : "<p></p>",
  });
}

// assignments → Exercises, Projects (and the final project's proposal as its Activity)
const theme = (id) => themes.find((t) => t.id === id);
function briefHtml(a) {
  const th = a.themeId ? theme(a.themeId) : null;
  return [
    `<p>${esc(unplan(a.brief))}</p>`,
    th ? `<h2>Theme: ${esc(th.title)}</h2>\n<p>${esc(unplan(th.description))}</p>${th.techniques ? `\n<p>Techniques: ${esc(unplan(th.techniques))}</p>` : ""}` : "",
    a.deliverables?.length ? `<h2>What to hand in</h2>\n${list(a.deliverables)}` : "",
    a.objectives?.length ? `<h2>What you'll practise</h2>\n${list(a.objectives)}` : "",
    a.duration ? `<p>Time: ${esc(unplan(a.duration))}</p>` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
for (const a of assignments) {
  const owner = ACTIVITY_OF[a.id];
  const t = owner ? "oer:activity" : assignmentType(a);
  page({
    key: key(a.id),
    title: a.title,
    description: unplan(firstSentence(a.brief)),
    ...(owner ? { parentKey: key(owner), order: 0 } : { parentId: section(t === "oer:project" ? "Projects" : "Exercises").id }),
    pageType: t,
    oerFields: fields(t),
    contents: a.brief ? draft(`Brief from the ${CODE} course plan. Revise it, then Publish to show it to readers.`, briefHtml(a)) : "<p></p>",
  });
}

// modules → Lessons
for (const m of modules) {
  const activities = String(m.activities || "")
    .split(/\s*·\s*/)
    .map(unplan)
    // the plan writes class time as bare minutes: "proposal pitches (80)"
    .map((x) => x.replace(/\((\d{1,3})\)$/, "($1 min)"))
    .filter(Boolean);
  const body = [
    m.topics ? `<p>${esc(unplan(m.topics))}</p>` : "",
    m.theory ? `<h2>Ideas</h2>\n<p>${esc(unplan(m.theory))}</p>` : "",
    activities.length ? `<h2>In class</h2>\n${list(activities)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  page({
    key: key(m.id),
    title: lessonTitle(m),
    description: unplan(firstSentence(m.topics)),
    parentId: section("Lessons").id,
    pageType: "oer:lesson",
    oerFields: fields("oer:lesson", { learningObjectives: (m.objectives || []).map(unplan), estimatedDuration: "1 week" }),
    contents: body ? draft(`Week ${m.week} from the ${CODE} course plan. Revise it, then Publish to show it to readers.`, body) : "<p></p>",
  });
}

// quizzes (suggested questions, for review)
const answers = (correct, wrong) => [`<input type="checkbox" value="${attr(correct)}" correct data-correct="true">`, ...wrong.map((w) => `<input type="checkbox" value="${attr(w)}">`)].join("\n  ");
for (const [moduleId, q] of Object.entries(QUIZZES)) {
  const html = [
    `<p>Check your understanding of ${esc(q.about)}. Your answers aren't recorded.</p>`,
    ...q.mc.map(([question, right, wrong]) => `<multiple-choice question="${attr(question)}" single-option randomize>\n  ${answers(right, wrong)}\n</multiple-choice>`),
    `<true-false-question question="${attr(q.tf[0])}">\n  ${q.tf[1] ? answers("True", ["False"]) : answers("False", ["True"])}\n</true-false-question>`,
    `<self-check title="Think it through">\n  <p slot="question">${esc(q.sc[0])}</p>\n  <p>${esc(q.sc[1])}</p>\n</self-check>`,
  ].join("\n");
  page({
    key: key(`quiz:${moduleId}`),
    title: q.title,
    description: `Self-check questions on ${q.about}.`,
    parentId: section("Quizzes").id,
    pageType: "oer:quiz",
    oerFields: fields("oer:quiz", { estimatedDuration: "10 minutes" }),
    contents: draft("Suggested questions, written from the week's objectives. Check them, then Publish.", html),
  });
}

// the pathway and the book
const courseObjectives = (() => {
  const syllabus = materials.find((m) => m.id === "L01")?.outline || "";
  return [...syllabus.matchAll(/^\d+\.\s+\*\*[^*]+\*\*\s+(.+?)\s+—\s+\*Evidence/gm)].map((x) =>
    x[1].replace(/\*/g, "").replace(/\s*\[[^\]]*\]/g, "").trim(),
  );
})();
const courseIntro = `<p>${esc(project.description)}</p>${courseObjectives.length ? `\n<h2>By the end of the course you will be able to</h2>\n${list(courseObjectives)}` : ""}`;
page({
  key: key("pathway"),
  title: project.name,
  description: firstSentence(project.description),
  parentId: items.find((i) => !i.parent && i.title === "Pathways").id,
  pageType: "oer:pathway",
  oerFields: fields("oer:pathway", { estimatedDuration: `One course run (${project.semesterWeeks || 15} weeks)` }),
  contents: `<oer-pathway layout="syllabus"></oer-pathway>\n${draft(`Course description and objectives from the ${CODE} course plan (syllabus draft). Revise them, then Publish.`, courseIntro)}`,
});
page({
  key: key("book"),
  title: `${CODE}: ${project.name}`,
  description: firstSentence(project.description),
  parentId: section("Books").id,
  pageType: "oer:book",
  oerFields: fields("oer:book", { introductionTitle: "Overview" }),
  contents: draft(`Course description from the ${CODE} course plan. Revise it, then Publish.`, courseIntro),
});

/* ---------- write helpers ---------- */

const save = async (list) => {
  if (!list.length) return;
  const res = await api.call("PATCH", "/x/api/v1/site/outline", { headers: api.headers, body: { site: { name: SITE }, items: list } });
  if (!res.ok) throw new Error(`outline save failed (${res.status}): ${JSON.stringify(res.json).slice(0, 300)}`);
  items = read();
};
const newItem = (p, parentId, order, indent) => ({
  id: `new-${p.key.replace(/[^\w-]+/g, "-")}`,
  title: p.title,
  parent: parentId,
  order,
  indent,
  location: "",
  description: "",
  metadata: { pageType: p.pageType, oerPlan: p.key, published: p.published !== false, ...(p.ref ? { oerRef: { page: p.ref, version: "" } } : {}), ...(p.oerFields ? { oerFields: p.oerFields } : {}) },
  contents: p.ref ? `<oer-include page="${p.ref}"></oer-include>` : p.contents || "<p></p>",
  new: true,
});

// pass 1: library pages, pathway and book (children of new pages ride in the same save)
let existing = byPlan();
const create = [];
const orders = new Map();
const nextOrder = (parentId) => {
  const n = (orders.has(parentId) ? orders.get(parentId) : lastOrder(parentId)) + 1;
  orders.set(parentId, n);
  return n;
};
// pages that go under another new page come after it
for (const p of [...plan.filter((x) => !x.parentKey), ...plan.filter((x) => x.parentKey)]) {
  if (existing.has(p.key)) continue;
  const parentId = p.parentKey ? existing.get(p.parentKey)?.id || `new-${p.parentKey.replace(/[^\w-]+/g, "-")}` : p.parentId;
  const parent = items.find((i) => i.id === parentId) || create.find((i) => i.id === parentId);
  create.push(newItem(p, parentId, p.order ?? nextOrder(parentId), (Number(parent?.indent) || 0) + 1));
}
// parents before children
create.sort((a, b) => a.indent - b.indent);
console.log(`${CODE}: ${plan.length} pages in the plan; ${create.length} to create${typeChanges.length ? "; Lesson gets a Readings field" : ""}`);
const counts = {};
for (const c of create) counts[c.metadata.pageType] = (counts[c.metadata.pageType] || 0) + 1;
console.log(`  ${Object.entries(counts).map(([t, n]) => `${n} ${t.replace("oer:", "")}`).join(", ")}`);
if (DRY) {
  // --show "DART 413:M01" prints that page as it would be created
  const show = args.includes("--show") ? args[args.indexOf("--show") + 1] : "";
  if (show) {
    const c = create.find((x) => x.metadata.oerPlan === show);
    console.log(JSON.stringify(c?.metadata, null, 1), "\n", c?.contents);
    process.exit(0);
  }
  for (const c of create) console.log(`  + [${c.metadata.pageType.replace("oer:", "")}] ${c.title}`);
  process.exit(0);
}
await save([...typeChanges, ...create]);
existing = byPlan();
const idOf = (k) => existing.get(key(k))?.id;

// what each lesson is made of, in order: materials, exercises and the project, then the quiz
const order = (id) => Number(id.slice(1));
const componentsOf = (m) => [
  ...materials.filter((x) => !LMS_ONLY.has(x.id) && x.moduleIds.includes(m.id)).sort((a, b) => order(a.id) - order(b.id)),
  ...assignments.filter((a) => !ACTIVITY_OF[a.id] && a.moduleIds[0] === m.id).sort((a, b) => order(a.id) - order(b.id)),
  ...(QUIZZES[m.id] ? [{ id: `quiz:${m.id}` }] : []),
].map((x) => x.id);

// pass 2: units under the pathway, chapters in the book (linked chapters)
const pathway = existing.get(key("pathway"));
const book = existing.get(key("book"));
const refs = [];
const addRef = (k, title, srcId, parentId, ord, indent) => {
  if (existing.has(k) || !srcId) return null;
  const src = items.find((i) => i.id === srcId);
  const item = newItem({ key: k, title, pageType: src.metadata.pageType, ref: srcId, published: false }, parentId, ord, indent);
  refs.push(item);
  return item.id;
};
UNITS.forEach((u, n) => {
  const k = key(`unit:${n + 1}`);
  let unitId = existing.get(k)?.id;
  if (!unitId) {
    const unit = newItem(
      { key: k, title: u.title, pageType: "oer:unit", published: false, oerFields: { estimatedDuration: `${u.weeks.length} week${u.weeks.length > 1 ? "s" : ""}` }, contents: "<oer-unit></oer-unit>" },
      pathway.id,
      n,
      (Number(pathway.indent) || 0) + 1,
    );
    refs.push(unit);
    unitId = unit.id;
  }
  modules
    .filter((m) => u.weeks.includes(m.week))
    .forEach((m, i) => addRef(key(`unit:${n + 1}:${m.id}`), lessonTitle(m), idOf(m.id), unitId, i, (Number(pathway.indent) || 0) + 2));
});
modules.forEach((m, n) => {
  const k = key(`book:${m.id}`);
  const chapterId = existing.get(k)?.id || addRef(k, `Week ${m.week}: ${lessonTitle(m)}`, idOf(m.id), book.id, n, (Number(book.indent) || 0) + 1);
  componentsOf(m).forEach((c, i) => {
    const page = items.find((x) => x.id === idOf(c));
    if (page) addRef(key(`book:${m.id}:${c}`), page.title, page.id, chapterId, i, (Number(book.indent) || 0) + 2);
  });
});
refs.sort((a, b) => a.indent - b.indent);
await save(refs);
console.log(`pass 2: ${refs.length} units and chapters`);
existing = byPlan();

// pass 3: what the plan owns on existing pages: links between them, objectives, courses
const links = (ids) => ids.map(idOf).filter(Boolean).map((page) => ({ page, version: "" }));
const updates = [];
const setFields = (k, next) => {
  const item = existing.get(k);
  if (!item) return;
  const cur = item.metadata?.oerFields || {};
  const merged = { ...cur, ...next };
  if (JSON.stringify(merged) !== JSON.stringify(cur)) updates.push({ ...item, metadata: { ...item.metadata, oerFields: merged }, modified: true });
};
for (const m of modules) {
  setFields(key(m.id), {
    components: links(componentsOf(m)),
    readings: links(readings.filter((r) => r.moduleIds.includes(m.id)).map((r) => r.id)),
    learningObjectives: (m.objectives || []).map(unplan),
    courses: [CODE],
  });
}
// every plan page whose type has a Courses field carries the course code
// (Quizzes and Resources gained one after the first scaffold)
for (const p of plan) {
  const item = existing.get(p.key);
  if (!item || !typeDef(item.metadata?.pageType)?.fields.some((f) => f.name === "courses")) continue;
  const cur = item.metadata?.oerFields?.courses || [];
  if (!cur.includes(CODE)) setFields(p.key, { courses: [...cur, CODE] });
}
// pages that belong under another plan page (the final project's proposal)
for (const p of plan.filter((x) => x.parentKey)) {
  const item = existing.get(p.key);
  const parent = existing.get(p.parentKey);
  if (item && parent && item.parent !== parent.id) updates.push({ ...item, parent: parent.id, indent: (Number(parent.indent) || 0) + 1, order: p.order ?? 0, modified: true });
}
for (const moduleId of Object.keys(QUIZZES)) {
  const m = modules.find((x) => x.id === moduleId);
  setFields(key(`quiz:${moduleId}`), { prerequisites: links([moduleId, ...componentsOf(m).filter((c) => !c.startsWith("quiz:") && materials.some((x) => x.id === c))]) });
}
await save(updates);
console.log(`pass 3: ${updates.length} pages linked or refreshed`);

// descriptions (outline saves drop them): new pages only
let described = 0;
for (const p of plan) {
  const item = existing.get(p.key);
  if (!item || item.description || !p.description || !create.some((c) => c.metadata.oerPlan === p.key)) continue;
  const res = await api.updateItem(item.id, "setDescription", { description: p.description });
  if (!res.ok) throw new Error(`setDescription "${item.title}" failed (${res.status})`);
  described++;
}
console.log(`descriptions: ${described}`);
console.log(`done. Pages are unpublished and marked In development; plan text waits in Draft blocks.`);
