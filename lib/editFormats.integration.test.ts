import { describe, expect, it, vi } from "vitest";
import { parseEditFormats } from "./editFormats";

// This cross-package contract belongs to the app suite, whose config resolves app aliases.
// The Worker suite independently asserts the exact carried and refreshed snapshots.
describe("Worker format responses at the client boundary", () => {
  it.each([
    ["fails", null],
    ["omits the format", []],
  ] as const)(
    "keeps prior evidence readable when AI %s after a matching source check",
    async (_, formats) => {
      const { discoverFormats } = await vi.importActual<{
        discoverFormats: (
          env: unknown,
          previous: unknown,
          posts: unknown[],
          now: Date,
          timeoutMs: number,
          doFetch: typeof fetch,
        ) => Promise<{ formats?: unknown[] }>;
      }>("../workers/scout/src/effects/formats");
      const pattern = "multiple frozen clones appear on each beat";
      const candidate = {
        name: { en: "Night Drive clone montage" },
        visualPattern: { en: pattern },
        audio: { title: "Night Drive", artist: "Artist One" },
        observations: [{ postId: "p0", patternQuote: pattern, audioQuote: "Night Drive" }],
      };
      const ai = (answer: unknown[] | null) => ({
        AI: { run: async () => (answer === null ? null : { response: { formats: answer } }) },
      });
      const posts = [
        {
          platform: "ig",
          handle: "creator",
          title: "My latest edit",
          snippet: `${pattern}; Night Drive by Artist One`,
          url: "https://www.instagram.com/reel/SOURCE1/",
          published: "2026-10-06T12:00:00.000Z",
        },
      ];
      const firstAt = new Date("2026-10-07T12:00:00.000Z");
      const nextAt = new Date("2026-10-08T12:00:00.000Z");
      const earlier = await discoverFormats(
        ai([candidate]),
        null,
        posts,
        firstAt,
        30_000,
        vi.fn<typeof fetch>(async () => new Response("", { status: 403 })),
      );
      const source = vi.fn<typeof fetch>(
        async () =>
          new Response(
            '<div class="Embed"><a class="Username" href="https://www.instagram.com/sourcecreator/">sourcecreator</a>' +
              '<div class="HeaderSecondaryContent">Artist One · Night Drive</div>' +
              '<a class="EmbeddedMedia" href="https://www.instagram.com/p/SOURCE1/"></a>' +
              `<div class="Caption">${pattern}</div></div>`,
            { headers: { "Content-Type": "text/html" } },
          ),
      );
      const later = await discoverFormats(
        ai(formats === null ? null : [...formats]),
        earlier,
        posts,
        nextAt,
        30_000,
        source,
      );
      expect(source).toHaveBeenCalledTimes(1);
      expect(later.formats).toEqual(earlier.formats);
      const retained = parseEditFormats(later.formats, nextAt.getTime());
      expect(retained).toHaveLength(1);
      expect(retained[0].lastChecked).toBe(firstAt.toISOString());
      expect(retained[0].samples[0]).toMatchObject({
        observedAt: firstAt.toISOString(),
        handle: "creator",
      });
      expect(retained[0].samples[0]).not.toHaveProperty("captionSource");

      const accepted = await discoverFormats(ai([candidate]), later, posts, nextAt, 30_000, source);
      const refreshed = parseEditFormats(accepted.formats, nextAt.getTime());
      expect(refreshed).toHaveLength(1);
      expect(refreshed[0].lastChecked).toBe(nextAt.toISOString());
      expect(refreshed[0].samples[0]).toMatchObject({
        observedAt: nextAt.toISOString(),
        handle: "sourcecreator",
        captionSource: "instagram-public-embed",
      });
    },
  );
});
