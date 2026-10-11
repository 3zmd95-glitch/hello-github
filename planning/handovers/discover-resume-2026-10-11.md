# Discover handover — 11 October 2026

Read this first. Older chronological notes are preserved in [history](discover-resume-2026-10-11-history.md); do not load that entire file unless needed. Detailed design and measured evidence live in planning/tools/24 through45.

## Objective and constraints

The goal remains **active, incomplete**: combined Instagram/TikTok/YouTube discovery for an editor's inspiration and learning, strong mainstream editing references, genuinely recent popularity and evidence of repeated effect/audio adoption. Validate in actual Chrome. A working helper or passing tests does not prove native-quality coverage.

Conserve the user's usage. No broad new audits, repeated live model calls, paid queries or complete test reruns without a new reason. Keep the app on **localhost:3000**. The Chrome helper is **already installed/pinned/tested on all three platforms**; never repeat installation or permission requests. Historic Tavily trial used4credits (~$0.032); paid search/auto-upgrade stay off. No new model or paid-search calls in this continuation.

## Source, runtime and review

- Managed source: `C:/Users/AORUS/.codex/worktrees/discover-inspiration/hello-github`, branch `codex/discover-inspiration`. This handover ships with the durable-frame-evidence commit after042bc64; use git log for the current hash.
- Primary `C:/Users/AORUS/Documents/hello-github` serves the managed build copied into its ignored out. Do not run the older primary tracked source. Existing local server **PID37380** was preserved.
- PR70: https://github.com/3zmd95-glitch/hello-github/pull/70 — open, unmerged. Do not merge without the user's request.
- Worker **f94b947** deployed successfully via **38143707034** (tests and Deploy). This continuation changes no Worker code and needs no deployment. Older f94b947 app CI runs were cancelled by the subsequent docs push; current local gates pass. Check current-head CI once if needed, not old cancelled runs.

## Verified current change

Saved frame assessments previously stopped qualifying after24hours and reentered the AI queue. Ranking now reuses the dated record while exact post/category/caption/author/source bindings match and no newer media receipt contradicts it. Original checkedAt/model/frame hashes/limitations remain. Negative records are reused too. Source changes, unavailable posts, invalid/future records and newer contradictory media still invalidate. The live-response/server-cache24hour rule remains: newly received expired responses are rejected. Source engagement freshness and publication age independently govern Popular.

**Actual Chrome:** after reload on the new build, Anime Instagram Inspiration **1→2** and combined Anime **29→30**. Recovered choppem.edits/DdFckpqzmb8 shows September10,1.6Klikes and its original **October9,23:03:21 Riyadh** frame review. Xenoz/DePNO4ABNRb shows October8,2.3Klikes and its original review. Popular Instagram contains only Xenoz; the older Choppem post stays out. Saved remains3; no preferences/imports/inference/search changed. Final tab is Anime/Instagram/Inspiration with Choppem's evidence expanded. Proof: system Temp `discover-durable-anime-2026-10-11.png`.

Offline seven-day replay of the earlier530-candidate export: seven references across Travel/Fashion/Coffee/Anime retain Inspiration eligibility that would otherwise expire; all eight reviewed records remain out of Popular with stale counts. This is a projection, not seven newly acquired/visually assessed posts. Receipt: Temp `discover-durable-visual-replay-2026-10-11.json`. Details: tools/45.

**All final gates passed:** lint, app/Worker types, **3,723 unit tests/182files**, fresh build, **428 browser passes/8intentional skips/0failures**. Phone/desktop tests advance Date by7days before reload, retain assessments and make no repeat model requests. Logs: Temp `discover-durable-gates.log`, `discover-durable-browser.log`. Isolated port3101 test server completed. Do not rerun for documentation only.

## Remaining evidence and next useful work

- Actual pre-refresh matrix:530candidates, Inspiration27/36 category/platform pairs, Popular5/36 (tools/43). Cars now additionally has one qualifying Instagram reference after the grading-tag fix; Anime now recovers its expired visual reference. Do not claim a fresh full matrix from those deltas.
- Camping relevance refresh returned20/new20/qualified0. Popularity-ordered refresh returned20/new17/qualified0. Inspiration remains2 and Popular0. More query volume/order alone has not solved supply (tools/44).
- Native Cars review retained3posts; one recovered through its explicit #colorgrading evidence. The other2still lack enough craft evidence. Do not infer excellent edits from counts or generic tags.
- A proposed category-agnostic caption grammar was replayed then discarded: it removed one existing semantic dependency but added zero current-feed references. Public research receipt: Temp `discover-edit-project-controls.json`. No quality.ts changes shipped. Do not resume caption phrase patching as a substitute for useful sources.
- TikTok's public caption read works; a bounded direct-media feasibility request returned HTTP403. No credentials, host workarounds or new adapter were used. Do not claim TikTok frame inspection is available. The existing visual inspector supports Instagram only.

Prioritize **fresh native candidate supply and actual editing quality**, then measured multi-post effect/audio adoption. Use a bounded sample from a genuinely empty category/platform pair and report returned/retained/qualified separately. Preserve strong engagement and recency gates; do not manufacture trends, overwrite Saved/preferences, equate metadata admission with whole-video quality, or claim access to private recommendation algorithms. Existing native helper review, caption interpretation and Instagram frame sampling are available; check existing evidence before spending more inference.
