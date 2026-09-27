"use client";

import Link from "next/link";
import { useMemo } from "react";
import { flowState } from "@/lib/flow";
import { useT } from "@/lib/i18n";
import { PLATFORM_META, nextPost } from "@/lib/social";
import { streak as streakOf, useStore } from "@/store";

/**
 * Today's reminder: the next post's time when it falls today, plus the Training world's flame state so the
 * two worlds nudge each other ("your flame is waiting" links back to 🎮 Today).
 */
export default function ReminderCard({ today, now }: { today: string; now: number }) {
  const { t, L } = useT();
  const posts = useStore((s) => s.posts);
  const completions = useStore((s) => s.completions);
  const microActions = useStore((s) => s.microActions);
  const freezesUsedOn = useStore((s) => s.freezesUsedOn);
  const bonusFreezes = useStore((s) => s.bonusFreezes);

  const next = useMemo(() => nextPost(posts, now), [posts, now]);
  const todayPost = next && next.post.plannedDay === today ? next.post : null;
  const flow = useMemo(
    () => flowState({ completions, microActions }, today),
    [completions, microActions, today],
  );
  const st = useMemo(
    () => streakOf({ completions, microActions, freezesUsedOn, bonusFreezes }, today),
    [completions, microActions, freezesUsedOn, bonusFreezes, today],
  );

  return (
    <section
      className="px-card flex flex-col gap-3"
      data-testid="studio-reminder"
      data-has-post={todayPost !== null}
      data-flame={flow.dayDone ? "lit" : "waiting"}
    >
      <h2 className="text-base">{t("social.studio.reminder")}</h2>
      <p className="text-ink-2 text-sm" data-testid="studio-reminder-post">
        {todayPost
          ? t("social.studio.reminderPost", {
              t: todayPost.plannedTime ?? "",
              name: todayPost.title,
              platform: L(PLATFORM_META[todayPost.platform].name),
            })
          : t("social.studio.reminderNoPost")}
      </p>
      <div
        className="px-inset flex flex-wrap items-center justify-between gap-2"
        data-testid="studio-flame"
      >
        <span className="text-sm">
          {flow.dayDone
            ? t("social.studio.flameLit", { n: st.current })
            : t("social.studio.flameWaiting")}
        </span>
        <Link
          href="/"
          className="px-btn px-btn-ghost px-btn-sm no-underline"
          data-testid="studio-flame-go"
        >
          {t("social.studio.flameGo")}
        </Link>
      </div>
    </section>
  );
}
