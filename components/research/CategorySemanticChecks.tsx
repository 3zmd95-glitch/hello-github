"use client";

import { useT, type MessageKey } from "@/lib/i18n";
import { subscriptionError } from "@/lib/localAi";
import AiConnectionControls from "./AiConnectionControls";
import type { CategorySemanticQueue } from "./useCategorySemantic";

export default function CategorySemanticChecks({
  queue,
  lookupBusy,
}: {
  queue: CategorySemanticQueue;
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
            : "semantic.failed";
  return (
    <details
      className="border-edge border-t pt-2 text-xs"
      data-testid="category-semantic"
      open={queue.open}
      onToggle={(event) => {
        if (event.currentTarget.open !== queue.open) queue.setOpen(event.currentTarget.open);
      }}
    >
      <summary className="px-link w-fit cursor-pointer font-bold">{t("semantic.title")}</summary>
      {queue.open && (
        <div className="mt-2 flex min-w-0 flex-col gap-2">
          <p className="text-muted">{t("semantic.help")}</p>
          <AiConnectionControls value={queue.choice} onChange={queue.setChoice} />
          {queue.choice.provider !== "chatgpt" && <p>{t("formats.inspectChatgptOnly")}</p>}
          {queue.choice.model && (
            <p dir="ltr" className="break-words" data-testid="category-semantic-model">
              {queue.choice.provider === "chatgpt" ? "ChatGPT" : "Claude"} · {queue.choice.model}
              {queue.choice.effort ? ` · ${queue.choice.effort}` : ""}
            </p>
          )}
          <p className="text-muted">{t("semantic.limit")}</p>
          {!!queue.batchPreview.length && !running && (
            <ul className="list-disc space-y-1 ps-4" data-testid="category-semantic-preview">
              {queue.batchPreview.map((item) => (
                <li key={item.url} className="min-w-0">
                  <a
                    className="px-link block truncate"
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    dir="auto"
                  >
                    {(item.evidence?.caption?.trim() || item.title).slice(0, 100)}
                  </a>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="px-btn px-btn-sm"
              disabled={!queue.canAssess || running || lookupBusy || !queue.eligibleCount}
              onClick={() => void queue.assess()}
              data-testid="category-semantic-assess"
            >
              {t("semantic.assess")}
            </button>
            {running && (
              <button
                type="button"
                className="px-link"
                onClick={queue.cancel}
                data-testid="category-semantic-cancel"
              >
                {t("visual.cancel")}
              </button>
            )}
          </div>
          {!queue.eligibleCount && !running && (
            <p className="text-muted">{t("semantic.noCandidates")}</p>
          )}
          {progress && (
            <p role="status" data-testid="category-semantic-progress">
              {t(
                progress.status === "running"
                  ? "semantic.progress"
                  : progress.status === "cancelled"
                    ? "semantic.cancelled"
                    : "semantic.complete",
                { n: progress.assessed, total: progress.total },
              )}
            </p>
          )}
          {progress?.status === "error" && <p role="alert">{t(errorKey)}</p>}
        </div>
      )}
    </details>
  );
}
