# DT-WS-1 — monthly Growth report

Status: **superseded as the automatic next packet** by the owner's correction to https://wsla.io/ on 18 October 2026. Do not start DT-WS-1 from this historical brief. The report idea remains optional backlog; use wsla-inspiration-audit.md and wsla-inbox-search-contract.md for the corrected queue. Original design below is retained as history.

## Outcome and bounded scope

Add “Monthly report” to Growth: choose a calendar month and platform/all, preview a clear AR/EN report, and explicitly print/save PDF through the existing browser-print pattern. Add an allowlisted JSON report download. Reuse the dashboard's design and current saved analytics; no new calendar, store slice, schema migration, dependencies, AI call, integration or scheduler. Proposed scope: new `lib/growthReport.ts` + tests; new `components/social/growth/MonthlyReport.tsx` + tests; narrow GrowthScreen wiring; the existing Growth message bundles; focused e2e; one tool note. Record exact files/start hashes before editing. Analytics/domain/store/Worker/DT-7 files remain pinned.

## Data contract

- A calendar month is a half-open Riyadh interval, including offset-aware publication timestamps. Future months refuse; the current month is labelled partial through the captured report date. Stable ordering/ties; no fallback to posts from another month.
- Select posts by their publication date. Label their numbers **latest saved totals for posts published in this month**, never engagement earned during the month. Top posts rank within that platform's saved sample using a visible metric. Display sample size; missing coverage is not zero performance or all published posts.
- V1 allowlist: snapshot followers/delta, saved post count, saved views/likes/comments/shares, and optional saves with coverage counts. “All” means separate platform sections, not pooled followers/rates/unique audiences. Exclude watch time (mixed average/total meanings in the schema), composite scores and aggregate engagement rates.
- Do not use `platformOverview` as the monthly projection: it chooses an unbounded latest snapshot and can fall back to rolling/last-20 samples. Reuse only helpers whose semantics match these explicit month/date rules.
- Follower snapshots: latest on/before the report cutoff; comparison with latest on/before the preceding month-end. Show both actual snapshot dates and missing/stale coverage. A delta is the change between those observations, not exact monthly growth. No later snapshot leaks into a historical month.
- Rolling `views30d` is not additive and not a calendar-month total. Do not sum/difference overlapping windows or imply reach/unique audiences/ROI. Defaulted zero counters have unknown completeness: label “as saved; unavailable values may be zero.” Unavailable optional values remain unavailable.
- Distinguish snapshot date, post publication date and report generation time. Where fetch time or manual/import/API provenance is absent, say it is not recorded; `lastPullAt` is not per-row verification. Existing seeded/imported rows must never be labelled live verified data.
- Pure detached projection captured once for preview/print/download; changing a filter recaptures explicitly. No mutate/sync action, auto-download or auto-print. Report actions add zero Worker/provider calls; existing Growth sync behavior stays unchanged.
- Export only the displayed report fields. Exclude tokens, origins/config, inbox/drafts/handles, deal contacts, raw notes and private root state. Render user strings as text; accept only safe http(s) post links. No external image embeds needed.

## Acceptance

Test Riyadh month edges/leap year, current-month cutoff, no future leakage, sparse/missing/zero data, snapshot date gaps, platform separation, stable ties and malicious text/links. Canary private fields must be absent in JSON and print DOM. AR/EN labels and phone/desktop layout must agree with the projection; print preview must contain all selected sections and no navigation/private content. Use installed Chrome with synthetic local data and external requests blocked, separately recording actual-browser results. If :3000 is still down, preserve current exports and record the preview prerequisite rather than claiming browser success.

Run relevant tests, typecheck/lint/build and focused browser checks once per applicable source freeze; reuse unchanged evidence. Freeze changed files/hashes and end the writer before review. No push, deploy, OAuth, provider action, paid usage or gate change. A blocked preview or dataset limitation is reported explicitly, never filled with invented results.
