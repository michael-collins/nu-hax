// Get a video ready to become a page (the video-to-page skill, step 1): its
// details, a clean transcript, and pictures to choose screenshots from.
//   node scripts/video-source.mjs <YouTube link | video file> [options]
// Options:
//   --out <dir>          the work folder (default: $TMPDIR/nu-hax-video/<id>)
//   --lang en            the captions' language
//   --captions <which>   auto (YouTube's own captions, else speech to text,
//                        else YouTube's automatic ones), youtube, or speech
//   --vocab "HAX, Maya"  names and terms to help speech to text spell them
//   --fix "Hack CMS=HAXcms,…"  corrections applied to the transcript
//   --height 1080        the tallest video to download for screenshots
//   --interval <s>       seconds between contact-sheet pictures (default: about 60 in all)
//   --scene 0.1          how big a change in the picture counts as a new scene (0–1)
//   --no-video           details and transcript only (no screenshots)
// Writes to the work folder: meta.json (details, chapters, scenes, contact
// sheets), transcript.vtt (cleaned), transcript.txt ("[m:ss] text", for
// reading), lines.json, video.<ext>, and sheets/sheet-NN.jpg.
//
// Needs yt-dlp and ffmpeg (Homebrew). Speech to text uses mlx-whisper from
// ~/.cache/nu-hax/whisper-venv (or on the PATH), or whisper.cpp's whisper-cli
// with a model in WHISPER_MODEL or ~/.cache/nu-hax/whisper/.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse, clean, toVtt, readable, clock } from "./lib/vtt.mjs";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, fallback = "") => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const VALUED = ["--out", "--lang", "--captions", "--vocab", "--fix", "--height", "--interval", "--scene"];
const input = args.find((a, i) => !a.startsWith("--") && !VALUED.includes(args[i - 1]));
if (!input) {
  console.error("usage: node scripts/video-source.mjs <YouTube link | video file> [--out dir] [--lang en] [--captions auto|youtube|speech] [--vocab terms] [--fix a=b,…] [--no-video]");
  process.exit(1);
}

const LANG = opt("--lang", "en");
const CAPTIONS = opt("--captions", "auto");
const HEIGHT = Number(opt("--height", "1080"));
const SCENE = Number(opt("--scene", "0.1"));
const WANT_VIDEO = !flag("--no-video");
const fixes = Object.fromEntries(
  opt("--fix")
    .split(",")
    .map((p) => p.split("=").map((s) => s.trim()))
    .filter(([a, b]) => a && b),
);

const youtubeId = (s) => {
  try {
    const u = new URL(s);
    const host = u.hostname.replace(/^(www|m)\./, "");
    if (host === "youtu.be") return u.pathname.slice(1).split("/")[0] || null;
    if (host === "youtube.com" || host === "youtube-nocookie.com") {
      if (u.searchParams.get("v")) return u.searchParams.get("v");
      const m = u.pathname.match(/^\/(?:embed|shorts|live)\/([\w-]{11})/);
      return m ? m[1] : null;
    }
  } catch {}
  return null;
};
const slugify = (s) =>
  String(s)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_-]+/g, "-")
    .slice(0, 60) || "video";

const ytId = youtubeId(input);
const isUrl = /^https?:\/\//.test(input);
if (isUrl && !ytId) {
  console.error("Only YouTube links are supported. For another site, download the video and pass the file.");
  process.exit(1);
}
if (!isUrl && !existsSync(input)) {
  console.error(`No such file: ${input}`);
  process.exit(1);
}

const has = (cmd) => spawnSync("which", [cmd]).status === 0;
for (const tool of ["ffmpeg", "ffprobe", ...(ytId ? ["yt-dlp"] : [])]) {
  if (!has(tool)) {
    console.error(`${tool} isn't installed. Install it with: brew install ${tool === "ffprobe" ? "ffmpeg" : tool}`);
    process.exit(1);
  }
}
const run = (cmd, argv, { quiet = true } = {}) => execFileSync(cmd, argv, { encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", quiet ? "pipe" : "inherit"] });
const say = (s) => console.error(`… ${s}`);

/* ---------- where ---------- */

const id = ytId || slugify(path.basename(input, path.extname(input)));
const OUT = path.resolve(opt("--out", path.join(os.tmpdir(), "nu-hax-video", id)));
mkdirSync(OUT, { recursive: true });
const meta = { id, source: ytId ? { kind: "youtube", url: `https://www.youtube.com/watch?v=${ytId}` } : { kind: "file", file: path.resolve(input) }, made: new Date().toISOString() };

/* ---------- details ---------- */

if (ytId) {
  say("Reading the video's details");
  const j = JSON.parse(run("yt-dlp", ["-J", "--no-playlist", "--skip-download", meta.source.url]));
  Object.assign(meta, {
    title: j.title,
    channel: j.channel || j.uploader || "",
    channelUrl: j.channel_url || j.uploader_url || "",
    duration: j.duration || 0,
    uploadDate: j.upload_date ? `${j.upload_date.slice(0, 4)}-${j.upload_date.slice(4, 6)}-${j.upload_date.slice(6, 8)}` : "",
    license: j.license || "",
    description: j.description || "",
    chapters: (j.chapters || []).map((c) => ({ start: c.start_time, end: c.end_time, title: c.title })),
  });
  meta.hasManualCaptions = Object.keys(j.subtitles || {}).some((k) => k === LANG || k.startsWith(`${LANG}-`));
  meta.hasAutoCaptions = Object.keys(j.automatic_captions || {}).some((k) => k === LANG || k === `${LANG}-orig`);
} else {
  const probe = JSON.parse(run("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", meta.source.file]));
  const tags = probe.format?.tags || {};
  Object.assign(meta, {
    title: tags.title || path.basename(input, path.extname(input)),
    channel: tags.artist || tags.author || "",
    channelUrl: "",
    duration: Number(probe.format?.duration) || 0,
    uploadDate: (tags.creation_time || "").slice(0, 10),
    description: tags.comment || tags.description || "",
    chapters: [],
  });
}

/* ---------- the video (for screenshots, and speech to text) ---------- */

let video = null;
if (!ytId) video = meta.source.file;
else if (WANT_VIDEO) {
  video = readdirSync(OUT).find((f) => /^video\.(mp4|webm|mkv|mov)$/.test(f));
  if (video) video = path.join(OUT, video);
  else {
    say(`Downloading the video (up to ${HEIGHT}p, for screenshots)`);
    const H = HEIGHT;
    run("yt-dlp", ["--no-playlist", "--no-progress", "-f", `bv*[height<=${H}][vcodec^=avc1]/bv*[height<=${H}]/b[height<=${H}]/b`, "-o", path.join(OUT, "video.%(ext)s"), meta.source.url]);
    video = readdirSync(OUT).find((f) => /^video\.(mp4|webm|mkv|mov)$/.test(f));
    video = video && path.join(OUT, video);
  }
}
if (video) meta.video = video;

/* ---------- the transcript ---------- */

function speechTool() {
  if (has("whisper-cli")) {
    const dir = path.join(os.homedir(), ".cache/nu-hax/whisper");
    const model = process.env.WHISPER_MODEL || (existsSync(dir) ? readdirSync(dir).filter((f) => /^ggml-.*\.bin$/.test(f)).map((f) => path.join(dir, f))[0] : "");
    if (model && existsSync(model)) return { kind: "whisper-cli", model };
  }
  // mlx-whisper lives in its own Python environment (see the video-to-page skill)
  const venv = path.join(os.homedir(), ".cache/nu-hax/whisper-venv/bin/mlx_whisper");
  const bin = existsSync(venv) ? venv : has("mlx_whisper") ? "mlx_whisper" : "";
  if (bin) return { kind: "mlx_whisper", bin, model: process.env.WHISPER_MODEL || "mlx-community/whisper-large-v3-turbo" };
  return null;
}

function youtubeCaptions(auto) {
  for (const f of readdirSync(OUT)) if (f.startsWith("captions.")) rmSync(path.join(OUT, f));
  const langs = auto ? `${LANG}-orig,${LANG}` : `${LANG},${LANG}-.*`;
  run("yt-dlp", ["--no-playlist", "--skip-download", auto ? "--write-auto-subs" : "--write-subs", "--sub-langs", langs, "--sub-format", "vtt", "-o", path.join(OUT, "captions.%(ext)s"), meta.source.url]);
  const files = readdirSync(OUT).filter((f) => f.startsWith("captions.") && f.endsWith(".vtt"));
  // prefer the original language track over a translation
  const pick = files.find((f) => f.includes(`.${LANG}-orig.`)) || files.find((f) => f.includes(`.${LANG}.`)) || files[0];
  for (const f of files) if (f !== pick) rmSync(path.join(OUT, f));
  return pick ? readFileSync(path.join(OUT, pick), "utf8") : null;
}

function speechToText(tool) {
  // a local file has its sound; a YouTube download for screenshots is
  // picture only, so get the audio on its own
  let audio = video;
  if (ytId) {
    let file = readdirSync(OUT).find((f) => f.startsWith("audio."));
    if (!file) {
      say("Downloading the audio (for speech to text)");
      run("yt-dlp", ["--no-playlist", "--no-progress", "-f", "ba/b", "-o", path.join(OUT, "audio.%(ext)s"), meta.source.url]);
      file = readdirSync(OUT).find((f) => f.startsWith("audio."));
    }
    audio = path.join(OUT, file);
  }
  const wav = path.join(OUT, "speech.wav");
  run("ffmpeg", ["-y", "-v", "error", "-i", audio, "-vn", "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav]);
  say(`Transcribing with ${tool.kind} (this takes a while for long videos)`);
  const vocab = opt("--vocab");
  if (tool.kind === "whisper-cli") {
    // no context from the previous window: it's what sends whisper into
    // loops ("Okay." every second to the end) after a quiet stretch
    run("whisper-cli", ["-m", tool.model, "-f", wav, "-l", LANG, "-mc", "0", "-ovtt", "-of", path.join(OUT, "speech"), ...(vocab ? ["--prompt", vocab] : [])]);
  } else {
    run(tool.bin, [wav, "--model", tool.model, "--language", LANG, "--output-format", "vtt", "--output-dir", OUT, "--output-name", "speech", "--condition-on-previous-text", "False", "--word-timestamps", "True", "--hallucination-silence-threshold", "2", ...(vocab ? ["--initial-prompt", vocab] : [])]);
  }
  rmSync(wav, { force: true });
  return readFileSync(path.join(OUT, "speech.vtt"), "utf8");
}

let raw = null;
const tool = speechTool();
if (ytId && CAPTIONS !== "speech" && meta.hasManualCaptions) {
  say("Getting the video's captions");
  raw = youtubeCaptions(false);
  if (raw) meta.captions = "youtube";
}
if (!raw && CAPTIONS !== "youtube" && tool) {
  raw = speechToText(tool);
  meta.captions = "speech";
}
if (!raw && ytId && CAPTIONS !== "speech" && meta.hasAutoCaptions) {
  say("Getting YouTube's automatic captions");
  raw = youtubeCaptions(true);
  if (raw) meta.captions = "automatic";
}
if (!raw) {
  const why = !ytId || CAPTIONS === "speech" ? "no speech-to-text tool is installed (see the video-to-page skill)" : "the video has no captions and no speech-to-text tool is installed";
  console.error(`No transcript: ${why}.`);
  meta.captions = "none";
}
let lines = [];
if (raw) {
  lines = clean(parse(raw), fixes);
  writeFileSync(path.join(OUT, "transcript.vtt"), toVtt(lines));
  writeFileSync(path.join(OUT, "lines.json"), JSON.stringify(lines));
  writeFileSync(path.join(OUT, "transcript.txt"), readable(lines) + "\n");
  meta.words = lines.reduce((n, l) => n + l.text.split(/\s+/).length, 0);
  // long silences in the transcript: quiet stretches in the video, or
  // speech to text losing its place; either way, worth a look
  const marks = [0, ...lines.flatMap((l) => [l.start, l.end]), meta.duration || 0];
  meta.gaps = [];
  for (let i = 1; i < marks.length; i += 2) if (marks[i] - marks[i - 1] > 90) meta.gaps.push([marks[i - 1], marks[i]]);
}

/* ---------- pictures to choose from ---------- */

if (video) {
  const dur = meta.duration || 0;
  // scene changes: where the picture changes enough to be a new shot or
  // slide. Keyframes only (encoders put one at each cut): seconds, not
  // minutes, and close enough to pick screenshots from
  say("Finding scene changes");
  const scan = spawnSync("ffmpeg", ["-hide_banner", "-skip_frame", "nokey", "-i", video, "-an", "-vf", `scale=320:-2,select='gt(scene,${SCENE})',showinfo`, "-f", "null", "-"], { encoding: "utf8", maxBuffer: 1 << 28 });
  meta.scenes = [...(scan.stderr || "").matchAll(/pts_time:([\d.]+)/g)].map((m) => Math.round(Number(m[1]) * 10) / 10);

  // contact sheets: a picture every `interval` seconds, 12 to a sheet (4
  // across, 3 down). One seek per picture is much faster than decoding the
  // whole video.
  const interval = Number(opt("--interval")) || Math.max(5, Math.ceil(dur / 60 / 5) * 5);
  const sheets = path.join(OUT, "sheets");
  const thumbs = path.join(sheets, "thumbs");
  rmSync(sheets, { recursive: true, force: true });
  mkdirSync(thumbs, { recursive: true });
  say(`Making contact sheets (a picture every ${interval} s)`);
  const times = [];
  for (let t = 0; t < Math.max(dur, 1); t += interval) times.push(t);
  times.forEach((t, n) => run("ffmpeg", ["-v", "error", "-ss", String(t), "-i", video, "-frames:v", "1", "-vf", "scale=480:-2", "-q:v", "4", path.join(thumbs, `${String(n).padStart(4, "0")}.jpg`)]));
  run("ffmpeg", ["-v", "error", "-i", path.join(thumbs, "%04d.jpg"), "-vf", "tile=4x3:padding=4:color=white", "-q:v", "4", path.join(sheets, "sheet-%02d.jpg")]);
  rmSync(thumbs, { recursive: true, force: true });
  meta.sheets = readdirSync(sheets)
    .filter((f) => f.endsWith(".jpg"))
    .sort()
    .map((f, s) => ({ file: path.join(sheets, f), times: times.slice(s * 12, s * 12 + 12) }));
  meta.interval = interval;
}

writeFileSync(path.join(OUT, "meta.json"), JSON.stringify(meta, null, 2));

/* ---------- report ---------- */

const mb = (f) => (f && existsSync(f) ? `${(statSync(f).size / 1e6).toFixed(0)} MB` : "");
console.log(`${meta.title}${meta.channel ? ` — ${meta.channel}` : ""} (${clock(meta.duration)})`);
console.log(`work folder: ${OUT}`);
console.log(`transcript: ${meta.captions === "none" ? "none" : `${meta.words} words from ${meta.captions === "youtube" ? "the video's captions" : meta.captions === "speech" ? "speech to text" : "YouTube's automatic captions (no punctuation; check names)"} → transcript.txt`}`);
if (meta.gaps?.length) console.log(`check the transcript: nothing said ${meta.gaps.map(([a, b]) => `${clock(a)}–${clock(b)}`).join(", ")} (a quiet stretch, or speech to text lost its place; try again with --captions youtube or without --vocab)`);
if (meta.chapters.length) console.log(`chapters: ${meta.chapters.map((c) => `${clock(c.start)} ${c.title}`).join(" · ")}`);
if (video) {
  console.log(`video: ${video} ${mb(video)}`);
  console.log(`scene changes: ${meta.scenes.length}${meta.scenes.length ? ` (${meta.scenes.slice(0, 40).map(clock).join(", ")}${meta.scenes.length > 40 ? ", …" : ""})` : ""}`);
  for (const s of meta.sheets) console.log(`${path.relative(OUT, s.file)}: ${s.times.map(clock).join(", ")} (left to right, top to bottom)`);
}
