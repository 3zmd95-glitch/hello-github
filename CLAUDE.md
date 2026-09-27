@AGENTS.md

# Project rules (3z Prod)

- **Search before building.** Before implementing a feature, integration, or tool, look for existing open-source
  projects, libraries, GitHub repositories, and Claude skills/plugins that already solve it or part of it
  (web search for GitHub repos, skill/plugin search in the session). Prefer adopting a maintained library over
  writing our own when it fits the stack (Next.js static export now, Supabase + Cloudflare later), is free for
  commercial use, and handles Arabic/RTL where relevant. Record what was found and the decision (adopted, rejected
  and why) in `planning/master-plan.md` or `planning/tools/`.
- Planning lives in `planning/` (master plan, tools plan, build plan). Update the relevant file when a decision changes.
- Dashboard copy is friendly Hijazi Arabic first, English second; keep `messages/ar.json` and `messages/en.json` in key parity.
- Quality gates before any push: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm e2e`.
