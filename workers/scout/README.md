# 3z Scout Worker

A small Cloudflare Worker (free plan) with two jobs for the dashboard, both without exposing any key in the
browser:

1. **Scout** (build plan 1.14, master plan round 24): show **TikTok, Instagram and YouTube** videos for a topic.
   Search goes through [Tavily](https://tavily.com) (1,000 searches/month free) limited to those three sites;
   pasted TikTok/YouTube links are enriched through their public oEmbed endpoints.
2. **Social analytics connector** (planning/tools/06, Beacons rebuild): the owner connects his **Instagram,
   Threads, YouTube and TikTok** accounts once (OAuth), the Worker pulls followers, per-post numbers and audience
   demographics **every day** and serves them to the Social Analytics page in the dashboard's own schema.

## Endpoints

Every request except `OPTIONS`, `GET /health` and the OAuth callback needs `Authorization: Bearer <SCOUT_TOKEN>`.
Browsers may only call it from the origins in `ALLOWED_ORIGINS`.

| Route                   | What it does                                                                                                                                                                                                                              |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /health`           | `{ ok: true }`. With a valid token: `{ ok: true, auth: true, tavily: <key present>, social: { configured: { instagram, threads, youtube, tiktok }, kv } }`; a wrong token → 401. Used by the Settings "Test" button and the Connect page. |
| `POST /search`          | Body `{ q, platforms: ["tt","ig","yt"], lang?, max?, timeRange?, thumbs? }` → `{ results: [{ platform, handle, title, snippet, url, thumb? }], credits: { used } }`. See below.                                                           |
| `GET /oembed?url=…`     | TikTok / YouTube links only → `{ title, author, thumb, url }`, cached for a day.                                                                                                                                                          |
| `/social/*`, `/oauth/*` | The social analytics connector, see [Social analytics](#social-analytics).                                                                                                                                                                |

### `POST /search` options

- `timeRange`: `"week" | "month" | "year"`, passed to Tavily as `time_range` (only pages published in that
  window). Omit it for any time. Anything else → 400.
- `thumbs` (default `true`): thumbnails on the cards.
  - **YouTube**: always `https://i.ytimg.com/vi/<id>/hqdefault.jpg`, derived from the video id (no call).
  - **TikTok**: the first 8 TikTok results get `thumbnail_url` from TikTok's public oEmbed
    (`https://www.tiktok.com/oembed?url=…`), fetched in parallel through the same day-long cache as
    `GET /oembed`. Each call gives up after 2.5 s (AbortController); a failed or slow one just leaves that
    card without `thumb`, the search still answers. TikTok's thumbnail URLs are signed and expire after a
    few days, so the dashboard falls back to a placeholder when one stops loading.
  - **Instagram**: no `thumb`. Instagram's oEmbed needs a Meta app access token (Facebook developer app +
    review), which this Worker does not have yet; the dashboard shows a placeholder tile.
  - `thumbs: false` skips the oEmbed calls (faster, fewer subrequests).
- Errors: `{ error: "quota" | "auth" | "upstream" | "bad_request" }`.

The response shape is unchanged from v0: older dashboards that send neither option keep working (they get
thumbnails by default).

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
| `POST /social/connect/:platform`    | `{ "returnTo": "https://…/social/growth/" }`               | `{ "url": "<provider authorization url>" }`. `returnTo` must be on an `ALLOWED_ORIGINS` origin (else 400). State nonce in KV for 10 minutes; PKCE S256 for YouTube (Google) and TikTok.       |
| `GET /oauth/:platform/callback`     | `?code&state` from the provider (no bearer)                | `302` to `returnTo?connected=<platform>` or `returnTo?connect_error=<platform>&reason=<code>`. Unknown/used state → `400 { error: "state_invalid" }` (nowhere safe to redirect).              |
| `GET /social/status`                |                                                            | `{ "platforms": { "<p>": { configured, connected, handle?, url?, connectedAt?, lastSyncAt?, lastError?, tokenExpiresAt? } } }`                                                                |
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
- **Cron**: four triggers (`0/10/20/30 3 * * *` UTC = 06:00–06:30 Riyadh), one platform each
  (`CRON_PLATFORMS` in `src/social/sync.ts`). `POST /social/sync` without `platforms` shares one budget across
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
| `state:<nonce>`         | `{ platform, returnTo, createdAt, verifier? }`, 10-minute TTL, deleted when the callback uses it                                                                                                                      |

## Configuration

| Name                                        | Kind                   | Where                                                                                                                                                |
| ------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TAVILY_API_KEY`                            | Worker secret          | From the `TAVILY_API_KEY` repository secret (set by the deploy workflow).                                                                            |
| `SCOUT_TOKEN`                               | Worker secret          | From the `SCOUT_TOKEN` repository secret. Any long random string, e.g. `openssl rand -hex 24`. Also the key material for the stored social tokens.   |
| `META_APP_ID`, `META_APP_SECRET`            | Worker secrets         | Meta app (Instagram API with Instagram Login + Threads API). Repository secrets of the same names.                                                   |
| `THREADS_APP_ID`, `THREADS_APP_SECRET`      | Worker secrets         | The Meta app's Threads use case → Settings "Threads app ID" / secret (differs from the Instagram pair). Falls back to `META_*` when unset.          |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`  | Worker secrets         | Google Cloud OAuth client (YouTube Data + Analytics). Repository secrets of the same names.                                                          |
| `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` | Worker secrets         | TikTok developer app (Login Kit + Display API). Repository secrets of the same names.                                                                |
| `ALLOWED_ORIGINS`                           | Var (`wrangler.jsonc`) | Comma list. Default `http://localhost:3000,https://3zmd95-glitch.github.io`. Also the origins `returnTo` may point at.                               |
| `SOCIAL_KV`                                 | KV binding             | Namespace `3z-scout-SOCIAL_KV`, created by the deploy workflow; `wrangler.jsonc` keeps a placeholder id that the workflow swaps in before deploying. |

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
