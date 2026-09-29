"use client";

import { useEffect, useRef } from "react";

/** The history state field that marks the entry pushed for an open player. */
export const PLAYER_HISTORY_KEY = "3z-player";

let opened = 0;

/**
 * Back closes the player (the phone's back gesture or button, the browser's ←) instead of leaving the page.
 * While `open`, one history entry carries a token of its own; going back off it calls `onClose`. Closing any
 * other way (✕, Escape, the backdrop) goes back one entry so no stale entry is left behind.
 *
 * The entry has no URL of its own (`pushState(state, "")`): Next 16's patched `pushState` copies its router
 * state (`__NA`, the tree) into it, so going back is a same-page traverse, never a reload or a re-route
 * (node_modules/next/dist/client/components/app-router.js, docs "Native History API"). Forward onto the old
 * entry reopens nothing: the player is held in React state, not in history.
 *
 * It lives in the provider (a long-lived component), keyed on `open` only: replacing the video keeps the
 * same entry, and React's development double effect never runs for an update.
 */
export function useBackToClose(open: boolean, onClose: () => void): void {
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const history = window.history;
    const token = `${Date.now().toString(36)}-${++opened}`;
    const ours = () =>
      (history.state as Record<string, unknown> | null)?.[PLAYER_HISTORY_KEY] === token;
    history.pushState({ [PLAYER_HISTORY_KEY]: token }, "");
    const onPop = () => {
      if (!ours()) onCloseRef.current();
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      // Closed by ✕ / Escape / the backdrop (still on our entry): drop it. Closed by Back: already gone.
      if (ours()) history.back();
    };
  }, [open]);
}
