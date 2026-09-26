# 02 · Website tools (later, Phase 3+)

Public bilingual site: bio, CV, articles, course landing, shop, link-in-bio, newsletter. Same Next.js app as the dashboard.
Recorded now so nothing is forgotten; built after the dashboard's daily loop works.

| Need | Tool | Notes |
|---|---|---|
| i18n + RTL | **next-intl** (`/ar` default, `/en`), `dir` set per locale, Tailwind logical utilities | hreflang links between the two versions |
| Fonts | **IBM Plex Sans Arabic** + Latin pairing via `next/font` | continuity with the Framer look |
| Article content | **own CMS** in the dashboard (TipTap JSON) → rendered with TipTap's `generateHTML` on the server | no Markdown migration from Framer; articles start fresh |
| Images | client-side compression (`browser-image-compression`) → **Supabase Storage**; **Cloudflare Image Resizing** for responsive sizes | Supabase image transforms are Pro-only, so resize at the edge instead |
| SEO | App Router `sitemap.ts`, `robots.ts`, metadata API, `next/og` for share images | confirm `next/og` works under OpenNext in Phase 0 |
| Search Console | **Google Search Console** + **Bing Webmaster** | submit both locales |
| Analytics | own `page_views` (Supabase) + **Cloudflare Web Analytics** (free, cookieless) as cross-check | no Plausible subscription needed |
| Newsletter | **Resend** Audiences + Broadcasts, **React Email** templates, double opt-in | cheat-sheet download → welcome series (3 emails) |
| Forms + spam | Zod + server actions → `leads` table; **Cloudflare Turnstile** (free CAPTCHA) on comments, inquiry, subscribe | |
| Bookings (Hire me) | **Cal.com** embed (free for one person) | consulting / coaching slots |
| Comments | own tables, moderated in the dashboard | Turnstile + member login required to comment |
| Link-in-bio + affiliates | own `/go/[slug]` route → `link_clicks` | Beacons replacement |
| Shop | **Moyasar** checkout (mada, Apple Pay, STC Pay) once the CR / freelance document is approved; **Supabase signed URLs** for paid downloads | until then products show "Notify me" |
| Course video | **Bunny Stream** with token authentication; Bunny player or **Plyr** | free chapter 1 public, rest for enrolled members |
| Media kit PDF | print stylesheet on `/media-kit` + browser "Save as PDF"; later Cloudflare Browser Rendering for a download button | auto-filled from `social_snapshots` |
| Domain + DNS | **Cloudflare Registrar** (.com) · a Saudi accredited registrar for `.sa` (needs national ID or CR) | candidates: 3zprod.com, 3zprod.sa, 3z.studio |
| Performance | Lighthouse CI in GitHub Actions | Arabic font subsetting matters for first load |
