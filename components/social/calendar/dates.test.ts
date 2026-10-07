import { describe, expect, it } from "vitest";
import { parseCalendarHash, postHash } from "./dates";

describe("parseCalendarHash", () => {
  it("reads a post, a valid day, both together, and #new", () => {
    expect(parseCalendarHash("#post=p1")).toEqual({ post: "p1", day: null, newPost: false });
    expect(parseCalendarHash("#day=2026-10-07")).toEqual({
      post: null,
      day: "2026-10-07",
      newPost: false,
    });
    expect(parseCalendarHash("#post=p1&day=2026-10-07")).toMatchObject({
      post: "p1",
      day: "2026-10-07",
    });
    expect(parseCalendarHash("#new")).toEqual({ post: null, day: null, newPost: true });
  });

  it("ignores an empty hash, an empty post and a malformed day", () => {
    expect(parseCalendarHash("")).toEqual({ post: null, day: null, newPost: false });
    expect(parseCalendarHash("#post=&day=7-10-2026")).toEqual({
      post: null,
      day: null,
      newPost: false,
    });
    expect(parseCalendarHash("#newer").newPost).toBe(false);
  });

  it("round-trips an id through postHash", () => {
    expect(parseCalendarHash(postHash("a b&c")).post).toBe("a b&c");
  });
});
