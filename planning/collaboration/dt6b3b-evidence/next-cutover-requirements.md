# DT-6B-3B — next cutover requirements (input for a later, separately approved packet)

Based on: remote `main` = deployed workflow head `a858c12` (Worker version `c2e78187…` uploaded 2026-10-15T14:55:12Z
by run 38755604631). Active version, Durable Object migrations, KV contents and Cloudflare secrets are **unverified**
(no Cloudflare access). The accepted candidate (source HEAD `0e1fdb0`, manifest `b1bfdd02…`) is not deployed.

## What the live Worker does today (from `a858c12` source, unchanged by our packets)

Every minute (`* * * * *`) the auto-reply poll runs with only KV state:

- **Automatic comment replies** — private DM first (comment_id recipient), then the public acknowledgement. Dedup lives
  in `replies:state.handled[commentId]` and retry counters.
- **Comment-private DMs** — the same comment branch, `replyCore.sendReply` with the template fallback.
- **Existing-conversation DMs** — `inbox.ts::answerInbox`, cursor `replies:state.convos[conversationId].seenAt`, first-poll
  baseline `replies:state.inboxSince`.
- **Default-reply cooldown** — `replies:state.defaultSentAt[personId]`.

## What the candidate changes

The candidate routes the public acknowledgement through `InstagramPublicSendCoordinator` and existing-conversation DMs
through `InstagramDmCoordinator`. Both start EMPTY on first deploy, so a message or comment the live Worker already
answered, but whose KV marker is missing or stale, could be answered again. The default-reply cooldown also moves
into coordinator state. Fresh Durable Object state alone does not prove replay or cooldown safety.

## Required before activation (each needs its own reviewed packet and owner approval for external actions)

1. **Fresh deployed-identity check** with owner-provided read-only Cloudflare access. Record the active version and
   traffic, migrations applied, bindings, and the presence of `INBOX_SEAL_SECRET` (name only).
2. **Minimal legacy-state inventory** (separately authorized, read-only). Only the existence and counts of
   `replies:state` keys `handled`, `convos`, `inboxSince`, `defaultSentAt`, `retries`, `givenUp` and `sent`. No
   message text, no tokens.
3. **Cutover seeding/fencing design (code).** On the first run after deploy, the coordinators must treat legacy
   handled, seen-cursor and cooldown markers as already-claimed or cooling-down, so no legacy-answered item is replayed.
   Alternatively, gate automatic sends off until an explicit owner-confirmed cutover. Both need tests against
   recorded legacy state shapes.
4. **`INBOX_SEAL_SECRET`**: the owner adds it as a repository secret and `worker.yml` uploads it. That is a workflow
   change and needs approval.
5. **Grants** (see `provider-evidence.md`): YouTube reconnect with `youtube.force-ssl`; Instagram Business Login
   `permissions` proof; Threads provenance still unresolved.
6. **Graph version**: confirm `v21.0` is still supported, or plan a reviewed bump to the documented version.

## Smallest next code change (local, reviewable, no activation)

- Instagram DM text limit: enforce ≤ 1000 UTF-8 bytes (per the official messaging page) in
  `workers/scout/src/social/inboxSendInstagramDm.ts` and `lib/inboxInstagramDmSend.ts`, with tests that include
  Arabic and emoji at the byte boundary.
- Carry the one-word stale comment fix in `workers/scout/src/tiktokMusicProbe.ts` in the same code packet.

The cutover seeding (item 3) is the next substantive design packet after the read-only inventory in item 2.

## Reviewer addendum — DT-6B-3C (17 Oct 2026)

Source: Codex root review of frozen DT-6B-3B (dashboard-remaining-tools-review.md, "DT-6B-3B frozen review") and the adopted DT-6B-3C contract (SHA256 5d1d38ae2a3b6991fd45314017999a0c479caa4447b2623621c8a24f2bf705b9). Instagram page observations: Codex's installed-Chrome reading recorded in %TEMP%/dashboard-remaining-tools-2026-10-16/dt6b3b-instagram-observations.md (cached or markdown renderings may differ; the review infers no fabrication). Carried locally by the DT-6B-3C writer; no new remote read, provider call, grant or secret access.

Everything above this heading is the original DT-6B-3B writer text, kept unchanged as attributed history. In particular, the "Based on" deployment wording, "Every minute", "Both start EMPTY on first deploy", item 4's repository-secret route and the "Threads provenance" wording are qualified by items 1, 4 and 5; the DM byte-limit code change named above is DT-6B-3C itself. Where
the original text conflicts with these items, these items supersede it.

1. **Threads grant inspection.** Official https://developers.facebook.com/documentation/threads/troubleshooting/debug-access-token.md and https://developers.facebook.com/documentation/threads/reference/debug.md document GET /v1.0/debug_token returning scopes, user_id, validity and expiry; the guide requires a tester user token for the same app as the inspected token. No actual call was made and no grant evidence was collected; the minimum owner-reply scope combination remains unresolved. This replaces any global implication above that no verification method is documented. The production gate stays closed. The broader 500-character/emoji-byte wording in the Threads posts/publishing docs is a future readiness question, not a Threads code change in 3C.
2. **Instagram messaging.** Chrome's loaded official /documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api page shows "Updated September 28, 2026" and rendered v26.0 examples, not the writer's v25.0/no-date observation. It confirms 1,000 UTF-8 bytes for message.text. Most initiating actions have a 24-hour window; separate Click-to-Direct first-message and Human Agent seven-day provisions are described. The local 24-hour rule is preserved; no tags are added and no API version changes; continued v21.0 support is still unverified.
3. **Instagram Business Login and Comment Moderation.** The official business-login page (March 13, 2026) documents a comma-separated permissions string in the exchange-response example: the documented shape is established; actual grants and runtime validation/preservation are not. Comment Moderation's loaded official /documentation/instagram-platform/comment-moderation page shows June 2, 2025 and v26.0 examples; the Instagram Login host and the two required comment permissions (instagram_business_basic, instagram_business_manage_comments) are confirmed. Sources/observations: Codex's dt6b3b-instagram-observations.md (method attributed; cached/markdown renderings may differ).
4. **Release claims.** Say: the latest observed GitHub deployment used a858c12; the candidate manifest has no deployment proof and the active Cloudflare identity remains unknown. Do not say today's active Worker is conclusively that source. Pages-only deployment history covers the newest 30 queried records only. The minute cron schedules the reply poll on eligible ticks, not an unconditional send every minute. Do not assume new coordinator storage is actually empty; migration state and contents are unverified. The writer's run-log version UUID (c2e78187-ecdc-4184-a936-b3baef46ee2e) and the ten uploaded secret names remain attributed to its deleted-log summary; bounded independent metadata confirms run/head/step times, not those raw-log details. The writer's prose timestamps are kept as unverified labels (they run ahead of the review clock); the review's machine-recorded observation interval is 2026-10-17T18:35:14.836Z–18:35:21.531Z.
5. **Provisioning and seeding are not prescribed.** Repository-secret storage/upload is not the only future provisioning route. INBOX_SEAL_SECRET is absent from the inspected repository/pipeline, but its Cloudflare presence is unknown. Legacy counts alone cannot prove a seeding algorithm. Active identity and a separately bounded, minimal inventory must precede a concrete cutover plan. No Cloudflare login, credentials or live data is needed for the local 3C packet.
