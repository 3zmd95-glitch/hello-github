"use client";

import getCaretCoordinates from "textarea-caret";
import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import { skills } from "@/data";
import { useT } from "@/lib/i18n";
import { saveNoteImage } from "@/lib/noteImages";
import {
  applyLinkSuggestion,
  insertBlock,
  linkQueryAt,
  noteImageMarkdown,
  suggestLinks,
  type LinkQuery,
} from "@/lib/notes";
import { useStore } from "@/store";

/**
 * The note's Markdown textarea with Obsidian-style extras: typing `[[` opens a list of skills to link (arrow keys,
 * Enter/Tab to pick, Esc to close, or tap), and pictures can be pasted, dropped or picked with 🖼️ (stored on the
 * device, see lib/noteImages). `onTemplate` shows the "start from a template" button while the note is empty.
 */
export default function NoteTextarea({
  value,
  onChange,
  onFlush,
  ariaLabel,
  onTemplate,
  className = "",
}: {
  value: string;
  onChange: (value: string) => void;
  onFlush: () => void;
  ariaLabel: string;
  onTemplate?: () => void;
  className?: string;
}) {
  const { t, lang, dir } = useT();
  const notes = useStore((s) => s.notes);
  const boost = useMemo(() => new Set(Object.keys(notes)), [notes]);
  const area = useRef<HTMLTextAreaElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const nextCaret = useRef<number | null>(null);
  const [query, setQuery] = useState<LinkQuery | null>(null);
  const [active, setActive] = useState(0);
  const [top, setTop] = useState(0);
  const [imageError, setImageError] = useState(false);
  const [busy, setBusy] = useState(false);
  // Where the owner closed the list with Esc: it stays closed for that `[[` until a new one is typed.
  const dismissed = useRef<number | null>(null);

  const suggestions = useMemo(
    () => (query ? suggestLinks(query.query, skills, lang, boost) : []),
    [query, lang, boost],
  );
  const open = !!query && suggestions.length > 0;

  // Put the caret back after a programmatic edit (a picked link, an inserted image).
  useLayoutEffect(() => {
    const el = area.current;
    if (el && nextCaret.current !== null) {
      el.focus();
      el.setSelectionRange(nextCaret.current, nextCaret.current);
      nextCaret.current = null;
    }
  });

  /** Re-read the caret: open, move or close the [[ list. */
  const refresh = (text: string) => {
    const el = area.current;
    if (!el) return;
    const caret = el.selectionStart;
    let q = el.selectionEnd === caret ? linkQueryAt(text, caret) : null;
    if (q && q.start === dismissed.current) q = null;
    else if (!q || q.start !== dismissed.current) dismissed.current = null;
    if (q?.start !== query?.start) setActive(0);
    setQuery(q);
    if (q) {
      const c = getCaretCoordinates(el, q.start);
      const lineBottom = c.top + c.height - el.scrollTop + 4;
      setTop(Math.max(8, Math.min(lineBottom, el.clientHeight - 8)));
    }
  };

  const pick = (label: string) => {
    const el = area.current;
    if (!el || !query) return;
    const r = applyLinkSuggestion(value, query, el.selectionStart, label);
    nextCaret.current = r.caret;
    setQuery(null);
    onChange(r.text);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!open || e.nativeEvent.isComposing) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const n = suggestions.length;
      setActive((i) => (i + (e.key === "ArrowDown" ? 1 : n - 1)) % n);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      pick(suggestions[Math.min(active, suggestions.length - 1)].label);
    } else if (e.key === "Escape") {
      e.preventDefault();
      dismissed.current = query?.start ?? null;
      setQuery(null);
    }
  };

  const addImages = async (files: File[]) => {
    const images = files.filter((f) => f.type.startsWith("image/"));
    if (images.length === 0) return;
    setImageError(false);
    setBusy(true);
    let text = value;
    let caret = area.current?.selectionStart ?? text.length;
    try {
      for (const img of images) {
        const id = await saveNoteImage(img);
        ({ text, caret } = insertBlock(text, caret, noteImageMarkdown(id, img.name || "image")));
      }
    } catch {
      setImageError(true);
    }
    setBusy(false);
    if (text !== value) {
      nextCaret.current = caret;
      onChange(text);
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData.files);
    if (files.some((f) => f.type.startsWith("image/"))) {
      e.preventDefault();
      void addImages(files);
    }
  };
  const onDrop = (e: DragEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.dataTransfer.files);
    if (files.some((f) => f.type.startsWith("image/"))) {
      e.preventDefault();
      void addImages(files);
    }
  };

  return (
    <div className={`flex min-w-0 flex-col gap-2 ${className}`}>
      <div className="flex flex-wrap items-center gap-2">
        {onTemplate && !value.trim() && (
          <button
            type="button"
            className="px-btn px-btn-ghost px-btn-sm"
            onClick={onTemplate}
            data-testid="note-template"
          >
            {t("notes.template")}
          </button>
        )}
        <button
          type="button"
          className="px-btn px-btn-ghost px-btn-sm"
          onClick={() => file.current?.click()}
          disabled={busy}
          data-testid="note-add-image"
        >
          {busy ? t("notes.imageSaving") : t("notes.addImage")}
        </button>
        <input
          ref={file}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            void addImages(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
          data-testid="note-image-input"
        />
        <span className="text-muted text-xs">{t("notes.linkHint")}</span>
        {imageError && (
          <span className="text-danger text-xs" role="alert">
            {t("notes.imageFailed")}
          </span>
        )}
      </div>

      <div className="relative">
        <textarea
          ref={area}
          // The page direction for the caret and the placeholder; each typed line then picks its own
          // direction (unicode-bidi: plaintext in .note-textarea), so Arabic and English lines both sit right.
          dir={dir}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            refresh(e.target.value);
          }}
          onKeyDown={onKeyDown}
          onKeyUp={(e) => {
            if (!["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(e.key) || !open)
              refresh(value);
          }}
          onClick={() => refresh(value)}
          onScroll={() => query && refresh(value)}
          onBlur={() => {
            onFlush();
            // Let a tap on a suggestion land before the list closes.
            setTimeout(() => setQuery(null), 150);
          }}
          onPaste={onPaste}
          onDrop={onDrop}
          placeholder={t("notes.placeholder")}
          aria-label={ariaLabel}
          aria-autocomplete="list"
          aria-controls={open ? "note-link-list" : undefined}
          aria-activedescendant={open ? `note-link-${active}` : undefined}
          className="px-input note-textarea"
          spellCheck
          data-testid="note-textarea"
        />
        {open && (
          <ul
            id="note-link-list"
            role="listbox"
            aria-label={t("notes.linkList")}
            className="note-suggest"
            style={{ top }}
            data-testid="note-suggest"
          >
            {suggestions.map((s, i) => (
              <li
                key={s.id}
                id={`note-link-${i}`}
                role="option"
                aria-selected={i === active}
                // mousedown, not click: keeps the textarea focused and beats its blur.
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(s.label);
                }}
                onMouseEnter={() => setActive(i)}
                data-testid="note-suggest-item"
                data-skill={s.id}
              >
                <span aria-hidden>{boost.has(s.id) ? "📝" : "▫️"}</span>
                <span className="min-w-0 truncate">{s.label}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
