# Dashboard tools comparison and acceptance record — 16 October 2026

## Completed local improvements

Claude implemented; Codex independently reviewed and tested. **DT-1 and DT-2 are
ready for user acceptance**, locally at `http://localhost:3000/tools/`, with the
source frozen and all existing Discover work preserved.

- **DT-1:** searchable Tools & Integrations hub, 28 entries, accurate configuration /
  last-known / permission / setup / planned states, and links to existing controls.
  Final review: `dashboard-tools-review.md`.
- **DT-2:** Framer-inspired Quick Actions in both headers, Ctrl/Cmd+K, AR/EN search,
  keyboard selection, touch dismissal and modal/editor safeguards. Planned entries
  are excluded from the palette. Final review: `dashboard-quick-actions-review.md`.
- Latest independent verification on the combined build: **165 unit tests, 32 new-tool
  browser cases and 15 shared-shell regressions passed**; one intentional viewport
  skip, zero failures or flakes. Direct browser checks covered both languages,
  desktop/phone sizes and the repaired dialog collision. All final file hashes match.

These changes expose and improve access to existing engines. They do not implement
the planned CMS, workflow builder, business kit or conversations inbox, and do not
prove live provider delivery. No deployment, paid subscription or permission grant.
The comparison below retains the pre-implementation findings and future candidates.

## Authorization and scope

The owner asked Codex to keep working on useful tools from Framer, Base44, Boot.dev,
Codédex, Metricool and Beacons, and test them against this dashboard. The owner then
explicitly chose: **Keep Claude implementing; Codex reviews and tests.**

Use the managed `discover-inspiration/hello-github` worktree. Preserve all existing
Discover/music and platform-icon changes. This is a separate dashboard-tools work
stream, not an approval of the pending Discover packet 30. One implementation writer.
Research compares official documentation and observed source/UI; it does not authorize
new subscriptions, account permissions, real messages/posts, or deployment.

## Evidence baseline

- HEAD: `0e1fdb089146f4fd8e5f1d3c7cd58cf5b6fc6127`; existing dirty work retained.
- Server: existing localhost:3000, managed static export. No server restarted or rebuilt
  by this audit. The served export differs from the older freeze record; do not reuse
  that record's fingerprint as current proof.
- Export SHA256 observed before browser tests:
  - `out/index.html`: `0b00bf88729361addd771d802c61052a6727b6f805b01672441b9568e547d40a`
  - `out/social/automations/index.html`: `67c1be4b3a86e1f262e1f0fd6aca295fd4011f898b97560670af94ca8d416874`
  - `out/discover/index.html`: `27e6770f972e3393b33ae4477a3cf23a5690bb5c1b1bfaae725e04942c7bc07e`
- Independent focused unit tests: **36 files, 790 passed, exit 0**. Covers learning (68),
  social/client analytics (185), Worker/social/creator/MCP (320), UI/hooks (41),
  AR/EN dictionaries (64), and store (112). Synthetic/mock provider data.
  Log: `C:/Users/AORUS/AppData/Local/Temp/dashboard-audit-2026-10-16/inventory-tests/focused-vitest.log`.
- Existing phone/desktop browser regression run: **145 passed, 3 skipped, 0 failed,
  0 flaky, exit 0**, 155.9 seconds. Completed before DT-1 implementation started.
  Suites: today-flow, planner, notes, calendar, accounts, autopost, autoreplies,
  growth, world. Isolated Playwright contexts; simulated provider endpoints.
  Log/report: `C:/Users/AORUS/AppData/Local/Temp/dashboard-audit-2026-10-16-root/e2e.log`
  and `e2e-results.json`. A first command failed before running tests because
  PowerShell split the reporter argument; quoted argument corrected on retry.
  The three skips are deliberate viewport cases: two desktop-only sidebar checks on
  phone, and one phone-only notes layout check on desktop.
- Direct in-app-browser observation: AR/EN switching works; Studio/More navigate;
  Website shows a "soon" placeholder; Studio's "Inbox" contains attention reminders.
  This browser session has no configured account connections. No live delivery proved.

## Comparison: adopt useful behavior, reuse existing engines

| Reference and capability | Actual dashboard state | Acceptance / next useful work |
| --- | --- | --- |
| Framer Quick Actions | Missing; routes already in `components/shell/nav.ts` | Search tools in Arabic/English, keyboard navigation, accessible focus/Escape; open exact existing destinations. |
| Base44 connections catalog | Existing settings/account and AI controls are spread out | One searchable overview; distinguish local availability, setup needed, verified connection, unknown/error, and planned capabilities. Never infer connection from a saved token alone. |
| Framer plugins/code tools | First-party React components exist; no plugin runtime | Use a typed first-party registry. Framer plugins cannot simply run in this Next.js app. Avoid an arbitrary-code marketplace. |
| Base44 workflows | `/social/automations` is **AutoPostScreen**, not a general builder | Reuse existing posting/reply/cron engines. Later templates need trigger/action preview, idempotency, last run, explicit pause and safe retry. |
| Base44 schedules/activity | Real fixed Worker cron jobs and separate publish/reply logs | Later read-only job overview with last/next run, Riyadh time, failures, provenance. UI alone cannot create durable execution. |
| Base44 agent controls | Existing AI connection, model and daily-cap code | Surface setup/model/budget state; generated work remains a draft. No silent provider substitution or paid probes. |
| Base44 MCP | Four real Discover tools, OAuth and redacted logs | Accurately list `search_videos`, `get_trends`, `save_picks`, `get_picks`. Planned map/skill/article write tools are not implemented. |
| Base44 export/restore | Functional private JSON backup intentionally includes API keys | Separate shareable data export from private backup; synthetic credentials must never appear in shareable export. Preserve private roundtrip. Preview replacement before restore. |
| Framer CMS | `/social/website` renders SoonScreen | Future bilingual draft, durable save, preview, slug validation, publish proof and exactly-once quest completion. Do not label this ready. |
| Framer localization | Real AR/EN UI, RTL/LTR, 64 dictionary tests | Reuse existing translation structure; test tools at both directions and phone/desktop widths. Article translation workflow is separate and absent. |
| Framer conversions | Social analytics exist; website events/funnels do not | Add website conversion tracking only with the website. Never present social metrics as site analytics. |
| Boot.dev daily loop | XP, streaks, focus, ranks and weekly plan exist | Quest/reload awards once; Riyadh day boundary/freeze correct; weekly budget remains <=300 minutes. |
| Codédex project learning | Skill-linked posts can complete Produce | Script/shot list/proof -> posted -> Produce exactly once. Existing calendar test covers this. |
| Boot.dev reference search | Notes, search, backlinks and Markdown export exist | Reuse Notes; Arabic/English search, autosave, correct skill links, export fidelity. |
| Metricool calendar | Week/month/stages, platform filters implemented | Draft to posted persists; browser Back closes sheet; stage shortcuts cannot silently publish. |
| Metricool posting queue | Real queue UI/client/Worker code; tests use mocks | Partial failure preserves successes; TikTok inbox upload remains needs-finish until real post link; cancel/retry avoids duplicate delivery. |
| Metricool best times | Static assumptions in `lib/social.ts`, not personalized data | Describe as suggested slots. Personalized best time needs real account samples, period and timezone. |
| Metricool/Beacons analytics | Imports, snapshots, provenance and weekly summaries implemented | Exact fixture deltas; stale data dated; unknown distinct from zero; CSV reimport deduplicates. |
| Metricool conversations inbox | Missing; Studio Inbox is a task/reminder list | A future read-only account/comment inbox needs source, time, pagination and errors before reply sending. |
| Beacons Smart Reply | Instagram rule/editor/preview/log and Worker implementation exist | Arabic keyword normalization, paused rules, replay dedupe, first-poll history protection, failure visibility. Live delivery remains unverified. |
| Beacons link hub/media kit/leads | Website/Business placeholders | Build after the core: dated real metrics, no private learning data, AR/EN preview, valid destinations, deduplicated inquiries. |
| Beacons email capture | Planned | Consent-aware test recipient flow and unsubscribe required before any real campaign. |

## First bounded implementation candidate for Claude

**Outcome:** make existing tools easy to find and their readiness understandable.
Start with a Tools & Integrations page and searchable first-party catalog, accessible
from both dashboard worlds. Framer Quick Actions can use the same registry if it fits
this packet; otherwise make keyboard palette the immediate next small packet.

Acceptance criteria:
1. Useful existing destinations cover learning/notes, planning/analytics, posting,
   replies, discovery, AI connections, account settings, backup and MCP information.
   Website/CMS, business kit, general workflow builder and conversation inbox must be
   explicitly planned, without pretending their placeholder screens implement them.
2. Arabic and English labels/descriptions/search, empty results and useful setup/open
   actions. Search should find a tool by either language. Phone layout and keyboard
   use remain accessible; current Training/Social styling is preserved.
3. State comes from existing configuration/status APIs. Local tools may say available
   on this device. Saved credentials mean configured, not connected. Unknown/loading,
   stale and failed connection states must not become green success. No credentials,
   tokens or raw diagnostic payloads appear in the catalog, exports, query or logs.
4. The hub initiates no sync, AI invocation, publishing, DM, OAuth grant,
   or new external connection. Existing background publishing jobs may continue under
   AppShell; do not claim that the entire page is offline. Setup buttons route to existing controls.
5. Reuse the route/nav, translation, account and UI primitives already present.
   No new vendor SDK, subscription, service or parallel data model just for this page.
6. Tests must cover behavior: Arabic/English discovery, correct destinations, planned
   state, absent/stale/failed/connected fixtures, and no side effects on open. Verify
   both widths and both worlds in a real browser after build.

Claude records its own concise plan, single executor, changed-file hashes and actual
checks in a new companion handoff document. Do not rewrite packet 30's frozen work.
Codex independently reviews and tests the delivered files. Push/merge/deploy is outside
this local packet. Later candidates: shareable export/restore preview, job activity,
then larger CMS/media-kit features in separate reviewed packets.

### Independent review cases for DT-1

- `scoutConfig()` validates configuration shape only. `setSettings` currently leaves
  cached social status intact, and that cache is not bound to a Worker URL/token.
  Changing valid credentials must not carry forward an old "connected" claim.
- `SocialSyncAgent` in AppShell automatically pulls status/data on Social route changes.
  Account for this when testing the requirement that merely opening the new hub has
  no additional provider work. Do not mount action-oriented connection controls only
  to display a status label.
- `AiConnectionControls` can fetch status and change selected models on mount.
  Discover's initial Browse page does not contain an `#ai` setup anchor; do not invent
  a deep link that cannot expose the controls. Label a general navigation accurately.
- Existing Codex/Claude connectors are not proof the dashboard itself has credentials.
- A private backup includes secrets by design. The catalog must describe it accurately
  and must not put any credential value in labels, search indexes, URLs or diagnostics.
- Handoff delivered once to Claude Training Page and response starting verified on
  16 October at approximately 13:24 AST. Selected planner shown: Fable 5.1 High.
  Screenshot: `C:/Users/AORUS/AppData/Local/Temp/dashboard-audit-2026-10-16-root/claude-handoff.png`.

## Official research sources

- Framer [Quick Actions/shortcuts](https://www.framer.com/shortcuts),
  [CMS](https://www.framer.com/developers/cms),
  [plugins](https://www.framer.com/developers/plugins-introduction),
  [code components](https://www.framer.com/developers/components-introduction),
  [localization](https://www.framer.com/developers/plugins-localization),
  [link/form tracking](https://www.framer.com/help/articles/how-to-track-links-and-forms-in-framer/).
- Base44 [integrations](https://docs.base44.com/Integrations/Using-integrations),
  [workflows](https://docs.base44.com/Building-your-app/Creating-workflows),
  [agents](https://docs.base44.com/Building-your-app/AI-agents-for-apps),
  [App MCP](https://docs.base44.com/Integrations/app-mcp),
  [logs](https://docs.base44.com/Building-your-app/exploring-app-logs),
  [backup/restore](https://docs.base44.com/Enterprise/backup-and-restore).
  Current workflow docs distinguish the newer workflow product from legacy automations.
- Boot.dev [dashboard and spellbook](https://www.boot.dev/blog/news/bootdev-beat-2025-05).
- Codédex [project-based learning](https://www.codedex.io/blog/12-cool-coding-project-ideas-for-beginners).
- Metricool [calendar](https://help.metricool.com/how-to-manage-your-calendar-in-metricool-xhlbw),
  [best times](https://help.metricool.com/best-time-to-post-on-social-media-in-metricool-w7ll9),
  [inbox](https://help.metricool.com/inbox-manager-how-to-manage-messages-and-comments-from-metricool-s9zze),
  [SmartLink analytics](https://help.metricool.com/how-to-analyze-the-performance-of-your-smartlinks-in-metricool-0cu3k).
- Beacons [Smart Reply troubleshooting](https://help.beacons.ai/en/articles/5867841),
  [media kit](https://help.beacons.ai/en/articles/4704129),
  [product FAQ/email capture](https://help.beacons.ai/en/articles/4695553).

Official references were checked on 16 October 2026. A historical article supports its
specific pattern, not a claim about current subscription availability. Adoption priority
above is our judgment for this private creator dashboard and <5 hours/week time budget.

## DT-2 independent acceptance outline: Quick Actions

Proceed only after DT-1 review is complete and ownership is transferred explicitly.
Claude plans and implements; Codex reviews/tests. A small navigation dialog should reuse
the DT-1 registry and bilingual search. It does not execute tools or display connection
status. Keep the same localhost server and existing source ownership boundaries.

- One launcher in each world's top bar plus Ctrl/Cmd+K. Local component state only;
  no new dependency or persistence. Reuse existing translated names/descriptions and
  `href ?? setupHref` for non-planned entries. Keep planned entries in the full Tools hub.
- Do not read `toolContext`, saved keys or cached account status for this navigation UI.
  Use ordinary Next links, preserve anchors/basePath, and close on selection even when
  the destination is the current route or differs only by hash.
- Ignore shortcut repeats, composition, prevented events, extra Alt/Shift modifiers,
  and editable controls/contenteditable/textbox editors. Refuse opening while another
  modal or alertdialog is active. Existing SkillSheet/SkillPicker/PlayerSheet Escape
  handling must remain unchanged.
- Search works in Arabic or English regardless of interface language. Arrow keys move
  selection, Enter opens the selected result, filtering clamps/resets selection, and
  empty results cannot activate a stale entry. Escape closes.
- Input receives focus on opening; Tab/Shift+Tab stay inside. Dismissal restores the
  connected opener. Route selection does not restore an obsolete page element. Do not
  reuse Sheet's history-pushing behavior: opening/closing adds no history entries.
- Training to Calendar enters Social; Social to Notes/Settings enters Training.
  Remembered Social route and WorldSwitch continue working. Opening preserves the
  current theme/direction. Both top bars remain usable at phone width; long labels wrap.
- Test keyboard/mouse/touch entry, bilingual searches, empty results, dismissal/focus,
  same-path/hash navigation, existing modal exclusion, both worlds and both widths.
  No new provider requests or writes on open/search; distinguish existing shell agents
  from the new component when measuring traffic.

Suggested boundary: one component and tests, AppShell launcher integration, tools
dictionary additions, one focused E2E suite. Do not broaden shared modal infrastructure,
Discover source, Worker, store, publishing or account code. Final review requires a
fresh freeze with changed-file hashes and actual unit/build/browser evidence.
