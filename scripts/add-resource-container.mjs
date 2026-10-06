// Give the Resource type a "Published in" field (the journal, magazine,
// book or site a work appeared in), after Publisher:
//   node --env-file=.env.local scripts/add-resource-container.mjs [--dry-run]
// Safe to run again.
import { readFileSync } from "node:fs";
import path from "node:path";
import { connect } from "./lib/hax-api.mjs";

const SITE_DIR = new URL("../learning-materials/", import.meta.url).pathname;
const DRY = process.argv.includes("--dry-run");
const items = JSON.parse(readFileSync(path.join(SITE_DIR, "site.json"), "utf8")).items;
const sys = items.find((i) => i.metadata?.pageType === "oer:system");
const defs = sys.metadata.oerContentTypes;
const resource = defs.types.find((t) => t.id === "oer:resource");
if (resource.fields.some((f) => f.name === "container")) {
  console.log("the Resource type already has Published in");
  process.exit(0);
}
const field = { name: "container", label: "Published in", kind: "text", help: "The journal, magazine, book or site it appeared in, if any." };
const fields = resource.fields.flatMap((f) => (f.name === "publisher" ? [field, f] : [f]));
if (!fields.includes(field)) fields.push(field);
console.log(`Resource fields: ${fields.map((f) => f.label).join(", ")}${DRY ? " (dry run)" : ""}`);
if (DRY) process.exit(0);
const api = await connect();
const out = [{ ...sys, metadata: { ...sys.metadata, oerContentTypes: { ...defs, types: defs.types.map((t) => (t.id === "oer:resource" ? { ...t, fields } : t)) } }, modified: true }];
const res = await api.call("PATCH", "/x/api/v1/site/outline", { headers: api.headers, body: { site: { name: "learning-materials" }, items: out } });
console.log(res.ok ? "saved" : `failed ${res.status}`);
