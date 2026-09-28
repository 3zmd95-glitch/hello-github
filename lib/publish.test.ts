import { describe, expect, it, vi } from "vitest";
import {
  AutoPostSchema,
  PostSchema,
  type AutoPostInput,
  type Post,
  type SocialStatusMap,
} from "./domain";
import {
  autoPostActive,
  autoPostOf,
  autoPostSummary,
  buildJob,
  CAPTION_MAX,
  captionFor,
  captionWarnings,
  defaultCaption,
  directMediaUrl,
  ELLIPSIS,
  firstPermalink,
  manualComposeUrl,
  parseJobs,
  pendingManualPlatforms,
  publishCancel,
  publishList,
  publishProblems,
  publishRun,
  publishSchedule,
  reconnectInDays,
  reconnectMessageKey,
  scheduledAtOf,
  sendCaption,
  trimCaption,
} from "./publish";

const CONFIG = { url: "https://scout.test", token: "tok" };
const AT = "2026-09-27T09:00:00.000Z";

function post(over: Partial<Post> = {}): Post {
  return PostSchema.parse({
    id: "p1",
    platform: "tiktok",
    title: "Match cut in 30 s",
    caption: "How I do a match cut",
    hashtags: ["#capcut", "#editing"],
    plannedDay: "2026-10-01",
    plannedTime: "21:00",
    createdAt: AT,
    updatedAt: AT,
    ...over,
  });
}

const auto = (over: AutoPostInput = {}) =>
  AutoPostSchema.parse({
    platforms: ["tiktok"],
    mediaUrl: "https://cdn.example/clip.mp4",
    ...over,
  });

const ready: SocialStatusMap = {
  tiktok: { configured: true, connected: true, canPublish: true },
  instagram: { configured: true, connected: true, canPublish: true },
  youtube: { configured: true, connected: true, canPublish: true },
  threads: { configured: true, connected: true, canPublish: true },
};

describe("captions and time", () => {
  it("the default caption is the caption plus the hashtags; an override wins per network", () => {
    const p = post();
    expect(defaultCaption(p)).toBe("How I do a match cut\n\n#capcut #editing");
    const a = auto({
      platforms: ["tiktok", "threads"],
      captions: { threads: "short one", tiktok: "  " },
    });
    expect(captionFor(p, a, "threads")).toBe("short one");
    // A blank override falls back to the default.
    expect(captionFor(p, a, "tiktok")).toBe(defaultCaption(p));
  });

  it("fires at the planned Riyadh time, or the platform's best time without one", () => {
    expect(scheduledAtOf(post())).toBe("2026-10-01T18:00:00.000Z");
    // 2026-10-01 is a Thursday: TikTok's weekday best time is 21:00.
    expect(scheduledAtOf(post({ plannedTime: null }))).toBe("2026-10-01T18:00:00.000Z");
    expect(scheduledAtOf(post({ plannedDay: null }))).toBeNull();
  });

  it("new settings preselect the post's own platform", () => {
    expect(autoPostOf(post({ platform: "instagram" })).platforms).toEqual(["instagram"]);
  });
});

describe("trimCaption", () => {
  const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");

  it("leaves a caption within the limit alone", () => {
    expect(trimCaption("threads", "short #one #two")).toEqual({
      text: "short #one #two",
      trimmed: false,
    });
    const exact = "x".repeat(CAPTION_MAX.threads);
    expect(trimCaption("threads", exact)).toEqual({ text: exact, trimmed: false });
  });

  it("drops hashtags from the end one by one until it fits", () => {
    const body = "a".repeat(480);
    const text = `${body}\n\n#capcut #editing #3zprod`;
    // 480 + 2 + 24 = 506 > 500: dropping " #3zprod" lands at 498, the other two tags stay.
    expect(trimCaption("threads", text)).toEqual({
      text: `${body}\n\n#capcut #editing`,
      trimmed: true,
    });
    // With more tags gone than needed, the body itself survives untouched.
    const many = `${body} #a #b #c #d #e #f #g #h #i #j`;
    const r = trimCaption("threads", many);
    expect(r.trimmed).toBe(true);
    expect(r.text.startsWith(body)).toBe(true);
    expect(r.text.length).toBeLessThanOrEqual(500);
  });

  it("then cuts at a word boundary with an ellipsis", () => {
    const text = `${words(200)} #tag`;
    const r = trimCaption("x", text);
    expect(r.trimmed).toBe(true);
    expect(r.text.length).toBeLessThanOrEqual(280);
    expect(r.text.endsWith(ELLIPSIS)).toBe(true);
    // Ends on a whole word: "…" follows a complete "wNN" token, no space before it.
    expect(r.text).toMatch(/w\d+…$/);
    expect(text.startsWith(r.text.slice(0, -1) + " ")).toBe(true);
  });

  it("hard-cuts one long word rather than throwing away half the room", () => {
    const r = trimCaption("snapchat", "ab " + "z".repeat(300));
    expect(r.text.length).toBe(250);
    expect(r.text.endsWith(ELLIPSIS)).toBe(true);
    // A caption that is nothing but hashtags is cut too, never emptied.
    const tags = trimCaption("x", Array.from({ length: 80 }, (_, i) => `#tag${i}`).join(" "));
    expect(tags.text.length).toBeLessThanOrEqual(280);
    expect(tags.text.length).toBeGreaterThan(0);
  });

  it("never leaves half an emoji before the ellipsis", () => {
    const r = trimCaption("threads", "abc " + "😀".repeat(300));
    expect(r.trimmed).toBe(true);
    expect(r.text.length).toBeLessThanOrEqual(500);
    expect(r.text.endsWith(ELLIPSIS)).toBe(true);
    // No high surrogate without its low half (the cut backs off before the pair).
    expect(r.text).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    expect(r.text).toBe("abc " + "😀".repeat(247) + ELLIPSIS);
  });

  it("is not trimmed when only trailing whitespace is over the limit", () => {
    expect(trimCaption("threads", "x".repeat(500) + "\n")).toEqual({
      text: "x".repeat(500),
      trimmed: false,
    });
  });

  it("sendCaption trims the API networks only", () => {
    const p = post({ caption: "y".repeat(600), hashtags: ["#a"] });
    const a = auto({ platforms: ["threads", "x"] });
    expect(sendCaption(p, a, "threads")).toEqual({
      text: "y".repeat(499) + ELLIPSIS,
      trimmed: true,
    });
    expect(sendCaption(p, a, "x")).toEqual({ text: defaultCaption(p), trimmed: false });
    expect(captionWarnings(p, a)).toEqual([{ code: "tooLong", platform: "x" }]);
    expect(captionWarnings(post(), a)).toEqual([]);
  });
});

describe("directMediaUrl", () => {
  it.each([
    [
      "https://www.dropbox.com/scl/fi/abc/clip.mp4?rlkey=x&dl=0",
      "https://dl.dropboxusercontent.com/scl/fi/abc/clip.mp4?rlkey=x",
    ],
    [
      "https://drive.google.com/file/d/1AbC_d-9/view?usp=sharing",
      "https://drive.usercontent.google.com/download?id=1AbC_d-9&export=download&confirm=t",
    ],
    [
      "https://drive.google.com/open?id=XYZ",
      "https://drive.usercontent.google.com/download?id=XYZ&export=download&confirm=t",
    ],
    ["  https://cdn.example/clip.mp4 ", "https://cdn.example/clip.mp4"],
    ["not a url", "not a url"],
  ])("%s", (raw, direct) => {
    expect(directMediaUrl(raw)).toBe(direct);
  });
});

describe("publishProblems", () => {
  it("a complete job has none", () => {
    expect(publishProblems(post(), auto(), ready)).toEqual([]);
  });

  it("lists what blocks the job", () => {
    const p = post({ plannedDay: null, caption: "x".repeat(600), hashtags: [] });
    const a = auto({
      platforms: ["tiktok", "youtube", "threads", "instagram"],
      mediaKind: "image",
      mediaUrl: "http://a.example/p.jpg",
    });
    const status: SocialStatusMap = {
      ...ready,
      youtube: { configured: true, connected: false },
      instagram: { configured: true, connected: true, canPublish: false },
    };
    // The 600-character Threads caption is trimmed on send, so it is not a problem here.
    expect(publishProblems(p, a, status)).toEqual([
      { code: "noDay" },
      { code: "badUrl" },
      { code: "needsVideo", platform: "tiktok" },
      { code: "needsVideo", platform: "youtube" },
      { code: "notConnected", platform: "youtube" },
      { code: "noPermission", platform: "instagram" },
    ]);
  });

  it("text alone works for Threads only; an overlong X caption never blocks", () => {
    const a = auto({ platforms: ["threads", "instagram", "x"], mediaKind: "none", mediaUrl: "" });
    expect(publishProblems(post({ caption: "y".repeat(290), hashtags: [] }), a, ready)).toEqual([
      { code: "needsMedia", platform: "instagram" },
    ]);
    // A text-only caption made of whitespace is still empty after trimming.
    const blank = auto({ platforms: ["threads"], mediaKind: "none", mediaUrl: "" });
    expect(publishProblems(post({ caption: "   ", hashtags: [] }), blank, ready)).toEqual([
      { code: "empty", platform: "threads" },
    ]);
  });

  it("skips connection checks while the status is unknown, and the day check for 'now'", () => {
    expect(publishProblems(post({ plannedDay: null }), auto(), null, { now: true })).toEqual([]);
    expect(publishProblems(post(), auto({ platforms: [] }), ready)).toEqual([
      { code: "noPlatforms" },
    ]);
    expect(publishProblems(post(), auto({ mediaUrl: "" }), ready)).toEqual([{ code: "noMedia" }]);
    expect(publishProblems(post(), auto({ platforms: ["x", "snapchat"] }), ready)).toEqual([
      { code: "manualOnly" },
    ]);
  });
});

describe("buildJob", () => {
  it("sends the API networks with their options and the direct media link", () => {
    const p = post();
    const a = auto({
      platforms: ["tiktok", "youtube", "instagram", "x", "snapchat"],
      mediaUrl: "https://www.dropbox.com/s/abc/clip.mp4?dl=0",
      youtubePrivacy: "unlisted",
      tiktokMode: "inbox",
      captions: { instagram: "ig words" },
    });
    expect(buildJob(p, a, "2026-10-01T18:00:00.000Z")).toEqual({
      id: "p1",
      scheduledAt: "2026-10-01T18:00:00.000Z",
      media: { url: "https://dl.dropboxusercontent.com/s/abc/clip.mp4", kind: "video" },
      targets: {
        tiktok: { caption: defaultCaption(p), privacy: "PUBLIC_TO_EVERYONE", tiktokMode: "inbox" },
        youtube: { caption: defaultCaption(p), title: "Match cut in 30 s", privacy: "unlisted" },
        instagram: { caption: "ig words" },
      },
    });
  });

  it("text-only jobs carry no media", () => {
    const job = buildJob(post(), auto({ platforms: ["threads"], mediaKind: "none" }), AT);
    expect(job.media).toBeUndefined();
  });

  it("sends every caption trimmed to its network's limit", () => {
    const p = post({ caption: "a".repeat(2190), hashtags: ["#capcut", "#editing", "#3zprod"] });
    const a = auto({ platforms: ["threads", "instagram", "youtube"] });
    const job = buildJob(p, a, AT);
    expect(job.targets.threads?.caption.length).toBeLessThanOrEqual(CAPTION_MAX.threads);
    expect(job.targets.threads?.caption.endsWith(ELLIPSIS)).toBe(true);
    // Instagram (2200) only loses hashtags from the end; YouTube (5000) gets it all.
    expect(job.targets.instagram?.caption).toBe("a".repeat(2190) + "\n\n#capcut");
    expect(job.targets.youtube?.caption).toBe(defaultCaption(p));
  });
});

describe("results", () => {
  const worker = {
    jobs: [
      {
        id: "p1",
        scheduledAt: AT,
        targets: {
          tiktok: { caption: "c", state: "processing", attempts: 0, containerId: "x" },
          instagram: {
            caption: "c",
            state: "published",
            attempts: 0,
            permalink: "https://www.instagram.com/reel/A/",
            postId: "1",
          },
          youtube: { state: "exploded" },
          x: { state: "published" },
        },
      },
      { id: 5 },
    ],
  };

  it("parseJobs keeps known platforms and valid states only", () => {
    expect(parseJobs(worker)).toEqual([
      {
        id: "p1",
        scheduledAt: AT,
        results: {
          tiktok: { state: "processing" },
          instagram: {
            state: "published",
            permalink: "https://www.instagram.com/reel/A/",
            postId: "1",
          },
        },
      },
    ]);
    expect(parseJobs(null)).toEqual([]);
  });

  it("summarizes the per-network states", () => {
    const base = auto({ platforms: ["tiktok", "instagram", "x"], sentAt: AT });
    expect(autoPostSummary(auto())).toBe("draft");
    expect(autoPostSummary(base)).toBe("scheduled");
    expect(autoPostSummary({ ...base, results: { tiktok: { state: "processing" } } })).toBe(
      "publishing",
    );
    const both = {
      ...base,
      results: {
        tiktok: { state: "published" as const },
        instagram: { state: "published" as const, permalink: "https://i/1" },
      },
    };
    expect(autoPostSummary(both)).toBe("published");
    expect(firstPermalink(both)).toBe("https://i/1");
    expect(
      autoPostSummary({
        ...base,
        results: { tiktok: { state: "published" }, instagram: { state: "failed" } },
      }),
    ).toBe("partial");
    expect(
      autoPostSummary({
        ...base,
        results: { tiktok: { state: "failed" }, instagram: { state: "failed" } },
      }),
    ).toBe("failed");
    expect(autoPostSummary({ ...base, results: { tiktok: { state: "failed" } } })).toBe(
      "publishing",
    );
    expect(autoPostActive(base)).toBe(true);
    expect(autoPostActive(both)).toBe(false);
  });
});

describe("manual networks", () => {
  it("X opens its composer with the text; Snapchat opens the site", () => {
    expect(manualComposeUrl("x", "hi #3z")).toBe("https://x.com/intent/post?text=hi%20%233z");
    expect(manualComposeUrl("snapchat", "hi")).toBe("https://www.snapchat.com/");
    expect(manualComposeUrl("tiktok", "hi")).toBeNull();
  });

  it("lists the X / Snapchat steps still to do by hand", () => {
    const a = auto({ platforms: ["tiktok", "x", "snapchat"] });
    expect(pendingManualPlatforms(post({ autoPost: a }))).toEqual(["x", "snapchat"]);
    expect(pendingManualPlatforms(post({ autoPost: a, stage: "posted" }))).toEqual([]);
    expect(pendingManualPlatforms(post())).toEqual([]);
    expect(pendingManualPlatforms(post({ autoPost: auto() }))).toEqual([]);
  });
});

describe("reconnectInDays", () => {
  const now = Date.parse("2026-09-28T12:00:00Z");
  const days = (n: number) => new Date(now + n * 86_400_000).toISOString();
  const meta = (tokenExpiresAt: string) => ({
    configured: true,
    connected: true,
    canPublish: true,
    tokenExpiresAt,
  });

  it("warns within a week before a Meta token runs out (0 = today)", () => {
    expect(reconnectInDays(meta(days(30)), "instagram", now)).toBeNull();
    expect(reconnectInDays(meta(days(7.5)), "instagram", now)).toBe(7);
    expect(reconnectInDays(meta(days(2.2)), "threads", now)).toBe(2);
    expect(reconnectInDays(meta(days(0.4)), "threads", now)).toBe(0);
  });

  it("stays quiet for self-renewing platforms, unknown rows, bad dates and expired tokens", () => {
    // Google and TikTok renew their short tokens themselves: an hour left is routine.
    expect(reconnectInDays(meta(days(0.04)), "youtube", now)).toBeNull();
    expect(reconnectInDays(meta(days(0.9)), "tiktok", now)).toBeNull();
    expect(reconnectInDays(undefined, "instagram", now)).toBeNull();
    expect(reconnectInDays({ ...meta(days(3)), connected: false }, "instagram", now)).toBeNull();
    expect(reconnectInDays(meta("soon"), "instagram", now)).toBeNull();
    // Already expired: the row is in the error state and says "reconnect" on its own.
    expect(reconnectInDays(meta(days(-1)), "instagram", now)).toBeNull();
  });

  it("words today, tomorrow and two days on their own, then 'within {n} days'", () => {
    expect(reconnectMessageKey(0)).toBe("publish.tokenToday");
    expect(reconnectMessageKey(1)).toBe("publish.tokenTomorrow");
    expect(reconnectMessageKey(2)).toBe("publish.tokenTwoDays");
    expect(reconnectMessageKey(3)).toBe("publish.tokenSoon");
    expect(reconnectMessageKey(7)).toBe("publish.tokenSoon");
  });
});

describe("Worker calls", () => {
  const reply = (body: unknown, status = 200) =>
    vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify(body), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
    );

  it("schedule posts the job with the bearer token", async () => {
    const fetchImpl = reply({
      job: { id: "p1", scheduledAt: AT, targets: { tiktok: { state: "queued" } } },
    });
    const job = buildJob(post(), auto(), AT);
    const r = await publishSchedule(CONFIG, job, { fetchImpl });
    expect(r).toEqual({
      ok: true,
      job: { id: "p1", scheduledAt: AT, results: { tiktok: { state: "queued" } } },
    });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://scout.test/social/publish");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual(job);
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });

  it("list, run and cancel hit their routes; errors come back typed", async () => {
    const list = reply({ jobs: [] });
    expect(await publishList(CONFIG, { fetchImpl: list })).toEqual({ ok: true, jobs: [] });
    const run = reply({ job: { id: "p 1", scheduledAt: AT, targets: {} } });
    await publishRun(CONFIG, "p 1", { fetchImpl: run });
    expect(run.mock.calls[0][0]).toBe("https://scout.test/social/publish/p%201/run");
    const del = reply({ ok: true });
    expect(await publishCancel(CONFIG, "p1", { fetchImpl: del })).toEqual({ ok: true });
    expect(del.mock.calls[0][1]?.method).toBe("DELETE");
    expect(await publishList(CONFIG, { fetchImpl: reply({ error: "bad_request" }, 400) })).toEqual({
      ok: false,
      error: { type: "bad_request", status: 400 },
    });
    expect(await publishList(null)).toEqual({ ok: false, error: { type: "unconfigured" } });
  });
});
