import {
  POST_STAGES,
  type Idea,
  type LText,
  type Lang,
  type Platform,
  type Post,
  type PostStage,
  type QuestCompletion,
  type Script,
  type Shot,
  type ShotType,
  type Skill,
} from "./domain";
import { addDays, dayKey } from "./streak";

/**
 * 📱 Social world rules (rounds 16–17): best posting times, platform facts, shot templates, script length,
 * pipeline suggestions, calendar queries, hashtag and hook helpers, and skill → idea candidates.
 * Pure functions only; the store applies them and persists the results.
 */

/* ---------- Best time to post ---------- */

/**
 * "HH:MM" Riyadh slots per platform, best first. ASSUMPTION, not measured: Saudi prime time is after Isha
 * (roughly 20:30–22:30 depending on the season) with a smaller lunch-break bump around 13:00; X reads best at
 * lunch; Snapchat picks up from late afternoon. Override per platform once real analytics exist
 * (planning/tools/03-social-media.md).
 */
export const BEST_TIME: Record<Platform, string[]> = {
  tiktok: ["21:00", "21:30", "13:00"],
  instagram: ["20:30", "21:30", "13:00"],
  youtube: ["19:00", "20:30", "13:00"],
  x: ["13:00", "21:00"],
  snapchat: ["16:00", "21:00", "13:00"],
};

const dowOf = (day: string): number => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 Sun … 5 Fri, 6 Sat
};

/**
 * The best "HH:MM" for a platform. On the Saudi weekend (Friday, Saturday) people are out longer, so the
 * second slot (later evening, or the evening slot for X) is returned; otherwise the first.
 */
export function bestTime(platform: Platform, day?: string): string {
  const slots = BEST_TIME[platform];
  if (!day) return slots[0];
  const dow = dowOf(day);
  const weekend = dow === 5 || dow === 6;
  return weekend ? (slots[1] ?? slots[0]) : slots[0];
}

/* ---------- Platform facts ---------- */

export interface PlatformMeta {
  name: LText;
  /** 1–2 letter label for chips and calendar dots. */
  short: string;
  /** Brand color (X uses its legacy blue so it stays visible on the dark Social theme). */
  color: string;
  icon: string;
  aspect: "9:16" | "16:9";
  /** Characters allowed in a caption / description / tweet. */
  captionLimit: number;
  /** Recommended number of hashtags (max used by suggestHashtags). */
  hashtagMax: number;
  hashtagAdvice: LText;
  /** Sweet spot for a video's length. */
  idealLength: LText;
}

export const PLATFORM_META: Record<Platform, PlatformMeta> = {
  tiktok: {
    name: { ar: "تيك توك", en: "TikTok" },
    short: "TT",
    color: "#ff0050",
    icon: "🎵",
    aspect: "9:16",
    captionLimit: 4000,
    hashtagMax: 5,
    hashtagAdvice: {
      ar: "٣–٥ هاشتاقات: واحد عام، واحد للنيش، واحد للترند",
      en: "3–5 hashtags: one broad, one niche, one trending",
    },
    idealLength: { ar: "٢٠–٤٥ ثانية", en: "20–45 s" },
  },
  instagram: {
    name: { ar: "إنستقرام", en: "Instagram" },
    short: "IG",
    color: "#e1306c",
    icon: "📸",
    aspect: "9:16",
    captionLimit: 2200,
    hashtagMax: 5,
    hashtagAdvice: {
      ar: "٣–٥ هاشتاقات مركّزة أحسن من ٣٠؛ الكلمات في الكابشن أهم",
      en: "3–5 focused hashtags beat 30; keywords in the caption matter more",
    },
    idealLength: { ar: "١٥–٣٠ ثانية", en: "15–30 s" },
  },
  youtube: {
    name: { ar: "يوتيوب", en: "YouTube" },
    short: "YT",
    color: "#ff0000",
    icon: "▶️",
    aspect: "16:9",
    captionLimit: 5000,
    hashtagMax: 3,
    hashtagAdvice: {
      ar: "٣ هاشتاقات في الوصف تظهر فوق العنوان؛ أكثر من ١٥ تتجاهل",
      en: "3 hashtags in the description show above the title; over 15 are ignored",
    },
    idealLength: { ar: "٨–١٢ دقيقة", en: "8–12 min" },
  },
  x: {
    name: { ar: "إكس", en: "X" },
    short: "X",
    color: "#1d9bf0",
    icon: "✖️",
    aspect: "16:9",
    captionLimit: 280,
    hashtagMax: 2,
    hashtagAdvice: {
      ar: "هاشتاق أو اثنين بالكثير؛ الثريد أهم",
      en: "One or two at most; the thread matters more",
    },
    idealLength: {
      ar: "كليب ٣٠–٦٠ ثانية أو ثريد ٥–٧ تغريدات",
      en: "A 30–60 s clip or a 5–7 tweet thread",
    },
  },
  snapchat: {
    name: { ar: "سناب شات", en: "Snapchat" },
    short: "SC",
    color: "#fffc00",
    icon: "👻",
    aspect: "9:16",
    captionLimit: 250,
    hashtagMax: 5,
    hashtagAdvice: {
      ar: "٣–٥ توبيكات في سبوتلايت؛ الكابشن قصير",
      en: "3–5 Spotlight topics; keep the caption short",
    },
    idealLength: { ar: "١٠–٢٠ ثانية", en: "10–20 s" },
  },
};

/* ---------- Shot templates and B-roll checklist ---------- */

export interface ShotTemplate {
  type: ShotType;
  text: LText;
}

const REEL_SHOTS: ShotTemplate[] = [
  {
    type: "hook",
    text: { ar: "الهوك (٠–٣ ث): وجهي + أول جملة", en: "Hook (0–3 s): my face + the first line" },
  },
  { type: "talking", text: { ar: "أشرح الفكرة للكاميرا", en: "Explain the idea to camera" } },
  {
    type: "broll",
    text: { ar: "بي-رول ١: يدين على الكيبورد", en: "B-roll 1: hands on the keyboard" },
  },
  { type: "broll", text: { ar: "بي-رول ٢: الشاشة من قريب", en: "B-roll 2: the screen up close" } },
  {
    type: "broll",
    text: { ar: "بي-رول ٣: النتيجة قبل/بعد", en: "B-roll 3: the before/after result" },
  },
  {
    type: "text",
    text: { ar: "نص على الشاشة يلخّص الخطوة", en: "On-screen text summing up the step" },
  },
  {
    type: "closeup",
    text: { ar: "الختام (CTA): احفظ وعلّق", en: "Closing (CTA): save & comment" },
  },
];

export const SHOT_TEMPLATES: Record<Platform, ShotTemplate[]> = {
  tiktok: REEL_SHOTS,
  instagram: REEL_SHOTS,
  snapchat: REEL_SHOTS,
  youtube: [
    {
      type: "hook",
      text: { ar: "كولد أوبن: النتيجة النهائية أول شي", en: "Cold open: the final result first" },
    },
    {
      type: "talking",
      text: { ar: "المقدمة: العنوان + وعد الفيديو", en: "Intro: title + the video's promise" },
    },
    {
      type: "screen",
      text: { ar: "القسم ١: الخطوات في DaVinci", en: "Section 1: the steps in DaVinci" },
    },
    {
      type: "screen",
      text: { ar: "القسم ٢: الخطوة اللي الناس تنساها", en: "Section 2: the step people skip" },
    },
    {
      type: "screen",
      text: { ar: "القسم ٣: قبل/بعد ومقارنة", en: "Section 3: before/after comparison" },
    },
    {
      type: "broll",
      text: { ar: "بي-رول داعم بين الأقسام", en: "Supporting B-roll between sections" },
    },
    {
      type: "closeup",
      text: { ar: "الخاتمة: اشتراك + الفيديو الجاي", en: "Outro: subscribe + the next video" },
    },
  ],
  x: [
    {
      type: "screen",
      text: { ar: "كليب واحد: النتيجة في ٣٠ ثانية", en: "One clip: the result in 30 s" },
    },
  ],
};

/** Shots to reuse between posts; tick them off when filming a batch. */
export const BROLL_CHECKLIST: LText[] = [
  { ar: "☕ صب قهوة", en: "☕ Coffee pour" },
  { ar: "🌆 تايم لابس للمدينة", en: "🌆 City timelapse" },
  { ar: "⌨ يدين على الكيبورد", en: "⌨ Hands on the keyboard" },
  { ar: "🖥 إضاءة الشاشة على وجهي", en: "🖥 Monitor glow on my face" },
  { ar: "🎚 تحريك عجلة التلوين", en: "🎚 Turning the color wheel" },
  { ar: "📷 تركيب الكاميرا على القيمبل", en: "📷 Mounting the camera on the gimbal" },
  { ar: "🚶 مشي في الشارع (سلو موشن)", en: "🚶 Walking down the street (slow motion)" },
  { ar: "🌇 غروب الرياض", en: "🌇 Riyadh sunset" },
  { ar: "📝 كتابة في الدفتر", en: "📝 Writing in the notebook" },
  { ar: "🔌 توصيل الكيبلات", en: "🔌 Plugging in cables" },
];

const localId = (): string =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/** Fresh shots (unticked, new ids) from a platform's template, texts in the given language. */
export function shotsFromTemplate(
  platform: Platform,
  lang: Lang,
  makeId: () => string = localId,
): Shot[] {
  return SHOT_TEMPLATES[platform].map((t) => ({
    id: makeId(),
    type: t.type,
    text: t.text[lang] || t.text.ar,
    done: false,
  }));
}

/* ---------- Script length ---------- */

/** Spoken words per second (Hijazi or English, relaxed pace). */
export const WORDS_PER_SECOND = 2.4;

const countWords = (text: string): number => text.split(/\s+/).filter(Boolean).length;

export function scriptWords(script: Script): number {
  return [script.hook, ...script.beats, script.cta].reduce((n, t) => n + countWords(t), 0);
}

/** Estimated spoken length in whole seconds. */
export function scriptSeconds(script: Script): number {
  return Math.round(scriptWords(script) / WORDS_PER_SECOND);
}

export function hasScript(script: Script): boolean {
  return scriptWords(script) > 0;
}

/* ---------- Pipeline ---------- */

export function stageIndex(stage: PostStage): number {
  return POST_STAGES.indexOf(stage);
}

/** The stage after the post's current one, or null when it is already posted. */
export function nextStage(post: Pick<Post, "stage">): PostStage | null {
  return POST_STAGES[stageIndex(post.stage) + 1] ?? null;
}

/**
 * Where the post's content says it should be: a written script → at least "script"; every shot ticked (and
 * there is at least one) → at least "filmed"; an edited post with a planned day → "scheduled". Never lower
 * than the current stage and never "posted" (only markPosted does that). Compare with `post.stage` to show a
 * "move to …?" suggestion.
 */
export function suggestStage(
  post: Pick<Post, "stage" | "script" | "shots" | "plannedDay">,
): PostStage {
  let idx = stageIndex(post.stage);
  if (post.stage === "posted") return "posted";
  if (hasScript(post.script)) idx = Math.max(idx, stageIndex("script"));
  if (post.shots.length > 0 && post.shots.every((s) => s.done))
    idx = Math.max(idx, stageIndex("filmed"));
  if (POST_STAGES[idx] === "edited" && post.plannedDay) idx = stageIndex("scheduled");
  return POST_STAGES[Math.min(idx, stageIndex("scheduled"))];
}

/* ---------- Calendar queries ---------- */

const byDayThenTime = (a: Post, b: Post): number =>
  (a.plannedDay ?? "").localeCompare(b.plannedDay ?? "") ||
  (a.plannedTime ?? "99:99").localeCompare(b.plannedTime ?? "99:99") ||
  a.createdAt.localeCompare(b.createdAt);

/** Posts planned in the Sat–Fri week starting at `weekStart` (a Saturday key), in day then time order. */
export function postsForWeek(posts: readonly Post[], weekStart: string): Post[] {
  const end = addDays(weekStart, 6);
  return posts
    .filter((p) => p.plannedDay !== null && p.plannedDay >= weekStart && p.plannedDay <= end)
    .sort(byDayThenTime);
}

/** Posts planned in a month ("YYYY-MM"), in day then time order. */
export function postsForMonth(posts: readonly Post[], monthKey: string): Post[] {
  return posts.filter((p) => p.plannedDay?.startsWith(`${monthKey}-`)).sort(byDayThenTime);
}

/** Planned posts grouped by day key (unplanned posts are left out), each day in time order. */
export function postsByDay(posts: readonly Post[]): Record<string, Post[]> {
  const out: Record<string, Post[]> = {};
  for (const p of [...posts].sort(byDayThenTime)) {
    if (!p.plannedDay) continue;
    (out[p.plannedDay] ??= []).push(p);
  }
  return out;
}

/** Posts without a planned day, oldest first: the "unscheduled" tray. */
export function unplannedPosts(posts: readonly Post[]): Post[] {
  return posts.filter((p) => p.plannedDay === null && p.stage !== "posted").sort(byDayThenTime);
}

/** Riyadh instant (ms) of a planned post; a post without a time counts at the end of its day. */
export function plannedAt(post: Pick<Post, "plannedDay" | "plannedTime">): number | null {
  if (!post.plannedDay) return null;
  return Date.parse(`${post.plannedDay}T${post.plannedTime ?? "23:59"}:00+03:00`);
}

export interface NextPost {
  post: Post;
  /** ISO instant the post is due. */
  at: string;
  /** Milliseconds until then (≥ 0). */
  countdownMs: number;
}

/** The earliest planned, not-yet-posted post due at or after `now`, with its countdown; null when none. */
export function nextPost(posts: readonly Post[], now: Date | number = new Date()): NextPost | null {
  const nowMs = typeof now === "number" ? now : now.getTime();
  let best: NextPost | null = null;
  for (const post of posts) {
    if (post.stage === "posted") continue;
    const at = plannedAt(post);
    if (at === null || at < nowMs) continue;
    if (!best || at < Date.parse(best.at))
      best = { post, at: new Date(at).toISOString(), countdownMs: at - nowMs };
  }
  return best;
}

/** Planned posts whose time passed without being marked posted, oldest first. */
export function overduePosts(posts: readonly Post[], now: Date | number = new Date()): Post[] {
  const nowMs = typeof now === "number" ? now : now.getTime();
  return posts
    .filter((p) => {
      const at = plannedAt(p);
      return p.stage !== "posted" && at !== null && at < nowMs;
    })
    .sort(byDayThenTime);
}

export interface WeekPlanSummary {
  total: number;
  posted: number;
  byPlatform: Record<Platform, { planned: number; posted: number }>;
  /** Day keys of the week (Saturday first) with the number of posts on each. */
  perDay: { day: string; count: number }[];
}

export function weekPlanSummary(posts: readonly Post[], weekStart: string): WeekPlanSummary {
  const week = postsForWeek(posts, weekStart);
  const byPlatform = Object.fromEntries(
    (Object.keys(PLATFORM_META) as Platform[]).map((p) => [p, { planned: 0, posted: 0 }]),
  ) as WeekPlanSummary["byPlatform"];
  let posted = 0;
  for (const p of week) {
    byPlatform[p.platform].planned++;
    if (p.stage === "posted") {
      byPlatform[p.platform].posted++;
      posted++;
    }
  }
  const perDay = Array.from({ length: 7 }, (_, i) => {
    const day = addDays(weekStart, i);
    return { day, count: week.filter((p) => p.plannedDay === day).length };
  });
  return { total: week.length, posted, byPlatform, perDay };
}

/* ---------- Hashtags ---------- */

/** Defaults for a DaVinci / videography creator posting in Hijazi Arabic and English. */
export const HASHTAG_SETS: Record<Platform, string[]> = {
  tiktok: ["#دافنشي_ريزولف", "#مونتاج", "#تصوير", "#davinciresolve", "#3zprod"],
  instagram: ["#مونتاج", "#تصوير_سينمائي", "#davinciresolve", "#colorgrading", "#3zprod"],
  youtube: ["#davinciresolve", "#مونتاج", "#3zprod"],
  x: ["#مونتاج", "#davinciresolve"],
  snapchat: ["#مونتاج", "#تصوير", "#دافنشي", "#السعودية", "#3zprod"],
};

/** Extra tags per program id (the skill's tool or craft). */
const PROGRAM_TAGS: Record<string, string[]> = {
  davinci: ["#davinciresolve"],
  capcut: ["#capcut", "#كاب_كت"],
  photoshop: ["#photoshop"],
  lightroom: ["#lightroom"],
  illustrator: ["#illustrator"],
  camera: ["#videography", "#تصوير"],
  lighting: ["#lighting", "#إضاءة"],
  composition: ["#cinematography"],
  sound: ["#sounddesign"],
  story: ["#storytelling"],
  "color-craft": ["#colorgrading", "#تلوين"],
  production: ["#filmmaking"],
};

/**
 * The platform's default set, with the linked skill's program tags first, deduplicated and capped at the
 * platform's recommended count.
 */
export function suggestHashtags(platform: Platform, skill?: Pick<Skill, "programId">): string[] {
  const extra = skill ? (PROGRAM_TAGS[skill.programId] ?? []) : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of [...extra, ...HASHTAG_SETS[platform]]) {
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out.slice(0, PLATFORM_META[platform].hashtagMax);
}

/* ---------- Hooks ---------- */

/** The quoted line inside a produce-quest text ("…" / “…” / «…»), if any. */
export function quotedLine(text: string): string | null {
  const m = /"([^"]{3,})"|“([^”]{3,})”|«([^»]{3,})»/.exec(text);
  return m ? (m[1] ?? m[2] ?? m[3]).trim() : null;
}

/**
 * Three bilingual first-3-seconds lines. With a skill, the first comes from the quoted line of its Produce
 * quest text (each language separately) and the others are built from the skill's name; without one, three
 * generic Hijazi/English templates.
 */
export function hookIdeas(skill?: Pick<Skill, "name" | "quests">): LText[] {
  if (!skill) {
    return [
      {
        ar: "وقّف! لا تكمّل تمرير قبل ما تشوف دا 👀",
        en: "Stop scrolling, you need to see this 👀",
      },
      { ar: "٩٠٪ من المونتيرين يغلطوا في دي الحاجة…", en: "90% of editors get this wrong…" },
      { ar: "خلّيني أوريك في ٣٠ ثانية", en: "Let me show you in 30 seconds" },
    ];
  }
  const { ar, en } = skill.name;
  const produce = skill.quests.produce;
  return [
    {
      ar: quotedLine(produce.ar) ?? `وقّف! ${ar} في ٣٠ ثانية 👀`,
      en: quotedLine(produce.en) ?? `Stop scrolling: ${en} in 30 seconds 👀`,
    },
    { ar: `٩٠٪ من المونتيرين يغلطوا في ${ar}…`, en: `90% of editors get ${en} wrong…` },
    { ar: `${ar}؟ خلّيني أوريك بسرعة`, en: `${en}? Let me show you, quick` },
  ];
}

/* ---------- Ideas from skills ---------- */

/** An idea the ideas bank can offer but has not stored yet (the owner adds it via addIdea / useIdea). */
export interface SkillIdeaCandidate {
  source: "skill";
  skillId: string;
  /** The skill's name (localize with pickL before storing as Idea.text). */
  text: LText;
  /** The produce quest brief, for the card's subtitle. */
  brief: LText;
}

/**
 * Skills whose Produce quest is not done and that have no post yet (by skillId) and no stored idea either:
 * "skills without a video", in the order given.
 */
export function ideasFromSkills(
  skills: readonly Skill[],
  completions: readonly QuestCompletion[],
  posts: readonly Post[],
  ideas: readonly Idea[] = [],
): SkillIdeaCandidate[] {
  const produced = new Set(completions.filter((c) => c.quest === "produce").map((c) => c.skillId));
  const withPost = new Set(posts.flatMap((p) => (p.skillId ? [p.skillId] : [])));
  const withIdea = new Set(ideas.flatMap((i) => (i.skillId ? [i.skillId] : [])));
  return skills
    .filter((s) => !produced.has(s.id) && !withPost.has(s.id) && !withIdea.has(s.id))
    .map((s) => ({ source: "skill", skillId: s.id, text: s.name, brief: s.quests.produce }));
}

/** Today's Riyadh day key, re-exported for calendar screens. */
export const todayKey = (now: Date | string | number = new Date()): string => dayKey(now);
