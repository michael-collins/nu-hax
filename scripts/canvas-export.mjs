// Build a Canvas course from an offering plan: a Canvas Course Export
// Package (.imscc) to import with Settings → Import Course Content →
// "Canvas Course Export Package" (tick "Import existing quizzes as New
// Quizzes" if Canvas offers it).
//   node scripts/canvas-export.mjs <offering.json> <out.imscc> [--include-drafts]
//
// The package is built by learning-materials/custom/src/lms/canvas-package.js
// (the course builder uses the same code). Pages and assignment instructions
// embed the live pages, so the offering needs the public site address
// (siteUrl) and the pages must be published there. --include-drafts puts
// draft quiz questions in, for a sandbox test.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { buildCanvasPackage } from "../learning-materials/custom/src/lms/canvas-package.js";
import { zipBytes } from "../learning-materials/custom/src/lms/zip.js";

const SITE_DIR = process.env.SITE_DIR || new URL("../learning-materials/", import.meta.url).pathname;
const args = process.argv.slice(2);
const [planFile, outFile] = args.filter((a) => !a.startsWith("--"));
if (!planFile || !outFile) {
  console.error("usage: node scripts/canvas-export.mjs <offering.json> <out.imscc> [--include-drafts]");
  process.exit(1);
}

const offering = JSON.parse(readFileSync(planFile, "utf8"));
// rubrics come from the site's rubric pages
const items = JSON.parse(readFileSync(path.join(SITE_DIR, "site.json"), "utf8")).items;
const htmlOf = async (item) => {
  const file = item.location && path.join(SITE_DIR, item.location);
  return file && existsSync(file) ? readFileSync(file, "utf8") : "";
};

// attachments for File items: the site's own files, read from disk
const fileOf = async (url) => {
  if (/^https?:\/\//.test(url)) return null;
  const file = path.join(SITE_DIR, decodeURIComponent(url.replace(/^\/+/, "").split("?")[0]));
  return existsSync(file) ? new Uint8Array(readFileSync(file)) : null;
};

const { files, report } = await buildCanvasPackage({ offering, items, htmlOf, fileOf, includeDrafts: args.includes("--include-drafts") });
writeFileSync(outFile, zipBytes(files));
const c = report.counts;
console.log(`${outFile}: ${c.modules} modules, ${c.pages} pages, ${c.assignments} assignments, ${c.discussions} discussions, ${c.quizzes} quizzes, ${c.links} links, ${c.files} files, ${c.rubrics} rubrics, ${c.events} calendar events (${files.length} files in the package)`);
for (const w of report.warnings) console.log(`  ! ${w}`);
