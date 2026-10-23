# 36 · Inbox: Instagram pure reads + private local drafts (packet DT-6A), Threads/YouTube comment reads (DT-6B-1)

Status: implemented locally, 17 Oct 2026 (Opus 5.5, single writer). Not deployed; no live Instagram call was made
(fixtures and mocked transport only). Plan: `planning/collaboration/dashboard-remaining-tools-handoff.md` ("DT-6A
plan"); acceptance: `dashboard-remaining-tools-review.md` ("Return to Claude — DT-6A authorized now") and the
external contract `%TEMP%/dashboard-remaining-tools-2026-10-16/dt6a-instagram-read-contract.md`. Threads/YouTube
comments are DT-6B-1 (section below); any sending is DT-6B-2.

## What the owner gets

`/social/inbox` (desktop sidebar 📥, More → Inbox after Auto replies, Tools → Conversations inbox, Quick Actions
"inbox" / «صندوق»):

- **Messages tab** — Instagram conversations (the other person's name, last update or "time unavailable"); opening
  one shows its messages with a direction chip (from them / from you / unknown), author or "unknown author", time,
  the text, and honest placeholders for story replies, story mentions, shares, unsupported and empty messages. No
  guessed text, no links on messages.
- **Comments tab** — owned posts (caption or "post without caption", comment count, "Open on Instagram" only for a
  validated `https://(www.)instagram.com` permalink); opening a post shows its comments with direction and author.
  Replies to comments are outside coverage and the page says so.
- **Draft box** per conversation and per comment — Save (private, this device, in backups), Copy (the owner pastes
  in Instagram himself), Discard. Nothing is ever sent from this page.
- "Read-only · fetched {ago}" and "Shows only what Instagram shares with this app, not your full history".
- Footers: Load more / "that's everything Instagram shares" / local limit / partial (retry by hand) / history
  unavailable. States: Worker not configured (→ `/settings#api-keys`), Instagram not connected, token expired,
  no permission (→ `/settings#accounts`, reconnect with "Allow auto-replies"), restricted (`not_eligible`), rate
  limited (no auto-retry), upstream / network, stale connection (Refresh), empty.

Reads happen on open, Refresh and Load more only (no polling, no retry by itself). Studio's reminder Inbox
(`components/social/studio/InboxCard.tsx`) is a different thing and is untouched.

## Worker routes (`workers/scout/src/social/inboxRead.ts`, GET only, README "Inbox reads")

| Route                                          | Upstream (one call)                                                                                     |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `GET /social/inbox/account`                    | `/me?fields=user_id,username`                                                                           |
| `GET /social/inbox/conversations`              | `/{accountId}/conversations?platform=instagram&limit=20&fields=id,updated_time,participants{id,username}` |
| `GET /social/inbox/conversations/:id/messages` | `/{id}?fields=messages[.after(c)].limit(20){id,created_time,from,message,story,is_unsupported}`        |
| `GET /social/inbox/media`                      | `/{accountId}/media?fields=id,caption,permalink,timestamp,comments_count&limit=25`                      |
| `GET /social/inbox/media/:id/comments`         | `/{id}/comments?fields=id,text,username,from,timestamp&limit=25`                                        |

- New pure functions beside the automation: no `readInbox` / `pollReplies`, no `Store.put*` (no token refresh: an
  expired token answers `token_expired`), no POST/DELETE upstream, no seen/mark action. Reuses
  `graph` / `toReplyCode` (replyCore), `clip` (captions), `int`, `toMs` (inbox.ts, pure), `isExpired`,
  `Store.getTokens` / `getStatus`, `IG_API` (v21.0, unchanged).
- Bounds: `Budget(1)` (one upstream call per request), page sizes 20 / 25, items capped at the page size (more →
  `coverage: "cap"`), text 2,000 characters (every line kept), captions 200, names 64, participants 10, error
  `detail` ≤ 200 with the token, links and `access_token=` scrubbed.
- Ids in paths must match `[A-Za-z0-9_=-]{1,256}`; Instagram's cursors re-applied only when they match
  `[A-Za-z0-9_=%-]{1,1000}`.
- DT-6A-R1 bounds (Codex 6A-6 … 6A-9):
  - **Byte budget: 256 KiB per upstream page** (`PAGE_BYTES_MAX`). The reader's own `boundedJson` reads the body
    stream through a counter and cancels it past the budget **before any JSON parse**, whatever `Content-Length`
    says (absent or lying); over budget or a broken-off body → `upstream` (`unavailable` first page, `partial`
    later). Local to `inboxRead.ts`: the automation's shared `fetchJson` (`http.ts`) is unchanged. 256 KiB is
    roughly 10× a full 25-row page with 2,000-character text; a real page never comes close.
  - A 200 without a `data` array (`messages.data` for messages) is the same `upstream` failure, never an empty
    end; an explicit `data: []` stays a true empty `end`. DT-6A-R2 (R1-A): so is a nonempty list with any row that
    is not an object with a plain id, checked over the whole list (also past the page size) before any row is kept;
    no row of that page reaches the client (`unavailable` first page, `partial` later, so earlier rows stay).
  - A message row missing only `from` (→ `direction: "unknown"`, `from: null`) or only `created_time` (→
    `createdAt: null`) is kept; only a page where every listed row is a bare id (none of `from`, `created_time`,
    `message`, `story`, `shares`, `attachments`, `is_unsupported`) is `history_unavailable`. DT-6A-R2 (R1-B): a
    sole share or attachment row is a `share` placeholder (empty text, unknown author/direction, `createdAt: null`,
    no link); no new field is requested and nothing is fetched for it.
  - Cursors: the emitted `next` is checked against the same `CURSOR_MAX` (1,500) that `openCursor` enforces; when
    sealing would exceed it the page answers `coverage: "cap"` (the local cap) with `next: null`, so no unusable
    Load more is offered. Signature, account, generation, edge and id binding unchanged.
  - Permalinks longer than 2,048 characters (before or after URL normalisation) are omitted; text fields are clipped
    as before.

## Identity, generation, cursors

- **Account id** = `String(/me.user_id)` — the id messages and comments carry in `from.id` (the automation's own
  rule). Never the username, never the OAuth token's `userId`.
- **Generation** = first 16 bytes (hex) of HMAC-SHA256(`SCOUT_TOKEN`, `gen|accountId|status.connectedAt ??
  tokens.issuedAt`). Non-secret stamp, never the token. Same across handle renames; a reconnect changes it.
- List routes take `account` + `generation` back from the dashboard; the Worker recomputes the HMAC and answers
  `409 stale` on mismatch (zero upstream calls). This is why the generation is an HMAC rather than the plan's plain
  SHA-256: it lets the list routes trust the account id without a second `/me` call per request.
- **Cursors** = `base64url(JSON {a, g, e, id?, after}).base64url(HMAC-SHA256(SCOUT_TOKEN, "cursor|" + body))`,
  verified with `crypto.subtle.verify`; bound to account, generation, edge and the conversation/media id. Malformed,
  tampered, foreign-account, foreign-edge, foreign-id, other-secret and old-generation cursors → `400
  cursor_invalid` with zero upstream calls. Instagram's `paging.next` URLs (token-bearing) are never followed,
  accepted or returned; `more` only when Instagram sent `next` *and* an `after` cursor we can re-apply on `IG_API`.
- **Direction** by id only: `from.id === accountId` → out, another id → in, no `from` → unknown.
- **Kinds**: unsupported → story_mention → story_reply → text → share (only if `shares`/`attachments` arrive
  unasked) → empty.

## Capabilities and errors

- `capabilities` from the stored token: the granted scope list when Instagram sent one (`…manage_messages`,
  `…manage_comments` separately), else the combined `canReply`. No probe call; a list route whose scope is missing
  answers `403 no_permission` without calling Instagram, and the dashboard does not ask for it either.
- Read errors through `graph`: code 10 → `no_permission` (or `not_eligible` for window subcodes), 190/102 →
  `token_expired`, 4/17/32/613… → `rate_limited`; other 4xx refusals: Meta 200–299 → `no_permission`, Meta 3 →
  `not_eligible` (app role / review restriction), else `upstream`. One surface failing never blanks the other.
- Coverage on errors: `partial` (a request with a cursor failed), `unavailable` (first page), `history_unavailable`
  (bare message ids or no `messages` edge: never shown as an empty conversation).

## Dashboard

- `lib/inbox.ts`: strict zod parsers (unknown fields refused), `inboxScope(origin, accountId, kind, id)`
  (URI-encoded parts joined by `|`), `mergePages` (first copy wins, 500-item local cap → `cap`), `mergeFailure`
  (items kept → `partial`, else `unavailable` / `history_unavailable`), `providerLink`, `validDraft` (≤ 2,000),
  transport with its own small fetch (deviation: `call()` from `lib/socialSync` folds `no_permission`,
  `not_eligible`, `cursor_invalid` and `stale` into `upstream`, which would erase the states the page must show).
- `components/social/inbox/useInbox.ts`: plain zustand store, **not persisted**, not in `pick()`. Per-request fence
  `{ epoch, origin, accountId, generation, selection }`; late results are dropped (and release their busy token). A
  new account id or generation clears lists and selection; a handle rename keeps them. DT-6A-R1: a private
  **connection epoch** (memory only, never persisted, never in a draft scope, never the token) moves whenever the
  configured `scoutUrl` / `scoutToken` change (a `useStore` subscription) and clears the view at once, so an old
  account's rows never show while the new account is read and every older read is dropped (6A-3). A result is
  accepted only while its request is still its list's current session (`busy[key] === token`), so a request a
  reset or newer read superseded stays dead even when the same Worker/account/generation comes back, A → B → A
  (6A-4). `lib/inbox.ts` refuses a page whose `accountId` / `generation` differ from the ones asked for as `stale`;
  rows already shown stay (6A-5).
- Store (additive): `inboxDrafts: Record<scope, { text ≤ 2000, updatedAt, commitId }>` (default `{}`; old backups
  import), cap 200 (oldest others dropped inside the commit), `saveInboxDraft` / `discardInboxDraft` through
  `commitFresh` with commit-id read-back, `inboxDraftBase(draft)` = `{ commitId | null, generation }` (conflict on a
  stale base or after import/reset). `DraftBox` is mounted per scope (`key={scope}`): acknowledgements only in that
  session and only while the text is still the submitted one (`earlierSaved` otherwise; a copy of older text is not
  acknowledged), as DT-5-R2 R1-E. DT-6A-R1 (6A-1): Discard is bound to the text it was pressed on: the editor clears
  only if it still holds that text; newer input stays with the base refreshed to "no draft", so it saves normally.
  (6A-2) Save and Discard proofs parse the stored `inboxDrafts` with the persisted draft schema first: unreadable
  JSON, a missing record, an array or any invalid entry is `not-persisted` (memory rolled back, text kept); a valid
  empty record after a real deletion is proof.
- Privacy canaries: unit (`store/index.test.ts`, `useInbox.test.ts`) and e2e (`e2e/inbox.spec.ts`) prove fetched
  bodies never reach `localStorage` or the Settings export, while the owner's draft does.

## Honest limits (release conditions, not verified live)

- Partial inbox: Instagram Login shares user-initiated conversations only, no groups, and omits Requests inactive
  for 30 days (Meta collection); the page never claims full history.
- The live message-history depth (the often-quoted 20), attachment/share fields, comment author fields and
  Standard/Advanced Access eligibility under Instagram Login are **unverified**; current official pages returned
  429 during research. No extra fields were requested beyond the automation's proven ones.
- `share` appears only if Instagram includes share data without being asked; otherwise such a message is `empty`
  ("maybe a photo or voice note").
- Numeric `user_id` values above 2^53 would lose precision if Instagram ever sent them as JSON numbers (the
  automation has the same `String()` rule); Instagram sends them as strings in practice.
- Draft text is plain owner text in `localStorage` and in the private backup; nothing is synced or sent.

## DT-6B-1 · Threads and YouTube pure comment reads + private drafts

Status: implemented locally, 17 Oct 2026 (Opus 5.5, single writer). Not deployed; no live Threads or YouTube call,
no scope grant, no login change (fixtures and mocked transport only). Plan: handoff "DT-6B-1 plan"; acceptance:
review "Return to Claude — DT-6B-1 authorized now" and `%TEMP%/dashboard-remaining-tools-2026-10-16/dt6b-read-contract.md`.
**DT-6B-2 (explicit reviewed sending, delivery receipts, ambiguous-timeout recovery) is still required**; B1 adds no
send, moderation, hide, seen or auto-reply action, so the Inbox is not complete.

### What the owner gets

- A platform selector (Instagram / Threads / YouTube, `ibx-provider-*`) above the Inbox. Instagram's Messages and
  Comments view is unchanged.
- **Threads**: own posts (text or "post without text", time, "Open on Threads" only for `https://www.threads.net` /
  `https://www.threads.com`) → the direct replies of one post (direction from `is_reply_owned_by_me`, author or
  "unknown author", a "media reply" placeholder for replies without text, "reply to another reply" when
  `replied_to` is not the post). With the current analytics connection the replies view honestly says the
  connection lacks `threads_read_replies` (no Settings link: the app does not request that scope yet).
- **YouTube**: with one channel it opens by itself; with several (or none) the owner picks one by id (never the first
  by default). Uploads (title, time, "Open on YouTube" for `www.youtube.com` / `youtu.be`) → published comment
  threads of one video (top-level comment + the embedded replies, "Showing n of N replies") → **Load replies** per
  thread, only when pressed, then Load more; overlapping ids appear once. States: comments turned off, video not
  found, quota / rate limited, no permission, sign-in expired (YouTube access tokens last an hour; the reader never
  refreshes: "sync or reconnect, then Refresh").
- Draft box (Save / Copy / Discard) on every Threads reply and YouTube comment or reply; "Copied" names the platform.

### Edges and coverage (one upstream call per request)

| Route | Upstream |
| --- | --- |
| `GET /social/inbox/threads/account` | `/me?fields=id,username` |
| `GET /social/inbox/threads/posts` | `/me/threads?fields=id,timestamp,text,permalink,media_type&limit=25` (+ `after`) |
| `GET /social/inbox/threads/posts/:ref/replies` | `/{post}/replies?fields=id,text,timestamp,username,is_reply_owned_by_me,root_post,replied_to&reverse=false&limit=25` (+ `after`) |
| `GET /social/inbox/youtube/account` | `channels?part=id,snippet,contentDetails&mine=true` |
| `GET /social/inbox/youtube/videos?uploads=<ref>` | `playlistItems?part=contentDetails,snippet&playlistId=<uploads>&maxResults=25` (+ `pageToken`) |
| `GET /social/inbox/youtube/videos/:ref/threads` | `commentThreads?part=snippet,replies&videoId=<owned>&textFormat=plainText&order=time&maxResults=25` (+ `pageToken`) |
| `GET /social/inbox/youtube/comments/:ref/replies` | `comments?part=snippet&parentId=<top-level comment id>&textFormat=plainText&maxResults=25` (+ `pageToken`) |

- Threads coverage label: direct replies as the Threads API returns them; nested depth, hidden/pending replies and
  production eligibility unverified. `/me/replies` (the owner's own replies) is not used.
- YouTube coverage: published comments only (no held/spam queue, live chat or Community posts); embedded replies are
  a subset (`repliesCoverage: "embedded"`), the rest only on demand by top-level comment id. The YouTube account call
  adds `contentDetails` to the plan's `part=id,snippet` so the uploads playlist id comes in the same single call
  (recorded deviation: no second call per request).

### Identity, ownership, bounds

- `accountId`: Threads `/me.id` (string); YouTube channel id. Generation = HMAC(`SCOUT_TOKEN`,
  `gen2|<provider>|<accountId>|<connectedAt>`), so the same id on Instagram and Threads has different generations.
- **Ownership receipts:** each own post, uploads playlist, video and top-level comment carries a sealed `ref`
  (`{p, a, g, k, id}` + HMAC in the `ref2|` domain). Below-item routes take only the ref in the path: bare ids,
  forged, other-account, other-provider and other-kind refs → `400 bad_request`, an older generation → `409 stale`,
  all before any upstream call. YouTube replies take the ref of a top-level comment minted on a threads page.
- Cursors: `cursor2|` domain, bound to provider, account, generation, edge and the resource id; Instagram cursors
  (and v2 cursors on the Instagram routes) are refused. Provider paging URLs and `nextPageToken`s that are not plain
  tokens are never followed (an unsealable token becomes `cap`).
- Bounds reused from DT-6A: 256 KiB per page before parsing, 25 rows (a longer list → `cap`), text 2,000, previews
  200, names 64, cursor/ref 1,500, links 2,048 and exact hosts; whole-page row validation before empty/end (a
  missing list, a row without its id, a thread without its top-level comment or an embedded reply without an id →
  `unavailable` first page / `partial` later); `data: []` / `items: []` is a true end.
- Errors: Threads through `graph` as Instagram (190 → `token_expired`, 10 → `no_permission`, 4… → `rate_limited`);
  YouTube by reason first (`commentsDisabled` → `comments_disabled` 403, `videoNotFound` → `video_not_found` 404,
  quota reasons → `rate_limited` 429), then 401 → `token_expired`, other 403 → `no_permission`.
- Code: `inboxReadThreads.ts`, `inboxReadYouTube.ts`, `inboxReadCommon.ts` (new; `inboxRead.ts` untouched, its small
  private helpers repeated rather than extracted so the accepted Instagram contract stays byte-for-byte),
  `routes.ts` dispatch only. `threads.ts`, `youtube.ts`, `oauth.ts`, `sync.ts`, `http.ts`, `meta.ts` untouched; the
  optional read-scope connect option was not added (Threads' `exchange` stores the configured scope string, so an
  honest option would also need it to record the granted scopes: a separate, reviewed change).

### Dashboard

- `lib/inbox.ts`: `InboxProvider`, `inboxScopeV2(provider, origin, account, kind, id)` =
  `v2|<provider>|<origin>|<account>|<kind>|<id>` (encoded parts) for every new list and draft; legacy
  `inboxScope` strings and stored Instagram drafts are unchanged and keep resolving (no store change was needed:
  `inboxDrafts` keys are free strings). Strict parsers with a literal `provider`; `threadsLink` / `youtubeLink`;
  transport refuses another account or generation as `stale`, another provider as a parse failure.
- `components/social/inbox/useProviderInbox.ts` (new, memory only, beside the untouched `useInbox.ts`): provider
  selector, Threads account, YouTube account + channel pick, fences `{ epoch, origin, provider, account, generation,
  selection }` + list session; a provider switch clears every session (A → B → A safe); a reconnect or another
  channel clears that provider's lists. `ProviderView.tsx` (new) renders both providers; `StateNote` / `ListFooter`
  / `DraftBox` take an optional provider for their words.
- Privacy canaries: `useProviderInbox.test.ts`, `store/index.test.ts` (persisted root, backup, media kit, articles
  export) and `e2e/inbox.spec.ts` (localStorage) prove fetched Threads/YouTube bodies and author names stay out.

### DT-6B-1-R1 repairs (Codex findings B1-1 … B1-8, Fable ruling 17 Oct 03:40 AST)

- **B1-1 seal key.** Threads/YouTube generations, cursors and ownership refs are sealed with
  `HMAC(INBOX_SEAL_SECRET, "inbox-seal-v1|<provider>")`, a new server-only Worker secret (`SocialEnv`, README
  "Configuration" + "Seal key"), never the bearer the dashboard holds. Missing, shorter than 32 characters or equal to
  `SCOUT_TOKEN` → every Threads/YouTube Inbox route is `503 not_configured` (dashboard copy names the setting), no ref
  minted. Refs/cursors forged by a bearer holder (old scheme, raw bearer, or the R1 derivation over the bearer) are
  refused before any upstream call; the secret is cut from any echoed provider detail. The owner sets it once in
  Cloudflare (Variables and Secrets); Instagram's DT-6A seals are unchanged (inherited, recorded limit).
- **B1-2** the YouTube channel list must be an object with an explicit `items` array (`{}`, `items: null`, a primitive
  or an array body → `502 upstream`); `items: []` stays the honest no-channel answer.
- **B1-3** `totalReplyCount` is `null` unless YouTube gives a non-negative safe integer; the view offers Load replies
  when the total is unknown or above the embedded count; a valid 0 hides it.
- **B1-4** ids are strings matching the id grammar or JSON safe integers whose digits match it; anything else fails the
  whole page, so no emitted ref is refused by the reader's own path check (round-trip tests).
- **B1-5** every target move (post, video, channel, back to null) ends the earlier target's list sessions; a late answer
  neither lands, blocks nor releases the new visit's request; rows already read stay.
- **B1-6** a provider-visit token fences account, open and refresh continuations (no hidden read after leaving);
  back on a provider, a selected post / video whose rows never landed returns to the first list (no revived request,
  no reply fan-out).
- **B1-7** Refresh on a video ends its loaded reply lists and their in-flight sessions; the fresh embedded replies show,
  the rest reload on Load replies; drafts untouched.
- **B1-8** each loaded reply list has its own footer under its comment (`end` "all the replies YouTube returned for
  this comment", `cap`, `partial`, state + Retry / Load more); the thread list's end line now speaks only for comments.
- **DT-6B-1-R2 (B1-R1-A, supersede)** a new read of a list that still has one in flight (first page, next page or
  Refresh) takes a new session token at once and asks again; the older request is orphaned, so its answer or error can
  neither replace rows, release busy nor re-enable anything. Busy follows the newest read; Refresh stays enabled and is
  never silently skipped. Leaving the target or switching provider during the wait drops both requests (nothing
  revived). R1 behaviour unchanged: refreshed video's reply caches dropped, drafts, rows on failure, per-comment
  footers and on-demand replies kept.

## DT-WIO-1 · Find a loaded Instagram conversation (18 Oct 2026)

The Instagram conversation list (`ConversationList`) has a labelled search box with an explicit Clear. It matches the
**other** participants' returned username or id (the owner is left out exactly as the displayed names do), as a
literal, case-insensitive substring after Unicode NFC (`lib/inboxConversationSearch.ts`; no regular expression, no
Arabic letter folding, query at most 200 characters, edges trimmed). Blank or whitespace shows every row in the
provider's order. Counts read "Loaded conversations: N" / "Matching: n of N loaded", and a note says only the loaded
conversations are searched, not message text or older history.

- The query is plain component state: memory only, never persisted, logged, copied into a draft or sent. The list is
  keyed by the read-only reader identity (Worker origin, account id, generation), so another connection or account
  starts with an empty search (A → B → A does not bring it back).
- Search and Clear make no request. `ListFooter` still receives the original, unfiltered list, so loading, a real
  empty inbox, errors, partial/cap/history lines and explicit Load more behave as before; "no loaded conversation
  matches" shows only when rows are loaded. Rows loaded later join the filter; nothing auto-paginates.
- Opening a row, ids, the selection, drafts and recovery lists are unchanged. No unread/new/open/resolved labels.
- Strings: `inbox.search.*` in `messages/inbox.en.json` / `inbox.ar.json` (key and placeholder parity tested).
- Tests: `lib/inboxConversationSearch.test.ts`, `components/social/inbox/ConversationList.test.tsx`,
  `e2e/inbox-search.spec.ts` (synthetic Worker, external requests aborted, desktop + phone, English + Arabic).

**DT-WIO-1-T1 validation note (18 Oct 2026).** The maintained e2e "DT-6B-2C-5B-R1: a Settings restore keeps another
tab's pending takeover and says it imported" built its backup from a sparse seeded disk copy, which the valid backup
schema rightly rejects. The test now downloads a real Settings Export and imports those exact bytes; no product,
schema, store or merge change, assertions untouched. Installed Chrome 155.0.8059.82: that test passes on desktop +
phone, and the four `inbox-search.spec.ts` cases pass 4/4. Count correction: the DT-WIO-1 writer report showed legacy
Inbox 138/140, search 4/4, combined 142/144 (the earlier "140/142 legacy" wording was wrong). Details:
`planning/collaboration/dashboard-remaining-tools-handoff.md`, "DT-WIO-1-T1 record".

## Search before building

No library needed: the readers reuse the Worker's own Graph helpers, the client reuses zod + zustand already in the
stack, and HMAC comes from Web Crypto (`crypto.subtle`). Meta's official Instagram API (Instagram Login) is the
only data source; no third-party inbox SDK was considered appropriate (tokens must stay in the Worker). DT-6B-1:
the same holds for Threads (Meta official Threads API) and YouTube (Data API v3, already used by the analytics
sync); googleapis client libraries were not adopted (Node-only, far larger than the three GETs needed in a Worker).
