"use client";

import { ExternalLink, MessageCircle, Tv } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useT, type MessageKey } from "@/lib/i18n";
import {
  threadsLink,
  youtubeLink,
  type CommentProvider,
  type ThreadsPost,
  type ThreadsReply,
  type YouTubeComment,
  type YouTubeThread,
  type YouTubeVideo,
} from "@/lib/inbox";
import DraftBox from "./DraftBox";
import type { ReplyTarget } from "./SendReview";
import { ThreadsSendRecoveryList, type ThreadsReplyTarget } from "./ThreadsSendReview";
import { DirectionChip, ListFooter, StateNote, When } from "./parts";
import {
  loadMoreProvider,
  loadReplies,
  providerDraftScope,
  providerList,
  selectChannel,
  selectPost,
  selectVideo,
  selectedChannel,
  useProviderInbox,
} from "./useProviderInbox";

/**
 * 📥 Threads and YouTube in the Inbox (packet DT-6B-1): own posts / videos → comments and replies, read-only, with the
 * same private draft box (v2 provider scopes), Copy, and links only on the exact Threads / YouTube hosts. Nothing is
 * sent, hidden or moderated from here, except a YouTube reply the owner reviews and sends himself (DT-6B-2A: a nested row's
 * reply goes under its top-level parent, and the review says so). DT-6B-2B-2: a Threads direct reply offers the Threads
 * review controls (unavailable while Threads sending is unverified), and every retained Threads operation of the account
 * stays checkable from the recovery list, with or without its row.
 */

function OpenLink({
  href,
  label,
  testId,
}: {
  href: string | undefined;
  label: string;
  testId: string;
}) {
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="px-link inline-flex items-center gap-1 text-[13px]"
      data-testid={testId}
    >
      <ExternalLink size={14} aria-hidden />
      {label}
    </a>
  );
}

function Author({ name }: { name: string | undefined }) {
  const { t } = useT();
  return (
    <span className="text-ink-2 text-[13px]" data-testid="ibx-author">
      {name ? <bdi dir="ltr">@{name}</bdi> : t("inbox.author.unknown")}
    </span>
  );
}

function BackRow({
  onBack,
  title,
  link,
  testId,
}: {
  onBack: () => void;
  title: ReactNode;
  link: ReactNode;
  testId: string;
}) {
  const { t } = useT();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        className="px-btn px-btn-ghost px-btn-sm"
        onClick={onBack}
        data-testid={testId}
      >
        {t("inbox.back")}
      </button>
      <h2 className="min-w-0 flex-1 truncate text-[17px] font-semibold">{title}</h2>
      {link}
    </div>
  );
}

/** One comment or reply row with its own draft box on demand. */
function CommentRow({
  provider,
  c,
  testId,
  drafting,
  setDrafting,
  children,
  send,
  threadsSend,
}: {
  provider: CommentProvider;
  c: ThreadsReply | YouTubeComment;
  testId: string;
  drafting: string | null;
  setDrafting: (fn: (d: string | null) => string | null) => void;
  children?: ReactNode;
  send?: ReplyTarget;
  threadsSend?: ThreadsReplyTarget;
}) {
  const { t } = useT();
  const scope = providerDraftScope(provider, c.id);
  const media = "kind" in c && c.kind === "media";
  return (
    <li
      className="ios-row flex-col items-stretch gap-1"
      data-testid={testId}
      data-id={c.id}
      data-dir={c.direction}
      {...("kind" in c ? { "data-kind": c.kind } : {})}
    >
      <div className="flex flex-wrap items-center gap-2">
        <DirectionChip dir={c.direction} />
        <Author name={c.author?.username} />
        <When iso={c.createdAt} />
        <button
          type="button"
          className="px-btn px-btn-ghost px-btn-sm ms-auto"
          aria-expanded={drafting === c.id}
          onClick={() => setDrafting((d) => (d === c.id ? null : c.id))}
          data-testid={provider === "threads" ? "ibx-reply-draft" : "ibx-yt-draft"}
        >
          {t("inbox.comment.draft")}
        </button>
      </div>
      {c.text && (
        <p className="text-[15px] break-words whitespace-pre-wrap" dir="auto">
          {c.text}
        </p>
      )}
      {media && (
        <p className="text-muted text-[13px]" data-testid="ibx-th-media">
          {t("inbox.kind.media")}
        </p>
      )}
      {!c.text && !media && <p className="text-muted text-[13px]">{t("inbox.kind.empty")}</p>}
      {children}
      {drafting === c.id && (
        <DraftBox
          key={scope}
          scope={scope}
          provider={provider}
          send={send}
          threadsSend={threadsSend}
        />
      )}
    </li>
  );
}

function useBusy(): boolean {
  return useProviderInbox((s) => Object.values(s.busy).some(Boolean));
}

/* ---------- Threads ---------- */

function ThreadsView() {
  const { t } = useT();
  useProviderInbox((s) => s.lists);
  const postId = useProviderInbox((s) => s.postId);
  const account = useProviderInbox((s) => s.threads);
  const caps = account?.capabilities.replies;
  const busy = useBusy();
  const [drafting, setDrafting] = useState<string | null>(null);
  const posts = providerList<ThreadsPost>("threads", "posts");

  if (!postId)
    return (
      <div className="flex flex-col gap-2">
        <ThreadsSendRecoveryList />
        {posts.items.length > 0 && (
          <ul className="ios-list">
            {posts.items.map((p) => (
              <li key={p.id} className="ios-row flex-wrap" data-testid="ibx-th-post" data-id={p.id}>
                <span className="ios-ic fill">
                  <MessageCircle size={20} strokeWidth={1.75} aria-hidden />
                </span>
                <button
                  type="button"
                  className="ios-tx min-w-0 flex-1 text-start"
                  onClick={() => void selectPost(p.id)}
                  data-testid="ibx-th-post-open"
                >
                  <b>{p.text ? <bdi dir="auto">{p.text}</bdi> : t("inbox.th.noText")}</b>
                  <small>
                    <When iso={p.timestamp} />
                  </small>
                </button>
                <OpenLink
                  href={threadsLink(p.permalink)}
                  label={t("inbox.openThreads")}
                  testId="ibx-th-post-link"
                />
              </li>
            ))}
          </ul>
        )}
        <ListFooter
          list={posts}
          empty="inbox.empty.posts"
          busy={busy}
          onMore={() => void loadMoreProvider("threads", "posts")}
          provider="threads"
        />
      </div>
    );

  const post = posts.items.find((p) => p.id === postId);
  const replies = providerList<ThreadsReply>("threads", "replies", postId);
  return (
    <div className="flex flex-col gap-3">
      <BackRow
        onBack={() => {
          setDrafting(null);
          void selectPost(null);
        }}
        title={post?.text ? <bdi dir="auto">{post.text}</bdi> : t("inbox.th.noText")}
        link={
          <OpenLink
            href={threadsLink(post?.permalink)}
            label={t("inbox.openThreads")}
            testId="ibx-th-post-link"
          />
        }
        testId="ibx-th-back"
      />
      <ThreadsSendRecoveryList />
      {caps !== "ok" ? (
        <div className="ios-list">
          <StateNote code={caps ?? "no_permission"} provider="threads" />
        </div>
      ) : (
        <>
          {replies.items.length > 0 && (
            <ul className="ios-list">
              {replies.items.map((r) => (
                <CommentRow
                  key={r.id}
                  provider="threads"
                  c={r}
                  testId="ibx-th-reply"
                  drafting={drafting}
                  setDrafting={setDrafting}
                  threadsSend={
                    account
                      ? {
                          sendRef: r.sendRef,
                          account: account.accountId,
                          generation: account.generation,
                          rootPostId: postId,
                          replyToId: r.id,
                          accountName: account.handle,
                          capability: account.capabilities.sendReplies,
                        }
                      : undefined
                  }
                >
                  {r.parentId && r.parentId !== postId && (
                    <p className="text-muted text-[13px]" data-testid="ibx-th-nested">
                      {t("inbox.th.nested")}
                    </p>
                  )}
                </CommentRow>
              ))}
            </ul>
          )}
          <ListFooter
            list={replies}
            empty="inbox.empty.replies"
            busy={busy}
            onMore={() => void loadMoreProvider("threads", "replies")}
            provider="threads"
          />
        </>
      )}
    </div>
  );
}

/* ---------- YouTube ---------- */

/** One thread: the top-level comment, the embedded subset or the loaded replies, and Load replies on demand. */
function YouTubeThreadRow({
  th,
  drafting,
  setDrafting,
  sendBase,
}: {
  th: YouTubeThread;
  drafting: string | null;
  setDrafting: (fn: (d: string | null) => string | null) => void;
  /** The account part of a reply target (DT-6B-2A); each row adds its own send target. */
  sendBase: Omit<ReplyTarget, "sendRef" | "parentAuthor" | "parentId" | "parentText" | "nested">;
}) {
  const { t } = useT();
  const busy = useBusy();
  const loaded = providerList<YouTubeComment>("youtube", "replies", th.id);
  const total = th.totalReplyCount;
  const shown = loaded.coverage === null ? th.replies : loaded.items;
  const parentAuthor = th.comment.author?.username;
  // DT-6B-2A-R1 (2A-8): the loaded top-level comment, so the review can show the exact comment that receives the reply.
  const parent = { parentAuthor, parentId: th.comment.id, parentText: th.comment.text };
  // Before loading: an unknown total (DT-6B-1-R1 B1-3) or more than embedded offers Load replies. After: a cursor is
  // Load more, a failure without one is Retry.
  const action: MessageKey | null =
    loaded.coverage === null
      ? total === null || total > th.replies.length
        ? "inbox.yt.loadReplies"
        : null
      : loaded.next
        ? "inbox.more"
        : loaded.error
          ? "inbox.yt.retry"
          : null;
  // This comment's own reply coverage (B1-8), never the thread list's footer.
  const note: MessageKey | null =
    loaded.coverage === "end"
      ? "inbox.yt.repliesEnd"
      : loaded.coverage === "cap"
        ? "inbox.cov.cap"
        : loaded.coverage === "partial"
          ? "inbox.yt.repliesPartial"
          : null;
  return (
    <li className="flex flex-col gap-1" data-testid="ibx-yt-thread" data-id={th.id}>
      <ul className="ios-list">
        <CommentRow
          provider="youtube"
          c={th.comment}
          testId="ibx-yt-comment"
          drafting={drafting}
          setDrafting={setDrafting}
          send={{ ...sendBase, ...parent, sendRef: th.sendRef, nested: false }}
        />
      </ul>
      {shown.length > 0 && (
        <ul className="ios-list ms-6">
          {shown.map((r) => (
            <CommentRow
              key={r.id}
              provider="youtube"
              c={r}
              testId="ibx-yt-reply"
              drafting={drafting}
              setDrafting={setDrafting}
              // A reply loaded on demand has no send target of its own: it is the thread's, which the Worker sealed.
              send={{ ...sendBase, ...parent, sendRef: r.sendRef ?? th.sendRef, nested: true }}
            />
          ))}
        </ul>
      )}
      {loaded.coverage === null && total !== null && total > th.replies.length && (
        <p className="text-muted ms-6 text-[13px]" data-testid="ibx-yt-subset">
          {t("inbox.yt.subset", { shown: th.replies.length, total })}
        </p>
      )}
      {loaded.coverage !== null && (
        <div
          className="ms-6 flex flex-col gap-1"
          data-testid="ibx-yt-replies-footer"
          data-coverage={loaded.coverage}
        >
          {loaded.error && (
            <div className="ios-list">
              <StateNote code={loaded.error} provider="youtube" />
            </div>
          )}
          {note && <p className="text-muted text-[13px]">{t(note)}</p>}
        </div>
      )}
      {action && (
        <button
          type="button"
          className="px-btn px-btn-ghost px-btn-sm ms-6 self-start"
          disabled={busy}
          aria-busy={busy}
          onClick={() => void loadReplies(th.id)}
          data-testid="ibx-yt-load-replies"
        >
          {t(action)}
        </button>
      )}
    </li>
  );
}

function YouTubeView() {
  const { t } = useT();
  useProviderInbox((s) => s.lists);
  const account = useProviderInbox((s) => s.youtube);
  const videoId = useProviderInbox((s) => s.videoId);
  useProviderInbox((s) => s.channelId);
  const busy = useBusy();
  const [drafting, setDrafting] = useState<string | null>(null);
  const channel = selectedChannel();
  if (!account) return null;

  if (!channel)
    return account.channels.length === 0 ? (
      <p className="text-ink-2 px-4 text-[15px]" data-testid="ibx-yt-nochannel">
        {t("inbox.yt.noChannel")}
      </p>
    ) : (
      <div className="flex flex-col gap-2">
        <p className="text-ink-2 px-4 text-[15px]">{t("inbox.yt.pick")}</p>
        <ul className="ios-list">
          {account.channels.map((c) => (
            <li key={c.accountId} className="ios-row">
              <button
                type="button"
                className="ios-tx min-w-0 flex-1 text-start"
                onClick={() => void selectChannel(c.accountId)}
                data-testid="ibx-yt-channel"
                data-id={c.accountId}
              >
                <b>
                  <bdi dir="auto">{c.title ?? c.accountId}</bdi>
                </b>
                <small>
                  <bdi dir="ltr">{c.accountId}</bdi>
                </small>
              </button>
            </li>
          ))}
        </ul>
      </div>
    );

  const head = (
    <div className="flex flex-wrap items-center gap-2 px-4">
      <p className="text-ink-2 min-w-0 flex-1 truncate text-[13px]">
        {t("inbox.yt.channel", { name: channel.title ?? channel.accountId })}
      </p>
      {account.channels.length > 1 && (
        <button
          type="button"
          className="px-btn px-btn-ghost px-btn-sm"
          onClick={() => void selectChannel(null)}
          data-testid="ibx-yt-switch"
        >
          {t("inbox.yt.switch")}
        </button>
      )}
    </div>
  );
  if (!channel.uploads)
    return (
      <div className="flex flex-col gap-2">
        {head}
        <p className="text-ink-2 px-4 text-[15px]" data-testid="ibx-yt-nouploads">
          {t("inbox.yt.noUploads")}
        </p>
      </div>
    );

  const videos = providerList<YouTubeVideo>("youtube", "videos");
  if (!videoId)
    return (
      <div className="flex flex-col gap-2">
        {head}
        {videos.items.length > 0 && (
          <ul className="ios-list">
            {videos.items.map((v) => (
              <li
                key={v.id}
                className="ios-row flex-wrap"
                data-testid="ibx-yt-video"
                data-id={v.id}
              >
                <span className="ios-ic fill">
                  <Tv size={20} strokeWidth={1.75} aria-hidden />
                </span>
                <button
                  type="button"
                  className="ios-tx min-w-0 flex-1 text-start"
                  onClick={() => void selectVideo(v.id)}
                  data-testid="ibx-yt-video-open"
                >
                  <b>{v.title ? <bdi dir="auto">{v.title}</bdi> : t("inbox.yt.untitled")}</b>
                  <small>
                    <When iso={v.timestamp} />
                  </small>
                </button>
                <OpenLink
                  href={youtubeLink(v.permalink)}
                  label={t("inbox.openYouTube")}
                  testId="ibx-yt-video-link"
                />
              </li>
            ))}
          </ul>
        )}
        <ListFooter
          list={videos}
          empty="inbox.empty.videos"
          busy={busy}
          onMore={() => void loadMoreProvider("youtube", "videos")}
          provider="youtube"
        />
      </div>
    );

  const video = videos.items.find((v) => v.id === videoId);
  const threads = providerList<YouTubeThread>("youtube", "threads", videoId);
  return (
    <div className="flex flex-col gap-3">
      <BackRow
        onBack={() => {
          setDrafting(null);
          void selectVideo(null);
        }}
        title={video?.title ? <bdi dir="auto">{video.title}</bdi> : t("inbox.yt.untitled")}
        link={
          <OpenLink
            href={youtubeLink(video?.permalink)}
            label={t("inbox.openYouTube")}
            testId="ibx-yt-video-link"
          />
        }
        testId="ibx-yt-back"
      />
      {account.capabilities.comments !== "ok" ? (
        <div className="ios-list">
          <StateNote code={account.capabilities.comments} provider="youtube" />
        </div>
      ) : (
        <>
          {threads.items.length > 0 && (
            <ul className="flex flex-col gap-3">
              {threads.items.map((th) => (
                <YouTubeThreadRow
                  key={th.id}
                  th={th}
                  drafting={drafting}
                  setDrafting={setDrafting}
                  sendBase={{
                    account: channel.accountId,
                    generation: channel.generation,
                    accountName: channel.title ?? channel.accountId,
                    videoTitle: video?.title,
                    capability: account.capabilities.sendComments,
                  }}
                />
              ))}
            </ul>
          )}
          <ListFooter
            list={threads}
            empty="inbox.empty.threads"
            busy={busy}
            onMore={() => void loadMoreProvider("youtube", "threads")}
            provider="youtube"
            end="inbox.cov.end.youtubeComments"
          />
        </>
      )}
    </div>
  );
}

/** The provider's account state, then its view. */
export default function ProviderView({ provider }: { provider: CommentProvider }) {
  const { t } = useT();
  const account = useProviderInbox((s) => (provider === "threads" ? s.threads : s.youtube));
  const error = useProviderInbox((s) => s.accountError[provider]);
  const busy = useProviderInbox((s) => !!s.accountBusy[provider]);
  return (
    <div data-testid="ibx-provider-view" data-provider={provider}>
      {error ? (
        <>
          <div className="ios-list">
            <StateNote code={error} provider={provider} />
          </div>
          {/* DT-6B-2B-2-R1 (2B2-3): retained Threads operations stay checkable without an account answer. */}
          {provider === "threads" && <ThreadsSendRecoveryList />}
        </>
      ) : !account ? (
        <>
          {busy && (
            <p className="text-muted px-4 text-[15px]" aria-busy data-testid="ibx-loading">
              {t("inbox.loading")}
            </p>
          )}
          {provider === "threads" && <ThreadsSendRecoveryList />}
        </>
      ) : provider === "threads" ? (
        <ThreadsView />
      ) : (
        <YouTubeView />
      )}
    </div>
  );
}
