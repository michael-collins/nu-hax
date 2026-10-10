# Design system

How the Digital Arts OER site looks, reads and behaves, and how to build new parts of it. The theme and every UI module live in the site repository (`learning-materials/custom/src`); paths below are relative to it unless they start with `nu-hax/`.

Read this before adding a component, a dialog, a page type or a setting. When something here and the code disagree, the code is right and this page needs fixing.

## Principles

1. **shadcn/ui, faithfully.** Components follow shadcn/ui (new-york): its proportions, states and spacing. Icons are Lucide. Don't invent a new look for one screen.
2. **WCAG 2.2 AA, always.** 4.5:1 for text, 3:1 for UI parts and focus rings, in light and dark mode. Every action works from the keyboard; motion respects reduced-motion settings.
3. **Guide, don't expect knowledge.** The site has many content types. Anything with choices (adding a page, exporting a course) is a guided dialog that explains the options in plain words and says what will happen before it happens.
4. **Readers and authors see the same site.** Authors get extra controls, but the navigation, pages and colours are the same for both. What an author sees signed in is what readers will see, minus drafts.
5. **Say it plainly.** Name things by what people see, not how the system stores them (see Writing).
6. **Build on HAX, don't fork it.** Everything is a layer over stock HAXcms: new components, theme styles, and styles pushed into HAX's own components. Never edit HAX's files or the managed files it rewrites (`index.html`, `build-haxcms.js`, `404.html`…).

## Tokens

Defined once in `tokens/shadcn-tokens.js`, as `light-dark()` pairs on `:root`. Light mode is light even on a dark system (`theme/theme.css` sets `color-scheme: only light` on `body:not(.dark-mode)`); dark mode is `body.dark-mode` (HAX's switch, remembered by `theme-choice.js`).

Use the tokens, never raw colours. The exceptions are the loading screen (`theme/theme.css`, before any code runs), Reader mode's page colours (their own palettes in `custom-oer-docs-theme.js`), and colour swatches that show themselves.

| Token | Use | Light | Dark |
|---|---|---|---|
| `--background` | The reading panel, fields, the default surface | white | `oklch(0.18 0.006 270)` |
| `--card` | The page frame, sidebar, cards | `#f7f8f8` | `#17181c` |
| `--popover` | Menus, dialogs, raised surfaces | white | `oklch(0.235 …)` |
| `--muted` | Wells: segmented-control tracks, chips, callouts | `#e5e5e6` | `oklch(0.255 …)` |
| `--accent` | Hover and the current item | blue-tinted | blue-tinted `oklch(0.27 …)` |
| `--foreground`, `--muted-foreground` | Text, secondary text | | |
| `--primary`, `--primary-foreground` | The main action, selected controls | blue | blue |
| `--link` | Links in text | | |
| `--border`, `--input-border` | Dividers; field and control borders (3:1) | | |
| `--ring` | Focus rings | | |
| `--destructive` | Delete, errors | | |

Dark mode is layered, not black: the panel is the darkest surface, the frame a step lighter, menus and dialogs a step lighter again, so raised things read as raised.

After changing any colour, run `node scripts/contrast-audit.mjs` in nu-hax; every pair must pass. Add a pair to the audit when you put a new foreground on a new surface.

Other tokens: `--radius` (0.625rem) with `--radius-lg`, `--radius-md` (−2px), `--radius-sm` (−4px); `--font-sans` (Inter), `--font-mono` (JetBrains Mono); `--sidebar-width` (16rem), `--topbar-height` (3.5rem).

## Type, spacing and layout

- **Type:** Inter throughout the interface; Source Serif 4 is a Reader mode option. Sizes in use: 0.75rem (labels, chips), 0.8125rem (hints, secondary), 0.875rem (controls, body of dialogs), 0.9375rem (card titles), 1rem (page text), 1.0625rem (dialog titles), and the page title from `site-active-title`. Weights: 400, 500 for controls, 600 for titles.
- **Group labels** in the sidebar: 0.6875rem, uppercase, 0.06em tracking, `--muted-foreground` at full strength (lighter fails AA at that size).
- **Spacing** steps of 0.125rem up to 0.5rem, then 0.75, 1, 1.25, 1.5rem. Dialogs pad 1–1.25rem; controls sit 0.375–0.5rem apart; sections of a form 1rem apart.
- **Layout:** sidebar 16rem; article column 48rem; dialogs `min(46rem, 100vw − 2rem)` (guided flows), `min(36rem, …)` (lists), `min(64rem, …)` (side-by-side work); everything works at phone width.

## Icons

Lucide, always:
- In components, `lucide("oer:name")` masks an SVG from `editor/lucide-icons.generated.js` (Lucide icons under `oer:` names, plus HAX icon names mapped to Lucide). Size 1rem, 0.875rem in small controls; colour comes from `currentColor`.
- The theme has its own inline Lucide SVGs (`icon.plus`, `icon.pencil`…) in `custom-oer-docs-theme.js`.
- Page icons chosen by authors are HAX icon names drawn by `simple-icon-lite`; `types/page-icon.js` treats HAX's guessed icon as no icon.

## Components

Each is a Lit component with its styles in its shadow root. Reuse these before writing new ones.

| Component | Where | Notes |
|---|---|---|
| Button | per component (`.btn`, `.btn.primary/.outline/.ghost`, `.icon-btn`) | Heights 2.25rem (dialogs), 2rem (toolbars, sidebar). Primary once per view. |
| Form controls | `ui/form-controls.js` | Checkbox (with indeterminate), Radio, Select trigger, Input/Textarea focus ring, placeholder, disabled, invalid, Slider accent. Add `formControls` first in `static get styles()`. |
| Switch | `ui/oer-reader.js` (`.switch`), the Course site card on course pages (`types/oer-page-header.js`), outline builder | A `button` with `role="switch"` and `aria-checked`, labelled by the visible words beside it. While it saves, show the new state with "Turning on…" and `aria-disabled`. |
| Image field | `ui/oer-image-field.js` | Every image field: a preview, Upload (or drop a file), Choose from site (HAX's file list), Use an address, and the image's description (alt text) beside it, saved to the type's `<name>Alt` field. Says so when an image can't be found. |
| Sectioned dialog | `types/oer-page-details.js` | A large dialog with its sections as a vertical tab list on the left (arrow keys move between them) and the open section on the right; a horizontal row on narrow screens. Use it when one thing has several kinds of settings and views. |
| Segmented control | `.seg` / `.tabs` in several components | Track `--muted`, pressed item `--background`. |
| Chip, badge | `.type-chip`, `.draft`, `.listed`, `.bc-status` | Pills, 0.6875–0.8125rem; status colours meet AA. |
| Callout | New page summary (`.summary`) | Info: primary-tinted with an info icon. Use for "what will happen". |
| Side sheet | `ui/oer-site-style.js` | A non-modal panel at the right for choices that preview live on the page behind it (Esc or Cancel puts it back). |
| Dialog | `ui/oer-new-page.js`, `ui/oer-browse.js` | Native `<dialog>` with `showModal()`: focus stays inside, Esc closes, click outside closes. Header (title, one-line subtitle, close), scrolling body, footer with actions on the right. |
| Confirm (AlertDialog) | `ui/oer-confirm.js` | `confirmDialog().ask({title, text, actions})` for a question that needs an answer before going on ("Leave without saving?"). Buttons say what they do; the first is the safe one, has focus, and is what Esc chooses. A click outside doesn't close it. |
| Menu | page menu and account menu in the theme | `role="menu"`, arrow keys, Esc returns focus. |
| Table | `blocks/oer-collection.js` | Columns, sorting, filters, cards view, selection with a bulk bar. |
| Sidebar | `outline/oer-site-nav.js` | Group labels (headings), rows, browse arrows on collections. |
| Toast | `editor/oer-toast.js` (HAX's toasts are shown in it) | For confirmations after an action, with one action button when it can be taken back ("Books removed · Undo"). Says its text in the editor's live region (`editor/announce.js`) and waits while pointed at or focused. An Undo goes back to where the author was, and is put away when editing ends. |

HAX's own components (its editor bar, tray, dialogs) get the same look from `editor/editor-skin.js`, which pushes styles into their shadow roots.

## Patterns

- **Guided creation.** Adding anything with choices is a two-step dialog: what (cards, grouped, each with a one-line description and where it's listed, plus search), then details (title, place, options), a callout saying what will happen, and a button naming the action ("Create and edit"). See the New page dialog. Start from the most likely answer (where the person clicked, where that type is listed) so the common case is Enter, type, Enter.
- **Listing pages.** A section (Lessons, Exercises…) is a page with a description and a table (`oer-collection`) of its type. A page can also list the pages that link to it through a field (`scope="linked"`: a program's courses). Signed-in authors get a **New [type]** button beside the page menu. Which page lists which type: `types/type-homes.js`.
- **Collections in the sidebar.** Types with `nav: false` stay out of the sidebar; their section's row has a browse arrow that opens a filterable list (`ui/oer-browse.js`). The sidebar must never hold hundreds of rows.
- **Navigation editing.** Edit navigation shows exactly the sidebar (`oer-outline-builder` in navigation mode), with counts for what collections hold. The every-page tree is Site → Page tree.
- **Bulk actions.** Select rows, then a bar appears with the actions and a confirmation that says exactly what changes ("Publish 58 drafts? Readers will see them.").
- **Drafts.** New pages start as drafts. Draft blocks (`oer-draft`) hold text for review; publishing can release it. Readers never see drafts, on the editing site or the published copy.
- **Page menu** (the caret beside a page's title): Edit content, Page details, Embed…, Versions…, Publish or Unpublish, Lock page, Delete page…. Everything else about a page lives in **Page details**: General (title, address, icon, type, description, tags), the type's details, Media, Structure, History and Report. Add new page settings there, not to the menu.
- **Destructive actions** say how many things they affect, before they happen.
- **Deleting pages** (`versions/versioning.js` `deletionPlan`, used by Delete page…, Browse pages and the outline builders): sub-pages go with the page; its versions nothing else uses go too unless the author unticks "Also delete its versions"; versions something uses stay, moved to where the page was with their address, and the dialog says what uses them. Browse pages → Orphaned versions lists versions whose page is gone, marked Unused or In use. Never delete a page with HAX's own delete, which leaves its versions behind.
- **Course sites.** One per course at `/<campus>/<code>` (`/up/dart-413`, `/wc/dmd-100`; `types/course-site.js`): a full-width microsite that pitches the course. Because there's only ever one, it's switched on and off from the Course site card on the course page, not created: on publishes it (making it the first time, with the standard sections), off unpublishes it and keeps what it says. It isn't offered in New page.
  - **Made of section blocks** (`blocks/course-site/cs-sections.js`): hero, facts, what you'll learn, the semester, what you'll make, the books, who teaches it, tools, questions, ready to start. Generated sections draw from the course and its plan (only their heading is typed); written ones hold what the author types inside them: the hero's tagline and the instructor's note as text, and items (`blocks/course-site/cs-items.js`) shown arranged for readers: outcomes as cards, tools as chips, questions (each with its answer) as an accordion. A new site starts with the standard sections, without headings, and one empty item in each section of items (`COURSE_SITE_STARTER`); pages written before items (lists, questions as headings and answers) read as before and become items as editing begins, or with nu-hax `scripts/course-site-structure.mjs`. Any block can go between sections. Sections are full width (the theme draws a course site's page full width, read and edited alike; editing in a window narrower than 1280px keeps the 5.5rem gutter other pages have, since the margin beside the sections' text can't hold the editor's rail and the selection's handle there, until the editor has a selection dock); other blocks keep the 48rem reading width, centred (columns set to `width="wide"`, 72rem). Sections never go in columns, by Add column or by dragging.
  - **Edit content edits it in place**, at the same width and in the same style, so it looks as readers will see it: each section draws the reader's layout in both modes, with what's typed in it slotted in where readers see it (`SiteSection` in `blocks/course-site/cs-shared.js`). Headings are ordinary `<h2>`s in the section (an empty one shows the section's default, faint, and readers get the default); What you'll learn holds outcomes (a title and a sentence each), Tools tools, and Questions questions (a question and its answer, open while editing), each with a cell to add one in the items' own shape ("Add an outcome", "Add a tool", "Add a question"). An empty field says what goes there, faintly, in the block's shadow DOM (`aria-hidden`, never saved). Keys in those fields are the section's (`cs-keys.js`): Enter goes on to the next field or makes the next item, Backspace in an empty item removes it, Tab goes field to field and to the controls the sections draw on the way (Change image, a callout's button, "Add a tool"; `stopsIn()`), and on out of the content from the last, Esc selects the item; in a list in an answer or a section's text, Tab puts an item under the one before it and Shift+Tab takes it back out; in a section's own text (the tagline, the note) Enter is HAX's new paragraph, and Backspace and Delete stop at its first and last. A written section shows readers the text blocks typed in it (paragraphs, lists, quotes, smaller headings: `TEXT_BLOCKS`); anything else it holds is marked for authors as something readers won't see. Empty sections tell authors what to add and disappear for readers. The two kinds of empty never look alike: what's typed here shows faint words in the field; what comes from elsewhere (a generated section with nothing to show, the instructors) is an information callout saying where it comes from, with one button that goes there ("Choose a course plan", "Add instructors"): the section sends `cs-edit-source` { kind, field, page }, and the theme opens that page's Page details at that field (`pageDetails().show(id, { section, field })`), giving focus back to the button as it closes, or the course plan (or, from the OER Courses catalog, a course page) in a new tab. The button's border is mixed toward `--foreground` so it keeps 3:1 on the callout's tint. Page details or Style saved while editing keep what's typed: HAX's reload after an outline save isn't let into the editor (`editor/import-hold.js`), and the page's details saved meanwhile go with the page when it's saved. A click on anything a generated section draws (a fact, a week) selects the section.
  - **Style** (`types/course-site-style.js`, the bar's Style panel): a colour scheme (all AA in light and dark) or a custom accent, adjusted until it passes, and a typeface pairing from Google Fonts. It's page metadata (`oerSiteStyle`) turned into custom properties (`--primary`, `--link`, `--ring`, `--cs-font-display`…) on the course site's `<main>`.
  - The frame (`blocks/oer-course-site.js`) is the bar (sections, Enroll; Edit content, Page details, Style for authors), the "off" notice and the footer, with light/dark mode. The bar never makes the page scroll sideways: section links that don't fit drop out of sight, and on phones the author buttons are square icons and the course code is the last thing cut short.
  - **In place, not in settings:** a section's heading is typed on the page and the hero's picture has Change image on it (an `oer-edit-request` { action: "image" } for the editor's image popover; until there is one, the image field opens under the picture). Its `image`, `alt` and `decorative` are attributes, which the OER Courses catalog reads from the saved page. Our blocks keep HAX's settings panel empty; anything an author changes is changed where they see it.
  - **Books** (`oer-cs-books`): the course's books (its Books field) as covers linking to their book sites; readers see those whose book site is on.
  - **OER Courses** (`/oer-courses`, `blocks/course-site/cs-hub.js`) is the students' hub: an intro the author writes and a catalog of the course sites that are on, grouped by program (the program pages, in navigation order). Course sites' brand goes there. Student-facing pages don't link to the OER repository, which is for faculty. Facts, the semester and projects come from the course and its plan; the site's fields hold the pitch. Its intro's heading is an `<h1>` typed in it (the hub's name until one is). It uses the same tokens and components with a larger type scale (hero up to 3.75rem), wide sections (72rem) and generous spacing; it scrolls in its own frame. Sections with nothing to show are left out for readers and say what to add for authors: with no course site on, the catalog's callout opens the course page whose site is off (or Courses, where each course page's Course site card is).
- **Book sites** (`/book/<short name>`, `types/book-site.js`, `blocks/oer-book-site.js`): a book on its own, to send to readers. Switched on from the Book site card on the book's page. A bar (the book, Text, Download), the chapters down the side, one chapter at a time in Reader mode's type and page colour (`oer-reader-text`, the palettes in `ui/oer-reader.js` READER_PALETTES), deep links per chapter, ← and →, and a title page whose contents run in columns (a project's steps folded into a count). A panel button at the start of the bar (a rule after it, so it isn't read as a logo) shows and hides the chapters: open by default and remembered on wide screens, sliding in over the page on narrow ones. The chapters are folding groups (after VitePress books): bold part titles with rules between them, headings that fold the chapters after them, closed except where the reader is, and the current chapter in the link colour. Headings in a book are labels, never pages to turn to. Downloads: PDF (the print view) and EPUB (`books/epub.js`). No site navigation or page metadata. Footnotes work as on pages (`ui/footnotes.js` `watchFootnotes` on its shadow root): a citation previews its note on hover and focus, jumps to it, and ↩ comes back, all without changing the chapter's address.
- **Colour mixes** with `--primary` use `color-mix(in oklab, …)`: in `oklch`, mixing with white or black swings the hue (pale blue turned pink).
- **Loading.** The loading screen builds a page (timing in `loader/loader-settings.js`, tuned with nu-hax `tools/loader-tuner.html`).

## Writing

- **Edit content** is the action that opens the editor on a page's content (not "Edit page"); **Page details** is everything else about it.
- **Name things by what people see.** "Address", not "slug"; "type", not "pageType"; "the navigation", not "the outline"; "draft" and "published".
- **Sentence case** for everything: titles, buttons, labels.
- **Buttons say what happens:** "Create and edit", "Publish 58", "Save outline". Not "OK" or "Submit".
- **One line of help, at the point of need**, in `--muted-foreground`. Explain consequences ("otherwise it starts as a draft only signed-in authors see").
- **Counts and plurals** are exact ("47 lessons", "1 lesson").
- **Errors** say what went wrong and what to do next. No apologies.
- Match the existing copy's spelling and terms; check the component next door.

## Accessibility

- Contrast: run the audit; check new combinations by hand (chips, callouts, disabled states).
- Focus: every control shows a ring (`--ring`, 2px outline or shadcn's 3px ring). Dialogs focus their first useful field and return focus when closed.
- Keyboard: dialogs close with Esc; lists move with arrow keys; Enter takes the obvious action.
- Labels: every field has a visible label or an `aria-label`; icons are `aria-hidden` beside text, or the button has an `aria-label`.
- Motion: respect `prefers-reduced-motion` (no hold on the loading screen, short fades).
- Never use colour alone for state: pair it with text or an icon (Draft badges, check marks).

## Building it

- **Lit components** in `custom/src`, one per file, with a doc comment saying what it is and how it's opened. Dialogs export a function returning the single instance (`newPage()`, `browse()`).
- **Styles for what authors write** (the page's type and alignment, links, code, tables, figures, footnotes, a course site's body face and the widths between its sections, fields typed inside sections) go in `blocks/course-site/cs-content.js`, one sheet for both views: it's adopted on the document with `hax = true`, so it reaches the reading view (the theme's light DOM) and the editor (hax-body's children, in h-a-x's shadow root, where document styles don't reach and DDD resets its tokens and draws code, tables and `pre` its own way). Write each rule for both places (its `content()` helper); only Reader mode's sizes stay in the theme. Style fields there, not with `::slotted()` in the block: the page's and DDD's rules for `p`, `h2` or `a` outrank those. Alignment an author sets (`data-text-align`) shows in both; the page itself is never justified.
- **State HAX would save:** HAX writes a block's declared Lit properties into the page's HTML, so internal state on blocks lives in undeclared fields (see `blocks/oer-collection.js`).
- **Controls inside HAX blocks** (a button, a field, the hero's image field): HAX takes clicks, keys and focus inside blocks, and a control loses focus as a block becomes active. Wrap each in `editorControl()` (`ui/editor-control.js`), which keeps its pointer, click, focus, key and paste events from HAX: on the control itself, or on a component that draws controls in its own shadow root (focus doesn't bubble past a wrapper `<div>`). Everything else a block draws while editing is `user-select: none`, so the caret and the selection pass from field to field over it.
- **Changing a page's structure while editing** (moving, adding an item, duplicating, removing, hiding, setting an attribute) goes through `editor/ops.js`: each change is one undo step and is said in the live region (`editor/announce.js`), and removing a section with something written in it (text, or a heading or image held in its attributes, its policy's `attrs`) asks first, offering to hide it instead. A hidden section carries `hidden-from-readers`, which `theme/theme.css` hides from everyone reading the page, and the course site's bar leaves out its link. Blocks ask for these with a composed `oer-edit-request` event rather than importing the editor. Messages name sections by their names ("Tools", "the hero") and other blocks as words in the sentence ("Undid: duplicated paragraph"), with `phraseOf()` in `editor/policy.js`. What's selected, how (typing or selected), where it is on screen and whether the page has unsaved changes is `editorState` (`editor/editor-state.js`); read it rather than following HAX's active block. Undo puts the caret back where it was (`editor/undo.js`); Undo of a change made through `ops.js` goes back to where the author was as they made it, and Redo to where it left them. Keys typed while a change is being made wait for it, and go where it leaves the caret.
- **Keep `#contentcontainer` in the theme's DOM** in every view: HAXcms puts its site editor there, and saves stop working without it. A full-page view (the course site) is drawn inside it with the frame hidden by a host attribute, never as a separate template.
- **Save through `saveOutline`** (`outline/outline-model.js`): it sends only what changed, keeps stored orders, and queues saves so two never overlap (HAXcms would undo the first).
- **Don't break HAX's managed files** or its editor; theme-level CSS goes in `theme/theme.css`, which HAX loads before `index.html`'s own styles.
- **Test on a scratch copy** of the site for anything that saves (port 3101 with `HAXCMS_DISABLE_JWT_CHECKS`), never on the real content. Stop scratch servers by port.
- **Build:** `cd custom && npx rollup -c`. The dev server reloads open pages when `custom/src` changes, so check nobody has unsaved work open.
- **Generated files** (`*.generated.js`) come from nu-hax scripts; change the script, not the file.

## Content types

The site's types (`types/content-types.js`, edited in Site → Content types) and how they're grouped for authors (`types/type-homes.js`):

- **Course materials:** Lesson, Lecture, Tutorial, Article, Resource.
- **Assessed work:** Exercise, Reflection, Project, Activity (a step in a project), Quiz, Rubric.
- **Courses and pathways:** Program (a degree, under Institution → Programs, listing the courses whose Degree programs link to it), Course (with its Campus and Degree programs: the same code at two campuses is two course pages; Degree programs links to program pages), Course site (switched on from its course, not added), Course sequence, Pathway, Unit, Book, Specialization.
- **Site structure:** Section; Heading (navigation labels, added in Edit navigation).

Add a type only when it needs its own fields or behaviour; a different genre with the same fields is a candidate for a "kind" instead (see the type consolidation sketch). A new type needs: its definition (fields, icon, description), a home page if it's listed (`HOME_TITLES`), a group (`TYPE_GROUPS`), and, if it's assessed, its place in sequences and the Canvas import (`lms/`).

## Checklist for new UI

- [ ] Uses the tokens; dark mode checked; contrast audit passes.
- [ ] shadcn component or pattern from this page; `formControls` added if it has fields.
- [ ] Lucide icons; icon-only buttons have labels.
- [ ] Works by keyboard; focus visible; Esc closes overlays.
- [ ] Copy in plain words; buttons say what they do; consequences stated.
- [ ] Readers and authors see the same thing (minus author tools); checked signed out or on the published copy.
- [ ] Anything that saves was tested on a scratch copy.
