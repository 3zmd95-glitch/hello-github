import { describe, expect, it } from "vitest";
import {
  BODY_BYTES_MAX,
  canonicalJson,
  checkBody,
  CONTEXT_BYTES_MAX,
  payloadDigestOf,
  sha256Hex,
  validDraft,
  validOutput,
  weekOf,
  type OccurrenceBody,
} from "./workflowProtocol";

// ⚙️ DT-7B protocol (planning/tools/38-cloud-workflows.md): strict occurrence bodies, the canonical JSON and its
// published digest vectors (computed independently with Node's crypto over the hand-written canonical strings), and
// the allowlisted draft outputs.

const OWNER = "wfo_0123456789abcdef0123456789abcdef";
const NOW = Date.parse("2026-10-17T09:05:00.000Z");

/** Vector 1: a manual run with one idea (no planner context). */
const vector1 = (): Record<string, unknown> => ({
  occurrenceId: "m1",
  ownerKey: OWNER,
  workflowId: "w1",
  kind: "manual",
  registrationEpoch: 1,
  revision: 3,
  snapshot: {
    name: { ar: "سير", en: "Flow" },
    trigger: { kind: "manual" },
    actions: [{ id: "a1", kind: "idea", text: { ar: "", en: "Idea for {date}" } }],
  },
  plannerContext: null,
  input: {
    title: { ar: "", en: "" },
    summary: { ar: "", en: "" },
    slug: "",
    lang: "en",
    day: "2026-10-17",
  },
  executionAt: "2026-10-17T09:00:00.000Z",
});
const CANON1 =
  '{"executionAt":"2026-10-17T09:00:00.000Z","input":{"day":"2026-10-17","lang":"en","slug":"","summary":{"ar":"","en":""},"title":{"ar":"","en":""}},"kind":"manual","occurrenceId":"m1","ownerKey":"wfo_0123456789abcdef0123456789abcdef","plannerContext":null,"registrationEpoch":1,"revision":3,"snapshot":{"actions":[{"id":"a1","kind":"idea","text":{"ar":"","en":"Idea for {date}"}}],"name":{"ar":"سير","en":"Flow"},"trigger":{"kind":"manual"}},"workflowId":"w1"}';
const DIGEST1 = "7d59f9da6b98153f4fbc6b64d5012c30e961af6270c70e872963f92d57b88af1";

/** Vector 2: an article-ready run with a plan step (planner context) and a post. */
const vector2 = (): Record<string, unknown> => ({
  occurrenceId: "ar-x1",
  ownerKey: OWNER,
  workflowId: "w2",
  kind: "article-ready",
  registrationEpoch: 2,
  revision: 5,
  snapshot: {
    name: { ar: "جاهز", en: "Ready" },
    trigger: { kind: "article-ready" },
    actions: [
      { id: "p1", kind: "plan", quest: "produce", minutes: 30, day: "lightest" },
      {
        id: "s1",
        kind: "post",
        platform: "tiktok",
        title: { ar: "", en: "{title}" },
        caption: { ar: "", en: "{summary}" },
        offsetDays: 1,
      },
    ],
  },
  plannerContext: {
    targetWeek: "2026-10-17",
    completions: [{ skillId: "iphone-log-prores", quest: "train", at: "2026-10-10T08:00:00.000Z" }],
    planItems: [
      {
        id: "pi1",
        week: "2026-10-17",
        day: 2,
        skillId: "iphone-log-prores",
        quest: "produce",
        minutes: 0,
        by: "me",
      },
    ],
    settings: { gear: ["phone"], davinciEdition: "free" },
    contextAt: "2026-10-17T09:00:00.000Z",
  },
  input: {
    articleId: "art1",
    title: { ar: "", en: "Log on iPhone" },
    summary: { ar: "", en: "Why log" },
    slug: "log-iphone",
    skillId: "iphone-log-prores",
    lang: "en",
    day: "2026-10-17",
  },
  executionAt: "2026-10-17T09:00:00.000Z",
});
const DIGEST2 = "a5eb743dcb9dbcb44f848cd7a8b9694be74fc5e8b5a54dd1002e396d869e242b";

type Mut = (b: Record<string, any>) => void; // eslint-disable-line @typescript-eslint/no-explicit-any
const withBody = (base: () => Record<string, unknown>, mut: Mut) => {
  const b = base();
  mut(b);
  return b;
};
const refused = (b: unknown, error = "bad_request") =>
  expect(checkBody(b, NOW)).toEqual({ ok: false, error });

describe("canonical JSON and the published digest vectors", () => {
  it("vector 1: canonical string and digest are fixed; key order never changes them", async () => {
    const chk = checkBody(vector1(), NOW);
    expect(chk.ok).toBe(true);
    const body = (chk as { body: OccurrenceBody }).body;
    expect(canonicalJson(body)).toBe(CANON1);
    expect(await payloadDigestOf(body)).toBe(DIGEST1);
    // Reversed key order at every level: the same canonical bytes and digest.
    const reversed = JSON.parse(JSON.stringify(vector1()), function (this: unknown, _k, v) {
      return v && typeof v === "object" && !Array.isArray(v)
        ? Object.fromEntries(Object.entries(v).reverse())
        : v;
    });
    expect(canonicalJson(reversed)).toBe(CANON1);
    expect(await sha256Hex(canonicalJson(reversed))).toBe(DIGEST1);
  });

  it("vector 2: planner context + post; the digest is not part of the body", async () => {
    const chk = checkBody(vector2(), NOW);
    expect(chk.ok).toBe(true);
    expect(await payloadDigestOf((chk as { body: OccurrenceBody }).body)).toBe(DIGEST2);
    refused(withBody(vector2, (b) => (b.payloadDigest = DIGEST2)));
  });

  it("any content change changes the digest (an asserted digest is never proof of other content)", async () => {
    const changed = withBody(vector1, (b) => (b.snapshot.actions[0].text.en = "Idea for {title}"));
    expect(await sha256Hex(canonicalJson(changed))).not.toBe(DIGEST1);
  });

  it("refuses non-integer numbers and unsupported values", () => {
    expect(() => canonicalJson(1.5)).toThrow();
    expect(() => canonicalJson({ a: () => 1 })).toThrow();
    expect(canonicalJson({ b: [1, "x", null, true], a: { d: 1, c: 2 } })).toBe(
      '{"a":{"c":2,"d":1},"b":[1,"x",null,true]}',
    );
  });

  it("weekOf: the Saturday that starts the planner week (Friday 23:59 Riyadh stays in its week)", () => {
    expect(weekOf("2026-10-17")).toBe("2026-10-17"); // Saturday
    expect(weekOf("2026-10-23")).toBe("2026-10-17"); // Friday
    expect(weekOf("2026-10-24")).toBe("2026-10-24");
    // Friday 23:59 Riyadh = 20:59Z: day 2026-10-23, week 2026-10-17 (matrix 27).
    const fri = withBody(vector1, (b) => {
      b.executionAt = "2026-10-23T20:59:00.000Z";
      b.input.day = "2026-10-23";
    });
    expect(checkBody(fri, Date.parse("2026-10-23T21:00:00.000Z")).ok).toBe(true);
  });
});

describe("strict occurrence bodies", () => {
  it("unknown fields anywhere are refused (privacy canaries: ideas, articles, inbox, tokens)", () => {
    refused(withBody(vector1, (b) => (b.ideas = [{ text: "private" }])));
    refused(withBody(vector1, (b) => (b.input.article = { body: "draft" })));
    refused(withBody(vector1, (b) => (b.snapshot.inbox = [])));
    refused(withBody(vector1, (b) => (b.snapshot.actions[0].accessToken = "IGQV-canary")));
    refused(withBody(vector2, (b) => (b.plannerContext.completions[0].proofUrl = "https://x")));
    refused(withBody(vector2, (b) => (b.plannerContext.settings.lang = "ar")));
    refused(withBody(vector2, (b) => (b.plannerContext.planItems[0].note = "x")));
  });

  it("ids: a colon or other alphabet is unsupported_id; lengths bounded", () => {
    refused(
      withBody(vector1, (b) => (b.occurrenceId = "a:b")),
      "unsupported_id",
    );
    refused(
      withBody(vector1, (b) => (b.snapshot.actions[0].id = "b:c")),
      "unsupported_id",
    );
    refused(
      withBody(vector1, (b) => (b.workflowId = "w".repeat(65))),
      "unsupported_id",
    );
    refused(
      withBody(vector2, (b) => (b.input.articleId = "art 1")),
      "unsupported_id",
    );
    refused(withBody(vector1, (b) => (b.workflowId = 7)));
  });

  it("actions: 1–5, unique ids, supported kinds and bounds", () => {
    refused(withBody(vector1, (b) => (b.snapshot.actions = [])));
    refused(
      withBody(vector1, (b) => {
        const a = b.snapshot.actions[0];
        b.snapshot.actions = [a, { ...a }];
      }),
    );
    refused(
      withBody(vector1, (b) => {
        const a = b.snapshot.actions[0];
        b.snapshot.actions = [1, 2, 3, 4, 5, 6].map((n) => ({ ...a, id: `a${n}` }));
      }),
    );
    refused(withBody(vector1, (b) => (b.snapshot.actions[0].kind = "publish")));
    refused(withBody(vector1, (b) => (b.snapshot.actions[0].text.en = "x".repeat(501))));
    refused(withBody(vector2, (b) => (b.snapshot.actions[0].minutes = 4)));
    refused(withBody(vector2, (b) => (b.snapshot.actions[1].offsetDays = 31)));
    refused(withBody(vector2, (b) => (b.snapshot.actions[1].platform = "facebook")));
    refused(withBody(vector2, (b) => delete b.snapshot.actions[1].offsetDays));
  });

  it("authority, trigger/input consistency and timestamps", () => {
    refused(withBody(vector1, (b) => (b.ownerKey = "wfo_short")));
    refused(withBody(vector1, (b) => (b.snapshot.trigger.kind = "article-ready")));
    refused(withBody(vector1, (b) => (b.kind = "scheduled")));
    // Manual: no article, no skill, empty texts; prefixes ar-/sc- are not manual.
    refused(withBody(vector1, (b) => (b.input.articleId = "art1")));
    refused(withBody(vector1, (b) => (b.input.title.en = "x")));
    refused(withBody(vector1, (b) => (b.occurrenceId = "ar-m1")));
    refused(withBody(vector1, (b) => (b.occurrenceId = "sc-m1")));
    // Article-ready: `ar-` id and an article.
    refused(withBody(vector2, (b) => (b.occurrenceId = "x1")));
    refused(withBody(vector2, (b) => delete b.input.articleId));
    // The day is the Riyadh day of executionAt; executionAt canonical, not in the future beyond skew.
    refused(withBody(vector1, (b) => (b.input.day = "2026-10-16")));
    refused(withBody(vector1, (b) => (b.executionAt = "2026-10-17T09:00:00Z")));
    refused(withBody(vector1, (b) => (b.executionAt = "2026-10-17T12:00:00.000Z")));
    refused(withBody(vector1, (b) => (b.input.day = "2026-02-30")));
    refused(withBody(vector1, (b) => (b.registrationEpoch = 0)));
    refused(withBody(vector1, (b) => (b.revision = 1.5)));
  });

  it("planner context: present exactly with a plan step, the target week, history before it, bounded", () => {
    refused(withBody(vector1, (b) => (b.plannerContext = vector2().plannerContext)));
    refused(withBody(vector2, (b) => (b.plannerContext = null)));
    refused(withBody(vector2, (b) => (b.plannerContext.targetWeek = "2026-10-10")));
    // A completion inside the target week is not history.
    refused(
      withBody(vector2, (b) => (b.plannerContext.completions[0].at = "2026-10-17T08:00:00.000Z")),
    );
    refused(withBody(vector2, (b) => (b.plannerContext.planItems[0].week = "2026-10-10")));
    refused(withBody(vector2, (b) => (b.plannerContext.contextAt = "2026-10-17T09:00:01.000Z")));
    refused(withBody(vector2, (b) => (b.plannerContext.settings.gear = ["phone", "phone"])));
    const items = Array.from({ length: 90 }, (_, n) => ({
      ...(vector2().plannerContext as { planItems: object[] }).planItems[0],
      id: `wf:run-${n}:action-${n}-${"x".repeat(40)}`,
    }));
    const big = withBody(vector2, (b) => (b.plannerContext.planItems = items));
    expect(canonicalJson(big.plannerContext).length).toBeGreaterThan(CONTEXT_BYTES_MAX);
    refused(big, "too_large");
  });

  it("whole body ≤ 16 KiB (too_large, never truncated)", () => {
    const big = withBody(vector2, (b) => {
      b.input.title = { ar: "ع".repeat(2000), en: "x".repeat(2000) };
      b.input.summary = { ar: "ع".repeat(2000), en: "x".repeat(2000) };
      for (const n of [1, 2, 3])
        b.snapshot.actions.push({
          id: `i${n}`,
          kind: "idea",
          text: { ar: "ع".repeat(500), en: "x".repeat(500) },
        });
    });
    expect(new TextEncoder().encode(canonicalJson(big)).length).toBeGreaterThan(BODY_BYTES_MAX);
    refused(big, "too_large");
    refused(withBody(vector1, (b) => (b.snapshot.name.en = "\ud800")));
  });
});

describe("allowlisted draft outputs", () => {
  const body1 = checkBody(vector1(), NOW) as { body: OccurrenceBody };
  const body2 = checkBody(vector2(), NOW) as { body: OccurrenceBody };
  const idea = {
    id: "wf:m1:a1",
    text: "Idea for 2026-10-17",
    source: "workflow",
    createdAt: "2026-10-17T09:00:00.000Z",
  };
  const plan = {
    id: "wf:ar-x1:p1",
    week: "2026-10-17",
    day: 3,
    skillId: "iphone-log-prores",
    quest: "produce",
    minutes: 30,
    by: "me",
  };
  const post = {
    id: "wf:ar-x1:s1",
    platform: "tiktok",
    title: "Log on iPhone",
    caption: "Why log",
    hashtags: ["#iphone"],
    stage: "idea",
    plannedDay: "2026-10-18",
    plannedTime: null,
    skillId: "iphone-log-prores",
    script: { hook: "", beats: ["", "", ""], cta: "" },
    shots: [],
    createdAt: "2026-10-17T09:00:00.000Z",
    updatedAt: "2026-10-17T09:00:00.000Z",
  };

  it("accepts exactly the drafts of the body's actions", () => {
    expect(validOutput(idea, body1.body, 0)).toBe(true);
    expect(validOutput(plan, body2.body, 0)).toBe(true);
    expect(validOutput(post, body2.body, 1)).toBe(true);
  });

  it("refuses another id, kind, week, publication fields or unknown fields", () => {
    expect(validOutput({ ...idea, id: "wf:m1:a2" }, body1.body, 0)).toBe(false);
    expect(validOutput({ ...idea, source: "me" }, body1.body, 0)).toBe(false);
    expect(validOutput({ ...idea, token: "x" }, body1.body, 0)).toBe(false);
    expect(validOutput(idea, body1.body, 1)).toBe(false);
    expect(validOutput({ ...plan, week: "2026-10-10" }, body2.body, 0)).toBe(false);
    expect(validOutput({ ...plan, by: "rules" }, body2.body, 0)).toBe(false);
    expect(validOutput({ ...plan, minutes: 45 }, body2.body, 0)).toBe(false);
    expect(validOutput({ ...post, stage: "scheduled" }, body2.body, 1)).toBe(false);
    expect(validOutput({ ...post, plannedTime: "09:00" }, body2.body, 1)).toBe(false);
    expect(validOutput({ ...post, autoPost: { platforms: ["tiktok"] } }, body2.body, 1)).toBe(
      false,
    );
    expect(validOutput({ ...post, postedUrl: "https://x" }, body2.body, 1)).toBe(false);
    expect(validOutput({ ...post, platform: "youtube" }, body2.body, 1)).toBe(false);
    expect(
      validOutput({ ...post, script: { hook: "x", beats: ["", "", ""], cta: "" } }, body2.body, 1),
    ).toBe(false);
  });

  it("DT-7B-R1 body-free draft shape (the feed has no body): kind + exact id, nothing nested passes", () => {
    expect(validDraft(idea, "idea", "wf:m1:a1")).toBe(true);
    expect(validDraft(plan, "plan", "wf:ar-x1:p1")).toBe(true);
    expect(validDraft(post, "post", "wf:ar-x1:s1")).toBe(true);
    expect(validDraft(idea, "idea", "wf:m1:a2")).toBe(false);
    expect(validDraft(idea, "post", "wf:m1:a1")).toBe(false);
    expect(validDraft(idea, "publish", "wf:m1:a1")).toBe(false);
    expect(validDraft({ token: "x" }, "idea", "wf:m1:a1")).toBe(false);
    expect(validDraft({ ...idea, inbox: { token: "x" } }, "idea", "wf:m1:a1")).toBe(false);
    expect(validDraft({ ...plan, week: "2026-10-18" }, "plan", "wf:ar-x1:p1")).toBe(false); // not a Saturday
    expect(validDraft({ ...plan, minutes: 121 }, "plan", "wf:ar-x1:p1")).toBe(false);
    expect(validDraft({ ...plan, quest: "publish" }, "plan", "wf:ar-x1:p1")).toBe(false);
    expect(validDraft({ ...post, platform: "myspace" }, "post", "wf:ar-x1:s1")).toBe(false);
    expect(validDraft({ ...post, stage: "scheduled" }, "post", "wf:ar-x1:s1")).toBe(false);
  });
});
