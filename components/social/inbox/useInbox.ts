"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type {
  InboxComment,
  InboxConversation,
  InboxMessage,
  InboxOverview,
  InboxPlatform,
  InboxPost,
} from "@/lib/domain";
import {
  INBOX_POLL_MS,
  inboxComments,
  inboxConversations,
  inboxOverview,
  inboxPosts,
  inboxRefresh,
  inboxThread,
  seenKey,
  unreadCount,
  type InboxError,
  type InboxResult,
} from "@/lib/inbox";
import { scoutConfig, type ScoutConfig } from "@/lib/scoutClient";
import { useStore } from "@/store";

/**
 * The global inbox as the Worker keeps it (`/social/inbox/*`, planning/tools/51-global-inbox.md), held at module
 * level like `useReplies` so the Inbox page and the Studio's row share one copy and one read at a time. Read only:
 * the one write here is Refresh. Nothing is persisted but the seen marks (`inboxSeen` in the store).
 */

export interface InboxState {
  overview: InboxOverview | null;
  conversations: InboxConversation[];
  posts: InboxPost[];
  moreConversations: boolean;
  morePosts: boolean;
  loadedAt: number | null;
  busy: boolean;
  error: InboxError | null;
}

/** Refresh asks the reader to scan now; its tick lands about this long after. */
const REFRESH_WAIT_MS = 3_000;
/** Past this many seen marks, a load drops the marks of items it no longer lists. */
const SEEN_CAP = 500;
/** A webhook's conversation id before the reader learns the real thread id: "peer:" + the sender's id. */
const PROVISIONAL = "peer:";
/** Kept by a first read that found nothing, so the next read is not taken for the first one. */
const FIRST_READ_KEY = "inbox:firstRead";

const IDLE: InboxState = {
  overview: null,
  conversations: [],
  posts: [],
  moreConversations: false,
  morePosts: false,
  loadedAt: null,
  busy: false,
  error: null,
};
let state: InboxState = IDLE;
const listeners = new Set<() => void>();
/** The Worker's cursors for the next older page (never built here). */
let next: { conversations: string | null; posts: string | null } = {
  conversations: null,
  posts: null,
};
/** An older page was loaded: a reload merges the first page in instead of dropping the rest. */
let extended = { conversations: false, posts: false };
let inflight: Promise<void> | null = null;

function set(patch: Partial<InboxState>): void {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const getState = () => state;
const getServerState = () => IDLE;

function currentConfig(): ScoutConfig | null {
  const k = useStore.getState().settings.apiKeys;
  return scoutConfig(k.scoutUrl, k.scoutToken);
}

const fail = (error: InboxError) => set({ busy: false, error });
const newestFirst = (a: string, b: string) => (a < b ? 1 : a > b ? -1 : 0);

const provisional = (c: InboxConversation) => c.id.startsWith(PROVISIONAL);

/**
 * One row per person: a webhook's provisional `peer:` conversation and the real one merge, the newest wins
 * (the real one on a tie).
 */
function byPeer(list: InboxConversation[]): InboxConversation[] {
  const best = new Map<string, InboxConversation>();
  for (const c of list) {
    const k = `${c.platform}:${c.peerId}`;
    const had = best.get(k);
    const tieGoesReal = had?.updatedAt === c.updatedAt && provisional(had) && !provisional(c);
    if (!had || c.updatedAt > had.updatedAt || tieGoesReal) best.set(k, c);
  }
  return [...best.values()].sort((a, b) => newestFirst(a.updatedAt, b.updatedAt));
}

function byPost(list: InboxPost[]): InboxPost[] {
  const seen = new Map<string, InboxPost>();
  for (const p of list)
    if (!seen.has(`${p.platform}:${p.id}`)) seen.set(`${p.platform}:${p.id}`, p);
  return [...seen.values()].sort((a, b) => newestFirst(a.postedAt, b.postedAt));
}

/** A conversation's seen mark and the time it is compared with. */
export const conversationSeen = (c: InboxConversation) => ({
  key: seenKey(c.platform, "conversation", c.id),
  at: c.updatedAt,
});
/** A post's seen mark: a post is new until it is opened. */
export const postSeen = (p: InboxPost) => ({
  key: seenKey(p.platform, "post", p.id),
  at: p.postedAt,
});
/** The provisional `peer:` key of a conversation's person. */
const provisionalKey = (c: InboxConversation) =>
  seenKey(c.platform, "conversation", PROVISIONAL + c.peerId);
export const isUnread = (item: { key: string; at: string }, seen: Record<string, string>) =>
  unreadCount([item], seen) > 0;
/** Unread unless opened since its last message, under its own id or as the person's provisional row. */
export function conversationUnread(c: InboxConversation, seen: Record<string, string>): boolean {
  const { key, at } = conversationSeen(c);
  const mark = [seen[key], seen[provisionalKey(c)]].filter(Boolean).sort().pop();
  return isUnread({ key, at }, mark ? { [key]: mark } : {});
}
/** Unread conversations plus new posts: the Studio row's number. */
export const inboxUnread = (
  s: Pick<InboxState, "conversations" | "posts">,
  seen: Record<string, string>,
) =>
  s.conversations.filter((c) => conversationUnread(c, seen)).length +
  unreadCount(s.posts.map(postSeen), seen);

/**
 * Seen marks a load writes before anything is shown: on the very first read everything already there is
 * history, not news; afterwards a real conversation inherits the mark its provisional row got.
 */
function markLoaded(conversations: InboxConversation[], posts: InboxPost[]): void {
  const store = useStore.getState();
  const seen = store.inboxSeen;
  if (Object.keys(seen).length === 0) {
    const items = [...conversations.map(conversationSeen), ...posts.map(postSeen)];
    for (const { key, at } of items) store.markInboxSeen(key, at);
    if (items.length === 0) store.markInboxSeen(FIRST_READ_KEY, new Date().toISOString());
    return;
  }
  for (const c of conversations) {
    const mark = seen[provisionalKey(c)];
    if (mark && !provisional(c)) store.markInboxSeen(conversationSeen(c).key, mark);
  }
}

/**
 * Overview + the first page of conversations and of posts (3 reads); concurrent callers share them. `quiet`
 * (the poll, the Studio) shows no busy state.
 */
export function loadInbox({ quiet = false }: { quiet?: boolean } = {}): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    const cfg = currentConfig();
    if (!cfg) return;
    if (!quiet) set({ busy: true });
    const [o, c, p] = await Promise.all([
      inboxOverview(cfg),
      inboxConversations(cfg, {}),
      inboxPosts(cfg, {}),
    ]);
    if (!o.ok) return fail(o.error);
    if (!c.ok) return fail(c.error);
    if (!p.ok) return fail(p.error);
    const conversations = byPeer(
      extended.conversations ? [...c.conversations, ...state.conversations] : c.conversations,
    );
    const posts = byPost(extended.posts ? [...p.posts, ...state.posts] : p.posts);
    if (!extended.conversations) next.conversations = c.next;
    if (!extended.posts) next.posts = p.next;
    markLoaded(conversations, posts);
    set({
      overview: o.overview,
      conversations,
      posts,
      moreConversations: extended.conversations ? state.moreConversations : c.more && !!c.next,
      morePosts: extended.posts ? state.morePosts : p.more && !!p.next,
      loadedAt: Date.now(),
      busy: false,
      error: null,
    });
    const store = useStore.getState();
    if (Object.keys(store.inboxSeen).length > SEEN_CAP)
      store.pruneInboxSeen(
        [...conversations.map(conversationSeen), ...posts.map(postSeen)].map((i) => i.key),
      );
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

export async function loadMoreConversations(): Promise<void> {
  const cfg = currentConfig();
  const before = next.conversations;
  if (!cfg || !before || state.busy) return;
  set({ busy: true, error: null });
  const r = await inboxConversations(cfg, { before });
  if (!r.ok) return fail(r.error);
  extended.conversations = true;
  next.conversations = r.next;
  set({
    conversations: byPeer([...state.conversations, ...r.conversations]),
    moreConversations: r.more && !!r.next,
    busy: false,
  });
}

export async function loadMorePosts(): Promise<void> {
  const cfg = currentConfig();
  const before = next.posts;
  if (!cfg || !before || state.busy) return;
  set({ busy: true, error: null });
  const r = await inboxPosts(cfg, { before });
  if (!r.ok) return fail(r.error);
  extended.posts = true;
  next.posts = r.next;
  set({ posts: byPost([...state.posts, ...r.posts]), morePosts: r.more && !!r.next, busy: false });
}

/** "Refresh now": asks the reader to scan on its next tick, then reads the inbox once it has. */
export async function refreshInbox(): Promise<void> {
  const cfg = currentConfig();
  if (!cfg) return;
  set({ busy: true, error: null });
  const r = await inboxRefresh(cfg);
  if (!r.ok) return fail(r.error);
  await new Promise((resolve) => setTimeout(resolve, REFRESH_WAIT_MS));
  await loadInbox();
  set({ busy: false }); // a quiet poll may have been the read it joined
}

/** Drops everything loaded (tests; the Settings wipe). */
export function resetInbox(): void {
  state = IDLE;
  next = { conversations: null, posts: null };
  extended = { conversations: false, posts: false };
  inflight = null;
  listeners.forEach((l) => l());
}

/** The inbox for a screen; it reads nothing by itself (the page loads, the Studio loads quietly). */
export function useInbox(): InboxState & { configured: boolean } {
  const configured = useStore(
    (s) => scoutConfig(s.settings.apiKeys.scoutUrl, s.settings.apiKeys.scoutToken) !== null,
  );
  const s = useSyncExternalStore(subscribe, getState, getServerState);
  return { ...s, configured };
}

/**
 * Reads again every INBOX_POLL_MS while the page is visible: hidden, the timer stops; back in view, one read
 * at once and a fresh timer from there.
 */
export function useInboxPoll(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    let id = 0;
    const read = () => {
      if (document.visibilityState === "visible") void loadInbox({ quiet: true });
    };
    const start = () => {
      if (document.visibilityState === "visible") id = window.setInterval(read, INBOX_POLL_MS);
    };
    const onVisibility = () => {
      window.clearInterval(id);
      read();
      start();
    };
    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled]);
}

/* ---------- one conversation, one post's comments ---------- */

type Page = { more: boolean; next: string | null };
export type ThreadData = {
  conversation: InboxConversation;
  /** Newest first, as the Worker answers; the view turns them around. */
  messages: InboxMessage[];
  window: { open: boolean; closesAt: string | null };
} & Page;
export type CommentsData = { post: InboxPost; comments: InboxComment[] } & Page;

interface Paged<T> {
  data: T | null;
  busy: boolean;
  error: InboxError | null;
  reload(): void;
  /** The next older page, appended (the Worker's `next` as `before`). */
  loadMore(): void;
}

/**
 * One remote item read a page at a time: `base` names it (null: nothing open), a new `version` reads it again
 * (keeping what is shown meanwhile), `older` appends the next page.
 */
function usePaged<T extends Page>(
  base: string | null,
  version: string,
  fetchPage: (before?: string) => Promise<InboxResult<T>>,
  older: (have: T, page: T) => T,
): Paged<T> {
  const [nonce, setNonce] = useState(0);
  const [got, setGot] = useState<{
    base: string;
    want: string;
    data: T | null;
    error: InboxError | null;
  } | null>(null);
  const [moreBusy, setMoreBusy] = useState(false);
  const want = base === null ? null : `${base}#${version}#${nonce}`;

  useEffect(() => {
    if (base === null || want === null) return;
    let live = true;
    void fetchPage().then((r) => {
      if (!live) return;
      setGot((g) => ({
        base,
        want,
        data: r.ok ? r : g?.base === base ? g.data : null,
        error: r.ok ? null : r.error,
      }));
    });
    return () => {
      live = false;
    };
  }, [base, want, fetchPage]);

  const mine = got && got.base === base ? got : null;
  const data = mine?.data ?? null;
  const loadMore = () => {
    if (!data?.next || moreBusy) return;
    setMoreBusy(true);
    void fetchPage(data.next).then((r) => {
      setMoreBusy(false);
      setGot((g) =>
        g && g.data === data
          ? r.ok
            ? { ...g, data: older(data, r), error: null }
            : { ...g, error: r.error }
          : g,
      );
    });
  };
  return {
    data,
    busy: (want !== null && mine?.want !== want) || moreBusy,
    error: mine?.error ?? null,
    reload: useCallback(() => setNonce((n) => n + 1), []),
    loadMore,
  };
}

const olderMessages = (have: ThreadData, page: ThreadData): ThreadData => ({
  ...have,
  messages: [...have.messages, ...page.messages],
  more: page.more,
  next: page.next,
});
const olderComments = (have: CommentsData, page: CommentsData): CommentsData => ({
  ...have,
  comments: [...have.comments, ...page.comments],
  more: page.more,
  next: page.next,
});

/** One conversation's messages; a new `version` (the row's `updatedAt` moved) reads it again. */
export function useThread(
  id: string | null,
  version = "",
): Omit<Paged<ThreadData>, "data"> & { thread: ThreadData | null } {
  const fetchPage = useCallback(
    (before?: string) => inboxThread(currentConfig(), id ?? "", { before }),
    [id],
  );
  const { data, ...rest } = usePaged(id, version, fetchPage, olderMessages);
  return { thread: data, ...rest };
}

/** One post's comments, newest first. */
export function useComments(
  platform: InboxPlatform | null,
  postId: string | null,
): Paged<CommentsData> {
  const fetchPage = useCallback(
    (before?: string) =>
      inboxComments(currentConfig(), platform ?? "instagram", postId ?? "", { before }),
    [platform, postId],
  );
  return usePaged(
    platform && postId ? `${platform}:${postId}` : null,
    "",
    fetchPage,
    olderComments,
  );
}
