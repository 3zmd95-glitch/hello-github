"use client";

import { Clock, Flame } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import Card, { CardHead } from "@/components/ui/ios/Card";
import { ListRow } from "@/components/ui/ios/List";
import { flowState } from "@/lib/flow";
import { useT } from "@/lib/i18n";
import { PLATFORM_META, nextPost } from "@/lib/social";
import { streak as streakOf, useStore } from "@/store";

/**
 * Today's reminder: the next post's time when it falls today, plus the Training world's flame state so the
 * two worlds nudge each other ("your flame is waiting" links back to Training's Today). One bare row: a clock,
 * the post line, the flame line, the way back.
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
    <Card
      testId="studio-reminder"
      data-has-post={todayPost !== null}
      data-flame={flow.dayDone ? "lit" : "waiting"}
    >
      <CardHead title={t("social.studio.reminder")} />
      <ListRow
        className="bare"
        icon={<Clock size={22} strokeWidth={1.75} aria-hidden />}
        title={
          <span data-testid="studio-reminder-post">
            {todayPost
              ? t("social.studio.reminderPost", {
                  t: todayPost.plannedTime ?? "",
                  name: todayPost.title,
                  platform: L(PLATFORM_META[todayPost.platform].name),
                })
              : t("social.studio.reminderNoPost")}
          </span>
        }
        sub={
          <span data-testid="studio-flame">
            {flow.dayDone
              ? t("social.studio.flameLit", { n: st.current })
              : t("social.studio.flameWaiting")}
          </span>
        }
        trailing={
          <Link
            href="/"
            className="px-btn px-btn-ghost px-btn-sm no-underline"
            data-testid="studio-flame-go"
          >
            <Flame size={15} strokeWidth={1.75} aria-hidden />
            {t("social.studio.flameGo")}
          </Link>
        }
      />
    </Card>
  );
}
