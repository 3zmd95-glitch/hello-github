// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InboxResult } from "@/lib/inbox";
import { useStore } from "@/store";
import ReplyBox from "./ReplyBox";

// The send box under a thread or a comment: the live counter (bytes for a DM, characters for a comment), Send
// locked while a request is pending (the Worker has no idempotency guard), and the kinds of result line.

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
function props(over: Partial<Props> = {}): Props {
  return {
    kind: "dm",
    limit: { bytes: 10 },
    onSend: vi.fn(async () => ok),
    testId: "box",
    ...over,
  };
}
function render(over: Partial<Props> = {}) {
  const p = props(over);
  act(() => root.render(<ReplyBox {...p} />));
  return p;
}

const q = (id: string) => host.querySelector<HTMLElement>(`[data-testid="box-${id}"]`);
const textarea = () => q("text") as HTMLTextAreaElement;
const send = () => q("send") as HTMLButtonElement;
/** The result lines are always in the page: a polite status and an alert, empty when idle. */
const line = (role: "status" | "alert") =>
  q("result")!.querySelector<HTMLElement>(`[role="${role}"]`)!;
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
    expect(q("left")!.textContent).toBe("About 10 left");
    type("لت"); // two letters, four bytes
    expect(q("left")!.textContent).toBe("About 6 left");
    type("🎬"); // one picture, four bytes
    expect(q("left")!.textContent).toBe("About 6 left");
    type("abc");
    expect(q("left")!.textContent).toBe("About 7 left");
  });

  it("counts a comment in characters", () => {
    render({ kind: "comment", limit: { chars: 5 } });
    type("لت");
    expect(q("left")!.textContent).toBe("About 3 left");
    type("🎬"); // two UTF-16 units, as the Worker's text.length counts it
    expect(q("left")!.textContent).toBe("About 3 left");
  });

  it("counts the text that is sent: surrounding spaces are trimmed", () => {
    render({ limit: { bytes: 10 } });
    type("   hi   ");
    expect(q("left")!.textContent).toBe("About 8 left");
  });

  it("turns red at zero and refuses past the limit", () => {
    render({ limit: { bytes: 4 } });
    type("ل");
    expect(q("left")!.className).not.toContain("text-danger");
    expect(send().disabled).toBe(false);
    type("لت"); // exactly 4 bytes: zero left, still allowed
    expect(q("left")!.textContent).toBe("About 0 left");
    expect(q("left")!.className).toContain("text-danger");
    expect(send().disabled).toBe(false);
    type("لتا"); // 6 bytes
    expect(q("left")!.textContent).toBe("The text is longer than the limit");
    expect(q("left")!.className).toContain("text-danger");
    expect(send().disabled).toBe(true);
  });

  it("keeps Send off while the text is empty or only spaces", () => {
    const p = render();
    expect(send().disabled).toBe(true);
    type("   ");
    expect(send().disabled).toBe(true);
    click();
    expect(p.onSend).not.toHaveBeenCalled();
    type("a");
    expect(send().disabled).toBe(false);
  });

  it("is the textarea's description, so a screen reader hears what is left", () => {
    render();
    expect(textarea().getAttribute("aria-describedby")).toBe(q("left")!.id);
    expect(q("left")!.id).not.toBe("");
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
    expect(line("status").textContent).toBe("Sent");
    expect(line("alert").textContent).toBe("");
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
    expect(line("status").textContent).toBe(
      "Sending wasn't confirmed; check the thread before sending again",
    );
    expect(line("alert").textContent).toBe("");
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
    expect(line("alert").textContent).toBe("The platform refused: Cannot reply");
    expect(line("status").textContent).toBe("");
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
    expect(line("alert").textContent).toContain("doesn't allow a reply right now");
    click();
    await settle();
    expect(line("alert").textContent).toBe("Couldn't reach the Worker; check your connection.");
  });

  it("has its result lines in the page, empty, before anything is sent", () => {
    render();
    expect(line("status").textContent).toBe("");
    expect(line("alert").textContent).toBe("");
  });

  it("clears the result line when the text is edited again", async () => {
    render();
    type("hi");
    click();
    await settle();
    expect(line("status").textContent).toBe("Sent");
    type("hi again");
    expect(line("status").textContent).toBe("");
  });

  it("keeps its text, its pending send and its result when the parent switches the kind", async () => {
    const pending = deferred();
    const first = vi.fn(() => pending.promise);
    const second = vi.fn(async () => ok);
    const comment = props({ kind: "comment", limit: { chars: 2200 }, onSend: first });
    act(() => root.render(<ReplyBox {...comment} />));
    type("هلا");
    click();
    expect(first).toHaveBeenCalledTimes(1);

    // The "Reply privately" toggle: the same box, now a private reply with its own limit and sender.
    const textBefore = textarea();
    act(() =>
      root.render(<ReplyBox {...comment} kind="private" limit={{ bytes: 1000 }} onSend={second} />),
    );
    expect(textarea()).toBe(textBefore); // the same element: nothing was unmounted
    expect(textarea().value).toBe("هلا");
    expect(send().disabled).toBe(true);
    expect(send().textContent).toBe("Sending…");
    click();
    expect(second).not.toHaveBeenCalled();

    pending.resolve(ok);
    await settle();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    expect(textarea().value).toBe("");
    expect(line("status").textContent).toBe("Sent");
  });
});

describe("ReplyBox name and focus", () => {
  it("names the textarea for its kind, or as the parent says", () => {
    render({ kind: "dm" });
    expect(textarea().getAttribute("aria-label")).toBe("Reply");
    render({ kind: "private" });
    expect(textarea().getAttribute("aria-label")).toBe("Reply privately");
    render({ kind: "comment", label: "Reply @noura" });
    expect(textarea().getAttribute("aria-label")).toBe("Reply @noura");
  });

  it("takes focus when asked, and leaves it alone otherwise", () => {
    render();
    expect(document.activeElement).not.toBe(textarea());
    act(() => root.unmount());
    root = createRoot(host);
    render({ autoFocus: true });
    expect(document.activeElement).toBe(textarea());
  });
});

describe("ReplyBox disabled", () => {
  it("shows why and sends nothing", () => {
    const p = render({ disabled: true, disabledReason: "Not right now" });
    expect(q("reason")!.textContent).toBe("Not right now");
    expect(textarea().disabled).toBe(true);
    expect(send().disabled).toBe(true);
    expect(textarea().getAttribute("aria-describedby")).toContain(q("reason")!.id);
    click();
    expect(p.onSend).not.toHaveBeenCalled();
  });

  it("shows no reason when it is enabled", () => {
    render();
    expect(q("reason")).toBeNull();
    expect(textarea().disabled).toBe(false);
  });
});
