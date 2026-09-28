"use client";

import { useMemo, type ElementType, type HTMLAttributes } from "react";
import Markdown, { type Components, type ExtraProps } from "react-markdown";
import remarkGfm from "remark-gfm";
import { skills } from "@/data";
import { MISSING_LINK, linkifyWikiLinks } from "@/lib/notes";

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
      <Markdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
        {md}
      </Markdown>
    </div>
  );
}
