// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Article } from "@/lib/domain";
import {
  articleFileName,
  articleIssues,
  articleMarkdown,
  articlePersisted,
  articlesExport,
  searchArticles,
  slugify,
  storageDurable,
  suggestSlug,
} from "./articles";

// 🌐 Website CMS (packet DT-3): pure article logic. Honest states only; exports carry the owner's source Markdown
// with safely quoted front matter; device-only media never counts as portable.

const NOW = "2026-10-16T12:00:00.000Z";
const article = (over: Partial<Article> = {}): Article => ({
  id: "a1b2c3d4-0000",
  title: { ar: "تلوين الليل", en: "Night grading" },
  summary: { ar: "ملخص", en: "Summary" },
  body: { ar: "## مقدمة\n\nنص عربي", en: "## Intro\n\nEnglish text" },
  slug: "night-grading",
  category: "color",
  tags: ["davinci", "ليل"],
  coverUrl: "",
  status: "draft",
  revision: 1,
  commitId: "commit-1",
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
});
const codes = (a: Article, all: Article[] = [a]) => articleIssues(a, all).map((i) => i.code);

afterEach(() => vi.restoreAllMocks());

describe("slugify / suggestSlug", () => {
  it("makes ASCII a-z0-9 slugs with single dashes, at most 80 chars", () => {
    expect(slugify("  Night Grading: DaVinci 19!  ")).toBe("night-grading-davinci-19");
    expect(slugify("Café --- crème")).toBe("cafe-creme");
    expect(slugify("تلوين")).toBe("");
    expect(slugify("a".repeat(100))).toHaveLength(80);
    expect(slugify(`${"a".repeat(79)} b`)).toBe("a".repeat(79));
  });

  it("suggests from the English title, or draft-<id6> for an Arabic-only title", () => {
    expect(suggestSlug(article())).toBe("night-grading");
    expect(suggestSlug(article({ title: { ar: "تلوين", en: "" } }))).toBe("draft-a1b2c3");
  });
});

describe("articleIssues", () => {
  it("has no issue for a complete article", () => expect(codes(article())).toEqual([]));

  it("reports every missing title and body per language", () => {
    const a = article({ title: { ar: " ", en: "" }, body: { ar: "", en: "\n" } });
    expect(codes(a)).toEqual(["title-ar", "title-en", "body-ar", "body-en"]);
  });

  it("reports an empty or badly formed slug", () => {
    expect(codes(article({ slug: "" }))).toEqual(["slug-empty"]);
    expect(codes(article({ slug: "Night Grading" }))).toEqual(["slug-format"]);
    expect(codes(article({ slug: "night--grading" }))).toEqual(["slug-format"]);
    expect(codes(article({ slug: "تلوين" }))).toEqual(["slug-format"]);
  });

  it("reports a duplicate slug among other non-archived articles only", () => {
    const a = article();
    const twin = article({ id: "other", status: "ready" });
    const archived = article({ id: "old", status: "archived", archivedAt: NOW });
    expect(codes(a, [a, twin])).toEqual(["slug-duplicate"]);
    expect(codes(a, [a, archived])).toEqual([]);
    expect(codes(a, [a])).toEqual([]);
  });

  it("requires an https cover", () => {
    expect(codes(article({ coverUrl: "http://x.test/a.jpg" }))).toEqual(["cover-not-https"]);
    expect(codes(article({ coverUrl: "img:abc" }))).toEqual(["cover-not-https"]);
    expect(codes(article({ coverUrl: "javascript:alert(1)" }))).toEqual(["cover-not-https"]);
    expect(codes(article({ coverUrl: "https://x.test/a.jpg" }))).toEqual([]);
  });

  it("reports device-only media in a body, per language (Amendment A)", () => {
    const a = article({
      body: {
        ar: "نص ![x](img:abc)",
        en: "Text ![y](blob:http://localhost/1) ![z](data:image/png;base64,AA)",
      },
    });
    expect(articleIssues(a, [a])).toEqual([
      { code: "body-device-media", lang: "ar" },
      { code: "body-device-media", lang: "en" },
    ]);
    expect(codes(article({ body: { ar: "![x](https://x.test/a.png)", en: "ok" } }))).toEqual([]);
  });

  it("finds device media by parsing, not by pattern (Amendment C)", () => {
    const media = (en: string) => codes(article({ body: { ar: "نص", en } }));
    for (const body of [
      "![a ![b](x)](img:1)",
      "![a](&#105;mg:1)",
      "![a][ref]\n\n[ref]: img:1",
      "[a]: img:1",
      "![a](<blob:http://localhost/x>)",
      "![a](DATA:image/png;base64,AA)",
    ])
      expect(media(body), body).toEqual(["body-device-media"]);
    for (const body of [
      "```md\n![a](img:1)\n```",
      "Use `![a](img:1)` in Notes",
      "    ![a](img:1)",
      "[a link](https://x.test/img:1)",
      "![remote](https://x.test/data:1.png)",
    ])
      expect(media(body), body).toEqual([]);
  });
});

describe("searchArticles", () => {
  const a = article();
  const b = article({
    id: "b",
    title: { ar: "إضاءة", en: "Lighting" },
    slug: "lighting",
    tags: ["softbox"],
    body: { ar: "ضوء", en: "Key light setup" },
    summary: { ar: "", en: "" },
  });
  const ids = (q: string) => searchArticles(q, [a, b]).map((x) => x.id);

  it("finds by Arabic and English title, tag, slug and body", () => {
    expect(ids("تلوين")).toEqual([a.id]);
    expect(ids("lighting")).toEqual(["b"]);
    expect(ids("SOFTBOX")).toEqual(["b"]);
    expect(ids("night-grading")).toEqual([a.id]);
    expect(ids("key light")).toEqual(["b"]);
    expect(ids("اضاءة")).toEqual(["b"]); // loose Arabic matching
    expect(ids("")).toEqual([a.id, "b"]);
    expect(ids("zzqx")).toEqual([]);
  });
});

describe("articleMarkdown / articleFileName", () => {
  it("writes YAML front matter and the source body for one language", () => {
    const md = articleMarkdown(article({ skillId: "smart-bins-keywords" }), "en");
    expect(md.startsWith("---\n")).toBe(true);
    expect(md).toContain('title: "Night grading"\n');
    expect(md).toContain('slug: "night-grading"\n');
    expect(md).toContain('lang: "en"\n');
    expect(md).toContain('tags: ["davinci","ليل"]\n');
    expect(md).toContain('skill: "smart-bins-keywords"\n');
    expect(md).toContain('status: "draft"\n');
    expect(md).toContain(`updatedAt: "${NOW}"\n`);
    expect(md.endsWith("---\n\n## Intro\n\nEnglish text\n")).toBe(true);
    expect(articleMarkdown(article(), "ar")).toContain("## مقدمة");
  });

  it("quotes scalars so quotes, colons, newlines and --- survive (Amendment A)", () => {
    const title = 'He said: "go"\n---\n# not a heading';
    const md = articleMarkdown(article({ title: { ar: "ع", en: title } }), "en");
    const line = md.split("\n").find((l) => l.startsWith("title: "))!;
    expect(line).toBe(`title: ${JSON.stringify(title)}`);
    expect(JSON.parse(line.slice("title: ".length))).toBe(title);
    // The front matter still closes once, before the body.
    expect(md.split("\n").filter((l) => l === "---")).toHaveLength(2);
  });

  it("exports the source Markdown as typed and never a non-https cover", () => {
    const body = "![x](img:abc) and <b>raw</b>";
    const md = articleMarkdown(article({ body: { ar: "ع", en: body }, coverUrl: "img:abc" }), "en");
    expect(md).toContain(body);
    expect(md).toContain('cover: ""\n');
    expect(articleMarkdown(article({ coverUrl: "https://x.test/c.jpg" }), "en")).toContain(
      'cover: "https://x.test/c.jpg"\n',
    );
  });

  it("names the file after the slug and language", () => {
    expect(articleFileName(article(), "ar")).toBe("night-grading.ar.md");
    expect(articleFileName(article({ slug: "", title: { ar: "ع", en: "" } }), "en")).toBe(
      "draft-a1b2c3.en.md",
    );
  });
});

describe("articlesExport", () => {
  it("is content only: no settings or keys", () => {
    const out = articlesExport([article()], new Date(NOW));
    expect(out).toEqual({
      app: "3z-prod-articles",
      version: 1,
      exportedAt: NOW,
      articles: [article()],
    });
    expect(JSON.stringify(out)).not.toMatch(/settings|apiKeys/);
  });
});

describe("storageDurable / articlePersisted", () => {
  it("is true when localStorage keeps a probe, false when setItem throws", () => {
    expect(storageDurable()).toBe(true);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(storageDurable()).toBe(false);
  });

  it("is false when the probe does not read back", () => {
    vi.spyOn(Storage.prototype, "getItem").mockReturnValue(null);
    expect(storageDurable()).toBe(false);
  });

  it("checks that the exact commit is in the persisted JSON, never id + revision alone", () => {
    const key = "test-key";
    const stored = article({ revision: 3, commitId: "commit-x" });
    localStorage.setItem(key, JSON.stringify({ state: { articles: [stored] } }));
    expect(articlePersisted(key, stored.id, "commit-x")).toBe(true);
    // Same id and revision, different commit (Amendment B).
    expect(articlePersisted(key, stored.id, "commit-y")).toBe(false);
    expect(articlePersisted(key, "nope", "commit-x")).toBe(false);
    localStorage.setItem(key, "not json");
    expect(articlePersisted(key, stored.id, "commit-x")).toBe(false);
    localStorage.removeItem(key);
    expect(articlePersisted(key, stored.id, "commit-x")).toBe(false);
  });
});
