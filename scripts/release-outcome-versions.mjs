// Give learning outcomes their first release: each outcome page with no
// release gets v1.0.0, the outcome as it says now (an archived copy that
// keeps its statement, level and code). From then on, releasing a page or
// sequence pins the outcomes it names, releasing those that changed first
// (custom/src/versions/versioning.js outcomePlan).
//   node --env-file=.env.local scripts/release-outcome-versions.mjs [--dry-run]
// HAX_BASE and SITE_DIR point it at another copy. Safe to run again: released outcomes are left alone.
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { connect } from "./lib/hax-api.mjs";
import { isOutcome } from "../learning-materials/custom/src/types/outcome.js";

const SITE_DIR = process.env.SITE_DIR || new URL("../learning-materials/", import.meta.url).pathname;
const SITE = process.env.HAX_SITE || "learning-materials";
const DRY = process.argv.includes("--dry-run");

const items = JSON.parse(readFileSync(path.join(SITE_DIR, "site.json"), "utf8")).items;
const html = (item) => {
  const file = item.location && path.join(SITE_DIR, item.location);
  return file && existsSync(file) ? readFileSync(file, "utf8") : "";
};
const now = Math.floor(Date.now() / 1000);
const out = [];
for (const o of items.filter(isOutcome)) {
  if ((o.metadata?.oerVersions || []).length || items.some((i) => i.metadata?.oerSnapshotOf === o.id)) continue;
  const record = { version: "1.0.0", date: now, notes: "First release: the outcome as first written." };
  out.push({ ...o, metadata: { ...o.metadata, version: "1.0.0", oerVersions: [record] }, modified: true });
  out.push({
    id: `new-outcome-release-${o.id}`,
    title: "v1.0.0",
    parent: o.id,
    order: items.filter((i) => i.parent === o.id).length + 1000,
    indent: (Number(o.indent) || 0) + 1,
    location: "",
    description: o.description || "",
    metadata: {
      pageType: o.metadata.pageType,
      oerFields: o.metadata?.oerFields || {},
      oerSnapshotOf: o.id,
      oerSnapshotTitle: o.title,
      version: "1.0.0",
      versionStatus: "archived",
      hideInMenu: true,
      locked: true,
      published: o.metadata?.published !== false,
    },
    contents: html(o).replace(/<page-break\b[^>]*>(?:\s*<\/page-break>)?/gi, "").trim() || "<p></p>",
    new: true,
  });
  console.log(`${o.metadata?.oerFields?.code || ""} ${o.title}: v1.0.0`.trim());
}
console.log(`${out.length / 2} outcome(s) released${DRY ? " (dry run)" : ""}`);
if (DRY || !out.length) process.exit(0);
const api = await connect();
const res = await api.call("PATCH", "/x/api/v1/site/outline", { headers: api.headers, body: { site: { name: SITE }, items: out } });
if (!res.ok) throw new Error(`outline save failed (${res.status}): ${JSON.stringify(res.json).slice(0, 300)}`);
console.log("saved");
