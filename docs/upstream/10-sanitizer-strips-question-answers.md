# 10: page saves delete the answers of HAX question blocks

**Repo:** haxcms-nodejs · **Form:** Bug report · **Project:** haxcms-nodejs (backend) · **Status:** filed 2026-10-05 as [haxtheweb/issues#3113](https://github.com/haxtheweb/issues/issues/3113)
**Found:** 2026-10-05 with 26.8.1 (`dist/lib/sanitizeContent.js`) and the same code on `main` (`src/lib/sanitizeContent.js`).

## Issue

**Title:** `[haxcms-nodejs] sanitizeHTMLForStorage strips "correct" from <input>, so saving a page erases multiple-choice / true-false answers`

**What happened?**

HAX's question elements (multiple-choice, true-false-question and the others built on QuestionElement) store the right answer as an attribute on a light-DOM input: `<input type="checkbox" value="B" correct>`. The editor serializes that correctly: the `PATCH /x/api/v1/content/{id}` body contains `correct="correct"`.

`saveNode` then runs `sanitizeHTMLForStorage`, which uses DOMPurify with `CUSTOM_ELEMENT_HANDLING.attributeNameCheck`. That allows any attribute on custom elements, but `<input>` is a standard element, and `correct` isn't on DOMPurify's allowlist or in `ADD_ATTR`, so it's removed. Every save of a page with questions deletes all their answers; checking an answer then always says it's wrong. `data-*` attributes survive (DOMPurify allows them by default), which is why `data-image`, `data-selected` etc. on the same inputs are kept.

**How to reproduce**

1. Put `<multiple-choice question="Pick B" single-option><input type="checkbox" value="A"><input type="checkbox" value="B" correct></multiple-choice>` on a page.
2. Edit the page, change anything, save.
3. The stored file has `<input type="checkbox" value="B">`; the question has no correct answer.

**Suggested fix**

Add `correct` to `ADD_ATTR` in `sanitizeHTMLForStorage` (it's inert), or have QuestionElement write `data-correct` and read either. Same check for the other attributes question elements put on standard elements.

**Our workaround:** questions also save `data-correct="true"` and treat it as correct when loading (learning-materials `f774c65`).
