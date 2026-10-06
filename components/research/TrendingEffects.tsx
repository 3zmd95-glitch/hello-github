"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  cachedTrendingEffects,
  effectQuery,
  fetchTrendingEffects,
  rowVisible,
  runTrendingEffectsNow,
  scanInFlight,
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
  // This tab's copy first (an hour at most; lib reads it in try/catch), so a revisit renders the row at once and
  // nothing pops in under a tap. Read in render safely: AppShell shows its Splash until the store hydrates on the
  // client (`skipHydration`), so the server never renders this row and no hydration can mismatch.
  const [data, setData] = useState<Trending | null>(() => cachedTrendingEffects(config));
  // The first scan from this row: running, or failed to answer (its line shows until the next tap).
  const [scan, setScan] = useState<"idle" | "running" | "failed">("idle");
  const mounted = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /** A first scan's answer: its list; the Worker's own failed run (the button and the failure line stay); or the
   * failure line (null: the request failed). */
  const landed = useCallback((r: Trending | null) => {
    setScan(r ? "idle" : "failed");
    if (!r) return;
    setData(r);
    if (!r.items.length) return;
    // The button goes: focus moves to the row's heading rather than drop to the page, unless the owner is busy
    // elsewhere meanwhile; without scrolling to it, as the owner may have scrolled down during the minute.
    const h = heading.current;
    const at = document.activeElement;
    if (h && (!at || at === document.body || h.closest("section")?.contains(at)))
      h.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    let alive = true;
    void fetchTrendingEffects(config).then((r) => {
      if (!alive) return;
      // No list yet: this tab's first scan may still run (show it waiting, then its answer), or may have answered
      // into the tab's copy while this GET was on its way (show that list).
      const pending = r && !r.items.length ? scanInFlight(config) : undefined;
      const meanwhile = r && !r.items.length && !pending ? cachedTrendingEffects(config) : null;
      setData(meanwhile ?? r);
      if (!pending) return;
      setScan("running");
      void pending.then((s) => {
        if (alive) landed(s);
      });
    });
    return () => {
      alive = false;
    };
  }, [config, landed]);

  const state = rowVisible(data, now);
  if (!data || state === "hidden") return null;

  // About a minute. Leaving Discover never cancels it (lib/effects keeps the list it finds for the next visit, and a
  // revisit meanwhile waits for it); this row then ignores its answer.
  const runNow = () => {
    setScan("running");
    void runTrendingEffectsNow(config).then((r) => {
      if (mounted.current) landed(r);
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
        <h2 ref={heading} id={`${id}-title`} tabIndex={-1} className="text-sm font-bold">
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
            disabled={scan === "running"}
            onClick={runNow}
            data-testid="trending-run"
          >
            {t("search.trendingRun")}
          </button>
          {/* Always there (empty while idle), so its next words are announced. A scan that could not answer, or
              the Worker's own failed run (no list yet), says so; the button stays for a retry. */}
          <p role="status" className="text-muted text-xs">
            {scan === "running"
              ? t("search.trendingRunning")
              : scan === "failed" || data.status === "failed"
                ? t("search.trendingRunFailed")
                : ""}
          </p>
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
