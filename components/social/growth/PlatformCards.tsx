"use client";

import type { CSSProperties } from "react";
import {
  AVERAGE_MIN_POSTS,
  METRIC_LABELS,
  type MetricKey,
  type PlatformOverview,
} from "@/lib/analytics";
import type { Platform } from "@/lib/domain";
import { useT } from "@/lib/i18n";
import { PLATFORM_META } from "@/lib/social";
import SourceHint from "./SourceHint";
import { fmtMetric, profileUrl } from "./format";

/** The "All" view's platform cards: icon, handle ↗, Followers / Engagement / Avg. Likes / Avg. Views. */
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
      className="px-card an-pcard flex flex-col gap-3"
      data-testid="platform-card"
      data-platform={o.platform}
      style={{ "--c": meta.color } as CSSProperties}
    >
      <header className="flex items-center gap-3">
        <span aria-hidden className="gr-platform-icon">
          {meta.icon}
        </span>
        <div className="flex min-w-0 flex-col">
          <h3 className="text-base leading-tight">{L(meta.name)}</h3>
          {link && o.account ? (
            <a
              href={link}
              target="_blank"
              rel="noreferrer noopener"
              className="num text-ink-2 inline-flex items-center gap-1 text-xs underline-offset-2 hover:underline"
              dir="ltr"
              aria-label={t("growth.cards.link", { platform: L(meta.name) })}
              data-testid="platform-card-link"
            >
              @{o.account.handle}
              <span aria-hidden className="an-ext">
                ↗
              </span>
            </a>
          ) : (
            <span className="text-muted text-xs">{t("growth.account.none")}</span>
          )}
        </div>
        <button
          type="button"
          className="px-btn px-btn-ghost px-btn-sm ms-auto"
          onClick={() => onOpen(o.platform)}
          data-testid="platform-card-open"
        >
          {t("growth.cards.open")}
          <span aria-hidden className="rtl:rotate-180">
            ›
          </span>
        </button>
      </header>
      <dl className="an-rows">
        {o.cardRows.map((r) => (
          <div
            key={r.metric}
            className="an-row"
            data-testid="card-row"
            data-metric={r.metric}
            data-source={r.source}
          >
            <dt className="text-muted text-xs">{cardLabel(r.metric)}</dt>
            <dd className="num text-sm font-bold">{fmtMetric(r.value, r.format)}</dd>
          </div>
        ))}
      </dl>
      <SourceHint
        source={source}
        sample={o.sample}
        day={o.snapshot?.day}
        testId="platform-card-source"
      />
    </article>
  );
}
