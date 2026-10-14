// Learning outcomes (SILO phase 1, docs/silo-integration.md): one shared bank
// of outcome pages under Curriculum → Learning outcomes, each linked to the
// courses, pathways and programs it applies to; assessed work (exercises,
// reflections, projects, quizzes) gets a Learning outcomes field naming the
// outcomes it assesses; program pages list their outcomes.
//   node --env-file=.env.local scripts/outcomes.mjs [--dry-run]
// HAX_BASE and SITE_DIR point it at another copy (a scratch server). Safe to run again.
import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { connect } from "./lib/hax-api.mjs";
import { OUTCOME_TYPE, OUTCOME_DEF, OUTCOMES_FIELD, ASSESSED_TYPES } from "../learning-materials/custom/src/types/outcome.js";

const SITE_DIR = process.env.SITE_DIR || new URL("../learning-materials/", import.meta.url).pathname;
const SITE = process.env.HAX_SITE || "learning-materials";
const DRY = process.argv.includes("--dry-run");
const SECTION_TITLE = "Learning outcomes";
const SECTION_TEXT =
  '<p>What students can do after a course, pathway or program. Each outcome links to the courses, pathways and programs it applies to, and lists the work that assesses it.</p>\n<oer-collection types="oer:outcome" scope="site" view="table" sort="code" per-page="50" controls="full"></oer-collection>';
const SECTION_DESCRIPTION = "The outcomes courses, pathways and programs promise, and the work that assesses them.";
// on program pages, after their Courses
const PROGRAM_OUTCOMES = '\n<h2>Learning outcomes</h2>\n<oer-collection types="oer:outcome" scope="linked" view="table" sort="code" controls="none"></oer-collection>';

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

// 1. the type, and the Learning outcomes field on assessed work
const items = read();
const out = [];
const sys = items.find((i) => i.metadata?.pageType === "oer:system");
const raw = sys.metadata.oerContentTypes;
const types = typeof raw === "string" ? JSON.parse(raw) : structuredClone(raw);
const before = JSON.stringify(types);
if (!types.types.some((t) => t.id === OUTCOME_TYPE)) {
  const at = types.types.findIndex((t) => t.id === "oer:program");
  types.types.splice(at >= 0 ? at + 1 : types.types.length, 0, OUTCOME_DEF);
  console.log("content types: Learning outcome");
}
for (const id of ASSESSED_TYPES) {
  const type = types.types.find((t) => t.id === id);
  if (!type || type.fields?.some((f) => f.name === OUTCOMES_FIELD.name)) continue;
  type.fields ||= [];
  // beside Courses, where it's looked for
  const at = type.fields.findIndex((f) => f.name === "courses");
  type.fields.splice(at >= 0 ? at + 1 : type.fields.length, 0, { ...OUTCOMES_FIELD });
  console.log(`${type.label}: Learning outcomes field`);
}
// new program pages start with the list too (PROGRAM_DEF in custom/src/types/program.js)
const program = types.types.find((t) => t.id === "oer:program");
if (program?.template && !program.template.includes('types="oer:outcome"')) {
  program.template += PROGRAM_OUTCOMES;
  console.log("Program: template lists outcomes");
}
if (JSON.stringify(types) !== before) out.push({ ...sys, metadata: { ...sys.metadata, oerContentTypes: typeof raw === "string" ? JSON.stringify(types) : types }, modified: true });

// 2. the Learning outcomes section, after Programs under Curriculum
const top = items.filter((i) => !i.parent && live(i));
let sectionId = top.find((i) => i.title === SECTION_TITLE)?.id || "";
if (!sectionId) {
  const programs = top.find((i) => i.title === "Programs");
  if (!programs) throw new Error("No Programs section to put Learning outcomes after; run scripts/programs.mjs first.");
  const order = (Number(programs.order) || 0) + 1;
  // make room: pages at or after that place move down one
  for (const i of top) if ((Number(i.order) || 0) >= order) out.push({ ...i, order: (Number(i.order) || 0) + 1, modified: true });
  sectionId = `item-${randomUUID()}`;
  out.push({
    id: sectionId, title: SECTION_TITLE, parent: null, indent: 0, order, slug: "learning-outcomes", location: "", description: "",
    metadata: { pageType: "oer:section", published: true, overridePathauto: true },
    contents: SECTION_TEXT, new: true,
  });
  console.log(`navigation: ${SECTION_TITLE} section`);
}

// 3. program pages list their outcomes
for (const p of items.filter((i) => i.metadata?.pageType === "oer:program" && live(i))) {
  const html = readFileSync(path.join(SITE_DIR, p.location), "utf8");
  if (html.includes('types="oer:outcome"')) continue;
  out.push({ ...p, contents: html.trimEnd() + PROGRAM_OUTCOMES, metadata: { ...p.metadata, overridePathauto: true }, modified: true });
  console.log(`${p.title}: Learning outcomes list`);
}
await save(out, "types, section and program pages");

// 4. the section's description (outline saves drop it on new pages)
if (!DRY) {
  const section = read().find((i) => !i.parent && i.title === SECTION_TITLE);
  if (section && !section.description) {
    api ||= await connect();
    await api.updateItem(section.id, "setDescription", { description: SECTION_DESCRIPTION });
    console.log(`${SECTION_TITLE}: description`);
  }
}
console.log("done");
