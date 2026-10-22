# Dashboard tools — packet DT-1 handoff (Tools & Integrations hub)

Companion to `dashboard-tools-audit-2026-10-16.md` (Codex audit and acceptance criteria).
Separate from the Discover/music stream: packet 30 in `current-task.md` stays frozen and
is not reopened by this document.

**Implementation owner: none.** (DT-1 frozen 16 Oct 2026 14:00 AST after repair round 1. Writer was Claude Opus 5.5, single writer, 13:35–13:47 AST and 13:55–13:56 AST.)

Worktree `C:/Users/AORUS/.codex/worktrees/discover-inspiration/hello-github`, branch
`codex/discover-inspiration`, HEAD `0e1fdb089146f4fd8e5f1d3c7cd58cf5b6fc6127`, all work
uncommitted. Pre-existing dirty files (Discover/music, `lib/platformIcons.tsx`, social
platform marks) are the starting state and must be preserved byte for byte. The E2E baseline
Codex ran finished before this packet started: 145 passed, 3 skipped
(`%TEMP%/dashboard-audit-2026-10-16-root/e2e.log`).

## Plan (Fable 5.1, 16 Oct 13:30 AST)

**Outcome.** A read-only "Tools & Integrations" hub at `/tools` (Training shell, like Discover
and Settings) listing every existing capability with an honest readiness state, searchable in
Arabic and English, reachable from both worlds' More pages. Opening it performs no network
request.

**Reuse decisions (search-before-build).** No new dependency, route framework, store slice or
status API. The hub reads what the store already persists (`settings.apiKeys`,
`socialSync.status` + `statusAt`) and two pure local checks (`isLocalAiHost()`,
`nativeHelperId()`). It reuses `lucide-react` icons, the Training `px-*` classes used by
Settings/More, `useT`, `MESSAGE_FILES` dictionaries, `accountState()` from `lib/socialSync`,
`scoutConfig()` from `lib/scoutClient`, and `normalizeForMatch()` from `lib/replies` for
Arabic-insensitive search. Framer Quick Actions palette is NOT in this packet (next small
packet, same registry).

**Files.**
- New `lib/tools.ts` — typed first-party registry + pure readiness/search functions.
- New `lib/tools.test.ts`.
- New `components/tools/ToolsScreen.tsx` (+ `ToolsScreen.test.tsx`, jsdom like
  `components/shell/MoreScreen.test.ts`).
- New `app/tools/page.tsx` (metadata title `الأدوات · 3z Prod`, renders `ToolsScreen`).
- New `messages/tools.ar.json` + `messages/tools.en.json`; register in `lib/i18n.ts`
  (`MESSAGE_FILES.tools` + both spreads). Base `messages/ar.json`/`en.json` gain
  `nav.tools` and `morePage.tools`.
- `components/shell/MoreScreen.tsx`: Training list gains `/tools` row (testId `more-tools`,
  before Settings); Social More gains a `ListRow` to `/tools` (icon `Wrench`, chevron,
  testId `more-tools`) in the group with Automations/Replies/Discover. Update
  `MoreScreen.test.ts` expectations.
- `components/settings/SettingsScreen.tsx`: the Data card gets `id="data"` (anchor target
  only). No other Settings change.
- New `e2e/tools.spec.ts`.
- Nothing under `components/research`, `components/discover`, `lib/discover*`,
  `lib/trendingSounds*`, `lib/platformIcons.tsx`, `extensions/`, `workers/`, `scripts/` or
  `planning/collaboration/current-task.md` is touched.

**Registry shape (`lib/tools.ts`).**
```ts
export type ToolGroup = "learn" | "plan" | "publish" | "discover" | "ai" | "accounts" | "data" | "planned";
export type ToolReadiness =
  | "available"   // works on this device, nothing to configure (Skills, Notes, Calendar…)
  | "connected"   // status API reported connected, no error, status fresh (< 24 h)
  | "configured"  // credentials/ID saved, never a proof of connection
  | "attention"   // status says expired / error / disconnected after setup
  | "stale"       // last status older than 24 h (or connected flag with no statusAt)
  | "unknown"     // configured but no status fetched yet
  | "setup"       // nothing configured; "Set up" routes to existing controls
  | "planned";    // not built; placeholder route or none
export interface ToolDef {
  id: string;                 // "skills", "notes", "accounts.tt", "mcp", "website"…
  group: ToolGroup;
  icon: LucideIcon;
  href?: string;              // existing route or anchor only: "/skills", "/settings#accounts"
  setupHref?: string;         // where "Set up" goes (default: href)
  name: MessageKey; desc: MessageKey;   // "tools.<id>.name" / ".desc"
  state: (ctx: ToolContext) => ToolReadiness;
}
export interface ToolContext {
  apiKeys: ApiKeys;
  social: SocialSyncState;    // status + statusAt from the store, never fetched here
  localAiHost: boolean;       // isLocalAiHost()
  helperId: string | null;    // nativeHelperId()
  now: number;
}
export const TOOLS: readonly ToolDef[];
export function toolContext(state: StoreState, now?: number): ToolContext;
export function searchTools(query: string, tools = TOOLS): ToolDef[];  // matches name+desc in BOTH ar and en via MESSAGE_FILES.tools, normalizeForMatch on both sides; empty query → all
export function accountReadiness(status: SocialConnectionStatus | undefined, statusAt: string | null, configuredWorker: boolean, platform: SocialPlatform, now: number): ToolReadiness;
```
Rules: `accountReadiness` → worker not configured → `setup`; status map null → `unknown`;
`accountState()` = `not_configured`/`disconnected` → `setup`; `error` → `attention`;
`connected` with `statusAt` within 24 h → `connected`, otherwise `stale`. Scout Worker,
YouTube key and the Chrome helper: saved value → `configured`, else `setup` (never
`connected`). Local AI: `localAiHost` → `available`, else `setup` (href `/discover`, where
`AiConnectionControls` lives). MCP: row is informational — `configured` when the Worker is
configured, else `setup`; its description names exactly `search_videos`, `get_trends`,
`save_picks`, `get_picks` and the `/mcp` path; never prints the token. Planned rows:
Website/CMS (`/social/website`), Business kit (`/social/business`), Workflow builder and
Conversations inbox (no href) → `planned`.

**Tool list (one row each).** learn: Today `/`, Skills `/skills`, Map `/map`, Notes `/notes`,
Planner `/planner`, Review `/review`, Rewards `/rewards`. plan: Studio `/social`, Calendar
`/social/calendar`, Growth `/social/growth`, Ideas `/social/ideas`. publish: Auto-posting
`/social/automations` (state = best account readiness across platforms with `canPublish`,
else `setup`), Auto-replies `/social/replies` (Instagram account readiness). discover:
Discover `/discover`, Chrome helper (configured/setup, setupHref `/discover`). ai: Local AI
connection. accounts: Scout Worker `/settings#api-keys`, YouTube key `/settings#api-keys`,
one row per platform TikTok/Instagram/YouTube/Threads → `/settings#accounts`, MCP connector
(no href; setupHref `/settings#api-keys`). data: Backup export/import `/settings#data`.
planned: the four above.

**Screen (`ToolsScreen.tsx`).** Pixel Training look: `<header>` h1 `tools.title` + sub
`tools.sub`; search `<input type="search" className="px-input" aria-label=… data-testid="tools-search">`
(Escape clears); one `px-card` section per group with `h2`; rows are `<Link>` (or `<div>` when
no href) with icon, name, desc, a `px-chip` state label (`tools.state.<readiness>`,
`data-state` attribute for tests) and, for `setup`/`attention`/`stale`/`unknown`, a small
"Set up"/"Open settings" link to `setupHref`. `connected` chip uses the accent colours like
`settings.apiTestedOk`; every other state neutral; `attention` danger. Empty results:
`tools.empty` + a clear button. Planned rows show `tools.state.plannedNote`. No
`useSocialSync`, no `fetch`, no `localAiStatus()` call anywhere in the screen or registry;
state comes from `useStore` only. Honest footer line `tools.note` ("saved keys mean
configured, not connected; connection checks live in Settings").

**Copy.** Hijazi Arabic first, English second; keys `tools.*` only in the new pair
(`messages.test.ts` enforces parity/uniqueness). Keep descriptions ≤ 90 chars.

**Tests (behaviour, RED first).**
- `lib/tools.test.ts`: every `href`/`setupHref` is a route in `NAV_ITEMS`/`SOCIAL_NAV_ITEMS`
  or `/settings#accounts|api-keys|data` or `/tools`; `searchTools("ردود")` and
  `searchTools("replies")` both return the Auto-replies tool regardless of UI language;
  empty query returns all; `accountReadiness` matrix: worker unset → setup; status null →
  unknown; connected fresh → connected; connected with statusAt 25 h old → stale; connected
  without statusAt → stale; lastError → attention; token expired → attention; disconnected →
  setup; saved Scout token alone → configured (never connected); planned tools → planned;
  the registry holds message keys only (no literal URL with a token, no secret strings).
- `components/tools/ToolsScreen.test.tsx` (jsdom): renders all groups; an Arabic query hides
  non-matching rows and keeps the match; English query likewise; empty state shows and clear
  restores; planned row shows planned chip and no Open link; with a seeded store
  (`setSettings({apiKeys:{scoutUrl,scoutToken}})` + `setSocialSyncStatus` fixtures) chips
  read configured/connected/stale/attention correctly; `vi.spyOn(globalThis, "fetch")` is
  never called during mount and interaction.
- `MoreScreen.test.ts`: both lists include `more-tools` with href `/tools`.
- `e2e/tools.spec.ts` (phone + desktop projects): from `/more/` and `/social/more/` the
  Tools row opens `/tools/`; `page.on("request")` collects requests during load and search
  and asserts none hits `/api/local-ai/`, `workers.dev`, or any non-localhost origin; search
  "ردود" then "replies" each leave exactly the Auto-replies row visible; Website row has
  `data-state="planned"`; no horizontal overflow (`document.documentElement.scrollWidth <=
  clientWidth`) on both projects; Arabic and English both render the hub.

**Checks before freeze.** `pnpm vitest run lib/tools.test.ts components/tools
components/shell messages` (plus any suite touching edited files), `pnpm lint`,
`pnpm typecheck`, `pnpm exec prettier --check <changed files>`, `pnpm build` (updates the
served `out/` on :3000; `local:serve` serves from disk, do not restart it), then
`pnpm e2e e2e/tools.spec.ts e2e/world.spec.ts e2e/settings.spec.ts` against :3000.

**Rulings.** (1) Executor Opus 5.5 rather than Sonnet: new screen + registry + i18n + e2e
across both worlds is multi-file integration; one pass beats fix rounds. (2) No status fetch
on open, not even the local-AI health GET: acceptance 4 says read-only and Codex said
"must not sync or invoke a provider"; the cost is an `available/setup` label for local AI
instead of a live model list. (3) Quick Actions palette deferred to DT-2. (4) `/tools` is a
Training route (pixel look) so Social's More opens it like Discover/Settings; adding it to
the sidebars/tab bars is out of scope (nav tests and world.spec stay unchanged).

**Amendment A (Codex early review, 16 Oct 13:34 AST; forwarded to the executor, same owner).**
1. The cached `socialSync.status`/`statusAt` is not bound to the Worker URL/token
   (`setSettings` keeps it), so the hub must never show a green "Connected" from it, not even
   when fresh. Replace the `connected` and `stale` readiness values with ONE neutral value
   `lastKnown`: chip text "Last known connected · {ago}" (`timeAgo(statusAt, lang)`), no accent
   colour, plus a "Verify" link to `/settings#accounts`. Missing `statusAt` → `unknown`. No
   identity guard that would touch the frozen store, and never serialize or hash the token
   into visible data. Required test: valid Worker A with a connected status, then
   `setSettings` to a different valid Worker B → the row still reads `lastKnown` (never
   connected/green) and the timestamp is the old one.
2. Auto-replies readiness requires Instagram `canReply`: Worker unset → `setup`; status null →
   `unknown`; Instagram not connected → `setup`; connected but `canReply` falsy → `attention`
   (copy "needs reply permission", setupHref `/social/replies`); connected and `canReply` →
   `lastKnown`. Auto-posting reuses `canPublishTo(status, platform, mode)` from `lib/publish`
   (TikTok counts if either `inbox` upload or `direct` mode can publish): any platform true →
   `lastKnown`; some connected but none can publish → `attention` ("allow posting", setupHref
   `/social/automations`); otherwise `setup`/`unknown` as above.
3. Local AI: `isLocalAiHost()` only means the page runs on a local address. New readiness
   `hostOnly` with copy "Local setup possible on this device · sign-in not verified"; href
   `/discover` labelled "Discover → Search (AI controls)"; no `#ai` anchor (none exists).
4. Backup row copy must say the private backup includes the saved API keys.
5. E2E: `SocialSyncAgent` pulls only on Social routes when the Worker is configured; the
   tools spec starts from `freshState` (unconfigured), so any request to `workers.dev` or
   `/api/local-ai/` during `/tools/` load or search is a hub defect.
Readiness enum after the amendment: `available | hostOnly | lastKnown | configured |
attention | unknown | setup | planned`.

**Amendment B (Codex copy correction, 16 Oct 13:40 AST; same executor, no new source scope).**
1. `tools.sub` must not say "Opening this page connects to nothing": AppShell always mounts
   `usePublishWatcher` (`AppShell.tsx:91`, `usePublish.ts:387-404`), so already queued publish
   jobs may poll `/social/publish` on any route, this one included. Keep that baseline. Scope
   the claim to "This hub does not run connection checks or start tools" (Arabic equivalent).
   The acceptance meaning: the hub itself initiates no provider operation.
2. The Growth row must not imply personalized best-time analytics: `bestTime()` in
   `lib/social.ts:26` uses assumed Riyadh posting slots. Describe Growth as account
   analytics/snapshots with suggested posting slots, not "best time for you".

**Repair round 1 (Fable ruling on Codex review `dashboard-tools-review.md`, 16 Oct 13:55 AST; same executor, no new scope).**
Findings: (1) Auto-posting turns a connected account with `canPublish` but `statusAt: null` into `attention` "Allow posting"; (2) every `attention` row shows the permission label even for token expiry or `lastError`.
Ruling: split "permission missing" from "connection error" with a new readiness value `permission` (enum becomes `available | hostOnly | lastKnown | configured | permission | attention | unknown | setup | planned`). `attention` = error/expiry only, generic action "Check" → `/settings#accounts`. `permission` = demonstrated missing scope on a connected, error-free, timestamped status; action = the tool-specific label (`ToolDef.permission`, renamed from `attention`) → `setupHref`. Chip copy `tools.state.permission` AR/EN.
Auto-posting order: (a) any platform `lastKnown` and `canPublishTo(inbox||direct)` → `lastKnown`; (b) any connected platform with `statusAt` missing → `unknown` (never infer a permission failure); (c) any platform `lastKnown` without publish scope → `permission`; (d) any platform `attention` → `attention`; (e) else `setup`. Auto-replies: Instagram readiness; `lastKnown` without `canReply` → `permission`; `attention`/`unknown`/`setup` pass through unchanged.
Finding 3 (second reviewer, 13:54 AST): the Chrome helper and MCP rows have only `setupHref`, so once `configured` they render no action and are not interactive. Ruling: a `configured` row whose tool has no `href` renders a neutral "Manage" link (`tools.manage`, AR/EN) to its `setupHref`; rendered test for both rows in both languages.
Regression tests required (RED first): autopost IG connected+canPublish+statusAt null → unknown; autopost IG connected, no canPublish, fresh → permission; autopost TikTok canUpload only → lastKnown; replies canReply + lastError → attention; replies canReply + expired token → attention; replies fresh without canReply → permission; screen (jsdom, ar and en): attention row renders the generic Check label and never the permission label; permission row renders the specific label. Then rerun the DT-1 check list (focused vitest, lint, typecheck, prettier, build, e2e tools/world/settings) and record.

## Implementation record

(Executor appends: changed files, RED→GREEN evidence, check outputs, concerns.)

### DT-1 executor record (Claude Opus 5.5, 16 Oct 2026, plan + Amendments A and B)

**Files.** New: `lib/tools.ts`, `lib/tools.test.ts`, `components/tools/ToolsScreen.tsx`,
`components/tools/ToolsScreen.test.tsx`, `app/tools/page.tsx`, `messages/tools.ar.json`,
`messages/tools.en.json`, `e2e/tools.spec.ts`. Edited: `lib/i18n.ts` (import + `MESSAGE_FILES.tools`
+ both spreads), `messages/ar.json`/`en.json` (`nav.tools`, `morePage.tools` only),
`components/shell/MoreScreen.tsx` (Training row before Settings; Social `ListRow` with `Wrench` after
Discover; doc comment line), `components/shell/MoreScreen.test.ts` (new `more-tools` expectations, a new
Social test; no assertion removed), `components/settings/SettingsScreen.tsx` (`id="data"` on the Data
card, one-line diff). `MoreScreen.tsx`/`.test.ts` were CRLF in the working copy; now LF (git
normalises with `core.autocrlf=true`, so the diff is the content change only). Nothing else touched:
`git status --porcelain` before/after differs only by the files above; every pre-existing `git diff
--stat` line is byte-identical.

**What shipped.** Registry of 28 tools in 8 groups (learn 7, plan 4, publish 2, discover 2, ai 1,
accounts 7 incl. MCP, data 1, planned 4). Readiness enum exactly as amended: `available | hostOnly |
lastKnown | configured | attention | unknown | setup | planned`. `accountReadiness(status, statusAt,
configuredWorker, platform)` (the plan's `now` argument was dropped with `stale`, so `ToolContext` has no
`now` either): no Worker → setup; no status and no statusAt → unknown; `accountState`
not_configured/disconnected → setup; error (incl. expired token) → attention; connected → `lastKnown`
when statusAt exists, else unknown. Auto-posting uses `canPublishTo(status, p, "inbox") ||
canPublishTo(status, p, "direct")` (any → lastKnown; some connected but none can publish → attention,
"Allow posting", setupHref `/social/automations`). Auto-replies: Instagram lastKnown without `canReply` →
attention ("Needs reply permission", setupHref `/social/replies`). Local AI → `hostOnly` on a local
address, href `/discover`, desc "Discover → Search (AI controls)", no anchor. `lastKnown` chip = "Last
known connected · {ago}" (`timeAgo`), neutral `px-chip`, plus a "Verify" link to `/settings#accounts`;
`attention` chip uses the Settings danger colours; no state uses accent. Rows: `<Link>` (or `<div>`
without href) + chip + optional action link (separate element, so no nested anchors). Search: ar+en
name+desc via `normalizeForMatch`; Escape and the empty-state button clear it. Chip
`whitespace-normal` so the long hostOnly label wraps at 375 px.

**RED evidence.**
1. `pnpm vitest run lib/tools.test.ts` → `Error: Cannot find module './tools'` (suite failed, no tests).
2. After the first implementation: `1 failed | 90 passed` — "needs attention when the token expired"
   got `connected`: `accountState()` compares `tokenExpiresAt` with the wall clock, and my fixture used
   fixed-NOW minus 1 h, which is still in the real future. Test fixed to a clearly past date
   (`2020-01-01`); behaviour unchanged.
3. Amendment A, tests rewritten first: `9 failed | 17 passed` (lastKnown ×3, never-connected sweep,
   hostOnly, platform rows, Auto-posting, Auto-replies, backup copy).
4. `pnpm vitest run components/tools` → `Failed to resolve import "./ToolsScreen"`.
5. `pnpm vitest run components/shell` → `3 failed | 20 passed` (both list orders + new Tools test).
6. E2E first run: `2 failed | 8 passed` — the request filter caught the app shell's Google Fonts
   stylesheet/woff2 (`app/layout.tsx:10/58`, loaded by every route). Excluded only
   `fonts.googleapis.com`/`fonts.gstatic.com`; every other non-localhost origin, `workers.dev` and
   `/api/local-ai/` stay forbidden.

**Amendment A test evidence.** `ToolsScreen.test.tsx` "keeps a last known status after switching to
another Worker, with its old time": Worker A + connected IG status 3 h old → `lastKnown`; then
`setSettings({ apiKeys: WORKER_B })` → still `lastKnown`, chip text identical, token B never in
`innerHTML`. Also: a sweep with every platform connected+canPublish+canReply finds no tool in
`connected`/`stale`; no chip style contains `--accent`; tokens/URLs/YouTube key never rendered.
**Amendment B.** `tools.sub` now "This hub does not run connection checks or start tools." /
«هذي الصفحة ما تفحص الاتصالات ولا تشغّل أي أداة.»; `tools.note` makes no network claim. Growth: "Account
analytics and snapshots, with suggested posting slots." / «تحليلات حساباتك ولقطات أرقامها، مع أوقات نشر
مقترحة.» Locked by a unit test. The e2e asserts no forbidden request (not zero requests) from
`freshState` while on `/tools/`.

**GREEN / checks (exact lines).**
1. `pnpm vitest run lib/tools.test.ts components/tools components/shell messages` → `Test Files  6
   passed (6)` / `Tests  126 passed (126)` (tools 27, ToolsScreen 9).
2. `pnpm lint` → exit 0, no problems (two unused-var warnings in my test were fixed). `pnpm typecheck`
   → exit 0 (app + worker).
3. `pnpm exec prettier --check` on the 13 new/edited files above → `All matched files use Prettier code
   style!`. `components/settings/SettingsScreen.tsx` fails `--check`, pre-existing at HEAD (line 175
   export `<button>` on one line); left as is because the packet allows only `id="data"` there.
4. `pnpm build` → success, `└ ○ /tools` in the route list.
5. `pnpm e2e e2e/tools.spec.ts e2e/world.spec.ts e2e/settings.spec.ts` (reused :3000, phone + desktop) →
   `1 skipped` / `53 passed`. The skip is the existing desktop-only world.spec test on phone.
   Also looked at `/tools/` in the browser pane at 375 px: no horizontal overflow (scrollWidth 375 =
   clientWidth), long chips wrap.
6. Served export: `sha256sum out/tools/index.html` →
   `3007c3fbfa388e86a685516b28243c125aec11287aabcffc5dbdacd5fbedeb40`.

**File hashes (sha256, at record time).**
`lib/tools.ts` 8ca3f85e7651f0540c03b28b3afba37136dc87970a41ac46132f7247b5b6f608 ·
`lib/tools.test.ts` 807fa573877373c5fcd6a0921b16c1a83f60c54c9a6d60f7624a5dea14010b1f ·
`components/tools/ToolsScreen.tsx` 59535bbf4c89d49471da8fe65c31ad3110f5bf3f167cdb53705357daf3f9c274 ·
`components/tools/ToolsScreen.test.tsx` 5917c7d8b3f85d5b41ae7d91e285a5cd6a459890178e7632e4082e95a30f3f80 ·
`app/tools/page.tsx` 44f50d0dc0666737651466fae2c57f565c51cff65a3649b65b960aa443187533 ·
`messages/tools.ar.json` 34ed3a1f634fbe85b10a57312fc41357fb94b7c64b266d6089a670762df73774 ·
`messages/tools.en.json` c6654a066a5a7da84631e01f56eed74e155f17ea9fdd8327332a190b25a50067 ·
`e2e/tools.spec.ts` 282df99b833a270d031a278a0cc361013e5b3717d968b744284377bdbf248bbd ·
`lib/i18n.ts` 18a66125a621530e9cf21be1dff6e94555bdb23e3ed94a475cfaf63f31ee5e24 ·
`messages/ar.json` da56d11f0a44a53fc3c023a818bae3b5078c86aec9b43acd7830794f1b9594d6 ·
`messages/en.json` 99d1bf338fc0ea2ce7345e9cb2c8f631e2670a210989d03214a677172692e495 ·
`components/shell/MoreScreen.tsx` 6d1875d6ff87a9d43cfed7c192503f8c998dd69e1963c14222354f412490c751 ·
`components/shell/MoreScreen.test.ts` 0478e89745c5571300e435976050115a0f4688bbea590ae602979afc9a0df316 ·
`components/settings/SettingsScreen.tsx` 12acccc6a89d4462145e214a9f73c10848e91754ed99f156ee52ab00957de418.

**Concerns / deviations.**
- `accountReadiness` has no `now` parameter (plan signature) because Amendment A removed age-based
  states; recorded here instead of carrying an unused argument.
- `accountState()` reads `Date.now()` for token expiry, not an injected clock; the hub inherits that.
- Auto-replies `setupHref` is `/social/replies` for every non-ready state (per Amendment A), so "Set up"
  with no Worker also lands there; that screen links to Settings itself.
- Google Fonts requests are baseline app-shell traffic on every route; excluded from the hub filter.
- Several editor/format hooks touched my new files on disk mid-session (formatting only); final content
  was re-checked by Prettier, ESLint and the suites above.
- Not run: full `pnpm test` and full `pnpm e2e` (outside this packet's listed checks).

### Repair round 1 record (Claude Opus 5.5, findings 1–3)

**Files changed this round:** `lib/tools.ts`, `lib/tools.test.ts`, `components/tools/ToolsScreen.tsx`,
`components/tools/ToolsScreen.test.tsx`, `messages/tools.ar.json`, `messages/tools.en.json`. No other file;
`git status --porcelain` is identical to the end of round 0.

**Implemented as ruled.** Enum `available | hostOnly | lastKnown | configured | permission | attention |
unknown | setup | planned`. `ToolDef.attention` → `ToolDef.permission`; keys renamed
`tools.autopost.permission` («اسمح بالنشر» / "Allow posting") and `tools.replies.permission` («يبي إذن
الرد» / "Needs reply permission"); new `tools.state.permission` «ناقص صلاحية» / "Permission missing"
(warn chip `px-chip-t2`, not danger). `autopostReadiness`: no Worker → setup; status null → unknown; (a)
lastKnown + `canPublishTo` inbox||direct → lastKnown; (b) any connected platform with `statusAt` null →
unknown; (c) any lastKnown without scope → permission; (d) any attention → attention; (e) setup.
`repliesReadiness`: Instagram lastKnown without `canReply` → permission, else passthrough. Screen:
`attention` and `lastKnown` actions → `/settings#accounts` ("Check" / "Verify"); `permission` → the tool's
label → `setupHref`; `configured` with no `href` (helper, MCP) → new `tools.manage` «إدارة» / "Manage" →
`setupHref`.

**Old-behaviour assertions updated (why).** `lib/tools.test.ts` "rates Auto-posting…": IG connected
without scope and TikTok with both scopes false `attention` → `permission`; `.attention` key →
`.permission`. "rates Auto-replies…": IG without `canReply` `attention` → `permission`; key renamed.
`ToolsScreen.test.tsx` "reads saved keys…": Auto-posting `attention` → `permission` (IG connected without
publish scope, TikTok erroring: rule (c) precedes (d)); its label assertion «اسمح بالنشر» kept. All encoded
the pre-ruling conflation of missing scope with connection error.

**RED evidence.**
1. `lib/tools.test.ts` with new regressions + updated assertions: `5 failed | 30 passed` — autopost
   canPublish + statusAt null got `attention` (want unknown); fresh no-scope got `attention` (want
   permission); replies fresh no-canReply got `attention`; plus the two updated suites. (TikTok
   canUpload-only → lastKnown and replies canReply + lastError / expired token → attention already
   held; kept as regression guards.)
2. `ToolsScreen.test.tsx`: `4 failed | 8 passed` — expired-token Auto-replies rendered «يبي إذن الرد» /
   "Needs reply permission" instead of «افحصها» / "Check" (ar and en); Auto-posting `attention` not
   `permission`; replies permission state.
3. Finding 3, after 1–2 were GREEN: `2 failed | 12 passed` — "gives configured rows without a page a
   Manage link (ar/en)": helper and MCP rows had 0 links (expected exactly 1).

**GREEN / checks (exact lines).**
1. `pnpm vitest run lib/tools.test.ts components/tools components/shell messages` → `Test Files  6
   passed (6)` / `Tests  139 passed (139)` (tools 35, ToolsScreen 14).
2. `pnpm lint` → exit 0, no problems. `pnpm typecheck` → exit 0.
3. `pnpm exec prettier --check` on the 13 DT-1 files → `All matched files use Prettier code style!`
   (SettingsScreen unchanged this round; its HEAD formatting issue stands as recorded).
4. `pnpm build` → success, `└ ○ /tools`.
5. `pnpm e2e e2e/tools.spec.ts e2e/world.spec.ts e2e/settings.spec.ts` → `1 skipped` / `53 passed`
   (same desktop-only skip on phone).
6. `sha256sum out/tools/index.html` → `71b4b4e9bab0aed692a89bdb2fe565a87a4cbf81d885efe1f65963de3105c8dd`.

**New hashes.** `lib/tools.ts` 05f046d41c30b2baafa202844f1875b9bccdd7dedb4f38981bff3c37297614ff ·
`lib/tools.test.ts` 4f5c38bfad5632f1842c3286fc040ddbb958d60a8b67ad2f483dcda4d1100497 ·
`components/tools/ToolsScreen.tsx` 2049b34b39120d4859f1a31fa04f8ffe334b8dffe052d2bd4372726e0a42c4ea ·
`components/tools/ToolsScreen.test.tsx` 6d771c34cff238b5189f2eab57dbe64a0d8d4f088404e797be6b62e37c94d0fd ·
`messages/tools.ar.json` 949380f62c88f9d10956fd6f1860670be2c77400d50b3f3e8e3acf3d52ceac7f ·
`messages/tools.en.json` 701b54564a00f0f5a3c4012b02d9727837ff274d7585f99b8722ad0a72788acc. Other DT-1
files unchanged from the round 0 table.

**Concerns.** The `attention` action now always targets `/settings#accounts` (ruling), so Auto-replies'
`setupHref` `/social/replies` is used only for `setup` and `permission`. Mixed Auto-posting (one account
erroring, another error-free without scope) reads `permission` by rule order (c) before (d).

## Freeze (Fable 5.1, 16 Oct 2026 14:00 AST, after repair round 1)

Implementation owner: none.

Source edits for DT-1 stopped at 13:56 AST (repair round 1 report). Planner spot-checks,
read-only, 13:58 AST:
- File set: exactly the 8 new and 6 edited DT-1 files below; nothing else moved. Frozen
  Discover/music/icon files unchanged: `extensions/discover-import/native-search.js 1a3b8712…`,
  `lib/trendingSounds.ts 709926e3…`, `components/research/TrendingSounds.tsx 41dbf92d…`,
  `store/index.ts 1f812dc8…`, `lib/platformIcons.tsx 907b8b38…`.
- `lib/tools.ts` and `ToolsScreen.tsx`: no `fetch(`, `useSocialSync`, `localAiStatus` or accent
  styling (code lines; comments excluded). Enum `available | hostOnly | lastKnown | configured |
  permission | attention | unknown | setup | planned`. `autopostReadiness` order as ruled
  (lastKnown → unknown-without-statusAt → permission → attention → setup); `repliesReadiness`
  passes attention/unknown/setup through and maps lastKnown-without-`canReply` to `permission`.
  Screen: `attention`/`unknown` → generic `tools.check` → `/settings#accounts`; `permission` →
  `tool.permission` label, warn chip (`px-chip-t2`), not danger; `configured` without `href` →
  `tools.manage` → `setupHref` (finding 3).
- Copy: `tools.state.permission` "Permission missing" / «ناقص صلاحية»; `tools.manage` "Manage" /
  «إدارة»; `tools.check` "Check" / «افحصها»; 87 keys in each language. MCP row names exactly
  `search_videos`, `get_trends`, `save_picks`, `get_picks`; no token or URL with a token.
- Correction to the executor's round-1 record ("SettingsScreen unchanged this round"): the
  13:52 prettier pass reflowed the pre-existing one-line export `<button>` in
  `components/settings/SettingsScreen.tsx` (formatting only, no behaviour change). Its diff is
  now `id="data"` + that reflow (+8/−2), hash below. Planner ruling: accepted; the file is
  inside the DT-1 allowed list and is now prettier-clean.

Evidence (executor, "Repair round 1 record" above): RED first — registry 5, screen 4, Manage
test 2 (one per language); GREEN `pnpm vitest run lib/tools.test.ts components/tools
components/shell messages` 139 passed; `pnpm lint` exit 0; `pnpm typecheck` exit 0; prettier
`--check` clean on all 14 DT-1 files; `pnpm build` OK (lists `/tools`); `pnpm e2e
e2e/tools.spec.ts e2e/world.spec.ts e2e/settings.spec.ts` 53 passed, 1 skipped (pre-existing
desktop-only world test on the phone project). Changed assertions this round: four (two
Auto-posting and one Auto-replies registry cases, one seeded screen case) now expect
`permission` where they expected `attention`, because a missing scope is no longer a
connection error; two follow the `.attention` → `.permission` key rename. Not run: full
`pnpm test`, full `pnpm e2e`.

SHA256 of every DT-1 file (recomputed 13:58 AST):
```
05f046d41c30b2baafa202844f1875b9bccdd7dedb4f38981bff3c37297614ff  lib/tools.ts                          (new)
4f5c38bfad5632f1842c3286fc040ddbb958d60a8b67ad2f483dcda4d1100497  lib/tools.test.ts                     (new)
2049b34b39120d4859f1a31fa04f8ffe334b8dffe052d2bd4372726e0a42c4ea  components/tools/ToolsScreen.tsx      (new)
6d771c34cff238b5189f2eab57dbe64a0d8d4f088404e797be6b62e37c94d0fd  components/tools/ToolsScreen.test.tsx (new)
44f50d0dc0666737651466fae2c57f565c51cff65a3649b65b960aa443187533  app/tools/page.tsx                    (new)
949380f62c88f9d10956fd6f1860670be2c77400d50b3f3e8e3acf3d52ceac7f  messages/tools.ar.json                (new)
701b54564a00f0f5a3c4012b02d9727837ff274d7585f99b8722ad0a72788acc  messages/tools.en.json                (new)
282df99b833a270d031a278a0cc361013e5b3717d968b744284377bdbf248bbd  e2e/tools.spec.ts                     (new)
18a66125a621530e9cf21be1dff6e94555bdb23e3ed94a475cfaf63f31ee5e24  lib/i18n.ts
da56d11f0a44a53fc3c023a818bae3b5078c86aec9b43acd7830794f1b9594d6  messages/ar.json
99d1bf338fc0ea2ce7345e9cb2c8f631e2670a210989d03214a677172692e495  messages/en.json
6d1875d6ff87a9d43cfed7c192503f8c998dd69e1963c14222354f412490c751  components/shell/MoreScreen.tsx       (CRLF→LF, content diff +10/−1)
0478e89745c5571300e435976050115a0f4688bbea590ae602979afc9a0df316  components/shell/MoreScreen.test.ts   (CRLF→LF, +13)
942e352ec181f5f4ebc1a871c606589ddbe2bfe5042104f3779c0512556b02a8  components/settings/SettingsScreen.tsx (id="data" + prettier reflow of the export button)
```
Served export on localhost:3000 (served from this worktree's `out/`, server not restarted):
`/tools/` 200 → `71b4b4e9bab0aed692a89bdb2fe565a87a4cbf81d885efe1f65963de3105c8dd` (= `out/tools/index.html`).
Note for Codex: each rebuild regenerates the whole export; `out/discover/index.html` is now
`6ba9902348de4d2a27f0602ea28f298c30c3eaade1d7e0f1e9a4c4a2f399930c` with NO Discover source
change (the Discover files hashed above are identical to before DT-1).

Known limits / review pointers: when one account has an error and another is connected
without the posting scope, Auto-posting reads `permission` (rule c before d: a demonstrated
missing scope is the actionable item); `attention` always links to `/settings#accounts`, so
Auto-replies links to `/social/replies` only in `setup` and `permission`; `accountState()`
uses the real clock for token expiry; account states come from the store cache only, so a
status saved under earlier credentials still shows "Last known connected · {ago}" after a
Worker switch (by design, never green). Quick Actions palette (DT-2) not started; its
acceptance is at the end of `dashboard-tools-audit-2026-10-16.md`. No push, merge, deploy,
paid service, permission grant, live post or DM in this packet.
