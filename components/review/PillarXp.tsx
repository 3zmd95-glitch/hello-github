"use client";

import PxBar from "@/components/ui/PxBar";
import { pillars } from "@/data";
import { useT } from "@/lib/i18n";

/** XP per pillar this week as a colored bar list; pillars without XP are left out. */
export default function PillarXp({ xpByPillar }: { xpByPillar: Record<string, number> }) {
  const { t, L } = useT();
  const rows = pillars
    .filter((p) => (xpByPillar[p.id] ?? 0) > 0)
    .map((p) => ({ pillar: p, xp: xpByPillar[p.id] }));
  const max = rows.reduce((n, r) => Math.max(n, r.xp), 0);

  return (
    <section className="px-card flex flex-col gap-3" data-testid="pillar-xp">
      <h2 className="text-base">{t("review.pillars.title")}</h2>
      {rows.length === 0 ? (
        <p className="text-muted text-sm">{t("review.pillars.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map(({ pillar, xp }) => (
            <li
              key={pillar.id}
              className="flex items-center gap-2"
              data-testid="pillar-xp-row"
              data-pillar={pillar.id}
              data-xp={xp}
            >
              <span aria-hidden className="text-base leading-none">
                {pillar.icon}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm">{L(pillar.name)}</span>
              <PxBar
                value={max ? xp / max : 0}
                color={pillar.color}
                small
                className="w-20 flex-none md:w-28"
                label={`${L(pillar.name)}: ${xp} XP`}
              />
              <span className="num w-10 text-end text-sm" style={{ color: pillar.color }}>
                {xp}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
