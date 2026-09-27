"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useGameActions } from "@/components/celebrate/useGameActions";
import SkillResearchPanel from "@/components/research/SkillResearchPanel";
import PxBar from "@/components/ui/PxBar";
import { GearChip, StudioChip, TierChip } from "@/components/ui/chips";
import { getProgram, getSkill } from "@/data";
import { QUEST_TYPES, type QuestType, type Ref, type Skill } from "@/lib/domain";
import { useT } from "@/lib/i18n";
import { questXp } from "@/lib/xp";
import { refsForSkill, useStore } from "@/store";

/**
 * Skill popup: bottom sheet on phones, centered dialog from md up. Lives on its own layer (z-40) under the
 * celebration layer (z-80). Toggling a quest updates it in place: no remount, no key change, scroll kept.
 */
export default function SkillSheet({ skillId, onClose }: { skillId: string; onClose: () => void }) {
  const skill = getSkill(skillId);
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Body scroll lock, Esc to close, focus in and back out.
  useEffect(() => {
    const prevFocus = document.activeElement as HTMLElement | null;
    const body = document.body;
    const prevOverflow = body.style.overflow;
    body.style.overflow = "hidden";
    panelRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      body.style.overflow = prevOverflow;
      prevFocus?.focus?.({ preventScroll: true });
    };
  }, []);

  if (!skill) return null;
  const titleId = `sheet-title-${skill.id}`;

  return (
    <div
      className="anim-fade fixed inset-0 z-40 flex items-end justify-center bg-[rgba(5,8,12,.62)] md:items-center md:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      data-testid="sheet-backdrop"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-testid="skill-sheet"
        className="px-card anim-sheet relative flex max-h-[88dvh] w-full flex-col gap-4 overflow-y-auto overscroll-contain rounded-t-[10px] pb-[calc(16px+env(safe-area-inset-bottom,0px))] outline-none md:max-w-[600px] md:rounded-[2px] md:pb-4"
      >
        <SheetBody skill={skill} titleId={titleId} onClose={onClose} />
      </div>
    </div>
  );
}

function SheetBody({
  skill,
  titleId,
  onClose,
}: {
  skill: Skill;
  titleId: string;
  onClose: () => void;
}) {
  const { t, L, lang } = useT();
  const settings = useStore((s) => s.settings);
  const completions = useStore((s) => s.completions);
  const { completeQuest, uncompleteQuest, setProof } = useGameActions();
  const [researchOpen, setResearchOpen] = useState(false);

  const done = useMemo(() => {
    const m = new Map<QuestType, string | undefined>();
    for (const c of completions) if (c.skillId === skill.id) m.set(c.quest, c.proofUrl);
    return m;
  }, [completions, skill.id]);

  const program = getProgram(skill.programId);
  const section = program?.sections.find((s) => s.id === skill.sectionId);
  const otherName = lang === "ar" ? skill.name.en : skill.name.ar;
  const n = done.size;

  return (
    <>
      <header className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-muted text-xs">
            {program ? `${program.icon} ${L(program.name)}` : ""}
            {section ? ` › ${L(section.name)}` : ""}
          </p>
          <h2 id={titleId} className="text-xl">
            {L(skill.name)}
          </h2>
          <p className="text-ink-2 text-sm" dir={lang === "ar" ? "ltr" : "rtl"}>
            {otherName}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("common.close")}
          className="px-btn px-btn-ghost px-btn-sm shrink-0"
          data-testid="sheet-close"
        >
          ✕
        </button>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <TierChip tier={skill.tier} />
        <StudioChip skill={skill} settings={settings} />
        <GearChip skill={skill} settings={settings} />
        {n === 4 && <span className="px-chip px-chip-gold">{t("sheet.mastered")}</span>}
      </div>

      <div className="flex items-center gap-3">
        <span className="text-ink-2 text-sm">{t("sheet.progress")}</span>
        <PxBar value={n / 4} className="flex-1" label={t("sheet.progress")} />
        <b className="num" data-testid="sheet-progress">
          {n}/4
        </b>
        <button
          type="button"
          aria-pressed={researchOpen}
          onClick={() => setResearchOpen((o) => !o)}
          className="px-btn px-btn-ghost px-btn-sm shrink-0"
          data-testid="research-toggle"
        >
          🔎 {t("research.button")}
        </button>
      </div>

      {researchOpen && <SkillResearchPanel skill={skill} />}

      {skill.source === "draft" && (
        <p className="px-inset text-ink-2 text-sm">📝 {t("sheet.draft")}</p>
      )}

      <StartHere refs={skill.refs} skillId={skill.id} />

      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-base">{t("sheet.quests")}</h3>
          <span className="text-muted text-xs">{t("sheet.tapHint")}</span>
        </div>
        <ul className="flex flex-col gap-2">
          {QUEST_TYPES.map((q) => {
            const isDone = done.has(q);
            return (
              <li key={q} className="px-inset flex flex-col gap-2" data-quest={q}>
                <button
                  type="button"
                  aria-pressed={isDone}
                  onClick={() =>
                    isDone ? uncompleteQuest(skill.id, q) : completeQuest(skill.id, q)
                  }
                  className="flex w-full items-start gap-3 text-start"
                  data-testid={`quest-${q}`}
                >
                  <span className="px-check" data-on={isDone}>
                    ✓
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <b>{t(`quest.${q}`)}</b>
                      <span className="px-chip px-chip-gold">
                        <span className="num">+{questXp(q, skill.tier)} XP</span>
                      </span>
                    </span>
                    <span
                      className={`mt-1 block text-sm ${isDone ? "text-muted line-through" : "text-ink-2"}`}
                    >
                      {L(skill.quests[q])}
                    </span>
                  </span>
                </button>
                {isDone && (q === "produce" || q === "article") && (
                  <ProofInput
                    initial={done.get(q) ?? ""}
                    onSave={(url) => setProof(skill.id, q, url)}
                  />
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {skill.what && (
        <section className="flex flex-col gap-1">
          <h3 className="text-base">{t("sheet.what")}</h3>
          <p className="text-ink-2 text-sm">{L(skill.what)}</p>
        </section>
      )}

      {skill.ideas && skill.ideas.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="text-base">{skill.ideasTitle ? L(skill.ideasTitle) : t("sheet.ideas")}</h3>
          <ul className="flex flex-col gap-2">
            {skill.ideas.map((idea, i) => (
              <li key={i} className="px-inset text-sm">
                <b>💡 {L(idea.name)}</b>
                <span className="text-ink-2 block">{L(idea.desc)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {skill.steps && skill.steps.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="text-base">{t("sheet.steps")}</h3>
          <ol className="flex flex-col gap-2">
            {skill.steps.map((step, i) => (
              <li key={i} className="flex gap-3 text-sm">
                <span className="num border-edge bg-gold text-gold-ink grid h-6 w-6 shrink-0 place-items-center border-2 text-xs font-bold">
                  {i + 1}
                </span>
                <span className="text-ink-2 min-w-0">{L(step)}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {(skill.trend || skill.arGap || skill.related) && (
        <details className="px-inset">
          <summary className="font-bold">{t("sheet.more")}</summary>
          <div className="mt-2 flex flex-col gap-3 text-sm">
            {skill.trend && (
              <div>
                <b>{t("sheet.trend")}</b>
                <p className="text-ink-2">{L(skill.trend)}</p>
              </div>
            )}
            {skill.arGap && (
              <div>
                <b>{t("sheet.arGap")}</b>
                <p className="text-ink-2">
                  <span className={`px-chip ${skill.arGap.has ? "px-chip-green" : "px-chip-gold"}`}>
                    {skill.arGap.has ? t("sheet.arGapHas") : t("sheet.arGapNo")}
                  </span>{" "}
                  {L(skill.arGap)}
                </p>
              </div>
            )}
            {skill.related && (
              <div>
                <b>{t("sheet.related")}</b>
                <p className="text-ink-2">{L(skill.related)}</p>
              </div>
            )}
          </div>
        </details>
      )}
    </>
  );
}

const PLATFORM_ICON: Record<Ref["platform"], string> = { yt: "▶️", web: "📄", tt: "🎵", ig: "📸" };

function StartHere({ refs, skillId }: { refs: Ref[]; skillId: string }) {
  const { t } = useT();
  const savedRefs = useStore((s) => refsForSkill(s, skillId));
  const removeRef = useStore((s) => s.removeRef);
  const steps = [
    { ref: refs.find((r) => r.platform === "yt"), label: t("sheet.lp1") },
    { ref: refs.find((r) => r.platform === "web"), label: t("sheet.lp2") },
    { ref: refs.find((r) => r.platform === "tt" || r.platform === "ig"), label: t("sheet.lp3") },
  ].filter((s): s is { ref: Ref; label: string } => !!s.ref);
  if (steps.length === 0 && savedRefs.length === 0) return null;
  return (
    <section className="border-sky bg-panel-2 flex flex-col gap-2 rounded-[2px] border-[3px] p-3">
      <h3 className="text-base">{t("sheet.startHere")}</h3>
      {steps.length > 0 && (
        <ol className="flex flex-col gap-2">
          {steps.map(({ ref, label }, i) => (
            <li key={ref.url} className="flex gap-3 text-sm">
              <span className="num border-edge bg-sky grid h-6 w-6 shrink-0 place-items-center border-2 text-xs font-bold text-[#04192a]">
                {i + 1}
              </span>
              <span className="min-w-0">
                <span className="text-muted block text-xs">{label}</span>
                <a href={ref.url} target="_blank" rel="noopener noreferrer" className="px-link">
                  {PLATFORM_ICON[ref.platform]} {ref.title}
                </a>
                {ref.handle && <span className="text-muted"> · {ref.handle}</span>}
              </span>
            </li>
          ))}
        </ol>
      )}
      {savedRefs.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-muted block text-xs">{t("sheet.yourRefs")}</span>
          <ul className="flex flex-col gap-1">
            {savedRefs.map((ref) => (
              <li key={ref.url} className="flex items-center gap-2 text-sm" data-testid="saved-ref">
                {ref.thumb && (
                  // External thumbnail; static export has no image optimizer for it.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={ref.thumb}
                    alt={t("sheet.refThumbAlt")}
                    width={40}
                    height={40}
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    className="h-10 w-10 shrink-0 rounded-[2px] bg-[var(--panel-3)] object-cover"
                    data-testid="saved-ref-thumb"
                  />
                )}
                <a
                  href={ref.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-link min-w-0 flex-1 truncate"
                >
                  {PLATFORM_ICON[ref.platform]} {ref.title}
                </a>
                <button
                  type="button"
                  onClick={() => removeRef(skillId, ref.url)}
                  aria-label={t("sheet.refRemove")}
                  className="px-btn px-btn-ghost px-btn-sm shrink-0"
                  data-testid="saved-ref-remove"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function ProofInput({ initial, onSave }: { initial: string; onSave: (url: string) => void }) {
  const { t } = useT();
  const [value, setValue] = useState(initial);
  const [saved, setSaved] = useState(false);
  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (value.trim() === initial.trim()) return;
    onSave(value);
    setSaved(true);
  };
  return (
    <form onSubmit={submit} className="flex items-center gap-2 ps-[42px]">
      <input
        type="text"
        inputMode="url"
        autoComplete="off"
        dir="ltr"
        className="px-input flex-1"
        placeholder={t("sheet.proofPh")}
        aria-label={t("sheet.proofPh")}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setSaved(false);
        }}
        onBlur={() => submit()}
      />
      <button type="submit" className="px-btn px-btn-ghost px-btn-sm">
        {saved ? t("sheet.proofSaved") : t("sheet.proofSave")}
      </button>
    </form>
  );
}
