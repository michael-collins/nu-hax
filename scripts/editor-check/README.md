# Editor checks

Automatic checks for editing the site, run in Chrome against a throwaway copy of it. Every check in the editor redesign (`docs/editor-redesign/`) runs here, and nothing it does reaches the real site.

## Running them

```sh
node scripts/editor-check/run.mjs                    # every check in checks/
node scripts/editor-check/run.mjs --only smoke       # just these (comma-separated)
```

| Option | What it does |
|---|---|
| `--only smoke,stopgaps` | Run only these checks (file names in `checks/` without `.mjs`). |
| `--port 3102` | Serve the copy on another port (default 3101). Port 3000, the dev server, is refused. Use a different port for each run you start side by side. |
| `--source head` | Copy the last commit of `learning-materials` instead of the working tree, for a run that mustn't see half-edited code. The default, `worktree`, includes uncommitted changes. |
| `--keep` | Keep the site copy afterwards, to look at what the checks saved. |
| `--update-baseline` | Let the smoke check rewrite the axe baseline (see below). |

Each run:

1. copies `learning-materials` into `WORK_DIR/<port>/site` with rsync (no `.git`; `custom/node_modules` is linked, not copied),
2. builds the theme inside the copy (`gen-lucide-icons.mjs`, then `npx rollup -c`), so the real `custom/build` that the dev server serves is untouched,
3. serves the copy with the same `haxcms-nodejs` app as `hax serve`, with `HAXCMS_DISABLE_JWT_CHECKS`, so the browser is signed in as an author,
4. runs the checks in headless Chrome (puppeteer-core and `/Applications/Google Chrome.app`), each in its own browser context (fresh storage), with reduced motion,
5. writes `report.json` and screenshots to `WORK_DIR/reports/<port>-<time>/`, prints a pass/fail table, and exits 1 if anything failed,
6. stops the server by its port, also after errors and Ctrl+C, and removes the copy unless `--keep`.

`WORK_DIR` is `EDITOR_CHECK_DIR` if set, otherwise `nu-hax-editor-check` in the system's temp folder. The server is the newest haxcms-nodejs that npx has cached (the one `hax serve` runs); `HAX_APP` and `CHROME_PATH` override the server and browser paths. The axe baseline is `axe-baseline.json` here, kept in git. A whole run of the smoke check takes about 20 seconds.

If a run was killed so hard it couldn't clean up, stop its server by port: `lsof -ti tcp:3101 -sTCP:LISTEN | xargs kill`. Never `pkill`: the dev server runs the same `app.js`.

## Writing a check

A check is `checks/<name>.mjs` exporting a default async function that gets a context and returns results:

```js
export default async function (ctx) {
  await ctx.open("/up/dart-413");
  await ctx.enterEdit();
  await ctx.clickAt("oer-cs-learn li");
  await ctx.type("Hello");
  const html = await ctx.normalizedHtml();
  return [{ name: "typing fills the outcome", pass: html.includes("<li>Hello</li>"), detail: html.slice(0, 120) }];
}
```

Name results by what a person would notice ("Save keeps the new tagline"), and put the evidence in `detail`. A check that throws fails as "runs without errors", with the message and the line it came from, and a screenshot named `error.png`. A check has five minutes.

### The context

The context is the editor helpers (`lib/editor.mjs`) for one page, plus:

- `page`, `browser`, `context`: puppeteer's, for anything the helpers don't cover.
- `newPage()`: another tab in the same browser context, with its own helpers.
- `axe(options)`: axe-core on the page (see below).
- `siteDir`, `reportDir`, `workDir`, `port`, `source`, `options.updateBaseline`, `log(...)`.

Helpers:

| Helper | |
|---|---|
| `open(path, { signedOut })` | Load a page and wait until the theme has drawn it and HAX's editor has loaded; then press Escape and close the command palette and HAX's preferences toast. `signedOut: true` opens it as a reader sees it. |
| `enterEdit()`, `exitEdit({ discard })`, `save()` | Through the visible Edit content, Cancel (or Exit) and Save buttons, falling back to the stock editor's own handlers. `enterEdit()` does nothing when already editing (the stock toggle would save). `exitEdit()` throws if it's asked to discard changes, leaving the dialog open to inspect; `exitEdit({ discard: true })` discards. `save()` waits for the save request and the reading view, and returns the HTTP status. |
| `clickAt(target)`, `type(text)`, `press("Mod+Z")` | Real mouse and keyboard input. `clickAt` takes a handle, a selector (searched through shadow roots) or `{x, y}`, scrolls the element into view, and throws if it has no size or something else is on top of it (`{ covered: true }` clicks anyway). `Mod` is Meta on Macs and Control elsewhere. |
| `deep(selector)`, `deepAll(selector)`, `control(name)` | Element handles through open shadow roots; `control` finds a visible button, link or menu item by accessible name (a string or a RegExp). |
| `deepActiveElement()`, `selection()`, `selectionText()` | Where focus and the selection really are, inside shadow roots. |
| `haxBodyHtml()`, `normalizedHtml(html?)`, `savedHtml(page)` | hax-body's HTML raw, or without what HAX adds while editing (`data-hax-*`, `contenteditable`, `draggable`, `role="textbox"`, `hax-*` classes); and a page's saved file in the copy, by id or address. |
| `liveRegions()`, `liveRegionText()` | What rendered live regions say now. |
| `setViewport(1440 \| 390 \| 320)`, `screenshot(name)` | Resize (no reload); save a screenshot in the check's report folder. |
| `state()`, `waitFor(fn, { what })`, `settle()`, `frames()`, `sleep(ms)` | The editor's state at a glance; waiting for a condition in the page (a timeout says what was awaited and the state then); waiting for animations and layout to stop. |

Inside `page.evaluate`, the same helpers are on `globalThis.__ec` (`__ec.deep()`, `__ec.store()`, `__ec.haxBody()`, `__ec.theme()`, `__ec.activeElement()`, `__ec.normalize()`…).

### Accessibility

`ctx.axe()` runs axe-core over the whole document, open shadow roots included, with the WCAG 2.2 A and AA rules. It returns `{ violations, nodes, counts, byImpact, rules }`. Options: `context` (an axe context; arrays of selectors reach into shadow roots, e.g. `{ include: [["custom-oer-docs-theme", "oer-course-site"]] }`), `tags`, and `forcedColors: true` to run with forced colours.

The smoke check records the counts for the reading and editing views of `/up/dart-413` and `/oer-courses` at 1440 in `axe-baseline.json` (kept in git) the first time it runs; later runs fail on a rule that's new or affects more nodes. After a change that's meant to alter them, run it with `--update-baseline`. Other checks can compare the same way with `readBaseline` and `newViolations` from `lib/axe.mjs`.

## Spikes

`spikes/` holds the redesign's throwaway experiments, each with its own runner that prints a JSON table of go/no-go results. They use `startScratch({ prepare })`, which runs after the copy is made and before it's built, to add spike blocks and pages to the copy only.

- `spikes/structure/run.mjs` (WP-01): nested item grids, manual slots and shadow controls. Results in `docs/editor-spikes/structure.md`.

## Rules

- Only ever the scratch copy: never save on `localhost:3000` or write to `learning-materials/pages` or `site.json`.
- One port per run, and stop servers by port.
- Temporary scripts that import puppeteer go in `scripts/.x-<name>.tmp.mjs` and are deleted when done.

## Things that trip up automation

- HAX's first-visit prompts (the preferences toast, and Merlin's getting-started palette, which opens over the page on entering edit mode and swallows the next click). The helpers start each page as a returning author's browser and close both if they show.
- The stock editor's hidden bar slides in about a second after it loads and moves the page; `open()` waits for it with `settle()`.
- Signing in finishes a second or two after the page appears; `open()` waits for HAX's editor, since clicking Edit content before it exists does nothing.
- An empty paragraph has no height, so it can't be clicked until a section gives it one; `clickAt` says so rather than clicking somewhere else.
- hax-body sits in a shadow root, so `document.getSelection()` reports `haxcms-site-builder` at offset 0 whatever is selected. Read the selection from the content's own root: `el.getRootNode().getSelection()` (as `selection()` and `caretIn` in the checks do).
- Keys typed in the content are sent to hax-body (the element being edited), not to the paragraph or section the caret is in, so a listener on a block never hears them.
- HAX's Undo puts back a copy of the whole content, so element handles taken before it point at removed elements; look them up again afterwards.
