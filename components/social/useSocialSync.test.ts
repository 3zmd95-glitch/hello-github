// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

// The Worker calls are mocked: each status read answers from `statusReplies` in order.
const statusReplies: Array<Record<string, { configured: boolean; connected: boolean }>> = [];
vi.mock("@/lib/socialSync", async (orig) => {
  const real = await orig<typeof import("@/lib/socialSync")>();
  return {
    ...real,
    socialStatus: vi.fn(async () => ({ ok: true, platforms: statusReplies.shift() ?? {} })),
    socialData: vi.fn(async () => ({
      ok: true,
      data: { accounts: [], snapshots: [], postStats: [], demographics: [], syncedAt: {} },
    })),
  };
});

const { confirmConnected } = await import("./useSocialSync");
const { useStore } = await import("@/store");

const sleep = vi.fn(async () => {});

beforeEach(() => {
  statusReplies.length = 0;
  sleep.mockClear();
  useStore
    .getState()
    .setSettings({ apiKeys: { scoutUrl: "https://scout.test", scoutToken: "tok" } });
  useStore.getState().setSocialSyncStatus({ tiktok: { configured: true, connected: false } });
});

describe("confirmConnected", () => {
  it("re-pulls until the just-connected platform shows up (Worker storage lagging behind the connect)", async () => {
    statusReplies.push(
      { tiktok: { configured: true, connected: false } },
      { tiktok: { configured: true, connected: true } },
    );
    expect(await confirmConnected("tiktok", [5, 15, 40], sleep)).toBe(true);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(useStore.getState().socialSync.status?.tiktok?.connected).toBe(true);
  });

  it("does nothing when the status already says connected", async () => {
    useStore.getState().setSocialSyncStatus({ tiktok: { configured: true, connected: true } });
    expect(await confirmConnected("tiktok", [5, 15, 40], sleep)).toBe(true);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("gives up after the last delay and reports false", async () => {
    expect(await confirmConnected("tiktok", [5, 15], sleep)).toBe(false);
    expect(sleep).toHaveBeenCalledTimes(2);
  });
});
