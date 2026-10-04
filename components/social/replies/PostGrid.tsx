"use client";

import type { SocialPostStat } from "@/lib/domain";
import { useT } from "@/lib/i18n";

/** The synced Instagram posts as a thumbnail grid (newest first); the chosen one is outlined. */
export default function PostGrid({
  posts,
  value,
  onPick,
}: {
  posts: readonly SocialPostStat[];
  value: string | null;
  onPick: (p: SocialPostStat) => void;
}) {
  const { t } = useT();
  if (!posts.length) {
    return (
      <p className="text-muted text-xs" data-testid="autoreply-no-posts">
        {t("replies.form.noPosts")}
      </p>
    );
  }
  return (
    <div
      className="grid grid-cols-3 gap-1.5 sm:grid-cols-4"
      role="radiogroup"
      aria-label={t("replies.form.post")}
    >
      {posts.map((p) => (
        <button
          key={p.postId}
          type="button"
          role="radio"
          aria-checked={value === p.postId}
          aria-label={p.title?.trim() || p.publishedAt.slice(0, 10)}
          onClick={() => onPick(p)}
          className={`relative aspect-square overflow-hidden rounded border-2 ${
            value === p.postId ? "border-accent" : "border-transparent"
          }`}
          data-testid="autoreply-post-tile"
          data-post-id={p.postId}
        >
          {p.thumbUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- Instagram CDN thumbnail, expires; no loader
            <img src={p.thumbUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="bg-panel-2 grid h-full w-full place-items-center p-1 text-[0.65rem] leading-tight">
              {p.title?.trim() || p.publishedAt.slice(0, 10)}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
