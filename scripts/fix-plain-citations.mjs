// Citations that never became footnotes, as footnote markup with a
// References list (lib/footnotes.mjs), found by audit-footnotes.mjs:
//
// - plain markers: "[3]" in the text with the sources as a numbered list at
//   the end of the page (optionally under a "Citation(s)"/"References"/
//   "Sources" heading)
// - citation-looking links: <a href="…">^1</a>, whose address is the source
//
// A page's existing footnotes are taken in too, so every note is numbered by
// where it's first cited. FIXES adds what the source pages need by hand:
// markers to remove, and citations for notes the text never cites.
//   node scripts/fix-plain-citations.mjs [--dry-run]
// SITE_DIR points it at another copy. Page files are written directly
// (HAXcms reads them from disk); commit the site afterwards.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { footnotesToHtml } from "./lib/footnotes.mjs";

const SITE_DIR = process.env.SITE_DIR || new URL("../learning-materials/", import.meta.url).pathname;
const DRY = process.argv.includes("--dry-run");

// DMD 100 (checked against the book's VitePress source, dmd-program/dmd-100-book)
const FIXES = {
  // Critical design: notes 7 (the Superstudio photo, credited where the text
  // introduces Superstudio, as the site's other image credits are) and 5
  // (Voros's primer) were never cited; 4 (a lecture) has no clear place and
  // stays listed at the end
  "item-e58e3e63": {
    cite: [
      { after: "an architecture group, called Superstudio", key: "7" },
      { after: 'will better describe the logic behind these "laws."', key: "5" },
    ],
  },
  "item-a9215055": {}, // Digital Multimedia Design
  // Semiotics: a stray "[1]" under the painting, not in the source (note 2 credits it)
  "item-ed6a9c59": { remove: [/<p>\[1\]<\/p>\s*/] },
  "item-7ffaac6d": {}, // What is Design?: the Vitsoe link labelled "^1"
};

const LIST = /(?:<h2>\s*(?:Citations?|References|Sources)\s*<\/h2>\s*)?<ol>((?:(?!<ol>)[\s\S])*?)<\/ol>\s*$/;
const unescapeMd = (s) => s.replace(/\\_/g, "_");

/** The page with every citation as "[^key]" and every note as a "[^key]: …" paragraph. */
function asMarkdownNotes(html, pageId, fix) {
  let s = html;
  const P = pageId.replace(/^item-/, "").slice(0, 8);
  const defs = [];
  // existing footnotes
  s = s.replace(new RegExp(`<sup class="fn-ref" id="fnref-${P}-([\\w-]+?)(?:-\\d+)?"><a href="#fn-${P}-\\1">\\d+</a></sup>`, "g"), "[^$1]");
  s = s.replace(/\s*<section class="footnotes"[\s\S]*?<\/section>\s*/, (sec) => {
    for (const [, key, body] of sec.matchAll(new RegExp(`<li id="fn-${P}-([\\w-]+)">([\\s\\S]*?)</li>`, "g"))) {
      defs.push([key, body.replace(/\s*<a href="#fnref-[^"]*" class="fn-back"[^>]*>[\s\S]*?<\/a>/g, "").trim()]);
    }
    return "\n";
  });
  // links labelled "^1": the address is the note
  s = s.replace(/\s?<a href="([^"#][^"]*)"(?: title="([^"]*)")?>\s*\^(\d{1,3})\s*<\/a>/g, (all, href, title, key) => {
    if (!defs.some(([k]) => k === key)) defs.push([key, `<a href="${href}">${href}</a>${title ? ` (${title})` : ""}`]);
    return `[^${key}]`;
  });
  // plain markers, with the sources as the list at the end
  const list = s.match(LIST);
  const sources = list ? [...list[1].matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => unescapeMd(m[1].trim())) : [];
  if (sources.length && /\[\d{1,3}\]/.test(s.slice(0, list.index))) {
    s = s.slice(0, list.index).replace(/ ?\[(\d{1,3})\]/g, (all, n) => (+n >= 1 && +n <= sources.length ? `[^${n}]` : all)) + "\n";
    sources.forEach((body, i) => defs.push([String(i + 1), body]));
  }
  for (const re of fix.remove || []) s = s.replace(re, "");
  for (const { after, key } of fix.cite || []) {
    if (s.includes(`[^${key}]`)) continue; // cited already (run before)
    if (!s.includes(after)) throw new Error(`${pageId}: can't find where to cite note ${key}: ${after}`);
    s = s.replace(after, `${after}[^${key}]`);
  }
  if (!defs.length) return s;
  return `${s.replace(/\s*$/, "\n")}${defs.map(([k, body]) => `<p>[^${k}]: ${body}</p>`).join("\n")}\n`;
}

const items = JSON.parse(readFileSync(path.join(SITE_DIR, "site.json"), "utf8")).items;
for (const [prefix, fix] of Object.entries(FIXES)) {
  const page = items.find((i) => i.id.startsWith(prefix) && !i.metadata?.oerSnapshotOf);
  const file = page?.location && path.join(SITE_DIR, page.location);
  if (!file || !existsSync(file)) {
    console.log(`${prefix}: not found`);
    continue;
  }
  const html = readFileSync(file, "utf8");
  const out = footnotesToHtml(asMarkdownNotes(html, page.id, fix), page.id);
  const cites = (out.match(/<sup class="fn-ref"/g) || []).length;
  const notes = (out.match(/<li id="fn-/g) || []).length;
  const left = (out.match(/\[\^?\d{1,3}\]/g) || []).length;
  console.log(`${page.title}: ${cites} citations, ${notes} notes${left ? `, ${left} markers left as text` : ""}${out === html ? " (no change)" : ""}`);
  if (!DRY && out !== html) writeFileSync(file, out);
}
if (DRY) console.log("(dry run)");
