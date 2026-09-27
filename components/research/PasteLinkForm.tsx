"use client";

import { useState, type FormEvent } from "react";
import type { Ref } from "@/lib/domain";
import { useT } from "@/lib/i18n";
import { normalizeRef } from "@/lib/research";

/** "Paste a link" row: URL + optional title, normalized into a {@link Ref} and handed to `onAdd`. */
export default function PasteLinkForm({ onAdd }: { onAdd: (ref: Ref) => void }) {
  const { t } = useT();
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [error, setError] = useState(false);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) return;
    try {
      const ref = normalizeRef(trimmed, title.trim() || undefined);
      onAdd(ref);
      setUrl("");
      setTitle("");
      setError(false);
    } catch {
      setError(true);
    }
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
        <button type="submit" className="px-btn px-btn-sm shrink-0" data-testid="paste-link-save">
          {t("research.pasteSave")}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-danger text-xs">
          {t("research.pasteErr")}
        </p>
      )}
    </form>
  );
}
