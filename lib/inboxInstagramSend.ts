import { z } from "zod";
import { sha256Hex } from "./digest";
import type { ScoutConfig } from "./scoutClient";

/**
 * 📤 Reviewed Instagram public comment replies, client wire (packet DT-6B-2C-4, planning/tools/37-inbox-send.md): strict
 * parsers and the transport for the Worker's `/social/inbox/instagram/send/*` routes
 * (workers/scout/src/social/inboxSendInstagram.ts). Separate from the YouTube and Threads clients. Nothing here throws;
 * failures are typed.
 *
 * Text is trim-only (≤ 1000 code points) and its digest is SHA-256 of the exact trimmed text: not the DM NFC/body rules.
 * The intent's `generation` is the SEND generation (`ig-send-gen|account|stamp`), learned from Prepare and bound after
 * that; the Inbox reader's HMAC generation is a different value and is never compared to it. Receipts are
 * state-specific (`sent` carries its reply id, `rejected` its code, `unknown` its reason — with or without a settled time
 * — and `already_claimed` its holder); a proof of another state is a contradiction and the answer is rejected. An
 * envelope that mixes an intent with an error, or carries unknown keys, is never proof. No reply link is ever built.
 */

/** The longest reply text in Unicode code points after trimming (the Worker's IG_SEND_TEXT_MAX). */
export const IG_SEND_TEXT_MAX = 1000;

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
export type InstagramSendState = (typeof IG_SEND_STATES)[number];

/** Who holds a comment an `already_claimed` operation lost to. */
export const IG_SEND_HOLDERS = ["automatic", "manual", "retired"] as const;

export type InstagramSendErrorCode =
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
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "upstream"
  | "receipt_unavailable"
  /** Client side only: the answer named another operation, account, target, revision, text or send generation. */
  | "mismatch";

const CODES: ReadonlySet<string> = new Set<InstagramSendErrorCode>([
  "not_configured",
  "not_connected",
  "no_permission",
  "token_expired",
  "stale",
  "account_mismatch",
  "bad_request",
  "text_invalid",
  "target_unverified",
  "not_found",
  "conflict",
  "rate_limited",
  "upstream",
  "receipt_unavailable",
]);

/** The only details kept, per code; anything else (provider words included) is dropped. */
const DETAILS = {
  not_configured: ["kv", "receipt-store"],
  no_permission: ["permission_unverified"],
  account_mismatch: ["identity"],
  target_unverified: ["outside-local-window"],
  stale: ["reconnected"],
} as const;
export type InstagramSendDetail = (typeof DETAILS)[keyof typeof DETAILS][number];

const Id = z.string().regex(/^[A-Za-z0-9_-]{1,256}$/);
const Stamp = z
  .string()
  .max(40)
  .refine((t) => !Number.isNaN(Date.parse(t)));
const Words = z.string().min(1).max(300);

const PROOF_KEYS = [
  "claimedAt",
  "settledAt",
  "providerReplyId",
  "failureCode",
  "failureDetail",
  "unknownReason",
] as const;
type ProofKey = (typeof PROOF_KEYS)[number];
/**
 * DT-6B-2C-4-R1 (2C4-5): the proof each public state carries, from the accepted coordinator's real answers
 * (InstagramPublicSendCoordinator through inboxSendInstagram.ts), never the DM protocol. A prepared review has no claim;
 * cancel and expiry end it unclaimed; `already_claimed` lost the claim (no own claim or settlement, the holder named);
 * dispatching holds its claim, unsettled; sent holds claim, settlement and the reply id; rejected names its code;
 * unknown names its reason, with its settled time only when the receipt was written (the lost-receipt answer derives
 * from the dispatching intent). Anything not listed is a contradiction.
 */
const PROOF: Record<InstagramSendState, { must: readonly ProofKey[]; may: readonly ProofKey[] }> = {
  prepared: { must: [], may: [] },
  dispatching: { must: ["claimedAt"], may: [] },
  sent: { must: ["claimedAt", "settledAt", "providerReplyId"], may: [] },
  rejected: { must: ["failureCode"], may: ["claimedAt", "settledAt", "failureDetail"] },
  unknown: { must: ["unknownReason"], may: ["claimedAt", "settledAt"] },
  already_claimed: { must: ["failureDetail"], may: ["failureCode"] },
  expired: { must: [], may: [] },
  cancelled: { must: [], may: [] },
};

const IntentSchema = z
  .strictObject({
    operationId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
    provider: z.literal("instagram"),
    account: Id,
    /** The send generation (never the reader's). */
    generation: z.string().regex(/^[0-9a-f]{32}$/),
    mediaId: Id,
    commentId: Id,
    text: z
      .string()
      .min(1)
      .refine((t) => t === t.trim() && Array.from(t).length <= IG_SEND_TEXT_MAX),
    digest: z.string().regex(/^[0-9a-f]{64}$/),
    draftRevision: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    state: z.enum(IG_SEND_STATES),
    reviewExpiresAt: Stamp,
    createdAt: Stamp,
    updatedAt: Stamp,
    claimedAt: Stamp.optional(),
    settledAt: Stamp.optional(),
    providerReplyId: Id.optional(),
    failureCode: z.string().min(1).max(64).optional(),
    failureDetail: Words.optional(),
    unknownReason: z.string().min(1).max(32).optional(),
    receiptVersion: z.number().int().min(1),
  })
  .refine((i) => {
    const { must, may } = PROOF[i.state];
    // Every proof the state needs is there; any other proof contradicts it.
    return (
      must.every((k) => i[k] !== undefined) &&
      PROOF_KEYS.every((k) => i[k] === undefined || must.includes(k) || may.includes(k)) &&
      (i.state !== "already_claimed" ||
        (IG_SEND_HOLDERS as readonly string[]).includes(i.failureDetail ?? ""))
    );
  });
export type InstagramIntent = z.infer<typeof IntentSchema>;

export function parseInstagramIntent(raw: unknown): InstagramIntent | null {
  const r = IntentSchema.safeParse(raw);
  return r.success ? r.data : null;
}

/** The digest the Worker binds a reviewed text to: SHA-256 hex of the exact trimmed text (no normalization). */
export const instagramSendDigest = (text: string): string => sha256Hex(text.trim());

export type InstagramSendResult =
  | { ok: true; intent: InstagramIntent }
  | { ok: false; error: InstagramSendErrorCode; detail?: InstagramSendDetail };

/**
 * What the client already knows about an operation. `operationId` is left out only for Prepare (the Worker may answer
 * another tab's operation for the same submission). Everything else optional is checked when known, never invented.
 * There is deliberately no reader generation here.
 */
export interface InstagramExpect {
  operationId?: string;
  account: string;
  draftRevision: string;
  digest: string;
  mediaId?: string;
  commentId?: string;
  text?: string;
  /** The send generation learned from Prepare. */
  sendGeneration?: string;
  /** A recorded reply id is immutable proof. */
  providerReplyId?: string;
}

const WHEN_KNOWN = ["mediaId", "commentId", "text"] as const;

/** An answer about anything other than the expected operation is `mismatch`: never shown, never recorded. */
export function bindInstagramIntent(
  r: InstagramSendResult,
  e: InstagramExpect,
): InstagramSendResult {
  if (!r.ok) return r;
  const i = r.intent;
  const same =
    (e.operationId === undefined || i.operationId === e.operationId) &&
    i.account === e.account &&
    i.draftRevision === e.draftRevision &&
    i.digest === e.digest &&
    instagramSendDigest(i.text) === i.digest &&
    WHEN_KNOWN.every((k) => e[k] === undefined || i[k] === e[k]) &&
    (e.sendGeneration === undefined || i.generation === e.sendGeneration) &&
    (e.providerReplyId === undefined ||
      i.providerReplyId === undefined ||
      i.providerReplyId === e.providerReplyId);
  return same ? r : { ok: false, error: "mismatch" };
}

/**
 * Readiness to prepare or send an Instagram public reply. Production is closed: the public-endpoint permission/API-version
 * semantics and a trusted record of what the account granted are unverified (the Worker's gate answers the same
 * literal). It never reads reader capabilities, saved scopes, `canReply`, settings or receipts; only a later reviewed
 * packet with verified authority may change this function. Tests inject `{ ok: true }`; there is no shipped switch.
 * Recovery (Check status, Cancel of a prepared review) never asks it.
 */
export type InstagramSendReadiness = { ok: true } | { ok: false; reason: "permission_unverified" };
export function instagramSendReadiness(): InstagramSendReadiness {
  return { ok: false, reason: "permission_unverified" };
}

const ENVELOPE: ReadonlySet<string> = new Set(["intent", "verification"]);

/** One authenticated send call; only a pure envelope whose intent parses is a success. Redirects are never followed. */
async function call(
  cfg: ScoutConfig | null,
  method: "GET" | "POST",
  path: string,
  body: unknown,
  fetchImpl?: typeof fetch,
): Promise<InstagramSendResult> {
  if (!cfg) return { ok: false, error: "unconfigured" };
  const doFetch = fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(`${cfg.url}/social/inbox/instagram/send${path}`, {
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
    const pure = !!data && Object.keys(data).every((k) => ENVELOPE.has(k));
    const intent = pure ? parseInstagramIntent(data!.intent) : null;
    return intent ? { ok: true, intent } : { ok: false, error: "upstream" };
  }
  const raw = data?.error;
  if (res.status === 401 || raw === "unauthorized" || raw === "origin")
    return { ok: false, error: "auth" };
  // A refusal is `{ error, detail? }` only; an error beside anything else is unreadable.
  const pure = !!data && Object.keys(data).every((k) => k === "error" || k === "detail");
  const error =
    pure && typeof raw === "string" && CODES.has(raw)
      ? (raw as InstagramSendErrorCode)
      : "upstream";
  const known = (DETAILS as Record<string, readonly string[]>)[error];
  const detail = known?.includes(data?.detail as string)
    ? (data!.detail as InstagramSendDetail)
    : undefined;
  return { ok: false, error, ...(detail ? { detail } : {}) };
}

export const prepareInstagramSend = (
  cfg: ScoutConfig | null,
  body: {
    operationId: string;
    account: string;
    mediaId: string;
    commentId: string;
    text: string;
    draftRevision: string;
  },
  fetchImpl?: typeof fetch,
) => call(cfg, "POST", "/prepare", body, fetchImpl);

export const confirmInstagramSend = (
  cfg: ScoutConfig | null,
  body: { operationId: string; digest: string; account: string },
  fetchImpl?: typeof fetch,
) => call(cfg, "POST", "/confirm", body, fetchImpl);

export const instagramSendStatus = (
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

export const cancelInstagramSend = (
  cfg: ScoutConfig | null,
  operationId: string,
  account: string,
  fetchImpl?: typeof fetch,
) => call(cfg, "POST", `/${encodeURIComponent(operationId)}/cancel`, { account }, fetchImpl);
