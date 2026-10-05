// Set descriptions from Decap on imported pages that have none (outline
// saves leave descriptions out in HAXcms 26.8.1, so each is its own call):
//   node --env-file=.env.local scripts/set-decap-descriptions.mjs
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { connect } from "./lib/hax-api.mjs";
const DECAP = "/Users/msc227/Documents/repos/open-curriculum/oerschema/learning-materials-decapcms";
const items = JSON.parse(readFileSync("/Users/msc227/Documents/repos/nu-hax/learning-materials/site.json", "utf8")).items;
const resources = JSON.parse(readFileSync(`${DECAP}/content/data/resources.json`, "utf8")).resources;
const api = await connect();
let n = 0, none = 0;
for (const i of items) {
  const src = i.metadata?.oerSource;
  if (!src || i.description || i.metadata?.oerSnapshotOf) continue;
  let d = "";
  if (src.startsWith("resources/")) d = resources.find((r) => `resources/${r.id}` === src)?.description || "";
  else {
    const f = path.join(DECAP, "content", src, "index.md");
    if (existsSync(f)) d = matter(readFileSync(f, "utf8")).data.description || "";
  }
  d = String(d).trim();
  if (!d) { none++; continue; }
  const res = await api.updateItem(i.id, "setDescription", { description: d });
  if (!res.ok) { console.log("failed", i.title, res.status); continue; }
  n++;
}
console.log(`set ${n} descriptions; ${none} have none in Decap`);
