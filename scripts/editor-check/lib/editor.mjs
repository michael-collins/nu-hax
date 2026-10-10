// Helpers for driving the site's editor in Chrome: opening pages, entering,
// leaving and saving edit mode, reading what's in hax-body and on disk, and
// real mouse and keyboard input. Queries go through open shadow roots,
// since the theme, HAX and our blocks all draw in them.
//
//   const ed = editor(page, { base, siteDir, reportDir });
//   await ed.open("/up/dart-413");
//   await ed.enterEdit();
//   await ed.clickAt("oer-cs-learn li");
//   await ed.type("Hello");
//   await ed.save();
import { readFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const VIEWPORTS = { 1440: 900, 390: 844, 320: 568 };
const MOD = process.platform === "darwin" ? "Meta" : "Control";

// Installed in every page as globalThis.__ec, so checks can use it inside
// page.evaluate(() => __ec.deep("…")) too.
function pageHelpers() {
  const walk = (root, fn) => {
    for (const el of root.querySelectorAll("*")) {
      if (fn(el) === false) return false;
      if (el.shadowRoot && walk(el.shadowRoot, fn) === false) return false;
    }
  };
  const ec = {
    /** Every element matching the selector, in the document and open shadow roots. */
    all(selector, root = document) {
      const found = [];
      walk(root, (el) => {
        if (el.matches(selector)) found.push(el);
      });
      return found;
    },
    /** The first element matching the selector, through open shadow roots. */
    deep(selector, root = document) {
      let found = null;
      walk(root, (el) => {
        if (el.matches(selector)) {
          found = el;
          return false;
        }
      });
      return found;
    },
    visible(el) {
      if (!el?.isConnected) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
    },
    /** An element's accessible name, roughly: aria-label, labelledby, then its text. */
    name(el) {
      const label = el.getAttribute("aria-label");
      if (label) return label.trim();
      const by = el.getAttribute("aria-labelledby");
      if (by) {
        const root = el.getRootNode();
        const text = by.split(/\s+/).map((id) => root.getElementById?.(id)?.textContent || "").join(" ");
        if (text.trim()) return text.replace(/\s+/g, " ").trim();
      }
      return (el.textContent || el.getAttribute("title") || "").replace(/\s+/g, " ").trim();
    },
    /** The first visible control whose name matches (a string, case-insensitive, or a RegExp source). */
    control(match, root = document) {
      const test = typeof match === "string" ? (n) => n.toLowerCase() === match.toLowerCase() : (n) => new RegExp(match.source, match.flags).test(n);
      return ec.all("button, [role=button], [role=menuitem], a[href]", root).find((el) => ec.visible(el) && test(ec.name(el))) || null;
    },
    /** Focus as the person sees it: the active element inside the innermost shadow root. */
    activeElement() {
      let el = document.activeElement;
      while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
      return el;
    },
    describe(el) {
      if (!el) return null;
      const hosts = [];
      for (let n = el; n; n = n.getRootNode().host) hosts.unshift(n.localName);
      return {
        tag: el.localName,
        id: el.id || null,
        name: el === document.body || el === document.documentElement ? "" : ec.name(el).slice(0, 120),
        path: hosts.join(" › "),
      };
    },
    /**
     * The selection, read from the shadow root that holds the focused
     * element (Chrome's ShadowRoot.getSelection), where hax-body's text is.
     */
    selection() {
      const root = ec.activeElement()?.getRootNode() ?? document;
      const sel = root.getSelection?.() || document.getSelection();
      const node = (n) => (n ? ec.describe(n.nodeType === 1 ? n : n.parentElement) : null);
      return {
        text: sel ? sel.toString() : "",
        collapsed: sel ? sel.isCollapsed : true,
        anchor: node(sel?.anchorNode),
        anchorOffset: sel?.anchorOffset ?? null,
        focus: node(sel?.focusNode),
        focusOffset: sel?.focusOffset ?? null,
      };
    },
    store: () => globalThis.HAXCMS?.requestAvailability?.()?.store ?? null,
    haxStore: () => globalThis.HaxStore?.requestAvailability?.() ?? null,
    haxBody: () => ec.haxStore()?.activeHaxBody ?? null,
    theme: () => document.querySelector("custom-oer-docs-theme"),
    /**
     * HTML without what HAX adds while editing: data-hax-* attributes,
     * contenteditable, draggable, role="textbox" and hax-* classes.
     */
    normalize(html) {
      const t = document.createElement("template");
      t.innerHTML = html;
      for (const el of t.content.querySelectorAll("*")) {
        for (const a of [...el.attributes]) {
          if (a.name.startsWith("data-hax-") || a.name === "contenteditable" || a.name === "draggable") el.removeAttribute(a.name);
        }
        if (el.getAttribute("role") === "textbox") el.removeAttribute("role");
        if (el.hasAttribute("class")) {
          const kept = [...el.classList].filter((c) => !c.startsWith("hax-"));
          if (kept.length) el.setAttribute("class", kept.join(" "));
          else el.removeAttribute("class");
        }
      }
      return t.innerHTML.trim();
    },
    /**
     * True once nothing has moved for ms: no running animation or
     * transition (endless ones aside) and the same layout of the theme and
     * the page's blocks. Polled by settle().
     */
    quiet(token, ms) {
      const theme = ec.theme();
      const main = theme?.shadowRoot?.querySelector("main");
      const blocks = [theme, main, ...(theme?.children || []), ...(ec.haxBody()?.children || [])].slice(0, 40);
      const sig = [
        scrollX,
        scrollY,
        main?.scrollTop,
        main?.scrollHeight,
        ...blocks.map((el) => {
          const r = el?.getBoundingClientRect();
          return r ? `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)},${Math.round(r.height)}` : "";
        }),
      ].join(";");
      const busy = document.getAnimations().some((a) => a.playState === "running" && a.effect?.getComputedTiming().iterations !== Infinity);
      const now = performance.now();
      const state = (ec.__quiet ??= {});
      if (busy || state.token !== token || state.sig !== sig) {
        Object.assign(state, { token, sig, since: now });
        return false;
      }
      return now - state.since >= ms;
    },
    /** The dialog that's open now: a native dialog, or HAX's confirm dialog in its modal. */
    openDialog() {
      return ec.all("dialog[open], hax-confirm-dialog").find((d) => ec.visible(d)) || null;
    },
    /** The element under a point, looking into shadow roots. */
    elementAt(x, y) {
      let el = document.elementFromPoint(x, y);
      for (let inner = el?.shadowRoot?.elementFromPoint(x, y); inner && inner !== el; inner = el.shadowRoot?.elementFromPoint(x, y)) el = inner;
      return el;
    },
    /** Whether node is el or inside it, across shadow boundaries. */
    within(node, el) {
      for (let n = node; n; n = n.parentElement || n.getRootNode().host) if (n === el) return true;
      return false;
    },
    /** Live regions (aria-live, status, alert, log) that are rendered, and what they say now. */
    liveRegions() {
      return ec
        .all("[aria-live], [role=status], [role=alert], [role=log]")
        .filter((el) => el.checkVisibility({ checkVisibilityCSS: true }))
        .map((el) => ({
          live: el.getAttribute("aria-live") || (el.getAttribute("role") === "alert" ? "assertive" : "polite"),
          text: (el.textContent || "").replace(/\s+/g, " ").trim(),
          where: ec.describe(el).path,
        }))
        .filter((r) => r.live !== "off");
    },
  };
  globalThis.__ec = ec;
}

/**
 * Editor helpers bound to a page. siteDir is the scratch copy (for
 * savedHtml), reportDir where screenshots go.
 */
export function editor(page, { base, siteDir, reportDir }) {
  const ready = Promise.all([
    page.evaluateOnNewDocument(pageHelpers).then(() => page.evaluate(pageHelpers)),
    // A new browser gets HAX's first-visit prompts: the preferences toast
    // and Merlin's getting-started palette, which opens over the page and
    // takes the next click. Start as a returning author whose browser has
    // seen both (open() and enterEdit() still close them if they show).
    page.evaluateOnNewDocument(() => {
      try {
        localStorage.setItem("haxConfirm", "true");
        const memory = JSON.parse(localStorage.getItem("user-scaffold-ltMemory") || "{}") || {};
        localStorage.setItem("user-scaffold-ltMemory", JSON.stringify({ ...memory, hasSeenHaxWelcome: true }));
      } catch {}
    }),
  ]);
  // open() awaits it; a page closed before then mustn't crash the run
  ready.catch(() => {});
  // signed out: answer the session requests that sign the browser in
  // with 401, for as long as the page is meant to be signed out
  let refusing = null;
  async function refuseSessions(on) {
    if (!!refusing === on) return;
    if (on) {
      refusing = (req) => {
        if (req.isInterceptResolutionHandled()) return;
        if (req.url().includes("/system/api/v1/session/")) req.respond({ status: 401, contentType: "application/json", body: "{}" });
        else req.continue();
      };
      await page.setRequestInterception(true);
      page.on("request", refusing);
    } else {
      page.off("request", refusing);
      refusing = null;
      await page.setRequestInterception(false);
    }
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const frames = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const editMode = () => page.evaluate(() => !!__ec.store()?.editMode);

  const ed = {
    page,
    base,
    siteDir,
    reportDir,
    sleep,
    frames,
    editMode,

    /** Wait until animations end and the layout stops moving for quietMs. */
    async settle({ quietMs = 200, timeout = 10000 } = {}) {
      const token = Math.random();
      await ed.waitFor((token, ms) => __ec.quiet(token, ms), { timeout, args: [token, quietMs], what: "the page to stop moving" });
    },

    /**
     * Wait until fn (run in the page) returns something truthy, and return
     * it. On a timeout the error says what was awaited (what) and the
     * editor's state then.
     */
    async waitFor(fn, { timeout = 15000, polling = 50, args = [], what = "the page" } = {}) {
      try {
        const handle = await page.waitForFunction(fn, { timeout, polling }, ...args);
        return await handle.jsonValue();
      } catch (e) {
        if (e.name !== "TimeoutError") throw e;
        throw new Error(`Waited ${timeout / 1000} s for ${what}; state then: ${JSON.stringify(await ed.state().catch(() => null))}`);
      }
    },

    /** A snapshot of where the editor is, for error messages and logs. */
    state() {
      return page.evaluate(() => {
        const store = __ec.store();
        const daemon = globalThis.SuperDaemonManager?.requestAvailability?.();
        return {
          url: location.pathname,
          page: store?.activeItem?.slug ?? null,
          signedIn: !!store?.isLoggedIn,
          editMode: !!store?.editMode,
          haxBodyEditing: !!__ec.haxBody()?.editMode,
          haxBodyBlocks: __ec.haxBody()?.children.length ?? null,
          stockEditor: !!store?.cmsSiteEditor?.haxCmsSiteEditorUIElement,
          palette: !!daemon?.opened,
          dialog: __ec.openDialog() ? __ec.describe(__ec.openDialog()).path : null,
          focus: __ec.describe(__ec.activeElement())?.path ?? null,
        };
      });
    },

    /**
     * Open a page of the scratch site and wait for the theme to draw it: the
     * loading screen gone, the page's content in, and (signed in, which the
     * scratch server makes everyone) HAX's editor loaded. Then press Escape
     * and close the command palette and HAX's preferences toast, so each
     * check starts clean. signedOut: true opens it as a reader sees it, by
     * refusing the session requests that sign the browser in.
     */
    async open(pagePath = "/", { signedOut = false, timeout = 30000 } = {}) {
      await ready;
      await refuseSessions(signedOut);
      await page.goto(new URL(pagePath, base).href, { waitUntil: "load", timeout });
      const slug = decodeURIComponent(new URL(pagePath, base).pathname).replace(/^\/+|\/+$/g, "");
      await ed.waitFor(
        (slug, author) => {
          const store = __ec.store();
          const loading = document.getElementById("loading");
          // the theme holds HAX's loading screen until it has built its page
          const loaded = !loading || loading.classList.contains("oer-gone") || (loading.hidden && !document.documentElement.dataset.oerLoader);
          return (
            store?.appReady &&
            (!slug || store.activeItem?.slug === slug) &&
            __ec.theme()?.shadowRoot?.querySelector("main") &&
            loaded &&
            (!author || (store.isLoggedIn && store.cmsSiteEditor?.haxCmsSiteEditorUIElement && __ec.haxStore()))
          );
        },
        { timeout, args: [slug, !signedOut], what: `${pagePath} to load${signedOut ? "" : " for an author"}` },
      );
      // the stock editor's bar slides in once it loads, moving the page
      await ed.settle();
      await page.keyboard.press("Escape");
      await ed.closePalette();
      await ed.dismissPreferencesToast();
      await ed.settle();
    },

    /** Close the command palette (HAX's SuperDaemon, Merlin) if it's open. */
    closePalette() {
      return page.evaluate(() => {
        const daemon = globalThis.SuperDaemonManager?.requestAvailability?.();
        if (daemon?.opened) daemon.close();
      });
    },

    /** Close HAX's "keeps preferences" toast with its own button, if it's showing. */
    async dismissPreferencesToast() {
      const button = await page.evaluateHandle(() => {
        const toast = __ec.deep("oer-toast");
        const item = toast && [...toast.shadowRoot.querySelectorAll("*")].find((el) => /keeps preferences/.test(el.textContent) && el.querySelector("button"));
        return item ? [...item.querySelectorAll("button")].pop() : null;
      });
      if (button.asElement()) await ed.clickAt(button);
      else await button.dispose();
    },

    /** The first element matching a selector, through shadow roots, as a handle (or null). */
    async deep(selector) {
      const handle = await page.evaluateHandle((s) => __ec.deep(s), selector);
      return handle.asElement() || (await handle.dispose(), null);
    },

    async deepAll(selector) {
      const list = await page.evaluateHandle((s) => __ec.all(s), selector);
      const props = await list.getProperties();
      await list.dispose();
      return [...props.values()].map((h) => h.asElement()).filter(Boolean);
    },

    /** A visible button, link or menu item by its accessible name (string or RegExp), or null. */
    async control(match) {
      const m = match instanceof RegExp ? { source: match.source, flags: match.flags } : match;
      const handle = await page.evaluateHandle((m) => __ec.control(m), m);
      return handle.asElement() || (await handle.dispose(), null);
    },

    /** Where focus is: tag, id, accessible name and the chain of shadow hosts. */
    deepActiveElement() {
      return page.evaluate(() => __ec.describe(__ec.activeElement()));
    },

    selection() {
      return page.evaluate(() => __ec.selection());
    },

    async selectionText() {
      return (await ed.selection()).text;
    },

    /** hax-body's HTML as it is now, HAX's editing attributes and all. */
    haxBodyHtml() {
      return page.evaluate(() => __ec.haxBody()?.innerHTML ?? null);
    },

    /** hax-body's HTML (or the HTML given) without HAX's editing attributes. */
    normalizedHtml(html) {
      return page.evaluate((html) => __ec.normalize(html ?? __ec.haxBody()?.innerHTML ?? ""), html ?? null);
    },

    /** A page's saved HTML from the copy's pages/<id>/index.html; takes its id or address. */
    savedHtml(pageId) {
      let id = pageId;
      if (!/^item-/.test(id)) {
        const items = JSON.parse(readFileSync(path.join(siteDir, "site.json"), "utf8")).items;
        const item = items.find((i) => i.slug === String(pageId).replace(/^\/+|\/+$/g, ""));
        if (!item) throw new Error(`No page at ${pageId} in the copy's site.json`);
        id = item.id;
      }
      return readFileSync(path.join(siteDir, "pages", id, "index.html"), "utf8");
    },

    liveRegions() {
      return page.evaluate(() => __ec.liveRegions());
    },

    /** What the live regions say now, joined. */
    async liveRegionText() {
      return (await ed.liveRegions())
        .map((r) => r.text)
        .filter(Boolean)
        .join(" | ");
    },

    /** 1440 (desktop), 390 (phone) or 320 (small phone) wide; a resize, not a reload. */
    async setViewport(width) {
      const height = VIEWPORTS[width];
      if (!height) throw new Error(`setViewport takes 1440, 390 or 320, not ${width}`);
      await page.setViewport({ width, height });
      await frames();
    },

    /** Save a screenshot of the viewport in the run's report folder; returns its path. */
    async screenshot(name, options = {}) {
      mkdirSync(reportDir, { recursive: true });
      const file = path.join(reportDir, `${name.replace(/[^\w.-]+/g, "-")}.png`);
      await page.screenshot({ path: file, ...options });
      return file;
    },

    /**
     * Click with the mouse at the centre of an element (a handle or a deep
     * selector) or at {x, y}, scrolling it into view first if it's outside.
     * Throws when something else is on top of the element there, as a person
     * would hit that instead; covered: true clicks anyway.
     */
    async clickAt(target, { button = "left", clickCount = 1, covered = false } = {}) {
      const { x, y } = await ed.centre(target, { covered });
      // puppeteer takes the number of clicks as count (its own clickCount is the
      // detail of a single click)
      await page.mouse.click(x, y, { button, count: clickCount });
    },

    /** The point clickAt() would click, checked as it describes. */
    async centre(target, { covered = false } = {}) {
      if (typeof target?.x === "number" && typeof target?.y === "number") return target;
      const el = typeof target === "string" ? await ed.deep(target) : target;
      if (!el) throw new Error(`Nothing to click: ${target}`);
      const inView = () =>
        el.evaluate((e) => {
          const r = e.getBoundingClientRect();
          const x = r.left + r.width / 2;
          const y = r.top + r.height / 2;
          const sized = r.width > 0 && r.height > 0;
          return { x, y, sized, inside: sized && x >= 0 && y >= 0 && x < innerWidth && y < innerHeight, what: __ec.describe(e).path };
        });
      let c = await inView();
      if (!c.inside && c.sized) {
        await el.evaluate((e) => e.scrollIntoView({ block: "center", inline: "nearest" }));
        await frames();
        c = await inView();
      }
      if (!c.sized) throw new Error(`Can't click ${c.what}: it has no size`);
      if (!c.inside) throw new Error(`Can't click ${c.what}: its centre stays outside the viewport`);
      if (!covered) {
        const onTop = await el.evaluate((e, x, y) => {
          const hit = __ec.elementAt(x, y);
          return hit && !__ec.within(hit, e) ? __ec.describe(hit).path : null;
        }, c.x, c.y);
        if (onTop) throw new Error(`Can't click ${c.what}: ${onTop} is on top of it`);
      }
      return { x: c.x, y: c.y };
    },

    /** Type text with the keyboard, into whatever has focus. */
    type(text, { delay = 10 } = {}) {
      return page.keyboard.type(text, { delay });
    },

    /** Press a key or chord: "Enter", "Shift+Tab", "Mod+Z" (Meta on Macs, Control elsewhere). */
    async press(chord) {
      const keys = chord.split("+").map((k) => (k === "Mod" ? MOD : k));
      const key = keys.pop();
      for (const k of keys) await page.keyboard.down(k);
      await page.keyboard.press(key);
      for (const k of keys.reverse()) await page.keyboard.up(k);
    },

    /**
     * Enter edit mode as an author does: the course-site bar's Edit content,
     * or the stock editor's own toggle when there's no button on screen.
     * Does nothing when already editing (the toggle would save).
     */
    async enterEdit({ timeout = 15000 } = {}) {
      if (await editMode()) return;
      if (!(await page.evaluate(() => !!__ec.store()?.cmsSiteEditor?.haxCmsSiteEditorUIElement))) {
        throw new Error("enterEdit() needs a signed-in author with HAX's editor loaded; open the page without signedOut");
      }
      const button = await ed.control("Edit content");
      if (button) await ed.clickAt(button);
      else await page.evaluate(() => __ec.store().cmsSiteEditor.haxCmsSiteEditorUIElement._editButtonTap());
      await ed.waitFor(() => __ec.store()?.editMode && __ec.haxBody()?.children.length, { timeout, what: "edit mode" });
      // HAX resets its undo stack in a setTimeout(0) and takes the stock
      // editor's "unchanged" snapshot 100 ms after entering
      await sleep(150);
      await ed.closePalette();
      await ed.settle();
    },

    /**
     * Leave edit mode without saving, through the bar's Cancel or Exit (or
     * the stock editor's cancel). When it asks whether to discard changes,
     * discard if told to; otherwise throw and leave the dialog open for the
     * check to look at (a later exitEdit({ discard: true }) answers it).
     */
    async exitEdit({ discard = false, timeout = 15000 } = {}) {
      if (!(await editMode())) return;
      let outcome = (await page.evaluate(() => !!__ec.openDialog())) ? "asked" : null;
      if (!outcome) {
        const button = await ed.control(/^(cancel|exit|exit editing)$/i);
        if (button) await ed.clickAt(button);
        else await page.evaluate(() => __ec.store().cmsSiteEditor.haxCmsSiteEditorUIElement._cancelButtonTap());
        outcome = await ed.waitFor(() => (!__ec.store()?.editMode ? "left" : __ec.openDialog() ? "asked" : null), {
          timeout,
          what: "edit mode to end or a dialog asking to discard",
        });
      }
      if (outcome === "asked") {
        if (!discard) throw new Error("Exit asked to discard unsaved changes; pass { discard: true } to discard them");
        const confirm = await page.evaluateHandle(() => {
          const dialog = __ec.openDialog();
          return __ec.control(/^(discard changes|discard|ok)$/i, dialog.shadowRoot || dialog) || __ec.control(/^(discard changes|discard|ok)$/i, dialog);
        });
        if (!confirm.asElement()) throw new Error("Couldn't find the dialog's discard button");
        await ed.clickAt(confirm);
        await ed.waitFor(() => !__ec.store()?.editMode, { timeout, what: "edit mode to end after discarding" });
      }
      await ed.waitForReading({ timeout });
    },

    /**
     * Save through the bar's Save (or the stock toggle), wait for HAXcms to
     * write the page and for the reading view to come back. Returns the save
     * request's status; throws if it failed.
     */
    async save({ timeout = 20000 } = {}) {
      if (!(await editMode())) throw new Error("save() needs edit mode");
      // caught here so a click that throws doesn't leave it rejecting unheard
      const saved = page.waitForResponse((r) => r.request().method() === "PATCH" && /\/x\/api\/v1\/content\//.test(r.url()), { timeout }).catch((e) => e);
      const button = await ed.control(/^save$/i);
      if (button) await ed.clickAt(button);
      else await page.evaluate(() => __ec.store().cmsSiteEditor.haxCmsSiteEditorUIElement._editButtonTap());
      const res = await saved;
      if (res instanceof Error) throw new Error(`Save sent no request within ${timeout / 1000} s; state then: ${JSON.stringify(await ed.state())}`);
      if (!res.ok()) throw new Error(`Saving failed with HTTP ${res.status()}`);
      await ed.waitForReading({ timeout });
      return res.status();
    },

    /** Wait for the reading view: HAX out of edit mode and the theme redrawn. */
    async waitForReading({ timeout = 15000 } = {}) {
      await ed.waitFor(() => !__ec.store()?.editMode && !__ec.haxBody()?.editMode, { timeout, what: "the reading view" });
      await ed.settle();
    },
  };
  return ed;
}
