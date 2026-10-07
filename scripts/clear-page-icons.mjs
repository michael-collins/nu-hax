// Pages have no icon unless someone chooses one. Icons were stamped onto
// pages without anyone choosing them: HAX's guess from the page type
// (courseicons:learning-objectives, written back by saves; see
// custom/src/types/page-icon.js) and type icons copied by imports (hax:lesson,
// lrn:quiz, hax:bulletin-board). This clears every page's icon.
//   node --env-file=.env.local scripts/clear-page-icons.mjs [--dry-run]
// Safe to run again.
import { readFileSync } from "node:fs";
import path from "node:path";
import { connect } from "./lib/hax-api.mjs";

const SITE_DIR = process.env.SITE_DIR || new URL("../learning-materials/", import.meta.url).pathname;
const SITE = process.env.HAX_SITE || "learning-materials";
const DRY = process.argv.includes("--dry-run");

const items = JSON.parse(readFileSync(path.join(SITE_DIR, "site.json"), "utf8")).items;
const withIcon = items.filter((i) => i.metadata?.icon);
const counts = {};
for (const i of withIcon) counts[i.metadata.icon] = (counts[i.metadata.icon] || 0) + 1;
console.log(`${withIcon.length} pages have an icon${DRY ? " (dry run)" : ""}:`);
for (const [icon, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) console.log(`  ${n}  ${icon}`);
if (DRY || !withIcon.length) process.exit(0);

// HAXcms merges metadata on outline saves: clear with "", not by leaving it out
const out = withIcon.map((i) => ({ ...i, metadata: { ...i.metadata, icon: "" }, modified: true }));
const api = await connect();
const res = await api.call("PATCH", "/x/api/v1/site/outline", { headers: api.headers, body: { site: { name: SITE }, items: out } });
if (!res.ok) throw new Error(`outline save failed (${res.status}): ${JSON.stringify(res.json).slice(0, 300)}`);
console.log(`cleared ${out.length} icons`);
