import type { LText } from "@/lib/domain";

/**
 * What each rank adds to the avatar (master plan round 9, cumulative): the item shown on a rank card as its
 * unlock. Index = rank index (0..16). Kept as data next to the gallery rather than dictionary keys because it
 * mirrors what `components/game/PixelScene.tsx` draws for the same index.
 */
export const EVOLUTION: readonly LText[] = [
  { ar: "تيشيرت + جوال", en: "Tee + phone" },
  { ar: "قميص فوقي (أوفرشيرت)", en: "Overshirt" },
  { ar: "حزام كاميرا", en: "Camera strap" },
  { ar: "جزمة خضرا", en: "Green sneakers" },
  { ar: "سماعات على الرقبة", en: "Neck headphones" },
  { ar: "إضاءة سوفت بوكس", en: "Softbox light" },
  { ar: "كاميرا ميرورلس + شرارات ألوان", en: "Mirrorless + color sparkles" },
  { ar: "سماعات ستوديو", en: "Studio headphones" },
  { ar: "جاكيت بومبر", en: "Bomber jacket" },
  { ar: "جزيئات فيوجن", en: "Fusion particles" },
  { ar: "كاميرا سينما + كلاكيت (بلاتوه تصوير)", en: "Cinema camera + clapperboard (film set)" },
  { ar: "بشت مقصّب بالذهب", en: "Gold-trimmed bisht" },
  { ar: "ساعة وسلسال ذهب + أرضية ذهب", en: "Gold watch & chain + gold floor" },
  { ar: "صقر على الساعد", en: "Falcon on the forearm" },
  { ar: "هالة ذهبية", en: "Golden aura" },
  { ar: "خلفية كونية", en: "Cosmic backdrop" },
  { ar: "التاج", en: "The crown" },
];
