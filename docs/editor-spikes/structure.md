# Spike A: nested items, manual slots, shadow controls

*WP-01 of `docs/editor-redesign/work-packages.md`, measured first on 2026-10-09 in Chrome only, then on 2026-10-10 in Chrome 155 (headless, puppeteer-core), Firefox 137 and WebKit 18.4 (Safari's engine; Playwright's builds through the harness's adapter), against HAX 26.8.1. Paths are under `learning-materials/custom/src` unless they start with `nu-hax/`.*

Run it with `node scripts/editor-check/spikes/structure/run.mjs --engines chrome,firefox,webkit` (port 3104 unless `--port`, a copy of the site's last commit; about 7 minutes in Chrome and 9 in Firefox and in WebKit). It adds `spike-blocks.js` and a page of spike sections (`page.html`) to the copy only, and prints a JSON table of `{check, variant, engine, pass}`. The engines take turns on one copy, which the spike never saves to. A failing row is a measured no-go, not a broken run; the runner exits 0 when every row was measured. `--only bare` runs just the bare-page check (no HAX, no site). The last runs had 94 rows per engine, none unmeasured: Chrome 76 go and 18 no-go, Firefox 60 and 34, WebKit 72 and 22.

## Verdict

| Primitive | Chrome | Firefox | WebKit | What the build must do |
|---|---|---|---|---|
| **S1** Items as nested HAX grids (insert, duplicate, delete) | **Go** | **Go** | **Go** | Pass the *item* to `haxInsert`, and set `body.__addAbove = false` first (HAX starts it as `true`). An explicit `__rehydrateLayoutDescendants` isn't needed. |
| **S1** Keys handled on the section host | No-go | No-go | No-go | The host never hears keys. Use **one capture listener on hax-body**, and stop *every* typed key in fields that mustn't run HAX's Markdown shortcuts. |
| **S2** Manual slots: drawing, accessibility, undo and redo, Edit HTML, import, stray slot | **Go** | **Go** | **Go** | Re-assign on every render and every child change. |
| **S2** Manual slots: a click puts the caret in a field | **Go** | **Go** only with `user-select: none` on the shadow chrome itself | **Go** | Never put `user-select: none` on an element that contains a slot (Firefox then can't put the caret in any slotted field). |
| **S2** Manual slots: arrow keys | **Go** | **Go** only with the key listener moving the caret between fields: ↑ and ↓ never enter the cards, ← and → skip empty fields (Firefox's own, on a bare page too) | **Go** once arrow keys are kept from HAX: HAX's arrow handler throws the caret out of the content in WebKit, in any paragraph | The hax-body key listener keeps arrow keys from HAX and moves the caret to the next or previous field itself at a field's edge. |
| **S2** Fallback, `slot="heading"` only | Go, not chosen | Same failures as manual | Same failures as manual | Not needed in any engine: it fails exactly the caret checks manual slots fail, and the fixes are the same. Stray content is drawn inside the list in all three. |
| **S7** Shadow controls in `contentEditable` grid hosts | **Go** with the full guard | **Go** with the full guard | **Go** with the full guard | Stop `click`, `dblclick` **and `focus`** as well as the spec's six. `focus` is required, not a precaution. |
| Selection reading | **Go**: `ShadowRoot.getSelection()` or `getComposedRanges({shadowRoots})` | **Go**: `document.getSelection()` (no `getComposedRanges` in 137) | **Go**: only `getComposedRanges(...shadowRoots)` (the `{shadowRoots}` form throws) | One `getEditRange()` that tries them in that order reads the caret in all three. |
| Selection setting | `collapse`, `setBaseAndExtent`, `addRange` | Same | `collapse`, `setBaseAndExtent`; `addRange` empties the selection | Move the caret with `collapse()` or `setBaseAndExtent()`, never `addRange()`. |

**Chosen approach:** manual slots everywhere, in all three engines (spec §5.2), with the ten changes under *Changes to the spec*. WP-01's risk (WebKit's selection making the fallback necessary) didn't come true: the fallback fails the same caret checks as manual slots in Firefox and WebKit, because the causes are an engine's caret movement (Firefox) and HAX's own selection reading (WebKit), not slot assignment. WP-07 doesn't need a per-engine fallback.

## Per engine, every check

Go is the result the design needs; a no-go row is a measured failure (some are expected: they show why a choice was made). "Manual" is `oer-spike-learn`, "fallback" `oer-spike-learn-fb`. The full measurement for each row is in `results.json` (Chrome), `firefox/results.json` and `webkit/results.json` in `docs/editor-spikes/structure/`.

| Check | Variant | Chrome | Firefox | WebKit |
|---|---|---|---|---|
| S1: `haxInsert` of an item, caret placed after `settled()` | manual, without | Go | Go | Go |
| ″ | manual, with `__rehydrateLayoutDescendants` | Go | Go | Go |
| ″ | fallback, without | Go | Go | Go |
| ″ | fallback, with `__rehydrateLayoutDescendants` | Go | Go | Go |
| S1: `haxDuplicateNode` of an item | manual | Go | Go | Go |
| ″ | fallback | Go | Go | Go |
| S1: `haxDeleteNode` of an item | manual | Go | Go | Go |
| ″ | fallback | Go | Go | Go |
| S1: `haxInsert` passed the field instead of the item | manual | Go | Go | Go |
| ″ | fallback | Go | Go | Go |
| S1 keys: which listeners a key reaches, in order | caret in an item title | Go | Go | Go |
| S1 keys: a keydown listener on the section host runs before hax-body's window handler | host | **No-go** | **No-go** | **No-go** |
| S1 keys: HAX's own behaviour with nothing stopped (baseline) | off | Go | Go | Go |
| S1 keys: stopping propagation suppresses Enter, '/', Markdown and the double-arrow insert | on the section host, the keys that finish a shortcut | **No-go** | **No-go** | **No-go** |
| ″ | capture on hax-body, the keys that finish a shortcut | **No-go** | **No-go** | Go |
| ″ | capture on window, the keys that finish a shortcut | **No-go** | Go | Go |
| ″ | capture on hax-body, every typed key | Go | Go | Go |
| S2: renders the reader layout | manual, reading | Go | Go | Go |
| ″ | fallback, reading | Go | Go | Go |
| ″ | manual, editing | Go | Go | Go |
| ″ | fallback, editing | Go | Go | Go |
| S2: accessibility tree: heading outside the list, N listitems | manual, reading | Go | Go | Go |
| ″ | fallback, reading | Go | Go | Go |
| ″ | manual, editing | Go | Go | Go |
| ″ | fallback, editing | Go | Go | Go |
| S2: axe on the section (WCAG 2.2 AA) | manual, reading | Go | Go | Go |
| ″ | fallback, reading | Go | Go | Go |
| ″ | manual, editing | Go | Go | Go |
| ″ | fallback, editing | Go | Go | Go |
| S2: arrow keys move the caret across slotted fields | manual, chrome selectable (spec as drawn) | **No-go** | **No-go** | **No-go** |
| ″ | manual, wrapper `user-select: none` | Go | **No-go** | **No-go** |
| ″ | manual, wrapper none + `::slotted(*)` text | Go | **No-go** | **No-go** |
| ″ | manual, chrome-only `user-select: none` | Go | **No-go** | **No-go** |
| ″ | manual, chrome-only `user-select: none`, arrows kept from HAX | Go | **No-go** | Go |
| ″ | manual, chrome-only `user-select: none`, `HAXStore.getSelection()` patched | Go | **No-go** | Go |
| ″ | manual, chrome-only `user-select: none`, field-to-field controller | Go | Go | Go |
| ″ | fallback, chrome selectable (spec as drawn) | **No-go** | **No-go** | **No-go** |
| ″ | fallback, wrapper `user-select: none` | Go | **No-go** | **No-go** |
| ″ | fallback, wrapper none + `::slotted(*)` text | Go | **No-go** | **No-go** |
| ″ | fallback, chrome-only `user-select: none` | Go | **No-go** | **No-go** |
| ″ | fallback, chrome-only `user-select: none`, arrows kept from HAX | Go | **No-go** | Go |
| ″ | fallback, chrome-only `user-select: none`, `HAXStore.getSelection()` patched | Go | **No-go** | Go |
| ″ | fallback, chrome-only `user-select: none`, field-to-field controller | Go | Go | Go |
| S2: a click on an empty field puts the caret in it | manual, wrapper `user-select: none` | Go | **No-go** | Go |
| ″ | fallback, wrapper `user-select: none` | Go | **No-go** | Go |
| ″ | manual, chrome-only `user-select: none` | Go | Go | Go |
| ″ | fallback, chrome-only `user-select: none` | Go | Go | Go |
| S2: a click on an empty heading puts the caret in it | manual (note section), wrapper `user-select: none` | Go | **No-go** | Go |
| ″ | manual (note section), chrome-only `user-select: none` | Go | Go | Go |
| S2: slots are re-assigned after undo and redo | manual | Go | Go | Go |
| ″ | fallback | Go | Go | Go |
| S2: saved HTML is clean | manual | Go | Go | Go |
| ″ | fallback | Go | Go | Go |
| S2: slots after an Edit HTML round trip | manual | Go | Go | Go |
| ″ | fallback | Go | Go | Go |
| S2: slots after importContent of new content | manual | Go | Go | Go |
| ″ | fallback | Go | Go | Go |
| S2: a paragraph a section doesn't take shows in the stray slot | manual, imported | Go | Go | Go |
| ″ | fallback, imported | **No-go** | **No-go** | **No-go** |
| ″ | manual, added live | Go | Go | Go |
| ″ | fallback, added live | **No-go** | **No-go** | **No-go** |
| S2: slots after the section's own Edit HTML (source view) | manual | Go | Go | Go |
| S2: assignment has to follow every change (no observer) | manual | Go | Go | Go |
| S2: on a bare page (no HAX): a click puts the caret in a slotted field | wrapper `user-select: none` | Go | **No-go** | Go |
| ″ | wrapper none + `::slotted(*)` text | Go | Go | Go |
| ″ | chrome-only `user-select: none` | Go | Go | Go |
| S2: on a bare page (no HAX): arrow keys move through slotted fields | wrapper `user-select: none` | Go | **No-go** | Go |
| ″ | wrapper none + `::slotted(*)` text | Go | **No-go** | Go |
| ″ | chrome-only `user-select: none` | Go | **No-go** | Go |
| ″ | chrome-only `user-select: none`, `<br>` in the empty fields | Go | **No-go** | Go |
| S7: clicks on content just above the active block reach it | HAX's #topcontextmenu | **No-go** | **No-go** | **No-go** |
| S7: a shadow field and button keep focus, and typing stays in them | contentEditable: true, no guard | **No-go** | **No-go** | **No-go** |
| ″ | contentEditable: true, the spec's guard (6 events) | **No-go** | **No-go** | Go |
| ″ | contentEditable: true, the spec's guard + focus | **No-go** | Go | Go |
| ″ | contentEditable: true, the spec's guard + click, dblclick | **No-go** | **No-go** | Go |
| ″ | contentEditable: true, full guard (+ click, dblclick, focus) | Go | Go | Go |
| ″ | contentEditable: false, no guard | **No-go** | **No-go** | **No-go** |
| ″ | contentEditable: false, the spec's guard (6 events) | Go | Go | Go |
| ″ | contentEditable: false, the spec's guard + focus | **No-go** | Go | Go |
| ″ | contentEditable: false, the spec's guard + click, dblclick | Go | Go | Go |
| ″ | contentEditable: false, full guard (+ click, dblclick, focus) | Go | Go | Go |
| S7: an item's shadow button (icon tile) keeps focus and works | contentEditable: true, full guard | Go | Go | Go |
| Selection reading: `ShadowRoot.getSelection()` | caret 2 before a title's end | Go | **No-go** | **No-go** |
| Selection reading: `document.getSelection()` | caret 2 before a title's end | **No-go** | Go | **No-go** |
| Selection reading: `getComposedRanges({shadowRoots})` | caret 2 before a title's end | Go | **No-go** | **No-go** |
| Selection reading: `getComposedRanges(...shadowRoots)`, WebKit 18's form | caret 2 before a title's end | **No-go** | **No-go** | Go |
| Selection reading: `getComposedRanges()` without roots | caret 2 before a title's end | **No-go** | **No-go** | **No-go** |
| Selection reading: `HAXStore.getSelection()`, what HAX reads | caret 2 before a title's end | Go | Go | **No-go** |
| Selection reading: `getEditRange()`, one function for every engine | caret 2 before a title's end | Go | Go | Go |
| Selection setting: `collapse` | then typing | Go | Go | Go |
| Selection setting: `setBaseAndExtent` | then typing | Go | Go | Go |
| Selection setting: `addRange` | then typing | Go | Go | **No-go** |
| HAX's own arrow keys and Enter in an ordinary paragraph | as HAX has it | Go | Go | **No-go** |
| ″ | `HAXStore.getSelection()` patched | Go | Go | Go |

## S1: items as nested HAX grids

The spike section `oer-spike-learn` (`type: "grid"`, `contentEditable: true`) holds `oer-spike-outcome` items (also grids). The same checks ran on the fallback pair. **Every S1 check behaves the same in the three engines**, with timings within a few milliseconds of each other; the ranges below cover both days' runs in all three.

| Check | Manual | Fallback | Measured |
|---|---|---|---|
| `haxInsert(tag, "<h3></h3><p></p>", {}, item)` | Go | Go | Lands right after the item passed, once `body.__addAbove = false`. It was `true` on every fresh page (set in hax-body's constructor), and a first pass that left it alone put the new item *before* the one passed (`s1-insert-first-pass.json`). |
| New fields get `data-hax-ray` and `contenteditable` | Go | Go | Not at insert time; 3–19 ms later, from HAX's MutationObserver. That's before `settled()` returns (45–65 ms). With or without an explicit `__rehydrateLayoutDescendants`, the timings are the same. |
| Where `activeNode` lands | Go | Go | Caret field → the new **item** (finalizeInsert, 11–40 ms) → the new **title** once the caret goes in and `__focusLogic(h3, false)` runs (63–86 ms). |
| Caret placed after `settled()` survives | Go | Go | In the new title at every 50 ms sample for 1 s; typing "Added" filled it. The caret was placed with `setBaseAndExtent` (WebKit ignores `addRange`, see *Selection*). |
| `haxDuplicateNode(item)` | Go | Go | The copy matches the original apart from whitespace between tags. It becomes `activeNode`, its fields are hydrated at 3–8 ms, and the caret in its title stays. |
| `haxDeleteNode(item)` | Go | Go | 5 → 4 items; `activeNode` moves to the previous item. |
| Passing the field instead of the item | (expected) | (expected) | The new item is nested *inside* the item, as spec §5.6 warns. |

Every operation left the section drawn correctly (all items drawn, in the list, in DOM order).

### S1 keys

| Check | Result | Measured |
|---|---|---|
| A keydown listener on the section host runs before hax-body's window handler | **No-go** in all three | The host never hears it. The key's target is the editing host, **hax-body**, which *contains* the section; focus is on hax-body. Order, the same in all three: window capture → hax-body (at target) → HAX's window `_onKeyDown`, the same for keyup. |
| HAX's behaviour with nothing stopped (baseline) | (reference) | Enter in a title changed the section; "/" in an empty title opened the command palette; "- " in an empty sentence made a `ul`; "1. " made an `ol`; in all three. A double ↑ in the first section's heading and a double ↓ in the last section's heading each added a paragraph outside the sections in Chrome, and nothing in Firefox and WebKit. |
| Stopping only the keys that finish a shortcut (Enter, "/", space, keyup ↑↓) on the host | No-go | Nothing stopped (0 keys handled), in all three. |
| … in a capture listener on hax-body | No-go in Chrome and Firefox, go in WebKit | Enter, "/" and the double arrows are suppressed, but "- " (Chrome) and "1. " (Chrome; Firefox in the last run, not in an earlier one) typed at full speed still made lists. |
| … in a capture listener on window | No-go in Chrome | Same race; it didn't show in Firefox or WebKit this time. |
| Stopping **every typed key** (plus Enter and keyup ↑↓) in those fields, capture on hax-body | **Go** in all three | All six suppressed, "/" and "- " typed as text. |

The Markdown race: HAX checks for a shortcut in a `setTimeout` after *any* key. When the key before the space ("-") reaches HAX, its check can run after the space has already been typed: in a direct test in Chrome it fired at 0 ms between keys and not at 10 or 50 ms. It's timing, so an engine where it didn't show in one run isn't safe from it; the listener stops every typed key in all of them.

The section's listener finds the caret's field with the spike's `getEditRange()` (in `spike-blocks.js`), which read it with `ShadowRoot.getSelection()` in Chrome, `document.getSelection()` in Firefox and `getComposedRanges(...shadowRoots)` in WebKit.

## S2: manual slot assignment

The section sorts its children by hand (`slotAssignment: "manual"`): the first `h2` into `heading`, the items into `items` inside `<div role="list">`, accepted text into `text`, and anything else into `stray` (drawn only while editing). Items put their first `h3` in `title` and the rest in `text`, and get `ElementInternals.role = "listitem"`. The fallback stores `slot="heading"` on the heading, and everything else goes in the default slot inside the list.

| Check | Manual | Fallback | Measured |
|---|---|---|---|
| Renders the reader layout, reading and editing | Go | Go | 3/3 items drawn inside the list, heading above and outside it, DOM order; all three engines. |
| Accessibility tree (each engine's own) | Go | Go | `h2` outside the list; one list of 3 listitems, each with an `h3`; placeholder text absent (it's `aria-hidden`); all three engines. Chrome's tree is read through the DevTools protocol, Firefox's and WebKit's through Playwright's snapshot (`ax-*.json` in each engine's folder). Two WebKit details: the snapshot lists slots and `aria-hidden` spans as `Unknown` (a plain `aria-hidden` span on a bare page shows the same way, so the summary passes through them and ignores their own text); and **while editing, WebKit exposes each field as a text area that keeps its heading level**, because HAX gives every field `contenteditable` of its own. That's every HAX page in Safari, not something slots cause; the reading view, which readers get, has real headings. |
| axe-core 4.14 on the section | Go | Go | No violations, reading or editing, in all three. Only once the internals are kept in a field named `_internals`: axe reads `ElementInternals` only from `_internals`, `internals` or `internals_`. With `__internals` it reported a false `aria-required-children` (critical) in the reading view (Chrome, first run). |
| Arrow keys, shadow chrome selectable (as the spec draws it) | **No-go** | **No-go** | In all three. In Chrome ← from the start of the next block jumped to the section's heading instead of the empty last field; in the first pass (icon tile before the title, nothing `user-select: none`), → skipped every title and then stayed at the end of item 2: `arrow-keys-first-pass.json`. |
| Arrow keys, `user-select: none` on the shadow chrome | **Go** in Chrome | **Go** in Chrome | → from the heading visits every field in DOM order, empty ones included, and leaves the section. ←, ↓ (into the cards and from card to card) and ↑ land in the expected fields. In Firefox and WebKit: see below. |
| Arrow keys, the key listener moving the caret field to field | **Go** in all three | **Go** in all three | See *Arrow keys in Firefox and WebKit*. |
| A click on an empty field puts the caret in it | Go | Go | Empty title, empty sentence and an empty `h2` (`min-block-size: 1lh`): the caret lands in the field under the placeholder and typing fills it. The placeholder hides, and `activeNode` is the field. In Firefox only with `user-select: none` on the chrome itself, not on a wrapper of the slots. |
| Re-assigned after `body.undo()` / `redo()` | Go | Go | Undo replaces hax-body's HTML (the section is re-created each time). After two undos and two redos every state drew correctly: 4, then 3, 3, 3 and 4 items; all three engines. |
| Saved HTML is clean | Go | Go | Manual: no `slot` attribute, no `data-hax-`, `contenteditable` or `role`. Fallback: only the heading's `slot="heading"`. |
| Edit HTML round trip (`haxToContent` → `importContent`) | Go | Go | Drawn correctly. The HTML is unchanged apart from whitespace: HAX adds a line break between nested blocks on every pass (+7 characters), in all three. |
| The section's own Edit HTML (source view) | Go | – | The section is replaced by a new element and draws correctly. |
| `importContent` of new content | Go | Go | 4/4 items drawn. |
| A paragraph the section doesn't take goes to the stray slot | **Go** | **No-go** | Manual: in `stray`, drawn in the "Readers won't see" box, both imported and added live. Fallback: drawn as a grid cell *inside* the list (`s2-stray-fallback-editing.png`); all three engines. |
| Assignment must follow every change | Go | – | With the observer off, an added paragraph isn't drawn, and swapped items keep their old order (2,1,3). `assignSlots()` fixes both. |

### `user-select` in Firefox

The first spike made everything a section or item draws in shadow DOM `user-select: none` with `.editing, .editing *` on the shadow wrapper. In Firefox that wrapper is an ancestor of the slots in the flat tree, and **a slotted field under a `user-select: none` ancestor can't take the caret at all, even though it's editable**: a click on any field of the section left the caret where it was (or put it at the start of the heading), typing went nowhere, and → jumped from the heading straight past the section. Chrome and WebKit treat editable content as selectable whatever its ancestors say.

The bare-page check (`s2Bare`, `--only bare`) shows it's Firefox's own: an editing host in a shadow root, a section and items with manual slots and `contenteditable` on every field, no HAX and no site. With the wrapper rule nothing can be clicked in Firefox; with `::slotted(*) { user-select: text }` added, or with `user-select: none` on the chrome only (placeholders, tiles, controls, the stray box's message), clicks work. `spike-blocks.js` now does the latter, which the arrow and click checks above use.

### Arrow keys in Firefox and WebKit

With the chrome-only rule, the caret still doesn't move as it should in either engine, for different reasons:

- **Firefox, the engine.** ← and → move through the fields but skip empty ones (item 3's title and text, both empty, are passed over in both directions); ↑ and ↓ never move into or between the cards (↓ from the heading goes to the paragraph after the section, ↑ from the second title leaves the content). On the bare page it's the same, and in the HAX page the fallback's named slots fail the same way; a `<br>` in the empty fields fixes ← and → but not ↑ and ↓.
- **WebKit, HAX.** Any arrow key in the content, in a slotted field or an ordinary paragraph, takes the caret out of it: focus goes to `<body>`, the caret to the theme's `<article>`, and Enter afterwards does nothing. hax-body's keydown handler for arrows reads the caret with `HAXStore.getRange()`; in WebKit `HAXStore.getSelection()` is the document's selection, which stops at the outermost shadow host (`haxcms-site-builder`, offset 0), and `__focusLogic()` on that host moves focus out. Keeping arrow keydown from HAX (a capture listener on hax-body that stops it) makes every arrow check pass in WebKit, and so does patching `HAXStore.getSelection()` to read the composed range (`__spike.patchHaxSelection()`, which also makes Enter split a paragraph again: *HAX's own arrow keys and Enter*). On the bare page WebKit moves the caret correctly.

**The field-to-field controller** (`arrow()` and `arrowInto()` in `spike-blocks.js`, turned on with `__spikeKeys.arrows`) passes every arrow check in all three engines, manual and fallback: the section's capture listener on hax-body keeps arrow keys from HAX; inside a field it lets the browser move the caret; at a field's edge (← at its start, → at its end, ↑ on its first line, ↓ on its last) it moves the caret to the previous or next field, or the block beside the section, with `collapse()`; and from the paragraph just before or after the section it moves the caret into the section's first or last field. It reads the caret with `getEditRange()` and compares the caret's rectangle with the field's for the line. That's the key controller of spec §5.3 with arrows added, and it's what WP-07 should build.

## S7: controls in shadow DOM inside grid hosts

Each section draws pairs of a field and a button in shadow DOM, with different sets of events stopped at the control. Measured: click the field from another block, then type "abc", Backspace and Enter, and paste. Then Tab to the button, press Enter and Space, click the button, call `focus()` on the field, click the field with the section selected, and double-click a word. "Kept" means deep focus was on the control at 0, 50, 100, 200, 400 and 700 ms, and hax-body's HTML was unchanged (ignoring the `element-visible` that `page-break` sets on itself when it scrolls into view). **Each guard is now measured on a fresh page** (the first, Chrome-only run went through them one after another on one page).

| Guard on the control | `contentEditable: true` | `contentEditable: false` |
|---|---|---|
| None | No-go in all three | No-go in all three |
| The spec's six (pointerdown, mousedown, focusin, keydown, keyup, paste) | No-go in Chrome (click with the section selected) and Firefox (the first click from another block); go in WebKit | Go in all three |
| Six + focus | No-go in Chrome (click with the section selected, double-click); go in Firefox and WebKit | No-go in Chrome (double-click); go in Firefox and WebKit |
| Six + click, dblclick | No-go in Chrome and Firefox (the first click from another block); go in WebKit | Go in all three |
| **Six + click, dblclick, focus** | **Go in all three** | **Go in all three** |
| An item's icon tile (all nine) | **Go in all three**: its click handler ran, HAX did nothing | – |

Why, from stack traces in Chrome:
- **`click`**: HAX's window click listener (`scrollerFixclickEvent`) runs `positionContextMenus(activeNode)`. That sets, or removes, `contenteditable` on the active block, and *any* change to it blurs a focused shadow control, even setting it to the value it already has. So `contentEditable: true` doesn't prevent the blur.
- **`focus` and `dblclick`**: HAX bug. The text toolbar's `targetHandlers(target)` makes new closures on every call, so `unsetTarget` never removes the old ones. Every block that was ever the toolbar's target keeps `focus`, `dblclick`, `keydown` and `paste` listeners. A host hears `focus` when something in its shadow root takes focus, and the stale listener calls `setTarget(host)` → `enableEditing` → blur, plus `role="textbox"` on the host. This is an upstream pull-request candidate (keep the handlers in a WeakMap per target).

**Why `focus` is now required:** on a fresh page the spike section is the first block, which HAX selects when edit mode starts, so it's the text toolbar's target from the beginning and carries the stale `focus` listener before anyone clicks. "Six + click, dblclick" then lost focus on the very first click in Chrome and Firefox (it passed in the first run only because earlier guards had already been through the section). A course site's first section (the hero) is in exactly that position.

**WebKit and buttons:** WebKit, like Safari on a Mac, doesn't focus a button that's clicked. A click on a shadow button left focus on hax-body (the editing host), ran the button's handler, and HAX changed neither the content nor the active block; that counts as kept there. Tab and the keyboard reach the button normally. So anything a shadow button opens (the icon picker, the image popover) must move focus into itself, and can give focus back to "the button that opened it" only when the button was reached by keyboard.

Keeping `contentEditable: true` on grids with in-place controls, as the spec says, does no harm. But the guard, not the flag, keeps focus.

**Also found: HAX's hidden context menu takes clicks**, in all three engines. The theme hides `hax-plate-context` and the text toolbar with `pointer-events: none`, but not their container, `#topcontextmenu` in hax-body's shadow root: an invisible 572×74 px box above the active block. With a paragraph active, a click on the control at the bottom of the section above it landed on `div#topcontextmenu`. Adding `#topcontextmenu { pointer-events: none }` to hax-body's skin made it land on the control. This affects editing today, not only the new model.

## Selection in each engine

With the caret clicked in between the last two characters of an item title (offset 17 of its text):

| Way of reading it | Chrome | Firefox | WebKit |
|---|---|---|---|
| `hax-body.getRootNode().getSelection()` (h-a-x's shadow root) | the text, 17 | not there | not there |
| `document.getSelection()` | `haxcms-site-builder`, 0 | **the text, 17** | `haxcms-site-builder`, 0 |
| `getComposedRanges({shadowRoots: [h-a-x's, the theme's]})` | the text, 17 | not there | TypeError |
| `getComposedRanges(h-a-x's, the theme's)` (WebKit 18's form) | `haxcms-site-builder`, 0 | not there | **the text, 17** |
| `getComposedRanges()` without roots | `haxcms-site-builder`, 0 | not there | `haxcms-site-builder`, 0 |
| `HAXStore.getSelection()`, what HAX reads | the text, 17 | the text, 17 | `haxcms-site-builder`, 0 |
| **`getEditRange()`** (below) | **the text, 17** | **the text, 17** | **the text, 17** |

`getEditRange()` as the spike wrote it (`spike-blocks.js`): take `root.getSelection?.() || document.getSelection()`; if its range starts in the root that holds the content, use it (Chrome, Firefox); otherwise try `getComposedRanges({ shadowRoots })` with every shadow root from the content's up, then `getComposedRanges(...shadowRoots)` (WebKit 18), and use the result if it starts in that root. Newer Safari and Firefox releases may take the `{shadowRoots}` form; trying it first keeps the function right either way.

Setting the caret, 3 characters into a field and then typing "X", on the selection `getEditRange()` reads: `collapse()` and `setBaseAndExtent()` put it there in all three. `addRange()` with a range inside the shadow root works in Chrome and Firefox, and in WebKit empties the selection, so the "X" went nowhere.

## Changes to the spec

1. **§5.3 keys:** `cs-keys.js` can't listen on section and item hosts, in any engine. Instead, the editor installs one `keydown` and `keyup` listener on hax-body, in the capture phase, on each edit entry. It finds the field from `getEditRange()` and calls the unit's key handler (blocks still don't import HAX). In headings, titles, tools and outcome sentences, it stops every typed key and Enter, not only those that finish a shortcut (the Markdown race showed in Chrome and Firefox). In answers it lets HAX's shortcuts through. It stops keyup ↑↓ everywhere in units. HAX then doesn't see printable keys in those fields (its `_useristyping` and `data-hax-empty` bookkeeping), which the design doesn't use. A pinned guard on `keyboardShortCutProcess` in `hax-fixes.js` is a possible backstop; it wasn't measured.
2. **§5.3 arrow keys (new):** the same listener handles ← → ↑ ↓ (without modifiers) whenever the caret is in a unit or in the block just before or after one: it stops them from reaching HAX, lets the browser move the caret inside a field, and at a field's edge moves it to the previous or next field (DOM order: the heading, then each item's title and text), or out to the block beside the unit, with `collapse()`; from that neighbouring block it moves into the unit's first or last field. "Arrows … fall through to HAX" in §5.3 goes. Without it, ↑ and ↓ can't reach the cards in Firefox, ← and → skip empty fields there, and in WebKit HAX throws the caret out of the content. HAX's active block then follows through the `selectionchange` sync (§4.1), since HAX no longer sees the keys.
3. **§5.3 `getEditRange()`:** as above, in this order: the root's own selection, the document's when it holds the content's nodes, `getComposedRanges({shadowRoots})`, `getComposedRanges(...shadowRoots)`. Every caret move goes through `collapse()` or `setBaseAndExtent()` on `root.getSelection?.() || document.getSelection()`, never `addRange()`.
4. **§6.2 #5 `editorControl()`:** stop `pointerdown`, `mousedown`, `click`, `dblclick`, `focus`, `focusin`, `keydown`, `keyup` and `paste`; all nine, `focus` included, in every engine. The reason is the HAX causes in S7, not the `contentEditable` flag. The `beforeinput` guard (§6.2 #2) should ignore events whose `composedPath()[0]` is a shadow control, since their input events are composed. Popovers opened from a shadow button focus their own first field when they open (WebKit never focuses the button), and give focus back to the button only when it was reached by keyboard.
5. **§5.2 and §5.5 shadow chrome:** while editing, the things a section or item draws in shadow DOM (placeholders, tiles, buttons, controls, the stray box's message) are `user-select: none`, **each of them, never an element that contains a slot**. A wrapper rule (`.editing *`) makes every slotted field unclickable in Firefox. (`::slotted(*) { user-select: text }` alongside a wrapper rule also works, but a rule on the chrome is simpler.) The light-DOM fields stay selectable as editable content.
6. **§5.6 `ops.js`:** set `body.__addAbove = false` (or `true` for "Add above") before every `haxInsert`, as `slots.js` and `layouts.js` already do. Always pass the item. The explicit `__rehydrateLayoutDescendants` can go; it's harmless if kept. The caret goes into the new title with `collapse()` after `settled()`. Same in all three engines.
7. **§5.2 items:** keep the `ElementInternals` in a field named `_internals`, so axe-core sees `role="listitem"`.
8. **Skin and `hax-fixes.js` (WP-03 or WP-04):** `#topcontextmenu { pointer-events: none }` in hax-body's shadow styles (all three engines).
9. **`hax-fixes.js` (WP-03 or WP-04), WebKit (new):** patch `HAXStore.getSelection()` so that when the root has no `getSelection()` and the document's selection doesn't reach the content, it returns a stand-in built from the composed range: the anchor and focus from it, `getRangeAt(0)` a live `Range` over it, and `addRange(r)` doing `setBaseAndExtent()`. Measured with the spike's version (`__spike.patchHaxSelection()`): HAX's own arrow keys and Enter work again in WebKit, in ordinary paragraphs and in units. It changes nothing in Chrome and Firefox. Without it, editing any page in Safari loses the caret on the first arrow key (see the lifecycle spike for the same fix in WP-04).
10. **Site code that reads the selection (WP-07 and the stopgaps):** every `getRootNode().getSelection?.() || globalThis.getSelection()` reads `haxcms-site-builder` at offset 0 in WebKit. They move to `getEditRange()`: `blocks/course-site/cs-shared.js` (three places), `editor/hax-fixes.js`, `editor/oer-block-inserter.js`, `editor/citations.js`, `editor/oer-block-rail.js` (two) and `ui/oer-text-editor.js` (two, its own shadow root).

Also for WP-05: an Edit HTML round trip adds whitespace between nested blocks. The dirty-state baseline (§3.3) should collapse whitespace between tags, or Edit HTML with no change would read "Unsaved changes".

Also found while adapting the runner: HAX's `editModeTransitioning` state never clears after the first edit-mode change, in every engine (`updated()` sets it, then awaits `waitForStable()`, which waits for every busy state, its own included), so `_contentState.isContentBusy()` is always true while editing. Code that wants to know whether HAX is busy should ask about `importing` or `inserting` by name. An upstream candidate.

## Not covered

- Firefox and WebKit as released: these are Playwright's builds (Firefox 137, WebKit 18.4). Safari 26 and current Firefox may take `getComposedRanges({shadowRoots})`; `getEditRange()` tries it first.
- Screen readers: the accessibility trees are the engines' own, read by tools, not VoiceOver or NVDA.
- IME composition (Chrome only in the harness), drag and drop, and touch.
- How many undo steps an edit makes. Typing plus one insert made 3 steps in all three engines (S4, in WP-02).
- Styling: field styles from the page win over `::slotted()`, so a slotted `h3` took the page's large heading size. The shared sheet (WP-06) has to style fields.
- The controller's ↑ and ↓ decide "first line" and "last line" from the caret's rectangle; long wrapped titles and the cards side by side were measured, right-to-left text wasn't.

## Evidence

In `docs/editor-spikes/structure/`, copied from each run's report folder (`--evidence`): Chrome's files in the folder itself, Firefox's in `firefox/` and WebKit's in `webkit/`, with the same names.

| File | What it shows |
|---|---|
| `results.json` | Every row of the engine's last run, with the full measurement text and the browser's version |
| `s1-insert-manual.json`, `s1-insert-manual-rehydrate.json`, `s1-insert-fallback.json`, `s1-insert-fallback-rehydrate.json` | The insert timelines: `activeNode`, HAX's inserting flag, and when each field got `data-hax-ray` and `contenteditable` |
| `s1-insert-first-pass.json` (Chrome) | An insert with `__addAbove` left as HAX set it: the new item went before the one passed |
| `s1-keys.json` | Each listening mode's results and listener order |
| `arrow-keys-first-pass.json` (Chrome) | The first pass's arrow-key failure, before the `user-select` rule |
| `ax-manual-reading.json`, `ax-manual-editing.json`, `ax-fallback-reading.json`, `ax-fallback-editing.json` | The section's accessibility tree as the engine reports it |
| `s2-saved.html` | The page as HAX saves it (`haxToContent`) |
| `s2-manual-reading.png`, `s2-manual-editing.png`, `s2-fallback-reading.png`, `s2-fallback-editing.png` | The reader layout in both modes |
| `s2-typed-empty-fields.png` | Empty title, sentence and heading after clicking and typing (chrome-only `user-select`) |
| `s2-stray-manual-editing.png`, `s2-stray-fallback-editing.png` | A loose paragraph: in the stray box (manual), inside the list (fallback) |
| `s7-controls.png` | The control pairs while editing |

The code: `scripts/editor-check/spikes/structure/spike-blocks.js` (the throwaway blocks, with `getEditRange()` and the field-to-field controller), `page.html` (the spike page) and `run.mjs` (the runner, with `--engines` and the bare-page check). The harness's `startScratch` gained a `prepare(siteDir)` option for adding them to the copy only.
