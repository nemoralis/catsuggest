# AGENTS.md

Instructions for AI coding agents working on this repository. Humans can read it too;
for full background see [README.md](README.md).

## Project overview

CatSuggest is a MediaWiki gadget for Azerbaijani Wikipedia (azwiki). It suggests

- parent categories to add to the current page, based on equivalents on other Wikipedias, and
- members (pages/subcategories, and templates on template categories) to add to the current category,

then applies the selected changes as batched MediaWiki API edits. The UI is Vue 3 with
`@wikimedia/codex`; keyword-driven behavior lives in `src/catsuggest-config.json`.

## Commands

```sh
npm test          # ESLint + Prettier check + Vitest (lint, format:check, test:unit)
npm run build     # dev build → dist/catsuggest.js (unminified, dev mode enabled)
npm run build:prod # production build (dev mode stripped, minified)
npm run dev       # watch build + local static server
npm run deploy    # test + production build + publish via bin/deploy.js
npm run cattree   # read-only Node diagnostic for the parent-category pipeline
npm run members   # read-only Node diagnostic for the members pipeline
```

Always run `npm test` after a behavior change; add or update tests in `tests/`.

## Source map

| Path                       | Responsibility                                                             |
| -------------------------- | -------------------------------------------------------------------------- |
| `src/App.vue`              | UI, workflow orchestration, suggestion fetching, edit dispatch            |
| `src/suggestions.js`       | Foreign/local category and member collection, filtering, suggestion build |
| `src/edit.js`              | Edit operations, wikitext parsing, template `/doc` handling                |
| `src/cache.js`             | `mw.storage` helpers, processed pages, site metadata, category-page gating |
| `src/constants.js`         | Namespaces, tunables, config-derived sets, shared helpers                  |
| `src/index.js`             | Bootstrap, namespace/user gating, Vue mount                                |
| `src/catsuggest-config.json` | Excluded sites/titles/keywords, large-wiki list (behavior config)        |
| `src/catsuggest-check.json`  | `enabledusers` allowlist for the members tab                             |
| `build.js`                 | esbuild bundling and build-time dev flag injection                        |

## Hard rules

### UI and language

- All user-facing strings are in **Azerbaijani**. New strings must match that convention.
- On topical template categories, members-mode labels use "Şablon…" rather than "Məqalə…"
  (`dialogTitle`, tab, accordion, descriptions, warning, confirmation, error text).
- Sort keys are a **parent-cats-only** feature; do not add them to members-mode suggestions.

### Templates (namespace 10)

- Only base wikitext template pages are supported. Never target `/doc`, `/sandbox`,
  `/testcases` or other subpages as the launcher page.
- Category additions go to `Şablon:Foo/doc`'s `<includeonly>` block when `/doc` exists
  (create/append a block if needed, follow redirects); otherwise to the template's own
  `<noinclude>`.
- Template edits are **additions only**. Removals are disabled, and a null edit
  (`refreshTemplateLinks`) must follow a `/doc` edit so the category index updates.
- Templates without a Wikidata QID/sitelink cannot produce foreign suggestions.
- Members mode suggests templates only on **topical** template categories. Project and
  tracking categories (`Kateqoriya:Şablonlar:*`, `Kateqoriya:Vikipediya*`, `*istifadə edən*`)
  stay on parent-cats mode.
- Parent-cats passes `{ allowTemplateCategories: isTemplatePage || isTemplateCategoryPage }`
  so topical template categories are not filtered; tracking categories remain excluded.
- Template member editability is decided by the **actual target**: `/doc` when it exists,
  otherwise the template itself.

### Exclusions and config

- `şablonlar` must stay in `excludedTitleKeywords`. Its exceptions are contextual
  (template pages and topical template categories), never a global keyword removal.
- Structural/tracking template categories are excluded independently of keyword casing.
- Do not edit `catsuggest-config.json` or `catsuggest-check.json` without asking first.

### Build, deploy and releases

- Dev mode is build-time only (`__CATSUGGEST_DEV__` injected by `build.js` from `--dev`).
  Production bundles must not contain the dev authorization bypass.
- The on-wiki gadget definition must include namespace `10` and icons `cdxIconKey`,
  `cdxIconReload`, `cdxIconSortVertical` in addition to the existing set.
- Releases use SemVer annotated tags (`v2.0.0`, `v2.1.0`, …) and `CHANGELOG.md`; bump
  `package.json`/`package-lock.json` together with the tag.

## Working style

- Discuss/plan non-trivial changes first; ask rather than assume, especially about UI wording
  and behavior scope.
- Keep changes minimal and consistent with the surrounding code; style is tabs + Prettier +
  Wikimedia ESLint config.
- Update or add tests for behavior changes, then run `npm test` before reporting completion.
