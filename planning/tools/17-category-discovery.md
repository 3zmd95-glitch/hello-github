# Category discovery

Requested 2026-10-04: enhance Cars, Coffee, Travel and the other subject-category buttons in Discover. Keep the user-facing app on localhost:3000 and verify before reporting success.

## Research and decisions

- Reviewed [Tavily's maintained search guidance](https://github.com/tavily-ai/skills/blob/main/skills/tavily-best-practices/references/search.md): use concise, focused subqueries and explicitly bounded search parameters. Adopt these practices in the existing TypeScript planner; preserve three primary queries per platform and the two-retry ceiling.
- Reviewed [Multilingual Information Retrieval with LLM Query Expansion](https://github.com/jantiegges/Query-Expansion-with-LLMs). Its Python/Pyserini research stack would add an unrelated indexing service to this live-video search app. Keep the existing retrieval providers and add small, curated bilingual category profiles instead.
- No available installed skill provides a suitable category-search implementation. Reuse the repository's existing query planner, relevance filters, bilingual UI, and connected subscription adapters.
- Preserve the user's typed technique and clicked category as separate constraints. Explicit category selection takes precedence over category inference from the text. Category-only results must still show shooting/editing evidence, rather than recipes, shopping, or general subject advice.
- Give both local subscription models and built-in AI the same category context. Do not let missing AI category wording remove the selected subject from retrieval or relevance checks.
- Retry nonempty but entirely off-topic category responses within the existing budget; retain rejected cards behind the existing off-topic disclosure and avoid caching an unusable answer as complete.
- Move category-specific ideas next to the category buttons and offer an explicit category-only search action when text is present. Selecting a suggested idea fills the input; searching remains explicit.

## Validation

Implementation and verification in progress. Live results are assessed from returned titles/snippets; a successful request alone is not a quality benchmark.
