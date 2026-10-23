"use client";

import { useState, type FormEvent } from "react";
import type { DiscoverItem } from "@/lib/discover";
import { discoverFeedbackCreator, discoverPostKey } from "@/lib/discoverFeed";
import { useT } from "@/lib/i18n";
import { INSPIRATION_NOTE_MAX, inspirationKey } from "@/lib/inspiration";
import { normalizeRef } from "@/lib/research";
import { useStore } from "@/store";

function sourceAuthority(item: DiscoverItem): number {
  return Number(
    item.evidence?.source ===
      ({ ig: "instagram-public-embed", tt: "tiktok-oembed", yt: "youtube-api" } as const)[
        item.platform
      ] ||
      (item.platform === "tt" && item.evidence?.source === "tiktok-public-page"),
  );
}

/** A personal reference is not search evidence. Only the source reader may fill its caption/stats. */
export default function AddCategoryReference({
  genreId,
  onOpen,
  onAdded,
}: {
  genreId: string;
  onOpen: (url: string) => void;
  onAdded?: (kept: boolean) => void;
}) {
  const { t, lang } = useT();
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [note, setNote] = useState("");
  const [keep, setKeep] = useState(true);
  const [error, setError] = useState<"url" | "note" | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const libraryLoading = useStore((state) => state.discoverLibraryStatus === "loading");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (libraryLoading) return;
    let item: DiscoverItem;
    try {
      const ref = normalizeRef(url.trim());
      if (ref.platform === "web") throw new Error("Unsupported reference");
      const key = discoverPostKey(ref.platform, url.trim());
      if (!key) throw new Error("A direct public post is required");
      const matches = useStore
        .getState()
        .discoverCandidates.filter(
          (entry) => discoverPostKey(entry.item.platform, entry.item.url) === key,
        )
        .sort(
          (a, b) =>
            sourceAuthority(b.item) - sourceAuthority(a.item) ||
            (Date.parse(b.item.evidence?.observedAt ?? "") || 0) -
              (Date.parse(a.item.evidence?.observedAt ?? "") || 0),
        );
      const existing = matches[0]?.item;
      const categoryCopy = matches.find((entry) => entry.genreId === genreId)?.item;
      item = existing
        ? {
            ...existing,
            url: key,
            // Search rejection flags belong to a retrieval/category, not to the post itself.
            offTopic: categoryCopy?.offTopic,
            outsideCategory: categoryCopy?.outsideCategory,
          }
        : {
            ...ref,
            platform: ref.platform,
            url: key,
            snippet: "",
            lang,
            section: "example",
          };
    } catch {
      setError("url");
      return;
    }

    const state = useStore.getState();
    const prior = state.inspirations.find((entry) => inspirationKey(entry.ref) === item.url);
    const previousNote = prior?.note ?? "";
    const extra = note.trim();
    const combinedNote =
      !extra || previousNote.includes(extra)
        ? previousNote
        : previousNote
          ? `${previousNote}\n\n${extra}`
          : extra;
    if (combinedNote.length > INSPIRATION_NOTE_MAX) {
      setError("note");
      return;
    }
    // saveInspiration preserves an existing label, practice stage and saved date. A new label
    // belongs only to the saved reference, never to the candidate's source text or ranking.
    state.saveInspiration({ ...item, title: label.trim() || item.title });
    if (combinedNote !== previousNote) state.updateInspiration(item.url, { note: combinedNote });
    state.accumulateDiscoverCandidates([item], { genreId, manuallyAdded: true });
    if (keep)
      state.setDiscoverFeedback({
        url: item.url,
        platform: item.platform,
        creator: discoverFeedbackCreator(item),
        genreId,
        action: "more",
      });
    setSaved(item.url);
    setError(null);
    setUrl("");
    setLabel("");
    setNote("");
    onAdded?.(keep);
  };

  return (
    <details className="border-edge border-b pb-2 text-sm" data-testid="feed-add-reference">
      <summary className="px-link w-fit cursor-pointer">{t("feed.addReference")}</summary>
      <form
        onSubmit={submit}
        className="mt-3 flex min-w-0 flex-col gap-2"
        data-testid="feed-reference-form"
      >
        <p className="text-muted text-xs">{t("feed.referenceHelp")}</p>
        <input
          className="px-input min-w-0"
          type="url"
          inputMode="url"
          dir="ltr"
          autoComplete="off"
          value={url}
          onChange={(event) => {
            setUrl(event.target.value);
            setError(null);
            setSaved(null);
          }}
          aria-label={t("feed.referenceUrl")}
          placeholder={t("feed.referenceUrl")}
          data-testid="feed-reference-url"
          required
        />
        <input
          className="px-input min-w-0"
          type="text"
          value={label}
          maxLength={160}
          onChange={(event) => setLabel(event.target.value)}
          aria-label={t("feed.referenceLabel")}
          placeholder={t("feed.referenceLabel")}
          data-testid="feed-reference-label"
        />
        <textarea
          className="px-input min-w-0"
          rows={2}
          value={note}
          maxLength={INSPIRATION_NOTE_MAX}
          onChange={(event) => setNote(event.target.value)}
          aria-label={t("feed.referenceNote")}
          placeholder={t("feed.referenceNote")}
          data-testid="feed-reference-note"
        />
        <label className="flex items-start gap-2 text-xs">
          <input
            type="checkbox"
            checked={keep}
            onChange={(event) => setKeep(event.target.checked)}
            data-testid="feed-reference-keep"
          />
          {t("feed.referenceKeep")}
        </label>
        <button
          type="submit"
          className="px-btn px-btn-sm w-fit"
          disabled={libraryLoading}
          data-testid="feed-reference-submit"
        >
          {t("feed.referenceSubmit")}
        </button>
        {error && (
          <p role="alert" className="text-danger text-xs" data-testid="feed-reference-error">
            {t(error === "url" ? "feed.referenceInvalid" : "feed.referenceNoteFull")}
          </p>
        )}
        {saved && (
          <div
            role="status"
            className="flex flex-wrap items-center gap-2 text-xs"
            data-testid="feed-reference-saved"
          >
            <span>{t("feed.referenceSaved")}</span>
            <button type="button" className="px-link" onClick={() => onOpen(saved)}>
              {t("feed.referenceOpen")}
            </button>
          </div>
        )}
      </form>
    </details>
  );
}
