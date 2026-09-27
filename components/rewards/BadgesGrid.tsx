"use client";

import { BADGES } from "@/lib/badges";
import type { BadgeAward } from "@/lib/domain";
import { useT } from "@/lib/i18n";
import { formatDate } from "./formatDate";

/** Every badge in the catalogue: earned ones in color with their date, the rest greyed with a lock. */
export default function BadgesGrid({ awards }: { awards: readonly BadgeAward[] }) {
  const { t, L, lang } = useT();
  const earnedAt = new Map(awards.map((a) => [a.id, a.at]));
  const earned = BADGES.filter((b) => earnedAt.has(b.id)).length;
  return (
    <section className="flex flex-col gap-3" data-testid="badges">
      <header className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg">{t("rewards.badges.title")}</h2>
          <p className="text-muted text-xs">{t("rewards.badges.sub")}</p>
        </div>
        <span className="px-chip">
          <span className="num" data-testid="badges-count">
            {earned}/{BADGES.length}
          </span>
        </span>
      </header>
      <ul className="rw-badges">
        {BADGES.map((badge) => {
          const at = earnedAt.get(badge.id);
          const on = at !== undefined;
          return (
            <li
              key={badge.id}
              className="px-inset rw-badge flex items-center gap-2"
              data-testid="badge"
              data-badge={badge.id}
              data-earned={on}
              title={L(badge.desc)}
            >
              <span aria-hidden className="rw-badge-icon">
                {on ? badge.icon : "🔒"}
              </span>
              <span className="min-w-0">
                <b className="block truncate text-sm">{L(badge.name)}</b>
                <small className="text-muted block text-[0.7rem]">
                  {on ? t("rewards.badges.earned", { date: formatDate(at, lang) }) : L(badge.desc)}
                </small>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
