import { describe, expect, it } from "vitest";
import { planSearch } from "./plan";
import type { EditTerm, LangText } from "./terms";

const byId = (plan: ReturnType<typeof planSearch>) =>
  Object.fromEntries(plan.queries.map((q) => [q.id, q]));

describe("planSearch with a dictionary term", () => {
  const plan = planSearch({ q: "flash" });

  it("understands the term and offers the other meaning and the exact search", () => {
    expect(plan.termId).toBe("flash-transition");
    expect(plan.topicKey).toBe("flash-transition");
    expect(plan.understood).toEqual({
      termId: "flash-transition",
      label: { en: "flash transition", ar: "انتقال فلاش" },
      exact: false,
    });
    expect(plan.alternatives).toEqual([
      { termId: "camera-flash", label: { en: "camera flash photography", ar: "تصوير بالفلاش" } },
      { exact: true },
    ]);
  });

  it("asks 3 queries per platform: examples en, tutorials en, tutorials ar", () => {
    const q = byId(plan);
    expect(plan.queries).toHaveLength(9);
    expect(q["tt-examples-en"]).toMatchObject({
      q: "flash transition edit",
      retryQ: "flash transition video",
    });
    expect(q["ig-tutorials-en"]).toMatchObject({
      q: "flash transition tutorial capcut davinci",
      retryQ: "how to flash transition",
    });
    expect(q["tt-tutorials-ar"]).toMatchObject({
      lang: "ar",
      q: "شرح تأثير فلاش مونتاج",
      retryQ: "ايديت انتقال فلاش",
    });
    expect(q["yt-examples-en"].retryQ).toBeUndefined();
    expect(q["yt-tutorials-ar"]).toMatchObject({ lang: "ar", intent: "tutorials" });
  });

  it("needs an editing word for a non-specific term and lists its words", () => {
    expect(plan.needsEditingWord).toBe(true);
    expect(plan.topicWords).toContain("flash");
    expect(plan.topicWords).toContain("فلاش");
  });

  it("never offers the generic catch-all as another meaning", () => {
    const glitch = planSearch({ q: "glitch transitions" });
    expect(glitch.termId).toBe("glitch");
    expect(glitch.alternatives).not.toContainEqual(
      expect.objectContaining({ termId: "smooth-transition" }),
    );
    expect(glitch.alternatives.at(-1)).toEqual({ exact: true });
  });
});

describe("planSearch options", () => {
  it("preserves genre and selected program in tutorials and retries", () => {
    const q = byId(
      planSearch({
        q: "speed ramp",
        genreQuery: { en: "car edit", ar: "ايديت سيارات" },
        program: "DaVinci Resolve",
      }),
    );
    expect(q["tt-examples-en"].q).toBe("speed ramp edit car edit");
    expect(q["tt-tutorials-en"].q).toBe("speed ramp tutorial car edit DaVinci Resolve");
    expect(q["tt-tutorials-ar"].q).toBe("شرح سبيد رامب ايديت سيارات DaVinci Resolve");
    expect(q["tt-tutorials-ar"].retryQ).toContain("ايديت سيارات");
    expect(q["tt-tutorials-ar"].retryQ).toContain("DaVinci Resolve");
    expect(q["tt-examples-en"].retryQ).toBe("speed ramp video car edit");
    expect(q["tt-tutorials-en"].retryQ).toBe("how to speed ramp car edit DaVinci Resolve");
  });

  it("adds the program once: a tutorials query that names it already stays as it is", () => {
    const q = byId(planSearch({ q: "color grading", program: "DaVinci Resolve" }));
    expect(q["tt-tutorials-en"].q).toBe("color grading tutorial DaVinci Resolve");
    expect(q["yt-tutorials-en"].q).toBe("color grading tutorial DaVinci Resolve");
  });

  it("keeps extra typed words on every query", () => {
    expect(byId(planSearch({ q: "speed ramp cars" }))["ig-examples-en"].q).toBe(
      "speed ramp edit cars",
    );
  });

  it("plans an unknown topic from its words", () => {
    const plan = planSearch({ q: "bokeh balls" });
    const q = byId(plan);
    expect(plan.termId).toBeUndefined();
    expect(plan.topicKey).toBe("bokeh ball");
    expect(plan.understood.label).toEqual({ ar: "bokeh balls", en: "bokeh balls" });
    expect(q["tt-examples-en"].q).toBe("bokeh balls edit");
    expect(q["tt-tutorials-en"].q).toBe("bokeh balls tutorial");
    expect(q["tt-tutorials-ar"].q).toBe("شرح bokeh balls");
    expect(q["tt-examples-en"].retryQ).toBe("bokeh balls video");
    expect(q["tt-tutorials-en"].retryQ).toBe("how to bokeh balls");
    expect(plan.needsEditingWord).toBe(false);
    expect(plan.topicWords).toEqual(["bokeh", "ball"]);
    expect(plan.alternatives).toEqual([{ exact: true }]);
  });

  it("searches exactly what was typed, once per platform, hiding nothing", () => {
    const plan = planSearch({ q: "flash", exact: true });
    expect(plan.queries.map((q) => [q.platform, q.q, q.lang])).toEqual([
      ["tt", "flash", "en"],
      ["ig", "flash", "en"],
      ["yt", "flash", "en"],
    ]);
    expect(plan.topicWords).toEqual([]);
    expect(plan.alternatives).toEqual([
      { termId: "flash-transition", label: { en: "flash transition", ar: "انتقال فلاش" } },
    ]);
    expect(planSearch({ q: "فلاش", exact: true }).queries[0].lang).toBe("ar");
    expect(planSearch({ q: "Transitions", exact: true }).topicKey).toBe("transition");
  });

  it("uses a term picked from Not this?", () => {
    const plan = planSearch({ q: "flash", term: "camera-flash" });
    expect(plan.termId).toBe("camera-flash");
    expect(plan.alternatives[0]).toEqual({
      termId: "flash-transition",
      label: { en: "flash transition", ar: "انتقال فلاش" },
    });
  });

  it("plans only the platforms asked for", () => {
    const plan = planSearch({ q: "flash", platforms: ["yt"] });
    expect(new Set(plan.queries.map((q) => q.platform))).toEqual(new Set(["yt"]));
  });

  it("never asks the same words twice on a platform", () => {
    const entry = (name: string, examples: LangText, tutorials: LangText): EditTerm => ({
      id: name.replace(" ", "-"),
      kind: "transition",
      label: { en: name, ar: name },
      match: { en: [name], ar: [] },
      specific: true,
      queries: { examples, tutorials },
    });
    // English examples and tutorials ask the same words; the examples retry ("x cut video") is the Arabic query.
    const x = planSearch({ q: "x cut" }, [
      entry(
        "x cut",
        { en: "x cut edit", ar: "ايديت اكس كت" },
        { en: "x cut edit", ar: "x cut video" },
      ),
    ]);
    for (const platform of ["tt", "ig", "yt"]) {
      const qs = x.queries.filter((q) => q.platform === platform);
      const asked = qs.map((q) => q.q.toLowerCase());
      expect(asked).toEqual(["x cut edit", "x cut video"]);
      for (const q of qs) expect(asked).not.toContain(q.retryQ?.toLowerCase());
    }
    // The Arabic retry ("y cut video") is the English examples retry.
    const y = byId(
      planSearch({ q: "y cut" }, [
        entry(
          "y cut",
          { en: "y cut edit", ar: "y cut video" },
          { en: "y cut tutorial", ar: "شرح واي كت" },
        ),
      ]),
    );
    expect(y["tt-examples-en"].retryQ).toBe("y cut video");
    expect(y["tt-tutorials-ar"].retryQ).toBeUndefined();
  });
});

describe("planSearch with Claude's own queries", () => {
  it("uses them as they are, hides nothing and keeps the topic key", () => {
    const plan = planSearch({
      q: "flash",
      queries: [
        { q: "flash transition velocity edit", platform: "tt", lang: "en", intent: "examples" },
        { q: "شرح فلاش كاب كت", platform: "ig", lang: "ar", intent: "tutorials" },
        { q: "   ", platform: "yt", lang: "en", intent: "examples" },
      ],
    });
    expect(plan.topicKey).toBe("flash-transition");
    expect(plan.topicWords).toEqual([]);
    expect(plan.alternatives).toEqual([]);
    expect(plan.queries).toEqual([
      {
        id: "tt-examples-en-0",
        platform: "tt",
        lang: "en",
        intent: "examples",
        q: "flash transition velocity edit",
      },
      {
        id: "ig-tutorials-ar-1",
        platform: "ig",
        lang: "ar",
        intent: "tutorials",
        q: "شرح فلاش كاب كت",
      },
    ]);
  });

  it("uses at most 9 of them, on the platforms asked for", () => {
    const mine = (i: number) => ({
      q: `query ${i}`,
      platform: "tt" as const,
      lang: "en" as const,
      intent: "examples" as const,
    });
    const twelve = Array.from({ length: 12 }, (_, i) => mine(i));
    expect(planSearch({ q: "flash", queries: twelve }).queries.map((q) => q.q)).toEqual(
      twelve.slice(0, 9).map((q) => q.q),
    );
    expect(planSearch({ q: "flash", platforms: ["yt"], queries: [mine(0)] }).queries).toEqual([]);
  });
});
