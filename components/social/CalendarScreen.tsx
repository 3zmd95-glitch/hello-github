"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useToday } from "@/components/today/useToday";
import PageHeader from "@/components/ui/ios/PageHeader";
import { PLATFORMS, type Platform, type Post } from "@/lib/domain";
import { useT } from "@/lib/i18n";
import { PLATFORM_META } from "@/lib/social";
import { weekKey } from "@/lib/streak";
import { useStore } from "@/store";
import { monthKeyOf, parseCalendarHash, postHash } from "./calendar/dates";
import MonthView from "./calendar/MonthView";
import { platformStyle } from "./calendar/PlatformChip";
import PostForm from "./calendar/PostForm";
import PostSheet from "./calendar/PostSheet";
import StagesBoard from "./calendar/StagesBoard";
import WeekView from "./calendar/WeekView";

type View = "week" | "month" | "stages";
const VIEWS: readonly View[] = ["week", "month", "stages"];
type Filter = Platform | "all";

/** Drop the calendar hash without a navigation (static export: no router push). */
function clearHash(): void {
  if (window.location.hash) {
    history.replaceState(null, "", window.location.pathname + window.location.search);
  }
}

/**
 * 📅 Content calendar (rounds 16–17): Week · Month · Stages views per platform, the "+ New post" sheet and
 * the post popup. Deep links: `#post=<id>` opens that post's popup (the Studio home, the Ideas bank and the
 * skill sheet link here), `#day=YYYY-MM-DD` focuses a day in the week view; both are read on mount and on
 * `hashchange`, and closing the popup clears the hash with `history.replaceState`.
 */
export default function CalendarScreen() {
  const { t, L } = useT();
  const today = useToday();
  const posts = useStore((s) => s.posts);
  const [view, setView] = useState<View>("week");
  const [filter, setFilter] = useState<Filter>("all");
  const [weekStart, setWeekStart] = useState(() => weekKey(today));
  const [monthKey, setMonthKey] = useState(() => monthKeyOf(today));
  const [focusDay, setFocusDay] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ day: string | null } | null>(null);

  useEffect(() => {
    const apply = () => {
      const h = parseCalendarHash(window.location.hash);
      if (h.day) {
        setView("week");
        setWeekStart(weekKey(h.day));
        setFocusDay(h.day);
      }
      if (h.post) {
        if (useStore.getState().posts.some((p) => p.id === h.post)) setOpenId(h.post);
        else {
          // Unknown id: fall back to the normal week view.
          setOpenId(null);
          clearHash();
        }
      }
    };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, []);

  const filtered = useMemo(
    () => (filter === "all" ? posts : posts.filter((p) => p.platform === filter)),
    [posts, filter],
  );

  const open = useCallback((id: string) => {
    setOpenId(id);
    history.replaceState(null, "", postHash(id));
  }, []);
  const close = useCallback(() => {
    setOpenId(null);
    clearHash();
  }, []);
  const newOn = useCallback((day: string | null) => setDraft({ day }), []);
  const created = useCallback((post: Post) => {
    setDraft(null);
    if (post.plannedDay) {
      setWeekStart(weekKey(post.plannedDay));
      setMonthKey(monthKeyOf(post.plannedDay));
    }
  }, []);

  return (
    <div className="flex flex-col gap-4" data-testid="calendar-screen" data-view={view}>
      <PageHeader title={t("social.calendar.title")} sub={t("social.calendar.sub")} />

      <div className="flex flex-wrap items-center gap-2">
        <div className="cal-tabs" role="group" aria-label={t("social.calendar.title")}>
          {VIEWS.map((v) => (
            <button
              key={v}
              type="button"
              className="cal-tab"
              aria-pressed={view === v}
              onClick={() => setView(v)}
              data-testid={`calendar-view-${v}`}
            >
              {t(`calendar.view.${v}`)}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="px-btn px-btn-sm ms-auto"
          onClick={() => newOn(null)}
          data-testid="calendar-new"
        >
          {t("calendar.new")}
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("calendar.filter.aria")}>
        <button
          type="button"
          className="px-fchip"
          aria-pressed={filter === "all"}
          onClick={() => setFilter("all")}
          data-testid="calendar-filter-all"
        >
          {t("calendar.filter.all")}
        </button>
        {PLATFORMS.map((p) => (
          <button
            key={p}
            type="button"
            className="px-fchip cal-fchip"
            style={platformStyle(p)}
            aria-pressed={filter === p}
            onClick={() => setFilter(p)}
            data-testid={`calendar-filter-${p}`}
          >
            <span aria-hidden>{PLATFORM_META[p].icon}</span> {L(PLATFORM_META[p].name)}
          </button>
        ))}
      </div>

      {posts.length === 0 && (
        <section className="px-card flex flex-col gap-2" data-testid="calendar-empty">
          <h2 className="text-lg">{t("calendar.emptyTitle")}</h2>
          <p className="text-ink-2 text-sm">{t("calendar.emptyBody")}</p>
          <button
            type="button"
            className="px-btn self-start"
            onClick={() => newOn(today)}
            data-testid="calendar-empty-new"
          >
            {t("calendar.new")}
          </button>
        </section>
      )}

      {view === "week" && (
        <WeekView
          posts={filtered}
          weekStart={weekStart}
          today={today}
          focusDay={focusDay}
          onWeek={(w) => {
            setWeekStart(weekKey(w));
            setFocusDay(null);
          }}
          onOpen={open}
          onNewOn={newOn}
        />
      )}
      {view === "month" && (
        <MonthView
          posts={filtered}
          monthKey={monthKey}
          today={today}
          onMonth={setMonthKey}
          onOpen={open}
          onNewOn={newOn}
        />
      )}
      {view === "stages" && <StagesBoard posts={filtered} onOpen={open} />}

      {draft && (
        <PostForm initialDay={draft.day} onClose={() => setDraft(null)} onCreated={created} />
      )}
      {openId && <PostSheet key={openId} postId={openId} onClose={close} />}
    </div>
  );
}
