# Changelog

All notable changes to CatSuggest are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [2.2.0] - 2026-11-21

### Added

- Parent-cats suggestions now include Wikidata-derived categories from `P463` → `P6365`
  (member category) and `P39` → `P2354` → `P910` (position → corresponding list → topic
  category). These bypass `excludedTitleKeywords` but still respect all other filters.
  They show a Wikidata-logo icon with a tooltip instead of the usual language chip.

## [2.1.0] - 2026-11-21

### Added

- **Template namespace support (ns10)** in both modes:
  - Parent-cats mode on template pages writes categories to `Şablon:Foo/doc`'s
    `<includeonly>` when a doc page exists (following redirects and creating the
    block if needed), otherwise to the template's own `<noinclude>`.
  - Only additions are supported on templates; removals are disabled. Template
    subpages (`/doc`, `/sandbox`, `/testcases`, …) and non-wikitext templates are
    excluded.
  - Templates can now be suggested as category members on topical template
    categories, using the same `/doc`/`<noinclude>` edit path.
  - Templates whose category edit landed on `/doc` are null-edited afterwards so
    the category index updates immediately.
- Editability checks: pages the user cannot edit are filtered out of suggestions,
  and the launcher/button is disabled when the actual edit target is not editable.
- Sort keys: the key button toggles its popover, an "apply to all suggestions"
  checkbox was added, and the help text now lives in the popover title.
- Removal reasons are rendered as a marked list for readability.
- The available-languages list is now inside a `CdxAccordion`.

### Changed

- The help link moved from the footer into the dialog header.
- Members-mode UI strings are contextual on template categories: tab, accordion,
  descriptions, warning, confirmation dialog and batch-error text now say
  "Şablon…" instead of "Məqalə…".
- Dev mode is now build-time only (`--dev` / `npm run build`), so production
  bundles contain no dev authorization bypass. Watch rebuilds now pick up `.vue`
  component changes; the obsolete deploy guard and `nodemon` dependency were
  removed.
- Topical template categories participate in parent-cats suggestions and removal
  analysis; project/tracking template categories stay excluded.
- The gadget definition now needs `namespaces=0,4,10,12,14,100` and the icons
  `cdxIconReload` and `cdxIconSortVertical` in addition to the previous set.

### Fixed

- Topical template categories such as `Kateqoriya:Riyazi formatlama şablonları`
  are no longer silently filtered by the generic `şablonlar` exclusion keyword.
- Parent-cats suggestions are no longer empty on template categories.
- Tracking categories with only a capitalized `Şablonlar:` prefix can no longer
  accidentally enable members mode.
- Sort-key help URL and dev watch rebuilds.

### Tests

- Large test expansion covering template doc resolution, block/category parsing,
  redirects, edit deduplication, null-edit refresh, editability gating, template
  members and the contextual exclusion rules (145 tests passing).

## [2.0.0] - 2026-11-19

- Retroactive baseline tag for the commit preceding this changelog's range.

[Unreleased]: https://gitlab.wikimedia.org/nmw03/catsuggest/-/compare/v2.2.0...HEAD
[2.2.0]: https://gitlab.wikimedia.org/nmw03/catsuggest/-/compare/v2.1.0...v2.2.0
[2.1.0]: https://gitlab.wikimedia.org/nmw03/catsuggest/-/compare/v2.0.0...v2.1.0
[2.0.0]: https://gitlab.wikimedia.org/nmw03/catsuggest/-/releases/v2.0.0
