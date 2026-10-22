"use client";

import { Plus, Workflow as WorkflowIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import Chip from "@/components/ui/ios/Chip";
import EmptyState from "@/components/ui/ios/EmptyState";
import { ListRow } from "@/components/ui/ios/List";
import PageHeader from "@/components/ui/ios/PageHeader";
import { storageDurable } from "@/lib/articles";
import type { Lang, Workflow } from "@/lib/domain";
import { useT } from "@/lib/i18n";
import { useStore } from "@/store";
import WorkflowEditor, { unsavedWorkflowDrafts } from "./WorkflowEditor";

const HASH_RE = /^#w=([\w-]+)$/;
const parseHash = (hash: string) => HASH_RE.exec(hash)?.[1] ?? null;

/** Drop the workflow hash without a navigation (static export: no router push). */
function clearHash(): void {
  if (window.location.hash)
    history.replaceState(null, "", window.location.pathname + window.location.search);
}

export const workflowName = (w: Pick<Workflow, "name">, lang: Lang) =>
  w.name[lang].trim() || w.name[lang === "ar" ? "en" : "ar"].trim();

/**
 * ⚙️ Workflows (packet DT-4, planning/tools/34-workflows.md): the owner's saved chains (trigger + 1–5 steps that create
 * local drafts) with their last run. `#w=<id>` opens the editor, like the CMS's `#a=`. Opening this screen continues
 * any queued run: runs execute only while the app is open in this browser.
 */
export default function WorkflowsScreen() {
  const { t, lang } = useT();
  const workflows = useStore((s) => s.workflows);
  const runs = useStore((s) => s.workflowRuns);
  const [openId, setOpenId] = useState<string | null>(() =>
    typeof window === "undefined" ? null : parseHash(window.location.hash),
  );
  const [durable] = useState(() => typeof window !== "undefined" && storageDurable());
  const [error, setError] = useState<"unsupported" | "notPersisted" | null>(null);
  const stashes = unsavedWorkflowDrafts((s) => s.drafts);

  // Runs execute only in an open tab: continue queued or interrupted runs on open and whenever the tab comes back.
  useEffect(() => {
    const drain = () => void useStore.getState().drainWorkflowRuns();
    const visible = () => {
      if (document.visibilityState === "visible") drain();
    };
    drain();
    document.addEventListener("visibilitychange", visible);
    return () => document.removeEventListener("visibilitychange", visible);
  }, []);

  useEffect(() => {
    const apply = () => {
      const id = parseHash(window.location.hash);
      if (id && useStore.getState().workflows.some((w) => w.id === id)) {
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

  /** Each workflow's most recent run. */
  const lastRun = useMemo(() => {
    const out = new Map<string, (typeof runs)[number]>();
    for (const r of runs) {
      const prev = out.get(r.workflowId);
      if (!prev || r.startedAt >= prev.startedAt) out.set(r.workflowId, r);
    }
    return out;
  }, [runs]);

  const rows = useMemo(
    () => [...workflows].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [workflows],
  );

  const create = async () => {
    setError(null);
    const r = await useStore.getState().addWorkflow();
    if (!r.ok) {
      setError(r.reason === "unsupported-save" ? "unsupported" : "notPersisted");
      return;
    }
    window.location.hash = `#w=${r.workflow.id}`;
  };

  const back = () => {
    clearHash();
    setOpenId(null);
  };

  if (openId)
    return (
      <div className="flex flex-col gap-4" data-testid="workflows-screen">
        <WorkflowEditor key={openId} id={openId} onBack={back} />
      </div>
    );

  return (
    <div className="flex flex-col gap-4" data-testid="workflows-screen">
      <PageHeader title={t("nav.workflows")} sub={t("workflows.sub")} />
      <p className="text-ink-2 text-[13px]" data-testid="workflows-local-only">
        {t("workflows.localOnly")}
      </p>
      {!durable && (
        <p
          role="alert"
          className="bg-warn-bg rounded-xl p-3 text-[13px]"
          data-testid="workflows-storage-blocked"
        >
          {t("workflows.storageBlocked")}
        </p>
      )}
      {error && (
        <p role="alert" className="text-danger text-[13px]" data-testid="workflows-error">
          {t(
            error === "unsupported" ? "workflows.save.unsupported" : "workflows.save.notPersisted",
          )}
        </p>
      )}
      <button
        type="button"
        className="px-btn"
        onClick={() => void create()}
        data-testid="workflows-new"
      >
        <Plus size={18} strokeWidth={2} aria-hidden />
        {t("workflows.new")}
      </button>

      <div className="ios-list">
        {rows.length === 0 ? (
          <EmptyState
            icon={<WorkflowIcon size={24} strokeWidth={1.75} aria-hidden />}
            title={t("workflows.empty")}
            hint={t("workflows.emptyHint")}
            testId="workflows-empty"
          />
        ) : (
          rows.map((w) => {
            const last = lastRun.get(w.id);
            return (
              <ListRow
                key={w.id}
                icon={<WorkflowIcon size={20} strokeWidth={1.75} aria-hidden />}
                title={workflowName(w, lang) || t("workflows.untitled")}
                sub={[
                  t(`workflows.trigger.${w.trigger.kind}`),
                  last
                    ? t("workflows.lastRun", { status: t(`workflows.status.${last.status}`) })
                    : t("workflows.never"),
                ].join(" · ")}
                trailing={
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    {stashes[w.id] && (
                      <Chip tone="warn" data-testid="workflows-unsaved-chip">
                        {t("workflows.unsavedChip")}
                      </Chip>
                    )}
                    <Chip tone={w.enabled ? "tint" : "default"} data-testid="workflows-row-state">
                      {t(w.enabled ? "workflows.enabled" : "workflows.paused")}
                    </Chip>
                  </span>
                }
                onClick={() => {
                  window.location.hash = `#w=${w.id}`;
                }}
                testId="workflows-row"
                data-id={w.id}
              />
            );
          })
        )}
      </div>
    </div>
  );
}
