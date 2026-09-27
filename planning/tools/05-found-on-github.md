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

## How to add to this log

One row per find: area · link · decision (adopt / adopt candidate / reference / rejected + why). Re-run a search when a new phase starts
(Sprint 2 map & planner, Sprint 3 Supabase & push, Sprint 4 AI Scout & MCP).
