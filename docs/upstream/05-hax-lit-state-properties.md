# 05: HAX writes Lit `state: true` properties into saved HTML

**Repo:** webcomponents (hax-body) · **Form:** Bug report · **Project:** HAX editing experience
**Patch:** `patches/webcomponents--hax-skip-lit-state-properties.patch`

## Issue

**Title:** `[hax-body] nodeToContent saves Lit state: true properties as attributes`

**What happened?**

When HAX turns a block into HTML for saving (`HaxStore.nodeToContent`), it records every declared property that differs from its default. It skips Polymer `readOnly` and `computed` properties and names starting with `__`, but not Lit properties declared with `state: true`. That's internal reactive state with no attribute, yet it ends up in the page HTML and comes back as stray attributes on the next load. Arrays and objects are written as JSON.

Custom blocks that keep UI state (open menus, loaded rows, filters) end up writing it into every page that uses them. We hit this with two blocks, and worked around it by keeping that state outside `properties`, which also loses Lit's reactivity.

**How to reproduce**

In a HAXcms site with the editor loaded, run in the console:

```js
const { LitElement } = await import(new URL('build/es6/node_modules/lit/index.js', document.baseURI).href)
class StateDemo extends LitElement {
  static get properties() { return { label: { type: String }, _open: { state: true }, _rows: { state: true } } }
}
customElements.define('state-demo', StateDemo)
const el = document.createElement('state-demo')
el.label = 'Hello'; el._open = true; el._rows = [{ id: 1 }]
document.body.appendChild(el); await el.updateComplete
await HaxStore.requestAvailability().nodeToContent(el)
// '<state-demo label="Hello" _open _rows="[{&quot;id&quot;:1}]"></state-demo>'
```

The expected output is `<state-demo label="Hello"></state-demo>`.

**Additional details**

webcomponents `main` at e51c522, as served by haxcms-nodejs 26.8.1. Reproduced in Chrome.

## Pull request

**Title:** `[hax-body] Don't write Lit state properties into saved content`

**Body:**

```markdown
## Related Issue
Closes haxtheweb/issues#XXXX

## Description of Changes
### What changed:
- nodeToContent skips properties declared with `state: true`, next to the existing readOnly / computed / `__` checks (hax-store.js)

### Why this change was needed:
Internal Lit state was serialized into page HTML and read back as stray attributes.

## Type of Change
- [x] 🐛 Bug fix (non-breaking change which fixes an issue)

## Testing Checklist
- [x] I have tested this change locally (console reproduction above, before and after)
- [ ] I have added/updated tests for my changes (happy to add one; pointers to the preferred place for hax-store tests welcome)
```

Before filing, run `yarn test` for hax-body in a full webcomponents checkout. Our sparse clone can't run the monorepo's browser tests, and we haven't verified the patched build in a browser yet.
