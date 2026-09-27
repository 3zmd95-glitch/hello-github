"use client";

import type { CSSProperties } from "react";
import { formatDayShort } from "@/components/planner/weekLabel";
import { PlatformChip } from "@/components/social/studio/platform";
import type { PostStatKind, SocialPostStat } from "@/lib/domain";
import { useT, type MessageKey } from "@/lib/i18n";
import { PLATFORM_META } from "@/lib/social";
import { dayKey } from "@/lib/streak";
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

/** One imported post: thumbnail when the export had one, platform chip, title, views / likes / comments / shares. */
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
  const meta = PLATFORM_META[post.platform];
  const day = formatDayShort(dayKey(post.publishedAt), lang);
  const title = post.title?.trim() || post.postId;
  const stats: [MessageKey, number][] = [
    ["growth.content.views", post.views],
    ["growth.content.likes", post.likes],
    ["growth.content.comments", post.comments],
    ["growth.content.shares", post.shares],
  ];
  return (
    <article
      className="px-inset an-post flex flex-col gap-2"
      data-testid={testId}
      data-post={post.postId}
      data-platform={post.platform}
      style={{ "--c": meta.color } as CSSProperties}
    >
      {post.thumbUrl && (
        /* Thumbnails come from the platforms' CDNs and the app is a static export: no image optimizer. */
        /* eslint-disable-next-line @next/next/no-img-element */
        <img src={post.thumbUrl} alt="" className="an-thumb" loading="lazy" />
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <PlatformChip platform={post.platform} />
        <span className="px-chip">{t(KIND_KEY[post.kind])}</span>
        <span className="num text-muted ms-auto text-xs" dir="ltr">
          {day}
        </span>
      </div>
      <p className="an-post-title text-sm font-semibold" title={title}>
        {post.permalink ? (
          <a
            href={post.permalink}
            target="_blank"
            rel="noreferrer noopener"
            className="underline-offset-2 hover:underline"
            aria-label={`${t("growth.content.open")}: ${title}`}
          >
            {title}{" "}
            <span aria-hidden className="an-ext">
              ↗
            </span>
          </a>
        ) : (
          title
        )}
      </p>
      <dl className="an-post-stats" dir="ltr">
        {stats.map(([key, value]) => (
          <div key={key} className="flex items-baseline gap-1">
            <dt className="text-muted text-[0.68rem]">{t(key)}</dt>
            <dd className="num text-xs font-bold">{fmtCount(value)}</dd>
          </div>
        ))}
      </dl>
      {onRemove && (
        <button
          type="button"
          className="px-btn px-btn-ghost px-btn-sm self-end"
          onClick={onRemove}
          aria-label={t("growth.content.remove")}
          title={t("growth.content.remove")}
          data-testid="content-remove"
        >
          ✕
        </button>
      )}
    </article>
  );
}
