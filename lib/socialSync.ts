import { SOCIAL_SEED_DAY, SOCIAL_SEED_PLATFORMS } from "@/data/social-seed";
import {
  PLATFORMS,
  SocialConnectionStatusSchema,
  type Demographic,
  type Lang,
  type Platform,
  type SocialAccount,
  type SocialConnectionStatus,
  type SocialPostStatInput,
  type SocialSnapshotInput,
  type SocialStatusMap,
} from "./domain";
import type { ScoutConfig } from "./scoutClient";
import { addDays, dayKey } from "./streak";

/**
 * Client for the Scout Worker's live social endpoints (`/social/*`): the owner connects his Instagram, Threads,
 * YouTube and TikTok once through OAuth (the tokens stay in the Worker), a daily cron pulls the numbers, and
 * the dashboard reads them here and writes them into the store through the same `importSnapshots` /
 * `importPostStats` / `importDemographics` path the CSV imports use.
 *
 * Same shape as lib/scoutClient: the Worker URL and token come from Settings (`scoutConfig`), every call sends
 * `Authorization: Bearer <token>`, nothing throws, failures are a typed `{ ok: false, error }`.
 */

/** The platforms the Worker can connect, in the dashboard's display order. */
export const SOCIAL_PLATFORMS = ["tiktok", "instagram", "youtube", "threads"] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

export function isSocialPlatform(p: string): p is SocialPlatform {
  return (SOCIAL_PLATFORMS as readonly string[]).includes(p);
}

/** Worker error codes (`{ error }` in the body), plus the client-side ones. */
export type SocialSyncErrorType =
  | "unconfigured"
  | "auth"
  | "network"
  | "not_configured"
  | "not_connected"
  | "state_invalid"
  | "exchange_failed"
  | "token_expired"
  | "upstream"
  | "rate_limited"
  | "bad_request";

export interface SocialSyncError {
  type: SocialSyncErrorType;
  status?: number;
}

export type SocialResult<T> = ({ ok: true } & T) | { ok: false; error: SocialSyncError };

export interface SocialHealth {
  configured: Record<SocialPlatform, boolean>;
  kv: boolean;
}

export interface SocialSyncOutcome {
  synced: string[];
  errors: Record<string, string>;
}

/** `GET /social/data`: everything the Worker pulled since a day, ready for the store. */
export interface SocialData {
  accounts: SocialAccount[];
  snapshots: SocialSnapshotInput[];
  postStats: SocialPostStatInput[];
  demographics: Demographic[];
  syncedAt: Partial<Record<Platform, string>>;
}

export interface SocialSyncOpts {
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

/* ---------- error mapping ---------- */

export type SocialSyncMessageKey =
  | "settings.accounts.err.unconfigured"
  | "settings.accounts.err.auth"
  | "settings.accounts.err.network"
  | "settings.accounts.err.notConfigured"
  | "settings.accounts.err.notConnected"
  | "settings.accounts.err.state"
  | "settings.accounts.err.exchange"
  | "settings.accounts.err.expired"
  | "settings.accounts.err.upstream"
  | "settings.accounts.err.rateLimited"
  | "settings.accounts.err.badRequest";

const MESSAGE_KEYS: Record<SocialSyncErrorType, SocialSyncMessageKey> = {
  unconfigured: "settings.accounts.err.unconfigured",
  auth: "settings.accounts.err.auth",
  network: "settings.accounts.err.network",
  not_configured: "settings.accounts.err.notConfigured",
  not_connected: "settings.accounts.err.notConnected",
  state_invalid: "settings.accounts.err.state",
  exchange_failed: "settings.accounts.err.exchange",
  token_expired: "settings.accounts.err.expired",
  upstream: "settings.accounts.err.upstream",
  rate_limited: "settings.accounts.err.rateLimited",
  bad_request: "settings.accounts.err.badRequest",
};

/** Message key (in `messages/*.json`) for a {@link SocialSyncError}. */
export function socialSyncErrorMessageKey(error: SocialSyncError): SocialSyncMessageKey {
  return MESSAGE_KEYS[error.type] ?? "settings.accounts.err.upstream";
}

/** The error type for a Worker reason code (e.g. the `reason` of a `?connect_error=` redirect). */
export function socialErrorType(code: unknown): SocialSyncErrorType {
  return typeof code === "string" && code in MESSAGE_KEYS
    ? (code as SocialSyncErrorType)
    : "upstream";
}

async function errorFrom(res: Response): Promise<SocialSyncError> {
  let code: unknown;
  try {
    code = ((await res.json()) as { error?: unknown }).error;
  } catch {
    // Not JSON (a Cloudflare error page): map by status below.
  }
  if (res.status === 401 || code === "auth" || code === "unauthorized" || code === "origin") {
    return { type: "auth", status: res.status };
  }
  if (res.status === 429) return { type: "rate_limited", status: res.status };
  if (typeof code === "string" && code in MESSAGE_KEYS) {
    return { type: code as SocialSyncErrorType, status: res.status };
  }
  if (res.status === 400) return { type: "bad_request", status: res.status };
  return { type: "upstream", status: res.status };
}

/** One authenticated Worker call; also used by lib/publish for the auto-post queue. */
export async function call(
  config: ScoutConfig,
  path: string,
  init: RequestInit,
  opts: SocialSyncOpts,
): Promise<{ ok: true; data: unknown } | { ok: false; error: SocialSyncError }> {
  const doFetch = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(`${config.url}${path}`, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${config.token}` },
    });
  } catch {
    return { ok: false, error: { type: "network" } };
  }
  if (!res.ok) return { ok: false, error: await errorFrom(res) };
  try {
    return { ok: true, data: await res.json() };
  } catch {
    return { ok: false, error: { type: "upstream", status: res.status } };
  }
}

export const post = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

/* ---------- API ---------- */

/** `GET /health`: which platforms the Worker has OAuth clients for, and whether its KV store is bound. */
export async function socialHealth(
  config: ScoutConfig | null,
  opts: SocialSyncOpts = {},
): Promise<SocialResult<{ social: SocialHealth }>> {
  if (!config) return { ok: false, error: { type: "unconfigured" } };
  const r = await call(config, "/health", {}, opts);
  if (!r.ok) return r;
  const d = (r.data ?? {}) as { ok?: unknown; social?: { configured?: unknown; kv?: unknown } };
  if (d.ok !== true || !d.social || typeof d.social !== "object") {
    return { ok: false, error: { type: "auth" } };
  }
  const raw = (d.social.configured ?? {}) as Record<string, unknown>;
  const configured = Object.fromEntries(
    SOCIAL_PLATFORMS.map((p) => [p, raw[p] === true]),
  ) as Record<SocialPlatform, boolean>;
  return { ok: true, social: { configured, kv: d.social.kv === true } };
}

/** Keep the platforms we know and the fields the schema accepts; drop anything else the Worker sends. */
export function parseSocialStatus(raw: unknown): SocialStatusMap {
  const platforms = (raw as { platforms?: unknown })?.platforms;
  const out: SocialStatusMap = {};
  if (!platforms || typeof platforms !== "object") return out;
  for (const [p, entry] of Object.entries(platforms as Record<string, unknown>)) {
    if (!isSocialPlatform(p)) continue;
    const parsed = SocialConnectionStatusSchema.safeParse(entry);
    if (parsed.success) out[p] = parsed.data;
  }
  return out;
}

/** `GET /social/status`: connection state per platform. */
export async function socialStatus(
  config: ScoutConfig | null,
  opts: SocialSyncOpts = {},
): Promise<SocialResult<{ platforms: SocialStatusMap }>> {
  if (!config) return { ok: false, error: { type: "unconfigured" } };
  const r = await call(config, "/social/status", {}, opts);
  if (!r.ok) return r;
  return { ok: true, platforms: parseSocialStatus(r.data) };
}

/**
 * `POST /social/connect/:platform`: the OAuth URL to send the owner to. The Worker later redirects back to
 * `returnTo?connected=<platform>` or `returnTo?connect_error=<platform>&reason=<code>`.
 */
export async function socialConnectUrl(
  config: ScoutConfig | null,
  platform: SocialPlatform,
  returnTo: string,
  opts: SocialSyncOpts & { publish?: boolean } = {},
): Promise<SocialResult<{ url: string }>> {
  if (!config) return { ok: false, error: { type: "unconfigured" } };
  const body = opts.publish ? { returnTo, publish: true } : { returnTo };
  const r = await call(config, `/social/connect/${platform}`, post(body), opts);
  if (!r.ok) return r;
  const url = (r.data as { url?: unknown })?.url;
  if (typeof url !== "string" || !/^https?:\/\//.test(url)) {
    return { ok: false, error: { type: "upstream" } };
  }
  return { ok: true, url };
}

/** `DELETE /social/connect/:platform`: forget the platform's token in the Worker. */
export async function socialDisconnect(
  config: ScoutConfig | null,
  platform: SocialPlatform,
  opts: SocialSyncOpts = {},
): Promise<SocialResult<object>> {
  if (!config) return { ok: false, error: { type: "unconfigured" } };
  const r = await call(config, `/social/connect/${platform}`, { method: "DELETE" }, opts);
  return r.ok ? { ok: true } : r;
}

/** `POST /social/sync`: make the Worker pull the platforms now (all connected ones when omitted). */
export async function socialSyncNow(
  config: ScoutConfig | null,
  platforms?: readonly SocialPlatform[],
  opts: SocialSyncOpts = {},
): Promise<SocialResult<SocialSyncOutcome>> {
  if (!config) return { ok: false, error: { type: "unconfigured" } };
  const r = await call(config, "/social/sync", post(platforms ? { platforms } : {}), opts);
  if (!r.ok) return r;
  const d = (r.data ?? {}) as { synced?: unknown; errors?: unknown };
  const synced = Array.isArray(d.synced) ? d.synced.filter((p) => typeof p === "string") : [];
  const errors: Record<string, string> = {};
  if (d.errors && typeof d.errors === "object") {
    for (const [p, code] of Object.entries(d.errors as Record<string, unknown>)) {
      if (typeof code === "string") errors[p] = code;
    }
  }
  return { ok: true, synced, errors };
}

const isPlatform = (p: unknown): p is Platform =>
  typeof p === "string" && (PLATFORMS as readonly string[]).includes(p);

/**
 * Shape the `/social/data` reply for the store: rows of unknown platforms are dropped here, the store's Zod
 * schemas validate the rest (a bad row throws there, like a bad CSV line would).
 */
export function parseSocialData(raw: unknown): SocialData {
  const d = (raw ?? {}) as Partial<Record<keyof SocialData, unknown>>;
  const rows = <T extends { platform: unknown }>(list: unknown): T[] =>
    Array.isArray(list)
      ? (list as T[]).filter((r) => r && typeof r === "object" && isPlatform(r.platform))
      : [];
  const accounts = rows<SocialAccount>(d.accounts).filter(
    (a) => typeof a.handle === "string" && a.handle.trim().replace(/^@/, "") !== "",
  );
  const syncedAt: Partial<Record<Platform, string>> = {};
  if (d.syncedAt && typeof d.syncedAt === "object") {
    for (const [p, at] of Object.entries(d.syncedAt as Record<string, unknown>)) {
      if (isPlatform(p) && typeof at === "string") syncedAt[p] = at;
    }
  }
  return {
    accounts,
    snapshots: rows<SocialSnapshotInput>(d.snapshots),
    postStats: rows<SocialPostStatInput>(d.postStats),
    demographics: rows<Demographic>(d.demographics),
    syncedAt,
  };
}

/** `GET /social/data?since=YYYY-MM-DD`: the pulled rows (everything when `since` is omitted). */
export async function socialData(
  config: ScoutConfig | null,
  since?: string,
  opts: SocialSyncOpts = {},
): Promise<SocialResult<{ data: SocialData }>> {
  if (!config) return { ok: false, error: { type: "unconfigured" } };
  const q = since ? `?since=${encodeURIComponent(since)}` : "";
  const r = await call(config, `/social/data${q}`, {}, opts);
  if (!r.ok) return r;
  return { ok: true, data: parseSocialData(r.data) };
}

/* ---------- store glue (pure) ---------- */

/** What `applySocialData` needs from the store: `useStore.getState()` satisfies it. */
export interface SocialDataStore {
  importSnapshots(list: readonly SocialSnapshotInput[]): void;
  importPostStats(list: readonly SocialPostStatInput[]): void;
  importDemographics(list: readonly Demographic[]): void;
  setAccount(platform: Platform, handle: string, url?: string): void;
}

/** Write a `/social/data` reply into the store (snapshots, posts, demographics, then the accounts). */
export function applySocialData(store: SocialDataStore, data: SocialData): void {
  if (data.snapshots.length) store.importSnapshots(data.snapshots);
  if (data.postStats.length) store.importPostStats(data.postStats);
  if (data.demographics.length) store.importDemographics(data.demographics);
  for (const a of data.accounts) store.setAccount(a.platform, a.handle, a.url);
}

/**
 * The `since` day for the next pull: two days before the day of the last pull, so rows the Worker rewrote in
 * the meantime (yesterday's averages, a late post) are read again. Undefined (= everything) for a first pull.
 */
export function sinceFor(lastPullAt: string | null | undefined): string | undefined {
  if (!lastPullAt) return undefined;
  const ms = Date.parse(lastPullAt);
  if (Number.isNaN(ms)) return undefined;
  return addDays(dayKey(ms), -2);
}

/** How long between pulls when nothing asks for one (the Worker syncs once a day anyway). */
export const PULL_INTERVAL_MS = 60 * 60 * 1000;

/** True when `lastPullAt` is missing, unparsable or older than {@link PULL_INTERVAL_MS}. */
export function pullIsDue(
  lastPullAt: string | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!lastPullAt) return true;
  const ms = Date.parse(lastPullAt);
  return Number.isNaN(ms) || now - ms >= PULL_INTERVAL_MS;
}

/* ---------- where a platform's numbers come from ---------- */

/** The badge on a platform card: live from the Worker, the seeded Beacons row, a manual/CSV row, or nothing. */
export type SnapshotSource = "live" | "beacons" | "manual" | "none";

/** True for the Sep 27, 2026 Beacons rows (data/social-seed) of one of the four seeded platforms. */
export function isSeedRow(row: { platform: Platform; day: string }): boolean {
  return (
    row.day === SOCIAL_SEED_DAY &&
    (SOCIAL_SEED_PLATFORMS as readonly string[]).includes(row.platform)
  );
}

/**
 * `live` when the platform is connected and its latest snapshot is from the last sync day or later; `beacons`
 * when the latest snapshot is the seed row and the platform is not connected; `manual` for any other snapshot.
 */
export function snapshotSource(
  platform: Platform,
  latestDay: string | null | undefined,
  status: SocialConnectionStatus | undefined,
): SnapshotSource {
  if (!latestDay) return "none";
  const connected = status?.connected === true;
  if (connected && status?.lastSyncAt) {
    const syncMs = Date.parse(status.lastSyncAt);
    if (!Number.isNaN(syncMs) && latestDay >= dayKey(syncMs)) return "live";
  }
  if (!connected && isSeedRow({ platform, day: latestDay })) return "beacons";
  return "manual";
}

/** UI state of a Settings row. */
export type AccountState = "not_configured" | "disconnected" | "connected" | "error";

export function accountState(status: SocialConnectionStatus | undefined): AccountState {
  if (!status || !status.configured) return "not_configured";
  if (!status.connected) return "disconnected";
  if (status.lastError) return "error";
  if (status.tokenExpiresAt) {
    const exp = Date.parse(status.tokenExpiresAt);
    if (!Number.isNaN(exp) && exp <= Date.now()) return "error";
  }
  return "connected";
}

/** "قبل ساعتين" / "2 hours ago" for an ISO time, coarse (minutes, hours, days); "" for an unparsable one. */
export function timeAgo(iso: string, lang: Lang, now: number = Date.now()): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "";
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: "auto" });
  const diffMin = Math.round((ms - now) / 60_000);
  if (Math.abs(diffMin) < 1) return rtf.format(0, "second");
  if (Math.abs(diffMin) < 60) return rtf.format(diffMin, "minute");
  const diffH = Math.round(diffMin / 60);
  if (Math.abs(diffH) < 24) return rtf.format(diffH, "hour");
  return rtf.format(Math.round(diffH / 24), "day");
}
