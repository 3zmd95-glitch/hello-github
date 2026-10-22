"use client";

import { RefreshCw } from "lucide-react";
import { useEffect } from "react";
import PageHeader from "@/components/ui/ios/PageHeader";
import Segmented from "@/components/ui/ios/Segmented";
import { useT, type MessageKey } from "@/lib/i18n";
import type { InboxProvider } from "@/lib/inbox";
import { timeAgo } from "@/lib/socialSync";
import { useStore } from "@/store";
import CommentsView from "./CommentsView";
import ConversationList from "./ConversationList";
import ConversationView from "./ConversationView";
import { InstagramDmControlRecoveryList } from "./InstagramDmControlReview";
import { InstagramDmRecoveryList } from "./InstagramDmSendReview";
import { InstagramSendRecoveryList } from "./InstagramSendReview";
import { StateNote } from "./parts";
import ProviderView from "./ProviderView";
import { openInbox, refreshInbox, setInboxTab, useInbox, type InboxTab } from "./useInbox";
import {
  openProvider,
  refreshProvider,
  setInboxProvider,
  useProviderInbox,
} from "./useProviderInbox";

/**
 * 📥 Inbox (packet DT-6A, planning/tools/36-inbox.md): read-only Instagram conversations and post comments through
 * the Worker's pure readers, with private drafts, Copy and validated Instagram links. DT-6B-1 adds the platform
 * selector: Threads (own posts → direct replies) and YouTube (channel → videos → comment threads → replies on demand),
 * read the same way (ProviderView, useProviderInbox); the Instagram view below is unchanged. Opening reads the account and
 * the open tab once; after that only Refresh and Load more read. Nothing is sent, marked seen or retried by itself.
 * Studio's reminder Inbox (InboxCard) is a different thing and stays as it is.
 */
export default function InboxScreen() {
  const { t, lang } = useT();
  const scoutUrl = useStore((s) => s.settings.apiKeys.scoutUrl);
  const scoutToken = useStore((s) => s.settings.apiKeys.scoutToken);
  const { account, accountError, accountBusy, tab, conversationId, lists } = useInbox();
  const provider = useProviderInbox((s) => s.provider);
  const providerLists = useProviderInbox((s) => s.lists);
  const providerBusy = useProviderInbox((s) =>
    s.provider === "instagram" ? false : !!s.accountBusy[s.provider],
  );
  const providerUnconfigured = useProviderInbox(
    (s) => s.provider !== "instagram" && s.accountError[s.provider] === "unconfigured",
  );

  useEffect(() => {
    void openInbox();
    const p = useProviderInbox.getState().provider;
    if (p !== "instagram") void openProvider(p);
  }, [scoutUrl, scoutToken]);

  const fetchedAt = Object.values(provider === "instagram" ? lists : providerLists)
    .map((l) => l.fetchedAt)
    .filter((x): x is string => !!x)
    .sort()
    .at(-1);
  const cap = account?.capabilities[tab];

  return (
    <div className="flex flex-col gap-4" data-testid="ibx-screen">
      <PageHeader
        title={t("inbox.title")}
        sub={t("inbox.sub")}
        trailing={
          <button
            type="button"
            className="px-btn px-btn-ghost px-btn-sm inline-flex shrink-0 items-center gap-1"
            disabled={
              provider === "instagram"
                ? accountBusy || accountError === "unconfigured"
                : providerBusy || providerUnconfigured
            }
            aria-busy={provider === "instagram" ? accountBusy : providerBusy}
            onClick={() =>
              void (provider === "instagram" ? refreshInbox() : refreshProvider(provider))
            }
            data-testid="ibx-refresh"
          >
            <RefreshCw size={16} aria-hidden />
            {t("inbox.refresh")}
          </button>
        }
      />
      <div className="flex flex-col gap-1 px-4">
        <p className="text-ink-2 text-[13px]" data-testid="ibx-readonly">
          {fetchedAt
            ? t("inbox.readOnly", { ago: timeAgo(fetchedAt, lang) })
            : t("inbox.readOnlyNever")}
        </p>
        <p className="text-muted text-[13px]" data-testid="ibx-coverage-note">
          {t(
            provider === "instagram"
              ? "inbox.coverageNote"
              : (`inbox.coverageNote.${provider}` as MessageKey),
          )}
        </p>
      </div>

      <Segmented<InboxProvider>
        options={(["instagram", "threads", "youtube"] as const).map((p) => ({
          value: p,
          label: t(`inbox.provider.${p}`),
          testId: `ibx-provider-${p}`,
        }))}
        value={provider}
        onChange={(v) => void setInboxProvider(v)}
        label={t("inbox.providers")}
        role="radiogroup"
        testId="ibx-providers"
      />

      {provider !== "instagram" ? (
        <ProviderView provider={provider} />
      ) : accountError ? (
        <div className="ios-list">
          <StateNote code={accountError} />
        </div>
      ) : !account ? (
        accountBusy && (
          <p className="text-muted px-4 text-[15px]" aria-busy data-testid="ibx-loading">
            {t("inbox.loading")}
          </p>
        )
      ) : (
        <>
          <Segmented<InboxTab>
            options={[
              { value: "messages", label: t("inbox.tab.messages"), testId: "ibx-tab-messages" },
              { value: "comments", label: t("inbox.tab.comments"), testId: "ibx-tab-comments" },
            ]}
            value={tab}
            onChange={(v) => void setInboxTab(v)}
            label={t("inbox.tabs")}
            idPrefix="ibx"
          />
          <div role="tabpanel" id={`ibx-panel-${tab}`} aria-labelledby={`ibx-tab-${tab}`}>
            {cap && cap !== "ok" ? (
              <div className="ios-list">
                <StateNote code={cap} />
              </div>
            ) : tab === "comments" ? (
              <CommentsView />
            ) : conversationId ? (
              <ConversationView id={conversationId} />
            ) : (
              <ConversationList />
            )}
          </div>
        </>
      )}
      {/* DT-6B-2C-4: retained public-reply operations, whatever the account read, account or capability. */}
      {provider === "instagram" && <InstagramSendRecoveryList />}
      {/* DT-6B-2C-5A: retained DM operations, the same way (stored account and Worker only). */}
      {provider === "instagram" && <InstagramDmRecoveryList />}
      {/* DT-6B-2C-5B: kept conversation takeovers, whatever the provider, account read or account. */}
      <InstagramDmControlRecoveryList />
    </div>
  );
}
