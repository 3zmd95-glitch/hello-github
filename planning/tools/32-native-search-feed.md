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

User explicitly approved all three optional site grants, manually reloaded helper 0.3.0, and completed the connection. Actual Chrome displayed Chrome connected on localhost:3000. Saved references remained 3; no paid queries or model assessments ran.

- Initial live Anime: 40 cards (Instagram 6, TikTok 22, YouTube 12). A fresh native search returned 34 (6/12/16); native ordering and supply can change between requests.
- Live Coffee: 26 cards (6/12/8). After opening the owned Instagram search tab and requesting More, Instagram grew to 24; TikTok and YouTube retained their counts but reported a read failure. The native Instagram grid exposed 24 post links. This is concrete evidence of delayed/background rendering, not evidence that Instagram contains only six videos.
- Live failures prompted corrections: visible YouTube thumbnails must survive accessibility-hidden duplicate links; the initial collection waits at least eight seconds and four stable seconds; successful no-growth More completes without a false timeout; explicit More scrolls the nearest visible result scroll pane, with document fallback. These corrections require a manual helper reload and further live verification. The initial request never scrolls or activates source tabs.
- Source cards are interleaved and remain visible despite sparse captions. Popular recently retains its independent source/age/craft gates. Native membership alone never becomes a trend or visual-quality receipt.
- Final checks passed: lint, app/Worker type checks, **3,874 unit tests across 197 files**, including **103 helper tests**, fresh production build, and **438 browser tests / 8 intentional skips / 0 failures**. Desktop/phone fixtures cover all 12 categories, platform mixing, sparse captions, low engagement exclusion from Popular, cache reload and Arabic layout. Fixtures are not a live all-category quality audit. Logs: Temp `discover-native-final-gates.log` and `discover-native-final-browser.log`.

Managed export was copied to the primary ignored `out` with matching Discover HTML SHA256 `63A29398CDED8AF40EADAAB019CCECDB9828C3419E6E8E4A5F22953623D467CD`. Port 3000's existing server was preserved. No Worker deployment.

Local proof: Temp `discover-native-coffee-live-2026-10-11.png`; count receipt `discover-native-live-receipt-2026-10-11.json`. Remaining: repeat corrected-helper Chrome tests, verify real More growth and YouTube previews, test the remaining native categories, and measure relevance/current multi-creator adoption separately. Do not claim private recommendation-algorithm parity or optimal trend quality.
