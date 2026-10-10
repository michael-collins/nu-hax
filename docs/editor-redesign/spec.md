# Editing microsites: the design

*For approval. Course sites (`/<campus>/<code>`) and OER Courses (`/oer-courses`), HAX 26.8.1, custom theme. Replaces the "dashed box" and `SiteSection.claim` guidance in `docs/design-system.md`. Paths are under `learning-materials/custom/src` unless they start with `nu-hax/`.*

## 1. The idea

You edit the page readers see, at their width and in their style. Everything you type is ordinary HTML in its section (a heading, cards, chips, questions), so HAX saves, undoes and shows it in Edit HTML without special handling, and the block draws one layout for readers and for you.

There are three levels: the **page**, its **sections**, and the **items** inside written sections (outcomes, tools, questions). Each level uses the same few verbs in the same places: **Add, Move, Duplicate, Hide, Remove**. Content you can't type here (facts, the semester, projects, instructors) says where it comes from and takes you there in one click.

Nothing loses work: no keystroke deletes a section, every change is one undo step, leaving unsaved always asks, and unsaved edits survive a reload. Every structural change is a HAX operation (`haxInsert`, `haxDuplicateNode`, `haxDeleteNode`) or a plain DOM move HAX's undo records. HAX is never edited; it is tuned from the theme layer, pinned to 26.8.1.

## 2. The author's journey

1. **Open** `/up/dart-413` signed in. Besides its section links and Enroll, the site bar shows authors **Edit content**, **Page details**, **Style** and the page menu ⌄. They stay named at phone width.
2. **Edit content** (⌘⇧E). The site bar becomes the editing bar at the same height, so nothing moves. The section at the top of the screen is selected. A screen reader hears: "Editing DART 413 course site, 10 sections. Hero selected. Enter edits it; arrows go to other sections; Control-backtick reaches the editing bar."
3. **Tagline.** Click under the title and type over the muted "Write the line under the title". **Change image** on the hero art opens the image field in a popover.
4. **What you'll learn** shows three faint cards and **Add an outcome**. That makes a real card with the caret in its title. Enter goes to the sentence; Enter again starts the next card. Pasting six lines makes six cards.
5. **Headings** are typed in place, as ordinary headings that Undo, Edit HTML and the bar's links all follow.
6. **The semester** says "The semester comes from a course plan" and offers **Choose a course plan**, which opens Page details at that field.
7. **Books** has no book site yet: Section ▾ → **Hide from readers** collapses it to a labelled strip.
8. **Arrange.** Esc twice selects the Tools section and ⌥⇧↑ moves it ("Tools moved to 6 of 10"). Or use **Sections** in the bar.
9. **Add a block** at **+ Add** between sections: Blocks → Columns, **Width: Section**.
10. **Preview** shows exactly the reader page. Esc returns to the same place.
11. **Save.** "Saving…" while the edited page stays on screen, then the reading view with the saved page. Old content never flashes. If saving fails, the editor stays open with every edit kept.
12. **Publish** is unchanged: the Course site card on the course page, or the hub's page menu, which the microsite bar now has.

## 3. The page: editing bar, modes, saving

### 3.1 The editing bar

One component, `editor/oer-edit-bar.js`, on every page; microsites add Sections, Style, Page details and Preview. The theme renders it where `renderEditorHeader()` is today, outside `<main>`, at the 3.5rem height of the sticky site bar it replaces, so the first section's top stays put. The `.cs-editing` note goes; its help moves to the entry announcement, placeholders and source chips.

```
Desktop, 1440 px, item selected for typing
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ ● Editing  DART 413  │ ☰ Sections │ ↶ Undo  ↷ Redo │ ◐ Style  ⚙ Page details  👁 Preview │ ⋯ │
│                                                     ● Unsaved changes  ⚠ 2 to check  [Exit] [Save] │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
 ┌───────┐                                              ┌─────────────────────────────────────┐
 │Section│   What you'll be able to do                  │ What you'll learn › Outcome 2 of 3 │
 │Outcome│  ┌───────────┐ ╔═══════════╗ ┌───────────┐ ┌ ─ ─ ─ ─ ─ ┐
 │Format │  │ ◎         │ ║[↑⠿↓]  ✦   ║ │ ≋         │   + Add an
 └───────┘  │ Cut with  │ ║ Print what║ │ Route in  │     outcome
  rail:     │ Plan, cut…│ ║ Slice mes|║ │ Set up CA…│ └ ─ ─ ─ ─ ─ ┘
  fixed x   └───────────┘ ╚═══════════╝ └───────────┘
 ─────────────────────────────────────── ( + Add ) ──────────────────────────────────── seam
   The semester, week by week                               [From the course plan]
```

(One row at 1440 px.) Left to right: an "Editing" badge and the page's short name; **Sections** (§4.9); **Undo** and **Redo**, disabled with a reason when there's nothing to undo; **Style**, **Page details**, **Preview**; **⋯ More** (Edit HTML of the whole page, Keyboard shortcuts ⌘/, Command search ⌘⇧K); the status (§3.3); **Exit** and **Save**. Ordinary pages keep Undo, Redo, Edit HTML, search, status, Exit and Save.

Labels show while there's room; as width shrinks, items move into ⋯ (Preview first, Undo and Redo last), never Save. Below 48rem (phone, or 200% zoom on a laptop) the bar reads `[✕ Exit] DART 413 ● [⋯] [Save]`.

### 3.2 Two modes: Edit and Preview

**Levels are not modes**: keys mean the same at every level (§7.1). **Preview** sets `inert` and `data-oer-preview` on `hax-body` itself (attributes of the host, not its `innerHTML`, so never saved or undo steps). Sections hear a window `oer-preview` event and draw their reader branch; the frame, rail, seams and placeholders hide. Esc returns to editing with the same selection.

### 3.3 Saving, exiting and never losing work

**Status** (`role="status"`, a dot plus words): *No changes*, *Unsaved changes*, *Saving…*, *Saved*, or *Couldn't save: [reason]. Your edits are still here.* **[Try again]**.

"Unsaved changes" doesn't come from HAX's undo position, which is unreliable (Appendix B #1). `editor/editor-state.js` keeps a **baseline**: the normalized `hax-body.innerHTML` (without `data-hax-*`, `contenteditable`, `draggable`, `role="textbox"`, `hax-*` classes), taken after HAX's start-of-editing work. A debounced MutationObserver compares against it, so undoing back to the start reads "No changes". It resets after each save.

**Save** (⌘⇧S). The stock toggle turns edit mode off *before* saving, which is why old content flashed for 2–4 s. `editor/stock.js` `savePage()` instead:
1. Sets `saving`: "Saving…", `hax-body` `inert` and `aria-busy`, the edited page still on screen.
2. Dispatches `haxcms-save-node` with `store.activeItem`, as the stock toggle does, but leaves edit mode on. The theme's `__beforeSave` capture listener still runs first; `saveNode` serializes and posts as usual.
3. On HAX's response, ends editing (`store.editMode = false`); `activeItemContent` is already current, so the reading view shows the saved page. Focus returns to **Edit content**.
4. On an error or a 20 s timeout, editing continues with every edit, the status gives the reason, and **Try again** repeats it.

Spike S5 verifies this (fallback: the stock toggle with "Saving your changes…" held over the reading view until HAX refreshes). **Decision D1** asks whether Save should keep you editing.

**Exit** (⌘⇧/) leaves at once when nothing changed. Otherwise `ui/oer-confirm.js` (a shadcn AlertDialog on `<dialog>.showModal()`) asks **"Leave without saving?** Your changes to DART 413 course site will be lost." with **Keep editing**, **Discard changes** (destructive) and **Save and exit** (primary). Discard calls stock `_cancelEditing` directly, so HAX's "Cancel / OK" never appears.

**Leave guard.** While unsaved, a capture `click` on `document` intercepts in-app links outside the content (the brand, the off notice) and asks **Keep editing / Save and go / Leave without saving**; `beforeunload` asks the browser's question. Links inside the content never navigate while editing (§6.2 #8).

**Recovery** reuses HAX's own copy. While unsaved, a 2 s debounce calls the site editor's `_snapshotPendingEditForLogout()`, which writes `sessionStorage["haxcms-pending-edit"]` (page id, body, time; kept 30 minutes, cleared on save). On entering edit mode, `editor/recovery.js` reads it, clears HAX's in-memory `__pendingRestore` so there is one restore path instead of two, and asks **"Restore unsaved edits from 2:41 pm?"** (**Discard them** / **Restore**). Restore runs `importContent(copy)` after the baseline, so the page reads "Unsaved changes". HAX's own toast is filtered in `quiet-mode.js`; while reading, the site bar shows "Unsaved edits from 2:41 pm · Edit content to restore".

**To check.** A chip, "⚠ 2 to check", appears only when needed. Its popover lists each issue with a fix: the hero image has no description (**Add a description**); *Questions* is empty, so readers won't see it (**Go to it**); no enroll link (**Open Page details**); an outcome without a title (**Go to it**). It never blocks Save.

### 3.4 Style, Page details and publishing while editing

**Style** opens the existing side sheet over the editor. Its preview event now carries `{siteId, style}` and applies only to that site; its swatches become an arrow-key radio group; closing returns focus to the opener. **Page details** opens the sectioned dialog; `pageDetails().show(id, {section, field})` gains `field`, which focuses that field.

Both save through `saveOutline` while the page is open in the editor. Spike S6 checks whether the resulting manifest reload re-imports the page body. If it does, `editor-state` snapshots `hax-body.innerHTML` before the outline save and re-imports it after, keeping selection and unsaved state.

**Publishing** stays put. A bar chip, "Off: readers can't see this site", links to the course page (through the leave guard) or, on the hub, to the page menu's **Publish**, which now exists on microsites.

## 4. Sections

### 4.1 Selecting: typing, or a whole unit

A **unit** is a section, an item, or an ordinary block. There are two states:

| State | Reached by | HAX `activeNode` | Focus |
|---|---|---|---|
| **Typing** | Clicking text, Enter on a selected unit, Tab | The field (`h2`, `h3`, `p`) | The caret |
| **Selected** | Clicking a unit's padding, generated content or strip; Esc | The unit's host | Its **name tag**, a button in the frame's label (§7.1 keys) |

Focus never goes to light-DOM nodes (a `tabindex` would be an undo step that HAX strips on save). Selected means no caret, so typing can't insert stray text. When the caret enters another field, `editor-state` sees `selectionchange` and calls `__focusLogic(field, false)`, keeping HAX's toolbar on the right element.

### 4.2 The selection frame

`editor/oer-block-frame.js` draws the ring, the handle and the label.

- **Ring.** Two-tone: 2px `--primary` with a 1px `--background` halo each side, visible on any section colour and distinct from the 2px `--ring` focus outline. Inside the edges of full-bleed sections, because sections abut. Clipped to the content viewport (below the bar, above the phone dock) and under menus and flyouts. HAX's own outline is off, so there is one ring.
- **Handle.** A compact `[↑ ⠿ ↓]` on the ring's left edge that follows the *visible* middle of the unit, so the arrows are never off-screen. Cards and chips show ← →.
- **Label.** A `role="toolbar"` whose first button is the **name tag**; inside full-bleed sections it sits in the top-right corner and sticks to the top of the visible part. It holds breadcrumbs (*What you'll learn › Outcome 2 of 3*, each crumb selects that level), state chips (*Hidden*, *Empty: readers won't see it*, *From the course page*), and **Block settings** only when the block's curated settings have fields (§6.3). Sections and items have none.

### 4.3 The rail: one toolbar for what you can do

`editor/oer-block-rail.js` stays the single toolbar, at a **fixed x** (the content's left edge plus 8px, the empty margin beside sections), so it no longer jumps between three positions. When that margin is narrower than the rail plus 16px (narrow windows, 200% zoom, phones), rail, label and handle merge into a bottom **selection dock** kept above the on-screen keyboard with `visualViewport`.

```
Phone, 390 px (or 200% zoom)          Generated and hidden sections
┌──────────────────────────────┐      ┌─────────────────────────────────────────┐
│[✕ Exit] DART 413 ●  ⋯  [Save]│      │ The semester  [From the course plan ▸]  │
├──────────────────────────────┤      │ ┌ ⓘ ────────────────────────────────┐   │
│ What you'll be able to do    │      │ │ The semester comes from a plan.   │   │
│ ╔══════════════════════════╗ │      │ │ [Choose a course plan]            │   │
│ ║ ◎ Print what you model   ║ │      │ └───────────────────────────────────┘   │
│ ║ Slice meshes for FDM.|   ║ │      ├─────────────────────────────────────────┤
│ ╚══════════════════════════╝ │      │ ░ Books · Hidden from readers  [Show] ░ │
├──────────────────────────────┤      └─────────────────────────────────────────┘
│ What you'll learn › Outcome 2│      
│ [↑][↓] [Outcome ▾] [Format ▾]│        ← selection dock
└──────────────────────────────┘      
```

| Selection | Rail |
|---|---|
| A section (selected, or typing in its heading or text) | **Section ▾**, plus Format ▾ when typing |
| Typing in an item field | **Section ▾**, **Outcome ▾** / **Tool ▾** / **Question ▾**, **Format ▾**, and **Text ▾** (paragraph and lists only) in answers |
| An item, selected | **Section ▾**, **Outcome ▾** |
| An ordinary block | **Block ▾**, **Text ▾**, **Format ▾**, **Insert inline ▾** (as today, curated) |

Headings and item titles never get Text ▾, so a heading can't become a paragraph. Every item reads the stock control's `disabled` state and shows the reason ("Already first", "Only one per page") instead of silently doing nothing. Enter, Space and → open a menu; Esc returns focus where it was. The rail stops key and paste events at its own host. A per-viewer **Show labels** setting (on by default, **Decision D4**) puts words beside the icons.

### 4.4 The verbs

Same names, same order, in the rail, the label's ⋯ and the Sections sheet:

| Verb | Section | Item | Ordinary block | Keys (Selected state) |
|---|---|---|---|---|
| Move up / down (earlier / later for cards, chips) | ✓ (hero first, *Ready to start* last) | ✓ (in its section) | ✓ (end of a column → next column) | ⌥⇧↑ ⌥⇧↓ |
| Add … above / below | section or block | outcome, tool, question | block | ⌘↵ |
| Duplicate | – (one per page; says why) | ✓ | ✓ | ⌘⇧D |
| Hide from readers / Show | ✓ | – | – | – |
| Remove | ✓ (§4.8) | ✓ | ✓ | Delete |
| Its own | *Add an outcome*, *Edit course details…*, *Choose a course plan…*, *Edit HTML…* | *Change icon* | | ⇧F10 |

Each block declares its own commands once, through HAX's `inlineContextMenu` hook (`plate.ceButtons = [{icon, label, callback}]`), so HAX's own plate offers them too. The rail collects them for the active unit and its ancestors with `HAXStore.runHook(unit, "inlineContextMenu", [proxy])`, without depending on the hidden plate refreshing. Callbacks are thin: they dispatch a composed `oer-edit-request {action, unit, …}`, so blocks never import HAX or the editor. `editor/ops.js` makes every structural change as one checkpointed undo step (§6.2 #3), announced (§7.3).

### 4.5 Adding sections and blocks

**Seams** between top-level units span the full width: a 1px line with a centred 28px **+ Add** pill, shown within ±12px of the pointer or on keyboard focus, and always above and below the selected section. None above the hero or below *Ready to start*, which are pinned.

**The flyout** (`editor/oer-block-inserter.js`) groups: **Not on this page** (missing standard sections, **Add back**, landing in their standard position); **On this page** (disabled, **Go to it**); **Blocks** (about 15, deduplicated and plainly named: Paragraph, Heading 2/3/4, List, Quote, Image, Video, Embed, Columns, Divider, Spacer, Callout, Self check, Stop note); **All blocks…** (searchable). Course-site sections are offered only on course sites, hub blocks only on the hub, and inside a written section only its own item.

**New blocks arrive empty** (`STARTERS`): a paragraph with the caret in it, empty columns, an image block that opens the image popover. No "Deep thoughts", no cat photo. The new block scrolls to the centre.

### 4.6 Generated sections say where their content comes from

Facts, the semester, projects, books, instructors, *Ready to start* and the catalog draw from other pages. Each declares `static oerEditor.source = {label: "From the course page", kind: "course", section: "details"}`, shown as a label chip that opens the source and as the first rail command, **Edit course details…**. Clicking a generated value (a fact, a week, Enroll) selects the section: never a dead click. Blocks send a composed `cs-edit-source {kind, field}` event that the theme handles, so it works while reading too: course fields open `pageDetails().show(courseId, {section, field})`; the plan opens in a new tab, announced. Only a generated section's `<h2>` can be typed.

### 4.7 Empty states: two kinds that never look alike

- **Type here:** a muted placeholder *inside the field* (§5.5).
- **Comes from elsewhere:** a solid, primary-tinted callout with an info icon and one button ("Instructors come from the course page. **Add instructors**").

Both are author-only shadow DOM, never saved. The dashed boxes are retired: typeable text gets a faint `--accent` tint on hover and the focus ring on focus; generated content neither. An empty written section shows its final shape (three faint cards, two chips, one question) and one button: **Add an outcome**, **Add a tool** or **Add a question**. A ghost **+ Add** cell ends its items while editing.

### 4.8 Hiding and removing

**Hide** sets the reflected boolean `hiddenFromReaders` (attribute `hidden-from-readers`; HAX never saves a false boolean, and the sanitizer keeps attributes on custom elements). Readers get nothing, the bar drops its link, and `theme/theme.css` hides it before upgrade. While editing it is a 3rem strip, "**Books** · Hidden from readers · **[Show to readers]**", that opens to full height while selected (**Decision D3**). The native `hidden` attribute was rejected: our editor already reads `el.hidden` as "not displayed" (the rail's `shown()`), and the strip would have to fight the UA `[hidden]` rule in every section.

**Remove** an empty or generated section at once, with "Books removed · **Undo**". A written section with content asks first (`ui/oer-confirm.js`): "Remove *What you'll learn* and its 3 outcomes?" with **Hide it instead**, **Keep it** and **Remove section**. Hide comes before Remove in every menu.

### 4.9 The Sections sheet

**Sections** opens `editor/oer-site-outline.js`, a non-modal sheet over the page's left side (a modal sheet on phones). It never narrows `<main>` (**Decision D2**).

```
┌ Page sections ──────────────── ✕ ┐
│ ▸ Hero                           │
│   Facts · from the course page   │
│ ▾ What you'll learn  3 outcomes  │
│     Cut with confidence          │
│     Print what you model         │
│     Route in three axes          │
│   The semester · from the plan   │
│   Tools · empty: readers won't   │
│     see it                       │
│   Books · hidden from readers    │
│ ▸ Questions  2 questions         │
│   Ready to start                 │
│ ──────────────────────────────── │
│ Not on this page                 │
│   What you'll make   [Add back]  │
│ [+ Add section…]                 │
└──────────────────────────────────┘
```

It is an APG tree (`aria-level`, `aria-posinset`, `aria-setsize`, `aria-expanded`); each row's name includes its state ("Books, hidden from readers"). ↑ ↓ Home End and type-ahead move; → ← expand and collapse; Enter goes to the row on the page (focus on its name tag); Space selects it but keeps focus here; ⌥⇧↑/↓, Delete and ⇧F10 work as on the page. Its open state is remembered per viewer.

## 5. Items and fields

### 5.1 The markup

Headings move into light DOM. Repeated things become small item elements. No `slot` attributes are stored, and nothing editor-only is saved.

```html
<oer-cs-hero image="/files/studio.jpg" alt="Students at the laser cutter">
  <p>Design it on screen, then make it real: laser cutting, 3D printing and CNC.</p>
</oer-cs-hero>
<oer-cs-facts></oer-cs-facts>
<oer-cs-learn>
  <h2>What you'll be able to do</h2>
  <oer-cs-outcome icon="target"><h3>Cut with confidence</h3><p>Plan, cut and finish parts on the laser cutter.</p></oer-cs-outcome>
  <oer-cs-outcome><h3>Print what you model</h3><p>Slice meshes for FDM.</p></oer-cs-outcome>
</oer-cs-learn>
<oer-cs-semester><h2>Fifteen weeks, three projects</h2></oer-cs-semester>
<oer-cs-books hidden-from-readers></oer-cs-books>
<oer-cs-people><h2>Who teaches it</h2><p>A note in the instructor's own words.</p></oer-cs-people>
<oer-cs-tools>
  <h2>Tools you'll use</h2>
  <oer-cs-tool><p>Epilog Fusion Pro laser cutter</p></oer-cs-tool>
  <oer-cs-tool><p><a href="https://www.autodesk.com/fusion">Fusion 360</a></p></oer-cs-tool>
</oer-cs-tools>
<oer-cs-faq>
  <h2>Questions</h2>
  <oer-cs-question><h3>Do I need experience with machines?</h3><p>No. Week 1 starts with safety.</p><ul><li>Bring closed shoes.</li></ul></oer-cs-question>
</oer-cs-faq>
<oer-cs-closing></oer-cs-closing>
<!-- the hub -->
<oer-courses-intro><h1>OER Courses</h1><p>Courses you can take, by degree…</p></oer-courses-intro>
<oer-courses-catalog></oer-courses-catalog>
```

**Headings.** A missing or empty heading gives readers the section's default from shadow DOM (keeping "Read the book" / "Read the books"). In edit mode each section ensures an empty `<h2>` exists to type into; an empty one is left out on save. HAX gives inserted headings an `id="header-…"`, as on every page; harmless, and useful as anchors.

**Fields** are ordinary HAX text elements (`h1`/`h2`, `h3`, `p`, and `ul`/`ol` in answers). Links and emphasis survive: nothing goes through `textContent` any more.

### 5.2 Rendering: one template for reading and editing

Each section and item renders the **reader layout** in both modes with its light DOM slotted in. New block-layer files, no editor imports: `blocks/course-site/cs-items.js` (`SiteItem`, `oer-cs-outcome`, `oer-cs-tool`, `oer-cs-question`) and `cs-keys.js`.

- **Manual slot assignment** (`slotAssignment: "manual"`). After every render and light-DOM change, `assignSlots()` puts the first `h1`/`h2` in `<slot name="heading">`; accepted items in `<slot name="items">` inside the reader's container (`<div class="cards" role="list">`, the chips row, the questions stack); accepted text blocks in `<slot name="text">`; and **anything else** in `<slot name="stray">`, shown only while editing as "Readers won't see this paragraph. **Make it an outcome** · **Move it below the section**" (also in To check). The heading sits outside the list, and items get `ElementInternals.role = "listitem"`, so list semantics are valid with no stored `role`.
- **Items** assign their own fields (first `h3` to `title`, the rest to `text` or `answer`) and draw their card, chip or question with `:host` and `::slotted()`. **Questions** are `<details>` for readers and stay open while editing, so Find sees every answer.
- **Elements re-assign on first render**, which covers HAX's `innerHTML` undo and redo, Edit HTML and `importContent`, which all recreate them.
- **Readers keep the legacy parsers** (`listItems()`, `questions()`) for sections without item elements, e.g. restored Versions.
- **Fallback** if spike S2 rejects manual assignment in Firefox or WebKit: `slot="heading"` on headings only, everything else in the default slot.
- **Sections are `width: 100%`** of a full-width container in both modes, replacing `100cqw` and its negative margins: no 6px sideways scroll, no overflowing settings preview.
- **The reader copy idles while editing**: the theme's light-DOM copy stops its autoruns, observers and catalog fetches.

### 5.3 Typing: keys inside items

`cs-keys.js` listens on each section and item host, which keys reach before HAX's window `keydown`. It stops only the keys it handles, plus their `keyup` (disarming HAX's double-↑ "insert a paragraph", which would put one above the hero). Arrows, formatting and ordinary typing fall through to HAX.

| Key | Heading (`h2`) | Title / tool / question (single line) | Outcome sentence | Answer (`p`, lists) |
|---|---|---|---|---|
| Enter | First field (makes the first item if none) | Next field (made if missing); in a tool, a new tool | New item after, caret in its title | New paragraph (HAX); on an empty last one, a new question |
| ⇧Enter | – | – | Line break | Line break |
| ⌘Enter | New item first | New item after | New item after | New item after |
| Backspace at start | Nothing: never deletes heading or section | Empty item: removed (Undo toast), caret to the previous item's end; else just moves there | To the title's end | HAX within the answer; at its start, to the question's end |
| Delete at the last field's end | Nothing | Nothing | Nothing | Nothing |
| Tab / ⇧Tab | Next / previous field, across items, on to the next section | Same | Same | Indent in lists, else same |
| ⌘A | This field only | Same | Same | Same |
| Esc | Select the section | Select the item | Select the item | Select the item |
| `/`, `# `, `- `, `1. `, `> ` | Typed as text | Typed as text | Typed as text | HAX shortcuts (lists welcome) |

The controller moves the caret with a `Range` from `getEditRange()`, which handles each engine's shadow-DOM selection (`ShadowRoot.getSelection` in Chromium, `getComposedRanges` in WebKit, the document selection in Firefox); the `selectionchange` sync then tells HAX (§4.1). Creating and removing items goes through `oer-edit-request` to `ops.js` (§5.6).

### 5.4 Paste

Single-line fields paste plain text. On an item title, a tool or an empty item, **several lines become one item per line**. Answers keep rich paste, cleaned by `cleanRichText()` (`ui/oer-text-editor.js`). The host handles these and stops them, which also blocks HAX's "paste into a non-text block inserts a stray `<p>`".

### 5.5 Placeholders

Placeholders are **`aria-hidden` shadow text** in the same grid cell as the field's slot, with `pointer-events: none`, so a click lands in the field ("Outcome title", "Write the line under the title"; an empty heading shows the section's default), in `--muted-foreground` (AA). Emptiness is tracked in shadow DOM, so **nothing is added to light DOM**: no undo steps, nothing saved. CSS `::before` text was rejected because screen readers read it as content; they hear the field's name from the live region instead (§7.3). Every field has `min-block-size: 1lh`, which ends the zero-height paragraph blocker.

### 5.6 Add, duplicate, move, remove (what `ops.js` does)

| Operation | Implementation | One undo step because |
|---|---|---|
| Add item | `body.haxInsert(tag, "<h3></h3><p></p>", {}, afterItem)` with the **item**, never the field (which would nest it); `await settled(body)`; `__rehydrateLayoutDescendants(newItem)`; caret into the title | Checkpoint before and after |
| Duplicate / Remove | `body.haxDuplicateNode(unit)` / `body.haxDeleteNode(unit)`, then select the copy or neighbour | Same |
| Move | Bounded swap among same-kind units in one container, skipping the heading and `page-break`, with `body.___moveLock` so the unit stays selected. One path for every level (`haxMoveGridPlate` would push an item past its section's heading) | Same |
| Next column | The next `slot="col-n"`, at the top of that column | Same |
| Hide, icon, image, alt | `ops.setAttr()` on reflected properties | Same |

**Checkpoint:** `clearTimeout(body.__StackDebounce); body.undoManagerStackLogic({})` before and after each operation, with its label kept so Undo can say "Undid: moved Tools up".

### 5.7 Icons and the hero image

An outcome's optional `icon` is reflected. Its tile is a shadow button ("Change icon: Target", wrapped in `editorControl()`, §6.2 #5) that asks the editor to open `ui/oer-icon-picker.js` with 12 curated Lucide icons plus **Automatic** (today's cycling).

**Change image** over the hero art opens `editor/oer-image-popover.js`, the popover every image block uses (§6.3), wrapping `ui/oer-image-field.js` (Upload, Choose from site, Use an address, description, **It's decoration**). The field focuses and scrolls into view when it opens, Esc closes it, and the text column no longer jumps. `image`, `alt` and `decorative` are reflected; the hub catalog reads the hero exactly as before.

### 5.8 What HAX is told

| | Written sections (hero, learn, people, tools, faq, intro) | Generated sections with a heading (semester, make, books, closing) | Facts, catalog | Items |
|---|---|---|---|---|
| `type` | `grid` | `grid` (holds only its `h2`) | `element` | `grid` |
| `contentEditable` | `true` | `true` | `false` | `true` |
| `canEditSource` | `true` | `false` | `false` | `false` |
| Settings | `hideDefaultSettings: true`, `designSystem: false`, `canScale: false`, `settings: {configure: [], advanced: []}` | same | same | same |
| Gizmo | page-type filtered | same | same | `requiresParent`, `meta.hidden` (honoured by HAX's tray) |
| Hooks | `editModeChanged`, `activeElementChanged`, `inlineContextMenu`, `preProcessNodeToContent` | same | `inlineContextMenu` | `activeElementChanged`, `preProcessNodeToContent` (an all-empty item returns `""`, so isn't saved) |

**Items are grids** because only grids get their descendants made editable when inserted or activated (`__rehydrateLayoutDescendants`). A whole selected item makes `hax-body` editable, but focus is then on the name tag and the `beforeinput` guard refuses text outside a field. **Facts and the catalog stay `element`**, so selecting them turns `hax-body` editing off and nothing can be typed into an empty host. `preProcessNodeToContent` returns a **clone** without the empty heading, so the live DOM is never trimmed while Edit HTML is open. Our extra rules live in `static oerEditor` (`kind`, `limit`, `pin`, `pageTypes`, `accepts`, `flow`, `fields`, `source`, `fullBleed`, `columns: false`, `textTarget: false`), not invented `haxProperties` keys.

### 5.9 Migration

1. **On entering edit mode**, `editModeChanged(true)` upgrades legacy markup *synchronously*: `heading` becomes a leading `<h2>`, `ul > li` rows become outcomes or tools (split with today's `listItems()` logic), FAQ runs become questions. HAX resets its undo stack in a `setTimeout(0)` after the hooks and the baseline is taken after that, so the upgrade is neither an undo step nor an unsaved change. Leaving without saving keeps the old markup, which readers still render.
2. **The two live pages** (both still empty starters) are converted by `nu-hax/scripts/course-site-structure.mjs`: dry-run diff, scratch copy first. It also updates `COURSE_SITE_STARTER`, `HUB_STARTER`, every `demoSchema` and the mirror scripts. "The semester, week by week" becomes the one default.

## 6. The HAX layer

### 6.1 Rules

- **Pinned patches** live in `editor/hax-fixes.js` (the `onDefined` pattern). Each checks a 26.8.1 fingerprint of the method it wraps (present, with a known marker in its source) and switches itself off with one warning if it changed. Each names the HAX lines it relies on and is an upstream pull-request candidate. Prototype patches install when the theme loads, before the first edit session, because `hax-body` binds `_onKeyDown` as an own property on first entry.
- **One descriptor per tag.** `editor/policy.js` `policyOf(el)` merges our classes' `static oerEditor` with a table for HAX's tags. Frame, rail, inserter, slots, ops, the `beforeinput` guard and the outline all ask it, replacing the scattered `isSection()` / `SECTION_TAGS` copies.
- **One loop.** `editor/editor-state.js` runs one `requestAnimationFrame` loop for selection and geometry, replacing three loops and `globalThis.__oerDragging`.

### 6.2 Runtime fixes

| # | Problem | Fix | HAX source (26.8.1) |
|---|---|---|---|
| 1 | Keys and pastes outside the content edit it | Wrap `_onKeyDown` / `_onKeyUp` to return unless `e.composedPath()` includes `hax-body`; re-bind HAXStore's own `paste` listener with the same guard | `_onKeyDown` 1407–1432, bound 4456; `_onPaste` hax-store 2072 |
| 2 | Native deletion removed a section | Capture `beforeinput` on `hax-body` reads `getTargetRanges()`: cancels `delete*`, `insertParagraph`, `insertFromPaste`/`Drop`, `insertReplacementText` that cross a unit or column boundary or into/out of a single-line field, and `insertText` aimed at a unit host outside any field. Keydown rules (§5.3, plus Backspace/Delete beside a unit) back it up | Backspace 1696–1730 |
| 3 | Selecting something is an undo step | Wrap `undoManagerStackLogic`: if normalized HTML equals the normalized previous snapshot, refresh the raw snapshot and record nothing. Snapshots stay raw, so undo still restores `data-hax-active` | hax-body 5444; undo-manager |
| 4 | ⌘Z ran the browser's undo on Mac | In edit mode, capture Mod+Z, Mod+⇧Z, Ctrl+Y when focus is in the content or editor chrome (not a form field) and call `body.undo()`/`redo()`; redirect `beforeinput` `historyUndo`/`historyRedo`; restore the selection by path and announce | stock checks only `ctrlKey`, 1433–1451 |
| 5 | Focus taken from controls inside blocks | Grids with in-place controls get `contentEditable: true`, so `positionContextMenus` stops removing `contenteditable` (the blur). An `editorControl()` directive (`ui/editor-control.js`) stops `pointerdown`, `mousedown`, `focusin`, `keydown`, `keyup`, `paste` at each shadow control. `#settingsform.disableAutofocus = true`. `claim()`, `keep()` and the 1.5 s refocus are deleted | 2902–2917; `_focusIn` 4049 |
| 6 | Sections announced as text boxes | Wrap the text toolbar's `setTarget`: for `textTarget: false`, `disableEditing` the old target and skip `role="textbox"` and `enableEditing` | rte-toolbar 1593–1606, 1387 |
| 7 | Double- and triple-click don't select | Capture `mousedown` with `detail ≥ 2` inside the active text node stops it before `_mouseDown` collapses the selection | `_mouseDown` 936 |
| 8 | Links navigate mid-edit and lose work | Capture `click` on `hax-body` cancels any `a[href]` in the composed path and opens the link popover (**Open in new tab ↗**, **Edit link**, **Remove link**); catalog cards drop `href` while editing | – |
| 9 | A stuck source view disables Duplicate and Remove | Clear `viewsourcetoggle` on selection change | plate-context 247–282 |
| 10 | Caret collapsed or lost after inserts | `settled(body)`: HAX's "inserting" state cleared plus two frames (600 ms fallback) before placing the caret; the entry selection waits for the stock UI's 100 ms `haxToContent()`, which clears `activeNode` | 2665–2700; editor-ui 8104 |
| 11 | Files dropped onto sections land inside | Wrap `dropEvent` to refuse targets whose policy accepts no blocks | dropEvent 5455 |

### 6.3 Every-page improvements

- **Settings, curated at form time.** HAXStore's `testHook`/`runHook` gain a universal `setupActiveElementForm` applying `editor/block-settings.js`: per-tag allow-lists with plain labels (an image keeps description, caption, size, float; a paragraph nothing; "Disable responsive" becomes "Keep columns side by side on phones"). It runs after every registration path and DDD's later additions, assigning new arrays (they're shared with `HAXStore.elementList`). DDD groups, Developer, Schema and Lock go (Lock stays in the rail). The dialog traps and returns focus, defers Esc to an open palette, and previews in a `container-type: inline-size` stage with the site's variables. HAX's `allowedBlocks` was rejected: it also strips "Change to" tags and command inserts site-wide.
- **Columns:** one name, ratio labels ("1 : 1", "2 : 1"), a roving-tabindex menu at Block ▾ → Columns… (replacing the stock Add/Remove column that made 1-2-1). Never offered for or inside sections and items. On microsites, **Width: Reading / Section** (`width="wide"`, 72rem).
- **Link popover** (`editor/oer-link-popover.js`): an address or **Link to a page** (searching the manifest), plain text, **Open in a new tab** (off), **Add link**; Enter submits; spaces kept; no empty `<b>`. Format → Link and ⌘K open it.
- **Images everywhere:** `img`, `media-image` and `figure` get **Change image…** (the image popover); inserting one asks for its description.
- **One stylesheet for reading and editing.** `blocks/course-site/cs-content.js` is a constructable sheet flagged `.hax`, adopted on `document` when the theme loads (before HAX mounts; `h-a-x` copies `.hax` sheets into its shadow root). It holds the 48rem width for blocks between sections (ending the flush-left paragraph for readers), `text-align: start` and the theme's body size on `hax-body` (no justified text or 16→20px reflow on any page), and link colour in items.
- **Geometry and phone:** on microsites the article is full width in both modes, with no padding or 5.5rem gutter while editing; on phones, the collapsing bar, the selection dock, a zero-width `hax-plate-context` (no sideways scroll), and HAX's preferences toast moved into Keyboard shortcuts.

## 7. Accessibility

### 7.1 Keyboard map (Mod is ⌘ on Mac, Ctrl elsewhere)

| Where | Keys | Action |
|---|---|---|
| Anywhere | Ctrl+\` / Ctrl+⇧\` (and F6 where the browser passes it) | Next / previous region: bar → Sections sheet → selection → content |
| | Mod+⇧S · Mod+Z · Mod+⇧Z, Ctrl+Y · Alt+F10 | Save · Undo · Redo · to the rail (Esc returns) |
| | Mod+/ · Mod+⇧K · Mod+K | Shortcuts · command search · link |
| Typing | Esc; Enter, ⌘Enter, Tab, ⌘A | Select the unit; §5.3 |
| Selected (name tag) | Enter · Esc | Into the first field · up a level (at a section: says "Control-backtick for the editing bar") |
| | ↑ ↓ (← → in grids), Home, End | Previous, next, first, last |
| | ⌥⇧ arrows · Mod+⇧D · Delete · ⇧F10 | Move · Duplicate · Remove · Actions |

No Hide shortcut (⌘⇧H belongs to the browser); ⌥⇧arrows act only when Selected, where there's no text to extend. The harness checks every chord can be prevented in Chromium, Firefox and WebKit; the rail and actions menu cover any that can't.

### 7.2 Focus after every operation

Entering edit mode selects the section at the top of the screen and keeps it at the same height. Move and Hide keep focus on the unit. Add puts the caret in the new field; Duplicate selects the copy; Remove selects the previous unit (or the next, or the section). Undo and Redo return to the same place if it still exists, otherwise the changed unit. Save and Exit go to the site bar's **Edit content**. Every popover, sheet and dialog returns focus to its opener, Style and Page details included. `scroll-padding` matches the bar and the dock, so focus is never hidden (2.4.11).

### 7.3 Announcements, regions and names

`editor/announce.js` has one polite region (shared with `oer-toast`) and one assertive region for errors. It announces mode changes (entry with counts and the way out; Preview), selection ("What you'll learn, section 3 of 10, 3 outcomes"), field entry ("Outcome 2, title, empty"; debounced, with a per-viewer off switch), changes ("Tools moved to 6 of 10", "Outcome added, 3 of 4", "Books hidden from readers. Undo with ⌘Z", "Undid: moved Tools up"), save states and recovery. Caret movement within a field is never announced.

Regions: the bar is a `<header>` ("Editing DART 413 course site") with a roving `role="toolbar"`, led by **Skip to selected section**; the Sections sheet a `<nav>` ("Page sections"); the page the theme's `<main>` ("Page content, editing"); the rail and the frame label toolbars ("Tools for What you'll learn", "Selection"); the phone dock a `region`. Every icon button's name contains its tooltip text (2.5.3).

### 7.4 Low vision, zoom and forced colours

Chrome is sized in rem: targets of at least 24px, buttons 32px, nothing on hover only, editor tokens never the site accent. Every new pair goes into `scripts/contrast-audit.mjs` (placeholders, chips, accent hover, the ring on every section background, light and dark). Forced colours: outlines (not shadows) in `Highlight`, placeholders in `GrayText`. At 200–400% zoom or below 48rem the phone layout applies, and below 30rem of height the bar stops being sticky. Reduced motion turns off smooth scrolling and drag animation.

## 8. Deliberately left out

- **A zoomed-out "Sections mode"** shrinks text below what a low-vision author can read; a **docked outline** narrows `<main>`. The Sections sheet does both jobs at full size.
- **Section colour schemes, tones, layout variants, a phone-width preview:** design features needing a large contrast matrix and container-query rewrites. Revisit once editing is proven.
- **Edit as form:** a second editor of the same HTML that would drift.
- **A blank "section" block:** the theme.css rule, the shared sheet and Width: Section fix what it was for, without nesting layouts.
- **Editing generated data inline:** it belongs to other pages and would be overwritten.
- **Per-item images**, HAX's `allowedBlocks`, `editElement` and `editingElement`, IndexedDB recovery, server autosave (HAXcms commits the whole site per save), drag in the Sections sheet, saved sections, and a higher undo limit (50 is plenty once selection stops burning steps).

## 9. How it gets built

1. **Harness:** `nu-hax/scripts/editor-check/`, Playwright on Chromium, Firefox and WebKit with axe-core, against a scratch copy on :3101 (stopped by port). Every acceptance check runs there.
2. **Spikes**, each with go/no-go and a fallback: S1 nested grid items; S2 manual slots in three engines; S3 the `beforeinput` guard; S4 normalized undo and ⌘Z; S5 saving without leaving edit mode; S6 outline saves mid-edit and recovery; S7 `contentEditable: true` with shadow controls in Firefox and WebKit.
3. **Stopgaps** ship within days on the current model and clear both blockers and most majors.
4. **Foundations:** the HAX layer; policy, state, ops, announcements; the shared sheet and geometry.
5. **The section and item model**, then the sections and migration.
6. **Chrome:** frame and rail, inserting, the bar and saving, the Sections sheet.
7. **Every-page polish** (settings, popovers), then docs, contrast and a full run, including VoiceOver with Safari and NVDA with Chrome by hand.

The owner sees each phase before the next starts.

---

## Appendix A. Audit findings and their fixes

Blockers and majors (CS = course-site audit, HL = hub-and-layouts audit):

| Finding | Fixed by |
|---|---|
| **CS-0 / HL-0 (blocker):** zero-height paragraphs; the tagline, note and questions can't be typed | Stopgap: `1lh` fields, clicks on the box forwarded to its first field. Final: no boxes; fields in the reader layout at `1lh`, shadow placeholders, "Add …" makes a real field with the caret (§5.2, §5.5) |
| **HL-1 (blocker):** a catalog link navigated mid-edit and lost the hub edit | Content links never navigate while editing (§6.2 #8); cards drop `href`; leave guard and recovery (§3.3) |
| CS-1: Undo wiped heading, image and alt | Stopgap `reflect: true`; then light-DOM headings, reflected attributes, checkpointed ops (§5.6) |
| CS-2: Enter on the rail split the tagline | Scope patch; the rail stops its own keys; Enter opens menus (§6.2 #1, §4.3) |
| CS-3: after Edit HTML, Duplicate and Remove silently dead; editor attributes in the source | `viewsourcetoggle` cleared; the rail reads `disabled` with a reason; clean clone in `preProcessNodeToContent` |
| CS-4: paragraph between sections flush left for readers | Light-DOM rule (theme.css, then the shared sheet) |
| CS-5 / HL-13: demo text and a hotlinked cat photo | `STARTERS`; the image popover (§4.5) |
| CS-6: focus left on `body`; Tab stuck in content; dialogs drop focus | Entry selects the top section's name tag; Ctrl+\` regions, Alt+F10, Skip link; focus rules (§7) |
| CS-7 / HL-14: phone gutter, Save cut off, sideways scroll, preferences toast | No gutter, selection dock, collapsing bar, zero-width stock plate, toast suppressed |
| CS-8: unnamed icon-only site-bar buttons at ≤600px | `aria-label` plus tooltip (stopgap) |
| CS-9 / HL-8: broken section settings dialog and preview | No settings for sections or items; the button needs curated fields; container preview; focus trapped and returned (§6.3) |
| HL-2: Backspace deleted the whole section | `beforeinput` guard plus key rules (§6.2 #2, §5.3) |
| HL-3: Edit HTML lost the typed heading | Light-DOM headings; stopgap `reflect: true` |
| HL-4: Enter made a zero-height paragraph; the caret stayed | `1lh`, Enter rules, `settled()` before the caret |
| HL-5: Add column made 1-2-1 and lost the selection | Columns… via `layouts.js` (two equal, block in column 1, still selected); Remove only inside columns |
| HL-6: about 25 confusing settings fields | Form-time curation with plain labels |
| HL-7: Spacing broke full-width sections | `hideDefaultSettings`, `designSystem: false`; no section settings |
| HL-9: frame over the header, Save and flyouts | Clipped to the content viewport, under menus, label inside (§4.2) |
| HL-10: double- and triple-click don't select | Capture `mousedown` with `detail ≥ 2`; `claim()` deleted |
| HL-11: link dialog | `oer-link-popover` |
| HL-12: no in-place image change; "Select media" opened the palette | Change image… popover; Esc defers to the palette |
| HL-15: justified text, 20px body while editing | Shared `.hax` sheet |

Minors: section Layout items (CS-10) gated by policy; nested outlines (CS-11, HL-25) become one ring and a fixed rail; dashed boxes (CS-12) become two empty-state kinds; the heading's focus grab (CS-13, HL-26) goes with `claim()`; the image chooser (CS-14) focuses, scrolls and closes on Esc; drag autoscroll (CS-15) accelerates, with ⌥⇧arrows and the Sections sheet as non-drag routes; seams and the block list (CS-16, HL-19) are full width and curated; the stale view and OK/Cancel (CS-17, HL-22, HL-24) are fixed by the held save and `oer-confirm`; the 6px overflow (CS-18, HL-21) by `width: 100%`; bar links and Style while editing (CS-19) follow headings and live in the bar; the unprompted edit mode (CS-20) is logged by the harness; justified columns and the 16→20px reflow (CS-21, HL-20) by the shared sheet; swatches, naming and plurals (CS-22) by a radio group, "Page details" and `layouts.js`; cramped columns (HL-16) by Width: Section; the next column (HL-17) by Move down; a just-inserted block's layout (HL-18) is recomputed on parent change; column presets (HL-23) get ratio labels and one name.

## Appendix B. Risks the reviews raised, and the answers

| # | Risk | Answer |
|---|---|---|
| 1 | Dirty state from `stack-changed` and the undo position is wrong (no event on undo or redo; at the limit a middle entry is spliced without advancing) | Normalized HTML against a baseline, from our own observer (§3.3) |
| 2 | HAX resets the limit to 50 in a `setTimeout(0)` at each entry | Left alone; baseline and entry selection are taken after it and after the 100 ms stock snapshot |
| 3 | Selection, and `data-hax-empty`, become undo steps | Normalized undo wrapper; placeholders write nothing to light DOM |
| 4 | Keydown-only guards miss native cut, drag, IME and select-and-type deletion | `beforeinput` and `getTargetRanges` plus keydown rules; S3 in three engines |
| 5 | `keepEditMode` re-imports, flips edit mode and wipes undo | Not relied on: Save holds the editor and exits after the response (S5); D1 |
| 6 | Settings clutter arrives before `hax-register-properties`, and DDD rewrites `elementList` later | Curation at form time, assigning new arrays |
| 7 | `allowedBlocks` is site-wide and gates text tags and command inserts | Not used |
| 8 | `.hax` sheets are copied only at connect, render and store-ready | Adopted at theme load, plus a manual `__applyHAXAdoptedStylesToShadowRoot()` if `h-a-x` already exists |
| 9 | Nested grids: moves push items out; the observer activates inserted nodes; `/` and Markdown triggers fire in fields | Bounded moves; `settled()` before placing the caret; host keys stop `/` and triggers in single-line fields; S1 |
| 10 | Generated sections as grids accept drops, pastes and stray text | `accepts` enforced in inserter and slots, HAX's `dropEvent`, host paste and `beforeinput`; the stray slot warns |
| 11 | Manual slots must re-assign after undo, Edit HTML and import; unassigned children vanish; Safari and Firefox unverified | Assignment on every render; the stray slot; S2; heading-slot fallback |
| 12 | Native `hidden` is beaten by `:host { display: block }` | `hidden-from-readers` (§4.8) |
| 13 | Chord collisions (⌘⇧H, ⌘⇧D, F6, VoiceOver's Ctrl+Alt, ⌥⇧arrows in text) | No Hide chord; Ctrl+\` beside F6; ⌥⇧ only when Selected; harness checks; menu fallbacks |
| 14 | Style or Page details saves mid-edit may re-import the body | S6; snapshot and re-import fallback |
| 15 | A docked outline narrows `<main>` | An overlay sheet |
| 16 | An optimistic render diverges from what the server saved; the save event carries `activeItem`, not HTML | Not used; the edited view is held until HAX refreshes |
| 17 | `finalizeInsert` races the caret; shadow controls sit in `hax-body`'s path; `setTarget` writes `role="textbox"` over internals roles | `settled()`; `editorControl()`; the `setTarget` wrapper |
| 18 | CSS `::before` placeholders are read as content | `aria-hidden` shadow placeholders |
| 19 | The Text menu can retype a heading | No Text menu on headings or titles; plain-text paste; tags fixed on entry |
| 20 | WebKit's shadow-DOM selection | `getEditRange()` with `getComposedRanges`; S1 and S3 in WebKit |
| 21 | Two restore paths | One, ours, on HAX's snapshot, with its auto-apply disabled |
| 22 | `ElementInternals` and `:state()` support | Roles need Chrome 125, Safari 17.4, Firefox 126; no styling uses `:state()` |

## Appendix C. HAX 26.8.1 behaviour relied on (checked in the source)

hax-body.js: `_onKeyDown` acts when `activeElement` isn't `BODY` and `hax-body` is editable (1407–1432), is bound per instance on entry (4456), never cancels Backspace (1696–1730), opens the palette on `/` (1796) and runs Markdown triggers in `P` (1905). Entry resets undo in a `setTimeout(0)` (4401–4411) then awaits `editModeChanged` for direct children (4436–4448). `undo()` re-activates `[data-hax-active]` (4237). `__focusLogic` keeps the innermost non-inline element (4064–4201); `_activeNodeChanged` makes text, HR and grid nodes and `hax-body` editable and removes it otherwise (6282–6330); grid descendants become editable only through `__rehydrateLayoutDescendants` (5038), run on activation and on observed insertion, which also ids headings and activates the first added node (4755–4826). `haxInsert` inserts after the active node in layouts and finalizes a frame after upgrade (2600–2700); `haxMoveGridPlate` won't cross `page-break` (3002–3054). undo-manager snapshots raw `innerHTML`, fires `stack-changed` only on a new step and splices mid-stack at the limit. hax-store `nodeToContent` omits undefined, null, false and `""`, strips `data-hax-*`, `role`, `contenteditable`, and short-circuits on non-element hook results (5013–5200). haxcms-site-editor: `saveNode` (2313), `keepEditMode` (1713–1866), the 30-minute snapshot (1574–1661). h-a-x copies `.hax` sheets on connect, render, store-ready. hax-tray `_setupForm` shares `settings` arrays and runs `setupActiveElementForm` first (1396–1716). plate-context renders `ceButtons` and calls `activeNode[callback]` (413–421, 507–521, 616–638).
