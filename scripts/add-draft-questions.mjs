// Add suggested self-check questions to lessons and pathways, as drafts:
//   node scripts/add-draft-questions.mjs [--dry-run]
//
// Questions come from scripts/data/draft-questions.json (written from each
// page's learning objectives). Each page gets one <oer-draft> at the end of
// its content, which only signed-in authors see until they publish it:
// - lessons: "Check your understanding" with a multiple-choice, a
//   true/false and a self-check question
// - pathways: "Check your readiness" with self-check questions
// The page files are written directly (HAXcms reads them from disk); commit
// the site afterwards. Pages that already have a draft from this script
// (data-source="objectives") are left alone, so it is safe to run again.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

const SITE_DIR = new URL("../learning-materials/", import.meta.url).pathname;
const DATA = JSON.parse(readFileSync(new URL("./data/draft-questions.json", import.meta.url), "utf8"));
const DRY = process.argv.includes("--dry-run");
const MARK = 'data-source="objectives"';

const site = JSON.parse(readFileSync(path.join(SITE_DIR, "site.json"), "utf8"));
const live = (type) => site.items.filter((i) => i.metadata?.pageType === type && !i.metadata?.oerSnapshotOf && !i.metadata?.oerRef);

const attr = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const text = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const answers = (correct, wrong) => [`<input type="checkbox" value="${attr(correct)}" correct data-correct="true">`, ...wrong.map((w) => `<input type="checkbox" value="${attr(w)}">`)].join("\n    ");

function lessonDraft(q) {
  const [mcQ, mcA, mcWrong] = q.mc;
  const [tfQ, tfTrue] = q.tf;
  const [scQ, scA] = q.sc;
  return `
<oer-draft note="Suggested questions from the learning objectives" ${MARK}>
  <h2>Check your understanding</h2>
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
</oer-draft>
`;
}

function pathwayDraft(list) {
  return `
<oer-draft note="Suggested questions from the pathway's objectives" ${MARK}>
  <h2>Check your readiness</h2>
${list
  .map(
    ([q, a]) => `  <self-check title="Are you ready?">
    <p slot="question">${text(q)}</p>
    <p>${text(a)}</p>
  </self-check>`,
  )
  .join("\n")}
</oer-draft>
`;
}

const plan = [];
for (const [title, q] of Object.entries(DATA.lessons)) {
  const item = live("oer:lesson").find((i) => i.title === title);
  if (item) plan.push([item, lessonDraft(q)]);
  else console.warn(`lesson not found: ${title}`);
}
for (const [title, list] of Object.entries(DATA.pathways)) {
  const item = live("oer:pathway").find((i) => i.title === title);
  if (item) plan.push([item, pathwayDraft(list)]);
  else console.warn(`pathway not found: ${title}`);
}

let written = 0;
for (const [item, draft] of plan) {
  const file = path.join(SITE_DIR, item.location);
  if (!existsSync(file)) {
    console.warn(`no content file for ${item.title}`);
    continue;
  }
  const html = readFileSync(file, "utf8");
  if (html.includes(MARK)) continue;
  if (!DRY) writeFileSync(file, html.replace(/\s*$/, "\n") + draft);
  written++;
  console.log(`${DRY ? "would add" : "added"}: ${item.title}`);
}
console.log(`${written} pages${DRY ? " (dry run)" : ""}`);
