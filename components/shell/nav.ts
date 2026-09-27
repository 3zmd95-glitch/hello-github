import type { MessageKey } from "@/lib/i18n";

export interface NavItem {
  href: string;
  icon: string;
  label: MessageKey;
  /** Shown but not clickable yet ("soon"). */
  soon?: boolean;
  /** Only in the desktop sidebar (phones reach it from the top bar gear and More). */
  desktopOnly?: boolean;
}

/**
 * Training-world navigation. Phones show the first five as the tab bar (Today · Skills · Map · Discover · More);
 * Planner, Review, Rewards and Settings live in the desktop sidebar and behind "More" on the phone.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/", icon: "☀️", label: "nav.today" },
  { href: "/skills", icon: "🌳", label: "nav.skills" },
  { href: "/map", icon: "🗺️", label: "nav.map" },
  { href: "/discover", icon: "🔎", label: "nav.discover" },
  { href: "/more", icon: "☰", label: "nav.more" },
  { href: "/planner", icon: "📅", label: "nav.planner", desktopOnly: true },
  { href: "/review", icon: "📊", label: "nav.review", desktopOnly: true },
  { href: "/rewards", icon: "🎁", label: "nav.rewards", desktopOnly: true },
  { href: "/settings", icon: "⚙️", label: "nav.settings", desktopOnly: true },
];

/** "/skills/" → "/skills", "" → "/". */
export function normalizePath(path: string | null): string {
  if (!path) return "/";
  const p = path.replace(/\/+$/, "");
  return p === "" ? "/" : p;
}
