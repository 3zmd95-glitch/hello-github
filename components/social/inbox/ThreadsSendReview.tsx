"use client";

import { ExternalLink, Send } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import Sheet, { useSheetClose } from "@/components/ui/ios/Sheet";
import { useT, type MessageKey } from "@/lib/i18n";
import {
  threadsLink,
  validDraft,
  workerOrigin,
  type ThreadsPost,
  type ThreadsReply,
} from "@/lib/inbox";
import { threadsSendReadiness, type ThreadsIntent } from "@/lib/inboxThreadsSend";
import { scoutConfig } from "@/lib/scoutClient";
import { useStore, type InboxDraft } from "@/store";
import { providerList, useProviderInbox } from "./useProviderInbox";
import {
  cancelThreadsReply,
  checkThreadsReply,
  confirmThreadsReply,
  finishThreadsReply,
  prepareThreadsReply,
  resumeThreadsPublish,
  threadsOpOrigin,
  useThreadsSendViews,
  type ThreadsSendTarget,
  type ThreadsSendView,
} from "./useThreadsSend";

/**
 * 📤 "Send as reply" for one Threads draft, its review sheet, and the recovery list (packet DT-6B-2B-2,
 * planning/tools/37-inbox-send.md). Production readiness is closed (`threadsSendReadiness`), so the opener is disabled
 * with the honest reason and nothing is prepared, sent or resumed; a retained operation always opens to Check status,
 * without its row, draft or permission. The review shows the sending account, the owned root post (its existing
 * validated link, labelled as the post itself), the exact receiving reply (its text only when that row is loaded) and
 * the canonical text. A published reply shows its id as text: no reply link is ever built from an id.
 * DT-6B-2B-2-R1: the automatic expiry lookup runs at most once per operation and deadline; Check status (status only)
 * is on every retained-operation view; closing the sheet never cancels (Cancel is its own button on a review); the
 * recovery list shows every operation of the configured Worker whatever account is on screen, and names another
 * Worker's operations without asking anything.
 * DT-6B-2B-2-R2: a proven Cancel (cancelled or expired answer) ends on that terminal view with its own Close.
 */

export interface ThreadsReplyTarget extends ThreadsSendTarget {
  accountName: string | null;
  /** `capabilities.sendReplies` of the account answer (absent: an older Worker without Threads sending). */
  capability: "permission_unverified" | undefined;
}

/** Phases whose operation is settled: closing the sheet finishes them. */
const SETTLED = ["published", "rejected", "expired", "cancelled", "error", "closed"];
/** The longest excerpt shown in the review (characters). */
const EXCERPT = 280;
/** Reasons the Worker records for an unknown stage that have their own copy. */
const REASONS = ["timeout", "network", "server", "malformed", "receipt"];

const excerpt = (text: string | undefined) =>
  text && text.length > EXCERPT ? `${text.slice(0, EXCERPT)}…` : text;

/**
 * Operations whose automatic expiry lookup already ran (DT-6B-2B-2-R1, 2B2-5): `scope|operation`. The device clock may be
 * ahead of the Worker's, so a still-prepared answer never asks again by itself, even one naming another deadline (an
 * operation's deadline never changes, so this is at most once per operation and deadline); Check status stays manual.
 * Memory only.
 */
const expiryChecked = new Set<string>();

function Expiry({ at, once, onEnd }: { at: string; once: string; onEnd: () => void }) {
  const { t } = useT();
  const [now, setNow] = useState(() => Date.now());
  const left = Math.max(0, Date.parse(at) - now);
  useEffect(() => {
    if (left <= 0) {
      if (!expiryChecked.has(once)) {
        expiryChecked.add(once);
        onEnd();
      }
      return;
    }
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [left, once, onEnd]);
  const s = Math.ceil(left / 1000);
  const time = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  return (
    <p className="text-muted text-[13px]" data-testid="ibx-ths-expires">
      {t("inbox.threadsSend.expires", { time })}
    </p>
  );
}

/** Who sends, the owned root post, the exact receiving reply and the canonical text. Rows lend text only by id. */
function Details({ i, accountName }: { i: ThreadsIntent; accountName: string | null }) {
  const { t } = useT();
  const post = providerList<ThreadsPost>("threads", "posts").items.find(
    (p) => p.id === i.rootPostId,
  );
  const reply = providerList<ThreadsReply>("threads", "replies", i.rootPostId).items.find(
    (r) => r.id === i.replyToId,
  );
  const rootLink = threadsLink(post?.permalink);
  const label = "text-ink-2 text-[13px] font-semibold";
  return (
    <dl className="flex flex-col gap-2 text-[15px]">
      <div>
        <dt className={label}>{t("inbox.threadsSend.account")}</dt>
        <dd data-testid="ibx-ths-account">
          <bdi dir="ltr">{accountName ? `@${accountName}` : i.account}</bdi>
        </dd>
      </div>
      <div>
        <dt className={label}>{t("inbox.threadsSend.root")}</dt>
        <dd className="flex flex-col gap-1">
          {post?.text ? (
            <p className="break-words" dir="auto" data-testid="ibx-ths-root-text">
              {excerpt(post.text)}
            </p>
          ) : (
            <p className="text-muted text-[13px]">{t("inbox.threadsSend.rootNotLoaded")}</p>
          )}
          <p className="text-muted text-[13px] break-all" data-testid="ibx-ths-root-id">
            {t("inbox.threadsSend.rootId")} <bdi dir="ltr">{i.rootPostId}</bdi>
          </p>
          {rootLink && (
            <a
              href={rootLink}
              target="_blank"
              rel="noopener noreferrer"
              className="px-link inline-flex items-center gap-1 text-[13px]"
              data-testid="ibx-ths-root-link"
            >
              <ExternalLink size={12} aria-hidden />
              {t("inbox.threadsSend.openRoot")}
            </a>
          )}
        </dd>
      </div>
      <div>
        <dt className={label}>{t("inbox.threadsSend.reply")}</dt>
        <dd className="flex flex-col gap-1">
          {reply?.text ? (
            <p
              className="ios-list p-2 break-words whitespace-pre-wrap"
              dir="auto"
              data-testid="ibx-ths-reply-text"
            >
              {excerpt(reply.text)}
            </p>
          ) : (
            <p className="text-muted text-[13px]">{t("inbox.threadsSend.replyNotLoaded")}</p>
          )}
          <p className="text-muted text-[13px] break-all" data-testid="ibx-ths-reply-id">
            {t("inbox.threadsSend.replyId")} <bdi dir="ltr">{i.replyToId}</bdi>
          </p>
        </dd>
      </div>
      <div>
        <dt className={label}>{t("inbox.threadsSend.text")}</dt>
        <dd>
          <p
            className="ios-list p-3 break-words whitespace-pre-wrap"
            dir="auto"
            data-testid="ibx-ths-text"
          >
            {i.text}
          </p>
        </dd>
      </div>
    </dl>
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
  target: ThreadsReplyTarget;
  view: ThreadsSendView;
  draftText: string;
  hasOp: boolean;
  /** Readiness is open for this row (never in production). */
  canSend: boolean;
  status: MessageKey | null;
  onCleared?: (draft: InboxDraft) => void;
}) {
  const { t } = useT();
  const close = useSheetClose();
  const check = useCallback(() => void checkThreadsReply(scope), [scope]);
  const i = view.intent;
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
    void finishThreadsReply(scope).then(() => {
      const saved = useStore.getState().inboxDrafts[scope];
      if (saved) void prepareThreadsReply(scope, target, saved.text, saved.commitId);
    });
  const errorLine = view.error && (
    <p className="text-danger text-[13px]" role="alert" data-testid="ibx-ths-error">
      {t(`inbox.threadsSend.err.${view.error}` as MessageKey)}
      {view.detail ? ` ${t(`inbox.threadsSend.detail.${view.detail}` as MessageKey)}` : ""}
    </p>
  );
  const why =
    i?.unknownReason && REASONS.includes(i.unknownReason) ? (
      <p className="text-ink-2 text-[13px]" data-testid="ibx-ths-why">
        {t(`inbox.threadsSend.why.${i.unknownReason}` as MessageKey)}
      </p>
    ) : null;
  const actions = (...more: ReactNode[]) => {
    const extra = more.filter(Boolean);
    return (
      <div className="flex flex-wrap gap-2">
        {extra}
        {hasOp && btn("ibx-ths-sheet-check", "inbox.threadsSend.check", check, extra.length === 0)}
        {btn("ibx-ths-close", "inbox.threadsSend.close", close)}
      </div>
    );
  };
  const details = i && <Details i={i} accountName={target.accountName} />;

  if (view.phase === "preparing" || view.phase === "idle")
    return line("inbox.threadsSend.preparing");
  if (view.phase === "closed")
    return (
      <>
        {line("inbox.threadsSend.closed")}
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
            view.error === "mismatch") &&
          line(status)}
        {actions()}
      </>
    );
  if (view.phase === "uncertain")
    return (
      <>
        {line("inbox.threadsSend.uncertain", undefined, "text-warn")}
        {errorLine}
        {details}
        {actions()}
      </>
    );

  // Durable stages a handle alone can show (after a reload whose lookup failed there is no intent yet).
  const stage: Partial<Record<ThreadsSendView["phase"], MessageKey>> = {
    creating: "inbox.threadsSend.creating",
    publishing: "inbox.threadsSend.publishing",
    unknown_creation: "inbox.threadsSend.unknownCreation",
    unknown_publication: "inbox.threadsSend.unknownPublication",
  };
  const stageKey = stage[view.phase];
  if (stageKey)
    return (
      <>
        {line(stageKey, undefined, view.phase.startsWith("unknown_") ? "text-warn" : "text-ink-2")}
        {why}
        {errorLine}
        {details}
        {actions()}
      </>
    );

  if (view.phase === "created")
    return (
      <>
        {line("inbox.threadsSend.created")}
        {errorLine}
        {details}
        {!canSend && (
          <p className="text-muted text-[13px]" data-testid="ibx-ths-resume-note">
            {t("inbox.threadsSend.resumeUnavailable")}
          </p>
        )}
        {actions(
          <button
            key="resume"
            type="button"
            className="px-btn px-btn-sm"
            disabled={!canSend || !i}
            onClick={() => void resumeThreadsPublish(scope, target)}
            data-testid="ibx-ths-resume"
          >
            {t("inbox.threadsSend.resume")}
          </button>,
        )}
      </>
    );

  const prepareAgain = canSend ? (
    <span key="again">{btn("ibx-ths-again", "inbox.threadsSend.again", again, true)}</span>
  ) : null;

  // Cancelled or expired: settled, nothing was published. DT-6B-2B-2-R2: rendered from the receipt kept on the view, or
  // with none (a proven cancel removed the handle), never as a lasting "Checking…"; Close ends it.
  if (view.phase === "cancelled" || view.phase === "expired")
    return (
      <>
        {line(
          view.phase === "expired" ? "inbox.threadsSend.expired" : "inbox.threadsSend.cancelled",
        )}
        {details}
        {actions(prepareAgain)}
      </>
    );

  // Only a genuinely pending view lacks its intent here.
  if (!i) return line("inbox.threadsSend.preparing");

  if (view.phase === "review" || view.phase === "confirming")
    return (
      <>
        {details}
        {draftText.trim() !== i.text && (
          <p className="text-warn text-[13px]" data-testid="ibx-ths-differs">
            {t("inbox.threadsSend.differs")}
          </p>
        )}
        {view.phase === "review" ? (
          <Expiry at={i.reviewExpiresAt} once={`${scope}|${i.operationId}`} onEnd={check} />
        ) : (
          line("inbox.threadsSend.confirming")
        )}
        {errorLine}
        {actions(
          <span key="cancel">
            {btn(
              "ibx-ths-cancel",
              "inbox.threadsSend.cancel",
              () => void cancelThreadsReply(scope),
              false,
              view.phase === "confirming",
            )}
          </span>,
          canSend ? (
            <span key="confirm">
              {btn(
                "ibx-ths-confirm",
                "inbox.threadsSend.confirm",
                () => void confirmThreadsReply(scope, target),
                true,
                view.phase === "confirming",
              )}
            </span>
          ) : null,
        )}
      </>
    );

  if (view.phase === "published") {
    const clear = () =>
      void finishThreadsReply(scope, true).then((cleared) => {
        if (cleared === "failed") return;
        if (cleared) onCleared?.(cleared);
        close();
      });
    return (
      <>
        {line("inbox.threadsSend.published")}
        <p className="text-ink-2 text-[13px] break-all" data-testid="ibx-ths-published-id">
          {t("inbox.threadsSend.publishedId")} <bdi dir="ltr">{i.publishedId}</bdi>
        </p>
        {details}
        {errorLine}
        {actions(
          <span key="keep">{btn("ibx-ths-keep", "inbox.threadsSend.keep", close)}</span>,
          <span key="clear">{btn("ibx-ths-clear", "inbox.threadsSend.clear", clear)}</span>,
        )}
      </>
    );
  }

  // rejected: nothing was published; a new review is needed.
  return (
    <>
      {line("inbox.threadsSend.rejected", { code: i.failureCode ?? "?" })}
      {details}
      {actions(prepareAgain)}
    </>
  );
}

/** The sheet itself: opened by "Send as reply" (Prepare) or "Check status" (status only). */
function ReviewSheet({
  scope,
  target,
  draftText,
  canSend,
  onClose,
  onCleared,
}: {
  scope: string;
  target: ThreadsReplyTarget;
  draftText: string;
  canSend: boolean;
  onClose: () => void;
  onCleared?: (draft: InboxDraft) => void;
}) {
  const { t } = useT();
  const view = useThreadsSendViews((s) => s.views[scope]) ?? {
    phase: "idle",
    intent: null,
    error: null,
  };
  const op = useStore((s) => s.inboxThreadsSendOps[scope]);
  const status = op ? (`inbox.threadsSend.status.${op.state}` as MessageKey) : null;
  return (
    <Sheet
      onClose={onClose}
      title={t("inbox.threadsSend.title")}
      titleId={`ibx-ths-${scope}`}
      testId="ibx-ths-sheet"
      attrs={{ "data-phase": view.phase }}
    >
      <div className="flex flex-col gap-3 p-4">
        <SheetBody
          scope={scope}
          target={target}
          view={view}
          draftText={draftText}
          hasOp={!!op}
          canSend={canSend}
          status={status}
          onCleared={onCleared}
        />
      </div>
    </Sheet>
  );
}

/**
 * Closing the sheet finishes a settled operation; a review or an uncertain one stays (DT-6B-2B-2-R1: closing never
 * cancels; Cancel is its own button).
 */
function closeSheet(scope: string) {
  const phase = useThreadsSendViews.getState().views[scope]?.phase;
  if (phase === "published") void finishThreadsReply(scope, false);
  else if (phase && SETTLED.includes(phase)) void finishThreadsReply(scope);
}

export default function ThreadsSendReview({
  scope,
  target,
  draft,
  onCleared,
}: {
  scope: string;
  target: ThreadsReplyTarget;
  /** The editor's current text and the saved draft (its commit id is the revision that can be sent). */
  draft: { text: string; saved: InboxDraft | undefined };
  /** Called with the draft a successful "Clear draft" discarded. */
  onCleared?: (draft: InboxDraft) => void;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const op = useStore((s) => s.inboxThreadsSendOps[scope]);
  const view = useThreadsSendViews((s) => s.views[scope]);

  // An older Worker (no capability) or a row it gave no send target: nothing to offer, unless an operation is stored.
  const offered = target.capability !== undefined && !!target.sendRef;
  if (!offered && !op) return null;
  const canSend = offered && threadsSendReadiness().ok;
  const saved = draft.saved;
  const ready =
    !!saved && draft.text === saved.text && !!saved.text.trim() && validDraft(saved.text);

  const start = () => {
    setOpen(true);
    if (saved) void prepareThreadsReply(scope, target, saved.text, saved.commitId);
  };
  const check = () => {
    setOpen(true);
    void checkThreadsReply(scope);
  };

  return (
    <div className="flex flex-col gap-1" data-testid="ibx-ths">
      {offered && !canSend && (
        <p className="text-muted text-[13px]" data-testid="ibx-ths-unavailable">
          {t("inbox.threadsSend.unavailable")}
        </p>
      )}
      {op && !canSend && (
        <p className="text-ink-2 text-[13px]" data-testid="ibx-ths-recover-note">
          {t("inbox.threadsSend.recoverNote")}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {offered && (
          <button
            type="button"
            className="px-btn px-btn-sm"
            disabled={!canSend || !ready}
            onClick={start}
            data-testid="ibx-ths-open"
          >
            <Send size={14} aria-hidden />
            {t("inbox.threadsSend.open")}
          </button>
        )}
        {op && (
          <button
            type="button"
            className="px-btn px-btn-ghost px-btn-sm"
            onClick={check}
            data-testid="ibx-ths-check"
          >
            {t("inbox.threadsSend.check")}
          </button>
        )}
      </div>
      {canSend && !ready && !op && (
        <p className="text-muted text-[13px]" data-testid="ibx-ths-note">
          {t("inbox.threadsSend.saveFirst")}
        </p>
      )}
      {op && (
        <p className="text-ink-2 text-[13px]" data-testid="ibx-ths-status" data-state={op.state}>
          {t(`inbox.threadsSend.status.${op.state}` as MessageKey)}
        </p>
      )}
      {!open && view?.error === "cancelFailed" && (
        <p className="text-danger text-[13px]" role="alert" data-testid="ibx-ths-cancel-failed">
          {t("inbox.threadsSend.err.cancelFailed")}
        </p>
      )}
      {open && (
        <ReviewSheet
          scope={scope}
          target={target}
          draftText={draft.text}
          canSend={canSend}
          onCleared={onCleared}
          onClose={() => {
            setOpen(false);
            closeSheet(scope);
          }}
        />
      )}
    </div>
  );
}

/** The reply id at the end of a v2 Threads scope key (`v2|threads|origin|account|comment|id`). */
function replyIdOf(scope: string): string {
  const id = scope.split("|")[5] ?? "";
  try {
    return decodeURIComponent(id);
  } catch {
    return id;
  }
}

/**
 * Every Threads operation this device keeps for the configured Worker, whatever account is on screen (or none, when the
 * account read failed), whether or not its reply row is loaded, its draft exists or sending is available: each one
 * opens to Check status for its own stored account (handle-only recovery, DT-6B-2B-2-R1). Operations of another Worker
 * are named and never asked: this connection's token only goes to its own Worker.
 */
export function ThreadsSendRecoveryList() {
  const { t } = useT();
  const live = useProviderInbox((s) => s.threads);
  const ops = useStore((s) => s.inboxThreadsSendOps);
  const keys = useStore((s) => s.settings.apiKeys);
  const here = workerOrigin(scoutConfig(keys.scoutUrl, keys.scoutToken));
  if (!here) return null;
  const all = Object.entries(ops).filter(([k]) => k.startsWith("v2|threads|"));
  const mine = all.filter(([k, o]) => threadsOpOrigin(k, o) === here);
  const foreign = all.filter(([k, o]) => threadsOpOrigin(k, o) !== here);
  if (all.length === 0) return null;
  return (
    <>
      {mine.length > 0 && (
        <section className="ios-list flex flex-col gap-2 p-3" data-testid="ibx-ths-recovery">
          <h3 className="text-[15px] font-semibold">{t("inbox.threadsSend.recovery.title")}</h3>
          <ul className="flex flex-col gap-3">
            {mine.map(([scope, o]) => {
              const replyToId = replyIdOf(scope);
              const same = live?.accountId === o.account ? live : null;
              return (
                <li key={scope} className="flex flex-col gap-1" data-testid="ibx-ths-recovery-item">
                  <span className="text-[13px] font-semibold">
                    {t("inbox.threadsSend.recovery.item", { id: replyToId })}
                  </span>
                  <ThreadsSendReview
                    scope={scope}
                    target={{
                      sendRef: undefined,
                      account: o.account,
                      generation: same?.generation ?? "",
                      rootPostId: "",
                      replyToId,
                      accountName: same?.handle ?? null,
                      capability: undefined,
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
          data-testid="ibx-ths-recovery-foreign"
        >
          <h3 className="text-[15px] font-semibold">
            {t("inbox.threadsSend.recovery.foreignTitle")}
          </h3>
          <ul className="flex flex-col gap-2">
            {foreign.map(([scope, o]) => (
              <li key={scope} className="text-ink-2 text-[13px]" data-testid="ibx-ths-foreign-item">
                {t("inbox.threadsSend.recovery.foreignItem", { id: replyIdOf(scope) })}{" "}
                <bdi dir="ltr">{threadsOpOrigin(scope, o) || "?"}</bdi>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
