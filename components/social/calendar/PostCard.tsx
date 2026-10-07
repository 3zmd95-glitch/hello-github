"use client";

import type { ReactNode } from "react";
import Chip from "@/components/ui/ios/Chip";
import PlatformBadge from "@/components/ui/ios/PlatformBadge";
import type { Post } from "@/lib/domain";
import { useT } from "@/lib/i18n";
import { PLATFORM_META } from "@/lib/social";
import { STAGE_KEY } from "./PlatformChip";

/**
 * One post as an iOS list row, in the week's day groups, the unplanned group and a stages column: the platform badge,
 * the title (the owner's own text, isolated in a `<bdi>` so it keeps its direction and its cut lands at its end), time ·
 * platform (📎🎮 when it links a skill), and a trailing chip: "overdue" or "no day" in warn, else the stage (tinted
 * once scheduled). The open button is the row and stays the card's first `<button>` (the e2e open posts with it);
 * `children` render under it (the board's move buttons).
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
  const { t, L } = useT();
  const unplanned = !post.plannedDay && post.stage !== "posted";
  const done = post.stage === "scheduled" || post.stage === "posted";
  return (
    <article
      className="post-card"
      data-testid="post-card"
      data-post={post.id}
      data-platform={post.platform}
      data-stage={post.stage}
      data-overdue={!!overdue}
    >
      <button
        type="button"
        className="post-open"
        onClick={() => onOpen(post.id)}
        aria-label={t("calendar.card.open", { title: post.title })}
      >
        <PlatformBadge platform={post.platform} />
        <span className="ios-tx">
          <b>
            <bdi>{post.title}</bdi>
          </b>
          <small>
            {(post.plannedDay || post.plannedTime) && (
              <>
                <span className="num">{post.plannedTime ?? t("calendar.card.noTime")}</span>
                {" · "}
              </>
            )}
            {L(PLATFORM_META[post.platform].name)}
            {post.skillId && (
              <>
                {" · "}
                <span title={t("calendar.linked")} aria-label={t("calendar.linked")}>
                  📎🎮
                </span>
              </>
            )}
          </small>
        </span>
        {overdue || unplanned ? (
          <Chip tone="warn">{t(overdue ? "calendar.overdue" : "calendar.unplanned")}</Chip>
        ) : (
          <Chip tone={done ? "tint" : "default"} data-stage={post.stage}>
            {t(STAGE_KEY[post.stage])}
          </Chip>
        )}
      </button>
      {children}
    </article>
  );
}
