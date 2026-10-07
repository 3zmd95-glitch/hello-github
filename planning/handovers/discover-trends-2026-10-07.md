# Discover trends and category pages handover — 7 October 2026

Written by Claude at the owner's request ("give a hand over to chatgpt codex to continue this work") after he said
**stop**. Nothing is running. Continue from "Resume here".

## Resume here

1. **PR #69, merged on Oct 7 19:30 AST (squash), Worker deploying:** https://github.com/3zmd95-glitch/hello-github/pull/69 — "Category TikTok tab:
   trending edit hashtags first" (branch `claude/tiktok-edit-hashtags`, commits `d5088ac`, `3c6ea86`). The owner
   looked at the Food page's TikTok tab live and said: **"its not cool edits trending videos"**. The tab showed general
   food videos (Trunk or Treat, Aldi prices) because `workers/scout/src/categories/tiktok.ts` took TikTok Discovery's
   top hashtags of the FOOD industry in rank order. The PR picks hashtags in tiers: 1) names with an edit cue and a
   subject word (#foodedit, #streetfoodbroll), 2) edit-cue names from the SPECIAL_EFFECTS and PHOTOGRAPHY lists,
   3) subject-word names, 4) the industry list by rank to fill 10. Worker-only; `pnpm test` 2,403 pass; CI green; merged at the owner's word ("and merge of course"). **Next:** confirm
   the Worker deploy (`worker.yml`) finished, press **Scan again** on Food (it has 1 of its 3 daily scans left; the day resets 00:00 UTC),
   then judge the TikTok tab in the owner's Chrome and read `diagnostics.tiktok.hashtags` (name + tier) in KV
   `category:food`. If most hashtags are tier 4, the Discovery API cannot give "cool edits" for that category; say so
   plainly and propose the next step (see "Open questions").
2. Then run the live check for the other categories as their scans come in (cron 05:40–05:55 UTC, 4 a day).

## The owner's standing requirements (verbatim where it matters)

- "English First" / "I want everything to be english first": trend and lesson content English first; Arabic only when
  the typed text is Arabic or "Arabic first" is on. UI copy stays bilingual (`messages/*.json`, key parity).
- "Instagram and tiktok first": tab order and result order (done in Discover and the category 🏆 tabs).
- "Every category should show at least 50 results in every platform with top tier results."
- "it doesn't have to be tutorial": lesson videos are the best examples; a tutorial is optional.
- "making a mediocre job without testing and verifying the result is not acceptable. rework if needed." → **Every
  claim must be verified live with evidence** (decoded post dates, screenshots, diagnostics), then shown to him. He
  checks himself.
- Trend search must work; credits are secondary (Tavily 1,000/month free; he hasn't enabled pay-as-you-go yet; usage
  was 828/1000 at 19:00 AST on Oct 7).
- Official APIs only, no scraping, no ban risk. Brave was tried for TikTok and rejected ("brave is not the answer");
  it is off (`BRAVE_DAILY` "0"); its code remains.
- Never port 3000 for tests (his app). E2E uses `E2E_PORT=3100` (or 3101 in a second worktree). Work in your own
  worktree, never the primary checkout.
- Never print or commit secrets; he adds secrets in Cloudflare himself (he has: `TAVILY_API_KEY`, `YOUTUBE_API_KEY`,
  `SCOUT_TOKEN`, `BRAVE_API_KEY`, `TIKTOK_ADS_SECRET`).

## What is live on main (6ef3602) and deployed

- **Category pages** (`planning/tools/19-category-trends.md`, `workers/scout/src/categories/`,
  `components/research/CategoryPage.tsx`, `lib/categories.ts`): per-category trend scans (6 Instagram-month Tavily
  queries, 6 credits), lessons every 6 days (gpt-oss-120b with llama fallback; Shoot / Settings / Edit how-tos; copied
  or generic lines rejected), 🏆 Top tabs Instagram · TikTok · YouTube (YouTube top 50 by views via the Data API on
  cron and first scans only; Instagram from the scan; TikTok from TikTok's Discovery API). PRs #54, #56–#59, #62, #66,
  #67.
- **TikTok Discovery API** (`workers/scout/src/tiktokads.ts`, `categories/tiktok.ts`): the owner's approved TikTok for
  Business app "ONUS Content Planner" (App ID `7693488727766597653`, scope Discovery). He authorized it on Oct 7
  (`/tiktokads/status` → connected, 2 advertisers). Token sealed in KV `tiktokads:token`; never expires. The first
  authorization attempt failed with TikTok's own error `code 40000 "Error 5: Out of memory"`; the retry worked.
- **Real post dates** (`workers/scout/src/postDate.ts`, PR #66): Instagram shortcode → media id → timestamp
  (`(id >> 23) + 1314220021721` ms), TikTok video id → Unix seconds (`id >> 32`). Verified against the owner's own
  reels to within ~90 s. Tavily sends no dates for Instagram/TikTok and its `time_range` is unreliable (a "week"
  search returned posts from 2023 and 2024), so: Discover's Posted filter asks Tavily for a month and drops cards by
  real date; Trending effects and category scans file each creator under the day they posted (`effects/extract.ts`,
  `effects/score.ts`); posts older than 14 days or undated are skipped and counted (`diagnostics.posts`).
- **English-first queries** (`discover/plan.ts`): the Arabic tutorials query only when `lang === "ar"`. Trend-chip taps
  send `editing: true` (cards without an editing cue are off-topic) and select Week.
- **Trending effects** (`planning/tools/18-trending-effects.md`): the one-time history reset on Oct 7 kept names and
  dropped scan-day creators; after 5 forced runs the row was clone effect 6, speed ramp 19, split screen 13, glitch 7,
  text animation 6, smooth slow motion 6, zoom transition 3, GIF stickers 4, velocity 4, freeze frame 4, all samples
  1–7 days old.

## How to verify things (the evidence tools)

- **Decode a post date:** the functions in `workers/scout/src/postDate.ts` (BigInt; run with `tsx` or copy into the
  browser console).
- **Raw Worker answers:** in the Discover tab of the owner's app, the Worker URL and token sit in the Zustand store in
  localStorage (`settings.apiKeys.scoutUrl/scoutToken`); `fetch(url + '/effects/trending', { headers: { Authorization:
  'Bearer ' + token } })`. Never print the token.
- **KV documents:** Cloudflare dashboard → Workers KV → SOCIAL_KV → KV Pairs, prefix `category:<id>` or
  `effects:trending`; `diagnostics` is near the end of each document (the UI truncates very long values).
- **Worker logs:** Cloudflare → Workers & Pages → 3z-scout → Observability → Events; `console.log` JSON lines are the
  rows without a message (click to expand).
- **Local app:** `pnpm local:serve` in the primary checkout serves `out/` on :3000 (rebuild with `pnpm build` after a
  merge; `pnpm install --frozen-lockfile` if `pnpm-lock.yaml` changed). The app's offline service worker caches the old
  build: after a rebuild, unregister it (DevTools → Application → Service workers) or the owner keeps seeing the old
  version. On Oct 7 the :3000 server had died; it was restarted and is running now.
- Wrangler is not logged in on this machine; the local `.dev.vars` SCOUT_TOKEN gets 401 against production.

## Open questions and known limits

- **TikTok "cool edits":** the Discovery API has no keyword search; only trending hashtags per industry (+ top 20
  videos each). If PR #69's tiers still give mostly general videos, the honest options are: (a) a Tavily TikTok search
  per category ("<category> edit tiktok") to add captioned edit videos (few results, ~1 per call), (b) hashtag names
  from the trend scan's own extraction (e.g. #foodtransition) looked up in the trending lists, (c) accept TikTok's
  ranking and label the tab "Trending on TikTok (food)". Ask the owner once, with a screenshot of what each gives.
- **Instagram "50 top tier":** the Instagram tab is the scan's Tavily posts (≤ 50, relevance order); Instagram's
  official hashtag search needs a Facebook-Login Business app (not available). No better official source today.
- **Tavily credits:** 828/1000 on Oct 7 evening; the category cron (24/day) + effects (18/day) will hit 90 % (pause)
  within days unless the owner enables pay-as-you-go (he does it himself; never handle payments).
- **Brave** code (`categories/top.ts` braveTop, `BRAVE_*` vars) is dead while `BRAVE_DAILY` is "0"; remove later if
  the owner agrees. The Popular-now strip ranks purely by numbers (fine).
- Day-level accuracy of the Instagram epoch constant is ±2 minutes; good enough for day windows.

## Workspace notes

- Primary checkout `C:\Users\AORUS\Documents\hello-github` on main `6ef3602`, clean apart from untracked
  `.claude/`, `.superpowers/`, `.impeccable/` and this file.
- Claude worktrees (leave or delete): `C:\Users\AORUS\Documents\hello-github-trending` (branch
  `claude/tiktok-edit-hashtags` = PR #69) and `C:\Users\AORUS\Documents\hello-github-top`. Their git-ignored
  `.superpowers/sdd/2026-10-06-category-trends/progress.md` is the full ledger of decisions and live checks.
- Quality gates before any push: `pnpm lint && pnpm typecheck && pnpm test && pnpm build && E2E_PORT=3100 pnpm e2e`.
  Known flakes: `scripts/local-ai/server.test.ts` ("bad port", rerun), `npx serve` "too many open files" late in e2e
  (rerun the failed files).
- Specs to keep in step: `planning/tools/19-category-trends.md`, `planning/tools/18-trending-effects.md`,
  `planning/tools/13-discover-search-v2.md`, `workers/scout/README.md`, `planning/master-plan.md` (Round 37).
