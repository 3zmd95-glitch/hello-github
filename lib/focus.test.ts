import { describe, expect, it } from "vitest";
import { FOCUS_MINUTES, focusActive, focusEndsAtMs, focusMultiplier, stoppedEarly } from "./focus";

const start = "2026-09-26T10:00:00.000Z";

describe("focus", () => {
  it("offers 25 and 60 minute potions", () => {
    expect([...FOCUS_MINUTES]).toEqual([25, 60]);
  });

  it("ends startedAt + minutes", () => {
    expect(new Date(focusEndsAtMs({ startedAt: start, minutes: 25 })).toISOString()).toBe(
      "2026-09-26T10:25:00.000Z",
    );
  });

  it("is active until the end, then null", () => {
    const f = { startedAt: start, minutes: 60 as const };
    expect(focusActive(null, new Date(start))).toBeNull();
    const a = focusActive(f, new Date("2026-09-26T10:30:00.000Z"));
    expect(a).toEqual({
      endsAt: "2026-09-26T11:00:00.000Z",
      remainingMs: 30 * 60_000,
      minutes: 60,
      startedAt: start,
    });
    expect(focusActive(f, new Date("2026-09-26T11:00:00.000Z"))).toBeNull();
  });

  it("multiplies XP by 1.25 only while running", () => {
    const f = { startedAt: start, minutes: 25 as const };
    expect(focusMultiplier(f, new Date("2026-09-26T10:10:00.000Z"))).toBe(1.25);
    expect(focusMultiplier(f, new Date("2026-09-26T10:26:00.000Z"))).toBe(1);
    expect(focusMultiplier(null, new Date(start))).toBe(1);
  });

  it("knows when a stop is early", () => {
    const f = { startedAt: start, minutes: 25 as const };
    expect(stoppedEarly(f, new Date("2026-09-26T10:24:59.000Z"))).toBe(true);
    expect(stoppedEarly(f, new Date("2026-09-26T10:25:00.000Z"))).toBe(false);
  });
});
