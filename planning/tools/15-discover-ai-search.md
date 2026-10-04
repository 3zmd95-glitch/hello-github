# Discover relevance and AI content search

Owner goal (2026-10-04): audit Discover, improve specific edit-genre searches, and add a Beacons-like AI content search. All user-facing verification is on localhost:3000 with real providers. Automated fixtures are regression tests, not evidence that a live integration works.

## Research and approach

- Beacons Discover Trends: a natural-language prompt, niche suggestions, and platform-specific real posts. Observed the owner's existing Beacons UI; no credits spent there.
- Cloudflare Workers AI JSON mode supports a structured search plan through the existing Worker binding. Use its native API and existing Zod validation rather than adding an agent framework. Official docs: https://developers.cloudflare.com/workers-ai/features/json-mode/ and https://developers.cloudflare.com/workers-ai/platform/pricing/ . Bound output, cache plans, handle unavailable AI explicitly, preserve existing provider budgets. No generated video links or made-up popularity claims.
- Vercel AI SDK / Cloudflare workers-ai-provider: maintained, useful for streaming/multiple providers, but unnecessary for one bounded structured request.
- Backblaze video-semantic-search: indexes an owned video corpus; does not solve discovery of live public posts.
- Installed skill inventory and plugin search (Cloudflare Workers AI search) found no suitable app integration; retain native Worker implementation.

## Findings to address

- Genre constraints currently apply to examples only; tutorials and retries drop them.
- Dictionary tutorial queries can retain a different editing program when a program is selected.
- Relevance can accept generic editing words without evidence of the selected genre.
- Tutorial query intent can misclassify finished edits as teaching videos.
- Client and Worker answer caches need a new pipeline version when relevance changes.
- A partially failed platform previously looked fully successful. Preserve its results and expose the specific error/retry affordance.
- The old AR/EN query buttons did not change v2's bilingual queries. Show a truthful bilingual label in keyword mode; AI briefs can specify a language.
- Mobile AI form initially covered filters when sticky. Discover now scrolls naturally; prompt chips wrap and the AI input stacks on narrow screens.

## Implementation and verification so far

- Native Workers AI binding: Llama 3.3 70B structured query planning, Zod validation, 20 new plans/UTC day (KV best effort across instances), 20-second timeout, 900 output-token cap, 24-hour plan cache. Date/duration changes reuse the plan. Missing AI, malformed responses and exhausted allowance fail explicitly; no silent keyword fallback.
- Only Tavily/YouTube provide result URLs. AI provides queries and required core-concept synonym groups, checked against retrieved titles/snippets. This is text-based relevance evidence, not analysis of the video pixels.
- All 12 built-in genres have subject matching regression coverage and two bilingual specific prompt suggestions.
- PR #28 final unit suite: 1,605 passed. Full browser suite: 276 passed, 4 existing skips, then 72 focused tests and a final 16-test Discover rerun. Exact-head GitHub CI passed before merge. Mobile form verified directly at localhost:3000 with no overflow and clickable filters; Arabic RTL and English layouts checked.
- Worker dry-run bundle: 379.65 KiB gzip; AI binding recognized. PR #28 merged as d7369a3; Worker deployment 37183509425 and Pages deployment 37183509438 succeeded.

## Live verification, 2026-10-04

All requests below ran through the actual localhost:3000 UI against the deployed Worker, using its configured real providers:

| Search | Visible results (YT / TikTok / Instagram) | Observations |
| --- | --- | --- |
| AI: Find coffee match cut reels and tutorials in Arabic and English | 0 / 1 / 10 | Model interpretation rendered; 83 off-topic posts hidden. All 14 rendered image elements decoded. Repeat showed “From memory, cost nothing”. |
| AI: أبغى شروحات سبيد رامب للسيارات في دافنشي ريزولف, Cars selected | 1 / 0 / 0 | Correct interpretation and a real DaVinci car speed-ramp tutorial; 27 off-topic posts hidden. Sparse results are preferable to unrelated filler. |
| Keywords: match cut + Cars | 5 / 11 / 11 | Car match-cut examples and tutorials; 89 off-topic posts hidden. Each platform tab showed its own results. |
| Keywords: match cut, no genre | 38 / 27 / 30 | All three platforms present. Most popular and Arabic first worked; YouTube player dialog loaded the expected embed and closed back to results. |
| Coffee genre alone | 51 / 25 / 44 before follow-up | Found a genuine defect: brewing lessons and generic coffee posts were admitted because subject matching alone was enough. Follow-up below; not a passed relevance check. |

- No application console errors in the initial live AI checks. Some Instagram posts expose no usable preview; those retain the truthful watch/open fallback. No claim that every external post can embed or provide a thumbnail.
- Live usage rose from 42 to 56 of the existing 70/day YouTube search cap across these five unique searches. Tavily's displayed monthly counter is cached and is not a per-request cost measurement.

### Follow-up from the live audit

- Genre-only planning now retains bilingual filming/editing terms in queries and retries, instead of reducing “coffee edit” to a generic “coffee tutorial”.
- Genre-only results must contain both the subject and filming/editing evidence. AI mode retains these constraints even when the model returns only a subject group. Teaching words alone no longer admit brewing lessons, exercise instruction, or other subject tutorials. Exact search remains the explicit unfiltered option.
- Reuse the existing genre data and matching helpers; no extra library or provider is needed for this correction. Client/Worker answer cache version 4 avoids retaining the earlier generic results.
- Regression cases use actual coffee titles observed live and cover all 12 genre-only searches in both languages, including preservation in AI mode. Follow-up lint/typecheck/build and all 1,623 unit tests pass. Final full browser suite after the AI constraint correction: 278 passed, 4 existing skips (phone and desktop). Deployed genre-only recheck pending.

## Delivery and verification checklist

- [x] Genre/topic/program constraints survive query planning and retries; relevant bilingual synonyms, no generic fallback.
- [x] Natural-language AI search implemented with visible interpretation, real source retrieval, bounded usage, truthful failures (live inference pending below).
- [x] Genre-specific starting prompts and clear search/filter behavior.
- [x] Regression coverage: planner, matching, HTTP validation, cache keys, AI errors, stale requests.
- [x] UI audit: automated coverage of every platform, dates/durations, sorting, Arabic first, saved/attach, player/preview, empty/error/retry, genre/deep links. Mobile/RTL and the live subset above also checked directly.
- [x] All repository gates: lint, typecheck, tests, build, browser suite. Final Discover/Research/Scout/player rerun: 72 passed on phone and desktop, including partial failures.
- [ ] Live localhost:3000 checks after backend deployment; record actual queries, relevance, image loading, errors and quota limitations.

No claim of zero possible bugs. Report actual evidence and remaining limitations.
