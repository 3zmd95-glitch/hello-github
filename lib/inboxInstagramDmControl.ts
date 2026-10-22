import { z } from "zod";
import { DM_ID_RE } from "./inboxInstagramDmSend";
import type { ScoutConfig } from "./scoutClient";

/**
 * 🛟 Verified-handle Instagram conversation takeover/resume, client wire (packet DT-6B-2C-5B,
 * planning/tools/37-inbox-send.md): strict parsers and the transport for the Worker's
 * `/social/inbox/instagram/dm/control/*` routes (workers/scout/src/social/inboxSendInstagramDm.ts). Separate from the DM
 * send client: nothing here sends a message, and nothing in the DM send client calls these routes. Nothing here throws;
 * failures are typed.
 *
 *   POST /register { account, conversationId }                → full view (no `changed`)
 *   GET  /:handle?account                                      → full view (no `changed`)
 *   POST /:handle/takeover|resume { account, expectedRevision } → full view with `changed`, or the HTTP 409 narrow conflict
 *
 * A full view is the complete handle, the conversation (mode + revision), at most DM_CONTROL_ROWS_MAX complete claimed
 * rows of the handle's own target and the truthful counts. A takeover/resume success is the requested mode at
 * expected + 1 (`changed: true`) or at expected (`changed: false`, a genuine no-op). The 409 conflict names only the
 * handle's narrow target and the conversation's current mode/revision (≠ the submitted expected one): it is never a full
 * view and carries no counts. The registration's generation and evidence digest are registration proof, distinct from the
 * reader's and the DM send generations.
 */

/** Claimed rows a control answer carries at most (the coordinator's CONTROL_ROWS_MAX). */
export const DM_CONTROL_ROWS_MAX = 20;

export type DmControlMode = "auto" | "human";

const ACCOUNT_RE = /^[A-Za-z0-9_-]{1,256}$/;
const HEX32 = /^[0-9a-f]{32}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const ACTOR_RE = /^(auto|manual):[A-Za-z0-9_-]{1,100}$/;

export type DmControlErrorCode =
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
  | "target_unverified"
  | "target_invalid"
  | "not_found"
  | "conflict"
  | "capacity"
  | "rate_limited"
  | "upstream"
  | "receipt_unavailable"
  /** Client side only: the answer named another account, conversation, recipient or handle. */
  | "mismatch";

const CODES: ReadonlySet<string> = new Set<DmControlErrorCode>([
  "not_configured",
  "not_connected",
  "no_permission",
  "token_expired",
  "stale",
  "account_mismatch",
  "bad_request",
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
    "no-customer",
    "mixed-senders",
    "foreign-conversation",
    "ambiguous-message",
    "ambiguous-identity",
  ],
  stale: ["reconnected"],
} as const;
export type DmControlDetail = (typeof DETAILS)[keyof typeof DETAILS][number];

/** The control key of one conversation: Worker origin | account | conversation (each encoded). */
export const dmControlKey = (origin: string, account: string, conversationId: string): string =>
  [origin, account, conversationId].map(encodeURIComponent).join("|");

/** An exact `Date#toISOString()` time (the Worker's isIso). */
const Iso = z.string().refine((t) => {
  const ms = Date.parse(t);
  return Number.isFinite(ms) && new Date(ms).toISOString() === t;
});
const DmId = z.string().regex(DM_ID_RE);
const Account = z.string().regex(ACCOUNT_RE);
const Count = z.number().refine((n) => Number.isSafeInteger(n) && n >= 0);
const Mode = z.enum(["auto", "human"]);

const ControlSchema = z.strictObject({
  handleId: z.string().regex(HEX32),
  account: Account,
  conversationId: DmId,
  recipientId: DmId,
  /** Registration proof (never the reader's or the DM send generation). */
  registeredGeneration: z.string().regex(HEX32),
  evidenceDigest: z.string().regex(HEX64),
  createdAt: Iso,
  usedAt: Iso,
});
export type DmControlHandle = z.infer<typeof ControlSchema>;

const ConversationSchema = z.strictObject({
  account: Account,
  conversationId: DmId,
  mode: Mode,
  revision: Count,
  updatedAt: Iso.optional(),
});

/** A complete claimed effect: nothing settled (strict: a settlement field is rejected). */
const RowSchema = z.strictObject({
  account: Account,
  conversationId: DmId,
  recipientId: DmId,
  inboundMessageId: DmId,
  actor: z.string().regex(ACTOR_RE),
  payloadDigest: z.string().regex(HEX64),
  generation: z.string().regex(HEX32),
  state: z.literal("claimed"),
  claimedAt: Iso,
  receiptVersion: z.number().refine((n) => Number.isSafeInteger(n) && n >= 1),
});
export type DmControlRow = z.infer<typeof RowSchema>;

const ViewSchema = z
  .strictObject({
    control: ControlSchema,
    conversation: ConversationSchema,
    inFlight: z.array(RowSchema).max(DM_CONTROL_ROWS_MAX),
    inFlightTotal: Count,
    inFlightTruncated: z.boolean(),
    uncertainTotal: Count,
    changed: z.boolean().optional(),
  })
  .refine(
    (v) =>
      v.conversation.account === v.control.account &&
      v.conversation.conversationId === v.control.conversationId &&
      v.inFlight.every(
        (e) =>
          e.account === v.control.account &&
          e.conversationId === v.control.conversationId &&
          e.recipientId === v.control.recipientId,
      ) &&
      v.inFlightTotal >= v.inFlight.length &&
      v.inFlightTruncated === v.inFlightTotal > v.inFlight.length,
  );
export type DmControlView = z.infer<typeof ViewSchema>;

/** A requested control CAS: the mode it sets and the revision the owner reviewed. */
export interface DmControlCas {
  mode: DmControlMode;
  expected: number;
}

/**
 * A full view; with `cas`, a takeover/resume success (requested mode; `changed: true` at expected + 1, `changed: false`
 * at expected); without it, `changed` must be absent (status, registration).
 */
export function parseDmControlView(raw: unknown, cas?: DmControlCas): DmControlView | null {
  const r = ViewSchema.safeParse(raw);
  if (!r.success) return null;
  const v = r.data;
  if (!cas) return v.changed === undefined ? v : null;
  if (v.conversation.mode !== cas.mode || v.changed === undefined) return null;
  return v.conversation.revision === (v.changed ? cas.expected + 1 : cas.expected) ? v : null;
}

const ConflictSchema = z
  .strictObject({
    error: z.literal("conflict"),
    control: z.strictObject({
      handleId: z.string().regex(HEX32),
      account: Account,
      conversationId: DmId,
      recipientId: DmId,
    }),
    conversation: z.strictObject({
      account: Account,
      conversationId: DmId,
      mode: Mode,
      revision: Count,
    }),
  })
  .refine(
    (c) =>
      c.conversation.account === c.control.account &&
      c.conversation.conversationId === c.control.conversationId,
  );
/** The narrow conflict: the handle's target and the current mode/revision only (no counts, no full proof). */
export type DmControlConflict = {
  control: { handleId: string; account: string; conversationId: string; recipientId: string };
  conversation: { account: string; conversationId: string; mode: DmControlMode; revision: number };
};

/** The exact HTTP 409 narrow conflict for a CAS submitted at `expected` (its revision must differ). */
export function parseDmControlConflict(raw: unknown, expected: number): DmControlConflict | null {
  const r = ConflictSchema.safeParse(raw);
  if (!r.success || r.data.conversation.revision === expected) return null;
  return { control: r.data.control, conversation: r.data.conversation };
}

export type DmControlResult =
  | { ok: true; view: DmControlView }
  | {
      ok: false;
      error: DmControlErrorCode;
      detail?: DmControlDetail;
      /** Only beside `conflict` of a takeover/resume: the bound narrow conflict. */
      conflict?: DmControlConflict;
    };

/** What the client already knows about the target; every known field must match exactly. */
export interface DmControlExpect {
  account: string;
  conversationId?: string;
  recipientId?: string;
  handleId?: string;
}

/** An answer (view or narrow conflict) about anything other than the expected target is `mismatch`. */
export function bindDmControl(r: DmControlResult, e: DmControlExpect): DmControlResult {
  const c = r.ok ? r.view.control : r.conflict?.control;
  if (!c) return r;
  const same =
    c.account === e.account &&
    (e.conversationId === undefined || c.conversationId === e.conversationId) &&
    (e.recipientId === undefined || c.recipientId === e.recipientId) &&
    (e.handleId === undefined || c.handleId === e.handleId);
  return same ? r : { ok: false, error: "mismatch" };
}

/**
 * Readiness to REGISTER a new conversation control. Production is closed: the Worker's registration needs the same
 * unverified DM permission evidence as a new DM (its gate answers this literal). It reads no settings, scopes, reader
 * capabilities or receipts; tests inject `{ ok: true }`. Status, takeover and resume of an existing verified handle
 * never ask it: their authority is the matching Worker's bearer, the stored account and the durable handle.
 */
export type DmControlReadiness = { ok: true } | { ok: false; reason: "permission_unverified" };
export function instagramDmControlReadiness(): DmControlReadiness {
  return { ok: false, reason: "permission_unverified" };
}

/** One authenticated control call. Redirects are never followed. */
async function call(
  cfg: ScoutConfig | null,
  method: "GET" | "POST",
  path: string,
  body: unknown,
  fetchImpl: typeof fetch | undefined,
  cas?: DmControlCas,
): Promise<DmControlResult> {
  if (!cfg) return { ok: false, error: "unconfigured" };
  const doFetch = fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(`${cfg.url}/social/inbox/instagram/dm/control${path}`, {
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
    const view = parseDmControlView(data, cas);
    return view ? { ok: true, view } : { ok: false, error: "upstream" };
  }
  const raw = data?.error;
  if (res.status === 401 || raw === "unauthorized" || raw === "origin")
    return { ok: false, error: "auth" };
  // A takeover/resume conflict is only the exact bound narrow answer; anything else about it is unreadable.
  if (cas && raw === "conflict") {
    const conflict = res.status === 409 ? parseDmControlConflict(data, cas.expected) : null;
    return conflict ? { ok: false, error: "conflict", conflict } : { ok: false, error: "upstream" };
  }
  const pure = !!data && Object.keys(data).every((k) => k === "error" || k === "detail");
  const error =
    pure && typeof raw === "string" && CODES.has(raw) ? (raw as DmControlErrorCode) : "upstream";
  const known = (DETAILS as Record<string, readonly string[]>)[error];
  const detail = known?.includes(data?.detail as string)
    ? (data!.detail as DmControlDetail)
    : undefined;
  return { ok: false, error, ...(detail ? { detail } : {}) };
}

export const requestDmControlRegister = (
  cfg: ScoutConfig | null,
  body: { account: string; conversationId: string },
  fetchImpl?: typeof fetch,
) => call(cfg, "POST", "/register", body, fetchImpl);

export const requestDmControlStatus = (
  cfg: ScoutConfig | null,
  handleId: string,
  account: string,
  fetchImpl?: typeof fetch,
) =>
  call(
    cfg,
    "GET",
    `/${encodeURIComponent(handleId)}?${new URLSearchParams({ account })}`,
    undefined,
    fetchImpl,
  );

const mutate =
  (action: "takeover" | "resume", mode: DmControlMode) =>
  (
    cfg: ScoutConfig | null,
    handleId: string,
    body: { account: string; expectedRevision: number },
    fetchImpl?: typeof fetch,
  ) =>
    call(cfg, "POST", `/${encodeURIComponent(handleId)}/${action}`, body, fetchImpl, {
      mode,
      expected: body.expectedRevision,
    });

export const requestDmControlTakeover = mutate("takeover", "human");
export const requestDmControlResume = mutate("resume", "auto");
