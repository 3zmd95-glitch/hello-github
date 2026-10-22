# DT-7A — test matrix, revision R1 (fixtures for later slices; nothing here exists yet)

Layer: W = Worker coordinator/routes (DT-7B), E = pure executor parity (DT-7B if the executor compiles), B = browser
(DT-7C), S = schedule materialization (DT-7D), A = activity (DT-7E).

| # | L | Case | Expected |
| --- | --- | --- | --- |
| 1 | W | Same `occurrenceId` + same `payloadDigest` resent | `created:false`, same row, no seq bump |
| 2 | W | Same `occurrenceId`, different `payloadDigest` | `409 conflict`, stored row unchanged |
| 3 | W | `ar-` id for same `(workflowId, articleId, readyCommitId)` twice | one occurrence |
| 4 | W | Ids with `:` (`a:b` + `c` vs `a` + `b:c`) | `400 unsupported_id`; no output id collision possible |
| 5 | W | Delayed outbox with revision 1 after registration CAS to 2 | admitted with its own revision-1 snapshot; executed with revision-1 actions |
| 6 | W | Registration CAS with stale `expectedRevision` | `409 conflict`, current revision returned |
| 7 | W | Occurrence created after `unregister` (DT-7B-R1: or before its epoch's `openedAt`) | `409 not_registered`; created inside `[openedAt, closedAt]` → admitted as cloud |
| 8 | W | Unregister with a pending cloud occurrence | stays cloud; never transferred to local |
| 9 | E | Crash before step 0 | resume at idx 0; one output per action |
| 10 | E | Crash after step 0 committed | resume at idx 1; output 0 adopted, not rebuilt |
| 11 | E | Two concurrent resumes | each idx updated exactly once; terminal row identical |
| 12 | E | Stale executor after finish | step/finish UPDATE affects 0 rows; terminal unchanged |
| 13 | E | Existing output row with different digest/tuple | step `failed: output-conflict`; later steps `skipped` |
| 14 | E | Step failure | later steps `skipped`; state `partial` (some done) or `failed` |
| 15 | W | Cancel pending (no done step) | `cancelled`, seq bump, no outputs |
| 16 | W | Cancel running | `409 running` |
| 17 | W | Change feed: O1 created first, O2 completes first, O1 completes later | O1 delivered with higher `changeSeq` after the cursor |
| 18 | W | 120 changes, `limit=50` | 3 pages, `nextAfter` stable, none missed/duplicated |
| 19 | W | Equal `updated_at` timestamps | order by `change_seq` only |
| 20 | W | Mutation between page 1 and 2 | mutated row appears on a later page with a new seq |
| 21 | W | Lost ack; ack v2 after ack v4 | `acked_version` stays 4 |
| 22 | W | Status by id: never submitted / pruned | `absent` / `pruned` with digest |
| 23 | W | Re-submit pruned id | `409 pruned` |
| 24 | W | 500 non-terminal occurrences | new submit `409 capacity`; none evicted |
| 25 | W | Payload privacy | only allowlisted fields accepted; canary for ideas/articles/inbox/tokens rejected |
| 26 | E | Planner parity: manual rows + minutes-0 tombstones, historical completions before week, two plan steps | identical rows to `previewRun` with the same context; second step folds the first |
| 27 | E | Week rollover: input.day Friday 23:59 Riyadh | target week of that day; context week must match |
| 28 | E | Scheduled context week ≠ slot week (corrected, DT-7B ruling 3: fail-fast) | plan step `failed: context-stale`; every later step `skipped`; earlier outputs kept; `partial` only if an earlier step is done, else `failed` (`[idea, stale plan, post]` → idea kept, post skipped, `partial`; `[stale plan, idea]` → no idea, `failed`) |
| 29 | E | Output ids | `wf:<occurrenceId>:<actionId>`; `publishJobId` equals today's mapping |
| 30 | E | Effects | zero publish jobs, provider calls, messages |
| 31 | W | No assumed empty production storage | seed existing rows/tombstones/seq; nothing overwritten, seq continues |
| 32 | B | Authority switch A→B with queued outbox for A | listed "another Worker"; zero requests to B |
| 33 | B | A→B→A held action | new visit; held action discarded |
| 34 | B | Dirty local output (edited) | kept unchanged |
| 35 | B | Deleted output id | in `deletedOutputIds`; never re-inserted |
| 36 | B | Reset → reload → change item for pre-reset occurrence | no outputs written; proof kept |
| 37 | B | Import older backup | max reset epoch; proofs unioned; deletions survive |
| 38 | B | Proof cap reached | reconciliation paused with visible state; no proof discarded |
| 39 | B | Held response across retirement | status probe `pruned` → no write |
| 40 | B | Remote `cancelled`/`partial` | projected into `cloudWorkflowRuns`, not `workflowRuns` |
| 41 | S | 3 slots missed | 3 admitted in one transaction, watermark advanced |
| 42 | S | Long gap on the supported cadence (corrected, DT-7D gate): a daily schedule offline ~550 days / a weekly one ~10 years | ≤ 3 admitted + one `missed` interval row; bounded work (no minute cadence exists) |
| 43 | S | Interrupted materialization | rollback; retry admits same ids, no skip/replay |
| 44 | S | Capacity during materialization | refused; watermark unchanged |
| 45 | S | Pause then resume | paused span = one missed interval; watermark = resume slot |
| 46 | A | `lastPollAt` after a not_connected check | label "last saved check", not success |
| 47 | A | Trends skipped source `ok:true`, old `fetchedAt` | "data freshness" shows old time |
| 48 | A | Effects failures (corrected, DT-7E gate): first-ever failure initializes `updatedAt`; a later failure keeps the old data time | stored data timestamp + latest stored status `failed`, never "last saved result time"; publish shows `targets[p].state` (queued/failed) with job `updatedAt` |
| 49 | A | Next sync slot per platform | IG 06:00, Threads 06:10, YouTube 06:20, TikTok 06:30 Riyadh |
| 50 | A | No stored evidence | `unknown` |

## DT-7B status (local Worker foundation; executor gate FAILED → store-only, test-only builder)

Rows 21 and 28 are read with the DT-7B rulings (exact-terminal ack; fail-fast). Evidence: `workers/scout/src/social/
workflowProtocol.test.ts`, `workflowCoordinator.test.ts`, `workflowRoutes.test.ts`, `workflowCoordinator.runtime.test.ts`.

- **Included (W):** 1, 2, 4, 5, 6, 7, 8, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 31; row 3 at the Worker side only
  (the same id + digest is one occurrence; the `ar-` id derivation is browser work, DT-7C).
- **Store atomicity proven with the TEST-ONLY deterministic builder (not executor acceptance):** the step-CAS analogues
  of 9 (pending survives restart, resume at idx 0), 10 (committed step survives, identical output adopted), 11 (concurrent
  drains, one commit per step), 12 (stale executor after finish), 13 (output-conflict + skip), 14 and 28 (fail-fast
  partial/failed in both action orders, the stale context injected by the test builder).
- **Validation pending (executor):** 9–14 and 26–30 as executor rows — parity with the existing pure builders, fixed
  executionAt, pre-week completions / manual rows / minutes-0 tombstones, ordered multiple plan steps, real stale-context
  detection, `publishJobId` mapping and zero effects through the real builders. Blocker: the builders' app-only `@/*`
  alias and JSON-module imports do not resolve under the pinned Worker tsconfig/vitest config.
- **Not in DT-7B:** B 32–40 (DT-7C), S 41–45 (DT-7D), A 46–50 (DT-7E).
- **DT-7B-R1 (local repair):** row 7 extended to the admission interval — first registration, re-registration after a
  long local-only gap, a delayed old epoch after a later registration, equality at both bounds, before-open and
  after-close refusals with zero mutation, restart and duplicate replay (coordinator suite and the workerd runtime
  through the real router). Rows 6, 16–21 and 25 read with complete, request-bound answer proof (receipt body,
  digests and state/step/output table; typed feed items without a body-binding claim; bound mutation success; typed
  refusals) — routes suite: real control fixtures for every state and idempotent outcome plus tamper tables. Executor
  rows unchanged (validation pending).
- **DT-7B-2 (18 Oct 2026, local, unactivated): executor rows with the REAL builders.** Evidence:
  `workers/scout/src/social/workflowRun.test.ts` (Node byte parity vs `previewRun`/`buildOutput`),
  `workflowCoordinator.test.ts` "DT-7B-2 run", `workflowRoutes.test.ts` "DT-7B-2 run route",
  `workflowRun.runtime.test.ts` (workerd, real router/index/bindings, persisted SQLite, outputs byte-equal to the host).

  | Row | DT-7B-2 status |
  | --- | --- |
  | 9 | Proven: pending survives restart; `run` resumes at idx 0, one output per action (coordinator + workerd). |
  | 10 | Proven: a step committed before a restart is adopted unchanged; `run` builds only the rest (coordinator + workerd). |
  | 11 | Proven: three concurrent `run` calls — each step committed once, commits sum to the action count, one terminal row (coordinator + workerd). |
  | 12 | Proven: terminal replay / lost answer — same receipt, `committed: 0`, no sequence or output change (coordinator + workerd across restart). |
  | 13 | Unchanged store rule (commitStep adoption/output-conflict); the adapter only builds the next pending step. |
  | 14 | Proven with real builder codes: `[idea, unknown-skill plan, post]` → partial; `[no-skill plan, idea]` → failed (coordinator + workerd). |
  | 26 | Proven: pre-week completions, manual rows, zero-minute tombstones, gear/edition, several ordered plan steps folding earlier ones — byte-equal to `previewRun` (Node + workerd). |
  | 27 | Proven: Friday 23:59:59.999 / Saturday 00:00 Riyadh build in their own day and week (Node + workerd). |
  | 28 | Adapter proven in Node: a missing or other-week context fails `context-stale`, earlier outputs kept, later skipped. Admission refuses such bodies today, so the scheduled half stays a DT-7D fixture. |
  | 29 | Proven: ids `wf:<occurrenceId>:<actionId>` = `workflowOutputId`; `publishJobId` is a pure function of that id, so today's mapping is unchanged. |
  | 30 | Proven: the workerd outbound trap stays empty; outputs are allowlisted drafts only (no publish job, provider call or message). |

## DT-7C-1 status (18 Oct 2026, local)

Browser rows B 32-40 are covered only for the pure protocol/snapshot foundation, not for any store, outbox or UI: real
`scout.handle` + SQLite coordinator answers for every state/outcome parsed by the app
(`cloudWorkflowProtocol.wire.test.ts`); tamper refusals (identity, body/output digest, state fields, versions, mixed
envelopes, unknown keys, foreign request); older valid receipts and no-op outcomes accepted; full receipt vs compact feed
(a feed item cannot authorize an ack or adoption); origin canonicalization; Ready id vectors; Unicode; mutation
isolation; private-field canaries; 16 KiB / 8 KiB bounds; Riyadh rollover; ordered planner parity with
`buildOutput`/`previewRun`; 4,000 passes / 4,001 cloud limitation; zero external calls. Transport fences, durable
outbox/proofs, global output collisions, read-back-before-ack and retirement generations stay DT-7C-2.

DT-7C-1-R1 adds held-digest rows to B 32-40 (pure foundation only): a request that mismatches at the call cannot be edited
to match (submit, status, run, cancel; compact feed never authorizes), a matching request cannot be spoiled, and preflight
of a body edited (template, executionAt/day, planner context, appended actions) while its first digest is held equals the
preflight of the original capture, with the five-action bound intact.

DT-7C-2A rows (lib/cloudWorkflowJournal.test.ts, store/cloudWorkflows.test.ts, components/settings/SettingsScreen.test.tsx,
e2e/settings.spec.ts): reload and backup round trips; forged, flagged, compact-feed and other-authority observations
refused or rejected on load; authority separation; same-key digest conflict, older and equal-version receipts; two-tab
same-key (same/other digest) and unrelated-slice writes during a held digest; a newer journal before the read-back kept;
lost answer recovered after a reload; quota, missing/failing lock and unreadable journal typed (never empty); reset during
validation (`stale`); reset, reload, old import; equal-counter merges in both orders; legacy import; cap 600 (update ok,
601 and overflowing import refused before writing); over-8 KiB context and 4,000-unit limitation refused without writing;
privacy canaries; a local manual run unchanged; Settings busy/second-Confirm/Cancel, failure and retained-records copy in
Arabic and English on phone and desktop.

DT-7C-2A-R1 rows (store/cloudWorkflows.test.ts, lib/cloudWorkflowJournal.test.ts, SettingsScreen.test.tsx,
e2e/settings.spec.ts): no storage access before the lock; a stale ordinary save queued before/after a real locked commit
of a second store instance (both orders); coalesced queued saves; a save asked inside a held callback (no deadlock); a
pending save written first by this tab's own commit; no-Web-Locks save keeps stored journal; transient read failure;
non-JSON/`null`/array/string/`{state:null}`/`{state:[]}`/wrong envelope preserved by save, load, enqueue, reset and both
imports; nested malformed journal kept byte for byte; non-round-trip journal bytes refused; legacy envelope; dropped
legacy and journal-bearing restores with another tab's newer save; landed-but-unproven restore and reset rollbacks;
real Worker Submit/Run/Cancel vs Status receipts idempotent and a real two-Worker equal-version contradiction refused;
Settings save-failure copy (AR/EN); a real Web Locks two-page stale-tab save (phone and desktop).

DT-7C-2A-R2 rows (store/cloudWorkflows.test.ts, e2e/settings.spec.ts): two real store instances with one serialized
lock: B's locked `addArticle` before A's queued Settings save (and the reverse order); B's unknown Inbox handle, its
monotonic receipt update and its locked removal; several queued ordinary edits as one write; B's locked job id plus A's
edit of the same post; A's own pending edit before its own job-id commit; B's reset (no resurrection, generation and
suppressed journal kept); every exclusively locked slice verbatim; mixed ideas/planItems and ordinary settings keys
merged; a partial stored state; the real Website New article and Settings reminder in both orders with real Web Locks
(phone and desktop).

DT-7C-2A-C1 rows (store/cloudWorkflows.test.ts): B's real `allocatePublishJobId` bytes landing between A's hydration
read and the end of its hydration, then A's title edit (job kept); coherent old base, B's commit, coherent new base; a
schema-rejected hydration read (no base, job kept); overlapping hydrations (newest wins); real concurrent
`setAccount('instagram')` (one row, first-match read); distinct platforms; snapshot and post-stat compound keys;
demographic group replacement; removal vs update without resurrection; completion, review, saved-ref canonical URL and
recent topics stay single.

DT-7C-2A-C1-R1 rows (store/cloudWorkflows.test.ts, "helper-normalized lists decide deletion by logical identity"):
feedback - B's clear and B's successful locked reset vs A's pre-notification edit to less (no resurrection), settings-only
and independent-key controls, later feedback wins in both directions, local clear vs B's newer update, creator hide vs
post identity, canonical post URL; observations - removal vs newer revision, independent target, newest revision wins in
both directions, local removal vs newer update; queue - removal vs re-dated copy, distinct target snapshots (control and
both-add), earliest date in both directions, local removal vs newer update; candidates - locked reset vs re-observation,
other genre survives, later evidence wins in both directions, local removal vs newer update.

DT-7C-2B-1 rows (lib/cloudWorkflowClient.test.ts, lib/cloudWorkflowClient.wire.test.ts, detachRequest cases in
lib/cloudWorkflowProtocol.test.ts): construction/configure/invalidate/dispose with zero requests and the global fetch
throwing; unusable origin/token; refusals with zero fetch (unconfigured, disposed, no handshake, ack/changes/unknown
kinds, extra fields, non-plain data, foreign origin/owner, junk authority, ownerKey and submit-body ownerKey mismatch,
oversized submit); handshake options and "only the returned authority"; exact method/path/body/headers for every
supported kind; redirects (302/307/opaque/redirected flag) and foreign or different final URL; origin, token and visit
A->B->A, single invalidation and dispose at a held fetch, a held body and a late chunk; superseding handshakes and
requests, late failure of an older action, abort of the older signal, a refused call not superseding; caller mutation
of the request and authority while held (and of the expectation during the parser's digest check); undefined optional
fields; endless/over-cap/exact-cap streams independent of Content-Length with reader cancel, single oversized chunk,
15 s timeout on fetch and on a stalled body, no leftover timer; throwing fetch by category only; malformed JSON,
invalid UTF-8, mixed/unknown-key/foreign-owner/wrong-status answers; typed refusal unchanged; receipt_unavailable after
a POST (real 503 from a down coordinator) vs on a GET; no token anywhere; one fetch per action. Wire rows over the real
router/SQLite: the full lifecycle, real conflict/absent refusals, foreign proof, stale at the parser's digest check for
visit, origin, token and dispose, the largest admissible request and the largest admissible full receipt (351,087 bytes
against the 1,048,576 cap).

## DT-7C-2B-1-R1 additions (18 Oct 2026)

Client rows: accessor-driven origin switch, token change, A->B->A, visit invalidation and dispose during request capture
(zero fetch, resolved `refused`, never a raw TypeError; old Authority never retargeted); benign accessor read once and
an identical configure still dispatch; a throwing accessor is `invalid_request`; a newer action started during capture is
not aborted and a refused call during capture supersedes nothing; an authority-field accessor changing the session; final
bounded-read completion fenced for visit, dispose and configuration (stale, dispatched kept) with the still-current
malformed-JSON control; already-aborted guard cancels a late body, does not await a never-settling cancel, observes a
late rejection (no unhandled rejection), plus the ordinary asynchronous-abort control. The ack/changes negative type
assertions sit directly under their `@ts-expect-error` as short assignments (typecheck exit 0 after formatting).

## DT-7C-2B-2 additions (18 Oct 2026)

Pure rows: key shape; immutable capture; kind/extra-field/foreign-owner/digest refusals; create/unresolved/capacity
(existing key at the cap still allowed); every transition (ok -> settled, uncertain, clean vs after-uncertainty refusal,
conflict divergent resolved/unresolved, not-dispatched revert, older-attempt/other-operation/resolved writes nothing,
older-attempt ok still settles, CAS reservation, unregister digest contradiction, history never regresses, equal-order
contradiction); strict parse (key, body/path, extra token key, owner, state invariants, duplicates); forged answers fail
revalidation; wire answers rebuilt from parser results re-parse identically; merge (identical, legacy, union, equal-seq
identity, monotonic progress, refused+uncertain, older backup, newer over resolved/unresolved, history contradiction,
capacity). Controller rows (fake fetch, in-memory locked double): no request on construction, handshake required,
persistence failures send nothing, persisted-before-POST, lost register/unregister answers with explicit identical
recovery after a new handshake, unpersistable outcome stays dispatching, origin/token A-B-A, visit, dispose and newer action
during create and during reservation, fence after reservation, late answer after a fence recorded on its original intent,
foreign origin/owner, accessor capture, two controllers recovering one key, no parallel recovery, late failure vs newer
settled truth. Wire rows (real router/SQLite): lost register/unregister answers, delayed original after recovery and after
a newer lifecycle, delayed unregister vs newer epoch, old re-register vs later closed epoch, recovery meeting a newer
lifecycle (divergent, blocks new intents). Store rows (jsdom): persisted-before-POST, reload, quota/dropped write/no locks/
lock error/unreadable, two store instances, ordinary saves verbatim and absent-stays-absent, non-verbatim bytes refused,
article/journal/registration commits keep each other's bytes, workflow removal, reset (and failed reset), export/import
round trip, legacy backup, older backup, identical/contradictory/newer imports, forged/malformed/overflowing/no-locks
imports, unreadable device slice, capacity, privacy canaries and the public kit projection.

## DT-7C-2B-2-R1 additions (18 Oct 2026)

Store (jsdom): invalid current proof refuses a valid (and an empty) backup with nothing written; an invalid record
introduced while the import waits for the lock refuses; a slice changed after the verified under-lock read refuses;
a valid newer local record introduced while waiting is verified and kept by the merge; a legacy backup over an invalid
current slice keeps it verbatim. Controller (in-memory double): a late success and a late failure of an operation another
tab recovered and replaced with a newer unregister return `stale` (no write, no retry, newer record untouched); the
same-operation late failure still returns `recorded/settled/persisted: true`. Wire (real router/SQLite): the held genuine
success for the replaced register returns `stale`; the coordinator row and the newer unregister intent stay.

## DT-7C-2B-3 additions (18 Oct 2026)

Pure: digest vectors, exclusions and equality with the builder's body.snapshot; ownership table (none, active, pending,
dispatching, uncertain, divergent, proven unregister incl. old entries, refused-after-active, refused first register,
foreign worker, not configured, multiple active, unreadable registrations/journal, journal-only incl. another authority,
settled/observation inconsistency, related-only verification); binding (pause, revision, digest, null digest, before the
epoch, closed epoch); admission (idempotent, conflict, capacity 599/600, suppressed); identity-only projection; Ready id
vector. Store (jsdom, real Worker router + SQLite behind a fake transport via the accepted controller): legacy local
capture + Run now + drain; cloud Manual with exact builder body/digest/day and no WorkflowRun, legacy refusal, no
network; authority mismatch, foreign and unconfigured origins; manual-on-Ready; edited, paused, pause+resume, missing and
pre-epoch definitions; uncertain, unreadable and parser-refused evidence; journal-only after an import that runs nothing;
stale on workflow edit, A-B-A, reset epoch, registration generation, origin change and another journal commit; frozen
body after edits; mixed local/cloud Ready with exact Ready ids and post-commit drain; already-ready no-op;
whole-transition refusal (authority, legacy Ready, cloud limitation) with no article/run/entry; capacity 600; two-tab
competing Ready; quota, dropped write, no Web Locks; a newer journal never clobbered on rollback; unregister leaves the
old entry cloud; an existing local run retries/drains after registration; reset suppresses entries with no run and no
network; plan target-week context and over-count refusal. Components: Ready refusal copy (Arabic) without a conflict;
Run now refusal copy.

DT-7C-2B-3-R1 additions. Pure: refused first registration + same-authority history blocks (journal-only), another
workflow's history unrelated; epoch-1 unregister vs epoch-2 entry blocks; entry after close / before open blocks; mixed
covered + uncovered blocks; inclusive interval ends stay local; active epoch-2 registration with epoch-1 + epoch-2
entries stays cloud; workflows independent (fixture time of the existing unregister control moved inside its closed
epoch). Store: refused first registration beside cloud history blocks capture + legacy Run now with zero runs/ideas and
an unchanged journal; clean refused first registration stays local; caller Date mutation after the call (local Manual,
local Ready, mixed Ready with cloud executionAt/day/Ready id); ordinary exact persistence; stored draft with the proposed
Ready commit, altered local snapshot with the same run id/commit, mixed Ready with an altered run (all not-persisted,
owned records put back, no drain); foreign article commit and foreign run commit kept; newer journal kept with the owned
article put back (the existing unregister control now captures at the router's epoch opening). Browser (installed
Chrome, EN desktop + AR phone, `e2e/workflow-capture.spec.ts`): inconsistent history refuses Run now and Mark ready with
the existing copy and zero local runs/outputs; ordinary local Run now and Mark ready still run once.

DT-7C-2B-4 additions. Client: HTTPS accepted (mixed case, default port), HTTP only on canonical localhost/127.0.0.1/[::1];
insecure hosts, suffix lookalikes, `127.1`, `0x7f.0.0.1`, `[0:0::1]`, `localhost.` refuse `insecure`; user-info/path/query/
non-origin refuse `origin`; an insecure reconfigure drops the session (zero handshake/execute) and supersedes in-flight work;
the registration controller inherits it; historical http authorities still parse. Controller (fake transport/persistence):
zero requests on construction/configure/visit/dispose and reconnect; refusal order (not configured, no authority, bad key,
missing, foreign origin/owner, suppressed Submit/Run); persistence failures typed; requests only from the saved entry;
lost Submit unconfirmed without retry; absent vs pruned (digest-bound) distinct, nothing recorded; store fence moved in the
read or the locked dispatch; handshake required after any fence move; late answer stale; newer action/configure/visit
supersede; disposal safe. Store (real capture, real router/coordinator behind fake transport): observer coverage (setter,
equal values, other settings, A-B-A, direct update, rehydration, import, reset, visit); reader (detached frozen identity,
never Settings/edited workflow, missing/invalid/unreadable/digest-tampered, moved under the lock); Manual Submit with exact
saved bytes and no chaining; mixed Ready Submit after workflow + article edits with identical bytes; lost Submit then
explicit identical Submit converging (one Worker row); nothing on construction/hydration/reconnect/import/reset/error;
Status/Run/Status and Cancel/Run bound to the saved owner/id/body; absent before Submit; tampered receipt unconfirmed and
unrecorded; suppressed entry (Submit/Run refused, Status/Cancel recover, stays suppressed); reset and import (suppression,
settings) during held validation send nothing; controller and capture A-B-A (setter origin, direct token, another-tab
rehydration) and visit change; latest capture per target (cloud and local; another target independent); equal re-save
control; local-only capture control; two sessions converge; late answer recorded only on its own entry; newer action
supersedes a dispatched Submit then explicit Submit converges; observation write/read-back failure unpersisted; foreign
origin/owner (incl. a second Worker owner) zero requests; http historical entry kept but never transported.

DT-7C-2B-4-R1 (result classification after a fence moves): real capture + real router/SQLite coordinator behind a fake
transport: network rejection, malformed JSON, invalid typed answer and `receipt_unavailable`, each after store visit
invalidation and after token A-B-A, are `stale` (dispatched, nothing recorded, exactly one request, no replay/poll); an
older lost Submit is stale while a newer Status waits on its durable read, and the newer Status then answers; unchanged
lost answer stays `unconfirmed`; a genuine typed refusal (Cancel of a never-sent occurrence) stays `answered`/typed; a
valid late bound receipt is recorded only for its own entry and returns stale; moved fence + storage failure is stale and
unpersisted. Controller unit matrix (fake persistence): the same four failures x config/visit A-B-A stale vs unmoved
unconfirmed, older Submit vs newer Status read, and a store dispatch that throws after the request started stays
dispatched.


DT-7C-2C (adoption/proof/ack): pure kernel (synthetic receipts through the pinned parser): initial proof, journal
binding/mismatch, nonterminal bound only, partial/failed/cancelled, suppressed pre-reset, same/older/ack-only/conflict,
collisions (local, foreign authority, deleted owned), retained/deleted re-derivation, deletion evidence + import filter,
retirement/tombstones/capacity 600 + tombstone cap, cursor/pending, merge monotonic + conflict + capacity, structure,
parser re-verification, runs trimming. Controller (scripted persistence): bounded page, one status per item, proven-skip,
pending vs stop policy, proof-full, fences (visit, live() inside the hold), check/absent/pruned/initial, ack after locked
check, lost ack. Wire (real router/SQLite): exact routes/bodies, real compact feed never trusted, paging. Store (real
capture + router/SQLite + store): exact idea/post/plan drafts, cancelled empty proof, nonterminal then terminal, initial
proof, malformed answer pending + recovery, local and cross-authority collisions, every deletion path incl. same-tab
queued deletion and unhooked removal, dirty retained, ordinary-save byte preservation, reset, pre-reset suppression,
import filter/legacy/contradiction, quota and dropped writes, lost ack + recovery, two tabs, held status across import,
mid-page invalidation, 120 changes in pages of 50, equal-timestamp later completion, 600 proof-full, retirement with a held
status across reload, journal retention when ownership needs it, unreadable slice, privacy canaries. Not covered at the
store level: partial/failed with the real builders (no local Worker failure seam; pure-kernel coverage only).

DT-7C-2C-R1: pure kernel adds tombstone ownership/final seq, removal after retirement, reset after retirement, tombstone
collision for another authority, boundary (100 = no fold), fold at 101 into the watermark, resolved-first fold order,
retirement-full, watermark import refusal with present-id release, newer work above the watermark, live proof below it,
imported tombstone at/below the watermark, union fold vs capacity refusal, C2C/new formats + malformed ownership, merged
reset on first-learned / nonterminal-local / rank-suppressed proofs with post-reset and owned-local controls. Store (real
router/SQLite, real export/import): idea/post/plan queued removal after retirement + dirty retained draft, restore control,
import and reset removal after retirement, old/new backup formats, pre-retirement deletion after 100 more retirements
(fold; the reviewer flow), newer work after a fold, retirement-full via a real pruned check + foldable control, reset
before first proof + unrelated draft, reset before the occurrence control, and real-builder partial/failed adoption + ack
(closes the C2C store-level gap).


### DT-7C-2C-C1 — Codex implementation, 18 October 2026 (supersedes R1 folding)

The owner explicitly reassigned implementation to Codex; Claude remains idle. This is local repair, not cloud activation or independent review of Codex's own code.

- Retirement retains every marker and output identity. At 100 tombstones a further retirement returns retirement-full without a write and keeps its live proof/journal. No folding, eviction or bound increase. Imports with a union above 100 refuse. Proofs plus markers remain bounded at 600; capacity needs an explicit future UI/recovery path.
- Existing nonzero watermarks remain readable but cannot reconstruct discarded ownership. Restores involving them refuse without a write, including a legacy backup lacking reconciliation when the device has a watermark. First status adoption at/below the watermark refuses retired; a complete existing proof stays usable. No automatic clearing/migration or inferred delivery.
- Retired markers carry optional executionAt from the verified receipt body. First-learned imported markers obey the merged reset: pre-reset or unknown-time owned outputs become deleted; known post-reset work and unrelated ordinary drafts remain. Unknown ownership plus a relevant reset refuses instead of guessing. Conflicting known execution times refuse. An unreadable reset journal refuses retired-only backups as well as live proofs.
- Tests: initial five store regressions RED, then GREEN; an additional unreadable-journal regression RED then GREEN. Old folding expectations were deliberately replaced with refuse-at-capacity expectations; prior evidence is preserved. Final full app suite 211 files / 4354 tests passed; targeted reconciliation/Settings 91 passed; nonincremental TypeScript, lint, formatting and build passed. Worker 192 and builder pins remain unchanged; no repeated Worker suite.
- Installed Chrome 155.0.8059.82: 12/12 synthetic Settings export/import checks in EN/AR desktop/phone using genuine Export files, real Web Locks and external-request blocking. First run 10/12: the two English cases expected an English toast after reset had restored Arabic; test setup now explicitly selects English before import, no product change. Tests are maintained in e2e/workflow-reconciliation.spec.ts. They exercise Settings only, not yet the unconsumed cloud controller UI.
- Local preview on localhost:3000 is left running at the owner's browsing request. Seven served pages equal the rebuilt out/ files. No Claude task, deployment, grant, provisioning, live send, push or merge. Integration, schedule/activity, purge maintenance, live readiness, TikTok Inbox and the broader backlog remain open.

Evidence: C:/Users/AORUS/.codex/review-evidence/dashboard-tools/dt7c2c-c1/REPORT.md. Historical sections above retain the superseded design; this section is current.
