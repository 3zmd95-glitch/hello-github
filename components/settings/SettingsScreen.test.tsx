// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ar from "@/messages/ar.json";
import en from "@/messages/en.json";
import { candidateEntry, readJournal, withEntry } from "@/lib/cloudWorkflowJournal";
import {
  STORAGE_KEY,
  saveStatus,
  savesSettled,
  setArticlesLock,
  useStore,
  type ArticlesLock,
} from "@/store";
import SettingsScreen from "./SettingsScreen";

// ⚙️ DT-7C-2A Settings: reset and restore wait for their durable result, a second Confirm does nothing, a failure is
// never shown as done, and a reset that keeps cloud recovery records says so (Hijazi Arabic first, English second).

vi.mock("next/navigation", () => ({ usePathname: () => "/settings/" }));
vi.mock("./AvatarCard", () => ({ default: () => null }));
vi.mock("./ConnectedAccountsCard", () => ({ default: () => null }));
vi.mock("./GenresCard", () => ({ default: () => null }));

type Msgs = Record<string, string>;
const S = () => useStore.getState();
const OWNER = "wfo_" + "a".repeat(32);
const AT = "2026-10-17T09:00:00.000Z";
let host: HTMLDivElement;
let root: Root;
const $ = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const stored = () => JSON.parse(localStorage.getItem(STORAGE_KEY)!).state;
const queueLock = (): ArticlesLock => {
  let tail: Promise<unknown> = Promise.resolve();
  return (fn) => {
    const run = tail.then(fn);
    tail = run.catch(() => undefined);
    return run;
  };
};
/** A lock whose next holder waits until released. */
function heldLock() {
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  const queue = queueLock();
  let first = true;
  setArticlesLock((fn) =>
    queue(async () => {
      if (first) {
        first = false;
        await held;
      }
      return fn();
    }),
  );
  return release;
}
const quota = () => {
  const real = Storage.prototype.setItem;
  return vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k, v) {
    if (k === STORAGE_KEY) throw new DOMException("full", "QuotaExceededError");
    real.call(this, k, v);
  });
};
async function seedJournal() {
  const c = await candidateEntry("https://scout.example", {
    occurrenceId: "m1",
    ownerKey: OWNER,
    workflowId: "w1",
    kind: "manual",
    registrationEpoch: 1,
    revision: 1,
    snapshot: {
      name: { ar: "", en: "Flow" },
      trigger: { kind: "manual" },
      actions: [{ id: "a1", kind: "idea", text: { ar: "", en: "Idea" } }],
    },
    plannerContext: null,
    input: {
      title: { ar: "", en: "" },
      summary: { ar: "", en: "" },
      slug: "",
      lang: "en",
      day: "2026-10-17",
    },
    executionAt: AT,
  });
  if (!c.ok) throw new Error(c.reason);
  const raw = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
  raw.state.cloudJournal = withEntry(
    readJournal(raw.state.cloudJournal)!,
    { ...c.entry, commitId: "c1", state: "queued", observation: null },
    "c1",
  );
  localStorage.setItem(STORAGE_KEY, JSON.stringify(raw));
  await act(async () => {
    await useStore.persist.rehydrate();
  });
  return c.entry;
}
async function mount(lang: "ar" | "en") {
  await act(async () => {
    S().setSettings({ lang });
    root.render(createElement(SettingsScreen));
  });
}
const click = (id: string) => act(async () => $(id)!.click());
const settle = () => act(() => new Promise<void>((r) => setTimeout(r, 20)));
const notice = () => document.querySelector<HTMLElement>('[role="status"]');

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  setArticlesLock(queueLock());
  await S().reset(new Date("2026-01-01T00:00:00.000Z"));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
  setArticlesLock(undefined);
  vi.restoreAllMocks();
});

describe.each([
  ["ar", ar as Msgs],
  ["en", en as Msgs],
] as const)("Settings reset/restore (%s)", (lang, m) => {
  it("waits for the reset, shows it busy, ignores a second Confirm and only then says it is done", async () => {
    S().completeQuest("smart-bins-keywords", "train");
    await mount(lang);
    const real = S().reset;
    const reset = vi.fn((now?: Date) => real(now));
    useStore.setState({ reset });
    const release = heldLock();
    await click("reset");
    expect(
      $("confirm-body")?.textContent ?? document.getElementById("confirm-body")?.textContent,
    ).toBe(m["settings.resetConfirm"]);
    await click("confirm-ok");
    await click("confirm-ok");
    expect(reset).toHaveBeenCalledTimes(1);
    expect($("confirm-dialog")).not.toBeNull();
    expect($("confirm-ok")!.textContent).toBe(m["settings.resetBusy"]);
    // Cancel while it runs does not pretend anything was stopped.
    await click("confirm-cancel");
    expect($("confirm-dialog")).not.toBeNull();
    expect(S().completions).toHaveLength(1);
    expect(notice()).toBeNull();
    await act(async () => release());
    await settle();
    expect($("confirm-dialog")).toBeNull();
    expect(notice()!.textContent).toBe(m["settings.resetOk"]);
    expect(S().completions).toEqual([]);
    useStore.setState({ reset: real });
  });

  it("never reports a failed reset as done and keeps the progress", async () => {
    S().completeQuest("smart-bins-keywords", "train");
    await mount(lang);
    await click("reset");
    const q = quota();
    await click("confirm-ok");
    await settle();
    q.mockRestore();
    expect(notice()!.textContent).toBe(m["settings.resetNotSaved"]);
    expect(notice()!.className).toContain("text-danger");
    expect(S().completions).toHaveLength(1);
    expect(stored().completions).toHaveLength(1);
  });

  it("explains retained cloud recovery records before and after a reset", async () => {
    await seedJournal();
    await mount(lang);
    await click("reset");
    const body = document.getElementById("confirm-body")!.textContent!;
    expect(body).toContain(m["settings.resetConfirm"]);
    expect(body).toContain(m["settings.resetRetained"]);
    await click("confirm-ok");
    await settle();
    expect(notice()!.textContent).toBe(m["settings.resetOkRetained"]);
    expect(readJournal(stored().cloudJournal)!.entries).toHaveLength(1);
  });

  it("says when the saved cloud records cannot be read, and erases nothing", async () => {
    S().completeQuest("smart-bins-keywords", "train");
    await savesSettled(); // DT-7C-2A-R1: the ordinary save is queued under the shared lock
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    raw.state.cloudJournal = { v: 1, broken: true };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(raw));
    await act(async () => {
      await useStore.persist.rehydrate();
    });
    await mount(lang);
    await click("reset");
    expect(document.getElementById("confirm-body")!.textContent).toContain(
      m["settings.resetRetained"],
    );
    await click("confirm-ok");
    await settle();
    expect(notice()!.textContent).toBe(m["settings.journalUnreadable"]);
    expect(stored().completions).toHaveLength(1);
  });

  it("without Web Locks a reset that would write the cloud records is shown as not saved and changes nothing", async () => {
    await seedJournal();
    S().completeQuest("smart-bins-keywords", "train");
    await mount(lang);
    setArticlesLock(null);
    const before = localStorage.getItem(STORAGE_KEY);
    await click("reset");
    await click("confirm-ok");
    await settle();
    expect(notice()!.textContent).toBe(m["settings.resetNotSaved"]);
    expect(notice()!.className).toContain("text-danger");
    expect(localStorage.getItem(STORAGE_KEY)).toBe(before);
    expect(S().completions).toHaveLength(1);
  });

  it("a restore whose cloud records contradict the device's says so and changes nothing", async () => {
    const entry = await seedJournal();
    S().completeQuest("smart-bins-keywords", "train");
    const file = JSON.parse(S().exportState());
    file.state.completions = [];
    const other = JSON.parse(JSON.stringify(file.state.cloudJournal));
    other.entries[0].body.snapshot.name.en = "Other";
    const c = await candidateEntry("https://scout.example", other.entries[0].body);
    if (!c.ok) throw new Error(c.reason);
    file.state.cloudJournal = withEntry(
      readJournal(undefined)!,
      { ...c.entry, commitId: "x", state: "queued", observation: null },
      "x",
    );
    expect(c.entry.key).toBe(entry.key);
    await mount(lang);
    const input = $("import-file") as HTMLInputElement;
    const f = new File([JSON.stringify(file)], "backup.json", { type: "application/json" });
    Object.defineProperty(input, "files", { value: [f], configurable: true });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    await settle();
    await click("confirm-ok");
    await settle();
    expect(notice()!.textContent).toBe(m["settings.importJournalRefused"]);
    expect(stored().completions).toHaveLength(1);
  });
});

it("the new copy keys exist in both languages", () => {
  for (const k of [
    "settings.resetRetained",
    "settings.resetBusy",
    "settings.resetNotSaved",
    "settings.resetOkRetained",
    "settings.importBusy",
    "settings.importJournalRefused",
    "settings.importJournalFull",
    "settings.journalUnreadable",
  ]) {
    expect((ar as Msgs)[k], k).toBeTruthy();
    expect((en as Msgs)[k], k).toBeTruthy();
  }
});

// DT-7C-2A-R1: an ordinary save refused over unreadable storage is shown honestly; nothing is overwritten.
describe.each([
  ["ar", ar as Msgs],
  ["en", en as Msgs],
] as const)("Settings save failure (%s)", (lang, m) => {
  it("says when the latest change could not be saved, keeps the stored bytes, and clears once a save lands", async () => {
    expect(m["settings.saveFailed"]).toBeTruthy();
    saveStatus.setState({}, true);
    await mount(lang);
    await act(() => savesSettled());
    expect($("save-failed")).toBeNull();
    const good = localStorage.getItem(STORAGE_KEY)!;
    localStorage.setItem(STORAGE_KEY, "{BROKEN");
    await act(async () => {
      S().setSettings({ sound: false });
      await savesSettled();
    });
    expect($("save-failed")?.textContent).toBe(m["settings.saveFailed"]);
    expect(localStorage.getItem(STORAGE_KEY)).toBe("{BROKEN");
    localStorage.setItem(STORAGE_KEY, good);
    await act(async () => {
      S().setSettings({ sound: false });
      await savesSettled();
    });
    expect($("save-failed")).toBeNull();
    expect(stored().settings.sound).toBe(false);
  });
});
