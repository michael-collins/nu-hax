// Put multi-part projects together: each deliverable becomes an Activity
// page under its project, in the order the Decap lesson outlines gave,
// with a heading for each stage (Discover, Define, Develop, Deliver) and
// supporting pages (inspiration, tutorials) as Articles and Tutorials in
// place. Adds the Activity content type (OER Schema oer:Activity) and lets
// Projects hold activities, headings and supporting pages.
//   node --env-file=.env.local scripts/nest-project-activities.mjs [--dry-run]
// HAX_BASE=http://localhost:3101 runs it against a test copy.
//
// Projects come from the Decap outlines:
//   DMD 100 lessons: the "Project" group (its first entry is the project)
//   DMD 300 Projects: groups with their own project page
//   DMD 400 Capstone project: the lesson is the project brief, so it
//     becomes the project page (moved from Lessons to Projects)
// Pages stay where books link them (book chapters link by page id).
import { readFileSync } from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { connect } from "./lib/hax-api.mjs";

const DECAP = process.env.DECAP_DIR || path.resolve("../open-curriculum/oerschema/learning-materials-decapcms");
const SITE_DIR = process.env.SITE_DIR || new URL("../learning-materials/", import.meta.url).pathname;
const DRY = process.argv.includes("--dry-run");
const items = JSON.parse(readFileSync(path.join(SITE_DIR, "site.json"), "utf8")).items;
const sys = items.find((i) => i.metadata?.pageType === "oer:system");
const defs = sys.metadata.oerContentTypes;
const bySource = new Map();
for (const i of items) {
  const src = i.metadata?.oerSource;
  if (typeof src === "string" && !i.metadata?.oerRef && !i.metadata?.oerSnapshotOf) bySource.set(src, i);
}
const lessonOutline = (slug) => matter(readFileSync(path.join(DECAP, "content", "lessons", slug, "index.md"), "utf8")).data.outline || [];

// 1. the projects and their parts, from Decap: [{ project, parts: [{ source, title }] }]
const projects = [];
for (const slug of ["dmd100-lesson-2-visual-and-interaction-design", "dmd100-lesson-3-storytelling", "dmd100-lesson-4-open-design"]) {
  const group = lessonOutline(slug).find((g) => g.title === "Project");
  const [first, ...rest] = group.items;
  projects.push({ project: first.content, parts: rest.map((i) => ({ source: i.content, title: i.title })) });
}
for (const g of lessonOutline("dmd300-projects").filter((g) => g.content && g.items?.length)) {
  projects.push({ project: g.content, parts: g.items.map((i) => ({ source: i.content, title: i.title })) });
}
projects.push({ project: "lessons/dmd400-capstone-project", parts: lessonOutline("dmd400-capstone-project").map((i) => ({ source: i.content, title: i.title })) });

// supporting pages: inspiration and further reading are Articles, tutorials Tutorials
const supportType = (source, title) => (/tutorial/i.test(`${source} ${title}`) ? "oer:tutorial" : /inspiration|further reading/i.test(`${source} ${title}`) ? "oer:article" : "");
// Decap's outline titles carry the stage: "Develop: Storyboard"
const STAGE = /^(Discover|Define|Develop|Deliver)\s*:/i;

// 2. the content types
const out = [];
const types = defs.types.map((t) => ({ ...t }));
const projectType = types.find((t) => t.id === "oer:project");
if (!types.some((t) => t.id === "oer:activity")) {
  types.splice(types.indexOf(projectType) + 1, 0, {
    id: "oer:activity",
    label: "Activity",
    icon: "icons:assignment-turned-in",
    description: "A step or deliverable in a project, done and assessed on its own.",
    children: [],
    nav: false,
    schemaType: "oer:Activity",
    fields: projectType.fields.filter((f) => f.name !== "publishEmbed").map((f) => ({ ...f })),
  });
}
projectType.children = [...new Set([...(projectType.children || []), "oer:activity", "oer:article", "oer:tutorial"])];
if (JSON.stringify(types) !== JSON.stringify(defs.types)) {
  out.push({ ...sys, metadata: { ...sys.metadata, oerContentTypes: { ...defs, types } }, modified: true });
}

// 3. the outline
const projectsSection = items.find((i) => !i.parent && i.title === "Projects" && i.metadata?.pageType === "oer:section");
const moved = new Set();
let headings = 0;
for (const p of projects) {
  const project = bySource.get(p.project);
  if (!project) {
    console.warn(`no page for ${p.project}`);
    continue;
  }
  const convert = project.metadata?.pageType !== "oer:project";
  if (convert || project.parent !== projectsSection.id) {
    // the capstone lesson: its brief is the project page
    const keep = new Set(projectType.fields.map((f) => f.name));
    const fields = Object.fromEntries(Object.entries(project.metadata?.oerFields || {}).filter(([k]) => keep.has(k)));
    out.push({ ...project, parent: projectsSection.id, indent: 1, metadata: { ...project.metadata, pageType: "oer:project", oerFields: fields }, modified: true });
    moved.add(project.id);
  }
  console.log(`\n${project.title}${convert ? " (lesson → project)" : ""}`);
  let order = 0;
  let stage = "";
  for (const part of p.parts) {
    const page = bySource.get(part.source);
    if (!page) {
      console.warn(`  no page for ${part.source}`);
      continue;
    }
    const nextStage = (part.title.match(STAGE) || [])[1];
    if (nextStage && nextStage.toLowerCase() !== stage.toLowerCase()) {
      stage = nextStage[0].toUpperCase() + nextStage.slice(1).toLowerCase();
      out.push({
        id: `new-heading-${project.id}-${order}`,
        title: stage,
        parent: project.id,
        order: order++,
        indent: 2,
        location: "",
        description: "",
        metadata: { pageType: "oer:heading", hideInMenu: true },
        contents: "",
        new: true,
      });
      headings++;
      console.log(`  ── ${stage}`);
    }
    const type = supportType(part.source, part.title) || "oer:activity";
    console.log(`  ${type === "oer:activity" ? "•" : "○"} ${page.title}  [${type.replace("oer:", "")}]`);
    out.push({ ...page, parent: project.id, order: order++, indent: 2, metadata: { ...page.metadata, pageType: type }, modified: true });
    moved.add(page.id);
  }
}

// what stays in Projects (and the capstone, moved in at the end), renumbered
const staying = items
  .filter((i) => i.parent === projectsSection.id && !moved.has(i.id))
  .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
const movedIn = out.filter((o) => o.parent === projectsSection.id && items.find((i) => i.id === o.id)?.parent !== projectsSection.id);
[...staying, ...movedIn].forEach((i, n) => {
  const existing = out.find((o) => o.id === i.id);
  if (existing) existing.order = n;
  else if (i.order !== n) out.push({ ...i, order: n, modified: true });
});

const pages = out.filter((i) => i.metadata?.pageType !== "oer:system" && !i.new).length;
console.log(`\n${moved.size} pages moved or retyped, ${headings} stage headings, ${pages} outline items changed${out[0]?.metadata?.pageType === "oer:system" ? ", Activity type added" : ""}${DRY ? " (dry run)" : ""}`);
if (DRY) process.exit(0);
const api = await connect();
const res = await api.call("PATCH", "/x/api/v1/site/outline", { headers: api.headers, body: { site: { name: "learning-materials" }, items: out } });
console.log(res.ok ? "saved" : `failed ${res.status}`);
