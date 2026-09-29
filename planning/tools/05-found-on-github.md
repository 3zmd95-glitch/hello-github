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

## 2026-09-29 · auto-replies (round 30, "automatic comments like Beacons")

| Looked at | Found | Decision |
| --- | --- | --- |
| Self-hosted Instagram comment → DM bots | [AutoDMX](https://github.com/Aditya5688/AutoDMX), [open-autodm](https://github.com/andaveti42-cmyk/open-autodm), [instagram-dm-automation](https://github.com/ElAmir-Mansour/instagram-dm-automation), [ig-automation](https://github.com/elmlahym-wq/ig-automation) | Reference for the flow (keyword → public reply → private reply). Not adopted: all need a server + database and Meta webhooks (Live app with Advanced Access); ours polls from the free Worker's cron with KV. |
| Hosted | ManyChat, LinkDM, Beacons Smart Reply ($10–15/month) | Beacons' builder copied field by field (`10-auto-replies.md`). |
| Direct official API | Instagram comments + private replies (`/{comment-id}/replies`, `/{ig-user-id}/messages` with `comment_id`) | **Adopted** in the Scout Worker (`replies.ts`). |

## How to add to this log

One row per find: area · link · decision (adopt / adopt candidate / reference / rejected + why). Re-run a search when a new phase starts
(Sprint 2 map & planner, Sprint 3 Supabase & push, Sprint 4 AI Scout & MCP).
