// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { lastSocialPath, rememberSocialPath, SOCIAL_ROOT, worldOf } from "./useWorld";

// 🌍 The world of a route and the "last Social route" memory of the world switch. Social's menu has entries
// that leave the world (🔎 Discover, ⚙️ Settings): they must never become the route the switch returns to.

// The key useWorld.ts keeps in the session (this is jsdom's storage, made for the test).
const KEY = "3z.lastSocialPath";

beforeEach(() => {
  sessionStorage.clear();
});

describe("worldOf", () => {
  it("is Social for /social and everything below it", () => {
    for (const path of ["/social", "/social/", "/social/growth/", "/social/calendar/oct"]) {
      expect(worldOf(path), path).toBe("social");
    }
  });

  it("is Training everywhere else, Discover and Settings included", () => {
    for (const path of ["/", "", "/discover", "/discover/", "/settings/", "/more/", "/socials/"]) {
      expect(worldOf(path), path).toBe("training");
    }
    expect(worldOf(null)).toBe("training");
  });
});

describe("the last Social route", () => {
  it("is the Studio home until a Social route was visited", () => {
    expect(lastSocialPath()).toBe(SOCIAL_ROOT);
  });

  it("is the Social route the owner was on, without the trailing slash", () => {
    rememberSocialPath("/social/growth/");
    expect(lastSocialPath()).toBe("/social/growth");
    rememberSocialPath("/social/more/");
    expect(lastSocialPath()).toBe("/social/more");
  });

  it("never becomes Discover or another Training route", () => {
    rememberSocialPath("/social/growth/");
    for (const path of ["/discover/", "/discover", "/settings/", "/"]) {
      rememberSocialPath(path);
      expect(lastSocialPath(), path).toBe("/social/growth");
    }
    expect(sessionStorage.getItem(KEY)).toBe("/social/growth");
  });

  it("does not remember a Training route on a fresh session either", () => {
    rememberSocialPath("/discover/");
    expect(sessionStorage.getItem(KEY)).toBeNull();
    expect(lastSocialPath()).toBe(SOCIAL_ROOT);
  });

  it("ignores a saved value that is not a Social route", () => {
    sessionStorage.setItem(KEY, "/discover");
    expect(lastSocialPath()).toBe(SOCIAL_ROOT);
  });
});
