# 09: reference items (one page at several places in the outline)

**Repo:** haxtheweb/issues · **Form:** Feature request · **Project:** HAXCMS site builder · **Status:** filed 2026-10-05 as [haxtheweb/issues#3109](https://github.com/haxtheweb/issues/issues/3109)

Option D from the nav discussion: instead of our theme-only link items (`metadata.oerRef` + `<oer-include>`), ask HAX for a native reference item, so stock themes, search, delete and the outline designer know it's the same page.

## Issue

**Title:** `[HAXcms] Reference items: show one page at several places in the outline`

### Project

HAXCMS site builder

### What would you like to see?

A way for an outline item to be a **reference** to another item in the same site, so one page can appear at several places in the outline without being copied.

Today each JOS item has one `parent`/`order` and its own `pages/{uuid}/index.html`, so a page has exactly one position. To list it somewhere else you either copy it (and the copies drift) or make a new page whose content is `<site-remote-content uuid="…">`. The second works for display, but HAXcms doesn't know the two items are the same page.

A sketch (naming and shape are yours to decide):

```json
{
  "id": "item-b",
  "title": "Animation Principles",
  "parent": "item-pathway-module-1",
  "location": "pages/item-b/index.html",
  "metadata": { "reference": { "id": "item-a" } }
}
```

- The item keeps its own id, position, slug and `pages/{uuid}/` folder, so it stays valid JOS and existing tooling keeps working. Its file can hold `<site-remote-content uuid="item-a">` as the fallback for themes and tools that don't know about references.
- Themes, breadcrumbs and prev/next treat it as a normal position in the tree.
- Search, sitemap and RSS index the original once, and the reference's page sets its canonical URL to the original.
- Deleting the original lists (or blocks on) the references to it. Deleting a reference never touches the original.
- Editing from a reference opens the original, or edits it in place.
- The outline designer shows reference items with a badge and a way to jump to the original.
- Optional: a reference pinned to a revision of the original (`"reference": { "id": "item-a", "revision": "…" }`), for courses that must not change mid-term.

`site-remote-content` already does content reuse at block level. This lifts the same idea to the outline.

### Why would this be useful?

Course and OER sites reuse pages constantly: one library lesson appears in several pathways, modules or courses. Authors want a single source of truth that shows up in every place it's used.

Without HAXcms knowing about references:

- search returns the same lesson several times;
- deleting the original silently breaks every page that showed it;
- there is no canonical URL, so search engines see duplicate content;
- stock themes and the outline designer can't tell a reference from a real page.

We built this in a custom theme for an OER site (a second item whose content includes the original, optionally pinned to a released version) and it works. But only our theme understands it, and we would rather align with your data model than keep a parallel one. If you're interested, we can write a `Plan Created` proposal and contribute the implementation.
