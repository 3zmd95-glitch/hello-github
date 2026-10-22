"use client";

import { Check, Clock, Film, Lightbulb, Rocket, TrendingUp, type LucideIcon } from "lucide-react";
import { useMemo } from "react";
import Chip from "@/components/ui/ios/Chip";
import { ListGroup, ListRow } from "@/components/ui/ios/List";
import { PLATFORMS } from "@/lib/domain";
import { latestSnapshot } from "@/lib/growth";
import { useT, type MessageKey, type Vars } from "@/lib/i18n";
import { dueManualPosts, pendingManualPlatforms } from "@/lib/publish";
import { PLATFORM_META, overduePosts } from "@/lib/social";
import { addDays } from "@/lib/streak";
import { visibleTrends } from "@/lib/trends";
import { ideasCount, useStore } from "@/store";
import { calendarPostHref, withName } from "./platform";

/** Numbers older than this many days count as stale for a platform the owner has an account on. */
const STALE_DAYS = 14;
/**
 * A trend row counts as new while its `seenAt` (first seen by the Worker) is within this many days (📈 Trend
 * Radar, round 30). Calendar moments (platform `event`) are never counted: they are not trends.
 */
const NEW_TREND_DAYS = 7;

interface InboxRow {
  id: string;
  kind: "overdue" | "unscheduled" | "manual" | "ideas" | "trends" | "stale";
  key: MessageKey;
  vars?: Vars;
  /** A post title inside the line (`{name}`): the owner's own text, isolated so its direction keeps to itself. */
  name?: string;
  href: string;
}

/** Row icon per kind (tools/18 §3.6): overdue in warn, stale numbers on the neutral fill, the rest tinted. */
const ICON: Record<InboxRow["kind"], { icon: LucideIcon; tone?: "warn" | "fill" }> = {
  overdue: { icon: Clock, tone: "warn" },
  unscheduled: { icon: Film },
  manual: { icon: Rocket },
  ideas: { icon: Lightbulb },
  trends: { icon: TrendingUp },
  stale: { icon: TrendingUp, tone: "fill" },
};

/**
 * Things needing attention, rules-based (no server): overdue posts, edited posts without a day, posts whose
 * X / Snapchat step is due now (round 30 · A6: the owner posts those by hand, one row per post, opening the
 * hub's "Post these yourself" list), ideas waiting in the bank, new trend rows this week, platforms with an
 * account whose numbers are older than two weeks. A post with a due manual row gets no overdue row: the
 * manual row stands in for it, so the post is counted once. A grouped list: one row per item with its icon
 * and a chevron to where it is handled, or one "all clear" row. A line may take two lines, so the half that says what
 * to do stays readable.
 */
export default function InboxCard({ today, now }: { today: string; now: number }) {
  const { t, L, lang } = useT();
  const posts = useStore((s) => s.posts);
  const ideas = useStore((s) => s.ideas);
  const trends = useStore((s) => s.trends);
  const snapshots = useStore((s) => s.socialSnapshots);
  const accounts = useStore((s) => s.socialAccounts);

  const rows = useMemo<InboxRow[]>(() => {
    const out: InboxRow[] = [];
    const dueManual = dueManualPosts(posts, now);
    const manualIds = new Set(dueManual.map((p) => p.id));
    for (const p of overduePosts(posts, now))
      if (!manualIds.has(p.id))
        out.push({
          id: `overdue:${p.id}`,
          kind: "overdue",
          key: "social.studio.inboxOverdue",
          name: p.title,
          href: calendarPostHref(p.id),
        });
    for (const p of posts)
      if (p.stage === "edited" && p.plannedDay === null)
        out.push({
          id: `unscheduled:${p.id}`,
          kind: "unscheduled",
          key: "social.studio.inboxUnscheduled",
          name: p.title,
          href: calendarPostHref(p.id),
        });
    const list = new Intl.ListFormat(lang === "ar" ? "ar" : "en", { type: "conjunction" });
    for (const p of dueManual)
      out.push({
        id: `manual:${p.id}`,
        kind: "manual",
        key: "social.studio.inboxManual",
        name: p.title,
        vars: {
          platforms: list.format(pendingManualPlatforms(p).map((m) => L(PLATFORM_META[m].name))),
        },
        href: "/social/automations/#manual",
      });
    const waiting = ideasCount({ ideas, posts });
    if (waiting > 0)
      out.push({
        id: "ideas",
        kind: "ideas",
        key: "social.studio.inboxIdeas",
        vars: { n: waiting },
        href: "/social/ideas/",
      });
    const since = now - NEW_TREND_DAYS * 86_400_000;
    const fresh = visibleTrends(trends, {}, new Date(now)).filter(
      (i) => i.platform !== "event" && Date.parse(i.seenAt) >= since,
    ).length;
    if (fresh > 0)
      out.push({
        id: "trends",
        kind: "trends",
        key: "trends.inboxNew",
        vars: { n: fresh },
        href: "/social/ideas/",
      });
    const cutoff = addDays(today, -STALE_DAYS);
    for (const platform of PLATFORMS) {
      if (!accounts.some((a) => a.platform === platform)) continue;
      const latest = latestSnapshot(snapshots, platform);
      if (!latest || latest.day < cutoff)
        out.push({
          id: `stale:${platform}`,
          kind: "stale",
          key: "social.studio.inboxStale",
          vars: { platform: L(PLATFORM_META[platform].name) },
          href: "/social/growth/",
        });
    }
    return out;
  }, [posts, ideas, trends, snapshots, accounts, today, now, L, lang]);

  return (
    <ListGroup
      header={t("social.studio.inbox")}
      testId="studio-inbox"
      data-count={rows.length}
      trailing={
        rows.length > 0 && (
          <Chip tone="warn" className="num" data-testid="studio-inbox-count">
            {rows.length}
          </Chip>
        )
      }
    >
      {rows.length === 0 ? (
        <ListRow
          icon={<Check size={22} strokeWidth={1.75} aria-hidden />}
          title={t("social.studio.inboxClear")}
          testId="studio-inbox-empty"
        />
      ) : (
        rows.map((r) => {
          const { icon: Icon, tone } = ICON[r.kind];
          return (
            <ListRow
              key={r.id}
              href={r.href}
              icon={<Icon size={22} strokeWidth={1.75} aria-hidden />}
              iconTone={tone}
              title={
                <span className="line-clamp-2 whitespace-normal">
                  {withName(t(r.key, r.vars), r.name)}
                </span>
              }
              chevron
              testId="inbox-row"
              data-kind={r.kind}
            />
          );
        })
      )}
    </ListGroup>
  );
}
