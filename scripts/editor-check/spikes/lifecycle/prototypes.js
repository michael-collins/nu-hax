/**
 * Spike B prototypes (WP-02): the safety and lifecycle patches the editor
 * redesign relies on, written as the theme layer would install them, so the
 * spike can try them on a scratch copy of the site before they're built.
 * run.mjs injects this file into each page with evaluateOnNewDocument; it
 * never goes into the site.
 *
 * Everything is on globalThis.__lc:
 * - S3, the boundary guard: a capture `beforeinput` listener on hax-body
 *   that cancels deletions, splits and pastes reaching across a unit (a
 *   top-level block) or into or out of a heading. It logs every event it
 *   sees, with its target ranges, in __lc.inputs.
 * - S4, undo: undoManagerStackLogic skips snapshots whose normalized HTML
 *   is unchanged (selecting things), and Mod+Z, Mod+Shift+Z, Ctrl+Y and the
 *   browser's own undo (beforeinput historyUndo/historyRedo) go to HAX's undo.
 * - S4, dirty: a baseline of the normalized HTML taken once HAX has
 *   finished entering edit mode, compared by a debounced MutationObserver.
 * - S5, savePage(): saves without leaving edit mode, holds the edited page
 *   (inert) until HAX has reloaded the saved page into the reading view,
 *   then ends editing.
 * - S6, recovery: one restore path on HAX's own sessionStorage copy.
 *
 * Each part can be switched off for a stock measurement by setting
 * globalThis.__lcConfig before this runs, e.g. { undo: false }.
 */
(() => {
  if (globalThis.__lc) return;
  const config = { guard: true, undo: true, undoKeys: true, recovery: true, freshDetails: true, saveTimeout: 20000, refreshTimeout: 10000, ...(globalThis.__lcConfig || {}) };
  const lc = (globalThis.__lc = { config, inputs: [], undoSkipped: 0, warnings: [] });

  const store = () => globalThis.HAXCMS?.requestAvailability?.()?.store ?? null;
  const haxStore = () => globalThis.HaxStore?.requestAvailability?.() ?? null;
  const haxBody = () => haxStore()?.activeHaxBody ?? null;
  const siteEditor = () => store()?.cmsSiteEditor?.instance ?? null;
  const siteBuilder = () => globalThis.document.querySelector("haxcms-site-builder");
  const frames = (n = 2) => new Promise((r) => (n ? requestAnimationFrame(() => frames(n - 1).then(r)) : r()));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const warn = (text) => {
    lc.warnings.push(text);
    console.warn(`[lifecycle spike] ${text}`);
  };

  /**
   * HTML without what HAX adds while editing (data-hax-*, contenteditable,
   * draggable, role="textbox", hax-* classes) or while showing a block
   * (element-visible, which page-break and other IntersectionObserver
   * blocks toggle as they scroll in and out): what "changed" means.
   */
  const normalize = (lc.normalize = (html) => {
    const t = globalThis.document.createElement("template");
    t.innerHTML = html;
    for (const el of t.content.querySelectorAll("*")) {
      for (const a of [...el.attributes]) {
        if (a.name.startsWith("data-hax-") || ["contenteditable", "draggable", "element-visible"].includes(a.name)) el.removeAttribute(a.name);
      }
      if (el.getAttribute("role") === "textbox") el.removeAttribute("role");
      if (el.hasAttribute("class")) {
        const kept = [...el.classList].filter((c) => !c.startsWith("hax-"));
        if (kept.length) el.setAttribute("class", kept.join(" "));
        else el.removeAttribute("class");
      }
    }
    return t.innerHTML.trim();
  });

  /**
   * Wrap a method once, if it's there and its source still holds a marker
   * from HAX 26.8.1; otherwise leave it and warn once.
   */
  function pinned(target, name, marker, wrap) {
    const original = target?.[name];
    if (typeof original !== "function" || (marker && !String(original).includes(marker))) {
      warn(`${name} isn't HAX 26.8.1's; left alone`);
      return null;
    }
    if (original.__lcWrapped) return original;
    const wrapped = wrap(original);
    wrapped.__lcWrapped = true;
    target[name] = wrapped;
    return wrapped;
  }

  /* ---------- S3: the boundary guard ---------- */

  const TEXT = "p,h1,h2,h3,h4,h5,h6,li,blockquote,pre,dt,dd,figcaption,td,th,summary";
  const SINGLE_LINE = "h1,h2,h3,h4,h5,h6";
  // the input types that remove or rearrange what's selected
  const STRUCTURAL = /^(delete|insertParagraph|insertLineBreak|insertFromPaste|insertFromDrop|insertReplacementText|insertText|insertFromYank|insertTranspose|formatBlock)/;

  const elementOf = (node) => (node?.nodeType === 1 ? node : node?.parentElement ?? null);
  /** The top-level block holding node (a section, or a block between them); null for hax-body itself. */
  function unitOf(node, body) {
    let el = elementOf(node);
    while (el && el.parentElement !== body) el = el === body ? null : el.parentElement;
    return el;
  }
  /** The text element (paragraph, heading, list item…) holding node, inside hax-body. */
  function fieldOf(node, body) {
    const el = elementOf(node)?.closest(TEXT);
    return el && body.contains(el) && el !== body ? el : null;
  }
  function describePoint(node, offset, body) {
    const parts = [];
    for (let el = elementOf(node); el && el !== body; el = el.parentElement) {
      const i = el.parentElement ? [...el.parentElement.children].indexOf(el) : 0;
      parts.unshift(`${el.localName}[${i}]`);
    }
    if (elementOf(node) === body) parts.unshift("hax-body");
    return `${parts.join(">")}${node?.nodeType === 3 ? ">#text" : ""}@${offset}`;
  }

  /**
   * Why a range must not be edited natively, or "" when it may: it reaches
   * hax-body itself (whole blocks), spans two blocks, or crosses into or out
   * of a heading or out of any text element.
   */
  function refusal(range, inputType, body) {
    const { startContainer: a, endContainer: b } = range;
    // a deletion with nothing to delete takes blocks apart: in an empty
    // paragraph Chrome removes the paragraph, and with it everything around
    if (range.collapsed && /^delete/.test(inputType)) return "deletes a block's edge";
    if (range.collapsed) {
      if (/^insert(Text|Paragraph|LineBreak|FromPaste|FromDrop|ReplacementText)/.test(inputType) && unitOf(a, body) && !fieldOf(a, body) && elementOf(a) !== body) {
        return "types into a block outside any text";
      }
      return "";
    }
    if (elementOf(a) === body || elementOf(b) === body) return "reaches whole blocks";
    if (unitOf(a, body) !== unitOf(b, body)) return "spans two blocks";
    const fa = fieldOf(a, body);
    const fb = fieldOf(b, body);
    if (fa !== fb && (!fa || !fb || fa.matches(SINGLE_LINE) || fb.matches(SINGLE_LINE))) return "crosses into or out of a heading";
    return "";
  }

  /**
   * Backspace at the start of a block's first text, or Delete at the end of
   * its last, when the browser gives no target range: there's nothing in the
   * block to merge with, so the default would take the block apart.
   */
  function edgeRefusal(inputType, body) {
    const root = body.getRootNode();
    const sel = root.getSelection?.() || globalThis.document.getSelection();
    if (!sel?.rangeCount || !sel.isCollapsed) return "";
    const range = sel.getRangeAt(0);
    const field = fieldOf(range.startContainer, body);
    const unit = unitOf(range.startContainer, body);
    if (!field || !unit) return "";
    const before = globalThis.document.createRange();
    before.selectNodeContents(field);
    if (/Backward/.test(inputType)) {
      before.setEnd(range.startContainer, range.startOffset);
      const first = unit.querySelector(TEXT);
      if (!before.toString() && (first === field || field.matches(SINGLE_LINE))) return "at the start of the block";
    } else if (/Forward/.test(inputType)) {
      before.setStart(range.startContainer, range.startOffset);
      const all = unit.querySelectorAll(TEXT);
      if (!before.toString() && (all[all.length - 1] === field || field.matches(SINGLE_LINE))) return "at the end of the block";
    }
    return "";
  }

  function onBeforeInput(e) {
    const body = e.currentTarget;
    if (!body.editMode) return;
    // inputs inside a block's own shadow controls are the block's business
    if (e.composedPath()[0] !== body && !body.contains(e.composedPath()[0])) return;
    const ranges = e.getTargetRanges();
    let reason = "";
    if (STRUCTURAL.test(e.inputType)) {
      for (const r of ranges) reason ||= refusal(r, e.inputType, body);
      if (!ranges.length && /^delete/.test(e.inputType)) reason = edgeRefusal(e.inputType, body);
    }
    const entry = {
      inputType: e.inputType,
      cancelable: e.cancelable,
      ranges: ranges.map((r) => `${describePoint(r.startContainer, r.startOffset, body)} → ${describePoint(r.endContainer, r.endOffset, body)}`),
      refused: reason,
    };
    lc.inputs.push(entry);
    if (reason && config.guard) {
      e.preventDefault();
      entry.prevented = e.defaultPrevented;
    }
  }

  /**
   * Two ways round beforeinput: an input method replaces the selection with
   * composition input that can't be cancelled, and HAX's own paste handler
   * deletes the selection itself (range.deleteContents()) and cancels the
   * paste, so no beforeinput follows. Either way a selection the guard
   * would refuse is collapsed to its start first.
   */
  function collapseRefused(e) {
    const body = e.currentTarget;
    if (!body.editMode || !config.guard) return;
    const sel = body.getRootNode().getSelection?.() || globalThis.document.getSelection();
    if (!sel?.rangeCount || sel.isCollapsed) return;
    const reason = refusal(sel.getRangeAt(0), e.type === "paste" ? "insertFromPaste" : "insertCompositionText", body);
    lc.inputs.push({ inputType: e.type, ranges: [], refused: reason });
    if (reason) sel.collapseToStart();
  }

  /**
   * HAX's paste places pasted blocks by the caret's neighbours itself
   * (execCommand insertParagraph, then haxReplaceNode on a sibling), which
   * with the caret in a list item inside a section replaced a different
   * section. In list items and headings inside a section, a paste is
   * plain text on one line instead, through the browser's own insertText.
   */
  function onPaste(e) {
    collapseRefused(e);
    const body = e.currentTarget;
    if (!body.editMode || !config.guard) return;
    const sel = body.getRootNode().getSelection?.() || globalThis.document.getSelection();
    if (!sel?.rangeCount) return;
    const range = sel.getRangeAt(0);
    const field = fieldOf(range.startContainer, body);
    const unit = unitOf(range.startContainer, body);
    if (!field || !unit?.localName.includes("-") || !field.matches(`li,${SINGLE_LINE}`)) return;
    const text = (e.clipboardData?.getData("text/plain") || "").replace(/\s*\n\s*/g, " ").trim();
    e.preventDefault();
    e.stopImmediatePropagation();
    lc.inputs.push({ inputType: "paste", ranges: [], refused: "", plain: text });
    if (text) globalThis.document.execCommand("insertText", false, text);
  }

  /* ---------- S4: undo that ignores selection, and the undo keys ---------- */

  function installUndo(HaxBody) {
    pinned(HaxBody.prototype, "undoManagerStackLogic", "__dragMoving", (original) =>
      function (mutations) {
        // a new snapshot only when the content changed, not when HAX's
        // editing attributes did (selecting a block, making it editable)
        if (config.undo && this.undoStackPrevValue != null && normalize(this.innerHTML) === normalize(this.undoStackPrevValue)) {
          this.undoStackPrevValue = this.innerHTML;
          lc.undoSkipped++;
          return;
        }
        return original.call(this, mutations);
      },
    );
  }

  const isMac = /Mac|iPhone|iPad/.test(globalThis.navigator.platform);
  const inFormField = (el) => el?.matches?.("input, textarea, select, [contenteditable='plaintext-only']") ?? false;
  const deepActive = () => {
    let el = globalThis.document.activeElement;
    while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
    return el;
  };
  lc.undoRouted = [];
  function undoKeys(e) {
    const body = haxBody();
    if (!config.undoKeys || !body?.editMode || e.defaultPrevented) return;
    const mod = isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
    const key = e.key.toLowerCase();
    const redo = (mod && key === "z" && e.shiftKey) || (!isMac && e.ctrlKey && key === "y");
    const undo = mod && key === "z" && !e.shiftKey;
    if (!undo && !redo) return;
    const focus = deepActive();
    // a form field (Page details, the image field's address) keeps its own undo
    if (inFormField(focus) && !body.contains(focus)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    lc.undoRouted.push(`${redo ? "redo" : "undo"} from keydown`);
    redo ? body.redo() : body.undo();
  }
  function historyInput(e) {
    if (!config.undoKeys || !/^history(Undo|Redo)$/.test(e.inputType)) return;
    const body = e.currentTarget;
    e.preventDefault();
    lc.undoRouted.push(`${e.inputType} from beforeinput (cancelable ${e.cancelable})`);
    e.inputType === "historyRedo" ? body.redo() : body.undo();
  }

  /* ---------- S4: unsaved changes ---------- */

  const state = (lc.state = { baseline: null, dirty: false, saving: false, status: "No changes", entered: 0 });
  let observer = null;
  let dirtyTimer = 0;
  function measureDirty() {
    const body = haxBody();
    if (!body || state.baseline == null) return;
    state.dirty = normalize(body.innerHTML) !== state.baseline;
    if (!state.saving && !/^Couldn't/.test(state.status)) state.status = state.dirty ? "Unsaved changes" : "No changes";
    if (state.dirty) scheduleSnapshot();
  }
  /**
   * Take the baseline once HAX has finished entering edit mode: its import,
   * its undo reset (a setTimeout(0)) and the stock editor's own copy (100 ms).
   * Not isContentBusy(): in 26.8.1 editModeTransitioning never clears (its
   * waitForStable() waits for itself), so it's busy for the whole session.
   */
  async function takeBaseline(body) {
    const entry = ++state.entered;
    await sleep(0);
    for (let i = 0; i < 200 && (body._contentState?.getState("importing") || body._contentState?.getState("inserting")); i++) await sleep(25);
    // the stock editor's own "unchanged" copy is taken 100 ms after entry
    await sleep(150);
    await frames();
    if (entry !== state.entered || !body.editMode) return;
    state.baseline = normalize(body.innerHTML);
    state.dirty = false;
    state.status = "No changes";
    observer?.disconnect();
    observer = new MutationObserver(() => {
      clearTimeout(dirtyTimer);
      dirtyTimer = setTimeout(measureDirty, 150);
    });
    observer.observe(body, { subtree: true, childList: true, attributes: true, characterData: true });
    globalThis.dispatchEvent(new CustomEvent("lc-baseline", { detail: { entry } }));
    await offerRestore(body);
  }
  lc.resetBaseline = () => {
    const body = haxBody();
    state.baseline = body ? normalize(body.innerHTML) : null;
    measureDirty();
  };

  /* ---------- S5: saving without leaving edit mode ---------- */

  /**
   * Save the page and land on its reading view. The edited page stays on
   * screen (inert) until HAX has saved it and reloaded it into the reading
   * view, so old content never shows; on an error or a timeout editing
   * goes on with every edit kept. Resolves to { ok, reason, timings }.
   */
  lc.savePage = async function savePage({ timeout = config.saveTimeout, refreshTimeout = config.refreshTimeout } = {}) {
    const s = store();
    const body = haxBody();
    const editor = siteEditor();
    const builder = siteBuilder();
    if (!s?.editMode || !body || !editor || state.saving) return { ok: false, reason: "not editing" };
    const t0 = performance.now();
    const timings = {};
    const mark = (name) => (timings[name] = Math.round(performance.now() - t0));
    const sent = normalize(body.innerHTML);
    const refocus = keepFocus(body);
    state.saving = true;
    state.status = "Saving…";
    body.inert = true;
    body.setAttribute("aria-busy", "true");
    const release = holdImports(body, timings);
    const refresh = watchRefresh(builder, mark);
    const answer = answerOf(editor, timeout, mark);
    globalThis.dispatchEvent(new CustomEvent("haxcms-save-node", { bubbles: true, composed: true, cancelable: false, detail: toPlain(s.activeItem) }));
    mark("dispatched");
    const result = await answer.first;
    if (!result.ok) {
      body.inert = false;
      body.removeAttribute("aria-busy");
      refocus();
      state.saving = false;
      state.status = `Couldn't save: ${result.reason}. Your edits are still here.`;
      if (result.timedOut) {
        // the server may still answer: then that save happened, and HAX
        // would reload it into the editor over anything typed since
        answer.late.then(async () => {
          mark("lateResponse");
          state.baseline = sent;
          state.status = "Saved";
          measureDirty();
          await refresh.settled(refreshTimeout);
          refresh.stop();
          release();
        });
      } else {
        refresh.stop();
        release();
      }
      return { ...result, timings };
    }
    // HAX reloads the page and the site 300 ms after its answer; land once
    // that has settled, so the reading view never shows the copy from before
    const refreshed = await refresh.settled(refreshTimeout);
    mark(refreshed ? "refreshed" : "refreshTimeout");
    refresh.stop();
    s.editMode = false;
    await frames(1);
    release();
    body.inert = false;
    body.removeAttribute("aria-busy");
    state.saving = false;
    state.status = "Saved";
    state.baseline = null;
    if (config.recovery) dropCopy();
    mark("reading");
    return { ok: true, refreshed, timings };
  };

  const toPlain = (v) => (v ? JSON.parse(JSON.stringify(v)) : v);

  /**
   * HAX's answer to the save: { ok } from its node response, { ok: false,
   * reason } from its error handler (except 401 and 403, which first try a
   * fresh sign-in and send the save again), or a timeout. After a timeout,
   * late resolves if the answer still comes, until the next save.
   */
  let stopListening = () => {};
  function answerOf(editor, timeout, mark) {
    stopListening();
    let settle;
    let lateSettle;
    let timedOut = false;
    const first = new Promise((r) => (settle = r));
    const late = new Promise((r) => (lateSettle = r));
    const restore = [];
    const wrap = (name, wrapper) => {
      const own = Object.prototype.hasOwnProperty.call(editor, name);
      const original = editor[name];
      editor[name] = wrapper(original);
      restore.push(() => (own ? (editor[name] = original) : delete editor[name]));
    };
    const timer = setTimeout(() => {
      mark("timeout");
      timedOut = true;
      settle({ ok: false, reason: "No answer from the server", timedOut: true });
    }, timeout);
    stopListening = () => {
      clearTimeout(timer);
      restore.forEach((f) => f());
      stopListening = () => {};
    };
    wrap("_handleNodeResponse", (handled) =>
      function (...args) {
        mark("response");
        stopListening();
        if (timedOut) lateSettle();
        else settle({ ok: true });
        return handled.apply(this, args);
      },
    );
    wrap("lastErrorChanged", (failed) =>
      function (e) {
        const status = Number(e?.detail?.value?.status);
        const out = failed.call(this, e);
        if (![401, 403, 405].includes(status) || !editor.jwt) {
          mark("error");
          stopListening();
          if (!timedOut) settle({ ok: false, reason: `${status || ""} ${e?.detail?.value?.statusText || "Request failed"}`.trim() });
        }
        return out;
      },
    );
    return { first, late };
  }

  /**
   * While HAX reloads a saved page, edit mode is still on and HAX imports
   * the reloaded copy into hax-body as well: that empties the editor for a
   * frame, and after a late answer it would replace what was typed since.
   * Returns release().
   */
  let releaseImports = () => {};
  function holdImports(body, timings) {
    releaseImports();
    const own = Object.prototype.hasOwnProperty.call(body, "importContent");
    const importContent = body.importContent;
    let holding = true;
    body.importContent = function (...args) {
      if (holding && store()?.editMode) {
        timings.importsHeld = (timings.importsHeld || 0) + 1;
        return undefined;
      }
      return importContent.apply(this, args);
    };
    // leaving edit mode releases it too (a timed-out save that never answers)
    releaseImports = () => {
      holding = false;
      if (own) body.importContent = importContent;
      else delete body.importContent;
      releaseImports = () => {};
    };
    return () => releaseImports();
  }

  /**
   * Hold HAX's imports into hax-body around a Style or Page details save
   * (S6); release() returns how many it held.
   */
  lc.holdImportsNow = () => {
    const timings = {};
    const release = holdImports(haxBody(), timings);
    return () => {
      release();
      return timings.importsHeld || 0;
    };
  };

  /** Remember the caret and focus in hax-body, to put back when it stops being inert. */
  function keepFocus(body) {
    const sel = body.getRootNode().getSelection?.() || globalThis.document.getSelection();
    const range = sel?.rangeCount && body.contains(sel.getRangeAt(0).startContainer) ? sel.getRangeAt(0).cloneRange() : null;
    return () => {
      if (!range || !body.isConnected) return;
      body.focus({ preventScroll: true });
      const now = body.getRootNode().getSelection?.() || globalThis.document.getSelection();
      now.removeAllRanges();
      now.addRange(range);
    };
  }

  /**
   * Follow HAX's reload after a save: its page and site fetches and each
   * time it redraws the reading view's copy. settled() resolves true once
   * the reload has started, finished, and nothing has moved for 300 ms.
   */
  function watchRefresh(builder, mark) {
    let started = false;
    let busy = 0;
    let last = performance.now();
    const touch = () => (last = performance.now());
    const undo = [];
    const wrap = (name) => {
      const original = builder?.[name];
      if (typeof original !== "function") return;
      builder[name] = function (...args) {
        busy++;
        touch();
        mark(`${name}#${busy}`);
        const out = original.apply(this, args);
        Promise.resolve(out).finally(() => {
          busy--;
          touch();
        });
        return out;
      };
      undo.push(() => (builder[name] = original));
    };
    wrap("loadPageData");
    wrap("loadJOSData");
    wrap("_activeItemContentChanged");
    const onNode = () => {
      started = true;
      touch();
      mark("triggerUpdateNode");
    };
    globalThis.addEventListener("haxcms-trigger-update-node", onNode);
    globalThis.addEventListener("json-outline-schema-active-body-changed", touch);
    return {
      async settled(timeout) {
        const end = performance.now() + timeout;
        while (performance.now() < end) {
          const idle = !busy && !builder?.loading && !builder?.__pendingPageLoad;
          if (started && idle && performance.now() - last >= 300) return true;
          await sleep(25);
        }
        return false;
      },
      stop() {
        undo.forEach((f) => f());
        globalThis.removeEventListener("haxcms-trigger-update-node", onNode);
        globalThis.removeEventListener("json-outline-schema-active-body-changed", touch);
      },
    };
  }

  /* ---------- S6: recovery on HAX's own copy ---------- */

  // HAX keeps a copy of unsaved edits in sessionStorage (for a sign-out) and
  // applies it by itself on entering edit mode; we take that copy instead,
  // so there's one restore path, and ask first
  lc.recovered = null;
  lc.restorePrompts = [];
  let snapshotTimer = 0;
  function scheduleSnapshot() {
    if (!config.recovery) return;
    clearTimeout(snapshotTimer);
    snapshotTimer = setTimeout(() => {
      if (state.dirty && !state.saving) siteEditor()?._snapshotPendingEditForLogout?.();
    }, 2000);
  }
  function takeOverPendingRestore(editor) {
    if (!config.recovery || editor.__lcRecovery) return;
    editor.__lcRecovery = true;
    let held = editor.__pendingRestore ?? null;
    if (held) lc.recovered = held;
    Object.defineProperty(editor, "__pendingRestore", {
      configurable: true,
      get: () => null,
      set(value) {
        held = value;
        if (value) lc.recovered = value;
      },
    });
  }
  /** On entering edit mode, offer HAX's copy of this page's unsaved edits; restore() imports it after the baseline. */
  async function offerRestore(body) {
    if (!config.recovery) return;
    let copy = lc.recovered;
    if (!copy) {
      try {
        copy = JSON.parse(globalThis.sessionStorage.getItem("haxcms-pending-edit") || "null");
      } catch {}
    }
    const item = store()?.activeItem;
    if (!copy?.content || !item || String(copy.itemId) !== String(item.id)) return;
    if (Date.now() - copy.savedAt > 30 * 60 * 1000) return;
    lc.restorePrompts.push({ itemId: copy.itemId, savedAt: copy.savedAt });
    globalThis.dispatchEvent(new CustomEvent("lc-restore-offered", { detail: { savedAt: copy.savedAt } }));
    lc.restore = () => {
      dropCopy();
      // past any hold on HAX's own imports (holdImports)
      globalThis.customElements.get("hax-body").prototype.importContent.call(body, copy.content);
    };
    lc.discardRestore = dropCopy;
  }
  function dropCopy() {
    lc.recovered = null;
    try {
      globalThis.sessionStorage.removeItem("haxcms-pending-edit");
    } catch {}
  }

  /**
   * The page-break HAX saves with the page carries the page's details
   * (title, description…) as they were when editing began, and HAXcms writes
   * them back to site.json, so a page save after a Page details save mid-edit
   * undid it. For each save, the serialized page-break gets the details of
   * the page-break HAX built from the reloaded manifest. Registered before
   * the theme's own __beforeSave (which fixes order the same way), so it runs
   * inside it.
   */
  const DETAILS = ["title", "description", "slug", "tags", "icon", "image", "page-type", "related-items", "accent-color", "hide-in-menu", "locked", "published", "override-pathauto", "link-url", "link-target"];
  function freshDetails() {
    const body = haxBody();
    if (!config.freshDetails || !body || body.__lcDetailsWrapped) return;
    const current = /<page-break\b[^>]*>/i.exec(store()?.activeItemContent || "")?.[0];
    if (!current) return;
    body.__lcDetailsWrapped = true;
    const serialize = body.haxToContent;
    const restore = () => {
      if (body.haxToContent === wrapped) body.haxToContent = serialize;
      body.__lcDetailsWrapped = false;
    };
    const wrapped = async function (...args) {
      restore();
      const out = String(await serialize.apply(this, args));
      return out.replace(/<page-break\b[^>]*>/i, (tag) => {
        const t = globalThis.document.createElement("template");
        t.innerHTML = `${tag}</page-break>${current}</page-break>`;
        const [saved, fresh] = t.content.children;
        for (const name of DETAILS) {
          if (fresh.hasAttribute(name)) saved.setAttribute(name, fresh.getAttribute(name));
          else saved.removeAttribute(name);
        }
        return saved.outerHTML.replace(/<\/page-break>$/, "");
      });
    };
    body.haxToContent = wrapped;
    setTimeout(() => body.__lcDetailsWrapped && restore(), 10000);
  }

  /* ---------- installing ---------- */

  let guarded = null;
  function onEditMode(e) {
    const body = haxBody();
    if (!body) return;
    if (guarded !== body) {
      guarded = body;
      body.addEventListener("beforeinput", onBeforeInput, true);
      body.addEventListener("compositionstart", collapseRefused, true);
      body.addEventListener("paste", onPaste, true);
      body.addEventListener("beforeinput", historyInput, true);
    }
    const editor = siteEditor();
    if (editor) takeOverPendingRestore(editor);
    if (e.detail) takeBaseline(body);
    else {
      if (!state.saving) releaseImports();
      observer?.disconnect();
      state.baseline = null;
      state.dirty = false;
      if (!state.saving) state.status = "No changes";
    }
  }
  globalThis.addEventListener("haxcms-edit-mode-changed", onEditMode);
  // discarding the edits drops their recovery copy too
  globalThis.addEventListener("hax-cancel", () => config.recovery && dropCopy());
  globalThis.addEventListener("haxcms-save-node", freshDetails, true);
  globalThis.addEventListener("keydown", undoKeys, true);
  globalThis.customElements.whenDefined("hax-body").then(() => installUndo(globalThis.customElements.get("hax-body")));
  // take HAX's recovered copy before it applies it by itself
  const early = setInterval(() => {
    const editor = siteEditor();
    if (editor) {
      takeOverPendingRestore(editor);
      clearInterval(early);
    }
  }, 20);
  setTimeout(() => clearInterval(early), 60000);
})();
