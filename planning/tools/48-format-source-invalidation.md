# Invalidate saved format evidence when its source becomes unavailable

The format inspector previously showed a failure after an AI check discovered unavailable public metadata, but kept restoring the previous positive from local storage. That contradicted the newest source receipt and kept the old match in the local counts. The separate caption/audio check already invalidated this evidence correctly.

Reuse the existing category visual endpoint's unavailable-source response pattern and the existing format observation replacement rules. No new library, source adapter, background task or inference path is needed. The installed Next client and Playwright guides were read. The server now returns its actual unavailable receipt with the existing error response. The client accepts it only when its schema, unavailable status and canonical post identity match. The inspector records that receipt; temporary media/model failures without source evidence retain the previous observation. No guessed source dates or synthetic unavailable receipts are created.

Focused component/client/server tests cover removal of old visual and audio counts, persistence, receipt validation and preserving evidence after transient failures. The existing phone/desktop source-check scenario additionally tests positive evidence, failed media extraction, unavailable source and reload in that sequence. These synthetic failures test state transitions; they are not evidence about a real post's availability.

## Bounded live cohort, October 11

The existing native TRIP BABY queue has four selected posts. Opening it reused the saved captions/audio without new searches. One explicit gpt-6-astra/max frame assessment of sauravx.21/DdRPhe4vc9s saved at18:09:02Riyadh found layered paddlers, mountains and boats in eight samples from0.0–14.1seconds. Native Instagram separately displayed September14 and403likes. The sampled images support this visual format, not full motion, beat timing or current popularity.

The same-audio ysnmusic.00/DeU6BHAuDSo counterexample displayed a music-taste meme on native Instagram, posted19hours earlier with about2Klikes. Its explicit frame attempt failed during media extraction; no visual verdict was saved. Do not call that an AI-confirmed mismatch, reclassify it from the audio alone, or retry the same media attempt without new evidence. The app retains its previous caption/audio observation.

Measured local totals: **3 audio matches,1 sampled-frame match,0 recent creators**. The positive is old, and the recent post is not a verified visual match. This cohort does not establish a current or growing multi-creator trend. There were no paid searches; two frame attempts produced one saved AI assessment and one unavailable-media outcome. Independent recent visual matches and repeated adoption remain unproven.

## Final verification and rollout

Lint, app/Worker type checks,3,747unit tests/184files, production build and the complete browser suite passed (430passes,8intentional skips,0failures). The first custom test-server attempt served directory listings and was abandoned; the successful final run used the repository's standard startup. No application defect was inferred from that infrastructure failure. Logs: Temp `discover-format-invalidation-gates.log` and `discover-format-invalidation-browser-fixed.log`.

Copied the managed export to primaryout with identical discover/index SHA256 C555A9A357CBB1628D7DD876BE2BF1BD37AAEB11F71C4AA48FC8F577EF77F6DB. Restarted the local server from managed source on localhost3000 (PID26016, command session12900); no Worker changes. Actual Chrome reload retained the same18:09:02assessment, allfourqueue entries,3/1/0counts and Saved3, without another model check. Proof/receipt: Temp `discover-format-cohort-2026-10-11.png` and matching.json.
