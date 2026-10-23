# DT-6B-3A local release checklist (lists only; nothing changed)

Cached base; live deployment unverified. **Nothing in this candidate is deployed, grant-ready or live.** No namespace,
Durable Object, migration, secret or workflow was created, changed, read or run while making this list. Secret
**names** only, read from `wrangler.jsonc`, `.github/workflows/worker.yml`, the README and the Worker source.

## 1. Durable Objects (from `wrangler.jsonc`, unchanged; classes exported by `src/index.ts`, unchanged)

| Binding | Class | Migration tag (`new_sqlite_classes`) |
| --- | --- | --- |
| `SEND_COORDINATOR` | `SendCoordinator` (`src/social/sendCoordinator.ts`) | `v1-send` |
| `THREADS_SEND_COORDINATOR` | `ThreadsSendCoordinator` (`src/social/threadsSendCoordinator.ts`) | `v2-threads-send` |
| `INSTAGRAM_PUBLIC_SEND_COORDINATOR` | `InstagramPublicSendCoordinator` (`src/social/instagramPublicSendCoordinator.ts`) | `v3-instagram-public-send` |
| `INSTAGRAM_DM_COORDINATOR` | `InstagramDmCoordinator` (`src/social/instagramDmCoordinator.ts`) | `v4-instagram-dm` |

All four are local configuration only; none has been provisioned. Whether the live Worker already carries any
migration tag is unknown (open question 5).

## 2. KV and other bindings (required, existing names)

- `SOCIAL_KV` (placeholder id `000…0`; the workflow swaps in the real id of "3z-scout-SOCIAL_KV"/"SOCIAL_KV").
  Holds social tokens and state, inbox data, and the TikTok keys `tiktokads:token`, `tiktokads:state:<nonce>`, plus
  from this delta `tiktokads:account`, `tiktokads:account-state:<nonce>`, `tiktokads:music:<country>:<range>:<genre>`,
  and from the DT-6B-3A-R1 repair the new key family `tiktokads:account-refresh:<connection>` (sealed renewed account
  token; KV `expiration` = the renewed refresh token's end, at most 1 year; bounded retention, never deleted earlier).
  `tiktokads:account` is now `{ v: 2, connection, token }` written only by the account callback; a live legacy record
  (bare sealed token), if any exists, stays readable as connection `legacy` until the next account connect.
- `OAUTH_KV` (placeholder id `111…1`; the workflow swaps in "3z-scout-OAUTH_KV").
- `AI` (Workers AI binding).
- Vars in `wrangler.jsonc`: `ALLOWED_ORIGINS`, `TREND_SOURCES`, `TREND_KEYWORDS_AR`, `TREND_KEYWORDS_EN`,
  `DISCOVER_YT_CAP`, `MCP_DAILY_LOOKUPS`, `BRAVE_DAILY`, `TIKTOK_ADS_APP_ID`, `TIKTOK_DISCOVERY_COUNTRY`,
  `DISCOVER_V2`, `MCP_RESOURCE`.

## 3. Secret names

- Set by the workflow from repository secrets: `TAVILY_API_KEY`, `SCOUT_TOKEN`, `META_APP_ID`, `META_APP_SECRET`,
  `THREADS_APP_ID`, `THREADS_APP_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `TIKTOK_CLIENT_KEY`,
  `TIKTOK_CLIENT_SECRET`, `YOUTUBE_API_KEY`.
- Workflow-only (deploy credentials): `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.
- Owner-added in Cloudflare, the workflow leaves them as they are: `TIKTOK_ADS_SECRET` (advertiser connect and, from
  this delta, the account connect/token/refresh), `BRAVE_API_KEY` (optional, off), `INBOX_SEAL_SECRET` (inbox seals;
  ≥ 32 characters, not equal to `SCOUT_TOKEN`; without it Threads/YouTube inbox and the seal-dependent send paths
  answer `503 not_configured`).

## 4. Entry exports (`src/index.ts`, unchanged)

`default` (`fetch`: OAuth/MCP paths through `@cloudflare/workers-oauth-provider` when `OAUTH_KV` and `MCP_RESOURCE`
are set, else `handle()` in `scout.ts`; `scheduled`: `runTick` for `* * * * *`, `runScheduled` otherwise) and exactly
the four Durable Object classes above. The offline dry-run bundle (`wrangler deploy --dry-run --outdir`, no upload)
exports `InstagramDmCoordinator`, `InstagramPublicSendCoordinator`, `SendCoordinator`, `ThreadsSendCoordinator`,
`default`.

## 5. Existing deployment workflow (`.github/workflows/worker.yml`, unchanged)

- Triggers: **any push to `main`** touching `workers/scout/**`, `planning/data/saudi-events.json`,
  `planning/data/genres.json`, `planning/data/edit-terms.json` or the workflow itself; and `workflow_dispatch`.
  Merging or pushing this candidate to `main` would therefore deploy it.
- Steps: check the two Cloudflare secrets (absent → green no-op run); install; `pnpm --filter 3z-scout run test`;
  **find or create** the KV namespaces "3z-scout-SOCIAL_KV" (also accepts "SOCIAL_KV") and "3z-scout-OAUTH_KV" and
  write their ids into the checkout's `wrangler.jsonc`; `wrangler deploy` (would apply all four DO migrations not yet
  applied); then `wrangler secret put` for each repository secret that is set.
- Concurrency group `scout-worker`, no cancel in progress.

## 6. Unresolved production-grant / gate questions

1. Meta: the endpoint-specific permission and supported API version for Instagram public replies and
   existing-conversation DMs, and trusted grant evidence; until then prepare/new confirm/registration stay
   `permission_unverified`.
2. Threads: reply-creation permission and grant evidence; the gate stays `permission_unverified`.
3. YouTube: an owner-granted `youtube.force-ssl` connection (OAuth change is a separate reviewed step).
4. TikTok (this delta): the app's TikTok Accounts permission and the account-holder redirect URL
   `…/oauth/tiktokads/account/callback/` must be registered by the owner; one account connect is needed before
   `/tiktokads/music` answers. Not verified.
5. Deployment base: the live Worker's version and routes and the real remote head after `a858c12` are unknown; a
   future activation must reconcile a freshly verified remote/deployed base first.
6. `INBOX_SEAL_SECRET` presence in the live Worker is unknown.

## 7. Automatic-reply cutover — release blocker

The live Worker's automatic replies (cron `runTick`) may already have sent public replies and DMs and started
cooldowns under the older code. Those prior automatic effects and cooldowns **cannot be inferred** from the new local
coordinators (`INSTAGRAM_PUBLIC_SEND_COORDINATOR`, `INSTAGRAM_DM_COORDINATOR`) or from test fixtures: fresh Durable
Objects start empty, so a first deploy could repeat a reply or skip a cooldown. Cutover stays blocked until a
separately reviewed plan establishes how prior effects/cooldowns are carried over or fenced.

## 8. Statement

Nothing is deployed, nothing is grant-ready, nothing is live. This packet only removes the known code-base divergence
against the cached `origin/main`. The DT-6B-3A-R1 repair (account connection-preserving refresh, malformed chart
rejection) is local to this candidate as well: Cached base; live deployment unverified. Whether the live Worker
already holds a `tiktokads:account` record (and in which format) is unknown; the candidate reads both formats.
