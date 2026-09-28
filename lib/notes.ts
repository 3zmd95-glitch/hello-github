import type { Lang, LText, Note, Pillar, Program, Section, Skill } from "./domain";

/**
 * 📝 Notes: one Markdown note per skill, kept in the store and browsed as a vault grouped like the skill tree
 * (pillar → program → section → skill). Obsidian-style `[[Skill name]]` links point at other skills' notes and
 * give each note its "Linked from" list. Everything here is pure so screens and tests share it.
 */

/* ---------- The vault tree (same branches as the skill tree and the map's islands) ---------- */

export interface VaultBranch {
  program: Program;
  sections: { section: Section; skillIds: string[] }[];
}
export interface VaultPillar {
  pillar: Pillar;
  programs: VaultBranch[];
}

/**
 * Pillar → program (island) → section (region) → skill ids, built from the same data the Skills screen and the
 * map read, so a skill added to the data shows up here with no extra step. Pillars in `order`, programs and
 * sections in data order, skills in data order. Empty programs and pillars are left out; `keep` filters skills
 * (e.g. "only notes I wrote").
 */
export function vaultTree(
  pillars: readonly Pillar[],
  programs: readonly Program[],
  skills: readonly Skill[],
  keep: (skill: Skill) => boolean = () => true,
): VaultPillar[] {
  return [...pillars]
    .sort((a, b) => a.order - b.order)
    .map((pillar) => ({
      pillar,
      programs: programs
        .filter((p) => p.pillarId === pillar.id)
        .map((program) => ({
          program,
          sections: program.sections
            .map((section) => ({
              section,
              skillIds: skills
                .filter((s) => s.programId === program.id && s.sectionId === section.id && keep(s))
                .map((s) => s.id),
            }))
            .filter((g) => g.skillIds.length > 0),
        }))
        .filter((b) => b.sections.length > 0),
    }))
    .filter((g) => g.programs.length > 0);
}

/** Deep link into the vault: `/notes/#skill=<id>` opens that skill's note. */
export function notesHref(skillId?: string): string {
  return skillId ? `/notes/${notesHash(skillId)}` : "/notes/";
}

export function notesHash(skillId: string): string {
  return `#skill=${encodeURIComponent(skillId)}`;
}

/** The skill id in a `#skill=<id>` hash, or null. */
export function parseNotesHash(hash: string): string | null {
  const m = /^#?skill=([^&]+)/.exec(hash);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]) || null;
  } catch {
    return null;
  }
}

/** Words in a note (Arabic and Latin alike: runs of non-space characters that hold a letter or digit). */
export function wordCount(body: string): number {
  return body.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/** Starter note for a skill: the Research quest as the brief, then headings to fill in. */
export function noteTemplate(skill: Pick<Skill, "name" | "quests">, lang: Lang): string {
  const L = (x: LText) => x[lang] || x.ar;
  const h =
    lang === "ar"
      ? ["إيش هي؟", "متى أستخدمها ومتى لا", "أهم الخطوات", "مصادر", "روابط"]
      : ["What it is", "When to use it, and when not", "Key steps", "Sources", "Links"];
  return [
    `# ${L(skill.name)}`,
    "",
    `> ${L(skill.quests.research)}`,
    "",
    `## ${h[0]}`,
    "",
    "",
    `## ${h[1]}`,
    "",
    "",
    `## ${h[2]}`,
    "",
    "- ",
    "",
    `## ${h[3]}`,
    "",
    "- ",
    "",
    `## ${h[4]}`,
    "",
    "- [[ ]]",
    "",
  ].join("\n");
}

/* ---------- [[Wiki links]] ---------- */

export interface WikiLink {
  /** What is inside the brackets before any `|`. */
  target: string;
  /** Text to show: the part after `|`, else the target. */
  label: string;
}

const WIKI_RE = /\[\[([^[\]\n|]+?)(?:\|([^[\]\n]+?))?\]\]/g;
/** Fenced code blocks and inline code spans: links inside them stay literal. */
const CODE_RE = /(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g;

/** Split into [text, code, text, code, …] so link handling skips code. */
function outsideCode(body: string, fn: (text: string) => string): string {
  return body
    .split(CODE_RE)
    .map((part, i) => (i % 2 === 1 ? part : fn(part)))
    .join("");
}

const norm = (s: string) => s.trim().toLocaleLowerCase().replace(/\s+/g, " ");

/** Every `[[link]]` in a note, in order (code excluded, blank targets skipped). */
export function wikiLinks(body: string): WikiLink[] {
  const out: WikiLink[] = [];
  outsideCode(body, (text) => {
    for (const m of text.matchAll(WIKI_RE)) {
      const target = m[1].trim();
      if (target) out.push({ target, label: (m[2] ?? m[1]).trim() });
    }
    return text;
  });
  return out;
}

/** The skill a link target names: its id, or its Arabic or English name (case and spacing ignored). */
export function resolveWikiLink(
  target: string,
  skills: readonly Pick<Skill, "id" | "name">[],
): string | null {
  const t = norm(target);
  if (!t) return null;
  const hit = skills.find((s) => s.id === t || norm(s.name.ar) === t || norm(s.name.en) === t);
  return hit?.id ?? null;
}

/** Marker href for a link to no known skill: the renderer shows it muted, not as a link. */
export const MISSING_LINK = "#missing";

/**
 * Rewrite `[[links]]` into Markdown links the renderer understands: known skills become `[label](#skill=<id>)`,
 * unknown ones `[label](#missing)`. Code is left alone.
 */
export function linkifyWikiLinks(
  body: string,
  skills: readonly Pick<Skill, "id" | "name">[],
): string {
  return outsideCode(body, (text) =>
    text.replace(WIKI_RE, (whole, rawTarget: string, rawLabel?: string) => {
      const target = rawTarget.trim();
      if (!target) return whole;
      const label = (rawLabel ?? rawTarget).trim().replace(/[[\]]/g, "");
      const id = resolveWikiLink(target, skills);
      return `[${label}](${id ? notesHash(id) : MISSING_LINK})`;
    }),
  );
}

/** Skill ids whose notes link to `skillId`, in skill order (a note linking itself does not count). */
export function backlinks(
  skillId: string,
  notes: Readonly<Record<string, Note>>,
  skills: readonly Pick<Skill, "id" | "name">[],
): string[] {
  return skills
    .filter((s) => s.id !== skillId && notes[s.id])
    .filter((s) =>
      wikiLinks(notes[s.id].body).some((l) => resolveWikiLink(l.target, skills) === skillId),
    )
    .map((s) => s.id);
}

/* ---------- Search ---------- */

export interface NoteHit {
  skillId: string;
  /** A short excerpt around the first match in the note body, or null when only the name matched. */
  excerpt: string | null;
}

/**
 * Skills whose name (either language) or note text holds `query` (case-insensitive), in skill order.
 * Name matches come first; the excerpt is up to ~80 characters around the first body match.
 */
export function searchNotes(
  query: string,
  notes: Readonly<Record<string, Note>>,
  skills: readonly Pick<Skill, "id" | "name">[],
): NoteHit[] {
  const q = norm(query);
  if (!q) return [];
  const byName: NoteHit[] = [];
  const byBody: NoteHit[] = [];
  for (const s of skills) {
    const body = notes[s.id]?.body ?? "";
    const at = body.toLocaleLowerCase().indexOf(q);
    const excerpt = at < 0 ? null : snippet(body, at, q.length);
    if (norm(s.name.ar).includes(q) || norm(s.name.en).includes(q) || s.id.includes(q))
      byName.push({ skillId: s.id, excerpt });
    else if (excerpt) byBody.push({ skillId: s.id, excerpt });
  }
  return [...byName, ...byBody];
}

function snippet(body: string, at: number, len: number): string {
  const start = Math.max(0, at - 30);
  const end = Math.min(body.length, at + len + 50);
  const text = body.slice(start, end).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${text}${end < body.length ? "…" : ""}`;
}

/** A safe file name for downloading a note as Markdown. */
export function noteFileName(skill: Pick<Skill, "id" | "name">, lang: Lang): string {
  const name = (skill.name[lang] || skill.name.en || skill.id)
    .replace(/[\\/:*?"<>|#^[\]]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `${name || skill.id}.md`;
}
