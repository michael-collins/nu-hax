// Raw HTML in the Decap markdown came through the import escaped, so pages
// show it as text: the AIUL badge embed at the end of the DMD 100 reading
// responses' "AI Policy" sections, an example box on "License Examples",
// stray <br>s in some exercises. This turns those tags back into HTML.
// Escaped HTML inside <pre> and <code> is left alone (those are examples
// meant to show as code), and only these tags are restored:
const TAGS = ["a", "img", "br", "div", "p", "h3", "h4", "strong", "em", "span", "ul", "ol", "li"];
// Runs of line breaks collapse to two (the import added one beside each
// escaped "<BR>"). A page whose content carries an AIUL badge (an AIUL-… code linked to
// dmd-program.github.io/aiul) but no AI licence in its fields gets that code,
// so the page footer and its structured data name it too.
//   node --env-file=.env.local scripts/fix-escaped-html.mjs [--dry-run]
// Safe to run again.
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { connect } from "./lib/hax-api.mjs";

const SITE_DIR = process.env.SITE_DIR || new URL("../learning-materials/", import.meta.url).pathname;
const SITE = process.env.HAX_SITE || "learning-materials";
const DRY = process.argv.includes("--dry-run");

const items = JSON.parse(readFileSync(path.join(SITE_DIR, "site.json"), "utf8")).items;
const live = items.filter((i) => !i.metadata?.oerSnapshotOf && i.location && existsSync(path.join(SITE_DIR, i.location)));

const TAG = new RegExp(`&lt;(/?)(${TAGS.join("|")})((?:\\s[^<>]*?)?)\\s*(/?)&gt;`, "gi");
// a block tag the import left inside a <p>: the <p> goes, the block stays
const BLOCK = "div|h3|h4|ul|ol|p";

function restore(html) {
  let n = 0;
  // code stays as written: split it out, fix the rest
  const parts = html.split(/(<pre[\s\S]*?<\/pre>|<code[\s\S]*?<\/code>)/i);
  const fixed = parts
    .map((part, i) => {
      if (i % 2) return part;
      return (
        part
          .replace(TAG, (all, close, tag, attrs, self) => {
            n++;
            // escaped quotes inside attributes come back as quotes
            return `<${close}${tag.toLowerCase()}${attrs.replace(/&quot;/g, '"').replace(/&amp;/g, "&")}${self ? " /" : ""}>`;
          })
          // "<BR><BR>" meant a blank line, and the import already added a
          // line break of its own: no more than two in a row
          .replace(/(?:<br\s*\/?>\s*){3,}/gi, "<br>\n<br>\n")
      );
    })
    .join("");
  const unwrapped = fixed
    .replace(new RegExp(`<p>(\\s*<(?:${BLOCK})\\b)`, "gi"), "$1")
    .replace(new RegExp(`(</(?:${BLOCK})>\\s*)</p>`, "gi"), "$1");
  return { html: unwrapped, n };
}

const report = [];
const saves = [];
const fieldFixes = [];
for (const item of live) {
  const file = path.join(SITE_DIR, item.location);
  const before = readFileSync(file, "utf8");
  const { html, n } = restore(before);
  if (n) {
    report.push(`  ${n} tags  ${item.title}`);
    saves.push({ item, html });
  }
  const code = (html.match(/href="https:\/\/dmd-program\.github\.io\/aiul\/[^"]*"[^>]*>[\s\S]*?(AIUL-[A-Z0-9-]+)/) || [])[1];
  const current = item.metadata?.oerFields?.aiLicense;
  if (code && !(Array.isArray(current) ? current.length : current)) fieldFixes.push({ item, code });
}

console.log(`${saves.length} pages with escaped HTML${DRY ? " (dry run)" : ""}`);
console.log(report.join("\n"));
console.log(`${fieldFixes.length} pages get their AI licence from their AIUL badge: ${[...new Set(fieldFixes.map((f) => f.code))].join(", ")}`);
if (DRY) process.exit(0);

const api = await connect();
for (const { item, html } of saves) {
  const tags = item.metadata?.tags ? String(item.metadata.tags).split(",").map((t) => t.trim()).filter(Boolean) : [];
  const res = await api.saveContent(item.id, html, {
    title: item.title,
    pageType: item.metadata?.pageType || "",
    tags,
    published: item.metadata?.published !== false,
  });
  if (!res.ok) throw new Error(`saving "${item.title}" failed (${res.status})`);
}
if (fieldFixes.length) {
  // the content saves changed site.json: start from the current copy
  const now = JSON.parse(readFileSync(path.join(SITE_DIR, "site.json"), "utf8")).items;
  const out = fieldFixes.map(({ item, code }) => {
    const cur = now.find((i) => i.id === item.id) || item;
    return { ...cur, metadata: { ...cur.metadata, oerFields: { ...(cur.metadata?.oerFields || {}), aiLicense: [code] } }, modified: true };
  });
  const res = await api.call("PATCH", "/x/api/v1/site/outline", { headers: api.headers, body: { site: { name: SITE }, items: out } });
  if (!res.ok) throw new Error(`outline save failed (${res.status}): ${JSON.stringify(res.json).slice(0, 300)}`);
}
console.log(`saved ${saves.length} pages, ${fieldFixes.length} AI licences`);
