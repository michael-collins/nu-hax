# Editor checks

Automatic checks for editing the site, run in Chrome (and on request Firefox and WebKit, Safari's engine) against a throwaway copy of it. Every check in the editor redesign (`docs/editor-redesign/`) runs here, and nothing it does reaches the real site.

## Running them

```sh
node scripts/editor-check/run.mjs                    # every check in checks/
node scripts/editor-check/run.mjs --only smoke       # just these (comma-separated)
node scripts/editor-check/run.mjs --only smoke --engines chrome,firefox,webkit   # in each engine
```

| Option | What it does |
|---|---|
| `--only smoke,stopgaps` | Run only these checks (file names in `checks/` without `.mjs`). |
| `--engines chrome,firefox,webkit` | Run every check once in each of these engines (default `chrome`). See [Engines](#engines). |
| `--port 3102` | Serve the copy on another port (default 3101). Port 3000, the dev server, is refused. Use a different port for each run you start side by side. |
| `--source head` | Copy the last commit of `learning-materials` instead of the working tree, for a run that mustn't see half-edited code. The default, `worktree`, includes uncommitted changes. |
| `--keep` | Keep the site copy afterwards, to look at what the checks saved (with several engines, the last one's). |
| `--update-baseline` | Let the smoke check rewrite the axe baseline (see below). |

Each run, for each engine in turn:

1. copies `learning-materials` into `WORK_DIR/<port>/site` with rsync (no `.git`; `custom/node_modules` is linked, not copied), fresh for each engine, since checks save to it and expect the site as it was copied,
2. builds the theme inside the copy (`gen-lucide-icons.mjs`, then `npx rollup -c`), so the real `custom/build` that the dev server serves is untouched,
3. serves the copy with the same `haxcms-nodejs` app as `hax serve`, with `HAXCMS_DISABLE_JWT_CHECKS`, so the browser is signed in as an author,
4. runs the checks in the headless browser, each in its own browser context (fresh storage), with reduced motion,
5. stops the server by its port, also after errors and Ctrl+C, and removes the copy unless `--keep`;

then writes `report.json` (every result with its engine, and each browser's version) and screenshots to `WORK_DIR/reports/<port>-<time>/<engine>/<check>/`, prints a pass/fail/skip table with an Engine column, and exits 1 if anything failed. A copy, build and server take about 5 seconds per engine.

`EDITOR_CHECK_SITE` points it at another checkout of the site (a git worktree on a branch) instead of `learning-materials`. `WORK_DIR` is `EDITOR_CHECK_DIR` if set, otherwise `nu-hax-editor-check` in the system's temp folder. The server is the newest haxcms-nodejs that npx has cached (the one `hax serve` runs); `HAX_APP` and `CHROME_PATH` override the server and Chrome's paths, and `PLAYWRIGHT_BROWSERS_PATH` where Firefox and WebKit are looked for. The axe baselines are `axe-baseline.json` (Chrome) and `axe-baseline.<engine>.json` here, kept in git. A run of the smoke check takes about 20 seconds in Chrome and WebKit and 30 in Firefox.

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

- `page`, `browser`, `context`: puppeteer's (in Firefox and WebKit, the adapter's look-alikes), for anything the helpers don't cover.
- `engine` (`"chrome"`, `"firefox"` or `"webkit"`), `supports` (what the engine can do) and `skip(name, why)` (a result shown as SKIP): see [Engine-aware checks](#engine-aware-checks).
- `newPage()`: another tab in the same browser context, with its own helpers.
- `axe(options)`: axe-core on the page (see below).
- `siteDir`, `reportDir`, `workDir`, `port`, `source`, `options.updateBaseline`, `log(...)`.

Helpers:

| Helper | |
|---|---|
| `open(path, { signedOut })` | Load a page and wait until the theme has drawn it and HAX's editor has loaded; then press Escape and close the command palette and HAX's preferences toast. `signedOut: true` opens it as a reader sees it. |
| `enterEdit()`, `exitEdit({ discard })`, `save()` | Through the visible Edit content, Cancel (or Exit) and Save buttons, falling back to the stock editor's own handlers. `enterEdit()` does nothing when already editing (the stock toggle would save). `exitEdit()` throws if it's asked to discard changes, leaving the dialog open to inspect; `exitEdit({ discard: true })` discards. `save()` waits for the save request and the reading view, and returns the HTTP status. |
| `clickAt(target)`, `type(text)`, `press("Mod+Z")` | Real mouse and keyboard input. `clickAt` takes a handle, a selector (searched through shadow roots) or `{x, y}`, scrolls the element into view, and throws if it has no size or something else is on top of it (`{ covered: true }` clicks anyway). `Mod` is Meta (Command) on Macs in every engine, as a Mac user presses it, and Control elsewhere; `Control+…` is always Control. |
| `deep(selector)`, `deepAll(selector)`, `control(name)` | Element handles through open shadow roots; `control` finds a visible button, link or menu item by accessible name (a string or a RegExp). |
| `deepActiveElement()`, `selection()`, `selectionText()` | Where focus and the selection really are, inside shadow roots, in any engine. |
| `haxBodyHtml()`, `normalizedHtml(html?)`, `savedHtml(page)` | hax-body's HTML raw, or without what HAX adds while editing (`data-hax-*`, `contenteditable`, `draggable`, `role="textbox"`, `hax-*` classes); and a page's saved file in the copy, by id or address. |
| `liveRegions()`, `liveRegionText()` | What rendered live regions say now. |
| `setViewport(1440 \| 390 \| 320)`, `screenshot(name)` | Resize (no reload); save a screenshot in the check's report folder. |
| `state()`, `waitFor(fn, { what })`, `settle()`, `frames()`, `sleep(ms)` | The editor's state at a glance; waiting for a condition in the page (a timeout says what was awaited and the state then); waiting for animations and layout to stop. |

Inside `page.evaluate`, the same helpers are on `globalThis.__ec` (`__ec.deep()`, `__ec.store()`, `__ec.haxBody()`, `__ec.theme()`, `__ec.activeElement()`, `__ec.normalize()`…), with two for the selection that work in every engine: `__ec.selectionNodes(node?)` reads it (`{ anchorNode, anchorOffset, focusNode, focusOffset, collapsed, text }` inside the shadow root that holds `node`, the focused element by default) and `__ec.select(anchorNode, anchorOffset, focusNode?, focusOffset?)` sets it.

### Accessibility

`ctx.axe()` runs axe-core over the whole document, open shadow roots included, with the WCAG 2.2 A and AA rules, in any engine. It returns `{ violations, nodes, counts, byImpact, rules }`. Options: `context` (an axe context; arrays of selectors reach into shadow roots, e.g. `{ include: [["custom-oer-docs-theme", "oer-course-site"]] }`), `tags`, and `forcedColors: true` to run with forced colours (all three engines emulate them).

The smoke check records the counts for the reading and editing views of `/up/dart-413` and `/oer-courses` at 1440 in `axe-baseline.json` (kept in git) the first time it runs in Chrome, and in `axe-baseline.firefox.json` and `axe-baseline.webkit.json` the first time in those, since each engine's accessibility tree differs a little; later runs fail on a rule that's new or affects more nodes. After a change that's meant to alter them, run it with `--update-baseline` (and the engines to update). A rule that comes and goes between runs (in Firefox and WebKit, HAX sometimes hasn't selected the first block, whose unnamed `role="textbox"` is `aria-input-field-name`) is recorded at the highest count seen. Other checks can compare the same way with `readBaseline`, `baselineFile(ctx.engine)` and `newViolations` from `lib/axe.mjs`.

## Engines

| Engine | Browser | Driven by |
|---|---|---|
| `chrome` (default) | The system's Google Chrome, headless | puppeteer-core, as the checks were written for |
| `firefox` | Playwright's Firefox 137 build (`firefox-1482`) | playwright-core 1.52.0, through the adapter |
| `webkit` | Playwright's WebKit 18.4 build (`webkit-2158`), Safari's engine | playwright-core 1.52.0, through the adapter |

Firefox and WebKit are the builds cached in `~/Library/Caches/ms-playwright` for exactly the playwright-core in `package.json` (each playwright-core release pins its own builds; 1.52.0 is the one that matches these). Nothing downloads them: if one is missing, that engine's row says so and the run goes on with the others. Moving to a newer playwright-core means downloading its builds (`npx playwright install firefox webkit`) and re-recording the Firefox and WebKit axe baselines. Chrome doesn't need playwright-core at all.

The browsers start headless, over pipes rather than debugging ports. Each check gets a fresh browser context in every engine.

### The adapter

`lib/engines.mjs` gives Playwright's pages the part of puppeteer's API the checks, helpers and spikes use, so a check runs unchanged in all three:

- `evaluate`, `evaluateHandle`, `waitForFunction(fn, options, ...args)` and handles' `evaluate`, with puppeteer's spread arguments (Playwright takes one), handles as arguments, and `TimeoutError`s by that name;
- handles: `asElement`, `getProperties`, `getProperty`, `jsonValue`, `dispose`, `boundingBox`, `click`, `hover`, `focus`, `type`, `press`, `screenshot`, `scrollIntoView`, `$`, `$$`, `$eval`, `$$eval`, `uploadFile`, `select`;
- the page: `$`, `$$`, `$eval`, `$$eval` and `waitForSelector` (by `querySelector`, as puppeteer's, not through shadow roots as Playwright's own), `goto`, `reload`, `waitForResponse`, `waitForRequest`, `waitForNavigation`, `setViewport`, `evaluateOnNewDocument`, `emulateMediaFeatures` (reduced motion, colour scheme, forced colours and contrast; each call replaces the last, as puppeteer's), `screenshot`, `setCookie`, `cookies`, `deleteCookie`, `accessibility.snapshot` (each engine's own tree), `close`;
- `mouse` (`click` with puppeteer's `count`, `move`, `down`, `up`, `wheel`) and `keyboard` (`press`, `down`, `up`, `type` with a delay, `sendCharacter`);
- events: `dialog`, `pageerror`, `console` (with puppeteer's `"warn"` for Playwright's `"warning"`), `request`, `response`, `popup` and the rest by name;
- request interception: `setRequestInterception(true)` and `request.continue()`, `respond()`, `abort()`, `isInterceptResolutionHandled()`, by a Playwright route; a request no listener resolves waits, as in puppeteer;
- contexts: `newPage`, `pages`, `waitForTarget` (polls the context's tabs), `close`; the browser: `createBrowserContext`, `newPage`, `version` (`Firefox/137.0`, `WebKit/18.4`), `close`.

`page.playwright` is the Playwright page itself, for what the adapter doesn't cover; `page.playwright` being there is also how library code tells the engines apart (`lib/axe.mjs` does).

Its limits:

- Chrome's DevTools protocol isn't there: `page.createCDPSession()` and `page.target()` throw an error with `skipped: true` ("skipped in webkit: …"), and so do touch input, `removeScriptToEvaluateOnNewDocument` and `setViewport` with a scale, mobile or touch. So IME composition (`Input.imeSetComposition`) and the DevTools accessibility tree are Chrome's only.
- `keyboard.press(key, { commands })`: Chrome runs the editing commands; in Firefox and WebKit the adapter presses each one's Mac shortcut instead (undo, redo, cut, copy, paste, selectAll only; others throw a skip). Firefox and WebKit run a Mac's shortcuts themselves, so `Meta+Z` undoes there, which headless Chrome doesn't do.
- `browser.process()` is null, `contentFrame()` and `frames()` give Playwright's frames, and a request's `response()` isn't there.
- Firefox reports its own warnings ("JavaScript Warning: …") as console warnings; filter console messages by their text.
- String expressions given to `evaluate` run through the page's `eval` in Firefox and WebKit, so a page whose CSP forbids `unsafe-eval` would refuse them (the site has no CSP).
- Screenshots leave the caret as it is, as puppeteer's do. Playwright's own default hides it by setting `caret-color` on every contenteditable and leaves `style=""` on each afterwards, which changes the content under test: `style=""` turns up in hax-body's HTML, and an undo step kept `caret-color: transparent`.

### Engine-aware checks

A check gets `ctx.engine` and `ctx.supports`, which says what the engine can do: `cdp` (DevTools sessions), `ime`, `forcedColors` (every engine) and `editingCommands` (`keyboard.press` with `commands` runs Chrome's own). Something only one engine can do is a skipped result, not a failure:

```js
if (ctx.supports.ime) results.push(await typeKana());
else results.push(ctx.skip("Typing kana through an IME keeps the composition", "no IME input outside Chrome"));
```

A check that calls a Chrome-only API anyway stops there, and its row is SKIP "runs without errors" with the reason, but the results it gathered before are lost; a `part()` wrapper that catches errors should record `ctx.skip(name, e.message)` when `e.skipped`. In the page:

- Read the selection with `__ec.selectionNodes()` and set it with `__ec.select()`, not `el.getRootNode().getSelection()`, which only Chrome has. Firefox's `document.getSelection()` holds the nodes inside shadow roots, WebKit's stops at the outermost shadow host, and WebKit ignores `addRange()` with a range inside a shadow root (`setBaseAndExtent` and `collapse` work in all three).
- Firefox gives a synthetic `ClipboardEvent`'s data to no one (`getData()` reads `""`), so a paste there is a real ⌘C and ⌘V (`spikes/lifecycle/run.mjs` copies from a temporary element outside the editor). Firefox's headless clipboard is its own, not the system's. Chrome and WebKit read a synthetic one's `DataTransfer`.
- Playwright's WebKit goes back a page on Backspace when the caret isn't in editable content, and puts no caret in an empty paragraph that has no box: check that the selection is in the content before pressing Backspace there.
- WebKit, like Safari on a Mac, doesn't focus a button that's clicked, so focus that should go back to "the button that opened it" has nowhere to go after a mouse click, unless the code takes the button from the click event (the leave dialog does on the site's `hotfix-webkit` branch); otherwise reach the button with the keyboard to check that.
- On a Mac, Home and End scroll the page in Firefox and WebKit, as they do in Firefox and Safari there, rather than moving the caret (headless Chrome moves it). Put the caret at the start or end of a block with `__ec.select(el, 0)` or `__ec.select(el, el.childNodes.length)`. ⌘← and ⌘→ move it in Firefox, but in WebKit, like any arrow key, they take the caret out of the content.
- Compare axe with `baselineFile(ctx.engine)`, not `axe-baseline.json` by name.
- A check that starts a browser of its own (for scrollbars, say) should start the same engine with `launch(ctx.engine, options)` from `lib/engines.mjs` (the options go to puppeteer's or Playwright's own launch), or say it measures Chrome only.

## The hotfix check

`checks/hotfix.mjs` covers the fixes for Safari and Firefox on the site's `hotfix-webkit` branch; run it with `EDITOR_CHECK_SITE` pointing at that checkout, in all three engines. It checks the shared selection helper (`custom/src/ui/edit-selection.js`) where the site reads or places the caret (typing boxes, the course site's edge guard, a section's heading, the block list, the rail, citations, the small text editor); HAX's selection in WebKit (arrow keys and Backspace keep the caret and HAX's active block in the content), and HAX's own selection in Firefox 142 and later, which have `getComposedRanges` too (emulated in Playwright's Firefox 137, which hasn't); Cancel straight after Edit content, and after an arrow key has reached the page-break; ⌘Z, ⌘⇧Z and the browser's own Undo going to HAX's undo, with the caret back in the text afterwards (typing goes on there, and `haxToContent` still works, so Save does); focus back on Cancel after a mouse click, and on the text after the leave shortcut; Duplicate from the rail by keyboard, and Remove block on a section's only paragraph; the content's input guards (`custom/src/editor/content-guards.js`): Select All, or a selection across sections, then Backspace, typing or Cut; Enter twice then Backspace, Delete in an empty question, and Safari's Ctrl+D, Ctrl+K and Ctrl+H at a section's edges; joining a paragraph to a differently styled one with Backspace or Delete (Safari's engine copied the theme into the page); typing after an arrow key left the caret before the page-break; letters typed straight after Enter; a list, a quote and columns from the block list taking typing; the placeholder art's grid, by its pixels (the page decodes its screenshots on a canvas); and pastes: once, between the halves of the paragraph they're pasted into (HTML, Markdown, plain text, an address), over a triple-clicked paragraph, and after Select All (the page goes on answering). Select All in a lesson differs by engine: Firefox's ⌘A takes in the page-break, so Backspace (or a paste) does nothing; Safari's engine starts the selection after it, and so does Chrome (which moves the selection the check makes over the whole of hax-body there), so Backspace deletes the rest of the page and a paste replaces it, leaving the page-break. It doesn't save. Against the site's main branch most of its WebKit results and some of Firefox's fail.

## Spikes

`spikes/` holds the redesign's throwaway experiments, each with its own runner that prints a table of go/no-go results. They use `startScratch({ prepare })`, which runs after the copy is made and before it's built, to add spike blocks and pages to the copy only.

- `spikes/structure/run.mjs` (WP-01): nested item grids, manual slots, shadow controls and the selection, in Chrome and with `--engines firefox,webkit` in those too (one copy for all, which the spike never saves to), plus the same caret checks on a bare page without HAX (`--only bare`). `--evidence` copies Chrome's results and screenshots to the folder given and the others' to a folder per engine in it. Results in `docs/editor-spikes/structure.md`.
- `spikes/lifecycle/run.mjs` (WP-02): the deletion guard, undo, saving and recovery prototypes, in Chrome and with `--engines firefox,webkit` in those too (a fresh copy each). Results in `docs/editor-spikes/lifecycle.md`.

## Rules

- Only ever the scratch copy: never save on `localhost:3000` or write to `learning-materials/pages` or `site.json`.
- One port per run, and stop servers by port.
- Temporary scripts that import puppeteer or playwright-core go in `scripts/.x-<name>.tmp.mjs` and are deleted when done.

## Things that trip up automation

- HAX's first-visit prompts (the preferences toast, and Merlin's getting-started palette, which opens over the page on entering edit mode and swallows the next click). The helpers start each page as a returning author's browser and close both if they show.
- The stock editor's hidden bar slides in about a second after it loads and moves the page; `open()` waits for it with `settle()`.
- Signing in finishes a second or two after the page appears; `open()` waits for HAX's editor, since clicking Edit content before it exists does nothing.
- An empty paragraph has no height, so it can't be clicked until a section gives it one; `clickAt` says so rather than clicking somewhere else.
- hax-body sits in a shadow root, so in Chrome and WebKit `document.getSelection()` reports a host at offset 0 whatever is selected. Read the selection with `__ec.selectionNodes()` (what `selection()` uses), which reads it from the content's own root in Chrome (`el.getRootNode().getSelection()`), and in WebKit from its composed range.
- In Firefox and WebKit, Cancel asks to discard changes nobody made (fixed on the site's `hotfix-webkit` branch). HAX takes its "unchanged" copy of the page on a 100 ms timer started as edit mode starts, and imports the page into hax-body on a timer started a few hundred milliseconds later, once edit mode's own work is done; by then both are due, and Firefox and WebKit run the copy's first, so the copy is empty (Chrome happens to run the import first). The first block may not be selected there either. The smoke check reports it as a failure of its own, and stopgaps answers the question so the parts after it start clean.
- Keys typed in the content are sent to hax-body (the element being edited), not to the paragraph or section the caret is in, so a listener on a block never hears them.
- In WebKit any arrow key in the content takes the caret out of it (fixed on the site's `hotfix-webkit` branch): hax-body's arrow-key handler reads the caret with `HAXStore.getRange()`, which gets the theme's shadow host there, and makes `haxcms-site-builder` the active node (focus goes to `<body>`, hax-body stops being editable). Click back into the content. The lifecycle spike's prototypes fix it for WP-04 (`docs/editor-spikes/lifecycle.md`).
- HAX's Undo puts back a copy of the whole content, so element handles taken before it point at removed elements; look them up again afterwards.
- WebKit fails much of stopgaps because the site's own code and HAX's read the selection from the document, which stops at the outermost shadow host there, and put the caret with `addRange()`, which WebKit ignores inside a shadow root. So in WebKit typing into an empty section's box, a new block from the block list and the way back from the rail find no caret; Backspace and Delete at a section's edge get past the course site's guard (an empty section can go) and, like arrow keys, can make `haxcms-site-builder` the active block and `contenteditable`, after which HAX's shortcuts take every key for typing; and an arrow key makes HAX import the saved page again, losing what was typed. These are the site's failures, not the harness's, and the site's `hotfix-webkit` branch fixes them.
