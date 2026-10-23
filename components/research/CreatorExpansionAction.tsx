"use client";

import { useT, type MessageKey } from "@/lib/i18n";
import type { CreatorExpansionQueue, CreatorSeedRow } from "./useCreatorExpansion";

export default function CreatorExpansionAction({
  queue,
  row,
}: {
  queue: CreatorExpansionQueue;
  row: CreatorSeedRow;
}) {
  const { t } = useT();
  if (!queue.eligible(row)) return null;
  const state = queue.forItem(row);
  return (
    <button
      type="button"
      className="px-link w-fit text-start text-xs"
      disabled={queue.busy}
      title={t("creatorSource.help")}
      onClick={() => void queue.run(row)}
      data-testid="feed-more-creator"
    >
      {t(state?.status === "loading" ? "creatorSource.loading" : "creatorSource.more")}
    </button>
  );
}

export function CreatorExpansionStatus({ queue }: { queue: CreatorExpansionQueue }) {
  const { t } = useT();
  const state = queue.outcome;
  if (!state) return null;
  const errors: Record<string, MessageKey> = {
    quota: "creatorSource.quota",
    auth: "creatorSource.auth",
    missing_key: "creatorSource.auth",
    invalid_seed: "creatorSource.unavailable",
    unavailable: "creatorSource.unavailable",
    cancelled: "creatorSource.cancelled",
  };
  return (
    <div
      className="border-edge flex min-w-0 flex-wrap items-center gap-2 border-s-2 ps-2 text-xs"
      data-testid="feed-creator-expansion"
    >
      <span className="font-bold" dir="auto">
        {state.author}
      </span>
      {state?.status === "loading" && (
        <button
          type="button"
          className="px-link"
          onClick={queue.cancel}
          data-testid="feed-creator-cancel"
        >
          {t("creatorSource.cancel")}
        </button>
      )}
      <p role="status" className="text-muted" data-testid="feed-creator-status">
        {state.status === "done"
          ? t("creatorSource.result", {
              checked: state.checked ?? 0,
              added: state.added ?? 0,
              qualified: state.qualified ?? 0,
            })
          : state.status === "cancelled"
            ? t("creatorSource.cancelled")
            : state.status === "error"
              ? t(errors[state.error ?? ""] ?? "creatorSource.failed")
              : t("creatorSource.help")}
        {state.status === "done" && state.cached && ` ${t("creatorSource.cached")}`}
      </p>
    </div>
  );
}
