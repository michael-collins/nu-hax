// In a book, a project's steps belong inside the project's chapter (OER
// Schema: an Activity is activityOf its Project; the Project type holds
// Activities, a Lesson doesn't). The DMD 100 book listed them after the
// project, as siblings in the lesson chapter, so the outline builder flagged
// every step. This moves each project's step chapters under the project's
// chapter, in the project's order and with its stage headings, so the book
// mirrors the project. Reading order doesn't change.
//
// An empty supporting page that only held other pages in the book (the
// Hypertext Narrative project's "Tutorials", holding the Twine tutorial) is
// replaced, in the project and the book, by links to what it held.
//   node --env-file=.env.local scripts/nest-book-project-steps.mjs [--dry-run]
// Safe to run again.
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { connect } from "./lib/hax-api.mjs";

const SITE_DIR = process.env.SITE_DIR || new URL("../learning-materials/", import.meta.url).pathname;
const SITE = process.env.HAX_SITE || "learning-materials";
const DRY = process.argv.includes("--dry-run");

let items = JSON.parse(readFileSync(path.join(SITE_DIR, "site.json"), "utf8")).items;
const byId = new Map(items.map((i) => [i.id, i]));
const live = (i) => i && !i.metadata?.oerSnapshotOf;
const kidsOf = (id) => items.filter((i) => i.parent === id && live(i)).sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
const refOf = (i) => i?.metadata?.oerRef?.page || "";
const isHeading = (i) => i?.metadata?.pageType === "oer:heading";
const include = (page) => `<oer-include page="${page}"></oer-include>`;
const textOf = (i) => {
  const f = i?.location && path.join(SITE_DIR, i.location);
  if (!f || !existsSync(f)) return "";
  return readFileSync(f, "utf8").replace(/<page-break[\s\S]*?<\/page-break>/g, "").replace(/<[^>]+>/g, "").trim();
};

const out = new Map();
const get = (i) => out.get(i.id) || i;
const set = (i, patch) => out.set(i.id, { ...get(i), ...patch, modified: true });
const created = [];
const report = [];

// the project's parts in order, with their stage (the heading above them)
function partsOf(projectId) {
  const parts = [];
  let stage = "";
  for (const c of kidsOf(projectId)) {
    if (isHeading(c)) stage = c.title;
    else if (!c.metadata?.hideInMenu) parts.push({ item: c, stage });
  }
  return parts;
}

const books = items.filter((i) => i.metadata?.pageType === "oer:book" && live(i) && !refOf(i));
const chapters = [];
const walk = (id) => kidsOf(id).forEach((c) => (chapters.push(c), walk(c.id)));
books.forEach((b) => walk(b.id));

for (const chapter of chapters.filter((c) => byId.get(refOf(c))?.metadata?.pageType === "oer:project")) {
  const project = byId.get(refOf(chapter));
  const parts = partsOf(project.id);
  const partIds = new Set(parts.map((p) => p.item.id));
  // the project's step chapters: siblings after it (and anything already inside it)
  const siblings = kidsOf(chapter.parent);
  const at = siblings.findIndex((s) => s.id === chapter.id);
  const following = [];
  for (const s of siblings.slice(at + 1)) {
    if (isHeading(s) || !partIds.has(refOf(s))) break;
    following.push(s);
  }
  const inside = kidsOf(chapter.id).filter((c) => !isHeading(c));
  const stepChapters = [...inside, ...following];
  if (!following.length && kidsOf(chapter.id).some(isHeading)) continue; // done already
  if (!stepChapters.length) continue;

  // an empty part that only held pages in the book: in its place, links to what it held
  for (const p of [...parts]) {
    const ref = stepChapters.find((s) => refOf(s) === p.item.id);
    const held = ref ? kidsOf(ref.id).filter((c) => refOf(c)) : [];
    if (!ref || !held.length || textOf(p.item)) continue;
    const idx = parts.indexOf(p);
    const replacements = held.map((h) => ({ item: { id: `new-part-${h.id}`, title: h.title, source: byId.get(refOf(h)) }, stage: p.stage, held: h }));
    parts.splice(idx, 1, ...replacements);
    // the project: links (oer-include) to the pages, where the empty page was
    out.set(p.item.id, { ...p.item, delete: true });
    const links = replacements.map((r) => ({
      id: r.item.id,
      title: r.item.source.title,
      parent: project.id,
      order: 0,
      indent: (Number(project.indent) || 0) + 1,
      location: "",
      description: "",
      metadata: { pageType: r.item.source.metadata.pageType, oerRef: { page: r.item.source.id, version: "" }, published: r.item.source.metadata?.published !== false },
      contents: include(r.item.source.id),
      new: true,
    }));
    created.push(...links);
    // the project's pages renumbered, the links in the empty page's place
    const projectKids = kidsOf(project.id);
    const at = projectKids.findIndex((k) => k.id === p.item.id);
    [...projectKids.slice(0, at), ...links, ...projectKids.slice(at + 1)].forEach((k, n) => {
      if (k.new) k.order = n;
      else if (Number(get(k).order) !== n) set(k, { order: n });
    });
    // the book: the held chapters stand in for the empty one, with their page's type
    out.set(ref.id, { ...ref, delete: true });
    for (const r of replacements) set(r.held, { metadata: { ...get(r.held).metadata, pageType: r.item.source.metadata.pageType } });
    report.push(`  ${project.title}: "${p.item.title}" (empty) replaced by links to ${replacements.map((r) => `"${r.item.source.title}"`).join(", ")}`);
  }

  // inside the project's chapter: headings for the stages, then the steps, in the project's order
  let order = 0;
  let stage = "";
  const indent = (Number(chapter.indent) || 0) + 1;
  for (const p of parts) {
    if (p.stage && p.stage !== stage) {
      stage = p.stage;
      created.push({ id: `new-stage-${chapter.id}-${order}`, title: stage, parent: chapter.id, order: order++, indent, location: "", description: "", metadata: { pageType: "oer:heading", hideInMenu: true }, contents: "", new: true });
    }
    const sourceId = p.item.source?.id || p.item.id;
    const existing = p.held || stepChapters.find((s) => refOf(s) === sourceId);
    // only chapters the book has: a part the book leaves out stays out
    if (existing) set(existing, { parent: chapter.id, order: order++, indent });
  }
  // the lesson chapter's remaining pages close up behind the project
  kidsOf(chapter.parent)
    .filter((s) => !following.some((f) => f.id === s.id))
    .forEach((s, n) => Number(get(s).order) !== n && set(s, { order: n }));
  report.push(`${byId.get(chapter.parent)?.title} › ${chapter.title}: ${following.length} steps moved inside, ${created.filter((c) => c.parent === chapter.id && c.metadata.pageType === "oer:heading").length} stage headings`);
}

console.log(report.length ? report.join("\n") : "nothing to change");
if (DRY || (!out.size && !created.length)) process.exit(0);
const api = await connect();
const res = await api.call("PATCH", "/x/api/v1/site/outline", { headers: api.headers, body: { site: { name: SITE }, items: [...out.values(), ...created] } });
if (!res.ok) throw new Error(`outline save failed (${res.status}): ${JSON.stringify(res.json).slice(0, 300)}`);
console.log(`saved ${out.size + created.length} items`);
