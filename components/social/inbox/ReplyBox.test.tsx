// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InboxResult } from "@/lib/inbox";
import { useStore } from "@/store";
import ReplyBox from "./ReplyBox";

// The send box under a thread or a comment: the live counter (bytes for a DM, characters for a comment), Send
// locked while a request is pending (the Worker has no idempotency guard), and the three kinds of result line.

type Props = Parameters<typeof ReplyBox>[0];

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  useStore.getState().setSettings({ lang: "en" });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
});

const ok: InboxResult<unknown> = { ok: true };
function render(over: Partial<Props> = {}) {
  const props: Props = {
    kind: "dm",
    platform: "instagram",
    limit: { bytes: 10 },
    onSend: vi.fn(async () => ok),
    testId: "box",
    ...over,
  };
  act(() => root.render(<ReplyBox {...props} />));
  return props;
}

const q = (id: string) => host.querySelector<HTMLElement>(`[data-testid="box-${id}"]`);
const textarea = () => q("text") as HTMLTextAreaElement;
const send = () => q("send") as HTMLButtonElement;
const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
const type = (text: string) =>
  act(() => {
    setValue.call(textarea(), text);
    textarea().dispatchEvent(new Event("input", { bubbles: true }));
  });
const click = () => act(() => send().click());
/** Lets a resolved promise's continuation run. */
const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });

function deferred() {
  let resolve!: (r: InboxResult<unknown>) => void;
  const promise = new Promise<InboxResult<unknown>>((r) => (resolve = r));
  return { promise, resolve };
}

describe("ReplyBox counter", () => {
  it("counts a DM in UTF-8 bytes: an Arabic letter is two, an emoji four", () => {
    render({ limit: { bytes: 10 } });
    expect(q("left")!.textContent).toBe("About 10 characters left");
    type("لت"); // two letters, four bytes
    expect(q("left")!.textContent).toBe("About 6 characters left");
    type("🎬"); // one picture, four bytes
    expect(q("left")!.textContent).toBe("About 6 characters left");
    type("abc");
    expect(q("left")!.textContent).toBe("About 7 characters left");
  });

  it("counts a comment in characters", () => {
    render({ kind: "comment", limit: { chars: 5 } });
    type("لت");
    expect(q("left")!.textContent).toBe("About 3 characters left");
    type("🎬"); // two UTF-16 units, as the Worker's text.length counts it
    expect(q("left")!.textContent).toBe("About 3 characters left");
  });

  it("counts the text that is sent: surrounding spaces are trimmed", () => {
    render({ limit: { bytes: 10 } });
    type("   hi   ");
    expect(q("left")!.textContent).toBe("About 8 characters left");
  });

  it("turns red at zero and refuses past the limit", () => {
    render({ limit: { bytes: 4 } });
    type("ل");
    expect(q("left")!.className).not.toContain("text-danger");
    expect(send().disabled).toBe(false);
    type("لت"); // exactly 4 bytes: zero left, still allowed
    expect(q("left")!.textContent).toBe("About 0 characters left");
    expect(q("left")!.className).toContain("text-danger");
    expect(send().disabled).toBe(false);
    type("لتا"); // 6 bytes
    expect(q("left")!.textContent).toBe("The text is longer than the limit");
    expect(q("left")!.className).toContain("text-danger");
    expect(send().disabled).toBe(true);
  });

  it("keeps Send off while the text is empty or only spaces", () => {
    const props = render();
    expect(send().disabled).toBe(true);
    type("   ");
    expect(send().disabled).toBe(true);
    click();
    expect(props.onSend).not.toHaveBeenCalled();
    type("a");
    expect(send().disabled).toBe(false);
  });
});

describe("ReplyBox sending", () => {
  it("sends the trimmed text once, locks while pending, then clears the box", async () => {
    const pending = deferred();
    const onSend = vi.fn(() => pending.promise);
    const onSent = vi.fn();
    render({ onSend, onSent });
    type("  hi  ");
    click();
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith("hi");
    expect(send().disabled).toBe(true);
    expect(send().textContent).toBe("Sending…");
    expect(textarea().readOnly).toBe(true);
    click(); // a second tap while the first is in flight
    expect(onSend).toHaveBeenCalledTimes(1);

    pending.resolve(ok);
    await settle();
    expect(textarea().value).toBe("");
    expect(textarea().readOnly).toBe(false);
    expect(send().textContent).toBe("Send");
    expect(q("result")!.textContent).toBe("Sent");
    expect(q("result")!.getAttribute("role")).toBe("status");
    expect(onSent).toHaveBeenCalledTimes(1);
  });

  it("keeps the text and says it was not confirmed when the send may have gone out", async () => {
    const onSent = vi.fn();
    const unconfirmed: InboxResult<unknown> = {
      ok: false,
      error: { type: "upstream", detail: "unconfirmed" },
    };
    render({ onSend: vi.fn(async () => unconfirmed), onSent });
    type("hi");
    click();
    await settle();
    expect(q("result")!.textContent).toBe("Sending wasn't confirmed; check the app");
    expect(q("result")!.getAttribute("role")).toBe("status");
    expect(textarea().value).toBe("hi");
    expect(send().disabled).toBe(false);
    expect(onSent).not.toHaveBeenCalled();
  });

  it("keeps the text and shows the refusal in the platform's words", async () => {
    const onSent = vi.fn();
    const refused: InboxResult<unknown> = {
      ok: false,
      error: { type: "rejected", detail: "Cannot reply" },
    };
    render({ onSend: vi.fn(async () => refused), onSent });
    type("hi");
    click();
    await settle();
    expect(q("result")!.textContent).toBe("The platform refused: Cannot reply");
    expect(q("result")!.getAttribute("role")).toBe("alert");
    expect(textarea().value).toBe("hi");
    expect(onSent).not.toHaveBeenCalled();
  });

  it("names a closed window and a failed network in their own words", async () => {
    const onSend = vi
      .fn<Props["onSend"]>()
      .mockResolvedValueOnce({ ok: false, error: { type: "window_closed" } })
      .mockResolvedValueOnce({ ok: false, error: { type: "network" } });
    render({ onSend });
    type("hi");
    click();
    await settle();
    expect(q("result")!.textContent).toContain("doesn't allow a reply right now");
    click();
    await settle();
    expect(q("result")!.textContent).toBe("Couldn't reach the Worker; check your connection.");
  });

  it("clears the result line when the text is edited again", async () => {
    render();
    type("hi");
    click();
    await settle();
    expect(q("result")).not.toBeNull();
    type("hi again");
    expect(q("result")).toBeNull();
  });
});

describe("ReplyBox disabled", () => {
  it("shows why and sends nothing", () => {
    const props = render({ disabled: true, disabledReason: "Not right now" });
    expect(q("reason")!.textContent).toBe("Not right now");
    expect(textarea().disabled).toBe(true);
    expect(send().disabled).toBe(true);
    click();
    expect(props.onSend).not.toHaveBeenCalled();
  });

  it("shows no reason when it is enabled", () => {
    render();
    expect(q("reason")).toBeNull();
    expect(textarea().disabled).toBe(false);
  });
});
