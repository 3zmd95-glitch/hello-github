"use client";

import { Lock } from "lucide-react";
import { useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import Chip from "@/components/ui/ios/Chip";
import Segmented from "@/components/ui/ios/Segmented";
import { kitMetrics } from "@/lib/businessKit";
import {
  DEFAULT_RATE_SETTINGS,
  RATE_DELIVERABLES,
  RateSettingsSchema,
  type Platform,
  type RateDeliverable,
  type RateSettings,
} from "@/lib/domain";
import { useT } from "@/lib/i18n";
import { rateQuote, rateTable } from "@/lib/rates";
import { PLATFORM_META } from "@/lib/social";
import { analyticsState, useStore } from "@/store";
import { provenance } from "./KitPreview";

const n = (v: number) => v.toLocaleString("en-US");
const num = (v: string) => Math.min(1_000_000, Math.max(0, Number(v) || 0));

/**
 * 💰 The rate calculator (planning/tools/09 D3): one platform's followers and average views from Growth (each with
 * its source), the owner's own SAR-per-thousand assumptions and a multiplier per deliverable. The calculation is
 * shown line by line. Private: the media-kit page only says "rates on request".
 */
export default function RateCalculator() {
  const { t, lang } = useT();
  const prefs = useStore((s) => s.businessPrefs);
  const featured = useStore((s) => s.businessKit?.featuredPlatforms);
  const analytics = useStore(useShallow(analyticsState));
  const [platform, setPlatform] = useState<Platform | "">("");
  const [deliverable, setDeliverable] = useState<RateDeliverable>("post");

  const metrics = useMemo(
    () => kitMetrics(analytics, new Date(), featured?.length ? featured : undefined),
    [analytics, featured],
  );
  const withFollowers = metrics.filter(
    (m) => m.followers.source === "snapshot" && m.followers.value > 0,
  );
  const m = withFollowers.find((x) => x.platform === platform) ?? withFollowers[0] ?? null;
  const followers = m?.followers.source === "snapshot" ? m.followers.value : null;
  const avgViews = m && m.avgViews.source !== "none" ? m.avgViews.value : null;
  const rates = prefs.rates;
  const quote = rateQuote(rates, followers, avgViews, deliverable);
  const table = rateTable(rates, followers, avgViews);

  const setRates = (next: RateSettings) =>
    useStore.getState().setBusinessPrefs({ ...useStore.getState().businessPrefs, rates: next });
  const label = (text: string) => (
    <span className="text-ink-2 text-[13px] font-semibold">{text}</span>
  );
  const name = (d: RateDeliverable) => t(`business.deliverable.${d}`);

  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="rates-screen">
      <section className="ios-card flex min-w-0 flex-col gap-3 p-4">
        <h2 className="text-[15px] font-semibold">{t("business.rates.title")}</h2>
        <p className="text-ink-2 flex items-center gap-1.5 text-[13px]" data-testid="rates-private">
          <Lock size={14} strokeWidth={1.75} aria-hidden />
          {t("business.rates.private")}
        </p>
        <p className="text-ink-2 text-[13px] font-semibold" data-testid="rates-note">
          {t("business.rates.note")}
        </p>

        {!m || !quote ? (
          <p className="text-[14px]" data-testid="rates-empty">
            {t("business.rates.noPlatforms")}
          </p>
        ) : (
          <>
            <label className="flex min-w-0 flex-col gap-1">
              {label(t("business.rates.platform"))}
              <select
                className="px-input"
                value={m.platform}
                onChange={(e) => setPlatform(e.target.value as Platform)}
                data-testid="rates-platform"
              >
                {withFollowers.map((x) => (
                  <option key={x.platform} value={x.platform}>
                    {PLATFORM_META[x.platform].name[lang]}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex flex-col gap-1">
              {label(t("business.rates.deliverable"))}
              <Segmented
                role="radiogroup"
                label={t("business.rates.deliverable")}
                value={deliverable}
                onChange={setDeliverable}
                options={RATE_DELIVERABLES.map((d) => ({
                  value: d,
                  label: name(d),
                  testId: `rates-d-${d}`,
                }))}
              />
            </div>

            <ul className="flex flex-col gap-1" data-testid="rates-inputs">
              <li className="flex flex-wrap items-baseline gap-x-2 text-[14px]">
                <span className="text-ink-2">{t("business.rates.followers")}</span>
                <b dir="ltr">{n(quote.followers)}</b>
                {m.followers.source !== "none" && (
                  <Chip className="max-w-full text-[12px]">{provenance(lang, m.followers)}</Chip>
                )}
              </li>
              <li className="flex flex-wrap items-baseline gap-x-2 text-[14px]">
                <span className="text-ink-2">{t("business.rates.avgViews")}</span>
                <b dir="ltr">{quote.avgViews === null ? "—" : n(quote.avgViews)}</b>
                <Chip className="max-w-full text-[12px]">{provenance(lang, m.avgViews)}</Chip>
              </li>
            </ul>
            {quote.viewsMissing && (
              <p className="bg-warn-bg rounded-xl p-3 text-[13px]" data-testid="rates-no-views">
                {t("business.rates.noViews")}
              </p>
            )}

            <p className="text-[24px] font-bold" dir="auto" data-testid="rates-result">
              {t("business.rates.result", { sar: n(quote.sar) })}
            </p>
            <p className="text-ink-2 text-[13px]" data-testid="rates-explain">
              {quote.viewsMissing
                ? t("business.rates.explainNoViews", {
                    followers: n(quote.followers),
                    perK: rates.sarPerThousandFollowers,
                    mult: quote.multiplier,
                    raw: n(quote.raw),
                    sar: n(quote.sar),
                  })
                : t("business.rates.explain", {
                    followers: n(quote.followers),
                    perK: rates.sarPerThousandFollowers,
                    views: n(quote.avgViews ?? 0),
                    perV: rates.sarPerThousandViews,
                    mult: quote.multiplier,
                    raw: n(quote.raw),
                    sar: n(quote.sar),
                  })}
            </p>

            <h3 className="text-ink-2 mt-1 text-[13px] font-semibold">
              {t("business.rates.table")}
            </h3>
            <ul className="flex flex-col">
              {table.map((row) => (
                <li
                  key={row.deliverable}
                  className="border-hair flex items-baseline justify-between gap-2 border-t py-1.5 text-[14px] first:border-t-0"
                  data-testid="rates-row"
                  data-deliverable={row.deliverable}
                >
                  <span>{name(row.deliverable)}</span>
                  <b dir="auto">
                    {row.quote ? t("business.rates.result", { sar: n(row.quote.sar) }) : "—"}
                  </b>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="ios-card flex min-w-0 flex-col gap-2 p-4" data-testid="rates-settings">
        <h2 className="text-[15px] font-semibold">{t("business.rates.settings")}</h2>
        <p className="text-ink-2 text-[13px]">{t("business.rates.settingsHint")}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex min-w-0 flex-col gap-1">
            {label(t("business.rates.perK"))}
            <input
              className="px-input"
              type="number"
              inputMode="decimal"
              min={0}
              dir="ltr"
              value={rates.sarPerThousandFollowers}
              onChange={(e) => setRates({ ...rates, sarPerThousandFollowers: num(e.target.value) })}
              data-testid="rates-perk"
            />
          </label>
          <label className="flex min-w-0 flex-col gap-1">
            {label(t("business.rates.perV"))}
            <input
              className="px-input"
              type="number"
              inputMode="decimal"
              min={0}
              dir="ltr"
              value={rates.sarPerThousandViews}
              onChange={(e) => setRates({ ...rates, sarPerThousandViews: num(e.target.value) })}
              data-testid="rates-perv"
            />
          </label>
          {RATE_DELIVERABLES.map((d) => (
            <label key={d} className="flex min-w-0 flex-col gap-1">
              {label(t("business.rates.mult", { deliverable: name(d) }))}
              <input
                className="px-input"
                type="number"
                inputMode="decimal"
                min={0}
                step={0.1}
                dir="ltr"
                value={rates.multiplier[d]}
                onChange={(e) =>
                  setRates({
                    ...rates,
                    multiplier: { ...rates.multiplier, [d]: num(e.target.value) },
                  })
                }
                data-testid={`rates-mult-${d}`}
              />
            </label>
          ))}
        </div>
        <button
          type="button"
          className="px-btn px-btn-ghost px-btn-sm self-start"
          onClick={() => setRates(RateSettingsSchema.parse(DEFAULT_RATE_SETTINGS))}
          data-testid="rates-reset"
        >
          {t("business.rates.reset")}
        </button>
      </section>
    </div>
  );
}
