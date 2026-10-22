"use client";

import { create } from "zustand";
import {
  emptyList,
  inboxAccount,
  inboxComments,
  inboxConversations,
  inboxMedia,
  inboxMessages,
  inboxScope,
  mergeFailure,
  mergePages,
  workerOrigin,
  type InboxAccount,
  type InboxErrorCode,
  type InboxList,
  type InboxScopeKind,
  type PageResult,
} from "@/lib/inbox";
import { scoutConfig, type ScoutConfig } from "@/lib/scoutClient";
import { useStore } from "@/store";

/**
 * 📥 The inbox's fetched pages (packet DT-6A), in memory only: a plain zustand store, never persisted, never in the
 * app store's `pick()`, never exported. Reads happen on open, Refresh and Load more (no polling, no retry by itself).
 *
 * Every page request captures a fence — connection epoch, Worker origin, account id, generation and the selection it
 * was for — and a result is dropped when any of them moved meanwhile (another Worker URL or token, a reconnect or
 * another account, another conversation or post). DT-6A-R1: a result is also accepted only while its request is still
 * its list's current session (`busy[key] === token`), so a request a reset or a newer read superseded stays dead even
 * when the identity comes back (Worker A → B → A). Lists are keyed by `inboxScope`, so a handle rename keeps them.
 */

export type InboxTab = "messages" | "comments";
type ListKind = "conversations" | "messages" | "media" | "comments";

export interface InboxState {
  origin: string | null;
  account: InboxAccount | null;
  accountError: InboxErrorCode | null;
  accountBusy: boolean;
  tab: InboxTab;
  conversationId: string | null;
  mediaId: string | null;
  lists: Record<string, InboxList<unknown>>;
  /** The request token in flight per list, i.e. the list's current session (0 / absent: idle). */
  busy: Record<string, number>;
}

const IDLE: InboxState = {
  origin: null,
  account: null,
  accountError: null,
  accountBusy: false,
  tab: "messages",
  conversationId: null,
  mediaId: null,
  lists: {},
  busy: {},
};

export const useInbox = create<InboxState>()(() => IDLE);

export function resetInbox(): void {
  accountSeq += 1;
  useInbox.setState(IDLE, true);
}

function currentConfig(): ScoutConfig | null {
  const k = useStore.getState().settings.apiKeys;
  return scoutConfig(k.scoutUrl, k.scoutToken);
}

const keyOf = (s: InboxState, kind: InboxScopeKind, id = ""): string =>
  inboxScope(s.origin ?? "", s.account?.accountId ?? "", kind, id);

/** A list for the current account (empty until read). */
export function listOf<T = unknown>(kind: ListKind, id = ""): InboxList<T> {
  const s = useInbox.getState();
  return (s.lists[keyOf(s, kind, id)] as InboxList<T> | undefined) ?? emptyList<T>();
}

/** Where a draft for this conversation or comment lives (Worker origin + account id + kind + id). */
export function draftScope(kind: "conversation" | "comment", id: string): string {
  return keyOf(useInbox.getState(), kind, id);
}

/** The selection a list belongs to: the conversation for messages, the post for comments, none for the rest. */
const selectionOf = (s: InboxState, kind: ListKind): string | null =>
  kind === "messages" ? s.conversationId : kind === "comments" ? s.mediaId : null;

let accountSeq = 0;
let requestSeq = 0;
/**
 * DT-6A-R1 (6A-3): the private connection epoch. It moves whenever the configured Worker URL or token changes, and the
 * view is cleared at once (no old account, list or selection stays on screen); every read started under an older
 * epoch is dropped. Memory only: never persisted and never part of a draft scope (those stay origin + account id +
 * kind + id), and the token itself is never kept here.
 */
let epoch = 0;
useStore.subscribe((s, prev) => {
  const k = s.settings.apiKeys;
  const was = prev.settings.apiKeys;
  if (k.scoutUrl === was.scoutUrl && k.scoutToken === was.scoutToken) return;
  epoch += 1;
  resetInbox();
});

/** `GET /social/inbox/account`; a new id or generation (reconnect, another account) starts the lists over. */
async function loadAccount(): Promise<boolean> {
  const cfg = currentConfig();
  const origin = workerOrigin(cfg);
  if (!cfg || !origin) {
    useInbox.setState({ ...IDLE, accountError: "unconfigured" }, true);
    return false;
  }
  if (useInbox.getState().origin !== origin) useInbox.setState({ ...IDLE, origin }, true);
  const seq = ++accountSeq;
  const at = epoch;
  useInbox.setState({ accountBusy: true });
  const r = await inboxAccount(cfg);
  if (seq !== accountSeq || at !== epoch || useInbox.getState().origin !== origin) return false;
  if (!r.ok) {
    useInbox.setState({ accountBusy: false, accountError: r.error.code });
    return false;
  }
  const before = useInbox.getState().account;
  const sameIdentity =
    before?.accountId === r.account.accountId && before.generation === r.account.generation;
  useInbox.setState({
    account: r.account,
    accountError: null,
    accountBusy: false,
    ...(sameIdentity ? {} : { lists: {}, busy: {}, conversationId: null, mediaId: null }),
  });
  return true;
}

/** One page into a list, behind the fence; `cursor` undefined = the first page (replaces the list). */
async function loadList(kind: ListKind, id: string | undefined, cursor?: string): Promise<void> {
  const cfg = currentConfig();
  const s = useInbox.getState();
  const acc = s.account;
  if (!cfg || !acc) return;
  // A surface the granted scopes already deny is not asked for (the screen shows the reconnect step instead).
  const surface = kind === "conversations" || kind === "messages" ? "messages" : "comments";
  if (acc.capabilities[surface] !== "ok") return;
  const key = keyOf(s, kind, id ?? "");
  if (s.busy[key]) return;
  const fence = {
    epoch,
    origin: s.origin,
    accountId: acc.accountId,
    generation: acc.generation,
    selection: selectionOf(s, kind),
  };
  const token = ++requestSeq;
  useInbox.setState((x) => ({ busy: { ...x.busy, [key]: token } }));
  let r: PageResult<{ id: string }>;
  if (kind === "conversations") r = await inboxConversations(cfg, acc, cursor);
  else if (kind === "media") r = await inboxMedia(cfg, acc, cursor);
  else if (kind === "messages") r = await inboxMessages(cfg, acc, id!, cursor);
  else r = await inboxComments(cfg, acc, id!, cursor);
  // Whatever happens next, this request stops holding the list (unless a newer one took it over).
  const release = (x: InboxState) => (x.busy[key] === token ? { ...x.busy, [key]: 0 } : x.busy);
  const now = useInbox.getState();
  const current =
    now.busy[key] === token &&
    epoch === fence.epoch &&
    now.origin === fence.origin &&
    now.account?.accountId === fence.accountId &&
    now.account?.generation === fence.generation &&
    selectionOf(now, kind) === fence.selection;
  if (!current) {
    useInbox.setState((x) => ({ busy: release(x) }));
    return;
  }
  const list = (now.lists[key] as InboxList<{ id: string }> | undefined) ?? emptyList();
  const next = r.ok ? mergePages(list, r.page, cursor === undefined) : mergeFailure(list, r.error);
  useInbox.setState((x) => ({
    lists: { ...x.lists, [key]: next },
    busy: release(x),
  }));
}

/** The list the open tab shows first. */
const tabList = (tab: InboxTab): ListKind => (tab === "messages" ? "conversations" : "media");

/** Opening the page: the account, then the open tab's first page. */
export async function openInbox(): Promise<void> {
  if (!(await loadAccount())) return;
  await loadList(tabList(useInbox.getState().tab), undefined);
}

/** Refresh: the account again, then the first page of what is on screen. */
export async function refreshInbox(): Promise<void> {
  if (!(await loadAccount())) return;
  const s = useInbox.getState();
  const jobs = [loadList(tabList(s.tab), undefined)];
  if (s.tab === "messages" && s.conversationId) jobs.push(loadList("messages", s.conversationId));
  if (s.tab === "comments" && s.mediaId) jobs.push(loadList("comments", s.mediaId));
  await Promise.all(jobs);
}

/** Load more: the next sealed cursor of a list, when it has one. */
export async function loadMore(kind: ListKind): Promise<void> {
  const s = useInbox.getState();
  const id = selectionOf(s, kind) ?? undefined;
  const list = listOf(kind, id);
  if (list.next) await loadList(kind, id, list.next);
}

/** Switching tabs reads that tab's first page once (until Refresh). */
export async function setInboxTab(tab: InboxTab): Promise<void> {
  useInbox.setState({ tab });
  const kind = tabList(tab);
  if (useInbox.getState().account && listOf(kind).coverage === null)
    await loadList(kind, undefined);
}

/** Opening a conversation reads its newest messages once (until Refresh); null goes back to the list. */
export async function selectConversation(id: string | null): Promise<void> {
  useInbox.setState({ conversationId: id });
  if (id && listOf("messages", id).coverage === null) await loadList("messages", id);
}

/** Opening a post reads its comments once (until Refresh); null goes back to the posts. */
export async function selectMedia(id: string | null): Promise<void> {
  useInbox.setState({ mediaId: id });
  if (id && listOf("comments", id).coverage === null) await loadList("comments", id);
}
