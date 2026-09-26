"use client";

import { useEffect, useRef } from "react";
import { useT } from "@/lib/i18n";

/** Small pixel confirm dialog (Esc / backdrop / Cancel close it). */
export default function ConfirmDialog({
  title,
  body,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useT();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const onCancelRef = useRef(onCancel);
  useEffect(() => {
    onCancelRef.current = onCancel;
  }, [onCancel]);
  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancelRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div
      className="anim-fade fixed inset-0 z-50 grid place-items-center bg-[rgba(5,8,12,.7)] p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-body"
        className="px-card anim-popin flex w-full max-w-[400px] flex-col gap-3"
        data-testid="confirm-dialog"
      >
        <h2 id="confirm-title" className="text-lg">
          {title}
        </h2>
        <p id="confirm-body" className="text-ink-2 text-sm">
          {body}
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          <button ref={cancelRef} type="button" className="px-btn px-btn-ghost" onClick={onCancel}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className={`px-btn ${danger ? "px-btn-danger" : ""}`}
            onClick={onConfirm}
            data-testid="confirm-ok"
          >
            {confirmLabel ?? t("common.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
