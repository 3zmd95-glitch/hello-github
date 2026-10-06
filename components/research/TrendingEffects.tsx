"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  effectQuery,
  fetchTrendingEffects,
  rowVisible,
  runTrendingEffectsNow,
  type TrendingEffect,
  type TrendingEffects as Trending,
} from "@/lib/effects";
import { useT } from "@/lib/i18n";
import type { ScoutConfig } from "@/lib/scoutClient";

const CREATIVE_CENTER =
  "https://ads.tiktok.com/business/creativecenter/inspiration/popular/hashtag/pc/en";
const HOUR = 3_600_000;
/** YouTube's views of the week up at least this much: the "▶ ↑N×" note. */
const YT_NOTE_FROM = 1.5;

/**
 * 🔥 Discover's row of this week's trending editing effects (planning/tools/18-trending-effects.md §4): the Worker's
 * daily list as chips that each run a search, a first-scan button before the Worker's first run, and nothing at all
 * for an older Worker, a list older than 3 days or an answer that did not come. TikTok / Instagram figures are
 * creators mentioning the effect, never views; only the YouTube note counts views.
 */
export default function TrendingEffects({
  config,
  onPick,
}: {
  config: ScoutConfig;
  /** A tapped chip's search ({@link effectQuery}). */
  onPick: (q: string) => void;
}) {
  const { t, L } = useT();
  const id = useId();
  // Captured once, like the panel's: the age line needs no ticking clock.
  const [now] = useState(() => Date.now());
  const [data, setData] = useState<Trending | null>(null);
  const [running, setRunning] = useState(false);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    void fetchTrendingEffects(config).then((r) => {
      if (alive) setData(r);
    });
    return () => {
      alive = false;
    };
  }, [config]);

  const state = rowVisible(data, now);
  if (!data || state === "hidden") return null;

  // About a minute. Leaving Discover never cancels it (lib/effects keeps its answer for the next visit); here its
  // answer is then ignored.
  const runNow = () => {
    setRunning(true);
    void runTrendingEffectsNow(config).then((r) => {
      if (!mounted.current) return;
      if (r) setData(r);
      setRunning(false);
    });
  };

  // The UI language, English when the effect has no Arabic name or line.
  const text = (x: { en: string; ar?: string }) => L({ en: x.en, ar: x.ar || x.en });

  const chip = (e: TrendingEffect) => {
    const name = text(e.name);
    const what = e.what && text(e.what);
    const g = e.youtube?.growth;
    const yt = g !== undefined && g >= YT_NOTE_FROM ? `▶ ↑${Math.round(g * 10) / 10}×` : "";
    const creators = t("search.trendingCreators", { n: e.creators });
    return (
      <button
        key={e.key}
        type="button"
        className="px-chip shrink-0 flex-col items-start gap-0.5 py-1"
        title={what}
        aria-label={[name, e.isNew && t("search.trendingNew"), creators, yt, what]
          .filter(Boolean)
          .join(" · ")}
        onClick={() => onPick(effectQuery(e))}
        data-testid="trending-effect"
        data-key={e.key}
      >
        <span className="flex items-center gap-1.5">
          <span dir="auto">{name}</span>
          {e.isNew && (
            <span className="bg-gold text-gold-ink rounded-[2px] px-1 text-[10px] leading-4 font-bold">
              {t("search.trendingNew")}
            </span>
          )}
        </span>
        <span className="text-ink-2 text-[11px] font-normal">
          {creators}
          {yt && (
            <>
              {" · "}
              <span dir="ltr">{yt}</span>
            </>
          )}
        </span>
      </button>
    );
  };

  return (
    <section
      aria-labelledby={`${id}-title`}
      className="flex min-w-0 flex-col gap-1.5"
      data-testid="trending-effects"
      data-state={state}
    >
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <h2 id={`${id}-title`} className="text-sm font-bold">
          {t("search.trendingTitle")}
        </h2>
        {state !== "never" && (
          <>
            <span className="text-muted text-xs">
              {t("search.trendingUpdated", {
                n: Math.max(1, Math.round((now - Date.parse(data.updatedAt ?? "")) / HOUR)),
              })}
            </span>
            <a
              href={CREATIVE_CENTER}
              target="_blank"
              rel="noopener noreferrer"
              className="px-link text-xs"
            >
              {t("search.trendingCreative")}
            </a>
          </>
        )}
      </div>
      {state === "stale-failed" && (
        <p className="text-muted text-xs">{t("search.trendingStale")}</p>
      )}
      {state === "never" ? (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="px-btn px-btn-sm"
            disabled={running}
            onClick={runNow}
            data-testid="trending-run"
          >
            {t("search.trendingRun")}
          </button>
          {running && (
            <p role="status" className="text-muted text-xs">
              {t("search.trendingRunning")}
            </p>
          )}
        </div>
      ) : (
        // One row that scrolls sideways (the page never does), like the genre chips.
        <div className="flex min-w-0 gap-1.5 overflow-x-auto px-0.5 pt-0.5 pb-1.5">
          {data.items.map(chip)}
        </div>
      )}
    </section>
  );
}
