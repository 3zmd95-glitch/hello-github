"use client";

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DiscoverItem } from "@/lib/discover";
import { applicableDiscoverVisual, canonicalDiscoverVisualUrl } from "@/lib/discoverVisual";
import {
  assessCategoryVisual,
  categoryVisualCandidates,
  categoryVisualCanContinue,
  CATEGORY_VISUAL_ASSESSMENTS,
  CATEGORY_VISUAL_ATTEMPTS,
} from "@/lib/discoverVisualClient";
import type { AiChoice, AiSelection } from "@/lib/localAi";
import { useStore } from "@/store";

type Progress = {
  scope: string;
  status: "running" | "done" | "cancelled" | "error";
  attempted: number;
  assessed: number;
  total: number;
  error?: string;
};

/** Only assess()/captureNextLookup() can start work. Effects cancel work; they never start it. */
export function useCategoryVisual({
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
  const [enabledFor, setEnabledFor] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress>();
  const feedback = useStore((state) => state.discoverFeedback);
  const candidates = useStore((state) => state.discoverCandidates);
  const epoch = useStore((state) => state.discoverLibraryEpoch);
  const libraryLoading = useStore((state) => state.discoverLibraryStatus === "loading");
  const applyResult = useStore((state) => state.applyDiscoverVisualResult);
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
      setEnabledFor(null);
      updateChoice(next);
    },
    [cancel],
  );
  const setOpen = (next: boolean) => {
    if (!next) {
      cancel();
      setEnabledFor(null);
    }
    updateOpen(next);
  };
  const afterLookup = enabledFor === scope && open;
  const setAfterLookup = (next: boolean) => {
    cancel();
    setEnabledFor(next ? scope : null);
  };
  const canAssess =
    active &&
    !libraryLoading &&
    choice.provider === "chatgpt" &&
    !!choice.model &&
    (platform === "all" || platform === "ig");
  const freshUrls = useMemo(
    () =>
      new Set(
        candidates
          .filter((candidate) => {
            if (candidate.genreId !== genreId) return false;
            const visual = applicableDiscoverVisual(candidate, candidate.item, now);
            return visual?.model === choice.model && visual.effort === choice.effort;
          })
          .map((candidate) => canonicalDiscoverVisualUrl(candidate.item.url)),
      ),
    [candidates, genreId, choice.model, choice.effort, now],
  );
  const eligible = useMemo(
    () =>
      categoryVisualCandidates(items, genreId, feedback, 100).filter(
        (item) => !freshUrls.has(canonicalDiscoverVisualUrl(item.url)),
      ),
    [items, genreId, feedback, freshUrls],
  );
  const run = async (cohort: readonly DiscoverItem[], expectedGeneration = generation.current) => {
    if (
      !canAssess ||
      pending.current ||
      expectedGeneration !== generation.current ||
      currentScope.current !== scope
    )
      return;
    const controller = new AbortController();
    pending.current = controller;
    const currentFreshUrls = new Set(
      useStore
        .getState()
        .discoverCandidates.filter((candidate) => {
          if (candidate.genreId !== genreId) return false;
          const visual = applicableDiscoverVisual(candidate, candidate.item);
          return visual?.model === choice.model && visual.effort === choice.effort;
        })
        .map((candidate) => canonicalDiscoverVisualUrl(candidate.item.url)),
    );
    const selected = categoryVisualCandidates(
      cohort.filter((item) => !currentFreshUrls.has(canonicalDiscoverVisualUrl(item.url))),
      genreId,
      useStore.getState().discoverFeedback,
    );
    const token = generation.current;
    const selection: AiSelection = { ...choice, provider: "chatgpt" };
    const isCurrent = () =>
      pending.current === controller &&
      !controller.signal.aborted &&
      token === generation.current &&
      currentScope.current === scope &&
      useStore.getState().discoverLibraryEpoch === epoch &&
      useStore.getState().discoverLibraryStatus !== "loading";
    let attempted = 0;
    let assessed = 0;
    let modelCalls = 0;
    let error: string | undefined;
    const publish = (status: Progress["status"]) =>
      setProgress({ scope, status, attempted, assessed, total: selected.length, error });
    publish("running");
    for (const item of selected.slice(0, CATEGORY_VISUAL_ATTEMPTS)) {
      if (
        !isCurrent() ||
        assessed >= CATEGORY_VISUAL_ASSESSMENTS ||
        modelCalls >= CATEGORY_VISUAL_ASSESSMENTS
      )
        break;
      attempted++;
      publish("running");
      const result = await assessCategoryVisual(
        { ...selection, provider: "chatgpt", url: item.url, genreId, lang, allowModel: true },
        controller.signal,
      );
      if (!isCurrent()) return;
      if (!result.ok) {
        error = result.error;
        break;
      }
      modelCalls += result.data.modelCalls;
      const applied = applyResult(result.data, {
        epoch,
        genreId,
        url: item.url,
        selection,
        isCurrent,
      });
      if (applied === "stale" || applied === "invalid") {
        error = "stale_result";
        break;
      }
      if (result.data.status === "assessed") assessed++;
      else if (!categoryVisualCanContinue(result.data.error) || result.data.modelCalls) {
        error = result.data.error;
        break;
      }
      publish("running");
    }
    if (!isCurrent()) return;
    pending.current = null;
    publish(error ? "error" : "done");
  };
  return {
    choice,
    setChoice,
    open,
    setOpen,
    afterLookup,
    setAfterLookup,
    canAssess,
    eligibleCount: eligible.length,
    progress: progress?.scope === scope ? progress : undefined,
    cancel,
    assess: () => run(items),
    captureNextLookup: () => {
      if (!afterLookup || !canAssess) return undefined;
      const token = generation.current;
      let consumed = false;
      return (cohort: readonly DiscoverItem[]) => {
        if (!consumed && token === generation.current && currentScope.current === scope) {
          consumed = true;
          setEnabledFor(null);
          void run(cohort, token);
        }
      };
    },
  };
}
export type CategoryVisualQueue = ReturnType<typeof useCategoryVisual>;
