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
