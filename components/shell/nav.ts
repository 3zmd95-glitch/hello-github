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

export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/", icon: "☀️", label: "nav.today" },
  { href: "/skills", icon: "🌳", label: "nav.skills" },
  { href: "/map", icon: "🗺️", label: "nav.map", soon: true },
  { href: "/more", icon: "☰", label: "nav.more" },
  { href: "/settings", icon: "⚙️", label: "nav.settings", desktopOnly: true },
];

/** "/skills/" → "/skills", "" → "/". */
export function normalizePath(path: string | null): string {
  if (!path) return "/";
  const p = path.replace(/\/+$/, "");
  return p === "" ? "/" : p;
}
