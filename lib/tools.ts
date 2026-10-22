import {
  AtSign,
  Briefcase,
  Calendar,
  CalendarDays,
  Camera,
  Clapperboard,
  ClipboardCheck,
  Cpu,
  DatabaseBackup,
  Gift,
  Globe,
  GraduationCap,
  Inbox,
  KeyRound,
  Lightbulb,
  Map,
  MessageCircle,
  MonitorPlay,
  Music2,
  NotebookPen,
  Plug,
  Puzzle,
  Rocket,
  Search,
  Server,
  Sun,
  TrendingUp,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { nativeHelperId } from "@/lib/discoverNativeSearch";
import type { ApiKeys, SocialConnectionStatus, SocialSyncState } from "@/lib/domain";
import { MESSAGE_FILES, type MessageKey } from "@/lib/i18n";
import { isLocalAiHost } from "@/lib/localAi";
import { canPublishTo } from "@/lib/publish";
import { normalizeForMatch } from "@/lib/replies";
import { scoutConfig } from "@/lib/scoutClient";
import { SOCIAL_PLATFORMS, accountState, type SocialPlatform } from "@/lib/socialSync";
import type { StoreState } from "@/store";

/**
 * 🧰 Tools & integrations hub (packet DT-1, planning/collaboration/dashboard-tools-handoff.md): one first-party
 * registry of what the dashboard can do and how ready each piece is. Read-only: readiness comes from what the
 * store already holds (saved keys, the last social status reply) and two local checks; nothing here fetches.
 * Saved credentials are "configured"; a stored account status is only "last known"; nothing is ever green.
 */

export type ToolGroup =
  "learn" | "plan" | "publish" | "discover" | "ai" | "accounts" | "data" | "planned";

export const TOOL_GROUPS: readonly ToolGroup[] = [
  "learn",
  "plan",
  "publish",
  "discover",
  "ai",
  "accounts",
  "data",
  "planned",
];

export type ToolReadiness =
  /** Works on this device, nothing to configure. */
  | "available"
  /** The page runs on a local address, so local setup is possible; nothing about sign-in is verified. */
  | "hostOnly"
  /**
   * The stored status said connected, without an error. Never shown as "connected": the cached status is not
   * bound to the Worker URL/token (`setSettings` keeps it), so it is only the last known state (Amendment A).
   */
  | "lastKnown"
  /** Credentials or an ID are saved: never a proof of connection. */
  | "configured"
  /** A connected, error-free, timestamped status shows a needed scope is missing (repair round 1). */
  | "permission"
  /** Connection error or token expiry only. */
  | "attention"
  /** Configured, but no status (or no status time) is stored yet. */
  | "unknown"
  /** Nothing configured: "Set up" routes to the existing controls. */
  | "setup"
  /** Not built; a placeholder route or none. */
  | "planned";

export interface ToolContext {
  apiKeys: ApiKeys;
  /** Status + statusAt as the store holds them, never fetched here. */
  social: SocialSyncState;
  localAiHost: boolean;
  helperId: string | null;
}

export interface ToolDef {
  id: string;
  group: ToolGroup;
  icon: LucideIcon;
  /** An existing route or Settings anchor only. */
  href?: string;
  /** Where "Set up" goes (default: href). */
  setupHref?: string;
  name: MessageKey;
  desc: MessageKey;
  /** Label of the link to `setupHref` when the state is `permission`. */
  permission?: MessageKey;
  state: (ctx: ToolContext) => ToolReadiness;
}

const workerConfigured = (ctx: ToolContext) =>
  scoutConfig(ctx.apiKeys.scoutUrl, ctx.apiKeys.scoutToken) !== null;

/** Readiness of one connected account from the stored status reply (`statusAt` = when it was fetched). */
export function accountReadiness(
  status: SocialConnectionStatus | undefined,
  statusAt: string | null,
  configuredWorker: boolean,
  platform: SocialPlatform,
): ToolReadiness {
  if (!configuredWorker) return "setup";
  if (!status && !statusAt) return "unknown";
  const state = accountState(status, platform);
  if (state === "not_configured" || state === "disconnected") return "setup";
  if (state === "error") return "attention";
  return statusAt ? "lastKnown" : "unknown";
}

const platformReadiness = (ctx: ToolContext, p: SocialPlatform) =>
  accountReadiness(ctx.social.status?.[p], ctx.social.statusAt, workerConfigured(ctx), p);

/** Auto-posting: last known when an account may publish (TikTok: inbox upload or direct post). */
function autopostReadiness(ctx: ToolContext): ToolReadiness {
  const status = ctx.social.status;
  if (!workerConfigured(ctx)) return "setup";
  if (!status) return "unknown";
  const canPost = (p: SocialPlatform) =>
    canPublishTo(status[p], p, "inbox") || canPublishTo(status[p], p, "direct");
  const states = SOCIAL_PLATFORMS.map((p) => [p, platformReadiness(ctx, p)] as const);
  if (states.some(([p, r]) => r === "lastKnown" && canPost(p))) return "lastKnown";
  // Without a status time nothing proves a missing scope: never infer a permission failure.
  if (!ctx.social.statusAt && SOCIAL_PLATFORMS.some((p) => status[p]?.connected)) return "unknown";
  if (states.some(([, r]) => r === "lastKnown")) return "permission";
  if (states.some(([, r]) => r === "attention")) return "attention";
  return "setup";
}

/** Auto replies and the Inbox: Instagram, with the reply permission; errors, unknown and setup pass through. */
function repliesReadiness(ctx: ToolContext): ToolReadiness {
  const r = platformReadiness(ctx, "instagram");
  return r === "lastKnown" && !ctx.social.status?.instagram?.canReply ? "permission" : r;
}

const available = () => "available" as const;
const saved = (ok: boolean): ToolReadiness => (ok ? "configured" : "setup");

function def(
  id: string,
  group: ToolGroup,
  icon: LucideIcon,
  state: ToolDef["state"],
  links: Pick<ToolDef, "href" | "setupHref" | "permission"> = {},
): ToolDef {
  return {
    id,
    group,
    icon,
    ...links,
    name: `tools.${id}.name` as MessageKey,
    desc: `tools.${id}.desc` as MessageKey,
    state,
  };
}

const ACCOUNTS = "/settings#accounts";
const API_KEYS = "/settings#api-keys";

const account = (id: SocialPlatform, icon: LucideIcon) =>
  def(id, "accounts", icon, (ctx) => platformReadiness(ctx, id), { href: ACCOUNTS });

export const TOOLS: readonly ToolDef[] = [
  def("today", "learn", Sun, available, { href: "/" }),
  def("skills", "learn", GraduationCap, available, { href: "/skills" }),
  def("map", "learn", Map, available, { href: "/map" }),
  def("notes", "learn", NotebookPen, available, { href: "/notes" }),
  def("planner", "learn", CalendarDays, available, { href: "/planner" }),
  def("review", "learn", ClipboardCheck, available, { href: "/review" }),
  def("rewards", "learn", Gift, available, { href: "/rewards" }),
  def("studio", "plan", Clapperboard, available, { href: "/social" }),
  def("calendar", "plan", Calendar, available, { href: "/social/calendar" }),
  def("growth", "plan", TrendingUp, available, { href: "/social/growth" }),
  def("ideas", "plan", Lightbulb, available, { href: "/social/ideas" }),
  def("autopost", "publish", Rocket, autopostReadiness, {
    href: "/social/automations",
    setupHref: "/social/automations",
    permission: "tools.autopost.permission",
  }),
  def("replies", "publish", MessageCircle, repliesReadiness, {
    href: "/social/replies",
    setupHref: "/social/replies",
    permission: "tools.replies.permission",
  }),
  // Website CMS (packet DT-3): local articles, nothing public.
  def("website", "publish", Globe, available, { href: "/social/website" }),
  // Workflow builder (packet DT-4): local drafts only, runs while this browser is open.
  def("workflows", "publish", Workflow, available, { href: "/social/workflows" }),
  // Business kit (packet DT-5): local media kit and brand deals, nothing public.
  def("business", "publish", Briefcase, available, { href: "/social/business" }),
  // Inbox (packet DT-6A): read-only Instagram DMs and comments with private drafts; needs the reply scopes.
  def("inbox", "publish", Inbox, repliesReadiness, {
    href: "/social/inbox",
    setupHref: "/social/inbox",
    permission: "tools.inbox.permission",
  }),
  def("discover", "discover", Search, available, { href: "/discover" }),
  def("helper", "discover", Puzzle, (ctx) => saved(!!ctx.helperId), { setupHref: "/discover" }),
  // No #ai anchor exists: the row opens Discover, whose search tools hold the AI controls.
  def("localAi", "ai", Cpu, (ctx) => (ctx.localAiHost ? "hostOnly" : "setup"), {
    href: "/discover",
  }),
  def("scout", "accounts", Server, (ctx) => saved(workerConfigured(ctx)), { href: API_KEYS }),
  def("youtubeKey", "accounts", KeyRound, (ctx) => saved(!!ctx.apiKeys.youtube?.trim()), {
    href: API_KEYS,
  }),
  account("tiktok", Music2),
  account("instagram", Camera),
  account("youtube", MonitorPlay),
  account("threads", AtSign),
  def("mcp", "accounts", Plug, (ctx) => saved(workerConfigured(ctx)), { setupHref: API_KEYS }),
  def("backup", "data", DatabaseBackup, available, { href: "/settings#data" }),
];

/** The hub's context from the store state; the two local checks read only this page and localStorage. */
export function toolContext(state: Pick<StoreState, "settings" | "socialSync">): ToolContext {
  return {
    apiKeys: state.settings.apiKeys,
    social: state.socialSync,
    localAiHost: isLocalAiHost(),
    helperId: nativeHelperId(),
  };
}

const dict = MESSAGE_FILES.tools as {
  ar: Record<string, string>;
  en: Record<string, string>;
};
const haystack = (t: ToolDef) =>
  normalizeForMatch([dict.ar[t.name], dict.ar[t.desc], dict.en[t.name], dict.en[t.desc]].join(" "));

/** Tools whose name or description, in Arabic or English, contains the query (loose Arabic matching). */
export function searchTools(query: string, tools: readonly ToolDef[] = TOOLS): ToolDef[] {
  const q = normalizeForMatch(query);
  if (!q) return [...tools];
  return tools.filter((t) => haystack(t).includes(q));
}

/** Quick Actions (packet DT-2): the built tools that lead somewhere; planned ones stay in the full hub. */
export function quickActionTools(tools: readonly ToolDef[] = TOOLS): ToolDef[] {
  return tools.filter((t) => t.group !== "planned" && (t.href ?? t.setupHref));
}
