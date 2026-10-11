# Discover browser helper (optional Chrome extension)

This unpacked Manifest V3 extension lets you choose direct post links from the visible area of a public TikTok, Instagram or YouTube search page and review them in your local Discover app. It requires no build step.

Version 0.3.0 also prepares an optional native-search connection. Existing visible-link and screenshot actions keep their explicit, separate behavior. The new access is inactive until the user chooses **Connect Discover** and grants Chrome's optional permissions. This source update does not install, reload, connect, or grant access to the user's installed extension.

## Optional native search connection (0.3.0)

After reviewing this update and reloading the existing installed extension, open its popup, expand **Connect native search to Discover**, read the scope, and choose **Connect Discover**. Chrome asks for optional access to `https://www.instagram.com/*`, `https://www.tiktok.com/*`, and `https://www.youtube.com/*`. The popup then opens `http://localhost:3000/discover/#discover-helper=<extension-id>`. Declining leaves visible-link import and screenshot capture available.

The connection itself opens no social searches. An explicit search request from Discover opens up to three native public search tabs, inactive so Discover stays in front. The helper reads loaded, rendered public cards from those extension-created tabs: direct post URLs, visible titles/creator labels/displayed statistics, and rendered image URLs or `video.poster`. Blank-caption Instagram reel tiles remain results. Missing titles, images, and statistics remain missing; the helper invents no engagement, publication date, quality, or trend evidence.

- Initial collection is capped at 30 distinct cards per requested platform and retries loading for at most 25 seconds. Below that cap, a nonempty first grid is read for at least eight seconds and until four seconds pass without new cards, allowing later-rendering rows to appear. Initial collection never scrolls. Instagram uses keyword search, TikTok uses `/search`, and YouTube uses `/results`.
- Each explicit **More** request scrolls each owned search page once, collects up to the next cap, and keeps earlier cards if the page virtualizes them. It uses the nearest visible vertical scroll pane containing a validated public result, falling back to the document, and moves at most one viewport. There are at most two More requests and 90 cards per platform. A successful collection with no new cards finishes after four stable seconds and marks that platform exhausted. This is bounded collection from native results; it is not a complete export or a guarantee that the platform has no more results.
- At most three Discover jobs exist at once, with one current job per originating Discover tab. A new search or cancellation closes that tab's previous owned source tabs. Closing the owning Discover tab also cleans them up. Completed source tabs stay open for inspection until the job's 15-minute expiry; Chrome alarms may run late while the browser/device is asleep. Tabs the user navigates elsewhere are left alone.
- `storage.session` holds job ownership, collected card metadata, and expiry only for the browser session. `alarms` schedules expiry across Manifest V3 worker suspension. No cookies, browser history, other existing tabs, private routes, hidden application state/script JSON, media URLs, video frames, audio, or private network endpoints are read. No video playback is initiated. The screenshot workflow below remains a different explicit action.
- The external-message allowlist is `http://localhost/*` because Chrome match patterns do not encode a port. Every message additionally requires the exact `http://localhost:3000` origin and `/discover/` path, the top frame when frame ID is supplied, and a browser tab sender. Jobs are bound to that tab and, when available, its document ID. Polling another tab's job is rejected.
- Login/challenge surfaces and navigation away from the requested search return **needs attention**; the helper never signs in, bypasses a challenge, or navigates an unrelated tab. Search URL comparison accepts harmless slash/query encoding or tracking normalization but requires one exact requested search term on the same allowed public route.

The native protocol uses `version: 1` with `status`, `search`, `poll`, `more`, and `cancel`. A search includes a bounded `requestId` and 1–3 `queries` keys (`ig`, `tt`, `yt`, each 1–120 characters). Search returns a job ID; poll/more/cancel return job status, a `hasMore` boolean, and per-platform `loading`, `done`, `empty`, `needs-attention`, or `error` states with collected cards and the public source search URL. All returned card positions describe observed ordering; `observedAt` is collection time, not publication time.

Native protocol, rendered-card collection, popup permission requests, tab ownership, cancellation, loading timeouts, More limits, restart/expiry cleanup, and preserved legacy actions are covered by synthetic tests. Native connected-search activation and platform behavior still require a separately authorized installed-browser check.

## Install and use

1. Start the local application at `http://localhost:3000`.
2. Open Chrome's Extensions page, enable Developer mode, select **Load unpacked**, and choose this `extensions/discover-import` folder.
3. Open TikTok `/search`, Instagram `/explore/search/keyword/` or `/explore/tags/<tag>/`, or YouTube `/results`.
4. Open this extension and select **Find visible links**. The popup starts in Arabic; **English** switches languages.
5. Check the individual links you want and select **Review in Discover**. Confirm the import inside the app.

Installation and each capture are your choice. Remove it from Chrome's Extensions page whenever you no longer want it. The links-only version is already installed and tested in the development user's Chrome; do not repeat that installation.

## Link collection scope

- This action uses `activeTab` and `scripting`. Its access is temporary and initiated through the extension action; it does not require the new optional host access.
- Capture reads only the active page URL, visible anchor destinations and element visibility. It captures at most 24 distinct direct post links, with tracking parameters removed.
- It only accepts HTTPS public search routes on the exact TikTok and Instagram apex/`www` hosts and YouTube apex/`www`/`m` hosts. Other pages, frames and platforms are excluded.
- This links-only action does not run in the background, scroll, play media, fetch results, read cookies, read page text or store captures. Closing the popup discards its selection. Optional connected search is described separately above.
- Selected links travel in a URL fragment to `http://localhost:3000/discover/`; the app reviews them before import. Fragments are not part of HTTP requests, but the resulting URL can appear in local browser history.
- Visibility is checked against CSS, the viewport, clipping containers and hit testing. Site layout changes can reduce the links found; this is a visible-link helper, not a complete export or search API.
- Instagram links normalize to `/p/<id>`. The helper cannot determine whether an Instagram search tile is a video from its URL alone; review the post in Discover.

`capture.js` exports a self-contained collector so Chrome can serialize it into its isolated execution world. `capture.test.ts` exercises the collector against synthetic DOM fixtures; it never opens real accounts or websites.

## Optional TikTok video screenshots (0.2.0)

The separate **Review a TikTok video** panel supports an explicit screenshot of each chosen moment, using the existing `activeTab` permission. It does not automatically capture anything. This expands the helper beyond links: confirm the screenshot workflow with the user before activating the update on their social pages.

1. Open a public TikTok post itself, with its video fully visible and playing. Videos up to 90 seconds are supported.
2. Open the helper's video panel and click **Capture this moment** for each of two to eight distinct moments, in playback order. Keep the popup open; closing it discards unsaved captures. The helper does not play, pause, seek or scroll for you. After playback loops, discard and start again.
3. Inspect the local previews, then **Save capture file**. Only cropped video images, the public post URL, approximate playback positions and capture dates enter this JSON file. Discard the capture if another person's overlay or unrelated content appears in the preview.
4. **Open Discover** opens `http://localhost:3000/discover/#video-capture`. Choose the saved file and category, and review the images again.
5. Only **Check with ChatGPT** sends the images and public source context to the explicitly selected connected model. Importing or opening the panel sends no images and changes no feed. A successful assessment can add evidence for that exact post/category; existing source, engagement and recency gates still apply.

Chrome briefly supplies a screenshot of the visible tab. The helper immediately crops it to the detected player and keeps only that crop. It checks the active tab, post identity and player geometry before and after capture; ambiguous/hidden/partly visible players and detected overlays are rejected. No cookies, media URLs, private network requests, scrolling, background collection or additional extension permissions are used. The screenshot cannot prove original-media authenticity, motion, audio or current popularity. Dates/positions are capture metadata, not a verified full-video timeline.

Images remain in popup/app memory until explicitly saved or sent; they are not persisted in the app's candidate store. The selected assessment stores hashes and evidence, with **browser screenshot** provenance, never an invented original-video hash. Keep the downloaded capture file private if it contains personal content. Unit and browser fixtures are synthetic; installed native capture validation is recorded separately once authorized.

## Installed TikTok runtime check

On October 11, 2026, the user manually installed and pinned extension `eoffjihbiadleilmkaojegcecadmdigf`. A real native TikTok coffee search returned 11 visible direct video links, all initially unchecked. Selecting two in the popup and choosing **Review in Discover** opened the local app at `http://localhost:3000` with exactly those two links.

The app review selected Coffee, unchecked the christianpaulfilm link, and imported only [coffeepetite's post 7663025453136989472](https://www.tiktok.com/@coffeepetite/video/7663025453136989472). Saved inspirations remained at three. This confirms the installed capture and explicit selection/import workflow; it does not prove the post's creative quality or current-trend eligibility.

Installed Instagram capture also passed on #fashionfilm: six visible post links, zero selected. Installed YouTube search initially returned zero due to incorrect clipping against its zero-height body. After the viewport-overflow correction, reopening the popup captured all three visible videos (S3JMwz3LCvc, aTC_RNYtEb0, lAd3LYIZMjs), with tracking removed and none selected. Both are capture checks; the TikTok pilot above verifies the full app import. These results do not establish current-trend or creative-quality coverage.
