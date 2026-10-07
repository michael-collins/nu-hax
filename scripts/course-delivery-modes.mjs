// The course type's Delivery field names four modes, since the delivery
// shapes an offering's schedule (class meetings, due dates, module unlocks):
// In person, Hybrid, Online (synchronous), Online (asynchronous). Courses set
// to the old "Online" keep it until someone picks one of the two.
//   node --env-file=.env.local scripts/course-delivery-modes.mjs [--dry-run]
// Safe to run again.
import { readFileSync } from "node:fs";
import path from "node:path";
import { connect } from "./lib/hax-api.mjs";

const SITE_DIR = process.env.SITE_DIR || new URL("../learning-materials/", import.meta.url).pathname;
const SITE = process.env.HAX_SITE || "learning-materials";
const DRY = process.argv.includes("--dry-run");
const MODES = ["In person", "Hybrid", "Online (synchronous)", "Online (asynchronous)"];

const items = JSON.parse(readFileSync(path.join(SITE_DIR, "site.json"), "utf8")).items;
const sys = items.find((i) => i.metadata?.pageType === "oer:system");
const raw = sys.metadata.oerContentTypes;
const types = typeof raw === "string" ? JSON.parse(raw) : structuredClone(raw);
const field = types.types.find((t) => t.id === "oer:course")?.fields?.find((f) => f.name === "delivery");
if (!field) throw new Error("the course type has no delivery field");
const before = field.options.map((o) => o.value);
const inUse = new Set(items.filter((i) => i.metadata?.pageType === "oer:course").map((i) => i.metadata?.oerFields?.delivery).filter(Boolean));
// the four modes, then any older value still in use (so those pages still show it)
const values = [...MODES, ...before.filter((v) => !MODES.includes(v) && inUse.has(v))];
field.options = values.map((v) => ({ value: v, label: v === "Online" ? "Online (choose synchronous or asynchronous)" : v }));
console.log(`delivery options: ${before.join(", ")} -> ${values.join(", ")}${DRY ? " (dry run)" : ""}`);
if (DRY || JSON.stringify(before) === JSON.stringify(values)) process.exit(0);

const out = { ...sys, metadata: { ...sys.metadata, oerContentTypes: typeof raw === "string" ? JSON.stringify(types) : types }, modified: true };
const api = await connect();
const res = await api.call("PATCH", "/x/api/v1/site/outline", { headers: api.headers, body: { site: { name: SITE }, items: [out] } });
if (!res.ok) throw new Error(`outline save failed (${res.status}): ${JSON.stringify(res.json).slice(0, 300)}`);
console.log("saved");
