"use client";

import { useRef, useState } from "react";
import { useWorld } from "@/components/shell/useWorld";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { useT, withoutEmoji, type MessageKey } from "@/lib/i18n";
import { dayKey } from "@/lib/streak";
import { useStore } from "@/store";
import Card from "./Card";

type Pending = { kind: "import"; json: string } | { kind: "reset" } | null;

/**
 * 💾 Backup: export the whole store as JSON, import one back, or reset everything (each after a confirm).
 * Both worlds show it (one store, tools/20): in Social the button labels lose their emoji (Social chrome
 * carries none, tools/18 §7).
 */
export default function DataCard() {
  const { t } = useT();
  const plain = useWorld() === "social";
  const label = (k: MessageKey) => (plain ? withoutEmoji(t(k)) : t(k));
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);

  const exportProgress = () => {
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

  const confirm = () => {
    if (!pending) return;
    if (pending.kind === "reset") {
      useStore.getState().reset();
      setNotice({ text: t("settings.resetOk") });
    } else {
      try {
        useStore.getState().importState(pending.json);
        setNotice({ text: t("settings.importOk") });
      } catch {
        setNotice({ text: t("settings.importErr"), error: true });
      }
    }
    setPending(null);
  };

  return (
    <Card title={t("settings.data")} note={t("settings.dataNote")}>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="px-btn" onClick={exportProgress} data-testid="export">
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
          onClick={() => setPending({ kind: "reset" })}
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
          body={pending.kind === "reset" ? t("settings.resetConfirm") : t("settings.importConfirm")}
          danger={pending.kind === "reset"}
          onConfirm={confirm}
          onCancel={() => setPending(null)}
        />
      )}
    </Card>
  );
}
