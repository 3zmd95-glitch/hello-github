# TikTok Personal creator toolkit

Owner requirement (October 4, 2026): keep 3z.prod Personal for music access and maximize supported automation.
Account type and profile privacy must stay under the owner's control. A publishing permission is not proof
that TikTok has approved public Direct Post.

## Implemented in this change

- Creator draft assistant in the calendar's Script tab: Arabic/English, a reviewable hook, three beats, CTA,
  caption, hashtags and shot list. Uses the existing Cloudflare Workers AI binding. Applying a result is
  explicit and refuses to overwrite content changed while generation was in progress.
- Production-pack text and SRT/VTT exports. Subtitle times are estimates from the written script and selected
  duration, not speech recognition. The creator still records/edits the actual video and adjusts subtitle timing.
- TikTok inbox mode is the default for newly configured posts. An inbox delivery is shown as needing completion
  in TikTok; it does not mark the calendar post published or complete its Produce quest. Final confirmation
  requires the actual TikTok post link.
- Photo carousel editor and API support, with ordered image URLs, cover choice, title and caption. TikTok needs
  ownership verification for the image URL domain/prefix. New or resaved hosted-video jobs use PULL_FROM_URL.
  Existing inbox jobs retain FILE_UPLOAD, and jobs already sent to TikTok continue polling their existing
  publish ID. An old queued Direct Post lacks the new explicit consent and duration metadata: it is refused
  with an actionable review message until the owner reviews and resaves it. That resave requires an explicit
  Direct Post choice, privacy, consent and duration, then uses PULL_FROM_URL. No consent is inferred and no
  existing job silently changes to inbox mode.
- Actual TikTok granted scopes distinguish upload-to-inbox from Direct Post. Direct Post loads current creator
  metadata and privacy choices, interaction restrictions, maximum duration and disclosure/consent controls.
- TikTok performance brief in Growth: 7/30-day publishing cohorts, median views, shares per 1,000 views,
  ranking by views/shares/comments, follow-up draft creation and CSV export. Metrics are current lifetime
  counters on the selected posts; they are not views gained during the selected date window.
- Studio links to the preparation, finishing and performance workflows. English and Arabic text throughout.

## Deployment and activation

Creator generation targets a best-effort budget of 20 new calls per UTC day. KV counters serialize within
one Worker instance but are not atomic across instances; this is not a hard billing cap. Caller timeouts
retain the original inference for same-input retries and register late validation/cache through `waitUntil`,
subject to the Worker's lifetime. Results expire after 24 hours and counters after 48 hours.

1. Merge/deploy the frontend and Scout Worker together. The new creator endpoint is `/creator/draft`, protected
   by the existing owner bearer token and allowed-origin checks. It uses the already configured `AI` binding
   and `SOCIAL_KV`; no third-party AI key is added. New frontend controls must fail clearly on an older Worker.
2. Read TikTok connection status. Reauthorize only if the required `video.upload` or `video.publish` grant is
   absent; requesting a grant does not mean it was received. Do not change account type or make it private.
3. Verify the public media domain or URL prefix in the TikTok developer app before using URL-based uploads.
   Merely converting a Dropbox/Drive URL into a download link does not verify its ownership with TikTok.
4. Test a single owner-approved video sent to the inbox. Confirm the TikTok notification, add the chosen sound,
   finish publishing in TikTok, paste the real post URL into the dashboard and check that it completes once.
5. Test photos separately after the media domain is verified. Do not call mocked API tests live successes.

## Approval-dependent work, not represented as active

### Public comments

TikTok's **Accounts API** explicitly includes Personal accounts for insights, publishing and comment
moderation. Its public-reply endpoint is separate from Business Messaging. This requires a separate Accounts
API access application, developer app permissions and creator authorization; our existing Login Kit/Display
API token cannot be assumed to work.

Proposed access-application use case:

> The owner of 3z.prod uses a private dashboard to manage their own TikTok Personal account. We request access
> to read comments on their owned posts, organize questions and post relevant public replies to matching
> comments with creator-approved templates. We will use a conservative sending limit, deduplicate comment
> IDs, provide pause controls and a reply log, and stop when permission is revoked. We do not request personal
> account direct-message automation, follower scraping or unsolicited messages to other accounts.

This description is prepared for review, not submitted. No credentials are invented, no approval claimed,
and no disconnected public-comment toggle is presented as working. When access is granted, implement the
separate OAuth lifecycle, comment list/webhook handling, public-reply rules, deduplication and moderation tests.

### Public Direct Post

TikTok's standard Content Posting API audit explicitly excludes private/internal utilities limited to accounts
the developer/team manages. This dashboard currently is a private owner tool (including in its privacy policy).
Do not submit a misleading public-audience description to obtain approval. The owner can use TikTok Studio,
an already approved publishing integration, or an eligible Accounts API route. Direct Post code and a granted
scope alone do not remove the audit restriction.

### Other remaining boundaries

- Selected trending sounds are added inside TikTok; no arbitrary sound-ID selection is invented for the video API.
- General TikTok accounts (3z.prod today) do not have the Business Messaging integration used by ManyChat.
  Comment-to-DM remains unavailable. Eligibility and limits are recorded in the next section.
- Automatic video cutting/rendering, speech transcription, cloud file uploads and push notifications are not
  implemented by this change. The preparation exports are usable with the owner's existing editor.
- Built-in TikTok spam/keyword filters are native settings; no account settings are changed automatically.

### Direct messages (Business Messaging API), checked October 24, 2026

Status: not eligible today, not planned. The owner's October 22 decision stands: 3z.prod stays Personal for the
music library, so no TikTok DM reading or automatic DM replies, and no browser automation (breaks TikTok's rules
and risks the account). Facts below come from TikTok's own pages unless marked as vendor-reported.

**No follower minimum.** TikTok's access page names no follower count. The "1,000+ followers" figure that
appears in one vendor article is TikTok's bio-link rule (1,000 followers or a Verified Business Account), not a
Business Messaging requirement.

**Eligibility gates (TikTok's own wording):**

1. Account tier. "The Business Messaging API only supports TikTok Accounts with Advanced Access or Verified
   Business Accounts ('VBA'). General TikTok Accounts are not eligible." Advanced Access is granted when the
   TikTok account is linked to a TikTok for Business account or an unverified Business Center. VBA needs business
   verification with documents; Saudi Arabia is on the supported market list.
2. Developer review for our app. A data security and privacy review: TikTok emails a due-diligence questionnaire
   ("TikTok/ByteDance Third-Party Due Diligence Questionnaire", DSPR DDQ) after the intake form, review starts
   within 10 working days, is manual, has no status tracking and no guaranteed timeline. ISO 27001, SOC 2 or a
   pen-test report speed it up. Accounts signed up in the US also need the US data security review and USDS
   Addendum; exclude the US from any application, 3z.prod is a Saudi account.
3. Region. Not available for accounts signed up in the EEA, Switzerland or the UK. Saudi Arabia is fine.

**Limits once live (TikTok's "Messaging limits" page, for non-mutual-follow conversations):**

- The account may never start a conversation. The user writes first: profile, a `tiktok.me/{username}` link
  (optional `ref` and `message` parameters, mobile app only), or TikTok Messaging Ads. No broadcasts.
- First 48 hours after the user's first message: at most 10 messages.
- Each user reply opens a 48-hour window with no message cap.
- If the user is silent for more than 48 hours: at most 3 further messages until the user replies again.
- Message types that can be sent: text, image (not every market; `/business/message/capabilities/get/` says
  whether an image can be sent), Q&A button card, Q&A text-link card, TikTok post, typing and seen indicators.
  No video, voice or stickers. Image `media_id` expires after 30 days.
- `/business/message/conversation/list/` returns up to 100 conversations; `/business/message/content/list/`
  returns the 20 most recent messages of one conversation.
- Automatic messages the API can manage: welcome message, suggested questions, chat prompts, new-follower
  message. The same four exist natively for Advanced Access and VBA accounts in TikTok's Business Suite.
- TikTok Shop messages are a separate system; the Business Messaging API does not reach them.
- Vendor-reported only, not on TikTok's pages: roughly 100 to 200 conversations per account per day and a rate
  limit of 10 requests per second.

**Open question before any change of account tier.** TikTok's pages do not say whether linking 3z.prod to a
TikTok for Business account (Advanced Access) changes the in-app account type or removes the general music
library. May 2026 reports describe unverified Business accounts being pushed to verify and some reverting to
General. Check inside the TikTok app and confirm the music library is untouched before linking anything.

**3z.prod account state, read in the owner's browser on October 24, 2026 (nothing changed):**

- tiktok.com, logged in as @3z.prod: the avatar menu has no "Business Suite" entry and Settings shows the
  "Business verification" toggle off. Entitlement level: General TikTok Account. Not eligible for the Business
  Messaging API today.
- ads.tiktok.com User settings (the owner's TikTok for Business login, the one that holds the ONUS Content
  Planner developer app): "TikTok account: –", nothing linked. One TikTok for Business login links one TikTok
  account.
- @3z.prod DM privacy, "Who can send you messages": "Potential connection" (friends, accounts followed, people
  you may know). Strangers cannot message the account today.

**Decision: no new account.** DMs land on the account people write to, which is @3z.prod. A separate Business
account would start with an empty inbox and zero followers and would need the same linking anyway.

**Owner steps if DM automation is ever wanted, in order (owner's actions, not automated):**

1. Link @3z.prod to the existing TikTok for Business login: ads.tiktok.com, User settings, "Link TikTok
   account", log in as @3z.prod, Authorize. Free, no documents, no follower count; TikTok documents an unlink
   path, so it is reversible.
2. Same day, open the TikTok app, start a new post and open the sound library. Full library still available:
   keep the link and mark the open question closed here. Only "Commercial sounds": unlink immediately; the
   Personal-for-music decision stands and DM automation stays out of scope.
3. With Advanced Access, the native automatic messages (welcome message, suggested questions, chat prompts,
   new-follower message) become available in Business Suite inside the app, with no code and no API review.
   Set "Who can send you messages" to Everyone there, otherwise strangers never reach the inbox.
4. Only after 1 to 3 hold: apply for the Business Messaging API for the ONUS Content Planner app (data security
   and privacy review, questionnaire by email, manual, no timeline) so the dashboard can read and reply to DMs.
5. Business verification (Verified Business Account, documents required) is not needed for messaging. Skip.

## Official sources checked October 24, 2026

- [Access to Business Messaging API: eligibility, reviews, regions, Advanced Access / VBA FAQ](https://business-api.tiktok.com/portal/docs/access-to-business-messaging-api/v1.3)
- [Messaging limits for Business Messaging API](https://business-api.tiktok.com/portal/docs/messaging-limits-for-business-messaging-api/v1.3)
- [Manage direct messages for a TikTok account](https://business-api.tiktok.com/portal/docs/manage-direct-messages-for-a-business-account/v1.3)
- [Manage automatic messages for a TikTok account](https://business-api.tiktok.com/portal/docs/manage-automatic-messages-for-a-business-account/v1.3)
- [Unlock conversations: tiktok.me links and Messaging Ads](https://business-api.tiktok.com/portal/docs/unlock-conversations/v1.3)
- [About TikTok account entitlements (General / Advanced Access / VBA)](https://ads.tiktok.com/resources/help/article/about-tiktok-account-entitlements)
- [About business verification for TikTok accounts](https://ads.tiktok.com/help/article/about-business-registration)
- [How to link an existing TikTok for Business account with a TikTok account](https://ads.tiktok.com/help/article/how-to-link-an-existing-tiktok-for-business-account-with-a-tiktok-account)
- Vendor pages used only for the daily-conversation and rate-limit figures:
  [respond.io](https://respond.io/help/tiktok/tiktok-overview),
  [SleekFlow](https://help.sleekflow.io/en_US/tiktok-business-messaging-channel-overview),
  [Qiscus](https://documentation.qiscus.com/latest/omnichannel-chat/tiktok-direct-message),
  [Velaro](https://help.velaro.com/kb/article/716/tiktok-messaging)

## Official sources checked October 4, 2026

- [Upload video/photo drafts](https://developers.tiktok.com/docs/en/content-posting-api-get-started-upload-content)
- [Photo publishing schema](https://developers.tiktok.com/docs/en/content-posting-api-reference-photo-post)
- [Direct Post guidelines and audit restrictions](https://developers.tiktok.com/docs/en/content-sharing-guidelines)
- [Accounts API Personal-account support and application requirement](https://business-api.tiktok.com/portal/docs/accounts-api-overview/v1.3)
- [Public comment replies](https://business-api.tiktok.com/portal/docs/reply-to-an-existing-comment-on-an-owned-video/v1.3)
- [Business Messaging eligibility](https://business-api.tiktok.com/portal/bm-api/education-hub)

## Verification

Record local checks, PR CI and any real TikTok trials in the PR. Historical September 29 SELF_ONLY success is
not a live test of this inbox/photo workflow. There is no automatic change to 3z.prod's Personal/public status.
