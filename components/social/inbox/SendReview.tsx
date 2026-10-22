"use client";

import { ExternalLink, Send } from "lucide-react";
import { useEffect, useState } from "react";
import Sheet, { useSheetClose } from "@/components/ui/ios/Sheet";
import { useT, type MessageKey } from "@/lib/i18n";
import { validDraft, youtubeCommentLink, type Capability, type SendIntent } from "@/lib/inbox";
import { useStore, type InboxDraft } from "@/store";
import {
  cancelReply,
  checkReply,
  confirmReply,
  finishReply,
  prepareReply,
  useSendViews,
  type SendView,
} from "./useSend";

/**
 * 📤 "Send as public reply" for one YouTube draft and its review sheet (packet DT-6B-2A, planning/tools/37-inbox-send.md).
 * Offered only with the comment permission, a send target and a saved draft. The sheet shows the account, the public
 * destination (a nested row names its top-level parent), the exact text the Worker captured and the review's expiry;
 * Send is the one action that posts. Unknown outcomes offer Check status only, never a resend.
 * DT-6B-2A-R1: a stored operation is recovered from its handle alone (no saved draft or earlier answer needed, 2A-7);
 * the review names the exact receiving comment (its text when that row is loaded, its id and link always, 2A-8); a
 * successful Clear draft tells the editor (2A-9).
 * DT-6B-2A-R2: a stored operation stays recoverable when sending is unavailable (no permission, no target): the opener
 * becomes Check status and the sheet never offers Send or Prepare again (2A-R1-D). An answer another tab superseded
 * shows the stored state with Check status (2A-R1-B).
 */

export interface ReplyTarget {
  sendRef: string | undefined;
  account: string;
  generation: string;
  accountName: string;
  videoTitle: string | undefined;
  parentAuthor: string | undefined;
  /** The loaded top-level comment this row replies under (its text is shown only when the intent names this id). */
  parentId?: string;
  parentText?: string;
  /** A reply row: the reply goes under its top-level parent. */
  nested: boolean;
  /** `capabilities.sendComments` of the account answer. */
  capability: Capability | undefined;
}

const SETTLED = ["sent", "rejected", "expired", "cancelled", "error", "closed"];
/** The longest parent excerpt shown in the review (characters). */
const PARENT_EXCERPT = 280;

function Expiry({ at, onEnd }: { at: string; onEnd: () => void }) {
  const { t } = useT();
  const [now, setNow] = useState(() => Date.now());
  const left = Math.max(0, Date.parse(at) - now);
  useEffect(() => {
    if (left <= 0) {
      onEnd();
      return;
    }
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [left, onEnd]);
  const s = Math.ceil(left / 1000);
  const time = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  return (
    <p className="text-muted text-[13px]" data-testid="ibx-send-expires">
      {t("inbox.send.expires", { time })}
    </p>
  );
}

function SheetBody({
  scope,
  target,
  view,
  draftText,
  hasOp,
  canSend,
  status,
  onCleared,
}: {
  scope: string;
  target: ReplyTarget;
  view: SendView;
  draftText: string;
  /** A stored operation handle exists: Check status reads it back. */
  hasOp: boolean;
  /** A new send may start here; false is status-only recovery of the stored operation (2A-R1-D). */
  canSend: boolean;
  /** What the stored handle says, when it says something (2A-R1-B). */
  status: MessageKey | null;
  onCleared?: (draft: InboxDraft) => void;
}) {
  const { t } = useT();
  const close = useSheetClose();
  const i = view.intent;
  const send = {
    sendRef: target.sendRef ?? "",
    account: target.account,
    generation: target.generation,
  };
  const line = (key: MessageKey, vars?: Record<string, string | number>) => (
    <p className="text-ink-2 text-[15px]" role="status">
      {t(key, vars)}
    </p>
  );
  const btn = (
    id: string,
    label: MessageKey,
    onClick: () => void,
    primary = false,
    disabled = false,
  ) => (
    <button
      type="button"
      className={`px-btn px-btn-sm ${primary ? "" : "px-btn-ghost"}`}
      disabled={disabled}
      onClick={onClick}
      data-testid={id}
    >
      {t(label)}
    </button>
  );
  const again = () =>
    void finishReply(scope).then(() => {
      const saved = useStore.getState().inboxDrafts[scope];
      if (saved) void prepareReply(scope, send, saved.text, saved.commitId);
    });
  const check = () => void checkReply(scope, send);
  const errorLine = (cls: string) =>
    view.error && (
      <p className={`text-danger ${cls}`} role="alert" data-testid="ibx-send-error">
        {t(`inbox.send.err.${view.error}` as MessageKey)}
        {view.detail ? ` ${t(`inbox.send.setup.${view.detail}` as MessageKey)}` : ""}
      </p>
    );

  if (view.phase === "preparing" || view.phase === "idle") return line("inbox.send.preparing");
  if (view.phase === "closed")
    return (
      <>
        {line("inbox.send.closed")}
        <div className="flex gap-2">{btn("ibx-send-close", "inbox.send.close", close)}</div>
      </>
    );
  if (view.phase === "error")
    return (
      <>
        {errorLine("text-[15px]")}
        {status && (view.error === "superseded" || view.error === "unrecorded") && line(status)}
        <div className="flex gap-2">
          {hasOp && btn("ibx-send-check", "inbox.send.check", check, true)}
          {btn("ibx-send-close", "inbox.send.close", close)}
        </div>
      </>
    );

  const details = (x: SendIntent) => {
    const where = t(target.nested ? "inbox.send.whereNested" : "inbox.send.whereTop", {
      author: target.parentAuthor ?? t("inbox.author.unknown"),
      video: target.videoTitle ?? t("inbox.yt.untitled"),
    });
    // The receiving comment is the intent's own parent: a loaded row lends its text only when it is that comment.
    const parentText = target.parentId === x.parentCommentId ? target.parentText : undefined;
    const excerpt =
      parentText && parentText.length > PARENT_EXCERPT
        ? `${parentText.slice(0, PARENT_EXCERPT)}…`
        : parentText;
    const parentLink = youtubeCommentLink(x.videoId, x.parentCommentId);
    return (
      <dl className="flex flex-col gap-2 text-[15px]">
        <div>
          <dt className="text-ink-2 text-[13px] font-semibold">{t("inbox.send.account")}</dt>
          <dd data-testid="ibx-send-account">
            <bdi dir="auto">{target.accountName}</bdi>
          </dd>
        </div>
        <div>
          <dt className="text-ink-2 text-[13px] font-semibold">{t("inbox.send.where")}</dt>
          <dd data-testid="ibx-send-where">{where}</dd>
        </div>
        <div>
          <dt className="text-ink-2 text-[13px] font-semibold">{t("inbox.send.parent")}</dt>
          <dd className="flex flex-col gap-1" data-testid="ibx-send-parent">
            {excerpt ? (
              <p
                className="ios-list p-2 break-words whitespace-pre-wrap"
                dir="auto"
                data-testid="ibx-send-parent-text"
              >
                {excerpt}
              </p>
            ) : (
              <p className="text-muted text-[13px]">{t("inbox.send.parentNotLoaded")}</p>
            )}
            <p className="text-muted text-[13px] break-all" data-testid="ibx-send-parent-id">
              {t("inbox.send.parentId")} <bdi dir="ltr">{x.parentCommentId}</bdi>
            </p>
            {parentLink && (
              <a
                href={parentLink}
                target="_blank"
                rel="noopener noreferrer"
                className="px-link inline-flex items-center gap-1 text-[13px]"
                data-testid="ibx-send-parent-link"
              >
                <ExternalLink size={12} aria-hidden />
                {t("inbox.send.openParent")}
              </a>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-ink-2 text-[13px] font-semibold">{t("inbox.send.text")}</dt>
          <dd>
            <p
              className="ios-list p-3 break-words whitespace-pre-wrap"
              dir="auto"
              data-testid="ibx-send-text"
            >
              {x.text}
            </p>
          </dd>
        </div>
      </dl>
    );
  };

  // Unknown needs no intent: after a reload whose lookup failed, the handle alone says the result is uncertain (2A-7).
  if (view.phase === "unknown") {
    const why =
      view.error === "mismatch"
        ? "mismatch"
        : !i
          ? "lookup"
          : i.state === "dispatching" || !i.unknownReason
            ? "inflight"
            : i.unknownReason;
    return (
      <>
        <p className="text-warn text-[15px]" role="alert">
          {t("inbox.send.unknown")}
        </p>
        <p className="text-ink-2 text-[13px]" data-testid="ibx-send-why">
          {t(`inbox.send.why.${why}` as MessageKey)}
        </p>
        {i && details(i)}
        <div className="flex flex-wrap gap-2">
          {btn("ibx-send-check", "inbox.send.check", check, true)}
          {btn("ibx-send-close", "inbox.send.close", close)}
        </div>
      </>
    );
  }
  if (!i) return line("inbox.send.preparing");

  if (view.phase === "review" || view.phase === "sending")
    return (
      <>
        {details(i)}
        {draftText.trim() !== i.text && (
          <p className="text-warn text-[13px]" data-testid="ibx-send-differs">
            {t("inbox.send.differs")}
          </p>
        )}
        {view.phase === "review" ? (
          <Expiry at={i.reviewExpiresAt} onEnd={check} />
        ) : (
          line("inbox.send.sending")
        )}
        {errorLine("text-[13px]")}
        <div className="flex flex-wrap gap-2">
          {btn("ibx-send-cancel", "inbox.send.cancel", close, false, view.phase === "sending")}
          {canSend &&
            btn(
              "ibx-send-confirm",
              "inbox.send.confirm",
              () => void confirmReply(scope, send),
              true,
              view.phase === "sending",
            )}
        </div>
      </>
    );

  if (view.phase === "sent") {
    const link = i.providerCommentId
      ? youtubeCommentLink(i.videoId, i.providerCommentId)
      : undefined;
    const clear = () =>
      void finishReply(scope, true).then((cleared) => {
        if (cleared === "failed") return;
        if (cleared) onCleared?.(cleared);
        close();
      });
    return (
      <>
        {line("inbox.send.sent")}
        {link && (
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            className="px-link inline-flex items-center gap-1 text-[15px]"
            data-testid="ibx-send-link"
          >
            <ExternalLink size={14} aria-hidden />
            {t("inbox.send.openReply")}
          </a>
        )}
        {details(i)}
        {errorLine("text-[13px]")}
        <div className="flex flex-wrap gap-2">
          {btn("ibx-send-keep", "inbox.send.keep", close)}
          {btn("ibx-send-clear", "inbox.send.clear", clear)}
        </div>
      </>
    );
  }

  // rejected, expired, cancelled: nothing was posted; a new review is needed.
  return (
    <>
      {view.phase === "rejected"
        ? line("inbox.send.rejected", { code: i.failureCode ?? "?" })
        : line(view.phase === "expired" ? "inbox.send.expired" : "inbox.send.cancelled")}
      {details(i)}
      <div className="flex flex-wrap gap-2">
        {canSend && btn("ibx-send-again", "inbox.send.again", again, true)}
        {btn("ibx-send-close", "inbox.send.close", close)}
      </div>
    </>
  );
}

export default function SendReview({
  scope,
  target,
  draft,
  onCleared,
}: {
  scope: string;
  target: ReplyTarget;
  /** The editor's current text and the saved draft (its commit id is the revision that can be sent). */
  draft: { text: string; saved: InboxDraft | undefined };
  /** Called with the draft a successful "Clear draft" discarded (DT-6B-2A-R1, 2A-9). */
  onCleared?: (draft: InboxDraft) => void;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const view = useSendViews((s) => s.views[scope]) ?? { phase: "idle", intent: null, error: null };
  const op = useStore((s) => s.inboxSendOps[scope]);

  const canSend = target.capability === "ok" && !!target.sendRef;
  // A Worker older than DT-6B-2A says nothing about sending: nothing to offer, nothing to explain, unless an operation
  // is already stored here: it stays recoverable (2A-R1-D).
  if (target.capability === undefined && !op) return null;
  const why = target.capability !== undefined && !canSend && (
    <p className="text-muted text-[13px]" data-testid="ibx-send-note">
      {t(target.capability !== "ok" ? "inbox.send.noPermission" : "inbox.send.noTarget")}
    </p>
  );
  if (!canSend && !op) return why;
  const sendTarget = {
    sendRef: target.sendRef ?? "",
    account: target.account,
    generation: target.generation,
  };
  const saved = draft.saved;
  const ready =
    !!saved && draft.text === saved.text && !!saved.text.trim() && validDraft(saved.text);
  const status =
    op && ["prepared", "dispatching", "unknown", "sent"].includes(op.state)
      ? (`inbox.send.status.${op.state === "dispatching" ? "unknown" : op.state}` as MessageKey)
      : null;

  // 2A-7: a stored operation is read back from its handle even when no draft is saved any more. Without send
  // capability only that read back happens: recovery never prepares (2A-R1-D).
  const start = () => {
    setOpen(true);
    if (saved && canSend) void prepareReply(scope, sendTarget, saved.text, saved.commitId);
    else if (op) void checkReply(scope, sendTarget);
  };
  const onClose = () => {
    setOpen(false);
    const phase = useSendViews.getState().views[scope]?.phase;
    if (phase === "review") void cancelReply(scope);
    else if (phase === "sent") void finishReply(scope, false);
    else if (phase && SETTLED.includes(phase)) void finishReply(scope);
  };

  return (
    <div className="flex flex-col gap-1">
      {why}
      {!canSend && (
        <p className="text-ink-2 text-[13px]" data-testid="ibx-send-recover-note">
          {t("inbox.send.recoverOnly")}
        </p>
      )}
      <button
        type="button"
        className="px-btn px-btn-sm self-start"
        disabled={!ready && !op}
        onClick={start}
        data-testid="ibx-send-open"
      >
        <Send size={14} aria-hidden />
        {t(canSend ? "inbox.send.open" : "inbox.send.check")}
      </button>
      {!ready && !op && (
        <p className="text-muted text-[13px]" data-testid="ibx-send-note">
          {t("inbox.send.saveFirst")}
        </p>
      )}
      {status && (
        <p className="text-ink-2 text-[13px]" data-testid="ibx-send-status" data-state={op?.state}>
          {t(status)}
        </p>
      )}
      {!open && view.error === "cancelFailed" && (
        <p className="text-danger text-[13px]" role="alert" data-testid="ibx-send-cancel-failed">
          {t("inbox.send.err.cancelFailed")}
        </p>
      )}
      {open && (
        <Sheet
          onClose={onClose}
          title={t("inbox.send.title")}
          titleId={`ibx-send-${scope}`}
          testId="ibx-send-sheet"
          attrs={{ "data-phase": view.phase }}
        >
          <div className="flex flex-col gap-3 p-4">
            <SheetBody
              scope={scope}
              target={target}
              view={view}
              draftText={draft.text}
              hasOp={!!op}
              canSend={canSend}
              status={status}
              onCleared={onCleared}
            />
          </div>
        </Sheet>
      )}
    </div>
  );
}
