# 33 · Website CMS (packet DT-3) — local bilingual articles

Built 16 Oct 2026 (Claude Opus 5.5, single writer; Fable 5.1 plan; Codex review with Amendments A–D).
Route `/social/website` (More → Website, Tools hub "Articles (website CMS)", Quick Actions «موقع» / "website").

## Editor decision (tradeoff from the DT-3 plan)

Markdown textarea + `react-markdown`/`remark-gfm`, already installed and used by Notes, over the master plan's
TipTap aspiration. TipTap would add a new dependency family (prosemirror), a custom schema for callouts/sliders and a
JSON document format that is not portable to Obsidian, Hugo or Astro; Markdown is what the owner already writes in
Notes, exports as `.md`, and needs no new package. Rich blocks (before/after slider, download button) can come later
as Markdown directives if a public site needs them. Images: only `https://` URLs typed or pasted (no device
`img:<id>` references, which never leave this browser).

Search-before-building: `react-markdown` 10.1.0 and `remark-gfm` 4.0.1 (MIT, installed) are adopted for preview;
`mdast-util-from-markdown` 2.0.3 (MIT, react-markdown's own parser, already in the lockfile) is now a direct
dependency for the device-media check (Amendment C). TipTap rejected for this packet (see above).

## Data model

`lib/domain.ts` `ArticleSchema` (additive): `id`, `title {ar,en}`, `summary {ar,en}`, `body {ar,en}` (≤ 60 000 chars
each), `slug` (ASCII, "" while drafting), `category`, `tags` (≤ 12), `coverUrl` (https only), optional `skillId`,
`status` `draft | ready | archived`, `revision` (display counter), `commitId` (opaque, new on every committed content
or status change), `createdAt`, `updatedAt`, optional `archivedAt`.

`store/index.ts` (additive): `articles` in `PersistedStateSchema` (`.default([])`, so old backups import), in
`initialData()` and `pick()`; actions `addArticle`, `updateArticle(id, patch, base)`, `setArticleStatus`,
`restoreArticle(id, { newSlug? })`, all async through one transaction `commitArticles`:

- exclusive Web Lock `3z-prod-articles` (injectable via `setArticlesLock` for tests; no Web Locks →
  `unsupported-save`, nothing written, no fallback lock);
- inside the lock: validate the stored payload (missing/malformed → `not-persisted`, never an empty list), then
  `persist.rehydrate()` so the existing `merge` brings in every slice another tab wrote (settings, ideas, articles…);
- apply the mutation to that list (target by id; `commitId` + `articlesGeneration` must match the editor's base;
  missing target → `missing`, never recreated; siblings preserved);
- write, then read the new `commitId` back from localStorage (`articlePersisted`); a write the browser did not keep
  is rolled back so memory never runs ahead of storage (`not-persisted`, the editor keeps text and base).

`articlesGeneration` (not persisted) bumps on import and reset here, and on a rehydration whose library epoch changed
(another tab imported or reset). Another tab's edit of the same article is caught by its `commitId`; edits to other
articles never conflict. Two-tab sync uses the store's existing `followOtherTabs` (storage/pageshow → rehydrate).

`lib/articles.ts` (pure): `slugify`, `suggestSlug` (Arabic-only title → `draft-<id6>`), `articleIssues` (codes
`title-ar/en`, `body-ar/en`, `body-device-media` per language, `slug-empty`, `slug-format`, `slug-duplicate` among
non-archived others, `cover-not-https`), `hasDeviceMedia` (mdast walk of `image`/`definition` nodes, entities decoded,
code ignored), `searchArticles` (both languages, loose Arabic), `articleMarkdown` (YAML front matter with JSON-quoted
scalars + the source Markdown), `articleFileName`, `articlesExport` (`{ app: "3z-prod-articles", version: 1, … }`,
content only), `storageDurable`, `articlePersisted(storageKey, id, commitId)`.

## Behaviour

- Ready needs zero issues; any meaningful edit to a ready article returns it to draft (re-review); an identical save
  changes nothing (same status, revision and commit).
- Pending text is saved before Mark ready, Back to draft, Archive, Restore, Download and Back; the action stops on a
  conflict or failed save, and the text stays on screen. Autosave 400 ms; flush on unmount, `visibilitychange`
  hidden and `pagehide`; saves are chained so each starts from the previous commit.
- Conflict UI ("Load latest" / "Keep mine") for another tab's commit, an import or a reset; a removed article keeps
  the text visible for copying.
- Restore refuses a slug an active article already uses and names it; "Restore with a new slug" picks `-2`, `-3`…
- Preview: react-markdown + GFM, `skipHtml`, `urlTransform` allows http(s)/mailto/relative links and https images
  only; external links open with `rel="noopener noreferrer"`.
- No XP, gems, badges or quest completion anywhere in the CMS; the skill link only shows the Article quest text and
  opens the skill popup.

## Honest limits

- Articles live in this browser's localStorage until a website is connected; nothing is public and there is no
  "published" state. Copy says so on the list and in the editor.
- Saving needs Web Locks (current Chrome, Edge, Firefox, Safari). Without them the editor says it cannot save safely
  and keeps the text.
- Private mode / blocked storage: a banner warns; commits stay in memory only and are reported as not saved.
- Raw HTML in a body is not rendered by the preview and is not inspected by the device-media check; it stays in the
  exported source as typed.
- Cover and pictures are external https links: they stay external dependencies of any later site.
- There is no import of `articles.json` yet (export is versioned for a later import/migration); permanent delete is
  out of scope (archive is lossless).
- The other-tab check is serialized per article through the lock and commit ids; the rest of the store keeps its
  existing whole-state persistence (see `followOtherTabs`).
