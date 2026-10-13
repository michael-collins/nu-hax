// Restore what the proof-of-concept Decap seed (2026-09-30) left out of the
// two exercises it made, before fields were mapped; later imports skipped
// them because they already existed (docs/decap-migration-audit.md):
// the header image (uploaded from Decap's public/uploads, with alt text
// written for it), difficulty, author, licence, AI licences, Allow
// embedding, Animated textures' attachment, and each page's link to its
// Decap source. Courses are left for the course-link fix.
//   node --env-file=.env.local scripts/restore-seed-exercises.mjs [--dry-run]
// HAX_BASE and SITE_DIR point it at another copy of the site.
import { readFileSync } from "node:fs";
import path from "node:path";
import { connect } from "./lib/hax-api.mjs";

const SITE_DIR = process.env.SITE_DIR || new URL("../learning-materials/", import.meta.url).pathname;
const SITE = process.env.HAX_SITE || "learning-materials";
const BASE = process.env.HAX_BASE || "http://localhost:3000";
const DECAP = process.env.DECAP_DIR || path.join(process.env.HOME, "Documents/repos/open-curriculum/oerschema/learning-materials-decapcms");
const DRY = process.argv.includes("--dry-run");

const AUTHOR = [{ name: "Michael Collins", url: "https://michaelcollins.xyz" }];
const AI = ["AIUL-WA", "AIUL-NA-3D"];
const PAGES = [
  {
    slug: "exercises/animating-a-bouncing-ball",
    source: "exercises/animating-a-bouncing-ball",
    image: { from: "public/uploads/recmjJ85mfZrRGRFu_image_viewport-render.png", name: "animating-a-bouncing-ball-viewport-render.png" },
    fields: {
      imageAlt: "The bouncing ball's motion path in Blender: the ball at the start of its arc, top left, and a blue line through orange keyframe dots that bounces four times, each bounce lower and shorter than the last.",
      difficulty: "Beginner",
      authors: AUTHOR,
      license: "CC BY 4.0",
      aiLicense: AI,
      allowEmbed: true,
    },
  },
  {
    slug: "exercises/animated-textures",
    source: "exercises/animated-textures",
    image: { from: "public/uploads/recn4C0llk2Kq5tuH_image_ex-7-intro-banner-compressed.jpg", name: "animated-textures-intro-banner.jpg" },
    fields: {
      imageAlt: "A render of an old television on a low wooden table in a dark room; its screen glows white with a small squiggle on it.",
      difficulty: "Beginner",
      authors: AUTHOR,
      license: "CC BY 4.0",
      aiLicense: AI,
      allowEmbed: true,
      placeholder: false,
      attachments: [
        {
          title: "Image Sequence Download",
          url: "https://drive.google.com/file/d/1b76RfhJXkYOcGn4wCPtNed6XFYwjR6nG/view?usp=sharing",
          description: "This is a link to a Google Drive folder where you can download the image sequence mentioned in the instructions.",
        },
      ],
    },
  },
];

const items = JSON.parse(readFileSync(path.join(SITE_DIR, "site.json"), "utf8")).items;
const api = DRY ? null : await connect();
const out = [];
for (const p of PAGES) {
  const item = items.find((i) => i.slug === p.slug && !i.metadata?.oerSnapshotOf);
  if (!item) throw new Error(`No page at ${p.slug}`);
  let image = item.metadata?.oerFields?.image || "";
  if (!image && !DRY) {
    const form = new FormData();
    form.append("file-upload", new Blob([readFileSync(path.join(DECAP, p.image.from))]), p.image.name);
    const res = await fetch(`${BASE}/x/api/v1/files`, { method: "POST", headers: { Authorization: api.headers.Authorization, "X-HAXCMS-Site-Token": api.headers["X-HAXCMS-Site-Token"] }, body: form });
    const json = await res.json().catch(() => null);
    const saved = json?.data?.file || json?.file || {};
    image = saved.url || saved.fullUrl || saved.path || "";
    if (!res.ok || !image) throw new Error(`Uploading ${p.image.name} failed (${res.status})`);
  }
  const before = item.metadata?.oerFields || {};
  const fields = { ...before, ...p.fields, image: image || `(upload ${p.image.name})` };
  console.log(`${item.title}: ${Object.keys(p.fields).concat("image").filter((k) => JSON.stringify(before[k]) !== JSON.stringify(fields[k])).join(", ")}${item.metadata?.oerSource ? "" : "; Decap source link"}`);
  out.push({ ...item, metadata: { ...item.metadata, oerSource: item.metadata?.oerSource || p.source, oerFields: fields }, modified: true });
}
if (DRY) process.exit(0);
const res = await api.call("PATCH", "/x/api/v1/site/outline", { headers: api.headers, body: { site: { name: SITE }, items: out } });
if (!res.ok) throw new Error(`outline save failed (${res.status}): ${JSON.stringify(res.json).slice(0, 300)}`);
console.log("saved");
