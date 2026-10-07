/** Recommendations are grounded in titles/captions/descriptions, never a claim that we watched a video. */
import { CATEGORY_PROFILES } from "../discover/category-profiles";
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
    "panning",
    "حركة الكاميرا",
  ],
  "shot composition": ["composition", "low angle", "زاوية منخفضة", "لقطات", "تكوين"],
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
  transitions: ["transition", "ترانزيشن", "انتقال"],
  montage: ["montage", "amv", "مونتاج", "ايديت", "إيديت"],
  filmmaking: [
    "filmmaking",
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
  editing: ["edit", "editing", "edited"],
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
const WEAK = new Set(["shot planning", "lighting", "editing"]);

/** Whole words/phrases; a few exact category+creative hashtag compounds are expanded below, never arbitrary substrings. */
const has = (text: string, phrase: string) => ` ${text} `.includes(` ${phrase} `);
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
  const subjects = [
    ...new Set((profile?.subjects ?? []).filter((s) => has(normalized, normalizeTerm(s)))),
  ];
  const techniques = FORMS.filter(({ aliases }) => aliases.some((a) => has(normalized, a))).map(
    (a) => a.name,
  );
  const prose = text
    .replace(/#[\p{L}\p{N}_]+/gu, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[^\p{L}]+/gu, "");
  const equipment =
    /\b(food processors?|prep tables?|work tables?|stainless steel kitchen|air fryers?)\b/i.test(
      text,
    );
  const sales =
    /\b(price list|for sale|buy now|shop now|discount code|coupon code|best deals|affiliate links?)\b/i.test(
      text,
    );
  const substantive = techniques.some((t) => !WEAK.has(t));
  const visualContext =
    /\b(video|film|camera|photography|photograph|lighting|composition|shoot|shooting)\b/i.test(
      text,
    ) || /تصوير|إضاء|اضاء|لقط/.test(text);
  const excluded = !prose || equipment || (sales && !substantive);
  const creative =
    !excluded &&
    techniques.length > 0 &&
    (substantive || visualContext || techniques.includes("editing"));
  const category = subjects.length > 0;
  return {
    category,
    creative,
    eligible: category && creative,
    subjects,
    techniques: excluded ? [] : techniques,
    score: creative ? (substantive ? 10 : 4) + Math.min(techniques.length, 4) * 2 : 0,
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
