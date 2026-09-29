"use client";

import { useState } from "react";
import { PlatformPicker } from "@/components/social/studio/platform";
import { PLATFORMS, type Platform, type Post, type TrendItem } from "@/lib/domain";
import { useT } from "@/lib/i18n";
import { savedTrendIdea, trendIdeaText } from "@/lib/trends";
import { useStore } from "@/store";

/** What the radar shows after "📱 خطّط بوست": the new post, for the planned notice and its calendar link. */
export type PlannedPost = Pick<Post, "id" | "title">;

/** The calendar platform a trend row maps to, when its platform is one the owner posts on. */
export function calendarPlatformOf(item: TrendItem): Platform | undefined {
  return (PLATFORMS as readonly string[]).includes(item.platform)
    ? (item.platform as Platform)
    : undefined;
}

/**
 * The two taps under every radar row and moment (round 30, planning/tools/08-trends.md): 💡 saves the trend
 * as an idea (`addIdea`, source `trend`) and 📱 plans a post on a chosen platform (the same idea, then
 * `useIdea`, like the ideas list does). "Saved" is derived from the bank, so it survives a reload and a
 * second save of the same trend reuses the idea instead of duplicating it, whichever UI language saved it.
 */
export default function TrendActions({
  item,
  idPrefix,
  onPlanned,
}: {
  item: TrendItem;
  /** Builds the test ids: `${idPrefix}-save`, `${idPrefix}-plan`, `${idPrefix}-post-<platform>`. */
  idPrefix: string;
  onPlanned: (post: PlannedPost) => void;
}) {
  const { t, lang } = useT();
  const ideas = useStore((s) => s.ideas);
  const addIdea = useStore((s) => s.addIdea);
  const turnIntoPost = useStore((s) => s.useIdea);
  const [picking, setPicking] = useState(false);

  // New saves use the current language; "saved" matches either language's text (savedTrendIdea).
  const text = trendIdeaText(item, lang);
  const saved = savedTrendIdea(ideas, item);

  const ensureIdea = () =>
    saved ?? addIdea({ text, source: "trend", platform: calendarPlatformOf(item) });

  if (picking) {
    return (
      <PlatformPicker
        idPrefix={`${idPrefix}-post`}
        label={t("trends.pickPlatform")}
        cancelLabel={t("trends.cancel")}
        onCancel={() => setPicking(false)}
        onPick={(p) => {
          const post = turnIntoPost(ensureIdea().id, p);
          if (post) onPlanned({ id: post.id, title: post.title });
          setPicking(false);
        }}
      />
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {saved ? (
        <span className="px-chip px-chip-green self-center" data-testid={`${idPrefix}-saved`}>
          {t("trends.saved")}
        </span>
      ) : (
        <button
          type="button"
          className="px-btn px-btn-ghost px-btn-sm"
          onClick={() => ensureIdea()}
          data-testid={`${idPrefix}-save`}
        >
          {t("trends.save")}
        </button>
      )}
      <button
        type="button"
        className="px-btn px-btn-sm"
        onClick={() => setPicking(true)}
        data-testid={`${idPrefix}-plan`}
      >
        {t("trends.plan")}
      </button>
    </div>
  );
}
