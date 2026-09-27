"use client";

import Link from "next/link";
import { useMemo, type CSSProperties } from "react";
import PxBar from "@/components/ui/PxBar";
import { pillars, programsByPillar, skillsByProgram } from "@/data";
import type { Pillar, Program, QuestType } from "@/lib/domain";
import { useT } from "@/lib/i18n";
import { levelFromXp, levelProgress } from "@/lib/level";
import { HOME_ISLAND, islandGlows, islandSize, themeFor } from "@/lib/mapLayout";
import { pillarXp, programXp, useStore } from "@/store";
import IslandArt from "./IslandArt";
import { TileIcon } from "./TileIcon";

type DoneMap = Map<string, Set<QuestType>>;

/** Quests done, mastered and total skills of a program, from the completions map. */
export function programStats(programId: string, done: DoneMap) {
  const list = skillsByProgram[programId] ?? [];
  let quests = 0;
  let mastered = 0;
  for (const s of list) {
    const n = done.get(s.id)?.size ?? 0;
    quests += n;
    if (n === 4) mastered++;
  }
  return { total: list.length, quests, mastered };
}

/** The world: 6 continents (pillars) in order, each with its islands (programs) floating on a sea strip. */
export default function WorldMap({
  done,
  onOpen,
}: {
  done: DoneMap;
  onOpen: (id: string) => void;
}) {
  const { t } = useT();
  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl">{t("map.title")}</h1>
        <p className="text-ink-2 text-sm">{t("map.sub")}</p>
      </header>
      <div className="grid gap-4 md:grid-cols-2">
        {pillars.map((pl) => (
          <Continent key={pl.id} pillar={pl} done={done} onOpen={onOpen} />
        ))}
      </div>
    </>
  );
}

function Continent({
  pillar,
  done,
  onOpen,
}: {
  pillar: Pillar;
  done: DoneMap;
  onOpen: (id: string) => void;
}) {
  const { t, L } = useT();
  const xpEvents = useStore((s) => s.xpEvents);
  const progress = useMemo(
    () => levelProgress(pillarXp({ xpEvents }, pillar.id)),
    [xpEvents, pillar.id],
  );
  const items = programsByPillar(pillar.id);
  let total = 0;
  let mastered = 0;
  for (const p of items) {
    const st = programStats(p.id, done);
    total += st.total;
    mastered += st.mastered;
  }

  return (
    <section
      className="px-card flex flex-col gap-3"
      style={{ "--c": pillar.color } as CSSProperties}
      data-testid="continent"
      data-pillar={pillar.id}
    >
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <TileIcon icon={pillar.icon} color={pillar.color} size={40} />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg leading-tight">{L(pillar.name)}</h2>
            <span className="text-muted text-xs">
              {t("map.nPrograms", { n: items.length })} ·{" "}
              {t("map.mastered", { n: mastered, t: total })}
            </span>
          </div>
          <span
            className="num bg-edge text-accent shrink-0 rounded-[2px] px-2 py-0.5 text-sm"
            data-testid="continent-level"
          >
            LV {progress.level}
          </span>
        </div>
        <PxBar
          value={progress.ratio}
          color={pillar.color}
          small
          label={t("map.pillarLevel", { name: L(pillar.name) })}
        />
      </header>
      <div className="map-sea">
        {items.map((p) => (
          <Island key={p.id} program={p} done={done} onOpen={onOpen} />
        ))}
      </div>
    </section>
  );
}

function Island({
  program,
  done,
  onOpen,
}: {
  program: Program;
  done: DoneMap;
  onOpen: (id: string) => void;
}) {
  const { t, L } = useT();
  const xpEvents = useStore((s) => s.xpEvents);
  const level = useMemo(
    () => levelFromXp(programXp({ xpEvents }, program.id)),
    [xpEvents, program.id],
  );
  const { total, quests, mastered } = programStats(program.id, done);
  const home = program.id === HOME_ISLAND;
  const fog = total === 0;
  const theme = themeFor(program.id, program.kind);
  const size = islandSize(level, total, home);
  const style = { "--c": program.color } as CSSProperties;
  const name = L(program.name);

  const art = (
    <IslandArt
      size={size}
      land={fog ? "#6b7480" : theme.land}
      accent={program.color}
      fog={fog}
      glow={!fog && islandGlows(level)}
      emblem={program.icon}
    />
  );

  if (fog) {
    return (
      <Link
        href="/discover"
        className="map-isle"
        style={style}
        aria-label={t("map.exploreIsland", { name })}
        data-testid="island"
        data-program={program.id}
        data-fog="true"
        data-home={home}
      >
        {art}
        <b className="max-w-full truncate text-[0.9rem]">{name}</b>
        <span className="text-ink-2 max-w-full text-[0.7rem] leading-tight">{t("map.fog")}</span>
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onOpen(program.id)}
      className="map-isle"
      style={style}
      aria-label={t("map.openIsland", { name })}
      data-testid="island"
      data-program={program.id}
      data-fog="false"
      data-home={home}
    >
      {art}
      <b className="flex max-w-full items-center gap-1 text-[0.9rem]">
        <span className="truncate">{name}</span>
        {home && (
          <span className="px-chip px-chip-gold shrink-0 text-[0.62rem]">{t("map.home")}</span>
        )}
      </b>
      <span className="text-ink-2 max-w-full text-[0.72rem] leading-tight">
        <span className="num" data-testid="island-level">
          LV {level}
        </span>{" "}
        · {t("map.nSkills", { n: total })} · <span className="num">{mastered}★</span>
      </span>
      <PxBar
        value={quests / (total * 4)}
        color={program.color}
        small
        className="w-full max-w-[150px]"
        label={t("map.islandProgress", { name })}
      />
    </button>
  );
}
