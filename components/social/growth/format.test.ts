import { describe, expect, it } from "vitest";
import { compactCount, fmtCount, fmtSigned } from "./format";

describe("compactCount / fmtCount", () => {
  it("splits a count so a count-up ends on fmtCount's text, one decimal where it adds information", () => {
    const cases: [number, number, number, string, string][] = [
      [0, 0, 0, "", "0"],
      [999, 999, 0, "", "999"],
      [1_000, 1, 0, "K", "1K"],
      [1_478, 1.5, 1, "K", "1.5K"],
      [7_812, 7.8, 1, "K", "7.8K"],
      [12_400, 12.4, 1, "K", "12.4K"],
      [30_000, 30, 0, "K", "30K"],
      [99_960, 100, 0, "K", "100K"],
      [184_230, 184.2, 1, "K", "184.2K"],
      [999_949, 999.9, 1, "K", "999.9K"],
      [999_950, 1, 0, "M", "1M"],
      [2_100_000, 2.1, 1, "M", "2.1M"],
      [-1_200, -1.2, 1, "K", "−1.2K"],
    ];
    for (const [n, value, decimals, suffix, text] of cases) {
      expect(compactCount(n), String(n)).toEqual({ value, decimals, suffix });
      expect(fmtCount(n), String(n)).toBe(text);
    }
  });

  it("signs a change with + or a minus sign; nothing on 0", () => {
    expect(fmtSigned(1_200)).toBe("+1.2K");
    expect(fmtSigned(-300)).toBe("−300");
    expect(fmtSigned(0)).toBe("0");
  });
});
