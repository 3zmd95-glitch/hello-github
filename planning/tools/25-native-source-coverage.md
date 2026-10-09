# Native discovery coverage — 9 October 2026

## Purpose and measured limits

The owner wants current, useful editing inspiration and learning examples. General web search has missed native Instagram edits the owner actually sees. Stronger caption filters can remove irrelevant results, but they also miss real editing when a creator writes about the scene rather than the technique. This investigation separates candidate discovery, source metadata, audiovisual inspection, and measured trend adoption. Success at one does not establish the others.

This combines an access assessment with a measured repair to the existing public-video inspector. No new login flow, permission, provider, dependency, or accessible discovery integration is established by this document. No credentials were read or paid searches issued for this research. Existing authorized access must still be checked through safe application status and bounded diagnostics before a new discovery route is advertised as available.

The initial six-post public-source preflight reported **metadata available for 6/6 posts and frames available for 1/6**. After the bounded download-cap repair described below, frames were available for **4/6**. This is one deliberately selected six-post test, not a representative benchmark, a platform-wide availability rate, or evidence that every tested video was visually classified. A caption, thumbnail, or audio label is not a substitute for video frames and sound. The result supports keeping metadata and visual-inspection status separate and preserving unknown visual properties when media is inaccessible.

Native playback also revealed creative text overlays in corniflix posts whose captions describe the plot. Such posts cannot be reliably dismissed as unedited clips from their captions alone. Equally, a popular scene with overlays is not automatically a strong editing lesson or a spreading visual format. The application needs a path for real audiovisual evidence and explicit personal selection rather than universally admitting hashtags or universally rejecting plot captions.

See [24 — Editor feed](24-editor-feed.md) and the [9 October handover](../handovers/discover-editor-feed-2026-10-09.md) for the prior indexed-search trial, source-aware candidate library, persistence validation, and remaining quality gaps. The capped paid trial is closed; this proposal does not reopen spending or increase quotas.

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

Regression tests exercise an actually streamed valid payload above the old cap, declared and streamed rejection above 32 MiB, cancellation and temporary cleanup. This is a repair to inspection coverage; no general category visual ranker or native discovery grant has been added.

## Proposed category visual assessment slice — unimplemented

One subsequent real UI check using the selected **GPT-6 Astra / max** model described visible glowing type and left the proposed clone interpretation uncertain. This supports reusing the existing image-input transport for broader category assessment; one successful response is not an accuracy benchmark. The following slice is a proposal only. Its initial scope is **Browse category feeds and propagation into the cached For You feed**, not every Search surface, TikTok/YouTube frame extraction, or automatic trend detection.

### Trigger and usage bounds

Reuse the existing selected subscription connection, model, effort and account. When visual checking is visibly enabled, an explicit category retrieval may queue checks for its candidate cohort: **at most four public frame preflights and two new model calls per action**, with serial model execution, progress and cancellation. A cached assessment does not consume a model call. Prioritize directly sourced, meaningfully engaged Instagram candidates whose category/craft is unresolved; select from the raw category pool before caption admission so plot-caption false negatives can be inspected. Prefer different creators.

Also provide an explicit **Assess existing candidates** action with the same bounds. It reads the local category pool and public source media but performs no search, so improving candidate quality does not require buying another retrieval. Neither path changes provider quotas. Stop on connection, account-change, model, usage-limit or busy errors; no silent model downgrade, automatic paid fallback or retry. Show the selected model and the maximum inspection count before starting. A search-planning call, where applicable in future surfaces, is separate subscription use and must not be hidden inside that count.

Do not launch model requests from rendering, hydration, sorting, category switching, More/Less/Hide feedback, or a periodic clock update. A changed count or completed source enrichment must not restart the queue. No background schedule is part of this slice.

### Endpoint and stored contract

Add a generic local `POST /api/local-ai/assess-category` using the existing exact-post reader, bounded frame extractor and image-capable ChatGPT transport. Input contains the canonical post, known category, language and `AiSelection`; no invented target format is needed. Initially retain the existing Instagram-only media support. Claude image input remains unsupported until separately implemented and tested.

The model returns only constrained category relevance (`supported`, `uncertain`, `mismatch`), a few directly visible added-edit cues with valid frame references, and uncertainty. The server sets post/category identity, schema/rubric version, source-text snapshot/digest, check time, video/frame hashes, timestamps and actual provider/model/effort. Raw model text cannot set those authority fields. Require purposeful added treatment such as styled typography, cutouts, graphic framing or panel composition; sophisticated animation already present in a film, ordinary subtitles, a watermark, attractive footage and hashtags do not establish the uploader's craft. Sparse samples supply no audio, complete motion, synchronization, engagement, growth or whole-video verification.

Keep the compact result in an optional category-scoped `DiscoverCandidate.visual` field, separate from `DiscoverItem.evidence`. Do not persist frame bytes or temporary CDN URLs. Minimal application API:

```ts
applyDiscoverVisualResult(response: unknown, guard: {
  epoch: string;
  generation: number;
  genreId: string;
  url: string;
  selection: AiSelection;
}): "applied" | "unchanged" | "stale" | "invalid";

applicableDiscoverVisual(candidate, currentItem, now): Assessment | undefined;
```

The proposed shared module is `lib/discoverVisual.ts`. Its strict Zod request accepts only `provider: "chatgpt"`, the existing validated model/effort/account selection, canonical Instagram `url`, a built-in `genreId`, and optional `lang`. The category description comes from the server's category registry. Custom categories and other video platforms remain explicitly unsupported in this first slice. The raw model schema and persisted server envelope are:

```ts
type DiscoverVisualAssessment = {
  category: "supported" | "uncertain" | "mismatch";
  categoryFrames: number[]; // unique, zero-based indices into the actual supplied frames
  observations: Array<{
    cue: "typography" | "compositing" | "layout" | "graphic-treatment";
    origin: "uploader-added" | "source-content" | "uncertain";
    description: string;
    frames: number[]; // at least one valid, unique frame index
  }>;
  uncertainty: string;
};

type DiscoverVisual = {
  version: 1;
  url: string;
  genreId: string;
  checkedAt: string;
  provider: "chatgpt";
  model: string;
  effort?: string;
  source: {
    provenance: "instagram-public-embed";
    caption: string;
    author: string;
    observedAt: string;
    sha256: string;
  };
  media: {
    provenance: "instagram-public-embed-video";
    observedAt: string;
    durationSeconds: number;
    videoSha256: string;
    frames: Array<{ timestampSeconds: number; sha256: string }>;
  };
  assessment: DiscoverVisualAssessment;
  limitations: ["sampled_frames", "motion_partial", "audio_unverified"];
};
```

Validate with `z.strictObject` throughout: at most five observations, 240 characters per observation, 400 characters of uncertainty, eight unique citations per list, 4,000 source-caption characters, 200 author characters, ISO timestamps and lowercase 64-character SHA-256 digests. Media has two to eight frames, increasing timestamps within a positive duration of at most 90 seconds. Category support and every usable craft cue require actual frame citations. An affirmative fallback needs both supported category evidence and a purposeful `uploader-added` observation. Color treatment is deliberately absent: isolated stills cannot establish whether the uploader graded the source. Ordinary subtitles/watermarks and the source film's animation remain insufficient even if a model calls them typography or graphics.

The successful route returns `{ visual, source: InstagramSource }`, allowing the existing native-source application helper to run before the guarded visual write. The server sets every envelope field and checks the returned model against the selected model; the model supplies only `assessment`. Account identity stays in the transient request guard and server cache key, never in the persisted visual record. Exact bounded caption and author fields enter the prompt and the synchronous applicability comparison; their server digest records the same binding without requiring asynchronous hashing inside ranking. A count-only refresh keeps that binding valid. The applicability window remains 24 hours, with no automatic renewal.

Reuse the existing `verify-format` route's same-origin guard, connected-account/sharing checks, selected effort validation, per-provider active lock, cancellation, `sourceFor`, frame extractor and image transport. Add only the new schema name to `LocalAiPlanInput`; there is no thumbnail fallback, generic prompt input or new credential handling. Source/decode failures must remain distinguishable from model attempts so the four-preflight/two-model-call queue limit is enforceable; an ambiguous interrupted model request counts against the limit. Existing media hashes, not raw video or frames, are the reusable inspection artifact.

Raw `accumulateDiscoverCandidates` must not introduce model judgments. Merge the authoritative native item first using existing source precedence, then merge the visual record independently; native count updates must not erase a visual-only change. Valid records round-trip through IndexedDB and the owner's backups under the existing local-data trust model. No signatures, separate import trust ledger, or stripping of valid backup assessments is required. Schema validation, binding and applicability still apply after import.

### Ranking and stale-result rules

- An applicable affirmative assessment may resolve missing craft, missing category, or empty prose. Add a distinct visual-craft reason; do not rewrite native captions or label an inferred cue as a source-named technique. Source engagement floors still govern Inspiration, and all existing native-metric, freshness and publication-date requirements still govern Popular. Learning admission stays unchanged in this slice. Sparse absence/uncertainty does not demote an otherwise valid reference; Less/Hide and native unavailability continue to dominate.
- Expose the current metadata exclusion reasons without changing their semantics: `empty-prose`, `full-feature-upload`, `equipment`, `image-prompt`, `prompt-bait`, `sales`, `ordinary-content`. Initially only `empty-prose` is visually overridable; the other explicit exclusions remain blockers. Do not globally override `meta.excluded` or stale indexed flags without affirmative category-and-craft evidence.
- Server cache identity includes canonical post, category/rubric and extraction versions, selected provider/account/model/effort, output language, exact supplied source text, video hash and ordered frame hashes/timestamps. Counts and metadata observation times are excluded, so changing likes does not trigger another model call. Use an initial 24-hour applicability window; expiry does not automatically renew a check.
- Exact source-text mismatch or newly observed different media hashes makes the old result inapplicable. A failed media read establishes neither change nor freshness: preserve the dated old record without renewing it. If frames succeed but the subsequent model call fails, a validated response may still report their media identity so an actually changed video cannot retain an old positive assessment.
- Live response validation checks post, category, selected model/effort and account context. Reject future/invalid times, unsupported versions and invalid frame references. Before applying, confirm the active generation, library epoch and candidate still exist; reset/import/navigation cancellation must prevent late writes.
- For You may share the newest native source across duplicates, but retains each original category's visual record and revalidates it against that source. One category's assessment cannot qualify the same post in another. Applicable strong visual references can receive normal strong-reference retention priority, never manual-import priority or invented popularity.

Implement and test in this order: endpoint/schema; candidate merge/persistence and pure ranking; Browse queue plus existing-pool action; For You propagation. Regressions must cover source-text/hash changes, unchanged counts, category isolation, backup round-trip, reset/import races, uncertainty, hard exclusions, usage termination and zero model calls from feedback/reload. A small real-video comparison with clear edits and ordinary/ambiguous examples remains necessary before claiming useful classification accuracy. This proposed slice improves evidence for retrieved candidates; it does not solve missing native discovery supply or complete the owner's overall goal.
