// Convert learning-materials-decapcms' cms/config.yml collections into the
// site's content-type definitions (the JSON the type editor stores).
//   DECAP_DIR=../learning-materials-decapcms node scripts/decap-types-to-json.mjs > types.json
//   (or pass the path to cms/config.yml as the first argument)
//
// Field mapping: string→text, text→longtext, select→select, list→list,
// datetime→date, boolean→boolean, image→image. Typed lists of relations
// (prerequisites…) become "relation" fields limited to those types, and
// lists with a file widget (attachments) become "files" fields. Fields HAX
// already models per page (title, description, tags, published), the page
// body (markdown) and Decap-internal fields (slug, hidden, version, outline,
// items) are left out.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const DECAP = process.env.DECAP_DIR || path.resolve("../learning-materials-decapcms");
// the Decap project's own copy of `yaml`, so this repo needs no extra dependency
const require = createRequire(path.join(DECAP, "package.json"));
const YAML = require("yaml");

const src = process.argv[2] || path.join(DECAP, "cms/config.yml");
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
  lessons: { id: "oer:lesson", label: "Lesson", icon: "hax:lesson", children: ["oer:section", "oer:article", "oer:tutorial", "oer:lecture", "oer:exercise", "oer:project"] },
  articles: { id: "oer:article", label: "Article", icon: "hax:newspaper", children: [] },
  tutorials: { id: "oer:tutorial", label: "Tutorial", icon: "courseicons:strategy", children: [] },
  exercises: { id: "oer:exercise", label: "Exercise", icon: "hax:task", children: [] },
  projects: { id: "oer:project", label: "Project", icon: "hax:bulletin-board", children: [] },
  lectures: { id: "oer:lecture", label: "Lecture", icon: "image:slideshow", children: [] },
  specializations: { id: "oer:specialization", label: "Specialization", icon: "lrn:teacher", children: ["oer:lesson"] },
  pathways: { id: "oer:pathway", label: "Pathway", icon: "hax:unit", children: ["oer:section", "oer:specialization", "oer:lesson"] },
  books: { id: "oer:book", label: "Book", icon: "lrn:book", children: ["oer:section", "oer:lesson", "oer:article", "oer:tutorial", "oer:lecture", "oer:exercise", "oer:project"] },
  rubrics: { id: "oer:rubric", label: "Assessment rubric", icon: "lrn:assessment", children: [] },
  resources: { id: "oer:resource", label: "Resource", icon: "editor:attach-file", children: [] },
};

const options = (f) =>
  (f.options || []).map((o) => (typeof o === "object" ? { value: String(o.value), label: String(o.label ?? o.value) } : { value: String(o), label: String(o) }));

// a typed list whose variants each hold a relation: the linkable type ids
const relationTypes = (f) =>
  (f.types || [])
    .map((t) => (t.fields || []).find((x) => x.widget === "relation")?.collection)
    .map((c) => META[c]?.id)
    .filter(Boolean);

function field(f) {
  if (SKIP.has(f.name)) return null;
  if (f.widget === "list" && Array.isArray(f.types)) {
    const types = relationTypes(f);
    if (!types.length) return null;
    const out = { name: f.name, label: f.label || f.name, kind: "relation", types };
    if (f.hint) out.help = String(f.hint);
    if (HEADER.has(f.name)) out.header = true;
    return out;
  }
  if (f.widget === "list" && (f.fields || []).some((x) => x.widget === "file")) {
    const out = { name: f.name, label: f.label || f.name, kind: "files", header: true };
    if (f.hint) out.help = String(f.hint);
    return out;
  }
  const kind = KIND[f.widget || "string"];
  if (!kind) return null;
  // lists of objects (attachments, criteria…) have no flat form yet
  if (kind === "list" && Array.isArray(f.fields) && f.fields.length > 1) return null;
  const out = { name: f.name, label: f.label || f.name, kind };
  if (f.hint) out.help = String(f.hint);
  if (f.required === true) out.required = true;
  if (kind === "select") out.options = options(f);
  if (kind === "select" && f.multiple) out.multiple = true;
  if (HEADER.has(f.name)) out.header = true;
  return out;
}

const types = [
  {
    id: "oer:section",
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
