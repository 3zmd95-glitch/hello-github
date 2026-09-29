# 08 · Trend Radar: what is trending now (Arabic and English)

Owner, round 30 (Sep 28, 2026): "I want to know what's trendy now in social media, either Arabic or English content, on TikTok,
Instagram and YouTube, so I can know what's trending now and post something like it." This file is the search-before-building
record and the design for the **📈 Trend Radar** card in the 📱 Social world.

## What exists today (verified in code, Sep 28, 2026)

- `components/social/ideas/TrendsCard.tsx` is a 17-line placeholder ("soon" chip, `ideas.trendsSoon`), mounted in the Ideas bank.
- No store field, action, hook, Worker route or cron slot for trends. Nothing calls `videos.list chart=mostPopular` or
  `trends.google.com` (grep over `lib/`, `components/`, `store/`, `workers/`).
- Reusable pieces: `IDEA_SOURCES` includes `trend` and `addIdea({ text, source: "trend", platform })` → `useIdea` → a calendar post
  (`store/index.ts`); the Worker's `POST /search` sends `include_domains` + `time_range` to Tavily (`workers/scout/src/scout.ts:148-205`)
  but **drops `lang`** (validated, never forwarded); `lib/research.ts` has `hasArabic` / `arabicFirst` and a YouTube `search.list`
  wrapper with `regionCode=SA`; the Worker cron already multiplexes jobs through `SYNC_SLOTS` (`workers/scout/src/social/cron.ts`).
- Planning notes that are now wrong: `03-social-media.md` calls `videos.list chart=mostPopular regionCode=SA` "a trend feed". Since
  **2025-07-10** that chart only carries the Music, Movies and Gaming charts (YouTube removed its Trending page on 2025-07-21), and since
  **2026-06-01** `search.list` has its own bucket of **100 calls per day** per Google Cloud project (shared with the Discover research
  screen that already uses it).

## Search before building (2026-09-28, seven research sweeps, sources read the same day)

Rules applied: free tier first, no card, runs from the static app + the free Cloudflare Worker (50 subrequests per invocation,
1,000 KV writes a day) or an owner-run GitHub Action, no browser, no platform-terms breach, Arabic / Saudi support.

### Google (the cross-platform signal)

| Find | What it gives | Decision |
| --- | --- | --- |
| [Google Trends "Trending now" RSS](https://trends.google.com/trending/rss?geo=SA) (`geo=SA`, `geo=US`) | RSS 2.0, exactly 10 items: title (Arabic for SA), `ht:approx_traffic` (500+, 200+…), 1-3 `ht:news_item` (title, url, source: Okaz, Arab News…), picture. No key, no cookie; `hl`/`hours` are ignored. Verified live from a Windows machine with a plain User-Agent | **Adopt** as the stable source and the fallback |
| Google Trends `batchexecute` RPC (`rpcid i0OFE`, the JSON the trending page itself loads) | 13 items (4 h) / 62 (24 h) / 424 (168 h) for `geo=SA` with approx volume, growth %, related queries, news ids. Unofficial; response starts with `)]}'`. Payload shape documented in [dariomory/trendflow-js](https://github.com/dariomory/trendflow-js) (MIT, fetch-based, young) | **Adopt** as the primary enrichment behind the RSS: hand-write the ~60-line client (copy trendflow's payload shape), schema-check the answer, fall back to the RSS and set `degraded` on failure |
| [Google Trends API (official alpha)](https://developers.google.com/search/apis/trends) | Interest over time only, no "trending now", application-gated, ~48 h lag | Reject for this feature; the owner may still apply (free form) for later keyword checks |
| [pytrends](https://github.com/GeneralMills/pytrends) · [google-trends-api (npm)](https://github.com/pat310/google-trends-api) | Archived 2025-04 / last publish 2022; both broken (429) | Rejected |
| [trendspyg](https://github.com/flack0x/trendspyg) (Python, MIT, pushed 2026-09) · [trendspy](https://pypi.org/project/trendspy/) | Maintained pytrends successors; RSS mode is the same URL we fetch directly | Reference (RSS parsing); a Claude skill `trendspyg` exists for personal research sessions |
| SerpApi (250 free searches/month) · SearchApi · Glimpse · Apify Google Trends actors | Hosted wrappers of the same data | Rejected (extra account/cap); SerpApi noted as the emergency fallback if Google blocks Cloudflare egress IPs |
| Wikimedia REST `pageviews/top/ar.wikipedia` | Daily top-1000 Arabic articles with views, keyless | Candidate (pan-Arab "what Arabs read today"), second tier |

### YouTube

| Find | What it gives | Decision |
| --- | --- | --- |
| `videos.list chart=mostPopular regionCode=SA|US` (+ `videoCategoryId`) | Up to 50 videos per call with statistics, 1 quota unit, API key only (no OAuth). **Since July 2025 it is the Music / Movies / Gaming chart, not general trending.** Shorts have no flag: filter `contentDetails.duration ≤ 180 s` | **Adopt**, labelled "YouTube charts (SA / US)" in the UI, never "trending" |
| `search.list order=viewCount publishedAfter=7d regionCode=SA relevanceLanguage=ar|en videoDuration=short` + one `videos.list` for statistics | Keyword-driven "most viewed this week" per niche; Arabic `q` works. **100 calls per day per project** (shared with Discover) | Candidate: at most **12 calls a day** from the owner's keyword list, hard-capped in code |
| YouTube Charts (charts.youtube.com/sa) · kworb.net YouTube SA mirror | Web only / third-party mirror of the API | Reference |

### TikTok

| Find | What it gives | Decision |
| --- | --- | --- |
| [TikTok Creative Center → Trends → Hashtags, region Saudi Arabia](https://ads.tiktok.com/business/creativecenter/inspiration/popular/hashtag/pc/en) (7 / 30 / 120 days; also US, GB) | The only official trend list with an SA filter. Logged out it shows a 3-item sample; a free TikTok for Business login shows the full list. Sounds / creators tabs are degraded since Aug 2026 ("undergoing changes") | **Adopt as a manual deep link** in the radar ("افتح ترندات تيك توك السعودية") |
| Creative Center JSON (`creative_radar_api/v1/popular_trend/hashtag/list?country_code=SA`) and the page's data loader | Answers `{"code":40101,"msg":"no permission"}` without browser-minted signed headers; TikTok's terms (row, §5) forbid automated collection | **Rejected** (also rejected: Cloudflare Browser Rendering, cookie scrapers such as lofe-w, stia-mora, shannawuu/trendscraper, davidteather/TikTok-Api) |
| TikTok Marketing API `GET /discovery/trending_list/?country_code=SA` | The one official, automatable hashtag feed. Registration appears to need a **company-domain e-mail** and an Ads Manager account; SA support of `country_code` not verified | **Candidate v2** if the owner gets a `@3zprod.com`-style mailbox |
| [kworb.net TikTok trending songs, Saudi Arabia](https://kworb.net/charts/tiktok/sa.html) (and `us.html`) | Plain-HTML top-100 sounds with position deltas, Arabic tracks on top; `robots.txt` allows all; 1 subrequest | **Adopt with attribution**, pending the owner's OK (third-party aggregator; not tested from a Cloudflare IP) |
| TikTok Research API · Commercial Content API | Academic / EU-ads only; Saudi not eligible | Rejected |
| RapidAPI wrappers, TikHub, Lamatok, EnsembleData, tokchart, hosted proxies | Card, tiny free tiers, unofficial scraping, login walls | Rejected (EnsembleData kept as a reference for a later "validate this hashtag" step) |
| Apify Creative Center actors ($5 free credit/month, no card; ~$3/month for SA+US, 3 hashtags per window) | REST from the Worker, but third-party scraping capped at 3 rows | Candidate v2 behind a flag, only if the owner accepts it |

### Instagram and Threads

| Find | What it gives | Decision |
| --- | --- | --- |
| Instagram in-app **Trending audio** (Reels audio picker ↑ tab; Professional dashboard → Trending audio) and the @creators account | Instagram's real trend signal, in-app only, no API; the dashboard list may be US-only (unverified for KSA) | **Adopt as a weekly manual ritual card**: "open Instagram → trending audio → paste 3 sounds + 1 format" → ideas with source `trend` |
| Weekly editorial trend pages (Buffer, HeyOrca, Later, SocialPilot, Lightreel) | English / global Reels + TikTok sounds and formats, weekly; fetchable through Tavily `include_domains` | **Adopt** as the interim automated Instagram signal, labelled "global / English" |
| Threads API `GET /keyword_search` (`search_mode KEYWORD|TAG`, `search_type TOP`, 2,200 queries/day) | Official, Worker-friendly, Arabic keywords fine. **Under Standard Access it returns only the owner's own posts**; public results need App Review (Advanced Access ⇒ business verification ⇒ the CR) | **Candidate**: add `threads_keyword_search` to the Threads scope now (one reconnect), build the route + 6 h cache, show "pending Meta review" until the CR exists |
| Threads in-app "Trending now" | US, Japan, Vietnam, Taiwan, Brazil only (May 2026); no API | Rejected (owner to confirm it does not show in KSA) |
| Instagram Graph hashtag search (`ig_hashtag_search`, 30 hashtags / 7 days) | Not available on the "Instagram API with Instagram Login" the Worker uses; needs Facebook Login for Business + Public Content Access review + business verification | Revisit after the CR |
| Instagram oEmbed · Meta Content Library · official Instagram trend reports | Embeds only (business verification) · researchers only · stale (2022-2024) | Rejected |

### X and Snapchat

| Find | What it gives | Decision |
| --- | --- | --- |
| [trends24.in/saudi-arabia](https://trends24.in/saudi-arabia/) (+ Riyadh, Jeddah) | Static HTML, top-50 X trends per hour, Arabic; no terms page found (404) | Candidate, hourly with cache and a visible "source: trends24.in" label, **only if the owner agrees** |
| getdaytrends.com/saudi-arabia | Same data; terms explicitly forbid automated extraction | Manual link only |
| xtrends.iamrohit.in/saudi-arabia | Hobby site, 30-minute refresh | Second-choice candidate behind trends24 |
| X API | Pay-per-use only since Feb 2026 (card) | Rejected |
| Snapchat Trends / Spotlight | `trends.snap.com` no longer resolves; Spotlight pages are JS galleries; no API | Rejected; Snapchat trends are inferred from Google SA + X SA + TikTok SA, plus the in-app Spotlight "Trending" tab as a manual link |

### Open source, MCP and skills

| Find | Decision |
| --- | --- |
| [sansan0/TrendRadar](https://github.com/sansan0/TrendRadar) (GPL-3, Chinese platforms) · [newsnext/newsnow](https://github.com/ourongxing/newsnow) (MIT, Chinese sources, Nitro/Vue) | Rejected as code (wrong sources, wrong stack, GPL); their "one module per source → normalized list → cache per source" shape is what `workers/scout/src/trends/` follows |
| [suvrockzzzz/trending-search-google](https://github.com/suvrockzzzz/trending-search-google) · tareqhassan/newsdesk-trends · redsoukas/trends-agent | Reference: the "GitHub Action commits JSON, static site reads it" pattern. Kept as the fallback runner if Google ever blocks Cloudflare egress IPs |
| [Trends MCP](https://github.com/trendsmcp-ai/Trends-MCP) (100 REST requests/month free, no card) · vidIQ MCP/plugin (`vidiq-trend-radar`) · UnifAPI · n8n templates · rugvedp/Trends-MCP · ListeningKit | Candidate (Trends MCP, if SA/Arabic results prove useful) · reference for personal research sessions (vidIQ) · rejected (paid, Python, servers) |
| Anthropic `web_search` server tool ($10 per 1,000 searches) + Claude Haiku summary | Candidate for the "ليش ترند؟ + 3 أفكار" layer; needs an Anthropic key with credits (card). v1 ships without it and uses Tavily news snippets |
| Saudi moments calendar (Founding Day 22 Feb · Flag Day 11 Mar · National Day 23 Sep · Riyadh Season from 21 Oct 2026 · Soundstorm Dec · AFC Asian Cup 7 Jan–5 Feb 2027 · Ramadan ≈ 8 Feb 2027 · Eid al-Fitr ≈ 9 Mar 2027 · F1 Jeddah 19–21 Mar 2027 · Hajj / Eid al-Adha ≈ 14–16 May 2027 · Esports World Cup 16 Jul–1 Aug 2027) | **Adopt** as a static `planning/data/saudi-events.json` (no free machine-readable Saudi social calendar exists); Hijri dates re-checked yearly |

## Decision: Trend Radar v1 ($0/month, no new accounts except a YouTube API key)

**Honesty rule.** Only Google Trends and the YouTube charts are true popularity rankings. Tavily results are "indexed this week",
ranked by how often a hashtag or sound recurs; kworb and trends24 are third-party aggregators. Every row carries its source and the UI
never calls something "trending" that is a chart or a scan.

### Data (dashboard, `lib/domain.ts`, additive so no `STORE_VERSION` bump)

`TrendItemSchema { id, platform: google|youtube|tiktok|instagram|threads|x|event, region: SA|US|global, lang: ar|en|mixed, title,
url?, thumb?, score?, growthPct?, volume?, source, seenAt, expiresAt, tags?: string[], skillHint? }` and a persisted
`trends: { items: TrendItem[], fetchedAt: string | null, degraded: boolean, dismissed: string[] }` with Zod defaults (backwards-compat test
in `store/index.test.ts`). A trend becomes an idea through the existing `addIdea({ text, source: "trend", platform })` and a post through
`useIdea`, so the calendar and auto-posting paths are untouched. The Worker copies the type into `workers/scout/src/trends/types.ts`
(the same hand-copy convention as `social/types.ts`).

### Worker job (`workers/scout/src/trends/`)

| Module | Source | Cadence | Cost per run |
| --- | --- | --- | --- |
| `google.ts` | RPC `i0OFE` for SA (ar) and US (en), 24 h window; RSS fallback | every 6 h | 2-4 subrequests |
| `youtube.ts` | `videos.list chart=mostPopular` SA + US, categories 0 (all) and 26 (how-to), `maxResults 25`, `isShort` by duration (tag `short`); needs the `YOUTUBE_API_KEY` Worker secret | every 6 h | 4 units, 4 subrequests |
| `youtubeSearch.ts` | `search.list` for the owner's keyword list (≤ 12 calls) + one `videos.list` | once a day | ≤ 13 of the 100 daily search calls |
| `kworb.ts` | TikTok sounds SA + US HTML | every 6 h | 2 subrequests (pending owner OK) |
| `tavily.ts` | 6-8 queries: Arabic with `country: "saudi arabia"`, `language: "ar"`; English with `country: "united states"`; `include_domains` tiktok.com / instagram.com / youtube.com / threads.net plus the trend blogs; `time_range: "week"`; extracts `#hashtags` and sound names, ranks by frequency, keeps source links | weekly, Saturday 21:15 UTC (00:15 Riyadh, Sunday), at most once per ISO week (KV stamp `trends:tavily:<week>`) | 8 of the 1,000 monthly credits |
| `events.ts` | `planning/data/saudi-events.json` bundled at build | on request | 0 |
| `x.ts` | trends24.in SA HTML (only if the owner agrees) | every 6 h (with the fast sources) | 1 subrequest |

`runTrends(env, { kinds })` is gated inside the existing `runTick` as new UTC slots (`TREND_SLOTS`: 00:05 / 06:05 / 12:05 / 18:05 fast, 21:05 daily, Saturday 21:15 weekly; every slot sits on the `*/5` grid of the one cron trigger and a test guards it; the dashboard 🔄 button runs the fast sources only) (never inside a publish tick, so the 34-call publish budget is
untouched); results are normalized into one KV document `trends:latest` with the previous good copy in `trends:prev` (the one-document
pattern of `publish:jobs`). Routes: `GET /trends` (bearer) → `{ items, fetchedAt, degraded, sources: [{ name, ok, at }] }` and
`POST /trends/run` (manual refresh). `POST /search` also starts forwarding `lang` to Tavily as `language`.

### UI (📱 Ideas bank, replacing the placeholder; `data-testid="ideas-trends"` kept)

"📈 رادار الترند / Trend Radar": tabs **عربي (السعودية)** / **English**, platform chips (Google · YouTube · TikTok · Instagram · Threads · X),
the owner's niche keywords highlighted, per row **💡 احفظ كفكرة** (`addIdea`, source `trend`) and **📱 خطّط بوست** (platform picker → `useIdea`),
a "ليش ترند؟" line from the news snippets, an **upcoming moments** rail from the events file (with lead-time days), and a manual tile
(TikTok Creative Center SA · Instagram trending audio ritual · getdaytrends SA · Snapchat Spotlight). The Studio inbox gets one row
("N ترندات جديدة هذا الأسبوع"). Copy in `messages/trends.{ar,en}.json` (registered in `lib/i18n.ts`), Hijazi first with key parity.
E2E: `e2e/trends.spec.ts` stubs `GET /trends` on the fake Worker (`https://scout.test`), phone + desktop, no horizontal scroll.

### Budgets to respect

50 subrequests per Worker invocation (trend slots get their own ticks) · 1,000 KV writes a day (one `trends:latest` write per run) ·
Tavily 1,000 credits a month shared with Research (radar ≤ 40) · YouTube 10,000 units a day plus the separate 100 `search.list` calls
(radar ≤ 13, hard-capped in code) · Google Trends and kworb were verified from a residential IP only: keep the last good copy, set
`degraded`, and fall back to an owner-run GitHub Action if Cloudflare egress IPs get 429s.

## Owner's part (once)

1. **YouTube API key**: Google Cloud → project "3z prod" → APIs & Services → Credentials → Create credentials → **API key** → restrict
   it to the YouTube Data API v3 → GitHub → Settings → Secrets → `YOUTUBE_API_KEY` (the deploy workflow copies it to the Worker).
   Never paste the key into chat.
2. **Niche keywords** for the highlight and the daily YouTube scan. Proposed defaults, edit freely: Arabic — تصوير، مونتاج، دافنشي ريزولف،
   تصحيح الألوان، كاميرا، صانع محتوى؛ English — DaVinci Resolve, color grading, cinematic b-roll, iPhone videography, video editing,
   content creator.
3. **Yes / no** on the third-party aggregators kworb.net (TikTok sounds) and trends24.in (X trends), shown with attribution.
4. Optional, later: a free TikTok for Business login (full Creative Center list when opening the manual link), a `@3zprod.com` mailbox
   (TikTok Marketing API), an Anthropic key with credits (AI "why + 3 ideas" layer), the Google Trends API alpha form.

## Built (Wave 1, Sep 28, 2026)

All five gates green on the integrated tree after the review round (lint, typecheck app + Worker, 870 unit tests, static build,
166 e2e across phone and desktop, twice). Review fixes that changed behaviour: slots on the `*/5` grid (see above), 🔄 runs the fast
sources only, the weekly Tavily scan is capped per ISO week (`force: true` overrides), every outbound fetch times out after 12 s, the
YouTube search cap is reserved before spending, `seenAt` now means first seen (kept across runs), and moments never appear as list rows.
What landed, and where it differs from the table above:

- **Data (T1)**: the persisted `trends` slice is `TrendsStateSchema = TrendsFeedSchema.extend({ dismissed })`, so it also stores the
  Worker's `sources: [{ name, ok, at?, error? }]`. Store actions `setTrends` / `dismissTrend` / `clearTrends` plus the `trendsState`
  selector; pure rules in `lib/trends.ts` (`visibleTrends`, `trendsStale`, `matchesKeywords` with Arabic diacritics folding,
  `trendIdeaText`, `upcomingEvents`, `eventToTrendItem`); `data/events.ts` loads `planning/data/saudi-events.json` (`SAUDI_EVENTS`,
  `getSaudiEvent`). Event rows use id `event:SA:<event.id>`, title `<ar> · <en>`, tags `[kind, ...hashtags]`, and expire at the
  Riyadh midnight after the last day. `AutoPostSchema.jobId` landed (schema half of A7). No `STORE_VERSION` bump (additive defaults).
- **Worker (T2)**: `workers/scout/src/trends/{types,kv,normalize,google,youtube,youtubeSearch,kworb,x,tavily,events,run,routes}.ts`;
  KV keys live in `trends/kv.ts` (`social/store.ts` untouched). `RUN_BUDGET` 38 calls per invocation; one `trends:latest` write per
  run (+ the `trends:ytsearch:<day>` counter). Google: the RPC row layout verified live on 2026-09-28
  (`[title, _, geo, [start], [end] | null, _, volume, _, growthPct, related[], categories[], news[], title]`, 66 SA / 367 US rows for
  24 h); the RPC carries no headlines, so the RSS is always fetched too (4 calls); RSS-only sets `degraded`. `lang` follows the region
  (SA → ar, US → en) for Google, YouTube and kworb; Tavily and trends24 rows use the title's script; events are `mixed`. A missing
  `YOUTUBE_API_KEY` reports `not_configured` without setting `degraded`; a partly working source (RSS-only, search stopped by the cap)
  is `ok: true` with a note in `error` and sets `degraded`. Rows of a source removed from `TREND_SOURCES` are dropped at the next run.
  `TREND_SOURCES` default `google,youtube,tavily,events` (kworb / x wait for the owner's answer). `/search` now forwards `lang` as
  Tavily's `language`. Not run: `wrangler deploy --dry-run` (the JSON import of `planning/data/saudi-events.json` is bundled by esbuild;
  confirm on the first deploy).
- **UI (T3)**: mounted by `components/social/ideas/TrendsCard.tsx` (keeps `data-testid="ideas-trends"`), first and full width in the
  Ideas bank above the form / list / skills grid; pieces in `components/social/trends/` (`useTrends`, `TrendRadar`, `TrendRow`,
  `TrendActions`, `MomentsRail`, `ManualLinks`), client in `lib/trendsClient.ts`, copy in `messages/trends.{ar,en}.json`. Tab rule:
  عربي = region SA + lang ar, English = lang en from any region, `mixed` rows under both; ⭐ uses both keyword lists; "saved" is derived
  from the ideas bank (same trend text → same idea, no duplicates); the Studio inbox row counts visible rows with `seenAt` within 7 days.
  The manual tile links TikTok Creative Center SA, getdaytrends SA and Google Trends SA, plus the Instagram in-app ritual as text (no
  stable Snapchat Spotlight URL). Calendar moments cannot be dismissed (they are not store rows). `e2e/trends.spec.ts` passes on both
  projects. The old `ideas.trends` / `ideas.trendsSoon` keys are no longer referenced (cleanup pending).

## Later (v2)

Threads `keyword_search` public results after the CR (App Review) · TikTok Marketing API `discovery/trending_list` · Instagram hashtag
search after switching to Facebook Login for Business · Apify Creative Center actor behind a flag · Trends MCP · the Claude summary layer
· "trend fit" scoring against the owner's skills (`Skill.trend` filled from live data, a coach reason on Today when a trend matches a
skill's program) · push notification for a spiking trend (Sprint 3 Web Push).
