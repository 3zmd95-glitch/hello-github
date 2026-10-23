"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import AiConnectionControls from "@/components/research/AiConnectionControls";
import type { Genre } from "@/lib/domain";
import { useT, type MessageKey } from "@/lib/i18n";
import { subscriptionError, type AiChoice, type AiSelection } from "@/lib/localAi";
import type { NativeVideoCapture } from "@/lib/nativeVideoCapture";
import { readNativeVideoCapture, reviewCapturedVideo } from "@/lib/nativeVideoCaptureClient";
import { CATEGORY_PROFILES } from "@/workers/scout/src/discover/category-profiles";
import { useStore } from "@/store";

/** Imported images stay in this mounted review only; only a successful dated receipt is saved. */
export default function NativeVideoCaptureReview({
  genres,
  onReviewed,
}: {
  genres: readonly Genre[];
  onReviewed: (genreId: string) => void;
}) {
  const { t, L, lang, dir } = useT();
  const [open, setOpen] = useState(false);
  const [genreId, setGenreId] = useState("");
  const [capture, setCapture] = useState<NativeVideoCapture>();
  const [choice, updateChoice] = useState<AiChoice>({ provider: "chatgpt", model: "" });
  const [status, setStatus] = useState<"idle" | "reading" | "running" | "done">("idle");
  const [error, setError] = useState<string>();
  const epoch = useStore((state) => state.discoverLibraryEpoch);
  const loading = useStore((state) => state.discoverLibraryStatus === "loading");
  const section = useRef<HTMLDetailsElement>(null);
  const pending = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const invalidate = useCallback(() => {
    generation.current++;
    pending.current?.abort();
    pending.current = null;
  }, []);
  const clear = useCallback(() => {
    invalidate();
    setCapture(undefined);
    setError(undefined);
    setStatus("idle");
  }, [invalidate]);
  useLayoutEffect(() => {
    return invalidate;
  }, [epoch, loading, genreId, lang, choice, invalidate]);
  useEffect(() => {
    const incoming = () => {
      if (location.hash !== "#video-capture") return;
      setOpen(true);
      section.current?.scrollIntoView?.({ block: "nearest" });
    };
    incoming();
    window.addEventListener("hashchange", incoming);
    return () => window.removeEventListener("hashchange", incoming);
  }, []);
  const setChoice = useCallback(
    (next: AiChoice) => {
      invalidate();
      setStatus("idle");
      setError(undefined);
      updateChoice(next);
    },
    [invalidate],
  );
  const read = async (file: File) => {
    clear();
    const token = generation.current;
    setStatus("reading");
    const result = await readNativeVideoCapture(file);
    if (token !== generation.current) return;
    setStatus("idle");
    if (result.ok) setCapture(result.capture);
    else setError(result.error);
  };
  const review = async () => {
    if (
      !capture ||
      !genreId ||
      !choice.model ||
      choice.provider !== "chatgpt" ||
      loading ||
      pending.current
    )
      return;
    const controller = new AbortController();
    pending.current = controller;
    const token = generation.current;
    const selection: AiSelection = { ...choice, provider: "chatgpt" };
    const isCurrent = () =>
      pending.current === controller &&
      !controller.signal.aborted &&
      generation.current === token &&
      useStore.getState().discoverLibraryEpoch === epoch &&
      useStore.getState().discoverLibraryStatus !== "loading";
    setError(undefined);
    setStatus("running");
    const result = await reviewCapturedVideo(
      { ...selection, provider: "chatgpt", genreId, lang, allowModel: true, capture },
      controller.signal,
    );
    if (!isCurrent()) return;
    if (!result.ok || result.data.status !== "assessed") {
      pending.current = null;
      setError(
        !result.ok
          ? result.error
          : result.data.status === "unavailable"
            ? result.data.error
            : "assessment_failed",
      );
      setStatus("idle");
      return;
    }
    const applied = useStore.getState().applyCapturedVideoReviewResult(result.data, {
      epoch,
      genreId,
      url: capture.url,
      selection,
      isCurrent,
    });
    pending.current = null;
    if (applied === "invalid" || applied === "stale") {
      setError("stale_result");
      setStatus("idle");
      return;
    }
    setCapture(undefined);
    setStatus("done");
    onReviewed(genreId);
  };
  const errorKey: MessageKey =
    error === "capture_too_large"
      ? "capture.tooLarge"
      : error === "invalid_capture"
        ? "capture.invalid"
        : error === "local_ai_unavailable"
          ? "formats.checkLocalOnly"
          : subscriptionError(error) === "subscription_limit"
            ? "search.subscriptionLimit"
            : subscriptionError(error) === "subscription_auth"
              ? "visual.connectionChanged"
              : subscriptionError(error) === "subscription_model"
                ? "search.chooseModel"
                : "capture.failed";
  const busy = status === "running" || status === "reading";
  return (
    <details
      id="video-capture"
      ref={section}
      className="border-edge min-w-0 border-t pt-2 text-xs"
      data-testid="native-video-review"
      open={open}
      onToggle={(event) => {
        const next = event.currentTarget.open;
        if (next !== open) {
          setOpen(next);
          if (!next) clear();
        }
      }}
    >
      <summary className="px-link w-fit cursor-pointer font-bold">{t("capture.title")}</summary>
      {open && (
        <div className="mt-3 flex min-w-0 flex-col gap-3">
          <p>{t("capture.help")}</p>
          <p className="text-muted">{t("capture.limits")}</p>
          <label className="flex min-w-0 flex-col gap-1">
            <span>{t("capture.file")}</span>
            <input
              type="file"
              accept=".json,application/json"
              className="px-input max-w-full min-w-0"
              disabled={busy}
              data-testid="native-video-file"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void read(file);
              }}
            />
          </label>
          <label className="flex min-w-0 flex-col gap-1">
            <span>{t("capture.category")}</span>
            <select
              className="px-input min-w-0"
              value={genreId}
              dir={dir}
              disabled={busy}
              data-testid="native-video-category"
              onChange={(event) => {
                invalidate();
                setGenreId(event.target.value);
                setStatus("idle");
                setError(undefined);
              }}
            >
              <option value="">{t("capture.chooseCategory")}</option>
              {genres
                .filter((genre) => Object.hasOwn(CATEGORY_PROFILES, genre.id))
                .map((genre) => (
                  <option key={genre.id} value={genre.id}>
                    {L(genre.name)}
                  </option>
                ))}
            </select>
          </label>
          {capture && (
            <div className="flex min-w-0 flex-col gap-2" data-testid="native-video-preview">
              <a
                href={capture.url}
                target="_blank"
                rel="noopener noreferrer"
                className="px-link break-all"
                dir="ltr"
              >
                {capture.url}
              </a>
              <p>{t("capture.count", { n: capture.frames.length })}</p>
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {capture.frames.map((frame, index) => (
                  <li key={index} className="min-w-0">
                    {/* Local validated JPEG bytes; no remote thumbnail or optimizer request. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={frame.dataUrl}
                      alt={t("capture.preview", { n: index + 1 })}
                      className="h-36 w-full object-contain"
                    />
                    <p dir="ltr">{frame.timestampSeconds.toFixed(1)}s</p>
                  </li>
                ))}
              </ul>
              <p className="text-muted">{t("capture.memoryOnly")}</p>
            </div>
          )}
          <AiConnectionControls value={choice} onChange={setChoice} preferredModel="gpt-6-astra" />
          {choice.model && (
            <p dir="ltr" data-testid="native-video-model">
              {choice.provider === "chatgpt" ? "ChatGPT" : "Claude"} · {choice.model}
              {choice.effort ? ` · ${choice.effort}` : ""}
            </p>
          )}
          {choice.provider !== "chatgpt" && <p>{t("formats.inspectChatgptOnly")}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="px-btn px-btn-sm"
              data-testid="native-video-check"
              disabled={
                busy ||
                loading ||
                !capture ||
                !genreId ||
                choice.provider !== "chatgpt" ||
                !choice.model
              }
              onClick={() => void review()}
            >
              {t("capture.check")}
            </button>
            {(capture || busy) && (
              <button
                type="button"
                className="px-link"
                data-testid="native-video-clear"
                onClick={clear}
              >
                {t(busy ? "visual.cancel" : "capture.clear")}
              </button>
            )}
          </div>
          <p className="text-muted">{t("capture.cost")}</p>
          {status !== "idle" && (
            <p role="status" data-testid="native-video-status">
              {t(
                status === "reading"
                  ? "capture.reading"
                  : status === "running"
                    ? "capture.running"
                    : "capture.done",
              )}
            </p>
          )}
          {error && <p role="alert">{t(errorKey)}</p>}
        </div>
      )}
    </details>
  );
}
