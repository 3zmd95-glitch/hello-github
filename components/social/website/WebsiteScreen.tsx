"use client";

import { Download, FileText, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import Chip from "@/components/ui/ios/Chip";
import EmptyState from "@/components/ui/ios/EmptyState";
import { ListRow } from "@/components/ui/ios/List";
import PageHeader from "@/components/ui/ios/PageHeader";
import Segmented from "@/components/ui/ios/Segmented";
import { articlesExport, searchArticles, storageDurable } from "@/lib/articles";
import { ARTICLE_STATUSES, type Article, type ArticleStatus, type Lang } from "@/lib/domain";
import { useT } from "@/lib/i18n";
import { useStore } from "@/store";
import ArticleEditor, { toPatch, unsavedDrafts } from "./ArticleEditor";

const HASH_RE = /^#a=([\w-]+)$/;
const parseHash = (hash: string) => HASH_RE.exec(hash)?.[1] ?? null;
/** A same-page anchor (a footnote in the preview): not ours, the open editor stays. */
const isForeignHash = (hash: string) => hash !== "" && hash !== "#" && !HASH_RE.test(hash);

/** Drop the article hash without a navigation (static export: no router push). */
function clearHash(): void {
  if (window.location.hash)
    history.replaceState(null, "", window.location.pathname + window.location.search);
}

const titleOf = (a: Article, lang: Lang) => a.title[lang] || a.title[lang === "ar" ? "en" : "ar"];

const when = (iso: string, lang: Lang) =>
  new Date(iso).toLocaleString(lang === "ar" ? "ar-SA-u-nu-latn" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });

function saveFile(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * 🌐 Website CMS (packet DT-3, planning/tools/33-website-cms.md): the owner's bilingual articles on this device, by
 * status (draft / ready / archived; nothing is public), with search in both languages and a content-only export.
 * `#a=<id>` opens the editor (like Notes' `#skill=`), so the phone's back button returns to the list. Other tabs'
 * saves arrive through the store's own storage listener (followOtherTabs); the editor turns them into conflicts.
 */
export default function WebsiteScreen() {
  const { t, lang } = useT();
  const articles = useStore((s) => s.articles);
  const [openId, setOpenId] = useState<string | null>(() => {
    const id = parseHash(window.location.hash);
    return id && useStore.getState().articles.some((a) => a.id === id) ? id : null;
  });
  const [filter, setFilter] = useState<ArticleStatus>("draft");
  const [query, setQuery] = useState("");
  const [durable] = useState(storageDurable);
  const [error, setError] = useState<"unsupported" | "notPersisted" | null>(null);
  const [exportedUnsaved, setExportedUnsaved] = useState(false);
  const stashes = unsavedDrafts((s) => s.drafts);
  useEffect(() => void useStore.getState().drainWorkflowRuns(), []); // ⚙️ DT-4: continue queued workflow runs

  useEffect(() => {
    const apply = () => {
      if (isForeignHash(window.location.hash)) return;
      const id = parseHash(window.location.hash);
      if (id && useStore.getState().articles.some((a) => a.id === id)) {
        setOpenId(id);
        window.scrollTo({ top: 0 });
      } else {
        setOpenId(null);
        if (id) clearHash();
      }
    };
    // An in-app link can mount this page before it writes the new URL: read again once navigation settled.
    const settle = setTimeout(apply, 0);
    window.addEventListener("hashchange", apply);
    return () => {
      clearTimeout(settle);
      window.removeEventListener("hashchange", apply);
    };
  }, []);

  const rows = useMemo(
    () =>
      searchArticles(
        query,
        articles.filter((a) => a.status === filter),
      ).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [articles, filter, query],
  );

  const create = async () => {
    setError(null);
    const r = await useStore.getState().addArticle();
    if (!r.ok) {
      setError(r.reason === "unsupported-save" ? "unsupported" : "notPersisted");
      return;
    }
    setFilter("draft");
    window.location.hash = `#a=${r.article.id}`;
  };

  const back = () => {
    clearHash();
    setOpenId(null);
  };

  if (openId)
    return (
      <div className="flex flex-col gap-4" data-testid="website-screen">
        <ArticleEditor key={openId} id={openId} onBack={back} />
      </div>
    );

  return (
    <div className="flex flex-col gap-4" data-testid="website-screen">
      <PageHeader title={t("social.website.title")} sub={t("website.sub")} />
      <p className="text-ink-2 text-[13px]" data-testid="website-local-only">
        {t("website.localOnly")}
      </p>
      {!durable && (
        <p
          role="alert"
          className="bg-warn-bg rounded-xl p-3 text-[13px]"
          data-testid="website-storage-blocked"
        >
          {t("website.storageBlocked")}
        </p>
      )}
      {error && (
        <p role="alert" className="text-danger text-[13px]" data-testid="website-error">
          {t(error === "unsupported" ? "website.save.unsupported" : "website.save.notPersisted")}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="px-btn flex-1"
          onClick={() => void create()}
          data-testid="website-new"
        >
          <Plus size={18} strokeWidth={2} aria-hidden />
          {t("website.new")}
        </button>
        <button
          type="button"
          className="px-btn px-btn-ghost"
          disabled={articles.length === 0}
          onClick={() => {
            // Unsaved drafts of this session go out with their current text, under an -unsaved name.
            const unsaved = articles.some((a) => stashes[a.id]);
            const list = articles.map((a) =>
              stashes[a.id] ? { ...a, ...toPatch(stashes[a.id].fields) } : a,
            );
            saveFile(
              unsaved ? "articles-unsaved.json" : "articles.json",
              JSON.stringify(articlesExport(list), null, 2),
              "application/json",
            );
            setExportedUnsaved(unsaved);
          }}
          data-testid="website-export-all"
        >
          <Download size={18} strokeWidth={1.75} aria-hidden />
          {t("website.exportAll")}
        </button>
      </div>

      {exportedUnsaved && (
        <p className="text-danger text-[13px]" data-testid="website-export-note">
          {t("website.downloadUnsaved")}
        </p>
      )}
      <input
        type="search"
        className="px-input"
        placeholder={t("website.searchPh")}
        aria-label={t("website.search")}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        data-testid="website-search"
      />
      <Segmented
        label={t("website.filterLabel")}
        value={filter}
        onChange={setFilter}
        options={ARTICLE_STATUSES.map((s) => ({
          value: s,
          label: `${t(`website.status.${s}`)} · ${articles.filter((a) => a.status === s).length}`,
          testId: `website-filter-${s}`,
        }))}
      />

      {rows.length === 0 ? (
        <div className="ios-list">
          {query.trim() ? (
            <p className="text-ink-2 p-4 text-[13px]" data-testid="website-no-results">
              {t("website.noResults")}
            </p>
          ) : (
            <EmptyState
              icon={<FileText size={24} strokeWidth={1.75} aria-hidden />}
              title={t(`website.empty.${filter}`)}
              hint={t("website.emptyHint")}
              testId="website-empty"
            />
          )}
        </div>
      ) : (
        <div className="ios-list">
          {rows.map((a) => (
            <ListRow
              key={a.id}
              icon={<FileText size={20} strokeWidth={1.75} aria-hidden />}
              title={titleOf(a, lang) || t("website.untitled")}
              sub={[t("website.updated", { time: when(a.updatedAt, lang) }), a.slug]
                .filter(Boolean)
                .join(" · ")}
              trailing={
                <span className="flex shrink-0 flex-col items-end gap-1">
                  {stashes[a.id] && (
                    <Chip tone="warn" data-testid="website-unsaved-chip">
                      {t("website.unsavedChip")}
                    </Chip>
                  )}
                  <Chip tone={a.status === "ready" ? "tint" : "default"}>
                    {t(`website.status.${a.status}`)}
                  </Chip>
                </span>
              }
              onClick={() => {
                window.location.hash = `#a=${a.id}`;
              }}
              testId="website-row"
              data-id={a.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}
