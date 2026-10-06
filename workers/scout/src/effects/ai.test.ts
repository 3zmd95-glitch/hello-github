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

  it("gives null on invalid JSON, a bad shape, no binding, an error or a timeout", async () => {
    expect(
      await cleanWithAi(
        env(async () => ({ response: "{not json" })),
        candidates,
      ),
    ).toBeNull();
    const short = { effects: [verdict("clone-effect", { what: { en: "x", ar: "y" } })] };
    expect(
      await cleanWithAi(
        env(async () => ({ response: short })),
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
