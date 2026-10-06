"use client";

import { ArrowDown, LoaderCircle } from "lucide-react";
import { useMemo } from "react";
import { createPortal } from "react-dom";
import { useCelebrate } from "@/components/celebrate/CelebrationProvider";
import { useNow } from "@/components/today/useNow";
import { useToday } from "@/components/today/useToday";
import PageHeader from "@/components/ui/ios/PageHeader";
import { useFirstVisit } from "@/components/ui/ios/useFirstVisit";
import { usePullToRefresh } from "@/components/ui/ios/usePullToRefresh";
import { useT } from "@/lib/i18n";
import { scoutConfig } from "@/lib/scoutClient";
import { TIME_ZONE } from "@/lib/streak";
import { useStore } from "@/store";
import AsksCard from "./studio/AsksCard";
import GrowthSnapshotCard from "./studio/GrowthSnapshotCard";
import InboxCard from "./studio/InboxCard";
import NextPostHero from "./studio/NextPostHero";
import ReminderCard from "./studio/ReminderCard";
import WeekPlanCard from "./studio/WeekPlanCard";
import TikTokToolkitCard from "./studio/TikTokToolkitCard";
import { syncSocialNow } from "./useSocialSync";

/**
 * Studio: the Social world's home (master plan round 16). Next post + countdown, today's reminder, this
 * week's plan, the growth snapshot, the top 3 audience asks and a rules-based inbox. Everything derives from
 * the store, so planning a post anywhere (calendar, ideas, a skill's Produce quest) shows up here at once.
 */
export default function StudioScreen() {
  const { t, lang } = useT();
  const today = useToday();
  // Minute resolution for the inbox and reminder; the hero keeps its own second-by-second clock.
  const tick = useNow(true);
  const nowMinute = Math.floor(tick / 60_000) * 60_000;
  const first = useFirstVisit("studio");
  const eyebrowFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(lang === "ar" ? "ar-SA-u-ca-gregory-nu-arab" : "en-GB", {
        weekday: "long",
        day: "numeric",
        month: "long",
        timeZone: TIME_ZONE,
      }),
    [lang],
  );
  const eyebrow = eyebrowFmt.format(new Date(nowMinute));

  return (
    <div className="flex flex-col" data-testid="studio-screen">
      <PullToRefresh />
      <PageHeader eyebrow={eyebrow} title={t("social.studio.title")} sub={t("social.studio.sub")} />

      {/* Every card is a direct child, so the first-visit entrance staggers them one by one. From md: three
          tracks, the hero takes two next to the reminder, the week plan and the toolkit span the row, then
          growth · asks · inbox side by side. The spans go by position, so the first four cards always render
          (each has its own empty state and never returns null). */}
      <div
        className={`${first ? "ios-stagger" : ""} flex flex-col gap-3 md:grid md:grid-cols-3 md:[&>:first-child]:col-span-2 md:[&>:nth-child(3)]:col-span-3 md:[&>:nth-child(4)]:col-span-3`}
      >
        <NextPostHero today={today} />
        <ReminderCard today={today} now={nowMinute} />
        <WeekPlanCard today={today} />
        <TikTokToolkitCard />
        <GrowthSnapshotCard />
        <AsksCard />
        <InboxCard today={today} now={nowMinute} />
      </div>
    </div>
  );
}

/**
 * Pull to refresh (phones): re-runs the social sync when the Worker is configured, then a toast. Its own component
 * so the pull's per-frame state re-renders only the spinner. The spinner is portaled to <body>: the hook translates
 * #main, which would carry a fixed child along.
 */
function PullToRefresh() {
  const { t } = useT();
  const { toast } = useCelebrate();
  const configured = useStore(
    (s) => scoutConfig(s.settings.apiKeys.scoutUrl, s.settings.apiKeys.scoutToken) !== null,
  );
  const { pull, refreshing } = usePullToRefresh(async (held) => {
    const r = configured ? await syncSocialNow() : null;
    await held; // the spinner turns first, then the toast (mockup)
    if (r && !r.ok) toast("notice", { icon: "⚠️", sound: null, name: t(r.error) });
    else toast("notice", { icon: "", name: t("social.studio.refreshed") });
  });

  if ((!pull && !refreshing) || typeof document === "undefined") return null;
  const k = Math.min(1, pull / 70);
  return createPortal(
    <div
      className="ios-ptr glass"
      data-spin={refreshing ? "true" : undefined}
      data-testid="studio-ptr"
      // While refreshing the spinner waits just above the content held at 56px (mockup).
      style={
        refreshing
          ? { opacity: 1, transform: "translate(-50%, 30px) scale(1)" }
          : {
              opacity: k,
              transform: `translate(-50%, ${pull * 0.55}px) scale(${0.6 + 0.4 * k}) rotate(${k * 180}deg)`,
            }
      }
      aria-hidden
    >
      {refreshing ? (
        <LoaderCircle size={18} strokeWidth={1.75} />
      ) : (
        <ArrowDown size={18} strokeWidth={1.75} />
      )}
    </div>,
    document.body,
  );
}
