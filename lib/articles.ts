import { fromMarkdown } from "mdast-util-from-markdown";
import type { Article, Lang } from "@/lib/domain";
import { normalizeForMatch } from "@/lib/replies";

/**
 * 🌐 Website CMS (packet DT-3, planning/tools/33-website-cms.md): pure article logic. No store import (the storage
 * key is a parameter), so the store can use articleIssues without a cycle.
 */

export const ARTICLE_LANGS: readonly Lang[] = ["ar", "en"];

export type ArticleIssueCode =
  | "title-ar"
  | "title-en"
  | "body-ar"
  | "body-en"
  | "body-device-media"
  | "slug-empty"
  | "slug-format"
  | "slug-duplicate"
  | "cover-not-https";

export interface ArticleIssue {
  code: ArticleIssueCode;
  /** Set for per-language issues reported under one code (body-device-media). */
  lang?: Lang;
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SLUG_MAX = 80;

/** The mdast fields this walk reads. */
type MdNode = { type: string; url?: string; children?: MdNode[] };
const DEVICE_SCHEME = /^\s*(?:img|blob|data):/i;

/**
 * Device-only media that never leaves this browser: an `img:<id>` (Notes pictures), `blob:` or `data:` URL in an
 * image or a reference definition. Parsed with react-markdown's own parser (mdast-util-from-markdown), so entities are
 * decoded, nested alt text is handled and code blocks or inline code never count. Raw HTML is not rendered by the
 * preview and is not inspected here.
 */
export function hasDeviceMedia(markdown: string): boolean {
  if (!markdown.trim()) return false;
  const stack: MdNode[] = [fromMarkdown(markdown)];
  while (stack.length) {
    const node = stack.pop()!;
    if ((node.type === "image" || node.type === "definition") && DEVICE_SCHEME.test(node.url ?? ""))
      return true;
    if (node.children) stack.push(...node.children);
  }
  return false;
}

/** ASCII `a-z0-9-` slug: accents dropped, other characters become one dash, at most 80 characters. */
export function slugify(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX)
    .replace(/-+$/, "");
}

/** From the English title; an Arabic-only title gets `draft-<first 6 of the id>` until the owner edits it. */
export function suggestSlug(article: Pick<Article, "id" | "title">): string {
  return (
    slugify(article.title.en) ||
    `draft-${article.id
      .replace(/[^a-z0-9]/gi, "")
      .slice(0, 6)
      .toLowerCase()}`
  );
}

export function isHttpsUrl(url: string): boolean {
  try {
    return new URL(url.trim()).protocol === "https:";
  } catch {
    return false;
  }
}

/** What stops an article from being marked ready, in display order. Empty = ready is allowed. */
export function articleIssues(article: Article, all: readonly Article[]): ArticleIssue[] {
  const out: ArticleIssue[] = [];
  for (const lang of ARTICLE_LANGS)
    if (!article.title[lang].trim()) out.push({ code: `title-${lang}` });
  for (const lang of ARTICLE_LANGS)
    if (!article.body[lang].trim()) out.push({ code: `body-${lang}` });
  for (const lang of ARTICLE_LANGS)
    if (hasDeviceMedia(article.body[lang])) out.push({ code: "body-device-media", lang });
  const slug = article.slug;
  if (!slug) out.push({ code: "slug-empty" });
  else if (!SLUG_RE.test(slug)) out.push({ code: "slug-format" });
  else if (all.some((a) => a.id !== article.id && a.status !== "archived" && a.slug === slug))
    out.push({ code: "slug-duplicate" });
  if (article.coverUrl.trim() && !isHttpsUrl(article.coverUrl))
    out.push({ code: "cover-not-https" });
  return out;
}

/** Articles whose titles, summaries, tags, slug or bodies (either language) contain the query. */
export function searchArticles(query: string, articles: readonly Article[]): Article[] {
  const q = normalizeForMatch(query);
  if (!q) return [...articles];
  return articles.filter((a) =>
    normalizeForMatch(
      [
        a.title.ar,
        a.title.en,
        a.summary.ar,
        a.summary.en,
        a.tags.join(" "),
        a.slug.replace(/-/g, " "),
        a.slug,
        a.body.ar,
        a.body.en,
      ].join(" "),
    ).includes(q),
  );
}

/** A YAML scalar as a JSON double-quoted string: quotes, colons, newlines and `---` stay inside it. */
const q = (value: string) => JSON.stringify(value);

/**
 * One language as a portable `.md`: YAML front matter (every scalar double-quoted) and the owner's source Markdown
 * as typed. A cover that is not https is left out.
 */
export function articleMarkdown(article: Article, lang: Lang): string {
  const cover = isHttpsUrl(article.coverUrl) ? article.coverUrl.trim() : "";
  const front = [
    `title: ${q(article.title[lang])}`,
    `summary: ${q(article.summary[lang])}`,
    `slug: ${q(article.slug)}`,
    `lang: ${q(lang)}`,
    `category: ${q(article.category)}`,
    `tags: ${JSON.stringify(article.tags)}`,
    `skill: ${q(article.skillId ?? "")}`,
    `cover: ${q(cover)}`,
    `status: ${q(article.status)}`,
    `updatedAt: ${q(article.updatedAt)}`,
  ];
  return `---\n${front.join("\n")}\n---\n\n${article.body[lang].replace(/\s+$/, "")}\n`;
}

export function articleFileName(article: Article, lang: Lang): string {
  return `${article.slug || suggestSlug(article)}.${lang}.md`;
}

export interface ArticlesExport {
  app: "3z-prod-articles";
  version: 1;
  exportedAt: string;
  articles: Article[];
}

/** Every article, content only (no settings, no keys), versioned for a later import or migration. */
export function articlesExport(articles: readonly Article[], now = new Date()): ArticlesExport {
  return {
    app: "3z-prod-articles",
    version: 1,
    exportedAt: now.toISOString(),
    articles: [...articles],
  };
}

const PROBE_KEY = "3z-prod-storage-probe";

/** Whether this browser keeps what the app writes (false in blocked or full storage). */
export function storageDurable(): boolean {
  try {
    const s = window.localStorage;
    s.setItem(PROBE_KEY, "1");
    const ok = s.getItem(PROBE_KEY) === "1";
    s.removeItem(PROBE_KEY);
    return ok;
  } catch {
    return false;
  }
}

/** True when the persisted JSON under `storageKey` holds this exact commit of the article (read back, not assumed). */
export function articlePersisted(storageKey: string, id: string, commitId: string): boolean {
  return storedArticle(storageKey, id)?.commitId === commitId;
}

/** The article as the persisted JSON under `storageKey` holds it, if any (another tab may have written it). */
export function storedArticle(storageKey: string, id: string): Partial<Article> | undefined {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return undefined;
    const list: unknown = JSON.parse(raw)?.state?.articles;
    return Array.isArray(list) ? list.find((a: Partial<Article>) => a?.id === id) : undefined;
  } catch {
    return undefined;
  }
}
