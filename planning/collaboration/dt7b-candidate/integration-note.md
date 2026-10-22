# DT-7B candidate — integration note (local Worker workflow foundation)

17 Oct 2026, Opus 5.5 (single writer). **Local, uncommitted and unactivated.** Nothing was committed, pushed, merged,
deployed, provisioned or applied remotely; no secret, provider, Cloudflare or network call was made.

## What this candidate is

- `worker-manifest.sha256`: sha256 of all 189 current Worker files (`workers/scout/**` without `node_modules`), sorted
  by path, the same format as `dt6b3a-candidate/worker-manifest.sha256` (182 files, the accepted DT-6B-3C tree, kept
  unchanged).
- `7b-overlay.patch`: the delta from that accepted 3C tree to this candidate — 9 modified files (`README.md`
  workflow-foundation section, `wrangler.jsonc` one binding + `v5-workflows`, `src/index.ts` fifth export + comment,
  `src/social/routes.ts` additive dispatch, `src/social/store.ts` optional `WORKFLOW_COORDINATOR`, the four prior
  coordinator runtime tests' expected class/binding lists and test-entry class exports) and 7 new files
  (`src/social/workflowProtocol.ts`, `workflowCoordinator.ts`, `workflowRoutes.ts`, their `.test.ts` files and
  `workflowCoordinator.runtime.test.ts`). `patch -p1` on the 3C files reproduces every candidate file byte for byte
  (checked in writer scratch). The historical 3A/3C artifacts (`allowlist.patch`, `3c-overlay.patch`, the 3C
  manifest and note) are untouched.

## DT-7B-R1 repair (18 Oct 2026, Opus 5.5, single writer; local, uncommitted)

- `worker-manifest.sha256` is refreshed to the R1 tree: still 189 Worker files, same format; exactly 8 entries
  changed (the seven `src/social/workflow*` files and `README.md`), every other entry byte-identical.
- `7b-r1-overlay.patch` (new): the exact unified diff from the frozen DT-7B files (the seven workflow files at their
  freeze hashes and the README `1e054649…`, snapshot-verified in writer scratch before editing) to the R1 files —
  8 modified files, no new or deleted file. `patch -p1` on a scratch copy of that base reproduces all 8 byte for byte
  (checked in `%TEMP%/claude-dt7br1-writer/verify/`). `7b-overlay.patch` stays the historical 3C → DT-7B delta,
  byte-identical; the 3A/3C artifacts are untouched.
- What changed: (1) the coordinator admits a new occurrence only inside its named epoch's `[opened_at, closed_at]`
  (before-open → the existing `409 not_registered`, zero mutation; identical replays unchanged); (2) the public routes
  validate complete, request-bound coordinator answers (receipt body re-checked at its admission time, payload and
  output digests recomputed, state/step/output table; typed feed items with no body-binding claim; bound mutation
  success; per-operation typed refusals) and answer `503 receipt_unavailable` otherwise. No route, binding,
  migration, export, env type, cron or app file changed.
- Follow-up before activation: one purge deletes every due terminal row in one transaction (independent probe: 601
  rows, 2,421 SQL calls, no failure). Bounded maintenance is still to do; no per-call purge bound is claimed.

## DT-7B-2 shared-builder execution (18 Oct 2026, Opus 5.5, single writer; local, uncommitted, unactivated)

- `worker-manifest.sha256` is refreshed to the DT-7B-2 tree: now 192 Worker files (189 + `src/social/workflowRun.ts`,
  `workflowRun.test.ts`, `workflowRun.runtime.test.ts`), same format and order; exactly 7 existing entries changed
  (`tsconfig.json`, `vitest.config.ts`, `README.md`, `workflowCoordinator.ts` + test, `workflowRoutes.ts` + test), every
  other entry byte-identical.
- `7b2-overlay.patch` (new): the unified diff from the frozen DT-7B-R1 files (snapshot-verified in
  `%TEMP%/claude-dt7b2-writer/base/` before editing) to the DT-7B-2 files — 7 modified, 3 new, none deleted.
  `patch -p1 --binary` on a fresh scratch copy of that base reproduces all 10 byte for byte (CRLF configs included;
  `git apply` here converts line endings, so use `patch`). `7b-overlay.patch` and `7b-r1-overlay.patch` are unchanged.
- `7b2-builder-pins.sha256` (new, the release gate): sha256 of the 17 app files in the adapter's import graph, taken
  from the esbuild metafile (`lib/workflows.ts`, `lib/{domain,weekPlan,planner,combo,streak,social,xp}.ts`,
  `components/planner/overlay.ts`, `data/{index,pillars,programs}.ts`, `data/skills/{craft-draft,davinci}.ts`, three
  `planning/data/davinci-*-pack.json`); `zod` 4.6.5 from the root `node_modules` (pinned by `pnpm-lock.yaml`, the same
  pnpm store copy the Worker declares). Cloud output equals the app's preview only while the app and the Worker are
  built from these identical pins; no cross-version equivalence is claimed. A catalogue/builder change needs new pins,
  a new parity run and a coordinated release before any execution-readiness claim.
- What changed: Worker tsconfig `paths` `@/* → ../../*` + `resolveJsonModule`, vitest alias `@` → repo root (nothing
  else in configs); `workflowRun.ts` (the fixed server builder over the real `lib/workflows.ts` `buildOutput`);
  coordinator op `run` (≤ 5 committed steps + 3 stale commits per call, inside the object, through the existing
  step-CAS); route `POST /social/workflows/occurrences/:id/run { ownerKey }` with the full-receipt answer proof. No
  route, binding, migration, export, env type, cron, protocol or app file changed; `social/routes.ts` already forwarded
  the path.
- Bundle (offline, Wrangler's esbuild 0.28.1): `src/index.ts` 3,412,385 B raw / 690,828 B gzip (was 2,441,789 /
  496,778). No React/Next/store/zustand/DOM-global/`process.env` dependency in the adapter graph (five textual hits of
  "window"/"localStorage" are prose in catalogue text and a comment, not runtime use).

## DT-7B-2-R1 monotonic run timestamps (18 Oct 2026, Sonnet writer; local, uncommitted, unactivated)

- Finding 7B2-1 (P2): a run request that lost the step-CAS to a newer request kept its older captured Worker clock for
  later steps and the finish, so `finishedAt`/`updatedAt` could precede `startedAt` and step times could decrease.
  `commitStep` and `finish` now stamp `max(captured Worker clock, the row's stored updated_at)` inside the same
  synchronous transaction as the existing receiptVersion/digest check (run loop and finish-only retry share the point).
  Equal times allowed; no +1 ms, outside clock, endpoint, state, parameter or schema; builder clock, outputs, digests,
  sequences, pause/cancel/unregister, adoption, ack and retention unchanged.
- `worker-manifest.sha256` regenerated (same format, still 192 files): exactly 3 entries changed
  (`README.md`, `workflowCoordinator.ts`, `workflowCoordinator.test.ts`).
- `7b2-r1-overlay.patch` (new): unified diff from the DT-7B-2 freeze files to these three; `patch -p1 --binary` on a
  scratch copy of the base reproduces them byte for byte. `7b-overlay.patch`, `7b-r1-overlay.patch`,
  `7b2-overlay.patch` and `7b2-builder-pins.sha256` are unchanged.

## Activation state

- **Fifth binding not provisioned.** `WORKFLOW_COORDINATOR` (class `WorkflowCoordinator`, SQLite, migration tag
  `v5-workflows`) exists in `wrangler.jsonc` only; `wrangler dev` and the Miniflare runtime test simulate it. Applying
  the migration to a real account is a separate, unauthorized step. All earlier bindings/migrations are unchanged.
- **Unactivated.** No browser code calls `/social/workflows/*`; no cron runs anything; with the binding absent every
  workflow route answers `503 not_configured` (`detail: "workflow-store"`).
- **Real executor (DT-7B: pending; DT-7B-2: built locally, see above).** Historical DT-7B text: the executor gate
  failed: the existing pure builders do not resolve under the Worker's
  pinned tsconfig/vitest (app-only `@/*` alias, JSON modules). `workflowRun.ts` was not created and no builder logic was
  copied. Step transactions are proven only with a test-only deterministic builder (`drainOne` + injected builder in
  tests; no route, cron, header, field or env enables it). This is store atomicity evidence, not a functioning cloud
  workflow runner. Matrix rows 9–14 and 26–30 are "validation pending (executor)".

## Before any activation (independent, not done here)

Review of the DT-7B-2 resolver/adapter/run route and the builder-pin release gate; bounded purge maintenance; DT-7C
browser outbox/proof/reset/import gates; DT-7D schedule template/context
and materialization; DT-7E activity labels; Cloudflare identity/traffic, migration application, secrets, provider
grants and the automatic-reply cutover — all unverified.
