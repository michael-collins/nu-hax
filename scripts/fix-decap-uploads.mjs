// Pages imported from the Decap site that still point at its uploads
// (src="/uploads/dmd100/images/lesson-3/…") show broken images and videos:
// those addresses don't exist here, and the Decap repo keeps the files in
// other folders than the pages say (uploads/dmd100/twinery-btns.png), some
// with markdown escaping in the name ("10\_present.webm"). This copies each
// file into the site's files/ folder and points the pages at it: their
// text, and (since 2026-10-09) their fields in site.json, such as an
// exercise's image or attachments, which it saves through HAX's outline API.
//   node --env-file=.env.local scripts/fix-decap-uploads.mjs [--dry-run]
// HAX_BASE and SITE_DIR point it at another copy (a scratch server). Safe to run again.
import { readFileSync, writeFileSync, existsSync, copyFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { connect } from "./lib/hax-api.mjs";

const DECAP = path.join(process.env.DECAP_DIR || path.resolve("../open-curriculum/oerschema/learning-materials-decapcms"), "public");
const SITE_DIR = process.env.SITE_DIR || new URL("../learning-materials/", import.meta.url).pathname;
const DRY = process.argv.includes("--dry-run");

// every Decap upload, by file name
const byName = new Map();
const walk = (dir) => {
  for (const f of readdirSync(dir)) {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    else byName.set(f.toLowerCase(), [...(byName.get(f.toLowerCase()) || []), p]);
  }
};
walk(path.join(DECAP, "uploads"));

const pagesDir = path.join(SITE_DIR, "pages");
const report = { copied: [], linked: 0, pages: 0, unresolved: new Set() };
const resolved = new Map(); // Decap address → files/<name>
const target = (ref) => {
  if (resolved.has(ref)) return resolved.get(ref);
  const clean = ref.replace(/\\_/g, "_");
  const exact = path.join(DECAP, clean);
  const candidates = existsSync(exact) ? [exact] : byName.get(path.basename(clean).toLowerCase()) || [];
  if (candidates.length !== 1) {
    report.unresolved.add(ref);
    resolved.set(ref, null);
    return null;
  }
  let name = path.basename(candidates[0]);
  const dest = () => path.join(SITE_DIR, "files", name);
  // a different file already under that name: keep both
  if (existsSync(dest()) && readFileSync(dest()).compare(readFileSync(candidates[0])) !== 0) name = `decap-${name}`;
  if (!existsSync(dest())) {
    if (!DRY) copyFileSync(candidates[0], dest());
    report.copied.push(name);
  }
  resolved.set(ref, `files/${name}`);
  return `files/${name}`;
};

// the page (index.html) and the copies HAX keeps of it in other formats
// (index.md, index.xml, index.yaml)
const pageFiles = readdirSync(pagesDir).flatMap((dir) =>
  ["index.html", "index.md", "index.xml", "index.yaml"].map((f) => path.join(pagesDir, dir, f)).filter((f) => existsSync(f)),
);
for (const file of pageFiles) {
  const html = readFileSync(file, "utf8");
  let n = 0;
  const next = html.replace(/((?:src|href|poster)=")(\/uploads\/[^"]+)(")/g, (all, pre, ref, post) => {
    const to = target(ref);
    if (!to) return all;
    n++;
    return `${pre}${to}${post}`;
  });
  if (n) {
    if (file.endsWith("index.html")) report.pages++;
    report.linked += n;
    if (!DRY) writeFileSync(file, next);
  }
}

// fields in site.json: any value that is a Decap address
const items = JSON.parse(readFileSync(path.join(SITE_DIR, "site.json"), "utf8")).items;
const fix = (v) => {
  if (typeof v === "string") {
    if (!v.startsWith("/uploads/")) return v;
    const to = target(v);
    if (to) report.fields++;
    return to || v;
  }
  if (Array.isArray(v)) return v.map(fix);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fix(x)]));
  return v;
};
report.fields = 0;
const changed = [];
for (const item of items) {
  const before = JSON.stringify(item.metadata?.oerFields || {});
  const fields = fix(item.metadata?.oerFields || {});
  if (JSON.stringify(fields) !== before) {
    changed.push({ ...item, metadata: { ...item.metadata, oerFields: fields }, modified: true });
    console.log(`  ${item.title}`);
  }
}

console.log(`${report.linked} links on ${report.pages} pages and ${report.fields} field values on ${changed.length} pages now point at files/; ${report.copied.length} files copied${DRY ? " (dry run)" : ""}`);
if (report.unresolved.size) console.log(`not found in the Decap uploads:\n  ${[...report.unresolved].join("\n  ")}`);
if (!DRY && changed.length) {
  const api = await connect();
  const res = await api.call("PATCH", "/x/api/v1/site/outline", { headers: api.headers, body: { site: { name: process.env.HAX_SITE || "learning-materials" }, items: changed } });
  if (!res.ok) throw new Error(`outline save failed (${res.status}): ${JSON.stringify(res.json).slice(0, 300)}`);
  console.log("fields saved");
}
