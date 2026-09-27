"use client";

import { useMemo, useState } from "react";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { formatDayShort } from "@/components/planner/weekLabel";
import {
  AGE_BUCKETS,
  countryName,
  demographicsFor,
  flagEmoji,
  latestDemographicsDay,
} from "@/lib/analytics";
import type { Demographic, Gender, Platform } from "@/lib/domain";
import { useT } from "@/lib/i18n";
import { PLATFORM_META } from "@/lib/social";
import { useStore } from "@/store";
import { fmtEngagement } from "./format";

type AgeView = "all" | Gender;
type GeoView = "country" | "city";

/** True when the platform has at least one audience breakdown row. */
export function hasDemographics(demographics: readonly Demographic[], platform: Platform): boolean {
  return demographics.some((d) => d.platform === platform);
}

/**
 * "<Platform> Demographics": gender as a two-tone donut, age × gender as thin horizontal bars with an
 * All / Male / Female toggle, and geography (countries, cities when present) with flag + name + %.
 */
export default function Demographics({
  platform,
  demographics,
  onAdd,
}: {
  platform: Platform;
  demographics: readonly Demographic[];
  onAdd: () => void;
}) {
  const { t, L, lang } = useT();
  const clearDemographics = useStore((s) => s.clearDemographics);
  const [ageView, setAgeView] = useState<AgeView>("all");
  const [geoView, setGeoView] = useState<GeoView>("country");
  const [clearing, setClearing] = useState(false);
  const name = L(PLATFORM_META[platform].name);

  const mine = useMemo(
    () => demographics.filter((d) => d.platform === platform),
    [demographics, platform],
  );
  const day = latestDemographicsDay(mine, platform);
  const genderRows = demographicsFor(mine, platform, "gender");
  const male = genderRows.find((r) => r.key === "male")?.pct ?? null;
  const female = genderRows.find((r) => r.key === "female")?.pct ?? null;

  const ageDay = latestDemographicsDay(mine, platform, "age");
  const ageRows = demographicsFor(
    mine,
    platform,
    "age",
    ageView === "all" ? {} : { gender: ageView },
  );
  const bucketsOnDay = new Set(
    mine.filter((d) => d.dimension === "age" && d.day === ageDay).map((d) => d.key),
  );
  const buckets: string[] = [
    ...AGE_BUCKETS.filter((b) => bucketsOnDay.has(b)),
    ...[...bucketsOnDay].filter((b) => !(AGE_BUCKETS as readonly string[]).includes(b)).sort(),
  ];
  const bars = buckets.map((bucket) => ({
    bucket,
    pct: ageRows.find((r) => r.key === bucket)?.pct ?? 0,
  }));
  const maxAge = bars.reduce((m, b) => Math.max(m, b.pct), 0);

  const countries = demographicsFor(mine, platform, "country");
  const cities = demographicsFor(mine, platform, "city");
  const geo: GeoView = geoView === "city" && cities.length ? "city" : "country";
  const geoRows = geo === "city" ? cities : countries;
  const maxGeo = geoRows.reduce((m, r) => Math.max(m, r.pct), 0);

  return (
    <section
      className="px-card flex flex-col gap-3"
      data-testid="demographics"
      data-day={day ?? ""}
    >
      <header className="flex flex-wrap items-center gap-2">
        <h2 className="text-base">{t("growth.demo.title", { platform: name })}</h2>
        {day && (
          <span className="px-chip num" data-testid="demo-day">
            {t("growth.demo.asOf", { day: formatDayShort(day, lang) })}
          </span>
        )}
        <div className="ms-auto flex gap-2">
          <button
            type="button"
            className="px-btn px-btn-ghost px-btn-sm"
            onClick={onAdd}
            data-testid="demo-add"
          >
            ✍️ {t("growth.demo.add")}
          </button>
          <button
            type="button"
            className="px-btn px-btn-ghost px-btn-sm"
            onClick={() => setClearing(true)}
            aria-label={t("growth.demo.clear")}
            title={t("growth.demo.clear")}
            data-testid="demo-clear"
          >
            ✕
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {/* Gender */}
        {genderRows.length > 0 && (
          <div
            className="px-inset flex flex-col gap-2"
            data-testid="demo-gender"
            data-male={male ?? ""}
            data-female={female ?? ""}
          >
            <h3 className="text-ink-2 text-xs font-semibold">{t("growth.demo.gender")}</h3>
            <div className="flex items-center gap-4">
              <GenderDonut
                male={male}
                female={female}
                label={`${t("growth.demo.male")} ${fmtEngagement(male)}, ${t("growth.demo.female")} ${fmtEngagement(female)}`}
              />
              <ul className="flex flex-col gap-1.5 text-sm">
                <li className="flex items-center gap-2">
                  <i className="an-swatch" style={{ background: "var(--ink)" }} aria-hidden />
                  <span className="text-ink-2">{t("growth.demo.male")}</span>
                  <b className="num ms-auto">{fmtEngagement(male)}</b>
                </li>
                <li className="flex items-center gap-2">
                  <i className="an-swatch" style={{ background: "var(--muted)" }} aria-hidden />
                  <span className="text-ink-2">{t("growth.demo.female")}</span>
                  <b className="num ms-auto">{fmtEngagement(female)}</b>
                </li>
              </ul>
            </div>
          </div>
        )}

        {/* Age × gender */}
        {buckets.length > 0 && (
          <div
            className="px-inset flex flex-col gap-2"
            data-testid="demo-age"
            data-gender={ageView}
          >
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-ink-2 text-xs font-semibold">{t("growth.demo.age")}</h3>
              <div className="an-toggle ms-auto" role="group" aria-label={t("growth.demo.age")}>
                {(["all", "male", "female"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={ageView === v}
                    onClick={() => setAgeView(v)}
                    data-testid={`demo-age-toggle-${v}`}
                  >
                    {v === "all"
                      ? t("growth.demo.ageAll")
                      : v === "male"
                        ? t("growth.demo.male")
                        : t("growth.demo.female")}
                  </button>
                ))}
              </div>
            </div>
            {ageRows.length === 0 && (
              <p className="text-muted text-xs" data-testid="demo-age-empty">
                {t("growth.demo.ageNoSplit")}
              </p>
            )}
            <ul className="flex flex-col gap-1.5">
              {bars.map((b) => (
                <li
                  key={b.bucket}
                  className="flex items-center gap-2 text-sm"
                  data-testid="demo-age-bar"
                  data-bucket={b.bucket}
                  data-pct={b.pct}
                >
                  <span className="num text-ink-2 w-12 shrink-0 text-xs" dir="ltr">
                    {b.bucket}
                  </span>
                  <span className="an-bar flex-1">
                    <i style={{ width: `${maxAge > 0 ? (b.pct / maxAge) * 100 : 0}%` }} />
                  </span>
                  <b className="num w-12 shrink-0 text-end text-xs">{fmtEngagement(b.pct)}</b>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Geography */}
        {countries.length + cities.length > 0 && (
          <div className="px-inset flex flex-col gap-2" data-testid="demo-geo" data-mode={geo}>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-ink-2 text-xs font-semibold">{t("growth.demo.geo")}</h3>
              {cities.length > 0 && (
                <div className="an-toggle ms-auto" role="group" aria-label={t("growth.demo.geo")}>
                  {(["country", "city"] as const).map((v) => (
                    <button
                      key={v}
                      type="button"
                      aria-pressed={geo === v}
                      onClick={() => setGeoView(v)}
                      data-testid={`demo-geo-toggle-${v}`}
                    >
                      {v === "country" ? t("growth.demo.countries") : t("growth.demo.cities")}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <ul className="flex flex-col gap-1.5">
              {geoRows.map((r) => (
                <li
                  key={r.key}
                  className="flex items-center gap-2 text-sm"
                  data-testid="demo-geo-row"
                  data-key={r.key}
                  data-pct={r.pct}
                >
                  <span aria-hidden className="w-5 shrink-0 text-center">
                    {geo === "city" ? "📍" : flagEmoji(r.key)}
                  </span>
                  <span className="w-24 shrink-0 truncate text-xs font-semibold">
                    {geo === "city" ? r.key : countryName(r.key, lang)}
                  </span>
                  <span className="an-bar flex-1">
                    <i style={{ width: `${maxGeo > 0 ? (r.pct / maxGeo) * 100 : 0}%` }} />
                  </span>
                  <b className="num w-12 shrink-0 text-end text-xs">{fmtEngagement(r.pct)}</b>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {clearing && (
        <ConfirmDialog
          title={t("growth.demo.clearTitle")}
          body={t("growth.demo.clearBody", { platform: name })}
          confirmLabel={t("growth.demo.clear")}
          danger
          onCancel={() => setClearing(false)}
          onConfirm={() => {
            clearDemographics(platform);
            setClearing(false);
          }}
        />
      )}
    </section>
  );
}

/** Two-tone donut: the male share in `--ink`, the rest in `--muted` (Beacons' black / grey pie, on dark). */
function GenderDonut({
  male,
  female,
  label,
}: {
  male: number | null;
  female: number | null;
  label: string;
}) {
  const total = (male ?? 0) + (female ?? 0);
  const share = total > 0 ? (male ?? 0) / total : 0;
  const r = 38;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 100 100" className="an-donut shrink-0" role="img" aria-label={label}>
      <circle cx="50" cy="50" r={r} fill="none" stroke="var(--muted)" strokeWidth="14" />
      <circle
        cx="50"
        cy="50"
        r={r}
        fill="none"
        stroke="var(--ink)"
        strokeWidth="14"
        strokeDasharray={`${share * c} ${c}`}
        transform="rotate(-90 50 50)"
      />
      <text x="50" y="54" textAnchor="middle" className="an-donut-label">
        {fmtEngagement(male)}
      </text>
    </svg>
  );
}
