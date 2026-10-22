# Instagram card previews — October 4, 2026

Request: “Instagram thumbnail not showing like others.” The shared ResultCard only refreshed TikTok;
Instagram kept its placeholder whenever Tavily supplied no picture.

## Decision and research

- Keep provider pictures. Fetch missing or expired Instagram public-post previews through authenticated
  Scout `/oembed`; share one lookup across cards and saved references per Scout configuration/session.
- [Tavily's Search API](https://docs.tavily.com/documentation/api-reference/endpoint/search) supports
  per-result images, and both existing search pipelines already enable them. No new Tavily call is needed.
- Adopt [htmlparser2](https://github.com/fb55/htmlparser2), MIT, for streaming HTML parsing rather than
  matching metadata with regex. It handles entities, comments, scripts, and chunk boundaries.
- This replaces the earlier rejection of reading public `og:image` in plan 12. It is not an official or
  guaranteed Meta API: platform restrictions, missing metadata, private posts, and expiring CDN links can
  still prevent previews. No login, cookies, private endpoints, or third-party unfurling service is used.

## Implementation

Fetch only canonical `https://www.instagram.com/p/<id>/` URLs, never profiles or arbitrary hosts. Identify
Scout using its own User-Agent (an empty User-Agent redirects to `/unsupportedbrowser`). Reject redirects,
require matching `og:url`, allow only HTTPS Instagram/Facebook CDN images, stop after metadata or 128 KiB,
and abort after five seconds. Cache success for one hour and absence for five minutes. Lookup happens
outside search, without Tavily credits. The fallback says “Preview unavailable. Tap to watch.” in Arabic
and English. Existing provider images refresh once after failure; a second failure keeps the fallback.

Wrangler's generated bundles are excluded from ESLint; application/Worker source remains fully linted.

## Validation

Automated tests cover canonical URLs, host restrictions, metadata validity, streaming limits, cancellation,
timeouts, caching, authentication, missing/expired card previews, shared lookups, and broken-image fallback.
Browser regression covers visible Instagram previews and unavailable-post fallback on phone and desktop.
Live local Wrangler check: public post `DUn3xkSiATH` returned a preview in 612 ms; its CDN image returned
HTTP 200, `image/jpeg`, and `Cross-Origin-Resource-Policy: cross-origin`. A cached repeat took 412 ms.
This verifies the local Worker with live Instagram, not production Cloudflare egress.

Lint (zero warnings/errors), app and Worker typechecks, 1,493 unit tests (including 495 Worker tests),
and static production build passed. The Worker suite also passed independently. Browser results: 247
passed, 3 existing skips across phone/desktop. The first full run passed 245 and caught two new-test fixture
assertions counting an unrelated TikTok pick; isolating the picks fixture and rerunning the two Instagram
cases passed. No application code changed after the full run.

## October 6 update: previews from this computer

Request: "why instagram doesnt show thumbnail" (Discover cards showed "Preview unavailable. Tap to watch.").

Evidence:
- **The Worker is often turned away.** Over 24 hours the Worker's reads of Instagram post pages got 66 answers (2xx) and 46 redirects (3xx). Instagram turns away about 4 in 10 lookups from Cloudflare's network.
- **When they do answer, previews work.** A later lookup of the same 8 posts returned all 8 pictures (`scontent-zrh1-1.cdninstagram.com`), and the cards showed them.
- **Misses stick.** A miss is cached for 5 minutes on the Worker, and before this change the card kept the miss for the whole session.
- **This computer is not turned away.** The same posts read from here with the same request (Scout's User-Agent, no redirects followed) returned HTTP 200 with `og:image` and a matching `og:url`, 4 of 4.

Decision (the owner chose "Use my computer"):
- **The local server reads previews.** With `pnpm local` it serves `GET /api/local-ai/instagram-preview?url=` (header `X-Local-AI: 1`, its usual Host/Origin checks). The read uses the Worker's own `lookupInstagramPreview` over this computer's connection, so no login, cookies or scripts are involved.
- **Caching and limits.** A preview found is kept 1 hour, a miss 5 minutes. At most 500 posts are kept and 120 reads are allowed a minute.
- **Instagram cards ask the local server first.** On localhost they try the local server, then the Worker when it has no picture or there is no local server: the website, or a phone.
- **A miss is retried.** It is forgotten after 5 minutes, and a card still showing asks once more.
- **Shared code.** `lookupInstagramPreview` takes any `{ waitUntil }` context (a Worker's `ExecutionContext` by shape), so the local server can import it.
