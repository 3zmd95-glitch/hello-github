# Discover visible links (optional Chrome extension)

This unpacked Manifest V3 extension lets you choose direct post links from the visible area of a public TikTok, Instagram or YouTube search page and review them in your local Discover app. It requires no build step.

## Install and use

1. Start the local application at `http://localhost:3000`.
2. Open Chrome's Extensions page, enable Developer mode, select **Load unpacked**, and choose this `extensions/discover-import` folder.
3. Open TikTok `/search`, Instagram `/explore/search/keyword/` or `/explore/tags/<tag>/`, or YouTube `/results`.
4. Open this extension and select **Find visible links**. The popup starts in Arabic; **English** switches languages.
5. Check the individual links you want and select **Review in Discover**. Confirm the import inside the app.

The extension has not been installed automatically. Installation and each capture are your choice. Remove it from Chrome's Extensions page whenever you no longer want it.

## Scope

- Permissions: `activeTab` and `scripting` only. Access is temporary and initiated through the extension action.
- Capture reads only the active page URL, visible anchor destinations and element visibility. It captures at most 24 distinct direct post links, with tracking parameters removed.
- It only accepts HTTPS public search routes on the exact TikTok and Instagram apex/`www` hosts and YouTube apex/`www`/`m` hosts. Other pages, frames and platforms are excluded.
- Nothing runs in the background. It does not scroll, play media, fetch results, read cookies, read page text or store captures. Closing the popup discards the selection.
- Selected links travel in a URL fragment to `http://localhost:3000/discover/`; the app reviews them before import. Fragments are not part of HTTP requests, but the resulting URL can appear in local browser history.
- Visibility is checked against CSS, the viewport, clipping containers and hit testing. Site layout changes can reduce the links found; this is a visible-link helper, not a complete export or search API.
- Instagram links normalize to `/p/<id>`. The helper cannot determine whether an Instagram search tile is a video from its URL alone; review the post in Discover.

`capture.js` exports a self-contained collector so Chrome can serialize it into its isolated execution world. `capture.test.ts` exercises the collector against synthetic DOM fixtures; it never opens real accounts or websites.

## Installed TikTok runtime check

On October 11, 2026, the user manually installed and pinned extension `eoffjihbiadleilmkaojegcecadmdigf`. A real native TikTok coffee search returned 11 visible direct video links, all initially unchecked. Selecting two in the popup and choosing **Review in Discover** opened the local app at `http://localhost:3000` with exactly those two links.

The app review selected Coffee, unchecked the christianpaulfilm link, and imported only [coffeepetite's post 7663025453136989472](https://www.tiktok.com/@coffeepetite/video/7663025453136989472). Saved inspirations remained at three. This confirms the installed capture and explicit selection/import workflow; it does not prove the post's creative quality or current-trend eligibility.

Installed Instagram capture also passed on #fashionfilm: six visible post links, zero selected. Installed YouTube search initially returned zero due to incorrect clipping against its zero-height body. After the viewport-overflow correction, reopening the popup captured all three visible videos (S3JMwz3LCvc, aTC_RNYtEb0, lAd3LYIZMjs), with tracking removed and none selected. Both are capture checks; the TikTok pilot above verifies the full app import. These results do not establish current-trend or creative-quality coverage.
