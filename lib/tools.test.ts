import { describe, expect, it } from "vitest";
import { NAV_ITEMS, SOCIAL_NAV_ITEMS } from "@/components/shell/nav";
import type { SocialConnectionStatus, SocialSyncState } from "@/lib/domain";
import { MESSAGE_FILES } from "@/lib/i18n";
import {
  TOOLS,
  accountReadiness,
  quickActionTools,
  searchTools,
  type ToolContext,
  type ToolDef,
} from "./tools";

// Tools & Integrations hub (packet DT-1): a read-only registry. Readiness comes from what the store already
// holds; saved credentials are "configured", never "connected"; a stale or missing status is never green.

const NOW = Date.parse("2026-10-16T12:00:00Z");
const HOUR = 60 * 60 * 1000;
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const SCOUT = { scoutUrl: "https://scout.example.workers.dev", scoutToken: "secret-owner-token" };

const live: SocialConnectionStatus = { configured: true, connected: true };
const social = (status: SocialSyncState["status"], statusAt: string | null): SocialSyncState => ({
  lastPullAt: null,
  lastPullError: null,
  status,
  statusAt,
});
const ctx = (over: Partial<ToolContext> = {}): ToolContext => ({
  apiKeys: {},
  social: social(null, null),
  localAiHost: false,
  helperId: null,
  ...over,
});
const tool = (id: string): ToolDef => {
  const t = TOOLS.find((x) => x.id === id);
  if (!t) throw new Error(`no tool ${id}`);
  return t;
};
const ids = (list: readonly ToolDef[]) => list.map((t) => t.id);
const dict = MESSAGE_FILES.tools as { ar: Record<string, string>; en: Record<string, string> };

describe("registry", () => {
  it("routes only to existing screens and Settings anchors", () => {
    const routes = new Set([
      ...NAV_ITEMS.map((n) => n.href),
      ...SOCIAL_NAV_ITEMS.map((n) => n.href),
      "/settings#accounts",
      "/settings#api-keys",
      "/settings#data",
      "/tools",
    ]);
    for (const t of TOOLS) {
      if (t.href) expect(routes.has(t.href), `${t.id} href ${t.href}`).toBe(true);
      if (t.setupHref) expect(routes.has(t.setupHref), `${t.id} setup ${t.setupHref}`).toBe(true);
    }
  });

  it("covers learning, planning, posting, replies, discovery, AI, accounts, backup and MCP", () => {
    for (const id of [
      "notes",
      "calendar",
      "growth",
      "autopost",
      "replies",
      "discover",
      "localAi",
      "scout",
      "tiktok",
      "instagram",
      "youtube",
      "threads",
      "backup",
      "mcp",
    ])
      expect(tool(id)).toBeTruthy();
    expect(new Set(ids(TOOLS)).size).toBe(TOOLS.length);
  });

  it("labels every tool in both languages, with message keys only and no secrets", () => {
    for (const t of TOOLS) {
      for (const key of [t.name, t.desc]) {
        expect(dict.ar[key], key).toBeTruthy();
        expect(dict.en[key], key).toBeTruthy();
      }
      const plain = JSON.stringify(t, (k, v) => (k === "icon" ? undefined : v));
      expect(plain).not.toMatch(/https?:|workers\.dev|token|secret/i);
    }
    for (const v of [...Object.values(dict.ar), ...Object.values(dict.en)])
      expect(v).not.toMatch(/https?:|workers\.dev|token=/i);
  });

  it("names the MCP tools and path without a token", () => {
    const en = dict.en[tool("mcp").desc];
    for (const name of ["search_videos", "get_trends", "save_picks", "get_picks", "/mcp"])
      expect(en).toContain(name);
    expect(tool("mcp").href).toBeUndefined();
    expect(tool("mcp").setupHref).toBe("/settings#api-keys");
  });

  it("lists the Inbox (packet DT-6A) as a built posting tool at /social/inbox; nothing is planned now", () => {
    expect(tool("inbox").group).toBe("publish");
    expect(tool("inbox").href).toBe("/social/inbox");
    expect(tool("inbox").setupHref).toBe("/social/inbox");
    expect(tool("inbox").permission).toBe("tools.inbox.permission");
    expect(TOOLS.filter((t) => t.group === "planned").map((t) => t.id)).toEqual([]);
    expect(dict.en[tool("inbox").desc]).not.toMatch(/not built/i);
    expect(dict.en[tool("inbox").desc]).toMatch(/nothing is sent/i);
  });

  it("reads Inbox readiness from the Instagram status and its reply permission, never green", () => {
    expect(tool("inbox").state(ctx())).toBe("setup");
    expect(tool("inbox").state(ctx({ apiKeys: SCOUT }))).toBe("unknown");
    const at = iso(HOUR);
    const ig = (over: Partial<SocialConnectionStatus>) =>
      ctx({ apiKeys: SCOUT, social: social({ instagram: { ...live, ...over } }, at) });
    expect(tool("inbox").state(ig({ canReply: true }))).toBe("lastKnown");
    expect(tool("inbox").state(ig({ canReply: false }))).toBe("permission");
    expect(tool("inbox").state(ig({ connected: false }))).toBe("setup");
  });

  it("lists the Business kit (packet DT-5) as an available posting tool at /social/business", () => {
    expect(tool("business").group).toBe("publish");
    expect(tool("business").state(ctx())).toBe("available");
    expect(tool("business").href).toBe("/social/business");
    expect(dict.en[tool("business").desc]).not.toMatch(/only explains/i);
  });
});

describe("workflow builder row (packet DT-4)", () => {
  it("is an available posting tool that opens /social/workflows", () => {
    expect(tool("workflows").group).toBe("publish");
    expect(tool("workflows").state(ctx())).toBe("available");
    expect(tool("workflows").href).toBe("/social/workflows");
  });

  it("says runs stay in this browser and sends nothing", () => {
    expect(dict.en[tool("workflows").desc]).toMatch(/this browser/);
    expect(dict.en[tool("workflows").desc]).toMatch(/nothing is posted/i);
    expect(dict.ar[tool("workflows").desc]).toMatch(/المتصفح/);
    expect(dict.en[tool("workflows").desc]).not.toMatch(/not built/i);
  });
});

describe("website CMS row (packet DT-3)", () => {
  it("is an available posting tool that opens the CMS", () => {
    expect(tool("website").group).toBe("publish");
    expect(tool("website").state(ctx())).toBe("available");
    expect(tool("website").href).toBe("/social/website");
  });

  it("says articles stay on this device and claims no publishing", () => {
    expect(dict.en[tool("website").name]).toMatch(/Articles/);
    expect(dict.en[tool("website").desc]).toMatch(/this device/);
    expect(dict.en[tool("website").desc]).toMatch(/nothing is public/i);
    expect(dict.ar[tool("website").desc]).toMatch(/الجهاز/);
  });

  it("is found by Arabic and English words", () => {
    expect(ids(searchTools("موقع"))).toContain("website");
    expect(ids(searchTools("articles"))).toContain("website");
  });
});

describe("searchTools", () => {
  it("returns every tool for an empty query", () => {
    expect(ids(searchTools(""))).toEqual(ids(TOOLS));
    expect(ids(searchTools("   "))).toEqual(ids(TOOLS));
  });

  it("finds Auto-replies by its Arabic or English name, whatever the UI language", () => {
    expect(ids(searchTools("ردود"))).toEqual(["replies"]);
    expect(ids(searchTools("replies"))).toEqual(["replies"]);
    expect(ids(searchTools("REPLIES"))).toEqual(["replies"]);
  });

  it("ignores Arabic diacritics", () => {
    expect(ids(searchTools("الرُّدود"))).toEqual(["replies"]);
  });

  it("returns nothing for a query no tool matches", () => {
    expect(searchTools("zzqx")).toEqual([]);
  });
});

describe("quickActionTools", () => {
  it("keeps every non-planned tool, in registry order, each with a destination", () => {
    const quick = quickActionTools();
    expect(ids(quick)).toEqual(ids(TOOLS.filter((t) => t.group !== "planned")));
    expect(ids(quick)).toContain("inbox");
    expect(ids(quick)).toContain("business");
    expect(ids(quick)).toContain("website");
    expect(ids(quick)).toContain("workflows");
    for (const t of quick) expect(t.href ?? t.setupHref, t.id).toBeTruthy();
  });
});

describe("accountReadiness", () => {
  // Amendment A: the stored status is not bound to the Worker URL/token, so it is only ever "last known".
  const PAST = "2020-01-01T00:00:00Z";
  const r = (status: SocialConnectionStatus | undefined, statusAt: string | null, worker = true) =>
    accountReadiness(status, statusAt, worker, "instagram");

  it("needs setup without the Worker", () => expect(r(live, iso(HOUR), false)).toBe("setup"));
  it("is unknown before any status was fetched", () => expect(r(undefined, null)).toBe("unknown"));
  it("is only last known, never connected, even when fresh", () =>
    expect(r(live, iso(HOUR))).toBe("lastKnown"));
  it("stays last known when the status is old", () =>
    expect(r(live, iso(25 * HOUR))).toBe("lastKnown"));
  it("is unknown when connected has no status time", () => expect(r(live, null)).toBe("unknown"));
  it("needs attention after a sync error", () =>
    expect(r({ ...live, lastError: "upstream" }, iso(HOUR))).toBe("attention"));
  it("needs attention when the token expired", () =>
    expect(r({ ...live, tokenExpiresAt: PAST }, iso(HOUR))).toBe("attention"));
  it("needs setup when disconnected", () =>
    expect(r({ configured: true, connected: false }, iso(HOUR))).toBe("setup"));
  it("needs setup when the platform is not set up in the Worker", () =>
    expect(r(undefined, iso(HOUR))).toBe("setup"));
});

describe("tool states", () => {
  it("never reports connected or stale for any tool", () => {
    const c = ctx({
      apiKeys: SCOUT,
      localAiHost: true,
      helperId: "a".repeat(32),
      social: social(
        Object.fromEntries(
          ["tiktok", "instagram", "youtube", "threads"].map((p) => [
            p,
            { ...live, canPublish: true, canReply: true },
          ]),
        ),
        iso(HOUR),
      ),
    });
    for (const t of TOOLS) expect(["connected", "stale"]).not.toContain(t.state(c));
  });

  it("calls saved Scout credentials configured, never connected", () => {
    expect(tool("scout").state(ctx())).toBe("setup");
    expect(tool("scout").state(ctx({ apiKeys: { scoutUrl: SCOUT.scoutUrl } }))).toBe("setup");
    expect(tool("scout").state(ctx({ apiKeys: SCOUT }))).toBe("configured");
    expect(tool("mcp").state(ctx({ apiKeys: SCOUT }))).toBe("configured");
    expect(tool("youtubeKey").state(ctx({ apiKeys: { youtube: "AIzaKey" } }))).toBe("configured");
    expect(tool("youtubeKey").state(ctx())).toBe("setup");
  });

  it("calls a saved Chrome helper configured and a local address host-only for AI", () => {
    expect(tool("helper").state(ctx())).toBe("setup");
    expect(tool("helper").state(ctx({ helperId: "a".repeat(32) }))).toBe("configured");
    expect(tool("localAi").state(ctx())).toBe("setup");
    expect(tool("localAi").state(ctx({ localAiHost: true }))).toBe("hostOnly");
    expect(tool("localAi").href).toBe("/discover");
  });

  it("reads each platform row from the stored status", () => {
    const c = ctx({
      apiKeys: SCOUT,
      social: social(
        { instagram: live, tiktok: { ...live, lastError: "token_expired" } },
        iso(HOUR),
      ),
    });
    expect(tool("instagram").state(c)).toBe("lastKnown");
    expect(tool("tiktok").state(c)).toBe("attention");
    expect(tool("youtube").state(c)).toBe("setup");
    expect(tool("threads").state(ctx({ apiKeys: SCOUT }))).toBe("unknown");
  });

  it("rates Auto-posting by the accounts allowed to publish", () => {
    const at = (status: SocialSyncState["status"]) =>
      tool("autopost").state(ctx({ apiKeys: SCOUT, social: social(status, iso(HOUR)) }));
    expect(tool("autopost").state(ctx())).toBe("setup");
    expect(tool("autopost").state(ctx({ apiKeys: SCOUT }))).toBe("unknown");
    expect(at({})).toBe("setup");
    expect(at({ instagram: live })).toBe("permission");
    expect(at({ instagram: { ...live, canPublish: true } })).toBe("lastKnown");
    // TikTok counts when either the inbox upload or direct posting is allowed.
    expect(at({ tiktok: { ...live, canUpload: false, canDirectPost: true } })).toBe("lastKnown");
    expect(at({ tiktok: { ...live, canUpload: true } })).toBe("lastKnown");
    expect(at({ tiktok: { ...live, canUpload: false, canDirectPost: false } })).toBe("permission");
    expect(tool("autopost").setupHref).toBe("/social/automations");
    expect(tool("autopost").permission).toBe("tools.autopost.permission");
  });

  it("rates Auto-replies by Instagram with the reply permission", () => {
    const at = (status: SocialSyncState["status"]) =>
      tool("replies").state(ctx({ apiKeys: SCOUT, social: social(status, iso(HOUR)) }));
    expect(tool("replies").state(ctx())).toBe("setup");
    expect(tool("replies").state(ctx({ apiKeys: SCOUT }))).toBe("unknown");
    expect(at({ instagram: { configured: true, connected: false } })).toBe("setup");
    expect(at({ instagram: live })).toBe("permission");
    expect(at({ instagram: { ...live, canReply: true } })).toBe("lastKnown");
    expect(tool("replies").setupHref).toBe("/social/replies");
    expect(tool("replies").permission).toBe("tools.replies.permission");
  });

  it("calls built-in screens available on this device", () => {
    for (const id of ["today", "skills", "notes", "calendar", "discover", "backup"])
      expect(tool(id).state(ctx())).toBe("available");
  });

  it("says the private backup includes the saved API keys", () => {
    expect(dict.en[tool("backup").desc]).toMatch(/API keys/);
    expect(dict.ar[tool("backup").desc]).toMatch(/مفاتيح/);
  });

  it("claims only what the hub does, and no personalized best times (Amendment B)", () => {
    expect(dict.en["tools.sub"]).toContain("does not run connection checks or start tools");
    expect(dict.en["tools.sub"]).not.toMatch(/connects to nothing/);
    expect(dict.en[tool("growth").desc]).toMatch(/suggested posting slots/);
    expect(dict.en[tool("growth").desc]).not.toMatch(/best time/i);
    expect(dict.ar[tool("growth").desc]).toMatch(/مقترحة/);
  });
});

describe("permission vs attention (repair round 1)", () => {
  const PAST = "2020-01-01T00:00:00Z";
  const state = (id: string, status: SocialSyncState["status"], statusAt: string | null) =>
    tool(id).state(ctx({ apiKeys: SCOUT, social: social(status, statusAt) }));

  it("never infers a posting permission failure without a status time", () =>
    expect(state("autopost", { instagram: { ...live, canPublish: true } }, null)).toBe("unknown"));
  it("asks for posting permission on a fresh account without publish scope", () =>
    expect(state("autopost", { instagram: live }, iso(HOUR))).toBe("permission"));
  it("counts TikTok inbox upload alone as able to post", () =>
    expect(state("autopost", { tiktok: { ...live, canUpload: true } }, iso(HOUR))).toBe(
      "lastKnown",
    ));
  it("rates Auto-posting attention when the only account has an error", () =>
    expect(
      state("autopost", { instagram: { ...live, canPublish: true, lastError: "x" } }, iso(HOUR)),
    ).toBe("attention"));
  it("keeps a reply-permitted account with a sync error at attention", () =>
    expect(
      state(
        "replies",
        { instagram: { ...live, canReply: true, lastError: "upstream" } },
        iso(HOUR),
      ),
    ).toBe("attention"));
  it("keeps a reply-permitted account with an expired token at attention", () =>
    expect(
      state("replies", { instagram: { ...live, canReply: true, tokenExpiresAt: PAST } }, iso(HOUR)),
    ).toBe("attention"));
  it("asks for reply permission on a fresh account without it", () =>
    expect(state("replies", { instagram: live }, iso(HOUR))).toBe("permission"));
  it("passes unknown through for replies without a status time", () =>
    expect(state("replies", { instagram: { ...live, canReply: true } }, null)).toBe("unknown"));
});
