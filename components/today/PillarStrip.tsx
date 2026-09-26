"use client";

import Link from "next/link";
import { useMemo } from "react";
import { pillars } from "@/data";
import { useT } from "@/lib/i18n";
import { levelFromXp } from "@/lib/level";
import { pillarXp, useStore } from "@/store";

/** Compact row of the 6 pillar icons with their levels; tapping it opens the Skills screen. */
export default function PillarStrip() {
  const { t, L, lang } = useT();
  const xpEvents = useStore((s) => s.xpEvents);
  const levels = useMemo(
    () => pillars.map((p) => ({ pillar: p, level: levelFromXp(pillarXp({ xpEvents }, p.id)) })),
    [xpEvents],
  );
  const label = levels
    .map(({ pillar, level }) => t("hdr.pillarsOpen", { name: L(pillar.name), n: level }))
    .join(lang === "ar" ? "، " : ", ");

  return (
    <Link
      href="/skills/"
      className="px-inset hover:border-gold grid grid-cols-6 gap-1 px-1 py-1.5 no-underline"
      aria-label={`${t("hdr.pillars")}: ${label}`}
      title={t("hdr.pillars")}
      data-testid="pillar-strip"
    >
      {levels.map(({ pillar, level }) => (
        <span
          key={pillar.id}
          className="flex min-w-0 flex-col items-center gap-0.5 leading-none"
          data-pillar={pillar.id}
        >
          <span aria-hidden className="text-lg">
            {pillar.icon}
          </span>
          <span
            className="num text-[0.7rem]"
            style={{ color: `color-mix(in srgb, ${pillar.color} 70%, var(--ink))` }}
          >
            LV{level}
          </span>
        </span>
      ))}
    </Link>
  );
}
