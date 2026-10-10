// The browsers the checks run in. Chrome is puppeteer-core driving the
// system Chrome, as the checks were written for. Firefox and WebKit
// (Safari's engine) are Playwright's own builds, cached in
// ~/Library/Caches/ms-playwright for the playwright-core in package.json,
// behind an adapter that gives them the part of puppeteer's API the checks
// and helpers use, so one check runs in all three.
//
//   const browser = await launch("webkit");
//   const context = await browser.createBrowserContext();
//   const page = await context.newPage();          // shaped like puppeteer's
//   await page.evaluate((a, b) => a + b, 1, 2);    // arguments spread, as in puppeteer
//
// What only Chrome's DevTools protocol does (CDP sessions, and with them
// IME composition, Chrome's own accessibility tree, raw Input and
// Emulation calls) throws an error with skipped: true in the others, which
// the runner reports as skipped rather than failed. SUPPORTS says up front
// what each engine can do, so a check can skip one result (ctx.skip) and
// carry on.
import puppeteer from "puppeteer-core";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";

export const ENGINES = ["chrome", "firefox", "webkit"];
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/**
 * What a check can count on in each engine:
 * - cdp: Chrome's DevTools protocol (page.createCDPSession(), page.target()).
 * - ime: typing through an input method (Input.imeSetComposition).
 * - forcedColors: emulating forced colours (ctx.axe({ forcedColors: true })).
 * - editingCommands: keyboard.press(key, { commands }) runs Chrome's editing
 *   commands; elsewhere the adapter presses each command's Mac shortcut
 *   (undo, redo, cut, copy, paste and selectAll only).
 */
export const SUPPORTS = {
  chrome: { cdp: true, ime: true, forcedColors: true, editingCommands: true },
  firefox: { cdp: false, ime: false, forcedColors: true, editingCommands: false },
  webkit: { cdp: false, ime: false, forcedColors: true, editingCommands: false },
};

/** An error for something this engine can't do; the runner reports it as skipped. */
export function unsupported(what, engine) {
  const e = new Error(`skipped in ${engine}: ${what}`);
  e.skipped = true;
  return e;
}

/**
 * Start a headless browser of the engine. Chrome is puppeteer's own
 * Browser; Firefox and WebKit are wrapped to look like one. options go to
 * puppeteer's or Playwright's launch as they are. Signals are left to the
 * caller, which stops its server before exiting.
 */
export async function launch(engine, options = {}) {
  const signals = { handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false };
  if (engine === "chrome") return puppeteer.launch({ executablePath: CHROME, headless: "new", ...signals, ...options });
  if (!ENGINES.includes(engine)) throw new Error(`No engine called ${engine} (there are: ${ENGINES.join(", ")})`);
  // loaded only when asked for, so a Chrome run doesn't need playwright-core
  const playwright = await import("playwright-core");
  let raw;
  try {
    raw = await playwright[engine].launch({ headless: true, ...signals, ...options });
  } catch (e) {
    const { version } = createRequire(import.meta.url)("playwright-core/package.json");
    throw new Error(`playwright-core ${version} needs its ${engine} build in ~/Library/Caches/ms-playwright (${e.message.split("\n")[0]})`);
  }
  return wrapBrowser(raw, engine);
}

/* ---------- the adapter: Playwright objects shaped like puppeteer's ---------- */

// the Playwright object behind an adapter, for passing handles back into the page
const RAW = Symbol("playwright");

/** A function's source as an expression (a method's shorthand made a function), as puppeteer sends it. */
function functionSource(fn) {
  let source = String(fn).trim();
  try {
    new Function(`(${source})`);
  } catch {
    source = source.startsWith("async ") ? `async function ${source.slice(6)}` : `function ${source}`;
  }
  return source;
}

/**
 * Playwright hands a page function one argument; puppeteer spreads them.
 * The wrapper's source is what Playwright sends to the page, with fn's own
 * inside it, called with the arguments spread (after the element, for a
 * handle's evaluate).
 */
function spreading(fn, lead = []) {
  return new Function(...lead, "args", `return (${functionSource(fn)})(${[...lead, "...args"].join(", ")});`);
}

/** Arguments for the page: adapter handles swapped for Playwright's, also inside arrays and plain objects. */
function unwrap(value) {
  if (value?.[RAW]) return value[RAW];
  if (Array.isArray(value)) return value.map(unwrap);
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, unwrap(v)]));
  }
  return value;
}

// puppeteer's waitUntil, as Playwright's
function waitUntil(value) {
  const all = [value ?? "load"].flat();
  if (all.some((v) => /^networkidle/.test(v))) return "networkidle";
  return all.includes("load") ? "load" : "domcontentloaded";
}

// the caret left as it is, as puppeteer's: Playwright hides it by setting
// caret-color on every contenteditable and leaves style="" behind, which
// changes the content being edited (and HAX's undo steps, and what's saved)
function screenshotOptions({ path, type, quality, fullPage, clip, omitBackground } = {}) {
  return { path, type, quality, fullPage, clip, omitBackground, caret: "initial" };
}

/** A JSHandle or ElementHandle, with puppeteer's spread arguments. */
function wrapHandle(raw, page) {
  if (!raw) return null;
  const isElement = !!raw.asElement();
  const handle = {
    [RAW]: raw,
    evaluate: (fn, ...args) => raw.evaluate(spreading(fn, ["el"]), unwrap(args)),
    evaluateHandle: async (fn, ...args) => wrapHandle(await raw.evaluateHandle(spreading(fn, ["el"]), unwrap(args)), page),
    jsonValue: () => raw.jsonValue(),
    async getProperties() {
      return new Map([...(await raw.getProperties())].map(([key, value]) => [key, wrapHandle(value, page)]));
    },
    getProperty: async (name) => wrapHandle(await raw.getProperty(name), page),
    asElement: () => (isElement ? handle : null),
    dispose: () => raw.dispose(),
    toString: () => raw.toString(),
  };
  if (!isElement) return handle;
  const element = async (h) => h.asElement() || (await h.dispose(), null);
  return Object.assign(handle, {
    // querySelector, as puppeteer's $ (Playwright's own selectors would go through shadow roots)
    $: async (selector) => element(await handle.evaluateHandle((el, s) => el.querySelector(s), selector)),
    async $$(selector) {
      const list = await handle.evaluateHandle((el, s) => [...el.querySelectorAll(s)], selector);
      const found = [...(await list.getProperties()).values()].map((h) => h.asElement()).filter(Boolean);
      await list.dispose();
      return found;
    },
    async $eval(selector, fn, ...args) {
      const found = await handle.$(selector);
      if (!found) throw new Error(`No element matches ${selector}`);
      try {
        return await found.evaluate(fn, ...args);
      } finally {
        await found.dispose();
      }
    },
    async $$eval(selector, fn, ...args) {
      const list = await handle.evaluateHandle((el, s) => [...el.querySelectorAll(s)], selector);
      try {
        return await list.evaluate(fn, ...args);
      } finally {
        await list.dispose();
      }
    },
    boundingBox: () => raw.boundingBox(),
    // puppeteer clicks where the element is without Playwright's waiting for it to be ready
    click: ({ button, count, clickCount, delay, offset } = {}) => raw.click({ button, clickCount: count ?? clickCount ?? 1, delay, position: offset, force: true }),
    hover: () => raw.hover({ force: true }),
    focus: () => raw.focus(),
    async type(text, options) {
      await raw.focus();
      await page.keyboard.type(text, options);
    },
    async press(key, options) {
      await raw.focus();
      await page.keyboard.press(key, options);
    },
    screenshot: (options) => raw.screenshot(screenshotOptions(options)),
    scrollIntoView: () => handle.evaluate((el) => el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" })),
    isVisible: () => raw.isVisible(),
    isHidden: () => raw.isHidden(),
    isIntersectingViewport: ({ threshold = 0 } = {}) =>
      handle.evaluate(
        (el, threshold) =>
          new Promise((resolve) => {
            const observer = new IntersectionObserver(([entry]) => {
              observer.disconnect();
              resolve(threshold === 1 ? entry.intersectionRatio === 1 : entry.intersectionRatio > threshold);
            });
            observer.observe(el);
          }),
        threshold,
      ),
    uploadFile: (...files) => raw.setInputFiles(files),
    select: (...values) => raw.selectOption(values),
    // Playwright's Frame, not puppeteer's
    contentFrame: () => raw.contentFrame(),
    tap: () => Promise.reject(unsupported("touch input", page.engine)),
  });
}

/**
 * A request as puppeteer's "request" event gives it. With a route (request
 * interception on) it can be continued, answered or aborted, once; without
 * one it's read-only. Resolving never rejects: a page closed meanwhile
 * mustn't crash the run.
 */
function requestOf(request, route = null) {
  let handled = false;
  const resolve = (how) => {
    if (!route) throw new Error("Request Interception is not enabled!");
    if (handled) throw new Error("Request is already handled!");
    handled = true;
    return how().catch(() => {});
  };
  return {
    url: () => request.url(),
    method: () => request.method(),
    headers: () => request.headers(),
    postData: () => request.postData() ?? undefined,
    resourceType: () => request.resourceType(),
    isNavigationRequest: () => request.isNavigationRequest(),
    frame: () => request.frame(),
    failure: () => request.failure(),
    isInterceptResolutionHandled: () => handled,
    continue: ({ url, method, postData, headers } = {}) => resolve(() => route.continue({ url, method, postData, headers })),
    respond: ({ status, headers, contentType, body }) => resolve(() => route.fulfill({ status, headers, contentType, body })),
    abort: (errorCode = "failed") => resolve(() => route.abort(errorCode)),
  };
}

// a console message, with puppeteer's "warn" for Playwright's "warning"
function consoleOf(message, page) {
  return {
    type: () => (message.type() === "warning" ? "warn" : message.type()),
    text: () => message.text(),
    args: () => message.args().map((h) => wrapHandle(h, page)),
    location: () => message.location(),
  };
}

// puppeteer's editing commands, as the Mac shortcuts that run them
const SHORTCUTS = { undo: "Meta+KeyZ", redo: "Shift+Meta+KeyZ", cut: "Meta+KeyX", copy: "Meta+KeyC", paste: "Meta+KeyV", selectAll: "Meta+KeyA" };
const MODIFIERS = ["Shift", "Control", "Alt", "Meta"];
// puppeteer's names for media features, as Playwright's emulateMedia options
const MEDIA = { "prefers-reduced-motion": "reducedMotion", "prefers-color-scheme": "colorScheme", "forced-colors": "forcedColors", "prefers-contrast": "contrast" };

const pages = new WeakMap();

/** A Playwright page with puppeteer's API (the part the checks use). */
function wrapPage(raw, context) {
  if (pages.has(raw)) return pages.get(raw);
  const engine = context.engine;
  const events = new EventEmitter();
  let intercepting = false;
  let scripts = 0;
  const held = new Set();

  // Playwright's events, passed on as puppeteer's once something listens
  const forwarded = new Set();
  const convert = {
    console: (m) => consoleOf(m, page),
    popup: (p) => wrapPage(p, context),
    // while intercepting, requests come from the route instead
    request: (r) => (intercepting ? undefined : requestOf(r)),
  };
  events.on("newListener", (name) => {
    if (forwarded.has(name) || name === "newListener" || name === "removeListener") return;
    forwarded.add(name);
    raw.on(name, (value) => {
      const converted = convert[name] ? convert[name](value) : value;
      if (converted !== undefined) events.emit(name, converted);
    });
  });
  const route = (r, request) => events.emit("request", requestOf(request, r));

  const keyboard = {
    down(key) {
      held.add(key);
      return raw.keyboard.down(key);
    },
    up(key) {
      held.delete(key);
      return raw.keyboard.up(key);
    },
    /**
     * A key, or with commands puppeteer's editing commands. WebKit runs
     * the Mac shortcuts' commands itself, so a command is pressed as its
     * shortcut: the key as given when it already is one (Meta held and x
     * for cut), otherwise the shortcut instead of the key.
     */
    async press(key, { delay, commands } = {}) {
      if (!commands?.length) return raw.keyboard.press(key, { delay });
      const code = /^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : key;
      const chord = [...MODIFIERS.filter((m) => held.has(m)), code].join("+");
      if (commands.length === 1 && SHORTCUTS[commands[0]] === chord) return raw.keyboard.press(key, { delay });
      for (const command of commands) {
        if (!SHORTCUTS[command]) throw unsupported(`the "${command}" editing command`, engine);
        await raw.keyboard.press(SHORTCUTS[command], { delay });
      }
    },
    type: (text, { delay } = {}) => raw.keyboard.type(text, { delay }),
    sendCharacter: (char) => raw.keyboard.insertText(char),
  };

  const mouse = {
    move: (x, y, { steps } = {}) => raw.mouse.move(x, y, { steps }),
    down: ({ button, clickCount } = {}) => raw.mouse.down({ button, clickCount }),
    up: ({ button, clickCount } = {}) => raw.mouse.up({ button, clickCount }),
    // puppeteer's count is the number of clicks, Playwright's clickCount
    click: (x, y, { button, count, clickCount, delay } = {}) => raw.mouse.click(x, y, { button, clickCount: count ?? clickCount ?? 1, delay }),
    wheel: ({ deltaX = 0, deltaY = 0 } = {}) => raw.mouse.wheel(deltaX, deltaY),
  };

  const page = {
    [RAW]: raw,
    engine,
    // the Playwright page, for what the adapter doesn't cover
    playwright: raw,
    keyboard,
    mouse,
    touchscreen: new Proxy({}, { get: () => () => Promise.reject(unsupported("touch input", engine)) }),

    on(name, handler) {
      events.on(name, handler);
      return page;
    },
    once(name, handler) {
      events.once(name, handler);
      return page;
    },
    off(name, handler) {
      events.off(name, handler);
      return page;
    },
    removeAllListeners: (name) => (events.removeAllListeners(name), page),
    listenerCount: (name) => events.listenerCount(name),

    evaluate: (fn, ...args) => (typeof fn === "string" ? raw.evaluate(fn) : raw.evaluate(spreading(fn), unwrap(args))),
    evaluateHandle: async (fn, ...args) => wrapHandle(await (typeof fn === "string" ? raw.evaluateHandle(fn) : raw.evaluateHandle(spreading(fn), unwrap(args))), page),
    async evaluateOnNewDocument(fn, ...args) {
      await raw.addInitScript(typeof fn === "string" ? fn : `(${functionSource(fn)})(...${JSON.stringify(args)})`);
      return { identifier: String(++scripts) };
    },
    removeScriptToEvaluateOnNewDocument: () => Promise.reject(unsupported("removing a script added with evaluateOnNewDocument", engine)),
    /** puppeteer's order: options before the arguments. */
    async waitForFunction(fn, { timeout, polling } = {}, ...args) {
      const predicate = typeof fn === "string" ? fn : spreading(fn);
      const options = { timeout, polling: typeof polling === "number" ? polling : "raf" };
      return wrapHandle(await raw.waitForFunction(predicate, typeof fn === "string" ? undefined : unwrap(args), options), page);
    },
    /** document.querySelector, as puppeteer's (not Playwright's, which goes through shadow roots). */
    async waitForSelector(selector, { visible = false, hidden = false, timeout } = {}) {
      const found = await page.waitForFunction(
        (s, visible, hidden) => {
          const el = document.querySelector(s);
          const shown = !!el && el.checkVisibility({ checkVisibilityCSS: true }) && el.getBoundingClientRect().width > 0;
          if (hidden) return !shown;
          return el && (!visible || shown) ? el : false;
        },
        { timeout, polling: 50 },
        selector,
        visible,
        hidden,
      );
      return found.asElement() || (await found.dispose(), null);
    },
    $: async (selector) => {
      const found = await page.evaluateHandle((s) => document.querySelector(s), selector);
      return found.asElement() || (await found.dispose(), null);
    },
    async $$(selector) {
      const list = await page.evaluateHandle((s) => [...document.querySelectorAll(s)], selector);
      const found = [...(await list.getProperties()).values()].map((h) => h.asElement()).filter(Boolean);
      await list.dispose();
      return found;
    },
    async $eval(selector, fn, ...args) {
      const found = await page.$(selector);
      if (!found) throw new Error(`No element matches ${selector}`);
      try {
        return await found.evaluate(fn, ...args);
      } finally {
        await found.dispose();
      }
    },
    async $$eval(selector, fn, ...args) {
      const list = await page.evaluateHandle((s) => [...document.querySelectorAll(s)], selector);
      try {
        return await list.evaluate(fn, ...args);
      } finally {
        await list.dispose();
      }
    },

    goto: (url, { waitUntil: until, timeout } = {}) => raw.goto(url, { waitUntil: waitUntil(until), timeout }),
    reload: ({ waitUntil: until, timeout } = {}) => raw.reload({ waitUntil: waitUntil(until), timeout }),
    goBack: ({ waitUntil: until, timeout } = {}) => raw.goBack({ waitUntil: waitUntil(until), timeout }),
    goForward: ({ waitUntil: until, timeout } = {}) => raw.goForward({ waitUntil: waitUntil(until), timeout }),
    waitForNavigation: ({ waitUntil: until, timeout } = {}) => raw.waitForNavigation({ waitUntil: waitUntil(until), timeout }),
    waitForNetworkIdle: ({ timeout } = {}) => raw.waitForLoadState("networkidle", { timeout }),
    // Playwright's responses have puppeteer's ok(), status(), url() and request().method()
    waitForResponse: (match, { timeout } = {}) => raw.waitForResponse(match, { timeout }),
    waitForRequest: (match, { timeout } = {}) => raw.waitForRequest(typeof match === "function" ? (r) => match(requestOf(r)) : match, { timeout }),
    setContent: (html, { waitUntil: until, timeout } = {}) => raw.setContent(html, { waitUntil: waitUntil(until), timeout }),
    url: () => raw.url(),
    title: () => raw.title(),
    content: () => raw.content(),
    frames: () => raw.frames(),
    mainFrame: () => raw.mainFrame(),
    bringToFront: () => raw.bringToFront(),
    close: ({ runBeforeUnload } = {}) => raw.close({ runBeforeUnload }),
    isClosed: () => raw.isClosed(),
    browserContext: () => context,
    browser: () => context.browser(),
    setDefaultTimeout: (ms) => raw.setDefaultTimeout(ms),
    setDefaultNavigationTimeout: (ms) => raw.setDefaultNavigationTimeout(ms),
    setExtraHTTPHeaders: (headers) => raw.setExtraHTTPHeaders(headers),
    exposeFunction: (name, fn) => raw.exposeFunction(name, fn),
    addScriptTag: async (options) => wrapHandle(await raw.addScriptTag(options), page),
    addStyleTag: async (options) => wrapHandle(await raw.addStyleTag(options), page),

    async setViewport({ width, height, deviceScaleFactor = 1, isMobile = false, hasTouch = false }) {
      if (deviceScaleFactor !== 1 || isMobile || hasTouch) throw unsupported("a viewport's scale, mobile or touch (they belong to the context in Playwright)", engine);
      await raw.setViewportSize({ width, height });
    },
    viewport: () => raw.viewportSize(),
    /** Like puppeteer's, each call replaces the features emulated before. */
    async emulateMediaFeatures(features) {
      const media = Object.fromEntries(Object.values(MEDIA).map((option) => [option, null]));
      for (const { name, value } of features ?? []) {
        if (!MEDIA[name]) throw unsupported(`emulating ${name}`, engine);
        media[MEDIA[name]] = value || null;
      }
      await raw.emulateMedia(media);
    },
    emulateMediaType: (type) => raw.emulateMedia({ media: type ?? null }),
    screenshot: async (options = {}) => {
      const shot = await raw.screenshot(screenshotOptions(options));
      return options.encoding === "base64" ? shot.toString("base64") : shot;
    },

    /** Turn puppeteer-style interception on or off: every request then waits on a "request" listener. */
    async setRequestInterception(on) {
      if (on === intercepting) return;
      intercepting = on;
      if (on) await raw.route("**/*", route);
      else await raw.unroute("**/*", route);
    },

    cookies: (...urls) => context[RAW].cookies(urls.length ? urls : [raw.url()]),
    setCookie: (...cookies) => context[RAW].addCookies(cookies.map((c) => (c.url || c.domain ? { path: "/", ...c } : { ...c, url: raw.url() }))),
    async deleteCookie(...cookies) {
      for (const { name, domain, path } of cookies) await context[RAW].clearCookies({ name, domain, path });
    },

    // Playwright's accessibility snapshot, which each engine builds from its own tree
    accessibility: { snapshot: ({ root, interestingOnly } = {}) => raw.accessibility.snapshot({ root: root?.[RAW], interestingOnly }) },
    createCDPSession: () => Promise.reject(unsupported("Chrome DevTools sessions (createCDPSession)", engine)),
    target() {
      throw unsupported("Chrome DevTools targets (page.target())", engine);
    },
  };
  pages.set(raw, page);
  return page;
}

/** A Playwright BrowserContext as puppeteer's. */
function wrapContext(raw, browser) {
  const engine = browser.engine;
  const targetOf = (p) => ({ url: () => p.url(), type: () => "page", page: async () => wrapPage(p, context), browserContext: () => context });
  const context = {
    [RAW]: raw,
    engine,
    newPage: async () => wrapPage(await raw.newPage(), context),
    pages: async () => raw.pages().map((p) => wrapPage(p, context)),
    targets: () => raw.pages().map(targetOf),
    /** Polls the context's pages (a new tab starts at about:blank and navigates). */
    async waitForTarget(predicate, { timeout = 30000 } = {}) {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        for (const p of raw.pages()) if (await predicate(targetOf(p))) return targetOf(p);
        await new Promise((r) => setTimeout(r, 100));
      }
      const e = new Error(`Waiting for target failed: timeout ${timeout}ms exceeded`);
      e.name = "TimeoutError";
      throw e;
    },
    overridePermissions: (origin, permissions) => raw.grantPermissions(permissions, { origin }),
    clearPermissionOverrides: () => raw.clearPermissions(),
    browser: () => browser,
    close: () => raw.close(),
  };
  return context;
}

/** A Playwright Browser as puppeteer's. */
function wrapBrowser(raw, engine) {
  const name = { firefox: "Firefox", webkit: "WebKit" }[engine];
  const browser = {
    [RAW]: raw,
    engine,
    version: async () => `${name}/${raw.version()}`,
    createBrowserContext: async () => wrapContext(await raw.newContext(), browser),
    // puppeteer's opens in the default context; Playwright has none, so a new one
    newPage: async () => (await browser.createBrowserContext()).newPage(),
    // Playwright doesn't hand out the browser's process
    process: () => null,
    isConnected: () => raw.isConnected(),
    close: () => raw.close(),
  };
  return browser;
}
