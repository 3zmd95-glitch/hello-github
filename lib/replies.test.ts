import { describe, expect, it, vi } from "vitest";
import { AutoReplySchema, type AutoReply, type SocialStatusMap } from "./domain";
import {
  ctr,
  dmPreview,
  firstMatch,
  matchesAutoReply,
  newAutoReply,
  normalizeForMatch,
  parseRepliesDoc,
  repliesDelete,
  repliesList,
  repliesPoll,
  repliesSave,
  replyInput,
  replyProblems,
  splitKeywords,
} from "./replies";

const CONFIG = { url: "https://scout.test", token: "tok" };
const LUT = "https://3zprod.com/lut";

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
  return vi.fn<typeof fetch>(async () =>
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
      publicReply: "x".repeat(2201),
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
    expect(replyProblems(reply({ dmText: "x".repeat(1001) }), null)).toEqual([
      { code: "dmTooLong", max: 1000 },
    ]);
    // Per-keyword length is the Worker's rule too (it would answer 400 "keywords" otherwise).
    expect(replyProblems(reply({ keywords: ["لت", ` ${"ك".repeat(41)} `] }), null)).toEqual([
      { code: "keywordTooLong", max: 40 },
    ]);
    expect(replyProblems(reply({ keywords: ["ك".repeat(40)] }), null)).toEqual([]);
    expect(
      replyProblems(reply({ keywords: Array.from({ length: 11 }, (_, i) => `k${i}`) }), null),
    ).toEqual([{ code: "tooManyKeywords" }]);
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

describe("dmPreview / ctr / replyInput / newAutoReply", () => {
  it("renders the DM the way the Worker sends it", () => {
    expect(dmPreview(reply(), "https://w.test")).toBe(
      "حمل اللت من الرابط تحت\n\nحمل اللت: https://w.test/go/lut/0",
    );
    expect(dmPreview(reply())).toBe(`حمل اللت من الرابط تحت\n\nحمل اللت: ${LUT}`);
    expect(dmPreview(reply({ buttons: [] }))).toBe("حمل اللت من الرابط تحت");
  });

  it("computes the click rate in whole percent", () => {
    expect(ctr(0, 0)).toBeNull();
    expect(ctr(3, 1)).toBe(33);
    expect(ctr(4, 4)).toBe(100);
  });

  it("builds the Worker body without the counters", () => {
    const a = reply({ keywords: [" لت ", "🙏"], stats: { sends: 9, clicks: 2, publicReplies: 0, failures: 0 } });
    expect(replyInput(a)).toEqual({
      id: "lut",
      enabled: true,
      postId: "m1",
      keywords: ["لت"],
      match: "contains",
      publicReply: "أرسلته لك 🎬",
      dmText: "حمل اللت من الرابط تحت",
      buttons: [{ title: "حمل اللت", url: LUT }],
    });
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
    expect(r).toEqual({ ok: true, doc: { automations: [], log: [] } });
    expect(await repliesList(null)).toEqual({ ok: false, error: { type: "unconfigured" } });
  });

  it("POSTs the automation and parses the saved one", async () => {
    const saved = { ...replyInput(reply()), stats: { sends: 0, publicReplies: 0, failures: 0, clicks: 0 } };
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
      doc: { automations: [], log: [] },
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
