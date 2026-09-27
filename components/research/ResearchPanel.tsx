"use client";

import Link from "next/link";
import {
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { getProgram, getSkill, programs } from "@/data";
import type { Lang, Skill } from "@/lib/domain";
import { useT, type MessageKey } from "@/lib/i18n";
import {
  arabicFirst,
  dedupeByUrl,
  hashtagSlug,
  interleavePlatforms,
  itemFromRef,
  itemFromYoutube,
  peekYoutubeSearch,
  platformSearchUrl,
  programSearchHint,
  publishedAfterFor,
  refFromItem,
  RESEARCH_TABS,
  scoutPlatformsFor,
  withProgramHint,
  youtubeDurationFor,
  youtubeErrorMessageKey,
  type LengthFilter,
  type Recency,
  type ResearchItem,
  type ResearchTab,
  type YoutubeSearchError,
} from "@/lib/research";
import {
  peekScoutSearch,
  SCOUT_MONTHLY_FREE,
  scoutErrorMessageKey,
  type ScoutError,
} from "@/lib/scoutClient";
import { getApiKey, useStore } from "@/store";
import PasteLinkForm from "./PasteLinkForm";
import ResultCard, { PLATFORM_META, SkeletonCard } from "./ResultCard";
import SkillPicker from "./SkillPicker";
import { scoutParams, useScoutConfig, useScoutQuery, useScoutUsage } from "./useScout";
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

/**
 * Research UI v2 (build plan 1.15): one panel for Discover (free topic) and the skill sheet (the skill's
 * name, editable). Search bar (Enter / button, AR·EN, "+ program" hint, open-on-platform overflow), platform
 * tabs with counts (each tab decides which sources are queried), filters (recency, YouTube length, saved
 * only, Arabic first), a card grid with thumbnails, and attach actions. Sources: the YouTube Data API when
 * the owner has a key, the Scout Worker for TikTok / Instagram (and YouTube without a key).
 */
export default function ResearchPanel({
  skill,
  stickyTop = "max-md:-top-4",
}: {
  /** Skill sheet mode; omitted = Discover mode. */
  skill?: Skill;
  /** Where the search bar sticks on phones: the sheet's padded scroll edge by default, below the app's top bar in Discover. */
  stickyTop?: string;
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
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [pickFor, setPickFor] = useState<ResearchItem | null>(null);
  // Captured once: `publishedAfter` is rounded to the day, so it (and the cache key) stays put.
  const [now] = useState(() => Date.now());

  const recentTopics = useStore((s) => s.recentTopics);
  const addRecentTopic = useStore((s) => s.addRecentTopic);
  const addRef = useStore((s) => s.addRef);
  const removeRef = useStore((s) => s.removeRef);
  const savedRefs = useStore((s) => s.savedRefs);
  const ytKey = useStore((s) => getApiKey(s, "youtube"));
  const scoutCfg = useScoutConfig();
  const usage = useScoutUsage();

  /* ---------- the query ---------- */

  const defaultName = skill ? skill.name[queryLang] : "";
  const base = skill ? (override ?? defaultName) : topic;
  const hint = programSearchHint(getProgram(skill ? skill.programId : programId));
  const q = withProgramHint(base, hintOn ? hint : undefined);
  // Instagram hashtags are Latin slugs: the skill's EN name, or the Discover topic when it's Latin.
  const tag = hashtagSlug(skill ? skill.name.en : q);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const text = (draft ?? base).trim();
    if (skill) setOverride(!text || text === defaultName ? null : text);
    else {
      setTopic(text);
      if (text) addRecentTopic(text);
    }
    setDraft(null);
  };

  const pickTab = (next: ResearchTab) => {
    setTab(next);
    writeTab(next);
  };

  /* ---------- sources ---------- */

  const hasYt = !!ytKey;
  const searchLang: Lang = arFirst ? "ar" : queryLang;
  const timeRange = recency === "any" ? undefined : recency;
  const live = !savedOnly && q.length > 0;
  const paramsFor = (tb: ResearchTab) =>
    scoutParams(q, scoutPlatformsFor(tb, hasYt), searchLang, timeRange);
  const scout = useScoutQuery(live ? paramsFor(tab) : null);
  const ytOpts = {
    relevanceLanguage: searchLang,
    maxResults: YT_MAX,
    videoDuration: youtubeDurationFor(length),
    publishedAfter: publishedAfterFor(recency, now),
  };
  const ytWanted = live && hasYt && (tab === "all" || tab === "yt");
  const yt = useYoutubeQuery(ytWanted ? ytKey : undefined, q, ytOpts);

  /* ---------- saved refs ---------- */

  const attachedTo = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const [skillId, refs] of Object.entries(savedRefs)) {
      for (const r of refs) m.set(r.url, [...(m.get(r.url) ?? []), skillId]);
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

  /* ---------- what the active tab shows ---------- */

  const onTab = <T extends ResearchItem>(list: readonly T[], tb: ResearchTab = tab) =>
    tb === "all" ? [...list] : list.filter((i) => i.platform === tb);
  const ytItems = yt.status === "ok" ? yt.items.map(itemFromYoutube) : [];
  const scoutItems = scout.status === "ok" ? onTab(scout.results) : [];
  let items = savedOnly ? onTab(savedList) : interleavePlatforms(dedupeByUrl(ytItems, scoutItems));
  if (arFirst) items = arabicFirst(items);
  const loading = scout.status === "loading" || yt.status === "loading";

  /** Result count for a tab from what's already loaded or cached (no request), else undefined. */
  const countFor = (tb: ResearchTab): number | undefined => {
    if (savedOnly) return onTab(savedList, tb).length;
    if (!q) return undefined;
    const scoutPart = (x: ResearchTab) => {
      const p = paramsFor(x);
      if (!p) return [];
      return scoutCfg ? peekScoutSearch(p) : null;
    };
    const ytPart =
      hasYt && ytKey ? peekYoutubeSearch(ytKey, q, ytOpts, now)?.map(itemFromYoutube) : [];
    if (tb === "all") {
      const s = scoutPart("all");
      if (s === undefined || ytPart === undefined || (s === null && !hasYt)) return undefined;
      return dedupeByUrl(ytPart, s ?? []).length;
    }
    if (tb === "yt" && hasYt) return ytPart?.length;
    const own = scoutPart(tb);
    if (own === null) return undefined;
    const list = own ?? scoutPart("all");
    return list ? list.filter((i) => i.platform === tb).length : undefined;
  };

  /* ---------- per-card actions ---------- */

  const renderAction = (item: ResearchItem): ReactNode => {
    const on = attachedTo.get(item.url) ?? [];
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
  const ytViaScout = !savedOnly && tab === "yt" && !hasYt && scout.status === "ok";
  const lenNote =
    !savedOnly && length !== "any" && !hasYt && !!scoutCfg && (tab === "all" || tab === "yt");
  const anySettled = scout.status === "ok" || yt.status === "ok";
  const showEmpty = savedOnly
    ? items.length === 0
    : !!q && anySettled && !loading && items.length === 0;
  const activeFilters =
    (recency !== "any" ? 1 : 0) +
    (length !== "any" ? 1 : 0) +
    (savedOnly ? 1 : 0) +
    (arFirst ? 1 : 0);
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

  const barBg = skill ? "bg-panel-2 -mx-3 px-3" : "bg-panel -mx-4 px-4";

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
            <details className="relative ms-auto" data-testid="research-more">
              <summary
                className="px-btn px-btn-ghost px-btn-sm list-none [&::-webkit-details-marker]:hidden"
                aria-label={t("research.openOn")}
                title={t("research.openOn")}
                data-testid="research-more-toggle"
              >
                ↗ ⋯
              </summary>
              <div className="border-edge bg-panel absolute end-0 top-full z-20 mt-1.5 flex flex-col gap-2 rounded-[2px] border-[3px] p-2 shadow-[4px_4px_0_var(--edge)]">
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
                addRecentTopic(rt);
              }}
              data-testid="discover-recent-topic"
            >
              {rt}
            </button>
          ))}
        </div>
      )}

      {/* ---------- platform tabs ---------- */}
      <div
        role="tablist"
        aria-label={t("research.tabs")}
        className="grid grid-cols-4 gap-1.5"
        onKeyDown={onTabKey}
      >
        {RESEARCH_TABS.map((tb, i) => {
          const active = tb === tab;
          const count = countFor(tb);
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
        {scoutCfg && (
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
        {!savedOnly && scout.status === "error" && <ScoutErrorLine error={scout.error} />}
        {!savedOnly && yt.status === "error" && <YoutubeErrorLine error={yt.error} />}
        {ytViaScout && (
          <p className="text-muted text-xs" data-testid="yt-via-scout">
            {t("research.ytViaScout")}
          </p>
        )}
        {lenNote && (
          <p className="text-muted text-xs" data-testid="len-needs-key">
            {t("research.lenNeedsKey")}
          </p>
        )}

        {(items.length > 0 || (loading && !savedOnly)) && (
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

function ScoutErrorLine({ error }: { error: ScoutError }) {
  const { t } = useT();
  return (
    <ErrorLine
      testId="scout-error"
      type={error.type}
      message={t(scoutErrorMessageKey(error))}
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
