/**
 * The editing dictionary (round 33, planning/tools/13-discover-search-v2.md): `planning/data/edit-terms.json`
 * is bundled at build like genres.json (`../trends/json.d.ts` types it for tsc) and checked by hand here (the
 * Worker has no zod). `matchTerms` compares whole words in the Discover matching form (`normalizeTerm`).
 */

import raw from "../../../../planning/data/edit-terms.json";
import { normalizeForMatch } from "../social/normalization";

export type Lang = "ar" | "en";
export interface LangText {
  ar: string;
  en: string;
}
export type TermKind =
  "transition" | "effect" | "color" | "audio" | "technique" | "style" | "photo";
const KINDS: readonly TermKind[] = [
  "transition",
  "effect",
  "color",
  "audio",
  "technique",
  "style",
  "photo",
];

export interface EditTerm {
  /** `^[a-z][a-z0-9-]*$`, unique in the file. */
  id: string;
  kind: TermKind;
  label: LangText;
  /** What the owner may type, per language (at least one word in one of them). */
  match: { ar: string[]; en: string[] };
  /** false: a card also needs an editing word to count as on-topic (the word alone means other things). */
  specific: boolean;
  /** true: a catch-all ("transitions") that is `best` only when no other entry matched. */
  generic?: boolean;
  queries: { examples: LangText; tutorials: LangText };
}

const ID_RE = /^[a-z][a-z0-9-]*$/;
const isText = (x: unknown): x is string => typeof x === "string" && x.trim().length > 0;
const isLangText = (x: unknown): x is LangText =>
  !!x && typeof x === "object" && isText((x as LangText).ar) && isText((x as LangText).en);
const words = (x: unknown): string[] | null =>
  Array.isArray(x) && x.every(isText) ? (x as string[]).map((w) => w.trim()) : null;

function parseTerm(x: unknown): EditTerm | null {
  if (!x || typeof x !== "object") return null;
  const t = x as Record<string, unknown>;
  if (typeof t.id !== "string" || !ID_RE.test(t.id)) return null;
  if (!KINDS.includes(t.kind as TermKind)) return null;
  if (!isLangText(t.label) || typeof t.specific !== "boolean") return null;
  const m = t.match as Record<string, unknown> | undefined;
  const ar = words(m?.ar);
  const en = words(m?.en);
  if (!ar || !en || ar.length + en.length === 0) return null;
  const q = t.queries as Record<string, unknown> | undefined;
  if (!isLangText(q?.examples) || !isLangText(q?.tutorials)) return null;
  return {
    id: t.id,
    kind: t.kind as TermKind,
    label: { ar: (t.label as LangText).ar, en: (t.label as LangText).en },
    match: { ar, en },
    specific: t.specific,
    ...(typeof t.generic === "boolean" ? { generic: t.generic } : {}),
    queries: { examples: q.examples as LangText, tutorials: q.tutorials as LangText },
  };
}

/** Every well-formed entry of a dictionary file, in file order; a repeated id keeps the first. */
export function parseTerms(file: unknown): EditTerm[] {
  if (!Array.isArray(file)) return [];
  const seen = new Set<string>();
  const out: EditTerm[] = [];
  for (const x of file) {
    const t = parseTerm(x);
    if (!t || seen.has(t.id)) continue;
    seen.add(t.id);
    out.push(t);
  }
  return out;
}

export const TERMS: readonly EditTerm[] = parseTerms(raw);

const ARTICLE = /^ال[ء-ي]{2,}$/;
const EN_PLURAL = /^[a-z0-9]{4,}s$/;
const AR_PLURAL = /^[ء-ي]{3,}ات$/;
// Common editing/genre nouns shorter than the conservative plural rule below.
// Keep words such as "lens", "news" and "gas" intact.
const SHORT_PLURALS: Record<string, string> = {
  cars: "car",
  cuts: "cut",
  gyms: "gym",
  ads: "ad",
  amvs: "amv",
};

function stem(word: string): string {
  const w = ARTICLE.test(word) ? word.slice(2) : word;
  if (Object.hasOwn(SHORT_PLURALS, w)) return SHORT_PLURALS[w];
  if (EN_PLURAL.test(w) && !w.endsWith("ss")) return w.slice(0, -1);
  return AR_PLURAL.test(w) ? w.slice(0, -2) : w;
}

/**
 * The Discover matching form, used on both sides (what the owner typed and the synonyms): `normalizeForMatch`,
 * then ة as ه and, per word, a leading "ال" and a plural "s" / "ات" dropped, so Hijazi spellings ("الشاشه"),
 * the article ("التلوين") and plurals ("transitions", "انتقالات") still match. /social keeps `normalizeForMatch`.
 */
export function normalizeTerm(text: string): string {
  return normalizeForMatch(text).replace(/ة/g, "ه").split(" ").map(stem).join(" ");
}

/** An entry's synonyms in matching form, as word lists. */
const synonymForms = (t: EditTerm): string[][] =>
  [...t.match.en, ...t.match.ar].map((w) => normalizeTerm(w).split(" ")).filter((ws) => ws[0]);

/** The bundled entries' synonym forms, worked out once at load (other term lists are worked out per call). */
const BUNDLED_FORMS = new Map<EditTerm, string[][]>(TERMS.map((t) => [t, synonymForms(t)]));

/**
 * Words that say what kind of result is wanted, not what about, and filler words: dropped from the topic (the
 * plan asks for examples and tutorials anyway). Matching forms (`normalizeTerm`).
 */
export const INTENT_WORDS: ReadonlySet<string> = new Set(
  normalizeTerm(
    "edit edits editing video videos tutorial tutorials how to guide reel reels tiktok instagram youtube " +
      "شرح طريقة كيف ايديت مونتاج فيديو تعليم درس تعلم " +
      // Fillers.
      "for the with in on of a an and my me ابغى ابي ابغا اسوي عن في حق على من",
  ).split(" "),
);

export interface TermMatch {
  /** The entry whose matched synonym is longest (ties: file order); a generic one only when nothing else matched. */
  best?: EditTerm;
  /** Other entries that matched (other meanings), file order, at most 3. */
  others: EditTerm[];
  /**
   * The typed words the best synonym did not cover, minus intent and filler words, as typed (`normalizeForMatch`,
   * not the matching form). With no match and only such words typed: all the typed words.
   */
  rest: string[];
}

/** Where `run` starts as consecutive words of `list`, or -1. */
function findRun(list: readonly string[], run: readonly string[]): number {
  for (let i = 0; i + run.length <= list.length; i++) {
    if (run.every((w, j) => list[i + j] === w)) return i;
  }
  return -1;
}

interface Hit {
  term: EditTerm;
  /** The matched synonym's first word in the query, its word count and its length (matching form). */
  at: number;
  count: number;
  size: number;
}

export function matchTerms(q: string, terms: readonly EditTerm[] = TERMS): TermMatch {
  const typed = normalizeForMatch(q).split(" ").filter(Boolean);
  const forms = typed.map(normalizeTerm);
  const hits: Hit[] = [];
  for (const term of terms) {
    let hit: Hit | undefined;
    for (const syn of BUNDLED_FORMS.get(term) ?? synonymForms(term)) {
      const at = findRun(forms, syn);
      const size = syn.join(" ").length;
      if (at >= 0 && size > (hit?.size ?? 0)) hit = { term, at, count: syn.length, size };
    }
    if (hit) hits.push(hit);
  }
  const pool = hits.some((h) => !h.term.generic) ? hits.filter((h) => !h.term.generic) : hits;
  const best = pool.reduce<Hit | undefined>((b, h) => (b && b.size >= h.size ? b : h), undefined);
  const covered = (i: number) => !!best && i >= best.at && i < best.at + best.count;
  const kept = typed.filter((_, i) => !covered(i) && !INTENT_WORDS.has(forms[i]));
  return {
    best: best?.term,
    others: hits
      .filter((h) => h !== best)
      .slice(0, 3)
      .map((h) => h.term),
    rest: best || kept.length ? kept : typed,
  };
}
