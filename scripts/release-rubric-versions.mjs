// Give rubrics versions that go with archived versions:
// 1. each rubric page with no release gets v1.0.0, the rubric as it is now
//    (an archived copy that keeps its criteria, levels and weights);
// 2. each archived version of a page whose Rubric blocks show the latest
//    rubric is pinned (version="…" on the block, "exercise@1.0.0" in its
//    metadata.oerRubrics) to the rubric release that was current when it
//    was released, or the rubric's first release when it's older than every
//    rubric release (as the archived exercises from Decap are).
// From then on, releasing a page pins its rubrics itself
// (custom/src/versions/versioning.js).
//   node --env-file=.env.local scripts/release-rubric-versions.mjs [--dry-run] [--only <snapshot id>]
// Safe to run again: released rubrics and pinned blocks are left alone.
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { connect } from "./lib/hax-api.mjs";
import { isRubric, findRubric, rubricRefsIn, parseRubricRef } from "../learning-materials/custom/src/rubrics/rubric-model.js";

const SITE_DIR = process.env.SITE_DIR || new URL("../learning-materials/", import.meta.url).pathname;
const SITE = process.env.HAX_SITE || "learning-materials";
const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const ONLY = args.includes("--only") ? args[args.indexOf("--only") + 1] : "";

const items = JSON.parse(readFileSync(path.join(SITE_DIR, "site.json"), "utf8")).items;
const html = (item) => {
  const file = item.location && path.join(SITE_DIR, item.location);
  return file && existsSync(file) ? readFileSync(file, "utf8") : "";
};
const now = Math.floor(Date.now() / 1000);
const out = [];

/* ---------- 1. v1.0.0 for rubrics never released ---------- */
// releases per rubric page id: [{ version, date }], oldest first
const releases = new Map();
for (const r of items.filter(isRubric)) {
  const recorded = (r.metadata?.oerVersions || []).map((v) => ({ version: v.version, date: Number(v.date) || 0 }));
  if (recorded.length) {
    releases.set(r.id, recorded.sort((a, b) => a.date - b.date));
    continue;
  }
  releases.set(r.id, [{ version: "1.0.0", date: now }]);
  if (ONLY) continue;
  const record = { version: "1.0.0", date: now, notes: "First release: the rubric as moved from the old rubrics data file, so archived pages keep it as it was." };
  out.push({ ...r, metadata: { ...r.metadata, version: "1.0.0", oerVersions: [record] }, modified: true });
  out.push({
    id: `new-rubric-release-${r.id}`,
    title: "v1.0.0",
    parent: r.id,
    order: items.filter((i) => i.parent === r.id).length + 1000,
    indent: (Number(r.indent) || 0) + 1,
    location: "",
    description: r.description || "",
    metadata: {
      pageType: r.metadata.pageType,
      oerFields: r.metadata?.oerFields || {},
      oerRubric: r.metadata.oerRubric,
      oerSnapshotOf: r.id,
      oerSnapshotTitle: r.title,
      version: "1.0.0",
      versionStatus: "archived",
      hideInMenu: true,
      locked: true,
      published: r.metadata?.published !== false,
    },
    contents: html(r).replace(/<page-break\b[^>]*>(?:\s*<\/page-break>)?/gi, "").trim() || "<p></p>",
    new: true,
  });
}

/* ---------- 2. pin archived versions' rubric blocks ---------- */
// the rubric release current when a page version was released
const releaseDate = (snapshot) => {
  const page = items.find((i) => i.id === snapshot.metadata.oerSnapshotOf);
  return Number((page?.metadata?.oerVersions || []).find((v) => v.version === snapshot.metadata.version)?.date) || 0;
};
const pinFor = (rubric, date) => {
  const list = releases.get(rubric.id) || [];
  return ([...list].reverse().find((v) => date && v.date && v.date <= date) || list[0])?.version || "";
};
let pinned = 0;
for (const s of items.filter((i) => i.metadata?.oerSnapshotOf && (!ONLY || i.id === ONLY))) {
  const text = html(s);
  if (!rubricRefsIn(text).some((e) => !parseRubricRef(e).version)) continue;
  const date = releaseDate(s);
  const contents = text.replace(/<oer-rubric\b[^>]*>/gi, (tag) => {
    if (/\sversion="/i.test(tag)) return tag;
    const rubric = findRubric(items, tag.match(/\srubric-id="([^"]*)"/i)?.[1] || "");
    const version = rubric && pinFor(rubric, date);
    return version ? tag.replace(/\s*(\/?)>$/, ` version="${version}"$1>`) : tag;
  });
  if (contents === text) continue;
  pinned++;
  out.push({ ...s, contents, metadata: { ...s.metadata, oerRubrics: rubricRefsIn(contents) }, modified: true });
}

const rubricReleases = out.filter((i) => i.new).length;
console.log(`${rubricReleases} rubric${rubricReleases === 1 ? "" : "s"} released as v1.0.0; ${pinned} archived version${pinned === 1 ? "" : "s"} pinned${DRY ? " (dry run)" : ""}`);
for (const i of out.filter((x) => !x.new && x.contents).slice(0, 3)) console.log(`  ${i.metadata.oerSnapshotTitle || i.title} ${i.title}: ${i.metadata.oerRubrics.join(", ")}`);
if (DRY || !out.length) process.exit(0);

const api = await connect();
const res = await api.call("PATCH", "/x/api/v1/site/outline", { headers: api.headers, body: { site: { name: SITE }, items: out } });
if (!res.ok) throw new Error(`outline save failed (${res.status}): ${JSON.stringify(res.json).slice(0, 300)}`);
console.log("saved");
