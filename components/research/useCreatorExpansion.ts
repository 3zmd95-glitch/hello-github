"use client";

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DiscoverItem } from "@/lib/discover";
import { expandYoutubeCreator, youtubeCreatorSeed } from "@/lib/discoverCreator";
import { categoryCandidates, discoverPostKey, savedDiscoverInterests } from "@/lib/discoverFeed";
import type { DiscoverCandidate } from "@/lib/discoverFeed";
import { discoverEvidence, rankDiscoverItems, type DiscoverFeedMode } from "@/lib/discoverRanking";
import { getApiKey, useStore } from "@/store";

export interface CreatorSeedRow {
  item: DiscoverItem;
  genreId: string;
}
type Outcome = {
  id: number;
  scope: string;
  key: string;
  binding: string;
  author: string;
  library: string;
  status: "loading" | "done" | "error" | "cancelled";
  checked?: number;
  added?: number;
  qualified?: number;
  cached?: boolean;
  error?: string;
};
const rowKey = (row: CreatorSeedRow) =>
  JSON.stringify([row.genreId, discoverPostKey(row.item.platform, row.item.url)]);
function seedBinding(row: CreatorSeedRow): string | null {
  const seed = youtubeCreatorSeed(row.item);
  if (!seed) return null;
  return JSON.stringify([
    row.genreId,
    seed.url,
    seed.channelId,
    seed.author,
    row.item.evidence?.caption,
    row.item.evidence?.availability,
  ]);
}
/** For You may display a newer source shared from another category. Bind to the whole source snapshot,
 * while requiring that the seed still belongs to the action's category. Counts alone are not identity. */
function libraryBinding(key: string, candidates: readonly DiscoverCandidate[]): string | null {
  const [genreId, url] = JSON.parse(key) as [string, string];
  const copies = candidates.filter(
    (candidate) => discoverPostKey(candidate.item.platform, candidate.item.url) === url,
  );
  if (!copies.some((candidate) => candidate.genreId === genreId)) return null;
  return JSON.stringify(copies.map((candidate) => seedBinding(candidate)).sort());
}

/** Only the explicit run action fetches uploads. Effects invalidate pending work, never start it. */
export function useCreatorExpansion({
  rows,
  active,
  context,
  mode,
  lang,
}: {
  rows: readonly CreatorSeedRow[];
  active: boolean;
  context: string;
  mode: DiscoverFeedMode;
  lang: "ar" | "en";
}) {
  const apiKey = useStore((state) => getApiKey(state, "youtube"));
  const epoch = useStore((state) => state.discoverLibraryEpoch);
  const loading = useStore((state) => state.discoverLibraryStatus === "loading");
  const candidates = useStore((state) => state.discoverCandidates);
  const [outcome, setOutcome] = useState<Outcome>();
  const scope = JSON.stringify([active, context, mode, lang, apiKey, epoch, loading]);
  const bindings = useMemo(
    () => new Map(rows.map((row) => [rowKey(row), seedBinding(row)])),
    [rows],
  );
  const current = useRef({ scope, bindings });
  const sequence = useRef(0);
  const pending = useRef<{
    id: number;
    controller: AbortController;
    scope: string;
    key: string;
    binding: string;
    library: string;
  } | null>(null);
  const invalidate = useCallback(() => {
    pending.current?.controller.abort();
    pending.current = null;
  }, []);
  useLayoutEffect(() => {
    current.current = { scope, bindings };
    const request = pending.current;
    if (
      request &&
      (request.scope !== scope ||
        (bindings.has(request.key) && bindings.get(request.key) !== request.binding) ||
        libraryBinding(request.key, candidates) !== request.library)
    )
      invalidate();
  }, [scope, bindings, candidates, invalidate]);
  useLayoutEffect(() => invalidate, [invalidate]);

  const eligible = (row: CreatorSeedRow) => {
    if (!active || !apiKey || loading || !seedBinding(row)) return false;
    const evidence = discoverEvidence(row.item, row.genreId);
    return evidence.eligible && (evidence.engagement.strong || evidence.teaching);
  };
  const run = async (row: CreatorSeedRow) => {
    if (!eligible(row) || pending.current) return;
    const key = rowKey(row);
    const binding = seedBinding(row)!;
    const author = youtubeCreatorSeed(row.item)!.author;
    const library = libraryBinding(key, useStore.getState().discoverCandidates);
    if (!library) return;
    if (current.current.scope !== scope || current.current.bindings.get(key) !== binding) return;
    const id = ++sequence.current;
    const request = { id, controller: new AbortController(), scope, key, binding, library };
    pending.current = request;
    setOutcome({ id, scope, key, binding, author, library, status: "loading" });
    const isCurrent = () => {
      const state = useStore.getState();
      return (
        pending.current === request &&
        !request.controller.signal.aborted &&
        current.current.scope === scope &&
        (!current.current.bindings.has(key) || current.current.bindings.get(key) === binding) &&
        state.discoverLibraryEpoch === epoch &&
        state.discoverLibraryStatus !== "loading" &&
        getApiKey(state, "youtube") === apiKey &&
        libraryBinding(key, state.discoverCandidates) === library
      );
    };
    try {
      const result = await expandYoutubeCreator(row.item, apiKey, {
        signal: request.controller.signal,
        lang,
      });
      if (!isCurrent()) return;
      if (!result.ok) {
        setOutcome({
          id,
          scope,
          key,
          binding,
          author,
          library,
          status: "error",
          error: result.error,
        });
        return;
      }
      const before = new Set(
        categoryCandidates(useStore.getState().discoverCandidates, row.genreId).map((item) =>
          discoverPostKey(item.platform, item.url),
        ),
      );
      // No async gap between the guards and the source-aware store merge.
      useStore.getState().accumulateDiscoverCandidates(result.items, { genreId: row.genreId });
      const state = useStore.getState();
      const returned = new Set(
        result.items.map((item) => discoverPostKey(item.platform, item.url)),
      );
      const added = categoryCandidates(state.discoverCandidates, row.genreId).filter((item) => {
        const url = discoverPostKey(item.platform, item.url);
        return returned.has(url) && !before.has(url);
      });
      const qualified = rankDiscoverItems(added, {
        genreId: row.genreId,
        mode,
        feedback: state.discoverFeedback,
        savedInterests: savedDiscoverInterests(state.inspirations),
      }).items.length;
      setOutcome({
        id,
        scope,
        key,
        binding,
        author,
        library,
        status: "done",
        checked: result.examined,
        added: added.length,
        qualified,
        cached: result.cached,
      });
    } catch {
      if (isCurrent())
        setOutcome({ id, scope, key, binding, author, library, status: "error", error: "network" });
    } finally {
      if (pending.current === request) pending.current = null;
      setOutcome((value) =>
        value?.id === id && value.status === "loading" ? { ...value, status: "cancelled" } : value,
      );
    }
  };
  const visibleOutcome =
    outcome?.scope === scope &&
    (outcome.status !== "loading" ||
      ((!bindings.has(outcome.key) || bindings.get(outcome.key) === outcome.binding) &&
        libraryBinding(outcome.key, candidates) === outcome.library))
      ? outcome
      : undefined;
  return {
    eligible,
    run,
    busy: visibleOutcome?.status === "loading",
    outcome: visibleOutcome,
    forItem: (row: CreatorSeedRow) =>
      visibleOutcome?.key === rowKey(row) ? visibleOutcome : undefined,
    cancel: () => {
      invalidate();
      setOutcome((value) => value && { ...value, status: "cancelled" });
    },
  };
}
export type CreatorExpansionQueue = ReturnType<typeof useCreatorExpansion>;
