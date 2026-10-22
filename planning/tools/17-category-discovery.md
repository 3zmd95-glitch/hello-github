# Category discovery

Requested 2026-10-04: enhance Cars, Coffee, Travel and the other subject-category buttons in Discover. Keep the user-facing app on localhost:3000 and verify before reporting success.

## Research and decisions

- Reviewed [Tavily's maintained search guidance](https://github.com/tavily-ai/skills/blob/main/skills/tavily-best-practices/references/search.md): use concise, focused subqueries and explicitly bounded search parameters. Adopt these practices in the existing TypeScript planner; preserve three primary queries per platform and the two-retry ceiling.
- Reviewed [Multilingual Information Retrieval with LLM Query Expansion](https://github.com/jantiegges/Query-Expansion-with-LLMs). Its Python/Pyserini research stack would add an unrelated indexing service to this live-video search app. Keep the existing retrieval providers and add small, curated bilingual category profiles instead.
- No available installed skill provides a suitable category-search implementation. Reuse the repository's existing query planner, relevance filters, bilingual UI, and connected subscription adapters.
- Preserve the user's typed technique and clicked category as separate constraints. Explicit category selection takes precedence over category inference from the text. Category-only results must still show shooting/editing evidence, rather than recipes, shopping, or general subject advice.
- Give both local subscription models and built-in AI the same category context. Do not let missing AI category wording remove the selected subject from retrieval or relevance checks.
- Retry nonempty but entirely off-topic category responses within the existing budget; retain rejected cards behind the existing off-topic disclosure and avoid caching an unusable answer as complete.
- Decided 2026-10-06 with the owner, after the live check below: a typed idea (or AI brief) inside a selected category stays strict while any card matches both. When none does, the cards that match the idea alone are shown, marked `outsideCategory`, with a one-line note in Discover. The category groups are `SearchPlan.categoryGroups`; AI concepts that repeat the category count as category groups. Category-only, exact and plain searches never relax. No library fits this repository-specific rule; it reuses the existing matcher.
- Move category-specific ideas next to the category buttons and offer an explicit category-only search action when text is present. Selecting a suggested idea fills the input; searching remains explicit.

## Validation

- `pnpm lint`, `pnpm typecheck` (app and Worker), and production build passed.
- `pnpm test`: 1,880 tests passed across 80 files after integrating the latest main branch.
- Full Playwright suite on localhost:3000: 289 passed, four existing viewport-specific skips, and one unrelated phone mastery test hit its cumulative 30-second timeout under eight-worker load. Its trace showed all assertions passing; an isolated one-worker rerun passed three consecutive times (19–21 seconds each). No test timeout or product code was changed to mask the failure.
- Desktop and phone Discover coverage passed, including category ideas, category-only search, preserved filters/model selection, Arabic RTL layout, platform results and Instagram preview regressions.
- Live category checks follow deployment. Results are assessed from returned titles/snippets; a successful request alone is not a quality benchmark. The existing YouTube daily cap is preserved.

### Live check, 2026-10-06 (localhost:3000, deployed Worker)

- **Deployment confirmed.** The post-merge push runs below completed, and their real deploy steps ran (none skipped). Local `out/` was rebuilt from `ea75153` before testing.
  - Merge `8716fb7`: Deploy Scout Worker 37191364842 (SOCIAL_KV/OAUTH_KV + Deploy steps succeeded), Deploy to GitHub Pages 37191364840 (Upload + Deploy succeeded).
  - Later merge `ea75153`: runs 37191908058 and 37191908051, same steps.
- **Keyword category searches (small sample):**
  - **Coffee, category only:**
    - 35 examples, 27 tutorials, 6 popular, 54 hidden.
    - Popular is all coffee B-roll filming/editing (Peter McKinnon, Daniel Schiffer, coffee commercials).
    - Examples and tutorials include coffee lighting setups, product videography, and Arabic coffee-ad shooting tutorials.
    - One weak card among the first six tutorials: a café place post.
  - **Cars + typed "match cut", Year filter:**
    - 11 shown, all car match-cut edits or tutorials, all on YouTube.
    - TikTok/Instagram had no on-topic results. Their few candidates lacked "match cut" and stayed hidden (46 hidden in total).
  - **Cars, category only** (via "Search only Cars"): 83 shown (YouTube 48, TikTok 18, Instagram 17), 26 hidden. All on-topic: rolling shots, cinematic car filming, car-rig shots, Arabic car-editing tutorials.
  - **Travel, category only:** 93 shown (YouTube 26, TikTok 34, Instagram 33), 64 hidden. All on-topic: travel transition reels, cinematic travel films and vlog editing, Arabic travel filming tips.
- **UI checks:**
  - Each category showed its three ideas.
  - Clicking an idea filled the draft and sent no request; the category stayed selected.
  - "Search only Cars" cleared the leftover "match cut" text and kept the Year filter.
- **AI content search: real failure found.**
  - Test: Travel + the idea "Travel drone reveals through foregrounds".
  - Two planners: built-in AI (Llama 3.3 70B), and Claude Opus 5 at `max` through Claude Code on the owner's Max plan (the first live Claude inference). Both planned the search.
  - Both returned **0 shown / 76 hidden**.
  - Many hidden cards matched the technique exactly. Of 18 inspected: 11 mention drone, 6 mention reveal, 5 mention foreground. Example: a TikTok "Drone footage ideas … Reveal through foreground".
  - Only 2 of those 18 mention travel. Because the selected category is a hard requirement, a specific technique inside a category can hide everything.
  - Needs a fix; owner to decide (see the proposed fix below).
- **ChatGPT:** the ChatGPT search was refused with the app's "subscription reached a usage limit" message. The plan's allowance was exhausted — the same limit that stopped the Codex session. No retrieval request or Tavily credit was spent.
- **Usage after the checks:** YouTube 18/70 today. The Tavily figure in the footer (222/1000) is cached for 10 minutes and had not caught up yet.
- **Fix built (same day, owner approved):** when nothing matches both the selected category and the typed idea, the idea's matches show, marked outside the category, with a note. Category-only searches stay strict. Tests cover the Worker labelling, the keyword and AI plans, the run and the dashboard note.
