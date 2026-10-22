"use client";

import Link from "next/link";
import Chip from "@/components/ui/ios/Chip";
import { useT, type MessageKey } from "@/lib/i18n";
import type { CommentProvider, InboxErrorCode, InboxList } from "@/lib/inbox";
import { formatInstant } from "../calendar/dates";

/** Where each state's next step lives (states without a link are retried with Refresh, by hand). */
const STATE_LINK: Partial<Record<InboxErrorCode, { href: string; label: MessageKey }>> = {
  unconfigured: { href: "/settings#api-keys", label: "inbox.link.apiKeys" },
  auth: { href: "/settings#api-keys", label: "inbox.link.apiKeys" },
  not_connected: { href: "/settings#accounts", label: "inbox.link.accounts" },
  no_permission: { href: "/settings#accounts", label: "inbox.link.accounts" },
  token_expired: { href: "/settings#accounts", label: "inbox.link.accounts" },
};

/** Codes whose words name the platform: Threads and YouTube have their own (DT-6B-1). */
const PROVIDER_CODES: ReadonlySet<InboxErrorCode> = new Set<InboxErrorCode>([
  "not_configured",
  "not_connected",
  "token_expired",
  "no_permission",
  "rate_limited",
  "not_eligible",
  "upstream",
  "comments_disabled",
  "video_not_found",
]);

export function StateNote({
  code,
  provider,
}: {
  code: InboxErrorCode;
  provider?: CommentProvider;
}) {
  const { t } = useT();
  const own = provider && PROVIDER_CODES.has(code);
  // Threads reply reading is not requestable yet: no Settings step would help, so no link.
  const link = provider === "threads" && code === "no_permission" ? undefined : STATE_LINK[code];
  return (
    <div className="ios-row flex-wrap" role="status" data-testid="ibx-state" data-code={code}>
      <p className="min-w-[10rem] flex-1 text-[15px]">
        {t((own ? `inbox.state.${provider}.${code}` : `inbox.state.${code}`) as MessageKey)}
      </p>
      {link && (
        <Link href={link.href} className="px-link text-[15px]" data-testid="ibx-state-link">
          {t(link.label)}
        </Link>
      )}
    </div>
  );
}

const DIR_TONE = { in: "default", out: "tint", unknown: "warn" } as const;

export function DirectionChip({ dir }: { dir: "in" | "out" | "unknown" }) {
  const { t } = useT();
  return (
    <Chip tone={DIR_TONE[dir]} data-testid="ibx-dir" data-dir={dir}>
      {t(`inbox.dir.${dir}`)}
    </Chip>
  );
}

export function When({ iso }: { iso: string | null }) {
  const { t, lang } = useT();
  return (
    <span className="text-muted text-[13px]" data-testid="ibx-time">
      {iso ? formatInstant(iso, lang) : t("inbox.time.none")}
    </span>
  );
}

/**
 * Under a list: its own failure (with nothing shown), the empty line, then what the coverage honestly says, with
 * Load more while a sealed cursor is there (also after a partial failure: the owner retries by hand).
 */
export function ListFooter({
  list,
  empty,
  busy,
  onMore,
  provider,
  end,
}: {
  list: InboxList<unknown>;
  empty: MessageKey;
  busy: boolean;
  onMore: () => void;
  /** Threads / YouTube (DT-6B-1): their own state and end words. */
  provider?: CommentProvider;
  /** The end words when the list's own differ (YouTube threads: comments only, never their replies; DT-6B-1-R1). */
  end?: MessageKey;
}) {
  const { t } = useT();
  const { coverage } = list;
  if (coverage === null)
    return busy ? (
      <p className="text-muted px-4 text-[13px]" aria-busy data-testid="ibx-loading">
        {t("inbox.loading")}
      </p>
    ) : null;
  const line: MessageKey | null =
    coverage === "end"
      ? (end ?? (provider ? (`inbox.cov.end.${provider}` as MessageKey) : "inbox.cov.end"))
      : coverage === "cap"
        ? "inbox.cov.cap"
        : coverage === "partial"
          ? "inbox.cov.partial"
          : coverage === "history_unavailable"
            ? "inbox.cov.history"
            : null;
  return (
    <div className="flex flex-col gap-1.5" data-testid="ibx-footer" data-coverage={coverage}>
      {list.error && !list.items.length && coverage !== "history_unavailable" && (
        <div className="ios-list">
          <StateNote code={list.error} provider={provider} />
        </div>
      )}
      {!list.error && !list.items.length && (
        <p className="text-ink-2 px-4 text-[15px]" data-testid="ibx-empty">
          {t(empty)}
        </p>
      )}
      {line && <p className="text-muted px-4 text-[13px]">{t(line)}</p>}
      {list.next && (coverage === "more" || coverage === "partial") && (
        <button
          type="button"
          className="px-btn px-btn-ghost px-btn-sm self-start"
          disabled={busy}
          aria-busy={busy}
          onClick={onMore}
          data-testid="ibx-more"
        >
          {t("inbox.more")}
        </button>
      )}
    </div>
  );
}
