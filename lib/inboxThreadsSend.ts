import { z } from "zod";
import { sha256Hex } from "./digest";
import type { ScoutConfig } from "./scoutClient";

/**
 * 📤 Reviewed Threads replies, client wire (packet DT-6B-2B-2, planning/tools/37-inbox-send.md): strict parsers and
 * the transport for the Worker's `/social/inbox/threads/send/*` routes (workers/scout/src/social/inboxSendThreads.ts).
 * Separate from the YouTube send client in lib/inbox.ts: its own states (two provider stages, each behind its own
 * claim), its own receipts and its own integer `receiptVersion`. Nothing here throws; failures are typed.
 *
 * Receipts are stage-specific: `created` and `publishing` carry the container id, `published` the container and the
 * published id, `rejected` its failure code, `unknown_creation` / `unknown_publication` their reason; a proof that
 * belongs to another stage is a contradiction and the answer is rejected. No reply link is ever built from an id.
 */

/** The longest reply text in Unicode code points after trimming: the Worker's local policy (THREADS_SEND_TEXT_MAX). */
export const THREADS_SEND_TEXT_MAX = 500;

/** Where a Threads operation stands on the Worker (threadsSendCoordinator.ts). */
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
export type ThreadsSendState = (typeof THREADS_SEND_STATES)[number];

export type ThreadsSendErrorCode =
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
  | "target_invalid"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "upstream"
  | "receipt_unavailable"
  /** Client side only: the answer named another operation, account, target, revision or text. */
  | "mismatch";

const CODES: ReadonlySet<string> = new Set<ThreadsSendErrorCode>([
  "not_configured",
  "not_connected",
  "no_permission",
  "token_expired",
  "stale",
  "account_mismatch",
  "bad_request",
  "text_invalid",
  "target_invalid",
  "not_found",
  "conflict",
  "rate_limited",
  "upstream",
  "receipt_unavailable",
]);

/** The details the Worker names, per code: setup (`not_configured`), readiness (`no_permission`), token identity. */
const DETAILS = {
  not_configured: ["kv", "seal", "receipt-store"],
  no_permission: ["permission_unverified"],
  account_mismatch: ["identity"],
} as const;
export type ThreadsSendDetail = (typeof DETAILS)[keyof typeof DETAILS][number];

const Id = z.string().regex(/^[A-Za-z0-9_-]{1,256}$/);
const Stamp = z.string().max(40);

const IntentSchema = z
  .strictObject({
    operationId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
    provider: z.literal("threads"),
    account: Id,
    generation: z.string().regex(/^[0-9a-f]{32}$/),
    rootPostId: Id,
    replyToId: Id,
    text: z
      .string()
      .min(1)
      .refine((t) => Array.from(t).length <= THREADS_SEND_TEXT_MAX),
    digest: z.string().regex(/^[0-9a-f]{64}$/),
    draftRevision: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    state: z.enum(THREADS_SEND_STATES),
    reviewExpiresAt: Stamp,
    createdAt: Stamp,
    updatedAt: Stamp,
    createClaimedAt: Stamp.optional(),
    containerId: Id.optional(),
    containerRecordedAt: Stamp.optional(),
    publishClaimedAt: Stamp.optional(),
    publishedId: Id.optional(),
    failureCode: z.string().min(1).max(64).optional(),
    failureDetail: z.string().max(300).optional(),
    unknownReason: z.string().min(1).max(32).optional(),
    receiptVersion: z.number().int().nonnegative(),
  })
  .refine((i) => {
    const container = !!i.containerId;
    const stage = {
      prepared: !container,
      creating: !container,
      created: container,
      publishing: container,
      published: container && !!i.publishedId,
      rejected: !!i.failureCode,
      cancelled: !container,
      expired: !container,
      unknown_creation: !container && !!i.unknownReason,
      unknown_publication: !!i.unknownReason,
    }[i.state];
    // Proofs of another stage contradict this one.
    return (
      stage &&
      (i.state === "published" || !i.publishedId) &&
      (i.state === "rejected" || (!i.failureCode && !i.failureDetail)) &&
      (i.state.startsWith("unknown_") || !i.unknownReason)
    );
  });
export type ThreadsIntent = z.infer<typeof IntentSchema>;

export function parseThreadsIntent(raw: unknown): ThreadsIntent | null {
  const r = IntentSchema.safeParse(raw);
  return r.success ? r.data : null;
}

/** The digest the Worker binds a reviewed text to: SHA-256 hex of the trimmed text. */
export const threadsSendDigest = (text: string): string => sha256Hex(text.trim());

export type ThreadsSendResult =
  | { ok: true; intent: ThreadsIntent }
  | { ok: false; error: ThreadsSendErrorCode; detail?: ThreadsSendDetail };

/**
 * What the client already knows about an operation. `operationId` is left out only for Prepare (the Worker may answer
 * another tab's operation for the same submission). Everything else optional is checked when known, never invented.
 */
export interface ThreadsExpect {
  operationId?: string;
  account: string;
  draftRevision: string;
  digest: string;
  generation?: string;
  rootPostId?: string;
  replyToId?: string;
  text?: string;
  containerId?: string;
  /** DT-6B-2B-2-R1 (2B2-1): a recorded publication id is immutable proof, like the container id, at any version. */
  publishedId?: string;
}

const WHEN_KNOWN = ["generation", "rootPostId", "replyToId", "text"] as const;
/** Provider ids: once both sides know one, they must be equal. */
const PROOFS = ["containerId", "publishedId"] as const;

/** An answer about anything other than the expected operation is `mismatch`: never shown, never recorded. */
export function bindThreadsIntent(r: ThreadsSendResult, e: ThreadsExpect): ThreadsSendResult {
  if (!r.ok) return r;
  const i = r.intent;
  const same =
    (e.operationId === undefined || i.operationId === e.operationId) &&
    i.account === e.account &&
    i.draftRevision === e.draftRevision &&
    i.digest === e.digest &&
    threadsSendDigest(i.text) === i.digest &&
    WHEN_KNOWN.every((k) => e[k] === undefined || i[k] === e[k]) &&
    PROOFS.every((k) => e[k] === undefined || i[k] === undefined || i[k] === e[k]);
  return same ? r : { ok: false, error: "mismatch" };
}

/**
 * Readiness to prepare, send or resume a Threads reply. Production is closed: the endpoint-specific permission and a
 * trusted record of what the account granted are unverified (the Worker's gate answers the same literal). It never
 * reads a seal, a stored scope, a receipt or `canPublish`; only a later reviewed packet with verified authority may
 * change this function. Tests of the future enabled path replace it with a module mock, never a shipped switch.
 */
export type ThreadsSendReadiness = { ok: true } | { ok: false; reason: "permission_unverified" };
export function threadsSendReadiness(): ThreadsSendReadiness {
  return { ok: false, reason: "permission_unverified" };
}

/** One authenticated send call; only an answer that parses as an intent is a success. */
async function call(
  cfg: ScoutConfig | null,
  method: "GET" | "POST",
  path: string,
  body: unknown,
  fetchImpl?: typeof fetch,
): Promise<ThreadsSendResult> {
  if (!cfg) return { ok: false, error: "unconfigured" };
  const doFetch = fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(`${cfg.url}/social/inbox/threads/send${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
      },
      ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    return { ok: false, error: "network" };
  }
  let data: { intent?: unknown; error?: unknown; detail?: unknown } | null;
  try {
    data = (await res.json()) as typeof data;
  } catch {
    data = null;
  }
  if (res.ok) {
    const intent = parseThreadsIntent(data?.intent);
    return intent ? { ok: true, intent } : { ok: false, error: "upstream" };
  }
  const raw = data?.error;
  if (res.status === 401 || raw === "unauthorized" || raw === "origin")
    return { ok: false, error: "auth" };
  const error =
    typeof raw === "string" && CODES.has(raw) ? (raw as ThreadsSendErrorCode) : "upstream";
  const known = (DETAILS as Record<string, readonly string[]>)[error];
  const detail = known?.includes(data?.detail as string)
    ? (data!.detail as ThreadsSendDetail)
    : undefined;
  return { ok: false, error, ...(detail ? { detail } : {}) };
}

export const prepareThreadsSend = (
  cfg: ScoutConfig | null,
  body: { operationId: string; sendRef: string; text: string; draftRevision: string },
  fetchImpl?: typeof fetch,
) => call(cfg, "POST", "/prepare", body, fetchImpl);

export const confirmThreadsSend = (
  cfg: ScoutConfig | null,
  body: { operationId: string; digest: string; account: string },
  fetchImpl?: typeof fetch,
) => call(cfg, "POST", "/confirm", body, fetchImpl);

export const threadsSendStatus = (
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

export const cancelThreadsSend = (
  cfg: ScoutConfig | null,
  operationId: string,
  account: string,
  fetchImpl?: typeof fetch,
) => call(cfg, "POST", `/${encodeURIComponent(operationId)}/cancel`, { account }, fetchImpl);
