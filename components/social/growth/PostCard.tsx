"use client";

import { Eye, X } from "lucide-react";
import Chip from "@/components/ui/ios/Chip";
import { ListRow } from "@/components/ui/ios/List";
import PlatformBadge from "@/components/ui/ios/PlatformBadge";
import type { PostStatKind, SocialPostStat } from "@/lib/domain";
import { useT, type MessageKey } from "@/lib/i18n";
import { timeAgo } from "@/lib/socialSync";
import { fmtCount } from "./format";

const KIND_KEY: Record<PostStatKind, MessageKey> = {
  video: "growth.content.kind.video",
  short: "growth.content.kind.short",
  reel: "growth.content.kind.reel",
  story: "growth.content.kind.story",
  thread: "growth.content.kind.thread",
  image: "growth.content.kind.image",
  other: "growth.content.kind.other",
};

/**
 * One imported post as a list row (an `<li>`): the platform badge, the title, when it went up and its kind, the views
 * in a chip. With a permalink the whole row opens the post (the title link stretches over the row); `onRemove`
 * adds a remove button above that link.
 */
export default function PostCard({
  post,
  testId,
  onRemove,
}: {
  post: SocialPostStat;
  testId: string;
  onRemove?: () => void;
}) {
  const { t, lang } = useT();
  const title = post.title?.trim() || post.postId;
  return (
    <ListRow
      as="li"
      className="gr-post"
      iconRaw={<PlatformBadge platform={post.platform} />}
      title={
        <bdi title={title}>
          {post.permalink ? (
            <a
              href={post.permalink}
              target="_blank"
              rel="noreferrer noopener"
              className="text-ink no-underline after:absolute after:inset-0"
              aria-label={`${t("growth.content.open")}: ${title}`}
            >
              {title}
            </a>
          ) : (
            title
          )}
        </bdi>
      }
      sub={`${timeAgo(post.publishedAt, lang)} · ${t(KIND_KEY[post.kind])}`}
      trailing={
        <>
          <Chip
            icon={<Eye size={13} strokeWidth={1.75} aria-hidden />}
            title={t("growth.content.views")}
          >
            <span className="num">{fmtCount(post.views)}</span>
          </Chip>
          {onRemove && (
            <button
              type="button"
              className="px-btn px-btn-ghost px-btn-sm relative"
              onClick={onRemove}
              aria-label={t("growth.content.remove")}
              title={t("growth.content.remove")}
              data-testid="content-remove"
            >
              <X size={16} strokeWidth={1.75} aria-hidden />
            </button>
          )}
        </>
      }
      testId={testId}
      data-post={post.postId}
      data-platform={post.platform}
    />
  );
}
