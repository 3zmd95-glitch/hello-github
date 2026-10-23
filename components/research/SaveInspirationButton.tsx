"use client";

import { useT } from "@/lib/i18n";
import { inspirationKey } from "@/lib/inspiration";
import type { ResearchItem } from "@/lib/research";
import { useStore } from "@/store";

export default function SaveInspirationButton({
  item,
  onOpen,
}: {
  item: ResearchItem;
  onOpen?: (url: string) => void;
}) {
  const { t } = useT();
  const key = inspirationKey(item);
  const saved = useStore((s) => s.inspirations.some((entry) => inspirationKey(entry.ref) === key));
  const save = useStore((s) => s.saveInspiration);
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        className="px-btn px-btn-sm"
        aria-pressed={saved}
        onClick={() => {
          if (!saved) save(item);
          else onOpen?.(key);
        }}
        data-testid="inspiration-save"
      >
        {saved ? `✓ ${t("inspiration.saved")}` : t("inspiration.save")}
      </button>
      {saved && onOpen && (
        <button
          type="button"
          className="px-link text-xs"
          onClick={() => onOpen(key)}
          data-testid="inspiration-add-note"
        >
          {t("inspiration.addNote")}
        </button>
      )}
    </span>
  );
}
