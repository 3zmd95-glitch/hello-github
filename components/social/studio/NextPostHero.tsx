"use client";

import Link from "next/link";
import { useMemo } from "react";
import { formatDayShort } from "@/components/planner/weekLabel";
import { useNow } from "@/components/today/useNow";
import { getSkill } from "@/data";
import { POST_STAGES } from "@/lib/domain";
import { useT } from "@/lib/i18n";
import { nextPost, overduePosts, stageIndex, unplannedPosts } from "@/lib/social";
import { useStore } from "@/store";
import { countdownText } from "./countdown";
import { PlatformChip, calendarPostHref, platformStyle } from "./platform";

/**
 * The Studio's hero: the next planned post with a live countdown. When nothing is due later but a planned
 * post's time already passed, that one shows in its overdue state instead. Empty → plan the first post.
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

  if (!post) {
    return (
      <section
        className="px-card studio-hero flex flex-col gap-3"
        data-testid="studio-next"
        data-empty="true"
      >
        <p className="text-muted text-xs font-semibold">{t("social.studio.heroLabel")}</p>
        <h2 className="text-xl">{t("social.studio.heroEmpty")}</h2>
        <p className="text-ink-2 text-sm">{t("social.studio.heroHint")}</p>
        {unplanned > 0 && (
          <p className="text-ink-2 text-sm" data-testid="studio-unplanned">
            {t("social.studio.unplanned", { n: unplanned })}
          </p>
        )}
        <Link
          href="/social/calendar/"
          className="px-btn self-start no-underline"
          data-testid="studio-next-cta"
        >
          {t("social.studio.heroCta")}
        </Link>
      </section>
    );
  }

  const skill = post.skillId ? getSkill(post.skillId) : undefined;
  const time = post.plannedTime ?? "";
  const when =
    post.plannedDay === today
      ? t("social.studio.todayAt", { t: time })
      : `${post.plannedDay ? formatDayShort(post.plannedDay, lang) : ""} · ${time}`.trim();
  const cd = next ? countdownText(next.countdownMs) : null;
  const stage = stageIndex(post.stage);

  return (
    <section
      className="px-card studio-hero flex flex-col gap-3"
      style={platformStyle(post.platform)}
      data-testid="studio-next"
      data-empty="false"
      data-overdue={isOverdue}
      data-post={post.id}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted text-xs font-semibold">{t("social.studio.heroLabel")}</p>
        <PlatformChip platform={post.platform} />
      </div>
      <h2 className="text-2xl leading-tight" data-testid="studio-next-title">
        {post.title}
      </h2>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="text-ink-2" data-testid="studio-next-when">
          {when}
        </span>
        <b
          className={isOverdue ? "text-danger" : "text-accent"}
          data-testid="studio-countdown"
          data-overdue={isOverdue}
        >
          {isOverdue ? t("social.studio.heroOverdue") : cd ? t(cd.key, cd.vars) : ""}
        </b>
      </div>
      <div className="flex items-center gap-1.5" aria-hidden>
        {POST_STAGES.map((s, i) => (
          <span
            key={s}
            className="px-pip"
            data-on={i <= stage}
            style={{ background: i <= stage ? "var(--c)" : undefined }}
          />
        ))}
      </div>
      {skill && (
        <p className="text-muted text-xs" data-testid="studio-next-linked">
          {t("social.studio.heroLinked")}: {L(skill.name)}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Link
          href={calendarPostHref(post.id)}
          className="px-btn no-underline"
          data-testid="studio-next-open"
        >
          {t("social.studio.heroOpen")}
        </Link>
      </div>
    </section>
  );
}
