"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { EditFormat } from "@/lib/editFormats";
import { assessFormatSource, formatVerificationTarget } from "@/lib/formatVerification";
import { inspectFormatPreview, localInstagramSource } from "@/lib/formatSources";
import { useT } from "@/lib/i18n";
import { subscriptionError, type AiChoice } from "@/lib/localAi";
import type { InstagramSource } from "../../workers/scout/src/instagramSource";
import AiConnectionControls from "./AiConnectionControls";

type Inspection = Extract<Awaited<ReturnType<typeof inspectFormatPreview>>, { ok: true }>["data"];

/** A visible, on-demand source check, kept separate from search and from whole-video verification. */
export default function FormatSourceInspector({ formats }: { formats: EditFormat[] }) {
  const { t, lang } = useT();
  const id = useId();
  const [key, setKey] = useState(formats[0]?.key ?? "");
  const format = formats.find((row) => row.key === key) ?? formats[0];
  const [url, setUrl] = useState(
    format?.samples.find((sample) => sample.platform === "ig")?.url ?? "",
  );
  const [source, setSource] = useState<InstagramSource | null>(null);
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [choice, setChoice] = useState<AiChoice>({ provider: "builtin", model: "" });
  const [aiOpen, setAiOpen] = useState(false);
  const [mode, setMode] = useState<"frames" | "preview">("frames");
  const [busy, setBusy] = useState<"source" | "ai" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  const reset = () => {
    pending.current?.abort();
    pending.current = null;
    setBusy(null);
    setSource(null);
    setInspection(null);
    setError(null);
  };
  const check = async (ai = false) => {
    if (!format || busy) return;
    reset();
    const controller = new AbortController();
    pending.current = controller;
    setBusy(ai ? "ai" : "source");
    if (ai && choice.provider === "chatgpt" && choice.model) {
      const result = await inspectFormatPreview(
        { ...choice, provider: "chatgpt" },
        format,
        url,
        lang,
        controller.signal,
        mode,
      );
      if (controller.signal.aborted) return;
      if (result.ok) {
        setInspection(result.data);
        setSource(result.data.verification.source);
      } else setError(result.error);
    } else {
      const result = await localInstagramSource(url, controller.signal);
      if (controller.signal.aborted) return;
      setSource(result);
      if (!result || result.status !== "available") setError("source_unavailable");
    }
    setBusy(null);
  };
  if (!format) return null;
  const assessment = source ? assessFormatSource(formatVerificationTarget(format), source) : null;
  const canInspect = choice.provider === "chatgpt" && !!choice.model;
  const errorKey =
    error === "source_unavailable"
      ? "formats.checkUnavailable"
      : error === "local_ai_unavailable"
        ? "formats.checkLocalOnly"
        : error?.startsWith("source_frames_")
          ? "formats.framesUnavailable"
          : subscriptionError(error) === "subscription_limit"
            ? "search.subscriptionLimit"
            : "formats.checkFailed";
  return (
    <details className="border-edge border-t-2 pt-3 text-xs" data-testid="format-inspector">
      <summary className="px-link w-fit cursor-pointer font-bold">
        {t("formats.checkTitle")}
      </summary>
      <div className="mt-3 flex min-w-0 flex-col gap-3">
        <p className="text-muted">{t("formats.checkHelp")}</p>
        <label htmlFor={`${id}-format`}>{t("formats.checkAgainst")}</label>
        <select
          id={`${id}-format`}
          className="px-input w-full min-w-0"
          value={format.key}
          onChange={(event) => {
            reset();
            setKey(event.target.value);
            const next = formats.find((row) => row.key === event.target.value);
            setUrl(next?.samples.find((sample) => sample.platform === "ig")?.url ?? "");
          }}
        >
          {formats.map((row) => (
            <option key={row.key} value={row.key}>
              {lang === "ar" ? (row.name.ar ?? row.name.en) : row.name.en}
            </option>
          ))}
        </select>
        <form
          className="flex min-w-0 flex-wrap gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void check();
          }}
        >
          <label className="flex min-w-0 grow flex-col gap-1" htmlFor={`${id}-url`}>
            <span>{t("formats.checkUrl")}</span>
            <input
              id={`${id}-url`}
              data-testid="format-check-url"
              className="px-input w-full min-w-0"
              type="url"
              required
              maxLength={1000}
              value={url}
              dir="ltr"
              onChange={(event) => {
                reset();
                setUrl(event.target.value);
              }}
            />
          </label>
          <button
            className="px-btn px-btn-sm self-end"
            disabled={!!busy || !url}
            data-testid="format-check-source"
          >
            {t(busy === "source" ? "formats.checking" : "formats.checkSource")}
          </button>
        </form>
        {source?.status === "available" && assessment && (
          <div className="bg-panel-2 flex flex-col gap-2 p-3" data-testid="format-source-result">
            <p className="font-bold">
              {t(
                assessment.audio === "match"
                  ? "formats.audioMatch"
                  : assessment.audio === "mismatch"
                    ? "formats.audioMismatch"
                    : "formats.audioUnknown",
              )}
            </p>
            {source.audio && (
              <p dir="auto">
                {source.audio.title}
                {source.audio.artist ? ` · ${source.audio.artist}` : ""}
              </p>
            )}
            <p className="text-muted">{t("formats.actualCaption")}</p>
            <blockquote dir="auto" className="break-words">
              {source.description || t("formats.noCaption")}
            </blockquote>
            <p className="text-muted">{t("formats.metadataLimit")}</p>
            <a
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              className="px-link w-fit"
            >
              {t("formats.watch")}
            </a>
          </div>
        )}
        <details onToggle={(event) => setAiOpen(event.currentTarget.open)}>
          <summary className="px-link w-fit cursor-pointer">{t("formats.inspectTitle")}</summary>
          {aiOpen && (
            <div className="mt-2 flex min-w-0 flex-col gap-2">
              <p className="text-muted">{t("formats.inspectHelp")}</p>
              <label className="flex flex-col gap-1" htmlFor={`${id}-mode`}>
                <span>{t("formats.inspectMode")}</span>
                <select
                  className="px-input max-w-full"
                  id={`${id}-mode`}
                  value={mode}
                  onChange={(event) => {
                    reset();
                    setMode(event.target.value as "frames" | "preview");
                  }}
                >
                  <option value="frames">{t("formats.inspectFrames")}</option>
                  <option value="preview">{t("formats.inspectPreviewOnly")}</option>
                </select>
              </label>
              <AiConnectionControls
                value={choice}
                onChange={(next) => {
                  reset();
                  setChoice(next);
                }}
              />
              {choice.provider === "claude" && <p>{t("formats.inspectChatgptOnly")}</p>}
              <button
                type="button"
                className="px-btn px-btn-sm w-fit"
                disabled={!canInspect || !!busy || !url}
                onClick={() => void check(true)}
                data-testid="format-inspect-preview"
              >
                {t(busy === "ai" ? "formats.inspecting" : "formats.inspectButton")}
              </button>
            </div>
          )}
        </details>
        {inspection && (
          <div className="bg-panel-2 flex flex-col gap-2 p-3" data-testid="format-visual-result">
            <p className="font-bold">
              {t(
                inspection.verification.visual === "match"
                  ? "formats.visualMatch"
                  : inspection.verification.visual === "mismatch"
                    ? "formats.visualMismatch"
                    : "formats.visualUnknown",
              )}
            </p>
            <p className="text-muted">
              {t(
                inspection.verification.basis === "source-thumbnail-and-metadata"
                  ? "formats.previewLimit"
                  : "formats.framesLimit",
              )}{" "}
              · {inspection.model}
              {inspection.effort ? ` · ${inspection.effort}` : ""}
            </p>
            {!!inspection.verification.frames?.length && (
              <p className="text-muted" dir="ltr">
                {inspection.verification.frames
                  .map((frame) => `${frame.timestampSeconds.toFixed(1)}s`)
                  .join(" · ")}
              </p>
            )}
            <ul className="list-disc space-y-1 ps-5" dir="auto">
              {inspection.verification.observations.map((line, index) => (
                <li key={index}>{line}</li>
              ))}
            </ul>
            <ul className="text-muted list-disc space-y-1 ps-5">
              {inspection.verification.limitations
                .filter(
                  (line) =>
                    line !== "motion_partial" ||
                    !inspection.verification.limitations.includes("sampled_frames"),
                )
                .map((line, index) => (
                  <li key={index}>
                    {t(
                      line === "single_thumbnail"
                        ? "formats.limitThumbnail"
                        : line === "motion_unverified"
                          ? "formats.limitMotion"
                          : line === "synchronization_unverified"
                            ? "formats.limitSync"
                            : "formats.limitSamples",
                    )}
                  </li>
                ))}
            </ul>
          </div>
        )}
        {error && <p role="alert">{t(errorKey)}</p>}
        {busy && (
          <p role="status">{t(busy === "ai" ? "formats.inspecting" : "formats.checking")}</p>
        )}
      </div>
    </details>
  );
}
