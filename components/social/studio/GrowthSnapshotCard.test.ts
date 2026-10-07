import { describe, expect, it } from "vitest";
import { compactCount, fmtCount } from "./platform";

describe("growth snapshot helpers", () => {
  it("compactCount splits a count into the shown number and its suffix; fmtCount joins them", () => {
    const cases: [number, number, number, string, string][] = [
      [999, 999, 0, "", "999"],
      [1000, 1, 0, "K", "1K"],
      [1478, 1.5, 1, "K", "1.5K"],
      [99_960, 100, 0, "K", "100K"],
      [184_230, 184, 0, "K", "184K"],
      [2_100_000, 2.1, 1, "M", "2.1M"],
      [-1200, -1.2, 1, "K", "-1.2K"],
    ];
    for (const [n, value, decimals, suffix, text] of cases) {
      expect(compactCount(n), String(n)).toEqual({ value, decimals, suffix });
      expect(fmtCount(n), String(n)).toBe(text);
    }
  });
});
