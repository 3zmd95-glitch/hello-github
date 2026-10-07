"use client";

import { ArrowDown, LoaderCircle } from "lucide-react";
import { useMemo, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useCelebrate } from "@/components/celebrate/CelebrationProvider";
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

const everySecond = (onChange: () => void) => {
  const id = setInterval(onChange, 1000);
  return () => clearInterval(id);
};
const thisMinute = () => Math.floor(Date.now() / 60_000) * 60_000;
const zero = () => 0;

/**
 * Studio: the Social world's home (master plan round 16). Next post + countdown, today's reminder, this
 * week's plan, the growth snapshot, a rules-based inbox, the top 3 audience asks and the TikTok toolkit.
 * Everything derives from the store, so planning a post anywhere (calendar, ideas, a skill's Produce quest) shows
 * up here at once.
 */
export default function StudioScreen() {
  const { t, lang } = useT();
  const today = useToday();
  // Minute resolution for the eyebrow, the inbox and the reminder: read every second, but the snapshot only changes
  // when the minute turns, so React re-renders the cards once a minute (0 on the server and the hydration render).
  // The hero keeps its own second-by-second clock.
  const nowMinute = useSyncExternalStore(everySecond, thisMinute, zero);
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

      {/* Spec §6 order (the mockup's), then the TikTok toolkit last. Every card is a direct child, so the first-visit
          entrance staggers them one by one. From md: six tracks; every card spans the row except the hero (4) next to
          the reminder (2) and the growth (3) next to the inbox (3), so the week plan, the asks and the toolkit are
          full width. The growth card keeps its own height (a long inbox beside it would stretch it into blank space).
          The spans go by position, so every card always renders (each has its own empty state and never returns
          null). */}
      <div
        className={`${first ? "ios-stagger" : ""} flex flex-col gap-3 md:grid md:grid-cols-6 md:[&>*]:col-span-6 md:[&>:nth-child(1)]:col-span-4 md:[&>:nth-child(2)]:col-span-2 md:[&>:nth-child(4)]:col-span-3 md:[&>:nth-child(4)]:self-start md:[&>:nth-child(5)]:col-span-3`}
      >
        <NextPostHero today={today} />
        <ReminderCard today={today} now={nowMinute} />
        <WeekPlanCard today={today} />
        <GrowthSnapshotCard today={today} first={first} />
        <InboxCard today={today} now={nowMinute} />
        <AsksCard />
        <TikTokToolkitCard />
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
    if (r && !r.ok) toast("notice", { icon: "⚠️", tone: "warn", sound: null, name: t(r.error) });
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
