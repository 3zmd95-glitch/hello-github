# Wsla.io inspiration audit and corrected queue

Owner correction, 18 October 2026: the intended reference is **https://wsla.io/**. The earlier wsla.sa agency research remains historical only. Its automatic DT-WS-1 monthly-report queue is withdrawn; it has not been implemented. This correction changes the next inspiration packet, not the active DT-7C-2B-2-R1 repair. Claude remains the sole implementation writer; Codex researches/reviews. Not Discover.

## Evidence boundaries

Public first-party pages reviewed: homepage, WhatsApp API, human handoff, knowledge base, campaign reports, trust page and a TikTok-to-WhatsApp article. Installed Chrome shows an animated Inbox illustration with a conversation list and All/New/Open labels. It does not expose functional message controls in that public illustration. The product link opens https://app.wsla.io/login (WSLA.io Omnichannel, displayed v7.9.2). No credentials, signup, sales contact, form submission or private dashboard inspection occurred.

The descriptions below are vendor claims and visible public examples, not independent proof of production behavior, partner status, security, uptime or our access to any API. We reuse product ideas, not branding, code, customer data or performance claims.

| First-party source | Useful idea | Application and boundary |
| --- | --- | --- |
| [Homepage](https://wsla.io/) | Shared conversations, channel navigation, automation, reports and integration catalog. | Improve finding and processing messages in the existing Inbox. Channel logos never imply working access. |
| [Human handoff](https://wsla.io/ai/whatsapp/human-handoff/) | Explicit human intervention with conversation context and return to automation. | Reuse accepted Instagram control/recovery foundations; later improve context presentation. No duplicate takeover implementation or automatic mode switch. |
| [Knowledge base](https://wsla.io/ai/whatsapp/knowledge-base/) | Replies based on approved information, with escalation when information is missing. | Later private reusable replies/FAQ library and owner-reviewed draft insertion. A knowledge-backed AI agent is not already present or authorized by merely adding templates. |
| [Campaign reports](https://wsla.io/ai/marketing/campaign-reports/) | Calculated metrics, plain Arabic explanations, explicitly missing results. | Useful future reporting principle. Existing organic Growth data cannot be represented as ad spend, conversions or sales. Monthly Growth report remains an optional independent backlog item, no longer the automatic Wsla next step. |
| [WhatsApp API](https://wsla.io/whatsapp-api) | Event delivery, message templates and delivery/read reports. | A future WhatsApp adapter needs its own verified provider/access design. Marketing SDK examples are not an implemented or verified integration contract. |
| [TikTok to WhatsApp](https://wsla.io/en/blog/from-ad-to-live-chat-how-businesses-connect-tiktok-campaigns-to.html) | Ad-origin conversations and follow-up. | Distinguish TikTok advertising traffic into WhatsApp from TikTok-native direct messages. The separate homepage TikTok Inbox claim establishes neither the mechanism nor this owner's API access. |
| [Trust page](https://wsla.io/trust.html) | Explicit limits on activation and vendor claims. | Keep channel readiness factual. No dashboard feature should say connected/available based on a competitor badge. |

## Current source compared with those ideas

- Inbox exists at components/social/inbox/InboxScreen.tsx: Instagram messages/comments; Threads and YouTube owned-content comments. The current platform selector has those three providers. TikTok Inbox and WhatsApp/Messenger/WebChat adapters are absent; TikTok account/music code does not provide DMs.
- ConversationList.tsx renders Instagram conversations in provider order with participant names and time, but has no search. lib/inbox.ts conversation rows contain id, participants and updatedAt, not a message snippet. Search must not pretend to search unloaded history or message bodies.
- Private drafts and reviewed send/status recovery already exist. Instagram/Threads readiness remains closed where recorded, and local Worker acceptance is not deployment. The accepted YouTube path also has separate deployment/grant prerequisites.
- Verified-handle Instagram takeover/resume already exists locally; new registration is gated. Preserve explicit review, existing operation recovery, uncertain delivery and in-flight notices. A new local conversation status/tag must never imply provider read state, delivery or automatic takeover.
- Cross-provider aggregate search, persistent conversation tags/status/notes, reusable-reply management and company-knowledge retrieval require later bounded designs. Team assignment is lower priority in the current solo-creator scope.
- Existing AutoReplies rules, scheduling, Growth, Business Kit and integration settings should be extended rather than cloned. CRM/shop connectors, bulk messaging, ad-spend automation and call-center tools are not included merely because Wsla markets them.

## Corrected sequence

1. Finish the current DT-7C-2B-2-R1 repairs and independent acceptance; no writer interruption or scope expansion.
2. **DT-WIO-1: Instagram loaded-conversation search**, under wsla-inbox-search-contract.md. One Sonnet writer after acceptance and ownership release, followed by independent Codex review and installed-Chrome tests. This is a small functional Inbox improvement, not completion of Wsla parity.
3. Return to DT-7 completion. Keep a Wsla.io backlog for scoped private tags/status, reusable replies/approved knowledge, handoff context and grounded analytics. TikTok Inbox/WhatsApp require official endpoint and grant evidence before implementation or availability claims. No subscriptions, account creation or credentials needed for this public comparison.

The old monthly-report specification is preserved with a superseded status. Existing readiness, live cutover, DT-7C/D/E, DT-8–DT-10 and TikTok Inbox gaps remain open. Product source was not changed by this correction.
