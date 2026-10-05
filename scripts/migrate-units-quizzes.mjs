// Restructure a pathway around OER Schema's Course → Unit → Lesson model:
//   node --env-file=.env.local scripts/migrate-units-quizzes.mjs "CGI Foundations" [--dry-run]
//
// Content types (once):
// - Unit (oer:unit, oer:Unit): a part of a pathway, holding lessons and an
//   optional unit project
// - Quiz (oer:quiz, oer:Quiz): a page of self-check questions; its "Before
//   you start" links are the materials it covers
// - Lesson gets "In this lesson" (components, oer:hasComponent): the
//   readings, lectures, tutorials, exercises and quiz that make it up
// - schema classes: Lesson oer:Lesson, Project oer:Project
// - a "Quizzes" section under the Assessments heading
//
// For the pathway:
// - its modules (sections) become units; a module holding only projects is
//   the final unit
// - each linked lesson's library page gets, as components, the lectures,
//   tutorials, articles and exercises linked next to it in its module (in a
//   module with several lessons, materials go to the lesson they follow, or
//   to the first lesson), and those links leave the unit
// - each lesson gets a quiz (unpublished, for review) from the drafted
//   questions in scripts/data/draft-questions.json, replacing the oer-draft
//   block on the lesson page; the quiz is the lesson's last component
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { connect } from "./lib/hax-api.mjs";

const SITE_DIR = new URL("../learning-materials/", import.meta.url).pathname;
const SITE = process.env.HAX_SITE || "learning-materials";
const DRY = process.argv.includes("--dry-run");
const PATHWAY = process.argv.slice(2).find((a) => !a.startsWith("--")) || "CGI Foundations";
const DATA = JSON.parse(readFileSync(new URL("./data/draft-questions.json", import.meta.url), "utf8"));
const QUESTIONS = DATA.lessons;
const READINESS = DATA.pathways;

const read = () => JSON.parse(readFileSync(path.join(SITE_DIR, "site.json"), "utf8")).items;
let items = read();
const byId = new Map(items.map((i) => [i.id, i]));
const kids = (id) => items.filter((i) => i.parent === id && !i.metadata?.oerSnapshotOf).sort((a, b) => (a.order || 0) - (b.order || 0));
const sys = items.find((i) => i.metadata?.pageType === "oer:system");
const defs = sys.metadata.oerContentTypes;
const typeOf = (id) => defs.types.find((t) => t.id === id);

const MATERIAL_TYPES = ["oer:article", "oer:lecture", "oer:tutorial", "oer:exercise"];
const COMPONENT_TYPES = [...MATERIAL_TYPES, "oer:quiz", "oer:project"];

/* ---------- content types ---------- */

const lesson = typeOf("oer:lesson");
const prereq = lesson.fields.find((f) => f.name === "prerequisites");
const license = lesson.fields.find((f) => f.name === "license");
const types = defs.types.map((t) => {
  if (t.id === "oer:lesson") {
    const fields = t.fields.some((f) => f.name === "components")
      ? t.fields
      : t.fields.flatMap((f) =>
          f.name === "learningObjectives"
            ? [f, { name: "components", label: "In this lesson", kind: "relation", header: true, help: "The readings, lectures, tutorials, exercises and quiz that make up the lesson, in order.", types: COMPONENT_TYPES }]
            : [f],
        );
    return { ...t, schemaType: "oer:Lesson", fields, children: [...new Set([...(t.children || []), "oer:quiz"])] };
  }
  if (t.id === "oer:project") return { ...t, schemaType: "oer:Project" };
  if (t.id === "oer:pathway") {
    const fields = t.fields.some((f) => f.name === "readinessQuiz")
      ? t.fields
      : [...t.fields, { name: "readinessQuiz", label: "Readiness quiz", kind: "relation", types: ["oer:quiz"], help: "Self-check questions to take before starting the pathway." }];
    return { ...t, fields, children: [...new Set(["oer:unit", ...(t.children || [])])] };
  }
  return t;
});
if (!types.some((t) => t.id === "oer:unit")) {
  types.push({
    id: "oer:unit",
    label: "Unit",
    icon: "icons:view-module",
    description: "A part of a pathway: its lessons and an optional unit project.",
    schemaType: "oer:Unit",
    nav: false,
    children: ["oer:lesson", "oer:project", "oer:exercise", "oer:quiz"],
    fields: [
      { name: "learningObjectives", label: "Learning objectives", kind: "list" },
      { name: "estimatedDuration", label: "Estimated duration", kind: "text", header: true },
    ],
  });
}
if (!types.some((t) => t.id === "oer:quiz")) {
  types.push({
    id: "oer:quiz",
    label: "Quiz",
    icon: "lrn:quiz",
    description: "Self-check questions on a lesson's materials.",
    schemaType: "oer:Quiz",
    nav: false,
    children: [],
    fields: [
      { ...prereq, help: "The materials this quiz covers." },
      { name: "estimatedDuration", label: "Estimated duration", kind: "text", header: true },
      { name: "authors", label: "Authors", kind: "people" },
      ...(license ? [license] : []),
      { name: "placeholder", label: "In development", kind: "boolean" },
    ],
  });
}
const out = new Map(items.map((i) => [i.id, i]));
const change = (id, fn) => out.set(id, { ...fn(out.get(id)), modified: true });
change(sys.id, (i) => ({ ...i, metadata: { ...i.metadata, oerContentTypes: { ...defs, types } } }));

/* ---------- Quizzes section ---------- */

let quizzes = items.find((i) => !i.parent && i.title === "Quizzes" && i.metadata?.pageType === "oer:section");
const added = [];
if (!quizzes) {
  const top = items.filter((i) => !i.parent);
  quizzes = { id: "new-quizzes-section", title: "Quizzes", parent: null, order: Math.max(...top.map((i) => i.order || 0)) + 1, indent: 0, location: "", description: "Self-check quizzes for each lesson.", metadata: { pageType: "oer:section", icon: "lrn:quiz", oerTmpKey: "quizzes" }, contents: '<oer-collection types="oer:quiz"></oer-collection>', new: true };
  added.push(quizzes);
}

/* ---------- the pathway ---------- */

const pathway = items.find((i) => i.title === PATHWAY && i.metadata?.pageType === "oer:pathway" && !i.metadata?.oerSnapshotOf);
if (!pathway) throw new Error(`pathway not found: ${PATHWAY}`);
const src = (link) => byId.get(link.metadata?.oerRef?.page) || link;
const attr = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const text = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const answers = (correct, wrong) => [`<input type="checkbox" value="${attr(correct)}" correct data-correct="true">`, ...wrong.map((w) => `<input type="checkbox" value="${attr(w)}">`)].join("\n  ");

function quizHtml(q) {
  const [mcQ, mcA, mcWrong] = q.mc;
  const [tfQ, tfTrue] = q.tf;
  const [scQ, scA] = q.sc;
  return `<p>Check your understanding of this lesson. Your answers aren't recorded.</p>
<multiple-choice question="${attr(mcQ)}" single-option randomize>
  ${answers(mcA, mcWrong)}
</multiple-choice>
<true-false-question question="${attr(tfQ)}">
  ${tfTrue ? answers("True", ["False"]) : answers("False", ["True"])}
</true-false-question>
<self-check title="Think it through">
  <p slot="question">${text(scQ)}</p>
  <p>${text(scA)}</p>
</self-check>
`;
}

const files = [];
const report = [];
const lessonComponents = new Map(); // library lesson id -> [ids]
let quizOrder = 0;
for (const mod of kids(pathway.id)) {
  if (mod.metadata?.pageType !== "oer:section" && mod.metadata?.pageType !== "oer:unit") continue;
  const children = kids(mod.id);
  const onlyProjects = children.length && children.every((c) => src(c).metadata?.pageType === "oer:project");
  change(mod.id, (i) => ({ ...i, title: onlyProjects && i.title === "Project" ? "Final project" : i.title, metadata: { ...i.metadata, pageType: "oer:unit" } }));
  // the unit page lists its lessons (oer-unit)
  const unitFile = path.join(SITE_DIR, mod.location || "");
  if (mod.location && existsSync(unitFile)) {
    const html = readFileSync(unitFile, "utf8");
    if (!html.includes("<oer-unit")) files.push([unitFile, (html.trim() && html.trim() !== "<p></p>" ? `${html.trim()}\n` : "") + "<oer-unit></oer-unit>\n"]);
  }
  const lessons = children.filter((c) => src(c).metadata?.pageType === "oer:lesson");
  let current = lessons[0] ? src(lessons[0]) : null;
  for (const c of children) {
    const s = src(c);
    const t = s.metadata?.pageType;
    if (t === "oer:lesson") {
      current = s;
      if (!lessonComponents.has(s.id)) lessonComponents.set(s.id, [...(s.metadata?.oerFields?.components || []).map((x) => x.page)]);
      continue;
    }
    if (MATERIAL_TYPES.includes(t) && current && c.metadata?.oerRef?.page) {
      // after all of a module's several lessons: lectures and readings
      // introduce the first lesson, exercises practise the last
      let owner = current;
      const afterAll = lessons.length > 1 && children.indexOf(c) > children.indexOf(lessons.at(-1));
      if (afterAll) owner = t === "oer:exercise" ? src(lessons.at(-1)) : src(lessons[0]);
      if (!lessonComponents.has(owner.id)) lessonComponents.set(owner.id, []);
      const list = lessonComponents.get(owner.id);
      if (!list.includes(s.id)) list.push(s.id);
      out.set(c.id, { ...out.get(c.id), delete: true }); // the link leaves the unit
      report.push(`${mod.title}: ${s.title} → ${owner.title}`);
    }
  }
}

// quizzes and lesson components
for (const [lessonId, comps] of lessonComponents) {
  const l = byId.get(lessonId);
  const q = QUESTIONS[l.title];
  const hasQuiz = items.some((i) => i.metadata?.pageType === "oer:quiz" && (i.metadata?.oerFields?.prerequisites || []).some((p) => p.page === lessonId));
  if (q && !hasQuiz) {
    const f = l.metadata?.oerFields || {};
    added.push({
      id: `new-quiz-${lessonId}`,
      title: `${l.title} quiz`,
      parent: quizzes.id,
      order: quizOrder++,
      indent: 1,
      location: "",
      description: `Self-check questions on ${l.title}.`,
      metadata: {
        pageType: "oer:quiz",
        icon: "lrn:quiz",
        published: false,
        oerTmpKey: `quiz:${lessonId}`,
        oerFields: {
          prerequisites: [{ page: lessonId, version: "" }, ...comps.map((id) => ({ page: id, version: "" }))],
          estimatedDuration: "10 minutes",
          ...(f.authors ? { authors: f.authors } : {}),
          ...(f.license ? { license: f.license } : {}),
        },
      },
      contents: quizHtml(q),
      new: true,
    });
  }
  change(lessonId, (i) => ({ ...i, metadata: { ...i.metadata, oerFields: { ...(i.metadata?.oerFields || {}), components: comps.map((id) => ({ page: id, version: "" })) } } }));
}

// the drafted questions move to the quizzes: drop the lesson pages' drafts
for (const lessonId of lessonComponents.keys()) {
  const l = byId.get(lessonId);
  const file = path.join(SITE_DIR, l.location || "");
  if (!l.location || !existsSync(file)) continue;
  const html = readFileSync(file, "utf8");
  const next = html.replace(/\n?<oer-draft\b[^>]*data-source="objectives"[^>]*>[\s\S]*?<\/oer-draft>\n?/g, "\n");
  if (next !== html) files.push([file, next]);
}

// the pathway's readiness questions become its readiness quiz
const readiness = READINESS[PATHWAY];
const hasReadiness = (pathway.metadata?.oerFields?.readinessQuiz || []).length > 0;
if (readiness && !hasReadiness) {
  added.push({
    id: `new-readiness-${pathway.id}`,
    title: `${PATHWAY} readiness quiz`,
    parent: quizzes.id,
    order: quizOrder++,
    indent: 1,
    location: "",
    description: `Check you're ready to start ${PATHWAY}.`,
    metadata: {
      pageType: "oer:quiz",
      icon: "lrn:quiz",
      published: false,
      oerTmpKey: `readiness:${pathway.id}`,
      oerFields: { estimatedDuration: "10 minutes", ...(pathway.metadata?.oerFields?.authors ? { authors: pathway.metadata.oerFields.authors } : {}) },
    },
    contents: `<p>Before you start ${text(PATHWAY)}: can you answer these? Your answers aren't recorded.</p>\n${readiness
      .map(([q, a]) => `<self-check title="Are you ready?">\n  <p slot="question">${text(q)}</p>\n  <p>${text(a)}</p>\n</self-check>`)
      .join("\n")}\n`,
    new: true,
  });
}
{
  const file = path.join(SITE_DIR, pathway.location || "");
  if (pathway.location && existsSync(file)) {
    const html = readFileSync(file, "utf8");
    const next = html.replace(/\n?<oer-draft\b[^>]*data-source="objectives"[^>]*>[\s\S]*?<\/oer-draft>\n?/g, "\n");
    if (next !== html) files.push([file, next]);
  }
}

console.log(`${PATHWAY}: ${kids(pathway.id).length} units; ${lessonComponents.size} lessons; ${added.filter((a) => a.metadata.pageType === "oer:quiz").length} quizzes; ${files.length} lesson drafts removed`);
for (const r of report) console.log(`  ${r}`);
if (DRY) {
  console.log("dry run: nothing written");
  process.exit(0);
}

for (const [file, next] of files) writeFileSync(file, next);
const api = await connect();
const save = async (list) => {
  const res = await api.call("PATCH", "/x/api/v1/site/outline", { headers: api.headers, body: { site: { name: SITE }, items: list } });
  if (!res.ok) throw new Error(`outline save failed (${res.status}): ${JSON.stringify(res.json).slice(0, 300)}`);
};
await save([...out.values(), ...added]);
console.log("pass 1 saved");

// pass 2: the quizzes' real ids into their lessons' components
items = read();
const quizByLesson = new Map(items.filter((i) => String(i.metadata?.oerTmpKey || "").startsWith("quiz:")).map((i) => [i.metadata.oerTmpKey.slice(5), i]));
const readinessFor = new Map(items.filter((i) => String(i.metadata?.oerTmpKey || "").startsWith("readiness:")).map((i) => [i.metadata.oerTmpKey.slice(10), i]));
const second = items.map((i) => {
  if (String(i.metadata?.oerTmpKey || "")) return { ...i, metadata: { ...i.metadata, oerTmpKey: "" }, modified: true };
  const rq = readinessFor.get(i.id);
  if (rq) return { ...i, metadata: { ...i.metadata, oerFields: { ...(i.metadata?.oerFields || {}), readinessQuiz: [{ page: rq.id, version: "" }] } }, modified: true };
  const quiz = quizByLesson.get(i.id);
  if (!quiz) return i;
  const comps = (i.metadata?.oerFields?.components || []).filter((c) => c.page !== quiz.id);
  return { ...i, metadata: { ...i.metadata, oerFields: { ...i.metadata.oerFields, components: [...comps, { page: quiz.id, version: "" }] } }, modified: true };
});
await save(second);
console.log(`pass 2 saved: ${quizByLesson.size} quizzes linked from their lessons${readinessFor.size ? ", readiness quiz linked from the pathway" : ""}`);
