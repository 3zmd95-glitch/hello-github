/**
 * The persisted shape rules of the reviewed-send inbox slices (DT-6A drafts, DT-6B send handles and DM controls) that
 * store/index.ts still parses. Copied unchanged from the DT-6B client modules (lib/inbox.ts, inboxThreadsSend.ts,
 * inboxInstagramSend.ts, inboxInstagramDmSend.ts, inboxInstagramDmControl.ts on codex/discover-inspiration), which stay
 * out of main until the DT-6B inbox PR. Nothing on main writes these slices: they are kept inert so an older save
 * still parses and restores the same way. Delete together with the slices when DT-6B lands or is dropped.
 */

/** A draft's longest text (characters). */
export const INBOX_DRAFT_MAX = 2000;
/** Drafts kept on this device; the oldest go first. */
export const INBOX_DRAFTS_MAX = 200;

/** Where a reviewed YouTube send operation stands on the Worker. */
export const SEND_STATES = [
  "prepared",
  "dispatching",
  "sent",
  "rejected",
  "unknown",
  "expired",
  "cancelled",
] as const;

/** Where a Threads operation stands on the Worker. */
export const THREADS_SEND_STATES = [
  "prepared",
  "creating",
  "created",
  "publishing",
  "published",
  "rejected",
  "cancelled",
  "expired",
  "unknown_creation",
  "unknown_publication",
] as const;

export const IG_SEND_STATES = [
  "prepared",
  "dispatching",
  "sent",
  "rejected",
  "unknown",
  "already_claimed",
  "expired",
  "cancelled",
] as const;

export const DM_SEND_STATES = [
  "prepared",
  "dispatching",
  "sent",
  "rejected",
  "unknown",
  "already_claimed",
  "cancelled",
  "expired",
] as const;

/** The Worker's DM id rule. */
export const DM_ID_RE = /^[A-Za-z0-9_=-]{1,256}$/;
/** A provider message id: non-empty printable text without spaces. */
export const DM_MESSAGE_ID_RE = /^[\x21-\x7e]{1,512}$/;

/** The handle key of one inbound message: Worker origin | account | conversation | inbound message (each encoded). */
export const dmOpKey = (
  origin: string,
  account: string,
  conversationId: string,
  inboundMessageId: string,
): string => [origin, account, conversationId, inboundMessageId].map(encodeURIComponent).join("|");

/** The control key of one conversation: Worker origin | account | conversation (each encoded). */
export const dmControlKey = (origin: string, account: string, conversationId: string): string =>
  [origin, account, conversationId].map(encodeURIComponent).join("|");
