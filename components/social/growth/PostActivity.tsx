"use client";

import type { CSSProperties, ReactNode } from "react";
import type { PlatformOverview, PostCounts } from "@/lib/analytics";
import { useT } from "@/lib/i18n";
import { PLATFORM_META } from "@/lib/social";

/**
 * Post Activity: posts last 90 days · last month · last week (from the imported posts), optional per-platform
 * mini rows (the "All" view) and a slot for the AI-style prompt and its answer.
 */
export default function PostActivity({
  title,
  counts,
  rows,
  note,
  children,
}: {
  title: string;
  counts: PostCounts;
  rows?: readonly PlatformOverview[];
  note?: string;
  children?: ReactNode;
}) {
  const { t, L } = useT();
  const tiles: [string, number, string][] = [
    ["90", counts.posts90d, t("growth.activity.d90")],
    ["30", counts.posts30d, t("growth.activity.d30")],
    ["7", counts.posts7d, t("growth.activity.d7")],
  ];
  return (
    <section className="px-card flex flex-col gap-3" data-testid="post-activity">
      <h2 className="text-base">{title}</h2>
      <div className="grid grid-cols-3 gap-2">
        {tiles.map(([id, n, label]) => (
          <div key={id} className="px-inset an-kpi" data-testid={`activity-${id}`} data-value={n}>
            <span className="text-muted text-xs">{label}</span>
            <b className="gr-value">{n}</b>
          </div>
        ))}
      </div>
      {rows && rows.length > 0 && (
        <ul className="an-mini" aria-label={title}>
          {rows.map((o) => {
            const meta = PLATFORM_META[o.platform];
            return (
              <li
                key={o.platform}
                className="an-mini-row"
                data-testid="activity-platform"
                data-platform={o.platform}
                style={{ "--c": meta.color } as CSSProperties}
              >
                <i className="gr-key" aria-hidden />
                <span aria-hidden>{meta.icon}</span>
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                  {L(meta.name)}
                </span>
                <span className="num text-ink-2 text-xs" dir="ltr">
                  {o.posts.posts90d} · {o.posts.posts30d} · {o.posts.posts7d}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {children}
      {note && <p className="text-muted text-xs">{note}</p>}
    </section>
  );
}
