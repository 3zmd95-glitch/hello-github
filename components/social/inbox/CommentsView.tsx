"use client";

import Chip from "@/components/ui/ios/Chip";
import type { InboxComment, InboxPost } from "@/lib/domain";
import { inboxErrorKey } from "@/lib/inbox";
import { useT } from "@/lib/i18n";
import { formatInstant } from "../calendar/dates";
import { useComments } from "./useInbox";

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
 * One post's comments, newest first, each reply under its comment (oldest reply first, as in the app); a reply
 * whose comment is not loaded stands on its own. Hidden ones are dimmed.
 */
export default function CommentsView({ post }: { post: InboxPost }) {
  const { t } = useT();
  const { data, busy, error, loadMore } = useComments(post.platform, post.id);
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
              {under.length > 0 && (
                <ul className="border-hair ms-4 flex flex-col gap-2 border-s ps-3">
                  {under.map((r) => (
                    <li key={r.id} data-reply-to={c.id}>
                      <CommentLine c={r} />
                    </li>
                  ))}
                </ul>
              )}
              {/* Task 9: the comment ReplyBox (reply, reply privately, hide) mounts here. */}
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
