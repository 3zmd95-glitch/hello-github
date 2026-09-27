"use client";

import { useMemo } from "react";
import { POST_STAGES, type Post, type PostStage } from "@/lib/domain";
import { useT } from "@/lib/i18n";
import { overduePosts, stageIndex } from "@/lib/social";
import { useStore } from "@/store";
import { STAGE_KEY } from "./PlatformChip";
import PostCard from "./PostCard";

/**
 * Six columns idea → posted with ◀ ▶ moves per card. Forward into "posted" is never offered here: the
 * popup's "Mark as posted" (with the link) is the only way in, so the linked Produce quest completes with it.
 * Back out of "posted" goes through unmarkPosted so the link and time are cleared too. On phones the board
 * scrolls sideways inside its own container; the page never does.
 */
export default function StagesBoard({
  posts,
  onOpen,
}: {
  posts: readonly Post[];
  onOpen: (id: string) => void;
}) {
  const { t, dir } = useT();
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

  const backGlyph = dir === "rtl" ? "▶" : "◀";
  const nextGlyph = dir === "rtl" ? "◀" : "▶";

  const move = (post: Post, delta: -1 | 1) => {
    const target = POST_STAGES[stageIndex(post.stage) + delta];
    if (!target || target === "posted") return;
    if (post.stage === "posted") unmarkPosted(post.id);
    else setPostStage(post.id, target);
  };

  return (
    <section className="flex flex-col gap-2" data-testid="calendar-stages-view">
      <p className="text-muted text-xs lg:hidden">{t("calendar.board.hint")}</p>
      <div className="cal-board" data-testid="calendar-board">
        {POST_STAGES.map((stage) => {
          const items = byStage[stage];
          return (
            <section
              key={stage}
              className="px-card cal-col flex flex-col gap-2 p-3"
              data-testid="stage-col"
              data-stage={stage}
            >
              <header className="flex items-baseline gap-2">
                <b>{t(STAGE_KEY[stage])}</b>
                <span className="num text-muted text-xs">{items.length}</span>
              </header>
              {items.length === 0 ? (
                <p className="text-muted text-xs">{t("calendar.board.empty")}</p>
              ) : (
                items.map((post) => {
                  const idx = stageIndex(post.stage);
                  const nextIsPosted = POST_STAGES[idx + 1] === "posted";
                  return (
                    <PostCard
                      key={post.id}
                      post={post}
                      overdue={overdue.has(post.id)}
                      onOpen={onOpen}
                    >
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          className="px-btn px-btn-ghost px-btn-sm num"
                          disabled={idx === 0}
                          onClick={() => move(post, -1)}
                          aria-label={t("calendar.stageBack")}
                          title={t("calendar.stageBack")}
                          data-testid="stage-back"
                        >
                          {backGlyph}
                        </button>
                        <button
                          type="button"
                          className="px-btn px-btn-ghost px-btn-sm num"
                          disabled={nextIsPosted || post.stage === "posted"}
                          onClick={() => move(post, 1)}
                          aria-label={
                            nextIsPosted ? t("calendar.stageNextPosted") : t("calendar.stageNext")
                          }
                          title={
                            nextIsPosted ? t("calendar.stageNextPosted") : t("calendar.stageNext")
                          }
                          data-testid="stage-next"
                        >
                          {nextGlyph}
                        </button>
                        {nextIsPosted && (
                          <span className="text-muted text-[0.68rem] leading-tight">
                            {t("calendar.stageNextPosted")}
                          </span>
                        )}
                      </div>
                    </PostCard>
                  );
                })
              )}
            </section>
          );
        })}
      </div>
    </section>
  );
}
