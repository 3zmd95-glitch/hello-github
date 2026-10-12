"use client";

import { useEffect, useRef, useState } from "react";
import type { Genre } from "@/lib/domain";
import { useT } from "@/lib/i18n";
import {
  NATIVE_IMPORT_PREFIX,
  nativeImportItems,
  parseNativeImport,
  type NativeImport,
} from "@/lib/discoverNativeImport";
import { useStore } from "@/store";
import { mergeEditFormats } from "@/lib/editFormats";
import { REVIEWED_FORMAT_SEEDS } from "@/lib/formatSeeds";
import { formatVerificationTarget, type FormatVerificationTarget } from "@/lib/formatVerification";
import { selectFormatCandidates } from "@/lib/formatQueue";
import { canonicalDiscoverVisualUrl } from "@/lib/discoverVisual";

export default function NativeResultsImport({
  genres,
  onImported,
  onFormatImported,
}: {
  genres: Genre[];
  onImported: (genreId: string) => void;
  onFormatImported?: (target: FormatVerificationTarget) => void;
}) {
  const { t, L, lang } = useT();
  const loading = useStore((s) => s.discoverLibraryStatus === "loading");
  const followed = useStore((s) => s.followedFormats);
  const formats = mergeEditFormats([], REVIEWED_FORMAT_SEEDS, followed);
  const [incoming, setIncoming] = useState<NativeImport | "invalid" | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [genreId, setGenreId] = useState("");
  const [destination, setDestination] = useState("category");
  const [formatKey, setFormatKey] = useState("");
  const [retained, setRetained] = useState<{ n: number; kind: string } | null>(null);
  const selectedFormat = formats.find((format) => format.key === formatKey);
  const isFormat =
    destination === "format" && incoming !== "invalid" && incoming?.platform === "ig";
  const validDestination = isFormat
    ? !!selectedFormat && selected.length <= 6
    : genres.some((genre) => genre.id === genreId);
  const consumed = useRef(false);
  useEffect(() => {
    const read = () => {
      if (!window.location.hash.startsWith(NATIVE_IMPORT_PREFIX)) return;
      const parsed = parseNativeImport(window.location.hash);
      window.history.replaceState(
        window.history.state,
        "",
        window.location.pathname + window.location.search,
      );
      consumed.current = false;
      setIncoming(parsed ?? "invalid");
      setSelected(parsed?.urls ?? []);
      setGenreId("");
      setDestination("category");
      setFormatKey("");
      setRetained(null);
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
  if (!incoming)
    return retained === null ? null : (
      <p role="status" data-testid="native-import-result" className="text-ink-2 text-sm">
        {t(retained.kind === "format" ? "feed.nativeFormatImported" : "feed.nativeImported", {
          n: retained.n,
        })}
      </p>
    );
  return (
    <section
      className="px-panel min-w-0 space-y-3 p-4"
      data-testid="native-import-review"
      aria-label={t("feed.nativeImport")}
    >
      <h2>{t("feed.nativeImport")}</h2>
      {incoming === "invalid" ? (
        <p role="alert">{t("feed.nativeInvalid")}</p>
      ) : (
        <>
          {incoming.platform === "ig" && (
            <label className="flex flex-col gap-1 text-sm">
              {t("feed.nativeDestination")}
              <select
                className="px-input min-w-0"
                data-testid="native-import-destination"
                value={destination}
                onChange={(event) => setDestination(event.target.value)}
              >
                <option value="category">{t("feed.nativeCategoryDestination")}</option>
                <option value="format">{t("feed.nativeFormatDestination")}</option>
              </select>
            </label>
          )}
          <p className="text-ink-2 text-sm">
            {t(isFormat ? "feed.nativeFormatHelp" : "feed.nativeImportHelp")}
          </p>
          {isFormat ? (
            <label className="flex flex-col gap-1 text-sm">
              {t("feed.nativeChooseFormat")}
              <select
                className="px-input min-w-0"
                data-testid="native-import-format"
                value={formatKey}
                onChange={(event) => setFormatKey(event.target.value)}
              >
                <option value="">{t("feed.nativeChooseFormat")}</option>
                {formats.map((format) => (
                  <option key={format.key} value={format.key}>
                    {lang === "ar" ? (format.name.ar ?? format.name.en) : format.name.en}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label className="flex flex-col gap-1 text-sm">
              {t("feed.chooseCategory")}
              <select
                className="px-input min-w-0"
                data-testid="native-import-category"
                value={genreId}
                onChange={(e) => setGenreId(e.target.value)}
              >
                <option value="">{t("feed.chooseCategory")}</option>
                {genres.map((genre) => (
                  <option key={genre.id} value={genre.id}>
                    {genre.emoji} {L(genre.name)}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="max-h-64 space-y-2 overflow-y-auto">
            {incoming.urls.map((url) => (
              <label key={url} className="flex min-w-0 items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1 shrink-0"
                  checked={selected.includes(url)}
                  onChange={(e) =>
                    setSelected((old) =>
                      e.target.checked ? [...old, url] : old.filter((entry) => entry !== url),
                    )
                  }
                />
                <span className="min-w-0 break-all" dir="ltr">
                  {url}
                </span>
              </label>
            ))}
          </div>
          <button
            type="button"
            className="px-btn px-btn-green"
            data-testid="native-import-confirm"
            disabled={loading || !selected.length || !validDestination}
            onClick={() => {
              const state = useStore.getState();
              if (
                consumed.current ||
                state.discoverLibraryStatus === "loading" ||
                !validDestination
              )
                return;
              consumed.current = true;
              if (isFormat && selectedFormat) {
                const target = formatVerificationTarget(selectedFormat);
                const urls = incoming.urls.filter((url) => selected.includes(url));
                state.addFormatCandidates(target, urls);
                const identities = new Set(urls.map(canonicalDiscoverVisualUrl));
                const kept = selectFormatCandidates(useStore.getState().formatQueue, target).filter(
                  (entry) => identities.has(entry.url),
                ).length;
                setRetained({ n: kept, kind: "format" });
                setIncoming(null);
                if (kept) onFormatImported?.(target);
                return;
              }
              const items = nativeImportItems(
                incoming,
                selected,
                genreId,
                state.discoverCandidates,
                lang,
              );
              state.accumulateDiscoverCandidates(items, { genreId, manuallyAdded: true });
              const kept = useStore
                .getState()
                .discoverCandidates.filter(
                  (entry) =>
                    entry.genreId === genreId && items.some((item) => item.url === entry.item.url),
                ).length;
              setRetained({ n: kept, kind: "category" });
              setIncoming(null);
              // With stored leads, category entry skips search; normal bounded source checks can run.
              if (kept) onImported(genreId);
            }}
          >
            {t("feed.nativeImportConfirm", { n: selected.length })}
          </button>
        </>
      )}
      <button
        type="button"
        className="px-btn px-btn-ghost"
        data-testid="native-import-cancel"
        onClick={() => setIncoming(null)}
      >
        {t("common.cancel")}
      </button>
    </section>
  );
}
