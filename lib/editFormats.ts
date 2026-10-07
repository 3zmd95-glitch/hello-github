import { z } from "zod";
import type { DiscoverAnswer, DiscoverItem } from "./discover";
import { canonicalRefUrl } from "./research";

export const EDIT_FORMAT_VERSION = 1;
const DAY = 86_400_000;
const TextSchema = z.object({
  en: z.string().trim().min(1).max(500),
  ar: z.string().max(500).optional(),
});
const DateSchema = z.string().refine((value) => Number.isFinite(Date.parse(value)));

/** Only public platform post/audio links belong in a format card or an imported saved card. */
function platformUrl(value: string, audio = false): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return false;
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (audio) return host === "instagram.com" && /^\/reels\/audio\/\d+\/?$/.test(url.pathname);
    return (
      (host === "instagram.com" &&
        /^\/(?:[\w.]+\/)?(?:p|reels?|tv)\/[\w-]+\/?$/.test(url.pathname)) ||
      (host === "tiktok.com" && /^\/@[\w.-]+\/(?:video|photo)\/\d+\/?$/.test(url.pathname)) ||
      (host === "youtube.com" &&
        ((url.pathname === "/watch" && /^[\w-]+$/.test(url.searchParams.get("v") ?? "")) ||
          /^\/shorts\/[\w-]+\/?$/.test(url.pathname))) ||
      (host === "youtu.be" && /^\/[\w-]+\/?$/.test(url.pathname))
    );
  } catch {
    return false;
  }
}

const SampleSchema = z.object({
  url: z
    .string()
    .max(1000)
    .refine((url) => platformUrl(url)),
  title: z.string().max(300),
  platform: z.enum(["ig", "tt", "yt"]),
  handle: z.string().max(100).optional(),
  // A reviewed reference can have no visible publication date; do not turn inspection time into post time.
  published: DateSchema.optional(),
  observedAt: DateSchema,
  patternQuote: z.string().max(500).optional(),
  audioQuote: z.string().max(500).optional(),
  formatQuote: z.string().max(500).optional(),
  basis: z.enum(["partial-playback", "user-description", "caption"]).optional(),
});

/** Mirrors Worker EditFormat v1, with explicit provenance for separately reviewed references. */
export const EditFormatSchema = z
  .object({
    key: z.string().min(1).max(240),
    name: TextSchema,
    visualPattern: TextSchema,
    audio: z
      .object({
        title: z.string().min(1).max(200),
        artist: z.string().max(160).optional(),
        url: z
          .string()
          .max(1000)
          .refine((url) => platformUrl(url, true))
          .optional(),
      })
      .optional(),
    namedFormat: z.string().min(1).max(200).optional(),
    firstSeen: DateSchema,
    lastChecked: DateSchema,
    source: z.enum(["indexed-public-posts", "reviewed-reference"]).optional(),
    reviewNote: TextSchema.optional(),
    evidence: z.object({
      state: z.enum(["candidate", "repeated"]),
      creators7d: z.number().int().min(0).max(1_000_000),
      posts7d: z.number().int().min(0).max(1_000_000),
      latestPostAt: DateSchema.optional(),
      scope: z.enum(["indexed-public-posts", "reviewed-references"]),
    }),
    samples: z.array(SampleSchema).min(1).max(6),
  })
  .refine((format) => !!format.audio || !!format.namedFormat);

export type EditFormat = z.infer<typeof EditFormatSchema>;

/** Public scan rows must contain dated caption evidence; local review provenance cannot be supplied by a server. */
export function parseEditFormats(raw: unknown, now = Date.now()): EditFormat[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 20).flatMap((item) => {
    const parsed = EditFormatSchema.safeParse(item);
    if (!parsed.success) return [];
    const f = parsed.data;
    if (f.source === "reviewed-reference" || f.evidence.scope !== "indexed-public-posts") return [];
    if (f.samples.some((s) => !s.published || !s.patternQuote || (!s.audioQuote && !s.formatQuote)))
      return [];
    const checked = Date.parse(f.lastChecked);
    const latest = f.evidence.latestPostAt ? Date.parse(f.evidence.latestPostAt) : undefined;
    const future = now + 5 * 60_000;
    if (
      checked > future ||
      Date.parse(f.firstSeen) > checked ||
      f.evidence.creators7d > f.evidence.posts7d
    )
      return [];
    if (latest !== undefined && latest > checked) return [];
    if (
      f.samples.some(
        (s) =>
          Date.parse(s.observedAt) > checked || Date.parse(s.published!) > Date.parse(s.observedAt),
      )
    )
      return [];
    if (
      f.evidence.state === "repeated" &&
      (f.evidence.creators7d < 3 || latest === undefined || checked - latest > 7 * DAY)
    )
      return [];
    const publicFields = { ...f };
    delete publicFields.reviewNote;
    return [
      {
        ...publicFields,
        source: "indexed-public-posts" as const,
        samples: f.samples.map((sample) => ({ ...sample, basis: "caption" as const })),
      },
    ];
  });
}

/** The Worker's key includes both audio identity and visual pattern; never group by audio alone. */
export function formatIdentity(format: EditFormat): string {
  return format.key;
}

/** Live observations replace their saved snapshot; a missing backend never erases a followed format. */
export function mergeEditFormats(
  live: readonly EditFormat[],
  reviewed: readonly EditFormat[],
  followed: readonly FollowedFormat[],
): EditFormat[] {
  const rows = new Map<string, EditFormat>();
  for (const format of [...followed.map((entry) => entry.format), ...reviewed, ...live]) {
    const key = formatIdentity(format);
    const previous = rows.get(key);
    // Never replace a newer saved observation with a stale response from another tab/server.
    if (!previous || Date.parse(format.lastChecked) >= Date.parse(previous.lastChecked))
      rows.set(key, format);
  }
  const saved = new Set(followed.map((entry) => formatIdentity(entry.format)));
  return [...rows.values()].sort(
    (a, b) => Number(saved.has(formatIdentity(b))) - Number(saved.has(formatIdentity(a))),
  );
}

/** Source checks describe a limited observation window, never a platform-wide popularity claim. */
export function formatFreshness(
  format: EditFormat,
  now = Date.now(),
): "recent" | "stale" | "unknown" {
  const latest = format.evidence.latestPostAt;
  if (!latest) return "unknown";
  const age = now - Date.parse(latest);
  const checkAge = now - Date.parse(format.lastChecked);
  return age < 0 || age > 7 * DAY || checkAge < 0 || checkAge > 3 * DAY ? "stale" : "recent";
}

export function editFormatQuery(format: EditFormat, intent: "examples" | "tutorials"): string {
  const identity = audioSearchTitle(format) || format.namedFormat || "";
  const visual = visualSearchLabel(format).split(" ").slice(0, 6).join(" ").slice(0, 75);
  return `"${identity.replace(/"/g, "").slice(0, 75)}" ${visual} ${intent === "tutorials" ? "edit tutorial" : "edit examples"}`
    .replace(/\s+/g, " ")
    .trim();
}

const normalized = (s: string) =>
  s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
const wordsPresent = (text: string, phrase: string) =>
  !!phrase && ` ${normalized(text)} `.includes(` ${normalized(phrase)} `);
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A displayed album/track combination may contain a more precise track named by this format. Never treat the
 * album-only half as equivalent evidence for its track. Otherwise retain the full audio identity. */
function audioSearchTitle(format: EditFormat): string {
  if (!format.audio) return "";
  const title = format.audio.title.trim();
  const parts = title.split(/\s*\/\s*/).filter(Boolean);
  const named = parts.filter((part) => wordsPresent(format.name.en, part));
  return named.length === 1 ? named[0] : title;
}

const VISUAL_STOP = new Set(
  "a an the of in on at to for with and is are this that each every across into by effect effects video videos edit edits editing tutorial tutorials montage cinematic shot shots film filmmaking trend template example examples style".split(
    " ",
  ),
);
function visualSearchLabel(format: EditFormat): string {
  let name = ` ${normalized(format.name.en)} `;
  for (const part of [
    format.audio?.title,
    ...(format.audio?.title.split(/\s*\/\s*/) ?? []),
    format.audio?.artist,
    format.namedFormat,
  ])
    if (part) name = name.replace(` ${normalized(part)} `, " ");
  const label = name
    .trim()
    .split(" ")
    .filter((w) => !VISUAL_STOP.has(w))
    .join(" ");
  return label.split(" ").filter(Boolean).length >= 2
    ? label
    : normalized(format.visualPattern.en)
        .split(" ")
        .filter((w) => !VISUAL_STOP.has(w))
        .join(" ");
}

/** These are visual-language equivalents, not evidence that the model watched a clip. */
function visualWords(text: string): Set<string> {
  return new Set(
    normalized(text)
      .split(" ")
      .filter((w) => !VISUAL_STOP.has(w))
      .map((w) => {
        if (
          /^(?:repeat(?:ed|ing|s)?|repetition|multiple|duplicat(?:e|es|ed|ing)|copies|clon(?:e|es|ing))$/.test(
            w,
          )
        )
          return "repeat";
        if (/^(?:figure|figures|subject|subjects|person|people|yourself|body|bodies)$/.test(w))
          return "subject";
        if (/^(?:cutout|cutouts|rotoscop(?:e|ed|ing))$/.test(w)) return "cutout";
        if (/^(?:freeze|freezes|freezing|frozen)$/.test(w)) return "freeze";
        if (/^rotat(?:e|es|ed|ing|ion|ions)$/.test(w)) return "rotate";
        if (/^(?:layer|layers|layered|layering|overlay|overlays|overlaid)$/.test(w)) return "layer";
        return w.length > 4 ? w.replace(/(?:ing|s)$/, "") : w;
      }),
  );
}
const TEACHING =
  /\b(tutorial|breakdown|walkthrough|step[ -]by[ -]step|how (?:to|i|we)|learn|explained|editing process|behind the edit)\b|شرح|كيف|طريقة|خطوات|تعلم/i;
const EDITING =
  /\b(edit|editing|composit(?:e|ing)|mask(?:ing)?|rotoscop\w*|clone\w*|layer\w*|keyframe\w*|after effects|capcut|premiere|davinci|tutorial|breakdown|transition\w*|cutout\w*|repeating figures|repeated figures)\b|مونتاج|ايديت|إيديت|ماسك|استنساخ|تكرار|نسخ|انتقال/i;
const NON_VISUAL = new Set([
  "repeat",
  "subject",
  "beat",
  "rhythm",
  "song",
  "sound",
  "audio",
  "music",
]);
const AUDIO_CLONING =
  /\b(?:voice|vocal|audio|speech)[ -]+clon(?:e|es|ed|ing)\b|\bclon(?:e|es|ed|ing)\s+(?:your |a |the )?(?:voice|vocals?|audio|speech)\b|استنساخ الصوت|نسخ الصوت/i;
const VISUAL_COMPOSITING =
  /\b(?:rotoscop\w*|cut[ -]?outs?|composit(?:e|ing)|(?:visual|video|layer|subject|person) masks?|mask(?:s|ed|ing)?(?:\s+\w+){0,2}\s+(?:layers?|subjects?|people|persons?|figures?|frames?)|duplicat(?:e|ed|ing)\s+(?:video\s+)?(?:frames?|layers?))\b|ماسك|روتوسكوب|قص الشخص|طبقات الفيديو/i;
type FormatSearchItem = Pick<DiscoverItem, "title" | "snippet" | "section" | "url" | "platform">;

/** A selected format is a conjunction: the named audio/format AND its visual recipe. Ordinary Discover searches
 * do not use this gate. A result mentioning only an artist, album or generic cinematic style never qualifies. */
export function formatItemMatches(
  item: FormatSearchItem,
  format: EditFormat,
  intent: "examples" | "tutorials",
): boolean {
  const text = `${item.title} ${item.snippet}`;
  if (intent === "tutorials" && !TEACHING.test(text)) return false;
  const known = format.samples.some(
    (s) =>
      s.platform === item.platform &&
      canonicalRefUrl(s.platform, s.url) === canonicalRefUrl(item.platform, item.url),
  );
  // Known reviewed/caption-supported source posts remain evidence even if a new search omits their audio metadata.
  if (known && intent === "examples") return true;
  const identity = audioSearchTitle(format) || format.namedFormat || "";
  const compact = normalized(identity).replace(/ /g, "");
  const named =
    wordsPresent(text, identity) ||
    (identity.includes(" ") &&
      new RegExp(`(?:^|[\\s#])${escapeRegex(compact)}(?=$|[\\s.,!?#])`, "i").test(text));
  if (!named) return false;
  // "Clone yourself" can describe a voice model. A soundtrack match does not make that a visual clone edit.
  if (AUDIO_CLONING.test(text) && !VISUAL_COMPOSITING.test(text)) return false;
  // A one-word song such as "Stay" can be ordinary prose. Its artist is a required disambiguator when known.
  if (
    format.audio?.artist &&
    normalized(identity).split(" ").length === 1 &&
    !wordsPresent(text, format.audio.artist)
  )
    return false;
  const wanted = visualWords(visualSearchLabel(format));
  const actual = visualWords(text);
  if (wanted.size < 2 || [...wanted].some((word) => !actual.has(word))) return false;
  // Two generic nouns like "song beats" cannot establish a visual edit. Repeated figures is a visual phrase;
  // singing along to a beat, fashion/album news, and generic LUT advertisements are not.
  return EDITING.test(text) || [...wanted].filter((word) => !NON_VISUAL.has(word)).length >= 2;
}

/** Recount creators from accepted references so profile-only search noise cannot survive an empty format result.
 * Keep retrieval status/cost untouched; this is a view of the raw answer, never a replacement cache entry. */
export function filterFormatAnswer(
  answer: DiscoverAnswer,
  format: EditFormat,
  intent: "examples" | "tutorials",
): DiscoverAnswer {
  const items = answer.items
    .filter((item) => formatItemMatches(item, format, intent))
    .map((item) => {
      const accepted = { ...item };
      delete accepted.offTopic;
      delete accepted.outsideCategory;
      return accepted;
    });
  const handleKey = (p: string, h: string) => `${p}:${h.trim().replace(/^@/, "").toLowerCase()}`;
  const creators = answer.creators.flatMap((creator) => {
    const accepted = items.filter(
      (item) =>
        handleKey(item.platform, item.handle) === handleKey(creator.platform, creator.handle),
    );
    if (!accepted.length) return [];
    const next = { ...creator, count: accepted.length };
    delete next.views;
    if (accepted.some((item) => item.stats?.views !== undefined))
      next.views = accepted.reduce((sum, item) => sum + (item.stats?.views ?? 0), 0);
    return [next];
  });
  return { ...answer, items, creators, alternatives: [] };
}

const FollowedFormatSchema = z.object({ format: EditFormatSchema, followedAt: DateSchema });
export type FollowedFormat = z.infer<typeof FollowedFormatSchema>;
export const FollowedFormatsSchema = z
  .array(z.unknown())
  .default([])
  .transform((rows) => {
    const seen = new Set<string>();
    return rows.slice(0, 64).flatMap((row) => {
      const parsed = FollowedFormatSchema.safeParse(row);
      if (!parsed.success) return [];
      const identity = formatIdentity(parsed.data.format);
      if (seen.has(identity)) return [];
      seen.add(identity);
      return [parsed.data];
    });
  });
