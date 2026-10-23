"use client";

import { ArrowDown, ArrowUp, ChevronLeft, Eye, Play, RotateCcw, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { create } from "zustand";
import { postHash } from "@/components/social/calendar/dates";
import Chip from "@/components/ui/ios/Chip";
import Segmented from "@/components/ui/ios/Segmented";
import Switch from "@/components/ui/ios/Switch";
import { getSkill, skills } from "@/data";
import { cloudHub } from "@/lib/cloudWorkflowHub";
import {
  PLATFORMS,
  QUEST_TYPES,
  type Lang,
  type Workflow,
  type WorkflowAction,
  type WorkflowInput,
  type WorkflowRun,
} from "@/lib/domain";
import { translate, useT, type MessageKey } from "@/lib/i18n";
import { PLATFORM_META } from "@/lib/social";
import { weekKey } from "@/lib/streak";
import {
  WORKFLOW_PLACEHOLDERS,
  articleInput,
  manualInput,
  newAction,
  previewRun,
  workflowIssues,
  type PreviewStep,
  type WorkflowIssue,
} from "@/lib/workflows";
import {
  articlesGeneration,
  useStore,
  workflowBase,
  workflowDrain,
  type ManualCaptureResult,
  type WorkflowBase,
  type WorkflowResult,
  type WorkflowRunResult,
} from "@/store";
import { WorkflowCloudCard } from "./WorkflowCloud";

const SAVE_DELAY_MS = 400;
const MAX_ACTIONS = 5;
const MINUTES = [5, 10, 15, 20, 30, 45, 60, 90, 120];
const OFFSETS = Array.from({ length: 31 }, (_, n) => n);
const KNOWN_ERRORS = new Set([
  "empty-text",
  "no-skill",
  "unknown-skill",
  "invalid",
  "action-duplicate-id",
]);

type SaveState = "idle" | "saving" | "saved" | "notPersisted" | "conflict" | "unsupported";
type Draft = Pick<Workflow, "name" | "trigger" | "actions">;
const toDraft = (w: Workflow): Draft => ({ name: w.name, trigger: w.trigger, actions: w.actions });
const sameDraft = (a: Draft, b: Draft) => JSON.stringify(a) === JSON.stringify(b);

/** An action id no other step of this workflow uses (output ids are wf:<runId>:<actionId>). */
function freshActionId(taken: readonly WorkflowAction[]): string {
  const used = new Set(taken.map((a) => a.id));
  for (;;) {
    const id = `a${Math.random().toString(36).slice(2, 8)}`;
    if (!used.has(id)) return id;
  }
}

const nowTime = (lang: Lang) =>
  new Date().toLocaleTimeString(lang === "ar" ? "ar-SA-u-nu-latn" : "en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
const when = (iso: string, lang: Lang) =>
  new Date(iso).toLocaleString(lang === "ar" ? "ar-SA-u-nu-latn" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });

/** A workflow draft that could not be saved when its editor closed (Amendment D, same discipline as the CMS). */
export interface UnsavedWorkflowDraft {
  fields: Draft;
  base: WorkflowBase;
  reason: string;
  at: string;
  /** Increases with every stash: a pending save clears the stash only while it still holds its own token. */
  token: number;
}

/** Unsaved workflow drafts by workflow id; not persisted (the beforeunload guard covers closing the page). */
export const unsavedWorkflowDrafts = create<{ drafts: Record<string, UnsavedWorkflowDraft> }>(
  () => ({ drafts: {} }),
);
let lastToken = 0;

const dropUnsaved = (id: string, token?: number) =>
  unsavedWorkflowDrafts.setState((st) => {
    if (token !== undefined && st.drafts[id]?.token !== token) return st;
    const drafts = { ...st.drafts };
    delete drafts[id];
    return { drafts };
  });

const blockUnload = (e: BeforeUnloadEvent) => {
  e.preventDefault();
  e.returnValue = "";
};

// App-lifetime guard: while any workflow draft is stashed, closing or reloading the page asks first.
unsavedWorkflowDrafts.subscribe(({ drafts }) => {
  window[Object.keys(drafts).length ? "addEventListener" : "removeEventListener"](
    "beforeunload",
    blockUnload,
  );
});

/** Where a step's output lives in the app. */
function outputHref(kind: "idea" | "post" | "plan", id: string, week: string): string {
  if (kind === "idea") return "/social/ideas/";
  if (kind === "post") return `/social/calendar/${postHash(id)}`;
  return `/planner/#week=${week}`; // the run's own week (Amendment E)
}

/**
 * One workflow (packet DT-4): name, trigger, 1–5 ordered steps, pause, a pure Preview, Run now, and the run history
 * with output links and Retry. Autosave like the CMS editor: "Saved ✓" only after the store read the new commit back;
 * pending edits are saved before any action and the action stops when that fails; another tab's change never
 * overwrites what is on screen (conflict). Nothing here posts, replies, calls a provider or touches XP.
 */
export default function WorkflowEditor({ id, onBack }: { id: string; onBack: () => void }) {
  const { t, lang } = useT();
  const stored = useStore((s) => s.workflows.find((w) => w.id === id));
  const allRuns = useStore((s) => s.workflowRuns);
  const articles = useStore((s) => s.articles);
  const completions = useStore((s) => s.completions);
  const planItems = useStore((s) => s.planItems);
  const settings = useStore((s) => s.settings);

  const [draft, setDraftState] = useState<Draft>(() =>
    stored
      ? toDraft(stored)
      : { name: { ar: "", en: "" }, trigger: { kind: "manual" }, actions: [] },
  );
  const [save, setSaveState] = useState<SaveState>("idle");
  const [savedAt, setSavedAt] = useState("");
  const [busy, setBusyState] = useState(false);
  const [dirtyState, setDirtyState] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [runError, setRunError] = useState<MessageKey | null>(null);
  const [stash, setStash] = useState<UnsavedWorkflowDraft | undefined>(
    () => unsavedWorkflowDrafts.getState().drafts[id],
  );
  const [pickedArticle, setPickedArticle] = useState<string | null>(null);
  /** ⚙️ DT-7C-3B: the journal key of the cloud run the last Run now captured (its row offers Send). */
  const [captured, setCaptured] = useState<string | null>(null);
  const drainStopped = workflowDrain((st) => st.stopped);

  const draftRef = useRef(draft);
  const dirty = useRef(false);
  const saveRef = useRef<SaveState>("idle");
  const base = useRef<WorkflowBase>(
    stored ? workflowBase(stored) : { commitId: "", generation: -1 },
  );
  const chain = useRef<Promise<boolean>>(Promise.resolve(true));
  const committing = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const busyRef = useRef(false);
  const stashShown = useRef(stash);

  const showStash = (st: UnsavedWorkflowDraft | undefined) => {
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
  const setBusy = (v: boolean) => {
    busyRef.current = v;
    setBusyState(v);
  };
  const setSave = (s: SaveState) => {
    saveRef.current = s;
    setSaveState(s);
    if (s === "saved") setSavedAt(nowTime(useStore.getState().settings.lang));
  };
  const current = () => useStore.getState().workflows.find((w) => w.id === id);
  const adopt = (w: Workflow) => {
    base.current = workflowBase(w);
    setDirty(false);
    setDraft(toDraft(w));
    setSave("idle");
  };

  /** Compare the stored workflow with what the editor is based on (runs on every store change). */
  const check = () => {
    if (committing.current) return;
    const w = current();
    if (!w) return;
    const b = base.current;
    if (w.commitId === b.commitId && b.generation === articlesGeneration()) return;
    if (sameDraft(toDraft(w), draftRef.current)) adopt(w);
    else if (dirty.current || saveRef.current === "conflict") setSave("conflict");
    else adopt(w);
  };

  /** Apply a workflow commit result: re-base on success, keep the edits and say why on failure. */
  const settle = (r: WorkflowResult, sent?: Draft): boolean => {
    if (r.ok) {
      base.current = workflowBase(r.workflow);
      if (!sent || draftRef.current === sent) setDirty(false);
      setSave("saved");
      return true;
    }
    if (r.reason === "unsupported-save") setSave("unsupported");
    else if (r.reason === "not-persisted") setSave("notPersisted");
    else setSave("conflict");
    return false;
  };

  /** Run one store commit with this editor's subscriber paused. */
  const commit = async <R,>(run: () => Promise<R>, failed: R): Promise<R> => {
    committing.current += 1;
    try {
      return await run();
    } catch {
      return failed;
    } finally {
      committing.current -= 1;
    }
  };

  const saveNow = async (): Promise<boolean> => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (saveRef.current === "conflict") return false;
    if (!dirty.current) return true;
    const sent = draftRef.current;
    const r = await commit<WorkflowResult>(
      () => useStore.getState().updateWorkflow(id, sent, base.current),
      { ok: false, reason: "not-persisted" },
    );
    const ok = settle(r, sent);
    check();
    return ok;
  };
  /** Save pending edits, one save at a time (each starts from the previous one's commit). */
  const flush = (): Promise<boolean> => (chain.current = chain.current.then(saveNow, saveNow));

  /** Keep what is not saved yet for this session; the list marks it and reopening offers it back. */
  const stashNow = (token = ++lastToken) => {
    unsavedWorkflowDrafts.setState((st) => ({
      drafts: {
        ...st.drafts,
        [id]: {
          fields: draftRef.current,
          base: base.current,
          reason: saveRef.current,
          at: new Date().toISOString(),
          token,
        },
      },
    }));
    return token;
  };
  /**
   * The editor closes (sidebar, Quick Actions, hash back): stash unsaved edits now, so reopening offers them at once,
   * then save them. Only that save's own stash is cleared (saved) or refreshed (failed); a newer stash stays.
   */
  const close = () => {
    if (!dirty.current) return;
    const token = stashNow();
    void flush().then((ok) => {
      if (unsavedWorkflowDrafts.getState().drafts[id]?.token !== token) return;
      if (ok && !dirty.current) dropUnsaved(id, token);
      else stashNow(token);
    });
  };
  /** A reopened editor follows its stash: once the closed editor's save landed (stash cleared), show the stored one. */
  const follow = () => {
    const shown = stashShown.current;
    const st = unsavedWorkflowDrafts.getState().drafts[id];
    if (!shown || st === shown) return;
    showStash(st);
    const w = current();
    if (!st && !dirty.current && w) adopt(w);
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
    return unsavedWorkflowDrafts.subscribe(() => followRef.current());
  }, []);

  useEffect(() => {
    if (!dirtyState) return;
    const guard = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirtyState]);

  const edit = (next: Draft) => {
    if (busyRef.current) return;
    setDraft(next);
    setDirty(true);
    setRunError(null);
    if (saveRef.current !== "conflict") setSave("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flushRef.current(), SAVE_DELAY_MS);
  };
  const setActions = (actions: WorkflowAction[]) => edit({ ...draftRef.current, actions });
  const setName = (name: Draft["name"]) => edit({ ...draftRef.current, name });
  const setTrigger = (kind: Workflow["trigger"]["kind"]) =>
    edit({ ...draftRef.current, trigger: { kind } });
  const removeAction = (i: number) =>
    setActions(draftRef.current.actions.filter((_, n) => n !== i));
  const patchAction = (i: number, patch: Partial<WorkflowAction>) =>
    setActions(
      draftRef.current.actions.map((a, n) =>
        n === i ? ({ ...a, ...patch } as WorkflowAction) : a,
      ),
    );
  const move = (i: number, by: -1 | 1) => {
    const list = [...draftRef.current.actions];
    [list[i], list[i + by]] = [list[i + by], list[i]];
    setActions(list);
  };
  const add = (kind: WorkflowAction["kind"]) => {
    const list = draftRef.current.actions;
    if (list.length >= MAX_ACTIONS) return;
    setActions([...list, newAction(kind, freshActionId(list))]);
  };

  /** Save pending edits first; run the action only when that worked. */
  const act = async (run: () => Promise<void>) => {
    if (busyRef.current) return;
    setBusy(true);
    try {
      if (!(await flush())) return;
      await run();
      check();
    } finally {
      setBusy(false);
    }
  };

  const setEnabled = (enabled: boolean) =>
    act(async () => {
      settle(
        await commit<WorkflowResult>(() => useStore.getState().setWorkflowEnabled(id, enabled), {
          ok: false,
          reason: "not-persisted",
        }),
      );
    });

  const afterRun = (r: WorkflowRunResult) => {
    if (r.ok) {
      setRunError(null);
      void useStore.getState().drainWorkflowRuns();
    } else if (r.reason === "unsupported-save") setRunError("workflows.save.unsupported");
    else if (r.reason === "not-persisted") setRunError("workflows.save.notPersisted");
    else setRunError(`workflows.runError.${r.reason}`);
  };
  /**
   * ⚙️ DT-7C-3B: a workflow on the configured Worker captures one cloud run (a journal entry, sent only by its Send
   * button); every other workflow runs here exactly as before.
   */
  const runNow = () =>
    act(async () => {
      const authority = cloudHub().captureAuthority(id);
      if (!authority)
        return afterRun(
          await useStore
            .getState()
            .runWorkflowNow(id, runArticle ? { articleId: runArticle.id } : {})
            .catch(fail),
        );
      const r = await useStore
        .getState()
        .captureManualRun(id, { authority, ...(runArticle ? { articleId: runArticle.id } : {}) })
        .catch((): ManualCaptureResult => ({ kind: "refused", reason: "not-persisted" }));
      setCaptured(r.kind === "cloud" ? r.entry.key : null);
      if (r.kind === "refused") return setRunError(`workflows.cloud.capture.${r.reason}`);
      setRunError(null);
      if (r.kind === "local") void useStore.getState().drainWorkflowRuns();
    });
  const resume = () => void useStore.getState().drainWorkflowRuns();

  const restoreStash = () => {
    const st = stashShown.current;
    if (!st) return;
    showStash(undefined);
    dropUnsaved(id);
    base.current = st.base;
    setSave("idle");
    edit(st.fields);
  };
  const discardStash = () => {
    showStash(undefined);
    dropUnsaved(id);
  };
  const retry = (runId: string) =>
    act(async () => afterRun(await useStore.getState().retryWorkflowRun(runId).catch(fail)));

  const reload = () => {
    const w = current();
    if (w) adopt(w);
  };

  const back = async () => {
    if (!stored || (await flush())) onBack();
  };

  const enabled = stored?.enabled ?? false;
  const issues = useMemo(() => workflowIssues(draft), [draft]);
  const runs = useMemo(
    () =>
      allRuns
        .filter((r) => r.workflowId === id)
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
    [allRuns, id],
  );

  const articleReady = draft.trigger.kind === "article-ready";
  /** Articles Run now may use for an article-ready workflow: not archived, ready ones first, newest first. */
  const runnable = useMemo(
    () =>
      articles
        .filter((a) => a.status !== "archived")
        .sort(
          (a, b) =>
            Number(b.status === "ready") - Number(a.status === "ready") ||
            b.updatedAt.localeCompare(a.updatedAt),
        ),
    [articles],
  );
  const runArticle = articleReady
    ? (runnable.find((a) => a.id === pickedArticle) ?? runnable[0])
    : undefined;
  const needsArticle = articleReady && !runArticle;

  /** The input a run would capture now: the chosen article (or a sample) for the Ready trigger. */
  const sample = ((): { input: WorkflowInput; label: string } => {
    const now = new Date();
    if (draft.trigger.kind === "manual") return { input: manualInput(lang, now), label: "" };
    const ready = runArticle;
    if (ready)
      return {
        input: articleInput(ready, lang, now),
        label: t("workflows.previewSample", {
          title: ready.title[lang] || ready.title.ar || ready.title.en,
        }),
      };
    const title = {
      ar: translate("ar", "workflows.previewSampleTitle"),
      en: translate("en", "workflows.previewSampleTitle"),
    };
    return {
      input: {
        title,
        summary: title,
        slug: "sample-article",
        lang,
        day: articleInput({ id: "", title, summary: title, slug: "" }, lang, now).day,
      },
      label: t("workflows.previewSampleNone"),
    };
  })();

  // Pure and cheap: recomputed each render while the preview is open (the React Compiler memoizes).
  const preview =
    showPreview && stored
      ? previewRun({ ...stored, ...draft }, sample.input, { completions, planItems, settings })
      : null;

  const errorText = (e: string) =>
    KNOWN_ERRORS.has(e)
      ? t(`workflows.error.${e}` as MessageKey)
      : t("workflows.error.other", { error: e });
  const issueText = (i: WorkflowIssue) => {
    const text = t(`workflows.issue.${i.code}`);
    const n = i.actionId ? draft.actions.findIndex((a) => a.id === i.actionId) + 1 : 0;
    return n > 0 ? t("workflows.issueStep", { n, issue: text }) : text;
  };
  const dayName = (d: number) => t(`planner.day.${d}` as MessageKey);
  const skillName = (sid?: string) => {
    const s = sid ? getSkill(sid) : undefined;
    return s ? s.name[lang] || s.name.ar : (sid ?? "");
  };

  const previewText = (o: PreviewStep): string => {
    if (!o.ok) return "skipped" in o ? t("workflows.previewSkipped") : errorText(o.error);
    if (o.kind === "idea") return o.record.text;
    if (o.kind === "post")
      return [
        o.record.title,
        PLATFORM_META[o.record.platform].name[lang],
        o.record.plannedDay ?? "",
      ]
        .filter(Boolean)
        .join(" · ");
    return [
      skillName(o.record.skillId),
      t(`quest.${o.record.quest}` as MessageKey),
      `${o.record.minutes}′`,
      t("workflows.previewDay", { day: dayName(o.record.day) }),
    ].join(" · ");
  };

  if (!stored)
    return (
      <div className="flex flex-col gap-3" data-testid="workflow-editor">
        <p role="alert" className="text-danger text-[13px]" data-testid="workflows-gone">
          {t("workflows.gone")}
        </p>
        <button
          type="button"
          className="px-btn px-btn-ghost"
          onClick={onBack}
          data-testid="workflows-back"
        >
          {t("workflows.back")}
        </button>
      </div>
    );

  const label = (key: MessageKey, vars?: Record<string, string | number>) => (
    <span className="text-ink-2 text-[13px] font-semibold">{t(key, vars)}</span>
  );

  return (
    <article
      className="flex min-w-0 flex-col gap-4"
      data-testid="workflow-editor"
      data-id={id}
      aria-busy={busy}
    >
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void back()}
          className="px-btn px-btn-ghost px-btn-sm"
          data-testid="workflows-back"
        >
          <ChevronLeft size={16} strokeWidth={1.75} className="ltr:rotate-180" aria-hidden />
          {t("workflows.back")}
        </button>
        <Chip tone={enabled ? "tint" : "default"}>
          {t(enabled ? "workflows.enabled" : "workflows.paused")}
        </Chip>
        <span
          className="text-muted ms-auto text-xs"
          aria-live="polite"
          data-testid="workflows-save-status"
          data-state={save}
        >
          {save === "saving" && t("workflows.save.saving")}
          {save === "saved" && t("workflows.save.saved", { time: savedAt })}
        </span>
      </div>

      <p className="text-ink-2 text-[13px]" data-testid="workflows-local-only">
        {t("workflows.localOnly")}
      </p>

      {(save === "notPersisted" || save === "unsupported") && (
        <p role="alert" className="text-danger text-[13px]" data-testid="workflows-save-error">
          {t(save === "unsupported" ? "workflows.save.unsupported" : "workflows.save.notPersisted")}
        </p>
      )}
      {stash && (
        <div
          role="alert"
          className="bg-warn-bg flex flex-col gap-2 rounded-xl p-3 text-[13px]"
          data-testid="workflows-unsaved-prompt"
        >
          <p>{t("workflows.unsavedPrompt")}</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="px-btn px-btn-sm"
              onClick={restoreStash}
              data-testid="workflows-unsaved-restore"
            >
              {t("workflows.unsavedRestore")}
            </button>
            <button
              type="button"
              className="px-btn px-btn-ghost px-btn-sm"
              onClick={discardStash}
              data-testid="workflows-unsaved-discard"
            >
              {t("workflows.unsavedDiscard")}
            </button>
          </div>
        </div>
      )}
      {save === "conflict" && (
        <div
          role="alert"
          className="bg-warn-bg flex flex-col gap-2 rounded-xl p-3 text-[13px]"
          data-testid="workflows-conflict"
        >
          <p>{t("workflows.save.conflict")}</p>
          <button
            type="button"
            className="px-btn px-btn-sm self-start"
            onClick={reload}
            data-testid="workflows-reload"
          >
            {t("workflows.save.reload")}
          </button>
        </div>
      )}

      <TextPair
        value={draft.name}
        onChange={setName}
        keys={["workflows.nameAr", "workflows.nameEn"]}
        testId="workflows-name"
        busy={busy}
      />

      <div className="flex flex-col gap-2">
        {label("workflows.triggerLabel")}
        <Segmented
          label={t("workflows.triggerLabel")}
          value={draft.trigger.kind}
          onChange={setTrigger}
          options={(["manual", "article-ready"] as const).map((k) => ({
            value: k,
            label: t(`workflows.trigger.${k}`),
            testId: `workflows-trigger-${k}`,
          }))}
        />
        <p className="text-ink-2 text-[13px]" data-testid="workflows-trigger-help">
          {t(`workflows.triggerHelp.${draft.trigger.kind}`)}
        </p>
      </div>

      <label className="flex items-center justify-between gap-3">
        {label("workflows.enabledLabel")}
        <Switch
          checked={enabled}
          onChange={(v) => void setEnabled(v)}
          label={t("workflows.enabledLabel")}
          disabled={busy}
          testId="workflows-enabled"
        />
      </label>
      {!enabled && (
        <p className="bg-warn-bg rounded-xl p-3 text-[13px]" data-testid="workflows-paused-note">
          {t("workflows.pausedNote")}
        </p>
      )}

      <section
        className="flex flex-col gap-2"
        aria-label={t("workflows.actionsLabel", { count: draft.actions.length })}
      >
        {label("workflows.actionsLabel", { count: draft.actions.length })}
        <ol className="flex flex-col gap-2">
          {draft.actions.map((a, i) => (
            <li
              key={a.id}
              className="ios-card flex min-w-0 flex-col gap-2 p-3"
              data-testid="workflows-action"
              data-kind={a.kind}
            >
              <div className="flex flex-wrap items-center gap-2">
                <b className="text-[14px]">
                  {i + 1}. {t(`workflows.kind.${a.kind}`)}
                </b>
                <span className="ms-auto flex gap-1">
                  <button
                    type="button"
                    className="px-btn px-btn-ghost px-btn-sm"
                    aria-label={t("workflows.moveUp")}
                    disabled={i === 0 || busy}
                    onClick={() => move(i, -1)}
                    data-testid="workflows-action-up"
                  >
                    <ArrowUp size={16} strokeWidth={1.75} aria-hidden />
                  </button>
                  <button
                    type="button"
                    className="px-btn px-btn-ghost px-btn-sm"
                    aria-label={t("workflows.moveDown")}
                    disabled={i === draft.actions.length - 1 || busy}
                    onClick={() => move(i, 1)}
                    data-testid="workflows-action-down"
                  >
                    <ArrowDown size={16} strokeWidth={1.75} aria-hidden />
                  </button>
                  <button
                    type="button"
                    className="px-btn px-btn-ghost px-btn-sm"
                    aria-label={t("workflows.remove")}
                    disabled={busy}
                    onClick={() => removeAction(i)}
                    data-testid="workflows-action-remove"
                  >
                    <Trash2 size={16} strokeWidth={1.75} aria-hidden />
                  </button>
                </span>
              </div>
              {a.kind === "idea" && (
                <>
                  <TextPair
                    value={a.text}
                    onChange={(text) => patchAction(i, { text })}
                    keys={["workflows.field.textAr", "workflows.field.textEn"]}
                    testId="workflows-idea-text"
                    busy={busy}
                  />
                  <label className="flex flex-col gap-1">
                    {label("workflows.field.platform")}
                    <select
                      className="px-input"
                      value={a.platform ?? ""}
                      disabled={busy}
                      onChange={(e) =>
                        patchAction(i, {
                          platform: (e.target.value || undefined) as
                            (typeof PLATFORMS)[number] | undefined,
                        })
                      }
                    >
                      <option value="">{t("workflows.field.platformAny")}</option>
                      {PLATFORMS.map((p) => (
                        <option key={p} value={p}>
                          {PLATFORM_META[p].name[lang]}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}
              {a.kind === "post" && (
                <>
                  <TextPair
                    value={a.title}
                    onChange={(title) => patchAction(i, { title })}
                    keys={["workflows.field.titleAr", "workflows.field.titleEn"]}
                    testId="workflows-post-title"
                    busy={busy}
                  />
                  <TextPair
                    value={a.caption}
                    onChange={(caption) => patchAction(i, { caption })}
                    keys={["workflows.field.captionAr", "workflows.field.captionEn"]}
                    testId="workflows-post-caption"
                    busy={busy}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <label className="flex min-w-0 flex-col gap-1">
                      {label("workflows.field.platform")}
                      <select
                        className="px-input"
                        value={a.platform}
                        disabled={busy}
                        onChange={(e) =>
                          patchAction(i, { platform: e.target.value as (typeof PLATFORMS)[number] })
                        }
                      >
                        {PLATFORMS.map((p) => (
                          <option key={p} value={p}>
                            {PLATFORM_META[p].name[lang]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex min-w-0 flex-col gap-1">
                      {label("workflows.field.offset")}
                      <select
                        className="px-input"
                        value={a.offsetDays}
                        disabled={busy}
                        onChange={(e) => patchAction(i, { offsetDays: Number(e.target.value) })}
                      >
                        {OFFSETS.map((n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                </>
              )}
              {a.kind === "plan" && (
                <div className="grid grid-cols-2 gap-2">
                  <label className="col-span-2 flex min-w-0 flex-col gap-1">
                    {label("workflows.field.skill")}
                    <select
                      className="px-input"
                      value={a.skillId ?? ""}
                      disabled={busy}
                      onChange={(e) => patchAction(i, { skillId: e.target.value || undefined })}
                      data-testid="workflows-plan-skill"
                    >
                      <option value="">{t("workflows.field.skillArticle")}</option>
                      {skills.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name[lang] || s.name.ar}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex min-w-0 flex-col gap-1">
                    {label("workflows.field.quest")}
                    <select
                      className="px-input"
                      value={a.quest}
                      disabled={busy}
                      onChange={(e) =>
                        patchAction(i, { quest: e.target.value as (typeof QUEST_TYPES)[number] })
                      }
                    >
                      {QUEST_TYPES.map((q) => (
                        <option key={q} value={q}>
                          {t(`quest.${q}` as MessageKey)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex min-w-0 flex-col gap-1">
                    {label("workflows.field.minutes")}
                    <select
                      className="px-input"
                      value={a.minutes}
                      disabled={busy}
                      onChange={(e) => patchAction(i, { minutes: Number(e.target.value) })}
                    >
                      {(MINUTES.includes(a.minutes)
                        ? MINUTES
                        : [...MINUTES, a.minutes].sort((x, y) => x - y)
                      ).map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="col-span-2 flex min-w-0 flex-col gap-1">
                    {label("workflows.field.day")}
                    <select
                      className="px-input"
                      value={String(a.day)}
                      disabled={busy}
                      onChange={(e) =>
                        patchAction(i, {
                          day: e.target.value === "lightest" ? "lightest" : Number(e.target.value),
                        })
                      }
                    >
                      <option value="lightest">{t("workflows.field.dayLightest")}</option>
                      {[0, 1, 2, 3, 4, 5, 6].map((d) => (
                        <option key={d} value={d}>
                          {dayName(d)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              )}
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-ink-2 text-[13px]">{t("workflows.addLabel")}</span>
          {(["idea", "post", "plan"] as const).map((k) => (
            <button
              key={k}
              type="button"
              className="px-btn px-btn-ghost px-btn-sm"
              disabled={draft.actions.length >= MAX_ACTIONS || busy}
              onClick={() => add(k)}
              data-testid={`workflows-add-${k}`}
            >
              + {t(`workflows.add.${k}`)}
            </button>
          ))}
        </div>
        <p className="text-ink-2 flex flex-wrap items-center gap-1 text-[13px]">
          {t("workflows.placeholdersHelp")}
          {WORKFLOW_PLACEHOLDERS.map((p) => (
            <code key={p} dir="ltr" className="bg-fill rounded px-1">
              {`{${p}}`}
            </code>
          ))}
        </p>
      </section>

      {issues.length > 0 && (
        <div className="bg-warn-bg rounded-xl p-3 text-[13px]" data-testid="workflows-issues">
          <p className="font-semibold">{t("workflows.issuesTitle")}</p>
          <ul className="list-disc ps-5">
            {issues.map((i, n) => (
              <li key={n}>{issueText(i)}</li>
            ))}
          </ul>
        </div>
      )}

      {articleReady &&
        (needsArticle ? (
          <p
            className="bg-warn-bg rounded-xl p-3 text-[13px]"
            data-testid="workflows-needs-article"
          >
            {t("workflows.needsArticle")}
          </p>
        ) : (
          <label className="flex min-w-0 flex-col gap-1">
            {label("workflows.runArticle")}
            <select
              className="px-input"
              value={runArticle?.id ?? ""}
              disabled={busy}
              onChange={(e) => setPickedArticle(e.target.value)}
              data-testid="workflows-run-article"
            >
              {runnable.map((a) => (
                <option key={a.id} value={a.id}>
                  {(a.title[lang] || a.title.ar || a.title.en || t("workflows.untitled")) +
                    " · " +
                    t(`website.status.${a.status}`)}
                </option>
              ))}
            </select>
          </label>
        ))}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="px-btn px-btn-ghost"
          aria-pressed={showPreview}
          onClick={() => setShowPreview((v) => !v)}
          data-testid="workflows-preview"
        >
          <Eye size={18} strokeWidth={1.75} aria-hidden />
          {t("workflows.preview")}
        </button>
        <button
          type="button"
          className="px-btn flex-1"
          disabled={busy || !enabled || issues.length > 0 || needsArticle}
          onClick={() => void runNow()}
          data-testid="workflows-run"
        >
          <Play size={18} strokeWidth={1.75} aria-hidden />
          {t("workflows.run")}
        </button>
      </div>
      {runError && (
        <p role="alert" className="text-danger text-[13px]" data-testid="workflows-run-error">
          {t(runError)}
        </p>
      )}

      {preview && (
        <section className="ios-card flex flex-col gap-2 p-3" data-testid="workflows-preview-panel">
          <h2 className="text-[15px] font-semibold">{t("workflows.previewTitle")}</h2>
          {sample.label && <p className="text-ink-2 text-[13px]">{sample.label}</p>}
          <ol className="flex flex-col gap-1">
            {preview.outputs.map((o, n) => (
              <li
                key={n}
                className="min-w-0 text-[14px] break-words"
                data-testid="workflows-preview-item"
                data-kind={draft.actions[n]?.kind}
                data-state={o.ok ? "done" : "skipped" in o ? "skipped" : "failed"}
              >
                <b>{t(`workflows.kind.${draft.actions[n]?.kind ?? "idea"}`)}:</b> {previewText(o)}
              </li>
            ))}
          </ol>
          <p className="text-muted text-xs">{t("workflows.previewNote")}</p>
        </section>
      )}

      <section className="flex flex-col gap-2" data-testid="workflows-runs">
        <h2 className="ios-gh text-[13px]">{t("workflows.runs")}</h2>
        {runs.length === 0 ? (
          <p className="text-ink-2 text-[13px]">{t("workflows.runsEmpty")}</p>
        ) : (
          runs.map((r) => (
            <RunRow
              key={r.id}
              run={r}
              busy={busy}
              onRetry={() => void retry(r.id)}
              onResume={drainStopped ? resume : undefined}
              errorText={errorText}
            />
          ))
        )}
      </section>

      <WorkflowCloudCard id={id} locked={busy || dirtyState} captured={captured} />
    </article>
  );
}

const fail = (): WorkflowRunResult => ({ ok: false, reason: "not-persisted" });

/** Arabic and English fields side by side (each with its own direction). */
function TextPair({
  value,
  onChange,
  keys,
  testId,
  busy,
}: {
  value: { ar: string; en: string };
  onChange: (v: { ar: string; en: string }) => void;
  keys: [MessageKey, MessageKey];
  testId: string;
  busy: boolean;
}) {
  const { t } = useT();
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {(["ar", "en"] as const).map((l, n) => (
        <label key={l} className="flex min-w-0 flex-col gap-1">
          <span className="text-ink-2 text-[13px] font-semibold">{t(keys[n])}</span>
          <input
            className="px-input"
            dir={l === "ar" ? "rtl" : "ltr"}
            maxLength={500}
            value={value[l]}
            readOnly={busy}
            onChange={(e) => onChange({ ...value, [l]: e.target.value })}
            data-testid={`${testId}-${l}`}
          />
        </label>
      ))}
    </div>
  );
}

function RunRow({
  run,
  busy,
  onRetry,
  onResume,
  errorText,
}: {
  run: WorkflowRun;
  busy: boolean;
  onRetry: () => void;
  /** Set when the last drain stopped early (storage did not keep a step): continues the same attempt. */
  onResume?: () => void;
  errorText: (e: string) => string;
}) {
  const { t, lang } = useT();
  const kindOf = (actionId: string) =>
    run.snapshot.workflow.actions.find((a) => a.id === actionId)?.kind;
  return (
    <div
      className="ios-card flex min-w-0 flex-col gap-2 p-3"
      data-testid="workflows-run-row"
      data-status={run.status}
    >
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <Chip
          tone={
            run.status === "done"
              ? "tint"
              : run.status === "queued" || run.status === "running"
                ? "default"
                : "warn"
          }
        >
          {t(`workflows.status.${run.status}`)}
        </Chip>
        <span>{t(`workflows.runKind.${run.kind}`)}</span>
        {run.attempt > 1 && <span>· {t("workflows.attempt", { n: run.attempt })}</span>}
        <span className="text-muted ms-auto text-xs">{when(run.startedAt, lang)}</span>
      </div>
      <ol className="flex flex-col gap-1 text-[13px]">
        {run.steps.map((s, n) => {
          const kind = s.outputKind ?? kindOf(s.actionId);
          return (
            <li key={n} className="flex min-w-0 flex-wrap items-center gap-2">
              <span>
                {n + 1}. {kind ? t(`workflows.kind.${kind}`) : s.actionId}
              </span>
              <span className="text-ink-2">· {t(`workflows.step.${s.status}`)}</span>
              {s.error && <span className="text-danger break-words">· {errorText(s.error)}</span>}
              {s.status === "done" && s.outputKind && s.outputId && (
                <Link
                  href={outputHref(s.outputKind, s.outputId, weekKey(run.snapshot.input.day))}
                  className="text-tint ms-auto"
                  data-testid="workflows-output-link"
                  data-kind={s.outputKind}
                >
                  {t(`workflows.open.${s.outputKind}`)}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
      {(run.status === "partial" || run.status === "failed") && (
        <button
          type="button"
          className="px-btn px-btn-sm self-start"
          disabled={busy}
          onClick={onRetry}
          data-testid="workflows-retry"
        >
          <RotateCcw size={16} strokeWidth={1.75} aria-hidden />
          {t("workflows.retry")}
        </button>
      )}
      {onResume && (run.status === "queued" || run.status === "running") && (
        <div className="flex flex-col gap-1">
          <p className="text-danger text-[13px]">{t("workflows.resumeNote")}</p>
          <button
            type="button"
            className="px-btn px-btn-sm self-start"
            onClick={onResume}
            data-testid="workflows-resume"
          >
            <Play size={16} strokeWidth={1.75} aria-hidden />
            {t("workflows.resume")}
          </button>
        </div>
      )}
    </div>
  );
}
