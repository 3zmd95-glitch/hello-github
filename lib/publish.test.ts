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
  captionFor,
  defaultCaption,
  directMediaUrl,
  firstPermalink,
  manualComposeUrl,
  parseJobs,
  publishCancel,
  publishList,
  publishProblems,
  publishRun,
  publishSchedule,
  scheduledAtOf,
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
    expect(publishProblems(p, a, status)).toEqual([
      { code: "noDay" },
      { code: "badUrl" },
      { code: "needsVideo", platform: "tiktok" },
      { code: "needsVideo", platform: "youtube" },
      { code: "notConnected", platform: "youtube" },
      { code: "tooLong", platform: "threads" },
      { code: "noPermission", platform: "instagram" },
    ]);
  });

  it("text alone works for Threads only; nothing is needed from X and Snapchat but the length", () => {
    const a = auto({ platforms: ["threads", "instagram", "x"], mediaKind: "none", mediaUrl: "" });
    expect(publishProblems(post({ caption: "y".repeat(290), hashtags: [] }), a, ready)).toEqual([
      { code: "needsMedia", platform: "instagram" },
      { code: "tooLong", platform: "x" },
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
