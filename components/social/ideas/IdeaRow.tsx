"use client";

import Link from "next/link";
import { useState } from "react";
import {
  PlatformChip,
  PlatformPicker,
  calendarPostHref,
} from "@/components/social/studio/platform";
import { getSkill } from "@/data";
import type { Idea, Post } from "@/lib/domain";
import { useT } from "@/lib/i18n";
import { useStore } from "@/store";

/** One stored idea: text, source and platform chips, "plan a post" (platform chooser) or its calendar link, remove. */
export default function IdeaRow({ idea, livePost }: { idea: Idea; livePost: Post | undefined }) {
  const { t, L } = useT();
  const turnIntoPost = useStore((s) => s.useIdea);
  const removeIdea = useStore((s) => s.removeIdea);
  const [picking, setPicking] = useState(false);
  const skill = idea.skillId ? getSkill(idea.skillId) : undefined;
  const used = livePost !== undefined;

  return (
    <li
      className="px-inset flex flex-col gap-2"
      data-testid="idea-row"
      data-idea={idea.id}
      data-source={idea.source}
      data-used={used}
    >
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 text-sm font-semibold">{idea.text}</p>
        <button
          type="button"
          className="px-btn px-btn-ghost px-btn-sm shrink-0"
          onClick={() => removeIdea(idea.id)}
          aria-label={t("ideas.removeLabel", { name: idea.text })}
          data-testid="idea-remove"
        >
          ✕
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="px-chip" data-testid="idea-source-chip">
          {t(`ideas.source.${idea.source}`)}
          {skill ? ` · ${L(skill.name)}` : ""}
        </span>
        {idea.platform && <PlatformChip platform={idea.platform} />}
        {used ? (
          <Link
            href={calendarPostHref(livePost.id)}
            className="px-chip px-chip-green no-underline"
            data-testid="idea-used-link"
          >
            {t("ideas.used")}
          </Link>
        ) : (
          !picking && (
            <button
              type="button"
              className="px-btn px-btn-sm ms-auto"
              onClick={() => setPicking(true)}
              data-testid="idea-use"
            >
              {t("ideas.use")}
            </button>
          )
        )}
      </div>
      {picking && !used && (
        <PlatformPicker
          idPrefix="idea-use"
          label={t("ideas.pickPlatform")}
          cancelLabel={t("ideas.cancel")}
          onCancel={() => setPicking(false)}
          onPick={(p) => {
            turnIntoPost(idea.id, p);
            setPicking(false);
          }}
        />
      )}
    </li>
  );
}
