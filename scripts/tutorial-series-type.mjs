// Let a Tutorial hold Tutorials: a tutorial series is a Tutorial whose
// sub-pages are its parts (a YouTube playlist, a part per video), shown in
// exercises and projects with the Tutorial series block
// (learning-materials custom/src/blocks/oer-tutorial-series.js).
//   node --env-file=.env.local scripts/tutorial-series-type.mjs [--dry-run]
// Safe to run again. HAX_BASE and SITE_DIR point it at another copy of the
// site (with HAX_TOKENLESS=1 for a scratch server).
import { readFileSync } from "node:fs";
import path from "node:path";
import { connect } from "./lib/hax-api.mjs";

const SITE_DIR = process.env.SITE_DIR || new URL("../learning-materials/", import.meta.url).pathname;
const SITE = process.env.HAX_SITE || "learning-materials";
const DRY = process.argv.includes("--dry-run");

const items = JSON.parse(readFileSync(path.join(SITE_DIR, "site.json"), "utf8")).items;
const sys = items.find((i) => i.metadata?.pageType === "oer:system" && i.metadata?.oerContentTypes);
const raw = sys.metadata.oerContentTypes;
const types = typeof raw === "string" ? JSON.parse(raw) : structuredClone(raw);
const tutorial = types.types.find((t) => t.id === "oer:tutorial");
const children = Array.isArray(tutorial.children) ? tutorial.children : [];
if (children.includes("oer:tutorial")) {
  console.log("oer:tutorial already holds tutorials");
  process.exit(0);
}
tutorial.children = [...children, "oer:tutorial"];
console.log(`oer:tutorial children: ${JSON.stringify(children)} → ${JSON.stringify(tutorial.children)}${DRY ? " (dry run)" : ""}`);
if (DRY) process.exit(0);

const out = { ...sys, metadata: { ...sys.metadata, oerContentTypes: typeof raw === "string" ? JSON.stringify(types) : types }, modified: true };
const api = await connect();
const res = await api.call("PATCH", "/x/api/v1/site/outline", { headers: api.headers, body: { site: { name: SITE }, items: [out] } });
if (!res.ok) throw new Error(`outline save failed (${res.status}): ${JSON.stringify(res.json).slice(0, 300)}`);
console.log("saved");
