# 3z Prod: planning files

Planning files for 3z Prod. The app is being built at the repo root following `build-plan.md`.

- `master-plan.md`: every decision so far (brainstorm rounds 4–20, tech stack, data model, phases, costs).
- `dashboard-mockup.html`: the clickable dashboard mockup (open it in a browser). Live copy: https://claude.ai/artifact/SthLJR7GcqKwArRLXPMXi1
- `data/davinci-starter-pack.json`: 21 DaVinci Resolve skills (3 per page), each with steps, 4 quests, a "start here" path and TikTok / Instagram / YouTube / web sources.
- `data/davinci-studio-ai-pack.json`: 6 skills built on DaVinci Resolve Studio AI tools.
- `data/davinci-core-pack.json`: 35 hand-written core skills (`set: "core"`) covering the fundamentals a beginner-to-intermediate iPhone creator needs on all 7 pages (project settings, import/relink, proxies, trimming, J/L cuts, Text+, keyframes, Merge node, primaries + scopes, curves, qualifier, node tree, LUTs, NR, Film Look Creator, Color Slice, sky replacement, levels, Voice Isolation, Dialogue Leveler, codecs, SRT, vertical export, HDR). Every card has `refs: []` on purpose: the in-app research button finds real videos on demand. With the two Scout packs, every DaVinci page has at least 6 skills (62 total).
- `build-plan.md`: every build step, sprint by sprint (Sprint 1 = the motivating core as a static PWA).
- `tools/`: the tools plan, one file per area. Start with `tools/01-dashboard.md` (the priority: the dashboard that motivates daily learning).

The three DaVinci data files will seed the `skills` and `quests` tables in Phase 1.
