"use client";

import Link from "next/link";
import { useMemo } from "react";
import { PLATFORMS } from "@/lib/domain";
import { latestSnapshot } from "@/lib/growth";
import { useT, type MessageKey, type Vars } from "@/lib/i18n";
import { PLATFORM_META, overduePosts } from "@/lib/social";
import { addDays } from "@/lib/streak";
import { visibleTrends } from "@/lib/trends";
import { ideasCount, useStore } from "@/store";
import { calendarPostHref } from "./platform";

/** Numbers older than this many days count as stale for a platform the owner has an account on. */
const STALE_DAYS = 14;
/**
 * A trend row counts as new while its `seenAt` (first seen by the Worker) is within this many days (📈 Trend
 * Radar, round 30). Calendar moments (platform `event`) are never counted: they are not trends.
 */
const NEW_TREND_DAYS = 7;

interface InboxRow {
  id: string;
  kind: "overdue" | "unscheduled" | "ideas" | "trends" | "stale";
  key: MessageKey;
  vars?: Vars;
  href: string;
}

/**
 * Things needing attention, rules-based (no server): overdue posts, edited posts without a day, ideas
 * waiting in the bank, new trend rows this week, platforms with an account whose numbers are older than
 * two weeks.
 */
export default function InboxCard({ today, now }: { today: string; now: number }) {
  const { t, L } = useT();
  const posts = useStore((s) => s.posts);
  const ideas = useStore((s) => s.ideas);
  const trends = useStore((s) => s.trends);
  const snapshots = useStore((s) => s.socialSnapshots);
  const accounts = useStore((s) => s.socialAccounts);

  const rows = useMemo<InboxRow[]>(() => {
    const out: InboxRow[] = [];
    for (const p of overduePosts(posts, now))
      out.push({
        id: `overdue:${p.id}`,
        kind: "overdue",
        key: "social.studio.inboxOverdue",
        vars: { name: p.title },
        href: calendarPostHref(p.id),
      });
    for (const p of posts)
      if (p.stage === "edited" && p.plannedDay === null)
        out.push({
          id: `unscheduled:${p.id}`,
          kind: "unscheduled",
          key: "social.studio.inboxUnscheduled",
          vars: { name: p.title },
          href: calendarPostHref(p.id),
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
  }, [posts, ideas, trends, snapshots, accounts, today, now, L]);

  return (
    <section
      className="px-card flex flex-col gap-3"
      data-testid="studio-inbox"
      data-count={rows.length}
    >
      <header className="flex items-center justify-between gap-2">
        <h2 className="text-base">{t("social.studio.inbox")}</h2>
        {rows.length > 0 && (
          <span className="px-chip px-chip-gold num" data-testid="studio-inbox-count">
            {rows.length}
          </span>
        )}
      </header>
      {rows.length === 0 ? (
        <p className="text-accent text-sm font-semibold" data-testid="studio-inbox-empty">
          {t("social.studio.inboxClear")}
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {rows.map((r) => (
            <li key={r.id}>
              <Link
                href={r.href}
                className="px-inset text-ink flex items-center gap-2 text-sm no-underline"
                data-testid="inbox-row"
                data-kind={r.kind}
              >
                <span className="min-w-0 flex-1">{t(r.key, r.vars)}</span>
                <span aria-hidden className="text-muted rtl:rotate-180">
                  ›
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
