"use client";

import { Search, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useT } from "@/lib/i18n";
import { quickActionTools, searchTools, type ToolDef } from "@/lib/tools";

/**
 * ⚡ Quick Actions (packet DT-2, planning/collaboration/dashboard-quick-actions-handoff.md): a small navigation
 * dialog over the DT-1 registry, opened from the launcher in either top bar or with Ctrl/Cmd+K. Navigation only:
 * no readiness, keys, status, requests, persistence or history entries (so not `Sheet`, which pushes one).
 */

const QuickContext = createContext<{ open: () => void }>({ open: () => {} });

/** `open()` for the top-bar launchers. */
export function useQuickActions(): { open: () => void } {
  return useContext(QuickContext);
}

const EDITABLE =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]';
const OTHER_MODAL = '[role="dialog"][aria-modal="true"], [role="alertdialog"]';

const destination = (tool: ToolDef) => (tool.href ?? tool.setupHref)!;

export function QuickActionsProvider({ children }: { children: ReactNode }) {
  const [isOpen, setOpen] = useState(false);
  const openRef = useRef(false);
  const opener = useRef<HTMLElement | null>(null);

  /**
   * Every entry point (launcher click or Enter, the shortcut, any context caller) comes through here (Amendment B):
   * refused while another modal dialog or alert is open, ignored while already open. True when it opened.
   */
  const open = useCallback(() => {
    if (openRef.current || document.querySelector(OTHER_MODAL)) return false;
    opener.current = document.activeElement as HTMLElement | null;
    openRef.current = true;
    setOpen(true);
    return true;
  }, []);

  /** `restore`: a dismissal gives focus back to the opener if it is still on the page; a selection does not. */
  const close = useCallback((restore: boolean) => {
    const el = opener.current;
    opener.current = null;
    openRef.current = false;
    setOpen(false);
    if (restore && el?.isConnected) el.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "k") return;
      if (e.altKey || e.shiftKey || e.repeat || e.isComposing || e.defaultPrevented) return;
      if (openRef.current) {
        e.preventDefault();
        close(true);
        return;
      }
      if (e.target instanceof Element && e.target.closest(EDITABLE)) return;
      if (open()) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  const value = useMemo(() => ({ open }), [open]);
  return (
    <QuickContext.Provider value={value}>
      {children}
      {isOpen && <QuickDialog onClose={close} />}
    </QuickContext.Provider>
  );
}

/** Mounted = open, so every opening starts with an empty query and the first result selected. */
function QuickDialog({ onClose }: { onClose: (restore: boolean) => void }) {
  const { t } = useT();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const results = useMemo(() => searchTools(query, quickActionTools()), [query]);
  const active = Math.min(sel, results.length - 1);
  const activeTool = results[active];
  const optionId = (tool: ToolDef) => `quick-opt-${tool.id}`;

  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => {
    if (activeTool)
      document.getElementById(optionId(activeTool))?.scrollIntoView?.({ block: "nearest" });
  }, [activeTool]);

  const rows = () => [...(listRef.current?.querySelectorAll("a") ?? [])];

  // Focus, selection and activation stay on one row (Amendment A): a focused result is the selection, arrows move
  // focus with it while a result has focus (only aria-activedescendant while the input has it), and Enter opens
  // the selection from the input or a result as one navigation (the link's own Enter activation is prevented).
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const onRow = listRef.current?.contains(e.target as Node) ?? false;
    if (e.key === "Escape") {
      e.preventDefault();
      onClose(true);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = active + (e.key === "ArrowDown" ? 1 : -1);
      const i = Math.max(0, Math.min(next, results.length - 1));
      setSel(i);
      if (onRow) rows()[i]?.focus();
    } else if (e.key === "Enter" && (onRow || e.target === inputRef.current)) {
      if (e.nativeEvent.isComposing || !activeTool) return;
      e.preventDefault();
      router.push(destination(activeTool));
      onClose(false);
    } else if (e.key === "Tab") {
      // Tab order is the visual order: input, Close, then the results, wrapping at both ends.
      e.preventDefault();
      const stops: HTMLElement[] = [inputRef.current, closeRef.current, ...rows()].filter(
        (el) => el !== null,
      );
      const at = stops.indexOf(document.activeElement as HTMLElement);
      stops[(at + (e.shiftKey ? -1 : 1) + stops.length) % stops.length]?.focus();
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[45]">
      <div
        className="absolute inset-0 bg-[rgba(5,8,12,.55)]"
        onClick={() => onClose(true)}
        data-testid="quick-backdrop"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("quick.title")}
        onKeyDown={onKeyDown}
        className="border-edge bg-panel text-ink absolute inset-x-0 top-2 mx-auto flex max-h-[calc(100dvh-16px)] w-[min(560px,calc(100%-32px))] flex-col overflow-hidden rounded-[var(--radius)] border shadow-[0_18px_48px_rgba(0,0,0,.35)] md:top-[10vh] md:max-h-[80vh]"
        data-testid="quick-dialog"
      >
        <div className="border-edge flex items-center gap-2 border-b px-3">
          <Search size={18} strokeWidth={1.75} className="text-muted shrink-0" aria-hidden />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded={results.length > 0}
            aria-controls="quick-list"
            aria-activedescendant={activeTool ? optionId(activeTool) : undefined}
            aria-autocomplete="list"
            aria-label={t("quick.title")}
            placeholder={t("quick.placeholder")}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSel(0);
            }}
            autoComplete="off"
            spellCheck={false}
            className="text-ink placeholder:text-muted min-w-0 flex-1 bg-transparent py-3 text-base outline-none"
            data-testid="quick-input"
          />
          <button
            ref={closeRef}
            type="button"
            onClick={() => onClose(true)}
            aria-label={t("quick.close")}
            title={t("quick.close")}
            className="text-muted hover:text-ink -me-2 grid h-11 w-11 shrink-0 place-items-center"
            data-testid="quick-close"
          >
            <X size={18} strokeWidth={1.75} aria-hidden />
          </button>
        </div>
        <div
          ref={listRef}
          id="quick-list"
          role="listbox"
          aria-label={t("quick.title")}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5"
        >
          {results.map((tool, i) => {
            const Icon = tool.icon;
            const on = i === active;
            return (
              <Link
                key={tool.id}
                id={optionId(tool)}
                href={destination(tool)}
                role="option"
                aria-selected={on}
                onFocus={() => setSel(i)}
                onClick={() => onClose(false)}
                className={`text-ink flex items-start gap-3 rounded-[calc(var(--radius)-2px)] px-3 py-2 whitespace-normal no-underline ${on ? "bg-panel-2" : "hover:bg-panel-2"}`}
                data-testid={`quick-item-${tool.id}`}
              >
                <Icon size={18} strokeWidth={1.75} className="mt-0.5 shrink-0" aria-hidden />
                <span className="flex min-w-0 flex-col">
                  <span className="font-semibold">{t(tool.name)}</span>
                  <span className="text-muted text-xs">{t(tool.desc)}</span>
                </span>
              </Link>
            );
          })}
          {results.length === 0 && (
            <p className="text-muted px-3 py-6 text-center text-sm" data-testid="quick-empty">
              {t("quick.empty")}
            </p>
          )}
        </div>
        <p className="border-edge text-muted hidden border-t px-3 py-2 text-xs md:block">
          {t("quick.hint")}
        </p>
      </div>
    </div>,
    document.body,
  );
}
