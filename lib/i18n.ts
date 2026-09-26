import { useCallback, useEffect } from "react";
import ar from "@/messages/ar.json";
import en from "@/messages/en.json";
import type { Lang, LText } from "@/lib/domain";
import { useStore } from "@/store";

/**
 * Client-side dictionary for the dashboard (Sprint 1). Arabic (Hijazi) is the source; English mirrors its keys.
 * next-intl routing comes later with the public website.
 */

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
