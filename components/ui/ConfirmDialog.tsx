"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useWorld } from "@/components/shell/useWorld";
import { useT } from "@/lib/i18n";

type ConfirmProps = {
  title: string;
  /** Optional in Social: an iOS alert may be a title alone. */
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/** Confirm dialog: the pixel one in Training, an iOS alert in 📱 Social. */
export default function ConfirmDialog(props: ConfirmProps) {
  return useWorld() === "social" ? <IosAlert {...props} /> : <PixelConfirm {...props} />;
}

/**
 * Small pixel confirm dialog (Esc / backdrop / Cancel close it). `cancelLabel` renames the dismiss button when
 * a plain "Cancel" could read as the action itself (canceling a schedule).
 */
function PixelConfirm({
  title,
  body,
  confirmLabel,
  cancelLabel,
  danger,
  onConfirm,
  onCancel,
}: ConfirmProps) {
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
          <button
            ref={cancelRef}
            type="button"
            className="px-btn px-btn-ghost"
            onClick={onCancel}
            data-testid="confirm-cancel"
          >
            {cancelLabel ?? t("common.cancel")}
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

/**
 * The iOS alert, portaled to <body> on the z-50 layer: it centers on the screen even when opened from a sheet (a
 * transformed panel would trap a fixed child). Esc is caught on document in the capture phase and stopped there,
 * so the sheet underneath stays open. Same roles, ids and test ids as the pixel dialog; focus goes to Cancel and
 * back to where it was.
 */
function IosAlert({
  title,
  body,
  confirmLabel,
  cancelLabel,
  danger,
  onConfirm,
  onCancel,
}: ConfirmProps) {
  const { t } = useT();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const onCancelRef = useRef(onCancel);
  useEffect(() => {
    onCancelRef.current = onCancel;
  }, [onCancel]);
  useEffect(() => {
    const prevFocus = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onCancelRef.current();
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      prevFocus?.focus?.({ preventScroll: true });
    };
  }, []);
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="ios-alert-root"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby={body ? "confirm-body" : undefined}
        className="ios-alert"
        data-testid="confirm-dialog"
      >
        <div className="ios-alert-body">
          <h2 id="confirm-title">{title}</h2>
          {body && <p id="confirm-body">{body}</p>}
        </div>
        <div className="ios-alert-actions">
          <button ref={cancelRef} type="button" onClick={onCancel} data-testid="confirm-cancel">
            {cancelLabel ?? t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            data-primary="true"
            data-danger={danger ? "true" : undefined}
            data-testid="confirm-ok"
          >
            {confirmLabel ?? t("common.confirm")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
