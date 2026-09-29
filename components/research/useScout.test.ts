import { describe, expect, it } from "vitest";
import { groupErrors, scoutParams, settledFor, unionCount } from "./useScout";

const card = (url: string) => ({ url });

describe("scoutParams", () => {
  it("asks 10 results of one platform per request", () => {
    expect(scoutParams(" match cut ", ["tt"], "ar", "week")).toEqual({
      q: "match cut",
      platforms: ["tt"],
      lang: "ar",
      max: 10,
      timeRange: "week",
      thumbs: true,
    });
  });
  it("is off without a query or platforms", () => {
    expect(scoutParams("  ", ["tt"], "ar")).toBeNull();
    expect(scoutParams("x", null, "ar")).toBeNull();
    expect(scoutParams("x", [], "ar")).toBeNull();
  });
});

describe("settledFor", () => {
  const ok = { key: "k", attempt: 1, status: "ok" as const };
  const err = { key: "k", attempt: 1, status: "error" as const };
  it("keeps a success for the same request on any attempt (Search again costs nothing)", () => {
    expect(settledFor(ok, "k", 1)).toBe(true);
    expect(settledFor(ok, "k", 2)).toBe(true);
  });
  it("drops an error once Search is pressed again, so the retry shows loading", () => {
    expect(settledFor(err, "k", 1)).toBe(true);
    expect(settledFor(err, "k", 2)).toBe(false);
  });
  it("never answers another request", () => {
    expect(settledFor(ok, "other", 1)).toBe(false);
    expect(settledFor(null, "k", 0)).toBe(false);
  });
});

describe("unionCount (the All tab's badge)", () => {
  it("counts distinct posts across the platforms", () => {
    expect(
      unionCount([
        [card("https://www.youtube.com/watch?v=a")],
        [card("https://www.tiktok.com/@a/video/1"), card("https://www.tiktok.com/@a/video/2")],
        [],
      ]),
    ).toBe(3);
  });
  it("counts the same post once", () => {
    const u = "https://www.instagram.com/p/abc";
    expect(unionCount([[card(u)], [card(u)]])).toBe(1);
  });
  it("shows no badge while any platform is unknown (never a partial count)", () => {
    expect(unionCount([[card("https://a.test/1")], undefined])).toBeUndefined();
    expect(unionCount([])).toBeUndefined();
  });
  it("counts a failed platform as empty, and shows nothing when every one failed", () => {
    expect(unionCount([[card("https://a.test/1")], "error"])).toBe(1);
    expect(unionCount(["error", "error"])).toBeUndefined();
  });
});

describe("groupErrors", () => {
  it("says the same failure once, naming every platform it hit, in order", () => {
    const auth = { type: "auth" as const, status: 401 };
    const up = { type: "upstream" as const, status: 503 };
    expect(
      groupErrors([
        { platform: "tt", error: auth },
        { platform: "ig", error: up },
        { platform: "yt", error: auth },
      ]),
    ).toEqual([
      { error: auth, platforms: ["tt", "yt"] },
      { error: up, platforms: ["ig"] },
    ]);
    expect(groupErrors([])).toEqual([]);
  });
});
