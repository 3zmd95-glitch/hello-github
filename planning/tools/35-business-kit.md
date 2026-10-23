# 35 · Business Kit and the Workflow → AutoPost bridge (packet DT-5)

Status: implemented locally, 16 Oct 2026 (Opus 5.5, single writer). Not deployed; nothing is public. Plan and
amendments: `planning/collaboration/dashboard-remaining-tools-handoff.md` ("DT-5 plan", Amendments A and B).

## What the owner gets

`/social/business` (More → Business, Quick Actions «بزنس» / "business", Tools → Business kit):

- **Media kit tab** — tagline, about, public contact, services (≤ 8), rate card (≤ 12, the owner's own price or
  "ask me"), past work (≤ 12, https links), which platforms to show. Autosaves like the CMS and workflow editors.
- **Your numbers** — per platform, read from Growth, each with its source line. The media-kit page adds the fresh counts up (stale ones left out; Oct 23 addendum).
- **Rates tab** — the private calculator `(followers ÷ 1000 × rate + views ÷ 1000 × rate) × deliverable multiplier`; replaced the old estimator on Oct 23 (see the addendum). Never printed or exported.
- **Preview / Print / Save as PDF / Export JSON** — built from the editor's current draft.
- **Brand deals tab** — brand, contact, stage (lead → talking → offer → agreed → delivered → paid, or lost),
  deliverable, value, notes. Filter by stage, inline edit. Deals are never deleted; "lost" keeps the history.

Everything lives on this device (`localStorage`, same store as the rest of the app). Public hosting is DT-8.

## Data model (additive, `lib/domain.ts`, `store/index.ts`)

- `BusinessKitSchema` (bilingual text fields with caps, services, rateCard, pastWork, featuredPlatforms, estimator,
  `revision`, `commitId`, `updatedAt`); store slice `businessKit: BusinessKit | null` (null until the first save).
- `BrandDealSchema` + `DEAL_STAGES`; store slice `brandDeals: BrandDeal[]`.
- Old backups without either slice import cleanly (defaults null / []).
- Actions `saveBusinessKit`, `addBrandDeal`, `updateBrandDeal`, `setBrandDealStage`: each one `commitFresh`
  transaction (the shared exclusive lock, fresh rehydrate, write, read the new `commitId` back; a write the browser
  did not keep rolls memory back → `not-persisted`; no Web Locks → `unsupported-save`). No XP, gems or quests.
- Bases: `businessBase(kit | null)` = `{ commitId | null, generation }`. The editor captures it on mount even when
  no kit exists; a moved generation (import / reset) or a `commitId: null` base after a kit appeared is a conflict, so
  a queued first save never recreates discarded text.

## Provenance rules (`lib/businessKit.ts`)

- Per platform only (`kitMetrics`): followers, engagement, avg views, avg likes.
- Before averaging, snapshots dated after today (Riyadh) and posts published after now are dropped.
- Each value carries its own source, taken from `platformOverview` row by row:
  - `snapshot` → "Saved Growth snapshot · observed {day}" (never "live": `snapshotSource()` infers live from the
    connection and is not evidence for a public claim);
  - `posts` → "From {n} posts · {from}–{to}", the real sample (30 days with ≥ 5 posts, else the latest 20; stories
    excluded). Engagement counts only posts with views (the Growth average's own denominator);
  - `none` → "No number yet".
- A snapshot older than 30 days is marked stale. Snapshot `views30d` (0 when unknown) is never shown or exported.
- Per-platform tiles carry no pooled averages (the "All" averages of Growth are not used); the media-kit page shows one total of the fresh follower counts (Oct 23).

## Estimator (history)

The engagement-weighted estimator of DT-5 was replaced on Oct 23 by the Rates tab (`lib/rates.ts`): see the addendum below. It stays private and silent while the rates are still the placeholders.

## Export, print, preview

- `kitProjection` builds the public file field by field (allowlist): kit text, contact, services, past work,
  per-platform metrics with provenance — no rate card since Oct 23 (rates are private). Never deals (contacts, notes, values), the estimator, settings, keys,
  raw snapshots, ids or commit data. Deep-key tests guard this.
- Preview, Print and Export use the editor's **current draft**. While it is not saved (pending, failed, conflict) the
  page says so and the file name ends in `-unsaved` (`3z-prod-media-kit-<day>-unsaved.json`).
- Print uses the browser (`window.print()`, Save as PDF) — no PDF library. `app/globals.css` has an additive
  `@media print` block: on a page with a `[data-print-root]`, everything that is not the root, inside it or one of
  its ancestors is `display: none`, and the ancestors collapse to plain blocks, so the printed page is exactly as tall
  as the kit (DT-5-R1 R7: `visibility: hidden` kept the editor's height and printed two blank A4 pages).
- Brand-deal reply draft (DT-5-R1): "Draft reply" on a deal builds a bilingual text (Arabic, then English) from the
  deal (brand, deliverable, value) and the kit (services; the Rates-tab calculator's estimate when the owner has edited the
  placeholder rates, the deliverable names a kind and a fresh follower snapshot exists, else no price). Editable, Copy, saved on
  the deal (`replyDraft`, ≤ 2000) through the deal's commit; labelled a draft; nothing is sent, no AI. DT-5-R2: a
  Save or Copy acknowledges only in the panel session it started in (closing and reopening the deal starts a new
  one) and only for the text it handled: newer text typed while a save waited stays unsaved, saveable against the
  refreshed base, with "an earlier version was saved"; "Copied" never shows on another deal or newer text.

## Workflow → AutoPost bridge fix (Part A + Amendments A/B, app side only)

Workflow outputs keep their deterministic `wf:<runId>:<actionId>` post ids; the deployed Worker refuses them
(`/^[A-Za-z0-9_-]{1,100}$/`). `lib/publish.ts`:

1. `publishJobId(post, taken)`: a remembered `autoPost.jobId` that matches the Worker rule wins (invalid remembered
   values from imports fall through); else the post id when it is already safe; else
   `j-<post id with other characters as "-", ≤ 40>-<first 24 hex of SHA-256 of the post id>` (`lib/digest.ts`, pure
   synchronous SHA-256; FNV-1a 32 collided on Codex's pair). A candidate another local post holds (`takenJobIds`:
   their valid remembered ids and safe post ids) gets `-2`, `-3`… (≤ 100 chars).
2. The chosen id is saved as `autoPost.jobId` **before** the create request (no `sentAt`: an allocation, not a success
   claim), through the store's `allocatePublishJobId` (DT-5-R1 R2: the locked `commitFresh` transaction on freshly
   read storage, proven by reading the stored post back; a refused or silently dropped write is rolled back and
   nothing is sent). Every unconfirmed send re-proves it. A lost reply, another post leaving, or a reload never makes
   the retry pick a different id. DT-5-R2: the commit rechecks ownership on the fresh state (the same-id no-op too;
   another claimant → `ambiguous`, nothing written); after the await the send re-reads the post (gone, cancelled or
   holding another id → `publish.superseded`; another claimant → no POST), re-validates and builds the job from that
   fresh post, and records `sentHash` (digest of the body sent) with `sentAt`; an edit made while the create was out
   no longer matches it, so the auto-resync re-sends it. The release read-back needs a readable stored post with no id;
   an unreadable or malformed payload is not proof (memory keeps the id, failure shown).
3. One ownership decision (`jobOwnership`, DT-5-R1 R1) for schedule, auto-resync, run and cancel: the remembered id,
   else the safe post id of a post that remembers none; another local post claiming that id → blocked with
   "publish.err.ambiguousOwner", zero POST / DELETE. Run and cancel never allocate.
4. Receipts (`jobClaim`, `applyJobs`, `remoteJobs`, DT-5-R1 R3): a job is applied (results, marked posted, the Produce
   quest) only to its single owner — the one post that remembers its id, else a sent post whose safe id it is and
   which remembers none. Two claimants → a conflict row in the hub naming them; nothing is applied.
5. Unconfirmed allocations (DT-5-R1 R4): a job id without `sentAt` is listed as "Allocated, not confirmed" in the hub
   and the post's Auto-post tab, with Refresh, Retry send and Discard allocation. A read that finds the id confirms it
   (`sentAt`, scheduled). Discard is offered only after a successful read without the id and re-reads in the same
   queued step; offline / a failed read is "unknown" and keeps the allocation (releasing a possibly live id would let
   a changed taken set create a duplicate). DT-5-R2: the read behind Refresh / Discard is strict
   (`parseJobsStrict`: a `{ jobs: Array }` envelope with every row complete); a malformed 200 is "unknown" too. The
   tolerant parser stays for display only.
   DT-5-C1: the release read-back (`storedJobId`) parses the stored post with `PostSchema`, so a malformed `autoPost`
   (string, null, array) or invalid post is never proof the id was released; Discard keeps the id and shows the error.
6. Lifecycle (`components/social/usePublish.ts`): schedule, auto-resync, run and cancel of one post run one at a time;
   cancel bumps a per-post fence, so a send already in flight settles first, its reply is dropped, and the DELETE then
   removes what it committed. Nothing resyncs a cancelled job.

The deployed Worker is unchanged. Verified locally against a fake Worker that applies the real id rule to the POST body
and the raw run / cancel path segment; zero provider calls.

## Honest limits

- Local only: no public kit page, no sharing link (DT-8 / DT-10).
- Growth snapshots carry no stored per-row source or account, so the kit says "saved snapshot", never "verified".
- The estimator is arithmetic on the owner's own numbers; it is not market data.
- The ambiguity block is fail-closed: an imported post that claims the same job id must be cleaned up by hand.
- Scheduling now needs Web Locks (the durable allocation runs under the same lock as CMS and workflow saves); a browser
  without them shows "publish.err.allocation" and sends nothing.
- Ordering (allocation, sends, Discard's read) holds within one tab; cross-tab cancel vs resync stays the accepted
  DT-5 limit (DT-7).
- Search-before-building: print-to-PDF uses the browser (a PDF library would add a dependency for no gain); SHA-256 is
  a small pure function because Web Crypto's digest is async and the id is needed synchronously; no new dependency.

## Addendum, Oct 23 2026: media kit page (D2) and rate calculator (D3), both inside the dashboard

Roadmap rows D2 and D3 of `09-metricool-beacons.md`; scout plan `04-money-links.md` (only these two parts: no public site, no
domain, no email, no store, no click tracking until the owner decides). The scout called Business a placeholder; the code
already had the kit editor and deals board above, so this adds to them.

- **Media kit page** `/social/business/media-kit/` (`MediaKitScreen` + `MediaKitPaper`, pure numbers in `lib/mediaKit.ts`).
  A light A4 sheet in Arabic or English (its own switch; the app keeps its language), built only from what the app stores:
  the saved kit text and contact, `kitMetrics` per platform (followers, engagement, average views, likes, each with its
  source: snapshot day with its year or "posts sampled"; a dash where missing; stale chip), a followers total that is a
  plain sum of the saved counts from snapshots no older than 30 days and says "platforms counted n of m" (a stale count
  stays on its tile, marked old, but is left out of the total and the hero chips), audience from `demographics` (gender, age buckets, top 5 countries,
  newest day per dimension, nothing dated after today), the 6 newest imported posts (no stories, nothing from the future),
  services, past work and case studies (https links only) and a Work-with-me card (mailto of the kit's email). Block switches
  (`businessPrefs.blocks`) and the page name (`businessPrefs.name`, else the first saved handle) live in the store; an empty
  block is left out and the switch says "nothing to show yet". Brand partners are not a block (no data to read; past work
  carries the case studies). No photo yet (the pixel avatar is a game look): a monogram stands in.
- **Rates are private (ruled, scout decision 5a).** No printed or exported kit shows a price. The page's rates block only says
  "rates on request"; the editor's preview (also a print root) lost its rates block; the JSON export lost its `rateCard`
  (the file is the future public projection); the editor's second print button is now a link to this page. Tests scan the
  sheet, the preview and the export for prices. The editor's **Rate card** section stays (marked private): `dealRate` reads
  it for the deal replies.
- **Print / PDF.** The sheet is the page's print root (the DT-5 `[data-print-root]` rules hide everything else), re-declares the
  light tokens on itself so it is white even in the dark look, and uses a named `@page kit { size: A4; margin: 12mm }` so other
  pages print as before. "Export PDF" is `window.print()`. Checked: `page.pdf({ preferCSSPageSize })` gives 595 × 842 pt.
- **Search-before-building.** PDF libraries (jsPDF, pdfmake) do not join or reorder Arabic without add-ons, and a Worker PDF
  (Browser Rendering) is for the public site later; browser print gives correct Arabic at zero cost. Adopted: print CSS.
- **Rate calculator** (Business › Rates tab, `lib/rates.ts`). `SAR = (followers ÷ 1000 × SAR per 1000 followers + average
  views ÷ 1000 × SAR per 1000 views) × multiplier`, one platform at a time, rounded to 10 SAR below 500 and 50 SAR above
  (never 0 for a positive amount). Defaults 15 and 20 SAR per 1000, multipliers reel 1.5, story 0.5, post 1, bundle 2.5
  (reel + story + post together): placeholders, edited by the owner, labelled "not a market rate", kept in the store
  (`businessPrefs.rates`, part of backups). No follower count = no quote; missing average views are not guessed (followers only,
  said on screen). The scout's "followers × average views × deliverable" is read as this sum, not a product (a product of the
  two would be millions).
- **One price source.** The old engagement-based estimator is gone from the kit tab. The brand-deal reply draft (`dealRate`)
  quotes the rate-card row, else the same calculator, but only once the owner has edited at least one assumption: while all
  numbers are still the placeholders there is no "starting estimate" in the reply (the Rates tab says so). A
  "bundle/package" deliverable is its own kind; a plain "video" has no kind and gets no estimate. `BusinessKit.estimator`
  stays in the schema, unread and never edited, so old saves and backups still load.
- **Not done.** D3: add-ons (paid usage, organic usage, whitelisting, exclusivity, link in bio), a minimum price (floor), the
  scout's per-platform CPM defaults from the owner's real rates. D2: public URL and domain, the contact form behind "Work with
  me" (a mailto link stands in), a brand-partners list, a photo (a monogram stands in), publishing a refreshed kit anywhere,
  a server-made PDF. Safari's support for the named A4 page is unchecked.
