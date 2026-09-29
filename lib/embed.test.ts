import { describe, expect, it, vi } from "vitest";
import {
  EMBED_FRAME,
  EMBED_ORIGIN,
  PRECHECK_TIMEOUT_MS,
  canEmbed,
  embedId,
  embedSrc,
  embedTarget,
  isFromPlayer,
  openHref,
  parseIgMeasure,
  parseTiktokMessage,
  precheckEmbed,
  precheckUrl,
  readPlayerMessage,
  readPrecheck,
} from "./embed";

// ▶ Watch here (round 32): ids, player addresses, the pre-checks (with a fake fetch: nothing leaves the
// machine) and the players' messages. components/player/PlayerSheet.test.ts renders the sheet itself.

describe("embedId / canEmbed", () => {
  it("reads a YouTube id from every address shape", () => {
    for (const url of [
      "https://www.youtube.com/watch?v=abc123XYZ",
      "https://youtube.com/watch?v=abc123XYZ&t=42s",
      "https://m.youtube.com/watch?v=abc123XYZ",
      "https://youtu.be/abc123XYZ?si=share",
      "https://www.youtube.com/shorts/abc123XYZ",
      "https://youtube.com/shorts/abc123XYZ?feature=share",
    ]) {
      expect(embedId("yt", url), url).toBe("abc123XYZ");
      expect(canEmbed("yt", url), url).toBe(true);
    }
  });

  it("refuses YouTube pages that are not one video", () => {
    for (const url of [
      "https://www.youtube.com/@editor",
      "https://www.youtube.com/channel/UC123",
      "https://www.youtube.com/results?search_query=match+cut",
      "https://www.youtube.com/playlist?list=PL123",
      "https://www.youtube.com/watch?v=",
      "https://www.youtube.com/watch?v=a%20b",
      "not a url",
    ]) {
      expect(embedId("yt", url), url).toBeUndefined();
      expect(canEmbed("yt", url), url).toBe(false);
    }
  });

  it("reads a TikTok video id, from www and m. addresses, with or without a query", () => {
    expect(embedId("tt", "https://www.tiktok.com/@editor.sam/video/7300000000000000001")).toBe(
      "7300000000000000001",
    );
    expect(embedId("tt", "https://m.tiktok.com/@a_b.c/video/123?is_from_webapp=1")).toBe("123");
    expect(embedId("tt", "https://www.tiktok.com/@editor.sam")).toBeUndefined();
    expect(embedId("tt", "https://www.tiktok.com/tag/capcut")).toBeUndefined();
    expect(embedId("tt", "https://vm.tiktok.com/ZMabc123/")).toBeUndefined();
    expect(embedId("tt", "https://www.tiktok.com/music/original-sound-123")).toBeUndefined();
  });

  it("reads an Instagram shortcode from /p/, /reel/, /reels/, /tv/ and a user-prefixed reel", () => {
    for (const url of [
      "https://www.instagram.com/p/C1abcDEF/",
      "https://www.instagram.com/reel/C1abcDEF/",
      "https://www.instagram.com/reels/C1abcDEF",
      "https://www.instagram.com/tv/C1abcDEF",
      "https://www.instagram.com/cutsbyfaisal/reel/C1abcDEF",
      "https://instagram.com/cuts.by_faisal/p/C1abcDEF/?igsh=abc",
    ]) {
      expect(embedId("ig", url), url).toBe("C1abcDEF");
    }
  });

  it("refuses Instagram audio pages, profiles and explore pages", () => {
    for (const url of [
      "https://www.instagram.com/reels/audio/1234567890/",
      "https://www.instagram.com/cutsbyfaisal/",
      "https://www.instagram.com/explore/tags/capcut/",
      "https://www.instagram.com/",
    ]) {
      expect(embedId("ig", url), url).toBeUndefined();
      expect(canEmbed("ig", url), url).toBe(false);
    }
  });

  it("never plays a web link, even one pointing at a platform", () => {
    expect(canEmbed("web", "https://www.youtube.com/watch?v=abc123XYZ")).toBe(false);
    expect(canEmbed("web", "https://example.com/blog/match-cuts")).toBe(false);
  });
});

describe("embedSrc / embedTarget", () => {
  it("builds YouTube's privacy-enhanced player in the owner's language", () => {
    expect(embedSrc("yt", "abc123XYZ", "ar")).toBe(
      "https://www.youtube-nocookie.com/embed/abc123XYZ?autoplay=1&playsinline=1&rel=0&hl=ar",
    );
    expect(embedSrc("yt", "abc123XYZ", "en")).toBe(
      "https://www.youtube-nocookie.com/embed/abc123XYZ?autoplay=1&playsinline=1&rel=0&hl=en",
    );
  });

  it("builds TikTok's player v1 and Instagram's bare embed page (same in both languages)", () => {
    for (const lang of ["ar", "en"] as const) {
      expect(embedSrc("tt", "7300000000000000001", lang)).toBe(
        "https://www.tiktok.com/player/v1/7300000000000000001?autoplay=1&rel=0&description=1&music_info=1",
      );
      expect(embedSrc("ig", "C1abcDEF", lang)).toBe("https://www.instagram.com/p/C1abcDEF/embed/");
    }
  });

  it("keeps every player on its own origin and never loads a platform script (no embed.js, no iframe_api)", () => {
    for (const [platform, id] of [
      ["yt", "abc123XYZ"],
      ["tt", "123"],
      ["ig", "C1abcDEF"],
    ] as const) {
      const src = embedSrc(platform, id, "ar");
      expect(new URL(src).origin).toBe(EMBED_ORIGIN[platform]);
      expect(src).not.toMatch(/embed\.js|iframe_api|enablejsapi/);
    }
  });

  it("gives the whole target for a reference, or nothing when it cannot play", () => {
    expect(embedTarget("ig", "https://www.instagram.com/cutsbyfaisal/reel/C1abcDEF", "en")).toEqual(
      {
        platform: "ig",
        id: "C1abcDEF",
        src: "https://www.instagram.com/p/C1abcDEF/embed/",
      },
    );
    expect(embedTarget("yt", "https://youtu.be/abc123XYZ", "ar")?.src).toContain(
      "/embed/abc123XYZ?",
    );
    expect(embedTarget("web", "https://example.com/x", "ar")).toBeUndefined();
    expect(embedTarget("tt", "https://www.tiktok.com/@editor.sam", "ar")).toBeUndefined();
  });

  it("opens the reference's own web address, and never another scheme", () => {
    const url = "https://www.tiktok.com/@editor.sam/video/7300000000000000001?lang=ar";
    expect(openHref("tt", url)).toBe(url);
    expect(openHref("tt", "javascript://www.tiktok.com/@a/video/1%0aalert(1)")).toBe(
      "https://www.tiktok.com/@a/video/1",
    );
  });
});

describe("the frame's attributes", () => {
  it("are the same sandbox, permissions and referrer policy on all three players", () => {
    for (const p of ["yt", "tt", "ig"] as const) {
      expect(EMBED_FRAME[p]).toEqual({
        sandbox:
          "allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox",
        allow: "autoplay; encrypted-media; fullscreen; picture-in-picture",
        // Never no-referrer: YouTube answers Error 153 without the page's origin.
        referrerPolicy: "strict-origin-when-cross-origin",
      });
    }
  });
});

type FakeFetch = ReturnType<typeof vi.fn<typeof fetch>>;

const reply = (status: number, body?: unknown): FakeFetch =>
  vi.fn<typeof fetch>(async () =>
    body === undefined
      ? new Response(null, { status })
      : new Response(typeof body === "string" ? body : JSON.stringify(body), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
  );

describe("pre-check", () => {
  it("asks YouTube's oEmbed about the /shorts/ address and Instagram's tokenless oEmbed; TikTok has none", () => {
    expect(precheckUrl("yt", "abc123XYZ")).toBe(
      "https://www.youtube.com/oembed?format=json&url=https%3A%2F%2Fwww.youtube.com%2Fshorts%2Fabc123XYZ",
    );
    expect(precheckUrl("ig", "C1abcDEF")).toBe(
      "https://graph.facebook.com/v25.0/instagram_oembed?url=https%3A%2F%2Fwww.instagram.com%2Fp%2FC1abcDEF&omitscript=true",
    );
    expect(precheckUrl("tt", "123")).toBeUndefined();
  });

  it("reads YouTube's answers: 200 plays (vertical when taller than wide), 401 is off, 400 / 404 gone", () => {
    expect(readPrecheck("yt", 200, { width: 200, height: 113 })).toEqual({
      verdict: "play",
      vertical: false,
    });
    expect(readPrecheck("yt", 200, { width: 113, height: 200 })).toEqual({
      verdict: "play",
      vertical: true,
    });
    expect(readPrecheck("yt", 200, { width: "113", height: 200 })).toEqual({ verdict: "play" });
    expect(readPrecheck("yt", 200, undefined)).toEqual({ verdict: "play" });
    expect(readPrecheck("yt", 401, undefined)).toEqual({ verdict: "cantPlay" });
    expect(readPrecheck("yt", 400, undefined)).toEqual({ verdict: "gone" });
    expect(readPrecheck("yt", 404, undefined)).toEqual({ verdict: "gone" });
    for (const status of [403, 429, 500, 503, 0]) {
      expect(readPrecheck("yt", status, undefined), String(status)).toEqual({ verdict: "play" });
    }
  });

  it("reads Instagram's answers: only error subcode 2207045 refuses", () => {
    const refused = { error: { code: 24, error_subcode: 2207045, message: "Media Not Found" } };
    expect(readPrecheck("ig", 400, refused)).toEqual({ verdict: "cantPlay" });
    expect(readPrecheck("ig", 200, { html: "<blockquote>" })).toEqual({ verdict: "play" });
    expect(readPrecheck("ig", 400, { error: { code: 100, error_subcode: 33 } })).toEqual({
      verdict: "play",
    });
    expect(readPrecheck("ig", 400, { error: { error_subcode: "2207045" } })).toEqual({
      verdict: "play",
    });
    expect(readPrecheck("ig", 400, "junk")).toEqual({ verdict: "play" });
    expect(readPrecheck("ig", 429, refused)).toEqual({ verdict: "play" });
    expect(readPrecheck("tt", 400, refused)).toEqual({ verdict: "play" });
  });

  it("fetches once, without cookies, and reads the reply", async () => {
    const f = reply(200, { width: 113, height: 200, title: "A Short" });
    await expect(precheckEmbed({ platform: "yt", id: "abc123XYZ" }, { fetch: f })).resolves.toEqual(
      {
        verdict: "play",
        vertical: true,
      },
    );
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe(precheckUrl("yt", "abc123XYZ"));
    expect(init?.credentials).toBe("omit");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    // No token, no Worker: nothing but the oEmbed address is asked.
    expect(String(url)).not.toMatch(/access_token|scout/);
  });

  it("refuses from the reply", async () => {
    await expect(
      precheckEmbed({ platform: "yt", id: "abc123XYZ" }, { fetch: reply(401) }),
    ).resolves.toEqual({ verdict: "cantPlay" });
    await expect(
      precheckEmbed({ platform: "yt", id: "abc123XYZ" }, { fetch: reply(400, "Bad Request") }),
    ).resolves.toEqual({ verdict: "gone" });
    await expect(
      precheckEmbed(
        { platform: "ig", id: "C1abcDEF" },
        { fetch: reply(400, { error: { error_subcode: 2207045 } }) },
      ),
    ).resolves.toEqual({ verdict: "cantPlay" });
  });

  it("never blocks playback: a network error, CORS, a 429, a 5xx or junk all play", async () => {
    const target = { platform: "yt", id: "abc123XYZ" } as const;
    const offline = vi.fn<typeof fetch>(async () => {
      throw new TypeError("Failed to fetch");
    });
    for (const f of [offline, reply(429), reply(500), reply(503), reply(200, "<html>not json")]) {
      await expect(precheckEmbed(target, { fetch: f })).resolves.toEqual({ verdict: "play" });
    }
  });

  it("gives up after the timeout (4 s by default) and plays", async () => {
    expect(PRECHECK_TIMEOUT_MS).toBe(4000);
    vi.useFakeTimers();
    try {
      let aborted = false;
      const hang = vi.fn<typeof fetch>(
        (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              aborted = true;
              reject(new DOMException("aborted", "AbortError"));
            });
          }),
      );
      const check = precheckEmbed({ platform: "ig", id: "C1abcDEF" }, { fetch: hang });
      await vi.advanceTimersByTimeAsync(3999);
      expect(aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await expect(check).resolves.toEqual({ verdict: "play" });
      expect(aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops when the caller cancels, and skips the call when already cancelled or for TikTok", async () => {
    const ctrl = new AbortController();
    let seen: AbortSignal | undefined;
    const hang = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          seen = init?.signal ?? undefined;
          init?.signal?.addEventListener("abort", () => reject(new DOMException("", "AbortError")));
        }),
    );
    const check = precheckEmbed(
      { platform: "yt", id: "abc123XYZ" },
      { fetch: hang, signal: ctrl.signal },
    );
    ctrl.abort();
    await expect(check).resolves.toEqual({ verdict: "play" });
    expect(seen?.aborted).toBe(true);

    const unused = reply(401);
    await expect(
      precheckEmbed({ platform: "yt", id: "abc123XYZ" }, { fetch: unused, signal: ctrl.signal }),
    ).resolves.toEqual({ verdict: "play" });
    await expect(precheckEmbed({ platform: "tt", id: "123" }, { fetch: unused })).resolves.toEqual({
      verdict: "play",
    });
    expect(unused).not.toHaveBeenCalled();
  });
});

describe("messages from the players", () => {
  const frame = {} as Window;
  const other = {} as Window;

  it("accepts only the player's own origin from the sheet's own frame", () => {
    expect(isFromPlayer("ig", { origin: "https://www.instagram.com", source: frame }, frame)).toBe(
      true,
    );
    expect(isFromPlayer("tt", { origin: "https://www.tiktok.com", source: frame }, frame)).toBe(
      true,
    );
    for (const origin of [
      "https://instagram.com",
      "http://www.instagram.com",
      "https://www.instagram.com.evil.test",
      "https://evil-instagram.com",
      "https://www.tiktok.com",
      "null",
      "",
    ]) {
      expect(isFromPlayer("ig", { origin, source: frame }, frame), origin).toBe(false);
    }
    // Right origin, wrong window: another frame, the page itself, or no frame at all.
    expect(isFromPlayer("ig", { origin: "https://www.instagram.com", source: other }, frame)).toBe(
      false,
    );
    expect(isFromPlayer("ig", { origin: "https://www.instagram.com", source: null }, frame)).toBe(
      false,
    );
    expect(isFromPlayer("ig", { origin: "https://www.instagram.com", source: null }, null)).toBe(
      false,
    );
    expect(isFromPlayer("yt", { origin: "https://www.youtube.com", source: frame }, frame)).toBe(
      false,
    );
  });

  it("reads Instagram's MEASURE height (a JSON string) within 200..2000 px", () => {
    const measure = (height: unknown) => JSON.stringify({ type: "MEASURE", details: { height } });
    expect(parseIgMeasure(measure(639))).toBe(639);
    expect(parseIgMeasure(measure(730.4))).toBe(731);
    expect(parseIgMeasure(measure(200))).toBe(200);
    expect(parseIgMeasure(measure(2000))).toBe(2000);
    for (const junk of [
      measure(0),
      measure(199),
      measure(2001),
      measure(-5),
      measure(1e9),
      measure("700"),
      measure(null),
      '{"type":"MEASURE","details":{"height":1e400}}',
      JSON.stringify({ type: "LOADING", details: {} }),
      JSON.stringify({ type: "MOUNTED", details: { styles: [["border", "0"]] } }),
      JSON.stringify({ type: "MEASURE", details: 700 }),
      JSON.stringify({ type: "MEASURE" }),
      JSON.stringify([{ type: "MEASURE", details: { height: 700 } }]),
      { type: "MEASURE", details: { height: 700 } },
      "{not json",
      "",
      `{"type":"MEASURE","details":{"height":700},"pad":"${"x".repeat(30_000)}"}`,
      null,
      undefined,
      700,
    ]) {
      expect(parseIgMeasure(junk), String(junk).slice(0, 60)).toBeUndefined();
    }
  });

  it("reads TikTok's playing state and errors, and ignores its noise", () => {
    const tt = (type: string, value?: unknown) => ({ "x-tiktok-player": true, type, value });
    expect(parseTiktokMessage(tt("onStateChange", 1))).toEqual({ type: "playing" });
    for (const state of [-1, 0, 2, 3, "1"]) {
      expect(parseTiktokMessage(tt("onStateChange", state))).toBeUndefined();
    }
    expect(
      parseTiktokMessage(tt("onPlayerError", { errorCode: 1001, errorType: "INVALID_VIDEO" })),
    ).toEqual({ type: "error", reason: "gone" });
    expect(parseTiktokMessage(tt("onPlayerError", { errorCode: 2001 }))).toEqual({
      type: "error",
      reason: "cantPlay",
    });
    expect(parseTiktokMessage(tt("onPlayerError", { errorCode: 3001 }))).toEqual({
      type: "error",
      reason: "cantPlay",
    });
    expect(parseTiktokMessage(tt("onPlayerError"))).toEqual({ type: "error", reason: "cantPlay" });
    // Autoplay blocked: the video is fine, TikTok's own play button starts it.
    expect(parseTiktokMessage(tt("onPlayerError", { errorCode: 3002 }))).toBeUndefined();
    for (const junk of [
      tt("onPlayerReady"),
      tt("onMute", true),
      tt("onCurrentTime", { currentTime: 3 }),
      { "x-tiktok-player": "true", type: "onStateChange", value: 1 },
      { type: "onStateChange", value: 1 },
      JSON.stringify(tt("onStateChange", 1)),
      "[tea-sdk]ready",
      { signalSource: "x", width: 1, height: 1 },
      null,
      [tt("onStateChange", 1)],
    ]) {
      expect(parseTiktokMessage(junk)).toBeUndefined();
    }
  });

  it("turns a message into what the sheet does, per platform", () => {
    const measure = JSON.stringify({ type: "MEASURE", details: { height: 700 } });
    const playing = { "x-tiktok-player": true, type: "onStateChange", value: 1 };
    expect(readPlayerMessage("ig", measure)).toEqual({ kind: "height", px: 700 });
    expect(readPlayerMessage("tt", playing)).toEqual({ kind: "playing" });
    expect(
      readPlayerMessage("tt", {
        "x-tiktok-player": true,
        type: "onPlayerError",
        value: { errorCode: 1001 },
      }),
    ).toEqual({ kind: "error", reason: "gone" });
    // Each platform reads only its own messages; YouTube's frame is not listened to at all.
    expect(readPlayerMessage("ig", playing)).toBeUndefined();
    expect(readPlayerMessage("tt", measure)).toBeUndefined();
    expect(readPlayerMessage("yt", measure)).toBeUndefined();
    expect(readPlayerMessage("yt", playing)).toBeUndefined();
  });
});
