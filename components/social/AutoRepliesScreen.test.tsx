// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStore } from "@/store";
import AutoRepliesScreen from "./AutoRepliesScreen";

// 💬 The auto-replies log (packet DT-6B-2C-2-R1): the Worker's skipped DM outcome (already answered, or the
// conversation is held by a person) is its own neutral row, neither sent nor failed, in both languages.

vi.mock("next/navigation", () => ({ usePathname: () => "/social/replies/" }));

const WORKER = "https://scout.test";
let host: HTMLDivElement;
let root: Root;

const S = () => useStore.getState();
const rows = () => [...host.querySelectorAll<HTMLElement>('[data-testid="autoreplies-log-row"]')];

const entry = (messageId: string, dm: string, over: Record<string, unknown> = {}) => ({
  at: "2026-09-29T09:00:00.000Z",
  kind: "message",
  automationId: "cam",
  messageId,
  username: "user0",
  text: "كاميرا",
  publicReply: "skipped",
  dm,
  ...over,
});
const DOC = {
  automations: [],
  log: [
    entry("d1", "skipped", { detail: "already_claimed" }),
    entry("d2", "skipped", { detail: "takeover" }),
    entry("d3", "failed", { error: "upstream", detail: "unknown-delivery" }),
    entry("d4", "sent"),
  ],
  paused: false,
  ownerUsername: "3z.prod",
};

async function until(fn: () => void, timeout = 3000): Promise<void> {
  const end = Date.now() + timeout;
  for (;;) {
    await act(() => new Promise<void>((r) => setTimeout(r, 15)));
    try {
      fn();
      return;
    } catch (e) {
      if (Date.now() > end) throw e;
    }
  }
}

async function mount(lang: "ar" | "en"): Promise<void> {
  await act(async () => {
    S().setSettings({ lang, apiKeys: { scoutUrl: WORKER, scoutToken: "owner-token" } });
    root.render(createElement(AutoRepliesScreen));
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: q.includes("reduce"),
    media: q,
    addEventListener() {},
    removeEventListener() {},
  }));
  localStorage.clear();
  S().reset();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const path = new URL(String(input)).pathname;
      const body = path === "/social/replies" ? DOC : { error: "not_found" };
      return new Response(JSON.stringify(body), {
        status: path === "/social/replies" ? 200 : 404,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("AutoRepliesScreen log: a skipped DM is its own neutral outcome", () => {
  for (const [lang, skipped, failed, sent] of [
    ["en", "DM skipped", "DM failed", "DM sent ✓"],
    ["ar", "تخطّينا الخاص", "الخاص ما راح", "أرسلنا الخاص ✓"],
  ] as const)
    it(`${lang}: skipped rows say so in muted text; failed stays red, sent stays sent`, async () => {
      await mount(lang);
      await until(() => expect(rows()).toHaveLength(4));
      expect(rows().map((r) => r.dataset.dm)).toEqual(["skipped", "skipped", "failed", "sent"]);
      const status = (r: HTMLElement) => r.children[1] as HTMLElement;
      for (const r of rows().slice(0, 2)) {
        expect(status(r).textContent).toContain(skipped);
        expect(status(r).textContent).not.toContain(failed);
        expect(status(r).className).toContain("text-muted");
        expect(status(r).className).not.toContain("text-danger");
      }
      expect(status(rows()[0]).textContent).toContain("already_claimed");
      expect(status(rows()[1]).textContent).toContain("takeover");
      expect(status(rows()[2]).textContent).toContain(failed);
      expect(status(rows()[2]).className).toContain("text-danger");
      expect(status(rows()[3]).textContent).toContain(sent);
    });
});
