// Bring over the learning-materials-decapcms content the site doesn't have
// yet (everything except specializations and a few test pages):
//   node --env-file=.env.local scripts/import-decap-rest.mjs [--dry-run]
//
// - articles, lessons, lectures, tutorials, exercises, projects, books and
//   pathways that aren't on the site (matched by metadata.oerSource, or by
//   type and title) become pages in their library section, with their
//   fields, uploads and body; Decap's unpublished items stay unpublished
// - content/data/resources.json entries become Resource pages
// - a book's outline becomes its chapters: groups as sections, entries as
//   linked chapters (oer-include + metadata.oerRef)
// - links between pages (relation fields, chapters) point at the new pages'
//   real ids afterwards (relink), and descriptions are set one by one
// New sections: Articles and Resources (Library), Books (Curriculum).
// Run scripts/import-versions.mjs afterwards for their version history.
// Safe to run again: pages that already exist are left alone.
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import matter from "gray-matter";
import { connect } from "./lib/hax-api.mjs";
import { decapMarkdownToHtml } from "./lib/decap-md.mjs";

const DECAP = process.env.DECAP_DIR || path.resolve("../open-curriculum/oerschema/learning-materials-decapcms");
const SITE_DIR = new URL("../learning-materials/", import.meta.url).pathname;
const BASE = process.env.HAX_BASE || "http://localhost:3000";
const SITE = process.env.HAX_SITE || "learning-materials";
const DRY = process.argv.includes("--dry-run");

// Decap collection → type, section and where the section goes
const COLLECTIONS = {
  articles: { type: "oer:article", section: "Articles", after: "Tutorials", intro: "Readings: background, context and reference for the lessons." },
  lessons: { type: "oer:lesson", section: "Lessons" },
  lectures: { type: "oer:lecture", section: "Lectures" },
  tutorials: { type: "oer:tutorial", section: "Tutorials" },
  exercises: { type: "oer:exercise", section: "Exercises" },
  projects: { type: "oer:project", section: "Projects" },
  books: { type: "oer:book", section: "Books", after: "Pathways", intro: "Course books: chapters to read in order, to print or export for an LMS." },
  resources: { type: "oer:resource", section: "Resources", after: "Articles", intro: "Artists, studios and other references the exercises and projects point to." },
  pathways: { type: "oer:pathway", section: "Pathways" },
};
const SKIP_COLLECTIONS = new Set(["specializations", "rubrics", "data"]);
// pages about the Decap site itself, or tests
const SKIP = new Set(["3D Model Viewer Test", "Building Your First Nuxt App", "Working with DecapCMS"]);

const api = DRY ? null : await connect();
let items = JSON.parse(readFileSync(path.join(SITE_DIR, "site.json"), "utf8")).items;
const sys = items.find((i) => i.metadata?.pageType === "oer:system");
let defs = sys.metadata.oerContentTypes;
const typeDef = (id) => defs.types.find((t) => t.id === id) || { fields: [] };
const newId = () => `item-${randomUUID()}`;
const report = { created: [], uploaded: [], dropped: [] };
const toList = (v) => (Array.isArray(v) ? v : v === undefined || v === null || v === "" ? [] : [v]).map((x) => String(x));

/* ---------- Resource type fields ---------- */

const resourceType = typeDef("oer:resource");
if (!resourceType.fields?.some((f) => f.name === "url")) {
  defs = {
    ...defs,
    types: defs.types.map((t) =>
      t.id === "oer:resource"
        ? {
            ...t,
            description: t.description || "An artist, studio, tool or other reference outside the site.",
            schemaType: t.schemaType || "oer:ReferencedMaterial",
            fields: [
              { name: "url", label: "Link", kind: "url", header: true },
              { name: "kind", label: "Kind", kind: "text", header: true, help: "e.g. artist, studio, tool, reference" },
              ...(t.fields || []),
            ],
          }
        : t,
    ),
  };
}

/* ---------- uploads ---------- */

const uploads = new Map();
async function upload(src) {
  if (!src || !String(src).startsWith("/uploads/")) return src;
  if (uploads.has(src)) return uploads.get(src);
  const name = path.basename(src);
  // the site may already have it from an earlier import
  if (existsSync(path.join(SITE_DIR, "files", name))) {
    uploads.set(src, `files/${name}`);
    return `files/${name}`;
  }
  const file = path.join(DECAP, "public", src);
  if (!existsSync(file)) {
    report.dropped.push(`missing upload ${src} (link kept as is)`);
    uploads.set(src, src);
    return src;
  }
  let url = `files/${name}`;
  if (!DRY) {
    const form = new FormData();
    form.append("file-upload", new Blob([readFileSync(file)]), name);
    const res = await fetch(`${BASE}/x/api/v1/files`, { method: "POST", headers: api.headers, body: form });
    if (!res.ok) throw new Error(`upload ${src} failed (${res.status})`);
    const json = await res.json().catch(() => ({}));
    const saved = json?.data?.file || json?.file || {};
    url = saved.url || saved.fullUrl || saved.path || url;
  }
  report.uploaded.push(src);
  uploads.set(src, url);
  return url;
}
async function uploadInline(md) {
  const found = [...new Set(String(md).match(/\/uploads\/[^\s)"'<>]+/g) || [])];
  for (const src of found) md = md.split(src).join(await upload(src));
  return md;
}

/* ---------- what's missing ---------- */

const live = items.filter((i) => !i.metadata?.oerSnapshotOf && !i.metadata?.oerRef);
const bySource = new Map(live.filter((i) => i.metadata?.oerSource).map((i) => [i.metadata.oerSource, i.id]));
const byTypeTitle = (type, title) => live.find((i) => i.metadata?.pageType === type && i.title.toLowerCase() === String(title).toLowerCase());
const pageIds = new Map(bySource); // Decap ref → site id (existing or planned)

const entries = [];
for (const collection of readdirSync(path.join(DECAP, "content"))) {
  if (SKIP_COLLECTIONS.has(collection) || !COLLECTIONS[collection]) continue;
  const dir = path.join(DECAP, "content", collection);
  for (const slug of readdirSync(dir)) {
    const file = path.join(dir, slug, "index.md");
    if (!existsSync(file)) continue;
    const entry = matter(readFileSync(file, "utf8"));
    const ref = `${collection}/${slug}`;
    const title = entry.data.title || slug;
    const { type } = COLLECTIONS[collection];
    const existing = bySource.get(ref) || byTypeTitle(type, title)?.id;
    if (existing) {
      pageIds.set(ref, existing);
      continue;
    }
    if (SKIP.has(title)) continue;
    const id = newId();
    pageIds.set(ref, id);
    entries.push({ ref, collection, slug, id, type, title, entry });
  }
}
const resources = JSON.parse(readFileSync(path.join(DECAP, "content/data/resources.json"), "utf8")).resources || [];
const resourceEntries = [];
for (const r of resources) {
  const ref = `resources/${r.id}`;
  const existing = bySource.get(ref) || byTypeTitle("oer:resource", r.name)?.id;
  if (existing) {
    pageIds.set(ref, existing);
    continue;
  }
  const id = newId();
  pageIds.set(ref, id);
  resourceEntries.push({ ref, id, r });
}

/* ---------- fields ---------- */

function decapRefs(list) {
  return (Array.isArray(list) ? list : []).flatMap((r) => {
    if (!r || typeof r !== "object") return typeof r === "string" && r.includes("/") ? [{ ref: r, version: "" }] : [];
    const key = Object.keys(r).find((k) => k !== "__typename" && !k.endsWith("_version"));
    const version = Object.entries(r).find(([k]) => k.endsWith("_version"))?.[1];
    return key ? [{ ref: `${r.__typename}/${r[key]}`, version: version && version !== "latest" ? String(version) : "" }] : [];
  });
}

async function mapFields(typeId, fm, label) {
  const out = {};
  for (const f of typeDef(typeId).fields || []) {
    let v = fm[f.name];
    if (f.kind === "relation") {
      const links = decapRefs(v).flatMap(({ ref, version }) => {
        const page = pageIds.get(ref);
        if (!page) report.dropped.push(`${label}: ${f.name} → ${ref} (not on the site)`);
        return page ? [{ page, version }] : [];
      });
      if (links.length) out[f.name] = links;
      continue;
    }
    if (f.kind === "people") {
      const list = (Array.isArray(fm.authors) ? fm.authors : [])
        .map((a) => (a && typeof a === "object" ? { name: String(a.name || "").trim(), url: String(a.url || "").trim() } : { name: String(a).trim(), url: "" }))
        .filter((a) => a.name);
      if (!list.length && fm.author) list.push({ name: String(fm.author).trim(), url: String(fm.authorUrl || "").trim() });
      if (list.length) out[f.name] = list;
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
    if (v === undefined || v === null || v === "") continue;
    if (f.kind === "list" || (f.kind === "select" && f.multiple)) v = toList(v);
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

const newItems = [];
const childrenOf = (id) => items.filter((i) => i.parent === id);
function addPage({ id = newId(), title, parent, description = "", metadata, contents }) {
  const parentItem = items.find((i) => i.id === parent) || newItems.find((i) => i.id === parent);
  const siblings = [...childrenOf(parent), ...newItems.filter((i) => i.parent === parent)];
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

const sectionIds = new Map();
const topOrder = items.filter((i) => !i.parent).sort((a, b) => (a.order || 0) - (b.order || 0)).map((i) => i.id);
function section(collection) {
  if (sectionIds.has(collection)) return sectionIds.get(collection);
  const c = COLLECTIONS[collection];
  const found = live.find((i) => !i.parent && i.title === c.section);
  let id = found?.id;
  if (!id) {
    id = addPage({
      title: c.section,
      parent: null,
      metadata: { pageType: "oer:section" },
      contents: `<p>${c.intro}</p>\n<oer-collection types="${c.type}" scope="site" view="table" sort="title" per-page="20" controls="full"></oer-collection>`,
    });
    // place it after its neighbour in the sidebar
    const after = topOrder.findIndex((x) => (items.find((i) => i.id === x) || newItems.find((i) => i.id === x))?.title === c.after);
    topOrder.splice(after >= 0 ? after + 1 : topOrder.length, 0, id);
  }
  sectionIds.set(collection, id);
  return id;
}

// content pages
for (const e of entries) {
  const fm = e.entry.data;
  const body = e.entry.content.trim() ? (DRY ? "" : await decapMarkdownToHtml(api, await uploadInline(e.entry.content))) : "<p></p>";
  const isPathway = e.collection === "pathways";
  const layout = ["matrix", "syllabus", "sidebar"].includes(fm.template) ? fm.template : "matrix";
  addPage({
    id: e.id,
    title: e.title,
    parent: section(e.collection),
    description: fm.description || "",
    metadata: {
      pageType: e.type,
      oerSource: e.ref,
      ...(fm.tags ? { tags: toList(fm.tags).join(",") } : {}),
      ...(fm.published === false ? { published: false } : {}),
      oerFields: await mapFields(e.type, fm, e.ref),
    },
    contents: isPathway ? `<oer-pathway layout="${layout}"></oer-pathway>\n${body}` : body,
  });
  report.created.push(e.ref);
}

// resources
for (const { ref, id, r } of resourceEntries) {
  const body = r.body ? (DRY ? "" : await decapMarkdownToHtml(api, await uploadInline(r.body))) : "<p></p>";
  addPage({
    id,
    title: r.name || r.id,
    parent: section("resources"),
    description: r.description || "",
    metadata: {
      pageType: "oer:resource",
      oerSource: ref,
      ...(r.tags?.length ? { tags: toList(r.tags).join(",") } : {}),
      oerFields: { ...(r.url ? { url: r.url } : {}), ...(r.type ? { kind: r.type } : {}) },
    },
    contents: body,
  });
  report.created.push(ref);
}

// books: their outline as chapters
for (const e of entries.filter((x) => x.collection === "books")) {
  const node = (n, parent) => {
    if (n.content) {
      // "exercises/slug/v/0.9.0" is that page pinned to a release
      const [, baseRef, pinned] = String(n.content).match(/^(.*?)(?:\/v\/(\d+\.\d+\.\d+))?$/) || [];
      const page = pageIds.get(baseRef);
      if (!page) {
        report.dropped.push(`${e.ref}: chapter ${n.content} (not on the site)`);
        return;
      }
      const type = COLLECTIONS[baseRef.split("/")[0]]?.type || "";
      const id = addPage({
        title: n.title,
        parent,
        metadata: { pageType: type, oerRef: { page, version: pinned || "" } },
        contents: `<oer-include page="${page}"${pinned ? ` version="${pinned}"` : ""}></oer-include>`,
      });
      (n.items || []).forEach((c) => node(c, id));
      return;
    }
    const id = addPage({ title: n.title, parent, metadata: { pageType: "oer:section" } });
    (n.items || []).forEach((c) => node(c, id));
  };
  (e.entry.data.outline || []).forEach((n) => node(n, e.id));
}

/* ---------- write ---------- */

async function relink() {
  const after = JSON.parse(readFileSync(path.join(SITE_DIR, "site.json"), "utf8")).items;
  const real = new Map(after.filter((i) => i.metadata?.oerSource).map((i) => [i.metadata.oerSource, i.id]));
  const remap = new Map();
  for (const n of newItems) {
    const r = n.metadata.oerSource && real.get(n.metadata.oerSource);
    if (r && r !== n.id) remap.set(n.id, r);
  }
  if (!remap.size) return;
  const changed = new Map();
  for (const i of after) {
    const m = { ...i.metadata };
    let touched = false;
    if (m.oerRef?.page && remap.has(m.oerRef.page)) {
      const old = m.oerRef.page;
      m.oerRef = { ...m.oerRef, page: remap.get(old) };
      touched = true;
      const file = path.join(SITE_DIR, i.location || "");
      if (i.location && existsSync(file)) writeFileSync(file, readFileSync(file, "utf8").split(old).join(m.oerRef.page));
    }
    for (const [k, v] of Object.entries(m.oerFields || {})) {
      if (Array.isArray(v) && v.some((x) => x?.page && remap.has(x.page))) {
        m.oerFields = { ...m.oerFields, [k]: v.map((x) => (x?.page && remap.has(x.page) ? { ...x, page: remap.get(x.page) } : x)) };
        touched = true;
      }
    }
    if (touched) changed.set(i.id, { ...i, metadata: m, modified: true });
  }
  const res = await api.call("PATCH", "/x/api/v1/site/outline", { headers: api.headers, body: { site: { name: SITE }, items: after.map((i) => changed.get(i.id) || i) } });
  if (!res.ok) throw new Error(`relinking failed (${res.status})`);
  console.log(`relinked ${changed.size} pages`);
}

async function describe() {
  const after = JSON.parse(readFileSync(path.join(SITE_DIR, "site.json"), "utf8")).items;
  let n = 0;
  for (const p of newItems) {
    const real = p.metadata.oerSource && after.find((i) => i.metadata?.oerSource === p.metadata.oerSource);
    if (!real || !p.description || real.description === p.description) continue;
    const res = await api.updateItem(real.id, "setDescription", { description: p.description });
    if (!res.ok) throw new Error(`setDescription "${real.title}" failed (${res.status})`);
    n++;
  }
  if (n) console.log(`set ${n} descriptions`);
}

const counts = {};
for (const e of entries) counts[e.collection] = (counts[e.collection] || 0) + 1;
if (resourceEntries.length) counts.resources = resourceEntries.length;
console.log(`to import: ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(", ")}; ${newItems.length} pages in all (with sections and book chapters)`);
if (DRY) {
  console.log(`sections: ${[...sectionIds.keys()].map((c) => COLLECTIONS[c].section).join(", ")}`);
  if (report.dropped.length) console.log(`would drop:\n  ${[...new Set(report.dropped)].slice(0, 40).join("\n  ")}`);
  process.exit(0);
}
// top-level order with the new sections in place
const ordered = new Map(topOrder.map((id, n) => [id, n]));
const outline = [
  ...items.map((i) => (i.id === sys.id ? { ...i, metadata: { ...i.metadata, oerContentTypes: defs }, modified: true } : !i.parent && ordered.has(i.id) && ordered.get(i.id) !== i.order ? { ...i, order: ordered.get(i.id), modified: true } : i)),
  ...newItems.map((n) => (!n.parent && ordered.has(n.id) ? { ...n, order: ordered.get(n.id) } : n)),
];
const res = await api.call("PATCH", "/x/api/v1/site/outline", { headers: api.headers, body: { site: { name: SITE }, items: outline } });
if (!res.ok) throw new Error(`outline save failed (${res.status}): ${JSON.stringify(res.json).slice(0, 300)}`);
console.log("saved");
await relink();
await describe();
if (report.uploaded.length) console.log(`uploaded ${report.uploaded.length} files`);
if (report.dropped.length) console.log(`not linked:\n  ${[...new Set(report.dropped)].join("\n  ")}`);
