# 11: outline saves rebuild site.json, feeds and search index once per item

**Repo:** haxcms-nodejs · **Form:** Bug report · **Project:** haxcms-nodejs (backend) · **Status:** filed 2026-10-05 as [haxtheweb/issues#3114](https://github.com/haxtheweb/issues/issues/3114)
**Found:** 2026-10-05 with 26.8.1 (`dist/siteRoutes/v1/routes/saveOutline.js`, `dist/lib/HAXCMS.js`); same code on `main`.

## Issue

**Title:** `[haxcms-nodejs] PATCH /site/outline does O(items²) work: updateNode rewrites site.json and rebuilds RSS/sitemap/search index for every item`

**What happened?**

The outline designer (and other clients) send the whole outline to `PATCH /x/api/v1/site/outline`, with `modified` / `new` / `delete` flags on the items that changed. `saveOutline` loops over every item it receives and, for each existing one, calls `site.updateNode(page)`, whatever its flags. `updateNode` then:

- saves the whole manifest (`manifest.save(false)` → writes site.json), and
- runs `updateAlternateFormats()`: RSS, Atom, sitemap, llms.txt, and `lunrSearchIndex`, which reads every page's content file.

So one save with N items does N full rebuilds, ~N² file reads. On a 675-item site a save took over five minutes (clients hit fetch's 300 s headers timeout); the same change sent as a single item takes 1.6 s. `saveOutline` already rebuilds everything once at the end (`rebuildManagedFiles`, `updateAlternateFormats`), so the per-item rebuilds aren't needed. `deleteNode` does the same per deleted item.

**How to reproduce**

1. A site with a few hundred pages.
2. Open the outline designer, rename one page, save: it takes minutes. Sending just that item takes about a second.

**Suggested fix**

- Skip items without `modified` / `new` / `delete` (nothing to do for them), and
- inside the loop, update the manifest entry in memory instead of calling `updateNode` (and remove from the array instead of `deleteNode`), leaving the single `manifest.save()` and `updateAlternateFormats()` at the end.

**Our workaround:** our client and scripts send only the flagged items (learning-materials outline-model.js `saveOutline`, scripts/lib/hax-api.mjs).
