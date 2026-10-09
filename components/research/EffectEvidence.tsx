"use client";

import type { TrendingEffect } from "@/lib/effects";
import { useT } from "@/lib/i18n";

/** Source captions establish mentions, not a judgement about the edit or its popularity. */
export default function EffectEvidence({ effect }: { effect: TrendingEffect }) {
  const { t } = useT();
  if (!effect.samples?.length) return null;
  return (
    <details className="text-muted max-w-64 text-xs" data-testid="effect-evidence">
      <summary className="px-link cursor-pointer">{t("search.effectsSources")}</summary>
      <ul className="mt-1 flex flex-col gap-2">
        {effect.samples.map((sample) => (
          <li key={sample.url} className="flex flex-col gap-0.5">
            <a
              href={sample.url}
              target="_blank"
              rel="noopener noreferrer"
              className="px-link break-words"
              dir="auto"
            >
              {sample.title || effect.name.en} ↗
            </a>
            <time dateTime={sample.published} dir="ltr">
              {sample.published.slice(0, 10)}
            </time>
          </li>
        ))}
      </ul>
    </details>
  );
}
