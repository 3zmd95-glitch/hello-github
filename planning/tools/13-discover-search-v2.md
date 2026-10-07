# 13 · Discover search v2, and the Claude connector (MCP)

**Status:** PR #26 merged and deployed on October 4, 2026. Ten live searches and cache repeats passed functional checks; CPU use exceeds the documented Free-plan allowance. Claude connector discovery is live; owner sign-in and a research chat remain unverified. See the live results below.

Owner, round 33 (Oct 3, 2026, with screenshots of "flash" finding nothing on Instagram, Beacons' Discover Trends and the
Obsidian note "Social Media (Categories)"): "plan today the work on discover page in all aspects… browse beacons.ai discover
trends plus we work better on our search… maybe a panel that analyze editors". Later the same day: "I want to have mcp so I
connect claude. im already subbed".

The request is three projects, built in this order, each with its own spec and plan:

1. **Discover search v2 + the Claude connector** (this file).
2. **Editor panel**: the ~70 creators of the owner's Obsidian list, their newest and best posts, posting rhythm, growth.
   Instagram through Business Discovery (needs @3z.prod linked to a Facebook Page and the "Instagram API with Facebook
   Login" use case), YouTube through the Data API, TikTok as links only (no API reads other accounts). Research notes below.
3. **Trends like Beacons**: niche → top posts per platform with numbers, built on 1 and 2.

## What it does

**In the dashboard (Discover and every skill's Research panel):**

1. You type a word ("flash") as today. The Worker reads it with a built-in **editing dictionary** and shows how it understood
   it: "flash = flash transition (editing effect) · English + عربي", with **Not this?** chips (other meanings the dictionary
   knows, and "search exactly 'flash'").
2. It searches **both languages every time**: TikTok and Instagram three searches each (examples, tutorials, Arabic), 20
   results per search; YouTube three searches through YouTube's own search (real views and dates). Since 2026-10-07
   **English first**: English only, unless the search is typed in Arabic or "Arabic first" is on (then the Arabic
   tutorials too); every trend chip is English (see "Live fix (2026-10-07)").
3. Results come in sections:
   - **🔥 Popular now**: one swipeable row of the 6 results with the biggest numbers (YouTube views; TikTok / Instagram likes
     when the page showed them; ties newest first), saying which number it uses.
   - **🎬 Examples**: edits that use the effect.
   - **📘 Tutorials**: how to make it (DaVinci, CapCut, Premiere…), Arabic and English.
   - **👤 Creators**: the accounts that appeared most for the topic, with how many of their posts matched.
   - **⭐ Claude's picks** on top, when the connector saved picks for this topic.
4. Off-topic results are hidden, never deleted: "8 hidden · show".
5. Kept as they are: the platform tabs (now a filter over all sections, with counts), ▶ Watch here, Attach to skill, Saved only,
   Arabic first, the time filter, YouTube length, Best match / Most popular (inside each section), recent topics, genre chips,
   the "Most viewed this week" strip.
6. Each section shows about 6 cards and **Show more**.

**In Claude (web, desktop, phone), through the connector:**

| The owner says | Claude does (on his subscription) |
| --- | --- |
| "Find the best flash transition examples and tutorials, Arabic and English" | plans its own searches, runs them through the Worker, reads the results, picks and explains |
| "Save the top 5 to Discover" | the picks appear in Discover under ⭐ Claude's picks for that topic |
| "What's trending in Saudi this week for car edits?" | reads the Trend Radar feed |
| "What did we save about speed ramps?" | reads the saved picks |

## The test that shaped it (Oct 3, 2026)

42 real searches through the deployed Worker (`/search`), TikTok and Instagram, four topics (flash, matchcut, speed ramp,
color grading). "About editing" = the title mentions an editing word (a rough check).

| Search style | Cards per call | About editing | With numbers |
| --- | --- | --- | --- |
| Today (topic as typed, 10 results) | 4.9 | 63% | 0% |
| Today, 20 results | 12.0 | 50% | ~4% |
| Planned English queries ("flash effect tutorial capcut davinci") | 5.5 | 99% | ~1% |
| Planned Arabic queries ("شرح تأثير فلاش مونتاج") | 8.4 | 72% | 0% |

Findings:

- A bare word gets the wrong topic: "flash" on TikTok returned The Flash (superhero); 2 of 13 cards were about editing.
- 20 results cost the same as 10 (one basic Tavily search is 1 credit whatever `max_results` is) and bring ~2.5× the cards.
- Arabic queries find Arabic creators the English ones never show.
- About 1 call in 6 came back empty although the same query worked another time: every empty call needs one retry.
- TikTok / Instagram numbers are almost never in the page text (5 of ~300 cards), so Popular now leans on YouTube.
- Many Instagram cards have no account name: the link has none and the page text gave none.

## Search before building (2026-10-03)

| Area | Find | Decision |
| --- | --- | --- |
| Search provider | Tavily (in use): `max_results` 0–20 at the same price, `include_published_date`, `include_usage`, `country`, `GET /usage` (key and account usage, plan and pay-as-you-go limits) ([docs](https://docs.tavily.com/documentation/api-reference/endpoint/search), [usage](https://docs.tavily.com/documentation/api-reference/endpoint/usage)) | **Kept**, with 20 results, dates, usage |
| Search provider | Exa, Brave Search API, SerpAPI and similar | Not tested (each needs an owner sign-up). Candidates if the golden test misses its targets |
| Query planning | Claude API in the Worker (Haiku 4.5 / Opus 5.5) | **Deferred** (owner: connector first). The pipeline keeps one seam: `plan` and `label` are the two steps a key would switch to Claude |
| Query planning | Built-in editing dictionary (this file) | **Adopted**: free, instant, covers the owner's words; also starts the "edit style" axis of `11-discover-genres.md` |
| Connector | Cloudflare Agents SDK (`agents` 0.26.0) `createMcpHandler`: stateless MCP over Streamable HTTP, no Durable Objects, runs on the free plan ([docs](https://developers.cloudflare.com/agents/model-context-protocol/apis/handler-api/)) | **Adopted** |
| Connector | `McpAgent` (Durable Object per session) | Rejected: state not needed, and Cloudflare now recommends the stateless handler |
| Connector auth | [`@cloudflare/workers-oauth-provider`](https://github.com/cloudflare/workers-oauth-provider) 1.2.1: OAuth 2.1 with dynamic client registration, tokens in KV | **Adopted**: Claude's custom connectors register themselves and send the owner through `/authorize` ([Anthropic](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)) |
| Connector | `@modelcontextprotocol/server` 2.0.0 (`McpServer`, zod tool schemas) | **Adopted** (used through the Agents SDK) |
| Connector | The `/api/mcp` route planned in `01-dashboard.md` (Next.js) | **Superseded**: the app is a static export, so the MCP server lives on the Worker |
| Trends reference | Beacons "Discover Trends" (seen live in the owner's account): a niche card, top performing posts per platform with views / likes and "Top 25%" badges, suggested queries, a chat box, paid credits. No public statement on its data source | Reference for project 3 |
| Creator data | Instagram Business Discovery: Facebook Login only (`graph.facebook.com`, a linked Page, `instagram_basic` + `instagram_manage_insights` + `pages_read_engagement`), Standard Access in Development mode, ~200 calls / hour, Business / Creator targets only; returns followers, media count and per post likes (unless hidden), comments, **view_count**, permalink, caption, timestamp, thumbnail (video) ([reference](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/business_discovery)) | Project 2. Not verified live (one Graph API Explorer call first) |
| Creator data | TikTok Research API (academic, non-commercial, US / EEA / UK…), Display API (own account only), Meta Content Library (academic) | Rejected: not available to a commercial individual in Saudi Arabia |
| Creator data | YouTube `channels.list` + `playlistItems.list` + `videos.list` (1 unit each) | Project 2 |

## Design

### The editing dictionary (`planning/data/edit-terms.json`)

One file the owner can edit, bundled by the Worker (the `genres.json` pattern; `worker.yml` watches it). About 40 entries to
start: flash transition, match cut, speed ramp, velocity, color grading, mask transition, whip pan, zoom transition, J / L
cut, glitch, light leak, film burn, freeze frame, split screen, rotoscope, chroma key, beat sync, motion blur, camera shake,
optical-flow slow motion, text animation, captions, sound design, LUT, day for night, teal & orange, film grain, film look,
smooth transition, 3D zoom, parallax, clone effect, invisible cut, cinematic b-roll, hyperlapse, stop motion, camera
flash (photography), and others the owner names.

```jsonc
{
  "id": "flash-transition",
  "kind": "transition",              // transition | effect | color | audio | technique | style | photo
  "label": { "en": "flash transition", "ar": "انتقال فلاش" },
  "match": { "en": ["flash", "flash transition", "flash cut", "flash effect"], "ar": ["فلاش", "انتقال فلاش", "تأثير فلاش"] },
  "specific": false,                 // false: a match also needs an editing word to count as on-topic
  "queries": {
    "examples":  { "en": "flash transition edit", "ar": "ايديت انتقال فلاش" },
    "tutorials": { "en": "flash transition tutorial capcut davinci", "ar": "شرح تأثير فلاش مونتاج" }
  }
}
```

- **Matching** (`normalizeTerm` in `workers/scout/src/discover/terms.ts`): whole words, both sides (what was typed and
  every synonym) in one form: the auto-replies matcher's `normalizeForMatch` (lower case; Arabic diacritics and tatweel
  dropped; alef / yaa forms unified; punctuation and emoji as spaces), then ة as ه, then per word a leading "ال" dropped
  and a plural dropped: the English "s" after 4+ characters (not "ss"), the Arabic "ات". So "الشاشه", "transitions" and
  "انتقالات" match. The longest matched synonym wins (ties: file order); the other entries that matched become
  **Not this?** chips, at most 3 (the first in file order, counted before a generic one is dropped, below), then
  "search exactly".
- **Generic entries** (`generic: true`: the catch-all "smooth transitions", matched by "transitions") win only when no
  non-generic entry matched (one with `specific: false` beats them too), and are never offered as another meaning under
  **Not this?**. The one exception is an exact search: its single chip back to the dictionary is the entry its words
  match, generic or not (no match, no chip).
- **Intent and filler words** are ignored (`INTENT_WORDS`): edit(s), editing, video(s), tutorial(s), how, to, guide,
  reel(s), tiktok, instagram, youtube, شرح, طريقة, كيف, ايديت, مونتاج, فيديو, تعليم, درس, تعلم; for, the, with, in, on,
  of, a, an, and, my, me, ابغى, ابي, ابغا, اسوي, عن, في, حق, على, من. The other typed words the match did not cover go on
  the entry's queries ("speed ramp cars" → "speed ramp edit cars"); with no entry matched and only such words typed,
  the typed words are the topic.
- **Unknown words** (no entry): examples "<topic> edit", tutorials "<topic> tutorial", Arabic "شرح <topic>" (its retry:
  "ايديت <topic>"); on-topic needs only the topic's words.
- **Exact** ("search exactly 'flash'"): the typed words only, no dictionary, no editing words, nothing hidden.
- A genre chip adds the genre's main query to the examples searches; the program ("+ DaVinci Resolve") goes on the tutorial
  searches (`withProgramHint`).

### The pipeline (Worker, `src/discover/`)

`POST /discover` and the connector's `search_videos` run the same steps:

1. **Plan** (`plan.ts`): dictionary or unknown-word rules → up to 9 queries: TikTok and Instagram × (examples en, tutorials
   en, tutorials ar), YouTube × (examples en, tutorials en, tutorials ar). Arabic tutorials are where the test found Arabic
   creators; the Arabic examples query is the retry. Time range and YouTube length pass through. **English first since
   2026-10-07**: the Arabic tutorials query only when the request says `lang: "ar"` (6 queries otherwise; see "Live fix").
2. **Fetch** (`run.ts`), all at once:
   - Tavily `search` per TikTok / Instagram query: `max_results: 20`, `search_depth: "basic"`, `include_images: true`,
     `include_published_date: true`, `include_usage: true`, `include_domains` the platform, `language` the query's,
     `country: "saudi arabia"` for Arabic. A call that answers with no post card is **retried once** with new words:
     examples en "<name> video", tutorials en "how to <name>" (`<name>`: the entry's English label plus the other typed
     words, else the topic's words; no genre or program), tutorials ar the Arabic examples query. A retry that would
     repeat words already planned on that platform is dropped; YouTube has no retries; at most two retries a search.
     With a time range, Tavily is asked a wider one (week → month) and the cards outside the asked range by their real
     date are dropped (see "Live fix (2026-10-07)").
   - YouTube `search.list` (Worker's `YOUTUBE_API_KEY`; Arabic: `regionCode=SA`, `relevanceLanguage=ar`), then one
     `videos.list` for the numbers of every YouTube card (1 unit).
   - Profile pages (`tiktok.com/@user`, `instagram.com/<user>/`, `youtube.com/@channel`), dropped by `normalizeHits` today,
     are kept as **creator candidates**.
3. **Label** (`label.ts`): a card is a **Tutorial** when its title or snippet says so (`TUTORIAL_RE`: tutorial(s),
   how to, how-to, guide, step by step, explained, breakdown, learn, lesson; and in Arabic شرح, طريقة / طريقه, كيف, تعلم,
   درس, خطوات, تعليم as whole words that may carry a prefix و ف ب ل ال بال وال لل, so "بطريقه" and "الشرح" count, "مدرسه"
   and "كيفك" do not), else it takes its query's intent. It is **off-topic** when it mentions none of the entry's words,
   or (entry `specific: false`) neither an editing word (`EDITING_WORDS`: edit(s), editing, editor, transition(s),
   effect(s), capcut, davinci, premiere, after effects, final cut, cut, vfx, مونتاج, ايديت, تأثير, انتقال, كاب كت,
   دافنشي, مونتير, فاينل كت) nor a tutorial word: a tutorial word counts as editing context too. Entry and editing words
   compare whole, in the matching form above. A trend chip's search (`editing: true`) is off-topic too unless its text
   holds an editing cue besides the typed name (see "Live fix").
4. **Creators**: on-topic cards grouped by platform + the YouTube channel page when the card has one (two channels with
   one name stay apart), else platform + handle (any case); cards without a handle, or with neither a channel page nor
   an "@handle" to link the account, are left out. Ranked by on-topic cards, then total views; profile-page candidates
   follow (count 0) unless that account is already listed; top 8.
5. **Answer**: one JSON (below). Popular now, the tabs, Show more, Arabic first and the sort are worked out in the browser.

Seam for later: with an Anthropic key, steps 1 and 3 call Claude (plan → queries + alternatives; label → section + on-topic
per card); everything else stays.

### API

```ts
// POST /discover  (Bearer SCOUT_TOKEN)
interface DiscoverRequest {
  q: string;                                  // 1–200 characters, at least one letter or digit ("🔥🔥" is a 400)
  exact?: boolean;                            // "search exactly": no dictionary
  term?: string;                              // a dictionary id chosen from "Not this?"
  genreQuery?: { ar?: string; en?: string };  // the genre chip's main query (built-in or custom)
  program?: string;                           // "DaVinci Resolve"
  lang?: "ar" | "en";                         // "ar" adds the Arabic tutorials query; English only without it
  editing?: true;                             // a trend chip's search: cards need an editing cue (keyword mode only)
  timeRange?: "week" | "month" | "year";     // TikTok / Instagram: by the posts' real dates (see "Live fix")
  ytLength?: "short" | "long";
  platforms?: ("tt" | "ig" | "yt")[];         // default all three
}
interface DiscoverResponse {
  topicKey: string;
  understood: { termId?: string; label: { ar: string; en: string }; exact: boolean };
  alternatives: ({ termId: string; label: { ar: string; en: string } } | { exact: true })[];
  items: {
    platform: "tt" | "ig" | "yt"; handle: string; title: string; snippet: string; url: string;
    thumb?: string; stats?: Stats; published?: string; lang: "ar" | "en";
    section: "example" | "tutorial"; offTopic?: true; profile?: string;
  }[];
  creators: { platform: "tt" | "ig" | "yt"; handle: string; url: string; count: number; views?: number }[];
  platforms: Partial<Record<"tt" | "ig" | "yt",
    { ok: true; retried?: boolean } | { ok: false; error: "quota" | "auth" | "upstream" | "daily_cap" | "not_configured" }>>;
  cost: { tavily: number; youtubeSearch: number };
  cached: boolean;
  complete: boolean;                          // could be kept (see Caches); a KV hit is complete
}
// GET  /discover/usage → { tavily: { used, limit, plan?, paygoUsed?, paygoLimit? } | { error }, youtube: { usedToday, cap },
//                          connector: { usedToday, cap } }   (Tavily's figure cached 10 minutes)
// GET  /discover/picks[?topic=] → { picks: { topicKey, topic, savedAt, items: Pick[] }[] }
```

- `/search` stays as it is (older dashboards, the paste-link form); the Trend Radar is untouched.
- **Caches**: the Worker keeps a whole answer in KV for 6 hours (`discover:answer:<hash of the normalized request>`,
  `expirationTtl`), so the dashboard and Claude asking the same thing spend once; the browser keeps answers 24 hours
  (`lib/discover.ts`, the `scoutClient` pattern, its own storage key). A cached answer says `cached: true` and costs nothing
  (`cost` all 0). Only a complete answer is kept: every query answered (a key that is not set does not count against it;
  a YouTube query over the day's cap does) and at least one card was found (an empty answer can be a fluke).
  The answer says so in `complete`, and the browser keeps only those (a platform's status alone cannot show that one
  of its queries failed): at most 8 answers and 1,000,000 characters of localStorage, since the app's saved progress
  shares that quota.
  KV, not the Cache API: Cloudflare's docs do not confirm the Cache API on `workers.dev`, and KV is global.
- **TikTok thumbnails** are no longer fetched inside the search: a card without one asks `GET /oembed` (already cached
  6 hours at the edge for TikTok) once per post per session, when the card is shown (it mounts); a section shows at most
  6 cards before **Show more**. The same lookup brings the caption: a card titled only by its handle (a generic TikTok
  page title) asks too, picture or not, and shows the caption instead. A search makes at most ~16 outbound calls (9
  searches, ≤ 2 retries, `videos.list`, KV counters), well under the 50 a free invocation allows.

### Claude's picks (`src/discover/picks.ts`)

- One KV document `discover:picks`: `{ [topicKey]: { topic, savedAt, items: Pick[] } }`, at most 50 topics × 20 items
  (oldest topic dropped). `Pick = { url, platform, title, handle?, thumb?, label: "example" | "tutorial", note?, savedAt }`;
  the URL must be one post (`isVideoUrl`) and is stored canonical.
- `topicKey` = the dictionary id when the topic matches an entry, else the normalized words, so "flash" and "Flash
  transition" meet.
- Discover reads the picks (`GET /discover/picks`, no search credits) when it opens and again after each search, and
  shows ⭐ Claude's picks for the searched topic, filtered by the platform tab like every section; with nothing typed,
  the newest three topics' picks (no tab filter there).

### The connector (`src/discover/mcp.ts`, `src/discover/auth.ts`)

- **Endpoint**: `https://3z-scout.3zmd95.workers.dev/mcp` (Streamable HTTP, `createMcpHandler`). The Worker's `fetch` is
  wrapped by `OAuthProvider` (`apiRoute: "/mcp"`, `/authorize`, `/token`, `/register`, the `.well-known` documents); every
  other route goes to today's `handle()` unchanged, and the `scheduled` (cron) handler stays as it is. OAuth data lives in
  KV (`OAUTH_KV`).
- **Login**: `/authorize` is a one-page form in Arabic and English: "Paste your Scout token (dashboard → Settings → API
  keys)". Right token → Claude gets its access token; wrong → the form again. A `redirect_uri` outside Claude's callback
  hosts (`claude.ai`, `claude.com`) is refused before the form shows, because dynamic registration lets any client register.
  The form body is capped at 4 KiB (413, counted while read). A new login replaces the old one.
- **Registration** (`POST /register`, answered before the provider) writes nothing in steady state: a registration that
  names only Claude's callbacks gets one shared public client (created once, its id under the OAUTH_KV key
  `mcp:claude-client`); anything else is a 400, a body over 16 KiB a 413.
- **Staying logged in**: the refresh token is renewed on every use, so the login ends only after 90 days without one
  (the provider's default was a fixed 30 days from the login).
- **Kill switch**: the Worker var `DISCOVER_V2: "off"` makes `/health` say `discover: false`, so dashboards go back to the
  per-platform `/search` (for Discover hitting the Free plan's CPU limit, error 1102); `/discover` stays served for the
  connector.
- **Tools** (zod schemas, short descriptions written for Claude):

| Tool | Input | Output |
| --- | --- | --- |
| `search_videos` | `topic`; optional `queries` (≤ 9 of `{ q, platform, lang, intent }`, Claude's own plan), `platforms`, `timeRange`, `exact` | the `/discover` answer, snippets clipped to 160 characters, 40 cards at most, plus `lookupsLeftToday` |
| `get_trends` | optional `region` (SA / US), `genre`, `limit` (≤ 50) | Trend Radar rows: title, platform, url, score, volume, source, genre (no credits) |
| `save_picks` | `topic`, `items` (≤ 20 of `{ url, title, handle?, label, note? }`), optional `replace` | `{ topicKey, saved, rejected, where }` (`where`: `Discover → search "<topic>" (⭐ Claude's picks)`) |
| `get_picks` | optional `topic` | saved picks |

- **Daily cap**: Tavily lookups through the connector are counted per Riyadh day (`discover:mcp:<day>`, var
  `MCP_DAILY_LOOKUPS`, default 60). Over it, `search_videos` answers an error Claude can read: "daily limit reached (60),
  resets at midnight Riyadh time". Cached answers still work.
- **Safety**: no tool posts, deletes or touches social accounts. Titles and snippets from the web are returned as data (clipped,
  no markup); the only write is the owner's own picks list. Every tool call is logged (`console.log` JSON, Workers
  observability).

### The dashboard (`components/research/`, `lib/discover.ts`)

- With a Worker set up, `ResearchPanel` asks `POST /discover` once per search (instead of one `/search` per platform and the
  browser-side YouTube search). Without a Worker it keeps today's YouTube-key path.
- New `DiscoverSections` (Popular strip, Examples, Tutorials, Creators, Picks), the "Understood · Not this?" line, the hidden
  count with show, per-platform error lines with Retry.
- The Discover footer shows the real numbers from `/discover/usage`: "412 of 1,000 free lookups this month · YouTube
  9/70 today". The old per-device counter stays only for an older Worker.
- Copy in friendly Hijazi Arabic first, English second; `messages/ar.json` and `messages/en.json` keys in parity.

## Budgets

| What | Cost | Limit |
| --- | --- | --- |
| New in-app search | 4 Tavily credits in English, 6 with Arabic (≤ 2 more with retries) + 2 or 3 `search.list` + 1 `videos.list` | 1,000 free credits a month; $0.008 a credit after, if pay-as-you-go is on |
| Same search again | 0 (browser 24 h, Worker 6 h) | |
| Connector research | ~10–20 credits a chat | 60 a day (`MCP_DAILY_LOOKUPS`) |
| Trend Radar (already running) | ~40 credits a month, ≤ 18 `search.list` a day | unchanged |
| YouTube `search.list` for Discover + connector | 100 units a call | 70 a day (`discover:yt:<day>`, about 23 new searches), leaving the radar its 18 inside Google's 10,000 units. 66 since 2026-10-07: Trending effects takes 6 and the category top lists 4 (`tools/19-category-trends.md` §6) |
| Claude | $0 (owner's subscription, through the connector) | |
| Worker | ≤ ~16 outbound calls a search; KV ≤ 3 writes a new search (answer cache, YouTube counter, connector counter) | 50 a call, 1,000 writes a day |

About 100 new searches a month fit in the free 1,000 credits.

## When things go wrong

| Problem | What the owner sees |
| --- | --- |
| One platform fails | only that platform: "TikTok didn't answer · Retry"; the rest shows |
| Still empty after the retry | "Nothing on Instagram for this · open Instagram search ↗" (today's link) |
| Tavily credits used up (432 / 433) | a banner: "Free lookups used up · turn on pay-as-you-go in Tavily"; cached and YouTube results still show |
| YouTube daily cap | "YouTube back tomorrow"; TikTok and Instagram still work |
| Worker unreachable | the cached answer if there is one, and the Worker error line |
| Connector daily cap | Claude reads "daily limit reached (60), resets at midnight Riyadh time" |
| Off-topic cards | hidden with a count and **show**, never dropped |

## How we know it is better

**Golden test**: the same 10 searches before and after, through the real Worker (about 80 credits a run): flash, matchcut,
speed ramp, color grading, velocity edit, mask transition, whip pan, تلوين سينمائي, شرح سبيد رامب, film look.

| Measure | Before (Oct 3) | Target |
| --- | --- | --- |
| Shown cards about editing | 63% | ≥ 90% |
| On-topic cards per search (all platforms) | ~10 | ≥ 25 |
| Searches with every section filled | — | ≥ 8 of 10 |
| Platforms empty after the retry | ~1 in 6 | ≤ 1 in 10 |
| New search / repeated search | — | ≤ 12 s / instant |
| Tavily credits per new search | 3 | ≤ 8 |

**Automated**: Worker unit tests (dictionary matching in both languages, plans, retry, labels, off-topic, creators and
profile candidates, the YouTube and connector caps, the 6-hour cache, usage, picks, the MCP tools through the handler, the
authorize form); dashboard unit tests (cache, sections, tabs over sections, Show more, hidden toggle, picks); Playwright
(Discover sections with a stubbed `/discover`, Not this?, per-platform errors, the credits banner, picks, attach from the
skill Research panel). All inside the usual gates: lint, typecheck, test, build, e2e.

**Live**: the owner adds the connector once and we run one research chat together.

### Live verification — October 4, 2026

PR [#26](https://github.com/3zmd95-glitch/hello-github/pull/26) merged as
`2212b722756181fce0ac0ab15ac6b577b232ca51`. Both the
[Scout deployment](https://github.com/3zmd95-glitch/hello-github/actions/runs/37177321263) and
[Pages deployment](https://github.com/3zmd95-glitch/hello-github/actions/runs/37177321268) succeeded.
The Worker deployment created its OAUTH_KV namespace and ran all 486 Worker tests successfully.
PR CI had passed all gates. The post-merge CI check job passed; its E2E job was cancelled when a subsequent
main-branch merge superseded the run, not because a test failed. The subsequent
[main CI run](https://github.com/3zmd95-glitch/hello-github/actions/runs/37177402354) then passed both its check
and E2E jobs.

Measured through the existing localhost Discover UI against the production Scout Worker, approximately
07:34–07:39 Riyadh time. Default time range, no program or genre restriction, all platforms. Counts below are
the UI's on-topic counts, not an independent human judgement of relevance. Hidden counts are across all
platforms. Request durations and CPU times come from the ten chronological POST /discover invocation logs
in Cloudflare Observability. Repeat timings include browser automation overhead.

| Topic | Shown | YouTube | TikTok | Instagram | Hidden | Worker wall time | CPU | Cached repeat |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| flash | 99 | 41 | 26 | 32 | 22 | 7,545 ms | 24 ms | 97 ms |
| matchcut | 90 | 38 | 21 | 31 | 19 | 6,887 ms | 24 ms | 94 ms |
| speed ramp | 106 | 47 | 30 | 29 | 16 | 7,312 ms | 16 ms | 117 ms |
| color grading | 99 | 51 | 33 | 15 | 27 | 7,288 ms | 17 ms | 72 ms |
| velocity edit | 79 | 40 | 26 | 13 | 24 | 5,713 ms | 14 ms | 80 ms |
| mask transition | 82 | 34 | 19 | 29 | 40 | 6,479 ms | 19 ms | 74 ms |
| whip pan | 64 | 24 | 22 | 18 | 61 | 7,089 ms | 15 ms | 75 ms |
| تلوين سينمائي | 100 | 47 | 39 | 14 | 29 | 3,614 ms | 16 ms | 70 ms |
| شرح سبيد رامب | 96 | 44 | 31 | 21 | 30 | 2,881 ms | 17 ms | 76 ms |
| film look | 73 | 29 | 21 | 23 | 75 | 6,525 ms | 15 ms | 83 ms |

Results against the targets:

- **Volume:** 888 shown cards, averaging 88.8 per search; all ten exceeded 25. There were also 343 hidden cards.
- **Sections:** all ten had populated Popular now, Examples, Tutorials and Creators sections.
- **Empty platforms:** zero out of 30 platform/topic combinations; no platform error lines appeared.
- **Speed:** all ten Worker wall times were below 12 seconds. Browser repeats all showed the cached label;
  a further flash repeat after a page reload also showed cached, in 412 ms. YouTube usage remained 30/70
  through every repeat, versus 0/70 before the first search.
- **Credits:** ten fresh searches were run, within the planned 60–80 Tavily-credit envelope by the implemented
  query/retry cap. Exact billed credits were not independently measured: the usage footer remained at its
  ten-minute cached baseline of 66/1,000. Do not interpret that stale number as zero fresh-search cost.
- **Relevance:** the classifier kept 72.1% of all returned cards. This is not a manual precision measurement
  of the displayed cards, so the target of 90% genuinely relevant shown cards is still unverified. In particular,
  whip pan and film look returned many hidden candidates; inspect their shown cards before changing matching
  rules or choosing a second provider.
- **CPU: target not met.** All ten invocation outcomes succeeded, with zero logged errors in the filtered
  window, but every fresh search used 14–24 ms. Cloudflare documents a
  [10 ms Free-plan CPU allowance](https://developers.cloudflare.com/workers/platform/limits/#cpu-time) with
  limited overage flexibility. Successful requests therefore do not establish reliable Free-plan operation.
  Next step: profile the search pipeline and reduce CPU before claiming this gate passes. The existing
  DISCOVER_V2 fallback remains available if resource-limit errors occur; no plan or feature switch was changed.

Connector deployment checks: both OAuth authorization-server metadata and protected-resource metadata returned
200 with the expected Worker URLs. An unauthenticated GET /mcp returned 401 and advertised the correct protected
resource metadata URL. No production OAuth registration, token replacement, or picks write was performed.
The owner still needs to sign in from Claude and verify a research chat plus saved picks end to end.

## Live fix (2026-10-07): real post dates

The owner: "I'm seeing the clone effect posts in may when its says this week? … rework if needed. English First. Instagram
and tiktok first". Checked live against the production Worker: Tavily sent `published_date` for none of the Instagram
results, and its `time_range: "week"` on instagram.com is unreliable ("clone effect", Instagram, week: posts from
2023-10-04, 2024-12-02, 2026-08-15, 09-13, 09-29 and 09-30; the two reels the owner opened went up May 5 and May 30).

- **The post's own id is its date** (`src/postDate.ts`): an Instagram shortcode is base64 of a Snowflake-like media id
  (`ms = (id >> 23) + 1314220021721`), a TikTok video id carries Unix seconds in its top 32 bits. Verified against the
  owner's own reels (within ~2 minutes). `normalizeHits` sets every TikTok / Instagram card's `published` from it,
  whatever Tavily sent (a decode before 2010 or after now + 1 day is none); YouTube keeps the Data API's date.
- **The Posted filter is enforced by real dates on TikTok and Instagram** (`run.ts`): Tavily is asked a wider window (week →
  month; month and year as they are), then a card stays only when its date is inside the asked window at the request's
  time (week 7 days, month 31, year 366). A card with no date stays. YouTube keeps `publishedAfter`.
- **Cards show the date** (`ResultCard`): "Oct 3" this year, "May 30, 2025" before, English with Latin digits in both
  languages, in a `<time dateTime>`.
- Kept answers from before have no dates: the Worker's answer key is version 6, the browser's cache version 6.

**English first** (`plan.ts`). A chip tap always added the Arabic tutorials query ("شرح Glow Effect"), and for "Glow
Effect" it returned Arabic beauty-serum reels ("سيروم كولاجين جلو بوستر (Collagen Glow Effect)"): the beauty content in
the owner's screenshot. Now the planned search asks English examples and English tutorials (2 Tavily credits a platform,
2 `search.list`), and adds the Arabic tutorials query only for `lang: "ar"`. The dashboard works the language out for
each search and always sends it: `"ar"` when what was typed has Arabic letters or "Arabic first" is on, else `"en"`, in
either dashboard language. A trend chip (an English name, "Arabic first" turned off) is English, and nothing of it sticks to
the next search (review fix). The
Claude connector keeps both languages (`lang: "ar"`, as its description says). AI plans are unchanged (their keyword
baseline keeps the Arabic retry).

**Editing context for trend-chip searches** (`label.ts`). A 🔥 chip or a category's style sends `editing: true` (with
`lang` left English and "Arabic first" turned off). A card is then off-topic unless its title or snippet holds an editing
cue besides the chip's own name: edit(s), editing, effect(s), transition(s), capcut, after effects, premiere, davinci, vn,
alight, filmora, tutorial, trend; inside a category its filming words count too (a camera style such as "rolling shot"
names no edit). "Collagen Glow Effect" is off-topic (its "effect" is the product's name); "Product Cutout … Insta Edit में
Glow Effect" stays.

**Instagram and TikTok first** (dashboard): the tabs read All, Instagram, TikTok, YouTube (the stored tab names are
unchanged), and on All each section lists the Instagram and TikTok cards before YouTube's, each group in its order (or
by the numbers with Most popular).

## Honest limits

- The dictionary knows what is in it; a new slang word gets the unknown-word plan until it is added (by hand, or later by
  Claude through the connector).
- TikTok and Instagram results are what a web search indexed, not the platforms' own lists; their numbers stay rare.
- Instagram cards often have no account name, so Instagram creators come mostly from profile pages the search found.
- The connector spends the same credits as the app; the daily cap is the guard, not a guarantee of cost.
- Claude's own judgement runs only in chat. The in-app sections follow word rules until an API key is added.

## Owner's part

1. Nothing to set up for the in-app search.
2. Optional: in Tavily, turn on pay-as-you-go with a monthly limit (for example $5), so search never stops mid-month.
3. Once it is live: in Claude, **Customize → Connectors → Add custom connector**, paste the Worker's `/mcp` address, then
   paste the Scout token on the login page.
4. Tell us the words you search most, so the dictionary covers them.

## Later

- An Anthropic API key: Claude plans and labels inside the app too (the two seams above).
- An `add_edit_term` tool, so Claude grows the dictionary from chat.
- Creators: a **follow** button that feeds the editor panel (project 2).
- Project 3's niche view: top posts of the followed creators by topic, with "top 25%" marks.
- A second search provider behind the same pipeline if the golden test stays under target.
