// Record which Resources each page cites (metadata.oerCites), from the
// References in its saved HTML (li[data-resource]), so Resource pages can
// list "Cited by". The editor does this on every save; this catches pages
// saved before it existed or edited outside the editor.
//   node --env-file=.env.local scripts/backfill-citations.mjs [--link] [--dry-run]
//
// --link also links references to a Resource whose link is the same as the
// reference's first link (writing data-resource into the page file), the
// same match the Cite dialog offers.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { connect } from "./lib/hax-api.mjs";

const SITE_DIR = new URL("../learning-materials/", import.meta.url).pathname;
const DRY = process.argv.includes("--dry-run");
const LINK = process.argv.includes("--link");
const items = JSON.parse(readFileSync(path.join(SITE_DIR, "site.json"), "utf8")).items;
const normUrl = (u) => String(u || "").trim().toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/[#?].*$/, "").replace(/\/+$/, "");
const resourceByUrl = new Map(
  items.filter((i) => i.metadata?.pageType === "oer:resource" && i.metadata?.oerFields?.url).map((i) => [normUrl(i.metadata.oerFields.url), i.id]),
);

const changed = [];
let linked = 0;
for (const i of items) {
  const file = path.join(SITE_DIR, i.location || "");
  if (!i.location || !existsSync(file)) continue;
  let html = readFileSync(file, "utf8");
  if (!html.includes('class="footnotes"')) {
    if ((i.metadata?.oerCites || []).length) changed.push({ ...i, metadata: { ...i.metadata, oerCites: [] }, modified: true });
    continue;
  }
  if (LINK) {
    html = html.replace(/<li id="(fn-[^"]+)"([^>]*)>([\s\S]*?)<\/li>/g, (all, id, attrs, body) => {
      if (/data-resource=/.test(attrs)) return all;
      const href = (body.match(/<a href="(https?:[^"]+)"/) || [])[1];
      const res = href && resourceByUrl.get(normUrl(href));
      if (!res) return all;
      linked++;
      return `<li id="${id}"${attrs} data-resource="${res}">${body}</li>`;
    });
    if (!DRY) writeFileSync(file, html);
  }
  const section = html.slice(html.indexOf('class="footnotes"'));
  const cites = [...new Set([...section.matchAll(/data-resource="([^"]+)"/g)].map((m) => m[1]))];
  if (JSON.stringify(cites) !== JSON.stringify(i.metadata?.oerCites || [])) changed.push({ ...i, metadata: { ...i.metadata, oerCites: cites }, modified: true });
}
console.log(`${LINK ? `${linked} references linked to Resources; ` : ""}${changed.length} pages get oerCites${DRY ? " (dry run)" : ""}`);
for (const c of changed.slice(0, 20)) console.log(`  ${c.title}: ${c.metadata.oerCites.length} resources`);
if (DRY || !changed.length) process.exit(0);
const api = await connect();
const res = await api.call("PATCH", "/x/api/v1/site/outline", { headers: api.headers, body: { site: { name: "learning-materials" }, items: changed } });
console.log(res.ok ? "saved" : `failed ${res.status}`);
