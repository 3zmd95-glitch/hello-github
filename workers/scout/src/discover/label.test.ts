import { describe, expect, it } from "vitest";
import type { ScoutResult } from "../normalize";
import { creatorsOf, labelCards } from "./label";
import { planSearch } from "./plan";
import type { PlannedQuery } from "./types";

const plan = planSearch({ q: "flash" });
const query = (id: string): PlannedQuery => plan.queries.find((q) => q.id === id)!;
let n = 0;
const card = (over: Partial<ScoutResult>): ScoutResult => ({
  platform: "tt",
  handle: "@a",
  title: "",
  snippet: "",
  url: `https://www.tiktok.com/@a/video/${++n}`,
  ...over,
});

describe("labelCards", () => {
  it("files tutorials by their words and the rest by their query", () => {
    const items = labelCards(
      [
        {
          card: card({ title: "How to do the flash transition in CapCut" }),
          query: query("tt-examples-en"),
        },
        { card: card({ title: "My flash transition edit" }), query: query("tt-tutorials-en") },
        { card: card({ title: "flash effect edit 🔥" }), query: query("tt-examples-en") },
      ],
      plan,
    );
    expect(items.map((i) => i.section)).toEqual(["tutorial", "tutorial", "example"]);
  });

  it("marks cards that are not about the effect as off-topic", () => {
    const items = labelCards(
      [
        {
          card: card({ title: "WATCHING THE FLASH FOR THE FIRST TIME" }),
          query: query("tt-examples-en"),
        },
        { card: card({ title: "Bike ride vlog" }), query: query("tt-examples-en") },
        { card: card({ title: "شرح تأثير فلاش في كاب كت" }), query: query("tt-tutorials-ar") },
      ],
      plan,
    );
    expect(items.map((i) => i.offTopic ?? false)).toEqual([true, true, false]);
    expect(items[2].lang).toBe("ar");
  });

  it("reads an Arabic card in the matching form (ال, ه for ة)", () => {
    // "flash" is not specific: the card also needs an editing word, here with ال too.
    const [item] = labelCards(
      [
        {
          card: card({ title: "شرح الفلاش بطريقه سهله في المونتاج" }),
          query: query("tt-examples-en"),
        },
      ],
      plan,
    );
    expect(item.section).toBe("tutorial");
    expect(item.offTopic).toBeUndefined();
  });

  it("counts a plural editing word", () => {
    const glitch = planSearch({ q: "glitch" });
    const [item] = labelCards(
      [{ card: card({ title: "glitch transitions pack" }), query: glitch.queries[0] }],
      glitch,
    );
    expect(item.offTopic).toBeUndefined();
  });

  it("hides nothing on an exact search and keeps the first copy of a post", () => {
    const exact = planSearch({ q: "flash", exact: true });
    const c = card({ title: "The Flash" });
    const items = labelCards(
      [
        { card: c, query: exact.queries[0] },
        { card: { ...c }, query: exact.queries[0] },
      ],
      exact,
    );
    expect(items).toHaveLength(1);
    expect(items[0].offTopic).toBeUndefined();
  });
});

describe("creatorsOf", () => {
  it("ranks accounts by on-topic cards, then views, and adds profile pages last", () => {
    const items = labelCards(
      [
        {
          card: card({ handle: "@b", title: "flash transition edit" }),
          query: query("tt-examples-en"),
        },
        {
          card: card({ handle: "@a", title: "flash transition edit" }),
          query: query("tt-examples-en"),
        },
        {
          card: card({ handle: "@a", title: "flash transition tutorial" }),
          query: query("tt-tutorials-en"),
        },
        { card: card({ handle: "@c", title: "The Flash" }), query: query("tt-examples-en") },
        {
          card: {
            ...card({
              platform: "yt",
              handle: "Cinecom",
              title: "flash transition tutorial",
              stats: { views: 900 },
            }),
            profile: "https://www.youtube.com/channel/UC1",
          },
          query: query("yt-tutorials-en"),
        },
        {
          card: card({ platform: "ig", handle: "", title: "flash transition edit" }),
          query: query("ig-examples-en"),
        },
      ],
      plan,
    );
    const creators = creatorsOf(items, [
      { platform: "tt", handle: "@a", url: "https://www.tiktok.com/@a" },
      { platform: "ig", handle: "@zenko.edit", url: "https://www.instagram.com/zenko.edit/" },
    ]);
    expect(creators).toEqual([
      { platform: "tt", handle: "@a", url: "https://www.tiktok.com/@a", count: 2 },
      {
        platform: "yt",
        handle: "Cinecom",
        url: "https://www.youtube.com/channel/UC1",
        count: 1,
        views: 900,
      },
      { platform: "tt", handle: "@b", url: "https://www.tiktok.com/@b", count: 1 },
      {
        platform: "ig",
        handle: "@zenko.edit",
        url: "https://www.instagram.com/zenko.edit/",
        count: 0,
      },
    ]);
  });
});
