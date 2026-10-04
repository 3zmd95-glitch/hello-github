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
  ownership verification for the image URL domain/prefix. New hosted-video jobs also use PULL_FROM_URL; older
  queued jobs retain their original transfer behavior.
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
- Personal accounts do not have the Business Messaging integration used by ManyChat. Comment-to-DM remains unavailable.
- Automatic video cutting/rendering, speech transcription, cloud file uploads and push notifications are not
  implemented by this change. The preparation exports are usable with the owner's existing editor.
- Built-in TikTok spam/keyword filters are native settings; no account settings are changed automatically.

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
