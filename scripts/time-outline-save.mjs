// Time an outline save that changes one item's metadata (and changes it back):
//   node --env-file=.env.local scripts/time-outline-save.mjs [full|changed]
import { readFileSync } from "node:fs";
import { connect } from "./lib/hax-api.mjs";
const mode = process.argv[2] || "changed";
const items = JSON.parse(readFileSync(new URL("../learning-materials/site.json", import.meta.url), "utf8")).items;
const target = items.find((i) => i.title === "Welcome to learning-materials" && !i.metadata?.oerSnapshotOf && !i.metadata?.oerRef);
const touched = { ...target, metadata: { ...target.metadata, oerSaveTiming: String(Date.now()) }, modified: true };
const body = mode === "full" ? items.map((i) => (i.id === target.id ? touched : i)) : [touched];
const api = await connect();
const t = Date.now();
const res = await api.call("PATCH", "/x/api/v1/site/outline", { headers: api.headers, body: { site: { name: "learning-materials" }, items: body } });
console.log(`${mode}: ${body.length} items in the request, ${res.status}, ${((Date.now() - t) / 1000).toFixed(1)}s`);
// clean up the marker
await api.call("PATCH", "/x/api/v1/site/outline", { headers: api.headers, body: { site: { name: "learning-materials" }, items: [{ ...target, metadata: { ...target.metadata, oerSaveTiming: "" }, modified: true }] } });
