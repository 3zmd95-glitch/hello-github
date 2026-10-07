"use client";

import { useState, type FormEvent } from "react";
import Segmented from "@/components/ui/ios/Segmented";
import { useSheetClose } from "@/components/ui/ios/Sheet";
import { PLATFORMS, type IdeaSource, type Platform } from "@/lib/domain";
import { useT } from "@/lib/i18n";
import { PlatformGlyph } from "@/lib/platformIcons";
import { PLATFORM_META } from "@/lib/social";
import { useStore } from "@/store";

/** Sources the owner types in by hand; "skill" ideas come from the suggestions below the list. */
const MANUAL_SOURCES = ["me", "audience", "trend"] as const satisfies readonly IdeaSource[];

/**
 * The "new idea" form, inside its sheet: Save adds the idea, tells the list (`onSaved`), and closes the sheet with
 * its exit animation.
 */
export default function AddIdeaForm({ onSaved }: { onSaved: () => void }) {
  const { t, L } = useT();
  const addIdea = useStore((s) => s.addIdea);
  const close = useSheetClose();
  const [text, setText] = useState("");
  const [source, setSource] = useState<IdeaSource>("me");
  const [platform, setPlatform] = useState<Platform | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    addIdea({ text: trimmed, source, ...(platform ? { platform } : {}) });
    onSaved();
    close();
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" data-testid="idea-form">
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
        <span className="text-ink-2 text-[13px] font-semibold">{t("ideas.sourceLabel")}</span>
        <Segmented
          role="radiogroup"
          label={t("ideas.sourceLabel")}
          value={source}
          onChange={setSource}
          testId="idea-source"
          options={MANUAL_SOURCES.map((s) => ({
            value: s,
            label: t(`ideas.source.${s}`),
            testId: `idea-source-${s}`,
          }))}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-ink-2 text-[13px] font-semibold">{t("ideas.platformLabel")}</span>
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
              // The calendar's platform chip: pressed, it fills with the platform's color.
              className="px-fchip cal-fchip"
              aria-pressed={platform === p}
              onClick={() => setPlatform(platform === p ? null : p)}
              data-testid={`idea-platform-${p}`}
              data-platform={p}
            >
              <PlatformGlyph platform={p} size={14} className="shrink-0" />
              {L(PLATFORM_META[p].name)}
            </button>
          ))}
        </div>
      </div>
      <button
        type="submit"
        className="px-btn w-full"
        disabled={!text.trim()}
        data-testid="idea-add"
      >
        {t("ideas.add")}
      </button>
    </form>
  );
}
