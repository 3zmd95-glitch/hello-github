import genres from "../../../../planning/data/genres.json";
import { INTENT_WORDS, normalizeTerm } from "./terms";
import type { DiscoverRequest } from "./types";

/** Subject vocabulary, not generic words such as edit/video/cinematic. */
const SUBJECTS: Record<string, string[]> = {
  cars: ["car", "automotive", "BMW", "Porsche", "Mercedes", "سيارات", "سيارة", "موتر", "سياره"],
  food: [
    "food",
    "restaurant",
    "burger",
    "pizza",
    "cooking",
    "طعام",
    "أكل",
    "مطعم",
    "مطاعم",
    "برجر",
    "طبخ",
  ],
  anime: ["anime", "amv", "manga", "أنمي", "انمي", "ناروتو"],
  travel: ["travel", "destination", "vacation", "tourism", "سفر", "سياحة", "رحلة", "رحلات"],
  football: ["football", "soccer", "Messi", "Ronaldo", "كورة", "كرة القدم", "ميسي", "رونالدو"],
  coffee: [
    "coffee",
    "cafe",
    "café",
    "espresso",
    "barista",
    "قهوة",
    "قهوه",
    "كافيه",
    "كوفي",
    "اسبريسو",
  ],
  perfume: ["perfume", "fragrance", "cologne", "عطر", "عطور", "عطورات"],
  camping: [
    "camping",
    "desert",
    "campfire",
    "tent",
    "كشتة",
    "كشته",
    "بر",
    "صحراء",
    "تخييم",
    "خيمة",
  ],
  fashion: ["fashion", "outfit", "clothing", "lookbook", "موضة", "أزياء", "ملابس", "اوتفت"],
  gaming: [
    "gaming",
    "gameplay",
    "game",
    "valorant",
    "fortnite",
    "قيمنق",
    "قيمز",
    "العاب",
    "فورتنايت",
  ],
  weddings: ["wedding", "bride", "bridal", "groom", "زواج", "زفاف", "عروس", "عرس", "أعراس"],
  gym: ["gym", "fitness", "workout", "bodybuilding", "جيم", "نادي", "لياقة", "تمرين", "كمال اجسام"],
};

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
  const hints = [req.genreQuery?.en, req.genreQuery?.ar].filter((x): x is string => !!x);
  return genres.genres.find((g) =>
    [...g.queries.en, ...g.queries.ar].some((q) =>
      [...hints, req.q].some((h) => normalizeTerm(q) === normalizeTerm(h)),
    ),
  );
}

/** Synonyms of the selected built-in genre, or meaningful custom-genre terms. */
export function genreWords(req: DiscoverRequest): string[] {
  const hints = [req.genreQuery?.en, req.genreQuery?.ar].filter((x): x is string => !!x);
  const selected = selectedGenre(req);
  const words = selected
    ? [...SUBJECTS[selected.id], ...selected.hashtags]
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
