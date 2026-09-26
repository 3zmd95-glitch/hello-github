import { describe, expect, it } from "vitest";
import { flowState } from "./flow";

const text = { ar: "س", en: "x" };

describe("flowState", () => {
  const today = "2026-09-26";

  it("starts at 0/3", () => {
    expect(flowState({ completions: [], microActions: [] }, today)).toEqual({
      quest: null,
      micro: null,
      steps: 0,
      dayDone: false,
    });
  });

  it("counts only today's activity on the Riyadh day", () => {
    // 2026-09-25T21:30Z is 00:30 on the 26th in Riyadh; 20:59Z on the 25th is still the 25th.
    const s = {
      completions: [{ skillId: "a", quest: "train" as const, at: "2026-09-25T20:59:00.000Z" }],
      microActions: [{ id: "m", at: "2026-09-25T21:30:00.000Z", text }],
    };
    const f = flowState(s, today);
    expect(f.quest).toBeNull();
    expect(f.micro?.id).toBe("m");
    expect(f.steps).toBe(1);
  });

  it("is 3/3 when a quest and a micro-action are done today", () => {
    const s = {
      completions: [{ skillId: "a", quest: "train" as const, at: "2026-09-26T08:00:00.000Z" }],
      microActions: [{ id: "m", at: "2026-09-26T09:00:00.000Z", text }],
    };
    expect(flowState(s, today)).toMatchObject({ steps: 3, dayDone: true });
  });
});
