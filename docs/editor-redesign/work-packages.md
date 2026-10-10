# Work packages

The spikes (WP-01, WP-02) amend the spec: read the "Changes to the spec" sections of `docs/editor-spikes/structure.md` and `docs/editor-spikes/lifecycle.md` before building a package; where they disagree with `spec.md`, the spike results win.
Owner decisions (2026-10-09): Chrome only (puppeteer-core + system Chrome, no Playwright); after Save land on the saved page; Sections sheet over the page; hidden sections as a labelled strip; toolbar labels on by default.

## WP-00 Test harness and scratch site

**Goal:** One command builds the theme into a throwaway copy of the site, serves it on :3101, drives it in Chromium, Firefox and WebKit with axe-core, and stops it by port, so every later package has automatic acceptance checks and nothing ever saves to the real site.

**Depends on:** nothing

**Files:** `package.json`, `scripts/editor-check/run.mjs`, `scripts/editor-check/lib/scratch.mjs`, `scripts/editor-check/lib/editor.mjs`, `scripts/editor-check/lib/axe.mjs`, `scripts/editor-check/checks/smoke.mjs`

**Steps:**
- Add devDependencies playwright (pinned to the build matching the browsers already in ~/Library/Caches/ms-playwright: chromium-1223, firefox-1482, webkit-2158) and axe-core.
- lib/scratch.mjs: copy learning-materials (without .git, symlinking node_modules) into a temp folder, run `npx rollup -c` inside the copy's custom/ so the real build output is untouched, start the same haxcms-nodejs dist/app.js that `hax serve` uses with PORT=3101 and HAXCMS_DISABLE_JWT_CHECKS=1 from the copy, wait for HTTP 200, and stop it with `lsof -ti:3101 | xargs kill` (never pkill). Refuse to run on port 3000.
- lib/editor.mjs helpers: open(path), enterEdit() through the site bar's Edit content, exitEdit(), save(), deepActiveElement(), selectionText(), haxBodyHtml(), normalizedHtml(), savedHtml(pageId) read from the copy's pages/<id>/index.html, liveRegionText(), setViewport(1440|390|320), chord(name) per engine.
- lib/axe.mjs: run axe-core across the document and open shadow roots, return violations by impact, support forced-colors emulation.
- run.mjs: `node scripts/editor-check/run.mjs [--engines chromium,firefox,webkit] [--only name] [--keep]` runs checks/*.mjs, writes a JSON report to a temp folder and prints a pass/fail table per engine.
- checks/smoke.mjs: open /up/dart-413 and /oer-courses, read and edit, in all three engines; record the axe baseline.

**Acceptance:**
- `node scripts/editor-check/run.mjs --only smoke` exits 0 after opening /up/dart-413 and /oer-courses on :3101 in Chromium, Firefox and WebKit and entering and leaving edit mode in each.
- After the run `lsof -ti:3101` prints nothing, and if a dev server is running on :3000 it still answers HTTP 200.
- The JSON report lists results per engine and an axe violation count for the reading and editing views of both pages.
- Every file under learning-materials/pages and learning-materials/custom/build is byte-identical before and after the run.

**Risk:** WebKit or Firefox may not run HAXcms's editor exactly as Chromium does; if an engine can't enter edit mode, record it and continue in the others instead of blocking. Building must never write to the real custom/build, which the dev server serves.

## WP-01 Spike A: nested items, manual slots, shadow controls

**Goal:** Prove or reject, in three engines, the structural primitives the design rests on (S1 items as nested HAX grids, S2 manual slot assignment with HAX, S7 shadow controls inside contentEditable hosts), and measure the fallback wherever a primitive fails.

**Depends on:** WP-00

**Files:** `scripts/editor-check/spikes/structure/spike-blocks.js`, `scripts/editor-check/spikes/structure/run.mjs`, `docs/editor-spikes/structure.md`

**Steps:**
- Write throwaway blocks oer-spike-learn (type grid, contentEditable true, slotAssignment manual with heading, items inside div role=list, text and stray slots) and oer-spike-outcome (type grid, ElementInternals role listitem, title and text slots, aria-hidden shadow placeholder, min-block-size 1lh), injected into the scratch copy by the runner and registered with registerBlocks; nothing is committed to the site.
- S1: on a scratch page holding a spike section, call haxInsert(tag, '<h3></h3><p></p>', {}, item) passing the item; record when the new fields get data-hax-ray and contenteditable with and without an explicit __rehydrateLayoutDescendants, where activeNode lands after HAX's MutationObserver and finalizeInsert, and whether a caret placed after settled() survives. Repeat for haxDuplicateNode and haxDeleteNode.
- S1 keys: confirm a keydown listener on the section host runs before hax-body's window _onKeyDown, and that stopping propagation there suppresses Enter splitting, '/' (command palette), Markdown triggers and the double-ArrowUp keyup insert.
- S2: per engine record rendering, arrow-key caret movement across slotted fields, click-to-caret on empty fields, the accessibility tree (heading outside the list, N listitems), re-assignment after body.undo()/redo(), an Edit HTML round trip and importContent, and that an unaccepted paragraph lands in the stray slot. Measure the fallback (slot=heading attribute only) the same way.
- S7: a shadow button and a shadow input inside a contentEditable:true grid host: click, Tab in and type; record whether focus stays, with and without an editorControl-style listener set stopping pointerdown, mousedown, focusin, keydown, keyup and paste.
- Record selection reading in WebKit with getComposedRanges and in Firefox with document.getSelection.
- Write go/no-go per check and engine, the chosen fallback, and the evidence file names in docs/editor-spikes/structure.md.

**Acceptance:**
- The spike runner prints a JSON table with pass/fail per check per engine for S1, S2 and S7 and exits 0.
- For every failing manual-slot check, the slot=heading fallback has a measured result on the same check.
- docs/editor-spikes/structure.md states go or no-go for manual slots, nested grid items and contentEditable hosts per engine.
- No file under learning-materials/ is changed.

**Risk:** Time-box to two days. WebKit's shadow-DOM selection may make caret placement unreliable; if so the design uses the heading-slot fallback everywhere and WP-07 follows it.

## WP-02 Spike B: deletion guard, undo, saving and recovery

**Goal:** Prove the safety and lifecycle mechanisms in three engines before building them: the beforeinput boundary guard (S3), normalized undo and Mac undo (S4), saving without leaving edit mode (S5), and outline saves mid-edit plus recovery (S6).

**Depends on:** WP-00

**Files:** `scripts/editor-check/spikes/lifecycle/prototypes.js`, `scripts/editor-check/spikes/lifecycle/run.mjs`, `docs/editor-spikes/lifecycle.md`

**Steps:**
- Inject prototype patches with page.addInitScript in the scratch copy only.
- S3: with today's markup, try Backspace at the start of a section's first field, Delete at the end of its last, Shift-click across two sections then Delete, typing over a cross-section selection, cut and drag-delete; log each beforeinput inputType and getTargetRanges() per engine, and whether preventDefault leaves the DOM unchanged. List IME composition as a manual check.
- S4: wrap undoManagerStackLogic with the normalized comparison; click five different blocks and count undo steps (expect 0); type and count (expect 1); route Meta+Z / Control+Z and beforeinput historyUndo to body.undo(); measure dirty as normalized innerHTML against a baseline taken after HAX's entry setTimeout(0).
- S5: dispatch haxcms-save-node with store.activeItem without toggling edit mode; confirm the saved file holds the new HTML and the theme's __beforeSave listener ran; then set store.editMode = false and sample the reader DOM every 50 ms for 5 s for stale content. Simulate failure with page.route answering 500, and a 20 s hang. Also measure the keepEditMode variant: undo history, caret, and whether the theme flashes its reader branch.
- S6: while editing, save Style (saveOutline of oerSiteStyle) and a Page details field of the course page; check whether the hax-body content is re-imported (does a typed marker survive?).
- Recovery: call the site editor's _snapshotPendingEditForLogout, reload, confirm sessionStorage haxcms-pending-edit and __pendingRestore, clear __pendingRestore before HAX auto-applies, and import the copy ourselves after the baseline.
- Write go/no-go and the chosen approach per item in docs/editor-spikes/lifecycle.md.

**Acceptance:**
- The runner prints pass/fail per check per engine for S3 to S6 and exits 0.
- S5's chosen flow saves the edited HTML in all three engines, and no 50 ms sample in the 5 s window shows pre-save content.
- docs/editor-spikes/lifecycle.md records whether mid-edit outline saves re-import the body and which fallback WP-11 must use.
- No file under learning-materials/ is changed.

**Risk:** Playwright can't drive IME or native drag-delete identically in every engine; those become manual checks. If S5 fails, WP-11 uses the stock toggle with a held ‘Saving your changes…’ overlay.

## WP-03 Phase 0 stopgaps on the current model

**Goal:** Within days and before any restructuring: typing works in every empty section, undo keeps headings and images, keys in editor chrome don't edit content, sections can't be broken by settings or columns, links don't navigate mid-edit, new blocks start empty, and Discard says what it does.

**Depends on:** WP-00

**Files:** `learning-materials/custom/src/blocks/course-site/cs-shared.js`, `learning-materials/custom/src/blocks/course-site/cs-sections.js`, `learning-materials/custom/src/blocks/course-site/cs-hub.js`, `learning-materials/custom/src/blocks/oer-course-site.js`, `learning-materials/custom/src/editor/oer-block-frame.js`, `learning-materials/custom/src/editor/oer-block-rail.js`, `learning-materials/custom/src/editor/oer-block-inserter.js`, `learning-materials/custom/src/editor/stock.js`, `learning-materials/custom/src/editor/index.js`, `learning-materials/custom/src/editor/hax-fixes.js`, `learning-materials/custom/src/ui/oer-confirm.js`, `learning-materials/theme/theme.css`, `scripts/editor-check/checks/stopgaps.mjs`

**Steps:**
- cs-sections.js and cs-hub.js: declare heading, image and alt with reflect: true; add hideDefaultSettings: true and designSystem: false to all 12 sections, and contentEditable: true to the six written (grid) sections.
- cs-shared.js: give slotted fields in .typing-area min-block-size: 1lh; on pointerdown in the empty part of a .typing-area, put the caret in its first slotted text block (HAXStore.activeHaxBody.__focusLogic(el, false), then a collapsed range on the next task); clear __claim before blur on Enter and Esc; on the section host, prevent Backspace at the start of its first editable child and Delete at the end of its last.
- cs-hub.js: render catalog cards without href while editing.
- theme/theme.css: a light-DOM rule for blocks between course-site sections: width min(48rem, 100% - 3rem), margin-inline auto, text-align start.
- oer-course-site.js: aria-label and title on the author buttons that become icon-only at ≤600px; rename Edit details to Page details.
- oer-block-frame.js: hide the Block settings and Layout buttons when isSection(node).
- oer-block-rail.js: read el.disabled and render aria-disabled with a reason; Enter opens category menus; stop keydown and paste at the rail host; hide Add/Remove column for sections; route Add column to layouts.wrapInColumns with two equal columns and keep the block selected; hide Remove column outside a grid-plate.
- editor/hax-fixes.js (new, installed from index.js): wrap HaxBody.prototype._onKeyDown to return unless e.composedPath() includes the hax-body; set #settingsform.disableAutofocus after hax-store-ready; clear viewsourcetoggle on activeNode change; capture mousedown with detail ≥ 2 inside the active text node and stop propagation; capture click on hax-body and preventDefault for any a[href] in the composed path (Mod+click opens a new tab).
- oer-block-inserter.js: STARTERS overrides so Paragraph inserts an empty p with the caret in it, Columns insert empty paragraphs, and image blocks insert without a demo source.
- ui/oer-confirm.js: a shadcn AlertDialog on dialog.showModal() returning the chosen action; stock.js cancelEdit leaves at once when nothing changed, otherwise asks Keep editing / Discard changes and calls _cancelEditing on discard.
- checks/stopgaps.mjs implementing the acceptance list.

**Acceptance:**
- In Chromium, Firefox and WebKit: clicking the empty hero tagline box puts the selection inside the hero's p, and typing ‘Hello’ makes its text ‘Hello’; the same holds for the people note, the FAQ h3 and the hub intro.
- Typing the tools heading ‘In the shop’, moving tools up, then one Undo restores the order and the heading attribute is still ‘In the shop’.
- Alt+F10 then Enter on the rail opens a menu and leaves the hero's HTML unchanged.
- A selected section's label has no Block settings or Layout button, and its rail menu has no Add or Remove column.
- After Edit HTML on a section and selecting a paragraph, the rail's Duplicate is enabled and duplicates it.
- Inserting a Paragraph adds an empty p holding the caret; inserting an Image adds no thecatapi.com URL anywhere in hax-body.
- Clicking a hub catalog card while editing leaves the URL unchanged and edit mode on.
- For signed-out readers at 1440, a paragraph between sections is centred (left and right margins within 2px) and 48rem wide.
- At 390 reading width every button in the course-site bar has a non-empty accessible name.
- Exit with changes opens a dialog whose buttons read ‘Keep editing’ and ‘Discard changes’.
- In Chromium, double-clicking a word in a paragraph leaves that word as the selection.
- The saved HTML contains no data-hax-, contenteditable or role attributes, and axe reports no new violations against the WP-00 baseline.

**Risk:** These edits touch code WP-07 and WP-09 rewrite, so keep each small and self-contained. The double-click fix and rail key isolation are proven only in Chromium here; WP-04 re-checks them in all three engines.

## WP-04 HAX runtime layer and the policy descriptor

**Goal:** Install every pinned runtime fix the design relies on, behind fingerprint checks, plus the single policy descriptor that every overlay and guard reads.

**Depends on:** WP-02, WP-03

**Files:** `learning-materials/custom/src/editor/hax-fixes.js`, `learning-materials/custom/src/editor/undo.js`, `learning-materials/custom/src/editor/boundary-guard.js`, `learning-materials/custom/src/editor/policy.js`, `learning-materials/custom/src/editor/index.js`, `scripts/editor-check/checks/hax-layer.mjs`

**Steps:**
- policy.js: policyOf(el) merging static oerEditor from our block classes with a table for HAX tags (p, h1–h6, ul, ol, blockquote, grid-plate, media-image, img, figure, page-break) giving kind, limit, pin, pageTypes, accepts, flow, fields, source, fullBleed, columns, textTarget, insertable; helpers unitOf, fieldOf, boundaryOf and isSingleLine. Until WP-07 the sections come from the table.
- hax-fixes.js: a fingerprint helper (method present and its source contains a 26.8.1 marker) that disables a patch with one console warning; move the WP-03 patches behind it; wrap _onKeyUp like _onKeyDown; re-bind HAXStore's own paste listener (remove the bound window listener, wrap it to ignore pastes outside hax-body, add it back, once); wrap the text toolbar's setTarget to disableEditing the old target and skip role=textbox and enableEditing when policy says textTarget false; wrap dropEvent to refuse drops into units whose policy accepts no blocks.
- undo.js: wrap HaxBody.prototype.undoManagerStackLogic with the normalized comparison (strip data-hax-*, contenteditable, draggable, role=textbox and hax-* classes) while keeping raw snapshots; export checkpoint(body, label) and a step-label map; capture Mod+Z, Mod+Shift+Z and Ctrl+Y when focus is in hax-body or editor chrome but not in a form field, and beforeinput historyUndo/historyRedo, routing them to body.undo()/redo().
- boundary-guard.js: a capture beforeinput listener on hax-body, attached on each edit entry, cancelling delete*, insertParagraph, insertFromPaste, insertFromDrop and insertReplacementText whose getTargetRanges() cross boundaryOf or go into or out of a single-line field, and insertText aimed at a unit host outside any field; keydown backups for Backspace and Delete beside a unit, per the WP-02 results.
- checks/hax-layer.mjs.

**Acceptance:**
- In all three engines, Backspace at the start of the first field of every written section leaves the number of hax-body children unchanged.
- A Shift-click selection across two sections followed by Delete, and separately by typing a letter, leaves both sections' normalized HTML unchanged.
- Clicking five different blocks and then Undo changes nothing (normalized HTML identical, canUndo false).
- Typing ‘abc’ then Meta+Z removes ‘abc’ through HAX's undo stack (undoStackPosition decreases) in all three engines.
- Enter pressed with focus on a rail button leaves hax-body's innerHTML unchanged; a paste into a Page details input while a section is active adds no element to hax-body.
- An active section host has no role attribute; an active paragraph has role=textbox.
- Dropping a file onto oer-cs-semester adds no child to it.
- Forcing one fingerprint mismatch disables exactly that patch with exactly one console warning.

**Risk:** Private methods and per-instance bindings: HAXStore binds its paste listener when it connects, so the re-bind must run after that and only once. getTargetRanges coverage differs by engine (see WP-02), so keep the keydown backups.

## WP-05 Editor core: state, operations and announcements

**Goal:** Build the shared core: one editor-state store (selection, level, mode, geometry, dirty, saving, preview), ops.js as the only module that changes structure with each change one undo step, one announcer, and the editorControl directive blocks use for shadow controls.

**Depends on:** WP-04

**Files:** `learning-materials/custom/src/editor/editor-state.js`, `learning-materials/custom/src/editor/ops.js`, `learning-materials/custom/src/editor/announce.js`, `learning-materials/custom/src/editor/oer-toast.js`, `learning-materials/custom/src/ui/editor-control.js`, `learning-materials/custom/src/editor/index.js`, `scripts/editor-check/checks/core.mjs`

**Steps:**
- editor-state.js: an EventTarget store holding activeNode, unit, level (section, item, block, field), mode (typing or selected), rects clipped to the content viewport for both scrollers (main on desktop, window on phones), gutter or dock, dirty, saving and preview; one requestAnimationFrame loop, paused when not editing; a selectionchange sync that calls __focusLogic(field, false) when the caret enters another field (skipped while the mouse is down); a dirty baseline taken after HAX's entry setTimeout(0) and the stock 100 ms snapshot, compared by a debounced MutationObserver on hax-body.
- ops.js: listen for oer-edit-request; settled(body); select(unit, {focus}); move(unit, dir) as a bounded swap using ___moveLock; addItem(after, {focus}) via haxInsert passing the item; duplicate; remove (immediate with an Undo toast for empty or generated sections, a confirm with counts offering Hide it instead for written sections with content); hide and show; setAttr; moveToColumn; insertBlock(slot, tag, starter). Every operation is wrapped in checkpoint(label) and announced.
- announce.js: one polite and one assertive live region; oer-toast uses it and gains an Undo action.
- ui/editor-control.js: a Lit directive that stops pointerdown, mousedown, focusin, keydown, keyup and paste propagation at a shadow control.
- checks/core.mjs.

**Acceptance:**
- editorState.dirty is false right after entering edit mode, true after typing one character, and false again after undoing it, in all three engines.
- ops.move on the Tools section moves it one place; one Undo restores the order; the polite region reads ‘Tools moved to N of M’ with the right numbers.
- ops.remove on an empty generated section shows a toast whose Undo restores identical normalized HTML; ops.remove on a written section with typed content opens a dialog offering ‘Hide it instead’.
- ops.addItem leaves the selection anchor inside the new item's h3 in all three engines.
- A shadow button wrapped in editorControl still holds deep focus 500 ms after Tab-in and after a click, in all three engines.

**Risk:** The frame, rail and inserter keep their own loops until WP-09 and WP-10 move them onto editor-state; keep the store's API small so those moves are mechanical.

## WP-06 Shared content sheet and reading/editing geometry

**Goal:** Editing matches reading: one .hax stylesheet for typography and widths in both modes, full-width microsites with no gutter while editing, sections at 100% instead of 100cqw, no justified text or 16→20px reflow on any page, and a single selection ring.

**Depends on:** WP-03

**Files:** `learning-materials/custom/src/blocks/course-site/cs-content.js`, `learning-materials/custom/src/blocks/course-site/cs-shared.js`, `learning-materials/custom/src/custom-oer-docs-theme.js`, `learning-materials/custom/src/editor/editor-skin.js`, `learning-materials/theme/theme.css`, `scripts/editor-check/checks/geometry.mjs`

**Steps:**
- cs-content.js: a constructable CSSStyleSheet with sheet.hax = true, adopted on document when the theme module loads, holding rules for blocks between sections in reading (custom-oer-docs-theme[course-site] > non-section children) and editing (hax-body[data-oer-microsite] > non-section children), grid-plate[width=wide] at 72rem, hax-body text-align start and the theme's body font size, and link colour inside oer-cs-* items; if h-a-x already exists, call its __applyHAXAdoptedStylesToShadowRoot().
- Theme: on microsites keep the article full width and main padding 0 in edit mode too, with no 5.5rem gutter; set data-oer-microsite on hax-body while editing a microsite (a host attribute, never saved); give the reader copy a signal to idle while editing.
- cs-shared.js: :host width 100%; remove 100cqw and calc(50% - 50cqw).
- editor-skin.js: --hax-body-active-outline none; remove the nested dashed hover outlines that stack with the frame.
- theme.css: keep the WP-03 rule only as the pre-upgrade fallback if the sheet covers reading.
- checks/geometry.mjs.

**Acceptance:**
- At 1440 and 390 in reading mode, main.scrollWidth equals main.clientWidth and each section's width equals main's client width.
- On /up/dart-413 every section's left edge and width match between reading and editing within 2px.
- A paragraph between sections has the same x and width in both modes within 2px, and is 48rem wide at 1440.
- On a lesson page a paragraph's computed font-size is equal in both modes, and a paragraph inside a grid-plate has text-align start while editing.
- h-a-x's shadowRoot.adoptedStyleSheets contains a sheet with hax === true.
- The smoke check's axe violation count on ordinary pages doesn't rise.

**Risk:** DDD's hax-body rules may outrank the sheet; raise specificity before reaching for !important. The theme's edit-mode CSS affects every page, so the check covers a lesson page too.

## WP-07 Section and item model, proven on What you'll learn

**Goal:** Replace the dashed typing boxes with the reader layout in both modes: light-DOM headings, item elements with typed fields, manual slots (or the WP-01 fallback), aria-hidden placeholders, the key controller, hidden-from-readers and HAX hooks, proven end to end on What you'll learn.

**Depends on:** WP-01, WP-05, WP-06

**Files:** `learning-materials/custom/src/blocks/course-site/cs-shared.js`, `learning-materials/custom/src/blocks/course-site/cs-items.js`, `learning-materials/custom/src/blocks/course-site/cs-keys.js`, `learning-materials/custom/src/blocks/course-site/cs-normalize.js`, `learning-materials/custom/src/blocks/course-site/cs-sections.js`, `learning-materials/theme/theme.css`, `scripts/editor-check/checks/model.mjs`

**Steps:**
- SiteSection: slotAssignment manual (or slot=heading per WP-01); assignSlots() for heading, items, text and stray; the default heading drawn in shadow DOM when no light h2 exists; aria-hidden placeholders driven by shadow state; min-block-size 1lh; hiddenFromReaders declared {type: Boolean, reflect: true, attribute: 'hidden-from-readers'} with the editing strip that opens while selected; editorControl on every shadow control; the oer-preview listener; the reader copy idles outside hax-body while editing; a getEditRange helper; a static oerEditor base; haxHooks editModeChanged (synchronous normalize via cs-normalize, ensure an empty h2), activeElementChanged (open the strip), inlineContextMenu (Hide/Show) and preProcessNodeToContent (a clone without an empty heading); delete claim, keep, __refocus, typing() and the dashed styles; emit cs-items-change.
- cs-items.js: SiteItem (type grid, contentEditable true, hideDefaultSettings, designSystem false, canScale false, empty settings, gizmo requiresParent and meta.hidden, ElementInternals role listitem, title, text and answer slots, preProcessNodeToContent returning '' when every field is empty) with oer-cs-outcome (reflected icon and tile button), oer-cs-tool and oer-cs-question (details for readers, open while editing).
- cs-keys.js: the key table of spec §5.3 and the paste rules of §5.4, sending oer-edit-request for structural changes.
- cs-normalize.js: pure conversions from legacy markup (heading attribute, ul/li rows with a bold lead or a colon, FAQ heading and answer runs).
- Convert oer-cs-learn to the new model as the reference section, keeping listItems() as the reader fallback.
- theme.css: [hidden-from-readers] { display: none } for the light-DOM copy.
- checks/model.mjs.

**Acceptance:**
- Reading a fixture with three outcomes shows three cards whose h3 text matches; the accessibility snapshot shows the level-2 heading outside a list of three listitems.
- In all three engines, clicking an empty outcome title puts the caret in its h3; typing fills it; Enter moves the caret to its p; Enter at the end of the p creates a new oer-cs-outcome after it with the caret in its h3.
- Backspace in the empty title of outcome 2 removes it and puts the caret at the end of outcome 1's p; one Undo brings it back, and the rendered card count equals the DOM item count.
- Typing ‘/’ in a title inserts the character and opens no command palette; typing ‘- ’ at the start of an outcome sentence doesn't make a list.
- Pasting three lines of plain text into an empty title makes three outcomes.
- The saved HTML has no slot, data-hax- or contenteditable attributes, no empty outcome and no empty h2.
- A legacy page (heading attribute, ul/li) is upgraded on entering edit mode while editorState.dirty stays false and canUndo stays false.
- A section with hidden-from-readers has zero height for signed-out readers and shows the strip with ‘Show to readers’ while editing; placeholder text is absent from the accessibility tree.

**Risk:** The largest change. If WP-01 rejected manual slots in any engine, use the heading-slot fallback everywhere rather than per engine. Keep the legacy parsers until the migration has run on both live pages.

## WP-08 All sections, the hub, starters and migration

**Goal:** Move every course-site and hub section onto the new model, give generated sections their source and empty-state callouts, update the starters and mirror scripts, and convert the two live pages.

**Depends on:** WP-07

**Files:** `learning-materials/custom/src/blocks/course-site/cs-sections.js`, `learning-materials/custom/src/blocks/course-site/cs-hub.js`, `learning-materials/custom/src/types/course-site.js`, `learning-materials/custom/src/custom-oer-docs-theme.js`, `scripts/course-site-structure.mjs`, `scripts/course-site-sections.mjs`, `scripts/course-hub.mjs`, `scripts/editor-check/checks/sections.mjs`

**Steps:**
- Written sections: hero (text slot for the tagline, a Change image button dispatching oer-edit-request {action: 'image'}, image, alt and decorative reflected, text column aligned to the start), people (heading, note text slot, generated instructors), tools (oer-cs-tool chips), faq (oer-cs-question items), intro (h1 heading and text).
- Generated sections (semester, make, books, closing): type grid holding only an h2, contentEditable true, canEditSource false, static oerEditor.source, and an information callout (primary-tinted, info icon, one button dispatching cs-edit-source {kind, field}); facts and catalog stay type element; the semester's default heading becomes ‘The semester, week by week’.
- Policy for every section: limit 1, pin first (hero, intro) or last (closing, catalog), pageTypes, and accepts per slot.
- types/course-site.js: new COURSE_SITE_STARTER and HUB_STARTER (no headings; one empty outcome, tool and question; hero and people with an empty p) and matching demoSchema.
- scripts/course-site-structure.mjs: a dry-run diff by default and --apply to save through the HAX API at HAX_BASE; idempotent; update the mirror scripts course-site-sections.mjs and course-hub.mjs.
- Theme: listen for cs-edit-source and open pageDetails().show(id, {section, field}), or the plan in a new tab.
- checks/sections.mjs.

**Acceptance:**
- Signed out on the scratch copy, every section's reader text matches the expected fixture text and no author callout is present.
- In edit mode, clicking a fact makes the facts section the active node; the semester's empty callout button fires cs-edit-source with kind ‘plan’, and the theme opens Page details at that field.
- The hero's Change image button fires oer-edit-request with action ‘image’; after a save, /oer-courses still shows /up/dart-413's hero image and tagline.
- Catalog cards have no a[href] while editing and do for readers.
- On the scratch copy `node scripts/course-site-structure.mjs` prints a diff for both live pages; --apply converts them; a second --apply changes nothing.
- A new course site made with setCourseSite on the scratch copy has the new starter markup.

**Risk:** The hub catalog reads each course site's saved hero, so keep image, alt and the tagline text where it parses them. Run the migration on the real site only after the owner has approved the scratch result.

## WP-09 Selection chrome: frame, rail and dock

**Goal:** One ring, one identity label and one toolbar for whatever is selected, at a fixed place, with levels, state chips, the Selected-state keys, each unit's ceButtons, reasons for disabled items, and a bottom dock on narrow screens.

**Depends on:** WP-05, WP-07

**Files:** `learning-materials/custom/src/editor/oer-block-frame.js`, `learning-materials/custom/src/editor/oer-block-rail.js`, `scripts/editor-check/checks/chrome.mjs`

**Steps:**
- Frame on editor-state (remove its rAF loop and __oerDragging): a two-tone unit ring, inset for fullBleed units, clipped to the content viewport and painted under menus; a compact [↑ ⠿ ↓] handle following the visible middle; a label toolbar with the name tag, breadcrumbs that select their level, state chips, and Block settings only when curated fields exist; the Selected-state keys (Enter, Esc, arrows, Home, End, Alt+Shift arrows, Mod+Shift+D, Delete, Shift+F10); drag limited to valid slots.
- Rail on editor-state: a fixed x at the content edge plus 8px; categories by level per spec §4.3; ceButtons gathered with HAXStore.runHook(unit, 'inlineContextMenu', [proxy]) for the unit and its ancestors, matched by event-name and value; disabled reasons; no Text menu on headings and titles; a Show labels preference (localStorage inside try/catch, default on); dock mode with visualViewport when the margin is too narrow.
- Region cycling on Ctrl+` and Ctrl+Shift+` (and F6 where the browser delivers it); Alt+F10 to the rail; Esc back to where you were.
- checks/chrome.mjs.

**Acceptance:**
- Esc from a field puts deep focus on the frame's name tag, and for the second outcome the label reads ‘What you'll learn › Outcome 2 of 3’.
- In the Selected state, ArrowDown selects the next section, Alt+Shift+ArrowUp moves it, and Delete on an empty section removes it with an Undo toast, in all three engines.
- At 1440 the rail's left edge is the same within 1px whether a section, an outcome or a paragraph between sections is selected.
- At 390 the dock sits at the bottom, no rail occupies a left gutter, and the page has no horizontal scroll.
- With the selected section's top scrolled under the editing bar, the label's top is at or below the bar's bottom, and the inserter flyout paints above the frame.
- The rail's Section menu lists ‘Hide from readers’ (from ceButtons), and Move up on the hero is disabled with the reason ‘The hero stays at the top’.
- axe reports no serious or critical violations in the frame and rail.

**Risk:** Two scrollers (main on desktop, the window on phones) and shadow-DOM geometry; test both widths. Chord availability differs by engine; the harness records which can be prevented.

## WP-10 Inserting: seams, the inserter, slots and columns

**Goal:** Adding anything is predictable: full-width seams, a curated page-aware flyout with sections first, blocks that start empty, refusals wherever readers would lose content, and Columns with one name, a keyboard menu, Width: Section and moves between columns.

**Depends on:** WP-08, WP-09

**Files:** `learning-materials/custom/src/editor/oer-block-inserter.js`, `learning-materials/custom/src/editor/slots.js`, `learning-materials/custom/src/editor/layouts.js`, `scripts/editor-check/checks/insert.mjs`

**Steps:**
- Inserter on editor-state (remove its loop): full-width seams with a 28px pill shown within ±12px or on focus, always above and below the selected section, never before a pin-first or after a pin-last unit.
- Flyout groups: Not on this page (Add back to the standard position), On this page (disabled, Go to it), Blocks (curated, deduplicated by tag, Heading 2/3/4 named), All blocks… (searchable); filters by pageTypes and the container's accepts; final STARTERS (paragraph with caret, empty columns, image requesting the image popover); the new block scrolled to the centre.
- slots.js: section-aware containers from policy, with item containers by flow; refusals in insertInSlot and placeInSlot.
- layouts.js: refuse wrapInColumns for sections and inside sections and items; ratio labels and correct plurals; a roving-tabindex menu (focus moves in, arrows, Enter, Esc returns focus); Width: Reading / Section setting width='wide'; moveToColumn for Move down at the end of a column.
- checks/insert.mjs.

**Acceptance:**
- Hovering 10px above a section boundary shows a seam whose width equals main's client width; no seam appears above the hero or below Ready to start.
- On a course site without What you'll make, the flyout's Not on this page lists it and Add back inserts it right after The semester.
- On a lesson page the flyout lists no course-site or hub sections; the Blocks group has at most 16 entries and no duplicate tags.
- wrapInColumns called on a section leaves the DOM unchanged.
- In the Columns menu, arrow keys move between presets, Enter applies one, and Esc returns focus to the opener.
- Width: Section sets width=wide on the grid-plate, and readers see it 72rem wide.
- Move down on the last block of column 1 gives it slot col-2 and keeps it selected.

**Risk:** The stock gizmo list depends on HAX's app store; curate by a tag allow-list and keep All blocks… as the way to everything else, so nothing becomes unreachable.

## WP-11 Editing bar, saving, exit, recovery and Preview

**Goal:** The page level: the site bar becomes the editing bar at the same height; saving never shows stale content and never loses edits; Exit and leaving ask first; unsaved edits come back after a reload; Preview shows the reader page; Style and Page details work while editing.

**Depends on:** WP-02, WP-06, WP-08, WP-09

**Files:** `learning-materials/custom/src/editor/oer-edit-bar.js`, `learning-materials/custom/src/custom-oer-docs-theme.js`, `learning-materials/custom/src/blocks/oer-course-site.js`, `learning-materials/custom/src/editor/stock.js`, `learning-materials/custom/src/editor/recovery.js`, `learning-materials/custom/src/editor/leave-guard.js`, `learning-materials/custom/src/editor/presave-check.js`, `learning-materials/custom/src/editor/quiet-mode.js`, `learning-materials/custom/src/editor/index.js`, `learning-materials/custom/src/ui/oer-site-style.js`, `learning-materials/custom/src/types/oer-page-details.js`, `scripts/editor-check/checks/lifecycle.mjs`

**Steps:**
- oer-edit-bar.js for every page, with a microsite variant (Sections, Style, Page details, Preview, ⋯ More with Edit HTML, Keyboard shortcuts and Command search, status, Exit, Save); width-driven collapse into ⋯ that never includes Save; a Skip to selected section link; a roving toolbar.
- Theme: render the bar in place of renderEditorHeader; remove the .cs-editing note; keep the footer after the article in edit mode; on entry, record the top visible section and its offset and restore both once HAX settles, selecting that section.
- oer-course-site.js: the seven-item page menu in the reading bar on microsites, a lock-aware Edit content, bar links labelled from section headings, and the recovered-edits chip.
- stock.js savePage per S5 (or its fallback) with the 20 s timeout and Try again; Exit with the confirm; leave-guard.js for in-app links and beforeunload while dirty; recovery.js per S6 (snapshot debounce, one restore path, the prompt); quiet-mode filters HAX's recovery toast; presave-check.js for the To check chip.
- Preview: inert and data-oer-preview on hax-body, an oer-preview window event, overlays hidden, Esc returns with the same selection.
- oer-site-style.js: preview event {siteId, style}, arrow-key radio swatches, focus return, mid-edit save per S6; oer-page-details.js: show(id, {section, field}) focuses the field.
- checks/lifecycle.mjs.

**Acceptance:**
- Entering edit mode on /up/dart-413 scrolled so Tools is at the top selects Tools with its top within 8px of its reading position; at scroll 0 the hero's top is within 2px; the live region contains ‘Editing DART 413’.
- At 390 the Save button lies fully inside the viewport and the page has no horizontal scroll.
- After typing a new tagline and pressing Save, no 50 ms sample shows the old tagline before the reading view appears; the saved file contains the new tagline; deep focus is on Edit content.
- With the save request answering 500, edit mode stays on, the status contains ‘Couldn't save’, and the typed text is still present.
- Exit with changes opens a dialog with Keep editing, Discard changes and Save and exit; Discard shows the old content in the reading view.
- Clicking the bar's brand link with unsaved changes opens the leave dialog, and Keep editing stays in the editor.
- Type, reload, press Edit content: the restore prompt appears; Restore brings the text back and the status reads ‘Unsaved changes’.
- In Preview hax-body is inert, FAQ details are closed and the frame and rail are hidden; Esc returns with the same unit selected.
- A Style preview on one course site leaves another site's main style unchanged, and the hub's reading bar has a page menu containing Publish.

**Risk:** Depends on S5 and S6; follow their recorded fallbacks. The theme's render branches are shared by every page, so the check includes a lesson page.

## WP-12 Sections sheet

**Goal:** A Sections sheet, opened from the bar, that shows every section and item with its state, moves and removes them by keyboard and adds missing sections, without narrowing the page.

**Depends on:** WP-10, WP-11

**Files:** `learning-materials/custom/src/editor/oer-site-outline.js`, `learning-materials/custom/src/editor/oer-edit-bar.js`, `scripts/editor-check/checks/outline.mjs`

**Steps:**
- oer-site-outline.js: a non-modal sheet over the left side (modal on phones) holding an APG tree of sections and items, with state in each row's name, roving tabindex, arrows, Home, End, type-ahead, Enter and Space behaviour, and Alt+Shift arrows, Delete and Shift+F10 acting through ops.js.
- A Not on this page group with Add back, and Add section… opening the inserter's section list.
- Sync on cs-items-change and editor-state; remember the open state per viewer.
- Wire the bar's Sections button; Esc closes the sheet and returns focus to it.
- checks/outline.mjs.

**Acceptance:**
- The sheet has role tree with one level-1 treeitem per section, and a hidden section's row name includes ‘hidden from readers’.
- ArrowDown then Enter selects that section on the page and puts deep focus on its name tag.
- Alt+Shift+ArrowDown on a row moves the section in the DOM and focus stays on that row.
- Opening the sheet leaves main's width unchanged.
- axe reports no serious or critical violations in the sheet.

**Risk:** Two views of one structure; drive every change through ops.js so the sheet and the page can't diverge.

## WP-13 Settings curation and the settings dialog

**Goal:** Short block settings in plain words on every page, curated at the moment the form is built, in a dialog that traps and returns focus and previews blocks at their real width.

**Depends on:** WP-04, WP-06

**Files:** `learning-materials/custom/src/editor/block-settings.js`, `learning-materials/custom/src/editor/hax-fixes.js`, `learning-materials/custom/src/editor/oer-settings-dialog.js`, `learning-materials/custom/src/editor/ux-tweaks.js`, `learning-materials/custom/src/editor/editor-skin.js`, `scripts/editor-check/checks/settings.mjs`

**Steps:**
- block-settings.js: per-tag allow-lists and plain labels (media-image keeps description, caption, size and float; grid-plate's ‘Disable responsive’ becomes ‘Keep columns side by side on phones’; paragraph keeps nothing), defaulting to the block's own configure fields minus the DDD groups, Developer, Schema and Lock.
- hax-fixes.js: wrap HAXStore.testHook and runHook so setupActiveElementForm also applies block-settings to every tag, after the element's own hook, assigning new arrays instead of editing the shared ones.
- oer-settings-dialog.js: make the page behind the dialog and tray inert, return focus to the opener, let Esc close an open command palette first, give the preview stage container-type inline-size and the site's style variables, and never open for units whose curated settings are empty.
- ux-tweaks.js and editor-skin.js: adjust the tray enhancer and styles for the shorter form.
- checks/settings.mjs.

**Acceptance:**
- A paragraph shows no Block settings button; an image's form shows exactly description, caption, size and float, with no Developer, Schema or Style Guide group.
- A grid-plate's form shows the label ‘Keep columns side by side on phones’.
- Tab never leaves the dialog and its tray; Esc returns focus to the opener; with the command palette open, Esc closes only the palette.
- The preview of a two-column grid-plate shows two columns side by side at 1440.
- HAXStore.elementList is deep-equal before and after opening ten different blocks' forms.

**Risk:** DDD can re-register properties after the design system changes; form-time curation is immune to that, but re-run the check after toggling dark mode and reloading.

## WP-14 Popovers: link, image and icon

**Goal:** Links, images and outcome icons are chosen in small shadcn popovers right where the author is working, each change one undo step.

**Depends on:** WP-08, WP-10, WP-13

**Files:** `learning-materials/custom/src/editor/oer-link-popover.js`, `learning-materials/custom/src/editor/oer-image-popover.js`, `learning-materials/custom/src/ui/oer-image-field.js`, `learning-materials/custom/src/ui/oer-icon-picker.js`, `learning-materials/custom/src/editor/oer-block-rail.js`, `learning-materials/custom/src/editor/oer-block-frame.js`, `learning-materials/custom/src/editor/hax-fixes.js`, `learning-materials/custom/src/editor/ops.js`, `scripts/editor-check/checks/popovers.mjs`

**Steps:**
- oer-link-popover.js: an address or Link to a page (searching the manifest), plain link text, Open in a new tab (off by default), Add link and Remove link; Enter submits; spaces around the link are kept and no empty b is left; it replaces createLink for Format → Link and Mod+K, and the content link guard's popover offers Open in new tab, Edit link and Remove link.
- oer-image-popover.js wrapping oer-image-field (Upload, Choose from site, Use an address, description, It's decoration): handles oer-edit-request {action: 'image'} from the hero and the frame's Change image… for img, media-image and figure (mapping each tag's source and alt attributes), applying through ops.setAttr; asks for a description when an image is inserted.
- oer-image-field.js: focus and scroll the opened panel into view; Esc closes the chooser.
- oer-icon-picker.js: accept a choices list; ops handles {action: 'icon'} with 12 curated Lucide icons plus Automatic.
- checks/popovers.mjs.

**Acceptance:**
- Linking the selected word ‘Double’ in ‘Double diamond’ produces an a element containing exactly ‘Double’ followed by a space, with no empty b element and no target attribute.
- Typing ‘semester’ under Link to a page lists the course site's pages, and Enter inserts a site-relative href.
- On an image block, Change image → Use an address → Done sets media-image's source and alt; one Undo restores the previous source.
- The hero's Change image popover closes on Esc and focus returns to the button.
- Change icon on an outcome offers 13 choices; choosing one sets the icon attribute, and one Undo removes it.

**Risk:** Rich-text selection differs by engine; save the range while the popover is open and restore it before applying the link.

## WP-15 Docs, contrast and full verification

**Goal:** The design system describes the new model, every new colour pair passes AA, and the whole author journey passes automatically in three engines, with screen-reader runs done by hand.

**Depends on:** WP-12, WP-14

**Files:** `docs/design-system.md`, `scripts/contrast-audit.mjs`, `scripts/editor-check/checks/journey.mjs`, `scripts/editor-check/checks/a11y.mjs`

**Steps:**
- design-system.md: replace the dashed-box and claim guidance; document levels and verbs, the editing bar, the Sections sheet, the two empty-state kinds, hidden-from-readers, items, the HAX layer rules (policy, ops, pinned patches) and the keyboard map.
- contrast-audit.mjs: add placeholders on background, card and the primary tint; chips; accent hover with foreground; the selection ring on every section background; light and dark.
- journey.mjs: the spec's §2 journey end to end.
- a11y.mjs: axe at 1440, 390 and 320 and with forced colors, plus a keyboard-only run of the journey.
- A manual script for VoiceOver with Safari and NVDA with Chrome, with results recorded for the owner.

**Acceptance:**
- `node scripts/contrast-audit.mjs` passes with the new pairs.
- journey.mjs passes in Chromium, Firefox and WebKit.
- axe reports zero serious or critical violations in the reading and editing views at 1440, 390 and 320, and with forced-colors emulation.
- In edit mode at 320 the page has no horizontal scroll.
- docs/design-system.md no longer mentions dashed boxes or SiteSection.claim.

**Risk:** Screen-reader behaviour can't be fully automated; the manual runs may surface wording changes to fold back into announce.js.
