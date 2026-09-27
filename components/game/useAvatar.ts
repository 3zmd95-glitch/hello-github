"use client";

import type { Avatar } from "@/lib/domain";
import { useStore } from "@/store";

/** The owner's avatar look from Settings → "Your look"; pass it to `PixelScene`. */
export function useAvatar(): Avatar {
  return useStore((s) => s.settings.avatar);
}
