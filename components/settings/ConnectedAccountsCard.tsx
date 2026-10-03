"use client";

import { useState, type CSSProperties } from "react";
import { useCelebrate } from "@/components/celebrate/CelebrationProvider";
import { useSocialSync } from "@/components/social/useSocialSync";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import type { SocialConnectionStatus } from "@/lib/domain";
import { useT, type MessageKey } from "@/lib/i18n";
import { reconnectInDays, reconnectMessageKey } from "@/lib/publish";
import { PLATFORM_META } from "@/lib/social";
import {
  SOCIAL_PLATFORMS,
  accountState,
  socialErrorType,
  socialSyncErrorMessageKey,
  timeAgo,
  type SocialPlatform,
} from "@/lib/socialSync";
import { hasBeaconsSeed, useStore } from "@/store";
import Card from "./Card";

const SETUP_DOC_URL =
  "https://github.com/3zmd95-glitch/hello-github/blob/main/planning/tools/06-social-analytics-apis.md";

type Pending = { kind: "disconnect"; platform: SocialPlatform } | { kind: "seed" } | null;

/**
 * 🔗 Connected accounts: one row per platform the Scout Worker can connect (TikTok, Instagram, YouTube,
 * Threads) with its state, Connect / Reconnect / Disconnect, "Allow posting" (reconnect with the publishing
 * scopes for auto-posting), a "reconnect in N days" line before a Meta token runs out (round 30, A6), a
 * global "Sync now" with the last pull time, a short explainer, and, while the Beacons seed rows are still
 * stored, a button to remove them. Without the Worker URL and token it points at the API keys card above.
 */
export default function ConnectedAccountsCard() {
  const { t, lang } = useT();
  const { toast } = useCelebrate();
  const { configured, status, lastPullAt, busy, error, connect, disconnect, syncNow } =
    useSocialSync({ auto: true });
  const seed = useStore(hasBeaconsSeed);
  const removeBeaconsSeed = useStore((s) => s.removeBeaconsSeed);
  const [pending, setPending] = useState<Pending>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const onSync = async () => {
    setNotice(null);
    const r = await syncNow();
    if (!r.ok) return;
    const failed = Object.keys(r.errors);
    const parts = [
      r.synced.length
        ? t("settings.accounts.synced", { n: r.synced.length })
        : t("settings.accounts.syncedNone"),
    ];
    if (failed.length) parts.push(t("settings.accounts.syncFailed", { list: failed.join(", ") }));
    setNotice(parts.join(" · "));
    if (r.synced.length) toast("notice", { icon: "🔄", name: t("social.toast.synced") });
  };

  const confirm = () => {
    if (!pending) return;
    if (pending.kind === "seed") {
      removeBeaconsSeed();
      setNotice(t("settings.accounts.removeSeedOk"));
    } else {
      void disconnect(pending.platform);
    }
    setPending(null);
  };

  const pendingPlatform = pending?.kind === "disconnect" ? pending.platform : null;

  return (
    <Card id="accounts" title={t("settings.accounts.title")}>
      <div className="flex flex-col gap-3" data-testid="accounts-card">
        {!configured ? (
          <p className="text-ink-2 text-sm" data-testid="accounts-need-worker">
            {t("settings.accounts.needWorker")}{" "}
            <a href="#api-keys" className="px-link">
              {t("settings.accounts.needWorkerLink")}
            </a>
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="px-btn px-btn-sm"
                onClick={onSync}
                disabled={busy}
                aria-busy={busy}
                data-testid="accounts-sync"
              >
                {busy ? (
                  <>
                    <span aria-hidden className="acc-spin">
                      ⟳
                    </span>{" "}
                    {t("settings.accounts.syncing")}
                  </>
                ) : (
                  t("settings.accounts.sync")
                )}
              </button>
              <span className="text-muted text-xs" data-testid="accounts-last-sync">
                {lastPullAt
                  ? t("settings.accounts.lastSync", { ago: timeAgo(lastPullAt, lang) })
                  : t("settings.accounts.neverSynced")}
              </span>
            </div>

            {status === null ? (
              busy ? (
                <p className="text-muted text-sm" data-testid="accounts-loading">
                  <span aria-hidden className="acc-spin inline-block">
                    ⟳
                  </span>{" "}
                  {t("settings.accounts.loading")}
                </p>
              ) : null
            ) : (
              <ul className="flex flex-col gap-2" data-testid="account-rows">
                {SOCIAL_PLATFORMS.map((p) => (
                  <AccountRow
                    key={p}
                    platform={p}
                    status={status[p]}
                    busy={busy}
                    onConnect={() => void connect(p)}
                    onAllowPosting={() => void connect(p, true)}
                    onAllowReplies={() => void connect(p, true, true)}
                    onDisconnect={() => setPending({ kind: "disconnect", platform: p })}
                  />
                ))}
              </ul>
            )}

            {error && (
              <p role="alert" className="text-danger text-xs" data-testid="accounts-error">
                {t(error)}
              </p>
            )}
          </>
        )}
        {notice && (
          <p
            role="status"
            className="text-accent text-xs font-semibold"
            data-testid="accounts-notice"
          >
            {notice}
          </p>
        )}

        <p className="text-muted text-xs">{t("settings.accounts.explainer")}</p>

        {seed && (
          <div className="px-inset flex flex-wrap items-center gap-2" data-testid="accounts-seed">
            <span className="text-ink-2 min-w-[200px] flex-1 text-xs">
              {t("settings.accounts.removeSeedNote")}
            </span>
            <button
              type="button"
              className="px-btn px-btn-ghost px-btn-sm"
              onClick={() => setPending({ kind: "seed" })}
              data-testid="accounts-remove-seed"
            >
              {t("settings.accounts.removeSeed")}
            </button>
          </div>
        )}
      </div>

      {pending && (
        <ConfirmDialog
          title={
            pending.kind === "seed"
              ? t("settings.accounts.removeSeedTitle")
              : t("settings.accounts.disconnectTitle", {
                  platform: PLATFORM_META[pending.platform].name[lang],
                })
          }
          body={
            pending.kind === "seed"
              ? t("settings.accounts.removeSeedBody")
              : t("settings.accounts.disconnectBody", {
                  platform: pendingPlatform ? PLATFORM_META[pendingPlatform].name[lang] : "",
                })
          }
          confirmLabel={
            pending.kind === "seed"
              ? t("settings.accounts.removeSeed")
              : t("settings.accounts.disconnect")
          }
          danger
          onConfirm={confirm}
          onCancel={() => setPending(null)}
        />
      )}
    </Card>
  );
}

function AccountRow({
  platform,
  status,
  busy,
  onConnect,
  onAllowPosting,
  onAllowReplies,
  onDisconnect,
}: {
  platform: SocialPlatform;
  status: SocialConnectionStatus | undefined;
  busy: boolean;
  onConnect: () => void;
  onAllowPosting: () => void;
  /** Instagram only: reconnect with the comment + message scopes (auto-replies). */
  onAllowReplies: () => void;
  onDisconnect: () => void;
}) {
  // Only Instagram's API replies to comments and sends DMs.
  const replies = platform === "instagram";
  const { t, L, lang } = useT();
  const meta = PLATFORM_META[platform];
  const state = accountState(status, platform);
  const handle = status?.handle?.replace(/^@/, "") ?? "";
  const days = reconnectInDays(status, platform);

  let text: string;
  switch (state) {
    case "not_configured":
      text = t("settings.accounts.state.notConfigured");
      break;
    case "disconnected":
      text = t("settings.accounts.state.disconnected");
      break;
    case "error": {
      const reason: MessageKey = socialSyncErrorMessageKey({
        type: socialErrorType(status?.lastError ?? "token_expired"),
      });
      text =
        !status?.lastError || status.lastError === "token_expired"
          ? t("settings.accounts.state.expired")
          : t("settings.accounts.state.error", { reason: t(reason) });
      break;
    }
    default:
      text = status?.lastSyncAt
        ? t("settings.accounts.state.connected", {
            handle,
            ago: timeAgo(status.lastSyncAt, lang),
          })
        : t("settings.accounts.state.connectedNoSync", { handle });
  }

  return (
    <li
      className="acc-row px-inset"
      data-testid="account-row"
      data-platform={platform}
      data-state={state}
      style={{ "--c": meta.color } as CSSProperties}
    >
      <span aria-hidden className="acc-icon">
        {meta.icon}
      </span>
      <div className="flex min-w-[200px] flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-2 text-sm font-bold">
          <span aria-hidden className="acc-dot" />
          {L(meta.name)}
          {state === "connected" && status?.canPublish && (
            <span className="px-chip px-chip-green text-xs" data-testid="account-can-post">
              {t("publish.hub.canPost")}
            </span>
          )}
          {replies && state === "connected" && status?.canReply && (
            <span className="px-chip px-chip-green text-xs" data-testid="account-can-reply">
              {t("replies.canReply")}
            </span>
          )}
        </span>
        <span className="text-ink-2 text-xs" data-testid="account-state">
          {text}
          {state === "not_configured" && (
            <>
              {" "}
              <a
                href={SETUP_DOC_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="px-link"
                data-testid="account-setup-link"
              >
                {t("settings.accounts.state.docLink")}
              </a>
            </>
          )}
        </span>
        {state === "error" && status?.lastErrorDetail && (
          <span
            dir="ltr"
            className="text-ink-2 font-mono text-[11px] break-words opacity-80"
            data-testid="account-error-detail"
          >
            {status.lastErrorDetail}
          </span>
        )}
        {days !== null && (
          <span className="text-danger text-xs font-bold" data-testid="account-token-warning">
            {t(reconnectMessageKey(days), { n: days })}
          </span>
        )}
      </div>
      <div className="flex shrink-0 flex-wrap gap-1.5">
        {state === "disconnected" && (
          <button
            type="button"
            className="px-btn px-btn-sm"
            onClick={onConnect}
            disabled={busy}
            data-testid="account-connect"
          >
            {t("settings.accounts.connect")}
          </button>
        )}
        {(state === "error" || days !== null) && (
          <button
            type="button"
            className="px-btn px-btn-sm"
            onClick={onConnect}
            disabled={busy}
            data-testid="account-reconnect"
          >
            {t("settings.accounts.reconnect")}
          </button>
        )}
        {state === "connected" && !status?.canPublish && (
          // Instagram without either permission: one consent grants posting and replies together.
          <button
            type="button"
            className="px-btn px-btn-sm"
            onClick={replies && !status?.canReply ? onAllowReplies : onAllowPosting}
            disabled={busy}
            data-testid="account-allow-posting"
          >
            {replies && !status?.canReply ? t("replies.allowBoth") : t("publish.allow")}
          </button>
        )}
        {replies && state === "connected" && status?.canPublish && !status.canReply && (
          <button
            type="button"
            className="px-btn px-btn-sm"
            onClick={onAllowReplies}
            disabled={busy}
            data-testid="account-allow-replies"
          >
            {t("replies.allow")}
          </button>
        )}
        {(state === "connected" || state === "error") && (
          <button
            type="button"
            className="px-btn px-btn-ghost px-btn-sm"
            onClick={onDisconnect}
            disabled={busy}
            data-testid="account-disconnect"
          >
            {t("settings.accounts.disconnect")}
          </button>
        )}
      </div>
    </li>
  );
}
