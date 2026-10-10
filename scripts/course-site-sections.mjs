// Course sites are made of section blocks (the user's choice, 2026-10-09:
// "Sections as blocks"). The pitch is typed into the sections, so the
// course-site type keeps only its course, enroll link and plan fields; and
// a course site page without sections gets the standard ones, with what the
// page already had kept after the facts and what its old fields held (hero
// image, outcomes, tools, instructor's note, questions) moved into them.
//   node --env-file=.env.local scripts/course-site-sections.mjs [--dry-run]
// HAX_BASE and SITE_DIR point it at another copy (a scratch server). Safe to run again.
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { connect } from "./lib/hax-api.mjs";

const SITE_DIR = process.env.SITE_DIR || new URL("../learning-materials/", import.meta.url).pathname;
const SITE = process.env.HAX_SITE || "learning-materials";
const DRY = process.argv.includes("--dry-run");
const GONE = ["heroImage", "heroImageAlt", "outcomes", "tools", "instructorNote", "faq"];
// mirrors COURSE_SITE_STARTER in custom/src/types/course-site.js: the
// sections without headings, What you'll learn, the tools and the
// questions with an empty item each (the section and item model, scripts/
// course-site-structure.mjs)
const STARTER = [
  "<oer-cs-hero><p></p></oer-cs-hero>",
  "<oer-cs-facts></oer-cs-facts>",
  "<oer-cs-learn><oer-cs-outcome><h3></h3><p></p></oer-cs-outcome></oer-cs-learn>",
  "<oer-cs-semester></oer-cs-semester>",
  "<oer-cs-make></oer-cs-make>",
  "<oer-cs-books></oer-cs-books>",
  "<oer-cs-people><p></p></oer-cs-people>",
  "<oer-cs-tools><oer-cs-tool><p></p></oer-cs-tool></oer-cs-tools>",
  "<oer-cs-faq><oer-cs-question><h3></h3><p></p></oer-cs-question></oer-cs-faq>",
  "<oer-cs-closing></oer-cs-closing>",
];

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const rows = (list) => (Array.isArray(list) ? list : []).map((x) => String(x).trim()).filter(Boolean);
// an outcome a row: its words before a colon or a dash its title, the rest
// its sentence (as the editor splits a list's rows, cs-normalize.js)
const outcomes = (list) =>
  rows(list)
    .map((row) => {
      const at = row.search(/[:—–]\s|\s-\s/);
      const [title, text] = at > 0 ? [row.slice(0, at).trim(), row.slice(at + 1).replace(/^[\s-]+/, "")] : [row, ""];
      return `<oer-cs-outcome><h3>${esc(title)}</h3><p>${esc(text.charAt(0).toUpperCase() + text.slice(1))}</p></oer-cs-outcome>`;
    })
    .join("");
const tools = (list) => rows(list).map((row) => `<oer-cs-tool><p>${esc(row)}</p></oer-cs-tool>`).join("");
const paras = (text) => String(text || "").split(/\n\s*\n/).map((t) => t.trim()).filter(Boolean).map((t) => `<p>${esc(t)}</p>`).join("");
// "Question?" on its own line, its answer under it, a blank line between
// each: a question each, a block that asks nothing the answer's next paragraph
const faq = (text) => {
  const out = [];
  for (const lines of String(text || "").split(/\n\s*\n/).map((b) => b.split("\n").map((l) => l.trim()).filter(Boolean))) {
    if (!lines.length) continue;
    if (/\?$/.test(lines[0])) out.push({ q: lines[0], a: lines.length > 1 ? [lines.slice(1).join(" ")] : [] });
    else if (out.length) out.at(-1).a.push(lines.join(" "));
    else out.push({ q: "", a: [lines.join(" ")] });
  }
  return out.map(({ q, a }) => `<oer-cs-question><h3>${esc(q)}</h3>${(a.length ? a : [""]).map((t) => `<p>${esc(t)}</p>`).join("")}</oer-cs-question>`).join("");
};

/** The starter sections, holding what the old fields had. */
function sections(f) {
  const hero = `<oer-cs-hero${f.heroImage ? ` image="${esc(f.heroImage)}"` : ""}${f.heroImageAlt ? ` alt="${esc(f.heroImageAlt)}"` : ""}><p></p></oer-cs-hero>`;
  const fill = { "oer-cs-learn": outcomes(f.outcomes), "oer-cs-people": paras(f.instructorNote), "oer-cs-tools": tools(f.tools), "oer-cs-faq": faq(f.faq) };
  return [hero, ...STARTER.slice(1)].map((tag) => {
    const name = tag.match(/^<([a-z-]+)/)[1];
    return fill[name] ? `<${name}>${fill[name]}</${name}>` : tag;
  });
}

const items = JSON.parse(readFileSync(path.join(SITE_DIR, "site.json"), "utf8")).items;
const out = [];

// the type's fields
const sys = items.find((i) => i.metadata?.pageType === "oer:system");
const raw = sys.metadata.oerContentTypes;
const types = typeof raw === "string" ? JSON.parse(raw) : structuredClone(raw);
const type = types.types.find((t) => t.id === "oer:course-site");
if (type?.fields?.some((f) => GONE.includes(f.name))) {
  type.fields = type.fields.filter((f) => !GONE.includes(f.name));
  out.push({ ...sys, metadata: { ...sys.metadata, oerContentTypes: typeof raw === "string" ? JSON.stringify(types) : types }, modified: true });
  console.log(`course-site type: fields now ${type.fields.map((f) => f.name).join(", ")}`);
}

// the sites
for (const site of items.filter((i) => i.metadata?.pageType === "oer:course-site" && !i.metadata?.oerSnapshotOf)) {
  const file = path.join(SITE_DIR, site.location || "");
  const html = existsSync(file) ? readFileSync(file, "utf8").trim() : "";
  const f = site.metadata.oerFields || {};
  if (/<oer-cs-/.test(html)) continue;
  const moved = GONE.filter((k) => f[k] !== undefined && f[k] !== "" && !(Array.isArray(f[k]) && !f[k].length));
  // what the page had (beyond an empty paragraph) stays, after the facts
  const own = html.replace(/<p>\s*<\/p>/g, "").trim();
  const parts = sections(f);
  const contents = [...parts.slice(0, 2), ...(own ? [own] : []), ...parts.slice(2)].join("\n");
  out.push({ ...site, contents, metadata: { ...site.metadata, overridePathauto: true, oerFields: { ...f, ...Object.fromEntries(GONE.filter((k) => k in f).map((k) => [k, ""])) } }, modified: true });
  console.log(`/${site.slug}: the standard sections${own ? `, keeping its ${own.length} characters of text after the facts` : ""}${moved.length ? `, with ${moved.join(", ")} moved into them` : ""}`);
}

console.log(`${out.length} item(s) to save${DRY ? " (dry run)" : ""}`);
if (DRY || !out.length) process.exit(0);
const api = await connect();
const res = await api.call("PATCH", "/x/api/v1/site/outline", { headers: api.headers, body: { site: { name: SITE }, items: out } });
if (!res.ok) throw new Error(`outline save failed (${res.status}): ${JSON.stringify(res.json).slice(0, 300)}`);
console.log("saved");
