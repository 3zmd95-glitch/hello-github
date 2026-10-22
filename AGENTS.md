<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Claude + Codex collaboration

For the shared development workflow, read `planning/collaboration/workflow.md` and
`planning/collaboration/current-task.md` first. Claude owns planning and implementation;
Codex owns independent code review and verification unless the user reassigns roles.
Preserve existing uncommitted work. Only one implementation writer may be active.

### Code review rules

- Native category results retain each platform's ordering and are not silently removed
  by caption, date, or popularity gates. Popular/trending claims require separate evidence.
- Loading and refresh changes must preserve saved references, distinguish retrieval
  failure from an empty source, and reject responses for obsolete category/query sessions.
- Review the exact recorded code revision/diff. Passing mocked browser tests does not
  establish that the installed Chrome helper or live platforms work; report those checks separately.
