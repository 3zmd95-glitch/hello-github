import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlanItem, Workflow, WorkflowAction, WorkflowInput } from "@/lib/domain";
import { dayKey, weekKey } from "@/lib/streak";
import { buildOutput, previewRun, type PlanContext } from "@/lib/workflows";
import {
  byteLength,
  BODY_BYTES_MAX,
  canonicalJson,
  CONTEXT_BYTES_MAX,
  checkBody,
  sha256Hex,
  type OccurrenceBody,
} from "@/workers/scout/src/social/workflowProtocol";
import { readyOccurrenceId } from "./cloudWorkflowProtocol";
import {
  buildCloudSnapshot,
  previewCloudRun,
  type CloudSnapshotParams,
} from "./cloudWorkflowSnapshot";

// ⚙️ DT-7C-1 immutable snapshot + cloud preflight (planning/tools/38-cloud-workflows.md). Pure: explicit minimal
// inputs, a caller-captured occurrence id / epoch / revision / executionAt, the REAL shared builders. Nothing here
// touches storage, the store or the network (fetch and Math.random are trapped in the preflight tests).

type A = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const OWNER = "wfo_0123456789abcdef0123456789abcdef";
const SKILL = "iphone-log-prores";
const AT = "2026-10-17T09:00:00.000Z"; // Saturday 12:00 Riyadh, first day of week 2026-10-17

afterEach(() => vi.unstubAllGlobals());

const t = (en: string, ar = "") => ({ ar, en });
const idea = (id: string, text = t("Idea: {title} ({date})", "فكرة: {title}")): WorkflowAction =>
  ({ id, kind: "idea", text }) as WorkflowAction;
const post = (id: string, offsetDays = 1): WorkflowAction =>
  ({
    id,
    kind: "post",
    platform: "tiktok",
    title: t("{title}", "{title} بالعربي"),
    caption: t("{summary} /{slug}", "{summary} — {slug}"),
    offsetDays,
  }) as WorkflowAction;
const plan = (id: string, o: A = {}): WorkflowAction =>
  ({
    id,
    kind: "plan",
    quest: "produce",
    minutes: 30,
    day: "lightest",
    skillId: SKILL,
    ...o,
  }) as WorkflowAction;

const article = (o: A = {}) => ({
  id: "art1",
  title: t("Log on iPhone", "تصوير لوق"),
  summary: t("Why log", "ليش لوق"),
  slug: "log-iphone",
  skillId: SKILL,
  ...o,
});
const planner = (o: A = {}) => ({
  completions: [] as A[],
  planItems: [] as A[],
  settings: { gear: ["phone"], davinciEdition: "free" } as A,
  contextAt: AT,
  ...o,
});

function params(actions: WorkflowAction[], o: A = {}): CloudSnapshotParams {
  const ready = o.ready ?? true;
  return {
    ownerKey: OWNER,
    occurrenceId: o.id ?? (ready ? "ar-o1" : "m1"),
    registrationEpoch: o.epoch ?? 1,
    revision: o.revision ?? 1,
    executionAt: o.at ?? AT,
    workflow: {
      id: o.workflowId ?? "w1",
      name: o.name ?? t("Flow", "سير"),
      trigger: { kind: ready ? "article-ready" : "manual" },
      actions,
    },
    lang: o.lang ?? "en",
    ...(ready ? { article: o.article ?? article() } : {}),
    ...(actions.some((a) => a.kind === "plan") || o.planner
      ? { planner: o.planner ?? planner() }
      : {}),
  } as unknown as CloudSnapshotParams;
}
async function built(p: CloudSnapshotParams) {
  const r = await buildCloudSnapshot(p);
  if (!r.ok) throw new Error(`refused: ${r.reason} ${r.detail ?? ""}`);
  return r.snapshot;
}
const refused = async (p: unknown, reason?: string) => {
  const r = await buildCloudSnapshot(p as CloudSnapshotParams);
  expect(r.ok).toBe(false);
  if (!r.ok && reason) expect(r.reason).toBe(reason);
  return r;
};

describe("snapshot: the same bytes and digests the Worker admits", () => {
  it("vector 1 (manual, one idea, no planner context): the published canonical string and digest", async () => {
    const s = await built(
      params(
        [{ id: "a1", kind: "idea", text: { ar: "", en: "Idea for {date}" } } as WorkflowAction],
        {
          ready: false,
          id: "m1",
          epoch: 1,
          revision: 3,
          name: t("Flow", "سير"),
          at: "2026-10-17T09:00:00.000Z",
        },
      ),
    );
    expect(canonicalJson(s.body)).toBe(
      '{"executionAt":"2026-10-17T09:00:00.000Z","input":{"day":"2026-10-17","lang":"en","slug":"","summary":{"ar":"","en":""},"title":{"ar":"","en":""}},"kind":"manual","occurrenceId":"m1","ownerKey":"wfo_0123456789abcdef0123456789abcdef","plannerContext":null,"registrationEpoch":1,"revision":3,"snapshot":{"actions":[{"id":"a1","kind":"idea","text":{"ar":"","en":"Idea for {date}"}}],"name":{"ar":"سير","en":"Flow"},"trigger":{"kind":"manual"}},"workflowId":"w1"}',
    );
    expect(s.payloadDigest).toBe(
      "7d59f9da6b98153f4fbc6b64d5012c30e961af6270c70e872963f92d57b88af1",
    );
    expect(s.payloadDigest).toBe(createHash("sha256").update(canonicalJson(s.body)).digest("hex"));
    expect(s.day).toBe("2026-10-17");
    expect(s.week).toBeNull();
    expect(s.bodyBytes).toBe(byteLength(canonicalJson(s.body)));
    expect(s.contextBytes).toBe(0);
  });

  it("vector 2 (article-ready, plan + post, planner context): the published digest", async () => {
    const s = await built(
      params(
        [
          {
            id: "p1",
            kind: "plan",
            quest: "produce",
            minutes: 30,
            day: "lightest",
          } as WorkflowAction,
          {
            id: "s1",
            kind: "post",
            platform: "tiktok",
            title: { ar: "", en: "{title}" },
            caption: { ar: "", en: "{summary}" },
            offsetDays: 1,
          } as WorkflowAction,
        ],
        {
          id: "ar-x1",
          workflowId: "w2",
          epoch: 2,
          revision: 5,
          name: t("Ready", "جاهز"),
          article: {
            id: "art1",
            title: t("Log on iPhone"),
            summary: t("Why log"),
            slug: "log-iphone",
            skillId: SKILL,
          },
          planner: planner({
            completions: [{ skillId: SKILL, quest: "train", at: "2026-10-10T08:00:00.000Z" }],
            planItems: [
              {
                id: "pi1",
                week: "2026-10-17",
                day: 2,
                skillId: SKILL,
                quest: "produce",
                minutes: 0,
                by: "me",
              },
            ],
          }),
        },
      ),
    );
    expect(s.payloadDigest).toBe(
      "a5eb743dcb9dbcb44f848cd7a8b9694be74fc5e8b5a54dd1002e396d869e242b",
    );
    expect(s.week).toBe("2026-10-17");
    expect(s.contextBytes).toBe(byteLength(canonicalJson(s.body.plannerContext)));
  });

  it("every built body passes the Worker's own admission check at its own executionAt", async () => {
    const s = await built(params([idea("a1"), plan("p1"), post("s1")]));
    expect(checkBody(s.body, Date.parse(AT))).toMatchObject({ ok: true });
    expect(s.payloadDigest).toBe(await sha256Hex(canonicalJson(s.body)));
  });

  it("Unicode (Arabic, emoji, combining marks) survives byte-for-byte; sizes count UTF-8 bytes", async () => {
    const txt = t("é 😀 {title}", "مرحبا بالعالم ✓ {title}");
    const s = await built(
      params([idea("a1", txt)], {
        article: article({ title: t("عنوان 🎬", "تصوير لوق 🎬") }),
      }),
    );
    expect((s.body.snapshot.actions[0] as A).text).toEqual(txt);
    expect(s.body.input.title).toEqual(t("عنوان 🎬", "تصوير لوق 🎬"));
    expect(s.bodyBytes).toBeGreaterThan(canonicalJson(s.body).length);
    expect(s.payloadDigest).toBe(
      createHash("sha256").update(canonicalJson(s.body), "utf8").digest("hex"),
    );
    // A lone surrogate is not text the Worker admits: refused, not replaced.
    await refused(params([idea("a1", t("bad \ud800 end"))]), "invalid");
  });

  it("Ready id from the protocol module is accepted as the occurrence id; a manual body refuses ar-/sc-", async () => {
    const id = (await readyOccurrenceId("w1", "art1", "commit-1"))!;
    const s = await built(params([idea("a1")], { id }));
    expect(s.body.occurrenceId).toBe(id);
    await refused(params([idea("a1")], { ready: false, id: "ar-manual" }), "unsupported_id");
    await refused(params([idea("a1")], { ready: false, id: "sc-1" }), "unsupported_id");
    await refused(params([idea("a1")], { id: "m1" }), "unsupported_id"); // article-ready needs ar-
  });
});

describe("Riyadh day and week from the captured instant", () => {
  it.each([
    ["Friday 23:59:59.999 Riyadh", "2026-10-16T20:59:59.999Z", "2026-10-16", "2026-10-10"],
    ["Saturday 00:00:00.000 Riyadh", "2026-10-16T21:00:00.000Z", "2026-10-17", "2026-10-17"],
    ["Saturday 23:59:59.999 Riyadh", "2026-10-17T20:59:59.999Z", "2026-10-17", "2026-10-17"],
    ["Sunday 00:00 Riyadh", "2026-10-17T21:00:00.000Z", "2026-10-18", "2026-10-17"],
    ["New year rollover", "2026-12-31T21:00:00.000Z", "2027-01-01", "2026-12-26"],
  ])("%s", async (_n, at, day, week) => {
    const s = await built(
      params([idea("a1"), plan("p1")], { at, planner: planner({ contextAt: at }) }),
    );
    expect(s.day).toBe(day);
    expect(s.body.input.day).toBe(day);
    expect(s.week).toBe(week);
    expect(s.body.plannerContext!.targetWeek).toBe(week);
    // The dashboard's own day/week functions agree.
    expect(dayKey(new Date(at))).toBe(day);
    expect(weekKey(day)).toBe(week);
  });

  it("a Date executionAt is the same instant as its ISO string", async () => {
    const a = await built(params([idea("a1")], { at: new Date(AT) }));
    const b = await built(params([idea("a1")], { at: AT }));
    expect(a.payloadDigest).toBe(b.payloadDigest);
  });
});

describe("planner context: only the allowlisted slice", () => {
  const completions = (): A[] => [
    // Pre-target-week (week starts 2026-10-17): kept, projected to {skillId, quest, at}.
    {
      skillId: SKILL,
      quest: "train",
      at: "2026-10-16T23:59:59+03:00",
      proofUrl: "https://PRIVATE-PROOF.example/x",
      note: "PRIVATE-NOTE",
    },
    { skillId: SKILL, quest: "produce", at: "2026-10-10T08:00:00.000Z" },
    // Inside the target week (Riyadh day >= 2026-10-17): not part of the context.
    {
      skillId: SKILL,
      quest: "research",
      at: "2026-10-17T00:00:00+03:00",
      proofUrl: "https://PRIVATE-PROOF.example/y",
    },
    { skillId: SKILL, quest: "article", at: "2026-10-17T05:00:00.000Z" },
  ];
  const items = (): A[] => [
    {
      id: "pi1",
      week: "2026-10-17",
      day: 2,
      skillId: SKILL,
      quest: "produce",
      minutes: 0,
      by: "me",
      secret: "PRIVATE-ROW",
    },
    {
      id: "pi2",
      week: "2026-10-17",
      day: 4,
      skillId: SKILL,
      quest: "train",
      minutes: 45,
      by: "rules",
    },
    // Another week: not part of the context.
    {
      id: "old",
      week: "2026-10-10",
      day: 1,
      skillId: SKILL,
      quest: "train",
      minutes: 20,
      by: "me",
    },
  ];

  it("projects completions and plan rows; zero-minute tombstones stay; nothing else is carried", async () => {
    const s = await built(
      params([plan("p1")], {
        planner: {
          ...planner({
            completions: completions(),
            planItems: items(),
            settings: {
              gear: ["phone", "lights"],
              davinciEdition: "studio",
              discover: { editorScope: "mine" },
              inbox: "PRIVATE-INBOX",
              apiToken: "PRIVATE-TOKEN",
            },
          }),
          // Whole-state canaries a careless caller might pass along.
          articles: [{ body: "PRIVATE-ARTICLE-BODY" }],
          inbox: [{ text: "PRIVATE-DM" }],
        },
      }),
    );
    const pc = s.body.plannerContext!;
    expect(Object.keys(pc).sort()).toEqual([
      "completions",
      "contextAt",
      "planItems",
      "settings",
      "targetWeek",
    ]);
    expect(pc.completions).toEqual([
      { skillId: SKILL, quest: "train", at: "2026-10-16T20:59:59.000Z" },
      { skillId: SKILL, quest: "produce", at: "2026-10-10T08:00:00.000Z" },
    ]);
    expect(pc.planItems).toEqual([
      {
        id: "pi1",
        week: "2026-10-17",
        day: 2,
        skillId: SKILL,
        quest: "produce",
        minutes: 0,
        by: "me",
      },
      {
        id: "pi2",
        week: "2026-10-17",
        day: 4,
        skillId: SKILL,
        quest: "train",
        minutes: 45,
        by: "rules",
      },
    ]);
    expect(pc.settings).toEqual({ gear: ["phone", "lights"], davinciEdition: "studio" });
    expect(pc.contextAt).toBe(AT);
    const text = JSON.stringify(s.body);
    for (const canary of ["PRIVATE", "proofUrl", "apiToken", "inbox", "articles", "discover"])
      expect(text).not.toContain(canary);
  });

  it("a body without a plan step carries no context at all, even when a planner is handed in", async () => {
    const s = await built(
      params([idea("a1"), post("s1")], { planner: planner({ completions: completions() }) }),
    );
    expect(s.body.plannerContext).toBeNull();
    expect(s.contextBytes).toBe(0);
    expect(JSON.stringify(s.body)).not.toContain("PRIVATE");
  });

  it("a plan step without planner data is refused (never an empty guess)", async () => {
    const p = params([plan("p1")]);
    delete (p as A).planner;
    await refused(p, "planner_required");
  });

  it("manual bodies capture no article; a Ready body needs one", async () => {
    const m = await built(params([idea("a1")], { ready: false }));
    expect(m.body.input).toEqual({
      title: t(""),
      summary: t(""),
      slug: "",
      lang: "en",
      day: "2026-10-17",
    });
    expect(m.body.kind).toBe("manual");
    await refused(
      { ...params([idea("a1")], { ready: false }), article: article() },
      "article_mismatch",
    );
    const noArticle = params([idea("a1")]);
    delete (noArticle as A).article;
    await refused(noArticle, "article_mismatch");
  });
});

describe("source-object mutation isolation", () => {
  it("later changes to the caller's objects never reach the body; the body is frozen", async () => {
    const actions = [idea("a1"), plan("p1"), post("s1")];
    const art = article();
    const pl = planner({
      completions: [{ skillId: SKILL, quest: "train", at: "2026-10-10T08:00:00.000Z" }],
      planItems: [
        {
          id: "pi1",
          week: "2026-10-17",
          day: 2,
          skillId: SKILL,
          quest: "produce",
          minutes: 0,
          by: "me",
        },
      ],
    });
    const p = params(actions, { article: art, planner: pl });
    const s = await built(p);
    const before = canonicalJson(s.body);
    (actions[0] as A).text.en = "mutated";
    actions[1].id = "p9";
    actions.push(idea("a9"));
    art.title.en = "mutated";
    art.slug = "mutated";
    pl.completions[0].quest = "article";
    pl.planItems.push({ id: "zz" });
    pl.settings.gear.push("camera");
    (p.workflow as A).name.en = "mutated";
    expect(canonicalJson(s.body)).toBe(before);
    // The returned body is deeply frozen.
    expect(Object.isFrozen(s.body)).toBe(true);
    expect(Object.isFrozen(s.body.snapshot.actions[0])).toBe(true);
    expect(Object.isFrozen(s.body.plannerContext!.planItems[0])).toBe(true);
    expect(() => {
      (s.body.plannerContext!.settings.gear as string[]).push("camera");
    }).toThrow(TypeError);
    expect(() => {
      (s.body as A).revision = 9;
    }).toThrow(TypeError);
  });

  it("non-allowlisted workflow fields (enabled, commitId, timestamps) are dropped, not forwarded", async () => {
    const p = params([idea("a1")]);
    (p.workflow as A).enabled = true;
    (p.workflow as A).commitId = "PRIVATE-COMMIT";
    (p.workflow as A).createdAt = "x";
    (p.workflow.actions[0] as A).note = "PRIVATE-NOTE";
    const s = await built(p);
    expect(Object.keys(s.body.snapshot).sort()).toEqual(["actions", "name", "trigger"]);
    expect(Object.keys(s.body.snapshot.actions[0]).sort()).toEqual(["id", "kind", "text"]);
    expect(JSON.stringify(s.body)).not.toContain("PRIVATE");
  });
});

describe("refusals: unsupported ids, chronology, counts - never truncated, never renamed", () => {
  it.each([
    ["occurrence id with a colon", params([idea("a1")], { id: "ar-m:1" }), "unsupported_id"],
    [
      "occurrence id too long",
      params([idea("a1")], { id: "ar-" + "x".repeat(62) }),
      "unsupported_id",
    ],
    ["workflow id with a colon", params([idea("a1")], { workflowId: "w:1" }), "unsupported_id"],
    ["action id with a colon", params([idea("a:1")]), "unsupported_id"],
    [
      "article id with a space",
      params([idea("a1")], { article: article({ id: "a b" }) }),
      "unsupported_id",
    ],
    ["no actions", params([]), "invalid"],
    ["six actions", params(["1", "2", "3", "4", "5", "6"].map((n) => idea(`a${n}`))), "invalid"],
    ["duplicate action ids", params([idea("a1"), idea("a1")]), "invalid"],
    [
      "unknown action kind",
      params([{ id: "a1", kind: "publish" } as unknown as WorkflowAction]),
      "invalid",
    ],
    ["template over 500", params([idea("a1", t("x".repeat(501)))]), "invalid"],
    ["unsupported lang", params([idea("a1")], { lang: "fr" }), "invalid"],
    ["name over 80", params([idea("a1")], { name: t("x".repeat(81)) }), "invalid"],
    ["bad skill id", params([plan("p1", { skillId: "Not A Slug" })]), "invalid"],
    [
      "article title over 2000",
      params([idea("a1")], { article: article({ title: t("x".repeat(2001)) }) }),
      "invalid",
    ],
    ["bad ownerKey", { ...params([idea("a1")]), ownerKey: "wfo_x" }, "invalid"],
    ["epoch 0", params([idea("a1")], { epoch: 0 }), "invalid"],
    ["revision 1.5", params([idea("a1")], { revision: 1.5 }), "invalid"],
    ["null params", null, "invalid"],
  ])("%s", async (_n, p, reason) => {
    await refused(p, reason as string);
  });

  it.each([
    ["executionAt not an instant", { at: "yesterday" }],
    ["executionAt not canonical", { at: "2026-10-17T09:00:00Z" }],
    ["executionAt invalid Date", { at: new Date(Number.NaN) }],
    ["executionAt before 2020", { at: "2019-12-31T23:59:59.999Z" }],
    ["executionAt a number", { at: 1760691600000 }],
  ])("chronology: %s", async (_n, o) => {
    await refused(params([idea("a1")], o), "chronology");
  });

  it("chronology: contextAt after executionAt, not an instant, or a completion with no instant", async () => {
    await refused(
      params([plan("p1")], { planner: planner({ contextAt: "2026-10-17T09:00:00.001Z" }) }),
      "chronology",
    );
    await refused(params([plan("p1")], { planner: planner({ contextAt: "noon" }) }), "chronology");
    await refused(
      params([plan("p1")], {
        planner: planner({ completions: [{ skillId: SKILL, quest: "train", at: "last week" }] }),
      }),
      "chronology",
    );
    // Equal is allowed.
    await built(params([plan("p1")], { planner: planner({ contextAt: AT }) }));
  });

  it("counts: over 200 pre-week completions or 100 target-week rows are refused, never truncated", async () => {
    const comp = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        skillId: SKILL,
        quest: "train",
        at: new Date(Date.parse("2026-09-01T00:00:00.000Z") + i * 3_600_000).toISOString(),
      }));
    const row = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        id: `r${i}`,
        week: "2026-10-17",
        day: i % 7,
        skillId: SKILL,
        quest: "train",
        minutes: 0,
        by: "me",
      }));
    // Within the caps and the 8 KiB context bound.
    const some = await built(
      params([plan("p1")], { planner: planner({ completions: comp(50), planItems: row(20) }) }),
    );
    expect(some.body.plannerContext!.completions).toHaveLength(50);
    expect(some.body.plannerContext!.planItems).toHaveLength(20);
    // The count caps (200 / 100) are reported as such; 8 KiB binds earlier for full-size entries (too_large).
    await refused(
      params([plan("p1")], { planner: planner({ completions: comp(201) }) }),
      "count_exceeded",
    );
    await refused(
      params([plan("p1")], { planner: planner({ planItems: row(101) }) }),
      "count_exceeded",
    );
    await refused(
      params([plan("p1")], { planner: planner({ completions: comp(200) }) }),
      "too_large",
    );
    await refused(params([plan("p1")], { planner: planner({ planItems: row(100) }) }), "too_large");
    // Completions of the target week are filtered, so they never count against the cap.
    const inWeek = Array.from({ length: 300 }, () => ({
      skillId: SKILL,
      quest: "train",
      at: "2026-10-18T00:00:00.000Z",
    }));
    const filtered = await built(
      params([plan("p1")], { planner: planner({ completions: inWeek }) }),
    );
    expect(filtered.body.plannerContext!.completions).toEqual([]);
    // The Worker's earliest instant is accepted, one millisecond earlier is not.
    await built(params([idea("a1")], { at: "2020-01-01T00:00:00.000Z" }));
  });
});

describe("size boundaries: 16 KiB body, 8 KiB planner context", () => {
  const slots = (p: CloudSnapshotParams) => {
    const a = p.article as A;
    const acts = p.workflow.actions as unknown as A[];
    return [
      ...acts.flatMap((x) => [(n: string) => (x.text.ar = n), (n: string) => (x.text.en = n)]),
      (n: string) => (a.title.ar = n),
      (n: string) => (a.title.en = n),
      (n: string) => (a.summary.ar = n),
      (n: string) => (a.summary.en = n),
    ];
  };
  /** A Ready body whose canonical JSON is exactly `target` UTF-8 bytes (Arabic letters are 2 bytes each). */
  async function bodyOfBytes(target: number) {
    const mk = () =>
      params(
        ["1", "2", "3", "4", "5"].map((n) => idea(`a${n}`, t("", ""))),
        { article: article({ title: t(""), summary: t(""), skillId: undefined }) },
      );
    const base = await built(mk());
    let need = target - base.bodyBytes;
    const p = mk();
    const caps = slots(p).map((set, i) => ({ set, cap: i < 10 ? 500 : 2000 }));
    for (const { set, cap } of caps) {
      const chars = Math.min(cap, Math.floor(need / 2));
      set("ب".repeat(chars));
      need -= chars * 2;
    }
    if (need > 0) (p.article as A).slug += "a".repeat(need);
    return p;
  }

  it("exactly 16,384 bytes passes; 16,385 is too_large (never truncated)", async () => {
    const at = await built(await bodyOfBytes(BODY_BYTES_MAX));
    expect(at.bodyBytes).toBe(BODY_BYTES_MAX);
    expect(checkBody(at.body, Date.parse(AT))).toMatchObject({ ok: true });
    const over = await bodyOfBytes(BODY_BYTES_MAX + 1);
    const r = await refused(over, "too_large");
    expect(r).toMatchObject({ ok: false, reason: "too_large" });
    // One byte under also passes.
    expect((await built(await bodyOfBytes(BODY_BYTES_MAX - 1))).bodyBytes).toBe(BODY_BYTES_MAX - 1);
  });

  const rows40 = () =>
    Array.from({ length: 40 }, (_, i) => ({
      id: `r${String(i).padStart(2, "0")}`,
      week: "2026-10-17",
      day: i % 7,
      skillId: SKILL,
      quest: "train",
      minutes: 0,
      by: "me",
    }));
  /** A planner whose canonical context is exactly `target` bytes: 40 plan rows with padded ids (ids up to 140). */
  function plannerOfBytes(target: number, base: number) {
    const rows = rows40();
    let need = target - base;
    for (const r of rows) {
      const add = Math.min(140 - r.id.length, need);
      r.id += "x".repeat(add);
      need -= add;
    }
    expect(need).toBe(0);
    return planner({ planItems: rows });
  }

  it("exactly 8,192 context bytes pass; 8,193 are too_large", async () => {
    const base = await built(params([plan("p1")], { planner: planner({ planItems: rows40() }) }));
    const at = await built(
      params([plan("p1")], { planner: plannerOfBytes(CONTEXT_BYTES_MAX, base.contextBytes) }),
    );
    expect(at.contextBytes).toBe(CONTEXT_BYTES_MAX);
    expect(at.bodyBytes).toBeLessThanOrEqual(BODY_BYTES_MAX);
    await refused(
      params([plan("p1")], { planner: plannerOfBytes(CONTEXT_BYTES_MAX + 1, base.contextBytes) }),
      "too_large",
    );
  });
});

/* ---------- cloud preflight ---------- */

const planCtx = (b: OccurrenceBody): PlanContext => ({
  completions: (b.plannerContext?.completions ?? []) as never,
  planItems: (b.plannerContext?.planItems ?? []) as never,
  settings: (b.plannerContext?.settings ?? { gear: [], davinciEdition: "free" }) as never,
});
/** Independent oracle: the REAL buildOutput folded in action order with the actual occurrence id. */
function oracle(b: OccurrenceBody) {
  const ctx = planCtx(b);
  let planItems = [...ctx.planItems];
  const out: A[] = [];
  for (const action of b.snapshot.actions) {
    const r = buildOutput(
      b.occurrenceId,
      action as unknown as WorkflowAction,
      b.input as unknown as WorkflowInput,
      { ...ctx, planItems },
      new Date(b.executionAt),
    );
    if (!r.ok) {
      out.push({ actionId: action.id, error: r.error });
      break;
    }
    if (r.kind === "plan") planItems = [...planItems, r.record as PlanItem];
    out.push({ actionId: action.id, record: JSON.parse(canonicalJson(r.record)) });
  }
  return out;
}

describe("cloud preflight: real buildOutput with the actual occurrence id and executionAt", () => {
  const rows = (n: number, day = 0): A[] =>
    Array.from({ length: n }, (_, i) => ({
      id: `pi${i}`,
      week: "2026-10-17",
      day,
      skillId: SKILL,
      quest: "train",
      minutes: 60,
      by: "me",
    }));

  it("idea, post and several ordered plan steps: records and digests equal the real builders' (earlier plans folded)", async () => {
    const s = await built(
      params(
        [
          idea("a1"),
          plan("p1"),
          plan("p2"),
          post("s1"),
          plan("p3", { quest: "train", minutes: 90 }),
        ],
        {
          id: "ar-parity1",
          planner: planner({
            // Days 0-3 loaded so "lightest" must move as the folded outputs land.
            planItems: [...rows(2, 0), ...rows(1, 1), ...rows(1, 2), ...rows(2, 3)].map((r, i) => ({
              ...r,
              id: `pi${i}`,
            })),
          }),
        },
      ),
    );
    const r = await previewCloudRun(s.body);
    if (!r.ok) throw new Error(r.reason);
    const want = oracle(s.body);
    expect(r.preview.outcome).toBe("done");
    expect(r.preview.built).toBe(5);
    expect(r.preview.steps.map((x) => (x.status === "built" ? x.record : null))).toEqual(
      want.map((w) => w.record),
    );
    for (const step of r.preview.steps) {
      if (step.status !== "built") throw new Error("unexpected");
      expect(step.outputId).toBe(`wf:ar-parity1:${step.actionId}`);
      expect(step.record.id).toBe(step.outputId);
      expect(step.digest).toBe(await sha256Hex(canonicalJson(step.record)));
      // No preview id ever appears, renamed or not.
      expect(JSON.stringify(step.record)).not.toContain("preview");
    }
    // Folding mattered: the three plan rows did not all land on one day.
    const days = r.preview.steps
      .filter((x) => x.kind === "plan")
      .map((x) => (x.status === "built" ? x.record.day : -1));
    expect(new Set(days).size).toBeGreaterThan(1);
    // The dashboard's previewRun (the local dry run) gives the same records once its fixed "preview" id is mapped.
    const local = previewRun(
      { ...s.body.snapshot } as unknown as Workflow,
      s.body.input as unknown as WorkflowInput,
      planCtx(s.body),
      new Date(s.body.executionAt),
    );
    const mapped = local.outputs.map((o) =>
      "record" in o
        ? JSON.parse(JSON.stringify(o.record).replaceAll("wf:preview:", "wf:ar-parity1:"))
        : null,
    );
    expect(mapped).toEqual(want.map((w) => w.record));
  });

  it("Riyadh rollover is the captured instant's: the same occurrence built at 20:59:59.999Z vs 21:00Z", async () => {
    for (const [at, day, week] of [
      ["2026-10-16T20:59:59.999Z", "2026-10-16", "2026-10-10"],
      ["2026-10-16T21:00:00.000Z", "2026-10-17", "2026-10-17"],
    ]) {
      const s = await built(
        params([idea("a1"), plan("p1", { day: 1 }), post("s1", 2)], {
          at,
          planner: planner({ contextAt: at }),
        }),
      );
      const r = await previewCloudRun(s.body);
      if (!r.ok) throw new Error(r.reason);
      const recs = r.preview.steps.map((x) => (x.status === "built" ? x.record : {}));
      expect((recs[0] as A).createdAt).toBe(at);
      expect((recs[1] as A).week).toBe(week);
      expect((recs[2] as A).plannedDay).toBe(dayAfter(day, 2));
    }
  });

  it("fail-fast: the successful prefix is kept and the suffix skipped (partial), a first failure is `failed`", async () => {
    const mid = await built(
      params([idea("a1"), plan("p1", { skillId: "no-such-skill" }), post("s1")]),
    );
    const r = await previewCloudRun(mid.body);
    if (!r.ok) throw new Error(r.reason);
    expect(r.preview.outcome).toBe("partial");
    expect(r.preview.steps.map((x) => x.status)).toEqual(["built", "failed", "skipped"]);
    expect(r.preview.steps[1]).toMatchObject({ status: "failed", error: "unknown-skill" });
    expect(r.preview.steps[2]).toMatchObject({ status: "skipped", actionId: "s1", kind: "post" });
    expect(r.preview.built).toBe(1);

    const first = await built(
      params([plan("p1", { skillId: undefined }), idea("a1")], {
        ready: false,
        id: "m1",
        article: undefined,
        planner: planner(),
      }),
    );
    const f = await previewCloudRun(first.body);
    if (!f.ok) throw new Error(f.reason);
    expect(f.preview.outcome).toBe("failed");
    expect(f.preview.steps.map((x) => x.status)).toEqual(["failed", "skipped"]);
    expect(f.preview.steps[0]).toMatchObject({ error: "no-skill" });
    const empty = await built(params([idea("a1", t("", "")), idea("a2")]));
    const e = await previewCloudRun(empty.body);
    expect(e.ok && e.preview.steps[0]).toMatchObject({ status: "failed", error: "empty-text" });
  });

  it("the 4,000-unit output bound: exactly 4,000 passes; 4,001 is an explicit cloud limitation with prefix and suffix kept", async () => {
    const big = (extra: string) => t(`{title}{title}${extra}`);
    const mk = (extra: string, title = "x".repeat(2000)) =>
      params([idea("a1"), idea("a2", big(extra)), post("s1")], {
        article: article({ title: t(title) }),
      });
    const exact = await built(mk(""));
    const ok4000 = await previewCloudRun(exact.body);
    if (!ok4000.ok) throw new Error(ok4000.reason);
    expect(ok4000.preview.outcome).toBe("done");
    expect(((ok4000.preview.steps[1] as A).record.text as string).length).toBe(4000);

    const over = await built(mk("y"));
    const r = await previewCloudRun(over.body);
    if (!r.ok) throw new Error(r.reason);
    expect(r.preview.outcome).toBe("partial");
    expect(r.preview.limitation).toBe("output-too-large");
    expect(r.preview.steps.map((x) => x.status)).toEqual(["built", "failed", "skipped"]);
    expect(r.preview.steps[1]).toMatchObject({ error: "invalid", limitation: "output-too-large" });
    expect(r.preview.built).toBe(1);
    // The LOCAL builder happily makes the 4,001-unit text: this is a documented cloud divergence, never widened.
    const local = buildOutput(
      "ar-o1",
      over.body.snapshot.actions[1] as unknown as WorkflowAction,
      over.body.input as unknown as WorkflowInput,
      planCtx(over.body),
      new Date(AT),
    );
    expect(local.ok && (local.record as A).text.length).toBe(4001);

    // UTF-16 code units, like the Worker's bound: 1,000 emoji x 2 units x 2 = 4,000 passes; one more unit fails.
    const emoji = "😀".repeat(1000);
    const e4000 = await previewCloudRun((await built(mk("", emoji))).body);
    expect(e4000.ok && e4000.preview.outcome).toBe("done");
    const e4001 = await previewCloudRun((await built(mk("z", emoji))).body);
    expect(e4001.ok && e4001.preview.limitation).toBe("output-too-large");
    // A post title or caption over the bound is the same limitation.
    const postBig = params(
      [
        {
          id: "s1",
          kind: "post",
          platform: "tiktok",
          title: t("{title}{title}q"),
          caption: t(""),
          offsetDays: 1,
        } as WorkflowAction,
      ],
      { article: article({ title: t("x".repeat(2000)) }) },
    );
    const pb = await previewCloudRun((await built(postBig)).body);
    expect(pb.ok && pb.preview.steps[0]).toMatchObject({
      status: "failed",
      limitation: "output-too-large",
    });
  });

  it("pure: no fetch, no random id, no mutation; the preview is frozen and repeatable", async () => {
    const f = vi.fn(() => {
      throw new Error("network is forbidden");
    });
    vi.stubGlobal("fetch", f);
    const rnd = vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("random is forbidden");
    });
    try {
      const s = await built(params([idea("a1"), plan("p1"), post("s1")]));
      const before = canonicalJson(s.body);
      const a = await previewCloudRun(s.body);
      const b = await previewCloudRun(s.body);
      if (!a.ok || !b.ok) throw new Error("setup");
      expect(JSON.stringify(a.preview)).toBe(JSON.stringify(b.preview));
      expect(canonicalJson(s.body)).toBe(before);
      expect(Object.isFrozen(a.preview)).toBe(true);
      expect(Object.isFrozen(a.preview.steps[0])).toBe(true);
      expect(f).not.toHaveBeenCalled();
      expect(rnd).not.toHaveBeenCalled();
    } finally {
      rnd.mockRestore();
    }
  });

  it("refuses a body the Worker would not admit (it never previews a different thing)", async () => {
    const s = await built(params([idea("a1")]));
    const bad = JSON.parse(JSON.stringify(s.body)) as A;
    bad.extra = 1;
    expect(await previewCloudRun(bad as never)).toEqual({ ok: false, reason: "invalid" });
    const bad2 = JSON.parse(JSON.stringify(s.body)) as A;
    bad2.input.day = "2026-10-18";
    expect(await previewCloudRun(bad2 as never)).toEqual({ ok: false, reason: "invalid" });
    expect(await previewCloudRun(null as never)).toEqual({ ok: false, reason: "invalid" });
  });
});

function dayAfter(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

describe("DT-7C-1-R1: preflight validates and builds from one detached copy of the body", () => {
  // The FIRST output digest is held; the caller edits its (ordinary, unfrozen, JSON-restored) body meanwhile.
  const gates: (() => void)[] = [];
  const holdFirstDigest = () => {
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const at = new Promise<void>((r) => (entered = r));
    const real = crypto.subtle.digest.bind(crypto.subtle);
    let n = 0;
    const spy = vi.spyOn(crypto.subtle, "digest").mockImplementation(async (...args) => {
      if (n++ === 0) {
        entered();
        await gate;
      }
      return real(...args);
    });
    gates.push(release);
    return { at, release, spy };
  };
  afterEach(() => {
    for (const release of gates.splice(0)) release();
    vi.restoreAllMocks();
  });

  const restored = (b: unknown) => JSON.parse(JSON.stringify(b)) as A;
  const bodyWithPlans = async () => {
    const s = await built(
      params([idea("a1"), idea("a2", t("SECOND {date}")), plan("p1"), plan("p2"), post("s1")], {
        id: "ar-held1",
        planner: planner({
          planItems: [
            {
              id: "pi1",
              week: "2026-10-17",
              day: 0,
              skillId: SKILL,
              quest: "train",
              minutes: 60,
              by: "me",
            },
          ],
        }),
      }),
    );
    return restored(s.body);
  };

  it("later template, executionAt/day, planner context and action edits do not reach the result", async () => {
    const body = await bodyWithPlans();
    const want = await previewCloudRun(restored(body) as never);
    expect(want.ok).toBe(true);
    const h = holdFirstDigest();
    const pending = previewCloudRun(body as never);
    await h.at;
    body.snapshot.actions[1].text.en = "MUTATED_SECOND";
    body.snapshot.actions[2].minutes = 5;
    body.snapshot.actions.reverse();
    body.executionAt = "2026-10-18T09:00:00.000Z";
    body.input.day = "2026-10-18";
    body.occurrenceId = "ar-other";
    body.plannerContext.planItems.push({
      id: "late",
      week: "2026-10-17",
      day: 0,
      skillId: SKILL,
      quest: "train",
      minutes: 600,
      by: "me",
    });
    body.plannerContext.planItems[0].minutes = 0;
    body.plannerContext.completions.push({ skillId: SKILL, quest: "train", at: AT });
    body.plannerContext.settings.gear.push("camera");
    h.release();
    const got = await pending;
    expect(got).toEqual(want);
    expect(JSON.stringify(got)).toBe(JSON.stringify(want));
    expect(JSON.stringify(got)).not.toContain("MUTATED_SECOND");
    expect(JSON.stringify(got)).not.toContain("ar-other");
  });

  it("actions appended after validation cannot bypass the five-action bound", async () => {
    const s = await built(params([idea("a1"), idea("a2")]));
    const body = restored(s.body);
    const want = await previewCloudRun(restored(body) as never);
    const h = holdFirstDigest();
    const pending = previewCloudRun(body as never);
    await h.at;
    body.snapshot.actions.push(idea("l1"), idea("l2"), idea("l3"), idea("l4"));
    expect(body.snapshot.actions).toHaveLength(6);
    expect(checkBody(body as never, Date.parse(AT)).ok).toBe(false);
    h.release();
    const got = await pending;
    expect(got).toEqual(want);
    if (!got.ok) throw new Error("setup");
    expect(got.preview.steps.map((x) => x.actionId)).toEqual(["a1", "a2"]);
    expect(got.preview.built).toBe(2);
  });

  it("a body edited into something invalid during the hold still previews the captured, valid one", async () => {
    const s = await built(params([idea("a1"), idea("a2")]));
    const body = restored(s.body);
    const want = await previewCloudRun(restored(body) as never);
    const h = holdFirstDigest();
    const pending = previewCloudRun(body as never);
    await h.at;
    body.executionAt = "not-a-date";
    delete body.snapshot;
    h.release();
    expect(await pending).toEqual(want);
  });

  it("the caller's object is neither frozen nor changed by preflight", async () => {
    const body = await bodyWithPlans();
    const before = canonicalJson(body);
    const got = await previewCloudRun(body as never);
    expect(got.ok).toBe(true);
    expect(canonicalJson(body)).toBe(before);
    expect(Object.isFrozen(body)).toBe(false);
    expect(Object.isFrozen(body.snapshot.actions)).toBe(false);
    expect(Object.isFrozen(body.plannerContext.planItems)).toBe(false);
    body.snapshot.actions[0].text.en = "still writable";
    expect(body.snapshot.actions[0].text.en).toBe("still writable");
  });

  it("control: a frozen snapshot body rejects edits during the hold and previews unchanged", async () => {
    const s = await built(params([idea("a1"), idea("a2", t("SECOND {date}"))]));
    const want = await previewCloudRun(s.body);
    const h = holdFirstDigest();
    const pending = previewCloudRun(s.body);
    await h.at;
    expect(() => {
      (s.body as A).snapshot.actions[1].text.en = "MUTATED";
    }).toThrow(TypeError);
    h.release();
    expect(await pending).toEqual(want);
  });

  it("the digest spy is restored and no gate is left held after each test", () => {
    expect(vi.isMockFunction(crypto.subtle.digest)).toBe(false);
  });
});
