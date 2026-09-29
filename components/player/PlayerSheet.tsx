"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { PLATFORM_META } from "@/components/research/ResultCard";
import {
  EMBED_FRAME,
  EMBED_ORIGIN,
  TIKTOK_UNMUTE,
  embedTarget,
  isFromPlayer,
  openHref,
  precheckEmbed,
  precheckUrl,
  readPlayerMessage,
  type EmbedPlatform,
  type EmbedTarget,
} from "@/lib/embed";
import { useT, type MessageKey } from "@/lib/i18n";
import type { PlayableItem } from "./VideoPlayerContext";

/** YouTube's frame is not scripted: when it has not loaded after this long, a line under it says so. */
export const PLAYER_SLOW_MS = 10_000;
/** Instagram's frame height until its MEASURE message says how tall the post is. */
export const IG_START_HEIGHT = 620;
/** A 9:16 player (TikTok, a YouTube Short): as tall as fits the phone's width, at most 68% of the screen. */
const TALL_HEIGHT = "min(68dvh, calc((100vw - 32px) * 16 / 9))";

const NAME_KEY: Record<EmbedPlatform, MessageKey> = {
  yt: "player.name.yt",
  tt: "player.name.tt",
  ig: "player.name.ig",
};
/** The one-line hint under the frame: Instagram's second tap, TikTok's cookie question. */
const NOTE_KEY: Partial<Record<EmbedPlatform, MessageKey>> = {
  ig: "player.igTwoTaps",
  tt: "player.ttConsent",
};

const FOCUSABLE =
  'a[href], button:not([disabled]), iframe, input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * ▶ Watch here (round 32): the player sheet. Same contract as the skill sheet and the post popup (bottom
 * sheet on phones, centred dialog from md up, body scroll lock, focus in and back out, backdrop tap closes)
 * on its own z-[60] layer: above the skill sheet / post popup (z-40) and ConfirmDialog (z-50), under the
 * celebrations (z-80). Escape is caught on `window` in the capture phase and stopped there, so it closes the
 * player only and a skill sheet underneath stays open. Tab stays inside (a sentinel on each side), and focus
 * goes back to the card's ▶ on close. Back closes it too (the provider's `useBackToClose`).
 *
 * Nothing of ours sits on top of the video (YouTube's rules): the platform chip, the title and ✕ are above
 * the frame; the "open on …" link, the hint and the privacy line are below it. Closing unmounts the iframe,
 * which stops the sound.
 */
export default function PlayerSheet({
  item,
  onClose,
}: {
  item: PlayableItem;
  onClose: () => void;
}) {
  const { t, lang } = useT();
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  const target = useMemo(
    () => embedTarget(item.platform, item.url, lang),
    [item.platform, item.url, lang],
  );

  // Body scroll lock, Escape to close (this sheet only), focus in and back out.
  useEffect(() => {
    const prevFocus = document.activeElement as HTMLElement | null;
    const body = document.body;
    const prevOverflow = body.style.overflow;
    body.style.overflow = "hidden";
    panelRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Before any sheet's own Escape listener (they sit on document): the one under the player stays open.
      e.stopPropagation();
      onCloseRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      body.style.overflow = prevOverflow;
      prevFocus?.focus?.({ preventScroll: true });
    };
  }, []);

  /**
   * Tab past either end of the sheet wraps around to the other end. The sheet itself scrolls (a tall
   * Instagram post), so the control that gets focus is also scrolled into view inside it.
   */
  const wrapFocus = (to: "first" | "last") => {
    const panel = panelRef.current;
    if (!panel) return;
    const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const next = (to === "first" ? items[0] : items[items.length - 1]) ?? panel;
    next.focus({ preventScroll: true });
    next.scrollIntoView({ block: "nearest" });
  };

  if (!target) return null;
  const meta = PLATFORM_META[target.platform];
  const name = t(NAME_KEY[target.platform]);
  const title = item.title.trim() || item.handle?.trim() || t("player.title");

  return (
    <div
      className="anim-fade fixed inset-0 z-[60] flex items-end justify-center bg-[rgba(5,8,12,.72)] md:items-center md:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      data-testid="player-backdrop"
    >
      <div
        tabIndex={0}
        className="sr-only"
        onFocus={() => wrapFocus("last")}
        data-testid="player-focus-start"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-testid="player-sheet"
        data-platform={target.platform}
        className="px-card anim-sheet cal-sheet relative flex max-h-[92dvh] w-full flex-col gap-3 overflow-y-auto overscroll-contain p-3 pb-[calc(12px+env(safe-area-inset-bottom,0px))] outline-none md:max-w-[640px] md:p-4"
      >
        <header className="flex items-start gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex min-w-0 items-center gap-1.5">
              <span
                className={`px-chip shrink-0 text-[10px] ${meta.chip}`}
                data-testid="player-chip"
              >
                {meta.glyph} {meta.label}
              </span>
              {item.handle && (
                <span className="text-muted min-w-0 flex-1 truncate text-xs" dir="ltr">
                  {item.handle}
                </span>
              )}
            </div>
            <h2
              id={titleId}
              dir="auto"
              className="line-clamp-2 text-base leading-snug [overflow-wrap:anywhere]"
              data-testid="player-title"
            >
              {title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("player.close")}
            title={t("player.close")}
            className="px-btn px-btn-ghost px-btn-sm shrink-0"
            data-testid="player-close"
          >
            ✕
          </button>
        </header>
        <PlayerBody
          key={`${target.platform}:${target.id}`}
          target={target}
          url={item.url}
          name={name}
          title={title}
        />
      </div>
      <div
        tabIndex={0}
        className="sr-only"
        onFocus={() => wrapFocus("first")}
        data-testid="player-focus-end"
      />
    </div>
  );
}

type Phase =
  | { kind: "checking" }
  | { kind: "play"; vertical: boolean }
  | { kind: "error"; reason: "cantPlay" | "gone" };

/**
 * One video (keyed by it, so replacing the video starts over): the pre-check, then the frame, then the
 * player's messages. A refusal (from the pre-check or TikTok's player) replaces the frame with the reason.
 */
function PlayerBody({
  target,
  url,
  name,
  title,
}: {
  target: EmbedTarget;
  url: string;
  name: string;
  title: string;
}) {
  const { t } = useT();
  const { platform, id } = target;
  const [phase, setPhase] = useState<Phase>(() =>
    precheckUrl(platform, id) ? { kind: "checking" } : { kind: "play", vertical: false },
  );
  const [igHeight, setIgHeight] = useState<number>();
  const [loaded, setLoaded] = useState(false);
  const [slow, setSlow] = useState(false);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const unmuted = useRef(false);
  const checking = phase.kind === "checking";
  const playing = phase.kind === "play";

  // The pre-check (YouTube, Instagram). Whatever it cannot tell mounts the frame anyway.
  useEffect(() => {
    if (!checking) return;
    const ctrl = new AbortController();
    void precheckEmbed({ platform, id }, { signal: ctrl.signal }).then((check) => {
      if (ctrl.signal.aborted) return;
      setPhase(
        check.verdict === "play"
          ? { kind: "play", vertical: check.vertical === true }
          : { kind: "error", reason: check.verdict },
      );
    });
    return () => ctrl.abort();
  }, [checking, platform, id]);

  // The player's messages: only from its own origin AND this very frame; everything else is ignored.
  useEffect(() => {
    if (!playing || platform === "yt") return;
    const onMessage = (e: MessageEvent) => {
      const win = frameRef.current?.contentWindow;
      if (!win || !isFromPlayer(platform, e, win)) return;
      const signal = readPlayerMessage(platform, e.data);
      if (!signal) return;
      if (signal.kind === "height") setIgHeight(signal.px);
      else if (signal.kind === "error") setPhase({ kind: "error", reason: signal.reason });
      else if (platform === "tt" && !unmuted.current) {
        // TikTok starts muted; once it plays, turn the sound on (once per video).
        unmuted.current = true;
        win.postMessage({ ...TIKTOK_UNMUTE }, EMBED_ORIGIN.tt);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [playing, platform]);

  // YouTube has no script API here: a frame that has not loaded in 10 s gets a line under it.
  useEffect(() => {
    if (!playing || platform !== "yt" || loaded) return;
    const timer = window.setTimeout(() => setSlow(true), PLAYER_SLOW_MS);
    return () => window.clearTimeout(timer);
  }, [playing, platform, loaded]);

  const error = phase.kind === "error" ? phase.reason : undefined;
  const tall = platform === "tt" || (platform === "yt" && phase.kind === "play" && phase.vertical);
  const shape = platform === "ig" ? "post" : tall ? "tall" : "wide";
  const box =
    shape === "wide"
      ? "aspect-video w-full min-h-[200px]"
      : shape === "tall"
        ? "mx-auto aspect-[9/16] max-w-full"
        : "mx-auto w-[min(100%,400px)] min-w-[min(326px,100%)]";
  const frame = EMBED_FRAME[platform];
  const note = NOTE_KEY[platform];

  return (
    <>
      {error ? (
        <p
          role="alert"
          className="px-inset text-ink text-sm"
          data-testid="player-error"
          data-reason={error}
        >
          {error === "gone" ? t("player.gone") : t("player.cantPlay", { platform: name })}
        </p>
      ) : (
        <div
          className={`relative shrink-0 overflow-hidden bg-black ${box}`}
          style={shape === "tall" ? { height: TALL_HEIGHT } : undefined}
          data-testid="player-box"
          data-shape={shape}
        >
          {checking ? (
            <p
              role="status"
              className="text-ink-2 grid h-full min-h-[200px] place-items-center p-4 text-center text-sm"
              data-testid="player-loading"
            >
              {t("player.loading")}
            </p>
          ) : (
            <iframe
              ref={frameRef}
              src={target.src}
              title={t("player.frameTitle", { platform: name, title })}
              sandbox={frame.sandbox}
              allow={frame.allow}
              allowFullScreen
              referrerPolicy={frame.referrerPolicy}
              loading="eager"
              onLoad={() => setLoaded(true)}
              className={`block w-full border-0 ${shape === "post" ? "" : "absolute inset-0 h-full"}`}
              style={shape === "post" ? { height: igHeight ?? IG_START_HEIGHT } : undefined}
              data-testid="player-frame"
            />
          )}
        </div>
      )}
      {playing && slow && !loaded && (
        <p role="status" className="text-gold text-xs" data-testid="player-slow">
          {t("player.slow", { platform: name })}
        </p>
      )}
      <div className="flex min-w-0 flex-col gap-1.5">
        <a
          href={openHref(platform, url)}
          target="_blank"
          rel="noopener noreferrer"
          className={`px-btn px-btn-sm w-fit no-underline ${error ? "" : "px-btn-ghost"}`}
          data-testid="player-open"
        >
          {t("player.openOn", { platform: name })}
        </a>
        {note && !error && (
          <p className="text-ink-2 text-xs" data-testid="player-note">
            {t(note)}
          </p>
        )}
        <p className="text-muted text-xs" data-testid="player-privacy">
          {t("player.privacy", { platform: name })}
        </p>
      </div>
    </>
  );
}
