/**
 * Throwaway blocks for spike A (docs/editor-redesign/work-packages.md,
 * WP-01): a section that sorts its children into slots by hand, and the
 * items it lists. The spike runner copies this file into a scratch copy of
 * the site (custom/src/spike-blocks.js) and imports it from custom.js
 * there; it is never part of the real site.
 *
 *   <oer-spike-learn>
 *     <h2>What you'll be able to do</h2>
 *     <oer-spike-outcome><h3>Cut with confidence</h3><p>Plan, cut and finish.</p></oer-spike-outcome>
 *   </oer-spike-learn>
 *
 * Each variant is its own tag:
 * - oer-spike-learn: manual slots; takes outcomes, and any paragraph is stray.
 * - oer-spike-note: manual slots; takes paragraphs and lists as its text.
 * - oer-spike-learn-fb: the fallback, slot="heading" on the heading and
 *   everything else in the default slot, with oer-spike-outcome-fb items.
 * - oer-spike-learn-ce0: oer-spike-learn with HAX's contentEditable off, to
 *   compare how shadow controls keep focus.
 *
 * Every section has pairs of controls in shadow DOM while editing (a field
 * and a button each): as they are ("plain"), stopping the events the spec's
 * editorControl() directive lists (§6.2 #5: "spec"), that list plus focus,
 * or plus click and dblclick, and all of them ("full"). An item's icon tile
 * uses "full". While editing, what's drawn in shadow DOM (placeholders,
 * tiles, controls, the stray box's message) is user-select: none, so the
 * caret moves between fields past it. Only those, not a wrapper around the
 * slots: in Firefox a slotted field under a user-select: none ancestor in
 * the flat tree can't take the caret at all, editable or not.
 *
 * Arrow keys: with globalThis.__spikeKeys.arrows set, the capture listener
 * on hax-body keeps them from HAX and moves the caret from field to field at
 * a field's edge itself (arrow()), and into the section from the paragraph
 * beside it (arrowInto()).
 *
 * Keys: globalThis.__spikeKeys.mode says where the section listens for the
 * keys it handles: "off", "host" (on the section, as spec §5.3 has it),
 * "body" (capture on hax-body, the editing host) or "window" (capture on
 * window); "body-all" is "body" stopping every typed key in the field, not
 * only the ones that finish a shortcut. Every listener logs what reaches it
 * to globalThis.__spikeLog.
 */
import { html, css, LitElement } from "./lit.js";
import { registerBlocks } from "./blocks/register.js";
import { store, autorun } from "@haxtheweb/haxcms-elements/lib/core/HAXCMSLitElementTheme.js";

globalThis.__spikeKeys ??= { mode: "off" };
const log = (entry) => (globalThis.__spikeLog ??= []).push({ t: Math.round(performance.now()), ...entry });

// what a control stops, so HAX never sees it: the spec's editorControl()
// list, and that list plus what the spike found HAX also takes
const SPEC = ["pointerdown", "mousedown", "focusin", "keydown", "keyup", "paste"];
const GUARDS = {
  plain: [],
  spec: SPEC,
  "spec+focus": [...SPEC, "focus"],
  "spec+click": [...SPEC, "click", "dblclick"],
  full: [...SPEC, "click", "dblclick", "focus"],
};
const stop = (e) => e.stopPropagation();

/** Give every [data-guard] control in a shadow root its listeners, once. */
function guard(root) {
  for (const el of root.querySelectorAll("[data-guard]")) {
    if (el.__guarded) continue;
    el.__guarded = true;
    for (const type of GUARDS[el.dataset.guard]) el.addEventListener(type, stop);
  }
}

const fieldOf = (node, within) => {
  for (let n = node?.nodeType === 1 ? node : node?.parentElement; n && n !== within; n = n.parentElement) {
    if (/^(h1|h2|h3|p|li)$/.test(n.localName)) return n;
  }
  return null;
};

/**
 * The selection's range inside the shadow root that holds node, as spec
 * §5.3's getEditRange() reads it in each engine, and how it was read:
 * Chromium's ShadowRoot.getSelection(); Firefox's document selection, which
 * already holds the nodes inside shadow roots; WebKit's composed range (its
 * document selection stops at the outermost shadow host), given the shadow
 * roots as {shadowRoots} (the standard) or one by one (WebKit 18).
 */
function getEditRange(node) {
  const root = node.getRootNode();
  const sel = root.getSelection?.() || globalThis.document.getSelection();
  if (!sel?.rangeCount) return null;
  const range = sel.getRangeAt(0);
  if (range.startContainer.getRootNode() === root) return { range, how: root.getSelection ? "ShadowRoot.getSelection()" : "document.getSelection()" };
  if (!sel.getComposedRanges) return null;
  const roots = [];
  for (let r = root; r instanceof ShadowRoot; r = r.host.getRootNode()) roots.push(r);
  let composed = null;
  try {
    [composed] = sel.getComposedRanges({ shadowRoots: roots });
  } catch {}
  if (composed?.startContainer.getRootNode() === root) return { range: composed, how: "getComposedRanges({shadowRoots})" };
  [composed] = sel.getComposedRanges(...roots);
  return composed?.startContainer.getRootNode() === root ? { range: composed, how: "getComposedRanges(...shadowRoots)" } : null;
}
// for the runner's selection measurements
globalThis.__spikeEditRange = getEditRange;

const sectionStyles = css`
  :host {
    display: block;
    margin: 1.5rem 0;
    padding: 1.5rem;
    border: 1px solid var(--border, #ddd);
    border-radius: 0.625rem;
    text-align: start;
  }
  .heading {
    display: grid;
    margin-bottom: 1rem;
  }
  .heading > *,
  ::slotted(h2) {
    grid-area: 1 / 1;
  }
  ::slotted(h2) {
    margin: 0;
    min-block-size: 1lh;
    font-size: 1.5rem;
  }
  .default-heading {
    margin: 0;
    font-size: 1.5rem;
  }
  .ph {
    pointer-events: none;
    color: var(--muted-foreground, #666);
  }
  .heading .ph {
    font-size: 1.5rem;
    font-weight: 700;
  }
  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
    gap: 1rem;
  }
  .text {
    margin-top: 1rem;
  }
  ::slotted(p) {
    min-block-size: 1lh;
  }
  .stray {
    margin-top: 1rem;
    padding: 0.75rem 1rem;
    border-radius: 0.375rem;
    background: var(--muted, #eee);
  }
  .stray > p {
    margin: 0 0 0.5rem;
    font-size: 0.8125rem;
  }
  .controls {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: center;
    margin-top: 1rem;
    font-size: 0.875rem;
  }
  [hidden] {
    display: none !important;
  }
  /* while editing, what's drawn here can't hold the caret; the chrome
     itself, never a wrapper of the slots (Firefox would make the slotted
     fields unselectable too) */
  .editing .ph,
  .editing .controls,
  .editing .stray > p {
    user-select: none;
  }
`;

/**
 * A section class for one variant: manual slots or the fallback, which
 * blocks it takes (items, text), and HAX's contentEditable.
 */
function sectionClass({ tag, item, manual, text, contentEditable, title }) {
  return class extends LitElement {
    static get tag() {
      return tag;
    }
    static shadowRootOptions = manual ? { ...LitElement.shadowRootOptions, slotAssignment: "manual" } : LitElement.shadowRootOptions;

    connectedCallback() {
      super.connectedCallback();
      this.__stop = autorun(() => {
        const editing = !!store.editMode;
        Promise.resolve().then(() => {
          this.__editing = editing;
          this.requestUpdate();
        });
      });
      this.__observer = new MutationObserver(() => {
        this.assignSlots();
        this.requestUpdate();
      });
      this.__observer.observe(this, { childList: true, subtree: true, characterData: true });
      this.__clicks = {};
      this.__onHostKey = (e) => this.onKey(e, "host");
      this.__onWindowKey = (e) => this.onKey(e, "window");
      this.__onBodyKey = (e) => this.onKey(e, "body");
      for (const type of ["keydown", "keyup"]) {
        this.addEventListener(type, this.__onHostKey);
        globalThis.addEventListener(type, this.__onWindowKey, true);
      }
      this.__body = this.closest("hax-body");
      for (const type of ["keydown", "keyup"]) this.__body?.addEventListener(type, this.__onBodyKey, true);
    }

    disconnectedCallback() {
      this.__stop?.();
      this.__observer?.disconnect();
      for (const type of ["keydown", "keyup"]) {
        this.removeEventListener(type, this.__onHostKey);
        globalThis.removeEventListener(type, this.__onWindowKey, true);
        this.__body?.removeEventListener(type, this.__onBodyKey, true);
      }
      super.disconnectedCallback();
    }

    /** The light-DOM children sorted by where they show. */
    sorted() {
      const kids = [...this.children];
      const heading = kids.find((c) => c.localName === "h2") || null;
      const items = kids.filter((c) => c.localName === item);
      const texts = text ? kids.filter((c) => c !== heading && /^(p|ul|ol)$/.test(c.localName)) : [];
      const stray = kids.filter((c) => c !== heading && !items.includes(c) && !texts.includes(c));
      return { heading, items, texts, stray };
    }

    /**
     * Put each child in its slot (manual assignment only). Runs after
     * every render and every change to the children, since a child no slot
     * has been given is never drawn.
     */
    assignSlots() {
      if (!manual || !this.renderRoot) return;
      const { heading, items, texts, stray } = this.sorted();
      const give = (name, nodes) => {
        const slot = this.renderRoot.querySelector(`slot[name="${name}"]`);
        if (!slot) return;
        const now = slot.assignedNodes();
        if (now.length !== nodes.length || now.some((n, i) => n !== nodes[i])) slot.assign(...nodes);
      };
      give("heading", heading ? [heading] : []);
      give("items", items);
      give("text", texts);
      give("stray", stray);
    }

    updated() {
      this.assignSlots();
      guard(this.renderRoot);
    }

    /** Where the caret is, if it's in one of this section's fields, and how the selection was read. */
    caretField() {
      const edit = getEditRange(this);
      const node = edit?.range.startContainer;
      return node && this.contains(node) ? { field: fieldOf(node, this), how: edit.how } : null;
    }

    onKey(e, where) {
      if (globalThis.__spikeKeys.arrows && where === "body" && e.key.startsWith("Arrow") && this.arrowInto(e)) return;
      const { field, how } = this.caretField() || {};
      if (!field) return;
      log({ listener: where, type: e.type, key: e.key, phase: e.eventPhase, target: e.target.localName, section: tag, field: field.localName, how });
      if (globalThis.__spikeKeys.arrows && where === "body" && e.key.startsWith("Arrow")) {
        this.arrow(e, field);
        return;
      }
      const mode = globalThis.__spikeKeys.mode;
      if (mode !== where && !(mode === "body-all" && where === "body")) return;
      const single = /^h[1-3]$/.test(field.localName);
      const typed = e.type === "keydown" && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1;
      let handled = false;
      if (mode === "body-all" && typed) {
        // HAX checks for Markdown shortcuts a moment after any key, so the
        // key before the space can still start one: keep them all from it
        handled = true;
      } else if (e.type === "keydown" && e.key === "Enter") {
        e.preventDefault();
        handled = true;
      } else if (e.type === "keydown" && e.key === "/") {
        handled = true;
      } else if (e.type === "keydown" && e.key === " " && (single || field.localName === "p")) {
        handled = true;
      } else if (e.type === "keyup" && /^Arrow(Up|Down)$/.test(e.key)) {
        handled = true;
      }
      if (handled) {
        e.stopPropagation();
        log({ handled: e.key, type: e.type, by: where, section: tag });
      }
    }

    /** The fields the caret moves through, in DOM order: the heading, then each item's. */
    editFields() {
      const { heading, items, texts } = this.sorted();
      return [heading, ...items.flatMap((it) => [...it.children].filter((c) => /^(h3|p)$/.test(c.localName))), ...texts].filter(Boolean);
    }

    /** Whether a collapsed caret is at the edge of the block that the key leaves by: its start or first line, its end or last line. */
    atEdge(key, block, range) {
      const caret = globalThis.document.createRange();
      caret.setStart(range.startContainer, range.startOffset);
      const before = globalThis.document.createRange();
      before.selectNodeContents(block);
      before.setEnd(caret.startContainer, caret.startOffset);
      const offset = before.toString().length;
      const box = block.getBoundingClientRect();
      const at = caret.getClientRects()[0] || box;
      const line = parseFloat(getComputedStyle(block).lineHeight) || 24;
      return {
        ArrowLeft: offset === 0,
        ArrowUp: at.top < box.top + line * 0.8,
        ArrowRight: offset === block.textContent.length,
        ArrowDown: at.bottom > box.bottom - line * 0.8,
      }[key];
    }

    /** Put the caret at the start or end of a block's text (in the block when it's empty). */
    place(block, atEnd) {
      const walker = globalThis.document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      const texts = [];
      while (walker.nextNode()) texts.push(walker.currentNode);
      const sel = this.getRootNode().getSelection?.() || globalThis.document.getSelection();
      if (!texts.length) sel.collapse(block, 0);
      else if (atEnd) sel.collapse(texts.at(-1), texts.at(-1).length);
      else sel.collapse(texts[0], 0);
    }

    /**
     * An arrow key with the caret in a field (__spikeKeys.arrows): kept from
     * HAX's window handler, and at a field's edge (← at its start, → at its
     * end, ↑ on its first line, ↓ on its last) the caret is moved to the
     * field before or after, or the block before or after the section, with
     * collapse(). Inside a field the browser moves it.
     */
    arrow(e, field) {
      e.stopPropagation();
      if (e.type !== "keydown" || e.shiftKey || e.altKey || e.metaKey || e.ctrlKey) return;
      const edit = getEditRange(this);
      if (!edit?.range.collapsed) return;
      const back = e.key === "ArrowLeft" || e.key === "ArrowUp";
      if (!this.atEdge(e.key, field, edit.range)) return;
      const fields = this.editFields();
      const outside = back ? this.previousElementSibling : this.nextElementSibling;
      const target = fields[fields.indexOf(field) + (back ? -1 : 1)] || (/^(p|h[1-6])$/.test(outside?.localName) ? outside : null);
      if (!target) return;
      e.preventDefault();
      this.place(target, back);
      log({ handled: e.key, type: e.type, by: "arrow", section: tag, to: target.localName });
    }

    /**
     * An arrow key in the paragraph just before or after the section, at the
     * edge facing it: into the section's first or last field, kept from HAX.
     */
    arrowInto(e) {
      const edit = getEditRange(this);
      const node = edit?.range.startContainer;
      const before = this.previousElementSibling;
      const after = this.nextElementSibling;
      const from = [before, after].find((b) => b && /^(p|h[1-6])$/.test(b.localName) && b.contains(node));
      if (!from) return false;
      const towards = from === after ? ["ArrowLeft", "ArrowUp"] : ["ArrowRight", "ArrowDown"];
      if (!towards.includes(e.key)) return false;
      e.stopPropagation();
      if (e.type !== "keydown" || e.shiftKey || e.altKey || e.metaKey || e.ctrlKey || !edit.range.collapsed) return true;
      if (!this.atEdge(e.key, from, edit.range)) return true;
      const fields = this.editFields();
      e.preventDefault();
      this.place(from === after ? fields.at(-1) : fields[0], from === after);
      log({ handled: e.key, type: e.type, by: "arrow", section: tag, into: true });
      return true;
    }

    pressed(name) {
      this.__clicks[name] = (this.__clicks[name] || 0) + 1;
      log({ clicked: name, section: tag });
    }

    renderControls() {
      return html`<div class="controls" ?hidden="${!this.__editing}">
        ${Object.keys(GUARDS).map(
          (kind) => html`<label>${kind} <input class="${kind.replace("+", "-")}-input" data-guard="${kind}" aria-label="${kind} field" /></label>
            <button class="${kind.replace("+", "-")}-button" data-guard="${kind}" @click="${() => this.pressed(kind)}">${kind} button</button>`,
        )}
      </div>`;
    }

    render() {
      const { heading } = this.sorted();
      const empty = !heading || !heading.textContent.trim();
      if (!manual) {
        return html`<div class="${this.__editing ? "editing" : ""}">
          <div class="heading"><slot name="heading"></slot></div>
          <div class="cards" role="list"><slot></slot></div>
          ${this.renderControls()}
        </div>`;
      }
      return html`<div class="${this.__editing ? "editing" : ""}">
        <div class="heading">
          ${!heading && !this.__editing ? html`<h2 class="default-heading">${title}</h2>` : ""}
          <slot name="heading"></slot>
          <span class="ph" aria-hidden="true" ?hidden="${!this.__editing || !empty}">${title}</span>
        </div>
        ${item ? html`<div class="cards" role="list"><slot name="items"></slot></div>` : ""}
        <div class="text"><slot name="text"></slot></div>
        <div class="stray" ?hidden="${!this.__editing}">
          <p>Readers won't see what's here.</p>
          <slot name="stray"></slot>
        </div>
        ${this.renderControls()}
      </div>`;
    }

    static get styles() {
      return sectionStyles;
    }

    static get haxProperties() {
      return {
        type: "grid",
        contentEditable,
        canEditSource: true,
        canScale: false,
        hideDefaultSettings: true,
        designSystem: false,
        gizmo: { title: `Spike: ${title}`, description: "A throwaway block for the editor spike.", icon: "icons:list", color: "blue", tags: ["Spike"], meta: { author: "spike" } },
        settings: { configure: [], advanced: [] },
        demoSchema: [{ tag, properties: {}, content: "<h2></h2>" }],
      };
    }
  };
}

const itemStyles = css`
  :host {
    display: block;
    padding: 1.25rem;
    border: 1px solid var(--border, #ddd);
    border-radius: 0.625rem;
    background: var(--background, #fff);
  }
  .card {
    display: grid;
    grid-template-columns: 1fr;
    gap: 0.5rem;
  }
  .tile {
    grid-row: 1;
    justify-self: start;
    width: 2.5rem;
    height: 2.5rem;
    border: 0;
    border-radius: 0.375rem;
    background: color-mix(in oklab, var(--primary, #2563eb) 14%, transparent);
  }
  ::slotted(h3),
  .ph-title {
    grid-row: 2;
    grid-column: 1;
  }
  ::slotted(p:first-of-type),
  .ph-text {
    grid-row: 3;
    grid-column: 1;
  }
  ::slotted(h3) {
    margin: 0;
    min-block-size: 1lh;
    font-size: 1rem;
  }
  ::slotted(p) {
    margin: 0;
    min-block-size: 1lh;
  }
  .ph {
    pointer-events: none;
    color: var(--muted-foreground, #666);
  }
  .ph-title {
    font-weight: 600;
  }
  [hidden] {
    display: none !important;
  }
  .card.editing .tile,
  .card.editing .ph {
    user-select: none;
  }
`;

/** An item class: manual slots (title, text) or one default slot. */
function itemClass({ tag, manual }) {
  return class extends LitElement {
    static get tag() {
      return tag;
    }
    static shadowRootOptions = manual ? { ...LitElement.shadowRootOptions, slotAssignment: "manual" } : LitElement.shadowRootOptions;

    constructor() {
      super();
      // a list item without a stored role attribute (HAX strips those on
      // save); axe-core reads internals only from a field with this name
      this._internals = this.attachInternals();
      this._internals.role = "listitem";
    }

    connectedCallback() {
      super.connectedCallback();
      this.__stop = autorun(() => {
        const editing = !!store.editMode;
        Promise.resolve().then(() => {
          this.__editing = editing;
          this.requestUpdate();
        });
      });
      this.__observer = new MutationObserver(() => {
        this.assignSlots();
        this.requestUpdate();
      });
      this.__observer.observe(this, { childList: true, subtree: true, characterData: true });
    }

    disconnectedCallback() {
      this.__stop?.();
      this.__observer?.disconnect();
      super.disconnectedCallback();
    }

    fields() {
      const kids = [...this.children];
      const title = kids.find((c) => c.localName === "h3") || null;
      return { title, text: kids.filter((c) => c !== title) };
    }

    assignSlots() {
      if (!manual || !this.renderRoot) return;
      const { title, text } = this.fields();
      const give = (name, nodes) => {
        const slot = this.renderRoot.querySelector(`slot[name="${name}"]`);
        const now = slot?.assignedNodes() || [];
        if (slot && (now.length !== nodes.length || now.some((n, i) => n !== nodes[i]))) slot.assign(...nodes);
      };
      give("title", title ? [title] : []);
      give("text", text);
    }

    updated() {
      this.assignSlots();
      guard(this.renderRoot);
    }

    render() {
      const { title, text } = this.fields();
      const emptyTitle = !title?.textContent.trim();
      const emptyText = !text.some((t) => t.textContent.trim());
      return html`<div class="card ${this.__editing ? "editing" : ""}">
        <button class="tile" aria-label="Change icon: Target" data-guard="full" ?hidden="${!this.__editing}" @click="${() => log({ clicked: "icon", item: tag })}"></button>
        ${manual ? html`<slot name="title"></slot><slot name="text"></slot>` : html`<slot></slot>`}
        <span class="ph ph-title" aria-hidden="true" ?hidden="${!this.__editing || !emptyTitle}">Outcome title</span>
        <span class="ph ph-text" aria-hidden="true" ?hidden="${!this.__editing || !emptyText}">What students will be able to do</span>
      </div>`;
    }

    static get styles() {
      return itemStyles;
    }

    static get haxProperties() {
      return {
        type: "grid",
        contentEditable: true,
        canScale: false,
        hideDefaultSettings: true,
        designSystem: false,
        gizmo: { title: "Spike: outcome", description: "A throwaway item for the editor spike.", icon: "icons:list", color: "blue", tags: ["Spike"], meta: { author: "spike", hidden: true, requiresParent: true } },
        settings: { configure: [], advanced: [] },
        demoSchema: [{ tag, properties: {}, content: "<h3></h3><p></p>" }],
      };
    }
  };
}

const BLOCKS = [
  itemClass({ tag: "oer-spike-outcome", manual: true }),
  itemClass({ tag: "oer-spike-outcome-fb", manual: false }),
  sectionClass({ tag: "oer-spike-learn", item: "oer-spike-outcome", manual: true, text: false, contentEditable: true, title: "What you'll learn" }),
  sectionClass({ tag: "oer-spike-note", item: null, manual: true, text: true, contentEditable: true, title: "A note" }),
  sectionClass({ tag: "oer-spike-learn-fb", item: "oer-spike-outcome-fb", manual: false, text: false, contentEditable: true, title: "What you'll learn (fallback)" }),
  sectionClass({ tag: "oer-spike-learn-ce0", item: "oer-spike-outcome", manual: true, text: false, contentEditable: false, title: "Controls with contentEditable off" }),
];
for (const cls of BLOCKS) if (!customElements.get(cls.tag)) customElements.define(cls.tag, cls);
registerBlocks(...BLOCKS);
