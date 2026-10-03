# 3z Scout Worker

A small Cloudflare Worker (free plan) with two jobs for the dashboard, both without exposing any key in the
browser:

1. **Scout** (build plan 1.14, master plan round 24): show **TikTok, Instagram and YouTube** videos for a topic.
   Search goes through [Tavily](https://tavily.com) (1,000 searches/month free) limited to those three sites;
   pasted TikTok/YouTube links are enriched through their public oEmbed endpoints.
2. **Social analytics connector** (planning/tools/06, Beacons rebuild): the owner connects his **Instagram,
   Threads, YouTube and TikTok** accounts once (OAuth), the Worker pulls followers, per-post numbers and audience
   demographics **every day** and serves them to the Social Analytics page in the dashboard's own schema.
3. **Auto-posting** (planning/tools/07, Metricool-style): the dashboard sends one job per calendar post (media
   link, time, caption per platform) and a five-minute cron publishes it to the same four accounts. See
   [Auto-posting](#auto-posting).
4. **Trend Radar** (planning/tools/08, round 30): what is trending now in Saudi Arabia (Arabic) and the US
   (English) from Google Trends, the YouTube charts, a daily YouTube keyword search, a weekly Tavily scan of
   TikTok / Instagram / Shorts pages and the Saudi moments calendar, refreshed by the same cron and served
   as one feed. See [Trend Radar](#trend-radar).
5. **Claude connector** (planning/tools/13, round 33): Claude searches Discover, reads the radar and saves picks
   into the dashboard through an MCP server at `/mcp`, behind an OAuth login with the Scout token. See
   [Claude connector (MCP)](#claude-connector-mcp).

## Endpoints

Every request except `OPTIONS`, `GET /health`, the OAuth callback, `GET /go/:id/:n` and the Claude connector's
routes (`/mcp` takes its own OAuth access token; `/authorize`, `/token`, `/register` and `/.well-known/oauth-*` are the
login flow) needs `Authorization: Bearer <SCOUT_TOKEN>`.
Browsers may only call it from the origins in `ALLOWED_ORIGINS`.

| Route                   | What it does                                                                                                                                                                                                                                                                                  |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /health`           | `{ ok: true }`. With a valid token: `{ ok: true, auth: true, tavily: <key present>, social: { configured: { instagram, threads, youtube, tiktok }, kv }, trends: { youtube: <key present>, sources: [...] }, discover: true }`; a wrong token → 401. Used by the Settings "Test" button and the Connect page; `discover: true` tells the dashboard to search through `POST /discover`. |
| `POST /search`          | Body `{ q, platforms: ["tt","ig","yt"], lang?, max?, timeRange?, thumbs? }` → `{ results: [{ platform, handle, title, snippet, url, thumb?, stats? }], credits: { used } }` with `stats: { views?, likes?, comments? }`. See below.                                                           |
| `GET /oembed?url=…`     | TikTok / YouTube links only → `{ title, author, thumb, url }`, cached for a day (TikTok for 6 hours: its thumbnail URLs are signed and expire).                                                                                                                                               |
| `POST /discover`        | Discover v2 (planning/tools/13-discover-search-v2.md): body `{ q, exact?, term?, genreQuery?, program?, timeRange?, ytLength?, platforms? }` → `{ topicKey, understood, alternatives, items, creators, platforms, cost, cached, complete }`. Plans English + Arabic queries from `planning/data/edit-terms.json`, asks Tavily (TikTok, Instagram: 3 each, 20 results, ≤ 2 retries) and YouTube `search.list` (3 a search, daily cap `DISCOVER_YT_CAP`), labels sections and off-topic cards, ranks creators; the answer is kept 6 h in KV only when complete: every query answered (an unset key does not count against it; a YouTube query over the day's cap does) and at least one card. |
| `GET /discover/usage`   | `{ tavily: { used, limit, plan?, paygoUsed?, paygoLimit? } \| { error }, youtube: { usedToday, cap }, connector: { usedToday, cap } }`; Tavily's figure is kept 10 minutes. |
| `/social/*`, `/oauth/*` | The social analytics connector, see [Social analytics](#social-analytics), the publish queue, see [Auto-posting](#auto-posting), and the auto-replies, see [Auto-replies](#auto-replies).                                                  |
| `GET /go/:id/:n`        | No bearer: counts a tap on an auto-reply DM link and answers `302` to the button's URL (`Cache-Control: no-store`). 404 for an unknown automation or button.                                                                          |
| `/trends*`              | The Trend Radar feed, see [Trend Radar](#trend-radar).                                                                                                                                                                                                                                        |
| `/mcp`, `/authorize`, `/token`, `/register`, `/.well-known/oauth-*` | The Claude connector, see [Claude connector (MCP)](#claude-connector-mcp). |

### `POST /search` options

- `lang`: `"ar" | "en"`, forwarded to Tavily as `language` (steers the results' language; before round 30 it
  was validated and dropped, so Arabic searches came back English-only).
- `timeRange`: `"week" | "month" | "year"`, passed to Tavily as `time_range` (only pages published in that
  window). Omit it for any time. Anything else → 400.
- `thumbs` (default `true`): thumbnails on the cards.
  - **YouTube**: always `https://i.ytimg.com/vi/<id>/hqdefault.jpg`, derived from the video id (no call).
  - **TikTok**: the first 10 TikTok results get `thumbnail_url` from TikTok's public oEmbed
    (`https://www.tiktok.com/oembed?url=…`), fetched in parallel through the same cache as `GET /oembed`
    (6 hours for TikTok: its thumbnail URLs are signed and die after about 48 hours, and the dashboard
    caches results on top). Each call gives up after 2.5 s (AbortController); a failed or slow one just
    leaves that card without `thumb`, the search still answers. The dashboard falls back to a placeholder
    when a thumbnail stops loading. The same oEmbed reply's `title` (the caption) replaces a card title
    that is generic ("TikTok - Make Your Day", "Name (@handle)") or just the handle.
  - **Instagram**: no `thumb`. Instagram's oEmbed needs a Meta app access token (Facebook developer app +
    review), which this Worker does not have yet; the dashboard shows a placeholder tile.
  - `thumbs: false` skips the oEmbed calls (faster, fewer subrequests).
- `stats` on a card (round 31, the dashboard's "Most popular" sort): `{ views?, likes?, comments? }`,
  whole numbers ≥ 0, only the counts that are known. A card without any count has no `stats` (never
  `{}`), and older dashboards ignore the field.
  - **TikTok / Instagram**: read from the head of the page text Tavily returns (`normalize.ts`
    `parseEngagement`): "1,234 likes, 56 comments - …", "13.5K Likes, 120 Comments. TikTok video from …",
    "٢٬٥٠٧ تسجيلات إعجاب، ٥٥ تعليق", "١٣٫٥ ألف إعجاب". It knows K / M / B and ألف / مليون / مليار,
    Arabic-Indic digits and the Arabic thousands / decimal marks. These pages show likes and comments,
    rarely views, and many hits carry no counts at all; a caption that only mentions a number ("100 likes
    and I post part 2") is not read as one.
  - **YouTube**: one `videos.list?part=statistics` for all the YouTube cards of the answer (at most 50
    ids, 1 of the 10,000 daily quota units, one subrequest), sent after the thumbnails and only when
    `YOUTUBE_API_KEY` is set; `thumbs: false` does not skip it. It gives up after 2.5 s and never fails
    the search: without the key, on an error or a timeout the YouTube cards just have no `stats`. Hidden
    likes or closed comments leave that count out.
- Cards (`normalize.ts`):
  - Only single posts: TikTok `/@user/video/<id>`, YouTube watch / shorts / youtu.be, Instagram
    `/reel/`, `/reels/`, `/p/`, `/tv/` `<id>` (optionally behind `/<user>/`); Instagram sound pages
    (`/reels/audio/<id>`), profiles and explore pages are dropped.
  - One card per post: `url` is rebuilt from the platform id (`https://www.youtube.com/watch?v=<id>`,
    `https://www.instagram.com/p/<id>`, `https://www.tiktok.com/@user/video/<id>`), so a Short and its
    watch link, or a reel shared with and without the account, merge. `lib/research.ts` mirrors this rule.
  - Titles and snippets lose bidi marks and repeated whitespace. TikTok titles lose the ` | TikTok`
    suffix and the `TikTok video from … (@h): ` prefix.
  - Instagram: Tavily's page title is usually just "Instagram", so the card reads the handle from the
    URL (`/<user>/reel/`), then the description (`<n> likes, <m> comments - <user> on|في <date>: "…"`),
    then the twitter title (`(@user) •`), else `""` (never the hostname); the title is the caption from
    `<Name> on Instagram: "…"` / `<Name> على Instagram : "…"` or the description, else a non-generic
    page title, else the content's first sentence (not the like/comment counts), else `@user`, else
    "Instagram reel".
- Errors: `{ error: "quota" | "auth" | "upstream" | "bad_request" }`.

Apart from the optional `stats`, the response shape is unchanged from v0: older dashboards that send neither
option keep working (they get thumbnails by default).

## Social analytics

Platforms: `instagram | threads | youtube | tiktok`. Code lives in `src/social/` (`routes.ts` HTTP, `oauth.ts`

- one module per platform, `sync.ts` the daily pull, `store.ts` KV, `crypto.ts` token encryption).

### Flow

1. The dashboard calls `POST /social/connect/:platform` and sends the owner to the returned provider URL.
2. The provider redirects the browser to `GET /oauth/:platform/callback?code&state` on the Worker. The Worker
   checks the one-time `state`, exchanges the code (upgrading to a long-lived / refresh token where the platform
   has one), stores the tokens **encrypted** in KV, runs a first sync and sends the browser back to the
   dashboard with `?connected=<platform>` (or `?connect_error=<platform>&reason=<code>`).
3. Every day at 06:00 Riyadh the cron refreshes tokens when due and pulls the numbers; `GET /social/data`
   serves everything the page needs.

### Routes

| Route                               | Request                                                    | Response                                                                                                                                                                                      |
| ----------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /social/connect/:platform`    | `{ "returnTo": "https://…/social/growth/", "publish"?, "replies"? }` | `{ "url": "<provider authorization url>" }`. `returnTo` must be on an `ALLOWED_ORIGINS` origin (else 400). State nonce in KV for 10 minutes; PKCE S256 for YouTube (Google) and TikTok.       |
| `GET /oauth/:platform/callback`     | `?code&state` from the provider (no bearer)                | `302` to `returnTo?connected=<platform>` or `returnTo?connect_error=<platform>&reason=<code>`. Unknown/used state → `400 { error: "state_invalid" }` (nowhere safe to redirect).              |
| `GET /social/status`                |                                                            | `{ "platforms": { "<p>": { configured, connected, canPublish, canReply, handle?, url?, connectedAt?, lastSyncAt?, lastError?, tokenExpiresAt? } } }`                                                    |
| `POST /social/sync`                 | `{ "platforms"?: ["tiktok", …] }` (default: all connected) | `{ "synced": ["tiktok"], "errors": { "threads": "token_expired" } }`. Runs now; the outbound budget is shared between the platforms asked for, so sync one at a time for full depth.          |
| `DELETE /social/connect/:platform`  |                                                            | `{ "ok": true }`. Forgets tokens and status; snapshots, posts and demographics stay.                                                                                                          |
| `GET /social/data?since=YYYY-MM-DD` | `since` optional (default: 400 days ago)                   | `{ accounts: SocialAccount[], snapshots: SocialSnapshotInput[], postStats: SocialPostStatInput[], demographics: Demographic[], syncedAt: { "<p>": iso } }` in `lib/domain.ts` shapes (below). |

Example:

```sh
curl -X POST -H "Authorization: Bearer $SCOUT_TOKEN" -H 'Content-Type: application/json' \
  -d '{"returnTo":"https://3zmd95-glitch.github.io/3z-prod/social/growth/"}' \
  https://3z-scout.<sub>.workers.dev/social/connect/tiktok
# → {"url":"https://www.tiktok.com/v2/auth/authorize/?client_key=…&scope=user.info.basic,…&state=…&code_challenge=…"}

curl -H "Authorization: Bearer $SCOUT_TOKEN" "https://3z-scout.<sub>.workers.dev/social/data?since=2026-09-01"
# → {"accounts":[{"platform":"tiktok","handle":"3z.prod","url":"https://www.tiktok.com/@3z.prod"}],
#    "snapshots":[{"platform":"tiktok","day":"2026-09-27","followers":1200,"views30d":10000,"totalPosts":2}],
#    "postStats":[{"platform":"tiktok","postId":"7300…","publishedAt":"2026-09-20T13:00:00+03:00","kind":"video",
#                  "views":10000,"likes":800,"comments":20,"shares":40,"title":"…","permalink":"…","thumbUrl":"…"}],
#    "demographics":[],"syncedAt":{"tiktok":"2026-09-27T03:00:04.000Z"}}
```

Data conventions: `day` keys and `publishedAt` are Riyadh time (`Asia/Riyadh`, `+03:00`); demographics `key`s
are `male|female`, age buckets like `18-24`, ISO-2 country codes, city names as the platform writes them; `pct`
is 0..100. Only `GET /social/data`'s **latest** demographics day per platform is returned. The Worker emits
**raw rows** (followers and account-level totals on the snapshot, one row per published post): the dashboard
computes averages and engagement from the post rows itself.

Error codes (JSON `{ error }` on the API, `reason=` on the callback redirect): `not_configured` (503, client
id/secret or KV missing), `not_connected` (409), `state_invalid` (400), `exchange_failed` (502),
`token_expired` (409, the owner has to reconnect), `upstream` (502), `rate_limited` (429), `bad_request` (400).
The callback additionally uses `reason=access_denied` when the owner cancelled at the provider.

### What each platform gives

| Platform  | Snapshot                                                                                                                                                  | Post rows (`kind`)                                                                                                                                     | Demographics                                                                         |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| Instagram | `followers`, `views30d` (account insights), `totalPosts` (media_count), `avgStoryViews` (stories of the last 30 days, polled daily because they expire)   | reels `reel`, videos `video`, images/carousels `image`, live stories `story`; per-media insights views/likes/comments/shares/saves, reels `watchTimeS` | `follower_demographics` age / gender / country / city (needs 100+ followers)         |
| Threads   | `followers` (`followers_count` insight), `views30d`, `totalPosts`                                                                                         | `thread`: views, likes, replies → `comments`, reposts + quotes + shares → `shares`                                                                     | `follower_demographics` when 100+ followers                                          |
| YouTube   | `followers` = subscribers, `views30d`, `totalPosts`, `avgVideoWatchTime` / `avgShortsWatchTime` (Analytics `averageViewDuration` by `creatorContentType`) | uploads playlist → `short` (≤ 180 s) or `video`; views/likes/comments, `https://www.youtube.com/watch?v=<id>`                                          | Analytics `viewerPercentage` by age × gender (last 90 days) + country share of views |
| TikTok    | `followers`, `totalPosts` (video_count), `views30d` = views of the videos published in the last 30 days (TikTok has no 30-day account total)              | `video`: views/likes/comments/shares, `share_url`, cover                                                                                               | none through the API: stays a manual entry in the dashboard                          |

Refresh rules: Instagram/Threads long-lived tokens (60 days) are refreshed once older than 30 days; Google
access tokens (1 h) are refreshed with the refresh token when about to expire; TikTok access tokens (24 h) are
refreshed before every sync. A refresh the provider refuses → `lastError: "token_expired"` → reconnect.

### Limits to know

- **Subrequests**: the free plan allows 50 per invocation, KV operations included. One sync gets a budget of
  40 outbound calls (`FETCH_BUDGET`); the fixed calls come first and **per-post insight calls (Instagram,
  Threads) stop when the budget is reached, roughly the newest 30 posts per sync**. Rows past the budget keep
  the counts from the media list (likes, comments) and the insights they got on an earlier day: the daily
  cron gives each platform its own invocation, so each one gets the full budget.
- **Cron**: one trigger every five minutes (`*/5 * * * *`); the ticks at 03:00/03:10/03:20/03:30 UTC
  (06:00–06:30 Riyadh) sync one platform each instead of publishing (`SYNC_SLOTS` in `src/social/cron.ts`),
  and the Trend Radar ticks (`TREND_SLOTS`: 00:05/06:05/12:05/18:05 UTC fast, 21:05 UTC daily, Saturday
  21:15 UTC weekly; every slot sits on the five-minute grid, a test guards it) refresh the trend feed instead. One trigger instead of many also stays inside the free
  plan's five cron triggers per account. `POST /social/sync` without `platforms` shares one budget across
  every connected platform (10 calls each with four): use it as a quick refresh, not as the daily pull.
- **KV writes**: 1,000 a day on the free plan. A sync writes about six keys (tokens when refreshed, snapshot,
  posts document, demographics, status), so manual syncs are cheap.
- Instagram's account insights cover at most 30 days per call; media older than a day or two may refuse
  insights (the row then keeps its basic counts); demographics need 100+ followers (skipped below that).

### Storage (KV binding `SOCIAL_KV`)

| Key                     | Value                                                                                                                                                                                                                 |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tokens:<platform>`     | `v1.<iv>.<ciphertext>`: AES-256-GCM of `{ accessToken, refreshToken?, expiresAt?, issuedAt, userId?, scope? }`; key = HKDF-SHA-256(`SCOUT_TOKEN`). Rotating `SCOUT_TOKEN` invalidates every stored token (reconnect). |
| `status:<platform>`     | `{ connectedAt?, handle?, url?, lastSyncAt?, lastError?, tokenExpiresAt? }` (never tokens)                                                                                                                            |
| `snap:<platform>:<day>` | one `SocialSnapshotInput`; also stored as the key's metadata so a `list` returns rows without a `get`. At most 400 days per platform (older ones are deleted).                                                        |
| `posts:<platform>`      | `{ [postId]: SocialPostStatInput }`, one document per platform merged on every sync (newest 500 kept). Kept in one key rather than `post:<p>:<id>` so a sync costs a handful of writes, not hundreds.                 |
| `demo:<platform>:<day>` | `Demographic[]` of that day                                                                                                                                                                                           |
| `state:<nonce>`         | `{ platform, returnTo, createdAt, verifier?, publish?, replies? }`, 10-minute TTL, deleted when the callback uses it                                                                                                            |
| `publish:jobs`          | `{ [jobId]: PublishJob }`: the auto-post queue in one document (an idle cron tick is one read, no write). Finished jobs are dropped after 30 days; at most 200 jobs.                                                  |
| `replies:doc`           | `AutomationsDoc`: the owner's auto-reply automations; written only by `POST`/`DELETE /social/replies`.                                                                                                        |
| `replies:state`         | `PollState`: answered comments (7 days), counters, the last 50 log entries, watched posts' comment counts, the poll lock; written only by the poll, and only when something changed.                          |
| `replies:clicks`        | `ClicksDoc`: taps on the `/go` links with the daily cap; written only by `GET /go/:id/:n`.                                                                                                                    |

## Auto-posting

Code: `src/social/publish.ts` (queue, routes, runner), `src/social/publishers.ts` (one step function per
platform), `src/social/cron.ts` (the five-minute tick). Owner steps and platform limits:
`planning/tools/07-auto-posting.md`.

**Permission.** `POST /social/connect/:platform` with `"publish": true` also asks for the posting scopes
(`instagram_business_content_publish`, `threads_content_publish`, `youtube.upload`, TikTok `video.publish` +
`video.upload`). The callback stores `canPublish: true` with the token, and `GET /social/status` reports it. Without
it a target fails as `no_permission`. The analytics connect keeps asking for the read scopes only.

| Route                          | Request                                               | Response                                                                                                                  |
| ------------------------------ | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `GET /social/publish`          |                                                       | `{ jobs: PublishJob[] }` sorted by `scheduledAt`                                                                          |
| `POST /social/publish`         | `{ id, scheduledAt, media?: { url, kind }, targets }` | `{ job }`. Adds or replaces the job; platforms already `processing`/`published` keep their state. `400 { error, detail }` |
| `POST /social/publish/:id/run` |                                                       | `{ job }` after publishing what can go now (moves `scheduledAt` to now). `404` for an unknown id                          |
| `DELETE /social/publish/:id`   |                                                       | `{ ok: true }` (what is already out stays out)                                                                            |

`targets` is `{ "<platform>": { caption, title?, privacy?, tiktokMode? } }`: `title` and `privacy`
(`public|unlisted|private`) for YouTube; `privacy` (`PUBLIC_TO_EVERYONE|…|SELF_ONLY`) and `tiktokMode`
(`direct|inbox`) for TikTok. Validation: `id` is `[A-Za-z0-9_-]{1,100}`; `media.url` must be https;
Instagram needs an image or a video, YouTube and TikTok a video, and Threads also takes text alone. Captions are
limited to 2,200 (Instagram, TikTok), 500 (Threads) and 5,000 (YouTube description) characters. `detail` names
the field (`instagram.media`, `threads.caption`, …).

Each target is `{ …spec, state: queued|processing|published|failed, attempts, containerId?, startedAt?, nextAt?,
postId?, permalink?, publishedAt?, inbox?, error?, detail? }`. Error codes: `not_connected`, `no_permission`,
`token_expired`, `media_unreachable` (the link answered with an error or an HTML page), `media_too_large`,
`private_account` (TikTok before its audit: the TikTok account itself must be private),
`rejected` (the platform refused; `detail` has its words, plus TikTok's error code in brackets), `rate_limited`,
`upstream`, `timeout` (still processing after 2 h). `upstream` and `rate_limited` are retried up to 4 times, 5/10/15 minutes apart.

**Steps per tick.** Instagram and Threads create a container (Instagram first reads its professional account id,
`user_id` of `GET /me`: the id the token exchange returns is app-scoped and `/media` refuses it). Images and text are checked and published in the
same run (a container that still says `IN_PROGRESS` is read once more after a 4 s pause; the first live Threads
post needed that), videos on the next tick once `FINISHED`. YouTube opens a resumable session and **streams** the file
from the media URL into it (no buffering). TikTok reads `creator_info` (Direct Post: an unaudited app only
gets `SELF_ONLY`) and uploads with `FILE_UPLOAD`: one chunk up to 64 MB, 64 MB chunks with Range GETs above
that. The status is polled on the next ticks (`SEND_TO_USER_INBOX` for the inbox mode). A run has 34 outbound
calls (`PUBLISH_BUDGET`, the rest of the 50 subrequests go to KV). It claims its jobs (`lockUntil`, 10 min)
before any platform call, so the cron and "run" never publish the same job twice.

## Auto-replies

Code: `src/social/replies.ts` (documents, matcher, poller, routes, `/go`), wired in `cron.ts` (polls on publish
ticks that moved nothing) and `scout.ts` (`/go`). Product spec and owner steps: `planning/tools/10-auto-replies.md`.
A copy of Beacons' Smart Reply: when someone comments a keyword on one of the owner's Instagram posts, the
Worker sends the commenter a private DM with the link and replies under the comment. Instagram only (Threads
and YouTube have no DMs in their APIs; TikTok has no comment API).

**Permission.** `POST /social/connect/instagram` with `"replies": true` asks for
`instagram_business_manage_comments` + `instagram_business_manage_messages` on top of the posting scopes. The
callback sets `canReply` from the permissions Instagram reports as granted (the owner can untick one in Meta's
dialog) and `GET /social/status` reports it. Without it the poll is skipped with `lastError: "no_permission"`.
Note: under Standard Access (Development mode) Instagram delivers private replies only to accounts with a role
on the Meta app; DMs to everyone need App Review for `instagram_business_manage_messages`
(`planning/tools/10-auto-replies.md`).

**Detection is polling, not webhooks**: Meta sends comment webhooks only to apps that are Live with Advanced
Access. So on every five-minute tick where the publish queue moved nothing, the Worker lists the newest
`WATCH_ANY_MAX` (5) posts (for "any post" automations) plus up to `WATCH_SPECIFIC_MAX` (3) specific posts (a post
that cannot be looked up is noted on its automations and skipped), reads the comments of those whose
`comments_count` changed (all of them once an hour, or on "Check now"; a post whose read failed is read again
next tick), skips its own comments, comments older than 7 days, comments from before the automation was
switched on and comments already answered, matches the rest (specific-post automations before "any post"),
takes a short lock (`POLL_LOCK_MS`, 4 min) so the cron and "Check now" never answer the same comment, and
answers at most `REPLY_CAP` (8) a tick, oldest first. A post with matching comments left over (cap, budget,
stop) is read again next tick.

**Order per comment.** First the private reply, `POST /{ig-user-id}/messages { recipient: { comment_id },
message: { text } }` (one per comment, text only, within 7 days; buttons go out as `title: <origin>/go/<id>/<n>`
lines). Only once it went out, the public reply `POST /{comment-id}/replies` (optional; it says "sent it to you
privately", so it never goes out without the DM, and a failed public reply is logged once, never retried).
Budget: `REPLIES_FETCH_BUDGET` (30) outbound calls, so a tick stays inside the 50 subrequests with its KV reads.

**Storage, one document per writer** (KV is last-write-wins, so no path ever rewrites another's data):
`replies:doc` = the owner's automations (dashboard routes), `replies:state` = answered comments, counters, log,
lock (the poll only), `replies:clicks` = taps on `/go` links (`/go` only). Reads merge the three; an idle tick
writes nothing.

| Route                          | Request                                                                                                   | Response                                                                                        |
| ------------------------------ | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `GET /social/replies`          |                                                                                                           | `{ automations (with stats), log, origin?, igUserId?, lastPollAt?, lastError? }`                |
| `POST /social/replies`         | `{ id, enabled?, postId?, permalink?, title?, thumbUrl?, keywords, match?, publicReply?, dmText, buttons? }` | `{ automation }` (with its counters); `400 { error, detail }`                                   |
| `POST /social/replies/poll`    |                                                                                                           | `{ result: { checked, sent, failed, skipped?, error?, detail? }, …the GET shape }`              |
| `DELETE /social/replies/:id`   |                                                                                                           | `{ ok: true }` (its counters go with the next poll)                                             |

Validation: `id` is `[A-Za-z0-9_-]{1,100}` (not `poll`); `postId` is `[0-9A-Za-z_-]{1,64}`, or null/omitted for any
post; `permalink` (≤ 300), `title` (≤ 120) and `thumbUrl` (https) are display only; 1–10 keywords of ≤ 40
characters; `match` is `contains` (default) or `exact`; `dmText` 1–1,000 characters; `publicReply` ≤ 2,200
(`{username}` becomes `@handle`); ≤ 3 buttons `{ title ≤ 20, url https }`. Matching ignores case, Arabic
diacritics and tatweel, alef/yaa variants, punctuation and emoji.

Error codes (`lastError`, the log's `error`, an automation's `stats.lastError`): `not_connected`,
`no_permission` (app-level: Meta code 10 with no subcode or an app subcode; the tick stops, the comment is given
up on after 3 such tries), `token_expired`, `rate_limited` (the tick stops, the comment waits), `rejected`
(Instagram refused this comment or recipient; the words in `detail`), `upstream` (retried on later reads, given
up after 3), `not_eligible` (Instagram takes no private reply to this comment: code 100/2534025, or code 10
with a messaging-window subcode). `skipped` on the poll result: `none`, `not_connected`, `no_permission`,
`token_expired`, `locked`. Clicks: `GET /go/:id/:n` redirects only to an owner-saved https link, counts one tap
per visitor per link per minute (Cache API) and at most `CLICK_WRITES_PER_DAY` (200) a day, and always redirects.

## Trend Radar

Code: `src/trends/` (`run.ts` the job and the source registry, `routes.ts` HTTP, `kv.ts` the keys, one module
per source, `normalize.ts` ids / scores / merge, `types.ts` the hand-copied `TrendItem` / `TrendsFeed` of
`lib/domain.ts`). Design, search log and the honesty rule: `planning/tools/08-trends.md`.

**Honesty rule.** Only Google Trends and the YouTube charts are real popularity rankings; every row carries
its `source` label and the dashboard never calls a chart or a scan "trending".

| Route              | Request                                                     | Response                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------ | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /trends`      |                                                             | `{ items: TrendItem[], fetchedAt, degraded, sources: [{ name, ok, at?, error? }] }` — `trends:latest`, or `{ items: [], fetchedAt: null, degraded: true, sources: [] }` (200) when nothing ran yet; `502 { error: "upstream" }` when KV fails                                                                                                                                                                                                                                                                                                                                     |
| `POST /trends/run` | `{ "kinds"?: ["fast", "daily", "weekly"], "force"?: true }` | Runs every enabled source of those kinds now (default `["fast"]`, what the dashboard's refresh button sends) and answers the new feed. The weekly Tavily scan runs once per ISO week (KV `trends:tavily:<week>`; a second run answers `ok` with the note "already scanned this week") unless `force: true`. A body that is not `{ kinds?, force? }` answers `400 { error: "bad_request", detail: "body" }`. A KV failure inside the run answers the computed feed, `degraded`, with a `kv` status; a failure outside it answers `502 { error: "upstream" }` with the CORS headers |

`TrendItem` is `{ id, platform: google|youtube|tiktok|instagram|threads|x|event, region: SA|US|global,
lang: ar|en|mixed, title, url?, thumb?, score? (0..100, rank 1 = 100 within its source), growthPct?, volume?,
source, why?, seenAt, expiresAt?, tags, skillHint?, genre? }`; `id` is `<platform>:<region>:<slug>` and stays
the same across runs (the dashboard's dismissed list keys on it). `lang` follows the region (SA rows `ar`, US
rows `en`), except hashtags / scan hits (by their script) and events (`mixed`). `genre` is an edit-genre id of
`planning/data/genres.json` (`cars`, `food`, `anime`…), set only on the rows the daily keyword search found
through a genre's query; the dashboard names it on the radar's rows and lists those rows in Discover. The daily keyword search scores its rows per
language (rank 1 = 100 among its Arabic rows and among its English rows).

### Sources, slots and budgets

| Source (`TREND_SOURCES` key → label) | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | When (UTC)                                                      | Calls per run                             |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------- |
| `google` → **Google Trends**         | "Trending now" SA + US, 24 h: the `batchexecute` RPC (`i0OFE`, volume, growth %, related queries → `tags`) enriched by the RSS feed (first headline → `why`, its link → `url`, picture → `thumb`). RSS alone when the RPC fails (`degraded`). Top 25 per region                                                                                                                                                                                                      | fast: 00:05, 06:05, 12:05, 18:05                                | 4                                         |
| `youtube` → **YouTube charts**       | `videos.list chart=mostPopular` SA + US, all categories and How-to & Style (26), 25 each; `≤ 180 s` → tag `short`; `volume` = views, `why` = channel. Since July 2025 this is the Music / Movies / Gaming chart, hence "charts"                                                                                                                                                                                                                                      | fast                                                            | 4 (4 quota units)                         |
| `youtube` → **YouTube search**       | `search.list order=viewCount publishedAfter=7d videoDuration=short` for the niche keywords `TREND_KEYWORDS_AR` (SA, `ar`) and `TREND_KEYWORDS_EN` (US, `en`) and for the main query of every edit genre, interleaved and rotated by UTC day, then one `videos.list`; `tags` = the keyword, `genre` = the genre's id. **Hard cap 18 `search.list` calls per run and per UTC day** (KV `trends:ytsearch:<day>`). See [the daily keyword scan](#the-daily-keyword-scan) | daily: 21:05 (00:05 Riyadh)                                     | ≤ 19 (≤ 18 of the 100 daily search calls) |
| `tavily` → **Tavily scan**           | 8 searches (4 Arabic, `country: saudi arabia`, `language: ar`; 3 English, `country: united states`; 1 against the weekly trend blogs), `time_range: week`, platform sites only; `#hashtags` and "quoted names" counted across pages (`volume` = pages), `why` = the best page's snippet, `tags: ["scan"]`, 14-day expiry                                                                                                                                             | weekly: Saturday 21:15 (00:15 Riyadh Sunday), once per ISO week | 8 (8 credits)                             |
| `events` → **3z calendar**           | `planning/data/saudi-events.json` bundled at build: every moment within 60 days (running ones score 100), `tags` = kind + hashtags, expires the Riyadh midnight after its last day                                                                                                                                                                                                                                                                                   | fast                                                            | 0                                         |
| `kworb` → **kworb.net** (off)        | TikTok trending sounds SA + US (top 30, tag `sound`, `url` a TikTok search for the sound)                                                                                                                                                                                                                                                                                                                                                                            | fast                                                            | 2                                         |
| `x` → **trends24.in** (off)          | X trends Saudi Arabia, the latest hourly snapshot (top 30, tag `hashtag`)                                                                                                                                                                                                                                                                                                                                                                                            | fast                                                            | 1                                         |

A run gets **38 outbound calls** (`RUN_BUDGET`; KV takes the rest of the 50 subrequests: one feed read, at
most two feed writes, the search counter on daily runs (one read, a reservation write and at most one refund
write) and the weekly stamp on weekly runs (one read, one write): at most eight). A fast run spends at most
11 calls, the daily run at most 19 (18 searches and the statistics call), the weekly scan 8: every cron tick
runs one kind, and a manual run of all three kinds at once uses exactly the 38. Every outbound call has a
12-second limit (body included), so a hung site fails its own source and the next one still runs. A KV
failure never wipes the feed: a failed read skips the write, a failed write answers the computed feed marked
`degraded` with a `kv` status. A source that fails keeps its previous rows and reports `ok: false`;
the feed is `degraded` when any configured source failed or only partly worked (`error` then carries the
note). A missing `YOUTUBE_API_KEY` reports `not_configured` on both YouTube sources without degrading the
feed. Other sources' rows stay until their own next run or their `expiresAt` (Google, charts, kworb 2 days;
trends24 1 day; search 7 days; scan 14 days); the feed holds at most 400 rows (`MAX_ITEMS`), sorted by score.
The cap is above what the sources hold together at their own caps (Google 50, charts 100, kworb 60, trends24
30, the Tavily scan 40, the keyword search 100 with the default lists, plus the calendar's moments), so the
cut never drops the low-scored rows a source still counts on. At 200 it dropped the keyword search's least
viewed rows, mostly the Arabic genre ones, before the next day could keep them.

### The daily keyword scan

`youtubeSearch.ts` searches two kinds of keywords, the same way (most viewed Shorts of the last 7 days, 10 per
keyword, Arabic against SA, English against US):

- the owner's **niche keywords** (`TREND_KEYWORDS_AR` / `TREND_KEYWORDS_EN`, 6 + 6 by default);
- the **edit genres** (round 31): `planning/data/genres.json` is bundled into the Worker (`genres.ts`, like
  the moments calendar) and every genre gives its main Arabic query (`queries.ar[0]`) and its main English
  one (`queries.en[0]`): 12 genres, 24 keywords. Rows a genre's query found carry `genre: "<id>"`, rows of
  a niche keyword carry none. A niche keyword that is also a genre's main query is searched once and
  tagged. The owner's own genres (Settings) live in the dashboard only and are not scanned.

The plan is the niche keywords then the genres, per language, Arabic and English interleaved: 36 keywords by
default, twice the day's cap. It therefore **rotates by UTC day**: with `dayNumber = floor(now / 86,400,000)`
the day's searches start at `(dayNumber × 18) % plan.length` and take the next 18 keywords, wrapping around,
so two days in a row search every keyword (by default one day the 12 niche keywords and the first three
genres, the next day the other nine genres) and each day has nine Arabic and nine English searches. A plan
of 18 keywords or fewer is not rotated; a longer one takes `ceil(length / 18)` days.

- The rows of the keywords that were not searched today **stay in the feed** until their keyword's next
  search (or their 7-day expiry), so the feed always holds both days; a keyword that left the plan loses
  its rows at the next run.
- The run's rows and the kept ones are ranked together by views, **each language on its own**: the Arabic
  rows get 100 down to 100 / n among the Arabic rows, the English rows among the English ones (rank 1 = 100
  in each). English Shorts have far more views, so one ranking for both left the Arabic rows the low scores.
- The one `videos.list` takes 50 ids. They are taken in turns from the day's keywords (each keyword's most
  viewed first), so a run brings two or three videos per keyword, at most 50 new rows.
- The cap: 18 of the 100 `search.list` calls a day, 82 stay for Discover's own YouTube search. The counter
  is reserved before the first search; a second daily run on the same UTC day answers "daily cap reached".
- Changing the genres means editing `planning/data/genres.json` and deploying the Worker again (the
  dashboard bundles the same file, so both change together).

**Enabling kworb / trends24.** Both are third-party aggregators (the owner's question 3 in
`planning/handovers/mastermind-2026-09-28.md`); once he agrees, add them to the `TREND_SOURCES` var in
`wrangler.jsonc` (`"google,youtube,tavily,events,kworb,x"`) and redeploy. Anything not listed there never
runs and its old rows leave the feed at the next run.

Google Trends and kworb were verified from a residential IP only. If Cloudflare's egress IPs get 429s the
source reports `ok: false`, the last good copy stays (`trends:prev` too), and the fallback is an owner-run
GitHub Action (see `08-trends.md`).

### Storage (KV binding `SOCIAL_KV`)

| Key                     | Value                                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------- |
| `trends:latest`         | the `TrendsFeed` `GET /trends` serves (one document, one write per run)                                       |
| `trends:prev`           | the previous feed, copied before a run in which at least one source succeeded                                 |
| `trends:ytsearch:<day>` | `search.list` calls reserved on that UTC day (the 18-a-day cap, best-effort when two runs overlap), 2-day TTL |
| `trends:tavily:<week>`  | written after a successful weekly scan of that ISO week (e.g. `2026-W40`), 8-day TTL                          |

## Claude connector (MCP)

Part B of `planning/tools/13-discover-search-v2.md` (round 33): Claude (web, desktop, phone) researches with the
Discover pipeline and saves what it picked into the dashboard. Code: `src/discover/mcp.ts` (the MCP server),
`src/discover/auth.ts` (the login page), `src/discover/tools.ts` (the tools as plain functions, and `toolCall`),
`src/index.ts` (the OAuth wiring).

**Endpoint**: `https://3z-scout.<sub>.workers.dev/mcp` (today `https://3z-scout.3zmd95.workers.dev/mcp`),
Streamable HTTP, stateless: the Agents SDK's `createMcpHandler` builds a new MCP server per request, no Durable
Objects. Only the connector's own paths (`/mcp`, `/mcp/*`, `/authorize`, `/token`, `/register`,
`/.well-known/oauth-*`) go through `@cloudflare/workers-oauth-provider`: it guards `/mcp` (OAuth access token, 1 hour;
refresh token, 30 days) and serves `/token` and the `.well-known` documents (`oauth-authorization-server`,
`oauth-protected-resource/mcp`); `/authorize` is our login page. Every other route goes straight to `handle()` exactly
as before and never loads the provider, the Agents or MCP SDKs or zod (the Free plan allows 10 ms of CPU a request,
and a provider failure can't reach the dashboard routes); the cron is untouched. Without `OAUTH_KV` or `MCP_RESOURCE`
only `handle()` runs. On `/mcp` a browser `Origin` other than `claude.ai` / `claude.com` is refused.

**Registration** (`POST /register`, answered in `src/index.ts` before the provider sees it) writes nothing in steady
state: anyone may call it, and the Free plan's 1,000 KV writes a day are shared with the auto-post queue and the
social sync. A request whose `redirect_uris` are all Claude's callbacks gets `201` with the one shared public client
(RFC 7591 §3.2.1 lets many instances share a client id): `client_id`, `client_name: "Claude"`, both callbacks,
`token_endpoint_auth_method: "none"` (even when a confidential method was asked for), `authorization_code` +
`refresh_token`, `code`. It is created once through the provider's `createClient` (no expiry), its id kept under the
OAUTH_KV key `mcp:claude-client`, and re-created only if it is gone; every later registration only reads. Anything else
(not JSON, no `redirect_uris`, any other redirect) gets `400 { "error": "invalid_redirect_uri" }` with no read or write.
A new login replaces the owner's earlier grant for this client. Possible later step: Client ID Metadata Documents
(Claude's `client_id` as a URL), off for now because their fetch from a Worker is unverified.

**Login**: `/authorize` is one page, Arabic and English, asking for the Scout token (dashboard → Settings → API keys →
👁). The right token completes the authorization for the user `owner` and sends the browser back to Claude with a
code; a wrong one shows the form again (403). Only Claude's callbacks, `https://claude.ai/api/mcp/auth_callback` and
`https://claude.com/api/mcp/auth_callback`, are accepted as `redirect_uri`, before the form shows: dynamic
registration lets anyone register a client. Above the form: "كمّل بس إذا انت للتو ضغطت Connect في Claude حقّك · Only
continue if you just pressed Connect in your own Claude". If the grant can't be stored (KV down or out of writes) the
page answers `503` instead of a raw error. The page is never framed (`X-Frame-Options: DENY`) or cached, and its CSP
lets the form post only to the Worker and be redirected only to Claude's two hosts (Chrome applies `form-action` to
that redirect too).

**Tools** (zod input schemas; every answer is JSON text, web titles and snippets in it are data, clipped):

| Tool            | Input                                                                                                                                                                         | Description (what Claude reads)                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `search_videos` | `topic` (1–200 chars); optional `queries` (≤ 9 of `{ q, platform: tiktok\|instagram\|youtube, lang: ar\|en, intent: examples\|tutorials }`), `platforms` (1–3, duplicates ignored), `timeRange` (`week\|month\|year`), `exact` | Search TikTok, Instagram and YouTube for video-editing examples and tutorials, in Arabic and English. Give a topic (an editing effect or style, e.g. 'flash transition'); optionally your own queries (up to 9, each with platform, lang ar\|en and intent examples\|tutorials). Returns posts with section, numbers when known, creators, and lookupsLeftToday. Each new search costs about 6 lookups; repeats are free for 6 hours. |
| `get_trends`    | optional `region` (`SA\|US`), `genre` (≤ 40 chars), `limit` (1–50)                                                                                                            | Read the owner's Trend Radar: what is trending now in Saudi Arabia (SA, Arabic) and the US (English) from Google Trends, YouTube charts and searches, and the Saudi moments calendar. Optional genre id (cars, food, anime, travel, football, coffee, perfume, camping, fashion, gaming, weddings, gym). Free.                                                                                                     |
| `save_picks`    | `topic` (1–100 chars), `items` (1–20 of `{ url, title, handle?, label: example\|tutorial, note? }`), optional `replace`                                                        | Save the posts you picked for a topic into the owner's dashboard (Discover → ⭐ Claude's picks). Each item is one TikTok / Instagram / YouTube post URL with its title, label example\|tutorial and an optional short note on why it is worth studying. replace=true replaces the topic's earlier picks. Up to 20 per topic.                                                                                      |
| `get_picks`     | optional `topic` (≤ 100 chars)                                                                                                                                                | Read the picks saved before, newest topic first; give a topic for that topic only.                                                                                                                                                                                                                                                                                                                              |

No tool posts, deletes or touches the social accounts; the only write is the owner's picks list.

**Daily cap**: Tavily lookups through the connector are counted per Riyadh day (KV `discover:mcp:<day>`) against
`MCP_DAILY_LOOKUPS` (default 60). Past it `search_videos` answers `{ error: "daily_limit", message }` ("resets at
midnight Riyadh time") and only a kept 6-hour answer is still served, for free. `GET /discover/usage` reports the count.

**Errors and logs**: tools answer readable errors (`bad_topic`, `daily_limit`, `unavailable`). A tool that throws
(KV down, a picks document that can't be read) answers `{ error: "failed", message }` with `isError: true`, never
the raw message. Every tool call logs one JSON line to Workers observability:
`{ mcp, topic?, ms, error?, cause?, cached?, lookups?, count? }` (`topic` clipped to 100 characters, `cause` = a
thrown error's name such as `TypeError`, `lookups` = lookups left today, `count` = cards, rows, topics or saved picks);
never URLs, items, tokens or an error's message. Arguments that don't match a tool's schema, and unknown tools, are
answered by the MCP SDK itself and are not logged.

**Config**: KV binding `OAUTH_KV` (clients, grants and tokens; the provider needs this exact name; created by the
deploy workflow like `SOCIAL_KV`) and the var `MCP_RESOURCE`, the `/mcp` address as Claude sees it (the
protected-resource metadata must equal it): `https://3z-scout.3zmd95.workers.dev/mcp` in `wrangler.jsonc`, and for
local dev `MCP_RESOURCE=http://localhost:8787/mcp` in `.dev.vars` (restart `pnpm worker:dev` after changing it).

**Owner's steps**, once deployed: in Claude, **Customize → Connectors → Add custom connector**, paste
`https://3z-scout.3zmd95.workers.dev/mcp`, then log in with the Scout token on the page that opens.

**Smoke test** (`scripts/mcp-smoke.mjs`): checks that an anonymous `/mcp` call gets 401, registers twice (the same
shared client both times; a non-Claude redirect gets 400), logs in (a wrong token refused, the right one redirected to
Claude with a code), swaps the code for a token (PKCE S256), then runs MCP `initialize`, `tools/list` and a
`get_picks` call. Run it against `wrangler dev` only: its login replaces the owner's grant, so against the deployed
Worker it would sign Claude out. The token comes from the environment, never the command line:

```sh
pnpm worker:dev   # in one terminal; .dev.vars holds SCOUT_TOKEN and MCP_RESOURCE
SCOUT_TOKEN="$(grep '^SCOUT_TOKEN=' workers/scout/.dev.vars | cut -d= -f2)" \
  node workers/scout/scripts/mcp-smoke.mjs http://localhost:8787
# every line "ok …", ending "connector smoke test passed"
```

## Configuration

| Name                                        | Kind                    | Where                                                                                                                                                                                                                                                                    |
| ------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `TAVILY_API_KEY`                            | Worker secret           | From the `TAVILY_API_KEY` repository secret (set by the deploy workflow). Also the weekly trend scan.                                                                                                                                                                    |
| `YOUTUBE_API_KEY`                           | Worker secret           | From the `YOUTUBE_API_KEY` repository secret: a Google Cloud API key restricted to the YouTube Data API v3 (steps in `planning/tools/08-trends.md`). Without it the radar's YouTube sources report `not_configured` and `/search` answers YouTube cards without `stats`. |
| `TREND_SOURCES`                             | Var (`wrangler.jsonc`)  | Comma list of the radar's sources. Default `google,youtube,tavily,events`; add `kworb` / `x` once the owner agrees.                                                                                                                                                      |
| `TREND_KEYWORDS_AR`, `TREND_KEYWORDS_EN`    | Vars (`wrangler.jsonc`) | Comma lists of the owner's niche keywords for the daily YouTube search (defaults = `lib/trends.ts` `DEFAULT_TREND_KEYWORDS`). The edit genres it also searches come from `planning/data/genres.json`, not from a var.                                                    |
| `DISCOVER_YT_CAP`                           | Var (`wrangler.jsonc`)  | YouTube `search.list` calls `POST /discover` and the Claude connector may spend a UTC day (the Trend Radar keeps its own 18). Default 70; blank means the default.                                                                                                       |
| `MCP_DAILY_LOOKUPS`                         | Var (`wrangler.jsonc`)  | Tavily lookups the Claude connector (Part B of `planning/tools/13-discover-search-v2.md`) may spend a Riyadh day; `GET /discover/usage` reports it. Default 60; blank means the default.                                                                                 |
| `SCOUT_TOKEN`                               | Worker secret           | From the `SCOUT_TOKEN` repository secret. Any long random string, e.g. `openssl rand -hex 24`. Also the key material for the stored social tokens.                                                                                                                       |
| `META_APP_ID`, `META_APP_SECRET`            | Worker secrets          | Meta app (Instagram API with Instagram Login + Threads API). Repository secrets of the same names.                                                                                                                                                                       |
| `THREADS_APP_ID`, `THREADS_APP_SECRET`      | Worker secrets          | The Meta app's Threads use case → Settings "Threads app ID" / secret (differs from the Instagram pair). Falls back to `META_*` when unset.                                                                                                                               |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`  | Worker secrets          | Google Cloud OAuth client (YouTube Data + Analytics). Repository secrets of the same names.                                                                                                                                                                              |
| `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` | Worker secrets          | TikTok developer app (Login Kit + Display API). Repository secrets of the same names.                                                                                                                                                                                    |
| `ALLOWED_ORIGINS`                           | Var (`wrangler.jsonc`)  | Comma list. Default `http://localhost:3000,https://3zmd95-glitch.github.io`. Also the origins `returnTo` may point at.                                                                                                                                                   |
| `SOCIAL_KV`                                 | KV binding              | Namespace `3z-scout-SOCIAL_KV`, created by the deploy workflow; `wrangler.jsonc` keeps a placeholder id that the workflow swaps in before deploying.                                                                                                                     |
| `OAUTH_KV`                                  | KV binding              | The Claude connector's OAuth clients, grants and tokens, and the shared client's id (`mcp:claude-client`). Namespace titled exactly `3z-scout-OAUTH_KV` (only that title is adopted), created and swapped in by the deploy workflow; its own placeholder id `1111…` keeps it apart from `SOCIAL_KV` in local dev. |
| `MCP_RESOURCE`                              | Var (`wrangler.jsonc`)  | The connector's `/mcp` address as Claude sees it (`https://3z-scout.3zmd95.workers.dev/mcp`); locally `http://localhost:8787/mcp` in `.dev.vars`. Unset: no connector, only the dashboard routes.                                                                       |

A platform whose two secrets are not both set shows `configured: false` and its connect button stays disabled in
the dashboard; nothing else breaks. The exact app-creation steps, scopes and redirect URIs per platform are in
`planning/tools/06-social-analytics-apis.md`.

## Deploy (GitHub Actions)

1. Create free accounts at [tavily.com](https://app.tavily.com) (copy the API key) and
   [cloudflare.com](https://dash.cloudflare.com) (no card needed).
2. In Cloudflare: **My Profile → API Tokens → Create Token → "Edit Cloudflare Workers"** template. Add the
   **Workers KV Storage: Edit** permission to it (the workflow creates the `SOCIAL_KV` and `OAUTH_KV` namespaces). Copy the
   token, and copy your **Account ID** from the Workers & Pages overview.
3. In GitHub: **Settings → Secrets and variables → Actions → New repository secret**, add:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
   - `TAVILY_API_KEY`
   - `SCOUT_TOKEN` (the random string you'll also paste into the dashboard)
   - later, per platform: `META_APP_ID` + `META_APP_SECRET`, `THREADS_APP_ID` + `THREADS_APP_SECRET`, `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET`,
     `TIKTOK_CLIENT_KEY` + `TIKTOK_CLIENT_SECRET`
   - for the Trend Radar's YouTube sources: `YOUTUBE_API_KEY`
4. Run **Actions → Deploy Scout Worker → Run workflow** (it also runs on every push to `main` that touches
   `workers/scout/**`). Without the Cloudflare secrets the run stays green and just prints a notice.
5. The Worker URL is `https://3z-scout.<account-subdomain>.workers.dev`; the subdomain is shown in Cloudflare
   under **Workers & Pages → Overview** (and at the end of the deploy log). The OAuth redirect URIs to register
   in each developer app are `<Worker URL>/oauth/instagram/callback`, `/oauth/threads/callback`,
   `/oauth/youtube/callback`, `/oauth/tiktok/callback`.
6. In the dashboard: **Settings → API keys** → paste the Worker URL and the Scout token → **Test**.

## Local development

```sh
cd workers/scout
printf 'SCOUT_TOKEN=dev-token\nTAVILY_API_KEY=tvly-...\n' > .dev.vars   # git-ignored; add META_APP_ID=… etc. to try OAuth
pnpm dev                 # wrangler dev → http://localhost:8787 (SOCIAL_KV is simulated locally)
curl -H 'Authorization: Bearer dev-token' http://localhost:8787/health
pnpm test                # Vitest, mocked fetch + in-memory KV (also runs from the repo root with `pnpm test`)
```

OAuth against `wrangler dev` needs a public https redirect URI; providers refuse `http://localhost:8787`, so
test the connect flow against the deployed Worker (the callback code strips nothing else).

From the repo root: `pnpm worker:dev`, `pnpm worker:test`, `pnpm worker:deploy` (needs `wrangler login` or the
two Cloudflare env vars).
