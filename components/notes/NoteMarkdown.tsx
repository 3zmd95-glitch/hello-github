"use client";

import { useEffect, useMemo, useState, type ElementType, type HTMLAttributes } from "react";
import Markdown, { defaultUrlTransform, type Components, type ExtraProps } from "react-markdown";
import remarkGfm from "remark-gfm";
import { skills } from "@/data";
import { useT } from "@/lib/i18n";
import { loadNoteImage } from "@/lib/noteImages";
import { MISSING_LINK, isNoteImage, linkifyWikiLinks, noteImageId } from "@/lib/notes";

type DirTag = "p" | "h1" | "h2" | "h3" | "h4" | "li" | "blockquote" | "td" | "th";

/** Every block picks its own direction, so an Arabic paragraph and an English one sit right in one note. */
function auto(Tag: DirTag) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  function Auto({ node, ...props }: HTMLAttributes<HTMLElement> & ExtraProps) {
    const El = Tag as ElementType;
    return <El dir="auto" {...props} />;
  }
  return Auto;
}

/** A picture stored on this device (`img:<id>`), read from IndexedDB into an object URL. */
function LocalImage({ id, alt }: { id: string; alt: string }) {
  const { t } = useT();
  const [state, setState] = useState<{ id: string; url: string | null } | null>(null);
  useEffect(() => {
    let url: string | null = null;
    let live = true;
    loadNoteImage(id).then((blob) => {
      if (!live) return;
      url = blob ? URL.createObjectURL(blob) : null;
      setState({ id, url });
    });
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [id]);
  if (!state || state.id !== id) return <span className="note-img-wait" aria-hidden />;
  if (!state.url)
    return (
      <span className="note-missing" data-testid="note-image-missing">
        🖼️ {t("notes.imageMissing")}
      </span>
    );
  // eslint-disable-next-line @next/next/no-img-element -- a local blob, nothing for next/image to optimize
  return <img src={state.url} alt={alt} className="note-img" data-testid="note-image" />;
}

/** Keep `img:<id>` (our stored pictures) and `#skill=` links; everything else goes through the safe default. */
function urlTransform(url: string): string {
  return isNoteImage(url) ? url : defaultUrlTransform(url);
}

const COMPONENTS: Components = {
  p: auto("p"),
  h1: auto("h1"),
  h2: auto("h2"),
  h3: auto("h3"),
  h4: auto("h4"),
  li: auto("li"),
  blockquote: auto("blockquote"),
  td: auto("td"),
  th: auto("th"),
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  img({ node, src, alt = "" }) {
    if (typeof src !== "string" || !src) return null;
    if (isNoteImage(src)) return <LocalImage id={noteImageId(src)} alt={alt} />;
    return (
      // eslint-disable-next-line @next/next/no-img-element -- remote pictures linked in a note
      <img src={src} alt={alt} className="note-img" loading="lazy" referrerPolicy="no-referrer" />
    );
  },
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  a({ node, href = "", children, ...props }) {
    if (href === MISSING_LINK)
      return (
        <span className="note-missing" data-testid="note-link-missing">
          {children}
        </span>
      );
    if (href.startsWith("#skill="))
      return (
        <a {...props} href={href} className="px-link" data-testid="note-link">
          {children}
        </a>
      );
    return (
      <a {...props} href={href} className="px-link" target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  },
};

/**
 * A note rendered as Markdown (GitHub flavor: tables, task lists, strikethrough) with `[[wiki links]]` turned
 * into links to other skills' notes. react-markdown builds React elements, never raw HTML, so a note cannot
 * inject markup.
 */
export default function NoteMarkdown({ body }: { body: string }) {
  const md = useMemo(() => linkifyWikiLinks(body, skills), [body]);
  return (
    <div className="note-md" data-testid="note-preview">
      <Markdown remarkPlugins={[remarkGfm]} components={COMPONENTS} urlTransform={urlTransform}>
        {md}
      </Markdown>
    </div>
  );
}
