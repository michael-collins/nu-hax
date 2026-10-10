# Spike B: deletion guard, undo, saving and recovery

*WP-02 of `docs/editor-redesign/work-packages.md`, measured 2026-10-09 in Chrome 155 (headless, puppeteer-core) against HAX 26.8.1. Chrome only, by the owner's decision: Firefox and WebKit were not run. Paths are under `learning-materials/custom/src` unless they start with `nu-hax/`.*

Run it with `node scripts/editor-check/spikes/lifecycle/run.mjs --port 3105 --source head` (about 7 minutes; `--only s3,s4,s5,s6` for some). It injects `prototypes.js` into every page with `evaluateOnNewDocument` and writes its fixture pages into the copy only. Each PASS/FAIL row is a claim about a prototype; the "Measured" rows record what stock HAX does on the same steps. It exits 1 if a claim fails. The last run: 42 passed, 0 failed, plus 12 stock measurements.

## Verdict

| Item | Chrome | Chosen approach | Fallback for WP-04 / WP-11 |
|---|---|---|---|
| **S3** `beforeinput` boundary guard | **Go** | The capture listener of spec §6.2 #2, plus three rules the spec doesn't have: refuse a deletion whose target range is collapsed, collapse a refused selection on `compositionstart`, and handle paste before HAX does (below). | Keydown backups for Backspace and Delete were never needed: `getTargetRanges()` was never empty. Keep the selection-based check for an empty list anyway (prototype `edgeRefusal`). |
| **S4** Normalized undo | **Go** | Spec §6.2 #3, with `element-visible` added to the normalized attributes. | – |
| **S4** Mac undo (⌘Z, ⌘⇧Z, Edit menu) | **Go** | A window keydown capture for Mod+Z / Mod+⇧Z / Ctrl+Y, and `beforeinput` `historyUndo`/`historyRedo` (cancelable in Chrome), both calling `body.undo()`/`redo()`. | – |
| **S4** Unsaved changes from a baseline | **Go** | Spec §3.3, but the baseline must not wait for `isContentBusy()` (it never clears in 26.8.1). | – |
| **S5** Save without leaving edit mode | **Go**, with a longer hold | Save with edit mode on, then hold the edited page until **HAX's reload after the save has settled**, not just until its answer, and keep HAX from importing into the editor meanwhile. | The spec's fallback (stock toggle plus a held "Saving your changes…" overlay) isn't needed. |
| **S5** HAX's `keepEditMode` | **No-go** | Not used. It shows the old content in the editor, flashes the reading view and empties undo. | – |
| **S5** Errors and timeouts | **Go** | Editing goes on with every edit and the caret. A late answer after the 20 s timeout must be handled (it replaced newer typing). | – |
| **S6** Style or Page details saved mid-edit | Re-imports the body: **yes, every time** | Hold HAX's imports into hax-body while the outline save and its reload run. Then rewrite the page details in the page-break HAX saves with the page. | The spec's fallback (snapshot and re-import) isn't needed, and it would lose undo history and the caret. |
| **S6** Recovery | **Go** | Spec §3.3: our 2 s copy through HAX's `_snapshotPendingEditForLogout()`, HAX's own restore switched off, our restore after the baseline. | – |

**For WP-11 (the answer to "after Save, land on the saved reading page with no stale content flashing"):** `savePage()` in `prototypes.js` is the approach. Save with edit mode on, with `hax-body` inert and `aria-busy`. Wait for HAX's answer, then for its reload to settle, holding HAX's imports into the editor all the while. Then set `store.editMode = false`. Over 5.9 s of samples (every 50 ms and every frame), none showed the old tagline and none showed a blank page. Stock Save showed the old tagline from 0.85 s to 5.8 s after Save, with blank frames between.

## Changes to the spec

For WP-04 and WP-11, in order of consequence:

1. **§3.3 Save, step 3: don't end editing on HAX's answer.** `store.activeItemContent` is not current when the answer arrives. 300 ms later HAX starts its reload: it resets `store.activeId`, which redraws the reading copy from its cached `__pageContent` (the *old* page), then fetches the page and `site.json`, and redraws the reading copy 3 or 4 more times. Each redraw empties the theme's light DOM and refills it 5 ms later. Ending editing on the answer would show exactly what stock Save shows. The prototype waits for `haxcms-trigger-update-node`, then until no `loadPageData`, `loadJOSData` or `_activeItemContentChanged` is running, `haxcms-site-builder.loading` and `__pendingPageLoad` are false, and 300 ms have passed with no redraw (capped at 10 s). That's about 3.2 s after the answer here, so "Saving…" lasts about 5 s in all (headless; the 300 ms timer and the redraws run late on a busy main thread).
2. **While holding, block HAX's imports into hax-body.** HAX imports the reloaded page into the editor too, 4 or 5 times per save: the site editor's edit-mode autorun when `activeItemContent` changes, and its `_bodyChanged` on every `json-outline-schema-active-body-changed`. Each import empties hax-body and refills it in a `setTimeout`, so the editor goes blank for a frame (seen with `keepEditMode`). The prototype wraps `body.importContent` while saving and releases it when editing ends.
3. **A late answer after the timeout.** Keep listening after the 20 s timeout. If the answer comes, the page was saved: the baseline becomes what was sent, the status follows from it, and HAX's reload must not reach the editor. Without the hold, it replaced " and more", typed after the timeout, with the saved copy.
4. **`inert` drops focus to `<body>`.** Keep the caret's range before setting `inert` and put it back when a save fails (the prototype's `keepFocus`).
5. **§3.4 and S6: every outline save re-imports the page while editing.** Each manifest reload redraws the reading copy, and the site editor's `_bodyChanged` imports it into hax-body unconditionally. Typed text is lost and one undo step is added. This is true for Style, for a course page field and for the site's own fields. WP-11 holds imports around `saveOutline` while editing, as in point 2. The spec's snapshot-and-re-import fallback isn't needed.
6. **New: a page save after a mid-edit Page details save undoes it.** The page-break in hax-body still carries the title, description and other details from when editing began, and HAXcms writes them back to `site.json` with the page: the description went back to "Digital Fabrication Studio, 4 credits." The prototype (`freshDetails`) rewrites those attributes at save time from the page-break HAX built from the current manifest. It's registered before the theme's `__beforeSave`, so it runs inside it, and the theme's order fix still holds (stored order 14 → 14). In WP-11 it belongs in `__beforeSave` itself.
7. **§6.2 #2, the guard needs three more rules:**
   - **Refuse a deletion whose target range is collapsed.** Chrome reports a collapsed range at a block's edge. Backspace in the hub's empty intro paragraph emptied hax-body entirely, page-break included (3 → 0 children). In an empty outcome it turned the `ul` into `<p><font face="Roboto…"><br></font></p>`.
   - **Collapse a refused selection on `compositionstart`.** Composition input (`insertCompositionText`) is not cancelable in Chrome, and composing over a selection across sections removed a section (10 → 9 blocks). Collapsing first kept every block. This was emulated with CDP `Input.imeSetComposition`; check a real IME by hand.
   - **Handle paste before HAX.** HAX's window `paste` handler cancels the paste and edits the DOM itself: `range.deleteContents()`, `execCommand("insertParagraph")`, `haxReplaceNode`. So no `beforeinput` follows. A capture `paste` listener on hax-body collapses a refused selection, and in list items and headings inside a section it inserts plain text on one line (`execCommand("insertText")`) and stops HAX. Pasting two HTML paragraphs with the caret in a Tools item **replaced the hero** with two `<li>`s (stock, every time).
8. **Not fixed here, for WP-04 or WP-14:** on any page, HAX's paste of two or more HTML paragraphs in the middle of a paragraph loses the text before the caret and inserts the paragraphs in reverse order. Pasting "First / Second" at offset 3 of "A note from…" gave "Second", "First", "ote from…" (probe, synthetic paste event).
9. **§6.2 #3: normalize `element-visible` too.** page-break (and other IntersectionObserver blocks) toggles it as it scrolls in and out. A click that scrolled the page became an undo step and "Unsaved changes" until it was added.
10. **§3.3, the baseline: don't wait on `isContentBusy()`.** In 26.8.1, hax-body's `updated()` sets `editModeTransitioning`, then `waitForStable()` waits for every flag that's set, itself included, so it never clears. The content state is busy for the whole session. The prototype waits for `importing` and `inserting` instead, then 150 ms and two frames. **Upstream bug candidate:** for the same reason `_connectMutationObserverWhenReady()` never returns, and hax-body's own MutationObserver never connects (`_observer` stayed `null` after two edit entries). Anything the spec takes from hax-body.js 4755–4826 (ids on inserted headings, activating inserted nodes) doesn't run in this build. WP-01's notes credit that observer; worth a second look there.
11. **Leave guard:** HAX sets `globalThis.onbeforeunload` while editing and asks even with no changes. In the source it's skipped when `HAXStore.skipExitTrap` is true, so WP-11 can set that from `dirty` (not tested here).
12. **Shift-click can't select across sections.** HAX's `_mouseDown` makes the clicked block active, and the selection collapses. Shift+arrows can, so the guard is still needed.

## S3: the deletion guard

Fixture: today's markup with text (written sections hold `ul`/`li` and `p`, and a paragraph sits between Tools and the questions), and the starters for the empty cases. Each case ran with the guard off (stock) and on, on the same page. "Blocks" is hax-body's child count, page-break included.

| Case | `beforeinput` and target range | Stock | Guarded |
|---|---|---|---|
| Backspace at the start of the tagline | `deleteContentBackward`, collapsed at `p@0` | unchanged | unchanged (refused) |
| Backspace at the start of a question (`h3`) | `deleteContentBackward`, from the paragraph before into `h3@0` | `h3` text merged into the paragraph before; FAQ lost its question | unchanged |
| Backspace at the start of an answer | from the `h3`'s end into `p@0` | answer merged into the question heading | unchanged |
| Backspace at the start of the paragraph between sections | from the last tool into `p@0` | paragraph merged into the tool, 10 → 9 blocks | unchanged |
| Delete at the end of the last tool | the same range, forward | 10 → 9 blocks | unchanged |
| Shift+↓ from Tools into the next block, Backspace | from a tool into the paragraph | 10 → 9 blocks | unchanged |
| Selection hero → outcome, Delete / typing / Enter / Cut | `deleteContentForward` / `insertText` / `insertParagraph` / `deleteByCut`, across two sections | Facts removed, 10 → 9 each time; typing also left a `<span style="font-family: Roboto…">` | unchanged |
| First text to last text, Backspace | across every section | 10 → 3 blocks (only page-break, hero and closing left) | unchanged |
| Composing (IME, CDP) over hero → outcome | `insertCompositionText`, not cancelable | 10 → 9 blocks | the selection collapses first; the text goes in at the caret, every block kept |
| Paste of two HTML paragraphs, caret in a tool | none (HAX handles paste) | the hero replaced by two `li`s, 10 → 11 | plain text in the tool, every block kept |
| Selection across two outcomes in one list, Delete | `deleteContentForward` inside one block | merged (allowed) | merged (allowed) |
| Backspace in an empty outcome (starter) | collapsed at `li@0` | `ul` turned into a `p` holding `<font>` | unchanged |
| Backspace in the hub's empty intro (starter) | collapsed at `p@0` | **hax-body emptied, 3 → 0** | unchanged |
| A drag from Tools into the next block | `deleteByDrag` (synthetic event with a target range) | – | refused |

`preventDefault()` on `beforeinput` left the normalized HTML identical in every refused case. The guard listens on hax-body in the capture phase, ignores inputs from a block's own shadow controls (`composedPath()[0]` outside hax-body's light DOM), and refuses when a range touches hax-body itself, spans two top-level blocks, crosses into or out of a heading, or is a collapsed deletion. Its log (input type, target ranges, reason) is in each row of the report.

**Manual checks:** a real IME (Japanese, Chinese, and macOS press-and-hold accents) over a selection across sections; dragging selected text across sections; ⌘A then Delete in a real window (Chrome's `selectAll` command came out empty when driven headless). Paste was driven with a synthetic `ClipboardEvent`, which runs HAX's handler exactly as a real paste does; a real ⌘V is worth one try.

## S4: undo and unsaved changes

| Check | Stock | Prototype |
|---|---|---|
| Undo steps after entering edit mode | 1 | **0** |
| … after clicking five blocks | 5 more | **0** (7 snapshots skipped as unchanged) |
| … after typing "abc" | 1 more | **1** |
| ⌘Z | nothing (HAX listens for Ctrl+Z only) | HAX's undo, position 0 → −1 |
| ⌘⇧Z | – | redo, −1 → 0 |
| The browser's Undo command (Edit menu; `historyUndo`, cancelable) | Chrome's own undo removed the text, and HAX recorded that as a *new* step | prevented and routed to HAX's undo, 0 → −1, no new step |
| Unsaved changes (entering, clicks, typing, undo, redo, undo) | – | false, false, true, false, true, false |

The wrapper keeps HAX's snapshots raw (so undo still restores `data-hax-active`). When the normalized HTML equals the normalized previous snapshot, it refreshes `undoStackPrevValue` and records nothing. The keys leave form fields outside hax-body alone (Page details, the image address); that part wasn't checked here.

## S5: saving

Fixture: the hero's tagline holds "Old tagline from before the save"; it's replaced by typing "New tagline typed just now". The sampler checks, every 50 ms and every animation frame, whether either tagline is visible anywhere in the theme (through shadow roots), and which view is up.

| Check | Result |
|---|---|
| Stock Save (the theme's Save, HAX's toggle) | Old tagline in 83 of 248 samples, from 854 to 5790 ms after Save; blank frames at 3.8, 5.0, 6.1 and 7.8 s; new tagline from 7.2 s |
| **Prototype: no sample shows the old tagline** | 52 samples every 50 ms and 151 every frame over 5851 ms: 0 old, 0 blank. Editing view with the new tagline until 4151 ms, then the reading view with it. |
| Timings (ms after Save) | answer 963; HAX's reload began 2214; settled 4160; reading view 4854. Without the sampler: 5450 ms, with 5 imports held. |
| The saved file | `<oer-cs-hero><p>New tagline typed just now</p></oer-cs-hero>` |
| The theme's `__beforeSave` still runs first | It wrapped `haxToContent` once (a property trap on hax-body); the page's stored order 14 → 14 |
| HTTP 500 | Answer in 114 ms; edit mode on, not inert, tagline kept, focus back in hax-body, "Couldn't save: 500 Simulated failure. Your edits are still here." |
| Try again | Saved; reading view after 5.5 s |
| No answer in 20 s | After 20 010 ms: edit mode on, every edit kept, caret back in hax-body, "Couldn't save: No answer from the server…" |
| The late answer | The file got the first save; the editor kept " and more", typed after the timeout; status "Unsaved changes" |
| HAX's `keepEditMode` (measured) | Old tagline **in the editor** for 7 samples (2.4–3.7 s), the editor blank for 6, the reading view flashed once (blank), hax-body re-imported, undo steps 2 → 1 |

Failure is detected by wrapping the site editor's `_handleNodeResponse` and `lastErrorChanged` for one save (401 and 403 first try a fresh sign-in, so they don't count as failure while there's a JWT). `saveNode` is bound at connect, so it can't be wrapped or awaited; dispatching `haxcms-save-node` keeps the theme's capture listener first.

## S6: Style and Page details mid-edit, and recovery

Each case typed a marker into the tagline, then saved through the real `oer-site-style` and `oer-page-details` elements (`_save()`), and waited for HAX's manifest reload.

| Check | Stock | Prototype (imports held) |
|---|---|---|
| Style save | re-imported once by `_bodyChanged`: marker lost, undo steps 1 → 2 | 1 import held; same elements, marker kept, undo steps 1 → 1; style saved |
| Page details of the course (credits) | the same: marker lost | kept; credits saved |
| Page details of the course site (enroll link) | – | kept; enroll link saved |
| A page save after a mid-edit description change | description back to the old one | the new description kept (with `freshDetails`) |

| Recovery check | Result |
|---|---|
| Unsaved edits copied within 2 s | `sessionStorage["haxcms-pending-edit"]` holds the page, through HAX's `_snapshotPendingEditForLogout()` from our debounce. HAX writes it by itself only when a session ends. |
| After a reload, HAX doesn't restore by itself | An accessor on the site editor's `__pendingRestore`, installed as soon as the editor exists, keeps the copy and reads `null` to HAX. HAX still toasts "Recovered unsaved edits to DART 413… select Edit to restore them": filter it in `quiet-mode.js`. |
| Entering edit mode offers it | One offer; "No changes" until restored |
| Restore | Through `HaxBody.prototype.importContent` (past any hold): the text is back, one undo step, "Unsaved changes" |
| Saving clears the copy | Yes, and the saved file has the restored text. Discard clears it too (on `hax-cancel`; not checked separately). |
| HAX's own restore (measured) | Applied without asking on entering edit mode; a baseline taken after it read "No changes", with 0 undo steps, so Exit would have dropped the edits silently |

The copy is raw `innerHTML`, editing attributes and all, with the page-break from when editing began. HAX strips the attributes when it saves, and point 6 covers the page-break.

## Files

- `nu-hax/scripts/editor-check/spikes/lifecycle/prototypes.js`: the prototypes, as the theme layer would install them (`__lc`).
- `nu-hax/scripts/editor-check/spikes/lifecycle/run.mjs`: the runner and the four checks.
- Reports: `WORK_DIR/reports/3105-lifecycle-<time>/report.json` (the last run: `3105-lifecycle-20261010-005404`).
