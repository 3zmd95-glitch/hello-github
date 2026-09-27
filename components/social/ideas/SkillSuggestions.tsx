"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { PlatformPicker, calendarPostHref } from "@/components/social/studio/platform";
import { getProgram, skills } from "@/data";
import { useT } from "@/lib/i18n";
import { ideasFromSkills, type SkillIdeaCandidate } from "@/lib/social";
import { useStore } from "@/store";

/** How many skills the section shows at once. */
const CAP = 8;

/**
 * "Skills without a video": Training skills whose Produce quest is open and that have neither a post nor a
 * stored idea. Skills the owner already started (more quests done) come first, so the suggestions follow the
 * training momentum.
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
      className="px-card flex flex-col gap-3"
      data-testid="ideas-from-skills"
      data-count={list.length}
    >
      <header className="flex flex-col gap-0.5">
        <h2 className="text-base">{t("ideas.fromSkills")}</h2>
        <p className="text-muted text-xs">{t("ideas.fromSkillsSub")}</p>
      </header>

      {planned && (
        <p
          className="px-inset flex flex-wrap items-center gap-2 text-sm"
          data-testid="ideas-planned-notice"
        >
          <span className="text-accent min-w-0 flex-1">
            {t("ideas.planned", { name: planned.title })}
          </span>
          <Link
            href={calendarPostHref(planned.id)}
            className="px-link text-xs"
            data-testid="ideas-planned-open"
          >
            {t("ideas.plannedOpen")}
          </Link>
        </p>
      )}

      {list.length === 0 ? (
        <p className="text-ink-2 text-sm" data-testid="ideas-from-skills-empty">
          {t("ideas.fromSkillsEmpty")}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {list.map((c) => {
            const skill = skills.find((s) => s.id === c.skillId);
            const program = skill ? getProgram(skill.programId) : undefined;
            const picking = pickingFor === c.skillId;
            return (
              <li
                key={c.skillId}
                className="px-inset flex flex-col gap-2"
                data-testid="skill-idea-row"
                data-skill={c.skillId}
                data-done={c.done}
              >
                <div className="flex items-start gap-2">
                  <span aria-hidden className="text-lg leading-none">
                    {program?.icon ?? "🎮"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{L(c.text)}</p>
                    <p className="text-ink-2 text-xs">{L(c.brief)}</p>
                  </div>
                  <span className="px-chip num shrink-0">
                    {t("ideas.skillProgress", { n: c.done })}
                  </span>
                </div>
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
                  <div className="flex flex-wrap gap-2">
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
                      className="px-btn px-btn-sm"
                      onClick={() => setPickingFor(c.skillId)}
                      data-testid="skill-idea-plan"
                    >
                      {t("ideas.skillPlan")}
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
