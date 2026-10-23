"use client";

import { useState } from "react";
import { canonicalDiscoverVisualUrl } from "@/lib/discoverVisual";
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
  const { t, dir } = useT();
  const [selectedUrl, setSelectedUrl] = useState("");
  const options = queue.eligibleItems.flatMap((item) => {
    const url = canonicalDiscoverVisualUrl(item.url);
    return url ? [{ ...item, url }] : [];
  });
  const selectionUnavailable = !!selectedUrl && !options.some((item) => item.url === selectedUrl);
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
          <label className="flex min-w-0 flex-col gap-1">
            <span>{t("visual.target")}</span>
            <select
              className="px-input w-full min-w-0"
              dir={dir}
              value={selectedUrl}
              disabled={!queue.canAssess || running || lookupBusy}
              onChange={(event) => setSelectedUrl(event.target.value)}
              data-testid="category-visual-target"
            >
              <option value="">{t("visual.batchTarget")}</option>
              {selectionUnavailable && (
                <option value={selectedUrl} disabled>
                  {t("visual.unavailableTarget")}
                </option>
              )}
              {options.map((item) => {
                const label = [item.handle, item.title]
                  .filter(Boolean)
                  .join(" · ")
                  .replace(/\s+/g, " ");
                return (
                  <option key={item.url} value={item.url} dir="auto">
                    {label.length > 120 ? `${label.slice(0, 119)}…` : label}
                  </option>
                );
              })}
            </select>
          </label>
          {selectedUrl && (
            <div className="flex min-w-0 flex-col items-start gap-1">
              <a
                className="px-link"
                href={selectedUrl}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="category-visual-target-open"
              >
                {t("visual.openTarget")}
              </a>
              <p className="text-muted">{t("visual.singleHelp")}</p>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="px-btn px-btn-sm"
              disabled={
                !queue.canAssess ||
                running ||
                lookupBusy ||
                !queue.eligibleCount ||
                selectionUnavailable
              }
              onClick={() => void queue.assess(selectedUrl || undefined)}
              data-testid="category-visual-assess"
            >
              {t(selectedUrl ? "visual.assessOne" : "visual.assess")}
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
          <label className="border-edge mt-1 flex items-start gap-2 border-t pt-2">
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
