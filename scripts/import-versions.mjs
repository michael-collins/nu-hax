// Bring learning-materials-decapcms' version history into the HAXcms site:
//   node --env-file=.env.local scripts/import-versions.mjs [--dry-run]
//
// For every site page that came from Decap (metadata.oerSource, or the three
// seeded pages matched by title and type):
// - the page's metadata.version becomes Decap's current `version`, recorded in
//   metadata.oerVersions (with Decap's `changelog` as the notes)
// - each archived version (content/<collection>/<slug>/v/<version>.md) becomes
//   a release snapshot as versions/versioning.js makes them: a hidden, locked
//   child page "v0.9.0" with oerSnapshotOf, version, versionStatus "archived",
//   that version's fields and its body converted from markdown
// Versions the site already has are skipped, so it is safe to run again.
import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { connect } from "./lib/hax-api.mjs";
import { decapMarkdownToHtml } from "./lib/decap-md.mjs";

const DECAP = process.env.DECAP_DIR || path.resolve("../learning-materials-decapcms");
const SITE_DIR = new URL("../learning-materials/", import.meta.url).pathname;
const SITE = process.env.HAX_SITE || "learning-materials";
const DRY = process.argv.includes("--dry-run");

const COLLECTION_OF = { "oer:lesson": "lessons", "oer:exercise": "exercises", "oer:project": "projects", "oer:lecture": "lectures", "oer:tutorial": "tutorials", "oer:pathway": "pathways", "oer:article": "articles" };

const site = JSON.parse(readFileSync(path.join(SITE_DIR, "site.json"), "utf8"));
const items = site.items;
const types = items.find((i) => i.metadata?.pageType === "oer:system")?.metadata?.oerContentTypes?.types || [];
const typeDef = (id) => types.find((t) => t.id === id) || { fields: [] };
const parseVersion = (v) => String(v || "").match(/^(\d+)\.(\d+)\.(\d+)$/)?.slice(1).map(Number) || null;
const compare = (a, b) => {
  const x = parseVersion(a) || [0, 0, 0];
  const y = parseVersion(b) || [0, 0, 0];
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
};
const toList = (v) => (Array.isArray(v) ? v : v === undefined || v === null || v === "" ? [] : [v]).map((x) => String(x));

// Decap ref ("lessons/slug") → site page id
const idBySource = new Map(items.filter((i) => i.metadata?.oerSource && !i.metadata?.oerSnapshotOf).map((i) => [i.metadata.oerSource, i.id]));

// the Decap source of a site page
function sourceOf(item) {
  if (item.metadata?.oerSource) return item.metadata.oerSource;
  const collection = COLLECTION_OF[item.metadata?.pageType];
  if (!collection || !existsSync(path.join(DECAP, "content", collection))) return null;
  for (const slug of readdirSync(path.join(DECAP, "content", collection))) {
    const file = path.join(DECAP, "content", collection, slug, "index.md");
    if (existsSync(file) && matter(readFileSync(file, "utf8")).data.title?.toLowerCase() === item.title.toLowerCase()) return `${collection}/${slug}`;
  }
  return null;
}

// /uploads/x → files/x when the site has that file (imports uploaded them)
const siteFile = (src) => {
  if (!String(src || "").startsWith("/uploads/")) return src;
  const name = path.basename(src);
  return existsSync(path.join(SITE_DIR, "files", name)) ? `files/${name}` : src;
};
const inlineFiles = (md) => String(md).replace(/\/uploads\/[^\s)"'<>]+/g, (src) => siteFile(src));

function decapRefs(list) {
  return (Array.isArray(list) ? list : []).flatMap((r) => {
    if (!r || typeof r !== "object") return [];
    const key = Object.keys(r).find((k) => k !== "__typename" && !k.endsWith("_version"));
    const version = Object.entries(r).find(([k]) => k.endsWith("_version"))?.[1];
    return key ? [{ ref: `${r.__typename}/${r[key]}`, version: version && version !== "latest" ? String(version) : "" }] : [];
  });
}

// a version's field values, mapped like the import does; what the version
// doesn't say falls back to the live page's value
function fieldsFor(typeId, fm, live) {
  const out = { ...(live || {}) };
  for (const f of typeDef(typeId).fields) {
    let v = fm[f.name];
    if (v === undefined || v === null || v === "") continue;
    if (f.kind === "relation") {
      const links = decapRefs(v).flatMap(({ ref, version }) => (idBySource.get(ref) ? [{ page: idBySource.get(ref), version }] : []));
      out[f.name] = links;
      continue;
    }
    if (f.kind === "files") {
      out[f.name] = (Array.isArray(v) ? v : [])
        .map((a) => ({ title: a.title || "", url: a.file ? siteFile(a.file) : a.url || "", description: a.description || "", alt: a.alt || "" }))
        .filter((a) => a.url || a.title);
      continue;
    }
    if (f.kind === "list" || (f.kind === "select" && f.multiple)) v = toList(v);
    else if (f.kind === "boolean") v = !!v;
    else if (f.kind === "number") v = Number(v);
    else if (f.kind === "image") v = siteFile(v);
    else if (f.kind === "date") v = v instanceof Date ? v.toISOString() : String(v);
    else v = Array.isArray(v) ? v.join(", ") : String(v);
    out[f.name] = v;
  }
  return out;
}

const api = DRY ? null : await connect();
const changed = new Map();
const newItems = [];
const report = [];

for (const page of items) {
  // linked chapters (oerRef) show their source page, which holds the versions
  if (page.metadata?.oerSnapshotOf || page.metadata?.oerRef || !page.metadata?.pageType) continue;
  const source = sourceOf(page);
  if (!source) continue;
  const indexFile = path.join(DECAP, "content", source, "index.md");
  if (!existsSync(indexFile)) continue;
  const current = matter(readFileSync(indexFile, "utf8")).data;
  const vDir = path.join(DECAP, "content", source, "v");
  const archived = existsSync(vDir) ? readdirSync(vDir).filter((f) => /^\d+\.\d+\.\d+\.md$/.test(f)) : [];
  if (!parseVersion(current.version) && !archived.length) continue;

  const existing = new Set(items.filter((i) => i.metadata?.oerSnapshotOf === page.id).map((i) => i.metadata.version));
  const records = [...(page.metadata?.oerVersions || [])];
  const has = (v) => records.some((r) => r.version === v);
  const siblings = items.filter((i) => i.parent === page.id).length;
  let added = 0;

  for (const file of archived.sort((a, b) => compare(a.replace(/\.md$/, ""), b.replace(/\.md$/, "")))) {
    const version = file.replace(/\.md$/, "");
    if (existing.has(version)) continue;
    const entry = matter(readFileSync(path.join(vDir, file), "utf8"));
    let body = entry.content.trim() ? (DRY ? "" : await decapMarkdownToHtml(api, inlineFiles(entry.content))) : "<p></p>";
    if (page.metadata.pageType === "oer:pathway") body = `<oer-pathway layout="matrix"></oer-pathway>\n${body}`;
    newItems.push({
      id: `item-version-${page.id.slice(5, 13)}-${version}`,
      title: `v${version}`,
      parent: page.id,
      order: siblings + 1000 + added,
      indent: (Number(page.indent) || 0) + 1,
      location: "",
      description: entry.data.description || page.description || "",
      metadata: {
        pageType: page.metadata.pageType,
        oerFields: fieldsFor(page.metadata.pageType, entry.data, page.metadata.oerFields),
        ...(page.metadata.icon ? { icon: page.metadata.icon } : {}),
        oerSnapshotOf: page.id,
        oerSnapshotTitle: entry.data.title || page.title,
        version,
        versionStatus: "archived",
        hideInMenu: true,
        locked: true,
        published: page.metadata.published !== false,
      },
      contents: body,
      new: true,
    });
    if (!has(version)) records.push({ version, date: entry.data.date ? Math.floor(new Date(entry.data.date).getTime() / 1000) : null, notes: entry.data.changelog ? String(entry.data.changelog) : "" });
    added++;
  }

  let version = page.metadata.version || "";
  if (parseVersion(current.version) && !has(current.version)) {
    records.push({ version: current.version, date: current.date ? Math.floor(new Date(current.date).getTime() / 1000) : null, notes: current.changelog ? String(current.changelog) : "" });
  }
  // the page's version is the newest one Decap calls current or released
  const newest = [current.version, ...records.map((r) => r.version)].filter(parseVersion).sort(compare).pop() || version;
  records.sort((a, b) => compare(b.version, a.version));
  const recordsChanged = JSON.stringify(records) !== JSON.stringify(page.metadata?.oerVersions || []);
  if (newest !== version || recordsChanged) {
    changed.set(page.id, { ...page, metadata: { ...page.metadata, version: newest, oerVersions: records }, modified: true });
  }
  if (added || newest !== version) report.push(`${page.title}: v${newest}${added ? `, ${added} archived` : ""}`);
}

console.log(`${changed.size} pages get version data, ${newItems.length} archived versions to add`);
for (const line of report.slice(0, 60)) console.log(`  ${line}`);
if (DRY) {
  console.log("dry run: nothing written");
  process.exit(0);
}
if (!changed.size && !newItems.length) process.exit(0);
const outline = [...items.map((i) => changed.get(i.id) || i), ...newItems];
const res = await api.call("PATCH", "/x/api/v1/site/outline", { headers: api.headers, body: { site: { name: SITE }, items: outline } });
if (!res.ok) throw new Error(`outline save failed (${res.status}): ${JSON.stringify(res.json).slice(0, 300)}`);
console.log("saved");

// outline saves drop descriptions: set the snapshots' one by one
const after = JSON.parse(readFileSync(path.join(SITE_DIR, "site.json"), "utf8")).items;
let described = 0;
for (const planned of newItems) {
  const real = after.find((i) => i.metadata?.oerSnapshotOf === planned.metadata.oerSnapshotOf && i.metadata?.version === planned.metadata.version);
  if (!real || !planned.description || real.description === planned.description) continue;
  const r = await api.updateItem(real.id, "setDescription", { description: planned.description });
  if (r.ok) described++;
}
if (described) console.log(`set ${described} descriptions`);
