// Footnotes and citations check for a book's pages (or the whole site):
// citations whose note is missing, notes nobody cites, back-links that go
// nowhere, in-page links to ids that don't exist, citation markers left as
// plain text ("[1]", "<sup>1</sup>", Markdown "[^1]"), links to a source
// labelled "^1", and duplicate ids.
// Read-only: it reports, it doesn't change pages.
//   node scripts/audit-footnotes.mjs --book "DMD 100" [--json out.json]
//   node scripts/audit-footnotes.mjs --all
// A chapter that shows another page (oer-include, a linked chapter) is
// checked as that page, once.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";

const SITE_DIR = process.env.SITE_DIR || new URL("../learning-materials/", import.meta.url).pathname;
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : null;
};
const BOOK = arg("--book");
const JSON_OUT = arg("--json");
const ALL = process.argv.includes("--all");

const items = JSON.parse(readFileSync(path.join(SITE_DIR, "site.json"), "utf8")).items;
const byId = new Map(items.map((i) => [i.id, i]));
const isSnap = (i) => !!i?.metadata?.oerSnapshotOf;

function pagesToCheck() {
  if (ALL) return items.filter((i) => !isSnap(i) && i.location);
  const book = items.find((i) => i.metadata?.pageType === "oer:book" && !isSnap(i) && i.title.toLowerCase().startsWith(String(BOOK || "").toLowerCase()));
  if (!book) throw new Error(`No book whose title starts with "${BOOK}". Use --book "<title>" or --all.`);
  const kids = new Map();
  for (const i of items) if (!isSnap(i)) kids.set(i.parent || null, [...(kids.get(i.parent || null) || []), i]);
  const out = [book];
  const walk = (id) => {
    for (const c of (kids.get(id) || []).sort((a, b) => (+a.order || 0) - (+b.order || 0))) {
      out.push(c);
      walk(c.id);
    }
  };
  walk(book.id);
  return out;
}

const snippet = (node, marker) => {
  const text = (node.parentElement?.textContent || node.textContent || "").replace(/\s+/g, " ").trim();
  const at = Math.max(0, text.indexOf(marker));
  return `…${text.slice(Math.max(0, at - 50), at + marker.length + 30)}…`;
};

function audit(html) {
  const doc = new JSDOM(`<body>${html}</body>`).window.document;
  const body = doc.body;
  const ids = new Map();
  for (const el of body.querySelectorAll("[id]")) ids.set(el.id, (ids.get(el.id) || 0) + 1);
  const has = (id) => ids.has(id);
  const issues = [];
  const add = (kind, detail) => issues.push({ kind, ...detail });

  // citations and other in-page links
  const cited = new Set();
  for (const a of body.querySelectorAll('a[href^="#"]')) {
    const id = decodeURIComponent(a.getAttribute("href").slice(1));
    if (!id) continue;
    cited.add(id);
    if (has(id)) continue;
    if (a.closest("sup.fn-ref")) add("citation with no note", { marker: a.textContent.trim(), target: id, context: snippet(a.closest("sup"), a.textContent.trim()) });
    else if (a.classList.contains("fn-back")) add("back-link to a missing citation", { target: id, context: (a.closest("li")?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 90) });
    else add("in-page link to a missing id", { marker: a.textContent.trim().slice(0, 40), target: id });
  }
  // notes nobody cites
  for (const li of body.querySelectorAll("section.footnotes li[id], ol.footnotes li[id], li[id^='fn']")) {
    if (!cited.has(li.id)) add("note nobody cites", { target: li.id, context: li.textContent.replace(/\s+/g, " ").trim().slice(0, 90) });
  }
  // markers left as text: "[1]", "[^1]", "<sup>1</sup>" outside citation markup and the notes list
  const walker = doc.createTreeWalker(body, 4 /* text */);
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    if (t.parentElement?.closest("sup.fn-ref, section.footnotes, ol.footnotes, code, pre, a")) continue;
    for (const m of t.textContent.matchAll(/\[\^[\w-]+\]:?|\[(\d{1,3})\]/g)) {
      add(m[0].startsWith("[^") ? "Markdown footnote left as text" : "citation number left as text", { marker: m[0], context: snippet(t, m[0]) });
    }
  }
  for (const sup of body.querySelectorAll("sup")) {
    if (sup.classList.contains("fn-ref") || sup.closest("section.footnotes")) continue;
    if (/^\s*\[?\d{1,3}\]?\s*$/.test(sup.textContent) && !sup.querySelector("a")) add("superscript number with no link", { marker: sup.textContent.trim(), context: snippet(sup, sup.textContent.trim()) });
  }
  // links to a source labelled like a citation ("^1", "[1]") instead of being one
  for (const a of body.querySelectorAll("a[href]")) {
    if (a.closest("sup.fn-ref, section.footnotes") || a.getAttribute("href").startsWith("#")) continue;
    if (/^\s*(\^\d{1,3}|\[\^?\d{1,3}\])\s*$/.test(a.textContent)) add("link labelled as a citation", { marker: a.textContent.trim(), context: snippet(a, a.textContent.trim()) });
  }
  for (const [id, n] of ids) if (n > 1) add("duplicate id", { target: id, count: n });
  const notes = body.querySelectorAll("section.footnotes li").length;
  const citations = body.querySelectorAll("sup.fn-ref").length;
  return { issues, notes, citations };
}

const report = [];
const seen = new Set();
for (const page of pagesToCheck()) {
  const source = page.metadata?.oerRef?.page ? byId.get(page.metadata.oerRef.page) || page : page;
  if (seen.has(source.id)) continue;
  seen.add(source.id);
  const file = path.join(SITE_DIR, source.location || "");
  if (!source.location || !existsSync(file)) continue;
  const { issues, notes, citations } = audit(readFileSync(file, "utf8"));
  report.push({ title: source.title, slug: source.slug, id: source.id, via: source === page ? null : page.title, draft: source.metadata?.published === false, citations, notes, issues });
}

const withIssues = report.filter((r) => r.issues.length);
const kinds = {};
for (const r of report) for (const i of r.issues) kinds[i.kind] = (kinds[i.kind] || 0) + 1;
console.log(`${report.length} pages checked; ${withIssues.length} with problems; ${report.reduce((n, r) => n + r.citations, 0)} citations, ${report.reduce((n, r) => n + r.notes, 0)} notes`);
for (const [k, n] of Object.entries(kinds).sort((a, b) => b[1] - a[1])) console.log(`  ${n} × ${k}`);
for (const r of withIssues) {
  console.log(`\n${r.title}${r.draft ? " (draft)" : ""} — /${r.slug}`);
  for (const i of r.issues.slice(0, 12)) console.log(`  · ${i.kind}${i.marker ? ` ${i.marker}` : ""}${i.target ? ` (${i.target})` : ""}${i.context ? `: ${i.context}` : ""}`);
  if (r.issues.length > 12) console.log(`  … ${r.issues.length - 12} more`);
}
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(report, null, 2));
