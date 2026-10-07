"use client";

import { ArrowUpRight, ChevronLeft } from "lucide-react";
import PlatformBadge from "@/components/ui/ios/PlatformBadge";
import {
  AVERAGE_MIN_POSTS,
  METRIC_LABELS,
  type MetricKey,
  type PlatformOverview,
} from "@/lib/analytics";
import type { Platform } from "@/lib/domain";
import { useT } from "@/lib/i18n";
import { PLATFORM_META } from "@/lib/social";
import SourceBadge from "./SourceBadge";
import SourceHint from "./SourceHint";
import { fmtMetric, profileUrl } from "./format";

/**
 * The "All" view's platform cards: badge, name, handle (opens the profile), where the numbers came from, then
 * Followers / Engagement / Avg. Likes / Avg. Views as stat tiles. The tiles do not count up: a page of cards would
 * start a dozen count-ups at once.
 */
export default function PlatformCards({
  platforms,
  onOpen,
}: {
  platforms: readonly PlatformOverview[];
  onOpen: (platform: Platform) => void;
}) {
  const { t } = useT();
  return (
    <section className="flex flex-col gap-2" data-testid="platform-cards">
      <h2 className="text-base">{t("growth.cards.title")}</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {platforms.map((o) => (
          <PlatformCard key={o.platform} overview={o} onOpen={onOpen} />
        ))}
      </div>
    </section>
  );
}

function PlatformCard({
  overview: o,
  onOpen,
}: {
  overview: PlatformOverview;
  onOpen: (platform: Platform) => void;
}) {
  const { t, L } = useT();
  const meta = PLATFORM_META[o.platform];
  const link = o.account ? o.account.url || profileUrl(o.platform, o.account.handle) : null;
  const cardLabel = (metric: MetricKey): string =>
    metric === "totalFollowers"
      ? t("growth.followers")
      : metric === "totalSubscribers"
        ? t("growth.subscribers")
        : L(METRIC_LABELS[metric]);
  const source = o.sample >= AVERAGE_MIN_POSTS ? "posts" : o.snapshot ? "snapshot" : "none";

  return (
    <article
      className="ios-card flex flex-col gap-3"
      data-testid="platform-card"
      data-platform={o.platform}
    >
      <header className="flex items-center gap-3">
        <PlatformBadge platform={o.platform} />
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="text-[17px] leading-tight font-semibold">{L(meta.name)}</h3>
          {link && o.account ? (
            <a
              href={link}
              target="_blank"
              rel="noreferrer noopener"
              className="num text-ink-2 inline-flex items-center gap-0.5 self-start text-[13px] no-underline hover:underline"
              dir="ltr"
              aria-label={t("growth.cards.link", { platform: L(meta.name) })}
              data-testid="platform-card-link"
            >
              @{o.account.handle}
              <ArrowUpRight size={13} strokeWidth={1.75} aria-hidden />
            </a>
          ) : (
            <span className="text-muted text-[13px]">{t("growth.account.none")}</span>
          )}
        </div>
        <button
          type="button"
          className="px-btn px-btn-ghost px-btn-sm ms-auto shrink-0"
          onClick={() => onOpen(o.platform)}
          data-testid="platform-card-open"
        >
          {t("growth.cards.open")}
          <ChevronLeft size={16} strokeWidth={1.75} className="ltr:rotate-180" aria-hidden />
        </button>
      </header>
      <SourceBadge platform={o.platform} latestDay={o.snapshot?.day} className="self-start" />
      <div className="grid grid-cols-2 gap-2">
        {o.cardRows.map((r) => (
          <div
            key={r.metric}
            className="ios-stat"
            data-testid="card-row"
            data-metric={r.metric}
            data-source={r.source}
          >
            <small>{cardLabel(r.metric)}</small>
            <b className="num">{fmtMetric(r.value, r.format)}</b>
          </div>
        ))}
      </div>
      <SourceHint
        source={source}
        sample={o.sample}
        day={o.snapshot?.day}
        testId="platform-card-source"
      />
    </article>
  );
}
