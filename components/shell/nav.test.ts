import { describe, expect, it } from "vitest";
import { activeHref, NAV_BY_WORLD, NAV_ITEMS, normalizePath, SOCIAL_NAV_ITEMS } from "./nav";
import { worldOf } from "./useWorld";

// 🧭 The two navigation lists and the active-item rule. Round 31b adds a 🔎 Discover shortcut to the Social
// sidebar: Discover is a Training route, so the shortcut stays out of the phone tab bar and is never the
// active item inside Social (the world, and with it the list, comes from the URL).

const SOCIAL_PATHS = [
  "/social",
  "/social/",
  "/social/calendar/",
  "/social/calendar/oct",
  "/social/growth/",
  "/social/ideas/",
  "/social/more/",
  "/social/website/",
  "/social/business/",
  "/social/automations/",
  "/social/replies/",
];

describe("normalizePath", () => {
  it("drops the trailing slash of the static export and keeps the root", () => {
    expect(normalizePath("/skills/")).toBe("/skills");
    expect(normalizePath("/social/calendar/")).toBe("/social/calendar");
    expect(normalizePath("/discover")).toBe("/discover");
    expect(normalizePath("/")).toBe("/");
    expect(normalizePath("")).toBe("/");
    expect(normalizePath(null)).toBe("/");
  });
});

describe("activeHref", () => {
  it("picks the deepest item that owns the path, and the root only for itself", () => {
    expect(activeHref(NAV_ITEMS, "/")).toBe("/");
    expect(activeHref(NAV_ITEMS, "/skills/")).toBe("/skills");
    expect(activeHref(NAV_ITEMS, "/nowhere/")).toBeUndefined();
    expect(activeHref(SOCIAL_NAV_ITEMS, "/social/")).toBe("/social");
    expect(activeHref(SOCIAL_NAV_ITEMS, "/social/calendar/oct")).toBe("/social/calendar");
  });
});

describe("Social navigation", () => {
  it("has one Discover shortcut in the desktop sidebar, between Auto-posting and Settings", () => {
    const discover = SOCIAL_NAV_ITEMS.filter((i) => i.href === "/discover");
    expect(discover).toEqual([
      { href: "/discover", icon: "🔎", label: "nav.discover", desktopOnly: true },
    ]);
    const hrefs = SOCIAL_NAV_ITEMS.map((i) => i.href);
    expect(hrefs.slice(-3)).toEqual(["/social/automations", "/discover", "/settings"]);
    // The same entry as in Training (one name and one icon for one place).
    const training = NAV_ITEMS.find((i) => i.href === "/discover");
    expect(training).toMatchObject({ icon: discover[0].icon, label: discover[0].label });
  });

  it("lists 💬 Auto replies in the Social desktop sidebar, before the last three", () => {
    expect(SOCIAL_NAV_ITEMS.find((i) => i.href === "/social/replies")).toEqual({
      href: "/social/replies",
      icon: "💬",
      label: "nav.replies",
      desktopOnly: true,
    });
    expect(activeHref(SOCIAL_NAV_ITEMS, "/social/replies/")).toBe("/social/replies");
  });

  it("keeps the phone tab bar at the five Social tabs", () => {
    const tabs = SOCIAL_NAV_ITEMS.filter((i) => !i.desktopOnly).map((i) => i.href);
    expect(tabs).toEqual([
      "/social",
      "/social/calendar",
      "/social/growth",
      "/social/ideas",
      "/social/more",
    ]);
  });

  it("never marks Discover or Settings active on a Social route", () => {
    for (const path of SOCIAL_PATHS) {
      expect(worldOf(path), path).toBe("social");
      const active = activeHref(NAV_BY_WORLD[worldOf(path)], path);
      expect(active, path).toBeDefined();
      expect(worldOf(active!), path).toBe("social");
    }
  });

  it("hands Discover to the Training list: the shortcut opens the Training shell", () => {
    for (const path of ["/discover", "/discover/"]) {
      expect(worldOf(path)).toBe("training");
      expect(NAV_BY_WORLD[worldOf(path)]).toBe(NAV_ITEMS);
      expect(activeHref(NAV_BY_WORLD[worldOf(path)], path)).toBe("/discover");
    }
  });
});

describe("both navigation lists", () => {
  it("use each href once (the shell keys its entries by href)", () => {
    for (const items of Object.values(NAV_BY_WORLD)) {
      const hrefs = items.map((i) => i.href);
      expect(new Set(hrefs).size).toBe(hrefs.length);
    }
  });

  it("keep the Training phone tab bar: Today, Skills, Map, Discover, More", () => {
    const tabs = NAV_ITEMS.filter((i) => !i.desktopOnly).map((i) => i.href);
    expect(tabs).toEqual(["/", "/skills", "/map", "/discover", "/more"]);
  });
});
