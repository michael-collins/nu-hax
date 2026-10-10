// OER Courses (the user's request, 2026-10-09): a page for students at
// /oer-courses that lists the course sites by degree program, where course
// sites' bars link instead of the OER repository. This adds its type
// (custom/src/types/course-site.js COURSE_HUB_DEF) to the site's content
// types and makes the page: published, out of the navigation, with an intro
// to write and the catalog of course sites.
//   node --env-file=.env.local scripts/course-hub.mjs [--dry-run]
// HAX_BASE and SITE_DIR point it at another copy (a scratch server). Safe to run again.
import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { connect } from "./lib/hax-api.mjs";

const SITE_DIR = process.env.SITE_DIR || new URL("../learning-materials/", import.meta.url).pathname;
const SITE = process.env.HAX_SITE || "learning-materials";
const DRY = process.argv.includes("--dry-run");
const HUB = "oer:course-hub";
// mirrors COURSE_HUB_DEF and HUB_STARTER in custom/src/types/course-site.js
// (the section and item model: no heading, so the intro shows the hub's own
// until one is typed in it, scripts/course-site-structure.mjs)
const DEF = {
  id: HUB,
  label: "Courses hub",
  icon: "oer:graduation-cap",
  description: "OER Courses: a page for students that lists the course sites, by degree program.",
  children: [],
  nav: false,
  fields: [],
};
const STARTER = ["<oer-courses-intro><p></p></oer-courses-intro>", "<oer-courses-catalog></oer-courses-catalog>"].join("\n");

const items = JSON.parse(readFileSync(path.join(SITE_DIR, "site.json"), "utf8")).items;
const out = [];

const sys = items.find((i) => i.metadata?.pageType === "oer:system");
const raw = sys.metadata.oerContentTypes;
const types = typeof raw === "string" ? JSON.parse(raw) : structuredClone(raw);
if (!types.types.some((t) => t.id === HUB)) {
  const at = types.types.findIndex((t) => t.id === "oer:course-site");
  types.types.splice(at >= 0 ? at + 1 : types.types.length, 0, DEF);
  out.push({ ...sys, metadata: { ...sys.metadata, oerContentTypes: typeof raw === "string" ? JSON.stringify(types) : types }, modified: true });
  console.log("content types: Courses hub");
}

if (!items.some((i) => i.metadata?.pageType === HUB && !i.metadata?.oerSnapshotOf)) {
  out.push({
    id: `item-${randomUUID()}`,
    title: "OER Courses",
    parent: null,
    indent: 0,
    order: Math.max(-1, ...items.filter((i) => !i.parent).map((i) => Number(i.order) || 0)) + 1,
    slug: "oer-courses",
    location: "",
    description: "",
    metadata: { pageType: HUB, published: true, hideInMenu: true, overridePathauto: true },
    contents: STARTER,
    new: true,
  });
  console.log("page: /oer-courses");
}

console.log(`${out.length} item(s) to save${DRY ? " (dry run)" : ""}`);
if (DRY || !out.length) process.exit(0);
const api = await connect();
const res = await api.call("PATCH", "/x/api/v1/site/outline", { headers: api.headers, body: { site: { name: SITE }, items: out } });
if (!res.ok) throw new Error(`outline save failed (${res.status}): ${JSON.stringify(res.json).slice(0, 300)}`);
console.log("saved");
