"use client";

import { create } from "zustand";
import {
  emptyList,
  inboxScopeV2,
  mergeFailure,
  mergePages,
  threadsAccount,
  threadsPosts,
  threadsReplies,
  workerOrigin,
  youtubeAccount,
  youtubeReplies,
  youtubeThreads,
  youtubeVideos,
  type CommentProvider,
  type InboxErrorCode,
  type InboxList,
  type InboxProvider,
  type InboxScopeKindV2,
  type PageResult,
  type ThreadsAccount,
  type ThreadsPost,
  type YouTubeAccount,
  type YouTubeChannel,
  type YouTubeThread,
  type YouTubeVideo,
} from "@/lib/inbox";
import { scoutConfig, type ScoutConfig } from "@/lib/scoutClient";
import { useStore } from "@/store";

/**
 * 📥 Threads and YouTube comment pages for the Inbox (packet DT-6B-1), in memory only like useInbox (never persisted,
 * never in the app store's `pick()`, never exported). Instagram stays in useInbox, untouched; this store holds the
 * provider selector and the two comment providers.
 *
 * Fences as DT-6A, qualified by provider: every read captures the connection epoch, Worker origin, provider, account
 * id, generation and the selection it was for, and lands only while it is still its list's current session
 * (`busy[key] === token`). Switching provider starts new sessions for every list (`busy` cleared), so a page asked for
 * on an earlier visit never lands in a later one (Threads → YouTube → Threads); DT-6B-1-R1 adds the same for every
 * target move (post, video, channel, back to null), a provider-visit token for account/open/refresh continuations,
 * and Refresh ending the refreshed video's loaded reply lists; DT-6B-1-R2 lets a newer read of a list (first page,
 * next page or Refresh) supersede one still pending, so an accepted Refresh is never skipped. Lists and draft scopes
 * are keyed by `inboxScopeV2` (provider + origin + account id + kind + id), so identical ids on two providers never
 * meet.
 */

export type ThreadsList = "posts" | "replies";
export type YouTubeList = "videos" | "threads" | "replies";
type ListKind = ThreadsList | YouTubeList;

export interface ProviderInboxState {
  provider: InboxProvider;
  origin: string | null;
  threads: ThreadsAccount | null;
  youtube: YouTubeAccount | null;
  /** The YouTube channel the owner picked (by id; with exactly one channel, that one). */
  channelId: string | null;
  accountError: Partial<Record<CommentProvider, InboxErrorCode>>;
  accountBusy: Partial<Record<CommentProvider, boolean>>;
  postId: string | null;
  videoId: string | null;
  lists: Record<string, InboxList<unknown>>;
  busy: Record<string, number>;
}

const IDLE: Omit<ProviderInboxState, "provider"> = {
  origin: null,
  threads: null,
  youtube: null,
  channelId: null,
  accountError: {},
  accountBusy: {},
  postId: null,
  videoId: null,
  lists: {},
  busy: {},
};

export const useProviderInbox = create<ProviderInboxState>()(() => ({
  provider: "instagram",
  ...IDLE,
}));

const accountSeq: Record<CommentProvider, number> = { threads: 0, youtube: 0 };
let requestSeq = 0;
/** The private connection epoch (Worker URL or token changed), as in useInbox. Memory only. */
let epoch = 0;
/**
 * The provider visit (DT-6B-1-R1 B1-6): bumped on every provider switch. An account answer, open or refresh
 * continuation started in an earlier visit stops there (no hidden read after the owner left).
 */
let visit = 0;

/** Clears every fetched page and account; the provider choice stays. */
export function resetProviderInbox(): void {
  accountSeq.threads += 1;
  accountSeq.youtube += 1;
  useProviderInbox.setState((s) => ({ provider: s.provider, ...IDLE }), true);
}

useStore.subscribe((s, prev) => {
  const k = s.settings.apiKeys;
  const was = prev.settings.apiKeys;
  if (k.scoutUrl === was.scoutUrl && k.scoutToken === was.scoutToken) return;
  epoch += 1;
  resetProviderInbox();
});

function currentConfig(): ScoutConfig | null {
  const k = useStore.getState().settings.apiKeys;
  return scoutConfig(k.scoutUrl, k.scoutToken);
}

/** The selected YouTube channel, when the owner picked one that the account answer still lists. */
export function selectedChannel(s = useProviderInbox.getState()): YouTubeChannel | null {
  return s.youtube?.channels.find((c) => c.accountId === s.channelId) ?? null;
}

/** The account a provider's reads go to (Threads: /me; YouTube: the picked channel). */
function identity(
  s: ProviderInboxState,
  p: CommentProvider,
): { accountId: string; generation: string } | null {
  const a = p === "threads" ? s.threads : selectedChannel(s);
  return a ? { accountId: a.accountId, generation: a.generation } : null;
}

const keyOf = (
  s: ProviderInboxState,
  p: CommentProvider,
  kind: InboxScopeKindV2,
  id = "",
): string => inboxScopeV2(p, s.origin ?? "", identity(s, p)?.accountId ?? "", kind, id);

/** A list for the provider's current account (empty until read). */
export function providerList<T = unknown>(
  p: CommentProvider,
  kind: ListKind,
  id = "",
): InboxList<T> {
  const s = useProviderInbox.getState();
  return (s.lists[keyOf(s, p, kind, id)] as InboxList<T> | undefined) ?? emptyList<T>();
}

/** Where a draft for one Threads reply or YouTube comment lives (v2 provider scope). */
export function providerDraftScope(p: CommentProvider, id: string): string {
  return keyOf(useProviderInbox.getState(), p, "comment", id);
}

const selectionOf = (s: ProviderInboxState, p: CommentProvider, kind: ListKind): string | null =>
  p === "threads"
    ? kind === "replies"
      ? s.postId
      : null
    : kind === "threads" || kind === "replies"
      ? s.videoId
      : null;

const capable = (s: ProviderInboxState, p: CommentProvider, kind: ListKind): boolean =>
  p === "threads"
    ? kind === "posts" || s.threads?.capabilities.replies === "ok"
    : kind === "videos" || s.youtube?.capabilities.comments === "ok";

/** Drops every list and session of one provider (another account or a reconnect). */
const withoutProvider = <T>(rec: Record<string, T>, p: CommentProvider) =>
  Object.fromEntries(Object.entries(rec).filter(([k]) => !k.startsWith(`v2|${p}|`)));

/**
 * Ends the in-flight sessions of some of a provider's lists (DT-6B-1-R1 B1-5): a late answer then neither lands, nor
 * blocks the next visit's request, nor releases it. Keys are `v2|provider|origin|account|kind|id` with every part
 * URI-encoded, so "|" only separates. Completed rows stay.
 */
const endSessions = (busy: Record<string, number>, p: CommentProvider, kinds: ListKind[]) =>
  Object.fromEntries(
    Object.entries(busy).filter(
      ([k]) => !(k.startsWith(`v2|${p}|`) && kinds.includes(k.split("|")[4] as ListKind)),
    ),
  );

const omit = <T>(rec: Record<string, T>, keys: Set<string>) =>
  Object.fromEntries(Object.entries(rec).filter(([k]) => !keys.has(k)));

async function loadAccount(p: CommentProvider): Promise<boolean> {
  const cfg = currentConfig();
  const origin = workerOrigin(cfg);
  if (!cfg || !origin) {
    useProviderInbox.setState(
      (s) => ({ provider: s.provider, ...IDLE, accountError: { [p]: "unconfigured" } }),
      true,
    );
    return false;
  }
  if (useProviderInbox.getState().origin !== origin)
    useProviderInbox.setState((s) => ({ provider: s.provider, ...IDLE, origin }), true);
  const seq = ++accountSeq[p];
  const at = epoch;
  const v = visit;
  useProviderInbox.setState((s) => ({ accountBusy: { ...s.accountBusy, [p]: true } }));
  const r = p === "threads" ? await threadsAccount(cfg) : await youtubeAccount(cfg);
  const now = useProviderInbox.getState();
  if (seq !== accountSeq[p] || at !== epoch || now.origin !== origin || v !== visit) return false;
  if (!r.ok) {
    useProviderInbox.setState((s) => ({
      accountBusy: { ...s.accountBusy, [p]: false },
      accountError: { ...s.accountError, [p]: r.error.code },
    }));
    return false;
  }
  const before = identity(now, p);
  if (p === "threads") {
    const next = r.account as ThreadsAccount;
    const same = before?.accountId === next.accountId && before.generation === next.generation;
    useProviderInbox.setState((s) => ({
      threads: next,
      accountBusy: { ...s.accountBusy, threads: false },
      accountError: { ...s.accountError, threads: undefined },
      ...(same
        ? {}
        : { lists: withoutProvider(s.lists, p), busy: withoutProvider(s.busy, p), postId: null }),
    }));
    return true;
  }
  const next = r.account as YouTubeAccount;
  // Keep the pick only while the same channel (same generation) is still listed; one channel is picked by itself,
  // several wait for the owner (never the first by default).
  const kept = next.channels.find(
    (c) => c.accountId === before?.accountId && c.generation === before.generation,
  );
  const channelId =
    kept?.accountId ??
    (!next.needsSelection && next.channels.length === 1 ? next.channels[0].accountId : null);
  useProviderInbox.setState((s) => ({
    youtube: next,
    channelId,
    accountBusy: { ...s.accountBusy, youtube: false },
    accountError: { ...s.accountError, youtube: undefined },
    ...(kept
      ? {}
      : { lists: withoutProvider(s.lists, p), busy: withoutProvider(s.busy, p), videoId: null }),
  }));
  return true;
}

const refIn = <T extends { id: string; ref: string }>(list: InboxList<T>, id: string | null) =>
  list.items.find((x) => x.id === id)?.ref;

/**
 * One page into a list, behind the provider-qualified fence; no cursor = the first page (replaces the list). The newest
 * read of a list wins: busy follows it, and an earlier pending read of the same list never lands.
 */
async function loadList(
  p: CommentProvider,
  kind: ListKind,
  id: string | undefined,
  cursor?: string,
): Promise<void> {
  const cfg = currentConfig();
  const s = useProviderInbox.getState();
  const acc = identity(s, p);
  if (!cfg || !acc || !capable(s, p, kind)) return;
  const key = keyOf(s, p, kind, id ?? "");
  // DT-6B-1-R2 (supersede): a new read of a list with one still in flight takes a new session token at once; the older
  // request is orphaned (its answer or error fails the `busy[key] === token` fence, its release is a no-op).
  const fence = {
    epoch,
    origin: s.origin,
    accountId: acc.accountId,
    generation: acc.generation,
    selection: selectionOf(s, p, kind),
  };
  let call: () => Promise<PageResult<{ id: string }>>;
  if (p === "threads") {
    if (kind === "posts") call = () => threadsPosts(cfg, acc, cursor);
    else {
      const ref = refIn(providerList<ThreadsPost>(p, "posts"), s.postId);
      if (!ref || id !== s.postId) return;
      call = () => threadsReplies(cfg, acc, ref, cursor);
    }
  } else if (kind === "videos") {
    const ch = selectedChannel(s);
    if (!ch?.uploads) return;
    call = () => youtubeVideos(cfg, ch, cursor);
  } else if (kind === "threads") {
    const ref = refIn(providerList<YouTubeVideo>(p, "videos"), s.videoId);
    if (!ref || id !== s.videoId) return;
    call = () => youtubeThreads(cfg, acc, ref, cursor);
  } else {
    const ref = refIn(providerList<YouTubeThread>(p, "threads", s.videoId ?? ""), id ?? null);
    if (!ref) return;
    call = () => youtubeReplies(cfg, acc, ref, cursor);
  }
  const token = ++requestSeq;
  useProviderInbox.setState((x) => ({ busy: { ...x.busy, [key]: token } }));
  const r = await call();
  const release = (x: ProviderInboxState) =>
    x.busy[key] === token ? { ...x.busy, [key]: 0 } : x.busy;
  const now = useProviderInbox.getState();
  const nowAcc = identity(now, p);
  const current =
    now.busy[key] === token &&
    epoch === fence.epoch &&
    now.origin === fence.origin &&
    nowAcc?.accountId === fence.accountId &&
    nowAcc.generation === fence.generation &&
    selectionOf(now, p, kind) === fence.selection;
  if (!current) {
    useProviderInbox.setState((x) => ({ busy: release(x) }));
    return;
  }
  let list = (now.lists[key] as InboxList<{ id: string }> | undefined) ?? emptyList();
  // YouTube replies start from the replies the thread embedded, so overlapping ids appear once (first copy wins).
  if (p === "youtube" && kind === "replies" && cursor === undefined) {
    const t = providerList<YouTubeThread>(p, "threads", now.videoId ?? "").items.find(
      (x) => x.id === id,
    );
    list = { ...emptyList(), items: t?.replies ?? [] };
  }
  const replace = cursor === undefined && !(p === "youtube" && kind === "replies");
  const next = r.ok ? mergePages(list, r.page, replace) : mergeFailure(list, r.error);
  useProviderInbox.setState((x) => ({ lists: { ...x.lists, [key]: next }, busy: release(x) }));
}

/** The list a provider shows first (YouTube: only once a channel is picked). */
const firstList = (p: CommentProvider): ListKind => (p === "threads" ? "posts" : "videos");

/** Opening a provider: its account, then its first list once (only while the owner is still on this visit). */
export async function openProvider(p: CommentProvider): Promise<void> {
  const v = visit;
  if (!(await loadAccount(p)) || v !== visit) return;
  if (providerList(p, firstList(p)).coverage === null) await loadList(p, firstList(p), undefined);
}

/**
 * Refresh: the account again, then the first page of what is on screen. Refreshing a video's threads also ends its
 * loaded reply lists and their in-flight sessions (DT-6B-1-R1 B1-7): the fresh embedded replies show, and the rest
 * load again only on Load replies (no reply fan-out). Drafts are not touched.
 */
export async function refreshProvider(p: CommentProvider): Promise<void> {
  const v = visit;
  if (!(await loadAccount(p)) || v !== visit) return;
  const s = useProviderInbox.getState();
  const jobs = [loadList(p, firstList(p), undefined)];
  if (p === "threads" && s.postId) jobs.push(loadList(p, "replies", s.postId));
  if (p === "youtube" && s.videoId) {
    const stale = new Set(
      providerList<YouTubeThread>(p, "threads", s.videoId).items.map((t) =>
        keyOf(s, p, "replies", t.id),
      ),
    );
    useProviderInbox.setState((x) => ({ lists: omit(x.lists, stale), busy: omit(x.busy, stale) }));
    jobs.push(loadList(p, "threads", s.videoId));
  }
  await Promise.all(jobs);
}

/**
 * The provider selector. A switch is a new visit: every list session and account wait of the earlier visit ends, and
 * a provider opens on its first visit. Back on a provider, a selected post / video whose rows never landed goes back to
 * the first list (DT-6B-1-R1 B1-6), so the owner never faces an empty view nobody is reading; nothing old is revived.
 */
export async function setInboxProvider(p: InboxProvider): Promise<void> {
  visit += 1;
  useProviderInbox.setState({ provider: p, busy: {}, accountBusy: {} });
  if (p === "instagram") return;
  const s = useProviderInbox.getState();
  if (p === "threads" ? !s.threads : !s.youtube) return openProvider(p);
  if (p === "threads" && s.postId && providerList(p, "replies", s.postId).coverage === null)
    useProviderInbox.setState({ postId: null });
  if (p === "youtube" && s.videoId && providerList(p, "threads", s.videoId).coverage === null)
    useProviderInbox.setState({ videoId: null });
  if (providerList(p, firstList(p)).coverage === null) await loadList(p, firstList(p), undefined);
}

/**
 * Picks a YouTube channel by id (only one the account answer listed) and reads its uploads once. Another channel is
 * a new visit (B1-5): every YouTube session of the earlier one ends.
 */
export async function selectChannel(id: string | null): Promise<void> {
  const s = useProviderInbox.getState();
  if (id !== null && !s.youtube?.channels.some((c) => c.accountId === id)) return;
  if (id !== s.channelId)
    useProviderInbox.setState((x) => ({
      channelId: id,
      videoId: null,
      busy: withoutProvider(x.busy, "youtube"),
    }));
  if (id && providerList("youtube", "videos").coverage === null)
    await loadList("youtube", "videos", undefined);
}

/**
 * Opening a Threads post reads its replies once (until Refresh); null goes back to the posts. Every move to another
 * target (null included) ends the earlier target's reply session (B1-5).
 */
export async function selectPost(id: string | null): Promise<void> {
  if (id !== useProviderInbox.getState().postId)
    useProviderInbox.setState((x) => ({
      postId: id,
      busy: endSessions(x.busy, "threads", ["replies"]),
    }));
  if (id && providerList("threads", "replies", id).coverage === null)
    await loadList("threads", "replies", id);
}

/**
 * Opening a YouTube video reads its comment threads once (until Refresh); null goes back to the videos. Every move to
 * another target (null included) ends the earlier video's thread and reply sessions (B1-5).
 */
export async function selectVideo(id: string | null): Promise<void> {
  if (id !== useProviderInbox.getState().videoId)
    useProviderInbox.setState((x) => ({
      videoId: id,
      busy: endSessions(x.busy, "youtube", ["threads", "replies"]),
    }));
  if (id && providerList("youtube", "threads", id).coverage === null)
    await loadList("youtube", "threads", id);
}

/** "Load replies" on one YouTube thread: the first page, then each next page, only when asked. */
export async function loadReplies(commentId: string): Promise<void> {
  const list = providerList("youtube", "replies", commentId);
  // Never read, or its first page failed (no cursor yet): the first page again, by hand.
  if (list.coverage === null || (!list.next && list.error))
    await loadList("youtube", "replies", commentId);
  else if (list.next) await loadList("youtube", "replies", commentId, list.next);
}

/** Load more: the next sealed cursor of a provider list, when it has one. */
export async function loadMoreProvider(p: CommentProvider, kind: ListKind): Promise<void> {
  const s = useProviderInbox.getState();
  const id = selectionOf(s, p, kind) ?? undefined;
  const list = providerList(p, kind, id);
  if (list.next) await loadList(p, kind, id, list.next);
}
