import { Inbox, MessageCircle, Settings } from "lucide-react";
import { describe, expect, it } from "vitest";
import { activeHref, NAV_BY_WORLD, NAV_ITEMS, normalizePath, SOCIAL_NAV_ITEMS } from "./nav";
import { worldOf } from "./useWorld";

// 🧭 The two navigation lists and the active-item rule. Since tools/20 every Social entry is a Social route
// (Settings is /social/settings, Discover has no shortcut), so a Social link never opens the Training shell
// (the world, and with it the list, comes from the URL).

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
  "/social/settings/",
  "/social/inbox/",
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
  it("links only to Social routes: Settings is /social/settings and there is no Discover shortcut", () => {
    for (const item of SOCIAL_NAV_ITEMS) expect(worldOf(item.href), item.href).toBe("social");
    const hrefs = SOCIAL_NAV_ITEMS.map((i) => i.href);
    expect(hrefs.slice(-3)).toEqual(["/social/inbox", "/social/automations", "/social/settings"]);
    expect(SOCIAL_NAV_ITEMS.find((i) => i.href === "/social/settings")).toEqual({
      href: "/social/settings",
      icon: "⚙️",
      lucide: Settings,
      label: "nav.settings",
      desktopOnly: true,
    });
  });

  it("lists 💬 Auto replies in the Social desktop sidebar", () => {
    expect(SOCIAL_NAV_ITEMS.find((i) => i.href === "/social/replies")).toEqual({
      href: "/social/replies",
      icon: "💬",
      lucide: MessageCircle,
      label: "nav.replies",
      desktopOnly: true,
    });
    expect(activeHref(SOCIAL_NAV_ITEMS, "/social/replies/")).toBe("/social/replies");
  });

  it("lists 📥 Inbox in the Social desktop sidebar, right before Auto-posting", () => {
    const hrefs = SOCIAL_NAV_ITEMS.map((i) => i.href);
    const at = hrefs.indexOf("/social/inbox");
    expect(SOCIAL_NAV_ITEMS[at]).toEqual({
      href: "/social/inbox",
      icon: "📥",
      lucide: Inbox,
      label: "nav.inbox",
      desktopOnly: true,
    });
    expect(hrefs[at + 1]).toBe("/social/automations");
    expect(activeHref(SOCIAL_NAV_ITEMS, "/social/inbox/")).toBe("/social/inbox");
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

  it("activates a Social item on every Social route", () => {
    for (const path of SOCIAL_PATHS) {
      expect(worldOf(path), path).toBe("social");
      const active = activeHref(NAV_BY_WORLD[worldOf(path)], path);
      expect(active, path).toBeDefined();
      expect(worldOf(active!), path).toBe("social");
    }
  });

  it("keeps Discover a Training route: its list is the Training one", () => {
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

  it("every Social nav item has a Lucide icon, Training items keep emoji only", () => {
    // lucide-react icons are forwardRef objects, not functions: the LucideIcon type pins the kind.
    for (const item of SOCIAL_NAV_ITEMS) expect(item.lucide, item.href).toBeDefined();
    for (const item of NAV_ITEMS) expect(item.lucide, item.href).toBeUndefined();
  });
});
