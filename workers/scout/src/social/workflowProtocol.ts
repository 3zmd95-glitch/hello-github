/**
 * ⚙️ Cloud workflow protocol (packet DT-7B, planning/tools/38-cloud-workflows.md): the bounded, strict schemas of the
 * workflow foundation, shared by workflowCoordinator.ts (the authority) and workflowRoutes.ts (the HTTP surface).
 *
 *   occurrence body   the immutable, owner-built execution snapshot one occurrence runs: exactly the allowlisted
 *                     fields below (an unknown field anywhere is refused, never dropped), ids `^[A-Za-z0-9_-]{1,64}$`
 *                     (no colon: `wf:<occurrenceId>:<actionId>` stays unambiguous), unique action ids, trigger/input/
 *                     context/target-week consistency and canonical ISO timestamps. ≤ 16 KiB canonical, its planner
 *                     context ≤ 8 KiB (`too_large`, never truncated).
 *   payload digest    sha256 (hex) of the canonical JSON of that body; the digest is NOT part of the body. Canonical
 *                     JSON = keys sorted by UTF-16 code units at every level, no whitespace, arrays in order, strings
 *                     as JSON.stringify writes them, integers only. The server always recomputes it; an asserted
 *                     digest that differs is refused (`digest_mismatch`). Test vectors: workflowProtocol.test.ts.
 *   output records    allowlisted drafts only: an idea (`source: "workflow"`), a post at `stage: "idea"` with an
 *                     empty script, no shots, no time and no auto-post, or a planner row (`by: "me"`) of the body's
 *                     target week; id `wf:<occurrenceId>:<actionId>`. Nothing here publishes, sends or calls out.
 *
 * Pure: no storage, no network, no clock (the caller passes `now`).
 */

import { addDays, DAY_KEY_RE, riyadhDay } from "./time";

export const WF_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
/** The non-secret server authority id, minted once in the coordinator's durable meta. */
export const OWNER_KEY_RE = /^wfo_[0-9a-f]{32}$/;
export const DIGEST_RE = /^[0-9a-f]{64}$/;
/** Catalogue skill ids (lower-case slugs). */
const SKILL_ID_RE = /^[a-z0-9][a-z0-9-]{0,79}$/;
/** Planner row ids: the owner's own ids and earlier workflow outputs (`wf:<run>:<action>`). */
const PLAN_ITEM_ID_RE = /^[A-Za-z0-9_:-]{1,140}$/;

export const BODY_BYTES_MAX = 16_384;
export const CONTEXT_BYTES_MAX = 8_192;
/** The streaming request budget of every workflow route. */
export const REQUEST_BYTES_MAX = 32_768;
export const ACTIONS_MAX = 5;
const NAME_MAX = 80;
const TEMPLATE_MAX = 500;
const INPUT_TEXT_MAX = 2_000;
const SLUG_MAX = 200;
const COMPLETIONS_MAX = 200;
const PLAN_ITEMS_MAX = 100;
const OUTPUT_TEXT_MAX = 4_000;
const HASHTAGS_MAX = 30;
const HASHTAG_MAX = 100;
/** Clock skew tolerated between the owner's device (executionAt) and the Worker. */
export const SKEW_MS = 10 * 60_000;
/** No workflow ran before this. */
const EPOCH_MIN_MS = Date.parse("2020-01-01T00:00:00.000Z");

export const PLATFORMS = ["tiktok", "instagram", "youtube", "threads", "x", "snapchat"] as const;
export const QUESTS = ["research", "train", "produce", "article"] as const;
const GEAR = ["phone", "any", "camera", "gimbal", "lights", "mic"] as const;
export const OCCURRENCE_KINDS = ["manual", "article-ready"] as const;
export const ACTION_KINDS = ["idea", "post", "plan"] as const;
/** What an injected builder may report for a failed step (the store adds `output-conflict` itself). */
export const STEP_ERRORS = [
  "empty-text",
  "no-skill",
  "unknown-skill",
  "invalid",
  "context-stale",
] as const;

export type Obj = Record<string, unknown>;
export type LText = { ar: string; en: string };
export type ActionKind = (typeof ACTION_KINDS)[number];

export type WorkflowActionBody =
  | { id: string; kind: "idea"; text: LText; platform?: string }
  | { id: string; kind: "post"; platform: string; title: LText; caption: LText; offsetDays: number }
  | {
      id: string;
      kind: "plan";
      quest: string;
      skillId?: string;
      minutes: number;
      day: number | "lightest";
    };

export interface PlannerContext {
  targetWeek: string;
  completions: { skillId: string; quest: string; at: string }[];
  planItems: {
    id: string;
    week: string;
    day: number;
    skillId: string;
    quest: string;
    minutes: number;
    by: string;
  }[];
  settings: { gear: string[]; davinciEdition: string };
  contextAt: string;
}

export interface OccurrenceBody {
  occurrenceId: string;
  ownerKey: string;
  workflowId: string;
  kind: (typeof OCCURRENCE_KINDS)[number];
  registrationEpoch: number;
  revision: number;
  snapshot: { name: LText; trigger: { kind: string }; actions: WorkflowActionBody[] };
  plannerContext: PlannerContext | null;
  input: {
    articleId?: string;
    title: LText;
    summary: LText;
    slug: string;
    skillId?: string;
    lang: string;
    day: string;
  };
  executionAt: string;
}

export const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
export const isVersion = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 1;
export const isCount = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
export const fits = (v: unknown, re: RegExp): v is string => typeof v === "string" && re.test(v);
/** A canonical `toISOString()` instant (the only timestamp form this protocol carries). */
export const isIso = (v: unknown): v is string =>
  typeof v === "string" && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
/** A real calendar day key. */
export const isDay = (v: unknown): v is string =>
  typeof v === "string" && DAY_KEY_RE.test(v) && addDays(v, 0) === v;
const isText = (v: unknown, max: number, min = 0): v is string =>
  typeof v === "string" && v.length >= min && v.length <= max && !/\p{Cs}/u.test(v);
const isLText = (v: unknown, max: number): v is LText =>
  isObj(v) && exactKeys(v, ["ar", "en"]) && isText(v.ar, max) && isText(v.en, max);
const oneOf = (v: unknown, list: readonly string[]): v is string =>
  typeof v === "string" && list.includes(v);
const intIn = (v: unknown, lo: number, hi: number): v is number =>
  Number.isSafeInteger(v) && (v as number) >= lo && (v as number) <= hi;

/** Every required key present, nothing outside required + optional. */
export function exactKeys(o: Obj, required: readonly string[], optional: readonly string[] = []) {
  const keys = Object.keys(o);
  return (
    required.every((k) => k in o) && keys.every((k) => required.includes(k) || optional.includes(k))
  );
}

/** The Saturday that starts the planner week of a day key (the dashboard's `weekKey`). */
export function weekOf(day: string): string {
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay(); // 0 Sunday … 6 Saturday
  return addDays(day, -((dow + 1) % 7));
}

/** The canonical JSON of a protocol value (see the header). Throws on anything outside the protocol's types. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v === "boolean") return JSON.stringify(v);
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "number") {
    if (!Number.isSafeInteger(v)) throw new TypeError("non-integer");
    return String(v);
  }
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (isObj(v))
    return `{${Object.keys(v)
      .filter((k) => v[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`)
      .join(",")}}`;
  throw new TypeError("unsupported");
}

const enc = new TextEncoder();
export const byteLength = (s: string) => enc.encode(s).length;

export async function sha256Hex(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", enc.encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The payload digest of an occurrence body (the server's own computation, never the caller's claim). */
export const payloadDigestOf = (body: OccurrenceBody) => sha256Hex(canonicalJson(body));

export type BodyError = "bad_request" | "unsupported_id" | "too_large";
export type BodyCheck = { ok: true; body: OccurrenceBody } | { ok: false; error: BodyError };

class Refuse extends Error {
  constructor(readonly code: BodyError) {
    super(code);
  }
}
const need = (ok: boolean) => {
  if (!ok) throw new Refuse("bad_request");
};
/** A string id: the wrong alphabet (a colon, a space…) is `unsupported_id`, anything else `bad_request`. */
const needId = (v: unknown) => {
  need(typeof v === "string");
  if (!WF_ID_RE.test(v as string)) throw new Refuse("unsupported_id");
};

function checkAction(a: unknown): WorkflowActionBody {
  need(isObj(a));
  const x = a as Obj;
  needId(x.id);
  if (x.kind === "idea") {
    need(exactKeys(x, ["id", "kind", "text"], ["platform"]));
    need(isLText(x.text, TEMPLATE_MAX));
    need(x.platform === undefined || oneOf(x.platform, PLATFORMS));
  } else if (x.kind === "post") {
    need(exactKeys(x, ["id", "kind", "platform", "title", "caption", "offsetDays"]));
    need(oneOf(x.platform, PLATFORMS));
    need(isLText(x.title, TEMPLATE_MAX) && isLText(x.caption, TEMPLATE_MAX));
    need(intIn(x.offsetDays, 0, 30));
  } else if (x.kind === "plan") {
    need(exactKeys(x, ["id", "kind", "quest", "minutes", "day"], ["skillId"]));
    need(oneOf(x.quest, QUESTS));
    need(x.skillId === undefined || fits(x.skillId, SKILL_ID_RE));
    need(intIn(x.minutes, 5, 120));
    need(x.day === "lightest" || intIn(x.day, 0, 6));
  } else need(false);
  return x as unknown as WorkflowActionBody;
}

function checkContext(c: unknown, day: string, executionAt: string): PlannerContext {
  need(isObj(c));
  const x = c as Obj;
  need(exactKeys(x, ["targetWeek", "completions", "planItems", "settings", "contextAt"]));
  // The week the builders read is the occurrence day's week, nothing else.
  need(isDay(x.targetWeek) && x.targetWeek === weekOf(day));
  need(isIso(x.contextAt) && Date.parse(x.contextAt as string) <= Date.parse(executionAt));
  need(Array.isArray(x.completions) && x.completions.length <= COMPLETIONS_MAX);
  for (const q of x.completions as unknown[]) {
    need(isObj(q) && exactKeys(q, ["skillId", "quest", "at"]));
    const y = q as Obj;
    need(fits(y.skillId, SKILL_ID_RE) && oneOf(y.quest, QUESTS) && isIso(y.at));
    // Only the history before the target week (what buildWeekPlan reads).
    need(riyadhDay(y.at as string) < (x.targetWeek as string));
  }
  need(Array.isArray(x.planItems) && x.planItems.length <= PLAN_ITEMS_MAX);
  const ids = new Set<string>();
  for (const p of x.planItems as unknown[]) {
    need(isObj(p) && exactKeys(p, ["id", "week", "day", "skillId", "quest", "minutes", "by"]));
    const y = p as Obj;
    need(fits(y.id, PLAN_ITEM_ID_RE) && !ids.has(y.id as string));
    ids.add(y.id as string);
    // Only rows of the target week, minutes-0 tombstones included.
    need(y.week === x.targetWeek && intIn(y.day, 0, 6) && fits(y.skillId, SKILL_ID_RE));
    need(oneOf(y.quest, QUESTS) && intIn(y.minutes, 0, 1_440) && oneOf(y.by, ["rules", "me"]));
  }
  need(isObj(x.settings) && exactKeys(x.settings as Obj, ["gear", "davinciEdition"]));
  const s = x.settings as Obj;
  need(Array.isArray(s.gear) && s.gear.length <= GEAR.length);
  need((s.gear as unknown[]).every((g) => oneOf(g, GEAR)));
  need(new Set(s.gear as unknown[]).size === (s.gear as unknown[]).length);
  need(oneOf(s.davinciEdition, ["studio", "free"]));
  return x as unknown as PlannerContext;
}

function checkBodyOrThrow(raw: unknown, nowMs: number): OccurrenceBody {
  need(isObj(raw));
  const b = raw as Obj;
  need(
    exactKeys(b, [
      "occurrenceId",
      "ownerKey",
      "workflowId",
      "kind",
      "registrationEpoch",
      "revision",
      "snapshot",
      "plannerContext",
      "input",
      "executionAt",
    ]),
  );
  needId(b.occurrenceId);
  needId(b.workflowId);
  need(fits(b.ownerKey, OWNER_KEY_RE));
  need(oneOf(b.kind, OCCURRENCE_KINDS));
  need(isVersion(b.registrationEpoch) && isVersion(b.revision));
  // Prefixes: `ar-` article-ready, `sc-` reserved for scheduled occurrences (DT-7D, never submitted).
  const id = b.occurrenceId as string;
  need(b.kind === "article-ready" ? id.startsWith("ar-") : !/^(ar|sc)-/.test(id));
  need(isIso(b.executionAt));
  const at = Date.parse(b.executionAt as string);
  need(at >= EPOCH_MIN_MS && at <= nowMs + SKEW_MS);

  need(isObj(b.snapshot) && exactKeys(b.snapshot as Obj, ["name", "trigger", "actions"]));
  const snap = b.snapshot as Obj;
  need(isLText(snap.name, NAME_MAX));
  need(isObj(snap.trigger) && exactKeys(snap.trigger as Obj, ["kind"]));
  need((snap.trigger as Obj).kind === b.kind);
  need(Array.isArray(snap.actions));
  const list = snap.actions as unknown[];
  need(list.length >= 1 && list.length <= ACTIONS_MAX);
  const actions = list.map(checkAction);
  need(new Set(actions.map((a) => a.id)).size === actions.length);

  need(isObj(b.input));
  const i = b.input as Obj;
  need(
    exactKeys(i, ["title", "summary", "slug", "lang", "day"], ["articleId", "skillId"]) &&
      isLText(i.title, INPUT_TEXT_MAX) &&
      isLText(i.summary, INPUT_TEXT_MAX) &&
      isText(i.slug, SLUG_MAX) &&
      oneOf(i.lang, ["ar", "en"]) &&
      isDay(i.day),
  );
  if (i.articleId !== undefined) needId(i.articleId);
  need(i.skillId === undefined || fits(i.skillId, SKILL_ID_RE));
  // The day is the Riyadh day of the triggering commit.
  need(i.day === riyadhDay(at));
  if (b.kind === "article-ready") need(i.articleId !== undefined);
  else {
    // A manual run captures no article (lib/workflows manualInput).
    const t = i.title as LText;
    const s = i.summary as LText;
    need(i.articleId === undefined && i.skillId === undefined && i.slug === "");
    need(!t.ar && !t.en && !s.ar && !s.en);
  }

  const hasPlan = actions.some((a) => a.kind === "plan");
  if (hasPlan) {
    const ctx = checkContext(b.plannerContext, i.day as string, b.executionAt as string);
    if (byteLength(canonicalJson(ctx)) > CONTEXT_BYTES_MAX) throw new Refuse("too_large");
  } else need(b.plannerContext === null);

  const body = b as unknown as OccurrenceBody;
  if (byteLength(canonicalJson(body)) > BODY_BYTES_MAX) throw new Refuse("too_large");
  return body;
}

/** The strict body check: the accepted body is exactly the caller's object (nothing dropped, nothing added). */
export function checkBody(raw: unknown, nowMs: number): BodyCheck {
  try {
    return { ok: true, body: checkBodyOrThrow(raw, nowMs) };
  } catch (e) {
    if (e instanceof Refuse) return { ok: false, error: e.code };
    return { ok: false, error: "bad_request" };
  }
}

export const outputIdOf = (occurrenceId: string, actionId: string) =>
  `wf:${occurrenceId}:${actionId}`;

const EMPTY_SCRIPT = { hook: "", beats: ["", "", ""], cta: "" };

/**
 * The allowlisted draft shape of one action kind under its exact output id, body-free (DT-7B-R1: the change feed
 * carries no body, so it checks this; `validOutput` adds the body's own binding).
 */
export function validDraft(record: unknown, kind: string, id: string): boolean {
  if (!isObj(record) || record.id !== id) return false;
  const r = record;
  const skill = (v: unknown) => v === undefined || fits(v, SKILL_ID_RE);
  if (kind === "idea")
    return (
      exactKeys(r, ["id", "text", "source", "createdAt"], ["skillId", "platform"]) &&
      isText(r.text, OUTPUT_TEXT_MAX, 1) &&
      r.source === "workflow" &&
      skill(r.skillId) &&
      (r.platform === undefined || oneOf(r.platform, PLATFORMS)) &&
      isIso(r.createdAt)
    );
  if (kind === "post")
    return (
      exactKeys(
        r,
        [
          "id",
          "platform",
          "title",
          "caption",
          "hashtags",
          "stage",
          "plannedDay",
          "plannedTime",
          "script",
          "shots",
          "createdAt",
          "updatedAt",
        ],
        ["skillId"],
      ) &&
      oneOf(r.platform, PLATFORMS) &&
      isText(r.title, OUTPUT_TEXT_MAX, 1) &&
      isText(r.caption, OUTPUT_TEXT_MAX) &&
      Array.isArray(r.hashtags) &&
      r.hashtags.length <= HASHTAGS_MAX &&
      r.hashtags.every((h) => isText(h, HASHTAG_MAX, 1)) &&
      r.stage === "idea" &&
      (r.plannedDay === null || isDay(r.plannedDay)) &&
      r.plannedTime === null &&
      canonicalJson(r.script) === canonicalJson(EMPTY_SCRIPT) &&
      Array.isArray(r.shots) &&
      r.shots.length === 0 &&
      skill(r.skillId) &&
      isIso(r.createdAt) &&
      isIso(r.updatedAt)
    );
  if (kind === "plan")
    return (
      exactKeys(r, ["id", "week", "day", "skillId", "quest", "minutes", "by"]) &&
      isDay(r.week) &&
      weekOf(r.week) === r.week &&
      intIn(r.day, 0, 6) &&
      fits(r.skillId, SKILL_ID_RE) &&
      oneOf(r.quest, QUESTS) &&
      intIn(r.minutes, 5, 120) &&
      r.by === "me"
    );
  return false;
}

/** An allowlisted draft record for this body's action, or false. */
export function validOutput(record: unknown, body: OccurrenceBody, idx: number): boolean {
  const action = body.snapshot.actions[idx];
  if (!action || !validDraft(record, action.kind, outputIdOf(body.occurrenceId, action.id)))
    return false;
  const r = record as Obj;
  if (action.kind === "post") return r.platform === action.platform;
  if (action.kind === "plan")
    return (
      body.plannerContext !== null &&
      r.week === body.plannerContext.targetWeek &&
      r.quest === action.quest &&
      r.minutes === action.minutes
    );
  return true;
}
