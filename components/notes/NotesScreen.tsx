"use client";

import { useEffect, useMemo, useState } from "react";
import { getSkill, pillars, programs, skills } from "@/data";
import type { Note } from "@/lib/domain";
import { useT } from "@/lib/i18n";
import {
  notesHash,
  parseNotesHash,
  searchNotes,
  vaultTree,
  wordCount,
  type VaultBranch,
} from "@/lib/notes";
import { useStore } from "@/store";
import NoteEditor from "./NoteEditor";
import NoteGraph from "./NoteGraph";

type View = "tree" | "graph";
const VIEWS: readonly View[] = ["tree", "graph"];

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
 * sets the hash, so the phone's back button returns to the tree. The 🕸️ Graph view shows the same notes as an
 * Obsidian-style graph around their islands; tapping a dot opens that note back in the tree view.
 */
export default function NotesScreen() {
  const { t } = useT();
  const notes = useStore((s) => s.notes);
  const [openId, setOpenId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [onlyWritten, setOnlyWritten] = useState(false);
  const [view, setView] = useState<View>("tree");
  const [graphAll, setGraphAll] = useState(false);

  useEffect(() => {
    const apply = () => {
      const id = parseNotesHash(window.location.hash);
      if (id && getSkill(id)) {
        setOpenId(id);
        setView("tree");
        window.scrollTo({ top: 0 });
      } else {
        setOpenId(null);
        if (id) clearHash();
      }
    };
    apply();
    // An in-app link (Next <Link>) can mount this page before it writes the new URL, and that write fires no
    // hashchange: read again once the navigation has settled.
    const settle = setTimeout(apply, 0);
    window.addEventListener("hashchange", apply);
    return () => {
      clearTimeout(settle);
      window.removeEventListener("hashchange", apply);
    };
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

      <div className="cal-tabs self-start" role="tablist" aria-label={t("notes.viewLabel")}>
        {VIEWS.map((v) => (
          <button
            key={v}
            type="button"
            role="tab"
            className="cal-tab"
            aria-selected={view === v}
            onClick={() => {
              if (v === "graph") back();
              setView(v);
            }}
            data-testid={`notes-view-${v}`}
          >
            {t(v === "tree" ? "notes.viewTree" : "notes.viewGraph")}
          </button>
        ))}
      </div>

      {view === "graph" ? (
        <section className="px-card flex min-w-0 flex-col gap-3" data-testid="notes-graph-view">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-ink-2 min-w-0 flex-1 text-sm">{t("notes.graphHint")}</p>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={graphAll}
                onChange={(e) => setGraphAll(e.target.checked)}
                data-testid="notes-graph-all"
              />
              {t("notes.graphAll")}
            </label>
          </div>
          <NoteGraph allSkills={graphAll} />
        </section>
      ) : (
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
      )}
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

/** Pillar → program (island) → section (region) → skills: the same branches as the skill tree and the map. */
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
  const groups = useMemo(
    () => vaultTree(pillars, programs, skills, (s) => !onlyWritten || !!notes[s.id]),
    [notes, onlyWritten],
  );

  if (groups.length === 0) return <p className="text-muted text-sm">{t("notes.noneYet")}</p>;

  return (
    <div className="flex flex-col gap-3">
      {groups.map(({ pillar, programs: branches }) => (
        <section
          key={pillar.id}
          className="flex flex-col gap-1"
          data-testid="notes-pillar"
          data-pillar={pillar.id}
        >
          <h2 className="text-muted text-xs font-bold tracking-wide">
            {pillar.icon} {L(pillar.name)}
          </h2>
          {branches.map((branch) => (
            <ProgramBranch
              key={branch.program.id}
              branch={branch}
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
  branch: { program, sections },
  notes,
  openId,
  forceOpen,
}: {
  branch: VaultBranch;
  notes: Record<string, Note>;
  openId: string | null;
  forceOpen: boolean;
}) {
  const { L } = useT();
  const list = sections.flatMap((g) => g.skillIds);
  const holdsOpen = !!openId && list.includes(openId);
  const [expanded, setExpanded] = useState(holdsOpen);
  // Opening a note from a deep link or a [[link]] unfolds its branch.
  const [seen, setSeen] = useState(openId);
  if (seen !== openId) {
    setSeen(openId);
    if (holdsOpen && !expanded) setExpanded(true);
  }
  const count = list.filter((id) => notes[id]).length;

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
        {sections.map(({ section, skillIds }) => (
          <div key={section.id} className="flex flex-col gap-0.5" data-section={section.id}>
            {sections.length > 1 && <span className="text-muted text-xs">{L(section.name)}</span>}
            <ul className="flex flex-col gap-0.5">
              {skillIds.map((id) => (
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
