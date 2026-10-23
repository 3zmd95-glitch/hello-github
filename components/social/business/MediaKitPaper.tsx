import { User } from "lucide-react";
import type { ReactNode } from "react";
import { formatDayShort } from "@/components/planner/weekLabel";
import { fmtCount, fmtEngagement } from "@/components/social/growth/format";
import Chip from "@/components/ui/ios/Chip";
import PlatformBadge from "@/components/ui/ios/PlatformBadge";
import { countryName, flagEmoji } from "@/lib/analytics";
import { isHttpsUrl } from "@/lib/articles";
import type { KitMetric, KitValue } from "@/lib/businessKit";
import type { BusinessKit, BusinessPrefs, KitBlock, Lang } from "@/lib/domain";
import { translate, type MessageKey } from "@/lib/i18n";
import type { KitAudience, KitPost, KitTotal } from "@/lib/mediaKit";
import { PLATFORM_META } from "@/lib/social";
import { dayKey } from "@/lib/streak";

/** What the page shows, already read from the store (planning/tools/09 D2). */
export interface MediaKitData {
  /** The name on the page ("" = none: the page prints a dash). */
  name: string;
  kit: BusinessKit;
  metrics: KitMetric[];
  total: KitTotal | null;
  audience: KitAudience[];
  posts: KitPost[];
  blocks: BusinessPrefs["blocks"];
  /** The day (Riyadh) the page was prepared. */
  day: string;
}

type Bi = { ar: string; en: string };
const other = (lang: Lang): Lang => (lang === "ar" ? "en" : "ar");
/** The owner's text in the page's language, else the other language (dir="auto" keeps either readable). */
const pick = (b: Bi, lang: Lang) => b[lang].trim() || b[other(lang)].trim();

/** Whether a block has anything to show (an empty block is left out of the page; the controls say so). */
export function blockHasData(block: KitBlock, d: MediaKitData): boolean {
  switch (block) {
    case "workWithMe":
      return !!d.kit.contact.email.trim() || isHttpsUrl(d.kit.contact.website);
    case "about":
      return !!(d.kit.bio.ar.trim() || d.kit.bio.en.trim());
    case "platforms":
      return d.metrics.length > 0;
    case "audience":
      return d.audience.length > 0;
    case "posts":
      return d.posts.length > 0;
    case "services":
      return d.kit.services.length > 0;
    case "work":
      return d.kit.pastWork.length > 0;
    case "rates":
      return true;
  }
}

const ROWS = ["followers", "engagement", "avgViews", "avgLikes"] as const;
type Row = (typeof ROWS)[number];

const initials = (name: string) =>
  [...name.replace(/^@/, "").trim().split(/\s+/).filter(Boolean)]
    .slice(0, 2)
    .map((w) => [...w][0]!.toUpperCase())
    .join("");

/**
 * The printable media-kit page (planning/tools/09 D2): a light A4 sheet with the hero, then the blocks the owner
 * switched on. Only stored numbers, each with its source; a missing one is a dash. Prices are never printed: the rates
 * block only says "on request". It is the page's print root (`[data-print-root]`, app/globals.css `@media print`).
 */
export default function MediaKitPaper({ data, lang }: { data: MediaKitData; lang: Lang }) {
  const t = (key: MessageKey, vars?: Record<string, string | number>) => translate(lang, key, vars);
  const { kit, metrics, total } = data;
  const show = (b: KitBlock) => data.blocks[b] && blockHasData(b, data);
  const tagline = pick(kit.tagline, lang);
  const bio = pick(kit.bio, lang);
  const email = kit.contact.email.trim();
  const site = isHttpsUrl(kit.contact.website) ? kit.contact.website.trim() : "";

  const h = (key: MessageKey) => (
    <h3 className="text-ink-2 break-after-avoid text-[13px] font-bold">{t(key)}</h3>
  );
  const box = "bg-panel-2 flex min-w-0 flex-col gap-2 rounded-2xl p-3 break-inside-avoid";
  const section = (testId: string, block: ReactNode) => (
    <section className="flex min-w-0 flex-col gap-2" data-testid={testId}>
      {block}
    </section>
  );

  const value = (row: Row, m: KitMetric): string => {
    const v = m[row];
    if (v.source === "none") return "—";
    return row === "engagement" ? fmtEngagement(v.value) : fmtCount(v.value);
  };
  const source = (v: KitValue | KitMetric["followers"]): string =>
    v.source === "snapshot"
      ? t("business.page.srcSnapshot", { date: dayLabel(v.observedDay) })
      : v.source === "posts"
        ? t("business.page.srcPosts", { n: v.sample })
        : "";

  const bar = (pct: number, max: number) => (
    <span className="bg-fill block h-1.5 min-w-10 flex-1 overflow-hidden rounded-full" aria-hidden>
      <i
        className="bg-tint block h-full rounded-full"
        style={{ width: `${max > 0 ? Math.round((pct / max) * 100) : 0}%` }}
      />
    </span>
  );
  const dayLabel = (d: string) => formatDayShort(d, lang);

  return (
    <article
      data-print-root
      data-testid="kit-page"
      dir={lang === "ar" ? "rtl" : "ltr"}
      lang={lang}
      className="kit-paper flex flex-col gap-5 text-[14px]"
    >
      <header className="flex flex-col gap-3" data-testid="kit-hero">
        <div className="flex flex-wrap items-center gap-4">
          <span
            className="bg-tint-bg text-tint grid size-16 shrink-0 place-items-center rounded-full text-[22px] font-bold"
            aria-hidden
          >
            {initials(data.name) || <User size={28} strokeWidth={1.75} />}
          </span>
          <div className="min-w-0 flex-1">
            <h2
              className="text-[26px] leading-tight font-bold break-words"
              dir="auto"
              data-testid="kit-name"
            >
              {data.name || "—"}
            </h2>
            {tagline && (
              <p className="text-ink-2 text-[15px]" dir="auto" data-testid="kit-tagline">
                {tagline}
              </p>
            )}
            {kit.contact.location[lang].trim() && (
              <p className="text-ink-2 text-[13px]" dir="auto">
                {kit.contact.location[lang]}
              </p>
            )}
          </div>
          <div className="flex flex-col items-start gap-0.5">
            <small className="text-ink-2 text-[12px] font-semibold">
              {t("business.page.totalFollowers")}
            </small>
            <b className="num text-[34px] leading-none" dir="ltr" data-testid="kit-total">
              {total ? fmtCount(total.value) : "—"}
            </b>
            {total && (
              <small className="text-muted text-[11px]" data-testid="kit-total-note">
                {t("business.page.counted", { n: total.platforms, m: total.of })}
              </small>
            )}
          </div>
        </div>
        {metrics.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {metrics.map((m) => (
              <li
                key={m.platform}
                className="bg-panel-2 flex items-center gap-1.5 rounded-full py-1 ps-1 pe-3 text-[13px]"
                data-testid={`kit-chip-${m.platform}`}
              >
                <PlatformBadge platform={m.platform} size={22} />
                <span>{PLATFORM_META[m.platform].name[lang]}</span>
                <b className="num" dir="ltr">
                  {m.followers.source === "snapshot" ? fmtCount(m.followers.value) : "—"}
                </b>
              </li>
            ))}
          </ul>
        )}
      </header>

      {show("workWithMe") && (
        <section
          className="bg-tint-bg flex min-w-0 break-inside-avoid flex-col gap-2 rounded-2xl p-4"
          data-testid="kit-work-with-me"
        >
          <h3 className="text-[16px] font-bold">{t("business.page.block.workWithMe")}</h3>
          <p>{t("business.page.workBody")}</p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {email && (
              <>
                <a className="px-btn" href={`mailto:${email}`}>
                  {t("business.page.workBtn")}
                </a>
                <bdi dir="ltr" className="font-semibold">
                  {email}
                </bdi>
              </>
            )}
            {site && (
              <a className="px-link" href={site} target="_blank" rel="noreferrer noopener">
                <bdi dir="ltr">{site}</bdi>
              </a>
            )}
          </div>
        </section>
      )}

      {show("about") &&
        section(
          "kit-about",
          <>
            {h("business.page.block.about")}
            <p className="whitespace-pre-line" dir="auto">
              {bio}
            </p>
          </>,
        )}

      {show("platforms") &&
        section(
          "kit-platforms",
          <>
            {h("business.page.block.platforms")}
            <div className="grid gap-3 @xl:grid-cols-2">
              {metrics.map((m) => (
                <div key={m.platform} className={box} data-testid={`kit-platform-${m.platform}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <PlatformBadge platform={m.platform} size={26} />
                    <b>{PLATFORM_META[m.platform].name[lang]}</b>
                    {m.handle && (
                      <span className="text-ink-2" dir="ltr">
                        @{m.handle}
                      </span>
                    )}
                    {m.stale && <Chip tone="warn">{t("business.metric.stale")}</Chip>}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {ROWS.map((row) => (
                      <div
                        key={row}
                        className="bg-panel flex min-w-0 flex-col rounded-xl p-2.5"
                        data-testid={`kit-tile-${m.platform}-${row}`}
                      >
                        <small className="text-ink-2 text-[12px]">
                          {t(`business.metric.${row}`)}
                        </small>
                        <b className="num text-[20px]" dir="ltr">
                          {value(row, m)}
                        </b>
                        {source(m[row]) && (
                          <small className="text-muted text-[10px]">{source(m[row])}</small>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </>,
        )}

      {show("audience") &&
        section(
          "kit-audience",
          <>
            {h("business.page.block.audience")}
            {data.audience.map((a) => {
              const maxAge = Math.max(0, ...a.age.map((r) => r.pct));
              const maxGeo = Math.max(0, ...a.countries.map((r) => r.pct));
              return (
                <div key={a.platform} className={box} data-testid={`kit-audience-${a.platform}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <PlatformBadge platform={a.platform} size={26} />
                    <b>{PLATFORM_META[a.platform].name[lang]}</b>
                    <small className="text-muted ms-auto text-[11px]">
                      {t("business.page.asOf", { date: dayLabel(a.day) })}
                    </small>
                  </div>
                  <div className="grid gap-3 @md:grid-cols-3">
                    {a.gender && (
                      <div className="flex flex-col gap-1.5">
                        <h4 className="text-ink-2 text-[12px] font-semibold">
                          {t("growth.demo.gender")}
                        </h4>
                        {(["male", "female"] as const).map((g) => (
                          <div key={g} className="flex items-center gap-2 text-[13px]">
                            <span className="w-14 shrink-0">{t(`growth.demo.${g}`)}</span>
                            {bar(a.gender?.[g] ?? 0, 100)}
                            <b className="num w-12 shrink-0 text-end" dir="ltr">
                              {fmtEngagement(a.gender?.[g])}
                            </b>
                          </div>
                        ))}
                      </div>
                    )}
                    {a.age.length > 0 && (
                      <div className="flex flex-col gap-1.5">
                        <h4 className="text-ink-2 text-[12px] font-semibold">
                          {t("business.page.age")}
                        </h4>
                        {a.age.map((r) => (
                          <div key={r.bucket} className="flex items-center gap-2 text-[13px]">
                            <span className="num w-12 shrink-0" dir="ltr">
                              {r.bucket}
                            </span>
                            {bar(r.pct, maxAge)}
                            <b className="num w-12 shrink-0 text-end" dir="ltr">
                              {fmtEngagement(r.pct)}
                            </b>
                          </div>
                        ))}
                      </div>
                    )}
                    {a.countries.length > 0 && (
                      <div className="flex flex-col gap-1.5">
                        <h4 className="text-ink-2 text-[12px] font-semibold">
                          {t("business.page.countries")}
                        </h4>
                        {a.countries.map((r) => (
                          <div key={r.code} className="flex items-center gap-2 text-[13px]">
                            <span aria-hidden>{flagEmoji(r.code)}</span>
                            <span className="w-20 shrink-0 truncate">
                              {countryName(r.code, lang)}
                            </span>
                            {bar(r.pct, maxGeo)}
                            <b className="num w-12 shrink-0 text-end" dir="ltr">
                              {fmtEngagement(r.pct)}
                            </b>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </>,
        )}

      {show("posts") &&
        section(
          "kit-posts",
          <>
            {h("business.page.block.posts")}
            <ul className="flex flex-col gap-1.5">
              {data.posts.map((p) => (
                <li
                  key={`${p.platform}:${p.postId}`}
                  className="bg-panel-2 flex break-inside-avoid items-center gap-2.5 rounded-xl p-2.5"
                  data-testid="kit-post"
                >
                  <PlatformBadge platform={p.platform} size={26} />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate font-semibold" dir="auto">
                      {p.title ?? t("business.page.untitled")}
                    </span>
                    <small className="text-ink-2 text-[12px]">
                      {dayLabel(dayKey(p.publishedAt))} ·{" "}
                      {t("business.page.postViews", { n: fmtCount(p.views) })} ·{" "}
                      {t("business.page.postLikes", { n: fmtCount(p.likes) })}
                    </small>
                  </span>
                </li>
              ))}
            </ul>
          </>,
        )}

      {show("services") &&
        section(
          "kit-services",
          <>
            {h("business.page.block.services")}
            <ul className="flex flex-col gap-1.5">
              {kit.services.map((s) => (
                <li key={s.id} className="break-inside-avoid" dir="auto">
                  <b>{pick(s.name, lang)}</b>
                  {pick(s.desc, lang) && <> · {pick(s.desc, lang)}</>}
                </li>
              ))}
            </ul>
          </>,
        )}

      {show("work") &&
        section(
          "kit-work",
          <>
            {h("business.page.block.work")}
            <ul className="flex flex-col gap-1.5">
              {kit.pastWork.map((w) => {
                const title = pick(w.title, lang);
                return (
                  <li key={w.id} className="break-inside-avoid" dir="auto">
                    {isHttpsUrl(w.url) ? (
                      <a
                        href={w.url.trim()}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="px-link"
                      >
                        {title || w.url}
                      </a>
                    ) : (
                      title
                    )}
                    {w.platform && (
                      <small className="text-ink-2">
                        {" "}
                        · {PLATFORM_META[w.platform].name[lang]}
                      </small>
                    )}
                    {w.day && <small className="text-ink-2"> · {dayLabel(w.day)}</small>}
                  </li>
                );
              })}
            </ul>
          </>,
        )}

      {show("rates") && (
        <section className={box} data-testid="kit-rates">
          <h3 className="text-[16px] font-bold">{t("business.page.ratesTitle")}</h3>
          <p>{t("business.page.ratesBody")}</p>
          {email && (
            <bdi dir="ltr" className="font-semibold">
              {email}
            </bdi>
          )}
        </section>
      )}

      <footer className="text-muted text-[11px]">
        {t("business.page.footer", { date: dayLabel(data.day) })}
      </footer>
    </article>
  );
}
