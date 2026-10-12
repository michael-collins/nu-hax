// Swap a YouTube playlist embedded in exercises and projects for the
// tutorial series made from it (the video-to-page skill, last step): each
// <oer-video>, <oer-iframe> or <video-player> showing that playlist becomes
// <oer-tutorial-series series="…">, and the page records the series it shows
// (metadata.oerTutorialSeries, for the series' "Used in").
//   node --env-file=.env.local scripts/link-series.mjs <playlist link or id> <series id or address>            what would change
//   node --env-file=.env.local scripts/link-series.mjs <playlist link or id> <series id or address> --apply    change it
// Archived versions keep their playlist. It waits until the series and its
// parts are published (--drafts swaps anyway). HAX_BASE and SITE_DIR point it at
// another copy of the site (with HAX_TOKENLESS=1 for a scratch server).
import { readFileSync } from "node:fs";
import path from "node:path";
import { connect } from "./lib/hax-api.mjs";

const SITE_DIR = process.env.SITE_DIR || new URL("../learning-materials/", import.meta.url).pathname;
const SITE = process.env.HAX_SITE || "learning-materials";
const [playlistArg, seriesArg] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const APPLY = process.argv.includes("--apply");
const list = (() => {
  try {
    return new URL(playlistArg).searchParams.get("list");
  } catch {
    return playlistArg;
  }
})();
if (!list || !seriesArg) {
  console.error("usage: node --env-file=.env.local scripts/link-series.mjs <playlist link or id> <series id or address> [--apply]");
  process.exit(1);
}
const items = JSON.parse(readFileSync(path.join(SITE_DIR, "site.json"), "utf8")).items;
const series = items.find((i) => i.id === seriesArg || i.slug === seriesArg.replace(/^\//, ""));
if (!series) {
  console.error(`No page "${seriesArg}"`);
  process.exit(1);
}
const parts = items.filter((i) => i.parent === series.id && i.metadata?.pageType === "oer:tutorial" && !i.metadata?.oerSnapshotOf);
if (!parts.length) {
  console.error(`${series.title} has no parts yet (Tutorial sub-pages); make them first`);
  process.exit(1);
}
// readers see neither a draft series nor draft parts: swapping the playlist
// for them would leave the exercise with no videos
const drafts = [series, ...parts].filter((i) => i.metadata?.published === false);
if (drafts.length && !process.argv.includes("--drafts")) {
  console.error(`Not yet: readers can't see ${drafts.map((i) => i.title).join(", ")} (draft${drafts.length === 1 ? "" : "s"}), so the exercise would lose its videos. Publish them first, or pass --drafts to swap anyway (a scratch copy, say).`);
  process.exit(1);
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// the element showing the playlist, with its closing tag
const EMBED = new RegExp(`<(oer-video|oer-iframe|video-player)\\b[^>]*list=${esc(list)}[^>]*>(?:\\s*</\\1>)?`, "g");
const block = `<oer-tutorial-series series="${series.id}"></oer-tutorial-series>`;

const changes = [];
for (const item of items) {
  if (item.metadata?.oerSnapshotOf || !item.location || item.id === series.id) continue;
  let html;
  try {
    html = readFileSync(path.join(SITE_DIR, item.location), "utf8");
  } catch {
    continue;
  }
  if (!html.includes(`list=${list}`)) continue;
  const found = html.match(EMBED) || [];
  if (!found.length) {
    console.log(`! ${item.title}: mentions the playlist but not in an embed this can swap; left as it is`);
    continue;
  }
  changes.push({ item, found, contents: html.replace(EMBED, block) });
}
if (!changes.length) {
  console.log("No pages embed this playlist.");
  process.exit(0);
}
for (const c of changes) {
  console.log(`${c.item.title} (${c.item.metadata?.pageType}, ${c.item.slug}):`);
  for (const f of c.found) console.log(`  - ${f.slice(0, 160)}`);
  console.log(`  + ${block}`);
}
if (!APPLY) {
  console.log(`\n${changes.length} page${changes.length === 1 ? "" : "s"} would change. Run again with --apply.`);
  process.exit(0);
}
const api = await connect();
const out = changes.map(({ item, contents }) => ({
  ...item,
  contents,
  metadata: { ...item.metadata, oerTutorialSeries: [...new Set([...(item.metadata?.oerTutorialSeries || []), series.id])] },
  modified: true,
}));
const res = await api.call("PATCH", "/x/api/v1/site/outline", { headers: api.headers, body: { site: { name: SITE }, items: out } });
if (!res.ok) throw new Error(`outline save failed (${res.status}): ${JSON.stringify(res.json).slice(0, 300)}`);
console.log(`changed ${changes.length} page${changes.length === 1 ? "" : "s"}`);
