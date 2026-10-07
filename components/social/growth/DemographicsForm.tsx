"use client";

import { useState, type FormEvent } from "react";
import { useSheetClose } from "@/components/ui/ios/Sheet";
import { AGE_BUCKETS, parseDemographicsJson } from "@/lib/analytics";
import { PLATFORMS, type Platform } from "@/lib/domain";
import { parseNumber } from "@/lib/growth";
import { useT } from "@/lib/i18n";
import { PLATFORM_META } from "@/lib/social";
import { useStore } from "@/store";
import GrowthDialog from "./GrowthDialog";

const COUNTRY_SLOTS = 6;

const JSON_EXAMPLE =
  '{ "platform": "tiktok", "day": "2026-09-27", "gender": { "male": 56, "female": 44 }, "age": { "18-24": 25, "25-34": 53 }, "country": { "Saudi Arabia": 73.1, "others": 16 } }';

/**
 * Manual audience breakdown (TikTok Studio → Analytics → Followers, typed by hand): a small form (gender %,
 * age buckets %, top 6 countries) or a raw JSON entry; both go through parseDemographicsJson. In a sheet.
 */
export default function DemographicsForm({
  platform,
  today,
  onClose,
}: {
  platform?: Platform;
  today: string;
  onClose: () => void;
}) {
  const { t } = useT();
  return (
    <GrowthDialog title={t("growth.demo.form.title")} testId="demo-dialog" onClose={onClose}>
      <DemographicsFields platform={platform} today={today} />
    </GrowthDialog>
  );
}

/** The form inside the sheet: Save and Cancel close it with its exit animation. */
function DemographicsFields({ platform: preset, today }: { platform?: Platform; today: string }) {
  const { t, L } = useT();
  const close = useSheetClose();
  const importDemographics = useStore((s) => s.importDemographics);
  const [mode, setMode] = useState<"form" | "json">("form");
  const [platform, setPlatform] = useState<Platform>(preset ?? "tiktok");
  const [day, setDay] = useState(today);
  const [male, setMale] = useState("");
  const [female, setFemale] = useState("");
  const [ages, setAges] = useState<Record<string, string>>({});
  const [countries, setCountries] = useState<{ name: string; pct: string }[]>(
    Array.from({ length: COUNTRY_SLOTS }, () => ({ name: "", pct: "" })),
  );
  const [json, setJson] = useState("");
  const [errors, setErrors] = useState<string[]>([]);

  const buildJson = (): string => {
    const entry: Record<string, unknown> = { platform, day };
    const gender: Record<string, string> = {};
    if (male.trim()) gender.male = male.trim();
    if (female.trim()) gender.female = female.trim();
    else if (male.trim()) {
      const m = parseNumber(male);
      if (m !== null && m >= 0 && m <= 100) gender.female = String(Math.round((100 - m) * 10) / 10);
    }
    if (Object.keys(gender).length) entry.gender = gender;
    const age: Record<string, string> = {};
    for (const b of AGE_BUCKETS) if (ages[b]?.trim()) age[b] = ages[b].trim();
    if (Object.keys(age).length) entry.age = age;
    const country: Record<string, string> = {};
    for (const c of countries)
      if (c.name.trim() && c.pct.trim()) country[c.name.trim()] = c.pct.trim();
    if (Object.keys(country).length) entry.country = country;
    return JSON.stringify(entry);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const text = mode === "json" ? json : buildJson();
    const parsed = parseDemographicsJson(text, today);
    if (parsed.errors.length) {
      setErrors(parsed.errors);
      return;
    }
    if (!parsed.demographics.length) {
      setErrors([t("growth.demo.form.empty")]);
      return;
    }
    importDemographics(parsed.demographics);
    close();
  };

  const setCountry = (i: number, patch: Partial<{ name: string; pct: string }>) =>
    setCountries((list) => list.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  return (
    <form className="flex flex-col gap-3" onSubmit={submit} data-testid="demo-form">
      <p className="text-ink-2 text-sm">{t("growth.demo.form.hint")}</p>
      <div className="an-toggle self-start" role="group">
        {(["form", "json"] as const).map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={mode === m}
            onClick={() => {
              setMode(m);
              setErrors([]);
            }}
            data-testid={`demo-mode-${m}`}
          >
            {m === "form" ? t("growth.demo.form.mode.form") : t("growth.demo.form.mode.json")}
          </button>
        ))}
      </div>

      {mode === "form" ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted">{t("growth.form.platform")}</span>
              <select
                className="px-input"
                value={platform}
                onChange={(e) => setPlatform(e.target.value as Platform)}
                data-testid="demo-platform"
              >
                {PLATFORMS.map((p) => (
                  <option key={p} value={p}>
                    {L(PLATFORM_META[p].name)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted">{t("growth.form.day")}</span>
              <input
                type="date"
                className="px-input num"
                value={day}
                max={today}
                required
                onChange={(e) => setDay(e.target.value)}
                data-testid="demo-day"
              />
            </label>
          </div>

          <fieldset className="flex flex-col gap-1">
            <legend className="text-muted text-xs">{t("growth.demo.form.gender")}</legend>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex items-center gap-2 text-xs">
                <span className="text-ink-2 w-12 shrink-0">{t("growth.demo.male")}</span>
                <input
                  type="text"
                  inputMode="decimal"
                  className="px-input num"
                  dir="ltr"
                  value={male}
                  onChange={(e) => setMale(e.target.value)}
                  placeholder="56"
                  data-testid="demo-male"
                />
              </label>
              <label className="flex items-center gap-2 text-xs">
                <span className="text-ink-2 w-12 shrink-0">{t("growth.demo.female")}</span>
                <input
                  type="text"
                  inputMode="decimal"
                  className="px-input num"
                  dir="ltr"
                  value={female}
                  onChange={(e) => setFemale(e.target.value)}
                  placeholder="44"
                  data-testid="demo-female"
                />
              </label>
            </div>
          </fieldset>

          <fieldset className="flex flex-col gap-1">
            <legend className="text-muted text-xs">{t("growth.demo.form.age")}</legend>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {AGE_BUCKETS.map((b) => (
                <label key={b} className="flex items-center gap-1.5 text-xs">
                  <span className="num text-ink-2 w-10 shrink-0" dir="ltr">
                    {b}
                  </span>
                  <input
                    type="text"
                    inputMode="decimal"
                    className="px-input num"
                    dir="ltr"
                    value={ages[b] ?? ""}
                    onChange={(e) => setAges((a) => ({ ...a, [b]: e.target.value }))}
                    placeholder="%"
                    data-testid={`demo-age-${b}`}
                  />
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="flex flex-col gap-1">
            <legend className="text-muted text-xs">{t("growth.demo.form.countries")}</legend>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {countries.map((c, i) => (
                <div key={i} className="grid grid-cols-[1fr_64px] gap-1.5">
                  <input
                    type="text"
                    className="px-input"
                    value={c.name}
                    onChange={(e) => setCountry(i, { name: e.target.value })}
                    placeholder={t("growth.demo.form.countryPlaceholder")}
                    aria-label={`${t("growth.demo.form.country")} ${i + 1}`}
                    data-testid={`demo-country-${i}`}
                  />
                  <input
                    type="text"
                    inputMode="decimal"
                    className="px-input num"
                    dir="ltr"
                    value={c.pct}
                    onChange={(e) => setCountry(i, { pct: e.target.value })}
                    placeholder={t("growth.demo.form.pct")}
                    aria-label={`${t("growth.demo.form.pct")} ${i + 1}`}
                    data-testid={`demo-country-pct-${i}`}
                  />
                </div>
              ))}
            </div>
          </fieldset>
        </>
      ) : (
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted">{t("growth.demo.form.jsonHint")}</span>
          <textarea
            className="px-input num min-h-[160px] text-sm"
            dir="ltr"
            value={json}
            onChange={(e) => setJson(e.target.value)}
            placeholder={JSON_EXAMPLE}
            data-testid="demo-json"
          />
        </label>
      )}

      {errors.length > 0 && (
        <ul
          className="text-danger flex flex-col gap-0.5 text-xs"
          role="alert"
          data-testid="demo-errors"
        >
          {errors.map((e, i) => (
            <li key={i} dir="ltr" className="num text-start">
              {e}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className="px-btn px-btn-ghost" onClick={close}>
          {t("common.cancel")}
        </button>
        <button type="submit" className="px-btn" data-testid="demo-save">
          {t("growth.demo.form.save")}
        </button>
      </div>
    </form>
  );
}
