# Auto-posting handover (round 28)

Sep 28, 2026 · branch `claude/serene-carson-r84hqn` (commit `d0e5d1b`, pushed, **no PR opened yet**)

The owner asked: "I want in my social the ability to post everywhere automatically… like metricool.com". This round built it end to end.
To pick up from here, paste the prompt in the last section into a new session.

## State at hand-off

- The code is done and every quality gate passed on the branch: `pnpm lint`, `pnpm typecheck` (app + Worker), `pnpm test` (752 tests),
  `pnpm build` and `pnpm e2e`. The last full e2e run had 150 passing and 2 skipped. One earlier run hit two flaky failures in
  `research.spec.ts` and `scout.spec.ts`; they passed on their own and on the next full run, and they do not touch this feature.
- **Nothing has been posted to a real account.** Every test runs against mocked platforms and a fake Worker. The real platform calls
  are written from the official docs, and a research agent confirmed the details (the proxy blocked the developer sites, so it read
  search snippets and secondary guides). The first live post is also the first real test.
- Goes live only after the owner's one-time setup (below) and a Worker redeploy.

## What was built

### Dashboard (Next.js static export)

| Piece | File |
| --- | --- |
| Data model: `Post.autoPost` (networks, `mediaUrl`, `mediaKind`, per-network `captions`, YouTube title/privacy, TikTok mode/privacy, `sentAt`, per-network `results`); `SocialConnectionStatus.canPublish` | `lib/domain.ts` |
| Pure rules: `defaultCaption`, `captionFor`, `scheduledAtOf` (Riyadh +03:00, falls back to `bestTime`), `directMediaUrl` (Dropbox/Drive → direct links), `publishProblems`, `buildJob`, `parseJobs`, `autoPostSummary`, `manualComposeUrl` (X intent); Worker calls `publishList/Schedule/Run/Cancel` | `lib/publish.ts` (+ `lib/publish.test.ts`) |
| Hook: schedule / post now / cancel; `applyJob` writes results and calls `markPosted` (Produce quest bridge) once every API network is published; `usePublishWatcher` polls every 60 s while a job is active (mounted in `AppShell`'s `SocialSyncAgent`) | `components/social/usePublish.ts` |
| Post popup tab **🚀 انشر / Publish** | `components/social/calendar/AutoPostTab.tsx`, tab added in `PostSheet.tsx` |
| Hub on the Automations route (🚀 Auto-posting: accounts that can post, upcoming, already out) | `components/social/AutoPostScreen.tsx`, `app/social/automations/page.tsx`, `nav.ts`, `MoreScreen.tsx` (no longer "soon") |
| "✍️ Allow posting" button + "Posts by itself" chip | `components/settings/ConnectedAccountsCard.tsx`; `connectSocial(platform, publish?)` in `useSocialSync.ts` (a reconnect keeps `canPublish`) |
| Copy (Hijazi first, key parity) | `messages/publish.{ar,en}.json` (registered in `lib/i18n.ts`); `calendar.sheet.tab.autopost`; nav labels |
| CSS: `.cal-tabs` scrolls sideways (4 tabs on a phone) | `app/globals.css` |
| E2E | `e2e/autopost.spec.ts` (fake Worker via `page.route`) |

### Scout Worker (`workers/scout`, Cloudflare free plan)

| Piece | File |
| --- | --- |
| Publishing scopes asked only with `POST /social/connect/:platform { publish: true }` (`publishScopes` + `scopeFor`); the callback stores `canPublish` on the encrypted token; `/social/status` reports it | `oauth.ts`, `instagram.ts`, `threads.ts`, `youtube.ts`, `tiktok.ts`, `routes.ts`, `store.ts`, `types.ts` |
| Queue: one KV document `publish:jobs`; `GET/POST /social/publish`, `POST /social/publish/:id/run`, `DELETE /social/publish/:id`; validation, merge (processing/published targets and the lock survive a replace), prune (30 days, max 200), runner `runDue` (budget 34 calls, `lockUntil` 10 min, retries 5/10/15 min up to 4 attempts, 2 h processing timeout) | `src/social/publish.ts` |
| Step functions: Instagram (containers, REELS), Threads (TEXT/IMAGE/VIDEO), YouTube (resumable upload streamed from the media URL via `FixedLengthStream`), TikTok (`creator_info` → `FILE_UPLOAD` init → chunked PUT with Range GETs above 64 MB → status poll; Direct Post or inbox) | `src/social/publishers.ts` |
| Cron: **one** trigger `*/5 * * * *` (was four daily). Ticks at 03:00/03:10/03:20/03:30 UTC run the daily sync of one platform each; other ticks publish. Legacy cron strings still route to `runScheduled` | `src/social/cron.ts`, `src/index.ts`, `wrangler.jsonc`, `sync.ts` (`syncIfConnected`) |
| Tests | `src/social/publish.test.ts`; three status assertions in `social.test.ts` gained `canPublish` |

Docs: `workers/scout/README.md` → "Auto-posting". Decision record, platform limits and owner steps: `planning/tools/07-auto-posting.md`.
Search log: `planning/tools/05-found-on-github.md`. Also updated: build plan row 5.8, master plan round 28, and tools `03`, `06` and `README`.

## Decisions (do not re-litigate without the owner)

- **Official APIs from the Worker**, not a paid scheduler. Metricool's API needs the Advanced plan (~$53/mo); Ayrshare is $149/mo;
  Postiz and Mixpost cannot run on the free Worker.
- **X and Snapchat stay manual**: copy the caption and open the app. X has had no free tier since Feb 2026, and Snapchat's Public
  Profile API is allowlist-only. Fallbacks if the owner wants them automated: **Zernio** (the only API found that posts to Snapchat;
  2 accounts free) or **Buffer's free API** (no app audits).
- **Media = a public link** pasted by the owner. There is no file storage until Supabase in Sprint 3, and R2 needs a card on file.
- Publishing permission is **opt-in per platform**, so the analytics connect keeps working even if a posting product is not enabled
  in a developer app.

## Known limits and risks

- **YouTube**: uploads stay **private** until the Google Cloud project passes YouTube's API audit (projects created after 2020-07-28).
- **TikTok**: until the app passes the audit, Direct Post only allows **SELF_ONLY**. The inbox mode works meanwhile.
  6 requests/min per token. Photo posts are not built; they need a verified media domain.
- **Instagram**: 100 API posts per 24 h. No carousels or stories yet.
- A Google Drive link that returns the virus-scan HTML page fails as `media_unreachable`; the UI explains this.
- KV is eventually consistent. The job lock makes a double post very unlikely, but it is not a hard guarantee.
- These parts ran only against mocks: `FixedLengthStream` streaming, and the exact Meta/TikTok error shapes. Verify on the first real
  post.

## Owner's one-time setup (not done yet)

1. **Meta app**: add `instagram_business_content_publish` and `threads_content_publish` (Standard Access, no review needed for his own
   accounts).
2. **Google Cloud**: add the `…/auth/youtube.upload` scope to the consent screen. Optional: the YouTube audit form for public uploads.
3. **TikTok app**: add the **Content Posting API** product, enable Direct Post, and check that `video.publish` and `video.upload` are
   listed. Sandbox target user first, then the audit.
4. Merge, then run **Actions → Deploy Scout Worker** so the new cron and routes go live.
5. Dashboard → **Settings → Connected accounts** → **✍️ اسمح بالنشر** per platform.

## Suggested next steps

1. Open a PR for `claude/serene-carson-r84hqn` (the owner has not asked yet; ask first), and watch CI.
2. After setup: do one real "Post now" per platform with a short test clip, and fix anything the live APIs answer differently from
   the mocks. Start with Threads text, which needs the fewest permissions.
3. Nice-to-haves from `07-auto-posting.md` → "Later": phone upload into Supabase Storage; IG carousels and stories; TikTok photos;
   first comment; queue mode (next free slot); push notification on failure (Sprint 3 Web Push); Zernio for Snapchat.

## Project rules to remember

- Read `CLAUDE.md` and `AGENTS.md`. Next.js 16 has breaking changes, so check `node_modules/next/dist/docs/` before Next-specific
  code.
- Search before building, and record the finds in `planning/`.
- Hijazi Arabic first; `messages/*.ar.json` and `*.en.json` in key parity (`messages/messages.test.ts` checks this).
- Gates before any push: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm e2e`. In the cloud container, e2e needs
  `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium`.

## Prompt for the next session

> Continue the auto-posting work in `3zmd95-glitch/hello-github` on branch `claude/serene-carson-r84hqn`. Read
> `planning/handovers/auto-posting-2026-09-28.md` first, then `planning/tools/07-auto-posting.md` and `workers/scout/README.md` →
> "Auto-posting". The feature is built and tested against mocks only. Ask me whether to open the PR, then help me with the one-time
> platform setup and the first real test post per platform, fixing whatever the live APIs answer differently. Keep to `CLAUDE.md`
> (search before building, Hijazi-first copy with ar/en key parity, all five quality gates before any push).
