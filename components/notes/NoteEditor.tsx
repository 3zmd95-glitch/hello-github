"use client";

import Link from "next/link";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useGameActions } from "@/components/celebrate/useGameActions";
import { useSkillSheet } from "@/components/skills/SkillSheetProvider";
import { getProgram, skills } from "@/data";
import type { Skill } from "@/lib/domain";
import { useT } from "@/lib/i18n";
import { mapIslandHref } from "@/lib/mapLayout";
import { backlinks, noteFileName, noteTemplate, notesHash, wordCount } from "@/lib/notes";
import { questXp } from "@/lib/xp";
import { isQuestDone, useStore } from "@/store";
import NoteMarkdown from "./NoteMarkdown";
import NoteTextarea from "./NoteTextarea";

type Mode = "write" | "live" | "read";
const MODES: readonly Mode[] = ["write", "live", "read"];
const SAVE_DELAY_MS = 400;

/**
 * One skill's note: the Research brief on top, Write / Live / Read tabs (Markdown textarea with [[ suggestions and
 * images; Live shows the formatted note next to it (under it on phones) while typing; Read is the formatted note),
 * autosave, the Research tick, a .md download for Obsidian or anywhere else, and "Linked from" (backlinks).
 * Keyed by skill id by the screen, so switching notes remounts it and flushes the pending save.
 */
export default function NoteEditor({ skill, onBack }: { skill: Skill; onBack: () => void }) {
  const { t, L, lang } = useT();
  const stored = useStore((s) => s.notes[skill.id]?.body ?? "");
  const notes = useStore((s) => s.notes);
  const researchDone = useStore((s) => isQuestDone(s, skill.id, "research"));
  const { completeQuest } = useGameActions();
  const sheet = useSkillSheet();

  const [text, setText] = useState(stored);
  const [mode, setMode] = useState<Mode>(stored.trim() ? "read" : "live");
  const [dirty, setDirty] = useState(false);
  const pending = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (pending.current !== null) {
      useStore.getState().setNote(skill.id, pending.current);
      pending.current = null;
      setDirty(false);
    }
  };
  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  });
  // Save what is left when the note closes or another opens.
  useEffect(() => () => flushRef.current(), []);

  const edit = (value: string) => {
    setText(value);
    setDirty(true);
    pending.current = value;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => flushRef.current(), SAVE_DELAY_MS);
  };

  const program = getProgram(skill.programId);
  const section = program?.sections.find((s) => s.id === skill.sectionId);
  const words = wordCount(text);
  // The live preview may lag a keystroke behind on long notes; typing never waits for it.
  const preview = useDeferredValue(text);
  const linked = useMemo(() => backlinks(skill.id, notes, skills), [notes, skill.id]);

  const download = () => {
    flush();
    const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = noteFileName(skill, lang);
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <article
      className="flex min-w-0 flex-col gap-3"
      data-testid="note-editor"
      data-skill={skill.id}
    >
      <button
        type="button"
        onClick={onBack}
        className="px-btn px-btn-ghost px-btn-sm self-start md:hidden"
        data-testid="note-back"
      >
        <span aria-hidden className="rtl:rotate-180">
          ‹
        </span>{" "}
        {t("notes.back")}
      </button>

      <header className="flex flex-col gap-1">
        <p className="text-muted flex flex-wrap items-center gap-x-2 text-xs">
          <span>
            {program ? `${program.icon} ${L(program.name)}` : ""}
            {section ? ` › ${L(section.name)}` : ""}
          </span>
          {program && (
            <Link
              href={mapIslandHref(program.id)}
              className="px-link"
              onClick={flush}
              data-testid="note-map-link"
            >
              {t("notes.onMap")}
            </Link>
          )}
        </p>
        <h2 className="text-xl" data-testid="note-title">
          {L(skill.name)}
        </h2>
      </header>

      <section className="border-sky bg-panel-2 flex flex-col gap-2 rounded-[2px] border-[3px] p-3">
        <b className="text-sm">{t("notes.brief")}</b>
        <p className="text-ink-2 text-sm">{L(skill.quests.research)}</p>
        <div className="flex flex-wrap items-center gap-2">
          {researchDone ? (
            <span className="px-chip px-chip-green" data-testid="note-research-done">
              {t("notes.ticked")}
            </span>
          ) : (
            <button
              type="button"
              className="px-btn px-btn-gold px-btn-sm"
              disabled={words === 0}
              title={words === 0 ? t("notes.tickHint") : undefined}
              onClick={() => {
                flush();
                completeQuest(skill.id, "research");
              }}
              data-testid="note-tick-research"
            >
              {t("notes.tick", { xp: questXp("research", skill.tier) })}
            </button>
          )}
          <button
            type="button"
            className="px-btn px-btn-ghost px-btn-sm"
            onClick={() => {
              flush();
              sheet.open(skill.id);
            }}
            data-testid="note-open-skill"
          >
            {t("notes.openSkill")}
          </button>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <div className="cal-tabs" role="tablist">
          {MODES.map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              className="cal-tab"
              aria-selected={mode === m}
              onClick={() => {
                flush();
                setMode(m);
              }}
              data-testid={`note-tab-${m}`}
            >
              {t(`notes.${m}`)}
            </button>
          ))}
        </div>
        <span className="text-muted num text-xs" data-testid="note-words">
          {t("notes.words", { n: words })}
        </span>
        <span className="text-muted text-xs" aria-live="polite" data-testid="note-status">
          {text || stored ? t(dirty ? "notes.saving" : "notes.saved") : ""}
        </span>
        <button
          type="button"
          className="px-btn px-btn-ghost px-btn-sm ms-auto"
          onClick={download}
          disabled={!text.trim()}
          data-testid="note-download"
        >
          {t("notes.download")}
        </button>
      </div>

      <div role="tabpanel">
        {mode !== "read" ? (
          <div className={mode === "live" ? "grid gap-3 lg:grid-cols-2" : ""}>
            <NoteTextarea
              value={text}
              onChange={edit}
              onFlush={flush}
              ariaLabel={t("notes.editorLabel", { name: L(skill.name) })}
              onTemplate={() => edit(noteTemplate(skill, lang))}
              className={mode === "live" ? "note-live-editor" : ""}
            />
            {mode === "live" && (
              <div className="px-inset note-live-preview" data-testid="note-live">
                {preview.trim() ? (
                  <NoteMarkdown body={preview} />
                ) : (
                  <p className="text-muted text-sm">{t("notes.livePh")}</p>
                )}
              </div>
            )}
          </div>
        ) : text.trim() ? (
          <div className="px-inset">
            <NoteMarkdown body={text} />
          </div>
        ) : (
          <p className="px-inset text-ink-2 text-sm">{t("notes.emptyRead")}</p>
        )}
      </div>

      <section className="flex flex-col gap-2" data-testid="note-backlinks">
        <h3 className="text-base">{t("notes.backlinks")}</h3>
        {linked.length === 0 ? (
          <p className="text-muted text-sm">{t("notes.backlinksNone", { name: L(skill.name) })}</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {linked.map((id) => {
              const s = skills.find((x) => x.id === id);
              return (
                <li key={id}>
                  <a
                    href={notesHash(id)}
                    className="px-chip no-underline"
                    data-testid="note-backlink"
                  >
                    📝 {s ? L(s.name) : id}
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </article>
  );
}
