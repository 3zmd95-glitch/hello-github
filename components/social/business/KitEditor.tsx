"use client";

import { Download, Eye, EyeOff, Plus, Printer, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import Chip from "@/components/ui/ios/Chip";
import PlatformBadge from "@/components/ui/ios/PlatformBadge";
import {
  emptyKit,
  estimateExplain,
  kitFileName,
  kitIssues,
  kitMetrics,
  kitProjection,
} from "@/lib/businessKit";
import { KIT_DELIVERABLES, PLATFORMS, type BusinessKit, type Platform } from "@/lib/domain";
import { useT, type MessageKey } from "@/lib/i18n";
import { PLATFORM_META } from "@/lib/social";
import {
  analyticsState,
  articlesGeneration,
  businessBase,
  useStore,
  type BusinessBase,
  type BusinessKitResult,
} from "@/store";
import KitPreview, { METRIC_ROWS, metricText, provenance } from "./KitPreview";

const SAVE_DELAY_MS = 400;

type SaveState =
  "idle" | "saving" | "saved" | "notPersisted" | "conflict" | "unsupported" | "invalid";
type Draft = Pick<
  BusinessKit,
  | "tagline"
  | "bio"
  | "contact"
  | "services"
  | "rateCard"
  | "pastWork"
  | "featuredPlatforms"
  | "estimator"
>;
type Bi = { ar: string; en: string };
const EMPTY: Bi = { ar: "", en: "" };

const toDraft = (k: BusinessKit | null): Draft => {
  const x = k ?? emptyKit();
  return {
    tagline: x.tagline,
    bio: x.bio,
    contact: x.contact,
    services: x.services,
    rateCard: x.rateCard,
    pastWork: x.pastWork,
    featuredPlatforms: x.featuredPlatforms,
    estimator: x.estimator,
  };
};
const sameDraft = (a: Draft, b: Draft) => JSON.stringify(a) === JSON.stringify(b);
const rowId = () =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `r${Math.random().toString(36).slice(2, 10)}`;
const nowTime = (lang: "ar" | "en") =>
  new Date().toLocaleTimeString(lang === "ar" ? "ar-SA-u-nu-latn" : "en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
const num = (v: string) => Math.max(0, Number(v) || 0);

/** Kit edits that could not be saved when the editor closed (same discipline as the workflow editor). */
export interface UnsavedKitDraft {
  fields: Draft;
  base: BusinessBase;
  reason: string;
  at: string;
  /** Increases with every stash: a pending save clears the stash only while it still holds its own token. */
  token: number;
}

/** The one unsaved kit draft; not persisted (the beforeunload guard covers closing the page). */
export const unsavedKitDraft = create<{ draft?: UnsavedKitDraft }>(() => ({}));
let lastToken = 0;

const dropUnsaved = (token?: number) =>
  unsavedKitDraft.setState((st) =>
    token !== undefined && st.draft?.token !== token ? st : { draft: undefined },
  );

const blockUnload = (e: BeforeUnloadEvent) => {
  e.preventDefault();
  e.returnValue = "";
};

// App-lifetime guard: while a kit draft is stashed, closing or reloading the page asks first.
unsavedKitDraft.subscribe(({ draft }) => {
  window[draft ? "addEventListener" : "removeEventListener"]("beforeunload", blockUnload);
});

/**
 * 💼 The media kit editor (packet DT-5): the owner's text, services, rate card and past work, saved like the CMS and
 * workflow editors ("Saved ✓" only after the store read the commit back; another tab's change never overwrites what
 * is on screen; unsaved edits are stashed when the editor closes). Metrics come from Growth with their provenance;
 * the estimator is the owner's own assumptions. Preview, print and export use the current draft.
 */
export default function KitEditor() {
  const { t, lang } = useT();
  const stored = useStore((s) => s.businessKit);
  const analytics = useStore(useShallow(analyticsState));

  const [draft, setDraftState] = useState<Draft>(() => toDraft(stored));
  const [save, setSaveState] = useState<SaveState>("idle");
  const [savedAt, setSavedAt] = useState("");
  const [dirtyState, setDirtyState] = useState(false);
  const [stash, setStash] = useState<UnsavedKitDraft | undefined>(
    () => unsavedKitDraft.getState().draft,
  );
  const [showPreview, setShowPreview] = useState(false);
  const [estPlatform, setEstPlatform] = useState<Platform | "">("");
  const [estDeliverable, setEstDeliverable] = useState<(typeof KIT_DELIVERABLES)[number]>("post");

  const draftRef = useRef(draft);
  const dirty = useRef(false);
  const saveRef = useRef<SaveState>("idle");
  // Captured even before the first save: commitId null + the generation (Amendment A).
  const base = useRef<BusinessBase>(businessBase(stored));
  const chain = useRef<Promise<boolean>>(Promise.resolve(true));
  const committing = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stashShown = useRef(stash);

  const showStash = (st: UnsavedKitDraft | undefined) => {
    stashShown.current = st;
    setStash(st);
  };
  const setDraft = (d: Draft) => {
    draftRef.current = d;
    setDraftState(d);
  };
  const setDirty = (v: boolean) => {
    dirty.current = v;
    setDirtyState(v);
  };
  const setSave = (s: SaveState) => {
    saveRef.current = s;
    setSaveState(s);
    if (s === "saved") setSavedAt(nowTime(useStore.getState().settings.lang));
  };
  const current = () => useStore.getState().businessKit;
  const adopt = (k: BusinessKit | null) => {
    base.current = businessBase(k);
    setDirty(false);
    setDraft(toDraft(k));
    setSave("idle");
  };

  /** Compare the stored kit with what the editor is based on (runs on every store change). */
  const check = () => {
    if (committing.current) return;
    const k = current();
    const b = base.current;
    if ((k?.commitId ?? null) === b.commitId && b.generation === articlesGeneration()) return;
    if (sameDraft(toDraft(k), draftRef.current)) adopt(k);
    else if (dirty.current || saveRef.current === "conflict") setSave("conflict");
    else adopt(k);
  };

  const settle = (r: BusinessKitResult, sent: Draft): boolean => {
    if (r.ok) {
      base.current = businessBase(r.kit);
      if (draftRef.current === sent) setDirty(false);
      setSave("saved");
      return true;
    }
    if (r.reason === "unsupported-save") setSave("unsupported");
    else if (r.reason === "not-persisted") setSave("notPersisted");
    else if (r.reason === "invalid") setSave("invalid");
    else setSave("conflict");
    return false;
  };

  const saveNow = async (): Promise<boolean> => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (saveRef.current === "conflict") return false;
    if (!dirty.current) return true;
    const sent = draftRef.current;
    committing.current += 1;
    let r: BusinessKitResult;
    try {
      r = await useStore.getState().saveBusinessKit(sent, base.current);
    } catch {
      r = { ok: false, reason: "not-persisted" };
    } finally {
      committing.current -= 1;
    }
    const ok = settle(r, sent);
    check();
    return ok;
  };
  /** Save pending edits, one save at a time (each starts from the previous one's commit). */
  const flush = (): Promise<boolean> => (chain.current = chain.current.then(saveNow, saveNow));

  const stashNow = (token = ++lastToken) => {
    unsavedKitDraft.setState({
      draft: {
        fields: draftRef.current,
        base: base.current,
        reason: saveRef.current,
        at: new Date().toISOString(),
        token,
      },
    });
    return token;
  };
  /** The editor closes: stash unsaved edits now (synchronously), then save them; only that save clears its stash. */
  const close = () => {
    if (!dirty.current) return;
    const token = stashNow();
    void flush().then((ok) => {
      if (unsavedKitDraft.getState().draft?.token !== token) return;
      if (ok && !dirty.current) dropUnsaved(token);
      else stashNow(token);
    });
  };
  /** A reopened editor follows its stash: once the closed editor's save landed (stash cleared), show the stored kit. */
  const follow = () => {
    const shown = stashShown.current;
    const st = unsavedKitDraft.getState().draft;
    if (!shown || st === shown) return;
    showStash(st);
    if (!st && !dirty.current) adopt(current());
  };

  const flushRef = useRef(flush);
  const checkRef = useRef(check);
  const closeRef = useRef(close);
  const followRef = useRef(follow);
  useEffect(() => {
    flushRef.current = flush;
    checkRef.current = check;
    closeRef.current = close;
    followRef.current = follow;
  });

  useEffect(() => {
    const unsubscribe = useStore.subscribe(() => checkRef.current());
    return () => {
      unsubscribe();
      closeRef.current();
    };
  }, []);

  useEffect(() => {
    followRef.current();
    return unsavedKitDraft.subscribe(() => followRef.current());
  }, []);

  useEffect(() => {
    if (!dirtyState) return;
    // Its own handler: removing it must never remove the app-lifetime stash guard (same function = same listener).
    const guard = (e: BeforeUnloadEvent) => blockUnload(e);
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirtyState]);

  const edit = (next: Draft) => {
    setDraft(next);
    setDirty(true);
    if (saveRef.current !== "conflict") setSave("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flushRef.current(), SAVE_DELAY_MS);
  };
  const patch = (p: Partial<Draft>) => edit({ ...draftRef.current, ...p });

  const restoreStash = () => {
    const st = stashShown.current;
    if (!st) return;
    showStash(undefined);
    dropUnsaved();
    base.current = st.base;
    setSave("idle");
    edit(st.fields);
  };
  const discardStash = () => {
    showStash(undefined);
    dropUnsaved();
  };
  const reload = () => adopt(current());

  /* ---------- derived ---------- */

  const featured = draft.featuredPlatforms;
  const metrics = useMemo(
    () => kitMetrics(analytics, new Date(), featured.length ? featured : undefined),
    [analytics, featured],
  );
  const kitNow = useMemo(() => ({ ...(stored ?? emptyKit()), ...draft }), [stored, draft]);
  const issues = useMemo(() => kitIssues(kitNow), [kitNow]);
  const projection = useMemo(
    () =>
      kitProjection(
        {
          businessKit: kitNow,
          socialSnapshots: analytics.snapshots,
          socialPostStats: analytics.postStats,
          socialAccounts: analytics.accounts,
        },
        new Date(),
      ),
    [kitNow, analytics],
  );
  const unsaved =
    dirtyState || ["notPersisted", "unsupported", "conflict", "invalid"].includes(save);

  const withFollowers = metrics.filter((m) => m.followers.source === "snapshot");
  const estFor = withFollowers.find((m) => m.platform === estPlatform) ?? withFollowers[0] ?? null;
  const explain = estFor
    ? estimateExplain(
        draft.estimator,
        estFor.followers.source === "snapshot" ? estFor.followers.value : null,
        estFor.engagement.source === "none" ? null : estFor.engagement.value,
        estDeliverable,
      )
    : null;

  const exportJson = () => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(projection, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = kitFileName(new Date(), unsaved);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  /* ---------- render helpers ---------- */

  const label = (key: MessageKey, vars?: Record<string, string | number>) => (
    <span className="text-ink-2 text-[13px] font-semibold">{t(key, vars)}</span>
  );
  const section = (title: MessageKey, children: ReactNode, testId?: string) => (
    <section className="ios-card flex min-w-0 flex-col gap-2 p-4" data-testid={testId}>
      <h2 className="text-[15px] font-semibold">{t(title)}</h2>
      {children}
    </section>
  );
  const pair = (
    value: Bi,
    onChange: (v: Bi) => void,
    testId: string,
    max: number,
    multiline = false,
  ) => (
    <div className="grid gap-2 sm:grid-cols-2">
      {(["ar", "en"] as const).map((l) => (
        <label key={l} className="flex min-w-0 flex-col gap-1">
          {label(l === "ar" ? "business.field.ar" : "business.field.en")}
          {multiline ? (
            <textarea
              className="px-input min-h-24"
              dir={l === "ar" ? "rtl" : "ltr"}
              maxLength={max}
              value={value[l]}
              onChange={(e) => onChange({ ...value, [l]: e.target.value })}
              data-testid={`${testId}-${l}`}
            />
          ) : (
            <input
              className="px-input"
              dir={l === "ar" ? "rtl" : "ltr"}
              maxLength={max}
              value={value[l]}
              onChange={(e) => onChange({ ...value, [l]: e.target.value })}
              data-testid={`${testId}-${l}`}
            />
          )}
        </label>
      ))}
    </div>
  );
  const platformSelect = (
    value: Platform | undefined,
    onChange: (p: Platform | undefined) => void,
    testId: string,
  ) => (
    <label className="flex min-w-0 flex-col gap-1">
      {label("business.field.platform")}
      <select
        className="px-input"
        value={value ?? ""}
        onChange={(e) => onChange((e.target.value || undefined) as Platform | undefined)}
        data-testid={testId}
      >
        <option value="">{t("business.field.platformAny")}</option>
        {PLATFORMS.map((p) => (
          <option key={p} value={p}>
            {PLATFORM_META[p].name[lang]}
          </option>
        ))}
      </select>
    </label>
  );
  const removeButton = (onClick: () => void, testId: string) => (
    <button
      type="button"
      className="px-btn px-btn-ghost px-btn-sm text-danger self-start"
      onClick={onClick}
      data-testid={testId}
    >
      <Trash2 size={14} strokeWidth={1.75} aria-hidden />
      {t("business.remove")}
    </button>
  );
  const addButton = (key: MessageKey, onClick: () => void, testId: string, disabled: boolean) => (
    <button
      type="button"
      className="px-btn px-btn-ghost px-btn-sm self-start"
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
    >
      <Plus size={14} strokeWidth={1.75} aria-hidden />
      {t(key)}
    </button>
  );
  const list = <T,>(items: T[], i: number, next: T | null): T[] =>
    next === null ? items.filter((_, n) => n !== i) : items.map((x, n) => (n === i ? next : x));

  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="kit-editor">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="text-muted ms-auto text-xs"
          aria-live="polite"
          data-testid="business-save-status"
          data-state={save}
        >
          {save === "saving" && t("business.save.saving")}
          {save === "saved" && t("business.save.saved", { time: savedAt })}
        </span>
      </div>

      {(save === "notPersisted" || save === "unsupported" || save === "invalid") && (
        <p role="alert" className="text-danger text-[13px]" data-testid="business-save-error">
          {t(`business.save.${save}`)}
        </p>
      )}
      {stash && (
        <div
          role="alert"
          className="bg-warn-bg flex flex-col gap-2 rounded-xl p-3 text-[13px]"
          data-testid="business-unsaved-prompt"
        >
          <p>{t("business.unsavedPrompt")}</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="px-btn px-btn-sm"
              onClick={restoreStash}
              data-testid="business-unsaved-restore"
            >
              {t("business.unsavedRestore")}
            </button>
            <button
              type="button"
              className="px-btn px-btn-ghost px-btn-sm"
              onClick={discardStash}
              data-testid="business-unsaved-discard"
            >
              {t("business.unsavedDiscard")}
            </button>
          </div>
        </div>
      )}
      {save === "conflict" && (
        <div
          role="alert"
          className="bg-warn-bg flex flex-col gap-2 rounded-xl p-3 text-[13px]"
          data-testid="business-conflict"
        >
          <p>{t("business.save.conflict")}</p>
          <button
            type="button"
            className="px-btn px-btn-sm self-start"
            onClick={reload}
            data-testid="business-reload"
          >
            {t("business.save.reload")}
          </button>
        </div>
      )}

      {section(
        "business.metrics.title",
        <>
          <p className="text-ink-2 text-[13px]">{t("business.metrics.hint")}</p>
          {metrics.length === 0 && (
            <p className="text-[14px]" data-testid="business-metrics-empty">
              {t("business.metrics.empty")}
            </p>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            {metrics.map((m) => (
              <div
                key={m.platform}
                className="bg-fill flex min-w-0 flex-col gap-1.5 rounded-xl p-3"
                data-testid={`business-metric-${m.platform}`}
                data-stale={m.stale}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <PlatformBadge platform={m.platform} size={22} />
                  <b className="text-[15px]">{PLATFORM_META[m.platform].name[lang]}</b>
                  {m.handle && (
                    <span className="text-ink-2 text-[13px]" dir="ltr">
                      @{m.handle}
                    </span>
                  )}
                  {m.stale && <Chip tone="warn">{t("business.metric.stale")}</Chip>}
                </div>
                <ul className="flex flex-col gap-1">
                  {METRIC_ROWS.map((row) => (
                    <li key={row} className="flex flex-wrap items-baseline gap-x-2 text-[14px]">
                      <span className="text-ink-2">{t(`business.metric.${row}`)}</span>
                      <b dir="ltr">{metricText(row, m[row])}</b>
                      <Chip className="max-w-full text-[12px]" data-source={m[row].source}>
                        {provenance(lang, m[row])}
                      </Chip>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <Link
            href="/social/growth"
            className="px-link self-start text-[14px]"
            data-testid="business-growth-link"
          >
            {t("business.metrics.add")}
          </Link>
          <div className="flex flex-col gap-1.5">
            {label("business.featured.title")}
            <div className="flex flex-wrap gap-1.5">
              {PLATFORMS.map((p) => {
                const on = featured.includes(p);
                return (
                  <button
                    key={p}
                    type="button"
                    aria-pressed={on}
                    className={`px-btn px-btn-sm ${on ? "" : "px-btn-ghost"}`}
                    onClick={() =>
                      patch({
                        featuredPlatforms: on
                          ? featured.filter((x) => x !== p)
                          : PLATFORMS.filter((x) => x === p || featured.includes(x)),
                      })
                    }
                    data-testid={`business-featured-${p}`}
                  >
                    {PLATFORM_META[p].name[lang]}
                  </button>
                );
              })}
            </div>
            <p className="text-ink-2 text-[12px]">{t("business.featured.hint")}</p>
          </div>
        </>,
        "business-metrics",
      )}

      {section(
        "business.section.tagline",
        pair(draft.tagline, (tagline) => patch({ tagline }), "business-tagline", 120),
      )}
      {section(
        "business.section.bio",
        pair(draft.bio, (bio) => patch({ bio }), "business-bio", 600, true),
      )}
      {section(
        "business.section.contact",
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="flex min-w-0 flex-col gap-1">
              {label("business.field.email")}
              <input
                className="px-input"
                type="email"
                dir="ltr"
                maxLength={120}
                value={draft.contact.email}
                onChange={(e) => patch({ contact: { ...draft.contact, email: e.target.value } })}
                data-testid="business-email"
              />
            </label>
            <label className="flex min-w-0 flex-col gap-1">
              {label("business.field.website")}
              <input
                className="px-input"
                type="url"
                dir="ltr"
                maxLength={200}
                value={draft.contact.website}
                onChange={(e) => patch({ contact: { ...draft.contact, website: e.target.value } })}
                data-testid="business-website"
              />
            </label>
          </div>
          {label("business.field.location")}
          {pair(
            draft.contact.location,
            (location) => patch({ contact: { ...draft.contact, location } }),
            "business-location",
            80,
          )}
        </>,
      )}

      {section(
        "business.section.services",
        <>
          {draft.services.map((s, i) => (
            <div
              key={s.id}
              className="border-hair flex flex-col gap-2 border-t pt-2"
              data-testid="business-service"
            >
              {label("business.field.name")}
              {pair(
                s.name,
                (name) => patch({ services: list(draft.services, i, { ...s, name }) }),
                "business-service-name",
                80,
              )}
              {label("business.field.desc")}
              {pair(
                s.desc,
                (desc) => patch({ services: list(draft.services, i, { ...s, desc }) }),
                "business-service-desc",
                240,
              )}
              {removeButton(
                () => patch({ services: list(draft.services, i, null) }),
                "business-service-remove",
              )}
            </div>
          ))}
          {addButton(
            "business.add.service",
            () =>
              patch({ services: [...draft.services, { id: rowId(), name: EMPTY, desc: EMPTY }] }),
            "business-service-add",
            draft.services.length >= 8,
          )}
        </>,
      )}

      {section(
        "business.section.rates",
        <>
          {draft.rateCard.map((r, i) => (
            <div
              key={r.id}
              className="border-hair flex flex-col gap-2 border-t pt-2"
              data-testid="business-rate"
            >
              {label("business.field.deliverable")}
              {pair(
                r.deliverable,
                (deliverable) =>
                  patch({ rateCard: list(draft.rateCard, i, { ...r, deliverable }) }),
                "business-rate-deliverable",
                80,
              )}
              <div className="grid gap-2 sm:grid-cols-2">
                {platformSelect(
                  r.platform,
                  (platform) => patch({ rateCard: list(draft.rateCard, i, { ...r, platform }) }),
                  "business-rate-platform",
                )}
                <label className="flex min-w-0 flex-col gap-1">
                  {label("business.field.price")}
                  <input
                    className="px-input"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    dir="ltr"
                    value={r.priceSar ?? ""}
                    placeholder={t("business.field.priceHint")}
                    onChange={(e) =>
                      patch({
                        rateCard: list(draft.rateCard, i, {
                          ...r,
                          priceSar: e.target.value === "" ? null : Math.round(num(e.target.value)),
                        }),
                      })
                    }
                    data-testid="business-rate-price"
                  />
                </label>
              </div>
              {label("business.field.note")}
              {pair(
                r.note,
                (note) => patch({ rateCard: list(draft.rateCard, i, { ...r, note }) }),
                "business-rate-note",
                160,
              )}
              {removeButton(
                () => patch({ rateCard: list(draft.rateCard, i, null) }),
                "business-rate-remove",
              )}
            </div>
          ))}
          {addButton(
            "business.add.rate",
            () =>
              patch({
                rateCard: [
                  ...draft.rateCard,
                  { id: rowId(), deliverable: EMPTY, priceSar: null, note: EMPTY },
                ],
              }),
            "business-rate-add",
            draft.rateCard.length >= 12,
          )}
        </>,
      )}

      {section(
        "business.section.work",
        <>
          {draft.pastWork.map((w, i) => (
            <div
              key={w.id}
              className="border-hair flex flex-col gap-2 border-t pt-2"
              data-testid="business-work"
            >
              {label("business.field.title")}
              {pair(
                w.title,
                (title) => patch({ pastWork: list(draft.pastWork, i, { ...w, title }) }),
                "business-work-title",
                120,
              )}
              <div className="grid gap-2 sm:grid-cols-3">
                <label className="flex min-w-0 flex-col gap-1">
                  {label("business.field.url")}
                  <input
                    className="px-input"
                    type="url"
                    dir="ltr"
                    maxLength={300}
                    value={w.url}
                    onChange={(e) =>
                      patch({ pastWork: list(draft.pastWork, i, { ...w, url: e.target.value }) })
                    }
                    data-testid="business-work-url"
                  />
                </label>
                {platformSelect(
                  w.platform,
                  (platform) => patch({ pastWork: list(draft.pastWork, i, { ...w, platform }) }),
                  "business-work-platform",
                )}
                <label className="flex min-w-0 flex-col gap-1">
                  {label("business.field.day")}
                  <input
                    className="px-input"
                    type="date"
                    dir="ltr"
                    value={w.day ?? ""}
                    onChange={(e) =>
                      patch({
                        pastWork: list(draft.pastWork, i, {
                          ...w,
                          day: e.target.value || undefined,
                        }),
                      })
                    }
                    data-testid="business-work-day"
                  />
                </label>
              </div>
              {removeButton(
                () => patch({ pastWork: list(draft.pastWork, i, null) }),
                "business-work-remove",
              )}
            </div>
          ))}
          {addButton(
            "business.add.work",
            () => patch({ pastWork: [...draft.pastWork, { id: rowId(), title: EMPTY, url: "" }] }),
            "business-work-add",
            draft.pastWork.length >= 12,
          )}
        </>,
      )}

      {issues.length > 0 && (
        <section
          className="bg-warn-bg flex flex-col gap-1 rounded-xl p-3 text-[13px]"
          data-testid="business-issues"
        >
          <b>{t("business.issues.title")}</b>
          <ul className="flex list-disc flex-col gap-0.5 ps-5">
            {issues.map((iss, n) => (
              <li key={n}>{t(`business.issue.${iss.code}`, { n: (iss.index ?? 0) + 1 })}</li>
            ))}
          </ul>
        </section>
      )}

      {section(
        "business.estimate.title",
        <>
          <p className="text-ink-2 text-[13px] font-semibold">{t("business.estimate.note")}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="flex min-w-0 flex-col gap-1">
              {label("business.estimate.perK")}
              <input
                className="px-input"
                type="number"
                min={0}
                dir="ltr"
                value={draft.estimator.sarPerThousandFollowers}
                onChange={(e) =>
                  patch({
                    estimator: { ...draft.estimator, sarPerThousandFollowers: num(e.target.value) },
                  })
                }
                data-testid="business-est-perk"
              />
            </label>
            <label className="flex min-w-0 flex-col gap-1">
              {label("business.estimate.mult")}
              <input
                className="px-input"
                type="number"
                min={0}
                step={0.1}
                dir="ltr"
                value={draft.estimator.engagementMultiplier}
                onChange={(e) =>
                  patch({
                    estimator: { ...draft.estimator, engagementMultiplier: num(e.target.value) },
                  })
                }
                data-testid="business-est-mult"
              />
            </label>
            {KIT_DELIVERABLES.map((d) => (
              <label key={d} className="flex min-w-0 flex-col gap-1">
                {label("business.estimate.weight", { deliverable: t(`business.deliverable.${d}`) })}
                <input
                  className="px-input"
                  type="number"
                  min={0}
                  step={0.1}
                  dir="ltr"
                  value={draft.estimator.deliverable[d]}
                  onChange={(e) =>
                    patch({
                      estimator: {
                        ...draft.estimator,
                        deliverable: { ...draft.estimator.deliverable, [d]: num(e.target.value) },
                      },
                    })
                  }
                  data-testid={`business-est-w-${d}`}
                />
              </label>
            ))}
            <label className="flex min-w-0 flex-col gap-1">
              {label("business.estimate.platform")}
              <select
                className="px-input"
                value={estFor?.platform ?? ""}
                onChange={(e) => setEstPlatform(e.target.value as Platform)}
                data-testid="business-est-platform"
              >
                {withFollowers.map((m) => (
                  <option key={m.platform} value={m.platform}>
                    {PLATFORM_META[m.platform].name[lang]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex min-w-0 flex-col gap-1">
              {label("business.estimate.deliverable")}
              <select
                className="px-input"
                value={estDeliverable}
                onChange={(e) =>
                  setEstDeliverable(e.target.value as (typeof KIT_DELIVERABLES)[number])
                }
                data-testid="business-est-deliverable"
              >
                {KIT_DELIVERABLES.map((d) => (
                  <option key={d} value={d}>
                    {t(`business.deliverable.${d}`)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {explain ? (
            <>
              <p className="text-[20px] font-bold" data-testid="business-est-result">
                {t("business.estimate.result", { sar: explain.sar })}
              </p>
              <p className="text-ink-2 text-[13px]" data-testid="business-est-explain">
                {t("business.estimate.explain", {
                  followers: explain.followers,
                  perK: explain.perThousand,
                  factor: Math.round(explain.engagementFactor * 1000) / 1000,
                  weight: explain.weight,
                  raw: explain.raw,
                  sar: explain.sar,
                })}
              </p>
            </>
          ) : (
            <p className="text-ink-2 text-[13px]" data-testid="business-est-none">
              {t("business.estimate.none")}
            </p>
          )}
        </>,
        "business-estimator",
      )}

      {unsaved && (
        <p
          role="status"
          className="bg-warn-bg rounded-xl p-3 text-[13px]"
          data-testid="business-unsaved-export"
        >
          {t("business.export.unsaved")}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="px-btn px-btn-ghost"
          aria-pressed={showPreview}
          onClick={() => setShowPreview((v) => !v)}
          data-testid="business-preview"
        >
          {showPreview ? (
            <EyeOff size={16} strokeWidth={1.75} aria-hidden />
          ) : (
            <Eye size={16} strokeWidth={1.75} aria-hidden />
          )}
          {t(showPreview ? "business.previewHide" : "business.preview")}
        </button>
        <button
          type="button"
          className="px-btn px-btn-ghost"
          onClick={() => window.print()}
          data-testid="business-print"
        >
          <Printer size={16} strokeWidth={1.75} aria-hidden />
          {t("business.print")}
        </button>
        <button type="button" className="px-btn" onClick={exportJson} data-testid="business-export">
          <Download size={16} strokeWidth={1.75} aria-hidden />
          {t("business.export")}
        </button>
      </div>
      <KitPreview projection={projection} unsaved={unsaved} open={showPreview} />
    </div>
  );
}
