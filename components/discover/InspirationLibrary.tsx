"use client";

import { useEffect, useRef, useState } from "react";
import ResultCard from "@/components/research/ResultCard";
import { useT, type MessageKey } from "@/lib/i18n";
import {
  inspirationKey,
  INSPIRATION_NOTE_MAX,
  type Inspiration,
  type InspirationStage,
} from "@/lib/inspiration";
import { itemFromRef } from "@/lib/research";
import { useStore } from "@/store";

const stages: Record<InspirationStage, MessageKey> = {
  saved: "inspiration.stageSaved",
  trying: "inspiration.stageTrying",
  tried: "inspiration.stageTried",
};

export default function InspirationLibrary({
  focusUrl,
  onExplore,
}: {
  focusUrl?: string;
  onExplore: () => void;
}) {
  const { t } = useT();
  const entries = useStore((s) => s.inspirations);
  const update = useStore((s) => s.updateInspiration);
  const remove = useStore((s) => s.removeInspiration);
  const [filter, setFilter] = useState<InspirationStage | "all">("all");
  const [removed, setRemoved] = useState<Inspiration | null>(null);
  const focusRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    focusRef.current?.focus();
  }, [focusUrl]);
  const shown = entries.filter((entry) => filter === "all" || entry.stage === filter);
  return (
    <section className="flex flex-col gap-4" data-testid="inspiration-library">
      <div className="px-card flex flex-col gap-2">
        <h2 className="text-xl">{t("inspiration.title")}</h2>
        <p className="text-ink-2 text-sm">{t("inspiration.help")}</p>
        <p className="text-muted text-xs">{t("inspiration.local")}</p>
      </div>
      {removed && (
        <div role="status" className="flex items-center gap-3 text-sm">
          {t("inspiration.removed")}
          <button
            type="button"
            className="px-link"
            onClick={() => {
              useStore
                .getState()
                .saveInspiration(itemFromRef(removed.ref), new Date(removed.savedAt));
              useStore
                .getState()
                .updateInspiration(removed.ref.url, { note: removed.note, stage: removed.stage });
              setRemoved(null);
            }}
          >
            {t("inspiration.undo")}
          </button>
        </div>
      )}
      {!entries.length ? (
        <div className="px-card flex flex-col items-start gap-3">
          <h3>{t("inspiration.empty")}</h3>
          <p className="text-ink-2 text-sm">{t("inspiration.emptyHelp")}</p>
          <button type="button" className="px-btn" onClick={onExplore}>
            {t("inspiration.back")}
          </button>
        </div>
      ) : (
        <>
          <div
            role="group"
            aria-label={t("inspiration.stageLabel")}
            className="flex flex-wrap gap-2"
          >
            {(["all", "saved", "trying", "tried"] as const).map((stage) => (
              <button
                type="button"
                key={stage}
                className="px-fchip"
                aria-pressed={stage === filter}
                onClick={() => setFilter(stage)}
              >
                {t(stage === "all" ? "inspiration.all" : stages[stage])}
              </button>
            ))}
          </div>
          {!shown.length && <p className="text-muted text-sm">{t("inspiration.filterEmpty")}</p>}
          <ul className="grid grid-cols-1 items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
            {shown.map((entry) => (
              <ResultCard
                key={entry.ref.url}
                item={itemFromRef(entry.ref)}
                testId="inspiration-card"
                action={
                  <div className="flex w-full flex-col gap-2">
                    <label className="flex flex-col gap-1 text-xs">
                      {t("inspiration.noteLabel")}
                      <textarea
                        ref={inspirationKey(entry.ref) === focusUrl ? focusRef : undefined}
                        className="px-input min-h-24 w-full resize-y text-sm"
                        dir="auto"
                        maxLength={INSPIRATION_NOTE_MAX}
                        placeholder={t("inspiration.notePlaceholder")}
                        value={entry.note}
                        onChange={(event) => update(entry.ref.url, { note: event.target.value })}
                        data-testid="inspiration-note"
                      />
                    </label>
                    <p className="text-muted text-xs">{t("inspiration.noteSaved")}</p>
                    <label className="flex flex-col gap-1 text-xs">
                      {t("inspiration.stageLabel")}
                      <select
                        className="px-input text-sm"
                        value={entry.stage}
                        onChange={(event) =>
                          update(entry.ref.url, { stage: event.target.value as InspirationStage })
                        }
                        data-testid="inspiration-stage"
                      >
                        {Object.entries(stages).map(([stage, label]) => (
                          <option key={stage} value={stage}>
                            {t(label)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      className="px-link w-fit text-xs"
                      onClick={() => {
                        setRemoved(entry);
                        remove(entry.ref.url);
                      }}
                    >
                      {t("inspiration.remove")}
                    </button>
                  </div>
                }
              />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
