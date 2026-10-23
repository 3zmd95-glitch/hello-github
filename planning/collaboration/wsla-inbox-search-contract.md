# DT-WIO-1 — find loaded Instagram conversations

Queued under the owner's corrected https://wsla.io/ inspiration request. Replaces the old automatic DT-WS-1 monthly-report queue. Start only after DT-7C-2B-2 including repairs is independently accepted and its writer releases ownership. One focused Sonnet writer; Codex independent review. Record exact scope/start hashes before editing. Read the applicable bundled Next.js guide. No concurrent implementation.

## Useful outcome

In the existing Instagram conversation list, find a person using their returned username or participant id. Show a labelled search input, explicit Clear, matching/loaded counts, and a distinct no-match message. State that this searches loaded conversations only; message bodies and unloaded history are not searched. This is creator Inbox usability inspired by the reference's conversation-first presentation, not a claim of recreating its private application.

## Bounded code scope

`components/social/inbox/ConversationList.tsx` and a focused test; optional pure `lib/inboxConversationSearch.ts` + test; only relevant additions in `messages/inbox.en.json` / `.ar.json`; a focused browser spec; tool 36 note and handoff. Exact file list must be recorded first. No changes to InboxScreen/ConversationView/CommentsView/ProviderView, read hooks, selection actions, drafts, send/control code, domain/schema/store, Worker, gates, packages or configuration. Reuse current styles and accessible input/button patterns.

## Behavior

- Use the currently exposed account/Worker identity and conversation rows only. Exclude the owner from participant matches just as the existing displayed names do. Match each non-owner participant's returned username/id; do not invent names or snippets. Blank or whitespace query returns all rows in their original order. Literal case-insensitive substring matching, Unicode NFC normalization, no regular-expression interpretation. Do not silently fold different Arabic letters or claim transliteration.
- Bound the query (for example 200 characters); treat all strings as text. Keep ids/selection unchanged and provider order stable. Query and derived matches stay local memory, never persisted, logged remotely, copied into drafts or sent to any endpoint.
- Reset or key query by the existing read-only reader identity (origin, account, generation) so switching connections/accounts cannot retain a misleading filter. A remount may reset it. No token read or new fetch is needed.
- Pass the **original unfiltered list** to ListFooter. Keep its loading, real empty source, partial/error/cap/history coverage and explicit Load more behavior. A filter with no matches is not an empty provider inbox. Show no-match only once loaded rows exist; do not hide errors behind it. Search/Clear trigger zero requests; Load more and Refresh retain their current explicit behavior. Newly loaded rows join the filter without auto-pagination.
- Preserve opening a result and existing recovery lists. No unread/new/open/resolved labels, team assignment, tags or message-state inference in this slice: current conversation rows do not support those claims. No new provider tabs.
- EN/AR, keyboard navigation, visible focus, labelled counts, mobile width and RTL names must work. Do not trap focus or auto-open a result.

## Validation and freeze

Focused meaningful tests: Arabic/Latin names, ids, owner exclusion, absent usernames, normalized text, literal punctuation, blank/clear, stable provider order, no-match vs real empty/error/partial/cap, new loaded page, identity switch, unchanged exact selection, and zero network writes/extra reads from search. Translation key parity. Test with synthetic data, never configured owner credentials.

Run relevant unit/component checks, final typecheck/lint/build, and a focused installed-Chrome desktop/Arabic-phone check with external requests blocked. Reuse unchanged send/control/Worker evidence. This UI packet needs a current export: if preview is down, verify no conflicting listener and use the repository's existing local preview command on **localhost:3000** from this managed worktree for the authorized local tests; no other port or provider session. Record source/build/served identity and any actual blocker honestly. This does not relax the active R1 packet's no-server rule before ownership release.

Use durable evidence outside TEMP; redirect copied-probe paths before execution. Freeze changed files/hashes and end all writer/check tasks before review. No live messages/control actions, account creation, OAuth/grants/secrets, paid use, deployment, push/merge or readiness change. Return to DT-7 after this bounded slice. Later Wsla.io tags/knowledge/handoff/report work remains separately scoped.
