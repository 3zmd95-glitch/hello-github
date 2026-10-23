"use client";

import Link from "next/link";
import { useEffect, useId, useState, useSyncExternalStore } from "react";
import Chip from "@/components/ui/ios/Chip";
import {
  cloudHub,
  type CloudCounts,
  type CloudHubView,
  type DeliverableView,
  type HubRefusal,
  type RegistrationView,
} from "@/lib/cloudWorkflowHub";
import type { OccurrenceResult } from "@/lib/cloudWorkflowOccurrenceClient";
import { CHANGES_LIMIT_MAX } from "@/lib/cloudWorkflowProtocol";
import {
  PROOF_CAPACITY,
  TOMBSTONES_MAX,
  readReconciliation,
  type CloudRun,
} from "@/lib/cloudWorkflowReconciliation";
import type {
  AckResult,
  CheckResult,
  ReconcileResult,
} from "@/lib/cloudWorkflowReconciliationClient";
import { REGISTRATION_CAPACITY } from "@/lib/cloudWorkflowRegistration";
import type { ControllerResult } from "@/lib/cloudWorkflowRegistrationClient";
import { useT, type MessageKey } from "@/lib/i18n";
import { loadCloudJournal, useStore, type CloudJournalLoad } from "@/store";
import { WF_ID_RE } from "@/workers/scout/src/social/workflowProtocol";

/**
 * ⚙️ Cloud workflows in the Workflows screen (packet DT-7C-3B, planning/collaboration/dt7c3-integration-plan.md). The
 * UI talks to the cloud only through `cloudHub()`, called per action; every request is one explicit click (nothing at
 * mount, no polling, no retry, nothing chained). A lost answer reads "sent — check status", never failed/delivered.
 * The token is never read here: the view holds only the origin.
 */

const SERVER_VIEW: CloudHubView = {
  configured: { ok: false, reason: "none" },
  authority: null,
  handshake: "idle",
  busy: new Set(),
  last: {},
};

/** One hub subscription; a bfcache return (`pageshow`) re-subscribes to the fresh hub `pagehide` left behind. */
function subscribeHub(cb: () => void): () => void {
  let off = cloudHub().subscribe(cb);
  const show = () => {
    off();
    off = cloudHub().subscribe(cb);
    cb();
  };
  window.addEventListener("pageshow", show);
  return () => {
    off();
    window.removeEventListener("pageshow", show);
  };
}

/** The hub's observable view (a constant unconfigured view on the server and during hydration). */
export const useCloudView = (): CloudHubView =>
  useSyncExternalStore(
    subscribeHub,
    () => cloudHub().view(),
    () => SERVER_VIEW,
  );

/** The hub's read-only selectors (stored cloud records, parsed through the pinned modules). */
export interface CloudReads {
  readonly counts: CloudCounts;
  readonly registrations: readonly RegistrationView[];
  readonly runs: readonly CloudRun[];
  readonly deliverable: readonly DeliverableView[];
}

/**
 * What the static export prerenders and the first client render shows: the inert hub's answers (nothing readable, no
 * rows). The stored records come in right after hydration, so server and client markup agree.
 */
const SERVER_READS: CloudReads = {
  counts: {
    registrations: null,
    proofs: null,
    tombstones: null,
    pending: null,
    runs: null,
    journal: null,
  },
  registrations: [],
  runs: [],
  deliverable: [],
};

type ReadsKey = readonly [unknown, unknown, unknown, unknown, unknown];
let cachedReads: { key: ReadsKey; reads: CloudReads } | null = null;

/**
 * One snapshot per change, the same object until something it parses moves (stable for React): the hub (a fresh one
 * after pagehide), its view (a new object on every hub notification) or one of the stored cloud slices it reads.
 */
function currentReads(): CloudReads {
  const hub = cloudHub();
  const s = useStore.getState();
  const key: ReadsKey = [
    hub,
    hub.view(),
    s.cloudRegistrations,
    s.cloudReconciliation,
    s.cloudJournal,
  ];
  if (!cachedReads || key.some((k, i) => k !== cachedReads!.key[i]))
    cachedReads = {
      key,
      reads: {
        counts: hub.counts(),
        registrations: hub.registrations(),
        runs: hub.cloudRuns(),
        deliverable: hub.deliverable(),
      },
    };
  return cachedReads.reads;
}

/** The stored slices; hub notifications re-render through `useCloudView` (one hub subscription per component). */
function subscribeReads(cb: () => void): () => void {
  // A new mount (or unmount) starts from a fresh read, so nothing cached across screens is ever shown.
  cachedReads = null;
  const off = useStore.subscribe((s, p) => {
    if (
      s.cloudRegistrations !== p.cloudRegistrations ||
      s.cloudReconciliation !== p.cloudReconciliation ||
      s.cloudJournal !== p.cloudJournal
    )
      cb();
  });
  return () => {
    off();
    cachedReads = null;
  };
}

/**
 * The hub's stored-record reads (counts, registrations, cloud runs, deliverable proofs) as an observable snapshot with
 * an inert server snapshot, so a prerendered page and its hydration agree (DT-7C-3C fix round). Never call the hub's
 * selectors directly during render. Use it beside `useCloudView()`, which carries the hub's own notifications.
 */
export const useCloudReads = (): CloudReads =>
  useSyncExternalStore(subscribeReads, currentReads, () => SERVER_READS);

const PAUSES = new Set(["proof-full", "retirement-full"]);
/** A click on a key already in flight sends nothing (the hub marks busy synchronously, before any render). */
const inFlight = (key: string) => cloudHub().view().busy.has(key);
const STATES = new Set(["pending", "running", "done", "partial", "failed", "cancelled"]);

/** A result line: `alert` for refusals, errors and unknown outcomes; `status` for successes. */
interface Said {
  readonly text: string;
  readonly alert: boolean;
}
const ok = (text: string): Said => ({ text, alert: false });
const bad = (text: string): Said => ({ text, alert: true });

function Result({ said, testId }: { said: Said | undefined; testId: string }) {
  if (!said) return null;
  return (
    <p
      className={`text-[13px] ${said.alert ? "text-danger" : ""}`}
      role={said.alert ? "alert" : "status"}
      data-testid={testId}
    >
      {said.text}
    </p>
  );
}

/** Copy for every typed outcome the cloud buttons return. */
export function useCloudText() {
  const { t, lang } = useT();
  const sentText = (dispatched: boolean) =>
    t(dispatched ? "workflows.cloud.sent" : "workflows.cloud.notSent");
  /** A local/controller code; `unconfirmed:<category>` is a sent request whose answer was lost. */
  const reason = (code: string): string => {
    if (code.startsWith("unconfirmed:")) return sentText(true);
    const k = `workflows.cloud.reason.${code.replace(/-/g, "_")}` as MessageKey;
    const s = t(k);
    return s === k ? t("workflows.cloud.reason.other", { reason: code }) : s;
  };
  /** The Worker's own error code (its `not_configured` means the Worker side, not Settings). */
  const worker = (code: string): string => {
    const k = `workflows.cloud.worker.${code}` as MessageKey;
    const s = t(k);
    return s === k ? reason(code) : s;
  };
  const stateText = (s: string) => (STATES.has(s) ? t(`workflows.cloud.state.${s as "done"}`) : s);
  const sent = (dispatched: boolean) => bad(sentText(dispatched));
  const refusedBy = (error: string) =>
    bad(t("workflows.cloud.workerRefused", { reason: worker(error) }));
  const lifecycle = (r: ControllerResult | HubRefusal): Said => {
    if (r.kind === "refused") return bad(reason(r.reason));
    if (r.kind === "stale") return sent(r.dispatched);
    const text = t(`workflows.cloud.intent.${r.state}`);
    return r.state === "settled" ? ok(text) : bad(text);
  };
  const occurrence = (r: OccurrenceResult | HubRefusal): Said => {
    if (r.kind === "refused") return bad(reason(r.reason));
    if (r.kind !== "answered") return sent(r.dispatched);
    const p = r.parsed;
    if (p.outcome === "refused") return refusedBy(p.error);
    if (p.outcome !== "ok") return bad(t("workflows.cloud.invalidAnswer"));
    if (r.recorded && !r.recorded.persisted)
      return bad(t("workflows.cloud.notSaved", { reason: reason(r.recorded.reason) }));
    const state =
      "receipt" in p
        ? p.receipt.state
        : p.kind === "status" && p.result.found === "row"
          ? p.result.receipt.state
          : null;
    return ok(
      state
        ? t("workflows.cloud.answered", { state: stateText(state) })
        : t("workflows.cloud.answeredOk"),
    );
  };
  const ack = (r: AckResult | HubRefusal): Said => {
    if (r.kind === "refused") return bad(reason(r.reason));
    if (r.kind !== "answered") return sent(r.dispatched);
    const p = r.parsed;
    if (p.outcome === "refused") return refusedBy(p.error);
    return p.outcome === "ok"
      ? ok(t("workflows.cloud.deliver.done"))
      : bad(t("workflows.cloud.invalidAnswer"));
  };
  const check = (r: CheckResult | HubRefusal): Said => {
    if (r.kind === "refused") return bad(reason(r.reason));
    if (r.kind !== "answered") return sent(r.dispatched);
    const p = r.parsed;
    if (p.outcome === "refused") return refusedBy(p.error);
    if (p.outcome !== "ok" || p.kind !== "status") return bad(t("workflows.cloud.invalidAnswer"));
    if (r.recorded && !r.recorded.ok) return bad(reason(r.recorded.reason));
    if (p.result.found === "absent") return bad(worker("absent"));
    if (p.result.found === "pruned" || r.recorded?.change === "retired")
      return ok(t("workflows.cloud.checked.retired"));
    return ok(t("workflows.cloud.answered", { state: stateText(p.result.receipt.state) }));
  };
  return { t, lang, reason, worker, stateText, sentText, lifecycle, occurrence, ack, check };
}

/** The connection line: configured origin (never the token), handshake state, and the explicit Check connection. */
export function CloudConnect({ view }: { view: CloudHubView }) {
  const { t, reason } = useCloudText();
  if (!view.configured.ok)
    return (
      <p className="text-ink-2 text-[13px]" data-testid="workflow-cloud-connect" data-state="none">
        {view.configured.reason === "none"
          ? t("workflows.cloud.connect.none")
          : t("workflows.cloud.connect.bad", { reason: reason(view.configured.reason) })}{" "}
        <Link
          href="/settings/#api-keys"
          className="text-tint"
          data-testid="workflow-cloud-settings"
        >
          {t("workflows.cloud.connect.settings")}
        </Link>
      </p>
    );
  const h = view.handshake;
  return (
    <div
      className="flex flex-wrap items-center gap-2 text-[13px]"
      data-testid="workflow-cloud-connect"
      data-state={view.authority ? "connected" : "configured"}
    >
      <span dir="ltr" className="text-ink-2 break-all">
        {t("workflows.cloud.connect.origin", { origin: view.configured.origin })}
      </span>
      <span aria-live="polite" data-testid="workflow-cloud-handshake">
        {h === "busy"
          ? t("workflows.cloud.handshake.busy")
          : h === "ok" && view.authority
            ? t("workflows.cloud.handshake.ok")
            : typeof h === "object" && "refused" in h
              ? t("workflows.cloud.handshake.refused", { reason: reason(h.refused) })
              : typeof h === "object"
                ? t("workflows.cloud.handshake.uncertain")
                : t("workflows.cloud.connect.need")}
      </span>
      <button
        type="button"
        className="px-btn px-btn-ghost px-btn-sm"
        disabled={view.busy.has("handshake")}
        onClick={() => {
          if (!inFlight("handshake")) void cloudHub().handshake();
        }}
        data-testid="workflow-cloud-check"
      >
        {t("workflows.cloud.check")}
      </button>
    </div>
  );
}

type ChipState =
  | "local"
  | "active"
  | "paused"
  | "another"
  | "noWorker"
  | "unresolved"
  | "refused"
  | "unsupported"
  | "capacity";

/**
 * The Cloud card of one workflow: its registration chip, Put on cloud / Take off cloud / Recover, its journal entries
 * (Send / Check status / Run / Cancel) and its cloud runs (own schema, separate from local runs). `locked` while the
 * editor has unsaved edits or an action running, so a registration never binds an older saved revision.
 */
export function WorkflowCloudCard({
  id,
  locked,
  captured,
}: {
  id: string;
  locked: boolean;
  captured: string | null;
}) {
  const text = useCloudText();
  const { t, lang } = text;
  const uid = useId();
  const view = useCloudView();
  const reads = useCloudReads();
  const journalSlice = useStore((s) => s.cloudJournal);
  const [journal, setJournal] = useState<CloudJournalLoad | null>(null);
  const [note, setNote] = useState<Said | undefined>();
  const [notes, setNotes] = useState<Record<string, Said>>({});

  // A local, verified read of the journal (no network); again when the stored journal or the captured key changes.
  useEffect(() => {
    let live = true;
    void loadCloudJournal().then((j) => {
      if (live) setJournal(j);
    });
    return () => {
      live = false;
    };
  }, [journalSlice, captured]);

  const origin = view.configured.ok ? view.configured.origin : null;
  const owner = view.authority?.ownerKey;
  const mine = reads.registrations.filter((r) => r.workflowId === id);
  // The same exactly-one rule as the hub's authorityFor: two owners at one origin before the handshake are not "own".
  const rows = mine.filter((r) => r.origin === origin && (!owner || r.ownerKey === owner));
  const own = rows.length === 1 ? rows[0] : undefined;
  const registered = reads.counts.registrations ?? 0;
  const chip: ChipState = !WF_ID_RE.test(id)
    ? "unsupported"
    : own
      ? own.unresolved
        ? "unresolved"
        : own.state === "refused"
          ? "refused"
          : own.proof === "active"
            ? own.paused
              ? "paused"
              : "active"
            : "local"
      : mine.length
        ? origin
          ? "another"
          : "noWorker"
        : registered >= REGISTRATION_CAPACITY
          ? "capacity"
          : "local";
  const onCloud = own?.proof === "active";
  const wfBusy = view.busy.has(`wf:${id}`);
  const off = !view.authority;
  const entries = journal?.ok ? journal.entries.filter((e) => e.workflowId === id) : [];
  const runs = reads.runs.filter((r) => r.workflowId === id);

  const lifecycle = async (kind: "register" | "unregister" | "recover") => {
    if (inFlight(`wf:${id}`)) return;
    setNote(undefined);
    setNote(text.lifecycle(await cloudHub()[kind](id)));
  };
  const occurrence = async (kind: "submit" | "status" | "run" | "cancel", key: string) => {
    if (inFlight(key)) return;
    const r = await cloudHub()[kind](key);
    setNotes((n) => ({ ...n, [key]: text.occurrence(r) }));
  };

  return (
    <section className="ios-card flex min-w-0 flex-col gap-2 p-3" data-testid="workflow-cloud-card">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-[15px] font-semibold">{t("workflows.cloud.title")}</h2>
        <Chip
          tone={chip === "active" ? "tint" : chip === "local" ? "default" : "warn"}
          data-testid="workflow-cloud-chip"
          data-state={chip}
        >
          {t(`workflows.cloud.chip.${chip}`, {
            count: registered,
            max: REGISTRATION_CAPACITY,
          })}
        </Chip>
      </div>
      <p className="text-ink-2 text-[13px]">{t("workflows.cloud.note")}</p>
      {chip === "another" && (
        <p className="text-ink-2 text-[13px]">{t("workflows.cloud.anotherHelp")}</p>
      )}
      {chip === "unsupported" && (
        <p className="text-ink-2 text-[13px]">{t("workflows.cloud.unsupportedHelp")}</p>
      )}
      {chip === "capacity" && (
        <p className="text-ink-2 text-[13px]">
          {t("workflows.cloud.capacityHelp", { max: REGISTRATION_CAPACITY })}
        </p>
      )}
      {chip === "refused" && own?.lastRefusal && (
        <p role="alert" className="text-danger text-[13px]" data-testid="workflow-cloud-refusal">
          {t("workflows.cloud.refusedHelp", { reason: text.worker(own.lastRefusal) })}
        </p>
      )}
      {chip === "noWorker" && <CloudConnect view={view} />}
      {chip !== "another" && chip !== "unsupported" && chip !== "noWorker" && (
        <>
          <CloudConnect view={view} />
          <div className="flex flex-wrap gap-2">
            {chip === "unresolved" ? (
              <button
                type="button"
                className="px-btn px-btn-sm"
                disabled={wfBusy || off || locked}
                onClick={() => void lifecycle("recover")}
                data-testid="workflow-cloud-recover"
              >
                {t("workflows.cloud.recover")}
              </button>
            ) : onCloud ? (
              <button
                type="button"
                className="px-btn px-btn-ghost px-btn-sm"
                disabled={wfBusy || off || locked}
                onClick={() => void lifecycle("unregister")}
                data-testid="workflow-cloud-unregister"
              >
                {t("workflows.cloud.takeOff")}
              </button>
            ) : (
              <button
                type="button"
                className="px-btn px-btn-sm"
                disabled={wfBusy || off || locked || chip === "capacity"}
                onClick={() => void lifecycle("register")}
                data-testid="workflow-cloud-register"
              >
                {t("workflows.cloud.put")}
              </button>
            )}
          </div>
        </>
      )}
      <Result said={note} testId="workflow-cloud-result" />

      {entries.length > 0 && (
        <div className="flex flex-col gap-2" data-testid="workflow-cloud-entries">
          <h3 className="ios-gh text-[13px]">{t("workflows.cloud.entries")}</h3>
          {captured && entries.some((e) => e.key === captured) && (
            <p className="text-[13px]" role="status" data-testid="workflow-cloud-captured">
              {t("workflows.cloud.captured")}
            </p>
          )}
          {entries.map((e, i) => {
            const busy = view.busy.has(e.key) || off;
            const held = e.state === "suppressed";
            const label = `${uid}-entry-${i}`;
            const button = (
              kind: "submit" | "status" | "run" | "cancel",
              name: MessageKey,
              disabled: boolean,
            ) => (
              <button
                type="button"
                className="px-btn px-btn-ghost px-btn-sm"
                disabled={disabled}
                aria-describedby={label}
                onClick={() => void occurrence(kind, e.key)}
                data-testid={`workflow-cloud-${kind}`}
              >
                {t(name)}
              </button>
            );
            return (
              <div
                key={e.key}
                className="flex min-w-0 flex-col gap-1 text-[13px]"
                data-testid="workflow-cloud-entry"
                data-state={e.state}
                data-captured={e.key === captured || undefined}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Chip tone={held ? "warn" : "default"}>
                    {t(`workflows.cloud.entry.${e.state}`)}
                  </Chip>
                  <span className="text-ink-2">
                    {e.observed
                      ? t("workflows.cloud.entry.observed", {
                          state: text.stateText(e.observed.state),
                          version: e.observed.receiptVersion,
                        })
                      : t("workflows.cloud.entry.none")}
                  </span>
                  <span id={label} className="text-muted ms-auto text-xs">
                    {when(e.executionAt, lang)} · <span dir="ltr">{e.occurrenceId}</span>
                  </span>
                </div>
                {e.observationRejected && (
                  <p className="text-danger">{t("workflows.cloud.entry.rejected")}</p>
                )}
                <div className="flex flex-wrap gap-2">
                  {button("submit", "workflows.cloud.send", busy || held)}
                  {button("status", "workflows.cloud.status", busy)}
                  {button("run", "workflows.cloud.run", busy || held)}
                  {button("cancel", "workflows.cloud.cancel", busy)}
                </div>
                <Result said={notes[e.key]} testId="workflow-cloud-entry-result" />
              </div>
            );
          })}
        </div>
      )}

      {runs.length > 0 && (
        <div className="flex flex-col gap-1" data-testid="workflow-cloud-runs">
          <h3 className="ios-gh text-[13px]">{t("workflows.cloud.runs")}</h3>
          {runs.map((r) => (
            <div
              key={r.key}
              className="flex flex-wrap items-center gap-2 text-[13px]"
              data-testid="workflow-cloud-run"
              data-state={r.state}
            >
              <Chip tone={r.state === "done" ? "tint" : "default"}>
                {t(`workflows.cloud.state.${r.state}`)}
              </Chip>
              <span>{t(`workflows.runKind.${r.kind}`)}</span>
              <span className="text-muted ms-auto text-xs">{when(r.updatedAt, lang)}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

const when = (iso: string, lang: "ar" | "en") =>
  new Date(iso).toLocaleString(lang === "ar" ? "ar-SA-u-nu-latn" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });

type Page = Extract<ReconcileResult, { kind: "page" }>;

/**
 * Cloud results on the Workflows list: the connection line, Fetch results (one page, never a drain loop), Confirm
 * delivery and Check status per finished occurrence, and the proof-full / retirement-full pause.
 */
export function CloudResultsCard() {
  const text = useCloudText();
  const { t, lang, reason } = text;
  const uid = useId();
  const view = useCloudView();
  const workflows = useStore((s) => s.workflows);
  const reads = useCloudReads();
  const [page, setPage] = useState<Page | null>(null);
  const [result, setResult] = useState<Said | undefined>();
  const [said, setSaid] = useState<Record<string, Said>>({});
  /** Proofs the Worker acknowledged, by key, with the receipt version they were acknowledged at. */
  const [acked, setAcked] = useState<Record<string, number>>({});
  const stored = useStore((s) => s.cloudReconciliation);

  const { counts, deliverable } = reads;
  // The stored receipt version of each proof: a new version (or a proof gone from the list) makes it confirmable again.
  const versions = new Map(
    (readReconciliation(stored)?.proofs ?? []).map((p) => [
      p.key,
      Number(p.receipt.receiptVersion),
    ]),
  );
  const isAcked = (key: string) =>
    acked[key] !== undefined && acked[key] === (versions.get(key) ?? 0);
  // A proof that left the list forgets its acknowledgement (state adjusted while rendering, not in an effect).
  const [listedBefore, setListedBefore] = useState(deliverable);
  if (listedBefore !== deliverable) {
    setListedBefore(deliverable);
    const listed = new Set(deliverable.map((d) => d.key));
    const next: Record<string, number> = {};
    for (const k of Object.keys(acked)) if (listed.has(k)) next[k] = acked[k];
    if (Object.keys(next).length !== Object.keys(acked).length) setAcked(next);
  }
  const off = !view.authority;
  const pageFull = page
    ? [page.blocked?.reason, ...page.items.map((i) => i.reason)].find(
        (r): r is string => !!r && PAUSES.has(r),
      )
    : undefined;
  const pause =
    pageFull ??
    ((counts.proofs ?? 0) >= PROOF_CAPACITY
      ? "proof-full"
      : (counts.tombstones ?? 0) >= TOMBSTONES_MAX
        ? "retirement-full"
        : null);

  const fetchResults = async () => {
    if (inFlight("reconcile")) return;
    setResult(undefined);
    const r = await cloudHub().reconcile({ limit: CHANGES_LIMIT_MAX });
    setPage(r.kind === "page" ? r : null);
    if (r.kind === "refused") setResult(bad(reason(r.reason)));
    else if (r.kind === "rejected")
      setResult(
        bad(
          r.parsed.outcome === "refused"
            ? t("workflows.cloud.workerRefused", { reason: text.worker(r.parsed.error) })
            : t("workflows.cloud.invalidAnswer"),
        ),
      );
    else if (r.kind !== "page") setResult(bad(text.sentText(r.dispatched)));
  };
  const proofAction = async (kind: "ack" | "check", key: string) => {
    if (inFlight(key) || (kind === "ack" && isAcked(key))) return;
    const version = versions.get(key) ?? 0;
    let s: Said;
    if (kind === "ack") {
      const r = await cloudHub().ack(key);
      s = text.ack(r);
      // An acknowledged answer is final for this version: no second ack until the proof changes (DT-7C-3D fix round).
      if (r.kind === "answered" && r.parsed.outcome === "ok")
        setAcked((a) => ({ ...a, [key]: version }));
    } else s = text.check(await cloudHub().check(key));
    setSaid((a) => ({ ...a, [key]: s }));
  };

  return (
    <section
      className="ios-card flex min-w-0 flex-col gap-2 p-3"
      data-testid="workflow-cloud-results"
    >
      <h2 className="text-[15px] font-semibold">{t("workflows.cloud.results.title")}</h2>
      <CloudConnect view={view} />
      <button
        type="button"
        className="px-btn px-btn-sm self-start"
        disabled={off || view.busy.has("reconcile")}
        onClick={() => void fetchResults()}
        data-testid="workflow-cloud-fetch"
      >
        {t("workflows.cloud.results.fetch")}
      </button>
      <Result said={result} testId="workflow-cloud-fetch-result" />
      {page && (
        <div className="flex flex-col gap-1 text-[13px]" data-testid="workflow-cloud-page">
          <p>
            {page.items.length === 0 && !page.blocked
              ? t("workflows.cloud.results.empty")
              : t("workflows.cloud.results.page", {
                  pending: page.items.filter((i) => i.outcome === "pending").length,
                  retired: page.items.filter((i) => i.outcome === "retired").length,
                })}
          </p>
          {page.more && (
            <p data-testid="workflow-cloud-more">{t("workflows.cloud.results.more")}</p>
          )}
          {page.blocked && (
            <p role="alert" className="text-danger" data-testid="workflow-cloud-blocked">
              {t("workflows.cloud.results.blocked", { reason: reason(page.blocked.reason) })}
            </p>
          )}
        </div>
      )}
      {pause && (
        <p
          role="alert"
          className="bg-warn-bg rounded-xl p-3 text-[13px]"
          data-testid="workflow-cloud-pause"
          data-state={pause}
        >
          {pause === "proof-full"
            ? t("workflows.cloud.proofFull", { max: PROOF_CAPACITY })
            : t("workflows.cloud.retirementFull", { max: TOMBSTONES_MAX })}
        </p>
      )}
      {deliverable.length > 0 && (
        <div className="flex flex-col gap-2" data-testid="workflow-cloud-deliverable">
          <h3 className="ios-gh text-[13px]">{t("workflows.cloud.deliver.title")}</h3>
          <p className="text-ink-2 text-[13px]">{t("workflows.cloud.deliver.help")}</p>
          {deliverable.map((d, i) => {
            const wf = workflows.find((w) => w.id === d.workflowId);
            const label = `${uid}-proof-${i}`;
            const disabled = off || view.busy.has(d.key);
            return (
              <div
                key={d.key}
                className="flex min-w-0 flex-col gap-1 text-[13px]"
                data-testid="workflow-cloud-proof"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Chip tone={d.state === "done" ? "tint" : "warn"}>
                    {t(`workflows.cloud.state.${d.state}`)}
                  </Chip>
                  <span id={label} className="min-w-0 break-words">
                    {wf?.name[lang].trim() ||
                      wf?.name.ar.trim() ||
                      wf?.name.en.trim() ||
                      d.workflowId}
                  </span>
                  <span className="ms-auto flex gap-2">
                    <button
                      type="button"
                      className="px-btn px-btn-ghost px-btn-sm"
                      disabled={disabled}
                      aria-describedby={label}
                      onClick={() => void proofAction("check", d.key)}
                      data-testid="workflow-cloud-proof-status"
                    >
                      {t("workflows.cloud.status")}
                    </button>
                    <button
                      type="button"
                      className="px-btn px-btn-ghost px-btn-sm"
                      disabled={disabled || isAcked(d.key)}
                      aria-describedby={label}
                      onClick={() => void proofAction("ack", d.key)}
                      data-testid="workflow-cloud-ack"
                    >
                      {t("workflows.cloud.deliver.button")}
                    </button>
                  </span>
                </div>
                <Result said={said[d.key]} testId="workflow-cloud-ack-result" />
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
