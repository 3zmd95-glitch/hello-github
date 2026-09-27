# 01 · Dashboard tools (priority)

The dashboard is the product that matters most right now: a private, gamified space that makes the owner want to open it
every day and learn one more skill, in **videography craft** (camera, lighting, composition, sound, story, color theory, production
workflow) as well as in software (DaVinci Resolve and the other apps). Everything here is chosen to serve that loop first.
Website and social come later. Craft programs are defined in the master plan, round 21.

## 1. The motivation loop, and the tool behind each part

The loop the mockup already shows (Today → quest → XP → streak → avatar grows → tomorrow again), mapped to what makes it real.

| Mechanic (from the master plan) | What it needs technically | Tool |
|---|---|---|
| **Today's flow** (main quest → 5-min micro-action → day complete) | one query for "next best quest", instant tick with no reload | Supabase + TanStack Query (optimistic updates) |
| **Daily streak + streak freeze** | server-side day boundary in Riyadh time, one write per day | Postgres function `complete_day()` scheduled check via Cloudflare Cron |
| **XP, levels, ranks I → II → III** | pure math, tested once, reused everywhere | TypeScript module `xp.ts` + Vitest |
| **Avatar + film-set scene that evolves** | pixel sprites layered by rank, 72×32 scene | Aseprite / Piskel sprites → PNG sprite sheets, rendered on `<canvas>` |
| **Celebrations** (level-up, tier-up, mastery dance, boss explosion) | queued animations above everything | Framer Motion (or CSS keyframes) + a small celebration queue |
| **8-bit sounds with mute** | short synthesized tones, no asset files | Web Audio API (native), mute flag in `localStorage` |
| **Phone reminder** ("your flame is waiting") | web push to an installed PWA | Serwist service worker + `web-push` (VAPID) from a Worker cron |
| **Focus session** (25/60 min, +25 % XP) | timer that survives tab close | timestamp in DB, countdown in UI; push when it ends |
| **Chests, gems, rewards shop** | ledger tables, random roll on the server | Postgres tables `gems_ledger`, `chests` + Supabase RPC |
| **Monthly boss** with HP bar | quests linked to a boss, damage on completion | trigger on `quests` update → `bosses.hp` |
| **Drills** (spaced repetition) | next-due dates | `drills` table, cron marks due ones, Today shows them |
| **Skill map: two archipelagos (Craft · Tools) → island → region map → skill popup** | pannable pixel map, tappable nodes | plain SVG/HTML with CSS transforms (no map library needed) |
| **Combo quests** (one craft skill + one software skill → one video) | pairing from `skills.related`, one clip completes two Produce quests | `combos` table + coach prompt; proof upload to Supabase Storage |
| **Train quests as field exercises with proof** (craft) | photo/clip upload from the phone, compressed | `browser-image-compression` → Supabase Storage; short clips as links (YouTube/Drive) to stay on the free tier |
| **Gear-aware suggestions** (phone-first at the start) | filter skills by `skills.gear` against the owner's gear list | Settings "my gear" → Postgres filter in the planner query |
| **Skill Scout / Discover** (research a skill, return a full card with sources) | AI with web search, structured output | Anthropic SDK (Sonnet) + web search tool, Zod schema for the card |
| **"📚 Start here" learning path** on every skill | ordered references with platform + creator | `refs` JSON already in the starter packs; TikTok/YouTube oEmbed for thumbnails |
| **Coach card + weekly plan** (< 5 h/week) | cheap AI call, budget cap | Claude Haiku for daily card, Sonnet weekly; `ai_usage` table enforces cap |
| **Review** (week stats, insights, mood, +10 XP) | charts over `xp_events` | Recharts |
| **Command palette, shortcuts, tour** | accessible primitives | shadcn/ui `Command` (cmdk), `react-hotkeys-hook`, `driver.js` for the spotlight tour |
| **Seasonal events** (National Day, Ramadan) | date rules | Hijri dates via `Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura')`, no library |

## 2. UI kit and styling

| Tool | Role | Notes |
|---|---|---|
| **Tailwind CSS** | styling | logical utilities (`ms-`, `me-`, `ps-`, `pe-`) + `rtl:` variant, so Arabic mirrors correctly |
| **shadcn/ui** (Radix primitives) | dialogs, bottom sheets, tabs, popovers, command palette | copy-in components, no lock-in; restyle for each world with CSS variables |
| **Two themes as CSS variables** | 🎮 Training = pixel (chunky borders, hard shadows) · 📱 Social = cinematic (dark, green accent) | set `data-world="training|social"` on the root; every token switches |
| **Fonts** | Arabic: Baloo Bhaijaan 2 (Training) · IBM Plex Sans Arabic (Social) · Latin/pixel: Pixelify Sans, Silkscreen | all on Google Fonts, loaded with `next/font` |
| **Framer Motion** | XP bar fill, toasts, avatar evolution slider | optional; CSS keyframes are enough for v1 |
| **Recharts** | XP curve, weekly stats, per-program levels | works in RTL; flip axis order for Arabic |
| **Lucide icons** | ships with shadcn | pixel-art icons for the Training world are custom sprites |

**Decision (round 26, built):** hand-built UI, no shadcn. Both worlds share one set of CSS tokens and the `.px-*` component classes;
`<html data-world="training|social">` swaps the tokens (`--radius`, `--panel`, `--edge`, shadows, `--font-body`…), so a screen opts into
the Social look just by living under `/social/**`. Charts are pure SVG/divs (no Recharts).

## 3. Data and state

| Tool | Role |
|---|---|
| **Supabase** (Postgres + Auth + Storage) | all tables from the master plan data model; owner-only rows via RLS |
| **Supabase CLI** | migrations in `supabase/migrations/`, `supabase gen types typescript` for end-to-end types |
| **Postgres functions / triggers** | XP awarding, streak day-close, boss damage, quest auto-complete when an article publishes — logic stays next to the data so the phone and the MCP server share it |
| **TanStack Query** | caching + optimistic updates so ticking a quest feels instant on the phone |
| **Zod + React Hook Form** | add-skill form, settings, publish panel |
| **Supabase Auth** | magic link / OTP for the owner; `role = owner` claim checked by RLS and by the `/dashboard` layout |

Seed data: `../data/davinci-starter-pack.json` (21 skills) and `../data/davinci-studio-ai-pack.json` (6 skills) load into
`skills`, `quests` and a `skill_refs` table in the first migration. The 7 craft programs and their sections (master plan, round 21)
seed `programs` (`kind = craft`) and `sections`; the first craft starter pack ("Camera & light from zero", phone-first) is scouted next.

## 4. PWA and phone

| Tool | Role | Notes |
|---|---|---|
| **Serwist** (`@serwist/next`) | service worker, offline shell, install prompt | successor of next-pwa |
| **Web Push** (`web-push` npm, VAPID keys) | streak reminder, focus-timer end, new lead | iOS delivers push only after the PWA is added to the home screen (iOS 16.4+) |
| **Cloudflare Cron Trigger** | sends the reminder at the owner's chosen time (Riyadh) | runs inside the same Worker |
| **Web App Manifest** | name, icons (pixel icon), `display: standalone`, RTL `dir` | generated by Next.js `manifest.ts` |

## 5. AI coach and Skill Scout

| Tool | Role | Notes |
|---|---|---|
| **Anthropic SDK** (`@anthropic-ai/sdk`) | coach card, weekly plan, Skill Scout, captions | Haiku for cheap daily tasks, Sonnet for Scout and the weekly plan |
| **Web search tool** | Scout searches YouTube, TikTok, Instagram, Blackmagic docs | restrict domains per tab (tiktok.com, instagram.com, youtube.com) |
| **Zod schema for the skill card** | AR/EN name, page, tier, steps, 4 quests with XP, refs, Arabic-gap flag | same shape as the starter-pack JSON so Scout output seeds the DB directly |
| **`ai_usage` table + Console spend limit** | hard monthly cap | the app refuses AI calls once the cap is hit and says so in Hijazi |
| **oEmbed** (YouTube, TikTok public; Instagram after Meta app approval) | thumbnails + titles for reference cards | cache results in `skill_refs` |
| **`@modelcontextprotocol/sdk`** | MCP server route (`/api/mcp`) so Claude in chat or Claude Code can add skills and notes to the map | owner token only; every write logged to `mcp_log` |

## 6. Learning inputs (bridges into the game)

| Source | Tool | Effect |
|---|---|---|
| **Obsidian vault** | Obsidian Git plugin → GitHub repo → webhook → Worker parses with `gray-matter` + `remark` | note tagged `#skill/<id>` completes the Research quest; `#publish` creates an article draft |
| **Pasted TikTok / Instagram / YouTube link** | Scout | new skill card |
| **Social comments and trends** (later) | Social world "Make it a skill" | idea in the ideas bank |

## 7. Pixel art pipeline (the missing piece)

The avatar has ~17 rank stages, each with I/II/III tiers, plus 13 islands, badges, chests, crew members and scene backdrops.

| Option | Cost | Fit |
|---|---|---|
| **Aseprite** | ~$20 once | the standard pixel-art editor; layers per rank make cumulative unlocks easy |
| **Piskel** (web) | free | good enough for the first avatar and badges |
| **AI draft → hand clean-up** | AI budget | fast for backdrops and islands; avatar must stay consistent, so draw it by hand |
| **Commission one artist** for the avatar set | one-off | consistent style across all 51 steps; brief comes from the master plan (round 9) |

Sprite sheets export as PNG; the scene renders on a `<canvas>` with `image-rendering: pixelated`.

## 8. Build order for the dashboard (each step usable on the phone)

1. **Skeleton**: Next.js + Supabase + owner login + PWA install. Empty Today screen.
2. **Skills and quests**: seed the 27 DaVinci skills plus the 7 craft programs with empty sections, list view, skill popup with 4 quests and ✓,
   proof upload for craft Train quests.
3. **XP, level, rank, streak**: `xp.ts` with tests, Today's flow card, level-up toast + sound.
4. **Avatar stage 1–3 + scene**: first sprites, evolution on rank-up.
5. **Push reminder**: daily nudge at the chosen time; streak freeze.
6. **Map view**: DaVinci island regions, then the world map with the Tools and Craft archipelagos.
7. **Coach card + Skill Scout**: AI budget cap first, then Discover; Scout the "Camera & light from zero" pack; first combo quest.
8. **Focus timer, chests, gems, boss, drills, seasons, Review**: one per week after the core loop feels good.

Steps 1–5 are the motivating core. If only those ship, the dashboard already does its job.

## 9. Quality

Vitest for XP/level/streak math and the planner picker · Playwright (phone + desktop) for: login → tick 4 quests → level-up
celebration shows; push subscription registers; `/dashboard` blocked for non-owner · Supabase RLS tests · Sentry for runtime errors on the phone.
