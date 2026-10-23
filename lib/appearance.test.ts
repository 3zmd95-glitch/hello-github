import { describe, expect, it } from "vitest";
import { SettingsSchema } from "./domain";
import { resolveScheme, SOCIAL_BG } from "./appearance";

describe("Appearance (Social light by default, tools/18 §12)", () => {
  it("resolves Light and Dark as chosen, and System from the phone", () => {
    expect(resolveScheme("light", true)).toBe("light");
    expect(resolveScheme("dark", false)).toBe("dark");
    expect(resolveScheme("system", true)).toBe("dark");
    expect(resolveScheme("system", false)).toBe("light");
  });

  it("gives an older save without the setting the light look", () => {
    const old = {
      lang: "ar",
      sound: true,
      reminderTime: "20:00",
      gear: ["phone"],
      davinciEdition: "studio",
    };
    expect(SettingsSchema.parse(old).appearance).toBe("light");
    expect(SettingsSchema.parse({ ...old, appearance: "dark" }).appearance).toBe("dark");
    expect(() => SettingsSchema.parse({ ...old, appearance: "sepia" })).toThrow();
  });

  it("names a page color for each scheme", () => {
    expect(SOCIAL_BG.light).toBe("#f2f3f6");
    expect(SOCIAL_BG.dark).toBe("#0b0d10");
  });
});
