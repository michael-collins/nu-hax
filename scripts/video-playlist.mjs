// A YouTube playlist, ready to become a tutorial series (the video-to-page
// skill): its videos in order, and the site's pages that embed it.
//   node scripts/video-playlist.mjs <playlist link> [--out dir]
// Writes <work>/meta.json (the series' work folder, for video-page.mjs with
// page.json "video": false) and prints each video's link, for video-source.mjs.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { clock } from "./lib/vtt.mjs";

const args = process.argv.slice(2);
const opt = (name, fallback = "") => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const input = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--out");
const list = (() => {
  try {
    return new URL(input).searchParams.get("list");
  } catch {
    return /^[\w-]{12,}$/.test(input || "") ? input : null;
  }
})();
if (!list) {
  console.error("usage: node scripts/video-playlist.mjs <playlist link or id> [--out dir]");
  process.exit(1);
}
const SITE_DIR = process.env.SITE_DIR || new URL("../learning-materials/", import.meta.url).pathname;
const url = `https://www.youtube.com/playlist?list=${list}`;
const j = JSON.parse(execFileSync("yt-dlp", ["--flat-playlist", "-J", url], { encoding: "utf8", maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "pipe"] }));
const videos = (j.entries || []).map((e, n) => ({ part: n + 1, id: e.id, title: e.title, duration: e.duration || 0, channel: e.channel || e.uploader || "", url: `https://www.youtube.com/watch?v=${e.id}` }));
// a playlist can collect other people's videos: who made each one matters
// (write-ups and screenshots only of the owner's own, unless they agree)
const owner = j.channel || j.uploader || "";
const others = videos.filter((v) => v.channel !== owner);

const OUT = path.resolve(opt("--out", path.join(os.tmpdir(), "nu-hax-video", `playlist-${list}`)));
mkdirSync(OUT, { recursive: true });
const meta = { id: `playlist-${list}`, source: { kind: "playlist", url }, list, title: j.title, channel: j.channel || j.uploader || "", channelUrl: j.channel_url || j.uploader_url || "", duration: videos.reduce((s, v) => s + v.duration, 0), description: j.description || "", videos, captions: "none" };
writeFileSync(path.join(OUT, "meta.json"), JSON.stringify(meta, null, 2));

// pages that embed this playlist (their playlist becomes the series block: link-series.mjs)
const items = existsSync(path.join(SITE_DIR, "site.json")) ? JSON.parse(readFileSync(path.join(SITE_DIR, "site.json"), "utf8")).items : [];
const embeds = items.filter((i) => {
  if (i.metadata?.oerSnapshotOf || !i.location) return false;
  try {
    return readFileSync(path.join(SITE_DIR, i.location), "utf8").includes(`list=${list}`);
  } catch {
    return false;
  }
});

console.log(`${meta.title} — ${meta.channel} (${videos.length} videos, ${clock(meta.duration)})`);
console.log(`work folder: ${OUT}`);
for (const v of videos) console.log(`  ${v.part}. ${v.title} (${clock(v.duration)})${v.channel !== owner ? ` — by ${v.channel || "unknown (private or removed)"}` : ""} ${v.url}`);
if (others.length) console.log(`! ${others.length} of ${videos.length} videos aren't ${owner}'s own: don't write them up or take screenshots without permission`);
console.log(embeds.length ? `embedded in: ${embeds.map((i) => `${i.title} (${i.metadata?.pageType}, ${i.slug})`).join("; ")}` : "embedded in: no pages");
