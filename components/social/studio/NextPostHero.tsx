"use client";

import { CalendarPlus, Clock, Gamepad2 } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { formatDayShort } from "@/components/planner/weekLabel";
import { useNow } from "@/components/today/useNow";
import Card from "@/components/ui/ios/Card";
import Chip from "@/components/ui/ios/Chip";
import { getSkill } from "@/data";
import { useT } from "@/lib/i18n";
import { PlatformGlyph } from "@/lib/platformIcons";
import { nextPost, overduePosts, PLATFORM_META, unplannedPosts } from "@/lib/social";
import { useStore } from "@/store";
import { countdownText } from "./countdown";
import { calendarPostHref } from "./platform";

/** Circumference of the progress ring (r = 24) and the time it spans: full at 48h out, empty at the post time. */
const RING = 150.8;
const RING_SPAN_MS = 48 * 3_600_000;

/**
 * The Studio's hero: the next planned post with a live countdown and a ring that empties as its time comes. When
 * nothing is due later but a planned post's time already passed, that one shows in its overdue state instead: the
 * countdown line and a full ring in warn. Empty → plan the first post. Both plan buttons open the calendar's new-post
 * sheet (`#new`).
 */
export default function NextPostHero({ today }: { today: string }) {
  const { t, L, lang } = useT();
  const posts = useStore((s) => s.posts);
  // 0 only on the server and the hydration render, when the store has no posts yet either.
  const now = useNow(true);

  const next = useMemo(() => nextPost(posts, now), [posts, now]);
  const overdue = useMemo(() => overduePosts(posts, now), [posts, now]);
  const unplanned = useMemo(() => unplannedPosts(posts).length, [posts]);

  const post = next?.post ?? overdue[0];
  const isOverdue = !next && overdue.length > 0;

  const label = (
    <h2 className="text-ink-2 text-[13px] font-semibold">{t("social.studio.heroLabel")}</h2>
  );
  const plan = (text: string) => (
    <Link
      href="/social/calendar/#new"
      className="px-btn no-underline"
      data-testid="studio-next-cta"
    >
      <CalendarPlus size={18} strokeWidth={1.75} aria-hidden />
      {text}
    </Link>
  );

  if (!post) {
    return (
      <Card hero className="studio-hero" testId="studio-next" data-empty="true">
        <div className="mb-2.5">{label}</div>
        <h3>{t("social.studio.heroEmpty")}</h3>
        <p className="text-ink-2 mt-1 text-[13px]">{t("social.studio.heroHint")}</p>
        {unplanned > 0 && (
          <p className="text-ink-2 mt-1 text-[13px]" data-testid="studio-unplanned">
            {t("social.studio.unplanned", { n: unplanned })}
          </p>
        )}
        <div className="mt-3.5 flex flex-wrap gap-2">{plan(t("social.studio.heroCta"))}</div>
      </Card>
    );
  }

  const skill = post.skillId ? getSkill(post.skillId) : undefined;
  const time = post.plannedTime ?? "";
  const when =
    post.plannedDay === today
      ? t("social.studio.todayAt", { t: time })
      : `${post.plannedDay ? formatDayShort(post.plannedDay, lang) : ""} · ${time}`.trim();
  const cd = next ? countdownText(next.countdownMs) : null;
  const left = Math.min(1, (next?.countdownMs ?? 0) / RING_SPAN_MS);
  const offset = isOverdue ? 0 : Math.round(RING * (1 - left) * 10) / 10;

  return (
    <Card
      hero
      className="studio-hero"
      testId="studio-next"
      data-empty="false"
      data-overdue={isOverdue}
      data-post={post.id}
    >
      <div className="mb-2.5 flex items-center justify-between gap-2">
        {label}
        <Chip
          tone="tint"
          icon={<PlatformGlyph platform={post.platform} size={13} />}
          data-platform={post.platform}
        >
          {L(PLATFORM_META[post.platform].name)}
        </Chip>
      </div>
      <div className="flex items-center gap-3.5">
        <div className="min-w-0 flex-1">
          {/* The owner's own text keeps its direction (isolated like withName's post names). */}
          <h3 data-testid="studio-next-title">
            <bdi>{post.title}</bdi>
          </h3>
          <p
            className={`mt-1 flex items-center gap-1 text-[14px] font-semibold ${isOverdue ? "text-warn" : "text-tint"}`}
            data-testid="studio-countdown"
            data-overdue={isOverdue}
          >
            {isOverdue && <Clock size={15} strokeWidth={1.75} aria-hidden />}
            {isOverdue ? t("social.studio.heroOverdue") : cd ? t(cd.key, cd.vars) : ""}
          </p>
          <p className="text-ink-2 mt-0.5 text-[13px]" data-testid="studio-next-when">
            {when}
          </p>
          {skill && (
            <p
              className="text-ink-2 mt-0.5 flex items-start gap-1 text-[13px]"
              data-testid="studio-next-linked"
            >
              <Gamepad2 size={14} strokeWidth={1.75} className="mt-[3px] shrink-0" aria-hidden />
              <span className="min-w-0">
                {t("social.studio.heroLinked")}: {L(skill.name)}
              </span>
            </p>
          )}
        </div>
        <svg className="studio-ring" viewBox="0 0 56 56" aria-hidden>
          <circle className="studio-ring-bg" cx="28" cy="28" r="24" />
          <circle
            className="studio-ring-fg"
            cx="28"
            cy="28"
            r="24"
            style={{ strokeDashoffset: offset }}
          />
        </svg>
      </div>
      <div className="mt-3.5 flex flex-wrap gap-2">
        {plan(t("social.studio.heroPlan"))}
        <Link
          href={calendarPostHref(post.id)}
          className="px-btn px-btn-ghost no-underline"
          data-testid="studio-next-open"
        >
          {t("social.studio.heroOpen")}
        </Link>
      </div>
    </Card>
  );
}
