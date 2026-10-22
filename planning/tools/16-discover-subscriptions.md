# Discover subscription models

Requested 2026-10-04: use either ChatGPT or Claude subscription models directly from AI content search at localhost:3000. Keep real Tavily/YouTube retrieval, previews and bilingual filters.

## Research and decision

- OpenAI's current [Sign in with ChatGPT guide](https://developers.openai.com/siwc/token-sharing-open-source/sign-in) supports open-source tools and personal local projects. Use dynamic public-client registration, PKCE, OIDC signature/identity checks, protected local credentials and the public Responses endpoint. Account-specific models come from the authorized catalog. No Codex token extraction or API-key billing fallback.
- Reviewed the [official DevKit](https://github.com/openai/sign-in-with-chatgpt-devkit): its workspace packages are not published and its noncommercial license is unsuitable for assuming reuse in this project. Independently implement the documented protocol with maintained `jose` and `proper-lockfile`; do not copy DevKit code.
- Anthropic's [current subscription guidance](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan) permits the unmodified Claude Code CLI / Agent SDK to use subscription limits. Use the installed CLI, isolated runtime directory, no tools/MCP, bounded stdin/subprocess, and structured output. Never read or proxy Claude credentials. [Fable plan entitlement](https://support.claude.com/en/articles/15424964-claude-fable-models-on-your-plan) depends on plan; enabled usage credits can apply after allowances. Expose this beside the connection and usage link.
- Read installed Next static-export documentation. Dynamic subscription endpoints cannot live in a static export. A Node loopback server serves `out` and the local API on port 3000, using maintained `serve-handler`. Production retains static export and built-in Cloudflare AI; local subscription options explain their runtime requirement.
- MCP remains the separate assistant-to-Scout connector. This feature is local model inference, then the usual authenticated Scout search.

## Boundaries

- Credentials stay outside the repo/browser/Worker. Windows ChatGPT credentials use current-user DPAPI.
- Strict local Host/Origin/custom-header checks; bounded input/output, deadlines and cancellation.
- Only a validated, bounded search-plan envelope reaches Scout. No model-produced links are treated as results.
- Provider/model/effort/account distinguish browser caches. Worker cache includes validated plan and model identity. Never label another model's answer as the selected one.
- Changing dropdowns does not launch inference. Explicit submission captures the selected provider/model; result labels reflect the submitted choice.
- Highest supported reasoning effort is the default when selecting a model. ChatGPT model choices are from the account catalog; Claude availability is checked against installed CLI/plan.
- Local runtime command: `pnpm local` (build and serve) or `pnpm local:serve` after building.

## Verification

- `pnpm lint`, `pnpm typecheck`, and production build passed.
- `pnpm test`: 1,747 passed across 76 files, including Worker validation, local server origin/host boundaries, model/cache provenance, cryptographic OAuth fixtures and real Windows DPAPI with synthetic credentials.
- Full Playwright suite against the local server on port 3000: 282 passed, four existing viewport-specific skips. Includes phone/desktop subscription flows and existing Instagram preview/search regressions.
- Browser tests found the existing offline worker intercepting and caching connection status. `public/sw.js` now bypasses all local API requests and advances the shell cache version; subscription and offline-shell tests pass together.
- Real browser inspection at localhost:3000 confirmed both provider options and the existing Claude Max installation's Fable 5.1 / Opus 5 choices. The actual CLI was queried read-only, without inference.
- With the user's explicit consent, completed real ChatGPT authorization and a GPT-6-Astra search at `max` on 2026-10-04. The returned bilingual plan passed validation; Discover displayed six real results (two YouTube and four Instagram) and the correct ChatGPT/model/effort attribution. Claude inference remained untested until 2026-10-06.
- 2026-10-06, at the owner's request: connected Claude with **Use Claude Code**.
  - This only links the app to the Claude Code CLI already signed in on this computer (Claude Max). No credentials are read.
  - One real search with Claude Opus 5 at `max` produced a plan that was accepted and shown as "AI search plan · Claude · claude-opus-5 · max". Fable 5.1 was not used.
  - The same day, a ChatGPT search was refused with the usage-limit message because the plan's allowance was exhausted. No retrieval was spent.
- The live ChatGPT catalog advertised `ultra`, but the public Responses endpoint rejected it with HTTP 400 `invalid_value` for `reasoning.effort`, explicitly listing `max` as the highest accepted value. Intersect catalog efforts with the public Responses API's supported values; preserve the selected effort without silently retrying at another setting. Regression tests cover the real catalog shape and safe unsupported-effort errors.
- Credentials remain app-local. Claude's official read-only CLI status does not expose remaining allowance or whether paid usage credits are enabled; the UI links usage settings and discloses this before Search.
