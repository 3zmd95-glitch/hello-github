# Native TikTok acquisition in category Search

## Problem and reuse decision

Category Search offered indexed expansion/refill but omitted the native TikTok acquisition control already available in Browse. This prevented users in Search from deliberately retrieving native leads with their existing configured Worker and TikTok access.

Reuse `TikTokNativeDiscovery`, `acquireTikTokEdits`, the existing bounded Worker endpoint and category candidate accumulation. No new component, dependency, provider, permission or acquisition algorithm is needed. The existing component owns cancellation, duplicate-click protection, region selection and exclusion of retained video IDs.

## Scope

- Render through the existing category-feed introduction, only while Search represents a whole category. Detailed submitted topics, skill searches, saved-only views and study-guide pages do not receive generic category acquisition.
- Activate only on All/TikTok while the panel is active and library hydration is complete.
- Pass the selected category's retained candidates for known-ID exclusion. Returned items enter that same category as neutral leads; the existing source and recommendation checks still apply.
- Category/configuration changes, cancellation and deactivation invalidate pending responses through the reused component. No automatic native request, indexed search, AI call, save or preference mutation is added by this action.
- Existing acquisition bounds remain unchanged. Availability of this route does not prove that a category has sufficient relevant or recent supply.

## Verification

A Travel regression failed before wiring because the native acquisition control was absent. The focused integration cases cover one explicit request with category-specific exclusions, retained returned leads without indexed search, hidden controls for detailed topics and other platforms, and rejected late results after category/configuration changes, cancellation or deactivation. Runtime provider validation remains separate from these local fixtures.

All 67 tests in `ResearchPanel.test.ts` and `TikTokNativeDiscovery.test.tsx` passed; scoped ESLint passed for the two changed source/test files. Full repository gates and live retrieval are handled separately.
