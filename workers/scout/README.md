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

## Endpoints

Every request except `OPTIONS`, `GET /health`, the OAuth callback and `GET /go/:id/:n` needs `Authorization: Bearer <SCOUT_TOKEN>`.
Browsers may only call it from the origins in `ALLOWED_ORIGINS`.

| Route                   | What it does                                                                                                                                                                                                                                                                                  |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /health`           | `{ ok: true }`. With a valid token: `{ ok: true, auth: true, tavily: <key present>, social: { configured: { instagram, threads, youtube, tiktok }, kv }, trends: { youtube: <key present>, sources: [...] } }`; a wrong token → 401. Used by the Settings "Test" button and the Connect page. |
| `POST /search`          | Body `{ q, platforms: ["tt","ig","yt"], lang?, max?, timeRange?, thumbs? }` → `{ results: [{ platform, handle, title, snippet, url, thumb?, stats? }], credits: { used } }` with `stats: { views?, likes?, comments? }`. See below.                                                           |
| `GET /oembed?url=…`     | TikTok / YouTube links only → `{ title, author, thumb, url }`, cached for a day (TikTok for 6 hours: its thumbnail URLs are signed and expire).                                                                                                                                               |
| `/social/*`, `/oauth/*` | The social analytics connector, see [Social analytics](#social-analytics), the publish queue, see [Auto-posting](#auto-posting), and the auto-replies, see [Auto-replies](#auto-replies).                                                  |
| `GET /go/:id/:n`        | No bearer: counts a tap on an auto-reply DM link and answers `302` to the button's URL (`Cache-Control: no-store`). 404 for an unknown automation or button.                                                                          |
| `/trends*`              | The Trend Radar feed, see [Trend Radar](#trend-radar).                                                                                                                                                                                                                                        |

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
- **Cron**: one trigger every minute (`* * * * *`); minutes off the five-minute grid only poll the auto replies
  (see [Auto-replies](#auto-replies)). On the grid the ticks at 03:00/03:10/03:20/03:30 UTC
  (06:00–06:30 Riyadh) sync one platform each instead of publishing (`SYNC_SLOTS` in `src/social/cron.ts`),
  and the Trend Radar ticks (`TREND_SLOTS`: 00:05/06:05/12:05/18:05 UTC fast, 21:05 UTC daily, Saturday
  21:15 UTC weekly; every slot sits on the five-minute grid, a test guards it) refresh the trend feed instead. One trigger instead of many also stays inside the free
  plan's five cron triggers per account. `POST /social/sync` without `platforms` shares one budget across
  every connected platform (10 calls each with four): use it as a quick refresh, not as the daily pull.
- **KV writes**: 1,000 a day on the free plan. A sync writes about six keys (tokens when refreshed, snapshot,
  posts document, demographics, status), so manual syncs are cheap. The auto-reply poll stops itself at 600
  writes a UTC day (the write guard, see [Auto-replies](#auto-replies)).
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
| `replies:doc`           | `AutomationsDoc`: the owner's auto-reply automations, pause and default reply; written only by `POST`/`DELETE /social/replies` and `POST /social/replies/settings`.                                           |
| `replies:state`         | `PollState`: answered comments (7 days), conversation positions, the poll's own message ids and default-reply times (a day), counters, the last 50 log entries, watched posts' comment counts, the poll lock, the day's write count; written only by the poll, and only when something changed. |
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

Code: `src/social/replies.ts` (documents, the comment poll, routes, `/go`), `src/social/inbox.ts` (the DM and
story-reply poll), `src/social/replyCore.ts` (matching, building and sending a reply, Instagram's refusals), wired
in `cron.ts` (every minute, see the trigger below) and `scout.ts` (`/go`). Product spec and owner steps:
`planning/tools/10-auto-replies.md` (v1) and `planning/tools/14-auto-replies-v2.md` (v2, round 34; the Live test is
its Step 0). A copy of Beacons' Smart Reply: when someone comments a keyword on one of the owner's Instagram posts,
the Worker sends the commenter a private DM with the link and replies under the comment. Since v2 it also answers
DMs and story replies that carry a keyword, and a DM that matches no rule gets the default reply (at most once per
person per 24 hours). Instagram only (Threads and YouTube have no DMs in their APIs; TikTok has no comment API).

**Permission.** `POST /social/connect/instagram` with `"replies": true` asks for
`instagram_business_manage_comments` + `instagram_business_manage_messages` on top of the posting scopes. The
callback sets `canReply` from the permissions Instagram reports as granted (the owner can untick one in Meta's
dialog) and `GET /social/status` reports it. Without it the poll is skipped with `lastError: "no_permission"`.
Note: under Standard Access (Development mode) Instagram delivers private replies only to accounts with a role
on the Meta app. Whether a Live app reaches everyone without App Review for `instagram_business_manage_messages`
is what the Live test decides (`planning/tools/14-auto-replies-v2.md`, Step 0).

**Detection is polling, not webhooks**: Meta sends comment and message webhooks only to apps that are Live with
Advanced Access. So every minute (on the five-minute grid only on publish ticks that moved nothing), the Worker
lists the newest `WATCH_ANY_MAX` (5) posts (for "any post" automations) plus up to `WATCH_SPECIFIC_MAX` (3)
specific posts (a post that cannot be looked up is noted on its automations and skipped), reads the comments of
those whose `comments_count` changed (all of them once an hour, and on the tick after "Check now"; a post whose
read failed is read again next tick), skips its own comments, comments older than 7 days, comments from before the
automation was switched on and comments already answered, matches the rest (specific-post automations before "any
post"), takes a short lock (`POLL_LOCK_MS`, 4 min) so two overlapping polls never answer the same comment or
message, and answers at most `REPLY_CAP` (8) a tick, comments and DMs together, comments first, oldest first. A post
with matching comments left over (cap, budget, stop) is read again next tick.

**Order per comment.** First the private reply, `POST /{ig-user-id}/messages { recipient: { comment_id }, message }`
(one per comment, within 7 days): plain text, or a button template when the rule has buttons (the Send API below).
When Instagram refuses the template in a private reply (code 100, unless the subcode is 2534025 "already
answered"), it goes once more as plain text with `title: link` lines; a refused call does not use up the
comment's one private reply. Only once the DM went out, the public reply `POST /{comment-id}/replies`, one of the
rule's `publicReplies` picked at random (optional; it says "sent it to you privately", so it never goes out
without the DM, and a failed public reply is logged once, never retried). Budget: `REPLIES_FETCH_BUDGET` (30)
outbound calls (a comment takes up to three: the template, the text fallback, the public reply), so a tick stays
inside the 50 subrequests with its KV reads.

**DMs and story replies** (round 34, `inbox.ts`). When a message rule or the default reply is on, the same poll
reads the conversations in one call, `GET /{IG_ID}/conversations?platform=instagram&limit=20&fields=id,updated_time,messages.limit(5){id,created_time,from,message,story,is_unsupported}`
(`IG_ID` is `user_id` of `GET /me`, cached). Each conversation keeps its position (`convos[id].seenAt`, never more
than 24 hours back); the person's newer messages are handled oldest first: a story mention, an unsupported message
or one without text is skipped; a DM or a story reply with a keyword gets the first matching message rule (oldest
rule first); a DM (not a story reply) with a letter or digit that matches no rule gets the default reply when it is
on and the person got none in the last 24 hours. A conversation whose newest messages include one from the account
in the last 24 hours that the poll did not send (the owner chatting by hand) is left alone. The very first DM
poll only notes the time and answers nothing, and a rule (or the default reply) never answers a message from
before it was switched on. Answers go through the **Send API**, `POST /{IG_ID}/messages` with
`Authorization: Bearer`: `{ recipient: { id: <IGSID> }, message: { text } }` (1,000 UTF-8 bytes), or with
buttons the button template
`message: { attachment: { type: "template", payload: { template_type: "button", text, buttons: [{ type: "web_url", url, title }] } } }`
(text ≤ 640 characters, 1–3 buttons). Link buttons go through `<origin>/go/<id>/<n>`; «تابعني» (`followButton`)
opens `https://www.instagram.com/<username>/`. The returned `message_id` is kept a day (`sent`, with the
`recipient_id` it went to) to tell the poll's own messages from the owner's; in case Instagram's ids differ, a
message from the account created from a minute before to 2 minutes after a send to that person also counts as the
poll's.

**Trigger and write guard.** One cron trigger, `* * * * *` (`TICK_CRON` in `cron.ts`): minutes off the
five-minute grid only poll the replies; on the grid a tick keeps the five-minute schedule (a sync slot, a trend
slot, or the publish queue, then the replies when publishing moved nothing). The poll writes `replies:state` only when
something changed (at most twice: the lock, then the result) and counts every write per UTC day (`writes`): from
`WRITE_SLOW` (300) it runs on five-minute ticks only, from `WRITE_STOP` (600) it answers nothing until 00:00 UTC
(03:00 Riyadh); `GET /social/replies` then says `guard: "slow"` or `"stop"`. The free plan's 1,000 KV writes a
day are shared by the whole Worker. `paused: true` (`POST /social/replies/settings`) holds every answer; once it is
switched off, comments (up to 7 days old) and DMs (up to 24 hours old) from the pause can still get their answer,
within the usual caps.

**Deploy and rollback.** Commit `5e4d151` changed the trigger from `*/5 * * * *` to `* * * * *`. Before and
after it, the Worker runs its tick only for its own `TICK_CRON` and sends any other cron string to the daily sync
(`runScheduled`, kept for the daily triggers of older deployments). So during the first deploy a few old `*/5`
events can still arrive and run one off-schedule sync each (harmless, bounded), and rolling the Worker back past
`5e4d151` needs the trigger set back to `*/5 * * * *` too (`triggers.crons` in `wrangler.jsonc`): with
`* * * * *` the old code would run a full sync every minute.

**Storage, one document per writer** (KV is last-write-wins, so no path ever rewrites another's data):
`replies:doc` = the owner's automations, pause, default reply and "Check now" request (dashboard routes),
`replies:state` = answered comments, conversation positions, the poll's own message ids, default-reply times,
counters, log, lock and the day's write count (the poll only), `replies:clicks` = taps on `/go` links (`/go` only).
Reads merge the three; an idle tick writes nothing.

| Route                           | Request                                                                                                                                 | Response                                                                                                                                                           |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /social/replies`           |                                                                                                                                         | `{ automations (with stats), log, paused, defaultReply? (with its stats), origin?, igUserId?, ownerUsername?, lastPollAt?, lastError?, lastErrorDetail?, guard? }` |
| `POST /social/replies`          | `{ id, enabled?, trigger?, postId?, permalink?, title?, thumbUrl?, keywords, match?, publicReplies?, dmText, buttons?, followButton? }` | `{ automation }` (with its counters); `400 { error, detail }`                                                                                                      |
| `POST /social/replies/settings` | `{ paused?, defaultReply?: { enabled, text } }`                                                                                         | the GET shape; `400 { error, detail }`                                                                                                                             |
| `POST /social/replies/poll`     |                                                                                                                                         | `{ scanRequested: true, …the GET shape }`: "Check now" stamps `scanRequestedAt` in `replies:doc`; the next tick reads every watched post                           |
| `DELETE /social/replies/:id`    |                                                                                                                                         | `{ ok: true }` (its counters go with the next poll)                                                                                                                |

Validation: `id` is `[A-Za-z0-9_-]{1,100}` (not `poll`, `settings` or `default`); `trigger` is `comment` (default)
or `message` (a message rule keeps no post, no public replies and no display fields); `postId` is
`[0-9A-Za-z_-]{1,64}`, or null/omitted for any post; `permalink` (≤ 300), `title` (≤ 120) and `thumbUrl` (https)
are display only; 1–10 keywords of ≤ 40 characters; `match` is `contains` (default) or `exact`; `publicReplies`
holds up to 3 texts of ≤ 2,200 characters, blank ones dropped (`{username}` becomes `@handle`; a v1 body's single
`publicReply` still works); ≤ 3 buttons `{ title ≤ 20, url https }`, counting «تابعني» when `followButton` is
true; `dmText` with its `title: link` lines (and «تابعني» with a 30-character username) fits 1,000 UTF-8 bytes,
and ≤ 640 characters when the DM has any button. Settings: `paused` is a boolean; `defaultReply` is
`{ enabled, text }`, its text ≤ 1,000 UTF-8 bytes and required when enabled. Matching ignores case, Arabic
diacritics and tatweel, alef/yaa variants, punctuation and emoji.

Error codes (`lastError`, the log's `error`, an automation's `stats.lastError`; Instagram's words, ending with Meta's
`[code/subcode]`, are the log's `detail` and `lastErrorDetail`, which also records a failed conversations read,
e.g. "messages came without created_time/from" when Instagram ignores the `messages{…}` expansion): `not_connected`,
`no_permission` (app-level: Meta code 10 with no subcode or an app subcode; the tick stops, the comment or
message is given up on after 3 such tries), `token_expired`, `rate_limited` (the tick stops, the comment or
message waits), `rejected` (Instagram refused this comment or recipient; the words in `detail`), `upstream`
(retried on later reads, given up after 3), `not_eligible` (Instagram takes no private reply to this comment:
code 100/2534025; or code 10 with a messaging-window subcode, which for a DM means it is past the 24-hour
window). `skipped` on the poll result: `none`, `not_connected`, `no_permission`, `token_expired`, `locked`,
`paused`, `guard`. Log entries carry `kind` (`comment`, `message`, `story`, `default`) and, for DMs, `messageId`.
Clicks: `GET /go/:id/:n` redirects only to an owner-saved https link, counts one tap per visitor per link per minute
(Cache API) and at most `CLICK_WRITES_PER_DAY` (200) a day, and always redirects.

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

## Configuration

| Name                                        | Kind                    | Where                                                                                                                                                                                                                                                                    |
| ------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `TAVILY_API_KEY`                            | Worker secret           | From the `TAVILY_API_KEY` repository secret (set by the deploy workflow). Also the weekly trend scan.                                                                                                                                                                    |
| `YOUTUBE_API_KEY`                           | Worker secret           | From the `YOUTUBE_API_KEY` repository secret: a Google Cloud API key restricted to the YouTube Data API v3 (steps in `planning/tools/08-trends.md`). Without it the radar's YouTube sources report `not_configured` and `/search` answers YouTube cards without `stats`. |
| `TREND_SOURCES`                             | Var (`wrangler.jsonc`)  | Comma list of the radar's sources. Default `google,youtube,tavily,events`; add `kworb` / `x` once the owner agrees.                                                                                                                                                      |
| `TREND_KEYWORDS_AR`, `TREND_KEYWORDS_EN`    | Vars (`wrangler.jsonc`) | Comma lists of the owner's niche keywords for the daily YouTube search (defaults = `lib/trends.ts` `DEFAULT_TREND_KEYWORDS`). The edit genres it also searches come from `planning/data/genres.json`, not from a var.                                                    |
| `SCOUT_TOKEN`                               | Worker secret           | From the `SCOUT_TOKEN` repository secret. Any long random string, e.g. `openssl rand -hex 24`. Also the key material for the stored social tokens.                                                                                                                       |
| `META_APP_ID`, `META_APP_SECRET`            | Worker secrets          | Meta app (Instagram API with Instagram Login + Threads API). Repository secrets of the same names.                                                                                                                                                                       |
| `THREADS_APP_ID`, `THREADS_APP_SECRET`      | Worker secrets          | The Meta app's Threads use case → Settings "Threads app ID" / secret (differs from the Instagram pair). Falls back to `META_*` when unset.                                                                                                                               |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`  | Worker secrets          | Google Cloud OAuth client (YouTube Data + Analytics). Repository secrets of the same names.                                                                                                                                                                              |
| `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` | Worker secrets          | TikTok developer app (Login Kit + Display API). Repository secrets of the same names.                                                                                                                                                                                    |
| `ALLOWED_ORIGINS`                           | Var (`wrangler.jsonc`)  | Comma list. Default `http://localhost:3000,https://3zmd95-glitch.github.io`. Also the origins `returnTo` may point at.                                                                                                                                                   |
| `SOCIAL_KV`                                 | KV binding              | Namespace `3z-scout-SOCIAL_KV`, created by the deploy workflow; `wrangler.jsonc` keeps a placeholder id that the workflow swaps in before deploying.                                                                                                                     |

A platform whose two secrets are not both set shows `configured: false` and its connect button stays disabled in
the dashboard; nothing else breaks. The exact app-creation steps, scopes and redirect URIs per platform are in
`planning/tools/06-social-analytics-apis.md`.

## Deploy (GitHub Actions)

1. Create free accounts at [tavily.com](https://app.tavily.com) (copy the API key) and
   [cloudflare.com](https://dash.cloudflare.com) (no card needed).
2. In Cloudflare: **My Profile → API Tokens → Create Token → "Edit Cloudflare Workers"** template. Add the
   **Workers KV Storage: Edit** permission to it (the workflow creates the `SOCIAL_KV` namespace). Copy the
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
