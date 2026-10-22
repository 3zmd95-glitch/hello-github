"use client";

import { useMemo, useState, type ChangeEvent } from "react";
import { useSheetClose } from "@/components/ui/ios/Sheet";
import {
  parseInstagramCsv,
  parseMyContentCsv,
  parseTikTokStudioCsv,
  parseYouTubeStudioCsv,
  type ParsedPostsCsv,
} from "@/lib/analytics";
import type { Platform } from "@/lib/domain";
import { useT, type MessageKey } from "@/lib/i18n";
import { useStore } from "@/store";
import GrowthDialog from "./GrowthDialog";

export const IMPORT_SOURCES = ["mycontent", "tiktok", "instagram", "youtube"] as const;
export type ImportSource = (typeof IMPORT_SOURCES)[number];

const PARSER: Record<ImportSource, (text: string) => ParsedPostsCsv> = {
  mycontent: parseMyContentCsv,
  tiktok: parseTikTokStudioCsv,
  instagram: parseInstagramCsv,
  youtube: parseYouTubeStudioCsv,
};
const LABEL: Record<ImportSource, MessageKey> = {
  mycontent: "growth.pimport.source.mycontent",
  tiktok: "growth.pimport.source.tiktok",
  instagram: "growth.pimport.source.instagram",
  youtube: "growth.pimport.source.youtube",
};
const WHERE: Record<ImportSource, MessageKey> = {
  mycontent: "growth.pimport.where.mycontent",
  tiktok: "growth.pimport.where.tiktok",
  instagram: "growth.pimport.where.instagram",
  youtube: "growth.pimport.where.youtube",
};

/** The import source to preselect for the platform the page is filtered to. */
export function sourceForPlatform(platform: Platform | undefined): ImportSource {
  return platform === "tiktok" || platform === "instagram" || platform === "youtube"
    ? platform
    : "mycontent";
}

/** Import posts: Beacons My Content / TikTok Studio / Instagram / YouTube Studio CSV → importPostStats, in a sheet. */
export default function PostImport({
  source,
  onClose,
}: {
  source?: ImportSource;
  onClose: () => void;
}) {
  const { t } = useT();
  return (
    <GrowthDialog title={t("growth.pimport.title")} testId="content-dialog" onClose={onClose}>
      <PostImportFields source={source} />
    </GrowthDialog>
  );
}

/** The import inside the sheet: Import and Cancel close it with its exit animation. */
function PostImportFields({ source: preset }: { source?: ImportSource }) {
  const { t } = useT();
  const close = useSheetClose();
  const importPostStats = useStore((s) => s.importPostStats);
  const [source, setSource] = useState<ImportSource>(preset ?? "mycontent");
  const [text, setText] = useState("");
  const parsed = useMemo(() => (text.trim() ? PARSER[source](text) : null), [text, source]);
  const rows = parsed?.stats.length ?? 0;
  const columns = parsed ? Object.values(parsed.columns).filter(Boolean) : [];

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setText(typeof reader.result === "string" ? reader.result : "");
    reader.readAsText(file);
  };

  const apply = () => {
    if (!parsed || rows === 0) return;
    importPostStats(parsed.stats);
    close();
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-ink-2 text-sm">{t("growth.pimport.hint")}</p>
      <div className="flex flex-wrap gap-2" role="group" aria-label={t("growth.pimport.title")}>
        {IMPORT_SOURCES.map((s) => (
          <button
            key={s}
            type="button"
            className="px-fchip"
            aria-pressed={source === s}
            onClick={() => setSource(s)}
            data-testid={`import-source-${s}`}
          >
            {t(LABEL[s])}
          </button>
        ))}
      </div>
      <p className="px-inset text-ink-2 text-xs" data-testid="import-where">
        {t(WHERE[source])}
      </p>
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-muted">{t("growth.pimport.paste")}</span>
        <textarea
          className="px-input num min-h-[140px] text-sm"
          dir="ltr"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Video title,Video link,Video publish time,Total views,Total likes,Total comments,Total shares"
          data-testid="content-csv"
        />
      </label>
      <label className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted">{t("growth.pimport.file")}</span>
        <input
          type="file"
          accept=".csv,text/csv,text/plain"
          onChange={onFile}
          className="text-ink-2 file:bg-tint-bg file:text-tint text-xs file:me-2 file:min-h-11 file:rounded-full file:border-0 file:px-3 file:font-semibold"
          data-testid="content-file"
        />
      </label>

      {parsed && (
        <div className="flex flex-col gap-1">
          <p className="text-sm" data-testid="content-preview" data-rows={rows}>
            {rows === 0
              ? t("growth.pimport.previewNone")
              : rows === 1
                ? t("growth.pimport.previewOne")
                : t("growth.pimport.preview", { n: rows })}
          </p>
          {columns.length > 0 && (
            <p className="num text-muted text-xs" dir="ltr">
              {t("growth.pimport.columns", { cols: columns.join(", ") })}
            </p>
          )}
        </div>
      )}
      {parsed && parsed.errors.length > 0 && (
        <ul
          className="text-danger flex max-h-32 flex-col gap-0.5 overflow-y-auto text-xs"
          data-testid="content-errors"
          role="alert"
        >
          {parsed.errors.map((e, i) => (
            <li
              key={`${e.line}-${i}`}
              data-testid="content-error"
              dir="ltr"
              className="num text-start"
            >
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
          data-testid="content-apply"
        >
          {t("growth.pimport.apply")}
        </button>
      </div>
    </div>
  );
}
