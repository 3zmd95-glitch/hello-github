# 02 · Website tools (later, Phase 3+)

> Owner answers on Oct 6, 2026 (round 35, then paused the same hour: "Dont do the website now only the social panel"): the site lives in this
> Next.js project (not Framer; he only takes inspiration from Framer marketplace templates such as Smooth Approach, Fuel, Content Aim);
> version 1 = **Portfolio first**: Home, Work, About + CV, Services & Contact, Links page; Work videos are **embedded from TikTok /
> Instagram / YouTube** with the dashboard's players (no uploads); same iOS 26 theme as `18-social-ios-design.md`. Main goal unanswered.

Public bilingual site: bio, CV, articles, course landing, shop, link-in-bio, newsletter. Same Next.js app as the dashboard.
Recorded now so nothing is forgotten; built after the dashboard's daily loop works.

## Product marketing reference — 16 October 2026

**Owner direction:** use MotionVFX as the main reference for how the public shop presents and markets the **Liquid Glass plugin and LUT packs**. The owner likes its product presentation and animations and wants the same premium, cinematic feel, with **before-and-after demonstrations**. This records the direction for future website work; the website implementation remains paused.

Primary reference: [MotionVFX — mTransition Light Wipe for DaVinci Resolve](https://www.motionvfx.com/store,mtransition-light-wipe-dvr,p5115.html). Broader visual reference: [MotionVFX homepage](https://www.motionvfx.com/).

### Patterns to carry forward

The Light Wipe page introduces the visual result, separates the product trailer from the application/customization tutorial, and offers individual hover-or-tap animation previews. It follows with included contents, platform requirements, installation/access information, and a clear purchase action. Use this demonstration-led structure with 3z Prod's own identity, footage, and product assets.

### Liquid Glass and LUT demonstrations

- **Before and after is an owner requirement.** It is an addition to the Light Wipe reference, whose page advertises animated previews rather than a before/after comparison feature.
- **Liquid Glass plugin:** show the same composition with the effect off and on, plus short moving examples that reveal how the glass treatment responds over time. Demonstrate the actual supported controls and variants once the product scope is confirmed.
- **LUT packs:** compare the same shot before and after the LUT using a draggable split and a simple original/graded toggle. Include varied footage such as skin tones, daylight, city nights, and landscapes. Label the input and any base correction so the comparison makes clear what the LUT changes.
- Use matched framing and synchronized playback for video comparisons. Give mobile visitors a tap control as well as desktop hover previews.

### Suggested product page sequence

1. Product name, short benefit statement, and a cinematic hero demonstration.
2. Trailer showing finished results on real footage.
3. Interactive before/after comparisons and a gallery of individual looks or effects.
4. Practical use cases and a short installation/application tutorial.
5. Included files or presets, verified compatibility, and delivery details.
6. Clear purchase action, following the shop's existing availability rules.

The visual direction is generous media, bold concise typography, smooth reveals and transitions, and a coherent visual identity for each product. Keep demonstrations central; article pages can retain calmer reading layouts. Preserve the site's Arabic/English identity and green brand accent.

### Controls and interaction reference

**Owner clarification, 16 October 2026:** "the buttons interactions the website feels like an apple ui design i love it". The Apple-like feel of the controls and their interactions is a key part of the desired direction, alongside product marketing and before/after demonstrations.

[Owner's MotionVFX screenshot](../references/motionvfx-controls-2026-10-16.png) shows:

- Wide, pill-shaped segmented controls, with a smaller product selector beneath the category selector.
- An inset active pill with a soft purple gradient, a fine edge highlight, and bright text; inactive labels are muted.
- Dark charcoal surfaces and generous spacing around the controls.
- Large media cards with rounded corners and translucent circular play buttons.

For 3z Prod, use this control language for product categories, individual looks, and Original / Applied comparisons. Suggested motion: a selected pill that glides between options, gentle hover brightening, a small press response, and fluid changes between previews. Keep the selected state clear and preserve the comparison's framing/playback position when switching. These motion details are proposed behavior for our site; the screenshot records appearance only.

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
