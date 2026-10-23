// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const html = readFileSync("extensions/discover-import/popup.html", "utf8");
const urls = [
  "https://www.youtube.com/watch?v=abcdefghijk",
  "https://www.youtube.com/watch?v=12345678901",
  "https://www.youtube.com/watch?v=lmnopqrstuv",
];
const captured = [{ result: { version: 1, platform: "yt", urls } }];
const chromeMock = {
  tabs: { query: vi.fn(), create: vi.fn() },
  scripting: { executeScript: vi.fn() },
};
const button = (id: string) => document.getElementById(id) as HTMLButtonElement;
const status = () => document.getElementById("status")!.textContent;
const choices = () => [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];

async function capture() {
  button("capture").click();
  await vi.waitFor(() => expect(button("capture").disabled).toBe(false));
}

beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  const fixture = new DOMParser().parseFromString(html, "text/html");
  document.body.replaceChildren(...fixture.body.childNodes);
  chromeMock.tabs.query.mockResolvedValue([{ id: 7 }]);
  chromeMock.scripting.executeScript.mockResolvedValue(captured);
  chromeMock.tabs.create.mockResolvedValue({ id: 8 });
  vi.stubGlobal("chrome", chromeMock);
  await import("./popup.js");
});

afterEach(() => vi.unstubAllGlobals());

it("captures only on request, preserves choices across languages, and opens one selected-link review", async () => {
  expect(document.documentElement.lang).toBe("ar");
  expect(document.documentElement.dir).toBe("rtl");
  expect(chromeMock.tabs.query).not.toHaveBeenCalled();
  expect(chromeMock.scripting.executeScript).not.toHaveBeenCalled();
  expect(chromeMock.tabs.create).not.toHaveBeenCalled();
  button("language").click();
  expect(document.documentElement.lang).toBe("en");
  expect(document.documentElement.dir).toBe("ltr");
  expect(button("capture").textContent).toBe("Find visible links");
  expect(chromeMock.tabs.query).not.toHaveBeenCalled();

  await capture();
  expect(chromeMock.tabs.query).toHaveBeenCalledExactlyOnceWith({
    active: true,
    currentWindow: true,
  });
  expect(chromeMock.scripting.executeScript).toHaveBeenCalledExactlyOnceWith({
    target: { tabId: 7 },
    func: expect.any(Function),
  });
  expect(choices()).toHaveLength(3);
  expect(choices().every((checkbox) => !checkbox.checked)).toBe(true);
  expect(button("review").disabled).toBe(true);
  choices()[0].click();
  choices()[2].click();
  button("language").click();
  expect(document.documentElement.dir).toBe("rtl");
  expect(choices().map((checkbox) => checkbox.checked)).toEqual([true, false, true]);
  button("language").click();
  expect(button("review").textContent).toBe("Review in Discover (2)");

  let finish!: () => void;
  chromeMock.tabs.create.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  button("review").click();
  expect(button("review").disabled).toBe(true);
  button("review").dispatchEvent(new Event("click"));
  expect(chromeMock.tabs.create).toHaveBeenCalledExactlyOnceWith({
    url: `http://localhost:3000/discover/#discover-import=${encodeURIComponent(
      JSON.stringify({
        version: 1,
        platform: "yt",
        urls: [urls[0], urls[2]],
      }),
    )}`,
  });
  finish();
  await vi.waitFor(() => expect(status()).toBe("Opened the review page in Discover."));
});

it("recovers from capture and open errors and clears old choices when capturing again", async () => {
  button("language").click();
  chromeMock.tabs.query.mockRejectedValueOnce(new Error("Temporary access failure"));
  await capture();
  expect(status()).toContain("Couldn't read this page");
  expect(chromeMock.scripting.executeScript).not.toHaveBeenCalled();
  expect(button("review").hidden).toBe(true);

  chromeMock.scripting.executeScript.mockResolvedValueOnce([
    { result: { error: "unsupported-page", urls: [] } },
  ]);
  await capture();
  expect(status()).toContain("Open TikTok or YouTube search results");
  await capture();
  choices()[1].click();
  chromeMock.tabs.create.mockRejectedValueOnce(new Error("Temporary tab failure"));
  button("review").click();
  await vi.waitFor(() => expect(status()).toBe("Couldn't open the review page. Try again."));
  expect(button("review").disabled).toBe(false);
  expect(choices()[1].checked).toBe(true);
  button("review").click();
  await vi.waitFor(() => expect(status()).toBe("Opened the review page in Discover."));
  expect(chromeMock.tabs.create).toHaveBeenCalledTimes(2);

  chromeMock.scripting.executeScript.mockResolvedValueOnce([
    { result: { version: 1, platform: "yt", urls: [] } },
  ]);
  await capture();
  expect(status()).toContain("No visible video links found");
  expect(choices()).toHaveLength(0);
  expect(button("review").hidden).toBe(true);
  await capture();
  expect(choices().every((checkbox) => !checkbox.checked)).toBe(true);
  expect(button("review").disabled).toBe(true);
});
