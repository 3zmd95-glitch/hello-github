"use client";

import { fmtCount, fmtEngagement } from "@/components/social/growth/format";
import { isHttpsUrl } from "@/lib/articles";
import type { KitMetric, KitProjection, KitValue } from "@/lib/businessKit";
import type { Lang } from "@/lib/domain";
import { translate } from "@/lib/i18n";
import { PLATFORM_META } from "@/lib/social";

export const METRIC_ROWS = ["followers", "engagement", "avgViews", "avgLikes"] as const;
type MetricRow = (typeof METRIC_ROWS)[number];

/** A metric as text: engagement in percent, counts compact. */
export function metricText(row: MetricRow, v: KitMetric[MetricRow]): string {
  if (v.source === "none") return "–";
  return row === "engagement" ? fmtEngagement(v.value) : fmtCount(v.value);
}

/** Where a number came from, in one language (never a "live" claim: lib/businessKit). */
export function provenance(lang: Lang, v: KitValue | KitMetric["followers"]): string {
  if (v.source === "snapshot")
    return translate(lang, "business.metric.snapshot", { date: v.observedDay });
  if (v.source === "posts")
    return translate(lang, "business.metric.posts", {
      n: v.sample,
      from: v.range.from,
      to: v.range.to,
    });
  return translate(lang, "business.metric.missing");
}

const LABEL: Record<MetricRow, Parameters<typeof translate>[1]> = {
  followers: "business.metric.followers",
  engagement: "business.metric.engagement",
  avgViews: "business.metric.avgViews",
  avgLikes: "business.metric.avgLikes",
};

function Column({ lang, p }: { lang: Lang; p: KitProjection }) {
  const t = (k: Parameters<typeof translate>[1], vars?: Record<string, string | number>) =>
    translate(lang, k, vars);
  const h = "text-ink-2 mt-3 text-[13px] font-semibold";
  return (
    <section
      data-lang={lang}
      dir={lang === "ar" ? "rtl" : "ltr"}
      lang={lang}
      className="flex min-w-0 flex-col gap-1 text-[14px]"
    >
      {p.tagline[lang] && <p className="text-[18px] font-bold">{p.tagline[lang]}</p>}
      {p.bio[lang] && <p className="whitespace-pre-line">{p.bio[lang]}</p>}

      {p.metrics.length > 0 && <h3 className={h}>{t("business.kit.numbers")}</h3>}
      {p.metrics.map((m) => (
        <div key={m.platform} className="flex flex-col gap-0.5">
          <b>
            {PLATFORM_META[m.platform].name[lang]}
            {m.handle && <span className="text-ink-2 font-normal"> · @{m.handle}</span>}
            {m.stale && (
              <span className="text-ink-2 font-normal"> · {t("business.metric.stale")}</span>
            )}
          </b>
          <ul className="flex flex-col">
            {METRIC_ROWS.map((row) => (
              <li key={row}>
                {t(LABEL[row])}: <bdi>{metricText(row, m[row])}</bdi>{" "}
                <small className="text-ink-2">({provenance(lang, m[row])})</small>
              </li>
            ))}
          </ul>
        </div>
      ))}

      {p.services.length > 0 && <h3 className={h}>{t("business.kit.services")}</h3>}
      {p.services.map((s, i) => (
        <p key={i}>
          <b>{s.name[lang]}</b>
          {s.desc[lang] && <> · {s.desc[lang]}</>}
        </p>
      ))}

      {p.rateCard.length > 0 && <h3 className={h}>{t("business.kit.rates")}</h3>}
      {p.rateCard.map((r, i) => (
        <p key={i}>
          {r.deliverable[lang]}
          {r.platform && <> · {PLATFORM_META[r.platform].name[lang]}</>}:{" "}
          <bdi>
            {r.priceSar === null
              ? t("business.price.ask")
              : t("business.price.sar", { n: r.priceSar })}
          </bdi>
          {r.note[lang] && <small className="text-ink-2"> · {r.note[lang]}</small>}
        </p>
      ))}

      {p.pastWork.length > 0 && <h3 className={h}>{t("business.kit.work")}</h3>}
      {p.pastWork.map((w, i) => {
        const title = w.title[lang] || w.title[lang === "ar" ? "en" : "ar"];
        return (
          <p key={i}>
            {isHttpsUrl(w.url) ? (
              <a href={w.url.trim()} target="_blank" rel="noreferrer noopener" className="px-link">
                {title || w.url}
              </a>
            ) : (
              title
            )}
            {w.day && <small className="text-ink-2"> · {w.day}</small>}
          </p>
        );
      })}

      {(p.contact.email || p.contact.website || p.contact.location[lang]) && (
        <h3 className={h}>{t("business.kit.contact")}</h3>
      )}
      {p.contact.email && (
        <p>
          <bdi>{p.contact.email}</bdi>
        </p>
      )}
      {isHttpsUrl(p.contact.website) && (
        <p>
          <a
            href={p.contact.website.trim()}
            className="px-link"
            target="_blank"
            rel="noreferrer noopener"
          >
            <bdi>{p.contact.website.trim()}</bdi>
          </a>
        </p>
      )}
      {p.contact.location[lang] && <p>{p.contact.location[lang]}</p>}
    </section>
  );
}

/**
 * The printable media kit (packet DT-5): Arabic and English side by side on wide screens, stacked on a phone, each in
 * its own direction. Always in the page as the print root (`[data-print-root]`, app/globals.css `@media print`);
 * shown on screen only while `open`.
 */
export default function KitPreview({
  projection,
  unsaved,
  open,
}: {
  projection: KitProjection;
  unsaved: boolean;
  open: boolean;
}) {
  return (
    <article
      data-print-root
      data-testid="kit-preview"
      className={`ios-card flex-col gap-3 p-4 ${open ? "flex" : "hidden print:flex"}`}
    >
      {unsaved && (
        <p className="bg-warn-bg rounded-xl p-2 text-[13px]" data-testid="kit-preview-draft">
          {translate("ar", "business.kit.draft")} · {translate("en", "business.kit.draft")}
        </p>
      )}
      <div className="grid gap-6 md:grid-cols-2">
        <Column lang="ar" p={projection} />
        <Column lang="en" p={projection} />
      </div>
    </article>
  );
}
