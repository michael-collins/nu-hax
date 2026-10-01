# 02: content save without a page-break returns 200 but writes nothing

**Repo:** haxcms-nodejs · **Form:** Bug report · **Project:** haxcms-nodejs (backend)
**Patch:** `patches/haxcms-nodejs--content-save-without-page-break.patch`

## Issue

**Title:** `[haxcms-nodejs] PATCH /x/api/v1/content/{id} without a <page-break> returns 200 and silently saves nothing`

**What happened?**

saveNode only writes content that follows a `<page-break>`, because it splits the body with `HAXCMS.pageBreakParser`. If the body has no `<page-break>`, the parser returns an empty list, the write loop never runs, and the route still answers `200` with the unchanged page. API clients and scripts (anything that isn't the HAX editor) believe the save worked.

The e2e tests already note that the page-break is required (edit-content.e2e). The problem is the silent success, not the requirement.

**How to reproduce**

1. Pick a page id and send `PATCH /x/api/v1/content/{id}` with site-token auth and the body `{ "site": { "name": "<site>" }, "body": "<p>New text</p>" }`.
2. The response is `200` with the page record.
3. The page file on disk is unchanged.

Sending `<page-break item-id="{id}" title="…" published="published"></page-break><p>New text</p>` instead does write the content.

**Additional details**

haxcms-nodejs `main` at e41c859 and 26.8.1.

## Pull request

**Title:** `Refuse content saves that have no page-break instead of answering 200`

**Body:**

```markdown
## Related Issue
Closes haxtheweb/issues#XXXX

## Description of Changes
### What changed:
- saveNode answers 400 ("body must start with a <page-break> element carrying the page attributes") when the body has no page-break, instead of 200 with nothing written
- new unit test: test/unit/save-node-page-break.test.cjs (stubs auth and loadSite; asserts 400 and no write)

### Why this change was needed:
API clients got a success response for a save that never happened.

An alternative would be to treat a body without a page-break as the whole page content. That's friendlier, but it would also reset the title, published and locked flags, which saveNode reads from the page-break, so the 400 seemed safer. Happy to switch if you prefer.

## Type of Change
- [x] 🐛 Bug fix (non-breaking change which fixes an issue)

## Testing Checklist
- [x] I have tested this change locally
- [x] I have added/updated tests for my changes
- [x] All existing tests pass (same results as main)
```
