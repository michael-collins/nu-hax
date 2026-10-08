// Add the Course sequence content type: a published, versioned plan for
// running a course (15 weeks, 6 weeks, any length), linked to the courses
// it's for. Its structure (modules and their items as LMS pages,
// assignments, quizzes and links; due weeks, points, submission types,
// rubrics; grade groups and weights; the rubric point scale) lives in the
// page's metadata.oerSequence, edited in the sequence builder. Term dates
// come at export: start and end, breaks, the typical due day and time,
// class meetings (custom/src/lms/).
// Described in JSON-LD as an OER Schema InstructionalPattern.
//   node --env-file=.env.local scripts/add-sequence-type.mjs [--dry-run]
// Safe to run again (it replaces the type's definition).
import { readFileSync } from "node:fs";
import path from "node:path";
import { connect } from "./lib/hax-api.mjs";

const SITE_DIR = process.env.SITE_DIR || new URL("../learning-materials/", import.meta.url).pathname;
const SITE = process.env.HAX_SITE || "learning-materials";
const DRY = process.argv.includes("--dry-run");

const items = JSON.parse(readFileSync(path.join(SITE_DIR, "site.json"), "utf8")).items;
const sys = items.find((i) => i.metadata?.pageType === "oer:system");
const raw = sys.metadata.oerContentTypes;
const types = typeof raw === "string" ? JSON.parse(raw) : structuredClone(raw);
const course = types.types.find((t) => t.id === "oer:course");
const exercise = types.types.find((t) => t.id === "oer:exercise");
const field = (t, name) => structuredClone(t.fields.find((f) => f.name === name));

const SEQUENCE = {
  id: "oer:sequence",
  label: "Course sequence",
  icon: "icons:date-range",
  description: "A plan for running a course, week by week: what students read, do and hand in, when it's due and how it's graded. Export it to Canvas with your term's dates.",
  schemaType: "oer:InstructionalPattern",
  nav: false,
  children: [],
  fields: [
    { name: "courses", label: "Courses", kind: "relation", header: true, types: ["oer:course"], filter: true, help: "The courses this sequence is for." },
    { name: "weeks", label: "Length (weeks)", kind: "number", header: true, help: "Teaching weeks, breaks not counted." },
    { ...field(course, "delivery"), help: "How the course meets. It sets the defaults: weekly unlocks and in-order work online and asynchronous, class meetings otherwise." },
    field(exercise, "authors"),
    field(course, "license"),
    field(exercise, "placeholder"),
  ],
};
// the four modes only (a sequence never had the old "Online")
const delivery = SEQUENCE.fields.find((f) => f.name === "delivery");
delivery.options = delivery.options.filter((o) => o.value !== "Online");

const at = types.types.findIndex((t) => t.id === SEQUENCE.id);
if (at >= 0) types.types[at] = SEQUENCE;
else types.types.splice(types.types.findIndex((t) => t.id === "oer:course") + 1, 0, SEQUENCE);
console.log(`${at >= 0 ? "updating" : "adding"} ${SEQUENCE.id}: ${SEQUENCE.fields.map((f) => f.name).join(", ")}${DRY ? " (dry run)" : ""}`);
if (DRY) process.exit(0);

const out = { ...sys, metadata: { ...sys.metadata, oerContentTypes: typeof raw === "string" ? JSON.stringify(types) : types }, modified: true };
const api = await connect();
const res = await api.call("PATCH", "/x/api/v1/site/outline", { headers: api.headers, body: { site: { name: SITE }, items: [out] } });
if (!res.ok) throw new Error(`outline save failed (${res.status}): ${JSON.stringify(res.json).slice(0, 300)}`);
console.log("saved");
