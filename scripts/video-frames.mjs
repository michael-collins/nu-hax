// Screenshots from a video at chosen moments (the video-to-page skill,
// step 3), into <work>/frames/. Each is the sharpest of a few frames from
// the moment to 0.8 s after it, so a screenshot doesn't land mid-transition.
//   node scripts/video-frames.mjs <work folder> <time> [<time> …] [--width 1600] [--exact]
// Times are "1:30", "1:02:30" or seconds ("90", "90.5"). Prints the file for
// each, named by the time it was taken (frames/t0090.4.jpg), for the page's
// <img src="frames/…">.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { seconds, clock } from "./lib/vtt.mjs";

const args = process.argv.slice(2);
const opt = (name, fallback = "") => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const [work, ...rest] = args.filter((a, i) => !a.startsWith("--") && !["--width"].includes(args[i - 1]));
if (!work || !rest.length) {
  console.error("usage: node scripts/video-frames.mjs <work folder> <time> [<time> …] [--width 1600] [--exact]");
  process.exit(1);
}
const meta = JSON.parse(readFileSync(path.join(work, "meta.json"), "utf8"));
if (!meta.video || !existsSync(meta.video)) {
  console.error("This work folder has no video (it was made with --no-video, or the video was removed). Run video-source.mjs again.");
  process.exit(1);
}
const WIDTH = Number(opt("--width", "1600"));
const OFFSETS = args.includes("--exact") ? [0] : [0, 0.4, 0.8];
const frames = path.join(work, "frames");
mkdirSync(frames, { recursive: true });

const grab = (t, file) =>
  execFileSync("ffmpeg", ["-v", "error", "-y", "-ss", String(t), "-i", meta.video, "-frames:v", "1", "-vf", `scale='min(${WIDTH},iw)':-2`, "-q:v", "3", file]);
// blurdetect: lower is sharper
const blur = (file) => {
  const r = spawnSync("ffmpeg", ["-v", "error", "-i", file, "-vf", "blurdetect,metadata=print:file=-", "-f", "null", "-"], { encoding: "utf8" });
  const m = (r.stdout || "").match(/lavfi\.blur=([\d.]+)/);
  return m ? Number(m[1]) : Infinity;
};
const name = (t) => `t${t.toFixed(1).padStart(6, "0")}.jpg`;

for (const raw of rest) {
  const at = seconds(raw);
  if (at === null || at < 0 || (meta.duration && at > meta.duration)) {
    console.log(`${raw}: not a time in this video (it's ${clock(meta.duration)} long)`);
    continue;
  }
  const tries = OFFSETS.map((o) => Math.min(at + o, Math.max(0, (meta.duration || at) - 0.1)))
    .filter((t, i, all) => all.indexOf(t) === i)
    .map((t) => {
      const file = path.join(frames, `try-${t.toFixed(1)}.jpg`);
      grab(t, file);
      return { t, file, blur: OFFSETS.length > 1 ? blur(file) : 0 };
    });
  const best = tries.reduce((a, b) => (b.blur < a.blur ? b : a));
  const out = path.join(frames, name(best.t));
  renameSync(best.file, out);
  for (const t of tries) if (t !== best) rmSync(t.file, { force: true });
  console.log(`${clock(at)} → frames/${path.basename(out)}`);
}
