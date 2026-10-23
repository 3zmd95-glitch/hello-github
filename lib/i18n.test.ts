import { describe, expect, it } from "vitest";
import { withoutEmoji } from "./i18n";

describe("withoutEmoji (Social chrome carries no emoji, tools/18 §7)", () => {
  it("drops a leading emoji and the space after it, with or without a variation selector", () => {
    expect(withoutEmoji("🚗 سيارات")).toBe("سيارات");
    expect(withoutEmoji("⚙️ Settings")).toBe("Settings");
    expect(withoutEmoji("🔗 Connected accounts")).toBe("Connected accounts");
    expect(withoutEmoji("👨‍👩‍👧 Family")).toBe("Family");
  });

  it("leaves a label without a leading emoji alone, and keeps a label that is only an emoji", () => {
    expect(withoutEmoji("Settings")).toBe("Settings");
    expect(withoutEmoji("Sync now 🔄")).toBe("Sync now 🔄");
    expect(withoutEmoji("🏁")).toBe("🏁");
    expect(withoutEmoji("")).toBe("");
  });
});
