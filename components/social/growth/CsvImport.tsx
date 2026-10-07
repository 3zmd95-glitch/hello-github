"use client";

import { useMemo, useState, type ChangeEvent } from "react";
import { useSheetClose } from "@/components/ui/ios/Sheet";
import { parseStatsCsv } from "@/lib/growth";
import { useT } from "@/lib/i18n";
import { useStore } from "@/store";
import GrowthDialog from "./GrowthDialog";

const EXAMPLE = "platform,day,followers,views30d,engagementPct\ntiktok,2026-09-27,1200,5000,4.2";

/** Paste or pick a CSV of `platform,day,followers,views30d[,engagementPct]`; preview, then import. In a sheet. */
export default function CsvImport({ onClose }: { onClose: () => void }) {
  const { t } = useT();
  return (
    <GrowthDialog title={t("growth.csv.title")} testId="csv-dialog" onClose={onClose}>
      <CsvFields />
    </GrowthDialog>
  );
}

/** The import inside the sheet: Import and Cancel close it with its exit animation. */
function CsvFields() {
  const { t } = useT();
  const close = useSheetClose();
  const importSnapshots = useStore((s) => s.importSnapshots);
  const [text, setText] = useState("");
  const parsed = useMemo(() => parseStatsCsv(text), [text]);
  const rows = parsed.snapshots.length;

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setText(typeof reader.result === "string" ? reader.result : "");
    reader.readAsText(file);
  };

  const apply = () => {
    if (rows === 0) return;
    importSnapshots(parsed.snapshots);
    close();
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-ink-2 text-sm">{t("growth.csv.hint")}</p>
      <div className="px-inset flex flex-col gap-1 text-xs">
        <span className="text-muted">{t("growth.csv.format")}</span>
        <code className="num text-ink-2 break-all" dir="ltr">
          {EXAMPLE.split("\n")[1]}
        </code>
        <span className="text-muted">{t("growth.csv.where")}</span>
      </div>
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-muted">{t("growth.csv.paste")}</span>
        <textarea
          className="px-input num min-h-[120px] text-sm"
          dir="ltr"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={EXAMPLE}
          data-testid="csv-text"
        />
      </label>
      <label className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted">{t("growth.csv.file")}</span>
        <input
          type="file"
          accept=".csv,text/csv,text/plain"
          onChange={onFile}
          className="text-ink-2 file:bg-tint-bg file:text-tint text-xs file:me-2 file:min-h-8 file:rounded-full file:border-0 file:px-3 file:font-semibold"
          data-testid="csv-file"
        />
      </label>

      {text.trim() && (
        <p className="text-sm" data-testid="csv-preview" data-rows={rows}>
          {rows === 0
            ? t("growth.csv.previewNone")
            : rows === 1
              ? t("growth.csv.previewOne")
              : t("growth.csv.preview", { n: rows })}
        </p>
      )}
      {parsed.errors.length > 0 && (
        <ul
          className="text-danger flex flex-col gap-0.5 text-xs"
          data-testid="csv-errors"
          role="alert"
        >
          {parsed.errors.map((e) => (
            <li key={e.line} data-testid="csv-error" dir="ltr" className="num text-start">
              {t("growth.csv.line", { n: e.line })}: {e.message}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className="px-btn px-btn-ghost" onClick={close}>
          {t("common.cancel")}
        </button>
        <button
          type="button"
          className="px-btn"
          disabled={rows === 0}
          onClick={apply}
          data-testid="csv-apply"
        >
          {t("growth.csv.apply")}
        </button>
      </div>
    </div>
  );
}
