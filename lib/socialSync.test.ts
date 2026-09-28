import { describe, expect, it, vi } from "vitest";
import { SOCIAL_SEED_DAY } from "@/data/social-seed";
import {
  accountState,
  applySocialData,
  parseSocialData,
  parseSocialStatus,
  pullIsDue,
  PULL_INTERVAL_MS,
  sinceFor,
  snapshotSource,
  socialConnectUrl,
  socialData,
  socialDisconnect,
  socialErrorType,
  socialHealth,
  socialStatus,
  socialSyncErrorMessageKey,
  socialSyncNow,
  timeAgo,
  type SocialDataStore,
} from "./socialSync";

const CONFIG = { url: "https://scout.test", token: "tok" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const replying = (body: unknown, status = 200) =>
  vi.fn<typeof fetch>(async () => jsonResponse(body, status));

const authOf = (fetchImpl: ReturnType<typeof replying>) =>
  (fetchImpl.mock.calls[0][1]?.headers as Record<string, string>).Authorization;

const STATUS = {
  platforms: {
    instagram: {
      configured: true,
      connected: true,
      handle: "3z.prod",
      url: "https://www.instagram.com/3z.prod/",
      lastSyncAt: "2026-09-27T06:00:00.000Z",
    },
    youtube: { configured: true, connected: false },
    tiktok: { configured: false, connected: false },
    threads: { configured: true, connected: false },
    facebook: { configured: true, connected: true },
    x: { configured: "yes" },
  },
};

describe("error mapping", () => {
  it.each([
    [401, { error: "unauthorized" }, "auth"],
    [403, { error: "auth" }, "auth"],
    [429, { error: "rate_limited" }, "rate_limited"],
    [429, "slow down", "rate_limited"],
    [400, { error: "bad_request" }, "bad_request"],
    [400, { error: "not_configured" }, "not_configured"],
    [409, { error: "not_connected" }, "not_connected"],
    [400, { error: "state_invalid" }, "state_invalid"],
    [502, { error: "exchange_failed" }, "exchange_failed"],
    [401, { error: "token_expired" }, "auth"],
    [502, { error: "token_expired" }, "token_expired"],
    [502, { error: "upstream" }, "upstream"],
    [500, "oops", "upstream"],
    [400, { error: "something_new" }, "bad_request"],
  ])("maps HTTP %i %j to %s", async (status, body, type) => {
    const r = await socialStatus(CONFIG, { fetchImpl: replying(body, status) });
    expect(r).toEqual({ ok: false, error: { type, status } });
  });

  it("maps a thrown fetch to network and a missing config to unconfigured", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await socialStatus(CONFIG, { fetchImpl })).toEqual({
      ok: false,
      error: { type: "network" },
    });
    expect(await socialStatus(null, { fetchImpl })).toEqual({
      ok: false,
      error: { type: "unconfigured" },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("has a message key for every error type and falls back for unknown reason codes", () => {
    expect(socialSyncErrorMessageKey({ type: "token_expired" })).toBe(
      "settings.accounts.err.expired",
    );
    expect(socialSyncErrorMessageKey({ type: "exchange_failed" })).toBe(
      "settings.accounts.err.exchange",
    );
    expect(socialSyncErrorMessageKey({ type: "network" })).toBe("settings.accounts.err.network");
    expect(socialSyncErrorMessageKey({ type: "unconfigured" })).toBe(
      "settings.accounts.err.unconfigured",
    );
    expect(socialErrorType("exchange_failed")).toBe("exchange_failed");
    expect(socialErrorType("weird")).toBe("upstream");
    expect(socialErrorType(null)).toBe("upstream");
  });
});

describe("socialHealth", () => {
  it("reads the social block with the token", async () => {
    const fetchImpl = replying({
      ok: true,
      auth: true,
      tavily: true,
      social: { configured: { instagram: true, youtube: true, facebook: true }, kv: true },
    });
    const r = await socialHealth(CONFIG, { fetchImpl });
    expect(fetchImpl.mock.calls[0][0]).toBe("https://scout.test/health");
    expect(authOf(fetchImpl)).toBe("Bearer tok");
    expect(r).toEqual({
      ok: true,
      social: {
        configured: { tiktok: false, instagram: true, youtube: true, threads: false },
        kv: true,
      },
    });
  });

  it("treats a reply without the social block as an auth problem (the token never reached it)", async () => {
    expect(await socialHealth(CONFIG, { fetchImpl: replying({ ok: true }) })).toEqual({
      ok: false,
      error: { type: "auth" },
    });
  });
});

describe("socialStatus", () => {
  it("GETs /social/status and keeps only the four platforms with valid entries", async () => {
    const fetchImpl = replying(STATUS);
    const r = await socialStatus(CONFIG, { fetchImpl });
    expect(fetchImpl.mock.calls[0][0]).toBe("https://scout.test/social/status");
    expect(authOf(fetchImpl)).toBe("Bearer tok");
    expect(r.ok && Object.keys(r.platforms).sort()).toEqual([
      "instagram",
      "threads",
      "tiktok",
      "youtube",
    ]);
    expect(r.ok && r.platforms.instagram).toEqual(STATUS.platforms.instagram);
  });

  it("parses an empty or malformed reply to no platforms", () => {
    expect(parseSocialStatus({})).toEqual({});
    expect(parseSocialStatus(null)).toEqual({});
    expect(parseSocialStatus({ platforms: [] })).toEqual({});
  });
});

describe("connect / disconnect / sync", () => {
  it("POSTs the returnTo and returns the OAuth url", async () => {
    const fetchImpl = replying({ url: "https://accounts.google.com/o/oauth2/auth?x=1" });
    const r = await socialConnectUrl(CONFIG, "youtube", "https://app.test/settings/", {
      fetchImpl,
    });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://scout.test/social/connect/youtube");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ returnTo: "https://app.test/settings/" });
    expect(r).toEqual({ ok: true, url: "https://accounts.google.com/o/oauth2/auth?x=1" });
  });

  it("refuses a connect reply without an http(s) url", async () => {
    expect(
      await socialConnectUrl(CONFIG, "tiktok", "https://app.test/", {
        fetchImpl: replying({ url: "javascript:alert(1)" }),
      }),
    ).toEqual({ ok: false, error: { type: "upstream" } });
    expect(
      await socialConnectUrl(CONFIG, "tiktok", "https://app.test/", {
        fetchImpl: replying({ error: "not_configured" }, 400),
      }),
    ).toEqual({ ok: false, error: { type: "not_configured", status: 400 } });
  });

  it("DELETEs /social/connect/:platform", async () => {
    const fetchImpl = replying({ ok: true });
    expect(await socialDisconnect(CONFIG, "instagram", { fetchImpl })).toEqual({ ok: true });
    expect(fetchImpl.mock.calls[0][0]).toBe("https://scout.test/social/connect/instagram");
    expect(fetchImpl.mock.calls[0][1]?.method).toBe("DELETE");
  });

  it("POSTs /social/sync with the platforms (or an empty body) and normalizes the outcome", async () => {
    const fetchImpl = replying({
      synced: ["instagram", 3],
      errors: { youtube: "token_expired", tiktok: 7 },
    });
    const r = await socialSyncNow(CONFIG, ["instagram", "youtube"], { fetchImpl });
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))).toEqual({
      platforms: ["instagram", "youtube"],
    });
    expect(r).toEqual({ ok: true, synced: ["instagram"], errors: { youtube: "token_expired" } });
    await socialSyncNow(CONFIG, undefined, { fetchImpl });
    expect(JSON.parse(String(fetchImpl.mock.calls[1][1]?.body))).toEqual({});
    expect(await socialSyncNow(CONFIG, undefined, { fetchImpl: replying({}) })).toEqual({
      ok: true,
      synced: [],
      errors: {},
    });
  });
});

describe("socialData + applySocialData", () => {
  const DATA = {
    accounts: [
      { platform: "tiktok", handle: "3z.prod", url: "https://www.tiktok.com/@3z.prod" },
      { platform: "facebook", handle: "x" },
      { platform: "youtube", handle: " " },
    ],
    snapshots: [
      { platform: "tiktok", day: "2026-09-27", followers: 1300, avgViews: 31000 },
      { platform: "mars", day: "2026-09-27", followers: 1 },
      null,
    ],
    postStats: [
      { platform: "tiktok", postId: "7001", publishedAt: "2026-09-26T14:00:00.000Z", views: 41200 },
    ],
    demographics: [
      { platform: "tiktok", day: "2026-09-27", dimension: "gender", key: "male", pct: 56 },
      { platform: "nope", day: "2026-09-27", dimension: "gender", key: "male", pct: 56 },
    ],
    syncedAt: { tiktok: "2026-09-27T06:00:00.000Z", facebook: "2026-09-27T06:00:00.000Z" },
  };

  it("GETs /social/data with the encoded since day and drops rows of unknown platforms", async () => {
    const fetchImpl = replying(DATA);
    const r = await socialData(CONFIG, "2026-09-25", { fetchImpl });
    expect(fetchImpl.mock.calls[0][0]).toBe("https://scout.test/social/data?since=2026-09-25");
    expect(r.ok && r.data).toEqual({
      accounts: [DATA.accounts[0]],
      snapshots: [DATA.snapshots[0]],
      postStats: DATA.postStats,
      demographics: [DATA.demographics[0]],
      syncedAt: { tiktok: "2026-09-27T06:00:00.000Z" },
    });
    await socialData(CONFIG, undefined, { fetchImpl });
    expect(fetchImpl.mock.calls[1][0]).toBe("https://scout.test/social/data");
  });

  it("parses an empty reply to empty lists", () => {
    expect(parseSocialData(undefined)).toEqual({
      accounts: [],
      snapshots: [],
      postStats: [],
      demographics: [],
      syncedAt: {},
    });
  });

  it("writes every table through the store's import actions and sets the accounts", () => {
    const store: SocialDataStore = {
      importSnapshots: vi.fn(),
      importPostStats: vi.fn(),
      importDemographics: vi.fn(),
      setAccount: vi.fn(),
    };
    applySocialData(store, parseSocialData(DATA));
    expect(store.importSnapshots).toHaveBeenCalledWith([DATA.snapshots[0]]);
    expect(store.importPostStats).toHaveBeenCalledWith(DATA.postStats);
    expect(store.importDemographics).toHaveBeenCalledWith([DATA.demographics[0]]);
    expect(store.setAccount).toHaveBeenCalledTimes(1);
    expect(store.setAccount).toHaveBeenCalledWith(
      "tiktok",
      "3z.prod",
      "https://www.tiktok.com/@3z.prod",
    );
    // Empty tables never touch the store.
    const empty: SocialDataStore = {
      importSnapshots: vi.fn(),
      importPostStats: vi.fn(),
      importDemographics: vi.fn(),
      setAccount: vi.fn(),
    };
    applySocialData(empty, parseSocialData({}));
    expect(empty.importSnapshots).not.toHaveBeenCalled();
    expect(empty.importDemographics).not.toHaveBeenCalled();
  });
});

describe("sinceFor / pullIsDue", () => {
  it("re-reads from two days before the last pull's Riyadh day", () => {
    // 22:30 UTC on Sep 26 is already Sep 27 in Riyadh.
    expect(sinceFor("2026-09-26T22:30:00.000Z")).toBe("2026-09-25");
    expect(sinceFor("2026-09-27T06:00:00.000Z")).toBe("2026-09-25");
    expect(sinceFor(null)).toBeUndefined();
    expect(sinceFor(undefined)).toBeUndefined();
    expect(sinceFor("not a date")).toBeUndefined();
  });

  it("is due when never pulled, unparsable, or an hour or more ago", () => {
    const now = Date.parse("2026-09-27T12:00:00.000Z");
    expect(pullIsDue(null, now)).toBe(true);
    expect(pullIsDue("garbage", now)).toBe(true);
    expect(pullIsDue("2026-09-27T11:30:00.000Z", now)).toBe(false);
    expect(pullIsDue(new Date(now - PULL_INTERVAL_MS).toISOString(), now)).toBe(true);
  });
});

describe("snapshotSource / accountState / timeAgo", () => {
  const live = { configured: true, connected: true, lastSyncAt: "2026-09-27T06:00:00.000Z" };

  it("labels live, beacons, manual and none", () => {
    expect(snapshotSource("tiktok", "2026-09-27", live)).toBe("live");
    expect(snapshotSource("tiktok", "2026-09-28", live)).toBe("live");
    // Connected but the latest row predates the sync: someone typed it, or the pull has not landed yet.
    expect(snapshotSource("tiktok", "2026-09-26", live)).toBe("manual");
    // The seed row is Beacons only while the platform is not connected.
    expect(snapshotSource("instagram", SOCIAL_SEED_DAY, undefined)).toBe("beacons");
    expect(
      snapshotSource("instagram", SOCIAL_SEED_DAY, { configured: true, connected: false }),
    ).toBe("beacons");
    expect(snapshotSource("instagram", SOCIAL_SEED_DAY, live)).toBe("live");
    // Snapchat is never seeded, and a connected platform without lastSyncAt is not live yet.
    expect(snapshotSource("snapchat", SOCIAL_SEED_DAY, undefined)).toBe("manual");
    expect(snapshotSource("tiktok", "2026-09-27", { configured: true, connected: true })).toBe(
      "manual",
    );
    expect(snapshotSource("tiktok", null, live)).toBe("none");
  });

  it("derives the Settings row state", () => {
    expect(accountState(undefined)).toBe("not_configured");
    expect(accountState({ configured: false, connected: false })).toBe("not_configured");
    expect(accountState({ configured: true, connected: false })).toBe("disconnected");
    expect(accountState(live)).toBe("connected");
    expect(accountState({ ...live, lastError: "token_expired" })).toBe("error");
    expect(accountState({ ...live, tokenExpiresAt: "2020-01-01T00:00:00.000Z" })).toBe("error");
    expect(accountState({ ...live, tokenExpiresAt: "2999-01-01T00:00:00.000Z" })).toBe("connected");
    // YouTube (1 h) and TikTok (24 h) access tokens renew themselves: a past expiry is not "reconnect".
    const past = { ...live, tokenExpiresAt: "2020-01-01T00:00:00.000Z" };
    expect(accountState(past, "youtube")).toBe("connected");
    expect(accountState(past, "tiktok")).toBe("connected");
    expect(accountState(past, "instagram")).toBe("error");
    expect(accountState(past, "threads")).toBe("error");
    // …but a failed refresh the Worker recorded still asks for a reconnect.
    expect(accountState({ ...past, lastError: "token_expired" }, "youtube")).toBe("error");
  });

  it("formats coarse relative times in both languages", () => {
    const now = Date.parse("2026-09-27T12:00:00.000Z");
    expect(timeAgo("2026-09-27T10:00:00.000Z", "en", now)).toBe("2 hours ago");
    expect(timeAgo("2026-09-27T10:00:00.000Z", "ar", now)).toBe("قبل ساعتين");
    expect(timeAgo("2026-09-27T11:55:00.000Z", "en", now)).toBe("5 minutes ago");
    expect(timeAgo("2026-09-24T12:00:00.000Z", "en", now)).toBe("3 days ago");
    expect(timeAgo("2026-09-27T11:59:50.000Z", "en", now)).toBe("now");
    expect(timeAgo("nope", "en", now)).toBe("");
  });
});
