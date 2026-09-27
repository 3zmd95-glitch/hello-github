# 3z Prod: Training dashboard build plan

Every step from empty repo to a daily-used training dashboard. Steps are small, each ends with something the owner can open
on the iPhone. The mockup (`dashboard-mockup.html`, artifact v21) is the visual reference. The master plan is the source of rules.

## Principles

- **Dashboard first, Training world first.** Social world, website and shop come after the daily loop is used for real.
- **Ship static first, sync later.** Sprint 1 runs as a static PWA on GitHub Pages with progress stored on the phone.
  Supabase (sync, backup, push) is added in Sprint 3 without rewriting screens: all data access goes through one `store` layer.
- **Owner effort ≈ 0 per step.** The only owner actions are: enable GitHub Pages once, later create Supabase and Cloudflare accounts.
- **Arabic (Hijazi) first, English toggle.** Dashboard copy is a client-side dictionary (`messages/ar.json`, `messages/en.json`);
  next-intl routing is added with the public website, which needs SEO routes. RTL by default.
- **Tests on the rules.** XP, level, rank/tier, streak and planner logic live in `lib/` as pure functions with Vitest tests.

## Tech (from `tools/`)

Next.js (App Router, `output: "export"` in Sprint 1–2) · TypeScript strict · Tailwind CSS · Zustand (persist → localStorage) as the
Sprint 1 store · Zod schemas for seed data · Vitest · Playwright · GitHub Actions (CI + Pages deploy) · hand-written service worker
(Serwist later) · Web Audio for sounds · `<canvas>` pixel scene.

## Sprint 0 · Plan and scaffold (this branch)

| # | Step | Done when |
|---|---|---|
| 0.1 | Write this plan, link it from `planning/README.md` | file in repo |
| 0.2 | `pnpm create next-app` (TS, Tailwind, App Router, `src/` off, ESLint) at repo root; Prettier; `pnpm typecheck`, `lint`, `test`, `e2e` scripts | `pnpm build` passes |
| 0.3 | `next.config.ts`: `output: "export"`, `basePath` from `NEXT_PUBLIC_BASE_PATH`, `images.unoptimized` | static `out/` builds |
| 0.4 | GitHub Actions: `ci.yml` (lint, typecheck, test, build on every push/PR) and `pages.yml` (build with `NEXT_PUBLIC_BASE_PATH=/hello-github`, deploy `out/` to Pages on push to `main` + manual) | workflows green |
| 0.5 | Owner enables GitHub Pages: repo Settings → Pages → Source = GitHub Actions (one time) | site URL exists |

## Sprint 1 · The motivating core (static PWA, phone-local progress)

| # | Step | Done when |
|---|---|---|
| 1.1 | **Domain types + seed**: `lib/domain.ts` (Program, Section, Skill, Quest, XpEvent, Settings) with Zod; `data/programs.ts` (DaVinci with 7 pages, the 7 craft programs with sections from master plan round 21, the 12 other app programs as thin entries); `data/skills/` loads the two DaVinci JSON packs and a small **phone-first craft draft pack** (Camera-on-iPhone, Lighting, Composition: ~8 skills, marked `source: "draft"`, no external refs) | `pnpm test` validates all seed against the schema |
| 1.2 | **Rules**: `lib/xp.ts` (quest XP by type × tier multiplier, mastery bonus, micro-action XP), `lib/level.ts` (level from cumulative XP, `50·n^1.5`, per-program level), `lib/rank.ts` (17 ranks at levels 1,2,3,5,6,8,10,12,15,18,21,24,28,32,36,42,50, tiers I–III by XP progress), `lib/streak.ts` (Riyadh day boundary, daily streak, weekly freeze, micro-action counts) | Vitest green, edge cases covered |
| 1.3 | **Store**: Zustand + persist (`localStorage`), state = quest completions (with proof link), xp events, micro-actions, streak, settings (lang, sound, gear, davinci edition, reminder time). One `store/index.ts` API; screens never touch storage directly | unit test: complete 4 quests → mastery bonus, level-up |
| 1.4 | **App shell**: RTL layout, Baloo Bhaijaan 2 + Pixelify Sans via Google Fonts `<link>`, pixel theme tokens (CSS variables: chunky borders, hard shadows, dark bg, green accent), phone tab bar (Today · Skills · Map(soon) · More) + desktop sidebar, language toggle, `manifest.ts`, icons, `public/sw.js` app-shell cache + registration | installs on iPhone, works offline after first load |
| 1.5 | **Today screen**: header (rank name + tier, level, XP bar to next level, streak flame, freezes); **Today's flow** card 0/3 → 3/3 (① main quest picked by planner: nearest-to-mastery skill that matches owner gear · ② one 5-min micro-action · ③ day complete celebration); "More for today" collapsed (other suggested quests) | ticking through the flow lights the flame and plays the sound |
| 1.6 | **Skills screen**: programs grouped Craft / Tools with level + progress; program → sections → skill rows with 4 quest pips, tier chip, ✓ Studio chip, 🔒 gear chip ("when the camera arrives") | all 27 DaVinci + draft craft skills listed |
| 1.7 | **Skill popup** (bottom sheet on phone, centered on desktop): AR/EN names, page, tier, progress n/4, "📚 Start here" (① full tutorial → ② written guide → ③ short clips, from refs), the 4 quests with XP, tap to complete, proof link for Produce/Article, steps and "what it is" sections, Esc/backdrop close, no re-render jump | Playwright: open → tick → popup stays, XP toast above |
| 1.8 | **Celebrations + sound**: XP toast, level-up and tier-up toasts, mastery celebration, queued one after another; Web Audio 8-bit tones; mute toggle | no overlapping celebrations |
| 1.9 | **Avatar + scene v0**: `<canvas>` 72×32 pixel scene, procedural placeholder avatar (glasses, beard, tee, phone) that changes 3 props by rank stage (phone → camera strap → mirrorless); day/dusk/night tint from local time | visible on Today; sprite sheets replace it later without API change |
| 1.10 | **Settings**: language, sound, reminder time (stored for Sprint 3), gear list (iPhone + lights preset; add camera later → unlocks `gear=camera` skills), DaVinci edition (Studio default), export/import progress JSON (backup until Supabase), reset | export → import round-trips |
| 1.11 | **E2E**: Playwright phone (iPhone viewport) + desktop: flow 0/3 → 3/3; complete 4 quests → mastery; RTL, no horizontal scroll; offline reload works | `pnpm e2e` green in CI |
| 1.12 | Merge to `main` → Pages deploy → owner installs on iPhone | first real streak day |
| 1.13 | **Research (Scout v0, no backend)**: "🔎 Research" button on every skill + a Discover screen with a topic field; opens YouTube / TikTok / Instagram search (AR + EN queries, app deep links on the phone); in-app YouTube results (thumbnails, "add as reference") when the owner stores a referrer-restricted YouTube Data API key in Settings; paste-a-link saves a TikTok / Instagram / YouTube / web reference on the skill (stored locally). The AI Scout that writes a full card (Sprint 4) needs a server for the Claude key. | typing "match cut" surfaces videos on all three platforms |

## Sprint 2 · Map, planner, review (still static)

| # | Step |
|---|---|
| 2.1 | World map: two archipelagos (Craft · Tools), island size/glow by program level, fog on empty islands |
| 2.2 | DaVinci region map (7 pages as regions, skills as nodes with names) → skill popup; craft island region maps |
| 2.3 | Planner: next-week plan (Sat–Fri) within a 5 h budget from the rules-based picker (AI comes in Sprint 4); add/remove/tick |
| 2.4 | Combo quests v1: rules-based pairing from `related` (craft skill + software skill → one brief, one clip completes both Produce quests) |
| 2.5 | Review: week stats (XP, quests, craft/software split), streak history, mood + 3 reflection questions (+10 XP) |
| 2.6 | Focus session timer (25/60 min, +25 % XP), chests after N quests, gems ledger, rewards shop (owner-defined real rewards) |
| 2.7 | Season card (30-day theme, badge), monthly boss with HP bar, drills (spaced repetition), badges |
| 2.8 | Seasonal events: Saudi National Day, Founding Day, Ramadan (Umm al-Qura calendar via `Intl`) |

## Sprint 3 · Sync, reminders, hosting (owner creates 2 accounts)

| # | Step |
|---|---|
| 3.1 | Owner creates **Supabase** project (guide provided). Migrations from the data model; RLS owner-only; seed from `data/` |
| 3.2 | `store` gets a Supabase adapter; local progress migrates up on first login (magic link); offline queue |
| 3.3 | Proof uploads (compressed images) to Supabase Storage; clips stay as links |
| 3.4 | Owner creates **Cloudflare** account. Move hosting to Workers via OpenNext; Cron: daily push reminder at the owner's time, Supabase keep-alive |
| 3.5 | Web Push (VAPID) via Serwist service worker; streak reminder; focus-timer end |
| 3.6 | Sentry |

## Sprint 4 · AI coach (owner creates Anthropic key with spend limit)

| # | Step |
|---|---|
| 4.1 | `ai_usage` cap first; coach "Do this now" card (Haiku) |
| 4.2 | Skill Scout: name/link → full card (Sonnet + web search, Zod schema = pack JSON shape), duplicate check, ✓ adds to map |
| 4.3 | Scout the **"Camera & light from zero" phone-first pack** to replace the draft craft skills with sourced cards |
| 4.4 | Weekly plan draft (Sonnet), combo suggestions, Arabic-gap flags |
| 4.5 | MCP server route so Claude in chat can add skills and notes; Obsidian Git webhook bridge |

## Sprint 5+ · Social world, website, shop, course

Per master plan phases 3–6 and `tools/02-website.md`, `tools/03-social-media.md`. Not scheduled until Sprints 1–4 are in daily use.

## Definition of done for Sprint 1

The owner opens the installed app on the iPhone in the morning, sees one main quest and one micro-action chosen for their gear,
completes them, hears the sound, sees the flame and the avatar, and comes back tomorrow because the streak asks them to.
