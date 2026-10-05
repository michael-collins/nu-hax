// Turn Markdown footnotes left as text ("[^1]" … "[^1]: source") in page
// files into footnote markup with a References list (lib/footnotes.mjs):
//   node scripts/fix-footnotes.mjs [--dry-run]
// Page files are written directly (HAXcms reads them from disk); commit the
// site afterwards.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { footnotesToHtml, hasFootnotes } from "./lib/footnotes.mjs";

const SITE_DIR = new URL("../learning-materials/", import.meta.url).pathname;
const DRY = process.argv.includes("--dry-run");
const items = JSON.parse(readFileSync(path.join(SITE_DIR, "site.json"), "utf8")).items;
let n = 0;
for (const i of items) {
  const file = path.join(SITE_DIR, i.location || "");
  if (!i.location || !existsSync(file)) continue;
  const html = readFileSync(file, "utf8");
  if (!hasFootnotes(html)) continue;
  const out = footnotesToHtml(html, i.id);
  const left = (out.match(/\[\^[\w-]+\]/g) || []).length;
  const notes = (out.match(/<li id="fn-/g) || []).length;
  console.log(`${i.title}: ${notes} notes${left ? `, ${left} markers left as text` : ""}`);
  if (!DRY && out !== html) writeFileSync(file, out);
  n++;
}
console.log(`${n} pages${DRY ? " (dry run)" : ""}`);
