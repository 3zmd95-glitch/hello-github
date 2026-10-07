import { describe, expect, it, vi } from "vitest";
import { AI_MODEL } from "../discover/ai";
import { askAi, cleanWithAi } from "./ai";

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
    expect(await cleanWithAi(e, candidates)).toEqual({
      verdicts: reply.effects,
      rejects: {},
      failed: 0,
    });
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

  it("drops verdicts about keys it was not given; one merging into such a key keeps its verdict, not the merge", async () => {
    const e = answering([
      verdict("clone-effect"),
      verdict("made-up"),
      verdict("clone-trend", { sameAs: "made-up" }),
    ]);
    const out = await cleanWithAi(e, candidates);
    expect(out).toEqual({
      verdicts: [verdict("clone-effect"), verdict("clone-trend")],
      rejects: { unknown_key: 1, unknown_sameAs: 1 },
      failed: 0,
    });
    expect(out!.verdicts[1]).not.toHaveProperty("sameAs");
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

  it("real model output: a key or sameAs echoed as words ('Clone Trend', 'clone_effect') is matched to ours", async () => {
    const out = await cleanWithAi(
      answering([verdict(" Clone Effect "), verdict("clone_trend", { sameAs: "Clone Effect" })]),
      candidates,
    );
    expect(out?.rejects).toEqual({});
    expect(out?.verdicts.map((v) => [v.key, v.sameAs])).toEqual([
      ["clone-effect", undefined],
      ["clone-trend", "clone-effect"],
    ]);
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
      failed: 0,
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
      failed: 0,
    });
  });

  it("asks in parallel batches of 9, keys sorted so spellings share one; a batch with no answer is counted", async () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      key: `k${String(20 - i).padStart(2, "0")}`,
      name: `effect ${i}`,
      samples: [],
    }));
    const keysIn = (input: Record<string, unknown>) =>
      [...(input.messages as { content: string }[])[1].content.matchAll(/^- key: (\S+)/gm)].map(
        ([, k]) => k,
      );
    // A model that keeps every key it is shown, but is down for the batch holding k01.
    const e = env(async (_model, input) => {
      const keys = keysIn(input);
      if (keys.includes("k01")) throw new Error("timeout");
      return { response: { effects: keys.map((k) => verdict(k)) } };
    });
    const out = await cleanWithAi(e, many);
    const asked = e.AI.run.mock.calls.map(([, input]) => keysIn(input));
    expect(asked.map((keys) => keys.length)).toEqual([9, 9, 2]);
    expect(asked[0]).toEqual(["k01", "k02", "k03", "k04", "k05", "k06", "k07", "k08", "k09"]);
    expect(out).toMatchObject({ rejects: {}, failed: 1 });
    expect(out!.verdicts.map((v) => v.key)).toEqual(asked.slice(1).flat());
    // No batch answering is no answer at all.
    const down = env(async () => {
      throw new Error("down");
    });
    expect(await cleanWithAi(down, many)).toBeNull();
    expect(down.AI.run).toHaveBeenCalledTimes(3);
  });

  it("counts an empty list as 'empty_list', so the diagnostics show it (live fix 1: Cars' first scan); still no verdict", async () => {
    expect(await cleanWithAi(answering([]), candidates)).toEqual({
      verdicts: [],
      rejects: { empty_list: 1 },
      failed: 0,
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

it("tells the AI a category's context, after the usual instructions (planning/tools/19-category-trends.md §2)", async () => {
  const e = answering([verdict("clone-effect")]);
  await cleanWithAi(e, candidates, 1000, "These posts are about Cars, for car videos.");
  const system = (e.AI.run.mock.calls[0][1].messages as { content: string }[])[0].content;
  expect(system).toContain("Hijazi Arabic (the Saudi western-region dialect)");
  expect(system.endsWith(" These posts are about Cars, for car videos.")).toBe(true);
});

it("without a context line, Trending effects' prompt is exactly as it was: it ends 'Answer JSON only.'", async () => {
  const e = answering([verdict("clone-effect")]);
  await cleanWithAi(e, candidates, 1000);
  const system = (e.AI.run.mock.calls[0][1].messages as { content: string }[])[0].content;
  expect(system.endsWith("what the effect looks like in both languages. Answer JSON only.")).toBe(
    true,
  );
});

describe("cleanWithAi with a model asked first (a category's cleanup on gpt-oss-120b)", () => {
  const GPT = "@cf/openai/gpt-oss-120b";
  const LLAMA = "llama-3.3-70b-instruct-fp8-fast";
  /** 10 candidates: 2 batches, k0–k8 and k9. */
  const ten = Array.from({ length: 10 }, (_, i) => ({
    key: `k${i}`,
    name: `k${i}`,
    samples: [`k${i} edit`],
  }));
  const keysOf = (input: Record<string, unknown>) =>
    [...(input.messages as { content: string }[])[1].content.matchAll(/^- key: (\S+) \|/gm)].map(
      ([, k]) => k,
    );
  /** A usable answer: a verdict for each key the batch holds. */
  const listFor = (input: Record<string, unknown>) => ({
    response: { effects: keysOf(input).map((k) => verdict(k)) },
  });
  const asked = (e: ReturnType<typeof env>) =>
    e.AI.run.mock.calls.map(([model, input]) => [model, input.max_tokens]);

  it("asks it first with room to reason; a batch it leaves without a list asks llama once; `models` names who answered", async () => {
    const e = env(async (model, input) =>
      // gpt-oss answers the first batch, and the second with no `effects` list.
      model === GPT && !keysOf(input).includes("k0") ? { response: {} } : listFor(input),
    );
    expect(await cleanWithAi(e, ten, 1000, undefined, GPT)).toEqual({
      verdicts: ten.map((c) => verdict(c.key)),
      rejects: {},
      failed: 0,
      models: ["gpt-oss-120b", LLAMA],
    });
    expect(asked(e)).toEqual([
      [GPT, 3000],
      [GPT, 3000],
      [AI_MODEL, 1500],
    ]);
  });

  it("a model that fails or answers no JSON: llama once; neither answering fails that batch ('none'), all of them null", async () => {
    const down = env(async (model, input) => {
      if (model === GPT) throw new Error("down");
      return keysOf(input).includes("k0") ? listFor(input) : { response: "not json" };
    });
    expect(await cleanWithAi(down, ten, 1000, undefined, GPT)).toEqual({
      verdicts: ten.slice(0, 9).map((c) => verdict(c.key)),
      rejects: {},
      failed: 1,
      models: [LLAMA, "none"],
    });
    expect(down.AI.run).toHaveBeenCalledTimes(4);
    const silent = env(async () => ({ response: {} }));
    expect(await cleanWithAi(silent, ten, 1000, undefined, GPT)).toBeNull();
    expect(asked(silent)).toEqual([
      [GPT, 3000],
      [GPT, 3000],
      [AI_MODEL, 1500],
      [AI_MODEL, 1500],
    ]);
  });

  it("without one (Trending effects): llama alone, max_tokens 1500, never asked again, no `models`", async () => {
    const silent = env(async () => ({ response: {} }));
    expect(await cleanWithAi(silent, ten)).toBeNull();
    expect(asked(silent)).toEqual([
      [AI_MODEL, 1500],
      [AI_MODEL, 1500],
    ]);
    expect(await cleanWithAi(answering([verdict("clone-effect")]), candidates)).not.toHaveProperty(
      "models",
    );
  });
});

describe("askAi", () => {
  const call = { system: "s", user: "u", schema: {}, maxTokens: 10 };
  it("answers the parsed JSON, whether the model sends text or an object", async () => {
    expect(
      await askAi(
        env(async () => ({ response: '{"a":1}' })),
        call,
        1000,
      ),
    ).toEqual({ a: 1 });
    expect(
      await askAi(
        env(async () => ({ response: { a: 1 } })),
        call,
        1000,
      ),
    ).toEqual({ a: 1 });
  });
  it("B5: asks the model given (category lessons: gpt-oss-120b); Trending effects' cleanup stays on llama", async () => {
    const e = env(async () => ({ response: { a: 1 } }));
    await askAi(e, call, 1000, "@cf/openai/gpt-oss-120b");
    await askAi(e, call, 1000);
    expect(e.AI.run.mock.calls.map(([model]) => model)).toEqual([
      "@cf/openai/gpt-oss-120b",
      AI_MODEL,
    ]);
    expect(e.AI.run.mock.calls[0][1]).toMatchObject({ max_tokens: 10 });
  });

  it("B5: reads the answer in whichever shape the model gives it, a code fence around it too", async () => {
    const shapes = [
      { response: '{"a":1}' },
      { response: { a: 1 } },
      { response: '```json\n{"a":1}\n```' },
      { choices: [{ message: { content: '{"a":1}' } }] },
      { choices: [{ message: { content: '```\n{"a":1}\n```' } }] },
      // The Responses API: its reasoning first, then the message.
      {
        output: [
          { type: "reasoning", content: [{ type: "reasoning_text", text: "Think about {a}..." }] },
          { type: "message", content: [{ type: "output_text", text: '{"a":1}' }] },
        ],
      },
    ];
    for (const shape of shapes)
      expect(
        await askAi(
          env(async () => shape),
          call,
          1000,
        ),
        JSON.stringify(shape),
      ).toEqual({ a: 1 });
    for (const none of [
      {},
      { response: null },
      { choices: [] },
      { output: [{ content: "x" }] },
      null,
    ])
      expect(
        await askAi(
          env(async () => none),
          call,
          1000,
        ),
        JSON.stringify(none),
      ).toBeNull();
  });

  it("is null without a binding, on broken JSON, an error or a timeout", async () => {
    expect(await askAi({}, call, 1000)).toBeNull();
    expect(
      await askAi(
        env(async () => ({ response: "{bad" })),
        call,
        1000,
      ),
    ).toBeNull();
    expect(
      await askAi(
        env(async () => {
          throw new Error("down");
        }),
        call,
        1000,
      ),
    ).toBeNull();
    expect(
      await askAi(
        env(() => new Promise(() => {})),
        call,
        20,
      ),
    ).toBeNull();
  });
});
