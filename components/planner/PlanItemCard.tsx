"use client";

import { useState } from "react";
import { TierChip } from "@/components/ui/chips";
import { getSkill } from "@/data";
import { useT } from "@/lib/i18n";
import type { OverlayItem } from "./overlay";

/**
 * One planned quest: type chip, skill, tier, minutes, XP, the coach's reason, a tick, an open button and a ×
 * to take it off the plan. A combo item covers two produce quests (craft + software); its tick finishes both
 * with the same clip link. An item the owner added by hand carries a "you" chip.
 */
export default function PlanItemCard({
  item,
  done,
  onTick,
  onOpen,
  onRemove,
}: {
  item: OverlayItem;
  done: boolean;
  onTick: (item: OverlayItem, proof?: string) => void;
  onOpen: (skillId: string) => void;
  onRemove: (item: OverlayItem) => void;
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
      data-id={item.id}
      data-skill={item.skillId}
      data-quest={item.quest}
      data-kind={item.kind}
      data-done={done}
      data-manual={item.manual}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={`px-chip ${isCombo ? "px-chip-gold" : ""}`}>
          {isCombo ? `🔗 ${t("planner.combo")}` : t(`quest.${item.quest}`)}
        </span>
        <TierChip tier={skill.tier} />
        {item.manual && (
          <span className="px-chip px-chip-green" data-testid="plan-by-me">
            {t("planner.byMe")}
          </span>
        )}
        {done && <span className="px-chip px-chip-green">{t("planner.doneState")}</span>}
        {/* In the chip row (not absolute) so it never covers a chip in narrow day columns. */}
        <button
          type="button"
          className="num border-edge bg-panel text-muted hover:text-danger hover:border-danger ms-auto grid h-7 w-7 shrink-0 place-items-center rounded-[2px] border-2 text-base leading-none"
          onClick={() => onRemove(item)}
          aria-label={t("planner.removeAria", { skill: name })}
          title={t("planner.removeAria", { skill: name })}
          data-testid="plan-remove"
        >
          ×
        </button>
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
      <p className="text-muted text-xs">{item.manual ? t("planner.byMeReason") : L(item.reason)}</p>

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
