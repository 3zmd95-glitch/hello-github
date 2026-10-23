"use client";

import type { ElementType, HTMLAttributes, MouseEvent } from "react";
import Markdown, { defaultUrlTransform, type Components, type ExtraProps } from "react-markdown";
import remarkGfm from "remark-gfm";
import { useT } from "@/lib/i18n";

type DirTag = "p" | "h1" | "h2" | "h3" | "h4" | "li" | "blockquote" | "td" | "th";

/** Every block picks its own direction, so Arabic and English paragraphs both sit right. */
function auto(Tag: DirTag) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  function Auto({ node, ...props }: HTMLAttributes<HTMLElement> & ExtraProps) {
    const El = Tag as ElementType;
    return <El dir="auto" {...props} />;
  }
  return Auto;
}

const schemeOf = (url: string) => /^([a-z][a-z0-9+.-]*):/i.exec(url)?.[1]?.toLowerCase();

/**
 * Article content is untrusted: links keep only http(s), mailto and relative/hash URLs; images only https (a device
 * `img:<id>`, `blob:` or `data:` picture never renders as if it were portable). Anything else becomes "".
 */
export function articleUrlTransform(url: string, key: string): string {
  const safe = defaultUrlTransform(url);
  if (!safe) return "";
  const scheme = schemeOf(safe);
  if (key === "src") return scheme === "https" ? safe : "";
  return !scheme || scheme === "http" || scheme === "https" || scheme === "mailto" ? safe : "";
}

/**
 * Same-page links (GFM footnotes and their back links, `#heading`) scroll inside the preview: the page hash belongs
 * to the CMS (`#a=<id>`) and is never touched.
 */
function scrollInPreview(e: MouseEvent<HTMLAnchorElement>): void {
  e.preventDefault();
  const id = decodeURIComponent(e.currentTarget.hash.slice(1));
  const preview = e.currentTarget.closest('[data-testid="article-preview"]');
  preview?.querySelector(`[id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "center" });
}

function BlockedImage({ alt }: { alt: string }) {
  const { t } = useT();
  return <span className="note-missing">{t("website.imageBlocked", { alt: alt || "—" })}</span>;
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
    if (typeof src !== "string" || !src) return <BlockedImage alt={alt} />;
    return (
      // eslint-disable-next-line @next/next/no-img-element -- remote https pictures linked in an article
      <img src={src} alt={alt} className="note-img" loading="lazy" referrerPolicy="no-referrer" />
    );
  },
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  a({ node, href = "", children, ...props }) {
    if (!href) return <span>{children}</span>;
    if (href.startsWith("#"))
      return (
        <a {...props} href={href} className="px-link" onClick={scrollInPreview}>
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
 * One language of an article as Markdown (GitHub flavor). react-markdown builds React elements and `skipHtml` drops
 * raw HTML, so an article cannot inject markup; no custom plugin bypasses the URL filter.
 */
export default function ArticleMarkdown({ body }: { body: string }) {
  return (
    <div className="note-md" data-testid="article-preview">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={COMPONENTS}
        urlTransform={articleUrlTransform}
        skipHtml
      >
        {body}
      </Markdown>
    </div>
  );
}
