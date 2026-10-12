"use client";

import { useEffect, useMemo, useState } from "react";
import type { DiscoverAnswer } from "@/lib/discover";
import { formatItemMatches, formatVisualEvidence, type EditFormat } from "@/lib/editFormats";
import { localInstagramSource, sourceKey, type FormatSources } from "@/lib/formatSources";

/** At most six existing search leads, two public reads at a time. No inference or search credits. */
export function useFormatSources(
  answer: DiscoverAnswer | null,
  format: EditFormat | undefined,
  intent: "examples" | "tutorials" | undefined,
) {
  const urls = useMemo(
    () =>
      answer && format && intent
        ? [
            ...new Set(
              answer.items
                .filter(
                  (item) =>
                    item.platform === "ig" &&
                    (formatItemMatches(item, format, intent) ||
                      formatVisualEvidence(`${item.title} ${item.snippet}`, format, intent)),
                )
                .sort(
                  (a, b) =>
                    Number(formatItemMatches(b, format, intent)) -
                    Number(formatItemMatches(a, format, intent)),
                )
                .map((item) => sourceKey(item.url)),
            ),
          ].slice(0, 6)
        : [],
    [answer, format, intent],
  );
  const scope = JSON.stringify(urls);
  const [result, setResult] = useState<{ scope: string; sources: FormatSources }>({
    scope: "",
    sources: {},
  });
  useEffect(() => {
    const controller = new AbortController();
    const sources: FormatSources = {};
    let cursor = 0;
    const next = async () => {
      while (cursor < urls.length && !controller.signal.aborted) {
        const url = urls[cursor++];
        const source = await localInstagramSource(url, controller.signal);
        if (controller.signal.aborted) return;
        sources[url] = source;
        setResult({ scope, sources: { ...sources } });
      }
    };
    void Promise.all([next(), next()]);
    return () => controller.abort();
  }, [scope, urls]);
  const sources = result.scope === scope ? result.sources : {};
  return { sources, checking: urls.some((url) => !(url in sources)) };
}
