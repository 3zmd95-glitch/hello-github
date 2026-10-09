"use client";

import { useT, type MessageKey } from "@/lib/i18n";
import { subscriptionError } from "@/lib/localAi";
import AiConnectionControls from "./AiConnectionControls";
import type { CategoryVisualQueue } from "./useCategoryVisual";

export default function CategoryVisualChecks({
  queue,
  lookupBusy,
}: {
  queue: CategoryVisualQueue;
  lookupBusy: boolean;
}) {
  const { t } = useT();
  const progress = queue.progress;
  const running = progress?.status === "running";
  const errorKey: MessageKey =
    progress?.error === "local_ai_unavailable"
      ? "formats.checkLocalOnly"
      : subscriptionError(progress?.error) === "subscription_limit"
        ? "search.subscriptionLimit"
        : subscriptionError(progress?.error) === "subscription_auth"
          ? "visual.connectionChanged"
          : subscriptionError(progress?.error) === "subscription_model"
            ? "search.chooseModel"
            : "visual.failed";
  return (
    <details
      className="border-edge border-t pt-2 text-xs"
      data-testid="category-visual"
      open={queue.open}
      onToggle={(event) => {
        if (event.currentTarget.open !== queue.open) queue.setOpen(event.currentTarget.open);
      }}
    >
      <summary className="px-link w-fit cursor-pointer font-bold">{t("visual.title")}</summary>
      {queue.open && (
        <div className="mt-2 flex min-w-0 flex-col gap-2">
          <p className="text-muted">{t("visual.help")}</p>
          <AiConnectionControls value={queue.choice} onChange={queue.setChoice} />
          {queue.choice.provider !== "chatgpt" && <p>{t("formats.inspectChatgptOnly")}</p>}
          {queue.choice.model && (
            <p dir="ltr" className="break-words" data-testid="category-visual-model">
              {queue.choice.provider === "chatgpt" ? "ChatGPT" : "Claude"} · {queue.choice.model}
              {queue.choice.effort ? ` · ${queue.choice.effort}` : ""}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="px-btn px-btn-sm"
              disabled={!queue.canAssess || running || lookupBusy || !queue.eligibleCount}
              onClick={() => void queue.assess()}
              data-testid="category-visual-assess"
            >
              {t("visual.assess")}
            </button>
            {running && (
              <button
                type="button"
                className="px-link"
                onClick={queue.cancel}
                data-testid="category-visual-cancel"
              >
                {t("visual.cancel")}
              </button>
            )}
          </div>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={queue.afterLookup}
              disabled={!queue.canAssess || running || lookupBusy}
              onChange={(event) => queue.setAfterLookup(event.target.checked)}
              data-testid="category-visual-after-lookup"
            />
            <span>{t("visual.afterLookup")}</span>
          </label>
          {!queue.eligibleCount && !running && (
            <p className="text-muted">{t("visual.noCandidates")}</p>
          )}
          {progress && (
            <p role="status" data-testid="category-visual-progress">
              {t(
                progress.status === "running"
                  ? "visual.progress"
                  : progress.status === "cancelled"
                    ? "visual.cancelled"
                    : "visual.complete",
                { n: progress.assessed, tried: progress.attempted, total: progress.total },
              )}
            </p>
          )}
          {progress?.status === "error" && <p role="alert">{t(errorKey)}</p>}
        </div>
      )}
    </details>
  );
}
