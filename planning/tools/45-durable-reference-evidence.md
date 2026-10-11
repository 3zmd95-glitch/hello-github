# Durable reference evidence — October 11, 2026

## Measured problem

The feed's saved caption judgments already persist while their exact source identity matches, but sampled-frame judgments were discarded by ranking after 24 hours. The visual queue then selected those same posts for another model call. This confused a dated observation about sampled pixels with current engagement and freshness, undermining both durable discovery and the owner's request to conserve usage.

An offline seven-day projection on the previously exported 530-candidate library found eight saved visual assessments. Under the former expiration rule, seven references across Travel, Fashion, Coffee and Anime lost Inspiration eligibility; the eighth remained eligible from other evidence. Reusing the dated visual records preserves all seven, while **all eight remain outside Popular with stale counts**. This is an offline retention projection, not seven newly acquired results or new footage inspections. Public-only receipt: system Temp `discover-durable-visual-replay-2026-10-11.json`.

## Decision and reuse

Reuse the existing source-bound persistence model in `lib/discoverSemantic.ts` and visual invalidation checks. A saved judgment retains its original checkedAt, source snapshot, sampled-frame hashes, model and limitations. Elapsed time alone no longer invalidates it. Changed captions/authors/post/category identities, unavailable sources, invalid/future evidence and newer conflicting media receipts still invalidate it. Both positive and negative judgments follow this rule. No current-pixel, audio, whole-video or unchanged-media guarantee is invented; the interface displays the original assessment time. Popular still requires independently fresh native engagement and a recent publication date.

The server's 24-hour response-cache lifetime and admission of newly received live responses remain unchanged. The store explicitly rejects expired incoming assessments, separately from reusing already stored judgments. The current-rubric/model queue reuses applicable stored assessments rather than requesting the same unchanged references after a day. New requests, model choices and newly observed source/media changes keep their existing behavior. No new package, service, permissions or background work.

## Native supply feasibility check

Before building another media adapter, inspected the existing TikTok source reader and the maintained [yt-dlp TikTok extractor](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/tiktok.py). TikTok's [official embed player](https://developers.tiktok.com/docs/en/embed-player) remains the native playback route. One public source read for alvarovaliente_/7672800453221944589 returned its native metadata and a 30-second media address. The direct public media request returned HTTP403 without cookies. No alternate hosts, browser credentials, access workarounds, media download or model call followed. Do not implement or advertise a verified TikTok frame adapter from this failed probe. Native supply and multi-post trend measurement remain separate unfinished work.

## Verification

Focused unit coverage advances dates, preserves original records, prevents repeat assessment of the same posts, and retains source/media invalidation. Ranking tests independently reject stale counts and old publication dates from Popular. The existing phone/desktop visual browser flow advances its clock by seven days before reloading the durable library and asserts two retained references with the original two model requests only.

All final gates passed: lint, app/Worker types, **3,723 tests /182files**, fresh production build, **428 browser passes /8intentional skips /0failures**. The initial full unit run exposed the incoming-live-response boundary; its freshness check is now explicit, and the subsequent complete run passed. The capacity-retention expectation now preserves useful stored visual references after a day. Logs: system Temp `discover-durable-gates.log` and `discover-durable-browser.log`.

The tested export is served at localhost:3000; PID37380 and connections are preserved, with no Worker deployment. Actual Chrome on the prior build showed Anime Instagram Inspiration1. Reloading the new build shows **2**, with combined Anime29→30. The recovered Choppem reference (DdFckpqzmb8) shows September10,1.6Klikes and the original October9,23:03:21 Riyadh assessment. The Xenoz reference retains its original review too. Instagram Popular contains only Xenoz's October8 post with2.3Klikes; the older Choppem post remains out. Saved stays3, with no preference changes, imports, searches or live inference. Proof: system Temp `discover-durable-anime-2026-10-11.png`.

This recovers previously reviewed inspiration and prevents needless repeated assessment. It does not establish new trend supply, complete audiovisual review or native-algorithm equivalence. The wider discovery goal remains incomplete.
