# 51 · Global inbox: read and reply to Instagram DMs and comments, TikTok comments, from one page

Owner, round 36 (Oct 22, 2026): "i want this session for the enhancement of social platform … global inbox", then the
answers below. Status: **spec approved in parts on Oct 22, 2026; build not started.** Plan: `planning/plans/` (next).
Replaces nothing on the live site; Codex's read-only inbox on `codex/discover-inspiration` (`planning/tools/36-inbox.md`,
`37-inbox-send.md`, PR #70, never live) is not the base: it has no TikTok, no instant updates, and sends through a review
sheet; pieces of its UI may be lifted file by file where they fit (approach 3, decided during the build).

## Owner's answers (Oct 22, 2026)

| Question | Answer |
| --- | --- |
| What should it do? | **Read and reply from the dashboard.** AI reply suggestions later. |
| Which platforms first? | **Instagram (DMs + comments) and TikTok (comments).** YouTube and Threads later. |
| How fresh? | **Instant** (webhooks), with the every-minute reader until each platform's approval lands. |
| What can a reply contain? | **Text only.** Quick replies, photos and link buttons later. |
| Layout | A tab per platform **and** an **All** tab mixing every platform; comments **grouped by post**. |

## What the owner gets

`/social/inbox/` (Social menu "📥 الرسائل / Inbox"; Studio home shows the unread total):

- Tabs **All · Instagram · TikTok** (YouTube, Threads greyed "soon"). The picked tab is remembered on the device.
- Two sections in every tab:
  - **Messages** — DM conversations, newest first: name, last message, unread dot. Open one: the thread (theirs left,
    ours right, auto replies marked "auto"), a text box, **Send**, the remaining characters, and the 24-hour window
    state ("Instagram closed this window; the person needs to write first" when it is over).
  - **Comments** — our posts, newest first: thumbnail, first caption line, "12 comments · 3 new". Open a post: its
    comments newest first, each with **Reply** (public), and on Instagram **Reply privately** (one DM per comment within
    7 days). A small menu per comment: **Hide** (Instagram, TikTok) and **Delete** (our own replies only).
- In **All**, every item carries its platform badge. TikTok's Messages section is one line, "TikTok DMs are not
  available for Personal accounts", with an **Open TikTok messages** link to `https://www.tiktok.com/messages`
  (owner, Oct 22: TikTok's Business Messaging API serves Business accounts only, after a developer data-security
  review; @3z.prod stays Personal for the music, so no TikTok DM reading or auto DMs; no browser automation either, it
  breaks TikTok's rules and risks the account).
- "New" counts are per device (`inboxSeen` in the store: the last opened time per conversation / post), like drafts.
- States: Worker not configured → Settings link; platform not connected or permission missing → one line with the
  connect button ("Allow auto-replies" already grants the Instagram permissions; "Connect TikTok comments" after
  TikTok's approval); platform down / rate limited → last stored data with "last updated {ago}"; a refused send → the
  platform's reason in plain words under the box; an unconfirmed send → "not confirmed, check in the app", never resent.

## Decisions (with the reasons)

| Question | Decision | Why |
| --- | --- | --- |
| Where does the data live? | A **Durable Object `InboxStore`** (SQLite) on the Worker, one object for the owner | Instant needs webhook bursts written as they come; KV's free plan allows 1,000 writes a day and no appends, and the replies guard already spends up to 600 of them. SQLite DOs are on the free plan. The dashboard never stores conversations (only `inboxSeen`). |
| Who fills the store? | The existing every-minute reader (`inbox.ts` `readInbox`, extended to all conversations and comments of the last 50 posts) now; **webhooks** (`POST /webhooks/instagram`, `POST /webhooks/tiktok`) once approved, with the reader kept as backup | One code path to the store; the page does not change when instant arrives. |
| How does the page refresh? | Reads `GET /social/inbox/*` from the Worker: on open, every 15 s while visible, and on Refresh; no platform call per page read | Opens instantly; platform rate limits are spent by the reader only. WebSocket push from the DO is a later step if 15 s ever feels slow. |
| Retention | 200 conversations, comments of the last 50 posts, 30 days; "Load older" reads live from the platform (one call, not stored) | Keeps the DO small and the privacy page honest. |
| Sending | One Worker call per tap: `sendReply` (`replyCore.ts`) for DMs and private replies, `POST /{comment-id}/replies` for public replies, TikTok `/business/comment/reply/create/`; the button locks until the answer; the store records the send with the platform's id | Same senders as auto replies v2; no second transport. |
| Text limits (shown live, refused over) | Instagram DM 1,000 UTF-8 bytes (`DM_TEXT_BYTES`), Instagram comment 2,200 chars, TikTok comment 150 chars | Platform limits; the Worker re-checks. |
| Duplicates with auto replies | The reader marks a DM/comment `answeredBy: "auto"` from the replies log (`replies:state`); the inbox shows it in place, and a manual reply is still allowed | No double voice: the owner sees what the robot said before adding to it. |
| Webhook security | Instagram: `GET` verify (`hub.verify_token` = a Worker secret), `POST` checked against `X-Hub-Signature-256` with the app secret; TikTok: the Business API signature header; unverified payloads dropped and counted | Standard; nothing trusts a body without a signature. |
| Privacy | `public/privacy/index.html` gains one line: latest conversations and comments kept about 30 days on the Worker; Settings → "Delete inbox store" wipes the DO | Keeps the Meta data-deletion page true. |

## Platform facts

- **Instagram (API with Instagram Login, v21.0):** conversations `GET /{ig-user-id}/conversations?platform=instagram&fields=id,updated_time,participants{id,username}`; messages `GET /{conversation-id}?fields=messages.limit(20){id,created_time,from,message,story,is_unsupported}`; comments `GET /{media-id}/comments?fields=id,text,username,from,timestamp,replies{...}`; public reply `POST /{comment-id}/replies`; hide `POST /{comment-id}?hide=true`; delete `DELETE /{comment-id}` (own replies); DM send `POST /{ig-user-id}/messages` `{recipient:{id}, message:{text}}` within 24 h of the person's last message (code 10 / 2534022 when over); private reply `{recipient:{comment_id}}` once per comment, 7 days. Webhooks: object `instagram`, fields `messages` and `comments`; they deliver only to a **Live** app with **Advanced Access** on `instagram_business_manage_messages` / `instagram_business_manage_comments` → **App Review** (business verification done Aug 28, 2026).
- **TikTok (Accounts API, scope "TikTok accounts", app `7693488727766597653`, scope change submitted Oct 22, 2026 20:22 AST):** token via the account-holder OAuth (`/oauth/tiktokads/account/callback/`, Worker routes `/tiktokads/account/*` already deployed); `GET /business/video/list/`, `GET /business/comment/list/`, `POST /business/comment/reply/create/`, `/business/comment/hide/`, `/business/comment/delete/`; comment webhooks through the Business API's Webhooks guide. No DM API. Whether a Personal account is accepted is proven only by the real connect.

## Worker contract (new routes, bearer unless noted)

```
GET  /social/inbox                      → { platforms: { instagram: {connected, permissions, lastReadAt, lastError?}, tiktok: {...} }, unread: {...} }
GET  /social/inbox/conversations?platform=all|instagram&before=<ts>          → { conversations: [...], more }
GET  /social/inbox/conversations/:id?before=<ts>                              → { conversation, messages: [...], window: { open, closesAt } }
POST /social/inbox/conversations/:id/send   { text }                          → { message } | { error, detail }
GET  /social/inbox/posts?platform=all|instagram|tiktok&before=<ts>            → { posts: [...], more }
GET  /social/inbox/posts/:platform/:id/comments?before=<ts>                   → { post, comments: [...], more }
POST /social/inbox/comments/:platform/:id/reply   { text }                     → { reply } | { error, detail }
POST /social/inbox/comments/instagram/:id/private { text }                     → { message } | { error, detail }
POST /social/inbox/comments/:platform/:id/hide    { hidden: true|false }        → { ok }
DELETE /social/inbox/comments/:platform/:id                                   → { ok }      (own replies only)
POST /social/inbox/refresh                                                    → { scanRequestedAt }   (next tick reads)
DELETE /social/inbox                                                          → { ok }      (wipe the store)
GET  /webhooks/instagram  (no bearer; hub.challenge)   POST /webhooks/instagram (signature)
POST /webhooks/tiktok     (no bearer; signature)
```

Error codes reuse `toReplyCode` (`not_connected`, `no_permission`, `token_expired`, `rate_limited`, `not_eligible`,
`window_closed`, `rejected`, `upstream`) plus `too_long`; `detail` carries the platform's own words (≤200 chars, tokens scrubbed).

## InboxStore (Durable Object, SQLite) — tables

```
conversations(platform, id, peerId, peerName, updatedAt, lastText, lastFrom, windowClosesAt, answeredBy)      PK (platform,id)
messages(platform, convId, id, at, fromPeer BOOL, text, kind: text|story|share|unsupported, sentBy: owner|auto|peer) PK (platform,id)
posts(platform, id, permalink, thumbUrl, caption, postedAt, commentCount)                                       PK (platform,id)
comments(platform, postId, id, parentId, at, author, authorId, text, hidden BOOL, ours BOOL, sentBy)            PK (platform,id)
sends(platform, kind: dm|reply|private, targetId, text, at, state: sent|unconfirmed|refused, platformId, detail)
meta(key, value)   lastReadAt per platform, webhook counters, scanRequestedAt
```

Retention runs on each reader tick: drop conversations beyond 200, posts beyond 50, rows older than 30 days.

## Dashboard

- `lib/inbox.ts`: typed client (`inboxOverview`, `inboxConversations`, `inboxThread`, `inboxSend`, `inboxPosts`,
  `inboxComments`, `inboxReply`, `inboxPrivate`, `inboxHide`, `inboxDelete`, `inboxRefresh`), zod schemas in
  `lib/domain.ts`, limits mirrored (`DM_TEXT_BYTES`, `IG_COMMENT_MAX`, `TT_COMMENT_MAX`), never throws.
- `components/social/inbox/`: `InboxScreen.tsx` (tabs, sections, 15-s visible poll), `ConversationList.tsx`,
  `ThreadView.tsx`, `PostList.tsx`, `CommentsView.tsx`, `ReplyBox.tsx` (counter, lock, result line), `useInbox.ts`.
- Store: `inboxSeen: Record<string, string>` (key `platform:kind:id` → last opened ISO time), `inboxTab`.
- Nav: `components/shell/nav.ts` Social world entry `📥 nav.inbox` (phone: in More; desktop: sidebar). Studio
  `InboxCard` line "N new messages and comments" linking to `/social/inbox/`.
- Copy: `messages/inbox.{ar,en}.json`, Hijazi first, key parity test.

## Build order (each step: tests first, independent review, then the next)

| Step | What | Proof |
| --- | --- | --- |
| A | **Real-data probe**: a bearer `GET /social/inbox/probe` that reads 5 conversations and the comments of the last 3 posts through the existing reader, returns raw counts and the first items; merged and deployed by the owner's word; called from the owner's app session | The owner sees real names, texts and counts. |
| B | `InboxStore` DO + migration `v1-inbox`; reader extension; `GET` routes; retention | Worker tests with a fake Graph; DO tests on miniflare's SQLite. |
| C | Dashboard page: tabs, lists, thread, comments, seen counts, Studio line | Component tests; e2e with a fake Worker (phone + desktop, AR + EN). |
| D | Sending: DM, public reply, private reply, hide, delete; limits; lock; unconfirmed state | Worker + component tests; e2e; then the **live test** (a friend DMs and comments; the owner replies from the dashboard). |
| E | Webhooks: Instagram verify + signed `POST` → store; TikTok `POST` → store; reader stays as backup | Tests with signed fixtures; then the owner's App Review (steps below). |
| F | TikTok comments: account connect button, video list, comments, reply, hide, delete | After the scope approval; live test on @3z.prod. |
| G | **TikTok auto comment replies** (owner, Oct 22: "lets build the comment for tiktok"): the Auto replies screen gains a TikTok tab; a rule = videos (one or any) + keywords + the public reply text (TikTok comments hold no clickable links, so the default reply points to the bio link); the reader (then the comment webhook) answers matching comments through `/business/comment/reply/create/`; at most 20 replies an hour and one per comment, so it never reads as spam; log, stats and "Check now" as on Instagram; no DMs | Worker tests with a fake Business API; e2e on the screen; live test: a friend comments «لت» on a TikTok video. |

## Owner's paperwork (after step D works)

1. **Meta App Review** for Advanced Access on `instagram_business_manage_messages` and `instagram_business_manage_comments`: use case text, screencast of the inbox replying, privacy/terms/data-deletion URLs (live), app icon. Then Publish → Live, subscribe the webhook fields.
2. **TikTok**: when the scope is approved (contact@onus-sa.com), press **Connect TikTok comments** once; then subscribe comment webhooks in the Business API portal.

## Out of scope (this round)

AI reply suggestions, quick replies, photos / link buttons, YouTube and Threads, likes / pins / bulk actions, WhatsApp
(the ONUS/Hatif project), TikTok DMs and TikTok auto DMs (Business accounts only), message search, assigning
conversations.

## Build decisions (Oct 23, 2026, steps A–E built on `claude/global-inbox`)

Settled while building, where the code and the text above differ the code follows these:

- **Paging**: every list answers `{ items, more, next }` with an opaque keyset cursor `next` = `"<ts>|<id>"` (ties broken by id); the dashboard passes it back as `?before=`. Timestamps are ISO `Z` everywhere.
- **Reader budget per off-grid tick**: ≤ 48 subrequests in the worst case (Graph + KV + Durable Object calls), pinned by tests; retention runs hourly, not per tick (at minute :01 UTC, before the token checks, so stored rows still age out while Instagram is disconnected or its token lapsed); comments are requested with `hidden`.
- **"New" marks**: the moment of the dashboard's first read of the inbox (`inbox:firstRead`) is the history boundary; everything older is shown read, paged history is marked seen as it loads.
- **A message's `sentBy` is fixed on first sight** (`COALESCE(existing, new)`): the dashboard writes its own DM row and the auto-reply poll logs its send before the reader can see the message, so the reader's later guess never relabels them.
- **Sends** (Worker): exactly one Graph call per send after all checks (text, limit, window, stored target, `ours` for delete); a Graph refusal is recorded `refused` and answered with Meta's code; a network throw, a 3xx/5xx, or an answer without an id is recorded `unconfirmed` and answered `502 { error: "upstream", detail: "unconfirmed" }`. A store fault after Instagram accepted is only logged (never a second send). Hide and delete write no `sends` row; deleting a comment also drops its stored replies; a reply to a reply is stored under the top-level comment (Instagram nests it there).
- **Sends** (dashboard): a `network` failure, a non-JSON answer (a Cloudflare edge page) or a 2xx with an unexpected body also reads as unconfirmed — the text stays and the copy says to check the thread before sending again; identical text to the same target while a send is in flight joins that request (one tab). One reply box per comment; Reply / Reply privately switch its mode without losing the draft. No reply controls on TikTok rows until step G; no "Reply privately" on our own comments, nor on a comment older than 7 days (Instagram's rule: the Worker answers `409 not_eligible` without a call too).
- **Counter copy**: "About {n} left" (bytes for DMs and private replies, characters for comments) — no unit, because Arabic letters cost two bytes.
- **Wipe**: "Delete stored messages" clears the store; while Instagram stays connected the reader refills the latest page within a minute, and the dialog says so. The legal pages carry the date of their last text change.
- **Webhooks**: `GET/POST /webhooks/instagram` sit before the bearer check (Meta's HMAC-SHA256 of the raw body is the credential, constant-time compare; a `401` is logged and makes no store call, so forged requests cannot spend the store's quota). Own echoes, own comments, non-`comments` fields and read/reaction events are skipped — the reader brings our own rows in with the right marks. Inbox route ids accept `peer:<id>` and are percent-decoded. A placeholder post is written only when the post is unknown; the next media read fills it. When the reader stores a person's real thread, the same ingest moves the `peer:<id>` thread's messages (an owner's DM sent into it too) into it and drops the provisional row; the dashboard's merge by person covers the minute before.
- **Thread depth**: the reader keeps 20 conversations × the last 20 messages of each; "Load older" pages the store only, live history is not read from Instagram.
- **Not built this round**: the greyed YouTube/Threads tabs and the per-post "n new" comment count (their copy keys were dropped).
- **Deploy order**: the Worker first, then the Pages build; against an older Worker (its `404` on `GET /social/inbox`) the page says the inbox is not available yet.
- **Layout (Oct 23)**: the Inbox took Beacons' app layout on the Social iOS skin — three stat tiles (new messages, open conversations, comments; on phone too, compact; hidden on the TikTok tab), a toolbar with the tabs and a client-side search of the loaded rows (Arabic-folded: hamza, vowel marks, tatweel), table-like rows on md+ (avatar, name over last line, "new", time; fixed tracks so the columns line up), and the thread / comments in a side panel on md+ (`Sheet` `side`). The phone keeps the stacked list and the bottom sheets.
- **TikTok**: DMs and auto-DMs need a Business account and Meta-style review — ruled out while @3z.prod stays Personal; comments (read, reply, hide, delete) wait for the Accounts API scope, steps F/G in a later plan.
