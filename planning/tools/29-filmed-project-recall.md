# Completed filming projects — 11 October 2026

## Observed false negative

Native TikTok Coffee search exposed [this public café film](https://www.tiktok.com/@israelllsss0_0/video/7626098740452986119). Its caption says “You let us film your coffee shop and this happened.” The public source read returned 120,700 likes, 1,200,000 views and publication 7 April 2026. Actual Chrome confirmed 120.7K likes, a nineteen-second player and sampled close-up product footage of coffee being poured. This is an older popular reference, not current trend-growth evidence or a full audiovisual review.

The existing classifier returned category=true, creative=false, project=false: the caption describes completed production without an existing craft keyword. The exact public caption/date/counts are a regression fixture, not a hardcoded production seed. A neutral reference was explicitly added through localhost:3000 for the before/after check, with “keep”/More-like-this unchecked. Old frontend: Coffee/TikTok Inspiration remained one, and the reference was absent from its four Explore cards. This intake is not automatic discovery and does not create a personal preference.

## Correction

Reuse the shared category classifier. Completed first-person filming prose can supply generic filmmaking/project evidence when the category occurs in the same sentence. Commission/permission wording also needs a completed-result cue. Arabic production verbs require an explicit video/film/reel/ad noun. Hashtags, URLs, channel biographies, keywords, questions, conditional/future language and negated production do not supply that evidence. Existing sales, ordinary-content, wrong-sport and other exclusions still win. Neither a named technique nor teaching/visual quality is invented. Existing age/source/engagement floors remain; the real post must not enter Popular recently or Learn, and a five-like version must not enter Inspiration.

Focused regressions reproduced eighteen failures before implementation, including the exact native false negative. The corrected focused suite passes 274 tests, with examples across all twelve category subjects, English/Arabic negatives, diacritics and exclusion/ranking cases. One narrow independent review found two additional negation cases, now covered.

Full frozen-source gates passed: **3,300 root tests / 166 files; 1,371 Worker tests / 47 files; lint; app/Worker types; production build; 410 browser tests / eight intentional skips / zero failures**. Log: Temp `discover-filming-recall-gates-2026-10-11.log`. The tested export is copied to primary's ignored `out`, preserving the server and connections.

Actual Chrome after reload: Coffee/TikTok Inspiration increased **one → two**, including the exact café film and its native 1.2M views. Popular remained zero, Learn three, with the benchmark absent from both. Source checks settled. This proves corrected admission of a manually supplied native reference, not automatic acquisition, broad recall accuracy or trend detection. Transient Chrome observation timeouts during the full suite cleared afterward; the preview was not restarted.

## Search-before-building and unresolved media path

Reviewed the current [yt-dlp TikTok extractor](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/tiktok.py), [TikTok video object](https://developers.tiktok.com/docs/en/tiktok-api-v2-video-object) and [official embed player](https://developers.tiktok.com/docs/en/embed-player). Reuse the existing public source reader and classifier for this correction; no downloader or new dependency is needed.

A separate bounded capability check of the short-caption Arabic Coffee benchmark `https://www.tiktok.com/@a.gji0/video/7692546728540589318` returned a matching public page and an eight-second video entry. Its supplied playback URL returned HTTP 403 without credentials. No cookies, private session export, alternate identity, hidden API, or model call was attempted. Do not ship a TikTok frame-checking UI assuming that URL is usable. Existing Instagram frame assessment is unchanged. Caption-poor TikTok evaluation, automatic native-equivalent candidate supply, Instagram coverage and effect/audio growth remain open.
