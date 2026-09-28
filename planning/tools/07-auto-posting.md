# 07 · Auto-posting: write once, post everywhere (Metricool-style)

Owner, round 28: "I want in my social the ability to post everywhere automatically… like metricool.com". Built: the post popup's
**🚀 Auto-post** tab + the **🚀 Auto-posting** hub (the ⚡ Automations route) in the dashboard, and a publish queue in the Scout Worker
(`workers/scout/src/social/publish.ts`, `publishers.ts`, `cron.ts`). Posting reuses the analytics OAuth apps from `06-social-analytics-apis.md`.

## What it does

1. In the calendar, open a post → **🚀** tab → tick the networks (TikTok, Instagram, YouTube, Threads go out by themselves; X and
   Snapchat are a manual step), paste **one media link**, check the caption each network gets (the Overview caption + hashtags by default,
   editable per network), set the YouTube title/privacy and the TikTok mode/privacy.
2. **📅 Schedule auto-post** sends the job to the Worker for the post's planned day and time (Riyadh). **🚀 Post now** publishes at once.
3. A cron tick **every five minutes** publishes what is due. Instagram and TikTok process videos for a few minutes, so a network goes
   `queued → processing → published` over one or more ticks. Transient failures retry 4 times (5, 10, 15 min apart); a refusal shows the
   platform's own words.
4. The dashboard reads the results back (every minute while something runs, and on the hub's 🔄). When every network is out, the post is
   marked **posted** with the first link. That also completes the linked skill's Produce quest, with its celebration.
5. X and Snapchat: the tab gives **📋 Copy caption** and **Open X / Snapchat** (X opens its composer with the text filled in).

## Search before building (2026-09-28)

| Find | Fit | Decision |
| --- | --- | --- |
| [Metricool](https://metricool.com) | Its scheduler API is only on the Advanced plan (~$53/month) | Rejected (cost); used as the UX model |
| [Postiz](https://github.com/gitroomhq/postiz-app) (AGPL) | Self-host needs Postgres + Redis + Temporal; cloud from $29/month | Rejected: cannot run on the free Worker |
| [Mixpost](https://mixpost.app) | Laravel; IG/TikTok/YT/Threads only in Pro ($299) | Rejected |
| [Ayrshare](https://www.ayrshare.com/pricing/) / [Publer](https://publer.com) API | $149/month / Business plan only | Rejected |
| [Upload-Post](https://www.upload-post.com/) | 10 uploads/month free, then $16/month; no Snapchat | Fallback only |
| [Zernio (ex-Late)](https://zernio.com/pricing) | 2 accounts free, then $6/account; **the only API found that posts to Snapchat Public Profiles** | **Later candidate** for Snapchat (and TikTok, if its audit drags) |
| [Buffer API](https://support.buffer.com/en-us/articles/what-is-buffers-api-GtIYIQilz5) | Free plan has API access; official partner of IG/Threads/YT/TikTok/X, so no app audits; free plan limits channels and queue | **Fallback** if the YouTube/TikTok audits are refused |
| [CogSend](https://github.com/deepakness/cogsend) (MIT, Workers + D1 + R2) | Threads/X/LinkedIn/Bluesky only; R2 needs a card | Reference (same architecture), not adopted |
| Claude plugins / MCP (Postiz, Ayrshare, Post Bridge, Buffer, Metricool…) | Wrappers around the paid services | None helps a self-hosted Worker |

**Decision:** call the official APIs directly from the Scout Worker. It is free, needs no new account, uses the OAuth apps from Phase 0,
and the tokens already sit encrypted in KV. Each publisher is 40–120 lines (`publishers.ts`), with no SDK (none runs on Workers without
Node shims).

## Platform facts (the API limits the design follows)

| Network | How | Limits and gotchas |
| --- | --- | --- |
| Instagram | `instagram_business_content_publish`: container (`image_url` or `video_url` + `REELS`) → poll `status_code` → `media_publish` | Media at a **public URL**; 100 API posts per 24 h; no stories/carousels yet |
| Threads | `threads_content_publish`: container (TEXT / IMAGE / VIDEO) → poll `status` → `threads_publish` | 500 characters; 250 posts per 24 h; text alone works |
| YouTube | `youtube.upload`: resumable session → the Worker **streams** the file from the link into the upload | **Uploads stay private until the Google Cloud project passes YouTube's audit** (projects created after 2020-07-28); uploads have their own daily quota bucket |
| TikTok | Content Posting API `video.publish` (Direct Post) / `video.upload` (to inbox): `creator_info` → init `FILE_UPLOAD` → PUT chunks (streamed; > 64 MB via Range GETs) → poll status | **Until TikTok's audit, Direct Post only allows "Only me" (SELF_ONLY), and only while the TikTok account is private**. The inbox mode lands in the TikTok app to finish with sounds; 6 requests per minute per token; photo posts need a verified domain (not built) |
| X | No free tier since Feb 2026 (pay per post) | Manual: web intent `x.com/intent/post?text=` |
| Snapchat | Public Profile API is allowlist-only | Manual (or Zernio later) |

### Where the media lives

The static app has no file storage yet (Supabase Storage is Sprint 3; R2 needs a card on file). The owner pastes a **public link to the
file**. Dropbox and Google Drive share links are converted to direct links (`lib/publish.ts directMediaUrl`); the file must be shared as
"anyone with the link". A link that answers with an HTML page (e.g. Drive's virus-scan page) fails as `media_unreachable`, and the tab
says so. Later: upload straight from the phone into Supabase Storage and pass that URL.

## Owner's part (once, after the Phase 0 apps of `06-social-analytics-apis.md`)

1. **Meta app** (Instagram + Threads): add the permissions **`instagram_business_content_publish`** and **`threads_content_publish`** to
   the use cases (Standard Access is enough for the owner's own accounts, no App Review).
2. **Google Cloud** (YouTube): OAuth consent screen → **Scopes** → add `…/auth/youtube.upload`. For public uploads, submit the
   [YouTube API audit form](https://support.google.com/youtube/contact/yt_api_form) (free; until it passes, uploads are private).
3. **TikTok app**: **Add products → Content Posting API**, turn on **Direct Post**, and make sure `video.publish` and `video.upload` are
   listed. In the sandbox, add the account as a target user. For public posts, submit the app for the Direct Post audit.
4. Deploy (Actions → Deploy Scout Worker). The Worker now has **one cron trigger every five minutes** instead of four daily ones. The
   daily sync still runs at 06:00–06:30 Riyadh on those ticks.
5. Dashboard → **Settings → Connected accounts** (or the 🚀 hub) → **✍️ Allow posting** per platform. This reconnects the platform with
   the posting permission; analytics keep working as before.

## Worker contract (details in `workers/scout/README.md` → Auto-posting)

`GET /social/publish` · `POST /social/publish { id, scheduledAt, media?, targets }` · `POST /social/publish/:id/run` ·
`DELETE /social/publish/:id` · `POST /social/connect/:platform { returnTo, publish: true }`; `GET /social/status` reports `canPublish`.
The queue is one KV document (`publish:jobs`): an idle tick costs one read and no write, which fits the free plan (1,000 writes a day). A
run claims its jobs (`lockUntil`) before calling any platform, so the cron and "Post now" do not publish twice.

## First live posts (log)

- **2026-09-28 · Threads text** — first real post from the Worker: <https://www.threads.com/@3z.prod/post/Dd1b3I2ihCB>.
  Setup done the same day: `threads_content_publish` + `instagram_business_content_publish` on the Meta app (Ready for
  testing), `youtube.upload` on the Google consent screen, TikTok **Sandbox** "3z Scout" with Content Posting API +
  Direct Post (`video.upload`, `video.publish`, target user `3z.prod`). The live API differed from the mocks in one
  way: the fresh TEXT container reported `IN_PROGRESS` on the first read, so "Post now" returned `processing` and
  the next cron tick published it two minutes later. Fix: one 4 s pause and a second read in the same run
  (`FRESH_CONTAINER_WAIT_MS`). Also noted: the dashboard watcher only polls while the tab is visible, so a
  background tab keeps showing "Uploading…" until it is looked at (by design).
- **2026-09-28 · first video post (Instagram + YouTube + TikTok) and PR #14 check.** Media: a 10 s 1080×1920 H.264 test
  card (553 KB, rendered with Chrome's WebCodecs encoder, no ffmpeg) on Google Drive, "anyone with the link"; the
  converted `drive.usercontent.google.com` link answered `video/mp4` with `Content-Length` and byte ranges. The owner
  wants nothing public: YouTube `private`, TikTok `SELF_ONLY`, Instagram deleted right after.
  - **YouTube: published on the first call** (private, `ri0mGaaDOsI`). The `FixedLengthStream` streamed upload works live.
  - **Instagram: refused** at the container: "Object with ID '28828498340077430' does not exist…". That id was the
    app-scoped `user_id` of the token exchange; `/{ig-id}/media` needs the professional account id, `user_id` of
    `GET /me` (Meta: "The Instagram professional account ID, <IG_ID>"). Fix: the step reads `/me?fields=user_id`
    once per run when it creates or publishes (`STEP_MIN_BUDGET.instagram` 5 → 6). Retest after deploy.
  - **TikTok: refused** at init with only "Please review our integration guidelines…": the code is
    `unaudited_client_can_only_post_to_private_accounts`. Before the audit the **account itself** must be private,
    not only the post. Fix: new error code `private_account` with a Hijazi/English hint in the 🚀 tab; other TikTok
    refusals now keep TikTok's code in `detail`.
  - **Threads (PR #14): confirmed**: a text "Post now" came back `published` in the same call (~13 s end to end).

## Later

- Media upload from the phone (Supabase Storage, Sprint 3) instead of pasting a link.
- Instagram carousels and stories, Threads carousels, TikTok photo posts (needs domain verification of the media host).
- First comment / pinned hashtags, per-network best-time slots from real analytics, a "queue" mode (next free slot).
- Snapchat and X through Zernio if the owner wants them automatic, or Buffer as the fallback if an audit is refused.
- Push notification when a network fails (Sprint 3 Web Push).
