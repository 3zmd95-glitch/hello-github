"use client";

import Chip from "@/components/ui/ios/Chip";
import { ListGroup, ListRow } from "@/components/ui/ios/List";
import PlatformBadge from "@/components/ui/ios/PlatformBadge";
import type { InboxPost } from "@/lib/domain";
import { useT } from "@/lib/i18n";
import { useStore } from "@/store";
import { isUnread, postSeen } from "./useInbox";

/** The post's picture with its platform's badge on the corner; the badge alone without a picture. */
function Thumb({ post }: { post: InboxPost }) {
  if (!post.thumbUrl) return <PlatformBadge platform={post.platform} />;
  return (
    <span className="relative shrink-0">
      {/* eslint-disable-next-line @next/next/no-img-element -- a remote thumbnail; the static export has no image optimizer */}
      <img
        src={post.thumbUrl}
        alt=""
        className="h-10 w-10 rounded-[13px] object-cover"
        loading="lazy"
        referrerPolicy="no-referrer"
      />
      <PlatformBadge platform={post.platform} size={18} className="absolute -end-1 -bottom-1" />
    </span>
  );
}

/** The Comments section: one row per post with its comment count, newest first, "new" until it is opened. */
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
  const { t } = useT();
  const seen = useStore((s) => s.inboxSeen);
  return (
    <ListGroup header={t("inbox.section.comments")} testId="inbox-comments">
      {posts.map((p) => (
        <ListRow
          key={`${p.platform}:${p.id}`}
          iconRaw={<Thumb post={p} />}
          title={p.caption ? <bdi>{p.caption}</bdi> : t("inbox.comments.untitled")}
          sub={t("inbox.comments.count", { n: p.commentCount })}
          trailing={
            isUnread(postSeen(p), seen) && (
              <Chip tone="tint" data-testid="inbox-new">
                {t("inbox.new")}
              </Chip>
            )
          }
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
