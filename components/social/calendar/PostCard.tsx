"use client";

import type { ReactNode } from "react";
import type { AutoPost, Post } from "@/lib/domain";
import { useT } from "@/lib/i18n";
import { PLATFORM_META } from "@/lib/social";
import { isSocialPlatform, type SocialPlatform } from "@/lib/socialSync";
import { platformStyle, StageChip } from "./PlatformChip";

/** A sent network's mark on the card: ✓ out, ✕ failed, 📥 waiting in the TikTok inbox, ⏳ on its way. */
function netMark(auto: AutoPost, p: SocialPlatform) {
  const r = auto.results[p];
  if (r?.state === "published" && r.inbox && !auto.tiktokCompletedAt)
    return { state: "inbox", glyph: "📥", tone: "px-chip-gold" } as const;
  if (r?.state === "published")
    return { state: "published", glyph: "✓", tone: "px-chip-green" } as const;
  if (r?.state === "failed") return { state: "failed", glyph: "✕", tone: "text-danger" } as const;
  return { state: r?.state ?? "queued", glyph: "⏳", tone: "px-chip-gold" } as const;
}

/**
 * One post in the week columns, the unplanned tray and the stages board: platform color bar + icon, time,
 * stage chip, 📎🎮 when it links a skill, ⚠ when overdue, and once its auto-post job is sent, one mark per
 * network (a green ✓ when it went out). `children` renders under the card (the board's move buttons).
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
  const meta = PLATFORM_META[post.platform];
  const sent = post.autoPost?.sentAt ? post.autoPost : undefined;
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
      {sent && (
        <span className="flex flex-wrap gap-1 text-xs">
          {sent.platforms.filter(isSocialPlatform).map((p) => {
            const mark = netMark(sent, p);
            const label = `${L(PLATFORM_META[p].name)}: ${t(`publish.state.${mark.state}`)}`;
            return (
              <span
                key={p}
                role="img"
                aria-label={label}
                title={label}
                className={`px-chip ${mark.tone}`}
                data-testid="post-card-net"
                data-platform={p}
                data-state={mark.state}
              >
                {PLATFORM_META[p].icon} {mark.glyph}
              </span>
            );
          })}
        </span>
      )}
      {children}
    </article>
  );
}
