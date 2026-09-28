# Auto-posting goes live — handover (round 29)

Sep 28, 2026 · `main` at `8e4d629` (PR #13 and PR #14 merged, Worker deployed). Follows `auto-posting-2026-09-28.md` (round 28).
To pick up from here, paste the prompt in the last section into a new session.

## What happened this round

1. **PR #13** (`claude/serene-carson-r84hqn`, the whole auto-posting feature) opened, rebased on a `main` that had moved
   4 commits (Threads sign-in on threads.com, YouTube/TikTok "Expired" fix), all five gates green, merged. The merge
   auto-ran **Actions → Deploy Scout Worker** (it watches `workers/scout/**`), so the `*/5` cron and `/social/publish`
   routes are live at `https://3z-scout.3zmd95.workers.dev`.
2. **Owner's one-time platform setup — done** (from the owner's Chrome):
   - Meta app **3z Prod** (`2189335038677989`): `threads_content_publish` and `instagram_business_content_publish` added,
     both "Ready for testing". The Threads OAuth actually runs on the separate Threads app `2168667987333479`
     (`THREADS_APP_ID`), which already carried the publish permission.
   - Google Cloud project **3z prod** (`z-prod-509907`): `…/auth/youtube.upload` added to the consent screen (the only
     scope listed there; the app is in Testing, so the "unverified app" warning shows on consent — press Continue).
   - TikTok app **3zProd3z Prod** (`7690463743561746450`): Production is still an empty Draft. The **Sandbox "3z Scout"**
     has Login Kit + **Content Posting API with Direct Post**, scopes `user.info.basic/profile/stats`, `video.list`,
     `video.upload`, `video.publish`, redirect `https://3z-scout.3zmd95.workers.dev/oauth/tiktok/callback`, target
     user `3z.prod`. Direct Post is `SELF_ONLY` until the audit.
3. **✍️ Allow posting** clicked for all four platforms; Settings → Connected accounts shows **"Posts by itself"** on
   TikTok, Instagram, YouTube (`@3zprod`) and Threads (`@3z.prod`).
4. **First real post** — Threads text, published by the Worker:
   <https://www.threads.com/@3z.prod/post/Dd1b3I2ihCB> ("تجربة النشر التلقائي من 3z Prod 🚀 #مونتاج").
   Live API vs. mocks: the fresh TEXT container answered `IN_PROGRESS` on the first status read, so "Post now" returned
   `processing` and the next cron tick published it ~2 min later.
5. **PR #14** (`claude/threads-publish-retry`) fixed that: the Meta step waits `FRESH_CONTAINER_WAIT_MS` (4 s, injectable
   `sleep`, no-op in tests) and reads the status once more in the same run; `STEP_MIN_BUDGET` instagram/threads 4 → 5;
   two new tests (765 total); README + `07-auto-posting.md` log. Merged, Worker redeployed. **Not yet verified live** —
   the next Threads "Post now" should finish in one call.
6. **Owner's laptop** (`C:\Users\user\hello-github`): pulled to `main` (74 commits), added to GitHub Desktop,
   `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` so the `pnpm.ps1` shim runs, `pnpm install` done.
   `pnpm dev` had not been started yet at hand-off (browser showed `ERR_CONNECTION_REFUSED` on :3000).

## Observed while testing (not bugs, but worth knowing)

- The dashboard's publish watcher (`usePublishWatcher`) polls only while the tab is **visible**. A background tab keeps
  showing "Uploading…" until it is looked at. Consider a `visibilitychange` listener that refreshes once on return.
- "Post now" on a post with no day leaves it in the **Unplanned** list with stage `scheduled`; the Produce quest bridge
  (`markPosted`) fires when the job is applied. Fine, but the calendar never shows it on a day.
- GitHub Pages copy and a local `pnpm dev` copy share **no** state (localStorage). The local copy needs the Scout URL +
  token entered in Settings before accounts appear; the accounts themselves live in the Worker's KV.
- Claude in Chrome: the TikTok developer portal page occasionally rendered at ~3× zoom in a tab and lost unsaved form
  state when the tab was closed; opening a fresh tab fixed it. Use the accessibility tree (`find`/`read_page`) there.

## What's left

1. **First video post on Instagram, YouTube and TikTok** — needs a **public MP4 link** from the owner (Dropbox or Google
   Drive "anyone with the link"; the dashboard converts share links; keep it < ~100 MB so Drive does not serve its
   virus-scan page; under 64 MB exercises TikTok's single-chunk path first). One post → 🚀 Publish → tick all three →
   Post now. Expect: Instagram REELS container → `processing` → next tick; YouTube resumable upload streamed via
   `FixedLengthStream` (never ran against the real API — watch for `media_unreachable` / size errors); TikTok
   `creator_info` → `FILE_UPLOAD` → status poll, `SELF_ONLY`. Fix whatever the live APIs answer differently.
2. **Confirm PR #14 live**: one more Threads text "Post now" should return `published` in the same call.
3. **Audits when the owner wants public results**: YouTube API audit (uploads stay private until then); TikTok app review
   (Production app still needs icon, description, ToS/privacy URLs, demo video; until then Direct Post is SELF_ONLY).
   Also the TikTok app name "3zProd3z Prod" looks like a typo — the owner may want to rename it before review.
4. Nice-to-haves from `07-auto-posting.md` → "Later": phone upload into Supabase Storage (Sprint 3); IG carousels/stories;
   TikTok photos (needs a verified media domain); first comment; queue mode; push notification on failure; Zernio for
   Snapchat. Plus the `visibilitychange` refresh above.

## Project rules to remember

- Read `CLAUDE.md` and `AGENTS.md`. Next.js 16 has breaking changes: check `node_modules/next/dist/docs/` first.
- Search before building; record finds in `planning/`.
- Hijazi Arabic first; `messages/*.ar.json` and `*.en.json` in key parity.
- Gates before any push: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm e2e`
  (cloud container: `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium`). `planner.spec.ts` was flaky once
  this round and passed on rerun.
- On the owner's laptop, do not commit or push unless he asks.

## Prompt for the next session

> Continue the auto-posting work in `3zmd95-glitch/hello-github` on `main`. Read
> `planning/handovers/auto-posting-live-2026-09-28.md` first, then `planning/tools/07-auto-posting.md` and
> `workers/scout/README.md` → "Auto-posting". Threads is live and all four platforms have publishing permission. Ask me
> for a public MP4 link, then do the first real video post to Instagram, YouTube and TikTok from one post and fix
> whatever the live APIs answer differently from the mocks. Keep to `CLAUDE.md` (search before building, Hijazi-first
> copy with ar/en key parity, all five quality gates before any push).
