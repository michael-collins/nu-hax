// Turn a work folder (video-source.mjs, video-frames.mjs, and the page.json
// and page.html written from them) into a draft page on the site (the
// video-to-page skill, step 4).
//   node --env-file=.env.local scripts/video-page.mjs <work folder> [--dry-run] [--again]
// HAX_BASE points it at another copy of the site (a scratch server, say);
// the site must be running (`hax serve` in learning-materials).
//
// page.json: { type: "oer:tutorial" | "oer:lecture" | …, title, description,
//   parent?: id or address (default: the type's listing page, Tutorials…),
//   fields?: the type's fields ({ difficulty, authors: [{ name, url }], … });
//            a value "frames/…" becomes the uploaded image's address,
//   video?: false to leave the video out (a series page: its work folder is
//           video-playlist.mjs's), or a link for a local recording that's
//           online somewhere,
//   transcript?: false to leave the transcript out }
// page.html: the page's content. Conventions:
//   [1:30]                 → a timestamp that plays the video from there
//                            (plain text when there's no video)
//   <img src="frames/…">   → uploaded to the site's files (alt is required)
//   <!-- video -->         → where the video goes (default: the top)
// The transcript goes at the end, folded, a paragraph per ~40 s, each with
// its timestamp. The page is made unpublished; nothing is published.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { connect } from "./lib/hax-api.mjs";
import { paragraphs, clock, seconds } from "./lib/vtt.mjs";

const args = process.argv.slice(2);
const work = args.find((a) => !a.startsWith("--"));
if (!work) {
  console.error("usage: node --env-file=.env.local scripts/video-page.mjs <work folder> [--dry-run] [--again]");
  process.exit(1);
}
const BASE = process.env.HAX_BASE || "http://localhost:3000";
const SITE = process.env.HAX_SITE || "learning-materials";
const SITE_DIR = process.env.SITE_DIR || new URL("../learning-materials/", import.meta.url).pathname;
const read = (f) => readFileSync(path.join(work, f), "utf8");
const meta = JSON.parse(read("meta.json"));
const page = JSON.parse(read("page.json"));
let body = read("page.html");

// where each type's pages are listed (custom/src/types/type-homes.js HOME_TITLES)
const HOME_TITLES = { "oer:lecture": "Lectures", "oer:tutorial": "Tutorials", "oer:lesson": "Lessons", "oer:article": "Articles", "oer:resource": "Resources" };

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = (s) => esc(s).replace(/"/g, "&quot;");
const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};

if (!page.title) fail("page.json needs a title");
if (!page.type) fail("page.json needs a type (oer:tutorial, oer:lecture, …)");

/* ---------- the video ---------- */

const videoUrl = page.video === false ? "" : typeof page.video === "string" ? page.video : meta.source.kind === "youtube" ? meta.source.url : "";
const videoId = videoUrl ? `video-${meta.id.replace(/[^\w-]/g, "")}` : "";
const videoBlock = videoUrl
  ? `<oer-video id="${videoId}" src="${escAttr(videoUrl)}" title="${escAttr(meta.title)}"${meta.channel ? ` credit="${escAttr(meta.channel)}"` : ""}${meta.channelUrl ? ` credit-url="${escAttr(meta.channelUrl)}"` : ""}></oer-video>`
  : "";

// [1:30] in text (never inside a tag) → a timestamp
const STAMP = /\[(\d{1,2}:\d{2}(?::\d{2})?)\]/g;
const stamp = (t) => {
  const s = seconds(t);
  return videoId ? `<page-anchor target="#${videoId}" value="${Math.floor(s)}">${clock(s)}</page-anchor>` : clock(s);
};
const stamps = (html) =>
  html
    .split(/(<[^>]+>)/)
    .map((seg, i) => (i % 2 ? seg : seg.replace(STAMP, (m, t) => (seconds(t) === null ? m : stamp(t)))))
    .join("");

body = stamps(body.trim());
body = body.includes("<!-- video -->") ? body.replace("<!-- video -->", videoBlock) : `${videoBlock}\n${body}`;

/* ---------- the transcript ---------- */

if (page.transcript !== false && existsSync(path.join(work, "lines.json"))) {
  const paras = paragraphs(JSON.parse(read("lines.json")));
  const source = meta.captions === "automatic" ? "YouTube's automatic captions" : meta.captions === "speech" ? "speech to text" : "the video's captions";
  body += `\n<a11y-collapse heading-button><p slot="heading">Transcript</p><div slot="content"><p><em>From ${source}.</em></p>${paras
    .map((p) => `<p>${videoId ? `${stamp(clock(p.start))} ` : `${clock(p.start)} `}${esc(p.text)}</p>`)
    .join("")}</div></a11y-collapse>`;
}

/* ---------- screenshots ---------- */

const frameRefs = new Set();
for (const m of body.matchAll(/<img\b[^>]*>/g)) {
  const tag = m[0];
  const src = tag.match(/\bsrc="([^"]*)"/)?.[1] || "";
  if (!src.startsWith("frames/")) continue;
  if (!/\balt="/.test(tag)) fail(`${src} has no alt text: add alt="…" (or alt="" if it's decorative)`);
  if (!existsSync(path.join(work, src))) fail(`${src} isn't in the work folder: run video-frames.mjs for it`);
  frameRefs.add(src);
}
const fields = { ...(page.fields || {}) };
for (const v of Object.values(fields)) if (typeof v === "string" && v.startsWith("frames/")) frameRefs.add(v);

// anything written besides the video and transcript
const written = read("page.html").replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]+>/g, "").trim().length > 0;

const finalFile = path.join(work, "final.html");
writeFileSync(finalFile, body);
console.log(`page: ${page.title} (${page.type}), ${frameRefs.size} screenshots, ${body.length} characters → ${finalFile}`);
if (args.includes("--dry-run")) process.exit(0);

/* ---------- the site ---------- */

let api;
try {
  api = await connect({ base: BASE, site: SITE });
} catch (e) {
  fail(`Couldn't sign in to ${BASE} (${e.message}). Is the site running (hax serve in learning-materials), and is HAX_PASSWORD in .env.local?`);
}
const items = await fetch(`${BASE}/site.json`)
  .then((r) => (r.ok ? r.json() : Promise.reject()))
  .catch(() => JSON.parse(readFileSync(path.join(SITE_DIR, "site.json"), "utf8")))
  .then((j) => j.items);

const source = videoUrl || meta.source.url || meta.source.file;
const before = items.filter((i) => i.metadata?.oerVideoSource?.source === source && !i.metadata?.oerSnapshotOf);
if (before.length && !args.includes("--again")) {
  fail(`Already made from this video: ${before.map((i) => `${i.title} (${BASE}/${i.slug})`).join(", ")}. Pass --again to make another.`);
}

let parent = null;
if (page.parent) {
  parent = items.find((i) => i.id === page.parent || i.slug === page.parent.replace(/^\//, ""));
  if (!parent) fail(`No page "${page.parent}" to put it under (give an id or an address)`);
} else if (HOME_TITLES[page.type]) {
  parent = items.find((i) => !i.parent && i.title === HOME_TITLES[page.type] && !i.metadata?.oerSnapshotOf) || null;
}

// screenshots go in the site's files, named after the page
const slug = page.title.toLowerCase().replace(/[^\w\s-]/g, "").trim().replace(/[\s_-]+/g, "-").slice(0, 50);
const uploaded = new Map();
for (const ref of frameRefs) {
  const name = `${slug}-${path.basename(ref)}`;
  const form = new FormData();
  form.append("file-upload", new Blob([readFileSync(path.join(work, ref))], { type: "image/jpeg" }), name);
  const res = await fetch(`${BASE}/x/api/v1/files`, { method: "POST", headers: { Authorization: api.headers.Authorization, "X-HAXCMS-Site-Token": api.headers["X-HAXCMS-Site-Token"] }, body: form });
  const json = await res.json().catch(() => null);
  const saved = json?.data?.file || json?.file || {};
  const url = saved.url || saved.fullUrl || saved.path || "";
  if (!res.ok || !url) fail(`Uploading ${ref} failed (${res.status})`);
  uploaded.set(ref, url);
}
const contents = body.replace(/(<img\b[^>]*\bsrc=")(frames\/[^"]+)"/g, (m, a, ref) => `${a}${escAttr(uploaded.get(ref) || ref)}"`);
for (const [k, v] of Object.entries(fields)) if (uploaded.has(v)) fields[k] = uploaded.get(v);

const siblings = items.filter((i) => (i.parent || null) === (parent?.id || null));
const batch = `video-${Date.now().toString(36)}`;
const item = {
  id: `item-${randomUUID()}`,
  title: page.title,
  parent: parent?.id || null,
  order: siblings.reduce((n, i) => Math.max(n, Number(i.order) || 0), -1) + 1,
  indent: parent ? (Number(parent.indent) || 0) + 1 : 0,
  location: "",
  description: "",
  metadata: {
    pageType: page.type,
    published: false,
    oerFields: fields,
    // for the tutorial series block: the video's length, and whether there's
    // anything written beside it ("Video only" when there isn't)
    oerVideoSource: { source, batch, captions: meta.captions || "none", ...(meta.source.kind === "playlist" ? { kind: "playlist" } : { duration: Math.round(meta.duration || 0), written }) },
  },
  contents,
  new: true,
};
const res = await api.call("PATCH", "/x/api/v1/site/outline", { headers: api.headers, body: { site: { name: SITE }, items: [item] } });
if (!res.ok) fail(`Saving the page failed (${res.status}): ${JSON.stringify(res.json).slice(0, 300)}`);

// new items get the server's ids; find this one by its batch
const after = await fetch(`${BASE}/site.json?${Date.now()}`).then((r) => r.json()).then((j) => j.items).catch(() => JSON.parse(readFileSync(path.join(SITE_DIR, "site.json"), "utf8")).items);
const made = after.find((i) => i.metadata?.oerVideoSource?.batch === batch);
if (!made) fail("The site saved, but the new page isn't in the outline. Check the site's Page tree.");
// outline saves drop new items' descriptions
if (page.description) await api.updateItem(made.id, "setDescription", { description: page.description });
console.log(`made a draft: ${made.title}`);
console.log(`  ${BASE}/${made.slug}`);
console.log(`  under ${parent ? parent.title : "the top level"}; ${uploaded.size} screenshots uploaded; unpublished until you publish it`);
