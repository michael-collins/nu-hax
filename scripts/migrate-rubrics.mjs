// Move the rubrics out of files/data/rubrics.json (from the Airtable era)
// into rubric pages (type Rubric, scripts/add-rubric-type.mjs) under a
// Rubrics index in the Assessments section, after Quizzes (made the first
// time). Each rubric keeps its slug as its key, so the Rubric blocks on
// exercise and project pages (<oer-rubric rubric-id="exercise">) and course
// sequence items (rubric: "exercise") find it unchanged. Its criteria share
// the grade evenly and it gets the standard levels (Exemplary 100%,
// Proficient 85%, Developing 70%, Beginning 50%, Missing 0%); adjust either
// in the rubric editor.
//   node --env-file=.env.local scripts/migrate-rubrics.mjs [--dry-run]
// Safe to run again: rubrics already moved (by key) are skipped.
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { connect } from "./lib/hax-api.mjs";
import { DEFAULT_LEVELS, evenWeights, RUBRIC_TYPE } from "../learning-materials/custom/src/rubrics/rubric-model.js";

const SITE_DIR = process.env.SITE_DIR || new URL("../learning-materials/", import.meta.url).pathname;
const SITE = process.env.HAX_SITE || "learning-materials";
const DRY = process.argv.includes("--dry-run");
const DATA = path.join(SITE_DIR, "files/data/rubrics.json");

const read = () => JSON.parse(readFileSync(path.join(SITE_DIR, "site.json"), "utf8")).items;
let items = read();
if (!existsSync(DATA)) {
  console.log("no files/data/rubrics.json: nothing to move");
  process.exit(0);
}
const data = JSON.parse(readFileSync(DATA, "utf8"));
const rubrics = Array.isArray(data) ? data : data.rubrics || [];
const have = new Set(items.filter((i) => i.metadata?.pageType === RUBRIC_TYPE).map((i) => i.metadata?.oerRubric?.key));

const out = [];
const create = [];

/* ---------- the Rubrics index, after Quizzes ---------- */
const top = items.filter((i) => !i.parent).sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
let section = top.find((i) => i.title === "Rubrics" && i.metadata?.pageType === "oer:section");
if (!section) {
  section = {
    id: "new-rubrics-section",
    title: "Rubrics",
    parent: null,
    order: 0,
    indent: 0,
    location: "",
    description: "",
    metadata: { pageType: "oer:section", published: true },
    contents:
      "<p>Scoring guides for exercises, projects and discussions. Each criterion's weight is its share of the grade, so a rubric fits work of any point value, and each level is worth a share of a criterion's points. Pages show a rubric with the Rubric block; course sequences grade with them in Canvas.</p>\n" +
      '<oer-collection types="oer:rubric" scope="site" view="table" sort="title" per-page="20" controls="full"></oer-collection>',
    new: true,
  };
  create.push(section);
  const at = top.findIndex((i) => i.title === "Quizzes") + 1;
  if (at <= 0) throw new Error("no Quizzes page to put Rubrics after");
  [...top.slice(0, at), section, ...top.slice(at)].forEach((i, n) => {
    if (i === section) section.order = n;
    else if (Number(i.order) !== n) out.push({ ...i, order: n, modified: true });
  });
}

/* ---------- a page per rubric ---------- */
const todo = rubrics.filter((r) => r.slug && !have.has(r.slug));
todo.forEach((r, n) => {
  const weights = evenWeights((r.criteria || []).length);
  create.push({
    id: `new-rubric-${r.slug}`,
    title: r.name || r.slug,
    parent: section.id,
    order: items.filter((i) => i.parent === section.id).length + n,
    indent: 1,
    location: "",
    description: "",
    metadata: {
      pageType: RUBRIC_TYPE,
      published: true,
      oerRubric: {
        version: 1,
        key: r.slug,
        levels: DEFAULT_LEVELS,
        criteria: (r.criteria || []).map((c, i) => ({ id: c.id || `criterion-${i + 1}`, name: c.name || "", description: c.description || "", weight: weights[i], descriptors: {} })),
      },
    },
    contents: "",
    new: true,
  });
});

console.log(
  `${todo.length ? `moving ${todo.map((r) => `${r.name} (${(r.criteria || []).length} criteria)`).join(", ")}` : "no rubrics left to move"}${section.new ? "; making the Rubrics index after Quizzes" : ""}${DRY ? " (dry run)" : ""}`,
);
if (DRY || (!todo.length && !section.new)) process.exit(0);

const api = await connect();
const res = await api.call("PATCH", "/x/api/v1/site/outline", { headers: api.headers, body: { site: { name: SITE }, items: [...out, ...create] } });
if (!res.ok) throw new Error(`outline save failed (${res.status}): ${JSON.stringify(res.json).slice(0, 300)}`);

// descriptions don't ride on outline saves
items = read();
const idx = items.find((i) => !i.parent && i.title === "Rubrics" && i.metadata?.pageType === "oer:section");
if (idx && !idx.description) await api.updateItem(idx.id, "setDescription", { description: "Scoring guides for exercises, projects and discussions: criteria, weights and rating levels." });
for (const r of todo) {
  const page = items.find((i) => i.metadata?.pageType === RUBRIC_TYPE && i.metadata?.oerRubric?.key === r.slug);
  if (page && !page.description && r.description) await api.updateItem(page.id, "setDescription", { description: r.description.trim() });
}
console.log(`saved: ${items.filter((i) => i.metadata?.pageType === RUBRIC_TYPE).map((i) => i.slug).join(", ")}`);
