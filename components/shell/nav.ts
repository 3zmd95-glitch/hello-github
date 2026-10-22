import {
  Briefcase,
  Calendar,
  Clapperboard,
  Ellipsis,
  Globe,
  Lightbulb,
  MessageCircle,
  Rocket,
  Search,
  Settings,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import type { MessageKey } from "@/lib/i18n";

export interface NavItem {
  href: string;
  icon: string;
  /** Social world: the line icon drawn instead of the emoji (tools/18 §3.6). */
  lucide?: LucideIcon;
  label: MessageKey;
  /** Not built yet: shown with a "soon" chip (the route exists and explains what will live there). */
  soon?: boolean;
  /** Only in the desktop sidebar (phones reach it from the top bar gear and More). */
  desktopOnly?: boolean;
}

/**
 * Training-world navigation. Phones show the first five as the tab bar (Today · Skills · Map · Discover · More);
 * Notes, Planner, Review, Rewards and Settings live in the desktop sidebar and behind "More" on the phone.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/", icon: "☀️", label: "nav.today" },
  { href: "/skills", icon: "🌳", label: "nav.skills" },
  { href: "/map", icon: "🗺️", label: "nav.map" },
  { href: "/discover", icon: "🔎", label: "nav.discover" },
  { href: "/more", icon: "☰", label: "nav.more" },
  { href: "/notes", icon: "📝", label: "nav.notes", desktopOnly: true },
  { href: "/planner", icon: "📅", label: "nav.planner", desktopOnly: true },
  { href: "/review", icon: "📊", label: "nav.review", desktopOnly: true },
  { href: "/rewards", icon: "🎁", label: "nav.rewards", desktopOnly: true },
  { href: "/settings", icon: "⚙️", label: "nav.settings", desktopOnly: true },
];

/**
 * Social-world navigation (round 16). Phones: Studio · Calendar · Growth · Ideas · More;
 * Website and Business ("soon"), 💬 Auto replies (round 34), Auto-posting (the Automations route), the
 * 🔎 Discover shortcut (round 31b) and Settings live in the desktop sidebar and behind More.
 *
 * Discover and Settings are Training routes, and the world comes from the URL: they open in the Training
 * shell, so inside Social they are never the active item and never the remembered "last Social route".
 */
export const SOCIAL_NAV_ITEMS: readonly NavItem[] = [
  { href: "/social", icon: "🎬", lucide: Clapperboard, label: "nav.studio" },
  { href: "/social/calendar", icon: "📅", lucide: Calendar, label: "nav.calendar" },
  { href: "/social/growth", icon: "📈", lucide: TrendingUp, label: "nav.growth" },
  { href: "/social/ideas", icon: "💡", lucide: Lightbulb, label: "nav.ideas" },
  { href: "/social/more", icon: "☰", lucide: Ellipsis, label: "nav.more" },
  {
    href: "/social/website",
    icon: "🌐",
    lucide: Globe,
    label: "nav.website",
    soon: true,
    desktopOnly: true,
  },
  {
    href: "/social/business",
    icon: "💼",
    lucide: Briefcase,
    label: "nav.business",
    soon: true,
    desktopOnly: true,
  },
  {
    href: "/social/replies",
    icon: "💬",
    lucide: MessageCircle,
    label: "nav.replies",
    desktopOnly: true,
  },
  {
    href: "/social/automations",
    icon: "🚀",
    lucide: Rocket,
    label: "nav.automations",
    desktopOnly: true,
  },
  { href: "/discover", icon: "🔎", lucide: Search, label: "nav.discover", desktopOnly: true },
  { href: "/settings", icon: "⚙️", lucide: Settings, label: "nav.settings", desktopOnly: true },
];

/** Navigation list per world; the shell renders the active world's list in the sidebar and tab bar. */
export const NAV_BY_WORLD: Record<"training" | "social", readonly NavItem[]> = {
  training: NAV_ITEMS,
  social: SOCIAL_NAV_ITEMS,
};

/** "/skills/" → "/skills", "" → "/". */
export function normalizePath(path: string | null): string {
  if (!path) return "/";
  const p = path.replace(/\/+$/, "");
  return p === "" ? "/" : p;
}

/**
 * The nav item that owns a path: an exact match, else the deepest item whose href is a parent of the path
 * ("/social/calendar/oct" → Calendar, not Studio). "/" only matches itself.
 */
export function activeHref(items: readonly NavItem[], path: string | null): string | undefined {
  const p = normalizePath(path);
  let best: NavItem | undefined;
  for (const item of items) {
    const owns = p === item.href || (item.href !== "/" && p.startsWith(`${item.href}/`));
    if (owns && (!best || item.href.length > best.href.length)) best = item;
  }
  return best?.href;
}
