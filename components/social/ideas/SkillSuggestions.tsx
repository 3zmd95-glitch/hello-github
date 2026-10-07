"use client";

import { CalendarPlus, Sparkles } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { PlatformPicker, calendarPostHref, withName } from "@/components/social/studio/platform";
import Chip from "@/components/ui/ios/Chip";
import { skills } from "@/data";
import { useT } from "@/lib/i18n";
import { ideasFromSkills, type SkillIdeaCandidate } from "@/lib/social";
import { useStore } from "@/store";

/** How many skills the section shows at once. */
const CAP = 8;

/**
 * "Skills without a video": Training skills whose Produce quest is open and that have neither a post nor a
 * stored idea, as a grouped list. Skills the owner already started (more quests done) come first, so the
 * suggestions follow the training momentum.
 */
export default function SkillSuggestions() {
  const { t, L } = useT();
  const completions = useStore((s) => s.completions);
  const posts = useStore((s) => s.posts);
  const ideas = useStore((s) => s.ideas);
  const addIdea = useStore((s) => s.addIdea);
  const createPostFromSkill = useStore((s) => s.createPostFromSkill);
  const [pickingFor, setPickingFor] = useState<string | null>(null);
  const [planned, setPlanned] = useState<{ id: string; title: string } | null>(null);

  const doneCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of completions) m.set(c.skillId, (m.get(c.skillId) ?? 0) + 1);
    return m;
  }, [completions]);

  const list = useMemo<(SkillIdeaCandidate & { done: number })[]>(
    () =>
      ideasFromSkills(skills, completions, posts, ideas)
        .map((c) => ({ ...c, done: doneCount.get(c.skillId) ?? 0 }))
        .sort((a, b) => b.done - a.done)
        .slice(0, CAP),
    [completions, posts, ideas, doneCount],
  );

  return (
    <section
      className="flex flex-col gap-1.5"
      data-testid="ideas-from-skills"
      data-count={list.length}
    >
      <h2 className="ios-gh text-[13px]">{t("ideas.fromSkills")}</h2>
      <ul className="ios-list">
        {planned && (
          <li className="ios-row" data-testid="ideas-planned-notice">
            <span className="ios-ic">
              <CalendarPlus size={22} strokeWidth={1.75} aria-hidden />
            </span>
            <span className="ios-tx">
              <b className="whitespace-normal">{withName(t("ideas.planned"), planned.title)}</b>
            </span>
            <Link
              href={calendarPostHref(planned.id)}
              className="px-link shrink-0 text-[13px]"
              data-testid="ideas-planned-open"
            >
              {t("ideas.plannedOpen")}
            </Link>
          </li>
        )}
        {list.length === 0 ? (
          <li className="ios-row" data-sep="16" data-testid="ideas-from-skills-empty">
            <span className="ios-tx">
              <b className="whitespace-normal">{t("ideas.fromSkillsEmpty")}</b>
            </span>
          </li>
        ) : (
          list.map((c) => {
            const picking = pickingFor === c.skillId;
            return (
              <li
                key={c.skillId}
                className="ios-row items-start"
                data-testid="skill-idea-row"
                data-skill={c.skillId}
                data-done={c.done}
              >
                <span className="ios-ic">
                  <Sparkles size={22} strokeWidth={1.75} aria-hidden />
                </span>
                <div className="ios-tx">
                  {/* The progress chip shares the title's line, so the brief and the buttons get the row's width. */}
                  <div className="flex items-start gap-2">
                    <b className="min-w-0 flex-1 whitespace-normal">{L(c.text)}</b>
                    <Chip className="num shrink-0">{t("ideas.skillProgress", { n: c.done })}</Chip>
                  </div>
                  <small>{L(c.brief)}</small>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {picking ? (
                      <PlatformPicker
                        idPrefix="skill-idea-post"
                        label={t("ideas.pickPlatform")}
                        cancelLabel={t("ideas.cancel")}
                        onCancel={() => setPickingFor(null)}
                        onPick={(p) => {
                          const post = createPostFromSkill(c.skillId, p);
                          if (post) setPlanned({ id: post.id, title: post.title });
                          setPickingFor(null);
                        }}
                      />
                    ) : (
                      <>
                        <button
                          type="button"
                          className="px-btn px-btn-ghost px-btn-sm"
                          onClick={() =>
                            addIdea({ text: L(c.text), source: "skill", skillId: c.skillId })
                          }
                          data-testid="skill-idea-save"
                        >
                          {t("ideas.skillSave")}
                        </button>
                        <button
                          type="button"
                          className="px-btn px-btn-ghost px-btn-sm"
                          onClick={() => setPickingFor(c.skillId)}
                          data-testid="skill-idea-plan"
                        >
                          {t("ideas.skillPlan")}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </li>
            );
          })
        )}
      </ul>
      <p className="text-muted px-4 text-xs">{t("ideas.fromSkillsSub")}</p>
    </section>
  );
}
