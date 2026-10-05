# 08: video-player and other iframes blocked under the dev server's headers

**Repo:** haxcms-nodejs, plus webcomponents (video-player / a11y-media-player) · **Form:** Bug report · **Status:** filed 2026-10-05 as [haxtheweb/issues#3112](https://github.com/haxtheweb/issues/issues/3112)
**Found:** 2026-10-01 with haxcms-nodejs 26.8.1 (`hax serve`). The same code is on main (`src/app.js:157-163`).

## Issue

**Title:** `[haxcms-nodejs] Local/dev mode's COEP credentialless + Referrer-Policy same-origin block YouTube in video-player`

**What happened?**

In local/dev mode (`HAXCMS_DISABLE_JWT_CHECKS`), `app.js` sets `Cross-Origin-Embedder-Policy: credentialless` and `Cross-Origin-Opener-Policy: same-origin`, so the page is cross-origin isolated. Helmet's `Referrer-Policy: same-origin` applies in every mode. Together:

- **Isolation blocks most embeds.** A cross-origin iframe now loads only if its document opts in to COEP, or if the iframe carries the `credentialless` attribute. YouTube sends COEP only as report-only, and Google Slides sends none, so their embeds are blocked.
- **The referrer policy breaks YouTube.** It strips the referrer YouTube now requires, which gives "Video player configuration error" (error 153).

HAX's own `video-player` (YouTube via a11y-media-player) therefore doesn't play under `hax serve`.

**How to reproduce**

1. Run `hax serve` on a site whose page contains `<video-player source="https://www.youtube.com/watch?v=…">`.
2. The player area stays blank.

The page's `crossOriginIsolated` is `true`. With the YouTube iframe API (`enablejsapi=1`), a plain iframe never posts messages back, while the same iframe with `credentialless` does.

**Suggested fix**

Give generated iframes `credentialless` and `referrerpolicy="strict-origin-when-cross-origin"` (video-player, a11y-media-youtube, iframe-loader and the other embed blocks). Or don't make the dev server cross-origin isolated unless the playground needs it.

**Our workaround:** every iframe in our blocks has both attributes, and three pages moved from video-player to our oer-video block.
