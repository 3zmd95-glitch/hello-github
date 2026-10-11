# Bounded public-caption semantics — October 11, 2026

## Problem and scope

The native Travel benchmark in tools/36 found authentic high-engagement TikTok posts whose source captions describe a location or filmed journey without a literal Travel keyword. A category selected during intake cannot supply the missing evidence. The new optional caption assessment asks the already-connected ChatGPT provider to interpret the authentic source text, with category fit and a completed creative project judged separately.

This assessment is text only. It does not establish visible editing, camera technique, authorship, audio, recency or trends. It supplies no counts or dates to the model. Existing engagement, exclusions, teaching and recency gates remain independent. A source-caption claim of a creative project is distinct from a frame assessment.

## Search before building

Read the installed Next 16.3.6 route-handler guide at `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` before implementation. The application already uses a static export plus a loopback Node server, so this work extends the established `scripts/local-ai/server.ts` boundary instead of introducing a Next route or a second provider integration.

Searched existing source readers, visual assessment schemas, provider status/consent checks, active request cancellation and tests first. Reused `sourceFor`, extracted the existing TikTok cache/read code as `tiktokSourceFor`, and reused the existing `provider.plan` adapter and Zod dependency. No new package, paid search or credential handling was added.

Consulted the [official OpenAI Structured Outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs). The existing ChatGPT adapter already sends strict JSON-schema output. The new route supplies a bounded schema and also validates the returned JSON locally: structural conformance does not establish factual correctness or source support. No SDK migration or API-key path was needed.

## Contract and bounds

`POST /api/local-ai/assess-caption` takes the flat existing selection shape (`provider: chatgpt`, model, optional effort/accountId), a known genre ID, one to three distinct canonical TikTok/Instagram post URLs, optional `en`/`ar` output language and optional `allowModel: false` for cache-only retrieval. Caption/author input from the client is rejected.

The server reads native source captions using the same bounded public readers as the source checks. Available sources are assessed together in at most one model call; unavailable individual sources are omitted. An empty available set returns `source_unavailable` with zero calls. No frame decoder, image input or model search tool is used.

Each semantic record has version 1, canonical URL, genre, checked time, selected model/effort, exact caption/author/provenance/observed time and a bounded assessment. Category is supported/uncertain/mismatch; project is described/uncertain/none. Supported/described judgments require nonempty literal caption spans; every supplied quote is checked against the exact caption. The entire batch must return exactly the requested indices with no duplicate, missing or extra assessment. Malformed JSON, unexpected claims/fields, fabricated quotes or wrong-model output reject the batch before any new cache entry is written.

Source text is treated as untrusted data in the prompt. Category context is never evidence. The rubric distinguishes a completed creative production from ordinary trips, location news, shopping offers, flight simulators, equipment/hashtags alone, plans and ambiguous adjectives. Production instructions use general descriptions rather than copying the three benchmark captions into the prompt.

The response is either `assessed` with selection, one to three semantic records, `modelCalls: 0 | 1` and `cached`, or `unavailable` with selection, bounded error code and call count. Selection/model/effort, unique URLs, same-category batch and cache/call consistency are validated.

There are at most 128 in-memory semantic records, keyed by source caption/author/provenance/URL, genre, output language, selection/account and rubric version. Expiration is at most 24 hours from both source observation and assessment; cache hits preserve original timestamps. Refreshed source text invalidates a cached judgment. Disconnect clears the cache. Existing same-origin checks, sharing consent, model/effort/account checks, active-provider lock, timeout, browser disconnect cancellation and response-close cleanup apply; selection is rechecked after source reading and before returning/caching results.

The browser applicability helper requires the current version, category, canonical post/platform, matching provenance, exact native caption/author, fresh source/assessment and no unavailable source. It ignores a newer observation timestamp for identical text. It does not import the feed/store, avoiding a dependency cycle.

## Verification

Focused contract and HTTP tests plus the existing local-server regressions passed: **66 tests across 3 files** (`lib/discoverSemantic.test.ts`, `scripts/local-ai/server.semantic.test.ts`, `scripts/local-ai/server.test.ts`). Cases cover TT/IG batching, canonical URL boundaries, fabricated/missing quotes, source edits, stale/future records, cache-only budgets, partial/unavailable sources, account/sharing changes, atomic rejection of malformed batches, timeout, concurrent requests, browser cancellation and disconnect invalidation.

Those are mocked contract tests, not evidence that a live model classified the benchmark correctly. The separate authorized browser benchmark follows.

## Actual Chrome benchmark

On localhost:3000, Search → Travel → TikTok → Understand captions, selected the connected `gpt-6.1-sol` model with `medium` effort. The preview chose three existing source-checked candidates. Clicked once: **one live model request, three captions assessed**. A subsequent exact `allowModel:false` diagnostic returned `cached:true, modelCalls:0` and the same records; no additional inference or paid web search.

| Actual source | Model result | Feed outcome |
| --- | --- | --- |
| [Alvaro New York film](https://www.tiktok.com/@alvarovaliente_/video/7672800453221944589) | Category supported; creative project described, with exact camera/creative-approach quotes. | Travel TikTok Inspiration **0 → 1**; combined Inspiration **8 → 9** (8 YouTube, 1 TikTok). |
| [Norwegian bicycle escalator](https://www.tiktok.com/@ellensoraya101/video/7690419042351385886) | Category supported; project none: ordinary destination discovery. | Not admitted to Inspiration. |
| [Movement transition teaching tip](https://www.tiktok.com/@peace_gates/video/7450092896386305298) | Category mismatch; project none: travel is only a possible future application. | Not admitted to Inspiration. |

The New York card displays August 11 and 2.4M native views; its separate source snapshot records 584.1K likes. It remains absent from Popular recently (TikTok count zero) and Learn. Learn retains the unrelated pre-existing Google Earth/drone tutorial by justdodani. Saved stays three. The source-caption explanation explicitly makes no watched-footage, named-technique, authorship, quality or popularity claim. This is a measured recall improvement for one real film, not all-category completion or proof of current-trend quality.

The other two original Travel positives (Nice and flight) are covered by deterministic ranking regression fixtures but were **not** sent to the live model in this pass. No exact benchmark captions were hardcoded in the production prompt. Current cross-category semantic quality and ambiguous/negative captions still need a separate economical evaluation.

Sanitized public receipt: system Temp `discover-caption-live-2026-10-11.json` (no account ID/credentials). Initial screenshot: `discover-caption-live-2026-10-11.png`. Testing also exposed a category badge count re-filter and a missing semantic context in the combined For You feed; both are addressed in the final follow-up changes and tests.

Final source passed lint, app/Worker types, production build and **3,534 tests / 177 files**. Phone/desktop browser regressions passed **422 cases / eight intentional skips / zero failures**. The new HTTP test fixture initially rejected legitimate low Windows ephemeral ports; it now excludes only the actual Fetch bad-port table, like the existing server tests. A test run concurrent with the browser suite hit two five-second test timeouts; the unchanged suite passed in 40.42 seconds after the browser run finished. Do not weaken test thresholds or run both heavy suites together when verifying this checkpoint.

After copying the final export, a fresh Chrome page loaded the persisted library: Browse → Travel showed **All 9 / TikTok 1 / Instagram 0 / YouTube 8**, with the same New York caption assessment checked at 14:04:39 and Saved three. No reassessment was required. For You is capped at 30 diversified results and did not visibly include the New York card in this particular corpus; its context retention is covered by focused integration regressions, not a claim that the card must occupy a top-30 slot. The final evidence screenshot is `discover-caption-persisted-2026-10-11.png`.
