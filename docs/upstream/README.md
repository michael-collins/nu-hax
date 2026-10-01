# Upstream contributions to HAX

This folder holds the issues and pull requests we propose to HAX: drafts first, then links once they're filed. Round 1 was filed on 2026-10-01. Our own features stay in `learning-materials/custom`. Only fixes and general-purpose pieces go upstream.

## How HAX takes contributions

From [CONTRIBUTING](https://github.com/haxtheweb/issues/blob/master/CONTRIBUTING.md) and [GOVERNANCE](https://github.com/haxtheweb/issues/blob/master/GOVERNANCE.md) in haxtheweb/issues:

- **Issue first.** Every issue goes in the unified queue, [haxtheweb/issues](https://github.com/haxtheweb/issues/issues), using the bug or feature form. Pick the Project, then fill in "What happened?", "How to reproduce" and "Additional details".
- **PRs come from forks.** The PR body references the issue (`Closes haxtheweb/issues#N`) and follows the repo's PR template: changes, why, type, and testing checklist. Keep `@mentions` and `fixes` keywords out of commit messages.
- **CLA.** On your first PR to each repo, comment `I have read the CLA Document and I hereby sign the CLA`.
- **Bigger efforts** get a written plan posted as an issue comment, labelled `Plan Created`, before the code.
- **Maintainers:** @btopro (Bryan Ollendyke, Penn State) is the primary maintainer and merges. Maintainership of an area is earned through merged, well-reviewed PRs. You can ask to own an area.
- **Code:**
  - JavaScript, `globalThis`, no optional chaining in tests.
  - Each repo's Prettier config wins. The source uses double or single quotes and semicolons as the surrounding file does; tests use `'use strict'`, single quotes and no semicolons.
  - New elements come from `hax webcomponent <name>`, follow DDD and pass `hax audit`.
- **Community:** Discord (linked from the issue form).

## Round 1: bug fixes with tests

Verified against current `main`: haxcms-nodejs e41c859 and webcomponents e51c522, both 2026-09-30. Each item has an issue draft and a ready patch in `patches/`. In the haxcms-nodejs patches, the new tests fail without the fix and pass with it. The full suite shows the same results before and after (7 failures already on `main`, in export, actions and config discovery, which depend on the environment). The webcomponents patch adds a test to hax-store-helpers-3; it fails without the fix, and the hax-store and hax-body tests pass with it (231).

| # | Repo | Problem | Draft | Patch | Filed |
|---|---|---|---|---|---|
| 1 | haxcms-nodejs | `pageBreakParser` misses a trailing bare `published` and corrupts titles that contain "published " or "locked " | [01](01-page-break-attributes.md) | `haxcms-nodejs--page-break-boolean-attributes.patch` | [#3096](https://github.com/haxtheweb/issues/issues/3096) · PR [#44](https://github.com/haxtheweb/haxcms-nodejs/pull/44) |
| 2 | haxcms-nodejs | Content save without a `<page-break>` writes nothing but returns 200 | [02](02-content-save-without-page-break.md) | `haxcms-nodejs--content-save-without-page-break.patch` | [#3097](https://github.com/haxtheweb/issues/issues/3097) · PR [#45](https://github.com/haxtheweb/haxcms-nodejs/pull/45) |
| 3 | haxcms-nodejs | Outline saves drop item descriptions | [03](03-outline-descriptions-and-id-map.md) | `haxcms-nodejs--outline-descriptions-and-id-map.patch` | [#3098](https://github.com/haxtheweb/issues/issues/3098) · PR [#46](https://github.com/haxtheweb/haxcms-nodejs/pull/46) |
| 4 | haxcms-nodejs | Outline saves don't say which ids new items got | [03](03-outline-descriptions-and-id-map.md) | (same patch) | [#3099](https://github.com/haxtheweb/issues/issues/3099) · PR [#46](https://github.com/haxtheweb/haxcms-nodejs/pull/46) |
| 5 | webcomponents | HAX writes Lit `state: true` properties into saved HTML | [05](05-hax-lit-state-properties.md) | `webcomponents--hax-skip-lit-state-properties.patch` | [#3100](https://github.com/haxtheweb/issues/issues/3100) · PR [#830](https://github.com/haxtheweb/webcomponents/pull/830) ✅ merged by btopro 2026-10-01 |

Checked and not filed:
- **`theme.variables.hexCode` crash:** already guarded on `main`; released 26.8.1 still has it. Upgrading will fix it.
- **Clearing metadata in outline saves:** sending `null` already stores `null`, so a delete operation isn't needed.
- **Dev-server reload loop:** it was caused by our own icon generator writing into `src/`, and we fixed it on our side.

**Review status (2026-10-01):** #830 was approved and merged by btopro. On #44, #45 and #46 the automated Copilot reviewer suggested one change each (whitespace around `=`, an accurate error message, a prototype-free id map). All three were fixed with tests and answered in their threads. No human review yet.

**Upstream moved (2026-10-01, haxcms-nodejs 295e645, QA for 26.9.0):** the new commits don't touch the files our PRs change. #44, #45 and #46 merge cleanly onto it, with the full suite unchanged (the same 7 failures already on main; our 8 tests pass). Our theme was checked against the new editor build: same internals, blocks register, pathway, collection, Page details and editor saves all work. The custom-theme preload 404 (draft 06) is still there.

To apply a patch to a fork: `git am docs/upstream/patches/<file>.patch`.

## Our theme against upstream `main` (checked 2026-10-01)

Main (haxcms-nodejs e41c859, with its own front-end build) served a copy of the site on another port, and was compared with the 26.8.1 release.

- **Same on both:**
  - every editor method, element id and store field our layer calls;
  - the editor skins' selectors;
  - the theme, nav, pathway, collection and footer rendering;
  - outline saves with our metadata, clearing fields, creating pages with metadata, uploads, and an editor save of a page with our blocks.
- **Changed but fine:** `simple-icon-lite` now draws with an SVG colour filter instead of a CSS mask. Our Lucide icons still resolve, and they paint in the theme colour (checked by rendering them).
- **New in main:** theme preload hints 404 for custom themes ([draft 06](06-custom-theme-preload.md), not filed).
- **Our bug, found and fixed:** Page details sent `setDescription` with the description nested under `details`. Both the release and main read it at the top level, so description edits never saved. Fixed in learning-materials f28fd14, and checked on both.

- [07: style revision and data conformance](07-style-and-data-conformance.md): btopro's concerns, theme test results, conformance table and draft reply.

## Next rounds

1. **Hooks** that make custom themes less fragile:
   - `::part()` names on editor chrome;
   - a public editor API (`editPage`, `save`, `cancel`, `openSettings`);
   - block registration from custom bundles.
2. **Blocks** rebuilt as DDD components through the CLI: callout, embeds, page collection, pathway. Our shadcn look stays in our theme by mapping DDD variables (`tokens/ddd-bridge.js`).
3. **Improvements to existing elements** rather than parallel ones: oer-schema, license, citation, outline designer.
4. **Plans** (`Plan Created`) for content types with fields, relations, versioning, books and pathways, pitched as OER needs.

See [regression-protection.md](../regression-protection.md) for why the hooks matter to us.
