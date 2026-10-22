import { z } from "zod";
import { sha256Hex } from "./digest";
import type { ScoutConfig } from "./scoutClient";

/**
 * 💬 Reviewed existing-conversation Instagram DMs, client wire (packet DT-6B-2C-5A, planning/tools/37-inbox-send.md):
 * strict parsers and the transport for the Worker's `/social/inbox/instagram/dm/send/*` routes
 * (workers/scout/src/social/inboxSendInstagramDm.ts). Separate from the public-reply, Threads and YouTube clients, and
 * never the takeover/resume control routes. Nothing here throws; failures are typed.
 *
 * The DM protocol is its own: the intent has no `provider` field; conversation, recipient and message ids follow the
 * Worker's DM_ID_RE (base64-style `=` allowed); the canonical text is trim → NFC → trim (well-formed; a new send at most
 * 1000 UTF-8 bytes, a receipt at most 1000 code points so older receipts keep parsing, DT-6B-3C) and the digest is SHA-256 of the exact POST body `{"recipient":{"id":…},"message":{"text":…}}` (never the public
 * trim-only text digest). The intent's `generation` is the DM SEND generation (`ig-dm-gen|account|stamp`), learned from
 * Prepare and bound after that; the reader's HMAC generation is never compared to it. The Worker-proven `inboundAt` is
 * learned from Prepare and bound after that. Receipts carry exactly their state's proof (the Worker's PROOF table). A lost
 * settlement is the HTTP 200 envelope `{ intent: <dispatching>, observed, settlement: "pending" }`: the durable truth
 * stays dispatching and `observed` is only uncertainty (never a rejection, never a success). No message link is built.
 */

/** The receipt format bound in Unicode code points (the earlier send policy; old receipts keep parsing under it). */
export const DM_TEXT_MAX = 1000;
/** The longest NEW manual DM message.text in UTF-8 bytes after canonicalization (the Worker's DM_TEXT_BYTES_MAX). */
export const DM_TEXT_BYTES_MAX = 1000;

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
export type DmSendState = (typeof DM_SEND_STATES)[number];

/** Who holds an inbound message an `already_claimed` operation lost to. */
export const DM_HOLDERS = ["automatic", "manual", "retired"] as const;

/** The Worker's DM id rule (instagramDmCoordinator.ts DM_ID_RE). */
export const DM_ID_RE = /^[A-Za-z0-9_=-]{1,256}$/;
const ACCOUNT_RE = /^[A-Za-z0-9_-]{1,256}$/;
const OP_RE = /^[A-Za-z0-9_-]{8,64}$/;
const REVISION_RE = /^[A-Za-z0-9_-]{1,64}$/;
/** A typed failure code (`meta_10`) and an unknown reason (`receipt`), as the coordinator bounds them. */
const CODE_RE = /^[a-z0-9_]{1,64}$/;
const REASON_RE = /^[a-z_-]{1,64}$/;
/** A provider message id: non-empty printable text without spaces (coordinator MESSAGE_ID_RE). */
export const DM_MESSAGE_ID_RE = /^[\x21-\x7e]{1,512}$/;

export type DmErrorCode =
  | "unconfigured"
  | "auth"
  | "network"
  | "not_configured"
  | "not_connected"
  | "no_permission"
  | "token_expired"
  | "stale"
  | "account_mismatch"
  | "bad_request"
  | "text_invalid"
  | "target_unverified"
  | "target_invalid"
  | "not_found"
  | "conflict"
  | "capacity"
  | "rate_limited"
  | "upstream"
  | "receipt_unavailable"
  /** Client side only: the answer named another operation, account, target, time, revision, text or generation. */
  | "mismatch";

const CODES: ReadonlySet<string> = new Set<DmErrorCode>([
  "not_configured",
  "not_connected",
  "no_permission",
  "token_expired",
  "stale",
  "account_mismatch",
  "bad_request",
  "text_invalid",
  "target_unverified",
  "target_invalid",
  "not_found",
  "conflict",
  "capacity",
  "rate_limited",
  "upstream",
  "receipt_unavailable",
]);

/** The only details kept, per code (the Worker's own fixed words); anything else, provider words included, is dropped. */
const DETAILS = {
  not_configured: ["kv", "dm-claim-store"],
  no_permission: ["permission_unverified"],
  account_mismatch: ["identity"],
  target_unverified: ["outside-local-window"],
  target_invalid: [
    "own-message",
    "mixed-senders",
    "foreign-recipient",
    "future-time",
    "window-closed",
    "inbound-changed",
    "foreign-conversation",
    "ambiguous-message",
    "ambiguous-identity",
  ],
  stale: ["reconnected"],
} as const;
export type DmDetail = (typeof DETAILS)[keyof typeof DETAILS][number];

/**
 * Receipt canonical format: trim, NFC, trim; null when empty, longer than DM_TEXT_MAX code points or not well-formed.
 * The earlier send policy, kept so receipts stored under it keep parsing in every state (DT-6B-3C); never new-send
 * eligibility (that is `dmTextEligible`).
 */
export function dmCanonicalText(v: string): string | null {
  const t = v.trim().normalize("NFC").trim();
  if (!t || t.normalize("NFC") !== t || /\p{Cs}/u.test(t)) return null;
  return Array.from(t).length <= DM_TEXT_MAX ? t : null;
}

/** The UTF-8 length of a text (what Meta's message.text limit counts). */
export const dmTextBytes = (t: string): number => new TextEncoder().encode(t).length;

/**
 * New-send eligibility (DT-6B-3C, the Worker's canonicalText): the canonical text when its UTF-8 encoding is at most
 * DM_TEXT_BYTES_MAX bytes, else null. Never truncates, splits or replaces anything.
 */
export function dmTextEligible(v: string): string | null {
  const t = dmCanonicalText(v);
  return t !== null && dmTextBytes(t) <= DM_TEXT_BYTES_MAX ? t : null;
}

/** SHA-256 hex of the exact UTF-8 bytes of the DM POST body, in this field order (the Worker's manualBody). */
export const dmBodyDigest = (recipientId: string, canonicalText: string): string =>
  sha256Hex(JSON.stringify({ recipient: { id: recipientId }, message: { text: canonicalText } }));

/** The handle key of one inbound message: Worker origin | account | conversation | inbound message (each encoded). */
export const dmOpKey = (
  origin: string,
  account: string,
  conversationId: string,
  inboundMessageId: string,
): string => [origin, account, conversationId, inboundMessageId].map(encodeURIComponent).join("|");

/** An exact `Date#toISOString()` time (the Worker's isIso). */
const Iso = z.string().refine((t) => {
  const ms = Date.parse(t);
  return Number.isFinite(ms) && new Date(ms).toISOString() === t;
});
const DmId = z.string().regex(DM_ID_RE);

const PROOF_KEYS = [
  "claimedAt",
  "settledAt",
  "providerMessageId",
  "failureCode",
  "failureDetail",
  "unknownReason",
] as const;
/**
 * Each DM state's exact proof, copied from the Worker's PROOF table (inboxSendInstagramDm.ts, DT-6B-2C-3-R1): these
 * fields are required and every other proof field is absent. Not the public table: a DM `unknown` is always settled.
 */
const PROOF: Record<DmSendState, readonly (typeof PROOF_KEYS)[number][]> = {
  prepared: [],
  dispatching: ["claimedAt"],
  sent: ["claimedAt", "settledAt", "providerMessageId"],
  rejected: ["claimedAt", "settledAt", "failureCode"],
  unknown: ["claimedAt", "settledAt", "unknownReason"],
  already_claimed: ["failureCode", "failureDetail"],
  cancelled: [],
  expired: [],
};

const IntentSchema = z
  .strictObject({
    operationId: z.string().regex(OP_RE),
    account: z.string().regex(ACCOUNT_RE),
    /** The DM send generation (never the reader's). */
    generation: z.string().regex(/^[0-9a-f]{32}$/),
    conversationId: DmId,
    recipientId: DmId,
    inboundMessageId: DmId,
    inboundAt: Iso,
    text: z.string().refine((t) => dmCanonicalText(t) === t),
    digest: z.string().regex(/^[0-9a-f]{64}$/),
    draftRevision: z.string().regex(REVISION_RE),
    state: z.enum(DM_SEND_STATES),
    reviewExpiresAt: Iso,
    createdAt: Iso,
    updatedAt: Iso,
    claimedAt: Iso.optional(),
    settledAt: Iso.optional(),
    providerMessageId: z.string().regex(DM_MESSAGE_ID_RE).optional(),
    failureCode: z.string().regex(CODE_RE).optional(),
    failureDetail: z.enum(DM_HOLDERS).optional(),
    unknownReason: z.string().regex(REASON_RE).optional(),
    receiptVersion: z.number().int().min(1),
  })
  .refine((i) => {
    const need = PROOF[i.state];
    return (
      PROOF_KEYS.every((k) => (need.includes(k) ? i[k] !== undefined : i[k] === undefined)) &&
      (i.state !== "already_claimed" || i.failureCode === "already_claimed")
    );
  });
export type DmIntent = z.infer<typeof IntentSchema>;

export function parseDmIntent(raw: unknown): DmIntent | null {
  const r = IntentSchema.safeParse(raw);
  return r.success ? r.data : null;
}

/** What a lost settlement observed (the provider's words dropped): never a durable outcome. */
export type DmObserved = { observed: "unknown" | "rejected"; code: string };

const ObservedSchema = z.union([
  z.strictObject({ state: z.literal("unknown"), reason: z.string().regex(REASON_RE) }),
  z.strictObject({
    state: z.literal("rejected"),
    code: z.string().regex(CODE_RE),
    detail: z.string().optional(),
  }),
]);

export type DmResult =
  | { ok: true; intent: DmIntent; pending?: DmObserved }
  | { ok: false; error: DmErrorCode; detail?: DmDetail };

/**
 * What the client already knows about an operation. `operationId` is left out only for Prepare (the Worker may answer
 * the identical submission's operation). Everything else optional is checked when known, never invented. `inboundAt` is
 * the Worker-proven time learned from Prepare; `rowAt` is the selected row's own time (compared by instant). There is
 * deliberately no reader generation here.
 */
export interface DmExpect {
  operationId?: string;
  account: string;
  conversationId: string;
  recipientId: string;
  inboundMessageId: string;
  inboundAt?: string;
  rowAt?: string;
  draftRevision: string;
  digest: string;
  text?: string;
  /** The DM send generation learned from Prepare. */
  sendGeneration?: string;
  /** A recorded message id is immutable proof. */
  providerMessageId?: string;
}

/** An answer about anything other than the expected operation is `mismatch`: never shown, never recorded. */
export function bindDmIntent(r: DmResult, e: DmExpect): DmResult {
  if (!r.ok) return r;
  const i = r.intent;
  const same =
    (e.operationId === undefined || i.operationId === e.operationId) &&
    i.account === e.account &&
    i.conversationId === e.conversationId &&
    i.recipientId === e.recipientId &&
    i.inboundMessageId === e.inboundMessageId &&
    (e.inboundAt === undefined || i.inboundAt === e.inboundAt) &&
    (e.rowAt === undefined || Date.parse(i.inboundAt) === Date.parse(e.rowAt)) &&
    i.draftRevision === e.draftRevision &&
    i.digest === e.digest &&
    dmBodyDigest(i.recipientId, i.text) === i.digest &&
    (e.text === undefined || i.text === e.text) &&
    (e.sendGeneration === undefined || i.generation === e.sendGeneration) &&
    (e.providerMessageId === undefined ||
      i.providerMessageId === undefined ||
      i.providerMessageId === e.providerMessageId);
  return same ? r : { ok: false, error: "mismatch" };
}

/**
 * Readiness to prepare or send an Instagram DM. Production is closed: DM permission, window and API-version semantics and
 * a trusted record of actual grants are unverified (the Worker's gate answers the same literal). It never reads reader
 * capabilities, saved scopes, `canReply`, settings or receipts; only a later reviewed packet with verified authority may
 * change this function. Tests inject `{ ok: true }`; there is no shipped switch. Recovery (Check status, Cancel of a
 * prepared review) never asks it.
 */
export type DmSendReadiness = { ok: true } | { ok: false; reason: "permission_unverified" };
export function instagramDmSendReadiness(): DmSendReadiness {
  return { ok: false, reason: "permission_unverified" };
}

const ENVELOPE: ReadonlySet<string> = new Set(["intent", "verification"]);
const PENDING: ReadonlySet<string> = new Set(["intent", "observed", "settlement"]);

/**
 * One authenticated DM send call; only a pure envelope whose intent parses is a success (for Confirm also the exact
 * pending envelope over a dispatching intent). Redirects are never followed.
 */
async function call(
  cfg: ScoutConfig | null,
  method: "GET" | "POST",
  path: string,
  body: unknown,
  fetchImpl: typeof fetch | undefined,
  pendingAllowed = false,
): Promise<DmResult> {
  if (!cfg) return { ok: false, error: "unconfigured" };
  const doFetch = fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(`${cfg.url}/social/inbox/instagram/dm/send${path}`, {
      method,
      redirect: "manual",
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
      },
      ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    return { ok: false, error: "network" };
  }
  // A redirect (opaque or not) is never followed and never proof.
  if (res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400))
    return { ok: false, error: "upstream" };
  let data: Record<string, unknown> | null;
  try {
    const v: unknown = await res.json();
    data = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    data = null;
  }
  if (res.ok) {
    if (!data) return { ok: false, error: "upstream" };
    const keys = Object.keys(data);
    if (pendingAllowed && "settlement" in data) {
      // The lost settlement: exactly these three keys, a dispatching intent, and a typed observation.
      const intent = parseDmIntent(data.intent);
      const seen = ObservedSchema.safeParse(data.observed);
      if (
        keys.length !== 3 ||
        !keys.every((k) => PENDING.has(k)) ||
        data.settlement !== "pending" ||
        intent?.state !== "dispatching" ||
        !seen.success
      )
        return { ok: false, error: "upstream" };
      const o = seen.data;
      return {
        ok: true,
        intent,
        pending:
          o.state === "unknown"
            ? { observed: "unknown", code: o.reason }
            : { observed: "rejected", code: o.code },
      };
    }
    const intent = keys.every((k) => ENVELOPE.has(k)) ? parseDmIntent(data.intent) : null;
    return intent ? { ok: true, intent } : { ok: false, error: "upstream" };
  }
  const raw = data?.error;
  if (res.status === 401 || raw === "unauthorized" || raw === "origin")
    return { ok: false, error: "auth" };
  // A refusal is `{ error, detail? }` only; an error beside anything else is unreadable.
  const pure = !!data && Object.keys(data).every((k) => k === "error" || k === "detail");
  const error =
    pure && typeof raw === "string" && CODES.has(raw) ? (raw as DmErrorCode) : "upstream";
  const known = (DETAILS as Record<string, readonly string[]>)[error];
  const detail = known?.includes(data?.detail as string) ? (data!.detail as DmDetail) : undefined;
  return { ok: false, error, ...(detail ? { detail } : {}) };
}

export const prepareInstagramDm = (
  cfg: ScoutConfig | null,
  body: {
    operationId: string;
    account: string;
    conversationId: string;
    recipientId: string;
    inboundMessageId: string;
    text: string;
    draftRevision: string;
  },
  fetchImpl?: typeof fetch,
) => call(cfg, "POST", "/prepare", body, fetchImpl);

export const confirmInstagramDm = (
  cfg: ScoutConfig | null,
  body: { operationId: string; digest: string; account: string },
  fetchImpl?: typeof fetch,
) => call(cfg, "POST", "/confirm", body, fetchImpl, true);

export const instagramDmStatus = (
  cfg: ScoutConfig | null,
  operationId: string,
  account: string,
  fetchImpl?: typeof fetch,
) =>
  call(
    cfg,
    "GET",
    `/${encodeURIComponent(operationId)}?${new URLSearchParams({ account })}`,
    undefined,
    fetchImpl,
  );

export const cancelInstagramDm = (
  cfg: ScoutConfig | null,
  operationId: string,
  account: string,
  fetchImpl?: typeof fetch,
) => call(cfg, "POST", `/${encodeURIComponent(operationId)}/cancel`, { account }, fetchImpl);
