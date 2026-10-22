"use client";

import { useState, type ReactNode } from "react";
import Sheet from "@/components/ui/ios/Sheet";
import { useT, type MessageKey } from "@/lib/i18n";
import { workerOrigin } from "@/lib/inbox";
import {
  dmControlKey,
  instagramDmControlReadiness,
  type DmControlMode,
  type DmControlRow,
} from "@/lib/inboxInstagramDmControl";
import { scoutConfig } from "@/lib/scoutClient";
import { useStore, type InboxInstagramDmControl } from "@/store";
import { When } from "./parts";
import { useInbox } from "./useInbox";
import {
  checkInstagramDmControl,
  confirmInstagramDmControl,
  openInstagramDmControlReview,
  registerInstagramDmControl,
  useInstagramDmControlViews,
  type DmControlAction,
  type DmControlTarget,
  type DmControlUiView,
} from "./useInstagramDmControl";

/**
 * 🛟 Conversation takeover/resume for one Instagram conversation, its review sheet and the recovery list (packet
 * DT-6B-2C-5B, planning/tools/37-inbox-send.md). Linking a NEW conversation is closed in production
 * (`instagramDmControlReadiness`): the Link button is disabled with the honest reason and nothing is asked. A verified
 * handle kept on this device opens to Check status, and to an explicit review of Take over or Resume naming the account,
 * conversation, person, the observed mode and revision, the requested change, the true in-flight total (rows only from a
 * validated view, limited when truncated) and the unknown-outcome count separately. Nothing here sends a message, and
 * the DM send controls never call any of this.
 */

/** The configured Worker's origin (null without one). */
function useWorkerOrigin(): string | null {
  const keys = useStore((s) => s.settings.apiKeys);
  return workerOrigin(scoutConfig(keys.scoutUrl, keys.scoutToken));
}

const modeKey = (m: DmControlMode): MessageKey => `inbox.igControl.mode.${m}` as MessageKey;

/** The in-flight total, the rows a validated view carried (limited when truncated) and the unknown-outcome count. */
function Counts({
  total,
  uncertain,
  rows,
}: {
  total: number;
  uncertain: number;
  /** Rows of a validated view (undefined: none loaded here). */
  rows?: DmControlRow[];
}) {
  const { t } = useT();
  return (
    <div className="flex flex-col gap-1 text-[13px]">
      <p className="text-ink-2" data-testid="ibx-igctl-inflight" data-total={total}>
        {t("inbox.igControl.inFlight", { count: total })}
      </p>
      {rows && rows.length > 0 && (
        <ul className="ios-list flex flex-col gap-0.5 p-2">
          {rows.map((r) => (
            <li
              key={r.inboundMessageId}
              className="text-muted break-all"
              data-testid="ibx-igctl-row"
            >
              {t("inbox.igControl.row", { id: r.inboundMessageId })} <When iso={r.claimedAt} /> ·{" "}
              {t(
                r.actor.startsWith("auto:")
                  ? "inbox.igControl.actor.auto"
                  : "inbox.igControl.actor.manual",
              )}
            </li>
          ))}
        </ul>
      )}
      {rows && total > rows.length && (
        <p className="text-muted" data-testid="ibx-igctl-rows-limited">
          {t("inbox.igControl.rowsLimited", { shown: rows.length, total })}
        </p>
      )}
      {!rows && total > 0 && (
        <p className="text-muted" data-testid="ibx-igctl-rows-not-loaded">
          {t("inbox.igControl.rowsNotLoaded")}
        </p>
      )}
      <p className="text-ink-2" data-testid="ibx-igctl-uncertain-count" data-count={uncertain}>
        {t("inbox.igControl.uncertainCount", { count: uncertain })}
      </p>
    </div>
  );
}

/** The stored mode, revision and counts of a verified handle (as last checked on this device). */
function StoredState({ e }: { e: InboxInstagramDmControl }) {
  const { t } = useT();
  if (!e.mode || e.revision === undefined) return null;
  return (
    <div className="flex flex-col gap-1">
      <p
        className="text-[15px] font-semibold"
        data-testid="ibx-igctl-status"
        data-mode={e.mode}
        data-revision={e.revision}
      >
        {t(modeKey(e.mode))} · {t("inbox.igControl.revision", { revision: e.revision })}
      </p>
      <p className="text-muted text-[13px]">{t("inbox.igControl.lastChecked")}</p>
      {e.inFlightTotal !== undefined && e.uncertainTotal !== undefined ? (
        <Counts total={e.inFlightTotal} uncertain={e.uncertainTotal} />
      ) : (
        <p className="text-muted text-[13px]" data-testid="ibx-igctl-counts-unknown">
          {t("inbox.igControl.countsUnknown")}
        </p>
      )}
    </div>
  );
}

function SheetBody({
  controlKey,
  e,
  v,
  accountName,
  onClose,
}: {
  controlKey: string;
  e: InboxInstagramDmControl | undefined;
  v: DmControlUiView;
  accountName: string | null;
  onClose: () => void;
}) {
  const { t } = useT();
  const line = (key: MessageKey, vars?: Record<string, string | number>, cls = "text-ink-2") => (
    <p className={`${cls} text-[15px]`} role="status">
      {t(key, vars)}
    </p>
  );
  const btn = (
    id: string,
    label: MessageKey,
    onClick: () => void,
    primary = false,
    disabled = false,
  ) => (
    <button
      type="button"
      className={`px-btn px-btn-sm ${primary ? "" : "px-btn-ghost"}`}
      disabled={disabled}
      onClick={onClick}
      data-testid={id}
    >
      {t(label)}
    </button>
  );
  const check = () => void checkInstagramDmControl(controlKey);
  const review = (action: DmControlAction) => void openInstagramDmControlReview(controlKey, action);
  const errorLine = v.error && (
    <p className="text-danger text-[13px]" role="alert" data-testid="ibx-igctl-error">
      {t(`inbox.igControl.err.${v.error}` as MessageKey)}
      {v.detail ? ` ${t(`inbox.igControl.detail.${v.detail}` as MessageKey)}` : ""}
    </p>
  );
  const actions = (...more: ReactNode[]) => (
    <div className="flex flex-wrap gap-2">
      {more.filter(Boolean)}
      {e?.handleId &&
        btn("ibx-igctl-sheet-check", "inbox.igControl.check", check, more.length === 0)}
      {btn("ibx-igctl-close", "inbox.igControl.close", onClose)}
    </div>
  );
  const view = v.view;
  const viewState = view && (
    <>
      <p
        className="text-[15px] font-semibold"
        data-testid="ibx-igctl-observed"
        data-mode={view.conversation.mode}
      >
        {t(modeKey(view.conversation.mode))} ·{" "}
        {t("inbox.igControl.revision", { revision: view.conversation.revision })}
      </p>
      <Counts total={view.inFlightTotal} uncertain={view.uncertainTotal} rows={view.inFlight} />
    </>
  );
  /** Opening a new review from a validated view (never automatic). */
  const nextChange =
    view && e?.handleId && !e.pending && !e.uncertain
      ? view.conversation.mode === "auto"
        ? btn("ibx-igctl-sheet-takeover", "inbox.igControl.takeover", () => review("takeover"))
        : btn("ibx-igctl-sheet-resume", "inbox.igControl.resume", () => review("resume"))
      : null;

  switch (v.phase) {
    case "idle":
    case "busy":
      return line("inbox.igControl.asking");
    case "closed":
      return (
        <>
          {line("inbox.igControl.closed")}
          {actions()}
        </>
      );
    case "status":
      return (
        <>
          <p className="text-ink-2 text-[13px]" data-testid="ibx-igctl-checked">
            {t("inbox.igControl.checked")}
          </p>
          {v.resolved && (
            <p className="text-warn text-[13px]" data-testid="ibx-igctl-resolved">
              {t("inbox.igControl.resolved")}
            </p>
          )}
          {e?.pending && (
            <p className="text-warn text-[13px]" data-testid="ibx-igctl-sheet-blocked">
              {t("inbox.igControl.blocked")}
            </p>
          )}
          {viewState}
          {actions(<span key="next">{nextChange}</span>)}
        </>
      );
    case "done": {
      const mode = view?.conversation.mode ?? "auto";
      return (
        <>
          <p
            className="text-[15px]"
            role="status"
            data-testid="ibx-igctl-result"
            data-changed={String(!!v.changed)}
          >
            {t(
              v.changed
                ? mode === "human"
                  ? "inbox.igControl.done.takeover"
                  : "inbox.igControl.done.resume"
                : "inbox.igControl.done.unchanged",
            )}
          </p>
          {viewState}
          {actions()}
        </>
      );
    }
    case "conflict":
      return (
        <>
          <p className="text-warn text-[15px]" role="status" data-testid="ibx-igctl-conflict">
            {v.conflict &&
              `${t(modeKey(v.conflict.conversation.mode))} · ${t("inbox.igControl.conflict", {
                revision: v.conflict.conversation.revision,
              })}`}
          </p>
          {actions()}
        </>
      );
    case "uncertain":
      return (
        <>
          <p className="text-warn text-[15px]" role="status" data-testid="ibx-igctl-uncertain">
            {t(e?.handleId ? "inbox.igControl.uncertain" : "inbox.igControl.registrationUncertain")}
          </p>
          {errorLine}
          {actions()}
        </>
      );
    case "unavailable":
      return (
        <>
          <p className="text-warn text-[15px]" role="status" data-testid="ibx-igctl-unavailable">
            {t("inbox.igControl.unavailable")}
          </p>
          {actions()}
        </>
      );
    case "error":
      return (
        <>
          {errorLine}
          {actions()}
        </>
      );
    case "review":
    case "confirming": {
      const r = v.review;
      if (!r || !e) return line("inbox.igControl.asking");
      const confirming = v.phase === "confirming";
      // Rows only while storage still holds the record they were recorded as (DT-6B-2C-5B-R1).
      const bound = view && v.commit === e.commitId ? view : undefined;
      return (
        <>
          <p className="text-[15px] font-semibold">
            {t(
              r.action === "takeover"
                ? "inbox.igControl.review.takeover"
                : "inbox.igControl.review.resume",
            )}
          </p>
          <dl className="flex flex-col gap-2 text-[15px]" data-testid="ibx-igctl-review">
            <div>
              <dt className="text-ink-2 text-[13px] font-semibold">
                {t("inbox.igControl.account")}
              </dt>
              <dd data-testid="ibx-igctl-account">
                <bdi dir="ltr">{accountName ? `@${accountName}` : e.account}</bdi>
              </dd>
            </div>
            <div>
              <dd
                className="text-muted text-[13px] break-all"
                data-testid="ibx-igctl-conversation-id"
              >
                {t("inbox.igControl.conversationId")} <bdi dir="ltr">{e.conversationId}</bdi>
              </dd>
              <dd className="text-muted text-[13px] break-all" data-testid="ibx-igctl-recipient-id">
                {t("inbox.igControl.recipientId")} <bdi dir="ltr">{e.recipientId}</bdi>
              </dd>
            </div>
            <div>
              <dt className="text-ink-2 text-[13px] font-semibold">
                {t("inbox.igControl.observed")}
              </dt>
              <dd data-testid="ibx-igctl-observed" data-mode={e.mode}>
                {e.mode && t(modeKey(e.mode))} ·{" "}
                {t("inbox.igControl.revision", { revision: r.expectedRevision })}
              </dd>
            </div>
            <div>
              <dt className="text-ink-2 text-[13px] font-semibold">
                {t("inbox.igControl.change")}
              </dt>
              <dd data-testid="ibx-igctl-change" data-mode={r.mode}>
                {t(
                  r.action === "takeover"
                    ? "inbox.igControl.change.takeover"
                    : "inbox.igControl.change.resume",
                )}
              </dd>
            </div>
          </dl>
          {bound ? (
            <Counts
              total={bound.inFlightTotal}
              uncertain={bound.uncertainTotal}
              rows={bound.inFlight}
            />
          ) : (
            <>
              <p className="text-muted text-[13px]">{t("inbox.igControl.lastChecked")}</p>
              <Counts total={e.inFlightTotal ?? 0} uncertain={e.uncertainTotal ?? 0} />
            </>
          )}
          <p className="text-ink-2 text-[13px]" data-testid="ibx-igctl-copy" data-mode={r.mode}>
            {t(
              r.action === "takeover"
                ? "inbox.igControl.copy.takeover"
                : "inbox.igControl.copy.resume",
            )}
          </p>
          <p className="text-muted text-[13px]" data-testid="ibx-igctl-copy-unknown">
            {t("inbox.igControl.copy.unknown")}
          </p>
          {confirming && line("inbox.igControl.asking")}
          {actions(
            <span key="confirm">
              {btn(
                "ibx-igctl-confirm",
                r.action === "takeover"
                  ? "inbox.igControl.confirm.takeover"
                  : "inbox.igControl.confirm.resume",
                () => void confirmInstagramDmControl(controlKey),
                true,
                confirming,
              )}
            </span>,
          )}
        </>
      );
    }
  }
}

/**
 * The takeover controls of one conversation: in its conversation view (`offered`: the gated Link opener) or for one
 * stored handle in the recovery list (stored account and Worker only).
 */
export default function InstagramDmControl({
  target,
  accountName = null,
  offered = true,
  controlKey,
}: {
  target: DmControlTarget;
  accountName?: string | null;
  offered?: boolean;
  /** Recovery: the stored entry's own key (its own Worker origin). */
  controlKey?: string;
}) {
  const { t } = useT();
  const here = useWorkerOrigin();
  const key =
    controlKey ?? (here ? dmControlKey(here, target.account, target.conversationId) : null);
  const e = useStore((s) => (key ? s.inboxInstagramDmControls[key] : undefined));
  const v = useInstagramDmControlViews((s) => (key ? s.views[key] : undefined));
  const [open, setOpen] = useState(false);
  if (!key || (!offered && !e)) return null;
  const canRegister = offered && instagramDmControlReadiness().ok;
  const blocked = !!e && (!!e.pending || !!e.uncertain);
  const known = !!e?.handleId && e.inFlightTotal !== undefined;
  const act = (run: () => Promise<void>) => {
    setOpen(true);
    void run();
  };

  return (
    <section className="flex flex-col gap-2" data-testid="ibx-igctl" data-key={key}>
      <h3 className="text-[15px] font-semibold">{t("inbox.igControl.title")}</h3>
      {offered && <p className="text-muted text-[13px]">{t("inbox.igControl.note")}</p>}
      {e?.handleId ? (
        <StoredState e={e} />
      ) : (
        e && (
          <p className="text-warn text-[13px]" data-testid="ibx-igctl-reg-uncertain">
            {t("inbox.igControl.registrationUncertain")}
          </p>
        )
      )}
      {e?.handleId && blocked && (
        <p className="text-warn text-[13px]" data-testid="ibx-igctl-blocked">
          {t("inbox.igControl.blocked")}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {offered && !e?.handleId && (
          <button
            type="button"
            className="px-btn px-btn-sm"
            disabled={!canRegister}
            onClick={() => act(() => registerInstagramDmControl(key, target))}
            data-testid="ibx-igctl-register"
          >
            {t("inbox.igControl.register")}
          </button>
        )}
        {e?.handleId && (
          <button
            type="button"
            className="px-btn px-btn-ghost px-btn-sm"
            onClick={() => act(() => checkInstagramDmControl(key))}
            data-testid="ibx-igctl-check"
          >
            {t("inbox.igControl.check")}
          </button>
        )}
        {e?.handleId && e.mode && (
          <button
            type="button"
            className="px-btn px-btn-sm"
            disabled={blocked || !known}
            onClick={() =>
              act(() =>
                openInstagramDmControlReview(key, e.mode === "auto" ? "takeover" : "resume"),
              )
            }
            data-testid={e.mode === "auto" ? "ibx-igctl-takeover" : "ibx-igctl-resume"}
          >
            {t(e.mode === "auto" ? "inbox.igControl.takeover" : "inbox.igControl.resume")}
          </button>
        )}
      </div>
      {offered && !e?.handleId && !canRegister && (
        <p className="text-muted text-[13px]" data-testid="ibx-igctl-register-unavailable">
          {t("inbox.igControl.registerUnavailable")}
        </p>
      )}
      {open && (
        <Sheet
          onClose={() => setOpen(false)}
          title={t("inbox.igControl.sheetTitle")}
          titleId={`ibx-igctl-${key}`}
          testId="ibx-igctl-sheet"
          attrs={{ "data-phase": v?.phase ?? "idle" }}
        >
          <div className="flex flex-col gap-3 p-4">
            <SheetBody
              controlKey={key}
              e={e}
              v={v ?? { phase: "idle" }}
              accountName={accountName}
              onClose={() => setOpen(false)}
            />
          </div>
        </Sheet>
      )}
    </section>
  );
}

/**
 * Every conversation control this device keeps, whatever account is on screen (or none) and whatever provider: each one
 * of the configured Worker opens to Check status and, from a validated view, to an explicit review, for its own stored
 * account and Worker. Entries of another Worker, or all of them while no Worker is configured, are named and never asked.
 */
export function InstagramDmControlRecoveryList() {
  const { t } = useT();
  const live = useInbox((s) => s.account);
  const all = Object.entries(useStore((s) => s.inboxInstagramDmControls));
  const here = useWorkerOrigin();
  if (all.length === 0) return null;
  const mine = here ? all.filter(([, e]) => e.workerOrigin === here) : [];
  const foreign = all.filter(([, e]) => !here || e.workerOrigin !== here);
  return (
    <>
      {mine.length > 0 && (
        <section className="ios-list flex flex-col gap-2 p-3" data-testid="ibx-igctl-recovery">
          <h3 className="text-[15px] font-semibold">{t("inbox.igControl.recovery.title")}</h3>
          <ul className="flex flex-col gap-3">
            {mine.map(([key, e]) => (
              <li key={key} className="flex flex-col gap-1" data-testid="ibx-igctl-recovery-item">
                <span className="text-muted text-[13px] break-all">
                  {t("inbox.igControl.recovery.item", {
                    id: e.account,
                    conversation: e.conversationId,
                  })}
                </span>
                <InstagramDmControl
                  controlKey={key}
                  offered={false}
                  target={{ account: e.account, conversationId: e.conversationId }}
                  accountName={live?.accountId === e.account ? live.handle : null}
                />
              </li>
            ))}
          </ul>
        </section>
      )}
      {foreign.length > 0 && (
        <section
          className="ios-list flex flex-col gap-2 p-3"
          data-testid="ibx-igctl-recovery-foreign"
        >
          <h3 className="text-[15px] font-semibold">
            {t("inbox.igControl.recovery.foreignTitle")}
          </h3>
          {!here && (
            <p className="text-ink-2 text-[13px]">{t("inbox.igControl.recovery.noWorker")}</p>
          )}
          <ul className="flex flex-col gap-2">
            {foreign.map(([key, e]) => (
              <li
                key={key}
                className="text-ink-2 text-[13px] break-all"
                data-testid="ibx-igctl-foreign-item"
              >
                {t("inbox.igControl.recovery.foreignItem", { conversation: e.conversationId })}{" "}
                <bdi dir="ltr">{e.workerOrigin}</bdi>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
