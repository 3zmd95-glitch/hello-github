"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useGameActions } from "@/components/celebrate/useGameActions";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import type { Purchase, Reward } from "@/lib/domain";
import { canBuy, rewardText, type BuyRefusal } from "@/lib/gems";
import { useT, type MessageKey } from "@/lib/i18n";
import { useStore } from "@/store";

/** Emoji the owner can pick for a real reward. */
export const REWARD_ICONS = [
  "🎁",
  "☕",
  "🍽️",
  "🎬",
  "🎧",
  "📷",
  "🎨",
  "🕶️",
  "👟",
  "✈️",
  "🎮",
  "📚",
];

const newId = (): string =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const refusalKey = (reason: BuyRefusal): MessageKey => `xp.buy.${reason}`;

interface FormValues {
  name: string;
  desc: string;
  cost: string;
  minLevel: string;
  repeatable: boolean;
  icon: string;
}

const emptyForm = (): FormValues => ({
  name: "",
  desc: "",
  cost: "100",
  minLevel: "",
  repeatable: false,
  icon: REWARD_ICONS[0],
});

function formFrom(reward: Reward, lang: "ar" | "en"): FormValues {
  return {
    name: rewardText(reward.name, lang),
    desc: rewardText(reward.desc, lang),
    cost: String(reward.cost),
    minLevel: reward.minLevel ? String(reward.minLevel) : "",
    repeatable: reward.repeatable,
    icon: reward.icon,
  };
}

/**
 * Gem shop: one card per reward with its buy state, plus the owner's editor for real rewards
 * (add / edit / remove; the built-in freeze stays).
 */
export default function GemShop({
  rewards,
  purchases,
  gems,
  level,
}: {
  rewards: readonly Reward[];
  purchases: readonly Purchase[];
  gems: number;
  level: number;
}) {
  const { t, lang } = useT();
  const { buyReward } = useGameActions();
  const [editing, setEditing] = useState<"new" | string | null>(null);
  const [removing, setRemoving] = useState<Reward | null>(null);
  const [note, setNote] = useState<{ id: string; text: string; ok: boolean } | null>(null);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(noteTimer.current), []);

  const ownedCount = (id: string) => purchases.filter((p) => p.rewardId === id).length;

  const onBuy = (reward: Reward) => {
    const res = buyReward(reward.id);
    const text = res.ok
      ? t("xp.buy.ok")
      : t(refusalKey(res.reason ?? "unknown"), { n: reward.minLevel ?? 1 });
    setNote({ id: reward.id, text, ok: res.ok });
    clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => setNote(null), 2500);
  };

  const onRemove = () => {
    if (!removing) return;
    useStore.getState().removeReward(removing.id);
    if (editing === removing.id) setEditing(null);
    setRemoving(null);
  };

  return (
    <section className="flex flex-col gap-3" data-testid="gem-shop">
      <header className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg">{t("rewards.shop.title")}</h2>
          <p className="text-muted text-xs">{t("rewards.shop.sub")}</p>
        </div>
        <span className="px-chip px-chip-gold">
          💎 <span className="num">{gems}</span>
        </span>
      </header>

      <div className="rw-shop">
        {rewards.map((reward) => {
          const owned = ownedCount(reward.id);
          const check = canBuy(reward, { gems, level, owned: owned > 0 });
          return editing === reward.id ? (
            <RewardForm
              key={reward.id}
              reward={reward}
              onClose={() => setEditing(null)}
              onRemove={() => setRemoving(reward)}
            />
          ) : (
            <RewardCard
              key={reward.id}
              reward={reward}
              owned={owned}
              check={check}
              note={note?.id === reward.id ? note : null}
              onBuy={() => onBuy(reward)}
              onEdit={reward.builtIn ? undefined : () => setEditing(reward.id)}
              onRemove={reward.builtIn ? undefined : () => setRemoving(reward)}
            />
          );
        })}
        {editing === "new" ? (
          <RewardForm onClose={() => setEditing(null)} />
        ) : (
          <button
            type="button"
            className="rw-add"
            onClick={() => setEditing("new")}
            data-testid="reward-add"
          >
            {t("rewards.shop.add")}
          </button>
        )}
      </div>

      {removing && (
        <ConfirmDialog
          title={t("rewards.shop.removeTitle")}
          body={t("rewards.shop.removeBody", { name: rewardText(removing.name, lang) })}
          confirmLabel={t("rewards.shop.removeOk")}
          danger
          onConfirm={onRemove}
          onCancel={() => setRemoving(null)}
        />
      )}
    </section>
  );
}

function RewardCard({
  reward,
  owned,
  check,
  note,
  onBuy,
  onEdit,
  onRemove,
}: {
  reward: Reward;
  owned: number;
  check: { ok: boolean; reason?: BuyRefusal };
  note: { text: string; ok: boolean } | null;
  onBuy: () => void;
  onEdit?: () => void;
  onRemove?: () => void;
}) {
  const { t, lang } = useT();
  const name = rewardText(reward.name, lang);
  const desc = rewardText(reward.desc, lang);
  const locked = check.reason === "level";
  const hint =
    check.ok || !check.reason ? null : t(refusalKey(check.reason), { n: reward.minLevel ?? 1 });

  return (
    <article
      className={`px-card rw-item flex flex-col gap-2 ${locked ? "rw-item-locked" : ""}`}
      data-testid="reward-card"
      data-reward={reward.id}
      data-can-buy={check.ok}
    >
      <div className="flex items-start gap-3">
        <span aria-hidden className="rw-icon">
          {reward.icon}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[1rem] leading-tight" data-testid="reward-title">
            {name}
          </h3>
          {desc && <p className="text-ink-2 mt-0.5 text-xs">{desc}</p>}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {reward.minLevel !== undefined && (
          <span className={`px-chip ${locked ? "px-chip-lock" : ""}`}>
            {locked && "🔒"} <span className="num">LV {reward.minLevel}</span>
          </span>
        )}
        {reward.builtIn && <span className="px-chip">{t("rewards.shop.builtIn")}</span>}
        {!reward.repeatable && <span className="px-chip">{t("rewards.shop.once")}</span>}
        {reward.repeatable && owned > 0 && (
          <span className="px-chip px-chip-green" data-testid="reward-owned">
            {t("rewards.shop.owned", { n: owned })}
          </span>
        )}
      </div>

      <div className="mt-auto flex items-center gap-2">
        <span className="text-gold text-base font-extrabold">
          <span className="num">{reward.cost}</span> 💎
        </span>
        <button
          type="button"
          className="px-btn px-btn-sm ms-auto"
          disabled={!check.ok}
          onClick={onBuy}
          title={hint ?? undefined}
          data-testid="reward-buy"
        >
          {check.reason === "owned" ? "✓" : t("rewards.shop.buy")}
        </button>
      </div>

      {(note || hint) && (
        <p
          className={`text-xs ${note ? (note.ok ? "text-accent" : "text-danger") : "text-muted"}`}
          data-testid="reward-note"
        >
          {note ? note.text : hint}
        </p>
      )}

      {(onEdit || onRemove) && (
        <div className="flex gap-2">
          {onEdit && (
            <button
              type="button"
              className="px-btn px-btn-ghost px-btn-sm"
              onClick={onEdit}
              data-testid="reward-edit"
            >
              {t("rewards.shop.edit")}
            </button>
          )}
          {onRemove && (
            <button
              type="button"
              className="px-btn px-btn-ghost px-btn-sm text-danger"
              onClick={onRemove}
              data-testid="reward-remove"
            >
              {t("rewards.shop.remove")}
            </button>
          )}
        </div>
      )}
    </article>
  );
}

/** Inline add / edit form for an owner-defined reward. */
function RewardForm({
  reward,
  onClose,
  onRemove,
}: {
  reward?: Reward;
  onClose: () => void;
  onRemove?: () => void;
}) {
  const { t, lang } = useT();
  const [values, setValues] = useState<FormValues>(() =>
    reward ? formFrom(reward, lang) : emptyForm(),
  );
  const set = <K extends keyof FormValues>(key: K, value: FormValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }));

  const name = values.name.trim();
  const cost = Number.parseInt(values.cost, 10);
  const minLevel = values.minLevel.trim() ? Number.parseInt(values.minLevel, 10) : undefined;
  const valid =
    name.length > 0 &&
    Number.isInteger(cost) &&
    cost >= 0 &&
    (minLevel === undefined || (Number.isInteger(minLevel) && minLevel >= 1));

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    const desc = values.desc.trim();
    const patch = {
      name,
      ...(desc ? { desc } : {}),
      cost,
      ...(minLevel !== undefined ? { minLevel } : {}),
      repeatable: values.repeatable,
      icon: values.icon,
    };
    const store = useStore.getState();
    if (reward) {
      store.updateReward(reward.id, { ...patch, desc: desc || undefined, minLevel });
    } else {
      store.addReward({ id: newId(), ...patch });
    }
    onClose();
  };

  return (
    <form
      className="px-card rw-item flex flex-col gap-2"
      onSubmit={onSubmit}
      data-testid="reward-form"
      data-mode={reward ? "edit" : "new"}
    >
      <h3 className="text-[1rem]">
        {t(reward ? "rewards.form.editTitle" : "rewards.form.newTitle")}
      </h3>

      <label className="flex flex-col gap-1 text-xs">
        <span className="text-muted">{t("rewards.form.name")}</span>
        <input
          className="px-input"
          value={values.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder={t("rewards.form.namePh")}
          maxLength={60}
          required
          autoFocus
          data-testid="reward-name"
        />
      </label>

      <label className="flex flex-col gap-1 text-xs">
        <span className="text-muted">{t("rewards.form.desc")}</span>
        <input
          className="px-input"
          value={values.desc}
          onChange={(e) => set("desc", e.target.value)}
          placeholder={t("rewards.form.descPh")}
          maxLength={120}
          data-testid="reward-desc"
        />
      </label>

      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted">{t("rewards.form.cost")}</span>
          <input
            className="px-input num"
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            value={values.cost}
            onChange={(e) => set("cost", e.target.value)}
            required
            data-testid="reward-cost"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted">{t("rewards.form.minLevel")}</span>
          <input
            className="px-input num"
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            value={values.minLevel}
            onChange={(e) => set("minLevel", e.target.value)}
            data-testid="reward-min-level"
          />
        </label>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="h-5 w-5 accent-[var(--accent)]"
          checked={values.repeatable}
          onChange={(e) => set("repeatable", e.target.checked)}
          data-testid="reward-repeatable"
        />
        {t("rewards.form.repeatable")}
      </label>

      <fieldset className="flex flex-col gap-1 text-xs">
        <legend className="text-muted mb-1">{t("rewards.form.icon")}</legend>
        <div className="flex flex-wrap gap-1.5" role="radiogroup">
          {REWARD_ICONS.map((icon) => (
            <button
              key={icon}
              type="button"
              role="radio"
              aria-checked={values.icon === icon}
              aria-label={icon}
              className="rw-emoji"
              data-on={values.icon === icon}
              onClick={() => set("icon", icon)}
            >
              {icon}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="mt-1 flex flex-wrap items-center gap-2">
        {onRemove && (
          <button
            type="button"
            className="px-btn px-btn-ghost px-btn-sm text-danger"
            onClick={onRemove}
            data-testid="reward-remove"
          >
            {t("rewards.shop.remove")}
          </button>
        )}
        <button type="button" className="px-btn px-btn-ghost px-btn-sm ms-auto" onClick={onClose}>
          {t("common.cancel")}
        </button>
        <button
          type="submit"
          className="px-btn px-btn-sm"
          disabled={!valid}
          data-testid="reward-save"
        >
          {t("rewards.form.save")}
        </button>
      </div>
    </form>
  );
}
