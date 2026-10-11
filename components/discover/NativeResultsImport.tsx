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

export default function NativeResultsImport({
  genres,
  onImported,
}: {
  genres: Genre[];
  onImported: (genreId: string) => void;
}) {
  const { t, L, lang } = useT();
  const loading = useStore((s) => s.discoverLibraryStatus === "loading");
  const [incoming, setIncoming] = useState<NativeImport | "invalid" | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [genreId, setGenreId] = useState("");
  const [retained, setRetained] = useState<number | null>(null);
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
      setRetained(null);
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
  if (!incoming)
    return retained === null ? null : (
      <p role="status" data-testid="native-import-result" className="text-ink-2 text-sm">
        {t("feed.nativeImported", { n: retained })}
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
          <p className="text-ink-2 text-sm">{t("feed.nativeImportHelp")}</p>
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
            disabled={loading || !selected.length || !genres.some((genre) => genre.id === genreId)}
            onClick={() => {
              const state = useStore.getState();
              if (
                consumed.current ||
                state.discoverLibraryStatus === "loading" ||
                !genres.some((genre) => genre.id === genreId)
              )
                return;
              consumed.current = true;
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
              setRetained(kept);
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
