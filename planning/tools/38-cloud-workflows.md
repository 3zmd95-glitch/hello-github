# 38 · Cloud workflows: the local Worker foundation (packet DT-7B)

Status: implemented locally, 17 Oct 2026 (Opus 5.5, single writer). **Local and unactivated**: the fifth Durable
Object binding (`WORKFLOW_COORDINATOR`, migration `v5-workflows`) is in `workers/scout/wrangler.jsonc` only — never
provisioned, applied remotely or deployed. No browser wiring, no cron, no executor, no effect. The DT-4 browser
executor stays the only thing that runs workflows. Design: `planning/collaboration/dt7a-design/` (R1 + DT-7B
amendments); authority: `%TEMP%/dashboard-remaining-tools-2026-10-16/dt7ar1-review/dt7b-authorized-contract.md`.

**DT-7B-R1 repair (18 Oct 2026, Opus 5.5, local):** two review findings fixed, nothing else. (1) *Admission interval*:
a new occurrence needs `opened_at ≤ executionAt ≤ closed_at` of its exact named epoch (closed bound only once
unregistered; integer ms; no skew allowance before opening); before-open → the existing `409 not_registered`, nothing
stored, no sequence bump; identical accepted replays stay `created: false`. A day-old event is not cloud-owned because
it names a newly opened epoch. (2) *Complete response proof*: the routes re-check a receipt's whole body with the
admission validator at its own `createdAt`, recompute the payload and output record digests, bind identity and the
coordinator's state/step/output table; feed items get typed, linked steps/outputs and recomputed draft digests (no
body, so no body/target binding is claimed: full status stays the authority); mutation success is bound to the
request; refusals must be the operation's own errors with typed, bound extras. Anything else is `503
receipt_unavailable`, unechoed, with no further call. Authority:
`%TEMP%/dashboard-remaining-tools-2026-10-16/dt7b-review/dt7b-r1-authorized-contract.md`. Follow-up before activation:
one purge deletes every due terminal row in one transaction (independent probe: 601 rows, 2,421 SQL calls, no
failure); bounded maintenance is still to do and no per-call purge bound is claimed.

**DT-7B-2 shared-builder execution (18 Oct 2026, Opus 5.5, local, unactivated):** the existing pure draft builders now
run inside workerd through one authenticated, bounded, draft-only route. Authority:
`%TEMP%/dashboard-remaining-tools-2026-10-16/dt7br1-review/dt7b2-authorized-contract.md` + the planner's rulings 1–9.
- *Resolver*: Worker `tsconfig.json` gains only `"paths": { "@/*": ["../../*"] }` and `"resolveJsonModule": true`;
  `vitest.config.ts` only `resolve.alias` `@` → repo root. Wrangler's esbuild resolves the same graph from the
  tsconfig with no further option (the runtime tests bundle `src/index.ts` unchanged). `zod` 4.6.5 comes from the root
  `node_modules` (the same pnpm store copy the Worker declares; no package change).
- *Adapter* `workers/scout/src/social/workflowRun.ts` (`runStep`, the existing `StepBuilder` contract) calls the real
  `buildOutput(occurrenceId, action, input, { completions, planItems, settings: { gear, davinciEdition } },
  new Date(executionAt))`: the stored body only, the planner context projected exactly, the earlier plan outputs of the
  same occurrence folded in action order (as `previewRun`). Builder errors keep their codes; a plan step whose context
  is missing or of another week than `weekKey(input.day)` fails `context-stale` (fail-fast). A record outside the draft
  allowlist (e.g. a template that expands past 4,000 characters) fails `invalid` — never truncated, never widened; the
  allowlist accepted every field the builder emits (no field difference found).
- *Execution*: coordinator op `run` (`{ op, ownerKey, occurrenceId, now }` exactly) loops inside the object with the
  statically imported adapter: read, build the next pending step, commit through the existing step-CAS with the
  observed version/digest, finish when nothing is pending. ≤ 5 committed steps + 3 stale (raced) commits per call, then
  `stopped: limit | contention` with the current receipt; `paused` when the pause gate refuses the first step;
  `terminal` otherwise. Storage, admission, epochs, pause, cancellation, ack, retention and feed are unchanged; `drainOne`
  stays test-only. `limit` is defensive: a body has ≤ 5 steps and the finish follows the last.
- *Monotonic stamps (DT-7B-2-R1, finding 7B2-1)*: a run that lost the step-CAS to a newer request used to carry its
  older captured Worker clock into later steps and the finish, so `finishedAt`/`updatedAt` could precede `startedAt`
  and step times could decrease. `commitStep` and `finish` now stamp `max(captured Worker clock, the row's stored
  updated_at)`, read in the same synchronous transaction as the existing receiptVersion/digest check (shared point: the
  run loop and a finish-only retry are both covered). Equal times allowed, no +1 ms, no outside clock, no new
  endpoint/state/parameter/schema; builder clock still `executionAt`; outputs, digests, ids, versions, sequences,
  pause/cancel/unregister, adoption, ack and retention unchanged; validators not broadened.
- *Route*: `POST /social/workflows/occurrences/:id/run { ownerKey }` (no query string), the answer
  `{ ownerKey, occurrence, committed, stopped }` validated with the R1 full-receipt validator plus the stop rules;
  anything else `503 receipt_unavailable`. `social/routes.ts` already forwards it (unchanged).
- *Evidence*: Node byte parity vs real `previewRun`/`buildOutput` (idea/post/plan, EN/AR, Riyadh rollover, ordered
  lightest-day plans, overlays/history, gear/edition, missing/unknown skill, stale context, over-bound record); workerd
  through the real router/index/bindings/persisted SQLite with outputs byte-equal to the host (concurrent resumes, lost
  answer, restart between steps and before finish, pause/unregister/resume, running-while-paused, cancel race, terminal
  replay, receipt/feed validation, outbound trap empty, unauthenticated/cross-origin/extra-field refused).
- *Bundle* (offline, Wrangler's esbuild 0.28.1, Worker conditions): `src/index.ts` 3,412,385 B raw / 690,828 B gzip
  (base 2,441,789 / 496,778: +970,596 / +194,050, mostly the catalogue JSON). Adapter graph: 3 Worker files, 17 app
  files, `zod`; no React/Next/store/zustand/DOM-global/`process.env` use.
- *Release gate*: `planning/collaboration/dt7b-candidate/7b2-builder-pins.sha256` pins the 17 app files of the adapter
  graph. Parity holds only while the app and the Worker are built from identical builder/catalog pins; no
  cross-version equivalence is claimed. Catalog-version reproducibility must be checked against these pins before any
  execution-readiness claim.

## What exists now (and what does not)

- A durable, authenticated **store** for cloud workflow occurrences: one server-selected SQLite Durable Object with
  authority, registrations, immutable occurrences, transactional steps, a change feed, acknowledgement, cancellation
  and retention (`workers/scout/src/social/workflowCoordinator.ts`, `workflowProtocol.ts`, `workflowRoutes.ts`).
- (DT-7B-2) One authenticated run/resume route that executes the dashboard's real draft builders inside the object
  (above). Still **not** activated: no browser wiring, no cron/schedule, binding not provisioned. The original
  executor-gate result below is kept as history; the DT-7B-2 resolver change closed it.
- The owner sees nothing new: no dashboard screen calls these routes yet (DT-7C).

## Executor gate (decided first)

The existing pure builders (`lib/workflows.ts` → `lib/weekPlan.ts`, `components/planner/overlay.ts`, `lib/planner.ts`,
`lib/combo.ts`, `lib/streak.ts`, `lib/social.ts`, `lib/xp.ts`, `lib/domain.ts`, `@/data` + three `planning/data` JSON packs,
`zod`) are portable code: with a scratch `@/*` alias they typecheck under the Worker's compiler options (ES2022, no DOM)
and bundle with Wrangler's esbuild (~1.7 MB unminified). Under the Worker's **actual** resolver they fail (6 × TS2307 on
`@/` imports; `resolveJsonModule` needed), and the Worker tsconfig/vitest config are pinned in DT-7B. Result: store-only;
`workflowRun.ts` not created; no builder logic copied; executor parity and execution readiness **validation pending**.
A later packet needs explicit authority for the resolver change and a bundle-size check.

## The six binding rulings, as built

| # | Ruling | Implementation | Tests |
| --- | --- | --- | --- |
| 1 | Exact-terminal ack, firstAckAt, retention | `ack`: future → `409 future_version`, lower → no-op (`acknowledged: false`), nonterminal `409 not_terminal`, absent `404`, pruned `410`; first exact terminal ack stores `first_ack_at` (Worker clock), never moved; no version/feed bump. Purge at `min(finished + 180 d, firstAck + 90 d)` / `finished + 180 d`, hourly throttle, permanent tombstones, nonterminal never. | coordinator: ack sequence + restart, `purgeAt`, three boundary pairs (1 ms before / at), tombstone replay; routes: ack statuses; runtime: ack across restart, no feed echo, purge, tombstone after restart |
| 2 | Pause/resume | The registration row's retained `paused` flag, checked inside the first pending → running step transaction for every epoch; only pause/resume change it; unregister keeps it and never cancels/moves work. | coordinator: paused pending + resume, running finishes, old epoch gated after re-register; runtime: pause → unregister → resume |
| 3 | Fail-fast | A builder error or `output-conflict` fails the step and skips every later step in the same transaction; finish: done / partial (a step done) / failed. Design matrix row 28 and contract §4 corrected. | coordinator: `[idea, stale plan, post]` → partial (idea kept, post skipped); `[stale plan, idea]` → failed, no output; output-conflict |
| 4 | Authority + CAS | Fixed object `workflows|owner`; `owner_key` INSERT OR IGNORE in meta; register `expectedEpoch` (lost answers replay, no new epoch); update/pause/resume/unregister CAS on epoch + revision; `registration_epochs` keeps every cutoff; unknown epoch refused; (R1) admission inside the named epoch's `[opened_at, closed_at]`. | coordinator: stable key across restarts, mismatch zero mutation, lost register/re-register, epoch ABA, closed-epoch cutoff after re-registration, capacity 20, (R1) first registration / long gap / delayed old epoch / both equal bounds / restart replay; routes: fixed object name; runtime (R1): the same interval cases through the real router |
| 5 | Exact bodies + transitions | Strict schema (exact keys everywhere, ids without `:`, unique actions, trigger/input/context/week consistency, canonical ISO, ≤ 16 KiB / 8 KiB); server digest over canonical JSON (vectors pinned); exact stored body; step = captured digest + current version + next pending idx + prior done; output digest computed before the transaction, everything rechecked inside; finish refuses with pending steps. | protocol: vectors (independent Node crypto), key-order invariance, refusals; coordinator: same-id/digest, conflict, digest_mismatch, step prerequisites, lost commit adoption, concurrent drains; runtime: three drains + finish race + cancel race |
| 6 | Feed/status | `changes`: rows with seq > after, `nextAfter` = last returned seq or `after`, `more` = a row beyond; full status with exact body/executionAt/digest/version/steps/outputs; absent/pruned distinct; outputs allowlisted drafts; no public step/builder route; (R1) complete request-bound answer proof (receipt body/digests/state table, typed feed items, bound mutations, typed refusals). | coordinator: reversed completion, 120 rows / 3 pages, mutation between pages; routes: tampered/mixed answers → 503, no step route, (R1) real control fixtures for every state/outcome and the tamper tables; runtime: pagination across restart with old rows finishing later |

## Routes

`GET /social/workflows/authority`; `POST …/registrations`, `POST …/registrations/:id` (update; no PUT — the Worker's
CORS answer allows GET, POST, DELETE), `POST …/registrations/:id/{pause,resume,unregister}`; `POST …/occurrences`,
`GET …/occurrences/:id?ownerKey=`, `POST …/occurrences/:id/{cancel,ack,run}` (run: DT-7B-2);
`GET …/changes?ownerKey=&after=&limit≤50`.
Bearer + origin as `/social/*`; 32 KiB streaming budget; strict keys/queries; complete answers bound to the request
(R1); mixed, foreign, malformed or contradictory answers `503 receipt_unavailable`. Details: Worker README "Cloud workflow foundation".

## Matrix coverage

Included (W): 1, 2, 3 (Worker side), 4–8, 15–25, 31. Store atomicity with the test-only builder: step analogues of 9–14
and 28. (DT-7B-2) Executor rows 9–14 and 26–30 now proven locally with the real builders (Node parity + workerd);
row 28's scheduled case stays a DT-7D fixture (admission refuses a mismatched week today; the adapter's
`context-stale` path is proven in Node). Later packets: B 32–40 (DT-7C), S 41–45 (DT-7D), A 46–50 (DT-7E).
See `planning/collaboration/dt7a-design/test-matrix.md` "DT-7B status".

## Carried gates (not proven here)

- **DT-7C**: authority+occurrence keys for local outbox/cursor/proof/runs; fail closed on a `wf:` output owned by another
  authority/digest (no renaming, no false acknowledgement); initial proof from the immutable triggering executionAt;
  monotonic resetAt + epoch merge across equal-counter imports; durable retirement generations.
- **DT-7D**: CAS-bound registration execution template/context (schema omits it); bounded intervals/admission/watermark,
  no history replay; long-gap fixtures on daily/weekly cadence. No cron wiring yet.
- **DT-7E**: publish `targets[p].state` (no job-level status); Effects data timestamp vs latest failed save.
- **Live**: Cloudflare identity/traffic, migration application, secrets, provider grants, automatic-reply cutover —
  unverified; nothing here claims readiness.

## Search before building (CLAUDE.md)

No remote research was allowed in this packet (offline rule). Reused in-repo: the SQLite Durable Object coordinator
pattern (`instagramDmCoordinator.ts`: synchronous transactions, `RETURNING`, meta-throttled purge, Miniflare runtime
harness from the pinned Wrangler) and `readCapped` (streaming budget). Considered and not adopted: Cloudflare Workflows
(a separate durable-execution product needing its own binding/provisioning and outside the authorized local scope; our
pure, synchronous steps need only step-CAS in the existing DO pattern) and `zod` validation of bodies (it strips unknown
keys by default; the protocol requires refusing them, so a small strict validator is used). No new dependency.

(DT-7B-2) Offline again; no new dependency. Adopted the dashboard's own builders through a resolver alias instead of
copying or vendoring them (a fork would break parity). Considered and rejected: a generated/vendored catalogue copy in
the Worker (two sources of truth) and a request-selectable builder (forbidden by the contract).

## DT-7C-1 - browser protocol and cloud preflight foundation (18 Oct 2026, local, unactivated)

Two pure app-side modules and their tests; no store, hook, UI, transport, fetch or activation (cloud workflows stay
unusable in the dashboard).

- `lib/cloudWorkflowProtocol.ts`: canonical HTTP(S) origin + server `ownerKey` authority (credentials/query/fragment/
  non-root path rejected, never stripped; keys are `canonicalJson([origin, ownerKey])` and
  `canonicalJson([origin, ownerKey, occurrenceId])`, no bearer or fingerprint); request descriptors (method + fixed
  route/query + allowlisted body, no header/origin/Authorization); strict `parseAnswer` per route returning `ok` /
  typed `refused` / `invalid` (mixed error+success, unknown keys, foreign owner/id/epoch/digest, contradictory
  steps/outputs and a wrong status code are `invalid`, never partial). A FULL receipt recomputes the body and output
  digests at the receipt's own admission time; a compact FEED item is a separate type that cannot authorize an adoption
  or an ack (only receipts this module verified do: `ackRequestFor`, `adoptionProofOf`). It reuses
  `workflowProtocol.ts`/`time.ts` read-only (`checkBody`, `validOutput`, `validDraft`, canonical JSON, digests); the few
  coordinator-only constants (epochs 50, feed page 50, run commits 5, retention 180/90 d) are repeated and pinned to the
  coordinator by the wire test.
- Ready occurrence id = `ar-` + unpadded base64url of all 32 SHA-256 bytes of
  `canonicalJson([workflowId, articleId, readyCommitId])` (46 characters; full hex would exceed the 64-character id
  bound); manual ids are caller-supplied and validated (never `ar-`/`sc-`).
- `lib/cloudWorkflowSnapshot.ts`: `buildCloudSnapshot` (immutable allowlisted body from explicit inputs and a captured
  occurrence id / epoch / revision / executionAt; Riyadh day from that instant; context = pre-target-week completions
  `{skillId, quest, at}`, target-week rows incl. zero-minute tombstones, gear/edition, context time; refusals for
  unsupported ids, chronology, counts and the 16 KiB / 8 KiB bounds - never truncated or renamed) and `previewCloudRun`
  (real `buildOutput` with the actual occurrence id, earlier plan outputs folded as the Worker adapter does, fail-fast
  prefix/suffix; a record outside the Worker's draft allowlist, e.g. text over 4,000 UTF-16 units that the local builder
  accepts, is an explicit `output-too-large` cloud limitation).
- Tests: protocol unit, snapshot, and `cloudWorkflowProtocol.wire.test.ts` (answers of the REAL `scout.handle` router over
  the actual SQLite coordinator, with the app's own descriptors and snapshots; the Worker modules are loaded dynamically
  so the app `tsc` does not type Cloudflare sources).
- Cloud limits recorded: generated text over 4,000 units fails in the cloud only; the 200-completion / 100-row count caps
  are reached only after the 8 KiB context cap for full-size entries, so a long history is refused
  (`too_large`/`count_exceeded`), not truncated - DT-7C-2 must decide how a caller reports that.
- Search before building: offline again; reused in-repo only (Worker protocol/time, `lib/workflows`, `lib/streak`); no new
  dependency. Not adopted: `zod` for answers (it strips unknown keys; the protocol requires refusing them).
- Still open (DT-7C-2 onward): transport/connection fences, authority-scoped durable outbox/proofs/runs/cursor,
  same-commit Ready/manual cloud ownership, global output collisions, exact read-back before ack, retirement generations,
  cap 600.

## DT-7C-1-R1 - immutable inputs before asynchronous validation (18 Oct 2026, local, unactivated)

Codex findings 7C1-1 and 7C1-2, both in the same two pure modules; no store, transport, UI or config change.

- `parseAnswer` takes one detached JSON copy of the request and every nested expectation (expected body, digest, version,
  output ids, submit body) before its first await, and validates, binds and returns only from that copy. Caller objects are
  never frozen or modified; an explicit `undefined` optional key still means "absent"; a request that is not plain data is
  `invalid / request`. Editing a request while receipt digests are pending can therefore neither certify a receipt that did
  not match at the call nor spoil one that did.
- `previewCloudRun` validates a detached copy of the body (`checkBody` returns the object it is given) and builds every step
  and the final metadata (occurrence id, executionAt, input day, plan context, action order) from it, so actions appended
  after validation cannot bypass the five-action bound. Callers need not pass frozen objects; nothing is truncated or widened.
- Tests: held-digest regressions in `cloudWorkflowProtocol.wire.test.ts` (real router/coordinator receipts: submit, status,
  run, cancel, compact feed) and `cloudWorkflowSnapshot.test.ts`; the Codex probes pass unchanged.
- Still C2 (not part of this repair): `Parsed.authority` must stay attached to proofs and requests when transport and
  persistence are added; the pure helpers do not prove a network destination.

## DT-7C-2A - durable cloud-workflow journal and recovery records (18 Oct 2026, local, unactivated)

A browser-store kernel only: nothing sends, routes, adopts, acknowledges or schedules. No Ready/manual routing, opt-in,
transport, draft materialization, ack, cursor, retirement or schedule (C2B/C2C).

- `lib/cloudWorkflowJournal.ts` (pure): entries keyed by the protocol's canonical `occurrenceKey(origin, ownerKey,
  occurrenceId)`, each with its original authority, the immutable admitted body (Worker validator at its own executionAt)
  and digest, executionAt, a local commit token and a derived local state (`queued` / `suppressed`). Observations keep the
  complete `Parsed.authority`, a request binding (kind, ownerKey, occurrenceId, digest) and the full receipt as plain JSON;
  they are accepted only after `verifyObservation` re-parses them through the pinned `parseAnswer` as a status row bound
  to the entry's own body and digest (no cast, no saved flag; a compact feed item is never a receipt; nothing is marked
  delivered or ackable; the projection never hands out a parser-branded receipt). Newer receipt versions replace older,
  older never replace newer, an equal-version difference is a conflict except that an acknowledgement only adds.
  Suppression `{epoch, resetAt, commitId}` is monotonic; the import merge takes the maximum epoch and the maximum resetAt
  independently. Capacity 600 with no eviction.
- `store/index.ts`: an opaque `cloudJournal` slice (a malformed journal never makes the rest of the save unreadable and is
  kept verbatim; every reader parses it strictly and fails as `journal-unreadable`, never as empty).
  `enqueueCloudOccurrence(origin, body)` and `observeCloudReceipt(parsed, request)` validate, detach and hash before the
  lock, then commit through the existing `commitFresh` (shared `3z-prod-articles` Web Lock, fresh rehydration, exact
  canonical read-back of the journal, rollback). The enqueue base (suppression epoch) is captured before validation, so a
  reset or restore meanwhile invalidates it (`stale`). A rollback after a failed read-back never writes over a newer
  journal another writer left. `reset(now)` is awaitable (`{ok, retained}` or `not-persisted` / `journal-unreadable`),
  keeps the journal and advances suppression in the same locked write, proven by read-back. `importState` revalidates a
  backup's journal (digests, parser) before the lock and merges it into the fresh durable journal under it
  (`journal-conflict` with keys, `journal-capacity`, `journal-invalid`, `journal-unreadable`); a backup without the slice
  keeps the device journal; the Inbox-control restore merge is unchanged. `loadCloudJournal()` is the revalidated,
  plain-data projection.
- Eligibility: an over-limit context/body is `too-large` (never truncated), a cloud-only output limit (4,000 UTF-16 units)
  is `limitation` with the failing action, built prefix and skipped suffix; nothing is written on refusal. Local
  workflows, Ready routing and DT-5 are unchanged.
- Settings: reset and restore wait for the result with a busy Confirm (`settings.resetBusy` / `importBusy`); a second
  Confirm or a Cancel does nothing while it runs; a failed save is never shown as done (`settings.resetNotSaved`,
  `journalUnreadable`, `importJournalRefused`, `importJournalFull`); with kept cloud records the confirmation says they stay
  and remote work is not cancelled (`settings.resetRetained`, `resetOkRetained`).
- Planner ruling (same packet): every persist write passes through a journal guard in the persist storage
  (`journalForSave` = the import merge in `keep-fresh` mode): an ordinary save from a stale tab keeps the stored journal
  (entries, higher receipt versions, stored side of a conflict, max epoch and max resetAt; an unreadable stored journal is
  never replaced); locked commits, resets and restores write exactly their own journal. Without Web Locks a reset or
  restore that would write the journal refuses as `unsupported-save` (Settings: not saved); a reset with no journal entries
  and a restore without the slice still run and leave the stored slice untouched; a reset on a device with no save writes
  no journal. Ceilings: a payload that is not JSON at all is still overwritten by an ordinary save (no slice to keep); one
  extra parse of the stored payload per save. No browser (server render) = memory-only store.
- Search before building: in-repo reuse only (protocol/snapshot helpers, `commitFresh`, the restore merge); no dependency.
- DT-7C-2A-R1 (18 Oct 2026; supersedes the journal-guard bullet above): every write of the store key is serialized under
  `3z-prod-articles`. Ordinary saves never author journal bytes: memory (UI) changes at once and the save is a queued,
  coalesced lock task that reads storage fresh and writes the latest memory with the stored journal bytes verbatim; a
  lock holder first writes this tab's pending save (no second acquisition). Locked commits/reset/restore write their own
  patch (`writeHeld`). Unreadable storage (throwing read, non-JSON, `null`, array, missing/non-object `state`, or journal
  bytes that would not round-trip) is never written over: ordinary saves are refused (`saveStatus`; Settings shows
  `settings.saveFailed`) and journal actions answer `journal-unreadable`; a readable legacy save without the journal still
  works. Identical receipts via Submit/Run/Cancel and Status are the same proof (first provenance kept). A failed restore
  rebuilds its rollback from storage read under the lock and writes it back only if its own write landed. `journalForSave`
  and the merge's `keep-fresh` mode are removed. Residuals: a queued save is lost if the tab closes before the lock is
  granted; while a save waits, ordinary fields are last-writer-wins at execution (journal bytes always fresh); Web Locks
  are relied on to order localStorage access between tabs.
- DT-7C-2A-R2 (18 Oct 2026; replaces the R1 last-writer-wins residual): a queued ordinary save no longer writes this
  tab's whole memory. Inside the lock it applies only this tab's own changes onto what storage holds: a three-way merge
  against the state this tab last knew (memory and storage at the last rehydrate or own write). Slices only locked paths
  write (articles, workflows, workflow runs, Business Kit, deals, Inbox drafts, send handles and controls, the journal)
  are taken from storage verbatim; a newer reset/import epoch in storage is kept; other slices merge per key and per
  list element (`id`, else content), so another tab's committed article, Inbox handle, job id, deletion or reset is never
  undone, and memory then reloads what was written. No new key, schema or migration.
- DT-7C-2A-C1 (18 Oct 2026): the merge base taken on hydration now pairs memory with the exact payload that hydration
  read (one storage read; a payload the schema rejects records no base), so another tab's commit landing mid-hydration
  is never treated as already known. Lists merge by their real logical identity, from their own actions and helpers:
  social accounts by platform, snapshots by platform + day, post stats by platform + post id, demographics as whole
  platform/day/dimension groups, completions, reviews, drills, saved refs, inspirations, followed formats and trend
  sources by their natural keys (one row survives; this tab's on a conflict); format observations/queue, Discover
  feedback and the candidate fallback through their own helpers' revision/date/evidence/cap rules; recent topics as one
  list; `id` lists and primitive sets unchanged. No new key, schema or migration.
- DT-7C-2A-C1-R1 (18 Oct 2026): the four helper-normalized lists (Discover feedback, format observations, format queue,
  the candidate fallback) now decide membership by their own logical identity, against both bases, before their helper
  normalizes: a row another tab cleared or a reset removed stays removed even if this tab edited it (identities: a
  creator hide per creator; every other vote per genre + platform + canonical post; observations per target key +
  canonical URL; the queue per full target snapshot + canonical URL; candidates per genre + platform + canonical URL).
  A surviving identity's versions go to the unchanged helper (latest feedback, newest observation revision, original
  queue date, better candidate evidence); a local deletion still yields to a newer durable update. No new key or schema.

## DT-7C-2B-1 - browser transport/session foundation (18 Oct 2026, local, unactivated, unconsumed)

`lib/cloudWorkflowClient.ts` (no importer, no store/journal/UI/Worker use; importing or constructing it makes no request
and never touches the global fetch). `createCloudWorkflowSession({ fetch })` returns `configure({ origin, token })`,
`invalidateVisit()`, `dispose()`, `handshake()` and `execute(request, authority)` over authority, register, update,
pause, resume, unregister, submit, status, run and cancel (ack/changes refused in the type and at run time).

- Authority comes only from a valid handshake answer; `execute` needs the originating Authority (origin + ownerKey) to
  equal it, and the request's ownerKey (a submit body's too) to match, else zero fetch; never retargeted.
- Fences: configuration generation (any actual origin/token change), visit generation (explicit invalidation, even back to
  the same target), a latest-action sequence and dispose, captured synchronously with a detached request (the protocol's
  `detachRequest`, now exported - the one recorded exception) and rechecked after every await, before fetch, after each
  streamed chunk, after the parser's digest checks and before returning. A newer action/change/dispose also aborts the
  older request's signal (best effort: a POST that was invoked stays `dispatched`, so a stale or uncertain mutation is
  never proof of "not applied").
- HTTP: captured canonical origin + the descriptor's fixed path, `Authorization: Bearer`, credentials omit, cache
  no-store, redirect manual; redirects and a different final URL are uncertain. Exact UTF-8 request <= 32,768 bytes
  before fetch. Response read as a bounded stream (RESPONSE_BYTES_MAX 1 MiB, Content-Length ignored, reader cancelled on
  overflow/abort/fence) under one 15 s deadline for network + body; JSON parsed only after the whole body.
- Results: `refused` (zero fetch) | `answer` (the parser's complete result incl. Parsed.authority, a typed refusal
  unchanged and never labelled retry-safe, request binding, dispatch metadata) | `uncertain` (network, timeout, abort,
  redirect, oversized, malformed, invalid/mixed answer, receipt_unavailable after a POST) | `stale`. No retry, replay,
  implicit handshake or fallback host.
- Size proof: the largest full receipt the pinned validators admit (16 KiB body, five costliest post outputs of control
  characters at 6 JSON bytes per unit) is 351,087 bytes, about a third of the 1 MiB cap (analytic bound 356,834).
- Open: registration uncertainty is only reported (no read-only registration route; pause/resume do not advance the
  revision). Durable registration intent/recovery, ownership, adoption, ack, feed and cursor belong to C2B/C2C.
- DT-7C-2B-1-R1 repairs (18 Oct 2026, still unconsumed): the originating identity (not disposed, configuration object,
  `configGen`, `visitGen`, installed authority, latest-action sequence) is captured synchronously at the entry of
  `execute`/`handshake`, BEFORE the caller's authority fields or request accessors run; after planning, and immediately
  before fetch, the same identity must still hold, otherwise the call resolves `refused` (`disposed` or the new
  `superseded`) with zero fetch, never a raw TypeError (a synchronous throw while planning is `invalid_request`). A newer
  action is never aborted or overwritten by the older call finishing its capture; a refused call still supersedes
  nothing. The fence is rechecked right after the last bounded read, before decoding, so a late invalidation is `stale`
  (dispatched/original authority kept, no retry) and malformed JSON/UTF-8 is `uncertain` only while current. The fetch
  `guard` observes both eventual outcomes in every branch, including an already-aborted signal: a late response body is
  cancelled fire-and-forget (never awaited), a late rejection is swallowed. The negative `ack`/`changes` type assertions
  are short assignments directly under their `@ts-expect-error`, so formatting cannot detach them.

## DT-7C-2B-2 - durable registration intent and exact recovery (18 Oct 2026, local, unactivated, unconsumed)

`lib/cloudWorkflowRegistration.ts` (pure), `lib/cloudWorkflowRegistrationClient.ts` (controller; no importer) and the
store's new opaque `cloudRegistrations` slice (`cloudRegistrationPersistence`; nothing in the app calls it). Register
and unregister only; records describe observed registration, never ownership or delivery.

- Key = canonical origin + server ownerKey + workflow id. One record per key: an immutable intent (seq, operation id,
  created time, the exact validated request, its descriptor path/body, revision, digest) with its progress (pending,
  dispatching, settled, uncertain, refused, divergent; attempts; maybeApplied; the deciding wire answer) and the newest
  bound registration observation (monotonic; equal order with other content is a contradiction). No token, fingerprint
  or header is stored. One unresolved intent per key; 100 keys, a new key at the cap is refused, no eviction.
- Order: capture (detached request, plain authority, generations) -> verified durable read -> locked CAS create
  (pending, exact read-back) -> locked CAS reservation -> one execute -> the outcome written to its original intent by
  CAS. Failed/unsupported/unreadable persistence sends nothing. Fences: configuration (A-B-A included), visit, dispose,
  installed authority, latest action; a moved fence before execute sends nothing, after it the caller gets `stale`.
- A typed refusal never clears an earlier uncertainty; a conflict is `divergent` (unresolved while an earlier attempt
  may have applied); only a bound ok answer for the identical request settles. Explicit recovery replays the identical
  stored request after a new matching handshake and a durable reservation; nothing replays by itself (construction,
  reload, hydration, import, reset, network error). Two tabs cannot reserve from the same base.
- Proven with the real router/SQLite coordinator behind a fake transport: an identical register while active answers the
  same epoch; an old expectedEpoch cannot open a later epoch; an unregister bound to its epoch/revision cannot touch a
  newer epoch; originals delayed in transit until after the recovery and after a newer lifecycle change nothing.
- Store: locked-only for ordinary saves (stored bytes verbatim, absent stays absent); every other commit (articles,
  journal) keeps its stored bytes and its own commits keep the journal's; reset keeps it exactly; workflow removal leaves
  it; private export includes it; import revalidates (pinned parser) and merges monotonically (older backups cannot
  resurrect a settled decision, local unresolved work is preserved, identity contradictions and an overflowing union
  refuse with nothing changed; refusals reuse the journal reasons with `scope: "registrations"`); the public kit
  projection never reads it.
- Open: no UI, opt-in, update/pause/resume, ownership, adoption/ack/feed or scheduling. Cross-tab, a tab may recover an
  intent another live tab is still dispatching (both send the identical request, which the coordinator answers
  idempotently). A divergent intent with an uncertain earlier attempt blocks new intents on its key until a later,
  reviewed resolution path exists.

## DT-7C-2B-2-R1 - registration import and obsolete-result repairs (18 Oct 2026, local, unactivated, unconsumed)

- Import: a backup that carries the registration slice now verifies the device's CURRENT slice too, through the same
  pinned check as the backup, as read under the `3z-prod-articles` lock; the merge then accepts only those exact bytes.
  An invalid current proof, or a slice that changed after that read, refuses (`journal-invalid`, `scope:
  "registrations"`) with nothing written. A backup without the slice still leaves the device's bytes exactly as they are.
- Controller: when another tab settled an operation and replaced it with a newer intent on the same key before the old
  answer arrived, the old call now returns `stale` (nothing recorded, the newer record untouched) instead of
  `recorded`/`dispatching`. A late outcome for the same operation still adopts its newer proven state; a failed write is
  still `persisted: false`. The result type is unchanged.

## DT-7C-2B-3 - ownership-aware trigger capture for Manual and Ready (18 Oct 2026, local, unactivated, unconsumed)

- A NEW Manual/Ready trigger belongs to one executor. `lib/cloudWorkflowCapture.ts` (pure) derives ownership from every
  registration record of the workflow across authorities (re-verified through the pinned parser first), the journal and
  the configured canonical origin (`settings.apiKeys.scoutUrl`; the token is never read): no evidence, or every
  lifecycle proven inactive (settled unregister, or a typed refusal with no active observation) = local; one settled
  active registration at the configured origin = cloud at its authority/epoch/revision; anything unresolved, divergent,
  inconsistent (settled answer != latest observation), refused while the last observation is active (a failed unregister
  keeps its prior active proof), unreadable, multiple-active, unconfigured, foreign-worker or journal-only (entries at an
  authority with no record for the workflow) = blocked. Proven unregister changes future triggers only; old journal
  entries stay cloud and never enter local retry/drain/history.
- `workflowDigestOf({name, trigger, actions})` = SHA-256 hex of canonical JSON over exactly the builder's allowlisted
  executable snapshot (id, revision, enabled, commitId, timestamps, unknown fields excluded). Vectors: manual
  `{"actions":[{"id":"a1","kind":"idea","text":{"ar":"","en":"Idea {date}"}}],"name":{"ar":"تجربة","en":"Flow"},"trigger":{"kind":"manual"}}`
  = `a3f21b155ecb1fdf1a69e9000ef7caa2fc417c9819a826ec34f95adc122df346`; the article-ready post + plan vector in
  `lib/cloudWorkflowCapture.test.ts` = `5000f6ffcfb13d803f418338693fc14d4f79f4ac1e5e287f2f38681375d66aed`. Cloud
  capture binds the body's snapshot digest, the workflow revision, an unpaused registration and an executionAt inside
  the named open epoch (no skew correction); anything else refuses (`definition-mismatch` / `registration-paused` /
  `chronology`). Nothing re-registers.
- Store (additive, unconsumed by the UI): `captureManualRun(workflowId, {authority?, articleId?}, now?)` and
  `captureArticleReady(articleId, {authority?}, now?)` return `local` / `cloud` / `ready` / `unchanged` or a typed
  `refused` (reason + workflowId + detail: ownership cause, snapshot refusal, cloud limitation). Inputs are detached and
  the occurrence id / Ready commit id / execution instant minted before the first await; bounded async work (verify,
  builder, digest, journal preflight), then ONE `commitFresh` that recomputes every dependency canonically (articles
  generation, library epoch, workflow(s) incl. commit ids, Ready member set, article commit/status, lang, origin,
  planner inputs, whole registration slice, journal generation/commit/suppression) and refuses `stale` with zero writes
  and no retry. Ready writes the article, every local run and every cloud entry (`readyOccurrenceId(workflow, article,
  readyCommitId)`) in one patch with a combined exact read-back; any refusing member refuses the whole transition;
  already ready is a no-op; two tabs give one Ready event and one `stale`. Journal admission is all-or-nothing (600, no
  eviction, identical keys idempotent, changed digest conflicts). Cloud Manual supports manual-trigger workflows only
  (`manual-on-ready`). A cloud success is a journal-entry projection (identity only), never a WorkflowRun.
- Legacy entry points keep their shapes and in-lock fresh behaviour plus one additive refusal each: `runWorkflowNow` ->
  `not-local`, `setArticleStatus(..., "ready")` -> `workflow-not-local` (whole transition) when a participating workflow
  is not provably local. Copy: `workflows.runError.not-local`, `website.readyBlocked` (EN/AR). No cloud control in the UI.
- Open: UI opt-in/recovery + immutable submission, HTTPS-only (except loopback) before bearer activation, visible limits
  and capacity copy, adoption/proof/ack, scheduling. A local pause + resume bumps the workflow revision, so a registered
  workflow then refuses as `definition-mismatch` until a reviewed re-registration path exists. Capture prepares from this
  tab's memory: a tab that has not yet heard another tab's change refuses `stale` (honest, never retried).
- DT-7C-2B-3-R1 (18 Oct 2026, repair): (1) ownership needs lifecycle proof, not record presence. An inactive record
  discharges its authority's journal history for this workflow only when its newest bound observation is an
  unregistered registration whose closed epoch history names every entry's epoch with the entry's executionAt inside
  that closed interval (both ends inclusive); a refused first registration (no lifecycle) beside same-authority history
  is `journal-only`, an older closed epoch versus a newer entry epoch or an entry outside its interval is
  `inconsistent` (both blocked; history never rewritten). Active current registration with earlier-epoch entries stays
  cloud; workflows resolve independently. Legacy Run now / Mark ready inherit this through the same resolver.
  (2) Each capture reads the caller's Date once, before any await, and builds every member (article time, local input
  Riyadh day and run time, cloud executionAt, Ready ids) from that private instant; mutating the Date later changes
  nothing. (3) A capture succeeds (and drains) only when storage holds exactly the article, every local run and the
  journal it wrote (canonical record equality, not commit ids); a failed read-back puts back only records it still owns
  (its commit ids, the journal exactly as written) and keeps another commit, deletion or newer journal, then reloads.
  Carried, not fixed: a settings origin A-to-B-to-A while a capture waits coalesces undetected (no origin generation
  marker); a reviewed config/visit generation must fence it before any production capture/dispatch consumer. A client
  clock ahead of the Worker can leave an old entry after its epoch's close and so block future local triggers after a
  genuine unregister (conservative; recovery belongs to the later UI recovery path).
- DT-7C-2B-4 (18 Oct 2026, unconsumed, unactivated): saved-occurrence delivery. `lib/cloudWorkflowOccurrenceClient.ts`
  `createOccurrenceController({fetch, persistence})`: explicit `submit / status / run / cancel(key)` of one journal entry.
  Requests come only from the saved entry (Submit = its body + digest; Status/Run/Cancel = its owner + id with
  `expect: {body, payloadDigest}`), to the authority this controller's handshake installed, which must equal the entry's
  (`foreign_origin` / `foreign_owner` otherwise, zero requests, never retargeted). Results: `refused` (nothing sent) |
  `answered` (complete parsed answer; typed refusals kept) | `unconfirmed` (sent, no usable answer — never "failed" or
  "not delivered"; an explicit identical Submit converges through Worker idempotency) | `stale` (a fence moved: no
  current-action claim; a bound receipt may still be recorded on its own entry). Receipts are recorded only through the
  accepted `observeCloudReceipt`; `recorded` is its exact committed result (`persisted: false` + reason otherwise), null
  when the answer has no receipt (status `absent` / `pruned` stay distinct, nothing discarded). Reset policy: a
  suppressed entry refuses Submit and Run; Check status and Cancel stay available and keep it suppressed. Never: chained
  Run/Cancel, retry, polling, feed, adoption, ack, local execution, action on construction/hydration/import/reset/
  reconnect/error. Store: `readCloudOccurrence(key)` (verified reader: fresh durable entry by full key, detached frozen
  body + identity, digest re-verified, same snapshot rechecked under the shared lock, else `moved`),
  `cloudOccurrencePersistence` (the locked same-snapshot check immediately before dispatch; the session's fetch starts
  synchronously inside that hold), `cloudFence()` / `invalidateCloudVisit()`: an in-memory configuration generation moved
  by a synchronous store observer on every origin/token transition (setters, direct updates, import, reset, rehydration;
  A→B→A moves it twice; never persisted) and a visit generation. Existing captures now take config + visit + latest
  action per target at entry and recheck after every await and first inside the locked commit (`stale`, zero writes);
  the controller does the same and needs a new handshake after any fence move. Transport: `configure` accepts only
  `transportOrigin` — HTTPS, or HTTP on exactly `localhost` / `127.0.0.1` / `[::1]` as spelled (`insecure` otherwise:
  lookalikes, `127.1`, `[0:0::1]`, `localhost.`); stored/imported authorities are unchanged and simply cannot be
  transported. Open: C2C adoption/proof/ack, the UI integration packet, scheduling.
- DT-7C-2B-4-R1 (18 Oct 2026, unconsumed): the occurrence controller's every result exit after an await (uncertain,
  session-stale/refused, answered) re-checks the originating controller/store fence. A moved fence returns the existing
  `stale` with the original action/key and the truthful dispatched fact (an invoked POST stays dispatched, never
  relabelled refused/not sent); network loss, malformed JSON, invalid answer and `receipt_unavailable` after a store visit
  invalidation, a token A-B-A or a newer action waiting on its durable read are therefore `stale`, not a current
  `unconfirmed`. Unchanged-context uncertainty stays `unconfirmed`, typed refusals stay typed, a valid bound late receipt is
  still recorded on its own entry (caller gets `stale` + the exact `recorded`, `persisted: false` on storage failure). A
  store dispatch that throws after the request started is treated as dispatched. No retry, status poll, journal erasure,
  new id, result union, storage field, observer or controller API.

## DT-7C-2C - cloud output adoption, durable proof and acknowledgment (18 Oct 2026, local, unactivated, unconsumed)

Completes browser reconciliation; nothing in production constructs the controller and no UI reads the proof yet.

- Modules: `lib/cloudWorkflowReconciliation.ts` (pure proof/merge kernel) and `lib/cloudWorkflowReconciliationClient.ts`
  (explicit controller over the accepted session); `store/index.ts` adds the opaque `cloudReconciliation` slice and
  `cloudReconciliationPersistence`. The session now admits `ack` (POST) and `changes` (GET) under the same fences and
  bounds. Journal gained `withoutEntry` (retirement only). Protocol, capture, registration, occurrence controller,
  snapshot, builders, Worker, UI and packages unchanged.
- Proof (per authority + occurrence): immutable binding (`journal` or `remote-initial`, digest, workflow, first version),
  the latest full receipt re-parsed through the pinned parser before every use, reset epoch, commit token and one
  disposition per terminal output: adopted / retained (edited) / deleted / suppressed / collision. Outputs are adopted
  byte-exact only from a verified TERMINAL full status (incl. done steps of partial/failed); nonterminal receipts are bound
  and projected only. An owned id is never adopted twice, a deleted one never returns, an unowned local or foreign-owned
  `wf:` id is a collision (nothing written, no ack). The `cloudWorkflowRuns` projection is `cloudReconciliation.runs`
  (own schema, ≤ 200 by oldest terminal; proof is independent of it).
- Feed: one `changes` page (≤ 50) per explicit call, at most one status per item, each item's durable result or pending
  record committed together with the cursor advance; proof-full / moved fence / persistence failure stop with the cursor
  unchanged; transport loss is pending and stops. Later completions are found by `change_seq`.
- Deletion evidence is captured in the same locked write as the removal: ordinary queued saves (`runPendingSave`, so
  `removeIdea`/`removePost`/`removePlanItem`/`setPlanItems` keep their sync void contracts), import (backup drafts
  with deleted ids dropped) and reset; any unhooked removal is recorded at the next commit.
- Commit: one `commitFresh` per item writing outputs + proof (+ journal on retirement), exact read-back of the slice and
  each adopted record; a failed read-back writes no rollback (memory reloads storage). Ack: built only by `ackRequestFor`
  from the snapshot's parser-branded receipt after a locked eligibility re-check, started inside the hold, never awaited
  there; nothing is written from an ack answer; a lost ack is `unconfirmed` and is checked or repeated explicitly.
- Retirement: only a bound fresh `pruned` status with the same digest; the proof becomes a compact tombstone (≤ 100,
  oldest evicted) and the authority's retirement generation advances, so every held receipt or ack captured before it is
  stale; the journal entry is removed only when ownership resolution is unchanged without it. Proofs + tombstones ≤ 600:
  a new proof at the cap is `proof-full` (pause), never eviction.
- Import merges the slice monotonically (current slice verified under the lock, imported proofs before it; scope
  `reconciliation` for refusals); legacy backups keep the device's slice; reset keeps it and records the cleared outputs
  as deleted. Private export carries it; the public kit projection never reads it.
- Search before building: no library fits a single-key localStorage proof under one Web Lock with the accepted parser;
  everything reuses in-repo helpers (`compareObservations`, `commitFresh`, the pinned parser, domain schemas).
- Open: the dashboard integration packet (opt-in, recovery/reconciliation UI, visible limits and copy), DT-7D/E, purge
  maintenance, e2e lock proof in a real browser (store harness used instead), export freshness carried to integration.

### DT-7C-2C-R1 (18 Oct 2026): deletion and reset evidence survive retirement and import

- A tombstone keeps compact ownership: `owned` (outputs still present at retirement) and `deleted` ids, plus the retired
  terminal receipt's final `changeSeq` (`null` for a nonterminal proof, pending item or journal-only retirement, which own
  no outputs). Every removal path (ordinary queued save, reset, import) moves a removed tombstone-owned id to `deleted`
  in the same write; dirty retained drafts are never deleted because their proof retired; tombstone-owned ids still
  collide for any other proof or authority.
- No tombstone is evicted. Beyond 100 one folds into the authority's `watermark` (resolved first, then lowest
  `changeSeq`): sound because a terminal Worker row never changes again and only terminal rows are pruned, so every
  receipt of a folded occurrence has `changeSeq ≤ watermark`. Nothing foldable: retirement refuses `retirement-full`
  (nothing written; the page stops with that reason). Import refuses as retired (result `retired: [keys]`) an imported
  proof not live locally, or an imported-only tombstone, at or below the watermark; their ids, and those of tombstones
  folded during the import, are not restored unless present now. Fresh status rows are not watermark-checked (a row proves
  the occurrence was never pruned). Recovery for a live occurrence refused this way: an explicit `check(key)`.
- Import applies the merged journal reset to every proof whose outputs come from the backup (`executionAt ≤ resetAt` ⇒
  `suppressed`, drafts not restored); unrelated drafts, post-reset work and local proofs that already own outputs are
  unchanged. A reconciliation-bearing import with an unreadable journal refuses (`journal-unreadable`, scope
  `reconciliation`).
- Formats: the slice stays `v: 1` with optional `owned` / `changeSeq` / `watermark`; C2C-format slices and backups
  parse (no recorded ownership, never folding). Known bound: an output released by folding a tombstone that still owned
  it becomes an ordinary draft; a backup taken after that fold restores it like any ordinary draft.
- Real-builder partial/failed receipts (an empty bilingual idea text fails the shared builder) are adopted and acked in
  the store suite; no Worker/builder change.


### DT-7C-2C-C1 — Codex implementation, 18 October 2026 (supersedes R1 folding)

The owner explicitly reassigned implementation to Codex; Claude remains idle. This is local repair, not cloud activation or independent review of Codex's own code.

- Retirement retains every marker and output identity. At 100 tombstones a further retirement returns retirement-full without a write and keeps its live proof/journal. No folding, eviction or bound increase. Imports with a union above 100 refuse. Proofs plus markers remain bounded at 600; capacity needs an explicit future UI/recovery path.
- Existing nonzero watermarks remain readable but cannot reconstruct discarded ownership. Restores involving them refuse without a write, including a legacy backup lacking reconciliation when the device has a watermark. First status adoption at/below the watermark refuses retired; a complete existing proof stays usable. No automatic clearing/migration or inferred delivery.
- Retired markers carry optional executionAt from the verified receipt body. First-learned imported markers obey the merged reset: pre-reset or unknown-time owned outputs become deleted; known post-reset work and unrelated ordinary drafts remain. Unknown ownership plus a relevant reset refuses instead of guessing. Conflicting known execution times refuse. An unreadable reset journal refuses retired-only backups as well as live proofs.
- Tests: initial five store regressions RED, then GREEN; an additional unreadable-journal regression RED then GREEN. Old folding expectations were deliberately replaced with refuse-at-capacity expectations; prior evidence is preserved. Final full app suite 211 files / 4354 tests passed; targeted reconciliation/Settings 91 passed; nonincremental TypeScript, lint, formatting and build passed. Worker 192 and builder pins remain unchanged; no repeated Worker suite.
- Installed Chrome 155.0.8059.82: 12/12 synthetic Settings export/import checks in EN/AR desktop/phone using genuine Export files, real Web Locks and external-request blocking. First run 10/12: the two English cases expected an English toast after reset had restored Arabic; test setup now explicitly selects English before import, no product change. Tests are maintained in e2e/workflow-reconciliation.spec.ts. They exercise Settings only, not yet the unconsumed cloud controller UI.
- Local preview on localhost:3000 is left running at the owner's browsing request. Seven served pages equal the rebuilt out/ files. No Claude task, deployment, grant, provisioning, live send, push or merge. Integration, schedule/activity, purge maintenance, live readiness, TikTok Inbox and the broader backlog remain open.

Evidence: C:/Users/AORUS/.codex/review-evidence/dashboard-tools/dt7c2c-c1/REPORT.md. Historical sections above retain the superseded design; this section is current.

## DT-7C-3A - browser hub (22 Oct 2026, local, unactivated, not yet used by any screen)

- `lib/cloudWorkflowHub.ts`: `cloudHub()` is the one browser place that holds the three controllers (registration,
  occurrence, reconciliation). They share one plain-function `window.fetch` and use the store's persistence adapters. It
  is created on the first call, never at import. Without a browser it returns an inert hub that refuses every action with
  `no-browser`. The UI reads `view()` (configured origin or reason, authority, handshake state, busy keys, last result per
  key) and `subscribe()`s to it. It also has read-only selectors that parse the stored slices through the pinned modules:
  registrations, counts (registrations / proofs / retired markers / pending / cloud runs / journal) and cloud runs.
- Configuration follows Settings: `configure()` runs on all three at creation and on every Scout URL/token change (one
  store subscription). Only the origin or the refusal reason is kept; the token is never stored in the hub.
- `lifecycleRequestFor` (planner ruling 3A-1, in `lib/cloudWorkflowRegistration.ts`) builds the next register/unregister
  request from the key's lifecycle proof. No proof: register at epoch 0. Unregistered: its epoch. Active: register is
  refused (`active`); unregister binds that epoch, revision and digest. An unresolved intent
  (`isUnresolved`, the same gate as `createIntent`; ruling 3A-1 amended) is refused (`unresolved`: recover first). It
  matches the Worker's CAS rule. Unregister builds from the verified stored proof only, so a workflow deleted locally while
  on the cloud can still be taken off.
- Never: a handshake on load, polling, retry, a chained action (submit never runs; reconcile never acks), a request at
  creation or on configure, or the token in the view. Every action is exactly one controller call. `pagehide` moves the
  store visit fence and disposes the hub. `leaveCloudScreen()` moves the visit fence and invalidates every controller
  visit. The Worker's workflow Durable Object is still not provisioned or deployed.

## DT-7C-3 — coherent dashboard integration (22 Oct 2026, local, unactivated)

The cloud controllers are reachable from the dashboard: `lib/cloudWorkflowHub.ts` (one browser hub, explicit actions only),
the Workflows Cloud card and Cloud results card (`components/social/workflows/WorkflowCloud.tsx`), Mark ready through
`captureArticleReady`, and the Settings Cloud workflows card with the limits (100 registrations, 600 delivery records,
100 retired markers, 4,000-unit output, 8 KiB context, 16 KiB body). Proven in installed Chrome EN/AR against the real
Worker router on `node:sqlite` (`e2e/workflow-cloud.spec.ts`). Still not activated: the workflow Durable Object is not
provisioned/deployed, so Check connection against the live Worker answers "not available there yet". Record and hashes:
`planning/collaboration/dashboard-remaining-tools-handoff.md` "Freeze DT-7C-3". Reviewer: Claude (owner instruction).
