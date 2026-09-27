"use client";

import type { ReactNode } from "react";
import type { Post } from "@/lib/domain";
import { useT } from "@/lib/i18n";
import { PLATFORM_META } from "@/lib/social";
import { platformStyle, StageChip } from "./PlatformChip";

/**
 * One post in the week columns, the unplanned tray and the stages board: platform color bar + icon, time,
 * stage chip, 📎🎮 when it links a skill, ⚠ when overdue. `children` renders under the card (the board's
 * move buttons).
 */
export default function PostCard({
  post,
  overdue,
  onOpen,
  children,
}: {
  post: Post;
  overdue?: boolean;
  onOpen: (id: string) => void;
  children?: ReactNode;
}) {
  const { t } = useT();
  const meta = PLATFORM_META[post.platform];
  return (
    <article
      className="px-inset post-card flex flex-col gap-1.5"
      style={platformStyle(post.platform)}
      data-testid="post-card"
      data-post={post.id}
      data-platform={post.platform}
      data-stage={post.stage}
      data-overdue={!!overdue}
    >
      <button
        type="button"
        className="flex w-full flex-col gap-1 text-start"
        onClick={() => onOpen(post.id)}
        aria-label={t("calendar.card.open", { title: post.title })}
      >
        <span className="flex w-full flex-wrap items-center gap-1.5 text-xs">
          <span aria-hidden>{meta.icon}</span>
          <span className="num text-muted">{post.plannedTime ?? t("calendar.card.noTime")}</span>
          {post.skillId && (
            <span title={t("calendar.linked")} aria-label={t("calendar.linked")}>
              📎🎮
            </span>
          )}
          {overdue && (
            <span className="text-danger font-bold" title={t("calendar.overdue")}>
              ⚠ <span className="lg:hidden">{t("calendar.overdue")}</span>
            </span>
          )}
          <span className="ms-auto">
            <StageChip stage={post.stage} />
          </span>
        </span>
        <b className="post-title text-sm leading-snug">{post.title}</b>
      </button>
      {children}
    </article>
  );
}
