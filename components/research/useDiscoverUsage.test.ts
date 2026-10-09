// @vitest-environment jsdom
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScoutConfig } from "@/lib/scoutClient";
import { discoverUsage } from "@/lib/discover";
import { useDiscoverUsage } from "./useDiscover";

vi.mock("@/lib/discover", async (original) => ({
  ...(await original<typeof import("@/lib/discover")>()),
  discoverUsage: vi.fn(),
}));
const config: ScoutConfig = { url: "https://worker.example", token: "test" };
const usage = {
  tavily: { used: 947, limit: 1000 },
  youtube: { usedToday: 26, cap: 66 },
  connector: { usedToday: 0, cap: 60 },
};
let host: HTMLDivElement;
let root: Root;
let latest: ReturnType<typeof useDiscoverUsage>;
function Harness({ refresh, enabled }: { refresh: number | null; enabled: boolean }) {
  const result = useDiscoverUsage(enabled ? config : null, refresh);
  useEffect(() => {
    latest = result;
  }, [result]);
  return createElement("output", null, JSON.stringify(result));
}
async function render(refresh: number | null, enabled = true) {
  await act(async () => root.render(createElement(Harness, { refresh, enabled })));
}
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.mocked(discoverUsage).mockReset().mockResolvedValue({ ok: true, usage });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
describe("real usage refresh after completed attempts", () => {
  it("keeps passive reads cached, then requests fresh usage after a search or expansion completes", async () => {
    await render(0);
    expect(discoverUsage).toHaveBeenLastCalledWith(config, { refresh: false });
    await render(null);
    expect(discoverUsage).toHaveBeenCalledTimes(1);
    await render(0);
    expect(discoverUsage).toHaveBeenLastCalledWith(config, { refresh: true });
    await render(0);
    expect(discoverUsage).toHaveBeenCalledTimes(2);
    await render(1);
    expect(discoverUsage).toHaveBeenLastCalledWith(config, { refresh: true });
    expect(discoverUsage).toHaveBeenCalledTimes(3);
    expect(latest?.tavily).not.toHaveProperty("observedAt");
  });
  it("refreshes after a failed expansion too, without retrying either usage failures or provider searches", async () => {
    await render(0);
    vi.mocked(discoverUsage).mockResolvedValueOnce({ ok: false, error: { type: "network" } });
    await render(1);
    expect(discoverUsage).toHaveBeenLastCalledWith(config, { refresh: true });
    expect(latest).toEqual(usage);
    await render(1);
    expect(discoverUsage).toHaveBeenCalledTimes(2);
    await render(null);
    await render(2);
    expect(discoverUsage).toHaveBeenLastCalledWith(config, { refresh: true });
    expect(discoverUsage).toHaveBeenCalledTimes(3);
  });
  it("does not fetch when inactive and does not label an older Worker response freshly observed", async () => {
    await render(0, false);
    expect(discoverUsage).not.toHaveBeenCalled();
    await render(0);
    expect(latest).toEqual(usage);
    await render(1, false);
    expect(discoverUsage).toHaveBeenCalledTimes(1);
    expect(latest).toBeNull();
  });
});
