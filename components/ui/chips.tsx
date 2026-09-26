"use client";

import type { Settings, Skill, Tier } from "@/lib/domain";
import { useT } from "@/lib/i18n";

export function TierChip({ tier }: { tier: Tier }) {
  const { t } = useT();
  return <span className={`px-chip px-chip-t${tier}`}>{t(`tier.${tier}`)}</span>;
}

/** Whether the skill needs gear the owner does not have yet. */
export function isGearLocked(
  skill: Pick<Skill, "gear">,
  settings: Pick<Settings, "gear">,
): boolean {
  return skill.gear !== "any" && !settings.gear.includes(skill.gear);
}

export function StudioChip({ skill, settings }: { skill: Skill; settings: Settings }) {
  const { t } = useT();
  if (!skill.studio) return null;
  return settings.davinciEdition === "studio" ? (
    <span className="px-chip px-chip-green">{t("chip.studio")}</span>
  ) : (
    <span className="px-chip px-chip-lock">{t("chip.studioLocked")}</span>
  );
}

export function GearChip({ skill, settings }: { skill: Skill; settings: Settings }) {
  const { t } = useT();
  if (!isGearLocked(skill, settings)) return null;
  return (
    <span className="px-chip px-chip-lock" data-testid="gear-lock-chip">
      {t(`lock.${skill.gear}`)}
    </span>
  );
}
