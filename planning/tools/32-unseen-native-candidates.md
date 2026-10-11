# Unseen TikTok candidate batches — 11 October 2026

The native benchmark exposed an acquisition bottleneck independent of caption ranking: every explicit request selected the same first twelve candidates from up to ten hashtag lists. Repeating acquisition could not deliberately inspect the remaining returned posts. The category library deduplicated the same results, but the provider and caption budget were still spent on them.

Reuse the existing native Discovery contract, round-robin selector, post identity normalization, library and cancellable action. No new library/provider, permission or paid call. The official related-video contract already reviewed in [tools/28](28-native-tiktok-candidates.md) permits up to twenty videos per hashtag. Current public documentation also describes trending search *keywords*, which are not video search results; that route does not justify claiming personalized video-search support: [TikTok's keyword contract](https://business-api.tiktok.com/gateway/docs/index?doc_id=1832798345014338&language=ENGLISH).

## Behavior

- Explicit requests may include at most 200 unique public TikTok video IDs from the current category. No captions, preference labels, credentials or other platform URLs accompany the exclusions.
- The Worker validates the entire request before accessing the grant or provider. Maximum body: 8192 bytes. Known IDs are skipped before the twelve-caption budget. Each hashtag list is bounded to the documented twenty rows; identity checks and deduplication still apply.
- The same three chart calls, one related-video call and at most twelve caption calls remain. No automatic next batch, retry, paid search or AI assessment.
- Explicit traversal responses count retained IDs skipped and unseen videos left within the currently returned set. Legacy callers keep their response shape. Counts describe retrieval candidates, not useful edits or trend confidence.
- The UI offers another deliberate batch only while candidates remain; it remembers newly received IDs before library rerender and includes retained IDs after reload. Category/region/config/platform changes still cancel stale work. Existing category, engagement, recency and teaching checks decide admission.

Focused Worker tests prove 20-source traversal of 12 → 8 → 0 candidates, 16 → 12 → 4 requests, no caption calls for retained IDs, invalid input before grant/provider access, and a bounded 200-video horizon. Client/component cases check exclusion identity, malformed/duplicate responses, manual-only next actions and exhaustion. All frozen-source gates passed: **3,423 root tests / 170 files, lint, app/Worker types, build and 416 browser cases / eight intentional skips / zero failures**. Phone and desktop both prove retained-ID exclusion survives reload without passive acquisition. Logs: system Temp `discover-unseen-{lint,types,tests,build,browser}.log`.

Before deployment, actual Chrome at localhost:3000 confirmed Coffee/TikTok Inspiration three, combined Inspiration twelve (nine YouTube, three TikTok, zero Instagram). Live acquisition outcome will be recorded after the corrected backend deploys.

This widens the inspected portion of an existing native candidate set. It cannot fill a category whose charts return no matching tags, reproduce native keyword search, establish visual quality from metadata, or resolve Instagram supply and effect/audio momentum tracking.
