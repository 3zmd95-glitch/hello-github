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
  combat: [
    { en: "Boxing knockout edits with freeze frames", ar: "ايديت ضربات ملاكمة بفريز فريم" },
    { en: "UFC fight slow motion speed ramps", ar: "سبيد رامب وسلوموشن لنزالات UFC" },
    { en: "Fight entrance edits on the beat", ar: "ايديت دخول المقاتل على الإيقاع" },
  ],
  basketball: [
    { en: "Basketball dunk edits with freeze frames", ar: "ايديت تغميسات سلة بفريز فريم" },
    { en: "NBA highlight speed ramps on the beat", ar: "سبيد رامب على الإيقاع للقطات NBA" },
    { en: "Basketball crossover motion match cuts", ar: "ماتش كت على حركة المراوغة في السلة" },
  ],
  desserts: [
    { en: "Dessert commercial macro shots and slow motion", ar: "لقطات ماكرو وسلوموشن لإعلان حلا" },
    { en: "Bakery b-roll with soft backlighting", ar: "بي رول مخبوزات بإضاءة خلفية ناعمة" },
    { en: "Cake decorating stop motion", ar: "ستوب موشن لتزيين الكيك" },
  ],
  cooking: [
    {
      en: "Chef plating slow motion with sound design",
      ar: "سلوموشن لتقديم طبق الشيف مع تصميم صوت",
    },
    { en: "Cooking ingredient match cut transitions", ar: "انتقالات ماتش كت بين مكونات الطبخ" },
    { en: "Kitchen top-down cooking b-roll", ar: "بي رول طبخ من فوق" },
  ],
  beauty: [
    { en: "Makeup transition edits with masking", ar: "انتقالات ميكب بالماسك" },
    { en: "Skincare commercial macro and lighting", ar: "ماكرو وإضاءة لإعلان عناية بالبشرة" },
    { en: "Beauty product reveal with light sweeps", ar: "كشف منتج تجميل بلايت سويب" },
  ],
  family: [
    { en: "Family portrait film with natural light", ar: "فيلم بورتريه عائلي بإضاءة طبيعية" },
    { en: "Newborn photoshoot slow motion details", ar: "تفاصيل جلسة مواليد بسلوموشن" },
    { en: "Family moments with rack focus transitions", ar: "لحظات عائلية بانتقالات راك فوكس" },
  ],
  luxury: [
    { en: "Luxury watch macro shots and reflections", ar: "لقطات ماكرو وانعكاسات لساعة فخمة" },
    { en: "Watch commercial with light sweeps", ar: "إعلان ساعة بلايت سويب" },
    { en: "Watch dial rotation match cuts", ar: "ماتش كت على دوران عقارب الساعة" },
  ],
  sea: [
    { en: "Underwater diving cinematic color and light", ar: "تلوين وإضاءة سينمائية لتصوير الغوص" },
    { en: "Ocean waves slow motion b-roll", ar: "بي رول أمواج البحر بسلوموشن" },
    {
      en: "Beach to underwater match cut transitions",
      ar: "انتقالات ماتش كت من الشاطئ لتحت الماء",
    },
  ],
  drone: [
    { en: "Drone reveal shots through foregrounds", ar: "لقطات درون تكشف المكان من ورا عائق" },
    { en: "FPV drone speed ramps and dives", ar: "سبيد رامب وغطسات درون FPV" },
    { en: "Drone hyperlapse over the city", ar: "هايبرلابس درون فوق المدينة" },
  ],
  music: [
    { en: "Music video beat sync cuts", ar: "قصات كليب على الإيقاع" },
    { en: "Music video split screen performance edits", ar: "ايديت أداء في كليب بتقسيم الشاشة" },
    { en: "Music video lighting and color looks", ar: "إضاءة وألوان كليب سينمائي" },
  ],
  cinematic: [
    { en: "Short film match cuts between scenes", ar: "ماتش كت بين مشاهد فيلم قصير" },
    { en: "Short film color grading breakdown", ar: "شرح تلوين فيلم قصير" },
    { en: "Short film dolly zoom and camera moves", ar: "دولي زوم وحركات كاميرا في فيلم قصير" },
  ],
  podcast: [
    { en: "Podcast multicam cuts and captions", ar: "قصات بودكاست متعدد الكاميرات مع كابشن" },
    { en: "Podcast clips with animated text", ar: "مقاطع بودكاست بتحريك النص" },
    { en: "Podcast studio lighting setup", ar: "إضاءة استوديو بودكاست" },
  ],
  comedy: [
    { en: "Comedy skit timing and jump cuts", ar: "توقيت سكتش كوميدي وقصات سريعة" },
    { en: "Comedy sketch sound design and zooms", ar: "تصميم صوت وزوم لسكتش كوميدي" },
    { en: "Comedy skit freeze frame punchlines", ar: "فريز فريم على نكتة السكتش" },
  ],
  bikes: [
    { en: "Motorcycle rolling shots with speed ramps", ar: "لقطات دبابات متحركة مع سبيد رامب" },
    { en: "Superbike night ride light trails", ar: "خطوط إضاءة لدباب بالليل" },
    { en: "Motorcycle gear-up match cut transitions", ar: "انتقالات ماتش كت للبس عدة الدباب" },
  ],
  racing: [
    { en: "Drift edits with speed ramps and smoke", ar: "ايديت تفحيط بسبيد رامب ودخان" },
    { en: "Racing car velocity edits on the beat", ar: "ايديت فيلوسيتي لسباقات على الإيقاع" },
    { en: "Motorsport low angle tracking shots", ar: "لقطات تتبع بزاوية منخفضة للسباقات" },
  ],
  realestate: [
    { en: "Real estate tour with smooth gimbal moves", ar: "جولة عقار بحركات جيمبال ناعمة" },
    { en: "Villa day-to-night time lapse", ar: "تايم لابس لفيلا من النهار لليل" },
    { en: "Architecture match cuts between rooms", ar: "ماتش كت بين غرف العمارة" },
  ],
  services: [
    { en: "Barbershop commercial with sound design", ar: "إعلان صالون حلاقة مع تصميم صوت" },
    { en: "Small business b-roll with whip pans", ar: "بي رول محل بانتقالات ويب بان" },
    { en: "Local shop reveal with light sweeps", ar: "كشف محل بلايت سويب" },
  ],
  product: [
    { en: "Product commercial macro shots and lighting", ar: "لقطات ماكرو وإضاءة لإعلان منتج" },
    { en: "UGC product ad hooks and quick cuts", ar: "بداية إعلان منتج UGC وقصات سريعة" },
    { en: "Product reveal stop motion", ar: "ستوب موشن لكشف المنتج" },
  ],
  corporate: [
    { en: "Corporate event highlight film with music sync", ar: "فيلم ملخص فعالية على الإيقاع" },
    { en: "Conference recap with animated text", ar: "ملخص مؤتمر بتحريك النص" },
    { en: "Event venue time lapse setup", ar: "تايم لابس لتجهيز مكان الفعالية" },
  ],
  tech: [
    { en: "Tech unboxing macro shots and light sweeps", ar: "ماكرو ولايت سويب لفتح صندوق جهاز" },
    { en: "Smartphone commercial with motion tracking", ar: "إعلان جوال بتتبع الحركة" },
    { en: "Gadget reveal match cut transitions", ar: "انتقالات ماتش كت لكشف جهاز" },
  ],
  photography: [
    {
      en: "Photoshoot behind the scenes with lighting setups",
      ar: "كواليس جلسة تصوير وتجهيز الإضاءة",
    },
    { en: "Photographer POV shutter sound edits", ar: "ايديت من عين المصور مع صوت الشتر" },
    { en: "Photo to video freeze frame transitions", ar: "انتقالات فريز فريم من الصورة للفيديو" },
  ],
  colorgrading: [
    { en: "Cinematic color grading before and after", ar: "تلوين سينمائي قبل وبعد" },
    { en: "LUT color grading breakdown", ar: "شرح تلوين بـ LUT" },
    { en: "Skin tone color correction tutorial", ar: "شرح تصحيح ألوان البشرة" },
  ],
  vfx: [
    { en: "VFX compositing with motion tracking", ar: "دمج مؤثرات بصرية بتتبع الحركة" },
    { en: "Rotoscoping and masking breakdown", ar: "شرح روتوسكوب وماسك" },
    { en: "Motion graphics text reveals", ar: "كشف نصوص بموشن جرافيك" },
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
