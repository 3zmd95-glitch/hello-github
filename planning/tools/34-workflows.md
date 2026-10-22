# 34 — Workflow builder (`/social/workflows`, packet DT-4)

Owner ask: "Build them" (16 Oct 2026). Plan: `planning/collaboration/dashboard-cms-workflows-handoff.md` → "DT-4 plan"
plus Amendments A–E. Codex acceptance criteria: `dashboard-cms-workflows-review.md` → "DT-4 integration checks" and
"DT-4 commit boundary clarification".

## What it does

A workflow is a trigger (`manual`, or `article-ready` = an article's successful draft → ready commit in the CMS) and
1–5 ordered steps. Each step creates one real local draft from the owner's content:

| Step | Creates | Where it shows |
| --- | --- | --- |
| Idea | ideas-bank entry, `source: "workflow"` | `/social/ideas/` (new "Workflow" filter chip) |
| Post | calendar post, stage `idea`, planned `offsetDays` after the run day, suggested hashtags | `/social/calendar/#post=<id>` |
| Plan item | planner row `by: "me"`, minutes > 0, fixed day or the lightest day of the overlaid week | `/planner/#week=<week>` (the run's own week) |

Templates are bilingual with `{title} {summary} {slug} {date}`. Preview (dry run), Run now, pause/resume, run history with
per-step receipts and output links, Retry (partial/failed, new attempt from the original snapshot) and Resume (a run a
storage failure stopped, same attempt).

## Honest limits (shown in the UI)

- Runs execute only while the app is open in this browser on this device. Queued or interrupted runs continue when
  Workflows or Website is opened, when the Workflows tab becomes visible again, and after every own run commit.
- Nothing is scheduled in the cloud. Nothing is posted, no one is replied to, no provider or AI is called, no XP, gems
  or quests are touched.
- Workflows can be paused but not deleted (not in the plan; pause covers "stop it").

## Data model (`lib/domain.ts`, additive)

`WorkflowSchema` (name AR/EN, trigger, actions ≤ 5 with unique ids, enabled, revision, `commitId`), `WorkflowRunSchema`
(kind, status queued/running/done/partial/failed, attempt, `commitId`, snapshot = workflow + input, steps with
status/output kind/output id/error). Store slices `workflows`, `workflowRuns` (`.default([])`, in `initialData`,
`pick()`); old backups import; runs capped at 200 (oldest finished pruned inside the commit). `IDEA_SOURCES` gains
`"workflow"`.

## Commit boundary (the core design)

- **One lock, one key.** `commitArticles` was generalized into `commitFresh(mutate)` under the same Web Lock name
  `3z-prod-articles` (kept for compatibility: one storage key, so CMS and workflow writes must serialize on one lock).
  Same gates (`storageDurable()` + `storedPayloadValid()`), `persist.rehydrate()` inside the lock, one patch write,
  authoritative read-back, rollback of every patched slice on failure. `commitArticles` is a thin wrapper; the CMS's
  behaviour and tests are unchanged (proof: removing the DT-4 hunks reproduces the pre-DT-4 file hash).
- **Read-back proves the exact new state.** Every workflow mutation gets a fresh `commitId`; every run mutation (queue,
  each step, retry) gets a fresh run `commitId`. The read-back compares that id in storage. An existing output id is
  never the proof (Amendment A).
- **Ready trigger in the same commit.** `setArticleStatus` appends one queued run per enabled, issue-free
  `article-ready` workflow inside the same patch as the draft → ready transition; a failed read-back rolls both back.
  Unchanged Ready, import, hydration, reload, failed persistence and paused workflows enqueue nothing. A later edit
  (which demotes to draft) and a new Ready is a new event.
- **Executor.** `drainWorkflowRuns` takes the first queued or running run and executes its first pending step, one
  `commitFresh` per step: output and receipt in one patch, output id `wf:<runId>:<actionId>`. An output already present
  under that id is adopted (crash between output and receipt, retries, two tabs). No age guard: steps are atomic and
  idempotent under the lock, so a run interrupted by a reload or another tab resumes at once (Amendment C). A failed
  step records its error, later steps are `skipped`, the run ends `partial` (some outputs) or `failed`. A captured
  snapshot with duplicate action ids fails before any output (Amendment B). Outputs are built inside the mutation from
  the snapshot, never through `addIdea`/`addPost`/`addPlanItem` (random ids); planner rows are appended by id, never
  `setPlanItems`, so owner rows and tombstones survive.
- **Storage stops a drain.** A not-persisted step rolls back and leaves the run `running`; the drain returns
  `{ resumed, remaining, stopped }` and the run row offers **Resume** (same attempt). The "stopped" marker lives only in
  memory (`workflowDrain`), because a failed write cannot record it and memory must never run ahead of storage.
- **Run now** captures a fresh snapshot: manual input for a manual workflow (article placeholders and an implicit article
  skill are issues there), or an explicit, non-archived article for an article-ready workflow (picker, default = newest
  ready article; `needs-article` otherwise). Retry reuses the original snapshot.
- **Preview** (`previewRun`) is pure: same builders and the same failure rule as the executor (first failure, then
  skipped), no store call, no storage probe, no network.

## Editor discipline (same as the CMS)

Autosave with "Saved ✓" only after read-back; pending edits are flushed before Run now / pause / back and the action
stops if that fails; another tab's commit or an import is a conflict that never overwrites the screen. Leaving the
editor any way (sidebar, Quick Actions) stashes the latest draft synchronously in a session store with a monotonic
token; an app-lifetime `beforeunload` guard stays while any stash exists; reopening offers Restore / Discard; a late
save clears only its own token (Amendment D). Separate module from the CMS stash, so CMS semantics are untouched.

## Reuse and search

- Reused in-repo: the CMS transaction (`commitFresh`), `storageDurable`, `applyOverlay`/`lightestDay`/`buildWeekPlan`
  (planner), `suggestHashtags`, `dayKey`/`addDays`/`weekKey`, `postHash`, the iOS list/segmented/switch/chip components.
- External workflow engines (n8n, Node-RED, Temporal, Inngest, Trigger.dev) were rejected: they need a server or a
  cloud runner, while this packet is a static export with local data and an explicit "nothing scheduled in the cloud"
  promise. A later Supabase/Cloudflare phase can move the executor server-side behind the same data model.

## Decisions

1. `WorkflowSchema.actions` accepts 0–5 (not 1–5) so a draft whose steps were all removed still saves; `actions-count`
   blocks running it.
2. Run now and Retry do not drain inside the store action (deterministic tests and one place for the trigger); the UI
   drains right after each own run commit, and the Ready commit drains itself as planned.
3. The planner gained `#week=<Saturday>` so a run's planner link always shows the row it wrote, even after the week
   rolled over (Amendment E).
4. New nav label "الخطوات التلقائية / Workflows" (`nav.workflows`, Lucide `Workflow`, desktop sidebar before
   Auto-posting; More row after Auto-posting); the Tools hub row is now `publish`/`available`.
