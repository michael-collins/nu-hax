// Seed the local HAXcms site with a slice of learning-materials-decapcms
// content, entirely through the HAXcms v1 API:
//   node --env-file=.env.local scripts/seed-from-decap.mjs
//
// Markdown bodies go through the system md-to-html action. MDC components are
// rewritten to web components first. Frontmatter fields HAX has a slot for
// (title, pageType, tags) are kept; the rest (difficulty, learningObjectives,
// aiLicense, ...) has nowhere typed to live yet and is reported as dropped.
import { readFileSync, mkdirSync, copyFileSync } from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { connect } from "./lib/hax-api.mjs";
import { extractMdc, restoreMdc } from "./lib/decap-md.mjs";

const DECAP = process.env.DECAP_DIR || path.resolve("../learning-materials-decapcms");
const SITE_DIR = new URL("../learning-materials/", import.meta.url).pathname;

const SECTIONS = [
  {
    title: "Lessons",
    intro: "<p>Lessons group lectures, tutorials and exercises around a set of learning objectives.</p>",
    pageType: "oer:lesson",
    files: ["lessons/animation-principles/index.md"],
  },
  {
    title: "Exercises",
    intro: "<p>Formative practice focused on a narrow set of competencies.</p>",
    pageType: "oer:exercise",
    files: [
      "exercises/animating-a-bouncing-ball/index.md",
      "exercises/animated-textures/index.md",
    ],
  },
];

// every frontmatter key we can map onto HAX today
const MAPPED = new Set(["title", "tags", "published"]);

const api = await connect();
const { call, userHeaders } = api;

async function mdToHtml(md) {
  const r = await call("POST", "/system/api/v1/actions/md-to-html", {
    headers: userHeaders,
    body: { md },
  });
  if (!r.ok) throw new Error(`md-to-html failed (${r.status})`);
  return r.json.data.contents;
}

async function createPage({ title, html, pageType, tags, parent }) {
  const created = await api.createItem({ title });
  if (!created.ok) throw new Error(`create "${title}" failed (${created.status})`);
  const id = created.json.data.id;
  const saved = await api.saveContent(id, html, { title, pageType, tags });
  if (!saved.ok) throw new Error(`save "${title}" failed (${saved.status})`);
  if (parent) {
    const moved = await api.updateItem(id, "setParent", { parent });
    if (!moved.ok) throw new Error(`setParent "${title}" failed (${moved.status})`);
  }
  return id;
}

// start clean: remove anything a previous run created
const SEEDED_TYPES = new Set(["oer:section", ...SECTIONS.map((s) => s.pageType)]);
const existing = await api.listItems("?page.limit=200");
for (const item of existing.json?.data?.items ?? []) {
  if (SEEDED_TYPES.has(item.metadata?.pageType)) await api.deleteItem(item.id);
}

// rubric data file the <oer-rubric> block reads
mkdirSync(path.join(SITE_DIR, "files/data"), { recursive: true });
copyFileSync(
  path.join(DECAP, "content/data/rubrics.json"),
  path.join(SITE_DIR, "files/data/rubrics.json"),
);
console.log("copied content/data/rubrics.json -> files/data/rubrics.json");

const dropped = {};
for (const section of SECTIONS) {
  const parentId = await createPage({
    title: section.title,
    html: section.intro,
    pageType: "oer:section",
  });
  console.log(`+ ${section.title} (${parentId})`);
  for (const rel of section.files) {
    const { data: fm, content } = matter(readFileSync(path.join(DECAP, "content", rel), "utf8"));
    const lead = fm.description ? `<p class="lead">${fm.description}</p>` : "";
    const { md, blocks } = extractMdc(content);
    const html = lead + restoreMdc(await mdToHtml(md), blocks);
    const id = await createPage({
      title: fm.title,
      html,
      pageType: section.pageType,
      tags: fm.tags,
      parent: parentId,
    });
    const lost = Object.keys(fm).filter((k) => !MAPPED.has(k) && k !== "description");
    dropped[fm.title] = lost;
    console.log(`  + ${fm.title} (${id})`);
  }
}

console.log("\nFrontmatter with no typed home in HAX (dropped):");
for (const [title, keys] of Object.entries(dropped)) {
  console.log(`  ${title}: ${keys.join(", ")}`);
}
