# 09 · Metricool + Beacons inside the dashboard (roadmap)

Owner, round 30 (Sep 29, 2026): "put it as something we work on, I want to have Metricool in my dashboard… and Beacons AI".
Goal: the 📱 Social world does what the owner uses **Metricool** (plan, post everywhere, analytics, reports, inbox) and
**Beacons** (link in bio, media kit, store, Smart Reply, email list, Beam AI) for, on the owner's own site, for about $0/month.
This file is the running checklist. Tick a row when it ships, and log decisions in the linked tools file.

Sources: Metricool pricing and feature list (metricool.com/pricing, Sep 29, 2026: Free, Starter from $20/month, Advanced
from $53/month, API only on Advanced); the Beacons inventory in `../handovers/beacons-2026-09-27.md` (Creator plan
$10/month, 13 sections, Beam AI); what is built per `../build-plan.md`.

Legend: ✅ built and live · 🟡 partly there · ⬜ to do · 🚫 not doing (reason given).

## Where we stand

### Metricool: plan and publish

| Feature | Ours | Status | Notes |
| --- | --- | --- | --- |
| Content calendar (week / month / stages) | Calendar | ✅ | `components/social/calendar` |
| Post to Instagram, Threads, YouTube, TikTok from one post | 🚀 tab + Worker queue | ✅ | All four published live on Sep 28–29 (`07-auto-posting.md` log) |
| Public posts on TikTok and YouTube; DMs to everyone | App reviews | ⬜ **A1** | Until the reviews pass: TikTok "Only me" and only while the account is private; YouTube private; Auto replies DMs reach only accounts with a role on the Meta app |
| X, Snapchat | Copy caption + open app | 🟡 | No free API. Zernio (Snapchat) or Buffer (X) if the owner wants them automatic |
| Best time to post | Hint in the new-post dialog | 🟡 **A5** | Static per platform today; compute from our own post stats |
| Upload media from the phone | Paste a public link | 🟡 **A2** | Supabase Storage (Sprint 3) or Drive upload |
| First comment | — | ⬜ A4 | IG/Threads reply after publish |
| Queue / auto-lists (next free slot, evergreen reposts) | — | ⬜ A6 | |
| Bulk schedule from CSV | CSV import exists for stats only | ⬜ A7 | |
| Post library / repurpose | Ideas bank | 🟡 | |
| Hashtag sets per topic | Hashtags on the post | 🟡 A8 | Saved sets + usage stats |
| Stories, carousels | — | ⬜ A9 | IG stories/carousels, Threads carousels, TikTok photos (needs domain check) |
| Canva / Drive picker | — | ⬜ | Drive picker comes with A2 |
| Approvals, team roles, multi-brand | — | 🚫 | Solo creator |

### Metricool: analytics and reports

| Feature | Ours | Status | Notes |
| --- | --- | --- | --- |
| Per-network analytics, demographics, top posts, CSV | Growth (Social Analytics) | ✅ | Daily Worker sync, `06-social-analytics-apis.md` |
| History beyond 30 days | KV snapshots, 400 days | ✅ | |
| "What changed this week" | WhatChanged | ✅ | Rule-based now; AI later (E1) |
| Competitor tracking | — | ⬜ B1 | YouTube public stats (API key) easy; Instagram needs Business Discovery (check if it works with Instagram Login); TikTok has no public API |
| Hashtag tracking | — | ⬜ B2 | Our own posts' hashtags × results first |
| PDF / shareable monthly report | — | ⬜ B3 | Also feeds the media kit (D2) |
| Trends | Trend Radar | 🟡 | Built in worktree `content-creator-dashboard-9f5258`, not merged yet (`08-trends.md` there) |

### Metricool + Beacons: engage

| Feature | Ours | Status | Notes |
| --- | --- | --- | --- |
| Inbox: comments from all networks in one list | — | ⬜ C1 | IG / Threads / YouTube comments by API; TikTok comments are not in the public API |
| Reply from the dashboard | — | ⬜ C1 | Same scopes as C1 plus reply permissions |
| Smart Reply (comment keyword → DM with a link) | 💬 Auto replies (`/social/replies/`) | 🟡 **C2** built (Sep 29) | Instagram: public reply + private DM with the links as lines, sends/clicks/CTR, tester, log; polling every 5 min (no webhooks without a Live app). Not yet: follow-first, nudge, email ask, real buttons. Spec: `10-auto-replies.md` |

### Beacons: link in bio, brand deals, money

| Feature | Ours | Status | Notes |
| --- | --- | --- | --- |
| Link in bio with click analytics | — | ⬜ **D1** | Own `/links` page + `/go/[slug]` redirect logging source/device/country (`02-website.md`). Last step: point 3zprod.com at our site |
| Media kit that updates itself | Business placeholder | ⬜ D2 | Numbers from the Growth data; "Work with me" form |
| Pricing calculator for brand deals | — | ⬜ D3 | Followers × views × deliverables |
| Email capture + welcome email | — | ⬜ D4 | 50 contacts to import from Beacons; Resend (`00-foundation.md`) |
| Store (free LUT, presets) | — | ⬜ D5 | Moyasar checkout (master plan); free downloads first |
| Audience CRM | — | ⬜ D6 | Contacts from D4/D5 |
| Affiliate links (Amazon, AliExpress gear pages) | — | ⬜ D1 | Same click-tracked links |

### AI (Beacons Beam / Metricool AI assistant)

| Feature | Ours | Status | Notes |
| --- | --- | --- | --- |
| Caption and hashtag writer per network | — | ⬜ E1 | Needs the Anthropic API key (open owner question) |
| Ask about my numbers ("which platform drives engagement?") | AiButton prompts | 🟡 E2 | Buttons exist; answers need E1's key |
| Weekly summary / what to post next | — | ⬜ E3 | Trends + analytics + calendar |

## C2 · Automatic comment replies + DM (copy of Beacons Smart Reply) — built Sep 29, spec in `10-auto-replies.md`

**Beacons builder, as seen in the owner's account on Sep 29, 2026** (plans: Free, Creator Pro $10, Store Pro $30, Business Pro
$90 a month):

- Trigger: someone **comments on a specific post / any post**, or **sends a story reply or DM**; **words to watch for**
  (exact match).
- **Reply publicly to their comment** (under the post, so others see it).
- **Opening DM** with a button ("Send it to me"). It opens the chat so the real message can follow.
- Optional: **ask for their email** before the link (saved to Audience), **ask them to follow first**, **nudge** them if they
  don't tap.
- Then the **private DM**: text plus up to 3 link buttons. Free and Creator plans add a "Sent with Beacons" line.
- Table: post, message, keywords, destination, sends, clicks, CTR, on/off.
- The owner's one automation: keyword «لت» on a post → DM "حمل اللت من الزر تحت وجربه على لقطاتك" → the free T&O LUT
  (193 clicks). **It is not sending now**: Instagram is disconnected in Beacons.

**What the official APIs allow (so what we can copy):**

| Platform | Auto public reply | Auto DM | How |
| --- | --- | --- | --- |
| Instagram | ✅ | ✅ | Comments read by **polling** from the Worker's cron (`comments`/`messages` webhooks reach only apps that are Live with Advanced Access, i.e. after App Review) → the **private reply** `POST /{ig-user-id}/messages` with `recipient.comment_id` (one text-only message within 7 days; `{ig-user-id}` = `user_id` of `GET /me`), then `POST /{comment-id}/replies` (public). Real buttons, the follow check (`is_user_follow_business`) and follow-ups need the 24-hour messaging window, i.e. the `messages` webhook. Scopes `instagram_business_manage_comments` + `_manage_messages`. **Under Standard Access the DM reaches only accounts with a role on the Meta app; App Review for `_manage_messages` opens it to everyone** |
| Threads | ✅ | ❌ (no DMs in the API) | Reply webhooks / polling + reply as the account (`threads_manage_replies`) |
| YouTube | ✅ | ❌ (no DMs) | Poll new comments (no webhooks) → `comments.insert` (scope `youtube.force-ssl`) |
| TikTok | ❌ | ❌ | No comment or DM API for regular apps |

**Our version (built):** the 💬 **Auto replies** screen at `/social/replies/` (Social → More): post or any post, keywords,
public reply, DM text + up to 3 links (sent as `title: link` lines through the Worker's `GET /go/:id/:n`, which counts the
tap), on/off, a tester, the log, Check now, sends/clicks/CTR per automation; "💬 Allow auto-replies" on the Instagram row in
Settings. The Worker polls comments on cron ticks where the publish queue moved nothing, DMs first, then replies publicly,
and keeps its state in KV documents split by writer. **Not yet** (need a Live app / the messaging window): instant webhooks,
real buttons, email ask, follow-first, nudge, story-reply triggers; Threads and YouTube public replies. Details, decisions and
the owner's steps: `10-auto-replies.md`.

Sources: [Meta: Private Replies](https://developers.facebook.com/docs/instagram-platform/private-replies/),
[Meta: Instagram API with Instagram Login](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/),
[YouTube comments.insert](https://developers.google.com/youtube/v3/docs/comments/insert),
[Beacons Smart Reply help](https://help.beacons.ai/en/articles/4703041), [Beacons plans](https://home.beacons.ai/plans).

## The owner's Metricool account (looked at Sep 29, 2026)

- **Free plan**, one brand (3z.prod). Connected: **Threads, TikTok (1,176 followers), YouTube**. **Instagram is not
  connected** there (➕ in the menu); Facebook neither.
- Free limits: 20 scheduled posts a month, 5 competitors, 30 days of analytics (watermarked), one link in bio, AI assistant,
  Hashtag Tracker, Inbox. Flows (comment → DM), PDF reports, multiple link-in-bio pages and unlimited history start at
  Starter ($20/month for up to 5 brands, annual). The **API** (and Looker Studio) needs **Advanced, $53/month and up**, so our
  Worker cannot drive Metricool on the free plan.
- **Metricool MCP works on the free plan**: Claude can schedule, edit and read posts, analytics, best times and
  competitors in plain language, with the free limits ([metricool.com/metricool-mcp-claude](https://metricool.com/metricool-mcp-claude/),
  [help: MCP FAQs](https://help.metricool.com/faqs-about-the-metricool-mcp-1i3w0)).

**Decision (owner, Sep 29): copy Metricool, do not connect to it.** No Metricool API, MCP or bridge posting. Metricool is
the model for what to build; every feature above is built in our own dashboard and Worker. Public TikTok/YouTube posts come
from our own app reviews (A1). The account is only a reference for how Metricool's screens work.

## Order of work

Proposed. The owner can reorder.

1. **A1 · App reviews for public TikTok and YouTube posts** (owner + Claude, free, days to weeks of waiting):
   - TikTok: fill the Production app (icon, description, terms and privacy URLs, a demo video of the 🚀 flow), then submit
     it for the Content Posting API audit. Rename "3zProd3z Prod" before submitting.
   - YouTube: the YouTube API audit form for project `z-prod-509907`, plus verifying the OAuth consent screen.
   - Meta: App Review for `instagram_business_manage_messages` (Advanced Access), so the Auto replies DM reaches
     every follower, not only accounts with a role on the app (`10-auto-replies.md`). Same privacy page, icon,
     description and screencast.
   - Needs public **terms** and **privacy** pages: add them to the site first (small task).
2. **C2 · Smart Reply** (the one Beacons automation in use), then **C1 · Inbox**.
3. **D1 · Link in bio + click tracking**, then move 3zprod.com. **D2 · Media kit** after.
4. **A2 · Upload from the phone**, **A5 · Best time from our own data**, **A4 · First comment**.
5. **B3 · Monthly report**, **B1 · Competitors**, **E1–E3 · AI** once the key is set.
6. Cancel Beacons (**$10/month**) when D1, D2, D4, D5 and C2 are live and the numbers have been checked side by side.
   Metricool is not paid today, so nothing to cancel there.

Every item starts with the project rule: **search before building** (GitHub, libraries, Claude skills), then record the
decision in `05-found-on-github.md`.

## Owner steps waiting

- Make @3z.prod public again after the TikTok test (Sep 29).
- Decide on A1 now or later: needs about an hour together (screens and demo video).
- Anthropic API key for E1–E3 (open question from round 30).
- Delete the leftover test posts: Threads `Dd1b3I2ihCB`, the private YouTube test `ri0mGaaDOsI`, the "Only me" TikTok test.
