// Make the Resource type's Kind a pick from the kinds already in use (with
// a choice to add one) rather than free text:
//   node --env-file=.env.local scripts/resource-kind-choices.mjs [--dry-run]
// The same as ticking "Pick from values other pages use" in the type editor.
import { readFileSync } from "node:fs";
import path from "node:path";
import { connect } from "./lib/hax-api.mjs";

const SITE_DIR = new URL("../learning-materials/", import.meta.url).pathname;
const items = JSON.parse(readFileSync(path.join(SITE_DIR, "site.json"), "utf8")).items;
const sys = items.find((i) => i.metadata?.pageType === "oer:system");
const defs = sys.metadata.oerContentTypes;
const resource = defs.types.find((t) => t.id === "oer:resource");
const kind = resource.fields.find((f) => f.name === "kind");
if (kind.suggest) {
  console.log("Kind already picks from the kinds in use");
  process.exit(0);
}
const fields = resource.fields.map((f) => (f.name === "kind" ? { ...f, suggest: true, help: "What it is. Pick one in use or add a new one." } : f));
if (process.argv.includes("--dry-run")) process.exit(console.log(fields.find((f) => f.name === "kind")) || 0);
const api = await connect();
const out = [{ ...sys, metadata: { ...sys.metadata, oerContentTypes: { ...defs, types: defs.types.map((t) => (t.id === "oer:resource" ? { ...t, fields } : t)) } }, modified: true }];
const res = await api.call("PATCH", "/x/api/v1/site/outline", { headers: api.headers, body: { site: { name: "learning-materials" }, items: out } });
console.log(res.ok ? "saved" : `failed ${res.status}`);
