# DT-6B-3A integration note — local Worker candidate

**Cached base; live deployment unverified.** This is a local combined source candidate in the managed worktree
(branch `codex/discover-inspiration`, uncommitted). Nothing was fetched, committed, pushed, merged, deployed,
provisioned or sent; no secret was read; no provider was called.

## Fixed refs (read locally, no fetch)

| Ref | SHA |
| --- | --- |
| Managed HEAD | `0e1fdb089146f4fd8e5f1d3c7cd58cf5b6fc6127` |
| Cached `origin/main` | `a858c1208af2477dba3e07865c5c2059cf18e220` |
| Merge base | `898483fe6e88723c361e691fec20a3e3ffb63afc` |

`git rev-list --left-right --count HEAD...origin/main` = `48 3`. Incoming commits: `3cb507f` (TikTok Discovery music
probe), `ec80679` (TikTok account connect + Commercial Music Library), `a858c12` (account connect returns its link as
JSON). Their Worker delta is exactly the 7 allowlisted paths; `e2e/studio.spec.ts` (app) was left out of scope.

## Method

For each path: `git show 898483f:<path>` (base), `git show origin/main:<path>` (theirs) and the current working file
(ours, CRLF normalized to LF) were written to a writer scratch dir and resolved with `git merge-file -p ours base
theirs`; the result was written into the worktree. No reset, checkout, branch switch, whole-tree merge, cherry-pick or
stash. `allowlist.patch` is the exact diff from the pre-packet working files (LF) to the candidate and applies cleanly
to them (`patch -p1 --dry-run`).

## Per-file semantic resolution

- `src/scout.ts` — the local side never changed it (working content equal to base apart from CRLF), so the merge is
  upstream verbatim. Added: the header lines for `/tiktokads/account/*` and `/tiktokads/music`; imports of
  `handleTikTokAccount`, `handleTikTokAccountCallback`, `musicProbe`; the bearer-free account callback route
  `/^\/oauth\/tiktokads\/account\/callback\/?$/` (GET), placed after `/oauth/tiktokads/callback` and before the
  generic social `/oauth/:platform/callback`; behind the bearer, after `handleSocial`, `GET /tiktokads/music-probe`
  then `handleTikTokAccount` (connect, status, music), then the unchanged `handleTikTokAds`. Retained unchanged:
  OPTIONS/CORS and early origin refusal, the advertiser and social OAuth callbacks, `/go/:id/:n`, `/health`, the
  bearer gate, `/search`, `/oembed`, Discover, creator, `handleSocial` (which owns every `/social/inbox/**` read, send
  and control family via `social/routes.ts`, unchanged), trends, effects, categories, 404.
  `handleSocial` returns null for any path not under `/social/`, so the new routes cannot be shadowed by inbox routing
  and vice versa.
- `src/tiktokads.ts` — local content equal to base, so upstream verbatim: `app` and `hide` exported, `takeOnce(kv,
  key)` added and exported, `takeState` reimplemented on it (same one-time read-and-delete, same shape check). The
  advertiser connect/callback/status behavior is unchanged (`tiktokads.test.ts` passes unmodified).
- `src/tiktokAccount.ts`, `.test.ts`, `src/tiktokMusicProbe.ts`, `.test.ts` — new, copied verbatim; no missing
  dependency. The account module and its tests were later adapted by DT-6B-3A-R1 (below).
- `README.md` — clean three-way merge of disjoint hunks: the accepted inbox/coordination sections and limitations
  stay as they were; the upstream TikTok documentation (bearer-free account callback in the auth paragraph, the
  music-probe/account connect/account callback/account status/music rows, the three KV keys, the `TIKTOK_ADS_APP_ID`
  account-permission note) is added.
- `src/scout.test.ts` — first 1232 lines byte-identical; one appended `describe` of mixed-router controls.

## Retained behavior proof (fake transport only)

| Control | Evidence |
| --- | --- |
| JSON connect stays JSON; ordinary connect still redirects | `scout.test.ts` "one router serves both families"; `tiktokAccount.test.ts` connect tests |
| Unauthenticated protected routes refused (both families) | `scout.test.ts` "refuses every protected route…": 14 requests (account connect ×2, account status, music, music-probe, ads status/connect, Discover picks, DM control status/register, Threads/Instagram send prepare, YouTube send status, wrong bearer) → 401, zero fetch, zero KV writes |
| Account callback spelling + one-time state | `scout.test.ts` "the account callback keeps both spellings…" (with and without trailing `/`, no bearer, replay → 400 `state_invalid`, advertiser state refused, social callback still its own JSON route); `tiktokAccount.test.ts` callback tests |
| Old ads/discovery routes reachable | `scout.test.ts`: `POST /tiktokads/connect` → `{ url }` on `business-api.tiktok.com/portal/auth`, `GET /tiktokads/status`, `GET /discover/picks`; `tiktokads.test.ts` unmodified, Discover/categories suites in the full run |
| Accepted inbox account/status/recovery routes route | `scout.test.ts`: DM control status, DM send status, Threads send status reach their own handlers (`503 not_configured` with their own `detail` when unbound); the 15 inbox/coordination suites (826 tests) drive `scout.handle` end to end |
| Instagram/Threads new preparation/registration still `permission_unverified` | `inboxSendInstagram.test.ts`, `inboxSendThreads.test.ts`, `inboxSendInstagramDm.test.ts` production-closed tests, all through the combined `scout.handle` |
| Four DO exports and migrations byte-identical, class names match | `src/index.ts` `53791a2c…` and `wrangler.jsonc` `e846591a…` unchanged; exports `SendCoordinator`, `ThreadsSendCoordinator`, `InstagramPublicSendCoordinator`, `InstagramDmCoordinator` = binding `class_name`s = migration `new_sqlite_classes`; the offline dry-run bundle lists the four bindings and exports exactly those four classes plus `default` |
| No live KV/DO | tests use in-memory KV, fake fetch, local workerd runtime suites only |

## DT-6B-3A-R1 repair of the imported account module (local only)

Codex's DT-6B-3A review reproduced two defects in the exact upstream `tiktokAccount.ts` bytes (not a merge loss).
Both are repaired in the candidate only; no Git ref was changed.

- **3A-1 connection-preserving refresh.** Existing `SOCIAL_KV`, no new binding/DO/migration. `tiktokads:account` is
  written only by a completed account callback, sealed as `{ v: 2, connection, token }` with a fresh random 128-bit
  hex `connection` per callback (a same-account reconnect too). A legacy record (bare sealed token) is read as
  connection `legacy` and never rewritten by a renewal; the first new callback replaces it. A renewal captures the
  connection before calling TikTok and writes only `tiktokads:account-refresh:<connection>`, sealed `{ connection,
  token }`, KV `expiration` = the renewed refresh token's end capped at 1 year (a renewed refresh token ending within
  KV's 60-second minimum answers `reconnect`; a renewal naming another `open_id` is `refresh_failed account_mismatch`,
  not kept; a failed write is `refresh_failed storage_failed`, not used). `readAccountToken` (status, music and the
  pinned music probe) reads the reference, then that connection's refresh key, and uses the renewal only when its
  sealed `connection` and `open_id` match the reference. After a renewal the music path re-reads the reference: a
  different connection answers `409 { error: "account_changed" }` (none: `not_connected`) with no chart call and no
  cache write. A late renewal of an old connection therefore lands under its old id and is never read again.
- **3A-2 malformed chart.** `Array.isArray(data.list)` is required before normalization; missing/`null`/object/other
  lists answer `502 { error: "upstream", detail: "malformed_list" }` with zero chart-cache writes. A valid empty array
  stays a real (cacheable) empty chart; row order, normalization, cache hits and per-query keys are unchanged.
- **Unchanged:** `scout.ts`, `tiktokads.ts`, `tiktokMusicProbe.ts`, `scout.test.ts`, `index.ts`, `wrangler.jsonc`, all
  social/inbox modules. Connect JSON/redirect, callback page, status shape and probe plan are as before.
- **Limits (also README/tool 37).** KV is eventually consistent: for a short while another location may read the
  previous connection, so account switching is not linearizable. Two requests renewing the same connection at the
  same moment may still race on TikTok's refresh token (inherited, rare). A chart already asked before a reconnect
  may still be answered and cached for its query (the chart is the country's list). Stale refresh keys keep old
  sealed credentials until their expiration; nothing deletes them earlier. The music probe and status now read one
  more KV key when an account is connected.

## DT-6B-3C overlay on the candidate (17 Oct 2026, local only)

The manual Instagram DM text limit is now 1,000 UTF-8 bytes of the canonical `message.text` (Codex finding 3B-1).
This is **not** part of the eight-target 3A import: `allowlist.patch` (`51f85760…`) is unchanged and stays the
historical 3A/3A-R1 provenance; it does not cover 3C code. The 3C Worker delta is labelled separately in
`3c-overlay.patch` (`2aa3ddc2…`): the exact diff from the pre-3C working files (LF; rebuilt in writer scratch and
matched to the pre-edit sha256 snapshot) to the candidate, applying with `patch -p1` and reproducing all five files.

| Path | Change | Candidate sha256 |
| --- | --- | --- |
| `src/social/inboxSendInstagramDm.ts` | `DM_TEXT_BYTES_MAX` (1,000 UTF-8 bytes) replaces the code-point `DM_TEXT_MAX` in `canonicalText`; Confirm refuses a still-`prepared` intent whose stored text is over the bound or not canonical with `text_invalid` right after the durable-state and digest checks (no token read, GET, claim or POST); header text updated | `7a6f9de4…` |
| `src/social/inboxSendInstagramDm.test.ts` | the old "1000 supplementary characters are within the bound" assertion is inverted by the contract (now `text_invalid`; 250 are accepted); +34 tests (boundary table, valid-boundary Confirm, zero-effect Prepare, directly seeded legacy prepared intent, old receipts in 8 states × 2 texts offline) | `c2ff6508…` |
| `src/social/instagramDmCoordinator.ts` | comment only (storage cap note at the former line 85); no SQL, storage or runtime change | `68ac09c9…` |
| `src/tiktokMusicProbe.ts` | comment only (two KV reads without a connected account, three when connected) | `0778c501…` |
| `README.md` | the Instagram DM **Text** paragraph | `50fb6eef…` |

Unchanged: `scout.ts`, `index.ts`, `wrangler.jsonc`, `instagramDmSend.ts`, `replyCore.ts`, `replies.ts`, `inbox.ts`,
every other Worker file (`worker-manifest.sha256` regenerated over all 182 Worker files, `33a377bd…`; exactly these
five entries differ from the 3A-R1/3B manifest `b1bfdd02…`). Production eligibility stays closed; no deployment,
grant, secret, provider call or migration.

## Not established here

The live Worker's version and routes, the remote head after `a858c12`, provider grants, API versions and the
automatic-reply cutover state. See `release-checklist.md`.
