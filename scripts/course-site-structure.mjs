// Course sites and OER Courses move onto the section and item model (the
// editor redesign, docs/editor-redesign/spec.md §5.9): a section's heading
// is an <h2> typed in it (the hub's intro, an <h1>), and What you'll learn,
// the tools and the questions hold items of their own (<oer-cs-outcome>,
// <oer-cs-tool>, <oer-cs-question>) instead of a list or headings and
// answers. The editor upgrades a section this way as editing begins; this
// does the same to each course site's and the hub's saved page, with the
// editor's own conversions (custom/src/blocks/course-site/cs-normalize.js in
// the site at SITE_DIR), and without the empty headings and fields editing
// adds to type into. Only the sections change: blocks between them are kept
// byte for byte. Versions keep what they were (readers still read it).
//   node --env-file=.env.local scripts/course-site-structure.mjs           what would change, as a diff
//   node --env-file=.env.local scripts/course-site-structure.mjs --apply   and save it
// HAX_BASE and SITE_DIR point it at another copy, both or neither (a
// scratch server, which with HAX_TOKENLESS=1 needs no password); --apply
// first checks that the server's pages are SITE_DIR's. Safe to run again:
// an upgraded page is left alone.
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { JSDOM } from "jsdom";
import { connect } from "./lib/hax-api.mjs";

// the pages are read from SITE_DIR and saved through HAX_BASE: the same
// copy, so never one set without the other
if (!process.env.SITE_DIR !== !process.env.HAX_BASE) throw new Error("Set both HAX_BASE and SITE_DIR (the same copy of the site), or neither");
const SITE_DIR = process.env.SITE_DIR || new URL("../learning-materials/", import.meta.url).pathname;
const SITE = process.env.HAX_SITE || "learning-materials";
const APPLY = process.argv.includes("--apply");
const MICROSITES = ["oer:course-site", "oer:course-hub"];
// each section's heading, as its block's headingTag says: the hub intro's
// an h1, none for those whose heading isn't typed (the hero's is the
// course's name), and the rest an h2
const HEADING = { "oer-courses-intro": "h1", "oer-cs-hero": null, "oer-cs-facts": null, "oer-courses-catalog": null };
const ITEMS = new Set(["oer-cs-outcome", "oer-cs-tool", "oer-cs-question"]);
const isSection = (el) => /^oer-(cs|courses)-/.test(el.localName) && !ITEMS.has(el.localName);

// the editor's conversions, from the site's own theme
const normalizeFile = path.join(SITE_DIR, "custom/src/blocks/course-site/cs-normalize.js");
if (!existsSync(normalizeFile)) throw new Error(`No ${normalizeFile}: SITE_DIR must be a checkout of the site`);
const normalize = await import(pathToFileURL(normalizeFile).href);
if (!normalize.ITEMS_FROM) throw new Error("This site's theme doesn't have the section and item model yet (cs-normalize.js ITEMS_FROM): merge it first");

/** A section as editing upgrades it: its items, then its heading attribute as its heading. Returns whether it changed. */
function upgrade(section) {
  let changed = normalize.ITEMS_FROM[section.localName]?.(section) || false;
  const tag = section.localName in HEADING ? HEADING[section.localName] : "h2";
  if (tag) {
    const heading = section.localName === "oer-cs-faq" ? normalize.faqHeading(section) : [...section.children].find((c) => c.localName === tag) || null;
    changed = normalize.headingFromAttribute(section, tag, heading) || changed;
  }
  return changed;
}

/** A page's HTML with its sections upgraded, each in its own place; and the sections that changed. */
function upgradePage(html) {
  const dom = new JSDOM(html, { includeNodeLocations: true });
  // (cs-normalize.js walks text with the browser's NodeFilter)
  globalThis.NodeFilter ??= dom.window.NodeFilter;
  const edits = [];
  for (const el of [...dom.window.document.body.children].filter(isSection)) {
    const { startOffset, endOffset } = dom.nodeLocation(el);
    if (upgrade(el)) edits.push({ startOffset, endOffset, text: el.outerHTML, tag: el.localName });
  }
  let out = html;
  // from the last, so the offsets before each still hold
  for (const e of [...edits].reverse()) out = out.slice(0, e.startOffset) + e.text + out.slice(e.endOffset);
  return { html: out, sections: edits.map((e) => e.tag) };
}

/** The lines of a and b that differ, with a line of context either side, as "  ", "- " and "+ " lines (the longest common run kept). */
function diff(a, b) {
  const x = a.split("\n");
  const y = b.split("\n");
  const lcs = Array.from({ length: x.length + 1 }, () => new Array(y.length + 1).fill(0));
  for (let i = x.length - 1; i >= 0; i--) for (let j = y.length - 1; j >= 0; j--) lcs[i][j] = x[i] === y[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const lines = [];
  let i = 0;
  let j = 0;
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && x[i] === y[j]) {
      lines.push(["  ", x[i++]]);
      j++;
    } else if (i < x.length && (j === y.length || lcs[i + 1][j] >= lcs[i][j + 1])) lines.push(["- ", x[i++]]);
    else lines.push(["+ ", y[j++]]);
  }
  const near = (k) => lines.slice(Math.max(0, k - 1), k + 2).some(([mark]) => mark !== "  ");
  return lines.filter(([mark], k) => mark !== "  " || near(k)).map(([mark, line]) => `    ${mark}${line}`);
}

const items = JSON.parse(readFileSync(path.join(SITE_DIR, "site.json"), "utf8")).items;
const out = [];
const pages = items.filter((i) => MICROSITES.includes(i.metadata?.pageType) && !i.metadata?.oerSnapshotOf);
for (const page of pages) {
  const file = path.join(SITE_DIR, page.location || "");
  const html = existsSync(file) ? readFileSync(file, "utf8") : "";
  const { html: upgraded, sections } = upgradePage(html);
  if (!sections.length) {
    console.log(`/${page.slug}: already in the section model`);
    continue;
  }
  console.log(`/${page.slug}: ${sections.join(", ")}`);
  for (const line of diff(html, upgraded)) console.log(line);
  out.push({ ...page, contents: upgraded, metadata: { ...page.metadata, overridePathauto: true }, modified: true });
}

console.log(`${pages.length} page(s) checked, ${out.length} to save${APPLY ? "" : " (a dry run: --apply saves them)"}`);
if (!APPLY || !out.length) process.exit(0);
const api = await connect();
// the server's pages are the ones read here (as last saved), or nothing is saved
const served = await api.call("GET", `/site.json?t=${Date.now()}`);
const byId = new Map((served.json?.items || []).map((i) => [i.id, i]));
const stale = out.filter((p) => byId.get(p.id)?.location !== p.location || byId.get(p.id)?.metadata?.updated !== p.metadata?.updated);
if (!served.ok || stale.length) throw new Error(`The server isn't serving SITE_DIR's pages (${served.ok ? stale.map((p) => `/${p.slug}`).join(", ") : `site.json: ${served.status}`}): nothing saved`);
const res = await api.call("PATCH", "/x/api/v1/site/outline", { headers: api.headers, body: { site: { name: SITE }, items: out } });
if (!res.ok) throw new Error(`outline save failed (${res.status}): ${JSON.stringify(res.json).slice(0, 300)}`);
console.log("saved");
