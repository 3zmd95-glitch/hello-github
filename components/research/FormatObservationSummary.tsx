"use client";

import type { EditFormat } from "@/lib/editFormats";
import { formatVerificationTarget } from "@/lib/formatVerification";
import {
  selectFormatObservations,
  summarizeFormatObservations,
  type FormatObservation,
} from "@/lib/formatObservations";
import { useT } from "@/lib/i18n";
import { useStore } from "@/store";

/** Personal source checks stay separate from indexed scan counts and platform-wide adoption. */
export default function FormatObservationSummary({
  format,
  onOpen,
  onRemove,
}: {
  format: EditFormat;
  onOpen?: (row: FormatObservation) => void;
  onRemove?: (row: FormatObservation) => void;
}) {
  const { t, lang } = useT();
  const observations = useStore((state) => state.formatObservations);
  const remove = useStore((state) => state.removeFormatObservation);
  const target = formatVerificationTarget(format);
  const rows = selectFormatObservations(observations, target);
  const totals = summarizeFormatObservations(observations, target);
  if (!rows.length) return null;
  return (
    <details className="border-edge border-t pt-2 text-xs" data-testid="format-check-history">
      <summary className="px-link w-fit cursor-pointer font-bold">
        {t("formats.localChecks", { n: totals.checkedPosts })}
      </summary>
      <div className="mt-2 flex flex-col gap-2">
        <p data-testid="format-check-counts">
          {t("formats.localCounts", {
            audio: totals.audioMatches,
            visual: totals.sampledMatches,
            creators: totals.recentCreators,
          })}
        </p>
        <p className="text-muted">{t("formats.localChecksLimit")}</p>
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <li
              className="border-edge border-t pt-2"
              key={row.url}
              data-testid="format-saved-check"
            >
              <a
                className="px-link"
                href={row.url}
                target="_blank"
                rel="noopener noreferrer"
                dir="auto"
              >
                {row.source.author || row.source.title || row.url}
              </a>
              <p className="text-muted">
                {t("formats.checked", {
                  date: new Date(row.checkedAt).toLocaleString(lang === "ar" ? "ar-SA" : "en-GB", {
                    calendar: "gregory",
                  }),
                })}
              </p>
              <p>
                {t(
                  row.source.status !== "available"
                    ? "formats.checkUnavailable"
                    : row.inspection?.verification.basis === "source-frames-and-metadata"
                      ? "formats.savedFrames"
                      : row.inspection
                        ? "formats.savedThumbnail"
                        : "formats.savedMetadata",
                )}
              </p>
              <div className="mt-1 flex flex-wrap gap-3">
                {onOpen && (
                  <button
                    className="px-link"
                    type="button"
                    onClick={() => onOpen(row)}
                    data-testid="format-open-check"
                  >
                    {t("formats.openSavedCheck")}
                  </button>
                )}
                <button
                  className="px-link text-muted"
                  type="button"
                  data-testid="format-remove-check"
                  onClick={() => {
                    remove(target.key, row.url);
                    onRemove?.(row);
                  }}
                >
                  {t("formats.forgetCheck")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}
