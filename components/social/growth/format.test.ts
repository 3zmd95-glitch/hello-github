import { describe, expect, it } from "vitest";
import { countParts, fmtCount } from "./format";

describe("countParts", () => {
  it("splits a count so a count-up ends on fmtCount's text", () => {
    const cases: [number, number, number, string][] = [
      [0, 0, 0, ""],
      [999, 999, 0, ""],
      [1_000, 1, 0, "k"],
      [1_478, 1.5, 1, "k"],
      [7_812, 7.8, 1, "k"],
      [30_000, 30, 0, "k"],
      [184_230, 184.2, 1, "k"],
      [2_100_000, 2.1, 1, "m"],
    ];
    for (const [n, value, decimals, suffix] of cases) {
      expect(countParts(n), String(n)).toEqual({ value, decimals, suffix });
      expect(`${value.toFixed(decimals)}${suffix}`, String(n)).toBe(fmtCount(n));
    }
  });
});
