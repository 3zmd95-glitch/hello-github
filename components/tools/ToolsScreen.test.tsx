// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NATIVE_HELPER_STORAGE_KEY } from "@/lib/discoverNativeSearch";
import { EMPTY_SOCIAL_SYNC } from "@/lib/domain";
import { TOOLS, TOOL_GROUPS } from "@/lib/tools";
import { useStore } from "@/store";
import ToolsScreen from "./ToolsScreen";

// 🧰 Tools hub (packet DT-1 + Amendment A), rendered for real in jsdom from the store only: no fetch on open or
// search, saved keys read "configured", a stored account status only "last known" (never green).

const WORKER_A = { scoutUrl: "https://a.example.workers.dev", scoutToken: "token-a-secret" };
const WORKER_B = { scoutUrl: "https://b.example.workers.dev", scoutToken: "token-b-secret" };

let host: HTMLDivElement;
let root: Root;
let fetchSpy: ReturnType<typeof vi.spyOn>;

const $ = (testId: string) => host.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
const rowIds = () =>
  [...host.querySelectorAll<HTMLElement>("[data-tool]")].map((r) => r.dataset.tool);
const stateOf = (id: string) => $(`tools-state-${id}`)?.dataset.state;
const search = () => $("tools-search") as HTMLInputElement;

function mount(lang: "ar" | "en" = "ar"): void {
  act(() => {
    useStore.getState().setSettings({ lang });
    root.render(createElement(ToolsScreen));
  });
}

function type(value: string): void {
  const input = search();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fetchSpy = vi.spyOn(globalThis, "fetch");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  useStore.getState().setSettings({ lang: "ar", apiKeys: {} });
  useStore.setState({ socialSync: { ...EMPTY_SOCIAL_SYNC } });
  vi.restoreAllMocks();
});

describe("ToolsScreen", () => {
  it("lists every tool in its group, in Arabic and English", () => {
    mount();
    expect(host.querySelector("h1")!.textContent).toBe("الأدوات والربط");
    // Every group that has a tool is shown (an empty group, like "planned" after DT-6A, is hidden by design).
    for (const g of TOOL_GROUPS.filter((x) => TOOLS.some((t) => t.group === x)))
      expect($(`tools-group-${g}`), g).not.toBeNull();
    expect(rowIds()).toEqual(TOOLS.map((t) => t.id));
    mount("en");
    expect(host.querySelector("h1")!.textContent).toBe("Tools & integrations");
    expect($("tools-row-replies")!.textContent).toContain("Auto replies");
  });

  it("finds a tool by its Arabic or English name and hides the rest", () => {
    mount("en");
    type("ردود");
    expect(rowIds()).toEqual(["replies"]);
    expect($("tools-group-learn")).toBeNull();
    type("replies");
    expect(rowIds()).toEqual(["replies"]);
  });

  it("shows an empty state whose clear button, or Escape, restores the list", () => {
    mount();
    type("zzqx");
    expect(rowIds()).toEqual([]);
    expect($("tools-empty")!.textContent).toContain("ما لقينا أداة");
    act(() => $("tools-clear")!.click());
    expect(search().value).toBe("");
    expect(rowIds()).toHaveLength(TOOLS.length);
    type("zzqx");
    act(() => {
      search().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(rowIds()).toHaveLength(TOOLS.length);
  });

  it("marks planned tools planned, with no setup action", () => {
    mount();
    // Nothing is planned any more: the Inbox (packet DT-6A) was the last planned row.
    expect(host.querySelector('[data-state="planned"]')).toBeNull();
    expect($("tools-group-planned")).toBeNull();
    expect(stateOf("inbox")).toBe("setup");
    expect($("tools-row-inbox")!.textContent).not.toContain("على الخطة");
    expect($("tools-action-inbox")!.getAttribute("href")).toMatch(/^\/social\/inbox\/?$/);
    // Website is built (packet DT-3): available, no planned note, its link opens the CMS.
    expect(stateOf("website")).toBe("available");
    expect($("tools-row-website")!.textContent).not.toContain("على الخطة");
    expect($("tools-link-website")!.getAttribute("href")).toMatch(/^\/social\/website\/?$/);
    // The workflow builder is built too (packet DT-4): available, its link opens /social/workflows.
    expect(stateOf("workflows")).toBe("available");
    expect($("tools-row-workflows")!.textContent).not.toContain("على الخطة");
    expect($("tools-link-workflows")!.getAttribute("href")).toMatch(/^\/social\/workflows\/?$/);
    expect($("tools-link-inbox")!.getAttribute("href")).toMatch(/^\/social\/inbox\/?$/);
    // The Business kit is built (packet DT-5): available, its link opens /social/business.
    expect(stateOf("business")).toBe("available");
    expect($("tools-row-business")!.textContent).not.toContain("على الخطة");
    expect($("tools-link-business")!.getAttribute("href")).toMatch(/^\/social\/business\/?$/);
  });

  it("reads unconfigured accounts as needing setup, with a link to the existing controls", () => {
    mount();
    expect(stateOf("scout")).toBe("setup");
    expect(stateOf("instagram")).toBe("setup");
    expect(stateOf("autopost")).toBe("setup");
    expect($("tools-action-scout")!.getAttribute("href")).toMatch(/^\/settings\/?#api-keys$/);
    expect($("tools-action-scout")!.textContent).toBe("جهّزها");
    expect(stateOf("today")).toBe("available");
    expect($("tools-action-today")).toBeNull();
  });

  it("reads saved keys as configured and a stored status as last known, never connected", () => {
    act(() => {
      useStore.getState().setSettings({ apiKeys: { ...WORKER_A, youtube: "AIzaSecretKey" } });
      useStore.getState().setSocialSyncStatus({
        instagram: { configured: true, connected: true, canReply: true },
        tiktok: { configured: true, connected: true, lastError: "token_expired" },
      });
    });
    mount();
    expect(stateOf("scout")).toBe("configured");
    expect(stateOf("youtubeKey")).toBe("configured");
    expect(stateOf("mcp")).toBe("configured");
    expect(stateOf("instagram")).toBe("lastKnown");
    expect(stateOf("replies")).toBe("lastKnown");
    expect(stateOf("tiktok")).toBe("attention");
    expect(stateOf("threads")).toBe("setup");
    expect(stateOf("autopost")).toBe("permission");
    expect($("tools-action-autopost")!.textContent).toBe("اسمح بالنشر");
    expect($("tools-state-instagram")!.textContent).toMatch(/^آخر مرة كان متصل · /);
    const verify = $("tools-action-instagram")!;
    expect(verify.textContent).toBe("تأكد منه");
    expect(verify.getAttribute("href")).toMatch(/^\/settings\/?#accounts$/);
    // Nothing is green: no chip uses the accent colours, no state says connected or stale.
    for (const chip of host.querySelectorAll<HTMLElement>("[data-state]")) {
      expect(["connected", "stale"]).not.toContain(chip.dataset.state);
      expect(chip.getAttribute("style") ?? "").not.toContain("--accent");
    }
    // No credential or Worker address is ever rendered.
    for (const secret of ["token-a-secret", "AIzaSecretKey", "a.example", "workers.dev"])
      expect(host.innerHTML).not.toContain(secret);
  });

  it("keeps a last known status after switching to another Worker, with its old time", () => {
    act(() => {
      useStore.getState().setSettings({ apiKeys: WORKER_A });
      useStore
        .getState()
        .setSocialSyncStatus(
          { instagram: { configured: true, connected: true } },
          new Date(Date.now() - 3 * 60 * 60 * 1000),
        );
    });
    mount();
    const before = $("tools-state-instagram")!.textContent;
    expect(stateOf("instagram")).toBe("lastKnown");
    act(() => useStore.getState().setSettings({ apiKeys: WORKER_B }));
    expect(stateOf("instagram")).toBe("lastKnown");
    expect($("tools-state-instagram")!.textContent).toBe(before);
    expect(host.innerHTML).not.toContain("token-b-secret");
  });

  it.each([
    {
      lang: "ar" as const,
      check: "افحصها",
      replyLabel: "يبي إذن الرد",
      postLabel: "اسمح بالنشر",
      chip: "ناقص صلاحية",
    },
    {
      lang: "en" as const,
      check: "Check",
      replyLabel: "Needs reply permission",
      postLabel: "Allow posting",
      chip: "Permission missing",
    },
  ])(
    "separates a connection error from a missing permission ($lang)",
    ({ lang, check, replyLabel, postLabel, chip }) => {
      act(() => {
        useStore.getState().setSettings({ apiKeys: WORKER_A });
        // Instagram may reply and post but its token expired; YouTube is fine but may not post.
        useStore.getState().setSocialSyncStatus({
          instagram: {
            configured: true,
            connected: true,
            canReply: true,
            canPublish: true,
            tokenExpiresAt: "2020-01-01T00:00:00Z",
          },
          youtube: { configured: true, connected: true },
        });
      });
      mount(lang);
      // Attention (connection error): the generic Check label to Settings, never a permission label.
      expect(stateOf("replies")).toBe("attention");
      const replies = $("tools-action-replies")!;
      expect(replies.textContent).toBe(check);
      expect(replies.getAttribute("href")).toMatch(/^\/settings\/?#accounts$/);
      expect($("tools-row-replies")!.textContent).not.toContain(replyLabel);
      // Permission (connected, error-free, timestamped, scope missing): the tool's own label and chip.
      expect(stateOf("autopost")).toBe("permission");
      expect($("tools-state-autopost")!.textContent).toBe(chip);
      const autopost = $("tools-action-autopost")!;
      expect(autopost.textContent).toBe(postLabel);
      expect(autopost.getAttribute("href")).toMatch(/^\/social\/automations\/?$/);
      expect($("tools-state-autopost")!.getAttribute("style") ?? "").not.toContain("--danger");
    },
  );

  it("labels a missing reply permission with the replies label", () => {
    act(() => {
      useStore.getState().setSettings({ apiKeys: WORKER_A });
      useStore.getState().setSocialSyncStatus({ instagram: { configured: true, connected: true } });
    });
    mount("en");
    expect(stateOf("replies")).toBe("permission");
    expect($("tools-action-replies")!.textContent).toBe("Needs reply permission");
    expect($("tools-action-replies")!.getAttribute("href")).toMatch(/^\/social\/replies\/?$/);
    expect($("tools-row-replies")!.textContent).not.toContain("Check");
  });

  it.each([
    { lang: "ar" as const, manage: "إدارة" },
    { lang: "en" as const, manage: "Manage" },
  ])("gives configured rows without a page a Manage link ($lang)", ({ lang, manage }) => {
    localStorage.setItem(NATIVE_HELPER_STORAGE_KEY, "a".repeat(32));
    act(() => useStore.getState().setSettings({ apiKeys: WORKER_A }));
    try {
      mount(lang);
      for (const [id, href] of [
        ["helper", /^\/discover\/?$/],
        ["mcp", /^\/settings\/?#api-keys$/],
      ] as const) {
        expect(stateOf(id)).toBe("configured");
        const links = $(`tools-row-${id}`)!.querySelectorAll("a");
        expect(links).toHaveLength(1);
        expect(links[0].getAttribute("href")).toMatch(href);
        expect(links[0].textContent).toBe(manage);
      }
    } finally {
      localStorage.removeItem(NATIVE_HELPER_STORAGE_KEY);
    }
  });

  it("says local AI is only host-level on a local address", () => {
    mount("en");
    expect(stateOf("localAi")).toBe("hostOnly");
    expect($("tools-state-localAi")!.textContent).toBe(
      "Local setup possible on this device · sign-in not verified",
    );
    expect($("tools-link-localAi")!.getAttribute("href")).toMatch(/^\/discover\/?$/);
  });

  it("never fetches on open, search or clear", () => {
    mount();
    type("ردود");
    type("zzqx");
    act(() => $("tools-clear")!.click());
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
