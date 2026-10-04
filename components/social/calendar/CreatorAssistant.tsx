"use client";

import { useEffect, useRef, useState } from "react";
import type { Lang, Post } from "@/lib/domain";
import {
  creatorPatch,
  creatorSnapshot,
  downloadCreatorFile,
  productionPack,
  requestCreatorDraft,
  scriptText,
  subtitleFile,
  type CreatorDraft,
  type CreatorFailure,
  type CreatorRequest,
} from "@/lib/creator";
import { useT } from "@/lib/i18n";
import { scoutConfig } from "@/lib/scoutClient";
import { useStore } from "@/store";

export default function CreatorAssistant({ post }: { post: Post }) {
  const { t, lang } = useT();
  const keys = useStore((s) => s.settings.apiKeys);
  const [brief, setBrief] = useState(post.title);
  const [language, setLanguage] = useState<Lang>(lang);
  const [tone, setTone] = useState<CreatorRequest["tone"]>("friendly");
  const [duration, setDuration] = useState(30);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<CreatorFailure | "stale" | null>(null);
  const [preview, setPreview] = useState<{ draft: CreatorDraft; snapshot: string } | null>(null);
  const [applied, setApplied] = useState(false);
  const [fields, setFields] = useState({ script: true, caption: true, shots: true });
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);
  const config = scoutConfig(keys.scoutUrl, keys.scoutToken);
  const stale = !!preview && creatorSnapshot(post) !== preview.snapshot;
  const validDuration = Number.isInteger(duration) && duration >= 10 && duration <= 180;
  const currentScript = scriptText(post.script);
  const safeName = `post-${post.id.replace(/[^\w-]/g, "").slice(0, 60)}`;

  const generate = async () => {
    if (busy || !validDuration || !brief.trim()) return;
    setBusy(true);
    setError(null);
    setApplied(false);
    setPreview(null);
    const current = useStore.getState().posts.find((p) => p.id === post.id);
    if (!current) {
      setBusy(false);
      setError("stale");
      return;
    }
    const snapshot = creatorSnapshot(current);
    const controller = new AbortController();
    abortRef.current = controller;
    const result = await requestCreatorDraft(
      config,
      {
        brief,
        title: current.title,
        platform: current.platform,
        script: { ...current.script, hook: current.script.hook || current.hook || "" },
        language,
        tone,
        durationSeconds: duration,
      },
      controller.signal,
    );
    if (controller.signal.aborted) return;
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setFields({
      script: !scriptText(current.script) && !current.hook?.trim(),
      caption: !current.caption.trim() && current.hashtags.length === 0,
      shots: current.shots.length === 0,
    });
    setPreview({ draft: result.draft, snapshot });
  };

  const apply = () => {
    if (!preview || !Object.values(fields).some(Boolean)) return;
    const state = useStore.getState();
    const current = state.posts.find((p) => p.id === post.id);
    const patch = creatorPatch(current, preview.snapshot, preview.draft, fields);
    if (!patch) {
      setError("stale");
      return;
    }
    state.updatePost(post.id, patch);
    setPreview(null);
    setApplied(true);
    setError(null);
  };

  const exportSubtitles = (format: "srt" | "vtt") => {
    const latest = useStore.getState().posts.find((p) => p.id === post.id);
    if (!latest || !validDuration) return;
    try {
      downloadCreatorFile(
        `${safeName}-estimated.${format}`,
        subtitleFile(scriptText(latest.script), duration, format),
        format === "vtt" ? "text/vtt;charset=utf-8" : "text/plain;charset=utf-8",
      );
    } catch {
      setError("bad_request");
    }
  };

  return (
    <section
      className="px-inset flex flex-col gap-3"
      aria-labelledby="creator-title"
      data-testid="creator-assistant"
    >
      <div>
        <h3 id="creator-title" className="text-sm font-bold">
          {t("creator.title")}
        </h3>
        <p className="text-muted text-xs">{t("creator.intro")}</p>
      </div>
      <label className="flex flex-col gap-1 text-sm">
        <span>{t("creator.brief")}</span>
        <textarea
          className="px-input cal-textarea"
          rows={3}
          maxLength={1200}
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          disabled={busy}
          placeholder={t("creator.briefPh")}
          data-testid="creator-brief"
        />
      </label>
      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-1 text-xs">
          {t("creator.language")}
          <select
            className="px-input"
            value={language}
            onChange={(e) => setLanguage(e.target.value as Lang)}
            disabled={busy}
          >
            <option value="ar">العربية</option>
            <option value="en">English</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          {t("creator.tone")}
          <select
            className="px-input"
            value={tone}
            onChange={(e) => setTone(e.target.value as CreatorRequest["tone"])}
            disabled={busy}
          >
            {(["friendly", "educational", "cinematic"] as const).map((value) => (
              <option key={value} value={value}>
                {t(`creator.tone.${value}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          {t("creator.duration")}
          <input
            className="px-input w-28"
            type="number"
            min={10}
            max={180}
            step={1}
            value={Number.isNaN(duration) ? "" : duration}
            onChange={(e) => setDuration(e.target.valueAsNumber)}
            disabled={busy}
            data-testid="creator-duration"
          />
        </label>
      </div>
      {!validDuration && <p className="text-danger text-xs">{t("creator.durationInvalid")}</p>}
      <p className="text-muted text-xs">{t("creator.privacy")}</p>
      {!config && <p className="text-muted text-xs">{t("creator.error.unconfigured")}</p>}
      <button
        type="button"
        className="px-btn px-btn-sm self-start"
        disabled={busy || !config || !brief.trim() || !validDuration}
        onClick={() => void generate()}
        data-testid="creator-generate"
      >
        {t(busy ? "creator.generating" : "creator.generate")}
      </button>
      {error && (
        <p role="alert" className="text-danger text-xs">
          {t(`creator.error.${error}`)}
        </p>
      )}
      {applied && (
        <p role="status" className="text-accent text-xs">
          {t("creator.applied")}
        </p>
      )}
      {preview && (
        <div
          className="border-line flex flex-col gap-3 border-t pt-3"
          data-testid="creator-preview"
        >
          <h4 className="text-sm font-bold">{t("creator.preview")}</h4>
          <p className="text-muted text-xs">{t("creator.review")}</p>
          <div dir={language === "ar" ? "rtl" : "ltr"} className="flex flex-col gap-2 text-sm">
            <strong>{t("calendar.script.hook")}</strong>
            <p className="whitespace-pre-wrap">{preview.draft.hook}</p>
            {preview.draft.beats.map((beat, i) => (
              <div key={i}>
                <strong>{t("calendar.script.beat", { n: i + 1 })}</strong>
                <p className="whitespace-pre-wrap">{beat}</p>
              </div>
            ))}
            <strong>{t("calendar.script.cta")}</strong>
            <p className="whitespace-pre-wrap">{preview.draft.cta}</p>
            <strong>{t("creator.caption")}</strong>
            <p className="whitespace-pre-wrap">{preview.draft.caption}</p>
            <p>{preview.draft.hashtags.join(" ")}</p>
            <strong>{t("creator.shots")}</strong>
            <ol className="list-inside list-decimal">
              {preview.draft.shots.map((shot, i) => (
                <li key={i}>
                  {t(`calendar.shotType.${shot.type}`)}: {shot.text}
                </li>
              ))}
            </ol>
          </div>
          <fieldset className="flex flex-col gap-1 text-xs" disabled={stale}>
            <legend className="mb-1 font-bold">{t("creator.selectFields")}</legend>
            {(["script", "caption", "shots"] as const).map((field) => (
              <label key={field} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={fields[field]}
                  onChange={(e) => setFields((old) => ({ ...old, [field]: e.target.checked }))}
                  data-testid={`creator-apply-${field}`}
                />
                {t(`creator.replace.${field}`)}
              </label>
            ))}
          </fieldset>
          {stale && (
            <p role="status" className="text-danger text-xs">
              {t("creator.error.stale")}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="px-btn px-btn-sm"
              onClick={apply}
              disabled={stale || !Object.values(fields).some(Boolean)}
              data-testid="creator-apply"
            >
              {t("creator.apply")}
            </button>
            <button
              type="button"
              className="px-btn px-btn-ghost px-btn-sm"
              onClick={() =>
                downloadCreatorFile(
                  `${safeName}-draft.txt`,
                  productionPack(
                    {
                      ...post,
                      script: {
                        hook: preview.draft.hook,
                        beats: preview.draft.beats,
                        cta: preview.draft.cta,
                      },
                      caption: preview.draft.caption,
                      hashtags: preview.draft.hashtags,
                      shots: preview.draft.shots,
                    },
                    language,
                  ),
                )
              }
            >
              {t("creator.exportDraft")}
            </button>
            <button
              type="button"
              className="px-btn px-btn-ghost px-btn-sm"
              onClick={() => setPreview(null)}
            >
              {t("creator.discard")}
            </button>
          </div>
        </div>
      )}
      <div className="border-line flex flex-col gap-2 border-t pt-3">
        <h4 className="text-sm font-bold">{t("creator.exportTitle")}</h4>
        <p className="text-muted text-xs">{t("creator.subtitleHint")}</p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="px-btn px-btn-ghost px-btn-sm"
            onClick={() => {
              const latest = useStore.getState().posts.find((p) => p.id === post.id);
              if (latest)
                downloadCreatorFile(`${safeName}-production.txt`, productionPack(latest, lang));
            }}
            data-testid="creator-export-pack"
          >
            {t("creator.exportPack")}
          </button>
          <button
            type="button"
            className="px-btn px-btn-ghost px-btn-sm"
            disabled={!currentScript || !validDuration || currentScript.length > 20_000}
            onClick={() => exportSubtitles("srt")}
          >
            {t("creator.exportSrt")}
          </button>
          <button
            type="button"
            className="px-btn px-btn-ghost px-btn-sm"
            disabled={!currentScript || !validDuration || currentScript.length > 20_000}
            onClick={() => exportSubtitles("vtt")}
          >
            {t("creator.exportVtt")}
          </button>
        </div>
      </div>
    </section>
  );
}
