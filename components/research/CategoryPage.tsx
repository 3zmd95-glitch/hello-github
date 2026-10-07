"use client";

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useVideoPlayer } from "@/components/player/VideoPlayerContext";
import { getSkill } from "@/data";
import {
  AREAS,
  cachedCategory,
  categoryScanInFlight,
  fetchCategory,
  fetchCategoryTop,
  pageState,
  runCategoryNow,
  TOP_MAX,
  TOP_PLATFORMS,
  type Area,
  type CategoryPageData,
  type LessonVideo,
  type Technique,
  type TopAnswer,
  type TopLists,
  type TopPlatform,
  type TopVideo,
} from "@/lib/categories";
import type { Genre } from "@/lib/domain";
import { effectQuery, type TrendingEffect } from "@/lib/effects";
import { canEmbed } from "@/lib/embed";
import { useT, type MessageKey } from "@/lib/i18n";
import type { ResearchItem } from "@/lib/research";
import type { ScoutConfig } from "@/lib/scoutClient";
import ResultCard, { PLATFORM_META } from "./ResultCard";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** A page older than this no longer says "this week". */
const WEEK = 7 * DAY;
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
  // Its own line: nothing retries a category tomorrow (its next turn can be 3 days away).
  limit: "search.categoryRunLimit",
};

/** The 🏆 row shows this many of a list at a time. */
const TOP_SHOW = 12;
/** Why a Brave tab shows the scan's list alone. Not connected is said on TikTok only: Instagram's stored reels stand on
 * their own. */
const TOP_LINE: Record<NonNullable<TopAnswer["note"]>, MessageKey> = {
  no_key: "search.topNoKey",
  brave_failed: "search.topFailed",
  daily_cap: "search.topCap",
};
const topItem = (platform: TopPlatform, v: TopVideo): ResearchItem => ({
  platform,
  handle: v.creator ?? "",
  title: v.title,
  snippet: "",
  url: v.url,
  ...(v.thumbnail ? { thumb: v.thumbnail } : {}),
  ...(v.views !== undefined ? { stats: { views: v.views } } : {}),
});

/**
 * 🏆 Top in <category> (planning/tools/19-category-trends.md §6): YouTube · TikTok · Instagram tabs (arrow keys move
 * between them, mirrored in Arabic), each up to 50 videos best first, 12 at a time, as Discover's result cards
 * (thumbnail, title as given, creator, views when known, the app's player). YouTube's and Instagram's lists come with
 * the page. TikTok's, and Instagram's while under 50, ask the Worker for Brave's results the first time the tab opens,
 * once a visit: the answer lives in this component's state alone, since Brave's terms forbid keeping its results.
 */
function TopVideos({
  config,
  genreId,
  name,
  top,
}: {
  config: ScoutConfig;
  genreId: string;
  name: string;
  top: TopLists;
}) {
  const { t, dir } = useT();
  const id = useId();
  const [tab, setTab] = useState<TopPlatform>("yt");
  const [shown, setShown] = useState(TOP_SHOW);
  // A Brave tab's answer: none before its first open, null while on its way.
  const [brave, setBrave] = useState<Partial<Record<TopPlatform, TopAnswer | null>>>({});
  const asked = useRef(new Set<TopPlatform>());
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const open = (p: TopPlatform) => {
    setTab(p);
    setShown(TOP_SHOW);
    if (p === "yt" || (p === "ig" && top.ig.length >= TOP_MAX) || asked.current.has(p)) return;
    asked.current.add(p);
    setBrave((b) => ({ ...b, [p]: null }));
    void fetchCategoryTop(config, genreId, p).then((r) =>
      setBrave((b) => ({ ...b, [p]: r ?? { items: top[p], note: "brave_failed" } })),
    );
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const fwd = dir === "rtl" ? "ArrowLeft" : "ArrowRight";
    const back = dir === "rtl" ? "ArrowRight" : "ArrowLeft";
    if (e.key !== fwd && e.key !== back) return;
    e.preventDefault();
    const i = TOP_PLATFORMS.indexOf(tab);
    const next = (i + (e.key === fwd ? 1 : TOP_PLATFORMS.length - 1)) % TOP_PLATFORMS.length;
    open(TOP_PLATFORMS[next]);
    tabRefs.current[next]?.focus();
  };

  const answer = brave[tab];
  const list = answer?.items ?? top[tab];
  const note = answer?.note;
  const line =
    answer === null
      ? t("search.topLoading")
      : note && (note !== "no_key" || tab === "tt")
        ? t(TOP_LINE[note])
        : list.length
          ? ""
          : t("search.topEmpty");
  // A tab's count once its list is known: TikTok's comes with Brave's answer.
  const countOf = (p: TopPlatform) =>
    brave[p]?.items.length ?? (p === "tt" ? undefined : top[p].length);

  return (
    <section
      aria-labelledby={`${id}-title`}
      className="flex min-w-0 flex-col gap-2"
      data-testid="category-top"
    >
      <h3 id={`${id}-title`} className="text-sm font-bold">
        {t("search.topTitle", { genre: name })}
      </h3>
      <div
        role="tablist"
        aria-label={t("search.topTabs")}
        className="grid grid-cols-3 gap-1.5"
        onKeyDown={onKey}
      >
        {TOP_PLATFORMS.map((p, i) => {
          const active = p === tab;
          const count = countOf(p);
          return (
            <button
              key={p}
              ref={(el) => {
                tabRefs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`${id}-tab-${p}`}
              aria-selected={active}
              aria-controls={`${id}-panel`}
              tabIndex={active ? 0 : -1}
              onClick={() => open(p)}
              className={`border-edge flex min-w-0 flex-col items-center gap-0.5 rounded-[2px] border-2 px-1 py-1.5 font-bold ${active ? "bg-gold text-gold-ink shadow-[3px_3px_0_var(--edge)]" : "bg-panel-2 text-ink-2 shadow-[2px_2px_0_var(--edge)]"}`}
              data-testid="category-top-tab"
              data-platform={p}
              data-count={count ?? ""}
            >
              <span className="flex items-center gap-1 text-sm leading-none">
                <span aria-hidden>{PLATFORM_META[p].glyph}</span>
                {count !== undefined && (
                  <span className="num border-edge bg-edge text-ink min-w-[18px] rounded-[2px] border px-1 text-[10px] leading-[16px]">
                    {count}
                  </span>
                )}
              </span>
              <span className="w-full truncate text-center text-[11px]">
                {PLATFORM_META[p].label}
              </span>
            </button>
          );
        })}
      </div>
      <div
        role="tabpanel"
        id={`${id}-panel`}
        aria-labelledby={`${id}-tab-${tab}`}
        className="flex min-w-0 flex-col gap-2"
        data-testid="category-top-panel"
        data-platform={tab}
      >
        {/* Always there (empty when there is nothing to say), so "Loading…" and its next words are announced. */}
        <p role="status" className="text-muted text-xs" data-testid="category-top-line">
          {line}
        </p>
        <ul className="grid grid-cols-1 gap-3 @lg:grid-cols-2 @3xl:grid-cols-3">
          {list.slice(0, shown).map((v) => (
            <ResultCard key={v.url} item={topItem(tab, v)} testId="category-top-item" />
          ))}
        </ul>
        {list.length > shown && (
          <button
            type="button"
            className="px-btn px-btn-ghost px-btn-sm w-fit"
            onClick={() => setShown((s) => s + TOP_SHOW)}
            data-testid="category-top-more"
          >
            {t("search.showMore", { n: Math.min(TOP_SHOW, list.length - shown) })}
          </button>
        )}
      </div>
    </section>
  );
}

/**
 * 🚗 A Discover category's page (planning/tools/19-category-trends.md §1, layout B):
 * - the header, with 🔄 Scan again;
 * - this week's trending styles of the category as chips (a tap searches the style within the category, in Keywords);
 * - the Photography / Videography / Editing shelves of technique cards, English first (live fix 1; in Arabic the
 *   Arabic name and how-to follow as muted lines): a ✦ AI how-to (its Shoot, Settings and Edit lines since live fix
 *   2), the skill it practices, and example videos (a tutorial when one teaches) that play in the app's player;
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
  searchBlocked = false,
}: {
  config: ScoutConfig;
  genre: Genre;
  /** A tapped style's search words ({@link effectQuery}). */
  onPickStyle: (q: string) => void;
  onSearchAll: () => void;
  onOpenSkill: (skillId: string) => void;
  /** No page from this Worker (an older one, a refused token, no network): today's category search instead. */
  onUnavailable: () => void;
  /** Discover can't search now (AI mode with no model chosen): Search all rests, as the category chips do. A style
   * still searches, in Keywords, like a 🔥 chip. */
  searchBlocked?: boolean;
}) {
  const { t, L, lang } = useT();
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
      // A scan this tab started before (Discover left and opened again) may still run: wait for its answer. With
      // nothing to show yet, it may also have answered into the tab's copy while this GET was on its way (show that).
      const pending = categoryScanInFlight(config, genre.id);
      const meanwhile =
        !pending && pageState(r) === "never" ? cachedCategory(config, genre.id) : null;
      setData(meanwhile ?? r);
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
  // Labelled as the 🔥 row's chips are, without their YouTube note (a category has no YouTube check). English first in
  // both languages (live fix 1): the English name and line, the Arabic name in the tooltip under the line.
  const styleChip = (s: TrendingEffect) => {
    const what = s.what?.en;
    const creators = t("search.trendingCreators", { n: s.creators });
    return (
      <button
        key={s.key}
        type="button"
        className="px-chip shrink-0 flex-col items-start gap-0.5 py-1"
        title={[what, s.name.ar].filter(Boolean).join("\n") || undefined}
        aria-label={[s.name.en, s.isNew && t("search.trendingNew"), creators, what]
          .filter(Boolean)
          .join(" · ")}
        onClick={() => onPickStyle(effectQuery(s))}
        data-testid="category-style"
        data-key={s.key}
      >
        <span className="flex items-center gap-1.5">
          <span dir="auto">{s.name.en}</span>
          {s.isNew && (
            <span className="bg-gold text-gold-ink rounded-[2px] px-1 text-[10px] leading-4 font-bold">
              {t("search.trendingNew")}
            </span>
          )}
        </span>
        <span className="text-ink-2 text-[11px] font-normal">{creators}</span>
      </button>
    );
  };

  // Keyed by place and link: an Arabic tutorial can share an English one's link.
  const videoRow = (v: LessonVideo, i: number) => {
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
      <li key={`${i}:${v.url}`} className="min-w-0">
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

  // Keyed by place and name: two techniques of a shelf can share a name.
  const card = (tech: Technique, i: number) => {
    const skill = tech.skillId ? getSkill(tech.skillId) : undefined;
    return (
      <li
        key={`${i}:${tech.name.en}`}
        className="border-edge bg-panel-2 relative flex w-64 shrink-0 snap-start flex-col gap-1.5 rounded-[2px] border-2 p-2.5 shadow-[3px_3px_0_var(--edge)]"
        data-testid="category-technique"
      >
        {/* English first in both languages (live fix 1); in Arabic, the Arabic name and how-to (when the Worker has
            them in Arabic script) follow as muted lines, right to left. */}
        <h4 className="text-sm font-bold" dir="auto">
          {tech.name.en}
        </h4>
        {lang === "ar" && tech.name.ar && (
          <p className="text-muted -mt-1 text-xs" dir="rtl" data-testid="category-name-ar">
            {tech.name.ar}
          </p>
        )}
        {/* Its "Shoot: …", "Settings: …" and "Edit: …" lines (live fix 2), one under another; older lessons' how-to is
            one paragraph. */}
        <p
          className="text-ink-2 text-xs leading-snug whitespace-pre-line"
          dir="ltr"
          data-testid="category-howto"
        >
          <span
            className="bg-panel-3 text-ink me-1 rounded-[2px] px-1 text-[10px] font-bold"
            title={t("search.categoryAiNote")}
            data-testid="category-ai"
          >
            ✦ AI
          </span>
          {tech.howTo.en}
        </p>
        {lang === "ar" && tech.howTo.ar && (
          <p className="text-muted text-xs leading-snug" dir="rtl" data-testid="category-howto-ar">
            {tech.howTo.ar}
          </p>
        )}
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
              {t(age > WEEK ? "search.categoryTrendsOld" : "search.categoryTrends", {
                genre: name,
              })}
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
          {/* A new category opens a new visit: its Brave answers start over. */}
          {data.top ? (
            <TopVideos
              key={genre.id}
              config={config}
              genreId={genre.id}
              name={name}
              top={data.top}
            />
          ) : (
            <p className="text-muted text-xs">{t("search.topNone")}</p>
          )}
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
        disabled={searchBlocked}
        onClick={onSearchAll}
        data-testid="category-search-all"
      >
        {t("search.categorySearchAll", { genre: name })}
      </button>
    </section>
  );
}
