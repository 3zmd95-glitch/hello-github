// @vitest-environment jsdom
import { act, useRef, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Sheet from "@/components/ui/ios/Sheet";
import type { AutoReply } from "@/lib/domain";
import { newAutoReply } from "@/lib/replies";
import DefaultReplyEditor from "./DefaultReplyEditor";
import RulesTable from "./RulesTable";

// The editors live on a Social route: the discard alert is the iOS one.
vi.mock("next/navigation", () => ({ usePathname: () => "/social/replies/" }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

beforeEach(() => {
  // Phone layout, reduced motion: a sheet's close calls onClose at once.
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: q.includes("reduce"),
    media: q,
    addEventListener() {},
    removeEventListener() {},
  }));
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

function mount(node: ReactNode): HTMLElement {
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(node));
  return host;
}

const rule = (id: string, keyword: string): AutoReply => ({
  ...newAutoReply(id),
  keywords: [keyword, "lut"],
  dmText: "الرابط تحت",
});

function table(onEdit = vi.fn(), onDelete = vi.fn()) {
  const rules = [rule("a", "لت"), rule("b", "بريست")];
  const host = mount(
    <ul>
      <RulesTable
        automations={rules}
        defaultReply={undefined}
        busy={false}
        errorText={() => ""}
        onToggle={() => {}}
        onEdit={onEdit}
        onDelete={onDelete}
        onToggleDefault={() => {}}
        onEditDefault={() => {}}
      />
    </ul>,
  );
  return { host, rules };
}

/** Opens a row's ⋯ menu as a tap on its summary would (jsdom does not toggle `<details>` on a click). */
function openMenu(details: HTMLDetailsElement) {
  act(() => {
    details.open = true;
    details.dispatchEvent(new Event("toggle"));
  });
}

describe("RulesTable", () => {
  it("names each switch and ⋯ menu after its rule, and the row's text opens the editor", () => {
    const onEdit = vi.fn();
    const { host, rules } = table(onEdit);
    const names = (sel: string, attr = "aria-label") =>
      [...host.querySelectorAll(sel)].map((el) => el.getAttribute(attr));
    expect(names('[role="switch"]')).toEqual([
      "شغّال · أي بوست · لت",
      "شغّال · أي بوست · بريست",
      "الرد الافتراضي",
    ]);
    expect(names('[data-testid="autoreply-menu"]')).toEqual([
      "خيارات · أي بوست · لت",
      "خيارات · أي بوست · بريست",
      "خيارات · الرد الافتراضي",
    ]);
    act(() => host.querySelector<HTMLButtonElement>('[data-id="b"] .ar-open')!.click());
    expect(onEdit).toHaveBeenCalledWith(rules[1]);
  });

  it("closes the ⋯ menu once an item is picked, on a tap elsewhere, and on Escape", () => {
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    const { host, rules } = table(onEdit, onDelete);
    const menu = host.querySelector<HTMLDetailsElement>('[data-id="a"] details')!;
    const summary = menu.querySelector("summary")!;

    // A pick hands focus to the ⋯ button before the item hides (an editor sheet restores focus there on close).
    openMenu(menu);
    act(() => menu.querySelector<HTMLButtonElement>('[data-testid="autoreply-edit"]')!.focus());
    act(() => menu.querySelector<HTMLButtonElement>('[data-testid="autoreply-edit"]')!.click());
    expect(onEdit).toHaveBeenCalledWith(rules[0]);
    expect(menu.open).toBe(false);
    expect(document.activeElement).toBe(summary);

    openMenu(menu);
    act(() => menu.querySelector<HTMLButtonElement>('[data-testid="autoreply-delete"]')!.click());
    expect(onDelete).toHaveBeenCalledWith(rules[0]);
    expect(menu.open).toBe(false);

    openMenu(menu);
    act(() => {
      document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    expect(menu.open).toBe(false);

    openMenu(menu);
    const item = menu.querySelector<HTMLButtonElement>('[data-testid="autoreply-delete"]')!;
    act(() => item.focus());
    act(() => {
      item.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(menu.open).toBe(false);
    expect(document.activeElement).toBe(summary);
  });
});

/** The default-reply editor in its sheet, wired as AutoRepliesScreen does (the sheet asks the editor's guard). */
function DefaultInSheet({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (d: { enabled: boolean; text: string }) => Promise<boolean>;
}) {
  const guardRef = useRef<() => boolean>(() => true);
  return (
    <Sheet
      onClose={onClose}
      title="الرد الافتراضي"
      titleId="t"
      testId="sheet"
      beforeClose={() => guardRef.current()}
    >
      <DefaultReplyEditor
        value={{
          enabled: true,
          text: "وصلت رسالتك",
          stats: { sends: 0, publicReplies: 0, failures: 0, clicks: 0 },
        }}
        busy={false}
        onSave={onSave}
        guardRef={guardRef}
      />
    </Sheet>
  );
}

describe("DefaultReplyEditor", () => {
  it("closes its sheet only once the save went through", async () => {
    const onClose = vi.fn();
    let took = false;
    const onSave = vi.fn(async () => took);
    mount(<DefaultInSheet onClose={onClose} onSave={onSave} />);
    const save = document.querySelector<HTMLButtonElement>('[data-testid="default-reply-save"]')!;

    await act(async () => save.click());
    expect(onSave).toHaveBeenCalledWith({ enabled: true, text: "وصلت رسالتك" });
    expect(onClose).not.toHaveBeenCalled();

    took = true;
    await act(async () => save.click());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("asks before ✕, the backdrop or Esc throw an edit away: Cancel keeps it, Discard closes", () => {
    const onClose = vi.fn();
    mount(<DefaultInSheet onClose={onClose} onSave={vi.fn(async () => true)} />);
    const q = <T extends Element>(id: string) => document.querySelector<T>(`[data-testid="${id}"]`);
    const alert = () => q("confirm-dialog");

    // Untouched: nothing to lose, no question.
    act(() => q<HTMLElement>("sheet-backdrop")!.click());
    expect(alert()).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
    act(() => root!.unmount());
    root = null;
    onClose.mockClear();

    mount(<DefaultInSheet onClose={onClose} onSave={vi.fn(async () => true)} />);
    const text = q<HTMLTextAreaElement>("default-reply-text")!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    act(() => {
      setValue.call(text, "وصلت رسالتك، برد عليك بكرة");
      text.dispatchEvent(new Event("input", { bubbles: true }));
    });

    act(() => q<HTMLElement>("sheet-backdrop")!.click());
    expect(alert()).not.toBeNull();
    expect(alert()!.parentElement?.className).toBe("ios-alert-root");
    expect(alert()!.querySelector("#confirm-title")?.textContent).toBe("تسكّر بدون ما تحفظ؟");
    expect(alert()!.querySelector("#confirm-body")).toBeNull();
    act(() => q<HTMLButtonElement>("confirm-cancel")!.click());
    expect(alert()).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(q<HTMLTextAreaElement>("default-reply-text")!.value).toBe("وصلت رسالتك، برد عليك بكرة");

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(alert()).not.toBeNull();
    act(() => q<HTMLButtonElement>("confirm-ok")!.click());
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
