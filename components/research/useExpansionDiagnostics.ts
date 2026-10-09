"use client";

import { useCallback, useState } from "react";
import type { DiscoverAnswer, DiscoverPlatform } from "@/lib/discover";
import { discoverSourceDiagnostics, type DiscoverSourceDiagnostic } from "@/lib/discoverExpansion";

const EMPTY: DiscoverSourceDiagnostic[] = [];
const NO_QUOTAS: DiscoverPlatform[] = [];
const MAX_SCOPES = 24;
const PLATFORMS = ["ig", "tt", "yt"] as const;

/** Latest completed lookup per platform and category, not source verification or a new provider call. */
export function useExpansionDiagnostics(scope: string): {
  diagnostics: DiscoverSourceDiagnostic[];
  quotaPlatforms: DiscoverPlatform[];
  record: (answer: DiscoverAnswer, requestedPlatforms?: readonly DiscoverPlatform[]) => void;
  clear: () => void;
} {
  const [snapshots, setSnapshots] = useState<
    { scope: string; diagnostics: DiscoverSourceDiagnostic[]; quotaPlatforms: DiscoverPlatform[] }[]
  >([]);
  const record = useCallback(
    (answer: DiscoverAnswer, requestedPlatforms?: readonly DiscoverPlatform[]) => {
      const incoming = discoverSourceDiagnostics(answer, requestedPlatforms);
      setSnapshots((previous) => {
        const snapshot = previous.find((entry) => entry.scope === scope);
        const prior = snapshot?.diagnostics ?? [];
        const quota = new Set(snapshot?.quotaPlatforms ?? []);
        for (const diagnostic of incoming) {
          if (diagnostic.error === "quota") quota.add(diagnostic.platform);
          else if (
            !diagnostic.cached &&
            (diagnostic.state === "found" || diagnostic.state === "empty")
          )
            quota.delete(diagnostic.platform);
        }
        const quotaPlatforms = PLATFORMS.filter((platform) => quota.has(platform));
        const byPlatform = new Map(
          [...prior, ...incoming].map((diagnostic) => [diagnostic.platform, diagnostic]),
        );
        const diagnostics = PLATFORMS.flatMap((platform) => {
          const diagnostic = byPlatform.get(platform);
          return diagnostic ? [diagnostic] : [];
        });
        if (
          JSON.stringify(prior) === JSON.stringify(diagnostics) &&
          JSON.stringify(snapshot?.quotaPlatforms ?? []) === JSON.stringify(quotaPlatforms)
        )
          return previous;
        return [
          ...previous.filter((entry) => entry.scope !== scope),
          { scope, diagnostics, quotaPlatforms },
        ].slice(-MAX_SCOPES);
      });
    },
    [scope],
  );
  const clear = useCallback(() => {
    setSnapshots((previous) => {
      const current = previous.find((entry) => entry.scope === scope);
      if (!current?.diagnostics.length) return previous;
      // A transport failure says nothing about a previously exhausted provider budget.
      return current.quotaPlatforms.length
        ? previous.map((entry) => (entry === current ? { ...entry, diagnostics: EMPTY } : entry))
        : previous.filter((entry) => entry.scope !== scope);
    });
  }, [scope]);
  return {
    diagnostics: snapshots.find((entry) => entry.scope === scope)?.diagnostics ?? EMPTY,
    quotaPlatforms: snapshots.find((entry) => entry.scope === scope)?.quotaPlatforms ?? NO_QUOTAS,
    record,
    clear,
  };
}
