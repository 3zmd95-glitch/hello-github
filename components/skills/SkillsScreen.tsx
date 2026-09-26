"use client";

import { useMemo, useState, type CSSProperties } from "react";
import PxBar from "@/components/ui/PxBar";
import { GearChip, isGearLocked, StudioChip, TierChip } from "@/components/ui/chips";
import { programs, skillsByProgram } from "@/data";
import { QUEST_TYPES, type Program, type QuestType, type Skill } from "@/lib/domain";
import { useT } from "@/lib/i18n";
import { levelFromXp } from "@/lib/level";
import { doneQuestsBySkill } from "@/lib/planner";
import { programXp, useStore } from "@/store";
import { useSkillSheet } from "./SkillSheetProvider";

type DoneMap = Map<string, Set<QuestType>>;

/** Skills: programs grouped Craft / Tools → sections → skill rows. The program view is page-local state. */
export default function SkillsScreen() {
  const [programId, setProgramId] = useState<string | null>(null);
  const completions = useStore((s) => s.completions);
  const done = useMemo(() => doneQuestsBySkill(completions), [completions]);
  const program = programId ? programs.find((p) => p.id === programId) : undefined;

  const go = (id: string | null) => {
    setProgramId(id);
    window.scrollTo({ top: 0 });
  };

  return program ? (
    <ProgramView program={program} done={done} onBack={() => go(null)} />
  ) : (
    <ProgramList done={done} onOpen={go} />
  );
}

function ProgramList({ done, onOpen }: { done: DoneMap; onOpen: (id: string) => void }) {
  const { t } = useT();
  const groups = [
    { key: "craft", title: t("skills.craft"), items: programs.filter((p) => p.kind === "craft") },
    { key: "tools", title: t("skills.tools"), items: programs.filter((p) => p.kind === "app") },
  ];
  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl">{t("skills.title")}</h1>
        <p className="text-ink-2 text-sm">{t("skills.sub")}</p>
      </header>
      {groups.map((g) => (
        <section key={g.key} className="flex flex-col gap-3" data-testid={`group-${g.key}`}>
          <h2 className="text-lg">{g.title}</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {g.items.map((p) => (
              <ProgramCard key={p.id} program={p} done={done} onOpen={onOpen} />
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

function programStats(program: Program, done: DoneMap) {
  const list = skillsByProgram[program.id] ?? [];
  let quests = 0;
  let mastered = 0;
  for (const s of list) {
    const n = done.get(s.id)?.size ?? 0;
    quests += n;
    if (n === 4) mastered++;
  }
  return { total: list.length, quests, mastered };
}

function ProgramIcon({ program, size = 44 }: { program: Program; size?: number }) {
  return (
    <span
      aria-hidden
      className="border-edge grid shrink-0 place-items-center rounded-[2px] border-[3px] shadow-[2px_2px_0_var(--edge)]"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.5,
        background: `color-mix(in srgb, ${program.color} 45%, var(--panel-2))`,
      }}
    >
      {program.icon}
    </span>
  );
}

function ProgramCard({
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
  const { total, quests, mastered } = programStats(program, done);

  if (total === 0) {
    return (
      <div
        className="px-card flex items-center gap-3 border-dashed opacity-55 shadow-none"
        data-testid="program-soon"
      >
        <ProgramIcon program={program} size={40} />
        <div className="min-w-0 flex-1">
          <b className="block truncate">{L(program.name)}</b>
          <span className="text-muted text-xs">{t("skills.soon")}</span>
        </div>
        <span className="px-chip">{t("nav.soon")}</span>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onOpen(program.id)}
      className="px-card flex flex-col gap-3 text-start transition-transform hover:-translate-y-0.5 active:translate-x-[2px] active:translate-y-[2px]"
      style={{ "--c": program.color } as CSSProperties}
      data-testid="program-card"
      data-program={program.id}
    >
      <div className="flex w-full items-center gap-3">
        <ProgramIcon program={program} />
        <div className="min-w-0 flex-1">
          <b className="block truncate text-[1.02rem]">{L(program.name)}</b>
          <span className="text-muted text-xs">
            {t("skills.nSkills", { n: total })} · {t("skills.mastered", { n: mastered, t: total })}
          </span>
        </div>
        <span className="num bg-edge text-accent shrink-0 rounded-[2px] px-2 py-0.5 text-sm">
          LV {level}
        </span>
      </div>
      <PxBar value={quests / (total * 4)} color={program.color} small className="w-full" />
    </button>
  );
}

function ProgramView({
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
  const level = levelFromXp(programXp({ xpEvents }, program.id));
  const { total, quests, mastered } = programStats(program, done);
  const list = skillsByProgram[program.id] ?? [];
  const sections = program.sections.map((sec) => ({
    sec,
    skills: list.filter((s) => s.sectionId === sec.id),
  }));
  const filled = sections.filter((s) => s.skills.length > 0);
  const empty = sections.filter((s) => s.skills.length === 0);

  return (
    <>
      <button
        type="button"
        onClick={onBack}
        className="px-btn px-btn-ghost px-btn-sm self-start"
        data-testid="skills-back"
      >
        {t("skills.back")}
      </button>
      <header className="px-card flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <ProgramIcon program={program} size={52} />
          <div className="min-w-0 flex-1">
            <h1 className="text-xl">{L(program.name)}</h1>
            <span className="text-muted text-xs">
              {t("skills.nSkills", { n: total })} ·{" "}
              {t("skills.mastered", { n: mastered, t: total })}
            </span>
          </div>
          <span className="num bg-edge text-accent shrink-0 rounded-[2px] px-2 py-0.5 text-sm">
            LV {level}
          </span>
        </div>
        <PxBar value={quests / (total * 4)} color={program.color} small />
      </header>

      {filled.map(({ sec, skills }) => (
        <details key={sec.id} open className="px-card group" data-testid="section">
          <summary className="flex cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
            <h2 className="text-base">{L(sec.name)}</h2>
            <span className="px-chip">
              <span className="num">{skills.length}</span>
            </span>
            <span
              aria-hidden
              className="text-muted ms-auto transition-transform group-open:rotate-180"
            >
              ▾
            </span>
          </summary>
          <ul className="mt-3 flex flex-col gap-2">
            {skills.map((s) => (
              <li key={s.id}>
                <SkillRow skill={s} done={done.get(s.id)} />
              </li>
            ))}
          </ul>
        </details>
      ))}

      {empty.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-muted text-sm">{t("skills.comingSections")}</h2>
          <div className="flex flex-wrap gap-2 opacity-60">
            {empty.map(({ sec }) => (
              <span key={sec.id} className="px-chip px-chip-lock">
                {L(sec.name)}
              </span>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

function SkillRow({ skill, done }: { skill: Skill; done: Set<QuestType> | undefined }) {
  const { t, L } = useT();
  const sheet = useSkillSheet();
  const settings = useStore((s) => s.settings);
  const n = done?.size ?? 0;
  const locked = isGearLocked(skill, settings);
  return (
    <button
      type="button"
      onClick={() => sheet.open(skill.id)}
      className={`px-inset hover:border-gold flex w-full items-center gap-3 text-start ${locked ? "opacity-75" : ""}`}
      aria-label={t("skills.open", { name: L(skill.name) })}
      data-testid="skill-row"
      data-skill={skill.id}
    >
      <div className="min-w-0 flex-1">
        <b className="block text-[0.95rem]">
          {L(skill.name)} {n === 4 && <span aria-label={t("sheet.mastered")}>⭐</span>}
        </b>
        <div className="mt-1 flex flex-wrap gap-1.5">
          <TierChip tier={skill.tier} />
          <StudioChip skill={skill} settings={settings} />
          <GearChip skill={skill} settings={settings} />
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className="flex gap-1" aria-hidden>
          {QUEST_TYPES.map((q) => (
            <i key={q} className="px-pip" data-on={done?.has(q) ?? false} title={t(`quest.${q}`)} />
          ))}
        </span>
        <span className="num text-muted text-xs">{n}/4</span>
      </div>
    </button>
  );
}
