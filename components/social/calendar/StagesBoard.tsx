"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo } from "react";
import Chip from "@/components/ui/ios/Chip";
import { POST_STAGES, type Post, type PostStage } from "@/lib/domain";
import { useT } from "@/lib/i18n";
import { overduePosts, stageIndex } from "@/lib/social";
import { useStore } from "@/store";
import { STAGE_KEY } from "./PlatformChip";
import PostCard from "./PostCard";

/**
 * Six stage cards idea → posted, side by side; the board scrolls sideways and snaps a card at a time (the page never
 * scrolls sideways). Each card: the stage and its count, then its posts as rows with back / forward buttons. Forward
 * into "posted" is never offered here: the popup's "Mark as posted" (with the link) is the only way in, so the linked
 * Produce quest completes with it. Back out of "posted" goes through unmarkPosted so the link and time are cleared too.
 */
export default function StagesBoard({
  posts,
  onOpen,
}: {
  posts: readonly Post[];
  onOpen: (id: string) => void;
}) {
  const { t } = useT();
  const setPostStage = useStore((s) => s.setPostStage);
  const unmarkPosted = useStore((s) => s.unmarkPosted);
  const overdue = useMemo(() => new Set(overduePosts(posts).map((p) => p.id)), [posts]);
  const byStage = useMemo(() => {
    const out = Object.fromEntries(POST_STAGES.map((s) => [s, [] as Post[]])) as Record<
      PostStage,
      Post[]
    >;
    for (const p of posts) out[p.stage].push(p);
    for (const s of POST_STAGES)
      out[s].sort(
        (a, b) =>
          (a.plannedDay ?? "9999").localeCompare(b.plannedDay ?? "9999") ||
          a.createdAt.localeCompare(b.createdAt),
      );
    return out;
  }, [posts]);

  const move = (post: Post, delta: -1 | 1) => {
    const target = POST_STAGES[stageIndex(post.stage) + delta];
    if (!target || target === "posted") return;
    if (post.stage === "posted") unmarkPosted(post.id);
    else setPostStage(post.id, target);
  };

  return (
    <section className="flex flex-col gap-2" data-testid="calendar-stages-view">
      <p className="text-muted text-center text-xs lg:hidden">{t("calendar.board.hint")}</p>
      <div className="cal-board" data-testid="calendar-board">
        {POST_STAGES.map((stage) => {
          const items = byStage[stage];
          return (
            <section key={stage} className="cal-col" data-testid="stage-col" data-stage={stage}>
              <header className="flex items-center justify-between gap-2 ps-1 pb-2.5">
                <h2 className="text-[17px] font-semibold">{t(STAGE_KEY[stage])}</h2>
                <Chip>
                  <span className="num">{items.length}</span>
                </Chip>
              </header>
              {items.length === 0 ? (
                <p className="cal-none">{t("calendar.board.empty")}</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {items.map((post) => {
                    const idx = stageIndex(post.stage);
                    const nextIsPosted = POST_STAGES[idx + 1] === "posted";
                    const nextLabel = t(
                      nextIsPosted ? "calendar.stageNextPosted" : "calendar.stageNext",
                    );
                    return (
                      <PostCard
                        key={post.id}
                        post={post}
                        overdue={overdue.has(post.id)}
                        onOpen={onOpen}
                      >
                        <div className="cal-moves">
                          <button
                            type="button"
                            className="ios-icbtn bg-tint-bg text-tint disabled:opacity-40"
                            disabled={idx === 0}
                            onClick={() => move(post, -1)}
                            aria-label={t("calendar.stageBack")}
                            title={t("calendar.stageBack")}
                            data-testid="stage-back"
                          >
                            <ChevronRight
                              size={20}
                              strokeWidth={1.75}
                              className="ltr:rotate-180"
                              aria-hidden
                            />
                          </button>
                          <button
                            type="button"
                            className="ios-icbtn bg-tint-bg text-tint disabled:opacity-40"
                            disabled={nextIsPosted || post.stage === "posted"}
                            onClick={() => move(post, 1)}
                            aria-label={nextLabel}
                            title={nextLabel}
                            data-testid="stage-next"
                          >
                            <ChevronLeft
                              size={20}
                              strokeWidth={1.75}
                              className="ltr:rotate-180"
                              aria-hidden
                            />
                          </button>
                          {nextIsPosted && (
                            <span className="text-ink-2 min-w-0 text-xs leading-snug">
                              {t("calendar.stageNextPosted")}
                            </span>
                          )}
                        </div>
                      </PostCard>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </section>
  );
}
