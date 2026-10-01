# Keeping the UI work safe from upstream HAX changes

HAX moves fast and has many contributors. Everything in this project is a layer on top of stock HAX (no forks or patched files), but that layer leans on HAX internals. The proposals below make breakage **visible immediately** and **contained** when it happens, and shrink the surface over time by upstreaming stable hooks.

## What we depend on

All of it lives in `learning-materials/custom/src`.

| Dependency | Where | Breaks when HAX… |
|---|---|---|
| Shadow-DOM skins for **66 HAX elements** (class names, ids, parts) | `editor/editor-skin.js`, `theme-skin.js` | renames a class or id, restructures a template |
| Private editor methods: `_editButtonTap`, `_cancelEditing`, `_outlineButtonTap`, `_manifestButtonTap`, `_toggleLockedStatus`, `HAXCMSButtonClick`, `_pickerChange`, `_gizmoAllowedInTray`, `updateCategories`, `haxInsert`, `__isLayout`, `__addAbove` | `editor/stock.js`, rail, inserter, slots | renames or re-signatures a method |
| Toolbar contracts: `event-name` values (`hax-plate-up`, `insert-above-active`…), rte `command`s | `editor/oer-block-rail.js` | changes event names or toolbar markup |
| Site API behaviour: `saveOutline` merges metadata, `createNode` accepts metadata, `saveNodeDetails` operations | `outline/`, `types/`, `versions/` | changes payloads or merge semantics |
| Store shape: `store.manifest.items`, `activeId`, `HaxStore.activeNode`, `gizmoList`, `staxList` | everywhere | refactors the stores |
| Runtime facts: `WCGlobalBasePath`, autoloader path of `@google/model-viewer`, AIUL `lib/v1.json` | blocks, footer | moves files |

## Proposals

### 1. Pin HAX, upgrade on purpose
- Pin the exact `@haxtheweb/haxcms-nodejs` version that serves the site (today 26.8.1), for example through a `package.json` dev dependency and an `npm run serve` script, instead of `npx` pulling the latest.
- Upgrades become a deliberate branch ("bump HAX to x.y.z") that must pass the checks below before merging. A Renovate or Dependabot rule can open these branches automatically.

### 2. Contract tests: fail loudly and specifically
A small Playwright suite loads the seeded site against the pinned HAX and asserts every dependency in the table above:
- every method we call exists and is a function;
- every selector a skin targets still matches an element in a rendered sample of that component;
- every `event-name` and `command` the rail maps to is present;
- the API round-trips work: create a page with metadata, merge metadata via `saveOutline`, delete.

The list of contracts is generated from our code by scanning `editor-skin.js` keys, `stock.js` calls and `byEvent(...)`, so it can't drift. A failure names the exact broken contract ("`hax-tray .tray-detail-titlebar` no longer matches"), so a fix takes minutes instead of a hunt.

### 3. Visual regression screenshots
Playwright screenshots of about 25 key states:
- the editor: frame and handle, rail menus, slot inserter and flyout, layout guides, settings dialog;
- the outline builder, type editor, page details, embed dialog, versions dialog;
- the theme: collection table and cards, the book reader, the footer;
- Site Settings sub-dialogs;
- each in light and dark mode, at desktop and phone width.

They are compared against approved baselines with a small pixel tolerance. This catches "it still works but looks wrong", which contract tests can't.

### 4. Accessibility and contrast in CI
- Run axe-core on the same states, failing on serious or critical issues.
- Run the existing `scripts/contrast-audit.mjs` (WCAG AA token pairs).
- This guards the perceivability work specifically.

### 5. Graceful degradation at runtime
A tiny `contracts.js` runs the same checks in the browser when the editor loads. If a contract fails, the matching enhancement switches itself off and stock HAX shows through, so authors get working, if plainer, UI instead of a broken one. Signed-in authors see one toast ("Some editor enhancements are paused after a HAX update"), and the console names the failing contract. Examples:
- the block rail hides itself and the stock toolbar comes back;
- the settings dialog falls back to the stock side panel.

### 6. Shrink the surface by upstreaming hooks
Several dependencies exist only because HAX lacks an official hook. Proposing these upstream helps every HAX theme and makes our layer far less fragile:
- **CSS `::part()` names and custom properties** on editor chrome (tray, plate context, text toolbar, dialogs), so skins stop depending on internal classes.
- **A public editor API**: `editPage()`, `save()`, `cancel()`, `openSettings()`, in place of `_editButtonTap` and friends.
- **Block registration from site config or custom bundles**, so custom elements don't need `setHaxProperties` timing tricks.
- **Saving only schema-declared properties**, so internal Lit state is never written into page HTML (it bit us twice).
- **Metadata delete semantics** in `saveOutline` (`null` removes a key).
- **Guard `theme.variables` in `getSiteMetadata`**: a custom theme without it crashes the server on save.
- **Dev server**: don't let builds that write into `custom/src` start a reload loop. We worked around it, but HAX could debounce or ignore generated files.

Each is a small, well-scoped PR with a clear reason, which is the kind of contribution most likely to be accepted.

### 7. Keep our layer modular
- One feature per module, already mostly true: `editor/`, `blocks/`, `outline/`, `types/`, `versions/`, `books/`, `embed/`.
- Each module owns its contracts in a `contracts` export, used by proposals 2 and 5.

## Suggested order
1. Pin HAX (proposal 1): an hour, and the biggest immediate safety gain.
2. Contract tests plus the runtime guard (proposals 2 and 5): they share one contract list, about a day.
3. Visual and accessibility CI (proposals 3 and 4) on GitHub Actions, about a day.
4. Upstream PRs (proposal 6), one at a time, starting with the server crash fix and `::part()` names.
