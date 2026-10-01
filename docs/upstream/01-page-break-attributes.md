# 01: page-break attribute parsing corrupts titles and misses bare booleans

**Repo:** haxcms-nodejs · **Form:** Bug report · **Project:** haxcms-nodejs (backend)
**Patch:** `patches/haxcms-nodejs--page-break-boolean-attributes.patch`

## Issue

**Title:** `[haxcms-nodejs] pageBreakParser corrupts titles containing "published"/"locked" and misses a trailing bare published`

**What happened?**

`HAXCMS.pageBreakParser` (src/lib/HAXCMS.js) expands the bare boolean attributes `published` and `locked` with two plain string replaces:

```js
matches[i][2].replace('published ', 'published="published" ').replace('locked ', 'locked="locked" ')
```

This causes two problems:

1. **A title gets rewritten.** If an attribute value contains "published " or "locked " (followed by a space), the replace runs inside the quoted value. A page titled `Get published fast` is saved as title `Get published=`, with a stray attribute `fast`.
2. **A trailing bare attribute is missed.** `<page-break title="A" published>` has no space after `published`, so it isn't expanded. `parse_attributes` returns `published: null`, and saveNode stores `metadata.published = false`, so the page is unpublished.

Also, `.replace` with a string only changes the first match.

**How to reproduce**

```js
// from a haxcms-nodejs checkout
const { HAXCMS } = require('./src/lib/HAXCMS.js')
const attrs = (body) => Object.assign({}, HAXCMS.pageBreakParser(body)[0].attributes)

attrs('<page-break title="Get published fast" published="published"></page-break><p>x</p>')
// { title: 'Get published=', fast: null, published: 'published' }

attrs('<page-break title="A" published></page-break><p>x</p>')
// { title: 'A', published: null }   -> saved as unpublished
```

The same input through `PATCH /x/api/v1/content/{id}` renames or unpublishes the page, because saveNode reads `data.attributes.title` and `data.attributes.published`.

**Additional details**

haxcms-nodejs `main` at e41c859 and the released 26.8.1. Related: #1050 (unencoded quotes in titles), which is closed. I haven't checked whether haxcms-php's parser shares the code.

## Pull request

**Title:** `Expand bare boolean page-break attributes without touching quoted values`

**Body:**

```markdown
## Related Issue
Closes haxtheweb/issues#XXXX

## Description of Changes
### What changed:
- pageBreakParser expands bare `published` / `locked` with one regex that skips quoted values and also matches the attribute at the end of the tag
- new unit tests: test/unit/page-break-parser.test.cjs

### Why this change was needed:
Titles containing "published " or "locked " were corrupted, and a trailing bare `published` was read as unpublished.

## Type of Change
- [x] 🐛 Bug fix (non-breaking change which fixes an issue)

## Testing Checklist
- [x] I have tested this change locally
- [x] I have added/updated tests for my changes
- [x] All existing tests pass (same results as main; the 7 failures already on main are in export, actions and config discovery, which depend on the environment)
```
