# HAX quirk backlog

Every HAX quirk we've hit while building this site, sorted into: already filed, still live on HAX's latest code (candidates for issues and PRs), fixed upstream, and not HAX's doing. Each candidate has where it lives, what happens, a suggested fix and our workaround, so it can become an issue (and often a PR) without digging again.

**Checked against:** haxcms-nodejs `b5f1a8c` and webcomponents `ff60a6c`, both from 2026-10-08. We run the 26.8.1 release. File references are to `main`: `src/` in haxcms-nodejs and `elements/` in webcomponents.

**Before filing:** check the code again (upstream moves fast), write a repro against a stock site, and get the go-ahead. Issues go in [haxtheweb/issues](https://github.com/haxtheweb/issues/issues), with PRs from our forks (see [README](README.md)).

## Already filed

| Draft | Problem | Filed | Status |
|---|---|---|---|
| [01](01-page-break-attributes.md) | A trailing bare `published` is read as unpublished; titles containing "published " or "locked " get corrupted | [#3096](https://github.com/haxtheweb/issues/issues/3096) · PR haxcms-nodejs#44 | Merged |
| [02](02-content-save-without-page-break.md) | A content save without `<page-break>` wrote nothing but returned 200 | [#3097](https://github.com/haxtheweb/issues/issues/3097) · PR haxcms-nodejs#45 | Merged (main now returns 400) |
| [03](03-outline-descriptions-and-id-map.md) | Outline saves dropped descriptions; no way to learn new items' ids | [#3098](https://github.com/haxtheweb/issues/issues/3098), [#3099](https://github.com/haxtheweb/issues/issues/3099) · PR haxcms-nodejs#46 | Merged |
| [05](05-hax-lit-state-properties.md) | HAX saved Lit `state: true` properties into page HTML | [#3100](https://github.com/haxtheweb/issues/issues/3100) · PR webcomponents#830 | Merged |
| [06](06-custom-theme-preload.md) | Theme preload hints 404 for custom themes | [#3111](https://github.com/haxtheweb/issues/issues/3111) | Open |
| [08](08-embeds-blocked-by-dev-headers.md) | `hax serve`'s headers block video and document embeds | [#3112](https://github.com/haxtheweb/issues/issues/3112) | Open (partly fixed: see below) |
| [09](09-reference-items.md) | One page at several places in the outline (feature) | [#3109](https://github.com/haxtheweb/issues/issues/3109) | Open |
| [10](10-sanitizer-strips-question-answers.md) | The storage sanitizer strips `correct` from `<input>`, erasing quiz answers | [#3113](https://github.com/haxtheweb/issues/issues/3113) | Open |
| [11](11-outline-save-rebuilds-per-item.md) | Outline saves rebuild site.json, feeds and search once per item (O(n²)) | [#3114](https://github.com/haxtheweb/issues/issues/3114) | Open |

## Still live on main: candidates

### Data that changes by itself

These quietly change saved content, so they come first.

#### A. Page order is renumbered in the browser, so partial saves reorder the navigation

**Repo:** webcomponents (json-outline-schema, haxcms-elements), with smaller parts in haxcms-nodejs

- **Problem:**
  - `unflattenItems` sorts each parent's children and overwrites their `order` with the rank ("forcibly reset the order", `json-outline-schema/json-outline-schema.js:613-618`).
  - The store runs it on the manifest's own items when it loads (`haxcms-site-store.js:536`) and again in `addItem` (1348-1364).
  - So in the browser every page's `order` is 0, 1, 2…, while site.json keeps its own numbers, with gaps from deletes and moves.
  - Any save that sends some pages from the store writes ranks beside siblings that keep their stored numbers. They tie or cross, and the navigation reorders.
- **What we saw:**
  - 205 of our 871 pages had a store order that differed from site.json.
  - Saving 23 pages under Articles left 4 duplicate orders.
  - A three-row move in an outline tool re-saved 118 pages.
- **Related, same cause:**
  - **New pages land mid-list.** Every add-page path takes `order` from the rank-numbered store: Merlin's create-page (`haxcms-site-editor-ui.js:1561-1568`), `haxcms-button-add.js:170-178`, `getLastChildItem` (`haxcms-site-store.js:1101-1114`) and `movePageUnderParent` (1644-1652). With gapped stored orders, a new last page lands in the middle of its siblings.
  - **Saving a page in the editor moves it.** `haxcms-site-editor` `saveNode` serializes the page with `activeHaxBody.haxToContent()`, which writes the page-break's `order` from the store's renumbered item. The server writes that order (`saveNode.js:193-194`), so an ordinary page save can move the page among its siblings. Seen 2026-10-08: a save moved a page from stored order 49 to 38.
  - **Rank 0 counts as "no order".** `if (item2.order)` (`haxcms-site-editor-ui.js:1567`, `haxcms-button-add.js:176`) is false for rank 0, so a second child can also get 0.
  - **Server defaults:**
    - `saveOutline` gives an item without `order` its index in the posted array (`saveOutline.js:87-91`).
    - `createNode` stores the request's `order` as sent, without `parseInt`, and defaults to 0 (`HAXCMS.js:1829-1831`).
    - The bulk `addPage` defaults to the site-wide item count (`HAXCMS.js:1006-1011`).
- **Suggested fix:**
  - **In the browser:** `unflattenItems` sorts a copy and doesn't write `order` or `children` back, or the store passes it a clone.
  - **On the server:** add pages relative to a sibling ("after this id" or "append"), computing `max(stored sibling order) + 1`. Optionally renumber each touched parent's children after an outline save, so stored and shown numbers agree. Also `parseInt` the single-node order and default it to the parent's last child + 1 (`getLastChildOrder` already exists in `nodeDetailOperations.js:55`).
- **Our workaround:**
  - `custom/src/outline/outline-order.js` turns ranks back into stored numbers before every save, and moves only the siblings it has to.
  - `createPage` uses the stored maximum + 1.
  - Page saves: the theme's capture listener on `haxcms-save-node` wraps that save's `haxToContent` once and puts site.json's stored order in the page-break (`custom-oer-docs-theme.js` `__beforeSave`).
  - The outline builder numbers each parent's children together with the pages it doesn't show.
  - Check: `node scripts/check-outline-order.mjs`.

#### B. The store writes defaults into page metadata, and later saves keep them

**Repo:** webcomponents (haxcms-elements)

- **Problem:**
  - `loadManifest` writes `published: true`, `locked: false` and `status: ""` into every item's metadata in memory (`haxcms-site-store.js:516-528`).
  - The `routerManifest` getter sets `metadata.icon = iconFromPageType(pageType)` on the manifest's own items (685-686). `Object.assign` copies only the top level, so the metadata object is shared.
  - Any later save of an item writes these back. In particular, every page with a `pageType` and no icon gets `courseicons:learning-objectives` saved as its icon.
- **Suggested fix:** apply the defaults when reading (`metadata.published !== false`). In `routerManifest`, copy the metadata: `metadata: { ...metadata, icon: metadata.icon || iconFromPageType(...) }`.
- **Our workaround:** `custom/src/types/page-icon.js` treats that icon as "no icon" and strips it before saves. `saveOutline` does the same.

#### C. Page addresses keep stray hyphens and turn "/" in titles into fake nesting

**Repo:** haxcms-nodejs

- **Problem:**
  - `cleanTitle` turns every run of punctuation into `-` and never trims the ends, and it keeps `/` (`lib/HAXCMS.js:3825-3826`). So:
    - "DMD 400: 15-week (Collins)" becomes `…-collins-`;
    - "Pass/fail" becomes `rubrics/pass/fail`, which looks like a child of a "pass" page;
    - "Authors and owners / Andrew Katz" becomes `authors-and-owners-/-andrew-katz`.
  - Outline saves now go through `generateSlugName`, which trims the ends but keeps an inner `/` (`saveOutline.js:359`).
  - Every other pathauto path still uses `cleanTitle` directly: `setTitle` and indent, outdent, setParent and cascade (`lib/nodeDetailOperations.js:118-139, 289-356`), saveNode (`saveNode.js:213-214`), `itemFromParams` (`HAXCMS.js:1843-1847`) and `addPage` (1018).
  - The bulk normalize-slugs route (`siteRoutes/v1/site.js:729-730`) would put trailing hyphens back into fixed addresses.
- **On our site:** 10 pages are affected: one sequence, the Pass/fail rubric, "AR/VR Development" and 7 Open Design Now articles.
- **Suggested fix:** one slug function for a title segment that turns `/` into `-`, collapses repeats and trims the ends, used by every pathauto path.
- **Our workaround:** set the address explicitly with `metadata.overridePathauto: true` (we did this for the DMD 400 sequence on 2026-10-08).

#### D. A content save without a description replaces it with the start of the page

**Repo:** haxcms-nodejs

- **Problem:** `saveNode.js:338-340` sets `description` to the first 200 characters of the body whenever the `<page-break>` has no `description` attribute. A hand-written page description is overwritten by any content save that doesn't send it.
- **To confirm before filing:** whether the stock editor's saves send `description` on the page-break, and so whether this hits ordinary editing or only API clients.
- **Suggested fix:** only generate a description when the page has none.
- **Our workaround:** none needed so far, as far as we know.

#### E. Requests with wrong or unknown fields succeed silently

**Repo:** haxcms-nodejs

- **Problem:**
  - `PATCH /items/{id}` with `{ operation: "setDescription", details: { description } }` changes nothing, still git-commits, and returns 200: only a top-level `description` is read (`items.js:476-519`, `nodeDetailOperations.js:148`).
  - Unknown operations fall through `default: break` and return 200 (`nodeDetailOperations.js:251-252, 362-363`).
  - `PATCH /content` builds a `details` object that is never used (`saveNode.js:57-70`).
- **What it cost us:** our Page details dialog sent descriptions nested under `details`, and no description edit saved until we noticed (fixed on our side in f28fd14).
- **Suggested fix:** return 400 for unknown operations and missing required fields, and validate request bodies.

### Workflow and API

#### F. Every save commits the whole site folder

**Repo:** haxcms-nodejs

- **Problem:** `gitCommit` runs `git add` with no paths (`HAXCMS.js:903-904`), which is `git add -A` in git-interface 2.1.2. A content save sweeps in uncommitted theme and code changes under messages like "Outline updated in bulk".
- **Suggested fix:** commit explicit paths: `site.json`, the page's folder and the managed files.
- **Our workaround:** commit code before any save, and test writes on a scratch copy.

#### G. Renaming a page breaks its old address

**Repo:** haxcms-nodejs (feature)

- **Problem:** with pathauto on, a rename changes the address, and nothing remembers the old one (`siteRouteUtils.js:706-736` matches only the current id or slug).
- **Suggested fix:** keep old slugs in `metadata.previousSlugs`, and resolve or redirect them in `findItemByIdOrSlug` and the 404 handler.

#### H. Page metadata can only ride on a fixed list of page-break attributes

**Repo:** haxcms-nodejs (feature)

- **Problem:** saveNode copies about 19 known attributes (title, slug, parent, published, page-type, tags, icon…) and drops the rest (`saveNode.js:154-341`), so a content save can't carry custom metadata.
- **Suggested fix:** copy unknown `data-`/custom attributes into `page.metadata`, or document the outline save as the way to set metadata.

#### I. md-to-html escapes raw HTML, custom elements included

**Repo:** haxcms-nodejs

- **Problem:** `new MarkdownIt()` uses the default `html: false` (`systemRoutes/v1/routes/convertMdToHtml.js:2`), so Markdown containing HAX blocks loses them.
- **Suggested fix:** `new MarkdownIt({ html: true })`, then `sanitizeHTMLForStorage`.

#### J. An unpublished page opened directly by its address may never load

**Repo:** webcomponents (haxcms-elements)

- **Problem:**
  - `loadPageData` defers when `loading` is set (`haxcms-site-builder.js:298-300`).
  - `loadJOSData` sets and clears `loading` (365-391) but never runs the deferred page load. Its `catch` never resets `loading` either.
  - Signed out, the store hides unpublished pages, so the first route is a 404.
  - Once login is known the route switches to the page, and that load can be dropped.
- **Seen:** in 26.8.1, opening an unpublished page by URL showed no content; navigating to it inside the site worked.
- **Suggested fix:** call `_runPendingPageLoad()` after `loadJOSData` settles, and reset `loading` in its `catch`.
- **Our workaround:** the theme calls `loadPageData()` when the active page's content hasn't arrived about a second after the route settles.

### Editor and theming hooks

These matter most for custom themes. They fit the "hooks" round in the [README](README.md).

#### K. `simple-toolbar-button.click()` never reaches click listeners

**Repo:** webcomponents (simple-toolbar)

- **Problem:** `click(e) { this._handleClick(e); }` only toggles the button (`simple-toolbar-button.js:382-384`). Scripted clicks don't fire the element's `@click` handlers.
- **Suggested fix:** call the inner button's `click()`.
- **Our workaround:** call the editor's methods directly (`_editButtonTap` and others).

#### L. simple-modal sets every style variable inline

**Repo:** webcomponents (simple-modal)

- **Problem:** `simple-modal.js:690-694` sets all its CSS variables inline on each open, with `inherit` for the ones not passed, so themes can only override them with `!important`.
- **Suggested fix:** set only the variables the caller passes, ideally in an adopted `:host` sheet.

#### M. DDD sets the root font size to 20px

**Repo:** webcomponents (d-d-d)

- **Problem:** `:root { font-size: var(--ddd-theme-body-font-size) }`, which is 20px by default (`DDDStyles.js:520, 543, 854-859`). Every rem on the page is 25% larger than a theme built for 16px expects.
- **Suggested fix:** put the body size on `body` and leave `:root` at 100%.
- **Our workaround:** the token bridge sets the variable to 16px.

#### N. grid-plate stacks columns in normal-width content

**Repo:** webcomponents (grid-plate)

- **Problem:**
  - grid-plate compares its own width with breakpoints (`grid-plate.js:299-302, 396-405`).
  - Saved pages and demos carry `breakpoint-sm="900"` (`demo/index.html:70`), which content columns of about 48rem never reach, so two-column layouts stack.
- **Suggested fix:** ignore saved `breakpoint-*` attributes, or measure against the parent.
- **Our workaround:** `custom/src/layout-breakpoints.js` rewrites the responsive event, and our save options strip the attributes.

#### O. A moved block gets its old layout slot back

**Repo:** webcomponents (hax-body)

- **Problem:**
  - `formatBlock` saves the node's `slot` and re-applies it to whatever is active after a `setTimeout` (`hax-store.js:2229, 2252-2266`).
  - `hax-body` also stamps a remembered `__slot` on the next added node (`hax-body.js:5076-5078`).
  - A block moved out of a grid-plate can come back with its old slot and vanish from view.
- **Suggested fix:** re-apply the slot only when the node is still inside a layout, and clear stale slots when a node leaves one.
- **Our workaround:** `clearStraySlots` in our slots helper clears the slot again after a delay.

#### P. Inserting a block can't say where

**Repo:** webcomponents (hax-body)

- **Problem:**
  - `haxInsert` puts the new block after the anchor and copies the anchor's layout slot (`hax-body.js:2966-2973`).
  - The `hax-insert-content` event has no target or position. It inserts at the active node (`hax-store.js:5143-5272`).
- **Suggested fix:** accept `detail.target` and `detail.position`, and pass them to `haxInsert`.

#### Q. No public editor API; "edit" toggles and saves

**Repo:** webcomponents (haxcms-elements)

- **Problem:**
  - `_editButtonTap` toggles edit mode, and leaving edit mode saves (`haxcms-site-editor-ui.js:5921-5998`). Calling it to start editing while already editing saves the page.
  - Cancel is private (`_cancelButtonTap`, `_cancelEditing`).
- **Suggested fix:** public `startEditing()`, `save()` and `cancel()`, with the toggle built on them.

## Fixed on main (upgrading fixes these)

- **`theme.variables.hexCode` crash** when a custom theme has no `variables`: guarded on main (`HAXCMS.js:755, 1896`). It crashes in 26.8.1, and we added `variables` to site.json.
- **Outline saves drop descriptions** (#3098): main stores `description` for new and existing items (`saveOutline.js:69-70`). In 26.8.1, existing items keep theirs and new ones lose it; our code sets it after the save.
- **Content save without a page-break** (#3097): main returns 400 instead of a silent 200. A friendlier fix would wrap the body in the page's current page-break.
- **video-player embeds** (#3112): main adds `referrerpolicy` and `credentialless` to video-player's own iframe (`video-player.js:147-148`). It only does so when the page is fully cross-origin isolated, though. YouTube goes through `a11y-media-player`, which we haven't checked.

## Not HAX bugs, or not proven

- **A dev-server reload loop:** caused by our own icon generator writing into `src/` (fixed on our side).
- **Reload loop after deleting the page you're on:** we saw it in 26.8.1, but the front end on main has no reload path for a missing page. After a delete, `fallbackItemSlug()` can return null and leave the deleted address in place (`haxcms-site-editor.js:1539`, `haxcms-site-store.js:1151-1166`). The loop may come from the server's response or `reloadOnError`. It needs a clean repro before filing.
- **By design, worth knowing:**
  - Undo replaces the editor's HTML, so element references go stale.
  - `custom/build/custom.es6.js` loads under every theme.
  - `connection-settings` returns JavaScript, not JSON.
  - Hidden browser panes pause `requestAnimationFrame`.
