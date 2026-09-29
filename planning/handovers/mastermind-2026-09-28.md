# Mastermind plan (round 30): post everywhere v2 + Trend Radar

Sep 28, 2026 · written from a fresh read of the whole repository (11 subsystem maps, 7 research sweeps, 8 code claims verified),
`main` at `8e4d629`, PR #15 (round-29 handover) still open. This is the coordination file: where the project stands, what the owner
asked for, how the work is split so every agent knows its task, and the questions only the owner can answer.

## Where the project stands (verified Sep 28, 2026)

| Piece | State |
| --- | --- |
| Dashboard | Live at <https://3zmd95-glitch.github.io/hello-github/> (static Next.js 16 export, RTL, `data-world` training / social). Pages run #20 green |
| Scout Worker | Live at `https://3z-scout.3zmd95.workers.dev` (Tavily search, OAuth + daily analytics sync, publish queue on a `*/5` cron). Worker run #16 green |
| Connected accounts | TikTok, Instagram, YouTube (`@3zprod`), Threads (`@3z.prod`) connected **with posting permission** ("Posts by itself") |
| Auto-posting | Threads text published for real (<https://www.threads.com/@3z.prod/post/Dd1b3I2ihCB>). Instagram / YouTube / TikTok video paths exist but have **never run against the live APIs** (mocks + e2e fake Worker only). YouTube uploads stay private and TikTok `SELF_ONLY` until the audits |
| Trends | Nothing: `TrendsCard.tsx` is a "soon" placeholder; no store slice, no Worker route (`tools/08-trends.md`) |
| Quality gates on this branch | `pnpm lint` ✓ · `pnpm typecheck` (app + Worker) ✓ · `pnpm test` 765/765 ✓ · `pnpm build` ✓ (all routes static) · e2e not rerun this round |
| Training world | Sprint 1-2 complete (Today flow, skills, map, planner, review, rewards, notes, Discover) |
| Placeholders | Website, Business (Social world), AI coach (Sprint 4), Supabase sync + Web Push (Sprint 3) |
| Repo hygiene | Public repo, no branch protection on `main`, six merged `claude/*` branches still on the remote |

Local facts for agents on the owner's laptop: `pnpm` is not on PATH in this shell; use `corepack pnpm …` or put
`%LOCALAPPDATA%\corepack-bin` (created with `corepack enable --install-directory`) first on PATH so nested `pnpm` calls in scripts work.
Do not commit or push on the owner's laptop unless he asks.

## The owner's two asks (round 30)

- **A · Post everywhere, seamlessly.** "A tool in my social media dashboard to post on every platform: YouTube, Threads, TikTok, Instagram.
  Everything seamless, make me work less. Keep the dashboard simple."
- **B · What is trending now.** "Arabic or English content on TikTok, Instagram and YouTube, so I can post something like it."

Done means: (A) one post, one media file picked on the phone, every connected network out by itself, X and Snapchat reminded, no
reopening of tabs or retyping; (B) one card that shows today's Saudi and English trends with sources, one tap to turn any of them into a
planned post.

## Workstream A · Post everywhere v2

What the owner still does per post today (measured against the code):

1. Export, upload to Dropbox/Drive, set "anyone with the link", paste the link (Drive is now rejected by Meta; Dropbox works only through
   `dl.dropboxusercontent.com`).
2. Create the post for **one** platform (`PostForm.tsx:28`), save, reopen it, open the 🚀 tab, tick the other networks by hand.
3. Fix captions per network because the default overflows Threads (500) / X (280) / Snapchat (250); an overlong X or Snapchat caption blocks
   the whole schedule even though those two are never sent (`lib/publish.ts:152-154`).
4. Set day and time in another tab; after any edit press "Update schedule" again by hand.
5. Copy the X / Snapchat captions and post them in the apps; the copy promises a reminder that does not exist.
6. Flip YouTube to public and TikTok to public in the apps (audits pending).
7. Keep the tab open to see progress (watcher polls only while visible); results live in that browser's localStorage only.
8. Reconnect Instagram / Threads every 60 days and YouTube weekly while the Google consent screen is in Testing mode.

Backlog, in the order that removes the most work first:

| # | Item | Effort | Needs the owner? |
| --- | --- | --- | --- |
| A1 ◔ | **First live video post** to Instagram + YouTube + TikTok from one post; fix what the live APIs answer differently; log it in `07-auto-posting.md`. Running in a separate session (worktree `auto-posting-live-1c9519`): YouTube private upload worked; the Instagram user-id fix and the TikTok `private_account` code wait for the owner's OK to push | M | a public MP4 link (< 64 MB first) |
| A2 ✅ | **Composer**: networks step in `PostForm` pre-ticked from `canPublish`; captions auto-trimmed per network (hashtags dropped first, "trimmed" badge); X / Snapchat overlong caption warns instead of blocking; auto-resync the Worker job when caption / day / time change; `visibilitychange` refresh; "Post now" on a post without a day sets today | M | no |
| A3 | **Media from the phone**: Backblaze B2 (10 GB free, no card) presigned S3 PUT signed by a new Worker route `/upload/sign` (aws4fetch), `/media/<key>` streamed through the Worker so TikTok's URL-prefix check can pass; file picker replaces the URL field; images converted to JPEG ≤ 8 MB on the phone; lifecycle delete after 14 days. If a card ever becomes acceptable, Cloudflare R2 replaces B2 with the same routes | L | B2 account (free), or the R2 decision |
| A4 | **X through Buffer's free API** (3 channels, 3,000 requests / 30 days; Buffer holds the X relationship, X's own API is pay-per-use with a card): Worker target `x` → Buffer; `MANUAL_PLATFORMS` shrinks to Snapchat | M | a Buffer account + decision |
| A5 | Instagram **carousel** (2-10 children) and **stories** (`media_type=STORIES`, ≤ 100 MB, 3-60 s) in the Meta container flow; `mediaKind` gains `carousel` / `story` | L | no |
| A6 ✅ | Token-expiry warning ("reconnect in N days") on Settings and the hub; a Studio inbox row "X / Snapchat caption ready, post it now" at the scheduled time; fix the copy that promises reminders | S | no |
| A7 ✅ | Worker `jobId` on `autoPost` + hub reconciles `GET /social/publish` by id, so a second device or a cleared browser still sees and cancels jobs | M | no |
| A8 | **Audits**: `/privacy` and `/terms` pages (AR/EN) on the site; YouTube API compliance audit form; TikTok Production app (icon, description, policy URLs, demo video of the composer built from `creator_info` with no defaults, disclosure toggle, confirmation screen); rename the TikTok app "3zProd3z Prod" | S + owner | forms are the owner's |
| A9 | Snapchat: no viable API (Public Profile API is partner-only; Zernio's Snapchat connect returns `PLATFORM_BETA_RESTRICTED`). Stays manual; re-check monthly | — | — |

Decisions kept from round 28 (do not re-litigate): official APIs from the Worker, no paid scheduler; media as a link until A3 lands.

## Workstream B · Trend Radar v1

Design, sources, budgets and the search log are in `planning/tools/08-trends.md`. Steps:

| # | Item | Effort | Needs the owner? |
| --- | --- | --- | --- |
| B1 ✅ | Store: `TrendItemSchema`, persisted `trends` slice with Zod defaults, `setTrends` / `dismissTrend`, selectors, backwards-compat + export tests; `data/events.ts` + `planning/data/saudi-events.json` | M | no |
| B2 ✅ | Worker `trends/` module: Google Trends RPC + RSS fallback (SA, US), YouTube charts (SA, US), kworb TikTok sounds, daily keyword `search.list` (≤ 12), weekly Tavily scan (AR + EN), events; KV `trends:latest` / `trends:prev`; `GET /trends`, `POST /trends/run`; new `runTick` slots; forward `lang` in `/search`; unit tests; README; `YOUTUBE_API_KEY` in `worker.yml` | L | `YOUTUBE_API_KEY` secret; yes/no on kworb and trends24 |
| B3 ✅ | Dashboard: `lib/trendsClient.ts`, `useTrends` hook, Trend Radar card replacing the placeholder, moments rail, manual-links tile, Studio inbox row, `messages/trends.{ar,en}.json`, `e2e/trends.spec.ts` | L | keyword list (defaults proposed) |
| B4 | Threads `keyword_search` groundwork: scope added, route + 6 h cache, "pending Meta review" banner | M | one Threads reconnect; App Review after the CR |
| B5 | Training bridge: a coach reason on Today when a fresh trend matches a skill's program | S | no |

## Agent roster and file ownership (no two agents on one file)

| Agent | Owns | Files | Depends on |
| --- | --- | --- | --- |
| **M0 Mastermind** (this session) | Plan, contracts, integration, the five gates on the merged branch, handovers, planning docs | `planning/**` | — |
| **T1 Store + domain** | B1, plus `AutoPostSchema.jobId` for A7 | `lib/domain.ts`, `store/index.ts`, `store/index.test.ts`, `data/events.ts`, `planning/data/saudi-events.json` | — (publishes the `TrendItem` type first) |
| **T2 Worker trends** | B2 | `workers/scout/src/trends/**`, `workers/scout/src/social/cron.ts`, `workers/scout/src/scout.ts` (route registration for everyone), `workers/scout/src/scout.test.ts`, `workers/scout/src/trends/kv.ts` (KV keys; `social/store.ts` untouched), `workers/scout/README.md`, `.github/workflows/worker.yml`, `workers/scout/wrangler.jsonc` | T1's type (hand-copied into `trends/types.ts`) |
| **T3 Trend Radar UI** | B3, B5 | `lib/trendsClient.ts` (+ test), `components/social/trends/**`, `components/social/ideas/TrendsCard.tsx`, `components/social/IdeasScreen.tsx`, `components/social/studio/InboxCard.tsx`, `components/today/coachReasons.ts`, `messages/trends.{ar,en}.json`, `lib/i18n.ts`, `e2e/trends.spec.ts`, `e2e/helpers.ts` | T1 actions; the `GET /trends` JSON shape agreed in `08-trends.md` |
| **P1 Composer** | A2, A6 | `components/social/calendar/PostForm.tsx`, `AutoPostTab.tsx`, `OverviewTab.tsx`, `components/social/usePublish.ts`, `components/social/AutoPostScreen.tsx`, `components/settings/ConnectedAccountsCard.tsx`, `lib/publish.ts` (+ test), `messages/publish.{ar,en}.json`, `messages/calendar.{ar,en}.json`, `e2e/autopost.spec.ts` | — |
| **P2 Worker media + publishers** | A3, A4, A5, B4 | `workers/scout/src/upload.ts` (new), `workers/scout/src/social/publishers.ts`, `publish.ts` (+ test), `threads.ts`, `social.test.ts`, `lib/media.ts` (new), `lib/socialSync.ts`, `planning/tools/07-auto-posting.md` | Owner decisions (B2 / R2, Buffer). Sends T2 a one-line route to register and P1 a patch for `CAPTION_MAX` / `ACCEPTS` / `mediaKind` rather than editing their files |
| **P3 Live pilot** | A1 (with the owner present), A8 pages | `app/privacy/`, `app/terms/` (new), the log in `07-auto-posting.md` | the owner's MP4 link |

Contracts agreed before T2 and T3 start: the `TrendItem` shape and the `GET /trends` response (`08-trends.md`). Cross-package constants
(`CAPTION_MAX`, `ACCEPTS`, error codes, job shape) stay hand-copied between `lib/` and `workers/scout` as today; whoever changes one
updates both sides in the same PR.

## Sequence

- **Wave 1 (can start now, no owner input)**: T1 → T2 + T3 in parallel (T3 builds against the stubbed `GET /trends` until T2 lands), P1 in
  parallel. Trend sources that wait for an answer (kworb, trends24, YouTube key) ship behind flags and show "not configured".
- **Wave 2 (after the owner's answers)**: P2 (B2 or R2, Buffer), P3 live pilot as soon as the MP4 link arrives (this one can run first
  if the link comes first).
- **Wave 3**: audits (A8), Threads App Review after the CR, v2 sources from `08-trends.md`.
- Every wave ends with M0 running `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm e2e` on the merged branch, a handover in
  `planning/handovers/`, and a PR only when the owner asks.

## Wave 1 status (Sep 28, 2026, evening)

Built in this worktree by four parallel agents (T1 → T2 + T3, P1 alongside) with single-owner files; integrated and gated by M0.
Nothing committed yet (owner's laptop rule). Details of what landed: `tools/08-trends.md` → "Built (Wave 1)" and
`tools/07-auto-posting.md` → "Round 30 (composer)".

**Review round.** Three independent reviewers (correctness, i18n/phone UX, Worker budgets and safety) raised 23 findings; one skeptic
per finding tried to refute each: 20 confirmed (19 distinct), 3 refuted. All 19 were fixed in three single-owner lanes and a final
reader confirmed every one resolved. The ones that mattered most:

- **Blocker**: the trend cron slots sat at :07 / :17 while the only trigger fires every 5 minutes, so the radar would never have refreshed
  by itself. Now 00:05 / 06:05 / 12:05 / 18:05 (fast), 21:05 (daily), Saturday 21:15 (weekly), with a test that pins every slot to the
  `*/5` grid.
- The 🔄 button ran the weekly Tavily scan on every press (8 credits each). It now runs the fast sources only, and the weekly scan is
  capped at once per ISO week by a KV stamp.
- Calendar moments showed twice (list + rail) and could be dismissed; every outbound Worker fetch now has a 12 s timeout; the YouTube
  search cap is reserved before spending; a KV failure no longer escapes as a CORS-less error page; source badges are in Arabic.
- Composer: a refused "Post now" no longer dates the post; captions never end in half an emoji; the "trimmed" badge no longer shows for
  trailing whitespace; token warnings read "بكرة" / "يومين" correctly.

**Gates on the final tree**: `pnpm lint` ✓ · `pnpm typecheck` (app + Worker) ✓ · `pnpm test` 870/870 ✓ · `pnpm build` ✓ · `pnpm e2e`
166 passed, 2 skipped, twice in a row. The flaky skill-sheet specs (planner, scout) came from the stepped `steps(4)` pop-in fooling
Playwright's stability check; `main` fixed that in PR #16 with `reducedMotion: "reduce"`, and this branch carries the identical
`playwright.config.ts` so the merge is clean.

**Branch state**: `main` is at `6d97379` (PR #15 handover, PR #16 e2e reduced motion + DaVinci quest wording); this branch is on
`8e4d629` and touches none of those files, so a sync with `main` should merge without conflicts.

**Wrap-up (Sep 29, early morning)**: A6 (Studio inbox row for a due X / Snapchat step) and A7 (the hub follows Worker jobs that no
local post knows about, with cancel) were built, reviewed by two lenses with one skeptic per finding (8 confirmed, 2 refuted), and
fixed; details in `tools/07-auto-posting.md` → "Round 30 (composer)" items 8-9. Left uncommitted for the owner's OK.

**Search page (Sep 29, owner: "it doesn't show TikTok and Instagram, only YouTube"; "test the search page")**: three testers
(code review, an exploratory run on phone and desktop against a fake Worker, real Instagram/TikTok result shapes) and one skeptic
per finding: 25 confirmed (15 distinct), 5 refuted, all fixed and checked. The cause of "only YouTube": the All tab was its own
single Tavily search capped at 10-15 results, which Tavily fills mostly from youtube.com, and the unopened tabs borrowed their count
from it (so TikTok / Instagram could read 0). **Decision:** All is now the union of the per-platform searches (same cache keys as the
tabs), so a new topic costs 2 credits with a YouTube key (3 without) instead of 1, and switching tabs costs nothing. Also fixed:
Instagram cards now carry the caption and @creator parsed from the page text (were "Instagram" / "instagram.com"), TikTok titles
lose " | TikTok" and use the oEmbed caption when generic, one post in several URL forms is one card (Worker and app share the same
canonical rule), Instagram audio pages no longer count as videos, empty answers are cached 10 minutes (was 24 h) and the cache is
versioned by Worker URL, "Arabic first" reads captions, Search again after an error retries, the ↗ menu closes, a broken YouTube key
falls back to the Worker, dead TikTok thumbnails refresh, and the usage line says it counts this device. The Instagram / TikTok
title fixes live in the Worker, so they show after the merge redeploys it.

Still open from Wave 1: the first deploy of the Worker (confirms the bundled events JSON and Google / kworb behaviour from Cloudflare
egress IPs), and opening the PR (the in-app browser is not signed in to GitHub and `gh` is not installed on this laptop).
`format:check` fails on this Windows checkout for untouched files because `core.autocrlf` gives them CRLF; it is not one of the five
gates and CI on Linux is unaffected.

## Round 31 · Discover by edit genre (Sep 29, 2026)

PR #18 merged (bf3e1e7); CI, Pages and the Worker deploy green; `YOUTUBE_API_KEY` added by the owner and the Worker redeployed
(run #19). The first cron refresh of the radar ran at 06:05 UTC; the radar showed Google rows with a "partial" badge, the failing
source still to be named (suspect: the key's application restrictions, which must be "None").

The owner then asked for a genre search and said yes to the proposal. Built on branch `claude/discover-genres` (from main) by four
lanes with single-owner files, then reviewed (six lenses, one skeptic per finding):

| Lane | Built | Owns |
| --- | --- | --- |
| L1 Data + store + Settings | `planning/data/genres.json`, `GenreSchema` / `CustomGenreSchema` / `TrendItem.genre`, `lib/genres.ts`, persisted `customGenres`, `messages/genres.*`, Settings "🎬 Edit genres" | `lib/domain.ts`, `store/`, `lib/genres.ts`, `data/genres.ts`, `lib/i18n.ts`, `components/settings/`, `e2e/settings.spec.ts` |
| L2 Discover / Research UI | genre row, topic + genre queries, Sort chips, numbers on cards, `videos.list` statistics, cache v3 | `components/research/`, `lib/research.ts`, `lib/scoutClient.ts`, `messages/{ar,en}.json` (research keys), `e2e/scout.spec.ts`, `e2e/research.spec.ts` |
| L3 Worker | `parseEngagement`, `enrichYoutubeStats`, genre keywords + daily rotation (cap 18), kept rows, shared statistics ids | `workers/scout/**` |
| L4 Radar UI | genre select, `TrendFilter.genre` | `components/social/trends/`, `lib/trends.ts`, `messages/trends.*`, `e2e/trends.spec.ts` |

Decisions taken while building (all recorded in `tools/11-discover-genres.md`): the rotation moves by 18 keywords a day (one a
day would need 36 days); a custom genre may not reuse a built-in genre's name; a chip tap commits the typed text in the skill
sheet too; the genre row wraps on wide screens and scrolls sideways on phones.

Review: 9 raw findings, 6 distinct, 4 confirmed and fixed (feed cap 200 → 400 with per-language ranking, the niche ⭐ on genre
rows, the Settings copy about custom genres, the cached failed statistics call), 2 refuted; each fix re-read by a skeptic.

Still open: how often TikTok / Instagram descriptions carry their counts (not measured live); custom genres in the radar's
scan (needs the list sent to the Worker); the six owner questions below.

## Questions for the owner (only the ones that change the build)

1. **Media upload**: create a free Backblaze B2 account (no card) so videos are picked straight from the phone? Or is adding a card
   later acceptable (then Cloudflare R2, same Worker, simpler)?
2. **X**: connect X as one of Buffer's three free channels (you create the Buffer account) so X posts go out by themselves, or keep X manual?
3. **Trend aggregators**: OK to read kworb.net (TikTok sounds, SA and US) and trends24.in (X trends Saudi) with a visible source label?
   trends24 has no terms page we could find; getdaytrends forbids it and stays a manual link.
4. **Niche keywords** for the radar (defaults proposed in `08-trends.md`, section "Owner's part"): confirm or edit.
5. **AI layer**: do you have an Anthropic API key with credits (needs a card)? Without it the radar explains trends from news snippets only.
6. **First live video post**: send a public MP4 link (< 64 MB, Dropbox "anyone with the link") whenever you are ready, and we run
   Instagram + YouTube + TikTok from one post together.

Owner actions that are not questions: merge PR #15 (a doc only); create the `YOUTUBE_API_KEY` secret (steps in `08-trends.md`); file the
YouTube and TikTok audits when public results matter; optionally add branch protection on `main` and delete the six merged branches.

## Rules every agent follows

- `CLAUDE.md` + `AGENTS.md`: search before building and record it in `planning/`; Hijazi Arabic first with `messages/*.ar.json` /
  `*.en.json` key parity (`messages/messages.test.ts`); Next.js 16 has breaking changes, read `node_modules/next/dist/docs/` first;
  the five gates before any push.
- Every new persisted field gets a Zod default and a backwards-compat test (the persist merge silently falls back to defaults).
- Every Worker job takes its own cron slot and stays under 50 subrequests; never run inside a publish tick.
- Label sources honestly in the UI (chart ≠ trending ≠ indexed this week).
- No scraping that needs browser-minted headers or cookies (TikTok Creative Center, Instagram); manual deep links instead.
- Secrets only in GitHub / Cloudflare secrets; the repo is public.

## Prompt for the next session

> Continue 3z Prod in `3zmd95-glitch/hello-github`. Read `planning/handovers/mastermind-2026-09-28.md` first, then
> `planning/tools/08-trends.md` and `planning/handovers/auto-posting-live-2026-09-28.md`. Act as the mastermind: run Wave 1 with parallel
> agents (T1 → T2 + T3, and P1) using the file ownership table, keep the contracts, run the five gates on the merged branch, and ask me only
> the six questions listed if I have not answered them yet. Keep to `CLAUDE.md` (search before building, Hijazi-first copy with ar/en
> key parity, all five quality gates before any push; do not commit or push on my laptop unless I ask).
