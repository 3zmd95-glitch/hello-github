"use client";

import { Inbox } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import EmptyState from "@/components/ui/ios/EmptyState";
import { ListGroup, ListRow } from "@/components/ui/ios/List";
import PageHeader from "@/components/ui/ios/PageHeader";
import PlatformBadge from "@/components/ui/ios/PlatformBadge";
import Segmented from "@/components/ui/ios/Segmented";
import Sheet from "@/components/ui/ios/Sheet";
import { useFirstVisit } from "@/components/ui/ios/useFirstVisit";
import type { InboxConversation, InboxOverview, InboxPost } from "@/lib/domain";
import { inboxErrorKey } from "@/lib/inbox";
import { useT, type MessageKey } from "@/lib/i18n";
import { timeAgo } from "@/lib/socialSync";
import { useStore } from "@/store";
import { useSocialSync } from "../useSocialSync";
import CommentsView from "./CommentsView";
import ConversationList from "./ConversationList";
import InboxStats from "./InboxStats";
import PostList from "./PostList";
import ThreadView from "./ThreadView";
import {
  conversationSeen,
  loadInbox,
  loadMoreConversations,
  loadMorePosts,
  postSeen,
  refreshInbox,
  useInbox,
  useInboxPoll,
} from "./useInbox";

const TABS = ["all", "instagram", "tiktok"] as const;
type Open = { kind: "thread"; c: InboxConversation } | { kind: "post"; p: InboxPost } | null;

/** What the Instagram account still needs; its button asks for it, with the replies permission. */
const ACCOUNT = {
  needIg: {
    text: "inbox.needIg",
    button: "settings.accounts.connect",
    testId: "inbox-need-ig",
    buttonId: "inbox-connect",
  },
  tokenExpired: {
    text: "inbox.tokenExpired",
    button: "settings.accounts.reconnect",
    testId: "inbox-token-expired",
    buttonId: "inbox-connect",
  },
  needPermission: {
    text: "inbox.needPermission",
    button: "inbox.allow",
    testId: "inbox-need-permission",
    buttonId: "inbox-allow",
  },
} as const satisfies Record<
  string,
  { text: MessageKey; button: MessageKey; testId: string; buttonId: string }
>;

function accountNeed(overview: InboxOverview | null): keyof typeof ACCOUNT | null {
  const ig = overview?.platforms.instagram;
  if (!ig) return null;
  if (!ig.connected) return "needIg";
  if (ig.tokenExpired) return "tokenExpired";
  return ig.canReply ? null : "needPermission";
}

/** The newest time the reader looked at any platform. */
function lastRead(overview: InboxOverview | null): string | null {
  const times = Object.values(overview?.platforms ?? {}).map((p) => p.lastReadAt);
  return times.reduce<string | null>((a, b) => (b && (!a || b > a) ? b : a), null);
}

/**
 * 📥 The global inbox (planning/tools/51-global-inbox.md), read only: Instagram's DMs and comments as the Worker's
 * reader keeps them, a tab per platform (TikTok has no DMs for personal accounts and no comments before its
 * approval), a conversation or a post's comments in a sheet (a side panel on a wide screen). Three tiles on top and a
 * search over the loaded rows (client side only). Polls every INBOX_POLL_MS while the page is visible.
 */
export default function InboxScreen() {
  const { t, lang } = useT();
  const inbox = useInbox();
  const { configured, overview, error } = inbox;
  const tab = useStore((s) => s.inboxTab);
  const setTab = useStore((s) => s.setInboxTab);
  const markSeen = useStore((s) => s.markInboxSeen);
  const seen = useStore((s) => s.inboxSeen);
  const first = useFirstVisit("inbox");
  const { busy: accountBusy, connect } = useSocialSync();
  const [open, setOpen] = useState<Open>(null);
  const [query, setQuery] = useState("");
  /** Why the last connect / reconnect failed (the page stays: a success leaves for the platform). */
  const [connectError, setConnectError] = useState<MessageKey | null>(null);

  useEffect(() => {
    if (configured) void loadInbox();
  }, [configured]);
  useInboxPoll(configured);

  if (!configured)
    return (
      <div className="flex flex-col gap-4" data-testid="inbox-screen">
        <PageHeader title={t("inbox.title")} sub={t("inbox.sub")} />
        <div className="ios-list">
          <EmptyState
            icon={<Inbox size={24} strokeWidth={1.75} aria-hidden />}
            title={t("inbox.needWorker")}
            action={
              <Link href="/social/settings#api-keys" className="px-btn px-btn-sm">
                {t("inbox.needWorkerLink")}
              </Link>
            }
            testId="inbox-need-worker"
          />
        </div>
      </div>
    );

  const read = lastRead(overview);
  const need = accountNeed(overview);
  const loaded = inbox.loadedAt !== null;
  const pick = <T extends { platform: string }>(list: readonly T[]) =>
    tab === "all" ? list : list.filter((x) => x.platform === tab);
  // The search narrows what is loaded (names, last lines, captions), whatever the case; nothing is asked of the Worker.
  const needle = query.trim().toLowerCase();
  const has = (...texts: string[]) =>
    !needle || texts.some((x) => x.toLowerCase().includes(needle));
  const conversations = pick(inbox.conversations).filter((c) => has(c.peerName, c.lastText));
  const posts = pick(inbox.posts).filter((p) => has(p.caption));
  const noMatch = loaded && needle !== "" && conversations.length === 0 && posts.length === 0;
  // The thread follows the person's row: the poll may swap a provisional conversation for the real one.
  const live =
    open?.kind === "thread"
      ? (inbox.conversations.find(
          (c) => c.platform === open.c.platform && c.peerId === open.c.peerId,
        ) ?? open.c)
      : null;

  const openConversation = (c: InboxConversation) => {
    const { key, at } = conversationSeen(c);
    markSeen(key, at);
    setOpen({ kind: "thread", c });
  };
  const openPost = (p: InboxPost) => {
    const { key, at } = postSeen(p);
    markSeen(key, at);
    setOpen({ kind: "post", p });
  };

  return (
    <div className="flex flex-col gap-4" data-testid="inbox-screen">
      <PageHeader
        title={t("inbox.title")}
        sub={t("inbox.sub")}
        trailing={
          <div className="flex shrink-0 flex-col items-end gap-1">
            <button
              type="button"
              className="px-btn px-btn-ghost px-btn-sm"
              disabled={inbox.busy}
              aria-busy={inbox.busy}
              onClick={() => void refreshInbox()}
              data-testid="inbox-refresh"
            >
              {t("inbox.refresh")}
            </button>
            {read && (
              <span className="text-muted text-[12px]" data-testid="inbox-last-read">
                {t("inbox.lastRead", { ago: timeAgo(read, lang) })}
              </span>
            )}
          </div>
        }
      />

      {inbox.loadedAt !== null && overview && (
        <InboxStats
          conversations={pick(inbox.conversations)}
          seen={seen}
          comments={overview.counts.comments}
          countUp={first}
          now={inbox.loadedAt}
        />
      )}

      {error?.type === "not_available" ? (
        <div className="ios-list">
          <EmptyState
            icon={<Inbox size={24} strokeWidth={1.75} aria-hidden />}
            title={t("inbox.notAvailable")}
            testId="inbox-not-available"
          />
        </div>
      ) : (
        <>
          {need && tab !== "tiktok" && (
            <div className="ios-list">
              <div className="ios-row flex-wrap">
                <PlatformBadge platform="instagram" />
                <p className="min-w-[10rem] flex-1 text-[15px]" data-testid={ACCOUNT[need].testId}>
                  {t(ACCOUNT[need].text)}
                </p>
                <button
                  type="button"
                  className="px-btn px-btn-sm ms-auto"
                  disabled={accountBusy}
                  onClick={() =>
                    void connect("instagram", true, true).then((r) =>
                      setConnectError(r.ok ? null : r.error),
                    )
                  }
                  data-testid={ACCOUNT[need].buttonId}
                >
                  {t(ACCOUNT[need].button)}
                </button>
              </div>
            </div>
          )}
          {need && tab !== "tiktok" && connectError && (
            <p
              role="alert"
              className="text-danger px-4 text-[13px]"
              data-testid="inbox-connect-error"
            >
              {t(connectError)}
            </p>
          )}
          {error && (
            <p role="alert" className="text-danger px-4 text-[13px]" data-testid="inbox-error">
              {t(inboxErrorKey(error), { detail: error.detail ?? "" })}
            </p>
          )}

          {/* The toolbar: the tabs at the start, the search at the end (under the tabs on a phone). */}
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <Segmented
              options={TABS.map((v) => ({
                value: v,
                label: t(`inbox.tab.${v}`),
                testId: `inbox-tab-${v}`,
              }))}
              value={tab}
              onChange={setTab}
              label={t("inbox.title")}
              testId="inbox-tab"
              idPrefix="inbox"
              className="md:w-80"
            />
            {tab !== "tiktok" && (
              <input
                type="search"
                autoComplete="off"
                className="px-input bg-panel md:w-72"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setQuery("");
                }}
                placeholder={t("inbox.search")}
                aria-label={t("inbox.search")}
                data-testid="inbox-search"
              />
            )}
          </div>

          {/* Focusable (APG tabs): a tab's panel may hold no control. */}
          <div
            role="tabpanel"
            id={`inbox-panel-${tab}`}
            aria-labelledby={`inbox-tab-${tab}`}
            tabIndex={0}
            className="flex flex-col gap-4"
          >
            {tab === "tiktok" ? (
              <TikTokPanel />
            ) : (
              (loaded || inbox.busy) && (
                <>
                  {/* Searching, a list with no match leaves the page; when neither has one, this card says so. */}
                  {(!needle || conversations.length > 0 || noMatch) && (
                    <ConversationList
                      conversations={conversations}
                      loaded={loaded}
                      more={inbox.moreConversations}
                      noMatch={noMatch}
                      onOpen={openConversation}
                      onMore={() => void loadMoreConversations()}
                    />
                  )}
                  {(!needle || posts.length > 0) && (
                    <PostList
                      posts={posts}
                      loaded={loaded}
                      more={inbox.morePosts}
                      onOpen={openPost}
                      onMore={() => void loadMorePosts()}
                    />
                  )}
                </>
              )
            )}
          </div>
        </>
      )}

      {live && (
        <Sheet
          onClose={() => setOpen(null)}
          title={live.peerName}
          titleId="inbox-thread-title"
          testId="inbox-thread"
          detents={[0.92]}
          side
        >
          <ThreadView key={live.id} conversation={live} />
        </Sheet>
      )}
      {open?.kind === "post" && (
        <Sheet
          onClose={() => setOpen(null)}
          title={t("inbox.section.comments")}
          sub={open.p.caption || t("inbox.comments.untitled")}
          titleId="inbox-post-title"
          testId="inbox-post"
          detents={[0.92]}
          side
        >
          <CommentsView post={open.p} />
        </Sheet>
      )}
    </div>
  );
}

/** TikTok: DMs stay in the app for personal accounts; comments come once TikTok approves the app. */
function TikTokPanel() {
  const { t } = useT();
  return (
    <>
      <ListGroup header={t("inbox.section.messages")} testId="inbox-messages">
        <ListRow
          iconRaw={<PlatformBadge platform="tiktok" />}
          title={<span className="whitespace-normal">{t("inbox.tiktok.noDm")}</span>}
          sub={
            <a
              href="https://www.tiktok.com/messages"
              target="_blank"
              rel="noopener noreferrer"
              className="px-link"
              data-testid="inbox-tiktok-open"
            >
              {t("inbox.tiktok.openDm")}
            </a>
          }
          testId="inbox-tiktok-dm"
        />
      </ListGroup>
      <ListGroup header={t("inbox.section.comments")} testId="inbox-comments">
        <ListRow
          iconRaw={<PlatformBadge platform="tiktok" />}
          title={<span className="whitespace-normal">{t("inbox.tiktok.soon")}</span>}
          testId="inbox-tiktok-soon"
        />
      </ListGroup>
    </>
  );
}
