/**
 * KV layout (binding `SOCIAL_KV`):
 *
 *   tokens:<platform>        AES-GCM blob (crypto.ts) of a TokenSet
 *   status:<platform>        StoredStatus (plain JSON, never tokens)
 *   snap:<platform>:<day>    SnapshotRow (also in the key's metadata so `list` returns rows without a `get`)
 *   posts:<platform>         { [postId]: PostRow } — one document per platform, merged on every sync
 *   demo:<platform>:<day>    DemographicRow[]
 *   state:<nonce>            OAuthState, 10-minute TTL, deleted when the callback consumes it
 *   publish:jobs             { [jobId]: PublishJob } — the auto-post queue, one document (publish.ts)
 *   replies:doc              AutomationsDoc — the owner's auto-reply automations (written by the dashboard routes)
 *   replies:state            PollState — answered comments, counters, log, poll lock (written by the poll only)
 *   replies:clicks           ClicksDoc — taps on the /go links, capped per day (written by /go only)
 *
 * The free plan allows 1,000 KV writes a day and counts KV operations toward the 50 subrequests of an
 * invocation, so posts live in one document per platform rather than one key per post (a daily sync of four
 * platforms then costs about a dozen writes instead of four hundred).
 */

import { decryptJson, encryptJson } from "./crypto";
import { addDays, riyadhDay } from "./time";
import type {
  DemographicRow,
  PostRow,
  SnapshotRow,
  SocialPlatform,
  StoredStatus,
  TokenSet,
} from "./types";

export interface SocialEnv {
  SCOUT_TOKEN?: string;
  ALLOWED_ORIGINS?: string;
  SOCIAL_KV?: KVNamespace;
  /** Meta app: the Instagram API with Instagram Login's "Instagram app ID" / secret. */
  META_APP_ID?: string;
  META_APP_SECRET?: string;
  /** The same Meta app's Threads use case has its own "Threads app ID" / secret; falls back to META_*. */
  THREADS_APP_ID?: string;
  THREADS_APP_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  TIKTOK_CLIENT_KEY?: string;
  TIKTOK_CLIENT_SECRET?: string;
}

/** What `state:<nonce>` holds between `/social/connect` and the callback. */
export interface OAuthState {
  platform: SocialPlatform;
  returnTo: string;
  createdAt: string;
  /** PKCE verifier (YouTube, TikTok). */
  verifier?: string;
  /** The publishing scopes were asked for too. */
  publish?: boolean;
  /** The auto-reply scopes were asked for too (Instagram). */
  replies?: boolean;
}

export const STATE_TTL_S = 600;
export const MAX_SNAPSHOTS = 400;
/** Posts kept per platform (newest by publishedAt); older ones fall out of the document. */
export const MAX_POSTS = 500;
/** KV metadata may hold 1024 bytes; rows above this go without the metadata copy. */
const META_MAX_BYTES = 1000;

export const keys = {
  tokens: (p: SocialPlatform) => `tokens:${p}`,
  status: (p: SocialPlatform) => `status:${p}`,
  snap: (p: SocialPlatform, day: string) => `snap:${p}:${day}`,
  snapPrefix: (p: SocialPlatform) => `snap:${p}:`,
  posts: (p: SocialPlatform) => `posts:${p}`,
  demo: (p: SocialPlatform, day: string) => `demo:${p}:${day}`,
  demoPrefix: (p: SocialPlatform) => `demo:${p}:`,
  state: (nonce: string) => `state:${nonce}`,
  publishJobs: "publish:jobs",
  replies: "replies:doc",
  repliesState: "replies:state",
  replyClicks: "replies:clicks",
};

async function readJson<T>(kv: KVNamespace, key: string): Promise<T | null> {
  const text = await kv.get(key, "text");
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/** Every key under `prefix` (all pages; KV returns at most 1000 per page). */
async function listAll<M>(kv: KVNamespace, prefix: string): Promise<KVNamespaceListKey<M>[]> {
  const out: KVNamespaceListKey<M>[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await kv.list<M>({ prefix, cursor, limit: 1000 });
    out.push(...page.keys);
    if (page.list_complete) return out;
    cursor = page.cursor;
    if (!cursor) return out;
  }
}

export class Store {
  constructor(
    private readonly kv: KVNamespace,
    private readonly secret: string,
  ) {}

  /** null when the KV binding or SCOUT_TOKEN is missing (the routes then answer `not_configured`). */
  static from(env: SocialEnv): Store | null {
    return env.SOCIAL_KV && env.SCOUT_TOKEN ? new Store(env.SOCIAL_KV, env.SCOUT_TOKEN) : null;
  }

  /* ---- tokens ---- */

  async getTokens(p: SocialPlatform): Promise<TokenSet | null> {
    const blob = await this.kv.get(keys.tokens(p), "text");
    if (!blob) return null;
    const t = await decryptJson<TokenSet>(this.secret, blob);
    return t && typeof t.accessToken === "string" ? t : null;
  }

  async putTokens(p: SocialPlatform, tokens: TokenSet): Promise<void> {
    await this.kv.put(keys.tokens(p), await encryptJson(this.secret, tokens));
  }

  async deleteTokens(p: SocialPlatform): Promise<void> {
    await this.kv.delete(keys.tokens(p));
  }

  /* ---- status ---- */

  getStatus(p: SocialPlatform): Promise<StoredStatus | null> {
    return readJson<StoredStatus>(this.kv, keys.status(p));
  }

  async putStatus(p: SocialPlatform, status: StoredStatus): Promise<void> {
    await this.kv.put(keys.status(p), JSON.stringify(status));
  }

  async deleteStatus(p: SocialPlatform): Promise<void> {
    await this.kv.delete(keys.status(p));
  }

  /* ---- OAuth state ---- */

  async putState(nonce: string, state: OAuthState): Promise<void> {
    await this.kv.put(keys.state(nonce), JSON.stringify(state), { expirationTtl: STATE_TTL_S });
  }

  /** Reads and deletes the state: a nonce is valid exactly once. */
  async takeState(nonce: string): Promise<OAuthState | null> {
    if (!nonce) return null;
    const state = await readJson<OAuthState>(this.kv, keys.state(nonce));
    if (state) await this.kv.delete(keys.state(nonce));
    return state;
  }

  /* ---- snapshots ---- */

  /** Writes the day's row and trims the platform to the newest MAX_SNAPSHOTS days. */
  async putSnapshot(row: SnapshotRow): Promise<void> {
    const text = JSON.stringify(row);
    const metadata = text.length <= META_MAX_BYTES ? row : undefined;
    await this.kv.put(keys.snap(row.platform, row.day), text, metadata ? { metadata } : undefined);
    const all = await listAll(this.kv, keys.snapPrefix(row.platform));
    // Day keys sort chronologically, so the oldest come first.
    const extra = all.length - MAX_SNAPSHOTS;
    for (let i = 0; i < extra; i++) await this.kv.delete(all[i].name);
  }

  /** Snapshot rows with day ≥ `since`, oldest first. */
  async listSnapshots(p: SocialPlatform, since: string): Promise<SnapshotRow[]> {
    const prefix = keys.snapPrefix(p);
    const all = await listAll<SnapshotRow>(this.kv, prefix);
    const rows: SnapshotRow[] = [];
    for (const k of all) {
      if (k.name.slice(prefix.length) < since) continue;
      const row = k.metadata ?? (await readJson<SnapshotRow>(this.kv, k.name));
      if (row) rows.push(row);
    }
    return rows;
  }

  /* ---- posts ---- */

  async getPosts(p: SocialPlatform): Promise<Record<string, PostRow>> {
    return (await readJson<Record<string, PostRow>>(this.kv, keys.posts(p))) ?? {};
  }

  /**
   * Merges freshly pulled rows over the stored ones (a fresh row wins field by field, so counts a platform
   * did not return this time — per-media insights past the budget — keep their last value) and keeps the
   * newest MAX_POSTS.
   */
  async mergePosts(
    p: SocialPlatform,
    existing: Record<string, PostRow>,
    fresh: PostRow[],
  ): Promise<Record<string, PostRow>> {
    const merged: Record<string, PostRow> = { ...existing };
    for (const row of fresh) merged[row.postId] = { ...existing[row.postId], ...row };
    const kept = Object.values(merged)
      .sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1))
      .slice(0, MAX_POSTS);
    const doc: Record<string, PostRow> = {};
    for (const row of kept) doc[row.postId] = row;
    await this.kv.put(keys.posts(p), JSON.stringify(doc));
    return doc;
  }

  /* ---- demographics ---- */

  async putDemographics(p: SocialPlatform, day: string, rows: DemographicRow[]): Promise<void> {
    if (!rows.length) return;
    await this.kv.put(keys.demo(p, day), JSON.stringify(rows));
  }

  /** The most recent stored breakdown with day ≥ `since` (one day per platform), else []. */
  async latestDemographics(p: SocialPlatform, since: string): Promise<DemographicRow[]> {
    const prefix = keys.demoPrefix(p);
    const all = await listAll(this.kv, prefix);
    const latest = all
      .map((k) => k.name)
      .filter((n) => n.slice(prefix.length) >= since)
      .at(-1);
    if (!latest) return [];
    return (await readJson<DemographicRow[]>(this.kv, latest)) ?? [];
  }

  /* ---- auto-post queue ---- */

  /** The whole queue (jobId → job); kept as one document so a cron tick costs one read. */
  async getJobs<J>(): Promise<Record<string, J>> {
    return (await readJson<Record<string, J>>(this.kv, keys.publishJobs)) ?? {};
  }

  async putJobs<J>(jobs: Record<string, J>): Promise<void> {
    await this.kv.put(keys.publishJobs, JSON.stringify(jobs));
  }

  /* ---- auto-replies (replies.ts): three documents, one per writer ---- */

  /** The owner's automations (written by the dashboard routes). */
  async getReplies<D>(): Promise<D | null> {
    return readJson<D>(this.kv, keys.replies);
  }

  async putReplies<D>(doc: D): Promise<void> {
    await this.kv.put(keys.replies, JSON.stringify(doc));
  }

  /** What the poller learned (written by the poll only). */
  async getRepliesState<D>(): Promise<D | null> {
    return readJson<D>(this.kv, keys.repliesState);
  }

  async putRepliesState<D>(doc: D): Promise<void> {
    await this.kv.put(keys.repliesState, JSON.stringify(doc));
  }

  /** Taps on the /go links (written by /go only). */
  async getReplyClicks<D>(): Promise<D | null> {
    return readJson<D>(this.kv, keys.replyClicks);
  }

  async putReplyClicks<D>(doc: D): Promise<void> {
    await this.kv.put(keys.replyClicks, JSON.stringify(doc));
  }

  /* ---- disconnect ---- */

  /** Forgets tokens and status; snapshots, posts and demographics stay. */
  async forget(p: SocialPlatform): Promise<void> {
    await this.deleteTokens(p);
    await this.deleteStatus(p);
  }
}

/** The default `since` of `GET /social/data`: 400 days before today (Riyadh). */
export function defaultSince(now: Date): string {
  return addDays(riyadhDay(now), -MAX_SNAPSHOTS);
}
