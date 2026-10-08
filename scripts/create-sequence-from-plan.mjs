// Create a course sequence page (oer:sequence) from a seeded offering plan
// (scripts/offering-from-plan.mjs), under a Sequences index page in the
// Curriculum section (made the first time, after Courses):
//   node scripts/offering-from-plan.mjs /tmp/dart413.json
//   node --env-file=.env.local scripts/create-sequence-from-plan.mjs /tmp/dart413.json
//     [--title "DART 413: 15-week studio"] [--update] [--dry-run]
// The sequence keeps the plan's modules, items and grade groups (items'
// rubrics name the site's rubric pages by key); the course, length and delivery go in its fields. Term dates are
// chosen when it's exported. It starts unpublished. With --update, an
// existing sequence for the same course and length gets the plan's
// structure again (its title, fields and page text stay).
import { readFileSync } from "node:fs";
import path from "node:path";
import { connect } from "./lib/hax-api.mjs";

const SITE_DIR = process.env.SITE_DIR || new URL("../learning-materials/", import.meta.url).pathname;
const SITE = process.env.HAX_SITE || "learning-materials";
const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : "");
const planFile = args.find((a, i) => !a.startsWith("--") && !["--title"].includes(args[i - 1]));
const DRY = args.includes("--dry-run");
const UPDATE = args.includes("--update");
if (!planFile) {
  console.error("usage: node scripts/create-sequence-from-plan.mjs <offering.json> [--title t] [--update] [--dry-run]");
  process.exit(1);
}

const read = () => JSON.parse(readFileSync(path.join(SITE_DIR, "site.json"), "utf8")).items;
let items = read();
const plan = JSON.parse(readFileSync(planFile, "utf8"));
const DELIVERY = { "in-person": "In person", hybrid: "Hybrid", "online-sync": "Online (synchronous)", "online-async": "Online (asynchronous)" };
const key = `${plan.code}:sequence:${plan.weeks}`;
const title = opt("--title") || `${plan.code}: ${plan.weeks}-week ${plan.delivery === "online-async" ? "online" : "studio"}`;
const sequence = { version: 1, modules: plan.modules, groups: plan.groups };
const out = [];
const create = [];

/* ---------- the Sequences index, after Courses ---------- */
const top = items.filter((i) => !i.parent).sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
let section = top.find((i) => i.title === "Sequences");
if (!section) {
  section = {
    id: "new-sequences-section",
    title: "Sequences",
    parent: null,
    order: 0,
    indent: 0,
    location: "",
    description: "",
    metadata: { pageType: "oer:section", published: true },
    contents:
      '<p>Plans for running a course, week by week: what students read, do and hand in, when it\'s due and how it\'s graded. Open one to see its schedule, or export it to Canvas with your term\'s dates.</p>\n<oer-collection types="oer:sequence" scope="site" view="table" sort="title" per-page="20" controls="full"></oer-collection>',
    new: true,
  };
  create.push(section);
  const at = top.findIndex((i) => i.title === "Courses") + 1;
  [...top.slice(0, at), section, ...top.slice(at)].forEach((i, n) => {
    if (i === section) section.order = n;
    else if (Number(i.order) !== n) out.push({ ...i, order: n, modified: true });
  });
}

/* ---------- the sequence ---------- */
const existing = items.find((i) => i.metadata?.pageType === "oer:sequence" && i.metadata?.oerPlan === key && !i.metadata?.oerSnapshotOf);
if (existing && !UPDATE) {
  console.log(`"${existing.title}" already exists (use --update to give it the plan's structure again)`);
  process.exit(0);
}
if (existing) {
  out.push({ ...existing, metadata: { ...existing.metadata, oerSequence: sequence }, modified: true });
} else {
  const siblings = items.filter((i) => i.parent === section.id);
  create.push({
    id: "new-sequence",
    title,
    parent: section.id,
    order: siblings.length,
    indent: 1,
    location: "",
    description: "",
    metadata: {
      pageType: "oer:sequence",
      published: false,
      oerPlan: key,
      oerFields: {
        courses: plan.course ? [{ page: plan.course, version: "" }] : [],
        weeks: plan.weeks,
        delivery: DELIVERY[plan.delivery] || "In person",
        license: "CC BY 4.0",
      },
      oerSequence: sequence,
    },
    contents: `<p>The ${plan.weeks}-week ${(DELIVERY[plan.delivery] || "in person").toLowerCase()} run of ${plan.title}, week by week. Export it to Canvas to set up a course for your term: you choose the dates, breaks and when assignments are due.</p>`,
    new: true,
  });
}
const count = (as) => plan.modules.reduce((n, m) => n + m.items.filter((i) => i.as === as).length, 0);
console.log(`${existing ? "updating" : "creating"} "${existing?.title || title}": ${plan.modules.length} modules, ${count("assignment")} assignments, ${count("quiz")} quizzes, ${count("page")} pages, ${count("link")} links; groups ${plan.groups.map((g) => `${g.name} ${g.weight}%`).join(", ")}${section.new ? " (and the Sequences index)" : ""}${DRY ? " (dry run)" : ""}`);
if (DRY) process.exit(0);

const api = await connect();
const res = await api.call("PATCH", "/x/api/v1/site/outline", { headers: api.headers, body: { site: { name: SITE }, items: [...out, ...create] } });
if (!res.ok) throw new Error(`outline save failed (${res.status}): ${JSON.stringify(res.json).slice(0, 300)}`);
items = read();
const page = items.find((i) => i.metadata?.pageType === "oer:sequence" && i.metadata?.oerPlan === key && !i.metadata?.oerSnapshotOf);
if (page && !page.description) await api.updateItem(page.id, "setDescription", { description: `${plan.weeks} weeks, ${(DELIVERY[plan.delivery] || "in person").toLowerCase()}: the schedule, assignments and grading for ${plan.code}.` });
const idx = items.find((i) => !i.parent && i.title === "Sequences");
if (idx && !idx.description) await api.updateItem(idx.id, "setDescription", { description: "Week-by-week plans for running a course, ready to export to Canvas." });
console.log(`saved: ${page?.slug || "?"}`);
