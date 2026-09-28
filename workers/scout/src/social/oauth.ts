/**
 * OAuth glue shared by the four platforms: credentials from the env, the redirect URI, the authorization
 * URL (with PKCE where the platform supports it), code exchange and refresh. The platform-specific
 * endpoints live in each platform module as a `ProviderAuth`; this file only dispatches.
 */

import type { Http } from "./http";
import { auth as instagramAuth } from "./instagram";
import type { SocialEnv } from "./store";
import { auth as threadsAuth } from "./threads";
import { auth as tiktokAuth } from "./tiktok";
import type { SocialPlatform, TokenSet } from "./types";
import { auth as youtubeAuth } from "./youtube";

export interface ProviderCreds {
  id: string;
  secret: string;
}

/** What each platform module implements for the OAuth side. */
export interface ProviderAuth {
  /** Space- or comma-separated scope string, as the provider wants it. */
  scopes: string;
  pkce: boolean;
  authorizeUrl(
    creds: ProviderCreds,
    redirectUri: string,
    state: string,
    challenge?: string,
  ): string;
  /** Exchanges the code and, where the platform has them, upgrades to long-lived/refresh tokens. */
  exchange(
    creds: ProviderCreds,
    code: string,
    redirectUri: string,
    verifier: string | undefined,
    http: Http,
    now: Date,
  ): Promise<TokenSet>;
  /** Whether `refresh` should run before the next API call. */
  needsRefresh(tokens: TokenSet, now: Date): boolean;
  /** Throws `token_expired` when the owner has to reconnect. */
  refresh(creds: ProviderCreds, tokens: TokenSet, http: Http, now: Date): Promise<TokenSet>;
}

export const PROVIDERS: Record<SocialPlatform, ProviderAuth> = {
  instagram: instagramAuth,
  threads: threadsAuth,
  youtube: youtubeAuth,
  tiktok: tiktokAuth,
};

/** Client id + secret for a platform, or null when either is missing (`configured: false`). */
export function credentials(env: SocialEnv, platform: SocialPlatform): ProviderCreds | null {
  // Meta gives the Threads use case its own app id/secret (not the Instagram pair); fall back to the
  // Meta pair only when the Threads pair is not set, so older setups keep working.
  const threadsOwn = !!(env.THREADS_APP_ID?.trim() && env.THREADS_APP_SECRET?.trim());
  const pair: [string | undefined, string | undefined] =
    platform === "threads" && threadsOwn
      ? [env.THREADS_APP_ID, env.THREADS_APP_SECRET]
      : platform === "instagram" || platform === "threads"
      ? [env.META_APP_ID, env.META_APP_SECRET]
      : platform === "youtube"
        ? [env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET]
        : [env.TIKTOK_CLIENT_KEY, env.TIKTOK_CLIENT_SECRET];
  const [id, secret] = pair.map((s) => s?.trim() ?? "");
  return id && secret ? { id, secret } : null;
}

export function isConfigured(env: SocialEnv, platform: SocialPlatform): boolean {
  return credentials(env, platform) !== null;
}

/** `<worker origin>/oauth/<platform>/callback`: the redirect URI registered in each developer app. */
export function redirectUri(origin: string, platform: SocialPlatform): string {
  return `${origin.replace(/\/+$/, "")}/oauth/${platform}/callback`;
}

/** Whether the token set is past its expiry (with a 60 s margin). */
export function isExpired(tokens: TokenSet, now: Date, marginMs = 60_000): boolean {
  if (!tokens.expiresAt) return false;
  return Date.parse(tokens.expiresAt) - now.getTime() < marginMs;
}

export function isoPlusSeconds(now: Date, seconds: number): string {
  return new Date(now.getTime() + seconds * 1000).toISOString();
}

export function ageDays(tokens: TokenSet, now: Date): number {
  return (now.getTime() - Date.parse(tokens.issuedAt)) / 86_400_000;
}
