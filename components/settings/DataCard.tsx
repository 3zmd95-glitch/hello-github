"use client";

import { useRef, useState } from "react";
import { useWorld } from "@/components/shell/useWorld";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { JOURNAL_CAPACITY } from "@/lib/cloudWorkflowJournal";
import { PROOF_CAPACITY, TOMBSTONES_MAX } from "@/lib/cloudWorkflowReconciliation";
import { REGISTRATION_CAPACITY } from "@/lib/cloudWorkflowRegistration";
import { useT, withoutEmoji, type MessageKey } from "@/lib/i18n";
import { dayKey } from "@/lib/streak";
import { cloudJournalRetained, useStore, type ImportStateResult } from "@/store";
import Card from "./Card";

type Pending = { kind: "import"; json: string } | { kind: "reset" } | null;

/** The honest sentence for a restore that changed nothing (DT-7C-2A adds the cloud journal refusals). */
const IMPORT_FAILED: Record<Exclude<ImportStateResult, { ok: true }>["reason"], MessageKey> = {
  "not-persisted": "settings.importNotSaved",
  "unsupported-save": "settings.importNotSaved",
  "journal-unreadable": "settings.journalUnreadable",
  "journal-invalid": "settings.importErr",
  "journal-conflict": "settings.importJournalRefused",
  "journal-capacity": "settings.importJournalFull",
};

/** `journal-capacity` names its own limit by scope (registrations 100; reconciliation 600 + 100; no scope: journal). */
function capacityText(
  t: ReturnType<typeof useT>["t"],
  scope: "registrations" | "reconciliation" | undefined,
) {
  if (scope === "registrations")
    return t("settings.importRegistrationsFull", { max: REGISTRATION_CAPACITY });
  if (scope === "reconciliation")
    return t("settings.importReconFull", { proofs: PROOF_CAPACITY, tombstones: TOMBSTONES_MAX });
  return t("settings.importJournalFull", { max: JOURNAL_CAPACITY });
}

/**
 * 💾 Backup: export the whole store as JSON, import one back, or reset everything (each after a confirm).
 * Both worlds show it (one store, tools/20): in Social the button labels lose their emoji (Social chrome
 * carries none, tools/18 §7). Reset and import resolve only once their write is read back (or refused), so the
 * notice says what really happened (DT-6B-2C-5B-R1, DT-7C-2A).
 */
export default function DataCard() {
  const { t } = useT();
  const plain = useWorld() === "social";
  const label = (k: MessageKey) => (plain ? withoutEmoji(t(k)) : t(k));
  const libraryLoading = useStore((s) => s.discoverLibraryStatus === "loading");
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  /** A restore or reset is on its way: a second Confirm or a Cancel does nothing until the durable result is known. */
  const working = useRef(false);
  const [busy, setBusy] = useState(false);
  /** Cloud journal entries a reset keeps (null: unreadable), read when the reset dialog opens. */
  const [retained, setRetained] = useState<number | null>(0);

  const exportProgress = () => {
    if (libraryLoading) return;
    const json = useStore.getState().exportState();
    const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `3z-prod-progress-${dayKey()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice({ text: t("settings.exportOk") });
  };

  const onFile = async (file: File | undefined) => {
    if (!fileRef.current) return;
    fileRef.current.value = "";
    if (!file) return;
    setPending({ kind: "import", json: await file.text() });
  };

  const confirm = async () => {
    if (!pending || working.current) return;
    working.current = true;
    setBusy(true);
    try {
      if (pending.kind === "reset") {
        const r = await useStore.getState().reset();
        setNotice(
          r.ok
            ? { text: t(r.retained > 0 ? "settings.resetOkRetained" : "settings.resetOk") }
            : {
                text: t(
                  r.reason === "journal-unreadable"
                    ? "settings.journalUnreadable"
                    : "settings.resetNotSaved",
                ),
                error: true,
              },
        );
      } else {
        const r = await useStore.getState().importState(pending.json);
        const retired = r.ok ? (r.retired?.length ?? 0) : 0;
        setNotice(
          r.ok
            ? {
                text: retired
                  ? `${t("settings.importOk")} ${t(retired === 1 ? "settings.importRetired.one" : "settings.importRetired.other", { count: retired })}`
                  : t("settings.importOk"),
              }
            : {
                text:
                  r.reason === "journal-capacity"
                    ? capacityText(t, r.scope)
                    : t(IMPORT_FAILED[r.reason]),
                error: true,
              },
        );
      }
    } catch {
      setNotice({
        text: t(pending.kind === "reset" ? "settings.resetNotSaved" : "settings.importErr"),
        error: true,
      });
    } finally {
      working.current = false;
      setBusy(false);
      setPending(null);
    }
  };

  return (
    <Card id="data" title={t("settings.data")} note={t("settings.dataNote")}>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="px-btn"
          onClick={exportProgress}
          disabled={libraryLoading}
          data-testid="export"
        >
          {label("settings.export")}
        </button>
        <button
          type="button"
          className="px-btn px-btn-ghost"
          onClick={() => fileRef.current?.click()}
        >
          {label("settings.import")}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          data-testid="import-file"
          onChange={(e) => onFile(e.target.files?.[0])}
        />
        <button
          type="button"
          className="px-btn px-btn-danger"
          onClick={() => {
            setRetained(cloudJournalRetained(useStore.getState()));
            setPending({ kind: "reset" });
          }}
          data-testid="reset"
        >
          {label("settings.reset")}
        </button>
      </div>
      {notice && (
        <p
          role="status"
          className={`text-sm font-semibold ${notice.error ? "text-danger" : "text-accent"}`}
        >
          {notice.text}
        </p>
      )}
      {pending && (
        <ConfirmDialog
          title={pending.kind === "reset" ? t("settings.resetTitle") : t("settings.importTitle")}
          body={
            pending.kind === "reset"
              ? retained === 0
                ? t("settings.resetConfirm")
                : `${t("settings.resetConfirm")} ${t("settings.resetRetained")}`
              : t("settings.importConfirm")
          }
          confirmLabel={
            busy
              ? t(pending.kind === "reset" ? "settings.resetBusy" : "settings.importBusy")
              : undefined
          }
          danger={pending.kind === "reset"}
          onConfirm={() => void confirm()}
          onCancel={() => {
            if (!working.current) setPending(null);
          }}
        />
      )}
    </Card>
  );
}
