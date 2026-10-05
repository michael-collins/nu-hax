// Give every content type an "Authors" field (kind "people": [{ name, url }],
// as learning-materials-decapcms stores `authors`) in place of the legacy
// single `author` / `authorUrl` text fields, and move the values over:
//   node --env-file=.env.local scripts/migrate-authors.mjs [--dry-run]
//
// - Types that have `author` get `authors` (label "Authors", shown in the
//   page header) where `author` was; `author` and `authorUrl` are removed.
// - A page's authors come from its Decap source's `authors` list when it has
//   one (archived versions read their v/<version>.md), otherwise from its
//   own author / authorUrl. The old values are cleared ("": outline saves
//   merge metadata, so leaving a key out would keep it).
// Safe to run again: pages that already have authors are left alone.
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { connect } from "./lib/hax-api.mjs";

const DECAP = process.env.DECAP_DIR || path.resolve("../open-curriculum/oerschema/learning-materials-decapcms");
const SITE_DIR = new URL("../learning-materials/", import.meta.url).pathname;
const SITE = process.env.HAX_SITE || "learning-materials";
const DRY = process.argv.includes("--dry-run");

const site = JSON.parse(readFileSync(path.join(SITE_DIR, "site.json"), "utf8"));
const items = site.items;
const byId = new Map(items.map((i) => [i.id, i]));
const sys = items.find((i) => i.metadata?.pageType === "oer:system");
if (!sys) throw new Error("No content-types page (pageType oer:system) found");
const defs = sys.metadata.oerContentTypes;

// types
let typesChanged = 0;
const nextDefs = {
  ...defs,
  types: defs.types.map((t) => {
    const fields = t.fields || [];
    if (!fields.some((f) => f.name === "author") || fields.some((f) => f.name === "authors")) return t;
    typesChanged++;
    const out = [];
    for (const f of fields) {
      if (f.name === "author") out.push({ name: "authors", label: "Authors", kind: "people", header: true, help: "In order. Each with an optional link to their site or profile." });
      else if (f.name !== "authorUrl") out.push(f);
    }
    return { ...t, fields: out };
  }),
};

// a page's Decap file: the live index.md, or v/<version>.md for an archived copy
function decapFile(item) {
  if (item.metadata?.oerSnapshotOf) {
    const page = byId.get(item.metadata.oerSnapshotOf);
    const src = page?.metadata?.oerSource;
    return src ? path.join(DECAP, "content", src, "v", `${item.metadata.version}.md`) : null;
  }
  return item.metadata?.oerSource ? path.join(DECAP, "content", item.metadata.oerSource, "index.md") : null;
}

function decapAuthors(item) {
  const file = decapFile(item);
  if (!file || !existsSync(file)) return [];
  const list = matter(readFileSync(file, "utf8")).data.authors;
  return (Array.isArray(list) ? list : [])
    .map((a) => (a && typeof a === "object" ? { name: String(a.name || "").trim(), url: String(a.url || "").trim() } : { name: String(a).trim(), url: "" }))
    .filter((a) => a.name);
}

// pages
const report = { decap: 0, legacy: 0, untouched: 0 };
const out = items.map((i) => {
  if (i.id === sys.id) return typesChanged ? { ...i, metadata: { ...i.metadata, oerContentTypes: nextDefs }, modified: true } : i;
  const f = i.metadata?.oerFields;
  if (!f || (!("author" in f) && !("authorUrl" in f))) return i;
  if (Array.isArray(f.authors) && f.authors.length) {
    report.untouched++;
    return i;
  }
  let authors = decapAuthors(i);
  if (authors.length) report.decap++;
  else if (f.author) {
    authors = [{ name: String(f.author).trim(), url: String(f.authorUrl || "").trim() }];
    report.legacy++;
  }
  const fields = { ...f, author: "", authorUrl: "" };
  if (authors.length) fields.authors = authors;
  return { ...i, metadata: { ...i.metadata, oerFields: fields }, modified: true };
});

const changed = out.filter((i) => i.modified).length;
console.log(`${typesChanged} types get an Authors field; ${changed} items change (authors from Decap: ${report.decap}, from author/authorUrl: ${report.legacy}, already set: ${report.untouched})`);
const multi = out.filter((i) => i.modified && (i.metadata?.oerFields?.authors || []).length > 1);
for (const i of multi.slice(0, 20)) console.log(`  ${i.title}: ${i.metadata.oerFields.authors.map((a) => a.name).join(", ")}`);
if (DRY) {
  console.log("dry run: nothing written");
  process.exit(0);
}
const api = await connect();
const res = await api.call("PATCH", "/x/api/v1/site/outline", { headers: api.headers, body: { site: { name: SITE }, items: out } });
if (!res.ok) throw new Error(`outline save failed (${res.status}): ${JSON.stringify(res.json).slice(0, 300)}`);
console.log("saved");
