# 3z Scout Worker

A small Cloudflare Worker (free plan) that lets the dashboard show **TikTok, Instagram and YouTube** videos for
a topic, without exposing any key in the browser. Search goes through [Tavily](https://tavily.com)
(1,000 searches/month free) limited to those three sites; pasted TikTok/YouTube links are enriched through
their public oEmbed endpoints. Build plan 1.14, master plan round 24.

## Endpoints

Every request except `OPTIONS` and `GET /health` needs `Authorization: Bearer <SCOUT_TOKEN>`. Browsers may only
call it from the origins in `ALLOWED_ORIGINS`.

| Route               | What it does                                                                                                                                                                                          |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /health`       | `{ ok: true }`. With a valid token: `{ ok: true, auth: true, tavily: <key present> }`; a wrong token → 401. Used by the Settings "Test" button.                                                       |
| `POST /search`      | Body `{ q, platforms: ["tt","ig","yt"], lang?, max? }` → `{ results: [{ platform, handle, title, snippet, url, thumb? }], credits: { used } }`. Errors: `{ error: "quota" \| "auth" \| "upstream" }`. |
| `GET /oembed?url=…` | TikTok / YouTube links only → `{ title, author, thumb, url }`, cached for a day.                                                                                                                      |

## Configuration

| Name              | Kind                   | Where                                                                                          |
| ----------------- | ---------------------- | ---------------------------------------------------------------------------------------------- |
| `TAVILY_API_KEY`  | Worker secret          | From the `TAVILY_API_KEY` repository secret (set by the deploy workflow).                      |
| `SCOUT_TOKEN`     | Worker secret          | From the `SCOUT_TOKEN` repository secret. Any long random string, e.g. `openssl rand -hex 24`. |
| `ALLOWED_ORIGINS` | Var (`wrangler.jsonc`) | Comma list. Default `http://localhost:3000,https://3zmd95-glitch.github.io`.                   |

## Deploy (GitHub Actions)

1. Create free accounts at [tavily.com](https://app.tavily.com) (copy the API key) and
   [cloudflare.com](https://dash.cloudflare.com) (no card needed).
2. In Cloudflare: **My Profile → API Tokens → Create Token → "Edit Cloudflare Workers"** template. Copy the
   token, and copy your **Account ID** from the Workers & Pages overview.
3. In GitHub: **Settings → Secrets and variables → Actions → New repository secret**, add:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
   - `TAVILY_API_KEY`
   - `SCOUT_TOKEN` (the random string you'll also paste into the dashboard)
4. Run **Actions → Deploy Scout Worker → Run workflow** (it also runs on every push to `main` that touches
   `workers/scout/**`). Without the Cloudflare secrets the run stays green and just prints a notice.
5. The Worker URL is `https://3z-scout.<account-subdomain>.workers.dev`; the subdomain is shown in Cloudflare
   under **Workers & Pages → Overview** (and at the end of the deploy log).
6. In the dashboard: **Settings → API keys** → paste the Worker URL and the Scout token → **Test**.

## Local development

```sh
cd workers/scout
printf 'SCOUT_TOKEN=dev-token\nTAVILY_API_KEY=tvly-...\n' > .dev.vars   # git-ignored
pnpm dev                 # wrangler dev → http://localhost:8787
curl -H 'Authorization: Bearer dev-token' http://localhost:8787/health
pnpm test                # Vitest, mocked fetch (also runs from the repo root with `pnpm test`)
```

From the repo root: `pnpm worker:dev`, `pnpm worker:test`, `pnpm worker:deploy` (needs `wrangler login` or the
two Cloudflare env vars).
