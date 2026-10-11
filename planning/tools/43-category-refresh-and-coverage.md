# Category refresh and coverage — October 11, 2026

## Current measured gap

Exported the actual localhost:3000 library through Settings at 15:53:51. The 530 candidates cover all twelve categories, but only **27 of 36 category/platform pairs** have qualifying Inspiration and **5 of 36** have Popular recently. Nonempty is not equivalent to visually reviewed quality, sufficient variety or native recommendation equivalence. These are the current source/ranking policy's admissions, not an independent judgment of every video.

Each cell below is **Inspiration / Popular recently** at audit time. The audit used retained visual/semantic context and feedback, without exposing settings or credentials. Local public-only report: system Temp `discover-coverage-2026-10-11.json`; reproducible read-only script `discover-coverage-current.mts`.

| Category | Instagram | TikTok | YouTube |
| --- | --- | --- | --- |
| Cars | 0 / 0 | 1 / 0 | 2 / 2 |
| Food | 0 / 0 | 1 / 0 | 7 / 0 |
| Anime | 1 / 0 | 3 / 3 | 25 / 11 |
| Travel | 3 / 1 | 1 / 0 | 7 / 0 |
| Football | 2 / 0 | 1 / 0 | 12 / 12 |
| Coffee | 2 / 0 | 3 / 0 | 9 / 0 |
| Perfume | 0 / 0 | 3 / 0 | 6 / 0 |
| Camping | 0 / 0 | 0 / 0 | 2 / 0 |
| Fashion | 2 / 0 | 0 / 0 | 7 / 0 |
| Gaming | 0 / 0 | 1 / 0 | 4 / 0 |
| Weddings | 0 / 0 | 1 / 0 | 8 / 0 |
| Gym | 3 / 0 | 0 / 0 | 6 / 0 |

The previous cache-first entry correctly prevents repeated automatic searches, but its main Find more route can spend web-search credits and requires the owner to find a separate native TikTok control. Instagram native intake is available through the installed helper but not connected to a clear category refresh action. A populated library does not mean it has fresh supply on every platform.

## One explicit refresh workflow

Browse and category-only Search now share a refresh action, leaving cached cards visible. All runs one existing native TikTok batch and then one YouTube-only monthly expansion. Selecting TikTok or YouTube runs only that lane. Instagram opens the category's native search and explains how to review selected links through the installed helper. It does not claim automated Instagram search access. Detailed topic/skill searches retain their established behavior.

Reuse `acquireTikTokEdits` with known numeric-ID exclusions, the 200-ID horizon and native exhaustion signal. Reuse `expandCategory` with an explicit `platform: 'yt'`, one monthly query and a three-started-query per-category session limit. No Instagram/TikTok web-search fallback, paid web search or AI is triggered by this action. Existing source readers enrich returned neutral candidates and current policy decides admission. Older indexed retrieval remains explicitly available in a collapsed section, labeled with possible web-search cost.

The receipt separates returned identities, genuinely new retained posts, and returned posts newly qualifying for Inspiration or Popular. Counts update when real source evidence arrives, exclude positive preference bypasses, honor dismissals and retain valid visual/semantic context. Partial failures keep the other platform's results. A user's cancellation, category/platform/region change, inactive view, credentials change, library reset/import or pending hydration prevents late writes. A synchronous in-flight lock prevents double clicks. Advanced paid retrieval and this refresh cannot run concurrently from the same category view.

Search-before-build review: [Google's official API client](https://github.com/googleapis/google-api-nodejs-client) and [YouTube's uploads implementation guide](https://developers.google.com/youtube/v3/guides/implementation/videos) support a creator-upload route, already implemented in tools/26. Reuse the existing creator action for follow-up, and existing YouTube monthly expansion for discovery across creators; do not add a server/client SDK or parallel credential path. Existing TikTok native and Instagram helper adapters provide the other available routes. No dependencies or access permissions changed.

## Verification

Focused hook tests cover bounded sequencing, independent/partial failures, cancel/reset/config scope, no automatic work, deduplication, delayed source qualification and exhaustion. Search/Browse integration tests cover both routing and mutually exclusive refresh/indexed work. Browser coverage checks zero AI calls, exactly one native TikTok plus YouTube-only lookup, delayed source qualification, retained old cards, Instagram handoff, bilingual layout and persistence after reload.

Validation: lint, app/Worker types, **3,707 unit tests / 182 files**, and a fresh production build passed. A render-ref lint issue was corrected with immutable state-backed supply counts and immediate callback guards; all 26 hook cases passed again. Browser suite: **426 passed / eight intentional skips / two test-selector failures** in the full run. The new refresh case passed on phone and desktop. Both failures came from an older test matching the nested and outer summary; selecting the direct summary fixed it, and the phone/desktop rerun passed. Thus all **428 cases** have passing results, not one uninterrupted green full run. Logs: system Temp `discover-refresh-{lint,types,unit,browser}.log` and `discover-refresh-browser-rerun.log`.

The tested export was copied to primary out and the existing localhost:3000 server (PID37380) kept running. **Actual Chrome, Camping / All / US, around 16:14 Riyadh:** before refresh Inspiration2 (YouTube2 / TikTok0 / Instagram0), Popular0. One explicit refresh returned **20 genuinely new retained candidates; zero newly qualified Inspiration and zero Popular**. The native TikTok batch reported no more unseen posts. Final Inspiration stays2, Popular0, Explore23, Saved3. This is a verified acquisition workflow, **not a quality recovery**. The visible broader set includes old sources and low-engagement references; the old posts remain outside Popular. No live AI or paid web search was used in this continuation. Screenshot: system Temp `discover-category-refresh-2026-10-11.png`; Chrome left on the actual Camping Popular receipt.

The pre-refresh matrix remains the baseline; no category/platform pair gained qualified coverage from this batch. Next work must improve actual fresh candidate supply and evaluate concrete edits, particularly native Instagram and empty category/platform pairs. The 20/0 result argues against blindly increasing query volume or weakening quality gates. Multi-post effect/audio adoption and native-equivalent feed quality are still incomplete. No Worker changes or deployment; PR remains unmerged.
