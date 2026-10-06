import { describe, expect, it } from "vitest";
import { sparkPath } from "./GrowthSnapshotCard";
import { compactCount, fmtCount } from "./platform";

describe("growth snapshot helpers", () => {
  it("sparkPath smooths through the points (M, Q to each midpoint, T the last), x by date, y min…max", () => {
    const p = sparkPath([
      { day: "2026-09-01", followers: 100 },
      { day: "2026-09-11", followers: 200 },
      { day: "2026-09-21", followers: 150 },
    ]);
    expect(p.line).toBe("M8.0 62.0 Q8.0 62.0 84.0 37.0 Q160.0 12.0 236.0 24.5 T312.0 37.0");
    expect(p.area).toBe(`${p.line} L312.0 62 L8.0 62 Z`);
    expect(p.end).toEqual([312, 37]);
    // A flat series lies on the bottom line instead of dividing by zero.
    expect(
      sparkPath([
        { day: "2026-09-01", followers: 5 },
        { day: "2026-09-02", followers: 5 },
      ]).line,
    ).toBe("M8.0 62.0 Q8.0 62.0 160.0 62.0 T312.0 62.0");
  });

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
