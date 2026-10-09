// Book sites (the user's request, 2026-10-09): a book on its own at
// /book/<short name>, switched on from the book's page. This adds the
// type (custom/src/types/book-site.js BOOK_SITE_DEF) to the site's content
// types, so Page details and the type lists know it.
//   node --env-file=.env.local scripts/book-site-type.mjs [--dry-run]
// HAX_BASE and SITE_DIR point it at another copy (a scratch server). Safe to run again.
import { readFileSync } from "node:fs";
import path from "node:path";
import { connect } from "./lib/hax-api.mjs";

const SITE_DIR = process.env.SITE_DIR || new URL("../learning-materials/", import.meta.url).pathname;
const SITE = process.env.HAX_SITE || "learning-materials";
const DRY = process.argv.includes("--dry-run");
// mirrors BOOK_SITE_DEF in custom/src/types/book-site.js
const DEF = {
  id: "oer:book-site",
  label: "Book site",
  icon: "oer:book-a",
  description: "A book on its own, at a short address, for readers: its chapters, reading settings, and PDF and EPUB downloads.",
  children: [],
  nav: false,
  fields: [{ name: "book", label: "Book", kind: "relation", types: ["oer:book"], header: true, required: true, help: "The book this site shows." }],
};

const items = JSON.parse(readFileSync(path.join(SITE_DIR, "site.json"), "utf8")).items;
const sys = items.find((i) => i.metadata?.pageType === "oer:system");
const raw = sys.metadata.oerContentTypes;
const types = typeof raw === "string" ? JSON.parse(raw) : structuredClone(raw);
if (types.types.some((t) => t.id === DEF.id)) {
  console.log("the Book site type is there already");
  process.exit(0);
}
const at = types.types.findIndex((t) => t.id === "oer:book");
types.types.splice(at >= 0 ? at + 1 : types.types.length, 0, DEF);
console.log(`content types: Book site${DRY ? " (dry run)" : ""}`);
if (DRY) process.exit(0);
const api = await connect();
const res = await api.call("PATCH", "/x/api/v1/site/outline", { headers: api.headers, body: { site: { name: SITE }, items: [{ ...sys, metadata: { ...sys.metadata, oerContentTypes: typeof raw === "string" ? JSON.stringify(types) : types }, modified: true }] } });
if (!res.ok) throw new Error(`outline save failed (${res.status}): ${JSON.stringify(res.json).slice(0, 300)}`);
console.log("saved");
