"use client";

import { Send } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import Sheet, { useSheetClose } from "@/components/ui/ios/Sheet";
import { useT, type MessageKey } from "@/lib/i18n";
import { inboxScope, workerOrigin, type InboxList, type MessageItem } from "@/lib/inbox";
import {
  DM_TEXT_BYTES_MAX,
  dmCanonicalText,
  dmOpKey,
  dmTextBytes,
  dmTextEligible,
  instagramDmSendReadiness,
  type DmIntent,
} from "@/lib/inboxInstagramDmSend";
import { scoutConfig } from "@/lib/scoutClient";
import { useStore, type InboxDraft, type InboxInstagramDmSendOp } from "@/store";
import { When } from "./parts";
import { useInbox } from "./useInbox";
import {
  cancelInstagramDmReply,
  checkInstagramDmReply,
  confirmInstagramDmReply,
  finishInstagramDmReply,
  isLiveInstagramDmOp,
  newInstagramDmVisit,
  prepareInstagramDmReply,
  useInstagramDmViews,
  type DmSendTarget,
  type DmSendView,
} from "./useInstagramDmSend";

/**
 * 💬 "Send as DM reply" for the explicitly selected inbound message of an opened conversation, its review sheet, and the
 * recovery list (packet DT-6B-2C-5A, planning/tools/37-inbox-send.md). Production readiness is closed
 * (`instagramDmSendReadiness`), so the opener is disabled with the honest reason and nothing is prepared or sent; a
 * retained operation always opens to Check status, without its row, draft, account read or permission. The review shows
 * the sending account, the conversation, the recipient id (and a name only when a loaded row of this conversation pairs
 * it with that id), the exact inbound message (id, the Worker-proven time, a preview only from the loaded row), the
 * Worker's canonical text and a local countdown. A sent DM shows its message id as text: no link is built from it. A lost
 * settlement is shown as pending uncertainty with Check status only. Closing never cancels; Cancel, Close and Copy are
 * distinct. Nothing here registers a control handle, takes over, resumes or changes a conversation's mode.
 */

export interface DmReplyTarget extends DmSendTarget {
  accountName: string | null;
}

/** Phases whose operation is settled: closing the sheet finishes them. */
const SETTLED = ["sent", "rejected", "already_claimed", "expired", "cancelled", "error", "closed"];
const EXCERPT = 280;
/** Reasons the Worker records (or observes) for an unknown outcome that have their own copy. */
const REASONS = [
  "timeout",
  "network",
  "server",
  "malformed",
  "oversize",
  "redirect",
  "receipt",
  "recipient",
];
const HOLDERS = ["automatic", "manual", "retired"];

const excerpt = (text: string | undefined) =>
  text && text.length > EXCERPT ? `${text.slice(0, EXCERPT)}…` : text;

/** The loaded messages of a handle's (or target's) conversation on its own Worker and account. */
function useRows(origin: string, account: string, conversationId: string): MessageItem[] {
  const lists = useInbox((s) => s.lists);
  return (
    (
      lists[inboxScope(origin, account, "messages", conversationId)] as
        InboxList<MessageItem> | undefined
    )?.items ?? []
  );
}

/**
 * The loaded row that is exactly the selected inbound message: same id, same sender (the operation's recipient) and, when
 * known, the same time. Any mismatch borrows nothing (2C5A-2).
 */
const rowOf = (rows: MessageItem[], id: string, sender: string, at: string | null | undefined) =>
  rows.find(
    (m) =>
      m.id === id &&
      m.from?.id === sender &&
      (!at || (!!m.createdAt && Date.parse(m.createdAt) === Date.parse(at))),
  );

/** A display name only when a loaded row of this conversation pairs it with exactly this sender id. */
const nameOf = (rows: MessageItem[], id: string): string | null => {
  const names = new Set(
    rows.filter((m) => m.from?.id === id && m.from.username).map((m) => m.from!.username!),
  );
  return names.size === 1 ? [...names][0] : null;
};

/** A local countdown only: at zero it says so and turns Send off; it never asks the Worker by itself. */
function Expiry({ at, onEnd }: { at: string; onEnd: () => void }) {
  const { t } = useT();
  const [now, setNow] = useState(() => Date.now());
  const left = Math.max(0, Date.parse(at) - now);
  useEffect(() => {
    if (left <= 0) return onEnd();
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [left, onEnd]);
  if (left <= 0)
    return (
      <p className="text-warn text-[13px]" data-testid="ibx-igdm-time-up">
        {t("inbox.igDm.timeUp")}
      </p>
    );
  const s = Math.ceil(left / 1000);
  const time = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  return (
    <p className="text-muted text-[13px]" data-testid="ibx-igdm-expires">
      {t("inbox.igDm.expires", { time })}
    </p>
  );
}

/** Who sends, the conversation, the recipient, the exact inbound message and the canonical text. */
function Details({
  i,
  origin,
  accountName,
}: {
  i: DmIntent;
  origin: string;
  accountName: string | null;
}) {
  const { t } = useT();
  const rows = useRows(origin, i.account, i.conversationId);
  const row = rowOf(rows, i.inboundMessageId, i.recipientId, i.inboundAt);
  const name = nameOf(rows, i.recipientId);
  const label = "text-ink-2 text-[13px] font-semibold";
  const id = (key: MessageKey, v: string, testId: string) => (
    <p className="text-muted text-[13px] break-all" data-testid={testId}>
      {t(key)} <bdi dir="ltr">{v}</bdi>
    </p>
  );
  return (
    <dl className="flex flex-col gap-2 text-[15px]">
      <div>
        <dt className={label}>{t("inbox.igDm.account")}</dt>
        <dd data-testid="ibx-igdm-account">
          <bdi dir="ltr">{accountName ? `@${accountName}` : i.account}</bdi>
        </dd>
      </div>
      <div>
        <dt className={label}>{t("inbox.igDm.conversation")}</dt>
        <dd>{id("inbox.igDm.conversationId", i.conversationId, "ibx-igdm-conversation-id")}</dd>
      </div>
      <div>
        <dt className={label}>{t("inbox.igDm.recipient")}</dt>
        <dd className="flex flex-col gap-1">
          {name ? (
            <span data-testid="ibx-igdm-recipient-name">
              <bdi dir="ltr">@{name}</bdi>
            </span>
          ) : (
            <span className="text-muted text-[13px]">{t("inbox.igDm.recipientUnknown")}</span>
          )}
          {id("inbox.igDm.recipientId", i.recipientId, "ibx-igdm-recipient-id")}
        </dd>
      </div>
      <div>
        <dt className={label}>{t("inbox.igDm.inbound")}</dt>
        <dd className="flex flex-col gap-1">
          {row?.text ? (
            <p
              className="ios-list p-2 break-words whitespace-pre-wrap"
              dir="auto"
              data-testid="ibx-igdm-inbound-text"
            >
              {excerpt(row.text)}
            </p>
          ) : (
            <p className="text-muted text-[13px]" data-testid="ibx-igdm-inbound-unavailable">
              {t("inbox.igDm.inboundUnavailable")}
            </p>
          )}
          <p className="text-muted text-[13px]" data-testid="ibx-igdm-inbound-time">
            <When iso={i.inboundAt} />
          </p>
          {id("inbox.igDm.inboundId", i.inboundMessageId, "ibx-igdm-inbound-id")}
        </dd>
      </div>
      <div>
        <dt className={label}>{t("inbox.igDm.text")}</dt>
        <dd>
          <p
            className="ios-list p-3 break-words whitespace-pre-wrap"
            dir="auto"
            data-testid="ibx-igdm-text"
          >
            {i.text}
          </p>
        </dd>
      </div>
    </dl>
  );
}

function SheetBody({
  opKey,
  target,
  view,
  draftText,
  hasOp,
  canSend,
  origin,
  status,
}: {
  opKey: string;
  target: DmReplyTarget;
  view: DmSendView;
  draftText: string;
  hasOp: boolean;
  /** Readiness is open for this row (never in production, never from the recovery list). */
  canSend: boolean;
  origin: string;
  status: MessageKey | null;
}) {
  const { t } = useT();
  const close = useSheetClose();
  const check = useCallback(() => void checkInstagramDmReply(opKey), [opKey]);
  const i = view.intent;
  // "Time is up" belongs to the reviewed operation and its deadline: a new review starts with time left (2C5A-1).
  const review = i ? `${i.operationId}|${i.reviewExpiresAt}` : null;
  const [endedFor, setEndedFor] = useState<string | null>(null);
  const timeUp = review !== null && endedFor === review;
  const ended = useCallback(() => setEndedFor(review), [review]);
  const line = (key: MessageKey, vars?: Record<string, string | number>, cls = "text-ink-2") => (
    <p className={`${cls} text-[15px]`} role="status">
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
    void finishInstagramDmReply(opKey).then(() => {
      const scope = inboxScope(origin, target.account, "conversation", target.conversationId);
      const saved = useStore.getState().inboxDrafts[scope];
      if (saved) void prepareInstagramDmReply(opKey, target, saved.text, saved.commitId);
    });
  const errorLine = view.error && (
    <p className="text-danger text-[13px]" role="alert" data-testid="ibx-igdm-error">
      {t(`inbox.igDm.err.${view.error}` as MessageKey)}
      {view.detail ? ` ${t(`inbox.igDm.detail.${view.detail}` as MessageKey)}` : ""}
    </p>
  );
  const reason =
    i?.unknownReason ?? (view.pending?.observed === "unknown" ? view.pending.code : undefined);
  const why =
    reason && REASONS.includes(reason) ? (
      <p className="text-ink-2 text-[13px]" data-testid="ibx-igdm-why">
        {t(`inbox.igDm.why.${reason}` as MessageKey)}
      </p>
    ) : null;
  const actions = (...more: ReactNode[]) => {
    const extra = more.filter(Boolean);
    return (
      <div className="flex flex-wrap gap-2">
        {extra}
        {hasOp && btn("ibx-igdm-sheet-check", "inbox.igDm.check", check, extra.length === 0)}
        {btn("ibx-igdm-close", "inbox.igDm.close", close)}
      </div>
    );
  };
  const details = i && <Details i={i} origin={origin} accountName={target.accountName} />;

  if (view.phase === "preparing" || view.phase === "idle") return line("inbox.igDm.preparing");
  if (view.phase === "closed")
    return (
      <>
        {line("inbox.igDm.closed")}
        {actions()}
      </>
    );
  if (view.phase === "error")
    return (
      <>
        {errorLine}
        {status &&
          (view.error === "superseded" ||
            view.error === "unrecorded" ||
            view.error === "unresolved") &&
          line(status)}
        {actions()}
      </>
    );
  if (view.phase === "uncertain")
    return (
      <>
        {line("inbox.igDm.uncertain", undefined, "text-warn")}
        {errorLine}
        {details}
        {actions()}
      </>
    );
  if (view.phase === "dispatching" || view.phase === "unknown") {
    // A lost settlement: the durable truth is dispatching; what was observed is uncertainty, never an outcome.
    const pending = view.phase === "dispatching" ? view.pending : undefined;
    return (
      <>
        <div
          data-testid="ibx-igdm-pending"
          data-observed={pending?.observed ?? "none"}
          className="contents"
        >
          {pending
            ? line(
                pending.observed === "rejected"
                  ? "inbox.igDm.pending.rejected"
                  : "inbox.igDm.pending.unknown",
                { code: pending.code },
                "text-warn",
              )
            : line(
                view.phase === "unknown" ? "inbox.igDm.unknown" : "inbox.igDm.dispatching",
                undefined,
                view.phase === "unknown" ? "text-warn" : "text-ink-2",
              )}
        </div>
        {why}
        {errorLine}
        {details}
        {actions()}
      </>
    );
  }

  const prepareAgain = canSend ? (
    <span key="again">{btn("ibx-igdm-again", "inbox.igDm.again", again, true)}</span>
  ) : null;

  if (view.phase === "cancelled" || view.phase === "expired")
    return (
      <>
        {line(view.phase === "expired" ? "inbox.igDm.expired" : "inbox.igDm.cancelled")}
        {details}
        {actions(prepareAgain)}
      </>
    );

  if (!i) return line("inbox.igDm.preparing");

  if (view.phase === "already_claimed") {
    const by = HOLDERS.includes(i.failureDetail ?? "") ? i.failureDetail : "manual";
    return (
      <>
        {line(`inbox.igDm.claimed.${by}` as MessageKey)}
        {details}
        {actions()}
      </>
    );
  }

  if (view.phase === "review" || view.phase === "confirming") {
    // DT-6B-3C: an older review whose text is over today's 1000 UTF-8 bytes is shown as it is and never sent.
    const over = dmTextEligible(i.text) !== i.text;
    return (
      <>
        {details}
        {over && (
          <p className="text-danger text-[13px]" role="alert" data-testid="ibx-igdm-over-limit">
            {t("inbox.igDm.overLimit", { bytes: dmTextBytes(i.text) })}
          </p>
        )}
        {draftText && dmCanonicalText(draftText) !== i.text && (
          <p className="text-warn text-[13px]" data-testid="ibx-igdm-differs">
            {t("inbox.igDm.differs")}
          </p>
        )}
        {view.phase === "review" ? (
          <Expiry at={i.reviewExpiresAt} onEnd={ended} />
        ) : (
          line("inbox.igDm.confirming")
        )}
        <p className="text-muted text-[13px]">{t("inbox.igDm.modeNote")}</p>
        {errorLine}
        {actions(
          <span key="cancel">
            {btn(
              "ibx-igdm-cancel",
              "inbox.igDm.cancel",
              () => void cancelInstagramDmReply(opKey),
              false,
              view.phase === "confirming",
            )}
          </span>,
          canSend ? (
            <span key="confirm">
              {btn(
                "ibx-igdm-confirm",
                "inbox.igDm.confirm",
                () => void confirmInstagramDmReply(opKey, target),
                true,
                view.phase === "confirming" || timeUp || over,
              )}
            </span>
          ) : null,
        )}
      </>
    );
  }

  if (view.phase === "sent") {
    const clear = () =>
      void finishInstagramDmReply(opKey, true).then((cleared) => {
        if (cleared !== "failed") close();
      });
    return (
      <>
        {line("inbox.igDm.sent")}
        <p className="text-ink-2 text-[13px] break-all" data-testid="ibx-igdm-message-id">
          {t("inbox.igDm.messageId")} <bdi dir="ltr">{i.providerMessageId}</bdi>
        </p>
        {details}
        {errorLine}
        {actions(
          <span key="keep">{btn("ibx-igdm-keep", "inbox.igDm.keep", close)}</span>,
          <span key="clear">{btn("ibx-igdm-clear", "inbox.igDm.clear", clear)}</span>,
        )}
      </>
    );
  }

  // rejected (a recorded settlement): nothing was sent; a new review is needed.
  return (
    <>
      {line("inbox.igDm.rejected", { code: i.failureCode ?? "?" })}
      {details}
      {actions(prepareAgain)}
    </>
  );
}

/** The status line key of a stored handle (a lost settlement has its own). */
const statusOf = (op: InboxInstagramDmSendOp): MessageKey =>
  (op.state === "dispatching" && op.pending
    ? "inbox.igDm.status.pending"
    : `inbox.igDm.status.${op.state}`) as MessageKey;

function ReviewSheet({
  opKey,
  target,
  draftText,
  canSend,
  onClose,
}: {
  opKey: string;
  target: DmReplyTarget;
  draftText: string;
  canSend: boolean;
  onClose: () => void;
}) {
  const { t } = useT();
  const view = useInstagramDmViews((s) => s.views[opKey]) ?? {
    phase: "idle",
    intent: null,
    error: null,
  };
  const op = useStore((s) => s.inboxInstagramDmSendOps[opKey]);
  const fallback = useInbox((s) => s.origin) ?? "";
  return (
    <Sheet
      onClose={onClose}
      title={t("inbox.igDm.title")}
      titleId={`ibx-igdm-${opKey}`}
      testId="ibx-igdm-sheet"
      attrs={{ "data-phase": view.phase }}
    >
      <div className="flex flex-col gap-3 p-4">
        <SheetBody
          opKey={opKey}
          target={target}
          view={view}
          draftText={draftText}
          hasOp={!!op}
          canSend={canSend}
          origin={op?.workerOrigin ?? fallback}
          status={op ? statusOf(op) : null}
        />
      </div>
    </Sheet>
  );
}

/** Closing the sheet finishes a settled operation; a review or an uncertain one stays (closing never cancels). */
function closeSheet(opKey: string) {
  const phase = useInstagramDmViews.getState().views[opKey]?.phase;
  if (phase && SETTLED.includes(phase)) void finishInstagramDmReply(opKey);
}

/** The configured Worker's origin (null without one). */
function useWorkerOrigin(): string | null {
  const keys = useStore((s) => s.settings.apiKeys);
  return workerOrigin(scoutConfig(keys.scoutUrl, keys.scoutToken));
}

/**
 * The DM controls of one conversation editor (offered) or of one retained handle (recovery: status and cancel only).
 * `target` is null while no inbound message is selected: nothing can be reviewed then.
 */
export default function InstagramDmSendReview({
  target,
  draft,
  offered = true,
  handleKey,
}: {
  target: DmReplyTarget | null;
  /** The editor's current text and the saved conversation draft (its commit id is the revision that can be reviewed). */
  draft: { text: string; saved: InboxDraft | undefined };
  /** The editor's opener (false in the recovery list: status and cancel only). */
  offered?: boolean;
  /** Recovery: the stored handle's own key (its own Worker origin). */
  handleKey?: string;
}) {
  const { t } = useT();
  const here = useWorkerOrigin();
  const opKey =
    handleKey ??
    (target && here
      ? dmOpKey(here, target.account, target.conversationId, target.inboundMessageId)
      : null);
  const [open, setOpen] = useState(false);
  const op = useStore((s) => (opKey ? s.inboxInstagramDmSendOps[opKey] : undefined));
  const view = useInstagramDmViews((s) => (opKey ? s.views[opKey] : undefined));
  const rows = useRows(here ?? "", target?.account ?? "", target?.conversationId ?? "");
  // The editor and its selected inbound message are a DM visit: mounting, unmounting or another selection starts a new
  // one, so a Prepare or Send still waiting for storage sends nothing. The recovery list is not a visit.
  useEffect(() => {
    if (!offered) return;
    newInstagramDmVisit();
    return newInstagramDmVisit;
  }, [offered, opKey]);

  if (!offered && !op) return null;
  const canSend = offered && !!target && instagramDmSendReadiness().ok;
  const live = isLiveInstagramDmOp(op);
  const saved = draft.saved;
  // DT-6B-3C: 1000 UTF-8 bytes of the canonical text (trim → NFC → trim), not a character count.
  const canonical = saved ? dmTextEligible(saved.text) : null;
  const savedBytes = saved ? dmTextBytes(saved.text.trim().normalize("NFC").trim()) : 0;
  const tooLong = savedBytes > DM_TEXT_BYTES_MAX;
  const ready = !!saved && draft.text === saved.text && canonical !== null;
  const row = target
    ? rowOf(rows, target.inboundMessageId, target.recipientId, target.inboundAt)
    : undefined;
  const name = target ? nameOf(rows, target.recipientId) : null;

  const start = () => {
    if (!opKey || !target || !saved) return;
    setOpen(true);
    void prepareInstagramDmReply(opKey, target, saved.text, saved.commitId);
  };
  const check = () => {
    if (!opKey) return;
    setOpen(true);
    void checkInstagramDmReply(opKey);
  };
  const cancel = () => {
    if (!opKey) return;
    setOpen(true);
    void cancelInstagramDmReply(opKey);
  };

  return (
    <div className="flex flex-col gap-1" data-testid="ibx-igdm">
      {offered && target && (
        <div
          className="flex flex-col gap-0.5 text-[13px]"
          data-testid="ibx-igdm-target"
          data-id={target.inboundMessageId}
        >
          <span className="text-ink-2 font-semibold">
            {t("inbox.igDm.answering")}{" "}
            <bdi dir="ltr">{name ? `@${name}` : target.recipientId}</bdi> ·{" "}
            <When iso={target.inboundAt} />
          </span>
          {row?.text ? (
            <span className="text-muted break-words whitespace-pre-wrap" dir="auto">
              {excerpt(row.text)}
            </span>
          ) : (
            <span className="text-muted break-all" data-testid="ibx-igdm-target-unavailable">
              {t("inbox.igDm.inboundUnavailable")} {t("inbox.igDm.inboundId")}{" "}
              <bdi dir="ltr">{target.inboundMessageId}</bdi>
            </span>
          )}
        </div>
      )}
      {offered && !target && (
        <p className="text-muted text-[13px]" data-testid="ibx-igdm-pick-first">
          {t("inbox.igDm.pickFirst")}
        </p>
      )}
      {offered && !instagramDmSendReadiness().ok && (
        <p className="text-muted text-[13px]" data-testid="ibx-igdm-unavailable">
          {t("inbox.igDm.unavailable")}
        </p>
      )}
      {op && !canSend && (
        <p className="text-ink-2 text-[13px]" data-testid="ibx-igdm-recover-note">
          {t("inbox.igDm.recoverNote")}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {offered && (
          <button
            type="button"
            className="px-btn px-btn-sm"
            disabled={!canSend || !ready || live || !opKey}
            onClick={start}
            data-testid="ibx-igdm-open"
          >
            <Send size={14} aria-hidden />
            {t("inbox.igDm.open")}
          </button>
        )}
        {op && (
          <button
            type="button"
            className="px-btn px-btn-ghost px-btn-sm"
            onClick={check}
            data-testid="ibx-igdm-check"
          >
            {t("inbox.igDm.check")}
          </button>
        )}
        {op?.state === "prepared" && (
          <button
            type="button"
            className="px-btn px-btn-ghost px-btn-sm"
            onClick={cancel}
            data-testid="ibx-igdm-cancel-row"
          >
            {t("inbox.igDm.cancel")}
          </button>
        )}
      </div>
      {canSend && live && (
        <p className="text-muted text-[13px]" data-testid="ibx-igdm-unresolved">
          {t("inbox.igDm.unresolvedNote")}
        </p>
      )}
      {canSend && !live && tooLong && (
        <p className="text-danger text-[13px]" data-testid="ibx-igdm-too-long">
          {t("inbox.igDm.tooLong", { bytes: savedBytes })}
        </p>
      )}
      {canSend && !live && !tooLong && !ready && (
        <p className="text-muted text-[13px]" data-testid="ibx-igdm-note">
          {t("inbox.igDm.saveFirst")}
        </p>
      )}
      {op && (
        <p
          className="text-ink-2 text-[13px]"
          data-testid="ibx-igdm-status"
          data-state={op.state}
          data-pending={op.pending?.observed ?? "none"}
        >
          {t(statusOf(op))}
        </p>
      )}
      {!open && view?.error === "cancelFailed" && (
        <p className="text-danger text-[13px]" role="alert" data-testid="ibx-igdm-cancel-failed">
          {t("inbox.igDm.err.cancelFailed")}
        </p>
      )}
      {open && opKey && target && (
        <ReviewSheet
          opKey={opKey}
          target={target}
          draftText={draft.text}
          canSend={canSend}
          onClose={() => {
            setOpen(false);
            closeSheet(opKey);
          }}
        />
      )}
    </div>
  );
}

/**
 * Every Instagram DM operation this device keeps, whatever account is on screen (or none: the account read failed),
 * whether or not its conversation, message or draft is loaded, and whether or not sending is available: each one of the
 * configured Worker opens to Check status (and Cancel while prepared) for its own stored account and Worker. Operations
 * of another Worker, or all of them while no Worker is configured, are named and never asked.
 */
export function InstagramDmRecoveryList() {
  const { t } = useT();
  const live = useInbox((s) => s.account);
  const ops = useStore((s) => s.inboxInstagramDmSendOps);
  const here = useWorkerOrigin();
  const all = Object.entries(ops);
  if (all.length === 0) return null;
  const mine = here ? all.filter(([, o]) => o.workerOrigin === here) : [];
  const foreign = all.filter(([, o]) => !here || o.workerOrigin !== here);
  return (
    <>
      {mine.length > 0 && (
        <section className="ios-list flex flex-col gap-2 p-3" data-testid="ibx-igdm-recovery">
          <h3 className="text-[15px] font-semibold">{t("inbox.igDm.recovery.title")}</h3>
          <ul className="flex flex-col gap-3">
            {mine.map(([key, o]) => {
              const same = live?.accountId === o.account ? live : null;
              return (
                <li key={key} className="flex flex-col gap-1" data-testid="ibx-igdm-recovery-item">
                  <span className="text-[13px] font-semibold break-all">
                    {t("inbox.igDm.recovery.item", { id: o.inboundMessageId })}
                  </span>
                  <span className="text-muted text-[13px] break-all">
                    {t("inbox.igDm.recovery.account", {
                      id: o.account,
                      conversation: o.conversationId,
                    })}
                  </span>
                  <InstagramDmSendReview
                    handleKey={key}
                    offered={false}
                    target={{
                      account: o.account,
                      readerGeneration: same?.generation ?? "",
                      conversationId: o.conversationId,
                      recipientId: o.recipientId,
                      inboundMessageId: o.inboundMessageId,
                      inboundAt: o.inboundAt ?? "",
                      accountName: same?.handle ?? null,
                    }}
                    draft={{ text: "", saved: undefined }}
                  />
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {foreign.length > 0 && (
        <section
          className="ios-list flex flex-col gap-2 p-3"
          data-testid="ibx-igdm-recovery-foreign"
        >
          <h3 className="text-[15px] font-semibold">{t("inbox.igDm.recovery.foreignTitle")}</h3>
          {!here && <p className="text-ink-2 text-[13px]">{t("inbox.igDm.recovery.noWorker")}</p>}
          <ul className="flex flex-col gap-2">
            {foreign.map(([key, o]) => (
              <li
                key={key}
                className="text-ink-2 text-[13px] break-all"
                data-testid="ibx-igdm-foreign-item"
              >
                {t("inbox.igDm.recovery.foreignItem", { id: o.inboundMessageId })}{" "}
                <bdi dir="ltr">{o.workerOrigin}</bdi>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
