import { describe, expect, it, vi } from "vitest";
import { lookupInstagramMedia, readInstagramMedia } from "./instagramMedia";

const ID = "DdP6LgrT_aD";
const POST = `https://www.instagram.com/p/${ID}/`;
const VIDEO = "https://instagram.example.fbcdn.net/video.mp4?public-signature=example";
const context = () => ({
  context: { type: "GraphVideo", shortcode: ID, copyright_blocked: false },
  gql_data: {
    shortcode_media: {
      __typename: "GraphVideo",
      shortcode: ID,
      is_video: true,
      video_url: VIDEO,
      video_duration: 15.916,
      dimensions: { width: 502, height: 886 },
    },
  },
});
const markup = (data = context()) =>
  `<html><script>doNotExecute({"contextJSON":${JSON.stringify(JSON.stringify(data))}});</script></html>`;
const html = (body = markup()) => new Response(body, { headers: { "Content-Type": "text/html" } });

describe("public Instagram embed media", () => {
  it("decodes only the inert JSON literal and binds both shortcode fields", async () => {
    const result = await readInstagramMedia(html(), POST);
    expect(result).toEqual({
      status: "available",
      sourceUrl: POST,
      observedAt: expect.any(String),
      provenance: "instagram-public-embed-context",
      video: { url: VIDEO, durationSeconds: 15.916, width: 502, height: 886 },
    });
  });
  it("rejects different source IDs, galleries, blocked media, and invalid metadata", async () => {
    const candidates = [
      () => {
        const v = context();
        v.context.shortcode = "OTHER";
        return v;
      },
      () => {
        const v = context();
        v.gql_data.shortcode_media.shortcode = "OTHER";
        return v;
      },
      () => {
        const v = context();
        v.context.copyright_blocked = true;
        return v;
      },
      () => {
        const v = context();
        v.context.type = "GraphSidecar";
        return v;
      },
      () => {
        const v = context();
        v.gql_data.shortcode_media.is_video = false;
        return v;
      },
      () => {
        const v = context();
        v.gql_data.shortcode_media.video_url = "https://attacker.test/file.mp4";
        return v;
      },
      () => {
        const v = context();
        v.gql_data.shortcode_media.video_duration = -1;
        return v;
      },
      () => {
        const v = context();
        v.gql_data.shortcode_media.dimensions.width = 100000;
        return v;
      },
    ];
    for (const make of candidates)
      expect((await readInstagramMedia(html(markup(make())), POST)).status).toBe("unavailable");
  });
  it("does not execute code or accept metadata from visible text, comments, or partial scripts", async () => {
    for (const body of [
      `<div>"contextJSON":${JSON.stringify(JSON.stringify(context()))}</div>`,
      `<!-- ${markup()} -->`,
      '<script>{"contextJSON":JSON.stringify({})}</script>',
      markup().replace("</script>", ""),
      `<script>{"contextJSON":${JSON.stringify(JSON.stringify(context()))},"contextJSON":"{}"}</script>`,
      " ".repeat(384 * 1024) + markup(),
    ])
      expect((await readInstagramMedia(html(body), POST)).status).toBe("unavailable");
  });
  it("uses only a bounded fixed public request and does not fetch the video", async () => {
    const doFetch = vi.fn<typeof fetch>(async () => html());
    expect(
      (
        await lookupInstagramMedia(
          `https://instagram.com/jayp.zip/reel/${ID}/?token=ignore`,
          doFetch,
        )
      ).status,
    ).toBe("available");
    expect(doFetch).toHaveBeenCalledExactlyOnceWith(`${POST}embed/captioned/`, {
      headers: { Accept: "text/html", "User-Agent": "3z-Scout/1.0 (public link previews)" },
      redirect: "manual",
      signal: expect.any(AbortSignal),
    });
    expect((await lookupInstagramMedia("https://localhost/private", doFetch)).status).toBe(
      "unavailable",
    );
    expect(doFetch).toHaveBeenCalledOnce();
  });
  it("handles login responses, redirects, network errors, timeout and cancellation explicitly", async () => {
    const doFetch = vi.fn<typeof fetch>(async () => new Response(null, { status: 302 }));
    expect((await lookupInstagramMedia(POST, doFetch)).status).toBe("unavailable");
    expect((await lookupInstagramMedia(POST, doFetch, AbortSignal.abort())).status).toBe(
      "unavailable",
    );
    expect(doFetch).toHaveBeenCalledOnce();
    vi.useFakeTimers();
    try {
      const stalled = vi.fn<typeof fetch>(() => new Promise(() => {}));
      const pending = lookupInstagramMedia(POST, stalled);
      await vi.advanceTimersByTimeAsync(5000);
      expect((await pending).status).toBe("unavailable");
      expect(stalled.mock.calls[0][1]?.signal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
