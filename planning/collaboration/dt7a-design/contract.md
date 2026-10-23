# DT-7A — durable cloud workflow execution contract (design only, revision R1)

Status: proposal for Codex review, 17 Oct 2026, revised for findings 7A-1 … 7A-8. No code exists for anything below.
The DT-4 browser executor stays the only runner until a reviewed slice lands. The DT-5 mapping and the draft-only
boundary (accepted in the DT-7A review) are unchanged. DT-6 live identity/grants/cutover remain open and untouched.

**DT-7B amendments (Codex DT-7A-R1 review, binding; implemented locally in DT-7B, see planning/tools/38-cloud-workflows.md).**
Where the text below differs, these rulings win:
1. *Ack/retention* — only the exact current terminal receipt version acknowledges (future → refused, lower → no-op,
   nonterminal/absent/pruned → own replies); `firstAckAt` stored once (Worker clock); purge at
   `min(finishedAt + 180 d, firstAckAt + 90 d)` when acknowledged, else `finishedAt + 180 d`; nonterminal never purged;
   permanent tombstones; ack bumps neither receipt version nor change sequence. Replaces the `max(acked_version)` rule.
2. *Pause/resume* — the workflow registration row's retained `paused` flag gates every epoch's first pending → running
   step inside that step's transaction (delayed old-epoch work included); paused submits stay pending; resume releases;
   running occurrences finish; only pause/resume change the flag (unregister/re-register keep it); unregister never
   cancels or moves existing cloud work.
3. *Failure policy* — fail-fast everywhere: a failed step (incl. `context-stale`) skips all later steps; earlier outputs
   survive; `partial` only when an earlier step succeeded, else `failed`. Replaces §4's former "idea/post steps still run".
4. *Authority/CAS* — one fixed server-selected object (`workflows|owner`); `ownerKey` minted once in durable meta and
   stable across restarts and normal deployments (not "per deployment"); CAS binds `registrationEpoch` + revision;
   every epoch keeps its opened/closed cutoff; unknown epochs refused; register carries `expectedEpoch` so a lost
   register/re-register answer never mints another epoch. The update route is `POST …/registrations/:id` (the Worker's
   CORS answer allows GET, POST, DELETE only), not PUT.
5. *Exact bodies* — server-recomputed digest over the canonical allowlisted body (digest field excluded; vectors in
   `workflowProtocol.test.ts`); strict bounded schema; exact stored body/executionAt; step = next pending index + all
   prior steps done + current receipt version + captured digest, in one SQLite transaction; async digest work outside,
   rechecked inside; finish refuses with pending steps.
6. *Feed/status* — latest-receipt change feed (may coalesce); durable sequence per transition; `nextAfter` = last
   returned seq (or `after` when empty), `more` = a later row existed; full status keeps ownerKey, occurrenceId, exact
   body incl. executionAt, payload digest, receiptVersion and typed step/output proof; absent/pruned/errors distinct and
   authority-bound; outputs allowlisted drafts only; no caller-supplied output/builder/step on any public route.
7. *DT-7B-R1 repair (Codex DT-7B review, binding; implemented locally).* (a) Admission interval: a NEW occurrence
   needs `opened_at ≤ executionAt ≤ closed_at` of its exact named epoch (closed bound only when closed; integer ms;
   no skew allowance before `opened_at`); before-open → the existing `409 not_registered`, zero mutation; identical
   accepted replays stay `created: false`; a stored `executionAt` is never adjusted, ownership never transferred.
   Future browser work must surface timestamp/admission refusals and capture an admissible triggering instant before
   building its immutable outbox (no browser change in R1). (b) Complete response proof: the public routes re-check
   a receipt's whole body with the admission validator at its own `createdAt`, recompute the payload and output
   record digests, bind identity and the coordinator's state/step/output table; feed items carry typed, linked
   steps/outputs with recomputed draft digests but no body, so a feed item proves no body/target binding (full
   status stays the authority for later reconciliation); mutation success is bound to the request; refusals are the
   operation's own errors with typed, bound extras; anything else is `503 receipt_unavailable`, unechoed.
8. *DT-7B-2 shared-builder execution (planner rulings 1–9, binding; implemented locally, unactivated).* The Worker
   resolves the app's `@/*` imports (tsconfig `paths` + `resolveJsonModule`, a matching vitest alias). The fixed server
   builder `workflowRun.ts` calls the real `lib/workflows.ts` `buildOutput` with the stored body only: action snapshot,
   input, `new Date(executionAt)` as the clock, the planner context projected exactly (§4) plus this occurrence's
   earlier plan outputs in action order; ids `wf:<occurrenceId>:<actionId>`; builder errors unchanged; a plan step
   whose context is missing or of another week fails `context-stale` (fail-fast); a record outside the draft allowlist
   fails `invalid` (never truncated or widened). One internal coordinator op `run` loops inside the object through the
   existing step-CAS (≤ 5 committed steps + 3 stale commits per call; `stopped` terminal | paused | limit | contention);
   one route `POST …/occurrences/:id/run { ownerKey }` with the full-receipt answer proof. No request-selectable
   builder, output, snapshot, clock, retry or toggle. Parity holds only for identical builder/catalog pins
   (`dt7b-candidate/7b2-builder-pins.sha256`); no cross-version equivalence is claimed.

**Carried gates (not proven by DT-7B).** DT-7C: full authority+occurrence keys for local outbox/cursor/proof/runs; fail
closed on a global `wf:` output owned by another authority/digest (no renaming, no false acknowledgement); initial proof
from the immutable triggering executionAt (not delayed admission time); monotonic resetAt + epoch merge across
equal-counter imports; durable retirement generations rejecting held status answers. DT-7D: a CAS-bound registration
execution template/context for scheduled materialization (the registration schema omits it today); bounded
intervals/admission/watermark, no history replay; long-gap fixtures on the supported daily/weekly cadence. DT-7E:
publish jobs use `targets[p].state` (no job-level status); an Effects document timestamp is distinct from its latest
failed save (the first failure may initialize updatedAt, later failures preserve it).

## 0. Local evidence this design builds on

- `Workflow { id, name, trigger: manual|article-ready, actions ≤5 (idea|post|plan), enabled, revision, commitId }`;
  `WorkflowRun` (`store/index.ts` `newRun`, `enqueueRuns`, `drainStep`), `RUNS_MAX = 200`, output id
  `wf:<runId>:<actionId>`, one Web Lock `3z-prod-articles`, Ready enqueue inside the draft → ready commit.
- Each plan step sees earlier committed plan outputs (`drainStep` reads fresh state; `previewRun` folds `planItems`).
- Planner builders: `buildWeekPlan` uses only completions with `dayKey(at) < weekStart` (`lib/weekPlan.ts:229`);
  `applyOverlay` uses rows of the target week incl. `quest`, `by` and minutes-0 tombstones (`overlay.ts:101–115`);
  `buildOutput` derives the week from `input.day` (`lib/workflows.ts:114`).
- DT-5: `publishJobId` maps a workflow post id to `j-<sanitized ≤40>-<sha256[0:24]>`; preserved verbatim.

## 1. Identity, authority and opt-in (7A-6)

| Item | Rule |
| --- | --- |
| Authority | Each cloud object is bound to `authority = { workerOrigin, ownerKey }`: `workerOrigin` = canonical configured Worker origin (lower-case scheme+host+port); `ownerKey` = non-secret server-derived id returned by `GET /social/workflows/authority` (`wfo_` + 32 hex, generated once and stored in the coordinator's durable `meta`; stable across restarts and normal deployments — DT-7B ruling 4). No bearer, token or credential is ever persisted in the outbox or receipts. |
| Fences | Every browser action captures `{ workerOrigin, ownerKey, tokenFingerprint (in-memory only), configEpoch, visit }` once; rechecked after each await and immediately before `fetch`; the response must echo `ownerKey` and every bound id or it is discarded; local commit and ack happen only when the captured fence still matches. A→B→A mints a new visit: held actions never revive. |
| Imported outbox | An outbox entry carries its original `authority`. It is sent only when the current configured authority equals it. A different origin or ownerKey → entry listed as "belongs to another Worker", zero requests, never retargeted. |
| IDs | `workflowId`, `actionId`, `occurrenceId` must match `^[A-Za-z0-9_-]{1,64}$` (no colon). Today's local ids are `newId()` output (alphanumeric); an existing workflow whose ids fail the rule cannot be registered (explicit `unsupported_id`, local execution unchanged). `occurrenceId` prefixes use `-` (`ar-…`, `sc-…`). Output id stays `wf:<occurrenceId>:<actionId>` — unambiguous because neither part may contain `:`. DT-5 format unchanged. |
| Same id, changed payload | Every submit carries `payloadDigest = sha256(canonical JSON of the immutable occurrence body)`. Same `occurrenceId` + same digest → existing row (`created: false`); different digest → `409 conflict`, nothing changed. |
| Opt-in / unregister | `register` makes FUTURE occurrences of that workflow `owner: cloud`. `unregister` makes future ones local; existing cloud occurrences stay cloud (finished or not) and are never transferred to the local executor. Re-register after unregister creates a new `registrationEpoch`; old-epoch outbox entries are still admitted as cloud (they carry their own snapshot, §2). |

## 2. Immutable execution snapshot (7A-1)

Chosen model: **occurrence-owned snapshot**. Each admitted occurrence stores, immutably:

```
occurrence = { occurrenceId, authority.ownerKey, workflowId, kind, registrationEpoch, revision,
  snapshot: { name, trigger, actions },            // exact workflow at the moment of the triggering commit
  plannerContext: { targetWeek, ... } | null,      // §4, null when no plan action
  input: { articleId?, title, summary, slug, skillId?, lang, day },
  executionAt,                                     // ISO time captured with the triggering commit
  payloadDigest }
```

- The browser builds the occurrence in the same `commitFresh` as Ready / Run now (outbox entry = the full immutable
  body + authority, no bearer). The Worker stores it verbatim; it never rebinds an occurrence to a newer registration.
- Registration (`{ workflowId, registrationEpoch, revision, workflowDigest, state }`) only gates admission: an occurrence
  is admitted when `state ∈ {active, paused}` for that epoch, OR when it carries an older epoch/revision (delayed outbox):
  admitted as-is with its own snapshot. `unregistered` (no active epoch) → admitted only if created before unregister
  (`executionAt ≤ unregisteredAt`), else `409 not_registered`. (DT-7B-R1) In every case `executionAt` must also be at
  or after that epoch's own `openedAt`: an event from before the epoch opened is `409 not_registered`, never
  cloud-owned because it names a newly opened epoch.
- Registration update uses CAS on `registrationEpoch` + `revision`: `POST …/registrations/:id { ownerKey, registrationEpoch,
  expectedRevision, revision, workflowDigest }` (DT-7B ruling 4; POST because the Worker's CORS answer has no PUT);
  mismatch → `409 conflict` with the current registration.
- Retention: the snapshot lives with its occurrence (§3 retention); no separate revision store.

Delayed outbox trace: Ready commit creates `ar-X` with revision 1 snapshot; browser offline; owner edits workflow to
revision 2 and registration CAS → 2; outbox later delivers `ar-X` (revision 1, own snapshot) → admitted, executed with
revision 1 actions; next Ready creates `ar-Y` with revision 2.

## 3. Coordinator state machine (7A-2, 7A-3)

One SQLite Durable Object `WorkflowCoordinator` (single owner). Tables:

| Table | Columns (key first) |
| --- | --- |
| `meta` | key, value — `ownerKey`, `changeSeq` (monotonic integer), `purgedAt` |
| `registrations` | workflow_id, registration_epoch, revision, workflow_digest, state `active|paused|unregistered`, schedule_json, watermark_slot, unregistered_at, updated_at |
| `occurrences` | occurrence_id, workflow_id, kind, registration_epoch, revision, body_json, payload_digest, state `pending|running|done|partial|failed|cancelled`, receipt_version, change_seq, created_at, updated_at, finished_at, acked_version |
| `steps` | (occurrence_id, idx), action_id, status `pending|done|failed|skipped`, output_kind, output_id, output_digest, error, at |
| `outputs` | output_id, occurrence_id, action_id, kind, record_json, digest |
| `missed` | (workflow_id, from_slot), to_slot, count — bounded intervals (§6) |
| `tombstones` | occurrence_id, payload_digest, pruned_at |

**Pure transactional step-CAS (no lease).** The executor is synchronous and pure; each step is one transaction:

```
BEGIN;
  SELECT state, receipt_version FROM occurrences WHERE occurrence_id = ?;      -- must be pending|running
  SELECT status FROM steps WHERE occurrence_id = ? AND idx = ?;              -- must be pending
  -- build output from body_json (+ outputs of earlier plan steps, §4) inside the transaction
  INSERT INTO outputs (...) ON CONFLICT(output_id) DO NOTHING;               -- adopt if present
  -- if present: require same (occurrence_id, action_id, kind, digest) else mark step failed 'output-conflict'
  UPDATE steps SET status='done', output_id=?, output_digest=?, at=? WHERE occurrence_id=? AND idx=? AND status='pending';
  UPDATE occurrences SET state='running', receipt_version=receipt_version+1, change_seq=:nextSeq, updated_at=? WHERE occurrence_id=?;
COMMIT;
```

- `runOccurrence(id)` loops `step(idx)` for the first pending idx; when none remain, `finish` (one transaction:
  state → `done|partial|failed` from step statuses, `finished_at`, version+1, changeSeq+1) — only from `running|pending`.
- A failed step: `status='failed', error`, all later pending steps → `skipped` in the same transaction; then finish.
- No `claimed` state: two concurrent resumes both call `step(idx)`; the `WHERE status='pending'` guard lets exactly one
  succeed; the other sees `done` and moves to the next idx (or finish, which is idempotent: a terminal row is returned
  unchanged). A stale executor can never overwrite `done` or a terminal state.
- Cancel: only `pending` with zero done steps → `cancelled` (version+1, changeSeq+1). `running` → `409 running`.
- Zero provider/publish/message effects (draft records only; posts `stage: "idea"`).

Traces: *lost answer to submit* → resend same body → `created:false`. *Crash before step 0* → row `pending`, next
`runOccurrence` starts at idx 0. *Crash after step 0 committed* → idx 0 `done`, resume at idx 1. *Two concurrent
resumes* → idx 1 updated once; loser's UPDATE affects 0 rows → re-reads, continues/finishes idempotently.

**Change feed.** Every state change sets `change_seq = ++meta.changeSeq`. `GET /social/workflows/changes?after=<seq>&limit≤50`
returns `{ ownerKey, items: [{ occurrenceId, changeSeq, state, receiptVersion, steps, outputs? (only when terminal) }],
nextAfter, more }` ordered by `change_seq`; a later completion of an old occurrence gets a new, higher `change_seq`,
so it is always delivered after the cursor (fixes creation-order loss). Page boundaries are stable (a mutation during
pagination produces a higher seq, seen on a later page). `GET /social/workflows/occurrences/:id` → full row, or
`{ state: "absent" }` (never submitted) or `{ state: "pruned", prunedAt, payloadDigest }` (tombstone). (DT-7B-R1) A feed
item has no body: it proves no body/target binding; the full status receipt is the authority for that.
`POST …/occurrences/:id/ack { ownerKey, receiptVersion }` acknowledges only the exact current terminal version and stores
`firstAckAt` once; future → `409 future_version`, lower → no-op, nonterminal → `409 not_terminal`, absent `404`, pruned
`410` (DT-7B ruling 1); ack never deletes and never bumps the feed.

**Retention/capacity.** Terminal rows are pruned at `min(finishedAt + 180 d, firstAckAt + 90 d)` when acknowledged, else
`finishedAt + 180 d` (DT-7B ruling 1; nonterminal never); pruning
writes a permanent tombstone (re-submit → `409 pruned`). ≤ 500 non-terminal occurrences; at cap → `409 capacity`.

## 4. Planner projection and fold (7A-5)

`plannerContext` (built by the browser for the occurrence's `targetWeek = weekKey(input.day)`):

```
{ targetWeek,
  completions: [{ skillId, quest, at }],          // only dayKey(at) < targetWeek (what buildWeekPlan reads), no proofUrl
  planItems:   [{ id, week, day, skillId, quest, minutes, by }],  // only rows with week === targetWeek, incl. minutes-0 tombstones
  settings:    { gear, davinciEdition },
  contextAt }                                      // when captured
```

- Skills/programs come from the bundled catalog (same version as the executor), not the owner's data.
- Ordered fold: step k sees `planItems` + the plan outputs of steps < k of the same occurrence (equals `drainStep`/`previewRun`).
- Freshness: manual/article-ready contexts are captured in the triggering commit (same week). Scheduled occurrences use
  the registration's `contextSnapshot` (DT-7D gate: a CAS-bound template/context is not yet in the schema); if
  `contextSnapshot.targetWeek ≠ weekKey(slot day)` the plan step fails with `context-stale` and every later step is
  skipped (fail-fast, DT-7B ruling 3); the run ends `partial` only when an earlier step succeeded, else `failed`. The browser refreshes the registration context
  (CAS) when opened. No silent use of an old week.
- Size cap 8 KiB; over cap → `413 too_large` at submit (never truncated).

## 5. Browser reconciliation and durable proof (7A-4)

Local slices (future DT-7C, additive): `workflowOutbox` (immutable bodies + authority), `workflowCursor
{ authority, after }`, `workflowProof: Record<occurrenceId, { authority, receiptVersion, outputIds[], deletedOutputIds[],
resetEpoch, at }>`, `workflowResetEpoch` (integer, persisted).

- Reconcile one change item per `commitFresh`: insert each output only if its id is absent, not in
  `deletedOutputIds`, and the occurrence's proof `resetEpoch === workflowResetEpoch`; existing local records (dirty) are
  kept; then write the proof (receiptVersion, outputIds) and a run receipt; read back; then ack.
- Deleting a workflow output locally adds its id to that occurrence's `deletedOutputIds` (scoped, with authority).
- Reset increments `workflowResetEpoch` and records `resetAt`; after reload, any change item for an occurrence created
  before `resetAt` writes no outputs (proof stays, so it is never resurrected). Import keeps the max of local and
  imported `workflowResetEpoch` and unions proofs per occurrence (newer receiptVersion wins; deletions union); a failed
  read-back leaves the previous state and does not ack.
- Capacity: proof entries are retired only when their occurrence is reported `pruned` by the Worker (tombstoned, cannot
  return); ≤ 600 proof entries (500 live + 100 recently pruned); at cap, reconciliation pauses with a visible "proof
  full — check status" state instead of discarding proof. 401×5 outputs is fine: outputs are grouped per occurrence.
- A held response crossing retirement: retirement requires `pruned`; a held `done` response for a pruned occurrence finds
  no proof → probes status → `pruned` → writes nothing.
- Browser receipt projection: remote `pending|running|done|partial|failed|cancelled` map to a NEW local
  `cloudWorkflowRuns` list (own schema), not to today's `WorkflowRun` (which has no cancelled/missed/scheduled kinds).

## 6. Schedules (7A-7, design only; cron wiring deferred)

- Declaration: `schedule = { kind: "daily"|"weekly", riyadhTime: "HH:MM" (5-minute grid), weekday?: 0–6 }`; nominal
  slot = the UTC instant of that Riyadh time (UTC+3).
- Initial watermark = the last nominal slot ≤ registration time (nothing before registration is ever materialized).
- Materialization (one transaction per call, max 3 occurrences): compute slots in `(watermark, now]`; admit the newest
  ≤ 3 (insert-if-absent `sc-<sha256(workflowId|slot)[0:32]>`), record the older remainder as ONE `missed` interval
  `{ from_slot, to_slot, count }`, set `watermark = now's last slot` — all in the same transaction. Interrupted
  materialization rolls back entirely (no skipped or replayed slot). Capacity refusal leaves the watermark unchanged.
- Pause: materialization records nothing while paused; resume sets the watermark to the last slot ≤ resume time and
  records the paused span as one `missed` interval. Revision change never moves the watermark.

## 7. Activity provenance (7A-8)

| Field (writer) | Label | Meaning / limits |
| --- | --- | --- |
| `status:<platform>.lastSyncAt` (`sync.ts:99`, success only) | Last successful sync | `lastError` shown separately (`sync.ts:113`) |
| `replies:state.lastPollAt` (`replies.ts:624`, every saved check incl. no_permission/not_connected/token_expired) | Last saved check | Never "success"; `lastError` shown; success unproven |
| Trends `fetchedAt` (`trends/run.ts:162`, only when a source ran) | Data freshness | A skipped source may report `ok:true` while `fetchedAt` stays old |
| Effects `updatedAt`/`status` (`effects/run.ts:81,411`) | Stored data timestamp + latest stored status (DT-7E gate) | `failed()` uses `prev?.updatedAt ?? now`: the first-ever failure initializes `updatedAt`, later failures keep the old data time while the status changes |
| Publish jobs `targets[p].state` + job `updatedAt` (DT-7E gate) | Per-target state; job updated at | No job-level status exists; `updatedAt` = job updated; no record of ticks that found nothing due |
| Dashboard read time | Observed at | — |

Sync schedule (UTC → Riyadh): Instagram 03:00 → 06:00, Threads 03:10 → 06:10, YouTube 03:20 → 06:20, TikTok 03:30 →
06:30; next eligible slot computed from these constants. Absent evidence → `unknown`. No instrumentation added.

## 8. Worked examples (requests, responses, persistence)

**Manual.** Browser commit writes `workflowOutbox["m1"] = { authority: { workerOrigin:"https://scout.example",
ownerKey:"wfo_ab…" }, body: { occurrenceId:"m1", workflowId:"w1", kind:"manual", registrationEpoch:1, revision:3,
snapshot:{…}, plannerContext:{ targetWeek:"2026-10-17", … }, input:{…, day:"2026-10-17"}, executionAt:"…" },
payloadDigest:"9f…" }`.
`POST /social/workflows/occurrences { body, payloadDigest }` → `201 { ownerKey, occurrenceId:"m1", state:"pending",
receiptVersion:1, changeSeq:41, created:true }` (answer lost) → resend → `200 { …, created:false }`.
Executor (test `drainOne`): step 0 idea → output `wf:m1:a1` (v2, seq 42); step 1 plan → `wf:m1:a2` (v3, seq 43);
finish `done` (v4, seq 44). `GET /social/workflows/changes?after=40` → items m1@44 with outputs. Browser commits outputs
+ proof `{ receiptVersion:4, outputIds:[…], resetEpoch:0 }`, reads back, `POST …/m1/ack { receiptVersion:4 }` →
`{ ackedVersion:4 }`. A replayed `ack { receiptVersion:2 }` → `{ ackedVersion:4 }` (no-op).

**Scheduled (design; cron deferred).** Registration `w2` daily 06:00 Riyadh, watermark `2026-10-17T03:00Z`. A
materialize call at `2026-10-21T03:07Z` finds slots 18,19,20,21 → admits 19,20,21 as `sc-…`, records `missed
{ from: 18T03:00Z, to: 18T03:00Z, count: 1 }`, watermark → `21T03:00Z` (one transaction). Two overlapping calls: second
sees watermark already advanced → no-op. Owner cancels `sc-…20` while `pending` → `cancelled` (seq bump); cancelling
`sc-…21` after its step 0 committed → `409 running`. Stale tab B later pages `changes?after=40`: items already in proof
with equal receiptVersion → no write, ack no-op.

## DT-7C-1 (18 Oct 2026): browser protocol and snapshot foundation, implemented as pure modules

Not a change to the design above. Concrete encodings chosen for DT-7C-2 to consume: authority = canonical origin + server
`ownerKey`; key = `canonicalJson([origin, ownerKey, occurrenceId])` (authority key = the first two); Ready occurrence id =
`ar-` + unpadded base64url of the 32 SHA-256 bytes of `canonicalJson([workflowId, articleId, readyCommitId])` (46
characters); only a verified full terminal receipt authorizes an ack/adoption, never a compact feed item; cloud-only
limit: generated text over 4,000 UTF-16 units. Files: `lib/cloudWorkflowProtocol.ts`, `lib/cloudWorkflowSnapshot.ts`
(+ tests). Details: `planning/tools/38-cloud-workflows.md` "DT-7C-1".

## DT-7C-1-R1 (18 Oct 2026): inputs are captured before they are awaited

Not a design change. A parser or preflight that awaits digests works on one detached copy of its inputs taken before the
first await (request and nested expectations for `parseAnswer`; the validated body for `previewCloudRun`); caller objects
are never frozen or modified. DT-7C-2 must still attach `Parsed.authority` to every stored proof and request.

## DT-7C-2A (18 Oct 2026): the journal kernel, as built

The durable journal is a store slice, not a parallel layer: every journal write is one `commitFresh` transaction under the
shared `3z-prod-articles` lock with an exact canonical read-back. Observations carry `Parsed.authority` and a request
binding and are re-parsed through the pinned `parseAnswer` (status row bound to the entry body and digest) before they
are accepted after a reload or import; they are never delivery proof. Reset keeps the journal and advances `{epoch,
resetAt, commitId}`; an import keeps the maximum of each independently. Capacity 600, no eviction. Unchanged open items:
C2B capture/transport/ownership and C2C adoption/proof/ack/cursor/retirement.

## DT-7C-2A-R1 (18 Oct 2026): one serialized writer discipline

Every write of the one store key holds the one `3z-prod-articles` lock; ordinary saves are queued, coalesced lock tasks
that keep the stored journal bytes verbatim and never author them. Unreadable storage is never treated as absent and never
written over. Observation identity excludes the request kind. Failed restore/reset rollbacks come from durable state read
under the lock and are written only when the operation's own write landed. No new key, schema or mechanism.

## DT-7C-2A-R2 (18 Oct 2026): ordinary saves merge, they do not replace

A queued ordinary save writes only its own changes onto the fresh durable state (three-way merge against the state the
tab last knew); exclusively locked slices are always storage's, verbatim; a newer reset/import generation is kept; a
record another tab removed is never resurrected. Same key, same lock, no schema change.

## DT-7C-2A-C1 (18 Oct 2026): coherent hydration base, logical row identity

The hydration base is the exact payload the hydration read and accepted (never a second read; a rejected read records
none). The ordinary-save merge uses each list's existing logical identity (one explicit table in the store's merge
adapter: natural keys merged as whole rows, demographic groups replaced whole, helper-governed lists normalized by their
own helpers), so concurrent edits of one logical row leave one row and removals are never resurrected. Same key, same
lock, no schema change.

## DT-7C-2A-C1-R1 (18 Oct 2026): helper-list deletion identity

Membership of a helper-normalized list (Discover feedback, format observations, format queue, candidate fallback) is
decided per logical identity (the helper's own: feedback creator-hide vs genre/platform/post; observation target key +
URL; queue full target snapshot + URL; candidate genre/platform/URL) against both bases before normalization: removed in
storage stays removed even if edited here; removed here yields to a newer durable update; a surviving identity's
versions (both tabs' when both changed it) go to the unchanged helper. No whole-row preference, no proof mixing, no
dedupe of stable-id or XP/gem history. Same key, same lock, no schema change.

## DT-7C-2B-1 (18 Oct 2026): browser transport/session foundation (unconsumed)

A dependency-injected-fetch session over the accepted protocol: explicit configure / invalidate-visit / dispose, an
explicit authority handshake, one-request execution of authority, register, update, pause, resume, unregister, submit,
status, run and cancel (ack and changes excluded at type and run time). Authority exists only from a valid handshake
answer and every request must carry the originating Authority and ownerKey. Configuration, visit and latest-action
fences are captured with a detached request before the first await and rechecked at every boundary; stale and
uncertain POSTs keep their dispatched status and originating authority. Fixed descriptor path on the captured origin,
bearer header, credentials omit, no-store, manual redirect; 32,768-byte request check; 1 MiB bounded streamed response;
15 s deadline. Typed refusals are returned unchanged and are not a no-effect certificate; registration uncertainty is
reported, never repaired here. No store, journal, UI, Worker, schema or key change; no importer.

## DT-7C-2B-1-R1 (18 Oct 2026): transport/session capture, completion and cleanup repairs (unconsumed)

The session identity (not disposed, configuration, configuration/visit generations, installed authority, latest-action
sequence) is captured before any caller-controlled data is evaluated and must hold, unchanged, after planning and
immediately before fetch; an intervening configure, visit invalidation, dispose or newer action resolves `refused`
(`disposed` / `superseded`) with zero fetch and never aborts the newer action. The fence is rechecked immediately after
the final bounded read, before decoding, so a late invalidation is `stale` and keeps its dispatched/original-authority
metadata. The fetch guard observes both eventual outcomes even when the signal is already aborted: a late body is
cancelled without being awaited, a late rejection is swallowed. No protocol, store, Worker or UI change.

## DT-7C-2B-2 (18 Oct 2026): durable registration intent and exact recovery (unconsumed)

An authority-scoped durable register/unregister intent per canonical origin + server ownerKey + workflow id, persisted
(exact validated request and descriptor body, revision, digest, operation id, pending state) under the existing
`3z-prod-articles` lock with a fresh CAS and exact read-back BEFORE any mutation request; persistence failure means zero
requests. States pending, dispatching, settled, uncertain, refused, divergent; a typed refusal never proves an earlier
uncertain attempt did not apply; conflicts are divergent and block automatic resolution. Explicit recovery only, replaying
the identical stored request after a new matching handshake and a durable attempt reservation. Saved answers re-parsed
through the pinned parser; history monotonic per authority. New opaque slice, locked-only for ordinary saves; reset keeps
it; import merges monotonically; public projections exclude it. Same key, same lock, no schema redesign.

## DT-7C-2B-2-R1 (18 Oct 2026): current-proof import validation and obsolete completion result

A registration-bearing restore verifies the fresh durable registration slice read under the `3z-prod-articles` lock with
the pinned `verifyRegistrations` (the incoming slice's validator) before merging, and merges only a slice canonically
equal to that verified snapshot (fail closed, no retry); invalid or moved bytes refuse as `journal-invalid` /
`scope: "registrations"` with no write. Legacy backups without the slice keep it verbatim. The controller returns the
existing `stale` result when `recordOutcome` reports that the operation is no longer the key's intent (`state: null`);
it never reports `recorded`/`persisted: true`/`dispatching` for a replaced operation. Result union unchanged.

## DT-7C-2B-3 (18 Oct 2026): ownership-aware atomic trigger capture

A new Manual/Ready trigger is captured for exactly one executor through additive store APIs (`captureManualRun`,
`captureArticleReady`): ownership from parser-verified registration records across authorities, the journal and the
configured canonical origin (conservative table in tool 38 / the handoff record; uncertainty never selects local).
Cloud capture takes an explicit authority equal to the verified registration and the configured origin and binds
`workflowDigestOf` (SHA-256 of canonical {name, trigger, actions}) + revision + open epoch. Detached inputs before the
first await, bounded preparation, then one `3z-prod-articles` commit that recomputes every dependency (typed `stale`, no
retry) and writes article + local runs + cloud entries in one patch with an exact combined read-back and a rollback that
never writes over a newer journal. Same storage key, lock and slices; no new slice. Legacy Run now / Ready keep their
shapes and refuse (`not-local` / `workflow-not-local`) workflows that are not provably local. Unconsumed by the UI.

## DT-7C-2B-3-R1 (18 Oct 2026): lifecycle-proven ownership, one private instant, exact proof

Journal history at an authority is discharged by an inactive record only when that record's own unregistered lifecycle
covers each entry (named epoch closed, executionAt inside it); no lifecycle (refused first registration) or any
uncovered entry blocks (`journal-only` / `inconsistent`). Captures read the caller's Date once before the first await
and derive every member's time/day/id from that private instant. Success requires exact canonical read-back of the
affected article, local runs and journal; a failed read-back restores only still-owned records (by this capture's
commit ids / exact journal) and reloads instead of overwriting another commit, deletion or newer journal. Same key,
lock, synchronous callback and single patch. Carried: origin A-B-A coalescing (no origin generation marker) must be
fenced before production capture/dispatch.

## DT-7C-2B-4 (18 Oct 2026): saved-occurrence delivery, immediate fences, HTTPS transport

An unconsumed controller submits, checks, runs or cancels exactly one saved journal entry on explicit request: the
verified reader returns the fresh durable entry by its full authority-scoped key as a detached frozen body + immutable
identity (digest re-verified, the same snapshot rechecked under the shared lock), and the locked dispatch boundary repeats
that check and every in-memory fence immediately before the one request, which is built only from the saved entry and
sent only to its own authority. Answers are parser-bound to the original body/digest/identity; receipts are recorded only
through the accepted observation API with its exact committed result; a lost answer is unconfirmed (an explicit identical
Submit converges); late answers address only their own entry and never claim current success. Suppressed entries refuse
Submit/Run; Check status/Cancel stay available and keep suppression. An in-memory configuration generation (store
observer on every origin/token transition, A-B-A included; never persisted) plus visit and latest-action fences now gate
existing captures and the controller. The shared session accepts only HTTPS or HTTP on exactly localhost/127.0.0.1/[::1];
historical authorities are not rewritten. No retry, polling, feed, adoption, ack or local fallback.

### DT-7C-2B-4-R1 (18 Oct 2026): result exits respect the originating fence

Every result exit of the occurrence controller after an asynchronous boundary re-checks the captured controller/store
fence (configuration, visit, authority, latest action, disposal). After the dispatched request returns, a moved fence
yields the existing `stale` result with the original action and key and the session's own dispatched fact: an invoked
POST stays dispatched (delivery uncertain), never relabelled refused or not sent, and the journal, occurrence id and
recovery identity are untouched. A usable, parser-bound receipt may still be recorded on its originating entry through
the accepted observation API while the caller receives `stale` with the exact recorded result (`persisted: false` when
storage refused). Unchanged-context uncertainty stays `unconfirmed`; typed refusals stay typed. A store that throws after
its locked hold already started the request is treated as dispatched, not as a refusal. No retry, automatic status,
polling, adoption or ack; no new result union, storage field, observer or controller API.


## DT-7C-2C (18 Oct 2026): adoption, durable proof and acknowledgment, implemented

The §5 sketch is realized as one opaque `cloudReconciliation` slice (proofs keyed by authority + occurrence with
per-output dispositions instead of `deletedOutputIds`, per-authority cursor and retirement generation, ≤ 100 compact
tombstones, pending feed items, the `runs` projection). Reset no longer needs a separate `workflowResetEpoch`: the
journal suppression marker decides pre-reset (suppressed) outputs, and the reset write records cleared owned outputs as
deleted. Capacity is proofs + tombstones ≤ 600 (proof-full pauses). A held response across retirement is stale by the
retirement generation (and a tombstone refuses it). Ack only after an exact read-back and a locked eligibility re-check;
the ack answer writes nothing.

### DT-7C-2C-R1 (18 Oct 2026): retirement keeps ownership; folding instead of eviction; reset on imported proof

Tombstones keep `owned` + `deleted` output ids and the final `changeSeq`; removal after retirement is recorded in the same
write. The tombstone list (<= 100) never evicts: an extra tombstone folds into the per-authority `watermark` (resolved first,
then lowest final `changeSeq`; unknown never folds; nothing foldable refuses `retirement-full`). Import refuses as retired
any backup proof not live locally, or imported-only tombstone, at or below the watermark, and never restores their absent
ids; it applies the merged journal reset to proofs whose outputs come from the backup. Fresh Worker rows are not
watermark-checked. Slice stays `v: 1` (optional new fields); C2C-format backups still import.


### DT-7C-2C-C1 — Codex implementation, 18 October 2026 (supersedes R1 folding)

The owner explicitly reassigned implementation to Codex; Claude remains idle. This is local repair, not cloud activation or independent review of Codex's own code.

- Retirement retains every marker and output identity. At 100 tombstones a further retirement returns retirement-full without a write and keeps its live proof/journal. No folding, eviction or bound increase. Imports with a union above 100 refuse. Proofs plus markers remain bounded at 600; capacity needs an explicit future UI/recovery path.
- Existing nonzero watermarks remain readable but cannot reconstruct discarded ownership. Restores involving them refuse without a write, including a legacy backup lacking reconciliation when the device has a watermark. First status adoption at/below the watermark refuses retired; a complete existing proof stays usable. No automatic clearing/migration or inferred delivery.
- Retired markers carry optional executionAt from the verified receipt body. First-learned imported markers obey the merged reset: pre-reset or unknown-time owned outputs become deleted; known post-reset work and unrelated ordinary drafts remain. Unknown ownership plus a relevant reset refuses instead of guessing. Conflicting known execution times refuse. An unreadable reset journal refuses retired-only backups as well as live proofs.
- Tests: initial five store regressions RED, then GREEN; an additional unreadable-journal regression RED then GREEN. Old folding expectations were deliberately replaced with refuse-at-capacity expectations; prior evidence is preserved. Final full app suite 211 files / 4354 tests passed; targeted reconciliation/Settings 91 passed; nonincremental TypeScript, lint, formatting and build passed. Worker 192 and builder pins remain unchanged; no repeated Worker suite.
- Installed Chrome 155.0.8059.82: 12/12 synthetic Settings export/import checks in EN/AR desktop/phone using genuine Export files, real Web Locks and external-request blocking. First run 10/12: the two English cases expected an English toast after reset had restored Arabic; test setup now explicitly selects English before import, no product change. Tests are maintained in e2e/workflow-reconciliation.spec.ts. They exercise Settings only, not yet the unconsumed cloud controller UI.
- Local preview on localhost:3000 is left running at the owner's browsing request. Seven served pages equal the rebuilt out/ files. No Claude task, deployment, grant, provisioning, live send, push or merge. Integration, schedule/activity, purge maintenance, live readiness, TikTok Inbox and the broader backlog remain open.

Evidence: C:/Users/AORUS/.codex/review-evidence/dashboard-tools/dt7c2c-c1/REPORT.md. Historical sections above retain the superseded design; this section is current.
