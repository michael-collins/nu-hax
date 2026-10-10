# Spike A: nested items, manual slots, shadow controls

*WP-01 of `docs/editor-redesign/work-packages.md`, measured 2026-10-09 in Chrome 155 (headless, puppeteer-core) against HAX 26.8.1. Chrome only, by the owner's decision: Firefox and WebKit were not run. Paths are under `learning-materials/custom/src` unless they start with `nu-hax/`.*

Run it with `node scripts/editor-check/spikes/structure/run.mjs` (port 3104, a copy of the site's last commit, about 4 minutes). It adds `spike-blocks.js` and a page of spike sections (`page.html`) to the copy only, and prints a JSON table of `{check, variant, engine, pass}`. A failing row is a measured no-go, not a broken run; the runner exits 0 when every row was measured. The last run: 63 rows, 48 pass, 15 no-go, 0 not measured.

## Verdict

| Primitive | Chrome | What the build must do |
|---|---|---|
| **S1** Items as nested HAX grids (insert, duplicate, delete) | **Go** | Pass the *item* to `haxInsert`, and set `body.__addAbove = false` first (HAX starts it as `true`). An explicit `__rehydrateLayoutDescendants` isn't needed. |
| **S1** Keys handled on the section host | **No-go** | The host never hears keys. Use **one capture listener on hax-body** instead, and stop *every* typed key in fields that mustn't run HAX's Markdown shortcuts. |
| **S2** Manual slot assignment | **Go** | Re-assign on every render and every child change. Make everything drawn in shadow DOM `user-select: none` while editing. |
| **S2** Fallback, `slot="heading"` only | Go, not chosen | Measured on every check. It works, but stray content is drawn inside the list, and the saved HTML carries `slot="heading"`. |
| **S7** Shadow controls in `contentEditable` grid hosts | **Go** with a longer guard | Stop `click` and `dblclick` as well as the spec's six events (`focus` too, to be safe). `contentEditable: true` is not what keeps focus. |
| Selection reading | **Go** | `ShadowRoot.getSelection()` or `getComposedRanges({shadowRoots})` (both give the real node). `document.getSelection()` doesn't. |

**Chosen approach:** manual slots everywhere (spec §5.2), with the six changes under *Changes to the spec* below. The `slot="heading"` fallback isn't needed in Chrome.

## S1: items as nested HAX grids

The spike section `oer-spike-learn` (`type: "grid"`, `contentEditable: true`) holds `oer-spike-outcome` items (also grids). The same checks ran on the fallback pair.

| Check | Manual | Fallback | Measured |
|---|---|---|---|
| `haxInsert(tag, "<h3></h3><p></p>", {}, item)` | Go | Go | Lands right after the item passed, once `body.__addAbove = false`. It was `true` on every fresh page (set in hax-body's constructor), and a first pass that left it alone put the new item *before* the one passed (`s1-insert-first-pass.json`). |
| New fields get `data-hax-ray` and `contenteditable` | Go | Go | Not at insert time; 4–10 ms later, from HAX's MutationObserver. That's before `settled()` returns (45–56 ms). With or without an explicit `__rehydrateLayoutDescendants`, the timings are the same. |
| Where `activeNode` lands | Go | Go | Caret field → the new **item** (finalizeInsert, 13–24 ms) → the new **title** once the caret goes in and `__focusLogic(h3, false)` runs (63–85 ms). |
| Caret placed after `settled()` survives | Go | Go | In the new title at every 50 ms sample for 1 s; typing "Added" filled it. |
| `haxDuplicateNode(item)` | Go | Go | The copy matches the original apart from whitespace between tags. It becomes `activeNode`, its fields are hydrated at 4–7 ms, and the caret in its title stays. |
| `haxDeleteNode(item)` | Go | Go | 5 → 4 items; `activeNode` moves to the previous item. |
| Passing the field instead of the item | (expected) | (expected) | The new item is nested *inside* the item, as spec §5.6 warns. |

Every operation left the section drawn correctly (all items drawn, in the list, in DOM order).

### S1 keys

| Check | Result | Measured |
|---|---|---|
| A keydown listener on the section host runs before hax-body's window handler | **No-go** | The host never hears it. The key's target is the editing host, **hax-body**, which *contains* the section; focus is on hax-body. Order: window capture → hax-body (at target) → HAX's window `_onKeyDown`, the same for keyup. |
| HAX's behaviour with nothing stopped (baseline) | (reference) | Enter in a title changed the section; "/" in an empty title opened the command palette; "- " in an empty sentence made a `ul`; "1. " made an `ol`; a double ↑ in the first section's heading and a double ↓ in the last section's heading each added a paragraph outside the sections. |
| Stopping only the keys that finish a shortcut (Enter, "/", space, keyup ↑↓) on the host | No-go | Nothing stopped (0 keys handled). |
| … in a capture listener on hax-body | No-go | Enter, "/" and the double arrows are suppressed, but "- " and "1. " typed at full speed still made lists. |
| … in a capture listener on window | No-go | Same as hax-body. |
| Stopping **every typed key** (plus Enter and keyup ↑↓) in those fields, capture on hax-body | **Go** | All six suppressed, "/" and "- " typed as text. |

The Markdown race: HAX checks for a shortcut in a `setTimeout` after *any* key. When the key before the space ("-") reaches HAX, its check can run after the space has already been typed: in a direct test it fired at 0 ms between keys and not at 10 or 50 ms. So stopping the space is not enough.

## S2: manual slot assignment

The section sorts its children by hand (`slotAssignment: "manual"`): the first `h2` into `heading`, the items into `items` inside `<div role="list">`, accepted text into `text`, and anything else into `stray` (drawn only while editing). Items put their first `h3` in `title` and the rest in `text`, and get `ElementInternals.role = "listitem"`. The fallback stores `slot="heading"` on the heading, and everything else goes in the default slot inside the list.

| Check | Manual | Fallback | Measured |
|---|---|---|---|
| Renders the reader layout, reading and editing | Go | Go | 3/3 items drawn inside the list, heading above and outside it, DOM order. |
| Accessibility tree (Chrome's own) | Go | Go | `h2` outside the list; one list of 3 listitems, each with an `h3`; placeholder text absent (it's `aria-hidden`). |
| axe-core 4.14 on the section | Go | Go | No violations, reading or editing. Only once the internals are kept in a field named `_internals`: axe reads `ElementInternals` only from `_internals`, `internals` or `internals_`. With `__internals` it reported a false `aria-required-children` (critical) in the reading view. |
| Arrow keys, shadow chrome selectable (as the spec draws it) | **No-go** | **No-go** | ← from the start of the next block jumped to the section's heading instead of the empty last field. In the first pass (icon tile before the title, nothing `user-select: none`), → skipped every title and then stayed at the end of item 2: `arrow-keys-first-pass.json`. |
| Arrow keys, shadow chrome `user-select: none` while editing | **Go** | **Go** | → from the heading visits every field in DOM order, empty ones included, and leaves the section. ←, ↓ (into the cards and from card to card) and ↑ land in the expected fields. |
| A click on an empty field puts the caret in it | Go | Go | Empty title, empty sentence and an empty `h2` (`min-block-size: 1lh`): the caret lands in the field under the placeholder and typing fills it. The placeholder hides, and `activeNode` is the field. |
| Re-assigned after `body.undo()` / `redo()` | Go | Go | Undo replaces hax-body's HTML (the section is re-created each time). After two undos and two redos every state drew correctly: 4, then 3, 3, 3 and 4 items. |
| Saved HTML is clean | Go | Go | Manual: no `slot` attribute, no `data-hax-`, `contenteditable` or `role`. Fallback: only the heading's `slot="heading"`. |
| Edit HTML round trip (`haxToContent` → `importContent`) | Go | Go | Drawn correctly. The HTML is unchanged apart from whitespace: HAX adds a line break between nested blocks on every pass (+7 characters). |
| The section's own Edit HTML (source view) | Go | – | The section is replaced by a new element and draws correctly. |
| `importContent` of new content | Go | Go | 4/4 items drawn. |
| A paragraph the section doesn't take goes to the stray slot | **Go** | **No-go** | Manual: in `stray`, drawn in the "Readers won't see" box, both imported and added live. Fallback: drawn as a grid cell *inside* the list (`s2-stray-fallback-editing.png`). |
| Assignment must follow every change | Go | – | With the observer off, an added paragraph isn't drawn, and swapped items keep their old order (2,1,3). `assignSlots()` fixes both. |

## S7: controls in shadow DOM inside grid hosts

Each section draws pairs of a field and a button in shadow DOM, with different sets of events stopped at the control. Measured: click the field from another block, then type "abc", Backspace and Enter, and paste. Then Tab to the button, press Enter and Space, click the button, call `focus()` on the field, click the field with the section already selected, and double-click a word. "Kept" means deep focus was on the control at 0, 50, 100, 200, 400 and 700 ms, and hax-body's HTML was unchanged.

| Guard on the control | `contentEditable: true` | `contentEditable: false` |
|---|---|---|
| None | No-go: focus lost at 0 ms on every click, `focus()` and Tab | No-go: lost on clicking the field or button and on `focus()` |
| The spec's six (pointerdown, mousedown, focusin, keydown, keyup, paste) | No-go: lost on the first click from another block, and on click with the section selected | No-go: lost on the first click |
| Six + focus | No-go: lost on click with the section selected, and on double-click | No-go: lost on double-click |
| **Six + click, dblclick** | **Go** | **Go** |
| Six + click, dblclick, focus | **Go** | **Go** |
| An item's icon tile (all nine) | **Go**: focus kept, its click handler ran | – |

Why, from stack traces:
- **`click`**: HAX's window click listener (`scrollerFixclickEvent`) runs `positionContextMenus(activeNode)`. That sets, or removes, `contenteditable` on the active block, and *any* change to it blurs a focused shadow control, even setting it to the value it already has. So `contentEditable: true` doesn't prevent the blur.
- **`focus` and `dblclick`**: HAX bug. The text toolbar's `targetHandlers(target)` makes new closures on every call, so `unsetTarget` never removes the old ones. Every block that was ever the toolbar's target keeps `focus`, `dblclick`, `keydown` and `paste` listeners. A host hears `focus` when something in its shadow root takes focus, and the stale listener calls `setTarget(host)` → `enableEditing` → blur, plus `role="textbox"` on the host. This is an upstream pull-request candidate (keep the handlers in a WeakMap per target).

Keeping `contentEditable: true` on grids with in-place controls, as the spec says, does no harm. But the guard, not the flag, keeps focus: with the full guard both settings pass.

**Also found: HAX's hidden context menu takes clicks.** The theme hides `hax-plate-context` and the text toolbar with `pointer-events: none`, but not their container, `#topcontextmenu` in hax-body's shadow root: an invisible 572×74 px box above the active block. With a paragraph active, a click on the control at the bottom of the section above it landed on `div#topcontextmenu`. Adding `#topcontextmenu { pointer-events: none }` to hax-body's skin made it land on the control. This affects editing today, not only the new model.

## Selection in Chrome

With the caret 2 characters before the end of an item title:
- `hax-body.getRootNode().getSelection()` (h-a-x's shadow root) gives the text node in the `h3`, offset 17.
- `document.getSelection().getComposedRanges({shadowRoots: [h-a-x's, the theme's]})` gives the same.
- `document.getSelection()` and `getComposedRanges()` without roots give `haxcms-site-builder`, offset 0.

`getEditRange()` can use either of the first two in Chrome. WebKit's `getComposedRanges` and Firefox's document selection weren't measured.

## Changes to the spec

1. **§5.3 keys:** `cs-keys.js` can't listen on section and item hosts. Instead, the editor installs one `keydown` and `keyup` listener on hax-body, in the capture phase, on each edit entry. It finds the field from the selection and calls the unit's key handler (blocks still don't import HAX). In headings, titles, tools and outcome sentences, it stops every typed key and Enter, not only those that finish a shortcut. In answers it lets HAX's shortcuts through. It stops keyup ↑↓ everywhere in units. HAX then doesn't see printable keys in those fields (its `_useristyping` and `data-hax-empty` bookkeeping), which the design doesn't use. A pinned guard on `keyboardShortCutProcess` in `hax-fixes.js` is a possible backstop; it wasn't measured.
2. **§6.2 #5 `editorControl()`:** stop `pointerdown`, `mousedown`, `click`, `dblclick`, `focus`, `focusin`, `keydown`, `keyup` and `paste`. The reason is the HAX causes in S7, not the `contentEditable` flag. The `beforeinput` guard (§6.2 #2) should ignore events whose `composedPath()[0]` is a shadow control, since their input events are composed.
3. **§5.2 and §5.5 shadow chrome:** while editing, everything a section or item draws in shadow DOM (placeholders, tiles, buttons, the stray box's message, controls) is `user-select: none`. In the spike, a class on the top wrapper sets it on `.editing, .editing *`. The light-DOM fields stay selectable as editable content.
4. **§5.6 `ops.js`:** set `body.__addAbove = false` (or `true` for "Add above") before every `haxInsert`, as `slots.js` and `layouts.js` already do. Always pass the item. The explicit `__rehydrateLayoutDescendants` can go; it's harmless if kept.
5. **§5.2 items:** keep the `ElementInternals` in a field named `_internals`, so axe-core sees `role="listitem"`.
6. **Skin and `hax-fixes.js` (WP-03 or WP-04):** `#topcontextmenu { pointer-events: none }` in hax-body's shadow styles.

Also for WP-05: an Edit HTML round trip adds whitespace between nested blocks. The dirty-state baseline (§3.3) should collapse whitespace between tags, or Edit HTML with no change would read "Unsaved changes".

## Not covered

- Firefox and WebKit (owner decision). The spec's three-engine fallback rules don't apply.
- IME composition, drag and drop, and touch.
- How many undo steps an edit makes. Typing plus one insert made 3 steps (S4, in WP-02).
- Styling: field styles from the page win over `::slotted()`, so a slotted `h3` took the page's large heading size. The shared sheet (WP-06) has to style fields.

## Evidence

In `docs/editor-spikes/structure/`, copied from the run's report folder (`--evidence`):

| File | What it shows |
|---|---|
| `results.json` | Every row of the last run, with the full measurement text |
| `s1-insert-manual.json`, `s1-insert-manual-rehydrate.json`, `s1-insert-fallback.json`, `s1-insert-fallback-rehydrate.json` | The insert timelines: `activeNode`, HAX's inserting flag, and when each field got `data-hax-ray` and `contenteditable` |
| `s1-insert-first-pass.json` | An insert with `__addAbove` left as HAX set it: the new item went before the one passed |
| `s1-keys.json` | Each listening mode's results and listener order |
| `arrow-keys-first-pass.json` | The first pass's arrow-key failure, before the `user-select` rule |
| `s2-saved.html` | The page as HAX saves it (`haxToContent`) |
| `s2-manual-reading.png`, `s2-manual-editing.png`, `s2-fallback-reading.png`, `s2-fallback-editing.png` | The reader layout in both modes |
| `s2-typed-empty-fields.png` | Empty title, sentence and heading after clicking and typing |
| `s2-stray-manual-editing.png`, `s2-stray-fallback-editing.png` | A loose paragraph: in the stray box (manual), inside the list (fallback) |
| `s7-controls.png` | The control pairs while editing |

The code: `scripts/editor-check/spikes/structure/spike-blocks.js` (the throwaway blocks), `page.html` (the spike page) and `run.mjs` (the runner). The harness's `startScratch` gained a `prepare(siteDir)` option for adding them to the copy only.
