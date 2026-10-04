import type { Lang } from "./domain";

type Prompt = Record<Lang, string>;
/** Concrete starting points: subject + technique, with no promise of current popularity. */
const GENRE_PROMPTS: Record<string, Prompt[]> = {
  cars: [
    { en: "Car headlight match cuts at night", ar: "ماتش كت بين أنوار السيارات بالليل" },
    { en: "Rolling car shots with speed ramps", ar: "لقطات سيارات متحركة مع سبيد رامب" },
  ],
  food: [
    {
      en: "Burger commercial macro shots and sound design",
      ar: "لقطات ماكرو لإعلان برجر مع تصميم صوت",
    },
    { en: "Restaurant food match cut transitions", ar: "انتقالات ماتش كت للأكل في المطاعم" },
  ],
  anime: [
    { en: "Anime AMV motion-matched transitions", ar: "انتقالات أنمي AMV متطابقة مع الحركة" },
    { en: "Anime beat sync with impact frames", ar: "أنمي بيت سينك مع فريمات ضربات" },
  ],
  travel: [
    { en: "Travel reels with location match cuts", ar: "ريلز سفر بماتش كت بين الأماكن" },
    { en: "Travel hyperlapse transition breakdown", ar: "شرح انتقال هايبرلابس في فيديو سفر" },
  ],
  football: [
    { en: "Football goal edits with freeze frames", ar: "ايديت أهداف كورة بفريز فريم" },
    { en: "Football skill speed ramp tutorial", ar: "شرح سبيد رامب لمهارات الكورة" },
  ],
  coffee: [
    { en: "Coffee pour match cut reels", ar: "ريلز صب القهوة بماتش كت" },
    {
      en: "Coffee commercial macro shots and sound design",
      ar: "لقطات ماكرو وتصميم صوت لإعلان قهوة",
    },
  ],
  perfume: [
    { en: "Perfume bottle lighting and reflection tutorial", ar: "شرح إضاءة وانعكاسات زجاجة عطر" },
    { en: "Perfume commercial with liquid match cuts", ar: "إعلان عطر بماتش كت للسوائل" },
  ],
  camping: [
    { en: "Desert camping cinematic sunset sequence", ar: "تسلسل لقطات سينمائية لكشتة وقت الغروب" },
    { en: "Campfire close-ups with natural sound", ar: "لقطات قريبة لنار الكشتة مع الصوت الطبيعي" },
  ],
  fashion: [
    { en: "Outfit change whip pan transitions", ar: "تغيير ملابس بانتقالات ويب بان" },
    { en: "Fashion lookbook match cut tutorial", ar: "شرح ماتش كت للوك بوك أزياء" },
  ],
  gaming: [
    { en: "Valorant montage beat sync tutorial", ar: "شرح بيت سينك لمونتاج فالورانت" },
    {
      en: "Gaming montage cinematic camera transitions",
      ar: "انتقالات كاميرا سينمائية لمونتاج قيمنق",
    },
  ],
  weddings: [
    { en: "Wedding ring macro match cuts", ar: "ماتش كت ماكرو لخواتم الزواج" },
    {
      en: "Wedding film audio transitions and vows",
      ar: "انتقالات صوتية وكلام العروسين في فيلم زواج",
    },
  ],
  gym: [
    { en: "Gym workout speed ramps on the beat", ar: "سبيد رامب على الإيقاع لتمارين الجيم" },
    { en: "Gym cinematic lighting and sound design", ar: "إضاءة سينمائية وتصميم صوت لفيديو جيم" },
  ],
};

const DEFAULT_PROMPTS: Prompt[] = [
  {
    en: "Find coffee match cut reels and explainers in Arabic and English",
    ar: "أبغى ريلز ماتش كت للقهوة وشروحات بالعربي والإنجليزي",
  },
  {
    en: "Find car speed ramp tutorials in DaVinci Resolve",
    ar: "أبغى شروحات سبيد رامب للسيارات في دافنشي ريزولف",
  },
];

export function discoverPrompts(genreId?: string): readonly Prompt[] {
  return genreId ? (GENRE_PROMPTS[genreId] ?? []) : DEFAULT_PROMPTS;
}
