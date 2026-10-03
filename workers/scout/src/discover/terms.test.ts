import { describe, expect, it } from "vitest";
import raw from "../../../../planning/data/edit-terms.json";
import { matchTerms, parseTerms, TERMS } from "./terms";

describe("the bundled dictionary", () => {
  it("is well formed: every entry parses and ids are unique", () => {
    expect(TERMS.length).toBe((raw as unknown[]).length);
    expect(new Set(TERMS.map((t) => t.id)).size).toBe(TERMS.length);
  });

  it("covers the golden-test topics", () => {
    const ids = (q: string) => matchTerms(q).best?.id;
    expect(ids("flash")).toBe("flash-transition");
    expect(ids("matchcut")).toBe("match-cut");
    expect(ids("speed ramp")).toBe("speed-ramp");
    expect(ids("color grading")).toBe("color-grading");
    expect(ids("velocity edit")).toBe("velocity");
    expect(ids("mask transition")).toBe("mask-transition");
    expect(ids("whip pan")).toBe("whip-pan");
    expect(ids("تلوين سينمائي")).toBe("color-grading");
    expect(ids("شرح سبيد رامب")).toBe("speed-ramp");
    expect(ids("film look")).toBe("film-look");
  });
});

describe("parseTerms", () => {
  const good = {
    id: "x-cut",
    kind: "transition",
    label: { en: "x cut", ar: "اكس كت" },
    match: { en: ["x cut"], ar: [] },
    specific: true,
    queries: { examples: { en: "x cut edit", ar: "ايديت اكس كت" }, tutorials: { en: "x cut tutorial", ar: "شرح اكس كت" } },
  };

  it("keeps good entries and drops malformed or duplicate ones", () => {
    const out = parseTerms([
      good,
      { ...good },
      { ...good, id: "Bad Id" },
      { ...good, id: "no-match", match: { en: [], ar: [] } },
      { ...good, id: "bad-kind", kind: "nope" },
      { ...good, id: "no-query", queries: { examples: { en: "", ar: "x" }, tutorials: good.queries.tutorials } },
      "not an object",
    ]);
    expect(out.map((t) => t.id)).toEqual(["x-cut"]);
  });

  it("returns [] for a file that is not a list", () => {
    expect(parseTerms({})).toEqual([]);
  });
});

describe("matchTerms", () => {
  it("picks the longest match and lists the other meanings", () => {
    const m = matchTerms("flash");
    expect(m.best?.id).toBe("flash-transition");
    expect(m.others.map((t) => t.id)).toEqual(["camera-flash"]);
    expect(m.rest).toEqual([]);
  });

  it("prefers a longer synonym over an earlier entry", () => {
    expect(matchTerms("camera flash").best?.id).toBe("camera-flash");
  });

  it("ignores case, punctuation and Arabic letter forms", () => {
    expect(matchTerms("FLASH!").best?.id).toBe("flash-transition");
    expect(matchTerms("تصحيح الألوان").best?.id).toBe("color-grading");
  });

  it("keeps the words that are not the term or an intent word", () => {
    expect(matchTerms("speed ramp cars tutorial").rest).toEqual(["cars"]);
    expect(matchTerms("شرح سبيد رامب").rest).toEqual([]);
  });

  it("matches whole words only", () => {
    expect(matchTerms("flashlight").best).toBeUndefined();
  });

  it("returns the topic words for an unknown topic", () => {
    const m = matchTerms("Bokeh balls tutorial");
    expect(m.best).toBeUndefined();
    expect(m.others).toEqual([]);
    expect(m.rest).toEqual(["bokeh", "balls"]);
  });

  it("keeps an intent-only query as its own words", () => {
    expect(matchTerms("tutorial").rest).toEqual(["tutorial"]);
  });
});
