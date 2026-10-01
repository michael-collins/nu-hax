// Import learning-materials-decapcms' pathways into the HAXcms site:
//   node --env-file=.env.local scripts/import-pathways.mjs [--dry-run]
//
// - Each published pathway becomes a page of type "pathway" under the
//   site's "Pathways" page, with its fields (courses, levels, target role,
//   objectives, test-out criteria, prerequisites…) and an <oer-pathway>
//   block in the layout its `template` names (matrix by default).
// - Its outline becomes sub-pages: top-level nodes are modules (sections);
//   a node with `content` is a linked chapter (oer-include + metadata.oerRef)
//   tagged with its `level` (metadata.oerLevel); a node with neither is a
//   planned item (an untyped placeholder page, hidden from the menu).
// - Content the outlines link to (lessons, exercises, projects, lectures,
//   tutorials) is imported once into the matching library section ("Lessons",
//   "Exercises"…), created if missing, with its fields, attachments and
//   body. Pages that already exist (same type and title) are reused.
// - Files under /uploads (attachments, images, inline images) are uploaded
//   through the site's files API.
// Re-running replaces the pathway pages from the last import and reuses the
// imported content. Everything is written in one outline save.
import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import matter from "gray-matter";
import { connect } from "./lib/hax-api.mjs";
import { decapMarkdownToHtml } from "./lib/decap-md.mjs";

const DECAP = process.env.DECAP_DIR || path.resolve("../learning-materials-decapcms");
const SITE_DIR = new URL("../learning-materials/", import.meta.url).pathname;
const BASE = process.env.HAX_BASE || "http://localhost:3000";
const SITE = process.env.HAX_SITE || "learning-materials";
const DRY = process.argv.includes("--dry-run");
const IMPORT_MARK = "decap-pathways";

// Decap collection → HAX type id and library section
const COLLECTIONS = {
  lessons: { type: "lesson", section: "Lessons", intro: "Lessons group lectures, tutorials and exercises around a set of learning objectives." },
  exercises: { type: "exercise", section: "Exercises", intro: "Formative practice focused on a narrow set of competencies." },
  projects: { type: "project", section: "Projects", intro: "Larger pieces of work that bring several skills together." },
  lectures: { type: "lecture", section: "Lectures", intro: "Presentations that introduce the ideas behind a topic." },
  tutorials: { type: "tutorial", section: "Tutorials", intro: "Step-by-step walkthroughs of a technique or tool." },
  pathways: { type: "pathway" },
};

// What Decap's pathway pages say about every pathway's length (Facts.vue)
const DEFAULT_LENGTH = "One course run (6 or 15 weeks, same credits)";
const PATHWAYS_INTRO =
  "A pathway is one run of a course, 6 or 15 weeks, shaped around what you want to do in 3D. Everyone starts with CGI Foundations; after that, choose a pathway, and take it again at a higher level on a repeat run.";

const api = await connect();
const site = JSON.parse(readFileSync(path.join(SITE_DIR, "site.json"), "utf8"));
const items = site.items;
const types = items.find((i) => i.metadata?.pageType === "oer-system")?.metadata?.oerContentTypes?.types || [];
const typeDef = (id) => types.find((t) => t.id === id) || { fields: [] };
const newId = () => `item-${randomUUID()}`;
const report = { created: [], reused: [], uploaded: [], dropped: [] };

/* ---------- reading Decap ---------- */

function readEntry(ref) {
  for (const file of [path.join(DECAP, "content", ref, "index.md"), path.join(DECAP, "content", `${ref}.md`)]) {
    if (existsSync(file)) return matter(readFileSync(file, "utf8"));
  }
  return null;
}

const pathwaySlugs = readdirSync(path.join(DECAP, "content/pathways"), { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);
const pathways = pathwaySlugs
  .map((slug) => ({ slug, ...readEntry(`pathways/${slug}`) }))
  .filter((p) => p.data && p.data.published !== false);

// every content ref used by an outline, in first-use order
const refs = new Set();
const walk = (nodes) => (nodes || []).forEach((n) => (n.content && refs.add(n.content), walk(n.items)));
pathways.forEach((p) => walk(p.data.outline));

/* ---------- uploads ---------- */

const uploads = new Map();
async function upload(src) {
  if (!src || !String(src).startsWith("/uploads/")) return src;
  if (uploads.has(src)) return uploads.get(src);
  const name = path.basename(src);
  let url = `files/${name}`;
  if (!existsSync(path.join(SITE_DIR, "files", name))) {
    const file = path.join(DECAP, "public", src);
    if (!existsSync(file)) {
      report.dropped.push(`missing upload ${src}`);
      uploads.set(src, "");
      return "";
    }
    if (!DRY) {
      const form = new FormData();
      form.append("file-upload", new Blob([readFileSync(file)]), name);
      const res = await fetch(`${BASE}/x/api/v1/files`, { method: "POST", headers: api.headers, body: form });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(`upload ${src} failed (${res.status})`);
      const saved = json?.data?.file || {};
      url = saved.url || saved.fullUrl || saved.path || url;
    }
    report.uploaded.push(src);
  }
  uploads.set(src, url);
  return url;
}

async function uploadInline(md) {
  const found = [...new Set(String(md).match(/\/uploads\/[^\s)"'<>]+/g) || [])];
  for (const src of found) md = md.split(src).join(await upload(src));
  return md;
}

/* ---------- field mapping ---------- */

const toList = (v) => (Array.isArray(v) ? v : v === undefined || v === null || v === "" ? [] : [v]).map((x) => String(x));

// Decap typed references: [{ __typename: "lessons", lesson: "slug", lesson_version: "1.0.0" }]
function decapRefs(list) {
  return (Array.isArray(list) ? list : []).flatMap((r) => {
    if (!r || typeof r !== "object") return [];
    const key = Object.keys(r).find((k) => k !== "__typename" && !k.endsWith("_version"));
    const version = Object.entries(r).find(([k]) => k.endsWith("_version"))?.[1];
    return key ? [{ ref: `${r.__typename}/${r[key]}`, version: version && version !== "latest" ? String(version) : "" }] : [];
  });
}

const pageIds = new Map(); // "lessons/slug" | "pathways/slug" -> HAX item id

async function mapFields(typeId, fm, label) {
  const out = {};
  for (const f of typeDef(typeId).fields) {
    let v = fm[f.name];
    if (f.kind === "relation") {
      const links = decapRefs(v).flatMap(({ ref, version }) => {
        const page = pageIds.get(ref);
        if (!page) report.dropped.push(`${label}: ${f.name} → ${ref} (not in the site)`);
        return page ? [{ page, version }] : [];
      });
      if (links.length) out[f.name] = links;
      continue;
    }
    if (f.kind === "files") {
      const rows = [];
      for (const a of Array.isArray(v) ? v : []) {
        const url = a.file ? await upload(a.file) : a.url || "";
        if (url || a.title) rows.push({ title: a.title || "", url, description: a.description || "", alt: a.alt || "" });
      }
      if (rows.length) out[f.name] = rows;
      continue;
    }
    if (f.name === "estimatedDuration" && typeId === "pathway" && !v && toList(fm.courses).length) v = DEFAULT_LENGTH;
    if (v === undefined || v === null || v === "") continue;
    if (f.kind === "list") v = toList(v);
    else if (f.kind === "select" && f.multiple) v = toList(v);
    else if (f.kind === "boolean") v = !!v;
    else if (f.kind === "number") v = Number(v);
    else if (f.kind === "image") v = await upload(v);
    else if (f.kind === "date") v = v instanceof Date ? v.toISOString() : String(v);
    else v = Array.isArray(v) ? v.join(", ") : String(v);
    if (v !== "" && !(Array.isArray(v) && !v.length)) out[f.name] = v;
  }
  return out;
}

/* ---------- plan ---------- */

const live = items.filter((i) => !i.metadata?.oerSnapshotOf);
const byTitle = (title, type) => live.find((i) => i.title.toLowerCase() === String(title).toLowerCase() && i.metadata?.pageType === type);
const childrenOf = (id) => items.filter((i) => i.parent === id).sort((a, b) => a.order - b.order);
const newItems = [];
const deleted = new Set();

function addPage({ id = newId(), title, parent, description = "", metadata, contents }) {
  const parentItem = items.find((i) => i.id === parent) || newItems.find((i) => i.id === parent);
  const siblings = [...childrenOf(parent).filter((i) => !deleted.has(i.id)), ...newItems.filter((i) => i.parent === parent)];
  newItems.push({
    id,
    title,
    parent: parent || null,
    order: siblings.length,
    indent: parentItem ? (Number(parentItem.indent) || 0) + 1 : 0,
    location: "",
    description,
    metadata: { published: true, ...metadata },
    contents: contents || "<p></p>",
    new: true,
  });
  return id;
}

// the previous import's pathway pages go (their content pages stay)
for (const i of items) if (i.metadata?.oerImport === IMPORT_MARK) deleted.add(i.id);

// library sections
const sections = new Map();
function section(collection) {
  const c = COLLECTIONS[collection];
  if (sections.has(collection)) return sections.get(collection);
  const found = live.find((i) => !i.parent && i.title === c.section && i.metadata?.pageType === "section");
  const id =
    found?.id ||
    addPage({
      title: c.section,
      parent: null,
      metadata: { pageType: "section" },
      contents: `<p>${c.intro}</p>\n<oer-collection types="${c.type}" scope="site" view="table" sort="title" per-page="20" controls="full"></oer-collection>`,
    });
  sections.set(collection, id);
  return id;
}

// 1. ids for every page that can be linked to
const pathwayPage = live.find((i) => !i.parent && i.title === "Pathways");
if (!pathwayPage) throw new Error('No top-level "Pathways" page in the site');
const contentEntries = [];
for (const ref of refs) {
  const [collection, slug] = ref.split("/");
  const entry = readEntry(ref);
  if (!entry || !COLLECTIONS[collection]?.section) {
    report.dropped.push(`outline content ${ref} (not found in Decap)`);
    continue;
  }
  const type = COLLECTIONS[collection].type;
  const existing = live.find((i) => i.metadata?.oerSource === ref) || byTitle(entry.data.title || slug, type);
  if (existing) {
    pageIds.set(ref, existing.id);
    report.reused.push(`${ref} → ${existing.title}`);
  } else {
    const id = newId();
    pageIds.set(ref, id);
    contentEntries.push({ ref, collection, slug, id, type, entry });
  }
}
for (const p of pathways) pageIds.set(`pathways/${p.slug}`, newId());

// 2. content pages
for (const { ref, collection, slug, id, type, entry } of contentEntries) {
  const fm = entry.data;
  const body = entry.content.trim() ? await (DRY ? entry.content : decapMarkdownToHtml(api, await uploadInline(entry.content))) : "<p></p>";
  addPage({
    id,
    title: fm.title || slug,
    parent: section(collection),
    description: fm.description || "",
    metadata: {
      pageType: type,
      oerSource: ref,
      ...(fm.tags ? { tags: toList(fm.tags).join(",") } : {}),
      ...(fm.published === false ? { published: false } : {}),
      oerFields: await mapFields(type, fm, ref),
    },
    contents: body,
  });
  report.created.push(ref);
}

// 3. pathways, their modules and items
const sorted = [...pathways].sort((a, b) => String(a.data.title).localeCompare(String(b.data.title)));
for (const p of sorted) {
  const fm = p.data;
  const id = pageIds.get(`pathways/${p.slug}`);
  const layout = ["matrix", "syllabus", "sidebar"].includes(fm.template) ? fm.template : "matrix";
  const body = p.content.trim() ? (DRY ? "" : await decapMarkdownToHtml(api, await uploadInline(p.content))) : "";
  addPage({
    id,
    title: fm.title || p.slug,
    parent: pathwayPage.id,
    description: fm.description || "",
    metadata: {
      pageType: "pathway",
      oerImport: IMPORT_MARK,
      oerSource: `pathways/${p.slug}`,
      ...(fm.tags ? { tags: toList(fm.tags).join(",") } : {}),
      oerFields: await mapFields("pathway", fm, `pathways/${p.slug}`),
    },
    contents: `<oer-pathway layout="${layout}"></oer-pathway>\n${body}`,
  });
  report.created.push(`pathways/${p.slug}`);

  const node = (n, parent, depth) => {
    const meta = { oerImport: IMPORT_MARK, ...(n.level ? { oerLevel: n.level } : {}) };
    if (n.content) {
      const page = pageIds.get(n.content);
      if (!page) {
        // like Decap's "Linked content not found": keep the title as planned
        return addPage({ title: n.title, parent, metadata: { ...meta, hideInMenu: true } });
      }
      const type = COLLECTIONS[n.content.split("/")[0]]?.type || "";
      const nodeId = addPage({
        title: n.title,
        parent,
        metadata: { ...meta, pageType: type, oerRef: { page, version: "" } },
        contents: `<oer-include page="${page}"></oer-include>`,
      });
      (n.items || []).forEach((c) => node(c, nodeId, depth + 1));
      return nodeId;
    }
    const kids = n.items || [];
    // modules and groups are sections; a leaf without content is planned
    const nodeId = addPage({
      title: n.title,
      parent,
      metadata: kids.length || depth === 0 ? { ...meta, pageType: "section" } : { ...meta, hideInMenu: true },
    });
    kids.forEach((c) => node(c, nodeId, depth + 1));
    return nodeId;
  };
  (fm.outline || []).forEach((m) => node(m, id, 0));
}

/* ---------- write ---------- */

const outline = [
  ...items.map((i) => (deleted.has(i.id) ? { ...i, delete: true } : i)),
  ...newItems,
];
console.log(`${pathways.length} pathways, ${contentEntries.length} new content pages, ${report.reused.length} reused, ${deleted.size} old import pages replaced, ${newItems.length} pages to create`);
if (DRY) {
  console.log("dry run: nothing written");
} else {
  const res = await api.call("PATCH", "/x/api/v1/site/outline", { headers: api.headers, body: { site: { name: SITE }, items: outline } });
  if (!res.ok) throw new Error(`outline save failed (${res.status}): ${JSON.stringify(res.json).slice(0, 300)}`);
  // the Pathways page lists them, as Decap's /pathways does
  const index = `<p>${PATHWAYS_INTRO}</p>\n<oer-collection types="pathway" scope="children" view="pathways" sort="title" controls="none"></oer-collection>`;
  const saved = await api.saveContent(pathwayPage.id, index, { title: pathwayPage.title });
  if (!saved.ok) throw new Error(`Pathways page save failed (${saved.status})`);
}
if (report.uploaded.length) console.log(`uploaded ${report.uploaded.length} files`);
if (report.dropped.length) console.log(`not imported:\n  ${report.dropped.join("\n  ")}`);
