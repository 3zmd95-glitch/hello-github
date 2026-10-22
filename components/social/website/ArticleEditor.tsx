"use client";

import { Archive, ArchiveRestore, ChevronLeft, Download, FileCheck, Undo2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { create } from "zustand";
import SkillPicker from "@/components/social/calendar/SkillPicker";
import { useSkillSheet } from "@/components/skills/SkillSheetProvider";
import Chip from "@/components/ui/ios/Chip";
import Segmented from "@/components/ui/ios/Segmented";
import { getSkill } from "@/data";
import {
  articleFileName,
  articleIssues,
  articleMarkdown,
  suggestSlug,
  type ArticleIssue,
} from "@/lib/articles";
import type { Article, Lang } from "@/lib/domain";
import { useT, type MessageKey } from "@/lib/i18n";
import {
  articleBase,
  articlesGeneration,
  useStore,
  type ArticleBase,
  type ArticlePatch,
  type ArticleResult,
} from "@/store";
import ArticleMarkdown from "./ArticleMarkdown";

const SAVE_DELAY_MS = 400;
const LANGS: readonly Lang[] = ["ar", "en"];

type SaveState = "idle" | "saving" | "saved" | "notPersisted" | "conflict" | "unsupported";
type Mode = "write" | "preview";

/** What the form holds: the article's editorial fields, tags as the typed comma text. */
export interface Draft {
  title: Article["title"];
  summary: Article["summary"];
  body: Article["body"];
  slug: string;
  category: string;
  tags: string;
  coverUrl: string;
  skillId?: string;
}

export const toDraft = (a: Article): Draft => ({
  title: a.title,
  summary: a.summary,
  body: a.body,
  slug: a.slug,
  category: a.category,
  tags: a.tags.join(", "),
  coverUrl: a.coverUrl,
  skillId: a.skillId,
});

const parseTags = (text: string) => [
  ...new Set(
    text
      .split(/[,،]/)
      .map((t) => t.trim().slice(0, 30))
      .filter(Boolean),
  ),
];

export const toPatch = (d: Draft): ArticlePatch => ({
  title: d.title,
  summary: d.summary,
  body: d.body,
  slug: d.slug.trim(),
  category: d.category,
  tags: parseTags(d.tags).slice(0, 12),
  coverUrl: d.coverUrl.trim(),
  skillId: d.skillId,
});

/** A draft that could not be saved when its editor closed (conflict, failed save): kept for this app session. */
export interface UnsavedDraft {
  fields: Draft;
  base: ArticleBase;
  reason: string;
  at: string;
  /** Increases with every stash: a pending save clears the stash only while it still holds its own token. */
  token: number;
}

/** Unsaved drafts by article id; not persisted (the beforeunload guard covers closing the page). */
export const unsavedDrafts = create<{ drafts: Record<string, UnsavedDraft> }>(() => ({
  drafts: {},
}));
let lastToken = 0;

const dropUnsaved = (id: string, token?: number) =>
  unsavedDrafts.setState((s) => {
    if (token !== undefined && s.drafts[id]?.token !== token) return s;
    const drafts = { ...s.drafts };
    delete drafts[id];
    return { drafts };
  });

const blockUnload = (e: BeforeUnloadEvent) => {
  e.preventDefault();
  e.returnValue = "";
};

// App-lifetime guard: while any draft is stashed, closing or reloading the page asks first, whatever screen is open.
unsavedDrafts.subscribe(({ drafts }) => {
  window[Object.keys(drafts).length ? "addEventListener" : "removeEventListener"](
    "beforeunload",
    blockUnload,
  );
});

/** Keep the browser from closing the page while text is unsaved. */
export function useUnloadGuard(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const guard = (e: BeforeUnloadEvent) => blockUnload(e);
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [active]);
}

/** The field an issue points at (its input id) and the language tab it lives on. */
function issueTarget(issue: ArticleIssue): { field: string; lang?: Lang } {
  switch (issue.code) {
    case "title-ar":
    case "title-en":
      return { field: "title", lang: issue.code === "title-ar" ? "ar" : "en" };
    case "body-ar":
    case "body-en":
      return { field: "body", lang: issue.code === "body-ar" ? "ar" : "en" };
    case "body-device-media":
      return { field: "body", lang: issue.lang };
    case "cover-not-https":
      return { field: "cover" };
    default:
      return { field: "slug" };
  }
}

const nowTime = (lang: Lang) =>
  new Date().toLocaleTimeString(lang === "ar" ? "ar-SA-u-nu-latn" : "en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });

const fieldId = (name: string) => `website-field-${name}`;

/**
 * One article (packet DT-3): AR/EN tabs, Write / Preview, autosave and honest save states. "Saved ✓" only after the
 * store read the new commit id back from storage. Pending text is saved before any action (ready, archive, download,
 * back) and the action stops on a conflict or a failed save; conflicts (another tab, an import, a reset) never
 * overwrite and the text stays on screen. No XP or quest is ever touched here.
 */
export default function ArticleEditor({ id, onBack }: { id: string; onBack: () => void }) {
  const { t, lang: uiLang } = useT();
  const sheet = useSkillSheet();
  const stored = useStore((s) => s.articles.find((a) => a.id === id));
  const all = useStore((s) => s.articles);

  const [draft, setDraftState] = useState<Draft>(() => (stored ? toDraft(stored) : toDraft(EMPTY)));
  const [lang, setLang] = useState<Lang>(uiLang);
  const [mode, setMode] = useState<Mode>("write");
  const [save, setSaveState] = useState<SaveState>("idle");
  const [savedAt, setSavedAt] = useState("");
  const [gone, setGone] = useState(!stored);
  const [twin, setTwin] = useState<Article | null>(null);
  /** ⚙️ DT-7C-2B-3: the last Ready was refused because a Ready workflow is not provably local. */
  const [readyBlocked, setReadyBlocked] = useState(false);
  const [busy, setBusyState] = useState(false);
  const [dirtyState, setDirtyState] = useState(false);
  const [stash, setStash] = useState<UnsavedDraft | undefined>(
    () => unsavedDrafts.getState().drafts[id],
  );
  const [downloadNote, setDownloadNote] = useState(false);

  const draftRef = useRef(draft);
  const dirty = useRef(false);
  const saveRef = useRef<SaveState>("idle");
  const base = useRef<ArticleBase>(stored ? articleBase(stored) : { commitId: "", generation: -1 });
  const chain = useRef<Promise<boolean>>(Promise.resolve(true));
  const committing = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const busyRef = useRef(false);
  const stashShown = useRef(stash);

  const showStash = (s: UnsavedDraft | undefined) => {
    stashShown.current = s;
    setStash(s);
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
  const current = () => useStore.getState().articles.find((a) => a.id === id);
  const adopt = (a: Article) => {
    base.current = articleBase(a);
    setDirty(false);
    setDraft(toDraft(a));
    setSave("idle");
  };

  /** Compare the stored article with what the editor is based on (runs on every store change). */
  const check = () => {
    if (committing.current) return;
    const a = current();
    if (!a) {
      setGone(true);
      return;
    }
    setGone(false);
    const b = base.current;
    if (a.commitId === b.commitId && b.generation === articlesGeneration()) return;
    // Text identical to the form (a closed editor's save of the same draft landed) is no conflict.
    const same = JSON.stringify(toPatch(toDraft(a))) === JSON.stringify(toPatch(draftRef.current));
    if (!same && (dirty.current || saveRef.current === "conflict")) setSave("conflict");
    else adopt(a);
  };

  /** Apply a commit result: re-base on success, keep the text and say why on failure. */
  const settle = (r: ArticleResult, sent?: Draft): boolean => {
    setReadyBlocked(!r.ok && r.reason === "workflow-not-local");
    if (r.ok) {
      base.current = articleBase(r.article);
      if (!sent || draftRef.current === sent) setDirty(false);
      if (!sent) setDraft(toDraft(r.article));
      setSave("saved");
      return true;
    }
    if (r.reason === "missing") setGone(true);
    else if (r.reason === "unsupported-save") setSave("unsupported");
    else if (r.reason === "not-persisted") setSave("notPersisted");
    else if (r.reason === "slug-duplicate") setTwin(r.conflictsWith);
    else if (r.reason !== "issues" && r.reason !== "workflow-not-local") setSave("conflict");
    return false;
  };

  /** Run one store commit with this editor's subscriber paused, then re-check what the store holds. */
  const commit = async (run: () => Promise<ArticleResult>): Promise<ArticleResult> => {
    committing.current += 1;
    let r: ArticleResult;
    try {
      r = await run();
    } catch {
      r = { ok: false, reason: "not-persisted" };
    } finally {
      committing.current -= 1;
    }
    return r;
  };

  const saveNow = async (): Promise<boolean> => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (saveRef.current === "conflict") return false;
    if (!dirty.current) return true;
    const sent = draftRef.current;
    const r = await commit(() =>
      useStore.getState().updateArticle(id, toPatch(sent), base.current),
    );
    const ok = settle(r, sent);
    check();
    return ok;
  };

  /** Save pending text, one save at a time (each starts from the previous one's commit). */
  const flush = (): Promise<boolean> => (chain.current = chain.current.then(saveNow, saveNow));
  /** Keep what is not saved yet for this session; the list marks it and reopening offers it back. */
  const stashNow = (token = ++lastToken) => {
    unsavedDrafts.setState((s) => ({
      drafts: {
        ...s.drafts,
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
   * The editor closes (sidebar, Quick Actions, hash back): stash unsaved text now, so reopening offers it at once,
   * then save it. Only that save's own stash is cleared (saved) or refreshed (failed); a newer stash stays.
   */
  const close = () => {
    if (!dirty.current) return;
    const token = stashNow();
    void flush().then((ok) => {
      if (unsavedDrafts.getState().drafts[id]?.token !== token) return;
      if (ok && !dirty.current) dropUnsaved(id, token);
      else stashNow(token);
    });
  };
  /** A reopened editor follows its stash: once the closed editor's save landed (stash cleared), show the stored article. */
  const follow = () => {
    const shown = stashShown.current;
    const s = unsavedDrafts.getState().drafts[id];
    if (!shown || s === shown) return;
    showStash(s);
    const a = current();
    if (!s && !dirty.current && a) adopt(a);
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
    const hidden = () => {
      if (document.visibilityState === "hidden") void flushRef.current();
    };
    const leave = () => void flushRef.current();
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", leave);
    return () => {
      unsubscribe();
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", leave);
      closeRef.current();
    };
  }, []);

  useEffect(() => {
    followRef.current();
    return unsavedDrafts.subscribe(() => followRef.current());
  }, []);

  useUnloadGuard(dirtyState);

  const edit = (next: Draft) => {
    if (busyRef.current) return; // the fields are read-only while an action runs
    setDraft(next);
    setDirty(true);
    if (saveRef.current !== "conflict") setSave("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flushRef.current(), SAVE_DELAY_MS);
  };
  const editLang = (key: "title" | "summary" | "body", value: string) =>
    edit({ ...draftRef.current, [key]: { ...draftRef.current[key], [lang]: value } });

  /** Save pending text first; run the action only when that worked. */
  const act = async (run: () => Promise<ArticleResult>) => {
    if (busyRef.current) return;
    setBusy(true);
    try {
      if (!(await flush())) return;
      settle(await commit(run));
      check();
    } finally {
      setBusy(false);
    }
  };

  const restoreStash = () => {
    const s = stashShown.current;
    if (!s) return;
    showStash(undefined);
    dropUnsaved(id);
    base.current = s.base;
    setSave("idle");
    edit(s.fields);
  };
  const discardStash = () => {
    showStash(undefined);
    dropUnsaved(id);
  };

  const status = stored?.status ?? "draft";
  const archived = status === "archived";
  // What "ready" would check: the stored article with the form as it is now.
  const issues = useMemo(
    () => (stored ? articleIssues({ ...stored, ...toPatch(draft) }, all) : []),
    [stored, draft, all],
  );
  const issueText = (i: ArticleIssue) =>
    t(`website.issue.${i.code}` as MessageKey, {
      lang: i.lang ? t(`website.issueLang.${i.lang}`) : "",
    });
  const skill = draft.skillId ? getSkill(draft.skillId) : undefined;

  const focusIssue = (i: ArticleIssue) => {
    const target = issueTarget(i);
    if (target.lang) setLang(target.lang);
    setMode("write");
    setTimeout(() => document.getElementById(fieldId(target.field))?.focus(), 0);
  };

  /** Never blocked by a failing save: unsaved text is exported as it is, under an `-unsaved` name. */
  const download = async (l: Lang) => {
    const ok = await flush();
    const a = current();
    const unsaved = !ok || dirty.current || !a;
    const source: Article = unsaved
      ? { ...(a ?? stored ?? { ...EMPTY, id }), ...toPatch(draftRef.current) }
      : a!;
    const name = articleFileName(source, l);
    const url = URL.createObjectURL(
      new Blob([articleMarkdown(source, l)], { type: "text/markdown;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = unsaved ? name.replace(/\.md$/, "-unsaved.md") : name;
    link.click();
    URL.revokeObjectURL(url);
    setDownloadNote(unsaved);
  };

  const back = async () => {
    if (gone || (await flush())) onBack();
  };

  const dir = lang === "ar" ? "rtl" : "ltr";
  const label = (key: MessageKey) => (
    <span className="text-ink-2 text-[13px] font-semibold">{t(key)}</span>
  );

  return (
    <article
      className="flex min-w-0 flex-col gap-4"
      data-testid="article-editor"
      data-id={id}
      data-status={status}
      aria-busy={busy}
    >
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void back()}
          className="px-btn px-btn-ghost px-btn-sm"
          data-testid="website-back"
        >
          <ChevronLeft size={16} strokeWidth={1.75} className="ltr:rotate-180" aria-hidden />
          {t("website.back")}
        </button>
        <Chip tone={status === "ready" ? "tint" : "default"} data-testid="website-status">
          {t(`website.status.${status}`)}
        </Chip>
        <span
          className="text-muted ms-auto text-xs"
          aria-live="polite"
          data-testid="website-save-status"
          data-state={save}
        >
          {save === "saving" && t("website.save.saving")}
          {save === "saved" && t("website.save.saved", { time: savedAt })}
        </span>
      </div>

      <p className="text-ink-2 text-[13px]" data-testid="website-local-only">
        {t("website.localOnly")}
      </p>

      {gone && (
        <p role="alert" className="text-danger text-[13px]" data-testid="website-gone">
          {t("website.gone")}
        </p>
      )}
      {(save === "notPersisted" || save === "unsupported") && (
        <p role="alert" className="text-danger text-[13px]" data-testid="website-save-error">
          {t(save === "unsupported" ? "website.save.unsupported" : "website.save.notPersisted")}
        </p>
      )}
      {stash && (
        <div
          role="alert"
          className="bg-warn-bg flex flex-col gap-2 rounded-xl p-3 text-[13px]"
          data-testid="website-unsaved-prompt"
        >
          <p>{t("website.unsavedPrompt")}</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="px-btn px-btn-sm"
              onClick={restoreStash}
              data-testid="website-unsaved-restore"
            >
              {t("website.unsavedRestore")}
            </button>
            <button
              type="button"
              className="px-btn px-btn-ghost px-btn-sm"
              onClick={discardStash}
              data-testid="website-unsaved-discard"
            >
              {t("website.unsavedDiscard")}
            </button>
          </div>
        </div>
      )}
      {save === "conflict" && (
        <div
          role="alert"
          className="bg-warn-bg flex flex-col gap-2 rounded-xl p-3 text-[13px]"
          data-testid="website-conflict"
        >
          <p>{t("website.save.conflict")}</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="px-btn px-btn-ghost px-btn-sm"
              onClick={() => {
                const a = current();
                if (a) adopt(a);
              }}
              data-testid="website-load-latest"
            >
              {t("website.loadLatest")}
            </button>
            <button
              type="button"
              className="px-btn px-btn-sm"
              onClick={() => {
                const a = current();
                if (!a) return;
                base.current = articleBase(a);
                setDirty(true);
                setSave("saving");
                void flush();
              }}
              data-testid="website-keep-mine"
            >
              {t("website.keepMine")}
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          label={t("website.langLabel")}
          value={lang}
          onChange={setLang}
          options={LANGS.map((l) => ({
            value: l,
            label: t(`website.lang.${l}`),
            testId: `website-lang-${l}`,
          }))}
        />
        <Segmented
          label={t("website.modeLabel")}
          value={mode}
          onChange={setMode}
          options={[
            { value: "write", label: t("website.mode.write"), testId: "website-write" },
            { value: "preview", label: t("website.mode.preview"), testId: "website-preview" },
          ]}
        />
      </div>

      {archived && (
        <p className="text-ink-2 text-[13px]" data-testid="website-archived-note">
          {t("website.archivedNote")}
        </p>
      )}

      {mode === "preview" ? (
        <div className="px-inset flex flex-col gap-2" dir={dir} data-testid="website-preview-pane">
          {draft.coverUrl.trim().startsWith("https://") && (
            // eslint-disable-next-line @next/next/no-img-element -- the owner's https cover
            <img
              src={draft.coverUrl.trim()}
              alt=""
              className="note-img"
              referrerPolicy="no-referrer"
            />
          )}
          {draft.title[lang] && <h2 className="text-xl">{draft.title[lang]}</h2>}
          {draft.summary[lang] && <p className="text-ink-2">{draft.summary[lang]}</p>}
          {draft.body[lang].trim() ? (
            <ArticleMarkdown body={draft.body[lang]} />
          ) : (
            <p className="text-muted text-sm">{t("website.previewEmpty")}</p>
          )}
        </div>
      ) : (
        <fieldset
          disabled={archived || gone || !!stash}
          aria-busy={busy}
          className="flex min-w-0 flex-col gap-4"
        >
          <label className="flex flex-col gap-1">
            {label("website.field.title")}
            <input
              id={fieldId("title")}
              className="px-input"
              dir={dir}
              maxLength={200}
              value={draft.title[lang]}
              onChange={(e) => editLang("title", e.target.value)}
              readOnly={busy}
              data-testid="website-title"
            />
          </label>
          <label className="flex flex-col gap-1">
            {label("website.field.summary")}
            <textarea
              className="px-input min-h-16"
              dir={dir}
              maxLength={400}
              value={draft.summary[lang]}
              onChange={(e) => editLang("summary", e.target.value)}
              readOnly={busy}
              data-testid="website-summary"
            />
          </label>
          <label className="flex flex-col gap-1">
            {label("website.field.body")}
            <textarea
              id={fieldId("body")}
              className="px-input min-h-72 font-mono text-sm"
              dir={dir}
              maxLength={60_000}
              value={draft.body[lang]}
              onChange={(e) => editLang("body", e.target.value)}
              readOnly={busy}
              data-testid="website-body"
            />
          </label>

          <div className="flex flex-col gap-1">
            <label htmlFor={fieldId("slug")}>{label("website.field.slug")}</label>
            <div className="flex flex-wrap gap-2">
              <input
                id={fieldId("slug")}
                className="px-input min-w-0 flex-1"
                dir="ltr"
                maxLength={80}
                value={draft.slug}
                onChange={(e) => edit({ ...draftRef.current, slug: e.target.value })}
                readOnly={busy}
                data-testid="website-slug"
              />
              <button
                type="button"
                className="px-btn px-btn-ghost px-btn-sm"
                onClick={() =>
                  edit({ ...draftRef.current, slug: suggestSlug({ id, title: draft.title }) })
                }
                data-testid="website-slug-suggest"
              >
                {t("website.slugSuggest")}
              </button>
            </div>
            <span className="text-muted text-xs">{t("website.slugHint")}</span>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              {label("website.field.category")}
              <input
                className="px-input"
                maxLength={40}
                value={draft.category}
                onChange={(e) => edit({ ...draftRef.current, category: e.target.value })}
                readOnly={busy}
                data-testid="website-category"
              />
            </label>
            <label className="flex flex-col gap-1">
              {label("website.field.tags")}
              <input
                className="px-input"
                value={draft.tags}
                onChange={(e) => edit({ ...draftRef.current, tags: e.target.value })}
                readOnly={busy}
                data-testid="website-tags"
              />
              <span className="text-muted text-xs">{t("website.tagsHint")}</span>
            </label>
          </div>

          <label className="flex flex-col gap-1">
            {label("website.field.cover")}
            <input
              id={fieldId("cover")}
              type="url"
              className="px-input"
              dir="ltr"
              maxLength={500}
              placeholder="https://"
              value={draft.coverUrl}
              onChange={(e) => edit({ ...draftRef.current, coverUrl: e.target.value })}
              readOnly={busy}
              data-testid="website-cover"
            />
            <span className="text-muted text-xs">{t("website.coverHint")}</span>
          </label>

          <div className="flex flex-col gap-1">
            {label("website.field.skill")}
            {skill ? (
              <div className="px-inset flex flex-col gap-2" data-testid="website-skill-linked">
                <b className="text-sm">
                  {t("website.field.skill")}: {skill.name[uiLang]}
                </b>
                <p className="text-ink-2 text-[13px]">
                  {t("website.skillQuest", { text: skill.quests.article[uiLang] })}
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="px-btn px-btn-ghost px-btn-sm"
                    onClick={() => sheet.open(skill.id)}
                    data-testid="website-skill-open"
                  >
                    {t("website.skillOpen")}
                  </button>
                  <button
                    type="button"
                    className="px-btn px-btn-ghost px-btn-sm"
                    onClick={() => edit({ ...draftRef.current, skillId: undefined })}
                    data-testid="website-skill-unlink"
                  >
                    {t("website.skillUnlink")}
                  </button>
                </div>
              </div>
            ) : (
              <div inert={busy}>
                <SkillPicker
                  testId="website-skill"
                  onPick={(s) => edit({ ...draftRef.current, skillId: s.id })}
                />
              </div>
            )}
          </div>
        </fieldset>
      )}

      {!archived && (
        <section className="flex flex-col gap-1.5" data-testid="website-issues">
          <h3 className="ios-gh text-[13px]">{t("website.issuesTitle")}</h3>
          {issues.length === 0 ? (
            <p className="text-ink-2 text-[13px]">{t("website.noIssues")}</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {issues.map((i) => (
                <li key={`${i.code}-${i.lang ?? ""}`}>
                  <button
                    type="button"
                    className="px-link text-start text-[13px]"
                    onClick={() => focusIssue(i)}
                    data-testid="website-issue"
                    data-code={i.code}
                  >
                    {issueText(i)}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {twin && (
        <div
          role="alert"
          className="bg-warn-bg flex flex-col gap-2 rounded-xl p-3 text-[13px]"
          data-testid="website-restore-conflict"
        >
          <p>
            {t("website.restoreDuplicate", {
              title: twin.title[uiLang] || twin.title.ar || twin.title.en || twin.slug,
            })}
          </p>
          <button
            type="button"
            className="px-btn px-btn-sm self-start"
            disabled={busy}
            onClick={() => {
              setTwin(null);
              void act(() => useStore.getState().restoreArticle(id, { newSlug: true }));
            }}
            data-testid="website-restore-newslug"
          >
            {t("website.restoreNewSlug")}
          </button>
        </div>
      )}

      {readyBlocked && (
        <p role="alert" className="text-danger text-[13px]" data-testid="website-ready-blocked">
          {t("website.readyBlocked")}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {status === "draft" && (
          <button
            type="button"
            className="px-btn px-btn-sm"
            disabled={issues.length > 0 || gone || busy}
            title={issues[0] ? issueText(issues[0]) : undefined}
            onClick={() => void act(() => useStore.getState().setArticleStatus(id, "ready"))}
            data-testid="website-ready"
          >
            <FileCheck size={16} strokeWidth={1.75} aria-hidden />
            {t("website.markReady")}
          </button>
        )}
        {status === "ready" && (
          <button
            type="button"
            className="px-btn px-btn-ghost px-btn-sm"
            disabled={busy}
            onClick={() => void act(() => useStore.getState().setArticleStatus(id, "draft"))}
            data-testid="website-draft"
          >
            <Undo2 size={16} strokeWidth={1.75} aria-hidden />
            {t("website.toDraft")}
          </button>
        )}
        {archived ? (
          <button
            type="button"
            className="px-btn px-btn-ghost px-btn-sm"
            disabled={busy}
            onClick={() => void act(() => useStore.getState().restoreArticle(id))}
            data-testid="website-restore"
          >
            <ArchiveRestore size={16} strokeWidth={1.75} aria-hidden />
            {t("website.restore")}
          </button>
        ) : (
          <button
            type="button"
            className="px-btn px-btn-ghost px-btn-sm"
            disabled={gone || busy}
            onClick={() => void act(() => useStore.getState().setArticleStatus(id, "archived"))}
            data-testid="website-archive"
          >
            <Archive size={16} strokeWidth={1.75} aria-hidden />
            {t("website.archive")}
          </button>
        )}
        {LANGS.map((l) => (
          <button
            key={l}
            type="button"
            className="px-btn px-btn-ghost px-btn-sm"
            disabled={gone}
            onClick={() => void download(l)}
            data-testid={`website-download-${l}`}
          >
            <Download size={16} strokeWidth={1.75} aria-hidden />
            {t(l === "ar" ? "website.downloadAr" : "website.downloadEn")}
          </button>
        ))}
      </div>
      {downloadNote && (
        <p className="text-danger text-[13px]" data-testid="website-download-note">
          {t("website.downloadUnsaved")}
        </p>
      )}
      {status === "ready" && (
        <p className="text-ink-2 text-[13px]" data-testid="website-ready-note">
          {t("website.readyNote")}
        </p>
      )}
    </article>
  );
}

const EMPTY: Article = {
  id: "",
  title: { ar: "", en: "" },
  summary: { ar: "", en: "" },
  body: { ar: "", en: "" },
  slug: "",
  category: "",
  tags: [],
  coverUrl: "",
  status: "draft",
  revision: 1,
  commitId: "-",
  createdAt: "1970-01-01T00:00:00.000Z",
  updatedAt: "1970-01-01T00:00:00.000Z",
};
