"use client";

import { useEffect, useMemo, useState } from "react";
import { getSkill, pillars, programsByPillar, skills, skillsByProgram } from "@/data";
import type { Note, Program } from "@/lib/domain";
import { useT } from "@/lib/i18n";
import { notesHash, parseNotesHash, searchNotes, wordCount } from "@/lib/notes";
import { useStore } from "@/store";
import NoteEditor from "./NoteEditor";

/** Drop the note hash without a navigation (static export: no router push). */
function clearHash(): void {
  if (window.location.hash) {
    history.replaceState(null, "", window.location.pathname + window.location.search);
  }
}

/**
 * 📝 Notes vault: the in-app replacement for the external Obsidian step. One Markdown note per skill, listed
 * like the skill tree (pillar → program → section → skill) with search across names and note text. Deep link
 * `#skill=<id>` opens a note (the skill popup's Research row and `[[links]]` inside notes use it); opening
 * sets the hash, so the phone's back button returns to the tree.
 */
export default function NotesScreen() {
  const { t } = useT();
  const notes = useStore((s) => s.notes);
  const [openId, setOpenId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [onlyWritten, setOnlyWritten] = useState(false);

  useEffect(() => {
    const apply = () => {
      const id = parseNotesHash(window.location.hash);
      if (id && getSkill(id)) {
        setOpenId(id);
        window.scrollTo({ top: 0 });
      } else {
        setOpenId(null);
        if (id) clearHash();
      }
    };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, []);

  const back = () => {
    clearHash();
    setOpenId(null);
  };
  const open = openId ? getSkill(openId) : undefined;
  const written = Object.keys(notes).length;

  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl">{t("notes.title")}</h1>
        <p className="text-ink-2 text-sm">{t("notes.sub")}</p>
      </header>

      <div className="grid gap-4 md:grid-cols-[minmax(240px,300px)_minmax(0,1fr)] md:items-start">
        <nav
          aria-label={t("notes.vault")}
          className={`px-card flex min-w-0 flex-col gap-3 ${open ? "max-md:hidden" : ""}`}
          data-testid="notes-vault"
        >
          <input
            type="search"
            className="px-input"
            placeholder={t("notes.search")}
            aria-label={t("notes.search")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            data-testid="notes-search"
          />
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={onlyWritten}
                onChange={(e) => setOnlyWritten(e.target.checked)}
                data-testid="notes-only-written"
              />
              {t("notes.onlyWritten")}
            </label>
            <span className="text-muted num text-xs">{t("notes.count", { n: written })}</span>
          </div>
          {query.trim() ? (
            <SearchResults query={query} notes={notes} openId={openId} />
          ) : (
            <Tree notes={notes} openId={openId} onlyWritten={onlyWritten} />
          )}
        </nav>

        <div className={`min-w-0 ${open ? "" : "max-md:hidden"}`}>
          {open ? (
            <div className="px-card">
              <NoteEditor key={open.id} skill={open} onBack={back} />
            </div>
          ) : (
            <p className="px-card text-ink-2 text-sm" data-testid="notes-pick">
              {t("notes.pick")}
            </p>
          )}
        </div>
      </div>
    </>
  );
}

function SkillLink({
  skillId,
  note,
  active,
  extra,
}: {
  skillId: string;
  note: Note | undefined;
  active: boolean;
  extra?: string | null;
}) {
  const { t, L } = useT();
  const skill = getSkill(skillId);
  if (!skill) return null;
  return (
    <a
      href={notesHash(skillId)}
      aria-current={active ? "page" : undefined}
      className={`note-row ${active ? "is-active" : ""}`}
      data-testid="notes-row"
      data-skill={skillId}
      data-has-note={note ? "1" : "0"}
    >
      <span className="flex items-center gap-2">
        <span aria-hidden>{note ? "📝" : "▫️"}</span>
        <span className="min-w-0 flex-1 truncate">{L(skill.name)}</span>
        {note && (
          <span className="text-muted num shrink-0 text-xs">
            {t("notes.words", { n: wordCount(note.body) })}
          </span>
        )}
      </span>
      {extra && <span className="text-muted mt-0.5 block text-xs">{extra}</span>}
    </a>
  );
}

function SearchResults({
  query,
  notes,
  openId,
}: {
  query: string;
  notes: Record<string, Note>;
  openId: string | null;
}) {
  const { t } = useT();
  const hits = useMemo(() => searchNotes(query, notes, skills), [query, notes]);
  if (hits.length === 0) return <p className="text-muted text-sm">{t("notes.noResults")}</p>;
  return (
    <ul className="flex flex-col gap-1" data-testid="notes-results">
      {hits.map((h) => (
        <li key={h.skillId}>
          <SkillLink
            skillId={h.skillId}
            note={notes[h.skillId]}
            active={h.skillId === openId}
            extra={h.excerpt}
          />
        </li>
      ))}
    </ul>
  );
}

/** Pillar → program (collapsible) → section → skills, the same branches as the skill tree. */
function Tree({
  notes,
  openId,
  onlyWritten,
}: {
  notes: Record<string, Note>;
  openId: string | null;
  onlyWritten: boolean;
}) {
  const { t, L } = useT();
  const groups = pillars
    .map((pl) => ({
      pillar: pl,
      programs: programsByPillar(pl.id)
        .map((p) => ({
          program: p,
          skills: (skillsByProgram[p.id] ?? []).filter((s) => !onlyWritten || notes[s.id]),
        }))
        .filter((g) => g.skills.length > 0),
    }))
    .filter((g) => g.programs.length > 0);

  if (groups.length === 0) return <p className="text-muted text-sm">{t("notes.noneYet")}</p>;

  return (
    <div className="flex flex-col gap-3">
      {groups.map(({ pillar, programs }) => (
        <section key={pillar.id} className="flex flex-col gap-1">
          <h2 className="text-muted text-xs font-bold tracking-wide">
            {pillar.icon} {L(pillar.name)}
          </h2>
          {programs.map(({ program, skills: list }) => (
            <ProgramBranch
              key={program.id}
              program={program}
              list={list.map((s) => s.id)}
              notes={notes}
              openId={openId}
              forceOpen={onlyWritten}
            />
          ))}
        </section>
      ))}
    </div>
  );
}

function ProgramBranch({
  program,
  list,
  notes,
  openId,
  forceOpen,
}: {
  program: Program;
  list: string[];
  notes: Record<string, Note>;
  openId: string | null;
  forceOpen: boolean;
}) {
  const { L } = useT();
  const holdsOpen = !!openId && list.includes(openId);
  const [expanded, setExpanded] = useState(holdsOpen);
  // Opening a note from a deep link or a [[link]] unfolds its branch.
  const [seen, setSeen] = useState(openId);
  if (seen !== openId) {
    setSeen(openId);
    if (holdsOpen && !expanded) setExpanded(true);
  }
  const count = list.filter((id) => notes[id]).length;
  const sections = program.sections
    .map((sec) => ({ sec, ids: list.filter((id) => getSkill(id)?.sectionId === sec.id) }))
    .filter((g) => g.ids.length > 0);

  return (
    <details
      open={forceOpen || expanded}
      onToggle={(e) => setExpanded((e.currentTarget as HTMLDetailsElement).open)}
      className="note-branch"
      data-testid="notes-branch"
      data-program={program.id}
    >
      <summary className="flex items-center gap-2 font-bold">
        <span aria-hidden>{program.icon}</span>
        <span className="min-w-0 flex-1 truncate">{L(program.name)}</span>
        {count > 0 && <span className="px-chip num text-xs">{count}</span>}
      </summary>
      <div className="mt-1 flex flex-col gap-2 ps-3">
        {sections.map(({ sec, ids }) => (
          <div key={sec.id} className="flex flex-col gap-0.5">
            {sections.length > 1 && <span className="text-muted text-xs">{L(sec.name)}</span>}
            <ul className="flex flex-col gap-0.5">
              {ids.map((id) => (
                <li key={id}>
                  <SkillLink skillId={id} note={notes[id]} active={id === openId} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </details>
  );
}
