# nu-hax

Making [HAX](https://haxtheweb.org) look and work like a modern OER platform: shadcn-style editing chrome, content types, versions, books and LMS embedding, built as a layer on top of stock HAXcms (no forks or patched files). It began as a way to bring the editing and viewing experience of [learning-materials-decapcms](https://github.com/michael-collins/learning-materials-decapcms) to HAX.

This repository holds the tooling and documentation. The HAXcms site, with the custom theme and every UI module, lives in its own repository: **[learning-materials-hax](https://github.com/michael-collins/learning-materials-hax)**. Check it out into `learning-materials/` here to use the scripts.

## What's here

| Path | What it does |
|---|---|
| `scripts/lib/hax-api.mjs` | Small client for the HAXcms v1 site and system APIs (login, items, content, outline) |
| `scripts/api-smoke-test.mjs` | Exercises the API end to end against a running site |
| `scripts/seed-from-decap.mjs` | Imports a slice of learning-materials-decapcms content (markdown and MDC components) through the API |
| `scripts/decap-types-to-json.mjs` | Converts Decap `cms/config.yml` collections into the site's content-type definitions |
| `scripts/import-pathways.mjs` | Imports the Decap pathways (outlines with levels and planned items, prerequisites) and the lessons, exercises, projects, lectures and tutorials they link to; re-runnable |
| `scripts/contrast-audit.mjs` | WCAG AA contrast check of the theme's colour tokens |
| `docs/regression-protection.md` | Proposal for keeping the UI layer safe from upstream HAX changes |
| `docs/upstream/` | Issues and pull requests proposed to HAX: verified drafts, PR descriptions and ready patches |

## Setup

```bash
git clone https://github.com/michael-collins/nu-hax.git
cd nu-hax
git clone https://github.com/michael-collins/learning-materials-hax.git learning-materials
npm install
cd learning-materials && npx @haxtheweb/haxcms-nodejs   # serves the site on http://localhost:3000
```

Scripts read credentials and paths from `.env.local` (gitignored):

```
HAX_USER=admin
HAX_PASSWORD=…
HAX_BASE=http://localhost:3000
HAX_SITE=learning-materials
DECAP_DIR=../learning-materials-decapcms
```

```bash
node --env-file=.env.local scripts/api-smoke-test.mjs
```

## License

Code: [Apache 2.0](LICENSE).
