"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useVideoPlayer, type PlayableItem } from "@/components/player/VideoPlayerContext";
import type { RefPlatform } from "@/lib/domain";
import { canEmbed } from "@/lib/embed";
import { useT } from "@/lib/i18n";
import { compactCount, headlineStat, type ResearchItem } from "@/lib/research";
import { scoutOembed, type ScoutConfig, type Stats } from "@/lib/scoutClient";
import { useScoutConfig } from "./useScout";

/** Platform glyph and label used on chips, tabs and placeholder tiles. */
export const PLATFORM_META: Record<RefPlatform, { glyph: string; label: string; chip: string }> = {
  yt: { glyph: "▶", label: "YouTube", chip: "bg-[#5a2029] text-[#ffb3aa]" },
  tt: { glyph: "♪", label: "TikTok", chip: "bg-[#173a4f] text-[#a9e0ff]" },
  ig: { glyph: "📷", label: "Instagram", chip: "bg-[#57331a] text-[#ffc996]" },
  web: { glyph: "📄", label: "Web", chip: "bg-panel-3 text-ink" },
};

/** TikTok / Instagram are vertical video platforms: 9:16 posters. YouTube and web links are 16:9. */
const isVertical = (p: RefPlatform) => p === "tt" || p === "ig";

/** A fresh post preview from the Worker, with a caption when the provider supplies one. */
interface FreshPost {
  thumb?: string;
  title?: string;
}

/**
 * Refresh missing or expired TikTok / Instagram previews once per post and Scout configuration per session,
 * shared by every card showing it. TikTok also supplies captions for cards titled only by their handle.
 */
const freshPosts = new Map<string, Promise<FreshPost>>();
function freshPost(config: ScoutConfig, url: string): Promise<FreshPost> {
  const key = `${config.url}|${config.token}|${url}`;
  let p = freshPosts.get(key);
  if (!p) {
    p = scoutOembed(config, url).then((r) =>
      r.ok ? { thumb: r.data.thumb || undefined, title: r.data.title || undefined } : {},
    );
    freshPosts.set(key, p);
  }
  return p;
}

/**
 * The thumbnail, error handler, and title to show. Missing or expired TikTok / Instagram images get one
 * cached Worker lookup (display only; the saved reference keeps its URL). Unavailable previews keep the tile.
 */
function useThumb(item: ResearchItem): { thumb?: string; title: string; onError: () => void } {
  const config = useScoutConfig();
  const [failed, setFailed] = useState<readonly string[]>([]);
  const [fresh, setFresh] = useState<(FreshPost & { url: string }) | null>(null);
  const mine = fresh?.url === item.url ? fresh : undefined;
  const renewed = mine?.thumb;
  const thumb = [renewed, item.thumb].find((s): s is string => !!s && !failed.includes(s));
  // The Worker titles a TikTok card whose page title says nothing ("TikTok - Make Your Day") with its handle.
  const generic = item.platform === "tt" && item.title === item.handle;
  const title = (generic && mine?.title) || item.title;
  const onError = () => {
    if (!thumb) return;
    setFailed((f) => [...f, thumb]);
    if (
      !["tt", "ig"].includes(item.platform) ||
      !canEmbed(item.platform, item.url) ||
      !config ||
      renewed
    )
      return;
    const url = item.url;
    void freshPost(config, url).then((f) => {
      if (f.thumb && f.thumb !== thumb) setFresh({ url, ...f });
    });
  };
  // Fetch missing post previews outside the search request. Keep a provider picture until it fails to load.
  useEffect(() => {
    if (
      !["tt", "ig"].includes(item.platform) ||
      !canEmbed(item.platform, item.url) ||
      (item.thumb && !generic) ||
      !config
    )
      return;
    let alive = true;
    const url = item.url;
    const own = !!item.thumb;
    void freshPost(config, url).then((f) => {
      if (alive) setFresh({ url, title: f.title, ...(own ? {} : { thumb: f.thumb }) });
    });
    return () => {
      alive = false;
    };
  }, [config, generic, item.platform, item.thumb, item.url]);
  return { thumb, title, onError };
}

/**
 * ▶ Watch here (round 32): the tap on a card's ▶ (the full card's poster, the compact row's own button), or
 * undefined when the reference has no player here (a `web` link, a profile, anything that is not one post;
 * lib/embed `canEmbed`). It hands the player the picture the card shows right now (for TikTok, maybe the
 * fresh copy) and the handle when the card has one. Nothing loads from the platform until the tap: the
 * picture is the card's own.
 */
function usePlay(item: ResearchItem, thumb: string | undefined): (() => void) | undefined {
  const player = useVideoPlayer();
  if (!canEmbed(item.platform, item.url)) return undefined;
  const playable: PlayableItem = {
    platform: item.platform,
    url: item.url,
    title: item.title,
    ...(item.handle ? { handle: item.handle } : {}),
    ...(thumb ? { thumb } : {}),
  };
  return () => player.open(playable);
}

/**
 * One research result (build plan 1.15), shared by Discover, the skill sheet's Research panel and the saved
 * references list. Full mode: a 16:9 media frame (YouTube fills it; TikTok / Instagram show a 9:16 poster
 * on a blurred copy of itself; a pixel tile with the platform glyph when there's no thumbnail or it stops
 * loading), platform chip, @handle, the views or likes when the source gave them, a two-line title, a
 * two-line expandable snippet, the caller's action and "open ↗". Compact mode: one row with a small
 * thumbnail, title, handle and a ✕ (saved references keep no counts). A full card outside the result list
 * (the "Most viewed this week" strip) takes its own test id and its width from the caller.
 *
 * ▶ Watch here (round 32): when the reference is one post of YouTube, TikTok or Instagram, the full card's
 * media frame is a ▶ button that opens the app's player sheet on it (otherwise it stays the link it always
 * was), and the compact row gets a small ▶ button of its own before the ✕ (its thumbnail stays a picture);
 * the title link and "open ↗" still open the platform.
 */
export default function ResultCard({
  item,
  action,
  compact = false,
  onRemove,
  testId = "result-card",
  className = "min-w-0",
}: {
  item: ResearchItem;
  action?: ReactNode;
  compact?: boolean;
  onRemove?: () => void;
  /** Full mode: the card's `data-testid` (a result of the search by default). */
  testId?: string;
  /** Full mode: how the card sits in its list (it may shrink with its grid cell by default). */
  className?: string;
}) {
  return compact ? (
    <CompactCard item={item} onRemove={onRemove} />
  ) : (
    <FullCard item={item} action={action} testId={testId} className={className} />
  );
}

/** The full card's 16:9 media frame, the same box whether it is the ▶ button or the link. */
const MEDIA_FRAME =
  "border-edge relative block aspect-video overflow-hidden border-b-2 bg-[var(--edge)]";

/**
 * The card is `relative`: it holds its own absolutely placed bits (the screen-reader words of the counts).
 * Without it their box is the page's, so in a row that scrolls sideways the cards scrolled out of view
 * pushed the page wider (to the left in Arabic) instead of staying inside the row.
 */
function FullCard({
  item,
  action,
  testId,
  className,
}: {
  item: ResearchItem;
  action?: ReactNode;
  testId: string;
  className: string;
}) {
  const { t } = useT();
  const [expanded, setExpanded] = useState(false);
  const { thumb, title, onError } = useThumb(item);
  const play = usePlay({ ...item, title }, thumb);
  const meta = PLATFORM_META[item.platform];
  const longSnippet = item.snippet.length > 90;
  const media = <Media item={item} thumb={thumb} onError={onError} playable={!!play} />;
  return (
    <li
      className={`border-edge bg-panel-2 relative flex flex-col overflow-hidden rounded-[2px] border-2 shadow-[3px_3px_0_var(--edge)] ${className}`}
      data-testid={testId}
      data-platform={item.platform}
    >
      {play ? (
        <button
          type="button"
          onClick={play}
          aria-label={t("player.watchLabel", { title })}
          className={`${MEDIA_FRAME} group w-full focus-visible:outline-hidden`}
          data-testid="result-play"
        >
          {/* A button lays its content out in a box of its own; this one is the frame's size. */}
          <span className="absolute inset-0">{media}</span>
          {/* The focus ring: the card clips its own edges and the picture covers the button's outline, so
              it is drawn inside the frame, on top. */}
          <span
            aria-hidden
            className="group-focus-visible:outline-gold pointer-events-none absolute inset-0 group-focus-visible:outline-[3px] group-focus-visible:outline-offset-[-5px]"
          />
        </button>
      ) : (
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          tabIndex={-1}
          aria-hidden
          className={MEDIA_FRAME}
        >
          {media}
        </a>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1 p-2.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className={`px-chip shrink-0 text-[10px] ${meta.chip}`} data-testid="result-chip">
            {meta.glyph} {meta.label}
          </span>
          <span className="text-muted min-w-0 flex-1 truncate text-xs" dir="ltr">
            {item.handle}
          </span>
          {item.stats && <StatsChip stats={item.stats} />}
        </div>
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          dir="auto"
          className="text-ink line-clamp-2 text-sm leading-snug font-bold no-underline hover:underline"
          data-testid="result-title"
        >
          {title}
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

/**
 * How far the post went, the short way: "👁 1.2M" (views) when known, else "❤️ 45K" (likes). The raw counts
 * ride along as data attributes; screen readers get the sentence ("1.2M views").
 */
function StatsChip({ stats }: { stats: Stats }) {
  const { t, lang } = useT();
  const stat = headlineStat(stats);
  if (!stat) return null;
  const n = compactCount(stat.value, lang);
  const label = t(stat.kind === "views" ? "research.views" : "research.likes", { n });
  return (
    <span
      className="px-chip shrink-0 text-[10px]"
      title={label}
      data-testid="result-stats"
      data-kind={stat.kind}
      data-views={stats.views}
      data-likes={stats.likes}
    >
      <span aria-hidden>
        {stat.kind === "views" ? "👁" : "❤️"} {n}
      </span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

/**
 * What fills a full card's 16:9 media frame. On a card that plays here it sits in the ▶ button and gets the
 * ▶ badge; an Instagram post without a picture gets its own poster instead, with the ▶ drawn in.
 */
function Media({
  item,
  thumb,
  onError,
  playable,
}: {
  item: ResearchItem;
  thumb?: string;
  onError: () => void;
  playable: boolean;
}) {
  const { t } = useT();
  const vertical = isVertical(item.platform);
  const glyph = PLATFORM_META[item.platform].glyph;
  const badge = playable && <PlayBadge />;

  if (!thumb && playable && item.platform === "ig") return <InstagramPoster item={item} />;
  if (!thumb) {
    return (
      <>
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
        {badge}
      </>
    );
  }
  // External thumbnails; the static export has no image optimizer for them.
  /* eslint-disable @next/next/no-img-element */
  return (
    <>
      {vertical ? (
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
            onError={onError}
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
          onError={onError}
          className="absolute inset-0 h-full w-full object-cover"
          data-testid="result-thumb"
        />
      )}
      {badge}
    </>
  );
  /* eslint-enable @next/next/no-img-element */
}

/**
 * The ▶ on a full card's poster that plays here: our own mark on our own picture (the video itself plays in
 * the player sheet, where nothing of ours covers it). It sinks into its shadow when its button is pressed,
 * like the app's pixel buttons.
 */
function PlayBadge() {
  return (
    <span
      aria-hidden
      className="border-edge bg-accent text-accent-ink pointer-events-none absolute end-2 bottom-2 grid h-9 w-9 place-items-center border-2 text-sm leading-none shadow-[2px_2px_0_var(--edge)] group-active:translate-x-0.5 group-active:translate-y-0.5 group-active:shadow-none"
      data-testid="result-play-badge"
    >
      ▶
    </span>
  );
}

/**
 * Fallback while a public preview loads or when Instagram withholds it. Draw the app's own 9:16 poster
 * with the handle and caption so private, removed, and blocked posts remain usable.
 * Only for a post that plays here: "tap to watch" has to be true.
 */
function InstagramPoster({ item }: { item: ResearchItem }) {
  const { t } = useT();
  const handle = item.handle.trim();
  const at = handle.startsWith("@") ? handle : undefined;
  const caption = item.title.trim().split("\n")[0].trim();
  // A reference saved without a title carries its handle or its link as the title: nothing to add.
  const showCaption = caption !== "" && caption !== handle && caption !== item.url;
  return (
    <span
      className="px-tile absolute inset-0 grid place-items-center"
      data-testid="result-thumb-placeholder"
      data-poster="ig"
    >
      <span className="border-edge @container flex aspect-[9/16] h-full min-w-0 flex-col items-center gap-1 overflow-hidden border-x-2 bg-[#57331a] p-1.5 text-center text-[#ffc996]">
        <span className="flex min-h-0 w-full flex-1 flex-col items-center justify-center gap-1 overflow-hidden">
          <span
            aria-hidden
            className="border-edge grid h-7 w-7 shrink-0 place-items-center border-2 bg-[#ffc996] text-xs leading-none text-[#57331a] shadow-[2px_2px_0_var(--edge)] @max-[72px]:h-5 @max-[72px]:w-5 @max-[72px]:text-[9px]"
          >
            ▶
          </span>
          {at && (
            <span
              dir="ltr"
              className="w-full shrink-0 truncate text-[9px] leading-tight font-bold"
              data-testid="result-poster-handle"
            >
              {at}
            </span>
          )}
          {showCaption && (
            <span
              dir="auto"
              className="text-ink line-clamp-3 min-h-0 w-full text-[10px] leading-tight font-bold @max-[72px]:line-clamp-2 @max-[60px]:line-clamp-1"
              data-testid="result-poster-caption"
            >
              {caption}
            </span>
          )}
        </span>
        <span
          className="w-full shrink-0 text-[9px] leading-tight opacity-80"
          data-testid="result-poster-note"
        >
          {t("player.igNoPreview")}
        </span>
      </span>
    </span>
  );
}

/**
 * A saved reference's row. The thumbnail stays a plain picture: YouTube asks that a thumbnail which starts
 * playback be at least 120x70, and this one is 48 px tall (85x48 at most). So a reference that plays here
 * gets its own small ▶ button before the ✕, the ✕'s size so the row does not grow (the player gives focus
 * back to it on close), and the title link still opens the platform.
 */
function CompactCard({ item, onRemove }: { item: ResearchItem; onRemove?: () => void }) {
  const { t } = useT();
  const { thumb, title, onError } = useThumb(item);
  const play = usePlay({ ...item, title }, thumb);
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
          onError={onError}
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
          {title}
        </a>
        <span className="text-muted flex min-w-0 items-center gap-1 text-xs">
          <span aria-hidden>{meta.glyph}</span>
          <span className="truncate" dir="ltr">
            {item.handle}
          </span>
        </span>
      </span>
      {play && (
        <button
          type="button"
          onClick={play}
          aria-label={t("player.watchLabel", { title })}
          className="px-btn px-btn-ghost px-btn-sm shrink-0"
          data-testid="result-play"
        >
          ▶
        </button>
      )}
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
