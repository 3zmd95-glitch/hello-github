"use client";

import { useMemo, useState } from "react";
import PageHeader from "@/components/ui/ios/PageHeader";
import { IDEA_SOURCES, type IdeaSource } from "@/lib/domain";
import { useT } from "@/lib/i18n";
import { useStore } from "@/store";
import AddIdeaForm from "./ideas/AddIdeaForm";
import IdeaRow from "./ideas/IdeaRow";
import SkillSuggestions from "./ideas/SkillSuggestions";
import TrendsCard from "./ideas/TrendsCard";

type Filter = "all" | IdeaSource;

/**
 * 💡 Ideas bank (master plan round 16): the owner's ideas from their own head, audience asks and trends, plus
 * Training skills without a video. Any idea becomes a post on a chosen platform; a used idea links to it.
 * The 📈 Trend Radar (round 30, planning/tools/08-trends.md) sits first, full width, so what is trending is
 * the first thing seen; the form, the list and the skill suggestions keep their two columns below it.
 */
export default function IdeasScreen() {
  const { t } = useT();
  const ideas = useStore((s) => s.ideas);
  const posts = useStore((s) => s.posts);
  const [filter, setFilter] = useState<Filter>("all");

  const rows = useMemo(() => {
    const live = new Map(posts.map((p) => [p.id, p]));
    return ideas
      .filter((i) => filter === "all" || i.source === filter)
      .map((i) => ({ idea: i, post: i.usedInPostId ? live.get(i.usedInPostId) : undefined }))
      .sort(
        (a, b) =>
          Number(a.post !== undefined) - Number(b.post !== undefined) ||
          b.idea.createdAt.localeCompare(a.idea.createdAt),
      );
  }, [ideas, posts, filter]);

  return (
    <div className="flex flex-col gap-4" data-testid="ideas-screen">
      <PageHeader title={t("ideas.title")} sub={t("ideas.sub")} />

      <TrendsCard />

      <div className="grid gap-4 md:grid-cols-[1fr_1.3fr] md:items-start">
        <div className="flex flex-col gap-4">
          <AddIdeaForm />
        </div>

        <div className="flex flex-col gap-4">
          <section
            className="px-card flex flex-col gap-3"
            data-testid="ideas-list"
            data-count={ideas.length}
          >
            <header className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base">{t("ideas.listTitle")}</h2>
              <span className="text-muted text-xs" data-testid="ideas-count">
                {t("ideas.count", { n: ideas.length })}
              </span>
            </header>
            <div
              className="flex flex-wrap gap-1.5"
              role="group"
              aria-label={t("ideas.sourceLabel")}
            >
              {(["all", ...IDEA_SOURCES] as Filter[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  className="px-fchip"
                  aria-pressed={filter === f}
                  onClick={() => setFilter(f)}
                  data-testid={`ideas-filter-${f}`}
                >
                  {f === "all" ? t("ideas.filter.all") : t(`ideas.source.${f}`)}
                </button>
              ))}
            </div>
            {rows.length === 0 ? (
              <p className="text-ink-2 text-sm" data-testid="ideas-empty">
                {ideas.length === 0 ? t("ideas.empty") : t("ideas.emptyFilter")}
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {rows.map(({ idea, post }) => (
                  <IdeaRow key={idea.id} idea={idea} livePost={post} />
                ))}
              </ul>
            )}
          </section>

          <SkillSuggestions />
        </div>
      </div>
    </div>
  );
}
