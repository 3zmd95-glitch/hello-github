import type { LangText } from "./terms";

export interface CategorySearchProfile {
  /** Compact subject added to a technique search, without repeating generic editing words. */
  subject: LangText;
  subjects: readonly string[];
  examples: LangText;
  tutorials: LangText;
  retryExamples: LangText;
  retryTutorials: LangText;
}

/** Focused search wording for each category; query counts and provider budgets stay unchanged. */
export const CATEGORY_PROFILES: Readonly<Record<string, CategorySearchProfile>> = {
  cars: {
    subject: { en: "car", ar: "سيارات" },
    subjects: [
      "car",
      "automotive",
      "BMW",
      "Porsche",
      "Mercedes",
      "سيارات",
      "سيارة",
      "موتر",
      "سياره",
    ],
    examples: { en: "cinematic car rolling shots", ar: "ايديت سيارات لقطات متحركة" },
    tutorials: { en: "car videography editing tutorial", ar: "شرح تصوير ومونتاج سيارات" },
    retryExamples: { en: "automotive commercial car edit", ar: "إعلان سيارات سينمائي" },
    retryTutorials: { en: "how to film cinematic car rollers", ar: "كواليس تصوير إعلان سيارات" },
  },
  food: {
    subject: { en: "food", ar: "أكل" },
    subjects: [
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
    examples: { en: "food commercial cinematic b roll", ar: "إعلان أكل تصوير سينمائي" },
    tutorials: { en: "food videography lighting tutorial", ar: "شرح تصوير الأكل والمطاعم" },
    retryExamples: { en: "restaurant food video ad", ar: "مونتاج إعلان مطعم" },
    retryTutorials: { en: "food commercial editing breakdown", ar: "كواليس تصوير إعلان أكل" },
  },
  anime: {
    subject: { en: "anime", ar: "أنمي" },
    subjects: ["anime", "amv", "manga", "أنمي", "انمي", "ناروتو"],
    examples: { en: "anime AMV beat sync edit", ar: "ايديت أنمي متزامن مع الإيقاع" },
    tutorials: { en: "anime AMV editing transitions tutorial", ar: "شرح مونتاج وانتقالات أنمي" },
    retryExamples: { en: "anime motion match transition edit", ar: "مونتاج أنمي انتقالات حركة" },
    retryTutorials: { en: "anime edit beat sync breakdown", ar: "طريقة ايديت أنمي على الإيقاع" },
  },
  travel: {
    subject: { en: "travel", ar: "سفر" },
    subjects: ["travel", "destination", "vacation", "tourism", "سفر", "سياحة", "رحلة", "رحلات"],
    examples: { en: "cinematic travel short film", ar: "فيلم سفر سينمائي" },
    tutorials: { en: "travel filmmaking editing tutorial", ar: "شرح تصوير ومونتاج سفر" },
    retryExamples: { en: "travel reel location transitions", ar: "ريلز سفر انتقالات بين الأماكن" },
    retryTutorials: { en: "travel video transition breakdown", ar: "كواليس تصوير فيلم سفر" },
  },
  football: {
    subject: { en: "football", ar: "كورة" },
    subjects: ["football", "soccer", "Messi", "Ronaldo", "كورة", "كرة القدم", "ميسي", "رونالدو"],
    examples: { en: "football goal cinematic edit", ar: "ايديت أهداف كورة" },
    tutorials: { en: "football montage editing tutorial", ar: "شرح مونتاج أهداف كورة" },
    retryExamples: { en: "soccer skills beat sync edit", ar: "مونتاج مهارات كرة القدم" },
    retryTutorials: {
      en: "football speed ramp edit breakdown",
      ar: "طريقة ايديت كورة على الإيقاع",
    },
  },
  coffee: {
    subject: { en: "coffee", ar: "قهوة" },
    subjects: [
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
    examples: { en: "coffee commercial cinematic b roll", ar: "إعلان قهوة تصوير سينمائي" },
    tutorials: { en: "coffee videography lighting tutorial", ar: "شرح تصوير القهوة وإضاءتها" },
    retryExamples: { en: "cafe coffee cinematic video", ar: "مونتاج إعلان كافيه" },
    retryTutorials: { en: "coffee commercial editing breakdown", ar: "كواليس تصوير إعلان قهوة" },
  },
  perfume: {
    subject: { en: "perfume", ar: "عطور" },
    subjects: ["perfume", "fragrance", "cologne", "عطر", "عطور", "عطورات"],
    examples: { en: "perfume commercial cinematic video", ar: "إعلان عطر سينمائي" },
    tutorials: { en: "perfume product lighting tutorial", ar: "شرح تصوير وإضاءة العطور" },
    retryExamples: { en: "fragrance bottle reflection ad", ar: "تصوير زجاجة عطر وانعكاسات" },
    retryTutorials: { en: "perfume commercial filming breakdown", ar: "كواليس تصوير إعلان عطر" },
  },
  camping: {
    subject: { en: "camping", ar: "كشتة" },
    subjects: [
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
    examples: { en: "desert camping cinematic film", ar: "تصوير كشتة سينمائي" },
    tutorials: { en: "camping outdoor filmmaking tutorial", ar: "شرح تصوير كشتة ومونتاج البر" },
    retryExamples: { en: "campfire camping b roll", ar: "مونتاج كشتة وقت الغروب" },
    retryTutorials: { en: "desert camping video editing breakdown", ar: "كواليس تصوير فيلم تخييم" },
  },
  fashion: {
    subject: { en: "fashion", ar: "أزياء" },
    subjects: ["fashion", "outfit", "clothing", "lookbook", "موضة", "أزياء", "ملابس", "اوتفت"],
    examples: { en: "fashion lookbook cinematic film", ar: "فيلم أزياء سينمائي" },
    tutorials: {
      en: "fashion outfit transition tutorial",
      ar: "شرح تصوير الأزياء وانتقالات الملابس",
    },
    retryExamples: { en: "outfit change transition edit", ar: "ايديت تغيير ملابس" },
    retryTutorials: { en: "fashion lookbook filming breakdown", ar: "كواليس تصوير إعلان أزياء" },
  },
  gaming: {
    subject: { en: "gaming", ar: "قيمنق" },
    subjects: [
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
    examples: { en: "gaming montage beat sync", ar: "مونتاج قيمنق على الإيقاع" },
    tutorials: { en: "gaming montage editing tutorial", ar: "شرح مونتاج قيمز وانتقالات" },
    retryExamples: { en: "valorant gaming cinematic montage", ar: "ايديت قيمنق سينمائي" },
    retryTutorials: {
      en: "gaming montage camera transition breakdown",
      ar: "طريقة مونتاج ألعاب على الإيقاع",
    },
  },
  weddings: {
    subject: { en: "wedding", ar: "زواج" },
    subjects: ["wedding", "bride", "bridal", "groom", "زواج", "زفاف", "عروس", "عرس", "أعراس"],
    examples: { en: "cinematic wedding highlight film", ar: "فيلم زواج سينمائي" },
    tutorials: { en: "wedding film editing tutorial", ar: "شرح تصوير ومونتاج الأعراس" },
    retryExamples: { en: "wedding cinematic vows montage", ar: "مونتاج زفاف سينمائي" },
    retryTutorials: { en: "wedding videography lighting breakdown", ar: "كواليس تصوير فيلم زواج" },
  },
  gym: {
    subject: { en: "gym", ar: "جيم" },
    subjects: [
      "gym",
      "fitness",
      "workout",
      "bodybuilding",
      "جيم",
      "نادي",
      "لياقة",
      "تمرين",
      "كمال اجسام",
    ],
    examples: { en: "gym cinematic workout edit", ar: "ايديت جيم سينمائي" },
    tutorials: { en: "gym videography lighting tutorial", ar: "شرح تصوير ومونتاج الجيم" },
    retryExamples: {
      en: "fitness commercial workout montage",
      ar: "مونتاج تمارين جيم على الإيقاع",
    },
    retryTutorials: { en: "gym workout video editing breakdown", ar: "كواليس تصوير إعلان جيم" },
  },
};
