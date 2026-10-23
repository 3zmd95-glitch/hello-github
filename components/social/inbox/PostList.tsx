"use client";

import Chip from "@/components/ui/ios/Chip";
import { ListGroup, ListRow } from "@/components/ui/ios/List";
import PlatformBadge from "@/components/ui/ios/PlatformBadge";
import type { InboxPost } from "@/lib/domain";
import { useT } from "@/lib/i18n";
import { timeAgo } from "@/lib/socialSync";
import { useStore } from "@/store";
import { isUnread, postSeen } from "./useInbox";

/**
 * The post's picture with its platform's badge on the corner. Without a picture a phone shows the badge alone; md+
 * shows a neutral box of the same size, the small badge on its corner.
 */
function Thumb({ post }: { post: InboxPost }) {
  return (
    <span className="relative shrink-0">
      {post.thumbUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- a remote thumbnail; the static export has no image optimizer
        <img
          src={post.thumbUrl}
          alt=""
          className="h-10 w-10 rounded-[13px] object-cover"
          loading="lazy"
          referrerPolicy="no-referrer"
        />
      ) : (
        <>
          <span className="block md:hidden">
            <PlatformBadge platform={post.platform} />
          </span>
          <span aria-hidden className="bg-fill hidden h-10 w-10 rounded-[13px] md:block" />
        </>
      )}
      <span className={`absolute -end-1 -bottom-1 ${post.thumbUrl ? "" : "hidden md:block"}`}>
        <PlatformBadge platform={post.platform} size={18} />
      </span>
    </span>
  );
}

/**
 * The Comments section: one row per post with its comment count, newest first, "new" until it is opened. On md+
 * each row is a table row (picture | caption | comment count | "new" | time); a phone keeps the stacked list.
 */
export default function PostList({
  posts,
  loaded,
  more,
  onOpen,
  onMore,
}: {
  posts: readonly InboxPost[];
  loaded: boolean;
  more: boolean;
  onOpen: (p: InboxPost) => void;
  /** Ignored while a read is under way (the hook's own guard). */
  onMore: () => void;
}) {
  const { t, lang } = useT();
  const seen = useStore((s) => s.inboxSeen);
  return (
    <ListGroup header={t("inbox.section.comments")} testId="inbox-comments" data-layout="table">
      {posts.map((p) => (
        <ListRow
          key={`${p.platform}:${p.id}`}
          iconRaw={<Thumb post={p} />}
          title={p.caption ? <bdi>{p.caption}</bdi> : t("inbox.comments.untitled")}
          sub={t("inbox.comments.count", { n: p.commentCount })}
          trailing={
            <>
              {isUnread(postSeen(p), seen) && (
                <Chip tone="tint" className="md:col-start-4" data-testid="inbox-new">
                  {t("inbox.new")}
                </Chip>
              )}
              <time
                dateTime={p.postedAt}
                className="text-muted hidden text-[13px] whitespace-nowrap md:col-start-5 md:block md:min-w-24 md:text-end"
              >
                {timeAgo(p.postedAt, lang)}
              </time>
            </>
          }
          // md+: the title and the count are grid cells of their own (the text wrapper steps aside).
          className="md:hover:bg-fill md:grid md:grid-cols-[auto_minmax(0,1fr)_auto_auto_auto] md:items-center md:gap-4 md:[&>.ios-tx]:contents md:[&>.ios-tx>small]:whitespace-nowrap"
          onClick={() => onOpen(p)}
          testId="inbox-post-row"
          data-id={p.id}
          data-platform={p.platform}
        />
      ))}
      {loaded && posts.length === 0 && (
        <ListRow title={t("inbox.empty.comments")} testId="inbox-empty-comments" />
      )}
      {!loaded && <ListRow title={t("inbox.loading")} aria-busy />}
      {more && (
        <ListRow
          title={<span className="text-tint">{t("inbox.loadOlder")}</span>}
          onClick={onMore}
          testId="inbox-more-posts"
        />
      )}
    </ListGroup>
  );
}
