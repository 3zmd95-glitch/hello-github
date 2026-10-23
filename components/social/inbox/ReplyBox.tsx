"use client";

import { useId, useState } from "react";
import { useT } from "@/lib/i18n";
import {
  inboxErrorKey,
  isUnconfirmed,
  utf8Bytes,
  type InboxError,
  type InboxResult,
} from "@/lib/inbox";

/**
 * The box under a thread or a comment (planning/tools/51-global-inbox.md): a text, how much of the platform's limit
 * is left (bytes for a DM and a private reply, characters for a public reply; red at zero, Send off past it), and
 * Send. The Worker has no idempotency guard, so Send stays locked while a request is pending. It owns its text and
 * its last result: sent clears the text and calls `onSent` (the parent reads again); an unconfirmed send keeps the
 * text, since it may have gone out (the owner checks the thread); a refusal keeps it too and says why. The result
 * lines are always in the page (a polite `status` and an `alert`), so a screen reader announces what fills them.
 * A parent that switches `kind` (reply or reply privately under one comment) keeps this one instance: the text, the
 * pending send and the last result stay.
 */
export default function ReplyBox({
  kind,
  limit,
  label,
  autoFocus,
  disabled,
  disabledReason,
  onSend,
  onSent,
  testId,
}: {
  kind: "dm" | "comment" | "private";
  limit: { bytes: number } | { chars: number };
  /** The textarea's accessible name; the kind's own ("Reply", "Reply privately") when left out. */
  label?: string;
  /** Focus the text as the box opens (from a toggle; a thread's box does not take focus on its own). */
  autoFocus?: boolean;
  disabled?: boolean;
  /** Why the box is off, shown under it. */
  disabledReason?: string;
  onSend: (text: string) => Promise<InboxResult<unknown>>;
  onSent?: () => void;
  testId: string;
}) {
  const { t } = useT();
  const reasonId = useId();
  const leftId = useId();
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<"sent" | InboxError | null>(null);

  // The Worker trims, then counts: so does the counter. `text.length` is what its public-reply check counts.
  const clean = text.trim();
  const left = "bytes" in limit ? limit.bytes - utf8Bytes(clean) : limit.chars - clean.length;
  const canSend = !disabled && !pending && clean !== "" && left >= 0;

  const send = async () => {
    if (!canSend) return;
    setPending(true);
    setResult(null);
    try {
      const r = await onSend(clean);
      if (r.ok) {
        setText("");
        setResult("sent");
        onSent?.();
      } else setResult(r.error);
    } finally {
      setPending(false);
    }
  };

  // Sent and unconfirmed are news, not refusals: a polite status; only a refusal is an alert.
  const refused = result && result !== "sent" && !isUnconfirmed(result) ? result : null;
  const status =
    result === "sent" ? t("inbox.sent") : result && !refused ? t("inbox.unconfirmed") : "";

  return (
    <div className="flex flex-col gap-2" data-testid={testId}>
      <textarea
        className="px-input min-h-20"
        dir="auto"
        aria-label={label ?? t(kind === "private" ? "inbox.replyPrivately" : "inbox.reply")}
        aria-describedby={[leftId, disabled && disabledReason ? reasonId : ""].join(" ").trim()}
        autoFocus={autoFocus}
        value={text}
        disabled={disabled}
        readOnly={pending}
        onChange={(e) => {
          setText(e.target.value);
          setResult(null);
        }}
        data-testid={`${testId}-text`}
      />
      {disabled && disabledReason && (
        <p id={reasonId} className="text-muted text-[13px]" data-testid={`${testId}-reason`}>
          {disabledReason}
        </p>
      )}
      <div className="flex items-center justify-between gap-3">
        <span
          id={leftId}
          className={`text-[13px] tabular-nums ${left <= 0 ? "text-danger" : "text-muted"}`}
          data-testid={`${testId}-left`}
        >
          {left < 0 ? t("inbox.tooLong") : t("inbox.left", { n: left })}
        </span>
        <button
          type="button"
          className="px-btn px-btn-sm"
          disabled={!canSend}
          onClick={() => void send()}
          data-testid={`${testId}-send`}
        >
          {pending ? t("inbox.sending") : t("inbox.send")}
        </button>
      </div>
      <div data-testid={`${testId}-result`}>
        <p role="status" className="text-ink-2 text-[13px]">
          {status}
        </p>
        <p role="alert" className="text-danger text-[13px]">
          {refused ? t(inboxErrorKey(refused), { detail: refused.detail ?? "" }) : ""}
        </p>
      </div>
    </div>
  );
}
