// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { fetchFormatImage } from "./formatImage";

const url = "https://scontent.cdninstagram.com/image.jpg";
const jpeg = new Uint8Array([255, 216, 255, 224, 0, 16, 0, 0]);
const response = () => new Response(jpeg, { headers: { "Content-Type": "image/jpeg" } });
const signal = () => new AbortController().signal;
describe("bounded public source image acquisition", () => {
  it("passes bytes, follows only allowed CDN redirects, and sends no credentials", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { Location: "https://edge.fbcdn.net/image.jpg" },
        }),
      )
      .mockResolvedValueOnce(response());
    expect(await fetchFormatImage(url, fetcher, signal())).toEqual({
      mime: "image/jpeg",
      bytes: Buffer.from(jpeg),
    });
    for (const [, init] of fetcher.mock.calls) {
      expect(init).toMatchObject({
        redirect: "manual",
        credentials: "omit",
        referrerPolicy: "no-referrer",
      });
      expect(new Headers(init?.headers).get("Authorization")).toBeNull();
      expect(new Headers(init?.headers).get("Cookie")).toBeNull();
    }
  });
  it.each([
    "https://127.0.0.1/x",
    "http://scontent.cdninstagram.com/x",
    "https://scontent.cdninstagram.com:8443/x",
    "https://scontent.cdninstagram.com.attacker.test/x",
    "https://user:pass@scontent.cdninstagram.com/x",
  ])("rejects unsafe image origins before fetch: %s", async (value) => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(fetchFormatImage(value, fetcher, signal())).rejects.toMatchObject({
      code: "source_image_unavailable",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("stops a redirect to localhost and redirect loops", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      async () =>
        new Response(null, {
          status: 302,
          headers: { Location: "http://localhost:3000/api/local-ai/status" },
        }),
    );
    await expect(fetchFormatImage(url, fetcher, signal())).rejects.toMatchObject({
      code: "source_image_unavailable",
    });
    expect(fetcher).toHaveBeenCalledOnce();
    fetcher
      .mockClear()
      .mockImplementation(
        async () => new Response(null, { status: 302, headers: { Location: url } }),
      );
    await expect(fetchFormatImage(url, fetcher, signal())).rejects.toMatchObject({
      code: "source_image_unavailable",
    });
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it.each([
    () => new Response("<html>login</html>", { headers: { "Content-Type": "text/html" } }),
    () => new Response("<html>not an image</html>", { headers: { "Content-Type": "image/jpeg" } }),
    () =>
      new Response(jpeg, {
        headers: { "Content-Type": "image/jpeg", "Content-Length": "99999999" },
      }),
    () =>
      new Response(new Uint8Array(3 * 1024 * 1024 + 1), {
        headers: { "Content-Type": "image/jpeg" },
      }),
  ])(
    "rejects nonimages, spoofed MIME and oversized declared or streamed bodies",
    async (makeResponse) => {
      await expect(
        fetchFormatImage(url, vi.fn<typeof fetch>().mockResolvedValue(makeResponse()), signal()),
      ).rejects.toMatchObject({ code: "source_image_unavailable" });
    },
  );
});
