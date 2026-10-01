// Convert learning-materials-decapcms' cms/config.yml collections into the
// site's content-type definitions (the JSON the type editor stores).
//   node scripts/decap-types-to-json.mjs [path/to/cms/config.yml] > types.json
//
// Field mapping: string→text, text→longtext, select→select, list→list,
// datetime→date, boolean→boolean, image→image. Fields HAX already models
// per page (title, description, tags, published), the page body (markdown)
// and Decap-internal fields (slug, hidden, version, outline, items) are
// left out; relations wait for the books/versioning work.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const YAML = require("/Users/msc227/Documents/repos/open-curriculum/oerschema/learning-materials-decapcms/node_modules/yaml");

const src =
  process.argv[2] ||
  "/Users/msc227/Documents/repos/open-curriculum/oerschema/learning-materials-decapcms/cms/config.yml";
const config = YAML.parse(readFileSync(src, "utf8"));

const SKIP = new Set(["title", "slug", "description", "tags", "published", "body", "outline", "items", "type", "template"]);
const KIND = { string: "text", text: "longtext", select: "select", list: "list", datetime: "date", boolean: "boolean", image: "image" };
// shown in the page header by default
const HEADER = new Set([
  "difficulty",
  "estimatedDuration",
  "learningObjectives",
  "prerequisites",
  "whoItsFor",
  "targetRole",
  "skills",
  "tools",
  "authors",
]);

const META = {
  lessons: { id: "lesson", label: "Lesson", icon: "hax:lesson", children: ["section", "article", "tutorial", "lecture", "exercise", "project"] },
  articles: { id: "article", label: "Article", icon: "hax:newspaper", children: [] },
  tutorials: { id: "tutorial", label: "Tutorial", icon: "courseicons:strategy", children: [] },
  exercises: { id: "exercise", label: "Exercise", icon: "hax:task", children: [] },
  projects: { id: "project", label: "Project", icon: "hax:bulletin-board", children: [] },
  lectures: { id: "lecture", label: "Lecture", icon: "image:slideshow", children: [] },
  specializations: { id: "specialization", label: "Specialization", icon: "lrn:teacher", children: ["lesson"] },
  pathways: { id: "pathway", label: "Pathway", icon: "hax:unit", children: ["section", "specialization", "lesson"] },
  books: { id: "book", label: "Book", icon: "lrn:book", children: ["section", "lesson", "article", "tutorial", "lecture", "exercise", "project"] },
  rubrics: { id: "rubric", label: "Assessment rubric", icon: "lrn:assessment", children: [] },
  resources: { id: "resource", label: "Resource", icon: "editor:attach-file", children: [] },
};

const options = (f) =>
  (f.options || []).map((o) => (typeof o === "object" ? { value: String(o.value), label: String(o.label ?? o.value) } : { value: String(o), label: String(o) }));

function field(f) {
  const kind = KIND[f.widget || "string"];
  if (!kind || SKIP.has(f.name)) return null;
  // lists of objects (attachments, criteria…) have no flat form yet
  if (kind === "list" && Array.isArray(f.fields) && f.fields.length > 1) return null;
  const out = { name: f.name, label: f.label || f.name, kind };
  if (f.hint) out.help = String(f.hint);
  if (f.required === true) out.required = true;
  if (kind === "select") out.options = options(f);
  if (HEADER.has(f.name)) out.header = true;
  return out;
}

const types = [
  {
    id: "section",
    label: "Section",
    icon: "icons:folder",
    description: "A heading that groups other pages (e.g. Topics, Readings).",
    children: null,
    fields: [],
  },
];
for (const col of config.collections || []) {
  const meta = META[col.name];
  if (!meta) continue;
  types.push({
    id: meta.id,
    label: meta.label,
    icon: meta.icon,
    description: col.description || "",
    children: meta.children,
    fields: (col.fields || []).map(field).filter(Boolean),
  });
}

process.stdout.write(JSON.stringify({ version: 1, types }, null, 2) + "\n");
