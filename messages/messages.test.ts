import { describe, expect, it } from "vitest";
import ar from "./ar.json";
import en from "./en.json";

describe("message dictionaries", () => {
  it("have the same keys in Arabic and English", () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(ar).sort());
  });

  it("use the same placeholders in both languages", () => {
    const vars = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    for (const key of Object.keys(ar) as (keyof typeof ar)[]) {
      expect(vars(en[key]), key).toEqual(vars(ar[key]));
    }
  });

  it("have no empty strings", () => {
    for (const [k, v] of [...Object.entries(ar), ...Object.entries(en)]) expect(v, k).not.toBe("");
  });
});
