// Check that outline saves keep the navigation in order: the editor numbers
// each parent's children 0, 1, 2… while site.json keeps its own numbers, and
// outline-order.js translates between them (see learning-materials/custom/src/
// outline/outline-order.js). Runs the cases against the site's site.json, as
// HAXcms would load and save them, without saving anything.
//   node scripts/check-outline-order.mjs
import fs from "node:fs";
import { storedOrders, nextStoredOrder } from "../learning-materials/custom/src/outline/outline-order.js";
const site = JSON.parse(fs.readFileSync(new URL("../learning-materials/site.json", import.meta.url), "utf8")).items;
const clone = (x) => JSON.parse(JSON.stringify(x));
const P = (i) => i.parent || null;
// HAX on load: per parent, stable sort by order, then order = rank
function load(items) {
  const out = clone(items);
  const groups = new Map();
  for (const i of out) { if (!groups.has(P(i))) groups.set(P(i), []); groups.get(P(i)).push(i); }
  for (const g of groups.values()) { g.sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0)); g.forEach((i, r) => (i.order = r)); }
  return out;
}
// the server: writes order (parseInt) and parent; deletes; adds
function server(items, sent) {
  const out = clone(items);
  for (const s of sent) {
    const at = out.findIndex((i) => i.id === s.id);
    if (s.delete) { if (at >= 0) out.splice(at, 1); continue; }
    if (at >= 0) Object.assign(out[at], { order: parseInt(s.order), parent: s.parent ?? null, description: out[at].description });
    else out.push({ ...s, order: parseInt(s.order), parent: s.parent ?? null });
  }
  return out;
}
const kids = (items, parent) => load(items).filter((i) => P(i) === parent).sort((a, b) => a.order - b.order).map((i) => i.id);
const storedMap = (items) => new Map(items.map((i) => [i.id, { order: i.order, parent: P(i) }]));
let fails = 0;
function check(name, items, changed, expect) {
  const current = load(items);
  const { items: send, moved } = storedOrders(changed(current), current, storedMap(items));
  const after = server(items, send);
  const bad = [];
  for (const [parent, ids] of Object.entries(expect(current))) if (JSON.stringify(kids(after, parent === "null" ? null : parent)) !== JSON.stringify(ids)) bad.push(parent);
  // no duplicate orders among siblings that the save touched
  const touched = new Set(send.map((s) => P(s)));
  const dups = [...touched].filter((p) => { const o = after.filter((i) => P(i) === p).map((i) => i.order); return new Set(o).size !== o.length; });
  const ok = !bad.length && !dups.length;
  if (!ok) fails++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: sent ${send.length} (${moved.size} siblings renumbered)${bad.length ? ` wrong order under ${bad.join(", ")}` : ""}${dups.length ? ` duplicate orders under ${dups.length} parents` : ""}`);
  return { send, after };
}
const articles = site.find((i) => i.slug === "articles/what-is-design").parent;
const lessons = site.find((i) => i.slug?.startsWith("lessons/") && !i.metadata?.oerSnapshotOf).parent;
const order = (current, parent) => current.filter((i) => P(i) === parent).sort((a, b) => a.order - b.order);

// 1. the link check: 23 pages' contents saved with the editor's ranks
const slugs = ["articles/what-is-design", "articles/digital-design-project-types", "articles/introduction-3", "articles/introduction-4", "projects/project-2", "projects/capstone-project"];
check("content saves keep their place", site, (cur) => cur.filter((i) => slugs.includes(i.slug)).map((i) => ({ ...i, contents: "<p>x</p>", modified: true })),
  (cur) => ({ [articles]: order(cur, articles).map((i) => i.id) }));
const r1 = (() => { const cur = load(site); return storedOrders(cur.filter((i) => slugs.includes(i.slug)).map((i) => ({ ...i, modified: true })), cur, storedMap(site)); })();
console.log("     orders sent:", r1.items.map((i) => `${i.slug.split("/").pop()}=${i.order} (stored ${site.find((s) => s.id === i.id).order})`).join(", "));

// 2. the outline builder moves Articles' last page to the top (it renumbers every row)
check("move the last article to the top", site, (cur) => {
  const list = order(cur, articles);
  const moved = [list[list.length - 1], ...list.slice(0, -1)];
  return moved.map((i, r) => ({ ...i, order: r, modified: i.order !== r })).filter((i) => i.modified);
}, (cur) => { const list = order(cur, articles); return { [articles]: [list[list.length - 1], ...list.slice(0, -1)].map((i) => i.id) }; });

// 3. a page into the middle of Articles, from Lessons
check("move a lesson into the middle of Articles", site, (cur) => {
  const art = order(cur, articles); const les = order(cur, lessons);
  const x = les[0];
  const newArt = [...art.slice(0, 10), x, ...art.slice(10)];
  const out = newArt.map((i, r) => ({ ...i, parent: articles, order: r, modified: i.id === x.id || i.order !== r })).filter((i) => i.modified);
  les.slice(1).forEach((i, r) => { if (i.order !== r) out.push({ ...i, order: r, modified: true }); });
  return out;
}, (cur) => { const art = order(cur, articles); const les = order(cur, lessons); return { [articles]: [...art.slice(0, 10), les[0], ...art.slice(10)].map((i) => i.id), [lessons]: les.slice(1).map((i) => i.id) }; });

// 4. a new page at the end of Articles (order = the number of children, as the Canvas import gives)
check("a new page at the end", site, (cur) => [{ id: "item-new-1", title: "New", parent: articles, order: order(cur, articles).length, metadata: {}, new: true }],
  (cur) => ({ [articles]: [...order(cur, articles).map((i) => i.id), "item-new-1"] }));

// 5. a new page second from the top of Articles
check("a new page near the top", site, (cur) => {
  const art = order(cur, articles);
  return [{ id: "item-new-2", title: "New", parent: articles, order: 1, metadata: {}, new: true }, ...art.slice(1).map((i, r) => ({ ...i, order: r + 2, modified: true }))];
}, (cur) => { const art = order(cur, articles); return { [articles]: [art[0].id, "item-new-2", ...art.slice(1).map((i) => i.id)] }; });

// 6. a delete leaves the rest alone
check("delete a page", site, (cur) => [{ ...order(cur, articles)[3], delete: true }], (cur) => ({ [articles]: order(cur, articles).filter((_, k) => k !== 3).map((i) => i.id) }));

// 7. stored ties (made up): A,B both 5; move C between them
const tied = [{ id: "a", order: 5, parent: "p" }, { id: "b", order: 5, parent: "p" }, { id: "c", order: 6, parent: "p" }, { id: "d", order: 9, parent: "p" }];
check("stored ties, move between them", tied, (cur) => { const [a, b, c, d] = order(cur, "p"); return [{ ...c, order: 1, modified: true }, { ...b, order: 2, modified: true }]; }, () => ({ p: ["a", "c", "b", "d"] }));

// 8. the outline builder with hidden siblings (not in its rows): rows renumbered around them
const hid = [{ id: "a", order: 0, parent: "p" }, { id: "h", order: 3, parent: "p", metadata: { hideInMenu: true } }, { id: "b", order: 7, parent: "p" }, { id: "c", order: 8, parent: "p" }];
check("reorder with a hidden sibling", hid, (cur) => [{ ...cur.find((i) => i.id === "c"), order: 0, modified: true }, { ...cur.find((i) => i.id === "a"), order: 1, modified: true }],
  () => ({ p: ["c", "a", "h", "b"] }));

const cur = load(site);
console.log("next stored order under Articles:", nextStoredOrder(articles, cur, storedMap(site)), "| editor would give", order(cur, articles).length, "| stored max", Math.max(...site.filter((i) => P(i) === articles).map((i) => i.order)));
{ // numbers after a full reorder start at 0 and stay compact
  const cur = load(site);
  const list = order(cur, articles);
  const moved = [list[list.length - 1], ...list.slice(0, -1)].map((i, r) => ({ ...i, order: r, modified: true }));
  const { items: send } = storedOrders(moved, cur, storedMap(site));
  const vals = send.map((i) => i.order).sort((a, b) => a - b);
  console.log("full reorder numbers:", vals[0], "…", vals[vals.length - 1], vals.length === new Set(vals).size ? "(no repeats)" : "(REPEATS)");
}
// 9. consecutive stored numbers: swap the first two (the builder marks both moved)
const run9 = Array.from({ length: 12 }, (_, k) => ({ id: `r${k}`, order: 94 + k, parent: "p" }));
const r9 = check("swap the first two of a consecutive list", run9, (cur) => { const [a, b] = order(cur, "p"); return [{ ...b, order: 0, modified: true }, { ...a, order: 1, modified: true }]; }, () => ({ p: ["r1", "r0", ...run9.slice(2).map((i) => i.id)] }));
console.log("     sent:", r9.send.map((i) => `${i.id}=${i.order}`).join(", "));
// 10. move one page down two places in a consecutive list
const r10 = check("move a page down two places", run9, (cur) => { const l = order(cur, "p"); const n = [l[1], l[2], l[0], ...l.slice(3)]; return n.map((i, r) => ({ ...i, order: r, modified: i.order !== r })).filter((i) => i.modified); }, () => ({ p: ["r1", "r2", "r0", ...run9.slice(3).map((i) => i.id)] }));
console.log("     sent:", r10.send.map((i) => `${i.id}=${i.order}`).join(", "));
console.log(fails ? `${fails} FAILED` : "all passed");
process.exitCode = fails ? 1 : 0;
