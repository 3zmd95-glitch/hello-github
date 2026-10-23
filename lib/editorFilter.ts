import { NATIVE_EDITOR_SCOPES, NATIVE_SEARCH_SCOPE } from "./discoverNativeSearch";

/**
 * Owner rule (14 Oct): he edits in DaVinci Resolve and CapCut (mobile) only, so Discover shows only those
 * two by default ("mine") and hides content about every other editing app. Pure text matching, no
 * ranking: callers drop the matches and say how many were hidden. A card naming DaVinci/CapCut stays,
 * even beside another app ("CapCut vs After Effects"); a card naming no app stays.
 */
export type EditorScope = "mine" | "all";

export const OTHER_EDITORS = [
  "after effects",
  "premiere pro",
  "final cut pro",
  "alight motion",
  "vn editor",
  "filmora",
  "inshot",
  "kinemaster",
  "vegas pro",
  "powerdirector",
  "lumafusion",
  "splice",
] as const;

const NONE: readonly string[] = [];

/** The editors a scope hides (stable arrays, safe as store selector results). */
export const hiddenEditorsFor = (scope: EditorScope): readonly string[] =>
  scope === "mine" ? OTHER_EDITORS : NONE;

const MY_EDITORS = /davinci|cap\s*cut/;

// Common spellings, hashtags and short forms; plain words ("premiere", "splice") only with an app cue.
const PATTERNS: Record<string, RegExp[]> = {
  "after effects": [
    /after\s*effects/,
    /#?aftereffects\b/,
    /\bae\s+(tutorial|template|edit|preset|project)/,
  ],
  "premiere pro": [/\bpremiere\s*pro\b/, /\badobe\s+premiere\b/],
  "final cut pro": [/\bfinal\s*cut(\s*pro)?\b/, /\bfcpx\b/],
  "alight motion": [/\balight\s*motion\b/],
  "vn editor": [/\bvn\s*(video\s*)?editor\b/, /\bvn\s+app\b/],
  filmora: [/\bfilmora\b/],
  inshot: [/\binshot\b/],
  kinemaster: [/\bkine\s*master\b/],
  "vegas pro": [/\bvegas\s*pro\b/],
  powerdirector: [/\bpower\s*director\b/],
  lumafusion: [/\bluma\s*fusion\b/],
  splice: [/#splice(app)?\b/, /\bsplice\s+(app|editor|video\s*editor)\b/],
};

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function patternsFor(editor: string): RegExp[] {
  const name = editor.trim().toLowerCase().replace(/\s+/g, " ");
  if (PATTERNS[name]) return PATTERNS[name];
  if (!name) return [];
  return [new RegExp(`\\b${escapeRegExp(name).replace(/ /g, "\\s+")}\\b`)];
}

type Mentioning = { title?: string; snippet?: string; handle?: string; hashtags?: string[] };

/** The hidden editor the item talks about (as listed in `hidden`), or null. DaVinci/CapCut cards stay. */
export function mentionsHiddenEditor(item: Mentioning, hidden: readonly string[]): string | null {
  if (!hidden.length) return null;
  const text = [item.title, item.snippet, item.handle, ...(item.hashtags ?? [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (MY_EDITORS.test(text)) return null;
  return hidden.find((editor) => patternsFor(editor).some((re) => re.test(text))) ?? null;
}

/** The other editing app a card is about, or null. */
export const namesOtherEditor = (item: Mentioning): string | null =>
  mentionsHiddenEditor(item, OTHER_EDITORS);

/** Splits off the items that talk about a hidden editor; the rest keep their order. */
export function dropHiddenEditors<T extends Mentioning>(
  items: readonly T[],
  hidden: readonly string[],
): { items: readonly T[]; count: number; editors: string[] } {
  if (!hidden.length) return { items, count: 0, editors: [] };
  const editors = new Set<string>();
  const kept = items.filter((item) => {
    const editor = mentionsHiddenEditor(item, hidden);
    if (editor) editors.add(editor);
    return !editor;
  });
  return kept.length === items.length
    ? { items, count: 0, editors: [] }
    : { items: kept, count: items.length - kept.length, editors: [...editors] };
}

/** "after effects" -> "After Effects". */
export const editorLabel = (editor: string): string =>
  editor.replace(/\b\p{L}/gu, (c) => c.toUpperCase());

export interface EditorSearch {
  /** The native cache slot / synthetic genre id. */
  scope: string;
  query: string;
  /** Instagram only, when it differs: its keyword search finds nothing for "… davinci resolve". */
  igQuery?: string;
  heading?: string;
}

/** The DaVinci section's query, plus Instagram's: "davinci resolve" -> "davinci", spaces collapsed. */
function davinciSearch(query: string): Pick<EditorSearch, "query" | "igQuery"> {
  const igQuery = query
    .replace(/(davinci)\s+resolve\b/gi, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return igQuery === query ? { query } : { query, igQuery };
}

/** The Search tab's native searches for typed text: CapCut then DaVinci Resolve under "mine" (only the
 * one the text already names), today's single plain search under "all". */
export function editorSearches(text: string, scope: EditorScope): EditorSearch[] {
  const query = text.trim();
  if (scope === "all" || !query) return [{ scope: NATIVE_SEARCH_SCOPE, query }];
  const capcut = { scope: NATIVE_EDITOR_SCOPES.capcut, heading: "CapCut" };
  const davinci = { scope: NATIVE_EDITOR_SCOPES.davinci, heading: "DaVinci Resolve" };
  const lower = query.toLowerCase();
  if (/cap\s*cut/.test(lower)) return [{ ...capcut, query }];
  if (/davinci|\bresolve\b/.test(lower)) return [{ ...davinci, ...davinciSearch(query) }];
  return [
    { ...capcut, query: `${query} capcut` },
    { ...davinci, ...davinciSearch(`${query} davinci resolve`) },
  ];
}
