// Section pages' tables offer a filter only for fields marked "Readers can
// filter by this" (`filter: true`), plus tags; before, every choice field
// with two or more values got one (AI usage licences, licence, delivery…).
// This marks Difficulty on every type that has it. Courses, and a course's
// University, Campus and Degree programs, are marked already.
//   node --env-file=.env.local scripts/reader-filters.mjs [--dry-run]
// HAX_BASE and SITE_DIR point it at another copy of the site. Safe to run again.
import { readFileSync } from "node:fs";
import path from "node:path";
import { connect } from "./lib/hax-api.mjs";

const SITE_DIR = process.env.SITE_DIR || new URL("../learning-materials/", import.meta.url).pathname;
const SITE = process.env.HAX_SITE || "learning-materials";
const DRY = process.argv.includes("--dry-run");
const MARK = new Set(["difficulty"]);

const items = JSON.parse(readFileSync(path.join(SITE_DIR, "site.json"), "utf8")).items;
const sys = items.find((i) => i.metadata?.pageType === "oer:system");
const defs = sys.metadata.oerContentTypes;
const marked = [];
const types = defs.types.map((t) => ({
  ...t,
  fields: t.fields.map((f) => {
    if (!MARK.has(f.name) || f.filter) return f;
    marked.push(`${t.label}: ${f.label}`);
    return { ...f, filter: true };
  }),
}));
const all = types.flatMap((t) => t.fields.filter((f) => f.filter).map((f) => `${t.label}: ${f.label}`));
console.log(marked.length ? `marking ${marked.join(", ")}` : "nothing to mark");
console.log(`readers can filter by: ${all.join(", ")}`);
if (DRY || !marked.length) process.exit(0);

const api = await connect();
const res = await api.call("PATCH", "/x/api/v1/site/outline", {
  headers: api.headers,
  body: { site: { name: SITE }, items: [{ ...sys, metadata: { ...sys.metadata, oerContentTypes: { ...defs, types } }, modified: true }] },
});
if (!res.ok) throw new Error(`outline save failed (${res.status}): ${JSON.stringify(res.json).slice(0, 300)}`);
console.log("saved");
