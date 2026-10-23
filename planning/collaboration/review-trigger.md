# Immediate Claude completion → existing Codex review

The user requested event-driven review on13October2026. This replaces the15-minute
polling automation. No new reviewer thread, API billing or background model loop.

## Claude's handoff

1. Finish the bounded packet and its necessary checks. Wait for implementation and
   validation background tasks. Record exact source hashes and honest evidence in
   `current-task.md`; distinguish actual Chrome observations from mocked tests.
2. Freeze source changes and set `Implementation owner: none.` on its own line.
3. End the main Training Page response with one unique line:
   `[CODEX_REVIEW_READY:packet-6]`
4. Stay idle pending Codex. Use a new ID for a repaired candidate or new evidence,
   such as `packet-6-r1`. Do not emit the marker for ordinary progress messages.

The Stop event is the trigger. It queues a compact request into the existing Codex
chat, preserving its selected model and context. It ignores other sessions, subagents,
other folders, active background tasks/crons and packets with an implementation owner.
Each packet has an exclusive lock and persistent receipt. Repeated Stop events never
queue that packet twice. An ambiguous delivery stays recorded; inspect the chat/queue
before retrying. No automatic retry loop or silent approval.

## Local installation

- Claude Training Page session: `1f24b7e7-4e9f-40ef-ba49-290befb01772`.
- Codex chat: `01a1052d-dc23-7013-918a-2bf6b0f05364`.
- Source hook: `.claude/hooks/notify-codex.cjs` in this managed worktree.
- Installed hook: `C:/Users/AORUS/Documents/hello-github/.claude/settings.local.json`.
  Training Page is registered in that primary directory; only the hook configuration
  goes there. Product source stays in the managed worktree.
- Local config: `C:/Users/AORUS/.codex/discover-review-trigger/config.json`.
- Receipts: `C:/Users/AORUS/.codex/discover-review-trigger/receipts/<packet-id>.json`.
- Disable by setting local config `enabled` false. A new Claude session must be
  explicitly rebound in the config; unrelated sessions cannot trigger this chat.

`queued` means the CLI accepted a message, not that review passed. Codex records
`receivedAt` when the event reaches the chat, and records review/delivery separately.
If this chat is busy, the request waits in its queue. The app/local daemon must be
available. The hook reports delivery errors without launching a second Codex process
to do the review. For an ambiguous/crashed dispatch, keep the receipt until checked.

## Setup evidence and reuse decision

Reused the installed `codex queue --thread ... --message ...` command (CLI
0.162.0-alpha.17.2) and Claude2.1.295's standard Stop hooks. No new dependency or
orchestrator service. The installed Codex Companion plugin has its own optional review
gate; it is disabled and must stay disabled for this workflow because it starts a
different reviewer. Only this small session/packet gate was added.

Six Node tests passed for session/path/marker scoping, frozen ownership/background
work, exactly-once dispatch, concurrent invocations, ambiguous delivery and test probes.
A real CLI queue smoke test was accepted as message
`01a134f5-e01a-7f32-8221-54f00061f950` for the correct existing chat. Receipt of a genuine
Claude Stop event is a separate live check.

That live check passed after the user accepted workspace trust: Training Page emitted
`probe-20261013-live`, and its real Stop hook queued message
`01a134fe-3e37-7833-9278-d4bc9193227c` at11:20:39UTC on13October2026. The receipt records
the exact target chat and frozen handoff hash. Codex will separately stamp `receivedAt`
when that queued message is processed; queue acceptance is not a completed review.

References: [Claude Stop hook](https://code.claude.com/docs/en/hooks#stop),
[Codex non-interactive integration](https://learn.chatgpt.com/docs/non-interactive-mode).
The exact queue command was verified against this installed CLI's own help.
