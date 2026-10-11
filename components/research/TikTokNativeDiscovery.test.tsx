// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import TikTokNativeDiscovery from "./TikTokNativeDiscovery";
import { acquireTikTokEdits, type TikTokAcquisition } from "@/lib/tiktokAccess";

vi.mock("@/lib/tiktokAccess", () => ({ acquireTikTokEdits: vi.fn() }));
vi.mock("@/lib/i18n", () => ({ useT: () => ({ t: (key: string) => key }) }));
const config = { url: "https://worker.test", token: "fixture" };
const value: TikTokAcquisition = {
  version: 1,
  categoryId: "anime",
  country: "US",
  dateRange: "7DAY",
  checkedAt: new Date().toISOString(),
  status: "accepted",
  captioned: 0,
  items: [
    {
      platform: "tt",
      url: "https://www.tiktok.com/@artist/video/7559999999000000001",
      title: "TikTok video",
      snippet: "",
      handle: "@artist",
      lang: "en",
      section: "example",
    },
  ],
};
let host: HTMLDivElement;
let root: Root;
const onCandidates = vi.fn();
const render = (props: Partial<Parameters<typeof TikTokNativeDiscovery>[0]> = {}) =>
  act(() =>
    root.render(
      createElement(TikTokNativeDiscovery, {
        config,
        categoryId: "anime",
        active: true,
        onCandidates,
        ...props,
      }),
    ),
  );
const click = async () =>
  act(async () => {
    host.querySelector<HTMLButtonElement>("[data-testid=tiktok-find-edits]")!.click();
  });
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  onCandidates.mockReset();
  vi.mocked(acquireTikTokEdits).mockReset().mockResolvedValue({ ok: true, value });
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
it("retrieves only on explicit action and passes unmodified leads once, with no invented preferences", async () => {
  render();
  expect(acquireTikTokEdits).not.toHaveBeenCalled();
  await click();
  expect(onCandidates).toHaveBeenCalledExactlyOnceWith(value.items);
  expect(host.textContent).toContain("feed.tiktokFindResult");
  await click();
  expect(acquireTikTokEdits).toHaveBeenCalledTimes(1);
});
it.each([{ categoryId: "coffee" }, { active: false }, { config: { ...config, token: "rotated" } }])(
  "discards a late response after scope changes",
  async (next) => {
    let resolve!: (result: Awaited<ReturnType<typeof acquireTikTokEdits>>) => void;
    vi.mocked(acquireTikTokEdits).mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    render();
    await click();
    const signal = vi.mocked(acquireTikTokEdits).mock.calls[0][2]?.signal;
    render(next);
    expect(signal?.aborted).toBe(true);
    await act(async () => resolve({ ok: true, value }));
    expect(onCandidates).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain("feed.tiktokFindResult");
  },
);
it("does not replace existing candidates when the provider fails", async () => {
  vi.mocked(acquireTikTokEdits).mockResolvedValue({
    ok: true,
    value: { ...value, status: "upstream", items: [], captioned: 0 },
  });
  render();
  await click();
  expect(onCandidates).not.toHaveBeenCalled();
  expect(host.textContent).toContain("feed.tiktokAccessUpstream");
});
