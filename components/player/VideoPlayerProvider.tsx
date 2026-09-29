"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { canEmbed } from "@/lib/embed";
import PlayerSheet from "./PlayerSheet";
import { useBackToClose } from "./useBackToClose";
import { VideoPlayerContext, type PlayableItem, type VideoPlayerApi } from "./VideoPlayerContext";

/**
 * ▶ Watch here (round 32): the app's one video player. Holds the video being watched (or none) and renders
 * the {@link PlayerSheet} on top of everything but the celebrations. Mounted in the app shell around the skill
 * sheet's provider, so Discover, the skill sheet's saved references and any other screen can open it. Opening
 * a video that cannot play here does nothing; opening another one replaces it (one player at a time).
 */
export default function VideoPlayerProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<PlayableItem | null>(null);
  const open = useCallback((item: PlayableItem) => {
    if (canEmbed(item.platform, item.url)) setCurrent(item);
  }, []);
  const close = useCallback(() => setCurrent(null), []);
  const api = useMemo<VideoPlayerApi>(() => ({ current, open, close }), [current, open, close]);
  useBackToClose(current !== null, close);
  return (
    <VideoPlayerContext.Provider value={api}>
      {children}
      {current && <PlayerSheet item={current} onClose={close} />}
    </VideoPlayerContext.Provider>
  );
}
