import { DatabaseSync } from "node:sqlite";
import { expect, test as base, type BrowserContext, type Page, type Route } from "@playwright/test";
import en from "../messages/en.json";
import ar from "../messages/ar.json";
import wfEn from "../messages/workflows.en.json";
import wfAr from "../messages/workflows.ar.json";
import { seedState } from "./helpers";
import { parseAnswer, type CloudRequest } from "../lib/cloudWorkflowProtocol";
import {
  REGISTRATION_CAPACITY,
  createIntent,
  emptyRegistrations,
  prepareIntent,
  recordOutcome,
  reserveAttempt,
  type CloudRegistrations,
} from "../lib/cloudWorkflowRegistration";
import { PROOF_CAPACITY, TOMBSTONES_MAX } from "../lib/cloudWorkflowReconciliation";
import { BODY_BYTES_MAX, CONTEXT_BYTES_MAX } from "../workers/scout/src/social/workflowProtocol";

type Handle = (
  req: Request,
  env: Record<string, unknown>,
  ctx: undefined,
  deps: { now: () => Date },
) => Promise<Response>;

// Loaded with require, typed by hand: a TypeScript import would pull the whole Worker (Cloudflare-only types) into the
// app's own `tsc`, and a dynamic import() cannot load the Worker's JSON data files under Playwright's ESM loader.
/* eslint-disable @typescript-eslint/no-require-imports */
const { handle } = require("../workers/scout/src/scout") as { handle: Handle };
const { WorkflowCoordinator } = require("../workers/scout/src/social/workflowCoordinator") as {
  WorkflowCoordinator: new (state: never) => { fetch(req: Request): Promise<Response> };
};
/* eslint-enable @typescript-eslint/no-require-imports */

// ⚙️ DT-7C-3D (planning/collaboration/dt7c3-integration-plan.md): the cloud-workflow dashboard in the exported app,
// driven in the installed Chrome. The Worker is the REAL Worker router and the REAL SQLite WorkflowCoordinator (the
// same rig as store/cloudWorkflowOccurrence.test.ts) answering one synthetic origin, https://cloud.test, from a
// Playwright route in this Node process: no live Worker, no network. Every other non-localhost request is aborted.
// Seeded state is synthetic (a synthetic token, never a real one); each test gets its own browser context and its own
// in-memory Worker database. Desktop runs the English UI, phone the Arabic one. The log of what the Worker received is
// the proof of "one click, one request": nothing at load, nothing in the background, no retry.

const PORT = Number(process.env.E2E_PORT) || 3000;
const APP = `http://localhost:${PORT}`;
const CLOUD = "https://cloud.test";
const OTHER = "https://other.test";
const TOKEN = "e2e-synthetic-token-not-a-real-secret";
const AT = "2026-10-22T09:00:00.000Z";
const OWNER = "wfo_" + "a".repeat(32);
/** `OUTPUT_TEXT_MAX` is not exported by the pinned snapshot module (see the 3C record); the Worker source pins it. */
const OUTPUT_TEXT_MAX = 4_000;

type Lang = "en" | "ar";
const MESSAGES: Record<Lang, Record<string, string>> = {
  en: { ...en, ...wfEn },
  ar: { ...ar, ...wfAr },
};
const copy = (lang: Lang, key: string, vars: Record<string, string | number> = {}) => {
  const text = MESSAGES[lang][key];
  if (text === undefined) throw new Error(`missing message ${key}`);
  return text.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k]));
};

/* ---------- the real Worker behind a Playwright route ---------- */

interface Logged {
  readonly kind: string;
  readonly method: string;
  readonly path: string;
  readonly status: number;
  readonly body?: unknown;
  readonly answer?: unknown;
}

function kindOf(path: string): string {
  const p = path.replace(/^\/social\/workflows/, "");
  if (p === "/authority") return "authority";
  if (p === "/registrations") return "register";
  let m = /^\/registrations\/[^/]+\/(unregister|pause|resume)$/.exec(p);
  if (m) return m[1];
  if (p === "/occurrences") return "submit";
  m = /^\/occurrences\/[^/]+(?:\/(run|cancel|ack))?$/.exec(p);
  if (m) return m[1] ?? "status";
  if (p === "/changes") return "changes";
  return `other:${p}`;
}

/** node:sqlite behind the Durable Object storage surface the coordinator uses (as store/cloudWorkflowOccurrence.test.ts). */
function sqliteStorage(db: DatabaseSync) {
  return {
    sql: {
      exec(query: string, ...bindings: (string | number | null)[]) {
        const st = db.prepare(query);
        if (/^\s*SELECT|RETURNING/i.test(query)) {
          const rows = st.all(...bindings);
          return { toArray: () => rows };
        }
        st.run(...bindings);
        return { toArray: () => [] };
      },
    },
    transactionSync<V>(fn: () => V): V {
      db.exec("BEGIN");
      try {
        const v = fn();
        db.exec("COMMIT");
        return v;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
  };
}

class Cloud {
  /** Every non-preflight request the Worker received, in order. */
  readonly log: Logged[] = [];
  private loseNext: string | null = null;

  private constructor(
    private readonly handle: Handle,
    private readonly env: Record<string, unknown>,
  ) {}

  static async create(): Promise<Cloud> {
    const db = new DatabaseSync(":memory:");
    const ns = {
      idFromName: (name: string) => name,
      get: () => ({
        async fetch(url: string, init: RequestInit) {
          return new WorkflowCoordinator({ storage: sqliteStorage(db) } as never).fetch(
            new Request(url, init),
          );
        },
      }),
    };
    return new Cloud(handle as unknown as Handle, {
      SCOUT_TOKEN: TOKEN,
      ALLOWED_ORIGINS: APP,
      WORKFLOW_COORDINATOR: ns,
    });
  }

  of(kind: string): Logged[] {
    return this.log.filter((l) => l.kind === kind);
  }
  /** Requests other than authority handshakes. */
  get work(): Logged[] {
    return this.log.filter((l) => l.kind !== "authority");
  }
  get kinds(): string[] {
    return this.log.map((l) => l.kind);
  }
  /** The Worker processes the next request of this kind, then the answer never arrives (a dropped answer). */
  loseAnswerOf(kind: string): void {
    this.loseNext = kind;
  }

  async serve(route: Route): Promise<void> {
    const req = route.request();
    const url = new URL(req.url());
    const sent = await req.allHeaders();
    const headers = new Headers();
    for (const k of [
      "authorization",
      "content-type",
      "access-control-request-method",
      "access-control-request-headers",
    ])
      if (sent[k]) headers.set(k, sent[k]);
    headers.set("Origin", APP);
    const post = req.postData() ?? undefined;
    const res = await this.handle(
      new Request(req.url(), {
        method: req.method(),
        headers,
        ...(post !== undefined && req.method() !== "GET" ? { body: post } : {}),
      }),
      this.env,
      undefined,
      { now: () => new Date() },
    );
    const text = await res.text();
    const out = { ...Object.fromEntries(res.headers) };
    delete out["content-length"];
    delete out["content-encoding"];
    if (req.method() === "OPTIONS") return route.fulfill({ status: res.status, headers: out });
    const kind = kindOf(url.pathname);
    let answer: unknown;
    try {
      answer = JSON.parse(text);
    } catch {
      answer = text;
    }
    this.log.push({
      kind,
      method: req.method(),
      path: url.pathname + url.search,
      status: res.status,
      ...(post ? { body: JSON.parse(post) } : {}),
      answer,
    });
    if (this.loseNext === kind) {
      this.loseNext = null;
      return route.abort("failed");
    }
    return route.fulfill({ status: res.status, headers: out, body: text });
  }
}

/* ---------- fixtures ---------- */

const test = base.extend<{ cloud: Cloud; lang: Lang }>({
  lang: async ({}, run, info) => {
    await run(info.project.name === "phone" ? "ar" : "en");
  },
  cloud: async ({ context }, run) => {
    const cloud = await Cloud.create();
    await installNetwork(context, cloud);
    await run(cloud);
  },
});

/** localhost passes; the synthetic Worker origin is the real router; everything else is aborted. */
async function installNetwork(context: BrowserContext, cloud: Cloud): Promise<void> {
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return route.continue();
    if (url.origin === CLOUD) return cloud.serve(route);
    return route.abort();
  });
}

const manual = {
  id: "wf-manual",
  name: { ar: "يومي", en: "Daily" },
  trigger: { kind: "manual" as const },
  actions: [{ id: "i1", kind: "idea" as const, text: { ar: "فكرة {date}", en: "Idea {date}" } }],
  enabled: true,
  revision: 1,
  commitId: "wf-manual-baseline",
  createdAt: AT,
  updatedAt: AT,
};

const editor = `/social/workflows/#w=${manual.id}`;
/**
 * The app's existing social account pull (GET /social/status and /social/data, due hourly on any page once a Worker is
 * configured) is unrelated to workflows; a pull that happened just now keeps it out of the Worker log under test.
 */
const state = (lang: Lang, extra: Record<string, unknown> = {}) => ({
  settings: { lang, apiKeys: { scoutUrl: CLOUD, scoutToken: TOKEN } },
  socialSync: { lastPullAt: new Date().toISOString() },
  workflows: [manual],
  ...extra,
});
const stored = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem("3z-prod-v1")!).state);

/** One valid refused first registration (409 capacity: nothing applied, no lifecycle) at the given Worker. */
async function refusedFirst(
  prev: CloudRegistrations,
  origin: string,
  workflowId: string,
): Promise<CloudRegistrations> {
  const req: CloudRequest = {
    kind: "register",
    ownerKey: OWNER,
    workflowId,
    expectedEpoch: 0,
    revision: 1,
    workflowDigest: "b".repeat(64),
  };
  const p = prepareIntent(req, { origin, ownerKey: OWNER });
  if (!p.ok) throw new Error(p.reason);
  const c = createIntent(prev, p, `op-${workflowId}`, AT);
  if (!c.ok) throw new Error(c.reason);
  const i = c.next.records.find((r) => r.key === p.key)!.intent;
  const r = reserveAttempt(c.next, p.key, i);
  if (!r.ok) throw new Error(r.reason);
  const answer = { status: 409, body: { error: "capacity", ownerKey: OWNER } };
  const parsed = await parseAnswer(req, answer, { origin });
  const out = recordOutcome(r.next, p.key, i.operationId, r.attempt, {
    kind: "answer",
    answer,
    parsed,
  });
  if (!out.changed) throw new Error(out.reason);
  return out.next;
}

/* ---------- page helpers ---------- */

const chip = (page: Page) => page.getByTestId("workflow-cloud-chip");
const handshakeLine = (page: Page) => page.getByTestId("workflow-cloud-handshake").first();

/** One click on Check connection; waits for the "Connected." line. */
async function connect(page: Page, lang: Lang): Promise<void> {
  await page.getByTestId("workflow-cloud-check").first().click();
  await expect(handshakeLine(page)).toHaveText(copy(lang, "workflows.cloud.handshake.ok"));
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

/** Connect, then Put on cloud, in the editor of the seeded workflow. */
async function putOnCloud(page: Page, cloud: Cloud, lang: Lang): Promise<void> {
  await connect(page, lang);
  await page.getByTestId("workflow-cloud-register").click();
  await expect(chip(page)).toHaveAttribute("data-state", "active");
  expect(cloud.of("register")).toHaveLength(1);
}

/** Registered workflow: Run now captures, Send submits, Run runs it on the Worker until done. */
async function finishOnWorker(page: Page, cloud: Cloud, lang: Lang): Promise<void> {
  await putOnCloud(page, cloud, lang);
  await page.getByTestId("workflows-run").click();
  const entry = page.getByTestId("workflow-cloud-entry");
  await expect(entry).toHaveCount(1);
  await entry.getByTestId("workflow-cloud-submit").click();
  await expect.poll(() => cloud.of("submit").length).toBe(1);
  await expect(entry.getByTestId("workflow-cloud-entry-result")).toBeVisible();
  await entry.getByTestId("workflow-cloud-run").click();
  await expect.poll(() => cloud.of("run").length).toBe(1);
  await expect(page.getByTestId("workflow-cloud-entry-result")).toContainText(
    copy(lang, "workflows.cloud.state.done"),
  );
}

/** Back to the list: a fresh connection (leaving the screen clears it), then one Fetch results click. */
async function fetchResults(page: Page, lang: Lang): Promise<void> {
  await page.getByTestId("workflow-cloud-fetch").waitFor();
  if (await page.getByTestId("workflow-cloud-fetch").isDisabled()) await connect(page, lang);
  await page.getByTestId("workflow-cloud-fetch").click();
}

const workflowIdeas = async (page: Page) =>
  ((await stored(page)).ideas as { id: string; source: string; text: string }[]).filter(
    (i) => i.source === "workflow",
  );

/* ---------- the cases ---------- */

test.describe("cloud workflows in the dashboard (real Worker router, synthetic origin)", () => {
  test("a: nothing is sent on load or reload of Workflows and Settings", async ({
    page,
    cloud,
    lang,
  }) => {
    await seedState(page, "/social/workflows/", state(lang));
    await expect(page.getByTestId("workflow-cloud-results")).toBeVisible();
    await expect(page.getByTestId("workflow-cloud-connect").first()).toContainText(CLOUD);
    await expect(handshakeLine(page)).toHaveText(copy(lang, "workflows.cloud.connect.need"));
    await page.reload();
    await expect(page.getByTestId("workflow-cloud-results")).toBeVisible();
    await page.goto(editor);
    await expect(page.getByTestId("workflow-cloud-card")).toBeVisible();
    await expect(chip(page)).toHaveAttribute("data-state", "local");
    await page.reload();
    await expect(page.getByTestId("workflow-cloud-card")).toBeVisible();
    await page.goto("/settings/");
    await expect(page.getByTestId("settings-cloud-counts")).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("settings-cloud-counts")).toBeVisible();
    await expect(page.getByTestId("settings-cloud-owner")).toHaveCount(0);
    await sleep(800);
    expect(cloud.log).toEqual([]);
  });

  test("b: Check connection in Settings shows the owner, the capacities and the limits", async ({
    page,
    cloud,
    lang,
  }) => {
    await seedState(page, "/settings/", state(lang));
    await expect(
      page.getByTestId("settings-cloud-connect").or(page.getByTestId("workflow-cloud-connect")),
    ).toBeVisible();
    expect(cloud.log).toEqual([]);
    await connect(page, lang);
    // One click: one handshake per controller (registration, occurrence, reconciliation), nothing else.
    expect(cloud.kinds).toEqual(["authority", "authority", "authority"]);
    const ownerKey = (cloud.log[0].answer as { ownerKey: string }).ownerKey;
    expect(ownerKey).toMatch(/^wfo_[0-9a-f]{32}$/);
    await expect(page.getByTestId("settings-cloud-owner")).toHaveText(
      copy(lang, "settings.cloud.owner", { owner: ownerKey }),
    );
    for (const [key, max] of [
      ["registrations", REGISTRATION_CAPACITY],
      ["proofs", PROOF_CAPACITY],
      ["tombstones", TOMBSTONES_MAX],
    ] as const)
      await expect(page.getByTestId(`settings-cloud-count-${key}`)).toContainText(
        copy(lang, "settings.cloud.of", { n: 0, max }),
      );
    expect([REGISTRATION_CAPACITY, PROOF_CAPACITY, TOMBSTONES_MAX]).toEqual([100, 600, 100]);
    await expect(page.getByTestId("settings-cloud-limits")).toHaveText(
      copy(lang, "settings.cloud.limits", {
        output: OUTPUT_TEXT_MAX,
        context: CONTEXT_BYTES_MAX / 1024,
        body: BODY_BYTES_MAX / 1024,
      }),
    );
    await sleep(500);
    expect(cloud.log).toHaveLength(3);
  });

  test("c: Put on cloud sends one registration and the chip stays after a reload", async ({
    page,
    cloud,
    lang,
  }) => {
    await seedState(page, editor, state(lang));
    await expect(chip(page)).toHaveAttribute("data-state", "local");
    await expect(chip(page)).toHaveText(copy(lang, "workflows.cloud.chip.local"));
    await connect(page, lang);
    expect(cloud.work).toHaveLength(0);
    await page.getByTestId("workflow-cloud-register").click();
    await expect(page.getByTestId("workflow-cloud-result")).toHaveText(
      copy(lang, "workflows.cloud.intent.settled"),
    );
    await expect(chip(page)).toHaveText(copy(lang, "workflows.cloud.chip.active"));
    expect(cloud.work.map((l) => l.kind)).toEqual(["register"]);
    expect(cloud.of("register")[0]).toMatchObject({ method: "POST", status: 200 });
    const before = cloud.log.length;
    await page.reload();
    await expect(chip(page)).toHaveText(copy(lang, "workflows.cloud.chip.active"));
    await expect(page.getByTestId("workflow-cloud-unregister")).toBeVisible();
    await sleep(500);
    expect(cloud.log).toHaveLength(before);
  });

  test("d: Run now captures a cloud entry without running locally; Send and Check status are one request each", async ({
    page,
    cloud,
    lang,
  }) => {
    await seedState(page, editor, state(lang));
    await putOnCloud(page, cloud, lang);
    const logged = cloud.log.length;
    await page.getByTestId("workflows-run").click();
    const entry = page.getByTestId("workflow-cloud-entry");
    await expect(entry).toHaveCount(1);
    await expect(entry).toHaveAttribute("data-state", "queued");
    await expect(page.getByTestId("workflow-cloud-captured")).toHaveText(
      copy(lang, "workflows.cloud.captured"),
    );
    await expect(entry).toContainText(copy(lang, "workflows.cloud.entry.queued"));
    await expect(entry).toContainText(copy(lang, "workflows.cloud.entry.none"));
    // Nothing ran on this device and nothing was sent yet.
    await expect(page.getByTestId("workflows-run-row")).toHaveCount(0);
    expect((await stored(page)).workflowRuns ?? []).toHaveLength(0);
    await sleep(500);
    expect(cloud.log).toHaveLength(logged);

    await entry.getByTestId("workflow-cloud-submit").click();
    await expect.poll(() => cloud.of("submit").length).toBe(1);
    await expect(entry.getByTestId("workflow-cloud-entry-result")).toHaveText(
      copy(lang, "workflows.cloud.answered", {
        state: copy(lang, "workflows.cloud.state.pending"),
      }),
    );
    await expect(entry).toContainText(
      copy(lang, "workflows.cloud.entry.observed", {
        state: copy(lang, "workflows.cloud.state.pending"),
        version: 1,
      }),
    );
    expect(cloud.of("submit")[0]).toMatchObject({ method: "POST", status: 201 });

    await entry.getByTestId("workflow-cloud-status").click();
    await expect.poll(() => cloud.of("status").length).toBe(1);
    await expect(entry.getByTestId("workflow-cloud-entry-result")).toHaveText(
      copy(lang, "workflows.cloud.answered", {
        state: copy(lang, "workflows.cloud.state.pending"),
      }),
    );
    await sleep(500);
    expect(cloud.work.map((l) => l.kind)).toEqual(["register", "submit", "status"]);
  });

  test("e: a dropped status answer reads 'sent, check status', with one request and no retry", async ({
    page,
    cloud,
    lang,
  }) => {
    await seedState(page, editor, state(lang));
    await putOnCloud(page, cloud, lang);
    await page.getByTestId("workflows-run").click();
    const entry = page.getByTestId("workflow-cloud-entry");
    await entry.getByTestId("workflow-cloud-submit").click();
    await expect.poll(() => cloud.of("submit").length).toBe(1);
    await expect(entry.getByTestId("workflow-cloud-entry-result")).toBeVisible();

    cloud.loseAnswerOf("status");
    await entry.getByTestId("workflow-cloud-status").click();
    const result = entry.getByTestId("workflow-cloud-entry-result");
    await expect(result).toHaveText(copy(lang, "workflows.cloud.sent"));
    await expect(result).toHaveAttribute("role", "alert");
    await sleep(1500);
    expect(cloud.of("status")).toHaveLength(1);
    expect(cloud.work.map((l) => l.kind)).toEqual(["register", "submit", "status"]);
    // Not failed, not delivered: the entry still reads the last answer it did see, and the button works again.
    await expect(entry).toContainText(
      copy(lang, "workflows.cloud.entry.observed", {
        state: copy(lang, "workflows.cloud.state.pending"),
        version: 1,
      }),
    );
    await expect(entry.getByTestId("workflow-cloud-status")).toBeEnabled();
  });

  test("f: Fetch results adopts one idea draft once, a reload keeps it, a second fetch adds nothing", async ({
    page,
    cloud,
    lang,
  }) => {
    await seedState(page, editor, state(lang));
    await finishOnWorker(page, cloud, lang);
    expect(await workflowIdeas(page)).toHaveLength(0);

    await page.getByTestId("workflows-back").click();
    await expect(page.getByTestId("workflow-cloud-results")).toBeVisible();
    await expect(page.getByTestId("workflow-cloud-proof")).toHaveCount(0);
    const mark = cloud.log.length;
    await fetchResults(page, lang);
    await expect(page.getByTestId("workflow-cloud-proof")).toHaveCount(1);
    const fetched = cloud.log.slice(mark).filter((l) => l.kind !== "authority");
    expect(fetched.map((l) => l.kind)).toEqual(["changes", "status"]);
    await expect.poll(async () => (await workflowIdeas(page)).length).toBe(1);
    const [idea] = await workflowIdeas(page);
    expect(idea.id).toMatch(/^wf:[\w-]+:i1$/);
    expect(idea.text).toContain(lang === "ar" ? "فكرة" : "Idea");

    await page.goto("/social/ideas/");
    await expect(page.getByText(idea.text, { exact: false }).first()).toBeVisible();
    await page.reload();
    await expect(page.getByText(idea.text, { exact: false }).first()).toBeVisible();
    expect(await workflowIdeas(page)).toHaveLength(1);

    await page.goto("/social/workflows/");
    const again = cloud.log.length;
    await fetchResults(page, lang);
    await expect(page.getByTestId("workflow-cloud-page")).toBeVisible();
    await expect
      .poll(() => cloud.log.slice(again).filter((l) => l.kind === "changes").length)
      .toBe(1);
    await sleep(500);
    expect(cloud.log.slice(again).filter((l) => l.kind === "status")).toHaveLength(0);
    expect(await workflowIdeas(page)).toHaveLength(1);
    await expect(page.getByTestId("workflow-cloud-proof")).toHaveCount(1);
  });

  test("g: Confirm delivery appears after the draft is read back and sends one ack", async ({
    page,
    cloud,
    lang,
  }) => {
    await seedState(page, editor, state(lang));
    await finishOnWorker(page, cloud, lang);
    await page.getByTestId("workflows-back").click();
    await expect(page.getByTestId("workflow-cloud-results")).toBeVisible();
    // Finished on the Worker, but not fetched: no draft here yet, so nothing to confirm.
    await expect(page.getByTestId("workflow-cloud-ack")).toHaveCount(0);
    expect(await workflowIdeas(page)).toHaveLength(0);
    await fetchResults(page, lang);
    await expect.poll(async () => (await workflowIdeas(page)).length).toBe(1);
    const ack = page.getByTestId("workflow-cloud-ack");
    await expect(ack).toBeEnabled();
    expect(cloud.of("ack")).toHaveLength(0);

    await ack.click();
    await expect.poll(() => cloud.of("ack").length).toBe(1);
    const [first] = cloud.of("ack");
    expect(first).toMatchObject({ method: "POST", status: 200 });
    expect(first.answer).toMatchObject({ acknowledged: true });
    await expect(page.getByTestId("workflow-cloud-ack-result")).toHaveText(
      copy(lang, "workflows.cloud.deliver.done"),
    );
    // Nothing else follows by itself: no status, no second ack.
    await sleep(1200);
    expect(cloud.of("ack")).toHaveLength(1);
    expect(await workflowIdeas(page)).toHaveLength(1);

    // Acknowledged: the button is disabled until the proof changes, so a second click sends nothing (DT-7C-3D fix round).
    await expect(ack).toBeDisabled();
    await ack.click({ force: true });
    await sleep(1000);
    expect(cloud.of("ack")).toHaveLength(1);

    // Check status after the ack retires the proof: it leaves the Confirm delivery list.
    await page.getByTestId("workflow-cloud-proof-status").click();
    await expect(page.getByTestId("workflow-cloud-proof")).toHaveCount(0);
    expect(await workflowIdeas(page)).toHaveLength(1);
  });

  test("h: another Worker and a full cloud show their copy with no request", async ({
    page,
    cloud,
    lang,
  }) => {
    // A registration record at a different Worker than the one in Settings.
    const foreign = await refusedFirst(emptyRegistrations(), OTHER, manual.id);
    await seedState(page, editor, state(lang, { cloudRegistrations: foreign }));
    await expect(chip(page)).toHaveAttribute("data-state", "another");
    await expect(chip(page)).toHaveText(copy(lang, "workflows.cloud.chip.another"));
    await expect(page.getByText(copy(lang, "workflows.cloud.anotherHelp"))).toBeVisible();
    await expect(page.getByTestId("workflow-cloud-register")).toHaveCount(0);
    await expect(page.getByTestId("workflow-cloud-unregister")).toHaveCount(0);

    // The cloud holds REGISTRATION_CAPACITY other workflows.
    let full = emptyRegistrations();
    for (let i = 0; i < REGISTRATION_CAPACITY; i++)
      full = await refusedFirst(full, CLOUD, `cap-${i}`);
    await seedState(page, editor, state(lang, { cloudRegistrations: full }));
    await expect(chip(page)).toHaveAttribute("data-state", "capacity");
    await expect(chip(page)).toHaveText(
      copy(lang, "workflows.cloud.chip.capacity", {
        count: REGISTRATION_CAPACITY,
        max: REGISTRATION_CAPACITY,
      }),
    );
    await expect(
      page.getByText(copy(lang, "workflows.cloud.capacityHelp", { max: REGISTRATION_CAPACITY })),
    ).toBeVisible();
    await expect(page.getByTestId("workflow-cloud-register")).toBeDisabled();
    await page.goto("/settings/");
    await expect(page.getByTestId("settings-cloud-count-registrations")).toContainText(
      copy(lang, "settings.cloud.of", { n: REGISTRATION_CAPACITY, max: REGISTRATION_CAPACITY }),
    );
    await sleep(500);
    expect(cloud.log).toEqual([]);
  });

  test("i: Take off cloud sends one unregister and the chip goes back to local", async ({
    page,
    cloud,
    lang,
  }) => {
    await seedState(page, editor, state(lang));
    await putOnCloud(page, cloud, lang);
    await page.getByTestId("workflow-cloud-unregister").click();
    await expect(page.getByTestId("workflow-cloud-result")).toHaveText(
      copy(lang, "workflows.cloud.intent.settled"),
    );
    await expect(chip(page)).toHaveAttribute("data-state", "local");
    await expect(chip(page)).toHaveText(copy(lang, "workflows.cloud.chip.local"));
    await expect(page.getByTestId("workflow-cloud-register")).toBeVisible();
    await sleep(500);
    expect(cloud.work.map((l) => l.kind)).toEqual(["register", "unregister"]);
    expect(cloud.of("unregister")[0]).toMatchObject({ method: "POST", status: 200 });
    // Durable: the local chip survives a reload with no further request.
    const before = cloud.log.length;
    await page.reload();
    await expect(chip(page)).toHaveAttribute("data-state", "local");
    await sleep(500);
    expect(cloud.log).toHaveLength(before);
  });
});
