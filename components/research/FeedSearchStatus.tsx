"use client";

import type { DiscoverPlatformError } from "@/lib/discover";
import type { DiscoverSourceDiagnostic } from "@/lib/discoverExpansion";
import { useT, type MessageKey } from "@/lib/i18n";
import type { ResearchTab } from "@/lib/research";
import { PLATFORM_META } from "./ResultCard";

const states: Record<DiscoverSourceDiagnostic["state"], MessageKey> = {
  found: "feed.searchFound",
  empty: "feed.searchEmpty",
  partial: "feed.searchPartial",
  error: "feed.searchFailed",
  unknown: "feed.searchUnknown",
};
const errors: Record<DiscoverPlatformError, MessageKey> = {
  quota: "feed.searchQuota",
  auth: "feed.searchAuth",
  upstream: "feed.searchUpstream",
  daily_cap: "feed.searchDailyCap",
  not_configured: "feed.searchNotConfigured",
};

/** Search health stays separate from the feed's stricter relevance and evidence counts. */
export default function FeedSearchStatus({
  diagnostics,
  tab,
}: {
  diagnostics: DiscoverSourceDiagnostic[];
  tab: ResearchTab;
}) {
  const { t } = useT();
  const shown = diagnostics.filter((item) => tab === "all" || item.platform === tab);
  if (!shown.length) return null;
  return (
    <div
      className="border-edge text-muted border-s-2 ps-2 text-xs"
      data-testid="feed-search-status"
    >
      <p className="font-bold">{t("feed.searchStatus")}</p>
      <ul className="mt-1 flex flex-col gap-1">
        {shown.map((item) => (
          <li
            key={item.platform}
            data-testid={`feed-search-${item.platform}`}
            data-state={item.state}
            data-error={item.error}
          >
            {t(states[item.state], {
              platform: PLATFORM_META[item.platform].label,
              n: item.returned,
            })}
            {item.error && ` ${t(errors[item.error])}`}
            {item.cached && ` ${t("feed.searchCached")}`}
          </li>
        ))}
      </ul>
      {shown.some((item) => item.returned > 0) && (
        <p className="mt-1">{t("feed.searchFiltered")}</p>
      )}
    </div>
  );
}
