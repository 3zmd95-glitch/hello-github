"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { BT_BLOCKS, blockLabel, learnBestTimes, timesForDay, type BestCell } from "@/lib/bestTimes";
import { PLATFORMS, type Platform, type SocialPostStat } from "@/lib/domain";
import { useT, type MessageKey } from "@/lib/i18n";
import { PlatformGlyph } from "@/lib/platformIcons";
import { PLATFORM_META } from "@/lib/social";

/** The calendar's Saturday-first week: the rows run Saturday … Friday; `dow` is JS (0 = Sunday). */
const WEEK_DOW = [6, 0, 1, 2, 3, 4, 5] as const;
const DAY_SHORT: readonly MessageKey[] = [
  "calendar.dayShort.0",
  "calendar.dayShort.1",
  "calendar.dayShort.2",
  "calendar.dayShort.3",
  "calendar.dayShort.4",
  "calendar.dayShort.5",
  "calendar.dayShort.6",
];
const DAY_LONG: readonly MessageKey[] = [
  "calendar.day.0",
  "calendar.day.1",
  "calendar.day.2",
  "calendar.day.3",
  "calendar.day.4",
  "calendar.day.5",
  "calendar.day.6",
];
/** Index into the Saturday-first message keys. */
const keyIndex = (dow: number): number => (dow + 1) % 7;

/** How strongly a cell is tinted: a post-less cell stays blank, any other starts visibly above it. */
const tint = (c: BestCell): number => (c.n === 0 ? 0 : 14 + c.pct * 0.76);

/**
 * A5 · Best times to post (Metricool's "Best times" heat map, but from the owner's own posts): a week x 2-hour
 * heat map for one platform plus the top three slots, "from when your posts did best". With fewer than 20 settled
 * posts it says how many are missing and shows the usual times instead. In the All view the card has its own
 * platform chips; in a platform's view it follows that platform.
 */
export default function BestTimes({
  stats,
  platform,
  now,
}: {
  stats: readonly SocialPostStat[];
  /** The page's platform filter; undefined in the All view. */
  platform?: Platform;
  /** Riyadh end of today, in ms: the 72-hour and 180-day windows hang on it. */
  now: number;
}) {
  const { t, L } = useT();
  const [picked, setPicked] = useState<Platform | null>(null);

  const withStats = useMemo(
    () =>
      PLATFORMS.map((p) => ({ p, n: stats.filter((s) => s.platform === p).length }))
        .filter((x) => x.n > 0)
        .sort((a, b) => b.n - a.n)
        .map((x) => x.p),
    [stats],
  );
  const chosen: Platform =
    platform ?? (picked && withStats.includes(picked) ? picked : (withStats[0] ?? "tiktok"));
  const learned = useMemo(() => learnBestTimes(stats, chosen, now), [stats, chosen, now]);
  const name = L(PLATFORM_META[chosen].name);
  const best = learned.top[0];

  return (
    <section
      className="px-card flex flex-col gap-3"
      data-testid="best-times"
      data-platform={chosen}
      data-ready={learned.ready}
      data-posts={learned.posts}
    >
      <div className="flex flex-col gap-0.5">
        <h2 className="text-ink-2 text-[13px] font-semibold">{t("growth.bt.title")}</h2>
        <p className="text-muted text-xs">{t("growth.bt.sub")}</p>
      </div>

      {!platform && withStats.length > 1 && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("growth.bt.platforms")}>
          {withStats.map((p) => (
            <button
              key={p}
              type="button"
              className="px-fchip cal-fchip"
              aria-pressed={chosen === p}
              onClick={() => setPicked(p)}
              data-testid={`best-times-platform-${p}`}
              data-platform={p}
            >
              <PlatformGlyph platform={p} size={14} className="shrink-0" />
              {L(PLATFORM_META[p].name)}
            </button>
          ))}
        </div>
      )}

      {learned.ready ? (
        <>
          <ul className="an-mini" aria-label={t("growth.bt.top")} data-testid="best-times-top">
            {learned.top.map((c) => (
              <li
                key={`${c.dow}:${c.block}`}
                className="an-mini-row"
                data-testid="best-time-slot"
                data-dow={c.dow}
                data-block={c.block}
                data-time={c.time}
                data-pct={c.pct}
              >
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                  {t(DAY_LONG[keyIndex(c.dow ?? 0)])}{" "}
                  <span className="num" dir="ltr">
                    {c.time}
                  </span>
                </span>
                <span className="text-muted text-xs">{t("growth.bt.n", { n: c.n })}</span>
                <span className="num text-tint text-xs font-semibold" dir="ltr">
                  {c.pct}%
                </span>
              </li>
            ))}
          </ul>

          <div
            className="bt-grid"
            role="img"
            aria-label={t("growth.bt.aria", {
              platform: name,
              slot: best ? `${t(DAY_LONG[keyIndex(best.dow ?? 0)])} ${best.time}` : "–",
            })}
            data-testid="best-times-grid"
          >
            <div className="bt-row" aria-hidden>
              <span />
              <div className="bt-strip">
                {Array.from({ length: BT_BLOCKS / 3 }, (_, i) => (
                  <span key={i} className="bt-hr">
                    {String(i * 6).padStart(2, "0")}
                  </span>
                ))}
              </div>
            </div>
            {WEEK_DOW.map((dow) => (
              <div key={dow} className="bt-row" aria-hidden>
                <span className="bt-day">{t(DAY_SHORT[keyIndex(dow)])}</span>
                <div className="bt-strip">
                  {learned.cells
                    .filter((c) => c.dow === dow)
                    .map((c) => (
                      <i
                        key={c.block}
                        className="bt-cell"
                        style={{ "--m": tint(c) } as CSSProperties}
                        title={`${t(DAY_SHORT[keyIndex(dow)])} ${blockLabel(c.block)} · ${c.n} · ${c.pct}%`}
                        data-testid="best-time-cell"
                        data-n={c.n}
                        data-pct={c.pct}
                      />
                    ))}
                </div>
              </div>
            ))}
          </div>
          <p className="text-muted text-xs">{t("growth.bt.legend")}</p>
          <p className="text-muted text-xs">{t("growth.bt.based", { n: learned.posts })}</p>
        </>
      ) : (
        <>
          <p className="text-ink-2 text-sm" data-testid="best-times-needs">
            {learned.reason === "noViews"
              ? t("growth.bt.noViews", { platform: name })
              : t("growth.bt.few", { platform: name, needed: learned.needed, n: learned.posts })}
          </p>
          <ul className="flex flex-wrap gap-1.5" data-testid="best-times-usual">
            {timesForDay(learned).times.map((time) => (
              <li key={time} className="ios-chip num" dir="ltr">
                {time}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
