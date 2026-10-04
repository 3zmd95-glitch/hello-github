import { describe, expect, it } from "vitest";
import raw from "../../../../planning/data/edit-terms.json";
import { matchTerms, normalizeTerm, parseTerms, TERMS } from "./terms";

const bestId = (q: string) => matchTerms(q).best?.id;

describe("the bundled dictionary", () => {
  it("is well formed: every entry parses and ids are unique", () => {
    expect(TERMS.length).toBe((raw as unknown[]).length);
    expect(new Set(TERMS.map((t) => t.id)).size).toBe(TERMS.length);
  });

  it("covers the golden-test topics", () => {
    expect(bestId("flash")).toBe("flash-transition");
    expect(bestId("matchcut")).toBe("match-cut");
    expect(bestId("speed ramp")).toBe("speed-ramp");
    expect(bestId("color grading")).toBe("color-grading");
    expect(bestId("velocity edit")).toBe("velocity");
    expect(bestId("mask transition")).toBe("mask-transition");
    expect(bestId("whip pan")).toBe("whip-pan");
    expect(bestId("تلوين سينمائي")).toBe("color-grading");
    expect(bestId("شرح سبيد رامب")).toBe("speed-ramp");
    expect(bestId("film look")).toBe("film-look");
  });

  it("finds every entry from its own labels", () => {
    for (const t of TERMS) {
      expect(bestId(t.label.en), t.label.en).toBe(t.id);
      expect(bestId(t.label.ar), t.label.ar).toBe(t.id);
    }
  });
});

describe("parseTerms", () => {
  const good = {
    id: "x-cut",
    kind: "transition",
    label: { en: "x cut", ar: "اكس كت" },
    match: { en: ["x cut"], ar: [] },
    specific: true,
    queries: {
      examples: { en: "x cut edit", ar: "ايديت اكس كت" },
      tutorials: { en: "x cut tutorial", ar: "شرح اكس كت" },
    },
  };

  it("keeps good entries and drops malformed or duplicate ones", () => {
    const out = parseTerms([
      good,
      { ...good },
      { ...good, id: "Bad Id" },
      { ...good, id: "no-match", match: { en: [], ar: [] } },
      { ...good, id: "no-match-ar", match: { en: ["x cut"] } },
      { ...good, id: "bad-synonym", match: { en: ["x cut", 3], ar: [] } },
      { ...good, id: "bad-kind", kind: "nope" },
      { ...good, id: "no-label", label: undefined },
      { ...good, id: "bad-specific", specific: "yes" },
      {
        ...good,
        id: "no-query",
        queries: { examples: { en: "", ar: "x" }, tutorials: good.queries.tutorials },
      },
      "not an object",
    ]);
    expect(out.map((t) => t.id)).toEqual(["x-cut"]);
  });

  it("keeps generic only when it is a boolean", () => {
    const [a, b] = parseTerms([
      { ...good, generic: true },
      { ...good, id: "y-cut", generic: "yes" },
    ]);
    expect(a.generic).toBe(true);
    expect(b).not.toHaveProperty("generic");
  });

  it("returns [] for a file that is not a list", () => {
    expect(parseTerms({})).toEqual([]);
  });
});

describe("normalizeTerm", () => {
  it("folds ة, a leading ال and plurals, word by word", () => {
    expect(normalizeTerm("التلوين السينمائي")).toBe("تلوين سينمائي");
    expect(normalizeTerm("تقسيم الشاشة")).toBe("تقسيم شاشه");
    expect(normalizeTerm("اللوتات")).toBe("لوت");
    expect(normalizeTerm("Glitch Transitions!")).toBe("glitch transition");
  });

  it("keeps other short words, a double s and a bare ال while matching known short plurals", () => {
    expect(normalizeTerm("luts cuts glass cars gyms ads")).toBe("luts cut glass car gym ad");
    expect(normalizeTerm("ال كت")).toBe("ال كت");
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

  it("lets a named entry beat the generic catch-all, plurals included", () => {
    expect(bestId("glitch transitions")).toBe("glitch");
    expect(bestId("whip pan transitions")).toBe("whip-pan");
    expect(bestId("film burn transitions")).toBe("film-burn");
    expect(bestId("hidden cut transitions")).toBe("invisible-cut");
    expect(bestId("zoom transitions")).toBe("zoom-transition");
    expect(bestId("انتقالات زوم")).toBe("zoom-transition");
    expect(bestId("انتقالات فلاش")).toBe("flash-transition");
    expect(matchTerms("glitch transitions").others.map((t) => t.id)).toEqual(["smooth-transition"]);
  });

  it("picks the generic catch-all when nothing else matched", () => {
    expect(bestId("transitions")).toBe("smooth-transition");
    expect(bestId("smooth transitions")).toBe("smooth-transition");
  });

  it("reads Hijazi spellings, the article and Arabic plurals", () => {
    expect(bestId("شرح التلوين")).toBe("color-grading");
    expect(bestId("التلوين السينمائي")).toBe("color-grading");
    expect(bestId("الكروما")).toBe("chroma-key");
    expect(bestId("تقسيم الشاشه")).toBe("split-screen");
    expect(bestId("حركه بطيئه")).toBe("smooth-slowmo");
    const m = matchTerms("طريقة الفلاش");
    expect(m.best?.id).toBe("flash-transition");
    expect(m.rest).toEqual([]);
  });

  it("keeps the words that are not the term or an intent word", () => {
    expect(matchTerms("speed ramp cars tutorial").rest).toEqual(["cars"]);
    expect(matchTerms("شرح سبيد رامب").rest).toEqual([]);
  });

  it("drops filler words from the topic", () => {
    expect(matchTerms("speed ramp for cars").rest).toEqual(["cars"]);
    expect(matchTerms("ابغى شرح فلاش").rest).toEqual([]);
  });

  it("returns the leftover words as typed, not in matching form", () => {
    expect(matchTerms("سبيد رامب السيارات").rest).toEqual(["السيارات"]);
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
