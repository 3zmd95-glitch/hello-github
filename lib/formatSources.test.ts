import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyFormatSources,
  inspectFormatPreview,
  localInstagramSource,
  sourceKey,
} from "./formatSources";
import { REVIEWED_FORMAT_SEEDS } from "./formatSeeds";
import type { DiscoverAnswer } from "./discover";
import type { InstagramSource } from "./formatVerification";

const format = REVIEWED_FORMAT_SEEDS[0];
const original = format.samples[0].url;
const wrong = "https://www.instagram.com/p/DaX6-f9ox7D/";
const source = (url: string, over: Partial<InstagramSource> = {}): InstagramSource => ({
  status: "available",
  url: sourceKey(url),
  title: "Feeling out place lately",
  description: "Feeling out place lately #filmmaking",
  thumbnailUrl: "https://scontent.cdninstagram.com/thumb.jpg",
  author: "editor",
  observedAt: new Date().toISOString(),
  provenance: "instagram-public-embed",
  audio: { title: "DON ’ T BE DUMB / TRIP BABY", artist: "A$AP Rocky" },
  ...over,
});
const answer = (url = wrong): DiscoverAnswer => ({
  qualityVersion: 7,
  topicKey: "test",
  understood: { label: { en: "test", ar: "تجربة" }, exact: true },
  alternatives: [],
  items: [
    {
      platform: "ig",
      handle: "editor",
      title: "TRIP BABY repeating figures tutorial",
      snippet: "How to create repeating figures with cutout layers",
      url,
      lang: "en",
      section: "tutorial",
    },
  ],
  creators: [
    { platform: "ig", handle: "editor", url: "https://www.instagram.com/editor/", count: 1 },
  ],
  platforms: { ig: { ok: true }, tt: { ok: true }, yt: { ok: true } },
  cost: { tavily: 6, youtubeSearch: 0 },
  cached: true,
  complete: true,
});
const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
afterEach(() => vi.unstubAllGlobals());

describe("format source checks", () => {
  it("rejects a contaminated indexed match when the actual post displays Original audio", () => {
    const raw = answer();
    const checked = applyFormatSources(raw, format, "tutorials", {
      [sourceKey(wrong)]: source(wrong, {
        audio: { title: "Original audio" },
        description: "I decided to make a tutorial",
      }),
    });
    expect(checked.answer.items).toEqual([]);
    expect(checked.answer.creators).toEqual([]);
    expect(checked.excluded[0].reason).toBe("caption");
    expect(checked.answer.cost).toEqual(raw.cost);
    expect(raw.items).toHaveLength(1);
  });
  it("does not let a same-song label replace missing visual evidence in the actual caption", () => {
    const checked = applyFormatSources(answer(), format, "tutorials", {
      [sourceKey(wrong)]: source(wrong),
    });
    expect(checked.answer.items).toHaveLength(0);
    expect(checked.excluded[0].reason).toBe("caption");
  });
  it("retains the reviewed captionless original but never trusts it over contradictory audio", () => {
    const raw = answer(original);
    raw.items[0].section = "example";
    expect(
      applyFormatSources(raw, format, "examples", { [sourceKey(original)]: source(original) })
        .answer.items,
    ).toHaveLength(1);
    expect(
      applyFormatSources(raw, format, "examples", {
        [sourceKey(original)]: source(original, { audio: { title: "Another song" } }),
      }).answer.items,
    ).toHaveLength(0);
  });
  it("retains explicitly unverified leads if Instagram is unavailable, and accepts genuine caption evidence", () => {
    expect(
      applyFormatSources(answer(), format, "tutorials", { [sourceKey(wrong)]: null }).answer.items,
    ).toHaveLength(1);
    expect(
      applyFormatSources(answer(), format, "tutorials", {
        [sourceKey(wrong)]: source(wrong, {
          description: "Tutorial: how to make repeating figures with masks",
        }),
      }).answer.items,
    ).toHaveLength(1);
  });
  it("rescues visual leads whose indexed excerpt omitted the actual song", () => {
    const raw = answer();
    raw.items[0].title = "Repeating figures tutorial";
    const checked = applyFormatSources(raw, format, "tutorials", {
      [sourceKey(wrong)]: source(wrong, {
        description: "Tutorial: how to make repeating figures with masks",
      }),
    });
    expect(checked.answer.items).toHaveLength(1);
    expect(checked.answer.creators[0].count).toBe(1);
  });
  it("never uses the audio label to supply missing visual evidence", () => {
    const freeze = {
      ...format,
      name: { en: "Freeze Frame — frozen cutouts" },
      audio: { title: "Frozen cutouts" },
    };
    const raw = answer();
    raw.items[0].title = "Frozen cutouts tutorial";
    const checked = applyFormatSources(raw, freeze, "tutorials", {
      [sourceKey(wrong)]: source(wrong, {
        description: "Tutorial for editing colors",
        audio: { title: "Frozen cutouts" },
      }),
    });
    expect(checked.answer.items).toHaveLength(0);
  });
  it("only calls a local source endpoint and rejects a reply for another post", async () => {
    vi.stubGlobal("window", { location: { hostname: "example.com" } });
    const fetch = vi.fn(async () => json(source(original)));
    vi.stubGlobal("fetch", fetch);
    expect(await localInstagramSource(wrong)).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    vi.stubGlobal("window", { location: { hostname: "localhost" } });
    expect(await localInstagramSource(wrong)).toBeNull();
    expect(await localInstagramSource(original)).toEqual(
      source(original, { observedAt: expect.any(String) }),
    );
  });
  it("sends an explicit model and frame mode; never substitutes an unexpected returned model", async () => {
    vi.stubGlobal("window", { location: { hostname: "localhost" } });
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      json({ provider: "chatgpt", model: "different", verification: {} }),
    );
    vi.stubGlobal("fetch", fetch);
    const result = await inspectFormatPreview(
      { provider: "chatgpt", model: "chosen", effort: "high" },
      format,
      original,
      "ar",
    );
    expect(result.ok).toBe(false);
    const body = JSON.parse(fetch.mock.calls[0][1]!.body as string);
    expect(body).toMatchObject({
      provider: "chatgpt",
      model: "chosen",
      effort: "high",
      mode: "frames",
      lang: "ar",
    });
    expect(body.format.samples).toBeUndefined();
  });
});
