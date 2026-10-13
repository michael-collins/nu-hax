// Save a prepared tutorial series to the site and show it where its
// playlist was (the video-to-page skill, playlist steps 3–5 in one go):
// the series page (if it isn't there yet), each part in the playlist's
// order under it (skipping parts already made), then link-series.mjs.
//   node --env-file=.env.local scripts/video-series-save.mjs <playlist work folder> [--dry-run]
// The playlist's folder is video-playlist.mjs's; each part's is
// video-source.mjs's default ($TMPDIR/nu-hax-video/<video id>), with its
// page.json and page.html written. Other people's videos in the playlist
// become video-only parts, made here: the video, credited to its creator,
// with no write-up, transcript or screenshots. HAX_BASE, SITE_DIR and HAX_TOKENLESS
// point it at another copy of the site, as for the scripts it runs.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const work = args.find((a) => !a.startsWith("--"));
const DRY = args.includes("--dry-run");
if (!work) {
  console.error("usage: node --env-file=.env.local scripts/video-series-save.mjs <playlist work folder> [--dry-run]");
  process.exit(1);
}
const BASE = process.env.HAX_BASE || "http://localhost:3000";
const SITE_DIR = process.env.SITE_DIR || new URL("../learning-materials/", import.meta.url).pathname;
const script = (name) => new URL(name, import.meta.url).pathname;
const run = (name, argv) => execFileSync(process.execPath, [script(name), ...argv], { encoding: "utf8", env: process.env, stdio: ["ignore", "pipe", "inherit"] });
const items = async () =>
  fetch(`${BASE}/site.json?${Date.now()}`)
    .then((r) => (r.ok ? r.json() : Promise.reject()))
    .catch(() => JSON.parse(readFileSync(path.join(SITE_DIR, "site.json"), "utf8")))
    .then((j) => j.items);
const madeFrom = (list, source) => list.find((i) => i.metadata?.oerVideoSource?.source === source && !i.metadata?.oerSnapshotOf);
const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};

const meta = JSON.parse(readFileSync(path.join(work, "meta.json"), "utf8"));
if (meta.source?.kind !== "playlist") fail(`${work} isn't a playlist's work folder (video-playlist.mjs makes one)`);
const parts = meta.videos.map((v) => ({ ...v, dir: path.join(os.tmpdir(), "nu-hax-video", v.id) }));
// someone else's video: a part that only embeds it, credited
for (const p of parts) {
  if (!p.channel || p.channel === meta.channel || existsSync(path.join(p.dir, "page.json"))) continue;
  mkdirSync(p.dir, { recursive: true });
  writeFileSync(path.join(p.dir, "meta.json"), JSON.stringify({ id: p.id, source: { kind: "youtube", url: p.url }, title: p.title, channel: p.channel, channelUrl: p.channelUrl || "", duration: p.duration, captions: "none", chapters: [] }, null, 2));
  writeFileSync(path.join(p.dir, "page.json"), JSON.stringify({ type: "oer:tutorial", title: p.title, description: `A video by ${p.channel}, shown here from YouTube.`, videoOnly: true, transcript: false }, null, 1));
  writeFileSync(path.join(p.dir, "page.html"), "<!-- video -->\n");
  console.log(`part ${p.part}: ${p.title} (a video by ${p.channel}: video only)`);
}
for (const p of parts) if (!existsSync(path.join(p.dir, "page.json")) || !existsSync(path.join(p.dir, "page.html"))) fail(`Part ${p.part} (${p.title}) has no page.json and page.html in ${p.dir}`);

// the series page
let list = await items();
let series = madeFrom(list, meta.source.url);
if (series) console.log(`series: ${series.title} (already made, ${series.slug})`);
else if (DRY) console.log(`series: would make ${JSON.parse(readFileSync(path.join(work, "page.json"), "utf8")).title}`);
else {
  process.stdout.write(run("video-page.mjs", [work]));
  list = await items();
  series = madeFrom(list, meta.source.url);
  if (!series) fail("The series page didn't save; nothing else was made.");
}

// its parts, in the playlist's order
for (const p of parts) {
  const page = JSON.parse(readFileSync(path.join(p.dir, "page.json"), "utf8"));
  const done = madeFrom(list, p.url);
  if (done) {
    console.log(`part ${p.part}: ${done.title} (already made${done.parent === series?.id ? "" : `, but not under the series: ${done.slug}`})`);
    continue;
  }
  if (DRY) {
    console.log(`part ${p.part}: would make ${page.title}`);
    continue;
  }
  writeFileSync(path.join(p.dir, "page.json"), JSON.stringify({ ...page, parent: series.slug }, null, 1));
  process.stdout.write(run("video-page.mjs", [p.dir]));
  list = await items();
}

// the playlist becomes the series where it's embedded
if (DRY) console.log("then: link-series.mjs (dry run below)\n" + (series ? run("link-series.mjs", [meta.list, series.slug]) : "(after the series is made)"));
else process.stdout.write(run("link-series.mjs", [meta.list, series.slug, "--apply"]));
