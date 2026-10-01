# Style revision and data conformance: response to btopro

His concerns (2026-10-01):
1. How the style revision looks and interacts with existing themes.
2. Whether it conforms to the site APIs and data structures, which is why he wants to polish the backend first.

## 1. Existing themes (tested)

HAXcms loads `custom/build/custom.es6.js` for **every** theme (`build-haxcms.js`). It's the site-level extension point, not a theme file. Testing a site switched to stock `clean-one` (release 26.8.1) showed that our layer leaked into the stock theme:

- **Editor broke.** Our editor chrome hid the stock `haxcms-site-editor-ui` bar, but its replacement controls (Save, Cancel, page menu) live inside our theme. In edit mode on clean-one there was no way to save.
- **Theme restyled.** Our skins for shared site elements (map-menu, breadcrumb, a11y-collapse) and our grid-plate breakpoints applied to the stock theme.

**Fixed** in learning-materials 9290e44: the editor chrome, the theme skins and the layout breakpoints now switch on only when `custom-oer-docs-theme` connects. Verified:

- **On clean-one:** the stock bar is back with its usual Save/Cancel and tray, no Lucide icon swap, no skins. Our blocks (oer-pathway, oer-collection…) still register and render, using their own fallbacks.
- **On our theme:** unchanged. The chrome, rail and icons switch on and edit/cancel works.

So the style revision is a theme-scoped layer. It isn't a proposal to restyle HAX core. Anything we offer upstream should be opt-in (an editor skin setting) and built on DDD tokens, not on our tokens.

## 2. Data structures and site APIs

**What conforms:**
- Every write goes through HAX's own paths: `saveOutline` / `PATCH /x/api/v1/site/outline`, `saveNodeDetails`, `haxcms-create-node`, and `POST /x/api/v1/files`.
- Custom metadata survives HAX's save paths (outline saves copy unknown keys; detail operations leave them alone).
- Editor saves keep our pageType values. We tested a value outside HAX's list (`exercise`): a no-change save kept it.

**Gaps, against HAX's native concepts:**

| Ours | HAX native | Gap |
|---|---|---|
| Content types with custom fields: definitions in a hidden `pageType: "oer:system"` page, values in `metadata.oerFields` | None. Entities/schemas are a fixed system list (`lib/entities.yaml`), and item `metadata` is an open object | Config stored as a page, which we must filter out of /items, search, tags and exports by hand. No server validation of fields. Revision restore doesn't bring back pageType/oerFields |
| pageType values (**now prefixed `oer:` since 2026-10-01**, e.g. `oer:lesson`; an editor save keeps them) | page-break's pageType list (content, lesson, project, quiz…), which drives icons, the map-menu label, search type and a filter | Prefixing removed the lesson/project collision. Our values still aren't in the page-break dropdown, which shows them blank, so editing that field in page settings could clear them |
| Collection block: a client-side query over the loaded manifest | Views: `site-view` + `/x/api/v1/views/{id}/results` (filter.pageType/ancestor/tags/published, sort, paging) | Duplicates a native feature he's building, and bypasses server-side visibility rules. Views can't filter on our fields yet |
| Versions: a frozen copy page per release + `oerVersions` | Git revisions + restore (`/items/{id}/revisions`) | Two version systems. Ours models *releases* (semver, pinning), which git revisions don't. Their content endpoint needs a login, so it can't serve a static site |
| Relations `[{page, version}]` in oerFields | `relatedItems` (one escaped string) | No collision, but stock tools can't see our relations |
| "Show in the navigation" per type (our nav only) | `metadata.hideInMenu` per page | Stock themes ignore our setting (clean-one lists every page) |
| Private editor methods (`_editButtonTap` and others) | No public edit/save/cancel API found | The most fragile dependency |

## Draft reply

> Thanks, both fair. I tested them rather than guessing.
>
> **Themes:** you were right to worry. Because HAXcms loads `custom/build/custom.es6.js` under every theme, switching our site to clean-one kept our editor chrome. It hid the stock bar, while the replacement controls only exist in our theme, so you couldn't save. Our menu skins and grid breakpoints also bled into clean-one. I've fixed that on our side: the chrome, skins and breakpoints now switch on only when our theme is active, and clean-one gets stock HAX untouched (our content blocks still render there). To be clear, I'm not proposing to restyle core. If any of the editor UI is useful upstream, I'd offer it as an opt-in skin built on DDD tokens.
>
> **Data and APIs:** all our writes go through the outline save, saveNodeDetails, create-node and the files API, and our metadata survives your save paths. Where we're off-model:
> - **Content types:** we built custom fields (`metadata.oerFields`) because entities/schemas don't cover user-defined types. The definitions live in a hidden page, which I know isn't great.
> - **pageType:** our values are now namespaced (`oer:lesson`, `oer:pathway`…) so they can't collide with yours, but they still aren't in page-break's list.
> - **Collections:** our block queries the manifest client-side, where Views now exist.
> - **Versions:** we keep release snapshots (semver/pinning) alongside git revisions.
> - **Editor actions:** we still call private methods like `_editButtonTap`.
>
> I'd rather align with your backend than keep a parallel model. Which parts are you polishing first? If custom fields/types, view filters on fields, or a public edit/save API are on your list, I'd like to help build them there and then move our layer onto them.
