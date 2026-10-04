import genres from "../../../../planning/data/genres.json";
import { CATEGORY_PROFILES } from "./category-profiles";
import { INTENT_WORDS, normalizeTerm, type Lang } from "./terms";
import type { DiscoverRequest } from "./types";

const GENERIC = new Set([
  ...INTENT_WORDS,
  ...normalizeTerm(
    "cinematic b roll تصوير سينمائي اعلان ad commercial film motivation skills",
  ).split(" "),
]);

export const subjectWords = (text: string): string[] =>
  normalizeTerm(text)
    .split(" ")
    .filter((w) => w.length > 1 && !GENERIC.has(w));

/** Recognize a built-in genre from either its selected chip or its standalone search phrase. */
export function selectedGenre(req: DiscoverRequest) {
  const hints = [req.genreQuery?.en, req.genreQuery?.ar].filter((x): x is string => !!x?.trim());
  // Explicit chips, including custom chips, take precedence over category words in the topic.
  const candidates = hints.length ? hints : [req.q];
  return genres.genres.find((g) =>
    [g.name.en, g.name.ar, ...g.queries.en, ...g.queries.ar].some((q) =>
      candidates.some((h) => normalizeTerm(q) === normalizeTerm(h)),
    ),
  );
}

/** A compact category constraint for generated queries, or the owner's custom search wording. */
export function categoryHint(req: DiscoverRequest, lang: Lang): string | undefined {
  const genre = selectedGenre(req);
  return genre ? CATEGORY_PROFILES[genre.id]?.subject[lang] : req.genreQuery?.[lang];
}

/** True only for an exact built-in name/query belonging to the selected category. */
export function isCategoryOnly(req: DiscoverRequest): boolean {
  const genre = selectedGenre(req);
  return !!genre && selectedGenre({ q: req.q })?.id === genre.id;
}

/** Synonyms of the selected built-in genre, or meaningful custom-genre terms. */
export function genreWords(req: DiscoverRequest): string[] {
  const hints = [req.genreQuery?.en, req.genreQuery?.ar].filter((x): x is string => !!x);
  const selected = selectedGenre(req);
  const words = selected
    ? [...CATEGORY_PROFILES[selected.id].subjects, ...selected.hashtags]
    : hints.flatMap(subjectWords);
  return [...new Set(words.map(normalizeTerm))];
}

/** A genre is an editing/filming subject, not a request for recipes, sports lessons or shopping. */
export function genreVisualWords(req: DiscoverRequest): string[] {
  return [
    "edit",
    "editing",
    "montage",
    "cinematic",
    "b roll",
    "broll",
    "commercial",
    "ad",
    "filmmaking",
    "videography",
    "photography",
    "short film",
    "transition",
    "vfx",
    "camera",
    "lighting",
    "capcut",
    "davinci",
    "premiere",
    "after effects",
    "تصوير",
    "مونتاج",
    "ايديت",
    "سينمائي",
    "اعلان",
    "كواليس",
    "اضاءه",
    "كاميرا",
    "انتقال",
    "كاب كت",
    "كاب كات",
    "دافنشي",
    ...(selectedGenre(req)?.hashtags.filter((tag) =>
      /edit|montage|film|videography|transition|amv/i.test(tag),
    ) ?? []),
  ].map(normalizeTerm);
}

/** Whole words, with common Arabic attached prepositions and definite article handled. */
export function mentions(text: string, phrase: string): boolean {
  if (!phrase) return false;
  if (` ${text} `.includes(` ${phrase} `)) return true;
  if (!/^[ء-ي]+$/.test(phrase)) return false;
  return text
    .split(" ")
    .some(
      (w) =>
        /^(?:وال|بال|فال|لل|ال|و|ب|ل)/u.test(w) &&
        w.replace(/^(?:وال|بال|فال|لل|ال|و|ب|ل)/u, "") === phrase,
    );
}
