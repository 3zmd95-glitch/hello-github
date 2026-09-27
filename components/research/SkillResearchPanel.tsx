"use client";

import { useState } from "react";
import type { Ref, Skill } from "@/lib/domain";
import { useT } from "@/lib/i18n";
import { youtubeQuery } from "@/lib/research";
import { refsForSkill, useStore } from "@/store";
import PasteLinkForm from "./PasteLinkForm";
import PlatformLinks from "./PlatformLinks";
import YoutubeResults from "./YoutubeResults";

/** The Research panel inside a skill sheet: platform links, in-app YouTube results, paste-a-link. */
export default function SkillResearchPanel({ skill }: { skill: Skill }) {
  const { t, lang } = useT();
  const [queryLang, setQueryLang] = useState(lang);
  const savedRefs = useStore((s) => refsForSkill(s, skill.id));
  const addRef = useStore((s) => s.addRef);
  const query = youtubeQuery(skill.name, queryLang, skill.programId);
  const isSaved = (url: string) => savedRefs.some((r) => r.url === url);

  return (
    <section className="px-inset flex flex-col gap-3" data-testid="research-panel">
      <PlatformLinks
        topic={skill.name}
        programHint={skill.programId}
        lang={queryLang}
        onLangChange={setQueryLang}
      />
      <div className="flex flex-col gap-2">
        <h4 className="text-ink-2 text-xs font-bold">{t("research.ytResults")}</h4>
        <YoutubeResults
          query={query}
          lang={queryLang}
          renderAction={(video) => {
            const saved = isSaved(video.url);
            return (
              <button
                type="button"
                className="px-btn px-btn-ghost px-btn-sm mt-1"
                disabled={saved}
                onClick={() => {
                  const ref: Ref = {
                    platform: "yt",
                    handle: video.channel,
                    title: video.title,
                    url: video.url,
                  };
                  addRef(skill.id, ref);
                }}
                data-testid="yt-add-ref"
              >
                {saved ? t("research.added") : t("research.addRef")}
              </button>
            );
          }}
        />
      </div>
      <div className="flex flex-col gap-2">
        <h4 className="text-ink-2 text-xs font-bold">{t("research.pasteTitle")}</h4>
        <PasteLinkForm onAdd={(ref) => addRef(skill.id, ref)} />
      </div>
    </section>
  );
}
