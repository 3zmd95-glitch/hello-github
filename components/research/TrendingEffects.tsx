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

/** The line under the first-scan button, by the scan's state. */
const SCAN_LINE = {
  running: "search.trendingRunning",
  failed: "search.trendingRunFailed",
  limit: "search.trendingRunLimit",
  none: "search.trendingNone",
} as const;

/** Where the row rests after a scan's answer `r` (null: the request failed). */
function afterScan(r: Trending | null): "idle" | "failed" | "limit" | "none" {
  if (r?.items.length) return "idle";
  // The Worker's tries for the day are spent: the button rests until the next visit.
  if (r?.notes?.includes("attempts")) return "limit";
  // A run that found nothing rests too. No answer, or the Worker's own failed run with no list: a retry.
  return r?.status === "ok" || r?.status === "partial" ? "none" : "failed";
}

/**
 * 🔥 Discover's row of this week's trending editing effects (planning/tools/18-trending-effects.md §4): the Worker's
 * daily list as chips that each run a search, with "Scan again" to run the job now; a first-scan button before the
 * Worker's first run, and nothing at all for an older Worker, a list older than 3 days or an answer that did not
 * come. TikTok / Instagram figures are creators mentioning the effect, never views; only the YouTube note counts views.
 */
export default function TrendingEffects({
  config,
  onPick,
}: {
  config: ScoutConfig;
  /** A tapped chip's search ({@link effectQuery}). */
  onPick: (q: string) => void;
}) {
  const { t } = useT();
  const id = useId();
  // Captured once, like the panel's: the age line needs no ticking clock.
  const [now] = useState(() => Date.now());
  // This tab's copy first (an hour at most; lib reads it in try/catch), so a revisit renders the row at once and
  // nothing pops in under a tap. Read in render safely: AppShell shows its Splash until the store hydrates on the
  // client (`skipHydration`), so the server never renders this row and no hydration can mismatch.
  const [data, setData] = useState<Trending | null>(() => cachedTrendingEffects(config));
  // A scan from this row: running; failed to answer (its line shows until the next tap, and what the row showed
  // stays); or a first scan answered without a list and resting until the next visit, the button off: the Worker's
  // tries for the day are spent ("limit"), or nothing trends widely enough yet ("none").
  const [scan, setScan] = useState<"idle" | "running" | "failed" | "limit" | "none">("idle");
  const mounted = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const runButton = useRef<HTMLButtonElement>(null);
  const rescanButton = useRef<HTMLButtonElement>(null);
  /** Where focus goes once a scan's answer is on screen, read after that render. */
  const focusNext = useRef<(() => HTMLElement | null) | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // After the render that shows a scan's answer: the button is enabled again by then. Without scrolling to it, as the
  // owner may have scrolled down during the minute.
  useEffect(() => {
    focusNext.current?.()?.focus({ preventScroll: true });
    focusNext.current = null;
  });

  /** A scan's answer (null: the request failed); `rescan`: it came from Scan again. */
  const landed = useCallback((r: Trending | null, rescan = false) => {
    const next = afterScan(r);
    // A failed scan changes only its line: the list on screen stays, or the first-scan button.
    if (r && next !== "failed") setData(r);
    setScan(next);
    // Focus goes back to the button when it is enabled again (Chrome drops it to the page while the button is
    // disabled): Scan again, or the first-scan button for a retry. Else to the heading: the chips replaced the
    // first-scan button, or it rests disabled. Not when the owner is busy elsewhere.
    const at = document.activeElement;
    const free = !at || at === document.body || heading.current?.closest("section")?.contains(at);
    focusNext.current = free
      ? () =>
          (rescan ? rescanButton.current : next === "failed" ? runButton.current : null) ??
          heading.current
      : null;
  }, []);

  useEffect(() => {
    let alive = true;
    void fetchTrendingEffects(config).then((r) => {
      if (!alive) return;
      // This tab's scan may still run (show it waiting, then its answer). With no list yet, it may also have answered
      // into the tab's copy while this GET was on its way (show that list).
      const pending = r ? scanInFlight(config) : undefined;
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

  // A first scan that rests keeps the row as it was (not hidden after a minute of "Scanning…").
  const state = scan === "limit" || scan === "none" ? "never" : rowVisible(data, now);
  if (!data || state === "hidden") return null;

  // About a minute. Leaving Discover never cancels it (lib/effects keeps the list it finds for the next visit, and a
  // revisit meanwhile waits for it); this row then ignores its answer. `force`: Scan again, past the Worker's
  // once-a-day guard and its 3 tries a day.
  const runNow = (force: boolean) => {
    setScan("running");
    void runTrendingEffectsNow(config, { force }).then((r) => {
      if (mounted.current) landed(r, force);
    });
  };
  // The scan's line: waiting, or why it rests; before the first run, also the Worker's own failed run.
  const line =
    scan !== "idle"
      ? t(SCAN_LINE[scan])
      : state === "never" && data.status === "failed"
        ? t(SCAN_LINE.failed)
        : "";
  const age = now - Date.parse(data.updatedAt ?? "");

  // English first in both languages (live fix 1): the English name and line, the Arabic name in the tooltip under
  // the line.
  const chip = (e: TrendingEffect) => {
    const name = e.name.en;
    const what = e.what?.en;
    const g = e.youtube?.growth;
    const yt = g !== undefined && g >= YT_NOTE_FROM ? `▶ ↑${Math.round(g * 10) / 10}×` : "";
    const creators = t("search.trendingCreators", { n: e.creators });
    return (
      <button
        key={e.key}
        type="button"
        className="px-chip shrink-0 flex-col items-start gap-0.5 py-1"
        title={[what, e.name.ar].filter(Boolean).join("\n") || undefined}
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
              {/* A list made under an hour ago (or after this page opened: a scan just now) is "just now". */}
              {age < HOUR
                ? t("search.trendingUpdatedNow")
                : t("search.trendingUpdated", { n: Math.round(age / HOUR) })}
            </span>
            <a
              href={CREATIVE_CENTER}
              target="_blank"
              rel="noopener noreferrer"
              className="px-link text-xs"
            >
              {t("search.trendingCreative")}
            </a>
            <button
              ref={rescanButton}
              type="button"
              className="px-link text-xs disabled:opacity-50"
              disabled={scan === "running"}
              onClick={() => runNow(true)}
              data-testid="trending-rescan"
            >
              {t("search.trendingRescan")}
            </button>
            {/* Always there (empty while idle), so its next words are announced: waiting, or a scan that failed
                (the list stays). */}
            <span role="status" className="text-muted text-xs">
              {line}
            </span>
          </>
        )}
      </div>
      {state === "stale-failed" && (
        <p className="text-muted text-xs">{t("search.trendingStale")}</p>
      )}
      {state === "never" ? (
        <div className="flex flex-wrap items-center gap-2">
          <button
            ref={runButton}
            type="button"
            className="px-btn px-btn-sm"
            disabled={scan === "running" || scan === "limit" || scan === "none"}
            onClick={() => runNow(false)}
            data-testid="trending-run"
          >
            {t("search.trendingRun")}
          </button>
          {/* Always there (empty while idle), so its next words are announced. A scan that could not answer, or
              the Worker's own failed run (no list yet), says so; the button stays for a retry. The day's tries
              spent, or nothing trending yet, rest the button with their own line. */}
          <p role="status" className="text-muted text-xs">
            {line}
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
