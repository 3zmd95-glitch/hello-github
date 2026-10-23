# DT-6B-3A classification of Worker files

Refs: managed HEAD `0e1fdb089146f4fd8e5f1d3c7cd58cf5b6fc6127`, cached `origin/main`
`a858c1208af2477dba3e07865c5c2059cf18e220`, merge base `898483fe6e88723c361e691fec20a3e3ffb63afc`.
Cached base; live deployment unverified. Hashes: `worker-manifest.sha256` (182 files, `node_modules` excluded),
regenerated for DT-6B-3A-R1.

## Adapted from upstream a858c12 for 3A-R1 (no longer byte-identical to upstream)

| Path | Exact imported baseline (`git show a858c12:<path>`, kept for reference) | 3A-R1 candidate | Change |
| --- | --- | --- | --- |
| `workers/scout/src/tiktokAccount.ts` | `b1ada6de3dc1aa4b566fdb4919f3d816b2f0507a5e46437b462de52edc709b0b` | `aa5e4a30cfe8b30d0531ae5f5f9d2065774f84959e94aadf7990664e1b52b658` | 3A-1 connection-preserving refresh (callback alone writes `tiktokads:account` as `{ v: 2, connection, token }`; legacy bare token read as `legacy`; renewal only to `tiktokads:account-refresh:<connection>` with bounded `expiration`; renewal naming another `open_id` refused; music re-reads the connection after a renewal → `409 account_changed`); 3A-2 non-array `data.list` → `502 upstream malformed_list`, never cached; the line-300 `if` reflow (nonsemantic, Prettier) |
| `workers/scout/src/tiktokAccount.test.ts` | `2b91996e35253e2481fed0562a15c0f9c7e63101af2d6dd2d668a8fa5736b685` | `567f35a95d3005fe9562824400d233372809db07c5ae66a8e0cb77ad78ee6ed4` | two upstream storage assertions moved to the new representation (same token values; the callback's under `token` of the v2 reference, the renewal's under the refresh key with the reference unchanged); fake KV records `expiration`; 21 added 3A-R1 tests |

The exact upstream bytes are still the reconciliation baseline in the DT-6B-3A record; the repair is local and was
not applied to any Git ref.

## Copied from cached origin/main (byte-identical to `git show a858c12:<path>`)

| Path | Why |
| --- | --- |
| `workers/scout/src/tiktokMusicProbe.ts` | new upstream module (shares `readAccountToken`, which now resolves the connection and its kept renewal) |
| `workers/scout/src/tiktokMusicProbe.test.ts` | new upstream tests |
| `workers/scout/src/scout.ts` | three-way result equals upstream: the local side never changed this file since the base (content equal to base; only its working-copy EOL was CRLF, now LF as in Git) |
| `workers/scout/src/tiktokads.ts` | same as `scout.ts`: local content equal to base, so the three-way result is upstream (`app`, `hide`, `takeOnce` exported; `takeState` built on `takeOnce`) |

No dependency forced a change to any copied file: every import (`discover/fetchers` `CALL_TIMEOUT_MS`,
`effects/ai` `isRecord`, `effects/routes` `json`, `categories/top` `getJson`/`withParams`/`Reply`,
`categories/tiktok` `TT_TRENDING_URL`, `social/crypto`, `social/store` `STATE_TTL_S`, `tiktokads`
`readAdsToken`) exists locally with a compatible signature (`pnpm typecheck` exit 0).

## Merged (three-way, both sides kept)

| Path | Resolution |
| --- | --- |
| `workers/scout/README.md` | `git merge-file` clean: the local inbox/coordination documentation (+299 lines since base) and the upstream TikTok account/music rows (endpoint list, four routes, three KV keys, `TIKTOK_ADS_APP_ID` note) touch disjoint hunks. 3A-R1 then edited only the account-storage text: music-probe reads, callback v2 record, music renewal/`account_changed`/`malformed_list`, the `tiktokads:account` row and a new `tiktokads:account-refresh:<connection>` row with its limits |
| `workers/scout/src/scout.test.ts` | local file kept byte-identical in its first 1232 lines; one appended `describe` (mixed-router controls, 3 tests). Upstream never changed this file |

## Unchanged accepted modules (byte-identical to the pre-packet snapshot)

Every other Worker file. Listed below by path (174 files). It includes `src/index.ts` (default handler + the four
Durable Object exports) and `wrangler.jsonc` (four bindings, migrations `v1-send`, `v2-threads-send`,
`v3-instagram-public-send`, `v4-instagram-dm`), all of `src/social/**` (OAuth/scopes, readers, senders, coordinators,
eligibility literals, cron), Discover, categories, effects and trends.

```
workers/scout/package.json
workers/scout/scripts/mcp-smoke.mjs
workers/scout/src/categories/carxDraft.fixture.ts
workers/scout/src/categories/creatorProjects.fixture.ts
workers/scout/src/categories/defs.test.ts
workers/scout/src/categories/defs.ts
workers/scout/src/categories/filmedProject.fixture.ts
workers/scout/src/categories/lessons.test.ts
workers/scout/src/categories/lessons.ts
workers/scout/src/categories/productionCredits.fixture.ts
workers/scout/src/categories/quality.test.ts
workers/scout/src/categories/quality.ts
workers/scout/src/categories/routes.test.ts
workers/scout/src/categories/routes.ts
workers/scout/src/categories/run.test.ts
workers/scout/src/categories/run.ts
workers/scout/src/categories/skills.json
workers/scout/src/categories/skills.ts
workers/scout/src/categories/soundtrackResource.fixture.ts
workers/scout/src/categories/tiktok.test.ts
workers/scout/src/categories/tiktok.ts
workers/scout/src/categories/tiktokAcquire.test.ts
workers/scout/src/categories/tiktokAcquire.ts
workers/scout/src/categories/tiktokProbe.runtime.test.ts
workers/scout/src/categories/tiktokProbe.test.ts
workers/scout/src/categories/tiktokProbe.ts
workers/scout/src/categories/top.test.ts
workers/scout/src/categories/top.ts
workers/scout/src/categories/types.ts
workers/scout/src/categories/video.ts
workers/scout/src/creator/ai.ts
workers/scout/src/creator/creator.test.ts
workers/scout/src/creator/routes.ts
workers/scout/src/creator/schema.ts
workers/scout/src/discover/ai-plan.test.ts
workers/scout/src/discover/ai-plan.ts
workers/scout/src/discover/ai-schema.test.ts
workers/scout/src/discover/ai-schema.ts
workers/scout/src/discover/ai.test.ts
workers/scout/src/discover/ai.ts
workers/scout/src/discover/auth.test.ts
workers/scout/src/discover/auth.ts
workers/scout/src/discover/category-profiles.ts
workers/scout/src/discover/fetchers.test.ts
workers/scout/src/discover/fetchers.ts
workers/scout/src/discover/label.test.ts
workers/scout/src/discover/label.ts
workers/scout/src/discover/mcp.ts
workers/scout/src/discover/picks.test.ts
workers/scout/src/discover/picks.ts
workers/scout/src/discover/plan.test.ts
workers/scout/src/discover/plan.ts
workers/scout/src/discover/relevance.test.ts
workers/scout/src/discover/relevance.ts
workers/scout/src/discover/routes.test.ts
workers/scout/src/discover/routes.ts
workers/scout/src/discover/run.test.ts
workers/scout/src/discover/run.ts
workers/scout/src/discover/terms.test.ts
workers/scout/src/discover/terms.ts
workers/scout/src/discover/tools.test.ts
workers/scout/src/discover/tools.ts
workers/scout/src/discover/types.ts
workers/scout/src/discover/usage.ts
workers/scout/src/effects/ai.test.ts
workers/scout/src/effects/ai.ts
workers/scout/src/effects/extract.test.ts
workers/scout/src/effects/extract.ts
workers/scout/src/effects/families.test.ts
workers/scout/src/effects/families.ts
workers/scout/src/effects/formats.test.ts
workers/scout/src/effects/formats.ts
workers/scout/src/effects/kv.test.ts
workers/scout/src/effects/kv.ts
workers/scout/src/effects/routes.test.ts
workers/scout/src/effects/routes.ts
workers/scout/src/effects/run.test.ts
workers/scout/src/effects/run.ts
workers/scout/src/effects/score.test.ts
workers/scout/src/effects/score.ts
workers/scout/src/effects/sources.test.ts
workers/scout/src/effects/sources.ts
workers/scout/src/effects/types.ts
workers/scout/src/index.ts
workers/scout/src/instagramMedia.test.ts
workers/scout/src/instagramMedia.ts
workers/scout/src/instagramPreview.test.ts
workers/scout/src/instagramPreview.ts
workers/scout/src/instagramSource.test.ts
workers/scout/src/instagramSource.ts
workers/scout/src/normalize.test.ts
workers/scout/src/normalize.ts
workers/scout/src/origins.ts
workers/scout/src/postDate.test.ts
workers/scout/src/postDate.ts
workers/scout/src/social/cron.ts
workers/scout/src/social/crypto.ts
workers/scout/src/social/http.ts
workers/scout/src/social/inbox.test.ts
workers/scout/src/social/inbox.ts
workers/scout/src/social/inboxRead.test.ts
workers/scout/src/social/inboxRead.ts
workers/scout/src/social/inboxReadCommon.ts
workers/scout/src/social/inboxReadThreads.test.ts
workers/scout/src/social/inboxReadThreads.ts
workers/scout/src/social/inboxReadYouTube.test.ts
workers/scout/src/social/inboxReadYouTube.ts
workers/scout/src/social/inboxSendInstagram.test.ts
workers/scout/src/social/inboxSendInstagram.ts
workers/scout/src/social/inboxSendInstagramDm.test.ts
workers/scout/src/social/inboxSendInstagramDm.ts
workers/scout/src/social/inboxSendThreads.test.ts
workers/scout/src/social/inboxSendThreads.ts
workers/scout/src/social/inboxSendYouTube.test.ts
workers/scout/src/social/inboxSendYouTube.ts
workers/scout/src/social/instagram.ts
workers/scout/src/social/instagramDmCoordinator.runtime.test.ts
workers/scout/src/social/instagramDmCoordinator.test.ts
workers/scout/src/social/instagramDmCoordinator.ts
workers/scout/src/social/instagramDmSend.test.ts
workers/scout/src/social/instagramDmSend.ts
workers/scout/src/social/instagramPublicSend.test.ts
workers/scout/src/social/instagramPublicSend.ts
workers/scout/src/social/instagramPublicSendCoordinator.runtime.test.ts
workers/scout/src/social/instagramPublicSendCoordinator.test.ts
workers/scout/src/social/instagramPublicSendCoordinator.ts
workers/scout/src/social/meta.ts
workers/scout/src/social/normalization.ts
workers/scout/src/social/oauth.ts
workers/scout/src/social/publish.test.ts
workers/scout/src/social/publish.ts
workers/scout/src/social/publishers.ts
workers/scout/src/social/replies.test.ts
workers/scout/src/social/replies.ts
workers/scout/src/social/replyCore.test.ts
workers/scout/src/social/replyCore.ts
workers/scout/src/social/routes.ts
workers/scout/src/social/sendCoordinator.runtime.test.ts
workers/scout/src/social/sendCoordinator.test.ts
workers/scout/src/social/sendCoordinator.ts
workers/scout/src/social/social.test.ts
workers/scout/src/social/store.ts
workers/scout/src/social/sync.ts
workers/scout/src/social/threads.ts
workers/scout/src/social/threadsSendCoordinator.runtime.test.ts
workers/scout/src/social/threadsSendCoordinator.test.ts
workers/scout/src/social/threadsSendCoordinator.ts
workers/scout/src/social/tiktok.ts
workers/scout/src/social/time.ts
workers/scout/src/social/types.ts
workers/scout/src/social/youtube.ts
workers/scout/src/tiktokSource.test.ts
workers/scout/src/tiktokSource.ts
workers/scout/src/tiktokads.test.ts
workers/scout/src/trends/events.ts
workers/scout/src/trends/genres.ts
workers/scout/src/trends/google.ts
workers/scout/src/trends/json.d.ts
workers/scout/src/trends/kv.ts
workers/scout/src/trends/kworb.ts
workers/scout/src/trends/normalize.ts
workers/scout/src/trends/routes.ts
workers/scout/src/trends/run.ts
workers/scout/src/trends/tavily.ts
workers/scout/src/trends/trends.test.ts
workers/scout/src/trends/types.ts
workers/scout/src/trends/x.ts
workers/scout/src/trends/youtube.ts
workers/scout/src/trends/youtubeSearch.ts
workers/scout/src/youtubeStats.test.ts
workers/scout/src/youtubeStats.ts
workers/scout/tsconfig.json
workers/scout/vitest.config.ts
workers/scout/wrangler.jsonc
```
