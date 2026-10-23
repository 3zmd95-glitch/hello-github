"use client";

import { Eye, EyeOff, Trash2 } from "lucide-react";
import { useState } from "react";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import RowMenu from "@/components/ui/RowMenu";
import Chip from "@/components/ui/ios/Chip";
import type { InboxComment, InboxPost } from "@/lib/domain";
import {
  DM_TEXT_BYTES,
  IG_COMMENT_MAX,
  PRIVATE_REPLY_DAYS,
  inboxDelete,
  inboxErrorKey,
  inboxHide,
  inboxPrivate,
  inboxReply,
  type InboxError,
  type InboxResult,
} from "@/lib/inbox";
import { useT } from "@/lib/i18n";
import { formatInstant } from "../calendar/dates";
import ReplyBox from "./ReplyBox";
import { currentConfig, useComments } from "./useInbox";

/** Whether Instagram still takes a private reply to a comment written at `at` (read when the comment renders). */
const privateReplyOpen = (at: string) =>
  Date.now() - Date.parse(at) <= PRIVATE_REPLY_DAYS * 86_400_000;

function CommentLine({ c }: { c: InboxComment }) {
  const { t, lang } = useT();
  return (
    <div
      className={`flex flex-col gap-0.5 ${c.hidden ? "opacity-50" : ""}`}
      data-testid="inbox-comment"
      data-id={c.id}
      data-hidden={c.hidden}
    >
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <b dir="ltr">@{c.author}</b>
        {c.sentBy === "auto" && <Chip tone="tint">{t("inbox.thread.auto")}</Chip>}
        {c.ours && c.sentBy !== "auto" && <Chip>{t("inbox.thread.you")}</Chip>}
        {c.hidden && <Chip>{t("inbox.hidden")}</Chip>}
        <time className="text-muted tabular-nums" dateTime={c.at}>
          {formatInstant(c.at, lang)}
        </time>
      </div>
      <p dir="auto" className="text-[15px] break-words whitespace-pre-wrap">
        {c.text}
      </p>
    </div>
  );
}

/**
 * What the owner can do with one comment: reply, reply privately (a DM by the comment; not on our own, and only within
 * PRIVATE_REPLY_DAYS of it), hide or show it, and delete it when it is ours. One box per comment: the two toggles only
 * switch its kind (reply or reply privately), so the text and a pending send survive the switch; it closes with the
 * active kind's toggle. Every success reads the comments again (`onChanged`). TikTok has no sends yet, so its comments
 * get no controls.
 */
function CommentActions({ c, onChanged }: { c: InboxComment; onChanged: () => void }) {
  const { t } = useT();
  const [box, setBox] = useState<"reply" | "private" | null>(null);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [failed, setFailed] = useState<InboxError | null>(null);
  if (c.platform !== "instagram") return null;

  const toggle = (which: "reply" | "private") => {
    setFailed(null);
    setBox(box === which ? null : which);
  };
  const act = async (call: () => Promise<InboxResult<unknown>>) => {
    setBusy(true);
    setFailed(null);
    const r = await call();
    setBusy(false);
    if (r.ok) onChanged();
    else setFailed(r.error);
  };

  return (
    <div className="flex flex-col gap-2" data-testid="inbox-comment-actions" data-id={c.id}>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="px-btn px-btn-ghost px-btn-sm"
          aria-expanded={box === "reply"}
          onClick={() => toggle("reply")}
          data-testid="inbox-reply-toggle"
        >
          {t("inbox.reply")}
        </button>
        {!c.ours && privateReplyOpen(c.at) && (
          <button
            type="button"
            className="px-btn px-btn-ghost px-btn-sm"
            aria-expanded={box === "private"}
            onClick={() => toggle("private")}
            data-testid="inbox-private-toggle"
          >
            {t("inbox.replyPrivately")}
          </button>
        )}
        <span className="ms-auto">
          <RowMenu label={`${t("inbox.options")} · @${c.author}`} testId="inbox-comment-menu">
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void act(() => inboxHide(currentConfig(), c.platform, c.id, !c.hidden))
              }
              data-testid="inbox-comment-hide"
            >
              {c.hidden ? t("inbox.unhide") : t("inbox.hide")}
              {c.hidden ? (
                <Eye size={17} strokeWidth={1.75} aria-hidden />
              ) : (
                <EyeOff size={17} strokeWidth={1.75} aria-hidden />
              )}
            </button>
            {c.ours && (
              <button
                type="button"
                className="text-danger"
                disabled={busy}
                onClick={() => setAsking(true)}
                data-testid="inbox-comment-delete"
              >
                {t("inbox.delete")}
                <Trash2 size={17} strokeWidth={1.75} aria-hidden />
              </button>
            )}
          </RowMenu>
        </span>
      </div>
      {box && (
        <ReplyBox
          kind={box === "private" ? "private" : "comment"}
          limit={box === "private" ? { bytes: DM_TEXT_BYTES } : { chars: IG_COMMENT_MAX }}
          label={`${t(box === "private" ? "inbox.replyPrivately" : "inbox.reply")} @${c.author}`}
          autoFocus
          onSend={(text) =>
            box === "private"
              ? inboxPrivate(currentConfig(), c.id, text)
              : inboxReply(currentConfig(), c.platform, c.id, text)
          }
          onSent={() => {
            setFailed(null);
            onChanged();
          }}
          testId={box === "private" ? "inbox-comment-private" : "inbox-comment-reply"}
        />
      )}
      {failed && (
        <p role="alert" className="text-danger text-[13px]" data-testid="inbox-comment-error">
          {t(inboxErrorKey(failed), { detail: failed.detail ?? "" })}
        </p>
      )}
      {asking && (
        <ConfirmDialog
          title={t("inbox.delete")}
          body={t("inbox.deleteConfirm")}
          confirmLabel={t("inbox.delete")}
          danger
          onCancel={() => setAsking(false)}
          onConfirm={() => {
            setAsking(false);
            void act(() => inboxDelete(currentConfig(), c.platform, c.id));
          }}
        />
      )}
    </div>
  );
}

/**
 * One post's comments, newest first, each reply under its comment (oldest reply first, as in the app); a reply
 * whose comment is not loaded stands on its own. Hidden ones are dimmed.
 */
export default function CommentsView({ post }: { post: InboxPost }) {
  const { t } = useT();
  const { data, busy, error, loadMore, reload } = useComments(post.platform, post.id);
  const comments = data?.comments ?? [];
  const ids = new Set(comments.map((c) => c.id));
  const roots = comments.filter((c) => !c.parentId || !ids.has(c.parentId));
  const replies = (id: string) =>
    comments.filter((c) => c.parentId === id).sort((a, b) => (a.at < b.at ? -1 : 1));
  const permalink = data?.post.permalink ?? post.permalink;

  return (
    <div className="flex flex-col gap-3" data-testid="inbox-comments-view">
      {/^https:\/\//.test(permalink) && (
        <a
          href={permalink}
          target="_blank"
          rel="noopener noreferrer"
          className="px-link self-start text-[13px]"
          data-testid="inbox-open-post"
        >
          {t("inbox.comments.openPost")}
        </a>
      )}
      {!data && busy && (
        <p className="text-muted text-[15px]" aria-busy>
          {t("inbox.loading")}
        </p>
      )}
      {data && comments.length === 0 && (
        <p className="text-ink-2 text-[15px]">{t("inbox.empty.comments")}</p>
      )}
      <ul className="flex flex-col gap-4">
        {roots.map((c) => {
          const under = replies(c.id);
          return (
            <li key={c.id} className="flex flex-col gap-2">
              <CommentLine c={c} />
              <CommentActions c={c} onChanged={reload} />
              {under.length > 0 && (
                <ul className="border-hair ms-4 flex flex-col gap-2 border-s ps-3">
                  {under.map((r) => (
                    <li key={r.id} data-reply-to={c.id}>
                      <CommentLine c={r} />
                      <CommentActions c={r} onChanged={reload} />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      {data?.more && (
        <button
          type="button"
          className="px-btn px-btn-ghost px-btn-sm self-center"
          disabled={busy}
          onClick={loadMore}
          data-testid="inbox-load-older"
        >
          {t("inbox.loadOlder")}
        </button>
      )}
      {error && (
        <p role="alert" className="text-danger text-[13px]" data-testid="inbox-comments-error">
          {t(inboxErrorKey(error), { detail: error.detail ?? "" })}
        </p>
      )}
    </div>
  );
}
