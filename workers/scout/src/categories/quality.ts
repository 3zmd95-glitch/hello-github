/** Recommendations are grounded in titles/captions/descriptions, never a claim that we watched a video. */
import { CATEGORY_PROFILES } from "../discover/category-profiles";
import { mentions } from "../discover/relevance";
import { normalizeTerm } from "../discover/terms";
import { canonicalUrl, isVideoUrl, platformForHost } from "../normalize";
import type { TopVideo } from "./types";

const CREATIVE: Record<string, readonly string[]> = {
  "match cut": ["match cut", "matchcut", "ماتش كت"],
  "speed ramp": ["speed ramp", "speedramp", "سبيد رامب"],
  "beat sync": ["beat sync", "beatsync", "على الإيقاع"],
  "b-roll": ["b roll", "broll", "بي رول"],
  "rolling shots": ["rolling shot", "roller", "رولينج"],
  "camera movement": [
    "camera movement",
    "camera transition",
    "orbit shot",
    "tracking shot",
    "drift shot",
    "panning",
    "حركة الكاميرا",
    "لقطات متحركة",
  ],
  "shot composition": ["composition", "low angle", "زاوية منخفضة", "تكوين"],
  "shot planning": ["shot"],
  lighting: [
    "lighting",
    "backlight",
    "backlit",
    "backlighting",
    "rim light",
    "light painting",
    "إضاءة",
    "اضاءه",
  ],
  "color grading": [
    "color grading",
    "colour grading",
    "color grade",
    "colorgrade",
    "تلوين سينمائي",
  ],
  "stop motion": ["stop motion", "stopmotion", "ستوب موشن"],
  "time lapse": ["time lapse", "timelapse", "hyperlapse", "هايبرلابس", "تايم لابس"],
  "sound design": ["sound design", "تصميم صوت"],
  "rack focus": ["rack focus", "focus pull", "راك فوكس"],
  "slow motion": ["slow motion", "slowmo", "سلوموشن"],
  masking: ["masking", "mask transition", "ماسك"],
  rotoscoping: ["rotoscope", "rotoscoping", "روتوسكوب"],
  "cutout animation": ["cutout animation", "cut out animation", "paper cutout", "تحريك القصاصات"],
  "whip pan": ["whip pan", "swish pan", "ويب بان"],
  "freeze frame": ["freeze frame", "freeze effect", "فريز فريم", "تجميد اللقطة"],
  "split screen": ["split screen", "splitscreen", "تقسيم الشاشة"],
  "motion tracking": [
    "motion tracking",
    "text tracking",
    "tracked text",
    "تتبع الحركة",
    "تتبع النص",
  ],
  "motion graphics": ["motion graphics", "motion graphic", "موشن جرافيك"],
  "text animation": ["text animation", "animated text", "kinetic typography", "تحريك النص"],
  "macro closeup": [
    "macro shot",
    "macro closeup",
    "macro close up",
    "macro photography",
    "تصوير ماكرو",
  ],
  "reflection shot": ["reflection shot", "reflection photography", "تصوير انعكاسات"],
  "drone reveal": ["drone reveal", "drone shot", "لقطة درون"],
  "light sweep": ["light sweep", "لايت سويب"],
  "velocity edit": ["velocity edit", "فيلوسيتي"],
  "invisible cut": ["invisible cut", "hidden cut", "seamless cut", "قص مخفي"],
  "dolly zoom": ["dolly zoom", "vertigo effect", "دولي زوم"],
  transitions: ["transition", "ترانزيشن", "انتقال"],
  montage: ["montage", "amv", "مونتاج"],
  filmmaking: [
    "filmmaking",
    "filming",
    "how to film",
    "videography",
    "cinematography",
    "photography",
    "short film",
    "highlight film",
    "lookbook",
    "تصوير",
    "فيلم",
  ],
  cinematic: ["cinematic", "سينمائي"],
  editing: ["edit", "editing", "edited", "ايديت", "إيديت"],
  "creative commercial": [
    "commercial",
    "advertisement",
    "video ad",
    "spec ad",
    "cinematic ad",
    "إعلان",
    "اعلان",
  ],
};
const FORMS = Object.entries(CREATIVE).map(([name, aliases]) => ({
  name,
  aliases: aliases.map(normalizeTerm),
}));
// A project/style word can describe a useful reference, but cannot outweigh shopping/prompt bait
// or count as a named craft. A generic #edit alone is not a filming technique.
const PROJECT = new Set(["filmmaking", "cinematic", "creative commercial", "montage"]);
const CONTEXTUAL = new Set(["shot planning", "lighting", "editing"]);
const FAN_EDIT_GENRES = new Set(["anime", "football", "gaming"]);

/** Whole words/phrases; a few exact category+creative hashtag compounds are expanded below, never arbitrary substrings. */
const has = mentions;
const TAG_ENDINGS = [
  "edit",
  "edits",
  "editing",
  "cinematic",
  "videography",
  "filmmaking",
  "broll",
  "transition",
  "transitions",
  "montage",
  "photography",
];

function expanded(genreId: string, text: string): string {
  const subjects = CATEGORY_PROFILES[genreId]?.subjects ?? [];
  return text.replace(/#([\p{L}\p{N}_]+)/gu, (tag, raw: string) => {
    const flat = normalizeTerm(raw.replace(/_/g, " ")).replace(/ /g, "");
    for (const s of subjects)
      for (const ending of TAG_ENDINGS) {
        const subject = normalizeTerm(s).replace(/ /g, "");
        if (
          [subject, `${subject}s`].some((word) => flat === word + ending || flat === ending + word)
        )
          return `${s} ${ending}`;
      }
    return tag;
  });
}

export interface CategoryCreativeEvidence {
  category: boolean;
  creative: boolean;
  eligible: boolean;
  subjects: string[];
  techniques: string[];
  score: number;
}

/** A subject is mandatory; generic popularity/POV/ASMR/reel tags alone are not evidence of a creative example.
 * Product catalogues and equipment shopping retain no creative flag, including for generic lesson tutorials. */
export function categoryCreativeEvidence(genreId: string, text: string): CategoryCreativeEvidence {
  const profile = CATEGORY_PROFILES[genreId];
  const normalized = normalizeTerm(expanded(genreId, text));
  // "Time travel" names an effect, not a destination; other real travel words can still establish the category.
  const subjectText =
    genreId === "travel" ? normalized.replace(/\btime travel\b/g, " ") : normalized;
  const subjects = [
    ...new Set((profile?.subjects ?? []).filter((s) => has(subjectText, normalizeTerm(s)))),
  ];
  const techniques = FORMS.filter(({ aliases }) => aliases.some((a) => has(normalized, a))).map(
    (a) => a.name,
  );
  const prose = text.replace(/#[\p{L}\p{N}_]+/gu, "").replace(/https?:\/\/\S+/g, "");
  const equipment =
    /\b(food processors?|prep tables?|work tables?|stainless steel kitchen|air fryers?)\b/i.test(
      text,
    );
  const sales =
    /\b(price list|for sale|buy now|shop now|discount code|coupon code|best deals|grocery deals|affiliate links?|prompt pack|preset pack|photography packages?|commercial (?:food )?prices)\b/i.test(
      text,
    ) || /للبيع|اشتر الآن|اشتري الان|كود خصم|عروض البقالة|قائمة أسعار/.test(text);
  const promptBait =
    /\b(?:comment|dm|message|reply)\b[^.!?\n]{0,120}\b(?:prompt|preset|pack)\b/i.test(text) ||
    /\b(?:get|grab|download|buy)\b[^.!?\n]{0,60}\b(?:ai prompts?|prompt packs?)\b/i.test(text) ||
    /(?:اكتب|علق|أرسل|ارسل)[^.!?\n]{0,100}(?:برومبت|برومبتات)/.test(text);
  const substantive = techniques.some((t) => !PROJECT.has(t) && !CONTEXTUAL.has(t));
  const teaching =
    /\b(tutorial|breakdown|how to|behind the scenes|step by step|before and after)\b/i.test(
      prose,
    ) || /شرح|كواليس|طريقة|كيف|قبل وبعد/.test(prose);
  const visualContext =
    /\b(video|film|camera|photography|photograph|lighting|composition|shoot|shooting)\b/i.test(
      prose,
    ) || /تصوير|إضاء|اضاء|لقط/.test(prose);
  const teachesEditing =
    teaching && CREATIVE.editing.some((word) => has(normalizeTerm(prose), normalizeTerm(word)));
  const contextual =
    (techniques.includes("shot planning") && visualContext) ||
    (techniques.includes("lighting") && visualContext) ||
    (techniques.includes("editing") && (FAN_EDIT_GENRES.has(genreId) || teachesEditing));
  // #edit on coaching, recipes, uncut gameplay or a whole episode is not evidence of an edit breakdown.
  const ordinaryContent =
    /\b(full episode|full match|uncut gameplay|full gameplay|football (?:training|coaching)|soccer (?:training|coaching)|workout routine|fitness advice|build muscle|fat loss|cooking recipe|espresso extraction|build tutorial|perfume store|fragrance store)\b/i.test(
      prose,
    );
  const imagePrompt =
    /\b(?:foreground|background)\s*:/i.test(prose) &&
    /\b(?:realistic|photorealistic|selfie)\s+(?:\w+\s+){0,3}(?:photograph|image)\b/i.test(prose) &&
    !teaching;
  const excluded =
    !/\p{L}/u.test(prose) ||
    equipment ||
    imagePrompt ||
    (promptBait && !(teaching && substantive)) ||
    (sales && !(teaching && substantive)) ||
    (ordinaryContent && !substantive);
  const creative =
    !excluded &&
    techniques.length > 0 &&
    (substantive || techniques.some((t) => PROJECT.has(t)) || contextual);
  const category = subjects.length > 0;
  return {
    category,
    creative,
    eligible: category && creative,
    subjects,
    techniques: excluded ? [] : techniques,
    // Even several generic project labels cannot outrank one named craft through popularity.
    score: creative ? (substantive ? 20 : 4) + Math.min(techniques.length, 4) * 2 : 0,
  };
}

/** Canonical video links only. Duplicate query hits cannot increase rank. Caption specificity comes before views;
 * each known creator gets one place before another gets a second, at most three posts per creator. */
export function rankCategoryVideos(
  genreId: string,
  videos: readonly TopVideo[],
  max = 50,
): TopVideo[] {
  const unique = new Map<string, { video: TopVideo; score: number; index: number }>();
  for (const v of videos) {
    let u: URL;
    try {
      u = new URL(v.url);
    } catch {
      continue;
    }
    const platform = platformForHost(u.hostname);
    if (u.protocol !== "https:" || !platform || !isVideoUrl(platform, u)) continue;
    const url = canonicalUrl(platform, u);
    const evidence = categoryCreativeEvidence(genreId, `${v.title} ${v.snippet ?? ""}`);
    if (!evidence.eligible) continue;
    const video: TopVideo = {
      ...v,
      url,
      evidence: { basis: "metadata", subjects: evidence.subjects, techniques: evidence.techniques },
    };
    const previous = unique.get(url);
    // Richer text can replace the first hit; seeing the identical hit again has no effect.
    if (
      !previous ||
      evidence.score > previous.score ||
      (evidence.score === previous.score &&
        (v.snippet?.length ?? 0) > (previous.video.snippet?.length ?? 0))
    )
      unique.set(url, { video, score: evidence.score, index: previous?.index ?? unique.size });
  }
  const ranked = [...unique.values()].sort(
    (a, b) =>
      b.score - a.score || (b.video.views ?? -1) - (a.video.views ?? -1) || a.index - b.index,
  );
  const out: TopVideo[] = [];
  const counts = new Map<string, number>();
  const creator = (v: TopVideo) => {
    const u = new URL(v.url);
    const handle = u.pathname.match(/^\/@([^/]+)\//)?.[1] ?? v.creator?.trim().replace(/^@/, "");
    return handle ? `${platformForHost(u.hostname)}:${handle.toLowerCase()}` : v.url;
  };
  for (let round = 0; round < 3 && out.length < max; round++)
    for (const row of ranked) {
      if (out.length >= max) break;
      const key = creator(row.video);
      if ((counts.get(key) ?? 0) !== round || out.includes(row.video)) continue;
      out.push(row.video);
      counts.set(key, round + 1);
    }
  return out;
}
