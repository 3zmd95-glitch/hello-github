# Discover: native Instagram, TikTok and YouTube together

The user wants the native platforms combined inside localhost:3000. Receiving some
cards from each platform is insufficient. Preserve the platforms' video results and
within-platform order, playable cards/thumbnails, and continued loading as the user
scrolls. Category searches should provide useful editor inspiration; native inclusion
alone does not establish a current trend or artistic quality.

## Ownership and starting point

Claude Training Page owns implementation after confirmed delivery. Fable5.1 plans;
one Opus5.5/Sonnet5.5 executor at a time writes. Codex owns independent code review and
actual Chrome verification. Keep model substitutions explicit. Use the managed worktree
`C:/Users/AORUS/.codex/worktrees/discover-inspiration/hello-github`, not primary checkout.
Read current-task.md and the newest two sections of codex-review.md. F7/F8 already pass;
preserve them and all dirty work. Do not repeat their unchanged tests or invent new agents
for the same review. No paid services, new permissions, push/merge/deploy or other ports.

## First implementation packet: correct dropped/reordered native cards

Two code-derived reproduction cases require RED tests before repair (not yet live findings):

1. `extensions/discover-import/native-capture.js:154-166`: previous cards `[A,C]`, then
   rendered native DOM `[A,B,C,D]`. Continuing after cursor C skips unseen B forever.
   Recover newly rendered videos before the old cursor without repeating known videos,
   breaking forward progress, or crawling outside the requested search/scroll action.
2. `extensions/discover-import/native-search.js:379-403`: insertion-ordered map merging
   reads `[A,C]` then `[A,B,C,D]` yields `[A,C,B,D]`. Preserve the native order supported
   by the current observed grid. Check the analogous resumed-cache merge in
   `lib/discoverNativeSearch.ts:109-118`. Handle overlapping windows/duplicate aliases
   without losing retained cards or resurrecting obsolete category/query responses.

Also preserve: source enrichment cannot filter/reorder Native results; explicit user
hide actions stay effective; saved references stay intact; continued scrolling has no
terminal application cap. Internal request batches and rolling memory windows may remain
bounded. Empty/slow/blocked platform reads must stay distinguishable. Perfume TikTok
returned no cards in the app on one real run although native search had videos; one retry
recovered all3. Do not misreport this as fixed or genuinely empty. Diagnose that separately
from deterministic ordering bugs before adding retries/timeouts.

Keep this packet small. Add focused capture/merge tests for the two cases, ordering after
hydration, overlapping continuation, duplicate URL aliases, and stale session rejection
as justified by changed code. Run affected checks only, freeze exact hashes and stop edits.
Do not silently change category queries to conceal missing native cards. Do not add
likes/date/caption thresholds to Native results. Do not claim a fixed comparison from mocks.

## Codex acceptance: compare the same native source tabs

After freeze and local build, Codex compares the exact helper-owned search tabs for the
same category/query/job at the same time with Discover. Independently opened searches can
rank differently; seven-day caches cannot prove a fresh match. Record for each of all12
categories and each platform: query, timestamp/source URL, native video identities/order,
app identities/order, missing/extra videos, and reason for any exclusion. Normalize video
URL aliases; exclude account/live/photo links and document explicit user-hidden videos.
Do not call DOM order visual order without checking the grid's actual layout.

For each category test an initial settled collection and one user-driven continuation,
revisiting the same native source tabs before they are replaced by another category.
The comparison can sample a bounded visible window, but must state that scope and prove
new unique videos continue beyond the first batch. It is not an exhaustive claim about
infinite platform supply. Verify playback/thumbnail behavior on representative cards from
each platform and Saved(3) preservation. Start with Perfume/TikTok and delayed hydration;
stop to fix substantive failures instead of running a long knowingly failing matrix.

## Recorded live sample — Perfume, 14 October 2026

Freeze12, query `perfume cinematic ad`, fresh search started 10:09:14 UTC. Codex used
Discover tab295819203 and this job's exact source tabs: Instagram295819206,
TikTok295819209 and YouTube295819212. Initial DOM comparison and continuation recovered
through Windows accessibility/screenshots are actual Chrome evidence, not mocked tests.

| Platform | Initial app sample | After one continuation | Native comparison scope |
| --- | --- | --- | --- |
| Instagram | 6 | 36 (+30) | Initial 6 and continued 36 match the native prefix in order; 72 native IDs exposed. |
| TikTok | 12 | 42 (+30) | Initial 12 match; the later virtualized native window of 16 matches app indices 12–27 in order. Not all 42 compared. |
| YouTube | 8 | 38 (+30) | Initial 8 and continued 38 match the native prefix in order; 53 native IDs exposed. |

The app grew from 26 to 116 unique videos. The bounded comparisons found no missing or
reordered videos within their stated scope; they do not establish exhaustive capture of
the native grids. Saved(3) remained. Representative playback succeeded inside Discover:
Instagram `Dax9KJAITdv` showed changing frames after Play; TikTok `7498009869715262742`
displayed video with Pause; YouTube `8VQ0nW7hboU` showed Pause video and 0:07/0:19.
Audio was not assessed. The native TikTok error did not recur, so Freeze12's error-path
verification remains synthetic. Native inclusion does not establish current trend quality.

Evidence: `C:/Users/AORUS/AppData/Local/Temp/discover-p17-perfume-live-parity.json`;
playback screenshots `discover-p17-instagram-playback.png`,
`discover-p17-tiktok-playback.png`, and `discover-p17-youtube-playback.png` in that folder.
Perfume passes this bounded initial/continuation sample and representative playback.
The remaining categories and overall all12x3 acceptance remain open.

## Recorded live sample — Cars, 14 October 2026

Freeze12, query `car edit`, started 10:34:40 UTC. Same-job source tabs:
Instagram295819220, TikTok295819223, YouTube295819226; Discover295819203.
Native URLs were Instagram `/explore/search/keyword/?q=car%20edit`, TikTok
`/search?q=car%20edit` and YouTube `/results?search_query=car%20edit` on their respective
sites. Timestamped full URLs and ID arrays are in the evidence file below.

| Platform | Initial visible / expanded app observations | After native continuation | Native comparison scope |
| --- | --- | --- | --- |
| Instagram | 8 / 20 | 54 | Initial 8 and continued 54 match native prefixes in order; 72 IDs exposed after continuation. |
| TikTok | 8 / 12 | 42 | Initial 8 match; later native window of 12 matches app indices 26–37 in order. Not all 42 compared. |
| YouTube | 8 / 16 | 46 | Initial 8 and continued 46 match native prefixes in order; 58 IDs exposed after continuation. |

The explicitly observed expanded app total was 48; after actual native continuation it
was 142, with all three sources received. No initial total of 52 was directly observed.
Bounded parity/continuation passes, but **Cars acceptance requires a preview repair**:
Instagram cards `Dbd5ji4uO9z` and `DbAsdTFo5KJ` still showed "Preview unavailable. Tap
to watch." after continuation while the same native search rendered video previews.
Browser DOM inspection found readyState4 video elements in each first24 Reel anchor,
with no img or video poster. The collector's image/poster-only extraction misses that
layout. This is live evidence, not a synthetic fixture or a trend-quality judgment.

Evidence: `C:/Users/AORUS/AppData/Local/Temp/discover-p17-cars-live-parity.json` and
`C:/Users/AORUS/AppData/Local/Temp/discover-p17-cars-preview-gap.png`.
The remaining 10-category matrix is paused for the bounded repair described in the latest
codex-review.md section. Prior passing code checks and Perfume evidence remain valid;
overall Discover acceptance is still open.

## Completion and coordination

Record the plan and actual selected executor. Freeze with source hashes and test commands;
emit a new unique completion marker (next unused packet ID, never reuse packet14). Codex
then reviews and runs Chrome. Passing code tests returns validation-pending until the
native comparison is complete. Return findings through shared files and the existing chat;
the user should not have to relay messages or say continue. Overall Discover is not done
while required platform parity or continuation checks fail or remain unverified.
