"use client";

import { useState, type FormEvent } from "react";
import { RefSchema, type Ref } from "@/lib/domain";
import { useT } from "@/lib/i18n";
import { normalizeRef } from "@/lib/research";
import { scoutOembed } from "@/lib/scoutClient";
import { useScoutConfig } from "./useScout";

/**
 * "Paste a link" row: URL + optional title, normalized into a {@link Ref} and handed to `onAdd`. With the
 * Scout Worker set up, TikTok and YouTube links are enriched through oEmbed first (title when none was
 * typed, the author as handle, and a thumbnail); if that fails the link is saved as-is.
 */
export default function PasteLinkForm({ onAdd }: { onAdd: (ref: Ref) => void }) {
  const { t } = useT();
  const scout = useScoutConfig();
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed || busy) return;
    const typedTitle = title.trim() || undefined;
    let ref: Ref;
    try {
      ref = normalizeRef(trimmed, typedTitle);
    } catch {
      setError(true);
      return;
    }
    if (scout && (ref.platform === "tt" || ref.platform === "yt")) {
      setBusy(true);
      const r = await scoutOembed(scout, ref.url);
      setBusy(false);
      if (r.ok) {
        const enriched = RefSchema.safeParse({
          ...ref,
          title: typedTitle ?? (r.data.title || ref.title),
          handle: r.data.author || ref.handle,
          ...(r.data.thumb ? { thumb: r.data.thumb } : {}),
        });
        if (enriched.success) ref = enriched.data;
      }
    }
    onAdd(ref);
    setUrl("");
    setTitle("");
    setError(false);
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-2" data-testid="paste-link-form">
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="url"
          inputMode="url"
          dir="ltr"
          autoComplete="off"
          className="px-input flex-[2]"
          placeholder={t("research.pasteUrlPh")}
          aria-label={t("research.pasteUrlPh")}
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setError(false);
          }}
          data-testid="paste-link-url"
        />
        <input
          type="text"
          autoComplete="off"
          className="px-input flex-1"
          placeholder={t("research.pasteTitlePh")}
          aria-label={t("research.pasteTitlePh")}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          data-testid="paste-link-title"
        />
        <button
          type="submit"
          className="px-btn px-btn-sm shrink-0"
          disabled={busy}
          data-testid="paste-link-save"
        >
          {t("research.pasteSave")}
        </button>
      </div>
      {busy && (
        <p className="text-muted text-xs" data-testid="paste-link-fetching">
          {t("research.pasteFetching")}
        </p>
      )}
      {error && (
        <p role="alert" className="text-danger text-xs">
          {t("research.pasteErr")}
        </p>
      )}
    </form>
  );
}
