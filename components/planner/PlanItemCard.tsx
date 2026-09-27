"use client";

import { useState } from "react";
import { TierChip } from "@/components/ui/chips";
import { getSkill } from "@/data";
import { useT } from "@/lib/i18n";
import type { PlanItem } from "@/lib/weekPlan";

/**
 * One planned quest: type chip, skill, tier, minutes, XP, the coach's reason, a tick and an open button.
 * A combo item covers two produce quests (craft + software); its tick finishes both with the same clip link.
 */
export default function PlanItemCard({
  item,
  done,
  onTick,
  onOpen,
}: {
  item: PlanItem;
  done: boolean;
  onTick: (item: PlanItem, proof?: string) => void;
  onOpen: (skillId: string) => void;
}) {
  const { t, L } = useT();
  const [proof, setProof] = useState("");
  const skill = getSkill(item.skillId);
  const partner = item.partnerSkillId ? getSkill(item.partnerSkillId) : undefined;
  if (!skill) return null;

  const isCombo = item.kind === "combo";
  const needsProof = !done && (item.quest === "produce" || item.quest === "article");
  const name = L(skill.name);

  return (
    <article
      className="px-inset plan-item flex flex-col gap-2"
      data-testid="plan-item"
      data-skill={item.skillId}
      data-quest={item.quest}
      data-kind={item.kind}
      data-done={done}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={`px-chip ${isCombo ? "px-chip-gold" : ""}`}>
          {isCombo ? `🔗 ${t("planner.combo")}` : t(`quest.${item.quest}`)}
        </span>
        <TierChip tier={skill.tier} />
        {done && <span className="px-chip px-chip-green">{t("planner.doneState")}</span>}
      </div>

      <b className="plan-title text-sm leading-snug">{name}</b>
      {partner && (
        <button
          type="button"
          className="px-link plan-title text-start text-xs"
          onClick={() => onOpen(partner.id)}
          aria-label={t("planner.openAria", { skill: L(partner.name) })}
        >
          {t("planner.comboWith", { skill: L(partner.name) })}
        </button>
      )}
      <p className="text-muted text-xs">{L(item.reason)}</p>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-ink-2">
          ⏱ <span className="num">{item.minutes}</span> {t("planner.min")}
        </span>
        <span className="px-chip px-chip-gold">
          <span className="num">+{item.xp} XP</span>
        </span>
      </div>

      {needsProof && (
        <input
          type="text"
          inputMode="url"
          dir="ltr"
          autoComplete="off"
          className="px-input"
          placeholder={isCombo ? t("planner.comboProofPh") : t("planner.proofPh")}
          aria-label={isCombo ? t("planner.comboProofPh") : t("planner.proofPh")}
          value={proof}
          onChange={(e) => setProof(e.target.value)}
          data-testid="plan-proof"
        />
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="px-btn px-btn-ghost px-btn-sm"
          onClick={() => onOpen(skill.id)}
          aria-label={t("planner.openAria", { skill: name })}
          data-testid="plan-open"
        >
          {t("planner.open")}
        </button>
        {!done && (
          <button
            type="button"
            className="px-btn px-btn-sm"
            onClick={() => onTick(item, proof)}
            aria-label={t("planner.tickAria", { skill: name })}
            data-testid="plan-tick"
          >
            {isCombo ? t("planner.comboTick") : t("planner.tick")}
          </button>
        )}
      </div>
    </article>
  );
}
