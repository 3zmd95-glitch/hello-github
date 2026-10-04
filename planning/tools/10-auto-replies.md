# 10 · Auto-replies: comment a word, get the link in your DMs (Beacons Smart Reply copy)

Owner, round 30 (Sep 29, 2026): "can we do automatic comments like Beacons AI offers?" → "build it". Built: the
💬 **Auto replies** screen (`/social/replies/`, listed in Social → More), "💬 Allow auto-replies" on the Instagram
row in Settings, and the poller + routes in the Scout Worker (`workers/scout/src/social/replies.ts`). Roadmap item
**C2** of `09-metricool-beacons.md`. Planned with the Fable model, then reviewed by six parallel reviewers with
adversarial verification (20 confirmed findings fixed before the PR; decisions below).

## What it does

1. The owner adds an automation: a post (or **any post**), the **words to watch for**, an optional **public reply**
   under the comment, the **private message** and up to three **links**, on/off.
2. Every five minutes (the Worker's cron, on ticks where the publish queue moved nothing) the Worker reads the new
   comments on the watched posts. A comment that carries a keyword gets the **private DM first**, then the public
   reply (it says "sent it to you privately", so it only goes out once the DM did).
3. The screen shows per automation **sends, clicks and CTR**, a **tester** ("would this comment match?"), the
   **log** of what was answered, and **Check now**.
4. The owner's first automation: keyword «لت» on the LUT reel → DM "حمل اللت من الرابط تحت…" + the T&O LUT link.
   That replaces the Beacons Smart Reply that stopped sending when Instagram disconnected there.

## The one catch: who can receive the DM today

Reading comments and replying publicly work now: they are the owner's own data. **The private DM is a messaging
feature, and Meta's Standard Access (the Meta app is in Development mode) only delivers messages to accounts that
have a role on the app** (admin, developer, Instagram tester). DMs to every follower need **Advanced Access for
`instagram_business_manage_messages` = App Review**: a privacy-policy page on the site, an app icon, a use-case
description and a screencast of the flow. That is roadmap item **A1** (the same review round as TikTok's and
YouTube's). Until then, test the DM from an account added as an Instagram tester on the Meta app; a refused DM
shows up in the log with Instagram's words and the comment is marked done, nothing loops.

## Decisions (with the reasons)

| Question | Decision | Why |
| --- | --- | --- |
| Webhooks or polling? | **Polling** from the existing cron; no webhook route in v1 | Meta sends `comments` webhooks only to apps that are **Live with Advanced Access**; the owner's Meta app is in Development mode. Polling works with the same Standard Access that already publishes. A webhook can later feed the same matcher/sender. |
| DM or public reply first? | **DM first; the public reply only after the DM went out** | The public text promises a DM. Review finding: with the public reply first, a failed DM re-posted the public reply on every retry (up to every 5 minutes for 7 days). Instagram allows one private reply per comment, so the DM itself can never duplicate. |
| Buttons in the DM? | **Text only, links as lines** (`title: link`) | Meta documents the private reply to a comment as `message.text` only; buttons come with the 24-hour messaging window after the person writes back (v2, needs the `messages` webhook). Buttons are stored as buttons so v2 needs no migration. |
| Follow-first, nudge, email ask (Beacons extras) | **Not in v1** | `is_user_follow_business` needs an IGSID that only exists once the person messages us; the nudge needs the messaging window; the email ask needs our own list (D4). |
| Storage | **Three KV documents, one per writer**: automations (dashboard), poll state (poller), clicks (`/go`) | KV is last-write-wins with no transactions. Review finding: one shared document let a poll's final write revert an owner's toggle, and a public `/go` tap rewrite the poller's state. Now no path ever writes another's data. |
| Cron vs "Check now" | A short **lock** (4 min) in the poll state while comments are being answered | Two overlapping polls would answer the same comment twice; "Check now" during a tick now says "a check is already running". |
| Click tracking | `GET /go/:id/:n` on the Worker: counts into its own document and redirects | Our `/go/[slug]` link tracking (D1) is not built yet. One counted tap per visitor per link per minute (Cache API) and 200 a day, so a bot cannot burn the free plan's KV writes; the redirect only ever goes to an owner-saved https link. |
| Meta error code 10 | Read the **subcode**: app-level → stop the tick; messaging-window → final for this comment; other recipient subcodes → final for this comment | Review finding: treating every code 10 as "app has no permission" let one un-messageable commenter block every newer comment for 7 days. |
| Where in the dashboard | Own route `/social/replies/` | The 🚀 hub is about the queue; replies have their own builder, tester and log. |
| Budget | Poll only on ticks where `runDue` advanced nothing; at most 8 replies a tick, leftovers next tick | Keeps every tick under 50 subrequests without threading budgets through the publish queue. |
| Threads / YouTube public replies | Later | No DMs there; the public-reply part can reuse the matcher. TikTok: no comment API at all. |

## Platform facts (Instagram API with Instagram Login)

- Scopes: `instagram_business_manage_comments` (read comments, reply publicly, private replies) and
  `instagram_business_manage_messages` (DMs). Standard Access covers the owner's own data (comments, public
  replies); private replies to accounts without a role on the app need Advanced Access (App Review).
- `POST /{ig-user-id}/messages` with `{ recipient: { comment_id }, message: { text } }` → the private reply:
  **one per comment, within 7 days**, text only. `POST /{comment-id}/replies` → the public reply. `/{ig-user-id}` is
  the professional account id from `GET /me?fields=user_id` (the token exchange's id is app-scoped and refused).
- Refusals: code 100 / subcode 2534025 "The comment is invalid for a private reply" (older than 7 days, already
  answered privately, deleted, or the account blocks message requests) → `not_eligible`; code 10 with subcodes
  2534022 / 2018278 / 2018065 (messaging window) → `not_eligible`; code 10 with no subcode or an app subcode
  (1404170, 2534077, 1893063) → `no_permission`; other code-10 subcodes (e.g. 2018108 "They can't receive your
  messages right now") → `rejected` for that comment.
- Rate limits count per account; the Worker answers at most 8 comments a tick.

## Owner's part (once)

1. **Meta app** (3z Prod, `2189335038677989`) → Instagram API with Instagram Login → permissions: add
   **`instagram_business_manage_comments`** and **`instagram_business_manage_messages`**. Under Settings → Roles,
   add a second Instagram account of yours as an **Instagram tester** (it can receive the test DMs).
2. Merge → **Actions → Deploy Scout Worker** runs by itself. No new secrets.
3. Dashboard → **Settings → Connected accounts → Instagram → 💬 Allow auto-replies** (re-consents with the posting
   scopes too; analytics keep working). On an Instagram row that has no posting permission yet the button reads
   **✍️ Allow posting + replies**: one consent grants both. Leave every permission ticked in Meta's dialog: the
   chip only appears when both reply permissions were granted.
4. **Social → More → 💬 Auto replies → + New auto reply**: the LUT reel, keyword «لت», the DM text, link "حمل اللت"
   → the LUT URL. Test by commenting «لت» from the tester account (the owner's own comments are skipped), then
   **Check now** or wait up to five minutes. The public reply appears under the comment, the DM in the tester's
   inbox.
5. For DMs to everyone: **App Review** for `instagram_business_manage_messages` (A1: privacy page, icon,
   description, screencast). Keep Beacons until it passes if its Smart Reply matters; it is not sending today
   anyway (Instagram disconnected there).

## Worker contract (details in `workers/scout/README.md` → Auto-replies)

`GET /social/replies` · `POST /social/replies { id, enabled?, postId?, permalink?, title?, thumbUrl?, keywords, match?, publicReply?, dmText, buttons? }` ·
`POST /social/replies/poll` · `DELETE /social/replies/:id` · `POST /social/connect/instagram { returnTo, replies: true }` ·
public `GET /go/:id/:n`. Three KV documents (`replies:doc`, `replies:state`, `replies:clicks`); an idle tick writes nothing.

## Search before building (2026-09-29)

| Find | Fit | Decision |
| --- | --- | --- |
| [AutoDMX](https://github.com/Aditya5688/AutoDMX), [open-autodm](https://github.com/andaveti42-cmyk/open-autodm), [instagram-dm-automation](https://github.com/ElAmir-Mansour/instagram-dm-automation), [ig-automation](https://github.com/elmlahym-wq/ig-automation) | Self-hosted comment → DM bots on the official API, but Next.js/FastAPI servers with Postgres/SQLite and **webhooks** (Live app + Advanced Access) | Reference for the flow; not adopted: nothing runs on a free Worker with KV and polling. About 1,800 lines written across Worker + dashboard, plus about 1,300 lines of tests. |
| ManyChat, LinkDM, Beacons Smart Reply | Hosted, $10–15/month, need their own Meta app review | The UX model (Beacons' builder was copied field by field). |

## Round 34 (Oct 3, 2026): our version replaces Beacons, the Live test first

Owner: "its made with beacons.ai I want our version"; goals: free downloads, grow followers, answer common DMs.
What the real check found (read-only, Oct 3):

- Beacons Smart Reply is down: "Instagram needs to be reconnected", 0 sends, 193 clicks. Its one rule: the LUT
  reel (`instagram.com/reel/DY5FTWxta5s`), keyword «لت» (exact), DM «حمل اللت من الزر تحت وجربه على لقطاتك» with
  the button «تحميل اللت» → the Beacons store product.
- Ours never ran: the Meta app has neither `instagram_business_manage_comments` nor
  `instagram_business_manage_messages` added (only basic, insights and publish are "Ready for testing"), and the
  app is Unpublished (Development mode).
- Meta's docs say Standard Access is enough for a business you own (App Review "Not required"), and several
  open-source comment-to-DM Workers report DMs reaching everyone once the app is **Live**, without review. The docs
  also contradict that, so a real test decides: Live → a friend with no role on the app comments «لت».

For Live, the app needs public policy pages, now on the dashboard site (`public/`, plain HTML, Arabic then English):

- Privacy Policy: `https://3zmd95-glitch.github.io/hello-github/privacy/`
- Terms of Service: `https://3zmd95-glitch.github.io/hello-github/terms/`
- Data deletion instructions: `https://3zmd95-glitch.github.io/hello-github/data-deletion/`
- App icon 1024×1024: `public/icons/icon-1024.png` (from `scripts/make-icons.mjs`)

Do not reconnect Beacons during the test: both would answer the same comment.

## Later

- Webhooks (`comments` + `messages`) once the Meta app is Live with Advanced Access: instant replies, real buttons
  in the follow-up DM, follow-first, nudge, story-reply triggers.
- Email ask before the link (needs our list, D4), first comment on our own posts, Threads and YouTube public replies.
- Move the click counter onto the site's `/go/[slug]` (D1) so links read `3zprod.com/go/lut`.
