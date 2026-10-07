"use client";

import { Sparkles } from "lucide-react";
import { useMemo } from "react";
import { weeklyDiff, whatChanged } from "@/lib/analytics";
import type { SocialSnapshot } from "@/lib/domain";
import { useT } from "@/lib/i18n";

/** "What changed this week?": rule-based sentences over the last two weekly snapshots. */
export default function WhatChanged({
  snapshots,
  now,
}: {
  snapshots: readonly SocialSnapshot[];
  now: number;
}) {
  const { t, lang } = useT();
  const lines = useMemo(
    () => whatChanged(weeklyDiff(snapshots, now), lang),
    [snapshots, now, lang],
  );
  return (
    <section className="px-card flex flex-col gap-2" data-testid="analytics-changed-card">
      <h2 className="text-ink-2 flex items-center gap-2 text-[13px] font-semibold">
        <Sparkles size={15} strokeWidth={1.75} className="text-tint shrink-0" aria-hidden />
        {t("growth.changed.title")}
      </h2>
      <ul className="flex flex-col gap-1 text-sm" data-testid="analytics-changed-text">
        {lines.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
    </section>
  );
}
