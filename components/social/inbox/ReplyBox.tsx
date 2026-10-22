"use client";

import { useId, useState } from "react";
import type { InboxPlatform } from "@/lib/domain";
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
 * text, since it may have gone out (the owner checks the app); a refusal keeps it too and says why.
 */
export default function ReplyBox({
  kind,
  platform,
  limit,
  disabled,
  disabledReason,
  onSend,
  onSent,
  testId,
}: {
  kind: "dm" | "comment" | "private";
  platform: InboxPlatform;
  limit: { bytes: number } | { chars: number };
  disabled?: boolean;
  /** Why the box is off, shown under it. */
  disabledReason?: string;
  onSend: (text: string) => Promise<InboxResult<unknown>>;
  onSent?: () => void;
  testId: string;
}) {
  const { t } = useT();
  const reasonId = useId();
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
    const r = await onSend(clean);
    setPending(false);
    if (r.ok) {
      setText("");
      setResult("sent");
      onSent?.();
    } else setResult(r.error);
  };

  const line =
    result === null
      ? null
      : result === "sent"
        ? { role: "status", text: t("inbox.sent") }
        : isUnconfirmed(result)
          ? { role: "status", text: t("inbox.unconfirmed") }
          : { role: "alert", text: t(inboxErrorKey(result), { detail: result.detail ?? "" }) };

  return (
    <div
      className="flex flex-col gap-2"
      data-testid={testId}
      data-kind={kind}
      data-platform={platform}
    >
      <textarea
        className="px-input min-h-20"
        dir="auto"
        aria-label={t(kind === "private" ? "inbox.replyPrivately" : "inbox.reply")}
        aria-describedby={disabled && disabledReason ? reasonId : undefined}
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
      {line && (
        <p
          role={line.role}
          className={`text-[13px] ${line.role === "alert" ? "text-danger" : "text-ink-2"}`}
          data-testid={`${testId}-result`}
        >
          {line.text}
        </p>
      )}
    </div>
  );
}
