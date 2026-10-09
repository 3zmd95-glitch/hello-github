"use client";

import type { DiscoverUsage } from "@/lib/discover";
import { useT } from "@/lib/i18n";

export default function DiscoverUsageLine({
  usage,
  testId,
}: {
  usage: DiscoverUsage;
  testId: string;
}) {
  const { t, lang } = useT();
  const paid = "used" in usage.tavily ? usage.tavily : undefined;
  const reportedNumber = (value: number | null | undefined) =>
    typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
  const paidUsed = reportedNumber(paid?.paygoUsed);
  const paidLimit = reportedNumber(paid?.paygoLimit);
  const observedAt = "observedAt" in usage.tavily ? usage.tavily.observedAt : undefined;
  const date = observedAt ? new Date(observedAt) : undefined;
  const checked =
    date && Number.isFinite(date.getTime())
      ? date.toLocaleString(lang, {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })
      : undefined;
  return (
    <p className="text-muted ms-auto text-xs" data-testid={testId}>
      {checked ? t("feed.usageAsOf", { time: checked }) : t("feed.usageReported")}
      {"cached" in usage.tavily && usage.tavily.cached && ` (${t("feed.searchCached")})`}
      {" · "}
      {"used" in usage.tavily &&
        `${t("search.usage", { used: usage.tavily.used, limit: usage.tavily.limit ?? "∞" })} · `}
      {t("search.usageYt", { used: usage.youtube.usedToday, cap: usage.youtube.cap })}
      {(paidUsed !== undefined || paidLimit !== undefined) && (
        <span className="mt-0.5 block" data-testid="discover-paid-usage">
          {t("feed.paidUsage", {
            used: paidUsed ?? t("feed.notReported"),
            limit: paidLimit ?? t("feed.notReported"),
          })}
        </span>
      )}
    </p>
  );
}
