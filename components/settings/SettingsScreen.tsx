"use client";

import type { Gear } from "@/lib/domain";
import { useT } from "@/lib/i18n";
import { useStore } from "@/store";
import pkg from "@/package.json";
import ApiKeysCard from "./ApiKeysCard";
import AvatarCard from "./AvatarCard";
import Card from "./Card";
import DataCard from "./DataCard";
import GenresCard from "./GenresCard";

const GEAR_OPTIONS: readonly Exclude<Gear, "any">[] = [
  "phone",
  "lights",
  "camera",
  "gimbal",
  "mic",
];
const GEAR_ICON: Record<Exclude<Gear, "any">, string> = {
  phone: "📱",
  lights: "💡",
  camera: "📷",
  gimbal: "🎥",
  mic: "🎙️",
};

export default function SettingsScreen() {
  const { t } = useT();
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);

  const toggleGear = (g: Gear) => {
    const has = settings.gear.includes(g);
    setSettings({ gear: has ? settings.gear.filter((x) => x !== g) : [...settings.gear, g] });
  };

  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl">{t("settings.title")}</h1>
        <p className="text-ink-2 text-sm">{t("settings.sub")}</p>
      </header>

      <AvatarCard />

      <Card title={t("settings.lang")}>
        <Segmented
          name="lang"
          value={settings.lang}
          options={[
            { value: "ar", label: "العربي" },
            { value: "en", label: "English" },
          ]}
          onChange={(lang) => setSettings({ lang })}
        />
      </Card>

      <Card title={t("settings.sound")} note={t("settings.soundDesc")}>
        <Segmented
          name="sound"
          value={settings.sound ? "on" : "off"}
          options={[
            { value: "on", label: `🔊 ${t("settings.on")}` },
            { value: "off", label: `🔇 ${t("settings.off")}` },
          ]}
          onChange={(v) => setSettings({ sound: v === "on" })}
        />
      </Card>

      <Card title={t("settings.reminder")} note={t("settings.reminderNote")}>
        <input
          type="time"
          className="px-input num max-w-[160px]"
          value={settings.reminderTime}
          aria-label={t("settings.reminder")}
          onChange={(e) => {
            if (/^([01]\d|2[0-3]):[0-5]\d$/.test(e.target.value))
              setSettings({ reminderTime: e.target.value });
          }}
        />
      </Card>

      <Card title={t("settings.gear")} note={t("settings.gearNote")}>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" data-testid="gear-list">
          {GEAR_OPTIONS.map((g) => {
            const on = settings.gear.includes(g);
            return (
              <label
                key={g}
                className={`px-inset flex items-center gap-2 ${on ? "border-accent" : ""}`}
                data-testid={`gear-${g}`}
              >
                <input
                  type="checkbox"
                  className="size-5 accent-[var(--accent)]"
                  checked={on}
                  onChange={() => toggleGear(g)}
                />
                <span aria-hidden>{GEAR_ICON[g]}</span>
                <span className="font-semibold">{t(`gear.${g}`)}</span>
              </label>
            );
          })}
        </div>
      </Card>

      <GenresCard />

      <ApiKeysCard />

      <Card title={t("settings.davinci")}>
        <Segmented
          name="davinci"
          value={settings.davinciEdition}
          options={[
            { value: "studio", label: t("settings.studio") },
            { value: "free", label: t("settings.free") },
          ]}
          onChange={(davinciEdition) => setSettings({ davinciEdition })}
        />
      </Card>

      <DataCard />

      <p className="text-muted text-center text-xs">
        {t("app.name")} · <span className="num">{t("settings.version", { v: pkg.version })}</span>
      </p>

    </>
  );
}

function Segmented<V extends string>({
  name,
  value,
  options,
  onChange,
}: {
  name: string;
  value: V;
  options: { value: V; label: string }[];
  onChange: (v: V) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={name}
      className="border-edge bg-edge flex w-fit max-w-full flex-wrap gap-[2px] rounded-[2px] border-2"
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`px-4 py-1.5 text-sm font-bold ${value === o.value ? "bg-gold text-gold-ink" : "bg-panel-2 text-ink-2"}`}
          data-testid={`${name}-${o.value}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
