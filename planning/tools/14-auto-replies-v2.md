# 14 · Auto replies v2: our own Smart Reply, with DMs and story replies (round 34)

**Status:** built (round 34); goes live after the Live test (step 0).

Owner, Oct 3, 2026: "I want us to work on auto reply its an important feature for me. beacons.ai and metrocool and
manychat" → "its made with beacons.ai I want our version" → "I dont want anything that will get me banned."
Goals he picked: **send free downloads**, **grow followers**, **answer common DMs** (keyword answers, story replies,
a default reply). Not picked: the email ask, FAQ buttons.

Designed with the owner section by section on Oct 3, 2026 (what people get, the screen, behind the scenes, order of
work). v1 (round 30) is `10-auto-replies.md`; this file replaces its builder and adds DMs. Roadmap item **C2** of
`09-metricool-beacons.md`.

## What people get

1. **Comment rule.** Someone comments a keyword on a chosen post, or on any of the 5 newest posts. They get the
   **private DM first**: the owner's text plus up to three buttons (links, and an optional «تابعني» button that opens
   the profile). Only if the DM went out, a **public reply** goes under the comment, picked at random from up to three
   texts (`{username}` becomes their @handle, as in v1).
2. **Message rule.** Someone sends a DM, or replies to a story, with a keyword. They get the owner's answer (text
   plus up to three buttons). Story mentions (someone tagging the account in their own story) are not answered.
3. **Default reply.** A DM that matches no rule gets one automatic message, **at most once per person per 24 hours**.
   Never for story replies, reactions, or our own messages.

In a conversation where the owner replied **by hand** in the last 24 hours, message rules and the default reply stay
quiet. Comment rules still answer: the private reply belongs to the comment.

## Decisions (with the reasons)

| Question | Decision | Why |
| --- | --- | --- |
| Ours or Beacons? | **Ours replaces Beacons Smart Reply.** Beacons stays for the link in bio and the store for now. | Beacons' Smart Reply stopped when Instagram signed it out (0 sends, Oct 3). The owner wants his own version. |
| Follow gate? | **No gate.** Everyone gets the link; the DM invites them to follow with a «تابعني» button. | Meta's Spam Community Standard lists "Like/share-gating: Requiring users to engage (in the form of likes, shares, follows, or any other public-facing form of engagement) to gain access to specific, exclusive content" ([transparency.meta.com](https://transparency.meta.com/policies/community-standards/spam/)). The owner: no ban risk. |
| Who gets messaged? | **Only people who commented or wrote first**: one private reply per comment (within 7 days), DM answers inside Instagram's 24-hour window. We never start a conversation. | Meta's private-reply and messaging rules ([private replies](https://developers.facebook.com/docs/instagram-platform/private-replies/)). |
| Speed? | **Poll every minute now.** **Instant (webhooks)** after Business Verification + App Review, as its own round; the minute poll then stays as a backup. | Webhooks for comments and messages need Advanced Access, and Advanced Access needs Business Verification ([webhooks](https://developers.facebook.com/docs/instagram-platform/webhooks/)). The owner chose instant and is getting a freelance document. |
| Public reply? | **Up to three texts, one picked at random.** | Meta Developer Policies 5.6.2.b forbids bots "at excessively high repetition rates"; Beacons, ManyChat and Metricool all offer three variants. |
| Buttons? | DMs use Instagram's **button template** (one to three `web_url` buttons, titles up to 20 characters, text up to 640 characters). The private reply to a comment tries the same and **falls back once to plain text with "title: link" lines** when Instagram answers code 100 with any subcode except 2534025 (already answered). | The button template is documented for the Send API; for private replies Meta documents only text, while ManyChat and two open-source Instagram Workers send buttons. A refused call does not use up the comment's one private reply. |
| DM length? | Plain-text DMs must fit **1,000 UTF-8 bytes** (about 500 Arabic letters, including the link lines); a DM with buttons, **640 characters**. The builder counts what is left. | Meta: the text "must be UTF-8 and be a 1000 bytes or less". v1 allowed 1,000 characters, which Arabic text can overflow (fixed here). |
| Clicks? | Link buttons go through v1's `/go/:id/:n` counter; the «تابعني» button links straight to `https://www.instagram.com/<username>/` (not counted). | Keeps v1's counter; counting follow taps can come later if wanted. |
| Storage? | **KV, one document per writer**, as in v1: `replies:doc` (dashboard), `replies:state` (poller), `replies:clicks` (`/go`). | Reuses v1's tested split (no path overwrites another's data). |
| Free plan writes? | The poller writes **only on ticks where something changed** (at most twice: lock, then result), **never on an idle tick**. After **300** `replies:state` writes in a UTC day it polls only on five-minute ticks; at **600** it stops answering until 00:00 UTC (03:00 Riyadh). The screen says which. | The free plan allows 1,000 KV writes a day for the whole Worker (reset at 00:00 UTC), shared with the sync, the publish queue, the Trend Radar and the clicks (capped at 200). `ponytail:` move the poller's state to D1 when instant mode lands (every event writes). |
| Cron? | **One trigger, `* * * * *`.** Minutes divisible by five keep today's schedule (sync slots, trend slots, publish, then replies when publishing moved nothing); every other minute only polls replies. | The free plan allows five cron triggers; one trigger keeps the "one job per tick" subrequest rule of `cron.ts`. |
| Talking over the owner? | A message from the owner's account that the Worker did not send, among the conversation's recent messages, means he is chatting by hand: **message rules and the default reply skip that conversation for 24 hours** after it. A message is the Worker's when its id is one the Send API returned, or when it was created within 2 minutes after a Worker send to that person. | Approved in part 1 ("it never talks over you"). Read from the messages each time, so nothing extra is saved. Instagram does not document that the Send API's `message_id` equals the Conversations API's message id, hence the time fallback; the real test checks it. |
| Pause? | **One "pause all" switch**, stored in `replies:doc`. | Approved in part 3. |
| Matching? | v1's `normalizeForMatch` for comments and messages (case, Arabic diacritics and tatweel, alef and yaa variants, punctuation); **contains** or **exact**. | Already tested; «لَت!» matches «لت». |
| Which rule wins? | Comments: specific-post rules before any-post rules, then oldest first. Messages: oldest first. The tester shows the winner. | Deterministic; same as v1 for comments. |
| Old messages on the first run? | The first DM poll only records where each conversation is; it answers nothing older. A rule (and the default reply) never answers a message from before it was switched on. | v1's `enabledAt` rule, extended to messages. |
| The screen? | **Beacons style** (owner: "Make it like beacons ai"): a rules table, and a full-page editor with a phone preview (Post / Comments / DM). On phones the table becomes cards. 💬 joins the desktop sidebar; on phones it stays in Social → More. | Approved in part 2. |
| AI writing button? | Not now. | Needs the Anthropic key (open owner question E1). |

## Step 0: the Live test (owner + Claude)

Our replies never ran: on Oct 3 the Meta app had neither reply permission added and was still Unpublished
(`10-auto-replies.md`, round 34 section). Meta's docs say Standard Access is enough for an account you own, and
several open-source comment-to-DM Workers report DMs reaching everyone once the app is Live without review; other
reports say messages to people with no role on the app fail. The test decides:

1. Merge PR #24 (the privacy, terms and data-deletion pages and the 1024px icon).
2. Meta app → Use cases → Instagram API → Permissions and features: **Add** `instagram_business_manage_comments` and
   `instagram_business_manage_messages`.
3. App settings → Basic: Privacy Policy URL, Terms of Service URL, data deletion instructions URL (all three under
   `https://3zmd95-glitch.github.io/hello-github/`), app icon (`public/icons/icon-1024.png`), category, contact email.
4. Publish → **Live**.
5. Dashboard → Settings → Instagram → **💬 Allow auto-replies**.
6. Auto replies → copy the Beacons rule: the LUT reel (`instagram.com/reel/DY5FTWxta5s`), keyword «لت» (exact),
   DM «حمل اللت من الزر تحت وجربه على لقطاتك», link «تحميل اللت» → the Beacons product link.
7. Beacons: switch its rule **off** and do not reconnect Instagram there (both would answer the same comment).
8. A friend **with no role on the Meta app** comments «لت». Within five minutes (v1's cadence):
   - **DM arrives:** Standard Access is enough; v2 goes live as soon as it is built.
   - **DM refused** (the log shows Instagram's words, for example "recipient user does not have role on app"): DMs to
     the public need Advanced Access. v2 still gets built and tested with a tester account, and goes live after the
     paperwork. **Plan B** meanwhile: Meta Business Suite's own automations ("Comment to message", keyword replies,
     instant reply), free and instant, set up by hand there.

## Paperwork for instant mode (owner)

- **Business Verification** is required for Advanced Access. Meta accepts a business registration or license, a
  government-issued business tax document (a ZATCA VAT certificate counts), or a business bank statement; a utility
  bill proves the address only ([Meta help](https://www.facebook.com/business/help/159334372093366)). Meta names no
  Saudi list, and the **freelance document (وثيقة العمل الحر) is not confirmed** as accepted; the legal name entered
  must match the document exactly. A sole-proprietorship commercial registration is the safer fallback.
- Order: Business portfolio (business.facebook.com) → Security Center → Start verification (up to 14 business days) →
  connect the business to the app (Settings → Basic → Verification) → most likely the Tech Provider track with Access
  Verification (about 5 days; the app dashboard puts App Review behind it) → App Review with a screen recording per
  permission (Meta says about a week; 2026 reports say 10 to 20 days).
- Then instant mode as its own round (below, "Later").

## Worker design

### Documents (KV)

`replies:doc` (written only by the dashboard routes) keeps `v: 1`; new fields are optional, and v1 documents read as
before:

```ts
interface AutomationsDoc {
  v: 1;
  origin?: string;
  /** Pause all: the poller answers nothing while true. */
  paused?: boolean;
  /** DMs that match no rule; at most once per person per 24 hours. */
  defaultReply?: { enabled: boolean; text: string; enabledAt?: string; updatedAt: string };
  /** "Check now": the next poll reads every watched post when this is newer than its last full scan. */
  scanRequestedAt?: string;
  automations: Record<string, Automation>;
}

interface AutomationInput {
  id: string;
  enabled: boolean;
  /** Missing in v1 documents = "comment". */
  trigger: "comment" | "message";
  /** Comment rules only: the media id, or null = any of the 5 newest posts. */
  postId: string | null;
  permalink?: string;
  title?: string;
  thumbUrl?: string;
  keywords: string[];
  match: "contains" | "exact";
  /** Comment rules only: up to 3, one picked at random. v1's `publicReply` string is read as [publicReply]. */
  publicReplies: string[];
  /** Plain text: 1,000 UTF-8 bytes with the link lines (about 500 Arabic letters); with any button: 640 characters. */
  dmText: string;
  /** Link buttons (https only). */
  buttons: ReplyButton[];
  /** Adds «تابعني» → https://www.instagram.com/<username>/. buttons.length + (followButton ? 1 : 0) ≤ 3. */
  followButton: boolean;
}
```

`replies:state` (written only by the poller) adds:

```ts
interface PollState {
  // …v1 fields (watch, handled, retries, stats, log, lastPollAt, lastFullScanAt, lastError, lockUntil, igUserId, ownerUsername)
  /** conversation id → the newest message time processed (pruned after 7 days). */
  convos: Record<string, { seenAt: string }>;
  /** Instagram-scoped user id → when the default reply last went to them (pruned after 24 hours). */
  defaultSentAt: Record<string, string>;
  /** Messages the Worker sent, by the Send API's message id → { to: the person's id, at } (pruned after 24 hours). */
  sent: Record<string, { to: string; at: string }>;
  /** replies:state writes today (UTC day): 300 → five-minute ticks only, 600 → no answers until 00:00 UTC. */
  writes: { day: string; count: number };
  stats: Record<string, ReplyStats>; // also keyed "default" for the default reply
}
```

Log entries gain `kind: "comment" | "message" | "story" | "default"` and, for DMs, the message id; `postId` and
`commentId` stay for comments. The log keeps the latest 50 entries, as in v1.

### The poll (every minute)

1. `paused` → nothing. 300 writes today and this is not a five-minute tick → nothing. 600 writes today → nothing.
2. **Comments** (v1's logic, unchanged): watched posts, changed comment counts (a full scan hourly), the private reply
   first, then a random public reply.
3. **Messages**: one call lists 20 conversations with their 5 newest messages each. Instagram lists the most recently
   updated first in practice; the docs do not say so, so every returned conversation is checked against its `seenAt`,
   and the real test confirms the order. For each conversation updated since its `seenAt`, handle the other person's
   messages newer than `seenAt` and inside the 24-hour window, oldest first:
   - a message from our account in the last 24 hours that is not the Worker's (see "Talking over the owner?") → the
     owner is chatting by hand: skip the conversation;
   - a story mention, an unsupported message, or a message without text → skip;
   - a DM or story reply with a keyword → the first matching enabled message rule → send its answer;
   - a DM (not a story reply) whose text has at least one letter or digit and matches no rule → the default reply, when
     it is on and this person got none in 24 hours (emoji-only messages and reactions never get it);
   - `seenAt` moves forward only once every message of the conversation was attempted.
4. **Sending**: the Send API to the person's Instagram-scoped id, plain text or a button template; the returned
   `message_id` goes into `sent`.
5. **Caps**: at most 8 answers per tick across comments and messages (480 an hour at most, under Meta's 750 private
   replies an hour), within the tick's outbound call budget; leftovers go next tick.
6. **Errors**: v1's codes and rules (`not_eligible`, `rejected`, `no_permission`, `token_expired`, `rate_limited`,
   `upstream`, `not_connected`); a DM outside the 24-hour window is `not_eligible` for that message; an app-level
   permission error stops the tick. Instagram's own words go into the log.

### Instagram API facts (checked Oct 3, 2026)

Host `https://graph.instagram.com` (docs show v25.0); `IG_ID` = `user_id` from `GET /me?fields=user_id,username` (v1
already caches it). Docs: `developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/`
(`conversations-api`, `messaging-api`, `button-template`) and `…/instagram-platform/private-replies`.

- **Conversations** (Standard Access is enough for an account you own):
  `GET /{IG_ID}/conversations?platform=instagram&limit=20&fields=id,updated_time,messages.limit(5){id,created_time,from,to,message,story,is_unsupported}`.
  Messages come newest first; only the 20 most recent of a conversation can be read; `from.id == IG_ID` means the
  account sent it (the Worker or the owner by hand); `message` is empty without text; `is_unsupported` appears only when
  true; timestamps may be ISO 8601 or UNIX seconds (read both). Requests-folder conversations idle for 30+ days are not
  listed. Limit: 2 calls a second per account.
- **Stories in a message**: a mention is `story.mention { link, id }` (documented); a reply is `story.reply_to { link,
  id }` (not documented, seen in SDKs). Story media is never stored.
- **Send**: `POST /{IG_ID}/messages` with `Authorization: Bearer`; text `{ recipient: { id }, message: { text } }`
  (1,000 UTF-8 bytes); buttons `{ recipient: { id }, message: { attachment: { type: "template", payload: {
  template_type: "button", text, buttons: [{ type: "web_url", url, title }] } } } }`. Answers `{ recipient_id,
  message_id }`.
- **Private reply**: the same call with `recipient: { comment_id }`; one per comment, within 7 days. A second one
  answers `100 / 2534025` "The comment is invalid for a private reply".
- **Errors**: outside the 24-hour window `10 / 2534022`; throttling 4, 17, 32, 613 (messaging `613 / 2534040`), 80002.
- **Limits**: private replies 750 an hour; Send API 100 calls a second; non-messaging calls 4,800 × the account's
  impressions per 24 hours (the minute poll uses about 1 to 4 calls a minute).

### Cron

`TICK_CRON` becomes `* * * * *`. `runTick`: on minutes divisible by five, today's schedule; on other minutes, the
replies poll only. Every sync and trend slot stays on the five-minute grid (a test keeps it so).
`wrangler.jsonc` → `triggers.crons: ["* * * * *"]`. Rolling the Worker back past commit `5e4d151` needs the trigger
set back to `*/5 * * * *`: the old code sends any other cron string to the daily sync, so `* * * * *` would run a full
sync every minute. During the first deploy a few old `*/5` events can still arrive and run one off-schedule sync each
(harmless, bounded).

### Routes

- `POST /social/replies` accepts the v2 fields (validation as above; `trigger: "message"` rules carry no post and no
  public replies).
- New `POST /social/replies/settings { paused?, defaultReply? }` (dashboard only, writes `replies:doc`). "settings"
  joins the reserved ids.
- `GET /social/replies` adds `paused`, `defaultReply` with its stats, and `guard: "slow" | "stop"` when the write
  guard is on today.
- `POST /social/replies/poll` («🔄 افحص الآن», "Check now") is a **scan request**: it stamps `scanRequestedAt` in
  `replies:doc` and answers `{ scanRequested: true, …the GET shape }`; the next tick (within a minute) reads every
  watched post. It never polls itself: a poll from the dashboard could read a copy of `replies:state` up to a minute
  old (KV propagation) and overwrite the cron poll's result, so `replies:state` keeps one writer. The screen says
  «طلبنا فحص؛ الردود تطلع خلال دقيقة.», or why nothing goes out yet (paused, or the write guard stopped for the day).
  The poll's lock now only guards overlapping cron polls.

## Dashboard

- **Rules page** (`/social/replies/`): account card (picture, @username, connection, "checks every minute" / "slowed
  today" / "stopped until 03:00" / "paused"), the **pause all** switch, «+ رد تلقائي جديد». A table (wide screens) or
  cards (phones): content (thumbnail + بوست / الخاص / افتراضي), message, keywords, destination (first button), sends,
  clicks, click rate, an on/off switch, ⋯ (edit, delete). The default reply is a row. Folded underneath: «جرّب كلمة»
  (which rule a comment or message would fire) and «آخر الردود» (the log).
- **Editor** (full page in the same route; back returns to the table): trigger cards (a specific post with a
  thumbnail grid / any post / a DM or story reply), keywords as chips with an exact-match switch, public replies (comment
  rules, up to three, with a switch), the DM text, link buttons, the «تابعني» switch; a **phone preview** with Post /
  Comments / DM tabs; «حفظ التغييرات». The default reply opens the same page with an on/off switch and its text.
- **Navigation**: 💬 in the Social desktop sidebar (`desktopOnly`); Social → More keeps its link.
- Copy: friendly Hijazi Arabic first, English second; `messages/replies.ar.json` and `messages/replies.en.json` in key
  parity.

## Testing

- **Worker** (vitest, fake fetch and KV as in `replies.test.ts`): v1 documents still read; a DM keyword answer; a story
  reply; a story mention skipped; the default reply once per 24 hours and never for story replies, emoji-only messages
  or reactions; the owner-chatting rule (by message id, and by the 2-minute fallback); the first-run guard; button
  template, and the private-reply fallback to text lines (not on `2534025`); the 1,000-byte limit; the «تابعني» link;
  the per-tick cap and call budget; the write guard switching to five-minute ticks at 300 and stopping at 600; pause;
  the cron minute routing with every slot on the five-minute grid.
- **Dashboard** (vitest): validation (buttons plus «تابعني» at most three, 1,000 bytes as plain text, 640 characters
  with buttons, three public replies at most, message rules without a post), reading v1 and v2 documents.
- **e2e** (Playwright, stubbed Worker as `e2e/autoreplies.spec.ts`): table and cards, the editor and its preview tabs,
  the default reply row, the pause switch, the desktop sidebar link, no sideways scroll on phones.
- **Real**, once the Live test passes: a friend comments, DMs a keyword, replies to a story, and sends a plain DM.
  The log then also shows whether the Send API's message ids match the Conversations API's (if not, the 2-minute
  fallback is what keeps the owner-chatting rule working).

## Search before building (Oct 3, 2026)

| Find | Fit | Decision |
| --- | --- | --- |
| ManyChat (Free: 25 contacts, 4 automations; Essential $17/month; Pro $39/month) | Comment-to-DM, three public variants, opening DM, DM keywords, story replies, default reply, automation pause when a human replies | Feature model. Not adopted: hosted and paid per contact, and its follow gate conflicts with Meta's like/share-gating rule. |
| Beacons Smart Reply (the owner's tool) | Trigger cards, keywords, three public replies, opening DM, DM + three buttons, phone preview | The UX model (part 2). Down since Instagram signed it out. |
| Metricool Flows and Inbox (Starter from $20/month) | Comment, DM and story triggers, three public variants, delays; an inbox to reply by hand | Not adopted (paid). |
| Meta Business Suite automations (free) | "Comment to message", keyword replies, instant reply; instant, no review | Plan B if the Live test fails; no stats in our dashboard. |
| [chatmany](https://github.com/ryanlaiyanip-ctrl/chatmany) (MIT), [ig-comment-dm](https://github.com/CharanMN7/ig-comment-dm) (MIT), [ig-autodm-worker](https://github.com/aldoprianandi/ig-autodm-worker) (MIT), [ig-harness-oss](https://github.com/Shudesu/ig-harness-oss) (MIT), brightbean-chat (AGPL-3.0), insta-p8 (MIT) | Comment-to-DM on the official API; most run on Workers with D1 | References for logic only: all started in 2026 with few users, they use D1 and their own dashboards. |

## Later

- **Instant mode** (after the paperwork): `GET/POST /social/webhook` (the `hub.challenge` handshake and the
  `X-Hub-Signature-256` HMAC-SHA256 check of the raw body; accept the Instagram app secret or the Meta app secret, since
  Meta does not say which signs) subscribed to `comments`, `messages` and `messaging_postbacks`, feeding the same matcher
  and sender; Meta retries for 36 hours, so events dedupe on the message `mid` or comment `id`; the poller's state moves
  to D1.
- FAQ buttons (ice breakers), the email ask (needs our list, D4), a nudge for people who did not tap, a thank-you for
  people who already follow, counting «تابعني» taps, AI writing (E1), Threads and YouTube public replies, the click
  counter on `3zprod.com/go`.
