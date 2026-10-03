import { describe, expect, it } from "vitest";
import { MAX_PICKS, PICKS_KEY, pickFromInput, readPicks, savePicks, topicKeyOf } from "./picks";
import { planSearch } from "./plan";

const NOW = new Date("2026-10-03T09:00:00Z");
function fakeKV() {
  const store = new Map<string, string>();
  return {
    store,
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
  } as unknown as KVNamespace & { store: Map<string, string> };
}

describe("pickFromInput", () => {
  it("keeps one post per pick, canonical, and refuses anything else", () => {
    expect(
      pickFromInput(
        {
          url: "https://www.instagram.com/zenko.edit/reel/ABC/?igsh=x",
          title: " Flash ",
          label: "example",
          note: "clean cut",
        },
        "t",
      ),
    ).toEqual({
      url: "https://www.instagram.com/p/ABC",
      platform: "ig",
      title: "Flash",
      label: "example",
      note: "clean cut",
      savedAt: "t",
    });
    expect(
      pickFromInput({ url: "https://www.tiktok.com/@a", title: "x", label: "example" }, "t"),
    ).toBeNull();
    expect(
      pickFromInput({ url: "http://www.tiktok.com/@a/video/1", title: "x", label: "example" }, "t"),
    ).toBeNull();
    expect(
      pickFromInput({ url: "https://evil.example/video/1", title: "x", label: "example" }, "t"),
    ).toBeNull();
    expect(
      pickFromInput(
        { url: "https://www.youtube.com/watch?v=abc", title: " ", label: "tutorial" },
        "t",
      ),
    ).toBeNull();
  });

  it("gives a YouTube pick its picture from the video id, and a TikTok pick none", () => {
    expect(
      pickFromInput({ url: "https://youtu.be/abc?si=x", title: "x", label: "tutorial" }, "t"),
    ).toEqual({
      url: "https://www.youtube.com/watch?v=abc",
      platform: "yt",
      title: "x",
      thumb: "https://i.ytimg.com/vi/abc/hqdefault.jpg",
      label: "tutorial",
      savedAt: "t",
    });
    expect(
      pickFromInput(
        { url: "https://www.tiktok.com/@a/video/1", title: "x", label: "example" },
        "t",
      ),
    ).not.toHaveProperty("thumb");
  });
});

describe("topicKeyOf", () => {
  it("is the key of the dashboard's search and of Claude's own queries for the topic", () => {
    const mine = [
      { q: "x", platform: "tt" as const, lang: "en" as const, intent: "examples" as const },
    ];
    for (const [topic, key] of [
      ["flash", "flash-transition"],
      ["bokeh balls", "bokeh ball"],
      ["الترجمة", "captions"],
      ["الطبيعة", "طبيعه"],
    ]) {
      expect(
        [
          topicKeyOf(topic),
          planSearch({ q: topic }).topicKey,
          planSearch({ q: topic, queries: mine }).topicKey,
        ],
        topic,
      ).toEqual([key, key, key]);
    }
  });
});

describe("savePicks / readPicks", () => {
  it("saves under the dictionary key, merges without duplicates, and reads newest first", async () => {
    const env = { SOCIAL_KV: fakeKV() };
    expect(topicKeyOf("Flash")).toBe("flash-transition");
    const one = {
      url: "https://www.tiktok.com/@a/video/1",
      title: "one",
      label: "example" as const,
    };
    const two = {
      url: "https://www.youtube.com/watch?v=abc",
      title: "two",
      label: "tutorial" as const,
    };
    expect(await savePicks(env, "flash", [one, { ...one, url: "nope" }], false, NOW)).toEqual({
      topicKey: "flash-transition",
      saved: 1,
      rejected: 1,
    });
    await savePicks(env, "Flash transition", [two, one], false, new Date("2026-10-03T10:00:00Z"));
    await savePicks(env, "speed ramp", [two], false, new Date("2026-10-03T11:00:00Z"));
    const all = await readPicks(env);
    expect(all.map((t) => t.topicKey)).toEqual(["speed-ramp", "flash-transition"]);
    expect(all[1].items.map((i) => i.title)).toEqual(["two", "one"]);
    expect((await readPicks(env, "flash")).map((t) => t.topicKey)).toEqual(["flash-transition"]);
    expect(JSON.parse(env.SOCIAL_KV.store.get(PICKS_KEY)!)["speed-ramp"].topic).toBe("speed ramp");
  });

  it("replaces when asked and caps the list", async () => {
    const env = { SOCIAL_KV: fakeKV() };
    const many = Array.from({ length: MAX_PICKS + 5 }, (_, i) => ({
      url: `https://www.tiktok.com/@a/video/${i + 1}`,
      title: `t${i}`,
      label: "example" as const,
    }));
    await savePicks(env, "flash", many, false, NOW);
    expect((await readPicks(env, "flash"))[0].items).toHaveLength(MAX_PICKS);
    await savePicks(env, "flash", many.slice(0, 1), true, NOW);
    expect((await readPicks(env, "flash"))[0].items).toHaveLength(1);
  });

  it("reads nothing without KV", async () => {
    expect(await readPicks({})).toEqual([]);
  });

  it("never writes over picks it could not read", async () => {
    const kv = fakeKV();
    const pick = {
      url: "https://www.tiktok.com/@a/video/1",
      title: "x",
      label: "example" as const,
    };
    await savePicks({ SOCIAL_KV: kv }, "speed ramp", [pick], false, NOW);
    const saved = kv.store.get(PICKS_KEY);
    const down = {
      ...kv,
      async get() {
        throw new Error("KV GET failed");
      },
    } as unknown as KVNamespace;
    await expect(savePicks({ SOCIAL_KV: down }, "flash", [pick], false, NOW)).rejects.toThrow();
    expect(kv.store.get(PICKS_KEY)).toBe(saved);
    // Reading shows nothing rather than failing the screen.
    expect(await readPicks({ SOCIAL_KV: down })).toEqual([]);
  });
});
