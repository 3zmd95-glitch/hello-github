# DT-7C-3 — coherent dashboard integration of the cloud workflow controllers (plan, 22 Oct 2026)

Planner: Claude Fable 5.1. Writers: one at a time (Opus for 3A/3B, Sonnet for 3C/3D). Reviewer: **Claude** (owner,
22 Oct 11:42 AST: "dont make codex review you review") — an independent Claude reviewer pass per slice plus planner
verification; no `codex queue`, no review marker. Branch `codex/discover-inspiration`, worktree
`C:/Users/AORUS/.codex/worktrees/discover-inspiration/hello-github`, start commit `164614e`.

## Outcome

The owner can, from the dashboard alone: connect to the configured Worker, put a workflow on the cloud (and take it
off), send a captured run, check / run / cancel it, fetch finished results into local drafts, confirm delivery, and
see every limit and refusal in plain Hijazi Arabic / English. Every network request is one explicit click. Nothing
runs at load, in the background, on a timer, or after a refusal. The existing local executor is unchanged for
workflows that are not registered. **This is UI integration, not activation**: the Worker's workflow Durable Object is
still not provisioned/deployed; against today's deployed Worker the handshake answers "not available" and the UI says
so truthfully.

## Fixed rules (from the accepted contracts; do not relax)

1. Consume the accepted controllers as they are: `createRegistrationController`, `createOccurrenceController`,
   `createReconciliationController` (`lib/cloudWorkflow*Client.ts`) with the store's `cloudRegistrationPersistence`,
   `cloudOccurrencePersistence`, `cloudReconciliationPersistence`, and the capture APIs `captureManualRun` /
   `captureArticleReady` (`store/index.ts`). No second transport, no copied protocol, no direct `fetch`.
2. One shared `fetch`: `window.fetch` bound as a plain function. HTTPS except exact loopback is already enforced in
   the session; the UI only surfaces `ConfigureResult` reasons.
3. Explicit actions only. No handshake on page load, no polling, no retry loops, no auto-ack, no auto-reconcile. A lost
   answer is shown as "uncertain — check status", never as failed or delivered.
4. Fences: `invalidateCloudVisit()` on leaving the Workflows screen and on `pagehide`; the hub re-`configure()`s the
   controllers from the store's `settings.apiKeys.scoutUrl` / `scoutToken` on every change (subscribe once). The token
   is never rendered, logged, or persisted anywhere new.
5. Limits are the library constants, shown as numbers from the code, never retyped: `REGISTRATION_CAPACITY` (100),
   `PROOF_CAPACITY` (600), `TOMBSTONES_MAX` (100), `JOURNAL_CAPACITY` (600), snapshot output 4,000 units, context
   8 KiB, body 16 KiB (`lib/cloudWorkflowSnapshot.ts`). Fix any copy that says 600 where the registration cap is 100.
6. Local-only workflows keep today's Run now / Mark ready paths. A workflow with cloud evidence routes Run now through
   `captureManualRun(id, { authority })` and Mark ready through `captureArticleReady(articleId, { authority })`; the
   legacy refusals already in place stay.
7. Pinned (no edits): everything under `workers/`, builders (`lib/workflows.ts` graph), `lib/cloudWorkflowProtocol.ts`,
   `lib/cloudWorkflowJournal.ts`, `lib/cloudWorkflowRegistration.ts`, `lib/cloudWorkflowCapture.ts`,
   `lib/cloudWorkflowSnapshot.ts`, `lib/cloudWorkflowReconciliation.ts`, the four controllers, `package.json`, lock,
   configs, Inbox, publishing, unrelated store behaviour, existing assertions. If a controller/store API is missing
   something the UI genuinely needs, the writer records the exact gap in its handoff record and stops that slice.
8. Copy: messages are split per file (`messages/workflows.{ar,en}.json`, `messages/settings.{ar,en}.json` …; the
   parity test `messages/messages.test.ts` requires identical keys/placeholders per pair, no key in two files). Friendly
   Hijazi first; new keys under `workflows.cloud.*` and `settings.cloud.*`.
9. Known copy defect (scout): `settings.importJournalFull` says "(600)" but the `journal-capacity` import refusal is
   also returned with `scope: "registrations"` (cap 100) and `scope: "reconciliation"` (600 + 100 markers);
   `SettingsScreen.tsx` maps by reason only. 3C maps by `scope`.
10. Read models: the store exposes `loadCloudJournal()` only; `cloudRegistrations` / `cloudReconciliation` are raw
   slices read through the pinned parsers (`readRegistrations`, `readReconciliation`). 3A adds the read-only
   selectors the UI needs (registrations view, proofs/pending/runs/tombstone counts) in the hub, parsing through the
   pinned modules — no new store slice. Scout inventory: `C:/Users/AORUS/.claude/dashboard-work/integration-scout.md`.

## Slices (one writer each, in order)

### 3A — browser hub (Opus) — `lib/cloudWorkflowHub.ts` + `lib/cloudWorkflowHub.test.ts`

A lazy, browser-only singleton (created on first call, never at import, safe under server render) that owns the three
controllers and exposes a small observable view:

```ts
export interface CloudHubView {
  configured: { ok: true; origin: string } | { ok: false; reason: "none" | "origin" | "insecure" | "token" };
  authority: { origin: string; ownerKey: string } | null;      // after an explicit handshake
  handshake: "idle" | "busy" | "ok" | { refused: string } | { uncertain: string };
  busy: Set<string>;                                            // keys with an action in flight
  last: Record<string, unknown>;                                // last typed result per key, for the UI copy
}
export function cloudHub(): CloudHub;   // { view(): CloudHubView; subscribe(cb): () => void; handshake(); register(workflowId);
                                         //   unregister(workflowId); recover(workflowId); submit(key); status(key); run(key);
                                         //   cancel(key); reconcile(); check(key); ack(key); authorityFor(workflowId); dispose() }
```

- `authorityFor(workflowId)`: the verified registration record's `{origin, ownerKey}` when it equals the configured
  origin, else `null` (UI shows "belongs to another Worker").
- `register(workflowId)` builds the request from the stored workflow through the accepted registration intent API
  (the controller validates); result union passed through unchanged.
- Subscribes to the store once for origin/token transitions → `configure()` on all three; `dispose()` on `pagehide`.
- Tests (vitest, jsdom): construction is lazy; configure follows settings; every action dispatches exactly one
  controller call with the fence captured; no call at construction; token never appears in `view()`.

### 3B — Workflows + CMS wiring (Opus)

- `components/social/workflows/WorkflowEditor.tsx`: a **Cloud** card: state chip (local / on cloud / paused on cloud /
  another Worker / unsupported id / capacity 100/100), buttons **Put on cloud** / **Take off cloud** / **Recover**
  (register / unregister / recover); refusal copy per `ControllerRefusal` reason. **Run now** for a registered workflow
  → `captureManualRun(id, { authority })`; the result row offers **Send** (submit). Per journal entry (DT-7C-2A view):
  **Send / Check status / Run / Cancel**, each one controller action; outcomes `dispatched`/`unconfirmed`/`stale`/
  refusal reasons as copy. Cloud runs list from `cloudReconciliation.runs` (own schema; done / partial / failed /
  cancelled / pending / running), separate from local `workflowRuns`.
- `components/social/workflows/WorkflowsScreen.tsx`: a **Cloud results** card: **Fetch results** (`reconcile()` one page,
  limit 50) with `more / blocked / pending / retired` counts; **Confirm delivery** per proven occurrence (`ack`); the
  `proof-full` / `retirement-full` states as a visible pause with "check status" guidance; a handshake prompt when not
  connected (explicit button, links to Settings).
- CMS **Mark ready**: route through `captureArticleReady(articleId, { authority })` when any registered article-ready
  workflow exists; the existing legacy path otherwise. Refusal copy for `blocked`/`authority-mismatch`/`too-large`/
  `limitation`/`capacity`/`conflict`/`suppressed`/`stale`.
- Component tests (existing `WorkflowsScreen.test.tsx` style) with a fake hub: each button → one hub call; refusal
  copy renders; token never in DOM.

### 3C — Settings (Sonnet)

`components/settings/SettingsScreen.tsx`: a **Cloud workflows** card under API keys: configured origin + `ConfigureResult`
reason; **Check connection** (handshake) → ownerKey (non-secret) or refusal/uncertain copy; capacity lines
"registrations n / 100", "delivery records n / 600", "retired markers n / 100"; the limits sentence (4,000 units,
8 KiB context, 16 KiB body); import result `retired` list copy; fix the 600-vs-100 registration copy if present.
Component test + AR/EN parity check.

### 3D — browser proof (Sonnet) — `e2e/workflow-cloud.spec.ts`

Installed Chrome, EN desktop + AR phone, synthetic state only, external requests blocked, Worker answers served by a
Playwright `page.route` fake for one synthetic origin (`https://cloud.test`) that replays protocol-valid fixtures built
with the pinned protocol module (reuse the vitest store harness if it imports cleanly from Playwright's Node runtime;
otherwise fixture answers recorded from that harness — record which). Cases: connect; put on cloud; capture + send;
check status (unconfirmed on a dropped answer; no second request); fetch results adopts one idea draft once and a
reload keeps it; confirm delivery only after the draft is read back; refusal copy for another-Worker and capacity;
zero requests on load/reload. Uses the existing `:3000` static server: `pnpm build` rewrites `out/` and `serve` reads
from disk, so **do not restart** it; assert served bytes equal `out/` before running.

## Checks per slice, then once at the end

Focused vitest for changed files; `pnpm lint`; `pnpm typecheck` (non-incremental); after 3B and again at the end one
full `pnpm test --maxWorkers=4`; `pnpm build` once before 3D; e2e: the new spec plus `workflows`, `workflow-capture`,
`workflow-reconciliation`, `settings` (`pnpm e2e` on those files). Evidence outside TEMP in
`C:/Users/AORUS/.claude/dashboard-work/dt7c3/<slice>/logs/` with every command and exit code; final SHA-256 of every
changed file in the handoff record. Reviewer: independent Claude pass on the slice diff (correctness, fences, copy
parity, no auto-request), then planner verification by hashes and spot checks.

## Out of scope (carried, do not touch)

Schedules/cron (DT-7D), truthful activity (DT-7E), purge maintenance, Worker provisioning/deploy/secrets/grants, DT-6
live readiness, TikTok Inbox, DT-8–DT-10, Wsla.io backlog. No push/merge/deploy/paid use/system change.
