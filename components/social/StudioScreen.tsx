"use client";

import { useNow } from "@/components/today/useNow";
import { useToday } from "@/components/today/useToday";
import PageHeader from "@/components/ui/ios/PageHeader";
import { useT } from "@/lib/i18n";
import AsksCard from "./studio/AsksCard";
import GrowthSnapshotCard from "./studio/GrowthSnapshotCard";
import InboxCard from "./studio/InboxCard";
import NextPostHero from "./studio/NextPostHero";
import ReminderCard from "./studio/ReminderCard";
import WeekPlanCard from "./studio/WeekPlanCard";
import TikTokToolkitCard from "./studio/TikTokToolkitCard";

/**
 * 📱 Studio: the Social world's home (master plan round 16). Next post + countdown, today's reminder, this
 * week's plan, the growth snapshot, the top 3 audience asks and a rules-based inbox. Everything derives from
 * the store, so planning a post anywhere (calendar, ideas, a skill's Produce quest) shows up here at once.
 */
export default function StudioScreen() {
  const { t } = useT();
  const today = useToday();
  // Minute resolution for the inbox and reminder; the hero keeps its own second-by-second clock.
  const tick = useNow(true);
  const nowMinute = Math.floor(tick / 60_000) * 60_000;

  return (
    <div className="flex flex-col gap-4" data-testid="studio-screen">
      <PageHeader title={t("social.studio.title")} sub={t("social.studio.sub")} />

      <div className="grid gap-4 md:grid-cols-[1.6fr_1fr] md:items-stretch">
        <NextPostHero today={today} />
        <ReminderCard today={today} now={nowMinute} />
      </div>

      <WeekPlanCard today={today} />
      <TikTokToolkitCard />

      <div className="grid gap-4 md:grid-cols-3">
        <GrowthSnapshotCard />
        <AsksCard />
        <InboxCard today={today} now={nowMinute} />
      </div>
    </div>
  );
}
