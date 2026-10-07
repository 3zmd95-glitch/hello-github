"use client";

import { Gamepad2 } from "lucide-react";
import { useMemo, useState } from "react";
import { skills } from "@/data";
import type { Skill } from "@/lib/domain";
import { useT } from "@/lib/i18n";

const MAX_RESULTS = 8;

/** Text search over the seeded skills (both languages); tap a row to pick. */
export default function SkillPicker({
  testId,
  onPick,
  autoFocus,
}: {
  /** Test id of the search input; options carry `${testId}-option` + `data-skill`. */
  testId: string;
  onPick: (skill: Skill) => void;
  autoFocus?: boolean;
}) {
  const { t, L } = useT();
  const [q, setQ] = useState("");
  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    return skills
      .filter(
        (s) =>
          s.name.ar.toLowerCase().includes(needle) ||
          s.name.en.toLowerCase().includes(needle) ||
          s.id.includes(needle),
      )
      .slice(0, MAX_RESULTS);
  }, [q]);

  return (
    <div className="flex flex-col gap-2">
      <input
        type="search"
        autoComplete="off"
        autoFocus={autoFocus}
        className="px-input"
        placeholder={t("calendar.form.skillPh")}
        aria-label={t("calendar.form.skill")}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        data-testid={testId}
      />
      {q.trim() !== "" && (
        <ul className="flex flex-col gap-1" role="listbox" aria-label={t("calendar.form.skill")}>
          {results.length === 0 ? (
            <li className="text-muted px-1 text-xs">{t("calendar.form.skillNone")}</li>
          ) : (
            results.map((s) => {
              return (
                <li key={s.id} role="option" aria-selected={false}>
                  <button
                    type="button"
                    className="px-inset hover:border-accent flex w-full items-center gap-2 py-2 text-start text-sm"
                    onClick={() => onPick(s)}
                    data-testid={`${testId}-option`}
                    data-skill={s.id}
                  >
                    <Gamepad2
                      size={16}
                      strokeWidth={1.75}
                      className="text-ink-2 shrink-0"
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1 truncate">{L(s.name)}</span>
                    <span className="text-muted shrink-0 text-xs">{t(`tier.${s.tier}`)}</span>
                  </button>
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}
