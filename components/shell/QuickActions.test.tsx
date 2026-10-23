// @vitest-environment jsdom
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TOOLS } from "@/lib/tools";
import { useStore } from "@/store";
import { QuickActionsProvider, useQuickActions } from "./QuickActions";

// ⚡ Quick Actions (packet DT-2): a navigation-only dialog over the DT-1 registry, opened from a launcher or
// Ctrl/Cmd+K, rendered for real in jsdom. No fetch, no history entries, no planned tools.

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/",
}));

let host: HTMLDivElement;
let root: Root;
let spies: ReturnType<typeof vi.spyOn>[];

const $ = (testId: string) => document.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
const dialog = () => $("quick-dialog");
const input = () => $("quick-input") as HTMLInputElement;
const items = () => [...document.querySelectorAll<HTMLElement>('[data-testid^="quick-item-"]')];
const itemIds = () => items().map((el) => el.dataset.testid!.replace("quick-item-", ""));
const selected = () =>
  items()
    .filter((el) => el.getAttribute("aria-selected") === "true")
    .map((el) => el.dataset.testid!.replace("quick-item-", ""));

/** The context's `open`, as any caller holds it. */
let openFn: () => void = () => {};

function Launcher() {
  const { open } = useQuickActions();
  useEffect(() => {
    openFn = open;
  }, [open]);
  return createElement("button", { type: "button", "data-testid": "quick-launch", onClick: open });
}

function mount(lang: "ar" | "en" = "ar"): void {
  act(() => {
    useStore.getState().setSettings({ lang });
    root.render(createElement(QuickActionsProvider, null, createElement(Launcher)));
  });
}

function press(target: EventTarget, init: KeyboardEventInit): KeyboardEvent {
  const e = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(e);
  });
  return e;
}
const ctrlK = (target: EventTarget = document.body, extra: KeyboardEventInit = {}) =>
  press(target, { key: "k", ctrlKey: true, ...extra });

function type(value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input(), value);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Focus the launcher and click it, as a pointer or keyboard user would. */
function openFromLauncher(): HTMLElement {
  const launcher = $("quick-launch")!;
  launcher.focus();
  act(() => launcher.click());
  return launcher;
}

/** An element appended to the page for one test (removed in afterEach with the host's siblings). */
function extra(html: string): HTMLElement {
  const wrap = document.createElement("div");
  wrap.dataset.extra = "true";
  wrap.innerHTML = html;
  document.body.append(wrap);
  return wrap.firstElementChild as HTMLElement;
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  push.mockClear();
  spies = [
    vi.spyOn(window.history, "pushState"),
    vi.spyOn(window.history, "replaceState"),
    vi.spyOn(globalThis, "fetch"),
  ];
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.querySelectorAll("[data-extra]").forEach((el) => el.remove());
  useStore.getState().setSettings({ lang: "ar" });
  vi.restoreAllMocks();
});

describe("shortcut", () => {
  it("opens on Ctrl+K and Cmd+K, and claims the key", () => {
    mount();
    const e = ctrlK();
    expect(dialog()).not.toBeNull();
    expect(e.defaultPrevented).toBe(true);
    press(input(), { key: "Escape" });
    expect(dialog()).toBeNull();
    press(document.body, { key: "K", metaKey: true });
    expect(dialog()).not.toBeNull();
  });

  it("closes on Ctrl+K when already open, even from its own input", () => {
    mount();
    ctrlK();
    expect(document.activeElement).toBe(input());
    ctrlK(input());
    expect(dialog()).toBeNull();
  });

  it("ignores repeats, composition, handled events and extra Alt or Shift", () => {
    mount();
    ctrlK(document.body, { repeat: true });
    ctrlK(document.body, { isComposing: true });
    ctrlK(document.body, { altKey: true });
    ctrlK(document.body, { shiftKey: true });
    press(document.body, { key: "k" });
    const handled = extra("<div></div>");
    handled.addEventListener("keydown", (e) => e.preventDefault());
    ctrlK(handled);
    expect(dialog()).toBeNull();
  });

  it("leaves text fields and editors alone", () => {
    mount();
    for (const html of [
      "<input />",
      "<textarea></textarea>",
      "<select><option>a</option></select>",
      '<div contenteditable="true"></div>',
      '<div contenteditable=""><b>inside</b></div>',
      '<div role="textbox"></div>',
    ]) {
      const el = extra(html);
      ctrlK(el.firstElementChild ?? el);
      expect(dialog(), html).toBeNull();
    }
    ctrlK(extra('<span contenteditable="false">read only</span>'));
    expect(dialog()).not.toBeNull();
  });

  it("refuses while another modal dialog or alert is open", () => {
    mount();
    const sheet = extra('<div role="dialog" aria-modal="true"></div>');
    ctrlK();
    expect(dialog()).toBeNull();
    sheet.remove();
    const alert = extra('<div role="alertdialog"></div>');
    ctrlK();
    expect(dialog()).toBeNull();
    alert.remove();
    ctrlK();
    expect(dialog()).not.toBeNull();
  });
});

describe("open() (Amendment B)", () => {
  it("refuses from the launcher, by click or Enter, while another modal is open", () => {
    mount();
    for (const html of [
      '<div role="dialog" aria-modal="true"></div>',
      '<div role="alertdialog"></div>',
    ]) {
      const modal = extra(html);
      openFromLauncher();
      expect(dialog(), html).toBeNull();
      act(() => openFn());
      expect(dialog(), html).toBeNull();
      modal.remove();
    }
    openFromLauncher();
    expect(dialog()).not.toBeNull();
  });

  it("ignores a second call while open: one dialog, same query, selection and opener", () => {
    mount();
    const launcher = openFromLauncher();
    type("social");
    press(input(), { key: "ArrowDown" });
    const before = selected();
    act(() => openFn());
    expect(document.querySelectorAll('[data-testid="quick-dialog"]')).toHaveLength(1);
    expect(input().value).toBe("social");
    expect(selected()).toEqual(before);
    press(input(), { key: "Escape" });
    expect(document.activeElement).toBe(launcher);
  });
});

describe("dialog", () => {
  it("is a labelled modal dialog with a combobox input that has focus", () => {
    mount("en");
    openFromLauncher();
    const d = dialog()!;
    expect(d.getAttribute("role")).toBe("dialog");
    expect(d.getAttribute("aria-modal")).toBe("true");
    expect(d.getAttribute("aria-label")).toBe("Quick actions");
    expect(document.activeElement).toBe(input());
    expect(input().getAttribute("role")).toBe("combobox");
    const list = document.getElementById(input().getAttribute("aria-controls")!)!;
    expect(list.getAttribute("role")).toBe("listbox");
    expect(input().getAttribute("aria-activedescendant")).toBe(items()[0].id);
    expect(items()[0].getAttribute("role")).toBe("option");
  });

  it("keeps Tab and Shift+Tab inside", () => {
    mount();
    openFromLauncher();
    const last = items().at(-1)!;
    last.focus();
    const e = press(last, { key: "Tab" });
    expect(document.activeElement).toBe(input());
    expect(e.defaultPrevented).toBe(true);
    press(input(), { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("cycles Tab through the input, Close and every result (Amendment A)", () => {
    mount();
    openFromLauncher();
    const close = $("quick-close")!;
    press(input(), { key: "Tab" });
    expect(document.activeElement).toBe(close);
    press(close, { key: "Tab" });
    expect(document.activeElement).toBe(items()[0]);
    press(items()[0], { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(close);
    press(close, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(input());
  });

  it("has a labelled Close button that dismisses and gives focus back (Amendment A)", () => {
    mount();
    const launcher = openFromLauncher();
    const close = $("quick-close")!;
    expect(close.tagName).toBe("BUTTON");
    expect(close.getAttribute("aria-label")).toBe("إغلاق");
    act(() => close.click());
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(launcher);
    expect(push).not.toHaveBeenCalled();
  });

  it("closes on Escape and gives focus back to the launcher", () => {
    mount();
    const launcher = openFromLauncher();
    expect(document.activeElement).toBe(input());
    press(input(), { key: "Escape" });
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(launcher);
  });

  it("closes on a backdrop click and gives focus back to the launcher", () => {
    mount();
    const launcher = openFromLauncher();
    act(() => $("quick-backdrop")!.click());
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(launcher);
  });

  it("does not focus an opener that left the page", () => {
    mount();
    const opener = extra("<button>gone</button>");
    opener.focus();
    ctrlK(opener);
    opener.remove();
    expect(() => press(input(), { key: "Escape" })).not.toThrow();
    expect(dialog()).toBeNull();
    expect(document.activeElement).not.toBe(opener);
  });

  it("resets the query and selection each time it opens", () => {
    mount();
    ctrlK();
    type("notes");
    press(input(), { key: "Escape" });
    ctrlK();
    expect(input().value).toBe("");
    expect(selected()).toEqual([itemIds()[0]]);
  });
});

describe("results", () => {
  it("never lists planned tools", () => {
    mount();
    ctrlK();
    expect(itemIds()).toContain("notes");
    // The Inbox is built (packet DT-6A), so it is listed, in English and Arabic.
    type("Inbox");
    expect(itemIds()).toContain("inbox");
    type("صندوق");
    expect(itemIds()).toContain("inbox");
    // The Business kit is built (packet DT-5), so it is listed, in English and Arabic.
    type("Business");
    expect(itemIds()).toContain("business");
    type("بزنس");
    expect(itemIds()).toContain("business");
    // Website is built (packet DT-3), so it is listed.
    type("Website");
    expect(itemIds()).toContain("website");
    // So is the workflow builder (packet DT-4).
    type("Workflow");
    expect(itemIds()).toContain("workflows");
  });

  it("finds Notes in either language, whatever the interface language", () => {
    mount("en");
    ctrlK();
    type("ملاحظات");
    expect(selected()).toEqual(["notes"]);
    press(input(), { key: "Escape" });
    mount("ar");
    ctrlK();
    type("notes");
    expect(selected()).toEqual(["notes"]);
    expect(items()[0].textContent).toContain("النوتات");
  });

  it("moves the selection with the arrows, clamped to the list", () => {
    mount();
    ctrlK();
    const all = itemIds();
    press(input(), { key: "ArrowUp" });
    expect(selected()).toEqual([all[0]]);
    press(input(), { key: "ArrowDown" });
    expect(selected()).toEqual([all[1]]);
    for (let i = 0; i < all.length + 3; i++) press(input(), { key: "ArrowDown" });
    expect(selected()).toEqual([all.at(-1)]);
    expect(input().getAttribute("aria-activedescendant")).toBe(items().at(-1)!.id);
  });

  it("keeps focus, selection and Enter on the same row once a result has focus (Amendment A)", () => {
    mount();
    ctrlK();
    press(input(), { key: "ArrowDown" });
    press(input(), { key: "ArrowDown" });
    const rows = items();
    // Tab onto the first result: it becomes the selection.
    press(input(), { key: "Tab" });
    press($("quick-close")!, { key: "Tab" });
    expect(document.activeElement).toBe(rows[0]);
    expect(selected()).toEqual([itemIds()[0]]);
    press(rows[0], { key: "ArrowDown" });
    expect(document.activeElement).toBe(items()[1]);
    expect(selected()).toEqual([itemIds()[1]]);
    const tool = TOOLS.find((t) => t.id === itemIds()[1])!;
    const e = press(items()[1], { key: "Enter" });
    expect(e.defaultPrevented).toBe(true);
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith(tool.href ?? tool.setupHref);
    expect(dialog()).toBeNull();
  });

  it("clamps the arrows at both ends while a result has focus (Amendment A)", () => {
    mount();
    ctrlK();
    act(() => items()[0].focus());
    press(items()[0], { key: "ArrowUp" });
    expect(document.activeElement).toBe(items()[0]);
    expect(selected()).toEqual([itemIds()[0]]);
    const last = items().at(-1)!;
    act(() => last.focus());
    expect(selected()).toEqual([itemIds().at(-1)]);
    press(last, { key: "ArrowDown" });
    expect(document.activeElement).toBe(last);
    expect(selected()).toEqual([itemIds().at(-1)]);
  });

  it("goes back to the first result when the query changes", () => {
    mount();
    ctrlK();
    for (let i = 0; i < 5; i++) press(input(), { key: "ArrowDown" });
    type("social");
    expect(selected()).toEqual([itemIds()[0]]);
  });

  it("opens the selected result with Enter, once, and closes", () => {
    mount("en");
    ctrlK();
    const first = itemIds()[0];
    press(input(), { key: "ArrowDown" });
    press(input(), { key: "ArrowDown" });
    const chosen = selected()[0];
    expect(chosen).not.toBe(first);
    const tool = TOOLS.find((t) => t.id === chosen)!;
    press(input(), { key: "Enter" });
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith(tool.href ?? tool.setupHref);
    expect(dialog()).toBeNull();
  });

  it("opens a Settings anchor with its hash", () => {
    mount("en");
    ctrlK();
    type("Instagram account");
    expect(itemIds()).toEqual(["instagram"]);
    press(input(), { key: "Enter" });
    expect(push).toHaveBeenCalledWith("/social/settings#accounts");
  });

  it("shows an empty state where Enter does nothing", () => {
    mount();
    ctrlK();
    type("zzqx");
    expect(items()).toEqual([]);
    expect($("quick-empty")!.textContent).toBe("ما لقينا شي بهالاسم.");
    expect(input().getAttribute("aria-activedescendant")).toBeNull();
    press(input(), { key: "Enter" });
    expect(push).not.toHaveBeenCalled();
    expect(dialog()).not.toBeNull();
  });

  it("makes no request and adds no history entry across open, search, Enter and close", () => {
    mount();
    openFromLauncher();
    type("calendar");
    press(input(), { key: "Enter" });
    ctrlK();
    type("zzqx");
    press(input(), { key: "Escape" });
    expect(push).toHaveBeenCalledTimes(1);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});
