import { describe, expect, it, vi } from "vitest";
import { lookupInstagramSource, readInstagramSource } from "./instagramSource";

const POST = "https://www.instagram.com/p/DdP6LgrT_aD/";
const IMAGE = "https://scontent.cdninstagram.com/post.jpg?a=1&b=2";
const html = (body: string) =>
  new Response(body, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
const embed = (
  id = "DdP6LgrT_aD",
  caption = "Feeling out place lately #fyp #filmmaking #cinematic",
  audio = "A$AP Rocky · DON&#39;T BE DUMB / TRIP BABY",
) =>
  `<html><body><div class="Embed"><div class="Header"><a class="Username" href="https://www.instagram.com/jayp.zip/">jayp.zip</a><div class="HeaderSecondaryContent"><span>${audio}</span></div></div><div class="Content"><a class="EmbeddedMedia" href="https://www.instagram.com/reel/${id}/?utm_source=ig_embed"><img class="EmbeddedMediaImage" src="${IMAGE.replace("&", "&amp;")}"></a></div><div class="Caption"><a class="CaptionUsername" href="https://www.instagram.com/jayp.zip/">jayp.zip</a>${caption}<a class="CaptionCommentsExpand">View all comments</a></div></div><script>ignored application payload</script></body></html>`;

describe("authentic Instagram public source metadata", () => {
  it("keeps the captionless-format user reference unknown visually while retaining its actual soundtrack", async () => {
    const result = await readInstagramSource(html(embed()), POST);
    expect(result).toEqual({
      status: "available",
      url: POST,
      title: "Feeling out place lately #fyp #filmmaking #cinematic",
      description: "Feeling out place lately #fyp #filmmaking #cinematic",
      thumbnailUrl: IMAGE,
      author: "jayp.zip",
      observedAt: expect.any(String),
      provenance: "instagram-public-embed",
      audio: { title: "DON'T BE DUMB / TRIP BABY", artist: "A$AP Rocky" },
    });
    expect(result.description).not.toMatch(/clon|repeat|trip baby/i);
    expect(result).not.toHaveProperty("visualPattern");
  });

  it("does not import contaminated indexed claims into the DaX6-f9ox7D source caption", async () => {
    const caption =
      "A lot of you liked this one yesterday so had get the tutorial bumped to the top of the list 🤝 I really underestimated how difficult it is to narrate while I’m editing 🙃 Anyway, another day, another tutorial, hope you enjoy!";
    const result = await readInstagramSource(
      html(embed("DaX6-f9ox7D", caption, "Original audio")),
      "https://www.instagram.com/p/DaX6-f9ox7D/",
    );
    expect(result.status).toBe("available");
    expect(result.description).toBe(caption);
    expect(result.audio).toEqual({ title: "Original audio" });
    expect(result.description).not.toMatch(/trip baby|repeating figures|freeze|mask/i);
  });

  it("requires the exact source post binding, rather than a caption or thumbnail alone", async () => {
    for (const markup of [
      embed("OTHER"),
      embed().replace('class="EmbeddedMedia"', 'class="UnrelatedMedia"'),
      embed().replace(
        `https://www.instagram.com/reel/DdP6LgrT_aD/`,
        "https://attacker.test/reel/DdP6LgrT_aD/",
      ),
      embed().replace('class="Embed"', 'class="Unrelated"'),
      "<html><body>Log in</body></html>",
    ]) {
      const result = await readInstagramSource(html(markup), POST);
      expect(result.status).toBe("unavailable");
      expect(result.observedAt).toBeNull();
      expect(result.description).toBe("");
      expect(result.audio).toBeUndefined();
    }
  });

  it("ignores scripts, comments, hidden content, and unrelated profile images", async () => {
    const injected = embed(
      "DdP6LgrT_aD",
      'Real <script>TRIP BABY cloned scene</script><!-- fake --><span hidden>fake</span><span aria-hidden="true">fake</span><span style="display: none">fake</span><template>fake</template>caption',
    ).replace(
      '<div class="Content">',
      '<img src="https://scontent.cdninstagram.com/avatar.jpg"><div class="Content">',
    );
    const result = await readInstagramSource(html(injected), POST);
    expect(result.description).toBe("Real caption");
    expect(result.thumbnailUrl).toBe(IMAGE);
  });

  it("keeps literal caption text and audio entities split across response chunks", async () => {
    const markup = embed();
    const bytes = new TextEncoder().encode(markup);
    const cancel = vi.fn();
    let offset = 0;
    const stream = new ReadableStream({
      pull(controller) {
        controller.enqueue(bytes.subarray(offset, offset + 7));
        offset += 7;
      },
      cancel,
    });
    const result = await readInstagramSource(
      new Response(stream, {
        headers: { "Content-Type": "text/html" },
      }),
      POST,
    );
    expect(result.audio?.title).toBe("DON'T BE DUMB / TRIP BABY");
    expect(result.description).toContain("#cinematic");
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("reads only bounded complete embed markup and cancels the rest", async () => {
    const result = await readInstagramSource(html(" ".repeat(384 * 1024) + embed()), POST);
    expect(result.status).toBe("unavailable");
    expect((await readInstagramSource(html(embed().slice(0, 250)), POST)).status).toBe(
      "unavailable",
    );
    const longCaption = await readInstagramSource(
      html(embed("DdP6LgrT_aD", "a<br>".repeat(5000))),
      POST,
    );
    expect(longCaption.description.length).toBeLessThanOrEqual(4000);
  });

  it("allows only source-bound images and safe actual music links", async () => {
    const music =
      '<a href="https://www.instagram.com/reels/audio/123456/?ref=embed">Original audio</a>';
    const result = await readInstagramSource(html(embed("DdP6LgrT_aD", "caption", music)), POST);
    expect(result.audio).toEqual({
      title: "Original audio",
      url: "https://www.instagram.com/reels/audio/123456/",
    });
    for (const bad of [
      "http://scontent.cdninstagram.com",
      "https://scontent.cdninstagram.com.attacker.test",
      "https://user:pass@scontent.cdninstagram.com",
      "https://scontent.cdninstagram.com:8080",
    ]) {
      expect(
        (
          await readInstagramSource(
            html(embed().replace("https://scontent.cdninstagram.com", bad)),
            POST,
          )
        ).thumbnailUrl,
      ).toBe("");
    }
    const spoofed = music.replace("www.instagram.com", "attacker.test");
    expect(
      (await readInstagramSource(html(embed("DdP6LgrT_aD", "caption", spoofed)), POST)).audio?.url,
    ).toBeUndefined();
  });

  it("fetches a fixed public URL without redirects, cookies, or incoming credentials", async () => {
    const doFetch = vi.fn<typeof fetch>(async () => html(embed()));
    const result = await lookupInstagramSource(
      "https://instagram.com/jayp.zip/reel/DdP6LgrT_aD/?token=ignored",
      doFetch,
    );
    expect(result.status).toBe("available");
    expect(doFetch).toHaveBeenCalledExactlyOnceWith(`${POST}embed/captioned/`, {
      headers: { Accept: "text/html", "User-Agent": "3z-Scout/1.0 (public link previews)" },
      redirect: "manual",
      signal: expect.any(AbortSignal),
    });
    await lookupInstagramSource("https://attacker.test/p/DdP6LgrT_aD/", doFetch);
    expect(doFetch).toHaveBeenCalledOnce();
  });

  it("fails closed for redirects, JSON, network failures, and cancelled requests", async () => {
    for (const response of [
      new Response(null, { status: 302 }),
      new Response("{}", { headers: { "Content-Type": "application/json" } }),
    ]) {
      expect((await lookupInstagramSource(POST, async () => response)).status).toBe("unavailable");
    }
    expect(
      (
        await lookupInstagramSource(POST, async () => {
          throw new Error("blocked");
        })
      ).status,
    ).toBe("unavailable");
    const doFetch = vi.fn<typeof fetch>();
    expect((await lookupInstagramSource(POST, doFetch, AbortSignal.abort())).status).toBe(
      "unavailable",
    );
    expect(doFetch).not.toHaveBeenCalled();
  });

  it("bounds stalled requests and propagates caller cancellation to fetch", async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const doFetch = vi.fn<typeof fetch>(() => new Promise(() => {}));
      const pending = lookupInstagramSource(POST, doFetch, controller.signal);
      controller.abort();
      expect(doFetch.mock.calls[0][1]?.signal?.aborted).toBe(true);
      await vi.advanceTimersByTimeAsync(5000);
      expect((await pending).status).toBe("unavailable");
    } finally {
      vi.useRealTimers();
    }
  });
});
