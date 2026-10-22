"use client";

import {
  MessageCircle,
  PenLine,
  RefreshCw,
  Sparkles,
  Star,
  Trash2,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { PlatformPicker, calendarPostHref } from "@/components/social/studio/platform";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { useSwipeAction } from "@/components/ui/ios/useSwipeAction";
import { getSkill } from "@/data";
import type { Idea, IdeaSource, Post } from "@/lib/domain";
import { useT } from "@/lib/i18n";
import { PlatformGlyph } from "@/lib/platformIcons";
import { PLATFORM_META } from "@/lib/social";
import { useStore } from "@/store";

/** Where an idea came from, as an icon (tools/18 §3.6): comments, trends, skills, the owner's own head. */
export const SOURCE_ICON: Record<IdeaSource, LucideIcon> = {
  audience: MessageCircle,
  trend: TrendingUp,
  skill: Sparkles,
  me: PenLine,
};

/** Saved a moment ago (the sheet, a trend, a skill): its row rises into the list (tools/18 §3.5 "Lists"). */
function justAdded(createdAt: string): boolean {
  return Date.now() - Date.parse(createdAt) < 2000;
}

/** Rows that have been on screen in this page load: a remount (a filter change) never plays the rise again. */
const shown = new Set<string>();

/** The idea's text cut to about 60 characters for the alert's title (the trash's own name keeps all of it). */
function shortText(text: string): string {
  const chars = Array.from(text);
  return chars.length <= 60 ? text : `${chars.slice(0, 59).join("").trimEnd()}…`;
}

/**
 * One stored idea (tools/18 §6, mockup Ideas): its full text, where it came from (or "used"), "plan a post"
 * (platform chooser) or its calendar link, and remove (asks first). A swipe toward the end edge (left in RTL) stars
 * it like the star button; the star pops each time it turns on. A just-saved idea rises in, once; planned, the
 * button turns into the "in the calendar" chip in place (`onPlanned`: the list keeps the row where it is) with a pop,
 * and hands it its focus without moving the page (as the Studio's asks do).
 */
export default function IdeaRow({
  idea,
  livePost,
  onPlanned,
}: {
  idea: Idea;
  livePost: Post | undefined;
  /** Called before the idea becomes a post, so the list can keep its row in place. */
  onPlanned: (id: string) => void;
}) {
  const { t, L } = useT();
  const turnIntoPost = useStore((s) => s.useIdea);
  const removeIdea = useStore((s) => s.removeIdea);
  const toggleFavorite = useStore((s) => s.toggleIdeaFavorite);
  const [picking, setPicking] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [fresh, setFresh] = useState(() => !shown.has(idea.id) && justAdded(idea.createdAt));
  useEffect(() => {
    shown.add(idea.id);
  }, [idea.id]);
  const [planned, setPlanned] = useState(false);
  const chipRef = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    if (planned) chipRef.current?.focus({ preventScroll: true });
  }, [planned]);
  // Bumped on every star-on: the new key remounts the icon, so the pop plays again.
  const [pops, setPops] = useState(0);
  const skill = idea.skillId ? getSkill(idea.skillId) : undefined;
  const used = livePost !== undefined;
  const fav = idea.favorite === true;
  const toggle = () => {
    if (!fav) setPops((n) => n + 1);
    toggleFavorite(idea.id);
  };
  const { handlers, x, armed, dragging } = useSwipeAction(toggle);
  const SourceIcon = used ? RefreshCw : SOURCE_ICON[idea.source];

  return (
    <li
      className={`ios-swipe ${fresh ? "idea-rise" : ""}`}
      // The rise plays once: a later move of the row (a re-sort) must not restart it. The star's and the chip's
      // pops bubble up here too; only the row's own animation ends it.
      onAnimationEnd={(e) => {
        if (e.target === e.currentTarget) setFresh(false);
      }}
      data-armed={armed}
      data-dragging={dragging}
      data-testid="idea-row"
      data-idea={idea.id}
      data-source={idea.source}
      data-used={used}
      data-favorite={fav}
    >
      <div className="ios-act" aria-hidden>
        <Star size={22} strokeWidth={1.75} />
      </div>
      <div
        className="ios-row"
        style={{ transform: `translateX(${x}px)`, userSelect: dragging ? "none" : undefined }}
        {...handlers}
      >
        <div className="ios-tx">
          <b>
            <span
              dir="auto"
              // The owner's own words, all of them (a long word or a link wraps): their direction, aligned with the row.
              className="block [text-align:-webkit-match-parent] [text-align:match-parent] break-words whitespace-normal"
            >
              {idea.text}
            </span>
          </b>
          <small className="flex flex-wrap items-center gap-x-1">
            <SourceIcon size={13} strokeWidth={1.75} className="shrink-0" aria-hidden />
            {used ? t("ideas.filter.used") : t(`ideas.source.${idea.source}`)}
            {skill && <span>· {L(skill.name)}</span>}
            {idea.platform && (
              <span className="inline-flex items-center gap-1">
                · <PlatformGlyph platform={idea.platform} size={12} />
                {L(PLATFORM_META[idea.platform].name)}
              </span>
            )}
          </small>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {used ? (
              <Link
                ref={chipRef}
                href={calendarPostHref(livePost.id)}
                draggable={false}
                // A 44px tall hit area around the 24px chip, inside the row.
                className={`ios-chip tint relative no-underline after:absolute after:inset-x-0 after:-inset-y-2.5 ${planned ? "ios-pop" : ""}`}
                data-testid="idea-used-link"
              >
                {t("ideas.used")}
              </Link>
            ) : picking ? (
              <PlatformPicker
                idPrefix="idea-use"
                label={t("ideas.pickPlatform")}
                cancelLabel={t("ideas.cancel")}
                onCancel={() => setPicking(false)}
                onPick={(p) => {
                  onPlanned(idea.id);
                  turnIntoPost(idea.id, p);
                  setPicking(false);
                  setPlanned(true);
                }}
              />
            ) : (
              <button
                type="button"
                className="px-btn px-btn-ghost px-btn-sm"
                onClick={() => setPicking(true)}
                data-testid="idea-use"
              >
                {t("ideas.use")}
              </button>
            )}
          </div>
        </div>
        {/* The row's end: the star on the title's line, remove (destructive, asks first) at the bottom. */}
        <div className="-my-1.5 -me-1.5 flex flex-col items-center justify-between self-stretch">
          <button
            type="button"
            className="ios-starb"
            aria-pressed={fav}
            aria-label={t("ideas.favorite", { name: idea.text })}
            onClick={toggle}
            data-testid="idea-star"
          >
            <Star
              key={pops}
              size={20}
              strokeWidth={1.75}
              className={pops ? "ios-pop" : undefined}
              aria-hidden
            />
          </button>
          {!picking && (
            <button
              type="button"
              className="ios-icbtn text-danger"
              onClick={() => setConfirming(true)}
              aria-label={t("ideas.removeLabel", { name: idea.text })}
              title={t("ideas.remove")}
              data-testid="idea-remove"
            >
              <Trash2 size={18} strokeWidth={1.75} aria-hidden />
            </button>
          )}
        </div>
      </div>
      {confirming && (
        <ConfirmDialog
          title={t("ideas.removeLabel", { name: shortText(idea.text) })}
          body={t("ideas.removeBody")}
          confirmLabel={t("ideas.remove")}
          danger
          onCancel={() => setConfirming(false)}
          onConfirm={() => removeIdea(idea.id)}
        />
      )}
    </li>
  );
}
