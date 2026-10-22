"use client";

import { ExternalLink, Send } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import Sheet, { useSheetClose } from "@/components/ui/ios/Sheet";
import { useT, type MessageKey } from "@/lib/i18n";
import {
  inboxScope,
  providerLink,
  workerOrigin,
  type CommentItem,
  type InboxList,
  type MediaItem,
} from "@/lib/inbox";
import {
  IG_SEND_TEXT_MAX,
  instagramSendReadiness,
  type InstagramIntent,
} from "@/lib/inboxInstagramSend";
import { scoutConfig } from "@/lib/scoutClient";
import { useStore, type InboxDraft } from "@/store";
import { useInbox } from "./useInbox";
import {
  cancelInstagramReply,
  checkInstagramReply,
  confirmInstagramReply,
  finishInstagramReply,
  igDraftScope,
  igOpKey,
  isLiveInstagramOp,
  newInstagramCommentVisit,
  prepareInstagramReply,
  useInstagramSendViews,
  type InstagramSendTarget,
  type InstagramSendView,
} from "./useInstagramSend";

/**
 * 📤 "Send as public reply" for one Instagram comment draft, its review sheet, and the recovery list (packet DT-6B-2C-4,
 * planning/tools/37-inbox-send.md). Production readiness is closed (`instagramSendReadiness`), so the opener is disabled
 * with the honest reason and nothing is prepared or sent; a retained operation always opens to Check status, without its
 * row, draft, account read or permission. The review shows the sending account, the owned post (its caption only from
 * the row of this operation's account and media; its validated permalink labelled as the post itself, never the
 * comment), the exact receiving comment (author and text only from the matching row, else ids and "preview
 * unavailable"), the Worker's canonical text and a local countdown (it may turn Send off; only a Worker receipt proves
 * expiry, and nothing is asked by itself). A sent reply shows its id as text: no link is built from it. Closing never
 * cancels; Cancel, Close and Copy (in the draft box) are distinct.
 */

export interface InstagramReplyTarget extends InstagramSendTarget {
  accountName: string | null;
}

/** Phases whose operation is settled: closing the sheet finishes them. */
const SETTLED = ["sent", "rejected", "already_claimed", "expired", "cancelled", "error", "closed"];
/** The longest excerpt shown in the review (characters). */
const EXCERPT = 280;
/** Reasons the Worker records for an unknown outcome that have their own copy. */
const REASONS = ["timeout", "network", "server", "malformed", "oversize", "redirect", "receipt"];
const HOLDERS = ["automatic", "manual", "retired"];

const excerpt = (text: string | undefined) =>
  text && text.length > EXCERPT ? `${text.slice(0, EXCERPT)}…` : text;

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
      <p className="text-warn text-[13px]" data-testid="ibx-igs-time-up">
        {t("inbox.igSend.timeUp")}
      </p>
    );
  const s = Math.ceil(left / 1000);
  const time = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  return (
    <p className="text-muted text-[13px]" data-testid="ibx-igs-expires">
      {t("inbox.igSend.expires", { time })}
    </p>
  );
}

/**
 * Who sends, the owned post, the exact receiving comment and the canonical text. Rows lend words only when they are
 * this operation's: the lists of its Worker origin and account, by media and comment id.
 */
function Details({
  i,
  origin,
  accountName,
}: {
  i: InstagramIntent;
  origin: string;
  accountName: string | null;
}) {
  const { t } = useT();
  const lists = useInbox((s) => s.lists);
  const post = (
    lists[inboxScope(origin, i.account, "media")] as InboxList<MediaItem> | undefined
  )?.items.find((m) => m.id === i.mediaId);
  const comment = (
    lists[inboxScope(origin, i.account, "comments", i.mediaId)] as
      InboxList<CommentItem> | undefined
  )?.items.find((c) => c.id === i.commentId);
  const postLink = providerLink(post?.permalink);
  const label = "text-ink-2 text-[13px] font-semibold";
  return (
    <dl className="flex flex-col gap-2 text-[15px]">
      <div>
        <dt className={label}>{t("inbox.igSend.account")}</dt>
        <dd data-testid="ibx-igs-account">
          <bdi dir="ltr">{accountName ? `@${accountName}` : i.account}</bdi>
        </dd>
      </div>
      <div>
        <dt className={label}>{t("inbox.igSend.post")}</dt>
        <dd className="flex flex-col gap-1">
          {post?.caption ? (
            <p className="break-words" dir="auto" data-testid="ibx-igs-post-text">
              {excerpt(post.caption)}
            </p>
          ) : (
            <p className="text-muted text-[13px]" data-testid="ibx-igs-post-unavailable">
              {t("inbox.igSend.postUnavailable")}
            </p>
          )}
          <p className="text-muted text-[13px] break-all" data-testid="ibx-igs-post-id">
            {t("inbox.igSend.postId")} <bdi dir="ltr">{i.mediaId}</bdi>
          </p>
          {postLink && (
            <a
              href={postLink}
              target="_blank"
              rel="noopener noreferrer"
              className="px-link inline-flex items-center gap-1 text-[13px]"
              data-testid="ibx-igs-post-link"
            >
              <ExternalLink size={12} aria-hidden />
              {t("inbox.igSend.openPost")}
            </a>
          )}
        </dd>
      </div>
      <div>
        <dt className={label}>{t("inbox.igSend.comment")}</dt>
        <dd className="flex flex-col gap-1">
          {comment ? (
            <>
              <span className="text-ink-2 text-[13px]" data-testid="ibx-igs-comment-author">
                {comment.author?.username ? (
                  <bdi dir="ltr">@{comment.author.username}</bdi>
                ) : (
                  t("inbox.author.unknown")
                )}
              </span>
              <p
                className="ios-list p-2 break-words whitespace-pre-wrap"
                dir="auto"
                data-testid="ibx-igs-comment-text"
              >
                {excerpt(comment.text)}
              </p>
            </>
          ) : (
            <p className="text-muted text-[13px]" data-testid="ibx-igs-comment-unavailable">
              {t("inbox.igSend.commentUnavailable")}
            </p>
          )}
          <p className="text-muted text-[13px] break-all" data-testid="ibx-igs-comment-id">
            {t("inbox.igSend.commentId")} <bdi dir="ltr">{i.commentId}</bdi>
          </p>
        </dd>
      </div>
      <div>
        <dt className={label}>{t("inbox.igSend.text")}</dt>
        <dd>
          <p
            className="ios-list p-3 break-words whitespace-pre-wrap"
            dir="auto"
            data-testid="ibx-igs-text"
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
  origin,
  status,
}: {
  scope: string;
  target: InstagramReplyTarget;
  view: InstagramSendView;
  draftText: string;
  hasOp: boolean;
  /** Readiness is open for this row (never in production, never from the recovery list). */
  canSend: boolean;
  origin: string;
  status: MessageKey | null;
}) {
  const { t } = useT();
  const close = useSheetClose();
  const check = useCallback(() => void checkInstagramReply(scope), [scope]);
  const [timeUp, setTimeUp] = useState(false);
  const ended = useCallback(() => setTimeUp(true), []);
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
    void finishInstagramReply(scope).then(() => {
      const saved = useStore.getState().inboxDrafts[scope];
      if (saved) void prepareInstagramReply(scope, target, saved.text, saved.commitId);
    });
  const errorLine = view.error && (
    <p className="text-danger text-[13px]" role="alert" data-testid="ibx-igs-error">
      {t(`inbox.igSend.err.${view.error}` as MessageKey)}
      {view.detail ? ` ${t(`inbox.igSend.detail.${view.detail}` as MessageKey)}` : ""}
    </p>
  );
  const why =
    i?.unknownReason && REASONS.includes(i.unknownReason) ? (
      <p className="text-ink-2 text-[13px]" data-testid="ibx-igs-why">
        {t(`inbox.igSend.why.${i.unknownReason}` as MessageKey)}
      </p>
    ) : null;
  const actions = (...more: ReactNode[]) => {
    const extra = more.filter(Boolean);
    return (
      <div className="flex flex-wrap gap-2">
        {extra}
        {hasOp && btn("ibx-igs-sheet-check", "inbox.igSend.check", check, extra.length === 0)}
        {btn("ibx-igs-close", "inbox.igSend.close", close)}
      </div>
    );
  };
  const details = i && <Details i={i} origin={origin} accountName={target.accountName} />;

  if (view.phase === "preparing" || view.phase === "idle") return line("inbox.igSend.preparing");
  if (view.phase === "closed")
    return (
      <>
        {line("inbox.igSend.closed")}
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
        {line("inbox.igSend.uncertain", undefined, "text-warn")}
        {errorLine}
        {details}
        {actions()}
      </>
    );
  if (view.phase === "dispatching" || view.phase === "unknown")
    return (
      <>
        {line(
          view.phase === "unknown" ? "inbox.igSend.unknown" : "inbox.igSend.dispatching",
          undefined,
          view.phase === "unknown" ? "text-warn" : "text-ink-2",
        )}
        {why}
        {errorLine}
        {details}
        {actions()}
      </>
    );

  const prepareAgain = canSend ? (
    <span key="again">{btn("ibx-igs-again", "inbox.igSend.again", again, true)}</span>
  ) : null;

  // Cancelled or expired: settled, nothing was sent; rendered from the receipt kept on the view, or with none.
  if (view.phase === "cancelled" || view.phase === "expired")
    return (
      <>
        {line(view.phase === "expired" ? "inbox.igSend.expired" : "inbox.igSend.cancelled")}
        {details}
        {actions(prepareAgain)}
      </>
    );

  // Only a genuinely pending view lacks its intent here.
  if (!i) return line("inbox.igSend.preparing");

  if (view.phase === "already_claimed") {
    const by = HOLDERS.includes(i.failureDetail ?? "") ? i.failureDetail : "manual";
    return (
      <>
        {line(`inbox.igSend.claimed.${by}` as MessageKey)}
        {details}
        {actions()}
      </>
    );
  }

  if (view.phase === "review" || view.phase === "confirming")
    return (
      <>
        {details}
        {draftText && draftText.trim() !== i.text && (
          <p className="text-warn text-[13px]" data-testid="ibx-igs-differs">
            {t("inbox.igSend.differs")}
          </p>
        )}
        {view.phase === "review" ? (
          <Expiry at={i.reviewExpiresAt} onEnd={ended} />
        ) : (
          line("inbox.igSend.confirming")
        )}
        {errorLine}
        {actions(
          <span key="cancel">
            {btn(
              "ibx-igs-cancel",
              "inbox.igSend.cancel",
              () => void cancelInstagramReply(scope),
              false,
              view.phase === "confirming",
            )}
          </span>,
          canSend ? (
            <span key="confirm">
              {btn(
                "ibx-igs-confirm",
                "inbox.igSend.confirm",
                () => void confirmInstagramReply(scope, target),
                true,
                view.phase === "confirming" || timeUp,
              )}
            </span>
          ) : null,
        )}
      </>
    );

  if (view.phase === "sent") {
    const clear = () =>
      void finishInstagramReply(scope, true).then((cleared) => {
        if (cleared !== "failed") close();
      });
    return (
      <>
        {line("inbox.igSend.sent")}
        <p className="text-ink-2 text-[13px] break-all" data-testid="ibx-igs-reply-id">
          {t("inbox.igSend.replyId")} <bdi dir="ltr">{i.providerReplyId}</bdi>
        </p>
        {details}
        {errorLine}
        {actions(
          <span key="keep">{btn("ibx-igs-keep", "inbox.igSend.keep", close)}</span>,
          <span key="clear">{btn("ibx-igs-clear", "inbox.igSend.clear", clear)}</span>,
        )}
      </>
    );
  }

  // rejected: nothing was sent; a new review is needed.
  return (
    <>
      {line("inbox.igSend.rejected", { code: i.failureCode ?? "?" })}
      {details}
      {actions(prepareAgain)}
    </>
  );
}

/** The sheet itself: opened by "Send as public reply" (Prepare), "Check status" or Cancel (handle only). */
function ReviewSheet({
  scope,
  target,
  draftText,
  canSend,
  onClose,
}: {
  scope: string;
  target: InstagramReplyTarget;
  draftText: string;
  canSend: boolean;
  onClose: () => void;
}) {
  const { t } = useT();
  const view = useInstagramSendViews((s) => s.views[scope]) ?? {
    phase: "idle",
    intent: null,
    error: null,
  };
  const op = useStore((s) => s.inboxInstagramSendOps[igOpKey(scope)]);
  const fallback = useInbox((s) => s.origin) ?? "";
  const status = op ? (`inbox.igSend.status.${op.state}` as MessageKey) : null;
  return (
    <Sheet
      onClose={onClose}
      title={t("inbox.igSend.title")}
      titleId={`ibx-igs-${scope}`}
      testId="ibx-igs-sheet"
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
          origin={op?.workerOrigin ?? fallback}
          status={status}
        />
      </div>
    </Sheet>
  );
}

/** Closing the sheet finishes a settled operation; a review or an uncertain one stays (closing never cancels). */
function closeSheet(scope: string) {
  const phase = useInstagramSendViews.getState().views[scope]?.phase;
  if (phase && SETTLED.includes(phase)) void finishInstagramReply(scope);
}

export default function InstagramSendReview({
  scope,
  target,
  draft,
  offered = true,
}: {
  /** The comment draft scope (`origin|account|comment|id`). */
  scope: string;
  target: InstagramReplyTarget;
  /** The editor's current text and the saved draft (its commit id is the revision that can be reviewed). */
  draft: { text: string; saved: InboxDraft | undefined };
  /** The row's opener (false in the recovery list: status and cancel only). */
  offered?: boolean;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const op = useStore((s) => s.inboxInstagramSendOps[igOpKey(scope)]);
  const view = useInstagramSendViews((s) => s.views[scope]);
  // DT-6B-2C-4-R1 (2C4-4): the row's editor is a comment visit; mounting, unmounting (closing it, another comment, leaving
  // the page) or another scope starts a new one, so a Prepare or Send still waiting for storage sends nothing. The
  // recovery list (handle-only status and cancel) is not a visit.
  useEffect(() => {
    if (!offered) return;
    newInstagramCommentVisit();
    return newInstagramCommentVisit;
  }, [offered, scope]);

  if (!offered && !op) return null;
  const canSend = offered && instagramSendReadiness().ok;
  const live = isLiveInstagramOp(op);
  const saved = draft.saved;
  const trimmed = saved?.text.trim() ?? "";
  const tooLong = Array.from(trimmed).length > IG_SEND_TEXT_MAX;
  const ready = !!saved && draft.text === saved.text && !!trimmed && !tooLong;

  const start = () => {
    setOpen(true);
    if (saved) void prepareInstagramReply(scope, target, saved.text, saved.commitId);
  };
  const check = () => {
    setOpen(true);
    void checkInstagramReply(scope);
  };
  const cancel = () => {
    setOpen(true);
    void cancelInstagramReply(scope);
  };

  return (
    <div className="flex flex-col gap-1" data-testid="ibx-igs">
      {offered && !canSend && (
        <p className="text-muted text-[13px]" data-testid="ibx-igs-unavailable">
          {t("inbox.igSend.unavailable")}
        </p>
      )}
      {op && !canSend && (
        <p className="text-ink-2 text-[13px]" data-testid="ibx-igs-recover-note">
          {t("inbox.igSend.recoverNote")}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {offered && (
          <button
            type="button"
            className="px-btn px-btn-sm"
            disabled={!canSend || !ready || live}
            onClick={start}
            data-testid="ibx-igs-open"
          >
            <Send size={14} aria-hidden />
            {t("inbox.igSend.open")}
          </button>
        )}
        {op && (
          <button
            type="button"
            className="px-btn px-btn-ghost px-btn-sm"
            onClick={check}
            data-testid="ibx-igs-check"
          >
            {t("inbox.igSend.check")}
          </button>
        )}
        {op?.state === "prepared" && (
          <button
            type="button"
            className="px-btn px-btn-ghost px-btn-sm"
            onClick={cancel}
            data-testid="ibx-igs-cancel-row"
          >
            {t("inbox.igSend.cancel")}
          </button>
        )}
      </div>
      {canSend && live && (
        <p className="text-muted text-[13px]" data-testid="ibx-igs-unresolved">
          {t("inbox.igSend.unresolvedNote")}
        </p>
      )}
      {canSend && !live && tooLong && (
        <p className="text-danger text-[13px]" data-testid="ibx-igs-too-long">
          {t("inbox.igSend.tooLong")}
        </p>
      )}
      {canSend && !live && !tooLong && !ready && (
        <p className="text-muted text-[13px]" data-testid="ibx-igs-note">
          {t("inbox.igSend.saveFirst")}
        </p>
      )}
      {op && (
        <p className="text-ink-2 text-[13px]" data-testid="ibx-igs-status" data-state={op.state}>
          {t(`inbox.igSend.status.${op.state}` as MessageKey)}
        </p>
      )}
      {!open && view?.error === "cancelFailed" && (
        <p className="text-danger text-[13px]" role="alert" data-testid="ibx-igs-cancel-failed">
          {t("inbox.igSend.err.cancelFailed")}
        </p>
      )}
      {open && (
        <ReviewSheet
          scope={scope}
          target={target}
          draftText={draft.text}
          canSend={canSend}
          onClose={() => {
            setOpen(false);
            closeSheet(scope);
          }}
        />
      )}
    </div>
  );
}

/**
 * Every Instagram public operation this device keeps, whatever account is on screen (or none: the account read failed),
 * whether or not its post, comment or draft is loaded, and whether or not sending is available: each one of the
 * configured Worker opens to Check status (and Cancel while prepared) for its own stored account and Worker. Operations
 * of another Worker, or all of them while no Worker is configured, are named and never asked: this connection's token
 * only goes to its own Worker.
 */
export function InstagramSendRecoveryList() {
  const { t } = useT();
  const live = useInbox((s) => s.account);
  const ops = useStore((s) => s.inboxInstagramSendOps);
  const keys = useStore((s) => s.settings.apiKeys);
  const here = workerOrigin(scoutConfig(keys.scoutUrl, keys.scoutToken));
  const all = Object.entries(ops);
  if (all.length === 0) return null;
  const mine = here ? all.filter(([, o]) => o.workerOrigin === here) : [];
  const foreign = all.filter(([, o]) => !here || o.workerOrigin !== here);
  return (
    <>
      {mine.length > 0 && (
        <section className="ios-list flex flex-col gap-2 p-3" data-testid="ibx-igs-recovery">
          <h3 className="text-[15px] font-semibold">{t("inbox.igSend.recovery.title")}</h3>
          <ul className="flex flex-col gap-3">
            {mine.map(([key, o]) => {
              const scope = igDraftScope(key);
              const same = live?.accountId === o.account ? live : null;
              return (
                <li key={key} className="flex flex-col gap-1" data-testid="ibx-igs-recovery-item">
                  <span className="text-[13px] font-semibold">
                    {t("inbox.igSend.recovery.item", { id: o.commentId })}
                  </span>
                  <span className="text-muted text-[13px]">
                    {t("inbox.igSend.recovery.account", { id: o.account })}
                  </span>
                  <InstagramSendReview
                    scope={scope}
                    offered={false}
                    target={{
                      account: o.account,
                      readerGeneration: same?.generation ?? "",
                      mediaId: o.mediaId,
                      commentId: o.commentId,
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
          data-testid="ibx-igs-recovery-foreign"
        >
          <h3 className="text-[15px] font-semibold">{t("inbox.igSend.recovery.foreignTitle")}</h3>
          {!here && <p className="text-ink-2 text-[13px]">{t("inbox.igSend.recovery.noWorker")}</p>}
          <ul className="flex flex-col gap-2">
            {foreign.map(([key, o]) => (
              <li key={key} className="text-ink-2 text-[13px]" data-testid="ibx-igs-foreign-item">
                {t("inbox.igSend.recovery.foreignItem", { id: o.commentId })}{" "}
                <bdi dir="ltr">{o.workerOrigin}</bdi>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
