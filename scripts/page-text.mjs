// Replace a sentence (or any exact piece of HTML) in one page.
//   node --env-file=.env.local scripts/page-text.mjs <address> "<old>" "<new>"
// The page keeps everything else, its details included (an outline save of
// its stored content). HAX_BASE and SITE_DIR point it at another copy.
import { readFileSync } from "node:fs";
import path from "node:path";
import { connect } from "./lib/hax-api.mjs";

const [address, from, to] = process.argv.slice(2);
if (!address || !from || to === undefined) {
  console.error('usage: node --env-file=.env.local scripts/page-text.mjs <address> "<old>" "<new>"');
  process.exit(1);
}
const SITE_DIR = process.env.SITE_DIR || new URL("../learning-materials/", import.meta.url).pathname;
const SITE = process.env.HAX_SITE || "learning-materials";
const items = JSON.parse(readFileSync(path.join(SITE_DIR, "site.json"), "utf8")).items;
const item = items.find((i) => i.slug === address.replace(/^\//, "") && !i.metadata?.oerSnapshotOf);
if (!item) throw new Error(`No page at ${address}`);
const html = readFileSync(path.join(SITE_DIR, item.location), "utf8");
const count = html.split(from).length - 1;
if (count !== 1) throw new Error(`"${from}" is in ${item.title} ${count} times; it must be there exactly once`);
const api = await connect();
const res = await api.call("PATCH", "/x/api/v1/site/outline", { headers: api.headers, body: { site: { name: SITE }, items: [{ ...item, contents: html.replace(from, to), modified: true }] } });
if (!res.ok) throw new Error(`save failed (${res.status})`);
console.log(`${item.title}: replaced`);
