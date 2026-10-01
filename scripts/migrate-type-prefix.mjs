// Prefix the site's content type ids with "oer:" (lesson → oer:lesson,
// oer-system → oer:system), so metadata.pageType can't collide with HAX's own
// page-break values (lesson, project…, which carry HAX icons and labels).
//   node --env-file=.env.local scripts/migrate-type-prefix.mjs [--dry-run]
//
// Rewrites, in one outline save:
// - each page's metadata.pageType (only values that are our type ids)
// - the type definitions: ids, allowed children, relation fields' types
// - `types="…"` on oer-collection blocks in page HTML (written to disk first,
//   so the outline save's commit includes them)
// Safe to run again: prefixed ids are left alone.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { connect } from "./lib/hax-api.mjs";

const SITE_DIR = new URL("../learning-materials/", import.meta.url).pathname;
const SITE = process.env.HAX_SITE || "learning-materials";
const DRY = process.argv.includes("--dry-run");
const PREFIX = "oer:";

const site = JSON.parse(readFileSync(path.join(SITE_DIR, "site.json"), "utf8"));
const items = site.items;
const sys = items.find((i) => i.metadata?.pageType === "oer-system" || i.metadata?.pageType === "oer:system");
if (!sys) throw new Error("No content-types page (pageType oer-system) found");
const defs = sys.metadata.oerContentTypes;

const ours = new Set(defs.types.map((t) => t.id));
const map = (id) => {
  if (!id || String(id).startsWith(PREFIX)) return id;
  if (id === "oer-system") return "oer:system";
  return ours.has(id) ? PREFIX + id : id;
};

// definitions
const nextDefs = {
  ...defs,
  types: defs.types.map((t) => ({
    ...t,
    id: map(t.id),
    children: Array.isArray(t.children) ? t.children.map(map) : t.children,
    fields: (t.fields || []).map((f) => (Array.isArray(f.types) ? { ...f, types: f.types.map(map) } : f)),
  })),
};

// pages
let pagesChanged = 0;
const out = items.map((i) => {
  const type = i.metadata?.pageType;
  const isSys = i.id === sys.id;
  const nextType = isSys ? "oer:system" : map(type);
  if (!isSys && nextType === type) return i;
  pagesChanged++;
  const metadata = { ...i.metadata, pageType: nextType };
  if (isSys) metadata.oerContentTypes = nextDefs;
  return { ...i, metadata, modified: true };
});

// oer-collection types="…" in page HTML
const files = [];
for (const i of items) {
  const file = path.join(SITE_DIR, i.location || "");
  if (!i.location || !existsSync(file)) continue;
  const html = readFileSync(file, "utf8");
  const next = html.replace(/(<oer-collection\b[^>]*\btypes=")([^"]*)(")/g, (all, a, list, b) =>
    a + list.split(",").map((s) => map(s.trim())).filter(Boolean).join(",") + b,
  );
  if (next !== html) files.push([file, next, i.title]);
}

console.log(`${defs.types.length} types, ${pagesChanged} pages, ${files.length} page files with collection blocks`);
console.log("types:", nextDefs.types.map((t) => t.id).join(", "));
if (DRY) {
  console.log("dry run: nothing written");
  process.exit(0);
}
for (const [file, next] of files) writeFileSync(file, next);
const api = await connect();
const res = await api.call("PATCH", "/x/api/v1/site/outline", { headers: api.headers, body: { site: { name: SITE }, items: out } });
if (!res.ok) throw new Error(`outline save failed (${res.status}): ${JSON.stringify(res.json).slice(0, 300)}`);
console.log("saved");
