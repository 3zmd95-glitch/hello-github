# Native discovery coverage — 9 October 2026

## Purpose and measured limits

The owner wants current, useful editing inspiration and learning examples. General web search has missed native Instagram edits the owner actually sees. Stronger caption filters can remove irrelevant results, but they also miss real editing when a creator writes about the scene rather than the technique. This investigation separates candidate discovery, source metadata, audiovisual inspection, and measured trend adoption. Success at one does not establish the others.

This combines an access assessment with a measured repair to the existing public-video inspector. No new login flow, permission, provider, dependency, or accessible discovery integration is established by this document. No credentials were read or paid searches issued for this research. Existing authorized access must still be checked through safe application status and bounded diagnostics before a new discovery route is advertised as available.

The initial six-post public-source preflight reported **metadata available for 6/6 posts and frames available for 1/6**. After the bounded download-cap repair described below, frames were available for **4/6**. This is one deliberately selected six-post test, not a representative benchmark, a platform-wide availability rate, or evidence that every tested video was visually classified. A caption, thumbnail, or audio label is not a substitute for video frames and sound. The result supports keeping metadata and visual-inspection status separate and preserving unknown visual properties when media is inaccessible.

Native playback also revealed creative text overlays in corniflix posts whose captions describe the plot. Such posts cannot be reliably dismissed as unedited clips from their captions alone. Equally, a popular scene with overlays is not automatically a strong editing lesson or a spreading visual format. The application needs a path for real audiovisual evidence and explicit personal selection rather than universally admitting hashtags or universally rejecting plot captions.

See [24 — Editor feed](24-editor-feed.md) and the [9 October handover](../handovers/discover-editor-feed-2026-10-09.md) for the prior indexed-search trial, source-aware candidate library, persistence validation, and remaining quality gaps. The capped paid trial is closed; this work does not reopen spending or increase quotas.

## Instagram: existing login versus public discovery

The repository's `workers/scout/src/social/instagram.ts` uses Instagram Login through `graph.instagram.com`. Its base scopes are `instagram_business_basic,instagram_business_manage_insights`; publishing and reply scopes are optional separate capabilities. The existing sync reads `/me/media` for the connected account's uploads, including captions, dates, media links and available engagement fields. That is useful first-party account data, not a public creator watchlist or the owner's recommendation feed.

Meta's [official Instagram Login collection](https://www.postman.com/meta/instagram/folder/6raa77c/instagram-api-with-instagram-login) describes professional-account management without a linked Facebook Page. The current repo has no Business Discovery or hashtag-search implementation for that login. This review found no current primary-source confirmation of an equivalent public-creator discovery route supported by the existing Instagram Login grant. That is an unverified capability, not a claim that all such access is technically impossible.

Meta's [official Facebook Login collection](https://www.postman.com/meta/instagram/folder/u4g5a2a/instagram-api-with-facebook-login) separately documents finding hashtagged media and obtaining metadata/metrics about other professional accounts. It requires a Facebook Page linked to a professional Instagram account, and does not provide consumer-account access. A creator watchlist based on public professional accounts is therefore a credible extension to investigate through that documented path; the current Instagram Login token does not establish access to it.

The collection lists permissions for its combined read, publishing and comment examples. It is not a minimal read-only authorization recipe. Before any implementation, verify the exact current Business Discovery/hashtag endpoint scopes, app review or feature requirements, supported media fields and account coverage; request only what the selected read-only route needs. Direct Meta documentation returned rate limits during this research, so endpoint-specific grant requirements were not independently confirmed. No Facebook Login integration was added or authorized by this research.

Existing `instagramSource.ts` and related media readers can inspect a known public post without importing account credentials. They do not discover a creator's new uploads or enumerate an audio's visual variations. A successful exact-post read establishes only the returned source fields. The immediate existing-access path remains native browsing or deliberate link intake followed by bounded source checks. Browser access must not be converted into extracted cookies, private API tokens, or a claim that the app possesses an official public-feed endpoint.

## TikTok: the native route already present in code

`workers/scout/src/categories/tiktok.ts` already implements a bounded Business Discovery path using the separate advertiser authorization in `tiktokads.ts`, not the normal social publishing connector:

1. Read the stored advertiser integration through the application, without exposing its token.
2. Request `discovery/trending_list/` for the category's industry, `SPECIAL_EFFECTS`, and `PHOTOGRAPHY`, with the configured country and a seven-day range.
3. Pick at most ten relevant hashtags and request their related videos through `discovery/video_list/`.
4. Read at most twelve public captions, with three concurrent reads and bounded timeouts, before the existing metadata qualification.

This is at most four Business API requests and twelve caption reads per current `tiktokTop` run. The default country is `US`; accepting another two-letter setting in code does not prove the provider supports it. Hashtag relevance selects leads. It does not prove a video is a useful edit, that its engagement is current, or that the same visual/audio recipe is spreading.

The [official TikTok SDK](https://github.com/tiktok/tiktok-business-api-sdk/blob/main/python_sdk/docs/CreativeManagementApi.md) documents the trending-list operation with an advertiser ID, access token, country, category and date-range parameters. TikTok's [authorization documentation](https://business-api.tiktok.com/gateway/docs/index?doc_id=1766037914914818&identify_key=c0138ffadd90a955c1f0670a56fe348d1d40680b3c89461e09f78ed26785164b) distinguishes advertiser-authorized hashtag discovery from TikTok-account-authorized track discovery. The current [trending search-keyword documentation](https://business-api.tiktok.com/gateway/docs/index?doc_id=1832798345014338&identify_key=c0138ffadd90a955c1f0670a56fe348d1d40680b3c89461e09f78ed26785164b&language=ENGLISH) specifies the separate `discovery.search.words` permission. A stored advertiser token does not automatically grant track or search-keyword access.

The repo's `GET /tiktokads/status` returns only connection presence and advertiser count. That is appropriately secret-free, but it does not validate Discovery entitlement, supported endpoint responses, country coverage, or the usefulness of candidates. An actual permission error must remain a diagnostic; it must not be reported as an empty successful search. Public Creative Center pages and a native browser session are also distinct from Business API authorization.

The official SDK is a useful primary reference for the existing adapter; no new dependency is needed for these bounded HTTP reads. Its generated documentation contains a generic “No authorization required” heading alongside a required access-token parameter. The required token and request header govern the actual operation; that heading must not be interpreted as anonymous API access. Some direct TikTok documentation views returned JavaScript shells, so live endpoint and permission acceptance remain untested in this research.

## Proposed native-only TikTok gate fix

There is a concrete sequencing problem in `workers/scout/src/categories/run.ts`: the category scan executes paid indexed `searchFamilies` calls first. If those searches return no posts and errors, it returns before calling `tiktokTop`. The full category scan is therefore neither an independent native-source test nor a zero-indexed-search-cost entry point. Improving TikTok retrieval should not depend on buying more general web searches.

The smallest proposed change is a separate bounded, cache-aware native-only path around the existing TikTok adapter. It should accept a known category and supported country, retain the existing request ceilings, and return canonical post candidates plus safe diagnostics. It must not call `searchFamilies`, YouTube search, or an automatic paid fallback. Existing cached results can seed the library without making the old observation look fresh. Normal platform rate limits and authorization still apply.

First evaluate one category with the existing grant. Record permission outcome, raw canonical video URLs, readable current source metadata, publication/engagement evidence, and actual editing relevance as distinct stages. If access is denied, stop and report the missing capability; do not silently initiate reauthorization or expand scopes. If the endpoint supplies useful posts, route them through the current source-grounding and durable candidate-library contracts before changing the visible feed. Preserve source timestamps and unknown fields rather than manufacturing dates, counts or visual verification.

No native-only route was implemented as part of this document. Separating it is a proposal, not confirmation that the current deployed integration can retrieve candidates.

## Next evidence decision

Candidate coverage and visual access need separate acceptance checks. The six-post preflight demonstrates why a new caption ranker alone cannot close the gap: metadata was readable on all six, while initial frame extraction succeeded on only one. Repairing our own size constraint improved that to four; copyright restrictions and CDN rate limiting remained distinct failures. Native playback can reveal edits that plot-caption screening misses, but manually viewing a few posts does not justify labeling all retrieved posts as watched or verified.

The next bounded experiment should first establish whether the existing TikTok advertiser grant returns useful native candidates without indexed search. Separately retain a small set of native-playback observations containing clear edits, ordinary scenes and ambiguous cases, with exact post identity and what was actually inspected. Use that evidence to evaluate visual inspection coverage and caption false negatives. A later model or source integration should be selected only after its input coverage is demonstrated. None of these steps by itself proves platform-wide popularity growth, reproduces a private recommendation algorithm, or completes the owner's discovery goal.

## Public-video coverage repair

Six visible native links across xenoz.edit, corniflix_ and choppem.edits were checked once with the existing anonymous readers. Their publication dates were read separately from native Chrome, not inferred from retrieval times. The sample was selected from creator profiles; it contains useful edits and ambiguous scene sections, and is not a balanced positive/negative quality benchmark.

| Exact Reel | Native observation | Initial frame result | Repaired result |
| --- | --- | --- | --- |
| `DePNO4ABNRb` | Sparse caption; sampled CRT frame and glowing type; approximately 2.1K likes | Eight frames, 5,756,361-byte MP4 | Already readable; not retried |
| `DdzM0FYKUN7` | September 27; 2,056 likes in Chrome; glowing heart overlay around 21.7 s | Public embed explicitly copyright-blocked, no video URL | Unassessed; no bypass or retry |
| `DeFRPwDTQy1` | October 4; likes hidden; angled text around 5.4 s, ordinary scene around 17.9 s | 17,537,935 bytes exceeded 12 MiB | Eight frames, 60.93 s |
| `Dd1_oojTHi7` | September 28; likes hidden; large type and scanline texture around 7.7 s | CDN HTTP 429 | Unassessed; no retry |
| `DdFckpqzmb8` | September 10; 1,452 likes; layered typography around 13.7 s | 14,376,590 bytes exceeded 12 MiB | Eight frames, 60.18 s |
| `DcZHL9tul7-` | August 23; 2,986 likes; large glowing type/composition around 38.1 s | 29,741,457 bytes exceeded 12 MiB | Eight frames, 64.06 s |

One bounded diagnostic per failure confirmed exact shortcode identities and complete embed HTML within the existing 384 KiB bound. No lower-resolution rendition arrays or DASH manifest were present in these contexts. No checked explicit publication timestamp field was exposed. Two simultaneous views differed by one like for `DdzM0FYKUN7`; retain their separate observation provenance instead of treating counts as immutable.

The fixed local inspection cap is now **32 MiB**, sufficient for the three measured size failures. The 90-second clip limit, 35-second extraction timeout, eight JPEGs, per-frame bounds, one-active-provider guard, exact-source validation, HTTPS host allowlist, no redirects/cookies, cancellation and temporary cleanup remain intact. There is no automatic larger retry or thumbnail fallback. UI copy states the new limit in English and Hijazi Arabic. No new dependency was needed; the existing bounded FFmpeg path was reused.

All three formerly oversized clips succeeded once under the repaired cap. Twenty-four resulting JPEGs total 559,937 bytes, with exact source URLs, UTC observations, video/frame hashes and sample timestamps retained in the local diagnostic report. Hashes were rechecked with zero mismatches. Raw MP4s were cleaned up; diagnostic JPEGs stay outside Git. The first live proof and repaired report are in `C:/Users/AORUS/AppData/Local/Temp/discover-reel-preflight-9c75efc05e0542d69d67ea2f573a1cc0/` (`report.json`, `report-followup.json`, `diagnostics.json`, `coverage32.json`). These artifacts establish media readability, not automatic relevance or trend admission.

Regression tests exercise an actually streamed valid payload above the old cap, declared and streamed rejection above 32 MiB, cancellation and temporary cleanup. At that repair checkpoint, no general category visual ranker or native discovery grant had been added. The subsequent generic assessment implementation is recorded below; native discovery access remains unchanged.

## Category visual assessment — implemented, integration validation in progress

One earlier real UI check using **GPT-6 Astra / max** described visible glowing type and left the proposed clone interpretation uncertain. That was the existing format inspector, not a live test of the generic category feed implementation below. It is not an accuracy benchmark.

The generic slice is now implemented for **Browse category feeds and propagation into cached For You**. Its code is under integration validation. No live generic-classification result or classification-accuracy claim is established here yet. It does not add native candidate discovery, TikTok/YouTube frame extraction, or automatic trend detection, and it does not change every Search surface.

### Explicit actions and usage bounds

`CategoryVisualChecks` exposes the selected ChatGPT connection/model/effort, **Assess existing candidates**, and an unchecked, one-use option to also assess the next **Find more** or **Find examples & tutorials** result in the same Browse category. Assessing the existing pool performs public source/media reads and may use the selected subscription; it makes **no new search**. The next-lookup option does not trigger retrieval itself. It is consumed after a successful captured lookup cohort and is cleared or invalidated by scope/selection changes.

`useCategoryVisual` runs serially, with **at most four candidate attempts/preflights and two successful assessments per explicit action, including cached or uncertain assessments**. It also caps new model calls at two. A cached assessment consumes a success slot but no new model call; a model failure stops the action. Expected post-specific media failures may advance to another candidate within the four-attempt ceiling. Account/model/connection, usage-limit, busy, decoder-unavailable, unexpected network and invalid-response failures stop the queue. Cancellation does not refund an already-started provider request.

The queue prefers strong native Instagram candidates with unresolved category/craft, then strong indexed leads for native verification, with creator diversity. It deduplicates canonical post/reel aliases, preserves stronger/newer native evidence over indexed duplicates, and skips native unavailable posts, explicit Less/Hide signals and known hard exclusions. Indexed engagement is only a lead-selection hint. Before any frame extraction or model call, the server reads the exact native source and requires **at least 500 visible likes**. Unknown likes and lower native counts skip inspection and can correct the stored candidate's source data. The current Instagram reader does not expose views, so indexed views cannot replace this server gate.

Rendering, hydration, feedback, sorting, ordinary navigation, source enrichment and clock updates never start a model request. Expiry merely makes a candidate eligible for a later explicit action. There is no background schedule, hidden model downgrade, new paid-search fallback or quota increase. Claude image input remains unsupported for this slice.

### Endpoint, cache and persisted evidence

`POST /api/local-ai/assess-category` reuses the local server's same-origin protection, connected-account/sharing checks, selected model/effort validation, per-provider active lock, exact-post reader, bounded frame extractor and ChatGPT image transport. `lib/discoverVisual.ts` defines the strict request/response schemas and assessment rubric. Requests accept a known built-in category, canonicalizable Instagram post, language and selected account/model/effort; custom categories and arbitrary hosts are rejected. The existing **32 MiB / 90 seconds / up to eight JPEG frames** extraction bounds remain in place, without a thumbnail fallback.

The model supplies only a constrained judgment: category `supported`, `uncertain` or `mismatch`; zero-based frame citations; up to five observed cues from `typography`, `compositing`, `layout` or `graphic-treatment`; whether each cue is `uploader-added`, `source-content` or `uncertain`; and a short uncertainty statement. The rubric excludes ordinary subtitles, watermarks, source animation/cinematography and attractive footage as proof of uploader-added craft. It does not infer grading, sound, timing, speed ramps, synchronization, engagement, growth, tutorials or complete-video quality from still samples.

The server supplies the version, canonical post, category, timestamps, exact bounded caption/author snapshot and SHA-256 digest, video/frame hashes, ordered sampling times, actual provider/model/effort, and fixed limitations. Raw model output cannot set those fields. Responses are discriminated `assessed` or `unavailable`, bind the selected account/model/effort, report `modelCalls: 0 | 1`, and may carry authentic source metadata. A failure after valid frame extraction can also return a validated media observation without creating a positive judgment.

The in-memory server cache is bounded to 64 assessments for **24 hours**. Its identity includes route/rubric version, post, category, selection including account, language, exact caption/author, video hash, duration and ordered frame hashes/times. A server cache lookup happens after source and media verification; it avoids another model call, not necessarily those public reads. Counts and observation times are excluded from the identity. A cache hit returns the original visual check time plus current source metadata and does not renew applicability. A fresh, source-matching result already in the local library is skipped by the client for the same model/effort.

The optional category-scoped `DiscoverCandidate.visual` is persisted separately from native `DiscoverItem.evidence`. `visualObservation` retains a newer valid media receipt when inference fails, preventing IndexedDB merge from reviving an older positive for changed media. Neither record stores image bytes, temporary CDN URLs, account identity or request generations. The native item is merged using existing source precedence before independently merging visual evidence. Count-only refreshes preserve a valid judgment and its original check time; caption/author changes, native unavailability or a differing current media receipt invalidate it.

The store boundary is:

```ts
applyDiscoverVisualResult(response: unknown, guard: {
  epoch: string;
  genreId: string;
  url: string;
  selection: AiSelection;
  isCurrent(): boolean; // caller's active abort/navigation/selection generation
}, now?: Date): "applied" | "unchanged" | "stale" | "invalid";

applicableDiscoverVisual(
  candidate: { genreId: string; visual?: DiscoverVisual; visualObservation?: DiscoverVisualObservation },
  currentItem: DiscoverItem,
  now?: number,
): DiscoverVisual | undefined;
```

Raw `accumulateDiscoverCandidates` cannot add model judgments. Live application checks exact source/post/category/selection, candidate existence, library epoch, active caller generation, schema, citations and bounded timestamps. Reset/import, navigation, cancellation or selection changes reject late results. Applicability is **24 hours** from the original judgment and allows only bounded clock skew. A failed read alone does not prove media changed or renew old evidence. A changed-media receipt can invalidate an old positive even at an equal observation timestamp.

Schema-valid visual records round-trip through IndexedDB and owner backups under the existing local-data trust model; malformed optional visual fields are dropped without discarding the native candidate. No signature system or separate import-trust ledger was introduced. Shared native source updates in For You are rechecked against each original category's visual record, so a post's assessment in Anime cannot qualify it in another category.

### Feed admission and presentation

An applicable affirmative assessment requires both frame-supported category evidence and purposeful `uploader-added` craft. It can resolve missing category/craft or `empty-prose`, with a distinct `sampled-visual-craft` reason. It never rewrites the native caption or turns an inferred cue into a source-named technique. The explicit exclusions `full-feature-upload`, `equipment`, `image-prompt`, `prompt-bait`, `sales` and `ordinary-content` remain blockers. Sparse uncertainty or mismatch does not demote an otherwise metadata-qualified reference; explicit dismissal and native unavailability still dominate.

Inspiration still requires meaningful native engagement for these Instagram candidates. **Popular's engagement, native-source, observation-freshness and publication-date gates are unchanged**; visual craft may supply the craft component but cannot manufacture popularity or growth. **Learn keeps its metadata-only teaching/admission gate.** A visual check cannot turn an ordinary example into a tutorial. The cards show dated sampled-frame observations, selected model and limits. Applicable strong visual references receive ordinary strong-reference retention priority, not manual-import priority.

The code paths are `lib/discoverVisual.ts`, `scripts/local-ai/server.ts`, `lib/discoverVisualClient.ts`, `components/research/useCategoryVisual.ts`, `CategoryVisualChecks.tsx`, `BrowseCategoryFeed.tsx`, candidate/store persistence, `lib/discoverRanking.ts` and `lib/discoverForYou.ts`.

### Follow-up handover: integration validation

Focused development checks have passed, including **177 tests across six persistence/store/shared-schema files**, plus app TypeScript and clean targeted lint for those persistence changes. Separately reported endpoint/provider/extractor and ranking batches overlap shared coverage; do not add their totals or substitute them for a final full-suite run. Regressions include canonical post/reel deduplication, source corrections over inflated indexed aliases, source-text/media changes, count-only refreshes, category isolation, backup and native-adapter reload, reset/import/cancel races, terminal usage/account/model failures, queue bounds, expiry without automatic work, and zero hidden model calls from feedback/re-render.

The frozen source passed **3,029 unit tests / 156 files**, lint, app/Worker typechecks and build. The full 406-case browser run passed 396 existing cases and skipped eight intentional viewport cases. Two new cases initially failed an incomplete test-only Worker setup; after correcting it, both desktop and phone cases passed, including selected model/effort, the two-assessment ceiling, no search, canonical Browse admission, For You propagation, persistence and EN/AR layout. This is a full run plus a focused correction.

Actual localhost:3000 Chrome assessment used **gpt-6-astra / max** and completed **two assessments from two attempts**, with no Tavily calls. `DePNO4ABNRb` received frame-cited typography/framing evidence. A new personal reference, `DdFckpqzmb8`, was added with the manual keep preference unchecked and was absent from Inspiration before assessment. After the model cited layered display typography, it qualified with about 1.5K native likes. The added record and its original check timestamp survived reload. Both examples stayed outside Popular and Learn; Xenoz's evidence also appeared in For You. Choppem was absent from the first 24 mixed cards, so its For You display was not established in the live pass. Details and local screenshot are in the October 9 editor-feed handover.

These two previously played positive examples establish integration behavior, **not balanced classification accuracy**. No ordinary/ambiguous control was assessed in this batch. One bounded model description ended in a fragment; raw text is retained. Missing native discovery supply, fuller audiovisual assessment and measured trend adoption remain open. Keep the capped paid-search trial closed.
