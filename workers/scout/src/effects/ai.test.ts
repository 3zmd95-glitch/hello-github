import { describe, expect, it, vi } from "vitest";
import { AI_MODEL } from "../discover/ai";
import { cleanWithAi } from "./ai";

const candidates = [
  { key: "clone-effect", name: "clone effect", samples: ["Clone Yourself " + "x".repeat(200)] },
  { key: "clone-trend", name: "clone trend", samples: ["omg Clone Trend"] },
];
const verdict = (key: string, extra: object = {}) => ({
  key,
  keep: true,
  name: { en: "Clone effect", ar: "تأثير الاستنساخ" },
  what: { en: "The same person shows up many times", ar: "نفس الشخص يطلع أكثر من مرة" },
  ...extra,
});
const env = (run: (model: string, input: Record<string, unknown>) => Promise<unknown>) => ({
  AI: { run: vi.fn(run) },
});
/** A built-in AI answering these verdicts, as the real one does (the list in `response`, already parsed). */
const answering = (effects: unknown[]) => env(async () => ({ response: { effects } }));

describe("cleanWithAi", () => {
  it("returns the checked verdicts, the titles clipped and passed as data", async () => {
    const reply = {
      effects: [verdict("clone-effect"), verdict("clone-trend", { sameAs: "clone-effect" })],
    };
    const e = env(async () => ({ response: JSON.stringify(reply) }));
    expect(await cleanWithAi(e, candidates)).toEqual({ verdicts: reply.effects, rejects: {} });
    const [model, input] = e.AI.run.mock.calls[0];
    expect(model).toBe(AI_MODEL);
    // The owner's dialect: Hijazi, not a generic Gulf Arabic.
    const system = (input.messages as { content: string }[])[0].content;
    expect(system).toContain("Hijazi Arabic (the Saudi western-region dialect)");
    expect(system).not.toContain("Gulf");
    const user = (input.messages as { content: string }[])[1].content;
    expect(user).toContain("- key: clone-effect | name: clone effect | posts: Clone Yourself x");
    expect(user).not.toContain("x".repeat(100)); // each title is clipped to 100 characters
  });

  it("drops verdicts about keys it was not given, or merging into one, and counts them", async () => {
    const e = answering([
      verdict("clone-effect"),
      verdict("made-up"),
      verdict("clone-trend", { sameAs: "made-up" }),
    ]);
    expect(await cleanWithAi(e, candidates)).toEqual({
      verdicts: [verdict("clone-effect")],
      rejects: { unknown_key: 1, unknown_sameAs: 1 },
    });
  });

  it("real model output: a sameAs of '', null, blanks or its own key merges nothing", async () => {
    const out = await cleanWithAi(
      answering([
        verdict("clone-effect", { sameAs: "" }),
        verdict("clone-trend", { sameAs: null }),
        verdict("clone-effect", { sameAs: "   " }),
        verdict("clone-trend", { sameAs: " clone-trend " }),
      ]),
      candidates,
    );
    expect(out?.rejects).toEqual({});
    expect(out?.verdicts.map((v) => v.key)).toEqual([
      "clone-effect",
      "clone-trend",
      "clone-effect",
      "clone-trend",
    ]);
    for (const v of out!.verdicts) expect(v).not.toHaveProperty("sameAs");
  });

  it("real model output: text is trimmed and clipped to its limit (a line at a word near the end), not rejected", async () => {
    const line =
      "You walk into the frame and meet yourself, then a second and a third copy of you joins in";
    const long = `  ${line} the same shot, all at one time  `;
    expect(long.trim()).toHaveLength(120);
    const out = await cleanWithAi(
      answering([
        verdict("clone-effect", {
          name: { en: " Clone effect ", ar: "ا".repeat(41) },
          what: { en: long, ar: "ا".repeat(120) },
        }),
      ]),
      candidates,
    );
    expect(out).toEqual({
      verdicts: [
        verdict("clone-effect", {
          name: { en: "Clone effect", ar: "ا".repeat(40) },
          // Cut at the last space within the line's final 15 characters; no space there: a plain cut.
          what: { en: line, ar: "ا".repeat(90) },
        }),
      ],
      rejects: {},
    });
    expect(line.length).toBeLessThanOrEqual(90);
  });

  it("rejects a verdict with too short or missing text, or a broken field, and counts why: never the rest", async () => {
    const out = await cleanWithAi(
      answering([
        verdict("clone-effect"),
        verdict("clone-trend", { what: undefined }),
        verdict("clone-trend", { what: { en: "x", ar: "  وصف قصير  " } }),
        verdict("clone-trend", { name: { en: " ", ar: "ا" } }),
        verdict("clone-trend", { keep: "yes" }),
        "junk",
      ]),
      candidates,
    );
    expect(out).toEqual({
      verdicts: [verdict("clone-effect")],
      // Counts by field and zod's code: never the text.
      rejects: {
        "what:invalid_type": 1,
        "what.en:too_small": 1,
        "name.en:too_small": 1,
        "name.ar:too_small": 1,
        "keep:invalid_type": 1,
        invalid_type: 1,
      },
    });
  });

  it("gives null on invalid JSON, no list, no binding, an error or a timeout", async () => {
    expect(
      await cleanWithAi(
        env(async () => ({ response: "{not json" })),
        candidates,
      ),
    ).toBeNull();
    expect(
      await cleanWithAi(
        env(async () => ({ response: { verdicts: [verdict("clone-effect")] } })),
        candidates,
      ),
    ).toBeNull();
    expect(await cleanWithAi({}, candidates)).toBeNull();
    expect(
      await cleanWithAi(
        env(async () => {
          throw new Error("down");
        }),
        candidates,
      ),
    ).toBeNull();
    const never = env(() => new Promise(() => {}));
    expect(await cleanWithAi(never, candidates, 20)).toBeNull();
  });
});
