// Record on each page the rubrics its Rubric blocks show
// (metadata.oerRubrics: the blocks' rubric-id values), so a rubric knows
// where it's used: the rubric editor says how many pages a change reaches,
// and a rubric's page lists them under Used in. The theme keeps this up to
// date as pages are saved (custom/src/rubrics/rubric-usage.js); this fills
// it in for pages saved before that, archived versions included.
//   node --env-file=.env.local scripts/index-rubric-usage.mjs [--dry-run]
// Safe to run again: only pages whose list changed are sent.
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { connect } from "./lib/hax-api.mjs";
import { rubricRefsIn } from "../learning-materials/custom/src/rubrics/rubric-model.js";

const SITE_DIR = process.env.SITE_DIR || new URL("../learning-materials/", import.meta.url).pathname;
const SITE = process.env.HAX_SITE || "learning-materials";
const DRY = process.argv.includes("--dry-run");

const items = JSON.parse(readFileSync(path.join(SITE_DIR, "site.json"), "utf8")).items;
const same = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
const out = [];
for (const item of items) {
  const file = item.location && path.join(SITE_DIR, item.location);
  const refs = file && existsSync(file) ? rubricRefsIn(readFileSync(file, "utf8")) : [];
  const had = [].concat(item.metadata?.oerRubrics || []);
  if (same(had, refs)) continue;
  // HAXcms merges metadata on outline saves: clear with [], never omit
  out.push({ ...item, metadata: { ...item.metadata, oerRubrics: refs }, modified: true });
}
const versions = out.filter((i) => i.metadata?.oerSnapshotOf).length;
const counts = {};
for (const i of out) for (const r of i.metadata.oerRubrics) counts[r] = (counts[r] || 0) + 1;
console.log(`${out.length} pages to update (${versions} archived versions): ${Object.entries(counts).map(([r, n]) => `${r} ${n}`).join(", ") || "none"}${DRY ? " (dry run)" : ""}`);
if (DRY || !out.length) process.exit(0);

const api = await connect();
const res = await api.call("PATCH", "/x/api/v1/site/outline", { headers: api.headers, body: { site: { name: SITE }, items: out } });
if (!res.ok) throw new Error(`outline save failed (${res.status}): ${JSON.stringify(res.json).slice(0, 300)}`);
console.log("saved");
