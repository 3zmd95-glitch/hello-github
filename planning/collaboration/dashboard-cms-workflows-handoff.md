# Dashboard tools — packets DT-3 (CMS) and DT-4 (workflows) handoff

Companion to `dashboard-cms-workflows-review.md` (Codex acceptance; owner said "Build them",
16 Oct 2026). Roles: Fable plans, one Opus writer implements, Codex reviews/tests. Discover
packet 30 stays frozen in `current-task.md`; DT-1/DT-2 accepted files stay as frozen except
the DT-1 registry/dictionary rows this packet must update for the Website tool.

**Implementation owner: none.** (DT-4 frozen 16 Oct 2026 18:53 AST. Writer Claude Opus 5.5, single writer, 17:55–18:50 AST, plan plus Amendments A–E and the `{count}` label fix. DT-3 accepted 17:47 AST.)

**Repair round 1 (Fable ruling on `dashboard-cms-workflows-review.md` "DT-3 frozen independent
review — changes required", 17:30 AST; same writer, bounded, no new scope).**
Findings: (1) full-quota unsaved draft, sidebar Calendar, then reload/close: `useUnloadGuard`
lives in `WebsiteScreen`, so leaving the CMS route removes every `beforeunload` guard while a
memory-only stash exists. (2) article Web Lock held elsewhere; type A then newer B; sidebar
Calendar; reopen before release: the stash is written only after the async flush fails, so the
reopened editor shows old persisted text and no recovery prompt.
Ruling: (a) app-lifetime guard — the `unsavedDrafts` module subscribes to its own state and
registers/removes one `window` `beforeunload` handler whenever the stash map becomes
non-empty/empty, independent of any mounted screen (no AppShell edit); the editor's own dirty
guard stays. (b) synchronous stash on unmount — the editor cleanup stashes the latest fields
immediately when dirty, each stash carrying a monotonically increasing `token`; the deferred
flush (and any late lock-released commit) clears the stash only when `drafts[id].token` equals
the token it captured, so a newer stash from a remounted editor is never removed by an older
promise. (c) observe late updates — the reopened editor subscribes to `unsavedDrafts`; when its
stash is cleared by a confirmed matching save it drops the prompt and re-bases on the stored
article; when the store article changes while a stash is shown, the prompt stays (the owner
decides restore vs discard). Memory-only (quota) saves still never advance committed memory.
Regression coverage (RED first): jsdom — unmount with the injected lock held → stash present
synchronously, prompt visible on immediate remount with the latest text; older flush resolving
after a newer stash → newer stash intact; matching confirmed save clears its stash and the
prompt; guard registered after `WebsiteScreen` unmount while a stash exists, removed once the
stash clears. Browser (`e2e/website.spec.ts`, desktop project): port Codex's two adversarial
scenarios — full quota via a `Storage.prototype.setItem` override then sidebar Calendar →
`beforeunload` still `defaultPrevented`, reopen → `website-unsaved-prompt` → restore after quota
clears; second page holds the real Web Lock, type A then B, sidebar Calendar, reopen before
release → prompt shows B; release → B saved once, no duplicate. Then rerun the DT-3 check list,
rebuild `out/`, record, and freeze.

Worktree `C:/Users/AORUS/.codex/worktrees/discover-inspiration/hello-github`, branch
`codex/discover-inspiration`, HEAD `0e1fdb089146f4fd8e5f1d3c7cd58cf5b6fc6127`, uncommitted.
Served app: localhost:3000 from this worktree's `out/` (never restart; `pnpm build` refreshes).

## DT-3 plan — CMS at `/social/website` (Fable 5.1, 16 Oct 15:40 AST)

**Outcome.** A usable local article CMS: create, edit, search, preview, validate, export,
archive and restore bilingual articles that survive reload, backup and import. Honest states
only: `draft`, `ready`, `archived`. No public "published" state (the static export has no
hosting yet), no XP for opening, saving or exporting.

**Editor decision (recorded tradeoff; executor copies it into `planning/tools/33-website-cms.md`).**
Markdown textarea + `react-markdown`/`remark-gfm`, already installed and used by Notes, over the
master plan's TipTap aspiration. TipTap would add a new dependency family (prosemirror), a
custom schema for callouts/sliders and a JSON document format that is not portable to Obsidian,
Hugo or Astro; Markdown is what the owner already writes in Notes, exports as `.md`, and needs no
new package. Rich blocks (before/after slider, download button) can come later as Markdown
directives if a public site needs them. Images: only `https://` URLs typed or pasted (no device
`img:<id>` references, which never leave this browser).

**Data model (`lib/domain.ts`, additive).**
```ts
export const ARTICLE_STATUSES = ["draft", "ready", "archived"] as const;
export const ArticleStatusSchema = z.enum(ARTICLE_STATUSES);
const ArticleTextSchema = z.object({ ar: z.string().max(200), en: z.string().max(200) }); // empty allowed while drafting
export const ARTICLE_MAX_CHARS = 60_000;
export const ArticleSchema = z.object({
  id: z.string().min(1),
  title: ArticleTextSchema,
  summary: z.object({ ar: z.string().max(400), en: z.string().max(400) }).default({ ar: "", en: "" }),
  body: z.object({ ar: z.string().max(ARTICLE_MAX_CHARS), en: z.string().max(ARTICLE_MAX_CHARS) }),
  slug: z.string().max(80),                 // "" allowed while drafting; validated by articleIssues
  category: z.string().max(40).default(""),
  tags: z.array(z.string().min(1).max(30)).max(12).default([]),
  coverUrl: z.string().max(500).default(""), // https only (validated), never img:<id>
  skillId: z.string().min(1).optional(),
  status: ArticleStatusSchema.default("draft"),
  revision: z.number().int().min(1).default(1),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  archivedAt: z.iso.datetime({ offset: true }).optional(),
});
export type Article = z.infer<typeof ArticleSchema>;
```
Store (`store/index.ts`, additive only; Discover hunks untouched): `articles: z.array(ArticleSchema)
.default([])` in `PersistedStateSchema`, `articles: []` in `initialData()`, `articles: s.articles`
in `pick()`. Actions: `addArticle(input?: Partial<Pick<Article,"title"|"body"|"skillId">>): Article`;
`updateArticle(id, patch, baseRevision): { ok: true; article } | { ok: false; reason: "conflict" |
"missing" }` (increments `revision`, sets `updatedAt`; a `ready` article whose patched content has
issues drops back to `draft`); `setArticleStatus(id, "ready" | "draft" | "archived")` (`ready`
refused unless `articleIssues()` is empty → returns false); `restoreArticle(id)` (archived →
draft, clears `archivedAt`). Export `STORAGE_KEY` if not already exported (read-back check).
Old backups without `articles` import unchanged (the `.default([])` makes `ExportFileSchema`
accept them); new backups carry `articles` through `exportState` → `importState`.

**Pure logic (`lib/articles.ts`).** `slugify(text)` (ASCII `a-z0-9-`, ≤ 80, collapse dashes);
`suggestSlug(article)` (from `title.en`; Arabic-only titles get `draft-<id first 6>`; owner
edits it); `articleIssues(article, all): ArticleIssue[]` with codes `title-ar`, `title-en`,
`body-ar`, `body-en`, `slug-empty`, `slug-format`, `slug-duplicate` (among non-archived others),
`cover-not-https`; `searchArticles(query, articles)` over title, summary, tags, slug and body in
both languages via `normalizeForMatch` from `lib/replies`; `articleMarkdown(article, lang)` →
portable `.md` with YAML front matter (`title, slug, lang, category, tags, skill, cover, status,
updatedAt`) and the body; `articleFileName(article, lang)`; `articlesExport(articles)` →
`{ app: "3z-prod-articles", version: 1, exportedAt, articles }` (content only, no settings or
keys). `storageDurable(): boolean` probe (set/get/remove a probe key on `window.localStorage`,
false on throw or mismatch) and `articlePersisted(storageKey, id, revision): boolean` (reads the
persisted JSON from `localStorage`, true when that article revision is there) — both in
`lib/articles.ts`, no store import cycle (the key is a parameter).

**UI (`components/social/website/`, Social iOS look).**
- `WebsiteScreen.tsx`: `PageHeader` (`social.website.title`/`.sub`), honest limit line
  `website.localOnly` ("Articles live on this device until the website is connected; nothing
  is public"), storage warning banner when `!storageDurable()` (`website.storageBlocked`),
  search `px-input` (`website-search`), status filter `Segmented` (drafts / ready / archived),
  "New article" button (`website-new`) → `addArticle()` then `location.hash = "#a=<id>"`,
  list of `ListRow`s (title in the UI language, falling back to the other; chip = status;
  sub = updated time + slug), `EmptyState`. Hash `#a=<id>` opens the editor (same pattern as
  `NotesScreen`: `hashchange` + settle timeout; back button returns to the list).
  Export all: `website-export-all` downloads `articles.json` from `articlesExport`.
- `ArticleEditor.tsx`: back button; language tabs AR/EN (`Segmented`, `website-lang-ar/en`);
  fields title, summary, body (`textarea`, `dir` per language, `website-body`), slug
  (`dir="ltr"`, suggest button), category, tags (comma input), cover URL, skill link
  (`SkillPicker` from `components/social/calendar`, shows the skill's Article quest text and a
  Link to its skill popup; NO `completeQuest` call anywhere in DT-3); Write / Preview toggle
  (`website-preview`) rendering `ArticleMarkdown` for the active language with title, summary,
  cover; issues list (`website-issues`, one line per issue, each focusing its field); actions
  "Mark ready" (`website-ready`, disabled while issues exist, tooltip = first issue), "Back to
  draft", "Archive" / "Restore" (`website-archive`/`website-restore`), "Download AR .md" /
  "Download EN .md" (`website-download-ar/en`). Save status line `website-save-status`:
  `saving` → `saved ✓ HH:MM` only after `articlePersisted(...)` is true; `notPersisted` when the
  store updated but storage did not keep it; `conflict` with "Load latest" / "Keep mine" buttons
  when `updateArticle` returns conflict (two tabs, late timer). Autosave: `SAVE_DELAY_MS` like
  Notes, flush on unmount, on `visibilitychange` hidden and on `pagehide`; a flush after the
  article was archived/removed is dropped, never resurrected. Two tabs: `WebsiteScreen` listens
  to `window` `storage` events for the store key and calls `useStore.persist.rehydrate()`
  (debounced 300 ms); the editor compares `baseRevision` and shows the conflict state instead of
  overwriting.
- `ArticleMarkdown.tsx`: `react-markdown` + `remark-gfm`; `urlTransform` allows only `http(s):`,
  `mailto:` and relative/hash links; images only `https:`; `[[wiki]]` not supported; external
  links `rel="noopener noreferrer" target="_blank"`. Treat content as untrusted (no raw HTML).
- `app/social/website/page.tsx` renders `WebsiteScreen`. `SoonScreen` keeps only `business`.
- Navigation: `components/shell/nav.ts` website item drops `soon: true` (keep `desktopOnly`);
  `MoreScreen.tsx` Social website row loses the soon chip; `lib/tools.ts` website row becomes
  `group: "publish"`, state `available`, `href: "/social/website"`, copy "Articles (website CMS)"
  with the honest "on this device" description; the planned list keeps Business kit, Workflow
  builder, Conversations inbox. Quick Actions picks it up automatically.
- Copy: new pair `messages/website.ar.json` + `website.en.json` (keys `website.*`), registered
  in `lib/i18n.ts`; Hijazi Arabic first. Existing `social.website.*` keys unchanged.

**Tests (behaviour, RED first).**
- `lib/articles.test.ts`: slugify/suggestSlug; every issue code; duplicate slug ignores archived
  and self; search finds by Arabic and English title/tag/body; `articleMarkdown` front matter +
  body and no `img:` reference; `articlesExport` contains no `settings`/`apiKeys`; `storageDurable`
  false when `setItem` throws; `articlePersisted` true/false against a stubbed storage value.
- `store/index.test.ts` (append): old export JSON without `articles` imports and yields `[]`;
  export → import roundtrip keeps articles; `pick()` includes `articles`; `updateArticle` with a
  stale `baseRevision` returns conflict and leaves the article unchanged; `setArticleStatus(id,
  "ready")` refused with issues, accepted without; a `ready` article edited into an invalid
  state becomes `draft`; `restoreArticle` clears `archivedAt`; no `xpEvents`/`completions`
  change across add/update/status/export.
- `components/social/website/WebsiteScreen.test.tsx` + `ArticleEditor.test.tsx` (jsdom, both
  languages): create → editor opens with hash; typing autosaves and the status reaches
  `saved ✓` (storage stubbed durable) and `notPersisted` when the stub drops writes; conflict UI
  appears when the store revision moves under the editor; Mark ready disabled with issues,
  enabled after fixing; archive hides from drafts and shows under archived; restore; preview
  renders headings/lists but strips raw HTML and rejects `img:`/`javascript:`; downloads build a
  Blob with the front matter; `fetch` spy never called.
- `e2e/website.spec.ts` (phone + desktop): More → Website opens the CMS (no "soon" chip);
  new article → `#a=` hash → type AR title/body, switch EN tab, type → reload → both present;
  search by Arabic and by English; preview tab shows rendered `h2`; Mark ready disabled, fill
  slug/summary → enabled → status chip "Ready" and the "nothing is public" line visible;
  download EN `.md` → file content has `slug:` and the body; archive → list empty under drafts,
  present under archived → restore; phone back button from editor returns to list; Quick Actions
  "website"/«موقع» opens `/social/website/`; Tools hub row for Website is `available` and no
  planned chip; RTL/LTR direction of the body textarea follows the language tab; no horizontal
  overflow; request filter (no `workers.dev`, `/api/local-ai/`, non-localhost except Google
  Fonts). Regression: `e2e/settings.spec.ts` (export/import), `e2e/world.spec.ts`,
  `e2e/tools.spec.ts`, `e2e/quick-actions.spec.ts`.

**Checks before freeze.** `pnpm vitest run lib/articles.test.ts store components/social/website
components/shell components/tools messages lib/tools.test.ts`, `pnpm lint`, `pnpm typecheck`,
prettier `--check` on changed files, `pnpm build`, `pnpm e2e e2e/website.spec.ts
e2e/settings.spec.ts e2e/world.spec.ts e2e/tools.spec.ts e2e/quick-actions.spec.ts`.

**Allowed files.** New: `lib/articles.ts`, `lib/articles.test.ts`, `components/social/website/
{WebsiteScreen,ArticleEditor,ArticleMarkdown}.tsx` + tests, `messages/website.ar.json`,
`messages/website.en.json`, `e2e/website.spec.ts`, `planning/tools/33-website-cms.md`. Edited
(additive): `lib/domain.ts`, `store/index.ts`, `store/index.test.ts`, `lib/i18n.ts`,
`app/social/website/page.tsx`, `components/social/SoonScreen.tsx`, `components/shell/nav.ts` +
`nav.test.ts`, `components/shell/MoreScreen.tsx` + `MoreScreen.test.ts`, `lib/tools.ts` +
`lib/tools.test.ts`, `messages/tools.ar.json` + `tools.en.json`, this handoff. Nothing under
`components/research`, `components/discover`, `lib/discover*`, `extensions/`, `workers/`,
`scripts/`, `components/notes/` (read only), `current-task.md`, or any Codex review file.

**Rulings.** (1) `store/index.ts` and `lib/domain.ts` carry Discover Freeze 24 hashes; additive
article hunks are unavoidable for persistence, so those two hashes become historical for the
Discover record while every Discover hunk stays byte-identical (Codex verifies by hunk).
(2) No automatic Article-quest completion or XP: the skill popup's own quest flow stays the only
path. (3) Slugs ASCII only; Arabic-only titles get `draft-<id6>` until edited. (4) Archive, not
delete, in DT-3 (restore is lossless; permanent delete is YAGNI). (5) Two-tab sync via
`persist.rehydrate()` on `storage` events, scoped to the Website screen; conflicts surface in
the editor instead of silent overwrite. (6) Executor: Opus 5.5 (store/schema/concurrency).

**Amendment A (Codex early design review, received 15:35 AST; same writer, no new scope).**
Timestamps: plan was written about 15:30 AST and the executor dispatched about 15:34 AST (the
15:40/15:45 stamps above were approximate; the freeze uses observed times).
1. Readiness lifecycle: any meaningful editorial edit (title, summary, body, slug, category, tags,
   cover, skill) to a `ready` article returns it to `draft` even when still valid, so the owner
   re-reviews deliberately and DT-4's `article-ready` event fires once per real readiness. A
   no-op save (identical content) keeps status and `revision` unchanged. `setArticleStatus(id,
   "ready")` still requires zero issues.
2. Pending text first: Archive, Mark ready, Download, Export all, Back and route changes resolve
   and flush the editor's pending text BEFORE acting (type → Archive → Restore keeps the last
   sentence). On conflict or persistence failure the action stops and the text is preserved in
   the editor with the conflict/notPersisted state. Import, reset and another tab's replacement
   of the article (revision moved underneath or article gone) invalidate stale pending writes
   instead of applying them.
3. Export semantics: `articleMarkdown` exports the SOURCE Markdown (what the owner typed), not the
   sanitized render; YAML front-matter scalars are emitted as JSON-style double-quoted strings
   (safe for quotes, newlines, `---`, `#`, `:`); `articleIssues` adds `body-device-media` when the
   body references device-only media (`img:` scheme, `blob:`, `data:` images) and the issues list
   names the language; the React preview stays the safe renderer (`react-markdown` allowlist), no
   hand-written regex HTML sanitizer. `/social/automations` stays AutoPost; workflows get their own
   route in DT-4.
Tests to add (RED first): ready article + meaningful edit → draft; ready + identical save →
still ready, same revision; type then Archive immediately → stored body has the last sentence
and Restore shows it; conflict during Archive keeps text and does not archive; front matter with
a title containing `"` `:` and a newline parses back (simple assertion on the quoted scalar);
body with `![x](img:abc)` → `body-device-media` issue and Mark ready disabled.

**Amendment B (Codex persistence review, findings 4–5, received 15:36 AST; same writer, CMS
scope only, Discover behaviour untouched).**
1. Numeric `baseRevision` alone allows an ABA overwrite (editor holds A/rev3; an import restores
   a different A/rev3; stale pending text passes). Replace the guard with an opaque commit
   identity: `ArticleSchema` gains `commitId: z.string().min(1)` (fresh `newId()` on every
   committed content or status change, archive and restore). Editors capture `{ commitId,
   generation }` as their base; `updateArticle(id, patch, base)` rejects when either differs.
   `generation` is a non-persisted store counter (`articlesGeneration`) bumped by `importState`,
   `reset`, and by `merge` whenever rehydration brings different `articles` (another tab's write
   or import). Pending editor writes captured under an older generation are invalid: dropped,
   with the text retained on screen and the conflict state shown.
2. Serialize through the shared storage, not a new listener: `followOtherTabs()` already
   rehydrates on `storage`/`pageshow`; drop the planned debounced Website listener. Before
   committing, `updateArticle` compares the article's `commitId` in `localStorage` (read the
   persisted JSON for `STORAGE_KEY`) with the editor's base: a different stored `commitId` means
   another tab committed first (storage event not delivered yet) → conflict, trigger
   `rehydrate()`, keep the text. Saved verification compares the unique `commitId` the editor
   just wrote (`articlePersisted(storageKey, id, commitId)`), never only id + revision.
3. Tests: ABA — base A/rev3/commit X, import a file holding A/rev3 with commit X (same export)
   → generation differs → stale write rejected, text retained; two editors on the same base, the
   first commits, the second's write is rejected even before any storage event (simulate by
   writing the first commit to the stubbed localStorage only), then a delivered storage event
   rehydrates and the conflict UI offers Load latest / Keep mine; `articlePersisted` false when
   storage holds the same id and revision but a different `commitId`; status/archive/restore
   change `commitId`; import/reset bump `generation` and invalidate a pending flush.

**Amendment C (Codex implemented-code review, received 15:43 AST; same writer, source fixes
only, no new feature scope).**
1. One shared transaction for every CMS mutation (`addArticle`, `updateArticle`,
   `setArticleStatus`, `restoreArticle`): `commitArticles(mutate)` in the store, async. Acquire a
   cross-tab lock — `navigator.locks.request("3z-prod-articles", …)` when available, else a
   localStorage token lock (`3z-prod-articles-lock` = own token + timestamp, read back to confirm
   ownership, 2 s expiry) for jsdom and older browsers. Inside the lock: read the FRESH persisted
   `articles` from `localStorage[STORAGE_KEY]` (shared truth; fall back to the in-memory list when
   storage is unavailable), apply the mutation against that fresh list (target by id; for update
   the target's `commitId` must equal the base → else `conflict`; target absent → `missing`,
   never recreated; remote siblings preserved untouched), write the merged list into the store,
   read back and confirm the new `commitId` is persisted (else `not-persisted`), bump
   `articlesGeneration` whenever the fresh list differed from the in-memory one so other editors in
   this tab re-base. The old getItem/check/setItem sequence and any whole-list overwrite from
   stale memory are removed.
2. Restore vs active slug: `restoreArticle` refuses when another non-archived article has the same
   slug → `{ ok: false, reason: "slug-duplicate", conflictsWith }`; the UI says which article
   holds the slug and offers "Restore with a new slug" (`-2`, `-3`, … until free) as an explicit
   second button. Restoring never produces two active articles with one slug.
3. Device-media detection by parser, not regex: parse the body with
   `mdast-util-from-markdown` (react-markdown's own parser; add it to `package.json` at the
   transitive version already in the lockfile, `2.0.3`, with `pnpm install --offline` — no new
   library family, no download) and walk `image`, `imageReference`/`definition` nodes; flag
   destinations whose scheme is `img:`, `blob:` or `data:` after decoding HTML entities; fenced
   code and inline code are not flagged; nested alt text is irrelevant to the node's `url`.
4. Tests (RED first): overlapping writes — two mutations on the same base, the second rejected
   with `conflict`; update while the stored target is missing (another tab archived+removed or
   import dropped it) → `missing`, in-memory list not overwritten; remote sibling B edited in
   storage, unchanged A saved → B's stored edit survives in the merged list; create while
   storage holds a newer list → new article appended to the fresh list, siblings intact;
   restore with an active duplicate slug → refused with `conflictsWith`, then "Restore with a
   new slug" yields `x-2`; `body-device-media` true for `![a ![b](x)](img:1)` and
   `![a](&#105;mg:1)` and `[a]: img:1` reference definitions, false for the same text inside a
   fenced block or inline code.

**Amendment C.1 (Codex clarification, 15:45 AST).** No localStorage token lock: set/read-back is
not atomic across tabs and a 2 s expiry can admit a second writer. `commitArticles` uses Web
Locks only (`navigator.locks.request("3z-prod-articles", { mode: "exclusive" }, …)`; localhost
Chrome supports it). The lock interface is injectable (`articlesLock` parameter / module setter)
so unit tests pass a fake lock that can hold and release deterministically. When Web Locks are
unavailable the mutation returns `{ ok: false, reason: "unsupported-save" }`, the editor shows a
recoverable "This browser cannot save safely; copy your text or use Chrome" state and keeps the
text — no claim of protected writes, no fallback lock (a genuine IndexedDB transaction would be
the alternative; out of scope here). Unavailable or malformed persisted storage is never an
authoritative empty list: when `localStorage[STORAGE_KEY]` is missing or fails to parse,
reconcile against the in-memory list only if storage is confirmed unavailable
(`storageDurable() === false`); a malformed value with storage available → `not-persisted`,
text retained. Tests: fake lock serializes two overlapping commits (second sees the first's
commitId → `conflict`); no `navigator.locks` → `unsupported-save` and the article unchanged;
malformed stored JSON → `not-persisted`, in-memory list untouched.

**Amendment D (Codex transaction follow-up on store hash `8bc31abe…`, received 15:54 AST; same
writer, source fixes only).**
1. Whole-payload reconciliation at the commit boundary: `freshArticles` reading only `articles`
   and then `setState` re-persists every other stale top-level slice (remote `settings.lang`, a
   new idea from another tab are clobbered by an unchanged-A save). Inside the lock, when storage
   is available, first `await useStore.persist.rehydrate()` so the existing `merge` (with its
   Discover candidate/epoch semantics, `ensureBuiltInRewards`, settings merge) brings the FULL
   persisted payload into memory; then apply the article mutation to `getState().articles`. No
   second merge implementation; no slice is written from stale memory.
2. Durable-before-committed: zustand persist updates memory before `setItem`, so a quota failure
   leaves memory at commit Y while disk holds X; a retry from Y conflicts and the next rehydrate
   drops Y. After `set`, the read-back check (`articlePersisted(STORAGE_KEY, id, commitId)`) is
   authoritative: on failure, roll the store back to the pre-commit `articles` list (memory = disk
   X) while still holding the lock, return `{ ok: false, reason: "not-persisted" }`, and the
   editor keeps its text and its base (X) so a plain retry can succeed once space is free.
   Committed memory never runs ahead of disk.
3. Tests (RED first): remote tab changed `settings.lang` to `en` and added an idea in storage;
   this tab saves unchanged A → stored payload keeps `lang: "en"` and the idea, A's commit lands;
   Discover `discoverLibraryEpoch`/candidates unchanged by a CMS commit; `setItem` throws
   (quota) once → `not-persisted`, memory articles still at commit X, editor base X retained;
   `setItem` works again → retry from base X succeeds with a new commit Y; a stale retry from a
   never-persisted Y is impossible because Y never exists in memory.

**Amendment E (Codex complete UI review, five confirmed source paths, received 16:04 AST; same
writer, no new feature scope).**
1. P1 storage probe: a commit succeeds ONLY when the read-back from `localStorage` confirms the
   new `commitId`. There is no memory-only success branch: a failed probe (quota full) or a
   blocked storage API returns `{ ok: false, reason: "not-persisted" }` (or `storage-blocked`),
   committed memory and the editor base do not advance, `dirty` stays true, text stays on screen.
   The banner plus the unsaved-draft export (item 4) are the rescue. Test: probe fails with a
   full-quota `setItem` throw → rejected, memory at X, Back/rehydrate cannot lose the text.
2. P1 action window: while an action is pending (flush + status/archive/restore/ready), the editor
   fields are `readOnly` with `aria-busy="true"` and the action buttons disabled, from click until
   the result settles and the editor re-bases on the returned article. Typing during the window is
   impossible, so a settle can never overwrite later text. Test: hold the injected lock, click
   Archive, attempt to type → field read-only; release → archived with text A; nothing lost.
3. P1 navigation: unmount (sidebar, Quick Actions, hash Back) awaits the flush; a failed or
   conflicted flush stashes the draft in a module-level `unsavedDrafts` map (`id → { fields, base,
   reason, at }`, in memory for the SPA session). The list shows an "unsaved draft" chip for such
   ids; reopening offers "Restore unsaved draft" / "Discard" before editing. A `beforeunload`
   handler (`preventDefault` + `returnValue`) is attached while the editor is dirty or a stash
   exists, detached otherwise. Test: force a conflict, navigate away via hash Back, reopen → the
   restore prompt shows the lost sentence; after a clean save no `beforeunload` guard.
4. P2 download rescue: Download AR/EN and Export all never block on the flush. They export the
   editor's CURRENT text; when unsaved changes are included, the file name gets `-unsaved` and the
   UI line says "includes unsaved changes · not saved on this device"; the save status never says
   Saved because of a download. Test: flush failing → download still produces the current text with
   the `-unsaved` name.
5. P2 preview anchors: footnote/return links (`#user-content-fn-…`) and any same-page `#` link in
   `ArticleMarkdown` are intercepted: `preventDefault`, `scrollIntoView` on the target inside the
   preview, `location.hash` untouched. `WebsiteScreen` additionally treats a hash that is neither
   empty nor `#a=<id>` as "keep the current editor open". Test: click a footnote link in preview →
   editor stays, hash unchanged, target scrolled.

## DT-4 plan — workflow builder at `/social/workflows` (Fable 5.1, 16 Oct 17:52 AST)

Acceptance: `dashboard-cms-workflows-review.md` → "DT-4 integration checks prepared during CMS
implementation" (six checks) and "DT-4 commit boundary clarification". `/social/automations`
(AutoPost) is untouched; workflows get their own route.

**Outcome.** Saved workflows with a trigger (`manual` or `article-ready`) and 1–5 ordered
actions that create real local drafts (idea, calendar post, planner item) from the owner's
content; pure preview (dry run), Run now, pause/resume, persisted run history with per-step
receipts and output links, Retry from the original snapshot without duplicating outputs; AR/EN,
phone/desktop. Honest copy: runs execute only while this browser is open on this device
(queued runs continue when Workflows or Website is opened); nothing is scheduled in the cloud;
no post, reply, provider call, AI call or XP.

**Data model (`lib/domain.ts`, additive).**
```ts
export const IDEA_SOURCES = ["audience", "trend", "skill", "me", "workflow"] as const; // + "workflow" (ideas.source.workflow AR/EN)
const TemplateText = z.object({ ar: z.string().max(500), en: z.string().max(500) }); // placeholders {title} {summary} {slug} {date}
export const WorkflowTriggerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("manual") }),
  z.object({ kind: z.literal("article-ready") }),
]);
export const WorkflowActionSchema = z.discriminatedUnion("kind", [
  z.object({ id: z.string().min(1), kind: z.literal("idea"), text: TemplateText, platform: PlatformSchema.optional() }),
  z.object({ id: z.string().min(1), kind: z.literal("post"), platform: PlatformSchema, title: TemplateText, caption: TemplateText, offsetDays: z.number().int().min(0).max(30).default(1) }),
  z.object({ id: z.string().min(1), kind: z.literal("plan"), quest: QuestTypeSchema, skillId: z.string().min(1).optional() /* else the article's skill */, minutes: z.number().int().min(5).max(120).default(30), day: z.union([z.number().int().min(0).max(6), z.literal("lightest")]).default("lightest") }),
]);
export const WorkflowSchema = z.object({
  id, name: z.object({ ar: z.string().max(80), en: z.string().max(80) }), trigger: WorkflowTriggerSchema,
  actions: z.array(WorkflowActionSchema).min(1).max(5), enabled: z.boolean().default(true),
  revision: int ≥1 default 1, commitId: z.string().min(1), createdAt, updatedAt,
});
export const WorkflowRunSchema = z.object({
  id, workflowId, kind: z.enum(["manual", "article-ready"]), status: z.enum(["queued", "running", "done", "partial", "failed"]),
  attempt: int ≥1 default 1, startedAt, updatedAt, finishedAt?,
  snapshot: z.object({ workflow: WorkflowSchema, input: z.object({ articleId?, title: {ar,en}, summary: {ar,en}, slug, skillId?, lang: LangSchema, day: DAY_KEY }) }),
  steps: z.array(z.object({ actionId, status: z.enum(["pending", "done", "failed", "skipped"]), outputKind: z.enum(["idea","post","plan"]).optional(), outputId?, error: z.string().max(300).optional(), at? })),
});
```
Store: `workflows: []`, `workflowRuns: []` in `PersistedStateSchema` (`.default([])`), `initialData`,
`pick()`; runs capped at 200 (oldest finished pruned inside the commit). Old backups import.

**Shared commit (store, generalize — Codex clarification).** Rename the body of
`commitArticles` into `commitFresh<T>(mutate: (state: PersistedState) => { patch: Partial<PersistedState>; result: T; persistedCheck: () => boolean } | { result: T })`
under the SAME Web Lock name `3z-prod-articles` (one root storage key → one lock; keep the
name for compatibility and document it), same `storageDurable()`/`storedPayloadValid()` gate,
`await persist.rehydrate()`, `setState(patch)`, authoritative read-back via `persistedCheck`
(a stored `commitId`/output id), rollback to the pre-commit slices on failure, `articlesGen`
bump when the fresh list differed. `commitArticles` becomes a thin wrapper. Every workflow
mutation (`addWorkflow`, `updateWorkflow(id, patch, base)`, `setWorkflowEnabled`,
`runWorkflowNow`, `retryWorkflowRun`, `drainWorkflowRuns`) uses `commitFresh`.

**Article-ready trigger (same durable commit).** Inside `setArticleStatus`'s mutation, when the
transition is draft→ready and `articleIssues` is empty, the SAME patch also appends one `queued`
run per enabled workflow with trigger `article-ready` (snapshot = that workflow definition +
input from the article, `lang` = current UI language, `day` = Riyadh `dayKey(now)`). Unchanged
Ready (`a.status === status`), import, hydration, reload, failed persistence (rolled back) and
paused workflows enqueue nothing. Re-marking Ready after a material edit (which demoted it to
draft) is a new transition and enqueues again. After the commit resolves ok, the store calls
`drainWorkflowRuns()` (fire-and-forget, result ignored by the CMS UI).

**Execution (`drainWorkflowRuns`).** Picks `queued` runs (and `running` runs with no step update
for > 60 s: reload/crash recovery) and executes steps IN ORDER, one `commitFresh` per step:
the step's output record and its receipt are written in the same patch; output ids are
deterministic `wf:<runId>:<actionId>` so a step whose output already exists in the fresh state
is marked `done` with that id instead of creating a second one (crash-between-output-and-receipt
reconciliation and retry idempotency). A failed step records `error`, marks later steps
`skipped`, and the run `failed` (no output) or `partial` (some outputs). Outputs are built
inside the mutation from the snapshot, never through `addIdea`/`addPost`/`addPlanItem` (random
ids): idea `{ id, text: template(lang), source: "workflow", skillId?, platform?, createdAt }`;
post `PostSchema.parse({ id, platform, title, caption, stage: "idea", plannedDay: addDays(day,
offsetDays), skillId?, hashtags: suggestHashtags(platform, skill), createdAt, updatedAt })`;
planner row `{ id, week: weekKey(day), day: chosen or lightestDay(current overlaid plan),
skillId, quest, minutes, by: "me" }` appended with id-dedupe (never `setPlanItems`, so owner
rows and tombstones survive; `by: "me"` + minutes > 0 makes it visible in `applyOverlay`).
`retryWorkflowRun(runId)` re-drains that run from its ORIGINAL snapshot (`attempt + 1`,
`kind` unchanged), reusing successful outputs; `runWorkflowNow(id)` enqueues a fresh `manual` run
with a new snapshot (distinct from retry). Two tabs: all under the one lock; a run already
`done` in fresh state is skipped.

**Preview (dry run).** `previewRun(workflow, input, state)` in `lib/workflows.ts` is pure: returns
the would-be outputs (kind, rendered text, target day/week/platform) and validation issues; no
store call, no `storageDurable` probe, no network. The UI "Preview" button only renders it.

**Validation (`workflowIssues`).** name empty in both languages; no actions / > 5; idea text empty
in both languages; post title empty; plan action without a resolvable skill (no `skillId` and
trigger `manual`, which has no article); template placeholder unknown. Saving with issues is
allowed (draft), Run now and article-ready enqueue require zero issues (checked in the commit).

**UI (`components/social/workflows/`, Social iOS look).** `WorkflowsScreen.tsx`: `PageHeader`,
honest limit line `workflows.localOnly`, "New workflow" (`workflows-new`), list rows (name,
trigger chip, enabled/paused chip, last run status), hash `#w=<id>` opens `WorkflowEditor.tsx`;
on mount calls `drainWorkflowRuns()` once. Editor: name AR/EN, trigger `Segmented`
(manual / article-ready with explanatory copy), ordered action cards (add ≤ 5, remove, move
up/down, per-kind fields), enabled `Switch` (paused shows "Run now disabled while paused"),
buttons Preview (`workflows-preview`, renders `previewRun` for a sample input: for
article-ready the most recent ready article or a placeholder), Run now (`workflows-run`,
disabled with issues or paused), Save (autosave like CMS: pending text flushed before actions;
`commitId`/generation base; conflict state). Runs panel (`workflows-runs`): rows with kind
(manual / article-ready / retry attempt n), status, started time, per-step list with output
links — idea → `/social/ideas/`, post → `/social/calendar/#post=<id>`, plan →
`/planner/` — and Retry (`workflows-retry`) for `partial`/`failed`. `WebsiteScreen` mount also
calls `drainWorkflowRuns()` (one line). Route `app/social/workflows/page.tsx`. Navigation:
`nav.ts` Social item `nav.workflows` (`Workflow` icon, `desktopOnly`), `MoreScreen` Social row
after Automations, `lib/tools.ts` workflows row `publish`/`available` → `/social/workflows`
(planned list keeps Business kit + Conversations inbox). Copy pair `messages/workflows.*.json`
(+ `ideas.source.workflow` in `ideas.*.json`, workflows row in `tools.*.json`), Hijazi first.

**Tests (RED first).** `lib/workflows.test.ts`: template rendering (both languages, unknown
placeholder issue), deterministic ids, `previewRun` purity (no store/localStorage access via
spies), planner row builder (`by: "me"`, minutes, lightest day), `workflowIssues` matrix.
`store/index.test.ts`: old export without `workflows`/`workflowRuns` imports; roundtrip; Ready
transition enqueues exactly one run per enabled article-ready workflow in the same commit
(rolled back together when the read-back fails); unchanged Ready / paused / import / rehydrate
enqueue none; drain creates idea + post + plan rows with deterministic ids, planner owner rows
and tombstones preserved, overlay shows the new row; step 2 forced failure (injected) → `partial`,
step 3 `skipped`, outputs of step 1 kept; edit workflow and article, then Retry → original
snapshot used, no duplicate output, step 2 done; crash gap simulation (output present, receipt
missing) → reconciled without a second output; two drains under the fake lock → one set of
outputs; Run now while paused refused; runs pruned at 200; no `xpEvents`/`completions` change.
`components/social/workflows/*.test.tsx` (jsdom, ar + en): create → editor via hash; add/reorder/
remove actions; preview renders outputs and writes nothing (`setItem` spy); Run now → run row
with links; Retry visible on partial; pause disables Run now with explanation; conflict state.
`e2e/workflows.spec.ts` (phone + desktop): More → Workflows; create a manual workflow with idea
+ post + plan; Preview shows three items and `localStorage` unchanged; Run now → idea appears
in `/social/ideas/`, post card in `/social/calendar/#post=<id>`, planner row visible in
`/planner/` with the "you" chip; reload → run history persists; create an article-ready workflow,
mark an article Ready in `/social/website/` → run appears with outputs; marking Ready again
(unchanged) adds no run; pause → Ready adds no run; request filter (no `workers.dev`,
`/api/local-ai/`, non-localhost except Google Fonts); RTL/LTR; no overflow. Regression:
`e2e/autopost.spec.ts`, `e2e/website.spec.ts`, `e2e/planner.spec.ts`, `e2e/ideas.spec.ts`,
`e2e/calendar.spec.ts`, `e2e/settings.spec.ts`, `e2e/world.spec.ts`, `e2e/tools.spec.ts`,
`e2e/quick-actions.spec.ts`.

**Checks before freeze.** `pnpm vitest run lib/workflows.test.ts lib/articles.test.ts store
components/social/workflows components/social/website components/shell components/tools
messages lib/tools.test.ts`, `pnpm lint`, `pnpm typecheck`, prettier `--check`, `pnpm build`,
the e2e list above.

**Allowed files.** New: `lib/workflows.ts` + test, `components/social/workflows/*` + tests,
`app/social/workflows/page.tsx`, `messages/workflows.ar.json` + `.en.json`,
`e2e/workflows.spec.ts`, `planning/tools/34-workflows.md`. Edited (additive): `lib/domain.ts`,
`store/index.ts` (+ `commitFresh` generalization, `setArticleStatus` enqueue, drain),
`store/index.test.ts`, `lib/i18n.ts`, `components/social/website/WebsiteScreen.tsx` (one drain
call), `components/shell/nav.ts` + test, `MoreScreen.tsx` + test, `lib/tools.ts` + test,
`messages/tools.*.json`, `messages/ideas.*.json`, `components/tools/ToolsScreen.test.tsx`,
`components/shell/QuickActions.test.tsx`, `e2e/tools.spec.ts`, `e2e/world.spec.ts` only if the
new nav item changes its expectations, this handoff. Nothing under `components/research`,
`components/discover`, `lib/discover*`, `extensions/`, `workers/`, `scripts/`,
`components/social/AutoPostScreen.tsx`, `components/social/calendar/AutoPostTab.tsx`, `lib/publish.ts`,
Codex review files, or Codex's temp evidence (use separate output paths if a Codex spec is rerun).

**Amendment A (Codex early plan clarification, 17:52 AST; same writer, no scope change).**
1. Generation rule stays as accepted in DT-3: `articlesGen` bumps only on import, reset and a
   replacement epoch (another tab's import seen through the library epoch), never on ordinary
   remote sibling edits. The phrase "`articlesGen` bump when the fresh list differed" in the
   shared-commit paragraph above is stale; `commitFresh` must not add such a bump.
2. Durable proof per run mutation: every workflow/run commit's `persistedCheck` must prove the
   exact new receipt/run state — each `WorkflowRun` carries a `commitId` (fresh `newId()` on every
   run mutation: enqueue, step done/failed/skipped, retry attempt) and the read-back compares the
   stored run's `commitId` (and `Workflow.commitId` for workflow edits). Output-id existence is
   never the proof: during retry/reconciliation the output pre-exists while the new receipt write
   can fail, so an output-exists read-back would accept a failed persistence. Rollback on
   failure restores the pre-commit `workflowRuns` (and any output slice touched). Tests: quota
   failure (stub `setItem` throw) during a reconciliation step whose output already exists →
   `not-persisted`, run unchanged in memory, no duplicate output; quota failure during the
   retry transition (`attempt + 1`) → attempt unchanged, retry still available; recovery after
   storage clears succeeds exactly once.

**Amendment B (Codex early candidate findings on `lib/workflows.ts 527484a0…`, `lib/domain.ts
571ec072…`, 18:05 AST; same writer, no new scope).**
1. P2 `previewRun` ordering: the preview currently builds later successes after an earlier
   failed step (article with empty optional summary, idea template `{summary}` then post
   `{title}` → preview shows idea error plus a successful post, while the executor would skip
   the post). Preview must mirror execution: the first failing step is `failed`, every later
   step `skipped` with no rendered output, exactly like `drainWorkflowRuns`. Regression test for
   that repro in `lib/workflows.test.ts`.
2. P2 duplicate action ids: `WorkflowSchema` and `workflowIssues` accept two actions with the same
   `id`, so outputs collide at `wf:<runId>:a1` and the second output silently reconciles to the
   first. Reject duplicate action ids in the schema (`superRefine` on `actions`), in
   `workflowIssues` (`action-duplicate-id`), and in captured run snapshots (a run whose snapshot
   has duplicate ids is `failed` before any step, never executed). The editor assigns fresh
   unique ids on add. Tests: schema parse of two `a1` actions fails; import of a backup holding
   such a workflow is refused by the schema (old backups without workflows still import);
   `workflowIssues` reports the duplicate; drain on a tampered snapshot with duplicates writes no
   output and marks the run failed with that error.

**Amendment C (Codex early engine findings on store snapshot `abf4fe01…`, 18:16 AST; same
writer, no new scope).**
1. P2 Run now on an article-ready workflow captured an empty manual input, so `{title}`/`{summary}`
   placeholders and the implicit article skill passed validation yet produced incomplete output
   ("Post: {title}" → "Post:"). Ruling: `runWorkflowNow(id, { articleId? })` captures explicit
   article input exactly as Preview does — for trigger `article-ready` an `articleId` of an existing
   non-archived article is required (`{ ok: false, reason: "needs-article" }` otherwise); the UI
   offers a picker defaulting to the most recent ready article and disables Run now with the copy
   `workflows.needsArticle` when none exists. For trigger `manual`, article placeholders and an
   implicit article skill are `workflowIssues` codes (`placeholder-needs-article`,
   `skill-needs-article`), so Run now is refused with issues. Tests cover the public store action,
   not only the UI.
2. P2 stranded runs after reload: `drainStep` skipped persisted `running` runs younger than 60 s
   (own-run set empty after reload) and the screen drains once on mount, so a reload right after
   step one strands the rest. Ruling: steps are atomic and idempotent under the shared lock, so
   drop the age guard — drain resumes any `queued` or `running` run from its first `pending` step,
   re-reading fresh state per step; a step that fails with `not-persisted` leaves the run
   `running` with `lastError: "not-persisted"` and the run row shows **Resume** (same attempt,
   distinct from Retry which increments `attempt` after `partial`/`failed`). Drain triggers:
   Workflows and Website mount, `visibilitychange` → visible on the Workflows screen, after every
   own run commit, and the Resume button; `drainWorkflowRuns` returns `{ resumed, remaining,
   stopped?: reason }` for the UI. Tests: quota failure after one successful output → run stays
   `running`, Resume completes the remaining steps exactly once; immediate reopen after step one
   → remaining steps execute, no duplicate; two real tabs draining the same run under the real
   lock → one set of outputs (e2e); a quota-stopped run never needs a fresh Run now.

**Amendment D (Codex P1 on the first `WorkflowEditor.tsx` candidate, lines 207–225, 18:18 AST;
same writer, no new scope).** The editor's unmount only fire-and-forgets the flush and removes
its mounted `beforeunload` guard; there is no session stash. Full quota → edit name/actions →
sidebar Calendar (bypasses Back) → failed flush → immediate reopen initializes the old stored
workflow and loses the edits; leaving the app has no guard. Ruling: apply the accepted CMS
recovery discipline to workflow drafts — a module-level `unsavedWorkflowDrafts` store (or a
generalized shared draft-stash module reused by both editors; preserve the accepted CMS
behaviour and tests byte-for-byte unless the generalization keeps them green unchanged) with:
synchronous stash of the latest draft in the unmount cleanup, monotonically increasing
`token` per stash, module-level app-lifetime `beforeunload` guard while any stash exists,
recovery prompt on reopen (`workflows-unsaved-prompt`, Restore / Discard), late flushes and
lock-released commits clearing only a matching token, list chip for workflows with a stash,
`not-persisted`/conflict states retaining the text. Tests (RED first): jsdom — stash present
synchronously on unmount with the injected lock held, prompt on immediate remount with the
latest draft, older completion after a newer remounted draft leaves the newer stash intact,
matching confirmed save clears stash and prompt, guard registered after screen unmount while a
stash exists and removed once cleared. Browser (`e2e/workflows.spec.ts`, desktop): full quota
via `Storage.prototype.setItem` override → edit → sidebar Calendar → `beforeunload`
`defaultPrevented` → reopen → prompt → restore after quota clears; second page holds the real
Web Lock → edit A then B → sidebar Calendar → reopen before release → prompt shows B → release →
B saved once.

**Amendment E (Codex integration P2, 18:27 AST; same writer, bounded).** Planner output links
point at `/planner/`, but `PlannerScreen.tsx:42–49` renders only `weekKey(today)` with no week
navigation; after the Saturday rollover a Resume/Retry of a Friday run writes a prior-week row
(correctly, from the snapshot) that the link can never show. Ruling: the planner accepts a hash
deep link `#week=<Saturday key>` (valid when `weekKey(key) === key`; read on mount and
`hashchange` like Notes/Calendar, cleared with `history.replaceState` when invalid); it renders
that week with a bar `plan-week-viewing` ("Viewing the week of {date} · Back to this week",
`plan-week-return` clears the hash); the default stays the current week; derived plan, overlay,
owner rows/tombstones, tick and XP behaviour are unchanged (ticking in a past week behaves as
today's code would for that week's items). Workflow planner outputs link to
`/planner/#week=<row.week>` (the stored row's week, which equals the snapshot week). Minimal
allowed-file expansion: `components/planner/PlannerScreen.tsx` (+ its existing test file if any),
`messages/planner.ar.json` + `planner.en.json` (two keys), `e2e/planner.spec.ts` (new case only).
Tests: unit — `#week=` of a prior Saturday renders that week and the return bar; an invalid key
falls back to the current week and is cleared; e2e — a run whose snapshot week is the previous
Saturday (seeded via `seedState`) shows its planner row through the run's Open planner link with
the "you" chip, and the return bar brings back the current week; the planner default without a
hash is still the current week.

**Rulings.** (1) One lock, one storage key: `commitFresh` generalizes the CMS transaction; no
second lock name. (2) Enqueue inside the Ready commit, execution by `drainWorkflowRuns` right
after and on Workflows/Website mount; honest copy about browser-open execution; no AppShell edit.
(3) Deterministic output ids double as provenance; `Idea.source` gains `"workflow"`; Post and
PlanItem schemas unchanged. (4) Planner outputs are `by: "me"` manual rows appended by id;
whole-week replacement forbidden. (5) Paused = no event runs and Run now disabled with
explanation. (6) Executor: Opus 5.5.

## Implementation record

(Executor appends: changed files, RED→GREEN evidence, check outputs, concerns.)

### DT-3 implementation record — Claude Opus 5.5 (single writer), 16 Oct 2026 15:36–16:16 AST

**Status: DONE_WITH_CONCERNS** (all checks green; concerns/deviations listed below).

**Start snapshot (15:36 AST).** `git status --porcelain` 77 lines saved;
`store/index.ts` `1f812dc8ae50ab3e8fdf3401f06857e83a94e847244f3b3ff9ce250df7b15cc7`,
`lib/domain.ts` `dcaae152e23a9ed50965b1389b25e4b5db82cee1bdb88f3a2eb886bc931d16d9`.

**Files.**
- New: `lib/articles.ts`, `lib/articles.test.ts`, `components/social/website/{WebsiteScreen,ArticleEditor,ArticleMarkdown}.tsx`,
  `components/social/website/{WebsiteScreen,ArticleEditor}.test.tsx`, `messages/website.{ar,en}.json`,
  `e2e/website.spec.ts`, `planning/tools/33-website-cms.md`.
- Edited (additive): `lib/domain.ts` (ArticleSchema block appended), `store/index.ts` (article hunks only),
  `store/index.test.ts` (appended describe + 5 import names), `lib/i18n.ts`, `app/social/website/page.tsx`,
  `components/social/SoonScreen.tsx` (business only), `components/shell/nav.ts` + `nav.test.ts`,
  `components/shell/MoreScreen.tsx` + `MoreScreen.test.ts`, `lib/tools.ts` + `lib/tools.test.ts`,
  `messages/tools.{ar,en}.json`, this handoff.
- Edited outside the original list (deviation, see concerns): `components/tools/ToolsScreen.test.tsx`,
  `components/shell/QuickActions.test.tsx`, `e2e/tools.spec.ts` (they encoded "website = planned");
  `package.json` + `pnpm-lock.yaml` (Amendment C: `mdast-util-from-markdown` ^2.0.3).
- Tests that encoded the soon/planned state and were updated (no assertion deleted; each now asserts the new truth and
  keeps the planned/soon assertions for Business, Workflow builder, Inbox): `lib/tools.test.ts` (planned list,
  quickActionTools), `components/tools/ToolsScreen.test.tsx` (planned loop + website available),
  `components/shell/QuickActions.test.tsx` ("Website" now listed, "Business" not), `components/shell/MoreScreen.test.ts`
  (website chip gone, business chip "قريب"), `e2e/tools.spec.ts` (website `available`, business `planned`),
  `components/shell/nav.test.ts` (new test: website not soon, business soon).

**RED → GREEN per unit (real times, AST).**
- 15:37 `lib/articles.test.ts` RED: import of `./articles` failed (module missing). 15:38 GREEN 17/17.
- 15:39 Amendment B `articlePersisted` by commitId RED: 1 failed ("expected false to be true", old id+revision
  signature). GREEN 17/17 after switching to `commitId`.
- 15:40 store article tests RED: 14/14 failed `S(...).addArticle is not a function`. 15:41 GREEN (143 in store+lib).
  Frozen-hash reconstruction (drop added lines → sha256) MATCH for both files.
- 15:44 registry/nav/More/Tools/QuickActions RED: 8 failed (website still planned/soon). GREEN 172/172.
- 15:47 Amendment C device media by parser RED: `![a ![b](x)](img:1)` expected `body-device-media`, got `[]`
  (regex). GREEN 18/18 with `mdast-util-from-markdown`; regex deleted.
- 15:49 Amendment C/C.1 transaction tests RED: 21/21 failed `setArticlesLock is not a function`. GREEN 151/151
  after `commitArticles` (one slug-suffix fix: `x-2-2` → `x-3`).
- 15:53 component tests RED: both files failed to resolve `./ArticleEditor` / `./WebsiteScreen`.
- 15:56 Amendment D RED: 2 failed (stored `settings.lang` "ar" instead of "en"; quota result carried `article`).
  GREEN 154 after rehydrate-inside-lock + rollback; one test-data fix (idea source "own" → valid "me").
- 15:58 components first run: 8 failed (harness: polling inside one `act` holds renders; storage-blocked test failed
  every write; disabled-fieldset `.disabled`). Harness fixed, no source change; GREEN 23 → 24 with the Amendment D
  editor case (passed first run: behaviour already provided by the store fix).
- 16:06 Amendment E RED: store probe test failed (memory-only branch returned `article`); 10 editor tests failed
  (`unsavedDrafts`/`toDraft` not exported, then a leaked quota mock in teardown). GREEN 137 store, 33/33 components
  (3 repeat runs 33/33).
- e2e `website.spec.ts` was written after the units and passed on its first run (16:03, 6/6); no e2e RED.

**Check lines (final run, 16:12–16:15 AST).**
1. `pnpm vitest run lib/articles.test.ts store components/social/website components/shell components/tools messages lib/tools.test.ts`
   → `Test Files  19 passed (19)` / `Tests  411 passed (411)`.
2. `pnpm lint` → exit 0, no problems. `pnpm typecheck` → exit 0.
3. `pnpm exec prettier --check <29 changed/new files>` → `All matched files use Prettier code style!`; all LF.
4. `pnpm build` → exit 0, `✓ Compiled successfully in 4.5s`, `○ /social/website` static.
5. `pnpm e2e e2e/website.spec.ts e2e/settings.spec.ts e2e/world.spec.ts e2e/tools.spec.ts e2e/quick-actions.spec.ts`
   → exit 0, `81 passed (39.3s)`, `1 skipped` (pre-existing: world.spec "desktop: the Social sidebar…" skips on phone).
6. `git status --porcelain` vs snapshot: new lines only `app/social/website/page.tsx`, `components/shell/nav{,.test}.ts`,
   `components/social/SoonScreen.tsx`, `package.json`, `pnpm-lock.yaml`, `components/social/website/`,
   `e2e/website.spec.ts`, `lib/articles{,.test}.ts`, `messages/website.{ar,en}.json`,
   `planning/tools/33-website-cms.md` (other edited files were already M/?? in the snapshot).
   `store/index.ts` / `lib/domain.ts`: removing only the added article line ranges reproduces the start sha256 exactly
   (MATCH for both), i.e. every pre-existing (Discover) hunk is byte-identical and the packet's hunks are additions.

**Amendment evidence.**
- A: any meaningful edit to `ready` → draft; identical save keeps status/revision/commit (store tests); pending text
  flushed before Archive/Ready/Restore/Download/Back, stops on conflict/failed save (editor tests "flushes the last
  sentence…", "stops archiving on a conflict…"); YAML scalars JSON-quoted (title with `"`, `:`, newline, `---`
  round-trips); `body-device-media` per language blocks ready; preview stays react-markdown + `urlTransform`.
- B: `commitId` on every content/status/archive/restore commit; editor base `{commitId, generation}`; ABA import test;
  `articlePersisted(key, id, commitId)` false for same id+revision with another commit; no extra storage listener
  (store's `followOtherTabs` rehydrates).
- C/C.1: every mutation through `commitArticles` under `navigator.locks.request("3z-prod-articles", {mode:"exclusive"})`,
  injectable via `setArticlesLock` (no token lock; no Web Locks → `unsupported-save`); missing target → `missing`,
  never recreated; sibling edits survive; create appends to the fresh list; restore refuses an active duplicate slug
  with `conflictsWith`, "Restore with a new slug" → `x-2`, `x-3`; malformed stored JSON → `not-persisted`, memory
  untouched; device media by mdast walk (nested alt, `&#105;mg:`, `[a]: img:1` flagged; fenced/inline/indented code not).
- D: inside the lock the existing `merge` rehydrates the whole payload (remote `settings.lang` and ideas survive;
  Discover epoch/candidates untouched); read-back is authoritative and a failed write rolls memory back to the stored
  list; retry from base X lands with a new commit Y (store + editor tests).
- E: no memory-only success (probe failure → `not-persisted`, memory/base stay at X, text kept, Back stops); fields
  read-only + `aria-busy` and actions disabled while an action runs (held-lock test); unmount flush failure stashes into
  session `unsavedDrafts` (list chip, Restore/Discard prompt); `beforeunload` guard only while dirty or stashed;
  downloads/Export all never block and name unsaved exports `-unsaved` with the "includes unsaved changes · not saved on
  this device" line; preview `#` links (footnotes) scroll inside the preview, hash untouched; a foreign hash keeps the
  editor open.

**SHA256 (16:15 AST).**
```
14250efc5754c03aaee133c1e61d6758656b79833011fd3946c384a22a44294a  lib/articles.ts
2dd20ad943f451c47e5859676d631f771868ef1547ef4b0944fd9b1f8a8eb5f8  lib/articles.test.ts
052528f36bc4fa1a107b5cbb6571f1000330207018ce7d9463d99da17c41f87f  components/social/website/WebsiteScreen.tsx
0470fd04835157c553d2b0aba2d5dac9086025fda50e23baa41c4d45f43db99c  components/social/website/ArticleEditor.tsx
f8661224032efea7b8b177b595dfe6b9665dc3fc04848a70d20781cb1268a049  components/social/website/ArticleMarkdown.tsx
e282071b0d9d8d6d3d938297bfeffbbd241310c39fffb58c26041e33e8f557b4  components/social/website/WebsiteScreen.test.tsx
68f69b010a16bb49401349599e5a8a623ffa7cab9ca94c85a8e61fb68eebdee3  components/social/website/ArticleEditor.test.tsx
4d87e9ecb5b057d8e7df8decb3ff4533556a856b31e15decee3528e7a89f9b04  messages/website.ar.json
f828cbcc0f2df40f6ed12a559ae7f18f618e9099fe9de56ac3bc22f304e62eb0  messages/website.en.json
da34e61f1f603261940df6f84f60552970a08e59d679f0a022526333b9584617  e2e/website.spec.ts
fa009e3f7d2ea0fe197161c319419a76c7b28f9e15917d279f3bf024808055b9  planning/tools/33-website-cms.md
3de368d5fc70a3ecf636db9a5caa64ba0fdffda3d06b4a8446ade9a296bad555  lib/domain.ts
2aaf65296a27fb8da0a5766596bfc16bfb5759605d6f7272acc9087ed47937af  store/index.ts
f5fa7f3fb2c412a84613ca63de3bfceddb1a69d486fe6eba6132b7d969122264  store/index.test.ts
bc40d6956e892c77e52666df3ea9665db13a27330f22eb28566b97011ac21b95  lib/i18n.ts
a0757edb508021fe022e825ae5aeb8c2071849f97796ecabe6f788a2251a49ef  app/social/website/page.tsx
b37c32220a334345354367d951c6992497ec6dd03dae02ed614b21723bcc47b2  components/social/SoonScreen.tsx
202acc64df4650a1fa7126a441308d778a489eaef36e0bbaa509422df6351d6c  components/shell/nav.ts
4258a5950fd47440c618acb3c391e50421f537ba3aad79f6ea5dcb6bdeb3ffcf  components/shell/nav.test.ts
ff7e918d0b684e3adafa24a9079c50e15dc53c8a962e64a5978a8307945f5d32  components/shell/MoreScreen.tsx
52c643b0cb9b54f99c627609f0fc0f2cbc6675148f0566c7c66fcac8b3f2ff26  components/shell/MoreScreen.test.ts
5d5641e47a64894b346645522854bf2b6d530c0a5af618f046b22cf4e8e036bf  lib/tools.ts
c6ec17c36378346e3f4e3954347cc9317199a2233c0a49d19fba10521934073d  lib/tools.test.ts
339f9fc1212a76b37ace7cbee0620322e955c4f1a58da9943bfeae05596b83cd  messages/tools.ar.json
011b9ec906015bdd40acf2310fdd10010067f235faab8a375bd5c1415e80d08b  messages/tools.en.json
f66010fe6832efe875b4918602b0f434cba5743683ac8ead5e0d13de727363dd  components/tools/ToolsScreen.test.tsx
1cfd864a226f56c7ad1fb6246d3c027d6d00c90f6c2fa16301ee29468e310778  components/shell/QuickActions.test.tsx
3baf9eb807441f7feb494bb318610978e453643e91845f31daf7c2eb01196f00  e2e/tools.spec.ts
9456ebd1a29753a1c7f0d25b32facd499ca2fe75cc12673ff30b27e99852712a  package.json
68b677bc63c0123fc5d42bf39b236221595f0d584ffd7e3095bfb8d20a0386d3  pnpm-lock.yaml
f6e3619fd082af5bbdc324bf8c7fef3b50002a0e3ae127f1d6ffbe6e109cd47f  out/social/website/index.html
969cc498c5f09334ec611a5a783f764e7d43ec90defc1107b6e17fcc46bdd842  out/index.html
2870674160cd477d005ade283fa1e5eb44f4f36eaef4e94a33cc5a6b7569d7b9  out/social/index.html
ccd2cd5a695b2caa34379080ab128e7511e35765d79700668ddcd135cd2c7d16  out/tools/index.html
```
(This handoff file is not hashed here: it changes by being written.)

**Concerns / deviations (with reasons).**
1. Generation rule (B vs C conflict): B said `merge` bumps `articlesGeneration` whenever rehydrated articles differ;
   C requires a sibling edited in another tab to survive while this tab saves A. Those contradict (a sibling edit would
   invalidate A's base). Implemented: the generation bumps on local import/reset and on a rehydration whose
   `discoverLibraryEpoch` changed (another tab's import/reset sets a new epoch); another tab's edit of the same article
   is caught by its `commitId`. A Discover-library-only epoch change would also bump it (conservative: text kept,
   conflict shown). The store test that encoded the broader rule was rewritten accordingly.
2. Offline install: `pnpm install --offline` could not resolve `mdast-util-from-markdown` (no cached registry
   metadata). The lockfile already held the 2.0.3 snapshot, so I added the importer entry (specifier `^2.0.3`, version
   2.0.3) to `pnpm-lock.yaml` and ran `pnpm install --offline --frozen-lockfile` (succeeded, no network). Lockfile diff:
   3 added lines. `package.json` and `pnpm-lock.yaml` working copies were CRLF and are now LF (git stores LF).
3. Files outside the original allowed list: three tests that encoded "website = planned" (named above) had to change
   for the checks to pass; package files per Amendment C.
4. Copy: `PageHeader` uses `social.website.title` with a new `website.sub`, not `social.website.sub` (that key promises
   comments/newsletter/cheat sheets, which do not exist). Existing `social.*` keys unchanged; `social.website.soon` is
   now unused.
5. Unsaved drafts (Amendment E) live for the SPA session only (not persisted); the `beforeunload` guard covers closing
   the page. `pagehide` flush is best-effort (a Web Lock may not be granted during unload); `visibilitychange` hidden
   flushes first.
6. Raw HTML in a body is neither rendered (preview `skipHtml`) nor inspected by `body-device-media`; it stays in the
   exported source as typed.
7. Working copies of `components/shell/nav.ts`, `nav.test.ts`, `components/social/SoonScreen.tsx` and
   `app/social/website/page.tsx` were CRLF (unmodified checkouts); they are LF now (git normalizes; diffs show only
   real changes).
8. No `completeQuest`, XP, gem or badge call anywhere in the packet (store test asserts xpEvents/gemEvents/completions
   unchanged across add/update/status/archive/restore/export).

### Repair round 1 record — Claude Opus 5.5 (single writer), 16 Oct 2026 17:31–17:42 AST

**Status: DONE_WITH_CONCERNS** (all checks green; two small additions beyond the letter of the ruling, listed below).

**Start snapshot (17:31 AST).** HEAD `0e1fdb0`, branch `codex/discover-inspiration`; `git status --porcelain` 90 lines
saved. Start sha256: `ArticleEditor.tsx 0470fd04…`, `ArticleEditor.test.tsx 68f69b01…`, `ArticleMarkdown.tsx f8661224…`,
`WebsiteScreen.tsx 052528f3…`, `WebsiteScreen.test.tsx e282071b…`, `lib/articles.ts 14250efc…`, `store/index.ts 2aaf6529…`,
`e2e/website.spec.ts da34e61f…`.

**Files changed (5, all in the allowed list).** `components/social/website/ArticleEditor.tsx`,
`components/social/website/ArticleEditor.test.tsx`, `components/social/website/WebsiteScreen.tsx`,
`components/social/website/WebsiteScreen.test.tsx`, `e2e/website.spec.ts`, plus this record. Not touched:
`lib/articles.ts`, `store/index.ts`, `ArticleMarkdown.tsx`, messages (no new string), AppShell, Discover files.

**What changed.**
- (a) App-lifetime guard: `ArticleEditor.tsx` module subscribes `unsavedDrafts` to itself and adds/removes one module
  `blockUnload` `beforeunload` handler whenever the map is non-empty/empty (same function reference, so add is
  idempotent). `WebsiteScreen` no longer mounts `useUnloadGuard`. The editor's own dirty guard stays (it wraps
  `blockUnload` in its own function so its cleanup never removes the module handler).
- (b) Synchronous stash: `UnsavedDraft` gains `token: number` (module counter `lastToken`, `++` per stash). On unmount,
  when dirty, `close()` stashes the latest fields/base/reason immediately, then flushes. When the flush settles it acts
  only if `drafts[id].token` still equals its token: saved and clean → `dropUnsaved(id, token)` (token-checked);
  otherwise re-stash with the same token (refreshes `reason`, and `base` if an earlier queued save committed first).
  A newer stash from a remounted editor is never touched.
- (c) Late updates: the editor keeps the shown stash in `stashShown` and subscribes to `unsavedDrafts`; when the shown
  stash is replaced it shows the new one (fresh base for Restore); when it is cleared (matching confirmed save) it drops
  the prompt and adopts the stored article. A store change while the prompt is shown does not touch the prompt.
  Restore/Discard read `stashShown`. Store/quota behaviour unchanged (memory-only saves still never advance memory/base).
- Addition (see concern 1): `check()` treats a stored article whose editorial fields equal the form (via `toPatch`) as
  no conflict and adopts it.

**RED evidence.**
- 17:33:54 `pnpm vitest run components/social/website` → `Tests 4 failed | 33 passed (37)`:
  ArticleEditor "stashes the latest text synchronously…" (`expected undefined to be 'Text B'`), "clears the stash and
  the prompt when the closed editor's save lands…" (`expected null not to be null`), "never lets an older pending save
  remove a newer stash" (`no website-unsaved-restore`); WebsiteScreen "keeps the unload guard after leaving the CMS…"
  (`expected false to be true`).
- 17:38:45 new e2e on the old build at :3000 (`out/social/website/index.html f6e3619f…`), desktop:
  `2 failed` — both at the post-Calendar `beforeunload` assertion (`Expected: true, Received: false`,
  `website.spec.ts:239` and `:289`).

**GREEN.** 17:35:21 components `Tests 37 passed (37)` (after the ref-pattern lint fix, again 37/37).
New jsdom tests: synchronous stash with the injected lock held, immediate remount prompt, Restore shows B, release →
stored B, no conflict, stash gone; matching save clears stash + prompt and re-bases (body shows the saved text, guard
off); older flush after a newer stash keeps the newer stash (token larger, body "Newer B", reason refreshed to
`conflict`); WebsiteScreen unmount with a stash → `beforeunload` `defaultPrevented`, cleared → not. New e2e (desktop;
phone `test.skip`, the sidebar is desktop only): (i) full quota via `Storage.prototype.setItem` override (localStorage
only) → `notPersisted` → sidebar Calendar → guard true → reopen → prompt → quota restored → Restore → saved, disk = text,
guard off; (ii) a second page holds the real `navigator.locks` lock `3z-prod-articles`; A queued, then B; sidebar
Calendar (guard true); reopen before release → prompt, body still the original; release → prompt gone, body B, disk B,
`revision` 3 (A and B committed once each), guard off; after reload still B, revision 3, no prompt.

**Check lines (17:38–17:41 AST).**
1. `pnpm vitest run components/social/website lib/articles.test.ts store components/shell components/tools messages`
   → `Test Files  18 passed (18)` / `Tests  376 passed (376)` (the earlier 411 also included `lib/tools.test.ts`).
2. `pnpm lint` → exit 0, no problems. `pnpm typecheck` → exit 0.
3. `pnpm exec prettier --check <5 changed files>` → `All matched files use Prettier code style!` (all LF).
4. `pnpm build` (17:38:59) → exit 0, `✓ Compiled successfully in 4.8s`, `○ /social/website`.
5. `pnpm e2e e2e/website.spec.ts e2e/settings.spec.ts e2e/world.spec.ts e2e/tools.spec.ts e2e/quick-actions.spec.ts`
   → exit 0, `83 passed (34.9s)`, `3 skipped` (pre-existing world desktop-only skip on phone + the two new desktop-only
   scenarios on phone).
6. `pnpm exec playwright test -c "C:/Users/AORUS/AppData/Local/Temp/dashboard-cms-workflows-2026-10-16/playwright.adversarial.config.cjs"`
   (17:39:40, against :3000, server not restarted) → `3 passed (8.1s)`. This run rewrote Codex's
   `adversarial-results.json` / `adversarial-results/` in that temp folder (its own reporter output; spec and config
   unedited).
7. `git status --porcelain` after = snapshot, byte-identical (90 lines; the changed files were already `??`/`M`).
   `lib/articles.ts`, `store/index.ts`, `ArticleMarkdown.tsx` sha256 unchanged.

**SHA256 (17:41 AST).**
```
109f99ca2d08787b801a0f7d1f2c37f1772ffa9905790960a1dc065d54931a11  components/social/website/ArticleEditor.tsx
f6472f94f11c1937fa83ecdb69dfacba92576a61edb4e0b68e5f45c2acfd66a3  components/social/website/ArticleEditor.test.tsx
264d1dac4b7f0bfa3eeb82d2afaab721c503fc3e57d3a37183e9e8814a6022c1  components/social/website/WebsiteScreen.tsx
aaedee647aa577757018a42ccd9a6b5dff8ff36f06db14c4d073e699f2c64bb8  components/social/website/WebsiteScreen.test.tsx
a1660056884df9b1d112ef465ef9e9226fc68b5cad773d9b4deb24dd0682e092  e2e/website.spec.ts
4c6b26fd37e35fecc2603d3d74d2732671495605ec19e50a7f971b1b63b3e2d5  out/social/website/index.html
4cc899383c8e4a4a62379b00689c4c60b207cdfc3a846c80423231777d241357  out/index.html
af4005a3dda3b923bb964d9a67005e0ceb2dc2fff70cfdf9a347ea94bcceee35  out/social/index.html
db1882a472492f9e39a5fb461c94561c1e6cd7528c55954922921aaa7f731384  out/tools/index.html
```
Each `out/` page served by localhost:3000 hashed identical to disk at 17:41.

**Concerns.**
1. Addition beyond the ruling text: same-content stored article = no conflict (`check()`). Without it, Codex's path
   "reopen → Restore before release" ends in a false conflict: the restored editor's save is based on the
   pre-unmount base, so it conflicts with the closed editor's A, then the closed editor's B lands with exactly the text
   on screen. Data was never at risk; the rule only removes a misleading conflict banner (covered by the first new
   jsdom test, `saveState` not `conflict`). Another tab writing byte-identical fields is also no longer a conflict.
2. Discard does not cancel a closed editor's queued save: if the owner discards the prompt before the held lock is
   released, the closed editor's queued save still lands afterwards and the open editor shows it (pre-existing:
   the old code also flushed on unmount; the store API has no cancel). Restore/Discard copy unchanged.
3. Unload guard now lives for the app session in the `ArticleEditor` module: it registers once that module is loaded
   (any visit to `/social/website`); pages that never load the CMS chunk have no stash and need no guard.
4. Re-stash on a failed close refreshes `at` as well as `reason`/`base` (same token, same fields).

### DT-4 implementation record — Claude Opus 5.5 (single writer), 16 Oct 2026 17:55–18:50 AST

**Status: DONE_WITH_CONCERNS** (all checks green; deviations and concerns listed at the end).

**Start snapshot (17:55 AST).** HEAD `0e1fdb0`, branch `codex/discover-inspiration`; `git status --porcelain` 90 lines
saved. Start sha256: `store/index.ts 2aaf6529…`, `lib/domain.ts 3de368d5…`, `WebsiteScreen.tsx 264d1dac…`,
`ArticleEditor.tsx 109f99ca…`, `ArticleMarkdown.tsx f8661224…`, `WebsiteScreen.test.tsx aaedee64…`,
`ArticleEditor.test.tsx f6472f94…`, `AppShell.tsx ebe78e26…`, `AutoPostScreen.tsx 19216c96…`, `lib/publish.ts 1ba81d00…`.
End: all of these unchanged except `store/index.ts`, `lib/domain.ts` (DT-4 hunks) and `WebsiteScreen.tsx` (one line).

**Files.**
- New: `lib/workflows.ts` + `lib/workflows.test.ts`, `components/social/workflows/{WorkflowsScreen,WorkflowEditor}.tsx`
  + `WorkflowsScreen.test.tsx`, `app/social/workflows/page.tsx`, `messages/workflows.{ar,en}.json`, `e2e/workflows.spec.ts`,
  `planning/tools/34-workflows.md`; `components/planner/PlannerScreen.test.tsx` (Amendment E unit test; see deviation 3).
- Edited: `lib/domain.ts` (workflow schemas appended; `IDEA_SOURCES` + `"workflow"`), `store/index.ts` (slices, types,
  `commitFresh` generalization, Ready enqueue, executor, actions), `store/index.test.ts` (appended describe + imports),
  `lib/i18n.ts`, `components/social/website/WebsiteScreen.tsx` (one drain line), `components/shell/nav.ts` + test,
  `MoreScreen.tsx` + test, `lib/tools.ts` + test, `messages/tools.{ar,en}.json` (workflows desc), `messages/ideas.{ar,en}.json`
  (`ideas.source.workflow`), `components/tools/ToolsScreen.test.tsx`, `components/shell/QuickActions.test.tsx`,
  `e2e/tools.spec.ts`; Amendment E: `components/planner/PlannerScreen.tsx`, `messages/planner.{ar,en}.json` (2 keys),
  `e2e/planner.spec.ts` (1 case); outside the list: `components/social/ideas/IdeaRow.tsx` (deviation 1).
- Not touched: Discover/research/extension/Worker/script files, `AutoPostScreen.tsx`, `AutoPostTab.tsx`, `lib/publish.ts`,
  AppShell, `ArticleEditor.tsx`, `lib/articles.ts`, Codex review file, Codex temp evidence (read-only directory listing only).
- Tests that encoded "workflows = planned" and were updated (no assertion deleted; each keeps Business + Inbox planned and
  now asserts workflows available): `lib/tools.test.ts` (planned list, quickActionTools; new "workflow builder row"
  describe), `components/tools/ToolsScreen.test.tsx` (planned loop; workflows link; the "no link" check moved to inbox),
  `components/shell/QuickActions.test.tsx`, `components/shell/MoreScreen.test.ts` (ids list + new row assertions),
  `e2e/tools.spec.ts` (+ workflows `available`), `components/shell/nav.test.ts` (new test + path).

**RED → GREEN per unit (real times, AST).**
- 17:58:17 `lib/workflows.test.ts` RED (module missing) → 18:00 GREEN 18/18.
- 18:02:39 store workflows RED 14/14 (`addWorkflow is not a function`) → 18:06:44 GREEN 151/151 store (one test-data fix:
  my old-backup fixture lacked `freezesUsedOn`/`reviews`). Note: a formatter hook race dropped one Edit (actions block); it
  was re-applied and verified by grep before the GREEN run.
- Amendment A tests were written in the same RED batch (quota during a reconciliation step whose output already exists →
  `not-persisted`, run unchanged in memory and storage, no duplicate; quota during the retry transition → attempt unchanged,
  Retry still offered; after recovery the step completes exactly once). Run `commitId` on every run mutation; workflow
  `commitId` on every edit; output existence is never the proof.
- 18:07:45 Amendment B RED 5 (preview ordering repro, duplicate ids in preview, schema refusal + issue, backup import
  refused, tampered snapshot) → 18:08:50 GREEN 174.
- 18:09:50 registry/nav/More/Tools/QuickActions RED 8 → 18:12:18 GREEN 178.
- 18:13:40 component tests RED (module missing) → 18:16 GREEN 10/10 after one assertion fix (Next `Link` drops the
  trailing slash in jsdom: the post link assertion normalizes it; the e2e checks the real URL), 3 repeat runs 10/10.
- 18:19:25 Amendment C store/lib RED 13 (new tests + API changes) → 18:20:25 GREEN 178.
- 18:21:39 Amendment C UI + Amendment D RED 6 → 18:23:30 GREEN 16/16 (3 repeats 16/16).
- 18:29:26 Amendment E planner unit RED 3 → 18:30:00 GREEN; workflow planner link RED 18:30:40 → GREEN 18:30:57.
- 18:34 first e2e: planner deep link failed (Link mounts before the URL hash is written) → settle re-read like
  `WebsiteScreen` → GREEN.
- 18:44:21 display fix RED (visible steps label printed `{count}`) → 18:44:34 GREEN 16/16 ×2.

**Amendment evidence.**
- A: `WorkflowRun.commitId`, `Workflow.commitId`; `commitFresh` rolls back every patched slice (`workflowRuns`, `ideas`,
  `posts`, `planItems`); store tests named "(Amendment A)".
- B: preview mirrors execution (first failure, then `skipped`, no output); `WorkflowSchema.actions` refines unique ids
  (backup import refused); run snapshot schema stays permissive so one tampered run cannot make the save unreadable; the
  executor fails such a run before any output (`action-duplicate-id`); editor assigns fresh unique ids.
- C: `runWorkflowNow(id, { articleId? }, now)`; article-ready requires an existing non-archived article (`needs-article`);
  manual: `placeholder-needs-article` / `skill-needs-article` issues (old `placeholder-article` renamed; `plan-skill` now
  only an unknown skill). Age guard and own-run set removed: drain resumes any queued/running run from its first pending
  step. `drainWorkflowRuns` returns `{ resumed, remaining, stopped? }`; Resume button (same attempt) when the last drain
  stopped; drains on Workflows/Website mount, Workflows `visibilitychange`→visible, after each own run commit (UI) and on
  Ready (store). e2e: two real tabs under the real Web Lock → one set of outputs.
- D: `unsavedWorkflowDrafts` (separate module store mirroring the CMS one; CMS untouched): synchronous stash on unmount,
  monotonic token, module-level `beforeunload` guard while any stash exists, `workflows-unsaved-prompt` Restore/Discard,
  token-checked clears, list chip, follow-up of late saves. jsdom ×4 + e2e desktop ×2 (full quota → Calendar → guard →
  reopen → restore; held real lock → A then B → Calendar → reopen → prompt → release → B saved once, revision 3).
- E: `PlannerScreen` reads `#week=<Saturday>` (mount, settle, hashchange); invalid key cleared; `plan-week-viewing` bar with
  `plan-week-return`; workflow planner links `/planner/#week=<weekKey(snapshot day)>`; unit ×3 + e2e ×1 (prior-week run →
  link → row with "you" chip → return → current week; `/planner/` default current week).

**Check lines (final run, 18:45–18:48 AST, after the last source change).**
1. `pnpm vitest run lib/workflows.test.ts lib/articles.test.ts store components/social/workflows components/social/website components/shell components/tools messages lib/tools.test.ts`
   → `Test Files  21 passed (21)` / `Tests  478 passed (478)`. Plus `pnpm vitest run components/planner` → `2 passed` /
   `14 passed`; broader `pnpm vitest run components/social lib components/planner` (18:39) → `87 passed` / `1469 passed`.
2. `pnpm lint` → exit 0. `pnpm typecheck` → exit 0.
3. `pnpm exec prettier --check <34 changed/new files>` → `All matched files use Prettier code style!`; all LF.
4. `pnpm build` (18:46:13) → exit 0, `✓ Compiled successfully in 1391ms`, `○ /social/workflows`.
5. `pnpm e2e e2e/workflows.spec.ts e2e/autopost.spec.ts e2e/website.spec.ts e2e/planner.spec.ts e2e/ideas.spec.ts e2e/calendar.spec.ts e2e/settings.spec.ts e2e/world.spec.ts e2e/tools.spec.ts e2e/quick-actions.spec.ts`
   (18:46:33–18:48:01, against :3000, not restarted) → exit 0, `149 passed (1.4m)`, `5 skipped` (pre-existing world
   desktop-only on phone, the two CMS desktop-only scenarios on phone, the two new workflow desktop-only scenarios on
   phone). No pre-existing failure appeared.
6. `git status --porcelain` vs snapshot: new lines only `components/planner/PlannerScreen.tsx`,
   `components/social/ideas/IdeaRow.tsx`, `e2e/planner.spec.ts`, `messages/{ideas,planner}.{ar,en}.json`,
   `app/social/workflows/`, `components/planner/PlannerScreen.test.tsx`, `components/social/workflows/`,
   `e2e/workflows.spec.ts`, `lib/workflows{,.test}.ts`, `messages/workflows.{ar,en}.json`, `planning/tools/34-workflows.md`
   (other edited files were already M/?? in the snapshot).
7. Commit boundary: `git diff -U0 HEAD -- store/index.ts lib/domain.ts` removes only the pre-existing Discover line
   (`settings: { ...DEFAULT_SETTINGS, gear: [...] }`) and `IDEA_SOURCES` (the planned `+ "workflow"`). Relative to the
   DT-3 baseline, a script that strips only the DT-4 hunks and restores the original `commitArticles` body and
   `setArticleStatus` reproduces the start hashes exactly: `store/index.ts 2aaf6529…` MATCH, `lib/domain.ts 3de368d5…` MATCH
   (i.e. every other line, Discover and CMS, is byte-identical; the only non-additive store changes are the `commitFresh`
   generalization and the Ready enqueue inside `setArticleStatus`).
8. Served `out/` pages on :3000 hashed identical to disk at 18:49.

**SHA256 (18:49 AST).**
```
425d0bc98896ad78fb89a0140d2b8cf4a6f136b9c09838f63791e1d75c801138  lib/workflows.ts
3cbdb4d96e527ff4105cb2083796373df9d1de4c31e3e76ee13c4c6c5d4cb8bb  lib/workflows.test.ts
6fc9765cb75c0c63e39a0e96b7e4979c84d223aeb92389ee8c753166051f16a0  components/social/workflows/WorkflowsScreen.tsx
6b5a2d23f12ea38fbb3420622388989b153f84b409bb6c4917fd5284a0762a2c  components/social/workflows/WorkflowEditor.tsx
4e5f3881fe4140195654555277df0401700c7a62c9cf4729281cfa5f48c50bd2  components/social/workflows/WorkflowsScreen.test.tsx
5c8b7b296e708c500bbd5fa31a2ad220b60c4893ca4d2ab8c058d91dd2566ecd  app/social/workflows/page.tsx
7ab869546377de216d222c6164efb186b763fb11278dadaba6711ffb01928869  messages/workflows.ar.json
8c583a310ec8ccba13a862c1bd86cf120557dbbf39b7b77b9f9ab60e337106b6  messages/workflows.en.json
80fbe3401689858663f564f36dc851f4ad9c06f9474acc44381b689eef76da09  e2e/workflows.spec.ts
fb2a94aec9df78d926eea9ab75a388628a2cc59559e3a8d19f013fd4aa1cb08a  planning/tools/34-workflows.md
cfd123981aa57a09e99c833ca6d424a4eb8540fd1d48bdd8797657ea1a798213  lib/domain.ts
e6972d51738233c187b041e91d8042bff56a43dd10e193979fc5fa1eb883826a  store/index.ts
f3056f21c20c80d4c73a50390e15a70c635a09c8e94d1dbd4b8d1efbd936a58b  store/index.test.ts
8458280bcae523e71baa2210f8a2ba11e38d9d4c983daa85b1d8dcdb921b442a  lib/i18n.ts
cbd248d42643edb6d2e3681895fc6170a0ae5ec71250c1ff486e8964ea7a20de  components/social/website/WebsiteScreen.tsx
791c5101ff2fac8e776b1b61c6768b0e8d5e0ed395df2e41a82b793e2427cd70  components/shell/nav.ts
b36fc5b6a25fcf75f34a65b57c69ea6bfb0b9863529061f914a676eec8b4c574  components/shell/nav.test.ts
baccfd7e4078b86300fb5f7ca4417af6265fbe2ef8520fe90aa1c16260dfc7f5  components/shell/MoreScreen.tsx
68fd0062e1222c6c8b9391f6a02d132cb21ea528c3fe4d983bd4bce048a9c414  components/shell/MoreScreen.test.ts
6ee34f58daa284ae7bb77eb8e98804b6349e8eeef12301e4fe877d57b2087183  lib/tools.ts
ed286361bd8dec2df2977889ca21324a56dee437fb436e76e76f80dd26671bb3  lib/tools.test.ts
83d2d0b4f3f4a6b47dfbcecd45f6805895bb6a6f91c56210d974948024073910  messages/tools.ar.json
d864950213ca5b0ae0169c553111590532cdd0109854c70d0acd04a6671581ab  messages/tools.en.json
8f7aa1fcc800d58eeaa5d9e7070a82f4b22eb43bcb1831eaa6db7ebfa635c8d3  messages/ideas.ar.json
5af83899bee461e487780d130a74f499842e7dc4ab809a6c737d02d3eee1ce05  messages/ideas.en.json
112e24a96a57ff6b80a2efcab737db93e31fc265cc13c91f91b895b8b4e1a8da  components/tools/ToolsScreen.test.tsx
fabdae67b30c94beb8017ccf7049b4fab449a9b4e957e23dc16f17c42139feea  components/shell/QuickActions.test.tsx
30b118e9b94a40db6de4a3752e1b71d65cd9bb3273ac29e20153b3dbac9b2169  e2e/tools.spec.ts
c7b15d72bd67413ec29721b02acbfdadbd5f47056fbd8b40b9c80e9b3964d802  components/social/ideas/IdeaRow.tsx
a4c6ae3e0ee5f92d98843f0e84e915d27efcfa90b65c94231b2de0e10ccde7d6  components/planner/PlannerScreen.tsx
243dec9dd08e97b11431c18002200418a39ccfe8ab084a3b5f66ab3e3098bb29  components/planner/PlannerScreen.test.tsx
6b07d2a3c7b18af0dbc5b6283928c23f12e61bf41fab441a1ebc87e11e267599  messages/planner.ar.json
73eac06f2dd1cab7e490000406da511c5d48027ea717ed7bf640e7ce2fa155bf  messages/planner.en.json
e6bf126718f5888e9f14b00ea75d36597685dde1bdb199294c4edd9f2027752d  e2e/planner.spec.ts
2120ac306aad87f01620adff72559e53dd367c4fdd497d35d2b5ef3fb349e1f4  out/social/workflows/index.html
4585fe969b846bd17c348d0577e4eeeb5e033873d6090018e2f558a704be7531  out/social/website/index.html
3d44b725f7f352f625cdd356d7ab892c6cebc03c792eeddc38e89f9a68d19c2f  out/index.html
3b539a069a6ab6bee5d4bffc537fc0efc7ad07b60f258ebfe6f66ba2ba6e81b5  out/social/index.html
551322d3e6908234ee0f4efcea7719e34cc57e9805c93dacc3dcb08d7948dbb9  out/tools/index.html
51985856740175079e759b9b5025d7a0da2a83e8f41652be35433a300f2c106e  out/planner/index.html
```
(This handoff file is not hashed here: it changes by being written.)

**Deviations / concerns (with reasons).**
1. `components/social/ideas/IdeaRow.tsx` (outside the list): `SOURCE_ICON: Record<IdeaSource, …>` must name the new
   `"workflow"` source or typecheck fails; +2 lines (Lucide `Workflow` import and map entry). The Ideas filter list gains a
   "Workflow" chip automatically (`IDEA_SOURCES` spread).
2. `lib/domain.ts` `IDEA_SOURCES` is a one-line modification (planned), not an addition. `WorkflowSchema.actions` is 0–5,
   not 1–5, so a draft whose steps were all removed still saves (`actions-count` blocks running it).
3. `components/planner/PlannerScreen.test.tsx` is new: Amendment E required unit tests and PlannerScreen had no test file.
   `PlannerScreen.tsx` working copy was CRLF (unmodified checkout) and is now LF (git normalizes; diff shows only real
   changes).
4. Run now and Retry do not drain inside the store action; the UI drains right after each own run commit (keeps store
   tests deterministic, e.g. crash-gap and quota cases). The Ready commit drains itself as planned.
5. Amendment C "lastError": the stop reason lives in an in-memory store (`workflowDrain.stopped`), not on the persisted run:
   a not-persisted step cannot be written, and writing a marker to memory only would let memory run ahead of storage.
   Resume shows for queued/running runs while that marker is set; it clears on the next successful drain.
6. Unchanged Ready in e2e: covered in store tests (`setArticleStatus` on an already-ready article queues nothing); the UI
   offers no Ready button on a ready article, so the e2e checks draft → paused → Ready instead.
7. No delete for workflows (not in the plan; pause covers it). Workflow ids/action ids are random; output ids are
   deterministic per run.
8. No XP/gems/`completeQuest`, provider, `fetch` or schedule anywhere in `lib/workflows.ts`, `components/social/workflows/*`
   or the workflow store hunks; all workflow e2e tests assert no Worker, local-AI or non-localhost request.

## Freeze DT-4 (Fable 5.1, 16 Oct 2026 18:53 AST) — current

Implementation owner: none.

Source edits for DT-4 stopped at 18:50 AST (executor record "DT-4 implementation record").
Planner spot-checks, read-only, 18:50 AST:
- No `completeQuest`, XP/gem writes, `fetch(`, `addIdea(`/`addPost(`/`addPlanItem(`/`setPlanItems(`
  in `lib/workflows.ts` or `components/social/workflows/*` (code lines). One lock name only:
  `3z-prod-articles` (`store/index.ts:837`, documented at `:884`). `commitFresh` (`:891`) with
  `commitArticles` as wrapper (`:922`); `drainWorkflowRuns` (`:2669`); Ready commit drains
  (`:2543`); `needs-article` (`:2635`); `articlesGen` bumps remain import/reset/epoch only
  (`:2704`, `:2715`, `:2746`). Visible actions label interpolates `count` (`WorkflowEditor.tsx:672`).
- Protected files unchanged: `AutoPostScreen.tsx 19216c96…`, `lib/publish.ts 1ba81d00…`,
  `AppShell.tsx ebe78e26…`, `ArticleEditor.tsx 109f99ca…`, `lib/articles.ts 14250efc…`,
  `native-search.js 1a3b8712…`, `lib/trendingSounds.ts 709926e3…`, `lib/platformIcons.tsx 907b8b38…`.
- `store/index.ts` vs HEAD: 1 removed (pre-existing Discover line) / 662 added; `lib/domain.ts`:
  1 removed (the planned `IDEA_SOURCES` line) / 149 added. Executor's boundary proof: stripping
  the DT-4 hunks and restoring `commitArticles`/`setArticleStatus` reproduces the DT-3 hashes
  (`2aaf6529…`, `3de368d5…`).
- Codex's focused engine review hashes: `store/index.ts e6972d51…` and `lib/domain.ts cfd12398…`
  match the frozen files. `lib/workflows.ts` is now `425d0bc9…` (Codex reviewed `8b290048…`
  earlier; the later edits are the Amendment B/E follow-ups recorded by the executor) — Codex
  should re-diff that file.

Rulings on the executor's concerns: (1) `components/social/ideas/IdeaRow.tsx` (+2 lines, icon
for the `workflow` source) added to the allowed list — required by typecheck; Ideas screen gains
a "Workflow" filter chip automatically; accepted. (2a) `IDEA_SOURCES` one-line change was planned.
(2b) `actions` 0–5 in the schema so an emptied draft can be saved; running is still blocked by
the "add 1 to 5 steps" issue — accepted. (3) New `PlannerScreen.test.tsx` (planner had no unit
test); `PlannerScreen.tsx` CRLF→LF, content diff only — accepted. (4) Run now / Retry only
enqueue; the screen drains immediately after; the Ready commit drains itself — accepted
(deterministic store tests). (5) The `not-persisted` stop marker lives in memory only (writing it
would put memory ahead of storage); Resume shows while set — accepted and honest; after a
reload the run is `running` and the drain on mount resumes it. (6) e2e does not press Ready on
an already-ready article (no button exists); store tests cover unchanged Ready; e2e covers
draft → paused → Ready — accepted. (7) Workflows pause but cannot be deleted — out of scope,
noted for a later packet.

Evidence (executor record): vitest check line 478/478 (21 files) plus planner 14/14; `pnpm
lint` exit 0; `pnpm typecheck` exit 0; prettier clean on all 34 files (LF); `pnpm build` exit 0
(`○ /social/workflows`); `pnpm e2e e2e/workflows.spec.ts e2e/autopost.spec.ts e2e/website.spec.ts
e2e/planner.spec.ts e2e/ideas.spec.ts e2e/calendar.spec.ts e2e/settings.spec.ts e2e/world.spec.ts
e2e/tools.spec.ts e2e/quick-actions.spec.ts` 149 passed, 5 skipped (desktop-only scenarios on
phone; no unrelated failures). Not run: full `pnpm test`, full `pnpm e2e`.

SHA256 of every DT-4 file (recomputed 18:50 AST):
```
425d0bc98896ad78fb89a0140d2b8cf4a6f136b9c09838f63791e1d75c801138  lib/workflows.ts                                  (new)
3cbdb4d96e527ff4105cb2083796373df9d1de4c31e3e76ee13c4c6c5d4cb8bb  lib/workflows.test.ts                             (new)
6fc9765cb75c0c63e39a0e96b7e4979c84d223aeb92389ee8c753166051f16a0  components/social/workflows/WorkflowsScreen.tsx   (new)
6b5a2d23f12ea38fbb3420622388989b153f84b409bb6c4917fd5284a0762a2c  components/social/workflows/WorkflowEditor.tsx    (new)
4e5f3881fe4140195654555277df0401700c7a62c9cf4729281cfa5f48c50bd2  components/social/workflows/WorkflowsScreen.test.tsx (new)
5c8b7b296e708c500bbd5fa31a2ad220b60c4893ca4d2ab8c058d91dd2566ecd  app/social/workflows/page.tsx                     (new)
7ab869546377de216d222c6164efb186b763fb11278dadaba6711ffb01928869  messages/workflows.ar.json                        (new)
8c583a310ec8ccba13a862c1bd86cf120557dbbf39b7b77b9f9ab60e337106b6  messages/workflows.en.json                        (new)
80fbe3401689858663f564f36dc851f4ad9c06f9474acc44381b689eef76da09  e2e/workflows.spec.ts                             (new)
fb2a94aec9df78d926eea9ab75a388628a2cc59559e3a8d19f013fd4aa1cb08a  planning/tools/34-workflows.md                    (new)
243dec9dd08e97b11431c18002200418a39ccfe8ab084a3b5f66ab3e3098bb29  components/planner/PlannerScreen.test.tsx         (new)
a4c6ae3e0ee5f92d98843f0e84e915d27efcfa90b65c94231b2de0e10ccde7d6  components/planner/PlannerScreen.tsx              (Amendment E; CRLF→LF)
e6bf126718f5888e9f14b00ea75d36597685dde1bdb199294c4edd9f2027752d  e2e/planner.spec.ts                               (one new case)
cfd123981aa57a09e99c833ca6d424a4eb8540fd1d48bdd8797657ea1a798213  lib/domain.ts                                     (was 3de368d5…)
e6972d51738233c187b041e91d8042bff56a43dd10e193979fc5fa1eb883826a  store/index.ts                                    (was 2aaf6529…)
f3056f21c20c80d4c73a50390e15a70c635a09c8e94d1dbd4b8d1efbd936a58b  store/index.test.ts                               (was f5fa7f3f…)
8458280bcae523e71baa2210f8a2ba11e38d9d4c983daa85b1d8dcdb921b442a  lib/i18n.ts                                       (was bc40d695…)
cbd248d42643edb6d2e3681895fc6170a0ae5ec71250c1ff486e8964ea7a20de  components/social/website/WebsiteScreen.tsx       (was 264d1dac…; one drain line)
791c5101ff2fac8e776b1b61c6768b0e8d5e0ed395df2e41a82b793e2427cd70  components/shell/nav.ts                           (was 202acc64…)
b36fc5b6a25fcf75f34a65b57c69ea6bfb0b9863529061f914a676eec8b4c574  components/shell/nav.test.ts                      (was 4258a595…)
baccfd7e4078b86300fb5f7ca4417af6265fbe2ef8520fe90aa1c16260dfc7f5  components/shell/MoreScreen.tsx                   (was ff7e918d…)
68fd0062e1222c6c8b9391f6a02d132cb21ea528c3fe4d983bd4bce048a9c414  components/shell/MoreScreen.test.ts               (was 52c643b0…)
6ee34f58daa284ae7bb77eb8e98804b6349e8eeef12301e4fe877d57b2087183  lib/tools.ts                                      (was 5d5641e4…)
ed286361bd8dec2df2977889ca21324a56dee437fb436e76e76f80dd26671bb3  lib/tools.test.ts                                 (was c6ec17c3…)
83d2d0b4f3f4a6b47dfbcecd45f6805895bb6a6f91c56210d974948024073910  messages/tools.ar.json                            (was 339f9fc1…)
d864950213ca5b0ae0169c553111590532cdd0109854c70d0acd04a6671581ab  messages/tools.en.json                            (was 011b9ec9…)
8f7aa1fcc800d58eeaa5d9e7070a82f4b22eb43bcb1831eaa6db7ebfa635c8d3  messages/ideas.ar.json
5af83899bee461e487780d130a74f499842e7dc4ab809a6c737d02d3eee1ce05  messages/ideas.en.json
6b07d2a3c7b18af0dbc5b6283928c23f12e61bf41fab441a1ebc87e11e267599  messages/planner.ar.json
73eac06f2dd1cab7e490000406da511c5d48027ea717ed7bf640e7ce2fa155bf  messages/planner.en.json
112e24a96a57ff6b80a2efcab737db93e31fc265cc13c91f91b895b8b4e1a8da  components/tools/ToolsScreen.test.tsx             (was f66010fe…; planned→available)
fabdae67b30c94beb8017ccf7049b4fab449a9b4e957e23dc16f17c42139feea  components/shell/QuickActions.test.tsx            (was 1cfd864a…)
30b118e9b94a40db6de4a3752e1b71d65cd9bb3273ac29e20153b3dbac9b2169  e2e/tools.spec.ts                                 (was 3baf9eb8…)
c7b15d72bd67413ec29721b02acbfdadbd5f47056fbd8b40b9c80e9b3964d802  components/social/ideas/IdeaRow.tsx               (+2 lines, outside the original list)
```
Served export on localhost:3000 (not restarted), each 200 and identical to disk at 18:50 AST:
```
2120ac306aad87f01620adff72559e53dd367c4fdd497d35d2b5ef3fb349e1f4  out/social/workflows/index.html
4585fe969b846bd17c348d0577e4eeeb5e033873d6090018e2f558a704be7531  out/social/website/index.html
3d44b725f7f352f625cdd356d7ab892c6cebc03c792eeddc38e89f9a68d19c2f  out/index.html
3b539a069a6ab6bee5d4bffc537fc0efc7ad07b60f258ebfe6f66ba2ba6e81b5  out/social/index.html
551322d3e6908234ee0f4efcea7719e34cc57e9805c93dacc3dcb08d7948dbb9  out/tools/index.html
51985856740175079e759b9b5025d7a0da2a83e8f41652be35433a300f2c106e  out/planner/index.html
```
DT-3 files not listed here keep the repair-round-1 hashes below. Known limits (also in
`planning/tools/34-workflows.md`): runs execute only while this browser is open; queued or
running runs resume when Workflows or Website opens; no cloud schedule, no posts or replies sent,
no provider or AI call, no XP; workflows pause but are not deletable yet. No push, merge, deploy,
paid service, permission grant, live post or DM.

## Freeze after repair round 1 (Fable 5.1, 16 Oct 2026 17:45 AST) — DT-3, still valid for files not touched by DT-4

Implementation owner: none.

Source edits for repair round 1 stopped at 17:42 AST. Planner spot-checks, read-only, 17:43 AST:
- Changed this round: exactly five files below. `lib/articles.ts 14250efc…`,
  `ArticleMarkdown.tsx f8661224…`, `store/index.ts 2aaf6529…`, `lib/domain.ts 3de368d5…`,
  `messages/website.en.json f828cbcc…`, `AppShell.tsx ebe78e26…`, `native-search.js 1a3b8712…`
  unchanged; every other hash in the 16:20 freeze below still applies.
- Guard: `unsavedDrafts.subscribe(...)` at module level adds/removes one `window`
  `beforeunload` handler as the stash map becomes non-empty/empty (`ArticleEditor.tsx:109`);
  `WebsiteScreen` no longer mounts a guard. Stash entries carry a monotonically increasing
  `token`; `dropUnsaved(id, token)` clears only a matching token (`:95–97`); the unmount cleanup
  stashes synchronously and the deferred flush re-stashes or drops by token (`:303–307`); the
  editor follows `unsavedDrafts` and the store for late updates (`:331`, `:348`).

Rulings on the executor's concerns: (1) identical stored fields are loaded, not reported as a
conflict — accepted (no data at risk; the only side effect is that another tab saving the exact
same text is not a conflict). (2) Discard does not cancel a queued save that lands after the
lock releases; the open editor then shows it — accepted as pre-existing behaviour, recorded for
Codex. (3) The module-level guard exists once the CMS code has loaded, which is the only time a
stash can exist — accepted. (4) Running Codex's adversarial spec overwrote
`adversarial-results.json` and `adversarial-results/` in Codex's temp directory; the spec and
config were not edited — disclosed here for Codex.

Evidence (executor record "Repair round 1 record"): RED first — 4 new jsdom tests failed on the
old code (4 failed / 33 passed); both new e2e scenarios failed on the old build at the guard
check after leaving for Calendar. GREEN — components 37/37; `pnpm vitest run
components/social/website lib/articles.test.ts store components/shell components/tools messages`
18 files / 376 passed; `pnpm lint` exit 0; `pnpm typecheck` exit 0; prettier clean; `pnpm build`
exit 0; `pnpm e2e e2e/website.spec.ts e2e/settings.spec.ts e2e/world.spec.ts e2e/tools.spec.ts
e2e/quick-actions.spec.ts` 83 passed, 3 skipped (pre-existing phone world skip + the two new
desktop-only scenarios on phone); Codex's `cms-adversarial.spec.cjs` with its config against
:3000 → 3 passed.

SHA256 of the files changed in repair round 1 (recomputed 17:43 AST):
```
109f99ca2d08787b801a0f7d1f2c37f1772ffa9905790960a1dc065d54931a11  components/social/website/ArticleEditor.tsx       (was 0470fd04…)
f6472f94f11c1937fa83ecdb69dfacba92576a61edb4e0b68e5f45c2acfd66a3  components/social/website/ArticleEditor.test.tsx  (was 68f69b01…)
264d1dac4b7f0bfa3eeb82d2afaab721c503fc3e57d3a37183e9e8814a6022c1  components/social/website/WebsiteScreen.tsx       (was 052528f3…)
aaedee647aa577757018a42ccd9a6b5dff8ff36f06db14c4d073e699f2c64bb8  components/social/website/WebsiteScreen.test.tsx  (was e282071b…)
a1660056884df9b1d112ef465ef9e9226fc68b5cad773d9b4deb24dd0682e092  e2e/website.spec.ts                               (was da34e61f…)
```
Served export on localhost:3000 (not restarted), each 200 and identical to disk at 17:43 AST:
```
4c6b26fd37e35fecc2603d3d74d2732671495605ec19e50a7f971b1b63b3e2d5  out/social/website/index.html
4cc899383c8e4a4a62379b00689c4c60b207cdfc3a846c80423231777d241357  out/index.html
af4005a3dda3b923bb964d9a67005e0ceb2dc2fff70cfdf9a347ea94bcceee35  out/social/index.html
db1882a472492f9e39a5fb461c94561c1e6cd7528c55954922921aaa7f731384  out/tools/index.html
```
DT-4 workflows not started; next immediately after Codex's DT-3 acceptance. No push, merge,
deploy, paid service, permission grant, live post or DM.

## Freeze (Fable 5.1, 16 Oct 2026 16:20 AST) — superseded by the repair-round freeze above for the five files it lists

Implementation owner: none.

Observed times: plan written ~15:30 AST, executor dispatched 15:34 AST, source edits
15:36–16:16 AST (executor record), amendments A–E forwarded 15:35, 15:36, 15:43, 15:45, 15:54,
16:04 AST. Planner spot-checks, read-only, 16:17–16:19 AST:
- File set: the DT-3 allowed files plus four the executor flagged — three tests that encoded
  "website = planned" (`components/tools/ToolsScreen.test.tsx`, `components/shell/QuickActions.test.tsx`,
  `e2e/tools.spec.ts`) and `package.json` + `pnpm-lock.yaml` for `mdast-util-from-markdown`
  (Amendment C). Ruling: accepted; both follow directly from the plan.
- Additive store/schema edits: `lib/domain.ts` 0 removed / 49 added lines vs HEAD;
  `store/index.ts` 1 removed / 267 added vs HEAD, and the one removed line
  (`settings: { ...DEFAULT_SETTINGS, gear: [...] }` in `initialData`) is the pre-existing Discover
  `editorScope` change already present at Freeze 24, not DT-3. Executor verified that removing
  only its added lines restores the pre-packet hashes (`store/index.ts 1f812dc8…`, `lib/domain.ts
  dcaae152…`); Codex verifies by hunk.
- Dependency: `package.json` gains exactly `"mdast-util-from-markdown": "^2.0.3"`; lockfile +3
  lines (importer entry for the 2.0.3 snapshot already present). No download; it is
  react-markdown's own parser.
- No `completeQuest`, XP/gem writes, `fetch(`, `img:` acceptance, raw-HTML rendering or
  `rehype-raw` in `components/social/website/*` or `lib/articles.ts` (code lines).
- Registry: `lib/tools.ts` website row is `publish`/`available` → `/social/website`; planned list
  keeps Business kit, Workflow builder, Conversations inbox. `nav.ts` website no longer `soon`.
- Copy: `messages/website.*.json` 78 keys each; honest lines present (`website.localOnly`
  "nothing is public", `website.storageBlocked`). New `website.sub` replaces the promise of
  comments/newsletter/cheat sheets (ruling: accepted; `social.website.sub` left unused rather than
  reworded, to avoid touching DT-1/DT-2 copy).
- Frozen neighbours unchanged: `native-search.js 1a3b8712…`, `lib/trendingSounds.ts 709926e3…`,
  `lib/platformIcons.tsx 907b8b38…`, `QuickActions.tsx c21ee022…`, `AppShell.tsx ebe78e26…`,
  `ToolsScreen.tsx 2049b34b…`, `AutoPostScreen.tsx 19216c96…` (`/social/automations` untouched).
- Codex review file not edited by Claude (untracked, Codex's own timestamps).

Rulings on the executor's concerns: (1) Amendment B vs C — generation bumps on import/reset in
this tab, and on another tab's import detected through the shared library epoch change; remote
sibling edits survive (C) and same-article remote edits are caught by `commitId`. ABA via
re-import still trips the generation bump. Accepted; flagged for Codex to confirm. (2) Offline
install: `pnpm install --offline` could not resolve metadata; the executor added the importer
entry by hand and `pnpm install --offline --frozen-lockfile` succeeded with no network. Accepted;
Codex should rerun `pnpm install --frozen-lockfile --offline`. (3) `website.sub`: accepted (see
above). (4) Limits accepted and recorded in `planning/tools/33-website-cms.md`: session-only
unsaved-draft stash plus `beforeunload`; `pagehide` best-effort after the `visibilitychange` save;
raw HTML neither rendered nor scanned, exported as typed. (5) CRLF→LF on six files: content
diffs only.

Evidence (executor record above, real RED→GREEN times per unit; `e2e/website.spec.ts` written
after the units and green on first run): vitest 19 files / 411 passed; `pnpm lint` exit 0;
`pnpm typecheck` exit 0; prettier clean on all changed files (LF); `pnpm build` exit 0;
`pnpm e2e e2e/website.spec.ts e2e/settings.spec.ts e2e/world.spec.ts e2e/tools.spec.ts
e2e/quick-actions.spec.ts` 81 passed, 1 pre-existing skip (desktop-only world test on phone).
Not run: full `pnpm test`, full `pnpm e2e`.

SHA256 of every DT-3 file (recomputed 16:18 AST):
```
14250efc5754c03aaee133c1e61d6758656b79833011fd3946c384a22a44294a  lib/articles.ts                                   (new)
2dd20ad943f451c47e5859676d631f771868ef1547ef4b0944fd9b1f8a8eb5f8  lib/articles.test.ts                              (new)
052528f36bc4fa1a107b5cbb6571f1000330207018ce7d9463d99da17c41f87f  components/social/website/WebsiteScreen.tsx       (new)
0470fd04835157c553d2b0aba2d5dac9086025fda50e23baa41c4d45f43db99c  components/social/website/ArticleEditor.tsx       (new)
f8661224032efea7b8b177b595dfe6b9665dc3fc04848a70d20781cb1268a049  components/social/website/ArticleMarkdown.tsx     (new)
e282071b0d9d8d6d3d938297bfeffbbd241310c39fffb58c26041e33e8f557b4  components/social/website/WebsiteScreen.test.tsx  (new)
68f69b010a16bb49401349599e5a8a623ffa7cab9ca94c85a8e61fb68eebdee3  components/social/website/ArticleEditor.test.tsx  (new)
4d87e9ecb5b057d8e7df8decb3ff4533556a856b31e15decee3528e7a89f9b04  messages/website.ar.json                          (new)
f828cbcc0f2df40f6ed12a559ae7f18f618e9099fe9de56ac3bc22f304e62eb0  messages/website.en.json                          (new)
da34e61f1f603261940df6f84f60552970a08e59d679f0a022526333b9584617  e2e/website.spec.ts                               (new)
fa009e3f7d2ea0fe197161c319419a76c7b28f9e15917d279f3bf024808055b9  planning/tools/33-website-cms.md                  (new)
3de368d5fc70a3ecf636db9a5caa64ba0fdffda3d06b4a8446ade9a296bad555  lib/domain.ts                                     (additive; was dcaae152…)
2aaf65296a27fb8da0a5766596bfc16bfb5759605d6f7272acc9087ed47937af  store/index.ts                                    (additive; was 1f812dc8…)
f5fa7f3fb2c412a84613ca63de3bfceddb1a69d486fe6eba6132b7d969122264  store/index.test.ts
bc40d6956e892c77e52666df3ea9665db13a27330f22eb28566b97011ac21b95  lib/i18n.ts                                       (was 18a66125…)
a0757edb508021fe022e825ae5aeb8c2071849f97796ecabe6f788a2251a49ef  app/social/website/page.tsx
b37c32220a334345354367d951c6992497ec6dd03dae02ed614b21723bcc47b2  components/social/SoonScreen.tsx
202acc64df4650a1fa7126a441308d778a489eaef36e0bbaa509422df6351d6c  components/shell/nav.ts
4258a5950fd47440c618acb3c391e50421f537ba3aad79f6ea5dcb6bdeb3ffcf  components/shell/nav.test.ts
ff7e918d0b684e3adafa24a9079c50e15dc53c8a962e64a5978a8307945f5d32  components/shell/MoreScreen.tsx                   (was 6d1875d6…)
52c643b0cb9b54f99c627609f0fc0f2cbc6675148f0566c7c66fcac8b3f2ff26  components/shell/MoreScreen.test.ts               (was 0478e897…)
5d5641e47a64894b346645522854bf2b6d530c0a5af618f046b22cf4e8e036bf  lib/tools.ts                                      (was b32f3b64…)
c6ec17c36378346e3f4e3954347cc9317199a2233c0a49d19fba10521934073d  lib/tools.test.ts                                 (was 8e9621e6…)
339f9fc1212a76b37ace7cbee0620322e955c4f1a58da9943bfeae05596b83cd  messages/tools.ar.json                            (was a3c7875f…)
011b9ec906015bdd40acf2310fdd10010067f235faab8a375bd5c1415e80d08b  messages/tools.en.json                            (was 95b026d0…)
f66010fe6832efe875b4918602b0f434cba5743683ac8ead5e0d13de727363dd  components/tools/ToolsScreen.test.tsx             (was 6d771c34…; planned→available expectation)
1cfd864a226f56c7ad1fb6246d3c027d6d00c90f6c2fa16301ee29468e310778  components/shell/QuickActions.test.tsx            (was 0e05c0e8…; website now navigable)
3baf9eb807441f7feb494bb318610978e453643e91845f31daf7c2eb01196f00  e2e/tools.spec.ts                                 (was 282df99b…; planned-row expectation)
9456ebd1a29753a1c7f0d25b32facd499ca2fe75cc12673ff30b27e99852712a  package.json                                      (+ mdast-util-from-markdown ^2.0.3)
68b677bc63c0123fc5d42bf39b236221595f0d584ffd7e3095bfb8d20a0386d3  pnpm-lock.yaml                                    (+3 lines)
```
Served export on localhost:3000 (served from this worktree's `out/`, server not restarted),
each verified 200 with identical hash to disk at 16:18 AST:
```
f6e3619fd082af5bbdc324bf8c7fef3b50002a0e3ae127f1d6ffbe6e109cd47f  out/social/website/index.html
969cc498c5f09334ec611a5a783f764e7d43ec90defc1107b6e17fcc46bdd842  out/index.html
2870674160cd477d005ade283fa1e5eb44f4f36eaef4e94a33cc5a6b7569d7b9  out/social/index.html
ccd2cd5a695b2caa34379080ab128e7511e35765d79700668ddcd135cd2c7d16  out/tools/index.html
```
Every page export changed (shared shell/registry); no Discover source changed.

Known limits (also in `planning/tools/33-website-cms.md`): articles live on this device only;
no public publishing; Web Locks required for safe saves (`unsupported-save` otherwise);
unsaved-draft stash is per SPA session; raw HTML not rendered or scanned. DT-4 workflows not
started; waits for Codex's DT-3 acceptance. No push, merge, deploy, paid service, permission
grant, live post or DM in this packet.
