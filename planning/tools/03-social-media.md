# 03 · Social media tools (later, Phase 4)

Goal of the Social world: track growth, plan posts, learn what the audience asks for. Posting itself stays manual
("plan + remind"), which avoids platform publishing approvals at the start.

## Platform data (into `social_snapshots`, daily cron)

| Platform | Tool | Access | Reality |
|---|---|---|---|
| YouTube | **YouTube Data API v3 + Analytics API** (`googleapis`) | Google Cloud project, OAuth, free quota (10k units/day) | best API of all; `videos.list(chart=mostPopular, regionCode=SA)` doubles as a trend feed |
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
| Trend scan | Claude web search restricted to tiktok.com / instagram.com / youtube.com + YouTube mostPopular (SA) | weekly cron, results into `trend_items` |
| Comment themes → "what people want" | YouTube comments API (+ Instagram comments later) summarized weekly by Claude | feeds the ideas bank and Skill Scout |
| Short links with click counts | own `/go/[slug]` route | UTM parameters per platform |
| Auto-publishing (possible later) | YouTube upload API (free) · Instagram Content Publishing API · TikTok Content Posting API | each needs its own approval; not needed for v1 |
| Instagram auto-DM (later) | Instagram Messaging API | Meta app review; after the social phase |

## Production tools (outside the app)

| Tool | Role |
|---|---|
| **DaVinci Resolve Studio** (owned) | editing and grading; project template with intro/outro, caption style, per-platform render presets |
| **CapCut** | quick phone edits and trend templates |
| **Canva** | thumbnails and post graphics in the 3z Prod brand kit |
| **Obsidian** | scripts and research notes; synced to GitHub, read by the dashboard |
