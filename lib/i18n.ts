import { useCallback, useEffect } from "react";
import arBase from "@/messages/ar.json";
import enBase from "@/messages/en.json";
import arMap from "@/messages/map.ar.json";
import enMap from "@/messages/map.en.json";
import arPlanner from "@/messages/planner.ar.json";
import enPlanner from "@/messages/planner.en.json";
import arReview from "@/messages/review.ar.json";
import enReview from "@/messages/review.en.json";
import arRewards from "@/messages/rewards.ar.json";
import enRewards from "@/messages/rewards.en.json";
import arToday from "@/messages/today.ar.json";
import enToday from "@/messages/today.en.json";
import arXp from "@/messages/xp.ar.json";
import enXp from "@/messages/xp.en.json";
import arSocial from "@/messages/social.ar.json";
import enSocial from "@/messages/social.en.json";
import arCalendar from "@/messages/calendar.ar.json";
import enCalendar from "@/messages/calendar.en.json";
import arGrowth from "@/messages/growth.ar.json";
import enGrowth from "@/messages/growth.en.json";
import arIdeas from "@/messages/ideas.ar.json";
import enIdeas from "@/messages/ideas.en.json";
import arPublish from "@/messages/publish.ar.json";
import enPublish from "@/messages/publish.en.json";
import arReplies from "@/messages/replies.ar.json";
import enReplies from "@/messages/replies.en.json";
import arTrends from "@/messages/trends.ar.json";
import enTrends from "@/messages/trends.en.json";
import arGenres from "@/messages/genres.ar.json";
import enGenres from "@/messages/genres.en.json";
import arPlayer from "@/messages/player.ar.json";
import enPlayer from "@/messages/player.en.json";
import arSearch from "@/messages/search.ar.json";
import enSearch from "@/messages/search.en.json";
import arCreator from "@/messages/creator.ar.json";
import enCreator from "@/messages/creator.en.json";
import arTikTok from "@/messages/tiktok.ar.json";
import enTikTok from "@/messages/tiktok.en.json";
import arInspiration from "@/messages/inspiration.ar.json";
import enInspiration from "@/messages/inspiration.en.json";
import type { Lang, LText } from "@/lib/domain";
import { useStore } from "@/store";

/**
 * Client-side dictionary for the dashboard (Sprint 1). Arabic (Hijazi) is the source; English mirrors its keys.
 * next-intl routing comes later with the public website.
 *
 * The dictionary is split by feature so screens built in parallel never edit the same file:
 * `messages/ar.json` + `en.json` hold the Sprint 1 keys; `messages/<feature>.{ar,en}.json` hold one feature each
 * (map, planner, review, rewards, xp = celebrations/store feedback, today = Today-screen additions).
 * Keys must be unique across all files (messages.test.ts checks parity and collisions).
 */

/** Every dictionary pair, in merge order. Add a feature here and in messages.test.ts. */
export const MESSAGE_FILES = {
  base: { ar: arBase, en: enBase },
  map: { ar: arMap, en: enMap },
  planner: { ar: arPlanner, en: enPlanner },
  review: { ar: arReview, en: enReview },
  rewards: { ar: arRewards, en: enRewards },
  today: { ar: arToday, en: enToday },
  xp: { ar: arXp, en: enXp },
  // 📱 Social world (round 16): shell + Studio home, content calendar, growth, ideas bank.
  social: { ar: arSocial, en: enSocial },
  calendar: { ar: arCalendar, en: enCalendar },
  growth: { ar: arGrowth, en: enGrowth },
  ideas: { ar: arIdeas, en: enIdeas },
  publish: { ar: arPublish, en: enPublish },
  replies: { ar: arReplies, en: enReplies },
  // 📈 Trend Radar (round 30, planning/tools/08-trends.md).
  trends: { ar: arTrends, en: enTrends },
  // 🎬 Edit genres (round 31): the genre row of Discover / Research, the Settings card.
  genres: { ar: arGenres, en: enGenres },
  // ▶ Watch here (round 32): the in-dashboard video player and the cards' play button.
  player: { ar: arPlayer, en: enPlayer },
  // 🔎 Discover search v2 (round 33, planning/tools/13-discover-search-v2.md): the sections screen.
  search: { ar: arSearch, en: enSearch },
  creator: { ar: arCreator, en: enCreator },
  tiktok: { ar: arTikTok, en: enTikTok },
  inspiration: { ar: arInspiration, en: enInspiration },
} as const;

const ar = {
  ...arBase,
  ...arMap,
  ...arPlanner,
  ...arReview,
  ...arRewards,
  ...arToday,
  ...arXp,
  ...arSocial,
  ...arCalendar,
  ...arGrowth,
  ...arIdeas,
  ...arPublish,
  ...arReplies,
  ...arTrends,
  ...arGenres,
  ...arPlayer,
  ...arSearch,
  ...arCreator,
  ...arTikTok,
  ...arInspiration,
};
const en = {
  ...enBase,
  ...enMap,
  ...enPlanner,
  ...enReview,
  ...enRewards,
  ...enToday,
  ...enXp,
  ...enSocial,
  ...enCalendar,
  ...enGrowth,
  ...enIdeas,
  ...enPublish,
  ...enReplies,
  ...enTrends,
  ...enGenres,
  ...enPlayer,
  ...enSearch,
  ...enCreator,
  ...enTikTok,
  ...enInspiration,
};

export type MessageKey = keyof typeof ar;
export type Vars = Record<string, string | number>;

const DICTS: Record<Lang, Record<MessageKey, string>> = { ar, en };

/** Replace {name} placeholders. Unknown placeholders are left as they are. */
export function format(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** Translate outside React (e.g. in event handlers that only have the language). */
export function translate(lang: Lang, key: MessageKey, vars?: Vars): string {
  return format(DICTS[lang][key] ?? DICTS.ar[key] ?? key, vars);
}

export function pickL(lang: Lang, text: LText): string {
  return text[lang] || text.ar;
}

export function dirFor(lang: Lang): "rtl" | "ltr" {
  return lang === "ar" ? "rtl" : "ltr";
}

export interface I18n {
  lang: Lang;
  dir: "rtl" | "ltr";
  t: (key: MessageKey, vars?: Vars) => string;
  L: (text: LText) => string;
}

export function useT(): I18n {
  const lang = useStore((s) => s.settings.lang);
  const t = useCallback((key: MessageKey, vars?: Vars) => translate(lang, key, vars), [lang]);
  const L = useCallback((text: LText) => pickL(lang, text), [lang]);
  return { lang, dir: dirFor(lang), t, L };
}

/** Keep <html lang dir> in sync with the chosen language. Mount once (the app shell does). */
export function useDocumentLang(): void {
  const lang = useStore((s) => s.settings.lang);
  useEffect(() => {
    const el = document.documentElement;
    el.lang = lang;
    el.dir = dirFor(lang);
  }, [lang]);
}
