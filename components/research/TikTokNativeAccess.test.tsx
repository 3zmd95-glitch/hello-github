// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TikTokNativeAccess from "./TikTokNativeAccess";
import {
  probeTikTokAccess,
  readTikTokStoredStatus,
  type TikTokAccessProbe,
} from "@/lib/tiktokAccess";
import en from "@/messages/feed.en.json";
import ar from "@/messages/feed.ar.json";

vi.mock("@/lib/tiktokAccess", () => ({
  readTikTokStoredStatus: vi.fn(),
  probeTikTokAccess: vi.fn(),
}));
let lang = "en";
vi.mock("@/lib/i18n", () => ({
  useT: () => ({
    lang,
    t: (key: keyof typeof en, values: Record<string, string | number> = {}) => {
      let text = (lang === "ar" ? ar : en)[key];
      for (const [name, value] of Object.entries(values))
        text = text.replace(`{${name}}`, String(value));
      return text;
    },
  }),
}));
const config = { url: "https://scout.test", token: "private" };
const probe: TikTokAccessProbe = {
  version: 1,
  categoryId: "anime",
  country: "US",
  dateRange: "7DAY",
  discoveryType: "HASHTAG",
  stage: "trending_list",
  status: "accepted",
  requests: 1,
  checkedAt: new Date().toISOString(),
  hashtagCount: 0,
};
let host: HTMLDivElement;
let root: Root;
const get = (id: string) => host.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;
const settle = () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
const render = (props: Partial<Parameters<typeof TikTokNativeAccess>[0]> = {}) =>
  act(() =>
    root.render(
      createElement(TikTokNativeAccess, { active: true, categoryId: "anime", config, ...props }),
    ),
  );
const check = async () => {
  act(() => get("tiktok-access-check").click());
  await settle();
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  lang = "en";
  vi.mocked(readTikTokStoredStatus)
    .mockReset()
    .mockResolvedValue({ ok: true, value: { connected: true, advertisers: 1 } });
  vi.mocked(probeTikTokAccess).mockReset().mockResolvedValue({ ok: true, value: probe });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("explicit TikTok native capability control", () => {
  it("does nothing on mount, opening details or rerender; one press reads status then probes", async () => {
    render();
    expect(get("tiktok-native-access").hasAttribute("open")).toBe(false);
    act(() => host.querySelector("summary")!.click());
    render();
    expect(readTikTokStoredStatus).not.toHaveBeenCalled();
    expect(probeTikTokAccess).not.toHaveBeenCalled();
    await check();
    expect(readTikTokStoredStatus).toHaveBeenCalledOnce();
    expect(probeTikTokAccess).toHaveBeenCalledOnce();
    expect(get("tiktok-access-result").textContent).toContain(en["feed.tiktokAccessEmpty"]);
    expect(get("tiktok-access-result").textContent).toContain(en["feed.tiktokAccessStored"]);
    render();
    await settle();
    expect(probeTikTokAccess).toHaveBeenCalledOnce();
  });
  it.each([
    { connected: false, advertisers: 0 },
    { connected: true, advertisers: 0 },
  ])("does not probe or initiate OAuth without a usable grant: %j", async (value) => {
    vi.mocked(readTikTokStoredStatus).mockResolvedValue({ ok: true, value });
    render();
    await check();
    expect(probeTikTokAccess).not.toHaveBeenCalled();
    expect(host.querySelectorAll("a")).toHaveLength(0);
    expect(get("tiktok-access-result").textContent).toContain(
      en[value.connected ? "feed.tiktokAccessNoAdvertiser" : "feed.tiktokAccessAbsent"],
    );
  });
  it("distinguishes Worker support from TikTok permission denial", async () => {
    vi.mocked(probeTikTokAccess)
      .mockResolvedValueOnce({ ok: false, error: "worker_unavailable" })
      .mockResolvedValueOnce({
        ok: true,
        value: { ...probe, status: "permission", hashtagCount: undefined },
      });
    render();
    await check();
    expect(get("tiktok-access-result").textContent).toContain(en["feed.tiktokAccessUpgrade"]);
    expect(get("tiktok-access-result").textContent).not.toContain(
      en["feed.tiktokAccessPermission"],
    );
    await check();
    expect(get("tiktok-access-result").textContent).toContain(en["feed.tiktokAccessPermission"]);
  });
  it.each(["category", "config", "inactive", "unmount"])(
    "cancels and rejects late status before any probe on %s",
    async (change) => {
      const pending = deferred<Awaited<ReturnType<typeof readTikTokStoredStatus>>>();
      vi.mocked(readTikTokStoredStatus).mockReturnValue(pending.promise);
      render();
      await check();
      const signal = vi.mocked(readTikTokStoredStatus).mock.calls[0][1]!.signal!;
      if (change === "unmount") act(() => root.render(null));
      else
        render(
          change === "category"
            ? { categoryId: "cars" }
            : change === "config"
              ? { config: { ...config, token: "changed" } }
              : { active: false },
        );
      expect(signal.aborted).toBe(true);
      pending.resolve({ ok: true, value: { connected: true, advertisers: 1 } });
      await settle();
      expect(probeTikTokAccess).not.toHaveBeenCalled();
      expect(get("tiktok-access-result")).toBeNull();
    },
  );
  it("cancels an in-flight probe and ignores its late accepted result", async () => {
    const pending = deferred<Awaited<ReturnType<typeof probeTikTokAccess>>>();
    vi.mocked(probeTikTokAccess).mockReturnValue(pending.promise);
    render();
    await check();
    act(() => get("tiktok-access-cancel").click());
    expect(vi.mocked(probeTikTokAccess).mock.calls[0][2]!.signal!.aborted).toBe(true);
    pending.resolve({ ok: true, value: probe });
    await settle();
    expect(get("tiktok-access-result").textContent).toContain(en["feed.tiktokAccessCancelled"]);
    expect(get("tiktok-access-result").textContent).not.toContain(en["feed.tiktokAccessEmpty"]);
  });
  it("uses Arabic copy and no provider text or IDs in a successful check", async () => {
    lang = "ar";
    render();
    await check();
    expect(host.textContent).toContain(ar["feed.tiktokAccessEmpty"]);
    expect(host.textContent).not.toContain("private");
    expect(host.textContent).not.toContain("trending_list");
  });
});
