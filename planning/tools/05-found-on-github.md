# 05 · Found on GitHub (search-before-building log)

Owner's rule: search GitHub, libraries and Claude skills before building. This file logs what was found and what we did with it.

## 2026-09-27 · first pass (Sprint 1 done, Research button in progress)

| Area | Find | Decision |
|---|---|---|
| Web push for the PWA (Sprint 3) | [piro0919/next-push](https://github.com/piro0919/next-push): Web Push for Next.js App Router with React hooks, VAPID sender, service-worker helpers, runs on Cloudflare Workers | **Adopt candidate** for Sprint 3 instead of wiring `web-push` by hand. Verify it works with static export + a Worker sender. |
| PWA + push templates | [noowxela/nextjs-pwa-boilerplate](https://github.com/noowxela/nextjs-pwa-boilerplate) (static UI option for GitHub Pages), [bcanfield/nextjs-pwa-webpush-template](https://github.com/bcanfield/nextjs-pwa-webpush-template) | Reference only; our shell already exists. Copy the subscription flow pattern. |
| Cloudflare push scheduling | [Cloudflare Agents: push notifications](https://developers.cloudflare.com/agents/communication-channels/webhooks/push-notifications/) | Reference for the reminder cron on Workers. |
| Obsidian bridge (Sprint 4) | [wandermyz/obsidian-github-sync](https://github.com/wandermyz/obsidian-github-sync): syncs a vault with a GitHub repo over the REST API, **works on iPhone** (no git binary) | **Adopt candidate** over the Obsidian Git plugin, because the owner writes on the phone too. The dashboard then reads the vault repo via webhook. |
| Obsidian → webhook | [Masterb1234/obsidian-post-webhook](https://github.com/Masterb1234/obsidian-post-webhook): sends a note (with frontmatter) to any webhook | **Adopt candidate** for "send this note as research for skill X" without a full vault sync. Simple first step. |
| Skill tree UI | [andrico1234/beautiful-skill-tree](https://github.com/andrico1234/beautiful-skill-tree), [hazu100/interactive-skill-tree-builder](https://github.com/hazu100/interactive-skill-tree-builder) (ReactFlow) | Rejected for the map: our map is a custom pixel world of six continents. Useful as reference for unlock/hover interactions. |
| Gamified habit trackers | [nalugala-vc/HabitQuest](https://github.com/nalugala-vc/HabitQuest) (Flutter; XP, badges, offline-first), [Xuerns/HabitStreak](https://github.com/Xuerns/HabitStreak) (UI upgrades across 6 visual tiers), [photkosee/task-a-gotchi](https://github.com/photkosee/task-a-gotchi) (avatar-based), [gamified-productivity topic](https://github.com/topics/gamified-productivity) | Rejected as code (different stacks). Ideas kept: HabitStreak's "UI itself upgrades with the streak" matches our evolving film set. |
| Claude skills | Searched the account's skills for YouTube, TikTok, Instagram, Obsidian, Supabase, Cloudflare, PWA, pixel art | None found. |

## 2026-09-27 · TikTok / Instagram search (round 24)

| Area | Find | Decision |
|---|---|---|
| Site-filtered web search | [Google Custom Search JSON API](https://developers.google.com/custom-search/v1/overview): closed to new customers, ends 2027-01 | Rejected. |
| Site-filtered web search | [Brave Search API](https://brave.com/search/api/): free tier removed for new users in 2026, card required | Rejected for now. |
| Site-filtered web search | [Tavily](https://docs.tavily.com/documentation/api-credits): 1,000 credits/month free, no card, `include_domains` | **Adopted** behind the Scout Worker. |
| Unofficial TikTok APIs | [davidteather/TikTok-Api](https://github.com/davidteather/TikTok-Api) (Python + browser), [szdc/tiktok-api](https://github.com/szdc/tiktok-api) | Rejected: need a headless browser/server, break with platform changes, terms risk. |
| Scraping (owner suggestion) | [D4Vinci/Scrapling](https://github.com/D4Vinci/Scrapling): Python adaptive scraper with stealth browser fetching, CLI and MCP server | Reference, not adopted for TikTok/Instagram (login walls, anti-bot, terms risk, needs Python + a browser process, cannot run in the static app or on a Worker). Possible later use: extracting written guides for the AI Scout if Tavily's page content is too thin; its MCP server for personal research sessions. |
| Web push (Next.js) | [piro0919/next-push](https://github.com/piro0919/next-push) | Still the Sprint 3 candidate; the Scout Worker becomes the sender. |

## 2026-09-28 · in-app Notes (Research quest without leaving the dashboard)

| Area | Find | Decision |
|---|---|---|
| Markdown rendering | [remarkjs/react-markdown](https://github.com/remarkjs/react-markdown) v10 (MIT) + [remark-gfm](https://github.com/remarkjs/remark-gfm) v4 (MIT) | **Adopted.** Builds React elements, never raw HTML (safe for pasted text); GFM tables and task lists; each block gets `dir="auto"` so Arabic and English paragraphs sit right in one note. |
| `[[wiki links]]` | [landakram/remark-wiki-link](https://github.com/landakram/remark-wiki-link) (last release 2023) | Rejected: stale against the current micromark stack. A 30-line pre-pass in `lib/notes.ts` rewrites `[[Skill name]]` / `[[id\|label]]` into links (code spans skipped) and powers backlinks. |
| Markdown editors | [@uiw/react-md-editor](https://github.com/uiwjs/react-md-editor), Milkdown, Tiptap, CodeMirror 6 | Rejected for v1: heavy bundles, RTL caret/IME quirks with Arabic on iPhone. A plain `<textarea dir="auto">` with Write/Read tabs does the job; revisit CodeMirror if live preview is wanted. |
| Obsidian-like web apps | [DaveHomeAssist/noteforge](https://github.com/DaveHomeAssist/noteforge) (vanilla JS: wikilinks, backlinks, graph), [classicrob/obsidian-at-home](https://github.com/classicrob/obsidian-at-home) | Reference only (different stacks). Ideas kept: backlinks panel now; tags and a link graph later. |
| Graph view | [d3/d3-force](https://github.com/d3/d3-force) v3 (ISC) | **Adopted** (2026-09-28) for the layout only; drawn as our own SVG in the pixel style, islands as hubs. Rejected [react-force-graph](https://github.com/vasturiano/react-force-graph) (canvas, heavy, hard to style and to label in Arabic). |
| `[[` suggestions | [component/textarea-caret-position](https://github.com/component/textarea-caret-position) (`textarea-caret`, MIT) | **Adopted**: caret line position for the suggestion list; the list itself is ours (listbox, arrows/Enter/Tab/Esc, tap). |
| Images in notes | [jakearchibald/idb-keyval](https://github.com/jakearchibald/idb-keyval) v6 (Apache-2.0) | **Adopted**: pictures go to IndexedDB (localStorage is ~5 MB), shrunk to 1600 px WebP/JPEG; the note holds `![alt](img:<id>)`. |
| Live preview | [@uiw/react-codemirror](https://github.com/uiwjs/react-codemirror) / CodeMirror 6 live-preview decorations | Deferred: v1 "⚡ Live" shows the formatted note beside the editor (under it on phones). Obsidian-style in-place hiding of the Markdown marks needs CodeMirror; revisit if wanted. |
| Obsidian sync (round 6 plan) | wandermyz/obsidian-github-sync, obsidian-post-webhook (above) | **Parked.** The owner asked to write notes inside the dashboard. Each note downloads as `.md`, so an Obsidian vault can still import them. |

## 2026-09-28 · auto-posting everywhere (round 28, "like Metricool")

| Area | Find | Decision |
| --- | --- | --- |
| Hosted schedulers with an API | Metricool (API on Advanced, ~$53/mo), Ayrshare ($149/mo), Publer (Business), Upload-Post (10 free/mo) | Rejected: monthly cost for one creator. |
| Unified APIs | [Zernio (ex-Late)](https://zernio.com/pricing): 2 accounts free, then $6/account, posts to Snapchat Public Profiles; [Buffer API](https://support.buffer.com/en-us/articles/what-is-buffers-api-GtIYIQilz5): free plan has API access, no app audits | **Later candidates**: Zernio for Snapchat, Buffer as the fallback if the YouTube/TikTok audits are refused. |
| Self-hosted OSS | [gitroomhq/postiz-app](https://github.com/gitroomhq/postiz-app) (AGPL; Postgres + Redis + Temporal), [Mixpost](https://mixpost.app) (Laravel; Pro for IG/TikTok/YT/Threads) | Rejected: cannot run on the free Cloudflare Worker. |
| Workers-native | [deepakness/cogsend](https://github.com/deepakness/cogsend) (MIT; Workers + D1 + R2 + cron; Threads/X/LinkedIn/Bluesky) | Reference for the architecture; not adopted (no IG/TikTok/YT, R2 needs a card). |
| Claude plugins / MCP | Postiz, Ayrshare, Post Bridge, PostZen, Buffer, Metricool MCP servers | None fits: they wrap paid services. |
| Direct official APIs | Instagram content publishing, Threads publishing, YouTube resumable upload, TikTok Content Posting API | **Adopted** in the Scout Worker (`07-auto-posting.md`). |

## 2026-09-28 · Trend Radar and post-everywhere v2 (round 30)

Full tables with links, verification notes and reasons are in `08-trends.md`; the headline decisions:

| Area | Find | Decision |
| --- | --- | --- |
| Google trends | Google Trends "Trending now" RSS (`geo=SA`) and the page's `batchexecute` RPC (`i0OFE`); [dariomory/trendflow-js](https://github.com/dariomory/trendflow-js) (MIT) documents the RPC | **Adopted** (hand-written ~60-line client in the Worker, RSS fallback); trendflow, [flack0x/trendspyg](https://github.com/flack0x/trendspyg), trendspy as references; pytrends and pat310/google-trends-api rejected (dead) |
| YouTube | `videos.list chart=mostPopular` (a music / movies / gaming chart since July 2025) + capped keyword `search.list` | **Adopted**, labelled "charts" |
| TikTok | Creative Center (SA region) · its JSON endpoint · [shannawuu/trendscraper](https://github.com/shannawuu/trendscraper), lofe-w, stia-mora, davidteather/TikTok-Api · Apify actors · Marketing API `discovery/trending_list` · [kworb.net](https://kworb.net/charts/tiktok/sa.html) sounds | Manual deep link adopted; JSON/scrapers rejected (browser-minted headers, terms); Apify and Marketing API candidates v2; kworb adopted with attribution pending the owner |
| Instagram / Threads | In-app trending audio · weekly trend blogs via Tavily · Threads `keyword_search` · `ig_hashtag_search` · oEmbed · Meta Content Library | Ritual card + Tavily scan adopted; Threads keyword search candidate (scope now, App Review after the CR); the rest rejected or deferred |
| X / Snapchat | trends24.in · getdaytrends · xtrends · X API · Snapchat Trends | trends24 candidate (owner OK needed); getdaytrends manual only (terms); X API and Snapchat rejected |
| Aggregators / MCP | [sansan0/TrendRadar](https://github.com/sansan0/TrendRadar), [newsnow](https://github.com/ourongxing/newsnow), [Trends MCP](https://github.com/trendsmcp-ai/Trends-MCP), vidIQ MCP, n8n templates, Action-to-JSON repos | Architecture references only; Trends MCP candidate; nothing adopted as code |
| Media hosting (posting) | Backblaze B2 (10 GB free, no card, S3 presigned PUT via [aws4fetch](https://github.com/mhart/aws4fetch)) · Cloudflare R2 (card) · Supabase Storage (50 MB cap) · UploadThing (2 GB) · Uploadcare · Bunny · Cloudinary · GitHub Releases (302 redirect) · Drive (rejected by Meta) | **B2 adopt candidate** (owner decision); R2 if a card is acceptable; others rejected or fallbacks |
| X posting | X API pay-per-use (card) · Buffer free-plan API (3 channels, 3,000 req/30 d) | Buffer candidate (owner decision) |
| Snapchat posting | Public Profile API (partner-only) · Zernio (Snapchat beta-locked, 403) | Manual; re-check monthly |
## 2026-09-29 · auto-replies (round 30, "automatic comments like Beacons")

| Looked at | Found | Decision |
| --- | --- | --- |
| Self-hosted Instagram comment → DM bots | [AutoDMX](https://github.com/Aditya5688/AutoDMX), [open-autodm](https://github.com/andaveti42-cmyk/open-autodm), [instagram-dm-automation](https://github.com/ElAmir-Mansour/instagram-dm-automation), [ig-automation](https://github.com/elmlahym-wq/ig-automation) | Reference for the flow (keyword → public reply → private reply). Not adopted: all need a server + database and Meta webhooks (Live app with Advanced Access); ours polls from the free Worker's cron with KV. |
| Hosted | ManyChat, LinkDM, Beacons Smart Reply ($10–15/month) | Beacons' builder copied field by field (`10-auto-replies.md`). |
| Direct official API | Instagram comments + private replies (`/{comment-id}/replies`, `/{ig-user-id}/messages` with `comment_id`) | **Adopted** in the Scout Worker (`replies.ts`). |

## 2026-10-03 · auto replies v2 (round 34, "I want our version")

| Looked at | Found | Decision |
| --- | --- | --- |
| Workers comment → DM projects | [chatmany](https://github.com/ryanlaiyanip-ctrl/chatmany), [ig-comment-dm](https://github.com/CharanMN7/ig-comment-dm), [ig-autodm-worker](https://github.com/aldoprianandi/ig-autodm-worker), [ig-harness-oss](https://github.com/Shudesu/ig-harness-oss) (all MIT, 2026, D1) | Reference for logic only (new, few users, D1 and their own dashboards). Details in `14-auto-replies-v2.md`. |
| Hosted | ManyChat (Free / $17 / $39 a month), Metricool Flows (from $20 a month), Meta Business Suite automations (free) | ManyChat and Beacons are the feature and UX models; Business Suite is Plan B if the Live test fails. ManyChat's follow gate is not copied (Meta's like/share-gating rule). |

## 2026-09-29 · Discover by edit genre (round 31)

Full table in `11-discover-genres.md`. Short form:

| Area | Find | Decision |
| --- | --- | --- |
| Engagement counts | [yt-dlp `parse_count`](https://github.com/yt-dlp/yt-dlp) (Unlicense), [@internationalized/number](https://github.com/adobe/react-spectrum) (Apache-2.0) | Reference; `parseEngagement` is hand-written in the Worker (Arabic digits, ألف / مليون, "N likes, M comments") |
| Engagement counts | js-abbreviation-number, anynum, arabic-digits, human-format, numbro | Rejected |
| Most viewed by genre | YouTube `search.list order=viewCount` + `videos.list` statistics | **Adopted** |
| Most viewed by genre | TikTok Creative Center industry filter · Trends MCP · Apify actors · open datasets | Manual link / rejected / none found |
| Genre lists | YouTube categories · TikTok industries · [IAB Content Taxonomy 3.1](https://github.com/InteractiveAdvertisingBureau/Taxonomies) · CapCut template categories | Reference (our 12 map onto them; edit style is a later second axis) |
| Ready-made genre search | TubeAlfred, UnifAPI, [sergebulaev/tiktok-skills](https://github.com/sergebulaev/tiktok-skills), [pandich93/youtube-niche-finder](https://github.com/pandich93/youtube-niche-finder), Nooticr MCP, ViralMint | Nothing fits a static export + free Worker; "breakout" sort idea kept |

## 2026-09-29 · ▶ Watch here, the in-dashboard player (round 32)

Full table in `12-watch-in-dashboard.md`. Short form:

| Area | Find | Decision |
| --- | --- | --- |
| Players | Three plain sandboxed iframes written by us | **Adopted** |
| Players | [react-player](https://github.com/cookpete/react-player), [react-social-media-embed](https://github.com/justinmahar/react-social-media-embed), `@lite-embeds/*`, react-tiktok, react-instagram-embed, react-youtube | Rejected: a platform script in our origin, or YouTube only |
| Players | [react-lite-youtube-embed](https://github.com/ibrahimcesar/react-lite-youtube-embed), lite-youtube-embed, `@next/third-parties`, Mux's youtube-video-element / tiktok-video-element | Reference (the facade idea) |
| Instagram pictures | Meta oEmbed, `/media/`, `og:image`, the embed page's HTML, Iframely / Microlink | None permitted and stable |

## 2026-10-03 · Discover search v2 and the Claude connector (round 33)

Full table in `13-discover-search-v2.md`. Short form:

| Area | Find | Decision |
| --- | --- | --- |
| Search | Tavily `max_results` 20 at the same price, `include_published_date`, `include_usage`, `GET /usage` | **Adopted** |
| Search | Exa, Brave Search API, SerpAPI | Not tested (owner sign-ups); candidates if the golden test misses |
| Query planning | Built-in editing dictionary (`planning/data/edit-terms.json`) | **Adopted**; Claude API in the Worker deferred (owner: connector first) |
| MCP server | Cloudflare Agents SDK `createMcpHandler` (stateless, free plan) + `@modelcontextprotocol/sdk` | **Adopted** |
| MCP server | `McpAgent` (Durable Objects) | Rejected (no state needed) |
| MCP auth | [`@cloudflare/workers-oauth-provider`](https://github.com/cloudflare/workers-oauth-provider) | **Adopted** (OAuth 2.1 + dynamic registration for Claude's custom connectors) |
| Creator analysis | Instagram Business Discovery (Facebook Login only) · YouTube Data API · TikTok Research / Display APIs · Meta Content Library | Project 2 / project 2 / rejected (not eligible) / rejected (academic only) |
| Trends reference | Beacons Discover Trends | Reference for project 3 (data source not public) |

## 2026-10-06 · Social world, iOS 26 look (round 35)

Full table in `18-social-ios-design.md` §9. Short form:

| Area | Find | Decision |
| --- | --- | --- |
| Glass effect | [liquid-glass-react](https://github.com/rdev/liquid-glass-react), [simple-liquid-glass](https://github.com/lucaperullo/simple-liquid-glass), [liquid-glass-showcase](https://github.com/aryankholqi/liquid-glass-showcase) | Rejected / reference: SVG-filter refraction is Chromium-only; own `backdrop-filter` recipe adopted |
| iOS components | 21st.dev segmented control, bottom nav bar, animated tabs, shadcn drawer | Reference patterns, rebuilt in CSS with logical properties |
| Primitives | shadcn/ui (Base UI), Radix, Konsta UI, Ark UI, Silk | Not adopted this round (Konsta fights our tokens; Silk commercial; shadcn maybe later for menus) |
| Bottom sheet | [vaul](https://github.com/emilkowalski/vaul) | **Adopted** (snap points, drag, scroll lock, dialog a11y; bottom direction is RTL-safe) |
| Icons | [Lucide](https://lucide.dev) · Hugeicons · Phosphor · Tabler · Heroicons | **Lucide adopted** (`lucide-react`, stroke 1.75); SF Symbols not licensed for the web |
| Brand glyphs | [simple-icons](https://github.com/simple-icons/simple-icons) (CC0) | **Adopted as copied SVG paths**, no package |
| Motion | [Motion](https://motion.dev) · CSS `linear()` springs · React `<ViewTransition>` | CSS adopted; Motion deferred; ViewTransition a stretch task |
| Arabic font | Vazirmatn · IBM Plex Sans Arabic · Noto Sans Arabic · Readex Pro · Cairo · Tajawal · Almarai · Rubik | **Vazirmatn adopted** (owner's pick) |

## How to add to this log

One row per find: area · link · decision (adopt / adopt candidate / reference / rejected + why). Re-run a search when a new phase starts
(Sprint 2 map & planner, Sprint 3 Supabase & push, Sprint 4 AI Scout & MCP).
