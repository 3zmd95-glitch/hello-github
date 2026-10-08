# Discover inspiration rework — 7 October 2026

## Request and working copy

The owner asked Codex to improve Discover for inspiration and learning, even if a large rework was needed, and authorized reading their Instagram/TikTok. This work starts from main `898483f` in managed worktree `C:\Users\AORUS\.codex\worktrees\discover-inspiration\hello-github`, branch `codex/discover-inspiration`. The existing primary checkout and its untracked Claude/other-agent folders were preserved.

The user-facing app must remain at **http://localhost:3000/discover/**. Automated tests use port 3100. Do not confuse mocked browser fixtures with live provider results.

## Implemented

- Subject + creative metadata gate for every category's top recommendations, including cached lists. Canonical deduplication and creator diversity. No filling to 50 with irrelevant videos.
- Four Instagram + two TikTok focused searches within the same six-credit scan allowance. Bounded, cached official public TikTok oEmbed caption enrichment, never forwarding Business credentials.
- TikTok connection status distinguished from an empty set of qualifying edits.
- Versioned migration of generated category trend evidence on the next successful normal scan. No automatic extra scans or budget increases.
- Lesson version 5: actual category/technique examples required; whole-phrase matching; curated bilingual observation/practice prompts. Removed the three AI-generated settings calls. Old unsupported lessons are hidden until refreshed; valid partial refreshes may show individual new lessons.
- Videos and save actions before lesson text. “Watch & try” opens one lesson at a time. Copy distinguishes metadata matches and suggested exercises from analysis of watched footage.
- My practice library: save independently of skills, personal notes, To try / Practising / Tried it, reversible removal. Part of existing validated state/export/import, preserving old backups and skill references. Saved only includes new library saves.
- Starter topics reflect iPhone filmmaking, match cuts, color and product films. No private saved collections were imported, and no social account was modified.

## Evidence and checks

Live baseline: Food's Timelapse Kitchen Prep lesson showed food processors and prep tables; generic trial-reel/food posts occupied recommendations. Exact examples are covered by relevance regressions. Source research and design decisions: `planning/tools/20-discover-inspiration.md`.

Initial checks: **2,443 tests in the root suite**, which includes Worker tests; a separate **1,044-test Worker run** also passed and overlaps that total. Lint, typecheck and production build passed. Full phone/desktop browser suite: **380 passed, eight existing viewport-specific skips**, zero failures. Save → Saved only → My practice → note/status → reload passes in both projects. Root reviewed synthetic phone/desktop screenshots. An initial Worker performance test timed out under concurrent load; the complete suite passed with two workers without changing test limits.

The compiled worktree `out/` was copied into the primary checkout's ignored `out/`, updating the existing server on port 3000 without restarting it or changing provider connections. The new Discover header, navigation and starter topics were verified in the user's Chrome. **Primary tracked source remains at 898483f until integration**: rebuilding that old primary checkout would replace this preview. Continue from the managed worktree above or integrate the branch first.

## Rollout and remaining verification

- All local quality gates and synthetic layout/persistence checks are complete.
- Worker deployment and live Food/TikTok relevance verification still pending. Local/mock tests cannot establish current external source coverage or visual quality.
- After Worker rollout, a read should filter old top lists immediately and hide legacy category trend claims until evidence is refreshed. A deliberate category Scan again regenerates lessons/current trend evidence within existing daily and monthly limits. Do not silently raise caps or buy credits. Live app showed **832/1000** Tavily lookups and **25/66** YouTube searches today during this check; recheck before further live runs.
- CLI `gh` is not logged in. The connected GitHub connector works. Git remote is `https://github.com/3zmd95-glitch/hello-github.git`; use the existing Git credential manager if pushing, or the connector. Never extract credentials.
- The local AI server stores provider connections under the existing user runtime directory. Do not read/copy its auth files or the browser's Scout token. Use ordinary app requests to test connected services.

Metadata can establish relevance, not whether a clip is visually excellent. TikTok caption availability and search-index coverage can still limit results; an honest empty state is preferable to unrelated filler. The new UI does not claim to have watched or reverse-engineered every video.

## Follow-up: all-genre and trend audit

The owner then requested tests of all genres, editing-skill searches and whether the effects were really trending now. `planning/tools/21-discover-quality-audit.md` records the live evidence and full 12-genre table.

- Stored category shelves: only Cars and Food populated; Anime/Travel had no study-video lists; eight categories never scanned. First 12 cards of five populated platform lists inspected (60 metadata cards). Three Instagram sources inspected with partial playback, not full-video reviews.
- The separate regular category-search path returned results on all three platforms for every one of the 12 genres. Camping/desert was weakest. Match cut, speed ramp and masking-transition searches also returned relevant examples and lessons, with some noisy captions.
- Genre buttons now use that regular search directly. Cached Study guides are explicit secondary access. No automatic category rescan was added. Changing genres clears a previous exact-search override.
- Category craft filtering also applies to normal/AI searches for known categories. Added specific techniques and observed prompt, shopping, time-travel and gameplay-build exclusions. Explicit exact/custom/connector semantics are preserved.
- Effects are now presented as techniques to explore, not proven platform trends. Unknown-account post URLs no longer inflate creator counts. Legacy counts, NEW badges and YouTube sample-growth arrows are hidden. New evidence has safe dated supporting links; synonym merging keeps the newest links.
- The former Popular now section is labeled Most viewed / liked with a cumulative-metric explanation. An old high-view tutorial is useful but is not evidence of current popularity.
- A response quality marker accompanies the cache version migration so results from the old Worker cannot poison the new browser cache during staged rollout.

At audit end, the UI displayed 832/1000 monthly lookups and 55/66 YouTube searches. The unchanged monthly display is an observation, not independent confirmation of zero provider cost. No budgets or paid allowances were increased. New backend behavior still needs authorized deployment and a live follow-up; do not claim it was already verified in production.

## Final follow-up validation

After reloading the final frontend, the live usage display updated to **861/1000 monthly lookups and 55/66 YouTube searches**. Use these later values rather than the earlier stale monthly counter, and recheck before further searches. No category rescans were run.

Final code passed **2,528 tests across 124 files** in `pnpm test --maxWorkers=2` (including Worker coverage), **380 phone/desktop browser tests with eight existing viewport-specific skips**, lint, typecheck, production build, formatting and `git diff --check`. Synthetic category-search, study-guide and practice-library screenshots were reviewed; these establish UI behavior, not live video quality.

The final compiled frontend was copied to the existing port-3000 server. A live Coffee button click returned the ordinary three-platform search (3 Instagram / 9 TikTok / 30 YouTube), and the new evidence labels and explicit Study guides action were verified. The live backend still runs the old implementation. PR #70 remains unmerged, so source-quality improvements in the Worker require deployment and a fresh live evaluation. No merge or deployment approval was inferred from the audit request.

## Follow-up: specific audio and visual edit formats

The owner's Reel https://www.instagram.com/reel/DdP6LgrT_aD/ exposed a different requirement: identify a repeated **song + visual recipe**, not simply name an evergreen technique. `planning/tools/22-edit-formats.md` records direct source checks, architecture, live failures and remaining limits.

- Added a separate format contract and panel, with an explicitly reviewed TRIP BABY / repeating-figures reference, audio-page link, source provenance, dates, previews, Follow, Find more like this and Learn this edit. Following is a persisted local watch list, included in export/import, not personal-feed monitoring or notifications.
- Automatic extraction preserves indexed text before the generic scanner discards song identity. Supporting source IDs, quoted spans, known dates and distinct identified accounts are required; fabricated sources and unsupported pattern/audio pairings are rejected. Two existing query slots are allocated to open format discovery and a rotating previous-format query. Existing search budgets are unchanged.
- Legacy Worker responses can still show reviewed and followed references. Scan failures preserve the last actual check date. A future backend deployment is required before automatic format extraction operates in the shared Worker; there was no deployment in this turn.
- Format searches use a short quoted track + specific visual phrase. The selected format is retained while filtering results and platform counts; ordinary searches clear this context. Album news, unrelated visual recipes, generic lessons and voice-cloning-only results are rejected. Search leads are still **unverified indexed text**, not a claim that source captions, audio or footage have been checked.
- Live testing of the original long query returned 16 TikTok results dominated by album/news noise. The shorter tutorial query reduced this to one Instagram lead, but direct inspection showed its search excerpt could not be trusted: the July 4 cj.filmed.it tutorial uses Original audio and its actual caption does not identify TRIP BABY. Partial playback showed masking in DaVinci, without establishing this exact visual format. Do not report this as successful exact-format discovery.
- Instagram's audio page displayed 9.6K Reels; this is cumulative audio use across all styles, not matching-edit count or current growth. A September 25 car edit showed stacked cutout cars using the audio, which is useful corroborating context but not identical repeated-person evidence or last-seven-day growth.

### What is still needed

1. Integrate PR #70 and deploy the Worker only after the owner's pending rollout decision. The primary tracked source is still old; continue in the managed worktree and preserve the running port-3000 local AI server/provider connections.
2. Verify supported Meta Audio API access and authentic post/audio metadata through the app's normal authorization. The researched `/ig_audio` implementation provides audio discovery metadata, not proof of a shared visual recipe. Do not extract browser tokens or assume TikTok Display API exposes For You.
3. Add and evaluate an actual audiovisual verification path with accessible media, so captionless effects and contaminated search excerpts can be distinguished. This is the key unfinished part of the owner's goal. Do not claim a caption-based candidate detector can reliably recognize what repeats in their personal feed.
4. After deployment, evaluate automatic format discovery against source-checked positives and near-misses across genres; distinguish source coverage, metadata candidates and visually verified matches. Keep older useful tutorials separate from evidence of current adoption.

Final checks: **2,575 tests in 128 files passed; 382 browser tests passed with eight existing viewport-specific skips**. Lint, typecheck, production build, formatting and diff checks passed. The final copy-only clarification passed 78 component/message tests and, after another build, all 34 Discover browser tests. The English/Arabic phone and desktop format flow covers exact queries, relevant/noisy results, empty states, normal-search reset and saved following.

The final frontend build was copied into primary `out/` and verified on **localhost:3000** without restarting its server. The Instagram reference thumbnail loads; Following (1) survives reload and remains saved. Recent examples returned zero supported matches. The live usage display was **861/1000 monthly lookups, 58/66 YouTube searches**; recheck before future calls because the monthly counter may be stale. No effects/category rescans or budget increases occurred. A live screenshot is at `C:\Users\AORUS\AppData\Local\Temp\discover-formats-live-2026-10-07.jpg`. PR #70 remains open and the shared Worker unchanged.

## Latest continuation: public source and actual frame checks — 8 October 2026

This section supersedes earlier runtime and verification status above. Work remains in the same managed worktree and PR #70. **Do not merge or deploy based on the earlier unanswered rollout question.** The owner's latest instruction was to continue implementation/testing.

### What now works locally

- The Reel inspector checks the actual public caption and displayed audio, with explicit match/unknown/mismatch outcomes. Original audio means unknown; source labels are not waveform analysis. This free source read uses neither Tavily nor inference.
- Optional ChatGPT inspection uses the selected account/model/effort and either eight timestamped video frames or an explicitly selected preview image. Accessible clips are bounded to 90 seconds and 12 MiB. FFmpeg/ffprobe are already installed; no new dependency or service was added. The implementation parses inert public embed data, checks exact post identity and allowed hosts, bounds downloads/decoding, and removes owned temporary media. No browser cookies, tokens or private endpoint are used.
- Selected-format searches automatically check up to six Instagram leads. Actual captions replace contaminated excerpts; displayed audio is assessed separately. Unsupported leads appear in a separate related-lessons list, and source audio cannot substitute for visual evidence. The Worker has equivalent bounded source enrichment, pending deployment.
- English/Arabic UI distinguishes sampled composition from full motion, audio synchronization and popularity. Claude image transport is explicitly unavailable; there is no provider/model downgrade or implicit preview fallback.

### Tested, with actual outcomes

**2,675 unit tests in 134 files; 384 browser tests passed, eight existing skips.** Lint, typecheck, production build, formatting and diff checks passed. The final browser suite used a frozen build to avoid output-file contention.

Two real frame inference checks completed through the app using **GPT-6-Astra / max** (highest effort this connection exposes):

1. Owner's `DdP6LgrT_aD`: eight frames across 16.019 seconds. Source audio agrees; Astra identified repeated figures at 9.011s and 15.769s and returned visual support. A human-readable contact sheet was independently reviewed by root.
2. Earlier false lead `DaX6-f9ox7D`: eight frames across 61.437 seconds. Cutout/transform teaching clues were visible, but the format was **uncertain**, not confirmed, and Original audio stayed unknown. Do not relabel it a proven mismatch.

The car variation `DdtwTB7sr5g` had copyright-blocked public media; no bypass was attempted. The live tutorial search returned **zero supported indexed matches**, so no claim of successful automatic format discovery is justified. Current visible usage: **914/1000 monthly lookups, 1/66 YouTube searches today**. Recheck before spending more; do not raise caps.

Local evidence: `C:\Users\AORUS\AppData\Local\Temp\3z-format-evidence-FJwlyD` contains contact sheets and timestamp/hash metadata. Positive UI proof: `C:\Users\AORUS\AppData\Local\Temp\discover-frame-check-live-2026-10-08.png`; negative UI proof: `C:\Users\AORUS\AppData\Local\Temp\discover-frame-negative-2026-10-08.png`. Full media/individual JPEGs were cleaned up by the decoder.

### Running app and restart instructions

**localhost:3000 is the only user-facing preview.** Old Node PID 40336 was replaced by **PID 3800**, running worktree `scripts/local-ai/main.ts` with its TSX loader. Its working directory is the primary checkout, so it serves the final build copied into primary ignored `out/`. Existing ChatGPT authorization was verified in the UI after restart; credentials were not read or copied.

Logs: `C:\Users\AORUS\AppData\Local\Temp\discover-local-2026-10-08.out.log` and `.err.log`. The primary tracked source remains old main `898483f`. Rebuilding from primary would overwrite the updated preview. To restart later, verify the listener's process identity before stopping it and run **`pnpm local:serve` from the managed worktree**, whose `out/` also contains the final build. Use the existing runtime auth directory through normal app behavior; never inspect its auth files. The temporary port-3100 test server was stopped.

The frozen browser-test build remains at `C:\Users\AORUS\AppData\Local\Temp\discover-e2e-f559d3b69bed46ebab2976e3067d03ef`: automatic approval review blocked its cleanup without a specific reason. It is disposable generated output and contains no copied auth files.

### Remaining work, in order

1. Review/integrate PR #70 and deploy the Worker after the pending owner rollout decision; then test the new automatic source enrichment against live scans. Current shared backend still lacks these changes.
2. Improve retrieval of actual matching recent edits, including captionless examples. Passing a pasted reference check does not establish automatic discovery quality. Evaluate positives and near-misses across genres; the earlier 12-genre search audit is not a visual review of every returned video.
3. Verify supported Meta audio catalogue access through normal authorization, and obtain dated repeated-use evidence before claiming a format is trending now. Cumulative audio use alone does not measure a visual recipe or recent growth.
4. Add temporal/audio analysis only with a supported transport and a measured evaluation. Current sampled frames do not verify beat synchronization or all motion; Claude vision, automatic personal-feed monitoring and trend notifications are not implemented.

Implementation decisions, boundaries and sources: `planning/tools/22-edit-formats.md`. Continue from this section rather than redoing the previous source investigation or running another full test suite without a code change.
