"use client";

import PxBar from "@/components/ui/PxBar";
import { getBadge } from "@/lib/badges";
import type { BossState } from "@/lib/boss";
import { useT } from "@/lib/i18n";
import { SEASON_DAYS, type SeasonState } from "@/lib/season";

/** One card, two halves: this month's boss (HP bar) and the running 30-day season (quests toward its badge). */
export default function BossSeasonCard({ boss, season }: { boss: BossState; season: SeasonState }) {
  return (
    <section className="px-card grid gap-3 sm:grid-cols-2" data-testid="boss-season">
      <BossCard boss={boss} />
      <SeasonCard season={season} />
    </section>
  );
}

function BossCard({ boss }: { boss: BossState }) {
  const { t, L } = useT();
  return (
    <div
      className="px-inset flex flex-col gap-1.5"
      data-testid="boss-card"
      data-defeated={boss.defeated}
      data-month={boss.month}
    >
      <div className="flex items-start gap-2">
        <span
          aria-hidden
          className={`text-3xl leading-none ${boss.defeated ? "opacity-50 grayscale" : ""}`}
        >
          {boss.boss.icon}
        </span>
        <div className="min-w-0 flex-1">
          <span className="text-muted block text-xs">{t("today.boss.title")}</span>
          <b className="block truncate text-sm" data-testid="boss-name">
            {L(boss.boss.name)}
          </b>
        </div>
        <span className="text-muted num shrink-0 text-xs">
          {t("today.boss.daysLeft", { n: boss.daysLeft })}
        </span>
      </div>
      <div data-testid="boss-hp" data-left={boss.hpLeft} data-hp={boss.hp}>
        <PxBar
          value={boss.hp > 0 ? boss.hpLeft / boss.hp : 0}
          color="var(--danger)"
          label={t("today.boss.hp")}
        />
      </div>
      {boss.defeated ? (
        <span className="px-chip px-chip-gold self-start">{t("today.boss.defeated")}</span>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-x-2 text-xs">
          <span className="text-ink-2">
            <span className="num">{boss.hpLeft}</span> / <span className="num">{boss.hp}</span>{" "}
            {t("today.boss.hp")}
          </span>
          <span className="text-muted">
            ⚔️ {t("today.boss.damage", { n: boss.damage })} · {t("today.boss.hint")}
          </span>
        </div>
      )}
    </div>
  );
}

function SeasonCard({ season }: { season: SeasonState }) {
  const { t, L } = useT();
  const badge = getBadge(season.season.badgeId);
  return (
    <div
      className="px-inset flex flex-col gap-1.5"
      data-testid="season-card"
      data-day={season.day}
      data-done={season.done}
    >
      <div className="flex items-start gap-2">
        <span aria-hidden className="text-3xl leading-none">
          {season.season.icon}
        </span>
        <div className="min-w-0 flex-1">
          <span className="text-muted block text-xs">{t("today.season.title")}</span>
          <b className="block truncate text-sm" data-testid="season-name">
            {L(season.season.name)}
          </b>
        </div>
        <span className="text-muted num shrink-0 text-xs">
          {t("today.season.day", { n: season.day, total: SEASON_DAYS })}
        </span>
      </div>
      <div data-testid="season-progress" data-done={season.questsDone} data-target={season.target}>
        <PxBar
          value={season.target > 0 ? season.questsDone / season.target : 0}
          color="var(--sky)"
          label={t("today.season.quests")}
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-2 text-xs">
        <span className="text-ink-2">
          {t("today.season.quests")}{" "}
          <span className="num">
            {season.questsDone}/{season.target}
          </span>
        </span>
        {season.done ? (
          <span className="px-chip px-chip-gold">{t("today.season.done")}</span>
        ) : (
          badge && (
            <span className="text-muted">
              {t("today.season.badge", { name: `${badge.icon} ${L(badge.name)}` })}
            </span>
          )
        )}
      </div>
      <span className="text-muted text-xs" data-testid="season-next">
        {t("today.season.next", { icon: season.next.icon, name: L(season.next.name) })}
      </span>
    </div>
  );
}
