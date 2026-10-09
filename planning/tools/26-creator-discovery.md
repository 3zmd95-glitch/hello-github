# 26 — Native creator expansion for editor discovery

## Problem and decision

The capped Tavily trial did not supply useful Instagram inspiration. Category-specific visual checks can rescue a retrieved post whose caption omits its editing, but do not acquire missing posts. The next bounded supply experiment reads public uploads from a creator behind an existing useful YouTube reference, using the dashboard's already configured YouTube key. It performs no Tavily query, `search.list`, model inference, new OAuth flow or background schedule.

This is continuity around an editor, not a replacement for broader discovery. New uploads still need category, editing and engagement screening; a creator identity does not qualify all of their videos. It does not solve native Instagram access or establish a rising trend.

## Search before building

- Google's maintained [Node API client](https://github.com/googleapis/google-api-nodejs-client) and its [YouTube package](https://github.com/googleapis/google-api-nodejs-client/blob/main/src/apis/youtube/README.md) support these endpoints under Apache-2.0. A new SDK dependency is unnecessary for a bounded browser-side read of three existing REST resources.
- The [official public-upload pattern](https://developers.google.com/youtube/v3/sample_requests) uses the channel's uploads playlist and `playlistItems.list`; [channels](https://developers.google.com/youtube/v3/docs/channels/list), [playlist items](https://developers.google.com/youtube/v3/docs/playlistItems/list) and [videos](https://developers.google.com/youtube/v3/docs/videos/list) document the list endpoints.
- Existing `workers/scout/src/social/youtube.ts` already uses uploads playlists for own-account synchronization. Reuse that pattern, not its authenticated owner-sync behavior. Existing `lib/youtubeEvidence.ts` supplies public video parsing and source binding; reuse it instead of introducing a second caption/count representation.
- The installed skill/plugin catalog has no purpose-built YouTube creator-discovery connector. Existing fetch, Next client components and the app's source-aware candidate store fit this work. No new plugin or dependency is required.

## Implemented contract

`lib/discoverCreator.ts` exposes `youtubeCreatorSeed(item)` as an eligibility hint and `expandYoutubeCreator(item, key, { fetch?, now?, signal?, lang? })` as the bounded acquisition helper. **More from this creator** appears on eligible YouTube cards in Browse categories and For You, with native `youtube-api` evidence, a canonical channel profile, an existing configured dashboard key, and either strong engagement or teaching evidence. A per-feed queue permits one explicit action at a time. It creates no More/Save preference, manual-import marker, model request or scheduled work. The visible channel hint is not trusted by itself: official seed-video metadata must confirm that exact channel before its uploads are read.

An uncached acquisition makes **at most four official list requests**: seed `videos.list`, `channels.list` for uploads identity, one `playlistItems.list` page with **at most twelve entries**, and one `videos.list` batch. Each read has a six-second deadline and a one-MiB streamed-response ceiling; fixed HTTPS API endpoints reject redirects and omit browser credentials. There is no pagination, retry, `search.list`, paid-search fallback or inference. These reads consume the existing YouTube API quota. Only requested, public, processed videos whose actual channel matches the verified seed are returned. Missing/private/deleted/rejected, duplicate and mismatched entries are omitted; absence is not recorded as proof of deletion. The clicked seed is excluded from the returned candidates.

The first twelve playlist slots are a bounded sample, not twelve guaranteed edits or exhaustive latest-topic coverage. Returned items preserve their uploads-page order because `videos.list` may answer in another order. Publication dates come from the video's `snippet.publishedAt`, never playlist-add time. Native title, caption, author/channel and available integer counts use the shared `parseYoutubeSource`/`applyYoutubeEvidence` contract. Language is derived from source content, not the UI language. The existing category/mode ranker then applies ordinary relevance, teaching, engagement, date and exclusion rules; creator identity supplies no admission bypass.

The **15-minute, 64-channel-entry memory cache** is scoped to the configured key and confirmed channel, with bounded verified seed bindings. A known seed can reuse its channel batch with zero calls; a different unverified seed requires one official seed read before a matching channel-cache hit. Cached source/check times are preserved. Verified sources prime the existing key-scoped YouTube evidence cache without overwriting newer evidence or extending its observation-based expiry, avoiding immediate duplicate enrichment calls for the acquired records. Keys and bindings never enter candidate records, persistent caches, exports, logs or visible outcomes.

`useCreatorExpansion` accumulates results into the seed row's original category through the normal source-aware store. It fences responses by API key, library epoch/readiness, navigation/category/view/language scope, cancellation and the seed's native source bindings across category copies. This accommodates For You's shared newest source without requiring an older category copy to match that caption initially. Count-only changes do not change source identity. Late discarded requests settle without leaving a loading state; completed outcomes remain visible in the same scope even if retention removes the seed card or a later source update changes it. Effects only invalidate work; rendering, feedback, sorting and reload do not start creator acquisition.

The helper returns either `{ ok: true, channel, items, examined, omitted, cached, checkedAt, requests }` or `{ ok: false, error, stage, requests }`, distinguishing missing key, invalid seed, auth, quota, network, unavailable and cancellation. A valid empty batch is a successful read, not a quality gain. `examined` counts the first-page slots; `omitted` is slots minus returned candidates, including the excluded seed and duplicates, not just unavailable videos. The UI separately reports uploads checked, genuinely new candidates still retained in this category, and how many of those new records qualify for the selected category/mode. It does not count already-stored records as new. For You has a display cap, so a qualified candidate is not necessarily shown there immediately. No count implies that the uploads were watched or are all useful edits.

The production implementation is frozen. Final gates and real Chrome findings are recorded below; development checks alone do not establish useful new-candidate supply.

## Live acceptance experiment

Record the category's original canonical URLs through the rendered UI, invoke once, and compare the result against that existing corpus. Confirm the bounded native path and absence of search/model requests with regression tests and the runtime behavior. Identify any genuinely new qualifying edits or lessons, inspect their source date/count, and play at least one actual accepted video. Check category placement, reload retention and repeat behavior. A valid empty outcome or twelve metadata records alone is not a quality improvement.

The initial pilot is not an all-genre quality benchmark. Keep actual playback observations, metadata rules, model judgments and trend-adoption claims separate. Tavily's paid trial stays off.

### First real Chrome acquisition results

The first frozen creator build passed full lint, app/Worker types, **3,067 unit tests in 158 files**, the production build and **400 browser cases with eight intentional viewport skips, zero failures**. Actual Chrome used localhost:3000 and the existing dashboard YouTube key. No Tavily search or model call was made in this acquisition experiment.

| Seed / category | Upload slots checked | New records retained | Newly qualified Inspiration records at this checkpoint |
| --- | ---: | ---: | ---: |
| FAXCO, `ISnPHjWMdYA` / Anime | 12 | 11 | 2 |
| weiguovisuals, `hN9mgsNWZrU` / Coffee | 12 | 12 | 0 |

Anime YouTube Explore increased from 17 to 28 canonical URLs; Inspiration increased from eight to ten. A repeat FAXCO action reported a cached check and zero new records. The 11 newly rendered Explore URLs were compared with the pre-action DOM baseline. Coffee's qualifying feed did not improve: its YouTube Explore stayed at 32 and Inspiration at nine despite the retained records. Acquisition counts alone are not a quality gain.

One new Anime result, [`FPRiA4JNJLg`](https://www.youtube.com/watch?v=FPRiA4JNJLg), had approximately 6.9K views and a September 27 publication date. Actual inline YouTube playback showed decorative typography, graphic panels and layered character compositions, including around the creator's section beginning at 0:41. This is sampled visual evidence of an editing reference, not whole-video/audio verification or rising-trend evidence. The second initially admitted result was `JvM648vB00Y`, approximately 5.3K views, October 4; it was not played in this pilot.

Chrome also exposed two separate classification faults before the final acceptance pass: Coffee's two-hour ambient background-jazz video `Amh5NZMkf3I` was admitted by its B-roll wording, and finished Anime projects were being put in Learn by fair-use teaching language or channel-bio tutorial promotion. New acquired project [`3EC-txT37MM`](https://www.youtube.com/watch?v=3EC-txT37MM), approximately 6.3K views, July 9, was one such misplaced record. Actual playback showed large display type behind character cutouts, graphic backgrounds and changing compositions. Its source biography advertises tutorials, but the sampled video is a finished AMV. These findings triggered a further classifier repair; do not present the first build's gates as final validation of that repair.

Public-only local evidence is stored under `C:/Users/AORUS/AppData/Local/Temp/`: `discover-creator-anime-baseline-2026-10-09.json`, `discover-creator-coffee-baseline-2026-10-09.json`, `discover-creator-anime-result-2026-10-09.json`, `discover-creator-anime-explore-2026-10-09.json`, `discover-creator-coffee-result-2026-10-09.json`, and the `discover-creator-anime-playback-2026-10-09.jpg` / `discover-creator-mograph-playback-2026-10-09.jpg` screenshots. The twelve-genre, three-mode rendered baseline is `discover-creator-quality-before-2026-10-09.json`; it records counts and the initial cards, not playback of every result.

### Classification repair prompted by the pilot

Shared category metadata now distinguishes explicit long passive-listening uploads from creative videos: advertised long runtime, ambience/music context and background/work/study/sleep use must all be present, and actual teaching remains exempt. Sound design or a restaurant shot list mentioning ambience is not enough for exclusion. Post-level teaching evidence now omits explicit creator-biography/keyword sections and statutory fair-use notices while preserving the real title/body and subsequent sections. No creator allowlist or artificial engagement was introduced.

The two captured full public AMV captions were independently evaluated after stripping UI text: the FAXCO project (3,203 characters) and `Enemy「AMV」Anime Mix` by TumpyGFX (`8nKJCNgiVhc`, 1,909 characters) both remain eligible projects and no longer claim teaching. Their relevant public excerpts are regression fixtures; contact information and unrelated credits are omitted. The updated frozen source passed **3,080 unit tests in 158 files**, full lint, app/Worker types and production build. Four focused phone/desktop creator/classification browser cases passed; the final full browser and actual Chrome acceptance outcomes follow when complete.

A review of the clipped twelve-genre baseline identified follow-up candidates, not yet confirmed defects: Travel `ysynaVNKr0I` / `mUqtC3eNjnI` may advertise an external course rather than teach within the video; Coffee `iwv4XyGfYTA` may concern interior design rather than filming; Gaming `DblQk_cRzpq` contains a comma-separated tutorial SEO list. Obtain the full native text and/or play these before modifying rules. Preserve actual restaurant filming lesson `UF0UKyRUVYc` and film-scene lighting lesson `lRYm8a2oDTA`. These follow-ups do not justify claims about videos that were not watched.

The first actual Chrome correction pass still left three Anime YouTube records in Learn. Full native-text inspection established the triggers: `7f59LqeNM2g` had “mental breakdown” in a `Keywords & Hashtags:` section, while `ZRD2hb_Qz8w` and `bxtmvGt-ujk` linked to an external `Tutorial Channel`. The final narrow extension recognizes compound keyword-section headings in either order and omits dedicated outbound tutorial-channel lines. Actual title/body teaching remains eligible. All three full captured captions now classify as projects rather than lessons. The browser regression covers all five captured finished AMVs and two genuine tutorial controls carrying similar footers. No rule was added to assume that an audio-edit title establishes visual craft.

### Final validation and actual Chrome acceptance

The final frozen source passed **3,091 unit tests in 158 files**, full lint, app/Worker typechecks, the production build, and **402 browser cases / eight intentional viewport skips / zero failures**. The expanded four-case focused browser run also passed. The isolated port 3100 server was verified stopped; the tested export is served at localhost:3000, with primary tracked source unchanged.

After the final reload, Anime YouTube displayed **25 Inspiration / zero Learn**. All five captured finished projects were correctly outside Learn. Nine of the eleven newly acquired URLs qualified under the final Inspiration metadata rules; only the two playback samples described above were visually inspected. This includes `Cwb10uVUg88`, an audio-edit title whose visual craft remains unestablished. Do not report nine verified visual edits. The acquired records survived reload without another creator action, and Saved remained at two. No additional model or Tavily call was made. Coffee's confirmed ambient URL was absent from the complete YouTube Inspiration list; a genuine B-roll project replaced it, leaving the count at nine.

The final actual Chrome tour visited **all twelve genres and all three curated modes**. Counts below are all-platform UI results after source screening, not an accuracy score or evidence that all footage was watched. Most genres still have no qualifying recent-popularity supply; do not relabel older references as current trends to fill those gaps.

| Genre | Inspiration | Learn | Popular recently |
| --- | ---: | ---: | ---: |
| Cars | 3 | 6 | 2 |
| Food & restaurants | 8 | 28 | 0 |
| Anime | 28 | 5 | 11 |
| Travel | 9 | 25 | 1 |
| Football | 15 | 3 | 12 |
| Coffee | 10 | 19 | 0 |
| Perfume | 9 | 9 | 0 |
| Camping & desert | 2 | 4 | 0 |
| Fashion | 7 | 13 | 0 |
| Gaming | 5 | 14 | 0 |
| Weddings | 9 | 9 | 0 |
| Gym | 9 | 11 | 0 |

The final rendered audit is `C:/Users/AORUS/AppData/Local/Temp/discover-creator-quality-final-2026-10-09.json`; the full Anime Inspiration URL list is `discover-creator-anime-final-2026-10-09.json` in the same directory. This slice is validated progress, not completion of the native-quality discovery goal. Remaining priorities are permitted current Instagram/TikTok acquisition, stronger supply in sparse genres, and a balanced playback/visual-quality assessment (including ordinary clips and audio-only candidates).

## Other access routes still unresolved

The existing authenticated `GET /tiktokads/status` only reports stored connection presence and advertiser count; it cannot prove Discovery API entitlement. A future explicit native-only probe would need its own bounded endpoint. The current category `top/tt` route may call Brave and reports heuristic status, so it is not a safe substitute for a pure permission probe. The optional question about a Facebook Page linked to the user's professional Instagram account remains unanswered; do not infer a grant or start a new authorization flow.
