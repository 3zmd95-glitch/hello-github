// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const crop = vi.hoisted(() => vi.fn());
vi.mock("./video-capture.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  cropVideoScreenshot: crop,
}));
const html = readFileSync("extensions/discover-import/popup.html", "utf8");
const target = {
  url: "https://www.tiktok.com/@coffee/video/7692598509207325966",
  durationSeconds: 8,
  timestampSeconds: 1,
  capturedAt: "2026-10-11T16:00:00.000Z",
  rect: { x: 20, y: 10, width: 300, height: 400 },
  viewport: { width: 1000, height: 800 },
};
const chromeMock = {
  tabs: { query: vi.fn(), create: vi.fn(), captureVisibleTab: vi.fn() },
  scripting: { executeScript: vi.fn() },
};
const button = (id: string) => document.getElementById(id) as HTMLButtonElement;
async function take() {
  button("video-capture").click();
  await vi.waitFor(() => expect(button("video-capture").disabled).toBe(false));
}
beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  document.body.innerHTML = new DOMParser().parseFromString(html, "text/html").body.innerHTML;
  chromeMock.tabs.query.mockResolvedValue([{ id: 7, windowId: 1 }]);
  chromeMock.tabs.captureVisibleTab.mockResolvedValue("data:image/png;base64,full-page");
  chromeMock.scripting.executeScript.mockResolvedValue([{ result: target }]);
  crop.mockResolvedValue("data:image/jpeg;base64,/9j/AAA=");
  vi.stubGlobal("chrome", chromeMock);
  await import("./popup.js");
  button("language").click();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("requires explicit per-moment capture, previews only the crop, and never submits AI requests", async () => {
  expect(chromeMock.tabs.query).not.toHaveBeenCalled();
  expect(chromeMock.tabs.captureVisibleTab).not.toHaveBeenCalled();
  expect(chromeMock.tabs.create).not.toHaveBeenCalled();
  expect(button("video-save").disabled).toBe(true);
  await take();
  expect(chromeMock.tabs.captureVisibleTab).toHaveBeenCalledExactlyOnceWith(1, { format: "png" });
  expect(crop).toHaveBeenCalledWith("data:image/png;base64,full-page", target);
  expect(document.querySelector<HTMLImageElement>("#video-frames img")!.src).toBe(
    "data:image/jpeg;base64,/9j/AAA=",
  );
  expect(document.querySelector("#video-status")!.textContent).toBe("1 captures ready to review.");
  expect(button("video-save").disabled).toBe(true);
  expect(chromeMock.tabs.create).not.toHaveBeenCalled();
  chromeMock.scripting.executeScript.mockResolvedValue([
    { result: { ...target, timestampSeconds: 3 } },
  ]);
  crop.mockResolvedValue("data:image/jpeg;base64,/9j/BBB=");
  await take();
  expect(button("video-save").disabled).toBe(false);
  expect(document.querySelectorAll("#video-frames img")).toHaveLength(2);
  button("language").click();
  expect(document.documentElement.dir).toBe("rtl");
  expect(document.querySelectorAll("#video-frames img")).toHaveLength(2);
  button("video-reset").click();
  expect(document.querySelectorAll("#video-frames img")).toHaveLength(0);
  expect(button("video-save").disabled).toBe(true);
  expect(document.querySelector("#video-source")!.hasAttribute("href")).toBe(false);
});

it("does not capture unsupported pages, and discards a screenshot if the active tab changed", async () => {
  chromeMock.scripting.executeScript.mockResolvedValueOnce([{ result: { error: "unsupported" } }]);
  await take();
  expect(chromeMock.tabs.captureVisibleTab).not.toHaveBeenCalled();
  expect(document.querySelector("#video-status")!.textContent).toContain(
    "Open the TikTok post itself",
  );
  chromeMock.tabs.query
    .mockResolvedValueOnce([{ id: 7, windowId: 1 }])
    .mockResolvedValueOnce([{ id: 8, windowId: 1 }]);
  await take();
  expect(crop).not.toHaveBeenCalled();
  expect(document.querySelectorAll("#video-frames img")).toHaveLength(0);
  expect(document.querySelector("#video-status")!.textContent).toContain("post or tab changed");
});

it("exports only the approved crop bundle on Save, never the surrounding screenshot", async () => {
  const create = vi.fn((blob: Blob) => {
    expect(blob.type).toBe("application/json");
    return "blob:local-capture";
  });
  const revoke = vi.fn();
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }));
  const downloads: Array<{ href: string; name: string }> = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    downloads.push({ href: this.href, name: this.download });
  });
  await take();
  chromeMock.scripting.executeScript.mockResolvedValue([
    { result: { ...target, timestampSeconds: 3 } },
  ]);
  crop.mockResolvedValue("data:image/jpeg;base64,/9j/BBB=");
  await take();
  expect(create).not.toHaveBeenCalled();
  button("video-save").click();
  expect(downloads).toEqual([
    { href: "blob:local-capture", name: "discover-tiktok-capture-7692598509207325966.json" },
  ]);
  const blob = create.mock.calls[0][0] as Blob;
  const serialized = await new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.readAsText(blob);
  });
  const saved = JSON.parse(serialized);
  expect(saved.url).toBe(target.url);
  expect(saved.provenance).toBe("browser-visible-video");
  expect(saved.frames).toHaveLength(2);
  expect(saved.frames[0].dataUrl).toBe("data:image/jpeg;base64,/9j/AAA=");
  expect(serialized).not.toContain("full-page");
  expect(serialized).not.toContain("videoSha256");
  expect(chromeMock.tabs.create).not.toHaveBeenCalled();
});

it("preserves an earlier crop after a failed/repeated capture and only opens an empty local review", async () => {
  await take();
  await take();
  expect(document.querySelectorAll("#video-frames img")).toHaveLength(1);
  expect(document.querySelector("#video-status")!.textContent).toContain("different moment");
  chromeMock.tabs.captureVisibleTab.mockRejectedValueOnce(new Error("Stopped"));
  await take();
  expect(document.querySelectorAll("#video-frames img")).toHaveLength(1);
  button("video-open").click();
  await vi.waitFor(() =>
    expect(chromeMock.tabs.create).toHaveBeenCalledExactlyOnceWith({
      url: "http://localhost:3000/discover/#video-capture",
    }),
  );
});
