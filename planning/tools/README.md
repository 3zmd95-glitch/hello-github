# 3z Prod: tools plan

Which tools build and run the platform, grouped by area. Complements `../master-plan.md`
(the master plan holds the decisions; these files hold the concrete tool picks, why, and what to watch out for).

**Priority: the dashboard comes first.** The owner is early in the learning journey, and the thing that matters most is a
dashboard that motivates learning every day. `01-dashboard.md` is the detailed file and its build order is the project's
build order. Website and social tools are recorded so nothing is forgotten, but they wait until the daily learning loop works.

| File | Covers |
|---|---|
| [00-foundation.md](00-foundation.md) | Shared stack: framework, database, hosting, testing, CI, monitoring, cron |
| [01-dashboard.md](01-dashboard.md) | **Priority.** The motivating learning dashboard: motivation loop → tools, UI kit, PWA + push, AI coach, Skill Scout, pixel art, build order |
| [02-website.md](02-website.md) | Later. Public bilingual site: i18n/RTL, SEO, forms, newsletter, bookings, shop, course, analytics, domain |
| [03-social-media.md](03-social-media.md) | Later. Platform APIs, embeds, trends, posting workflow, production tools |
| [04-accounts-and-costs.md](04-accounts-and-costs.md) | Accounts to open per phase, approval lead times, monthly cost |
| [05-found-on-github.md](05-found-on-github.md) | Search-before-building log |
| [06-social-analytics-apis.md](06-social-analytics-apis.md) | Social Analytics: the Worker's OAuth + daily sync |
| [07-auto-posting.md](07-auto-posting.md) | Auto-posting (Metricool-style): the publish queue, platform limits, owner steps |
| [08-trends.md](08-trends.md) | Trend Radar: what is trending now (Google, YouTube, TikTok, Instagram, Threads, X), Arabic and English; sources, budgets, owner steps |
| [09-metricool-beacons.md](09-metricool-beacons.md) | **Roadmap:** copy Metricool + Beacons into the Social world (status per feature, order of work) |
| [10-auto-replies.md](10-auto-replies.md) | Auto-replies (Beacons Smart Reply copy): comment a keyword → public reply + DM with the link; polling, limits, owner steps |
| [11-discover-genres.md](11-discover-genres.md) | Discover by edit genre (cars, food, anime, travel…), the Most popular sort, numbers on cards, genres fed by the Trend Radar |

## Rules used when picking

0. **Search before building** (owner's rule): look for existing GitHub projects, libraries and Claude skills that already do the job before writing it; record adopted/rejected finds in `05-found-on-github.md`.

1. **Free tier first**, commercial use allowed, total under ~$10/month (see the master plan cost target).
2. **One codebase**: public site, dashboard and API live in the same Next.js app on Cloudflare.
3. **Owner time under 5 h/week**: prefer tools that remove work (generated types, AI drafts, cron jobs) over tools that add a surface to maintain.
4. **Arabic RTL is not optional**: every UI tool must handle `dir="rtl"` and Arabic fonts.
5. **Own the data**: analytics, comments, leads and social snapshots go into Supabase, not into a vendor dashboard.

## Summary of the stack

| Layer | Tool |
|---|---|
| App | Next.js (App Router) · TypeScript · Tailwind CSS · shadcn/ui |
| i18n | next-intl (`/ar` default, `/en`) |
| Data | Supabase (Postgres, Auth, Storage) · Supabase CLI migrations + generated types |
| Hosting | Cloudflare Workers via OpenNext · Cloudflare Cron Triggers |
| Email | Resend + React Email |
| AI | Anthropic SDK (Claude Haiku / Sonnet) + web search tool · MCP server via `@modelcontextprotocol/sdk` |
| Video | Bunny Stream (course) · YouTube / TikTok / Instagram embeds (references) |
| Payments | Moyasar (after CR / freelance document) |
| Quality | ESLint · Prettier · Vitest · Playwright · GitHub Actions · Sentry |

## Open decisions

- **shadcn/ui inside the pixel Training world**: use its primitives (dialog, sheet, tabs, command) and restyle them, or hand-build that world to match the mockup exactly? Recommendation: use the primitives, restyle with CSS variables. See `01-dashboard.md`.
- **Who draws the pixel art** (avatar stages, 17 ranks × 3 tiers, islands, badges, chests). Options in `01-dashboard.md`.
- **Start Meta and TikTok developer applications in Phase 0**, because approvals take weeks and gate Phase 4. See `04-accounts-and-costs.md`.
- **Owner's current gear** (phone only, or a camera / gimbal / mic already owned) decides which craft skills the coach suggests first. See master plan round 21.
- **Snapchat** as a first-class channel for the Saudi audience (manual stats for now). See `03-social-media.md`.
- `06-social-analytics-apis.md`: rebuilding the Beacons Social Analytics page here (imports now, platform APIs after Phase 0).
