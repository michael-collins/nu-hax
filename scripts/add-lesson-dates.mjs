// Give the Lesson type a Date field (when the lesson was published; used in
// citations and the page's citation metadata) and fill it from each
// lesson's Decap source (`date`):
//   node --env-file=.env.local scripts/add-lesson-dates.mjs [--dry-run]
// Archived versions read their v/<version>.md. Safe to run again.
import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { connect } from "./lib/hax-api.mjs";

const DECAP = process.env.DECAP_DIR || path.resolve("../open-curriculum/oerschema/learning-materials-decapcms");
const SITE_DIR = new URL("../learning-materials/", import.meta.url).pathname;
const DRY = process.argv.includes("--dry-run");
const items = JSON.parse(readFileSync(path.join(SITE_DIR, "site.json"), "utf8")).items;
const byId = new Map(items.map((i) => [i.id, i]));
const sys = items.find((i) => i.metadata?.pageType === "oer:system");
const defs = sys.metadata.oerContentTypes;
const out = [];

const lesson = defs.types.find((t) => t.id === "oer:lesson");
if (!lesson.fields.some((f) => f.name === "date")) {
  const fields = lesson.fields.flatMap((f) => (f.name === "authors" ? [f, { name: "date", label: "Date", kind: "date", help: "When the lesson was published. Used when it's cited." }] : [f]));
  if (!fields.some((f) => f.name === "date")) fields.push({ name: "date", label: "Date", kind: "date", help: "When the lesson was published. Used when it's cited." });
  out.push({ ...sys, metadata: { ...sys.metadata, oerContentTypes: { ...defs, types: defs.types.map((t) => (t.id === "oer:lesson" ? { ...t, fields } : t)) } }, modified: true });
}

// lessons seeded before sources were recorded: find the Decap lesson by title
const lessonDir = path.join(DECAP, "content", "lessons");
const byTitle = new Map(
  (existsSync(lessonDir) ? readdirSync(lessonDir) : [])
    .filter((slug) => existsSync(path.join(lessonDir, slug, "index.md")))
    .map((slug) => [String(matter(readFileSync(path.join(lessonDir, slug, "index.md"), "utf8")).data.title || "").toLowerCase(), `lessons/${slug}`]),
);
const sourceOf = (item) => item?.metadata?.oerSource || byTitle.get(String(item?.title || "").toLowerCase()) || "";

const toIso = (d) => (d instanceof Date ? d.toISOString() : d ? new Date(d).toISOString() : "");
let set = 0;
for (const i of items) {
  if (i.metadata?.pageType !== "oer:lesson" || i.metadata?.oerRef || i.metadata?.oerFields?.date) continue;
  const snapOf = i.metadata?.oerSnapshotOf && byId.get(i.metadata.oerSnapshotOf);
  const source = sourceOf(snapOf || i);
  if (!source) continue;
  const file = snapOf ? path.join(DECAP, "content", source, "v", `${i.metadata.version}.md`) : path.join(DECAP, "content", source, "index.md");
  if (!existsSync(file)) continue;
  const date = toIso(matter(readFileSync(file, "utf8")).data.date);
  if (!date || date.startsWith("Invalid")) continue;
  out.push({ ...i, metadata: { ...i.metadata, oerFields: { ...(i.metadata?.oerFields || {}), date } }, modified: true });
  set++;
}
console.log(`${out.length - set ? "Lesson type gets a Date field; " : ""}${set} lessons get a date${DRY ? " (dry run)" : ""}`);
if (DRY || !out.length) process.exit(0);
const api = await connect();
const res = await api.call("PATCH", "/x/api/v1/site/outline", { headers: api.headers, body: { site: { name: "learning-materials" }, items: out } });
console.log(res.ok ? "saved" : `failed ${res.status}`);
