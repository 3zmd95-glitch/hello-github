"use client";

import Link from "next/link";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { pullTrends } from "@/components/social/trends/useTrends";
import { getProgram, getSkill, programs } from "@/data";
import {
  discoverRequestFrom,
  tabCounts,
  type DiscoverAlternative,
  type DiscoverPick,
} from "@/lib/discover";
import type { Lang, Skill } from "@/lib/domain";
import { allGenres } from "@/lib/genres";
import { useT, type MessageKey } from "@/lib/i18n";
import {
  arabicFirst,
  canonicalRefUrl,
  dedupeByUrl,
  genreWeekItems,
  interleavePlatforms,
  itemFromRef,
  itemFromYoutube,
  peekYoutubeSearch,
  platformSearchUrl,
  popularityOf,
  programSearchHint,
  publishedAfterFor,
  refFromItem,
  RESEARCH_TABS,
  researchHashtag,
  researchQuery,
  scoutPlatformsFor,
  sortByPopularity,
  youtubeDurationFor,
  youtubeErrorMessageKey,
  type LengthFilter,
  type Recency,
  type ResearchItem,
  type ResearchTab,
  type SortMode,
  type YoutubeSearchError,
} from "@/lib/research";
import {
  peekScoutSearch,
  SCOUT_MONTHLY_FREE,
  scoutErrorMessageKey,
  type ScoutError,
  type ScoutResult,
} from "@/lib/scoutClient";
import { trendsStale } from "@/lib/trends";
import { getApiKey, useStore } from "@/store";
import DiscoverSections from "./DiscoverSections";
import PasteLinkForm from "./PasteLinkForm";
import ResultCard, { PLATFORM_META, SkeletonCard } from "./ResultCard";
import SkillPicker from "./SkillPicker";
import { useDiscoverQuery, useDiscoverUsage, useScoutCaps } from "./useDiscover";
import {
  groupErrors,
  scoutParams,
  unionCount,
  useScoutConfig,
  useScoutQuery,
  useScoutUsage,
  type PlatformPart,
  type ScoutSearchState,
} from "./useScout";
import { useYoutubeQuery } from "./useYoutube";

/** Last platform tab, remembered per device. */
export const RESEARCH_TAB_KEY = "3z-research-tab";
const YT_MAX = 10;
const SETTINGS_HREF = "/settings/#api-keys";

function readTab(): ResearchTab {
  try {
    const v = localStorage.getItem(RESEARCH_TAB_KEY) as ResearchTab | null;
    return v && RESEARCH_TABS.includes(v) ? v : "all";
  } catch {
    return "all";
  }
}

function writeTab(tab: ResearchTab): void {
  try {
    localStorage.setItem(RESEARCH_TAB_KEY, tab);
  } catch {
    // Private mode / blocked storage: the tab just isn't remembered.
  }
}

const TAB_LABEL: Record<ResearchTab, MessageKey> = {
  all: "research.tabAll",
  yt: "research.tabYt",
  tt: "research.tabTt",
  ig: "research.tabIg",
};
const TAB_GLYPH: Record<ResearchTab, string> = { all: "◆", yt: "▶", tt: "♪", ig: "📷" };

/** The platforms behind the tabs, in the All tab's order. */
const PLATFORMS = ["yt", "tt", "ig"] as const;
type Platform = (typeof PLATFORMS)[number];

/** "Nothing on this platform for this topic" line under the All tab's cards. */
const NONE_ON: Record<Platform, MessageKey> = {
  yt: "research.noneYt",
  tt: "research.noneTt",
  ig: "research.noneIg",
};

/** A tab's share of a list (All = everything). */
function onTab<T extends ResearchItem>(list: readonly T[], tb: ResearchTab): T[] {
  return tb === "all" ? [...list] : list.filter((i) => i.platform === tb);
}

/** One platform's cards from its Worker answer (that platform only), or none until it has answered. */
function scoutCards(s: ScoutSearchState, p: Platform): ScoutResult[] {
  return s.status === "ok" ? s.results.filter((r) => r.platform === p) : [];
}

const RECENCY: { v: Recency; label: MessageKey }[] = [
  { v: "any", label: "research.timeAny" },
  { v: "week", label: "research.timeWeek" },
  { v: "month", label: "research.timeMonth" },
  { v: "year", label: "research.timeYear" },
];
const LENGTHS: { v: LengthFilter; label: MessageKey }[] = [
  { v: "any", label: "research.lenAny" },
  { v: "short", label: "research.lenShort" },
  { v: "long", label: "research.lenLong" },
];
const SORTS: { v: SortMode; label: MessageKey }[] = [
  { v: "relevance", label: "research.sortRelevance" },
  { v: "popular", label: "research.sortPopular" },
];

/**
 * Research UI v2 (build plan 1.15): one panel for Discover (free topic) and the skill sheet (the skill's
 * name, editable). Search bar (Enter / button, AR·EN, "+ program" hint, open-on-platform overflow), the
 * edit-genre row (round 31: a chip is a search of its own, or narrows the topic), platform tabs with counts
 * (each tab decides which sources are queried), filters (recency, YouTube length, sort, saved only, Arabic
 * first), a card grid with thumbnails and view / like counts, and attach actions. Sources: the YouTube Data
 * API when the owner has a key, the Scout Worker for TikTok / Instagram (and YouTube without a key). With a
 * genre on, a "Most viewed this week" strip above the results shows the Trend Radar's rows of that genre
 * (the feed the store keeps; Discover is the one place for genres).
 */
export default function ResearchPanel({
  skill,
  stickyTop = "max-md:-top-4",
  openGenre,
}: {
  /** Skill sheet mode; omitted = Discover mode. */
  skill?: Skill;
  /** Where the search bar sticks on phones: the sheet's padded scroll edge by default, below the app's top bar in Discover. */
  stickyTop?: string;
  /**
   * Discover's deep link (`/discover/?genre=<id>`): the id of a genre the app knows, handed in once the
   * address bar was read. It goes on the way a tap on its chip would.
   */
  openGenre?: string | null;
}) {
  const { t, L, lang, dir } = useT();
  const ids = useId();
  const [queryLang, setQueryLang] = useState<Lang>(lang);
  const [draft, setDraft] = useState<string | null>(null);
  const [override, setOverride] = useState<string | null>(null);
  const [topic, setTopic] = useState("");
  const [programId, setProgramId] = useState("");
  const [hintOn, setHintOn] = useState(true);
  const [tab, setTab] = useState<ResearchTab>(readTab);
  const [recency, setRecency] = useState<Recency>("any");
  const [length, setLength] = useState<LengthFilter>("any");
  const [savedOnly, setSavedOnly] = useState(false);
  const [arFirst, setArFirst] = useState(false);
  const [sort, setSort] = useState<SortMode>("relevance");
  const [genreId, setGenreId] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [pickFor, setPickFor] = useState<ResearchItem | null>(null);
  // Captured once: `publishedAfter` is rounded to the day, so it (and the cache key) stays put.
  const [now] = useState(() => Date.now());

  const recentTopics = useStore((s) => s.recentTopics);
  const addRecentTopic = useStore((s) => s.addRecentTopic);
  const addRef = useStore((s) => s.addRef);
  const removeRef = useStore((s) => s.removeRef);
  const savedRefs = useStore((s) => s.savedRefs);
  const customGenres = useStore((s) => s.customGenres);
  const trends = useStore((s) => s.trends);
  const ytKey = useStore((s) => getApiKey(s, "youtube"));
  const scoutCfg = useScoutConfig();
  const usage = useScoutUsage();
  const caps = useScoutCaps(scoutCfg);
  // Discover v2 when the Worker says it can; the per-platform /search path otherwise (and without a Worker).
  const v2 = !!scoutCfg && caps?.discover === true;
  const legacy = !scoutCfg || caps?.discover === false;
  // The "Not this?" choice, for the topic it was made on (another topic or genre drops it), and the search
  // attempt a failed platform's Retry sends past the cache.
  const [picked, setPicked] = useState<{ on: string; pick: DiscoverPick } | null>(null);
  const [forceAt, setForceAt] = useState(-1);

  /* ---------- the query ---------- */

  const defaultName = skill ? skill.name[queryLang] : "";
  const base = skill ? (override ?? defaultName) : topic;
  const hint = programSearchHint(getProgram(skill ? skill.programId : programId));
  // The edit genres: the built-in ones, then the ones the owner added in Settings.
  const genres = useMemo(() => allGenres(customGenres), [customGenres]);
  const genre = genreId ? genres.find((g) => g.id === genreId) : undefined;
  // Topic (or skill name), then the genre's main query in the search language, then the program hint.
  const q = researchQuery(base, queryLang, genre, hintOn ? hint : undefined);
  // Instagram hashtags are Latin slugs: the skill's EN name, or the Discover topic when it's Latin; the
  // genre's own hashtag when the genre is the whole search. (From the typed topic, never with the program
  // hint appended: "#matchcutdavinciresolve" finds nothing.)
  const tag = researchHashtag(base, skill ? skill.name.en : base, genre);
  // "Search" press counter: pressing it again after an error asks again (a cached success costs nothing).
  const [attempt, setAttempt] = useState(0);

  /** The typed text becomes the topic (Discover: remembered as a recent topic) or the skill's override. */
  const commit = (text: string) => {
    if (skill) setOverride(!text || text === defaultName ? null : text);
    else {
      setTopic(text);
      if (text) addRecentTopic(text);
    }
    setDraft(null);
    setPicked(null);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    commit((draft ?? base).trim());
    setAttempt((a) => a + 1);
  };

  /**
   * A genre chip is a search: what's typed but not submitted becomes the topic first, then the genre goes
   * on, or off when it's the active chip (null = off). A genre alone never lands in the recent topics.
   */
  const pickGenre = (id: string | null) => {
    if (draft !== null) commit(draft.trim());
    setGenreId(id === genreId ? null : id);
    setAttempt((a) => a + 1);
  };

  // Discover's deep link: the genre handed in goes on once, like a tap on its chip (a search of its own),
  // and its chip is brought into view in the row. The owner's next taps decide from there.
  const [opened, setOpened] = useState<string | null>(null);
  if (openGenre && openGenre !== opened) {
    setOpened(openGenre);
    setGenreId(openGenre);
    setAttempt((a) => a + 1);
  }
  const chipRefs = useRef(new Map<string, HTMLButtonElement>());
  useEffect(() => {
    if (!opened) return;
    chipRefs.current.get(opened)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [opened]);

  const pickTab = (next: ResearchTab) => {
    setTab(next);
    writeTab(next);
  };

  /* ---------- sources ---------- */

  const hasYt = !!ytKey;
  const searchLang: Lang = arFirst ? "ar" : queryLang;
  const timeRange = recency === "any" ? undefined : recency;
  const live = !savedOnly && q.length > 0;
  const videoDuration = youtubeDurationFor(length);
  const publishedAfter = publishedAfterFor(recency, now);
  // "Most popular" asks YouTube for the most viewed first; otherwise nothing is sent (same request as before).
  const ytOrder = sort === "popular" ? ("viewCount" as const) : undefined;
  const ytOpts = {
    relevanceLanguage: searchLang,
    maxResults: YT_MAX,
    videoDuration,
    publishedAfter,
    order: ytOrder,
  };
  const ytWanted = live && legacy && hasYt && (tab === "all" || tab === "yt");
  const yt = useYoutubeQuery(ytWanted ? ytKey : undefined, q, ytOpts, attempt);
  // A key that's out of quota or refused: YouTube comes from the Worker instead. The failed query stays
  // settled (ytWanted doesn't depend on this), so it doesn't flip back and forth.
  const ytDown =
    !!scoutCfg &&
    yt.status === "error" &&
    (yt.error.type === "quota" || yt.error.type === "forbidden");
  const ytApi = hasYt && !ytDown;

  // One Worker request per platform, each on while its own tab or All is open. All is the union of the
  // same requests (same cache keys), so switching tabs never spends a second credit, and one platform
  // can't crowd the others out of a shared, capped answer.
  const paramsFor = (p: Platform) =>
    scoutParams(q, scoutPlatformsFor(p, ytApi), searchLang, timeRange);
  const wants = (p: Platform) => live && legacy && (tab === "all" || tab === p);
  const scoutTt = useScoutQuery(wants("tt") ? paramsFor("tt") : null, attempt);
  const scoutIg = useScoutQuery(wants("ig") ? paramsFor("ig") : null, attempt);
  const scoutYt = useScoutQuery(wants("yt") ? paramsFor("yt") : null, attempt);
  const scoutBy: Record<Platform, ScoutSearchState> = { yt: scoutYt, tt: scoutTt, ig: scoutIg };

  // Discover v2: one request for every platform, both languages. A memo, so the React Compiler sees it frozen
  // (built inline, it keeps the inputs of `q` open past the `counts` memo below).
  const pickOn = `${genre?.id ?? ""}|${base}`;
  const discoverReq = useMemo(
    () =>
      v2 && !savedOnly
        ? discoverRequestFrom({
            base,
            genre,
            programHint: hintOn ? hint : undefined,
            recency,
            length,
            pick: picked?.on === pickOn ? picked.pick : undefined,
          })
        : null,
    [v2, savedOnly, base, genre, hintOn, hint, recency, length, picked, pickOn],
  );
  const disc = useDiscoverQuery(discoverReq, attempt, forceAt === attempt);
  // The tab badges count the posts shown; a tab is empty only with none at all (hidden ones included).
  const discShown = disc.status === "ok" ? tabCounts(disc.answer, false) : undefined;
  const discAll = disc.status === "ok" ? tabCounts(disc.answer, true) : undefined;
  // The usage line asks again once an answer lands (each search's own attempt), never at the click.
  const discUsage = useDiscoverUsage(
    v2 ? scoutCfg : null,
    disc.status === "loading" ? null : disc.status === "off" ? 0 : disc.attempt,
  );
  const onAlternative = (alt: DiscoverAlternative) => {
    setPicked({ on: pickOn, pick: "exact" in alt ? { exact: true } : { term: alt.termId } });
    setAttempt((a) => a + 1);
  };
  const onRetry = () => {
    setForceAt(attempt + 1);
    setAttempt(attempt + 1);
  };

  /* ---------- saved refs ---------- */

  // Keyed by the canonical URL, so a ref saved in an older form (a /reel/ link, youtu.be, a query string) still
  // shows as attached on the search card for the same post.
  const attachedTo = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const [skillId, refs] of Object.entries(savedRefs)) {
      for (const r of refs) {
        const key = canonicalRefUrl(r.platform, r.url);
        m.set(key, [...(m.get(key) ?? []), skillId]);
      }
    }
    return m;
  }, [savedRefs]);

  const savedList = useMemo(
    () =>
      skill
        ? (savedRefs[skill.id] ?? []).map(itemFromRef)
        : dedupeByUrl(...Object.values(savedRefs)).map(itemFromRef),
    [savedRefs, skill],
  );

  /* ---------- "most viewed this week": the Trend Radar's rows of the genre ---------- */

  const genreKey = genre?.id;
  // From the feed the store keeps, in the search language, best score first. An extra above the results:
  // nothing to show (no genre, no rows of it, saved only) means no strip, never an empty state or an error.
  const weekItems = useMemo(
    () => (savedOnly ? [] : genreWeekItems(trends, genreKey, queryLang, new Date(now))),
    [savedOnly, trends, genreKey, queryLang, now],
  );
  // A feed gone stale is read again from the Worker (GET /trends, the copy its cron wrote; the sources are
  // never run from here) once a genre is on and the strip could show: at most once in the panel's life, never
  // without a genre or a Worker. A failed read says nothing (the strip is an extra); the radar reports it.
  const weekAsked = useRef(false);
  useEffect(() => {
    if (!genreKey || savedOnly || !scoutCfg || weekAsked.current) return;
    if (!trendsStale(useStore.getState().trends.fetchedAt, new Date())) return;
    weekAsked.current = true;
    void pullTrends();
  }, [genreKey, savedOnly, scoutCfg]);

  /* ---------- what the active tab shows ---------- */

  const shownPlatforms = tab === "all" ? PLATFORMS : [tab];
  const ytItems = ytApi && yt.status === "ok" ? yt.items.map(itemFromYoutube) : [];
  let items = savedOnly
    ? onTab(savedList, tab)
    : interleavePlatforms(
        dedupeByUrl<ResearchItem>(ytItems, ...shownPlatforms.map((p) => scoutCards(scoutBy[p], p))),
      );
  // Sorted copies of what's shown, never the hook results: most popular first, then (Arabic first being
  // stable) the Arabic posts on top, each group still by popularity.
  if (sort === "popular") items = sortByPopularity(items);
  if (arFirst) items = arabicFirst(items);
  // Until the Worker has said which search it serves (/health, once a session), the search is on its way.
  const loading =
    (live && !!scoutCfg && caps === null) ||
    (v2
      ? disc.status === "loading"
      : [yt, scoutTt, scoutIg, scoutYt].some((s) => s.status === "loading"));

  /**
   * Result count per tab from each platform's own answer, or its cached one (no request); undefined (no
   * badge) until that platform's own query has an answer. All = the distinct posts across the platforms.
   * Worked out once per answer / query change, not on every keystroke in the search box.
   */
  const counts = useMemo((): Record<ResearchTab, number | undefined> => {
    if (savedOnly) {
      const n = (tb: ResearchTab) => onTab(savedList, tb).length;
      return { all: n("all"), yt: n("yt"), tt: n("tt"), ig: n("ig") };
    }
    const none = { all: undefined, yt: undefined, tt: undefined, ig: undefined };
    if (!q) return none;
    const states: Record<Platform, ScoutSearchState> = { yt: scoutYt, tt: scoutTt, ig: scoutIg };
    const opts = {
      relevanceLanguage: searchLang,
      maxResults: YT_MAX,
      videoDuration,
      publishedAfter,
      order: ytOrder,
    };
    const part = (p: Platform): PlatformPart<ResearchItem> => {
      if (p === "yt" && ytApi) {
        if (yt.status === "ok") return yt.items.map(itemFromYoutube);
        if (yt.status === "error") return "error";
        return ytKey ? peekYoutubeSearch(ytKey, q, opts, now)?.map(itemFromYoutube) : undefined;
      }
      const s = states[p];
      if (s.status === "ok") return scoutCards(s, p);
      if (s.status === "error") return "error";
      const params = scoutParams(q, scoutPlatformsFor(p, ytApi), searchLang, timeRange);
      if (!scoutCfg || !params) return undefined;
      return peekScoutSearch(scoutCfg, params)?.filter((r) => r.platform === p);
    };
    const hasSource = (p: Platform) => !!scoutCfg || (p === "yt" && ytApi);
    const parts = { yt: part("yt"), tt: part("tt"), ig: part("ig") };
    const own = (p: Platform) => (Array.isArray(parts[p]) ? parts[p].length : undefined);
    return {
      all: unionCount(PLATFORMS.filter(hasSource).map((p) => parts[p])),
      yt: own("yt"),
      tt: own("tt"),
      ig: own("ig"),
    };
  }, [
    savedOnly,
    savedList,
    q,
    searchLang,
    timeRange,
    videoDuration,
    publishedAfter,
    ytOrder,
    now,
    ytApi,
    ytKey,
    scoutCfg,
    yt,
    scoutTt,
    scoutIg,
    scoutYt,
  ]);
  const shownCounts =
    v2 && !savedOnly
      ? (discShown ?? { all: undefined, yt: undefined, tt: undefined, ig: undefined })
      : counts;

  /* ---------- per-card actions ---------- */

  const renderAction = (item: ResearchItem): ReactNode => {
    const on = attachedTo.get(canonicalRefUrl(item.platform, item.url)) ?? [];
    if (skill) {
      const here = on.includes(skill.id);
      return (
        <button
          type="button"
          aria-pressed={here}
          className={`px-btn px-btn-sm ${here ? "" : "px-btn-ghost"}`}
          onClick={() =>
            here ? removeRef(skill.id, item.url) : addRef(skill.id, refFromItem(item))
          }
          data-testid="result-attach"
        >
          {here ? t("research.attachedHere") : t("research.attachHere")}
        </button>
      );
    }
    if (on.length > 0) {
      const last = on[on.length - 1];
      const sk = getSkill(last);
      return (
        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span
            className="px-chip px-chip-green max-w-full min-w-0 overflow-hidden text-ellipsis"
            data-testid="result-attached"
          >
            {t("research.attachedTo", { skill: sk ? L(sk.name) : last })}
          </span>
          <button
            type="button"
            className="px-btn px-btn-ghost px-btn-sm"
            onClick={() => removeRef(last, item.url)}
            data-testid="result-undo"
          >
            {t("research.undo")}
          </button>
        </span>
      );
    }
    return (
      <button
        type="button"
        className="px-btn px-btn-sm"
        onClick={() => setPickFor(item)}
        data-testid="result-attach"
      >
        {t("discover.attach")}
      </button>
    );
  };

  /* ---------- notes, hints, errors ---------- */

  const scoutHint = !savedOnly && !scoutCfg && tab !== "yt" && (!!q || !!skill);
  const ytHint = !savedOnly && !hasYt && !scoutCfg && (tab === "all" || tab === "yt");
  const ytViaScout =
    !savedOnly && !ytApi && scoutYt.status === "ok" && (tab === "yt" || (tab === "all" && ytDown));
  const lenNote =
    !savedOnly && length !== "any" && !ytApi && !!scoutCfg && (tab === "all" || tab === "yt");
  // "Most popular" with no count on any shown card: say why the order didn't change.
  const popularNote =
    sort === "popular" &&
    !loading &&
    items.length > 0 &&
    !items.some((i) => popularityOf(i.stats) !== undefined);
  // Worker errors, one line per kind of error (naming the platforms on All), never hiding what worked.
  const scoutErrors = savedOnly
    ? []
    : groupErrors(
        shownPlatforms.flatMap((p) => {
          const s = scoutBy[p];
          return s.status === "error" ? [{ platform: p, error: s.error }] : [];
        }),
      );
  // On All: the platforms whose own search answered with nothing (said once each, with a way to look there).
  const noneOn =
    tab === "all" && !savedOnly && items.length > 0
      ? PLATFORMS.filter((p) =>
          p === "yt" && ytApi
            ? yt.status === "ok" && yt.items.length === 0
            : scoutBy[p].status === "ok" && scoutCards(scoutBy[p], p).length === 0,
        )
      : [];
  const anySettled = [yt, scoutTt, scoutIg, scoutYt].some((s) => s.status === "ok");
  // v2: nothing on this tab, hidden posts included; or no word to search in what was typed (emoji only).
  const v2Empty = v2 && !savedOnly && (discoverReq ? discAll?.[tab] === 0 : live);
  const showEmpty = savedOnly
    ? items.length === 0
    : v2
      ? v2Empty
      : !!q && anySettled && !loading && items.length === 0;
  const activeFilters =
    (recency !== "any" ? 1 : 0) +
    (length !== "any" ? 1 : 0) +
    (savedOnly ? 1 : 0) +
    (arFirst ? 1 : 0) +
    (sort === "popular" ? 1 : 0);
  const showLength = tab === "all" || tab === "yt";

  /* ---------- tabs keyboard (arrow keys, mirrored in RTL) ---------- */

  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const fwd = dir === "rtl" ? "ArrowLeft" : "ArrowRight";
    const back = dir === "rtl" ? "ArrowRight" : "ArrowLeft";
    if (e.key !== fwd && e.key !== back) return;
    e.preventDefault();
    const i = RESEARCH_TABS.indexOf(tab);
    const next = (i + (e.key === fwd ? 1 : RESEARCH_TABS.length - 1)) % RESEARCH_TABS.length;
    pickTab(RESEARCH_TABS[next]);
    tabRefs.current[next]?.focus();
  };

  /* ---------- "↗ ⋯" menu: closes on an outside tap, Escape, or after a link in it ---------- */

  const moreRef = useRef<HTMLDetailsElement>(null);
  const closeMore = () => {
    if (moreRef.current) moreRef.current.open = false;
  };
  useEffect(() => {
    // Listening for the panel's whole life (two cheap checks per event) rather than from the <details>
    // toggle event, which fires a task later: an Escape right after opening would slip through. The ref is
    // read on each event since the menu remounts when the query is cleared and typed again.
    const onDown = (e: PointerEvent) => {
      const menu = moreRef.current;
      if (menu?.open && !menu.contains(e.target as Node)) menu.open = false;
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      const menu = moreRef.current;
      if (e.key !== "Escape" || !menu?.open) return;
      const inside = menu.contains(document.activeElement);
      menu.open = false;
      if (inside) menu.querySelector("summary")?.focus();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const barBg = skill ? "bg-panel-2 -mx-3 px-3" : "bg-panel -mx-4 px-4";
  // The strip's title sits one level under the screen's own: the page title in Discover, the skill's name
  // in the sheet.
  const WeekTitle = skill ? "h3" : "h2";

  return (
    <section
      className={`@container flex flex-col gap-3 ${skill ? "px-inset" : "px-card"}`}
      data-testid="research-panel"
    >
      {/* ---------- search bar ---------- */}
      <form
        onSubmit={submit}
        role="search"
        className={`${barBg} border-edge z-10 flex flex-col gap-2 border-b-2 pt-1 pb-2.5 max-md:sticky ${stickyTop}`}
        data-testid="research-bar"
      >
        <div className="flex gap-2">
          <input
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            dir="auto"
            className="px-input flex-1"
            placeholder={skill ? defaultName : t("discover.topicPh")}
            aria-label={t("research.topicLabel")}
            value={draft ?? base}
            onChange={(e) => setDraft(e.target.value)}
            data-testid={skill ? "research-topic" : "discover-topic"}
          />
          <button type="submit" className="px-btn shrink-0" data-testid="research-search">
            {t("research.searchBtn")}
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <div
            role="group"
            aria-label={t("research.lang")}
            className="border-edge bg-edge flex w-fit gap-[2px] rounded-[2px] border-2"
          >
            {(["ar", "en"] as const).map((l) => (
              <button
                key={l}
                type="button"
                aria-pressed={queryLang === l}
                onClick={() => setQueryLang(l)}
                className={`num min-h-7 px-2.5 text-xs font-bold ${l === queryLang ? "bg-gold text-gold-ink" : "bg-panel-2 text-ink-2"}`}
                data-testid={`research-lang-${l}`}
              >
                {l.toUpperCase()}
              </button>
            ))}
          </div>
          {!skill && (
            <select
              className="px-input w-auto max-w-[12.5rem] py-1"
              aria-label={t("discover.program")}
              value={programId}
              onChange={(e) => setProgramId(e.target.value)}
              data-testid="discover-program"
            >
              <option value="">{t("discover.program")}</option>
              {programs
                .filter((p) => p.kind === "app")
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.icon} {L(p.name)}
                  </option>
                ))}
            </select>
          )}
          {hint && (
            <button
              type="button"
              className="px-fchip"
              aria-pressed={hintOn}
              title={t("research.hintToggle")}
              onClick={() => setHintOn((v) => !v)}
              data-testid="research-hint"
            >
              <span dir="ltr">+ {hint}</span>
            </button>
          )}
          {skill && (override !== null || draft !== null) && (
            <button
              type="button"
              className="px-fchip"
              onClick={() => {
                setOverride(null);
                setDraft(null);
              }}
              data-testid="research-reset"
            >
              {t("research.reset")}
            </button>
          )}
          {q && (
            <details ref={moreRef} className="relative ms-auto" data-testid="research-more">
              <summary
                className="px-btn px-btn-ghost px-btn-sm list-none [&::-webkit-details-marker]:hidden"
                aria-label={t("research.openOn")}
                title={t("research.openOn")}
                data-testid="research-more-toggle"
              >
                ↗ ⋯
              </summary>
              <div
                className="border-edge bg-panel absolute end-0 top-full z-20 mt-1.5 flex flex-col gap-2 rounded-[2px] border-[3px] p-2 shadow-[4px_4px_0_var(--edge)]"
                onClick={(e) => {
                  // A link opens in a new tab (or the app): the menu's done.
                  if ((e.target as Element).closest("a")) closeMore();
                }}
              >
                <span className="text-muted text-xs whitespace-nowrap">{t("research.openOn")}</span>
                <PlatformLinks q={q} idPrefix="research-link" stack />
                {tag && (
                  <a
                    href={`https://www.instagram.com/explore/tags/${tag}/`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-link text-xs"
                    dir="ltr"
                    data-testid="research-link-ig-hashtag"
                  >
                    #{tag}
                  </a>
                )}
              </div>
            </details>
          )}
        </div>
      </form>
      {!skill && recentTopics.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-muted text-xs">{t("discover.recent")}</span>
          {recentTopics.slice(0, 6).map((rt) => (
            <button
              key={rt}
              type="button"
              className="px-chip max-w-[12rem] overflow-hidden text-ellipsis"
              dir="auto"
              onClick={() => {
                setTopic(rt);
                setDraft(null);
                setAttempt((a) => a + 1);
                addRecentTopic(rt);
              }}
              data-testid="discover-recent-topic"
            >
              {rt}
            </button>
          ))}
        </div>
      )}

      {/* ---------- edit genre: one row that scrolls sideways (the tabs stay where they are); it wraps
          only where the panel is wide ---------- */}
      <div
        role="group"
        aria-labelledby={`${ids}-genres`}
        className="flex min-w-0 items-center gap-1.5 @3xl:items-start"
        data-testid="genres-row"
        data-genre={genre?.id ?? ""}
      >
        <span
          id={`${ids}-genres`}
          className="text-muted shrink-0 text-xs whitespace-nowrap @3xl:pt-2.5"
        >
          {t("genres.label")}
        </span>
        <div
          className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto px-0.5 pt-0.5 pb-1.5 @3xl:flex-wrap @3xl:overflow-x-visible"
          data-testid="genres-chips"
        >
          {genres.map((g) => (
            <button
              key={g.id}
              ref={(el) => {
                if (el) chipRefs.current.set(g.id, el);
                else chipRefs.current.delete(g.id);
              }}
              type="button"
              className="px-fchip shrink-0"
              aria-pressed={g.id === genre?.id}
              onClick={() => pickGenre(g.id)}
              data-testid={`genre-${g.id}`}
            >
              <span aria-hidden>{g.emoji}</span>
              <span dir="auto">{L(g.name)}</span>
            </button>
          ))}
        </div>
        {/* Outside the scrolling chips (at the far end), so it's in reach when the active chip isn't. */}
        {genre && (
          <button
            type="button"
            className="px-fchip shrink-0"
            aria-label={t("genres.clear")}
            title={t("genres.clear")}
            onClick={() => pickGenre(null)}
            data-testid="genres-clear"
          >
            ✕
          </button>
        )}
      </div>

      {/* ---------- platform tabs ---------- */}
      <div
        role="tablist"
        aria-label={t("research.tabs")}
        className="grid grid-cols-4 gap-1.5"
        onKeyDown={onTabKey}
      >
        {RESEARCH_TABS.map((tb, i) => {
          const active = tb === tab;
          const count = shownCounts[tb];
          return (
            <button
              key={tb}
              ref={(el) => {
                tabRefs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`${ids}-tab-${tb}`}
              aria-selected={active}
              aria-controls={`${ids}-panel`}
              tabIndex={active ? 0 : -1}
              onClick={() => pickTab(tb)}
              className={`border-edge flex min-w-0 flex-col items-center gap-0.5 rounded-[2px] border-2 px-1 py-1.5 font-bold ${active ? "bg-gold text-gold-ink shadow-[3px_3px_0_var(--edge)]" : "bg-panel-2 text-ink-2 shadow-[2px_2px_0_var(--edge)]"}`}
              data-testid={`tab-${tb}`}
              data-count={count ?? ""}
            >
              <span className="flex items-center gap-1 text-sm leading-none">
                <span aria-hidden>{TAB_GLYPH[tb]}</span>
                {count !== undefined && (
                  <span
                    className="num border-edge bg-edge text-ink min-w-[18px] rounded-[2px] border px-1 text-[10px] leading-[16px]"
                    data-testid="tab-count"
                  >
                    {count}
                  </span>
                )}
              </span>
              <span className="w-full truncate text-center text-[11px]">{t(TAB_LABEL[tb])}</span>
            </button>
          );
        })}
      </div>

      {/* ---------- filters ---------- */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="px-btn px-btn-ghost px-btn-sm md:hidden"
          aria-expanded={filtersOpen}
          aria-controls={`${ids}-filters`}
          onClick={() => setFiltersOpen((o) => !o)}
          data-testid="filters-toggle"
        >
          ⚙ {t("research.filters")}
          {activeFilters > 0 && (
            <span
              className="num bg-gold text-gold-ink border-edge rounded-[2px] border px-1 text-[10px]"
              data-testid="filters-count"
            >
              {activeFilters}
            </span>
          )}
        </button>
        {scoutCfg && v2 && discUsage && (
          <p className="text-muted ms-auto text-xs" data-testid="discover-usage">
            {/* Tavily's figure when the Worker could read it; YouTube's count either way. */}
            {"used" in discUsage.tavily &&
              `${t("search.usage", {
                used: discUsage.tavily.used,
                limit: discUsage.tavily.limit ?? "∞",
              })} · `}
            {t("search.usageYt", { used: discUsage.youtube.usedToday, cap: discUsage.youtube.cap })}
          </p>
        )}
        {scoutCfg && !v2 && (
          <p className="text-muted ms-auto text-xs" data-testid="scout-usage" data-count={usage}>
            {t("research.scoutUsage", { n: usage, max: SCOUT_MONTHLY_FREE })}
          </p>
        )}
      </div>
      <div
        id={`${ids}-filters`}
        className={`${filtersOpen ? "flex" : "hidden"} flex-col gap-2.5 md:flex md:flex-row md:flex-wrap md:items-end md:gap-x-5`}
        data-testid="filters"
      >
        <ChipGroup label={t("research.recency")}>
          {RECENCY.map((o) => (
            <button
              key={o.v}
              type="button"
              className="px-fchip"
              aria-pressed={recency === o.v}
              onClick={() => setRecency(o.v)}
              data-testid={`filter-time-${o.v}`}
            >
              {t(o.label)}
            </button>
          ))}
        </ChipGroup>
        {showLength && (
          <ChipGroup label={t("research.length")}>
            {LENGTHS.map((o) => (
              <button
                key={o.v}
                type="button"
                className="px-fchip"
                aria-pressed={length === o.v}
                onClick={() => setLength(o.v)}
                data-testid={`filter-len-${o.v}`}
              >
                {t(o.label)}
              </button>
            ))}
          </ChipGroup>
        )}
        <ChipGroup label={t("research.sortLabel")}>
          {SORTS.map((o) => (
            <button
              key={o.v}
              type="button"
              className="px-fchip"
              aria-pressed={sort === o.v}
              onClick={() => setSort(o.v)}
              data-testid={`filter-sort-${o.v}`}
            >
              {t(o.label)}
            </button>
          ))}
        </ChipGroup>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            className="px-fchip"
            aria-pressed={savedOnly}
            onClick={() => setSavedOnly((v) => !v)}
            data-testid="filter-saved"
          >
            {t("research.savedOnly")}
          </button>
          <button
            type="button"
            className="px-fchip"
            aria-pressed={arFirst}
            onClick={() => setArFirst((v) => !v)}
            data-testid="filter-arfirst"
          >
            {t("research.arFirst")}
          </button>
        </div>
      </div>

      {/* ---------- most viewed this week: one row of cards that scrolls sideways (the page never does:
          each card holds its own absolute bits) and snaps with its padding kept, so the first card's edge
          shows in Arabic too; what a keyword search found, so the line by the title says where it comes
          from ---------- */}
      {genre && weekItems.length > 0 && (
        <section
          aria-labelledby={`${ids}-week`}
          className="flex min-w-0 flex-col gap-1.5"
          data-testid="genre-week"
          data-genre={genre.id}
          data-count={weekItems.length}
        >
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <WeekTitle id={`${ids}-week`} className="text-sm" data-testid="genre-week-title">
              {t("research.weekTitle")}
            </WeekTitle>
            <p className="text-muted text-xs" data-testid="genre-week-source">
              {t("research.weekSource", { genre: L(genre.name) })}
            </p>
          </div>
          <ul
            aria-labelledby={`${ids}-week`}
            className="flex min-w-0 snap-x scroll-px-1 gap-3 overflow-x-auto px-1 pt-0.5 pb-2"
            data-testid="genre-week-list"
          >
            {weekItems.map((item) => (
              <ResultCard
                key={item.url}
                item={item}
                action={renderAction(item)}
                testId="genre-week-item"
                className="w-60 shrink-0 snap-start"
              />
            ))}
          </ul>
        </section>
      )}

      {/* ---------- results ---------- */}
      <div
        role="tabpanel"
        id={`${ids}-panel`}
        aria-labelledby={`${ids}-tab-${tab}`}
        aria-busy={loading}
        className="flex flex-col gap-3"
        data-testid="research-results"
        data-tab={tab}
      >
        {!skill && !q && !savedOnly && (
          <p className="text-muted text-sm" data-testid="research-start">
            {t("research.startTyping")}
          </p>
        )}
        {scoutHint && <Hint testId="scout-not-configured">{t("research.scoutNotConfigured")}</Hint>}
        {ytHint && (!!q || !!skill) && <Hint testId="yt-no-key">{t("research.enableYt")}</Hint>}
        {!v2 &&
          scoutErrors.map((g) => (
            <ScoutErrorLine
              key={g.error.type}
              error={g.error}
              platforms={tab === "all" ? g.platforms : undefined}
            />
          ))}
        {!v2 && !savedOnly && yt.status === "error" && <YoutubeErrorLine error={yt.error} />}
        {!v2 && ytViaScout && (
          <p className="text-muted text-xs" data-testid="yt-via-scout">
            {t("research.ytViaScout")}
          </p>
        )}
        {!v2 && lenNote && (
          <p className="text-muted text-xs" data-testid="len-needs-key">
            {t("research.lenNeedsKey")}
          </p>
        )}
        {popularNote && (
          <p className="text-muted text-xs" data-testid="popular-note">
            {t("research.popularNote")}
          </p>
        )}

        {(!v2 || savedOnly) && (items.length > 0 || (loading && !savedOnly)) && (
          <ul
            className="grid grid-cols-1 gap-3 @lg:grid-cols-2 @3xl:grid-cols-3"
            aria-label={t("research.results")}
            data-testid="result-list"
          >
            {items.map((item) => (
              <ResultCard key={item.url} item={item} action={renderAction(item)} />
            ))}
            {loading &&
              !savedOnly &&
              Array.from({ length: items.length > 0 ? 2 : 3 }, (_, i) => (
                <SkeletonCard key={i} vertical={tab === "tt" || tab === "ig" || i % 3 === 1} />
              ))}
          </ul>
        )}

        {!v2 &&
          noneOn.map((p) => (
            <div
              key={p}
              className="text-muted flex flex-wrap items-center gap-2 text-xs"
              data-testid={`research-none-${p}`}
            >
              <span>{t(NONE_ON[p])}</span>
              <PlatformLinks q={q} idPrefix={`none-link-${p}`} only={p} />
            </div>
          ))}

        {v2 && !savedOnly && disc.status === "error" && <ScoutErrorLine error={disc.error} />}
        {v2 && !savedOnly && loading && (
          <div className="flex flex-col gap-2" data-testid="discover-loading">
            <p className="text-muted text-xs">{t("search.searching")}</p>
            <ul className="grid grid-cols-1 gap-3 @lg:grid-cols-2 @3xl:grid-cols-3">
              {Array.from({ length: 3 }, (_, i) => (
                <SkeletonCard key={i} vertical={i % 3 !== 1} />
              ))}
            </ul>
          </div>
        )}
        {/* Also on an empty tab: the understood line, "Not this?" and why a platform failed stay above the
            empty box. A new search starts with its off-topic posts hidden and its sections closed. */}
        {v2 && !savedOnly && disc.status === "ok" && (
          <DiscoverSections
            key={disc.key}
            answer={disc.answer}
            q={discoverReq?.q ?? q}
            tab={tab}
            sort={sort}
            arFirst={arFirst}
            headingLevel={skill ? "h3" : "h2"}
            renderAction={renderAction}
            onAlternative={onAlternative}
            onRetry={onRetry}
          />
        )}

        {showEmpty && (
          <div
            className="px-tile border-edge flex flex-col items-center gap-2 rounded-[2px] border-2 border-dashed p-4 text-center"
            data-testid="research-empty"
          >
            <p className="bg-panel-2 text-ink-2 rounded-[2px] px-2 py-1 text-sm">
              {savedOnly ? t("research.emptySaved") : t("research.empty")}
            </p>
            {!savedOnly && q && <PlatformLinks q={q} idPrefix="empty-link" only={tab} />}
          </div>
        )}
      </div>

      {skill && (
        <details className="border-edge border-t-2 pt-2.5" data-testid="paste-disclosure">
          <summary className="w-fit text-sm font-bold" data-testid="paste-toggle">
            {t("research.pasteToggle")}
          </summary>
          <div className="mt-2">
            <PasteLinkForm onAdd={(ref) => addRef(skill.id, ref)} />
          </div>
        </details>
      )}

      {pickFor && (
        <SkillPicker
          onClose={() => setPickFor(null)}
          onPick={(skillId) => {
            addRef(skillId, refFromItem(pickFor));
            setPickFor(null);
          }}
        />
      )}
    </section>
  );
}

function ChipGroup({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id} className="flex flex-col gap-1">
      <span id={id} className="text-muted text-xs">
        {label}
      </span>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

/** "Open the search on YouTube / TikTok / Instagram" icon buttons (new tab; the app on a phone). */
function PlatformLinks({
  q,
  idPrefix,
  only,
  stack = false,
}: {
  q: string;
  idPrefix: string;
  only?: ResearchTab;
  /** One per row, full width (the overflow menu); otherwise a centered wrapping row. */
  stack?: boolean;
}) {
  const list = (["yt", "tt", "ig"] as const).filter((p) => !only || only === "all" || only === p);
  return (
    <div
      className={`flex gap-1.5 ${stack ? "flex-col items-stretch" : "flex-wrap justify-center"}`}
    >
      {list.map((p) => (
        <a
          key={p}
          href={platformSearchUrl(p, q)}
          target="_blank"
          rel="noopener noreferrer"
          className="px-btn px-btn-ghost px-btn-sm no-underline"
          aria-label={PLATFORM_META[p].label}
          data-testid={`${idPrefix}-${p}`}
        >
          <span aria-hidden>{PLATFORM_META[p].glyph}</span>
          <span className="text-xs">{PLATFORM_META[p].label} ↗</span>
        </a>
      ))}
    </div>
  );
}

function Hint({ testId, children }: { testId: string; children: ReactNode }) {
  const { t } = useT();
  return (
    <p
      className="border-sky bg-panel-2 text-ink-2 rounded-[2px] border-2 border-dashed px-3 py-2 text-sm"
      data-testid={testId}
    >
      💡 {children}{" "}
      <Link href={SETTINGS_HREF} className="px-link">
        {t("research.noKeyLink")}
      </Link>
    </p>
  );
}

function ErrorLine({
  testId,
  type,
  message,
  settings,
}: {
  testId: string;
  type: string;
  message: string;
  settings: boolean;
}) {
  const { t } = useT();
  return (
    <p
      role="alert"
      className="border-danger text-danger rounded-[2px] border-2 px-3 py-2 text-sm"
      data-testid={testId}
      data-error={type}
    >
      ⚠ {message}
      {settings && (
        <>
          {" "}
          <Link href={SETTINGS_HREF} className="px-link">
            {t("research.noKeyLink")}
          </Link>
        </>
      )}
    </p>
  );
}

function ScoutErrorLine({
  error,
  platforms,
}: {
  error: ScoutError;
  /** The platforms it hit, named on the All tab. */
  platforms?: readonly Platform[];
}) {
  const { t } = useT();
  const on = platforms?.map((p) => PLATFORM_META[p].label).join(" · ");
  const message = t(scoutErrorMessageKey(error));
  return (
    <ErrorLine
      testId="scout-error"
      type={error.type}
      message={on ? `${on}: ${message}` : message}
      settings={error.type === "auth" || error.type === "quota"}
    />
  );
}

function YoutubeErrorLine({ error }: { error: YoutubeSearchError }) {
  const { t } = useT();
  return (
    <ErrorLine
      testId="yt-error"
      type={error.type}
      message={t(youtubeErrorMessageKey(error))}
      settings={error.type === "quota" || error.type === "forbidden"}
    />
  );
}
