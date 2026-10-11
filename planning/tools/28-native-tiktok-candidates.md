# Native TikTok candidate acquisition — 11 October 2026

## Corrections from the audit

The next implementation removes the platform reset when a user changes genre. Selecting TikTok, Instagram or YouTube now carries that choice into the next category; a phone/desktop regression checks the selected button, matching card platform and absence of native/paid retrieval. The explicit reset used when adding a reference is unchanged.

The shared category evidence classifier now treats explicit American-football cues as another sport when evaluating soccer, including the observed NFL/college-football hashtags and Arabic wording. Explicit soccer, Messi or Ronaldo references can still establish mixed-source soccer content, and ambiguous `football` alone is not rejected. The exclusion is shared by Worker quality checks and local ranking; native popularity, a “More like this” vote and visual-craft evidence cannot override it. This is a caption-grounded category correction, not a visual-quality judgment. Existing classifiers and browser fixtures were reused; no new library, provider, spending or grant is needed.

Focused tests pass (229 across quality/ranking), including the three real false-positive caption patterns, strong named-craft negatives, Arabic, mixed soccer positives and another genre's lesson. The first Arabic regression exposed the existing normalizer's article stripping; matching normalized phrases corrected it before the successful run. Full gates passed: **3,246 root tests / 166 files**, **1,323 Worker tests / 47 files**, lint/types/production build and **410 browser tests / eight intentional skips / zero failures**. Log: system Temp `discover-category-fixes-gates-2026-10-11.log`.

The tested export now serves localhost:3000. In actual Chrome, TikTok, Instagram and YouTube each remained selected when switching genres. Football's TikTok Explore feed changed **eight → five**: the three identified American-football captions disappeared, while Messi/Ronaldo/Neymar/soccer leads remained. Source checks had settled at the final read. Anime retained its three TikTok Inspiration cards. No new retrieval, paid search or model call was used. Screenshot: system Temp `discover-category-fixes-2026-10-11.jpg`. The twelve-genre table below is the pre-correction baseline; broad quality and supply are still unfinished.

## Twelve-genre Chrome audit

The native acquisition action was run once in each genre, with source checks allowed to settle. No additional paid searches, AI assessments or grant changes. This is a supply/admission test, not proof that every listed video is a good edit. Code remains `3ac2d49`; its GitHub CI `38117648051` passed both jobs.

**Scope correction:** changing `browse-category-switch` resets `tab` to All in `BrowseCategoryFeed.tsx`. Consequently the baseline/after measurements for the eleven categories following Anime used All platforms. The post-retrieval TikTok-only totals below were separately read with `browse-tab-tt` explicitly selected. Acquisition was not repeated. The earlier Anime pilot explicitly used TikTok. Counts for modes overlap.

| Genre | Native candidates returned | All Inspiration before → after | TikTok Inspiration | TikTok Popular | TikTok Learn | TikTok Explore |
| --- | ---: | --- | ---: | ---: | ---: | ---: |
| Anime | 12 | Not measured; TikTok 1 → 3 | 3 | 3 | 1 | 8 |
| Cars | 12 | 1 → 1 | 1 | 0 | 3 | 7 |
| Food | 0 | 1 → 1 | 1 | 0 | 5 | 9 |
| Travel | 4 | 0 → 0 | 0 | 0 | 1 | 3 |
| Football | 12 | 15 → 15 | 1 | 0 | 0 | 8 |
| Coffee | 12 | 1 → 1 | 1 | 0 | 3 | 4 |
| Perfume | 0 | 9 → 9 | 3 | 0 | 0 | 3 |
| Camping | 1 | 0 → 0 | 0 | 0 | 0 | 3 |
| Fashion | 0 | 7 → 7 | 0 | 0 | 5 | 5 |
| Gaming | 0 | 5 → 5 | 1 | 0 | 3 | 4 |
| Weddings | 12 | 9 → 9 | 1 | 0 | 0 | 1 |
| Gym | 11 | 9 → 9 | 0 | 0 | 2 | 2 |

The four zero results displayed “TikTok returned no usable posts for this category. Your existing feed is kept.” These were accepted empty outcomes, not errors parsed as zero. Cars gained one All Explore lead and Football seven; other recorded All mode totals stayed unchanged. Coffee's initial baseline recorded only Inspiration, so no learning delta is established. Returned counts are not unique additions or verified trending edits. The eleven non-Anime trials returned 64 candidates and added no Inspiration. Native retrieval alone has not solved broad coverage. Coffee and Gym's first TikTok-only rereads still showed pending source checks; their counts were recorded again once settled. The final Chrome preview remains Anime/TikTok with three Inspiration cards, captured in system Temp `discover-native-audit-2026-10-11.jpg`.

The source-check queue prioritizes unread sources before previously observed evidence, with an eighteen-post/platform batch ceiling. This rules out the simple assumption that it always checks the same oldest array prefix; it does not prove every candidate was checked. Football's eight TikTok Explore cards visibly displayed source counts, so lack of counts is not the only admission issue. Several have only generic edit/football wording, which does not establish a specific technique or a visually reviewed project.

Three Football leads also describe American football, despite the category's soccer intent:

- `https://www.tiktok.com/@font.aftereffects/video/7691065241643289886` — Alabama football/Jalen Milroe; 181.1K displayed views.
- `https://www.tiktok.com/@letsile__tebogo2003/video/7690791371472489741` — Case Keenum/Bears/NFL; 3.7M displayed views.
- `https://www.tiktok.com/@oikos96/video/7692921852318076174` — Patriots/Bills/NFL edit; 91.3K displayed views.

These are observed category false positives in Explore, not proof about their visual editing quality. Next changes: preserve platform selection across genres with a browser regression, distinguish explicit American-football cues without excluding ambiguous soccer captions, and expose bounded nonsecret acquisition-stage counts to diagnose empty genres. Keep popularity and creative-evidence requirements; do not loosen them to manufacture full feeds. Full Instagram/YouTube genre review and balanced visual evaluation remain open.

### Instagram capability boundary

The current Meta [Hashtag Search guide](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-facebook-login/hashtag-search), updated 17 August 2026 and read in actual Chrome, requires app review for **Instagram Public Content Access** plus **instagram_basic**. It permits thirty unique hashtags per professional account per rolling seven days; `top_media`/`recent_media` also count toward this limit. Licensed-audio videos and other users' reels with downloads disabled can omit `media_url`, so hashtag access would not guarantee downloadable footage/audio.

The existing `workers/scout/src/social/instagram.ts` connector uses **Instagram Login**, with `instagram_business_basic,instagram_business_manage_insights`. That grant does not establish the Facebook Login hashtag capability. See the separate official [Instagram Login](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login) and [Facebook Login](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-facebook-login) API guides. No credentials, new grants or app-review settings were inspected or changed. Plan the required access explicitly before attempting native Instagram acquisition.

## Verified live pilot

Commit **`3ac2d49dd20f9cebcb0942d8ad7563f08970b113`** is pushed on PR #70 and deployed by successful [Worker run 38117645876](https://github.com/3zmd95-glitch/hello-github/actions/runs/38117645876). The tested static export is copied to primary's ignored `out` and served at localhost:3000 by the existing server. Primary tracked source and private connections were preserved; no server restart.

One explicit **Find TikTok edits** action in actual Chrome returned **12 candidates** for Anime. Native source checks increased TikTok Inspiration from **one to three** cards. The resulting TikTok mode counts were **3 Inspiration / 3 Popular recently / 1 Learn / 8 Explore**; these modes overlap and are not a twelve-post accuracy score. Three Inspiration cards survived a full page reload and category/platform reselection without another acquisition. Saved remained two. No paid search, AI assessment or preference action was used.

Two added Inspiration cards were sampled in the real TikTok player:

- `https://www.tiktok.com/@blackbd.edits/video/7692000181524368648`: FMAB edit, card dated October 3, approximately 281.6K native views. The player showed 62.2K likes, 208 comments, 7,437 shares and 25-second duration. A captured frame around ten seconds showed anime footage with prominent typography and a blurred background treatment.
- `https://www.tiktok.com/@itzcrxsy/video/7692580433384574228`: Black Clover edit, card dated October 4, approximately 320.9K native views. The player showed 92.2K likes, 367 comments, 6,230 shares and 16-second duration. A captured frame around fourteen seconds showed stylized anime footage with an overlay title and blurred background treatment.

The new Learn candidate, `https://www.tiktok.com/@zaynccedit/video/7670030287509671189`, is **Four Corner Beat Sync effect**. The card is dated August 4 (an evergreen lesson, not a newly published trend), approximately 586K views. The actual player showed 25.1K likes and 53-second duration. Around nine seconds the sample showed CapCut's timeline, clip controls, an instructional arrow and text directing a tap. This supports instructional content rather than only a tutorial hashtag. These are bounded visual samples, not full audio/video analysis or a balanced classifier evaluation.

Public screenshots in Temp: `discover-tiktok-native-fmab-2026-10-11.jpg`, `discover-tiktok-native-clover-2026-10-11.jpg`, `discover-tiktok-native-tutorial-2026-10-11.jpg`, and `discover-tiktok-native-pilot-2026-10-11.jpg`. Deployment log: `discover-tiktok-acquire-deploy-2026-10-11.log`.

The twelve-genre native audit above supersedes this pilot's original next step. The full three-platform matrix remains open. Current US chart coverage is explicitly labeled; Saudi coverage and native Instagram acquisition remain open. Consolidate overlapping native/indexed retrieval controls if user testing finds them confusing. This pilot does not prove effect/audio trend growth, reproduce private social algorithms, establish that every candidate is a good edit, or complete Discover.

## Evidence and decision

The successful native hashtag probe at commit `454b02c` returned 200 Anime hashtags. The public SDK did not describe related videos, but the current official portal does: [Get trending videos related to hashtags](https://business-api.tiktok.com/portal/docs/get-trending-videos-related-to-hashtags/v1.3), read in actual Chrome on 11 October. It documents GET `/open_api/v1.3/discovery/video_list/`, up to ten `hashtag_ids` from `trending_list`, `HASHTAG`, advertiser grant in the Access-Token header, and a country from each hashtag's `top_country_list`. Its response groups up to twenty videos per hashtag, exposing exact IDs, share URLs and embed URLs; engagement counts and captions are not part of this response. A composite popularity ranking is not proof of editing relevance.

Reuse the existing bounded native retrieval and source-checking/library flow; no new SDK, paid provider or account grant. Correct the old selection rule that filled a requested country's batch with tags from other countries. Missing/null provider success codes are accepted only with a real `data.list`; malformed envelopes are failures. Conflicting video IDs/share links are rejected. Hashtag-only titles are removed from caption-poor retrieval leads.

## User-facing action and boundaries

Browse's All/TikTok tabs expose **Find TikTok edits**, with English/Hijazi Arabic copy and explicit US / past-seven-days context. It makes one authenticated POST to `/categories/:id/native/tt/acquire` on deliberate click, independent of indexed-search credit availability. No request is made on navigation/mount. Pending work cancels on category/platform/config changes or unmount; stale responses cannot append to another category. Repeated clicks are disabled after a successful response in that component scope.

The Worker uses three documented hashtag charts (category, SPECIAL_EFFECTS, PHOTOGRAPHY), at most one related-video request, and at most twelve public caption reads, in batches of three. It caps each response at one MiB and the complete request at 28 seconds. Client deadline is 32 seconds and reply limit 128 KiB. Redirects are manual and rejected; the Business token never accompanies a public caption request. No Tavily/Brave/YouTube search, model call, OAuth, background job, persistent Worker write or retry occurs. Missing grants stop before any provider request. Errors never return raw provider messages, credentials or advertiser IDs.

Up to twelve canonical retrieval leads enter the existing local candidate library. Returned-count copy explicitly separates candidates from new/qualified/trending edits. Existing source checks and feed policy decide recommendations; caption-poor leads carry no fabricated evidence or counts. Empty/error outcomes preserve the existing feed. This action is a bounded supply pilot, not fulfillment of the full discovery goal or proof of native private personalization.

## Verification

Full validation passed **3,234 unit tests / 166 files**, **1,312 Worker tests**, lint, app/Worker types, build and **408 browser cases / eight intentional skips / zero failures**. The Worker-only typecheck initially rejected the browser-compatible credentials field as an excess literal property; matching the already-tested probe's request-options pattern corrected the typing without changing runtime behavior. Final log: Temp `discover-tiktok-acquire-gates-final-2026-10-11.log`. The Anime TikTok baseline was **one Inspiration result** before native acquisition; the verified rollout and outcome are recorded above.

The initial focused set passed 82 tests across client validation, UI lifecycle, Worker route/retrieval and actual workerd. Coverage includes no passive retrieval, authenticated fixed routes, unknown payload/scope/date rejection, cancellation with ignored abort, hanging grant deadline, raw-ID mismatch, valid country membership, nullable success codes, zero provider calls without a grant, 16-call ceiling, no secret forwarding, no fabricated popularity and no persistent Worker writes. Phone/desktop E2E adds empty-response retention, no indexed search calls, explicit action and Arabic copy. Full gates and the actual Chrome pilot outcome follow when verified.
