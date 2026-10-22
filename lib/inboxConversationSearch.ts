import type { ConversationItem } from "@/lib/inbox";

/**
 * DT-WIO-1: find loaded Instagram conversations by the other people's returned username or id. Pure and local: no
 * request, no storage. The match is a literal, case-insensitive substring after Unicode NFC. Nothing is folded
 * (Arabic letters stay different letters), no regular expression is built, and the owner is left out just as the
 * displayed names are. Rows come back in the order they came in.
 */

/** The longest query kept (characters). */
export const SEARCH_MAX = 200;

/** The query as it is kept: at most SEARCH_MAX characters, never splitting a surrogate pair. */
export function boundQuery(raw: string): string {
  return raw.length <= SEARCH_MAX ? raw : [...raw].slice(0, SEARCH_MAX).join("");
}

const fold = (s: string): string => s.normalize("NFC").toLowerCase().normalize("NFC");

/** The conversations whose non-owner participants' username or id contain the query; blank = the same array. */
export function matchConversations(
  items: ConversationItem[],
  accountId: string | undefined,
  rawQuery: string,
): ConversationItem[] {
  const q = fold(boundQuery(rawQuery).trim());
  if (!q) return items;
  return items.filter((c) =>
    c.participants.some(
      (p) =>
        p.id !== accountId &&
        ((p.username !== undefined && fold(p.username).includes(q)) ||
          (p.id !== undefined && fold(p.id).includes(q))),
    ),
  );
}
