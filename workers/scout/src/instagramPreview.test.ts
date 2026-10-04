import { describe, expect, it, vi } from "vitest";
import { instagramPostUrl, lookupInstagramPreview, readInstagramPreview } from "./instagramPreview";
import { handle } from "./scout";

const POST = "https://www.instagram.com/p/ABC123/";
const IMAGE = "https://scontent.cdninstagram.com/photo.jpg?a=1&b=2";
const HTML = `<html><head><meta content='${POST}' property='og:url'><meta property="og:image" content="${IMAGE.replace("&", "&amp;")}"></head><body>ignored</body></html>`;
const html = (body = HTML) =>
  new Response(body, { headers: { "Content-Type": "text/html; charset=utf-8" } });

describe("Instagram public preview", () => {
  it("normalizes reels and post links without permitting profiles or arbitrary hosts", () => {
    expect(instagramPostUrl("https://instagram.com/editor/reel/ABC123/?igsh=test")).toBe(POST);
    for (const url of [
      "https://instagram.com/editor/",
      "https://instagram.com/reels/audio/123/",
      "https://instagram.com.evil.test/p/ABC123/",
      "https://www.instagram.com:8080/p/ABC123/",
      "https://user:pass@instagram.com/p/ABC123/",
      "file://instagram.com/p/ABC123/",
    ]) {
      expect(instagramPostUrl(url)).toBeNull();
    }
  });

  it("decodes entities and accepts only a preview for the requested post", async () => {
    expect(await readInstagramPreview(html(), POST)).toBe(IMAGE);
    expect(
      await readInstagramPreview(
        html(HTML.replace(POST, "https://www.instagram.com/accounts/login/")),
        POST,
      ),
    ).toBe("");
    expect(
      await readInstagramPreview(
        html(HTML.replace(POST, "https://www.instagram.com/p/OTHER/")),
        POST,
      ),
    ).toBe("");
    expect(
      await readInstagramPreview(
        html(HTML.replace("https://scontent.cdninstagram.com", "https://attacker.test")),
        POST,
      ),
    ).toBe("");
    expect(
      await readInstagramPreview(
        html(HTML.replace("https://scontent.cdninstagram.com", "http://scontent.cdninstagram.com")),
        POST,
      ),
    ).toBe("");
  });

  it("ignores fake meta tags in scripts, comments, or the body", async () => {
    const meta = `<meta property="og:url" content="${POST}"><meta property="og:image" content="${IMAGE}">`;
    for (const body of [
      `<head><script>const a='${meta}'</script></head>`,
      `<head><!-- ${meta} --></head>`,
      `<head></head><body>${meta}</body>`,
    ]) {
      expect(await readInstagramPreview(html(body), POST)).toBe("");
    }
  });

  it("reads chunked metadata and cancels the remaining application payload", async () => {
    const cancel = vi.fn();
    const chunks = [HTML.slice(0, 31), HTML.slice(31, 91), HTML.slice(91)];
    const stream = new ReadableStream({
      pull(controller) {
        const next = chunks.shift();
        if (next) controller.enqueue(new TextEncoder().encode(next));
      },
      cancel,
    });
    expect(
      await readInstagramPreview(
        new Response(stream, { headers: { "Content-Type": "text/html" } }),
        POST,
      ),
    ).toBe(IMAGE);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("limits a large response and does not read metadata beyond the budget", async () => {
    expect(await readInstagramPreview(html(" ".repeat(128 * 1024) + HTML), POST)).toBe("");
  });

  it("does not follow redirects, send credentials, or forward the Scout token", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(null, { status: 302, headers: { Location: "https://example.com/private" } }),
    );
    const res = await lookupInstagramPreview(POST, fetchMock, null);
    expect(res.data.thumb).toBe("");
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      POST,
      expect.objectContaining({
        redirect: "manual",
        headers: { Accept: "text/html", "User-Agent": "3z-Scout/1.0 (public link previews)" },
      }),
    );
  });

  it("caches successes for an hour and unavailable previews briefly", async () => {
    const entries = new Map<string, Response>();
    const cache = {
      match: async (key: Request) => entries.get(key.url)?.clone(),
      put: async (key: Request, res: Response) => {
        entries.set(key.url, res.clone());
      },
    } as unknown as Cache;
    const fetchMock = vi.fn<typeof fetch>(async () => html());
    const first = await lookupInstagramPreview(POST, fetchMock, cache);
    expect(first.data.thumb).toBe(IMAGE);
    expect(await lookupInstagramPreview(POST, fetchMock, cache)).toEqual(first);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect([...entries.values()][0].headers.get("cache-control")).toBe("public, max-age=3600");
    entries.clear();
    fetchMock.mockResolvedValue(new Response(null, { status: 429 }));
    expect((await lookupInstagramPreview(POST, fetchMock, cache)).data.thumb).toBe("");
    expect([...entries.values()][0].headers.get("cache-control")).toBe("public, max-age=300");
  });

  it("bounds a stalled request", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn<typeof fetch>(() => new Promise(() => {}));
      const pending = lookupInstagramPreview(POST, fetchMock, null);
      await vi.advanceTimersByTimeAsync(5000);
      expect((await pending).data.thumb).toBe("");
      expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("serves previews through the authenticated route without weakening auth", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => html());
    const url = `https://scout.test/oembed?url=${encodeURIComponent(POST)}`;
    const env = { SCOUT_TOKEN: "secret" };
    expect(
      (await handle(new Request(url), env, undefined, { fetch: fetchMock, cache: null })).status,
    ).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
    const res = await handle(
      new Request(url, { headers: { Authorization: "Bearer secret" } }),
      env,
      undefined,
      { fetch: fetchMock, cache: null },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ title: "", author: "", thumb: IMAGE, url: POST });
  });
});
