import { describe, expect, it } from "vitest";
import { MESSAGE_FILES } from "@/lib/i18n";

const pairs = Object.entries(MESSAGE_FILES) as [
  string,
  { ar: Record<string, string>; en: Record<string, string> },
][];

describe("message dictionaries", () => {
  for (const [name, { ar, en }] of pairs) {
    describe(name, () => {
      it("has the same keys in Arabic and English", () => {
        expect(Object.keys(en).sort()).toEqual(Object.keys(ar).sort());
      });

      it("uses the same placeholders in both languages", () => {
        const vars = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
        for (const key of Object.keys(ar)) {
          expect(vars(en[key]), key).toEqual(vars(ar[key]));
        }
      });

      it("has no empty strings", () => {
        for (const [k, v] of [...Object.entries(ar), ...Object.entries(en)])
          expect(v, k).not.toBe("");
      });
    });
  }

  it("never defines the same key in two files", () => {
    const seen = new Map<string, string>();
    for (const [name, { ar }] of pairs) {
      for (const key of Object.keys(ar)) {
        expect(seen.get(key), `key "${key}" in ${name} and ${seen.get(key)}`).toBeUndefined();
        seen.set(key, name);
      }
    }
  });
});
