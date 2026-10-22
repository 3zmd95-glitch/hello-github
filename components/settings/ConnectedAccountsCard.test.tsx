// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStore } from "@/store";
import ConnectedAccountsCard from "./ConnectedAccountsCard";

// 🗑️ "Delete stored messages": the card's button asks first, then sends one `DELETE /social/inbox` to the Worker
// and says how it went in a toast. Without a Worker it is off (the card above already says why).

const spy = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => "/settings/" }));
vi.mock("@/components/celebrate/CelebrationProvider", () => ({
  useCelebrate: () => ({ toast: spy.toast, pulse: () => {} }),
}));

let fetchMock: ReturnType<typeof vi.fn>;
function serve(status = 200, body: unknown = { ok: true }) {
  fetchMock = vi.fn(async () => ({ ok: status < 400, status, json: async () => body }) as Response);
  vi.stubGlobal("fetch", fetchMock);
}

function configure(on: boolean) {
  const s = useStore.getState();
  s.setSettings({
    lang: "ar",
    apiKeys: {
      ...s.settings.apiKeys,
      scoutUrl: on ? "https://scout.test" : "",
      scoutToken: on ? "t" : "",
    },
  });
  // A pull from just now: the card's own hourly pull stays out of the way of the calls counted here.
  useStore.setState({
    socialSync: { ...s.socialSync, lastPullAt: new Date().toISOString() },
  });
}

let host: HTMLDivElement;
let root: Root;

function mount() {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(<ConnectedAccountsCard />));
}

const byId = (id: string) => document.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`);
const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  spy.toast.mockClear();
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("ConnectedAccountsCard's Delete stored messages", () => {
  it("is off without a Worker and calls nothing", () => {
    configure(false);
    serve();
    mount();
    const wipe = byId("accounts-wipe-inbox")!;
    expect(wipe.textContent).toBe("احذف الرسائل المخزنة");
    expect(wipe.disabled).toBe(true);
    act(() => wipe.click());
    expect(byId("confirm-dialog")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("asks first; Cancel sends nothing", () => {
    configure(true);
    serve();
    mount();
    act(() => byId("accounts-wipe-inbox")!.click());
    const dialog = byId("confirm-dialog")!;
    expect(dialog.textContent).toContain("احذف الرسائل المخزنة");
    expect(dialog.textContent).toContain("رسائلك وتعليقاتك في إنستقرام نفسه ما تنحذف");
    act(() => byId("confirm-cancel")!.click());
    expect(byId("confirm-dialog")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(spy.toast).not.toHaveBeenCalled();
  });

  it("confirming sends one DELETE /social/inbox with the token and says it is done", async () => {
    configure(true);
    serve();
    mount();
    act(() => byId("accounts-wipe-inbox")!.click());
    act(() => byId("confirm-ok")!.click());
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://scout.test/social/inbox");
    expect(init.method).toBe("DELETE");
    expect(init.headers).toMatchObject({ Authorization: "Bearer t" });
    expect(byId("confirm-dialog")).toBeNull();
    expect(spy.toast).toHaveBeenCalledTimes(1);
    expect(spy.toast).toHaveBeenCalledWith(
      "notice",
      expect.objectContaining({ name: "انحذفت الرسائل المخزنة" }),
    );
    expect(byId("accounts-wipe-inbox")!.disabled).toBe(false);
  });

  it("a refused wipe says why, as a warning, and does not claim it worked", async () => {
    configure(true);
    serve(401, { error: "unauthorized" });
    mount();
    act(() => byId("accounts-wipe-inbox")!.click());
    act(() => byId("confirm-ok")!.click());
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(spy.toast).toHaveBeenCalledTimes(1);
    const [, payload] = spy.toast.mock.calls[0] as [string, { name: string; tone?: string }];
    expect(payload.tone).toBe("warn");
    expect(payload.name).not.toBe("انحذفت الرسائل المخزنة");
    expect(payload.name.length).toBeGreaterThan(0);
  });
});
