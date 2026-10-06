// Give books' linked chapters (metadata.oerRef) the content type of the
// page they link to, e.g. after deliverables became Activities:
//   node --env-file=.env.local scripts/sync-ref-types.mjs [--dry-run]
// Safe to run again.
import { readFileSync } from "node:fs";
import path from "node:path";
import { connect } from "./lib/hax-api.mjs";

const SITE_DIR = process.env.SITE_DIR || new URL("../learning-materials/", import.meta.url).pathname;
const items = JSON.parse(readFileSync(path.join(SITE_DIR, "site.json"), "utf8")).items;
const byId = new Map(items.map((i) => [i.id, i]));
const out = [];
for (const i of items) {
  const src = byId.get(i.metadata?.oerRef?.page);
  const type = src?.metadata?.pageType;
  if (type && type !== i.metadata.pageType) {
    console.log(`  ${i.title}: ${i.metadata.pageType || "-"} → ${type}`);
    out.push({ ...i, metadata: { ...i.metadata, pageType: type }, modified: true });
  }
}
console.log(`${out.length} linked chapters get their source's type${process.argv.includes("--dry-run") ? " (dry run)" : ""}`);
if (process.argv.includes("--dry-run") || !out.length) process.exit(0);
const api = await connect();
const res = await api.call("PATCH", "/x/api/v1/site/outline", { headers: api.headers, body: { site: { name: "learning-materials" }, items: out } });
console.log(res.ok ? "saved" : `failed ${res.status}`);
