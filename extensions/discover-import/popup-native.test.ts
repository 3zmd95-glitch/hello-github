// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NATIVE_ORIGINS } from "./native-protocol.js";

const html = readFileSync("extensions/discover-import/popup.html", "utf8");
const api = {
  permissions: { request: vi.fn() },
  runtime: { id: "eoffjihbiadleilmkaojegcecadmdigf" },
  tabs: { create: vi.fn() },
  scripting: { executeScript: vi.fn() },
};
const button = (id: string) => document.getElementById(id) as HTMLButtonElement;
beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  document.body.innerHTML = new DOMParser().parseFromString(html, "text/html").body.innerHTML;
  api.permissions.request.mockResolvedValue(true);
  api.tabs.create.mockResolvedValue({ id: 8 });
  vi.stubGlobal("chrome", api);
  await import("./popup.js");
});
afterEach(() => vi.unstubAllGlobals());

it("explains the optional scope in both languages and asks permission only on Connect click", async () => {
  expect(api.permissions.request).not.toHaveBeenCalled();
  expect(api.tabs.create).not.toHaveBeenCalled();
  expect(button("native-connect").textContent).toBe("اربط Discover");
  button("language").click();
  expect(document.getElementById("native-privacy")!.textContent).toContain(
    "only when you request search or more results",
  );
  button("native-connect").click();
  expect(api.permissions.request).toHaveBeenCalledExactlyOnceWith({ origins: NATIVE_ORIGINS });
  await vi.waitFor(() => expect(button("native-connect").disabled).toBe(false));
  expect(api.tabs.create).toHaveBeenCalledExactlyOnceWith({
    url: "http://localhost:3000/discover/#discover-helper=eoffjihbiadleilmkaojegcecadmdigf",
  });
  expect(api.scripting.executeScript).not.toHaveBeenCalled();
});

it("does not open Discover when optional access is declined", async () => {
  button("language").click();
  api.permissions.request.mockResolvedValue(false);
  button("native-connect").click();
  await vi.waitFor(() => expect(button("native-connect").disabled).toBe(false));
  expect(api.tabs.create).not.toHaveBeenCalled();
  expect(document.getElementById("native-status")!.textContent).toContain("Not connected");
  expect(button("capture").disabled).toBe(false);
});
