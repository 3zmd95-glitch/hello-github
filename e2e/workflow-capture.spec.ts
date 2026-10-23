import { expect, test, type Page } from "@playwright/test";
import { seedState } from "./helpers";
import { parseAnswer, readyOccurrenceId, type CloudRequest } from "../lib/cloudWorkflowProtocol";
import {
  createIntent,
  emptyRegistrations,
  prepareIntent,
  recordOutcome,
  reserveAttempt,
  type CloudRegistrations,
} from "../lib/cloudWorkflowRegistration";
import {
  candidateEntry,
  emptyJournal,
  withEntry,
  type CloudJournal,
} from "../lib/cloudWorkflowJournal";
import { buildCloudSnapshot } from "../lib/cloudWorkflowSnapshot";
import { workflowDigestOf } from "../lib/cloudWorkflowCapture";

// ⚙️ DT-7C-2B-3-R1 (planning/tools/38-cloud-workflows.md): the exported app's legacy Run now / Mark ready ownership
// guard. A valid refused FIRST registration (nothing applied, no lifecycle) beside valid same-authority cloud journal
// history — two slices that each pass their own validators, as after separate imports — is not proof that the cloud
// lifecycle is inactive: both entry points refuse with the existing copy and nothing runs locally. Without any cloud
// evidence the ordinary local Manual and Ready paths still run once. Fixtures come from the accepted transitions and
// builders; state is seeded before the app hydrates; nothing leaves the device.

const KEY = "3z-prod-v1";
const AT = "2026-10-18T07:00:00.000Z";
const ORIGIN = "https://scout.example";
const OWNER = "wfo_" + "a".repeat(32);
const SHELL_FONTS = new Set(["fonts.googleapis.com", "fonts.gstatic.com"]);

const article = {
  id: "art-1",
  title: { ar: "تلوين الليل", en: "Night grading" },
  summary: { ar: "ملخص", en: "Summary" },
  body: { ar: "## مقدمة\n\nنص", en: "## Intro\n\nText" },
  slug: "night-grading",
  category: "",
  tags: [],
  coverUrl: "",
  status: "draft",
  revision: 1,
  commitId: "art-1-baseline",
  createdAt: AT,
  updatedAt: AT,
};
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
const ready = {
  ...manual,
  id: "wf-ready",
  name: { ar: "لما يجهز", en: "On ready" },
  trigger: { kind: "article-ready" as const },
  actions: [{ id: "i1", kind: "idea" as const, text: { ar: "اقرأ {title}", en: "Read {title}" } }],
  commitId: "wf-ready-baseline",
};

type Wf = typeof manual | typeof ready;

/** One valid refused first registration per workflow (409 capacity: nothing applied, `last` stays null). */
async function refusedFirst(prev: CloudRegistrations, w: Wf): Promise<CloudRegistrations> {
  const req: CloudRequest = {
    kind: "register",
    ownerKey: OWNER,
    workflowId: w.id,
    expectedEpoch: 0,
    revision: w.revision,
    workflowDigest: (await workflowDigestOf(w))!,
  };
  const p = prepareIntent(req, { origin: ORIGIN, ownerKey: OWNER });
  if (!p.ok) throw new Error(p.reason);
  const c = createIntent(prev, p, `op-${w.id}`, AT);
  if (!c.ok) throw new Error(c.reason);
  const i = c.next.records.find((r) => r.key === p.key)!.intent;
  const r = reserveAttempt(c.next, p.key, i);
  if (!r.ok) throw new Error(r.reason);
  const answer = { status: 409, body: { error: "capacity", ownerKey: OWNER } };
  const parsed = await parseAnswer(req, answer, { origin: ORIGIN });
  const out = recordOutcome(r.next, p.key, i.operationId, r.attempt, {
    kind: "answer",
    answer,
    parsed,
  });
  if (!out.changed) throw new Error(out.reason);
  return out.next;
}

/** One valid queued journal entry at the same authority, built and admitted by the accepted builder/journal. */
async function history(j: CloudJournal, w: Wf): Promise<CloudJournal> {
  const isReady = w.trigger.kind === "article-ready";
  const occurrenceId = isReady
    ? await readyOccurrenceId(w.id, article.id, article.commitId)
    : `m-${w.id}`;
  if (!occurrenceId) throw new Error("no Ready occurrence id");
  const built = await buildCloudSnapshot({
    ownerKey: OWNER,
    occurrenceId,
    registrationEpoch: 1,
    revision: w.revision,
    executionAt: AT,
    workflow: { id: w.id, name: w.name, trigger: w.trigger, actions: w.actions },
    lang: "en",
    ...(isReady
      ? {
          article: {
            id: article.id,
            title: article.title,
            summary: article.summary,
            slug: article.slug,
          },
        }
      : {}),
  });
  if (!built.ok) throw new Error(JSON.stringify(built));
  const c = await candidateEntry(ORIGIN, built.snapshot.body);
  if (!c.ok) throw new Error(JSON.stringify(c));
  return withEntry(
    j,
    { ...c.entry, commitId: `h-${w.id}`, state: "queued", observation: null },
    `h-${w.id}`,
  );
}

async function inconsistentEvidence() {
  const regs = await refusedFirst(await refusedFirst(emptyRegistrations(), manual), ready);
  const journal = await history(await history(emptyJournal(), manual), ready);
  return { cloudRegistrations: regs, cloudJournal: journal };
}

const lang = (name: string) => (name.startsWith("phone") ? "ar" : "en");
const state = (page: Page) =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).state, KEY);

const external: string[] = [];
test.beforeEach(async ({ context }) => {
  await context.route("**/*", (route) => {
    const u = new URL(route.request().url());
    if (u.hostname === "localhost") return route.continue();
    external.push(u.hostname);
    return route.abort();
  });
});
test.afterAll(() => {
  // Only the app shell's web fonts were even attempted (and aborted): no Worker, provider or other origin.
  expect(external.filter((h) => !SHELL_FONTS.has(h))).toEqual([]);
});

test("inconsistent cloud history: Run now refuses with the existing copy; no local run or output", async ({
  page,
}, info) => {
  const ar = lang(info.project.name) === "ar";
  const evidence = await inconsistentEvidence();
  await seedState(page, "/social/workflows/#w=wf-manual", {
    settings: { lang: lang(info.project.name), apiKeys: { scoutUrl: ORIGIN } },
    workflows: [manual, ready],
    articles: [article],
    workflowRuns: [],
    ideas: [],
    ...evidence,
  });
  await expect(page.getByTestId("workflow-editor")).toBeVisible();
  await page.getByTestId("workflows-run").click();
  const err = page.getByTestId("workflows-run-error");
  await expect(err).toBeVisible();
  await expect(err).toContainText(ar ? "ما راح تشتغل على هذا الجهاز" : "won't run on this device");
  await page.waitForTimeout(300);
  const st = await state(page);
  expect(st.workflowRuns ?? []).toEqual([]);
  expect(st.ideas ?? []).toEqual([]);
  expect(st.cloudJournal).toEqual(evidence.cloudJournal);
  await page.screenshot({ path: info.outputPath("run-now-refused.png") });
});

test("inconsistent cloud history: Mark ready refuses the whole transition; still a draft, nothing runs", async ({
  page,
}, info) => {
  const ar = lang(info.project.name) === "ar";
  const evidence = await inconsistentEvidence();
  await seedState(page, "/social/website/#a=art-1", {
    settings: { lang: lang(info.project.name), apiKeys: { scoutUrl: ORIGIN } },
    workflows: [manual, ready],
    articles: [article],
    workflowRuns: [],
    ideas: [],
    ...evidence,
  });
  await page.getByTestId("website-ready").click();
  const msg = page.getByTestId("website-ready-blocked");
  await expect(msg).toBeVisible();
  await expect(msg).toContainText(ar ? "ما تعلّمت جاهزة" : "Not marked ready");
  await page.waitForTimeout(300);
  const st = await state(page);
  expect(st.articles[0]).toMatchObject({ status: "draft", commitId: article.commitId });
  expect(st.workflowRuns ?? []).toEqual([]);
  expect(st.ideas ?? []).toEqual([]);
  await page.screenshot({ path: info.outputPath("ready-refused.png") });
});

test("no cloud evidence: ordinary local Run now runs once", async ({ page }, info) => {
  await seedState(page, "/social/workflows/#w=wf-manual", {
    settings: { lang: lang(info.project.name) },
    workflows: [manual],
    workflowRuns: [],
    ideas: [],
  });
  await page.getByTestId("workflows-run").click();
  await expect(page.getByTestId("workflows-run-row")).toHaveAttribute("data-status", "done");
  await expect(page.getByTestId("workflows-run-error")).toHaveCount(0);
  const st = await state(page);
  expect(st.workflowRuns.map((r: { status: string }) => r.status)).toEqual(["done"]);
  expect(st.ideas).toHaveLength(1);
});

test("no cloud evidence: ordinary local Mark ready commits the article and runs its workflow once", async ({
  page,
}, info) => {
  await seedState(page, "/social/website/#a=art-1", {
    settings: { lang: lang(info.project.name) },
    workflows: [ready],
    articles: [article],
    workflowRuns: [],
    ideas: [],
  });
  await page.getByTestId("website-ready").click();
  await expect.poll(async () => (await state(page)).articles[0].status).toBe("ready");
  await expect.poll(async () => (await state(page)).workflowRuns[0]?.status).toBe("done");
  await expect(page.getByTestId("website-ready-blocked")).toHaveCount(0);
  const st = await state(page);
  expect(st.workflowRuns).toHaveLength(1);
  expect(st.ideas).toHaveLength(1);
});
