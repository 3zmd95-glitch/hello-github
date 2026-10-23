# Reusable format checks — October 11, 2026

## Native evidence and the missing path

The owner wants emerging visual edits with their audio, not a list of techniques or popular sounds. Native Chrome on October 11 showed the supplied jayp.zip Reel (`DdP6LgrT_aD`) at about 29K likes and 1,237 reposts. Its linked audio page (`1233965565529898`) displayed 9.8K Reels, compared with the rounded 9.6K noted on October 7. These are cumulative audio uses; the difference is not a count or growth rate for the repeated-figure edit.

The same audio page surfaced `DeU6BHAuDSo` by ysnmusic.00, with 18.1K grid views, 1,918 likes and a displayed age of 15 hours. Its caption was an emoji and the inspected frame showed a portrait with “My music taste.” There is no supported repeated-figure match from this observation. This is a concrete reason not to turn every same-audio result into a matching format. No whole-video review was claimed.

The existing Reel inspector can read source audio and, through an explicit separate AI action, sample video frames. However, its result previously existed only in component state. Reloading or resetting the panel lost it; following a format retained only the scan/reference snapshot. Native imports reach category candidates, not the Worker's indexed format scanner. The next improvement is to retain actual local checks with their provenance, without treating them as indexed scan results or platform-wide adoption.

## Reuse and scope

Reviewed the existing strict `FormatVerificationTargetSchema`, `InstagramSourceSchema`, response validation, follow/export/import storage and category observation helpers. Primary references: [Zustand persistence](https://zustand.docs.pmnd.rs/reference/middlewares/persist) supports selecting persisted fields and schema migration; the already-installed [idb-keyval](https://github.com/jakearchibald/idb-keyval) supports a larger separate asynchronous store when needed. Reuse the existing validated Zustand save/export path for a small bounded set of 48 checks, capped at 400KB. No dependency or new background source collector is needed.

Store exact target snapshots, canonical post identity, local check time, original source observation time, displayed audio and optional validated frame/thumbnail assessment with model provenance. Exclude account IDs and unknown response fields. Source and target changes invalidate borrowed verdicts. New unavailable checks supersede earlier positives. Import/reset fences prevent late results from restoring erased data. Historical checks remain available without claiming fresh evidence.

The format card and inspector distinguish checked posts, displayed-audio matches, sampled-frame matches and recent independent creators. The last count requires a post published within seven days, evidence checked within three days, an identified creator, matching sampled frames and the required audio. Thumbnail-only/source-only checks do not establish a matching visual format. Counts remain local observations with an explicit motion/timing and trend-growth limitation. No scan, AI request or search starts merely by opening, switching or restoring this panel.

## Validation

Pure/store tests cover identity and source binding, deduplication, changed targets, negative/unavailable replacements, unknown audio, stale/future evidence, unique creators, bounds and backup/reset behavior. Phone/desktop regression restores a saved source-and-frame check after reload without another model request, while an older post contributes no recent creator. Final gates pass: lint, app/Worker types, 3,668 unit tests /181 files, production build and 426 browser cases /eight intentional skips /zero failures.

Actual Chrome explicitly read the supplied jayp.zip Reel's public caption and A$AP Rocky audio once. After reload, the inspector restored the exact result and original check time, displayed “No new check was run” and counted audio1 /sampled frames0 /recent creators0. Saved inspirations remained3. Evidence: system Temp `discover-format-saved-2026-10-11.png`. Zero live model calls and zero paid searches; no Worker changes or deployment.
