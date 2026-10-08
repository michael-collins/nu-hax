// Seed a course offering plan (the schedule and grading for one run of a
// course, which the Canvas exporter turns into a course) from the site and
// a course planning project (digi-fab-course's `pm` data):
//   node scripts/offering-from-plan.mjs <out.json> [--plan-dir ../digi-fab-course]
//     [--modules M01,M02,M12] [--site-url https://example.org/site/]
//
// Weeks become modules, in order. Each week's lesson page leads its module,
// then its components (lectures, tutorials, articles as embedded pages;
// exercises and projects as assignments; quizzes as practice quizzes), then
// its readings as links. Assignments sit in the module of their first week
// and fall due in their plan week. The delivery mode (from the course page's
// Delivery, else in person) decides what that means: the start of the week's
// Sunday 11:59 pm of that week (defaults: dueRule "day", or "first-class" for
// the start of the week's first class once there are meetings; see
// custom/src/lms/offering-schedule.js). Fill in meetings and breaks.
//
// Grading: Canvas weights groups, not single assignments, so assignments are
// grouped by kind and each group's weight is the sum of its plan weights.
// Projects are worth 100 points; a group of assignments whose plan weights
// differ splits into one group per weight (projects) or gets points in
// proportion to weight (everything else), so every assignment keeps its plan
// weight exactly.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { deliveryFromCourse } from "../learning-materials/custom/src/lms/offering-schedule.js";

const SITE_DIR = process.env.SITE_DIR || new URL("../learning-materials/", import.meta.url).pathname;
const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const OUT = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
if (!OUT) {
  console.error("usage: node scripts/offering-from-plan.mjs <out.json> [--plan-dir dir] [--modules M01,M02] [--site-url url]");
  process.exit(1);
}
const PLAN_DIR = path.resolve(opt("--plan-dir", path.join(SITE_DIR, "../../digi-fab-course")));
const ONLY = opt("--modules", "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const items = JSON.parse(readFileSync(path.join(SITE_DIR, "site.json"), "utf8")).items.filter((i) => !i.metadata?.oerSnapshotOf);
const byId = new Map(items.map((i) => [i.id, i]));
const load = (name) => JSON.parse(readFileSync(path.join(PLAN_DIR, "data", `${name}.json`), "utf8"));
const projectRec = [].concat(load("project"))[0];
const modules = load("modules");
const assignments = load("assignments");
const code = projectRec.code; // "DART 413"
const byPlan = new Map(items.filter((i) => i.metadata?.oerPlan?.startsWith(`${code}:`)).map((i) => [i.metadata.oerPlan.slice(code.length + 1), i]));
const course = items.find((i) => i.metadata?.pageType === "oer:course" && i.metadata?.oerFields?.code === code);
const type = (i) => i?.metadata?.pageType || "";
const pick = (x) => byId.get(typeof x === "string" ? x : x?.page);

/* ---------- grading ---------- */
const GROUP_NAMES = { exercise: "Exercises", project: "Projects", reflection: "Reflections", presentation: "Presentations", critique: "Critique", quiz: "Quizzes" };
const RUBRIC_FOR = { exercise: "exercise", project: "project", reflection: "written-statement", presentation: "task", critique: "task" };
const graded = assignments.filter((a) => a.weight);
const groups = [];
const grading = new Map(); // assignment id -> { group, points }
for (const kind of [...new Set(graded.map((a) => a.kind))]) {
  const list = graded.filter((a) => a.kind === kind);
  const weights = [...new Set(list.map((a) => a.weight))];
  if (kind === "project") {
    // 100 points each: one group per distinct weight keeps each project's weight
    for (const w of weights) {
      const members = list.filter((a) => a.weight === w);
      const id = weights.length === 1 ? "projects" : `projects-${w}`;
      const name = weights.length === 1 ? "Projects" : members.length === 1 ? members[0].title.replace(/:.*$/, "") : `Projects (${w}% each)`;
      groups.push({ id, name, weight: w * members.length });
      for (const a of members) grading.set(a.id, { group: id, points: 100 });
    }
  } else {
    const id = kind;
    groups.push({ id, name: GROUP_NAMES[kind] || kind, weight: list.reduce((s, a) => s + a.weight, 0) });
    // equal weights: 20 points each; otherwise points in proportion to weight
    for (const a of list) grading.set(a.id, { group: id, points: weights.length === 1 ? 20 : a.weight * 10 });
  }
}

/* ---------- modules ---------- */
const placed = new Set();
const out = [];
for (const m of [...modules].sort((a, b) => a.week - b.week)) {
  if (ONLY.length && !ONLY.includes(m.id)) continue;
  const lesson = byPlan.get(m.id);
  const list = [];
  if (lesson) list.push({ page: lesson.id, as: "page", title: "Overview" });
  const fields = lesson?.metadata?.oerFields || {};
  for (const c of (fields.components || []).map(pick).filter(Boolean)) {
    const key = c.metadata?.oerPlan?.slice(code.length + 1) || "";
    const plan = assignments.find((a) => a.id === key);
    if (plan) {
      if (placed.has(plan.id)) continue;
      placed.add(plan.id);
      const g = grading.get(plan.id);
      list.push({
        page: c.id,
        as: "assignment",
        due: { week: plan.dueWeek },
        ...(g ? { points: g.points, group: g.group } : { points: 0, graded: false }),
        submission: ["online_upload"],
        rubric: RUBRIC_FOR[plan.kind] || "task",
      });
    } else if (type(c) === "oer:quiz") {
      list.push({ page: c.id, as: "quiz", quizType: "practice" });
    } else {
      list.push({ page: c.id, as: "page" });
    }
  }
  // assignments whose first week is this one but that no lesson lists
  for (const a of assignments.filter((x) => x.moduleIds?.[0] === m.id && !placed.has(x.id))) {
    const page = byPlan.get(a.id);
    if (!page) continue;
    placed.add(a.id);
    const g = grading.get(a.id);
    list.push({
      page: page.id,
      as: "assignment",
      due: { week: a.dueWeek },
      ...(g ? { points: g.points, group: g.group } : { points: 0, graded: false }),
      submission: ["online_upload"],
      rubric: RUBRIC_FOR[a.kind] || "task",
    });
  }
  const readings = (fields.readings || []).map(pick).filter(Boolean);
  if (readings.length) {
    list.push({ header: "Readings" });
    for (const r of readings) list.push({ page: r.id, as: "link" });
  }
  out.push({ id: m.id.toLowerCase(), title: `Week ${m.week}: ${lesson?.title || m.title}`, week: m.week, items: list });
}

const offering = {
  version: 1,
  course: course?.id || null,
  title: course?.title || `${code}: ${projectRec.name}`,
  code,
  term: projectRec.term,
  timeZone: "America/New_York",
  start: projectRec.semesterStart,
  weeks: projectRec.semesterWeeks,
  siteUrl: opt("--site-url", ""),
  delivery: deliveryFromCourse(course?.metadata?.oerFields?.delivery) || "in-person",
  // [{ day: "Tue", start: "13:25", end: "16:25", mode: "in-person" | "online", location, link }]
  meetings: [],
  // [{ label: "Spring break", start: "2027-03-08", end: "2027-03-14" }]
  breaks: [],
  defaults: { dueRule: "day", dueDay: "Sun", dueTime: "23:59", contentMode: "embed" },
  groups,
  // rating levels for every rubric criterion, as a share of its points
  rubricScale: [
    { name: "Exemplary", share: 1 },
    { name: "Proficient", share: 0.85 },
    { name: "Developing", share: 0.7 },
    { name: "Beginning", share: 0.5 },
    { name: "Missing", share: 0 },
  ],
  modules: out,
};
writeFileSync(OUT, JSON.stringify(offering, null, 2) + "\n");
const count = (as) => out.reduce((n, m) => n + m.items.filter((i) => i.as === as).length, 0);
console.log(`${out.length} modules: ${count("page")} pages, ${count("assignment")} assignments, ${count("quiz")} quizzes, ${count("link")} links`);
console.log(`groups: ${groups.map((g) => `${g.name} ${g.weight}%`).join(", ")} (total ${groups.reduce((s, g) => s + g.weight, 0)}%)`);
