/**
 * The editing dictionary (round 33, planning/tools/13-discover-search-v2.md): `planning/data/edit-terms.json`
 * is bundled at build like genres.json (`../trends/json.d.ts` types it for tsc) and checked by hand here (the
 * Worker has no zod). `matchTerms` reads what the owner typed with the auto-replies rules (case, Arabic
 * diacritics / tatweel / alef / yaa forms, punctuation do not matter) and whole words only.
 */

import raw from "../../../../planning/data/edit-terms.json";
import { normalizeForMatch } from "../social/replies";

export type Lang = "ar" | "en";
export interface LangText {
  ar: string;
  en: string;
}
export type TermKind = "transition" | "effect" | "color" | "audio" | "technique" | "style" | "photo";
const KINDS: readonly TermKind[] = ["transition", "effect", "color", "audio", "technique", "style", "photo"];

export interface EditTerm {
  /** `^[a-z][a-z0-9-]*$`, unique in the file. */
  id: string;
  kind: TermKind;
  label: LangText;
  /** What the owner may type, per language (at least one word in one of them). */
  match: { ar: string[]; en: string[] };
  /** false: a card also needs an editing word to count as on-topic (the word alone means other things). */
  specific: boolean;
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

/**
 * Words that say what kind of result is wanted, not what about: dropped from the topic (the plan asks for
 * examples and tutorials anyway). Normalized forms (`normalizeForMatch`).
 */
export const INTENT_WORDS: ReadonlySet<string> = new Set([
  "edit", "edits", "editing", "video", "videos", "tutorial", "tutorials", "how", "to", "guide", "reel", "reels",
  "tiktok", "instagram", "youtube", "شرح", "طريقة", "كيف", "ايديت", "مونتاج", "فيديو", "تعليم", "درس", "تعلم",
]);

export interface TermMatch {
  /** The entry whose matched synonym is longest (ties: file order). */
  best?: EditTerm;
  /** Other entries that matched (other meanings), file order, at most 3. */
  others: EditTerm[];
  /** The typed words left once the best synonym and the intent words are taken out (normalized). */
  rest: string[];
}

const has = (q: string, phrase: string) => !!phrase && ` ${q} `.includes(` ${phrase} `);

export function matchTerms(q: string, terms: readonly EditTerm[] = TERMS): TermMatch {
  const nq = normalizeForMatch(q);
  let best: EditTerm | undefined;
  let bestPhrase = "";
  const matched: EditTerm[] = [];
  for (const term of terms) {
    let longest = "";
    for (const w of [...term.match.en, ...term.match.ar]) {
      const n = normalizeForMatch(w);
      if (has(nq, n) && n.length > longest.length) longest = n;
    }
    if (!longest) continue;
    matched.push(term);
    if (longest.length > bestPhrase.length) {
      best = term;
      bestPhrase = longest;
    }
  }
  const left = best ? ` ${nq} `.replace(` ${bestPhrase} `, " ") : nq;
  const all = left.split(" ").filter(Boolean);
  const kept = all.filter((w) => !INTENT_WORDS.has(w));
  const rest = best ? kept : kept.length ? kept : all;
  return { best, others: matched.filter((t) => t !== best).slice(0, 3), rest };
}
