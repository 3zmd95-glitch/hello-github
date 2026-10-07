"use client";

import { Calendar, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useToday } from "@/components/today/useToday";
import EmptyState from "@/components/ui/ios/EmptyState";
import PageHeader from "@/components/ui/ios/PageHeader";
import Segmented from "@/components/ui/ios/Segmented";
import { PLATFORMS, type Platform, type Post } from "@/lib/domain";
import { useT } from "@/lib/i18n";
import { prefersReducedMotion } from "@/lib/motion";
import { PlatformGlyph } from "@/lib/platformIcons";
import { PLATFORM_META } from "@/lib/social";
import { dayKey, weekKey } from "@/lib/streak";
import { useStore } from "@/store";
import { monthKeyOf, parseCalendarHash, postHash } from "./calendar/dates";
import MonthView from "./calendar/MonthView";
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
 * Content calendar (rounds 16–17, iOS look round 35): Week · Month · Stages views (a segmented tablist, each view in
 * its tabpanel) per platform (filter chips with the brand glyphs), the new-post sheet (the glass "+" on phones, a
 * header button from md up) and the post popup. Deep links: `#post=<id>` opens that post's popup (the Studio home,
 * the Ideas bank and the skill sheet link here), `#day=YYYY-MM-DD` focuses a day in the week view, as a tap on a day of
 * the week strip or the month grid does, `#new` opens the new-post sheet; all are read on mount and on `hashchange`,
 * and `#day=` / `#new` apply once (cleared with `history.replaceState`). A tap on a post pushes its `#post=` entry:
 * Back closes the popup (with the sheet's exit), any other close goes back off the entry while it is still the
 * current one. A popup opened from the URL pushed nothing, so closing it clears the hash in place and never leaves
 * the calendar.
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
  /** The post popup; `leaving` once Back took its entry away (it plays the exit, then closes). */
  const [open, setOpen] = useState<{ id: string; leaving: boolean } | null>(null);
  /** The `#post=` hash a tap here pushed for the open popup: closing goes back off that entry. */
  const pushed = useRef<string | null>(null);
  const [draft, setDraft] = useState<{ day: string | null } | null>(null);
  /** The "+" pops in one frame after it mounts (at once with reduced motion). */
  const [fabIn, setFabIn] = useState(prefersReducedMotion);
  useEffect(() => {
    const id = requestAnimationFrame(() => setFabIn(true));
    return () => cancelAnimationFrame(id);
  }, []);

  /** The week view on that day's week, with the day picked (strip and list). */
  const showDay = useCallback((day: string) => {
    setView("week");
    setWeekStart(weekKey(day));
    setFocusDay(day);
  }, []);

  useEffect(() => {
    const apply = () => {
      const h = parseCalendarHash(window.location.hash);
      if (h.day) {
        showDay(h.day);
        // Once: closing a popup later lands back on this entry and must not reset the view the owner chose since.
        if (!h.post) clearHash();
      }
      if (h.newPost) {
        // Once: a reload does not reopen it.
        setDraft({ day: dayKey() });
        clearHash();
      }
      pushed.current = null;
      if (h.post) {
        if (useStore.getState().posts.some((p) => p.id === h.post)) {
          setOpen({ id: h.post, leaving: false });
        } else {
          // Unknown id: fall back to the normal week view.
          setOpen(null);
          clearHash();
        }
      } else setOpen((o) => o && { ...o, leaving: true });
    };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, [showDay]);

  const filtered = useMemo(
    () => (filter === "all" ? posts : posts.filter((p) => p.platform === filter)),
    [posts, filter],
  );

  const openPost = useCallback((id: string) => {
    setOpen({ id, leaving: false });
    pushed.current = postHash(id);
    history.pushState(null, "", pushed.current);
  }, []);
  const close = useCallback(() => {
    setOpen(null);
    // A Next <Link> may have pushed another hash under the popup (no hashchange): going back would land on this
    // popup's entry and reopen it.
    const ours = pushed.current !== null && window.location.hash === pushed.current;
    pushed.current = null;
    if (ours) history.back();
    else clearHash();
  }, []);
  const newOn = useCallback((day: string | null) => setDraft({ day }), []);
  /** The new post's week and month come into view behind the closing sheet. */
  const created = useCallback((post: Post) => {
    if (post.plannedDay) {
      setWeekStart(weekKey(post.plannedDay));
      setMonthKey(monthKeyOf(post.plannedDay));
    }
  }, []);

  return (
    // Phones: room under the last row, so the floating "+" never covers its chip.
    <div
      className="flex flex-col gap-4 max-md:pb-14"
      data-testid="calendar-screen"
      data-view={view}
    >
      <PageHeader title={t("social.calendar.title")} sub={t("social.calendar.sub")} />

      <div className="flex flex-wrap items-center gap-2">
        {/* Grows beside the md+ button (phones have the floating "+" instead). */}
        <Segmented
          options={VIEWS.map((v) => ({
            value: v,
            label: t(`calendar.view.${v}`),
            testId: `calendar-view-${v}`,
          }))}
          value={view}
          onChange={setView}
          label={t("social.calendar.title")}
          className="grow basis-48 md:max-w-sm"
          idPrefix="cal-view"
        />
        <button
          type="button"
          className="px-btn px-btn-sm ms-auto max-md:hidden"
          onClick={() => newOn(null)}
          data-testid="calendar-new"
        >
          {t("calendar.new")}
        </button>
      </div>
      {/* The phone's "+" lives in <body>: #main scales back under an open sheet, and a transformed ancestor would
          carry a fixed child along. Same test id as the header button: one of the two is shown. */}
      {createPortal(
        <button
          type="button"
          className="ios-fab glass md:hidden"
          data-show={fabIn}
          aria-label={t("calendar.form.title")}
          onClick={() => newOn(focusDay)}
          data-testid="calendar-new"
        >
          <Plus size={26} strokeWidth={1.75} aria-hidden />
        </button>,
        document.body,
      )}

      <div className="flex flex-wrap gap-2" role="group" aria-label={t("calendar.filter.aria")}>
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
            aria-pressed={filter === p}
            onClick={() => setFilter(p)}
            data-testid={`calendar-filter-${p}`}
            data-platform={p}
          >
            <PlatformGlyph platform={p} size={14} className="shrink-0" />
            {L(PLATFORM_META[p].name)}
          </button>
        ))}
      </div>

      {posts.length === 0 && (
        <div className="ios-list">
          <EmptyState
            icon={<Calendar size={24} strokeWidth={1.75} aria-hidden />}
            title={t("calendar.emptyTitle")}
            hint={t("calendar.emptyBody")}
            action={
              <button
                type="button"
                className="px-btn"
                onClick={() => newOn(today)}
                data-testid="calendar-empty-new"
              >
                {t("calendar.new")}
              </button>
            }
            testId="calendar-empty"
          />
        </div>
      )}

      {/* Focusable (APG tabs): no view opens on a control. */}
      <div
        role="tabpanel"
        id={`cal-view-panel-${view}`}
        aria-labelledby={`cal-view-tab-${view}`}
        tabIndex={0}
      >
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
            onDay={showDay}
            onOpen={openPost}
            onNewOn={newOn}
          />
        )}
        {view === "month" && (
          <MonthView
            posts={filtered}
            monthKey={monthKey}
            today={today}
            onMonth={setMonthKey}
            onDay={showDay}
            onNewOn={newOn}
          />
        )}
        {view === "stages" && <StagesBoard posts={filtered} onOpen={openPost} />}
      </div>

      {draft && (
        <PostForm initialDay={draft.day} onClose={() => setDraft(null)} onCreated={created} />
      )}
      {open && <PostSheet key={open.id} postId={open.id} leaving={open.leaving} onClose={close} />}
    </div>
  );
}
