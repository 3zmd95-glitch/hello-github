"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useVideoPlayer } from "@/components/player/VideoPlayerContext";
import { getSkill } from "@/data";
import {
  AREAS,
  cachedCategory,
  categoryScanInFlight,
  fetchCategory,
  pageState,
  runCategoryNow,
  type Area,
  type CategoryPageData,
  type LessonVideo,
  type Technique,
} from "@/lib/categories";
import type { Genre } from "@/lib/domain";
import { effectQuery, type TrendingEffect } from "@/lib/effects";
import { canEmbed } from "@/lib/embed";
import { useT, type MessageKey } from "@/lib/i18n";
import type { ScoutConfig } from "@/lib/scoutClient";
import { PLATFORM_META } from "./ResultCard";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const SHELF: Record<Area, MessageKey> = {
  photo: "search.categoryPhoto",
  video: "search.categoryVideo",
  edit: "search.categoryEdit",
};

/**
 * A scan from this page: running; failed (no answer, or the Worker's own run failed); paused on the month's credits
 * (noted `tavily_budget`: nothing was spent, so a retry may go through); over the Worker's 3 tries a day (noted
 * `attempts`: the scan buttons rest).
 */
type Scan = "idle" | "running" | "failed" | "paused" | "limit";
const afterScan = (r: CategoryPageData | null): Scan =>
  r?.notes?.includes("attempts")
    ? "limit"
    : r?.notes?.includes("tavily_budget")
      ? "paused"
      : !r || r.status === "failed"
        ? "failed"
        : "idle";
const SCAN_LINE: Record<Exclude<Scan, "idle">, MessageKey> = {
  running: "search.categoryRunning",
  failed: "search.trendingRunFailed",
  paused: "search.categoryBudget",
  limit: "search.trendingRunLimit",
};

/**
 * 🚗 A Discover category's page (planning/tools/19-category-trends.md §1, layout B):
 * - the header, with 🔄 Scan again;
 * - this week's trending styles of the category as chips (a tap searches the style within the category, in Keywords);
 * - the Photography / Videography / Editing shelves of technique cards: a ✦ AI how-to, the skill it practices, and
 *   example and tutorial videos that play in the app's player;
 * - "Search all <category> videos →".
 * Before there is anything to show: the first scan. A Worker without the route (or no answer) hands back to the
 * category search.
 */
export default function CategoryPage({
  config,
  genre,
  onPickStyle,
  onSearchAll,
  onOpenSkill,
  onUnavailable,
}: {
  config: ScoutConfig;
  genre: Genre;
  /** A tapped style's search words ({@link effectQuery}). */
  onPickStyle: (q: string) => void;
  onSearchAll: () => void;
  onOpenSkill: (skillId: string) => void;
  /** No page from this Worker (an older one, a refused token, no network): today's category search instead. */
  onUnavailable: () => void;
}) {
  const { t, L } = useT();
  const id = useId();
  const player = useVideoPlayer();
  // Captured once, like the 🔥 row's: the age line needs no ticking clock.
  const [now] = useState(() => Date.now());
  // This tab's copy first (an hour at most), so a revisit renders at once. AppShell renders on the client only.
  const [data, setData] = useState<CategoryPageData | null>(() => cachedCategory(config, genre.id));
  const [scan, setScan] = useState<Scan>("idle");
  const mounted = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  /** Focus the heading after the render that shows a scan's answer, when the owner was on this page. */
  const focusNext = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (focusNext.current) heading.current?.focus({ preventScroll: true });
    focusNext.current = false;
  });

  const landed = useCallback((r: CategoryPageData | null) => {
    if (!mounted.current) return;
    // An answer with nothing to show (none came, or the Worker's failed run without a page) never replaces a page on
    // screen: only the line changes.
    setData((d) => (!r || (d && pageState(d) !== "never" && pageState(r) === "never") ? d : r));
    setScan(afterScan(r));
    const at = document.activeElement;
    focusNext.current =
      !at || at === document.body || !!heading.current?.closest("section")?.contains(at);
  }, []);

  useEffect(() => {
    let alive = true;
    void fetchCategory(config, genre.id).then((r) => {
      if (!alive) return;
      if (!r) return onUnavailable();
      setData(r);
      // A scan this tab started before (Discover left and opened again) may still run: wait for its answer.
      const pending = categoryScanInFlight(config, genre.id);
      if (!pending) return;
      setScan("running");
      void pending.then(landed);
    });
    return () => {
      alive = false;
    };
  }, [config, genre.id, onUnavailable, landed]);

  // The first answer is on its way (a KV read).
  if (!data) return null;

  const name = L(genre.name);
  const state = pageState(data);
  const busy = scan === "running" || scan === "limit";
  // About a minute, more when the lessons are due. Leaving Discover never cancels it (lib/categories keeps the page).
  const runNow = (force: boolean) => {
    setScan("running");
    void runCategoryNow(config, genre.id, { force }).then(landed);
  };
  // A page made under an hour ago (or after this page opened: a scan just now) is "just now".
  const age = now - Date.parse(data.updatedAt ?? "");
  const updated =
    age < HOUR
      ? t("search.trendingUpdatedNow")
      : age < DAY
        ? t("search.trendingUpdated", { n: Math.round(age / HOUR) })
        : t("search.categoryUpdatedDays", { n: Math.floor(age / DAY) });
  // The live line: this page's scan; before the first page, also why the Worker's own run failed or paused.
  const shown =
    scan === "idle" && state === "never" && data.status === "failed" ? afterScan(data) : scan;
  const line = shown === "idle" ? "" : t(SCAN_LINE[shown], { genre: name });
  // Under the header until this page scans: why the page shown is not today's, from its notes and its date (Task 2's
  // review: a forced scan in a tight month fails a page that was fine, keeping its date). A paused month says so; a
  // failed update over a page made earlier today is a scan that failed, not a day without an update.
  const staleLine = data.notes?.includes("tavily_budget")
    ? t("search.categoryBudget")
    : new Date(now).toDateString() === new Date(Date.parse(data.updatedAt ?? "")).toDateString()
      ? t("search.trendingRunFailed")
      : t("search.trendingStale");
  // The UI language, English when a style has no Arabic name.
  const text = (x: { en: string; ar?: string }) => L({ en: x.en, ar: x.ar || x.en });

  const styleChip = (s: TrendingEffect) => (
    <button
      key={s.key}
      type="button"
      className="px-chip shrink-0 flex-col items-start gap-0.5 py-1"
      title={s.what && text(s.what)}
      onClick={() => onPickStyle(effectQuery(s))}
      data-testid="category-style"
      data-key={s.key}
    >
      <span className="flex items-center gap-1.5">
        <span dir="auto">{text(s.name)}</span>
        {s.isNew && (
          <span className="bg-gold text-gold-ink rounded-[2px] px-1 text-[10px] leading-4 font-bold">
            {t("search.trendingNew")}
          </span>
        )}
      </span>
      <span className="text-ink-2 text-[11px] font-normal">
        {t("search.trendingCreators", { n: s.creators })}
      </span>
    </button>
  );

  const videoRow = (v: LessonVideo) => {
    const kind = t(
      v.kind === "example"
        ? "search.categoryExample"
        : v.lang === "ar"
          ? "search.categoryTutorialAr"
          : "search.categoryTutorial",
    );
    const body = (
      <>
        <span aria-hidden>{PLATFORM_META[v.platform].glyph}</span>
        <span className="shrink-0 font-bold">{kind}</span>
        <span dir="auto" className="min-w-0 truncate">
          {v.title}
        </span>
      </>
    );
    const cls =
      "text-ink-2 flex w-full min-w-0 items-center gap-1.5 text-start text-xs hover:underline";
    return (
      <li key={v.url} className="min-w-0">
        {canEmbed(v.platform, v.url) ? (
          <button
            type="button"
            className={cls}
            onClick={() => player.open({ platform: v.platform, url: v.url, title: v.title })}
            data-testid="category-video"
            data-kind={v.kind}
            data-lang={v.lang}
          >
            {body}
          </button>
        ) : (
          <a
            href={v.url}
            target="_blank"
            rel="noopener noreferrer"
            className={cls}
            data-testid="category-video"
            data-kind={v.kind}
            data-lang={v.lang}
          >
            {body}
          </a>
        )}
      </li>
    );
  };

  const card = (tech: Technique) => {
    const skill = tech.skillId ? getSkill(tech.skillId) : undefined;
    return (
      <li
        key={tech.name.en}
        className="border-edge bg-panel-2 relative flex w-64 shrink-0 snap-start flex-col gap-1.5 rounded-[2px] border-2 p-2.5 shadow-[3px_3px_0_var(--edge)]"
        data-testid="category-technique"
      >
        <h4 className="text-sm font-bold" dir="auto">
          {L(tech.name)}
        </h4>
        <p className="text-ink-2 text-xs leading-snug" dir="auto">
          <span
            className="bg-panel-3 text-ink me-1 rounded-[2px] px-1 text-[10px] font-bold"
            title={t("search.categoryAiNote")}
            data-testid="category-ai"
          >
            ✦ AI
          </span>
          {L(tech.howTo)}
        </p>
        {/* 🎯 Only for a skill this app knows (the Worker checks its copy of the list; the app checks its own). */}
        {skill && (
          <button
            type="button"
            className="px-chip w-fit max-w-full text-start"
            aria-label={t("search.categorySkill", { skill: L(skill.name) })}
            onClick={() => onOpenSkill(skill.id)}
            data-testid="category-skill"
          >
            🎯{" "}
            <span dir="auto" className="min-w-0 truncate">
              {L(skill.name)}
            </span>
          </button>
        )}
        <ul className="flex min-w-0 flex-col gap-1">{tech.videos.map(videoRow)}</ul>
      </li>
    );
  };

  const shelf = (area: Area) => {
    const list = data.lessons?.[area] ?? [];
    if (!list.length) return null;
    return (
      <section
        key={area}
        aria-labelledby={`${id}-${area}`}
        className="flex min-w-0 flex-col gap-1.5"
        data-testid="category-shelf"
        data-area={area}
      >
        <h3 id={`${id}-${area}`} className="text-sm font-bold">
          {t(SHELF[area])}
        </h3>
        {/* One row that scrolls sideways (the page never does), snapping card by card. */}
        <ul className="flex min-w-0 snap-x scroll-px-1 gap-3 overflow-x-auto px-1 pt-0.5 pb-2">
          {list.map(card)}
        </ul>
      </section>
    );
  };

  return (
    <section
      aria-labelledby={`${id}-title`}
      className="flex min-w-0 flex-col gap-3"
      data-testid="category-page"
      data-state={state}
      data-genre={genre.id}
    >
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <h2 ref={heading} id={`${id}-title`} tabIndex={-1} className="text-base font-bold">
          <span aria-hidden>{genre.emoji}</span> {name}
        </h2>
        {state !== "never" && (
          <>
            {Number.isFinite(age) && <span className="text-muted text-xs">· {updated}</span>}
            <button
              type="button"
              className="px-link text-xs disabled:opacity-50"
              disabled={busy}
              onClick={() => runNow(true)}
              data-testid="category-rescan"
            >
              {t("search.trendingRescan")}
            </button>
          </>
        )}
        {/* Always there (empty while idle), so its next words are announced. */}
        <span role="status" className="text-muted text-xs" data-testid="category-status">
          {line}
        </span>
      </div>
      {state === "never" ? (
        <button
          type="button"
          className="px-btn px-btn-sm w-fit"
          disabled={busy}
          onClick={() => runNow(false)}
          data-testid="category-run"
        >
          {t("search.categoryRun", { genre: name })}
        </button>
      ) : (
        <>
          {state === "stale" && scan === "idle" && (
            <p className="text-muted text-xs">{staleLine}</p>
          )}
          <section aria-labelledby={`${id}-trends`} className="flex min-w-0 flex-col gap-1.5">
            <h3 id={`${id}-trends`} className="text-sm font-bold">
              {t("search.categoryTrends", { genre: name })}
            </h3>
            {data.items.length ? (
              <div
                className="flex min-w-0 gap-1.5 overflow-x-auto px-0.5 pt-0.5 pb-1.5"
                data-testid="category-styles"
              >
                {data.items.map(styleChip)}
              </div>
            ) : (
              <p className="text-muted text-xs">{t("search.categoryNoTrends")}</p>
            )}
          </section>
          {data.lessons ? (
            AREAS.map(shelf)
          ) : (
            <p className="text-muted text-xs">{t("search.categoryNoLessons")}</p>
          )}
        </>
      )}
      <button
        type="button"
        className="px-btn px-btn-ghost px-btn-sm w-fit"
        onClick={onSearchAll}
        data-testid="category-search-all"
      >
        {t("search.categorySearchAll", { genre: name })}
      </button>
    </section>
  );
}
