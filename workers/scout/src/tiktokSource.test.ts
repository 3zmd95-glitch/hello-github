import { describe, expect, it, vi } from "vitest";
import { lookupTikTokSource, readTikTokSource, tiktokPostUrl } from "./tiktokSource";
const url = "https://www.tiktok.com/@blurrrapp/video/7137219803013500203";
const item = {
  id: "7137219803013500203",
  desc: "Anime beat sync edit",
  author: { uniqueId: "blurrrapp" },
  createTime: "1661763501",
  stats: { diggCount: 168, playCount: 12200 },
};
const markup = (detail: unknown) =>
  `<script>window.privateStuff="ignored"</script><script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify({ __DEFAULT_SCOPE__: { "webapp.video-detail": detail } })}</script>`;
const html = (text: string) => new Response(text, { headers: { "content-type": "text/html" } });
describe("public TikTok source evidence", () => {
  it("binds real public fields to the requested video, retaining low counts and actual date", async () => {
    const source = await readTikTokSource(
      html(markup({ statusCode: 0, itemInfo: { itemStruct: item } })),
      url,
    );
    expect(source).toMatchObject({
      status: "available",
      url,
      caption: item.desc,
      author: "blurrrapp",
      likes: 168,
      views: 12200,
      published: new Date(1661763501 * 1000).toISOString(),
      provenance: "tiktok-public-page",
    });
    expect(source).not.toHaveProperty("privateStuff");
  });
  it("distinguishes explicitly unavailable from a blocked or malformed page", async () => {
    expect(
      (await readTikTokSource(html(markup({ statusCode: 10204, statusMsg: "" })), url)).status,
    ).toBe("unavailable");
    for (const body of [
      "Log in",
      markup({ statusCode: 10216 }),
      markup({ statusCode: 0, itemInfo: { itemStruct: { ...item, id: "OTHER" } } }),
      markup({ statusCode: 0, itemInfo: { itemStruct: item } }).slice(0, -15),
    ])
      expect((await readTikTokSource(html(body), url)).status).toBe("unknown");
  });
  it("rejects arbitrary destinations, redirects and oversized responses", async () => {
    for (const bad of [
      "https://attacker.test/@a/video/7137219803013500203",
      "https://tiktok.com.attacker.test/@a/video/7137219803013500203",
      "https://user:pass@tiktok.com/@a/video/7137219803013500203",
      "https://tiktok.com:8080/@a/video/7137219803013500203",
      "https://tiktok.com/@a",
    ])
      expect(tiktokPostUrl(bad)).toBeNull();
    const fetcher = vi.fn<typeof fetch>(async () => new Response(null, { status: 302 }));
    expect((await lookupTikTokSource(url, fetcher)).status).toBe("unknown");
    expect(fetcher).toHaveBeenCalledWith(
      url,
      expect.objectContaining({
        redirect: "manual",
        headers: { Accept: "text/html", "User-Agent": "3z-Scout/1.0 (public link previews)" },
      }),
    );
    expect(
      (
        await readTikTokSource(
          html(" ".repeat(640 * 1024) + markup({ statusCode: 0, itemInfo: { itemStruct: item } })),
          url,
        )
      ).status,
    ).toBe("unknown");
  });
  it("does not convert hidden, negative or bogus counts into engagement evidence", async () => {
    const source = await readTikTokSource(
      html(
        markup({
          statusCode: 0,
          itemInfo: { itemStruct: { ...item, stats: { diggCount: -1, playCount: "lots" } } },
        }),
      ),
      url,
    );
    expect(source.status).toBe("available");
    expect(source.likes).toBeUndefined();
    expect(source.views).toBeUndefined();
  });
  it("uses only a public TikTok CDN poster, without trusting an arbitrary thumbnail destination", async () => {
    for (const cover of [
      "https://p16-common-sign.tiktokcdn.com/preview.jpg?token=public",
      "https://attacker.test/preview.jpg",
      "https://tiktokcdn.com.attacker.test/preview.jpg",
      "https://user:pass@p16-common-sign.tiktokcdn.com/preview.jpg",
      "http://p16-common-sign.tiktokcdn.com/preview.jpg",
    ]) {
      const source = await readTikTokSource(
        html(markup({ statusCode: 0, itemInfo: { itemStruct: { ...item, video: { cover } } } })),
        url,
      );
      expect(source.status).toBe("available");
      expect(source.thumbnailUrl).toBe(
        cover.startsWith("https://p16-common-sign.tiktokcdn.com/") ? cover : undefined,
      );
    }
  });
});
