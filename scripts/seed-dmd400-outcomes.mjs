// DMD 400's five course learning outcomes (from the user's draft "DMD 400:
// Measurable Learning Objectives", 2026-10-14) as pages in the Learning
// outcomes bank, linked to the course, each with its "Measured by" list, and
// the capstone's graded pages naming the outcomes they assess (pairings the
// user approved). Needs scripts/outcomes.mjs first.
//   node --env-file=.env.local scripts/seed-dmd400-outcomes.mjs [--dry-run]
// HAX_BASE and SITE_DIR point it at another copy (a scratch server). Safe to run again.
import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { connect } from "./lib/hax-api.mjs";
import { OUTCOME_TYPE, OUTCOME_DEF } from "../learning-materials/custom/src/types/outcome.js";

const SITE_DIR = process.env.SITE_DIR || new URL("../learning-materials/", import.meta.url).pathname;
const SITE = process.env.HAX_SITE || "learning-materials";
const DRY = process.argv.includes("--dry-run");
const COURSE_CODE = "DMD 400";
const CP = "projects/capstone-project/";
const OUTCOMES = [
  {
    code: "DMD 400 CLO.1",
    level: "Create",
    title: "Ship an integrated capstone product",
    lead: "Students will plan, build, and deliver a media art and design project that integrates a variety of methods relevant to their project in consultation with the instructor or project advisor. This project is included in a final group exhibition of work.",
    measured: [
      "Submission of all capstone deliverables on the schedule in Canvas: Proposal, Agreement Form, Proof of Ability, ongoing Production Reports, Discussion posts, Mid-production Video, Exhibition Statement, Project Document, Explainer Video, and Exhibition participation.",
      "Project incorporates reviewer feedback at midterm and final checkpoints.",
    ],
    work: ["projects/capstone-project", `${CP}capstone-project-exhibition`, "projects/mid-capstone-project-assessment", "projects/notes-from-midterm-feedback"],
  },
  {
    code: "DMD 400 CLO.2",
    level: "Apply",
    title: "Apply a repeatable design process with appropriate tools",
    lead: "Students will document and execute a process that includes requirements, ideation, prototyping, and evaluation using relevant digital processes, tools, and techniques.",
    measured: [
      "A Proposal that defines scope, production pipeline, capabilities, and a week-by-week timeline.",
      "Documented advisor/mentor check-ins across the duration of the semester.",
      "Production Reports showing progress against the timeline.",
      "A Mid-production Video summarizing progress and remaining production tasks.",
      "A Project Document whose Production section clearly explains the methods and tools used.",
    ],
    work: [`${CP}capstone-project-proposal`, "projects/zoom-meeting-1-proposal", `${CP}capstone-project-production-reports`, `${CP}project-midterm-video`, `${CP}capstone-project-document`],
  },
  {
    code: "DMD 400 CLO.3",
    level: "Analyze",
    title: "Use research to drive concept and decisions",
    lead: "Students will conduct and synthesize research to inform the project, including primary and secondary research methods.",
    measured: [
      "A Project Document with a formal Research section and bibliography that situates the work, cites credible sources, and traces design requirements/decisions back to findings.",
      "Evidence of research activity and insight application in Production Reports.",
      "Alignment with course guidance on when to use primary vs. secondary research and on using scholarly sources for sensitive topics.",
    ],
    work: [`${CP}capstone-project-proposal`, `${CP}capstone-project-document`, `${CP}capstone-project-production-reports`],
  },
  {
    code: "DMD 400 CLO.4",
    level: "Evaluate",
    title: "Communicate work clearly in written, visual, and/or oral forms",
    lead: "Students will explain and defend decisions to technical and non-technical audiences.",
    measured: [
      "An Exhibition Statement.",
      "A Mid-production Video and an Explainer Video that present concept, process, and outcomes for a general audience.",
      "A well-structured Project Document that follows required sections and formatting.",
    ],
    work: [`${CP}capstone-project-exhibition-statement`, `${CP}project-midterm-video`, `${CP}project-explainer-video`, `${CP}capstone-project-document`],
  },
  {
    code: "DMD 400 CLO.5",
    level: "Create",
    title: "Iterate in response to critique to improve outcomes",
    lead: "Students will produce multiple revisions that respond to feedback and show measurable improvement.",
    measured: [
      "Documentation of changes across Production Reports.",
      "At least three advisor/mentor meetings across the term.",
      "Peer feedback given and received in Production Report Discussions.",
      "Explicit incorporation of faculty/external reviewer feedback noted at midterm and visible in the final document, videos, and exhibition materials.",
    ],
    work: [`${CP}capstone-project-production-reports`, `${CP}capstone-project-production-report-discussions`, "projects/notes-from-midterm-feedback", "projects/zoom-meeting-1-proposal"],
  },
];

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const slugOf = (code) => `learning-outcomes/${code.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
const body = (o) =>
  OUTCOME_DEF.template.replace(
    "<p></p>",
    `<p>${esc(o.lead)}</p>\n<h2>Measured by</h2>\n<ul>\n${o.measured.map((m) => `<li>${esc(m)}</li>`).join("\n")}\n</ul>`,
  );
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

// check everything resolves before saving anything
let items = read();
const section = items.find((i) => !i.parent && i.title === "Learning outcomes" && live(i));
if (!section) throw new Error("No Learning outcomes section; run scripts/outcomes.mjs first.");
const course = items.find((i) => i.metadata?.pageType === "oer:course" && live(i) && i.metadata?.oerFields?.code === COURSE_CODE);
if (!course) throw new Error(`No course page with code ${COURSE_CODE}`);
const bySlug = (slug) => items.find((i) => i.slug === slug && live(i));
const missing = OUTCOMES.flatMap((o) => o.work).filter((s) => !bySlug(s));
if (missing.length) throw new Error(`Pages not found: ${[...new Set(missing)].join(", ")}`);

// 1. the outcome pages (HAX gives new pages their ids as it saves them)
const existing = (o) => items.find((i) => i.metadata?.pageType === OUTCOME_TYPE && live(i) && i.metadata?.oerFields?.code === o.code);
const start = Math.max(-1, ...items.filter((i) => i.parent === section.id).map((i) => Number(i.order) || 0)) + 1;
const fresh = OUTCOMES.filter((o) => !existing(o)).map((o, n) => {
  console.log(`outcome: ${o.code} ${o.title}`);
  return {
    id: `item-${randomUUID()}`, title: o.title, parent: section.id, indent: 1, order: start + n, slug: slugOf(o.code), location: "", description: "",
    metadata: {
      pageType: OUTCOME_TYPE, published: true, overridePathauto: true,
      oerFields: { code: o.code, level: o.level, courses: [{ page: course.id, version: "" }], pathways: [], programs: [], partOf: [] },
    },
    contents: body(o), new: true,
  };
});
await save(fresh, "outcome pages");

// 2. the work that assesses them names them (added to what it names already)
items = DRY ? items : read();
const idOf = new Map(OUTCOMES.map((o) => [o.code, existing(o)?.id || (DRY ? `(new ${o.code})` : null)]));
const wanted = new Map();
for (const o of OUTCOMES) for (const s of o.work) wanted.set(s, [...(wanted.get(s) || []), o.code]);
const linked = [];
for (const [slug, codes] of wanted) {
  const page = bySlug(slug);
  const have = Array.isArray(page.metadata?.oerFields?.outcomes) ? page.metadata.oerFields.outcomes : [];
  const add = codes.map((c) => idOf.get(c)).filter((id) => id && !have.some((v) => v?.page === id));
  if (!add.length) continue;
  console.log(`${page.title}: ${codes.join(", ")}`);
  linked.push({
    ...page,
    contents: readFileSync(path.join(SITE_DIR, page.location), "utf8"),
    metadata: { ...page.metadata, overridePathauto: true, oerFields: { ...page.metadata.oerFields, outcomes: [...have, ...add.map((id) => ({ page: id, version: "" }))] } },
    modified: true,
  });
}
await save(linked, "assessed pages");
console.log("done");
