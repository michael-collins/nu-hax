// Restore multiple-choice select fields that the type import flattened:
//   node --env-file=.env.local scripts/migrate-multiselect.mjs [--dry-run]
//
// learning-materials-decapcms marks some selects `multiple: true` (e.g.
// aiLicense, "AI Usage Licenses"). The HAX content types lost that flag, and
// the page import joined the chosen values into one string
// ("AIUL-WA, AIUL-NA-3D"), which matches no option: the footer showed one
// combined tag and Page details showed "—" (saving it there would clear it).
//
// - every select field Decap marks multiple gets `multiple: true` (and its
//   Decap default) in each content type that has it
// - every page's value for those fields becomes a list of the codes
// Safe to run again.
import { readFileSync } from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { connect } from "./lib/hax-api.mjs";

const DECAP = process.env.DECAP_DIR || path.resolve("../open-curriculum/oerschema/learning-materials-decapcms");
const SITE_DIR = new URL("../learning-materials/", import.meta.url).pathname;
const SITE = process.env.HAX_SITE || "learning-materials";
const DRY = process.argv.includes("--dry-run");

const config = YAML.parse(readFileSync(path.join(DECAP, "cms/config.yml"), "utf8"));
const multiple = new Map(); // field name -> Decap default
for (const col of config.collections || []) {
  for (const f of col.fields || []) {
    if (f.widget === "select" && f.multiple) multiple.set(f.name, f.default);
  }
}

const site = JSON.parse(readFileSync(path.join(SITE_DIR, "site.json"), "utf8"));
const items = site.items;
const sys = items.find((i) => i.metadata?.pageType === "oer:system");
if (!sys) throw new Error("No content-types page (pageType oer:system) found");
const defs = sys.metadata.oerContentTypes;

let fieldsFixed = 0;
const nextDefs = {
  ...defs,
  types: defs.types.map((t) => ({
    ...t,
    fields: (t.fields || []).map((f) => {
      if (f.kind !== "select" || !multiple.has(f.name) || f.multiple) return f;
      fieldsFixed++;
      const def = multiple.get(f.name);
      return { ...f, multiple: true, ...(def !== undefined ? { default: Array.isArray(def) ? def.join(", ") : String(def) } : {}) };
    }),
  })),
};

const toList = (v) => (Array.isArray(v) ? v : String(v ?? "").split(",")).map((x) => String(x).trim()).filter(Boolean);

let pagesFixed = 0;
const out = items.map((i) => {
  if (i.id === sys.id) return fieldsFixed ? { ...i, metadata: { ...i.metadata, oerContentTypes: nextDefs }, modified: true } : i;
  const f = i.metadata?.oerFields;
  if (!f) return i;
  let changed = false;
  const fields = { ...f };
  for (const name of multiple.keys()) {
    if (name in f && !Array.isArray(f[name])) {
      fields[name] = toList(f[name]);
      changed = true;
    }
  }
  if (!changed) return i;
  pagesFixed++;
  return { ...i, metadata: { ...i.metadata, oerFields: fields }, modified: true };
});

console.log(`multiple-choice fields in Decap: ${[...multiple.keys()].join(", ")}`);
console.log(`${fieldsFixed} type fields get multiple: true; ${pagesFixed} pages get list values`);
if (DRY) {
  console.log("dry run: nothing written");
  process.exit(0);
}
if (!fieldsFixed && !pagesFixed) process.exit(0);
const api = await connect();
const res = await api.call("PATCH", "/x/api/v1/site/outline", { headers: api.headers, body: { site: { name: SITE }, items: out } });
if (!res.ok) throw new Error(`outline save failed (${res.status}): ${JSON.stringify(res.json).slice(0, 300)}`);
console.log("saved");
