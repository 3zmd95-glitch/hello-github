import type { Platform } from "@/lib/domain";
import { PlatformGlyph } from "@/lib/platformIcons";

/** Rounded square in the platform color with its glyph (white; dark on Snapchat yellow; page color on X / Threads ink). */
export default function PlatformBadge({
  platform,
  size = 40,
  className = "",
}: {
  platform: Platform;
  size?: number;
  className?: string;
}) {
  const fg =
    platform === "snapchat"
      ? "#111"
      : platform === "x" || platform === "threads"
        ? "var(--bg)"
        : "#fff";
  return (
    <span
      className={`grid shrink-0 place-items-center ${className}`}
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.33),
        background: `var(--pc-${platform})`,
        color: fg,
      }}
      aria-hidden
    >
      <PlatformGlyph platform={platform} size={Math.round(size * 0.5)} />
    </span>
  );
}
