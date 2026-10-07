"use client";

import { Clock, Lightbulb, Plus, RefreshCw, Star, type LucideIcon } from "lucide-react";
import { useMemo, useState } from "react";
import EmptyState from "@/components/ui/ios/EmptyState";
import PageHeader from "@/components/ui/ios/PageHeader";
import Sheet from "@/components/ui/ios/Sheet";
import { IDEA_SOURCES, type Idea, type IdeaSource } from "@/lib/domain";
import { useT } from "@/lib/i18n";
import { useStore } from "@/store";
import AddIdeaForm from "./ideas/AddIdeaForm";
import IdeaRow, { SOURCE_ICON } from "./ideas/IdeaRow";
import SkillSuggestions from "./ideas/SkillSuggestions";
import TrendsCard from "./ideas/TrendsCard";

type Status = "favorites" | "waiting" | "used";
type Filter = "all" | Status | IdeaSource;

/** The mockup's status chips (favorites, still waiting for a post, already used), then the existing source chips. */
const STATUS_ICON: Record<Status, LucideIcon> = {
  favorites: Star,
  waiting: Clock,
  used: RefreshCw,
};
const FILTERS: readonly Filter[] = ["all", "favorites", "waiting", "used", ...IDEA_SOURCES];

function isStatus(f: Filter): f is Status {
  return f in STATUS_ICON;
}

function matches(f: Filter, idea: Idea, used: boolean): boolean {
  if (f === "all") return true;
  if (f === "favorites") return idea.favorite === true;
  if (f === "waiting") return !used;
  if (f === "used") return used;
  return idea.source === f;
}

/**
 * Ideas bank (master plan round 16; iOS look, tools/18 §6): the owner's ideas from their own head, audience asks
 * and trends, plus Training skills without a video. Any idea becomes a post on a chosen platform; a used idea links
 * to it; a swipe or the star button keeps the best ones in favorites. The Trend Radar (round 30,
 * planning/tools/08-trends.md) comes first, so what is trending is the first thing seen; "new idea" opens a sheet.
 */
export default function IdeasScreen() {
  const { t } = useT();
  const ideas = useStore((s) => s.ideas);
  const posts = useStore((s) => s.posts);
  const [filter, setFilter] = useState<Filter>("all");
  const [adding, setAdding] = useState(false);

  const rows = useMemo(() => {
    const live = new Map(posts.map((p) => [p.id, p]));
    return ideas
      .map((i) => ({ idea: i, post: i.usedInPostId ? live.get(i.usedInPostId) : undefined }))
      .filter(({ idea, post }) => matches(filter, idea, post !== undefined))
      .sort(
        (a, b) =>
          Number(a.post !== undefined) - Number(b.post !== undefined) ||
          b.idea.createdAt.localeCompare(a.idea.createdAt),
      );
  }, [ideas, posts, filter]);

  const empty =
    ideas.length === 0
      ? t("ideas.empty")
      : isStatus(filter)
        ? t("ideas.emptyStatus")
        : t("ideas.emptyFilter");

  return (
    <div className="flex flex-col" data-testid="ideas-screen">
      <PageHeader title={t("ideas.title")} sub={t("ideas.sub")} />

      <div className="flex flex-col gap-7">
        <TrendsCard />

        {/* From md: the bank next to the skill suggestions. */}
        <div className="flex flex-col gap-7 md:grid md:grid-cols-[1.3fr_1fr] md:items-start">
          <div className="flex min-w-0 flex-col gap-3">
            <button
              type="button"
              className="px-btn w-full"
              onClick={() => setAdding(true)}
              data-testid="idea-new"
            >
              <Plus size={18} strokeWidth={2} aria-hidden />
              {t("ideas.addTitle")}
            </button>

            <section
              className="flex flex-col gap-1.5"
              data-testid="ideas-list"
              data-count={ideas.length}
            >
              <div className="flex items-center justify-between gap-2 pe-4">
                <h2 className="ios-gh text-[13px]">{t("ideas.listTitle")}</h2>
                <span className="text-ink-2 text-[13px]" data-testid="ideas-count">
                  {t("ideas.count", { n: ideas.length })}
                </span>
              </div>
              {ideas.length > 0 && (
                <div className="ios-chips" role="group" aria-label={t("ideas.filterLabel")}>
                  {FILTERS.map((f) => {
                    const Icon = f === "all" ? null : isStatus(f) ? STATUS_ICON[f] : SOURCE_ICON[f];
                    return (
                      <button
                        key={f}
                        type="button"
                        className="px-fchip"
                        aria-pressed={filter === f}
                        onClick={() => setFilter(f)}
                        data-testid={`ideas-filter-${f}`}
                      >
                        {Icon && (
                          <Icon size={14} strokeWidth={1.75} className="shrink-0" aria-hidden />
                        )}
                        {f === "all" || isStatus(f)
                          ? t(`ideas.filter.${f}`)
                          : t(`ideas.source.${f}`)}
                      </button>
                    );
                  })}
                </div>
              )}
              {rows.length === 0 ? (
                <div className="ios-list">
                  <EmptyState
                    icon={<Lightbulb size={24} strokeWidth={1.75} aria-hidden />}
                    title={empty}
                    testId="ideas-empty"
                  />
                </div>
              ) : (
                <>
                  <ul className="ios-list">
                    {rows.map(({ idea, post }) => (
                      <IdeaRow key={idea.id} idea={idea} livePost={post} />
                    ))}
                  </ul>
                  <p className="text-muted text-center text-xs pointer-fine:hidden">
                    {t("ideas.swipeHint")}
                  </p>
                </>
              )}
            </section>
          </div>

          <SkillSuggestions />
        </div>
      </div>

      {adding && (
        <Sheet
          onClose={() => setAdding(false)}
          title={t("ideas.addTitle")}
          titleId="idea-sheet-title"
          testId="idea-sheet"
          detents={[0.92]}
        >
          <AddIdeaForm />
        </Sheet>
      )}
    </div>
  );
}
