"use client";

import { Fragment } from "react";
import type { Genre, GenreGroup } from "@/lib/domain";
import { CUSTOM_GENRE_EMOJI, groupGenres, MINE_GROUP_ID } from "@/lib/genres";
import { useT } from "@/lib/i18n";

/**
 * The category chips under their group headings (Sport → Football, Gym…). "grid": a heading over each group's
 * grid of chips (Browse and an open category). "row": one sideways-scrolling row with each heading as a plain
 * label before its chips (Search and the skill sheet). A group of one genre named like the group (Cars) shows
 * the chip alone, so the name is not printed twice.
 */
export default function GenreGroups({
  genres: list,
  layout,
  activeId,
  disabled,
  onPick,
  chipRef,
}: {
  /** Every genre to offer, built-in then custom (lib/genres allGenres). */
  genres: readonly Genre[];
  layout: "grid" | "row";
  /** The chip shown pressed. */
  activeId?: string;
  disabled?: boolean;
  onPick: (id: string) => void;
  chipRef?: (id: string, el: HTMLButtonElement | null) => void;
}) {
  const { t, L } = useT();
  const grid = layout === "grid";
  // t() answers in the reading language, which is the one L() picks below.
  const mineName = t("genres.group.mine");
  const groups = groupGenres(list, {
    id: MINE_GROUP_ID,
    emoji: CUSTOM_GENRE_EMOJI,
    name: { ar: mineName, en: mineName },
  });
  const chip = (g: Genre) => (
    <button
      key={g.id}
      ref={chipRef && ((el) => chipRef(g.id, el))}
      type="button"
      className={
        grid
          ? "border-edge bg-panel-2 hover:bg-panel-3 aria-pressed:bg-accent aria-pressed:text-accent-ink flex min-h-12 items-center gap-2 border-2 px-3 py-2 text-start text-sm font-bold"
          : "px-fchip shrink-0"
      }
      aria-pressed={g.id === activeId}
      disabled={disabled}
      onClick={() => onPick(g.id)}
      data-testid={`genre-${g.id}`}
    >
      <span aria-hidden>{g.emoji}</span>
      <span dir="auto">{L(g.name)}</span>
    </button>
  );
  const heading = (group: GenreGroup, genres: readonly Genre[], className: string) =>
    genres.length === 1 && L(genres[0].name) === L(group.name) ? null : (
      <span className={className} data-testid={`genre-group-${group.id}`}>
        <span aria-hidden>{group.emoji}</span>
        <span dir="auto">{L(group.name)}</span>
      </span>
    );
  if (!grid)
    return (
      <div
        className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto px-0.5 pt-0.5 pb-1.5 @3xl:flex-wrap @3xl:overflow-x-visible"
        data-testid="genres-chips"
      >
        {groups.map(({ group, genres }) => (
          <Fragment key={group.id}>
            {heading(
              group,
              genres,
              "text-muted flex shrink-0 items-center gap-1 ps-1 text-xs font-bold whitespace-nowrap",
            )}
            {genres.map(chip)}
          </Fragment>
        ))}
      </div>
    );
  return (
    <div className="flex w-full flex-col gap-3" data-testid="genres-chips">
      {groups.map(({ group, genres }) => (
        <div
          key={group.id}
          role="group"
          aria-label={L(group.name)}
          className="flex min-w-0 flex-col gap-1.5"
        >
          {heading(group, genres, "text-muted flex items-center gap-1.5 text-xs font-bold")}
          <div className="grid w-full grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {genres.map(chip)}
          </div>
        </div>
      ))}
    </div>
  );
}
