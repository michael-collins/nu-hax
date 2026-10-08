// Define the Rubric content type: a self-contained scoring guide (criteria
// with weights, rating levels, what each level looks like) that any number
// of exercises, projects and discussions use, through the Rubric block on a
// page or a course sequence item's rubric. Its structure lives in the page's
// metadata.oerRubric, edited in the rubric editor (Edit rubric on the page;
// custom/src/rubrics/). Described in JSON-LD as an OER Schema Rubric.
// Replaces the placeholder type carried over from the Decap import.
//   node --env-file=.env.local scripts/add-rubric-type.mjs [--dry-run]
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

const RUBRIC = {
  id: "oer:rubric",
  label: "Rubric",
  icon: "icons:assignment-turned-in",
  description: "A scoring guide: criteria with weights, rating levels and what each level looks like. Exercises, projects and discussions show it with the Rubric block, and course sequences grade with it in Canvas.",
  schemaType: "oer:Rubric",
  nav: false,
  children: [],
  fields: [field(exercise, "authors"), field(course, "license"), field(exercise, "placeholder")],
};

const at = types.types.findIndex((t) => t.id === RUBRIC.id);
if (at >= 0) types.types[at] = RUBRIC;
else types.types.splice(types.types.findIndex((t) => t.id === "oer:quiz") + 1, 0, RUBRIC);
console.log(`${at >= 0 ? "updating" : "adding"} ${RUBRIC.id}: ${RUBRIC.fields.map((f) => f.name).join(", ")}${DRY ? " (dry run)" : ""}`);
if (DRY) process.exit(0);

const out = { ...sys, metadata: { ...sys.metadata, oerContentTypes: typeof raw === "string" ? JSON.stringify(types) : types }, modified: true };
const api = await connect();
const res = await api.call("PATCH", "/x/api/v1/site/outline", { headers: api.headers, body: { site: { name: SITE }, items: [out] } });
if (!res.ok) throw new Error(`outline save failed (${res.status}): ${JSON.stringify(res.json).slice(0, 300)}`);
console.log("saved");
