"use client";

import { Briefcase, MessageSquareText, Pencil, Plus } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import Chip from "@/components/ui/ios/Chip";
import EmptyState from "@/components/ui/ios/EmptyState";
import { DEAL_STAGES, type BrandDeal, type DealStage } from "@/lib/domain";
import { dealRate, dealReplyDraft, emptyKit, kitMetrics, REPLY_DRAFT_MAX } from "@/lib/businessKit";
import { useT, type MessageKey } from "@/lib/i18n";
import {
  analyticsState,
  businessBase,
  useStore,
  type BrandDealPatch,
  type BrandDealResult,
  type BusinessBase,
} from "@/store";

type Form = { brand: string; contact: string; deliverable: string; value: string; notes: string };
const EMPTY_FORM: Form = { brand: "", contact: "", deliverable: "", value: "", notes: "" };
const toPatch = (f: Form): BrandDealPatch => ({
  brand: f.brand,
  contact: f.contact,
  deliverable: f.deliverable,
  valueSar: f.value.trim() === "" ? null : Math.max(0, Math.round(Number(f.value) || 0)),
  notes: f.notes,
});
const errorKey = (r: Exclude<BrandDealResult, { ok: true }>, form = false): MessageKey =>
  form && r.reason === "conflict"
    ? "business.deals.err.staleForm"
    : r.reason === "unsupported-save"
      ? "business.deals.err.unsupported"
      : r.reason === "not-persisted"
        ? "business.deals.err.notPersisted"
        : `business.deals.err.${r.reason}`;

/** The add / edit fields of a deal. */
function DealFields({
  form,
  onChange,
  prefix,
  withNotes,
}: {
  form: Form;
  onChange: (f: Form) => void;
  prefix: string;
  withNotes: boolean;
}) {
  const { t } = useT();
  const field = (key: keyof Form, label: MessageKey, max: number, type = "text") => (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-ink-2 text-[13px] font-semibold">{t(label)}</span>
      <input
        className="px-input"
        type={type}
        min={type === "number" ? 0 : undefined}
        maxLength={type === "number" ? undefined : max}
        value={form[key]}
        onChange={(e) => onChange({ ...form, [key]: e.target.value })}
        data-testid={`${prefix}-${key}`}
      />
    </label>
  );
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {field("brand", "business.deals.brand", 120)}
      {field("contact", "business.deals.contact", 200)}
      {field("deliverable", "business.deals.deliverable", 200)}
      {field("value", "business.deals.value", 12, "number")}
      {withNotes && (
        <label className="flex min-w-0 flex-col gap-1 sm:col-span-2">
          <span className="text-ink-2 text-[13px] font-semibold">{t("business.deals.notes")}</span>
          <textarea
            className="px-input min-h-20"
            maxLength={1000}
            value={form.notes}
            onChange={(e) => onChange({ ...form, notes: e.target.value })}
            data-testid={`${prefix}-notes`}
          />
        </label>
      )}
    </div>
  );
}

/** The reply draft built from the deal and the kit as stored now (DT-5-R1: a local starting point, never sent). */
function draftFor(deal: BrandDeal): string {
  const s = useStore.getState();
  const kit = s.businessKit ?? emptyKit();
  const metrics = kitMetrics(
    analyticsState(s),
    new Date(),
    kit.featuredPlatforms.length ? kit.featuredPlatforms : undefined,
  );
  return dealReplyDraft(deal, kit, dealRate(deal, kit, metrics));
}

type Reply = {
  id: string;
  text: string;
  base: BusinessBase;
  /** DT-5-R2 (R1-E): bumped each time a panel opens; a save or copy only acknowledges in the session it started in. */
  session: number;
  status: "saved" | "earlierSaved" | "copied" | "copyFailed" | null;
};

/**
 * Brand deals (packet DT-5): a board filtered by stage, an add form, inline edit and a stage picker per row. Every
 * write is one locked store commit under the deal's commit id; deals are never deleted (stage "lost" keeps them).
 */
export default function DealsBoard() {
  const { t } = useT();
  const deals = useStore((s) => s.brandDeals);
  const [filter, setFilter] = useState<DealStage | "all">("all");
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<Form>(EMPTY_FORM);
  // R5: the base is captured when the form opens, so a restore or another tab's edit meanwhile is a conflict.
  const [editing, setEditing] = useState<{ id: string; form: Form; base: BusinessBase } | null>(
    null,
  );
  const [reply, setReply] = useState<Reply | null>(null);
  const sessions = useRef(0);
  const [error, setError] = useState<MessageKey | null>(null);
  const [busy, setBusy] = useState(false);

  const rows = useMemo(
    () =>
      deals
        .filter((d) => filter === "all" || d.stage === filter)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [deals, filter],
  );

  const run = async (
    write: () => Promise<BrandDealResult>,
    after?: (deal: BrandDeal) => void,
    form = false,
  ) => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await write();
      if (r.ok) {
        setError(null);
        after?.(r.deal);
      } else setError(errorKey(r, form));
    } finally {
      setBusy(false);
    }
  };

  const add = () =>
    run(
      () => useStore.getState().addBrandDeal(toPatch(form) as BrandDealPatch & { brand: string }),
      () => {
        setForm(EMPTY_FORM);
        setAdding(false);
      },
    );

  const setStage = (deal: BrandDeal, stage: DealStage) =>
    run(() => useStore.getState().setBrandDealStage(deal.id, stage, businessBase(deal)));

  const saveEdit = () => {
    if (!editing) return;
    const { id, form: f, base } = editing;
    return run(
      () => useStore.getState().updateBrandDeal(id, toPatch(f), base),
      () => setEditing(null),
      true,
    );
  };

  const openReply = (d: BrandDeal) => {
    setError(null);
    setReply({
      id: d.id,
      text: d.replyDraft || draftFor(d),
      base: businessBase(d),
      session: ++sessions.current,
      status: null,
    });
  };
  /** The same panel session the token was taken in (same deal, not closed and reopened since). */
  const sameSession = (r: Reply | null, id: string, session: number): r is Reply =>
    r?.id === id && r.session === session;
  const saveReply = () => {
    if (!reply) return;
    const { id, text, base, session } = reply;
    return run(
      () => useStore.getState().updateBrandDeal(id, { replyDraft: text }, base),
      // R1-E: "saved" only while the textarea still holds the submitted text; newer text stays unsaved and is saved
      // against the refreshed base, with a line saying an earlier version was saved.
      (deal) =>
        setReply((r) =>
          sameSession(r, id, session)
            ? { ...r, base: businessBase(deal), status: r.text === text ? "saved" : "earlierSaved" }
            : r,
        ),
      true,
    );
  };
  const copyReply = async () => {
    if (!reply) return;
    const { id, text, session } = reply;
    let status: Reply["status"] = "copied";
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      status = "copyFailed";
    }
    // R1-E: "Copied" only for the deal and the text that were copied, in the session that copied it.
    setReply((r) =>
      sameSession(r, id, session) && (status !== "copied" || r.text === text)
        ? { ...r, status }
        : r,
    );
  };

  const replyPanel = (d: BrandDeal) =>
    reply?.id === d.id && (
      <div className="flex flex-col gap-2 border-t pt-2" data-testid="deal-reply-panel">
        <p className="text-ink-2 text-[13px] font-semibold" data-testid="deal-reply-label">
          {t("business.reply.label")}
        </p>
        <label className="flex min-w-0 flex-col gap-1">
          <span className="text-ink-2 text-[13px] font-semibold">{t("business.reply.text")}</span>
          <textarea
            className="px-input min-h-48"
            dir="auto"
            maxLength={REPLY_DRAFT_MAX}
            value={reply.text}
            onChange={(e) => setReply({ ...reply, text: e.target.value, status: null })}
            data-testid="deal-reply-text"
          />
        </label>
        {reply.status && (
          <p role="status" className="text-tint text-[13px]" data-testid="deal-reply-status">
            {t(`business.reply.${reply.status}`)}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="px-btn px-btn-sm"
            disabled={busy}
            onClick={() => void saveReply()}
            data-testid="deal-reply-save"
          >
            {t("business.reply.save")}
          </button>
          <button
            type="button"
            className="px-btn px-btn-ghost px-btn-sm"
            onClick={() => void copyReply()}
            data-testid="deal-reply-copy"
          >
            {t("business.reply.copy")}
          </button>
          <button
            type="button"
            className="px-btn px-btn-ghost px-btn-sm"
            onClick={() => setReply({ ...reply, text: draftFor(d), status: null })}
            data-testid="deal-reply-rebuild"
          >
            {t("business.reply.rebuild")}
          </button>
          <button
            type="button"
            className="px-btn px-btn-ghost px-btn-sm"
            onClick={() => setReply(null)}
            data-testid="deal-reply-close"
          >
            {t("business.reply.close")}
          </button>
        </div>
      </div>
    );

  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="deals-board">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-0 flex-col gap-1">
          <span className="text-ink-2 text-[13px] font-semibold">{t("business.deals.filter")}</span>
          <select
            className="px-input"
            value={filter}
            onChange={(e) => setFilter(e.target.value as DealStage | "all")}
            data-testid="deal-filter"
          >
            <option value="all">{t("business.deals.all")}</option>
            {DEAL_STAGES.map((s) => (
              <option key={s} value={s}>
                {t(`business.stage.${s}`)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="px-btn ms-auto"
          onClick={() => {
            setAdding(true);
            setError(null);
          }}
          data-testid="deal-new"
        >
          <Plus size={16} strokeWidth={1.75} aria-hidden />
          {t("business.deals.new")}
        </button>
      </div>

      {error && (
        <p role="alert" className="text-danger text-[13px]" data-testid="deal-error">
          {t(error)}
        </p>
      )}

      {adding && (
        <div className="ios-card flex flex-col gap-2 p-4" data-testid="deal-form">
          <DealFields form={form} onChange={setForm} prefix="deal" withNotes={false} />
          <div className="flex gap-2">
            <button
              type="button"
              className="px-btn px-btn-sm"
              disabled={busy}
              onClick={() => void add()}
              data-testid="deal-save"
            >
              {t("business.deals.save")}
            </button>
            <button
              type="button"
              className="px-btn px-btn-ghost px-btn-sm"
              onClick={() => setAdding(false)}
            >
              {t("business.deals.cancel")}
            </button>
          </div>
        </div>
      )}

      {deals.length === 0 && !adding && (
        <EmptyState
          icon={<Briefcase size={28} strokeWidth={1.75} aria-hidden />}
          title={t("business.deals.empty")}
          hint={t("business.deals.emptyHint")}
          testId="deals-empty"
        />
      )}

      <ul className="flex flex-col gap-2">
        {rows.map((d) =>
          editing?.id === d.id ? (
            <li key={d.id} className="ios-card flex flex-col gap-2 p-4" data-testid="deal-row">
              <DealFields
                form={editing.form}
                onChange={(f) => setEditing({ ...editing, form: f })}
                prefix="deal-edit"
                withNotes
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  className="px-btn px-btn-sm"
                  disabled={busy}
                  onClick={() => void saveEdit()}
                  data-testid="deal-edit-save"
                >
                  {t("business.deals.save")}
                </button>
                <button
                  type="button"
                  className="px-btn px-btn-ghost px-btn-sm"
                  onClick={() => setEditing(null)}
                  data-testid="deal-edit-cancel"
                >
                  {t("business.deals.cancel")}
                </button>
              </div>
            </li>
          ) : (
            <li
              key={d.id}
              className="ios-card flex min-w-0 flex-col gap-1.5 p-4"
              data-testid="deal-row"
              data-stage={d.stage}
            >
              <div className="flex flex-wrap items-center gap-2">
                <b className="min-w-0 text-[16px] break-words">{d.brand}</b>
                <Chip tone={d.stage === "lost" ? "default" : "tint"}>
                  {t(`business.stage.${d.stage}`)}
                </Chip>
                <span className="ms-auto text-[14px] font-semibold" dir="ltr">
                  {d.valueSar === null
                    ? t("business.deals.noValue")
                    : t("business.price.sar", { n: d.valueSar })}
                </span>
              </div>
              {d.deliverable && <p className="text-[14px]">{d.deliverable}</p>}
              {d.contact && (
                <p className="text-ink-2 text-[13px] break-words" dir="auto">
                  {d.contact}
                </p>
              )}
              {d.notes && (
                <p className="text-ink-2 text-[13px] break-words whitespace-pre-line">{d.notes}</p>
              )}
              <div className="flex flex-wrap items-end gap-2">
                <label className="flex min-w-0 flex-col gap-1">
                  <span className="text-ink-2 text-[12px]">{t("business.deals.stage")}</span>
                  <select
                    className="px-input"
                    value={d.stage}
                    disabled={busy}
                    onChange={(e) => void setStage(d, e.target.value as DealStage)}
                    data-testid="deal-stage"
                  >
                    {DEAL_STAGES.map((s) => (
                      <option key={s} value={s}>
                        {t(`business.stage.${s}`)}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="px-btn px-btn-ghost px-btn-sm"
                  onClick={() =>
                    setEditing({
                      id: d.id,
                      base: businessBase(d),
                      form: {
                        brand: d.brand,
                        contact: d.contact,
                        deliverable: d.deliverable,
                        value: d.valueSar === null ? "" : String(d.valueSar),
                        notes: d.notes,
                      },
                    })
                  }
                  data-testid="deal-edit"
                >
                  <Pencil size={14} strokeWidth={1.75} aria-hidden />
                  {t("business.deals.edit")}
                </button>
                <button
                  type="button"
                  className="px-btn px-btn-ghost px-btn-sm"
                  onClick={() => (reply?.id === d.id ? setReply(null) : openReply(d))}
                  aria-expanded={reply?.id === d.id}
                  data-testid="deal-reply"
                >
                  <MessageSquareText size={14} strokeWidth={1.75} aria-hidden />
                  {t("business.reply.open")}
                </button>
              </div>
              {replyPanel(d)}
            </li>
          ),
        )}
      </ul>
    </div>
  );
}
