"use client";

import { ExternalLink, Image as ImageIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";
import { providerLink, type CommentItem, type MediaItem } from "@/lib/inbox";
import DraftBox from "./DraftBox";
import { DirectionChip, ListFooter, When } from "./parts";
import { draftScope, listOf, loadMore, selectMedia, useInbox } from "./useInbox";
import { newInstagramCommentVisit } from "./useInstagramSend";

/** "Open on Instagram" only for a permalink that passes the allowlist; nothing otherwise. */
function OpenLink({ url }: { url: string | undefined }) {
  const { t } = useT();
  const href = providerLink(url);
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="px-link inline-flex items-center gap-1 text-[13px]"
      data-testid="ibx-post-link"
    >
      <ExternalLink size={14} aria-hidden />
      {t("inbox.openInstagram")}
    </a>
  );
}

function PostTitle({ m }: { m: MediaItem | undefined }) {
  const { t } = useT();
  return m?.caption ? <bdi dir="auto">{m.caption}</bdi> : <>{t("inbox.post.noCaption")}</>;
}

/** Owned posts; opening one shows its comments, each with its own draft box on demand. */
export default function CommentsView() {
  const { t } = useT();
  useInbox((s) => s.lists);
  const mediaId = useInbox((s) => s.mediaId);
  const account = useInbox((s) => s.account);
  const busy = useInbox((s) => Object.values(s.busy).some(Boolean));
  const [drafting, setDrafting] = useState<string | null>(null);
  const media = listOf<MediaItem>("media");
  // DT-6B-2C-4-R1 (2C4-4): selecting another comment (same post included) or another post is a new comment visit: an
  // Instagram public reply still waiting for storage sends nothing.
  useEffect(() => newInstagramCommentVisit(), [drafting, mediaId]);

  if (!mediaId)
    return (
      <div className="flex flex-col gap-2">
        {media.items.length > 0 && (
          <ul className="ios-list">
            {media.items.map((m) => (
              <li key={m.id} className="ios-row flex-wrap" data-testid="ibx-post" data-id={m.id}>
                <span className="ios-ic fill">
                  <ImageIcon size={20} strokeWidth={1.75} aria-hidden />
                </span>
                <button
                  type="button"
                  className="ios-tx min-w-0 flex-1 text-start"
                  onClick={() => void selectMedia(m.id)}
                  data-testid="ibx-post-open"
                >
                  <b>
                    <PostTitle m={m} />
                  </b>
                  <small>
                    {t("inbox.post.comments", { n: m.commentsCount })} · <When iso={m.timestamp} />
                  </small>
                </button>
                <OpenLink url={m.permalink} />
              </li>
            ))}
          </ul>
        )}
        <ListFooter
          list={media}
          empty="inbox.empty.media"
          busy={busy}
          onMore={() => void loadMore("media")}
        />
      </div>
    );

  const post = media.items.find((m) => m.id === mediaId);
  const comments = listOf<CommentItem>("comments", mediaId);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="px-btn px-btn-ghost px-btn-sm"
          onClick={() => {
            setDrafting(null);
            void selectMedia(null);
          }}
          data-testid="ibx-post-back"
        >
          {t("inbox.back")}
        </button>
        <h2 className="min-w-0 flex-1 truncate text-[17px] font-semibold">
          <PostTitle m={post} />
        </h2>
        <OpenLink url={post?.permalink} />
      </div>
      {comments.items.length > 0 && (
        <ul className="ios-list">
          {comments.items.map((c) => {
            const scope = draftScope("comment", c.id);
            return (
              <li
                key={c.id}
                className="ios-row flex-col items-stretch gap-1"
                data-testid="ibx-comment"
                data-id={c.id}
                data-dir={c.direction}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <DirectionChip dir={c.direction} />
                  <span className="text-ink-2 text-[13px]" data-testid="ibx-author">
                    {c.author?.username ? (
                      <bdi dir="ltr">@{c.author.username}</bdi>
                    ) : (
                      t("inbox.author.unknown")
                    )}
                  </span>
                  <When iso={c.createdAt} />
                  <button
                    type="button"
                    className="px-btn px-btn-ghost px-btn-sm ms-auto"
                    aria-expanded={drafting === c.id}
                    onClick={() => setDrafting((d) => (d === c.id ? null : c.id))}
                    data-testid="ibx-comment-draft"
                  >
                    {t("inbox.comment.draft")}
                  </button>
                </div>
                {c.text && (
                  <p className="text-[15px] break-words whitespace-pre-wrap" dir="auto">
                    {c.text}
                  </p>
                )}
                {drafting === c.id && (
                  <DraftBox
                    key={scope}
                    scope={scope}
                    igSend={
                      account
                        ? {
                            account: account.accountId,
                            readerGeneration: account.generation,
                            mediaId,
                            commentId: c.id,
                            accountName: account.handle,
                          }
                        : undefined
                    }
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
      <ListFooter
        list={comments}
        empty="inbox.empty.comments"
        busy={busy}
        onMore={() => void loadMore("comments")}
      />
      <p className="text-muted px-4 text-[13px]" data-testid="ibx-replies-outside">
        {t("inbox.repliesOutside")}
      </p>
    </div>
  );
}
