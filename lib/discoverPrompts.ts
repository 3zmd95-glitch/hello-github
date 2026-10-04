import type { Lang } from "./domain";

type Prompt = Record<Lang, string>;
/** Concrete starting points: subject + technique, with no promise of current popularity. */
const GENRE_PROMPTS: Record<string, Prompt[]> = {
  cars: [
    { en: "Car headlight match cuts at night", ar: "ماتش كت بين أنوار السيارات بالليل" },
    { en: "Rolling car shots with speed ramps", ar: "لقطات سيارات متحركة مع سبيد رامب" },
    { en: "Car reveals with foreground wipes", ar: "كشف السيارة بانتقال من جسم قدام الكاميرا" },
  ],
  food: [
    {
      en: "Burger commercial macro shots and sound design",
      ar: "لقطات ماكرو لإعلان برجر مع تصميم صوت",
    },
    { en: "Restaurant food match cut transitions", ar: "انتقالات ماتش كت للأكل في المطاعم" },
    { en: "Recipe ingredient stop motion", ar: "ستوب موشن لمكونات الوصفة" },
  ],
  anime: [
    { en: "Anime AMV motion-matched transitions", ar: "انتقالات أنمي AMV متطابقة مع الحركة" },
    { en: "Anime beat sync with impact frames", ar: "أنمي بيت سينك مع فريمات ضربات" },
    { en: "Anime stills with 3D parallax", ar: "بارالاكس ثلاثي الأبعاد لصور الأنمي" },
  ],
  travel: [
    { en: "Travel reels with location match cuts", ar: "ريلز سفر بماتش كت بين الأماكن" },
    { en: "Travel hyperlapse transition breakdown", ar: "شرح انتقال هايبرلابس في فيديو سفر" },
    { en: "Travel drone reveals through foregrounds", ar: "لقطات درون تكشف المكان من ورا الأشجار" },
  ],
  football: [
    { en: "Football goal edits with freeze frames", ar: "ايديت أهداف كورة بفريز فريم" },
    { en: "Football skill speed ramp tutorial", ar: "شرح سبيد رامب لمهارات الكورة" },
    { en: "Football ball-tracking transitions", ar: "انتقالات كورة بتتبع حركة الكرة" },
  ],
  coffee: [
    { en: "Coffee pour match cut reels", ar: "ريلز صب القهوة بماتش كت" },
    {
      en: "Coffee commercial macro shots and sound design",
      ar: "لقطات ماكرو وتصميم صوت لإعلان قهوة",
    },
    { en: "Espresso extraction slow motion and ASMR", ar: "استخلاص إسبريسو بسلو موشن وصوت ASMR" },
  ],
  perfume: [
    { en: "Perfume bottle lighting and reflection tutorial", ar: "شرح إضاءة وانعكاسات زجاجة عطر" },
    { en: "Perfume commercial with liquid match cuts", ar: "إعلان عطر بماتش كت للسوائل" },
    { en: "Perfume mist with backlighting", ar: "رذاذ العطر بإضاءة خلفية" },
  ],
  camping: [
    { en: "Desert camping cinematic sunset sequence", ar: "تسلسل لقطات سينمائية لكشتة وقت الغروب" },
    { en: "Campfire close-ups with natural sound", ar: "لقطات قريبة لنار الكشتة مع الصوت الطبيعي" },
    { en: "Desert camp day-to-night match cuts", ar: "ماتش كت لكشتة بالبر من النهار لليل" },
  ],
  fashion: [
    { en: "Outfit change whip pan transitions", ar: "تغيير ملابس بانتقالات ويب بان" },
    { en: "Fashion lookbook match cut tutorial", ar: "شرح ماتش كت للوك بوك أزياء" },
    { en: "Clothing texture macro transitions", ar: "انتقالات ماكرو بين خامات الملابس" },
  ],
  gaming: [
    { en: "Valorant montage beat sync tutorial", ar: "شرح بيت سينك لمونتاج فالورانت" },
    {
      en: "Gaming montage cinematic camera transitions",
      ar: "انتقالات كاميرا سينمائية لمونتاج قيمنق",
    },
    { en: "Gaming character silhouette mask transitions", ar: "انتقالات ماسك بظل شخصية اللعبة" },
  ],
  weddings: [
    { en: "Wedding ring macro match cuts", ar: "ماتش كت ماكرو لخواتم الزواج" },
    {
      en: "Wedding film audio transitions and vows",
      ar: "انتقالات صوتية وكلام العروسين في فيلم زواج",
    },
    { en: "Wedding bouquet toss motion match cuts", ar: "ماتش كت على حركة رمية بوكيه العروس" },
  ],
  gym: [
    { en: "Gym workout speed ramps on the beat", ar: "سبيد رامب على الإيقاع لتمارين الجيم" },
    { en: "Gym cinematic lighting and sound design", ar: "إضاءة سينمائية وتصميم صوت لفيديو جيم" },
    { en: "Workout reps with movement match cuts", ar: "ماتش كت بين حركات وتكرارات التمارين" },
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
