// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ConfirmDialog from "./ConfirmDialog";

// The world comes from the route: "/" is Training, "/social/…" is Social.
const nav = vi.hoisted(() => ({ path: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.path }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
});

function mount(path: string) {
  nav.path = path;
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  act(() =>
    root.render(
      <ConfirmDialog
        title="تحذف البوست؟"
        body="ما ينفع تتراجع."
        confirmLabel="احذف البوست"
        danger
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    ),
  );
  const dialog = document.querySelector<HTMLElement>('[data-testid="confirm-dialog"]')!;
  const button = (id: string) => dialog.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)!;
  return {
    onConfirm,
    onCancel,
    dialog,
    cancel: button("confirm-cancel"),
    ok: button("confirm-ok"),
  };
}

describe("ConfirmDialog in Training", () => {
  it("keeps the pixel dialog, in place", () => {
    mount("/");
    expect(host.innerHTML).toMatchInlineSnapshot(
      `"<div class="anim-fade fixed inset-0 z-50 grid place-items-center bg-[rgba(5,8,12,.7)] p-4"><div role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-body" class="px-card anim-popin flex w-full max-w-[400px] flex-col gap-3" data-testid="confirm-dialog"><h2 id="confirm-title" class="text-lg">تحذف البوست؟</h2><p id="confirm-body" class="text-ink-2 text-sm">ما ينفع تتراجع.</p><div class="flex flex-wrap justify-end gap-2"><button type="button" class="px-btn px-btn-ghost" data-testid="confirm-cancel">إلغاء</button><button type="button" class="px-btn px-btn-danger" data-testid="confirm-ok">احذف البوست</button></div></div></div>"`,
    );
  });
});

describe("ConfirmDialog in Social", () => {
  it("is an iOS alert portaled to <body> with the same hooks, Cancel focused", () => {
    const { dialog, cancel, ok } = mount("/social/calendar/");
    expect(host.innerHTML).toBe("");
    expect(dialog.parentElement?.className).toBe("ios-alert-root");
    expect(dialog.parentElement?.parentElement).toBe(document.body);
    expect(dialog.getAttribute("role")).toBe("alertdialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-labelledby")).toBe("confirm-title");
    expect(dialog.getAttribute("aria-describedby")).toBe("confirm-body");
    expect(document.getElementById("confirm-title")?.textContent).toBe("تحذف البوست؟");
    expect(document.getElementById("confirm-body")?.textContent).toBe("ما ينفع تتراجع.");
    expect([...dialog.querySelectorAll("button")]).toEqual([cancel, ok]);
    expect(ok.textContent).toBe("احذف البوست");
    expect(ok.dataset.danger).toBe("true");
    expect(document.activeElement).toBe(cancel);
  });

  it("Esc cancels the alert alone: the sheet's bubbling listener on document never hears it", () => {
    const sheetKey = vi.fn();
    document.addEventListener("keydown", sheetKey);
    try {
      const { onCancel, cancel } = mount("/social/calendar/");
      act(() => {
        cancel.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      });
      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(sheetKey).not.toHaveBeenCalled();
      // Other keys pass through.
      cancel.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
      expect(sheetKey).toHaveBeenCalledTimes(1);
    } finally {
      document.removeEventListener("keydown", sheetKey);
    }
  });

  it("closes on a backdrop tap (not a tap on the panel), confirms, and gives focus back", () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    const { onCancel, onConfirm, dialog, ok } = mount("/social/growth/");
    act(() => dialog.click());
    expect(onCancel).not.toHaveBeenCalled();
    act(() => (dialog.parentElement as HTMLElement).click());
    expect(onCancel).toHaveBeenCalledTimes(1);
    act(() => ok.click());
    expect(onConfirm).toHaveBeenCalledTimes(1);
    act(() => root.render(null));
    expect(document.activeElement).toBe(opener);
  });
});
