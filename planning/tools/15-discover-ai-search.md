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
- Full unit suite: 1,601 passed. Full browser suite: 276 passed, 4 existing skips. Mobile form fix verified directly at localhost:3000 with no overflow and clickable filters. Lint/typecheck/build pass; final targeted rerun follows partial-failure changes.
- Worker dry-run bundle: 379.65 KiB gzip; AI binding recognized. Actual model inference and provider relevance still require the deployed backend and live verification before calling the feature complete.

## Delivery and verification checklist

- [x] Genre/topic/program constraints survive query planning and retries; relevant bilingual synonyms, no generic fallback.
- [x] Natural-language AI search implemented with visible interpretation, real source retrieval, bounded usage, truthful failures (live inference pending below).
- [x] Genre-specific starting prompts and clear search/filter behavior.
- [x] Regression coverage: planner, matching, HTTP validation, cache keys, AI errors, stale requests.
- [ ] UI audit: every platform, dates/durations, sorting, Arabic first, saved/attach, player/preview, empty/error/retry, genre/deep links, mobile/RTL.
- [x] All repository gates: lint, typecheck, tests, build, browser suite. Final Discover/Research/Scout/player rerun: 72 passed on phone and desktop, including partial failures.
- [ ] Live localhost:3000 checks after backend deployment; record actual queries, relevance, image loading, errors and quota limitations.

No claim of zero possible bugs. Report actual evidence and remaining limitations.
