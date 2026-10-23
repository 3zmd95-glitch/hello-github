"use client";

import { Music } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { formatDate } from "@/components/rewards/formatDate";
import { useToday } from "@/components/today/useToday";
import Chip from "@/components/ui/ios/Chip";
import { useT } from "@/lib/i18n";
import { lastRitual, RITUAL_NAME_MAX, RITUAL_SOUNDS, ritualTexts } from "@/lib/soundRitual";
import { useStore } from "@/store";

const blank = () => Array.from({ length: RITUAL_SOUNDS }, () => "");

/**
 * The weekly "paste 3 Instagram sounds" card (scout 02, planning/tools/08-trends.md): Instagram has no trends API,
 * so the owner opens the app's Trending audio list, types the top three sounds (and a format, if one stands out)
 * and saves them as Instagram trend ideas. The card shows the last paste with its day and calls it old after a week
 * (lib/soundRitual). There is no reminder, no notification and no inbox row: he opens it when he wants to. The
 * sounds are what he typed, dated by the day he pasted them, and the card says so.
 */
export default function SoundRitual() {
  const { t, lang } = useT();
  const today = useToday();
  const ideas = useStore((s) => s.ideas);
  const addIdea = useStore((s) => s.addIdea);
  const [sounds, setSounds] = useState<string[]>(blank);
  const [format, setFormat] = useState("");
  const [savedCount, setSavedCount] = useState<number | null>(null);

  const last = useMemo(() => lastRitual(ideas, today), [ideas, today]);
  const typed = sounds.some((s) => s.trim()) || format.trim() !== "";

  const save = (e: FormEvent) => {
    e.preventDefault();
    const texts = ritualTexts({ sounds, format, day: today, lang, ideas });
    for (const text of texts) addIdea({ text, source: "trend", platform: "instagram" });
    setSounds(blank());
    setFormat("");
    setSavedCount(texts.length);
  };

  return (
    <section
      className="flex flex-col gap-1.5"
      data-testid="trends-ritual"
      aria-label={t("trends.ritual.title")}
    >
      <header className="flex flex-col gap-0.5 px-4">
        <h3 className="text-ink-2 text-[13px] font-semibold">{t("trends.ritual.title")}</h3>
        <p className="text-muted text-xs">{t("trends.ritual.steps")}</p>
      </header>
      <form className="ios-card flex flex-col gap-2.5" onSubmit={save}>
        {sounds.map((value, i) => (
          <input
            key={i}
            type="text"
            className="px-input"
            dir="auto"
            value={value}
            maxLength={RITUAL_NAME_MAX}
            placeholder={t("trends.ritual.soundPh")}
            aria-label={t("trends.ritual.sound", { n: i + 1 })}
            autoComplete="off"
            enterKeyHint="next"
            onChange={(e) => {
              setSounds((all) => all.map((s, j) => (j === i ? e.target.value : s)));
              setSavedCount(null);
            }}
            data-testid={`ritual-sound-${i}`}
          />
        ))}
        <input
          type="text"
          className="px-input"
          dir="auto"
          value={format}
          maxLength={RITUAL_NAME_MAX}
          placeholder={t("trends.ritual.formatPh")}
          aria-label={t("trends.ritual.format")}
          autoComplete="off"
          enterKeyHint="done"
          onChange={(e) => {
            setFormat(e.target.value);
            setSavedCount(null);
          }}
          data-testid="ritual-format"
        />
        <button type="submit" className="px-btn w-full" disabled={!typed} data-testid="ritual-save">
          {t("trends.ritual.save")}
        </button>
        {savedCount !== null && savedCount > 0 && (
          <p className="text-tint text-xs" role="status" data-testid="ritual-saved">
            {t("trends.ritual.saved", { n: savedCount })}
          </p>
        )}
      </form>
      {last ? (
        <div
          className="ios-card flex flex-col gap-2"
          data-testid="ritual-last"
          data-day={last.day}
          data-stale={last.stale}
        >
          <p className="flex flex-wrap items-center gap-2 text-[13px] font-semibold">
            <Music size={16} strokeWidth={1.75} className="text-muted shrink-0" aria-hidden />
            <span data-testid="ritual-last-date">
              {t("trends.ritual.last", { date: formatDate(`${last.day}T12:00:00+03:00`, lang) })}
            </span>
            {last.stale && (
              <Chip tone="warn" data-testid="ritual-old">
                {t("trends.ritual.old")}
              </Chip>
            )}
          </p>
          <ul className="flex flex-col gap-1 text-[13px]">
            {last.sounds.map((s) => (
              <li key={s.id} dir="auto" data-testid="ritual-last-sound">
                {s.name}
              </li>
            ))}
            {last.formats.map((f) => (
              <li key={f.id} dir="auto" className="text-ink-2" data-testid="ritual-last-format">
                {f.name}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-ink-2 px-4 text-[13px]" data-testid="ritual-none">
          {t("trends.ritual.none")}
        </p>
      )}
      <p className="text-muted px-4 text-xs">{t("trends.ritual.note")}</p>
    </section>
  );
}
