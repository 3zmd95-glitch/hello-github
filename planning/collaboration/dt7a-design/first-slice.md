# DT-7A — proposed first implementation slice (revision R1): DT-7B Worker workflow store

Goal: the durable authority / registration / occurrence / step-CAS / change-feed store and its authenticated routes,
proven with synthetic transport and the real local workerd runtime. No browser wiring, no cron, no activity UI, no
publication, no provider call.

## Executor gate (decided first, recorded before other code)

The pure builders (`lib/workflows.ts` → `lib/weekPlan.ts`, `components/planner/overlay.ts`, `@/data`, `lib/social.ts`)
use the app path alias and catalog modules. Step 1 of DT-7B: try a Worker-only TypeScript compile of a thin
`workflowRun.ts` importing those modules (no edits to them).
- **Compiles cleanly (no DOM/React/store import):** DT-7B includes the executor and matrix rows 9–14, 26–30.
- **Does not compile:** DT-7B is store-only. It proves rows 1–8, 15–25, 31 and the step-CAS transaction with a
  test-injected deterministic builder. Rows 9–14 and 26–30 are recorded as "validation pending (executor)"; no
  execution or crash-resume acceptance is claimed. No duplicate builder is written.

## Files

- New `workers/scout/src/social/workflowCoordinator.ts`: SQLite Durable Object per contract §3 (tables `meta`,
  `registrations`, `occurrences`, `steps`, `outputs`, `missed` (created, unused until DT-7D), `tombstones`). Methods:
  `authority()` (creates `ownerKey` once), `register`, `updateRegistration` (CAS on revision), `pause`, `resume`,
  `unregister`, `submit` (digest check, admission rules §2, capacity), `step(occurrenceId, idx, builder)` (one
  transaction, step-CAS), `finish`, `cancel` (pending only), `status(id)` (`absent|pruned|row`), `changes(after, limit≤50)`,
  `ack(id, receiptVersion)` (monotonic), `purge` (hourly throttle via `meta`).
- New `workers/scout/src/social/workflowRoutes.ts`: bearer/origin like `/social/*`; `GET /social/workflows/authority`;
  `POST /social/workflows/registrations`, `PUT …/registrations/:id`, `POST …/registrations/:id/pause|resume|unregister`;
  `POST /social/workflows/occurrences`; `GET /social/workflows/occurrences/:id`; `GET /social/workflows/changes`;
  `POST …/occurrences/:id/cancel`; `POST …/occurrences/:id/ack`. The executor `drainOne` is exported for tests only (no
  route, no cron).
- New `workers/scout/src/social/workflowRun.ts` only when the executor gate passes.
- Narrow wiring (recorded exceptions): `routes.ts` dispatch; `store.ts` env field `WORKFLOW_COORDINATOR`; `index.ts`
  fifth named export; `wrangler.jsonc` binding + additive migration `v5-workflows` (local only, never provisioned).
- Tests: `workflowCoordinator.test.ts`, `workflowRoutes.test.ts`, `workflowCoordinator.runtime.test.ts` (Miniflare from
  the pinned Wrangler); `workflowRun.test.ts` only with the executor.

## Schemas and caps

Ids `^[A-Za-z0-9_-]{1,64}$`; occurrence body ≤ 16 KiB incl. `plannerContext` ≤ 8 KiB; ≤ 20 registrations; ≤ 500
non-terminal occurrences; `changes` ≤ 50; streaming body budget 32 KiB; `receiptVersion`/`changeSeq` positive
integers; strict typed answers echoing `ownerKey`; mixed error/success envelopes rejected (C2/C3 discipline).

## Compatibility

DT-4 browser executor, `workflowRuns`, Ready trigger, DT-5 mapping, all inbox coordinators, cron and budgets untouched;
existing four DO bindings/migrations unchanged (additive `v5-workflows`).

## Later slices

DT-7C browser outbox, authority fences, reconciliation, durable proof/reset/import (rows 32–40); DT-7D schedule
materialization inside the existing tick budget (rows 41–45); DT-7E activity view (rows 46–50); DT-8 publication.

## Independent activation prerequisites (unchanged)

Active Cloudflare identity/traffic; bindings and migrations actually applied; secret presence (names only); a minimal
legacy delivery/cooldown inventory; a reviewed automatic-reply cutover; actual provider grants and API version/window
support. DT-6 is built and tested locally, not live-ready; TikTok Inbox and DT-8–DT-10 remain incomplete.

## DT-7B outcome (Opus 5.5, 17 Oct 2026; local, unactivated)

- **Executor gate: FAILED for this packet.** The pure builders are portable (scratch tsc with a `@/*` alias exit 0, no
  DOM/React/store/env/app runtime; esbuild bundles ~1.7 MB), but under the exact Worker resolver `lib/workflows.ts` fails
  with 6 × TS2307 on `@/` imports (and `data/skills/davinci.ts` needs `resolveJsonModule`); the Worker tsconfig and
  vitest config are pinned. `workflowRun.ts` was not created; nothing was copied. Rows 9–14 / 26–30 stay
  "validation pending (executor)"; the store's step transactions are proven with a test-only builder.
- **Built:** `workflowProtocol.ts` (strict schemas, canonical JSON + digest vectors, allowlisted draft outputs),
  `workflowCoordinator.ts` (tables as above plus `registration_epochs`; `drainOne` exported for tests only),
  `workflowRoutes.ts`; wiring: `routes.ts` dispatch, `store.ts` `WORKFLOW_COORDINATOR`, `index.ts` fifth export,
  `wrangler.jsonc` binding + `v5-workflows` (never provisioned or applied remotely).
- **Deviations from the route list above:** the registration update is `POST …/registrations/:id` (no PUT: the Worker's
  CORS answer allows GET, POST, DELETE only); `register` carries `expectedEpoch`; every route but `authority` names the
  `ownerKey` (the submit body carries it). Errors: `bad_request`, `unsupported_id`, `too_large` (413),
  `digest_mismatch`, `authority_mismatch`, `conflict`, `not_registered`, `unknown_epoch`, `registration_behind`,
  `capacity` (409), `pruned` (409 submit / 410 cancel+ack), `absent` (404), `running`, `not_terminal`,
  `future_version`, `not_configured`/`receipt_unavailable` (503), `method_not_allowed`.
- **Still independent prerequisites:** everything in the section above; plus a reviewed resolver change before any real
  executor, and the DT-7C/7D/7E gates recorded in contract.md.
- **DT-7B-R1 (18 Oct 2026, local):** admission now requires `executionAt` inside the named epoch's `[openedAt,
  closedAt]` (before-open → `409 not_registered`, zero mutation); the routes validate complete, request-bound proof
  (contract amendment 7). Follow-up before activation: one purge deletes every due terminal row in one transaction
  (independent probe: 601 rows, 2,421 SQL calls, no failure) — bounded maintenance still to do, no per-call bound
  claimed. Still store-only; the real executor stays validation pending.
- **DT-7B-2 (18 Oct 2026, local, unactivated):** the executor gate is closed by the authorized resolver change
  (Worker tsconfig `paths` + `resolveJsonModule`, vitest alias). `workflowRun.ts` runs the real `buildOutput` inside
  the object through one internal op `run` (≤ 5 committed steps + 3 stale commits per call) and one route
  `POST …/occurrences/:id/run { ownerKey }` (contract amendment 8). Proven: Node byte parity with `previewRun`/
  `buildOutput` and workerd execution through the real router/bindings/persisted SQLite (test-matrix rows 9–14, 26–30).
  Bundle +970,596 B raw / +194,050 B gzip (catalogue). Release gate: `dt7b-candidate/7b2-builder-pins.sha256`.
  Still open: purge maintenance, DT-7C browser proof/reset/import, DT-7D schedule (and the scheduled half of row 28),
  DT-7E activity, live readiness.
