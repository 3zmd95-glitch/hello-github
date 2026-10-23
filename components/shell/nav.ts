import {
  Briefcase,
  Calendar,
  Clapperboard,
  Ellipsis,
  Globe,
  Inbox,
  Lightbulb,
  MessageCircle,
  Rocket,
  Settings,
  TrendingUp,
  Workflow,
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
 * Website (the local article CMS), Business (the media kit and brand deals, packet DT-5), 💬 Auto replies
 * (round 34), 📥 the Inbox (tools/51), 🔁 Workflows, Auto-posting (the Automations route) and Social's own
 * Settings live in the desktop sidebar and behind More.
 *
 * Every entry is a Social route (tools/20): the world comes from the URL, so a Social link never opens the
 * Training shell. Discover is a Training route and has no shortcut here.
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
    desktopOnly: true,
  },
  {
    href: "/social/business",
    icon: "💼",
    lucide: Briefcase,
    label: "nav.business",
    desktopOnly: true,
  },
  {
    href: "/social/replies",
    icon: "💬",
    lucide: MessageCircle,
    label: "nav.replies",
    desktopOnly: true,
  },
  { href: "/social/inbox", icon: "📥", lucide: Inbox, label: "nav.inbox", desktopOnly: true },
  {
    href: "/social/workflows",
    icon: "🔁",
    lucide: Workflow,
    label: "nav.workflows",
    desktopOnly: true,
  },
  {
    href: "/social/automations",
    icon: "🚀",
    lucide: Rocket,
    label: "nav.automations",
    desktopOnly: true,
  },
  {
    href: "/social/settings",
    icon: "⚙️",
    lucide: Settings,
    label: "nav.settings",
    desktopOnly: true,
  },
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
