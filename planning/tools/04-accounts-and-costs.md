# 04 · Accounts, approvals and costs

## Accounts to open, by phase

| Phase | Account | Purpose | Lead time |
|---|---|---|---|
| 0 Foundation | **Supabase** | database, auth, storage | minutes |
| 0 | **Cloudflare** | Workers hosting, cron, later DNS + registrar | minutes |
| 0 | **Sentry** | error monitoring | minutes |
| 0 | **Meta for Developers** app (Instagram Graph API) | needed in Phase 4 | **weeks** for app review → apply now |
| 0 | **TikTok for Developers** app (Display API) | needed in Phase 4 | **weeks** for approval → apply now |
| 1 Dashboard | VAPID key pair (generated locally with `web-push`) | phone push | minutes |
| 2 AI coach | **Anthropic Console** API key with a monthly spend limit | coach, Skill Scout | minutes |
| 3 Website | **Resend** (+ domain verification once a domain exists) | newsletter, receipts | minutes |
| 3 | **Cal.com** | bookings | minutes |
| 3 | **Google Search Console**, **Bing Webmaster** | SEO | minutes |
| 4 Social | **Google Cloud** project (YouTube Data + Analytics APIs, OAuth consent screen) | YouTube stats | 1–2 days for OAuth verification if publishing the app |
| 5 Shop + course | **Bunny.net** | course video | minutes |
| 5 | **Moyasar** | payments | needs CR / freelance document (in progress) |
| 6 Domain | **Cloudflare Registrar** (.com) or Saudi registrar (.sa) | domain | .sa needs national ID / CR check |

Each account gets a step-by-step setup guide when its phase starts (owner request, master plan round 8).

## Monthly cost

| Item | Cost |
|---|---|
| Cloudflare Workers | $0 (free tier) |
| Supabase | $0 (free tier; keep-alive cron prevents pausing) |
| Resend | $0 up to 3k emails/month |
| Sentry | $0 (free tier) |
| Cal.com, Turnstile, Web Analytics, Search Console | $0 |
| Claude API | ≤ $5, hard-capped in the app and in the Console |
| Bunny Stream | ~$1–5 (Phase 5) |
| Domain | ~$1/month equivalent |
| Moyasar | percentage per sale only |
| Aseprite | ~$20 once (optional; Piskel is free) |
| **Total** | **≈ $2–11 / month**, versus the current Framer + Base44 subscriptions |

## What to cancel, and when

Framer and Base44 can be cancelled once Phase 3 (public site v1) is live. Until then the Framer site stays up, since the
dashboard is private and nobody sees the gap.
