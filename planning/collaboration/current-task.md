# Current shared task — Discover continuous native results

## Checkpoint handover — 22 October 2026
The owner requested committing/pushing the current work and a handover to Claude Code. Read `planning/handovers/claude-code-2026-10-22.md` first for current scope, validation and remaining work. This is a branch checkpoint, not release approval or cloud activation. No Claude implementation task has been sent; no implementation writer is active. Earlier pause/role/freeze entries remain historical; the owner's next instruction to Claude controls resumption.

## Freeze 24 — packet 30 review candidate (16 Oct 2026, 12:20 AST)

Implementation owner: none.

**Status: frozen, documentation-only handoff prepared by Fable 5.1 at Codex's request
(Codex message "packet-19 / superseded handoff / 2026-10-16"). No source edit, no executor,
no test rerun, no browser run, no paid usage, no push/merge/deploy for this handoff. The
only action beyond writing this entry: localhost:3000 was found down (nothing listening,
12:14 AST) and was restarted detached from THIS managed worktree (`pnpm local:serve`, log
`%TEMP%/3z-local-serve-managed-2026-10-16.log`); `/discover/` now answers 200 with the frozen
export `3dc6f42a37ea8788a5c26734db3410e64f429f8ccddc74678475631c57f79df8`. Writers idle since
the packet 27 freeze (15 Oct 16:10 AST); every hash below was recomputed at 12:12 AST today
and matches the packet 25/27 freeze values where those were recorded (native-search.js,
manifest.json, trendingSounds.ts, TrendingSounds.tsx, editorFilter.ts, ResearchPanel.test.ts).**

### Workspace
- Worktree `C:/Users/AORUS/.codex/worktrees/discover-inspiration/hello-github`, branch
  `codex/discover-inspiration`, HEAD/baseline `0e1fdb089146f4fd8e5f1d3c7cd58cf5b6fc6127`
  ("Fix native Discover pagination and result visibility", 12 Oct). All work is uncommitted:
  43 tracked files modified (+4892/−352), 12 untracked product files.
- Not product, excluded from review: `AGENTS.md`, `CLAUDE.md` (workflow pointers),
  `.claude/agents/*.md`, `.claude/hooks/notify-codex*.cjs` (Stop hook), `planning/collaboration/`.
- Deployed Worker: `origin/main` `a858c1208af2477dba3e07865c5c2059cf18e220` (PR #73, 15 Oct),
  deployed by worker.yml run 38755604631. It does NOT contain this worktree's Worker edits.

### Slice A — review candidate: native feed / editor filter / continuation (+ dependencies)
Helper (manifest 0.4.3; owner reload NOT confirmed past 0.4.0):
```
dd6496496a5d4a8f5ee621ba9f7b4ce2d549cd361556558343a9d0deeeea4400  extensions/discover-import/manifest.json
1a3b8712f7b9766a487ff1b11f2adde9ba8cc217716001d86b4782754f91377b  extensions/discover-import/native-search.js
a4c6187bf87311ab2eb4b76b3c369a328d73da83e7a38df2bed4daf7f811465e  extensions/discover-import/native-search.test.ts
4ffe6e85ccb51336182f059b367d5ca8e0bade334d387101679032f022da8fef  extensions/discover-import/native-capture.js
dcde6f14f52812b637dd1bf7ca0f5958e130b8295d61abf0e67ca7b488b27f0c  extensions/discover-import/native-capture.test.ts
f52f324f2fdc48532cbe19ee4c35ad8e076744374b82c0ca5785e48783f2d79e  extensions/discover-import/native-protocol.js
bc33ba544b1cfb8b50b143bb2250d002b78ec3b2d51431c04e76d51578ab5590  extensions/discover-import/native-protocol.test.ts
```
App logic and UI:
```
4d73ab9eee913208aaf4d33b19ed83e0e66b94fe170b6ac3fb8860feaea4c981  lib/discoverNativeSearch.ts
b15a3c21c04083af756aa953038e29798a6930608752d189b5f51f4761cb7abb  lib/discoverNativeSearch.test.ts
af7886b02be2c5ba6041badd9d7f4046af9c73f300300ee07df0b7cf3b440c9f  lib/editorFilter.ts            (new)
6f446d10e9af5683ee00b6e8fe3ee85358145e8ed4fde34a59e975b428a3d007  lib/editorFilter.test.ts       (new)
4ae9925ca14f855e3a52a28111e510a78d5fa84a21da0004a76a48c0a27cb84f  lib/discoverSources.ts         (shared with slice B: TikTok `music` optional field)
245678cf201a9ca766da7a51bb6b2b4812a92f36adca1445afbff576516bb39d  lib/discoverSources.test.ts
d1763ba90c4d52d6a480104cb0eaa9123b638dc54ec1f7ba68037adddd2b1ee1  lib/discover.ts                (shared with slice B: `evidence.sound`)
dcaae152e23a9ed50965b1389b25e4b5db82cee1bdb88f3a2eb886bc931d16d9  lib/domain.ts
c4ceed32b6243250aea84886f6aecb78910187894d7de3f04bd2d0d1acb1ccef  lib/genres.ts
4b8bd9d899293c7d23f4deccb99651b173867206c981b3439b9d9644bf289f3a  lib/genres.test.ts
de398aed173e060c31f1aa35bab3e30e172db5389341484363fc9bdcef02a3c3  components/research/useNativeSearch.ts
b6660736689e2a4d49c529c05a1482f6d16d93d19b842e84d3a0bd45345de8aa  components/research/useNativeSearch.test.ts
9fabe31669a8551ee8b009bd118195c59517d7e5cf2d6f3dd269e7fa73673437  components/research/useNativeInfiniteScroll.ts  (new)
966746d6c3616f84c2eadf0c9b275b982a327de84a9579eee89db450020351d7  components/research/NativeKeywordResults.tsx     (new; shared with B)
e89069aebe05f004e6a02055ddbd0fa7252fb78cb17c3446cb1e0408e8737845  components/research/NativeKeywordResults.test.tsx (new)
a89ab73b3918af1c1d96b6ad3c75e8136d059b9c1e5db54570d31e4c7e627020  components/research/ResearchPanel.tsx            (shared with B)
b42a851029420524ee748cc3b38dd6347ddadea38fc3875e8822b74b89783d5b  components/research/ResearchPanel.test.ts
1d17730c5cdfd18dffb75e0d9b90dcb09b5818ad0e207fc00dbc996a0cfe24d6  components/research/CategoryDiscovery.tsx        (shared with B)
0e068df6d5bc64a0ca76fdd6cd15b4c66858f21777676167ad56d05c2a60fd32  components/research/CategoryDiscovery.test.tsx
c3f25e9238aa73d523184cecb8f72062e9a8e913fb103b14ee7c7f9c439d58cb  components/research/CategoryDiscovery.sources.test.tsx (new)
6ec2ee5568fd6489381bd3edce88a3d71bc8b8df087a304755b28fa4e772b54c  components/research/CategoryFeed.tsx
e6879459134018bdb5670c1abdea31d5f12e786fc762d4225e9ff1d8c9c13a74  components/research/BrowseCategoryFeed.tsx       (shared with B: mounts TrendingSounds)
32dc51fe2a7d3e453367ea71b376dc139dcfe863b4fb76e753a4bd9e5b39341b  components/research/ResultCard.tsx               (unchanged since Freeze 13)
47fefce9d58e5906d0e34409f0e8c292e47c9f74ef7924ecfeb8996f3a85d597  components/research/ResultCard.test.ts
eeb33d3d295498f23929e91cb15c1a12bb83c778a03334e2b6731c7960b197fb  components/research/useFeedSources.ts
4ae057a1f124efeab1661a121a86dc9c5656323de805366ed54834874b5cde59  components/research/useFeedSources.test.ts
1f812dc8ae50ab3e8fdf3401f06857e83a94e847244f3b3ff9ce250df7b15cc7  store/index.ts                 (settings.discover.editorScope)
29d9f0ddab600f161eec80c154f6258242948df0d2d057641443804554250363  store/index.test.ts
37000de2d486b61cfffd2c0715d4ddaab466e4587e8a75a8e85071c1def27a67  messages/search.ar.json
b0e91ab8447d1e4a49864e0a478ae3b3480135a89d363bf8f8032af528cad879  messages/search.en.json
102b1275a90855d56080bbe16ad5f43fc4a8e6569e735dce5280520ce63fbdf5  messages/feed.ar.json          (shared with B: sounds copy)
fbc52e1875624d6f2113c92abba7e2b5160d0c32df2b960794b3ecf6181f90e4  messages/feed.en.json          (shared with B)
6ad9354f20f78300957c7b07c939e8e0148966efb901030746a3657ac0e4cd34  e2e/discover-native-search.spec.ts
bb7473ffebb101e23e2af21f6fa0d8c4b2b3cc4c1db71c558d52b7b76a6c44c7  e2e/discover-tiktok-access.spec.ts
9a67820b58a30138efb432b47eb77082f22422d8f72763c343e108aafe0d18ce  planning/tools/32-native-search-feed.md
df2de95ef547ed6cde75831632108f8d864095335716cc01dc9099729b6a16e0  planning/handovers/discover-resume-2026-10-11.md
```
"Shared with B" files carry packet 26/27 music hunks too; review them by hunk, not whole-file.

### Slice B — scoped separately, NOT part of this candidate (trending music)
```
709926e3be4b06271a9d44ab3d965daee27fd041929b290a0b6aba5c9d38c65c  lib/trendingSounds.ts            (new)
b672dd5f2d802411c8ed8840eb5051f0b3c2b0c5b919a5d47595fbe9c621e7b5  lib/trendingSounds.test.ts       (new)
41dbf92d465e16a677058bfa7b273f667fed4c798285229a88fd81ce02f828f5  components/research/TrendingSounds.tsx      (new)
e3cc39b3172ab7e2f47c06bc064d2958726fe834b247c2b2db0b985934aa477a  components/research/TrendingSounds.test.tsx (new)
0b2bd5fc17209fad3250a2d207895e099d80c9b665f6047d4ec68695a60842b4  workers/scout/src/tiktokSource.ts        (NOT deployed)
a01db790a9bc93a701ad54bf5a39d5488e85cdce8b0c6d27c8a516b8064276c9  workers/scout/src/tiktokSource.test.ts
1dc9342684a182b5b0593701d528a06e05d4391b5d625d42c9e8c5cdfcbc4425  workers/scout/src/instagramSource.ts     (NOT deployed; "N followers" mis-parse fix)
b6226161183be2081a9a6a0321fef8983de39f69043114dfd581343303816848  workers/scout/src/instagramSource.test.ts
3f9aa7154391d6c962bc2dcc5be061c4d9181c8bfd6172c071d6003c05823971  scripts/native-live-harness.ts   (new; test tool, not shipped UI)
```
Also separate: the TikTok Accounts/Discovery music work merged to `main` from another
worktree (PRs #71 `3cb507f9…`, #72 `ec806792…`, #73 `a858c120…`; Worker routes
`/tiktokads/music-probe`, `/tiktokads/account/*`, `/tiktokads/music`), owner's Accounts API
form submitted 15 Oct, approval pending. No app UI for it exists in this worktree.

**Required deployed-Worker compatibility (review item for Codex):** the app in slice A talks
to the deployed Worker at `main a858c120…`, which lacks the worktree's `tiktokSource`/
`instagramSource` edits. The app schema treats TikTok `music` as optional
(`lib/discoverSources.ts` `music: z.object(...).optional()`, `evidence.sound` only when
present), so slice A must work with no music field and with the old followers parse; the
"N followers" fix is only in effect once the Worker is deployed from this branch.

### Evidence on the current hashes (nothing changed since)
Mocked/unit (vitest, this worktree):
- 15 Oct 16:03 AST, packet 27 GREEN: 33 files, 645 passed — components/research,
  components/discover, messages parity, lib trendingSounds/discoverSources/
  discoverNativeSearch. `scratchpad/p27/green.log` (RED: `p27/red.log`).
- 15 Oct ~14:50 AST, packet 25: `extensions/discover-import` 8 files 181 passed
  (native-search 76). Helper hashes unchanged since, so this still covers the helper.
  Report `scratchpad/packet-25-opus-report.md`.
- Earlier focused runs on the same files: packet 23 (9 files 392), packet 24 (13 files 367),
  packet 26 (39 files 835) — reports `packet-23/24/26-opus-report.md`.
- Lint `p27/lint.log` (eslint clean), typecheck app + Worker `p27/typecheck.log`, build
  `p27/build.log` → `out/discover/index.html` `3dc6f42a…` (file mtime 15 Oct 16:04), served
  on :3000 (verified 12:16 AST today).
- **Not run on these hashes: `pnpm e2e`.** The last Discover e2e (4 passed) was on an
  older export; `scratchpad/p28-e2e.log` is `studio.spec.ts` in another worktree. Pending.

Modified harness runs (NOT owner Chrome): installed Chrome 155 on :3100, helper COPY with
3 harness patches (trusted origin :3100, host permissions pre-granted, background.js
emulates "Chrome stays focused" with occlusion disabled), kept profile
`scratchpad/harness-profile` holding the owner's Instagram session:
- `harness-run-1.json` (helper 0.4.1, real OS focus), `-2.json` (0.4.2), `-3.json` (0.4.3,
  8 runs, finished 11:50 UTC 15 Oct): Deep 60/60/60 in 22 of 24 platform reads, all three
  platforms shown and Discover restored in every job; quiet ≈ IG 24 / TT 12 / YT 24–30.
- `p26-sounds-run-1..3.json`, `p27/sounds-run-1.json` (slice B).
Scratchpad root: `C:/Users/AORUS/AppData/Local/Temp/claude/C--Users-AORUS-Documents-hello-github/1f24b7e7-4e9f-40ef-ba49-290befb01772/scratchpad/`.

Unmodified owner-Chrome observations (helper versions older than 0.4.3):
- Owner foreground run 15 Oct 00:30 AST, helper 0.3.6: IG 24 (background runs gave 6),
  TikTok `read-failed` in ~2 s (fixed later by 22b/22c; not re-observed in owner Chrome).
- Owner reloads confirmed: 0.3.7 (09:39), 0.3.8 (11:02), 0.4.0 (13:05 AST, 15 Oct).
  Reloads of 0.4.1/0.4.2/0.4.3 NOT confirmed.
- Owner report "When I press deep research it opened a new instagram window" (fixed in
  packet 24; owner has not confirmed the fix).
- Claude-driven quiet reads in the owner's Chrome, unmodified helper 0.3.9/0.4.0 (15 Oct
  12:15–12:28 and 13:00 AST): DaVinci IG 6 (was 0), both sections all three platforms;
  Deep without foreground gave no extra volume (`window-not-focused`).
- Codex's own Chrome checks (Freeze 12/13, packet 18: Dbd5ji4uO9z preview repaired,
  DbAsdTFo5KJ unverified) cover older hashes; `ResultCard.tsx` `32dc51fe…` is unchanged.

### Pending live acceptance (Codex-owned; owner reload needed first)
1. Owner reloads helper 0.4.3 (`extensions/discover-import`, manifest `dd649649…`).
2. Quiet Search ("<skill>") opens no platform tabs; two sections "<skill> capcut" and
   "<skill> davinci resolve" (Instagram query "<skill> davinci"); no After Effects results
   with `editorScope: "mine"`.
3. Deep search with Discover in front: IG → TT → YT shown in turn, Discover restored, both
   sections near 60/60/60; leaving Chrome stops Deep with the app hint.
4. TikTok no longer `read-failed` in ~2 s (22b reload + 22c transient retry).
5. Instagram preview gap (Freeze 12 finding): second card DbAsdTFo5KJ still unverified.
6. `pnpm e2e` on export `3dc6f42a…`.
Open owner decisions: delete `scratchpad/harness-profile` (holds his Instagram session);
Codex should check Worker branch divergence (main deploys replaced Codex's hand-deployed
branch build) before any redeploy.


## Packet 15 — late-hydration order/loss repair (Fable plan, 14 Oct 11:20 AST)

**Status 14 Oct 13:44 AST: Freeze 12 live validation — changes required for Instagram
previews. The prior code review remains passing (97/97 independently; no unchanged checks
rerun). Perfume bounded initial/continuation parity and representative playback passed
on all three platforms; audio unassessed. Cars bounded identity/order parity and native
continuation also passed, but two verified Instagram cards still show "Preview unavailable.
Tap to watch." while their exact native search renders video previews. The first 24 native
Reel anchors have ready videos but no img or video poster. See the latest codex-review.md
section and discover-p17-cars-live-parity.json. Pause the remaining 10-category matrix
for this concrete P2 preview gap. Next bounded packet: Fable plans, one Opus/Sonnet
executor improves video-only Instagram cards using currently authorized native metadata/
embeds; preserve IDs/order and do not add automatic frame capture, undocumented API
scraping, AI uploads, billing or permissions. Delivered once to Training Page at
2026-10-14T10:47:26.256Z; message bubble and response starting verified, Fable5.1 High.
Implementation coordination handed to Claude for this bounded packet; Claude records
the selected single executor before edits. Codex owns independent review and the live
repair recheck. Delivery evidence is in codex-review.md; do not resend.**
Earlier: packet 17 frozen 13:12 AST (Freeze 12); source edits stopped at 13:08 AST.

**Status 14 Oct 14:20 AST: packet 18 frozen (Freeze 13: Instagram cards without a
picture ask the authorized local preview route without a Scout config); ready for Codex
review, build and live recheck of the two Cars cards. Implementation owner: none.**
Source edits stopped at 14:17 AST. App source changed, so the served export needs a
`pnpm build` in the worktree (Codex's step, as for Freeze 11) before the live recheck; no
extension change, no reload needed.

**15 Oct 18:51 AST — owner submitted TikTok's Accounts API Access Application Form ("Submitted"), with the personal-marketing use case and the 64 s demo video (ONUS-Content-Planner-demo.mp4). Still open on the owner's side: tick "TikTok accounts" in the app's Scope of permission with a reason, submit, and add the redirect URL `https://3z-scout.3zmd95.workers.dev/oauth/tiktokads/account/callback/`. After TikTok approves: fetch the connect link (`/tiktokads/account/connect?format=json`), owner authorizes, read `/tiktokads/music?country=SA&range=7`, then build the songs UI. No code change in this entry.**

**15 Oct 18:15 AST — owner granted Chrome control ("control chrome you have my
permission"). Claude opened the TikTok for Business app ONUS Content Planner → Edit →
Scope of permission: "TikTok accounts" carries a warning — "To request the Accounts API
scope, you must fill out the Accounts API Access Application Form. Failure to do so may
result in your Accounts and Business Messaging API approvals being rejected" — plus a
required "reason for updating permissions" and Submit (review). Claude did NOT tick or
submit anything (business application form + review = owner's decision), pressed Cancel;
app unchanged. Alternative proposed to the owner: TikTok Creative Center's public
"Trending songs" page (TikTok's own page, region/period filters) read by the helper in his
own browser like native search, no new API scope.

**15 Oct 17:55 AST — packets 29 and 29b merged and deployed.** PR #72
(https://github.com/3zmd95-glitch/hello-github/pull/72, merge `ec806792…`, deploy run
38753335785): `/tiktokads/account/connect`, `/oauth/tiktokads/account/callback/` (trailing
slash), `/tiktokads/account/status`, `/tiktokads/music?country&range&genre` (CML trending
list with the account token, 6 h KV cache, token refresh), probe tries the account token;
1036 Worker tests. PR #73 (https://github.com/3zmd95-glitch/hello-github/pull/73, merge
`a858c120…`, deploy run 38755604631): `?format=json` / `Accept: application/json` on the
account connect route returns `{ url }` so the dashboard session can fetch the link. Owner
steps sent (17:45 AST): tick "TikTok Accounts" scope + app logo, add account-holder
redirect URL `https://3z-scout.3zmd95.workers.dev/oauth/tiktokads/account/callback/`; may
trigger a TikTok re-review. After "done": Claude fetches the connect link from the owner's
app session (token never printed), owner authorizes once, then Claude reads
`/tiktokads/music?country=SA&range=7` (+ `genre=ARABIC_POP`). Reports: scratchpad
`packet-29-opus-report.md`, `packet-29b-report.md`. Worktree
`C:/Users/AORUS/Documents/hello-github-music-probe` kept (merged branches).

**15 Oct 17:25 AST — packet 28 merged and deployed (Opus): PR
https://github.com/3zmd95-glitch/hello-github/pull/71, merge `3cb507f9…`, `worker.yml` run
38749845190 succeeded. Includes a test-only fix: `e2e/studio.spec.ts` freezes the browser
clock to `SEED_WEEK` (1 Oct 2026) for the two empty-inbox tests (main had started failing
after 11 Oct because the seed is 27 Sep and `STALE_DAYS` is 14). Live probe (Claude, from
the owner's app session, token never printed), `GET /tiktokads/music-probe?country=SA&range=7`:
`/discovery/cml/trending_list/` → TikTok code 40105 "Access token is incorrect or has been
revoked" (needs a TikTok ACCOUNT token via `/tt_user/oauth2/token/` with `business_id` =
open_id, per TikTok docs); `discovery_type` MUSIC/SONG → 40002 (only HASHTAG allowed);
HASHTAG + `category_name=MUSIC` → 200 hashtags (e.g. اغاني, music, محمد_عبده) — hashtags,
not songs. Worker health after the deploy: `/discover/usage`, `/effects/trending`,
`/categories/coffee`, `/tiktokads/status` all 200. **Codex attention:** the two previous
Worker deploys (11 Oct, runs 38143707034, 38151982415) were dispatched by hand from
`codex/discover-inspiration` (~70 Worker files differ from main); this main deploy
replaced that build. Basic routes answer, but branch-only Worker routes may be gone —
Codex please verify which Worker the current app needs before any redeploy (rebase the
branch on main first so the probe stays). Next (owner's option 1 continues): packet 29 —
TikTok account connect (tt_user OAuth) on the same approved app + CML trending songs
route, Worker-only PR from main; the owner then presses one "Connect TikTok account".

**15 Oct 16:45 AST — OWNER DECISION "1" (16:40 AST): build the TikTok Discovery API music
probe on the owner's approved app, add the Worker route and publish it (owner's word
covers this Worker-only PR, its merge to main and the CI Worker deploy).** Packet 28
(Claude Opus, single writer) in a NEW worktree from `origin/main` (not this managed
worktree; its uncommitted Discover work must not ride along): research the official
Discovery API music endpoints, add an authenticated read-only probe route on 3z-scout,
tests, PR, CI green, merge, confirm deploy; then Claude calls the probe from the owner's
app session (token never printed) and plans the music feature from the real response.

**15 Oct 16:10 AST — packet 27 frozen (Freeze 23, Opus). Implementation owner: none.**
30-day "Seen in edits" tier (`trendingSounds(…, { seen: true })`, below the 14-day tiers);
"Refresh trending sounds" button (quiet TikTok + Instagram searches for 7 edit queries,
existing protocol, no helper change); harness `--refresh-sounds`. 33 files 645 passed;
lint, typecheck, prettier, build; export `3dc6f42a…`; hashes in scratchpad
`packet-27-opus-report.md`. TikTok recency: logged-out web search Top tab has no date
filter or URL param; Videos tab showed a slider security check (untouched); no recency
option added. Live refresh (241 s, 118 sounds read): 1 emerging sound (reused CapCut
"Headbop" template original sound, 2 creators, 2 categories, TikTok, 2026-10-10); nothing
trending/seen yet. Next options for the owner (decisions): (1) TikTok Discovery API music
probe on the owner's approved app — needs a Worker route and a deploy (merge/deploy
requires the owner's word); (2) keep pressing Refresh over days to accumulate sightings.

**Earlier 15 Oct 15:50 AST — packet 26 frozen (Freeze 22, Opus); packet 27 active (Claude Opus,
single writer).** Freeze 22: sound evidence from the already-fetched pages (TikTok public
page 129/129 reads name a sound + link; Instagram embed ~25% name a real song, ~75% bare
"Original audio" dropped), `lib/trendingSounds.ts` (14-day window, trending ≥3 posts/≥3
creators/≥2 categories, emerging ≥2/≥2, IG/TT 1.0, YT 0.5), bounded IndexedDB sightings
(≤2,000, 30 days), Browse block "Trending sounds in edits" with examples and honest note;
Instagram "N followers" mis-parse fixed with a test. 39 test files 835 passed; lint,
typecheck app+Worker, prettier, build pass; export `f4164d35…`; hashes and report in
scratchpad `packet-26-opus-report.md`. Live (6 searches + 2 repeats, kept profile): no
sound reached emerging/trending — only 37 of 314 sound-named posts were from the last 14
days (platform search ranks older top posts). Planner ruling for packet 27: (a) add a
30-day "seen in edits" tier (≥2 posts by ≥2 creators) while keeping 14-day trending/
emerging; (b) investigate in the harness whether TikTok web search exposes a "Date posted"
filter usable by URL/UI on the owned tab (official page UI only); if yes, the sounds feed
runs recent TikTok edit searches (this week/month) through the helper and reports the top
sounds; (c) Instagram has no date filter — keep its contribution as is. Owner reload not
needed for app-only parts; any helper change bumps the manifest.

**Earlier 15 Oct 15:10 AST — packet 26 implementation active (trending edit music, owner request
of 14 Oct 20:34). Implementation owner: Claude Opus (single writer).**
Plan (Fable): reuse the reads the app already makes per native card (no new provider, no
scraping of music pages): Instagram's public embed read (`instagramSource`) already parses
`audio { title, artist, url }`; TikTok's public page read (`tiktokSource`) has no music
field yet — add `music { title, author, url }` from the same already-fetched public video
page markup if present (official-page data only, same request, no extra fetch). Carry the
sound through `applyInstagramEvidence`/`applyTikTokEvidence` into `DiscoverItem.evidence`.
New pure module `lib/trendingSounds.ts`: aggregate sounds across the app's stored native
snapshots + enrichment (category feeds and Search sections), keyed by normalized sound
(title + artist, platform sound id/url when present), counting DISTINCT posts with real
post dates (postDate.ts) in the last 14 days, distinct categories, platforms (IG/TT weighted
first, YT welcome); "seen trending in edits" = ≥3 posts across ≥2 categories in 14 days,
otherwise "emerging". UI: a "Trending sounds in edits" block on Discover (Browse) — sound,
artist, platforms, N posts / M categories with the latest date, 3 example edit cards
(playable via existing ResultCard), link to the sound on its platform; honest note that
counts come from the videos Discover has read, not a platform chart. No paid services, no
AI uploads, no new permissions. Tests RED first; harness check: run 6 category feeds/
searches with the kept profile and report the top sounds found.

**15 Oct 14:55 AST — packet 25 frozen (Freeze 21, Opus). Implementation owner: none.**
Root causes: (1) the live "only Instagram shown" was the owner switching to DaVinci Resolve
~3 s after Instagram came up (foreground log) — the helper correctly stopped (new
permanent `diagnostics.focus.stopped` reason, e.g. `window-not-focused`, `tab-activated`,
`tab-navigated`); (2) real gap fixed: selecting Discover or one of this job's own tabs no
longer ends focus handling (activation event and pre-switch check accept owner + owned
tabs); an owned tab navigated off its search stops with `tab-navigated`; (3) Instagram URL
rewrite and second-job eligibility were not causes (guard test added). 7 new tests (6 RED
first), native-search 76 passed, extension folder 181 passed; lint, typecheck, prettier
(re-verified), build. Hashes: `native-search.js 1a3b8712f7b9766a487ff1b11f2adde9ba8cc217716001d86b4782754f91377b`,
`native-search.test.ts a4c6187bf87311ab2eb4b76b3c369a328d73da83e7a38df2bed4daf7f811465e`,
`manifest.json dd6496496a5d4a8f5ee621ba9f7b4ce2d549cd361556558343a9d0deeeea4400` (0.4.3),
`scripts/native-live-harness.ts 5730c1b656da7430de0d4e8f0034e0da9c9526b8f68c80995035ee31ec2da4bf`;
export `e0b2013e5d35d3c005d952ab40e9f4af1daea3aa58e4f1733a831109f1c4f884` (no app source
change). Harness run 3 (helper 0.4.3, kept profile, `--os-focus` off: helper copy treats
the Discover window as focused and Chrome occlusion is disabled so runs don't pull focus
from the owner; tab switching/URLs/restore real): Deep — clone effect 60/60/60 + 60/60/60,
speed ramp 60/60/60 + 60/60/60, text tracking 60/48/60 + 60/60/60, glitch transition
60/60/60 + 60/23/60 (22 of 24 platform reads hit 60; all three platforms shown and Discover
restored in every job; ~80–95 s per section); Quiet — 24/12/24–30 per section, no tabs
shown. Report: scratchpad `packet-25-opus-report.md`, `harness-run-2.json`, `-3.json`.
Planner rulings: keep the "user left Chrome → Deep stops" rule (an occluded Chrome window
does not render more posts, so loosening it gains nothing in real use; the app hint
covers it); CapCut-section More after the DaVinci job starts goes through the existing
expired-job resume path (not re-tested live). 14:53 AST: localhost:3000 was found DOWN
(not stopped by Claude); restarted detached from the MANAGED worktree (`pnpm local:serve`,
log Temp `3z-local-serve-managed-2026-10-15.log`); `/discover/` 200 serving `e0b2013e…`,
`/api/local-ai/instagram-preview` 200. Owner must reload helper 0.4.3. The harness profile
still holds the owner's Instagram session (scratchpad `harness-profile`).

**15 Oct 14:00 AST — packet 24 done (Opus): owned tabs always open in the Discover tab's
window (live: 36/36 tabs, 0 new windows); Deep without focus → quiet budget + hint
(`deepSkipped`); helper 0.4.1; harness `scripts/native-live-harness.ts` (installed Chrome
155, fresh or `--profile` dir, helper copy trusting :3100 with host permissions pre-granted,
app on :3100). 13 focused files 367 passed; lint, typecheck, prettier, build pass; export
`759ee06f…`. Live harness (owner logged into Instagram in the harness window; profile kept at
scratchpad `harness-profile`, holds his Instagram session — delete when done): quiet ≈
IG 24 / TT 12 / YT 30 per section in ~30 s, 0 failures; Deep with Discover in front: CapCut
section **60 / 60 / 60** (~90 s) but the helper activated only Instagram, never restored
Discover, so the DaVinci section fell back to quiet (`window-not-focused` /
`owner-not-selected`). Packet 25 (Opus): fix deep focus sequencing so all three platforms in
both sections get shown and Discover comes back, iterate on the harness until both
sections reach the deep target. Changed assertions in packet 24 listed in scratchpad
`packet-24-opus-report.md`.

**15 Oct 13:20 AST — OWNER DIRECTION:** "Do all the testing yourself. locally it doesnt
have to be in chrome" / "Leave me out of it untill you reach the goal" / "When I press deep
reseach it opened a new instagram window". → No more owner asks until the goal (native
IG/TT/YT results in platform order, high volume, DaVinci Resolve + CapCut only, quiet
Search, explicit Deep search) is reached. Packet 24 (Claude Opus, single writer):
(1) owned platform tabs always open in the originating Discover tab's own window
(`windowId` from `ownerTabId`), never a new or other window, quiet or deep; (2) Deep
requested but focus not eligible → quiet budget + `deepSkipped` flag → app hint "Keep
Discover in front while Deep search runs"; (3) a local live harness
(`scripts/native-live-harness.ts`, Playwright headed Chromium with the unpacked helper,
fresh profile, app served from `out/` on port 3100, never 3000) that runs skill searches
quiet and deep against the real public TikTok/YouTube/Instagram search pages and writes
per-platform counts/diagnostics JSON — Instagram may require login in a fresh profile;
report that honestly instead of using the owner's credentials. Then iterate fixes on the
harness evidence.

**15 Oct 13:05 AST — helper 0.4.0 reloaded by the owner ("done. 0.4.0").** No Deep search
had been recorded (IndexedDB search slots unchanged since 08:56 UTC). Claude pressed Deep
search for "clone effect" from the automated tab (13:00 AST): focus `eligible: false,
skipReason: "window-not-focused"` (no tabs shown), CapCut IG 6 (`timeout` 40 s, done) / TT 0
(`error`, `timeout` 40 s) / YT 8; DaVinci IG 6 / TT 23 / YT 8 (`scroll-cap` 31–39 s),
233 s total. So Deep search without visible tabs gives no extra volume and is ~2.5× slower
than quiet; the gain (IG 24 instead of 6 seen on the owner's earlier foreground run)
requires the owner's own foreground Deep search. Proposed follow-up (not yet built, to
bundle with the next helper change): when Deep is requested but focus is not eligible,
run the quiet budget and tell the app, which shows "Keep Discover in front while Deep
search runs to load more videos".

**Status 15 Oct 12:30 AST: packet 23 frozen (Freeze 20), app built and served (export
959baa05…), helper 0.4.0 needs the owner's reload for parts B/C. Implementation owner:
none.** Freeze 20 (Opus, single writer; 13 tests RED first; 9 focused files 392 passed;
lint, typecheck, prettier — re-verified — and build pass): A `editorSearches` gives the
DaVinci section `igQuery` "<skill> davinci" (TikTok/YouTube "<skill> davinci resolve";
typed "… davinci resolve" → Instagram drops "resolve"); B collector returns
`{status:"empty", noResults:true}` on a rendered no-results screen in `<main>` (Instagram
"No results" + "We couldn't find anything" verified live; TikTok/YouTube wording assumed),
helper ends the platform at once (`stopReason "no-results"`); C a cap with 0 cards and no
no-results screen ends `error`/`search-timeout` (stop reason `timeout`) → "couldn't read"
with stale-card retention; D new copy `feed.connectedPlatformNoResults` ("no videos for
this exact search", AR/EN). Changed assertions: native-search "bounds empty/loading
retries" now expects `error`/`search-timeout`; ResearchPanel DaVinci calls use Instagram
"clone effect davinci"; editorFilter DaVinci entry gained `igQuery`. Hashes (report:
scratchpad `packet-23-opus-report.md`): `lib/editorFilter.ts af7886b0…`,
`lib/editorFilter.test.ts 6f446d10…`, `lib/discoverNativeSearch.ts 359d2f90…`,
`lib/discoverNativeSearch.test.ts bcbad022…`, `ResearchPanel.tsx 516adc3f…`,
`ResearchPanel.test.ts b42a8510…`, `NativeKeywordResults.tsx bb73f19d…`,
`NativeKeywordResults.test.tsx 8698a78e…`, `CategoryDiscovery.tsx d0c0a93e…`,
`CategoryDiscovery.test.tsx 6c81304e…`, `native-capture.js 4ffe6e85…`,
`native-capture.test.ts dcde6f14…`, `native-search.js f56b5741…`,
`native-search.test.ts da5bbb17…`, `manifest.json 31d7f95f…` (0.4.0),
`feed.en.json 93b09dca…`, `feed.ar.json d2686494…`.
Live (Claude, 12:15–12:28 AST, quiet, helper still 0.3.9): DaVinci sections now query
Instagram "clone effect davinci" / "glitch transition davinci" and receive IG 6 (was 0 after
a 25 s timeout); "glitch transition" both sections all three platforms received (CAP 6/24/8,
DAV 6/24/8, 117 s). Remaining known limit: quiet Instagram returns its first row (6) per
section because the helper's tab stays in the background; Deep search is the volume path
and still needs the owner's foreground run to be measured.
**Earlier 11:55 AST: packet 23 implementation active — OWNER REQUEST (11:19 AST):
"make a through testing and fixing to make this work". Implementation owner: Claude Opus
(packet 23, single writer: helper + app).**

**Thorough quiet sweep (Claude, owner's Chrome, helper 0.3.9 confirmed by diagnostics
fields, 11:25–11:48 AST, 8 skills × CapCut + DaVinci sections, received IG/TT/YT):**
clone effect CAP 6/19/8, DAV 0/23/8 · speed ramp 6/24/8, 6/12/8 · smooth slow motion
6/30/11, 6/24/8 · glitch transition 6/24/8, 0/24/8 · text tracking 6/24/8, 6/12/8 · shake
effect 6/12/30, 6/12/8 · color grading 6/12/4, 6/12/30 · mask transition 6/19/8, 6/24/11.
80–93 s per skill (both sections); TikTok and YouTube received in all 16 sections (the
TikTok 2 s failure is gone — "speed ramp davinci resolve" now TT 12); every section showed
24 cards, 0 missing thumbnails; "other editing apps" hidden 0–4. Instagram: exactly 6 in
14 sections (background first row only; foreground/Deep gives 24) and 0 in 2 DaVinci
sections after a 25 s `timeout`, labelled "no cards read". Root cause verified in a normal
tab: Instagram keyword search returns **"No results — We couldn't find anything"** for
"clone effect davinci resolve" and "glitch transition davinci resolve", but **24 posts**
for "clone effect davinci" and "glitch transition davinci".

### Packet 23 plan (Fable, 15 Oct 11:55 AST)
A. DaVinci section: Instagram query "<skill> davinci" (TikTok/YouTube keep "<skill>
   davinci resolve"); the helper already accepts per-platform queries. Typed text that
   already names DaVinci keeps the owner's words except the same Instagram shortening.
B. Collector: detect each platform's rendered "No results" screen (Instagram "No results"
   + "We couldn't find anything"; TikTok/YouTube equivalents if present) with zero cards →
   `{ status: "empty", noResults: true }`; the helper ends that platform at once (stop
   reason `no-results`) instead of waiting 25–40 s; app status line "no videos for this
   exact search".
C. F11: a platform that times out with 0 cards and no "No results" screen ends as a failed
   read (`timeout`), so the label is "couldn't read" and stale cards are retained.
Manifest 0.3.9 → 0.4.0. Tests RED first; focused checks + build; Claude reruns the sweep.

**Earlier status 15 Oct 11:15 AST: packet 22c frozen (Freeze 19: a resolved injection without a
card list is a transient miss; `lastInjectionError` recorded); helper 0.3.9 needs the
owner's reload; no app change. Implementation owner: none.**
Evidence (11:02 AST, helper 0.3.8 reloaded by the owner, quiet job "speed ramp davinci
resolve"): TikTok again `read-failed` in ~2 s with no `transientErrors` and no
`serviceErrorReloads` (so neither F12 nor 22b applied); IG 6, YT 30 (`target` 3 s). The
FULL helper collector injected by Claude into a normal TikTok tab for the same URL returned
`done` with 12 cards, no exception. Conclusion: in the helper, `executeScript` resolves
without a result list (in-page exception or frame replacement in a background tab), which
hit the immediate `read-failed` throw. Freeze 19 (Sonnet, 2 tests RED first;
native-search + native-protocol 76/76; lint, typecheck, prettier — re-verified): that case
is now transient (1 s wait, retry until the cap, `transientErrors`), with
`diagnostics.lastInjectionError` = Chrome's injection error message or "no-result"
(≤200 chars); every attempt without a list → `read-failed` at the cap. The unreachable
throw was removed; no existing test changed. Hashes: `native-search.js 83aec32f0d0d7e720d0941c6abc7e716172c9a143a480cfa03e3b019d2e9ad0a`,
`native-search.test.ts bb49c335343c33e93c1df113bab9e8574bfd658b4d04d35a62d7ced944eedba4`,
`manifest.json 1bd7fbcd319ed75eb016883ebbbe3a0674f109ca53552ea102fc8a87f158d029` (0.3.9).

**Earlier 10:05 AST: packet 22b frozen (Freeze 18: one reload of the helper's own
tab on a platform search-error screen); helper 0.3.8 needs the owner's reload; no app
change (served export unchanged, 21731385…). Implementation owner: none.**
Freeze 18 (Sonnet, single writer; 5 tests RED first; `native-search` + `native-protocol`
74/74; lint, typecheck, prettier — re-verified by the planner): on `search-service-error`
the first time per platform per job the helper sets `serviceErrorReloads: 1`, calls
`api.tabs.reload` on its own owned tab, checks cancellation, keeps reading within the cap;
a reload rejection → `read-failed`; persistent error → `error`/`read-failed` at the cap
(25 s quiet / 40 s deep instead of ~2 s); `needs-attention`/other errors unchanged. No new
permission (manifest permissions unchanged: activeTab, scripting, storage, alarms). The
packet-17 test was renamed "maps a persistent source-error screen to a failed TikTok read,
not empty, after one reload" (status assertions kept; "exactly 1 read" replaced by "exactly
1 tabs.reload" and ">1 TikTok read"). Hashes: `native-search.js bdc6220a9113f37f8cf07a96ff216254e6dedb76ae50b6e1deadb323deaf5473`,
`native-search.test.ts 3a91a6b6dac7197130dbf4ed73cff16e3826e2f4c1f79cf261aa968ebe1a8539`,
`manifest.json 3a7836e407422bb5bd69c3807a9e386a561a1967fdeccc05888fd9298face419` (0.3.8).
**Earlier 09:55 AST: packet 22b implementation active (TikTok first-load server
error recovery). Implementation owner: Claude Sonnet (single writer, helper files only).**
Owner reloaded 0.3.7 ("its 0.3.7", 09:39 AST). Claude's quiet checks (09:41 AST, no tabs
brought to the front, focus `skipReason: "quiet"`, 38 s each): "speed ramp davinci
resolve" → IG 5 / TT 0 (`read-failed` in 2 s, third time on this query, F12 retry did not
apply) / YT 8; "clone effect" CapCut section IG 5 / TT 30 / YT 8. Diagnosis: the helper's
collector, injected into a normal TikTok tab for the same query by Claude, returns 12 cards
(so not a collector exception, not `search-page-changed`); a 2 s `read-failed` with no
transient errors matches the collector's packet-17 `search-service-error` result (TikTok's
own "Something went wrong / Try again" screen, which Codex saw live in a helper tab on
Perfume and which TikTok's Try again button cleared). Packet 22b: on `search-service-error`
the helper reloads ITS OWN owned tab once per platform per job (`tabs.reload`), keeps
reading until the platform cap, and reports the failure only if it persists; diagnostics
`serviceErrorReloads: n`. No focus change, no new permissions; one reload, not a loop
(owner's volume/results priority; Codex's no-automatic-retry-loop rule respected).

**Earlier status 15 Oct 00:55 AST: packet 22 frozen (Freeze 17: quiet Search vs explicit Deep
search + F12 transient-injection retry); app built and served; helper 0.3.7 needs the
owner's reload. Implementation owner: none.**

### Freeze 17 (15 Oct 00:55 AST) — packet 22 (Opus, single writer)

Owner's foreground run before this packet (00:30 AST, "speed ramp davinci resolve", old
0.3.6, read by Claude without driving the screen): focus eligible, IG activated → IG 24
(background runs: 6); TikTok `read-failed` in ~2 s for the second time on this query while
a normal TikTok tab rendered 12 videos for it → F12 added to this packet.
Change: protocol `search.deep?: boolean` (validated); quiet jobs (default) never call
`beginFocus`/`focusOwnedTab`/`restoreDiscover` (diagnostics `skipReason: "quiet"`), fast
budget (initial target 30, no scrolling, 25 s; More ≤4 background scroll cycles, 25 s);
deep jobs keep the 0.3.6 behaviour; `more` inherits the mode; restored jobs without the
field are quiet. F12: a rejected `executeScript`/transient `tabs.get` is a transient miss
(wait 1 s, retry until the cap; `transientErrors` counted); a removed tab, cancellation,
page change and collector-reported attention/error stay terminal. App:
`useNativeSearch.search(queries, { deep })`; Search tab "Deep search" button
(`discover-deep-search`) beside Search with a hint; category feed "Deep search"
(`native-deep-search`) beside "Search all three"; entry/typed searches quiet; CapCut/
DaVinci sections share the mode; Load more in a deep run stays deep. Manifest 0.3.7.
Tests RED first (helper 33 failed / app 25 failed), then 10 focused files 366 passed;
lint, typecheck, prettier (re-verified by the planner), build pass. Concerns: until the
owner reloads 0.3.7 the old helper treats every search as deep (tabs may pop) and Deep
search fails as `invalid-request`; normal Search returns pre-0.3.6 volumes (~6/24/8),
volume comes from Deep search / Load more; a platform whose every read is rejected now
reports `read-failed` only at the cap (25 s quiet, 40 s deep); Deep search button shows
whenever a helper is installed.

```
f52f324f2fdc48532cbe19ee4c35ad8e076744374b82c0ca5785e48783f2d79e  extensions/discover-import/native-protocol.js
bc33ba544b1cfb8b50b143bb2250d002b78ec3b2d51431c04e76d51578ab5590  extensions/discover-import/native-protocol.test.ts
b005ed623938420579364e846962a04ef83ef42c5a166e583b710e85fd12176f  extensions/discover-import/native-search.js
18598cc54f5f4aaa20993c3c85b6c19b31b2f1fb565bec5d6e40af53747b451c  extensions/discover-import/native-search.test.ts
7644b96977288a2f542edfb7d26b080a12cafac1330eea6b317f1553019ad3c7  extensions/discover-import/manifest.json
ce5612e1de3aa9e5d61102ed28f53b56ccfadca47b136fffdafe258d783c8dcf  lib/discoverNativeSearch.ts
6f75d3511d582f170c2ae4bbf31b514764e5c5a47f6c22456e05c2fdc7acd2ce  lib/discoverNativeSearch.test.ts
de398aed173e060c31f1aa35bab3e30e172db5389341484363fc9bdcef02a3c3  components/research/useNativeSearch.ts
b6660736689e2a4d49c529c05a1482f6d16d93d19b842e84d3a0bd45345de8aa  components/research/useNativeSearch.test.ts
cb18b0736ade62b7d6e86be68fb0cda72d21093fb0b3774c59a63ea963ee458d  components/research/NativeKeywordResults.tsx
7bdea2f7ade4fe536c798d98df376ec7ecd6e203c8b1aea8f4b15249573cbc3b  components/research/NativeKeywordResults.test.tsx
74cc862bee7958808ee41eca36a40960f28b810f03e38a0280bb7657b03cd283  components/research/CategoryDiscovery.tsx
25eb515727ae55d78f6e30818e0a21d17feaade97a9b3eb470b86862cc3f51cb  components/research/CategoryDiscovery.test.tsx
4b553df3c55aa33322a8da7a9bdc247a8f02ea45a4a23eec04bf59c34ee9b784  components/research/ResearchPanel.tsx
b5dd387a66663c9a9339aa21c08a16c2311f733aa3e8a69e383cd8f0ec394d68  components/research/ResearchPanel.test.ts
b0e91ab8447d1e4a49864e0a478ae3b3480135a89d363bf8f8032af528cad879  messages/search.en.json
37000de2d486b61cfffd2c0715d4ddaab466e4587e8a75a8e85071c1def27a67  messages/search.ar.json
a7ff802563ead75cb19fa55035eb4f9fac7e578eecd7d0822698718542b7fd06  messages/feed.en.json
f1261f2f279f9c2f500328abb161a7e7eabf5ae8d7faec91075407f57be51846  messages/feed.ar.json
```
Served export = worktree `out/discover/index.html`:
`217313857e02535d709d75d457cbe972844fc6ed3c39d12d06e3f19432322120`. Report: scratchpad
`packet-22-opus-report.md`. Next: owner reloads 0.3.7; Claude reads one quiet and one deep
search; then packet 23 (trending music).

**Earlier status 15 Oct 00:32 AST: packet 22 implementation active — OWNER REQUEST (00:28 AST,
with screenshot of "speed ramp davinci resolve" loading): "When I press search an
instagram and tiktok and youtube pop out comes in browser i should have a seperate button
that does that besides instagram and tiktok and youtube not the search button".
Implementation owner: Claude Opus (packet 22, single writer: helper + app). Trending music
moves to packet 23.**

### Packet 22 plan (Fable, 15 Oct 00:32 AST) — quiet Search vs explicit Deep search

Rule: the normal Search button (Search tab and the category feed's auto/typed search)
never brings Instagram/TikTok/YouTube tabs to the front; a separate button "Deep search —
opens Instagram, TikTok & YouTube" does, to load many more videos. Helper protocol: the
`search` message gains `deep?: boolean` (default false, validated in native-protocol).
Quiet job (deep false): no `beginFocus`/`focusOwnedTab`/`restoreDiscover` at all (focus
diagnostics `skipReason: "quiet"`), owned tabs stay in the background, the pre-0.3.6 fast
budget (initial: no scrolling, target 30, 25 s cap; More: up to 4 background scroll
cycles, 25 s). Deep job (deep true): today's 0.3.6 behaviour (guarded activation when the
owner window/tab is focused and selected, initial scroll cycles, target 60, 40 s cap).
`more` inherits the job's mode. App: `useNativeSearch.search(queries, { deep })`; Search tab
and CategoryDiscovery get a "Deep search" button beside Search / Search all three
(`discover-deep-search`, `native-deep-search`), with a one-line hint "Opens the three
apps in new tabs for a moment to load more videos"; the CapCut/DaVinci two-section flow
uses the same mode for both sections; Load more in a deep section stays deep. Copy keys
AR/EN parity. Manifest 0.3.6 → 0.3.7 (owner reload). Tests RED first: quiet job never
calls tabs.update/windows.update and reads with the fast budget; deep job activates when
eligible; protocol rejects non-boolean `deep`; Search button → `deep: false`, Deep button →
`deep: true`; category auto search is quiet. Focused checks + build; Claude measures one
quiet and one deep search live (counts read without driving the screen).

**Earlier status 14 Oct 21:20 AST: packet 21 frozen (Freeze 16: 21a helper volume 0.3.6 + 21b
DaVinci Resolve & CapCut scope), app built and served; live volume check pending the
owner's helper reload. Implementation owner: none.**

### Freeze 16 (14 Oct 21:20 AST) — packet 21 (Opus 21a then Opus 21b, one writer at a time)

21a helper hashes: `native-search.js 88624b9962526491957b0aa37649f3faefff7ea5a9897d9cf7797bc8115222c3`,
`native-search.test.ts 04ef9b4075512c1332ac553ff1f11de2f0cc6f9403b5a5e1e255238992da7213`,
`native-capture.js 1aa9556ee022ae082c8ee4ce3fca560d41087953fb94996d982bc546e1954b08`,
`manifest.json 521acdea7e48154127e14bb422476c6f625ece2e85c770f4758dc7bbe5388d9b` (0.3.6).
21b (all RED first; 8 files 403 passed; lint, typecheck app+Worker, prettier — re-verified
by the planner — and build pass): `lib/editorFilter.ts` (`MY_EDITORS` DaVinci Resolve +
CapCut; `OTHER_EDITORS` after effects/AE cues, premiere pro, final cut, alight motion, vn
editor, filmora, inshot, kinemaster, vegas pro, powerdirector, lumafusion, splice app;
a card naming another app is hidden unless it also names DaVinci/CapCut; no app named →
kept), store `settings.discover.editorScope: "mine" | "all"` (default mine; old
`hiddenEditors: []` → all), checkbox "Only DaVinci Resolve & CapCut (hide other editing
apps)" (`discover-editor-scope`), hidden line "N hidden · other editing apps"; Search tab
scope mine + helper → two sequential native searches "<skill> capcut" then "<skill>
davinci resolve" in two sections (cache slots `search-capcut`, `search-davinci` beside the
12 categories); typed text already naming capcut/davinci → one search; scope all → plain.
Changed existing assertions listed in scratchpad `packet-21b-opus-report.md`.

```
ca15ff332a90ca1f4eac8ebec7c23080d4140c2c8613f571cca4d5d7d040c3b7  lib/editorFilter.ts
1395b81653b4bcbca01305d536735a63e9482cf2a46e0c75a6b51bf20d5b25c8  lib/editorFilter.test.ts
4888a1b20d5c341d91de3057196bcf2e78a19e32d82950af2f9639c9d1befa34  lib/discoverNativeSearch.ts
06462198f2159a8dd03f7a209541b518b9d4d27aed68e5952ed2326c05774082  lib/discoverNativeSearch.test.ts
dcaae152e23a9ed50965b1389b25e4b5db82cee1bdb88f3a2eb886bc931d16d9  lib/domain.ts
1f812dc8ae50ab3e8fdf3401f06857e83a94e847244f3b3ff9ce250df7b15cc7  store/index.ts
29d9f0ddab600f161eec80c154f6258242948df0d2d057641443804554250363  store/index.test.ts
6ba231aeac90a4f29ebcb48d4f7651a92960c58369e191caa0ef5a019c08a41c  components/research/NativeKeywordResults.tsx
fc0af4dc9f88d7a7245d0e2bbb8c4bce7e743055a48e9015e086f97038015a42  components/research/NativeKeywordResults.test.tsx
e55c0417e481c8fe7f817a1d136296fda14d55fece061d85b2201cf5dc72d3e5  components/research/ResearchPanel.tsx
b17f339ebf33ec170cb6a1fc5ee6b92f81b0bfb8c8d3749ab3d82975d2edf688  components/research/ResearchPanel.test.ts
3d611b78d31a21f9151bc83ed80e76516b6f6064154b6e08e19fae9aa09c3c25  components/research/CategoryDiscovery.tsx
e7089c69d985734c9021ed38e2b1bd29463edbc1aa625ab94ec0ae537ec95b79  components/research/CategoryDiscovery.test.tsx
c3f25e9238aa73d523184cecb8f72062e9a8e913fb103b14ee7c7f9c439d58cb  components/research/CategoryDiscovery.sources.test.tsx
9fb1ad33e19b1f765090c9bbf7bd15c4009dd9a331653851ccc586209dcfb548  messages/search.en.json
e49b08e669a217621f236e8966c97aee89a9795bd5035d906fb1fc1ad7f7edb4  messages/search.ar.json
bf4487083da7f8d33972a02de0be2c949f411f99945a3b9c66d205fbbfb0f5fd  messages/feed.en.json
97f086579d2449112bba3f27c427614bd1fd211e4af3a60a33727c450539313d  messages/feed.ar.json
```
Served export = worktree `out/discover/index.html`:
`d8580baacb336e350cd41636ca592670d4148e44eded625d4da28b8d6afcab75`.
21b concerns (recorded): the cross-section job lock is prop-based (one render late; a
same-frame double trigger could start two jobs; helper caps parallel jobs); two sections
roughly double search time and can repeat a post in both; bare "premiere"/"splice" are not
hidden (need "premiere pro"/"splice app"); `editorLabel` and `dropHiddenEditors().editors`
now unused but kept; e2e `discover-creator.spec.ts:377` not run.

**Claude live check (owner's Chrome, 21:03–21:18 AST, export d8580baa, Saved 3):** 4 skills
(clone effect, speed ramp, smooth slow motion, glitch transition), each two sections in
82–92 s; every section 24 cards shown (display reveal), no duplicate cards; titles naming
CapCut/DaVinci 18–22 of 24 per section; "N hidden · other editing apps" 0–2; Instagram
failed in the DaVinci section twice (`timeout`, "no cards read"). **The installed helper
is still the old build** (stop reasons `quiet`/`hydrated-quiet`, 25 s IG timeout; cached
counts IG 6 / TT 24 / YT 8 unchanged), so 21a's volume increase is NOT yet verified: the
owner must reload the unpacked helper (0.3.6); then Claude re-runs the sweep.
Implementation owner: none.

**Re-run after the owner's reload ("Updated to 0.3.6", 21:47 AST), 21:48–22:05 AST, same 4
skills, helper confirmed new (stop reasons `scroll-cap`/`target`, 40 s caps); counts are
cards RECEIVED per platform (IndexedDB snapshot), not just the 24 displayed:**

| Skill | CapCut IG / TT / YT | DaVinci IG / TT / YT | Time |
| --- | --- | --- | --- |
| clone effect | 6 / 31 / 8 | 0 (IG timeout 40 s) / 47 / 60 | 209 s |
| speed ramp | 60 / 24 / 8 | 6 / 0 (read-failed 0 s) / 0 (read-failed 0 s) | 137 s |
| smooth slow motion | 6 / 19 / 11 | 6 / 24 / 8 | 217 s |
| glitch transition | 6 / 24 / 29 | 0 (IG timeout 40 s) / 24 / 4 | 214 s |

Before (old helper): typically 6 / 24 / 8 per section. Scrolling sometimes works (YT 60,
IG 60, TT 47 once each) but mostly not, and searches got ~2.5× slower. Every job ran with
focus `window-not-focused` (automated Chrome window in the background), so the helper's
platform tabs were never shown; Instagram/TikTok lazy-load more posts only in a visible
tab. Claude asked the owner (computer-use) to allow bringing Chrome to the front for one
foreground test; **the owner denied it**, so foreground behaviour (where the helper briefly
shows each owned tab, as Codex measured IG 24 → 54 → 84 in packet 8) is still unmeasured for
packet 21. New findings: TT and YT `read-failed` within 0 s on "speed ramp davinci
resolve" (cause unknown; possibly tab replacement between the two sequential jobs); IG
`timeout` with 0 cards still labelled `empty` (F11). Next: a foreground measurement by the
owner (one search with Chrome in front; Claude reads the counts), then decide between
(a) keeping the 40 s/4-scroll budget only when the helper can show its tabs and the old
fast budget otherwise, or (b) a different visible-tab strategy — no focus stealing.

**Earlier status 14 Oct 20:40 AST: packet 21 implementation active — OWNER REQUEST (20:33 AST):
"the platforms has more videos about each skill. So there is a problem in searching ...
it should be way higher than the results we got. So please fix it. And again, I don't want
After Effects. My main editing software is DaVinci Resolve and CapCut on mobile only ...
when I search for the clone effect and I get an After Effects tutorial, I don't want that.
I want only that DaVinci Resolve and CapCut results." Implementation owner: Claude Opus
(packet 21a helper volume, then 21b editor scope; one writer at a time).**

### Packet 21 plan (Fable, 14 Oct 20:40 AST) — more results, DaVinci Resolve + CapCut only

Cause of low volume (code + live diagnostics): the helper's INITIAL read never scrolls and
stops at `target = 30` per platform (`native-search.js:303`, scroll only when `more`);
background tabs render only the first row (IG often 6); More then needs focus. The app
shows 24 at a time. So each search returns at most ~30 per platform, usually 6–24.
21a (helper, Opus): the initial read also scrolls its own owned search tab in bounded
cycles (same mechanism as More: after the hydration/quiet window, up to 4 scroll/read
cycles), initial target 60 per platform, More target stays 30 (more cycles allowed: 4),
per-platform time cap for the initial read 40 s (More 25 s); results stream into the
snapshot as they arrive (existing persist per read), so cards appear progressively. No
focus stealing change, no new permissions; owned tab only; cancellation/page-changed/
user-tab guards unchanged. Manifest 0.3.5 → 0.3.6 (owner reload).
21b (app, Opus): editor scope "Only DaVinci Resolve & CapCut" (on by default, replaces the
After-Effects-only toggle; keeps the persisted setting compatible): (1) the Search tab
runs two native searches for a typed skill — "<skill> capcut" then, when it completes,
"<skill> davinci resolve" — shown as two sections "CapCut" and "DaVinci Resolve", each
with its own platform tabs, status lines, continued loading and cache slot
(`search-capcut`, `search-davinci`); (2) every native/keyword card naming another editing
app is hidden (after effects, premiere pro, final cut, alight motion, vn editor, filmora,
inshot, kinemaster, vegas pro, powerdirector, lumafusion, splice), cards naming DaVinci/
CapCut or no app stay, with "N hidden · other editing apps"; the same filter applies to
category feeds. Turning the scope off restores today's single plain search and no filter.
Owner reloads helper 0.3.6 for 21a; Claude re-runs the 7-skill sweep live and records
volumes before freezing for Codex.

**Packet 21a result (Opus, single writer, 14 Oct 20:41–20:50 AST):** 9 new/updated tests
RED first; `native-search.test.ts` + `native-capture.test.ts` 69 passed; lint, typecheck,
prettier clean. `native-search.js`: `INITIAL_CAP_MS = 40000`, `MORE_CAP_MS = 25000`,
`SCROLL_CYCLES = 4`; initial target 60 (More 30); one scroll rule for initial and More —
the initial read scrolls only its own owned search tab after the settle rule (8 s since
first read + 4 s quiet, or the 18 s IG hydration window), max 4 scrolls (`scroll-cap`);
loop/attempt caps 40 s/40 initial, 25 s/25 More; snapshot persists after every read.
Existing assertions updated to the owner rule (listed in scratchpad
`packet-21a-opus-report.md`: collector limit 30→60, quiet/delayed-rows tests now expect
scroll times and `scroll-cap`, hydration test up to 40 s with no scroll inside the window,
diagnostics `elapsedMs` 40000, More quiet 4 cycles at 19 s, empty-page read limit 40,
stalled-read timeouts 40 s). `native-capture.js` comment only; `manifest.json` 0.3.6.
Concern: a non-growing page now takes ~38 s (IG) / ~28 s (TT, YT); worst case ~120 s for
three platforms (cards stream in progressively; the app has no overall job timeout — only
per-message send timeouts, checked by the planner). Hashes: `native-search.js 88624b99…`,
`native-search.test.ts 04ef9b40…`, `native-capture.js 1aa9556e…`, `manifest.json 521acdea…`.
Owner must reload the unpacked helper (0.3.6) before the live sweep. 21b (app) dispatched
next as the single writer.

**Queued next (OWNER REQUEST 20:34 AST, after packet 21):** "work on the trendy music on
edits. Like, every trend has a trendy music. This trendy music and on TikTok and on
Instagram. I want the trendy stuff to be mainstream on Instagram and TikTok more than
YouTube. That's my focus. But YouTube is welcome too. But I want you to focus on the trendy
things that happen on TikTok and Instagram in terms of editing and content creation."
→ packet 22: trending edit music (audio) on TikTok and Instagram first, YouTube second;
official/public sources only; plan after packet 21 freezes.
Research (Sonnet, read-only, 14 Oct 20:37 AST; full notes: scratchpad
`packet-22-music-research.md`): TikTok's API-for-Business page says the Discovery API covers
trends in Commercial Music Library tracks, but no music endpoint/`discovery_type` was
confirmed (the repo only calls `trending_list`/`video_list` with `HASHTAG`); Instagram's
official Audio API (`GET /ig_audio`) needs a Facebook-Login professional account plus app
review and covers only third-party-cleared audio; YouTube has no official Shorts audio
chart; native cards capture no music today (only the single-reel `instagramSource.audio`
field); a third-party kworb TikTok songs source exists in the repo but is off; bulk reads of
`/music/` or `/reels/audio/` pages are a terms risk. Recommended: (1) confirm a TikTok
Discovery music type with a live call on the owner's connected app; (2) record the sound on
each native edit-search card the helper already reads (TikTok music link, Instagram audio
label) with real post dates, and call a sound "seen trending in edits" when it appears in
≥3 posts across ≥2 categories within 14 days; (3) optional labelled third-party links.

**Owner-directed skill sweep (Claude, owner's Chrome "Browser 1", 14 Oct 20:20–20:35 AST,
Freeze 15 build, native-first Search tab, no source edits, no Tavily credits):** 7 queries.

| Query | IG / TT / YT shown | Platforms received | Titles naming the skill | Pre-2026 | AE hidden |
| --- | --- | --- | --- | --- | --- |
| speed ramp | 4 / 0 / 6 | TT failed: `read-failed` in 2 s | 8 of 10 | 4 | 4 |
| color grading davinci resolve | 6 / 12 / 4 | all 3 | 22 of 22 | 9 | 0 |
| clone effect | 0 / 17 / 7 | IG: `empty` after 25 s `timeout`, 0 read | 24 of 24 | 15 | 3 |
| smooth slow motion | 6 / 12 / 0 | YT: `search-timeout` 25 s | 18 of 18 | 12 | 0 |
| text tracking capcut | 5 / 12 / 7 | all 3 | 20 of 24 | 11 | 3 |
| glitch transition | 5 / 14 / 5 | all 3 | 19 of 24 | 8 | 4 |
| shake effect capcut | 5 / 13 / 6 | all 3 | 23 of 24 | 9 | 4 |

No duplicates, no missing thumbnails; a few Instagram cards titled "Native search result"
(no caption read yet). Every job ran with focus skipped (`window-not-focused`, automated
window in background), so platform tabs were background-throttled; the owner's own
foreground use may fail less. Findings:
- **F10 (P2): one platform failed in 3 of 7 searches** (TT read-failed, IG timeout, YT
  timeout) and the only recovery is a whole new search or "open search". Proposed bounded
  repair: a per-platform "Try again" control on a failed/empty status line that re-runs
  only that platform for the same query (user-triggered, no automatic retry loop), keeping
  the other platforms' cards.
- **F11 (P3): a 25 s timeout with 0 cards is reported `empty` ("no cards read")** for
  Instagram "clone effect", which has many native videos; it should be a failed read
  (`timeout`) so stale same-query cards are retained and the label stays honest.
- Relevance is strong (titles name the skill in 134 of 146 cards); about 45% of cards are
  older than 2026 — useful learning references, not current trends.

### Freeze 15 (14 Oct 19:00 AST) — packet 20 candidate (Opus, single writer)

Change: with the Chrome helper connected, a Search-tab keyword search runs the helper's
native search for the typed text on Instagram, TikTok and YouTube (synthetic scope genre
`search`, own cache slot beside the 12 category slots) and renders `NativeKeywordResults`
(native interleaved order, per-platform status lines, `useFeedSources` enrichment, After
Effects filter with its hidden line, Save inspiration, continued loading via the shared
`useNativeInfiniteScroll` moved out of `CategoryDiscovery.tsx` unchanged). The Tavily/
YouTube-API keyword search no longer runs automatically; "Also search the web index (uses
credits)" (`discover-web-index`) runs it and its sections render below. Helper missing or
a native call failing with missing/permission → today's Tavily path. Native search uses
only the typed text (category chip and "+ program" hint apply to the web index only);
the panel's own tabs/filters are hidden while native results lead (the native block has
its own tabs); trend/starter chips lead with native results; format chips keep the web
path. One helper `status` message at Discover mount when a helper is linked (no tabs).
Tests: 7 focused files 256 passed (11 new, RED first; the hook move guarded by unchanged
CategoryDiscovery tests); `pnpm lint`, `pnpm typecheck` (app + Worker), `prettier --check`
(re-verified by the planner) and `pnpm build` pass. No e2e spec covers native-first search
yet.

```
0d135354d05a2e345ec875205cdb2df933f45eed73a770f7c59179528f70563c  components/research/NativeKeywordResults.tsx
6bc828014ec58e2eb2998deda91d532f4393090122499e1c3425c72f5db2149b  components/research/NativeKeywordResults.test.tsx
9fabe31669a8551ee8b009bd118195c59517d7e5cf2d6f3dd269e7fa73673437  components/research/useNativeInfiniteScroll.ts
3351bb457d90771390f80138ed7a8dc5c2a63f8f3c5ddf6e30a0a61bfcdb9f6d  components/research/CategoryDiscovery.tsx
45f7bfd1c2ae7fbc3e896230404a700a503846c9cd6275e5dad1b4b28a8f5ceb  components/research/ResearchPanel.tsx
407b553375a320371dd4f46deaea0a6b729a6c998f85e99114fae18a3ad7513f  components/research/ResearchPanel.test.ts
c291eb41a49d59d039a4ab2c959b25b78a2901d09080d2b28743ea3006578730  lib/discoverNativeSearch.ts
2d1768054fa3076e5a2e5269a31458cded45031d0ba9d4326b72fdc55e70bbba  lib/discoverNativeSearch.test.ts
aef4305e486d7e59ff989e4dc55d441f9adfd05590ceee543a7be6d0787df71e  messages/search.en.json
844a0bfc8da87f12dbe7352760f51418a1522a9e2971962aef20dc8e1d82f2a6  messages/search.ar.json
```
Served export (worktree `out/discover/index.html` = `GET :3000/discover/`):
`1238368c1ced1176d1b5957402b3f036fc97dfc67737a86fad5bdecb7569f9e9`. Freeze 13
(`ResultCard.*` `32dc51fe…`) and Freeze 14 `lib/editorFilter.ts` (`02c2ad4f…`) unchanged;
other Freeze 14 files changed here are listed above (CategoryDiscovery, ResearchPanel,
ResearchPanel.test, search messages).

**Claude live check (owner's Chrome "Browser 1", 18:42–18:58 AST, Saved 3 throughout,
comparison against the native search pages captured at 18:24–18:27 AST in the same Chrome
— independent tabs, not the helper's own source tabs, so order differences are not proof):**
- "match cut": all three received in 60 s, 24 cards (IG 5 / TT 12 / YT 7), "2 hidden ·
  After Effects", 0 Tavily cards, paid credits unchanged. Overlap with native: IG 4 of the
  native 6 (the other 2 consistent with the AE filter), TT 9 of 12 (was 0 with Tavily), YT
  6 of 7 within the native 19 (was 11/28 with a different order).
- "velocity edit": 24 cards, "7 hidden · After Effects"; TT 8 of 11 in the native list,
  first five in native relative order except one swap (was 0); IG 2 of 3 (was 0).
- Web index button: runs the old path below the native block (58 = IG 10 / TT 18 / YT 30,
  served from the 18:23 cache, paid credits unchanged at 4/2000).
- **Continuation NOT validated by Claude:** two More requests on the "match cut" job
  returned 0 new on all platforms (`scroll-cap`) because the helper refused focus with
  `skipReason: "owner-not-selected"` — the automated Chrome window/tab was not the real
  selected tab even though the page reported visible/focused under automation. This is the
  designed no-focus-stealing guard, not a packet-20 defect; continuation needs the owner's
  own foreground scrolling or Codex's method. The previously open "IG tab 10 vs 8" minor
  item applies to the web-index path only.
Implementation owner: none.

**Earlier status 14 Oct 18:20 AST: OWNER-DIRECTED live test by Claude (owner, 18:18 AST: "Press
and test yourself, I want you to search different editing effects and find bugs and match
the results of native platform searches but become even better for me"). Browser owner for
this test: Claude (owner's Chrome, localhost:3000, served export e384efb9…). Codex: please
do not drive the same Chrome concurrently until this test is recorded. No source edits
during the test; findings recorded below, then a planned repair packet. Tavily paid usage
authorized by the owner (pay-as-you-go limit 2,000 credits / $16).**

**Owner-directed live test results (Claude, owner's Chrome "Browser 1", 14 Oct 18:20–18:27
AST, served export e384efb9…, Saved 3 throughout).** Note: Claude in Chrome first attached
to a second connected browser ("Browser 2", a blank profile: no Saved, no Scout config, no
helper); only its Cache Storage/service worker were cleared and the UI language set to EN
there; no owner data touched. All results below are from Browser 1 (owner's profile).
- Search tab (keyword, Tavily for IG/TT, YouTube Data API for YT) now works after the
  owner enabled pay-as-you-go: "match cut" → 76 (IG 30 / TT 18 / YT 28), "velocity edit"
  → 58 (IG 10 / TT 18 / YT 30); "N hidden · After Effects" line works (1 and 6 hidden).
- **F9 (P1 for the owner's goal): Search-tab results do not match native platform search.**
  Same query on the native pages in the same Chrome (18:24–18:27 AST): "match cut" IG
  native first 6 vs app IG 30 → 0 overlap; TT native 12 (after TikTok's 6-item top block)
  vs app TT 18 → 0 overlap; YT native 19 vs app YT 28 → 11 overlap, order differs (native
  #1 at app index 11). "velocity edit": IG native 24 vs app IG 8 → 0 overlap; TT native
  vs app → 0 overlap. Cause: the Search tab reads Tavily's web index for IG/TT (and sorts
  YT by the API), not the platforms' own search; it also spends paid credits.
- Native path works for effect queries: Browse → Anime → typed "velocity edit" → "Search
  all three" (helper, no credits) → all 3 received, 24 cards; TikTok identities follow the
  native order (7386…, 7495764…, 7670…, 7495881…, 7469…, then 7634…, 7657…; two native
  cards absent, consistent with the After Effects filter's "6 hidden"). Instagram showed 3
  (others hidden by the filter or not yet hydrated; one order difference vs an independently
  opened search tab, which Codex notes is not proof).
- Minor, unverified: Search tab IG tab badge 10 vs 8 cards listed for "velocity edit".

### Packet 20 plan (Fable, 14 Oct 18:30 AST) — Search tab native-first (owner goal)

Goal (owner): search any editing effect and get what Instagram, TikTok and YouTube show for
it, in their order, plus our extras (captions/likes/views enrichment, After Effects filter,
Save/attach actions, continued scrolling). Design: when the Chrome helper is connected,
the Search tab's keyword mode runs the native helper search for the typed query on all three
platforms (the same machinery as the category feed's "Search all three"): `useNativeSearch`
with a synthetic scope genre `{ id: "search", … queries.en = [query] }`, native cards via
`nativeResultsToItems` → `useFeedSources` enrichment → `dropHiddenEditors` → `ResultCard`,
platform tabs (All/IG/TT/YT), per-platform status lines with stale/error labels, and the
existing infinite-scroll hook (move `useNativeInfiniteScroll` out of `CategoryDiscovery.tsx`
into its own module, no behaviour change). The Tavily/YouTube-API keyword search no longer
runs automatically when the helper is connected (saves paid credits and avoids
non-native results); a button "Also search the web index (uses credits)" runs it on demand
and its sections render below the native results as today. Helper missing → today's
Tavily path unchanged. The search cache slot "search" must not evict category caches
(raise the cache size by one or keep "search" separate). Preserve: F4–F7 loading/metadata,
packets 15–19, saved/hidden state, the AE preference. Executor: Opus (single writer).
RED→GREEN tests: connected helper + keyword submit → native search started with the query
for ig/tt/yt and no Tavily request; native cards render in interleaved native order; AE
filter applies with its hidden line; "Also search the web index" triggers the Tavily path;
helper missing → Tavily path as before; category caches untouched by a keyword search.
Focused checks + build; Claude then re-runs "match cut" and "velocity edit" live against the
native pages (owner-directed), records overlap/order, and freezes for Codex.

**Earlier status 14 Oct 18:08 AST: packet 19 frozen (Freeze 14: owner-requested "Hide After
Effects content" preference, built and served at :3000); ready for Codex review.
Implementation owner: none.** Source edits stopped at 18:02 AST. Freeze 13 files
(`ResultCard.*`, `32dc51fe…`) untouched, so the packet-18 review stays valid; packet 19 is
an owner-requested product change delivered during Codex's packet-18 validation window.
Also noted for the owner (17:52 AST, Tavily billing screenshot): pay-as-you-go is now on
(4/∞) but "Set limit" is off; the Worker's `monthTight` counts pay-as-you-go only with a
positive `paygo_limit`, so the daily scans stay paused (`tavily_budget`) until the owner
sets a monthly limit in Tavily; keyword searches themselves are accepted again by Tavily.

### Packet 19 plan (Fable, 14 Oct 17:58 AST) — hide After Effects content (owner choice)

Scope: an explicit, persisted user preference, not a quality gate: `settings.discover.
hiddenEditors: string[]`, default `["after effects"]` (the owner edits only in DaVinci
Resolve and CapCut). Pure helper `mentionsHiddenEditor(item, hiddenEditors)` matches title,
snippet, handle and hashtags with word-boundary, case-insensitive patterns (for "after
effects": `after\s*effects`, `#?aftereffects`, `\bAE\b` only when followed by
tutorial/template/edit/preset). Applied where results are listed: Discover keyword results
(all tabs, before sectioning) and the category native feed (`CategoryDiscovery` pool, next
to the existing "less"/"hide-creator" feedback filter) — native order and counts of the
remaining cards unchanged; a small line "N hidden · After Effects" keeps the removal
visible and honest (Codex's rule: explicit user-hidden videos are documented, never
silent). Toggle in Discover's "Program & search options": "Hide After Effects content"
(on by default) — turning it off restores the cards. Not applied to Saved items, Trending
effects chips or lessons (bounded). No Worker/query change, no re-ranking. RED→GREEN:
helper matches/non-matches (e.g. "after effects", "AfterEffects", "#aftereffects", "AE
tutorial" hidden; "aesthetic", "ae" alone, "DaVinci glow effect", "effects" alone kept);
ResearchPanel hides matching keyword results and shows the count; CategoryDiscovery hides
matching native cards, shows the count, keeps order of the rest, and the toggle off
restores them; setting persists through the store schema (default on). Focused checks:
the touched test files, lint, typecheck, prettier; then `pnpm build` in the worktree (served
in place) so the owner sees it at localhost:3000 (hard reload / clear service worker).

**Packet 19 result (Sonnet, single writer, 14 Oct 17:59–18:02 AST):** every new test RED
first, then 6 focused files 328 passed (`lib/editorFilter`, `store/index`, `ResearchPanel`,
`CategoryDiscovery`, `CategoryDiscovery.sources`, `messages` copy parity); `pnpm lint`,
`pnpm typecheck` (app + Worker), `prettier --check` clean (verified by the planner);
`pnpm build` in the worktree; served page hash verified equal to the export.
- `lib/editorFilter.ts` (new): `DEFAULT_HIDDEN_EDITORS = ["after effects"]`,
  `mentionsHiddenEditor(item, hidden)` (title/snippet/handle/hashtags; `after\s*effects`,
  `#?aftereffects`, `AE` + tutorial/template/edit/preset/project; other names as whole
  phrases), plus `dropHiddenEditors` and `editorLabel` shared by both screens.
- `store/index.ts` + `lib/domain.ts`: `settings.discover.hiddenEditors` (zod default, ≤20
  entries ≤40 chars, persisted; old saved settings get the default; `[]` persists) and
  `setHiddenEditors`.
- `ResearchPanel.tsx`: checkbox "Hide After Effects content" (`discover-hide-after-effects`)
  in Program & search options; results, tab counts and the line "N hidden · After Effects"
  use the filtered list; unchecking restores. The category feed answer shown inside
  ResearchPanel is filtered too (beyond the brief, accepted).
- `CategoryDiscovery.tsx`: the pool drops matching native cards next to the existing
  "less"/"hide-creator" exclusions; native order of the rest unchanged; hidden count shown
  for the current tab. One `settings` line added to the mocked store in
  `CategoryDiscovery.sources.test.tsx` (no assertion changed).
- Copy keys added with AR/EN parity in `search.*.json` and `feed.*.json`.
- Not filtered (bounded): Saved items, Trending effects chips, lessons/skill sheets, the
  pre-v2 Worker keyword path. Matching is text-only: a native card whose caption arrives
  later can appear first and drop once enrichment lands. Owner must hard reload (clear the
  service worker) at localhost:3000. Report: scratchpad `packet-19-sonnet-report.md`.

### Freeze 14 (14 Oct 18:08 AST) — packet 19 candidate for Codex review

HEAD `0e1fdb0`, uncommitted. Changed since Freeze 13 (14 files, Prettier-clean; ECC
accumulator empty):

```
02c2ad4fad50fa05bafc5b8a3e1c59351c9e5ad2c4e5b312dc39f3449a8f315f  lib/editorFilter.ts
bb36af39e26c86f7e49d926bc60e9c8213ed62d750fe249249f12265859f716c  lib/editorFilter.test.ts
759b6c072e4cbb7fce06805d9ec44779f44d5b4b55630f2554f81c5300d029b9  lib/domain.ts
8c137f11e4fd79bf2455d19225b51473ed1f3aa566695cd4e595931de35ef477  store/index.ts
5334c793c72ab18801b15ce3e9f7170aa4fa80f54be782eb9a175fad59e6bcd8  store/index.test.ts
c365d6c3a8ea873d604a595b0f9b6e5ecebc389f316acb7cd3177c90cf1edb14  components/research/ResearchPanel.tsx
a0eed41ebadc1a5a8cd7cf7ca9a696884b64fef514e88826318d1fb444a4e1f9  components/research/ResearchPanel.test.ts
cf5df7604b6d22093b3a91d766c471335955a0efbb1a867e5cba39ed68fb014d  components/research/CategoryDiscovery.tsx
4767a47fc7e0e224c39da66aea6b5539627167a4a4970898094515c163776ba8  components/research/CategoryDiscovery.test.tsx
fa0a60b3c0bab44f3972f80cd9e3cb4016052c227d39509ebabb870de8d7ae4e  components/research/CategoryDiscovery.sources.test.tsx
c99387562713dd26b8da04dcaed58f43712a668e1170cb84622fe18a3928f6e1  messages/search.en.json
52063349b6bb67305ead762904d225e4ad7739a6fc7d5d9735eadb1bfe903564  messages/search.ar.json
a4addcf2c083790054406b72fef118f0908d501a0c3b19f423bf66155354c308  messages/feed.en.json
1b498ca6514ec42387c107d1ad2ee0ef8b64b16c21fbf12effa92c74193d46de  messages/feed.ar.json
```
Served export (worktree `out/discover/index.html` and `GET http://localhost:3000/discover/`):
`e384efb96c77b251276c26e725e3f74f386b91b10385029456fac87b2347b07d` — this build also
contains the Freeze 13 ResultCard change (untouched file, hash `32dc51fe…`), so Codex's
packet-18 live recheck can use this build. Helper files, `lib/discoverNativeSearch.ts`,
`useFeedSources.ts`, queries, manifest 0.3.5 unchanged. No browser checks by Claude; no
paid usage, permissions, commit, push, merge or deploy.
Implementation owner: none.

### Packet 18 plan (Fable, 14 Oct 14:05 AST) — previews for IG video-only cards

Planner checks (14:00 AST, owner's local server, no browser): the ALREADY AUTHORIZED
public-metadata routes return pictures for both affected posts — `GET /api/local-ai/
instagram-preview` → `thumb` (scontent.cdninstagram.com) for `Dbd5ji4uO9z` and
`DbAsdTFo5KJ`; `GET /api/local-ai/instagram-source` → `thumbnailUrl` for `Dbd5ji4uO9z`
(available, author quentin._fx, 649,846 likes) and `unavailable` for `DbAsdTFo5KJ`; both
CDN image URLs answer HTTP 200 with and without a localhost Referer, and the app's `<img>`
already uses `referrerPolicy="no-referrer"`. So the data exists and the collector cannot
do better from the public DOM (video with no img/poster); the gap is app-side wiring:
`ResultCard.useThumb` asks for a missing Instagram/TikTok preview only when a Scout Worker
config exists (`!config → return`), although `localInstagramPreview` needs no Worker, and
the enrichment thumb (`applyInstagramEvidence` ← `thumbnailUrl`) only helps posts whose
embed read is available. Design: in `useThumb`, for an Instagram card without a picture,
run the local-server preview lookup whenever `isLocalAiHost()` (no Scout config
required); keep the Worker oembed fallback only with a config; keep the single retry after
5 min, the failed-image handling and the honest `InstagramPoster` fallback when nothing
loads; TikTok/YouTube paths and lazy per-card behaviour unchanged. No collector change, no
frame capture, no new permission, no AI upload, no paid service. RED→GREEN tests: native IG
item without `thumb` and WITHOUT Scout config → local preview fetched once and rendered;
local returns "" and no config → poster fallback, no Worker call; with config → Worker
fallback as before; a later enrichment `thumbnailUrl` renders; no reordering. Focused
checks: the ResultCard test file, lint, typecheck, prettier; freeze; Codex rechecks the two
live cards before resuming the matrix.

**Packet 18 result (Sonnet, single writer, 14 Oct 14:08–14:17 AST):** 3 of 5 new tests
RED first, 29/29 after.
- `components/research/ResultCard.tsx` (`useThumb`, +20/−6): the missing-preview lookup
  now runs when `canLook = !!config || (platform === "ig" && isLocalAiHost())` instead of
  requiring a Scout config; `freshPost` accepts a null config (cache key part "local") and
  calls `scoutOembed` only when a config exists. Unchanged: `PREVIEW_RETRY_MS`, the single
  retry, the `failed` list and `onError` flow, TikTok and YouTube behaviour, rendering order.
- `components/research/ResultCard.test.ts` (+111): new block "Instagram preview without a
  Scout Worker" — no config + local picture → shown, placeholder gone, one shared lookup,
  no Worker call; no config + local "" → `InstagramPoster` fallback with `igNoPreview`
  text, no Worker call, one retry after 5 min; later enrichment `thumb` shown with no extra
  lookup; with config + no local answer → Worker oembed fallback as before; TikTok without
  config asks nothing.
- Checks: `pnpm vitest run components/research/ResultCard.test.ts` 29/29; `pnpm lint`,
  `pnpm typecheck` (app + Worker) exit 0; `prettier --check` clean (verified by the
  planner). Not run: build, e2e, browser.
- Sonnet concern, recorded: jsdom's host is `localhost`, so `isLocalAiHost()` is true in the
  tests; the local route is exercised through a stubbed `fetch`, not the real server (the
  planner's curl checks at 14:00 AST are the real-route evidence for the two live posts).
  Report: scratchpad `packet-18-sonnet-report.md`.

### Freeze 13 (14 Oct 14:20 AST) — packet 18 candidate for Codex review

HEAD `0e1fdb0`, uncommitted. Changed since Freeze 12 (two files, Prettier-clean; ECC
accumulator empty):

```
32dc51fe2a7d3e453367ea71b376dc139dcfe863b4fb76e753a4bd9e5b39341b  components/research/ResultCard.tsx
47fefce9d58e5906d0e34409f0e8c292e47c9f74ef7924ecfeb8996f3a85d597  components/research/ResultCard.test.ts
```
Everything else unchanged from Freeze 12 (helper files, `lib/`, manifest 0.3.5, F7/F8,
packets 15–17). Commands: `pnpm vitest run components/research/ResultCard.test.ts`
(29 passed); `pnpm lint`; `pnpm typecheck`; `pnpm exec prettier --check <two files>`.
Live recheck needs a worktree `pnpm build` (served in place at :3000) — Codex's step; no
extension reload. Expected on the two Cars cards: `Dbd5ji4uO9z` and `DbAsdTFo5KJ` show the
local-route picture; if the route returns "" for a post, the honest "Preview unavailable.
Tap to watch." tile remains. IDs, order, continuation, saved/hidden state untouched. No
browser checks by Claude; no paid usage, permissions, commit, push, merge or deploy.
Implementation owner: none.

### Packet 17 plan (Fable, 14 Oct 12:58 AST) — native source error ≠ empty

Live evidence (Codex, exact helper tab TikTok 295819194): the search page rendered the
heading "Something went wrong", the paragraph "Sorry, something wrong with the server,
please try again." and a "Try again" button; the collector returned `status: "empty"`, so
Discover showed "TikTok · no cards read — open search" and dropped the same-query cached
TikTok cards (retention only runs for `error`/`needs-attention`). One click on the
platform's own Try again recovered real cards. Design: in `native-capture.js`, after the
login/challenge check and before collecting, detect a RENDERED search-error surface
scoped to the page's main/results region — a visible heading element (h1–h3 or
role=heading) whose text matches a small allowlist (e.g. /something went wrong/i,
/wrong with the server/i, /try again later/i) together with a visible "Try again"/"Retry"
button, AND zero rendered video-card anchors — and return `{ status: "error", results: [],
error: "search-service-error" }` through the existing protocol (the helper maps unknown
error codes to `read-failed`; the app's retention keeps prior same-query cards with
`staleAsOf` and the honest "couldn't read" label). Negative cases must stay distinct:
hidden/CSS-hidden error text (no error), an ordinary video caption containing "something
went wrong" inside a card (collect normally), a genuine no-results page (empty), a
loading page (no cards yet, not error), login/challenge (needs-attention). No automatic
retry, no extra browsing, no new time limits. RED tests: capture fixture from Codex's DOM
(heading/paragraph/button) → error; helper test: that collector result → platform
`status: "error"`, `error: "read-failed"`, not `empty`; lib test: cached `done` TikTok cards
+ same-query refresh answered `error` empty → retained with `staleAsOf`, then an explicit
successful retry snapshot replaces them (no stale label). Focused checks only; freeze;
Codex owns the live recheck.

**Packet 17 result (Sonnet, single writer, 14 Oct 13:00–13:08 AST):** RED first (the
TikTok error fixture returned `status: "empty"`), GREEN after.
- `native-capture.js`: after the login/challenge check (which still wins), with zero rendered
  video-card anchors, if `main` (or `document` when there is no `main`) holds both a visible
  heading (`h1,h2,h3,[role=heading]`, not inside an `a`) matching
  `/something went wrong|wrong with the server|try again later|couldn't load/i` and a visible
  `button,[role=button],a[href]` whose text matches `/^(try again|retry|reload)$/i`, the
  collector returns `{ status: "error", results: [], error: "search-service-error" }`. Every
  other path unchanged. No automatic retry, no extra browsing, no time-limit change.
- `native-search.js` and `lib/discoverNativeSearch.ts` unchanged: the helper already maps
  unknown error codes to `read-failed` and the app already retains prior same-query cards
  on `error`.
- Tests: 3 new capture tests (error fixture → error; CSS-hidden error markup → not error;
  caption containing "something went wrong" inside a card → collected normally; genuine
  no-results → `empty`; loading page unchanged; login/challenge precedence), 1 helper test
  (TikTok ends `error`/`read-failed`, not `empty`, exactly one read, Instagram stays
  `done`), 1 lib test (3 cached cards retained with `staleAsOf` = previous `asOf`, then an
  explicit successful snapshot of 5 cards replaces them with no stale label). Three focused
  files 97/97; `pnpm lint`, `pnpm typecheck` (app + Worker) exit 0; `prettier --check`
  clean (verified by the planner). Not run: build, e2e, browser.
- Sonnet concerns, recorded: the fixture is built from Codex's screenshot text, not the real
  TikTok DOM; an error block rendered outside `<main>` while a `main` exists, a non-heading
  element, a non-button control or non-English text would be missed (stays `empty`); the
  rule also applies to Instagram and YouTube when the same conditions hold. Report:
  scratchpad `packet-17-sonnet-report.md`.

### Freeze 12 (14 Oct 13:12 AST) — packet 17 candidate for Codex review

HEAD `0e1fdb0`, uncommitted. Changed since Freeze 11 (four files, Prettier-clean; ECC
accumulator empty):

```
d40b4df4ffb6f566a75376bce87ee16cd4c3e7f70e3f226d112513e551b5b207  extensions/discover-import/native-capture.js
17f72fefedb90714a5b02260a9cf6b3523371d1193661b7ccb415b2d3ef2efda  extensions/discover-import/native-capture.test.ts
294caf58871e5331a9405c543436fa1900ec7362b4b863066624239ec2ac3467  extensions/discover-import/native-search.test.ts
f760e2ec8d3358911c186b3649fbfdb1b972e05b194811e2bcde7a3aed7b64d6  lib/discoverNativeSearch.test.ts
```
Unchanged from Freeze 11 (verified): `native-search.js` `68a7de50…2fcdf`,
`lib/discoverNativeSearch.ts` `f4ee4b8b…2c2fbf`, `manifest.json` `e4cd73f5…a06b6c9` (0.3.5).
Commands: `pnpm vitest run extensions/discover-import/native-capture.test.ts
extensions/discover-import/native-search.test.ts lib/discoverNativeSearch.test.ts`
(97 passed); `pnpm lint`; `pnpm typecheck`; `pnpm exec prettier --check <four files>`.
No build by Claude; the served export at :3000 is Codex's Freeze 11 build (app lib
unchanged, so no app rebuild is needed for this packet; the helper collector change needs
an extension reload, owner's step, after Codex accepts). Continuation, playback and the
12×3 parity remain unverified (Codex's browser control failed after one continuation
request); nothing here claims them. F7/F8, packets 15–16, saved/hidden state untouched.
No browser checks by Claude; no paid usage, commit, push, merge or deploy.
Implementation owner: none.

Earlier status (12:00 AST): Freeze 11 reviewed by Codex — "reviewed; validation pending".
Code verdict passing: handoff and all four fingerprints match, unchanged app/manifest
hashes match, 61/61 independently, both packet-15 reproductions pass with actual
collector output fed into the exact helper merge (synthetic, not live parity), Codex
`pnpm build` passed, rebuilt localhost:3000 reloaded in Chrome, page renders, Saved 3.
Validation owner: Codex — real Chrome comparison starting with fresh Perfume (all 3
sources + continuation), then the 12×3 matrix if it passes; identities/order against the
same helper source tabs, thumbnails/playback and Saved checks. Prerequisite: owner reloads
helper 0.3.5 (Codex has asked). Product source frozen; Claude idle until Codex reports
concrete Chrome findings. Implementation owner: none.** Overall Discover not yet accepted.
Earlier: source edits stopped at 11:55 AST (Freeze 11).

### Packet 16 plan (Fable, 14 Oct 11:40 AST) — late prefix and bounded order evidence

Codex findings (Temp `discover-packet15-review-repros.json`):
R1 (P2, `native-capture.js:154-163`): prior `[PostA,PostC]`, nothing ever trimmed; native
`[LateFirst,PostA,PostC,PostD]` → capture returns only `[PostD]`; LateFirst is lost for good.
"Unknown before the first known card" is not proof of an old trimmed prefix.
R2 (P2, `native-capture.js:257`): 600 old rendered cards then `[PostA,LateB,PostC,PostD]`,
known `[PostA,PostC]` → capture `[LateB,PostD]` but `order` holds only the first 600 keys,
so the helper merge falls back to `[PostA,PostC,LateB,PostD]`.
Design:
1. Explicit trim bookkeeping instead of a guess: the helper passes the collector, with
   `knownUrls`/`lastUrl`, a bounded context `knownTotal` (size of the job's `seen` map for the
   platform) and `omitted` (`state.omittedCount`). The collector treats the known list as
   complete when `knownTotal <= knownUrls.length` and `omitted === 0`; then every rendered
   unknown candidate — including ones before the first known card — is new and is collected
   in DOM order (LateFirst recovered). When the known list is incomplete (trimmed), keep
   today's suppression of candidates before the first known card, plus the virtualization
   fallback. Initial reads (no progress) unchanged.
2. Bounded ordering evidence around the retained/new region, not the grid's head: `order`
   covers the candidates from the first known (or first collected) index to the last collected
   index, with a small margin on both sides, capped at 600 keys by keeping the leading and
   trailing halves of that span; the merge's anchoring already tolerates missing keys. Memory
   and payload stay bounded.
RED tests first for R1 and R2 exactly as Codex described (plus: trimmed-prefix case still
suppressed when `knownTotal > knownUrls.length`; virtualization fallback; helper merge of the
R2 grid yields `[PostA,LateB,PostC,PostD]`). Focused checks only: the two helper test files,
lint, typecheck, prettier --check. Then freeze; Codex reviews, builds and runs Chrome.
F7/F8, saved/hidden state, queries, permissions, rolling memory untouched.

**Packet 16 result (Opus, single writer, 14 Oct 11:42–11:55 AST):** both repros RED first
(3 failing capture tests, 2 failing helper tests), GREEN after.
- R1: for More reads the helper now also sends `knownTotal` (= the platform's `seen.size`)
  and `omitted` (= `state.omittedCount`). The collector treats its known list as complete
  only when `knownTotal` is an integer ≤ the list length (after the collector's 600 cap) and
  `omitted === 0`; then every rendered unknown card is collected in page order (Codex's case
  → `[LateFirst, PostD]`). Otherwise packet-15 behaviour: pre-first-known cards skipped,
  virtualization fallback kept. Missing fields (older caller) → treated as incomplete =
  today's behaviour, so an old trimmed prefix is never replayed. The existing "scans beyond
  more than 90 known cards" fixture needed no change.
- R2: `order` now spans from the first to the last known-or-collected card plus 10 on each
  side; if longer than 600 it keeps the first 300 and last 300. Codex's case → capture
  `[LateB, PostD]` with order `Old590..Old599, PostA, LateB, PostC, PostD`; helper merge →
  `[PostA, LateB, PostC, PostD]`. A 1,000-card grid gives exactly 600 keys; short grids still
  return the full order; packet-15 tests unchanged. Opus extended the window to the last
  known card when it comes after the last collected one (so `[A, new B, known C]` merges in
  order) — accepted.
- Checks: `native-capture.test.ts` + `native-search.test.ts` 61/61; `pnpm lint`,
  `pnpm typecheck` (app + Worker) exit 0; `prettier --check` clean (one `--write` on
  `native-capture.js`, tests rerun). Not run: build, e2e, browser.
- Opus concerns, recorded: (a) in the current helper `knownTotal` always equals the list
  length, so `omitted` is the deciding signal and `knownTotal` only guards the 600 cap;
  (b) in complete mode a card a platform promotes above the first known card is collected
  as new (that is native order, acceptable); (c) a corrupted stored `omittedCount` is reset
  to 0 on job restore (outside these files) and would make the list look complete;
  (d) no single test runs the real collector and the helper together — the helper test feeds
  the exact `order` the capture test asserts; (e) nothing proven live. Report: scratchpad
  `packet-16-opus-report.md`.

### Freeze 11 (14 Oct 11:58 AST) — packet 16 candidate for Codex review

HEAD `0e1fdb0`, uncommitted. Changed since Freeze 10 (four files, Prettier-clean; ECC
accumulator empty):

```
863e587eb80500c7c50b42a849c2d26c73456ab0118d605362ef0791264bd6e7  extensions/discover-import/native-capture.js
56a02b1b99173024b0dc79bb946997bf9e042976a57a60347360624b033181a1  extensions/discover-import/native-capture.test.ts
68a7de501c5b970738a5bcf8abe2805a660c505bc0dcb02bc287d7aa2632fcdf  extensions/discover-import/native-search.js
added637ea98fecbc7cf2cb418013150f41084962b5e9d06fb2bde607954b5a6  extensions/discover-import/native-search.test.ts
```
Unchanged from Freeze 10 (verified): `lib/discoverNativeSearch.ts` `f4ee4b8b…2c2fbf`,
`lib/discoverNativeSearch.test.ts` `a1ec8fb6…4e8211`, `manifest.json` `e4cd73f5…a06b6c9`
(0.3.5). Commands: `pnpm vitest run extensions/discover-import/native-capture.test.ts
extensions/discover-import/native-search.test.ts` (61 passed); `pnpm lint`; `pnpm typecheck`;
`pnpm exec prettier --check <four files>`. No build: served export at :3000 still F8 until
Codex builds; helper reload to 0.3.5 is the owner's step after Codex accepts the code.
F7/F8, saved/hidden state, queries, popularity, permissions, rolling memory untouched.
No browser checks by Claude; no paid usage, commit, push, merge or deploy.
Implementation owner: none.

Earlier: packet 15 frozen 11:45 AST (Freeze 10), reviewed by Codex: hashes unchanged, 88/88
independently, changes requested (R1, R2 above). Delivery of the parity assignment confirmed in Training Page at 11:15 AST. Files: `extensions/discover-import/
native-capture.js` + test, `extensions/discover-import/native-search.js` + test,
`lib/discoverNativeSearch.ts` + test, `extensions/discover-import/manifest.json` (0.3.4 →
0.3.5, owner reload needed before Codex's live comparison). F7/F8 changes preserved.

Design (all three repairs share one rule: *the currently observed native grid order is
authoritative for cards it contains; retained cards it no longer shows keep their place
right after their nearest preceding neighbour that is still shown*):
1. Capture (`native-capture.js:154-166`): collect every rendered, unknown candidate in DOM
   order — including ones that appear BEFORE the cursor but AFTER the first known card (a
   late-hydrated B between known A and cursor C) — and still skip anything before the first
   known candidate (the old trimmed prefix beyond the 600-key known window). Cursor advances
   to the last collected card in DOM order. The capture result also returns `order`: the keys
   of all rendered candidates in DOM order (bounded), so the merge can place cards.
2. Helper merge (`native-search.js:379-403`): replace insertion-ordered map output with a
   stable merge keyed by the observed `order` (present keys sorted by observed index;
   retained absent keys anchored after their preceding present neighbour), then the 300-card
   rolling window and renumbered positions as today. `[A,C]` + grid `[A,B,C,D]` → `[A,B,C,D]`.
3. App resume/append merge (`lib/discoverNativeSearch.ts:109-118`): same stable merge using
   the fresh snapshot's order; keep retention, `staleAsOf`, `omittedCount`, duplicate-alias
   handling (`canonicalNativeUrl`) and stale genre/query rejection.
RED tests first for: [A,C]→[A,B,C,D] capture (B recovered, no repeats, cursor D, no scroll
outside the action), helper merge order, app append order, overlapping continuation window,
duplicate URL aliases, stale-session rejection; existing capture/search/lib tests stay green.
Focused checks only (three test files, lint, typecheck, prettier --check). No query, popularity
or threshold changes. Perfume/TikTok intermittent no-cards is NOT in scope (diagnose
separately). Freeze exact hashes; Codex owns the 12×3 live comparison.

**Packet 15 result (Opus, single writer, 14 Oct 11:22–11:42 AST):** all three defects
reproduced RED first, then fixed.
1. Capture (`native-capture.js`): the scan now starts after the FIRST card already known
   (not after the cursor), so a late-hydrated B between known A and cursor C is collected;
   candidates before the first known card (trimmed prefix) are still skipped; virtualization
   fallback kept; results are in DOM order so the cursor ends on D; the collector result now
   also carries `order` (identity keys of all rendered candidates in DOM order, bounded).
2. Helper merge (`native-search.js`): stable merge keyed by the observed `order`: cards the
   page currently shows follow the page's order; a retained card no longer shown stays right
   after its nearest earlier card that is still shown; then the 300-card window and
   renumbered positions as before. `[A,C]` + `[A,B,C,D]` → `[A,B,C,D]`. Without `order`
   (older collector) the helper merges exactly as before.
3. App append/resume merge (`lib/discoverNativeSearch.ts`): the same rule using the fresh
   snapshot's order; canonical-alias dedup, `NATIVE_MAX_RESULTS` window, `omittedCount`,
   `staleAsOf` and genre/query rejection preserved.
4. `manifest.json` 0.3.4 → 0.3.5 — **owner must reload the unpacked extension in
   chrome://extensions before Codex's Chrome comparison.**
Tests: the three focused files 88/88 (new tests: B recovery without repeats and cursor D;
helper and app merge order; retained-not-rendered placement; overlapping continuation
window; duplicate alias; stale genre/query rejection; existing trimmed-prefix,
virtualization, hydration-window and quiet-page tests still green). `pnpm lint`,
`pnpm typecheck` (app + Worker), `prettier --check` clean (verified by the planner). Not
run: build, e2e, browser. Opus concerns, recorded: (a) if a platform re-sorts its grid so a
card already dropped from the 300-card window reappears after the first kept card, it is
collected again as new (before, it was skipped as pre-cursor); (b) recovered late cards
count toward the 30-card More target; (c) the merge rule exists twice (extension JS and
app TS cannot share a module); (d) Perfume/TikTok intermittent no-cards untouched.
Report: scratchpad `packet-15-opus-report.md`.

### Freeze 10 (14 Oct 11:45 AST) — packet 15 candidate for Codex review

HEAD `0e1fdb0`, uncommitted. Changed in this packet (all Prettier-clean; ECC accumulator
empty, so the Stop-time formatter rewrites nothing):

```
0f7bd289c69189134f173a58d0e6df31b864182517d9a65df580c58ce476c691  extensions/discover-import/native-capture.js
981126434dd2848353bb2c4f2837a5f6c2e150f547432623d1e306ac74a6094e  extensions/discover-import/native-capture.test.ts
c7fdfef1c11bf4b5f31d24d5ce04f8977fccc513a6d95e8eb1c83dbae4f24bd0  extensions/discover-import/native-search.js
bd8338ce253c19510b94ee5cdf5579a85b73928daabc5ffdd3b6275bc75d2412  extensions/discover-import/native-search.test.ts
f4ee4b8be8ff4940429823445c43c32148388d1a6d553087460b3c448c2c2fbf  lib/discoverNativeSearch.ts
a1ec8fb6e011a7e2bc0719c8440700fd5c6f6144459fe25235af9f4aa2a8e211  lib/discoverNativeSearch.test.ts
e4cd73f5215922402b83354961ff687355cb882395e4418b883f0f515a06b6c9  extensions/discover-import/manifest.json
```
Commands: `pnpm vitest run extensions/discover-import/native-capture.test.ts
extensions/discover-import/native-search.test.ts lib/discoverNativeSearch.test.ts`
(88 passed); `pnpm lint`; `pnpm typecheck`; `pnpm exec prettier --check <changed files>`.
No build was run: the served export at :3000 (PID 17764) still reflects F8; Codex's live
comparison needs `pnpm build` in the worktree and the helper 0.3.5 reload. F7/F8 files
untouched. No browser checks by Claude; no paid usage, permissions, commit, push, merge
or deploy. Saved items, user-hidden choices, queries and popularity logic untouched.
Implementation owner: none.

## Active assignment — native platform parity, 14 October 2026

User reasserted the goal and assigned implementation to Claude Code after Codex planning.
**Implementation owner: Claude Training Page; Codex writes no product code.** Handoff
native-parity-20261014 was visibly delivered once (14 October,08:16UTC); Fable5.1/High
was selected and Claude began responding. Follow native-platform-parity-2026-10-14.md. Fable5.1 plans once; one
Opus5.5/Sonnet5.5 executor at a time implements; Codex independently verifies exact
source hashes and actual Chrome. All prior fixes/source remain in the managed worktree.
This supersedes the earlier instruction to test collection only if the mismatch repeats.
Acceptance is native video identity/order and continuation for all12 categories across
all3 platforms, not merely some cards from each platform. The older12-category quality
audit is not parity evidence. Confirmed delivery evidence is at the top of codex-review.md.

## Current status — 14 October 2026, Codex F7 + F8 complete

**Implementation owner: none.** Source is frozen; localhost:3000 serves final build
`e1185728782966aa96397a292924d607b955080d1bb83d371b6fcb83331d6b03`
(out/discover/index.html). Final source hashes and focused checks are at the top of
codex-review.md. F7 fixes old built-in caches and misleading input; F8 uses live-tested
`coffee cinematic` and recognizes both former Coffee defaults. Root reviewed, built,
and checked actual signed-in Chrome. Saved(3) preserved. Coffee and Camping received
all3 platforms. Perfume initially missed TikTok; native TikTok has videos and one app
retry settled with all3 platforms received. Treat that as an intermittent collection issue, not solved or
an empty native catalog. No product code remains in flight.

Next bounded work: native collection reliability only if the no-cards mismatch repeats;
capture native loading/empty state and helper timing before changing the collector.
Broader current-trend/visual quality is still open; native order is not trend evidence.
Keep usage low: do not rerun unchanged F7/F8 tests or repeat all-category audit.
Claude Training Page outcome remains undelivered due stale accessibility targeting;
no message was typed/sent. Shared files contain the complete handoff. User authorizes
Codex to finish requested repairs when Claude cannot; retain one implementation writer.
No new paid usage, permissions, commit, push, merge or deployment was performed.

Earlier ownership records below are historical and superseded by this section.

14 October 2026 — F7 code/build and real Chrome verification passed; see codex-review.md.
**Implementation owner: Codex, bounded F8 Coffee default correction only.** One executor
may change the native Coffee default to the live-tested `coffee cinematic`, and migrate
exact uniform caches of both prior built-ins (`coffee edit`, `cafe cinematic b-roll`).
Instagram visibly returned No results for the longer phrase and real results for the
shorter candidate; preserve Camping/Perfume, custom/current/mixed/partial queries, native
order and existing F4-F7 guards. Root owns independent review/build and final Chrome check.
No concurrent Claude edits, paid usage, new permissions, commit/push/merge/deployment.

14 October 2026 — user resumed. **Implementation owner: Codex, bounded F7 cache/query
repair only.** Packet14 source hashes are unchanged; the completed review is recorded
in codex-review.md. The pending Claude handoff remains undelivered because Computer Use
returns stale accessibility from another session even while Training Page is visible.
Under the user's earlier instruction to finish fixes Claude has not completed, Codex
takes the single-writer role for F7 and independent Chrome validation. Claude must stay
idle until ownership is returned; do not start a second executor or change source.
Scope: migrate the three legacy built-in query caches on intentional entry once, preserve
custom/current queries and saved content, keep displayed and active queries consistent.
No paid usage, permissions expansion, commit, push, merge or deployment.

13 October 2026 22:12 AST — **packet 14 frozen (Freeze 9: native query specificity for
Coffee, Camping & desert, Perfume); ready for Codex review; Codex owns live verification
against the named counterexamples.** Source edits stopped at 22:08 AST. No build in this
packet (Codex's instruction: focused checks only); the served export at :3000 (PID 17764)
still reflects the F6 state until Codex rebuilds or asks for a build.
Implementation owner: none.

### Packet 14 plan (Fable, 13 Oct 22:00 AST) — bounded native query repair

Evidence (audit): the native category path sends one broad first query per category
(`coffee edit`, `camping edit`, `perfume edit`) to all three platforms; Coffee collides with
the musician Black Coffee (YouTube `atXZi2Jkrxk`, a music performance), Camping pulls
survival/lifehack and LUT-promo titles, Perfume pulls decant-inventory ads. Each of the
three genres already has a more specific second English query in
`planning/data/genres.json`: `cafe cinematic b-roll`, `desert cinematic video`,
`perfume cinematic ad`. Rule: for exactly these three genre ids the native category search
(initial auto search and the default text in the search box) uses that existing second
English query; every other genre keeps `queries.en[0]`. `queries.en[0]` itself, Discover
keyword search, trends, Worker plans and `genreQuery()` are untouched. No engagement
filter, no result filter, no provider/permission change, native order and breadth
preserved (the query is still a short phrase sent to all three platforms). Acceptance:
RED→GREEN unit test for the helper (three genres → second query; a genre without a second
query or outside the list → first query; the broad phrases `coffee edit`/`camping edit`/
`perfume edit` are never the native query for those three); component test that the Coffee
page's auto search sends `cafe cinematic b-roll` per platform and the box shows it; focused
vitest, lint, typecheck; `pnpm exec prettier --check` on changed files before the freeze.
Codex owns live verification against the named counterexamples.

**Packet 14 result (Sonnet, single writer, 13 Oct 22:02–22:08 AST):**
- `lib/genres.ts`: new exported `nativeCategoryQuery(genre)` with the explicit allowlist
  `NATIVE_SPECIFIC_GENRES = ["coffee", "camping", "perfume"]`: for those ids it returns the
  genre's existing second English query (whitespace collapsed like `genreQuery`), otherwise
  `queries.en[0]`; comment references the 13 Oct audit collisions. `genreQuery()` unchanged.
- `lib/genres.test.ts`: 4 new tests (three genres → `cafe cinematic b-roll`,
  `desert cinematic video`, `perfume cinematic ad`; never equal/contain `coffee edit`,
  `camping edit`, `perfume edit`; other genres and a custom genre without a second query →
  first query; `genreQuery(g, "en")` for the three still `queries.en[0]`). RED before the
  helper existed.
- `components/research/CategoryDiscovery.tsx`: the search box default/reset and the initial
  auto native search use `nativeCategoryQuery(genre)` instead of `genre.queries.en[0]`; the
  effect dependency changed from `genre.queries.en` to `genre` (exhaustive-deps), the
  existing `entered` ref still limits the auto search to once per genre id. No change to the
  F4–F6 loading/metadata code.
- `CategoryDiscovery.test.tsx`: new test — Coffee auto search sends `cafe cinematic b-roll`
  for ig/tt/yt and the input shows it; Anime unchanged (`anime edit`). RED before wiring.
- Checks: `pnpm vitest run lib/genres.test.ts components/research/CategoryDiscovery.test.tsx`
  → 46 passed; `pnpm lint`, `pnpm typecheck` (app + Worker) exit 0; `prettier --check` clean
  on all four files (verified again by the planner). Not run: build, e2e, browser.
- `planning/data/genres.json`, `lib/discoverExpansion.ts`, Worker plans, Discover keyword
  search, trends: untouched. Report: scratchpad `packet-14-sonnet-report.md`.

### Freeze 9 (13 Oct 22:12 AST) — packet 14 candidate for Codex review

HEAD `0e1fdb0`, uncommitted. Changed in this packet (`CategoryDiscovery.*` replace the
hashes Codex recorded after F6; `lib/genres.*` are new product fingerprints):

```
febb6d6acad82a4a1adfb5730972606d1309846d87b5bb1c0c1e7da9d2664f59  lib/genres.ts
f70ffc763c4fd774c81f01db3835de5e4f42e398a071928c0f79fa09ae33fcec  lib/genres.test.ts
75ec7b47574c10965b2de510dfc2807c83477360f2436a45e337ff9d9d8e1e3e  components/research/CategoryDiscovery.tsx
77e057e8d564152a7f37a30e65fcf9c27dc43c69424570ba21b0bc77cc5f18b2  components/research/CategoryDiscovery.test.tsx
```
All four are Prettier-clean and the ECC edit accumulator is empty, so the Stop-time
formatter rewrites nothing. No build was run; the served export is unchanged from F6 —
Codex's live check needs `pnpm build` in the worktree first (served in place by PID 17764).
No browser checks by Claude; no paid usage, permissions, commit, push, merge or deploy.
Popular auto-scroll and effect/audio trend detection remain separate open work.
Implementation owner: none.

Earlier (Codex): **F6 repair and all-category CHECK complete.** Codex source edits are
finished and Codex owns verification.
Popular's unchecked-candidate bootstrap and frozen-clock failures are fixed;62 focused
checks and final build pass. Real Chrome admits2 then4 recent posts through bounded
source-detail checks after>5min on-page. Saved3 preserved. All12 categories have all3
platforms, but the288-card audit found old results and concrete query/relevance issues.
Overall editor-quality/current-trend goal is not approved. See codex-review.md and
category-quality-audit-2026-10-13.md for exact evidence, limitations and hashes.

Prepared next bounded Claude task: improve native query specificity for Coffee,
Camping & desert and Perfume, retaining native order/breadth. Fable plans; one Opus/Sonnet
writer implements. Freeze exact hashes and trigger Codex for independent Chrome checks.
Training Page delivery was verified in the UI on13October2026. No paid usage,
permissions expansion, commit, push, merge or deployment. No duplicate broad audit.
Popular automatic scrolling and effect/audio trend detection remain separate open work.

Updated 13 October 2026, 21:22 AST: **F5 and removal of feed totals completed by Codex.**
Implementation owner: **none**. Claude stays idle; no new completion marker or executor.
The latest completion supersedes the F4/F5 in-progress and server notes below.
Visible Instagram/TikTok details now finish their finite requested card set in bounded
chunks instead of stopping after 18/platform. Overlapping evidence is retained; stale
work cancels. Loaded totals, platform count badges, X-of-Y labels and the rolling-window
note are removed; actual likes/views and Saved remain. Native continuation remains active.

Checks: 87 focused unit/integration tests, two focused desktop Playwright tests, targeted
lint/typecheck/formatting and final production build pass. Network/helper tests are mocked.
Real Chrome: initial TikTok24 all completed details (six previously bare cards recovered);
ordinary End-key scrolling revealed48 then50, then fetched a native continuation. Combined
membership grew142->149 (IG39 unchanged, TT50->51, YT53->59); all51 TT source reads
completed200, including cancelled work subsequently retried. Saved3 preserved. This is
bounded continuation evidence, not proof of endless supply, all-category quality or trends.
Current managed localhost:3000 server PID17764 serves the matching rebuilt out/; old PID39332
had exited during the session. Do not start/copy the primary checkout. Full hashes,
evidence, limitations and Claude delivery are recorded in codex-review.md (F5 section).
No paid usage, helper permission change, commit, push, merge or deployment.

Historical work log follows.

13 October 2026 — user resumed after F4. Implementation owner: **Codex** for the
remaining visible-card metadata gap (24 cards revealed versus18 details read). Claude
remains idle under the prior handoff. Plan: scope metadata work to requested visible
cards, preserve native order/evidence and two concurrent reads, finish the finite visible
set and stop; test single-platform initial/final pages, switches and busy reveals, then
verify the rebuilt localhost:3000 in Chrome. No helper permission change, paid usage,
push, merge or deployment. One implementation writer; separate read-only assessment.
Latest user steering: "why there are even numbers this place should be infinite media".
Remove loaded-result totals and platform count badges (keep actual video likes/views and
Saved count). Preserve continuous user-scroll retrieval; verify a real native continuation,
not just revealing cached cards. Counts may remain internal diagnostics, never a displayed
claim of platform supply. Keep legitimate attention/error messages.

Updated: 13 October 2026, 20:26 AST. **Codex F4 repair complete and verified at localhost:3000.**
Implementation owner: **none**. Claude remains idle; the former packet13 assignment is
superseded by the user's reassignment to Codex. Do not launch another repair or completion
marker for this handoff. No push, merge or deployment authorized by this review.

Codex fixed lost source-detail work during busy reveals in CategoryDiscovery.tsx and
added CategoryDiscovery.sources.test.tsx (real component/hook, mocked network). Each
distinct reveal retains one bounded batch until loading settles; stale scopes cancel it.
52 focused tests pass; targeted lint, typecheck and managed-worktree build pass. In real
Chrome the current cached Anime feed revealed 24->140; all eight previously unfinished
TikTok cards acquired captions, dates and counts. Saved3 preserved; a final observer saw
no further source requests, and diagnostics were removed. Later rapid reveals used the
actual button handler through developer CDP after normal controls timed out; no mocked
responses. Full evidence and hashes: codex-review.md, Codex F4 repair section.

The 18/platform/action budget is unchanged. This resolves lost requested batches, not
universal metadata coverage: a single-platform feed can still outgrow that budget.
All-category relevance, fresh trend evidence and native-platform parity remain unverified.
The managed server (PID39332) serves the rebuilt out/ in place; never use the primary checkout.

Current source/export SHA256:
```
58829d512690ce88d39e555de9470ee93a8d0b2425da14d7a10ddcb45c640d68  components/research/CategoryDiscovery.tsx
97f724cbf2440f410c2047570394ae96a3149ad2f99610bfeb486a175c7f8c91  components/research/CategoryDiscovery.sources.test.tsx
31705abcbb69351a2715452a6c73e87a9c3bacbb61bcfcbd70315c7ae9fa95af  out/discover/index.html
```

The following entries are history, superseded by the completed F4 repair above.

Codex review history, 13 October 2026: packet 10 code and bounded live Chrome loading
checks passed (31 focused tests independently); the 16:30 AST restart had used the obsolete
primary-checkout server (405 on source routes) and Codex corrected the runtime to the
managed worktree's server at :3000 (listener PID 39332; metadata routes 200; Instagram card
details restored; Saved 3 and 127 loaded Anime cards preserved). The packet 10 verdict and
the packet 11 task WERE delivered (16:41 UTC) and packet 11 was executed; the packet 11
verdict (freeze correction required) was delivered at 19:53 AST. Full evidence and
fingerprints are in codex-review.md. The primary checkout is never used for the runtime.

Updated: 13 October 2026 20:12 AST. Status: **Freeze 8 reviewed by Codex (hashes match,
41 focused tests pass, first-card ordering passes in real Chrome); F4 open — reveals while
metadata is busy lose `checkRemaining()` intent (127 rendered, 72 metadata requests 200, 8
TikTok cards never requested after 53 s quiet; missing caption confirmed). Per the user's
instruction, Codex now holds sole implementation ownership of the bounded F4 repair and its
live verification; Claude is idle: no product edits, tests, builds, executors or browser
checks until Codex records results and updated hashes.** Evidence: codex-review.md,
Packet12 section.
Implementation owner: Codex (F4 repair, packet 13).
Receipt 19:40 AST — Codex packet 10 verdict: Freeze 6 hashes match; 31 focused tests
independently; **loading fix passes bounded live Chrome verification** (Anime 64 → 127; real
scrollbar drag and wheel reveal work; programmatic scrolling quiet; no extra request for
over 3 m 40 after completion; Saved 3). Bounded loading approval only. **F3 (P1,
corrected by Codex operationally):** my 16:30 restart ran the PRIMARY checkout's obsolete
`scripts/local-ai/server.ts` (no Instagram/TikTok source routes → 405), which blanked card
details after reload. Codex stopped it and started the managed worktree's server at :3000
(listener PID 39332, `tsx scripts/local-ai/main.ts` from
`C:/Users/AORUS/.codex/worktrees/discover-inspiration/hello-github`); metadata routes
verified 200 by Codex and again by Claude at 19:44 AST. Do not restart it again.

**Managed-server startup (corrected, supersedes "Local app" under Evidence tools):** the
local server must run from the managed worktree, never the primary checkout:
`cd C:/Users/AORUS/.codex/worktrees/discover-inspiration/hello-github && pnpm local:serve`
(serves that worktree's own `out/` at http://localhost:3000, with the current
`/api/local-ai/instagram-source` and `/tiktok-source` routes). After `pnpm build` in the
worktree the served export updates in place; copying `out/` to the primary checkout is no
longer needed or meaningful. Recheck `netstat -ano | findstr :3000` before any restart; if a
restart is unavoidable, start it detached from the worktree and verify a metadata route
(`GET /api/local-ai/instagram-source?url=…` with header `X-Local-AI: 1` → 200), not just `/`.

### Packet 11 plan (Fable, 13 Oct 19:45 AST) — visible-card metadata scheduling

Observation (Codex live): on a large cached native feed the initial visible TikTok card
stayed count-only while offscreen URLs were checked (capture not fully settled).
Hypotheses: H1 the 18/platform batch in `useFeedSources` is chosen by observedAt/attempted
→ evidence score → lexical URL, with no link to display order, so visible (first 24 native)
cards can be starved by offscreen ones; H2 beyond the first batch nothing continues
because `CategoryDiscovery` never calls `checkRemaining` (reveals via Load more/scroll do
not request the next 18). Acceptance: (1) RED→GREEN hook test: 44 TikTok cards where the
first displayed card sorts last lexically and all have equal priority → it must be in the
first batch; a second test that native display order (item index) drives the batch while
`observedAt`/attempted-age ordering for re-checks is preserved; (2) repair only what the
tests demonstrate (likely: order unread candidates by item index instead of lexical URL,
keep attempted/observedAt as first key); (3) if H2 is demonstrated by a test, wire one
`checkRemaining()` per user reveal (limit increase) in `CategoryDiscovery.tsx` — still one
18/platform batch per action, 2 concurrent; otherwise leave it and record; (4) preserve
native order/counts, original `observedAt`, cancellation/key isolation, F2 retention;
(5) focused vitest, lint, typecheck, build in the worktree (served in place), e2e
`discover-native-search.spec.ts` on 3100, freeze. Codex owns live verification.

**Packet 11 result (Opus, single writer, 13 Oct 19:47–19:55 AST):** changed
`components/research/useFeedSources.ts` (+4/−8), `useFeedSources.test.ts` (+84, 4 tests),
`components/research/CategoryDiscovery.tsx` (+2: one `sources.checkRemaining()` call in
`loadMore`'s local-reveal branch, with a comment), `CategoryDiscovery.test.tsx` (+27/−1: the
hook mock now returns a `checkRemaining` spy, one new test; no existing assertion changed).
Pre-edit copies of the four files: scratchpad `p11-baseline/`.
- H1 confirmed and fixed: the first visible TikTok card (URL sorting last, equal priority)
  was left out of the first 18 (RED). Ordering rule now: unread cards first, then the oldest
  observed/attempted, and equal ages keep native display order (item index). Both the
  evidence-score tie-break and the lexical-URL tie-break were dropped: a second test showed
  the score tie-break also pushes the first visible card out. Age ordering for re-checks is
  preserved by a test. Request counts, 18/platform/action, 2-concurrent, native order,
  retained evidence (F2), cancellation and YouTube isolation unchanged.
- H2 confirmed: the hook's continuation works (`remaining` 26 after the first batch;
  `checkRemaining()` fetches exactly the next 18 TikTok) but was never called. Component
  test RED ("called 0 times" on reveal). Fix: one `checkRemaining()` per user reveal (limit
  increase); none on re-renders, none on the native More action.
- Tests: 4 new hook tests + 1 component test failed first; after the fix the two files pass
  41/41 (26 + 15); `pnpm lint`, `pnpm typecheck` exit 0.
- Opus concerns, accepted: a reveal while a batch is still running does nothing (the next
  reveal or a membership change picks those cards up); the next batch follows overall
  display order, not the active tab (on the TikTok tab it also reads the next Instagram
  cards); "one call = one batch of 18 per platform" rests on hook tests, not an end-to-end
  test; whether the owner's first visible Anime TikTok card now gets its caption first is
  Codex's live check. Report: scratchpad `packet-11-opus-report.md`.

### Freeze 7 (13 Oct 19:58 AST) — packet 11 candidate for Codex review

HEAD `0e1fdb0`, uncommitted. Changed since Freeze 6 (four files; `CategoryDiscovery.*`
replace their Freeze 6 fingerprints, `useFeedSources.*` replace their Freeze 5 ones):

```
0fda487296d5c0b626c304cb9874d9e2d68e5b6e7e4651b11ad4ea538fe4a2a3  components/research/useFeedSources.ts
67d5e08aecba89d7827b89db42b75be3f1f6ab1442d5b07c15e49801149783f3  components/research/useFeedSources.test.ts
f4aac5b1f3e1ce9c14dda360cf35ad121a7b59207909e0c7ca460e2ec3a4f909  components/research/CategoryDiscovery.tsx
441e7ad9fbe536ecac80c6652c6855369ef895c2f22c62d9b4f7b7908d3aef63  components/research/CategoryDiscovery.test.tsx
```
The other seven Freeze 2 files and the three Freeze 4 helper files are unchanged. Checks:
focused vitest 41/41 (`useFeedSources.test.ts` 26 + `CategoryDiscovery.test.tsx` 15);
`pnpm lint`, `pnpm typecheck`, `pnpm build` (in the worktree) exit 0; e2e
`discover-native-search.spec.ts` on port 3100: 4 passed (24 s), 3100 clean afterwards. The
managed server (PID 39332, untouched) serves the rebuilt worktree `out/` in place:
`out/discover/index.html` SHA256
`1cb10d1dbb7586e4ff2cd96ceb66524867b2535023556a75243ec90900f9289a` on disk and as served
by `GET http://localhost:3000/discover/`; `GET /api/local-ai/instagram-source?url=…` with
`X-Local-AI: 1` → 200. No copy to the primary checkout (obsolete, see startup note). For the
live check: clear the app's service worker / hard reload first. No extension change (helper
0.3.4). No broad suites rerun; no browser checks by Claude; Saved untouched by this packet.

### Packet 12 (13 Oct 19:53–20:10 AST) — Freeze 7 mismatch reconciled, no product edits

Codex finding: `components/research/useFeedSources.test.ts` recorded as `67d5e08a…` at
Freeze 7, actual `4ae057a1…`; modified 16:51:21 UTC, after the record (16:51:06) and the
completion event (16:51:20.366).

Post-freeze writer identified from the session transcript: Claude's **Stop hook
`stop-format-typecheck.js`** from the installed ECC plugin (one of 12 Stop hooks; 4.3 s).
It reads an accumulator of JS/TS files edited during the response (the Opus subagent's
Edit of the test file at 16:48:25 UTC was listed) and runs the project formatter with
`--write`, so Prettier rewrote the test file at the Stop (16:51:20–24 UTC). The Opus agent's
last edit was 16:48:25 UTC and its tests/lint ran at 16:48:33; it was not the writer. No
other writer (no Codex edits, no Claude edits of that file). The three other changed files
were already Prettier-clean and unchanged.

Delta: formatting only — the file is now `prettier --check` clean; `git diff --stat` went
from 229 to 232 insertions (wrapped lines), same 26 tests, no assertion changed. The Opus
report's "prettier-clean" claim predated its final edit.

Reconciliation: the affected file was re-run alone against its actual content:
`pnpm vitest run components/research/useFeedSources.test.ts` → 26/26. The other three files
and the served export re-hashed identical to Freeze 7; the ECC accumulator for this session
is empty, so the next Stop rewrites nothing. No build, no broad suite, no product edit.

Process rule from now on: before any freeze, run `pnpm exec prettier --check` on every
changed JS/TS file (and `--write` if needed, then rerun that file's tests) so the Stop-time
formatter is a no-op and the recorded hashes survive the completion event.

### Freeze 8 (13 Oct 20:10 AST) — actual packet 11 candidate hashes

HEAD `0e1fdb0`, uncommitted. Changed since Freeze 6 (four files):

```
0fda487296d5c0b626c304cb9874d9e2d68e5b6e7e4651b11ad4ea538fe4a2a3  components/research/useFeedSources.ts
4ae057a1f124efeab1661a121a86dc9c5656323de805366ed54834874b5cde59  components/research/useFeedSources.test.ts
f4aac5b1f3e1ce9c14dda360cf35ad121a7b59207909e0c7ca460e2ec3a4f909  components/research/CategoryDiscovery.tsx
441e7ad9fbe536ecac80c6652c6855369ef895c2f22c62d9b4f7b7908d3aef63  components/research/CategoryDiscovery.test.tsx
```
Tested served build unchanged: worktree `out/discover/index.html` and the page served by the
managed server at :3000 both `1cb10d1dbb7586e4ff2cd96ceb66524867b2535023556a75243ec90900f9289a`
(server PID 39332 untouched, answers 200). Evidence for the candidate: Freeze 7 checks
(41/41 focused at that time; lint, typecheck, build, e2e 4/4) plus the 26/26 rerun of the
reformatted test file. No writers active.
Implementation owner: none.
Note 16:30 AST: localhost:3000 was found DOWN (nothing listening; not touched by Claude's
commands, which only kill listeners on 3100). Restarted detached from the primary checkout
(`pnpm local:serve`, log Temp `3z-local-serve-2026-10-13.log`); answers 200 and serves the
Freeze 6 export.
Codex packet 9 verdict (13 Oct): Freeze 5 hashes match; hook tests 22/22 independently;
**F2 retention passes bounded live Chrome verification** — Anime 34 → 64 (IG 6 → 36, TT 12,
YT 16), all 24 sampled original cards kept identical captions/creators/dates/counts, 64
unique URLs, Saved 3; no extension reload needed; "ready for user acceptance for F2
retention only"; no all-category approval. Observation for packet 10: after one reveal
click and one manual More, the trace recorded three `more` calls (13:08:22, 13:09:10,
13:09:55 UTC) for one job, the first two zero-growth while Chrome was in the background;
cause not proven.

### Packet 10 plan (Fable, 13 Oct 16:20 AST) — origin of repeated More calls

Scope: `components/research/CategoryDiscovery.tsx` (`useNativeInfiniteScroll`, `loadMore`)
and `CategoryDiscovery.test.tsx` only; `useNativeSearch.ts` untouched unless a test proves
its single resume continuation is involved. Executor: Opus. Hypotheses to test, in order:
H1 the `scroll` listener treats ANY scrollTop increase as downward input, so programmatic
scrolls (scroll anchoring when the status line above the grid changes "loading" →
"received", `scrollIntoView`, focus restoration) set intent and, with the sentinel near and
the hook idle, start a request without user input; H2 pending intent survives a manual
Load more and busy transitions, so an earlier downward input is spent after a manual
request completes; H3 `useNativeSearch` resume continuation (one extra `more`, by design).
Acceptance: (1) focused RED→GREEN counterexamples: programmatic scrollTop increase (no
wheel/key/touch/pointer) → no request; manual Load more with stale intent → no auto request
after it completes; quiet completion (busy true → false, no growth, no input) → no request;
real wheel, keyboard, touch and scrollbar-drag (pointer held) loading still work. (2) Repair
only what a test demonstrates: intent only from wheel/touch/key or scroll-while-pointer-held;
clear intent when a request starts (auto or manual). (3) Minimal bounded diagnostics for
Codex's live check only if cheap and inert: a ring buffer of the last 20 load decisions
(origin, busy, near, intent, scrollTop, time) exposed read-only on `window` behind a
localStorage flag; no network, no URLs. (4) Focused vitest, lint, typecheck, build, e2e
`discover-native-search.spec.ts` on 3100, served copy, freeze. Codex owns live checks.

**Packet 10 result (Opus, single writer, 13 Oct 16:22–16:31 AST):** changed only
`components/research/CategoryDiscovery.tsx` (+219) and `CategoryDiscovery.test.tsx` (+246).
`useNativeSearch.ts` untouched.
- H1 confirmed and fixed: with the end marker near and the hook idle, a scroll event whose
  scrollTop increased with no user input started a request (RED: `more` called 2 times,
  expected 0). Now a `scroll` event counts as intent only while a pointer button is held
  (scrollbar drag); wheel, ArrowDown/PageDown/End/Space, touch move and scrollbar drag each
  have a test proving they still load.
- H2 confirmed and fixed: a wheel-down from before a manual Load more was spent after that
  request finished (RED: 2 calls, expected 1). Intent is now cleared whenever `busy` turns
  true and by the Load more button before it loads. The quiet-completion case (busy true →
  false, no growth, no input → no request) already passed; kept as a guard.
- H3 noted, no change: `continueResume` sends at most one extra `more` per resume on the new
  job; two existing `useNativeSearch` tests already prove it cannot loop.
- Diagnostics: with `localStorage["3z-debug-native"] = "1"` (read when the hook starts, so
  set it then reload or change category/tab), `window.__3zNativeLoads` exposes a frozen,
  read-only ring of the last 20 load decisions `{ t, origin, busy, near, intent, scrollTop,
  started }`; no network, no URLs; a test asserts it is undefined without the flag.
- Tests: 3 of 14 component tests failed before the fix; after it the two focused files pass
  31/31; `pnpm lint`, `pnpm typecheck` exit 0.
- What remains unproven live: the 13:09:10 and 13:09:55 calls fit H1 (the "Loading" line and
  per-platform status above the grid change when a request finishes; scroll anchoring then
  moves the page while nothing grew), could also be H2 on foregrounding, or real owner input;
  the 13:08:22 call is either the resume continuation (only if the trace shows a `start` for
  that job just before it) or the manual click. Codex's next live check with the debug flag
  can tell these apart.
- Opus concerns, accepted: Firefox sends no pointer events for page-scrollbar clicks, so
  scrollbar dragging there no longer auto-loads (button and other inputs still work);
  Chrome middle-click autoscroll and touch glide after lift-off no longer start loads by
  themselves (the finger movement before lifting already does). Report: scratchpad
  `packet-10-opus-report.md`.

### Freeze 6 (13 Oct 16:35 AST) — packet 10 candidate for Codex review

HEAD `0e1fdb0`, uncommitted. Changed since Freeze 5 (component + its test only, +463/−2):

```
a5d6bce7237338ef4c7e12938ff95cf01b7c88b4e83305d75860115397d43b6f  components/research/CategoryDiscovery.tsx
8c1812ebdb512eb212820f2cf2f78c959255223fc2619eabd2b1c10f1d213d23  components/research/CategoryDiscovery.test.tsx
```
These two replace their Freeze 2 fingerprints; the other seven Freeze 2 files, the Freeze 4
helper files and the Freeze 5 hook files are unchanged. Checks: focused vitest 31/31
(`CategoryDiscovery.test.tsx` + `useNativeSearch.test.ts`); `pnpm lint`, `pnpm typecheck`,
`pnpm build` exit 0; e2e `discover-native-search.spec.ts` on port 3100: 4 passed (22 s),
port 3100 clean afterwards. Export copied to the primary ignored `out/` (robocopy /E, exit 3,
no purge); `out/discover/index.html` SHA256
`F124A824086F4777C1D8BED0DA2C138BAD6F3D88F4E58460F650D1FE30BA970D` on both sides;
localhost:3000 restarted (see header note) and answers 200. For the live check: clear the
app's service worker, set `localStorage["3z-debug-native"]="1"`, reload, then read
`window.__3zNativeLoads` after the More sequence. No extension change (helper 0.3.4). No
broad suites rerun; no browser checks by Claude; Saved untouched by this packet.
Implementation owner: none.
Codex packet 8 live outcome (13 Oct, helper 0.3.4 reloaded by the owner, Codex-driven Chrome):
Cars 66 → 156 → 246 and Anime 52 → 142 → 232 over one fresh search + two More each; IG
24 → 54 → 84 in both; IDs unique; initial membership/order matched; Saved 3. **F1 loading
check passes in this bounded sample.** New **F2 (P2)**: previously enriched card details
(caption, creator, likes/views, date) disappear after growth for unchanged URLs; root cause
in `components/research/useFeedSources.ts` (source maps reset on membership-scope change,
EMPTY maps exposed until the new scope resolves, new bounded batch prioritises unread URLs).

### Packet 9 plan (Fable, 13 Oct 15:55 AST) — enrichment retention across feed growth

Scope: `components/research/useFeedSources.ts` and `useFeedSources.test.ts` only (plus
`lib/youtubeEvidence.ts`/`discoverSources.ts` only if a type needs exporting). No filters,
no order/count change, no new requests beyond the existing 18/platform/batch and 2
concurrent limits, no extension change. Executor: Opus (async hook, cancellation and
state isolation). Acceptance:
1. When the membership scope changes and the previous run's URLs overlap the new membership,
   completed Instagram/TikTok evidence (including recorded nulls) for the overlapping
   canonical URLs is carried into the new run and exposed immediately (no EMPTY flash), with
   its original observation data; only URLs without evidence are queued; retained state is
   bounded to URLs in the current membership.
2. YouTube: while a new batch fetches, previously fetched evidence for overlapping URLs stays
   applied (same key); a different key or inactive state drops it.
3. Red→green hook tests: enrich A, append B beyond the 18-batch limit → A keeps caption/
   creator/stats without a refetch (request counts asserted); counterexamples: an unrelated
   membership (different category URLs) retains nothing; a late response from a cancelled run
   never lands in the new run; inactive → nothing retained or fetched.
4. Focused vitest for the hook + `pnpm lint` + `pnpm typecheck` green; then `pnpm build`,
   e2e `discover-native-search.spec.ts` on port 3100, export copied to the primary `out/`,
   served hash recorded. Freeze hashes. Codex owns live verification.

**Packet 9 result (Opus, single writer, 13 Oct 15:57–16:04 AST):** changed only
`components/research/useFeedSources.ts` (+15/−? small) and `useFeedSources.test.ts`
(+145). No lib, no extension, no type exports.
- RED: 4 of the 5 new tests failed on the old code (retention on growth; late cancelled
  response; inactive; YouTube same-key retention); the "unrelated membership retains
  nothing" counterexample already passed (it guards against over-retention). GREEN: hook
  suite 22/22; `pnpm lint`, `pnpm typecheck` exit 0.
- Fix: on a membership-scope change the new run is seeded with the previous run's finished
  Instagram/TikTok entries (recorded nulls included) for canonical URLs still in the new
  membership and publishes them immediately; only URLs without an entry are queued; an
  unrelated or inactive membership starts empty. YouTube: same key → overlapping videos keep
  their details while the new batch loads; different/no key or inactive drops them. Limits
  unchanged: 18 per platform per batch, 2 concurrent, continuation (`checkRemaining`),
  `attempted` map, AbortController cancellation.
- Planner ruling on two changed existing assertions: "prioritizes new unread candidates
  when the URL membership expands" and "gives newly discovered posts a turn even when
  earlier source checks returned unknown" expected 36 reads; 36 only occurs when the 18
  unchanged URLs are re-read after growth, which is F2 itself. Now 20 (18 + 2 new): a
  tighter bound. Accepted.
- Opus concerns, recorded: (a) retained details are published from an effect after render,
  so one plain frame may paint before they reappear (Codex's F2 evidence was the settled DOM,
  so this is not the reported loss; a layout-effect follow-up is described in the report if
  seen live); (b) inactive → active with the same YouTube key briefly shows the last
  details before the same-cache fetch resolves (identical data). Report: scratchpad
  `packet-9-opus-report.md`.

### Freeze 5 (13 Oct 16:08 AST) — packet 9 candidate for Codex review

HEAD `0e1fdb0`, uncommitted. Changed since Freeze 4 (app hook only, +153/−7):

```
b4c7ff3b30e2aa0f8dd3ad6bf70b64d8657bac977dbd30aeb4afad6b7a6049df  components/research/useFeedSources.ts
6ce92ae2d1e8d2ac0d5122df1f122b4a66a23d9a3e9463a9e0de8b77fbae8f6e  components/research/useFeedSources.test.ts
```
The nine Freeze 2 fingerprints and the three Freeze 4 helper fingerprints are unchanged
(this hook was not among them; it is a new product fingerprint). Checks on this candidate:
hook suite 22/22; `pnpm lint`, `pnpm typecheck`, `pnpm build` exit 0; e2e
`discover-native-search.spec.ts` on port 3100: 4 passed (31 s), port 3100 clean afterwards.
Export copied to the primary ignored `out/` (robocopy /E, exit 3, no purge);
`out/discover/index.html` SHA256
`F02D91414917B674DD35969046AA196373E451D78A228BB3F533E1F6B8937F26` on both sides;
localhost:3000 answers 200, server untouched. The owner's Chrome may still hold the old
service worker/cache for the served page; Codex's live check should hard-reload or clear
the app's service worker first (see Evidence tools). No extension change; helper stays
0.3.4. No broad suites rerun; no browser checks by Claude; Saved not touched by this packet.
Implementation owner: none.
Earlier: 15:12 AST, Freeze 4 reviewed by Codex — "reviewed; live validation pending". Codex verdict
(13 Oct): handoff and all three helper hashes match, nine app hashes unchanged, 47 focused
helper tests passed independently, no blocking code regression; F1 stays open until real
Chrome evidence. Verification owner: **Codex** (user's decision) — it runs the next bounded
real-Chrome Cars/Anime checks at localhost:3000 on the served Freeze 2 build. Prerequisite:
the owner reloads the unpacked helper so 0.3.4 is installed (browser policy blocked Codex
from chrome://extensions; Codex handles that communication). Claude: no browser checks, no
product edits, no suite reruns until Codex reports; product candidate stays frozen
(Freeze 2 app fingerprints + Freeze 4 helper fingerprints); Saved 3 preserved.
Source edits stopped at 15:02 AST.
Implementation owner: none.
Earlier: after the packet-6 completion event, **Packet6 reviewed; F1 needs bounded helper
repair/diagnostics (packet7); delivered to Claude once**.
Freeze3 has the same product fingerprints as Freeze2. The observed supply gap is accepted;
its focus/timing cause needs owned-tab evidence. Earlier Freeze2 was ready for user
acceptance for continuous loading/retention; broader category validation remained.
Codex verified the final logs and all nine unchanged fingerprints. Packet6 was delivered
to Training Page on13October after11:20UTC: validate Anime/Coffee/Cars, no product edits.
Claude's completion hook now queues Codex immediately; the old timer is paused. The live
hook handshake succeeded. Do not resend Packet6. No product edits since13:12AST (HEAD0e1fdb0).
Implementation owner: none.
Review owner: Codex. Automatic verdict after13October10:59UTC:
**ready for user acceptance — this bounded loading/retention packet**. R1 is resolved;
see `codex-review.md` for evidence and live-check limits, and `review-trigger.md` for
completion-triggered handoffs. No push, merge or deployment from this workflow.

Latest review: Packet6's handoff hash matched and all nine source hashes were unchanged.
See `codex-review.md` for F1, its causal limits and packet7's bounded helper scope.
No repeated test suites. Do not implement before the handoff assigns the single writer.

## Outcome

Combine Instagram, TikTok and YouTube category search for an editor's inspiration
and learning. Trust native search relevance and each platform's ordering. Default
results must not disappear for sparse captions or low likes. Keep evidence-based
Popular filtering optional. Continue loading as the user scrolls, without an
arbitrary two-request stop. Do not promise access to private recommendation algorithms.

## Exact workspace

- Source: `C:/Users/AORUS/.codex/worktrees/discover-inspiration/hello-github`
- Branch: `codex/discover-inspiration`
- Current committed HEAD: `0e1fdb089146f4fd8e5f1d3c7cd58cf5b6fc6127`
- PR: https://github.com/3zmd95-glitch/hello-github/pull/70 (open; no merge instruction).
- App: http://localhost:3000/discover/
- Primary `C:/Users/AORUS/Documents/hello-github/out` serves a copy of the managed
  export. Its tracked source is older; do not edit or run that source for this task.
- Preserve the running local server and Saved3. Recheck process state before any restart.

## Existing unfinished changes — preserve them

- `components/research/CategoryDiscovery.tsx` and its test: downward-intent-aware
  automatic loading near the end; no stationary request loop; manual retry retained.
- `components/research/useNativeSearch.ts` and its test: keep successful cards when
  the same query refresh fails; resume cached/expired jobs; fence obsolete responses.
- `lib/discoverNativeSearch.ts` and its test: append/deduplicate matching sessions,
  bounded retained window, stale timestamps and expired-job handling.
- `e2e/discover-native-search.spec.ts`: new repeated-scroll regression, not yet run.
- `messages/feed.en.json`, `messages/feed.ar.json`: matching stale-result copy.
- `planning/tools/32-native-search-feed.md`: latest native-feed design and evidence.

These changes are uncommitted. This workflow setup also adds coordination documents,
Claude profiles and instructions; it does not change the product implementation.
No code snapshot is currently frozen for review: capture hashes after Claude finishes.

## Evidence already available

- Committed helper 0.3.3 removed the two-request cutoff. Actual Chrome Coffee grew
  **34 → 64 → 134** over repeated manual More attempts; one quiet attempt stayed34.
  Final134 = Instagram66 + TikTok32 + YouTube36. Saved3 remained intact.
  This is manual-loading evidence, not proof of the new automatic-scroll behavior.
- Proof: `C:/Users/AORUS/AppData/Local/Temp/discover-native-033-coffee-134-2026-10-12.jpg`.
- At committed HEAD: lint, typechecks, 3,908 unit tests, build and 438 browser tests
  passed (8 intentional skips). This does not validate the newer dirty changes.
- Partial dirty-change checks reported passing: preservation104 focused tests;
  UI/translation72 tests; cached continuation43 tests. These overlap and are not a
  combined suite count. Continuation agent stopped at its usage limit before final
  lint confirmation. Root has not independently verified the complete final diff.
- Preservation-only build was copied to3000; its earlier native-search browser test
  passed on desktop and phone. The newer automatic-scroll/resume changes are not
  built or served yet. No further helper reload is required: helper source is unchanged.
- Served Discover HTML SHA256 at that last copy:
  `852A4ADF57FA61E0B1E257F25D0EA4EB784CCD6602BC1AB478CD61BDBC8785D5`.

## First work packet for Fable

1. Inspect the current diff, then use Opus for any actual lifecycle/scroll defects and
   Sonnet for bounded test corrections. Do not rewrite working retrieval from zero.
2. Run focused current tests, lint and types. Build the final candidate and run the
   new desktop/phone scroll regression. Fix causes instead of relaxing assertions.
3. Copy the managed export to the primary ignored `out` without deleting user files.
   Confirm the served build matches. Keep the existing port3000 server.
4. In actual Chrome with the installed helper, verify fresh loading and at least
   three further scroll-driven batches, a quiet batch/retry, cached reopen, category
   switch during loading and Saved preservation. Record counts and screenshots.
   Verify return to Discover separately; it remains unconfirmed.
5. Freeze the diff and hand it to Codex. Run remaining required push gates on the
   final candidate if a push is requested; do not repeat unaffected suites needlessly.

Done means the loading behavior is verified and findings are resolved, with honest
platform failures. The complete12-category/3-platform live matrix and audiovisual
quality/current repeated effect or audio adoption remain later work packets.

## Plan, implementation and review log

### Fable plan (13 October 2026, Fable 5.1 planner session)

Starting state: branch `codex/discover-inspiration` at `0e1fdb0`, 13 dirty files (871+/39-),
preserved as-is. Source diff read in full: `useNativeInfiniteScroll` (intent + proximity +
lock), `useNativeSearch` resume/append/retain paths, `discoverNativeSearch` helpers,
new e2e scroll regression, stale copy keys. No rewrite; verify and repair only.

**Acceptance criteria**

1. Scroll loading: a new batch starts only with continued downward input while the
   sentinel is near and no request is busy; a stationary sentinel never spends a request;
   the manual Load more button stays enabled and works after auto batches.
2. Lifecycle: the same-query refresh that fails keeps earlier cards marked stale; cached or
   expired jobs resume once (no loop); responses for an obsolete scope/genre/query are
   dropped; cancel stops polling; Saved references untouched.
3. Checks on the final candidate: focused vitest files green; `pnpm lint`, `pnpm typecheck`
   green; `pnpm build` green; `E2E_PORT=3100 pnpm e2e e2e/discover-native-search.spec.ts`
   green on desktop and phone. No assertion weakened; causes fixed.
4. Served build: worktree `out/` copied over primary ignored `out/` without deleting
   files; `out/discover/index.html` SHA256 equal on both sides; :3000 server untouched.
5. Live Chrome (owner's Chrome, installed helper): fresh load, 3+ scroll batches, one quiet
   batch then retry, cached reopen, category switch mid-load, Saved count unchanged.
   Counts and screenshots recorded here. Return-to-Discover reported separately.

**Packets and executors (one writer at a time)**

- Packet 1, Opus: read the dirty diff of `components/research/CategoryDiscovery.tsx`,
  `components/research/useNativeSearch.ts`, `lib/discoverNativeSearch.ts` and their tests.
  Run the four focused vitest files. Check these candidates: lock release when `loadMore`
  only raises the local limit; `intent` consumed but `near` false on phone (sentinel >480px
  below fold) until scroll fires; `more()` on error state with a still-valid job; double
  `moreNativeSearch` from `continueResume` plus a user click; stale `view` closure in
  `search()`. Fix real defects with tests; report non-defects with reasons. Then lint and
  typecheck. Hand back.
- Packet 2, Sonnet: `pnpm build`, run the e2e file on port 3100 (both projects), fix test or
  copy-only issues; key parity `messages/feed.*.json`; copy `out/` to primary and compare
  SHA256. Escalate any product-logic failure to the planner instead of patching tests.
- Packet 3, planner: live Chrome verification (criterion 5) with screenshots to Temp; then
  freeze: record HEAD, dirty files, SHA256 per reviewed file, evidence; stop edits; mark
  ready for Codex review.

Out of scope: 12-category live matrix, audiovisual quality, Popular ranking, helper source.
No push, merge or deploy without the user's word. No port 3000 for tests.
**Packet 1 result (Opus, 13 Oct ~11:00 AST):** one defect fixed, candidate (c): after a
finished search with `hasMore:false`, a rejected typed query set `error: "invalid-query"`
without cancelling the run; the new error term in `canMore` re-enabled Load more, whose
click sent a helper `more` that restarted the job and reopened tabs. Fix in
`components/research/useNativeSearch.ts` (`canMore` ignores `invalid-query`), new test in
`useNativeSearch.test.ts`. Candidates a, b, d, e, f: not defects (reasoning in the Opus
report, copied below at freeze). Focused vitest 51 → 52 pass; `pnpm lint`, `pnpm typecheck`
exit 0. Concerns recorded: (1) upward input does not clear scroll `intent` (assigned to
packet 2); (2) whole-job refresh failure shows no per-platform stale label; (3) cards vanish
during a same-query refresh until the first results poll (pre-existing at HEAD, out of
scope); (4) auto-loading pauses while an error is set, manual button still works.

**Packet 2 result (Sonnet, 13 Oct ~11:10 AST):** upward input now clears scroll `intent`
(`CategoryDiscovery.tsx`, new unit test; scroll-up and touch-down branches implemented
but not unit-tested). Focused vitest 53/53; `pnpm lint`, `pnpm typecheck`, `pnpm build`
exit 0; `feed.en/ar.json` 164 keys each, parity ok. E2E `e2e/discover-native-search.spec.ts`
on port 3100: 4/4 (phone + desktop). The new scroll test's MOCK was changed twice, no
assertion touched: (1) `more` must answer the full job snapshot as the real helper does,
`{ok:true}` alone was rejected as invalid-response; (2) the mock now stays `running` 700 ms
because an instant completion let residual scroll events of the same End press start a
second batch (12 → 36). Codex: please judge whether (2) hides a product case where a fast
completion plus residual scroll momentum spends one extra request. Export copied to the
primary ignored `out/` with robocopy /E (no purge); `out/discover/index.html` SHA256
`ACFB00CA3E0FE9326BDF89C42F218C0111676E75C0615334DA6B001D56532730` on both sides;
localhost:3000 still answers 200, server untouched.

Actual executor models: packet 1 ran through the Agent tool with model alias `opus`
(the session cannot read the exact model id; the `team-opus` profile pins
`claude-opus-5-5`). Sonnet packet: alias `sonnet`.
**Packet 3 result (planner, live Chrome, 13 Oct 11:11–11:35 AST, served build SHA256
`ACFB00CA…56532730` confirmed in the page with `crypto.subtle` after unregistering the stale
service worker and clearing its cache):** owner's Chrome, installed helper (`status` →
connected), English UI, Coffee category, query "coffee edit".

| Step | Observation |
| --- | --- |
| Fresh open (cached snapshot of 12 Oct) | 134 loaded (IG 66 / TT 32 / YT 36), 24 shown; no auto search on a cached category (by design) |
| Downward input near the end ×5 | local reveal 24 → 48 → 72 → 96 → 120 → 134; no helper request |
| Next downward input (all cards visible) | cached snapshot resumed: new job, append path; 134 → 137 (TT 34, YT 37) with "showing earlier results from 10/12/2026 9:19 AM" labels on retained cards |
| Scroll batch 2 | request sent (Load more hidden while busy), completed quiet 137 → 137, button back |
| Scroll batch 3 + manual Load more (attribution mixed, see note) | 137 → 173 → 200 (IG 85 / TT 47 / YT 68); new cards visible immediately |
| Scroll batch 4 (clean) | 200 → 206 (IG 91) in ~53 s, completed, button re-enabled |
| Stationary 20 s, no input | no request started |
| Scroll batch 5, then category switched to Anime mid-load | Anime shows its own cached 36 (IG 24 / TT 12 / YT 0 "couldn't read"), no Coffee cards, no late Coffee response applied (30 s watch) |
| Switch back to Coffee | cached reopen instant: 206 loaded, saved 10/13 11:32:56 AM, 24 shown |
| Saved | 3 before, 3 after (`Saved (3)` and store `inspirations` length) |

Note: one browser_batch timed out on my side while Chrome kept executing its queued
scroll/click steps, so the 137 → 200 growth mixes scroll-driven and manual Load more
requests; batches 1, 2 and 4 are cleanly attributed. Return to Discover (helper tab
restoration) was NOT verified. Proof: Temp `discover-native-scroll-coffee-206-2026-10-13.jpg`.

**Findings for Codex (not fixed, planner rulings):**
1. Cached snapshots can show a platform as "loading" forever: the cache is written while
   the job is still running (`useNativeSearch.poll` writes whenever any platform has
   results), so a reopened category shows "YouTube · 68 · loading" with no live job. Seen
   twice live (12 Oct cache and the 11:32 cache). Low severity, misleading copy. Proposed:
   write the cache only on `complete`/`cancelled`, or render cached `loading` as "received".
2. Opus concern 3 (cards vanish during a same-query refresh until the first results poll)
   is pre-existing at HEAD; not observed live because cached categories do not auto-refresh.
3. Opus concerns 2 and 4 (no stale label on whole-job failure; auto-loading pauses while
   an error is set) accepted as-is: manual retry covers both.
4. Sonnet's e2e mock change (2) — see packet 2 — needs an independent judgement.

### Freeze (13 Oct 11:35 AST)

Branch `codex/discover-inspiration`, HEAD `0e1fdb089146f4fd8e5f1d3c7cd58cf5b6fc6127`,
uncommitted. SHA256 of every dirty/new file at freeze:

```
3cef13fdce27fe2c5357dea0d2788d590ab51f9493fafb689e87d86b756b369c  AGENTS.md
c9495fca93ae00d77f497bbb0bd1f6283d24915a84450471bbf7d836cf26414a  CLAUDE.md
be9b5c8cfd2080cb6b8d74fec18e986dc24182876096b278a0d732f05e9e43df  components/research/CategoryDiscovery.test.tsx
494519e572eabc99bc6debffb0b43b36456390f84bed6ce120f2c9937e714afe  components/research/CategoryDiscovery.tsx
acebe8470b2ab8341863ff7c47ba4bce30ac73d1a9eedbf2b58feb960a8626dd  components/research/useNativeSearch.test.ts
d9df81db94e1b52c9f4875574b90c6d73c7468cff0d4faafae1c6c70ac811f1e  components/research/useNativeSearch.ts
6ad9354f20f78300957c7b07c939e8e0148966efb901030746a3657ac0e4cd34  e2e/discover-native-search.spec.ts
554736ba7e980cf2980d381991ced4f1338d09baa3cf0558416aaab8071b344e  lib/discoverNativeSearch.test.ts
2c8ab9fbe43159389827ba271c052ac3eba2c2979511f47fa0e464b574b54db5  lib/discoverNativeSearch.ts
1f2ea68789bd73a671821c66b14d14dc266c067a3108418c7927f845a69a1899  messages/feed.ar.json
ba33b540dc50e209ad818203db3ba1fecdeae5d90bd258b214a6f08dbd7722cb  messages/feed.en.json
df2de95ef547ed6cde75831632108f8d864095335716cc01dc9099729b6a16e0  planning/handovers/discover-resume-2026-10-11.md
9a67820b58a30138efb432b47eb77082f22422d8f72763c343e108aafe0d18ce  planning/tools/32-native-search-feed.md
50102c51f0559a9d29dd9f168548446a2b27605fc31a20ae85ecc2db055da0d7  planning/collaboration/workflow.md
99edd20ae0ced951beb7ead083f5acbe0d15189ae8a7a3984b2cc5ac0531d0d6  .claude/agents/team-opus.md
3085fd606f6f68df10fe7863e168cf19792541fd1fa962966c3813f640023b66  .claude/agents/team-planner.md
441e08321df5cce535f0549b078cb6424e821aa1b39d2500374eb79c2bf7072e  .claude/agents/team-sonnet.md
```
(`planning/collaboration/current-task.md` is this file and changes with the log.)
Product changes by Claude in this packet: `useNativeSearch.ts` (`canMore` ignores
`invalid-query`), `useNativeSearch.test.ts` (+1 test), `CategoryDiscovery.tsx` (upward input
clears intent), `CategoryDiscovery.test.tsx` (+1 test), `e2e/discover-native-search.spec.ts`
(mock only). Everything else is Codex's earlier dirty work, untouched.
Full reports: Temp `claude/C--Users-AORUS-Documents-hello-github/1f24b7e7-…/scratchpad/
packet-1-opus-report.md` and `packet-2-sonnet-report.md` (Opus verdicts a–f with file:line).

Test evidence for final candidate: focused vitest 53/53 (3 files); `pnpm lint`, `pnpm typecheck`
(app + Worker), `pnpm build` exit 0; e2e `discover-native-search.spec.ts` 4/4 on port 3100
(phone + desktop). Full `pnpm test` and full `pnpm e2e` were NOT rerun on the final diff (last
full runs: 3,908 unit / 438 browser at HEAD); required before any push.
Codex findings/verdict (13 Oct 09:58 UTC): **changes required**, R1 (P2) — see
`codex-review.md`. The 15-minute heartbeat `review-claude-s-discover-work` rechecks
automatically; the user does not prompt it.

### Repair round 1 (13 Oct 13:10–13:40 AST)

Planner rulings: (1) R1 fix inside `retainFailedNativePlatforms` only: retain prior cards
also when the prior platform status was `loading` (cards present); keep genre + per-platform
query match, show the current failure status, `staleAsOf` = prior marker or `previous.asOf`.
(2) Cached idle "loading" label: normalize at cache read in `validNativeCache`: `loading`
with ≥1 result → `done` (cards were received); `loading` with 0 results → `error` (the read
never finished; copy "couldn't read — open search" is honest). No cards dropped, cache write
timing unchanged (bigger change, not this round). Codex judges.

**Packet 4 result (Opus, single writer):** changed `lib/discoverNativeSearch.ts`
(`retainFailedNativePlatforms`, `validNativeCache`), `lib/discoverNativeSearch.test.ts`
(+2 tests: R1 cases a–e incl. different-query, successful-`empty` and 0-card counterexamples;
cache normalization both branches, direct and write→read), `components/research/
useNativeSearch.test.ts` (+1 hook test: cached loading snapshot → same-query `search()` →
poll answers `error` empty → cards still present with `staleAsOf`). No other product or copy
file touched. RED: 3 failed | 44 passed on the expected assertions; GREEN: focused vitest
56/56; `pnpm lint`, `pnpm typecheck` exit 0. Opus concerns: the hook test's RED run was an
earlier two-pass version of the same test (not re-run against unfixed code after trimming);
`writeNativeSearchCache` goes through `validNativeCache`, so the stored copy is normalized at
write time too; the cached job-level `status: "running"` is left as is (UI does not read it
for cached snapshots). Report: scratchpad `packet-4-opus-report.md`.

### Freeze 2 (13 Oct 13:15 AST) — ready for Codex recheck

Branch `codex/discover-inspiration`, HEAD `0e1fdb089146f4fd8e5f1d3c7cd58cf5b6fc6127`,
uncommitted. Candidate checks: focused vitest 56/56 (3 files); `pnpm lint`, `pnpm typecheck`
exit 0; `pnpm build` exit 0; e2e `discover-native-search.spec.ts` on port 3100: 4 passed
(phone + desktop), serve on 3100 stopped afterwards. Export copied to the primary ignored
`out/` with robocopy /E (no purge, exit 3 = copied + extras kept); `out/discover/index.html`
SHA256 `45011FC6BA326FEA7675A0C443F9F02DB3048BD9EB384F6EBF41A02080E1B7A0` on both sides;
localhost:3000 answers 200, server untouched. Full `pnpm test` / full `pnpm e2e` still not
rerun (required before any push). Product fingerprints (changed since Freeze 1 marked *):

```
be9b5c8cfd2080cb6b8d74fec18e986dc24182876096b278a0d732f05e9e43df  components/research/CategoryDiscovery.test.tsx
494519e572eabc99bc6debffb0b43b36456390f84bed6ce120f2c9937e714afe  components/research/CategoryDiscovery.tsx
448cb7160b5ecaf395a9699658fce2a2459139f4d3b5665cdd62ed257436158d  components/research/useNativeSearch.test.ts *
d9df81db94e1b52c9f4875574b90c6d73c7468cff0d4faafae1c6c70ac811f1e  components/research/useNativeSearch.ts
6ad9354f20f78300957c7b07c939e8e0148966efb901030746a3657ac0e4cd34  e2e/discover-native-search.spec.ts
31e9480023d40deeb2b2095bf3d6920bd244ee5a8a9ccfbf242596ea3432db2c  lib/discoverNativeSearch.test.ts *
d155254cb1dfd6bc38d80ca8482af0f5eca6c290662fb75fab336b96b5ba11bd  lib/discoverNativeSearch.ts *
1f2ea68789bd73a671821c66b14d14dc266c067a3108418c7927f845a69a1899  messages/feed.ar.json
ba33b540dc50e209ad818203db3ba1fecdeae5d90bd258b214a6f08dbd7722cb  messages/feed.en.json
```
Non-product dirty files unchanged from Freeze 1 (AGENTS.md, CLAUDE.md, planning/*).
Live check of the served Freeze 2 build (owner's Chrome, 13:17 AST, stale service worker
cleared, page hash `45011FC6…80E1B7A0`): reopened cached Coffee shows "YouTube · 68 ·
received" instead of the earlier idle "loading"; 206 loaded / 24 shown; Saved 3. R1 itself
(identical-query refresh answered with an empty error) was not reproduced live, only in tests.
Source edits stopped at 13:12 AST. Repair/review rounds used: 1 of 2.
Codex automatically rechecked these fingerprints: R1 resolved,47 focused tests pass.
Remaining: return-to-Discover verification and full final gates before any authorized
push. Do not repeat review of unchanged files; see `codex-review.md`.

### Packet 5 plan (Fable, 13 Oct 13:45 AST) — validation only, no source edits

Acceptance: (1) live return-to-Discover: in the owner's Chrome, with the Discover tab
active and untouched during the request, a scroll-driven More completes and the Discover
tab is the active tab again at the end; a `visibilitychange` timeline recorded in the page
shows what happened. Report honestly if the helper never leaves the tab (nothing to return
from) or if it ends on a platform tab. (2) Full gates on the Freeze 2 candidate, once:
`pnpm test` (all vitest files) and `E2E_PORT=3100 pnpm e2e` (all browser tests, phone +
desktop); known flakes (`scripts/local-ai/server.test.ts` "bad port", `npx serve` "too many
open files") rerun once for the failed files only. Executors: planner does (1) in Chrome;
Sonnet runs (2) and reports counts; Opus only if a real product defect appears (then a new
freeze). Implementation owner: none; product fingerprints stay as Freeze 2.

**Packet 5 results (13 Oct 13:43–13:55 AST):**

(2) Full gates on the Freeze 2 candidate (Sonnet, validation only, no file edited):
`pnpm test` → `Test Files 197 passed (197)`, `Tests 3928 passed (3928)` (47.9 s, no flake
rerun needed); `E2E_PORT=3100 pnpm e2e` → `440 passed`, `8 skipped`, exit 0 (6.1 min, no
"too many open files"); port 3100 clean afterwards, :3000 untouched; `git status`/`git diff
--stat` unchanged (13 files, +1015/−39). Logs: Temp `discover-final-unit-2026-10-13.log`,
`discover-final-e2e-2026-10-13.log`; report scratchpad `packet-5-sonnet-report.md`.

(1) Return-to-Discover (planner, owner's Chrome, served Freeze 2 build, `visibilitychange`
+ focus listeners installed in the Discover page, no clicks during requests):
- Coffee, cached 206, scroll-driven More: request ran 10:44:06–10:46:19 UTC and the Discover
  tab was never hidden (timeline has one entry). The helper did not switch tabs in this
  window for that job, so nothing to return from. Quiet result 206 → 206.
- Anime, fresh "Search all three" ("anime edit"): hidden 10:49:22 → visible 10:50:20 UTC
  (the visible timestamp coincides with my poll, so attribution unclear). Result 36 cached →
  18 (IG 6, TikTok 12 "couldn't read — showing earlier results from 10/12 7:57 AM" = the
  Freeze 2 retention path live, YouTube 0 "couldn't read").
- Anime, scroll-driven More (End key at ~10:50:40): hidden 10:50:41 → **visible 10:50:45
  UTC on its own**; the next tool call came at 10:52:33, so the return was the helper's,
  not mine. 18 → 34 (YouTube 0 → 16, TikTok 12 received). **Return to Discover verified
  for an explicit More in the originating window.**
- Saved 3 throughout. The Anime cache now holds this fresh 34-card snapshot (cached 36 from
  12 Oct replaced by the user-style fresh search).
Limits: one window, one live session each; helper tab switching did not occur for the
cached-Coffee More, cause unknown (owned tabs may live in another window). The 12-category
live matrix and visual/trend quality remain later packets.

Next action: Codex automatic recheck (fingerprints unchanged since Freeze 2). Push, merge,
deploy and paid usage still need the user's word.

Codex outcome (13 Oct 11:20 UTC): Packet 5 accepted with stated limits; live Stop hook
queued the probe; timer polling paused.

### Packet 6 plan (Fable, 13 Oct 14:25 AST) — category matrix validation, no product edits

Scope: Anime, Coffee, Cars × Instagram, TikTok, YouTube in the owner's Chrome on the served
Freeze 2 build. Budget per category: ≤1 fresh native search + ≤2 More (Anime's fresh search
of 13:48 AST is reused; Coffee keeps its 206 cache, no fresh search; Cars gets the fresh
search). Browser owner: planner. Sonnet only for a bounded offline comparison if needed.
Per category, record: initial and after-More counts per platform; app card URLs vs the
platform's own search page links (overlap and order, read from the helper's search URL in
a second tab of the owner's Chrome); duplicates by canonical URL; thumbnails present vs
"Preview unavailable"; stale fallbacks; blockers. Sample 3–5 cards per category for editing
usefulness, no trend claims without date/popularity evidence. Stop at the first concrete
defect or at the end of the matrix; propose a bounded repair or next validation. Saved
must stay 3. Implementation owner: none throughout.

### Packet 6 results (planner, owner's Chrome, 13 Oct 14:22–14:40 AST; times below UTC)

Method: app cards read from the DOM (`native-result-card` links, `<img>` naturalWidth,
"Preview unavailable" text, canonical-URL duplicates); platform pages opened in a second
tab of the same Chrome (`instagram.com/explore/search/keyword/?q=…`, `tiktok.com/search?q=…`,
`youtube.com/results?search_query=…`) and their post anchors counted after 8 s and 18 s and
after scrolling. Tool navigation of the second tab did not change the active tab (no
`visibilitychange` in the Discover page), so it did not interfere with helper tab switching.
No product edits; no AI uploads; no paid usage; Saved 3 throughout.

| Category (query) | App initial | After More 1 | After More 2 | Platform page (foreground) |
| --- | --- | --- | --- | --- |
| Anime ("anime edit"; fresh search 10:48 reused) | 34 = IG 6 / TT 12 / YT 16 | 47 = IG 8 / TT 16 / YT 23 (resumed expired job, append path) | 75 = IG 36 / TT 16 / YT 23 (YT ended "open to sign in or continue", 23 retained) | IG anchors: 6 at 8 s, 24 at 18 s, 48 and 72 after two scrolls; TT 18 links (6 are a top block by one numeric user id, then the 12 the app has); YT 36 ids |
| Coffee ("coffee edit"; cached 206, no fresh search, no More) | 206 = IG 91 / TT 47 / YT 68 | — | — | IG 24 anchors at 8 s and 18 s; TT 18 (same 6-item top block + app's set); YT 20 ids |
| Cars ("car edit"; no cache, fresh search 11:35:55) | 30 = IG 6 / TT 12 / YT 12 | 30 (quiet; tab hidden 11:37:49 → visible 11:37:52) | 30 (quiet; no tab switch at all) | IG 24 anchors at 8 s and 18 s; TT 18; YT 30 ids |

Ordering and membership: the app's per-platform order matches the platform page order
in every category (Anime IG first five identical; Cars TT first eight identical to page
items 7–14; YT first ids identical; Coffee cached lists still share 9–10 of the first 12
with today's pages). No duplicates by canonical URL in any category (an earlier "dups"
reading was my own YouTube canonicalisation error, corrected). TikTok's first six page
links are a top block from one numeric account that the app does not import; this looks
like TikTok's non-video/top section, not an omission of search results.

Thumbnails: Anime 1 of 36 Instagram cards has a non-loading `<img>` (`/p/CWi1ExzI1_D`);
all other cards in all three categories loaded (a first fast-scroll reading showed many
"broken"/"Preview unavailable" on Coffee; after letting images settle, first 24 all ok and
0 "Preview unavailable", so that was lazy loading, not a defect). Stale fallbacks shown
honestly: Anime TikTok kept 12 earlier cards under "couldn't read" (fresh search), Coffee's
cached labels say "showing earlier results from 10/12/2026". Coffee rendered 192 of 206
after nine quick reveal steps; no feedback hides Coffee cards (1 feedback entry total), so
the remaining 14 were most likely not yet revealed by my scripted scrolling. Unverified.

**Concrete finding F1 (helper supply, not app logic): Instagram initial reads return
exactly 6 posts for every category, and More requests are inconsistent.** The same
Instagram search URL in a foreground tab exposes 24 post anchors within 8–18 s (Coffee,
Cars) or 6 → 24 by 18 s (Anime) and 72 after two scrolls, while the helper's background
initial read delivered 6 (Anime 10:48, Cars 11:35; Coffee's first batch on 12 Oct was 6 too).
Anime's second More grew Instagram 8 → 36, but Cars' two Mores were quiet on all three
platforms and the second did not switch tabs at all. So "sparse Anime Instagram" is a
helper timing/background-rendering limit, and More growth depends on whether the helper
activates the owned tab. Evidence: Temp `instagram-anime-edit-foreground-72-anchors-2026-10-13.jpg`,
`discover-native-cars-30-2026-10-13.jpg`, counts above. This is in
`extensions/discover-import/native-search.js` (helper), outside this packet's app scope.

Editing-usefulness sample (no trend claims): Cars — "smooth enough? #car…" (TikTok,
Oct 8, 9.2M views), "120FPS bare minimum" (TikTok, Aug 11), "Bmw tutorial" (YouTube, Jul
2025, 5.2M), "Capcut Car editing Tutorial" (TikTok), "car edit watermark edit" (YouTube);
Anime — "Editing the movie in a minute" (TikTok zvk.amv, Aug 4, 1.1M), AMV edits with
dates Oct 12 and views 58–110K (YouTube); Coffee — "How I Film AND Edit a Coffee
Commercial", "HOW TO FILM THE MOST EPIC COFFEE B ROLL", "Cinematic Coffee B Roll - Sony
A7S III" (YouTube). Mixed: strong technique material next to generic fan edits; dates and
view counts are shown on cards, so the owner can judge recency himself.

Proposed next (bounded, helper packet, needs its own freeze): (1) initial Instagram read:
wait until the post-anchor count stops growing (observed 6 → 24 by 18 s) instead of a fixed
8 s + 4 s stable window; (2) More: log and verify that the owned platform tab is activated
on every More (Cars More 2 never switched) and read the anchor count before/after the
scroll; (3) re-run this Cars/Anime check after the helper update. App side: nothing to
change in this packet.

Freeze 3 (13 Oct 14:42 AST): no product file changed; the nine Freeze 2 fingerprints
re-verified identical (combined SHA256 of the hash list `3529fd84…d1d0cf`), HEAD `0e1fdb0`,
13 dirty tracked files, Saved 3, localhost:3000 untouched.

Codex outcome on packet 6: accepted as observed gap; cause not proven by separate-tab
counts; early-exit risk at `native-search.js:369` (clock starts before tab load; 8 s + 4 s
quiet can end a 6-card plateau before hydration ~18 s). Packet 7 authorized.

### Packet 7 plan (Fable, 13 Oct 14:50 AST) — helper hydration window + bounded diagnostics

Scope: helper only — `extensions/discover-import/native-search.js`, its test file, and
`manifest.json` (version bump so the owner can see the reload). No app files, no new
permissions, no result filters, no unconditional activation, no override of user tab/window
changes. Executor: Opus, single writer. Acceptance:
1. Initial read: the quiet window is measured from the first successful collection, not
   from `started`; Instagram gets a bounded hydration opportunity (plateau of a first row
   may grow until ~18 s after first collection) inside the existing 25 s platform timeout;
   quiet pages still finish within bounds; More's scroll bounds unchanged.
2. Red regression first: a deterministic page that returns 6 cards early and 24 at ~18 s
   after first collection → before the fix the initial read ends with 6; after, 24. Existing
   focus, cancellation, moved/closed-tab, stalled-injection and quiet-page tests stay green.
3. Bounded diagnostics carried in the job snapshot (poll) without breaking the app's
   validator: request accepted vs already-running; per platform returned/new counts,
   elapsed ms, stop reason; focus eligibility or skip reason, activation and restoration.
4. Freeze helper/test/manifest hashes; live Cars/Anime validation only after the owner
   reloads the unpacked extension (user-controlled step) — not claimed from tests.

**Packet 7 result (Opus, single writer, 13 Oct 14:52–15:02 AST):** helper files only.
- RED: new regression (fake Instagram page: tab loads ~3 s, 6 cards on early reads, 24 from
  ~18 s after the first successful read) failed on the old code at
  `native-search.test.ts:238` — expected 24 results, got 6. GREEN after the fix.
- Fix in `extensions/discover-import/native-search.js`: the initial 8 s minimum and the 4 s
  quiet rule are now counted from the first successful read (`collectedAt`), not from
  before tab creation; new `IG_HYDRATION_MS = 18000`: an Instagram initial read whose count
  has not grown beyond its first row keeps reading (no scrolling) until 18 s after the first
  read, then the quiet rule applies. Unchanged: 25 s loop cap and race timer, 25-attempt cap,
  `added >= 30` early exit, More's 4 s quiet / ≤3 scrolls, focus/activation policy. TikTok and
  YouTube get no hydration window.
- Diagnostics on the poll snapshot (app validator ignores extra keys, read-only confirmed):
  job `diagnostics.request` "accepted" | "already-running"; `diagnostics.focus`
  `{ eligible, skipReason?, activated: [platforms], restored: false|true|"skipped"|"pending" }`;
  per platform `diagnostics { returned, added, elapsedMs, stopReason }` with stop reasons
  `target`, `hydrated-quiet`, `quiet`, `time-cap` (ran out of time/attempts after ≥1 good
  read), `timeout`, `needs-attention`, `cancelled`, `page-changed`, `read-failed`, `scroll-cap`.
- `manifest.json` 0.3.3 → 0.3.4. **Owner step before any live check: reload the unpacked
  extension in chrome://extensions.**
- Tests: `native-search.test.ts` + `native-protocol.test.ts` 47/47 (32 + 15; 2 new tests);
  `pnpm lint`, `pnpm typecheck` exit 0. One existing expectation changed with reason: "waits
  at least eight seconds before completing a small initial native grid" now expects 18000
  (that fake page is Instagram stuck at 6 cards — the plateau the fix must wait out; still an
  exact equality).
- Opus concerns: (a) worst case (3 s load + hydration exactly at 18 s) ends on `time-cap`
  with all 24 cards and status `done`, not `hydrated-quiet`; (b) an Instagram page that never
  grows now takes 18 s after the first read instead of 8 s; (c) whether a background
  Instagram tab hydrates at all is not provable by tests — live check after reload.
  Report: scratchpad `packet-7-opus-report.md`.

### Freeze 4 (13 Oct 15:05 AST) — helper candidate for Codex review

HEAD `0e1fdb0`, uncommitted. Changed since Freeze 3 (helper only, +187/−15):

```
8e08be137b3089b401a4ef288d6460f38acf1d6e968ef6d815e226f8375f7be2  extensions/discover-import/native-search.js
b3a634dcb6ff00285ea3c0487cb332361e88ff33142a54b8f8af47ace1d41ef0  extensions/discover-import/native-search.test.ts
53b58cfcf42663eb1623835dc0745a7673a3b40b9ab7655dbb3c8da7cbb82565  extensions/discover-import/manifest.json
```
The nine app product fingerprints are unchanged from Freeze 2 (combined `3529fd84…d1d0cf`).
Not done: live Cars/Anime validation with the updated helper (needs the owner's reload);
no broad suites rerun; Saved 3; localhost:3000 untouched; no push/merge/deploy/paid usage.
Implementation owner: none.

## Codex category infinite-scroll repair — 18 Oct 2026
Implementation owner: Codex. User explicitly reassigned implementation and requests infinite scrolling in the same category. Claude remains paused. Scope: shared infinite-scroll hook, category/keyword wiring and bottom loading indicator, focused tests. Keep native helper permissions, quiet/deep behavior, saved data and provider ordering unchanged. Continue only after progress while the reader stays near the bottom; no automatic no-growth loop. Verify local tests, build and Chrome separately. No deployment.

### Codex category infinite-scroll result — 18 Oct 2026
Implementation owner: none. Shared hook now continues after visible progress while near the bottom, retains input during loading, and ignores browser-anchoring upward movement. Category/keyword bottom loading status added. 120 focused tests and 6 installed-Chrome e2e tests passed; lint/format/typecheck/build passed. Local preview left running. Live Travel/TikTok revealed 24 -> 45 cached cards and requested the next source batch automatically; source returned no growth at 45, so endless fresh native content is not claimed. Evidence: C:/Users/AORUS/.codex/review-evidence/dashboard-tools/category-infinite-scroll-2026-10-18/review.md. Claude remains paused; no task sent. No deployment.

## Codex manual source-tab control — 18 Oct 2026
Implementation owner: Codex. Owner requests source windows/tabs only on a manual button. Remove category-entry searches; label explicit search/open actions. Scroll may reveal local cards or continue a live quiet job only; cached/deep/expired jobs must wait for an explicit click, never reopen or refocus automatically. Claude remains paused. No helper permissions or deployment changes.
### Manual source-tab control result — 18 Oct 2026
Implementation owner: none. Explicit source buttons replace category-entry automatic searches. Automatic scrolling is restricted to local cards and live quiet jobs; cached/deep/expired jobs cannot reopen or refocus sources automatically. 146 final focused tests, 76 unchanged helper tests, 8 installed-Chrome cases passed; lint/build/typecheck clean. Preview rebuilt and remains running. Evidence: C:/Users/AORUS/.codex/review-evidence/dashboard-tools/manual-source-tabs-2026-10-18/review.md. Claude remains paused; no deployment or helper permission change.
