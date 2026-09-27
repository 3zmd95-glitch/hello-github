"use client";

import Link from "next/link";
import { useMemo, type CSSProperties } from "react";
import { useSkillSheet } from "@/components/skills/SkillSheetProvider";
import PxBar from "@/components/ui/PxBar";
import { isGearLocked } from "@/components/ui/chips";
import { skillsByProgram } from "@/data";
import type { Program, QuestType, Section, Skill } from "@/lib/domain";
import { useT } from "@/lib/i18n";
import { levelFromXp } from "@/lib/level";
import { nodeFill, regionDone, regionPct, themeFor } from "@/lib/mapLayout";
import { programXp, skillInCalendar, useStore } from "@/store";
import { TileIcon } from "./TileIcon";
import { programStats } from "./WorldMap";

type DoneMap = Map<string, Set<QuestType>>;

/**
 * One island: the program's sections as numbered regions on a winding path, its skills as pixel nodes.
 * Everything derives from the store, so ticking a quest in the skill sheet updates the nodes live.
 */
export default function IslandMap({
  program,
  done,
  onBack,
}: {
  program: Program;
  done: DoneMap;
  onBack: () => void;
}) {
  const { t, L } = useT();
  const xpEvents = useStore((s) => s.xpEvents);
  const level = useMemo(
    () => levelFromXp(programXp({ xpEvents }, program.id)),
    [xpEvents, program.id],
  );
  const { total, quests, mastered } = programStats(program.id, done);
  const theme = themeFor(program.id, program.kind);
  const list = skillsByProgram[program.id] ?? [];
  const regions = program.sections.map((sec) => ({
    sec,
    skills: list.filter((s) => s.sectionId === sec.id),
  }));

  return (
    <div
      className="flex flex-col gap-4"
      style={{ "--c": program.color, "--tbg": theme.bg } as CSSProperties}
      data-testid="island-map"
      data-program={program.id}
    >
      <button
        type="button"
        onClick={onBack}
        className="px-btn px-btn-ghost px-btn-sm self-start"
        data-testid="map-back"
      >
        {t("map.back")}
      </button>

      <header className="px-card flex flex-col gap-3" style={{ background: theme.bg }}>
        <div className="flex items-center gap-3">
          <TileIcon icon={program.icon} color={program.color} size={52} />
          <div className="min-w-0 flex-1">
            <h1 className="text-xl">{L(program.name)}</h1>
            <span className="text-ink-2 text-xs">
              {L(theme.name)} · {t("map.nRegions", { n: program.sections.length })} ·{" "}
              {t("map.nSkills", { n: total })} · {t("map.mastered", { n: mastered, t: total })}
            </span>
          </div>
          <span
            className="num bg-edge text-accent shrink-0 rounded-[2px] px-2 py-0.5 text-sm"
            data-testid="island-map-level"
          >
            LV {level}
          </span>
        </div>
        <PxBar
          value={total ? quests / (total * 4) : 0}
          color={program.color}
          small
          label={t("map.islandProgress", { name: L(program.name) })}
        />
      </header>

      <div className="map-regions">
        {regions.map(({ sec, skills }, i) => (
          <Region key={sec.id} index={i + 1} section={sec} skills={skills} done={done} />
        ))}
        <Link href="/discover" className="map-discover" data-testid="map-discover">
          <span aria-hidden className="map-stepno">
            🔎
          </span>
          <span>{t("map.discover")}</span>
        </Link>
      </div>
      <p className="text-muted text-center text-xs">{t("map.tapSkill")}</p>
    </div>
  );
}

function Region({
  index,
  section,
  skills,
  done,
}: {
  index: number;
  section: Section;
  skills: Skill[];
  done: DoneMap;
}) {
  const { t, L } = useT();
  const counts = skills.map((s) => done.get(s.id)?.size ?? 0);
  const pct = regionPct(counts);
  const finished = regionDone(counts);
  const empty = skills.length === 0;
  const name = L(section.name);

  return (
    <section
      className="map-region"
      aria-label={`${t("map.regionN", { n: index })}: ${name}`}
      data-testid="region"
      data-section={section.id}
      data-done={finished}
      data-empty={empty}
    >
      <header className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="map-stepno num">{index}</span>
          <h2 className="truncate text-base">{name}</h2>
        </div>
        {empty ? (
          <span className="px-chip px-chip-lock shrink-0">{t("map.coming")}</span>
        ) : (
          <span className="num text-ink-2 shrink-0 text-xs" data-testid="region-pct">
            {pct}%
          </span>
        )}
      </header>
      {empty ? (
        <p className="text-muted text-xs">{t("map.comingRegion", { name })}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-start gap-2.5">
            {skills.map((s) => (
              <SkillNode key={s.id} skill={s} n={done.get(s.id)?.size ?? 0} />
            ))}
          </div>
          <PxBar
            value={pct / 100}
            color={finished ? "var(--gold)" : undefined}
            small
            label={t("map.regionProgress", { name })}
          />
        </>
      )}
    </section>
  );
}

function SkillNode({ skill, n }: { skill: Skill; n: number }) {
  const { t, L } = useT();
  const sheet = useSkillSheet();
  const gear = useStore((s) => s.settings.gear);
  const posts = useStore((s) => s.posts);
  const locked = isGearLocked(skill, { gear });
  // 📱 The bridge badge: this skill's video is planned in the Social calendar.
  const inCalendar = useMemo(
    () => skillInCalendar({ posts }, skill.id) !== undefined,
    [posts, skill.id],
  );
  const mastered = n >= 4;
  const name = L(skill.name);
  const state = mastered ? t("map.mastered1") : locked ? t("map.locked") : `${n}/4`;
  const label = `${t("map.openSkill", { name })} · ${state}${inCalendar ? ` · ${t("social.bridge.inCalendar")}` : ""}`;

  return (
    <button
      type="button"
      onClick={() => sheet.open(skill.id)}
      className="map-nodeb"
      aria-label={label}
      title={name}
      data-testid="skill-node"
      data-skill={skill.id}
      data-done={n}
      data-locked={locked}
      data-in-calendar={inCalendar}
    >
      <span className="map-node" data-mastered={mastered}>
        {!mastered && <i style={{ height: `${nodeFill(n)}%` }} />}
        <span>{mastered ? "★" : `${n}/4`}</span>
        {locked && !mastered && (
          <span aria-hidden className="map-lock">
            🔒
          </span>
        )}
        {inCalendar && (
          <span aria-hidden className="map-cal" data-testid="skill-node-calendar">
            📱
          </span>
        )}
      </span>
      <span className="map-nlab">{name}</span>
    </button>
  );
}
