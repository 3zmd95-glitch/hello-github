"use client";

import { Gamepad2 } from "lucide-react";
import type { ReactNode } from "react";
import Chip from "@/components/ui/ios/Chip";
import PlatformBadge from "@/components/ui/ios/PlatformBadge";
import type { AutoPost, Post } from "@/lib/domain";
import { useT } from "@/lib/i18n";
import { PLATFORM_META } from "@/lib/social";
import { isSocialPlatform, type SocialPlatform } from "@/lib/socialSync";
import { STAGE_KEY } from "./PlatformChip";

/** A sent network's mark on the card: ✓ out, ✕ failed, 📥 waiting in the TikTok inbox, ⏳ on its way. */
function netMark(auto: AutoPost, p: SocialPlatform) {
  const r = auto.results[p];
  if (r?.state === "published" && r.inbox && !auto.tiktokCompletedAt)
    return { state: "inbox", glyph: "📥", tone: "default" } as const;
  if (r?.state === "published") return { state: "published", glyph: "✓", tone: "tint" } as const;
  if (r?.state === "failed") return { state: "failed", glyph: "✕", tone: "warn" } as const;
  return { state: r?.state ?? "queued", glyph: "⏳", tone: "default" } as const;
}

/**
 * One post as an iOS list row, in the week's day groups, the unplanned group and a stages column: the platform badge,
 * the title (the owner's own text, isolated in a `<bdi>` so it keeps its direction and its cut lands at its end), time ·
 * platform (and a "linked skill" chip), and a trailing chip: "overdue" or "no day" in warn, else the stage (tinted
 * once scheduled). Once the post's auto-post job is sent, one mark per network follows under the row (a tinted ✓ when
 * it went out). The open button is the row and stays the card's first `<button>` (the e2e open posts with it);
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
  const sent = post.autoPost?.sentAt ? post.autoPost : undefined;
  return (
    <article
      className="post-card"
      data-testid="post-card"
      data-post={post.id}
      data-platform={post.platform}
      data-stage={post.stage}
      data-overdue={!!overdue}
    >
      <button type="button" className="post-open" onClick={() => onOpen(post.id)}>
        <PlatformBadge platform={post.platform} />
        <span className="ios-tx">
          <b>
            <bdi>{post.title}</bdi>
          </b>
          <small className="flex flex-wrap items-center gap-x-1.5">
            <span>
              {(post.plannedDay || post.plannedTime) && (
                <>
                  <span className="num">{post.plannedTime ?? t("calendar.card.noTime")}</span>
                  {" · "}
                </>
              )}
              {L(PLATFORM_META[post.platform].name)}
            </span>
            {post.skillId && (
              <Chip icon={<Gamepad2 size={12} aria-hidden />} data-testid="post-linked-skill">
                {t("calendar.linkedSkill")}
              </Chip>
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
      {sent && (
        <span className="flex flex-wrap gap-1 px-3 pb-2">
          {sent.platforms.filter(isSocialPlatform).map((p) => {
            const mark = netMark(sent, p);
            const label = `${L(PLATFORM_META[p].name)}: ${t(`publish.state.${mark.state}`)}`;
            return (
              <Chip
                key={p}
                tone={mark.tone}
                role="img"
                aria-label={label}
                title={label}
                data-testid="post-card-net"
                data-platform={p}
                data-state={mark.state}
              >
                {PLATFORM_META[p].icon} {mark.glyph}
              </Chip>
            );
          })}
        </span>
      )}
      {children}
    </article>
  );
}
