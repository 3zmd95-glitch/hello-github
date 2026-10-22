"use client";

import { MessageCircle } from "lucide-react";
import { useId, useRef, useState } from "react";
import { useT } from "@/lib/i18n";
import type { ConversationItem } from "@/lib/inbox";
import { SEARCH_MAX, boundQuery, matchConversations } from "@/lib/inboxConversationSearch";
import { ListFooter, When } from "./parts";
import { listOf, loadMore, selectConversation, useInbox } from "./useInbox";

/** The other people in a conversation (the account itself left out), or null when Instagram named nobody. */
export function otherNames(c: ConversationItem, accountId: string | undefined): string | null {
  const names = c.participants
    .filter((p) => p.id !== accountId)
    .map((p) => p.username ?? p.id)
    .filter(Boolean);
  return names.length ? names.join("، ") : null;
}

/**
 * Conversations Instagram shares, newest first as it sends them; a row opens the conversation. DT-WIO-1: the search
 * is keyed by the reader identity (Worker origin, account id, generation), so another connection or account starts
 * with an empty one (a remount, as the lists themselves start over); it lives in memory only.
 */
export default function ConversationList() {
  const origin = useInbox((s) => s.origin);
  const accountId = useInbox((s) => s.account?.accountId);
  const generation = useInbox((s) => s.account?.generation);
  return <Conversations key={JSON.stringify([origin, accountId, generation])} />;
}

function Conversations() {
  const { t } = useT();
  useInbox((s) => s.lists);
  const accountId = useInbox((s) => s.account?.accountId);
  const busy = useInbox((s) => Object.values(s.busy).some(Boolean));
  const list = listOf<ConversationItem>("conversations");
  const [query, setQuery] = useState("");
  const field = useRef<HTMLInputElement>(null);
  const fieldId = useId();
  const noteId = `${fieldId}-note`;
  const loaded = list.items.length;
  // Only the rows shown are filtered; the footer below always gets the original list (coverage, errors, Load more).
  const shown = matchConversations(list.items, accountId, query);
  const searching = query.trim() !== "";
  return (
    <div className="flex flex-col gap-2">
      {loaded > 0 && (
        <div className="flex flex-col gap-1.5 px-4" role="search" data-testid="ibx-search-box">
          <label htmlFor={fieldId} className="text-ink-2 text-[13px]">
            {t("inbox.search.label")}
          </label>
          <div className="flex items-center gap-2">
            <input
              ref={field}
              id={fieldId}
              type="text"
              className="px-input min-w-0 flex-1"
              dir="auto"
              value={query}
              maxLength={SEARCH_MAX}
              placeholder={t("inbox.search.placeholder")}
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="search"
              aria-describedby={noteId}
              onChange={(e) => setQuery(boundQuery(e.target.value))}
              data-testid="ibx-search"
            />
            {query !== "" && (
              <button
                type="button"
                className="px-btn px-btn-ghost px-btn-sm shrink-0"
                onClick={() => {
                  setQuery("");
                  field.current?.focus();
                }}
                data-testid="ibx-search-clear"
              >
                {t("inbox.search.clear")}
              </button>
            )}
          </div>
          <p className="text-muted num text-[13px]" role="status" data-testid="ibx-search-count">
            {searching
              ? t("inbox.search.count", { n: shown.length, total: loaded })
              : t("inbox.search.loaded", { total: loaded })}
          </p>
          <p id={noteId} className="text-muted text-[13px]" data-testid="ibx-search-note">
            {t("inbox.search.note")}
          </p>
        </div>
      )}
      {shown.length > 0 && (
        <ul className="ios-list">
          {shown.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className="ios-row w-full text-start"
                onClick={() => void selectConversation(c.id)}
                data-testid="ibx-conv"
                data-id={c.id}
              >
                <span className="ios-ic fill">
                  <MessageCircle size={20} strokeWidth={1.75} aria-hidden />
                </span>
                <span className="ios-tx min-w-0">
                  <b>
                    <bdi dir="auto">
                      {otherNames(c, accountId) ?? t("inbox.conversation.unknown")}
                    </bdi>
                  </b>
                  <small>
                    <When iso={c.updatedAt} />
                  </small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {loaded > 0 && shown.length === 0 && (
        <p className="text-ink-2 px-4 text-[15px]" data-testid="ibx-search-nomatch">
          {t("inbox.search.none")}
        </p>
      )}
      <ListFooter
        list={list}
        empty="inbox.empty.conversations"
        busy={busy}
        onMore={() => void loadMore("conversations")}
      />
    </div>
  );
}
