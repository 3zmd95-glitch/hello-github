"use client";

import { useState, type FormEvent } from "react";
import { PlatformChip } from "@/components/social/studio/platform";
import { PLATFORMS, type IdeaSource, type Platform } from "@/lib/domain";
import { useT } from "@/lib/i18n";
import { useStore } from "@/store";

/** Sources the owner types in by hand; "skill" ideas come from the suggestions below the list. */
const MANUAL_SOURCES = ["me", "audience", "trend"] as const satisfies readonly IdeaSource[];

export default function AddIdeaForm() {
  const { t } = useT();
  const addIdea = useStore((s) => s.addIdea);
  const [text, setText] = useState("");
  const [source, setSource] = useState<IdeaSource>("me");
  const [platform, setPlatform] = useState<Platform | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    addIdea({ text: trimmed, source, ...(platform ? { platform } : {}) });
    setText("");
  };

  return (
    <form onSubmit={submit} className="px-card flex flex-col gap-3" data-testid="idea-form">
      <h2 className="text-base">{t("ideas.addTitle")}</h2>
      <input
        type="text"
        className="px-input"
        placeholder={t("ideas.textPh")}
        aria-label={t("ideas.textPh")}
        value={text}
        onChange={(e) => setText(e.target.value)}
        autoComplete="off"
        enterKeyHint="done"
        data-testid="idea-text"
      />
      <div className="flex flex-col gap-1.5">
        <span className="text-muted text-xs">{t("ideas.sourceLabel")}</span>
        <div
          className="studio-seg"
          role="group"
          aria-label={t("ideas.sourceLabel")}
          data-testid="idea-source"
        >
          {MANUAL_SOURCES.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={source === s}
              onClick={() => setSource(s)}
              data-testid={`idea-source-${s}`}
            >
              {t(`ideas.source.${s}`)}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-muted text-xs">{t("ideas.platformLabel")}</span>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("ideas.platformLabel")}>
          <button
            type="button"
            className="px-fchip"
            aria-pressed={platform === null}
            onClick={() => setPlatform(null)}
            data-testid="idea-platform-any"
          >
            {t("ideas.platformAny")}
          </button>
          {PLATFORMS.map((p) => (
            <button
              key={p}
              type="button"
              className="studio-pfilter"
              aria-pressed={platform === p}
              onClick={() => setPlatform(platform === p ? null : p)}
              data-testid={`idea-platform-${p}`}
            >
              <PlatformChip platform={p} />
            </button>
          ))}
        </div>
      </div>
      <button
        type="submit"
        className="px-btn self-start"
        disabled={!text.trim()}
        data-testid="idea-add"
      >
        {t("ideas.add")}
      </button>
    </form>
  );
}
