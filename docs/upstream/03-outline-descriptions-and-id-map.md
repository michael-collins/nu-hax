# 03 and 04: outline saves drop descriptions and don't report new ids

**Repo:** haxcms-nodejs · **Forms:** one Bug report (descriptions) and one Feature request (id map) · **Project:** haxcms-nodejs (backend)
**Patch:** `patches/haxcms-nodejs--outline-descriptions-and-id-map.patch` (one small PR closing both issues; it can be split if preferred)

## Issue 03 (bug)

**Title:** `[haxcms-nodejs] PATCH /x/api/v1/site/outline ignores item descriptions`

**What happened?**

`description` is part of a JSON Outline Schema item, but saveOutline never reads it. For new and existing items alike, a description sent with the outline is dropped. Clients that create pages in bulk through the outline (importers, scripts) have to follow up with one `setDescription` call per page, and each call is its own git commit.

**How to reproduce**

1. Send `PATCH /x/api/v1/site/outline` with the full item list, changing one existing item's `description`, and adding a new item `{ "id": "client-1", "title": "B", "description": "Child", "parent": "<existing id>", "new": true }`.
2. Both descriptions are unchanged or empty in `site.json`.

**Additional details**

The fix uses the same handling as the `setDescription` node operation: `strip_tags`, with `""` clearing the description.

## Issue 04 (feature)

**Title:** `[haxcms-nodejs] Outline saves: return the server ids given to new items`

**What's the need?**

saveOutline rightly doesn't trust a client id for a new item (`itemMap[item.id] = page.id`). It remaps `parent` and `duplicate` through that map, but the map isn't returned. A client that creates pages and also references them elsewhere has no reliable way to find out which server id each new page got. Examples of such references: metadata pointing at another new page, or page HTML linking to it. Matching by title breaks on duplicate titles.

**Proposal**

Add `idMap` (client id → server id) to the response data, next to `items`. It's additive and non-breaking, and documented in site-spec.yaml.

## Pull request

**Title:** `Outline saves: keep item descriptions, return the id map for new items`

**Body:**

```markdown
## Related Issue
Closes haxtheweb/issues#XXXX
Closes haxtheweb/issues#YYYY

## Description of Changes
### What changed:
- saveOutline saves `description` when an item sends one (strip_tags; "" clears), matching the setDescription node operation
- the response adds `data.idMap` (client id -> server id for new items); site-spec.yaml documents it
- new unit test: test/unit/save-outline-items.test.cjs (in-memory site, real boilerplate copy in a temp dir)

### Why this change was needed:
Bulk creation through the outline lost descriptions, and clients couldn't map the pages they created to their new ids.

## Type of Change
- [x] 🐛 Bug fix (non-breaking change which fixes an issue)
- [x] ✨ New feature (non-breaking change which adds functionality)

## Testing Checklist
- [x] I have tested this change locally
- [x] I have added/updated tests for my changes
- [x] All existing tests pass (same results as main; site-spec conformance passes)
```
