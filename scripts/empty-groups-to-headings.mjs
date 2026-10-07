// Books imported from the Decap site have empty pages that were only group
// labels in its outlines ("Readings", "Topics", "Chapter 1: Introduction"):
// readers can land on them and find nothing. Each becomes a heading (a
// label in the outline, not a page) and the pages it held follow it at its
// level, in order. Empty pages holding nothing are removed.
//   node --env-file=.env.local scripts/empty-groups-to-headings.mjs [--dry-run] [--all]
// --all looks beyond books, at the whole site. Safe to run again.
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { connect } from "./lib/hax-api.mjs";

const SITE_DIR = process.env.SITE_DIR || new URL("../learning-materials/", import.meta.url).pathname;
const SITE = process.env.HAX_SITE || "learning-materials";
const DRY = process.argv.includes("--dry-run");
const ALL = process.argv.includes("--all");

const items = JSON.parse(readFileSync(path.join(SITE_DIR, "site.json"), "utf8")).items;
const live = items.filter((i) => !i.metadata?.oerSnapshotOf);
const kids = new Map();
for (const i of live) kids.set(i.parent || null, [...(kids.get(i.parent || null) || []), i]);
for (const list of kids.values()) list.sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));

// a page with nothing on it: no text, no media, no blocks
function empty(i) {
  const t = i.metadata?.pageType || "";
  if (i.metadata?.oerRef?.page || t === "oer:heading" || t === "oer:system") return false;
  if (t && t !== "oer:section") return false; // typed pages are content, even when unwritten
  const file = i.location && path.join(SITE_DIR, i.location);
  if (!file || !existsSync(file)) return true;
  const html = readFileSync(file, "utf8").replace(/<page-break[\s\S]*?<\/page-break>/g, "");
  if (/<(img|video|audio|iframe|oer-|multiple-choice|self-check|grid-plate|a11y-)/i.test(html)) return false;
  return html.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim() === "";
}

// where to look: inside books (or everywhere)
const roots = ALL ? kids.get(null) || [] : live.filter((i) => i.metadata?.pageType === "oer:book" && !i.metadata?.oerRef?.page);
const scope = [];
const walk = (id) => (kids.get(id) || []).forEach((c) => (scope.push(c), walk(c.id)));
roots.forEach((r) => (ALL ? (scope.push(r), walk(r.id)) : walk(r.id)));

const out = new Map();
const get = (i) => out.get(i.id) || i;
const set = (i, patch) => out.set(i.id, { ...get(i), ...patch, modified: true });
const descendants = (id) => (kids.get(id) || []).flatMap((c) => [c, ...descendants(c.id)]);
const report = { headings: [], removed: [] };

// deepest first, so a group inside a group lands correctly
const groups = scope.filter((i) => empty(i) && (kids.get(i.id) || []).length).sort((a, b) => (Number(b.indent) || 0) - (Number(a.indent) || 0));
for (const g of groups) {
  const siblings = (kids.get(g.parent || null) || []).map(get).sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
  const held = (kids.get(g.id) || []).map(get);
  // the group's place: heading, then what it held, then the siblings after it
  const at = siblings.findIndex((s) => s.id === g.id);
  const ordered = [...siblings.slice(0, at + 1), ...held, ...siblings.slice(at + 1)];
  ordered.forEach((s, n) => {
    if (s.id === g.id) set(g, { order: n, metadata: { ...get(g).metadata, pageType: "oer:heading", hideInMenu: true } });
    else if (held.some((h) => h.id === s.id)) set(s, { parent: g.parent || null, order: n, indent: Math.max(0, (Number(get(s).indent) || 1) - 1) });
    else if (Number(s.order) !== n) set(s, { order: n });
  });
  // what the held pages hold moves up a level with them
  for (const h of held) for (const d of descendants(h.id)) set(d, { indent: Math.max(0, (Number(get(d).indent) || 1) - 1) });
  // the heading now holds nothing
  kids.set(g.parent || null, ordered.map((s) => items.find((i) => i.id === s.id)));
  kids.set(g.id, []);
  report.headings.push(`${items.find((i) => i.id === g.parent)?.title || "(top)"} › ${g.title} (${held.length})`);
}
for (const i of scope.filter((x) => empty(x) && !(kids.get(x.id) || []).length && get(x).metadata?.pageType !== "oer:heading")) {
  out.set(i.id, { ...i, delete: true });
  report.removed.push(`${items.find((x) => x.id === i.parent)?.title || "(top)"} › ${i.title}`);
}

console.log(`${report.headings.length} empty pages become headings; ${report.removed.length} empty pages removed${DRY ? " (dry run)" : ""}`);
for (const h of report.headings) console.log(`  ▸ ${h}`);
for (const r of report.removed) console.log(`  ✕ ${r}`);
if (DRY || !out.size) process.exit(0);
const api = await connect();
const res = await api.call("PATCH", "/x/api/v1/site/outline", { headers: api.headers, body: { site: { name: SITE }, items: [...out.values()] } });
if (!res.ok) throw new Error(`outline save failed (${res.status}): ${JSON.stringify(res.json).slice(0, 300)}`);
console.log(`saved ${out.size} items`);
