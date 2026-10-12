"use client";

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DiscoverItem } from "@/lib/discover";
import { applicableDiscoverSemantic, canonicalDiscoverSemanticUrl } from "@/lib/discoverSemantic";
import {
  assessCategorySemantic,
  categorySemanticCandidates,
  CATEGORY_SEMANTIC_BATCH,
} from "@/lib/discoverSemanticClient";
import type { AiChoice, AiSelection } from "@/lib/localAi";
import { useStore } from "@/store";
import { CATEGORY_PROFILES } from "@/workers/scout/src/discover/category-profiles";

type Progress = {
  scope: string;
  status: "running" | "done" | "cancelled" | "error";
  assessed: number;
  total: number;
  error?: string;
};

/** Effects only invalidate work. Every batch requires one fresh, explicit assess() action. */
export function useCategorySemantic({
  items,
  genreId,
  active,
  lang,
  platform,
  now,
}: {
  items: readonly DiscoverItem[];
  genreId: string;
  active: boolean;
  lang: "ar" | "en";
  platform: string;
  now: number;
}) {
  const [choice, updateChoice] = useState<AiChoice>({ provider: "chatgpt", model: "" });
  const [open, updateOpen] = useState(false);
  const [progress, setProgress] = useState<Progress>();
  const candidates = useStore((state) => state.discoverCandidates);
  const feedback = useStore((state) => state.discoverFeedback);
  const epoch = useStore((state) => state.discoverLibraryEpoch);
  const libraryLoading = useStore((state) => state.discoverLibraryStatus === "loading");
  const applyResult = useStore((state) => state.applyDiscoverSemanticResult);
  const pending = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const scope = JSON.stringify([active, genreId, lang, platform, epoch, libraryLoading, choice]);
  const currentScope = useRef(scope);
  const invalidate = useCallback(() => {
    generation.current++;
    pending.current?.abort();
    pending.current = null;
  }, []);
  const cancel = useCallback(() => {
    const controller = pending.current;
    invalidate();
    if (controller) setProgress((value) => value && { ...value, status: "cancelled" });
  }, [invalidate]);
  useLayoutEffect(() => {
    currentScope.current = scope;
    return invalidate;
  }, [scope, invalidate]);
  const setChoice = useCallback(
    (next: AiChoice) => {
      cancel();
      updateChoice(next);
    },
    [cancel],
  );
  const setOpen = (next: boolean) => {
    if (!next) cancel();
    updateOpen(next);
  };
  const canAssess =
    active &&
    !libraryLoading &&
    Object.hasOwn(CATEGORY_PROFILES, genreId) &&
    choice.provider === "chatgpt" &&
    !!choice.model &&
    (platform === "all" || platform === "ig" || platform === "tt");
  const eligible = useMemo(() => {
    const records = candidates.filter((candidate) => candidate.genreId === genreId);
    return categorySemanticCandidates(
      [...records.map((candidate) => candidate.item), ...items],
      genreId,
      feedback,
      platform,
      100,
      now,
    ).filter(
      (item) =>
        !records.some((candidate) => {
          const semantic = applicableDiscoverSemantic(candidate, item, now);
          return semantic?.model === choice.model && semantic.effort === choice.effort;
        }),
    );
  }, [candidates, items, genreId, feedback, platform, now, choice.model, choice.effort]);
  const assess = async () => {
    if (!canAssess || !open || pending.current || currentScope.current !== scope) return;
    const state = useStore.getState();
    const records = state.discoverCandidates.filter((candidate) => candidate.genreId === genreId);
    const selected = categorySemanticCandidates(
      [...records.map((candidate) => candidate.item), ...items],
      genreId,
      state.discoverFeedback,
      platform,
      100,
    )
      .filter(
        (item) =>
          !records.some((candidate) => {
            const semantic = applicableDiscoverSemantic(candidate, item);
            return semantic?.model === choice.model && semantic.effort === choice.effort;
          }),
      )
      .slice(0, CATEGORY_SEMANTIC_BATCH);
    if (!selected.length) return;
    const controller = new AbortController();
    pending.current = controller;
    const token = generation.current;
    const selection: AiSelection = { ...choice, provider: "chatgpt" };
    const urls = selected.map((item) => canonicalDiscoverSemanticUrl(item.url)!);
    const isCurrent = () =>
      pending.current === controller &&
      !controller.signal.aborted &&
      generation.current === token &&
      currentScope.current === scope &&
      useStore.getState().discoverLibraryEpoch === epoch &&
      useStore.getState().discoverLibraryStatus !== "loading";
    setProgress({ scope, status: "running", total: selected.length, assessed: 0 });
    const result = await assessCategorySemantic(
      { ...selection, provider: "chatgpt", urls, genreId, lang },
      controller.signal,
    );
    if (!isCurrent()) return;
    let error: string | undefined;
    let assessed = 0;
    if (!result.ok) error = result.error;
    else {
      const applied = applyResult(result.data, { epoch, genreId, urls, selection, isCurrent });
      if (applied === "stale" || applied === "invalid") error = "stale_result";
      else if (result.data.status === "unavailable") error = result.data.error;
      else assessed = result.data.semantics.length;
    }
    if (!isCurrent()) return;
    pending.current = null;
    setProgress({
      scope,
      status: error ? "error" : "done",
      total: selected.length,
      assessed,
      error,
    });
  };
  return {
    choice,
    setChoice,
    open,
    setOpen,
    canAssess,
    eligibleCount: eligible.length,
    batchPreview: eligible.slice(0, CATEGORY_SEMANTIC_BATCH),
    progress: progress?.scope === scope ? progress : undefined,
    cancel,
    assess,
  };
}
export type CategorySemanticQueue = ReturnType<typeof useCategorySemantic>;
