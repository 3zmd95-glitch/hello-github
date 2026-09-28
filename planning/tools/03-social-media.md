# 03 · Social media tools (later, Phase 4)

Goal of the Social world: track growth, plan posts, learn what the audience asks for. Posting started manual ("plan + remind");
round 28 added **auto-posting** to TikTok, Instagram, YouTube and Threads through the Scout Worker (see `07-auto-posting.md`), with X
and Snapchat as a manual step.

## Platform data (into `social_snapshots`, daily cron)

| Platform | Tool | Access | Reality |
|---|---|---|---|
| YouTube | **YouTube Data API v3 + Analytics API** (`googleapis`) | Google Cloud project, OAuth, free quota (10k units/day; `search.list` has its own 100 calls/day bucket since June 2026) | best API of all; `videos.list(chart=mostPopular, regionCode=SA)` is a **music / movies / gaming chart** since July 2025 (the Trending page is gone), see `08-trends.md` |
| Instagram | **Instagram Graph API** | Meta developer app, Creator/Business account linked to a Facebook Page, app review | followers, reach, media insights, comments; **apply early**, review takes weeks |
| TikTok | **TikTok Display API** | TikTok developer app, approval required | profile + video stats only; no trends API |
| X | manual entry form | official API is paid (~$200/mo) | monthly numbers typed in |
| Snapchat | manual entry form (+ CSV import later) | no useful free API | Snapchat is very large in Saudi Arabia: treat it as a primary channel even though stats are manual |
| Until approvals land | **CSV import** from TikTok Studio / Instagram Insights exports | | keeps the Growth screen useful in the meantime |

## Content workflow

| Need | Tool | Notes |
|---|---|---|
| Calendar, stages, scripts, shot lists | own tables (`posts`, `post_scripts`, `shots`) in the dashboard | as in the mockup (v17–v18) |
| Reminders at best posting time | Web Push (same as dashboard) | default to Saudi prime time (after Isha), overridable per platform |
| Captions, hooks, hashtags in Hijazi | Claude Haiku | counts against the AI cap |
| Reference cards and embeds | **oEmbed**: YouTube and TikTok public, Instagram after Meta approval; `react-lite-youtube-embed` for fast article pages | thumbnails cached in `skill_refs` |
| Trend scan (round 30, planned) | **Trend Radar**: Google Trends SA/US, YouTube charts, keyword search, kworb sounds, weekly Tavily scan, Saudi moments calendar, manual links for TikTok Creative Center and Instagram trending audio | `08-trends.md`; Worker cron slots, results in KV `trends:latest`, shown in the Ideas bank |
| Comment themes → "what people want" | YouTube comments API (+ Instagram comments later) summarized weekly by Claude | feeds the ideas bank and Skill Scout |
| Short links with click counts | own `/go/[slug]` route | UTM parameters per platform |
| Auto-publishing (round 28, built) | YouTube upload API · Instagram Content Publishing API · Threads publishing · TikTok Content Posting API, from the Scout Worker's five-minute cron | `07-auto-posting.md`; YouTube and TikTok stay private until their audits pass |
| Instagram auto-DM (later) | Instagram Messaging API | Meta app review; after the social phase |

## Production tools (outside the app)

| Tool | Role |
|---|---|
| **DaVinci Resolve Studio** (owned) | editing and grading; project template with intro/outro, caption style, per-platform render presets |
| **CapCut** | quick phone edits and trend templates |
| **Canva** | thumbnails and post graphics in the 3z Prod brand kit |
| **Obsidian** | scripts and research notes; synced to GitHub, read by the dashboard |
