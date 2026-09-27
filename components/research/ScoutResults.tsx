"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { Lang } from "@/lib/domain";
import { useT } from "@/lib/i18n";
import { SCOUT_MONTHLY_FREE, scoutErrorMessageKey, type ScoutResult } from "@/lib/scoutClient";
import { useScoutConfig, useScoutSearch, useScoutUsage } from "./useScout";

const GROUPS = [
  { platform: "tt", icon: "🎵", label: "TikTok" },
  { platform: "ig", icon: "📸", label: "Instagram" },
] as const;

/**
 * TikTok · Instagram results from the Scout Worker (build plan 1.14), grouped by platform: thumbnail when
 * there is one, platform chip, handle, title, a two-line snippet, an "open" link and a caller-supplied
 * action (add as reference / attach to a skill). A one-line Settings hint when the Worker isn't set up.
 */
export default function ScoutResults({
  query,
  lang,
  renderAction,
}: {
  query: string;
  lang: Lang;
  renderAction: (result: ScoutResult) => ReactNode;
}) {
  const { t } = useT();
  const config = useScoutConfig();
  const state = useScoutSearch(query, lang);
  const usage = useScoutUsage();

  if (!config) {
    return (
      <p className="text-ink-2 text-sm" data-testid="scout-not-configured">
        {t("research.scoutNotConfigured")}{" "}
        <Link href="/settings/" className="px-link">
          {t("research.noKeyLink")}
        </Link>
      </p>
    );
  }

  const usageLine = (
    <p className="text-muted text-xs" data-testid="scout-usage" data-count={usage}>
      {t("research.scoutUsage", { n: usage, max: SCOUT_MONTHLY_FREE })}
    </p>
  );

  if (state.status === "off") return usageLine;
  if (state.status === "loading") {
    return (
      <div className="flex flex-col gap-1">
        <p className="text-muted text-sm" data-testid="scout-loading">
          {t("research.scoutLoading")}
        </p>
        {usageLine}
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="flex flex-col gap-1">
        <p
          className="text-danger text-sm"
          role="alert"
          data-testid="scout-error"
          data-error={state.error.type}
        >
          {t(scoutErrorMessageKey(state.error))}
        </p>
        {usageLine}
      </div>
    );
  }

  const groups = GROUPS.map((g) => ({
    ...g,
    items: state.results.filter((r) => r.platform === g.platform),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="flex flex-col gap-3" data-testid="scout-results">
      {usageLine}
      {groups.length === 0 && (
        <p className="text-muted text-sm" data-testid="scout-empty">
          {t("research.scoutEmpty")}
        </p>
      )}
      {groups.map((g) => (
        <div
          key={g.platform}
          className="flex flex-col gap-2"
          data-testid={`scout-group-${g.platform}`}
        >
          <h5 className="text-ink-2 text-xs font-bold">
            {g.icon} {g.label}
          </h5>
          <ul className="flex flex-col gap-2">
            {g.items.map((r) => (
              <ScoutCard key={r.url} result={r} action={renderAction(r)} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function ScoutCard({ result: r, action }: { result: ScoutResult; action: ReactNode }) {
  const { t } = useT();
  const chip = r.platform === "tt" ? "TikTok" : r.platform === "ig" ? "Instagram" : "YouTube";
  return (
    <li className="px-inset flex gap-2" data-testid="scout-result" data-platform={r.platform}>
      {r.thumb ? (
        // External thumbnail; static export has no image optimizer for it.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={r.thumb}
          alt=""
          width={54}
          height={72}
          loading="lazy"
          referrerPolicy="no-referrer"
          className="h-[72px] w-[54px] shrink-0 rounded-[2px] bg-[var(--panel-3)] object-cover"
        />
      ) : (
        <span
          aria-hidden
          className="grid h-[72px] w-[54px] shrink-0 place-items-center rounded-[2px] bg-[var(--panel-3)] text-xl"
        >
          {r.platform === "tt" ? "🎵" : r.platform === "ig" ? "📸" : "▶️"}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="px-chip shrink-0 text-[10px]" data-testid="scout-chip">
            {chip}
          </span>
          <span className="text-muted min-w-0 flex-1 truncate text-xs" dir="ltr">
            {r.handle}
          </span>
          <a
            href={r.url}
            target="_blank"
            rel="noopener noreferrer"
            className="px-link shrink-0 text-xs"
            data-testid="scout-open"
          >
            {t("research.scoutOpen")}
          </a>
        </div>
        <a
          href={r.url}
          target="_blank"
          rel="noopener noreferrer"
          dir="auto"
          className="px-link mt-0.5 line-clamp-2 text-sm font-bold"
          data-testid="scout-result-title"
        >
          {r.title}
        </a>
        {r.snippet && (
          <p dir="auto" className="text-ink-2 line-clamp-2 text-xs">
            {r.snippet}
          </p>
        )}
        {action}
      </div>
    </li>
  );
}
