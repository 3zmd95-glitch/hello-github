# Selected native-search results

The user's combined native-search goal remains unfinished. Official/API retrieval has not reproduced native Instagram/TikTok search quality. This optional local Chrome companion offers an explicit route for chosen visible results into the existing combined category library. It does not reproduce a private algorithm or automatically prove trends.

## Reuse decision

Reviewed Chrome's official [activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab) and [scripting](https://developer.chrome.com/docs/extensions/reference/api/scripting) APIs and the open-source [TabSnap](https://github.com/voidd0/tabsnap) exporter. Reuse the native browser APIs and existing app library/source-check pipeline. A broad tab-export dependency is unnecessary for this narrow on-demand operation. No new package, provider, model or paid query.

## Boundaries

- Manifest V3, only activeTab and scripting; no background task or persistent host permissions. The user manually installed and pinned the helper; the installed TikTok pilot is recorded below.
- On explicit capture, accepts only native public search/hashtag routes on fixed TikTok, Instagram and YouTube hosts. Reads visible direct-post anchor URLs; excludes offscreen, hidden and covered links. Maximum 24. No caption, count, hidden JSON, credential, cookie, API request, scrolling or playback.
- Popup selection starts unchecked. Localhost:3000 receives a versioned URL-fragment payload with platform and selected canonical URLs only. Fragments may remain in browser history until the app clears its entry; this is described in the extension README.
- App validates the untrusted payload independently, clears the fragment, requires a category and explicit confirmation, then stores neutral candidate leads. No save/favourite or recommendation preference is written. Existing native source evidence is preserved; category rejection flags stay scoped.
- Source checks run after confirmation through existing bounded queues (18 Instagram/TikTok URLs per platform per candidate set; YouTube needs its configured key). Unchecked/cancelled links trigger no checks. Import counts are retained links, not qualifying edits. Older popular work does not become a current trend.
- Native Instagram post URLs may identify carousels/photos as well as video; the collector cannot infer media type from URL alone. Platform runtime claims require an installed pilot rather than synthetic collector fixtures alone.

## Verification

### Installed TikTok helper pilot — October 11, 2026

The user installed and pinned Chrome extension `eoffjihbiadleilmkaojegcecadmdigf`. On a real native TikTok coffee search, **Find visible links** captured 11 direct video links, all initially unchecked. Selecting two in the popup and choosing **Review in Discover** opened `http://localhost:3000` with exactly those two links in the app's review.

In the app, Coffee was selected and the christianpaulfilm link was unchecked. Confirmation imported only [coffeepetite's post 7663025453136989472](https://www.tiktok.com/@coffeepetite/video/7663025453136989472). Saved inspirations stayed at three. This validates the installed capture, subset selection, review and single-lead import path; it does not establish creative quality or current-trend eligibility.

### Earlier verification

The October 11 native Fashion pilot exposed a date loss: neutral Instagram imports had no publication date, while an indexed date survived a verified Instagram source read. `applyInstagramEvidence` now reuses the existing shared post-ID date reader after exact available-source verification. It fills item/evidence dates, repairs matching cached observations once, preserves newer-source precedence, and never substitutes lookup time for post time. The decoded date must not be later than its source observation. This uses the same established decoder already used by search/trend retrieval, not a new date inference service. Native Chrome independently showed Cku9_F9Bu5J on November 9, 2022 and DZfjUKFIIco on June 12, 2026. Unit and browser regressions distinguish recent imports from incorrectly recent indexed old posts. Final current verification is recorded in the continuation handover; the original import implementation's counts below are historical.

Focused validation passed 58 cases: malformed/mixed/spoofed input, visible-link capture, popup selection/errors, hydration/cancel/no-fetch, no preference mutation and native-evidence retention. Final root suite: 3,358 tests; lint, types and production build passed. Broad browser run passed 412 cases/eight skips, then both new-test failures were resolved in a 50/50 affected discovery rerun. The reload failure exposed a real app bug: retained categories now stay browsable while remote capability checks are unavailable. An import also resets an old platform filter to All. See the continuation handover for exact logs and actual Chrome review/deduplication evidence. No claim that all categories/platforms now have native-equivalent supply.

### Installed Instagram capture and YouTube visibility correction

Native Instagram #fashionfilm returned six visible post links at the smaller Chrome window size. All started unchecked and Review was disabled until selection. No extra import or model action was used.

The installed YouTube pilot initially returned zero despite three visible search videos. Read-only DOM inspection showed a zero-height BODY with `overflow: auto scroll` and HTML overflow visible in both axes. [CSS Overflow 3 §3.3](https://www.w3.org/TR/css-overflow-3/#overflow-propagation) defines overflow propagation from the root/body to the viewport. That box must use the viewport clip already applied by the collector, rather than its empty element rectangle. Real nested clipping, body overflow that does not propagate, hidden CSS/ARIA and overlay checks remain required. No dependency or expanded browser access is needed for this correction. Actual post-fix runtime results are recorded in the continuation handover.

Installed Instagram capture also passed on #fashionfilm: six visible post links, zero selected. Installed YouTube search initially returned zero due to incorrect clipping against its zero-height body. After the viewport-overflow correction, reopening the popup captured all three visible videos (S3JMwz3LCvc, aTC_RNYtEb0, lAd3LYIZMjs), with tracking removed and none selected. Both are capture checks; the TikTok pilot above verifies the full app import. These results do not establish current-trend or creative-quality coverage.
