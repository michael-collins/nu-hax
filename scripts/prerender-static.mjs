// Build a static copy of the site for publishing, with each page's citation
// metadata in real HTML, so crawlers that don't run JavaScript (Google
// Scholar) see it:
//   node scripts/prerender-static.mjs <out-dir> [--domain https://example.org/path/]
//
// The site folder is copied to <out-dir>, then every published page gets
// <out-dir>/<slug>/index.html: the site's index.html (the app still loads
// and routes to the page) with the page's <title>, description, canonical
// link, Highwire Press citation_* tags and Dublin Core tags, the same values
// the theme writes in the browser (types/oer-page-footer.js). Static hosts
// such as GitHub Pages serve those files directly.
//
// --domain (or the site's own domain setting) makes the links absolute,
// which Google Scholar needs; without it they are relative.
import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync, rmSync, lstatSync } from "node:fs";
import path from "node:path";

const SITE_DIR = new URL("../learning-materials/", import.meta.url).pathname;
const args = process.argv.slice(2);
const OUT = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--domain");
if (!OUT) {
  console.error("usage: node scripts/prerender-static.mjs <out-dir> [--domain https://example.org/path/]");
  process.exit(1);
}
const site = JSON.parse(readFileSync(path.join(SITE_DIR, "site.json"), "utf8"));
const domainArg = args.includes("--domain") ? args[args.indexOf("--domain") + 1] : "";
const DOMAIN = (domainArg || site.metadata?.site?.domain || "").replace(/\/?$/, "/");
const abs = (rel) => (DOMAIN !== "/" ? new URL(rel, DOMAIN).href : rel);

const items = site.items;
const byId = new Map(items.map((i) => [i.id, i]));
const SITE_TITLE = site.title || "";
const SITE_AUTHOR = site.metadata?.author?.name || "";
const sys = items.find((i) => i.metadata?.pageType === "oer:system");
const types = sys?.metadata?.oerContentTypes?.types || [];
const typeOf = (id) => types.find((t) => t.id === id) || { fields: [] };

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const pad = (n) => String(n).padStart(2, "0");
const ymd = (d, sep = "/") => `${d.getFullYear()}${sep}${pad(d.getMonth() + 1)}${sep}${pad(d.getDate())}`;
const CC = (code) => {
  const c = String(code || "").trim();
  if (/^cc0/i.test(c)) return "https://creativecommons.org/publicdomain/zero/1.0/";
  const m = c.match(/^CC\s+([A-Z-]+)\s+(\d\.\d)$/i);
  return m ? `https://creativecommons.org/licenses/${m[1].toLowerCase()}/${m[2]}/` : c;
};

// a page's fields, with its type's defaults (as the footer reads them)
function fieldsOf(item) {
  const values = { ...(item.metadata?.oerFields || {}) };
  for (const f of typeOf(item.metadata?.pageType).fields || []) {
    if ((values[f.name] === undefined || values[f.name] === "") && f.default) values[f.name] = f.default;
  }
  return values;
}

function citeInfo(item) {
  const isSnap = !!item.metadata?.oerSnapshotOf;
  const pageId = item.metadata?.oerSnapshotOf || item.id;
  const page = byId.get(pageId) || item;
  // linked chapters credit their source
  const src = item.metadata?.oerRef?.page ? byId.get(item.metadata.oerRef.page) || item : item;
  const f = fieldsOf(src);
  const authors = (Array.isArray(f.authors) ? f.authors : []).map((a) => (typeof a === "object" ? a.name : a)).filter(Boolean);
  if (!authors.length && f.author) authors.push(String(f.author));
  if (!authors.length && SITE_AUTHOR) authors.push(SITE_AUTHOR);
  const version = item.metadata?.version || "";
  const release = version ? (page.metadata?.oerVersions || []).find((r) => r.version === version) : null;
  const snap = version ? items.find((i) => i.metadata?.oerSnapshotOf === pageId && i.metadata?.version === version) : null;
  const pinned = isSnap || !!snap;
  const fieldDate = f.date ? new Date(f.date) : null;
  const issued =
    release?.date && Number(release.date)
      ? new Date(Number(release.date) * 1000)
      : fieldDate && !Number.isNaN(fieldDate.getTime())
        ? fieldDate
        : new Date((item.metadata?.updated || item.metadata?.created || Date.now() / 1000) * 1000);
  const permalink = abs(`?p=${pageId}${pinned && version ? `&version=${version}` : ""}`);
  return { title: item.metadata?.oerSnapshotTitle || item.title, authors, issued, version, permalink, license: f.license, description: item.description || src.description || "" };
}

function headFor(item) {
  const c = citeInfo(item);
  const updated = item.metadata?.updated ? new Date(item.metadata.updated * 1000) : null;
  const tags = String(item.metadata?.tags || "").split(",").map((t) => t.trim()).filter(Boolean);
  const people = c.authors.length ? c.authors : [SITE_TITLE];
  const meta = [
    ["citation_title", c.title],
    ...people.map((a) => ["citation_author", a]),
    ["citation_publication_date", ymd(c.issued)],
    ...(updated ? [["citation_online_date", ymd(updated)]] : []),
    ["citation_publisher", SITE_TITLE],
    ["citation_public_url", c.permalink],
    ["citation_abstract_html_url", abs(item.slug)],
    ["citation_language", "en"],
    ...(tags.length ? [["citation_keywords", tags.join("; ")]] : []),
    ["DC.title", c.title],
    ...people.map((a) => ["DC.creator", a]),
    ["DC.date", ymd(c.issued, "-")],
    ["DC.publisher", SITE_TITLE],
    ["DC.identifier", c.permalink],
    ["DC.language", "en"],
    ["DC.type", "Text"],
    ...(c.license ? [["DC.rights", CC(c.license)]] : []),
    ...(c.description ? [["DC.description", c.description]] : []),
  ];
  return [
    ...meta.filter(([, v]) => v).map(([n, v]) => `  <meta name="${esc(n)}" content="${esc(v)}" data-oer-cite />`),
    ...(DOMAIN !== "/" ? [`  <link rel="canonical" href="${esc(abs(item.slug))}" />`] : []),
  ].join("\n");
}

// 1. the site, copied, without the links hax serve resolves (build/,
// wc-registry.json and others point outside the site; HAX's own copies
// follow)
mkdirSync(OUT, { recursive: true });
cpSync(SITE_DIR, OUT, {
  recursive: true,
  filter: (src) => !/[\\/](\.git|node_modules)([\\/]|$)/.test(src) && !src.endsWith(".env.local") && !lstatSync(src).isSymbolicLink(),
});

// HAX's code: the site's build/ is a link to wherever HAX is installed
// (hax serve supplies it), so copy the real files from the installed
// haxcms-nodejs, plus its loader scripts and component registry where the
// site has none of its own
const HAX_PUBLIC = path.resolve(new URL("../node_modules/@haxtheweb/haxcms-nodejs/dist/public/", import.meta.url).pathname);
if (existsSync(path.join(HAX_PUBLIC, "build"))) {
  rmSync(path.join(OUT, "build"), { recursive: true, force: true });
  cpSync(path.join(HAX_PUBLIC, "build"), path.join(OUT, "build"), { recursive: true, dereference: true });
  for (const f of ["build.js", "build-haxcms.js", "wc-registry.json"]) {
    if (!existsSync(path.join(SITE_DIR, f)) && existsSync(path.join(HAX_PUBLIC, f))) {
      rmSync(path.join(OUT, f), { force: true });
      cpSync(path.join(HAX_PUBLIC, f), path.join(OUT, f));
    }
  }
} else console.warn(`HAX's build not found at ${HAX_PUBLIC}: the copy will need build/ from elsewhere`);

// 2. a page file for every published page
const template = readFileSync(path.join(SITE_DIR, "index.html"), "utf8");
let n = 0;
for (const item of items) {
  if (!item.slug || item.metadata?.published === false) continue;
  if (["oer:system", "oer:heading"].includes(item.metadata?.pageType)) continue;
  const c = citeInfo(item);
  const pageTitle = `${c.title} | ${SITE_TITLE}`;
  // static hosts serve this file at "<slug>/", which HAX's router doesn't
  // match: drop the slash before anything routes
  const unslash = `<script>if(location.pathname.length>1&&location.pathname.endsWith("/"))history.replaceState(null,"",location.pathname.replace(/\\/+$/,"")+location.search+location.hash)</script>`;
  let html = template
    .replace(/<head>/, `<head>\n  ${unslash}`)
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(pageTitle)}</title>`)
    .replace(/(<meta name="description" content=")[^"]*(")/, `$1${esc(c.description)}$2`)
    .replace(/(<meta name="og:description" property="og:description" content=")[^"]*(")/, `$1${esc(c.description)}$2`)
    .replace(/(<meta name="twitter:description" property="twitter:description" content=")[^"]*(")/, `$1${esc(c.description)}$2`)
    .replace(/<\/head>/, `${headFor(item)}\n</head>`);
  const dir = path.join(OUT, item.slug);
  mkdirSync(dir, { recursive: true });
  // a page may have sub-pages, whose folders live inside its own
  writeFileSync(path.join(dir, "index.html"), html);
  n++;
}
console.log(`copied the site to ${OUT}; wrote ${n} page files${DOMAIN !== "/" ? ` for ${DOMAIN}` : " (relative links: pass --domain for absolute ones)"}`);
if (!existsSync(path.join(OUT, "404.html"))) console.log("note: no 404.html in the site");
