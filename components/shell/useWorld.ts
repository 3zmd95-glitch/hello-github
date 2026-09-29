"use client";

import { usePathname } from "next/navigation";
import { normalizePath } from "./nav";

/**
 * The two worlds of the dashboard (master plan round 16): 🎮 Training keeps the pixel game look,
 * 📱 Social is the cinematic creator studio. The world is derived from the URL alone
 * (`/social` and everything below it = social), so a static export needs no server logic.
 */
export type World = "training" | "social";

export const SOCIAL_ROOT = "/social";

/** World for a pathname: "/social", "/social/calendar/" → social; everything else → training. */
export function worldOf(path: string | null): World {
  const p = normalizePath(path);
  return p === SOCIAL_ROOT || p.startsWith(`${SOCIAL_ROOT}/`) ? "social" : "training";
}

/** The world of the current route. */
export function useWorld(): World {
  return worldOf(usePathname());
}

const LAST_SOCIAL_KEY = "3z.lastSocialPath";

/**
 * Remember the Social route the user was on, so the world switch brings them back to it. A route outside
 * Social is never remembered: the 🔎 Discover and ⚙️ Settings entries of Social's menu open Training routes.
 */
export function rememberSocialPath(path: string): void {
  if (worldOf(path) !== "social") return;
  try {
    sessionStorage.setItem(LAST_SOCIAL_KEY, normalizePath(path));
  } catch {
    // Private mode or storage disabled: the switch falls back to the Studio home.
  }
}

/** The remembered Social route, or the Studio home. */
export function lastSocialPath(): string {
  try {
    const saved = sessionStorage.getItem(LAST_SOCIAL_KEY);
    if (saved && worldOf(saved) === "social") return saved;
  } catch {
    // ignore: fall back to the Studio home
  }
  return SOCIAL_ROOT;
}
