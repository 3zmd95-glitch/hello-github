"use client";

import { useId, useState, type ReactNode } from "react";
import { getSkill } from "@/data";
import type { LessonVideo, Technique } from "@/lib/categories";
import { embedId } from "@/lib/embed";
import { useT } from "@/lib/i18n";
import type { ResearchItem } from "@/lib/research";
import ResultCard, { PLATFORM_META } from "./ResultCard";

const lessonItem = (video: LessonVideo): ResearchItem => {
  const youtubeId = video.platform === "yt" ? embedId("yt", video.url) : undefined;
  return {
    platform: video.platform,
    url: video.url,
    title: video.title,
    handle: "",
    snippet: "",
    ...(youtubeId ? { thumb: `https://i.ytimg.com/vi/${youtubeId}/mqdefault.jpg` } : {}),
  };
};

/** A real example comes first. Study prompts describe what to look for and try, not what an AI saw in the video. */
export default function CategoryTechniqueCard({
  technique,
  expanded,
  onToggle,
  onOpenSkill,
  renderAction,
}: {
  technique: Technique;
  expanded: boolean;
  onToggle: () => void;
  onOpenSkill: (skillId: string) => void;
  renderAction?: (item: ResearchItem) => ReactNode;
}) {
  const { t, L, lang } = useT();
  const id = useId();
  const [selected, setSelected] = useState(0);
  const video = technique.videos[selected] ?? technique.videos[0];
  const item = lessonItem(video);
  const skill = technique.skillId ? getSkill(technique.skillId) : undefined;
  const study = technique.study;
  return (
    <li className="flex min-w-0 flex-col gap-2" data-testid="category-technique">
      <div>
        <h4 className="text-sm font-bold" dir="auto">
          {technique.name.en}
        </h4>
        {lang === "ar" && technique.name.ar && (
          <p className="text-muted text-xs" dir="rtl" data-testid="category-name-ar">
            {technique.name.ar}
          </p>
        )}
      </div>
      <ul>
        <ResultCard
          key={video.url}
          item={item}
          testId="category-lesson-preview"
          action={
            <>
              {renderAction?.(item)}
              <button
                type="button"
                className="px-btn px-btn-ghost px-btn-sm"
                aria-expanded={expanded}
                aria-controls={`${id}-study`}
                onClick={onToggle}
                data-testid="category-study-toggle"
              >
                {t("search.categoryStudy")}
              </button>
            </>
          }
        />
      </ul>
      {technique.videos.length > 1 && (
        <div
          className="flex min-w-0 flex-wrap gap-1"
          role="group"
          aria-label={t("search.categoryExamples")}
        >
          {technique.videos.map((v, i) => (
            <button
              key={`${i}:${v.url}`}
              type="button"
              className="px-fchip max-w-full min-w-0 text-start"
              aria-pressed={selected === i}
              onClick={() => setSelected(i)}
              title={v.title}
              data-testid="category-video"
              data-kind={v.kind}
              data-lang={v.lang}
            >
              <span aria-hidden>{PLATFORM_META[v.platform].glyph}</span>
              {t(
                v.kind === "example"
                  ? "search.categoryExample"
                  : v.lang === "ar"
                    ? "search.categoryTutorialAr"
                    : "search.categoryTutorial",
              )}
              <span className="num">{i + 1}</span>
            </button>
          ))}
        </div>
      )}
      {expanded && (
        <div
          id={`${id}-study`}
          className="px-inset flex flex-col gap-3"
          data-testid="category-study"
        >
          <h5 className="text-sm font-bold">{t("search.categorySuggestedPractice")}</h5>
          {study ? (
            <>
              <div className="flex flex-col gap-1">
                <b className="text-xs">{t("search.categoryWatchFor")}</b>
                <p className="text-ink-2 text-sm" dir="ltr" data-testid="category-watch-for">
                  {study.watchFor.en}
                </p>
                {lang === "ar" && study.watchFor.ar && (
                  <p className="text-muted text-xs" dir="rtl" data-testid="category-watch-for-ar">
                    {study.watchFor.ar}
                  </p>
                )}
              </div>
              <div className="flex flex-col gap-1">
                <b className="text-xs">{t("search.categoryTryIt")}</b>
                <p className="text-ink-2 text-sm" dir="ltr" data-testid="category-try-it">
                  {study.tryIt.en}
                </p>
                {lang === "ar" && study.tryIt.ar && (
                  <p className="text-muted text-xs" dir="rtl" data-testid="category-try-it-ar">
                    {study.tryIt.ar}
                  </p>
                )}
              </div>
              <p className="text-muted text-[11px]" data-testid="category-study-basis">
                {t("search.categoryStudyBasis")}
              </p>
            </>
          ) : (
            <p className="text-ink-2 text-sm" data-testid="category-study-legacy">
              {t("search.categoryStudyLegacy")}
            </p>
          )}
          {skill && (
            <button
              type="button"
              className="px-btn px-btn-ghost px-btn-sm w-fit max-w-full text-start"
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
        </div>
      )}
    </li>
  );
}
