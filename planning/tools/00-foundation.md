# 00 · Foundation tools (shared by dashboard, website, social)

| Need | Tool | Why | Watch out |
|---|---|---|---|
| Language | **TypeScript** everywhere | one language for UI, API routes, cron jobs, MCP server | strict mode from day one |
| Framework | **Next.js (App Router)** | pages + API + server actions in one app; `/dashboard` and `/ar`, `/en` live together | keep server components for data, client components for the game UI |
| Styling | **Tailwind CSS** | fast, RTL logical utilities | no `ml-/mr-`, only `ms-/me-` |
| Database / auth / files | **Supabase** (free tier) | Postgres + Auth + Storage + RLS in one project | free tier pauses after 7 idle days → daily cron ping |
| Schema | **Supabase CLI** migrations + `gen types` | versioned schema in git, typed queries | run migrations from CI, never edit tables in the web UI |
| Hosting | **Cloudflare Workers via OpenNext** (`@opennextjs/cloudflare`) | free tier allows commercial use (Vercel Hobby does not), fast in the Gulf, cron built in | verify `next/og`, ISR and image optimization work under OpenNext in Phase 0 before building on them |
| Scheduled jobs | **Cloudflare Cron Triggers** | push reminders, social snapshots, weekly plan, Supabase keep-alive | one Worker, several schedules |
| Email | **Resend** (free 3k/month) + **React Email** | reminders by email as fallback, later newsletter and receipts | verify sending domain once a domain exists |
| Secrets | `.env.local` locally, **Cloudflare secrets** + **GitHub Actions secrets** in CI | `.gitignore` already excludes `.env`, `*.key`, `*.pem` | never commit Supabase service key |
| Lint / format | **ESLint** + **Prettier** + `lint-staged` with **Husky** | consistent code with zero discussion | |
| Unit tests | **Vitest** | XP/level/streak math, planner picker, Zod schemas | |
| E2E tests | **Playwright** (Chromium pre-installed in this environment) | phone + desktop flows, RTL rendering | run against a preview deploy |
| CI | **GitHub Actions** | lint · typecheck · test · deploy preview on every push, production on `main` | Dependabot for updates |
| Errors | **Sentry** (free tier) | see crashes on the phone PWA | filter out expected offline errors |
| Analytics (own) | `page_views` table in Supabase | the dashboard reads it directly | cookieless, no consent banner needed |

## Repository layout (proposed)

```
app/            Next.js routes: (site)/[locale]/…  and  dashboard/…
components/     ui/ (shadcn), game/ (avatar, map, celebrations), site/
lib/            xp.ts, streak.ts, planner.ts, ai/, supabase/
supabase/       migrations/, seed/ (from planning/data), tests/
workers/        cron handlers (push, snapshots, keep-alive)
messages/       ar.json, en.json (next-intl)
planning/       this folder (kept as history)
```

## Local setup on Windows

Node LTS via **nvm-windows** or **fnm** · **pnpm** · **Git** (already set up) · **VS Code** with ESLint, Prettier, Tailwind
and Playwright extensions · **Supabase CLI** (via Scoop or npm) · **Wrangler** (Cloudflare CLI, via npm) · Docker Desktop only if
running Supabase locally (optional; the hosted free project is enough at the start).
