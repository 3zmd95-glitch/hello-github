# 11 · Discover by edit genre, and "Most popular"

Owner, round 31 (Sep 29, 2026): "is it possible that the discover can make me search based on genre of edits? cars, food and
restaurants, anime, travel… to be a better editor and understand the latest trends and most famous edits by genre". Built the same
day on top of the round-30 search (`components/research/`, Scout Worker `/search`) and the Trend Radar (`08-trends.md`).
Numbers 09 and 10 are taken by files that live in another worktree (Metricool / Beacons roadmap, auto-replies).

## What it does

1. **Genre chips** under the search bar, in 🔎 Discover and in every skill's Research panel: 12 built-in genres (below) and the
   owner's own. A chip alone searches the genre's own words in the search language ("ايديت سيارات" / "car edit"); with a topic
   typed, both are searched together ("match cut car edit"). Tapping the active chip, or ✕, clears it. Only a typed topic is
   remembered under "recent topics".
2. **🔥 Most popular** in the filters: YouTube is asked by view count (with the owner's key) and every card is ordered by its
   numbers: views when known, else likes × 10 (about one like per ten views). Cards without numbers come after, in their
   original order. "Arabic first" still puts Arabic cards first, each group by popularity.
3. **Numbers on the cards**: 👁 views or ❤️ likes, in compact form. YouTube numbers come from `videos.list` (1 quota unit per
   search); TikTok and Instagram numbers are read from the page description when it opens with them.
4. **The Trend Radar knows the genres**: the daily YouTube keyword scan also searches each genre's main query (Arabic against
   Saudi Arabia, English against the US) and tags the rows; the radar has a genre select next to the platform chips.
5. **Settings → 🎬 Edit genres**: add a genre (a name and its search words) or remove one. A custom genre uses the same words
   for both languages and shows with ✨. It is searched on demand only; the radar's daily scan covers the built-in list.

## Search before building (2026-09-29)

| Area | Find | Decision |
| --- | --- | --- |
| Count parsing | The Worker's own `ENGAGEMENT_HEAD` / `IG_DESC_HEAD` patterns (round 30) | **Adopted**: `parseEngagement` extends them, no dependency |
| Count parsing | [yt-dlp `parse_count`](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/utils/_utils.py) (Unlicense) | Reference for the unit table (K / M / B); has no Arabic digits or multipliers |
| Count parsing | [@internationalized/number](https://github.com/adobe/react-spectrum/tree/main/packages/%40internationalized/number) (Apache-2.0) | Reference: detects Arabic-Indic digits and separators, but no compact notation and one number at a time |
| Count parsing | js-abbreviation-number, anynum, arabic-digits, human-format, numbro | Rejected: stale or a one-line digit map; none reads "N likes, M comments" or "ألف / مليون" |
| Popularity by genre | YouTube `search.list order=viewCount` + `videos.list part=statistics` | **Adopted**: the only official, free, automatable "most viewed for a keyword" |
| Popularity by genre | TikTok Creative Center (industry filter) | Manual link only: its terms forbid automated collection and the full list needs a login (same as round 30) |
| Popularity by genre | TikTok API for Business Discovery API | Candidate v2 (needs a company-domain mailbox); category and country parameters not verified |
| Popularity by genre | Trends MCP, Apify Creative Center actors | Rejected: they re-serve Creative Center data and return hashtags, not edits with counts |
| Popularity by genre | Open datasets of trending edits by genre | None found |
| Taxonomy | YouTube video categories, TikTok's 18 industries, [IAB Content Taxonomy 3.1](https://github.com/InteractiveAdvertisingBureau/Taxonomies) | Reference: the 12 genres map onto all three; none is fine-grained enough to replace our list |
| Taxonomy | CapCut template categories (velocity, beat, phonk, lyrics…) | Reference: **edit style** is a second axis; custom genres cover it for now |
| Ready-made tools | Claude skills / plugins (TubeAlfred, UnifAPI), sergebulaev/tiktok-skills, pandich93/youtube-niche-finder, Nooticr MCP, ViralMint | Nothing runs in a static export or a free Worker. Idea kept from youtube-niche-finder: a "breakout" sort (views against the channel's median) |

Not verified: npmjs.com pages answered 403 (the registry API was used instead); the TikTok Business API pages are
JavaScript-rendered; no live Arabic Instagram / TikTok description was captured, so the Arabic fixtures are assumptions.

## The genres (`planning/data/genres.json`, one source for the app and the Worker)

| id | Name | Main query (ar · en) |
| --- | --- | --- |
| `cars` | 🚗 سيارات · Cars | ايديت سيارات · car edit |
| `food` | 🍔 أكل ومطاعم · Food & restaurants | مونتاج أكل · food edit |
| `anime` | 🎌 أنمي · Anime | ايديت انمي · anime edit |
| `travel` | ✈️ سفر · Travel | مونتاج سفر · travel edit |
| `football` | ⚽ كورة · Football | ايديت كورة · football edit |
| `coffee` | ☕ قهوة · Coffee | تصوير قهوة · coffee edit |
| `perfume` | 🌹 عطور · Perfume | تصوير عطور · perfume edit |
| `camping` | 🏕️ كشتة وبر · Camping & desert | تصوير كشتة · camping edit |
| `fashion` | 👗 موضة · Fashion | ايديت موضة · fashion edit |
| `gaming` | 🎮 قيمنق · Gaming | ايديت قيمنق · gaming edit |
| `weddings` | 💍 أعراس · Weddings | مونتاج زواج · wedding edit |
| `gym` | 🏋️ جيم · Gym | ايديت جيم · gym edit |

Each genre has a second query per language and two hashtags (the first is the Instagram hashtag link when no topic is typed).
To change the list, edit the JSON: `data/genres.ts` validates it (`GenreSchema`), the Worker bundles the same file
(`workers/scout/src/trends/genres.ts`), and `worker.yml` watches it, so a change to the list redeploys the Worker.

## Design

- **Data** (`lib/domain.ts`, additive): `GenreSchema`, `CustomGenreSchema`, persisted `customGenres` (default `[]`),
  `TrendItem.genre` (optional). `lib/genres.ts`: `allGenres`, `genreById`, `genreQuery`, `genreHashtag`, `customGenreId`.
- **App**: `ResearchPanel` composes `withProgramHint(genreQuery(genre, lang, topic))`; a chip tap is a search. `Stats
  { views?, likes?, comments? }` rides on `ScoutResult`, `YoutubeVideo` and `ResearchItem`; saved references do not keep
  numbers (they age). `SCOUT_CACHE_VERSION` 3, so cards cached before the Worker sent numbers are asked again.
- **Worker**: `parseEngagement` (English and Arabic heads, K / M / B, ألف / مليون / مليار, Arabic-Indic digits and separators) sets
  `stats` on TikTok and Instagram cards; `enrichYoutubeStats` makes one `videos.list` for the YouTube cards of a search when
  `YOUTUBE_API_KEY` is set (2.5 s timeout, never fails the search). In the app, a failed statistics call is remembered on
  the cached search (`statsMissing`): the next hit asks `videos.list` again (1 unit), never `search.list`.
- **Radar**: see `08-trends.md` (keyword scan row). The feed holds up to 400 rows (was 200: the cap cut the least-viewed,
  mostly Arabic, genre rows) and the scan ranks Arabic and English rows apart (rank 1 = 100 in each). A genre's own search
  words do not count for the niche ⭐ (`lib/trends.ts matchesNiche`), and rows show their genre as a chip. 36 keywords by default (12 niche + 24 genre), 18 searched a day in turns,
  so every keyword is searched within two days; rows of the keywords not searched today stay until their next search or their
  7-day expiry; the one statistics call shares its 50 ids between the day's keywords.

## Budgets

| What | Cost | Limit |
| --- | --- | --- |
| A genre search in Discover | 1 Tavily credit per platform asked (2 with a YouTube key in the app, 3 without), cached 24 h | 1,000 credits / month |
| YouTube with the owner's key | `search.list` 1 of the day's 100 calls + `videos.list` 1 unit; Most popular is a second `search.list` (its own cache entry) | 100 searches / day, shared with the radar |
| Radar keyword scan | ≤ 18 `search.list` + 1 `videos.list` a day | 82 searches a day stay for Discover |
| Worker `/search` | + 1 subrequest for the YouTube numbers | 50 per invocation (a search uses ≤ 13) |
| Manual trend run of all three kinds | exactly 38 outbound calls (`RUN_BUDGET`), no headroom | cron ticks run one kind each and are not affected |

## Honest limits

- How often Tavily's text for a TikTok or Instagram post opens with its counts is **not measured yet**; expect many cards
  without numbers. They sort after the cards that have them.
- "Most popular" mixes views (YouTube) and likes × 10 (TikTok, Instagram): a ranking aid, not a measurement.
- TikTok and Instagram results are what a web search indexed, not the platforms' own trending lists (those need a login and
  their terms forbid reading them by script). The manual links on the radar stay the way to see those.

## Review (Sep 29, 2026)

Six lenses, one skeptic per distinct finding: 9 raw, 6 distinct, 4 confirmed and fixed (the 200-row feed cap, the niche ⭐
on genre rows, Settings copy that promised custom genres in the radar, a failed statistics call cached for 30 minutes), 2
refuted. Each fix was re-read by a skeptic. Gates on the integrated tree are recorded in the handover.

## Owner's part

1. Nothing new to set up: the `YOUTUBE_API_KEY` secret (added Sep 29) covers the Worker's numbers and the genre scan.
2. Optional: a YouTube Data API key in the dashboard's Settings makes YouTube results richer and lets Most popular ask
   YouTube by view count.
3. Tell us which genres to add, rename or drop; or add your own in Settings.

## Later

- An **edit style** axis (velocity, beat sync, phonk, lyrics, transitions) next to the subject genres.
- A "breakout" sort: views against the channel's usual numbers, so small creators' hits rise.
- A longer keyword plan (more than 36) with kworb and trends24 on passes 400 rows: raise `MAX_ITEMS` or cap the kept rows then.
- Custom genres in the radar's daily scan (needs the list sent to the Worker).
- Real captured Arabic page descriptions as `parseEngagement` fixtures.
