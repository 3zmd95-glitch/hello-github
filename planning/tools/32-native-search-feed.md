# Native category search connection — 2026-10-11

## Problem and decision

Discover's category view ranked a small accumulated reference library as if it were platform search. Anime had one Instagram card passing recent-popularity gates, while an actual signed-in Instagram `anime edit` search visibly returned dozens of Reel links. Individual imports cannot solve category coverage.

Use the existing optional Chrome helper to run user-requested searches on Instagram, TikTok and YouTube and combine rendered public result cards. Preserve each platform's ordering and interleave platforms; source evidence and the separate Popular recently filter remain distinct. This is native keyword-search retrieval, not access to a private recommendation API or a guarantee of trending footage.

## Reuse research

- Chrome's [external messaging](https://developer.chrome.com/docs/extensions/develop/concepts/messaging), [optional permissions](https://developer.chrome.com/docs/extensions/reference/api/permissions), and [isolated script injection](https://developer.chrome.com/docs/extensions/reference/api/scripting) cover the small installed helper without a new SDK or backend.
- Reuse existing maintained [idb-keyval custom stores](https://github.com/jakearchibald/idb-keyval/blob/main/custom-stores.md) for a bounded native-result cache. Do not put video images or large batches into the app's main localStorage snapshot.
- Reuse app ResultCard/player/save actions and public-source enrichment; no new scraping service, paid search provider, video download, private endpoint or session-token extraction.

## Boundaries

Connection is opt-in with optional access only to the three social hosts. Only localhost:3000/discover/ can request jobs, and each job is owned by its originating tab. The helper reads rendered public cards in tabs it creates for those requests. No scheduled capture, cookies, DMs, frame capture or automatic AI assessments. Stop/category changes cancel outstanding work; requests, page batches, retention and tab ownership are bounded. A platform login/challenge/failure stays visible and must not be described as no videos existing on the platform.

Existing visible-link selection and the separately approved video-image pilot remain available. Native cards do not acquire direct source evidence or a trend badge merely by appearing in a native search.

## Validation

### Continuous loading correction — 12 October, helper0.3.3

Real0.3.1 Chrome Coffee retrieval reached68 cards (Instagram24/TikTok15/YouTube29), then an explicit More reached104 (48/27/29). Saved3 remained. Proof: Temp `discover-native-031-coffee-2026-10-12.png` and `discover-native-031-coffee-more-2026-10-12.png`. Maximized viewport differs from the preceding31-card sample, so do not claim an isolated causal benchmark. Anime then showed24/12/0 with a YouTube read failure; this is incomplete platform retrieval, not absence of YouTube videos.

The user's filtering complaint exposed two separate restrictions: two More requests/90 records per platform, plus a24-card display window behind a different reveal button. A quiet More request also permanently set exhaustion. Normal native order had no popularity admission gate; Popular recently applies separate evidence checks.

Helper0.3.3 removes request-count stopping and false quiet exhaustion. Each explicit action seeks30 new canonical posts per platform, with at most three scroll/read cycles and the existing25-second deadline. It advances toward the last collected rendered boundary, handles virtualized overlap, and skips known-prefix cards. It retains the latest300 cards per platform, with `omittedCount` reporting older cards unloaded; subsequent requests keep advancing. The15-minute expiry renews only on explicit More. No new permission, private endpoint, background retrieval or AI upload. Original-document polling fixes return-to-Discover when Chrome withholds the owner tab URL, with bounded focus retention and existing user-interruption safeguards.

The app provides one Load more flow: reveal received matches, then retrieve; newly fetched cards become visible automatically. Counts distinguish shown/loaded and Popular matches, with a return-to-all control and English/Arabic window notice. This is a bounded browsing window, not a claim that platform supply ends at300. Saved references are independent.

Focused validation:124 helper tests across8 files;36 client/hook/component tests;64 translation checks. Final lint, app/Worker typechecks,3,908 unit tests and production build passed. Final full browser suite passed438tests with8intentional skips and0failures after isolating the Instagram-preview fixture from the local network and pinning Studio fixture time. Logs: Temp discover-native-final-push-gates.log and discover-native-final-browser-push.log. Export copied to localhost:3000, matching Discover HTML SHA256 `71C0F5C1C83CED98EB572BB52FE7C164D862A8BD10BCC5DEDB3247F09D3C00C9`. User confirmed Updated0.3.3, then stopped manual Computer Use with Escape; live continuous-loading/return verification remains unfinished. No repeat Update needed. The user subsequently requested commit/push to PR70. Remaining: cached-session continuation, preserving prior successful platform cards on a failed refresh, complete live genre matrix, and grounded visual/recent-trend evaluation.

### Helper 0.3.1 continuation

The user's Chrome **Update** reloaded the preceding unpacked helper corrections. Fresh Coffee returned31 cards (Instagram3/TikTok20/YouTube8); More completed without the false timeout but did not grow. This confirms that background rendering still restricts supply. The app now reuses Discover's existing validated YouTube-ID poster fallback for live and cached native cards. A new production build is served at localhost:3000; actual Chrome verified the cached Coffee YouTube previews, Saved3 intact. Proof: Temp `discover-native-youtube-fixed-2026-10-11.png`.

Helper0.3.1 runs platforms sequentially and briefly activates each owned search tab in the originating window, with the existing25-second platform deadline. User tab/window changes permanently stop switching for that request. Late work after a platform timeout cannot activate a tab; cancellation cannot restore over a newer job. Returning to Discover requires the owned source still active and an unchanged Discover owner URL; if Chrome withholds that URL, restoration is conservatively skipped. No OS-window focusing, new permissions, private APIs or automatic AI uploads. Popup scope copy is updated in English and Arabic. Twenty-two targeted lifecycle tests passed, including tab/window interruption, changed owner and delayed timeout races.

This is a **new** source update requiring one further manual Chrome Update. Its live result growth and return behavior are still pending. No paid searches or model assessments ran. The previous live all-category relevance/trend-adoption gap remains.

### Previous 0.3.0 evidence

User explicitly approved all three optional site grants, manually reloaded helper 0.3.0, and completed the connection. Actual Chrome displayed Chrome connected on localhost:3000. Saved references remained 3; no paid queries or model assessments ran.

- Initial live Anime: 40 cards (Instagram 6, TikTok 22, YouTube 12). A fresh native search returned 34 (6/12/16); native ordering and supply can change between requests.
- Live Coffee: 26 cards (6/12/8). After opening the owned Instagram search tab and requesting More, Instagram grew to 24; TikTok and YouTube retained their counts but reported a read failure. The native Instagram grid exposed 24 post links. This is concrete evidence of delayed/background rendering, not evidence that Instagram contains only six videos.
- Live failures prompted corrections: visible YouTube thumbnails must survive accessibility-hidden duplicate links; the initial collection waits at least eight seconds and four stable seconds; successful no-growth More completes without a false timeout; explicit More scrolls the nearest visible result scroll pane, with document fallback. These corrections require a manual helper reload and further live verification. The initial request never scrolls or activates source tabs.
- Source cards are interleaved and remain visible despite sparse captions. Popular recently retains its independent source/age/craft gates. Native membership alone never becomes a trend or visual-quality receipt.
- Final checks passed: lint, app/Worker type checks, **3,874 unit tests across 197 files**, including **103 helper tests**, fresh production build, and **438 browser tests / 8 intentional skips / 0 failures**. Desktop/phone fixtures cover all 12 categories, platform mixing, sparse captions, low engagement exclusion from Popular, cache reload and Arabic layout. Fixtures are not a live all-category quality audit. Logs: Temp `discover-native-final-gates.log` and `discover-native-final-browser.log`.

Managed export was copied to the primary ignored `out` with matching Discover HTML SHA256 `63A29398CDED8AF40EADAAB019CCECDB9828C3419E6E8E4A5F22953623D467CD`. Port 3000's existing server was preserved. No Worker deployment.

Local proof: Temp `discover-native-coffee-live-2026-10-11.png`; count receipt `discover-native-live-receipt-2026-10-11.json`. Remaining: repeat corrected-helper Chrome tests, verify real More growth and YouTube previews, test the remaining native categories, and measure relevance/current multi-creator adoption separately. Do not claim private recommendation-algorithm parity or optimal trend quality.

### Native results and continuous scrolling — 12 October

The user clarified that category browsing should trust each platform's native search selection and ordering, with no popularity/metadata admission gate, then explicitly requested infinite scrolling. Keep Popular recently optional and evidence-based. Existing native order already retains sparse captions and low engagement; the remaining shortfall is retrieval/continuation.

Actual Chrome via Browser Use recovered after the Windows Escape latch. Fresh Coffee initially returned34 (IG6/TT20/YT8). First More was quiet; second grew to64 (36/20/8); third grew to134 (66/32/36). This confirms growth beyond the old two-request cap and that all three platforms can contribute additional cards. Instagram's own rendered grid exposed24 links while the first app batch still held6. Browser interactions may affect foreground loading, so this is not a controlled background/foreground comparison. Automatic return to Discover is not verified (selected tab after completion was Instagram). Saved3 persisted. Proof: Temp discover-native-033-coffee-134-2026-10-12.jpg.

New local work preserves matching earlier platform cards on failed empty refreshes, with their age and current failure visible; it does not combine other queries. Focused104checks and two browser tests passed; that build was copied to localhost:3000. Next: scroll-triggered loading and cached-session continuation, with no background retrieval or automatic AI uploads. Reuse the existing helper protocol, bounded native cache, React client hooks and IntersectionObserver; no new service or package. Guard automatic requests with continued downward browsing, busy/error state, cancellation and query identity. Keep accessible manual retry. Validation of the final combined changes is pending.