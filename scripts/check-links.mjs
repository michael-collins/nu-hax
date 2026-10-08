// The site's links, from the command line: the same analysis as Site tab →
// Check links (learning-materials/custom/src/links/), as a report. It reads
// site.json and the pages from disk and changes nothing.
//   node scripts/check-links.mjs                 old-site links with pages here, links here that go nowhere
//   node scripts/check-links.mjs --check         and whether outside links still work (network)
//   node scripts/check-links.mjs --json r.json   the whole report as JSON
// SITE_DIR points it at another copy of the site.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { addressIndex, analyseLink, linksIn, courseCode } from "../learning-materials/custom/src/links/link-model.js";
import { checkLinks } from "./lib/link-check.mjs";

const SITE_DIR = process.env.SITE_DIR || new URL("../learning-materials/", import.meta.url).pathname;
const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : "");

const items = JSON.parse(readFileSync(path.join(SITE_DIR, "site.json"), "utf8")).items;
const index = addressIndex(items);
const records = new Map();
let pages = 0;
for (const item of items.filter((i) => i.location && !i.metadata?.oerSnapshotOf && !["oer:system", "oer:sequence"].includes(i.metadata?.pageType))) {
  const file = path.join(SITE_DIR, item.location);
  if (!existsSync(file)) continue;
  pages++;
  const hint = courseCode(item.metadata?.oerSource || "");
  for (const { url, tag } of linksIn(readFileSync(file, "utf8"))) {
    const info = analyseLink(url, index, { hint, tag });
    if (!info || info.kind === "site") continue;
    const key = info.kind === "broken" && hint ? `${hint}::${url}` : url;
    const rec = records.get(key) || { ...info, key, uses: [] };
    rec.uses.push(item.slug);
    records.set(key, rec);
  }
}
const links = [...records.values()];
if (args.includes("--check")) {
  const urls = [...new Set(links.filter((l) => !l.match && /^https?:/i.test(l.url)).map((l) => l.url))];
  let n = 0;
  process.stderr.write(`checking ${urls.length} links…\n`);
  const results = new Map((await checkLinks(urls, { onResult: () => ++n % 50 === 0 && process.stderr.write(`  ${n} of ${urls.length}\n`) })).map((r) => [r.url, r]));
  for (const l of links) if (results.has(l.url)) l.check = results.get(l.url);
}

const where = (l) => `${l.uses.length === 1 ? l.uses[0] : `${l.uses[0]} and ${l.uses.length - 1} more`}`;
const section = (title, list, line) => {
  if (!list.length) return;
  console.log(`\n${title} (${list.length})`);
  for (const l of list) console.log(`  ${line(l)}\n      on ${where(l)}`);
};
console.log(`${pages} pages, ${links.length} links that aren't to working pages here`);
section("Old site → the page here", links.filter((l) => l.match), (l) => `${l.url}\n    → ${l.match.slug}`);
section("Might be a page here", links.filter((l) => !l.match && l.candidates.length), (l) => `${l.url}\n    ? ${l.candidates.map((c) => `${c.slug} (${Math.round(c.score * 100)}%)`).join(", ")}`);
section("Written wrong", links.filter((l) => l.fix), (l) => `${l.url}\n    → ${l.fix}`);
section("Links here that go nowhere", links.filter((l) => l.kind === "broken" && !l.fix && !l.candidates.length), (l) => l.url);
for (const [status, title] of [
  ["dead", "Not working"],
  ["moved", "Moved"],
  ["private", "Need a sign-in"],
  ["unknown", "Couldn't check"],
]) {
  section(title, links.filter((l) => l.check?.status === status), (l) => `${l.url}  (${l.check.note}${l.check.final ? ` → ${l.check.final}` : ""}${l.check.archive ? `; archived ${l.check.archive.date}: ${l.check.archive.url}` : ""})`);
}
if (opt("--json")) {
  writeFileSync(opt("--json"), JSON.stringify(links, null, 2));
  console.log(`\nreport written to ${opt("--json")}`);
}
