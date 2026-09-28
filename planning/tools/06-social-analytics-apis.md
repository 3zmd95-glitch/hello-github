# 06 · Social analytics: from Beacons to our own numbers

Source: `../handovers/beacons-2026-09-27.md` (everything Beacons gives @3z.prod on Sep 27, 2026, the Social Analytics page spec, the
official APIs, the acceptance numbers). Decision (round 27): rebuild the **Social Analytics** page inside the 📱 Social world; Beacons keeps
the link-in-bio, store, media kit, Smart Reply and email broadcasts until each is asked to move.

## What ships without any API (static app, today)

- The page per the spec (`/social/growth` → "Social Analytics"): platform filter All / Instagram / YouTube / TikTok / Threads, KPI cards
  (Total followers · Avg. engagement · Avg. likes · Avg. views), platform cards, per-platform overview + demographics (gender pie, age × gender
  bars, countries / cities), Post Activity counters (90 d / month / week), My Content grid (top posts this week, per-platform post search,
  CSV export), "What changed this week?" as rule-based sentences over the last two weekly snapshots.
- Data comes from **imports**: the native CSV exports (Beacons My Content, TikTok Studio, Instagram Professional Dashboard, YouTube Studio)
  and a manual demographics entry (TikTok never exposes demographics through its API, so this stays manual anyway).
- The Sep 27, 2026 Beacons numbers are seeded as the first snapshot so the page is never empty and the acceptance test has a baseline.

## Phase 0 · the owner's part (about one hour, once)

The Worker is built (Phase 1 below); what is missing are three developer apps and their secrets. **Never paste a secret into chat**: each
one goes straight into GitHub → **Settings → Secrets and variables → Actions → New repository secret**; the deploy workflow copies it into
the Worker on the next run (Actions → Deploy Scout Worker → Run workflow). A platform whose secrets are missing simply shows "not
configured" in the dashboard.

Before the apps: note the Worker URL from Cloudflare (**Workers & Pages → 3z-scout**), e.g. `https://3z-scout.<sub>.workers.dev`. The
redirect URI of every platform is that URL + `/oauth/<platform>/callback`:

| Platform  | Redirect URI to register                                      |
| --------- | ------------------------------------------------------------- |
| Instagram | `https://3z-scout.<sub>.workers.dev/oauth/instagram/callback` |
| Threads   | `https://3z-scout.<sub>.workers.dev/oauth/threads/callback`   |
| YouTube   | `https://3z-scout.<sub>.workers.dev/oauth/youtube/callback`   |
| TikTok    | `https://3z-scout.<sub>.workers.dev/oauth/tiktok/callback`    |

Also make sure the Cloudflare API token used by the workflow has **Workers KV Storage: Edit** (the workflow creates the `3z-scout-SOCIAL_KV`
namespace on its first run; a token from the "Edit Cloudflare Workers" template needs that permission added).

### 1. Meta app (Instagram + Threads, one app)

1. [developers.facebook.com](https://developers.facebook.com) → **My Apps → Create app** → use case "Other" → type **Business** → name
   "3z Prod".
2. **Add product → Instagram** → choose **"Instagram API with Instagram Login"** (not the Facebook-Login variant). Under **API setup with
   Instagram login**:
   - **Business login settings** → **Valid OAuth redirect URIs**: the Instagram URI above. Save.
   - **Generate access tokens → Add account**: add @3z.prod (the Instagram account must be Professional: Business or Creator) and accept the
     tester invite in the Instagram app (**Settings → Apps and websites → Tester invites**).
   - Copy the **Instagram app ID** and **Instagram app secret** shown on this page (these are the ones the Worker uses, not the parent
     app's).
3. **Add product → Threads** → **Settings**: **Redirect callback URLs** = the Threads URI above; **Uninstall / Delete callback URL** can be
   the same Worker URL. Under **Roles → Roles**, add @3z.prod as a **Threads tester** and accept the invite in the Threads app (**Settings →
   Account → Website permissions → Invites**). Meta shows the Threads use case its **own** "Threads app ID" and secret (different
   from the Instagram pair), so the Worker reads **`THREADS_APP_ID`/`THREADS_APP_SECRET`** for Threads and falls back to `META_*` only
   when those are unset (decided Sep 28, 2026, after setting the app up).
4. Scopes the Worker asks for (already in code): `instagram_business_basic`, `instagram_business_manage_insights`, `threads_basic`,
   `threads_manage_insights`. **Standard Access** is enough for his own account (he is the tester); no App Review, the app can stay in
   Development mode.
5. Repository secrets: **`META_APP_ID`**, **`META_APP_SECRET`** (the **Instagram app ID**/secret from "API setup with Instagram
   login", not the parent app id), **`THREADS_APP_ID`**, **`THREADS_APP_SECRET`**.

### 2. Google Cloud project (YouTube)

1. [console.cloud.google.com](https://console.cloud.google.com) → **New project** "3z Prod".
2. **APIs & Services → Library**: enable **YouTube Data API v3** and **YouTube Analytics API**.
3. **APIs & Services → OAuth consent screen** (Google Auth Platform): **External**, app name "3z Prod", his email as support and developer
   contact. **Scopes**: add `…/auth/youtube.readonly` and `…/auth/yt-analytics.readonly`. **Test users**: add his Google account.
4. **Credentials → Create credentials → OAuth client ID** → **Web application** → **Authorized redirect URIs**: the YouTube URI above.
   Copy the **Client ID** and **Client secret**.
5. **Publishing status**: in *Testing* mode Google expires refresh tokens after 7 days (the dashboard would ask to reconnect weekly).
   Click **Publish app** (to *In production*); the read-only YouTube scopes are "sensitive", so Google shows an unverified-app warning he
   clicks through once ("Advanced → Go to 3z Prod (unsafe)"). No verification is needed for his own use.
6. Repository secrets: **`GOOGLE_CLIENT_ID`**, **`GOOGLE_CLIENT_SECRET`**.

### 3. TikTok developer app

1. [developers.tiktok.com](https://developers.tiktok.com) → **Manage apps → Connect an app** → name "3z Prod", category Analytics,
   platform **Web** with the dashboard URL `https://3zmd95-glitch.github.io`.
2. **Add products**: **Login Kit** (Redirect URI = the TikTok URI above) and **Display API**. Scopes appear automatically:
   `user.info.basic`, `user.info.profile`, `user.info.stats`, `video.list`.
3. **Sandbox**: create one, add his TikTok account as a **target user**, and use the sandbox's **Client key / Client secret** first. When
   that works, **Submit for review** the production app (TikTok wants a short description and a demo video of the login flow); after
   approval switch the two repository secrets to the production key/secret and reconnect.
4. Repository secrets: **`TIKTOK_CLIENT_KEY`**, **`TIKTOK_CLIENT_SECRET`**.
5. No scope returns audience demographics: keep the monthly manual entry from TikTok Studio → Analytics → Followers.

### 4. Connect

After the next deploy: dashboard → Social Analytics → **Connect** per platform (the Worker's `GET /health` shows which platforms are
configured). Each connect runs a first sync; the daily sync then runs at 06:00 Riyadh. "Reconnect" appears when a platform reports
`token_expired`.

## Phase 1 · daily snapshot job (built, `workers/scout/src/social/`)

Lives in the Scout Worker (Cloudflare free plan; see `workers/scout/README.md` → "Social analytics" for the full contract).

- **OAuth**: `POST /social/connect/:platform { returnTo }` → provider URL; `GET /oauth/:platform/callback` exchanges the code (long-lived
  token for Instagram/Threads, refresh token for Google and TikTok; PKCE S256 for Google and TikTok), stores the tokens **encrypted**
  (AES-256-GCM, key derived from `SCOUT_TOKEN` with HKDF-SHA-256) in the KV namespace `SOCIAL_KV`, runs a first sync and redirects back
  to the dashboard with `?connected=<platform>` or `?connect_error=<platform>&reason=<code>`.
- **Cron**: four triggers at 03:00/03:10/03:20/03:30 UTC (06:00–06:30 Riyadh), one platform each so every sync gets the free plan's full
  subrequest budget (50 per invocation, KV included; the Worker budgets 40 outbound calls per sync and stops per-post insight calls when it
  is reached — about the newest 30 posts per day for Instagram and Threads).
- **Pull per platform** (endpoints from the handover): Instagram `/me`, `/me/media`, `/me/stories`, `/{media}/insights`, `/me/insights`
  (30-day totals + `follower_demographics` when 100+ followers); Threads `/me`, `/me/threads`, `/{id}/insights`, `/me/threads_insights`;
  YouTube `channels.list`, `playlistItems.list`, `videos.list` (Shorts = ≤ 180 s) + Analytics `reports` (`creatorContentType` watch times,
  `ageGroup,gender`, `country`); TikTok `user/info` + `video/list` (≤ 100 videos). Tokens refresh by rule: Instagram/Threads once older than
  30 days, Google when the hour is up, TikTok before every sync.
- **Storage** (KV): `tokens:<p>` (encrypted), `status:<p>`, `snap:<p>:<day>` (≤ 400 days), `posts:<p>` (one document of the newest 500
  posts, merged on every sync so counts update), `demo:<p>:<day>`, `state:<nonce>` (10-minute TTL).
- **Serve**: `GET /social/data?since=YYYY-MM-DD` → `{ accounts, snapshots, postStats, demographics, syncedAt }` in the dashboard's
  `SocialSnapshotInput` / `SocialPostStatInput` / `Demographic` shapes (Riyadh day keys, `+03:00` timestamps). The Worker emits **raw
  rows**; the dashboard's `averages()` computes engagement and the averages from the post rows (≥ 5 posts) and falls back to the snapshot
  fields (`avgStoryViews`, `avgVideoWatchTime`, `avgShortsWatchTime`) that only the platforms can give. `GET /social/status`,
  `POST /social/sync`, `DELETE /social/connect/:platform` complete the contract. Supabase (Sprint 3) can later mirror the same rows.
- **Deploy**: `.github/workflows/worker.yml` creates the KV namespace idempotently (`wrangler kv namespace list` → create → id into
  `wrangler.jsonc`), deploys, and sets the six platform secrets when the repository secrets exist.

Decision record: no aggregator (Phyllo / insightIQ / Ayrshare cost a monthly fee for four accounts; the official APIs are free and Standard
Access covers the owner's own account). OAuth client libraries (`arctic`, `oauth4webapi`) were considered and not adopted: two of the four
providers are not standard (Instagram/Threads need a second call to upgrade to a long-lived token and refresh by GET, TikTok uses
`client_key`), each flow is about thirty lines, and the Worker already has WebCrypto for PKCE and AES-GCM. Rejected `post:<p>:<postId>`
per-post keys: the free plan allows 1,000 KV writes a day and counts KV operations toward the 50 subrequests, so posts live in one document
per platform.

## Acceptance (from the handover)

With Instagram reconnected: followers TikTok 1.2k · Instagram 272 · YouTube 6 · Threads 0; TikTok engagement within ~1 point of 7.8 %;
Saudi Arabia first on both demographics, 25-34 the largest age bucket.

## Optional later (only if the matching Beacons feature moves here)

Link-click analytics (own `/go/[slug]` redirect logging source / device / country), email capture into our own list, a pricing calculator
reusing the follower and view numbers, the media kit fed from our snapshots.
