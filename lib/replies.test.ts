import { describe, expect, it, vi } from "vitest";
import { AutoReplySchema, type AutoReply, type SocialStatusMap } from "./domain";
import {
  aboutLetters,
  ctr,
  defaultReplyProblems,
  dmBytesLeft,
  firstMatch,
  matchesAutoReply,
  messageButtons,
  newAutoReply,
  normalizeForMatch,
  parseRepliesDoc,
  repliesDelete,
  repliesList,
  repliesPoll,
  repliesSave,
  repliesSettings,
  replyInput,
  replyProblems,
  splitKeywords,
  textBody,
} from "./replies";

const CONFIG = { url: "https://scout.test", token: "tok" };
const LUT = "https://3zprod.com/lut";

// `publicReply` is v1's single reply: the schema reads it into `publicReplies` only when `publicReplies` is empty.
const reply = (over: Partial<AutoReply> = {}): AutoReply =>
  AutoReplySchema.parse({
    id: "lut",
    postId: "m1",
    keywords: ["لت"],
    publicReply: "أرسلته لك 🎬",
    dmText: "حمل اللت من الرابط تحت",
    buttons: [{ title: "حمل اللت", url: LUT }],
    ...over,
  });

const ready: SocialStatusMap = {
  instagram: { configured: true, connected: true, canPublish: true, canReply: true },
};

function replying(body: unknown, status = 200) {
  return vi.fn<typeof fetch>(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
  );
}

describe("matching (same vectors as the Worker)", () => {
  it.each([
    ["لت", "لت", "exact", true],
    ["ابغى اللت 🙏", "لت", "contains", true],
    ["اللت", "لت", "exact", false],
    ["لَت!", "لت", "exact", true],
    ["LUT please", "lut", "contains", true],
    ["أبغى", "ابغى", "exact", true],
    ["شكرا", "لت", "contains", false],
  ] as const)("%j vs %j (%s) → %s", (text, keyword, match, want) => {
    expect(matchesAutoReply(text, { keywords: [keyword], match })).toBe(want);
  });

  it("normalizes like the Worker", () => {
    expect(normalizeForMatch("  أَهْلاً… بِكُم! 🎬 ")).toBe("اهلا بكم");
    expect(reply().publicReplies).toEqual(["أرسلته لك 🎬"]);
    expect(reply()).not.toHaveProperty("publicReply");
  });

  it("firstMatch prefers a switched-on specific-post automation over 'any post'", () => {
    const any = reply({ id: "any", postId: null, keywords: ["لت"] });
    const off = reply({ id: "off", enabled: false, keywords: ["لت"] });
    const specific = reply({ id: "lut", postId: "m1", keywords: ["لت"] });
    expect(firstMatch("ابغى اللت", [off, any, specific])?.id).toBe("lut");
    expect(firstMatch("ابغى اللت", [off, any])?.id).toBe("any");
    expect(firstMatch("شكرا", [any, specific])).toBeUndefined();
  });
});

describe("splitKeywords", () => {
  it("splits on commas (Arabic too) and new lines, trims and drops duplicates", () => {
    expect(splitKeywords(" لت, LUT،lut\n\npreset ,, 🙏")).toEqual(["لت", "LUT", "preset"]);
    expect(splitKeywords("")).toEqual([]);
  });
});

describe("replyProblems", () => {
  it("passes a complete automation on a ready account", () => {
    expect(replyProblems(reply(), ready)).toEqual([]);
    expect(replyProblems(reply(), null)).toEqual([]);
  });

  it("names every missing or oversized part", () => {
    const a = reply({
      keywords: ["🙏"],
      dmText: "",
      publicReplies: ["x".repeat(2201)],
      buttons: [
        { title: "", url: "http://a.test" },
        { title: "a", url: LUT },
        { title: "b", url: LUT },
        { title: "c", url: LUT },
      ],
    });
    expect(replyProblems(a, null).map((p) => p.code)).toEqual([
      "noKeywords",
      "noDm",
      "publicTooLong",
      "tooManyButtons",
      "noTitle",
      "badUrl",
    ]);
    expect(replyProblems(reply({ buttons: [], dmText: "ل".repeat(501) }), null)).toEqual([
      { code: "dmTooLong" },
    ]);
    expect(replyProblems(reply({ dmText: "x".repeat(641) }), null)).toEqual([
      { code: "templateTooLong", max: 640 },
    ]);
    expect(
      replyProblems(reply({ publicReplies: ["a", "b", "c", "d"] }), null).map((p) => p.code),
    ).toEqual(["tooManyPublic"]);
    expect(
      replyProblems(
        reply({
          followButton: true,
          buttons: [
            { title: "a", url: LUT },
            { title: "b", url: LUT },
            { title: "c", url: LUT },
          ],
        }),
        null,
      ).map((p) => p.code),
    ).toEqual(["tooManyButtons"]);
    // A message rule's public replies are never sent, so they never block saving.
    expect(
      replyProblems(reply({ trigger: "message", publicReplies: ["x".repeat(2201)] }), null),
    ).toEqual([]);
    // Per-keyword length is the Worker's rule too (it would answer 400 "keywords" otherwise).
    expect(replyProblems(reply({ keywords: ["لت", ` ${"ك".repeat(41)} `] }), null)).toEqual([
      { code: "keywordTooLong", max: 40 },
    ]);
    expect(replyProblems(reply({ keywords: ["ك".repeat(40)] }), null)).toEqual([]);
    expect(
      replyProblems(reply({ keywords: Array.from({ length: 11 }, (_, i) => `k${i}`) }), null),
    ).toEqual([{ code: "tooManyKeywords" }]);
  });

  it("checks the public replies as they are sent: trimmed, blanks dropped", () => {
    // An empty editor slot never blocks saving (replyInput drops it).
    expect(replyProblems(reply({ publicReplies: ["أ", "", "ب", "  ", "ج"] }), null)).toEqual([]);
    expect(replyProblems(reply({ publicReplies: [` ${"x".repeat(2200)} `] }), null)).toEqual([]);
    expect(replyProblems(reply({ publicReplies: ["أ", "ب", "ج", "د", " "] }), null)).toEqual([
      { code: "tooManyPublic", max: 3 },
    ]);
  });

  it("reports the account state", () => {
    expect(replyProblems(reply(), { instagram: { configured: true, connected: false } })).toEqual([
      { code: "notConnected" },
    ]);
    expect(
      replyProblems(reply(), { instagram: { configured: true, connected: true, canReply: false } }),
    ).toEqual([{ code: "noPermission" }]);
  });
});

describe("ctr / replyInput / newAutoReply", () => {
  it("computes the click rate in whole percent", () => {
    expect(ctr(0, 0)).toBeNull();
    expect(ctr(3, 1)).toBe(33);
    expect(ctr(4, 4)).toBe(100);
  });

  it("builds the Worker body without the counters", () => {
    const a = reply({
      keywords: [" لت ", "🙏"],
      stats: { sends: 9, clicks: 2, publicReplies: 0, failures: 0 },
    });
    expect(replyInput(a)).toEqual({
      id: "lut",
      enabled: true,
      trigger: "comment",
      postId: "m1",
      keywords: ["لت"],
      match: "contains",
      publicReplies: ["أرسلته لك 🎬"],
      dmText: "حمل اللت من الرابط تحت",
      buttons: [{ title: "حمل اللت", url: LUT }],
      followButton: false,
    });
  });

  it("sends a message rule without a post or public replies", () => {
    const a = reply({ trigger: "message", title: "x", thumbUrl: "https://cdn.test/t.jpg" });
    expect(replyInput(a)).toMatchObject({ trigger: "message", postId: null, publicReplies: [] });
    expect(replyInput(a)).not.toHaveProperty("title");
  });

  it("starts a new automation with the defaults", () => {
    expect(newAutoReply("x")).toMatchObject({
      id: "x",
      enabled: true,
      postId: null,
      keywords: [],
      match: "contains",
      buttons: [],
      stats: { sends: 0, clicks: 0 },
    });
  });
});

describe("parseRepliesDoc", () => {
  it("keeps what it understands and refuses garbage", () => {
    const doc = parseRepliesDoc({
      automations: [{ id: "lut", keywords: ["لت"], dmText: "d", stats: { sends: 2 } }],
      log: [
        {
          at: "2026-09-29T09:00:00Z",
          automationId: "lut",
          postId: "m1",
          commentId: "c1",
          text: "لت",
          publicReply: "sent",
          dm: "sent",
        },
      ],
      origin: "https://w.test",
      lastPollAt: "2026-09-29T09:00:00Z",
      handled: { c1: "x" },
    });
    expect(doc?.automations[0]).toMatchObject({ id: "lut", stats: { sends: 2, clicks: 0 } });
    expect(doc?.log).toHaveLength(1);
    expect(doc).not.toHaveProperty("handled");
    expect(parseRepliesDoc({ automations: "no" })).toBeNull();
    expect(parseRepliesDoc(null)).toBeNull();
  });
});

describe("Worker calls", () => {
  it("GETs the document", async () => {
    const fetchImpl = replying({ automations: [], log: [] });
    const r = await repliesList(CONFIG, { fetchImpl });
    expect(fetchImpl.mock.calls[0][0]).toBe("https://scout.test/social/replies");
    expect(r).toEqual({ ok: true, doc: { automations: [], log: [], paused: false } });
    expect(await repliesList(null)).toEqual({ ok: false, error: { type: "unconfigured" } });
  });

  it("POSTs the automation and parses the saved one", async () => {
    const saved = {
      ...replyInput(reply()),
      stats: { sends: 0, publicReplies: 0, failures: 0, clicks: 0 },
    };
    const fetchImpl = replying({ automation: saved });
    const r = await repliesSave(CONFIG, reply(), { fetchImpl });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://scout.test/social/replies");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual(replyInput(reply()));
    expect(r).toMatchObject({ ok: true, automation: { id: "lut" } });
    expect(await repliesSave(CONFIG, reply(), { fetchImpl: replying({}) })).toEqual({
      ok: false,
      error: { type: "upstream" },
    });
    expect(
      await repliesSave(CONFIG, reply(), {
        fetchImpl: replying({ error: "bad_request", detail: "dmText" }, 400),
      }),
    ).toEqual({ ok: false, error: { type: "bad_request", status: 400 } });
  });

  it("DELETEs by id and polls", async () => {
    const del = replying({ ok: true });
    expect(await repliesDelete(CONFIG, "lut", { fetchImpl: del })).toEqual({ ok: true });
    expect(del.mock.calls[0][0]).toBe("https://scout.test/social/replies/lut");
    expect(del.mock.calls[0][1]?.method).toBe("DELETE");

    const poll = replying({
      result: { checked: 2, sent: ["c1", "c2"], failed: [] },
      automations: [],
      log: [],
    });
    const r = await repliesPoll(CONFIG, { fetchImpl: poll });
    expect(poll.mock.calls[0][0]).toBe("https://scout.test/social/replies/poll");
    expect(r).toEqual({
      ok: true,
      doc: { automations: [], log: [], paused: false },
      outcome: { checked: 2, sent: 2, failed: 0 },
    });

    const locked = await repliesPoll(CONFIG, {
      fetchImpl: replying({
        result: { checked: 0, sent: [], failed: [], skipped: "locked" },
        automations: [],
        log: [],
      }),
    });
    expect(locked).toMatchObject({ ok: true, outcome: { checked: 0, sent: 0, skipped: "locked" } });
  });
});

describe("the reply as the Worker builds it", () => {
  it("routes links through /go, puts «تابعني» last, and writes the plain-text form", () => {
    const a = reply({ followButton: true });
    expect(messageButtons(a, "https://w.test", "3z.prod")).toEqual([
      { title: "حمل اللت", url: "https://w.test/go/lut/0" },
      { title: "تابعني", url: "https://www.instagram.com/3z.prod/" },
    ]);
    expect(textBody("هلا", [{ title: "أ", url: LUT }])).toBe(`هلا\n\nأ: ${LUT}`);
  });

  it("counts the bytes left like the Worker's dmFits (Arabic letters are two bytes)", () => {
    expect(dmBytesLeft(reply({ buttons: [], dmText: "ل".repeat(500) }), "https://w.test")).toBe(0);
    expect(dmBytesLeft(reply({ buttons: [], dmText: "ل".repeat(501) }), "https://w.test")).toBe(-2);
    // «تابعني» is counted with a 30-character username even when the username is unknown.
    expect(
      dmBytesLeft(reply({ buttons: [], followButton: true, dmText: "ل".repeat(500) }), undefined),
    ).toBe(-73);
  });

  it("shows the bytes as about how many Arabic letters, rounding 'too long' up", () => {
    expect([1000, 3, 1, 0, -1, -2, -3].map(aboutLetters)).toEqual([500, 1, 0, 0, 1, 1, 2]);
  });

  it("firstMatch answers DMs with the oldest message rule only", () => {
    const comment = reply({ id: "c", keywords: ["كاميرا"] });
    const newer = reply({
      id: "new",
      trigger: "message",
      keywords: ["كاميرا"],
      createdAt: "2026-10-02T00:00:00Z",
    });
    const older = reply({
      id: "old",
      trigger: "message",
      keywords: ["كاميرا"],
      createdAt: "2026-10-01T00:00:00Z",
    });
    expect(firstMatch("كاميرا؟", [comment, newer, older], "message")?.id).toBe("old");
    expect(firstMatch("كاميرا؟", [comment, newer, older])?.id).toBe("c");
  });

  it("checks the default reply like the Worker", () => {
    expect(defaultReplyProblems({ enabled: true, text: " " })).toEqual([{ code: "noDm" }]);
    expect(defaultReplyProblems({ enabled: false, text: "" })).toEqual([]);
    expect(defaultReplyProblems({ enabled: true, text: "ل".repeat(501) })).toEqual([
      { code: "dmTooLong" },
    ]);
  });
});

describe("repliesSettings", () => {
  it("posts the settings and answers with the fresh document", async () => {
    const fetchImpl = replying({ automations: [], log: [], paused: true, guard: "slow" });
    const r = await repliesSettings(CONFIG, { paused: true }, { fetchImpl });
    expect(r).toMatchObject({ ok: true, doc: { paused: true, guard: "slow" } });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe("https://scout.test/social/replies/settings");
    expect(JSON.parse(String(init?.body))).toEqual({ paused: true });
  });

  it("reads a v2 document: default reply with its counters, log kinds", async () => {
    const doc = parseRepliesDoc({
      automations: [],
      log: [
        {
          at: "t",
          kind: "default",
          automationId: "default",
          messageId: "d1",
          text: "هلا",
          publicReply: "skipped",
          dm: "sent",
        },
      ],
      paused: false,
      defaultReply: { enabled: true, text: "وصلت رسالتك", stats: { sends: 3 } },
      ownerUsername: "3z.prod",
    });
    expect(doc).toMatchObject({
      log: [{ kind: "default", messageId: "d1" }],
      defaultReply: { enabled: true, stats: { sends: 3, clicks: 0 } },
      ownerUsername: "3z.prod",
    });
  });
});
