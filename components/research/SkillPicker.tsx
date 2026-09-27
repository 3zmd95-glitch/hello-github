"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { skills } from "@/data";
import { useT } from "@/lib/i18n";

/** Small modal to search skills by name and pick one (Discover's "attach to skill"). Esc/backdrop close. */
export default function SkillPicker({
  onPick,
  onClose,
}: {
  onPick: (skillId: string) => void;
  onClose: () => void;
}) {
  const { t, L } = useT();
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = !needle
      ? skills
      : skills.filter(
          (s) => s.name.en.toLowerCase().includes(needle) || s.name.ar.includes(q.trim()),
        );
    return list.slice(0, 40);
  }, [q]);

  return (
    <div
      className="anim-fade fixed inset-0 z-50 grid place-items-center bg-[rgba(5,8,12,.7)] p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("research.pickSkill")}
        className="px-card anim-popin flex max-h-[80dvh] w-full max-w-[420px] flex-col gap-3"
        data-testid="skill-picker"
      >
        <div className="flex items-center gap-2">
          <h2 className="flex-1 text-base">{t("research.pickSkill")}</h2>
          <button
            type="button"
            className="px-btn px-btn-ghost px-btn-sm"
            onClick={onClose}
            aria-label={t("common.close")}
          >
            ✕
          </button>
        </div>
        <input
          ref={inputRef}
          type="text"
          className="px-input"
          placeholder={t("research.pickSkillPh")}
          aria-label={t("research.pickSkillPh")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          data-testid="skill-picker-search"
        />
        <ul className="flex flex-col gap-1 overflow-y-auto">
          {filtered.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className="px-inset hover:border-gold block w-full text-start text-sm font-semibold"
                onClick={() => onPick(s.id)}
                data-testid="skill-picker-option"
              >
                {L(s.name)}
              </button>
            </li>
          ))}
          {filtered.length === 0 && (
            <li className="text-muted p-2 text-sm">{t("research.pickSkillEmpty")}</li>
          )}
        </ul>
      </div>
    </div>
  );
}
