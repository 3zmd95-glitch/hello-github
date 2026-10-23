// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ar from "@/messages/ar.json";
import en from "@/messages/en.json";
import arWorkflows from "@/messages/workflows.ar.json";
import enWorkflows from "@/messages/workflows.en.json";
import { readFileSync } from "node:fs";
import {
  JOURNAL_CAPACITY,
  candidateEntry,
  readJournal,
  withEntry,
} from "@/lib/cloudWorkflowJournal";
import { CLOUD_RUNS_MAX, PROOF_CAPACITY, TOMBSTONES_MAX } from "@/lib/cloudWorkflowReconciliation";
import { REGISTRATION_CAPACITY } from "@/lib/cloudWorkflowRegistration";
import {
  STORAGE_KEY,
  saveStatus,
  savesSettled,
  setArticlesLock,
  useStore,
  type ArticlesLock,
} from "@/store";
import { BODY_BYTES_MAX, CONTEXT_BYTES_MAX } from "@/workers/scout/src/social/workflowProtocol";
import SettingsScreen, { OUTPUT_TEXT_MAX } from "./SettingsScreen";

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

// ⚙️ DT-7C-3C: the Cloud workflows card and the import-result copy, over a FAKE hub (vi.mock). Numbers are compared
// with the imported limit constants, never literals; Check connection is exactly one handshake per click; nothing is
// called at mount; the token never reaches the card.
const fake = vi.hoisted(() => {
  const subs = new Set<() => void>();
  const s = {
    view: {
      configured: { ok: false, reason: "none" },
      authority: null,
      handshake: "idle",
      busy: new Set<string>(),
      last: {},
    } as Record<string, unknown>,
    counts: {
      registrations: 0,
      proofs: 0,
      tombstones: 0,
      pending: 0,
      runs: 0,
      journal: 0,
    } as Record<string, number | null>,
  };
  const call = () => vi.fn(async (): Promise<unknown> => ({}));
  const hub = {
    view: () => s.view,
    subscribe: (cb: () => void) => {
      subs.add(cb);
      return () => void subs.delete(cb);
    },
    handshake: call(),
    register: call(),
    unregister: call(),
    recover: call(),
    submit: call(),
    status: call(),
    run: call(),
    cancel: call(),
    reconcile: call(),
    check: call(),
    ack: call(),
    counts: () => s.counts,
    registrations: () => [],
    cloudRuns: () => [],
    deliverable: () => [],
  };
  return { s, subs, hub, cloudHub: vi.fn(() => hub) };
});
vi.mock("@/lib/cloudWorkflowHub", () => ({
  cloudHub: fake.cloudHub,
  leaveCloudScreen: vi.fn(),
}));

const ACTIONS = [
  "handshake",
  "register",
  "unregister",
  "recover",
  "submit",
  "status",
  "run",
  "cancel",
  "reconcile",
  "check",
  "ack",
] as const;
const A = "https://cloud.test";
const TOKEN = "TOKEN-CANARY-3c";
const setHub = (view: Record<string, unknown> = {}, counts: Record<string, number | null> = {}) => {
  fake.s.view = {
    configured: { ok: true, origin: A },
    authority: null,
    handshake: "idle",
    busy: new Set<string>(),
    last: {},
    ...view,
  };
  fake.s.counts = {
    registrations: 3,
    proofs: 12,
    tombstones: 2,
    pending: 0,
    runs: 7,
    journal: 5,
    ...counts,
  };
  for (const cb of [...fake.subs]) cb();
};
const fill = (m: Msgs, key: string, vars: Record<string, string | number> = {}) =>
  m[key].replace(/\{(\w+)\}/g, (x, k: string) => (k in vars ? String(vars[k]) : x));

describe.each([
  ["ar", { ...ar, ...arWorkflows } as Msgs],
  ["en", { ...en, ...enWorkflows } as Msgs],
] as const)("Settings cloud workflows card (%s)", (lang, m) => {
  beforeEach(() => {
    setHub();
    for (const k of ACTIONS) (fake.hub[k] as ReturnType<typeof vi.fn>).mockClear();
  });

  it("sits right after the API keys card, with the plain note, and calls no hub action on mount", async () => {
    await mount(lang);
    const card = document.getElementById("cloud-workflows")!;
    expect(card.previousElementSibling).toBe(document.getElementById("api-keys"));
    expect(card.textContent).toContain(m["settings.cloud.title"]);
    expect(card.textContent).toContain(m["settings.cloud.note"]);
    for (const k of ACTIONS) expect(fake.hub[k], k).not.toHaveBeenCalled();
    // A bfcache return re-subscribes; it sends nothing either.
    await act(async () => window.dispatchEvent(new Event("pageshow")));
    for (const k of ACTIONS) expect(fake.hub[k], k).not.toHaveBeenCalled();
  });

  it("shows every count against its limit constant, and the limits sentence from the constants", async () => {
    await mount(lang);
    const row = (k: string) => $(`settings-cloud-count-${k}`)!.textContent;
    const line = (k: string, n: number, max: number) =>
      m[`settings.cloud.count.${k}`] + fill(m, "settings.cloud.of", { n, max });
    expect(row("registrations")).toBe(line("registrations", 3, REGISTRATION_CAPACITY));
    expect(row("proofs")).toBe(line("proofs", 12, PROOF_CAPACITY));
    expect(row("tombstones")).toBe(line("tombstones", 2, TOMBSTONES_MAX));
    expect(row("runs")).toBe(line("runs", 7, CLOUD_RUNS_MAX));
    expect(row("journal")).toBe(line("journal", 5, JOURNAL_CAPACITY));
    expect($("settings-cloud-limits")!.textContent).toBe(
      fill(m, "settings.cloud.limits", {
        output: OUTPUT_TEXT_MAX,
        context: CONTEXT_BYTES_MAX / 1024,
        body: BODY_BYTES_MAX / 1024,
      }),
    );
    expect(CONTEXT_BYTES_MAX % 1024).toBe(0);
    expect(BODY_BYTES_MAX % 1024).toBe(0);
  });

  it("says it could not read an unreadable slice, and only that one", async () => {
    setHub({}, { proofs: null });
    await mount(lang);
    expect($("settings-cloud-count-proofs")!.textContent).toBe(
      m["settings.cloud.count.proofs"] + m["settings.cloud.unreadable"],
    );
    expect($("settings-cloud-count-registrations")!.textContent).toContain(
      fill(m, "settings.cloud.of", { n: 3, max: REGISTRATION_CAPACITY }),
    );
  });

  it("explains each reason the configured Worker cannot be used, and shows no button then", async () => {
    await mount(lang);
    for (const reason of ["origin", "insecure", "token", "disposed"] as const) {
      await act(async () => setHub({ configured: { ok: false, reason } }));
      expect($("settings-cloud-config")!.textContent).toBe(
        fill(m, "workflows.cloud.connect.bad", { reason: m[`workflows.cloud.reason.${reason}`] }),
      );
      expect($("workflow-cloud-check")).toBeNull();
    }
    await act(async () => setHub({ configured: { ok: false, reason: "none" } }));
    expect($("settings-cloud-config")!.textContent).toBe(m["settings.cloud.none"]);
  });

  it("Check connection is exactly one handshake per click, disabled while busy, then shows the owner key", async () => {
    await mount(lang);
    expect($("settings-cloud-owner")).toBeNull();
    const button = () => $("workflow-cloud-check") as HTMLButtonElement;
    expect(button().textContent).toBe(m["workflows.cloud.check"]);
    await click("workflow-cloud-check");
    expect(fake.hub.handshake).toHaveBeenCalledTimes(1);
    // In flight: the button is disabled and a click sends nothing.
    await act(async () => setHub({ handshake: "busy", busy: new Set(["handshake"]) }));
    expect(button().disabled).toBe(true);
    await click("workflow-cloud-check");
    expect(fake.hub.handshake).toHaveBeenCalledTimes(1);
    // Verified: the non-secret owner key and the connected copy.
    const ownerKey = "wfo_" + "b".repeat(32);
    await act(async () => setHub({ handshake: "ok", authority: { origin: A, ownerKey } }));
    expect($("settings-cloud-owner")!.textContent).toBe(
      fill(m, "settings.cloud.owner", { owner: ownerKey }),
    );
    expect($("workflow-cloud-handshake")!.textContent).toBe(m["workflows.cloud.handshake.ok"]);
    expect(button().disabled).toBe(false);
    expect(fake.hub.handshake).toHaveBeenCalledTimes(1);
  });

  it("shows the refusal and the uncertain copy, and no owner key", async () => {
    setHub({ handshake: { refused: "token" } });
    await mount(lang);
    expect($("workflow-cloud-handshake")!.textContent).toBe(
      fill(m, "workflows.cloud.handshake.refused", { reason: m["workflows.cloud.reason.token"] }),
    );
    await act(async () => setHub({ handshake: { uncertain: "uncertain" } }));
    expect($("workflow-cloud-handshake")!.textContent).toBe(
      m["workflows.cloud.handshake.uncertain"],
    );
    expect($("settings-cloud-owner")).toBeNull();
  });

  it("never puts the token in the card", async () => {
    S().setSettings({ apiKeys: { scoutUrl: A, scoutToken: TOKEN } });
    await mount(lang);
    const card = document.getElementById("cloud-workflows")!;
    expect(card.innerHTML).not.toContain(TOKEN);
    expect(card.textContent).not.toContain(TOKEN);
    expect(JSON.stringify(fake.s.view)).not.toContain(TOKEN);
  });

  it("keeps numbers out of the new copy: placeholders only", () => {
    for (const k of [
      "settings.importJournalFull",
      "settings.importRegistrationsFull",
      "settings.importReconFull",
      "settings.cloud.limits",
    ])
      expect(m[k].replace(/\{\w+\}/g, ""), k).not.toMatch(/\d/);
    expect(m["settings.importJournalFull"]).toContain("{max}");
  });
});

it("OUTPUT_TEXT_MAX mirrors the Worker protocol constant it cannot import", () => {
  const src = readFileSync("workers/scout/src/social/workflowProtocol.ts", "utf8");
  const found = /^const OUTPUT_TEXT_MAX = ([\d_]+);/m.exec(src);
  expect(Number(found![1].replaceAll("_", ""))).toBe(OUTPUT_TEXT_MAX);
});

// The import-result sentence follows the refusal's scope; a success lists what was already retired.
describe.each([
  ["ar", { ...ar, ...arWorkflows } as Msgs],
  ["en", { ...en, ...enWorkflows } as Msgs],
] as const)("Settings import result copy (%s)", (lang, m) => {
  const importWith = async (result: Awaited<ReturnType<ReturnType<typeof S>["importState"]>>) => {
    setHub();
    await mount(lang);
    const real = S().importState;
    useStore.setState({ importState: vi.fn(async () => result) });
    const input = $("import-file") as HTMLInputElement;
    const f = new File(["{}"], "backup.json", { type: "application/json" });
    Object.defineProperty(input, "files", { value: [f], configurable: true });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    await settle();
    await click("confirm-ok");
    await settle();
    useStore.setState({ importState: real });
    return notice();
  };

  it.each([
    ["registrations", "settings.importRegistrationsFull", { max: REGISTRATION_CAPACITY }],
    [
      "reconciliation",
      "settings.importReconFull",
      { proofs: PROOF_CAPACITY, tombstones: TOMBSTONES_MAX },
    ],
    [undefined, "settings.importJournalFull", { max: JOURNAL_CAPACITY }],
  ] as const)("journal-capacity (scope %s) names its own limit", async (scope, key, vars) => {
    const n = await importWith({
      ok: false,
      reason: "journal-capacity",
      ...(scope ? { scope } : {}),
    });
    expect(n!.textContent).toBe(fill(m, key, vars));
    expect(n!.className).toContain("text-danger");
  });

  it("lists how many results were already retired (singular and plural)", async () => {
    const one = await importWith({ ok: true, rejected: [], retired: ["k1"] });
    expect(one!.textContent).toBe(`${m["settings.importOk"]} ${m["settings.importRetired.one"]}`);
    await act(async () => root.unmount());
    root = createRoot(host);
    const many = await importWith({ ok: true, rejected: [], retired: ["k1", "k2", "k3"] });
    expect(many!.textContent).toBe(
      `${m["settings.importOk"]} ${fill(m, "settings.importRetired.other", { count: 3 })}`,
    );
  });
});

// DT-7C-3C fix round: the static export prerenders with the inert hub; hydration must agree with it, and the stored
// counts must show up right after.
it("Settings card: prerender and hydration agree, and the stored counts appear after hydration", async () => {
  setHub({}, { registrations: 3 });
  const el = createElement(SettingsScreen);
  const html = renderToString(el);
  expect(html).toContain(ar["settings.cloud.unreadable"]);
  const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const box = document.createElement("div");
  box.innerHTML = html;
  document.body.append(box);
  let r!: Root;
  await act(async () => {
    r = hydrateRoot(box, el);
  });
  const row = box.querySelector('[data-testid="settings-cloud-count-registrations"]')!;
  expect(row.textContent).toContain(`3 / ${REGISTRATION_CAPACITY}`);
  expect(box.textContent).not.toContain(ar["settings.cloud.unreadable"]);
  expect(errors).not.toHaveBeenCalled();
  act(() => r.unmount());
  box.remove();
});
