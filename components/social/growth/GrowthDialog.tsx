"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useT } from "@/lib/i18n";

/** A centered sheet for the Growth forms (Esc, backdrop and the close button dismiss it). */
export default function GrowthDialog({
  title,
  testId,
  onClose,
  children,
}: {
  title: string;
  testId: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const { t } = useT();
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div
      className="anim-fade fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-[rgba(5,8,12,.7)] p-3 sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${testId}-title`}
        className="px-card anim-popin gr-dialog flex w-full max-w-[520px] flex-col gap-3"
        data-testid={testId}
      >
        <div className="flex items-start justify-between gap-2">
          <h2 id={`${testId}-title`} className="text-lg">
            {title}
          </h2>
          <button
            type="button"
            className="px-btn px-btn-ghost px-btn-sm"
            onClick={onClose}
            aria-label={t("common.cancel")}
            data-testid={`${testId}-close`}
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
