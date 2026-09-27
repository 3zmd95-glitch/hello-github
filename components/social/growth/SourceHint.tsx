"use client";

import { formatDayShort } from "@/components/planner/weekLabel";
import type { MetricSource } from "@/lib/analytics";
import { useT } from "@/lib/i18n";

/** "from 6 posts" / "from the 27 Sep snapshot" / "no data": where a metric's value came from. */
export default function SourceHint({
  source,
  sample,
  day,
  testId,
  className = "",
}: {
  source: MetricSource;
  sample: number;
  day: string | null | undefined;
  testId?: string;
  className?: string;
}) {
  const { t, lang } = useT();
  const text =
    source === "posts"
      ? t("growth.source.posts", { n: sample })
      : source === "snapshot" && day
        ? t("growth.source.snapshot", { day: formatDayShort(day, lang) })
        : t("growth.source.none");
  return (
    <span
      className={`text-muted text-[0.68rem] leading-tight ${className}`}
      data-testid={testId}
      data-source={source}
    >
      {text}
    </span>
  );
}
