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

Create three developer apps and paste back only the **client IDs** (never secrets or tokens into chat):

| App | Where | Enable | Scopes | Notes |
|---|---|---|---|---|
| Meta app (Instagram + Threads) | developers.facebook.com → My Apps → Create app (Business) → add products **Instagram** and **Threads** | Instagram API with Instagram Login; Threads API | `instagram_business_basic`, `instagram_business_manage_insights`, `threads_basic`, `threads_manage_insights` | Add @3z.prod as an Instagram tester and accept in the Instagram app; Standard Access is enough for his own account, no App Review. Reconnect Instagram in Beacons too so numbers compare. |
| Google Cloud project | console.cloud.google.com → New project "3z Prod" → APIs & Services | **YouTube Data API v3**, **YouTube Analytics API**; OAuth consent screen (External, Testing, add his Google account as a test user); OAuth client (Web) | `youtube.readonly`, `yt-analytics.readonly` | Testing mode refresh tokens expire every 7 days: publish the consent screen to Production (click through the unverified-app warning once) or re-consent weekly. |
| TikTok developer app | developers.tiktok.com → Manage apps → Create | **Login Kit**, **Display API** (sandbox first) | `user.info.basic`, `user.info.profile`, `user.info.stats`, `video.list` | Sandbox works with his own account; TikTok review before non-sandbox. No demographics scope: keep the monthly manual entry from TikTok Studio → Analytics → Followers. |

Redirect URI for all three: the Scout Worker URL + `/oauth/<platform>/callback` (the Worker is already deployed from this repo).

## Phase 1 · daily snapshot job (needs Phase 0)

Lives in `workers/scout/` (Cloudflare Worker, free plan): `GET /oauth/<platform>/start` + `/callback` store the refresh tokens as Worker
secrets / KV (never in the app), a **daily cron** pulls the endpoints listed in the handover, computes the handover's metrics, and writes
`platform_daily`, `posts` and `demographics` rows to Supabase (Sprint 3) or, until then, serves them from KV to the app (`GET /social/snapshots`
with the owner token, same pattern as `/search`). The app's `importSnapshots` / `importPostStats` / `importDemographics` are the single write path,
so the manual CSV route and the API route land in the same tables.

## Acceptance (from the handover)

With Instagram reconnected: followers TikTok 1.2k · Instagram 272 · YouTube 6 · Threads 0; TikTok engagement within ~1 point of 7.8 %;
Saudi Arabia first on both demographics, 25-34 the largest age bucket.

## Optional later (only if the matching Beacons feature moves here)

Link-click analytics (own `/go/[slug]` redirect logging source / device / country), email capture into our own list, a pricing calculator
reusing the follower and view numbers, the media kit fed from our snapshots.
