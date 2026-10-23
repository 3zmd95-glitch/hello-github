# Keep unchanged caption understanding — October 11, 2026

## Problem and decision

The caption fallback introduced in tools/37 expired every persisted judgment after 24 hours. That conflated the meaning of an exact source caption with changing engagement statistics. A recovered reference could disappear the following day even after a source refresh returned identical text, and the same caption became eligible for another model request. Negative judgments expired too.

Reuse the existing exact-source applicability helper, durable candidate library and bounded server cache. No new dependency or provider is appropriate for this small validity correction; the storage/cache alternatives and adopted libraries are already recorded in tools/24. Read the installed Next `use-client` guide before changing browser-facing behavior.

A saved caption judgment remains applicable while its canonical post, platform/provenance, author, exact caption, category and supported rubric version match. Both positive and negative results persist. Original assessment/source timestamps remain unchanged. The source must still have been observed less than 24 hours before the original assessment, and invalid/future timestamps remain rejected. Changed text, changed authorship/source identity, unavailable posts and incompatible rubric versions invalidate the judgment.

The server's account-scoped 128-entry memory cache retains its existing 24-hour bound. Durable client records prevent unnecessary repeated requests across later visits; this does not promise a server cache hit after a restart or clearing the local library. Choosing another model can still request a new judgment explicitly. Engagement freshness, publication age, popularity thresholds, teaching admission and source checks are unchanged. Caption understanding never establishes watched footage or a trend.

## Cross-category diagnostic

Read only public candidate fields from the existing October 11 backup; no keys/settings were printed or copied. Its saved candidates already had direct source evidence in all 12 genres (one Anime Instagram candidate was still indexed). Sparse feeds are therefore not generally caused by an unfinished source-check queue. Examples in that earlier backup: Gym TikTok had 13 candidates / 9 with strong engagement / zero qualified inspiration; Travel TikTok 8 / 8 / zero; Camping TikTok 4 / 3 / zero. These counts predate later native imports and the caption pilot and are not the current UI totals. They do not establish whether each video has strong visible editing.

Two further static review leads are deferred, not confirmed live failures: literal metadata may accept future/question/third-party edit descriptions without a completed-project claim; and the semantic Football definition should explicitly distinguish association football. These need minimal reproductions before changing admission or making another live model call.

## Verification

Focused contracts cover unchanged 48-hour/seven-day assessments, refreshed counts, changed captions, invalid timelines, retained negative judgments, stale-count exclusion from Popular and mixed For You retention. The hook regression advances seven days, refreshes the source and explicitly attempts another batch: the model client remains at one original call; only changed text re-enters the queue.

The browser regression uses synthetic, clearly labeled assessments from seven days earlier. It checks source refresh, one admitted reference versus one uncertain result, disabled reassessment, Popular/Learn separation and persistence after reload on both phone and desktop. It does not claim a new live model quality evaluation.

Final gates: lint, app/Worker types, production build, **3,545 unit tests / 177 files**, **424 browser cases / eight intentional skips / zero failures**. The full browser run included a fresh production build, and its export was copied to localhost:3000.

Actual Chrome retained Travel All9 / TT1 / IG0 / YT8 and Saved3. Choosing the previously used model/effort showed the next unresolved sources and skipped all three already-assessed captions. New York retained the original 14:04:39 checked time. No model action was clicked; live calls and paid searches for this correction were both zero. The screenshot and operational details are in the current handover. The broader native-quality discovery objective remains unfinished.
