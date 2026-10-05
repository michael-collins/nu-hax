# 06: preload hints point custom themes at node_modules

**Repo:** haxcms-nodejs · **Form:** Bug report · **Project:** haxcms-nodejs (backend) · **Status:** filed 2026-10-05 as [haxtheweb/issues#3111](https://github.com/haxtheweb/issues/issues/3111)
**Found:** 2026-10-01, checking our theme against haxcms-nodejs `main` e41c859. Not in 26.8.1.

## Issue

**Title:** `[haxcms-nodejs] Theme modulepreload/preload hints 404 for custom themes (./custom/build/...)`

**What happened?**

The new shell modulepreload code in `getSiteMetadata` (src/lib/HAXCMS.js, "Phase 1: graph-driven shell modulepreload") always prefixes the theme path with `build/es6/node_modules/`:

```js
shellModulepreload += '<link rel="modulepreload" href="' + base + 'build/es6/node_modules/' + sps + '" ...'
themePreload = '<link rel="preload" href="' + base + 'build/es6/node_modules/' + themePath + '" ...'
```

A site with a custom theme has `metadata.theme.path` set to `./custom/build/custom.es6.js`, which isn't registry-relative. Every page then emits:

```html
<link rel="modulepreload" href="./build/es6/node_modules/./custom/build/custom.es6.js" crossorigin="anonymous" />
<link rel="preload" href="./build/es6/node_modules/./custom/build/custom.es6.js" as="script" crossorigin="anonymous" />
```

Both requests 404 on every page load, and on nested pages a third resolves relative to the page path. The theme still loads from its real path, so it's harmless but noisy, and the preload never helps.

**How to reproduce**

1. Use a site whose `site.json` has `metadata.theme.path: "./custom/build/custom.es6.js"`, served by haxcms-nodejs `main`.
2. Load any page and look at the network panel: `404 /build/es6/node_modules/custom/build/custom.es6.js`.

**Suggested fix**

Only prefix registry paths (those starting with `@`). Resolve a relative theme path (`./…` or `/…`) against `base`, or skip the preload for it. The same applies to the shell set, which receives `themePath`.

## Pull request

Not prepared yet.
