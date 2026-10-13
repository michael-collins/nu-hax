// Choice fields hold their choice's exact value: "intermediate" becomes
// "Intermediate" when that's the choice, so a filter or a page header never
// shows the same choice twice. Only differences of case are fixed; a value
// that matches no choice is reported and left. Versions are left as saved.
//   node --env-file=.env.local scripts/normalize-choices.mjs [--dry-run]
// HAX_BASE and SITE_DIR point it at another copy of the site. Safe to run again.
import { readFileSync } from "node:fs";
import path from "node:path";
import { connect } from "./lib/hax-api.mjs";

const SITE_DIR = process.env.SITE_DIR || new URL("../learning-materials/", import.meta.url).pathname;
const SITE = process.env.HAX_SITE || "learning-materials";
const DRY = process.argv.includes("--dry-run");

const items = JSON.parse(readFileSync(path.join(SITE_DIR, "site.json"), "utf8")).items;
const defs = items.find((i) => i.metadata?.pageType === "oer:system").metadata.oerContentTypes.types;
const out = [];
const fixed = new Map();
const unknown = new Map();
const tally = (map, key) => map.set(key, (map.get(key) || 0) + 1);

for (const item of items) {
  if (item.metadata?.oerSnapshotOf) continue;
  const type = defs.find((t) => t.id === item.metadata?.pageType);
  const fields = item.metadata?.oerFields;
  if (!type || !fields) continue;
  let next = null;
  for (const f of type.fields) {
    if (f.kind !== "select" || !f.options?.length || fields[f.name] == null || fields[f.name] === "") continue;
    const fix = (v) => {
      if (f.options.some((o) => o.value === v)) return v;
      const match = f.options.find((o) => String(o.value).toLowerCase() === String(v).trim().toLowerCase());
      tally(match ? fixed : unknown, `${type.label} ${f.label}: "${v}"${match ? ` → "${match.value}"` : ""}`);
      return match ? match.value : v;
    };
    const was = fields[f.name];
    const now = Array.isArray(was) ? was.map(fix) : fix(was);
    if (JSON.stringify(now) !== JSON.stringify(was)) (next ||= { ...fields })[f.name] = now;
  }
  if (next) out.push({ ...item, metadata: { ...item.metadata, oerFields: next }, modified: true });
}
for (const [k, n] of fixed) console.log(`${k} (${n})`);
for (const [k, n] of unknown) console.log(`no such choice, left: ${k} (${n})`);
console.log(`${out.length} pages to fix`);
if (DRY || !out.length) process.exit(0);

const api = await connect();
const res = await api.call("PATCH", "/x/api/v1/site/outline", { headers: api.headers, body: { site: { name: SITE }, items: out } });
if (!res.ok) throw new Error(`outline save failed (${res.status}): ${JSON.stringify(res.json).slice(0, 300)}`);
console.log("saved");
