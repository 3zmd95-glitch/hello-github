# CMS and workflow builder — Codex acceptance record

## Authorization — 16 October 2026

After Codex explained that the hub/palette were built but the CMS and workflow tools
were still missing, the owner explicitly said **Build them**. This authorizes
implementation of those two tools, superseding the older website deferral for this
dashboard scope. Claude still plans and implements; Codex independently reviews/tests.
Use the managed discover-inspiration worktree, one source writer, preserve existing
Discover/music and DT-1/DT-2 changes. No public deployment or provider messages/posts
are part of this local build. Existing localhost:3000 stays in use.

## Outcome and review criteria

Build working tools, not additional catalog entries. Claude owns the implementation
plan and may sequence CMS (DT-3) then workflows (DT-4), with an independent review
between them. The local static-export architecture determines what is available
before any later hosting/sync work; UI must describe those limits accurately.

CMS: create/edit/search articles with Arabic/English fields, slugs and skill linkage;
durable saved drafts after reload; clear save/error state; useful preview; validation
before readiness; export actual portable content; edit/archive/restore without data
loss. Reuse existing editorial primitives where appropriate. New data must survive
the explicit persistence picker, private backup/import, and old-backup migrations.
No false public-publishing claim or XP award just for opening, saving or exporting.
Treat rendering, link schemes and content import as untrusted. Keep Article quests'
existing completion behavior intact. Read the prior website plan for content fields.

Workflows: create/edit a trigger and ordered actions with actual local effects,
validation, preview/dry-run, Run now, enabled/paused state and persisted run history.
Useful actions should create real CMS/social drafts from owner-provided content and
link to outputs. Safe retry must not duplicate successful outputs; manual runs must
be distinguished from retry. Persist a run's input/definition so later edits do not
silently change retries. Test failures, partial completion, reload and event replay.
If scheduled/event triggers are supported locally, explain when they execute; do not
pretend the existing Worker cron can see browser-local drafts without a sync contract.
No live publish/reply or paid AI call is needed to make these local tools useful.

Both tools: fit the existing Social styling, AR/EN, phone/desktop, accessible controls,
correct navigation via More/Tools/Quick Actions. Update registry readiness only for
implemented behavior. Test end-to-end creation, reload, edit, preview, execution,
output navigation and recovery. Include focused regressions for store backup, existing
posting and shell behavior. Record changed-file hashes and final served export hashes.

## Baseline and handoff

The brief was submitted to the existing Claude Training Page session and visible as
a sent message at approximately 15:25 AST. Fable 5.1 is the observed planner; Opus is
the requested single implementation writer. DT-3 CMS comes first, DT-4 workflows
after independent acceptance. Preserve `/social/automations` (existing AutoPostScreen);
the general workflow builder needs its own destination.

Independent pre-change baseline: **30 files, 526 tests passed, exit 0**, 5.09 seconds,
15:25:39–15:25:44 AST. Store/persistence 163, core/client libraries including Notes
256, messages parity 67, social components/hooks 40. No build/server/provider action.
Logs and fingerprint manifest:
`C:/Users/AORUS/AppData/Local/Temp/dashboard-cms-workflows-2026-10-16/`
(`baseline-tests.log`, `baseline-hashes.txt`, `pre-dt3-hashes.json`).
All baseline fingerprints remained stable. Store/domain match the prior DT-2 freeze;
their existing Discover format fields predate this request. No other writer detected.

Additional acceptance cases: editing a ready article must require review again;
archive/restore must not create slug collisions; previews/exports cannot claim that
device-only note images are portable. Workflow dry-run must create no records, while
Run now must create editable outputs. Force a later step to fail after an earlier
success, reload, edit the workflow/input, then retry: the saved run remains based on
its original snapshots and reuses successful outputs. Pause behavior must be explicit.

## Current status

DT-3 CMS and DT-4 workflows: ready for user acceptance. Independent review and
runtime verification completed on the recorded local build, 16 October 2026 18:56 AST.
Implementation remains frozen; no deployment or live provider action.

## DT-3 early design findings

1. Ready content must return to draft after a material edit, even if the new content
   is still valid. Otherwise the new revision is treated as already reviewed and the
   next article-ready transition cannot drive DT-4 correctly. No-op saves should not
   bump revision or demote readiness.
2. Resolve/flush pending editor text before Archive, Mark ready, Download, Back or
   export. Merely dropping a timer after archive loses the last edit (type then
   Archive, Restore returns old content). Storage/conflict failure must preserve the
   text and block any operation claiming to export/ready the saved latest revision.
   Import/reset/another-tab replacement is different: cancel stale pending saves,
   never apply the old editor text to the replacement record.
3. Define Markdown export as source versus sanitized output. YAML metadata must be
   safely encoded for quotes, newlines, colons and `---`; do not mistake safe React
   preview for sanitization of exported Markdown. Unsupported device-only media must
   produce a clear validation/message rather than a silent broken portable export.
4. Numeric revisions can be reused by backups. An editor holding A/revision 3 must
   not overwrite a different imported A/revision 3 when its timer flushes. Fence
   replacement using a library generation/opaque commit identity; archive/restore
   also invalidates obsolete edits. Test import/reset while edits are pending.
5. `articlePersisted(id, revision)` alone is insufficient evidence of this save:
   a different tab/import may hold different content under the same ID/revision.
   Verify the intended payload or unique commit identity, preserving unsaved text
   when durability fails. Two simultaneous same-base CMS writes need a real shared
   conflict/serialization mechanism; a duplicate debounced storage listener is not
   a lock. Test delayed storage-event delivery between two tabs.

## Reuse evidence for review

Read-only source/research review recommends the installed `react-markdown` 10.1.0
and `remark-gfm` 4.0.1 for the bounded local CMS. TipTap is not installed; the earlier
block-editor aspiration remains a separate extension. Keep a content-format/version
for later migration. Both choices are MIT open source; no subscription is needed.

- Official safety guidance: https://github.com/remarkjs/react-markdown#security
  and https://github.com/remarkjs/remark-gfm#html . Preserve URL filtering and raw
  HTML escaping; custom renderers/plugins can bypass those protections.
- Portable export must use the same renderer as preview and escape metadata in any
  HTML document wrapper. Do not implement a separate Markdown renderer with regex.
  React client HTML guidance: https://react.dev/reference/react-dom/server/renderToStaticMarkup .
- TipTap's JSON/extension renderer: https://tiptap.dev/docs/editor/api/utilities/static-renderer .
  Its additional editor/schema work is the scope tradeoff, not a paid license.

If HTML export is included, open the download independently: UTF-8/RTL/LTR, headings,
lists/tables/code, safe URLs and no dashboard JS/CSS dependency. If both languages
share a file, check footnote anchors for collisions. External images remain external
dependencies; device-only blobs/IDs must not be presented as portable assets.

## DT-3 implemented-code review (writer active, 16 October 15:46 AST)

The first store implementation still has a P1 data-loss path. `updateArticle`
reads only the target's stored commit (store/index.ts:2104), then writes the entire
in-memory articles list (2121). Before a storage event arrives: (a) a reset/import
that removed A returns no stored target and bypasses the guard, resurrecting A;
(b) a remote edit to B with A unchanged is overwritten when this tab saves A.
The read/check/write sequence also is not atomic across tabs: both can read the
same commit before either writes. Apply a shared lock/transaction plus fresh
persisted-state reconciliation to all CMS mutation paths, not only update; refuse
missing/replaced targets, preserve remote sibling records, and guard status,
restore and creation as well. Missing/unavailable storage must not mean permission
to overwrite. Include delayed-event deletion, sibling-edit and overlapping-write
coverage. Keep source changes limited to CMS rather than silently changing Discover.

P2: restore currently allows duplicate active slugs: archive A with slug x, create
B with x, restore A. Refuse/resolve collision before restoring; retain archived
content and show a useful reason. This is a concrete acceptance gap, not new scope.

P2: `lib/articles.ts:36` regex misses valid Markdown device images with nested alt
brackets (`![a [b]](img:abc)`) or entity-encoded scheme (`![x](img&#58;abc)`), while
code-block examples falsely block readiness. Prefer actual Markdown image/reference
nodes and decoded destinations using the existing parser dependency; do not expand
an ad-hoc regex or treat literal documentation examples as live media.

## DT-4 integration checks prepared during CMS implementation

- Existing addPost/addIdea force random IDs. Workflow outputs need deterministic
  IDs and atomic output/receipt updates; do not blind-retry useIdea's two writes.
  Idea.source is an enum: workflow provenance needs an explicit valid schema path.
- Planner output must appear in the actual planner, preserving user rows and
  tombstones. Positive-minute by:rules rows are ignored by overlayPlan; assert
  visible output as well as storage. Never replace the whole week to add one item.
- Dry-run must change no records/storage/network. storageDurable writes a probe;
  keep it outside the pure preview path. Verify no publish/reply/local-AI request.
- Partial failure/reload/retry uses captured definition, article, language/date
  and stable output IDs, even after the owner changes the originals. Reconcile a
  crash between output and receipt without recreating a successful output.
- Article-ready trigger keys the successful draft-to-ready commit. Already-ready
  calls, hydration/import/reload, failed persistence and paused workflows emit no
  new run; explicitly reviewing a later edited revision may emit a new run.
- Quota failures and two tabs executing one event must produce honest recoverable
  state, never false success or duplicate drafts. Keep AutoPost route and existing
  jobs/reply rules/permissions unchanged.

## DT-3 transaction follow-up (source rework, before UI freeze)

P1: the new lock protects CMS siblings, but `freshArticles` reads only articles;
`useStore.setState({ articles })` still persists the entire stale store. Repro:
tab A has settings.lang=ar and no new idea; disk holds lang=en/new idea with the
same article commit. Save A. The article save succeeds but pickLocal overwrites
those remote fields. Reconcile/preserve the complete fresh persisted payload at
the write boundary, including remote import state; keep Discover's own merge rules.

P1: Zustand persist updates memory before localStorage.setItem. A main-key quota
error (even when the small probe succeeds) leaves the article's new commit in
memory while disk retains the previous commit. commitArticles returns not-persisted
but the normal next base from memory conflicts with disk; rehydrate loses that
failed edit. Commit durable state before treating memory as committed, or preserve
an explicit retry base and rollback committed state while retaining editor text.
Cover failure then retry after storage recovers. Relevant code: freshArticles
~774–782 and commitArticles ~814; installed zustand middleware.js ~368–370.

## DT-3 complete UI review, before freeze

Remaining concrete fixes to batch in the same implementation pass:

1. P1 full-quota/blocked-storage branch: storageDurable false still commits memory
   Y and returns not-persisted+article. Editor settle adopts Y and clears dirty;
   later rehydrate/adopt(X) loses text, and Back also proceeds. Fail without
   committing memory/base when storage is unavailable, retain dirty editor text.
   Memory-only creation is unnecessary. Test probe failure too, not only main-key
   setItem failure, then recovery/rehydrate/retry.
2. P1 delayed action save: hold Web Lock; type A, Archive/Ready, type B while save
   waits, release. The one flush saves A but leaves B dirty; act still changes
   status, and settle(result without sent) replaces B with A. Disable editing for
   the whole action or drain/recheck newer input without adopting stale content.
3. P1 route/hash departure: only the editor Back awaits flush. WebsiteScreen
   hashchange closes immediately; shell navigation unmounts and fire-and-forget
   flush cannot preserve text on conflict/quota. Guard/defer departures or retain
   a recoverable draft across internal navigation; add beforeunload protection for
   unresolved text. Verify sidebar/QuickActions and browser/hash Back on failure.
4. P2 rescue export: the warning says download a copy, but Download always flushes
   and returns when persistence fails. Offer an explicit current-unsaved-draft
   export/copy path that does not claim Saved and still preserves latest text.
5. P2 footnotes: native fragment links in ArticleMarkdown:60 replace #a=<id>.
   WebsiteScreen:61–68 treats that as no selected article and unmounts the editor.
   Keep the CMS selection hash, scroll within preview for footnote/return links.

Both independent reviewers confirmed the delayed-action race. Earlier full-payload
reconciliation and sibling-generation cases are addressed in the current source.
No product source was edited by Codex; final independent tests remain pending.

## DT-3 exploratory real-browser checks (first built CMS, ~16:04–16:07 AST)

Against localhost:3000 in Codex's isolated IAB test profile: created article
520fd9e9-6b32-4d51-9776-7a4b05b1bf51 with English/Arabic title, summary and Markdown;
previewed Arabic headings/list; marked ready; reloaded and confirmed both content
and Ready survived. Edited English body then immediately archived and restored;
the final sentence survived, restored status Draft. Downloaded actual English .md
and read it from disk: safe front matter, both expected body sections and final
sentence present. File: C:/Users/AORUS/Downloads/dashboard-cms-verification.en.md.

Also exercised actual Settings backup/import (not only schema tests): exported
3z-prod-progress-2026-10-16.json, verified articles/id/both-language titles/status;
changed test article title, imported the captured backup through confirmation UI,
reopened article and confirmed original title/body returned. No owner Chrome data
or live provider was used. Footnote bug reproduced in browser: clicking reference
1 changed #a=<id> to #user-content-fn-1 and closed editor, already sent for repair.
These are exploratory checks, not final acceptance of the still-changing source.

Responsive exploratory check: 1280x900 desktop preview and 390x844 phone preview
both fit. Arabic UI switched through More, Arabic article search/open/Mark ready
worked, document dir=rtl and scrollWidth=clientWidth=390. Screenshots saved in the
temporary CMS audit directory (`cms-exploratory-desktop.jpg`,
`cms-exploratory-phone.jpg`, `cms-exploratory-ar-phone.jpg`). These are first-build
screenshots; refresh the accepted final screenshot after recovery fixes.

## DT-3 Amendment E source follow-up for final review

Potential remaining navigation recovery gap to verify on the frozen build: both
useUnloadGuard callers live in WebsiteScreen/ArticleEditor. Sidebar/QuickActions
navigation unmounts both, removing all beforeunload listeners while unsavedDrafts
is still memory-only. A reload/close from Calendar then silently loses the stash.
The stash needs an app-lifetime guard while nonempty (or comparable recovery).
Also the cleanup stashes only after the async flush rejects; a delayed lock allows
leaving and reopening before that promise settles, and ArticleEditor's stash state
is initialized once, so a late stash is not offered until another remount. Stash
synchronously before leaving and clear it only after a confirmed matching save,
or otherwise ensure late drafts are observed/recovered. Final source/tests pending.

## DT-3 frozen independent review — changes required (16 October 2026)

Independent unit run: 19 files / 411 tests passed (16:23:56, 63.18s).
Independent adversarial browser run: 1 passed / 2 failed, exit 1, 20.5s.
The real two-tab Web Lock/delayed-storage-event test passed, including sibling
articles and unrelated settings preservation. Two lifecycle defects reproduced:

- P1: full-quota unsaved draft, sidebar Calendar navigation, then reload/close:
  no registered beforeunload handler cancels departure. CMS recovery works after
  reopening, but the guard is removed outside the CMS route, risking silent loss.
- P1: hold the real article Web Lock; edit A then newer B; sidebar Calendar then
  reopen CMS before lock release. Editor shows old persisted text and no recovery
  prompt. Cleanup stashes only after async flush, too late for immediate recovery.

Repair together: retain the latest draft synchronously before unmount; maintain an
app-lifetime unload guard while unresolved stashes exist; clear only a matching
confirmed save and protect newer stashes from stale pending promises. Keep the
one-writer protocol, then rebuild/refreeze for targeted independent rerun.
Evidence is in C:/Users/AORUS/AppData/Local/Temp/dashboard-cms-workflows-2026-10-16/
(cms-adversarial.spec.cjs, playwright.adversarial.config.cjs, adversarial results).
Product source unchanged by Codex. DT-4 remains next after CMS acceptance.

### Repair-round verification prepared

The initial adversarial guard assertion dispatches a cancelable beforeunload event
through the real registered handlers; it does not itself drive native browser close.
Quota recovery/retry passed after that soft guard assertion. Held-lock reopen failed
before release with no prompt, proving the asynchronous-stash gap independently.
A fourth case now covers reopen/restore B, edit C, leave again, then release an older
queued save: C must remain durable or recoverable. Temporary round2 spec/config are
cms-adversarial-round2.spec.cjs and playwright.adversarial-round2.config.cjs in the
same audit directory. Originals and first-run evidence are preserved. Syntax only
checked; run after repair freeze. Footnote click rechecked on the served CMS: the
article remains open at its #a=<id> selection hash.

### DT-4 commit boundary clarification

The successful article-ready transition and enqueue of its captured run belong in
one durable locked state commit, preventing a crash gap after Ready but before the
trigger callback. CMS and workflow writes share one root storage key: separate
articles/workflows lock names do not serialize them. Reuse/generalize the same
fresh-full-payload transaction. A successful unchanged Ready result emits nothing.
Include output links and verify the planner row visibly appears (positive-minute
by:rules rows are ignored by the existing overlay). Six DT-4 checks above remain
the acceptance criteria; preserve the existing AutoPost screen and provider settings.

## DT-3 acceptance — ready for user acceptance (16 October 2026, repair round 1)

Both P1 lifecycle findings are closed. Independent verification against the frozen
repair source/export: 37 CMS component tests passed; all 4 temporary adversarial
browser tests passed (full quota/navigation guard, real two-tab lock isolation,
immediate held-lock recovery, old completion versus newer remounted draft).
Independent repository E2E: 83 passed, 3 intentional desktop-only skips on phone,
zero failed/flaky. Earlier 411 unit pass remains valid for unchanged code.
Frozen offline install passed. All 34 current manifest hashes matched; the served
CMS HTML matches 4c6b26fd37e35fecc2603d3d74d2732671495605ec19e50a7f971b1b63b3e2d5.
Protected Discover/research/extension/Worker/script manifest subset: 44 files,
zero changes. Final direct UI Arabic preview fits desktop 1280 and phone 390 with
no horizontal overflow; screenshots cms-verified-desktop.jpg and
cms-verified-phone.jpg saved in the audit folder; viewport reset.

Limits remain explicit: local articles, no public publish, Web Locks required,
session-only unsaved recovery protected by unload warning. Discarding a recovery
prompt does not cancel a save already queued by the closed editor; its eventual
saved version can appear again (documented minor behavior, no text lost).
Claude's verification reran the original temp spec and overwrote its default
JSON/results; Codex's original log/evidence note preserve the prior failures.
Independent repair results use separate round2 paths and remain preserved.

Proceed immediately to DT-4 with one Claude writer, following the six integration
checks and shared commit-boundary clarification above. Codex remains reviewer.

## DT-4 early plan review (writer active)

Two details to preserve in implementation:
- Do not reintroduce article-generation bumps on ordinary sibling edits. The accepted
  DT-3 rule bumps generation on import/reset/replacement epoch, while individual
  article edits conflict by commitId. The DT-4 plan's phrase 'generation bump when
  fresh list differed' is stale; ordinary remote sibling edits must keep working.
- Each workflow run mutation needs durable proof of the exact new receipt/state,
  not merely an existing output ID. A retry/reconciliation step can find that ID
  before its receipt write; if the new payload fails, checking ID existence alone
  would falsely accept the receipt. Use a changing run commit identity or equivalent
  exact affected-state comparison, including queued/failed/retry updates.

### Reference behavior checked in Chrome for DT-4

Official Base44 workflow documentation confirms per-run history and failed-step detail,
plus distinct activation/pause and Run now actions:
https://docs.base44.com/Building-your-app/Creating-workflows
Official Manychat preview documentation distinguishes its in-app preview (no contact-data
or third-party effects) from messenger testing with real effects:
https://help.manychat.com/hc/en-us/articles/14281198254620-How-to-preview-automations-in-Manychat
These support the dashboard's explicit pure Preview versus local Run now behavior.
Both read-only pages were inspected in Chrome; no third-party workflow/account was changed.

Independent DT-4 browser cases are prepared outside the repo in the audit temp directory.
They have been syntax-checked but not executed against the unfinished workflow build.

### DT-4 early candidate findings (before freeze)

Read-only subagent review of workflows.ts 527484a0…87e6e0 and domain.ts
571ec072…88f10 found two P2 defects, confirmed against the candidate source:
- lib/workflows.ts:227-230 builds every preview action after an earlier failure.
  Article with empty optional summary; idea `{summary}` fails, later post `{title}`
  succeeds in Preview although execution must skip it. Model failed/skipped order.
- lib/domain.ts:1084 accepts duplicate action IDs; workflowIssues does not reject
  them. Two imported idea actions with id `a1` share deterministic output identity,
  so execution can silently reconcile the second to the first. Reject duplicate
  IDs in definitions and captured run snapshots; validate before execution.

These are candidate findings, not a frozen acceptance verdict. No product edits or
independent tests run against the changing implementation.

### DT-4 early engine findings (UI still under construction)

Read-only engine audit at store/index.ts abf4fe01…00765d:
- P2 candidate: runWorkflowNow validates an article-ready definition with
  workflowIssues(w), then captures empty manualInput. `{title}` passes the former
  and fails execution; `Post: {title}` creates incomplete text. The public action
  must reject this invocation/contextually validate it, or capture an explicitly
  selected article. Verify final UI Preview and Run now state the same input.
- P2 candidate: drainStep skips a persisted running run <60s old after reload
  because ownRuns is empty; drain returns success/zero with no wakeup. A mount-only
  drain strands its pending steps. Add a timed recovery/explicit resume or safely
  resume atomic steps under the shared lock. Verify immediate reload, quota failure
  after step one, and two-tab recovery without duplicate output.

Both need final UI/runtime verification after freeze. Candidate source review only;
no product edits, builds or tests by Codex during active implementation.

Delivery status: Amendment B (preview/duplicate IDs) was submitted once and Claude
confirmed forwarding it. The subsequent input/recovery findings above are recorded
but have NOT yet been sent through the Claude UI: window 2229860 is minimized and
activation was rejected after user input; fresh selection/state recovery remained
minimized. No further app input is being attempted without a changed window state.
The single writer remains active; no product ownership was taken by Codex.
Delivery update: user restored Claude and said "its open". The engine input/recovery
findings were submitted once to Training Page; the heading "You said: Codex DT-4
early engine findings" and cleared composer confirmed delivery. Pending planner
ruling/executor fix. Independent temporary browser suite now also includes immediate
reopen of a recent running run and clock advancement past its lease without navigation.

### DT-4 early editor finding

Source-level P1 at WorkflowEditor.tsx:207-225 (first candidate): unmount unsubscribes
and fire-and-forgets flush, while the only unload guard belongs to the mounted
editor. There is no synchronous/session draft stash. Full quota -> edit workflow
name/actions -> sidebar Calendar bypasses back() -> unmount removes guard -> failed
flush has nowhere visible to keep the draft. Immediate reopen initializes from old
stored state and loses the unsaved edits. The CMS's accepted recovery discipline
must also cover workflow drafts (sync tokenized stash, app-lifetime guard, prompt
on reopen, late matching-save cleanup) or provide an equivalent navigation-safe
solution. Include held-lock immediate reopen and newer-draft-versus-old-save cases.
This is source inspection; frozen browser reproduction remains to be run.

### DT-4 planner history integration finding

P2: WorkflowEditor outputHref always links planner outputs to /planner/, while
PlannerScreen.tsx:42-49 can render only weekKey(today) and has no week selector or
deep-link handling. Workflow buildOutput correctly keeps the captured run week.
After the Saturday boundary, Resume/Retry of a Friday run can report a successful
planner output in the old week that Open planner can never display; completed
history links also stop locating their outputs after rollover. Keep captured dates
and provide a bounded way for the output link to open its stored week (with a clear
return to current week), or an equally usable way to view/edit that exact output.
Verify a prior-week run's planner link, current-week default, owner rows/tombstones,
and no XP changes. This is source-level integration review before freeze.

### DT-4 final candidate engine review and first UI walkthrough

Read-only second reviewer found no new consequential defects in the repaired engine.
Explicit article capture, immediate queued/running resume, original-snapshot retry,
atomic output/receipt writes, exact commit-ID readback and rollback are present.
CMS and workflows retain the shared lock and import/reset/replacement generation
rule. Stable hashes: store/index.ts e6972d51…826a; lib/workflows.ts 8b290048…8011;
lib/domain.ts cfd12398…8213; store/index.test.ts f3056f21…a58b;
lib/workflows.test.ts 3cbdb4d9…b8bb. Runtime acceptance still pending freeze.

In the isolated IAB profile, created bilingual workflow "Weekly content preparation"
(27e85f1a-ec5d-4860-9da5-d2350f6ad0e4), previewed and ran three steps. History showed
all done. Open idea showed its workflow-tagged entry; Open post opened the actual
Instagram draft, whose edited caption survived reload; Open planner showed the
manual 30-minute task in the captured week. No publishing or quest completion.

Small display defect found in that walkthrough: WorkflowEditor.tsx:672 renders
label("workflows.actionsLabel") without count, displaying literal {count}; its
aria-label correctly interpolates. Sent once to Training Page before freeze;
"You said: Codex browser pre-freeze check" and empty composer confirmed delivery.

## DT-4 independent acceptance — 16 October 2026 18:56 AST

**Verdict: ready for user acceptance.** DT-3 remains accepted. Implementation owner
is none in the 18:53 freeze. HEAD remains `0e1fdb089146f4fd8e5f1d3c7cd58cf5b6fc6127`,
branch `codex/discover-inspiration`; changes remain uncommitted in the managed worktree.

All 40 recorded DT-4 source/test/doc/export fingerprints matched before the checks
and remained identical afterwards (`dt4-review-start-hashes.json`). The source was
stable while the formal planner release was being recorded. Fifty-two protected
baseline files also matched: Discover/research/extensions/Worker/scripts, AutoPost,
accepted CMS editor/renderer/helpers, shell, tools UI and package dependencies.
Root read the final `lib/workflows.ts` (`425d0bc9…1138`) after the earlier reviewer
hash changed; preview failure order, duplicate-id handling, snapshot builders and
planner week behavior show no remaining consequential issue. Also reviewed the
bounded planner deep-link change and IdeaRow's required workflow icon mapping.

Independent results against the existing localhost:3000 server (no rebuild/restart):
- `pnpm vitest run lib/workflows.test.ts lib/articles.test.ts store components/social/workflows components/social/website components/planner components/shell components/tools messages lib/tools.test.ts`
  — **23 files, 492 passed**, exit 0, 15.09 s.
- Repository browser regression, external `playwright.dt4-regression.config.cjs`
  (workflows, CMS, AutoPost, planner, ideas, calendar, settings, worlds, tools and
  Quick Actions) — **149 passed, 5 skipped, 0 failed/flaky**, 93.98 s. Skips are
  desktop-only scenarios on the phone project (one world, two CMS, two workflows).
- Independent workflow suite — **10 distinct scenarios passed**. Initial run had
  9 passed plus one test-selector failure: exact text `Original workflow idea`
  actually renders inside `Idea in the ideas bank: Original workflow idea`.
  Corrected only that temporary selector; the isolated rerun passed with unchanged
  assertions that Preview performs zero set/remove calls and leaves storage equal.
  Initial failure artifacts remain saved; no product change was needed.
- CMS recovery after the shared transaction change — **4 distinct scenarios passed**
  (7 executions because the older suite repeats three of the round-2 cases).

The independent workflow cases cover: pure Preview; quota after the first output
then same-attempt Resume with original input/definition and owner-edited first output
preserved; two real tabs with delayed storage events; atomic Ready/enqueue and pause;
immediate interrupted-run resume; original-snapshot Retry; full-quota draft recovery;
held-lock immediate reopen and newer stash versus an old completion; explicit article
selection for Run now; prior-week planner output visibility/removal without XP.
CMS cases cover full-quota sidebar departure, two-tab conflicts preserving siblings
and settings, immediate reopen with a held lock, and late old-save/newer-draft fencing.
Fault injection and state fixtures were restricted to isolated temporary contexts;
provider/AI traffic was blocked there. The repository workflow tests additionally
assert no provider or AI request. Existing provider regressions use their test mocks.

Hands-on IAB verification: bilingual three-step workflow, Preview, Run now, all output
links, real post edit surviving reload, visible owner-added planner row, and persisted
history. The literal `{count}` defect is fixed in the served build. Arabic desktop
(1280 px) and phone (390 px) have no horizontal overflow. Saved proof:
`workflows-verified-desktop.jpg` and `workflows-verified-phone.jpg`; viewport override
reset and workflow tab marked deliverable. CMS screenshots/evidence remain available.

Six served HTML pages match both disk and the frozen manifest (`dt4-served-hashes.json`):
workflows `2120ac30…e1f4`, CMS `4585fe96…7531`, home `3d44b725…9c2f`, social
`3b539a06…81b5`, tools `551322d3…dbb9`, planner `51985856…106e`.
Evidence directory: `C:/Users/AORUS/AppData/Local/Temp/dashboard-cms-workflows-2026-10-16/`.

Accepted limits: local browser data and execution only; queued/running work resumes
on Workflows/Website opening; no cloud schedule or live publishing/DMs. Workflows
pause but have no delete action. Unsaved recovery is session-only with an unload
guard. Article-based Run now accepts an explicitly selected non-archived article;
the picker prefers a ready article, falling back to a draft if needed (the runtime
test explicitly selected a different draft and verified its captured input).
No public deployment, push, merge, paid service or provider permission was performed.

Final coordination: acceptance is saved here. Delivery to Training Page was attempted
through the supported UI, but window activation failed; a fresh inventory/selection
and one recovery attempt failed again. No Send action was taken, so the final
acceptance message is **not delivered** in Claude chat. Implementation was already
frozen with owner none; no repair or additional source work is awaiting that message.
