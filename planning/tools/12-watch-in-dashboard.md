# 12 · ▶ Watch here: play the video inside the dashboard

Owner, round 32 (Sep 29, 2026, with a screenshot of Discover's Instagram cards showing the camera tile): "why instagram doesn't
show thumbnail plus i want to watch the video in my dashboard". Built on the research cards of `components/research/`.

## What it does

**October 4 update:** The owner's renewed request for Instagram thumbnails supersedes the earlier
placeholder-only decision below. Missing and expired pictures now request a bounded public Open Graph
preview through Scout; private, blocked, and unavailable posts keep the poster. This is best-effort public
page metadata, not a supported Meta thumbnail API. See `14-instagram-previews.md` for scope and validation.

1. Every card that is one post of YouTube, TikTok or Instagram has a **▶** : the picture of a full card (Discover, the skill
   Research panel, the "Most viewed this week" row), and a small ▶ button on a saved reference in the skill sheet.
2. ▶ opens **one player sheet** over the page (from the bottom on the phone, centred on desktop) with the platform's own
   player. ✕, Escape, a tap outside or Back close it, and closing stops the sound. It opens over the skill sheet too, and
   closing it leaves the skill sheet open.
3. Under the player: "open on YouTube / TikTok / Instagram ↗" (always there), a one-line note where a platform needs one,
   and a line saying the platform's own player knows you watched.
4. A video that will not play here says so ("can't play here" or "removed or private") with the open link, and no frame.
5. An Instagram card without a picture shows a **poster tile** instead of the camera: ▶, the @handle, the first line of the
   caption, and "Instagram gives no preview image. Tap to watch."

## Why Instagram cards have no picture

| Route | Result (checked live on Sep 29, 2026) | Decision |
| --- | --- | --- |
| Meta oEmbed `thumbnail_url` | Removed on 2025-11-03 (with `author_name`). The endpoint is tokenless since 2026-06-15 but still returns no picture | Not available |
| `/p/<code>/media/?size=l` | Needs a login | Rejected |
| `og:image` of the post page, read by the Worker | Scraping: robots.txt disallows everything and the terms forbid automated collection | Rejected |
| The image inside the public `/embed/` page, read by the Worker | Same, and the CDN URL dies in about four days | Rejected |
| One `/embed/` frame per card as the picture | Ten Instagram frames on a phone page, each with Meta's cookies | Rejected |
| Third-party unfurlers (Iframely, Microlink) | They do the scraping for us | Rejected |
| The search provider's image | Used when it comes, never saved | Kept as it was |
| Graph API `thumbnail_url` for the owner's **own** posts | Allowed with his token | Later |

So there is no permitted, stable picture for someone else's Instagram post. The poster tile says that honestly; the player
shows the post on tap.

## Search before building (2026-09-29, three research agents, facts verified live)

| Find | Fit | Decision |
| --- | --- | --- |
| Three plain iframes written by us (`lib/embed.ts`, `components/player/`) | No dependency, no platform script in our origin | **Adopted** |
| [react-player](https://github.com/cookpete/react-player) 3.4 | Pulls ten media packages, loads `youtube.com/iframe_api`, no Instagram, its TikTok part ignores player errors | Rejected |
| [react-social-media-embed](https://github.com/justinmahar/react-social-media-embed), `@lite-embeds/*`, react-tiktok, react-instagram-embed | They inject `embed.js` of Instagram / TikTok into our page | Rejected |
| [react-lite-youtube-embed](https://github.com/ibrahimcesar/react-lite-youtube-embed), lite-youtube-embed, `@next/third-parties` YouTubeEmbed, react-youtube | YouTube only; the facade idea (nothing loads before the tap) is what we do | Reference |
| youtube-video-element / tiktok-video-element (Mux) | Custom elements over the same iframes | Reference |
| YouTube IFrame API script | Gives error events, but runs Google's script in our origin | Rejected; the oEmbed pre-check and a 10 s "slow" line replace it |
| TikTok / Instagram `blockquote` + `embed.js` | Platform script in our origin, a card around the video, no documented events | Rejected |
| Native `<dialog>` | Would work; the app's sheets already share one contract | Reference |

## Design

- **No platform script in our origin.** The owner's tokens live in this origin's storage. The players run in their own
  frames; nothing loads from a platform before the ▶ tap.
- **Frames** (`lib/embed.ts`): YouTube `https://www.youtube-nocookie.com/embed/<id>?autoplay=1&playsinline=1&rel=0&hl=<ar|en>`,
  TikTok `https://www.tiktok.com/player/v1/<id>?autoplay=1&rel=0&description=1&music_info=1`, Instagram
  `https://www.instagram.com/p/<code>/embed/`. The same attributes on all three, one entry per platform so one can be
  loosened alone: `sandbox="allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox"`,
  `allow="autoplay; encrypted-media; fullscreen; picture-in-picture"`, `referrerPolicy="strict-origin-when-cross-origin"`
  (never `no-referrer`: YouTube answers error 153).
- **Pre-check** from the browser, tokenless, 4 s at most, never stored: YouTube oEmbed (200 plays, `width < height` means a
  Short, 401 embedding is off, 400 / 404 gone) and Instagram's Graph oEmbed (400 with subcode 2207045 means it will not
  embed). Any other outcome mounts the frame anyway. TikTok has none: its player reports errors itself.
- **Messages from the frames**: accepted only from the player's own origin **and** the sheet's own frame. Instagram's
  `MEASURE` sets the frame height (200 to 2000 px). TikTok's `onPlayerError` replaces the frame with the message (its
  autoplay error 3002 is ignored: the video is fine and TikTok's own button starts it); after it starts playing, one
  `unMute` is posted to it with TikTok's origin as the target.
- **The sheet** (`components/player/PlayerSheet.tsx`): layer z-60, over the skill sheet and the post popup (z-40) and
  ConfirmDialog (z-50), under the celebrations (z-80). Escape is taken on `window` in the capture phase so the sheet
  underneath stays open. Back closes it (`useBackToClose`: one history entry while it is open). Nothing of ours sits on the
  video (YouTube's rules); the player keeps at least 200 px on each side.
- **Cards** (`components/research/ResultCard.tsx`): the full card's picture is the ▶ button (at least 236 × 133 px).
  A saved reference keeps its small picture as a picture and gets a separate ▶ button, because YouTube asks that a thumbnail
  that starts playback be at least 120 × 70. The Instagram poster shows only for a post that can play, in the app's own
  colours (no Instagram logo or gradient); the handle shows only when it starts with "@".
- **CSP** (`app/layout.tsx`): `frame-src` for the three players' hosts, `object-src 'none'`, `base-uri 'self'`. A new
  frame host (Cal.com, Bunny Stream) must be added there. Never add COEP: Instagram's embed is `CORP: same-origin`.

## Limits, said honestly

- **Instagram needs two taps**: the card, then the play button inside Instagram's frame. Its embed forbids autoplay.
- **TikTok may show its own cookie question** inside the player the first time, and starts muted until it plays.
- **Some videos refuse embedding** (the uploader turned it off, age limits, private or removed posts).
- **iPhone Safari is not verified.** The research and the tests ran in desktop Chromium and its phone emulation. The first
  real test is the owner's phone: YouTube with sound, the TikTok cookie question, the Instagram second tap.
- Instagram's `/embed/` address and its `MEASURE` message are what Meta's own `embed.js` uses, not a documented API: the
  frame has a fixed height until a message comes, and the open link is always there.
- Escape pressed while the focus is inside a player never reaches our page (another origin); ✕, a tap outside and Back work.

## Privacy (for the privacy page, when it is written)

Nothing from YouTube, TikTok or Instagram loads until you tap ▶. After the tap, that platform's own player loads in a frame:
the platform receives your IP address, browser details, the site's origin (not the page) and the video id, and may set
cookies or ask for cookie consent under its own policy. YouTube runs in privacy-enhanced mode.

## Owner's part

1. Nothing to set up: no key, no account, no Worker change.
2. After it is live, try one video of each platform **on your iPhone** and say what happens.

## Later

- ▶ on the Trend Radar's rows.
- Pictures for the owner's own Instagram posts through the Graph API.
- `status.embeddable` from the Worker's `videos.list`, so a card that cannot play says so before the tap.
- One shared `blockPlatforms` helper for the e2e specs (three copies today).
