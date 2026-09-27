"use client";

import { useState, type ReactNode } from "react";
import type { RefPlatform } from "@/lib/domain";
import { useT } from "@/lib/i18n";
import type { ResearchItem } from "@/lib/research";

/** Platform glyph and label used on chips, tabs and placeholder tiles. */
export const PLATFORM_META: Record<RefPlatform, { glyph: string; label: string; chip: string }> = {
  yt: { glyph: "▶", label: "YouTube", chip: "bg-[#5a2029] text-[#ffb3aa]" },
  tt: { glyph: "♪", label: "TikTok", chip: "bg-[#173a4f] text-[#a9e0ff]" },
  ig: { glyph: "📷", label: "Instagram", chip: "bg-[#57331a] text-[#ffc996]" },
  web: { glyph: "📄", label: "Web", chip: "bg-panel-3 text-ink" },
};

/** TikTok / Instagram are vertical video platforms: 9:16 posters. YouTube and web links are 16:9. */
const isVertical = (p: RefPlatform) => p === "tt" || p === "ig";

/**
 * One research result (build plan 1.15), shared by Discover, the skill sheet's Research panel and the saved
 * references list. Full mode: a 16:9 media frame (YouTube fills it; TikTok / Instagram show a 9:16 poster
 * on a blurred copy of itself; a pixel tile with the platform glyph when there's no thumbnail or it stops
 * loading), platform chip, @handle, a two-line title, a two-line expandable snippet, the caller's action
 * and "open ↗". Compact mode: one row with a small thumbnail, title, handle and a ✕.
 */
export default function ResultCard({
  item,
  action,
  compact = false,
  onRemove,
}: {
  item: ResearchItem;
  action?: ReactNode;
  compact?: boolean;
  onRemove?: () => void;
}) {
  return compact ? (
    <CompactCard item={item} onRemove={onRemove} />
  ) : (
    <FullCard item={item} action={action} />
  );
}

function FullCard({ item, action }: { item: ResearchItem; action?: ReactNode }) {
  const { t } = useT();
  const [expanded, setExpanded] = useState(false);
  const meta = PLATFORM_META[item.platform];
  const longSnippet = item.snippet.length > 90;
  return (
    <li
      className="border-edge bg-panel-2 flex min-w-0 flex-col overflow-hidden rounded-[2px] border-2 shadow-[3px_3px_0_var(--edge)]"
      data-testid="result-card"
      data-platform={item.platform}
    >
      <a
        href={item.url}
        target="_blank"
        rel="noopener noreferrer"
        tabIndex={-1}
        aria-hidden
        className="border-edge relative block aspect-video overflow-hidden border-b-2 bg-[var(--edge)]"
      >
        <Media item={item} />
      </a>
      <div className="flex min-w-0 flex-1 flex-col gap-1 p-2.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className={`px-chip shrink-0 text-[10px] ${meta.chip}`} data-testid="result-chip">
            {meta.glyph} {meta.label}
          </span>
          <span className="text-muted min-w-0 flex-1 truncate text-xs" dir="ltr">
            {item.handle}
          </span>
        </div>
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          dir="auto"
          className="text-ink line-clamp-2 text-sm leading-snug font-bold no-underline hover:underline"
          data-testid="result-title"
        >
          {item.title}
        </a>
        {item.snippet && (
          <p
            dir="auto"
            className={`text-ink-2 text-xs ${expanded ? "" : "line-clamp-2"}`}
            data-testid="result-snippet"
          >
            {item.snippet}
          </p>
        )}
        {longSnippet && (
          <button
            type="button"
            className="text-sky w-fit text-xs font-semibold"
            aria-expanded={expanded}
            onClick={() => setExpanded((e) => !e)}
            data-testid="result-more"
          >
            {expanded ? t("research.showLess") : t("research.showMore")}
          </button>
        )}
        <div className="mt-auto flex flex-wrap items-center gap-2 pt-1.5">
          {action}
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="px-btn px-btn-ghost px-btn-sm ms-auto no-underline"
            data-testid="result-open"
          >
            {t("research.scoutOpen")}
          </a>
        </div>
      </div>
    </li>
  );
}

/** The 16:9 media frame of a full card. */
function Media({ item }: { item: ResearchItem }) {
  const { t } = useT();
  const [broken, setBroken] = useState<string | null>(null);
  const thumb = item.thumb && broken !== item.thumb ? item.thumb : undefined;
  const vertical = isVertical(item.platform);
  const glyph = PLATFORM_META[item.platform].glyph;

  if (!thumb) {
    return (
      <span
        className="px-tile absolute inset-0 grid place-items-center"
        data-testid="result-thumb-placeholder"
      >
        <span
          className={`border-edge bg-panel-3 grid place-items-center border-2 text-2xl shadow-[3px_3px_0_var(--edge)] ${vertical ? "aspect-[9/16] h-[82%]" : "h-14 w-14"}`}
        >
          {glyph}
        </span>
      </span>
    );
  }
  // External thumbnails; the static export has no image optimizer for them.
  /* eslint-disable @next/next/no-img-element */
  return vertical ? (
    <>
      <img
        src={thumb}
        alt=""
        aria-hidden
        loading="lazy"
        referrerPolicy="no-referrer"
        className="absolute inset-0 h-full w-full scale-110 object-cover opacity-45 blur-md"
      />
      <img
        src={thumb}
        alt={t("sheet.refThumbAlt")}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setBroken(thumb)}
        className="border-edge relative mx-auto block aspect-[9/16] h-full border-x-2 object-cover"
        data-testid="result-thumb"
      />
    </>
  ) : (
    <img
      src={thumb}
      alt={t("sheet.refThumbAlt")}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setBroken(thumb)}
      className="absolute inset-0 h-full w-full object-cover"
      data-testid="result-thumb"
    />
  );
  /* eslint-enable @next/next/no-img-element */
}

function CompactCard({ item, onRemove }: { item: ResearchItem; onRemove?: () => void }) {
  const { t } = useT();
  const [broken, setBroken] = useState<string | null>(null);
  const thumb = item.thumb && broken !== item.thumb ? item.thumb : undefined;
  const meta = PLATFORM_META[item.platform];
  const box = `border-edge h-12 shrink-0 overflow-hidden rounded-[2px] border-2 ${isVertical(item.platform) ? "aspect-[9/16]" : "aspect-video"}`;
  return (
    <li
      className="bg-panel flex min-w-0 items-center gap-2 rounded-[2px] p-1.5 text-sm"
      data-testid="saved-ref"
      data-platform={item.platform}
    >
      {thumb ? (
        // External thumbnail; static export has no image optimizer for it.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={thumb}
          alt={t("sheet.refThumbAlt")}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setBroken(thumb)}
          className={`${box} bg-[var(--panel-3)] object-cover`}
          data-testid="saved-ref-thumb"
        />
      ) : (
        <span aria-hidden className={`${box} px-tile grid place-items-center text-sm`}>
          {meta.glyph}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          dir="auto"
          className="px-link line-clamp-2 leading-snug"
        >
          {item.title}
        </a>
        <span className="text-muted flex min-w-0 items-center gap-1 text-xs">
          <span aria-hidden>{meta.glyph}</span>
          <span className="truncate" dir="ltr">
            {item.handle}
          </span>
        </span>
      </span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={t("sheet.refRemove")}
          className="px-btn px-btn-ghost px-btn-sm shrink-0"
          data-testid="saved-ref-remove"
        >
          ✕
        </button>
      )}
    </li>
  );
}

/** Loading placeholder in the card's shape (pixel shimmer; still under reduced motion). */
export function SkeletonCard({ vertical = false }: { vertical?: boolean }) {
  return (
    <li
      aria-hidden
      className="border-edge bg-panel-2 flex flex-col overflow-hidden rounded-[2px] border-2 shadow-[3px_3px_0_var(--edge)]"
      data-testid="result-skeleton"
    >
      <span className="border-edge px-skel relative grid aspect-video place-items-center border-b-2">
        {vertical && <span className="bg-panel-2 border-edge aspect-[9/16] h-[82%] border-2" />}
      </span>
      <span className="flex flex-col gap-2 p-2.5">
        <span className="px-skel h-3 w-1/3" />
        <span className="px-skel h-3.5 w-11/12" />
        <span className="px-skel h-3.5 w-2/3" />
        <span className="px-skel mt-1 h-7 w-1/2" />
      </span>
    </li>
  );
}
