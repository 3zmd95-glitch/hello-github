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

describe("cleanWithAi", () => {
  it("returns the checked verdicts, the titles clipped and passed as data", async () => {
    const reply = {
      effects: [verdict("clone-effect"), verdict("clone-trend", { sameAs: "clone-effect" })],
    };
    const e = env(async () => ({ response: JSON.stringify(reply) }));
    expect(await cleanWithAi(e, candidates)).toEqual(reply.effects);
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

  it("drops verdicts about keys it was not given, or merging into one", async () => {
    const e = env(async () => ({
      response: {
        effects: [
          verdict("clone-effect"),
          verdict("made-up"),
          verdict("clone-trend", { sameAs: "made-up" }),
        ],
      },
    }));
    expect(await cleanWithAi(e, candidates)).toEqual([verdict("clone-effect")]);
  });

  it("checks each verdict on its own: a broken one never costs the others", async () => {
    const longArabic = verdict("clone-trend", { name: { en: "Clone trend", ar: "ا".repeat(41) } });
    const reply = (effects: unknown[]) => env(async () => ({ response: { effects } }));
    expect(await cleanWithAi(reply([verdict("clone-effect"), longArabic]), candidates)).toEqual([
      verdict("clone-effect"),
    ]);
    const short = verdict("clone-effect", { what: { en: "x", ar: "y" } });
    expect(await cleanWithAi(reply([short, longArabic, "junk"]), candidates)).toEqual([]);
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
