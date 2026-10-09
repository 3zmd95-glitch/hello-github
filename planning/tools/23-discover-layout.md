# Discover layout — 9 October 2026

The owner found Discover confusing after seeing the search box, edit formats, source inspector, technique chips, recent queries, categories, platform tabs and filters stacked together. The page needs a clear starting point without implying automatic trend discovery is complete.

## Existing options and decision

Reviewed the current app's buttons, native disclosures and shared ResearchPanel, plus [Radix Tabs](https://www.radix-ui.com/primitives/docs/components/tabs) and its keyboard/manual-activation model. A new UI dependency is unnecessary for three ordinary workspace buttons. Reuse native buttons with pressed state and native details/summary for secondary controls; retain existing RTL and theme tokens. The installed Next.js static-export guide was read before implementation.

## Layout

- **Browse** is the default: concise visual edit-format cards, category grid, then optional techniques and Reel inspection. Reviewed references and uncertainty remain visible. Full source detail is expandable.
- **Search** keeps query entry, platform choice, filters and results together. Program/options, category refinement and recent queries are disclosures; filters collapse on desktop as well as phone. Platform/date choices remain available before submitting a query.
- **Saved** retains the existing inspiration/practice library, notes and progress. Its underlying data is unchanged.

One ResearchPanel stays mounted across all three views. Switching navigation changes presentation only; it does not reset or reissue the query. A category chosen from Browse starts a clean keyword search, clearing any old subscription brief, exact-format restriction or hidden filters. Category refinement in Search retains its existing semantics. Genre deep links open Search once. The skill-sheet version of the shared panel retains its existing presentation.

No new automatic scan, inference request, search-credit budget or popularity claim is introduced. The shared Worker rollout and automatic current-format retrieval remain separate unfinished work from tool plan 22.

## Validation

Completed 9 October: lint, app/Worker typecheck, production build and all 2,680 unit tests across 134 files passed. The complete browser suite passed 392 tests with eight existing viewport-specific skips. A final inspector-state fix was rebuilt and all 44 Discover browser tests passed again on that build; these overlap the full-suite total.

Navigation regressions cover English/Arabic phone and desktop layouts, no inference/search/scan on passive navigation, preservation of partial and empty uncached results and drafts, and a fresh keyword search when choosing a Browse category after an AI brief. A deferred-response regression first reproduced and then verified the fix for the Reel inspector resetting its URL/provider when initial effects data arrived.

All eight Browse/Search English/Arabic phone/desktop screenshots were inspected under `test-results/discover-Discover-navigati-cf3b9-ssive-compact-and-bilingual-{phone,desktop}/`. These use synthetic provider responses and intentionally unavailable previews; they establish layout, not live source quality. The final compiled frontend was copied to primary `out/`; localhost:3000 returned HTTP 200 with HTML exactly matching the tested build. The user's active Chrome window was left alone after the computer-use tool detected their input. The temporary test server on 3100 was stopped. Runtime and remaining retrieval/deployment work are recorded in the handover.

### Requested live Chrome follow-up

Later on 9 October, the owner explicitly requested Chrome tests. The actual Chrome tab at localhost:3000 was reloaded and tested through its browser extension, including the real provider responses. Browse/Search/Saved navigation, draft/filter/result preservation, fresh-category reset from an unsubmitted AI brief, disclosures, inspector input preservation, Instagram playback and saved-note persistence passed. One Coffee search showed 6 Instagram, 5 TikTok and 28 YouTube results; all six Instagram thumbnails loaded. This is one live category sample, not a new all-genre audit.

English/Arabic layouts were inspected at the normal desktop size and a temporary 390×844 Chrome viewport. No page-wide horizontal overflow was observed. The viewport, original language/platform/provider choices and temporary saved-item count were restored. A stale Saved empty-state reference to “Explore” was corrected to “Browse” / «تصفّح», rebuilt and verified in live Chrome in both languages. Real screenshots and the remaining source-quality caveat are recorded in the handover.
