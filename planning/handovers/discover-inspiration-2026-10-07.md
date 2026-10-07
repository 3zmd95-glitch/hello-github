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

Final checks: **2,443 app tests**, **1,044 Worker tests**, lint, typecheck and production build passed. Full phone/desktop browser suite: **380 passed, eight existing viewport-specific skips**, zero failures. Save → Saved only → My practice → note/status → reload passes in both projects. Root reviewed synthetic phone/desktop screenshots. An initial Worker performance test timed out under concurrent load; the complete suite passed with two workers without changing test limits.

The compiled worktree `out/` was copied into the primary checkout's ignored `out/`, updating the existing server on port 3000 without restarting it or changing provider connections. The new Discover header, navigation and starter topics were verified in the user's Chrome. **Primary tracked source remains at 898483f until integration**: rebuilding that old primary checkout would replace this preview. Continue from the managed worktree above or integrate the branch first.

## Rollout and remaining verification

- All local quality gates and synthetic layout/persistence checks are complete.
- Worker deployment and live Food/TikTok relevance verification still pending. Local/mock tests cannot establish current external source coverage or visual quality.
- After Worker rollout, a read should filter old top lists immediately and hide legacy category trend claims until evidence is refreshed. A deliberate category Scan again regenerates lessons/current trend evidence within existing daily and monthly limits. Do not silently raise caps or buy credits. Live app showed **832/1000** Tavily lookups and **25/66** YouTube searches today during this check; recheck before further live runs.
- CLI `gh` is not logged in. The connected GitHub connector works. Git remote is `https://github.com/3zmd95-glitch/hello-github.git`; use the existing Git credential manager if pushing, or the connector. Never extract credentials.
- The local AI server stores provider connections under the existing user runtime directory. Do not read/copy its auth files or the browser's Scout token. Use ordinary app requests to test connected services.

Metadata can establish relevance, not whether a clip is visually excellent. TikTok caption availability and search-index coverage can still limit results; an honest empty state is preferable to unrelated filler. The new UI does not claim to have watched or reverse-engineered every video.
