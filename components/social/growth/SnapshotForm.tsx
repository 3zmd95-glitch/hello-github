"use client";

import { useState, type FormEvent } from "react";
import { PLATFORMS, SocialSnapshotSchema, type Platform } from "@/lib/domain";
import { useT } from "@/lib/i18n";
import { PLATFORM_META } from "@/lib/social";
import { useStore } from "@/store";
import GrowthDialog from "./GrowthDialog";

/** Manual entry of one platform's numbers for one day (upsert through addSnapshot). */
export default function SnapshotForm({
  platform: preset,
  today,
  onClose,
}: {
  platform?: Platform;
  today: string;
  onClose: () => void;
}) {
  const { t, L } = useT();
  const addSnapshot = useStore((s) => s.addSnapshot);
  const [platform, setPlatform] = useState<Platform>(preset ?? "tiktok");
  const [day, setDay] = useState(today);
  const [followers, setFollowers] = useState("");
  const [views, setViews] = useState("");
  const [engagement, setEngagement] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const toInt = (s: string) => {
    const n = Number(s.replace(/[,\s]/g, ""));
    return Number.isFinite(n) ? Math.round(n) : NaN;
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const eng = engagement.trim().replace("%", "");
    const parsed = SocialSnapshotSchema.safeParse({
      platform,
      day,
      followers: toInt(followers),
      views30d: toInt(views),
      ...(eng ? { engagementPct: Number(eng) } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
    });
    if (!parsed.success) {
      setError(t("growth.form.invalid"));
      return;
    }
    if (parsed.data.day > today) {
      setError(t("growth.form.future"));
      return;
    }
    addSnapshot(parsed.data);
    onClose();
  };

  return (
    <GrowthDialog title={t("growth.form.title")} testId="snapshot-dialog" onClose={onClose}>
      <form className="flex flex-col gap-3" onSubmit={submit} data-testid="snapshot-form">
        <p className="text-ink-2 text-sm">{t("growth.form.hint")}</p>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted">{t("growth.form.platform")}</span>
            <select
              className="px-input"
              value={platform}
              onChange={(e) => setPlatform(e.target.value as Platform)}
              data-testid="snapshot-platform"
            >
              {PLATFORMS.map((p) => (
                <option key={p} value={p}>
                  {PLATFORM_META[p].icon} {L(PLATFORM_META[p].name)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted">{t("growth.form.day")}</span>
            <input
              type="date"
              className="px-input num"
              value={day}
              max={today}
              required
              onChange={(e) => setDay(e.target.value)}
              data-testid="snapshot-day"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted">{t("growth.followers")}</span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              required
              className="px-input num"
              value={followers}
              onChange={(e) => setFollowers(e.target.value)}
              placeholder="1200"
              data-testid="snapshot-followers"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted">{t("growth.views30")}</span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              required
              className="px-input num"
              value={views}
              onChange={(e) => setViews(e.target.value)}
              placeholder="5000"
              data-testid="snapshot-views"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted">{t("growth.form.engagement")}</span>
            <input
              type="number"
              inputMode="decimal"
              min={0}
              max={100}
              step={0.1}
              className="px-input num"
              value={engagement}
              onChange={(e) => setEngagement(e.target.value)}
              placeholder="4.2"
              data-testid="snapshot-engagement"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted">{t("growth.form.note")}</span>
            <input
              type="text"
              className="px-input"
              value={note}
              maxLength={120}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t("growth.form.notePlaceholder")}
              data-testid="snapshot-note"
            />
          </label>
        </div>
        {error && (
          <p className="text-danger text-sm" role="alert" data-testid="snapshot-error">
            {error}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="px-btn px-btn-ghost" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button type="submit" className="px-btn" data-testid="snapshot-save">
            {t("growth.form.save")}
          </button>
        </div>
      </form>
    </GrowthDialog>
  );
}
