"use client";

import { useCallback, useEffect, useRef } from "react";
import { GENRES } from "@/lib/genres";
import type { Genre } from "@/lib/domain";
import type { ResearchItem } from "@/lib/research";
import { useSkillSheet } from "@/components/skills/SkillSheetProvider";
import CategoryPage from "./CategoryPage";
import SaveInspirationButton from "./SaveInspirationButton";
import { useScoutCaps } from "./useDiscover";
import { useScoutConfig } from "./useScout";

/**
 * Whether the Worker's category page (trends, lessons, top videos, Scan again, Connect TikTok trends) can show for
 * this category: a Discover v2 Worker, and a built-in category (an owner's own has no page).
 */
export function useCategoryTrendsAvailable(genre: Genre): boolean {
  const config = useScoutConfig();
  const caps = useScoutCaps(config);
  return !!config && caps?.discover === true && GENRES.some((g) => g.id === genre.id);
}

/** The Worker's own rule (categorySubject): the category's first English query without its trailing "edit". */
export const categorySubject = (genre: Genre): string =>
  (genre.queries.en[0] ?? "").replace(/\s+edit$/i, "");

/**
 * The Worker's category page as the Browse category page's third collection, "Trends & lessons". It is the same
 * CategoryPage that Search's category filter used to open. A tapped style keeps its niche: it is searched on the
 * Search tab as "<style> <category subject>" (`onPickStyle`); "Search all" goes back to this category's own search
 * (`onSearchAll`). The callbacks reach CategoryPage through stable wrappers: it lists them in its fetch effect, so a
 * new function per render would restart the page's request.
 */
export default function CategoryTrends({
  genre,
  onPickStyle,
  onSearchAll,
  onUnavailable,
  onOpenInspiration,
}: {
  genre: Genre;
  onPickStyle: (query: string) => void;
  onSearchAll: () => void;
  onUnavailable: () => void;
  onOpenInspiration: (url: string) => void;
}) {
  const config = useScoutConfig();
  const sheet = useSkillSheet();
  const latest = useRef({ genre, onPickStyle, onSearchAll, onUnavailable, onOpenInspiration });
  useEffect(() => {
    latest.current = { genre, onPickStyle, onSearchAll, onUnavailable, onOpenInspiration };
  });
  const pickStyle = useCallback((style: string) => {
    const subject = categorySubject(latest.current.genre);
    const has = subject && style.toLowerCase().includes(subject.toLowerCase());
    latest.current.onPickStyle(has || !subject ? style : `${style} ${subject}`);
  }, []);
  const searchAll = useCallback(() => latest.current.onSearchAll(), []);
  const unavailable = useCallback(() => latest.current.onUnavailable(), []);
  const renderAction = useCallback(
    (item: ResearchItem) => (
      <SaveInspirationButton item={item} onOpen={(url) => latest.current.onOpenInspiration(url)} />
    ),
    [],
  );
  if (!config) return null;
  return (
    <CategoryPage
      key={genre.id}
      config={config}
      genre={genre}
      onPickStyle={pickStyle}
      onSearchAll={searchAll}
      onOpenSkill={sheet.open}
      onUnavailable={unavailable}
      renderAction={renderAction}
    />
  );
}
