# 37 · Inbox: reviewed YouTube public text replies (packet DT-6B-2A)

Status: implemented locally, 17 Oct 2026 (Opus 5.5, single writer); repaired in DT-6B-2A-R1 (Codex findings
2A-1…2A-11, see "Repair DT-6B-2A-R1" below) and DT-6B-2A-R2 (residuals 2A-R1-A…D). Not deployed, nothing provisioned, no live provider call (fake transport
only). Plan: `planning/collaboration/dashboard-remaining-tools-handoff.md` ("DT-6B-2A
plan"); acceptance: `dashboard-remaining-tools-review.md` ("Return to Claude — DT-6B-2A authorized now") and the
read-only contract `%TEMP%/dashboard-remaining-tools-2026-10-16/dt6b2-send-contract.md`. Threads replies (2B),
Instagram public/DM replies with automation coordination (2C) and connection readiness are still required.

## What the owner gets

In the Inbox, on a YouTube comment or reply of his own video: write a private draft, **Save** it, then **Send as
public reply**. A review sheet shows the account (channel), where the reply goes ("a public reply under X's comment on
“video”"; a reply row says it goes under the top-level comment, because YouTube only nests one level), the **exact**
text the Worker captured, and how long the review stays open (10 minutes). **Send** posts it once. The sheet then shows
one of:

- **Sent**, with "Open the reply on YouTube" (exact `www.youtube.com/watch?v=…&lc=…` link) and Keep draft / Clear draft
  (Clear removes the draft only if it is still the saved revision that was sent; the editor then empties if it still
  shows that text, and a new reply saves against "no draft"; a clear that fails says so and keeps everything).
- **Refused** (YouTube's reason, e.g. `commentsDisabled`, `quotaExceeded`): nothing posted; Prepare again.
- **Unknown** ("YouTube didn't confirm; it may still have posted. Check status before anything else."), with the reason
  (timeout, broken connection, server error, answer without an id, receipt not saved, or a send that never recorded a
  result). Only **Check status**; there is no Resend, and no new send starts on that comment while it is unknown.
- **Expired / Cancelled**: nothing sent; Prepare again.

Save, Copy and Discard are unchanged and never send. Without the comment permission the draft box says so ("needs
youtube.force-ssl… Copy still works"); a Worker older than this packet shows nothing new. Threads and Instagram drafts
offer no sending.

## Operation model

```
draft (saved, revision = commitId)
  └─ Prepare ─► handle "preparing" persisted on this device ─► POST …/send/prepare
                 Worker: grant + live token + sealed target + text bounds + ONE thread GET ─► coordinator.prepare
  └─ Review  ─► the Worker's canonical intent (account, thread, video, parent, exact text, digest, expiry)
  └─ Send    ─► handle "dispatching" persisted ─► POST …/send/confirm
                 Worker: grant + token + generation + digest ─► coordinator.claim (prepared → dispatching, once)
                         ─► ONE comments.insert POST ─► coordinator.settle (sent | rejected | unknown, once)
  └─ Check status ─► GET …/send/:operationId (the same operation, never a resend)
```

- **Coordinator** (`workers/scout/src/social/sendCoordinator.ts`): a SQLite-backed Durable Object, binding
  `SEND_COORDINATOR`, migration `v1-send` (`new_sqlite_classes`), one object per `youtube|<channel id>`, exported from
  `src/index.ts` as the module's only named export. Tables `intents` (operation id primary key; a partial unique index
  on the submission key `provider|account|draftRevision|parent|digest` over live states) and `tombstones`. KV is never
  the claim store (no atomic read-modify-write). No network inside the object.
- **Idempotency**: the same operation id and payload returns the same intent; a changed payload is `conflict`; another
  operation id for the same live submission (two tabs, same saved draft and text) converges on the first intent. A
  sent or unknown submission is never prepared again; an expired, cancelled or rejected one may be.
- **One dispatch per operation**, not exactly-once delivery: YouTube's `comments.insert` has no idempotency key.
  `unknown` and `dispatching` never expire, are never purged, never become claimable, and are never retried or replaced
  by a fresh intent.
- **Send target** (`sendRef`): sealed by the reads with `HMAC(INBOX_SEAL_SECRET, "send-target-v1|youtube")` over
  `{ account, generation, provider thread id, video id, top-level comment id }`; the thread id is never assumed to equal
  the comment id. Separate from the read refs, which keep their list keys and meaning. Nested replies carry their
  parent's `sendRef` and `replyParentNote: true`.
- **Preflight** (prepare only): `commentThreads?part=snippet&id=<thread>` must return that thread with the sealed video,
  the owned channel, `isPublic: true`, `canReply: true` and the sealed top-level comment id.

## Retention and privacy

- Worker: settled intents (sent, rejected, expired, cancelled) are kept 90 days, then purged; their operation ids (and a
  sent row's submission key) stay in `tombstones`, so nothing purged becomes dispatchable again. `unknown` and
  `dispatching` rows are kept forever. Stored: the reviewed text, ids, digest, states and timestamps; never a token.
- Dashboard: `inboxSendOps` (persisted, at most 50; only settled handles are ever dropped, oldest first, and with 50
  unresolved ones a new send is refused with `capacity`) holds per draft scope only the operation id, account, draft
  revision, digest, state, the Worker receipt version (`receiptVersion`, its `updatedAt` in ms) and timestamps; never
  the text, a token or a fetched body (the review's parent excerpt comes from the loaded read row, in memory only). It is
  written through `commitFresh` with a read-back and a fence on the expected operation id, and is not part of the media
  kit or the articles export. Review views are memory only.
- Nothing is logged; bodies, tokens and the seal key never appear in answers, URLs or exports.

## Limits

- Text 1–2,000 characters after trimming (trimmed, nothing else changed; shown as is). Request bodies 16,384 bytes,
  cancelled mid-stream beyond. Review 10 minutes. POST timeout 15 s, answer read within 256 KB. One thread GET per
  prepare, at most one POST per operation.
- Fences: a change of Worker URL/token, of the selected channel or of its generation closes an open review; the stored
  operation is never retargeted (its handle still records the Worker's answer). Every request goes to the connection
  its action captured, and an action whose connection moved during an await makes no request at all.
- An unknown operation blocks new sends on that comment on this device until it settles (the owner checks YouTube).

## Repair DT-6B-2A-R1 (17 Oct 2026)

- **2A-1** Each action captures Worker URL + token, its session and the channel + generation once, re-checks them after
  every await and right before `fetch`, and sends only through the capture: a move means zero requests and "closed"
  (Prepare lets go of its unsent handle; Confirm rolls its dispatching mark back to prepared).
- **2A-2** Only the newest action of a scope changes its view; an older answer is dropped. The handle only moves forward:
  a settled state is final, `unknown` only settles, an older `receiptVersion` is `stale`; local steps keep the version.
- **2A-3** The 50-handle cap drops settled handles only; with 50 unresolved, a new send is refused with copy telling the
  owner to check or cancel pending ones. Updates to an existing handle always work.
- **2A-4** `bindIntent`: Prepare's answer must match the account, generation, draft revision, digest and exact text (another
  operation id only as convergence on the same submission); Confirm/Status/Cancel must name the same operation and its
  identity. `sent` needs the comment id, `rejected` its reason. A mismatch keeps the original handle and shows
  "unknown" with Check status.
- **2A-5** Cancel drops the handle only on a cancelled/expired answer for that operation; otherwise it stays and the draft
  box says the cancel was not confirmed.
- **2A-6** A converged operation's review opens only after its handle is durable; otherwise "couldn't save" and the
  original handle stays.
- **2A-7** "Send as public reply" with a stored handle and no saved draft reads the operation back; a failed lookup shows
  the uncertainty and an enabled Check status (never "checking" forever).
- **2A-8** The review shows the receiving comment: its text (from the loaded row whose id is the intent's parent, at most
  280 characters), its id and its `www.youtube.com` link; a row that is not that comment never lends its text.
- **2A-9** Clear draft acknowledges the same editor (see Sent above).
- **2A-10** A 2xx with an `error` or a non-comment `kind` is `unknown`.
- **2A-11** Request bodies read through a 16,384-byte streaming budget, cancelled on overflow before parse.
- Hardening: a refusal's message is kept without the seal key as well as the token.

## Repair DT-6B-2A-R2 (17 Oct 2026)

Client/UI only; Worker, coordinator and readers unchanged.

- **2A-R1-A** The action capture includes the active provider and a send-layer visit counter (bumped on every provider
  or channel move, observed from `useProviderInbox` without changing it). Leaving YouTube, or leaving and coming back,
  while Prepare or Confirm waits for storage means zero requests and a closed view; Confirm rolls its local
  `dispatching` mark back to `prepared`. A confirm already on its way is still recorded for Check status.
- **2A-R1-B** A Worker answer is shown only when it became the durable handle (same operation). A refused write
  (`stale`/`conflict`: another tab recorded newer proof or replaced the operation) shows `err.superseded` with the
  stored state and Check status for the operation actually stored; a storage failure shows `err.unrecorded`; a refusal
  before the claim never reopens Send over newer proof. No store change was needed: the handle after the write is
  read from the store.
- **2A-R1-C** `bindIntent` also compares `parentCommentId`, `videoId` and `threadId` when known. Confirm binds the
  reviewed intent; Status and Cancel bind the review this tab saw of the same operation; a bare handle (after a reload)
  binds only its own identity. A known mismatch keeps the handle and shows unknown + Check status.
- **2A-R1-D** With a stored operation, the sheet opens even without the send permission or target (or a Worker that
  says nothing about sending): the opener reads Check status, a note says sending is unavailable but the earlier reply
  can be checked, and the sheet never shows Send or Prepare again. Without a stored operation nothing changed.

## Readiness still open (not this packet)

- The YouTube connect flow asks for read scopes only; `capabilities.sendComments` stays `no_permission` until an
  owner-granted `youtube.force-ssl` connection exists (OAuth change is a separate, reviewed step).
- `SEND_COORDINATOR` and `v1-send` are local configuration; no namespace was created and nothing was deployed. The
  deployed Worker is newer than this tree: never deploy this checkout wholesale.
  Status (DT-6B-3A, 17 Oct): the three cached `origin/main` TikTok account/music Worker commits are reconciled locally
  into this tree (`planning/collaboration/dt6b3a-candidate/`); cached base; live deployment unverified. Still not
  deployed; the release checklist there lists the open blockers.
  Repair (DT-6B-3A-R1, 17 Oct, local only): the imported account module now keeps each TikTok account connection
  under a fresh id written only by the callback; a renewal is kept under its own connection
  (`tiktokads:account-refresh:<connection>`, expiring with its refresh token, ≤ 1 year), so a late renewal cannot
  replace a newer connection (music answers `409 account_changed` instead); a chart answer without an actual list is
  a `502 malformed_list` and never cached. Limits: KV is eventually consistent (account switching not linearizable);
  two renewals of the same connection may still race on TikTok's refresh token. Still not deployed.
- Token recovery is owner-triggered (sync or reconnect); the send path never refreshes.

## Verification

- Worker: `sendCoordinator.test.ts` (SQL logic over node:sqlite), `inboxSendYouTube.test.ts` (routes with the real
  coordinator over node:sqlite, fake KV/fetch), `inboxReadYouTube.test.ts` (sendRef, replyParentNote, sendComments; reads
  still pure), and `sendCoordinator.runtime.test.ts`: the bundled `src/index.ts` in workerd via the Miniflare shipped with
  the pinned Wrangler (binding and SQLite class read from `wrangler.jsonc`, on-disk storage across a runtime restart,
  concurrent claims and confirms, fake Google outbound). `@cloudflare/vitest-pool-workers` was not in the offline store.
- App: `lib/inbox.test.ts`, `store/index.test.ts`, `components/social/inbox/useSend.test.ts`, `SendReview.test.tsx`,
  `e2e/inbox.spec.ts` (DT-6B-2A cases).

## Threads reviewed replies (DT-6B-2B-1, Worker only, 17 Oct 2026)

Backend protocol only; the app is unchanged (UI is DT-6B-2B-2). Not deployed, nothing provisioned, no live provider
call (fake transport only). Production preparation is **closed**: every prepare and confirm answers
`403 no_permission` with `detail: "permission_unverified"`.

- **Target.** The Threads replies listing adds `sendRef` only to a direct reply under the owned post (`root_post.id`
  and `replied_to.id` both equal the post); unknown or other ancestry gets none. It is sealed in its own domain
  (`HMAC(INBOX_SEAL_SECRET, "send-target-v1|threads")`) and binds account, generation, root post and reply. The
  account answer adds `capabilities.sendReplies: "permission_unverified"` (never `ok` here). Reads stay pure.
- **Routes.** `POST /social/inbox/threads/send/prepare` `{ operationId, sendRef, text, draftRevision }`,
  `POST …/send/confirm` `{ operationId, digest, account }`, `GET …/send/:operationId?account`,
  `POST …/send/:operationId/cancel` `{ account }` (`src/social/inboxSendThreads.ts`).
- **Prepare.** Live token (no refresh), the eligibility gate, the sealed target for the current generation, text
  trimmed to 1–500 Unicode code points (`THREADS_SEND_TEXT_MAX`: local product policy, not a verified provider limit),
  then ONE bounded `GET /{reply}?fields=id,root_post,replied_to` (missing or mismatched ancestry `target_invalid`,
  404 `not_found`). Zero POSTs; the intent (text, digest, revision, 10-minute review) goes to the coordinator.
- **Token identity (DT-6B-2B-1-R1).** Both POSTs go to `/me/*` and act as whoever owns the token, and the OAuth
  callback writes a new token before the new `connectedAt`, so another account's token can briefly sit next to the
  old stamp and pass the generation check. Prepare (after the generation check) and confirm (before any coordinator
  call, so before the create claim and the created-resume publish claim) therefore require the stored token's own
  `userId` to equal the sealed account or the operation's account; a mismatch or a token without `userId` answers
  `409 { error: "account_mismatch", detail: "identity" }` with zero provider calls and zero claims. Status and
  cancel stay credential-independent. No OAuth change and no provider identity lookup.
- **Two stages, two claims.** Confirm re-checks token, gate, generation and digest. Stage 1: the atomic create claim
  (`prepared → creating`), then one `POST /me/threads` with `media_type=TEXT`, `text`, `reply_to_id` (never
  `auto_publish_text`). A 2xx with a plain string `id` and no `error` is the container, recorded durably
  (`creating → created`) before any publish claim. Stage 2: the atomic publish claim (`created → publishing`), then
  one `POST /me/threads_publish` with the stored `creation_id` only; a string `id` is `published`. A Meta-explained 4xx
  is `rejected` (`meta_<code>`, words scrubbed of token and seal). A timeout (15 s), broken connection, 5xx,
  malformed or contradictory success, or a receipt that cannot be written is `unknown_creation` (stage 1) or
  `unknown_publication` (stage 2). Both POSTs carry the token in the form body, never the URL.
- **Recovery.** Status and cancel make no provider call; cancel ends only `prepared`. A confirm on `created`
  (container durable, publish never claimed) re-validates token, gate, generation and the exact digest and continues
  at the publish claim only, never recreating. `creating`, `publishing` and both unknown states are never retried,
  reclaimed, expired or purged, and a new operation for the same submission returns them instead of a fresh intent.
  A crash mid-stage leaves `creating` or `publishing` (no lease, so no automatic move to unknown); 2B-2 must show both
  as "may have happened, check Threads".
- **Receipts.** `THREADS_SEND_COORDINATOR` (`src/social/threadsSendCoordinator.ts`, its own SQLite Durable Object and
  migration `v2-threads-send`, one object per `threads|<account>`); the YouTube `SendCoordinator`, its table, states,
  binding and `v1-send` migration are unchanged. `receipt_version` rises on every write. Finished rows (published,
  rejected, cancelled, expired) are purged after 90 days with tombstones; no token or seal key is stored.
- **Dashboard parser (DT-6B-2B-1-R1).** `lib/inbox.ts` accepts the two additive read fields, strictly: the Threads
  account's optional `capabilities.sendReplies` only as `"permission_unverified"`, and a reply row's optional
  `sendRef` as a 3–1,500 character string (the Worker's `SEAL_MAX`). Objects stay strict, other keys still reject,
  older answers without the fields still parse. The app carries `sendRef` but shows no send control (DT-6B-2B-2).
  `lib/inbox.wire.test.ts` feeds real `scout.handle` answers (fake Threads transport) to the real parsers.

### Readiness gap (blocks enabling the gate)

- The endpoint-specific permission for creating a reply, and a trusted record of what the connected account actually
  granted, are unverified: Meta's permission and reply pages answered 429 or were unavailable in Codex's audit, and
  the collection-level list (`threads_basic`, `threads_read_replies`, `threads_content_publish`,
  `threads_manage_replies`) is not an endpoint minimum. `threads.ts` stores the configured `TH_SCOPES`, not the grant,
  so no stored scope string, `canPublish` or browser flag opens the gate; only `threadsSendHandler({ eligibility })`
  can, and only tests pass one.
- The 500-code-point cap is local policy until a provider limit is verified.
- Follow-up, not in 2B-1: an explicit, bounded GET-only container-status reconciliation (`GET /{container}?fields=…`;
  `PUBLISHED` never triggers another publish and a container id never stands in for a published reply id).
- `THREADS_SEND_COORDINATOR` and `v2-threads-send` are local configuration only; nothing provisioned or deployed.

### Verification (2B-1)

`threadsSendCoordinator.test.ts` (SQL over node:sqlite), `inboxSendThreads.test.ts` (routes with the real coordinator
over node:sqlite, fake KV/fetch, injected eligibility, storage outages per call), `inboxReadThreads.test.ts`
(sendRef, sendReplies, still pure), and `threadsSendCoordinator.runtime.test.ts`: workerd via the pinned Wrangler's
Miniflare, both classes, bindings and migrations from `wrangler.jsonc`, the real entry (gate closed) plus a test-only
in-memory entry running the same handler with injected eligibility and failable coordinator calls; crashes and
storage failures at each claim, response and receipt, restarts on persisted storage, never a repeated stage.
`sendCoordinator.runtime.test.ts` changed only its binding and migration list expectation.

## Threads review and recovery UI (DT-6B-2B-2, app only, 17 Oct 2026)

App only; every Worker file, the readers, `lib/inbox.ts`, `useProviderInbox.ts`, `useInbox.ts` and the YouTube
client (`useSend.ts`, `SendReview.tsx`, `inboxSendOps`) are unchanged. Separate modules: `lib/inboxThreadsSend.ts`
(wire), `inboxThreadsSendOps` (store), `components/social/inbox/useThreadsSend.ts` (actions),
`ThreadsSendReview.tsx` (opener, sheet, recovery list).

- **Readiness.** `threadsSendReadiness()` is the only authority for Prepare, Send and Resume, and in production it is
  closed with the Worker's own literal `permission_unverified`. It never reads a seal, a stored scope, a receipt,
  `canPublish` or the account capability (still the strict optional literal; absent means an older Worker). No
  toggle, env flag or demo mode; the enabled path is exercised only by module mocks in unit/component tests.
- **What the owner sees.** A Threads direct reply with a `sendRef` shows "Send as reply" **disabled** with the reason
  (sending replies on Threads is not verified yet; Copy still works). Rows without a target, and older Workers, show
  nothing. "Check status" appears wherever a handle exists for the scope, whatever the capability, target or draft,
  and the Threads view lists every retained operation of the account on screen ("Threads replies to check") so a
  handle is recoverable with no row loaded, no draft and no permission.
- **Review.** Sending account, the owned root post (text when that post is loaded, its id always, and its existing
  validated permalink labelled as the post itself), the exact receiving reply id (its text only when that row is
  loaded), the canonical text and the review expiry. A published reply shows its id as text; no reply link is ever
  built from an id and the root link is never labelled as the reply.
- **States.** preparing, review, confirming (local mark), creating, created, publishing, published (Draft kept /
  Clear draft), rejected, unknown_creation ("may exist unpublished"), unknown_publication ("may have been
  published"), uncertain (local: Send may have left; lookup failed), superseded, save failed, expired, cancelled,
  closed and unavailable, each with its own EN/AR copy (`inbox.threadsSend.*`) and Check status on every retained
  operation. creating, publishing and both unknown states are status only. A durable `created` offers "Publish it"
  (resume: confirm on `created`, publish only, never a new container; not refused for the original review deadline),
  disabled in production with its reason.
- **Durability.** A saved draft revision is required. The handle (`operationId, account, draftRevision, digest,
  state, receiptVersion, containerId?, publishedId?`) is written through `commitFresh` (read back) BEFORE every
  request: `preparing` before Prepare, `confirming` before Confirm/Resume. Compare-and-swap on the operation id, then
  on the integer `receiptVersion`: older is stale, an equal version naming another state contradicts, a later one may
  only move forward along the two-stage order, a known container id never changes, settled states are final. Canonical
  convergence (another tab's operation for the same submission) opens review only after its durable write. A Worker
  answer is shown only when it became the durable handle of the same operation; otherwise the view says superseded or
  save failed and offers Check status for what is stored. Cap 50, settled handles evicted first, `capacity` when 50
  are unresolved; updates to an existing handle always succeed. No text, body or credential is persisted; the handle
  never reaches the media kit or the articles export.
- **Fences.** Each action captures the Worker URL + token, the config epoch, the provider visit (bumped on any provider
  move and any Threads account or generation change), the account + generation and its own session; it re-checks them
  after every await and right before the request (readiness too). A move means zero requests, a `closed` view and a
  rolled-back local mark; leaving Threads and coming back never revives the action. Only the newest action of a scope
  changes its view. Cancel is prepared-only and keeps the handle unless a cancelled/expired answer proves it.
  Published acknowledgement clears only the submitted revision; a newer edit survives.

### Verification (2B-2)

`lib/inboxThreadsSend.test.ts` drives the dashboard transport into the real `scout.handle` (production gate) and the
real `threadsSendHandler` with injected eligibility over the real coordinator on node:sqlite, capturing every stage's
receipt (prepared, creating, created, publishing, published, rejected at either stage, both unknowns, cancelled,
expired), the resume of a durable `created`, and the refusals (`permission_unverified`, `receipt-store`,
`account_mismatch/identity`); malformed, contradictory and incomplete receipts and binding mismatches reject.
`store/index.test.ts`, `useThreadsSend.test.ts` and `ThreadsSendReview.test.tsx` cover the CAS, fences, convergence,
capacity, storage and lookup failures, recovery and both languages; `e2e/inbox.spec.ts` checks the production
unavailable copy and a retained `unknown_publication` checked once after a reload (desktop and phone, EN and AR).

### Repair DT-6B-2B-2-R1 (17 Oct 2026)

Six client/recovery repairs from Codex's 2B-2 review; readiness stays closed (`permission_unverified`), the Worker and
the YouTube client are unchanged.

- **Immutable proof (2B2-1).** `bindThreadsIntent` also binds a known `publishedId` (like the container id): another
  id at any receipt version is `mismatch`, never recorded; the stored proof stays and the view says the answer didn't
  match, with the stored state and Check status. The store refuses, for the same operation, another container id or
  publication id (`stale`) and another `account`, `draftRevision`, `digest` or `workerOrigin` (`invalid`).
- **Exact commit (2B2-2).** `setInboxThreadsSendOp` also answers `current`: the handle the shared storage holds once
  the commit returned, read outside its lock. Status, Send/Resume, Cancel and canonical Prepare show an answer only
  when `current` is exactly that receipt (operation id, `receiptVersion`, state); a newer receipt of the same operation
  written meanwhile (another tab) gives "superseded" + Check status.
- **Handle-only recovery (2B2-3).** The handle records `workerOrigin` (2B-2 handles without it use the origin in their
  scope key, never the current one; the next durable write records it). Check status asks the handle's own stored
  account on its own Worker, whatever Threads account is on screen or when the account read failed; connection, visit
  and latest-action fences stay. A handle of another Worker gets no request and never this connection's token. The
  recovery list is mounted on the Threads tab even after an account error or with no account answer, lists every
  operation of the configured Worker, and names another Worker's operations in their own section ("can't be checked
  here"). Prepare, Send and Resume keep their account/generation/readiness checks; recovery grants nothing.
- **Clear sync (2B2-4).** A successful "Clear draft" (from the row or the recovery list) is announced in memory
  (`onThreadsDraftCleared`, scope + the discarded draft); every mounted editor of that scope stops building on that
  revision and clears only if it still shows that text, so newer typing stays and saves. A failed or skipped discard
  announces nothing. Instagram and YouTube editors never match a Threads scope.
- **Expiry (2B2-5).** The automatic lookup when the device clock passes the review deadline runs at most once per
  operation (an operation's deadline never changes); a still-prepared answer never asks again, even if it named
  another deadline. The `check` callback is memoised.
- **Manual status (2B2-6).** The review/confirming view uses the shared actions row: Check status (status only),
  Cancel (its own button, prepared only) and Close. Closing the sheet never cancels.
- **Verification.** Maintained regressions in the four unit files and seven new browser cases (desktop + phone):
  account error / another account on the same Worker (one GET for the handle's account), another Worker's handle
  (named, zero requests), list Clear with the same text and with newer typing (editor saves again), a retained review
  with manual Check status whose closing cancels nothing, and one automatic lookup past the device clock.

### Repair DT-6B-2B-2-R2 (17 Oct 2026)

Residual 2B2-R1-A only. A successful explicit Cancel from the row's review used to leave the still-open sheet on
"Checking the reply on Threads…" (phase `cancelled`, no intent, nothing pending).

- **Terminal view.** `cancelThreadsReply` now keeps the validated cancelled/expired receipt on the view when it removes
  the handle (phase `cancelled` or `expired`; no new store write, no new request). `ThreadsSendReview` renders the
  cancelled/expired branch before the missing-intent guard, so it shows with or without a receipt; the guard is left
  for pending views only. Copy: "Cancelled. Nothing was sent. The Worker ended this review and your draft wasn't
  touched." (Arabic in parity); an expired answer shows the expired copy. The handle is gone, so the actions row is
  only Close (plus Prepare again when readiness is open, never in production).
- **Unchanged.** A failed cancel keeps the handle, says so and offers Check status. Closing never cancels. Manual Check
  status, origin/account fences and the closed production readiness are untouched.
- **Verification.** Component: cancelled (EN/AR), expired and failed cancel from the row; hook: the kept receipt. Browser
  (desktop + phone): row Cancel in EN and AR (one `POST …/cancel` with the stored account, terminal copy, draft kept,
  in-body Close, nothing more sent), expired answer, failed cancel (handle + Check status kept).

## Instagram public comment replies (DT-6B-2C-1, Worker only, 17 Oct 2026)

The first bounded slice of 2C: reviewed **public** replies under comments on the owner's own Instagram media, and one
atomic claim of each comment's public reply shared with the automatic acknowledgement (`replies.ts`). Backend only.
**Not covered, still required:** replies inside existing DM conversations, conversation takeover, any UI, connection
readiness. 2C and the toolkit are not complete. Prior automatic sends and deployment cutover are not attested by this
packet (separate reconciliation work).

### Protocol

- Routes: `POST /social/inbox/instagram/send/prepare` `{ operationId, account, mediaId, commentId, text, draftRevision }`,
  `POST …/send/confirm` `{ operationId, digest, account }`, `GET …/send/:operationId?account`,
  `POST …/send/:operationId/cancel` `{ account }` (`src/social/inboxSendInstagram.ts`). Raw ids are selectors only.
- Gate: production prepare and confirm answer `403 no_permission` / `permission_unverified` before any provider call.
  Only `instagramSendHandler({ eligibility })` opens it, and only tests inject one. `canReply`, stored/requested
  scopes, the readers' capabilities and browser settings never open it.
- Prepare captures the token and `connectedAt` once, checks text (trimmed, 1–1,000 code points: `IG_SEND_TEXT_MAX`,
  local policy), proves the target (below), then the final fence (token and status read together, the token read once
  more after the status, all equal to the capture: `409 stale` / `reconnected` on any change; nothing else awaited
  before the write), and stores the immutable intent (account, generation = hash of account + `connectedAt`, media, comment, exact text,
  SHA-256 digest, draft revision, 10-minute review). Same operation + payload converges; a changed payload conflicts;
  another operation for the same account/revision/comment/digest converges. Prepare reserves nothing.
- Confirm re-checks token, gate, generation, digest and expiry, proves the target again, runs the same fence
  immediately before the claim, then claims (below) and makes at most ONE dispatch. Status and cancel use only the
  owner bearer and the stored operation (zero provider calls); cancel ends a prepared intent only and never frees a
  claimed comment. Receipts carry a monotonic integer `receiptVersion` and the provider reply id once sent.
- DT-6B-2C-1-R1: the clock is read afresh at the eligibility check, every deadline, the claim and the receipt
  (`routes.ts` passes a live clock): a review that runs out during the confirm GETs is `expired` and a token that
  expires during them is `409 token_expired`, both before any claim or POST. Every coordinator answer must be bound to
  the request (operation or submission, account, comment, actor, state, integer `receiptVersion`, and the settled
  outcome with its reply id); anything else is `receipt_unavailable` before a POST and `unknown` (`receipt`) after
  one. A repeated settlement counts only when the durable row already records the same outcome.
- DT-6B-2C-1-R2: every intent answer must be a complete typed intent (all fields, a supported state, and that state's
  proof: `sent` its reply id, `rejected` a failure code, `unknown` a reason, `already_claimed` who holds the comment)
  bound to what the phase already knows: prepare to the exact reviewed submission (account, generation, media, comment,
  text, digest, revision; a converging operation may answer its own id and times), the claim and the receipt to the
  validated intent's whole payload (the receipt also to its outcome), status and cancel to operation and account. A
  coordinator answer carrying an `error` beside anything else is never proof (manual and automatic): before a POST it
  is `receipt_unavailable` / `not_configured` (`public-claim-store`) with nothing sent; after one the delivery stays
  `unknown` and uncounted. A pure error answer keeps its mapping.

### Ownership: the local verification window

At most three bounded GETs per prepare/confirm with the one captured token, all on `graph.instagram.com/v21.0`
(`verifyTarget`, `src/social/instagramPublicSend.ts`): `/me?fields=user_id,username` (identity = `user_id`, as the
Inbox reader uses it; never compared to or assumed equal to OAuth `tokens.userId`; a different account is
`account_mismatch` before any list is read), `/{user_id}/media?fields=id&limit=50` and `/{media}/comments?fields=id&limit=50`.
First pages only (`IG_VERIFY_PAGE = 50`, local policy), no `paging.next`, no cursor crawl, 256 KB per page, exact typed
membership. A target not on those pages is `target_unverified` with `detail: "outside-local-window"`: outside this
window, never proof of deletion. A malformed page is `upstream`. Replies to replies are not on the comment page and
are therefore not supported. A broader target-proof chain is later reviewed work.

### One public effect per comment (manual and automatic)

`InstagramPublicSendCoordinator` (`src/social/instagramPublicSendCoordinator.ts`, SQLite Durable Object, binding
`INSTAGRAM_PUBLIC_SEND_COORDINATOR`, migration `v3-instagram-public-send`, one object per `instagram|<user_id>`) holds
`intents`, `public_effects (account, comment_id) PRIMARY KEY` and `tombstones`.

- `claimConfirm`: ONE transaction: intent `prepared → dispatching` (UPDATE … RETURNING), then
  `INSERT INTO public_effects … ON CONFLICT DO NOTHING RETURNING`. An existing effect (or its tombstone) turns the
  intent `already_claimed` (terminal, `failureDetail` `automatic`/`manual`/`retired`) and nothing is sent.
- `claimAuto` (`replies.ts`, only at its existing public branch, after the DM went out): the same insert as
  `auto:<automationId>`; the loser gets the existing row and logs `publicReply: "skipped"`, `detail: "already_claimed"`.
  A missing/unreadable coordinator logs `publicReply: "failed"`, `error: "not_configured"`,
  `detail: "public-claim-store"` and posts nothing (no KV lease, no direct send). DM-first order, matching, pause,
  budgets, caps, eligibility, log shape and `handled` are unchanged; the manual path never sends, cancels or claims a DM.
- `settle`: once, by the claiming actor only, mirrored into the manual intent. The automatic client
  (`publicEffects`) accepts a claim only with the claimed row of exactly that account, comment and `auto:<id>`, and a
  receipt only when the row records exactly the posted outcome; otherwise no POST (`public-claim-store`) or
  `unknown-delivery`, never counted.
- **Local restriction of this slice (not an Instagram rule): one public attempt per comment.** A claimed effect is
  never reopened by expiry, purge, failure or a new operation; an explicit follow-up/override is later reviewed work.
  `claimed` and `unknown` effects never expire or purge; finished rows purge after 90 days into tombstones, so nothing
  purged is usable again. The purge runs from `prepare`, `claimAuto` and `settle` (automatic-only traffic purges
  too), at most once an hour (`PURGE_EVERY_MS`; the last run is kept in the object's `meta` table, in the purge's own
  transaction).

### Dispatch

`dispatchPublicReply` (shared by both paths): `POST /{comment-id}/replies` form `{ message, access_token }`. The form is
the one the automation already used: a fixture boundary, not freshly verified against Meta's current
permission/API-version rules. One attempt, 15-second abort, 256 KB answer, no retry, no template substitution (the
automation passes its exact filled text). 2xx with a plain string `id` and no `error` → `sent` (counted only once its
receipt is durable); a 4xx with Meta's TYPED error body (an object with an integer `code`) → `rejected` (the
automation keeps its Meta mapping and stop policy); timeout, network, 5xx, any 3xx (`redirect: "manual"`: never
followed, so the token and text reach one destination only), malformed (including an untyped error body),
contradictory or oversize answer, or a lost receipt → `unknown` (the automation logs `detail: "unknown-delivery"`).
Nothing uncertain is ever re-dispatched. The refusal words are scrubbed of the token and the seal key (the automation
passes `INBOX_SEAL_SECRET` too), and the rejected `reply` handed to the automation's mapping holds only those scrubbed
words, so its log, tick error and receipt never carry them.

### Readiness gap (blocks enabling the gate)

Public-endpoint permission and API-version semantics for Instagram Login and a trusted record of the account's actual
grants are unverified (primary Meta pages could not be retrieved; the existing source form is fixture evidence only).
No OAuth change, refresh, new secret/grant or live validation was made. Nothing is provisioned or deployed.

### Verification (2C-1)

Unit (node:sqlite coordinator, fake KV/fetch): coordinator atomicity in both orders, duplicate automatic claims, actor
and account isolation, settle once, cancel never frees, tombstones; the handler's closed gate (zero fetch), `/me`
identity vs a different OAuth user id, forged/out-of-window selectors, reconnect split writes during prepare and right
before the claim, concurrent confirms, storage failures, refusal vs uncertain outcomes, lost receipt, scrubbed words;
`replies.ts` poll-vs-manual in both orders, duplicate ticks, missing/unreadable coordinator. Runtime
(`instagramPublicSendCoordinator.runtime.test.ts`, workerd via the pinned Wrangler's Miniflare, fake Instagram): real
entry loads all three classes with the gate closed; manual/poll in both orders and racing; overlapping polls; restarts
before/after the claim, with the POST in flight, after the provider answered, after a failed and a committed receipt,
and a poll crashing mid-POST; never a second public POST.

## Instagram existing-conversation DM authority (DT-6B-2C-2, Worker only, 17 Oct 2026)

The durable authority of the automation's **existing-conversation** DMs (message rules and the default reply,
`inbox.ts::answerInbox`), with internal manual-claim and takeover/resume primitives. Backend only. **Not covered, still
required:** an externally callable manual DM route and takeover/resume routes (the next packet), any UI, connection
readiness, and comment-triggered private replies (`comment_id` recipients stay in pinned `replyCore.ts`: this is not a
global Instagram DM takeover). The manual production gate stays closed; no new refresh, grant, scope or route.

### Authority model

`InstagramDmCoordinator` (`src/social/instagramDmCoordinator.ts`, SQLite Durable Object, binding
`INSTAGRAM_DM_COORDINATOR`, migration `v4-instagram-dm`, one object per `instagram-dm|<user_id>`), separate from the
public-reply, Threads and YouTube coordinators. Tables: `conversations (conversation_id, mode auto|human, revision)`,
`effects (account, conversation_id, inbound_message_id) PRIMARY KEY` with recipient, actor (`auto:<ruleId|default>` or
`manual:<operationId>`), exact payload digest, connection generation (audit only, never resets history), state
`claimed|sent|rejected|unknown`, proof fields and an integer `receipt_version`; `default_cooldown (account,
recipient_id)`; `tombstones`; `meta`. No network inside the coordinator, no timeouts anywhere.

- `claim`: ONE transaction. An automatic actor in a `human` conversation → `blocked_by_takeover` (with the revision);
  an effect or tombstone for the inbound event → `already_claimed` with the existing row (same event by another actor,
  a duplicate poll, a same-account reconnect); the default reply inside its per-recipient cooldown → `cooldown`; else
  the effect is inserted `claimed` and, for the default reply, the cooldown upserted in the same transaction. The key
  is the inbound message, so a later turn in the same conversation is never locked. A manual actor (the person's own
  send, internal only) is not blocked by takeover.
- `settle`: once, by the claiming actor: `sent` needs a non-empty message id, `rejected` a code, `unknown` a reason.
  The cooldown stays reserved after `sent` and `unknown` (conservative); only a typed `rejected` releases it.
- `takeover` / `resume`: compare-and-set on the expected revision (stale → `conflict` with the current conversation;
  revision + 1 on a change). Takeover answers the `claimed` effects in flight (it cannot retract an authorized POST)
  and blocks later automatic claims; resume is explicit and never frees a claimed or unknown effect. Zero provider
  calls. `status` answers the conversation and one effect.

### Automation integration (`answerInbox`)

Per tick, after the poll's token refresh, `dmTick` (`src/social/instagramDmSend.ts`) takes the account from a fresh
`GET /me?fields=user_id` (reused when the poll fetched `/me` this tick; never the cached `PollState.igUserId`, the OAuth
`tokens.userId`, the username or client participants), reads the conversations with that account and captures the
status stamp. A failed or malformed `/me` is a failed conversations read: nothing is claimed. Recipient = the
conversation's person (`batch.personId`), inbound = `item.id` / `item.ms`; a malformed id is `dm: "skipped"`,
`detail: "unavailable"`, with no claim. DT-6B-2C-2-R1: each item carries its own sender, set only when the whole
conversation has exactly one customer (one distinct non-owner `from.id`); an answer goes out only when that sender is
the batch's person. A message from another sender, without one, or in a conversation with two customers is also
`dm: "skipped"`, `detail: "unavailable"`, handled, no claim, no POST (never inferred from another message or a
username). The payload (exact body and its SHA-256) is prepared first; then, immediately before each claim, the final
fence re-reads token and status together and the token again (all equal to the capture) and takes a fresh clock,
which also re-checks the local 24-hour window (an item that aged out is left alone, as the read leaves older
messages); nothing is awaited between that fence and the claim, which carries the fence's time. Matching, first-poll
baseline, chronological progress, skip rules, pause, comment DM-first/public order and exact text/buttons are
unchanged. The per-tick answer cap counts every DM that reached the provider (sent, refused or unknown, including a
lost receipt), on top of the comments' sends; claims that never POST (already claimed, takeover, cooldown) use no
slot. `sends` still counts proven deliveries only.

| Outcome                                   | Log                                                                 | Item     | Counters                         |
| ----------------------------------------- | ------------------------------------------------------------------- | -------- | -------------------------------- |
| claimed + sent (validated receipt)        | `dm: "sent"`                                                        | handled  | `sends` + 1, `sent[mid]` kept    |
| claimed + typed refusal                   | `dm: "failed"`, Meta's mapping (stop policy kept)                   | handled  | `failures` + 1                   |
| claimed + unknown / lost receipt          | `dm: "failed"`, `error: "upstream"`, `detail: "unknown-delivery"`   | handled  | none                             |
| `already_claimed`                         | `dm: "skipped"`, `detail: "already_claimed"`                        | handled  | none                             |
| `blocked_by_takeover`                     | `dm: "skipped"`, `detail: "takeover"`                               | handled  | none                             |
| sender not the conversation's one customer | `dm: "skipped"`, `detail: "unavailable"` (no claim)               | handled  | none                             |
| `cooldown`                                | none (today's default-reply suppression)                            | handled  | none                             |
| no binding / unreadable / unbound answer  | `dm: "failed"`, `error: "not_configured"`, `detail: "dm-claim-store"` | retried ≤ 3, DMs stop | none                |
| fence: reconnect / expired / disconnected | `dm: "failed"`, `upstream` `reconnected` / `token_expired` / `not_connected` | waits, tick stops | `failures` + 1 |

Once an effect is claimed, neither retry counters nor another poll, actor, revision or reconnect replays it (the earlier
"retry a 5xx / permission refusal up to three times" no longer applies after a claim; it still applies before one).
`state.defaultSentAt` is still written for display; the coordinator's `default_cooldown` is the authority.

### Dispatch

`claimAndSend`: a claim answer bound to exactly this account, conversation, recipient, inbound message, actor, payload
digest and generation (integer receipt version, the conversation's identity, no `error` property: an `error` beside
matching fields is never proof) precedes ONE `POST /{user_id}/messages` with the exact body `replyCore.sendReply`
sends to an `{ id }` recipient (`{ recipient: { id }, message }`, bearer header, generic card for short text with
links, else text with link lines), `redirect: "manual"`, 15-second abort, 256 KB streaming budget. Sent only with a
non-empty string `message_id`, `recipient_id` equal to the expected recipient and no `error`; a 4xx with Meta's typed
error (integer `code`) → `rejected` (`meta_<code>`; the scrubbed words feed the existing mapping); anything else →
`unknown` (`redirect`, `timeout`, `network`, `server`, `malformed`, `oversize`, `recipient`, or `receipt` when the
settlement could not be validated). Token and seal are scrubbed from every word kept; the coordinator stores codes only.

DT-6B-2C-2-R1: `prepare` computes the body and its digest (the attempt's only asynchronous work) before the caller's
fence; `claimAndSend` given it checks the body is this attempt's and starts the claim with no await. Claim and receipt
answers are proof only for the complete attempt: key, recipient, actor, payload digest, generation, the claim's own
time (`claimedAt` = the fenced time, exact ISO), an integer receipt version and exactly the state's fields (a claim
has no `settledAt` or outcome proof; a settled row has a valid `settledAt` and only its outcome's proof). Anything
omitted or changed → `unknown` (`receipt`), no replay; a repeat of the same outcome (`settled: false` over the same
row) still counts. A 4xx carrying `message_id` or `recipient_id` beside a typed error is contradictory → `unknown`
(`malformed`): the effect is not released and the default reply's cooldown stays reserved; a genuine typed refusal
still releases only its cooldown, never its inbound message.

### Budget (per poll tick)

Three separate counts (DT-6B-2C-2-R1 correction; no limit changed):

| Per tick                      | Provider (external HTTP)       | Durable Object calls (internal)      | KV reads                    |
| ----------------------------- | ------------------------------ | ------------------------------------ | --------------------------- |
| DM tick setup                 | 1 GET `/me` (0 when reused)    | 0                                    | 1 (status)                  |
| each DM claim attempt         | 1 POST (only once claimed)     | 1 claim (+ 1 settle once claimed)    | 3 (fence)                   |
| DM side, `REPLY_CAP` = 8      | ≤ 10 (`/me`, conversations, 8) | ≤ 16 for 8 POSTed DMs                | 1 + 3 per claim attempt     |
| public replies (DT-6B-2C-1)   | inside the comment calls       | ≤ 16 (claim + settle), not budgeted  | none                        |

`REPLIES_FETCH_BUDGET` (30, unchanged) is a conservative debit pool shared by the tick's provider requests AND the DM
coordinator calls: a DM reserves its 3 calls (POST + claim + settle) before its claim, so the receipt always has its
call, and a claim that is skipped (already claimed, takeover, cooldown) spends 1. So provider requests and DM
coordinator calls together stay ≤ 30; the public reply's coordinator calls (≤ 16, pre-existing) come on top of the
Durable Object count only. KV reads are not in either count: they are listed on their own (Cloudflare limits external
subrequests, internal service calls and KV operations separately; current figures not re-verified here).

DT-6B-2C-2-R2 (partial-conversation checkpoint): when the cap, the budget, a pre-claim retry or a tick stopper leaves
a conversation partly handled, `seenAt` is `min(last handled, first unhandled − 1 ms)` (unchanged when nothing in it
was handled); a fully handled conversation still moves to its newest message. Same-time messages before the stop are
read again on the next poll; their claims answer `already_claimed` (no POST, no cap slot, 1 debit each from the same
pool of 30), so the reread is bounded by the existing budget and no limit changed. State schema unchanged.
`REPLY_CAP` (8) is unchanged and now counts DMs that reached the provider, not only proven sends.

DT-6B-2C-2-C1 (exhausted pre-claim retry): the third pre-claim failure (`dm-claim-store` / `dm-account`) records
`PollState.givenUp[messageId] = message time` (optional private field; old saved state without it loads as `{}`).
When the checkpoint reads that message again with its same-time group, it is handled without a claim, a log row, a
failure or a new retry count, and the loop continues, so a later valid message sharing the time is sent once. The
position never passes an unattempted message and nothing claimed or sent is invented. The mark is deleted when the
conversation's position reaches its time, and at poll start once it is older than the 24-hour window. `replies.ts`
changes only the field, its `{}` default and that poll-start expiry.

### Retention

`claimed` and `unknown` effects are kept forever. `sent` / `rejected` effects older than 90 days are purged into
permanent tombstones (nothing purged is claimable again), cooldown rows older than that are dropped; the purge runs
from `claim` and `settle` (automatic-only traffic purges too), at most hourly (`meta`), in its own transaction (a
failure rolls back and is retried). Conversation modes and revisions are never purged.

### Limits

No external manual DM or takeover route, no UI, no readiness; comment-private DMs unchanged; the 24-hour window is the
Worker's local ceiling, not verified current provider policy. Since DT-6B-2C-2-R1 the dashboard reads `dm: "skipped"`
(`lib/domain.ts`) and shows it as its own neutral log outcome («DM skipped» / «تخطّينا الخاص», muted, with the reason
code), never as failed; nothing else in the app changed (no send/recovery UI). Prior automatic sends and deployment
cutover are not attested; nothing is provisioned or deployed.

### Verification (2C-2)

Unit (node:sqlite coordinator, fake KV/fetch): claim/settle/takeover/resume CAS, cooldown across different inbound
events, duplicate events across actors/reconnect, rollback, purge/tombstones; the send's exact payload, every unknown
class, typed refusal and scrub, claim/receipt validation including mixed envelopes; the real `answerInbox` and
`pollReplies` through the coordinator. Runtime (`instagramDmCoordinator.runtime.test.ts`, workerd via the pinned
Wrangler's Miniflare, fake Instagram): real entry with four classes; competing claims; takeover before/after a claim;
stale resume; concurrent default cooldown; retention; the real poll with lost results, overlapping polls, an internal
manual claim, malformed/foreign receipts, a reconnect to another account, a missing binding, and restarts before the
claim, during the POST, after the provider answered, at a failed and a committed receipt: never a second DM POST.

### Verification (2C-2-R1)

Codex's independent send (30) and poll (16) probes, copied unchanged into writer scratch, pass; added unit cases:
receipts changing or omitting recipient/digest/generation/times/version, invalid `claimedAt` before the POST, the
same-outcome repeat; contradictory 4xx keeping the cooldown and the genuine refusal releasing it; preparation before
the fence (no digest between fence and claim, a reconnect during the digest caught); foreign/missing/ambiguous senders
through the real reader and poll; the cap with all-uncertain and mixed outcomes, progress on the next tick; the
skipped document through the app parser, the log row (EN/AR) and `e2e/autoreplies.spec.ts` (EN desktop, AR phone).

## Reviewed existing-conversation DMs and takeover/resume (DT-6B-2C-3, Worker only, 17 Oct 2026)

The externally callable manual side of the DM authority above: a reviewed plain-text DM answering one inbound message
of a conversation the person opened, and an explicit, revision-checked takeover/resume of one verified conversation
(`src/social/inboxSendInstagramDm.ts`, routes under `/social/inbox/instagram/dm/`). Backend only. **Not covered,
still required:** any UI, connection readiness (verified DM permission, window and API-version semantics, actual grant
evidence), attachments/buttons, unsolicited DMs, comment-private DM coordination, a global takeover. No implicit
takeover on Send and no Send on takeover/resume.

### Gate (stated before implementation)

Handler factory `instagramDmHandler({ fetch, now, eligibility })`. Without `eligibility` (production, routes.ts)
prepare, a NEW confirm and the initial control registration answer `403 no_permission` / `permission_unverified`
before any provider call. Only test factories inject `{ ok: true }`. Never derived from `canReply`, requested scopes,
reads or settings. Durable recovery is always available with the bearer alone: status, cancel, a repeated confirm of an
operation past `prepared`, and control status/takeover/resume of an existing handle (no token, grant, inbox row or
provider call).

### Protocol

| Route | What it does |
| --- | --- |
| `POST dm/send/prepare` | gate → text canonicalized once → ownership chain → digest → final fence → immutable intent (no POST, no mode change) |
| `POST dm/send/confirm` | durable state first → digest → gate → generation → chain over the STORED target → stored bytes re-hashed → fence → ONE `claimConfirm` → ONE POST → ONE `settleManual` |
| `GET dm/send/:op?account` | the intent (recovery) |
| `POST dm/send/:op/cancel` | prepared → cancelled; anything else answered as it stands |
| `POST dm/control/register` | gate → chain (recipient taken from the verified page) → fence → opaque handle (a repeat converges) |
| `GET dm/control/:handle?account` | conversation mode/revision, ≤ 20 in-flight claims, `inFlightTotal`, `inFlightTruncated`, `uncertainTotal` |
| `POST dm/control/:handle/takeover` | revision CAS → human; reports in-flight attempts, cannot retract them |
| `POST dm/control/:handle/resume` | revision CAS → auto; frees no effect or cooldown |

- **Canonical text**: trim, Unicode NFC, trim, lone surrogates refused, at most `DM_TEXT_BYTES_MAX` (1,000) UTF-8 bytes
  of the canonical `message.text` (Meta's documented limit; DT-6B-3C replaced the earlier 1–1,000 code-point policy).
  Stored, returned for review (`intent.text`), and the POST body is exactly
  `{"recipient":{"id":<recipientId>},"message":{"text":<intent.text>}}`, rebuilt from the stored intent; its SHA-256
  is `intent.digest` and the effect's payload digest. The automatic serialization (`bodyOf → messagePayload`, which
  trims) is unchanged.
- **Ownership chain** (≤ 3 GETs on the fixed `IG_API` host, first pages only, `redirect: "manual"`, 15 s and 256 KB
  each, never `paging.next`, the one captured token): `/me?fields=user_id,username` = `account` (never the OAuth
  `tokens.userId`); `/{account}/conversations?platform=instagram&fields=id&limit=20` lists the conversation;
  `/{conversation}?fields=messages.limit(20){id,created_time,from}`: every row has an id, a sender id and a valid
  time, exactly one non-owner sender; for a send the inbound id is that customer's message. Fail closed: absent →
  `target_unverified` / `outside-local-window`; `target_invalid` with `own-message`, `mixed-senders`,
  `foreign-recipient`, `future-time`, `window-closed` (by the fenced clock), `no-customer` (registration),
  `inbound-changed` (confirm); malformed → `upstream` / `malformed page`. Endpoint and expansion shapes are fixtures
  until readiness review.
- **Fence**: all hashing and GETs finish first; then token + status, token again, all equal to the capture (`stale`
  / `reconnected`), a fresh clock (`token_expired`, review/window expiry), and the coordinator call with no await in
  between.
- **Review deadline**: min(fenced + 10 minutes, inbound time + 24 hours); both are local policy, not verified
  provider rules.

### Coordinator (additive to `InstagramDmCoordinator`)

New tables `intents` (operation id, submission key, account, generation, conversation, recipient, inbound id and time,
text, digest, draft revision, state, deadlines, proof, receipt version; unique live submission) and `controls` (handle,
account, conversation, recipient, registration generation, evidence digest, created/used); operation tombstones
`op|<id>` beside the effect tombstones. Effects, cooldowns, modes and their operations are unchanged; `claim` and the
CAS were split into a transaction wrapper over the same body so `claimConfirm` and the handle CAS reuse them.

- `prepareIntent`: same id + every immutable field → that intent; any changed field → `conflict`; another id for the
  identical live submission → that intent; a tombstoned id → `conflict`. Claims nothing.
- `claimConfirm`: ONE transaction: prepared, unexpired, digest equal → the automation's own claim body with actor
  `manual:<operationId>` (not blocked by human mode, never changes it) → intent `dispatching`; an existing effect or
  tombstone → intent `already_claimed` (`automatic | manual | retired`), zero POST. Anything past prepared answers its
  durable state.
- Settlement: the existing `settle` updates a manual actor's intent in the same transaction (`settleManual` addresses
  it by operation); state, proof and receipt versions move once; a repeat is `settled: false`.
- Expiry: a prepared intent past its deadline becomes `expired` and its id is tombstoned before any call reads it.
- Capacity: `INTENTS_OPEN_MAX` 200 open (prepared + dispatching) intents and `CONTROLS_MAX` 100 handles per account →
  `capacity` (`429`); nothing is evicted. Unknown intents are retained and not counted.
- Retention: the existing hourly purge (also under automatic-only traffic, transactional, rolled back on failure)
  tombstones and deletes terminal intents (sent, rejected, already_claimed, cancelled, expired) after 90 days and
  deletes handles unused for 90 days. It never touches modes, claimed/unknown effects, dispatching/unknown intents or
  cooldowns, and a purged id is never reusable.
- The internal raw `takeover`/`resume` ops keep their accepted answer (unbounded in-flight list, no route).

### Budget (per request)

| Request | Provider (external) | Coordinator (internal) | KV reads |
| --- | --- | --- | --- |
| prepare | ≤ 3 GETs | 1 (`prepareIntent`) | 5 (tokens, status, fence 3) |
| new confirm | ≤ 3 GETs + 1 POST | 3 (`getIntent`, `claimConfirm`, `settleManual`) | 5 |
| repeated confirm / status / cancel | 0 | 1 | 0 |
| registration | ≤ 3 GETs | 1 (`registerControl`) | 5 |
| control status / takeover / resume | 0 | 1 | 0 |

Provider GETs draw on their own `Budget(3)` and the POST on `Budget(1)`; coordinator calls are not taken from either,
so the settlement always has its call (reserved). The worst request is 4 provider + 3 coordinator + 5 KV = 12
subrequests. No cap is raised; the automation's budget is untouched.

### Verification (2C-3)

Unit (node:sqlite coordinator; fake KV and fetch; real router for auth/gate/wiring): immutable intents, convergence
versus id reuse, claimConfirm over the automation's effect in both orders and both modes, tombstoned events, digest
conflicts, rollback of the intent write, atomic settlement (and its rollback), cancel/expiry/capacity, handle
registration/convergence/conflict/capacity, handle CAS with bounded in-flight rows, purge under automatic-only traffic;
the transport seam (exact bytes, budget, every unknown class, scrubbing, unchanged automatic trim); the handler's gate,
offline recovery, canonical text (whitespace, CRLF, NFC, supplementary characters, lone surrogates), every chain
refusal, token-first/status-first reconnects and token/window expiry during held GETs, exact POST bytes, replacement
fields ignored, already_claimed, takeover, expiry during GETs, re-proof, unbound claim answers, typed refusal with and
without its settlement, lost success receipt, malformed/mixed/redirect/5xx/oversize/mid-body answers and no replay.
Runtime (workerd, current binding, fake Instagram): real entry stays closed and recovers offline; manual first, poll
first, a poll racing three duplicate confirms, cancel racing confirm, takeover through a handle, bounded rows,
capacity, expiry, tombstones and retention; restarts after a failed claim, with the POST in flight, mid-body after the
headers, after a complete body whose settlement was lost, after an observed typed refusal whose settlement was lost,
and after a committed receipt: never a second DM POST.

### DT-6B-2C-3-R1 repairs (17 Oct 2026, Codex findings 2C3-1 … 2C3-6)

- **Ownership pages** (prepare, confirm re-proof, registration; before any coordinator mutation, claim or POST): a page
  is proof only as a plain object without any `error` key (also `null`/`false`; else `upstream` / `malformed page`).
  A returned conversation `id` other than the requested one is `target_invalid` / `foreign-conversation` (an omitted
  one is not a new requirement). One message id twice with another time or sender is `ambiguous-message`. Absent or
  beyond the first page stays `target_unverified`; no pagination. The pinned generic helper is unchanged.
- **Owner identity**: the fresh `/me` user_id only. A username is a label that must pair with exactly one sender id on
  the page, the owner's included; a non-owner id with the owner's username, the owner id under another username, one
  id under two usernames or two ids under one username are `ambiguous-identity`. Exactly one distinct non-owner id is
  the customer. Limit: if the provider ever showed the owner under a different sender id, sends fail closed until that
  mapping is independently proved.
- **Intent receipts**: one table of required and forbidden proof per state (`prepared`, `cancelled`, `expired`: none;
  `dispatching`: `claimedAt`; `sent`: `claimedAt`, `settledAt`, `providerMessageId`; `rejected`: `claimedAt`,
  `settledAt`, `failureCode`; `unknown`: `claimedAt`, `settledAt`, `unknownReason`; `already_claimed`: `failureCode`
  `already_claimed` and `failureDetail`). The claim answer must be exactly the known version + 1 (a lost-claim answer
  newer than it); the settlement intent and effect must be newer than their claim. Anything else: zero POST
  (`receipt_unavailable`) before dispatch, `settlement: "pending"` after it; never replayed. Same-outcome
  `settled: false` and offline terminal recovery unchanged.
- **Control CAS answers**: takeover must answer `human`, resume `auto`; `changed: true` at `expectedRevision + 1`,
  `changed: false` at `expectedRevision`. A stale revision is answered as a pure conflict
  `{ error, conversation: { account, conversationId, mode, revision }, control: { handleId, account, conversationId,
  recipientId } }`, where the coordinator's conflict now carries the handle row and the route binds the conversation to
  it; a foreign conversation, another handle or a revision equal to the expected one is `receipt_unavailable`. No CAS
  rerun, no provider call, no credentials.
- **Control and in-flight proof**: the complete typed handle (handle, account, conversation, recipient, registration
  generation, evidence digest, created/used times) and complete claimed rows (key, recipient, actor, generation,
  payload digest, claim time, version; no settlement field) whose account, conversation and recipient are the handle's;
  any mismatch refuses the whole answer. Bounded rows and truthful totals unchanged. Limit: a claimed row for another
  recipient in that conversation makes the view unreadable (fail closed).
- **Handle activity**: a successful `controlStatus` refreshes the handle's `used_at` (its last use, `MAX` so a clock
  moved back never ages it) in its own small write; no mode, revision or effect change, no CAS, no provider call. A
  handle read at day 89 survives the day-91 purge; a never-used handle still goes at 90 days.

## Instagram public-comment review and recovery UI (DT-6B-2C-4, app only, 17 Oct 2026)

App only; every Worker file, the readers, `useProviderInbox.ts`, `useInbox.ts`, the YouTube and Threads clients and the
conversation/DM UI are unchanged. DM review/send/takeover UI is the next packet (C5). Separate modules:
`lib/inboxInstagramSend.ts` (wire), `inboxInstagramSendOps` (store, keyed `instagram|<comment draft scope>`),
`components/social/inbox/useInstagramSend.ts` (actions), `InstagramSendReview.tsx` (opener, sheet, recovery list).

- **Readiness.** `instagramSendReadiness()` returns the literal `permission_unverified` in production, independent of
  reader capabilities, saved scopes, `canReply`, settings and receipts. Prepare/Send take `{ readiness }` only as a test
  injection; there is no toggle. Check status and Cancel of a prepared review never ask readiness, a row, a draft or the
  account read.
- **What the owner sees.** Under each Instagram comment's draft: "Send as public reply" **disabled** with the reason
  (public replies are not verified yet; Save and Copy still work). Below the Instagram view, outside the account and
  capability branches, "Instagram public replies to check" lists every retained operation of the configured Worker,
  whatever account is on screen (or none, after an account read failure), each with Check status (and Cancel while
  prepared); operations of another Worker, or all of them while no Worker is configured, are named with zero requests.
- **Contract details.** Two generations: the Inbox reader's HMAC generation fences UI visits/account; the send generation
  (`ig-send-gen|account|stamp`) is learned from the prepared intent and bound after that; they are never compared. Text
  is trim-only (≤ 1000 code points) and the digest is SHA-256 of the exact trimmed text (not the DM NFC/body rules); the
  review shows the Worker's canonical text. Raw `{ account, mediaId, commentId }` selectors go to the Worker, which
  re-proves them. Wire states `prepared | dispatching | sent | rejected | unknown | already_claimed | expired |
  cancelled`; `sent` needs its reply id, `unknown` may lack a settled time (a lost receipt), `already_claimed` names
  automatic/manual/retired; mixed or unknown-key envelopes and redirects are never proof (`redirect: "manual"`); only
  allowlisted error details are kept.
- **Review.** Sending account, the owned post (caption only from the row of this operation's Worker origin, account and
  media; its validated permalink labelled as the post itself, never the comment), the exact comment (author and text
  only from the matching row, else ids and "preview unavailable"), the canonical text and a local countdown that can
  turn Send off (only a Worker receipt proves expiry; nothing is asked by itself). A sent reply shows its id as text; no
  link is built from it. `already_claimed` names the holder with no Send. Clear draft after sent discards only the sent
  revision and reaches every mounted editor through the exact-revision acknowledgement; newer typing survives.
- **Durability and fences.** `preparing` is persisted before Prepare and the pending-confirm mark `confirming` before
  Confirm; a failed write means zero requests. CAS on operation id, integer `receiptVersion`, the public state order and
  immutable identity (Worker origin, account, media, comment, revision, digest), send generation and reply id; an answer
  is shown only when its exact receipt is the durable handle after the commit, else superseded/unrecorded + Check
  status. A lost receipt (`unknown` at the claim's version) and a later `dispatching` read of that claim stay one status-
  only uncertainty. Cap 50 (settled, including `already_claimed`, evicted first; `capacity` when 50 are unresolved).
  Each action captures URL/token, config epoch, provider visit, account + reader generation, open post, saved draft
  revision and session; a move means zero requests and a closed view; A → B → A never revives. dispatching, unknown,
  lost/malformed answers and an interrupted confirm are Check status only; an unresolved handle blocks a new Prepare;
  `not_found` never implies non-delivery. No text, body or credential is persisted; nothing reaches the media kit or the
  articles export.

### Verification (2C-4)

`lib/inboxInstagramSend.test.ts` drives the dashboard transport into the real `scout.handle` (production gate) and the
real `instagramSendHandler` with injected eligibility over the real coordinator on node:sqlite with a fake Instagram
transport: prepared, sent, unknown (server), rejected, the lost-receipt unknown without a settled time and its
dispatching read, already_claimed by automatic/manual/retired, cancelled, expired, convergence, refusals
(`permission_unverified`, `receipt-store`, `outside-local-window`, `identity`), status without a connection; malformed,
contradictory, non-canonical and mixed answers, redirects and binding mismatches reject. `store/index.test.ts`,
`useInstagramSend.test.ts`, `InstagramSendReview.test.tsx` and `InboxScreen.test.tsx` cover the CAS, fences, capacity,
storage and lookup failures, recovery and both languages; `e2e/inbox.spec.ts` checks the production-disabled opener, a
retained `unknown` checked once after a reload, recovery with an account read failure and with another account, and
another Worker's operation with zero requests (desktop and phone, EN and AR). Worker README UI-status line not edited:
`workers/scout/**` is pinned for this packet.

### DT-6B-2C-4-R1 repairs (17 Oct 2026, Codex findings 2C4-1 … 2C4-5, app only)

- **Conditional preparing cleanup (2C4-1).** A failed Prepare, a stale `not_found` looked up while preparing, a
  not_found Cancel of a preparing handle and Prepare's own moved-fence cleanup let the handle go only through
  `clearInboxInstagramSendOpIf`: inside the same locked commit it deletes only the exact unchanged `preparing` record
  (operation, state, version, commit); otherwise it keeps the newer same-operation proof (prepared, confirming, unknown,
  sent...) and answers it, and the view follows what is stored (superseded + Check status).
- **A prepared read never undoes a pending Confirm (2C4-2).** The store refuses `prepared` over `confirming` whatever
  the version (and, as before, over dispatching/unknown/sent/rejected/already_claimed); a prepared Status while
  `confirming` keeps the mark and shows Check status only (no Send). The mark becomes its review again only by
  `rollbackInboxInstagramSendConfirm` from that exact mark, for two named reasons: `beforeRequest` (the action's own
  fence failed, no request) and `preClaimRefusal` (that Confirm was refused with `no_permission`, `stale`,
  `account_mismatch`, `target_unverified`, `target_invalid`, `token_expired`, `text_invalid`, `conflict` or `capacity`).
  Any other failure (`rate_limited`, `bad_request`, `not_configured`, `not_connected`, lost, malformed, not_found...)
  is status only. Real cancellation, claim and outcome receipts still land over the mark; nothing is resent.
- **Rollback read-back (2C4-3).** Both rollbacks show their view only when the record read back after the commit is
  exactly the written prepared record; a newer same-operation receipt is shown as the durable truth (superseded +
  Check status).
- **Comment/editor visit (2C4-4).** `newInstagramCommentVisit()` mints a token when the row editor's
  `InstagramSendReview` mounts or unmounts (closing it, another comment, leaving the page, A → B → A), when
  `CommentsView` changes the selected comment or post, and on an Inbox tab change. Prepare and Send capture it and
  re-check it after every await and right before the request; Status and Cancel do not. Plain Close still cancels
  nothing and keeps the operation recoverable.
- **State proof table (2C4-5).** From the coordinator's real answers: prepared, cancelled, expired and already_claimed
  carry no claim or settlement; dispatching its claim only; sent claim + settlement + reply id; rejected its code;
  unknown its reason, its settled time optional (the lost receipt); `receiptVersion` ≥ 1. A contradiction is
  malformed: nothing recorded, no handle removed, no terminal screen; Check status stays.
- **Verification (R1).** Real `scout.handle` status reads of every stored state plus the lost-receipt unknown from the
  real handler, contradiction cases through parser and transport; store CAS/rollback/clear tests; hook tests for each
  finding; component tests (unmount, same-post comment switch, A → B → A, plain Close, status-only pending Confirm,
  contradictory Cancel/Status); a new `CommentsView.test.tsx` with real selection changes; an e2e regression where a
  stale `not_found` races a newer sent receipt on a retained `preparing` handle (production-reachable, status only, EN
  desktop + AR phone).

## Instagram existing-conversation DM review and recovery UI (DT-6B-2C-5A, app only, 17 Oct 2026)

App only; every Worker file, the readers, `ConversationList`, `useInbox.ts`, `useProviderInbox.ts`, `lib/inbox.ts`, the
YouTube, Threads and Instagram public clients/hooks and package/lock are unchanged. C5B (explicit verified-handle
takeover/resume UI) follows; C5A never registers a control, takes over, resumes or changes a conversation's mode.
Separate modules: `lib/inboxInstagramDmSend.ts` (wire), `inboxInstagramDmSendOps` (store, keyed
`origin|account|conversation|inbound message`, one handle per inbound event), `useInstagramDmSend.ts` (actions),
`InstagramDmSendReview.tsx` (editor controls, sheet, recovery list).

- **Readiness.** `instagramDmSendReadiness()` returns the literal `permission_unverified` in production, independent of
  reader capabilities, scopes, settings and receipts; `{ readiness }` is a test injection only. Check status and Cancel
  of a prepared review never ask readiness, a row, a draft or the account read.
- **What the owner sees.** In an opened conversation each inbound row with a concrete non-owner sender id and a usable
  time has "Answer this message"; the owner's own rows have none, unknown-sender and no-time rows are disabled with the
  reason; nothing is ever selected by itself. The selection is a snapshot (refreshes and newer rows never replace it).
  Beside Save/Copy/Discard: the selected message ("Answering @name · time · preview") and "Send as DM reply"
  **disabled** with the reason. Below the Instagram view, outside the account and capability branches, "Instagram DMs to
  check" lists every retained DM of the configured Worker (Check status; Cancel while prepared); another Worker's (or
  all, with no Worker) are named with zero requests.
- **Contract.** Routes `/social/inbox/instagram/dm/send/{prepare,confirm,:op,:op/cancel}` (encoded path/query,
  `redirect: "manual"`); no `provider` field; ids follow `DM_ID_RE` (base64 `=`); text trim → NFC → trim, well formed,
  a new send at most 1000 UTF-8 bytes, a receipt at most 1000 code points (DT-6B-3C); digest = SHA-256 of the exact `{"recipient":{"id"},"message":{"text"}}` body (never the public
  trim-only digest). The reader generation fences visits; the DM send generation and the Worker-proven `inboundAt` are
  learned from Prepare and bound after that (the selected row's time is compared by instant); generations are never
  compared. Strict state-proof table copied from the Worker (`unknown` always settled; `rejected` claim + settlement +
  code; `already_claimed` code `already_claimed` + automatic/manual/retired holder). The lost settlement
  `{ intent: <dispatching>, observed, settlement: "pending" }` is accepted only from Confirm and only exactly: the handle
  stays `dispatching` with `pending: { observed, code }` (provider words dropped). An observed refusal is never a
  rejection, frees nothing and offers no Resend/Clear; only a durable `sent` with its message id proves delivery.
- **Pre-claim refusals.** The pending-confirm mark rolls back (named `preClaimRefusal`, CAS-bound to the exact mark)
  only for codes the DM route gives before `claimConfirm` while the intent is prepared: `conflict`, `not_connected`,
  `token_expired`, `no_permission`, `stale`, `account_mismatch`, `target_unverified`, `target_invalid`. `upstream`,
  `rate_limited`, `not_configured`, `bad_request`, `receipt_unavailable`, `not_found` and lost/malformed answers stay
  status only.
- **Durability and fences (C4-R1 carried).** `preparing` before Prepare, `confirming` before Confirm (failed write =
  zero requests); exact-record conditional cleanup; prepared refused over confirming/dispatching/terminal; named
  rollbacks with exact read-back; an answer shown only when it is the durable handle after the commit; an unresolved
  handle blocks a new Prepare for that inbound message only. Fences captured once per action and re-checked after each
  await and before fetch: URL/token, config epoch, provider visit, account + reader generation, open conversation, DM
  visit (selected inbound message, its editor mount/unmount, tab), draft revision, latest action; A → B → A never
  revives. Cap 50 (settled evicted first; unknown and pending dispatching kept; `capacity` when 50 are unresolved).
  Clear draft after a durable sent discards only the sent revision (exact CAS) and reaches open editors; newer typing
  stays. No text, body or credential persisted; nothing in the media kit or articles export; private backup/import keeps
  validated handles.

### Verification (2C-5A)

`lib/inboxInstagramDmSend.test.ts` drives the dashboard transport into the real `scout.handle` (production gate,
recovery) and the real `instagramDmHandler` with injected eligibility over the real `InstagramDmCoordinator` on
node:sqlite with a fake Instagram transport: prepared, converged Prepare, sent, unknown (recipient), rejected,
dispatching, the pending envelope after provider success / typed refusal / server error, already_claimed by
automatic/manual/retired, cancelled, expired, offline status/cancel, the closed production gate and pre-claim confirm
refusals; the strict table, NFC/body digest vs the public digest, base64 ids, distinct generations, inboundAt binding,
mixed and malformed envelopes. `store/index.test.ts`, `useInstagramDmSend.test.ts`, `InstagramDmSendReview.test.tsx`
and `InboxScreen.test.tsx` cover CAS, rollbacks, cleanup, capacity, fences (incl. inbound selection A → B → A), origin
isolation, recovery and both languages; `e2e/inbox.spec.ts` covers the production-disabled opener with the selected
message, a lost settlement checked once after a reload, recovery with an account read failure and another account,
another Worker with zero requests, Cancel and Clear (desktop and phone, EN and AR). Worker README not edited (pinned).

### DT-6B-2C-5A-R1 repairs (17 Oct 2026, Codex findings 2C5A-1, 2C5A-2, app only)

- **2C5A-1 — time is up per review.** The countdown's disabled state in `InstagramDmSendReview.tsx` is keyed by the
  reviewed `(operationId, reviewExpiresAt)`: a new operation prepared with Prepare again in the same open sheet starts
  with time left and offers one explicit Confirm (readiness mock only); the same expired operation stays disabled when
  re-checked or rerendered; a pending Confirm and closed production readiness stay disabled; nothing confirms by itself.
- **2C5A-2 — preview only from the exact row.** The inline "Answering …" target and the review's inbound preview
  borrow text only from a loaded row with the selected id, the same sender (the operation's recipient) and, when known,
  the same time. Otherwise the target keeps its ids and shows "preview unavailable" with the message id. The selection
  never changes and no request is made. Existing copy reused; no new message keys.
- Tests: three new component expiry cases (expired → authoritative expired → fresh review → one Confirm; same expired
  operation, rerender and Close/reopen control; closed readiness) and five preview cases (conflicting sender, conflicting
  time, no row, matching row, review Details); `e2e/inbox.spec.ts` adds a refreshed same-id preview regression (EN/AR,
  phone and desktop) with Send disabled and zero DM requests.

## Verified-handle conversation takeover/resume UI (DT-6B-2C-5B, app only, 17 Oct 2026)

Consumes the accepted DT-6B-2C-3-R1 control routes exactly (`inboxSendInstagramDm.ts` 20–25, 296–365, 576–650,
711–738; `instagramDmCoordinator.ts` 162–171, 242–250, 986–1113). No Worker change. Taking over or resuming never
sends a message; sending a DM never registers a control or changes the mode (the DM send modules are pinned and import
none of this).

- **Gates.** A NEW registration asks `instagramDmControlReadiness()` (`lib/inboxInstagramDmControl.ts`), the literal
  `permission_unverified`; only tests inject `{ readiness }`. Production shows "Link this conversation" disabled with
  the honest reason and asks nothing. Status/Take over/Resume of an existing verified handle have NO new gate: the
  configured Worker's bearer (only when the handle's stored origin matches), the stored account and the durable handle.
  No Instagram token, loaded row, connected account or send readiness. Another Worker's handle is named, never asked.
- **Wire.** `lib/inboxInstagramDmControl.ts`: strict full view (complete handle with 32-hex id; matching conversation
  `auto|human` + safe non-negative revision; ≤ 20 complete claimed rows of the handle's own target with no settlement
  field; total ≥ rows; truncated iff total > rows; uncertain ≥ 0; `changed` only on takeover/resume, where it proves the
  requested mode at expected + 1 or expected). The HTTP 409 conflict is exactly `error` + narrow control + narrow
  conversation, revision ≠ expected; never a view, no counts. A pure conflict on a mutation is unreadable. Values
  encoded, `redirect: "manual"`, allowlisted errors/details (registration adds `no-customer`). `bindDmControl` refuses
  another account, conversation, recipient or handle (`mismatch`).
- **Store.** `inboxInstagramDmControls` keyed `origin|account|conversation`: handle, recipient and registration proof
  only from a validated view; mode/revision/counts of the last validated view (a conflict records mode/revision and
  drops the counts); `pending` (persisted before each request) and `uncertain`. CAS on the read commit with `current`
  read back; a verified handle/recipient never changes or disappears; revision never goes back and one revision has
  one mode; cap 50 drops idle entries only, explicit `capacity` otherwise. Restore merges: never swaps a handle, never
  discards open pending work, never lets older proof overwrite newer; malformed backups are refused whole; an imported
  origin stays that Worker's. Not in the media kit or the articles export.
- **Hook** (`useInstagramDmControl.ts`). Fences (connection URL/token/epoch, visit = provider/account/conversation/tab,
  latest action) after every await and right before the request; a validated answer is still recorded after a move but
  shown as closed. Explicit review → pending persisted (failed write = no request) → request → apply only after exact
  read-back. Lost/malformed/mismatched → `uncertain`, Check status only, never repeated. Status proves mode/revision,
  never who changed it, and settles an older pending action. Conflict → change not applied; a new change needs Check
  status and a fresh review. `not_found` = unavailable/possibly retired. Lost registration keeps honest uncertainty
  without a handle; only a new explicit registration may converge.
- **UI** (`InstagramDmControlReview.tsx`). Conversation entry beside (not coupled to) the DM opener in
  `ConversationView`; the recovery list is mounted in `InboxScreen` for every provider and account state. The review
  names account, conversation, person, observed mode/revision, requested change, the true in-flight total (rows limited
  when truncated; "not loaded here" when only stored counts exist) and the unknown-outcome count; human copy says
  replies already authorized may still arrive; auto copy says nothing is replayed or sent now; a mode change does not
  settle unknown outcomes. Copy `inbox.igControl.*` EN/AR.

### Verification (2C-5B)

`lib/inboxInstagramDmControl.test.ts` drives the dashboard transport into the real `scout.handle` (closed registration;
bearer-only status/takeover/resume with the Instagram token deleted) and the real `instagramDmHandler` with injected
eligibility (registration) over the real coordinator on node:sqlite: registration, convergence, other-recipient conflict,
`no-customer`, change/no-op/narrow conflict, 23 claimed rows → 20 + truncated, unknown count, loss after commit then
Status, `not_found`, and malformed/mixed/foreign mutations of real fixtures. `store/index.test.ts`,
`useInstagramDmControl.test.ts`, `InstagramDmControlReview.test.tsx` and `InboxScreen.test.tsx` cover CAS, capacity,
backup/merge, canaries, fences, failed persistence, lost/conflict/late answers, origin isolation and both languages;
`e2e/inbox.spec.ts` covers closed linking, explicit take over + resume with truthful counts, a pending change after a
reload (Check status once, no repeat) and another Worker with zero requests (EN/AR, phone and desktop).

### DT-6B-2C-5B-R1 repairs (17 Oct 2026, Codex findings 5B-1 … 5B-5, app only)

- **5B-1 Status vs pending.** A pending action's identity is its whole persisted record (action, expected revision,
  requested mode, time). A Status lets go of it only when it observed that exact action when it started AND proves it
  can no longer apply: a newer revision, or the expected revision already in the requested mode. A Status begun before
  the action, or one at the expected revision in the other mode, updates mode/counts only; the pending action stays, so
  a lost answer still marks it uncertain and no new change opens. A mutation's own answer settles its own action only.
- **5B-2 Conflict durability.** A narrow conflict is shown only when its write applied and storage holds its
  mode/revision; newer stored proof shows "superseded", a failed save shows "couldn't save" (pending kept), both with
  Check status. Counts are never manufactured; another action's pending is never cleared by it.
- **5B-3 Restore invariants.** An imported control with an inconsistent pending block (expected revision unknown or
  above its own revision), another handle or recipient for the same conversation, or the same revision with another
  mode is refused entry by entry (this device's entry stays; the key is reported in `importState`'s result). Older
  proof never overwrites newer; open local pending work stays.
- **5B-4 Durable restore.** `importState` parses synchronously (an invalid file still throws), then under the same
  `3z-prod-articles` lock as commitFresh and every control action merges the controls storage holds NOW, writes once
  and reads back (epoch + every control commit) before resolving `{ ok: true, rejected }`; otherwise memory goes back
  and it resolves `not-persisted`. Without Web Locks no control action can persist, so the same steps run at once.
  Settings awaits it, ignores a second Confirm meanwhile and says "couldn't save, nothing changed"
  (`settings.importNotSaved`, EN/AR).
- **5B-5 Review counts.** A view remembers the commit id of the durable record it was recorded as; a review (and an
  open review) shows its rows only while storage still holds that record, else the stored totals "as last checked" with
  rows "not loaded". No extra request.
- Verification: hook +8, store +9 (and `await` added to 15 existing restore tests that run with an injected lock),
  component +3, `e2e/inbox.spec.ts` +3 (EN/AR two-tab counts; two-tab Settings restore with queued storage events),
  `e2e/settings.spec.ts` +1 (unsaved restore says so; ordinary restore still replaces progress).

## Manual Instagram DM UTF-8 byte limit (DT-6B-3C, 17 Oct 2026, local only)

Codex finding 3B-1: Meta limits `message.text` to 1,000 UTF-8 bytes; manual DMs counted 1,000 code points, so 501
Arabic letters (1,002 bytes) or 251 emoji (1,004 bytes) passed Prepare/Confirm. Production readiness stays closed.

- **Rule.** New manual DM text: trim → NFC → trim, well formed, non-empty, and the UTF-8 encoding of that canonical
  `message.text` ≤ 1,000 bytes (not the JSON envelope, recipient or escaping). Never truncated, split, replaced or
  normalized again after review; the digest stays SHA-256 of the exact manual JSON body.
- **Worker.** Prepare over the bound → `400 text_invalid` before any ownership GET or coordinator call (after the gate,
  so production still answers `no_permission`). Confirm keeps durable state first (dispatching, settled,
  already_claimed, cancelled, expired answered as they stand, also a repeated Confirm of an old over-limit text); then
  the digest; then a still-`prepared` intent whose stored text is over the bound or not canonical →
  `400 text_invalid`, a guaranteed pre-claim refusal (no token read, GET, claim or POST), never rewritten or cancelled.
  Status/Cancel unchanged. The coordinator's storage cap and the automatic-reply path (already byte-bounded in
  `replyCore.ts`) are unchanged.
- **Client.** `dmTextEligible` (bytes) is new-send eligibility; `dmCanonicalText` keeps the earlier 1,000-code-point
  format rule for receipts, so older receipts parse and bind in every state, pending envelopes included. Prepare and a
  direct Send apply the byte rule: an over-limit prepared review gets no `confirming` mark and no request; the Worker's
  `text_invalid` on a prepared Confirm is one of the named pre-claim refusals that roll the mark back.
- **UI.** The editor note and the error say UTF-8 bytes (Arabic letters about 2, emoji about 4), with the draft's byte
  count. An older over-limit review shows its exact text, `ibx-igdm-over-limit` guidance (Cancel this review, shorten
  and save the draft, prepare a new one; nothing changes by itself), Check status and Cancel; Send is disabled.
- Verification: Worker +34 (boundary table, valid-boundary Confirm, zero-effect Prepare, a directly seeded legacy
  prepared intent, old receipts in 8 states × 2 texts offline), lib +4, hook +3, component +3, `e2e/inbox.spec.ts` +1
  (EN/AR × phone/desktop). Comment-only: `tiktokMusicProbe.ts` KV-read count, `instagramDmCoordinator.ts` storage-cap
  note. Candidate provenance: `dt6b3a-candidate/3c-overlay.patch` (3A's `allowlist.patch` stays historical).
