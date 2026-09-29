"use client";

import { createContext, useContext } from "react";
import type { RefPlatform } from "@/lib/domain";

/**
 * ▶ Watch here (round 32): what a card hands to the player. Any research card, saved reference or trend row
 * that is one post of YouTube, TikTok or Instagram can be played (lib/embed `canEmbed`).
 */
export interface PlayableItem {
  platform: RefPlatform;
  url: string;
  title: string;
  handle?: string;
  thumb?: string;
}

export interface VideoPlayerApi {
  /** The video in the player sheet, or null while it is closed. One player at a time. */
  current: PlayableItem | null;
  /** Open the sheet on a video (replaces the one playing). */
  open(item: PlayableItem): void;
  close(): void;
}

/** Outside the provider (a unit test, a story) the player does nothing, so cards still render. */
const NO_PLAYER: VideoPlayerApi = { current: null, open() {}, close() {} };

export const VideoPlayerContext = createContext<VideoPlayerApi>(NO_PLAYER);

/** The app's one video player (components/player/VideoPlayerProvider mounts it in the shell). */
export function useVideoPlayer(): VideoPlayerApi {
  return useContext(VideoPlayerContext);
}
